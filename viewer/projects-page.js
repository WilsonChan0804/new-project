/* Projects: your jobs, and everything about each one in one place - its
 * people, its sheets and model, its tasks (with their sub-tasks, from every
 * team's task list), its issues by status, its files and its chat.
 *
 * Read-only: projects, their members and their viewer project are set up
 * on the Admin page (Projects and members). Those who may change a project
 * get a "Manage" button that goes there.
 */

import { api, keptCopy, keepCopy } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, people, avatar, fmtDate, toast, ic, pop, closePop, modal } from "./tasks-util.js";

/* What is kept about a project beyond its name (tasks.py INFO_KEYS), in order. */
const INFO = [
  ["project_no", "Project no."], ["client", "Client"], ["address", "Address"], ["building_type", "Building type"],
  ["site_area", "Site area (m²)"], ["gfa", "GFA (m²)"], ["storeys", "Storeys"], ["stage", "Stage"],
  ["start", "Start"], ["completion", "Completion"], ["description", "Description"],
];
import { chip } from "./filelinks.js";

const P = { me: null, list: [], rooms: {}, open: "", q: "", status: "", tree: {}, shut: new Set() };
const ISSUE_ORDER = ["Open", "In progress", "Resolved", "Closed", "Not an issue"];
const ISSUE_COL = { "Open": "#e2453c", "In progress": "#e8a13a", "Resolved": "#3b82f6", "Closed": "#0e9f6e", "Not an issue": "#9aa3ae" };

async function load() {
  const [r, rooms] = await Promise.all([
    api("/api/registry"),
    api("/api/chat/rooms").catch(() => ({ rooms: [], joinable: [] })),
  ]);
  P.list = r.projects;
  P.rooms = {};
  for (const x of (rooms.rooms || []).concat(rooms.joinable || [])) if (x.kind === "project") P.rooms[x.project] = x;
  keepCopy("projects", { list: P.list, rooms: P.rooms }, P.me && P.me.user && P.me.user.id);
  paintList();
  if (P.open) openDetail(P.open);
}

/* the status filter, the table */
function paintList() {
  const st = $("#pj-status"), cur = st.value;
  const vals = [...new Set(P.list.map((p) => p.status).filter(Boolean))].sort();
  st.innerHTML = `<option value="">Any status</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join("");
  st.value = vals.includes(cur) ? cur : "";
  $("#pj-manage").hidden = !P.list.some((p) => p.can_edit);
  render();
}

function ratio(st) {
  if (!st.tasks) return `<span class="muted">-</span>`;
  const pct = Math.round((st.done / st.tasks) * 100);
  return `<span class="pj-ratio"><span class="prog wide"><i style="width:${pct}%"></i></span><b>${pct}%</b></span>`;
}

/* the issues of a project, by status: a thin stacked bar and the numbers */
function issueBar(is, big) {
  if (!is) return `<span class="muted">-</span>`;
  if (!is.total) return `<span class="muted">none</span>`;
  const by = is.by_status || {};
  const parts = ISSUE_ORDER.filter((k) => by[k]).map((k) => `<i style="width:${(by[k] / is.total) * 100}%;background:${ISSUE_COL[k]}" title="${esc(k)}: ${by[k]}"></i>`).join("");
  return `<span class="pj-iss${big ? " big" : ""}"><span class="pj-ibar">${parts}</span>`
    + `<span><b class="${is.overdue ? "bad" : ""}">${is.open}</b> open / ${is.total}</span></span>`;
}

/* Sheets / 3D / Dashboard of a project. A project of several models (Site 1,
   Site 2 ...) gets a small menu of its parts on each. */
function opens(p) {
  const parts = (p.parts || []).filter((x) => x.ok);
  const g = p.stats.groups.find((x) => x.can_open);
  const room = P.rooms[p.id];
  const one = (page, label, title) => {
    if (!parts.length) return "";
    if (parts.length === 1) return `<a href="${page}?project=${encodeURIComponent(parts[0].id)}" title="${title}">${label}</a>`;
    return `<a href="#" data-parts="${page}" data-reg="${esc(p.id)}" title="${title} - ${parts.length} parts">${label} &#9662;</a>`;
  };
  return `<span class="pj-vl">`
    + one("index.html", "Sheets", "Sheets") + one("model.html", "3D", "3D model")
    + (g ? `<a href="tasks.html?list=${esc(g.list_id)}" title="Tasks (${esc(g.list_title)})">Tasks</a>` : "")
    + (room ? `<a href="messenger.html?room=${esc(room.id)}" title="${room.member ? "The project's chat" : "Join the project's chat"}">Chat${room.unread ? ` <b class="pj-n">${room.unread}</b>` : ""}</a>` : "")
    + one("dashboard.html", "Dashboard", "Issues and tasks dashboard")
    + `<a href="folders.html?reg=${encodeURIComponent(p.id)}" title="The project's files, in its folder on the server">Folders</a>`
    + `</span>`;
}

