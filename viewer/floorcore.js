/* Site study, stage 4: a typical floor - the units of a massing group's
 * unit mix along a double-loaded corridor, a core of staircases (Table B3
 * via the GBP workbook's quick staircase check), lifts sized by a round-trip
 * time (CIBSE Guide D method), a refuse room and an E&M riser; what is left
 * of the floor plate is the residual (taken as E&M, exempt - to be checked).
 * Pure functions: no DOM.
 *
 * The plate frame: x along the corridor (0 .. L), y across it (0 .. D),
 * the corridor from y0 to y1; the north band (0 .. y0) and the south band
 * (y1 .. D). Every unit stands with its entrance on the corridor and its
 * façade outward.
 */
import * as U from "./unitcore.js";
import { quickStairs, travelFor } from "./gbpcore.js";

const r3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
const n = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

export const DEF = {
  corridor: 1.5,        // m, clear width (B(P)R / MoE: at least 1.05 m for a route)
  wideBase: 1.5,        // JPN 1 wider common corridor: the part wider than this ...
  wideMax: 2.4,         // ... up to this width is exempt (check against JPN 1)
  stairs: 2, stairWidth: 1200,  // mm
  persons: 3,           // persons a flat, for the lifts
  hc5: 6,               // % of the population in 5 minutes (CIBSE Guide D: residential 5-7%)
  interval: 60,         // s, the longest average interval
  car: 13,              // persons (1000 kg)
  storeyH: 3.15,
  refuse: [1.6, 2.0],   // refuse storage and material recovery room (APP-151 item 2.1)
  riser: [1.6, 1.2],    // E&M riser / meter room (items 2.2, 21)
  lift: [2.3, 2.5],     // a shaft, along x and across
  core: "middle",       // middle | ends
  mic: false, micPct: 10, // JPN 8 (check the % in force)
};

/* the plate's long axis: the oriented rectangle of the least area */
export function frame(poly) {
  const P = (poly || []).filter((p) => p && p.length >= 2);
  if (P.length < 3) return null;
  let best = null;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const us = P.map((p) => p[0] * ux + p[1] * uy), vs = P.map((p) => -p[0] * uy + p[1] * ux);
    const w = Math.max(...us) - Math.min(...us), h = Math.max(...vs) - Math.min(...vs);
    const o = { ux, uy, u0: Math.min(...us), v0: Math.min(...vs), L: w, D: h, area: w * h };
    if (w < h) Object.assign(o, { ux: -uy, uy: ux, u0: Math.min(...vs), v0: Math.min(...us.map((q) => -q)), L: h, D: w });
    if (!best || o.area < best.area - 1e-6) best = o;
  }
  if (!best) return null;
  const { ux, uy, u0, v0 } = best;
  best.to = ([x, y]) => [x * ux + y * uy - u0, -x * uy + y * ux - v0];
  best.from = ([u, v]) => [(u + u0) * ux - (v + v0) * uy, (u + u0) * uy + (v + v0) * ux];
  best.poly = P.map(best.to);
  return best;
}

/* a unit turned by k quarter turns (y down: east goes to south), its rooms,
   extras, doors and windows' rooms kept; back at (0, 0) */
export function turn(u, k) {
  const q = ((k % 4) + 4) % 4;
  const rot = ([x, y]) => { let p = [x, y]; for (let i = 0; i < q; i++) p = [-p[1], p[0]]; return p; };
  const box = (r) => { const a = rot([n(r.x), n(r.y)]), b = rot([n(r.x) + n(r.w), n(r.y) + n(r.h)]); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; };
  const rooms = (u.rooms || []).map((r) => Object.assign({}, r, box(r)));
  const extras = U.expandBays(u.extras || []).map((e) => Object.assign({}, e, box(e)));
  const all = [...rooms, ...extras];
  const mx = Math.min(...all.map((r) => r.x)), my = Math.min(...all.map((r) => r.y));
  for (const r of all) { r.x = r3(r.x - mx); r.y = r3(r.y - my); r.w = r3(r.w); r.h = r3(r.h); }
  const W = Math.max(...all.map((r) => r.x + r.w)), D = Math.max(...all.map((r) => r.y + r.h));
  return { rooms, extras, W: r3(W), D: r3(D) };
}
/* the side the entrance is on (the corridor side), else opposite the façade */
export function entrySide(u) {
  const d = (u.doors || []).find((q) => q.entry) || (u.doors || []).find((q) => { const r = (u.rooms || []).find((x) => x.id === q.room); return r && r.kind === "LOBBY"; });
  if (d) return d.side;
  return { s: "n", n: "s", e: "w", w: "e" }[u.facade || "s"] || "n";
}
const TO_N = { n: 0, w: 1, s: 2, e: 3 }; // quarter turns that bring a side to the north

