/* Programme page (server side: programme.py; scheduling: progcore.js).
 *
 * The project's programme as MS Project shows one - a table of tasks on the
 * left, the Gantt chart on the right - made easy: type a task, its duration
 * and its predecessors (3, 3FS+2d, 5SS ...) or drag between bars; the
 * critical path shows in red. Working days skip the weekend and the Hong
 * Kong holidays. Baselines keep a version to compare with; Export makes the
 * client's PDF (A3 / A4, title block, legend, remarks) or a CSV.
 * An activity can make or link a task (Tasks) and be discussed in Chat.
 */

import { api, project } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, toast, pop, closePop, modal, uid } from "./tasks-util.js";
import * as PC from "./progcore.js";

let RH = 30;                   // row height, px (Format: compact 24 / normal 30 / roomy 38)
const HEAD = 46;               // header height, px
const COLS = {
  id: { label: "#", w: 40, align: "right", mm: 8 },
  wbs: { label: "WBS", w: 56, mm: 12 },
  name: { label: "Task name", w: 270, edit: "text", mm: 72 },
  dur: { label: "Duration", w: 74, align: "right", edit: "dur", mm: 16 },
  start: { label: "Start", w: 94, edit: "date", mm: 19 },
  finish: { label: "Finish", w: 94, edit: "date", mm: 19 },
  pred: { label: "Predecessors", w: 106, edit: "pred", mm: 22 },
  pct: { label: "% done", w: 62, align: "right", edit: "pct", mm: 12 },
  tf: { label: "Total float", w: 72, align: "right", mm: 15 },
  ff: { label: "Free float", w: 70, align: "right", mm: 15 },
  party: { label: "Responsible", w: 116, edit: "text", mm: 26 },
  bstart: { label: "Baseline start", w: 98, mm: 19 },
  bfinish: { label: "Baseline finish", w: 98, mm: 19 },
  var: { label: "Finish variance", short: "Variance", w: 86, align: "right", mm: 17 },
  task: { label: "Linked task", w: 130, mm: 30 },
  notes: { label: "Notes", w: 170, edit: "text", mm: 40 },
};
const DEFAULT_COLS = ["id", "name", "dur", "start", "finish", "pred", "pct"];
const ZOOM = { day: 30, week: 14, month: 4.2, quarter: 1.5 };
const MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const WD = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
export const DEFAULT_CATS = [
  { id: "des", name: "Design", color: "#4a78a8" }, { id: "sta", name: "Statutory", color: "#7b5ea7" },
  { id: "ten", name: "Tender", color: "#c98a1b" }, { id: "con", name: "Construction", color: "#2e7d32" },
  { id: "cli", name: "Client / milestone", color: "#5f6670" }, { id: "oth", name: "Other", color: "#8d6e63" },
];
const PALETTE = ["#4a78a8", "#2b6cb0", "#00838f", "#2e7d32", "#7cb342", "#c98a1b", "#ef6c00", "#c62828", "#ad1457", "#7b5ea7", "#5f6670", "#8d6e63"];
const FORMAT = { date: "d-mon-yy", unit: "d", rowh: "normal", text: 12.5, label: "party", zebra: false, shade: true, today: true,
  summary: "bracket", msdate: true, grid: "unit", boldsum: true, weekno: false, solidred: false };

const P = {
  doc: null, d: null, sched: null, cal: null, byId: new Map(), rows: [], can: false, me: null,
  sel: new Set(), cur: "", anchor: "", undo: [], redo: [], t: 0, saving: false, pending: false,
  view: {}, linked: new Map(), d0: 0, ppd: 14, width: 0, phone: false,
};

/* ---------------------------------------------------------------- helpers */

const phone = () => matchMedia("(max-width: 800px)").matches;
const tasks = () => P.d.tasks;
const taskOf = (id) => tasks().find((t) => t.id === id);
const rowOf = (id) => P.byId.get(id);
function fmt(iso, year = true) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const f = (P.d && P.d.format && P.d.format.date) || "d-mon-yy";
  if (f === "dd/mm/yyyy") return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}${year ? "/" + y : ""}`;
  if (f === "wd d/m/yy") return `${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}/${m}${year ? "/" + String(y).slice(2) : ""}`;
  return `${d} ${MON[m - 1]}${year ? " " + String(y).slice(2) : ""}`;
}
const catOf = (t) => (t && t.cat ? (P.d.categories || []).find((c) => c.id === t.cat) : null);
const fillOf = (t) => (t && t.color) || (catOf(t) || {}).color || "";
function fmtLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
const days = (n) => {
  if (n === null || n === undefined) return "";
  if (P.d && P.d.format && P.d.format.unit === "w" && P.cal) { const w = n / P.cal.perWeek; return `${Math.round(w * 10) / 10} w`; }
  return `${n} d`;
};
const keyView = () => "lwk-viewer:programme-view:" + (P.mine ? "mine:" + P.mine : (project() || "") + (P.pg ? ":" + P.pg : ""));
/* several programmes in a project: ?pg=<id> (none = the first) */
const pgParam = () => { const v = new URLSearchParams(location.search).get("pg") || ""; return /^[a-z0-9]{6,16}$/.test(v) ? v : ""; };
/* a programme of one's own, not in a project: ?mine=<id> (myprog.py) */
const mineParam = () => { const v = new URLSearchParams(location.search).get("mine") || ""; return /^[a-z0-9]{10}$/.test(v) ? v : ""; };
const pq = (path) => P.mine ? path.replace(/^\/api\/programme(\/history)?/, (m, h) => "/api/myprog/" + P.mine + (h || ""))
  : path + (P.pg ? (path.includes("?") ? "&" : "?") + "pg=" + P.pg : "");
const pgUrl = (pg) => { const u = new URL(location.href); u.searchParams.delete("task"); u.searchParams.delete("mine"); if (pg && pg !== "main") u.searchParams.set("pg", pg); else u.searchParams.delete("pg"); return u.pathname + u.search; };
const mineUrl = (id) => { const u = new URL(location.href); u.searchParams.delete("task"); u.searchParams.delete("pg"); u.searchParams.set("mine", id); return u.pathname + u.search; };
function loadView() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(keyView()) || "{}") || {}; } catch (e) {}
  P.view = Object.assign({ zoom: "week", critical: true, baseline: "", links: true, progress: false, critOnly: false, labels: true, gw: 0, collapsed: [], widths: {}, level: 0, cats: [] }, v);
}
function saveView() {
  try { localStorage.setItem(keyView(), JSON.stringify(P.view)); } catch (e) {}
}
function defaults(d) {
  d.tasks = Array.isArray(d.tasks) ? d.tasks : [];
  d.calendar = Object.assign({ week: "mon-fri", hk: true, holidays: [], off: [] }, d.calendar || {});
  d.baselines = Array.isArray(d.baselines) ? d.baselines : [];
  d.cover = Object.assign({}, d.cover || {});
  d.columns = Array.isArray(d.columns) && d.columns.length ? d.columns.filter((k) => COLS[k]) : DEFAULT_COLS.slice();
  if (!d.columns.includes("name")) d.columns.splice(1, 0, "name");
  d.remarks = Array.isArray(d.remarks) ? d.remarks : [];
  if (!Array.isArray(d.categories)) d.categories = DEFAULT_CATS.map((c) => Object.assign({}, c));
  d.format = Object.assign({}, FORMAT, d.format || {});
  for (const t of d.tasks) { t.deps = Array.isArray(t.deps) ? t.deps : []; t.links = t.links || {}; }
  return d;
}
function calSpec() {
  const c = P.d.calendar;
  return { week: c.week, holidays: (c.hk ? PC.hkHolidays() : []).concat(c.holidays || []), off: c.off || [] };
}
const baseline = () => P.d.baselines.find((b) => b.id === P.view.baseline) || null;
const cols = () => (P.phone ? ["name"] : P.d.columns);

/* ---------------------------------------------------------------- schedule */

function recalc() {
  P.cal = new PC.Calendar(calSpec());
  P.sched = PC.schedule(tasks(), P.cal, { start: P.d.cover.start || "" });
  P.byId = new Map(P.sched.rows.map((r) => [r.id, r]));
  RH = { compact: 24, normal: 30, roomy: 38 }[P.d.format.rowh] || 30;
  // the rows shown: not under a collapsed summary (or deeper than the level shown);
  // only critical ones, or those of the chosen categories, if asked
  const shut = new Set(P.view.collapsed || []);
  const lvl = +P.view.level || 0;
  const cats = new Set(P.view.cats || []);
  const keep = new Set();
  if (cats.size) {                       // a category's tasks, with the summaries above them
    for (const r of P.sched.rows) {
      if (!cats.has(tasks()[r.i].cat || "")) continue;
      keep.add(r.id);
      for (let p = r.parent; p >= 0; p = P.sched.rows[p].parent) keep.add(P.sched.rows[p].id);
    }
  }
  const out = [];
  let hideBelow = null;
  for (const r of P.sched.rows) {
    if (hideBelow !== null) { if (r.level > hideBelow) continue; hideBelow = null; }
    if (lvl && r.level >= lvl) continue;
    if (P.view.critOnly && !r.critical) continue;
    if (cats.size && !keep.has(r.id)) continue;
    out.push(r);
    if (r.summary && shut.has(r.id)) hideBelow = r.level;
  }
  P.rows = out;
  // the time range
  let lo = null, hi = null;
  const b = baseline();
  for (const r of P.sched.rows) {
    const a = PC.dayOf(r.start), z = PC.dayOf(r.finish);
    if (a !== null && (lo === null || a < lo)) lo = a;
    if (z !== null && (hi === null || z > hi)) hi = z;
    const bt = b && b.tasks[r.id];
    if (bt) { const x = PC.dayOf(bt[0]), y = PC.dayOf(bt[1]); if (x !== null && x < lo) lo = x; if (y !== null && y > hi) hi = y; }
  }
  const today = PC.dayOf(PC.todayIso());
  if (lo === null) { lo = today; hi = today + 60; }
  const pad = Math.max(7, Math.round((hi - lo) * 0.04));
  lo -= 7;
  hi += pad + 14;
  const dt = new Date(Date.UTC(2000, 0, 1) + lo * 86400000);
  const ppdWant = P.view.zoom === "fit" || P.view.zoom === "free" ? P.view.ppd || 4 : ZOOM[P.view.zoom] || 14;
  if (ppdWant < 6) lo -= dt.getUTCDate() - 1;            // a month or quarter scale starts on the 1st
  else lo -= (dt.getUTCDay() + 6) % 7;                   // a day or week scale on a Monday
  P.d0 = lo;
  P.ppd = P.view.zoom === "fit" ? fitPpd() || ppdWant : ppdWant;
  P.span = hi - lo + 1;
  // the chart reaches the window's right edge, whatever the table's width
  const room = (($("#pg-body") || {}).clientWidth || 0) - gridWidth();
  P.width = Math.max(Math.round(P.span * P.ppd), 400, room);
}
/* the text beside a bar: the row's own choice (Properties / right-click >
   Label), else Format > Beside the bars */
const MSLABELS = [["name", "Milestone name"], ["namedate", "Name · date"], ["date", "Date only"], ["party", "Responsible"], ["none", "Nothing"]];
const LABELS = [["party", "Responsible"], ["name", "Task name"], ["dates", "Start - finish"], ["namedates", "Name + dates"], ["finish", "Finish date"], ["pct", "% done"], ["none", "Nothing"]];
function labelText(r, t) {
  const F = P.d.format;
  const own = t && t.label;
  const d1 = fmt(r.start, false), d2 = fmt(r.finish, false);
  if (r.milestone) {
    if (!own) {
      // Format > Beside the milestones (the first form: the tick "milestone dates")
      const k = F.mslabel || (F.msdate ? "namedate" : "name");
      return { name: r.name, namedate: r.name + " · " + d1, date: d1, party: (t && t.party) || r.name, none: "" }[k] ?? r.name;
    }
    return { none: "", name: r.name, party: (t && t.party) || r.name, dates: d1, finish: d1, namedates: r.name + " · " + d1, pct: r.name }[own] ?? r.name;
  }
  const k = own || (r.summary ? "name" : F.label || "party");
  return { none: "", name: r.name, party: (t && t.party) || r.name, dates: `${d1} - ${d2}`, namedates: `${r.name} · ${d1} - ${d2}`, finish: d2, pct: r.pct + "%" }[k] ?? r.name;
}
const X = (iso, end) => { const d = PC.dayOf(iso); return d === null ? 0 : (d - P.d0 + (end ? 1 : 0)) * P.ppd; };
const dayAtX = (x) => P.d0 + Math.floor(x / P.ppd);
const msX = (r) => X(r.start, !!r.ms_end);

/* ---------------------------------------------------------------- saving */

const snap = () => JSON.stringify({ tasks: P.d.tasks, calendar: P.d.calendar, baselines: P.d.baselines, cover: P.d.cover, columns: P.d.columns, remarks: P.d.remarks, categories: P.d.categories, format: P.d.format });
function before() {
  P.undo.push(snap());
  if (P.undo.length > 80) P.undo.shift();
  P.redo = [];
}
function restore(s) {
  Object.assign(P.d, JSON.parse(s));
  defaults(P.d);
}
function undo() { if (!P.undo.length) return; P.redo.push(snap()); restore(P.undo.pop()); changed(); }
function redo() { if (!P.redo.length) return; P.undo.push(snap()); restore(P.redo.pop()); changed(); }

/* Set up (calendar, title block, categories, format, template, versions):
   any member, a phone too */
const canSet = () => !!(P.doc && P.doc.can_edit);
function changed() {
  recalc();
  render();
  if (!canSet()) return;
  P.pending = true;
  $("#pg-saved").textContent = "Saving ...";
  clearTimeout(P.t);
  P.t = setTimeout(save, 700);
}
async function save() {
  if (!P.doc || !P.doc.can_edit) return;        // members; on a phone only Set up changes anything
  if (P.saving) { clearTimeout(P.t); P.t = setTimeout(save, 400); return; }
  P.saving = true;
  try {
    const out = await api(pq("/api/programme"), { method: "PUT", body: JSON.stringify({ rev: P.doc.rev, data: P.d }) });
    P.doc.rev = out.rev; P.doc.by = out.by; P.doc.at = out.at;
    P.pending = false;
    $("#pg-saved").textContent = "Saved";
  } catch (e) {
    if (e.status === 409) {
      toast("Someone else changed the programme meanwhile - showing theirs now; make your change again.", true);
      P.pending = false;
      await loadDoc();
      recalc(); render();
    } else { toast("Not saved: " + e.message, true); $("#pg-saved").textContent = "Not saved"; }
  } finally { P.saving = false; }
}
async function loadDoc() {
  P.doc = await api(pq("/api/programme"));
  P.d = defaults(P.doc.data || {});
  P.can = !!P.doc.can_edit && !P.phone;
}

/* ---------------------------------------------------------------- render */

function render() {
  document.body.classList.toggle("pg-ro", !P.can);
  paintBar();
  paintSum();
  paintLegend();
  paintGrid();
  paintChart();
  paintProps();
}

function paintBar() {
  for (const b of $("#pg-zoom").querySelectorAll("button")) b.classList.toggle("on", b.dataset.z === P.view.zoom);
  $("#pg-crit").classList.toggle("on", !!P.view.critical);
  const b = baseline();
  $("#pg-base").innerHTML = (b ? "Baseline: " + esc(b.name) : "Baseline") + " &#9662;";
  $("#pg-base").classList.toggle("on", !!b);
  $("#pg-undo").disabled = !P.undo.length;
  $("#pg-redo").disabled = !P.redo.length;
}

function paintSum() {
  const s = P.sched;
  const n = s.rows.filter((r) => !r.summary).length;
  const crit = s.rows.filter((r) => !r.summary && r.critical).length;
  const status = P.d.cover.status_date || "";
  const late = status ? s.rows.filter((r) => !r.summary && PC.expectedPct(r, status, P.cal) > r.pct + 0.5).length : 0;
  const b = baseline();
  let slip = "";
  if (b) {
    const v = PC.variance({ id: "", start: s.start, finish: s.finish }, { tasks: { "": [b.start || firstOf(b, 0), b.finish || firstOf(b, 1)] } }, P.cal);
    if (v && v.finish) slip = `<span class="${v.finish > 0 ? "pg-bad" : "pg-ok"}">${v.finish > 0 ? "+" : ""}${v.finish} d against ${esc(b.name)}</span>`;
  }
  $("#pg-sum").innerHTML = !tasks().length ? "" :
    `<span><small>Start</small><b><a href="#" id="pg-first" title="The task that starts first - click to go to it">${fmtLong(s.first)}</a></b></span><span><small>Finish</small><b><a href="#" id="pg-last" title="The task that finishes last - click to go to it">${fmtLong(s.last)}</a></b></span>`
    + `<span><small>Duration</small><b>${s.span} working days</b></span><span><small>Tasks</small><b>${n}</b></span>`
    + `<span><small>Critical</small><b class="${crit ? "pg-crit-t" : ""}">${crit}</b></span>`
    + `<span><small>Status date</small><b><a href="#" id="pg-status">${status ? fmtLong(status) : "set"}</a></b></span>`
    + (late ? `<span><small>Behind</small><b class="pg-bad">${late}</b></span>` : "")
    + (slip ? `<span><small>Finish variance</small><b>${slip}</b></span>` : "")
    + (s.errors.length ? `<span class="pg-err" title="${esc(s.errors.map((e) => e.message).join("\n"))}">&#9888; ${esc(s.errors[0].message.slice(0, 120))}</span>` : "")
    + `<span class="pg-cal muted">${esc(PC.WEEKS[P.d.calendar.week])}${P.d.calendar.hk && P.d.calendar.week !== "all" ? " · HK holidays" : ""}</span>`;
  // a project start (Set up) well before every task: the reason for an odd START before
  const ps = P.d.cover.start;
  if (tasks().length && ps && P.cal && s.first && ps < s.first && (P.cal.between(ps, s.first) || 0) > 5) {
    const yrs = (PC.dayOf(s.first) - PC.dayOf(ps)) / 365.25;
    $("#pg-sum").innerHTML += `<span class="pg-warn-start">&#9888; Project start (Set up) is ${esc(fmtLong(ps))}, ${yrs >= 1 ? Math.round(yrs) + " year" + (Math.round(yrs) === 1 ? "" : "s") : P.cal.between(ps, s.first) + " working days"} before the first task (${esc(fmtLong(s.first))}): tasks without a date or link would start then.
      ${canSet() ? `<button type="button" class="ghost" data-ps="first">Use the first task's date</button><button type="button" class="ghost" data-ps="clear">Clear it</button>` : ""}</span>`;
  }
  for (const b of $("#pg-sum").querySelectorAll("[data-ps]")) b.onclick = () => { before(); P.d.cover.start = b.dataset.ps === "first" ? s.first : ""; changed(); toast(b.dataset.ps === "first" ? "Project start set to the first task's date" : "Project start cleared"); };
  const go1 = (id) => { if (!id) return; const shut = new Set(P.view.collapsed || []); let changedV = false; for (const r of s.rows) if (r.summary && shut.has(r.id) && rowOf(id) && r.wbs && String(rowOf(id).wbs).startsWith(r.wbs + ".")) { shut.delete(r.id); changedV = true; } if (changedV || P.view.level) { P.view.collapsed = [...shut]; P.view.level = 0; saveView(); recalc(); render(); } select(id, null, true); scrollToDay(rowOf(id).start); };
  const a1 = $("#pg-first"), a2 = $("#pg-last");
  if (a1) a1.onclick = (ev) => { ev.preventDefault(); go1(s.firstId); };
  if (a2) a2.onclick = (ev) => { ev.preventDefault(); go1(s.lastId); };
  const st = $("#pg-status");
  if (st) st.onclick = (ev) => { ev.preventDefault(); statusDate(st); };
}
function firstOf(b, k) {
  let v = null;
  for (const x of Object.values(b.tasks)) if (x && x[k] && (v === null || (k ? x[k] > v : x[k] < v))) v = x[k];
  return v || "";
}