/* the menu of parts behind Sheets / 3D / Dashboard */
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("[data-parts]");
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  const p = P.list.find((x) => x.id === a.dataset.reg);
  const parts = (p.parts || []).filter((x) => x.ok);
  const el = pop(a, parts.map((x) => `<a class="po-row" href="${a.dataset.parts}?project=${encodeURIComponent(x.id)}">${esc(x.title)}</a>`).join(""), 220);
  el.addEventListener("click", () => closePop());
}, true);

function render() {
  const q = P.q.trim().toLowerCase();
  const rows = P.list.filter((p) => (!P.status || p.status === P.status)
    && (!q || [p.code, p.name, p.short, p.team, p.viewer, p.members.map((m) => m.name).join(" ")].join(" ").toLowerCase().includes(q)));
  $("#pj-count").textContent = `${rows.length} of ${P.list.length}`;
  if (!P.list.length) {
    $("#t-view").innerHTML = `<div class="t-empty"><h3>No projects yet</h3><p>You are not a member of any project. A project admin adds you on the Admin page.</p></div>`;
    return;
  }
  $("#t-view").innerHTML = `<table class="pj">
    <thead><tr><th>Project</th><th>Members</th><th>Open</th><th>Status</th>
      <th class="num">Tasks</th><th>Completion</th><th class="num">Overdue</th><th>Issues</th><th>Open tasks</th><th>Folder</th></tr></thead>
    <tbody>${rows.map((p) => {
      const st = p.stats;
      return `<tr data-id="${esc(p.id)}" class="${P.open === p.id ? "sel" : ""}">
        <td class="pj-name">${p.thumb ? `<img class="pj-thumb" src="${esc(p.thumb)}" alt="" loading="lazy">` : ""}<b>${esc(p.short || p.name)}</b><small class="muted">${esc(p.code || (p.short !== p.name ? p.name : ""))}${p.team ? " · " + esc(p.team) : ""}</small></td>
        <td>${people(p.members, 5) || `<span class="muted">-</span>`}</td>
        <td>${opens(p)}</td>
        <td><span class="pj-st st-${esc(p.status.toLowerCase().replace(/\s+/g, "-"))}">${esc(p.status)}</span></td>
        <td class="num">${st.done}/${st.tasks}</td><td>${ratio(st)}</td>
        <td class="num ${st.overdue ? "bad" : ""}">${st.overdue || ""}</td>
        <td>${issueBar(p.issues)}</td>
        <td class="pj-tasks">${st.open_tasks.slice(0, 2).map((t) => `<a class="pj-chip${t.overdue ? " bad" : ""}" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}" title="${esc(t.title)}${t.due ? " - due " + esc(t.due) : ""}">${esc(t.title)}</a>`).join("")}`
          + `${st.open_tasks.length > 2 ? `<span class="pj-more">+${st.open_tasks.length - 2}</span>` : ""}</td>
        <td class="pj-links">${p.links.slice(0, 1).map((l) => chip(l)).join("") || `<span class="muted">-</span>`}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

/* ------------------------------------------------------------ one project */

async function openDetail(id) {
  const p = P.list.find((x) => x.id === id);
  if (!p) return;
  P.open = id;
  history.replaceState(null, "", "projects.html?p=" + encodeURIComponent(id));
  paintDetail(p);
  render();
  try { P.tree[id] = (await api(`/api/registry/${encodeURIComponent(id)}/tasks`)).groups; } catch (e) { P.tree[id] = []; }
  if (P.open === id) paintDetail(p);
}

function taskTree(p) {
  const groups = P.tree[p.id];
  if (!groups) return `<p class="muted">Loading ...</p>`;
  if (!groups.length) return `<p class="muted td-none">No task list has a group for this project yet (Tasks &rarr; ... &rarr; Groups and projects).</p>`;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const late = (t) => !t.done && t.due && t.due.slice(0, 10) < today;
  const row = (t, sub) => `<a class="pt-row${t.done ? " done" : ""}${sub ? " sub" : ""}" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}">`
    + `<span class="tick${t.done ? " on" : ""}"></span><span class="pt-t">${esc(t.title || "Untitled")}</span>`
    + (t.children && t.children.length ? `<small class="muted">${t.children.filter((k) => k.done).length}/${t.children.length}</small>` : "")
    + `<span class="spacer"></span>${t.due ? `<small class="${late(t) ? "bad" : "muted"}">${esc(fmtDate(t.due))}</small>` : ""}${people(t.owners, 2)}</a>`;
  return groups.map((g) => {
    const open = g.tasks.filter((t) => !t.done).length;
    return `<div class="pt-g"><div class="pt-gh"><b>${esc(g.list_title)}</b> / ${esc(g.group.title)} <small class="muted">${open} open of ${g.tasks.length}</small>`
      + `<span class="spacer"></span><a href="tasks.html?list=${esc(g.list_id)}">Open list</a></div>`
      + g.tasks.map((t) => {
        const kids = t.children || [];
        const shut = !P.shut.has(t.id);
        return `<div class="pt-task">`
          + (kids.length ? `<button class="ghost pt-exp${shut ? "" : " open"}" data-exp="${esc(t.id)}" title="${kids.length} sub-tasks">${ic("next", 14)}</button>` : `<span class="pt-exp"></span>`)
          + row(t, false) + `</div>`
          + (kids.length && !shut ? `<div class="pt-kids">${kids.map((k) => row(k, true)).join("")}</div>` : "");
      }).join("") + `</div>`;
  }).join("");
}

function membersHtml(p) {
  if (!p.members.length) return `<p class="muted td-none">No members yet.</p>`;
  const by = new Map();
  for (const m of p.members) {
    const k = m.team || m.office || "Others";
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(m);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, ms]) =>
    `<div class="pm-team"><small class="muted">${esc(k)} · ${ms.length}</small>`
    + ms.map((m) => `<span class="pm" title="${esc(m.email)}${m.role ? " - " + esc(m.role) : ""}">${avatar(m, 26)}<span>${esc(m.name)}</span></span>`).join("")
    + `</div>`).join("");
}