/* lifts by a round-trip time: floors served above the main lobby, the
   population, the car, the speed by the travel. CIBSE Guide D:
   S = N (1 - (1 - 1/N)^P), H = N - sum (i/N)^P, RTT = 2 H tv + (S + 1) ts + 2 P tp */
export function lifts(o) {
  const N = Math.max(1, Math.round(n(o.floors, 1))), pop = Math.max(0, n(o.population));
  const P = n(o.car, 13) * 0.8, hS = n(o.storeyH, 3.15), travel = N * hS;
  const v = travel <= 45 ? 1.75 : travel <= 75 ? 2.5 : travel <= 120 ? 3.5 : 5;
  const S = N * (1 - Math.pow(1 - 1 / N, P));
  let H = N; for (let i = 1; i < N; i++) H -= Math.pow(i / N, P);
  const tv = hS / v, ts = 10, tp = 1.2;
  const rtt = 2 * H * tv + (S + 1) * ts + 2 * P * tp;
  const hcEach = 300 * P / rtt, need = pop * n(o.hc5, 6) / 100;
  const byHc = Math.ceil(need / hcEach - 1e-9), byInt = Math.ceil(rtt / n(o.interval, 60) - 1e-9);
  const k = Math.max(travel > 30 ? 2 : 1, byHc, byInt, 1);
  return { n: k, rtt: Math.round(rtt), interval: Math.round(rtt / k), hc5: r3(k * hcEach / (pop || 1) * 100), speed: v, travel: r3(travel), stops: r3(S), reversal: r3(H), byHc, byInt, population: pop, P: r3(P) };
}

/* the layout. o: {poly (xy), mix: [{u (a unit), n}], storeys, floorsAbove,
   and any of DEF}. Returns the pieces in the plate frame, the figures and
   the checks. */