const colW = (k) => (P.view.widths && P.view.widths[k]) || COLS[k].w;
function gridTemplate() {
  return cols().map((k) => (k === "name" && !(P.view.widths && P.view.widths.name) ? `minmax(${P.phone ? 150 : 160}px, 1fr)` : colW(k) + "px")).join(" ");
}
function gridWidth() {
  const want = cols().reduce((a, k) => a + colW(k), 0) + 22;
  const w = P.view.gw || Math.min(want, Math.round(innerWidth * 0.52));
  return P.phone ? Math.min(170, innerWidth * 0.45) : Math.max(220, Math.min(w, innerWidth - 200));
}

function cell(r, t, k) {
  const v = baseline() ? PC.variance(r, baseline(), P.cal) : null;
  switch (k) {
    case "id": return String(r.i + 1);
    case "wbs": return r.wbs;
    case "name": return r.name;
    case "dur": return r.milestone ? "0 d" : days(r.dur);
    case "start": return fmt(r.start);
    case "finish": return fmt(r.finish);
    case "pred": return PC.formatDeps(t.deps, tasks());
    case "pct": return r.pct + "%";
    case "tf": return r.summary ? "" : days(r.tf);
    case "ff": return r.summary ? "" : days(r.ff);
    case "party": return t.party || "";
    case "bstart": return v ? fmt(v.bstart) : "";
    case "bfinish": return v ? fmt(v.bfinish) : "";
    case "var": return v && v.finish !== null ? (v.finish > 0 ? "+" : "") + v.finish + " d" : "";
    case "task": {
      const l = t.links && t.links.task;
      if (!l) return "";
      const x = P.linked.get(l.list + ":" + l.id);
      return (l.title || "Task") + (x ? (x.done ? " ✓" : ` ${x.percent || 0}%`) : "");
    }
    case "notes": return t.notes || "";
  }
  return "";
}

function paintGrid() {
  const gw = gridWidth();
  const sheet = $("#pg-sheet");
  sheet.style.setProperty("--gw", gw + "px");
  sheet.style.setProperty("--cw", P.width + "px");
  sheet.style.setProperty("--cols", gridTemplate());
  sheet.style.setProperty("--rh", RH + "px");
  sheet.style.setProperty("--fs", (+P.d.format.text || 12.5) + "px");
  sheet.classList.toggle("zebra", !!P.d.format.zebra);
  sheet.classList.toggle("nobold", !P.d.format.boldsum);
  const C = cols();
  $("#pg-gh").innerHTML = `<div class="pg-r pg-hr">${C.map((k) => `<div class="pg-c ${COLS[k].align === "right" ? "r" : ""}" data-k="${k}">${esc(COLS[k].label)}${P.phone ? "" : `<span class="pg-cr" data-cr="${k}" title="Drag to change the width"></span>`}</div>`).join("")}</div>`
    + (P.phone ? "" : `<div class="pg-grip" data-split title="Drag to widen the table"></div>`);
  if (!tasks().length) {
    $("#pg-gb").innerHTML = `<div class="pg-empty">${P.can ? `<b>No programme yet</b><p class="muted">Add a task, start from the office's architectural template, or import a CSV saved from Excel or MS Project.</p>`
      + `<div class="pg-empty-b"><button type="button" class="primary" data-empty="task">+ First task</button><button type="button" class="ghost" data-empty="tpl">Start from the template</button><button type="button" class="ghost" data-empty="csv">Import CSV</button></div>`
      : `<b>No programme yet</b><p class="muted">${P.phone ? "Open the Programme on a computer or tablet to make one." : "A project member can make it."}</p>`}</div>`;
    return;
  }
  const shut = new Set(P.view.collapsed || []);
  $("#pg-gb").innerHTML = P.rows.map((r) => {
    const t = tasks()[r.i];
    const cls = ["pg-r", r.summary ? "sum" : "", r.milestone ? "ms" : "", P.sel.has(r.id) ? "sel" : "", r.id === P.cur ? "cur" : "",
      r.critical && P.view.critical && !r.summary ? "crit" : "", r.looped ? "loop" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-id="${esc(r.id)}">` + C.map((k) => {
      const ed = P.can && COLS[k].edit && !(r.summary && ["dur", "start", "finish", "pct"].includes(k)) ? " ed" : "";
      if (k === "name") {
        const tw = r.summary ? `<button type="button" class="pg-tw" data-tw="${esc(r.id)}" aria-label="${shut.has(r.id) ? "Expand" : "Collapse"}">${shut.has(r.id) ? "&#9656;" : "&#9662;"}</button>` : `<span class="pg-tw0"></span>`;
        const fc = fillOf(t);
        const ic = (r.milestone ? `<span class="pg-msi"${fc ? ` style="color:${esc(fc)}"` : ""}>&#9670;</span>` : fc && !r.summary ? `<span class="pg-sw" style="background:${esc(fc)}"></span>` : "");
        const fs = t.style ? (t.style.bold ? "font-weight:650;" : "") + (t.style.italic ? "font-style:italic;" : "") : "";
        const lk = (t.links && (t.links.task || t.links.room)) ? `<span class="pg-lk" title="${esc([t.links.task ? "Task: " + t.links.task.title : "", t.links.room ? "Chat: " + t.links.room.title : ""].filter(Boolean).join("\n"))}">&#128279;</span>` : "";
        return `<div class="pg-c pg-name${ed}" data-k="name" style="padding-left:${6 + r.level * 16}px">${P.can ? `<span class="pg-drag" title="Drag to move">&#8942;&#8942;</span>` : ""}${tw}${ic}<span class="pg-tx"${fs ? ` style="${fs}"` : ""}>${esc(r.name || "(no name)")}</span>${lk}</div>`;
      }
      return `<div class="pg-c${COLS[k].align === "right" ? " r" : ""}${ed}" data-k="${k}">${esc(cell(r, t, k))}</div>`;
    }).join("") + `</div>`;
  }).join("") + (P.can ? `<div class="pg-r pg-new"><div class="pg-c pg-addrow" style="grid-column:1/-1">+ Add a task</div></div>` : "");
}

/* ------------------------------------------------------------------ chart */

function unitFor(ppd) { return ppd >= 20 ? "day" : ppd >= 6 ? "week" : ppd >= 2 ? "month" : "quarter"; }

function isoWeek(day) {
  const dt = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + 3 - ((dt.getUTCDay() + 6) % 7)));
  const y1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - y1) / 86400000 - 3 + ((y1.getUTCDay() + 6) % 7)) / 7);
}

function paintChart() {
  const W = P.width;
  const F = P.d.format;
  const unit = unitFor(P.ppd);
  const d1 = P.d0 + P.span - 1;
  const dateOf = (d) => new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  // the scale: two tiers
  let top = "", low = "", grid = "";
  const tiers = [];
  let d = P.d0;
  while (d <= d1) {
    const dt = dateOf(d);
    let nxt, lab;
    if (unit === "day" || unit === "week") {
      nxt = d + new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)).getTime() / 86400000 - dt.getTime() / 86400000;
      lab = `${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    } else {
      nxt = d + (Date.UTC(dt.getUTCFullYear() + 1, 0, 1) - dt.getTime()) / 86400000;
      lab = String(dt.getUTCFullYear());
    }
    tiers.push([d, Math.min(nxt, d1 + 1), lab]);
    d = nxt;
  }
  for (const [a, b, lab] of tiers) {
    const xa = (a - P.d0) * P.ppd, xb = (b - P.d0) * P.ppd;
    top += `<line x1="${xa}" y1="0" x2="${xa}" y2="23" class="sc-l"/>` + (xb - xa > 34 ? `<text x="${xa + 5}" y="16" class="sc-t">${lab}</text>` : "");
    if (F.grid === "month") grid += `<line x1="${xa}" y1="0" x2="${xa}" y2="100%" class="g-l"/>`;
  }
  d = P.d0;
  while (d <= d1) {
    const dt = dateOf(d);
    let nxt, lab;
    if (unit === "day") { nxt = d + 1; lab = String(dt.getUTCDate()); }
    else if (unit === "week") { nxt = d + 7; lab = F.weekno ? "W" + isoWeek(d) : `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`; }
    else if (unit === "month") { nxt = d + (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) - dt.getTime()) / 86400000; lab = MON[dt.getUTCMonth()]; }
    else { const q = Math.floor(dt.getUTCMonth() / 3); nxt = d + (Date.UTC(dt.getUTCFullYear(), q * 3 + 3, 1) - dt.getTime()) / 86400000; lab = "Q" + (q + 1); }
    const xa = (d - P.d0) * P.ppd, xb = (Math.min(nxt, d1 + 1) - P.d0) * P.ppd;
    low += `<line x1="${xa}" y1="23" x2="${xa}" y2="${HEAD}" class="sc-l"/>` + (xb - xa > 16 ? `<text x="${(xa + xb) / 2}" y="${HEAD - 8}" class="sc-s">${lab}</text>` : "");
    if (F.grid !== "month") grid += `<line x1="${xa}" y1="0" x2="${xa}" y2="100%" class="g-l"/>`;
    d = nxt;
  }
  $("#pg-ch").innerHTML = `<svg width="${W}" height="${HEAD}" class="pg-scale" title="Drag along the scale to stretch or squeeze the time"><line x1="0" y1="23" x2="${W}" y2="23" class="sc-l"/>${top}${low}</svg>`;

  const H = Math.max(P.rows.length, 1) * RH + (P.can ? RH : 0);
  const half = RH / 2, bh = Math.max(10, Math.round(RH * 0.47));
  let bg = "";
  if (F.shade && P.ppd >= 6 && P.cal) {               // days off, shaded
    for (let k = P.d0; k <= d1; k++) if (!P.cal.isWork(k)) bg += `<rect x="${(k - P.d0) * P.ppd}" y="0" width="${P.ppd}" height="${H}" class="g-off"/>`;
  }
  let rows = "", bars = "", base = "";
  const b = baseline();
  const crit = !!P.view.critical;
  const solid = !!F.solidred;
  const at = new Map();
  P.rows.forEach((r, k) => at.set(r.id, k));
  P.rows.forEach((r, k) => {
    const y = k * RH;
    const t = tasks()[r.i];
    if (F.zebra && k % 2) rows += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="g-zeb"/>`;
    if (P.sel.has(r.id)) rows += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="g-sel"/>`;
    rows += `<line x1="0" y1="${y + RH}" x2="${W}" y2="${y + RH}" class="g-r"/>`;
    const bt = b && b.tasks[r.id];
    if (bt && bt[0]) {
      if (r.milestone) base += `<path d="${diamond(X(bt[0], !!r.ms_end), y + RH - 6, 4)}" class="b-base"/>`;
      else base += `<rect x="${X(bt[0])}" y="${y + RH - 7}" width="${Math.max(2, X(bt[1], true) - X(bt[0]))}" height="4" rx="1" class="b-base"/>`;
    }
    const x0 = r.milestone ? msX(r) : X(r.start), x1 = X(r.finish, true);
    const cy = y + (b ? half - 2 : half);
    const isC = crit && r.critical;
    const fc = fillOf(t);
    const cls = isC ? (solid || !fc ? " crit" : " critO") : "";
    const fillAttr = fc && !(isC && (solid || !fc)) ? ` style="fill:${esc(fc)}"` : "";
    const labTxt = labelText(r, t);
    const label = P.view.labels && labTxt ? `<text x="${(r.milestone ? x0 + 9 : x1 + 6)}" y="${cy + 4}" class="b-lab">${esc(labTxt)}</text>` : "";
    if (r.summary) {
      const p = F.summary === "bar" ? `<rect x="${x0}" y="${cy - 4}" width="${Math.max(2, x1 - x0)}" height="8" rx="2"/>` : `<path d="M${x0} ${cy - 5}H${x1}V${cy + 4}L${x1 - 6} ${cy}H${x0 + 6}L${x0} ${cy + 4}Z"/>`;
      bars += `<g class="bar sum" data-bar="${esc(r.id)}">${p}${label}</g>`;
    } else if (r.milestone) {
      bars += `<g class="bar ms${cls}" data-bar="${esc(r.id)}"><path d="${diamond(x0, cy, Math.round(bh / 2))}"${fillAttr}/>${label}</g>`;
    } else {
      const w = Math.max(3, x1 - x0);
      const pw = w * r.pct / 100;
      bars += `<g class="bar task${cls}" data-bar="${esc(r.id)}"><rect x="${x0}" y="${cy - bh / 2}" width="${w}" height="${bh}" rx="3" class="b-body"${fillAttr}/>`
        + (pw ? `<rect x="${x0}" y="${cy - bh / 5}" width="${pw}" height="${(bh * 2) / 5}" rx="1.5" class="b-done"/>` : "")
        + (P.can ? `<rect x="${x1 - 5}" y="${cy - bh / 2}" width="7" height="${bh}" class="b-end" data-end="1"/><circle cx="${x0 - 7}" cy="${cy}" r="4" class="b-h" data-h="S"/><circle cx="${x1 + 7}" cy="${cy}" r="4" class="b-h" data-h="F"/>` : "")
        + label + `</g>`;
    }
  });
  // links: their own colour and line; a related-only one is dashed grey and is never critical
  let links = "";
  if (P.view.links) {
    tasks().forEach((t) => {
      const ti = at.get(t.id);
      if (ti === undefined) return;
      for (const dp of t.deps || []) {
        const fi = at.get(dp.from);
        if (fi === undefined) continue;
        const f = P.rows[fi], s = P.rows[ti];
        const rel = dp.drive === false;
        const c = !rel && crit && f.critical && s.critical && !f.summary && !s.summary;
        const g = linkGeom(f, fi, s, ti, dp.type || "FS");
        const col = c ? "" : dp.color || "";
        const sty = dp.style || (rel ? "dashed" : "solid");
        const dash = sty === "dashed" ? ` stroke-dasharray="5 3"` : sty === "dotted" ? ` stroke-dasharray="1.5 2.5"` : "";
        links += `<g class="lnk${c ? " crit" : ""}${rel ? " rel" : ""}" data-lf="${esc(dp.from)}" data-lt="${esc(t.id)}"${col ? ` style="--lc:${esc(col)}"` : ""}>`
          + `<path d="${g.d}" class="l-p"${dash}/><path d="${arrowHead(g)}" class="l-a"/><path d="${g.d}" class="l-hit"/></g>`;
      }
    });
  }
  // today, the status date and the progress line
  const tx = X(PC.todayIso());
  let lines = F.today ? `<line x1="${tx}" y1="0" x2="${tx}" y2="${H}" class="g-today"/>` : "";
  const st = P.d.cover.status_date;
  if (st) lines += `<line x1="${X(st, true)}" y1="0" x2="${X(st, true)}" y2="${H}" class="g-status"/>`;
  if (P.view.progress && st) {
    const sx = X(st, true);
    const pts = [];
    P.rows.forEach((r, k) => {
      const y = k * RH;
      let px = sx;
      if (!r.summary && r.es <= P.cal.ordOf(st) && r.pct < 100) {
        const o = r.es + (r.dur * r.pct) / 100;
        px = r.milestone ? msX(r) : (P.cal.dayAt(Math.floor(o)) - P.d0 + (o % 1)) * P.ppd;
      }
      pts.push(`${sx},${y}`, `${px},${y + half}`, `${sx},${y + RH}`);
    });
    lines += `<polyline points="${pts.join(" ")}" class="g-prog"/>`;
  }
  $("#pg-cb").innerHTML = `<svg width="${W}" height="${H}" class="pg-chart" id="pg-svg">`
    + `<g>${bg}</g><g>${grid}</g><g>${rows}</g><g>${base}</g><g>${links}</g><g>${bars}</g><g>${lines}</g><g id="pg-drag-layer"></g></svg>`;
}
function diamond(cx, cy, r) { return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`; }

/* a link: out of the predecessor's start or finish, into the successor's;
   -> {d, x, y, dir: "r"|"l"|"u"|"d"} - where the arrow head goes */
function linkGeom(f, fi, s, ti, type) {
  const fy = fi * RH + RH / 2, ty = ti * RH + RH / 2;
  const fx = f.milestone ? msX(f) : type[0] === "S" ? X(f.start) : X(f.finish, true);
  const tx = s.milestone ? msX(s) : type[1] === "S" ? X(s.start) : X(s.finish, true);
  const out = type[0] === "F" ? fx + 8 : fx - 8;
  const down = ty > fy ? 1 : -1;
  const into = type[1] === "S";
  const bh = Math.max(10, Math.round(RH * 0.47)) / 2 + 1;
  if ((into && out <= tx - 3) || (!into && out >= tx + 3)) {
    const x = into ? Math.max(out, tx + 4) : Math.min(out, tx - 4);
    const yy = ty - down * bh;
    return { d: `M${fx} ${fy}H${x}V${yy}`, x, y: yy, dir: down > 0 ? "d" : "u" };
  }
  const yb = fi * RH + (down > 0 ? RH : 0);
  const xin = into ? tx - 8 : tx + 8;
  const xe = tx + (into ? -1 : 1);
  return { d: `M${fx} ${fy}H${out}V${yb}H${xin}V${ty}H${xe}`, x: xe, y: ty, dir: into ? "r" : "l" };
}
const linkPath = (f, fi, s, ti, type) => linkGeom(f, fi, s, ti, type).d;
function arrowHead(g) {
  const a = 5, w = 3.2, { x, y } = g;
  if (g.dir === "r") return `M${x} ${y}L${x - a} ${y - w}L${x - a} ${y + w}Z`;
  if (g.dir === "l") return `M${x} ${y}L${x + a} ${y - w}L${x + a} ${y + w}Z`;
  if (g.dir === "d") return `M${x} ${y}L${x - w} ${y - a}L${x + w} ${y - a}Z`;
  return `M${x} ${y}L${x - w} ${y + a}L${x + w} ${y + a}Z`;
}

/* ---------------------------------------------------------------- editing */

