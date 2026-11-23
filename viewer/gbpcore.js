/* The GBP workbook's calculations (Codes > GBP workbook): plain functions
 * of the inputs and the code tables (gbptables.js), with no page or server
 * in them - so they are tested on their own (tests/gbpcore.test.mjs) and
 * every number on the page can be traced.
 *
 *   site(...)        Cap. 123F First Schedule: permitted SC % and PR -> areas
 *   gfa(...)         GFA per floor (outline - deducted), APP-151 concessions,
 *                    the 10% overall cap and item limits
 *   siteCoverage()   actual site coverage from the SC-* areas
 *   occupancy(...)   FS Code Table B1 -> occupant load of each room
 *   exitsFor(n)      Table B2 for an occupant capacity
 *   checkExits(...)  required vs provided exits and widths (B7.1, B7.3, B8.1)
 *   discharge(...)   storeys -> each staircase's share -> discharge value vs
 *                    Table B3/B4 capacity (B12.1-B12.7)
 * Statuses: "ok", "fail", "check" (needs a person: no value, or beyond
 * the table), "na".
 */

import { FIRST_SCHEDULE, B1, B2, B3, B4, B5, STAIR_BANDS, STAIR_FACTORS, APP151, CAP_PCT, ITEM_LIMITS, TRAVEL, STAIR_SEPARATION } from "./gbptables.js";

const EPS = 1e-9;
export const r3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
// a whole number of persons: never short of the area (91.016 -> 92), and a
// value that is whole but for floating point stays (8.0000000001 -> 8)
export const ceilPersons = (x) => Math.ceil((Number(x) || 0) - 1e-7);

/* The value of a Revit parameter as text ("9.000 m²", "Yes", "120") */
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const m = /-?\d[\d,]*(\.\d+)?|-?\.\d+/.exec(String(v == null ? "" : v));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return isFinite(n) ? n : null;
}
export function yes(v) {
  if (typeof v === "boolean") return v;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y" || s === "✓";
}

/* ------------------------------------------------------------ site, PR, SC */

export function band(height) {
  const h = Number(height);
  if (!isFinite(h) || h <= 0) return null;
  return FIRST_SCHEDULE.find((b) => h > b.over + EPS * 0 && (b.upto == null || h <= b.upto + EPS)) || null;
}

/* inputs: {area (m2), cls "A"|"B"|"C", kind "domestic"|"non-domestic"|
   "composite", height (m) or street_low / street_high / roof (mPD)} */
export function site(inp) {
  const i = inp || {};
  const area = Number(i.area) || 0;
  const mean = isFinite(Number(i.street_low)) && isFinite(Number(i.street_high)) && i.street_low !== "" && i.street_high !== ""
    && i.street_low != null && i.street_high != null ? (Number(i.street_low) + Number(i.street_high)) / 2 : null;
  const height = i.height != null && i.height !== "" ? Number(i.height)
    : mean != null && i.roof != null && i.roof !== "" ? Number(i.roof) - mean : null;
  const k = { A: 0, B: 1, C: 2 }[String(i.cls || "").toUpperCase()];
  const b = band(height);
  const out = { area, cls: i.cls || "", kind: i.kind || "non-domestic", mean: mean == null ? null : r3(mean), height: height == null ? null : r3(height), band: b ? b.label : "" };
  if (!b || k == null) { out.status = "check"; out.why = !b ? "Give the building height (or the street levels and the roof level)." : "Choose the class of site."; return out; }
  out.dom = { sc: b.dsc[k], pr: b.dpr[k], sc_area: r3(area * b.dsc[k] / 100), gfa: r3(area * b.dpr[k]) };
  out.non = { sc: b.nsc[k], pr: b.npr[k], sc_area: r3(area * b.nsc[k] / 100), gfa: r3(area * b.npr[k]) };
  const use = out.kind === "domestic" ? out.dom : out.non;
  out.sc = use.sc; out.pr = use.pr; out.sc_area = use.sc_area; out.gfa = use.gfa;
  out.status = "ok";
  return out;
}

/* Composite building (B(P)R reg 21): the domestic and non-domestic parts
   together, each as a share of what it may have, add to no more than 1. */
