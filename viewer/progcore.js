/* The Programme's scheduling (programme.js draws it, the server prints it):
 * a working-day calendar, and the critical path method over the four
 * dependency types with lag - no page, no DOM, unit-tested
 * (viewer/tests/progcore.test.mjs).
 *
 * A task: {id, name, level, kind: "task"|"milestone", start (yyyy-mm-dd, the
 * earliest it may start - its predecessors can push it later), fnet (the
 * earliest it may finish, optional), dur (working
 * days), pct, deps: [{from: id, type: "FS"|"SS"|"FF"|"SF", lag: working days}]}.
 * A row followed by deeper rows is a summary: its dates and % are its
 * tasks'. A link to or from a summary stands for its tasks.
 *
 * Working days are counted as ordinals: es = the ordinal of the first
 * working day, ef = es + dur (the day after the last). Finish shown = the
 * last working day (a milestone: its start).
 */

const DAY = 86400000;
const BASE = Date.UTC(2000, 0, 1);
const SPAN = 101 * 366;                       // 2000 to 2100

export const TYPES = ["FS", "SS", "FF", "SF"];
export const TYPE_LABEL = { FS: "Finish to start", SS: "Start to start", FF: "Finish to finish", SF: "Start to finish" };

/* Hong Kong general holidays (the gazette's list; weekend days are kept
 * because they matter for a Mon - Sat week). Check each year's notice. */
export const HK_HOLIDAYS = {
  2026: ["2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-04", "2026-04-06", "2026-04-07",
    "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01", "2026-09-26", "2026-10-01", "2026-10-19", "2026-12-25", "2026-12-26"],
  2027: ["2027-01-01", "2027-02-06", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-27", "2027-03-29", "2027-04-05",
    "2027-05-01", "2027-05-13", "2027-06-09", "2027-07-01", "2027-09-16", "2027-10-01", "2027-10-08", "2027-12-25", "2027-12-27"],
  2028: ["2028-01-01", "2028-01-26", "2028-01-27", "2028-01-28", "2028-04-04", "2028-04-14", "2028-04-15", "2028-04-17",
    "2028-05-01", "2028-05-02", "2028-05-29", "2028-07-01", "2028-10-02", "2028-10-04", "2028-10-26", "2028-12-25", "2028-12-26"],
};
export const hkHolidays = () => Object.values(HK_HOLIDAYS).flat();

export const WEEKS = { "mon-fri": "Mon - Fri", "mon-sat": "Mon - Sat", all: "Every day (calendar days)" };

export function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = Math.round((t - BASE) / DAY);
  return d >= 0 && d < SPAN ? d : null;
}
export function isoOf(day) {
  const d = new Date(BASE + day * DAY);
  return d.toISOString().slice(0, 10);
}
export function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/* The calendar: {week, holidays: [iso], off: [iso or "iso..iso"]} */
export class Calendar {
  constructor(c = {}) {
    this.week = WEEKS[c.week] ? c.week : "mon-fri";
    const shut = new Set();
    if (this.week !== "all") {
      for (const h of c.holidays || []) { const d = dayOf(h); if (d !== null) shut.add(d); }
    }
    for (const o of c.off || []) {            // the office's own days off: "2027-02-01..2027-02-12"
      const [a, b] = String(o.from ? o.from + ".." + (o.to || o.from) : o).split("..");
      const x = dayOf(a), y = dayOf(b || a);
      if (x === null || y === null) continue;
      for (let d = Math.min(x, y); d <= Math.max(x, y); d++) shut.add(d);
    }
    this.prefix = new Int32Array(SPAN + 1);   // working days before each day
    this.days = [];                           // the working days, by ordinal
    for (let d = 0; d < SPAN; d++) {
      const wd = (new Date(BASE + d * DAY).getUTCDay());      // 0 Sunday
      const work = !shut.has(d) && (this.week === "all" || (wd !== 0 && (this.week === "mon-sat" || wd !== 6)));
      this.prefix[d + 1] = this.prefix[d] + (work ? 1 : 0);
      if (work) this.days.push(d);
    }
    this.perWeek = this.week === "all" ? 7 : this.week === "mon-sat" ? 6 : 5;
  }
  isWork(day) { return this.prefix[day + 1] > this.prefix[day]; }
  /* the ordinal of a day; a day off counts as the next working day */
  ord(day) { return this.prefix[Math.max(0, Math.min(SPAN - 1, day))]; }
  dayAt(ord) { return this.days[Math.max(0, Math.min(this.days.length - 1, ord))]; }
  ordOf(iso) { const d = dayOf(iso); return d === null ? null : this.ord(d); }
  isoAt(ord) { return isoOf(this.dayAt(ord)); }
  /* working days from a to b (b's ordinal minus a's) */
  between(a, b) { const x = this.ordOf(a), y = this.ordOf(b); return x === null || y === null ? null : y - x; }
  add(iso, n) { const o = this.ordOf(iso); return o === null ? "" : this.isoAt(o + n); }
}

