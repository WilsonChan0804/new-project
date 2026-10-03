/* Projects: the register of jobs (what the Lark Base "Projects" table did).
 *
 * Each job has its code, owners, team, status, where its files are
 * (OneDrive / ACC links) and which viewer project shows its drawings and
 * model. The task groups linked to it give its task counts, the viewer
 * project its issues, and it can have a channel in the Messenger.
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, people, avatar, fmtDate, pickPeople, modal, toast, pop, closePop } from "./tasks-util.js";
import { chip, makeLink, classify } from "./filelinks.js";

const STATUSES = ["Active", "On hold", "Tender", "Completed", "Archived"];
const P = { me: null, list: [], canCreate: false, viewer: [], people: [], rooms: {}, open: "", q: "", status: "", team: "" };

async function load() {
  const [r, vp, pp, rooms] = await Promise.all([
    api("/api/registry"),
    api("/api/projects").catch(() => ({ projects: [] })),
    api("/api/people").catch(() => ({ people: [] })),
    api("/api/chat/rooms").catch(() => ({ rooms: [], joinable: [] })),
  ]);
  P.list = r.projects;
  P.canCreate = r.can_create;
  P.viewer = vp.projects || [];
  P.people = pp.people || [];
  P.rooms = {};
  for (const x of (rooms.rooms || []).concat(rooms.joinable || [])) if (x.kind === "project") P.rooms[x.project] = x;
  $("#pj-new").hidden = $("#pj-import").hidden = !P.canCreate;
  const fill = (sel, vals, label) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join("");
    sel.value = vals.includes(cur) ? cur : "";
  };
  fill($("#pj-status"), [...new Set(P.list.map((p) => p.status).filter(Boolean))].sort(), "Any status");
  fill($("#pj-team"), [...new Set(P.list.map((p) => p.team).filter(Boolean))].sort(), "Any team");
  render();
  if (P.open) openDetail(P.open);
}

function ratio(st) {
  if (!st.tasks) return `<span class="muted">-</span>`;
  const pct = Math.round((st.done / st.tasks) * 100);
  return `<span class="pj-ratio"><span class="prog wide"><i style="width:${pct}%"></i></span><b>${pct}%</b></span>`;
}

function viewerLinks(p) {
  if (!p.viewer) return `<span class="muted">-</span>`;
  if (!p.viewer_ok) return `<span class="muted" title="You are not a member of this viewer project">${esc(p.viewer)}</span>`;
  const q = "?project=" + encodeURIComponent(p.viewer);
  return `<span class="pj-vl"><a href="index.html${q}" title="Sheets">2D</a><a href="model.html${q}" title="3D model">3D</a>`
    + `<a href="dashboard.html${q}" title="Issues dashboard">Issues</a></span>`;
}

function render() {
  const q = P.q.trim().toLowerCase();
  const rows = P.list.filter((p) => (!P.status || p.status === P.status) && (!P.team || p.team === P.team)
    && (!q || [p.code, p.name, p.short, p.team, p.viewer, p.owners.map((o) => o.name).join(" ")].join(" ").toLowerCase().includes(q)));
  $("#pj-count").textContent = `${rows.length} of ${P.list.length}`;
  if (!P.list.length) {
    $("#t-view").innerHTML = `<div class="t-empty"><h3>No projects yet</h3><p>Add your jobs - or import the project table from Lark Base (Export &rarr; Excel).</p>`
      + (P.canCreate ? `<button class="primary" id="pj-e-new">+ New project</button> <button id="pj-e-imp">Import</button>` : `<p class="muted">A project admin or site admin adds them.</p>`) + `</div>`;
    if (P.canCreate) { $("#pj-e-new").onclick = () => edit(null); $("#pj-e-imp").onclick = importFile; }
    return;
  }
  $("#t-view").innerHTML = `<table class="pj">
    <thead><tr><th>Project</th><th>Owner</th><th>Team</th><th>Project folder</th><th>Viewer</th><th>Status</th>
      <th class="num">Tasks</th><th class="num">Done</th><th>Completion</th><th class="num">Overdue</th><th class="num">Open issues</th><th>Open tasks</th><th>Chat</th></tr></thead>
    <tbody>${rows.map((p) => {
      const st = p.stats, room = P.rooms[p.id];
      return `<tr data-id="${esc(p.id)}" class="${P.open === p.id ? "sel" : ""}">
        <td class="pj-name"><b>${esc(p.short || p.name)}</b><small class="muted">${esc(p.code || (p.short !== p.name ? p.name : ""))}</small></td>
        <td>${people(p.owners, 3)}</td>
        <td>${esc(p.team)}</td>
        <td class="pj-links">${p.links.slice(0, 2).map((l) => chip(l)).join("") || `<span class="muted">-</span>`}</td>
        <td>${viewerLinks(p)}</td>
        <td><span class="pj-st st-${esc(p.status.toLowerCase().replace(/\s+/g, "-"))}">${esc(p.status)}</span></td>
        <td class="num">${st.tasks}</td><td class="num">${st.done}</td><td>${ratio(st)}</td>
        <td class="num ${st.overdue ? "bad" : ""}">${st.overdue || ""}</td>
        <td class="num">${p.issues ? `<span class="${p.issues.overdue ? "bad" : ""}" title="${p.issues.overdue} overdue of ${p.issues.open} open (${p.issues.total} in all)">${p.issues.open}</span>` : `<span class="muted">-</span>`}</td>
        <td class="pj-tasks">${st.open_tasks.slice(0, 2).map((t) => `<a class="pj-chip${t.overdue ? " bad" : ""}" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}" title="${esc(t.title)}${t.due ? " - due " + esc(t.due) : ""}">${esc(t.title)}</a>`).join("")}`
          + `${st.open_tasks.length > 2 ? `<span class="pj-more">+${st.open_tasks.length - 2}</span>` : ""}</td>
        <td>${room ? `<a class="pj-chat" href="messenger.html?room=${esc(room.id)}" title="${room.member ? "Open the channel" : "Join the channel"}">&#128172;${room.unread ? ` <b>${room.unread}</b>` : ""}</a>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

/* ------------------------------------------------------------ detail */

