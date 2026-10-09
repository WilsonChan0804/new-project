/* Admin: who may open which project, like ACC's project Members page.
 *
 *   Projects and members   a project admin adds and removes people and
 *                          sets their role on the projects they manage
 *   People                 a site admin creates accounts, resets passwords,
 *                          deactivates leavers (signing them out everywhere)
 *   My account             everyone: change your own password
 *
 * New accounts get a temporary password shown ONCE on screen, to pass on
 * by Teams or phone; the person must change it at first sign-in. There is
 * no email yet - the service mailbox is part of the IT request.
 */


/* Which version of the viewer this browser is running - shown small beside
   the name, so "I can't see the new button" can be told apart from "the
   server still has the old files" at a glance. */
const LWK_VERSION = "2026-10-07a";
(function () {
  const b = document.querySelector(".brand");
  if (b && !b.querySelector(".ver")) {
    const s = document.createElement("small");
    s.className = "ver";
    s.textContent = LWK_VERSION.slice(5);
    b.title = "LWK Viewer " + LWK_VERSION;
    b.appendChild(s);
  }
})();
import { api, link, project, signOut } from "./nav.js";
import { avatar } from "./tasks-util.js";
import { foldSections } from "./panels.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ROLE_LABEL = { admin: "Project admin", publisher: "Publisher", member: "Member", viewer: "Viewer" };
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined,
  { day: "numeric", month: "short", year: "numeric" }) : "never");

const A = { me: null, projects: [], users: [], pid: "", members: [], regs: [], reg: "", part: "", regCreate: false };

/* A project's members: those of its viewer project when it has one (as
   before), otherwise the project's own list (tasks.py reg_members). */
async function memberList() {
  if (A.pid) return (await api(`/api/admin/projects/${encodeURIComponent(A.pid)}/members`)).members || [];
  const r = await api(`/api/registry/${encodeURIComponent(A.reg)}/members`);
  return r.members.map((m) => ({ id: m.uid, name: m.name, email: m.email, office: m.office, company: "", team: m.team,
    discipline: m.discipline, role: m.role, active: true }));
}
function memberPut(uid, role) {
  if (A.pid) return api(`/api/admin/projects/${encodeURIComponent(A.pid)}/members`, { method: "PUT", body: JSON.stringify({ user_id: uid, role }) });
  return api(`/api/registry/${encodeURIComponent(A.reg)}/members`, { method: "PUT", body: JSON.stringify({ uid, role }) });
}
function memberDel(uid) {
  if (A.pid) return api(`/api/admin/projects/${encodeURIComponent(A.pid)}/members/${uid}`, { method: "DELETE" });
  return api(`/api/registry/${encodeURIComponent(A.reg)}/members/${uid}`, { method: "DELETE" });
}