/* "10", "10d", "2w", "0" -> working days; null if not a duration */
export function parseDur(s, perWeek = 5) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?|工作天|天|週|周)?\s*$/i.exec(String(s ?? ""));
  if (!m) return null;
  const n = parseFloat(m[1]);
  const w = /^(w|wk|wks|week|weeks|週|周)$/i.test(m[2] || "");
  return Math.round(w ? n * perWeek : n);
}

/* ------------------------------------------------------------ structure */

/* each row: its summary parent, whether it is a summary, its WBS number */
export function outline(tasks) {
  const out = [];
  const stack = [];                // [{i, level}]
  const counters = [];
  let prevLevel = 0;
  tasks.forEach((t, i) => {
    let lv = Math.max(0, Math.min(9, Math.round(+t.level || 0)));
    if (lv > prevLevel + 1) lv = prevLevel + 1;   // no jumping two levels
    prevLevel = lv;
    while (stack.length && stack[stack.length - 1].level >= lv) stack.pop();
    counters.length = lv + 1;
    counters[lv] = (counters[lv] || 0) + 1;
    const parent = stack.length ? stack[stack.length - 1].i : -1;
    out.push({ i, level: lv, parent, wbs: counters.slice(0, lv + 1).map((x) => x || 1).join("."), summary: false });
    if (parent >= 0) out[parent].summary = true;
    stack.push({ i, level: lv });
  });
  return out;
}

/* the leaves under a summary (or the row itself) */
function leavesOf(i, ol) {
  if (!ol[i].summary) return [i];
  const out = [];
  for (let k = i + 1; k < ol.length && ol[k].level > ol[i].level; k++) if (!ol[k].summary) out.push(k);
  return out;
}

/* ------------------------------------------------------------- schedule */

/* -> {rows: [{id, wbs, level, summary, milestone, es, ef, ls, lf, start,
 *    finish, dur, tf, ff, critical, pct, ...}], start, finish, errors: [..]} */