function newTask(kind, after) {
  const t = { id: uid(), name: kind === "milestone" ? "Milestone" : "New task", level: 0, kind, start: "", dur: kind === "milestone" ? 0 : 5, pct: 0, party: "", notes: "", deps: [], links: {} };
  const list = tasks();
  let at = list.length;
  if (after) {
    const i = list.findIndex((x) => x.id === after);
    if (i >= 0) {
      t.level = list[i].level || 0;
      // after its rows if it is a collapsed summary
      at = i + 1;
      if ((P.view.collapsed || []).includes(after)) while (at < list.length && (list[at].level || 0) > t.level) at++;
      else if (rowOf(after) && rowOf(after).summary) t.level += 1;
    }
  }
  list.splice(at, 0, t);
  return t;
}
function add(kind) {
  if (!P.can) return;
  before();
  const t = newTask(kind, P.cur);
  P.sel = new Set([t.id]); P.cur = t.id;
  changed();
  setTimeout(() => editCell(t.id, "name"), 20);
}
function subtree(i) {
  const list = tasks(), lv = list[i].level || 0;
  let j = i + 1;
  while (j < list.length && (list[j].level || 0) > lv) j++;
  return [i, j];
}
function roots() {        // the selected rows not under another selected row, in order
  const list = tasks();
  const out = [];
  let end = -1;
  list.forEach((t, i) => {
    if (i < end) return;
    if (P.sel.has(t.id)) { out.push(i); end = subtree(i)[1]; }
  });
  return out;
}
function indent(by) {
  if (!P.can || !P.sel.size) return;
  const list = tasks();
  before();
  let did = false;
  for (const i of roots()) {
    const [a, b] = subtree(i);
    const lv = list[i].level || 0;
    if (by > 0 && (i === 0 || (list[i - 1].level || 0) < lv)) continue;
    if (by < 0 && lv === 0) continue;
    for (let k = a; k < b; k++) list[k].level = Math.max(0, (list[k].level || 0) + by);
    did = true;
  }
  if (!did) { P.undo.pop(); return; }
  changed();
}
async function del() {
  if (!P.can || !P.sel.size) return;
  const list = tasks();
  const gone = new Set();
  for (const i of roots()) { const [a, b] = subtree(i); for (let k = a; k < b; k++) gone.add(list[k].id); }
  if (gone.size > 1 && !confirm(`Delete ${gone.size} rows${gone.size > P.sel.size ? " (with the tasks under them)" : ""}?`)) return;
  before();
  P.d.tasks = list.filter((t) => !gone.has(t.id));
  for (const t of P.d.tasks) t.deps = t.deps.filter((d) => !gone.has(d.from));
  P.sel.clear(); P.cur = "";
  changed();
}
function linkSelected() {
  if (!P.can) return;
  const ids = P.rows.filter((r) => P.sel.has(r.id)).map((r) => r.id);
  if (ids.length < 2) return toast("Select two or more rows (Ctrl or Shift + click) to link them in order");
  before();
  for (let k = 1; k < ids.length; k++) {
    const t = taskOf(ids[k]);
    if (!t.deps.some((d) => d.from === ids[k - 1])) t.deps.push({ from: ids[k - 1], type: "FS", lag: 0 });
  }
  checkLoop() && changed();
}
function checkLoop() {
  const s = PC.schedule(tasks(), P.cal);
  if (s.errors.some((e) => e.kind === "loop")) {
    restore(P.undo.pop());
    toast("That link would make a loop: a task would wait for itself", true);
    recalc(); render();
    return false;
  }
  return true;
}
function move(ids, toIndex) {   // the rows (with what is under them) to before row toIndex
  const list = tasks();
  const block = [];
  const keep = [];
  const pick = new Set();
  for (const id of ids) { const i = list.findIndex((t) => t.id === id); if (i < 0) continue; const [a, b] = subtree(i); for (let k = a; k < b; k++) pick.add(k); }
  list.forEach((t, i) => (pick.has(i) ? block : keep).push(t));
  let at = toIndex - [...pick].filter((i) => i < toIndex).length;
  at = Math.max(0, Math.min(keep.length, at));
  // the level: as the row above allows
  const above = keep[at - 1];
  const maxLv = above ? (above.level || 0) + 1 : 0;
  const shift = Math.min(0, maxLv - (block[0].level || 0));
  if (shift) for (const t of block) t.level = Math.max(0, (t.level || 0) + shift);
  P.d.tasks = keep.slice(0, at).concat(block, keep.slice(at));
}

/* apply what was typed into a cell; false (with a message) if it cannot be */
function apply(id, k, val) {
  const t = taskOf(id), r = rowOf(id);
  if (!t) return false;
  val = String(val ?? "").trim();
  if (k === "name") { if (val === t.name) return true; before(); t.name = val.slice(0, 300); return true; }
  if (k === "party" || k === "notes") { if (val === (t[k] || "")) return true; before(); t[k] = val.slice(0, k === "notes" ? 2000 : 120); return true; }
  if (k === "dur") {
    const n = PC.parseDur(val, P.cal.perWeek);
    if (n === null || n < 0) { toast("A duration is a number of working days: 10, 10d or 2w", true); return false; }
    if (n === r.dur && !(n === 0 && t.kind !== "milestone")) return true;
    before();
    t.dur = Math.min(n, 5000);
    t.kind = n === 0 ? "milestone" : "task";
    return true;
  }
  if (k === "start") {
    const iso = val ? (/^\d{4}-\d{2}-\d{2}$/.test(val) ? val : PC.isoFromText(val)) : "";
    if (val && !iso) { toast("A date like 2027-03-01 or 1/3/2027", true); return false; }
    if (iso === (t.start || "")) return true;
    before();
    t.start = iso;
    const held = iso && P.cal.ordOf(iso) < (PC.schedule(tasks(), P.cal).rows[r.i].es);
    if (held) toast("It is held later by its predecessor - change the link or its lag to start it sooner");
    return true;
  }
  if (k === "finish") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : PC.isoFromText(val);
    if (!iso) { toast("A date like 2027-03-01 or 1/3/2027", true); return false; }
    const n = P.cal.between(r.start, iso) + 1;
    if (n < 1) { toast("The finish is before the start", true); return false; }
    before();
    t.dur = n; t.kind = "task";
    return true;
  }
  if (k === "pct") {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 100) { toast("% done is 0 to 100", true); return false; }
    before(); t.pct = n; return true;
  }
  if (k === "pred") {
    const p = PC.parseDeps(val, tasks(), id, P.cal.perWeek, t.deps);
    if (p.error) { toast(p.error, true); return false; }
    before();
    t.deps = p.deps;
    return checkLoop();
  }
  return true;
}

function editCell(id, k, typed) {
  if (!P.can) return;
  const row = $(`#pg-gb .pg-r[data-id="${CSS.escape(id)}"]`);
  const c = row && row.querySelector(`.pg-c[data-k="${k}"]`);
  if (!c || !c.classList.contains("ed") || c.classList.contains("editing")) return;
  const t = taskOf(id), r = rowOf(id);
  const cur = k === "name" ? t.name : k === "dur" ? String(r.milestone ? 0 : r.dur) : k === "start" ? (t.start || r.start) : k === "finish" ? r.finish
    : k === "pct" ? String(r.pct) : k === "pred" ? PC.formatDeps(t.deps, tasks()) : (t[k] || "");
  const inp = document.createElement("input");
  inp.className = "pg-in";
  inp.type = k === "start" || k === "finish" ? "date" : "text";
  inp.value = typed !== undefined && inp.type === "text" ? typed : cur;
  if (k === "pred") inp.placeholder = "e.g. 3, 3FS+2d, 5SS";
  const keepW = c.innerHTML;
  c.classList.add("editing");
  c.innerHTML = "";
  c.appendChild(inp);
  inp.focus();
  if (typed === undefined && inp.type === "text") inp.select();
  let done = false;
  const finish = (go) => {
    if (done) return;
    done = true;
    const ok = go === "cancel" ? true : apply(id, k, inp.value);
    if (!ok) { done = false; inp.focus(); return; }
    if (go === "cancel") { c.classList.remove("editing"); c.innerHTML = keepW; return; }
    changed();
    // move on
    const ks = cols().filter((x) => COLS[x].edit);
    const ri = P.rows.findIndex((x) => x.id === id);
    if (go === "down" && P.rows[ri + 1]) select(P.rows[ri + 1].id, null, true);
    else if (go === "tab" || go === "back") {
      const ci = ks.indexOf(k) + (go === "tab" ? 1 : -1);
      if (ks[ci]) setTimeout(() => editCell(id, ks[ci]), 0);
    }
  };
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish("down"); }
    else if (ev.key === "Escape") { ev.preventDefault(); finish("cancel"); }
    else if (ev.key === "Tab") { ev.preventDefault(); finish(ev.shiftKey ? "back" : "tab"); }
    ev.stopPropagation();
  });
  inp.addEventListener("blur", () => setTimeout(() => finish("blur"), 0));
}

function select(id, ev, scroll) {
  if (ev && (ev.ctrlKey || ev.metaKey)) { P.sel.has(id) ? P.sel.delete(id) : P.sel.add(id); }
  else if (ev && ev.shiftKey && P.anchor) {
    const a = P.rows.findIndex((r) => r.id === P.anchor), b = P.rows.findIndex((r) => r.id === id);
    P.sel = new Set(P.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id));
  } else { P.sel = new Set([id]); P.anchor = id; }
  P.cur = id;
  // in place: a re-drawn row would lose a double click's second half
  for (const el of document.querySelectorAll("#pg-gb .pg-r[data-id]")) {
    el.classList.toggle("sel", P.sel.has(el.dataset.id));
    el.classList.toggle("cur", el.dataset.id === P.cur);
  }
  paintChart();
  paintProps();
  if (scroll) {
    const el = $(`#pg-gb .pg-r[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }
}

/* -------------------------------------------------------- chart: dragging */

function chartDown(ev) {
  const g = ev.target.closest("[data-bar]");
  const lk = ev.target.closest(".lnk");
  if (lk && !g) { linkMenu(lk, ev); return; }
  if (!g) return;
  const id = g.dataset.bar;
  const r = rowOf(id);
  if (!P.sel.has(id) || ev.shiftKey || ev.ctrlKey || ev.metaKey) select(id, ev);
  if (!P.can || r.summary) return;
  const svg = $("#pg-svg");
  const box = svg.getBoundingClientRect();
  const sx = ev.clientX;
  const mode = ev.target.dataset.h ? "link" : ev.target.dataset.end ? "dur" : "move";
  const side = ev.target.dataset.h || "F";
  const layer = $("#pg-drag-layer");
  const bar = g.querySelector(".b-body, path");
  let moved = false, last = 0, target = null;
  // several bars selected and this one among them: the drag moves them all
  const group = P.sel.size > 1 && P.sel.has(id) ? [...P.sel].map(rowOf).filter((x) => x && !x.summary) : [];
  svg.setPointerCapture(ev.pointerId);
  const ri = P.rows.findIndex((x) => x.id === id);
  const fx = side === "S" ? X(r.start) : X(r.finish, true), fy = ri * RH + RH / 2;
  const mv = (e) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 3 || Math.abs(e.clientY - ev.clientY) > 3) moved = true;
    if (!moved) return;
    const dd = Math.round(dx / P.ppd);
    if (mode === "move" && group.length > 1) {
      for (const x of group) { const gg = svg.querySelector(`[data-bar="${CSS.escape(x.id)}"]`); if (gg) gg.setAttribute("transform", `translate(${dd * P.ppd},0)`); }
      const wd = dd ? P.cal.between(PC.isoOf(Math.min(PC.dayOf(r.start), PC.dayOf(r.start) + dd)), PC.isoOf(Math.max(PC.dayOf(r.start), PC.dayOf(r.start) + dd))) : 0;
      tip(e, `${group.length} tasks · ${dd >= 0 ? "+" : "−"}${wd} working day${wd === 1 ? "" : "s"}`);
    } else if (mode === "move") { g.setAttribute("transform", `translate(${dd * P.ppd},0)`); tip(e, `${fmt(PC.isoOf(PC.dayOf(r.start) + dd))} - ${fmt(PC.isoOf(PC.dayOf(r.finish) + dd))}`); }
    else if (mode === "dur") {
      const end = PC.dayOf(r.finish) + dd;
      const n = Math.max(1, P.cal.between(r.start, PC.isoOf(end)) + 1);
      bar.setAttribute("width", Math.max(3, X(PC.isoOf(end), true) - X(r.start)));
      tip(e, `${n} working days · to ${fmt(PC.isoOf(end))}`);
    } else {
      const x = e.clientX - box.left, y = e.clientY - box.top;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const tg = hit && hit.closest && hit.closest("[data-bar]");
      for (const o of svg.querySelectorAll(".bar.tgt")) o.classList.remove("tgt");
      target = null;
      if (tg && tg.dataset.bar !== id) {
        tg.classList.add("tgt");
        const tr = rowOf(tg.dataset.bar);
        const mid = (X(tr.start) + X(tr.finish, true)) / 2;
        target = { id: tr.id, side: tr.milestone || x < mid ? "S" : "F" };
        tip(e, `Link: ${r.name} → ${tr.name} (${side}${target.side} - ${PC.TYPE_LABEL[side + target.side]})`);
      } else tip(e, "Drop on a bar to link to it: its left half for its start, its right half for its finish");
      layer.innerHTML = `<path d="M${fx} ${fy}L${x} ${y}" class="l-drag"/>`;
    }
    last = dd;
  };
  const up = () => {
    svg.removeEventListener("pointermove", mv);
    svg.removeEventListener("pointerup", up);
    svg.removeEventListener("pointercancel", up);
    hideTip();
    layer.innerHTML = "";
    if (!moved) return;
    const t = taskOf(id);
    if (mode === "move" && last && group.length > 1) {
      moveTasks(group.map((x) => x.id), (x) => PC.dayOf(x.start) + last);
    } else if (mode === "move" && last) {
      before();
      const want = PC.isoOf(PC.dayOf(r.start) + last);
      t.start = PC.isoOf(P.cal.dayAt(P.cal.ord(PC.dayOf(want))));
      const hadFnet = !!t.fnet;
      delete t.fnet;                     // dragged to a date: that date, not an old "finish no earlier than" (as MS Project)
      changed();
      const now = rowOf(id);
      if (now.start > t.start) toast(t.deps.some((d) => d.drive !== false) ? "Held later by its predecessor - change the link's lag to start it sooner"
        : "Held later by the project start (Set up > Title block) - or a summary's link");
      else if (hadFnet) toast("Its \"finish no earlier than\" date was cleared - the bar is where you put it");
    } else if (mode === "dur" && last) {
      before();
      t.dur = Math.max(1, P.cal.between(r.start, PC.isoOf(PC.dayOf(r.finish) + last)) + 1);
      t.kind = "task";
      changed();
    } else if (mode === "link" && target) {
      const s = taskOf(target.id);
      if (s.deps.some((d) => d.from === id)) return toast("They are linked already - click the link to change it");
      before();
      s.deps.push({ from: id, type: side + target.side, lag: 0 });
      if (checkLoop()) changed();
    } else render();
  };
  svg.addEventListener("pointermove", mv);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
}

/* several tasks to new starts at once (one Undo): to(row) -> the new day; a
   task held by a predecessor outside them is reported */
function moveTasks(ids, to) {
  if (!ids.length) return;
  before();
  const want = new Map();
  for (const id of ids) {
    const r = rowOf(id), t = taskOf(id);
    if (!r || !t || r.summary) continue;
    t.start = PC.isoOf(P.cal.dayAt(P.cal.ord(to(r))));
    delete t.fnet;
    want.set(id, t.start);
  }
  changed();
  let held = 0;
  for (const [id, s] of want) { const now = rowOf(id); if (now && now.start > s) held++; }
  if (held) toast(`${held} held later by ${held === 1 ? "its predecessor" : "their predecessors"} outside the selection - change the link's lag to start sooner`);
}
/* Alt+← / Alt+→: the selection a working day earlier / later */
function nudge(n) {
  if (!P.can || !P.sel.size) return;
  moveTasks([...P.sel], (r) => P.cal.dayAt(P.cal.ord(PC.dayOf(r.start)) + n));
}

function tip(ev, html) {
  const t = $("#pg-tip");
  t.hidden = false;
  t.innerHTML = html;
  t.style.left = Math.min(innerWidth - t.offsetWidth - 8, ev.clientX + 14) + "px";
  t.style.top = (ev.clientY + 16) + "px";
}
function hideTip() { $("#pg-tip").hidden = true; }

function hover(ev) {
  if (ev.buttons) return;
  const g = ev.target.closest("[data-bar]");
  if (!g) return hideTip();
  const r = rowOf(g.dataset.bar), t = taskOf(g.dataset.bar);
  const v = baseline() ? PC.variance(r, baseline(), P.cal) : null;
  tip(ev, `<b>${esc(r.wbs)} ${esc(r.name)}</b><br>${fmtLong(r.start)}${r.milestone ? "" : " - " + fmtLong(r.finish)} · ${r.milestone ? "milestone" : r.dur + " working days"}`
    + (r.summary ? "" : `<br>Float ${r.tf} d${r.critical ? ` · <b class="pg-crit-t">critical</b>` : ""} · ${r.pct}% done`)
    + (t.party ? `<br>${esc(t.party)}` : "") + (t.deps.length ? `<br>After: ${esc(PC.formatDeps(t.deps, tasks()))}` : "")
    + (v ? `<br>Baseline finish ${fmtLong(v.bfinish)} (${v.finish > 0 ? "+" : ""}${v.finish} d)` : ""));
}

function linkMenu(lk, ev) {
  const from = lk.dataset.lf, to = lk.dataset.lt;
  const t = taskOf(to);
  const d = t && t.deps.find((x) => x.from === from);
  if (!d) return;
  const f = rowOf(from), s = rowOf(to);
  const sty = d.style || (d.drive === false ? "dashed" : "solid");
  const el = pop(lk, `<div class="pg-lm"><b>${esc(f.name)} → ${esc(s.name)}</b>`
    + `<label>Type <select class="lm-t">${PC.TYPES.map((x) => `<option value="${x}"${x === d.type ? " selected" : ""}>${x} - ${PC.TYPE_LABEL[x]}</option>`).join("")}</select></label>`
    + `<label>Lag (working days; minus for a lead) <input class="lm-l" type="number" step="1" value="${d.lag || 0}"></label>`
    + `<label class="row-check"><input type="checkbox" class="lm-d"${d.drive === false ? "" : " checked"}> Drives the dates (off: a related link only - drawn, not scheduled)</label>`
    + `<div class="pg-2"><label>Line <select class="lm-s">${["solid", "dashed", "dotted"].map((x) => `<option${x === sty ? " selected" : ""}>${x}</option>`).join("")}</select></label>`
    + `<label>Colour <span class="pg-cl"><input type="color" class="lm-c" value="${esc(d.color || "#7d8b9c")}"><button type="button" class="ghost lm-cx" title="The usual colour">&times;</button></span></label></div>`
    + `<div class="row end">${P.can ? `<button type="button" class="ghost lm-x">Delete link</button><button type="button" class="primary lm-ok">Done</button>` : ""}</div></div>`, 320);
  el.style.left = Math.min(innerWidth - 330, ev.clientX) + "px";
  el.style.top = Math.min(innerHeight - el.offsetHeight - 8, ev.clientY + 10) + "px";
  if (!P.can) { for (const i of el.querySelectorAll("select, input, button")) i.disabled = true; return; }
  let color = d.color || "";
  el.querySelector(".lm-c").oninput = (e) => { color = e.target.value; };
  el.querySelector(".lm-cx").onclick = () => { color = ""; el.querySelector(".lm-c").value = "#7d8b9c"; };
  el.querySelector(".lm-d").onchange = (e) => { if (!e.target.checked && el.querySelector(".lm-s").value === "solid") el.querySelector(".lm-s").value = "dashed"; };
  el.querySelector(".lm-ok").onclick = () => {
    before();
    d.type = el.querySelector(".lm-t").value;
    d.lag = Math.round(+el.querySelector(".lm-l").value || 0);
    if (el.querySelector(".lm-d").checked) delete d.drive; else d.drive = false;
    const st = el.querySelector(".lm-s").value;
    if (st === "solid" && d.drive !== false) delete d.style; else d.style = st;
    if (color) d.color = color; else delete d.color;
    closePop();
    if (checkLoop()) changed();
  };
  el.querySelector(".lm-x").onclick = () => { before(); t.deps = t.deps.filter((x) => x !== d); closePop(); changed(); };
}

/* ------------------------------------------------------------ the dialogs */

function lastModal() { const all = document.querySelectorAll(".t-modal-back"); return all[all.length - 1]; }

/* ---------------------------------------------- the Properties side panel */

function activity(id) { if (!P.sel.has(id)) { P.sel = new Set([id]); P.cur = id; paintGrid(); paintChart(); } openProps(); }
function openProps() {
  let el = $("#pg-props");
  if (!el) {
    el = document.createElement("aside");
    el.id = "pg-props";
    el.className = "pg-props";
    $("#pg").appendChild(el);
    el.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); closeProps(); } });
  }
  el.hidden = false;
  document.body.classList.add("pg-props-on");
  paintProps();
}
function closeProps() { const el = $("#pg-props"); if (el) el.hidden = true; document.body.classList.remove("pg-props-on"); }
const propsOpen = () => { const el = $("#pg-props"); return el && !el.hidden; };

