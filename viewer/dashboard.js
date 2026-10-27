/* Project dashboard.
 *
 * The questions a project lead asks every week, answered from the issues
 * themselves - the same ones the sheet and 3D pages show:
 *
 *   How many are open, and is that going up or down?        KPIs, trend
 *   What kind are they, how urgent, and where?               type, priority, where
 *   Who is holding what, and who is behind?                  responsibility table
 *   What is late, what is due soon, what has gone quiet?     the four lists
 *   How is each office doing?                                by office
 *
 * The layout follows what ACC Insight and Dalux put on their issue
 * dashboards: status, overdue and upcoming by assignee and company, created
 * versus closed over time, and a way out to the issue itself. Everything is
 * worked out in the browser from one download of the project's issues, so
 * a filter change is instant and the server does nothing new.
 *
 * Dates: "raised" is the issue's created date, "closed" is when it last
 * became Resolved or Closed (recorded by the server in the issue's history),
 * "updated" is the server's last-change time.
 */


/* Which version of the viewer this browser is running - shown small beside
   the name, so "I can't see the new button" can be told apart from "the
   server still has the old files" at a glance. */
const LWK_VERSION = "2026-12-18";
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
import { api, link, project, signOut, projectOptions, projectTwoStep, keptBig, keepBig } from "./nav.js";
import { ISSUE_TYPES } from "./issuetypes.js";
import { skeleton } from "./tasks-util.js";
import { day, dayTime, ago as dateAgo, overdueBy } from "./dates.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DAY = 86400000;
const CLOSED = new Set(["Resolved", "Closed"]);
const STATUS_COLORS = { "Open": "#e8a13a", "In progress": "#3b82f6", "Resolved": "#0e9f6e", "Closed": "#0b6b4c", "Not an issue": "#9ca3af" };
const PRIORITY_ORDER = ["Critical", "High", "Normal", "Low"];
const PRIORITY_COLORS = { Critical: "#b91c1c", High: "#f28022", Normal: "#6b7280", Low: "#9ca3af" };
const TYPE = new Map(ISSUE_TYPES.map((t) => [t.id, t]));
const UNASSIGNED = "(unassigned)";

const D = { manifest: null, items: [], members: [], me: null, issues: [], fetched: null, rev: 0,
            revs: {}, byPart: {}, manifests: {}, memberBy: {} };

/* What the dashboard shows: one part (a model / sheet set), a whole project
   (all its parts - the default for a project of several), or one of my own
   dashboards (several projects together). Set by the address:
   ?project=<part>&one=1, ?reg=<project>, ?board=<id>. */
const SC = { kind: "part", parts: [], regs: [], name: "", board: null, choices: null, boards: [], labels: {} };
const multi = () => SC.parts.length > 1;
const partLabel = (p) => SC.labels[p] || p;

async function resolveScope() {
  const q = new URLSearchParams(location.search);
  try { SC.choices = await api("/api/project-choices"); } catch (e) { SC.choices = { projects: [], others: [] }; }
  try { SC.boards = (await api("/api/dashboards")).dashboards || []; } catch (e) { SC.boards = []; }
  const regOf = (pid) => SC.choices.projects.find((x) => x.parts.some((y) => y.id === pid));
  const titles = {};
  for (const x of SC.choices.projects) for (const y of x.parts) titles[y.id] = y.title;
  for (const o of SC.choices.others) titles[o.id] = o.title;
  const b = q.get("board") && SC.boards.find((x) => x.id === q.get("board"));
  const r = q.get("reg") && SC.choices.projects.find((x) => x.reg === q.get("reg"));
  if (b && b.parts.length) {
    Object.assign(SC, { kind: "board", board: b, parts: b.parts.map((x) => x.id), regs: b.regs, name: b.name });
  } else if (r) {
    Object.assign(SC, { kind: "reg", parts: r.parts.map((x) => x.id), regs: [r.reg], name: r.name });
  } else {
    const own = regOf(project());
    if (own && own.parts.length > 1 && !q.get("one")) Object.assign(SC, { kind: "reg", parts: own.parts.map((x) => x.id), regs: [own.reg], name: own.name });
    else Object.assign(SC, { kind: "part", parts: [project()], regs: own ? [own.reg] : [], name: (own && own.name) || "" });
  }
  // a short name for each part: what tells it from the others (CAL, LAY)
  const ts = SC.parts.map((p) => titles[p] || p);
  for (const [i, p] of SC.parts.entries()) SC.labels[p] = shortName(ts[i], ts, SC.kind === "board" ? (regOf(p) || {}).name : "");
  // the links of the page (Sheets, 3D ...) go to the first part
  if (SC.parts[0] && SC.parts[0] !== project()) { try { sessionStorage.setItem("lwk-viewer:tab-project", SC.parts[0]); } catch (e) {} }
}

/* Under the title: the whole project or one of its parts, and my own
   dashboards (several projects together) with + Combine projects. */
function scopeBar() {
  let bar = $("#d-scope");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "d-scope";
    $("#d-sub").after(bar);
  }
  const own = SC.kind !== "board" && SC.choices.projects.find((x) => SC.regs.includes(x.reg) || x.parts.some((y) => y.id === SC.parts[0]));
  const chip = (href, label, on, title) => `<a class="ds-chip${on ? " on" : ""}" href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${esc(label)}</a>`;
  let h = "";
  if (own && own.parts.length > 1) {
    const labs = {};
    const ts = own.parts.map((x) => x.title);
    for (const x of own.parts) labs[x.id] = shortName(x.title, ts, "");
    h += `<span class="ds-g">${chip("dashboard.html?reg=" + encodeURIComponent(own.reg), "All parts", SC.kind === "reg", "Every model and sheet set of " + own.name + " together")}`
      + own.parts.map((x) => chip("dashboard.html?project=" + encodeURIComponent(x.id) + "&one=1", labs[x.id], SC.kind === "part" && SC.parts[0] === x.id, x.title)).join("") + `</span>`;
  }
  h += `<span class="ds-g"><span class="muted">My dashboards:</span>`
    + SC.boards.map((b) => chip("dashboard.html?board=" + encodeURIComponent(b.id), b.name, SC.kind === "board" && SC.board.id === b.id,
      b.parts.map((x) => x.title).join(", "))).join("")
    + `<button type="button" class="ghost ds-new" title="A dashboard of several projects together - kept for you on any device">+ Combine projects …</button>`
    + (SC.kind === "board" ? `<button type="button" class="ghost ds-edit">Edit</button><button type="button" class="ghost ds-del">Delete</button>` : "")
    + `</span>`;
  bar.innerHTML = h;
  bar.querySelector(".ds-new").onclick = () => boardDialog(null);
  if (SC.kind === "board") {
    bar.querySelector(".ds-edit").onclick = () => boardDialog(SC.board);
    bar.querySelector(".ds-del").onclick = async () => {
      if (!confirm(`Delete the dashboard "${SC.board.name}"? The projects themselves are not touched.`)) return;
      try { await api("/api/dashboards/" + encodeURIComponent(SC.board.id), { method: "DELETE" }); } catch (e) { alert(e.message); return; }
      location.href = "dashboard.html?project=" + encodeURIComponent(SC.parts[0] || project());
    };
  }
}

/* Make or change one of my dashboards: a name, and the projects (all of a
   project's parts, now and later) or single parts it shows. */