export function schedule(tasks, calendar, opts = {}) {
  const cal = calendar instanceof Calendar ? calendar : new Calendar(calendar);
  const ol = outline(tasks);
  const n = tasks.length;
  const idx = new Map(tasks.map((t, i) => [t.id, i]));
  const errors = [];
  const projStart = cal.ordOf(opts.start) ?? (() => {
    let m = null;
    for (const t of tasks) { const o = cal.ordOf(t.start); if (o !== null && (m === null || o < m)) m = o; }
    return m ?? cal.ordOf(todayIso());
  })();
  const dur = tasks.map((t, i) => (ol[i].summary ? 0 : t.kind === "milestone" ? 0 : Math.max(0, Math.round(+t.dur || 0))));
  // the links, between leaves
  const preds = Array.from({ length: n }, () => []);
  const succs = Array.from({ length: n }, () => []);
  const seen = new Set();
  tasks.forEach((t, si) => {
    for (const d of t.deps || []) {
      const pi = idx.get(d.from);
      if (pi === undefined || d.drive === false) continue;      // a "related only" link is drawn, not scheduled
      const type = TYPES.includes(d.type) ? d.type : "FS";
      const lag = Math.round(+d.lag || 0);
      for (const p of leavesOf(pi, ol)) {
        for (const s of leavesOf(si, ol)) {
          if (p === s) continue;
          // a link inside one summary to the summary itself means nothing
          const key = p + ">" + s + type;
          if (seen.has(key)) continue;
          seen.add(key);
          const l = { p, s, type, lag };
          preds[s].push(l);
          succs[p].push(l);
        }
      }
    }
  });
  // topological order of the leaves (Kahn); a loop is refused
  const leaves = [];
  for (let i = 0; i < n; i++) if (!ol[i].summary) leaves.push(i);
  const indeg = new Array(n).fill(0);
  for (const i of leaves) indeg[i] = preds[i].length;
  const queue = leaves.filter((i) => !indeg[i]);
  const order = [];
  while (queue.length) {
    const i = queue.shift();
    order.push(i);
    for (const l of succs[i]) if (--indeg[l.s] === 0) queue.push(l.s);
  }
  const looped = new Set();
  if (order.length < leaves.length) {
    const left = leaves.filter((i) => indeg[i] > 0);
    errors.push({ kind: "loop", rows: left, message: "These tasks link to each other in a loop, so their links are not used: " + left.map((i) => ol[i].wbs + " " + (tasks[i].name || "")).join(", ") });
    for (const i of left) { looped.add(i); order.push(i); }
  }
  const es = new Array(n).fill(0), ef = new Array(n).fill(0), ls = new Array(n).fill(0), lf = new Array(n).fill(0);
  const driving = new Array(n).fill(null);
  // forward
  for (const i of order) {
    const own = cal.ordOf(tasks[i].start);
    let e = own ?? projStart;
    // "finish no earlier than" (MS Project's FNET / MFO): it may not finish before that day
    const fn = cal.ordOf(tasks[i].fnet);
    if (fn !== null && fn + 1 - dur[i] > e) e = fn + 1 - dur[i];
    let drv = null;
    if (!looped.has(i)) {
      for (const l of preds[i]) {
        const p = l.p, d = dur[i];
        const need = l.type === "FS" ? ef[p] + l.lag : l.type === "SS" ? es[p] + l.lag : l.type === "FF" ? ef[p] + l.lag - d : es[p] + l.lag - d;
        if (need > e || (need === e && !drv && own === null)) { e = need; drv = l; }
      }
    }
    es[i] = Math.max(0, e);
    ef[i] = es[i] + dur[i];
    driving[i] = drv;
  }
  let pf = projStart;
  for (const i of leaves) pf = Math.max(pf, ef[i]);
  // backward
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    let f = pf;
    if (!looped.has(i)) {
      for (const l of succs[i]) {
        const s = l.s, d = dur[i];
        const lim = l.type === "FS" ? ls[s] - l.lag : l.type === "SS" ? ls[s] - l.lag + d : l.type === "FF" ? lf[s] - l.lag : lf[s] - l.lag + d;
        if (lim < f) f = lim;
      }
    }
    lf[i] = f;
    ls[i] = f - dur[i];
  }
  const rows = tasks.map((t, i) => ({
    id: t.id, i, name: t.name || "", wbs: ol[i].wbs, level: ol[i].level, parent: ol[i].parent,
    summary: ol[i].summary, milestone: !ol[i].summary && (t.kind === "milestone" || dur[i] === 0),
    es: es[i], ef: ef[i], ls: ls[i], lf: lf[i], dur: dur[i], pct: Math.max(0, Math.min(100, Math.round(+t.pct || 0))),
    tf: ls[i] - es[i], ff: 0, critical: false, driving: driving[i] ? tasks[driving[i].p].id : "", dtype: driving[i] ? driving[i].type : "",
    party: t.party || "", looped: looped.has(i),
  }));
  for (const i of leaves) {
    const r = rows[i];
    let ff = pf - ef[i];
    for (const l of succs[i]) {
      const s = l.s;
      const slack = l.type === "FS" ? es[s] - l.lag - ef[i] : l.type === "SS" ? es[s] - l.lag - es[i] : l.type === "FF" ? ef[s] - l.lag - ef[i] : ef[s] - l.lag - es[i];
      ff = Math.min(ff, slack);
    }
    r.ff = Math.max(0, Math.min(ff, r.tf));
    r.critical = r.tf <= 0;
  }
  // summaries, deepest first
  for (let i = n - 1; i >= 0; i--) {
    if (!ol[i].summary) continue;
    let a = null, b = null, tf = null, w = 0, done = 0, crit = false;
    for (let k = i + 1; k < n && ol[k].level > ol[i].level; k++) {
      if (ol[k].parent !== i) continue;
      const c = rows[k];
      a = a === null ? c.es : Math.min(a, c.es);
      b = b === null ? c.ef : Math.max(b, c.ef);
      tf = tf === null ? c.tf : Math.min(tf, c.tf);
      const wt = Math.max(1, c.dur);
      w += wt; done += wt * c.pct;
      crit = crit || c.critical;
    }
    const r = rows[i];
    r.es = r.ls = a ?? projStart; r.ef = r.lf = b ?? r.es; r.dur = r.ef - r.es; r.tf = tf ?? 0;
    r.pct = w ? Math.round(done / w) : 0; r.critical = crit;
  }
  for (const r of rows) {
    r.start = cal.isoAt(r.es);
    r.finish = r.ef > r.es ? cal.isoAt(r.ef - 1) : r.start;
    // a milestone that follows a finish is at the end of that day, as MS Project shows it
    if (r.milestone && r.es > 0 && (r.dtype === "FS" || r.dtype === "FF")) {
      r.start = r.finish = cal.isoAt(r.es - 1);
      r.ms_end = true;
    }
    r.late_start = cal.isoAt(r.ls);
    r.late_finish = r.lf > r.ls ? cal.isoAt(r.lf - 1) : cal.isoAt(r.ls);
  }
  for (const t of tasks) {
    for (const d of t.deps || []) if (!idx.has(d.from)) errors.push({ kind: "missing", message: `${t.name || "A task"}: its predecessor is gone` });
  }
  return { rows, links: [...seen].length, start: cal.isoAt(projStart), finish: pf > projStart ? cal.isoAt(pf - 1) : cal.isoAt(projStart),
    days: pf - projStart, errors, cal, succs, preds };
}