function paintProps() {
  const el = $("#pg-props");
  if (!el || el.hidden) return;
  const ids = P.rows.filter((r) => P.sel.has(r.id)).map((r) => r.id);
  const focus = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.f || document.activeElement.className : "";
  const ro = !P.can ? " disabled" : "";
  const catOpts = (cur, keep) => (keep ? `<option value="__keep">(keep)</option>` : "") + `<option value=""${cur === "" ? " selected" : ""}>None</option>`
    + P.d.categories.map((c) => `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  const head = `<div class="pp-h"><b>${ids.length > 1 ? ids.length + " rows" : "Properties"}</b><span class="spacer"></span><button type="button" class="ghost pp-x" title="Close (Esc)">&times;</button></div>`;
  if (!ids.length) { el.innerHTML = head + `<p class="muted pp-pad">Select a row (click, or Ctrl / Shift + click for several).</p>`; wireProps(el, ids); return; }
  if (ids.length > 1) {
    el.innerHTML = head + `<div class="pp-pad"><p class="muted">Set what should change for all ${ids.length}; leave the rest.</p>
      <label>Category<select data-f="b-cat"${ro}>${catOpts("__keep", true)}</select></label>
      <label>Colour <span class="pg-cl"><input type="color" data-f="b-color" value="#4a78a8"${ro}><label class="row-check"><input type="checkbox" data-f="b-color-on"${ro}> set</label><button type="button" class="ghost" data-f="b-color-clear"${ro}>Clear colour</button></span></label>
      <label>Responsible<input data-f="b-party" placeholder="(keep)"${ro}></label>
      <div class="pg-2"><label>% done<input data-f="b-pct" type="number" min="0" max="100" placeholder="(keep)"${ro}></label>
      <label>Duration<input data-f="b-dur" placeholder="(keep)"${ro}></label></div>
      <label>Move the start by working days (minus: earlier)<input data-f="b-shift" type="number" step="1" placeholder="0"${ro}></label>
      <label class="row-check"><input type="checkbox" data-f="b-bold"${ro}> Bold names</label>
      <div class="row end"><button type="button" class="primary" data-f="b-apply"${ro}>Apply to ${ids.length} rows</button></div></div>`;
    wireProps(el, ids);
    return;
  }
  const id = ids[0], t = taskOf(id), r = rowOf(id);
  const L = t.links || {};
  const lt = L.task ? P.linked.get(L.task.list + ":" + L.task.id) : null;
  const opts = tasks().filter((x) => x.id !== id).map((x) => `<option value="${esc(x.id)}">${esc(rowOf(x.id).wbs + " " + (x.name || ""))}</option>`).join("");
  const depRow = (d, k) => `<div class="pp-dep" data-k="${k}"><select data-f="dp-f"${ro}>${opts.replace(`value="${esc(d.from)}"`, `value="${esc(d.from)}" selected`)}</select>`
    + `<select data-f="dp-t"${ro}>${PC.TYPES.map((x) => `<option${x === (d.type || "FS") ? " selected" : ""}>${x}</option>`).join("")}</select>`
    + `<input data-f="dp-l" type="number" step="1" value="${d.lag || 0}" title="Lag, working days"${ro}>`
    + `<select data-f="dp-s" title="Line"${ro}>${["solid", "dashed", "dotted"].map((x) => `<option${x === (d.style || (d.drive === false ? "dashed" : "solid")) ? " selected" : ""}>${x}</option>`).join("")}</select>`
    + `<label class="row-check" title="Drives the dates (off: related only)"><input type="checkbox" data-f="dp-d"${d.drive === false ? "" : " checked"}${ro}> drives</label>`
    + `<button type="button" class="ghost" data-f="dp-x" title="Remove"${ro}>&times;</button></div>`;
  const dis = (c) => (r.summary && c ? " disabled" : ro);
  el.innerHTML = head + `<div class="pp-pad">
    <label>Name<input data-f="name" value="${esc(t.name)}" maxlength="300"${ro}></label>
    <div class="pg-2"><label>Kind<select data-f="kind"${dis(1)}><option value="task">Task</option><option value="milestone"${t.kind === "milestone" ? " selected" : ""}>Milestone</option></select></label>
      <label>Category<select data-f="cat"${ro}>${catOpts(t.cat || "")}</select></label></div>
    <div class="pg-2"><label>Start (no earlier than)<input data-f="start" type="date" value="${esc(t.start || "")}"${dis(1)}></label>
      <label>Duration<input data-f="dur" value="${r.milestone ? 0 : r.dur}"${dis(1)}></label></div>
    <div class="pg-2"><label>Finish<input data-f="finish" type="date" value="${esc(r.finish)}"${dis(1)}></label>
      <label>% done<input data-f="pct" type="number" min="0" max="100" value="${r.pct}"${dis(1)}></label></div>
    <label title="MS Project's Finish No Earlier Than: the task may not finish before this day">Finish no earlier than<input data-f="fnet" type="date" value="${esc(t.fnet || "")}"${dis(1)}></label>
    <p class="muted pg-dates">${fmtLong(r.start)}${r.milestone ? "" : " - " + fmtLong(r.finish)} · total float ${r.tf} d · free float ${r.ff} d${r.critical ? ` · <b class="pg-crit-t">critical</b>` : ""}</p>
    <div class="pg-2"><label>Responsible<input data-f="party" value="${esc(t.party || "")}" placeholder="e.g. Architect, BD"${ro}></label>
      <label>Bar colour <span class="pg-cl"><input type="color" data-f="color" value="${esc(t.color || fillOf(t) || "#4a78a8")}"${ro}><button type="button" class="ghost" data-f="color-x" title="The category's colour"${ro}>&times;</button></span></label></div>
    <label>Beside this bar<select data-f="label"${ro}><option value="">As in Format (${esc((LABELS.find((x) => x[0] === (P.d.format.label || "party")) || ["", ""])[1])})</option>${LABELS.map(([v, n]) => `<option value="${v}"${t.label === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="pp-chk"><label class="row-check"><input type="checkbox" data-f="bold"${t.style && t.style.bold ? " checked" : ""}${ro}> Bold</label><label class="row-check"><input type="checkbox" data-f="italic"${t.style && t.style.italic ? " checked" : ""}${ro}> Italic</label></div>
    <label>Notes<textarea data-f="notes" rows="2"${ro}>${esc(t.notes || "")}</textarea></label>
    <h4>Predecessors</h4><div class="pp-deps">${t.deps.map(depRow).join("") || `<p class="muted">None - type them in the Predecessors column, or drag between bars.</p>`}</div>
    ${P.can ? `<button type="button" class="ghost" data-f="dp-add">+ Predecessor</button>` : ""}
    <h4>Linked</h4>
    <div class="pg-links">
      <div class="pg-lrow"><b>Task</b> ${L.task ? `<a href="tasks.html?list=${encodeURIComponent(L.task.list)}&task=${encodeURIComponent(L.task.id)}" target="_blank">${esc(L.task.title)}</a> <span class="muted">${lt ? (lt.done ? "done" : (lt.percent || 0) + "%") + (lt.due ? " · due " + fmt(lt.due) : "") : ""}</span>
        <button type="button" class="ghost lk-sync" title="Set the task's start and due to this activity's dates">Update its dates</button>
        <label class="row-check"><input type="checkbox" data-f="use_pct"${L.use_pct ? " checked" : ""}${ro}> take its % done</label>
        <button type="button" class="ghost lk-un">Unlink</button>`
        : `<button type="button" class="ghost lk-new">Create a task</button><button type="button" class="ghost lk-old">Link an existing task</button>`}</div>
      <div class="pg-lrow"><b>Chat</b> ${L.room ? `<a href="messenger.html?room=${encodeURIComponent(L.room.id)}" target="_blank">${esc(L.room.title)}</a> <button type="button" class="ghost lk-chat">Post again</button>` : `<button type="button" class="ghost lk-chat">Discuss in chat</button>`}</div>
    </div></div>`;
  if (!P.can) for (const b of el.querySelectorAll(".pg-links button")) b.disabled = true;
  wireProps(el, ids);
  if (focus) { const f = el.querySelector(`[data-f="${focus}"]`); if (f) f.focus(); }
}

function wireProps(el, ids) {
  el.querySelector(".pp-x").onclick = closeProps;
  if (!P.can) return;
  const q = (f) => el.querySelector(`[data-f="${f}"]`);
  if (ids.length > 1) {
    let colour = null;
    q("b-color").oninput = () => { q("b-color-on").checked = true; };
    q("b-color-clear").onclick = () => { colour = "clear"; q("b-color-on").checked = false; toast("The colour will be cleared - press Apply"); };
    q("b-apply").onclick = () => {
      before();
      const cat = q("b-cat").value, party = q("b-party").value.trim(), pct = q("b-pct").value, dur = q("b-dur").value.trim();
      const shift = Math.round(+q("b-shift").value || 0);
      for (const id of ids) {
        const t = taskOf(id), r = rowOf(id);
        if (cat !== "__keep") { if (cat) t.cat = cat; else delete t.cat; }
        if (q("b-color-on").checked) t.color = q("b-color").value; else if (colour === "clear") delete t.color;
        if (party) t.party = party.slice(0, 120);
        if (pct !== "" && !r.summary) t.pct = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
        if (dur && !r.summary) { const n = PC.parseDur(dur, P.cal.perWeek); if (n !== null) { t.dur = n; t.kind = n === 0 ? "milestone" : "task"; } }
        if (shift && !r.summary) t.start = P.cal.isoAt(P.cal.ordOf(r.start) + shift);
        if (q("b-bold").checked) t.style = Object.assign({}, t.style, { bold: true });
      }
      if (checkLoop()) changed();
      toast(`${ids.length} rows changed`);
    };
    return;
  }
  const id = ids[0], t = taskOf(id);
  const set = (fn) => { before(); fn(); if (checkLoop()) changed(); };
  const on = (f, ev, fn) => { const x = q(f); if (x) x.addEventListener(ev, fn); };
  on("name", "change", (e) => set(() => { t.name = e.target.value.trim().slice(0, 300); }));
  on("kind", "change", (e) => set(() => { t.kind = e.target.value; if (t.kind === "milestone") t.dur = 0; else if (!t.dur) t.dur = 1; }));
  on("cat", "change", (e) => set(() => { if (e.target.value) t.cat = e.target.value; else delete t.cat; }));
  on("start", "change", (e) => { if (apply(id, "start", e.target.value)) changed(); });
  on("dur", "change", (e) => { if (apply(id, "dur", e.target.value)) changed(); else paintProps(); });
  on("finish", "change", (e) => { if (apply(id, "finish", e.target.value)) changed(); else paintProps(); });
  on("pct", "change", (e) => { if (apply(id, "pct", e.target.value)) changed(); else paintProps(); });
  on("fnet", "change", (e) => set(() => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) t.fnet = e.target.value; else delete t.fnet; }));
  on("label", "change", (e) => set(() => { if (e.target.value) t.label = e.target.value; else delete t.label; }));
  on("party", "change", (e) => set(() => { t.party = e.target.value.trim().slice(0, 120); }));
  on("notes", "change", (e) => set(() => { t.notes = e.target.value.trim().slice(0, 2000); }));
  on("color", "change", (e) => set(() => { t.color = e.target.value; }));
  on("color-x", "click", () => set(() => { delete t.color; }));
  on("bold", "change", (e) => set(() => { t.style = Object.assign({}, t.style, { bold: e.target.checked }); }));
  on("italic", "change", (e) => set(() => { t.style = Object.assign({}, t.style, { italic: e.target.checked }); }));
  on("use_pct", "change", (e) => set(() => { t.links.use_pct = e.target.checked; }));
  on("dp-add", "click", () => {
    const other = tasks().find((x) => x.id !== id && !t.deps.some((d) => d.from === x.id));
    if (!other) return;
    set(() => { t.deps.push({ from: other.id, type: "FS", lag: 0 }); });
  });
  const box = el.querySelector(".pp-deps");
  const readDeps = () => [...box.querySelectorAll(".pp-dep")].map((x) => {
    const old = t.deps[+x.dataset.k] || {};
    const d = Object.assign({}, old, { from: x.querySelector('[data-f="dp-f"]').value, type: x.querySelector('[data-f="dp-t"]').value, lag: Math.round(+x.querySelector('[data-f="dp-l"]').value || 0) });
    const st = x.querySelector('[data-f="dp-s"]').value;
    if (x.querySelector('[data-f="dp-d"]').checked) delete d.drive; else d.drive = false;
    if (st === "solid" && d.drive !== false) delete d.style; else d.style = st;
    return d;
  }).filter((d, k, all) => d.from && d.from !== id && all.findIndex((y) => y.from === d.from) === k);
  box.addEventListener("change", () => set(() => { t.deps = readDeps(); }));
  box.addEventListener("click", (e) => {
    const x = e.target.closest('[data-f="dp-x"]');
    if (!x) return;
    x.closest(".pp-dep").remove();
    set(() => { t.deps = readDeps(); });
  });
  const lk = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; paintProps(); } }; };
  lk(".lk-new", async () => { await createTask(t); });
  lk(".lk-old", async () => { await linkTask(t, el.querySelector(".lk-old")); });
  lk(".lk-un", async () => { before(); delete t.links.task; changed(); });
  lk(".lk-sync", async () => syncTask(t));
  lk(".lk-chat", async () => { await discuss(t); });
}

async function taskLists() {
  const lists = ((await api("/api/task-lists")).lists || []).filter((l) => l.role === "owner" || l.role === "editor");
  if (!lists.length) { toast("You cannot add tasks to any task list yet - ask a list owner", true); return null; }
  const mine = lists.filter((l) => !l.project || l.project === project());
  return mine.length ? mine : lists;
}
const backLink = (t) => ({ kind: "url", url: `/programme.html?project=${encodeURIComponent(project() || "")}${P.pg ? "&pg=" + P.pg : ""}&task=${encodeURIComponent(t.id)}`, title: "Programme: " + (t.name || "") });