export function compositeIndex(s, domGfa, nonGfa, domSc, nonSc) {
  if (!s || !s.dom || !s.non || !s.area) return null;
  const pr = (domGfa || 0) / (s.dom.gfa || 1) + (nonGfa || 0) / (s.non.gfa || 1);
  const sc = (domSc || 0) / (s.dom.sc_area || 1) + (nonSc || 0) / (s.non.sc_area || 1);
  return { pr: Math.round(pr * 10000) / 10000, sc: Math.round(sc * 10000) / 10000, ok_pr: pr <= 1 + EPS, ok_sc: sc <= 1 + EPS };
}

/* ------------------------------------------------------------------- areas
   area rows: {level, name, number, type (Area-Type key), deduct (bool), area}
   GFA-D0 / GFA-ND0: domestic / non-domestic GFA outline; GFA-Cn: a concession
   item n of APP-151 (deducted); SC-D0 / SC-ND0: site coverage outline,
   SC-D1/2, SC-ND1/2: deducted; FC-0 / FC-1: fire compartment, deducted. */
export function itemOf(type) {
  const m = /^GFA-C(\d+A?(?:\.\d+)?)$/i.exec(String(type || "").trim());
  return m ? m[1].toUpperCase() : null;
}

export function gfa(rows, opts) {
  const o = opts || {};
  const levels = new Map();
  const lv = (k) => { if (!levels.has(k)) levels.set(k, { level: k, outline: 0, deduct: 0, gfa: 0, dom: 0, non: 0, rows: [], deducts: [] }); return levels.get(k); };
  const items = new Map();
  for (const r of rows || []) {
    const t = String(r.type || "").toUpperCase();
    if (!t.startsWith("GFA")) continue;
    const a = Number(r.area) || 0;
    const L = lv(r.level || "");
    L.outline += a;
    const it = itemOf(t);
    if (r.deduct || it) {
      L.deduct += a;
      L.deducts.push(r);
      if (it) {
        if (!items.has(it)) items.set(it, { item: it, area: 0, levels: {} });
        const x = items.get(it);
        x.area += a;
        x.levels[L.level] = (x.levels[L.level] || 0) + a;
      }
    } else {
      L.rows.push(r);
      if (t.includes("-D")) L.dom += a; else L.non += a;
    }
  }
  const list = [...levels.values()].map((L) => Object.assign(L, { outline: r3(L.outline), deduct: r3(L.deduct), gfa: r3(L.outline - L.deduct), dom: r3(L.dom), non: r3(L.non) }));
  const total = r3(list.reduce((s, L) => s + L.gfa, 0));
  const dom = r3(list.reduce((s, L) => s + L.dom, 0)), non = r3(list.reduce((s, L) => s + L.non, 0));
  // APP-151: the items, which count towards the 10% overall cap
  const conc = [...items.values()].map((x) => {
    const row = APP151.find((a) => a.item === x.item) || { item: x.item, text: "(not an APP-151 item)", cap: false, pre: false, pn: "" };
    return Object.assign({}, row, { area: r3(x.area), levels: x.levels });
  }).sort((a, b) => parseFloat(a.item) - parseFloat(b.item) || String(a.item).localeCompare(String(b.item)));
  const capped = r3(conc.filter((c) => c.cap).reduce((s, c) => s + c.area, 0));
  const capPct = o.cap_pct != null ? Number(o.cap_pct) : CAP_PCT;
  const capAllowed = r3(total * capPct / 100);
  // limits on single items, floor by floor (AHU room <= 4% of that floor's GFA ...)
  const limits = [];
  for (const lim of o.limits || ITEM_LIMITS) {
    for (const L of list) {
      const x = items.get(lim.item);
      const have = x ? r3(x.levels[L.level] || 0) : 0;
      if (!have) continue;
      const allowed = r3(L.gfa * lim.pct_of_floor_gfa / 100);
      limits.push({ item: lim.item, label: lim.label, level: L.level, area: have, allowed, status: have <= allowed + EPS ? "ok" : "fail", verify: lim.verify });
    }
  }
  const out = { levels: list, total, dom, non, concessions: conc, capped, cap_pct: capPct, cap_allowed: capAllowed,
    cap_status: capped <= capAllowed + EPS ? "ok" : "fail", limits };
  if (o.permitted != null) { out.permitted = r3(o.permitted); out.status = total <= o.permitted + EPS ? "ok" : "fail"; }
  return out;
}