/* ---------------------------------------------------------- predecessors */

/* deps -> "3FS+2d; 5SS" by row numbers (1-based) */
export function formatDeps(deps, tasks) {
  const at = new Map(tasks.map((t, i) => [t.id, i + 1]));
  return (deps || []).filter((d) => at.has(d.from)).map((d) => {
    const lag = Math.round(+d.lag || 0);
    const type = d.type || "FS";
    return at.get(d.from) + (type !== "FS" || lag ? type : "") + (lag ? (lag > 0 ? "+" : "") + lag + "d" : "") + (d.drive === false ? "~" : "");
  }).join("; ");
}

/* "3FS+2d; 5SS; 7FF-1w" -> {deps} or {error} */
export function parseDeps(text, tasks, selfId, perWeek = 5, old = []) {
  const out = [];
  const parts = String(text || "").split(/[;,，；]+/).map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?)?)?\s*(~)?$/i.exec(p);
    if (!m) return { error: `"${p}" is not a predecessor - write it like 3, 3FS+2d, 5SS or 7FF-1d` };
    const row = +m[1];
    const t = tasks[row - 1];
    if (!t) return { error: `There is no row ${row}` };
    if (t.id === selfId) return { error: "A task cannot follow itself" };
    let lag = m[4] ? parseFloat(m[4]) * (/^w/i.test(m[5] || "") ? perWeek : 1) : 0;
    if (m[3] === "-") lag = -lag;
    const d = { from: t.id, type: (m[2] || "FS").toUpperCase(), lag: Math.round(lag) };
    // a link typed again keeps how it looks and whether it drives the dates
    const was = (old || []).find((x) => x.from === d.from && (x.type || "FS") === d.type) || (old || []).find((x) => x.from === d.from);
    if (was) for (const k of ["style", "color", "drive"]) if (was[k] !== undefined) d[k] = was[k];
    if (m[6]) { d.drive = false; if (!d.style) d.style = "dashed"; } else if (was && was.drive === false && !m[6]) delete d.drive;
    out.push(d);
  }
  return { deps: out };
}

/* ---------------------------------------------------------- baselines */

export function takeBaseline(sched, name, by = "") {
  const tasks = {};
  for (const r of sched.rows) tasks[r.id] = [r.start, r.finish, r.dur];
  return { id: "b" + Date.now().toString(36), name: String(name || "Baseline").slice(0, 80), saved_at: todayIso(), by, tasks };
}

/* slip in working days against a baseline: + is later */
export function variance(row, base, cal) {
  const b = base && base.tasks && base.tasks[row.id];
  if (!b) return null;
  return { start: cal.between(b[0], row.start), finish: cal.between(b[1], row.finish), bstart: b[0], bfinish: b[1] };
}

/* % expected by the status date (straight line) */
export function expectedPct(row, statusIso, cal) {
  const s = cal.ordOf(statusIso);
  if (s === null || row.dur <= 0) return s !== null && s > row.es ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((s + 1 - row.es) / row.dur) * 100)));
}

/* ----------------------------------------------------------------- CSV */

export const CSV_HEAD = ["ID", "WBS", "Name", "Duration (days)", "Start", "Finish", "Predecessors", "% Complete",
  "Total float", "Free float", "Critical", "Baseline start", "Baseline finish", "Finish variance", "Responsible", "Notes", "Level"];