async function createTask(t) {
  const lists = await taskLists();
  if (!lists) return false;
  const r = rowOf(t.id);
  const f = await modal("Create a task from the programme", `
    <label>Task list<select name="list">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>
    <label>Title<input name="title" value="${esc(t.name)}"></label>
    <div class="pg-2"><label>Start<input name="start" type="date" value="${r.start}"></label><label>Due<input name="due" type="date" value="${r.finish}"></label></div>
    <p class="muted">The task links back to this activity; its % done can feed the programme.</p>`, "Create");
  if (!f) return false;
  const id = uid();
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: f.list.value, tasks: [{ id, title: f.title.value.trim() || t.name, start: f.start.value, due: f.due.value,
      description: `From the programme: ${r.wbs} ${t.name}${t.party ? " (" + t.party + ")" : ""}`, links: [backLink(t)] }] }) });
  } catch (e) { toast("Could not make the task: " + e.message, true); return false; }
  before();
  t.links.task = { list: f.list.value, id, title: f.title.value.trim() || t.name };
  P.linked.set(f.list.value + ":" + id, { title: t.links.task.title, percent: 0, done: false, due: f.due.value, start: f.start.value });
  changed();
  toast("Task made in " + (lists.find((l) => l.id === f.list.value) || {}).title);
  return true;
}
async function linkTask(t, anchor) {
  const lists = await taskLists();
  if (!lists) return false;
  const f = await modal("Link an existing task", `<label>Task list<select name="list">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>
    <label>Task<select name="task"><option value="">Loading ...</option></select></label>`, "Link");
  return f ? done(f) : false;
  async function done(form) {
    const id = form.task.value;
    if (!id) return false;
    const label = form.task.selectedOptions[0].textContent;
    before();
    t.links.task = { list: form.list.value, id, title: label };
    changed();
    await loadLinked();
    render();
    // the task links back too
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: form.list.value, tasks: [{ id, links: (P.linkedLinks.get(id) || []).concat([backLink(t)]) }] }) }); } catch (e) {}
    return true;
  }
}
// fill the task list's tasks into the open "Link an existing task" dialog
document.addEventListener("change", (ev) => { if (ev.target.name === "list" && lastModal() && lastModal().querySelector('select[name="task"]')) fillTasks(); });
const fillObserver = new MutationObserver(() => { const m = lastModal(); if (m && m.querySelector('select[name="task"]') && !m.dataset.filled) { m.dataset.filled = "1"; fillTasks(); } });
fillObserver.observe(document.body, { childList: true });
async function fillTasks() {
  const m = lastModal();
  const sel = m.querySelector('select[name="task"]');
  const list = m.querySelector('select[name="list"]').value;
  sel.innerHTML = `<option value="">Loading ...</option>`;
  try {
    const r = await api("/api/tasks?list=" + encodeURIComponent(list));
    P.linkedLinks = P.linkedLinks || new Map();
    const ts = (r.tasks || []).filter((x) => !x.deleted);
    for (const x of ts) P.linkedLinks.set(x.id, x.links || []);
    sel.innerHTML = ts.length ? ts.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}${x.done ? " ✓" : ""}</option>`).join("") : `<option value="">No tasks in this list</option>`;
  } catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
}
async function syncTask(t) {
  const r = rowOf(t.id), l = t.links.task;
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: l.list, tasks: [{ id: l.id, start: r.start, due: r.finish }] }) });
    toast(`Task dates set: ${fmt(r.start)} - ${fmt(r.finish)}`);
  } catch (e) { toast(e.message, true); }
}
async function discuss(t) {
  let rooms = [];
  try { rooms = ((await api("/api/chat/rooms")).rooms || []).filter((x) => x.kind !== "dm" || true); } catch (e) { toast(e.message, true); return false; }
  if (!rooms.length) { toast("You are in no chat yet", true); return false; }
  const pr = project();
  rooms.sort((a, b) => ((b.project === pr) - (a.project === pr)) || String(a.title).localeCompare(String(b.title)));
  const r = rowOf(t.id);
  const url = `${location.origin}/programme.html?project=${encodeURIComponent(pr || "")}${P.pg ? "&pg=" + P.pg : ""}&task=${encodeURIComponent(t.id)}`;
  const text = `Programme · ${r.wbs} ${t.name}\n${r.milestone ? "Milestone " + fmtLong(r.start) : `${fmtLong(r.start)} - ${fmtLong(r.finish)} · ${r.dur} working days`} · float ${r.tf} d${r.critical ? " · on the critical path" : ""}${t.party ? "\nResponsible: " + t.party : ""}\n${url}`;
  const f = await modal("Discuss in chat", `<label>Chat<select name="room">${rooms.map((x) => `<option value="${esc(x.id)}"${t.links.room && t.links.room.id === x.id ? " selected" : ""}>${esc(x.title || "Chat")}</option>`).join("")}</select></label>
    <label>Message<textarea name="body" rows="5">${esc(text)}</textarea></label>`, "Post");
  if (!f) return false;
  try { await api(`/api/chat/rooms/${encodeURIComponent(f.room.value)}/messages`, { method: "POST", body: JSON.stringify({ body: f.body.value }) }); }
  catch (e) { toast(e.message, true); return false; }
  before();
  t.links.room = { id: f.room.value, title: f.room.selectedOptions[0].textContent };
  changed();
  toast("Posted in " + t.links.room.title);
  return true;
}

async function loadLinked() {
  if (P.mine) return false;           // a programme of one's own: no project's Tasks to follow
  const want = new Map();
  for (const t of tasks()) if (t.links && t.links.task) want.set(t.links.task.list, true);
  P.linkedLinks = P.linkedLinks || new Map();
  let changedPct = false;
  for (const list of want.keys()) {
    try {
      const r = await api("/api/tasks?list=" + encodeURIComponent(list));
      for (const x of r.tasks || []) {
        P.linked.set(list + ":" + x.id, { title: x.title, percent: x.percent || 0, done: !!x.done, due: x.due, start: x.start });
        P.linkedLinks.set(x.id, x.links || []);
      }
    } catch (e) {}
  }
  for (const t of tasks()) {
    const l = t.links && t.links.task;
    const x = l && P.linked.get(l.list + ":" + l.id);
    if (x && t.links.use_pct) {
      const p = x.done ? 100 : Math.round(x.percent || 0);
      if (p !== (t.pct || 0)) { t.pct = p; changedPct = true; }
    }
  }
  return changedPct;
}

function statusDate(anchor) {
  const el = pop(anchor, `<label class="pg-pl">Status date (for progress)<input type="date" class="sd" value="${esc(P.d.cover.status_date || "")}"></label>`
    + `<div class="row end"><button type="button" class="ghost sd-t">Today</button><button type="button" class="ghost sd-x">Clear</button></div>`, 240);
  const set = (v) => { closePop(); if (!P.can) { P.d.cover.status_date = v; recalc(); render(); return; } before(); P.d.cover.status_date = v; changed(); };
  el.querySelector(".sd").onchange = (e) => set(e.target.value);
  el.querySelector(".sd-t").onclick = () => set(PC.todayIso());
  el.querySelector(".sd-x").onclick = () => set("");
}

function baseMenu(anchor) {
  const bs = P.d.baselines;
  const el = pop(anchor, `<div class="po-row${!P.view.baseline ? " on" : ""}" data-b="">No baseline</div>`
    + bs.map((b) => `<div class="po-row pg-brow${b.id === P.view.baseline ? " on" : ""}" data-b="${esc(b.id)}"><span>${esc(b.name)}<small class="muted"> · ${esc(fmtLong(b.saved_at))}${b.by ? " · " + esc(b.by) : ""}</small></span>${P.can ? `<button type="button" class="ghost pg-bx" data-bx="${esc(b.id)}" title="Delete this baseline">&times;</button>` : ""}</div>`).join("")
    + (P.can ? `<div class="po-row pg-bsave" data-bsave="1">+ Save a baseline now ...</div>` : ""), 300);
  el.addEventListener("click", async (ev) => {
    const x = ev.target.closest("[data-bx]");
    if (x) {
      ev.stopPropagation();
      if (!confirm("Delete this baseline?")) return;
      before();
      P.d.baselines = bs.filter((b) => b.id !== x.dataset.bx);
      if (P.view.baseline === x.dataset.bx) P.view.baseline = "";
      saveView(); closePop(); changed();
      return;
    }
    if (ev.target.closest("[data-bsave]")) { closePop(); saveBaseline(); return; }
    const r = ev.target.closest("[data-b]");
    if (!r) return;
    P.view.baseline = r.dataset.b;
    if (P.view.baseline && !P.d.columns.includes("var")) toast("Tip: View > Columns > Finish variance shows the slip of each task");
    saveView(); closePop(); recalc(); render();
  });
}
async function saveBaseline() {
  if (P.d.baselines.length >= 11) return toast("11 baselines at most - delete one first", true);
  const f = await modal("Save a baseline", `<label>Name<input name="name" value="${esc(P.d.baselines.length ? "Baseline " + (P.d.baselines.length + 1) : "Tender programme")}" maxlength="80"></label>
    <p class="muted">Keeps today's dates of every task, to compare with later (grey bars under the bars, and the finish variance).</p>`, "Save");
  if (!f) return;
  before();
  const b = PC.takeBaseline(P.sched, f.name.value.trim() || "Baseline", P.me && P.me.user ? P.me.user.name : "");
  b.start = P.sched.start; b.finish = P.sched.finish;
  P.d.baselines.push(b);
  P.view.baseline = b.id;
  saveView();
  changed();
  toast("Baseline kept: " + b.name);
}

function viewMenu(anchor) {
  const all = Object.keys(COLS);
  const el = pop(anchor, `<div class="pg-vm"><h5>Columns</h5>${all.map((k) => `<label class="row-check"><input type="checkbox" data-col="${k}"${P.d.columns.includes(k) ? " checked" : ""}${k === "name" ? " disabled" : ""}> ${esc(COLS[k].label)}</label>`).join("")}
    <h5>Chart</h5>
    <label class="row-check"><input type="checkbox" data-v="links"${P.view.links ? " checked" : ""}> Links (arrows)</label>
    <label class="row-check"><input type="checkbox" data-v="labels"${P.view.labels ? " checked" : ""}> Labels beside the bars</label>
    <label class="row-check"><input type="checkbox" data-v="progress"${P.view.progress ? " checked" : ""}> Progress line (needs a status date)</label>
    <label class="row-check"><input type="checkbox" data-v="critOnly"${P.view.critOnly ? " checked" : ""}> Only the critical tasks</label>
    <h5>Outline</h5>
    <label class="pg-lvl">Show to level <select data-lvl="1"><option value="0">All</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${+P.view.level === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="row"><button type="button" class="ghost" data-all="1">Expand all</button><button type="button" class="ghost" data-all="0">Collapse all</button></div>
    <div class="row"><button type="button" class="ghost" data-fmt="1">Format ...</button>${P.can ? `<button type="button" class="ghost" data-cats="1">Categories ...</button>` : ""}</div></div>`, 260);
  el.addEventListener("change", (ev) => {
    const i = ev.target;
    if (i.dataset.col) {
      const k = i.dataset.col;
      const want = Object.keys(COLS).filter((x) => (x === k ? i.checked : P.d.columns.includes(x)));
      if (P.can) { before(); P.d.columns = want; changed(); } else { P.d.columns = want; recalc(); render(); }
    } else if (i.dataset.v) { P.view[i.dataset.v] = i.checked; saveView(); recalc(); render(); }
    else if (i.dataset.lvl) { P.view.level = +i.value; saveView(); recalc(); render(); }
  });
  el.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-fmt]")) { closePop(); return formatDlg(); }
    if (ev.target.closest("[data-cats]")) { closePop(); return categoriesDlg(); }
    const b = ev.target.closest("[data-all]");
    if (!b) return;
    if (b.dataset.all === "1") P.view.level = 0;
    P.view.collapsed = b.dataset.all === "1" ? [] : P.sched.rows.filter((r) => r.summary).map((r) => r.id);
    saveView(); recalc(); render();
  });
}

function setupMenu(anchor) {
  const el = pop(anchor, `<div class="po-row" data-s="cal">Working calendar and holidays ...</div><div class="po-row" data-s="cover">Title block and remarks (for the PDF) ...</div>`
    + `<div class="po-row" data-s="cats">Categories and colours ...</div><div class="po-row" data-s="fmt">Format (dates, rows, bars) ...</div>`
    + `<div class="po-row" data-s="move">Move the whole programme (new start date) ...</div>`
    + `<div class="po-row" data-s="tpl">Start from the architectural template ...</div><div class="po-row" data-s="hist">Earlier versions ...</div>`, 280);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest("[data-s]");
    if (!r) return;
    closePop();
    ({ cal: calendarDlg, cover: coverDlg, tpl: template, hist: historyDlg, cats: categoriesDlg, fmt: formatDlg, move: moveAllDlg })[r.dataset.s]();
  });
}
async function calendarDlg() {
  const c = P.d.calendar;
  const f = await modal("Working calendar", `
    <label>Working week<select name="week">${Object.entries(PC.WEEKS).map(([k, v]) => `<option value="${k}"${k === c.week ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <label class="row-check"><input type="checkbox" name="hk"${c.hk ? " checked" : ""}> Hong Kong general holidays (2026 - 2028, from the gazette)</label>
    <label>More holidays (one date a line, e.g. 2027-04-06)<textarea name="hol" rows="3">${esc((c.holidays || []).join("\n"))}</textarea></label>
    <label>The office's or the site's own days off (from..to a line, e.g. 2027-02-01..2027-02-12 Lunar New Year shutdown)<textarea name="off" rows="3">${esc((c.off || []).map((o) => (typeof o === "string" ? o : o.from + ".." + (o.to || o.from) + (o.name ? " " + o.name : ""))).join("\n"))}</textarea></label>
    <label>Project start (when a task has no date or link of its own)<input type="date" name="start" value="${esc(P.d.cover.start || "")}"></label>
    <label class="row-check"><input type="checkbox" name="moveall" checked> When the start changes, move every task with its own date by the same working days (the whole programme moves)</label>
    <p class="muted">Durations and lags count working days. Check the holidays against each year's gazette notice.</p>`, canSet() ? "Save" : "Close");
  if (!f || !canSet()) return;
  before();
  const hol = f.hol.value.split(/\s*\n\s*/).map((x) => x.trim().slice(0, 10)).filter((x) => PC.dayOf(x) !== null);
  const off = f.off.value.split(/\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|to|-)\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/.exec(x);
    return m ? { from: m[1], to: m[2] || m[1], name: m[3].slice(0, 80) } : null;
  }).filter(Boolean);
  const was = P.sched && (P.d.cover.start || P.sched.first), nowStart = f.start.value || "";
  P.d.calendar = { week: f.week.value, hk: f.hk.checked, holidays: hol, off };
  // the whole programme with its start: the dated tasks by the same working days
  if (f.moveall.checked && nowStart && was && nowStart !== (P.d.cover.start || "") && P.cal) {
    const d = P.cal.between(was, nowStart);
    if (d) shiftAll(d);
  }
  P.d.cover.start = nowStart;
  changed();
}
/* every task's own dates (start, finish no earlier than) d working days later (or earlier); links and durations as they are */
function shiftAll(d) {
  let n = 0;
  for (const t of tasks()) {
    if (t.start) { const o = P.cal.ordOf(t.start); if (o !== null) { t.start = P.cal.isoAt(o + d); n++; } }
    if (t.fnet) { const o = P.cal.ordOf(t.fnet); if (o !== null) t.fnet = P.cal.isoAt(o + d); }
  }
  if (P.d.cover.start) { const o = P.cal.ordOf(P.d.cover.start); if (o !== null) P.d.cover.start = P.cal.isoAt(o + d); }
  return n;
}
async function moveAllDlg() {
  if (!canSet()) return toast("Only a member can move the programme", true);
  const s0 = P.sched && P.sched.first;
  const f = await modal("Move the whole programme", `<p class="muted">Now it starts ${esc(fmtLong(s0))} and finishes ${esc(fmtLong(P.sched.last))} (${P.sched.span} working days).</p>
    <label>New start date<input type="date" name="to" value="${esc(s0 || "")}"></label>
    <label>or move by (working days, minus for earlier)<input type="number" name="by" step="1" placeholder="e.g. 10 or -5"></label>
    <p class="muted">Every task with its own date moves by the same working days; linked tasks follow their links. Baselines stay as they were.</p>`, "Move");
  if (!f) return;
  const by = f.by.value !== "" ? Math.round(+f.by.value) : P.cal.between(s0, f.to.value);
  if (!by) return toast("Nothing to move");
  before();
  const n = shiftAll(by);
  if (!P.d.cover.start && f.by.value === "" && f.to.value) P.d.cover.start = f.to.value;
  changed();
  toast(`Moved ${by > 0 ? "+" : ""}${by} working days (${n} dated task${n === 1 ? "" : "s"})`);
}
async function coverDlg() {
  const c = P.d.cover;
  const f = await modal("Title block and remarks", `
    <label>Title<input name="title" value="${esc(c.title || "Indicative Project Programme")}"></label>
    <div class="pg-2"><label>Project<input name="project" value="${esc(c.project || P.projectName || "")}"></label><label>Client<input name="client" value="${esc(c.client || "")}"></label></div>
    <div class="pg-2"><label>Revision<input name="rev" value="${esc(c.rev || "A")}"></label><label>Date<input type="date" name="date" value="${esc(c.date || PC.todayIso())}"></label></div>
    <div class="pg-2"><label>Prepared by<input name="prepared" value="${esc(c.prepared || (P.me && P.me.user ? P.me.user.name : ""))}"></label><label>Status date<input type="date" name="status_date" value="${esc(c.status_date || "")}"></label></div>
    <label>Note under the title (optional)<input name="note" value="${esc(c.note || "")}" placeholder="e.g. Subject to the Buildings Department's approval timing"></label>
    <label>Remarks (one a line, numbered on the PDF)<textarea name="remarks" rows="4">${esc(P.d.remarks.join("\n"))}</textarea></label>`, canSet() ? "Save" : "Close");
  if (!f || !canSet()) return;
  before();
  for (const k of ["title", "project", "client", "rev", "date", "prepared", "status_date", "note"]) c[k] = f[k].value.trim().slice(0, 200);
  P.d.remarks = f.remarks.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  changed();
}
async function historyDlg() {
  let items = [];
  try { items = (await api(pq("/api/programme/history"))).items || []; } catch (e) { return toast(e.message, true); }
  const el = await modal("Earlier versions", items.length ? `<div class="pg-hist">${items.map((x) => `<label class="row-check"><input type="radio" name="rev" value="${x.rev}"> Version ${x.rev} · ${esc(x.by || "")} · ${esc(String(x.at || "").replace("T", " ").slice(0, 16))} · ${x.tasks} tasks</label>`).join("")}</div><p class="muted">Bring one back: it becomes the newest version (the current one stays in the list).</p>` : `<p class="muted">No versions yet.</p>`, canSet() ? "Bring back" : "Close");
  if (!el || !canSet() || !el.rev) return;
  const rv = [...el.querySelectorAll('input[name="rev"]')].find((x) => x.checked);
  if (!rv) return;
  const old = await api(pq("/api/programme?rev=" + rv.value));
  before();
  Object.assign(P.d, defaults(old.data || {}));
  changed();
  toast("Version " + rv.value + " brought back");
}

async function template() {
  if (tasks().length && !confirm("Replace the programme with the template? (Undo brings it back.)")) return;
  const d = PC.dayOf(PC.todayIso());
  const mon = PC.isoOf(d + ((8 - new Date(Date.UTC(2000, 0, 1) + d * 86400000).getUTCDay()) % 7 || 7));
  const T = [
    // [level, name, dur, preds (by row, 1-based), party]
    [0, "Project inception"], [1, "Appointment and client brief", 10, "", "Client / Architect"], [1, "Site survey and constraints study", 15, "2", "Architect"],
    [0, "Design"], [1, "Concept and scheme design", 30, "3", "Architect"], [1, "Client approval of scheme", 0, "5", "Client"],
    [1, "Detailed design", 40, "6", "Architect"], [1, "Technical design and coordination", 30, "7SS+20", "Consultants"],
    [0, "Statutory submissions"], [1, "General building plans preparation", 20, "7SS+10", "Architect"], [1, "GBP submission", 0, "10", "AP"],
    [1, "BD vetting (60 days)", 42, "11", "Buildings Department"], [1, "GBP approval", 0, "12", "Buildings Department"], [1, "Foundation plans and consent to commence", 30, "13", "RSE / BD"],
    [0, "Tender"], [1, "Tender documents", 30, "8", "QS / Architect"], [1, "Tender period", 20, "16", "Tenderers"], [1, "Tender analysis and award", 15, "17", "QS / Client"], [1, "Contract award", 0, "18", "Client"],
    [0, "Construction"], [1, "Site possession", 0, "19; 14", "Contractor"], [1, "Foundation works", 80, "21", "Contractor"], [1, "Superstructure", 160, "22", "Contractor"],
    [1, "Building services installation", 120, "23SS+60", "Contractor"], [1, "Fitting out and external works", 90, "23FF+60", "Contractor"], [1, "Testing and commissioning", 30, "24; 25FF", "Contractor"],
    [0, "Completion"], [1, "Occupation permit application and inspections", 30, "26SS+10", "AP / BD"], [1, "Occupation permit", 0, "28", "Buildings Department"], [1, "Handover", 0, "29FS+5", "Client"],
  ];
  before();
  const list = T.map(([lv, name, dur, , party], k) => ({ id: uid(), name, level: lv, kind: dur === 0 ? "milestone" : "task", start: k === 1 ? mon : "", dur: dur === undefined ? 0 : dur, pct: 0, party: party || "", notes: "", deps: [], links: {} }));
  T.forEach((x, k) => { if (x[3]) { const p = PC.parseDeps(x[3], list, list[k].id, 5); if (!p.error) list[k].deps = p.deps; } });
  // the categories, by phase
  const phase = { "Project inception": "des", Design: "des", "Statutory submissions": "sta", Tender: "ten", Construction: "con", Completion: "sta" };
  let cur = "";
  list.forEach((t) => { if (t.level === 0) cur = phase[t.name] || cur; if (cur) t.cat = cur; if (t.kind === "milestone" && /Client|award|Handover/i.test(t.name)) t.cat = "cli"; });
  if (!P.d.categories.length) P.d.categories = DEFAULT_CATS.map((c) => Object.assign({}, c));
  P.d.tasks = list;
  if (!P.d.cover.title) P.d.cover.title = "Indicative Project Programme";
  P.view.collapsed = [];
  saveView();
  changed();
  toast("Template in: an indicative programme - change the durations and links to suit");
}