function openDetail(id) {
  const p = P.list.find((x) => x.id === id);
  if (!p) return;
  P.open = id;
  history.replaceState(null, "", "projects.html?p=" + encodeURIComponent(id));
  const st = p.stats, room = P.rooms[p.id];
  const box = $("#t-detail");
  box.hidden = false;
  box.innerHTML = `<div class="td-top"><b style="font-size:15px">${esc(p.short || p.name)}</b><span class="spacer"></span>
      ${p.can_edit ? `<button class="ghost" data-act="edit">Edit</button><button class="ghost danger" data-act="delete" title="Delete">&#128465;</button>` : ""}
      <button class="ghost" data-act="close">&#10005;</button></div>
    <div class="td-body">
      <div class="td-num muted">${esc(p.code)}${p.code && p.name !== p.short ? " · " : ""}${p.name !== p.short ? esc(p.name) : ""}</div>
      <div class="td-r"><span class="td-l">Owners</span><div class="td-v">${people(p.owners, 6) || "-"}</div></div>
      <div class="td-r"><span class="td-l">Team</span><div class="td-v">${esc(p.team) || "-"}</div></div>
      <div class="td-r"><span class="td-l">Status</span><div class="td-v"><span class="pj-st st-${esc(p.status.toLowerCase().replace(/\s+/g, "-"))}">${esc(p.status)}</span></div></div>
      <div class="td-r"><span class="td-l">Viewer</span><div class="td-v">${p.viewer ? esc(p.viewer) + " " + viewerLinks(p) : `<span class="muted">not linked</span>`}</div></div>
      ${p.notes ? `<p class="pj-notes">${esc(p.notes)}</p>` : ""}

      <h4>Files</h4>
      <div class="fl-list">${p.links.map((l) => chip(l)).join("") || `<span class="muted td-none">No folder links yet - add the OneDrive / ACC folder with Edit.</span>`}</div>

      <h4>Chat</h4>
      ${room ? `<a class="primary-link" href="messenger.html?room=${esc(room.id)}">&#128172; ${room.member ? "Open" : "Join"} the ${esc(p.short || p.name)} channel</a>${room.unread ? ` <b class="bad">${room.unread} unread</b>` : ""}`
        : P.me.accounts ? `<button data-act="room">Start a channel for this project</button> <span class="muted" style="font-size:11px">task and issue updates are posted into it</span>` : `<span class="muted">The Messenger needs accounts.</span>`}

      <h4>Tasks <span class="muted">${st.done} / ${st.tasks} done${st.overdue ? `, <span class="bad">${st.overdue} overdue</span>` : ""}</span></h4>
      ${st.groups.length ? st.groups.map((g) => `<div class="pj-g">${g.can_open ? `<a href="tasks.html?list=${esc(g.list_id)}">${esc(g.list_title)} / <b>${esc(g.title)}</b></a>` : `${esc(g.list_title)} / <b>${esc(g.title)}</b>`}</div>`).join("")
        : `<p class="muted td-none">No task group is linked to this project. In Tasks: ... &rarr; Groups and projects.</p>`}
      <div class="pj-open">${st.open_tasks.map((t) => `<a class="td-sub" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}">`
        + `<span class="tick"></span><span class="td-st">${esc(t.title)}</span><span class="spacer"></span>`
        + (t.due ? `<small class="${t.overdue ? "bad" : "muted"}">${esc(fmtDate(t.due))}</small>` : "") + people(t.owners, 2) + `</a>`).join("")}</div>

      <h4>Issues</h4>
      ${p.issues ? `<p>${p.issues.open} open of ${p.issues.total}${p.issues.overdue ? `, <span class="bad">${p.issues.overdue} overdue</span>` : ""} · <a href="dashboard.html?project=${encodeURIComponent(p.viewer)}">Issues dashboard</a></p>`
        : `<p class="muted td-none">${p.viewer ? "You are not a member of the viewer project." : "Link a viewer project (Edit) to see its issues here."}</p>`}
      <div class="td-subscr muted">${p.updated_by ? "Last changed by " + esc(p.updated_by) + " " + esc((p.updated_at || "").slice(0, 10)) : ""}</div>
    </div>`;
  box.onclick = async (ev) => {
    const a = ev.target.closest("[data-act]");
    if (!a) return;
    const k = a.dataset.act;
    if (k === "close") { box.hidden = true; P.open = ""; history.replaceState(null, "", "projects.html"); render(); }
    if (k === "edit") edit(p);
    if (k === "delete") {
      if (!confirm(`Delete ${p.short || p.name} from the Projects page? Its tasks, issues and files stay where they are.`)) return;
      try { await api("/api/registry/" + p.id, { method: "DELETE" }); box.hidden = true; P.open = ""; await load(); }
      catch (e) { toast(e.message, true); }
    }
    if (k === "room") {
      try {
        const r = await api("/api/chat/rooms", { method: "POST", body: JSON.stringify({ kind: "project", project: p.id }) });
        location.href = "messenger.html?room=" + encodeURIComponent(r.id);
      } catch (e) { toast(e.message, true); }
    }
  };
  render();
}

async function edit(p) {
  const cur = p ? JSON.parse(JSON.stringify(p)) : { code: "", name: "", short: "", owners: [], team: "", status: "Active", viewer: "", links: [], notes: "" };
  const vopts = `<option value="">- none -</option>` + P.viewer.map((v) =>
    `<option value="${esc(v.id)}"${v.id === cur.viewer ? " selected" : ""}>${esc(v.title)}${v.title !== v.id ? " (" + esc(v.id) + ")" : ""}</option>`).join("");
  const done = modal(p ? "Edit " + (p.short || p.name) : "New project", `
    <label>Project name <input name="name" value="${esc(cur.name)}" required placeholder="e.g. HKA-P-01681-ARC - SKW"></label>
    <div class="pj-2"><label>Code <input name="code" value="${esc(cur.code)}" placeholder="HKA-P-01681-ARC"></label>
      <label>Short name <input name="short" value="${esc(cur.short)}" placeholder="SKW - the task group name"></label></div>
    <div class="pj-2"><label>Team <input name="team" value="${esc(cur.team)}" placeholder="e.g. Arbel's Group" list="pj-teams"></label>
      <label>Status <select name="status">${STATUSES.concat(STATUSES.includes(cur.status) ? [] : [cur.status]).map((s) => `<option${s === cur.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label></div>
    <datalist id="pj-teams">${[...new Set(P.list.map((x) => x.team).filter(Boolean))].map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
    <label>Owners <div class="pj-owners td-v act">${people(cur.owners, 8) || `<span class="muted">choose</span>`}</div></label>
    <label>Viewer project <select name="viewer">${vopts}</select></label>
    <label>Folders and files <small class="muted">OneDrive, SharePoint or ACC links</small></label>
    <div class="fl-list pj-links-ed">${cur.links.map((l) => chip(l, { remove: true })).join("")}</div>
    <div class="fl-add"><input class="pj-link" placeholder="https://... folder link"><button type="button" class="pj-addlink">Add</button></div>
    <label>Notes <textarea name="notes" rows="2">${esc(cur.notes)}</textarea></label>`, p ? "Save" : "Create");
  const form = document.querySelector(".t-modal");
  const paintLinks = () => { form.querySelector(".pj-links-ed").innerHTML = cur.links.map((l) => chip(l, { remove: true })).join(""); };
  form.querySelector(".pj-owners").onclick = (ev) => pickPeople(ev.currentTarget, cur.owners, P.people, (v) => {
    cur.owners = v;
    form.querySelector(".pj-owners").innerHTML = people(v, 8) || `<span class="muted">choose</span>`;
  });
  const addLink = () => {
    const inp = form.querySelector(".pj-link");
    const url = inp.value.trim();
    if (!url) return;
    const c = classify(url);
    if (!c) return toast("That is not a web link", true);
    cur.links.push(makeLink(url, c.name || (c.service + " folder"), P.me.user ? P.me.user.name : ""));
    inp.value = "";
    paintLinks();
  };
  form.querySelector(".pj-addlink").onclick = addLink;
  form.querySelector(".pj-link").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addLink(); } };
  form.querySelector(".pj-links-ed").onclick = (ev) => {
    const b = ev.target.closest("[data-remove]");
    if (b) { cur.links = cur.links.filter((l) => l.id !== b.dataset.remove); paintLinks(); }
  };
  const f = await done;
  if (!f) return;
  try {
    const r = await api("/api/registry", { method: "POST", body: JSON.stringify({
      id: p ? p.id : undefined, name: f.name.value, code: f.code.value, short: f.short.value, team: f.team.value,
      status: f.status.value, viewer: f.viewer.value, notes: f.notes.value, owners: cur.owners, links: cur.links }) });
    P.open = r.id;
    await load();
  } catch (e) { toast(e.message, true); }
}

