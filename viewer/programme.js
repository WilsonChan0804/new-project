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

const RH = 30;                 // row height, px
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
  return `${d} ${MON[m - 1]}${year ? " " + String(y).slice(2) : ""}`;
}
function fmtLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}
const days = (n) => (n === null || n === undefined ? "" : `${n} d`);
const keyView = () => "lwk-viewer:programme-view:" + (project() || "");
function loadView() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(keyView()) || "{}") || {}; } catch (e) {}
  P.view = Object.assign({ zoom: "week", critical: true, baseline: "", links: true, progress: false, critOnly: false, labels: true, gw: 0, collapsed: [] }, v);
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
  // the rows shown: not under a collapsed summary; only critical ones if asked
  const shut = new Set(P.view.collapsed || []);
  const out = [];
  let hideBelow = null;
  for (const r of P.sched.rows) {
    if (hideBelow !== null) { if (r.level > hideBelow) continue; hideBelow = null; }
    if (P.view.critOnly && !r.critical) continue;
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
  const ppdWant = P.view.zoom === "fit" ? P.view.ppd || 4 : ZOOM[P.view.zoom] || 14;
  if (ppdWant < 6) lo -= dt.getUTCDate() - 1;            // a month or quarter scale starts on the 1st
  else lo -= (dt.getUTCDay() + 6) % 7;                   // a day or week scale on a Monday
  P.d0 = lo;
  P.ppd = ppdWant;
  P.span = hi - lo + 1;
  P.width = Math.max(Math.round(P.span * P.ppd), 400);
}
const X = (iso, end) => { const d = PC.dayOf(iso); return d === null ? 0 : (d - P.d0 + (end ? 1 : 0)) * P.ppd; };
const dayAtX = (x) => P.d0 + Math.floor(x / P.ppd);
const msX = (r) => X(r.start, !!r.ms_end);

/* ---------------------------------------------------------------- saving */

const snap = () => JSON.stringify({ tasks: P.d.tasks, calendar: P.d.calendar, baselines: P.d.baselines, cover: P.d.cover, columns: P.d.columns, remarks: P.d.remarks });
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

function changed() {
  recalc();
  render();
  if (!P.can) return;
  P.pending = true;
  $("#pg-saved").textContent = "Saving ...";
  clearTimeout(P.t);
  P.t = setTimeout(save, 700);
}
async function save() {
  if (!P.can) return;
  if (P.saving) { clearTimeout(P.t); P.t = setTimeout(save, 400); return; }
  P.saving = true;
  try {
    const out = await api("/api/programme", { method: "PUT", body: JSON.stringify({ rev: P.doc.rev, data: P.d }) });
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
  P.doc = await api("/api/programme");
  P.d = defaults(P.doc.data || {});
  P.can = !!P.doc.can_edit && !P.phone;
}

/* ---------------------------------------------------------------- render */

function render() {
  document.body.classList.toggle("pg-ro", !P.can);
  paintBar();
  paintSum();
  paintGrid();
  paintChart();
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
    `<span><small>Start</small><b>${fmtLong(s.start)}</b></span><span><small>Finish</small><b>${fmtLong(s.finish)}</b></span>`
    + `<span><small>Duration</small><b>${s.days} working days</b></span><span><small>Tasks</small><b>${n}</b></span>`
    + `<span><small>Critical</small><b class="${crit ? "pg-crit-t" : ""}">${crit}</b></span>`
    + `<span><small>Status date</small><b><a href="#" id="pg-status">${status ? fmtLong(status) : "set"}</a></b></span>`
    + (late ? `<span><small>Behind</small><b class="pg-bad">${late}</b></span>` : "")
    + (slip ? `<span><small>Finish variance</small><b>${slip}</b></span>` : "")
    + (s.errors.length ? `<span class="pg-err" title="${esc(s.errors.map((e) => e.message).join("\n"))}">&#9888; ${esc(s.errors[0].message.slice(0, 120))}</span>` : "")
    + `<span class="pg-cal muted">${esc(PC.WEEKS[P.d.calendar.week])}${P.d.calendar.hk && P.d.calendar.week !== "all" ? " · HK holidays" : ""}</span>`;
  const st = $("#pg-status");
  if (st) st.onclick = (ev) => { ev.preventDefault(); statusDate(st); };
}
function firstOf(b, k) {
  let v = null;
  for (const x of Object.values(b.tasks)) if (x && x[k] && (v === null || (k ? x[k] > v : x[k] < v))) v = x[k];
  return v || "";
}

function gridTemplate() {
  return cols().map((k) => (k === "name" ? `minmax(${P.phone ? 150 : 160}px, 1fr)` : COLS[k].w + "px")).join(" ");
}
function gridWidth() {
  const want = cols().reduce((a, k) => a + COLS[k].w, 0) + 22;
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
  const C = cols();
  $("#pg-gh").innerHTML = `<div class="pg-r pg-hr">${C.map((k) => `<div class="pg-c ${COLS[k].align === "right" ? "r" : ""}" data-k="${k}">${esc(COLS[k].label)}</div>`).join("")}</div>`
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
        const ic = r.milestone ? `<span class="pg-msi">&#9670;</span>` : "";
        const lk = (t.links && (t.links.task || t.links.room)) ? `<span class="pg-lk" title="${esc([t.links.task ? "Task: " + t.links.task.title : "", t.links.room ? "Chat: " + t.links.room.title : ""].filter(Boolean).join("\n"))}">&#128279;</span>` : "";
        return `<div class="pg-c pg-name${ed}" data-k="name" style="padding-left:${6 + r.level * 16}px">${P.can ? `<span class="pg-drag" title="Drag to move">&#8942;&#8942;</span>` : ""}${tw}${ic}<span class="pg-tx">${esc(r.name || "(no name)")}</span>${lk}</div>`;
      }
      return `<div class="pg-c${COLS[k].align === "right" ? " r" : ""}${ed}" data-k="${k}">${esc(cell(r, t, k))}</div>`;
    }).join("") + `</div>`;
  }).join("") + (P.can ? `<div class="pg-r pg-new"><div class="pg-c pg-addrow" style="grid-column:1/-1">+ Add a task</div></div>` : "");
}