export function siteCoverage(rows, permitted) {
  let cov = 0, ded = 0;
  const used = [];
  for (const r of rows || []) {
    const t = String(r.type || "").toUpperCase();
    if (!t.startsWith("SC")) continue;
    const a = Number(r.area) || 0;
    const deducted = !!r.deduct || /^SC-N?D[12]$/.test(t);
    if (deducted) ded += a; else cov += a;
    used.push(Object.assign({}, r, { deducted }));
  }
  const actual = r3(cov);
  const out = { rows: used, outline: r3(cov + ded), deduct: r3(ded), actual };
  if (permitted != null) { out.permitted = r3(permitted); out.status = actual <= permitted + EPS ? "ok" : "fail"; }
  return out;
}

/* --------------------------------------------------------------- occupancy
   room rows: {level, number, name, area (UFA m2), key (Use Classification),
   by_number (persons, for rooms counted by number), factor (an override)} */
export function b1(key, extra) {
  const k = String(key || "").trim();
  return (extra || []).find((x) => x.key === k) || B1.find((x) => x.key === k) || null;
}

export function occupancy(rooms, extra) {
  return (rooms || []).map((r) => {
    const t = b1(r.key, extra);
    const factor = r.factor != null && r.factor !== "" ? Number(r.factor) : t ? t.factor : null;
    const byNum = r.by_number != null && r.by_number !== "" ? Number(r.by_number) : null;
    let load = null, how = "", status = "ok", why = "";
    if (byNum != null && (factor == null || r.prefer_number)) { load = Math.max(0, Math.round(byNum)); how = "by number"; }
    else if (factor) {
      const a = Number(r.area) || 0;
      if (t && t.cls === "8" && a <= 100 + EPS) { load = 0; how = "class 8, net area 100 m2 or less (Table B1 note 7)"; }
      else { load = ceilPersons(a / factor); how = `${r3(a)} / ${factor}`; }
    } else {
      status = "check";
      why = !r.key ? "No Use Classification" : !t ? `Use Classification "${r.key}" is not in Table B1 - add it, or give a factor` : `${t.by || "By number"}: give the number of persons`;
    }
    return Object.assign({}, r, { cls: t ? t.cls : "", use: t ? t.use : "", factor: factor || null, load, how, status, why });
  });
}

export function exitsFor(load) {
  const n = Number(load) || 0;
  if (n <= 3) return { none: true, n: 0, why: "3 persons or fewer: Table B2 does not apply (Clause B7.1)" };
  if (n > 3000) return { beyond: true, n: null, why: "More than 3000 persons: to be determined by the Building Authority (Table B2)" };
  return Object.assign({}, B2.find((b) => n >= b.from && n <= b.to));
}

// B7.3 / B8.1(b): a door or route wider than 1.5 x the narrowest in the
// group counts as 1.5 x the narrowest towards the total width
export function effectiveTotal(widths) {
  const w = (widths || []).map(Number).filter((x) => x > 0);
  if (!w.length) return 0;
  const lo = Math.min(...w);
  return w.reduce((s, x) => s + Math.min(x, lo * 1.5), 0);
}

/* required vs provided, for a room (doors) or a storey (routes). prov:
   {n, widths: [mm] (or total + least)}; storey: at least 2 exit routes
   (B8.1) unless the building may have one required staircase (B6.1). */