/* ------------------------------------------------------- export / import */

/* ------------------------------------------------- several programmes */
async function loadList() {
  P.list = [];
  if (project()) { try { P.list = (await api("/api/programme/list")).items || []; } catch (e) { P.list = []; } }
  try { P.mineList = (await api("/api/myprog/list")).items || []; } catch (e) { P.mineList = []; }
  if (P.mine) {
    const m = P.mineList.find((x) => x.id === P.mine) || { name: P.doc.name || "My programme", role: P.doc.role };
    P.pgName = m.name; P.mineMeta = m;
    $("#pg-which-n").textContent = "My programme · " + m.name + (m.role !== "owner" && m.owner_name ? " (shared by " + m.owner_name + ")" : "");
    $("#pg-which").title = "A programme of your own, not in a project - choose, share, copy into a project";
    document.title = m.name + " - My programme";
    return;
  }
  const me = P.list.find((x) => x.id === (P.pg || "main")) || P.list[0] || { name: "Programme" };
  P.pgName = me.name;
  $("#pg-which-n").textContent = me.name;
  $("#pg-which").title = P.list.length > 1 ? `${P.list.length} programmes in this project - choose, add, rename` : "Add another programme to this project, or rename this one";
  document.title = me.name + " - Programme";
}
function whichMenu(anchor) {
  const cur = P.mine ? "" : P.pg || "main";
  const mineRows = (P.mineList || []).map((x) => `<div class="po-row${x.id === P.mine ? " on" : ""}" data-mine="${esc(x.id)}"><b>${x.id === P.mine ? "&#10003; " : ""}${esc(x.name)}</b><br><small class="muted">${x.role === "owner" ? (x.all || Object.keys(x.share || {}).length ? "yours, shared" : "yours") : "shared by " + esc(x.owner_name || "someone") + (x.role === "view" ? " (view)" : "")} · ${x.tasks} task${x.tasks === 1 ? "" : "s"}</small></div>`).join("");
  const mineActs = `<div class="po-row" data-a="newmine"><b>+ New programme of my own</b><br><small class="muted">not in a project - empty, or a copy of the one open</small></div>`
    + (P.mine && P.mineMeta && P.mineMeta.role === "owner" ? `<div class="po-row" data-a="share">Share this programme ...</div>` : "")
    + (P.mine ? `<div class="po-row" data-a="toproj">Copy into a project ...</div>` : "")
    + (P.mine && P.doc.can_edit ? `<div class="po-row" data-a="ren">Rename this programme ...</div>` : "")
    + (P.mine && P.mineMeta && P.mineMeta.role === "owner" ? `<div class="po-row" data-a="del">Delete this programme ...</div>` : "");
  const projHead = project() ? `<div class="po-head">This project${P.projectName ? ": " + esc(P.projectName) : ""}</div>` : "";
  const el = pop(anchor, projHead + P.list.map((x) => `<div class="po-row${x.id === cur ? " on" : ""}" data-pg="${esc(x.id)}"><b>${x.id === cur ? "&#10003; " : ""}${esc(x.name)}</b><br><small class="muted">${x.tasks} task${x.tasks === 1 ? "" : "s"}${x.at ? " · saved " + esc(x.at.slice(0, 10)) + (x.by ? " by " + esc(x.by) : "") : ""}</small></div>`).join("")
    + (!P.mine && P.doc.can_edit && project() ? `<div class="po-row" data-a="new"><b>+ New programme in this project</b><br><small class="muted">empty, or a copy of this one</small></div>`
      + `<div class="po-row" data-a="ren">Rename this programme ...</div>`
      + (cur !== "main" ? `<div class="po-row" data-a="del">Delete this programme ...</div>` : "") : "")
    + `<hr><div class="po-head">My programmes <small class="muted">(not in a project)</small></div>` + mineRows + mineActs, 320);
  el.addEventListener("click", async (ev) => {
    const r = ev.target.closest("[data-pg],[data-a],[data-mine]");
    if (!r) return;
    closePop();
    if (r.dataset.pg) { if (r.dataset.pg !== cur) go(r.dataset.pg); return; }
    if (r.dataset.mine) { if (r.dataset.mine !== P.mine) goMine(r.dataset.mine); return; }
    if (r.dataset.a === "newmine") return newMine();
    if (r.dataset.a === "share") return shareMine();
    if (r.dataset.a === "toproj") return mineToProject();
    if (P.mine && r.dataset.a === "ren") {
      const f = await modal("Rename the programme", `<label>Name<input name="name" maxlength="80" value="${esc(P.pgName)}" required></label>`, "Rename");
      if (!f || !f.name.value.trim()) return;
      try { await api("/api/myprog/list/" + P.mine, { method: "PATCH", body: JSON.stringify({ name: f.name.value.trim() }) }); await loadList(); toast("Renamed"); } catch (e) { toast(e.message, true); }
      return;
    }
    if (P.mine && r.dataset.a === "del") {
      const f = await modal(`Delete "${P.pgName}"?`, `<p>Its ${tasks().length} tasks go${P.mineMeta && (P.mineMeta.all || Object.keys(P.mineMeta.share || {}).length) ? ", also for the people you shared it with" : ""}. The site admin can still get it back from the server (myprog/deleted).</p>`, "Delete");
      if (!f) return;
      try { await api("/api/myprog/list/" + P.mine, { method: "DELETE" }); P.pending = false; location.href = project() ? pgUrl("") : "projects.html"; } catch (e) { toast(e.message, true); }
      return;
    }
    if (r.dataset.a === "new") {
      const f = await modal("New programme", `<label>Name<input name="name" maxlength="80" placeholder="e.g. Phase 2, Fitting-out, Option B" required></label>
        <label class="row-check"><input type="radio" name="how" value="empty" checked> Empty</label>
        <label class="row-check"><input type="radio" name="how" value="copy"> A copy of "${esc(P.pgName)}" (tasks, links, calendar, set-up)</label>`, "Create");
      if (!f) return;
      const name = f.name.value.trim();
      if (!name) return toast("Give it a name", true);
      const copy = [...f.querySelectorAll('input[name="how"]')].find((x) => x.checked).value === "copy";
      if (copy && P.pending) await save();
      try {
        const n = await api("/api/programme/list", { method: "POST", body: JSON.stringify({ name, copy: copy ? cur : null }) });
        go(n.id);
      } catch (e) { toast(e.message, true); }
    } else if (r.dataset.a === "ren") {
      const f = await modal("Rename the programme", `<label>Name<input name="name" maxlength="80" value="${esc(P.pgName)}" required></label>`, "Rename");
      if (!f || !f.name.value.trim()) return;
      try { await api("/api/programme/list/" + cur, { method: "PATCH", body: JSON.stringify({ name: f.name.value.trim() }) }); await loadList(); toast("Renamed"); } catch (e) { toast(e.message, true); }
    } else if (r.dataset.a === "del") {
      const f = await modal(`Delete "${P.pgName}"?`, `<p>Its ${tasks().length} tasks go for everyone on the project. The site admin can still get it back from the server (programme/deleted).</p>`, "Delete");
      if (!f) return;
      try { await api("/api/programme/list/" + cur, { method: "DELETE" }); P.pending = false; go("main"); } catch (e) { toast(e.message, true); }
    }
  });
}
async function goMine(id) {
  if (P.pending) await save();
  location.href = mineUrl(id);
}
async function newMine(first) {
  const f = await modal("New programme of my own", `<p class="muted">Kept as yours, not in a project - for a tender or a job not in the viewer yet. You can share it, and copy it into a project later.</p>
    <label>Name<input name="name" maxlength="80" placeholder="e.g. Tender - School at Area 137" required></label>
    ${first ? "" : `<label class="row-check"><input type="radio" name="how" value="empty" checked> Empty</label>
    <label class="row-check"><input type="radio" name="how" value="copy"> A copy of "${esc(P.pgName || "this programme")}" (tasks, links, calendar, set-up)</label>`}`, "Create");
  if (!f) return null;
  const name = f.name.value.trim();
  if (!name) { toast("Give it a name", true); return null; }
  const copy = !first && [...f.querySelectorAll('input[name="how"]')].find((x) => x.checked).value === "copy";
  if (copy && P.pending) await save();
  try {
    const from = copy ? (P.mine ? { mine: P.mine } : { project: project(), pg: P.pg || "" }) : null;
    const n = await api("/api/myprog/list", { method: "POST", body: JSON.stringify({ name, from }) });
    location.href = mineUrl(n.id);
    return n;
  } catch (e) { toast(e.message, true); return null; }
}
async function shareMine() {
  const m = P.mineMeta || {};
  let people = [];
  try { people = ((await api("/api/people")).people || []).filter((p) => p.uid && !(P.me && ((P.me.email && p.email === P.me.email) || (P.me.id != null && String(p.uid) === String(P.me.id))))); } catch (e) {}
  const opt = (v, cur) => ["", "view", "edit"].map((k) => `<option value="${k}"${(cur || "") === k ? " selected" : ""}>${k ? (k === "view" ? "can view" : "can edit") : "-"}</option>`).join("");
  const f = await modal(`Share "${esc(P.pgName)}"`, `<label>Everyone in the office<select name="all">${opt("", m.all)}</select></label>
    <div class="pg-share">${people.length ? people.map((p) => `<label class="pg-share-r"><span>${esc(p.name)}<small class="muted"> ${esc(p.team || p.company || p.email || "")}</small></span><select data-uid="${esc(p.uid)}">${opt("", (m.share || {})[p.uid])}</select></label>`).join("") : `<p class="muted">No people to share with (accounts are off: everyone can open it).</p>`}</div>`, "Share");
  if (!f) return;
  const share = {};
  for (const sel of f.querySelectorAll("select[data-uid]")) if (sel.value) share[sel.dataset.uid] = sel.value;
  try { await api("/api/myprog/list/" + P.mine, { method: "PATCH", body: JSON.stringify({ share, all: f.all.value }) }); await loadList(); toast("Shared"); } catch (e) { toast(e.message, true); }
}
async function mineToProject() {
  let ps = [];
  try { const r = await api("/api/projects"); ps = (r.projects || r || []).filter((p) => !p.role || ["member", "publisher", "admin"].includes(p.role)); } catch (e) {}
  if (!ps.length) return toast("You are not a member of a project to copy it into", true);
  const f = await modal("Copy into a project", `<label>Project<select name="p">${ps.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.title || p.id)}</option>`).join("")}</select></label>
    <label>Name there<input name="name" maxlength="80" value="${esc(P.pgName)}"></label><p class="muted">A copy: this programme stays yours as it is.</p>`, "Copy");
  if (!f) return;
  if (P.pending) await save();
  try {
    const n = await api(`/api/myprog/${P.mine}/to-project`, { method: "POST", body: JSON.stringify({ project: f.p.value, name: f.name.value.trim() || P.pgName }) });
    toast("Copied - opening it in the project");
    location.href = `/programme.html?project=${encodeURIComponent(f.p.value)}&pg=${encodeURIComponent(n.id)}`;
  } catch (e) { toast(e.message, true); }
}
async function go(pg) {
  if (P.pending) await save();
  location.href = pgUrl(pg);
}

function exportMenu(anchor) {
  const el = pop(anchor, `<div class="po-row" data-x="pdf"><b>PDF for the client ...</b><br><small class="muted">A3 / A4, title block, legend, remarks</small></div>`
    + `<div class="po-row" data-x="xml"><b>MS Project XML</b><br><small class="muted">opens in MS Project (File > Open); Save As .mpp there</small></div>`
    + `<div class="po-row" data-x="csv"><b>CSV</b><br><small class="muted">for Excel</small></div>`, 250);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest("[data-x]");
    if (!r) return;
    closePop();
    if (r.dataset.x === "csv") downloadCsv(); else if (r.dataset.x === "xml") exportXml(); else pdfDlg();
  });
}
function fileName(ext) {
  const c = P.d.cover;
  return [(c.project || P.projectName || project() || "Programme"), P.pg && P.pgName ? P.pgName : "Programme", c.rev ? "Rev " + c.rev : "", PC.todayIso()].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ") + "." + ext;
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function downloadCsv() {
  if (!tasks().length) return toast("No tasks yet", true);
  download(new Blob([PC.toCsv(tasks(), P.sched, baseline())], { type: "text/csv;charset=utf-8" }), fileName("csv"));
}
async function pdfDlg() {
  if (!tasks().length) return toast("No tasks yet", true);
  const c = P.d.cover;
  const f = await modal("PDF for the client", `
    <div class="pg-2"><label>Paper<select name="paper"><option>A3</option><option>A4</option><option>A1</option></select></label>
      <label>Orientation<select name="orient"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label></div>
    <div class="pg-2"><label>From<input type="date" name="from" value="${P.sched.first}"></label><label>To<input type="date" name="to" value="${P.sched.last}"></label></div>
    <label>Baseline<select name="base"><option value="">None</option>${P.d.baselines.map((b) => `<option value="${esc(b.id)}"${b.id === P.view.baseline ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
    <label class="row-check"><input type="checkbox" name="crit"${P.view.critical ? " checked" : ""}> Critical path in red</label>
    <label class="row-check"><input type="checkbox" name="links"${P.view.links ? " checked" : ""}> Links (arrows)</label>
    <label class="row-check"><input type="checkbox" name="prog" checked> Progress (% done on the bars)</label>
    <label class="row-check"><input type="checkbox" name="status"${c.status_date ? " checked" : ""}> Status date line${c.status_date ? " (" + fmtLong(c.status_date) + ")" : " - set it in Set up > Title block"}</label>
    <label class="row-check"><input type="checkbox" name="labels"> The responsible party beside the bars</label>
    <div class="pg-2"><label>Pages wide<select name="wide"><option value="1">1 (all on one page width)</option><option value="auto">Auto (about 4 months a page)</option>${[2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>
      <label class="row-check pg-rep"><input type="checkbox" name="rep" checked> Repeat the ID and task name on the pages across</label></div>
    <label class="row-check"><input type="checkbox" name="solid"${P.d.format.solidred ? " checked" : ""}> Critical bars solid red (otherwise their colour, outlined red)</label>
    <p class="muted">Title: <b>${esc(c.title || "Indicative Project Programme")}</b>${c.rev ? " · Rev " + esc(c.rev) : ""} - change it in Set up > Title block. The columns and the rows shown (collapsed summaries stay collapsed) are printed as on the page.</p>`, "Make PDF");
  if (!f) return;
  const b = P.d.baselines.find((x) => x.id === f.base.value) || null;
  const at = new Map(P.rows.map((r, k) => [r.id, k]));
  const rows = P.rows.map((r) => {
    const t = tasks()[r.i];
    const v = b ? PC.variance(r, b, P.cal) : null;
    const cells = {};
    for (const k of P.d.columns) if (k !== "name") cells[k] = k === "bstart" || k === "bfinish" || k === "var" ? (v ? (k === "var" ? (v.finish > 0 ? "+" : "") + v.finish + " d" : fmt(k === "bstart" ? v.bstart : v.bfinish)) : "") : cell(r, t, k);
    return { name: r.name, level: r.level, summary: r.summary, milestone: r.milestone, ms_end: !!r.ms_end, critical: r.critical, start: r.start, finish: r.finish, pct: r.pct,
      bstart: v ? v.bstart : "", bfinish: v ? v.bfinish : "", cells, label: f.labels.checked ? labelText(r, t) : "", fill: r.summary ? "" : fillOf(t) };
  });
  const links = [];
  for (const t of tasks()) {
    const ti = at.get(t.id);
    if (ti === undefined) continue;
    for (const d of t.deps) {
      const fi = at.get(d.from);
      if (fi === undefined) continue;
      links.push({ from: fi, to: ti, type: d.type || "FS", color: d.color || "", style: d.style || "", drive: d.drive !== false,
        critical: d.drive !== false && P.rows[fi].critical && P.rows[ti].critical && !P.rows[fi].summary && !P.rows[ti].summary });
    }
  }
  const spec = {
    name: fileName("pdf"), paper: f.paper.value, orient: f.orient.value, range: { from: f.from.value, to: f.to.value },
    start: P.sched.start, finish: P.sched.finish,
    cover: Object.assign({ title: "Indicative Project Programme", project: P.projectName || project() || "" }, c, { status_date: f.status.checked ? c.status_date || "" : "" }),
    columns: P.d.columns.map((k) => ({ key: k, label: COLS[k].short || COLS[k].label, w: Math.round(COLS[k].mm * colW(k) / COLS[k].w), align: COLS[k].align || "left" })),
    rows, links, remarks: P.d.remarks,
    pages_wide: f.wide.value === "auto" ? "auto" : +f.wide.value, repeat_names: f.rep.checked, solid_red: f.solid.checked,
    categories: P.d.categories.filter((c) => P.rows.some((r) => !r.summary && tasks()[r.i].cat === c.id)).map((c) => ({ name: c.name, color: c.color })),
    show: { links: f.links.checked, baseline: !!b, progress: f.prog.checked, status: f.status.checked, critical: f.crit.checked },
  };
  toast("Making the PDF ...");
  try {
    const res = await fetch(P.mine ? `/api/myprog/${P.mine}/pdf` : "/api/programme/pdf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hdrs()), body: JSON.stringify(spec) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
    const kept = res.headers.get("X-Kept");
    download(await res.blob(), spec.name);
    toast(kept ? "PDF made - a copy is in Folders > 00 BIM > Exports > Programme" : "PDF made");
  } catch (e) { toast("No PDF: " + e.message, true); }
}
function hdrs() {
  const h = {};
  try { h["X-Viewer-Token"] = localStorage.getItem("lwk-viewer:token") || ""; } catch (e) {}
  if (project()) h["X-Project"] = project();
  return h;
}

async function importCsv(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;   // an .mpp (OLE file)
  if (ole || /\.(xml|mpp)$/i.test(file.name) || /^\s*(<\?xml|<Project)/.test(await file.slice(0, 200).text())) return importXml(file);
  const text = await file.text();
  const r = PC.fromCsv(text, P.cal.perWeek, uid);
  if (r.error) return toast(r.error, true);
  if (!r.tasks.length) return toast("No tasks in the file", true);
  let how = "replace";
  if (tasks().length) {
    const f = await modal("Import " + r.tasks.length + " tasks", `<label class="row-check"><input type="radio" name="how" value="replace" checked> Replace the programme</label>
      <label class="row-check"><input type="radio" name="how" value="add"> Add them at the end</label>
      ${r.warnings && r.warnings.length ? `<p class="muted">Not read: ${esc(r.warnings.slice(0, 5).join("; "))}</p>` : ""}`, "Import");
    if (!f) return;
    how = [...f.querySelectorAll('input[name="how"]')].find((x) => x.checked).value;
  }
  before();
  for (const t of r.tasks) t.links = {};
  P.d.tasks = how === "add" ? tasks().concat(r.tasks) : r.tasks;
  changed();
  toast(`${r.tasks.length} tasks imported${r.warnings && r.warnings.length ? " - " + r.warnings.length + " predecessors not read" : ""}`);
}

/* ------------------------------------------------- the category legend */

function paintLegend() {
  const el = $("#pg-legend");
  if (!el) return;
  const used = new Set(tasks().map((t) => t.cat).filter(Boolean));
  const cats = P.d.categories.filter((c) => used.has(c.id) || (P.view.cats || []).includes(c.id));
  const on = new Set(P.view.cats || []);
  el.hidden = !tasks().length;
  el.innerHTML = `<span class="muted">Categories</span>` + cats.map((c) => `<button type="button" class="pg-chip${on.has(c.id) ? " on" : ""}" data-cat="${esc(c.id)}" title="Show only this category (click again to show all)"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button>`).join("")
    + (on.size ? `<button type="button" class="ghost pg-chip-x" data-cat="">Show all</button>` : "")
    + (P.can ? `<button type="button" class="ghost pg-chip-e" title="Names and colours of the categories">Edit ...</button>` : "")
    + (cats.length ? "" : `<span class="muted"> - none yet: right-click rows > Category</span>`);
}

async function categoriesDlg() {
  const rowsHtml = (list) => list.map((c, k) => `<div class="eg-row pg-catr" data-k="${k}"><input type="color" value="${esc(c.color)}" class="cc-c"><input class="cc-n" value="${esc(c.name)}" maxlength="40"><button type="button" class="ghost cc-x" title="Remove">&times;</button></div>`).join("");
  const list = P.d.categories.map((c) => Object.assign({}, c));
  const p = modal("Categories", `<p class="muted">Each task can have a category: its bars take the colour, and the legend can show one category at a time. A task's own colour wins over its category's.</p>
    <div class="eg pg-cats">${rowsHtml(list)}</div><button type="button" class="ghost cc-add">+ Category</button>`, canSet() ? "Save" : "Close");
  const m = lastModal();
  const box = m.querySelector(".pg-cats");
  m.querySelector(".cc-add").onclick = () => box.insertAdjacentHTML("beforeend", `<div class="eg-row pg-catr" data-k="new"><input type="color" value="${PALETTE[box.children.length % PALETTE.length]}" class="cc-c"><input class="cc-n" value="" placeholder="Name" maxlength="40"><button type="button" class="ghost cc-x">&times;</button></div>`);
  box.addEventListener("click", (e) => { const x = e.target.closest(".cc-x"); if (x) x.closest(".pg-catr").remove(); });
  const f = await p;
  if (!f || !canSet()) return;
  before();
  P.d.categories = [...box.querySelectorAll(".pg-catr")].map((r) => {
    const old = list[+r.dataset.k];
    return { id: old ? old.id : "c" + uid().slice(0, 6), name: r.querySelector(".cc-n").value.trim() || "Category", color: r.querySelector(".cc-c").value };
  });
  const ids = new Set(P.d.categories.map((c) => c.id));
  for (const t of tasks()) if (t.cat && !ids.has(t.cat)) delete t.cat;
  changed();
}

async function formatDlg() {
  const F = P.d.format;
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${String(F[name]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const chk = (name, l) => `<label class="row-check"><input type="checkbox" name="${name}"${F[name] ? " checked" : ""}> ${esc(l)}</label>`;
  const f = await modal("Format", `
    <div class="pg-2"><label>Dates${sel("date", [["d-mon-yy", "1 Mar 27"], ["dd/mm/yyyy", "01/03/2027"], ["wd d/m/yy", "Mon 1/3/27"]])}</label>
      <label>Durations in${sel("unit", [["d", "days (10 d)"], ["w", "weeks (2 w)"]])}</label></div>
    <div class="pg-2"><label>Rows${sel("rowh", [["compact", "Compact"], ["normal", "Normal"], ["roomy", "Roomy"]])}</label>
      <label>Text size${sel("text", [["11.5", "Small"], ["12.5", "Normal"], ["14", "Large"]])}</label></div>
    <div class="pg-2"><label>Beside the bars${sel("label", LABELS)}</label>
      <label>Summary bars${sel("summary", [["bracket", "Bracket (MS Project)"], ["bar", "Solid bar"]])}</label></div>
    <label>Gridlines${sel("grid", [["unit", "At every scale step (week / month)"], ["month", "Monthly (years on month or quarter scales)"]])}</label>
    ${chk("zebra", "Banded rows (zebra)")}${chk("shade", "Shade weekends and holidays")}${chk("today", "Today line")}
    <label>Beside the milestones<select name="mslabel">${MSLABELS.map(([v, l]) => `<option value="${v}"${(F.mslabel || (F.msdate ? "namedate" : "name")) === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    ${chk("boldsum", "Summary rows in bold")}${chk("weekno", "Week numbers on the week scale (W12)")}
    ${chk("solidred", "Critical bars solid red (otherwise their own colour, outlined red)")}
    <p class="muted">The format is the programme's: everyone sees it, and the PDF follows it.</p>`, canSet() ? "Save" : "Apply here");
  if (!f) return;
  const nf = {};
  for (const k of ["date", "unit", "rowh", "label", "summary", "grid", "mslabel"]) nf[k] = f[k].value;
  nf.msdate = nf.mslabel === "namedate" || nf.mslabel === "date";
  nf.text = +f.text.value;
  for (const k of ["zebra", "shade", "today", "boldsum", "weekno", "solidred"]) nf[k] = f[k].checked;
  if (canSet()) { before(); P.d.format = Object.assign({}, FORMAT, nf); changed(); } else { P.d.format = Object.assign({}, FORMAT, nf); recalc(); render(); }
}

/* ----------------------------------------------- right-click, clipboard */

function ctxMenu(ev, id) {
  ev.preventDefault();
  if (id && !P.sel.has(id)) select(id);
  const n = P.sel.size;
  const one = n === 1 ? rowOf([...P.sel][0]) : null;
  const sums = [...P.sel].map(rowOf).filter((r) => r && r.summary);
  const item = (k, label, key = "", dis = false) => `<div class="po-row pg-cm${dis ? " off" : ""}" data-cm="${k}"><span>${label}</span><small class="muted">${key}</small></div>`;
  const sep = `<div class="pg-cm-sep"></div>`;
  const ed = P.can;
  let h = "";
  if (n) h += item("props", n > 1 ? `Properties of ${n} rows ...` : "Properties ...", "Enter");
  if (ed) {
    h += sep + item("above", "Insert task above") + item("below", "Insert task below", "Ctrl+Enter") + item("ms", "Insert milestone below");
    if (n) h += sep + item("cut", "Cut", "Ctrl+X") + item("copy", "Copy", "Ctrl+C") + item("dup", "Duplicate", "Ctrl+D");
    h += item("paste", P.clip ? `Paste ${P.clip.tasks.length} row${P.clip.tasks.length === 1 ? "" : "s"} below` : "Paste", "Ctrl+V", !P.clip);
    if (n) {
      h += sep + item("in", "Indent", "Alt+Shift+→") + item("out", "Outdent", "Alt+Shift+←") + item("up", "Move up", "Alt+↑") + item("down", "Move down", "Alt+↓");
      h += sep + (n > 1 ? item("link", "Link in order (finish to start)") : "") + item("unlink", n > 1 ? "Unlink them" : "Remove its predecessors");
      h += sep + item("cat", "Category ▸") + item("color", "Colour ▸") + item("label", "Label beside the bar ▸");
    }
  } else if (n) h += item("copy", "Copy", "Ctrl+C");
  if (sums.length) h += sep + item("fold", "Fold") + item("unfold", "Unfold");
  if (n) {
    if (!P.mine) h += sep + item("task", n > 1 ? `Create ${n} tasks in Tasks ...` : "Create a task in Tasks ...", "", !ed) + item("chat", "Discuss in chat ...", "", n !== 1 || !ed);
    if (ed) h += sep + item("del", `Delete${n > 1 ? " " + n + " rows" : ""}`, "Del");
  }
  const el = pop(document.body, `<div class="pg-cmenu">${h}</div>`, 250);
  el.style.left = Math.min(innerWidth - 260, ev.clientX) + "px";
  el.style.top = Math.max(6, Math.min(innerHeight - el.offsetHeight - 6, ev.clientY)) + "px";
  el.style.bottom = "";
  el.addEventListener("click", (e) => {
    const r = e.target.closest("[data-cm]");
    if (!r || r.classList.contains("off")) return;
    const k = r.dataset.cm;
    if (k === "cat") return catMenu(r);
    if (k === "color") return colorMenu(r);
    if (k === "label") return labelMenu(r);
    closePop();
    ({
      props: openProps, above: () => insertAt("above"), below: () => add("task"), ms: () => add("milestone"),
      cut: () => copyRows(true), copy: () => copyRows(false), dup: duplicate, paste: pasteRows,
      in: () => indent(1), out: () => indent(-1), up: () => moveBy(-1), down: () => moveBy(1),
      link: linkSelected, unlink: unlinkSelected, fold: () => fold(true), unfold: () => fold(false),
      task: createTasks, chat: () => discuss(taskOf([...P.sel][0])), del,
    })[k]();
    void one;
  });
}
function catMenu(anchor) {
  const el = pop(anchor, `<div class="pg-cmenu">${P.d.categories.map((c) => `<div class="po-row" data-c="${esc(c.id)}"><i class="pg-dot" style="background:${esc(c.color)}"></i> ${esc(c.name)}</div>`).join("")}<div class="po-row" data-c=""><i class="pg-dot"></i> None</div><div class="po-row" data-c="__edit">Edit the categories ...</div></div>`, 220);
  el.addEventListener("click", (e) => {
    const r = e.target.closest("[data-c]");
    if (!r) return;
    closePop();
    if (r.dataset.c === "__edit") return categoriesDlg();
    before();
    for (const id of P.sel) { const t = taskOf(id); if (r.dataset.c) t.cat = r.dataset.c; else delete t.cat; }
    changed();
  });
}
function labelMenu(anchor) {
  const el = pop(anchor, `<div class="pg-cmenu"><div class="po-row" data-lb="">As in Format</div>${LABELS.map(([v, n]) => `<div class="po-row" data-lb="${v}">${n}</div>`).join("")}</div>`, 200);
  el.addEventListener("click", (e) => {
    const r = e.target.closest("[data-lb]");
    if (!r) return;
    closePop(); before();
    for (const id of P.sel) { const t = taskOf(id); if (r.dataset.lb) t.label = r.dataset.lb; else delete t.label; }
    changed();
  });
}
function colorMenu(anchor) {
  const el = pop(anchor, `<div class="pg-pal">${PALETTE.map((c) => `<button type="button" data-col="${c}" style="background:${c}" title="${c}"></button>`).join("")}</div>
    <div class="row"><input type="color" class="pg-own" value="#4a78a8" title="Any colour"><button type="button" class="ghost" data-col="">Category's colour</button></div>`, 220);
  const set = (c) => { closePop(); before(); for (const id of P.sel) { const t = taskOf(id); if (c) t.color = c; else delete t.color; } changed(); };
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-col]"); if (b) set(b.dataset.col); });
  el.querySelector(".pg-own").addEventListener("change", (e) => set(e.target.value));
}
function fold(shut) {
  const s = new Set(P.view.collapsed || []);
  for (const id of P.sel) { const r = rowOf(id); if (r && r.summary) (shut ? s.add(id) : s.delete(id)); }
  P.view.collapsed = [...s]; saveView(); recalc(); render();
}
function unlinkSelected() {
  const ids = new Set(P.sel);
  before();
  if (ids.size === 1) { const t = taskOf([...ids][0]); t.deps = []; }
  else for (const id of ids) { const t = taskOf(id); t.deps = t.deps.filter((d) => !ids.has(d.from)); }
  changed();
}
function insertAt(where) {
  if (!P.can) return;
  const list = tasks();
  const i = P.cur ? list.findIndex((t) => t.id === P.cur) : -1;
  before();
  const t = { id: uid(), name: "New task", level: i >= 0 ? list[i].level || 0 : 0, kind: "task", start: "", dur: 5, pct: 0, party: "", notes: "", deps: [], links: {} };
  if (i >= 0 && list[i].cat) t.cat = list[i].cat;
  list.splice(Math.max(0, i), 0, t);
  P.sel = new Set([t.id]); P.cur = t.id;
  changed();
  setTimeout(() => editCell(t.id, "name"), 20);
}
/* the selected rows with their rows under them, and the links among them */
function copyRows(cut) {
  const list = tasks();
  const pick = [];
  for (const i of roots()) { const [a, b] = subtree(i); for (let k = a; k < b; k++) pick.push(list[k]); }
  if (!pick.length) return;
  const ids = new Set(pick.map((t) => t.id));
  const lv0 = Math.min(...pick.map((t) => t.level || 0));
  P.clip = { tasks: pick.map((t) => Object.assign(JSON.parse(JSON.stringify(t)), { level: (t.level || 0) - lv0, deps: t.deps.filter((d) => ids.has(d.from)).map((d) => Object.assign({}, d)), links: {} })) };
  // for Excel: the rows as tab-separated text
  const tsv = ["Name\tDuration\tStart\tFinish\tResponsible"].concat(pick.map((t) => { const r = rowOf(t.id); return ["  ".repeat((t.level || 0) - lv0) + t.name, r.milestone ? 0 : r.dur, r.start, r.finish, t.party || ""].join("\t"); })).join("\n");
  try { navigator.clipboard && navigator.clipboard.writeText(tsv).catch(() => {}); } catch (e) {}
  if (cut) {
    if (!P.can) return;
    before();
    P.d.tasks = list.filter((t) => !ids.has(t.id));
    for (const t of P.d.tasks) t.deps = t.deps.filter((d) => !ids.has(d.from));
    P.sel.clear(); P.cur = "";
    changed();
    toast(`${pick.length} row${pick.length === 1 ? "" : "s"} cut - Paste puts them below the selected row`);
  } else toast(`${pick.length} row${pick.length === 1 ? "" : "s"} copied`);
}
function pasteRows() {
  if (!P.can || !P.clip) return;
  const list = tasks();
  const map = new Map(P.clip.tasks.map((t) => [t.id, uid()]));
  let at = list.length, lv = 0;
  const i = P.cur ? list.findIndex((t) => t.id === P.cur) : -1;
  if (i >= 0) { at = subtree(i)[1]; lv = list[i].level || 0; }
  before();
  const block = P.clip.tasks.map((t) => Object.assign(JSON.parse(JSON.stringify(t)), { id: map.get(t.id), level: (t.level || 0) + lv, deps: t.deps.map((d) => Object.assign({}, d, { from: map.get(d.from) })) }));
  list.splice(at, 0, ...block);
  P.sel = new Set(block.map((t) => t.id)); P.cur = block[0].id;
  changed();
  toast(`${block.length} row${block.length === 1 ? "" : "s"} pasted`);
}
function duplicate() { const keep = P.clip; copyRows(false); const ids = [...P.sel]; const last = P.rows.filter((r) => ids.includes(r.id)).pop(); if (last) P.cur = last.id; pasteRows(); P.clip = keep || P.clip; }
function moveBy(step) {
  if (!P.can || !P.sel.size) return;
  const list = tasks();
  const rs = roots();
  if (!rs.length) return;
  const ids = rs.map((i) => list[i].id);
  let to;
  if (step < 0) {
    const first = rs[0];
    if (first === 0) return;
    // before the row above (with its own summary start if it is deeper)
    let k = first - 1;
    const lv = list[first].level || 0;
    while (k > 0 && (list[k].level || 0) > lv) k--;
    to = k;
  } else {
    const last = rs[rs.length - 1];
    const end = subtree(last)[1];
    if (end >= list.length) return;
    to = subtree(end)[1];
  }
  before();
  move(ids, to);
  changed();
}
async function createTasks() {
  const ids = P.rows.filter((r) => P.sel.has(r.id) && !r.summary).map((r) => r.id);
  if (ids.length === 1) return createTask(taskOf(ids[0])).then(paintProps);
  if (!ids.length) return toast("Select tasks (not summaries)", true);
  const lists = await taskLists();
  if (!lists) return;
  const f = await modal(`Create ${ids.length} tasks in Tasks`, `<label>Task list<select name="list">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>
    <p class="muted">One task for each activity, with its start and due dates and a link back. Activities linked already are left as they are.</p>`, "Create");
  if (!f) return;
  const out = [];
  before();
  for (const id of ids) {
    const t = taskOf(id), r = rowOf(id);
    if (t.links.task) continue;
    const tid = uid();
    out.push({ id: tid, title: t.name, start: r.start, due: r.finish, description: `From the programme: ${r.wbs} ${t.name}${t.party ? " (" + t.party + ")" : ""}`, links: [backLink(t)] });
    t.links.task = { list: f.list.value, id: tid, title: t.name };
  }
  if (!out.length) { P.undo.pop(); return toast("They are all linked to tasks already"); }
  try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: f.list.value, tasks: out }) }); }
  catch (e) { restore(P.undo.pop()); return toast("Could not make the tasks: " + e.message, true); }
  changed();
  toast(`${out.length} tasks made`);
}