function boardDialog(b) {
  const scope = (b && b.scope) || [];
  const hasReg = (r) => scope.some((x) => x.reg === r);
  const hasPart = (p) => scope.some((x) => x.part === p);
  const back = document.createElement("div");
  back.className = "ds-back";
  const projs = SC.choices.projects.map((x) => `<div class="ds-p"><label><input type="checkbox" data-reg="${esc(x.reg)}"${hasReg(x.reg) ? " checked" : ""}> <b>${esc(x.name)}</b> <small class="muted">${esc(x.code || "")}</small></label>`
    + (x.parts.length > 1 ? `<div class="ds-parts">` + x.parts.map((y) => `<label><input type="checkbox" data-part="${esc(y.id)}"${hasReg(x.reg) || hasPart(y.id) ? " checked" : ""}${hasReg(x.reg) ? " disabled" : ""}> ${esc(y.title)}</label>`).join("") + `</div>` : "")
    + `</div>`).join("")
    + (SC.choices.others.length ? `<div class="ds-p"><b class="muted">Not on the Projects page</b><div class="ds-parts">` + SC.choices.others.map((o) => `<label><input type="checkbox" data-part="${esc(o.id)}"${hasPart(o.id) ? " checked" : ""}> ${esc(o.title || o.id)}</label>`).join("") + `</div></div>` : "");
  back.innerHTML = `<form class="ds-dlg"><h3>${b ? "Change the dashboard" : "Combine projects into one dashboard"}</h3>`
    + `<label class="ds-name">Name <input name="name" maxlength="120" value="${esc(b ? b.name : "")}" placeholder="e.g. My HK projects" required></label>`
    + `<p class="muted" style="font-size:12px;margin:4px 0">Tick a project for all its models and sheet sets (also ones added later), or only some of its parts.</p>`
    + `<div class="ds-list">${projs}</div>`
    + `<div class="ds-f"><button type="button" class="ghost" data-x>Cancel</button><button class="primary">${b ? "Save" : "Make the dashboard"}</button></div></form>`;
  document.body.appendChild(back);
  const f = back.querySelector("form");
  // a whole project ticked: its parts ticked (and fixed)
  for (const c of f.querySelectorAll("[data-reg]")) c.onchange = () => {
    for (const y of c.closest(".ds-p").querySelectorAll("[data-part]")) { y.checked = c.checked || y.checked; y.disabled = c.checked; }
  };
  f.querySelector("[data-x]").onclick = () => back.remove();
  f.name.focus();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const sc = [];
    for (const c of f.querySelectorAll("[data-reg]:checked")) sc.push({ reg: c.dataset.reg });
    for (const c of f.querySelectorAll("[data-part]:checked:not(:disabled)")) sc.push({ part: c.dataset.part });
    if (!sc.length) { alert("Tick at least one project."); return; }
    try {
      const r = await api("/api/dashboards", { method: "POST", body: JSON.stringify({ id: b ? b.id : undefined, name: f.name.value.trim(), scope: sc }) });
      location.href = "dashboard.html?board=" + encodeURIComponent(r.id);
    } catch (e) { alert(e.message); }
  };
}

/* "TKO137-LWK-ZZ-ZZ-AR-BD_CAL" among its sister parts: "CAL"; with the
   project's name in front on a dashboard of several projects. */
function shortName(t, all, proj) {
  let s = t;
  if (all.length > 1) {
    let i = 0;
    while (all.every((x) => x[i] === t[i]) && i < t.length) i++;
    s = t.slice(i).replace(/^[-_ .]+/, "") || t;
    if (s.length < 2) s = t;
  }
  if (s.length > 28) s = s.slice(0, 26) + "…";
  return proj && proj !== s ? proj + (all.length > 1 ? " · " + s : "") : s;
}

/* What the dashboard last showed is kept on this device (per account and
   scope): the next visit draws it at once, and the server is then asked
   only for the issues changed since. */
const dashKey = () => "dash2:" + (SC.kind === "board" ? "b:" + SC.board.id : SC.kind === "reg" ? "r:" + SC.regs[0] : project());
const K = { ex: null, pj: null, digest: null, ptasks: null, lv: null };
let keepT = 0;
function keepDash() {
  clearTimeout(keepT);
  keepT = setTimeout(() => {
    keepBig(dashKey(), { revs: D.revs, byPart: D.byPart, manifests: D.manifests, members: D.members, me: D.me,
      fetched: D.fetched ? D.fetched.getTime() : null, ex: K.ex, pj: K.pj, digest: K.digest, ptasks: K.ptasks, lv: K.lv },
      D.me && D.me.user ? D.me.user.id : null);
  }, 1500);
}

async function showKept() {
  const k = await keptBig(dashKey());
  if (!k || !k.byPart) return false;
  D.byPart = k.byPart; D.revs = k.revs || {}; D.manifests = k.manifests || {}; D.members = k.members || [];
  joinParts();
  if (!D.me) D.me = k.me;
  D.fetched = k.fetched ? new Date(k.fetched) : null;
  D.issues = D.items.filter((it) => it.issue).map(toIssue);
  K.ex = k.ex; K.pj = k.pj; K.digest = k.digest; K.ptasks = k.ptasks; K.lv = k.lv;
  $("#d-sub").textContent = scopeTitle();
  fillFilters();
  render();
  if (K.digest && !multi()) drawDigest(K.digest);
  if (K.ex) drawExports(K.ex);
  if (K.ptasks) drawAllTasks(K.ptasks);
  if (K.lv) drawLv(K.lv);
  if (D.fetched) $("#d-updated").textContent = "Updated " + dateAgo(D.fetched);
  return true;
}

/* ------------------------------------------------------------ sign-in */