const q = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function toCsv(tasks, sched, base) {
  const lines = [CSV_HEAD.join(",")];
  sched.rows.forEach((r, i) => {
    const t = tasks[i];
    const v = base ? variance(r, base, sched.cal) : null;
    lines.push([i + 1, r.wbs, "  ".repeat(r.level) + r.name, r.milestone ? 0 : r.dur, r.start, r.finish, formatDeps(t.deps, tasks),
      r.pct, r.summary ? "" : r.tf, r.summary ? "" : r.ff, r.critical ? "Yes" : "No", v ? v.bstart : "", v ? v.bfinish : "",
      v ? v.finish : "", t.party || "", t.notes || "", r.level].map(q).join(","));
  });
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inq = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inq) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += c;
    } else if (c === '"') inq = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/* A CSV (ours, or a list from Excel / MS Project: Name, Duration, Start,
 * Predecessors ...) -> tasks; the predecessors by its row numbers or IDs */
export function fromCsv(text, perWeek = 5, newId = () => Math.random().toString(36).slice(2, 10)) {
  const rows = parseCsv(text);
  if (!rows.length) return { tasks: [], error: "The file is empty" };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const c = {
    id: col("id", "unique id"), wbs: col("wbs", "outline number"), name: col("name", "task name", "activity", "task"),
    dur: col("duration"), start: col("start"), pred: col("predecessors"), pct: col("% complete", "percent", "%"),
    party: col("responsible", "resource", "party"), notes: col("notes"), level: col("level", "outline level"), ms: col("milestone"),
  };
  if (c.name < 0) return { tasks: [], error: "No Name column - the first row should name the columns (Name, Duration, Start, Predecessors ...)" };
  const tasks = [];
  const byKey = new Map();
  const raw = [];
  for (const r of rows.slice(1)) {
    const name0 = r[c.name] || "";
    if (!name0.trim()) continue;
    let level = c.level >= 0 && /^\d+$/.test((r[c.level] || "").trim()) ? +r[c.level] : null;
    if (level !== null && c.level >= 0 && head[c.level].startsWith("outline level")) level -= 1;   // MS Project counts from 1
    if (level === null && c.wbs >= 0 && /^\d+(\.\d+)*$/.test((r[c.wbs] || "").trim())) level = r[c.wbs].trim().split(".").length - 1;
    if (level === null) level = Math.floor((/^\s*/.exec(name0)[0].length) / 2);
    const d = parseDur(String(r[c.dur] ?? "").replace(/\?$/, ""), perWeek);
    const start = /^\d{4}-\d{2}-\d{2}/.test((r[c.start] || "").trim()) ? r[c.start].trim().slice(0, 10) : isoFromText(r[c.start]);
    const t = { id: newId(), name: name0.trim(), level: Math.max(0, level), kind: d === 0 || /^(yes|true|1)$/i.test(r[c.ms] || "") ? "milestone" : "task",
      start: start || "", dur: d === null ? 1 : Math.max(0, d), pct: parseInt(r[c.pct] || "0", 10) || 0,
      party: c.party >= 0 ? (r[c.party] || "").trim() : "", notes: c.notes >= 0 ? (r[c.notes] || "").trim() : "", deps: [] };
    tasks.push(t);
    raw.push(c.pred >= 0 ? r[c.pred] || "" : "");
    if (c.id >= 0 && (r[c.id] || "").trim()) byKey.set(r[c.id].trim(), tasks.length);
  }
  // predecessors: by the file's IDs if it has them, else by row number
  const renum = (txt) => String(txt).replace(/(^|[;,]\s*)(\d+)/g, (m, a, num) => a + (byKey.size ? (byKey.get(num) || num) : num));
  const bad = [];
  tasks.forEach((t, i) => {
    if (!raw[i].trim()) return;
    const p = parseDeps(renum(raw[i]), tasks, t.id, perWeek);
    if (p.error) bad.push(`${t.name}: ${p.error}`); else t.deps = p.deps;
  });
  return { tasks, warnings: bad };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* "5/6/2019", "05-Jun-19", "Wed 5/6/19", "6 Jun 2019" -> iso (day first, as in Hong Kong) */
export function isoFromText(s) {
  s = String(s || "").replace(/^[A-Za-z]{3,}\s+/, "").trim();
  let m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return dayOf(`${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`) !== null ? `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` : "";
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return "";
}