function msg(html, kind) {
  $("#a-msg").innerHTML = html ? `<div class="notice ${kind || ""}">${html}</div>` : "";
  if (html) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------------------------------------------------- invitation */

/* The invitation goes out from the admin's OWN mailbox: "Email invitation"
   opens Outlook (or the default mail app) with the message written, and
   the admin presses Send. That needs no mail server and no IT set-up, and
   the colleague sees it come from someone they know. When IT provides the
   service mailbox the server can send these itself. */

const ROLE_CAN = {
  admin: "manage who can open the project, and raise, edit and close any issue",
  publisher: "publish the drawings and the 3D model from Revit (LWK tab > Publish), and raise and update issues and comments",
  member: "raise issues and comments on the drawings and the 3D model, and update the ones you are given",
  viewer: "look at the drawings, the 3D model and every issue (read only)",
};

function invitation(user, pw, opts) {
  opts = opts || {};
  const p = opts.project ? A.projects.find((x) => x.id === opts.project) : null;
  const title = p ? p.title : "";
  const addr = location.origin + (opts.project ? "/?project=" + encodeURIComponent(opts.project) : "/");
  const first = (user.name || "").split(/\s+/)[0] || "there";
  const me = (A.me && A.me.user && A.me.user.name) || "";
  const lines = opts.reset ? [
    `Hi ${first},`,
    "",
    "Your password for the LWK Viewer has been reset.",
    "",
    `1. Open ${location.origin}/`,
    `2. Sign in with your email ${user.email} and this temporary password: ${pw}`,
    "3. Choose a new password of your own (at least 8 characters).",
  ] : [
    `Hi ${first},`,
    "",
    "You now have an account on the LWK Viewer, our web viewer for drawings, 3D models "
      + "and issues. Nothing to install: it works in Chrome, Edge or Safari, including on an iPad or iPhone.",
    "",
    title ? `Project: ${title}` : "",
    title ? `Your role: ${ROLE_LABEL[opts.role] || "Member"}`
      + ` - you can ${ROLE_CAN[opts.role] || ROLE_CAN.member}.` : "",
    title ? "" : null,
    "How to start",
    `1. Open ${addr}`,
    `2. Sign in with your email: ${user.email}`,
    `   Temporary password: ${pw}`,
    "3. You will be asked to choose your own password (at least 8 characters). "
      + "Put the temporary one in the first box.",
    "4. Pick the project at the top, then use Sheets for the drawings, 3D for the model "
      + "and Dashboard for the overview of issues.",
    "",
    "Tips",
    "- Sheets: choose a sheet on the left; draw with the tools at the top. Choose Issue "
      + "(instead of Comment) to raise something that needs an answer, with who it is for and a due date.",
    "- 3D: drag to orbit, right-drag to pan, scroll to zoom. The Walk button lets you walk "
      + "through at eye level.",
    "- Dashboard: what is open, overdue and due soon, and who holds what.",
    "",
    "This is a trial with sample projects, so please try anything and tell me what you think.",
  ];
  lines.push("", "Thanks,", me);
  const body = lines.filter((l) => l !== null).join("\r\n");
  const subject = opts.reset ? "LWK Viewer - your password was reset"
    : "LWK Viewer - your account" + (title ? " for " + title : "");
  return { subject, body, to: user.email };
}

function inviteButtons(inv) {
  const href = `mailto:${encodeURIComponent(inv.to)}?subject=${encodeURIComponent(inv.subject)}`
    + `&body=${encodeURIComponent(inv.body)}`;
  return `<div class="invite-actions">`
    + `<a class="btn" id="inv-mail" href="${href}">Email invitation</a>`
    + `<button id="inv-copy" class="ghost">Copy invitation</button>`
    + `<span class="muted">Opens your own Outlook with the message written - check it and press Send. `
    + `Or copy it into Teams.</span></div>`
    + `<details class="inv-preview"><summary>Show the message</summary><pre>${esc(inv.body)}</pre></details>`;
}

function wireInvite(inv) {
  const c = document.getElementById("inv-copy");
  if (c) {
    c.onclick = async () => {
      const text = "Subject: " + inv.subject + "\n\n" + inv.body.replace(/\r\n/g, "\n");
      try {
        await navigator.clipboard.writeText(text);
        c.textContent = "Copied";
      } catch (e) {
        const pre = document.querySelector(".inv-preview pre");
        document.querySelector(".inv-preview").open = true;
        const r = document.createRange(); r.selectNodeContents(pre);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        c.textContent = "Selected - press Ctrl+C";
      }
    };
  }
}

function tempNotice(user, pw, opts) {
  const inv = invitation(user, pw, opts);
  msg(`Account created for <b>${esc(user.name)}</b> (${esc(user.email)}).<br>`
    + `Temporary password: <code>${esc(pw)}</code> - it is not shown again, so send the `
    + `invitation now. They choose their own password at first sign-in.`
    + inviteButtons(inv), "ok");
  wireInvite(inv);
}

/* ------------------------------------------------------------ sign-in */

async function signedIn() {
  try { return await api("/api/me"); } catch (e) { if (e.status !== 401) throw e; }
  $("#gate-back").hidden = false;
  try { $("#gate-name").value = localStorage.getItem("lwk-viewer:email") || ""; } catch (e) {}
  await new Promise((resolve) => {
    const go = async () => {
      $("#gate-msg").textContent = "Signing in ...";
      try {
        const res = await fetch("/api/login", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#gate-name").value.trim(), passphrase: $("#gate-pass").value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Sign-in failed");
        localStorage.setItem("lwk-viewer:token", data.token);
        localStorage.setItem("lwk-viewer:email", $("#gate-name").value.trim());
        $("#gate-back").hidden = true;
        resolve();
      } catch (e) { $("#gate-msg").textContent = e.message; }
    };
    $("#gate-go").onclick = go;
    $("#gate-pass").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
  });
  return api("/api/me");
}

/* ---------------------------------------------------------------- tabs */

function show(tab) {
  for (const t of ["projects", "people", "publish", "devices", "account"]) {
    $("#pane-" + t).hidden = t !== tab;
    $("#tab-" + t).classList.toggle("on", t === tab);
  }
  history.replaceState(null, "", location.pathname + location.search + "#" + tab);
}

/* ------------------------------------------------------------ projects */

async function loadProjects() {
  const [data, reg] = await Promise.all([
    api("/api/admin/projects"),
    api("/api/registry").catch(() => ({ projects: [], can_create: false })),
  ]);
  A.projects = data.projects || [];
  A.regs = (reg.projects || []).filter((r) => r.can_edit);
  A.regCreate = !!reg.can_create;
  $("#a-reg-tools").hidden = !A.regCreate;
  if ($("#a-ifc-new")) $("#a-ifc-new").hidden = !(A.me && A.me.site_admin);
  const ul = $("#a-projects");
  if (!A.regs.length) {
    ul.innerHTML = `<li class="empty">You do not manage any project.</li>`;
    $("#a-proj-title").textContent = "Members";
    $("#a-reg").hidden = true;
    A.pid = null; A.reg = "";
    return;
  }
  if (!A.regs.find((r) => r.id === A.reg)) {
    const want = A.pid || project();
    const hit = A.regs.find((r) => r.viewer && r.viewer === want);
    A.reg = (hit || A.regs[0]).id;
  }
  const cur = A.regs.find((r) => r.id === A.reg);
  // a project of several models: one part at a time below (members, Teams, layers)
  const parts = (cur.viewers || []).filter((v) => A.projects.find((p) => p.id === v));
  A.pid = parts.includes(A.part) ? A.part : parts[0] || null;
  const pw = $("#a-part-wrap");
  pw.hidden = parts.length < 2;
  const ttl = (v) => ((A.allViewer || []).find((x) => x.id === v) || A.projects.find((x) => x.id === v) || { title: v }).title;
  $("#a-part").innerHTML = parts.map((v) => `<option value="${esc(v)}"${v === A.pid ? " selected" : ""}>${esc(ttl(v))}</option>`).join("");
  $("#a-part").onchange = (ev) => { A.part = ev.target.value; A.pid = ev.target.value; loadMembers(); };
  ul.innerHTML = A.regs.map((r) => `<li data-reg="${esc(r.id)}" class="${r.id === A.reg ? "on" : ""}">`
    + `<span>${esc(r.short || r.name)}<div class="sub">${esc(r.code || r.name)}`
    + ((r.parts || []).length ? ` · ${esc(r.parts.map((x) => x.title).join(", "))}` : ` · <span class="nm">no model yet</span>`) + `</div></span>`
    + `<span class="pill" title="Members">${r.members.length}</span></li>`).join("");
  ul.querySelectorAll("li[data-reg]").forEach((li) => {
    li.onclick = () => { A.reg = li.dataset.reg; A.pid = null; A.part = ""; loadProjects().then(loadMembers); };
  });
  fillReg(cur);
}

/* ------------------------------------------------------------ project details */

let REG_LINKS = [];
function fillReg(r) {
  $("#a-reg").hidden = !r;
  if (!r) return;
  $("#a-reg-title").textContent = r.id ? "Project details" : "New project";
  $("#r-name").value = r.name || "";
  $("#r-code").value = r.code || "";
  $("#r-short").value = r.short || "";
  $("#r-status").value = r.status || "Active";
  $("#r-team").value = r.team || "";
  const vs = A.allViewer || [];
  const mine = new Set(r.viewers || (r.viewer ? [r.viewer] : []));
  const holder = (v) => A.regs.find((x) => x.id !== r.id && (x.viewers || []).includes(v));
  $("#r-viewer").innerHTML = vs.map((v) => {
    const h = holder(v);
    return `<option value="${esc(v.id)}"${mine.has(v.id) ? " selected" : ""}>${esc(v.title)}${v.title !== v.id ? " (" + esc(v.id) + ")" : ""}`
      + `${h ? " - now in " + esc(h.short || h.name) : ""}</option>`;
  }).join("") + [...mine].filter((v) => !vs.some((x) => x.id === v)).map((v) => `<option value="${esc(v)}" selected>${esc(v)}</option>`).join("");
  const owners = new Set((r.owners || []).map((o) => o.uid));
  $("#r-owners").innerHTML = A.users.filter((u) => u.active).map((u) =>
    `<option value="${u.id}"${owners.has(u.id) ? " selected" : ""}>${esc(u.name)}${u.team ? " · " + esc(u.team) : ""}</option>`).join("");
  REG_LINKS = (r.links || []).slice();
  paintRegLinks();
  $("#r-notes").value = r.notes || "";
  $("#r-open").href = r.id ? "projects.html?p=" + encodeURIComponent(r.id) : "projects.html";
  $("#r-open").hidden = !r.id;
  $("#r-del").hidden = !(r.id && A.me.site_admin);
  A.editing = r;
}

function paintRegLinks() {
  $("#r-links").innerHTML = REG_LINKS.map((l) => `<span class="fl-chip">${esc(l.title || l.url)}`
    + `<button type="button" class="ghost fl-x" data-i="${REG_LINKS.indexOf(l)}" title="Remove">&#10005;</button></span>`).join("")
    || `<span class="muted" style="font-size:12px">None yet.</span>`;
}

function wireRegistry() {
  $("#r-link-add").onclick = () => {
    const url = $("#r-link").value.trim();
    if (!/^https?:\/\//i.test(url)) { msg("A link starts with https://", "bad"); return; }
    let title = "";
    try { title = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || ""); } catch (e) {}
    title = prompt("A name for this link", title && !/^[:a-z]$/i.test(title) ? title : "Project folder") || "Project folder";
    REG_LINKS.push({ kind: "url", url, title });
    $("#r-link").value = "";
    paintRegLinks();
  };
  $("#r-links").onclick = (ev) => {
    const b = ev.target.closest("[data-i]");
    if (b) { REG_LINKS.splice(Number(b.dataset.i), 1); paintRegLinks(); }
  };
  $("#r-save").onclick = async () => {
    const r = A.editing || {};
    const owners = [...$("#r-owners").selectedOptions].map((o) => ({ uid: Number(o.value), name: o.textContent.split(" · ")[0] }));
    try {
      const out = await api("/api/registry", { method: "POST", body: JSON.stringify({
        id: r.id || undefined, name: $("#r-name").value, code: $("#r-code").value, short: $("#r-short").value,
        status: $("#r-status").value, team: $("#r-team").value, viewers: [...$("#r-viewer").selectedOptions].map((o) => o.value),
        owners, links: REG_LINKS, notes: $("#r-notes").value }) });
      msg(r.id ? "Project saved." : "Project added - now add its members below.", "ok");
      A.reg = out.id; A.pid = null;
      await loadProjects(); await loadMembers();
    } catch (e) { msg(esc(e.message), "bad"); }
  };
  $("#r-del").onclick = async () => {
    const r = A.editing;
    if (!r || !confirm(`Take ${r.short || r.name} off the Projects page?\n\nIts model and sheets, issues, tasks and files are not touched.`
      + (r.viewer ? "\n\nNote: while its viewer project exists it comes back on its own - delete the viewer project (below) to remove both." : ""))) return;
    try { await api("/api/registry/" + encodeURIComponent(r.id), { method: "DELETE" }); A.reg = ""; await loadProjects(); await loadMembers(); }
    catch (e) { msg(esc(e.message), "bad"); }
  };
  $("#a-reg-new").onclick = () => {
    A.reg = "";
    for (const li of document.querySelectorAll("#a-projects li")) li.classList.remove("on");
    fillReg({ name: "", status: "Active", owners: [{ uid: A.me.user.id }], links: [] });
    $("#a-members").innerHTML = "";
    $("#a-proj-title").textContent = "Members - save the project first";
    $("#a-viewer-only").hidden = true;
    $("#r-name").focus();
  };
  $("#a-reg-import").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".xlsx,.csv";
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      const body = {};
      if (/\.xlsx$/i.test(file.name)) {
        body.xlsx = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(file); });
      } else body.csv = await file.text();
      try {
        const r = await api("/api/registry/import", { method: "POST", body: JSON.stringify(body) });
        msg(`${r.imported} projects imported.` + (r.unmatched.length ? ` No account yet for: ${esc(r.unmatched.join(", "))}.` : ""), "ok");
        await loadProjects(); await loadMembers();
      } catch (e) { msg(esc(e.message), "bad"); }
    };
    inp.click();
  };
}