/* ------------------------------------------------------------------ chart */

function unitFor(ppd) { return ppd >= 20 ? "day" : ppd >= 6 ? "week" : ppd >= 2 ? "month" : "quarter"; }

function paintChart() {
  const W = P.width;
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
  }
  d = P.d0;
  while (d <= d1) {
    const dt = dateOf(d);
    let nxt, lab;
    if (unit === "day") { nxt = d + 1; lab = String(dt.getUTCDate()); }
    else if (unit === "week") { nxt = d + 7; lab = `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`; }
    else if (unit === "month") { nxt = d + (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) - dt.getTime()) / 86400000; lab = MON[dt.getUTCMonth()]; }
    else { const q = Math.floor(dt.getUTCMonth() / 3); nxt = d + (Date.UTC(dt.getUTCFullYear(), q * 3 + 3, 1) - dt.getTime()) / 86400000; lab = "Q" + (q + 1); }
    const xa = (d - P.d0) * P.ppd, xb = (Math.min(nxt, d1 + 1) - P.d0) * P.ppd;
    low += `<line x1="${xa}" y1="23" x2="${xa}" y2="${HEAD}" class="sc-l"/>` + (xb - xa > 16 ? `<text x="${(xa + xb) / 2}" y="${HEAD - 8}" class="sc-s">${lab}</text>` : "");
    grid += `<line x1="${xa}" y1="0" x2="${xa}" y2="100%" class="g-l"/>`;
    d = nxt;
  }
  $("#pg-ch").innerHTML = `<svg width="${W}" height="${HEAD}" class="pg-scale"><line x1="0" y1="23" x2="${W}" y2="23" class="sc-l"/>${top}${low}</svg>`;

  const H = Math.max(P.rows.length, 1) * RH + (P.can ? RH : 0);
  let bg = "";
  if (P.ppd >= 6 && P.cal) {               // days off, shaded
    for (let k = P.d0; k <= d1; k++) if (!P.cal.isWork(k)) bg += `<rect x="${(k - P.d0) * P.ppd}" y="0" width="${P.ppd}" height="${H}" class="g-off"/>`;
  }
  let rows = "", bars = "", base = "";
  const b = baseline();
  const crit = !!P.view.critical;
  const at = new Map();
  P.rows.forEach((r, k) => at.set(r.id, k));
  P.rows.forEach((r, k) => {
    const y = k * RH;
    if (P.sel.has(r.id)) rows += `<rect x="0" y="${y}" width="${W}" height="${RH}" class="g-sel"/>`;
    rows += `<line x1="0" y1="${y + RH}" x2="${W}" y2="${y + RH}" class="g-r"/>`;
    const bt = b && b.tasks[r.id];
    if (bt && bt[0]) {
      if (r.milestone) base += `<path d="${diamond(X(bt[0], !!r.ms_end), y + RH - 6, 4)}" class="b-base"/>`;
      else base += `<rect x="${X(bt[0])}" y="${y + RH - 8}" width="${Math.max(2, X(bt[1], true) - X(bt[0]))}" height="4" rx="1" class="b-base"/>`;
    }
    const x0 = r.milestone ? msX(r) : X(r.start), x1 = X(r.finish, true);
    const cy = y + (b ? RH / 2 - 2 : RH / 2);
    const isC = crit && r.critical;
    const label = P.view.labels ? `<text x="${(r.milestone ? x0 + 9 : x1 + 6)}" y="${cy + 4}" class="b-lab">${esc(r.milestone ? r.name + " · " + fmt(r.start, false) : (tasks()[r.i].party || r.name))}</text>` : "";
    if (r.summary) {
      bars += `<g class="bar sum" data-bar="${esc(r.id)}"><path d="M${x0} ${cy - 5}H${x1}V${cy + 4}L${x1 - 6} ${cy}H${x0 + 6}L${x0} ${cy + 4}Z"/>${label}</g>`;
    } else if (r.milestone) {
      bars += `<g class="bar ms${isC ? " crit" : ""}" data-bar="${esc(r.id)}"><path d="${diamond(x0, cy, 7)}"/>${label}</g>`;
    } else {
      const w = Math.max(3, x1 - x0);
      const pw = w * r.pct / 100;
      bars += `<g class="bar task${isC ? " crit" : ""}" data-bar="${esc(r.id)}"><rect x="${x0}" y="${cy - 7}" width="${w}" height="14" rx="3" class="b-body"/>`
        + (pw ? `<rect x="${x0}" y="${cy - 3}" width="${pw}" height="6" rx="1.5" class="b-done"/>` : "")
        + (P.can ? `<rect x="${x1 - 5}" y="${cy - 7}" width="7" height="14" class="b-end" data-end="1"/><circle cx="${x0 - 7}" cy="${cy}" r="4" class="b-h" data-h="S"/><circle cx="${x1 + 7}" cy="${cy}" r="4" class="b-h" data-h="F"/>` : "")
        + label + `</g>`;
    }
  });
  // links
  let links = "";
  if (P.view.links) {
    tasks().forEach((t) => {
      const ti = at.get(t.id);
      if (ti === undefined) return;
      for (const dp of t.deps || []) {
        const fi = at.get(dp.from);
        if (fi === undefined) continue;
        const f = P.rows[fi], s = P.rows[ti];
        const c = crit && f.critical && s.critical && !f.summary && !s.summary;
        links += `<g class="lnk${c ? " crit" : ""}" data-lf="${esc(dp.from)}" data-lt="${esc(t.id)}"><path d="${linkPath(f, fi, s, ti, dp.type || "FS")}" class="l-p"/><path d="${linkPath(f, fi, s, ti, dp.type || "FS")}" class="l-hit"/></g>`;
      }
    });
  }
  // today, the status date and the progress line
  const tx = X(PC.todayIso());
  let lines = `<line x1="${tx}" y1="0" x2="${tx}" y2="${H}" class="g-today"/>`;
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
      pts.push(`${sx},${y}`, `${px},${y + RH / 2}`, `${sx},${y + RH}`);
    });
    lines += `<polyline points="${pts.join(" ")}" class="g-prog"/>`;
  }
  $("#pg-cb").innerHTML = `<svg width="${W}" height="${H}" class="pg-chart" id="pg-svg"><defs>`
    + `<marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" class="l-ar"/></marker>`
    + `<marker id="arc" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" class="l-arc"/></marker></defs>`
    + `<g>${bg}</g><g>${grid}</g><g>${rows}</g><g>${base}</g><g>${links}</g><g>${bars}</g><g>${lines}</g><g id="pg-drag-layer"></g></svg>`;
}
function diamond(cx, cy, r) { return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`; }

/* a link: out of the predecessor's start or finish, into the successor's */
function linkPath(f, fi, s, ti, type) {
  const fy = fi * RH + RH / 2, ty = ti * RH + RH / 2;
  const fx = f.milestone ? msX(f) : type[0] === "S" ? X(f.start) : X(f.finish, true);
  const tx = s.milestone ? msX(s) : type[1] === "S" ? X(s.start) : X(s.finish, true);
  const out = type[0] === "F" ? fx + 8 : fx - 8;
  const down = ty > fy ? 1 : -1;
  const into = type[1] === "S";
  if ((into && out <= tx - 3) || (!into && out >= tx + 3)) {
    const x = into ? Math.max(out, tx + 4) : Math.min(out, tx - 4);
    return `M${fx} ${fy}H${x}V${ty - down * 8}`;
  }
  const yb = fi * RH + (down > 0 ? RH : 0);
  const xin = into ? tx - 8 : tx + 8;
  return `M${fx} ${fy}H${out}V${yb}H${xin}V${ty}H${tx + (into ? -1 : 1)}`;
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
    const p = PC.parseDeps(val, tasks(), id, P.cal.perWeek);
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
  svg.setPointerCapture(ev.pointerId);
  const ri = P.rows.findIndex((x) => x.id === id);
  const fx = side === "S" ? X(r.start) : X(r.finish, true), fy = ri * RH + RH / 2;
  const mv = (e) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 3 || Math.abs(e.clientY - ev.clientY) > 3) moved = true;
    if (!moved) return;
    const dd = Math.round(dx / P.ppd);
    if (mode === "move") { g.setAttribute("transform", `translate(${dd * P.ppd},0)`); tip(e, `${fmt(PC.isoOf(PC.dayOf(r.start) + dd))} - ${fmt(PC.isoOf(PC.dayOf(r.finish) + dd))}`); }
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
    if (mode === "move" && last) {
      before();
      const want = PC.isoOf(PC.dayOf(r.start) + last);
      t.start = PC.isoOf(P.cal.dayAt(P.cal.ord(PC.dayOf(want))));
      changed();
      const now = rowOf(id);
      if (now.start > t.start) toast("Held later by its predecessor - change the link's lag to start it sooner");
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
  const el = pop(lk, `<div class="pg-lm"><b>${esc(f.name)} → ${esc(s.name)}</b>`
    + `<label>Type <select class="lm-t">${PC.TYPES.map((x) => `<option value="${x}"${x === d.type ? " selected" : ""}>${x} - ${PC.TYPE_LABEL[x]}</option>`).join("")}</select></label>`
    + `<label>Lag (working days; minus for a lead) <input class="lm-l" type="number" step="1" value="${d.lag || 0}"></label>`
    + `<div class="row end">${P.can ? `<button type="button" class="ghost lm-x">Delete link</button><button type="button" class="primary lm-ok">Done</button>` : ""}</div></div>`, 290);
  el.style.left = Math.min(innerWidth - 300, ev.clientX) + "px";
  el.style.top = (ev.clientY + 10) + "px";
  if (!P.can) { for (const i of el.querySelectorAll("select, input")) i.disabled = true; return; }
  el.querySelector(".lm-ok").onclick = () => {
    before();
    d.type = el.querySelector(".lm-t").value;
    d.lag = Math.round(+el.querySelector(".lm-l").value || 0);
    closePop();
    if (checkLoop()) changed();
  };
  el.querySelector(".lm-x").onclick = () => { before(); t.deps = t.deps.filter((x) => x !== d); closePop(); changed(); };
}

/* ------------------------------------------------------------ the dialogs */

function lastModal() { const all = document.querySelectorAll(".t-modal-back"); return all[all.length - 1]; }

async function activity(id) {
  const t = taskOf(id), r = rowOf(id);
  if (!t) return;
  const opts = tasks().filter((x) => x.id !== id).map((x, k) => `<option value="${esc(x.id)}">${esc(rowOf(x.id).wbs + " " + (x.name || ""))}</option>`).join("");
  const depRow = (d) => `<div class="eg-row pg-dep"><select class="dp-f">${opts.replace(`value="${esc(d.from)}"`, `value="${esc(d.from)}" selected`)}</select>`
    + `<select class="dp-t">${PC.TYPES.map((x) => `<option${x === d.type ? " selected" : ""}>${x}</option>`).join("")}</select>`
    + `<input class="dp-l" type="number" step="1" value="${d.lag || 0}" title="Lag in working days (minus: a lead)"><button type="button" class="ghost dp-x" title="Remove">&times;</button></div>`;
  const L = t.links || {};
  const lt = L.task ? P.linked.get(L.task.list + ":" + L.task.id) : null;
  const p = modal(`${r.wbs}  ${r.name || "Task"}`, `
    <label>Name<input name="name" value="${esc(t.name)}" maxlength="300"></label>
    <div class="pg-2">
      <label>Kind<select name="kind"${r.summary ? " disabled" : ""}><option value="task">Task</option><option value="milestone"${t.kind === "milestone" ? " selected" : ""}>Milestone</option></select></label>
      <label>Duration (working days)<input name="dur" value="${r.summary ? r.dur : t.dur || 0}"${r.summary ? " disabled" : ""}></label>
    </div>
    <div class="pg-2">
      <label>Start no earlier than<input name="start" type="date" value="${esc(t.start || "")}"${r.summary ? " disabled" : ""}></label>
      <label>% done<input name="pct" type="number" min="0" max="100" value="${r.pct}"${r.summary ? " disabled" : ""}></label>
    </div>
    <p class="muted pg-dates">Scheduled ${fmtLong(r.start)}${r.milestone ? "" : " - " + fmtLong(r.finish)} · total float ${r.tf} d${r.critical ? " · on the critical path" : ""}</p>
    <label>Responsible<input name="party" value="${esc(t.party || "")}" placeholder="e.g. Architect, Contractor, BD"></label>
    <label>Notes<textarea name="notes" rows="2">${esc(t.notes || "")}</textarea></label>
    <h4>Predecessors</h4><div class="eg pg-deps">${t.deps.map(depRow).join("")}</div>
    <button type="button" class="ghost dp-add">+ Predecessor</button>
    <h4>Linked</h4>
    <div class="pg-links">
      <div class="pg-lrow"><b>Task</b> ${L.task ? `<a href="tasks.html?list=${encodeURIComponent(L.task.list)}&task=${encodeURIComponent(L.task.id)}" target="_blank">${esc(L.task.title)}</a> <span class="muted">${lt ? (lt.done ? "done" : (lt.percent || 0) + "%") + (lt.due ? " · due " + fmt(lt.due) : "") : ""}</span>
        <button type="button" class="ghost lk-sync" title="Set the task's start and due to this activity's dates">Update its dates</button>
        <label class="row-check"><input type="checkbox" name="use_pct"${L.use_pct ? " checked" : ""}> take its % done</label>
        <button type="button" class="ghost lk-un">Unlink</button>`
        : `<button type="button" class="ghost lk-new">Create a task</button><button type="button" class="ghost lk-old">Link an existing task</button>`}</div>
      <div class="pg-lrow"><b>Chat</b> ${L.room ? `<a href="messenger.html?room=${encodeURIComponent(L.room.id)}" target="_blank">${esc(L.room.title)}</a> <button type="button" class="ghost lk-chat">Post again</button>` : `<button type="button" class="ghost lk-chat">Discuss in chat</button>`}</div>
    </div>`, P.can ? "Save" : "Close");
  const back = lastModal();
  const form = back.querySelector("form");
  if (!P.can) for (const i of form.querySelectorAll("input, select, textarea, .dp-add, .dp-x, .pg-links button")) i.disabled = true;
  const box = form.querySelector(".pg-deps");
  form.querySelector(".dp-add").onclick = () => { box.insertAdjacentHTML("beforeend", depRow({ from: "", type: "FS", lag: 0 })); };
  box.addEventListener("click", (e) => { const x = e.target.closest(".dp-x"); if (x) x.closest(".pg-dep").remove(); });
  const lk = (sel, fn) => { const b = form.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }; };
  lk(".lk-new", async () => { if (await createTask(t)) { back.remove(); activity(id); } });
  lk(".lk-old", async () => { if (await linkTask(t, form.querySelector(".lk-old"))) { back.remove(); activity(id); } });
  lk(".lk-un", async () => { before(); delete t.links.task; changed(); back.remove(); activity(id); });
  lk(".lk-sync", async () => syncTask(t));
  lk(".lk-chat", async () => { if (await discuss(t)) { back.remove(); activity(id); } });
  const f = await p;
  if (!f || !P.can) return;
  before();
  t.name = f.name.value.trim().slice(0, 300);
  if (!r.summary) {
    const n = PC.parseDur(f.dur.value, P.cal.perWeek);
    t.kind = f.kind.value === "milestone" || n === 0 ? "milestone" : "task";
    if (n !== null) t.dur = t.kind === "milestone" ? 0 : Math.max(1, n);
    t.start = f.start.value || "";
    t.pct = Math.max(0, Math.min(100, parseInt(f.pct.value, 10) || 0));
  }
  t.party = f.party.value.trim().slice(0, 120);
  t.notes = f.notes.value.trim().slice(0, 2000);
  t.deps = [...box.querySelectorAll(".pg-dep")].map((x) => ({ from: x.querySelector(".dp-f").value, type: x.querySelector(".dp-t").value, lag: Math.round(+x.querySelector(".dp-l").value || 0) }))
    .filter((d, k, all) => d.from && d.from !== id && all.findIndex((y) => y.from === d.from) === k);
  if (t.links.task) t.links.use_pct = !!(f.use_pct && f.use_pct.checked);
  if (checkLoop()) changed();
}

async function taskLists() {
  const lists = ((await api("/api/task-lists")).lists || []).filter((l) => l.role === "owner" || l.role === "editor");
  if (!lists.length) { toast("You cannot add tasks to any task list yet - ask a list owner", true); return null; }
  const mine = lists.filter((l) => !l.project || l.project === project());
  return mine.length ? mine : lists;
}
const backLink = (t) => ({ kind: "url", url: `/programme.html?project=${encodeURIComponent(project() || "")}&task=${encodeURIComponent(t.id)}`, title: "Programme: " + (t.name || "") });

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
  const url = `${location.origin}/programme.html?project=${encodeURIComponent(pr || "")}&task=${encodeURIComponent(t.id)}`;
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
    <div class="row"><button type="button" class="ghost" data-all="1">Expand all</button><button type="button" class="ghost" data-all="0">Collapse all</button></div></div>`, 250);
  el.addEventListener("change", (ev) => {
    const i = ev.target;
    if (i.dataset.col) {
      const k = i.dataset.col;
      const want = Object.keys(COLS).filter((x) => (x === k ? i.checked : P.d.columns.includes(x)));
      if (P.can) { before(); P.d.columns = want; changed(); } else { P.d.columns = want; recalc(); render(); }
    } else if (i.dataset.v) { P.view[i.dataset.v] = i.checked; saveView(); recalc(); render(); }
  });
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-all]");
    if (!b) return;
    P.view.collapsed = b.dataset.all === "1" ? [] : P.sched.rows.filter((r) => r.summary).map((r) => r.id);
    saveView(); recalc(); render();
  });
}