export function checkExits(load, prov, opts) {
  const o = opts || {};
  const req = exitsFor(load);
  const out = { load, req, items: [] };
  if (req.none || req.beyond) { out.status = req.beyond ? "check" : "na"; return out; }
  const kind = o.storey ? "route" : "door";
  const nReq = o.storey && !o.single_stair ? Math.max(2, req.n) : req.n;
  const totReq = o.storey ? req.routes : req.doors;
  const eachReq = o.storey ? req.route : req.door;
  out.need = { n: nReq, total: totReq, each: eachReq };
  const p = prov || {};
  const widths = (p.widths || []).map(Number).filter((x) => x > 0);
  const n = p.n != null && p.n !== "" ? Number(p.n) : widths.length || null;
  const least = widths.length ? Math.min(...widths) : p.least != null && p.least !== "" ? Number(p.least) : null;
  const total = widths.length ? effectiveTotal(widths) : p.total != null && p.total !== "" ? Number(p.total) : null;
  out.prov = { n, total, least, counted_total: widths.length ? total : null };
  const st = (have, need) => (have == null ? "check" : have + EPS >= need ? "ok" : "fail");
  out.items.push({ what: `Number of exit ${kind}s`, need: nReq, have: n, status: st(n, nReq) });
  if (totReq) out.items.push({ what: `Total width of exit ${kind}s (mm)`, need: totReq, have: total, status: st(total, totReq), note: widths.length && total < widths.reduce((s, x) => s + x, 0) ? "wider ones counted at 1.5 x the narrowest (B7.3 / B8.1(b))" : "" });
  out.items.push({ what: `Width of each exit ${kind} (mm)`, need: eachReq, have: least, status: st(least, eachReq) });
  out.status = out.items.some((x) => x.status === "fail") ? "fail" : out.items.some((x) => x.status === "check") ? "check" : "ok";
  return out;
}

/* ------------------------------------------------------ staircase discharge */

// the capacity of one required staircase, Table B3/B4 (B12.3-B12.7)
export function stairCapacity(width, storeys, opts) {
  const o = opts || {};
  const w = Number(width) || 0, n = Math.round(Number(storeys) || 0);
  if (w < 1050 || n < 1) return { value: null, status: "check", why: w < 1050 ? "Narrower than 1050 mm: not in Table B3/B4" : "No storeys served" };
  const T = o.sprinkler ? B4 : B3;
  const at = (col) => (n <= 10 ? T.rows[n - 1][col] : T.rows[9][col] + (n - 10) * T.add[col]);
  let value, note = "";
  if (w < 1800) {
    let col = 0;
    for (let i = 0; i < STAIR_BANDS.length; i++) if (w >= STAIR_BANDS[i]) col = i;
    value = at(col);
  } else {
    // wider than the table: linear projection from its last two bands (Note 1)
    const a = at(4), b = at(5);
    value = Math.floor(b + (w - 1700) / 100 * (b - a));
    note = "projected beyond 1800 mm (Note 1 to Table B3/B4) - check";
  }
  let f = 1;
  if (o.up) f *= STAIR_FACTORS.up;
  if (o.scissors) f *= STAIR_FACTORS.scissors;
  if (f !== 1) { value = Math.floor(value * f); note = (note ? note + "; " : "") + `x ${f} (${[o.up ? "exit upwards B12.6" : "", o.scissors ? "scissors B12.7" : ""].filter(Boolean).join(", ")})`; }
  return { value, table: o.sprinkler ? "B4" : "B3", note, status: note.includes("check") ? "check" : "ok" };
}

/* storeys: [{level, capacity, stairs: [marks], ground (bool), basement}]
   stairs: [{mark, width, sprinkler, up, scissors}]. Each storey above the
   ground storey shares its occupant capacity between the staircases it
   uses (the first ones take capacity / n rounded, the last the rest, as
   the office's level schedule does); a staircase's discharge value is the
   sum of its shares, against its capacity from Table B3/B4 for the storeys
   it serves. B12.1: the staircases together take every storey above the
   ground storey (B12.2: the basements, the same). */