/* ------------------------------------------------------------ devices */

const EVENT_LABEL = { loaded: "loaded", leave: "left", hidden: "put away", crash: "crash",
  "context-lost": "3D lost", "gone-in-background": "closed in background" };
const isPhone = (r) => r.device && /iPhone|iPad|Android/.test(r.device.kind || "");
const isBad = (r) => r.event === "crash" || r.event === "context-lost";

const fmtDT = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || "") :
  d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " "
  + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };

async function loadDevices() {
  try {
    A.reports = (await api("/api/admin/telemetry?limit=600")).reports || [];
  } catch (e) { A.reports = []; msg(esc(e.message), "bad"); }
  renderDevices();
}

function renderDevices() {
  const all = A.reports || [];
  const f = $("#d-filter").value;
  const rows = all.filter((r) => f === "crash" ? isBad(r) : f === "phone" ? isPhone(r) : true);
  // per kind of device: how many pages, how many crashed, the memory they reached
  const by = new Map();
  for (const r of all) {
    const k = (r.device && r.device.kind) || "unknown";
    const g = by.get(k) || { n: 0, bad: 0, mem: [] };
    g.n++;
    if (isBad(r)) g.bad++;
    if (r.peak && r.peak.gpuMB) g.mem.push(r.peak.gpuMB);
    by.set(k, g);
  }
  const med = (a) => { if (!a.length) return "-"; const s = a.slice().sort((x, y) => x - y); return Math.round(s[s.length >> 1]) + " MB"; };
  $("#d-summary").innerHTML = [...by.entries()].map(([k, g]) =>
    `<div class="dev-tile"><b>${esc(k)}</b><span>${g.n} report${g.n === 1 ? "" : "s"}</span>`
    + `<span class="${g.bad ? "bad" : ""}">${g.bad} crash${g.bad === 1 ? "" : "es"}</span>`
    + `<span>typical memory ${med(g.mem)}</span></div>`).join("")
    || `<p class="muted">No reports yet - they arrive as people open the 3D view.</p>`;
  const t = $("#d-table");
  t.innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Device</th><th>Project</th><th>What</th>`
    + `<th>Memory (peak)</th><th>Triangles</th><th>Moving</th><th>Stalls</th><th>Models</th></tr></thead><tbody>`
    + rows.slice(0, 400).map((r, i) => {
      const d = r.device || {};
      const p = r.peak || {};
      const mv = r.moving ? `${r.moving.fps_median} fps <span class="sub">worst ${r.moving.fps_worst10}</span>` : "-";
      const models = ((r.now && r.now.models) || []).map((m) => m.how).filter(Boolean);
      const how = [...new Set(models)].join(", ");
      return `<tr data-i="${all.indexOf(r)}" class="${isBad(r) ? "bad-row" : ""}">`
        + `<td>${esc(fmtDT(r.at || r.received))}</td><td>${esc(r.user || "")}</td>`
        + `<td>${esc(d.kind || "")} <span class="sub">${esc([d.browser, d.os].filter(Boolean).join(" "))}</span></td>`
        + `<td>${esc(r.project || "")}</td><td>${esc(EVENT_LABEL[r.event] || r.event || "")}`
        // a crash: how long the page had been open and what it was doing
        + (isBad(r) && (r.up_s != null || (r.extra && r.extra.stage))
          ? ` <span class="sub">${r.up_s != null ? "after " + r.up_s + " s" : ""}${r.extra && r.extra.stage ? " - " + esc(r.extra.stage) : ""}</span>` : "")
        + `</td>`
        + `<td>${p.gpuMB ? Math.round(p.gpuMB) + " MB" : "-"}</td>`
        + `<td>${p.tris ? (p.tris / 1e6).toFixed(2) + " M" : "-"}</td><td>${mv}</td>`
        + `<td>${r.stalls || 0}${r.worst_stall_ms ? ` <span class="sub">${(r.worst_stall_ms / 1000).toFixed(1)} s</span>` : ""}</td>`
        + `<td>${esc(how)}</td></tr>`;
    }).join("") + `</tbody>`;
  t.querySelectorAll("tr[data-i]").forEach((tr) => {
    tr.onclick = () => {
      const pre = $("#d-detail");
      pre.hidden = false;
      pre.textContent = JSON.stringify(all[+tr.dataset.i], null, 1);
      pre.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
  });
}

/* ------------------------------------------------------ auto publish */

/* Every PC's publish settings, as reported to the server: one place to see
   who publishes what and to spot a model that is published twice. */
async function loadPublishJobs() {
  let jobs = [];
  try { jobs = (await api("/api/publish-jobs")).jobs || []; }
  catch (e) { msg(esc(e.message), "bad"); }
  A.publishJobs = jobs;
  const sel = $("#pj-project"), cur = sel.value;
  const names = Array.from(new Set(jobs.map((j) => j.project))).sort();
  sel.innerHTML = `<option value="">All my projects</option>` + names.map((n) => `<option>${esc(n)}</option>`).join("");
  if (names.includes(cur)) sel.value = cur;
  renderPublishJobs();
}

function renderPublishJobs() {
  const all = A.publishJobs || [];
  const p = $("#pj-project").value, f = $("#pj-filter").value;
  const rows = all.filter((j) => (!p || j.project === p) && (f === "night" ? j.nightly : f === "dup" ? j.duplicate : true));
  const dups = all.filter((j) => j.duplicate).length;
  $("#pj-count").innerHTML = `${rows.length} of ${all.length}`
    + (dups ? ` - <span class="pill bad">${dups} line(s): same model published at night from more than one PC</span>` : "");
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const t = $("#pj-table");
  if (!rows.length) {
    t.innerHTML = `<tr><td class="muted">${all.length ? "Nothing matches." : "No PC has reported any publish settings yet - they appear after the next Publish, night export or Save settings in Revit (extension 2026-10-03a or later)."}</td></tr>`;
    return;
  }
  t.innerHTML = `<thead><tr><th>Viewer project</th><th>Revit file</th><th>PC / Windows user</th><th>Set by</th>`
    + `<th>Night export</th><th>Sends</th><th>Last run</th><th></th></tr></thead><tbody>`
    + rows.map((j) => `<tr class="${j.duplicate ? "bad-row" : ""}" data-key="${esc(j.key)}">`
      + `<td>${esc(j.project || "")}</td>`
      + `<td><b>${esc(j.source || "")}</b>${j.adds_to_project === true || j.adds_to_project === "True" ? '<div class="sub">adds its sheets to the project</div>' : ""}</td>`
      + `<td>${esc(j.pc || "?")}<div class="sub">${esc(j.user || "")}</div></td>`
      + `<td>${esc(j.saved_by || j.last_by || "")}<div class="sub">${esc(when(j.saved_at))}</div></td>`
      + `<td>${j.nightly ? `<span class="pill ${j.duplicate ? "bad" : "ok"}">on</span> ${esc(j.night_time || "")} <span class="sub">${esc(j.night_days || "")}</span>`
                         : `<span class="pill off">off</span>`}`
      + `${j.duplicate ? '<div class="sub"><b>published twice at night</b></div>' : ""}</td>`
      + `<td>${esc(j.sheets || "")}<div class="sub">${esc(j.model_3d || "")}</div></td>`
      + `<td>${j.last_run_at ? esc(when(j.last_run_at)) + (j.last_ok === false ? ' <span class="pill bad">errors</span>' : ' <span class="pill ok">ok</span>')
                             + (j.last_how ? `<div class="sub">${esc(j.last_how)}</div>` : "") : '<span class="sub">not run yet</span>'}</td>`
      + `<td><button class="ghost pj-forget" title="Remove this line (the PC reports again if it still has the job)">Take off the list</button></td></tr>`
      + (j.folder ? "" : "")).join("") + `</tbody>`;
  t.querySelectorAll(".pj-forget").forEach((b) => {
    b.onclick = async () => {
      const key = b.closest("tr").dataset.key;
      const j = all.find((x) => x.key === key) || {};
      if (!confirm(`Take "${j.source}" (${j.pc} / ${j.user}) off the list?\n\nThis does not stop that PC: if it still has `
        + "the model set up, it reports it again at its next run. To stop it, switch it off in Revit on that PC.")) return;
      try { await api("/api/publish-jobs?key=" + encodeURIComponent(key), { method: "DELETE" }); msg("Taken off the list.", "ok"); }
      catch (e) { msg(esc(e.message), "bad"); }
      loadPublishJobs();
    };
  });
}

/* ------------------------------------------------ delete and restore */

const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.max(1, Math.round(b / 1e6)) + " MB";

async function loadBin() {
  const wrap = $("#a-bin-wrap");
  if (!A.me || !A.me.site_admin) { wrap.hidden = true; return; }
  let list = [];
  try { list = (await api("/api/admin/deleted-projects")).deleted || []; } catch (e) { list = []; }
  wrap.hidden = !list.length;
  $("#a-bin").innerHTML = list.map((d) => `<li data-bin="${esc(d.bin)}">`
    + `<span>${esc(d.project)}<div class="sub">deleted ${esc(fmtWhen(d.deleted_at))}`
    + `${d.deleted_by ? " by " + esc(d.deleted_by) : ""} - ${fmtSize(d.size)}</div></span>`
    + (d.taken ? `<span class="pill off" title="A project with this name exists again">name in use</span>`
               : `<button class="ghost restore">Restore</button>`) + `</li>`).join("");
  $("#a-bin").querySelectorAll("li[data-bin] .restore").forEach((b) => {
    b.onclick = async () => {
      const name = b.closest("li").dataset.bin;
      const d = list.find((x) => x.bin === name);
      if (!confirm(`Restore ${d.project} with its issues, markups and members?`)) return;
      try {
        await api(`/api/admin/deleted-projects/${encodeURIComponent(name)}/restore`, { method: "POST" });
        msg(`${esc(d.project)} is back.`, "ok");
        A.pid = d.project; A.reg = "";
      } catch (e) { msg(esc(e.message), "bad"); }
      await loadProjects(); await loadMembers(); await loadBin();
    };
  });
}
/* Task lists (Tasks page): all of them, for a site admin - and back from
   the bin when one was deleted by mistake. */
async function loadTaskLists() {
  const wrap = $("#a-tl-wrap");
  if (!A.me || !A.me.site_admin) { wrap.hidden = true; return; }
  let list = [];
  try { list = (await api("/api/admin/task-lists")).lists || []; } catch (e) { list = []; }
  wrap.hidden = !list.length;
  $("#a-tl").innerHTML = list.map((l) => `<li data-tl="${esc(l.id)}">`
    + `<span>${l.deleted ? esc(l.title) : `<a href="tasks.html?list=${encodeURIComponent(l.id)}">${esc(l.title)}</a>`}`
    + `<div class="sub">${esc(l.team || "")} ${l.tasks} tasks, ${l.members} members`
    + `${l.deleted ? " - deleted " + esc((l.updated_at || "").slice(0, 10)) + (l.updated_by ? " by " + esc(l.updated_by) : "") : ""}</div></span>`
    + (l.deleted ? `<button class="ghost restore">Restore</button>` : "") + `</li>`).join("");
  $("#a-tl").querySelectorAll(".restore").forEach((b) => {
    b.onclick = async () => {
      const id = b.closest("li").dataset.tl;
      try {
        await api(`/api/admin/task-lists/${encodeURIComponent(id)}/restore`, { method: "POST" });
        msg("The task list is back.", "ok");
      } catch (e) { msg(esc(e.message), "bad"); }
      loadTaskLists();
    };
  });
}

// "20260927-204800" -> "27 Sep 2026 20:48"
function fmtWhen(w) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(w || "");
  if (!m) return w || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    + " " + m[4] + ":" + m[5];
}

async function deleteProject() {
  const p = A.projects.find((x) => x.id === A.pid);
  if (!p) return;
  const typed = prompt(`Delete "${p.title}" for everyone?\n\n`
    + `Its models, sheets, ${p.id === p.title ? "" : "(" + p.id + ") "}issues, markups and members go to the bin `
    + `on the server and can be restored from this page.\n\nType the project name to confirm:\n${p.id}`);
  if (typed === null) return;
  if (typed.trim() !== p.id) { msg("The name did not match - nothing was deleted.", "bad"); return; }
  try {
    await api(`/api/admin/projects/${encodeURIComponent(p.id)}`,
      { method: "DELETE", body: JSON.stringify({ confirm: p.id }) });
    msg(`${esc(p.title)} deleted. It is in the bin (left) if you need it back.`, "ok");
    try { if (localStorage.getItem("lwk-viewer:project") === p.id) localStorage.removeItem("lwk-viewer:project"); } catch (e) {}
    A.pid = null;
  } catch (e) { msg(esc(e.message), "bad"); }
  await loadProjects(); await loadMembers(); await loadBin();
}

async function loadUsers() {
  try {
    A.users = (await api("/api/admin/users")).users || [];
  } catch (e) { A.users = []; }
}

async function loadMembers() {
  $("#a-viewer-only").hidden = !A.pid;
  $("#a-no-viewer").hidden = !!A.pid || !A.reg;
  if (!A.pid && !A.reg) { $("#a-members").innerHTML = ""; $("#a-danger").hidden = true; return; }
  const p = A.projects.find((x) => x.id === A.pid);
  const rg = A.regs.find((x) => x.id === A.reg);
  $("#a-proj-title").textContent = "Members of " + (rg ? rg.short || rg.name : p ? p.title : A.pid)
    + (rg && (rg.parts || []).length > 1 && p ? " - " + p.title : "");
  $("#a-danger").hidden = !(A.me && A.me.site_admin);
  A.members = await memberList();
  const t = $("#a-members");
  t.innerHTML = `<thead><tr><th>Name</th><th>Email</th><th>Office</th><th>Company</th><th>Team</th><th>Discipline</th><th>Role</th>`
    + `<th>Added</th><th></th></tr></thead><tbody>`
    + (A.members.length ? A.members.map((m) => `<tr data-id="${m.id}">`
      + `<td><span class="namecell">${avatar(m, 26)}<span class="nm-t">${esc(m.name)}${m.active ? "" : ' <span class="pill off">inactive</span>'}</span></span></td>`
      + `<td>${esc(m.email)}</td><td>${esc(m.office)}</td><td>${esc(m.company)}</td>`
      + `<td><input class="cell-team" list="dl-team" value="${esc(m.team || "")}" placeholder="-" title="Team - pick or type"></td>`
      + `<td><input class="cell-disc" list="dl-disc" value="${esc(m.discipline || "")}" placeholder="-" title="Discipline - pick or type"></td>`
      + `<td><select class="role">${Object.entries(ROLE_LABEL).map(([k, v]) =>
        `<option value="${k}"${k === m.role ? " selected" : ""}>${v}</option>`).join("")}</select></td>`
      + `<td>${fmt(m.added_at)}${m.added_by ? `<div class="sub">by ${esc(m.added_by)}</div>` : ""}</td>`
      + `<td><button class="ghost rm">Remove</button></td></tr>`).join("")
      : `<tr><td colspan="9" class="empty">Nobody yet - add people below.</td></tr>`)
    + `</tbody>`;
  t.querySelectorAll("tr[data-id]").forEach((tr) => {
    const uid = +tr.dataset.id;
    // team and discipline: saved as soon as they are changed
    for (const [cls, key] of [[".cell-team", "team"], [".cell-disc", "discipline"]]) {
      const inp = tr.querySelector(cls);
      inp.onchange = async () => {
        try {
          await api(`/api/admin/users/${uid}`, { method: "PATCH", body: JSON.stringify({ [key]: inp.value.trim() }) });
          msg("Saved.", "ok");
        } catch (err) { msg(esc(err.message), "bad"); }
      };
    }
    tr.querySelector(".role").onchange = async (e) => {
      try {
        await memberPut(uid, e.target.value);
        msg("Role changed.", "ok");
      } catch (err) { msg(esc(err.message), "bad"); }
      await loadMembers();
    };
    tr.querySelector(".rm").onclick = async () => {
      const m = A.members.find((x) => x.id === uid);
      if (!confirm(`Remove ${m.name} from this project? Their issues and comments stay.`)) return;
      try {
        await memberDel(uid);
        msg(`${esc(m.name)} removed from the project.`, "ok");
      } catch (err) { msg(esc(err.message), "bad"); }
      await loadProjects(); await loadMembers();
    };
  });
  try {
    const st = await api(`/api/admin/projects/${encodeURIComponent(A.pid)}/settings`);
    $("#t-hook").value = st.teams_webhook || "";
    if ($("#t-dhour") && !$("#t-dhour").options.length) {
      $("#t-dhour").innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("");
    }
    if ($("#t-dday")) { $("#t-dday").value = st.digest_day || "mon"; $("#t-dhour").value = String(st.digest_hour ?? 9); }
  } catch (e) { $("#t-hook").value = ""; }
  loadLayersAdmin().catch((e) => { $("#a-layers").innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
  const inIt = new Set(A.members.map((m) => m.id));
  ADD.free = A.users.filter((u) => u.active && !inIt.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const id of [...ADD.sel]) if (!ADD.free.some((u) => u.id === id)) ADD.sel.delete(id);
  fillAddFilters();
  paintAdd();
}

/* ------------------------------------------------ adding several people */

/* Who can be added: everyone with an account not yet in the project.
   Search, narrow by team / office / company, tick several, one role. */
const ADD = { free: [], sel: new Set() };

function fillAddFilters() {
  for (const [id, key, all] of [["#a-add-team", "team", "All teams"], ["#a-add-office", "office", "All offices"],
    ["#a-add-company", "company", "All companies"]]) {
    const el = $(id);
    if (!el) continue;
    const cur = el.value;
    const vals = [...new Set(ADD.free.map((u) => (u[key] || "").trim()).filter(Boolean))].sort();
    el.innerHTML = `<option value="">${all}</option>` + vals.map((v) => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
    el.hidden = !vals.length;
  }
}

function addShown() {
  const q = ($("#a-add-q").value || "").trim().toLowerCase();
  const f = { team: $("#a-add-team").value, office: $("#a-add-office").value, company: $("#a-add-company").value };
  return ADD.free.filter((u) => (!q || (u.name + " " + u.email + " " + (u.team || "")).toLowerCase().includes(q))
    && Object.entries(f).every(([k, v]) => !v || (u[k] || "").trim() === v));
}

function paintAdd() {
  const shown = addShown();
  const box = $("#a-add-list");
  box.innerHTML = !ADD.free.length ? `<div class="addp-empty">Everyone with an account already has access.</div>`
    : !shown.length ? `<div class="addp-empty">Nobody matches - change the search or the filters.</div>`
      : shown.map((u) => `<label class="addp-row${ADD.sel.has(u.id) ? " on" : ""}" data-id="${u.id}">`
        + `<input type="checkbox"${ADD.sel.has(u.id) ? " checked" : ""}>${avatar(u, 28)}`
        + `<span class="who"><b>${esc(u.name)}</b><small>${esc([u.team, u.office, u.company, u.email].filter(Boolean).join(" · "))}</small></span></label>`).join("");
  const n = ADD.sel.size;
  $("#a-add-n").textContent = n ? `${n} chosen` : `${shown.length} shown`;
  $("#a-add-go").textContent = n > 1 ? `Add ${n} people` : "Add";
  $("#a-add-go").disabled = !n;
}

function wireAdd() {
  for (const id of ["#a-add-q", "#a-add-team", "#a-add-office", "#a-add-company"]) $(id).addEventListener("input", paintAdd);
  $("#a-add-list").addEventListener("change", (ev) => {
    const row = ev.target.closest(".addp-row");
    if (!row) return;
    const id = +row.dataset.id;
    if (ev.target.checked) ADD.sel.add(id); else ADD.sel.delete(id);
    paintAdd();
  });
  $("#a-add-all").onclick = () => { for (const u of addShown()) ADD.sel.add(u.id); paintAdd(); };
  $("#a-add-none").onclick = () => { ADD.sel.clear(); paintAdd(); };
}

async function prepLog() {
  const out = $("#a-prep-out");
  try {
    const r = await api("/api/admin/background");
    const txt = (l) => (typeof l === "string" ? l : JSON.stringify(l));
    const mine = (r.log || []).filter((l) => txt(l).indexOf(A.pid + ":") >= 0);
    out.hidden = false;
    out.textContent = (r.node ? "" : "Node.js is not installed on the server - nothing can be prepared there.\n")
      + (r.pending && r.pending.length ? "Working on: " + r.pending.join(", ") + "\n\n" : "Nothing waiting.\n\n")
      + (mine.length ? mine.map(txt).join("\n")
         : "No work logged for this project since the server started.");
  } catch (e) { out.hidden = false; out.textContent = e.message; }
}

function wireProjects() {
  $("#a-del").onclick = deleteProject;
  /* A consultant's IFC as a 3D project of its own (refs.py, case 3): a
     standalone reference, converted on the server. */
  const ifcB = $("#a-ifc-new"), ifcF = $("#a-ifc-file");
  if (ifcB && ifcF) {
    ifcB.onclick = () => ifcF.click();
    ifcF.onchange = async () => {
      const f = ifcF.files[0];
      ifcF.value = "";
      if (!f) return;
      const stem = f.name.replace(/\.ifc$/i, "");
      const id = prompt("A short id for the new 3D project (letters, digits, - and _), e.g. SKW-STR:", stem.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 30));
      if (!id) return;
      const title = prompt("Its title (shown at the top of its 3D page):", stem) || id;
      msg(`Uploading ${esc(f.name)} ...`, "ok");
      try {
        const r = await api(`/api/admin/projects/from-ifc?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}&file=${encodeURIComponent(f.name)}`,
          { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
        msg(`Made <b>${esc(r.project)}</b>. The server is converting the model; <a href="model.html?project=${encodeURIComponent(r.project)}" target="_blank">open its 3D page</a> (it shows by itself when ready). Add its members as for any project; to show it with another project, use 3D > Models > + Overlay another project there.`, "ok");
      } catch (e) { msg(esc(e.message), "bad"); }
    };
  }
  $("#a-prep").onclick = async () => {
    try {
      const r = await api(`/api/admin/projects/${encodeURIComponent(A.pid)}/phone-copies`, { method: "POST" });
      msg(r.queued ? "Queued - the server prepares it in the background (a minute or more for a big model)."
        : "Already queued or running.", "ok");
      setTimeout(prepLog, 1500);
    } catch (e) { msg(esc(e.message), "bad"); }
  };
  $("#a-prep-log").onclick = prepLog;
  $("#t-save").onclick = async () => {
    try {
      await api(`/api/admin/projects/${encodeURIComponent(A.pid)}/settings`,
        { method: "PUT", body: JSON.stringify({ teams_webhook: $("#t-hook").value.trim(),
          digest_day: $("#t-dday") ? $("#t-dday").value : undefined,
          digest_hour: $("#t-dhour") ? Number($("#t-dhour").value) : undefined }) });
      msg($("#t-hook").value.trim() ? "Saved. Issue updates for this project now go to that channel."
        : "Teams posting switched off for this project.", "ok");
    } catch (e) { msg(esc(e.message), "bad"); }
  };
  $("#t-test").onclick = async () => {
    try {
      await api(`/api/admin/projects/${encodeURIComponent(A.pid)}/teams-test`, { method: "POST" });
      msg("Test sent - it should appear in the channel within a few seconds.", "ok");
    } catch (e) { msg(esc(e.message), "bad"); }
  };
  wireAdd();
  $("#a-add-go").onclick = async () => {
    const ids = [...ADD.sel];
    if (!ids.length) return;
    const role = $("#a-add-role").value;
    const done = [], failed = [];
    $("#a-add-go").disabled = true;
    for (const uid of ids) {
      const u = A.users.find((x) => x.id === uid);
      try { await memberPut(uid, role); done.push(u); ADD.sel.delete(uid); }
      catch (e) { failed.push((u ? u.name : uid) + ": " + e.message); }
    }
    if (done.length) {
      const p = A.projects.find((x) => x.id === A.pid);
      const addr = location.origin + "/?project=" + encodeURIComponent(A.pid);
      const inv = { to: done.map((u) => u.email).filter(Boolean).join(","),
        subject: `LWK Viewer - you have been added to ${p ? p.title : A.pid}`,
        body: [done.length === 1 ? `Hi ${(done[0].name || "").split(/\s+/)[0]},` : "Hi all,", "",
          `You have been added to ${p ? p.title : A.pid} on the LWK Viewer as ${ROLE_LABEL[role]}`
          + ` - you can ${ROLE_CAN[role]}.`, "",
          `Open ${addr} and sign in with your usual email and password.`, "", "Thanks,",
          (A.me.user && A.me.user.name) || ""].join("\r\n") };
      msg((done.length === 1 ? esc(done[0].name) + " can" : `${done.length} people can`)
        + ` now open this project as ${ROLE_LABEL[role]}.`
        + (failed.length ? `<br>Not added: ${esc(failed.join("; "))}` : "") + inviteButtons(inv), failed.length ? "bad" : "ok");
      wireInvite(inv);
    } else if (failed.length) msg("Not added: " + esc(failed.join("; ")), "bad");
    await loadProjects(); await loadMembers();
  };
  $("#n-go").onclick = async () => {
    try {
      const r = await api("/api/admin/users", { method: "POST", body: JSON.stringify({
        email: $("#n-email").value, name: $("#n-name").value, office: $("#n-office").value,
        company: $("#n-company").value, team: $("#n-team").value.trim(), discipline: $("#n-disc").value.trim(),
        project: A.pid || undefined, role: $("#n-role").value }) });
      if (!A.pid && A.reg) await memberPut(r.user.id, $("#n-role").value);
      tempNotice(r.user, r.temp_password, { project: A.pid || "", role: $("#n-role").value });
      for (const id of ["#n-email", "#n-name", "#n-company"]) $(id).value = "";
      await loadUsers(); await loadProjects(); await loadMembers();
    } catch (e) { msg(esc(e.message), "bad"); }
  };
}

/* -------------------------------------------------------------- people */

/* Filters and the sort of the People table: kept while the page is open. */
const PF = { q: "", office: "", company: "", team: "", disc: "", status: "", sort: "name", dir: 1 };
const PF_COLS = [["name", "Name"], ["email", "Email"], ["office", "Office"], ["company", "Company"],
  ["team", "Team"], ["discipline", "Discipline"], ["projects", "Projects", "num"], ["last_login", "Last sign-in"]];

function peopleShown() {
  const q = PF.q.trim().toLowerCase();
  const same = (a, b) => String(a || "").trim().toLowerCase() === b.toLowerCase();
  const list = A.users.filter((u) => {
    if (q && ![u.name, u.email, u.office, u.company, u.team, u.discipline].some((v) => String(v || "").toLowerCase().includes(q))) return false;
    if (PF.office && !same(u.office, PF.office)) return false;
    if (PF.company && !same(u.company, PF.company)) return false;
    if (PF.team && !same(u.team, PF.team)) return false;
    if (PF.disc && !same(u.discipline, PF.disc)) return false;
    if (PF.status === "active" && !u.active) return false;
    if (PF.status === "off" && u.active) return false;
    if (PF.status === "admin" && !u.is_admin) return false;
    if (PF.status === "nopass" && !(u.must_change && u.active)) return false;
    return true;
  });
  const k = PF.sort, d = PF.dir;
  list.sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === "projects") return ((+x || 0) - (+y || 0)) * d || String(a.name).localeCompare(b.name);
    x = String(x || ""); y = String(y || "");
    // blanks last whichever way
    if (!x && y) return 1;
    if (x && !y) return -1;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) * d || String(a.name).localeCompare(b.name);
  });
  return list;
}

function fillPeopleFilters() {
  const opts = (id, key, all) => {
    const sel = $("#" + id);
    if (!sel) return;
    const vals = Array.from(new Set(A.users.map((u) => String(u[key] || "").trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    const cur = sel.value;
    sel.innerHTML = `<option value="">${all}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join("");
    sel.value = vals.indexOf(cur) >= 0 ? cur : "";
  };
  opts("pf-office", "office", "All offices");
  opts("pf-company", "company", "All companies");
  opts("pf-team", "team", "All teams");
  opts("pf-disc", "discipline", "All disciplines");
}