function setupMenu(anchor) {
  const el = pop(anchor, `<div class="po-row" data-s="cal">Working calendar and holidays ...</div><div class="po-row" data-s="cover">Title block and remarks (for the PDF) ...</div>`
    + `<div class="po-row" data-s="tpl">Start from the architectural template ...</div><div class="po-row" data-s="hist">Earlier versions ...</div>`, 280);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest("[data-s]");
    if (!r) return;
    closePop();
    ({ cal: calendarDlg, cover: coverDlg, tpl: template, hist: historyDlg })[r.dataset.s]();
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
    <p class="muted">Durations and lags count working days. Check the holidays against each year's gazette notice.</p>`, P.can ? "Save" : "Close");
  if (!f || !P.can) return;
  before();
  const hol = f.hol.value.split(/\s*\n\s*/).map((x) => x.trim().slice(0, 10)).filter((x) => PC.dayOf(x) !== null);
  const off = f.off.value.split(/\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|to|-)\s*(\d{4}-\d{2}-\d{2}))?\s*(.*)$/.exec(x);
    return m ? { from: m[1], to: m[2] || m[1], name: m[3].slice(0, 80) } : null;
  }).filter(Boolean);
  P.d.calendar = { week: f.week.value, hk: f.hk.checked, holidays: hol, off };
  P.d.cover.start = f.start.value || "";
  changed();
}
async function coverDlg() {
  const c = P.d.cover;
  const f = await modal("Title block and remarks", `
    <label>Title<input name="title" value="${esc(c.title || "Indicative Project Programme")}"></label>
    <div class="pg-2"><label>Project<input name="project" value="${esc(c.project || P.projectName || "")}"></label><label>Client<input name="client" value="${esc(c.client || "")}"></label></div>
    <div class="pg-2"><label>Revision<input name="rev" value="${esc(c.rev || "A")}"></label><label>Date<input type="date" name="date" value="${esc(c.date || PC.todayIso())}"></label></div>
    <div class="pg-2"><label>Prepared by<input name="prepared" value="${esc(c.prepared || (P.me && P.me.user ? P.me.user.name : ""))}"></label><label>Status date<input type="date" name="status_date" value="${esc(c.status_date || "")}"></label></div>
    <label>Note under the title (optional)<input name="note" value="${esc(c.note || "")}" placeholder="e.g. Subject to the Buildings Department's approval timing"></label>
    <label>Remarks (one a line, numbered on the PDF)<textarea name="remarks" rows="4">${esc(P.d.remarks.join("\n"))}</textarea></label>`, P.can ? "Save" : "Close");
  if (!f || !P.can) return;
  before();
  for (const k of ["title", "project", "client", "rev", "date", "prepared", "status_date", "note"]) c[k] = f[k].value.trim().slice(0, 200);
  P.d.remarks = f.remarks.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  changed();
}
async function historyDlg() {
  let items = [];
  try { items = (await api("/api/programme/history")).items || []; } catch (e) { return toast(e.message, true); }
  const el = await modal("Earlier versions", items.length ? `<div class="pg-hist">${items.map((x) => `<label class="row-check"><input type="radio" name="rev" value="${x.rev}"> Version ${x.rev} · ${esc(x.by || "")} · ${esc(String(x.at || "").replace("T", " ").slice(0, 16))} · ${x.tasks} tasks</label>`).join("")}</div><p class="muted">Bring one back: it becomes the newest version (the current one stays in the list).</p>` : `<p class="muted">No versions yet.</p>`, P.can ? "Bring back" : "Close");
  if (!el || !P.can || !el.rev) return;
  const rv = [...el.querySelectorAll('input[name="rev"]')].find((x) => x.checked);
  if (!rv) return;
  const old = await api("/api/programme?rev=" + rv.value);
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
  P.d.tasks = list;
  if (!P.d.cover.title) P.d.cover.title = "Indicative Project Programme";
  P.view.collapsed = [];
  saveView();
  changed();
  toast("Template in: an indicative programme - change the durations and links to suit");
}