/* ------------------------------------------------- MS Project XML */

async function importXml(file) {
  if (/\.mpp$/i.test(file.name)) toast("Reading the MS Project file…");
  const res = await fetch("/api/programme/mspdi/import", { method: "POST", headers: hdrs(), body: await file.arrayBuffer() });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) return toast(r.detail || "Not read", true);
  if (!r.tasks || !r.tasks.length) return toast("No tasks in the file", true);
  let how = "replace", cal = false;
  const f = await modal(`Import ${r.tasks.length} tasks from MS Project`, `${tasks().length ? `<label class="row-check"><input type="radio" name="how" value="replace" checked> Replace the programme</label>
      <label class="row-check"><input type="radio" name="how" value="add"> Add them at the end</label>` : ""}
    <label class="row-check"><input type="checkbox" name="cal"${r.calendar && r.calendar.week !== P.d.calendar.week ? " checked" : ""}> Use the file's working week (${esc(PC.WEEKS[(r.calendar || {}).week] || "")}) and its ${((r.calendar || {}).holidays || []).length + ((r.calendar || {}).off || []).length} days off</label>
    ${r.warnings && r.warnings.length ? `<p class="muted">${esc(r.warnings.slice(0, 5).join("; "))}</p>` : ""}`, "Import");
  if (!f) return;
  if (tasks().length) how = [...f.querySelectorAll('input[name="how"]')].find((x) => x.checked).value;
  cal = f.cal.checked;
  before();
  P.d.tasks = how === "add" ? tasks().concat(r.tasks) : r.tasks;
  if (cal && r.calendar) P.d.calendar = Object.assign({}, P.d.calendar, { week: r.calendar.week, holidays: (P.d.calendar.holidays || []).concat(r.calendar.holidays || []), off: (P.d.calendar.off || []).concat(r.calendar.off || []) });
  if (how === "replace" && r.name && !P.d.cover.title) P.d.cover.title = r.name;
  changed();
  toast(`${r.tasks.length} tasks imported from MS Project`);
}
async function exportXml() {
  if (!tasks().length) return toast("No tasks yet", true);
  const at = new Map(P.sched.rows.map((r, k) => [r.id, k]));
  const rows = P.sched.rows.map((r) => {
    const t = tasks()[r.i];
    return { name: r.name, level: r.level, milestone: r.milestone, ms_end: !!r.ms_end, summary: r.summary, start: r.start, finish: r.finish, dur: r.dur,
      pct: r.pct, notes: t.notes || "", party: t.party || "", own_start: t.start || "", fnet: t.fnet || "",
      deps: t.deps.filter((d) => at.has(d.from)).map((d) => ({ from: at.get(d.from), type: d.type || "FS", lag: d.lag || 0, drive: d.drive !== false })) };
  });
  const c = calSpec();
  const body = { name: fileName("xml"), title: P.d.cover.title || P.projectName || "Programme", start: P.sched.start, calendar: { week: c.week, holidays: c.holidays, off: c.off }, rows };
  try {
    const res = await fetch("/api/programme/mspdi/export", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hdrs()), body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
    download(await res.blob(), body.name);
    const rel = tasks().reduce((a, t) => a + t.deps.filter((d) => d.drive === false).length, 0);
    toast("MS Project XML made - open it in MS Project (File > Open), then File > Save As .mpp" + (rel ? `; ${rel} related-only link(s) left out` : ""));
  } catch (e) { toast("Not made: " + e.message, true); }
}

