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
const LWK_VERSION = "2026-10-03a";
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
import { api, link, project, signOut, projectOptions } from "./nav.js";
import { ISSUE_TYPES } from "./issuetypes.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DAY = 86400000;
const CLOSED = new Set(["Resolved", "Closed"]);
const STATUS_COLORS = { "Open": "#e2453c", "In progress": "#e8a13a", "Resolved": "#3b82f6",
                        "Closed": "#0e9f6e", "Not an issue": "#9ca3af" };
const PRIORITY_ORDER = ["Critical", "High", "Normal", "Low"];
const PRIORITY_COLORS = { Critical: "#b91c1c", High: "#f28022", Normal: "#6b7280", Low: "#9ca3af" };
const TYPE = new Map(ISSUE_TYPES.map((t) => [t.id, t]));
const UNASSIGNED = "(unassigned)";

const D = { manifest: null, items: [], members: [], me: null, issues: [], fetched: null };

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
  localStorage.setItem("lwk-viewer:project", want);
  history.replaceState(null, "", "dashboard.html?project=" + encodeURIComponent(want));
  sel.onchange = () => {
    localStorage.setItem("lwk-viewer:project", sel.value);
    location.href = "dashboard.html?project=" + encodeURIComponent(sel.value);
  };
  return true;
}

async function loadData() {
  $("#d-msg").textContent = "Loading ...";
  const [man, items, mem] = await Promise.all([
    fetch("/data/" + encodeURIComponent(project()) + "/manifest.json").then((r) => (r.ok ? r.json() : null)),
    api("/api/items?since=0"),
    api("/api/members").catch(() => ({ members: [] })),
  ]);
  D.manifest = man;
  D.items = (items.items || []).filter((it) => !it.deleted);
  D.members = mem.members || [];
  D.fetched = new Date();
  D.issues = D.items.filter((it) => it.issue).map(toIssue);
  $("#d-msg").textContent = "";
  $("#d-updated").textContent = "as of " + D.fetched.toLocaleTimeString();
  fillFilters();
  render();
  loadDigest().catch(() => {});
  loadExports().catch(() => {});
}

/* How the project is published: one row per Revit file (from what each
   upload says about itself), and what of it is in the viewer now. */