/* ------------------------------------------------------- export / import */

function exportMenu(anchor) {
  const el = pop(anchor, `<div class="po-row" data-x="pdf"><b>PDF for the client ...</b><br><small class="muted">A3 / A4, title block, legend, remarks</small></div>`
    + `<div class="po-row" data-x="csv"><b>CSV</b><br><small class="muted">Excel; MS Project can import it too</small></div>`, 250);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest("[data-x]");
    if (!r) return;
    closePop();
    if (r.dataset.x === "csv") downloadCsv(); else pdfDlg();
  });
}
function fileName(ext) {
  const c = P.d.cover;
  return [(c.project || P.projectName || project() || "Programme"), "Programme", c.rev ? "Rev " + c.rev : "", PC.todayIso()].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|]+/g, " ") + "." + ext;
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
    <div class="pg-2"><label>From<input type="date" name="from" value="${P.sched.start}"></label><label>To<input type="date" name="to" value="${P.sched.finish}"></label></div>
    <label>Baseline<select name="base"><option value="">None</option>${P.d.baselines.map((b) => `<option value="${esc(b.id)}"${b.id === P.view.baseline ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
    <label class="row-check"><input type="checkbox" name="crit"${P.view.critical ? " checked" : ""}> Critical path in red</label>
    <label class="row-check"><input type="checkbox" name="links"${P.view.links ? " checked" : ""}> Links (arrows)</label>
    <label class="row-check"><input type="checkbox" name="prog" checked> Progress (% done on the bars)</label>
    <label class="row-check"><input type="checkbox" name="status"${c.status_date ? " checked" : ""}> Status date line${c.status_date ? " (" + fmtLong(c.status_date) + ")" : " - set it in Set up > Title block"}</label>
    <label class="row-check"><input type="checkbox" name="labels"> The responsible party beside the bars</label>
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
      bstart: v ? v.bstart : "", bfinish: v ? v.bfinish : "", cells, label: f.labels.checked ? t.party || "" : "" };
  });
  const links = [];
  for (const t of tasks()) {
    const ti = at.get(t.id);
    if (ti === undefined) continue;
    for (const d of t.deps) {
      const fi = at.get(d.from);
      if (fi === undefined) continue;
      links.push({ from: fi, to: ti, type: d.type || "FS", critical: P.rows[fi].critical && P.rows[ti].critical && !P.rows[fi].summary && !P.rows[ti].summary });
    }
  }
  const spec = {
    name: fileName("pdf"), paper: f.paper.value, orient: f.orient.value, range: { from: f.from.value, to: f.to.value },
    start: P.sched.start, finish: P.sched.finish,
    cover: Object.assign({ title: "Indicative Project Programme", project: P.projectName || project() || "" }, c, { status_date: f.status.checked ? c.status_date || "" : "" }),
    columns: P.d.columns.map((k) => ({ key: k, label: COLS[k].short || COLS[k].label, w: COLS[k].mm, align: COLS[k].align || "left" })),
    rows, links, remarks: P.d.remarks,
    show: { links: f.links.checked, baseline: !!b, progress: f.prog.checked, status: f.status.checked, critical: f.crit.checked },
  };
  toast("Making the PDF ...");
  try {
    const res = await fetch("/api/programme/pdf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, hdrs()), body: JSON.stringify(spec) });
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

/* ------------------------------------------------------------------ start */

function fit() {
  const w = $("#pg-body").clientWidth - gridWidth() - 30;
  const lo = PC.dayOf(P.sched.start), hi = PC.dayOf(P.sched.finish);
  if (lo === null) return;
  P.view.zoom = "fit";
  P.view.ppd = Math.max(0.3, Math.min(40, w / Math.max(14, (hi - lo) * 1.1 + 21)));
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
  loadView();
  if (P.phone && !localStorage.getItem(keyView())) P.view.zoom = "month";
  try {
    const ps = await api("/api/projects");
    const p = (ps.projects || ps || []).find && (ps.projects || ps).find((x) => x.id === project());
    P.projectName = p ? p.name || p.title || "" : "";
  } catch (e) {}
  await loadDoc();
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
  $("#pg-today").onclick = () => scrollToDay(PC.todayIso());
  $("#pg-crit").onclick = () => { P.view.critical = !P.view.critical; saveView(); render(); };
  $("#pg-base").onclick = (ev) => baseMenu(ev.currentTarget);
  $("#pg-view").onclick = (ev) => viewMenu(ev.currentTarget);
  $("#pg-setup").onclick = (ev) => setupMenu(ev.currentTarget);
  $("#pg-export").onclick = (ev) => exportMenu(ev.currentTarget);
  $("#pg-import").onclick = () => { if (!P.can) return toast("Only a project member can change the programme", true); $("#pg-file").click(); };
  $("#pg-file").onchange = (ev) => { const f = ev.target.files[0]; ev.target.value = ""; if (f) importCsv(f); };
  if (!P.can) for (const el of document.querySelectorAll(".pg-edit")) el.hidden = true;

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
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); saveView(); render(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  // the chart
  const cb = $("#pg-cb");
  cb.addEventListener("pointerdown", chartDown);
  cb.addEventListener("pointermove", hover);
  cb.addEventListener("pointerleave", hideTip);
  cb.addEventListener("dblclick", (ev) => { const g = ev.target.closest("[data-bar]"); if (g) activity(g.dataset.bar); });

  // keys
  document.addEventListener("keydown", (ev) => {
    if (ev.target.closest && ev.target.closest("input, textarea, select, .t-modal")) return;
    const k = ev.key;
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === "y") { ev.preventDefault(); redo(); }
    else if ((ev.ctrlKey || ev.metaKey) && k === "Enter") { ev.preventDefault(); add("task"); }
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
      const d = await api("/api/programme");
      if (d.rev !== P.doc.rev) {
        P.doc = d; P.d = defaults(d.data || {}); P.can = !!d.can_edit && !P.phone;
        recalc(); render();
        toast("Updated by " + (d.by || "someone"));
      }
    } catch (e) {}
  });
  addEventListener("resize", () => { const ph = phone(); if (ph !== P.phone) { P.phone = ph; P.can = !!P.doc.can_edit && !ph; } render(); });
  addEventListener("beforeunload", (ev) => { if (P.pending) { save(); ev.preventDefault(); ev.returnValue = ""; } });
}
function midDay() {
  const b = $("#pg-body");
  return dayAtX(b.scrollLeft + (b.clientWidth - gridWidth()) / 2);
}

start().catch((e) => { if (!/Set your own password/.test(e.message)) toast(e.message, true); });
