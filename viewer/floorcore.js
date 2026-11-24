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
  refuse: [1.5, 1.8],   // refuse storage and material recovery room (APP-151 item 2.1), clear
  emr: [1.4, 1.0],      // E&M riser / meter room (items 2.2, 21), clear
  lift: [2.05, 2.25],   // a shaft's clear inside, along x and across
  coreWall: 0.25,       // RC round the staircases, lifts, refuse room and riser (shared between neighbours)
  partyWall: 0.2,       // RC between units (centred on their line)
  riser: 0.175, going: 0.25,  // Code of Practice for Means of Escape: riser 175 mm at most, going 225 mm at least
  core: "middle",       // middle | ends
  mic: false, micPct: 10, // JPN 8 (check the % in force)
};

/* the plate's long axis: the oriented rectangle of the least area */
export function frame(poly, axis) {
  const P = (poly || []).filter((p) => p && p.length >= 2);
  if (P.length < 3) return null;
  let best = null;
  if (axis && Number.isFinite(axis.ux) && Number.isFinite(axis.uy)) {
    // a frame kept while the plate is edited: the same axis, so the plan does not turn
    const k = Math.hypot(axis.ux, axis.uy) || 1, ux = axis.ux / k, uy = axis.uy / k;
    const us = P.map((p) => p[0] * ux + p[1] * uy), vs = P.map((p) => -p[0] * uy + p[1] * ux);
    best = { ux, uy, u0: Math.min(...us), v0: Math.min(...vs), L: Math.max(...us) - Math.min(...us), D: Math.max(...vs) - Math.min(...vs) };
  }
  if (!best) {
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
  return { rooms, extras, W: r3(W), D: r3(D), party: n(u.party, 0.15), wall: n(u.wall, 0.1) };
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
  const F = frame(p.poly, p.frame);
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
  // a staircase from its width, the storey height, the riser and going; each core piece with its RC wall (half on each side, shared with the next)
  const sw = n(p.stairWidth, 1200) / 1000, cwl = n(p.coreWall, 0.25), SZ = stairSize({ width: sw, storeyH: p.storeyH, riser: p.riser, going: p.going });
  const stW = r3(SZ.W + cwl), stD = r3(SZ.D + cwl);
  const fl = { flats: want.length };
  const lf = lifts({ floors: n(p.floorsAbove, n(p.storeys, 1)), population: want.length * n(p.storeys, 1) * n(p.persons, 3), car: p.car, storeyH: p.storeyH, hc5: p.hc5, interval: p.interval });
  let nL = Math.max(1, Math.round(n(p.lifts, 0)) || lf.n), nS = Math.max(1, Math.round(n(p.stairs, 2)));
  const core = [];
  const put = (kind, w, d, label) => core.push({ kind, w: r3(w), h: r3(Math.min(d, dN)), label });
  const mid = [];
  for (let i = 0; i < nL; i++) mid.push(["lift", p.lift[0] + cwl, p.lift[1] + cwl, "Lift " + (i + 1)]);
  mid.push(["refuse", p.refuse[0] + cwl, p.refuse[1] + cwl, "Refuse"], ["riser", p.emr[0] + cwl, p.emr[1] + cwl, "E&M riser"]);
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
  // a core moved by hand: its pieces as stored, anywhere on the plate
  const coreAuto = core.map((c) => Object.assign({}, c));
  const coreEdited = Array.isArray(p.pieces) && p.pieces.length > 0;
  if (coreEdited) {
    core.length = 0; xs = [];
    for (const c of p.pieces) {
      const q = { kind: c.kind, label: c.label || c.kind, x: r3(n(c.x)), y: r3(n(c.y)), w: r3(Math.max(0.3, n(c.w, 1))), h: r3(Math.max(0.3, n(c.h, 1))) };
      core.push(q); if (q.kind === "stair") xs.push(q.x + q.w / 2);
    }
    nS = Math.max(1, core.filter((c) => c.kind === "stair").length); nL = Math.max(1, core.filter((c) => c.kind === "lift").length);
  }
  // free runs along each band: what the pieces standing on it leave
  const runs = [];
  const bandY = { n: [0, y0], s: [y1, D] };
  for (const band of ["s", "n"]) {
    const [ya, yb] = bandY[band];
    const busy = core.filter((c) => Math.min(c.y + c.h, yb) - Math.max(c.y, ya) > 0.05).map((c) => [c.x, c.x + c.w]).sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of busy) { if (a - x > 0.3) runs.push({ band, x0: x, x1: a }); x = Math.max(x, b); }
    if (L - x > 0.3) runs.push({ band, x0: x, x1: L });
  }
  const inside = (q) => {
    const pts = [[q.x + 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + q.h - 0.05], [q.x + 0.05, q.y + q.h - 0.05]];
    return pts.every(([px, py]) => inPoly(F.poly, px, py));
  };
  const placed = [], left = [];
  // between units the party wall: what the plans hold at their ends (half their own party wall each) less the RC wall set here
  const gapOf = (t) => r3(Math.max(0, n(p.partyWall, 0.2) - n(t.party, 0.15)));
  // each side: its runs, taken from the left end (and with corner units from the right end too, alternately)
  const sides = { s: runs.filter((r) => r.band === "s").map((r) => ({ l: r.x0, r: r.x1 })), n: runs.filter((r) => r.band === "n").map((r) => ({ l: r.x0, r: r.x1 })) };
  const depth = { s: dS, n: dN };
  const tOf = (u, band, r = 0) => turn(u, (TO_N[entrySide(u)] || 0) + (band === "n" ? 2 : 0) + Math.round(n(r) / 90));
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
        if (!probe) { if (end === "l") run.l = r3(x + t.W + gapOf(t)); else run.r = r3(x - gapOf(t)); if (end === "l") c.i = k; else c.j = k; }
        return box;
      }
      if (probe) return null; // only the current run, for the best fit
      k += end === "l" ? 1 : -1;
    }
    return null;
  };
  const order = { s: 0, n: 0 };
  const placeAt = (u, band, box, t, e, si) => placed.push(Object.assign({ u, name: u.name, band, fig: figOf(u), si: si != null ? si : order[band]++, m: !!(e && e.m), r: (e && n(e.r)) || 0, fixed: !!(e && e.x != null), entry: e || { u: u.name, m: false } }, box, { rooms: t.rooms, extras: t.extras }));
  if (SEQ) {
    // units put by hand (x given) first, where they were put; the runs keep clear of them
    for (const band of ["s", "n"]) {
      SEQ[band].forEach((e, k) => {
        if (e.x == null) return;
        const u = unitOf(e), t = tOf(u, band, e.r), x = r3(n(e.x)), y = band === "s" ? y1 : y0 - t.D;
        placeAt(u, band, { x, y: r3(y), w: t.W, h: t.D }, t, e, k);
        for (const run of sides[band]) {
          if (x + t.W <= run.l + 1e-6 || x >= run.r - 1e-6) continue;
          // split the run round it: keep the longer side in this run, the rest as a new run
          const leftPart = { l: run.l, r: Math.max(run.l, x) }, rightPart = { l: Math.min(run.r, x + t.W), r: run.r };
          Object.assign(run, leftPart.r - leftPart.l >= rightPart.r - rightPart.l ? leftPart : rightPart);
          const other = run.l === leftPart.l && run.r === leftPart.r ? rightPart : leftPart;
          if (other.r - other.l > 0.3) sides[band].push(other);
        }
        sides[band].sort((a, b) => a.l - b.l);
      });
      cursor[band] = { i: 0, j: sides[band].length - 1 };
    }
    for (const band of ["s", "n"]) {
      SEQ[band].forEach((e, k) => {
        if (e.x != null) return;
        order[band] = k;
        const u = unitOf(e), t = tOf(u, band, e.r);
        if (t.D > depth[band] + 0.05) { order[band]++; return left.push({ u, why: `${u.name || "Unit"} is ${t.D.toFixed(2)} m deep from its entrance; the ${band === "s" ? "south" : "north"} side is ${depth[band].toFixed(2)} m` }); }
        const end = p.corners && k % 2 ? "r" : "l";
        const box = take(band, end, t) || take(band, end === "l" ? "r" : "l", t);
        if (!box) { order[band]++; return left.push({ u, why: `no room left along the corridor for ${u.name || "a unit"}` }); }
        placeAt(u, band, box, t, e, k);
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
  // what a hand-placed layout may get wrong: overlaps, outside the plate, the entrance turned away from the corridor
  const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.05 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.05;
  const issues = [];
  for (const [i, q] of placed.entries()) {
    q.flags = [];
    if (!inside(q)) q.flags.push("outside the plate");
    for (const [j, o] of placed.entries()) if (j !== i && ov(q, o)) { q.flags.push("overlaps " + (o.name || "a unit")); break; }
    const c = core.find((cc) => ov(q, cc)); if (c) q.flags.push("overlaps " + c.label);
    if (q.r % 360) q.flags.push("entrance not on the corridor");
    for (const fl of q.flags) issues.push(`${q.name}: ${fl}`);
  }
  for (const [i, c] of core.entries()) {
    c.flags = [];
    if (!inside(c)) c.flags.push("outside the plate");
    for (const [j, o] of core.entries()) if (j > i && ov(c, o)) c.flags.push("overlaps " + o.label);
    for (const fl of c.flags) issues.push(`${c.label}: ${fl}`);
  }
  const seqOut = { s: placed.filter((q) => q.band === "s").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })), n: placed.filter((q) => q.band === "n").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })) };
  // those that did not fit stay in the edited floor (listed as not placed) so it still matches the mix
  if (!SEQ) for (const q of left) seqOut.s.push({ u: q.u.name, m: false });
  // areas
  const plate = Math.abs(area(F.poly));
  const corrA = L * cw;
  const wideEx = Math.max(0, Math.min(cw, n(p.wideMax, 2.4)) - n(p.wideBase, 1.5)) * L;
  const A = (k2) => core.filter((c) => c.kind === k2).reduce((s, c) => s + c.w * c.h, 0);
  const clearA = (k2) => core.filter((c) => c.kind === k2).reduce((s, c) => s + Math.max(0, c.w - cwl) * Math.max(0, c.h - cwl), 0);
  const stairA = A("stair"), liftA = A("lift"), refA = clearA("refuse"), riserA = clearA("riser");
  const coreWallA = A("refuse") - refA + A("riser") - riserA;     // their walls count, the rooms inside are exempt
  // the party walls between units on a side: the gaps
  let partyA = 0;
  for (const band of ["s", "n"]) { const q = placed.filter((o) => o.band === band).sort((a, b) => a.x - b.x); for (let k = 1; k < q.length; k++) { const gp = q[k].x - (q[k - 1].x + q[k - 1].w); if (gp > 1e-6 && gp < 0.6) partyA += gp * Math.min(q[k].h, q[k - 1].h); } }
  const unitBox = placed.reduce((s, q) => s + q.w * q.h, 0);
  const unitGfa = placed.reduce((s, q) => s + q.fig.gfa, 0), sale = placed.reduce((s, q) => s + q.fig.saleable, 0);
  const unitUfa = placed.reduce((s, q) => s + q.fig.internal, 0);
  const balEx = placed.reduce((s, q) => s + q.fig.balEx + q.fig.upEx + q.fig.acpFree + q.fig.cwEx + q.fig.pcEx + q.fig.acpCapEx, 0);
  const residual = Math.max(0, plate - unitBox - corrA - stairA - liftA - refA - riserA - coreWallA - partyA);
  let gfa = unitGfa + corrA - wideEx + stairA + liftA + coreWallA + partyA;
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
    { what: "Lifts by service time", ok: nL >= lf.n, text: `${nL} lift${nL > 1 ? "s" : ""}: round trip ${lf.rtt} s, interval ${Math.round(lf.rtt / nL)} s, 5-min capacity ${r3(nL * 300 * lf.P / lf.rtt / (lf.population || 1) * 100)}% (needs ${lf.n})` },
    { what: "Units placed", ok: !left.length, text: `${placed.length} of ${want.length}` },
    { what: "Clashes", ok: !issues.length, text: issues.length ? issues.slice(0, 6).join("; ") + (issues.length > 6 ? ` … ${issues.length - 6} more` : "") : "none: inside the plate, nothing overlapping" },
  ];
  if (between != null) checks.push({ what: "Between the staircases", ok: between <= tr.between, text: `${between} m, at most ${tr.between} m (B11.3(b))` });
  return {
    seq: SEQ ? { s: SEQ.s.map((e) => Object.assign({}, e)), n: SEQ.n.map((e) => Object.assign({}, e)) } : seqOut, edited: !!SEQ, note, cornerFac: r3(cornerFac),
    coreOut: core.map((c) => ({ kind: c.kind, label: c.label, x: c.x, y: c.y, w: c.w, h: c.h })), coreAuto, coreEdited, issues, frameAxis: { ux: F.ux, uy: F.uy },
    F, L: r3(L), D: r3(D), y0, y1, cw, core, placed, left, stairsX: xs.map(r3), lifts: lf, nL, nS, stairs: qs, checks,
    figures: {
      plate: r3(plate), units: placed.length, saleable: r3(sale), unitGfa: r3(unitGfa), corridor: r3(corrA), wideEx: r3(wideEx),
      stair: r3(stairA), lift: r3(liftA), refuse: r3(refA), riser: r3(riserA), coreWalls: r3(coreWallA), partyWalls: r3(partyA), residual: r3(residual), mic: r3(mic), unitEx: r3(balEx),
      gfa: r3(gfa), acc: plate ? r3(gfa / plate * 100) : null, efficiency: gfa ? r3(sale / gfa * 100) : null,
      conc: r3(plate - gfa),
    },
    deep: r3(deep), fl, stair: SZ, coreWall: cwl,
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

/* a position snapped to the edges near it (within tol), else to the grid:
   v the moving thing's start, w its size, edges the lines it may meet */
export function snap1(v, w, edges, tol = 0.3, grid = 0.05) {
  let best = null;
  for (const e of edges) for (const c of [e - v, e - (v + w)]) if (Math.abs(c) <= tol && (best == null || Math.abs(c) < Math.abs(best))) best = c;
  return best != null ? r3(v + best) : r3(Math.round(v / grid) * grid);
}

/* a dog-leg staircase: risers a storey from the riser at most, two flights
   (treads one fewer than risers each), landings at least the stair's width
   at both ends, a 100 mm well. All in metres. */
export function stairSize(o) {
  const w = n(o.width, 1.2), H = n(o.storeyH, 3.15), rMax = n(o.riser, 0.175), g = n(o.going, 0.25);
  const nR = Math.max(2, Math.ceil(H / rMax - 1e-9)), r = H / nR;
  const n1 = Math.ceil(nR / 2), n2 = nR - n1, t1 = n1 - 1, t2 = n2 - 1;
  const run = Math.max(t1, t2) * g, landing = Math.max(w, n(o.landing, 0)), well = 0.1;
  return { width: w, risers: nR, riser: r3(r), going: g, n1, n2, t1, t2, run: r3(run), landing: r3(landing), well, W: r3(2 * w + well), D: r3(run + 2 * landing) };
}