export function discharge(storeys, stairs, opts) {
  const o = opts || {};
  const marks = new Map((stairs || []).map((s) => [String(s.mark), Object.assign({ shares: [], value: 0, served: 0 }, s)]));
  const rows = [];
  for (const L of storeys || []) {
    const cap = Math.max(0, Math.round(Number(L.capacity) || 0));
    const use = (L.stairs || []).map(String).filter((m) => marks.has(m));
    const row = { level: L.level, capacity: cap, stairs: use, shares: {}, ground: !!L.ground, basement: !!L.basement };
    if (!L.ground && use.length) {
      const each = Math.round(cap / use.length);
      let left = cap;
      use.forEach((m, i) => {
        const s = i < use.length - 1 ? Math.min(each, left) : left;
        left -= s;
        row.shares[m] = s;
        const st = marks.get(m);
        st.value += s; st.served += 1; st.shares.push({ level: L.level, persons: s });
      });
    }
    rows.push(row);
  }
  const list = [...marks.values()].map((s) => {
    const served = s.storeys != null && s.storeys !== "" ? Number(s.storeys) : s.served;
    const c = stairCapacity(s.width, served, { sprinkler: s.sprinkler != null ? !!s.sprinkler : !!o.sprinkler, up: !!s.up, scissors: !!s.scissors });
    const status = c.value == null ? "check" : s.value <= c.value ? (c.status === "check" ? "check" : "ok") : "fail";
    return Object.assign(s, { served, capacity: c.value, table: c.table, note: c.note, status });
  });
  const above = rows.filter((r) => !r.ground && !r.basement), below = rows.filter((r) => r.basement);
  const sum = (rs) => rs.reduce((t, r) => t + r.capacity, 0);
  const capOf = (rs) => list.filter((s) => rs.some((r) => r.stairs.includes(String(s.mark)))).reduce((t, s) => t + (s.capacity || 0), 0);
  const total = { above: sum(above), capacity: capOf(above), basement: sum(below), basement_capacity: capOf(below) };
  total.status = total.capacity >= total.above && (!below.length || total.basement_capacity >= total.basement) ? "ok" : "fail";
  const unshared = rows.filter((r) => !r.ground && r.capacity && !r.stairs.length).map((r) => r.level);
  return { storeys: rows, stairs: list, total, unshared, status: list.some((s) => s.status === "fail") || total.status === "fail" ? "fail" : list.some((s) => s.status === "check") || unshared.length ? "check" : "ok" };
}

/* the storeys' occupant capacity from the rooms' loads, by level */
export function storeyLoads(rooms) {
  const by = new Map();
  for (const r of rooms || []) {
    if (r.load == null) continue;
    by.set(r.level || "", (by.get(r.level || "") || 0) + r.load);
  }
  return by;
}

export function worst(statuses) {
  const s = (statuses || []).filter(Boolean);
  return s.includes("fail") ? "fail" : s.includes("check") ? "check" : s.length && s.every((x) => x === "na") ? "na" : s.length ? "ok" : "check";
}

/* ---------------------------------------------------------- Quick check
   Composite building (B(P)R reg 21) on the quick page: the non-domestic
   part's plot ratio uses a share of what it may have; the domestic part
   gets the rest. s: site(...) of the building ({dom, non, area}). */
export function compositePr(s, nonPr) {
  if (!s || !s.dom || !s.non) return null;
  const nMax = s.non.pr, dMax = s.dom.pr, area = s.area || 0;
  const n = Math.max(0, Math.min(nMax, Number(nonPr) || 0));
  const share = nMax ? n / nMax : 0;
  const domPr = Math.round(dMax * (1 - share) * 1000) / 1000;
  const nonGfa = r3(n * area), domGfa = r3(dMax * (1 - share) * area);     // the GFA from the exact share
  return { nonPr: n, nonMax: nMax, domMax: dMax, share, domPr, nonGfa, domGfa, total: r3(nonGfa + domGfa) };
}

/* floors -> persons -> the required staircases share them evenly
   (B12.1): rows [{floors: n, key, area, persons (typed)}],
   opts {stairs: n, width: mm, sprinkler, extra (own B1 keys)}. */