function wirePeopleFilters() {
  const bar = $("#pf-bar");
  if (!bar || bar.dataset.wired) return;
  bar.dataset.wired = "1";
  const map = { "pf-q": "q", "pf-office": "office", "pf-company": "company", "pf-team": "team", "pf-disc": "disc", "pf-status": "status" };
  for (const id in map) {
    const el = $("#" + id);
    el.addEventListener(id === "pf-q" ? "input" : "change", () => { PF[map[id]] = el.value; renderPeople(true); });
  }
  $("#pf-clear").onclick = () => {
    Object.assign(PF, { q: "", office: "", company: "", team: "", disc: "", status: "" });
    for (const id in map) $("#" + id).value = "";
    renderPeople(true);
  };
}

async function renderPeople(cached) {
  if (cached !== true || !A.users) await loadUsers();
  wirePeopleFilters();
  fillPeopleFilters();
  const t = $("#a-people");
  const shown = peopleShown();
  const cnt = $("#pf-count");
  if (cnt) cnt.textContent = shown.length === A.users.length ? `${A.users.length} people` : `${shown.length} of ${A.users.length} people`;
  const head = PF_COLS.map(([k, label, cls]) => `<th class="sortable${cls ? " " + cls : ""}${PF.sort === k ? " sorted" : ""}" data-k="${k}"`
    + ` title="Sort by ${label.toLowerCase()}">${label}${PF.sort === k ? (PF.dir > 0 ? " \u25B2" : " \u25BC") : ""}</th>`).join("");
  t.innerHTML = `<thead><tr>${head}<th></th></tr></thead><tbody>`
    + (shown.length ? "" : `<tr><td colspan="9" class="empty">Nobody matches these filters.</td></tr>`)
    + shown.map((u) => `<tr data-id="${u.id}">`
      + `<td><span class="namecell">${avatar(u, 28)}<span class="nm-t">${esc(u.name)} ${u.is_admin ? '<span class="pill admin">site admin</span>' : ""}`
      + `${u.active ? "" : '<span class="pill off">deactivated</span>'}`
      + `${u.must_change && u.active ? '<div class="sub">has not set a password yet</div>' : ""}</span></span></td>`
      + `<td>${esc(u.email)}</td><td>${esc(u.office)}</td><td>${esc(u.company)}</td>`
      + `<td>${esc(u.team || "")}</td><td>${esc(u.discipline || "")}</td>`
      + `<td class="num">${u.projects}</td><td>${fmt(u.last_login)}</td>`
      + `<td style="white-space:nowrap">`
      + `<button class="ghost reset" title="Give them a new temporary password">Reset password</button>`
      + `<button class="ghost adm">${u.is_admin ? "Remove site admin" : "Make site admin"}</button>`
      + `<button class="ghost act">${u.active ? "Deactivate" : "Reactivate"}</button>`
      + `<button class="ghost edit" title="Correct the name, email, office or company">Edit</button>`
      + (u.id === A.me.user.id ? "" : `<button class="ghost danger del" title="For an account made by mistake">Delete</button>`)
      + `</td></tr>`).join("")
    + `</tbody>`;
  t.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (PF.sort === k) PF.dir = -PF.dir;
    else { PF.sort = k; PF.dir = k === "last_login" || k === "projects" ? -1 : 1; }
    renderPeople(true);
  }));
  t.querySelectorAll("tr[data-id]").forEach((tr) => {
    const u = A.users.find((x) => x.id === +tr.dataset.id);
    const patch = async (body, done) => {
      try {
        await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
        msg(done, "ok");
      } catch (e) { msg(esc(e.message), "bad"); }
      renderPeople();
    };
    tr.querySelector(".reset").onclick = async () => {
      if (!confirm(`Give ${u.name} a new temporary password? Their current one stops working.`)) return;
      try {
        const r = await api(`/api/admin/users/${u.id}/reset`, { method: "POST" });
        const inv = invitation(u, r.temp_password, { reset: true });
        msg(`New temporary password for <b>${esc(u.name)}</b>: <code>${esc(r.temp_password)}</code>`
          + ` - not shown again.` + inviteButtons(inv), "ok");
        wireInvite(inv);
      } catch (e) { msg(esc(e.message), "bad"); }
      renderPeople();
    };
    tr.querySelector(".adm").onclick = () => {
      if (!confirm(u.is_admin ? `Remove ${u.name}'s site admin rights?`
        : `Make ${u.name} a site admin? They will be able to open every project and manage every account.`)) return;
      patch({ is_admin: !u.is_admin }, "Updated.");
    };
    tr.querySelector(".edit").onclick = async () => {
      const name = prompt("Name", u.name); if (name === null) return;
      const email = prompt("Email", u.email); if (email === null) return;
      const office = prompt("Office (HK, Manila, UK ...)", u.office || ""); if (office === null) return;
      const company = prompt("Company", u.company || ""); if (company === null) return;
      const team = prompt("Team (Design team, Project team, Production team, BIM team ...)", u.team || ""); if (team === null) return;
      const discipline = prompt("Discipline (Architecture, Structure, MEP ...)", u.discipline || ""); if (discipline === null) return;
      patch({ name, email, office, company, team, discipline }, `${esc(name)} updated.`);
    };
    const del = tr.querySelector(".del");
    if (del) {
      del.onclick = async () => {
        if (!confirm(`Delete the account of ${u.name} (${u.email})?\n\nUse this for an account made by `
          + "mistake. Someone who has left is better deactivated, which keeps a record of who they were. "
          + "Their issues and comments stay either way.")) return;
        try {
          await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
          msg(`${esc(u.name)}'s account deleted.`, "ok");
        } catch (e) { msg(esc(e.message), "bad"); }
        renderPeople();
      };
    }
    tr.querySelector(".act").onclick = () => {
      if (u.active && !confirm(`Deactivate ${u.name}? They are signed out everywhere and cannot sign in. `
        + "Their issues and comments stay.")) return;
      patch({ active: !u.active }, u.active ? `${esc(u.name)} deactivated.` : `${esc(u.name)} reactivated.`);
    };
  });
}