async function importFile() {
  const f = await modal("Import projects", `<p class="muted" style="font-size:12px">From Lark Base: open the Projects table, ... &rarr; Export &rarr; Excel. Or any sheet with the columns
    <b>Project</b>, Owner, Group (team), Project Folder, Status (and optionally Code, Viewer). A project already here (same name) is updated. "HKA-P-01681-ARC - SKW" is split into code and short name, and groups called SKW in the task lists are linked to it.</p>
    <input type="file" name="file" accept=".xlsx,.csv" required>`, "Import");
  if (!f || !f.file.files[0]) return;
  const file = f.file.files[0];
  const body = {};
  if (/\.xlsx$/i.test(file.name)) {
    body.xlsx = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(file); });
  } else body.csv = await file.text();
  try {
    const r = await api("/api/registry/import", { method: "POST", body: JSON.stringify(body) });
    toast(`${r.imported} projects imported` + (r.unmatched.length ? ` - no account yet for ${r.unmatched.join(", ")}` : ""));
    await load();
  } catch (e) { toast(e.message, true); }
}

async function start() {
  const me = await ensureSignedIn();
  P.me = me;
  header(me);
  P.open = new URLSearchParams(location.search).get("p") || "";
  $("#pj-new").onclick = () => edit(null);
  $("#pj-import").onclick = importFile;
  $("#pj-q").oninput = (ev) => { P.q = ev.target.value; render(); };
  $("#pj-status").onchange = (ev) => { P.status = ev.target.value; render(); };
  $("#pj-team").onchange = (ev) => { P.team = ev.target.value; render(); };
  $("#t-view").onclick = (ev) => {
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest("tr[data-id]");
    if (tr) openDetail(tr.dataset.id);
  };
  await load();
  setInterval(() => { if (!document.hidden && !document.querySelector(".t-modal")) load().catch(() => {}); }, 60000);
}

start().catch((e) => { $("#t-view").innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`; });