/* ----------------------------------- panning, zooming, widths by dragging */

function wirePanZoom() {
  const body = $("#pg-body");
  // the middle button pans, in both directions
  body.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    const x0 = ev.clientX, y0 = ev.clientY, l0 = body.scrollLeft, t0 = body.scrollTop;
    body.classList.add("panning");
    const mv = (e) => { body.scrollLeft = l0 - (e.clientX - x0); body.scrollTop = t0 - (e.clientY - y0); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); body.classList.remove("panning"); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  body.addEventListener("mousedown", (ev) => { if (ev.button === 1) ev.preventDefault(); });      // no auto-scroll
  body.addEventListener("auxclick", (ev) => { if (ev.button === 1) ev.preventDefault(); });
  // Ctrl or Shift + wheel: the time, a step at a time, about the pointer
  body.addEventListener("wheel", (ev) => {
    if (!(ev.ctrlKey || ev.shiftKey) || !ev.target.closest("#pg-cb, #pg-ch")) return;
    ev.preventDefault();
    const d = ev.deltaY || ev.deltaX;            // Shift turns the wheel sideways on Windows
    if (!d) return;
    const px = ev.deltaMode === 1 ? d * 33 : ev.deltaMode === 2 ? d * 400 : d;
    const k = Math.abs(px) >= 50 ? (px < 0 ? 1.15 : 1 / 1.15) : Math.exp(-px / 300);   // a mouse notch, or a trackpad pinch
    zoomAbout(ev.clientX, k);
  }, { passive: false });
  // the scale: drag along it to stretch or squeeze the time
  $("#pg-ch").addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const x0 = ev.clientX, p0 = P.ppd;
    const box = $("#pg-cb").getBoundingClientRect();
    const anchor = P.d0 + (ev.clientX - box.left) / P.ppd;
    const mv = (e) => {
      const ppd = Math.max(0.3, Math.min(60, p0 * Math.pow(1.006, e.clientX - x0)));
      setPpd(ppd, anchor, ev.clientX);
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); saveView(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  // the column widths: drag a header's right edge
  $("#pg-gh").addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest("[data-cr]");
    if (!h) return;
    ev.preventDefault(); ev.stopPropagation();
    const k = h.dataset.cr;
    const x0 = ev.clientX, w0 = h.parentElement.getBoundingClientRect().width;
    const g0 = gridWidth();
    const mv = (e) => {
      P.view.widths = Object.assign({}, P.view.widths, { [k]: Math.max(30, Math.round(w0 + e.clientX - x0)) });
      P.view.gw = Math.max(220, g0 + (P.view.widths[k] - w0));
      const sheet = $("#pg-sheet");
      sheet.style.setProperty("--cols", gridTemplate());
      sheet.style.setProperty("--gw", gridWidth() + "px");
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); saveView(); recalc(); render(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
}
function zoomAbout(clientX, k) {
  const box = $("#pg-cb").getBoundingClientRect();
  const anchor = P.d0 + (clientX - box.left) / P.ppd;
  setPpd(Math.max(0.3, Math.min(60, P.ppd * k)), anchor, clientX);
  saveView();
}
/* the − / + buttons and keys: about the middle of the chart in view */
function zoomStep(k) {
  const body = $("#pg-body").getBoundingClientRect();
  zoomAbout(body.left + gridWidth() + (body.width - gridWidth()) / 2, k);
}
function setPpd(ppd, anchorDay, clientX) {
  const body = $("#pg-body");
  const box0 = body.getBoundingClientRect();
  P.view.zoom = "free";               // a zoom of its own (only Fit keeps re-fitting)
  P.view.ppd = ppd;
  recalc();
  paintGrid(); paintChart();
  // keep the day under the pointer where it was
  const x = (anchorDay - P.d0) * P.ppd;
  body.scrollLeft = Math.max(0, x - (clientX - box0.left - gridWidth()));
  paintBar();
}

/* ------------------------------------------------------------------ start */

function fitPpd() {
  const body = $("#pg-body");
  if (!body || !body.clientWidth || !P.sched) return 0;
  const w = body.clientWidth - gridWidth() - 30;
  const lo = PC.dayOf(P.sched.start), hi = PC.dayOf(P.sched.finish);
  if (lo === null) return 0;
  return Math.max(0.3, Math.min(40, w / Math.max(14, (hi - lo) * 1.1 + 21)));
}
function fit() {
  const p = fitPpd();
  if (!p) return;
  P.view.zoom = "fit";
  P.view.ppd = p;
  saveView(); recalc(); render();
  $("#pg-body").scrollLeft = 0;
}
function scrollToDay(iso) {
  const x = X(iso);
  $("#pg-body").scrollLeft = Math.max(0, x - 40);      // the chart starts after the (sticky) table
}

async function start() {
  P.me = await ensureSignedIn();
  header(P.me);
  P.phone = phone();
  P.mine = mineParam();
  P.pg = P.mine ? "" : pgParam();
  // no project open and no programme of one's own chosen: one's own programmes
  if (!P.mine && (!project() || new URLSearchParams(location.search).get("mine") === "list")) {
    let mine = [];
    try { mine = (await api("/api/myprog/list")).items || []; } catch (e) {}
    if (mine.length) { location.replace(mineUrl(mine[0].id)); return; }
    P.pgName = ""; P.doc = { can_edit: true };
    if (!(await newMine(true))) location.href = "projects.html";
    return;
  }
  loadView();
  if (P.phone && !localStorage.getItem(keyView())) P.view.zoom = "month";
  try {
    const ps = await api("/api/projects");
    const p = (ps.projects || ps || []).find && (ps.projects || ps).find((x) => x.id === project());
    P.projectName = p ? p.name || p.title || "" : "";
  } catch (e) {}
  try { await loadDoc(); } catch (e) {
    if (e.status !== 404 || !P.pg) throw e;
    toast(e.message, true); history.replaceState(null, "", pgUrl("")); P.pg = ""; await loadDoc(); loadView();
  }
  await loadList();
  recalc();
  render();
  if (await loadLinked() && P.can) changed(); else render();
  const want = new URLSearchParams(location.search).get("task");
  if (want && rowOf(want)) {
    select(want, null, true);
    scrollToDay(rowOf(want).start);
    const el = $(`#pg-gb .pg-r[data-id="${CSS.escape(want)}"]`);
    if (el) el.classList.add("flash");
  } else if (tasks().length) scrollToDay(PC.todayIso() > P.sched.start && PC.todayIso() < P.sched.finish ? PC.todayIso() : P.sched.start);

  // toolbar
  $("#pg-which").onclick = (ev) => whichMenu(ev.currentTarget);
  $("#pg-add").onclick = () => add("task");
  $("#pg-ms").onclick = () => add("milestone");
  $("#pg-in").onclick = () => indent(1);
  $("#pg-out").onclick = () => indent(-1);
  $("#pg-del").onclick = del;
  $("#pg-link").onclick = linkSelected;
  $("#pg-undo").onclick = undo;
  $("#pg-redo").onclick = redo;
  $("#pg-zoom").onclick = (ev) => { const b = ev.target.closest("[data-z]"); if (!b) return; const mid = midDay(); P.view.zoom = b.dataset.z; saveView(); recalc(); render(); scrollToDay(PC.isoOf(mid)); };
  $("#pg-fit").onclick = fit;
  $("#pg-zin").onclick = () => zoomStep(1.25);
  $("#pg-zout").onclick = () => zoomStep(1 / 1.25);
  $("#pg-today").onclick = () => scrollToDay(PC.todayIso());
  $("#pg-crit").onclick = () => { P.view.critical = !P.view.critical; saveView(); render(); };
  $("#pg-base").onclick = (ev) => baseMenu(ev.currentTarget);
  $("#pg-view").onclick = (ev) => viewMenu(ev.currentTarget);
  $("#pg-setup").onclick = (ev) => setupMenu(ev.currentTarget);
  $("#pg-export").onclick = (ev) => exportMenu(ev.currentTarget);
  $("#pg-import").onclick = () => { if (!P.can) return toast("Only a project member can change the programme", true); $("#pg-file").click(); };
  $("#pg-file").onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ""; if (f) importCsv(f); };
  if (!P.can) for (const el of document.querySelectorAll(".pg-edit")) el.hidden = true;
  $("#pg-setup").hidden = !P.doc.can_edit;           // Set up's dialogs work on a phone too

  // the table
  const gb = $("#pg-gb");
  gb.addEventListener("click", (ev) => {
    const e = ev.target.closest("[data-empty]");
    if (e) { if (e.dataset.empty === "task") add("task"); else if (e.dataset.empty === "tpl") template(); else $("#pg-file").click(); return; }
    if (ev.target.closest(".pg-addrow")) { P.cur = tasks().length ? tasks()[tasks().length - 1].id : ""; add("task"); return; }
    const tw = ev.target.closest("[data-tw]");
    if (tw) {
      const s = new Set(P.view.collapsed || []);
      s.has(tw.dataset.tw) ? s.delete(tw.dataset.tw) : s.add(tw.dataset.tw);
      P.view.collapsed = [...s]; saveView(); recalc(); render();
      return;
    }
    const row = ev.target.closest(".pg-r[data-id]");
    if (!row || ev.target.closest(".pg-in")) return;
    const c = ev.target.closest(".pg-c");
    if (P.sel.has(row.dataset.id) && P.sel.size === 1 && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && c && c.classList.contains("ed") && P.cur === row.dataset.id && P.lastCell === c.dataset.k) {
      editCell(row.dataset.id, c.dataset.k);
      return;
    }
    P.lastCell = c ? c.dataset.k : "";
    select(row.dataset.id, ev);
  });
  gb.addEventListener("dblclick", (ev) => {
    const row = ev.target.closest(".pg-r[data-id]");
    if (!row) return;
    const c = ev.target.closest(".pg-c");
    if (ev.target.closest(".pg-in") || (c && c.classList.contains("editing"))) return;
    if (c && c.dataset.k === "id") return activity(row.dataset.id);
    if (c && c.classList.contains("ed")) editCell(row.dataset.id, c.dataset.k); else activity(row.dataset.id);
  });
  // rows: drag the grip to move them
  gb.addEventListener("pointerdown", (ev) => {
    const g = ev.target.closest(".pg-drag");
    if (!g || !P.can) return;
    ev.preventDefault();
    const row = g.closest(".pg-r");
    if (!P.sel.has(row.dataset.id)) select(row.dataset.id);
    const ids = [...P.sel];
    const mark = document.createElement("div");
    mark.className = "pg-dropline";
    gb.appendChild(mark);
    let to = -1;
    const mv = (e) => {
      const y = e.clientY - gb.getBoundingClientRect().top;
      const k = Math.max(0, Math.min(P.rows.length, Math.round(y / RH)));
      mark.style.top = (k * RH - 1) + "px";
      to = k < P.rows.length ? tasks().findIndex((t) => t.id === P.rows[k].id) : tasks().length;
    };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      mark.remove();
      if (to < 0) return;
      before(); move(ids, to); changed();
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  // the splitter
  $("#pg-gh").addEventListener("pointerdown", (ev) => {
    if (!ev.target.closest("[data-split]")) return;
    ev.preventDefault();
    const x0 = ev.clientX, w0 = gridWidth();
    const mv = (e) => { P.view.gw = Math.max(220, w0 + e.clientX - x0); $("#pg-sheet").style.setProperty("--gw", gridWidth() + "px"); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); saveView(); recalc(); render(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  // the chart
  const cb = $("#pg-cb");
  cb.addEventListener("pointerdown", chartDown);
  cb.addEventListener("pointermove", hover);
  cb.addEventListener("pointerleave", hideTip);
  cb.addEventListener("dblclick", (ev) => {
    // what is under the pointer now: the first click may have redrawn the chart
    const hit = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
    const g = hit.closest && hit.closest("[data-bar]");
    if (g) return activity(g.dataset.bar);
    if (!P.can || (hit.closest && hit.closest(".lnk"))) return;
    // empty space: a new task there, from that day
    const box = $("#pg-svg").getBoundingClientRect();
    const k = Math.floor((ev.clientY - box.top) / RH);
    const day = PC.isoOf(dayAtX(ev.clientX - box.left));
    before();
    const list = tasks();
    const above = P.rows[Math.min(k, P.rows.length - 1)];        // below the row double-clicked
    let at = list.length, lv = 0;
    if (above) { const i = list.findIndex((t) => t.id === above.id); at = subtree(i)[1]; lv = above.summary && !(P.view.collapsed || []).includes(above.id) ? above.level + 1 : above.level; }
    const t = { id: uid(), name: "New task", level: lv, kind: "task", start: PC.isoOf(P.cal.dayAt(P.cal.ord(PC.dayOf(day)))), dur: 5, pct: 0, party: "", notes: "", deps: [], links: {} };
    if (above && taskOf(above.id).cat) t.cat = taskOf(above.id).cat;
    list.splice(at, 0, t);
    P.sel = new Set([t.id]); P.cur = t.id;
    changed();
    setTimeout(() => editCell(t.id, "name"), 20);
  });
  // right-click: the menu
  gb.addEventListener("contextmenu", (ev) => { const row = ev.target.closest(".pg-r[data-id]"); if (row) ctxMenu(ev, row.dataset.id); else if (P.can) ctxMenu(ev, ""); });
  cb.addEventListener("contextmenu", (ev) => {
    const lk = ev.target.closest(".lnk");
    if (lk && !ev.target.closest("[data-bar]")) { ev.preventDefault(); return linkMenu(lk, ev); }
    const g = ev.target.closest("[data-bar]");
    if (g) return ctxMenu(ev, g.dataset.bar);
    const k = Math.floor((ev.clientY - $("#pg-svg").getBoundingClientRect().top) / RH);
    if (P.rows[k]) ctxMenu(ev, P.rows[k].id); else if (P.can) ctxMenu(ev, "");
  });
  // the category legend: show one or several; edit
  $("#pg-legend").addEventListener("click", (ev) => {
    if (ev.target.closest(".pg-chip-e")) return categoriesDlg();
    const b = ev.target.closest("[data-cat]");
    if (!b) return;
    const s = new Set(P.view.cats || []);
    if (!b.dataset.cat) s.clear(); else if (ev.ctrlKey || ev.metaKey || ev.shiftKey) (s.has(b.dataset.cat) ? s.delete(b.dataset.cat) : s.add(b.dataset.cat));
    else if (s.size === 1 && s.has(b.dataset.cat)) s.clear(); else { s.clear(); s.add(b.dataset.cat); }
    P.view.cats = [...s]; saveView(); recalc(); render();
  });
  wirePanZoom();

  // keys
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest && ev.target.closest("input, textarea, select, .t-modal")) return;
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "y") { ev.preventDefault(); redo(); }
    else if ((ev.ctrlKey || ev.metaKey) && k === "Enter") { ev.preventDefault(); add("task"); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "c" && P.sel.size) { ev.preventDefault(); copyRows(false); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "x" && P.sel.size) { ev.preventDefault(); copyRows(true); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "v" && P.clip) { ev.preventDefault(); pasteRows(); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "d" && P.sel.size) { ev.preventDefault(); duplicate(); }
    else if (ev.altKey && !ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { ev.preventDefault(); moveBy(k === "ArrowUp" ? -1 : 1); }
    else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && (k === "+" || k === "=" || k === "-")) { ev.preventDefault(); zoomStep(k === "-" ? 1 / 1.25 : 1.25); }
    else if (ev.altKey && !ev.shiftKey && (k === "ArrowLeft" || k === "ArrowRight") && P.sel.size) { ev.preventDefault(); nudge(k === "ArrowLeft" ? -1 : 1); }
    else if (k === "Escape" && propsOpen()) closeProps();
    else if (ev.altKey && ev.shiftKey && k === "ArrowRight") { ev.preventDefault(); indent(1); }
    else if (ev.altKey && ev.shiftKey && k === "ArrowLeft") { ev.preventDefault(); indent(-1); }
    else if (k === "Delete" && P.sel.size) { ev.preventDefault(); del(); }
    else if ((k === "ArrowDown" || k === "ArrowUp") && P.cur) {
      ev.preventDefault();
      const i = P.rows.findIndex((r) => r.id === P.cur) + (k === "ArrowDown" ? 1 : -1);
      if (P.rows[i]) select(P.rows[i].id, ev.shiftKey ? { shiftKey: true } : null, true);
    } else if ((k === "Enter" || k === "F2") && P.cur) { ev.preventDefault(); editCell(P.cur, P.lastCell && COLS[P.lastCell].edit ? P.lastCell : "name"); }
    else if (P.cur && P.can && k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); editCell(P.cur, P.lastCell && COLS[P.lastCell] && COLS[P.lastCell].edit === "text" ? P.lastCell : "name", k); }
  });
  // someone else's change, when the page comes back
  addEventListener("focus", async () => {
    if (P.pending || P.saving || document.querySelector(".t-modal-back")) return;
    try {
      const d = await api(pq("/api/programme"));
      if (d.rev !== P.doc.rev) {
        P.doc = d; P.d = defaults(d.data || {}); P.can = !!d.can_edit && !P.phone;
        recalc(); render();
        toast("Updated by " + (d.by || "someone"));
      }
    } catch (e) {}
  });
  addEventListener("resize", () => { const ph = phone(); if (ph !== P.phone) { P.phone = ph; P.can = !!P.doc.can_edit && !ph; } recalc(); render(); });
  addEventListener("beforeunload", (ev) => { if (P.pending) { save(); ev.preventDefault(); ev.returnValue = ""; } });
}
function midDay() {
  const b = $("#pg-body");
  return dayAtX(b.scrollLeft + (b.clientWidth - gridWidth()) / 2);
}

start().catch((e) => { if (!/Set your own password/.test(e.message)) toast(e.message, true); });