/* Many accounts at once, pasted from a spreadsheet. Each new account's
   temporary password is shown once, and can be saved as a CSV to send the
   invitations from. */
function parseBulk(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = (line.indexOf("\t") >= 0 ? line.split("\t") : line.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (!/@/.test(cells[0] || "")) continue;          // heading or junk
    const [email, name, office, company, team, discipline, project, role] = cells;
    rows.push({ email, name: name || email.split("@")[0], office: office || "", company: company || "",
                team: team || "", discipline: discipline || "", project: project || "",
                role: (role || "member").toLowerCase().replace("project admin", "admin") });
  }
  return rows;
}

function wireBulk() {
  if (!$("#p-bulk-go")) return;
  let done = [];
  $("#p-bulk-go").onclick = async () => {
    const rows = parseBulk($("#p-bulk-text").value);
    if (!rows.length) { $("#p-bulk-note").textContent = "No lines with an email address."; return; }
    if (!confirm(`Add ${rows.length} people?`)) return;
    const findProject = (t) => {
      if (!t) return "";
      const k = t.toLowerCase();
      const p = (A.projects || []).find((x) => x.id.toLowerCase() === k || (x.title || "").toLowerCase() === k);
      return p ? p.id : null;
    };
    done = [];
    $("#p-bulk-go").disabled = true;
    for (const [k, r] of rows.entries()) {
      $("#p-bulk-note").textContent = `${k + 1} / ${rows.length} ...`;
      const out = { email: r.email, name: r.name, project: r.project, role: r.role, result: "", password: "" };
      done.push(out);
      const pid = findProject(r.project);
      if (pid === null) { out.result = "no such project: " + r.project; continue; }
      if (!["member", "viewer", "publisher", "admin"].includes(r.role)) r.role = "member";
      try {
        const res = await api("/api/admin/users", { method: "POST", body: JSON.stringify({
          email: r.email, name: r.name, office: r.office, company: r.company, team: r.team,
          discipline: r.discipline, project: pid, role: r.role, is_admin: false }) });
        out.result = "account made" + (pid ? ", added to " + pid : "");
        out.password = res.temp_password;
      } catch (e) {
        // already has an account: just the project
        try { A.users = (await api("/api/admin/users")).users || A.users; } catch (e3) {}
        const u = (A.users || []).find((x) => (x.email || "").toLowerCase() === r.email.toLowerCase());
        if (u && pid) {
          try {
            await api(`/api/admin/projects/${encodeURIComponent(pid)}/members`, { method: "PUT",
              body: JSON.stringify({ user_ids: [u.id], role: r.role }) });
            out.result = "already had an account - added to " + pid;
          } catch (e2) { out.result = e2.message; }
        } else out.result = u ? "already has an account" : e.message;
      }
    }
    $("#p-bulk-go").disabled = false;
    const made = done.filter((d) => d.password).length;
    $("#p-bulk-note").textContent = `${made} account(s) made, ${done.length - made} other line(s) - see below.`;
    $("#p-bulk-out").innerHTML = "<tr><th>Email</th><th>Name</th><th>Project</th><th>Role</th><th>Result</th><th>Temporary password</th></tr>"
      + done.map((d) => `<tr><td>${esc(d.email)}</td><td>${esc(d.name)}</td><td>${esc(d.project)}</td><td>${esc(d.role)}</td>`
        + `<td>${esc(d.result)}</td><td><code>${esc(d.password)}</code></td></tr>`).join("");
    $("#p-bulk-csv").hidden = !made;
    renderPeople();
  };
  $("#p-bulk-csv").onclick = () => {
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["Email", "Name", "Project", "Role", "Temporary password", "Sign in at"].map(q).join(",")]
      .concat(done.filter((d) => d.password).map((d) => [d.email, d.name, d.project, d.role, d.password, location.origin + "/"].map(q).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv" }));
    a.download = "lwk-viewer-new-accounts.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

function wirePeople() {
  wireBulk();
  $("#p-go").onclick = async () => {
    try {
      const r = await api("/api/admin/users", { method: "POST", body: JSON.stringify({
        email: $("#p-email").value, name: $("#p-name").value, office: $("#p-office").value,
        company: $("#p-company").value, team: $("#p-team").value.trim(), discipline: $("#p-disc").value.trim(),
        is_admin: $("#p-admin").checked }) });
      tempNotice(r.user, r.temp_password, {});
      for (const id of ["#p-email", "#p-name", "#p-company"]) $(id).value = "";
      $("#p-admin").checked = false;
      renderPeople();
    } catch (e) { msg(esc(e.message), "bad"); }
  };
}

/* ------------------------------------------------------------- account */

async function wireNotify() {
  const card = $("#acc-notify-card");
  if (!card || !A.me.user) return;
  let st;
  try { st = await api("/api/me/notify"); } catch (e) { return; }
  card.hidden = false;
  const box = $("#acc-email");
  box.checked = !st.email_off;
  box.disabled = !st.email_ready;
  $("#acc-email-note").textContent = st.email_ready
    ? `Sent to ${st.email}.`
    : "The server has no email account set yet, so only Teams mentions are sent. (A site admin adds LWK_SMTP_* to /etc/lwk-viewer.env.)";
  box.onchange = async () => {
    try { await api("/api/me/notify", { method: "POST", body: JSON.stringify({ email_off: !box.checked }) });
      msg(box.checked ? "Emails on." : "Emails off - Teams mentions still reach you.", "ok"); }
    catch (e) { msg(esc(e.message), "bad"); }
  };
  $("#acc-email-test-row").hidden = !A.me.site_admin;
  $("#acc-email-test").onclick = async () => {
    try { const r = await api("/api/admin/email-test", { method: "POST" }); msg(`Test email sent to ${esc(r.sent_to)}.`, "ok"); }
    catch (e) { msg(esc(e.message), "bad"); }
  };
}

function wireAccount() {
  wireNotify().catch(() => {});
  const u = A.me.user;
  $("#acc-who").innerHTML = u ? `<b>${esc(u.name)}</b> - ${esc(u.email)}${u.office ? " - " + esc(u.office) : ""}`
    : "This server uses a shared passphrase, not accounts.";
  $("#acc-go").onclick = async () => {
    if ($("#acc-new").value !== $("#acc-new2").value) { msg("The two new passwords are different.", "bad"); return; }
    try {
      const r = await api("/api/me/password", { method: "POST",
        body: JSON.stringify({ old: $("#acc-old").value, new: $("#acc-new").value }) });
      localStorage.setItem("lwk-viewer:token", r.token);
      for (const id of ["#acc-old", "#acc-new", "#acc-new2"]) $(id).value = "";
      const next = new URLSearchParams(location.search).get("next");
      if (next && next.startsWith("/")) {
        msg("Password set. Opening the viewer ...", "ok");
        setTimeout(() => { location.href = next; }, 800);
      } else {
        msg("Password changed. You stay signed in here; other devices need to sign in again.", "ok");
      }
    } catch (e) { msg(esc(e.message), "bad"); }
  };
}

/* ------------------------------------------------------------------ go */

async function main() {
  A.me = await signedIn();
  $("#a-who").textContent = A.me.user ? A.me.user.name : "";
  $("#a-signout").onclick = (ev) => { ev.preventDefault(); signOut(); };
  $("#to-sheets").href = link("index.html");
  $("#to-3d").href = link("model.html");
  if ($("#to-board")) $("#to-board").href = link("board.html");
  $("#to-dash").href = link("dashboard.html");
  if ($("#to-tasks")) $("#to-tasks").href = link("tasks.html");
  if ($("#to-projects")) $("#to-projects").href = link("projects.html");
  if ($("#to-chat")) $("#to-chat").href = link("messenger.html");
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => show(b.dataset.tab);
  $("#tab-publish").addEventListener("click", () => loadPublishJobs());
  $("#pj-reload").onclick = () => loadPublishJobs();
  $("#pj-project").onchange = () => renderPublishJobs();
  $("#pj-filter").onchange = () => renderPublishJobs();

  if (!A.me.accounts) {
    msg("This server uses one shared passphrase, so there are no accounts to manage. To switch on "
      + "accounts, create the first site admin on the server:<br><code>sudo -u lwk /opt/lwk-viewer/venv/bin/python "
      + "/opt/lwk-viewer/server/app.py --root /opt/lwk-viewer/exports --data /opt/lwk-viewer/data "
      + "--add-admin you@lwk.com --admin-name \"Your Name\"</code>", "");
    $("#tab-projects").hidden = true;
    show("account");
    wireAccount();
    return;
  }
  wireAccount();
  const first = new URLSearchParams(location.search).get("first");
  if (first || (A.me.user && A.me.user.must_change)) {
    for (const t of ["projects", "people", "devices", "publish"]) $("#tab-" + t).hidden = true;
    msg("Welcome. Please choose your own password to continue - the temporary one "
      + "goes in the first box.", "");
    show("account");
    return;
  }
  $("#tab-people").hidden = !A.me.site_admin;
  $("#tab-devices").hidden = !A.me.site_admin;
  $("#tab-devices").addEventListener("click", () => loadDevices());
  $("#d-reload").onclick = () => loadDevices();
  $("#d-filter").onchange = () => renderDevices();
  wireProjects();
  wireRegistry();
  A.reg = new URLSearchParams(location.search).get("reg") || "";
  wirePeople();
  try { A.allViewer = (await api("/api/projects")).projects || []; } catch (e) { A.allViewer = []; }
  await loadUsers();
  await loadProjects();
  await loadMembers();
  loadBin();
  loadTaskLists();
  const want = location.hash.replace("#", "");
  if (want === "people" && A.me.site_admin) { show("people"); renderPeople(); }
  else if (want === "devices" && A.me.site_admin) { show("devices"); loadDevices(); }
  else if (want === "publish") { show("publish"); loadPublishJobs(); }
  else if (want === "account") show("account");
  else show("projects");
  $("#tab-people").addEventListener("click", renderPeople);
  // the long sections fold (remembered on this device)
  foldSections(document.querySelectorAll(".pane .card h3"), "lwk-admin:fold",
    (h) => h.id || (h.textContent || "").trim().split(/\s+/).slice(0, 3).join(" "));
}

main().catch((e) => msg("Could not load: " + esc(e.message), "bad"));


/* ------------------------------------------------------- markup layers */
async function loadLayersAdmin() {
  const h = { "X-Project": A.pid };
  const [lr, items] = await Promise.all([
    api("/api/layers", { headers: h }),
    api("/api/items?since=0", { headers: h }).catch(() => ({ items: [] })),
  ]);
  A.layers = lr.layers || {};
  const names = new Set(["General", ...Object.keys(A.layers)]);
  for (const it of items.items || []) if (!it.deleted) names.add(it.layer || "General");
  A.layerNames = [...names].sort((a, b) => (a === "General" ? -1 : b === "General" ? 1 : a.localeCompare(b)));
  renderLayersAdmin();
}

function renderLayersAdmin() {
  const box = $("#a-layers");
  const people = (sel, key, name) => `<div class="lpeople" data-k="${key}" ${sel ? "" : "hidden"}>`
    + A.members.map((m) => `<label><input type="checkbox" value="${m.id}"`
      + `${((A.layers[name] || {})[key] || []).includes(m.id) ? " checked" : ""}> ${esc(m.name)}</label>`).join("")
    + `</div>`;
  box.innerHTML = `<table class="tbl"><thead><tr><th>Layer</th><th>Who can change its markups</th>`
    + `<th>Who can see it</th><th>Hidden at start</th></tr></thead><tbody>`
    + A.layerNames.map((n) => {
      const v = A.layers[n] || {};
      return `<tr data-l="${esc(n)}"><td><b>${esc(n)}</b></td>`
        + `<td><select class="l-edit"><option value="all">Every member</option><option value="admins">Project admins only</option>`
        + `<option value="list">These people</option></select>${people(v.edit === "list", "editors", n)}</td>`
        + `<td><select class="l-see"><option value="all">Everyone in the project</option><option value="list">These people</option></select>`
        + `${people(v.see === "list", "viewers", n)}</td>`
        + `<td><input type="checkbox" class="l-hid"${v.hidden_default ? " checked" : ""}></td></tr>`;
    }).join("") + `</tbody></table>`;
  box.querySelectorAll("tr[data-l]").forEach((tr) => {
    const v = A.layers[tr.dataset.l] || {};
    tr.querySelector(".l-edit").value = v.edit || "all";
    tr.querySelector(".l-see").value = v.see || "all";
    tr.querySelector(".l-edit").onchange = (e) => { tr.querySelector('.lpeople[data-k="editors"]').hidden = e.target.value !== "list"; };
    tr.querySelector(".l-see").onchange = (e) => { tr.querySelector('.lpeople[data-k="viewers"]').hidden = e.target.value !== "list"; };
  });
}

function collectLayersAdmin() {
  const out = {};
  $("#a-layers").querySelectorAll("tr[data-l]").forEach((tr) => {
    const ids = (k) => [...tr.querySelectorAll(`.lpeople[data-k="${k}"] input:checked`)].map((c) => +c.value);
    const v = { edit: tr.querySelector(".l-edit").value, editors: ids("editors"),
                see: tr.querySelector(".l-see").value, viewers: ids("viewers"),
                hidden_default: tr.querySelector(".l-hid").checked };
    // only layers with a rule are kept
    if (v.edit !== "all" || v.see !== "all" || v.hidden_default) out[tr.dataset.l] = v;
  });
  return out;
}

document.addEventListener("click", async (ev) => {
  if (ev.target.id === "a-layer-add") {
    const n = ($("#a-layer-new").value || "").trim();
    if (!n) return;
    A.layers = collectLayersAdmin();
    if (!A.layerNames.includes(n)) A.layerNames.push(n);
    $("#a-layer-new").value = "";
    renderLayersAdmin();
  } else if (ev.target.id === "a-layers-save") {
    try {
      const r = await api("/api/layers", { method: "PUT", headers: { "X-Project": A.pid },
        body: JSON.stringify({ layers: collectLayersAdmin() }) });
      A.layers = r.layers || {};
      msg("Layers saved. Everyone gets the new rules the next time they open the sheets.", "ok");
    } catch (e) { msg(esc(e.message), "bad"); }
  }
});