async function loadExports() {
  const box = $("#exports-body");
  if (!box) return;
  let ex = {};
  try { ex = (await api("/api/projects/" + encodeURIComponent(project()) + "/exports")).exports || {}; } catch (e) { ex = {}; }
  const sheets = (D.manifest && D.manifest.sheets) || [];
  const bySrc = new Map();
  for (const sh of sheets) {
    const k = sh.source || (D.manifest.source && D.manifest.source.title) || "";
    if (!bySrc.has(k)) bySrc.set(k, { sheets: 0, areas: 0, rows: 0, numbers: [] });
    const b = bySrc.get(k);
    b.sheets++; b.numbers.push(sh.number);
    b.areas += new Set((sh.areas || []).map((a) => a.uid)).size;
    for (const sc of sh.schedules || []) b.rows += (sc.rows || []).length;
  }
  const names = Array.from(new Set(Object.keys(ex).concat(Array.from(bySrc.keys())))).filter((n) => n || bySrc.size === 1);
  if (!names.length) { box.textContent = "Nothing published yet."; return; }
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const models = (D.manifest && D.manifest.models) || [];
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
  try {
    const pj = (await api("/api/publish-jobs?project=" + encodeURIComponent(project()))).jobs || [];
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
  } catch (e) { /* an older server: no list */ }
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
  const box = $("#digest");
  box.hidden = false;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const people = (d.by_person || []).map(([k, n]) => `${esc(k)} <b>${n}</b>`).join(" &middot; ");
  const od = (d.overdue_list || []).map((o) =>
    `<li><a href="${issueLink({ id: o.id, sheet: o.sheet, is3d: !o.sheet })}">#${o.number || "?"} ${esc(o.title)}</a>`
    + ` <span class="muted">${esc(o.assigned_to || "unassigned")}, due ${esc(o.due_date)}</span></li>`).join("");
  $("#dg-body").innerHTML = `<div class="dg-nums">`
    + `<span><b>${d.raised}</b> raised</span><span><b>${d.closed}</b> closed</span>`
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

function sheetName(num) {
  const s = ((D.manifest && D.manifest.sheets) || []).find((x) => x.number === num);
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
  const where = it.sheet ? sheetName(it.sheet)
    : (it.placement === "3d" ? "3D model" : "Other");
  const lastBy = (iss.history && iss.history.length && iss.history[iss.history.length - 1].by)
    || it.updated_by || iss.author || it.author || "";
  return {
    id: it.id, number: iss.number || null, sheet: it.sheet || null, is3d: it.placement === "3d",
    title: iss.title || "Issue", type: iss.type || "general",
    priority: iss.priority || "Normal", status, dismissed,
    open: !CLOSED.has(status) && !dismissed, created, updated, closed, due,
    assignee, office: m ? (m.office || "-") : (assignee === UNASSIGNED ? "-" : "?"),
    team: m ? (m.team || "-") : "-", discipline: m ? (m.discipline || "-") : "-",
    author: iss.author || it.author || "", where, lastBy, history: iss.history || [],
  };
}

/* ------------------------------------------------------------ filters */

const F = { range: 90, type: "", assignee: "", office: "", team: "", disc: "", mine: false, dismissed: false };

function fillFilters() {
  const types = [...new Set(D.issues.map((i) => i.type))];
  $("#f-type").innerHTML = `<option value="">All types</option>` + types
    .map((t) => `<option value="${esc(t)}">${esc((TYPE.get(t) || { label: t }).label)}</option>`).join("");
  const people = [...new Set(D.issues.map((i) => i.assignee))].sort();
  $("#f-assignee").innerHTML = `<option value="">Everyone</option>` + people
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  const offices = [...new Set(D.members.map((m) => m.office).filter(Boolean))].sort();
  $("#f-office").innerHTML = `<option value="">All offices</option>` + offices
    .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
  $("#f-office").closest("label").hidden = !offices.length;
  // the people's team and discipline (Admin page), when they have been set
  for (const [id, key, all] of [["#f-team", "team", "All teams"], ["#f-disc", "discipline", "All disciplines"]]) {
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
  $("#d-csv").onclick = exportCsv;
  $("#d-report").onclick = () => {
    // The report shows exactly what the filters show here.
    sessionStorage.setItem("lwk-report:" + project(), JSON.stringify(filtered().map((i) => i.id)));
    window.open(link("report.html"), "_blank");
  };
}

/* ------------------------------------------------------------- render */

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const days = (a, b) => Math.floor((b - a) / DAY);
const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "");

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

  const kpi = (label, value, cls, hint, color, icon) =>
    `<div class="kpi ${cls || ""}" style="--c:${color}" title="${esc(hint || "")}">`
    + `<span class="ic">${icon}</span><b>${value}</b><span class="lab">${label}</span></div>`;
  $("#kpis").innerHTML = [
    kpi("Issues", list.length, "", "All issues in the current filter", "#2a78d6", "&#9776;"),
    kpi("Open", count("Open"), "st-open", "", STATUS_COLORS["Open"], "&#9679;"),
    kpi("In progress", count("In progress"), "st-prog", "", STATUS_COLORS["In progress"], "&#9680;"),
    kpi("Resolved", count("Resolved"), "st-res", "", STATUS_COLORS["Resolved"], "&#10003;"),
    kpi("Closed", count("Closed"), "st-closed", "", STATUS_COLORS["Closed"], "&#10004;"),
    kpi("Overdue", overdue.length, overdue.length ? "bad" : "", "Open with a due date before today", "#e2453c", "!"),
    kpi("Due in 7 days", dueSoon.length, dueSoon.length ? "warn" : "", "", "#e8a13a", "&#9200;"),
    kpi("Unassigned", open.filter((i) => i.assignee === UNASSIGNED).length, "", "Open issues nobody holds", "#4a3aa7", "?"),
    kpi("Avg days open", avgOpen.toFixed(0), "", "Age of the issues still open", "#e87ba4", "&#8987;"),
    kpi("Avg days to close", closedList.length ? avgClose.toFixed(0) : "-", "", "Raised to resolved/closed", "#1baf7a", "&#8635;"),
  ].join("");

  trendChart(list);
  donut("#c-status", ["Open", "In progress", "Resolved", "Closed"].concat(F.dismissed ? ["Not an issue"] : [])
    .map((s) => ({ label: s, value: count(s), color: STATUS_COLORS[s] })));
  bars("#c-type", tally(open, (i) => i.type).map(([k, v]) =>
    ({ label: (TYPE.get(k) || { label: k }).label, value: v, color: (TYPE.get(k) || {}).color || "#6b7280",
       onClick: () => { F.type = k; $("#f-type").value = k; render(); } })));
  bars("#c-priority", PRIORITY_ORDER.map((p) =>
    ({ label: p, value: open.filter((i) => i.priority === p).length, color: PRIORITY_COLORS[p] })));
  bars("#c-where", tally(open, (i) => i.where).slice(0, 10).map(([k, v]) =>
    ({ label: k, value: v, color: "#4a3aa7" })));
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
  return i.is3d ? link("model.html", { select: i.id }) : link("index.html", { sheet: i.sheet, select: i.id });
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

function bars(sel, data) {
  const el = $(sel);
  if (!data.length || !data.some((d) => d.value)) { el.innerHTML = `<p class="empty">Nothing to show.</p>`; return; }
  const max = Math.max(...data.map((d) => d.value), 1);
  el.innerHTML = `<div class="hbars">` + data.map((d, n) =>
    `<div class="hbar${d.onClick ? " click" : ""}" data-n="${n}"><span class="lab" title="${esc(d.label)}">${esc(d.label)}</span>`
    + `<span class="track"><i style="width:${d.value / max * 100}%;background:${d.color}"></i></span>`
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
const C_RAISED = "#2a78d6", C_CLOSED = "#1baf7a", C_OPEN = "#eb6834";
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
          <span><i style="background:${C_CLOSED}"></i>Closed</span></div></div>
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

const shortDay = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

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
    aria-label="Issues raised and closed per week, last 12 weeks">${svg}</svg>`;

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
      <div><i style="background:${C_CLOSED}"></i>Closed <b>${r.closed}</b></div>
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

function exportCsv() {
  const cols = ["No", "Title", "Type", "Priority", "Status", "Assigned to", "Office", "Team", "Due", "Raised",
                "Raised by", "Updated", "Last change by", "Closed", "Where"];
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const iso = (d) => (d ? d.toISOString().slice(0, 10) : "");
  const lines = [cols.map(q).join(",")].concat(filtered().map((i) => [
    i.number || "", i.title, (TYPE.get(i.type) || { label: i.type }).label, i.priority, i.status, i.assignee, i.office, i.team,
    iso(i.due), iso(i.created), i.author, iso(i.updated), i.lastBy, iso(i.closed), i.where,
  ].map(q).join(",")));
  // A byte-order mark, so Excel reads accented and Chinese names correctly.
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project()}-issues-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ go */

function showError(e) {
  $("#d-msg").textContent = "Could not load: " + (e && e.message ? e.message : e);
}

async function main() {
  await ensureSignedIn();
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
  wireFilters();
  await loadData();
  projectTasks().catch(() => {});
  // Keep it current while it is left open on a screen in the office.
  setInterval(() => { if (!document.hidden) loadData().catch(() => {}); }, 120000);
}

main().catch(showError);


/* The project's tasks - from every team's task list that has a group for
   it (Tasks page). Shown only when the project is on the Projects page. */
async function projectTasks() {
  const box = document.getElementById("d-tasks");
  const reg = ((await api("/api/registry")).projects || [])
    .find((p) => (p.viewers || []).includes(project()) || p.viewer === project());
  if (!reg) return;
  const tree = (await api(`/api/registry/${encodeURIComponent(reg.id)}/tasks`)).groups || [];
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const all = tree.flatMap((g) => g.tasks.map((t) => Object.assign(t, { _g: g })));
  const open = all.filter((t) => !t.done);
  const late = open.filter((t) => t.due && t.due.slice(0, 10) < today);
  const subs = all.reduce((n, t) => n + (t.children || []).length, 0);
  const subsDone = all.reduce((n, t) => n + (t.children || []).filter((k) => k.done).length, 0);
  const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  open.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  box.hidden = false;
  box.innerHTML = `<h3>Tasks <small>${esc(reg.short || reg.name)} - from the team task lists</small><a href="projects.html?p=${esc(reg.id)}">Project page</a></h3>`
    + (all.length ? `<div class="dt-k"><span><b>${all.length}</b>tasks</span><span><b>${all.length - open.length}</b>done</span>`
      + `<span class="${late.length ? "bad" : ""}"><b>${late.length}</b>overdue</span><span><b>${subsDone}/${subs}</b>sub-tasks done</span></div>`
      + tree.map((g) => `<div class="dt-g">${esc(g.list_title)} / <b>${esc(g.group.title)}</b> · <a href="tasks.html?list=${esc(g.list_id)}">open the list</a></div>`).join("")
      + open.slice(0, 12).map((t) => `<a class="dt-row" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}"><span class="t">${esc(t.title || "Untitled")}</span>`
        + ((t.children || []).length ? `<small>${t.children.filter((k) => k.done).length}/${t.children.length} sub-tasks</small>` : "")
        + `<small>${esc((t.owners || []).map((p) => p.name).join(", "))}</small>`
        + (t.due ? `<small class="${t.due.slice(0, 10) < today ? "late" : ""}">due ${esc(t.due.slice(0, 10))}</small>` : "") + `</a>`).join("")
      + (open.length > 12 ? `<div class="dt-g">and ${open.length - 12} more open</div>` : "")
      : `<p class="muted" style="font-size:12px">No task list has a group for this project yet. In Tasks: ... &rarr; Groups and projects.</p>`);
}