export function quickStairs(rows, opts) {
  const o = opts || {};
  const out = { rows: [], storeys: 0, total: 0, per: 0, maxFloor: 0 };
  for (const r of rows || []) {
    const n = Math.max(1, Math.round(Number(r.floors) || 1));
    const t = b1(r.key, o.extra);
    const typed = r.persons != null && r.persons !== "" ? Math.max(0, Math.round(Number(r.persons))) : null;
    const each = typed != null ? typed : t && t.factor ? ceilPersons((Number(r.area) || 0) / t.factor) : null;
    out.rows.push(Object.assign({}, r, { floors: n, factor: t ? t.factor : null, use: t ? t.use : "", each, sum: each == null ? null : each * n }));
    out.storeys += n;
    if (each != null) { out.total += each * n; out.maxFloor = Math.max(out.maxFloor, each); }
  }
  const k = Math.max(1, Math.round(Number(o.stairs) || 2));
  out.stairs = k;
  out.per = Math.ceil(out.total / k);
  const cap = stairCapacity(o.width || 1050, out.storeys, { sprinkler: !!o.sprinkler });
  out.capacity = cap.value;
  out.table = cap.table;
  out.note = cap.note || cap.why || "";
  out.status = cap.value == null ? "check" : out.per <= cap.value ? "ok" : "fail";
  // the least width that would take it, with this many staircases
  out.suggest = null;
  for (const w of STAIR_BANDS) {
    const c = stairCapacity(w, out.storeys, { sprinkler: !!o.sprinkler });
    if (c.value != null && out.per <= c.value) { out.suggest = { width: w, capacity: c.value }; break; }
  }
  return out;
}

/* ------------------------------------------------------- travel distance
   the B11 limits for a Use Classification ("1b", "2", "3a", "4a" ...) */
export function travelGroup(cls) {
  const c = String(cls || "").toLowerCase();
  return /^[12]/.test(c) ? "1-2" : /^3/.test(c) ? "3" : "other";
}
export function travelFor(cls, opts) {
  const o = opts || {};
  const g = travelGroup(cls), t = TRAVEL[g];
  return { group: g, label: t.label, balcony: !!o.balcony, within: t.within, deadend: o.balcony ? t.deadend_balcony : t.deadend,
    max: o.balcony ? t.max_balcony : t.max, between: STAIR_SEPARATION, refs: t.refs };
}
// the distances of a design (m) against the limits: {within, deadend, max, between}
export function checkTravel(rule, given) {
  const g = given || {}, items = [];
  const one = (k, what, lim, ref) => {
    if (lim == null) return;
    const v = g[k] == null || g[k] === "" ? null : Number(g[k]);
    items.push({ key: k, what, limit: lim, have: v, ref, status: v == null ? "check" : v <= lim + EPS ? "ok" : "fail" });
  };
  one("within", "Within the flat / guestroom to its door", rule.within, rule.refs.within);
  one("deadend", rule.group === "1-2" ? "Door to the staircase (dead end)" : "Dead end", rule.deadend, rule.refs.deadend);
  one("max", "Maximum travel distance", rule.max, rule.refs.max);
  one("between", "Between required staircases", rule.between, "B11.3(b)");
  const given_ = items.filter((x) => x.have != null);
  return { items, status: !given_.length ? "check" : given_.some((x) => x.status === "fail") ? "fail" : given_.length < items.length ? "check" : "ok" };
}
// Table B5: Use Classification 5a at 12 m or more above G/F (B21.1)
export function exitsFor5a(load) {
  const n = Number(load) || 0;
  if (n <= 30) return Object.assign(exitsFor(n), { b5: false });
  if (n > 3000) return { beyond: true, n: null, why: "More than 3000 persons: to be determined by the Building Authority (Table B5)" };
  const r = B5.find((b) => n >= b.from && n <= b.to);
  return { n: r.n, routes: r.routes, doors: null, route: null, door: null, b5: true };
}

/* GFA concessions on the quick page (PNAP APP-151 para 4-5, Appendix A):
   one area per feature (m2) -> those under the 10% overall cap against
   10% of the total GFA; the others listed apart. items: {item: area} */
export function quickCap(items, total) {
  const T = Number(total) || 0;
  const rows = [];
  let capped = 0, uncapped = 0, pre = 0;
  for (const a of APP151) {
    const v = Number((items || {})[a.item]);
    if (!(v > 0)) continue;
    rows.push(Object.assign({}, a, { area: r3(v) }));
    if (a.cap) capped += v; else uncapped += v;
    if (a.pre) pre++;
  }
  const cap = r3(T * CAP_PCT / 100);
  const share = cap ? capped / cap : 0;
  return { rows, capped: r3(capped), uncapped: r3(uncapped), cap, pct: CAP_PCT, share, pre, total: T,
    status: !T ? "check" : capped <= cap + EPS ? "ok" : "fail" };
}