function paintDetail(p) {
  const st = p.stats, room = P.rooms[p.id], is = p.issues;
  const box = $("#t-detail");
  box.hidden = false;
  document.body.classList.add("detail-on");
  const q = p.viewer ? "?project=" + encodeURIComponent(p.viewer) : "";
  box.innerHTML = `<div class="td-top">
      <button class="ghost td-backbtn icon-btn" data-act="close">${ic("back", 18)} Back</button>
      <b class="pd-t">${esc(p.short || p.name)}</b><span class="spacer"></span>
      ${p.can_edit ? `<a class="ghost pd-manage" href="admin.html?reg=${encodeURIComponent(p.id)}#projects" data-manage title="Details, members and the viewer project are set on the Admin page">${ic("edit")} Manage</a>` : ""}
      <button class="ghost td-x" data-act="close">${ic("close")}</button></div>
    <div class="td-body">
      ${p.thumb || p.can_edit ? `<div class="pd-thumb${p.thumb ? "" : " none"}"${p.can_edit ? ` data-act="thumb" title="Click or drop a picture to change it"` : ""}>`
        + (p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.short || p.name)}">` : `<span>+ Add a picture of the project</span>`)
        + (p.can_edit && p.thumb ? `<button class="ghost pd-thumb-x" data-act="thumbdel" title="Remove the picture">&times;</button>` : "")
        + `</div><input type="file" id="pd-thumb-file" accept="image/*" hidden>` : ""}
      <div class="td-num muted">${esc([p.code, p.name !== p.short && !(p.code && p.name.includes(p.code)) ? p.name : ""].filter(Boolean).join(" · "))}</div>
      <div class="pd-open">${opens(p)}</div>
      <h4>Project information ${p.can_edit ? `<button class="ghost pd-edit" data-act="info">${ic("edit")} Edit</button>` : ""}</h4>
      <div class="pd-info">${INFO.filter(([k]) => (p.info || {})[k]).map(([k, l]) => `<div class="td-r"><span class="td-l">${esc(l)}</span><div class="td-v">${esc(p.info[k]).replace(/\n/g, "<br>")}</div></div>`).join("")
        || `<p class="muted td-none">${p.can_edit ? "Nothing yet - Edit adds the project no., client, address, site area, GFA ..." : "Nothing yet."}</p>`}</div>
      ${(p.parts || []).length > 1 ? `<h4 style="margin-top:6px">Models and sheets <span class="muted">${p.parts.length} parts</span></h4>`
        + `<div class="pd-parts">${p.parts.map((x) => {
          const st = ((p.issues || {}).parts || []).find((y) => y.viewer === x.id);
          const q = "?project=" + encodeURIComponent(x.id);
          return `<div class="pd-part"><b>${esc(x.title)}</b>`
            + (x.ok ? `<span class="pj-vl"><a href="index.html${q}">Sheets</a><a href="model.html${q}">3D</a><a href="dashboard.html${q}">Dashboard</a></span>` : `<small class="muted">not a member</small>`)
            + (st ? `<small class="muted">${st.open} open issue${st.open === 1 ? "" : "s"}${st.overdue ? `, <span class="bad">${st.overdue} overdue</span>` : ""}</small>` : "")
            + `</div>`;
        }).join("")}</div>` : ""}
      <div class="td-r"><span class="td-l">Status</span><div class="td-v"><span class="pj-st st-${esc(p.status.toLowerCase().replace(/\s+/g, "-"))}">${esc(p.status)}</span></div></div>
      <div class="td-r"><span class="td-l">Owners</span><div class="td-v">${people(p.owners, 6) || "-"}</div></div>
      ${p.team ? `<div class="td-r"><span class="td-l">Group</span><div class="td-v">${esc(p.team)}</div></div>` : ""}
      ${p.notes ? `<p class="pj-notes">${esc(p.notes)}</p>` : ""}

      <h4>Team <span class="muted">${p.members.length}</span></h4>
      ${membersHtml(p)}

      <h4>Issues ${is ? `<span class="muted">${is.open} open of ${is.total}</span>` : ""}</h4>
      ${is ? `<div class="pd-istat">${ISSUE_ORDER.filter((k) => (is.by_status || {})[k]).map((k) =>
        `<a href="dashboard.html${q}" class="pd-is" style="--c:${ISSUE_COL[k]}"><b>${is.by_status[k]}</b><span>${esc(k)}</span></a>`).join("")
        || `<span class="muted">No issues yet.</span>`}${is.overdue ? `<a href="dashboard.html${q}" class="pd-is" style="--c:#b42318"><b>${is.overdue}</b><span>Overdue</span></a>` : ""}</div>`
        : `<p class="muted td-none">${p.viewer ? "You are not a member of its viewer project." : "No model and sheets published for this project yet."}</p>`}

      <h4>Tasks <span class="muted">${st.done} / ${st.tasks} done${st.overdue ? `, <span class="bad">${st.overdue} overdue</span>` : ""}</span></h4>
      <div class="pt">${taskTree(p)}</div>

      <h4>Files</h4>
      <div class="fl-list">${p.links.map((l) => chip(l)).join("") || `<span class="muted td-none">No folder links yet.</span>`}</div>

      <h4>Chat</h4>
      ${room ? `<a class="primary-link" href="messenger.html?room=${esc(room.id)}">${ic("chat")} ${room.member ? "Open" : "Join"} the ${esc(p.short || p.name)} channel</a>${room.unread ? ` <b class="bad">${room.unread} unread</b>` : ""}`
        : P.me.accounts ? `<button data-act="room">${ic("chat")} Start a channel for this project</button> <span class="muted" style="font-size:11px">its members are added; task and issue updates are posted into it</span>` : ""}
      <div class="td-subscr muted">${p.updated_by ? "Last changed by " + esc(p.updated_by) + " " + esc((p.updated_at || "").slice(0, 10)) : ""}</div>
    </div>`;
  box.onclick = async (ev) => {
    const ex = ev.target.closest("[data-exp]");
    if (ex) {
      ev.preventDefault();
      P.shut.has(ex.dataset.exp) ? P.shut.delete(ex.dataset.exp) : P.shut.add(ex.dataset.exp);
      return paintDetail(p);
    }
    if (ev.target.closest("[data-manage]")) { try { localStorage.setItem("lwk-viewer:project", p.viewer || ""); } catch (e) {} }
    const a = ev.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "close") {
      box.hidden = true; document.body.classList.remove("detail-on");
      P.open = ""; history.replaceState(null, "", "projects.html"); render();
    }
    if (a.dataset.act === "info") return editInfo(p);
    if (a.dataset.act === "thumbdel") {
      ev.stopPropagation();
      if (!confirm("Remove the project's picture?")) return;
      try { await api(`/api/registry/${encodeURIComponent(p.id)}/thumb`, { method: "DELETE" }); p.thumb = ""; paintDetail(p); render(); }
      catch (e) { toast(e.message, true); }
      return;
    }
    if (a.dataset.act === "thumb") return $("#pd-thumb-file").click();
    if (a.dataset.act === "room") {
      try {
        const r = await api("/api/chat/rooms", { method: "POST", body: JSON.stringify({ kind: "project", project: p.id }) });
        location.href = "messenger.html?room=" + encodeURIComponent(r.id);
      } catch (e) { toast(e.message, true); }
    }
  };
}

async function editInfo(p) {
  const i = p.info || {};
  const f = await modal("Project information - " + (p.short || p.name), `<div class="pd-form">`
    + INFO.map(([k, l]) => k === "description" || k === "address"
      ? `<label class="wide">${esc(l)}<textarea name="${k}" rows="${k === "description" ? 4 : 2}">${esc(i[k] || "")}</textarea></label>`
      : `<label>${esc(l)}<input name="${k}" value="${esc(i[k] || "")}" ${k === "start" || k === "completion" ? 'placeholder="e.g. 2026-03 or Q2 2027"' : ""}></label>`).join("")
    + `</div>`, "Save");
  if (!f) return;
  const info = {};
  for (const [k] of INFO) info[k] = f[k].value.trim();
  try {
    const r = await api("/api/registry", { method: "POST", body: JSON.stringify({ id: p.id, info }) });
    p.info = r.info;
    paintDetail(p);
    toast("Saved");
  } catch (e) { toast(e.message, true); }
}

async function putThumb(p, file) {
  if (!file || !/^image\//.test(file.type)) { toast("A picture please (JPG, PNG or WebP)", true); return; }
  try {
    const r = await api(`/api/registry/${encodeURIComponent(p.id)}/thumb`, { method: "POST", body: file, headers: { "Content-Type": file.type } });
    p.thumb = r.thumb;
    paintDetail(p);
    render();
  } catch (e) { toast(e.message, true); }
}

/* a picture dropped on the panel's picture, or picked with a click */
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "pd-thumb-file") return;
  const p = P.list.find((x) => x.id === P.open);
  if (p) putThumb(p, ev.target.files[0]);
  ev.target.value = "";
});
document.addEventListener("dragover", (ev) => { if (ev.target.closest && ev.target.closest(".pd-thumb[data-act]")) ev.preventDefault(); });
document.addEventListener("drop", (ev) => {
  const t = ev.target.closest && ev.target.closest(".pd-thumb[data-act]");
  if (!t) return;
  ev.preventDefault();
  const p = P.list.find((x) => x.id === P.open);
  if (p && ev.dataTransfer.files[0]) putThumb(p, ev.dataTransfer.files[0]);
});

async function start() {
  // the list as it was last time, at once (replaced when the server answers)
  const was = keptCopy("projects");
  if (was && was.list) {
    P.list = was.list;
    P.rooms = was.rooms || {};
    P.me = { accounts: true };
    try { paintList(); } catch (e) { /* drawn properly in a moment */ }
  }
  const me = await ensureSignedIn();
  P.me = me;
  header(me);
  P.open = new URLSearchParams(location.search).get("p") || "";
  $("#pj-q").oninput = (ev) => { P.q = ev.target.value; render(); };
  $("#pj-status").onchange = (ev) => { P.status = ev.target.value; render(); };
  $("#t-view").onclick = (ev) => {
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest("tr[data-id]");
    if (tr) openDetail(tr.dataset.id);
  };
  await load();
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 60000);
}

start().catch((e) => { $("#t-view").innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`; });