export function layout(o) {
  const p = Object.assign({}, DEF, o || {});
  const F = frame(p.poly);
  if (!F) return null;
  const L = F.L, D = F.D, cw = n(p.corridor, 1.5);
  // the units, in the order of the mix, turned to face out
  const want = [];
  for (const m of p.mix || []) for (let i = 0; i < Math.max(0, Math.round(n(m.n))); i++) want.push(m.u);
  // an edited floor: the units along each side in order ({u: name, m: mirrored}), else laid out from the mix
  const byName = new Map([...(p.lib || []).map((u) => [u.name, u]), ...(p.mix || []).map((m) => [m.u.name, m.u])]);
  const SEQ = p.seq && (Array.isArray(p.seq.s) || Array.isArray(p.seq.n)) ? { s: (p.seq.s || []).filter((e) => byName.has(e.u)), n: (p.seq.n || []).filter((e) => byName.has(e.u)) } : null;
  const mirrors = new Map(), unitOf = (e) => { const u = byName.get(e.u); if (!e.m) return u; if (!mirrors.has(u)) mirrors.set(u, U.mirrorUnit(u)); return mirrors.get(u); };
  let note = "";
  if (SEQ) {
    const cnt = (list) => { const c = {}; for (const e of list) c[e.u] = (c[e.u] || 0) + 1; return c; };
    const a = cnt([...SEQ.s, ...SEQ.n]), b = cnt(want.map((u) => ({ u: u.name })));
    if ([...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => (a[k] || 0) !== (b[k] || 0))) note = "The edited floor differs from the unit mix";
    want.length = 0; for (const e of [...SEQ.s, ...SEQ.n]) want.push(unitOf(e));
  }
  const f0 = new Map();
  const figOf = (u) => { if (!f0.has(u)) f0.set(u, U.figures(u)); return f0.get(u); };
  const deep = want.length ? Math.max(...want.map((u) => turn(u, TO_N[entrySide(u)] || 0).D)) : (D - cw) / 2;
  // the corridor in the middle; when the plate is too shallow for the deepest unit on both sides, moved so one side takes it
  const half = (D - cw) / 2;
  const y0 = r3(Math.max(0, half >= deep || D - cw < deep ? half : D - cw - deep)), y1 = r3(y0 + cw);
  const dN = y0, dS = D - y1;
  // the core on the north band
  const sw = n(p.stairWidth, 1200) / 1000, stW = r3(2 * sw + 0.1 + 0.3), stD = r3(Math.min(dN, 2 * sw + 2.0 + 0.3));
  const fl = { flats: want.length };
  const lf = lifts({ floors: n(p.floorsAbove, n(p.storeys, 1)), population: want.length * n(p.storeys, 1) * n(p.persons, 3), car: p.car, storeyH: p.storeyH, hc5: p.hc5, interval: p.interval });
  const nL = Math.max(1, Math.round(n(p.lifts, 0)) || lf.n), nS = Math.max(1, Math.round(n(p.stairs, 2)));
  const core = [];
  const put = (kind, w, d, label) => core.push({ kind, w: r3(w), h: r3(Math.min(d, dN)), label });
  const mid = [];
  for (let i = 0; i < nL; i++) mid.push(["lift", p.lift[0], p.lift[1], "Lift " + (i + 1)]);
  mid.push(["refuse", p.refuse[0], p.refuse[1], "Refuse"], ["riser", p.riser[0], p.riser[1], "E&M riser"]);
  const stairs = Array.from({ length: nS }, (_, i) => ["stair", stW, stD, "Stair " + String.fromCharCode(65 + i)]);
  let xs = [];
  if (p.core === "ends" && nS >= 2) {
    const midW = mid.reduce((s, q) => s + q[1], 0);
    let x = 0; const a = stairs[0]; core.push({ kind: a[0], x: 0, w: a[1], h: Math.min(a[2], dN), label: a[3] }); xs.push(a[1] / 2);
    const b = stairs[1]; core.push({ kind: b[0], x: r3(L - b[1]), w: b[1], h: Math.min(b[2], dN), label: b[3] }); xs.push(L - b[1] / 2);
    x = (L - midW) / 2;
    for (const q of mid) { core.push({ kind: q[0], x: r3(x), w: q[1], h: Math.min(q[2], dN), label: q[3] }); x += q[1]; }
    for (const q of stairs.slice(2)) { core.push({ kind: q[0], x: r3(x), w: q[1], h: Math.min(q[2], dN), label: q[3] }); xs.push(x + q[1] / 2); x += q[1]; }
  } else {
    const seq = [stairs[0], ...mid, ...stairs.slice(1)];
    const tot = seq.reduce((s, q) => s + q[1], 0);
    let x = (L - tot) / 2;
    for (const q of seq) { core.push({ kind: q[0], x: r3(x), w: q[1], h: Math.min(q[2], dN), label: q[3] }); if (q[0] === "stair") xs.push(x + q[1] / 2); x += q[1]; }
  }
  void put;
  for (const c of core) c.y = r3(y0 - c.h);
  // free runs along each band
  const runs = [];
  const busy = core.map((c) => [c.x, c.x + c.w]).sort((a, b) => a[0] - b[0]);
  let x = 0;
  for (const [a, b] of busy) { if (a - x > 0.3) runs.push({ band: "n", x0: x, x1: a }); x = Math.max(x, b); }
  if (L - x > 0.3) runs.push({ band: "n", x0: x, x1: L });
  runs.unshift({ band: "s", x0: 0, x1: L });
  const inside = (q) => {
    const pts = [[q.x + 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + q.h - 0.05], [q.x + 0.05, q.y + q.h - 0.05]];
    return pts.every(([px, py]) => inPoly(F.poly, px, py));
  };
  const placed = [], left = [];
  // each side: its runs, taken from the left end (and with corner units from the right end too, alternately)
  const sides = { s: runs.filter((r) => r.band === "s").map((r) => ({ l: r.x0, r: r.x1 })), n: runs.filter((r) => r.band === "n").map((r) => ({ l: r.x0, r: r.x1 })) };
  const depth = { s: dS, n: dN };
  const tOf = (u, band) => turn(u, (TO_N[entrySide(u)] || 0) + (band === "n" ? 2 : 0));
  const cursor = { s: { i: 0, j: sides.s.length - 1 }, n: { i: 0, j: sides.n.length - 1 } };
  // put a unit of width W at the current run of this end; null when no run of that end has room
  const take = (band, end, t, probe) => {
    const R = sides[band], c = cursor[band];
    let k = end === "l" ? c.i : c.j;
    while (k >= 0 && k < R.length && (end === "l" ? k <= c.j : k >= c.i)) {
      const run = R[k];
      for (let nudge = 0; nudge < 40; nudge++) {
        const x = end === "l" ? run.l + nudge * 0.25 : run.r - t.W - nudge * 0.25;
        if (x < run.l - 1e-6 || x + t.W > run.r + 0.01) break;
        const y = band === "s" ? y1 : y0 - t.D, box = { x: r3(x), y: r3(y), w: t.W, h: t.D };
        if (!inside(box)) continue;
        if (!probe) { if (end === "l") run.l = r3(x + t.W); else run.r = r3(x); if (end === "l") c.i = k; else c.j = k; }
        return box;
      }
      if (probe) return null; // only the current run, for the best fit
      k += end === "l" ? 1 : -1;
    }
    return null;
  };
  const order = { s: 0, n: 0 };
  const placeAt = (u, band, box, t, e) => placed.push(Object.assign({ u, name: u.name, band, fig: figOf(u), si: order[band]++, m: !!(e && e.m), entry: e || { u: u.name, m: false } }, box, { rooms: t.rooms, extras: t.extras }));
  if (SEQ) {
    for (const band of ["s", "n"]) {
      SEQ[band].forEach((e, k) => {
        const u = unitOf(e), t = tOf(u, band);
        if (t.D > depth[band] + 0.05) { order[band]++; return left.push({ u, why: `${u.name || "Unit"} is ${t.D.toFixed(2)} m deep from its entrance; the ${band === "s" ? "south" : "north"} side is ${depth[band].toFixed(2)} m` }); }
        const end = p.corners && k % 2 ? "r" : "l";
        const box = take(band, end, t) || take(band, end === "l" ? "r" : "l", t);
        if (!box) { order[band]++; return left.push({ u, why: `no room left along the corridor for ${u.name || "a unit"}` }); }
        placeAt(u, band, box, t, e);
      });
    }
  } else {
    // from the mix: at each end the next unit that still fits its run (so a smaller one takes a gap)
    const rest = want.map((u) => ({ u, t: { n: tOf(u, "n"), s: tOf(u, "s") } }));
    for (const q of rest) if (q.t.s.D > dS + 0.05 && q.t.n.D > dN + 0.05) { q.gone = true; left.push({ u: q.u, why: `${q.u.name || "Unit"} is ${q.t.s.D.toFixed(2)} m deep from its entrance; the corridor leaves ${Math.max(dN, dS).toFixed(2)} m` }); }
    for (const band of ["s", "n"]) {
      const ends = p.corners ? ["l", "r"] : ["l"], done = new Set();
      let turnI = 0, guard = 0;
      while (done.size < ends.length && guard++ < 500) {
        const end = ends[turnI % ends.length]; turnI++;
        if (done.has(end)) continue;
        const c = cursor[band], k = end === "l" ? c.i : c.j;
        if (k < 0 || k >= sides[band].length || c.i > c.j) { done.add(end); continue; }
        const q = rest.find((z) => !z.gone && z.t[band].D <= depth[band] + 0.05 && take(band, end, z.t[band], true));
        if (q) { const box = take(band, end, q.t[band]); placeAt(q.u, band, box, q.t[band]); q.gone = true; continue; }
        // nothing fits this run from this end: on to the next run
        if (end === "l") c.i++; else c.j--;
        turnI--; // the same end again
        if (c.i > c.j) done.add(end);
      }
    }
    for (const q of rest) if (!q.gone) left.push({ u: q.u, why: `no room left along the corridor for ${q.u.name || "a unit"}` });
  }
  // the flats at the plate's ends: corner units, their end wall a second façade
  for (const q of placed) q.corner = q.x < 0.05 ? "w" : q.x + q.w > L - 0.05 ? "e" : "";
  const cornerFac = placed.filter((q) => q.corner).reduce((s2, q) => s2 + q.h, 0);
  const seqOut = { s: placed.filter((q) => q.band === "s").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })), n: placed.filter((q) => q.band === "n").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })) };
  // those that did not fit stay in the edited floor (listed as not placed) so it still matches the mix
  if (!SEQ) for (const q of left) seqOut.s.push({ u: q.u.name, m: false });
  // areas
  const plate = Math.abs(area(F.poly));
  const corrA = L * cw;
  const wideEx = Math.max(0, Math.min(cw, n(p.wideMax, 2.4)) - n(p.wideBase, 1.5)) * L;
  const A = (k2) => core.filter((c) => c.kind === k2).reduce((s, c) => s + c.w * c.h, 0);
  const stairA = A("stair"), liftA = A("lift"), refA = A("refuse"), riserA = A("riser");
  const unitBox = placed.reduce((s, q) => s + q.w * q.h, 0);
  const unitGfa = placed.reduce((s, q) => s + q.fig.gfa, 0), sale = placed.reduce((s, q) => s + q.fig.saleable, 0);
  const unitUfa = placed.reduce((s, q) => s + q.fig.internal, 0);
  const balEx = placed.reduce((s, q) => s + q.fig.balEx + q.fig.upEx + q.fig.acpFree + q.fig.cwEx + q.fig.pcEx + q.fig.acpCapEx, 0);
  const residual = Math.max(0, plate - unitBox - corrA - stairA - liftA - refA - riserA);
  let gfa = unitGfa + corrA - wideEx + stairA + liftA;
  const mic = p.mic ? gfa * n(p.micPct, 10) / 100 : 0;
  gfa -= mic;
  // staircases: the persons on a floor (Table B1 1b-1 with five or more flats a floor a staircase)
  const qs = quickStairs([{ floors: n(p.storeys, 1), key: placed.length / nS >= 5 ? "1b-1" : "1b-2", area: unitUfa }], { stairs: nS, width: n(p.stairWidth, 1200) });
  // travel along the corridor: each flat door (the middle of its frontage) to the nearest staircase
  const tr = travelFor("1b");
  let worst = { d: 0, dead: false, name: "" };
  const lo = Math.min(...xs), hi = Math.max(...xs);
  for (const q of placed) {
    const dx = q.x + q.w / 2, d = Math.min(...xs.map((s) => Math.abs(s - dx))) + cw / 2;
    const dead = nS < 2 || dx < lo || dx > hi;
    const lim = dead ? tr.deadend : tr.max;
    if (d / lim > worst.d / (worst.lim || 1)) worst = { d: r3(d), dead, lim, name: q.name };
  }
  const between = xs.length >= 2 ? r3(hi - lo) : null;
  const checks = [
    { what: "Staircases (Table B3, the workbook's quick check)", ok: qs.status === "ok", text: `${nS} × ${n(p.stairWidth, 1200)} mm for ${qs.total} persons over ${qs.storeys} storeys: ${qs.per} each, capacity ${qs.capacity ?? "–"}${qs.suggest ? ` · ${qs.suggest.width} mm would do` : ""}` },
    { what: "Travel: flat door to a staircase (B11)", ok: worst.d <= (worst.lim || tr.max) + 1e-9, text: placed.length ? `${worst.d} m from ${worst.name}${worst.dead ? ", in a dead end" : ""}, limit ${worst.lim || tr.max} m` : "–" },
    { what: "Lifts by service time", ok: (n(p.lifts, 0) || lf.n) >= lf.n, text: `${nL} lift${nL > 1 ? "s" : ""}: round trip ${lf.rtt} s, interval ${Math.round(lf.rtt / nL)} s, 5-min capacity ${r3(nL * 300 * lf.P / lf.rtt / (lf.population || 1) * 100)}% (needs ${lf.n})` },
    { what: "Units placed", ok: !left.length, text: `${placed.length} of ${want.length}` },
  ];
  if (between != null) checks.push({ what: "Between the staircases", ok: between <= tr.between, text: `${between} m, at most ${tr.between} m (B11.3(b))` });
  return {
    seq: SEQ ? { s: SEQ.s.map((e) => Object.assign({}, e)), n: SEQ.n.map((e) => Object.assign({}, e)) } : seqOut, edited: !!SEQ, note, cornerFac: r3(cornerFac),
    F, L: r3(L), D: r3(D), y0, y1, cw, core, placed, left, stairsX: xs.map(r3), lifts: lf, nL, nS, stairs: qs, checks,
    figures: {
      plate: r3(plate), units: placed.length, saleable: r3(sale), unitGfa: r3(unitGfa), corridor: r3(corrA), wideEx: r3(wideEx),
      stair: r3(stairA), lift: r3(liftA), refuse: r3(refA), riser: r3(riserA), residual: r3(residual), mic: r3(mic), unitEx: r3(balEx),
      gfa: r3(gfa), acc: plate ? r3(gfa / plate * 100) : null, efficiency: gfa ? r3(sale / gfa * 100) : null,
      conc: r3(plate - gfa),
    },
    deep: r3(deep), fl,
  };
}

export function area(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function inPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