async function ensureSignedIn() {
  try {
    D.me = await api("/api/me");
    return;
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  const info = await (await fetch("/api/ping")).json();
  const back = $("#gate-back");
  back.hidden = false;
  if (!info.accounts) {
    $("#gate-name").closest("label").firstChild.textContent = "Your name";
    $("#gate-pass").closest("label").firstChild.textContent = "Project passphrase";
    $("#gate-name").type = "text";
  }
  try { $("#gate-name").value = localStorage.getItem("lwk-viewer:email") || ""; } catch (e) {}
  await new Promise((resolve) => {
    const go = async () => {
      $("#gate-msg").textContent = "Signing in ...";
      try {
        const res = await fetch("/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#gate-name").value.trim(),
                                 passphrase: $("#gate-pass").value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Sign-in failed");
        localStorage.setItem("lwk-viewer:token", data.token);
        if (info.accounts) localStorage.setItem("lwk-viewer:email", $("#gate-name").value.trim());
        else localStorage.setItem("lwk-viewer:name", $("#gate-name").value.trim());
        back.hidden = true;
        resolve();
      } catch (e) {
        $("#gate-msg").textContent = e.message;
      }
    };
    $("#gate-go").onclick = go;
    $("#gate-pass").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
  });
  D.me = await api("/api/me");
}

/* ------------------------------------------------------------- loading */

async function loadProjects() {
  const data = await api("/api/projects");
  const ps = data.projects || [];
  const sel = $("#d-project");
  const plain = () => ({ html: ps.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}`
    + `${p.role && D.me.accounts ? " (" + esc(p.role) + ")" : ""}</option>`).join(""), ids: ps.map((p) => p.id) });
  // the names from the Projects page; a project of several models as a group
  const ch = await projectOptions(project(), plain);
  sel.innerHTML = ch.html || plain().html;
  let want = project();
  if (!ps.find((p) => p.id === want) && ps.length) want = ps[0].id;
  if (!want) {
    $("#d-msg").textContent = D.me.accounts
      ? "You are not a member of any project yet - ask a project admin to add you."
      : "No projects on this server.";
    return false;
  }
  sel.value = want;
  projectTwoStep(sel);           // project first, then its model
  localStorage.setItem("lwk-viewer:project", want);
  // the address keeps what is shown (a whole project, one of my dashboards)
  const q = new URLSearchParams();
  if (SC.kind === "board") q.set("board", SC.board.id);
  else if (SC.kind === "reg") q.set("reg", SC.regs[0]);
  else { q.set("project", want); if (new URLSearchParams(location.search).get("one")) q.set("one", "1"); }
  history.replaceState(null, "", "dashboard.html?" + q.toString());
  sel.onchange = () => {
    localStorage.setItem("lwk-viewer:project", sel.value);
    location.href = "dashboard.html?project=" + encodeURIComponent(sel.value);
  };
  return true;
}

async function loadData() {
  const shown = !!D.fetched;
  if (!shown) $("#d-msg").textContent = "Loading ...";
  if (!$("#kpis").children.length) $("#kpis").innerHTML = skeleton(3, "Loading the dashboard");
  // every part of the scope, each with its own header (and its own count of changes)
  const one = async (p) => {
    const h = { headers: { "X-Project": p } };
    const [man, items0, mem] = await Promise.all([
      fetch("/data/" + encodeURIComponent(p) + "/manifest.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      api("/api/items?since=" + (D.revs[p] || 0), h),
      api("/api/members", h).catch(() => ({ members: [] })),
    ]);
    let items = items0, rev = D.revs[p] || 0;
    // the server's count went back (a restore): everything again
    if (rev && (items.rev || 0) < rev) { rev = 0; items = await api("/api/items?since=0", h); }
    let list = rev ? D.byPart[p] || [] : [];
    if (!rev) list = (items.items || []).filter((it) => !it.deleted);
    else {
      const by = new Map(list.map((it) => [it.id, it]));
      for (const it of items.items || []) { if (it.deleted) by.delete(it.id); else by.set(it.id, it); }
      list = Array.from(by.values());
    }
    D.byPart[p] = list;
    D.revs[p] = items.rev || 0;
    D.manifests[p] = man;
    D.memberBy[p] = mem.members || [];
  };
  const res = await Promise.allSettled(SC.parts.map(one));
  if (res.every((r) => r.status === "rejected")) throw res[0].reason;
  for (const p of Object.keys(D.byPart)) if (!SC.parts.includes(p)) delete D.byPart[p];
  // the people of every part, once
  const seen = new Map();
  for (const p of SC.parts) for (const m of D.memberBy[p] || []) { const k = (m.email || m.name || "").toLowerCase(); if (!seen.has(k)) seen.set(k, m); }
  D.members = Array.from(seen.values());
  joinParts();
  D.fetched = new Date();
  $("#d-msg").textContent = res.some((r) => r.status === "rejected") ? "Some parts could not be loaded." : "";
  $("#d-updated").textContent = "Updated " + dateAgo(D.fetched);
  $("#d-sub").textContent = scopeTitle();
  fillFilters();
  render();
  keepDash();
  if (multi()) $("#digest").hidden = true; else loadDigest().catch(() => {});
  loadExports().catch(() => {});
}

/* The parts' issues as one list, each knowing its part. */
function joinParts() {
  D.items = [];
  for (const p of SC.parts) for (const it of D.byPart[p] || []) D.items.push(Object.assign(it, { _p: p }));
  D.manifest = D.manifests[SC.parts[0]] || null;
  D.issues = D.items.filter((it) => it.issue).map(toIssue);
}

function scopeTitle() {
  if (SC.kind === "board") return SC.name + " · " + SC.parts.length + " part" + (SC.parts.length === 1 ? "" : "s") + " · issues and tasks";
  if (SC.kind === "reg" && multi()) return SC.name + " · all parts (" + SC.parts.map(partLabel).join(", ") + ") · issues and tasks";
  const pt = (D.manifest && D.manifest.source && D.manifest.source.title) || project();
  return pt + " · issues and tasks";
}

/* How the project is published: one row per Revit file (from what each
   upload says about itself), and what of it is in the viewer now. */
async function loadExports() {
  const box = $("#exports-body");
  if (!box) return;
  const one = async (p) => {
    let ex = {}, pj = null;
    try { ex = (await api("/api/projects/" + encodeURIComponent(p) + "/exports")).exports || {}; } catch (e) { ex = {}; }
    try { pj = (await api("/api/publish-jobs?project=" + encodeURIComponent(p))).jobs || []; } catch (e) { pj = null; }   // an older server: no list
    return { p, ex, pj };
  };
  const all = await Promise.all(SC.parts.map(one));
  K.ex = all; K.pj = null; keepDash();
  drawExports(all);
}

/* One table per part (a project of several: each under its name). */
function drawExports(all) {
  const box = $("#exports-body");
  if (!box) return;
  if (!Array.isArray(all)) return;
  if (all.length === 1) { drawExportsOf(box, all[0].ex, all[0].pj, D.manifests[all[0].p] || D.manifest); return; }
  box.classList.remove("muted");
  box.innerHTML = all.map((x, i) => `<h4 class="exp-part">${esc(partLabel(x.p))} <small class="muted">${esc(x.p)}</small></h4><div data-part="${i}"></div>`).join("");
  all.forEach((x, i) => drawExportsOf(box.querySelector(`[data-part="${i}"]`), x.ex, x.pj, D.manifests[x.p]));
}

function drawExportsOf(box, ex, pj, man) {
  const sheets = (man && man.sheets) || [];
  const bySrc = new Map();
  for (const sh of sheets) {
    const k = sh.source || (man.source && man.source.title) || "";
    if (!bySrc.has(k)) bySrc.set(k, { sheets: 0, areas: 0, rows: 0, numbers: [] });
    const b = bySrc.get(k);
    b.sheets++; b.numbers.push(sh.number);
    b.areas += new Set((sh.areas || []).map((a) => a.uid)).size;
    for (const sc of sh.schedules || []) b.rows += (sc.rows || []).length;
  }
  const names = Array.from(new Set(Object.keys(ex).concat(Array.from(bySrc.keys())))).filter((n) => n || bySrc.size === 1);
  if (!names.length) { box.textContent = "Nothing published yet."; return; }
  const when = (iso) => { return dayTime(iso); };
  const models = (man && man.models) || [];
  let html = `<div class="table-wrap"><table class="exp-table"><thead><tr><th>Revit file</th><th>Sends</th><th>In the viewer now</th>`
    + `<th>Night export</th><th>Last upload</th><th></th></tr></thead><tbody>`;
  names.forEach((n, i) => {
    const j = ex[n] || {};
    const b = bySrc.get(n) || { sheets: 0, areas: 0, rows: 0, numbers: [] };
    const ok = j.ok === false || j.errors ? `<span class="pill bad">${j.errors || ""} error(s)</span>`
      : j.received_at ? `<span class="pill ok">ok</span>` : "";
    html += `<tr><td><b>${esc(n || "(one file)")}</b>${j.pc ? `<div class="sub">from ${esc(j.pc)}${j.user ? " / " + esc(j.user) : ""}</div>` : ""}</td>`
      + `<td>${esc(j.sheets || "")}${j.model_3d ? "<br>" + esc(j.model_3d) : ""}${j.adds_to_project ? '<br><span class="sub">adds its sheets to the project</span>' : ""}</td>`
      + `<td>${b.sheets} sheet(s)${b.areas ? `, ${b.areas} area(s) / ${b.rows} schedule row(s) linked` : ""}`
      + `${!j.adds_to_project && models.length && (i === 0 || !j.source) ? `<br>${models.length} 3D model(s)` : ""}</td>`
      + `<td>${j.nightly ? "on" : (j.received_at ? "off" : "")}${j.schedule ? `<div class="sub">${esc(String(j.schedule).split("\n").slice(0, 2).join(" / "))}</div>` : ""}</td>`
      + `<td>${j.received_at ? when(j.received_at) + (j.how ? ` <span class="sub">(${esc(j.how)})</span>` : "") : "before 30 Sep: no record"} ${ok}</td>`
      + `<td>${(j.log || []).length || b.numbers.length ? `<button class="ghost exp-more" data-i="${i}">Details</button>` : ""}</td></tr>`
      + `<tr class="exp-detail" data-i="${i}" hidden><td colspan="6">`
      + (b.numbers.length ? `<div><b>Sheets:</b> ${esc(b.numbers.join(", "))}</div>` : "")
      + (j.folder ? `<div><b>Export folder:</b> ${esc(j.folder)}</div>` : "")
      + (j.extension ? `<div><b>Extension:</b> ${esc(j.extension)}</div>` : "")
      + ((j.log || []).length ? `<pre class="exp-log">${esc((j.log || []).join("\n"))}</pre>` : "")
      + `</td></tr>`;
  });
  html += `</tbody></table></div>`;
  /* Every PC that has this project set up to publish (the table above keeps
     only the last upload of each file): a model published at night from two
     PCs is said here, with where to look. */
  if (pj) {
    const night = pj.filter((j) => j.nightly);
    const dup = pj.filter((j) => j.duplicate);
    if (dup.length) {
      html = `<div class="pill bad" style="display:block;margin:0 0 8px;padding:6px 10px;border-radius:6px">`
        + `Published at night from more than one PC: `
        + esc(dup.map((j) => `${j.source} (${j.pc} / ${j.saved_by || j.user}${j.night_time ? " " + j.night_time : ""})`).join("; "))
        + ` - switch one off. <a href="admin.html#publish">All auto-publish settings</a></div>` + html;
    } else if (pj.length) {
      html += `<div class="sub" style="margin-top:6px">${night.length} night export(s) set for this project`
        + ` - <a href="admin.html#publish">all auto-publish settings</a></div>`;
    }
  }
  box.classList.remove("muted");
  box.innerHTML = html;
  for (const b of box.querySelectorAll(".exp-more")) b.onclick = () => {
    const r = box.querySelector(`tr.exp-detail[data-i="${b.dataset.i}"]`);
    r.hidden = !r.hidden;
  };
}

/* The weekly summary (what Teams gets every week), and a button to send it now. */
async function loadDigest() {
  const d = await api("/api/digest?days=7");
  K.digest = d; keepDash();
  drawDigest(d);
}

function drawDigest(d) {
  const box = $("#digest");
  box.hidden = false;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const people = (d.by_person || []).map(([k, n]) => `${esc(k)} <b>${n}</b>`).join(" &middot; ");
  const od = (d.overdue_list || []).map((o) =>
    `<li><a href="${issueLink({ id: o.id, sheet: o.sheet, is3d: !o.sheet })}">#${o.number || "?"} ${esc(o.title)}</a>`
    + ` <span class="muted">${esc(o.assigned_to || "unassigned")}, ${esc(overdueBy(o.due_date))}</span></li>`).join("");
  $("#dg-body").innerHTML = `<div class="dg-nums">`
    + `<span><b>${d.raised}</b> raised</span><span title="Became Resolved or Closed in the last 7 days"><b>${d.closed}</b> resolved</span>`
    + `<span><b>${d.open}</b> open</span><span class="${d.overdue ? "bad" : ""}"><b>${d.overdue}</b> overdue</span></div>`
    + (people ? `<div class="dg-people">Open by person: ${people}</div>` : "")
    + (od ? `<div class="dg-od"><b>Overdue</b><ul>${od}</ul></div>` : "");
  const btn = $("#dg-send");
  btn.hidden = !d.teams;
  btn.onclick = async () => {
    btn.disabled = true;
    try { await api("/api/digest/send", { method: "POST" }); btn.textContent = "Sent"; }
    catch (e) { alert(e.message); }
    finally { setTimeout(() => { btn.disabled = false; btn.textContent = "Send to Teams"; }, 3000); }
  };
}

function sheetName(num, p) {
  const man = (p && D.manifests[p]) || D.manifest;
  const s = ((man && man.sheets) || []).find((x) => x.number === num);
  return s ? `${s.number} ${s.name || ""}`.trim() : num;
}

function memberByName(name) {
  const n = (name || "").trim().toLowerCase();
  return D.members.find((m) => m.name.toLowerCase() === n || m.email.toLowerCase() === n) || null;
}

function lastHistoryAt(iss, statuses) {
  const h = (iss.history || []).filter((e) => e.field === "status" && statuses.has(e.to));
  return h.length ? h[h.length - 1].at : null;
}

/* One flat record per issue with everything the charts need. */
function toIssue(it) {
  const iss = it.issue;
  const dismissed = !!iss.dismissed;
  const status = dismissed ? "Not an issue" : (iss.status || "Open");
  const created = new Date(iss.created_at || it.created_at || it.updated_at || Date.now());
  const updated = new Date(it.updated_at || iss.updated_at || created);
  let closed = null;
  if (CLOSED.has(status) || dismissed) {
    closed = new Date(iss.closed_at || lastHistoryAt(iss, CLOSED) || updated);
  }
  const assignee = (iss.assigned_to || "").trim() || UNASSIGNED;
  const m = assignee === UNASSIGNED ? null : memberByName(assignee);
  const due = iss.due_date ? new Date(iss.due_date + "T23:59:59") : null;
  const where0 = it.sheet ? sheetName(it.sheet, it._p)
    : (it.placement === "3d" ? "3D model" : "Other");
  const where = multi() ? partLabel(it._p) + " · " + where0 : where0;
  const lastBy = (iss.history && iss.history.length && iss.history[iss.history.length - 1].by)
    || it.updated_by || iss.author || it.author || "";
  return {
    id: it.id, project: it._p || project(), part: partLabel(it._p || project()), number: iss.number || null, sheet: it.sheet || null, is3d: it.placement === "3d",
    title: iss.title || "Issue", type: iss.type || "general",
    priority: iss.priority || "Normal", status, dismissed,
    open: !CLOSED.has(status) && !dismissed, created, updated, closed, due,
    assignee, office: m ? (m.office || "-") : (assignee === UNASSIGNED ? "-" : "?"),
    team: m ? (m.team || "-") : "-", discipline: m ? (m.discipline || "-") : "-",
    author: iss.author || it.author || "", where, lastBy, history: iss.history || [],
  };
}

/* ------------------------------------------------------------ filters */

const F = { range: 90, type: "", assignee: "", office: "", team: "", disc: "", mine: false, dismissed: false, part: "" };

function fillFilters() {
  // a dashboard of several parts: which part
  let pl = $("#f-part");
  if (multi() && !pl) {
    const lab = document.createElement("label");
    lab.className = $("#f-type").closest("label").className;
    lab.innerHTML = `Part <select id="f-part"></select>`;
    $("#f-type").closest("label").before(lab);
    pl = $("#f-part");
    pl.onchange = (e) => { F.part = e.target.value; render(); };
  }
  if (pl) {
    pl.closest("label").hidden = !multi();
    pl.innerHTML = `<option value="">All parts</option>` + SC.parts.map((p) => `<option value="${esc(p)}">${esc(partLabel(p))}</option>`).join("");
    pl.value = F.part;
  }
  const types = [...new Set(D.issues.map((i) => i.type))];
  $("#f-type").innerHTML = `<option value="">All</option>` + types
    .map((t) => `<option value="${esc(t)}">${esc((TYPE.get(t) || { label: t }).label)}</option>`).join("");
  const people = [...new Set(D.issues.map((i) => i.assignee))].sort();
  $("#f-assignee").innerHTML = `<option value="">Everyone</option>` + people
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  const offices = [...new Set(D.members.map((m) => m.office).filter(Boolean))].sort();
  $("#f-office").innerHTML = `<option value="">All offices</option>` + offices
    .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
  $("#f-office").closest("label").hidden = !offices.length;
  // the people's team and discipline (Admin page), when they have been set
  for (const [id, key, all] of [["#f-team", "team", "All teams"], ["#f-disc", "discipline", "All"]]) {
    const vals = [...new Set(D.members.map((m) => m[key]).filter(Boolean))].sort();
    $(id).innerHTML = `<option value="">${all}</option>` + vals.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    $(id).closest("label").hidden = !vals.length;
  }
  $("#f-team").value = F.team; $("#f-disc").value = F.disc;
  $("#f-mine").closest("label").hidden = !(D.me && D.me.user);
  $("#f-type").value = F.type; $("#f-assignee").value = F.assignee; $("#f-office").value = F.office;
}

function filtered() {
  const now = Date.now();
  const myName = D.me && D.me.user ? D.me.user.name.toLowerCase() : "";
  return D.issues.filter((i) => {
    if (!F.dismissed && i.dismissed) return false;
    // Open issues always count; closed ones only if closed in the period.
    if (F.range && !i.open && (!i.closed || now - i.closed.getTime() > F.range * DAY)) return false;
    if (F.part && i.project !== F.part) return false;
    if (F.type && i.type !== F.type) return false;
    if (F.assignee && i.assignee !== F.assignee) return false;
    if (F.office && i.office !== F.office) return false;
    if (F.team && i.team !== F.team) return false;
    if (F.disc && i.discipline !== F.disc) return false;
    if (F.mine && i.assignee.toLowerCase() !== myName && i.author.toLowerCase() !== myName) return false;
    return true;
  });
}

function wireFilters() {
  $("#f-range").onchange = (e) => { F.range = +e.target.value; render(); };
  $("#f-type").onchange = (e) => { F.type = e.target.value; render(); };
  $("#f-assignee").onchange = (e) => { F.assignee = e.target.value; render(); };
  $("#f-office").onchange = (e) => { F.office = e.target.value; render(); };
  $("#f-team").onchange = (e) => { F.team = e.target.value; render(); };
  $("#f-disc").onchange = (e) => { F.disc = e.target.value; render(); };
  $("#f-mine").onchange = (e) => { F.mine = e.target.checked; render(); };
  $("#f-dismissed").onchange = (e) => { F.dismissed = e.target.checked; render(); };
  $("#d-refresh").onclick = () => loadData().catch(showError);
  // the less-used filters stay out of the way until asked for
  const more = $("#f-more"), extra = $("#f-extra");
  const paintMore = () => {
    const n = [F.office, F.team, F.dismissed].filter(Boolean).length;
    more.textContent = extra.hidden ? (n ? `More filters (${n})` : "More filters") : "Fewer filters";
    more.setAttribute("aria-expanded", String(!extra.hidden));
  };
  more.onclick = () => { extra.hidden = !extra.hidden; paintMore(); };
  for (const id of ["#f-office", "#f-team", "#f-dismissed"]) $(id).addEventListener("change", paintMore);
  paintMore();
  $("#d-csv").onclick = exportCsv;
  $("#d-bcf").onclick = exportBcf;
  $("#d-weekly").onclick = async () => {
    $("#d-updated").textContent = "Keeping the weekly report in Folders ...";
    try {
      const r = await api("/api/digest/save", { method: "POST", body: "{}" });
      $("#d-updated").textContent = "Weekly report kept in Folders: " + r.saved.map((x) => x.path).join(", ");
    } catch (e) { $("#d-updated").textContent = "Weekly report: " + (e.message || e); }
  };
  // Export ▾: Report, Spreadsheet, BCF
  const em = $("#d-export-menu"), eb = $("#d-export");
  eb.onclick = (ev) => {
    ev.stopPropagation();
    em.hidden = !em.hidden;
    const r = eb.getBoundingClientRect();
    em.style.top = (r.bottom + 4) + "px";
    em.style.left = Math.max(6, Math.min(innerWidth - 276, r.right - 270)) + "px";
  };
  em.addEventListener("click", () => setTimeout(() => { em.hidden = true; }, 100));
  document.addEventListener("pointerdown", (ev) => { if (!em.hidden && !em.contains(ev.target) && ev.target !== eb) em.hidden = true; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") em.hidden = true; });
  $("#d-report").onclick = () => {
    if (multi() && !F.part) { alert("The printable report is per part: choose a part in the Part filter first (or use Spreadsheet for all of them)."); return; }
    if (multi()) { sessionStorage.setItem("lwk-report:" + F.part, JSON.stringify(filtered().map((i) => i.id))); window.open(link("report.html", { project: F.part }), "_blank"); return; }
    // The report shows exactly what the filters show here.
    sessionStorage.setItem("lwk-report:" + project(), JSON.stringify(filtered().map((i) => i.id)));
    window.open(link("report.html"), "_blank");
  };
}

/* ------------------------------------------------------------- render */

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const days = (a, b) => Math.floor((b - a) / DAY);
const fmtDate = (d) => (d ? day(d) : "");

function render() {
  const list = filtered();
  const t0 = today0();
  const soon = new Date(t0.getTime() + 8 * DAY);
  const open = list.filter((i) => i.open);
  const overdue = open.filter((i) => i.due && i.due < t0);
  const dueSoon = open.filter((i) => i.due && i.due >= t0 && i.due < soon);
  const closedList = list.filter((i) => i.closed && !i.dismissed);
  const avgOpen = open.length ? open.reduce((s, i) => s + days(i.created, Date.now()), 0) / open.length : 0;
  const avgClose = closedList.length
    ? closedList.reduce((s, i) => s + Math.max(0, days(i.created, i.closed)), 0) / closedList.length : 0;
  const count = (st) => list.filter((i) => i.status === st).length;

  const periodLabel = F.range ? ({ 7: "last 7 days", 30: "last 30 days", 90: "last 90 days", 365: "last 12 months" }[F.range] || `last ${F.range} days`) : "any time";
  const raisedIn = list.filter((i) => !F.range || Date.now() - i.created.getTime() <= F.range * DAY).length;
  const oldOpen = open.filter((i) => Date.now() - i.created.getTime() > 28 * DAY).length;
  const worst = overdue.length ? Math.max(...overdue.map((i) => days(i.due, t0))) : 0;
  // four numbers that matter, and the rest on one quiet line - zeros dimmed
  const tile = (label, value, unit, sub, subCls, hint) =>
    `<div class="kpi4${value === 0 || value === "0" ? " zero" : ""}" title="${esc(hint || "")}"><span class="lab">${label}</span>`
    + `<b>${value}${unit ? `<small>${unit}</small>` : ""}</b><span class="sub ${subCls || ""}">${sub}</span></div>`;
  const unassigned = open.filter((i) => i.assignee === UNASSIGNED).length;
  const minor = (label, n, hint) => `<span class="${n ? "" : "zero"}" title="${esc(hint || "")}">${label} <b>${n}</b></span>`;
  $("#kpis").innerHTML = `<div class="kpi4-row">`
    + tile("Open issues", open.length, "", oldOpen ? `&#9650; ${oldOpen} raised more than 4 weeks ago` : "None older than 4 weeks", oldOpen ? "warn" : "ok",
      "Open or in progress (not resolved, closed or dismissed)")
    + tile("Overdue", overdue.length, "", overdue.length ? `Oldest ${worst} day${worst === 1 ? "" : "s"} overdue` : "Nothing overdue", overdue.length ? "bad" : "ok",
      "Open, with a due date before today")
    + tile(`Resolved · ${periodLabel}`, closedList.length, "", `of ${raisedIn} raised`, "",
      "Became Resolved or Closed in the period (both count: Closed is a resolved issue the raiser has signed off)")
    + tile("Avg. time to resolve", closedList.length ? Math.round(avgClose) : "-", closedList.length ? (Math.round(avgClose) === 1 ? "day" : "days") : "",
      open.length ? `Open issues average ${Math.round(avgOpen)} day${Math.round(avgOpen) === 1 ? "" : "s"} old` : "No open issues", "",
      "Raised to resolved, for the issues resolved in the period")
    + `</div><div class="kpi-minor">`
    + minor("In progress", count("In progress"), "Someone is working on it")
    + minor("Due in 7 days", dueSoon.length, "Open, due within the next week")
    + minor("Unassigned", unassigned, "Open issues nobody holds")
    + minor("Resolved, awaiting sign-off", count("Resolved"), "Status Resolved - not yet Closed by the raiser")
    + minor("Closed", count("Closed"), "Status Closed - resolved and signed off")
    + `</div>`;

  trendChart(list);
  donut("#c-status", ["Open", "In progress", "Resolved", "Closed"].concat(F.dismissed ? ["Not an issue"] : [])
    .map((s) => ({ label: s, value: count(s), color: RING[s] })));
  bars("#c-type", tally(open, (i) => i.type).map(([k, v]) =>
    ({ label: (TYPE.get(k) || { label: k }).label, value: v, color: (TYPE.get(k) || {}).color || "#6b7280",
       onClick: () => { F.type = k; $("#f-type").value = k; render(); } })));
  bars("#c-priority", PRIORITY_ORDER.map((p) =>
    ({ label: p, value: open.filter((i) => i.priority === p).length, color: PRIORITY_COLORS[p] })));
  bars("#c-where", tally(open, (i) => i.where).slice(0, 10).map(([k, v]) =>
    ({ label: k, value: v, color: "#4a3aa7" })));
  // beside the chart, as in the template: who holds the open issues, and which discipline
  let cp = $("#c-part");
  if (multi() && !cp) {
    $("#c-person").previousElementSibling.insertAdjacentHTML("beforebegin", `<h3 class="pc-part">Open issues by part</h3><div id="c-part" class="chart"></div>`);
    cp = $("#c-part");
  }
  if (cp) {
    cp.hidden = $(".pc-part").hidden = !multi();
    if (multi()) bars("#c-part", SC.parts.map((p) => ({ label: partLabel(p), value: open.filter((i) => i.project === p).length,
      onClick: () => { F.part = F.part === p ? "" : p; $("#f-part").value = F.part; render(); } })));
  }
  bars("#c-person", tally(open, (i) => i.assignee).slice(0, 8).map(([k, v]) =>
    ({ label: k, value: v, onClick: () => { F.assignee = k; $("#f-assignee").value = k; render(); } })));
  const discs = tally(open, (i) => i.discipline).filter(([k]) => k !== "-");
  $(".pc-disc").hidden = $("#c-disc").hidden = !discs.length;
  bars("#c-disc", discs.map(([k, v]) => ({ label: k, value: v, onClick: () => { F.disc = k; $("#f-disc").value = k; render(); } })));
  $("#d-open3d").href = link("model.html");
  peopleTable(list, t0, soon);
  officeChart(open, t0);

  const row = (i, extra) => `<tr data-id="${esc(i.id)}"><td><a href="${issueLink(i)}">${i.number ? "#" + i.number + " " : ""}${esc(i.title)}</a>`
    + `<div class="sub">${esc(i.where)} · ${esc(i.assignee)}</div></td>${extra}</tr>`;
  fillList("#t-overdue", overdue.sort((a, b) => a.due - b.due),
    (i) => row(i, `<td class="num bad">${days(i.due, t0)} d late</td>`), "Nothing overdue.");
  fillList("#t-due", open.filter((i) => i.due && i.due >= t0 && i.due < new Date(t0.getTime() + 15 * DAY))
    .sort((a, b) => a.due - b.due),
    (i) => row(i, `<td class="num">${fmtDate(i.due)}</td>`), "Nothing due in the next two weeks.");
  fillList("#t-recent", list.slice().sort((a, b) => b.updated - a.updated).slice(0, 12),
    (i) => row(i, `<td class="num">${fmtDate(i.updated)}<div class="sub">${esc(i.lastBy)}`
      + `${describeLast(i)}</div></td>`), "No activity yet.");
  fillList("#t-stale", open.filter((i) => Date.now() - i.updated.getTime() > 14 * DAY)
    .sort((a, b) => a.updated - b.updated),
    (i) => row(i, `<td class="num">${days(i.updated, Date.now())} d</td>`), "Nothing has gone quiet.");
}

function describeLast(i) {
  const h = i.history[i.history.length - 1];
  if (!h) return "";
  if (h.event === "created") return " raised it";
  if (h.event === "comment") return " commented";
  if (h.event === "file") return h.to ? " linked a file" : " removed a file link";
  if (h.field === "status") return " → " + esc(h.to);
  if (h.field === "assigned_to") return " assigned " + esc(h.to || "nobody");
  if (h.field === "due_date") return " due " + esc(h.to || "none");
  return " changed " + esc(h.field || "");
}

function issueLink(i) {
  const p = i.project || project();
  return i.is3d ? link("model.html", { project: p, select: i.id }) : link("index.html", { project: p, sheet: i.sheet, select: i.id });
}

function fillList(sel, rows, fn, empty) {
  const t = $(sel);
  t.innerHTML = rows.length ? rows.slice(0, 50).map(fn).join("")
    : `<tr><td class="empty">${empty}</td></tr>`;
}

function tally(list, key) {
  const m = new Map();
  for (const i of list) m.set(key(i), (m.get(key(i)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------------------------------------------------- responsibility */

function peopleTable(list, t0, soon) {
  const by = new Map();
  for (const i of list) {
    if (!by.has(i.assignee)) by.set(i.assignee, []);
    by.get(i.assignee).push(i);
  }
  const rows = [...by.entries()].map(([name, is]) => {
    const open = is.filter((i) => i.open);
    const oldest = open.length ? Math.max(...open.map((i) => days(i.created, Date.now()))) : null;
    const last = new Date(Math.max(...is.map((i) => i.updated.getTime())));
    return {
      name, office: is[0].office, team: is[0].team,
      open: is.filter((i) => i.status === "Open").length,
      prog: is.filter((i) => i.status === "In progress").length,
      overdue: open.filter((i) => i.due && i.due < t0).length,
      soon: open.filter((i) => i.due && i.due >= t0 && i.due < soon).length,
      resolved: is.filter((i) => i.status === "Resolved").length,
      closed: is.filter((i) => i.status === "Closed").length,
      total: is.length, oldest, last,
    };
  }).sort((a, b) => (b.overdue - a.overdue) || ((b.open + b.prog) - (a.open + a.prog)));
  const maxOpen = Math.max(1, ...rows.map((r) => r.open + r.prog));
  $("#t-people").innerHTML =
    `<thead><tr><th>Assigned to</th><th>Office</th><th>Team</th><th class="num">Open</th><th class="num">In progress</th>`
    + `<th class="num">Overdue</th><th class="num">Due ≤7 d</th><th class="num">Resolved</th>`
    + `<th class="num">Closed</th><th class="num">Total</th><th class="num">Oldest open</th>`
    + `<th>Last activity</th><th class="barcol"></th></tr></thead><tbody>`
    + (rows.length ? rows.map((r) =>
      `<tr class="${F.assignee === r.name ? "on" : ""}" data-name="${esc(r.name)}">`
      + `<td>${esc(r.name)}</td><td>${esc(r.office)}</td><td>${esc(r.team && r.team !== "-" ? r.team : "")}</td>`
      + `<td class="num">${r.open}</td><td class="num">${r.prog}</td>`
      + `<td class="num ${r.overdue ? "bad" : ""}">${r.overdue}</td>`
      + `<td class="num ${r.soon ? "warn" : ""}">${r.soon}</td>`
      + `<td class="num">${r.resolved}</td><td class="num">${r.closed}</td><td class="num">${r.total}</td>`
      + `<td class="num">${r.oldest === null ? "-" : r.oldest + " d"}</td><td>${fmtDate(r.last)}</td>`
      + `<td class="barcol"><span class="minibar"><i style="width:${(r.open + r.prog) / maxOpen * 100}%"></i></span></td></tr>`
    ).join("") : `<tr><td colspan="13" class="empty">No issues in this filter.</td></tr>`)
    + `</tbody>`;
  document.querySelectorAll("#t-people tbody tr[data-name]").forEach((tr) => {
    tr.onclick = () => {
      F.assignee = F.assignee === tr.dataset.name ? "" : tr.dataset.name;
      $("#f-assignee").value = F.assignee;
      render();
    };
  });
}

function officeChart(open, t0) {
  const offices = tally(open, (i) => i.office).filter(([k]) => k !== "-" && k !== "?");
  $("#by-office-card").hidden = !offices.length;
  bars("#c-office", offices.map(([k, v]) => ({
    label: k, value: v, color: "#2a78d6",
    note: `${open.filter((i) => i.office === k && i.due && i.due < t0).length} overdue`,
    onClick: () => { F.office = k; $("#f-office").value = k; render(); },
  })));
}

/* -------------------------------------------------------------- charts */

// every bar list in the one orange of the template, on a stone track
const BAR = "#F08020";
// the status ring in the template's stone ramp, open in orange
const RING = { "Open": "#F08020", "In progress": "#a8a29e", "Resolved": "#57534e", "Closed": "#1c1917", "Not an issue": "#e7e5e4" };
function bars(sel, data) {
  const el = $(sel);
  if (!data.length || !data.some((d) => d.value)) { el.innerHTML = `<p class="empty">Nothing to show.</p>`; return; }
  const max = Math.max(...data.map((d) => d.value), 1);
  el.innerHTML = `<div class="hbars">` + data.map((d, n) =>
    `<div class="hbar${d.onClick ? " click" : ""}" data-n="${n}"><span class="lab" title="${esc(d.label)}">${esc(d.label)}</span>`
    + `<span class="track"><i style="width:${d.value / max * 100}%;background:${BAR}"></i></span>`
    + `<span class="val">${d.value}${d.note ? `<small> ${esc(d.note)}</small>` : ""}</span></div>`).join("") + `</div>`;
  el.querySelectorAll(".hbar.click").forEach((row) => { row.onclick = data[+row.dataset.n].onClick; });
}

function donut(sel, data) {
  const el = $(sel);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) { el.innerHTML = `<p class="empty">No issues yet.</p>`; return; }
  const R = 60, r = 38, cx = 70, cy = 70;
  let a0 = -Math.PI / 2;
  const arcs = data.filter((d) => d.value).map((d) => {
    const a1 = a0 + d.value / total * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const full = d.value === total;
    const path = full
      ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${cx - r},${cy} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0`
      : `M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${big} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return `<path d="${path}" fill="${d.color}" fill-rule="evenodd"><title>${esc(d.label)}: ${d.value}</title></path>`;
  }).join("");
  el.innerHTML = `<div class="donut"><svg viewBox="0 0 140 140" width="140" height="140">${arcs}`
    + `<text x="70" y="68" text-anchor="middle" class="big">${total}</text>`
    + `<text x="70" y="86" text-anchor="middle" class="small">issues</text></svg>`
    + `<ul>${data.map((d) => `<li><i style="background:${d.color}"></i>${esc(d.label)}<b>${d.value}</b>`
      + `<small>${total ? Math.round(d.value / total * 100) : 0}%</small></li>`).join("")}</ul></div>`;
}

function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));        // Monday
  return x;
}

/* Raised and closed per week as paired columns, drawn at the chart's real
   pixel size (the old one was stretched with preserveAspectRatio="none",
   which squashed the dots and the dates), with the open total beside it as
   its own small area chart - a different quantity, so not on the same axis.
   Hover (or tap) a week for its numbers. */
// the template's chart colours: orange for raised (and the open line), charcoal for resolved
const C_RAISED = "#F08020", C_CLOSED = "#44403c", C_OPEN = "#F08020";
let _trendRows = null, _trendObs = null;

function trendChart(list) {
  const el = $("#c-trend");
  const all = list.filter((i) => !i.dismissed);
  const W = 12;
  const start = weekStart(new Date(Date.now() - (W - 1) * 7 * DAY));
  const weeks = Array.from({ length: W }, (_, k) => new Date(start.getTime() + k * 7 * DAY));
  _trendRows = weeks.map((w) => {
    const end = new Date(w.getTime() + 7 * DAY);
    return {
      w,
      raised: all.filter((i) => i.created >= w && i.created < end).length,
      closed: all.filter((i) => i.closed && i.closed >= w && i.closed < end).length,
      open: all.filter((i) => i.created < end && (!i.closed || i.closed >= end)).length,
    };
  });
  if (!el.dataset.built) {
    el.dataset.built = "1";
    el.innerHTML = `<div class="trend-wrap">
        <div class="trend-main"><div class="trend-plot" id="tr-cols"></div>
          <div class="legend"><span><i style="background:${C_RAISED}"></i>Raised</span>
          <span><i style="background:${C_CLOSED}"></i>Resolved (or closed)</span></div></div>
        <div class="trend-side"><div class="hero"><b id="tr-open">0</b><span>open now</span>
          <small id="tr-delta"></small></div><div class="trend-plot small" id="tr-area"></div></div>
      </div><div class="viz-tip" id="tr-tip" hidden></div>`;
    // Redrawn at the new size when the card changes width (rotation, window).
    if (window.ResizeObserver) {
      let last = 0;
      _trendObs = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (Math.abs(w - last) > 4) { last = w; drawTrend(); }
      });
      _trendObs.observe(el);
    }
  }
  drawTrend();
}

const shortDay = (d) => day(d);

function drawTrend() {
  const rows = _trendRows;
  if (!rows) return;
  const box = $("#tr-cols"), side = $("#tr-area"), tip = $("#tr-tip");
  const Wpx = Math.max(240, Math.floor(box.clientWidth)), Hpx = 210;
  const L = 34, R = 8, T = 18, B = 26;
  const n = rows.length, cw = (Wpx - L - R) / n;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.raised, r.closed)));
  const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; };
  const top = max < 5 ? max + (max % 2 ? 1 : 0) || 2 : nice(max);
  const y = (v) => T + (Hpx - T - B) * (1 - v / top);
  const bw = Math.min(24, Math.max(4, (cw - 8) / 2 - 1));     // two columns, 2px apart
  const col = (x, v, color, label) => {
    if (!v) return `<rect x="${x}" y="${Hpx - B - 1}" width="${bw}" height="1" fill="${color}" opacity=".5"/>`;
    const y0 = Hpx - B, y1 = y(v), r = Math.min(4, bw / 2, y0 - y1);
    return `<path d="M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z" fill="${color}"/>`
      + (label ? `<text x="${x + bw / 2}" y="${y1 - 4}" text-anchor="middle" class="val">${v}</text>` : "");
  };
  const ticks = [0, top / 2, top].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  let svg = ticks.map((t) => `<line x1="${L}" x2="${Wpx - R}" y1="${y(t)}" y2="${y(t)}" class="${t ? "gl" : "base"}"/>`
    + `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}</text>`).join("");
  const every = cw < 34 ? (cw < 20 ? 3 : 2) : 1;               // dates never overlap
  const labels = bw >= 12;                                    // numbers only where they fit
  rows.forEach((r, k) => {
    const cx = L + k * cw + cw / 2;
    svg += `<rect class="band" data-k="${k}" x="${L + k * cw}" y="${T - 10}" width="${cw}" height="${Hpx - T - B + 10}"/>`;
    svg += col(cx - bw - 1, r.raised, C_RAISED, labels) + col(cx + 1, r.closed, C_CLOSED, labels);
    if ((n - 1 - k) % every === 0) {
      svg += `<text x="${cx}" y="${Hpx - 8}" text-anchor="middle" class="ax${k === n - 1 ? " now" : ""}">`
        + `${k === n - 1 ? "This wk" : shortDay(r.w)}</text>`;
    }
  });
  box.innerHTML = `<svg width="${Wpx}" height="${Hpx}" viewBox="0 0 ${Wpx} ${Hpx}" class="trend" role="img"
    aria-label="Issues raised and resolved per week, last 12 weeks">${svg}</svg>`;

  // the open total: its own small area chart, same weeks
  const sw = Math.max(160, Math.floor(side.clientWidth)), sh = 110, sT = 12, sB = 18, sL = 6, sR = 30;
  const omax = Math.max(1, ...rows.map((r) => r.open));
  const sx = (k) => sL + k * (sw - sL - sR) / (n - 1);
  const sy = (v) => sT + (sh - sT - sB) * (1 - v / omax);
  const line = rows.map((r, k) => `${k ? "L" : "M"}${sx(k).toFixed(1)},${sy(r.open).toFixed(1)}`).join(" ");
  const last = rows[n - 1];
  side.innerHTML = `<svg width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" class="trend" role="img"
      aria-label="Open issues at the end of each week">
    <defs><linearGradient id="tr-g" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${C_OPEN}" stop-opacity=".28"/><stop offset="1" stop-color="${C_OPEN}" stop-opacity=".03"/></linearGradient></defs>
    <line x1="${sL}" x2="${sw - sR}" y1="${sh - sB}" y2="${sh - sB}" class="base"/>
    <path d="${line} L${sx(n - 1)},${sh - sB} L${sx(0)},${sh - sB} Z" fill="url(#tr-g)"/>
    <path d="${line}" fill="none" stroke="${C_OPEN}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sx(n - 1)}" cy="${sy(last.open)}" r="4.5" fill="${C_OPEN}" stroke="#fff" stroke-width="2"/>
    <text x="${sx(n - 1) + 8}" y="${sy(last.open) + 4}" class="val">${last.open}</text>
    <text x="${sL}" y="${sh - 4}" class="ax">${shortDay(rows[0].w)}</text>
    <text x="${sw - sR}" y="${sh - 4}" text-anchor="end" class="ax">now</text></svg>`;
  $("#tr-open").textContent = last.open;
  const d = last.open - rows[n - 5].open;
  $("#tr-delta").textContent = d === 0 ? "same as 4 weeks ago"
    : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} in 4 weeks`;
  $("#tr-delta").className = d > 0 ? "up" : d < 0 ? "down" : "";

  // hover / tap: one week's numbers
  const svgEl = box.querySelector("svg");
  const show = (k, ev) => {
    const r = rows[k];
    svgEl.querySelectorAll(".band").forEach((b) => b.classList.toggle("on", +b.dataset.k === k));
    tip.innerHTML = `<b>Week of ${shortDay(r.w)}</b>
      <div><i style="background:${C_RAISED}"></i>Raised <b>${r.raised}</b></div>
      <div><i style="background:${C_CLOSED}"></i>Resolved <b>${r.closed}</b></div>
      <div><i style="background:${C_OPEN}"></i>Open at week end <b>${r.open}</b></div>`;
    tip.hidden = false;
    const host = $("#c-trend").getBoundingClientRect();
    const bx = L + k * cw + cw / 2 + box.getBoundingClientRect().left - host.left;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(host.width - tw, bx - tw / 2)) + "px";
    tip.style.top = "0px";
  };
  const hide = () => { tip.hidden = true; svgEl.querySelectorAll(".band.on").forEach((b) => b.classList.remove("on")); };
  svgEl.querySelectorAll(".band").forEach((b) => {
    b.addEventListener("pointerenter", (ev) => show(+b.dataset.k, ev));
    b.addEventListener("pointerdown", (ev) => show(+b.dataset.k, ev));
  });
  svgEl.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hide(); });
}

/* ----------------------------------------------------------------- CSV */

/* The issues in the filter as BCF (bcf.js, the same as the 3D page's). */
async function exportBcf() {
  const ids = new Set(filtered().map((i) => i.id));
  const items = D.items.filter((it) => ids.has(it.id));
  try {
    const { buildBcf, download } = await import("./bcf.js");
    const name = (D.manifest && D.manifest.source && D.manifest.source.title) || project() || "issues";
    const r = await buildBcf(items, name);
    download(r.blob, `${String(name).replace(/[^\w.-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.bcfzip`, "BCF");
    $("#d-updated").textContent = `BCF: ${r.count} issue(s), ${r.withCamera} with a camera, ${r.withSnapshot} with a picture`;
  } catch (e) { $("#d-updated").textContent = "BCF: " + (e.message || e); }
}

function exportCsv() {
  const cols = (multi() ? ["Part"] : []).concat(["No", "Title", "Type", "Priority", "Status", "Assigned to", "Office", "Team", "Due", "Raised",
                "Raised by", "Updated", "Last change by", "Closed", "Where"]);
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");
  const lines = [cols.map(q).join(",")].concat(filtered().map((i) => (multi() ? [i.part] : []).concat([
    i.number || "", i.title, (TYPE.get(i.type) || { label: i.type }).label, i.priority, i.status, i.assignee, i.office, i.team,
    iso(i.due), iso(i.created), i.author, iso(i.updated), i.lastBy, iso(i.closed), i.where,
  ]).map(q).join(",")));
  // A byte-order mark, so Excel reads accented and Chinese names correctly.
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const name = `${multi() ? String(SC.name || "projects").replace(/[^\w.-]+/g, "_") : project()}-issues-${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  import("./tofolders.js").then((m) => m.offerSave(blob, name, "Issues")).catch(() => {});
}

/* ------------------------------------------------------------------ go */

function showError(e) {
  $("#d-msg").textContent = "Could not load: " + (e && e.message ? e.message : e);
}

async function main() {
  wireFilters();
  await ensureSignedIn();
  await resolveScope();
  scopeBar();
  const kept = await showKept().catch(() => false);   // from the device, before the server answers
  if (D.me.user && D.me.user.must_change) {
    location.href = "admin.html?first=1&next=" + encodeURIComponent(location.pathname + location.search) + "#account";
    return;
  }
  $("#d-who").textContent = D.me.user ? D.me.user.name : "";
  const so = $("#d-signout");
  so.hidden = !D.me.user;
  so.onclick = (ev) => { ev.preventDefault(); signOut(); };
  const manages = D.me.site_admin || Object.values(D.me.projects || {}).includes("admin");
  $("#to-admin").hidden = !(D.me.accounts && manages);
  if (!(await loadProjects())) return;
  $("#to-sheets").href = link("index.html");
  $("#to-3d").href = link("model.html");
  if ($("#to-board")) $("#to-board").href = link("board.html");
  if ($("#to-tasks")) $("#to-tasks").href = link("tasks.html");
  if ($("#to-projects")) $("#to-projects").href = link("projects.html");
  if ($("#to-chat")) $("#to-chat").href = link("messenger.html");
  $("#to-admin").href = link("admin.html");
  if (kept) {
    // drawn from the device; the server's answer follows
    loadData().catch((e) => { $("#d-msg").textContent = "Shown as last time on this device - the server did not answer (" + (e.message || e) + ")."; });
  } else await loadData();
  projectTasks().catch(() => {});
  lvSummary().catch(() => {});
  // Keep it current while it is left open on a screen in the office.
  setInterval(() => { if (!document.hidden) loadData().catch(() => {}); }, 120000);
  // "Updated 2 min ago" stays true between refreshes
  setInterval(() => { if (D.fetched) $("#d-updated").textContent = "Updated " + dateAgo(D.fetched); }, 30000);
}

main().catch(showError);


/* The project's tasks - from every team's task list that has a group for
   it (Tasks page). Shown only when the project is on the Projects page. */
async function projectTasks() {
  const all = (await api("/api/registry?lite=1")).projects || [];
  const regs = SC.regs.length ? all.filter((p) => SC.regs.includes(p.id))
    : all.filter((p) => (p.viewers || []).includes(project()) || p.viewer === project()).slice(0, 1);
  if (!regs.length) return;
  const out = [];
  for (const reg of regs) out.push({ reg, tree: (await api(`/api/registry/${encodeURIComponent(reg.id)}/tasks`)).groups || [] });
  K.ptasks = out; keepDash();
  drawAllTasks(out);
}

function drawAllTasks(list) {
  const box = document.getElementById("d-tasks");
  if (!box || !Array.isArray(list) || !list.length) return;
  box.hidden = false;
  box.innerHTML = list.map((x) => `<div class="dt-one">${drawProjectTasks(x.reg, x.tree)}</div>`).join("");
}

function drawProjectTasks(reg, tree0) {
  const tree = JSON.parse(JSON.stringify(tree0));   // the rows get links to their group below
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const all = tree.flatMap((g) => g.tasks.map((t) => Object.assign(t, { _g: g })));
  const open = all.filter((t) => !t.done);
  const late = open.filter((t) => t.due && t.due.slice(0, 10) < today);
  const subs = all.reduce((n, t) => n + (t.children || []).length, 0);
  const subsDone = all.reduce((n, t) => n + (t.children || []).filter((k) => k.done).length, 0);
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  open.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return `<h3>Tasks <small>${esc(reg.short || reg.name)} - from the team task lists</small><a href="projects.html?p=${esc(reg.id)}">Project page</a></h3>`
    + (all.length ? `<div class="dt-k"><span><b>${all.length}</b>tasks</span><span><b>${all.length - open.length}</b>done</span>`
      + `<span class="${late.length ? "bad" : ""}"><b>${late.length}</b>overdue</span><span><b>${subsDone}/${subs}</b>sub-tasks done</span></div>`
      + tree.map((g) => `<div class="dt-g">${esc(g.list_title)} / <b>${esc(g.group.title)}</b> · <a href="tasks.html?list=${esc(g.list_id)}">open the list</a></div>`).join("")
      + open.slice(0, 12).map((t) => `<a class="dt-row" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}"><span class="t">${esc(t.title || "Untitled")}</span>`
        + ((t.children || []).length ? `<small>${t.children.filter((k) => k.done).length}/${t.children.length} sub-tasks</small>` : "")
        + `<small>${esc((t.owners || []).map((p) => p.name).join(", "))}</small>`
        + (t.due ? `<small class="${t.due.slice(0, 10) < today ? "late" : ""}">${esc(t.due.slice(0, 10) < today ? overdueBy(t.due.slice(0, 10)) : "due " + day(t.due.slice(0, 10)))}</small>` : `<small class="nodue">No due date</small>`) + `</a>`).join("")
      + (open.length > 12 ? `<div class="dt-g">and ${open.length - 12} more open</div>` : "")
      : `<p class="muted" style="font-size:12px">No task list has a group for this project yet. In Tasks: ... &rarr; Groups and projects.</p>`);
}


/* Light & Vent: the Revit check's last result for this project (lv_api.py). */
async function lvSummary() {
  if (!multi()) {
    const sm = await api("/api/lv?summary=1", { headers: { "X-Project": SC.parts[0] || project() } });
    K.lv = sm; keepDash();
    drawLv(sm);
    return;
  }
  // several parts: the counts added up, a line per part that has a result
  const got = await Promise.all(SC.parts.map((p) => api("/api/lv?summary=1", { headers: { "X-Project": p } }).then((sm) => [p, sm]).catch(() => [p, null])));
  const have = got.filter(([, sm]) => sm && sm.report);
  if (!have.length) { K.lv = null; drawLv(null); return; }
  const counts = {}, towers = {};
  for (const [p, sm] of have) {
    for (const [k, n] of Object.entries(sm.counts || {})) counts[k] = (counts[k] || 0) + (n || 0);
    towers[partLabel(p)] = sm.counts || {};
  }
  const last = have.map(([, sm]) => sm).sort((a, b) => String(b.at || b.sent_at || "").localeCompare(String(a.at || a.sent_at || "")))[0];
  const sm = { report: true, multi: true, counts, towers, model: have.length + " part" + (have.length === 1 ? "" : "s"), at: last.at || last.sent_at, by: last.by };
  K.lv = sm; keepDash();
  drawLv(sm);
}

function drawLv(sm) {
  const box = document.getElementById("d-lv");
  if (!box) return;
  if (!sm || !sm.report) { box.hidden = true; return; }
  const c = sm.counts || {};
  box.hidden = false;
  box.innerHTML = `<h3>Light &amp; Ventilation <small>${esc(sm.model || "")} · checked ${esc(dayTime(sm.at || sm.sent_at))}${sm.by ? " by " + esc(sm.by) : ""}</small>`
    + `<a href="${esc(link("model.html", { checks: "lv" }))}">Table</a></h3>`
    + `<div class="dt-k"><span><b>${c.OK || 0}</b>OK</span><span class="${c["NOT OK"] ? "bad" : ""}"><b>${c["NOT OK"] || 0}</b>not OK</span>`
    + `<span><b>${c["NEEDS DATA"] || 0}</b>need data</span><span class="${c["NO WINDOW"] ? "bad" : ""}"><b>${c["NO WINDOW"] || 0}</b>no window</span>`
    + `<span><b>${c.merged || 0}</b>counted with another room</span></div>`
    + (Object.keys(sm.towers || {}).length > 1 ? `<div class="dt-g">` + Object.entries(sm.towers).map(([t, k]) =>
      `<b>${esc(t)}</b>: ${k.OK || 0} OK · <span class="${k["NOT OK"] ? "bad" : ""}">${k["NOT OK"] || 0} not OK</span> · `
      + `${k["NEEDS DATA"] || 0} need data · ${k["NO WINDOW"] || 0} no window`).join("<br>") + `</div>` : "")
    + `<p class="muted" style="font-size:12px">On the plan sheets: <a href="${esc(link("index.html"))}">Sheets</a> &gt; View &gt; Light &amp; Vent`
    + (sm.multi ? ` · open one part for its full report` : ` · <a href="#" data-lv="report">Full report</a>`)
    + `${sm.pdf ? ` · <a href="#" data-lv="pdf">Diagrams (PDF)</a>` : ""}</p>`;
  if (sm.multi) return;
  box.querySelector('[data-lv="report"]').onclick = async (ev) => {
    ev.preventDefault();
    const win = window.open("", "_blank");
    const LVR = await import("./lv.js");
    LVR.openReport(await LVR.loadReport(true), win);
  };
  const pd = box.querySelector('[data-lv="pdf"]');
  if (pd) pd.onclick = async (ev) => { ev.preventDefault(); (await import("./lv.js")).openPdf(); };
}
