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
import { quickStairs, travelFor, b1, ceilPersons } from "./gbpcore.js";
import { wallGeom, outlineOf, rasterise } from "./unitwalls.js";
import * as WC from "./wallcore.js";

const r3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
const n = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

export const DEF = {
  corridor: 1.5,        // m, clear width (B(P)R / MoE: at least 1.05 m for a route)
  wideBase: 1.5,        // JPN 1 wider common corridor: the part wider than this ...
  wideMax: 2.4,         // ... up to this width is exempt (check against JPN 1)
  lobbyMin: 2.0,        // JPN 1 wider lift lobby (in front of the lifts): the part wider than this ...
  lobbyMax: 3.0,        // ... up to this width is exempt (check against JPN 1)
  stairs: 2, stairWidth: 1200,  // mm
  persons: "",          // persons a flat, for the lifts: empty = from each flat's usable floor area (Table B1)
  lobby: false,         // a protected lobby between each staircase and the corridor
  lobbyDepth: 1.8,      // m, its clear depth
  hc5: 6,               // % of the population in 5 minutes (CIBSE Guide D: residential 5-7%)
  interval: 60,         // s, the longest average interval
  car: 13,              // persons (1000 kg)
  storeyH: 3.15,
  refuse: [1.5, 1.8],   // refuse storage and material recovery room (APP-151 item 2.1), clear
  emr: [1.4, 1.0],      // E&M riser / meter room (items 2.2, 21), clear
  lift: [2.05, 2.25],   // a shaft's clear inside, along x and across
  coreWall: 0.25,       // RC round the staircases, lifts, refuse room and riser (shared between neighbours)
  partyWall: 0.2,       // RC between units (centred on their line)
  riser: 0.175, going: 0.225,  // Code of Practice for Means of Escape: riser 175 mm at most, going 225 mm at least
  core: "middle",       // middle | ends | behind (a staircase behind the lifts, reached by a passage beside them)
  stairType: "dogleg",  // dogleg | dogleg2 (2 risers on the half landing) | scissor (two stairs crossing in one enclosure)
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
  // the doors, turned with the rooms: the hinge H, the closed end O, the side it opens to (sn), its width
  const doors = [];
  for (const d of u.doors || []) {
    const r = (u.rooms || []).find((q) => q.id === d.room); if (!r) continue;
    const at = n(d.at), w = n(d.w, 0.8), x = n(r.x), y = n(r.y), rw = n(r.w), rh = n(r.h);
    const seg = d.side === "n" ? [[x + at, y], [x + at + w, y], [0, 1]] : d.side === "s" ? [[x + at, y + rh], [x + at + w, y + rh], [0, -1]] : d.side === "w" ? [[x, y + at], [x, y + at + w], [1, 0]] : [[x + rw, y + at], [x + rw, y + at + w], [-1, 0]];
    const k2 = d.swing === "out" ? -1 : 1, H = d.hinge === "end" ? seg[1] : seg[0], O = d.hinge === "end" ? seg[0] : seg[1];
    const P = (pt) => { const q2 = rot(pt); return [r3(q2[0] - mx), r3(q2[1] - my)]; };
    const sn = rot([seg[2][0] * k2, seg[2][1] * k2]);
    doors.push(Object.assign({ H: P(H), O: P(O), sn: [Math.round(sn[0]), Math.round(sn[1])], w, entry: !!d.entry }, d.type && d.type !== "hinged" ? { type: d.type, flip: d.hinge === "end" } : {}));
  }
  // the windows and the curtain-wall edges: segments [a, b] turned with the rooms, the outward normal on
  const P2 = (pt) => { const q2 = rot(pt); return [r3(q2[0] - mx), r3(q2[1] - my)]; };
  const NRM = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
  const seg2 = (r, side, at, w) => { const x = n(r.x), y = n(r.y), rw = n(r.w), rh = n(r.h); return side === "n" ? [[x + at, y], [x + at + w, y]] : side === "s" ? [[x + at, y + rh], [x + at + w, y + rh]] : side === "w" ? [[x, y + at], [x, y + at + w]] : [[x + rw, y + at], [x + rw, y + at + w]]; };
  const ops = [];
  for (const wi of u.windows || []) {
    const r = (u.rooms || []).find((q) => q.id === wi.room); if (!r) continue;
    const [a, b] = seg2(r, wi.side, n(wi.at), n(wi.w, 1)), no = rot(NRM[wi.side] || [0, 1]);
    ops.push({ k: "win", a: P2(a), b: P2(b), no: [Math.round(no[0]), Math.round(no[1])] });
  }
  let E = null;
  try { E = U.edges(u); } catch (ex) { E = []; }
  for (const e of E) {
    if (e.kind !== "ext") continue;
    const f = ((u.walls || {})[e.key] || {}).f || u.facadeType;
    if (f !== "cw") continue;
    const no = rot(NRM[e.face] || [0, 1]);
    ops.push({ k: "cw", a: P2([e.x1, e.y1]), b: P2([e.x2, e.y2]), no: [Math.round(no[0]), Math.round(no[1])] });
  }
  return { rooms, extras, doors, ops, W: r3(W), D: r3(D), party: n(u.party, 0.15), wall: n(u.wall, 0.15) };
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
    const typeOf = (e) => { const u = byName.get(e.u); return { u: (u && u.variantOf) || e.u }; };
    const a = cnt([...SEQ.s, ...SEQ.n].map(typeOf)), b = cnt(want.map((u) => ({ u: u.name })));
    if ([...new Set([...Object.keys(a), ...Object.keys(b)])].some((k) => (a[k] || 0) !== (b[k] || 0))) note = "The edited floor differs from the unit mix";
    want.length = 0; for (const e of [...SEQ.s, ...SEQ.n]) want.push(unitOf(e));
  }
  const f0 = new Map();
  const figOf = (u) => { if (!f0.has(u)) f0.set(u, U.figures(u)); return f0.get(u); };
  const deep = want.length ? Math.max(...want.map((u) => { const t = turn(u, TO_N[entrySide(u)] || 0); return t.D + t.wall; })) : (D - cw) / 2;
  // the corridor in the middle; when the plate is too shallow for the deepest unit on both sides, moved so one side takes it
  const half = (D - cw) / 2;
  // the corridor kept where it was when the plate was edited (corrY), else in the middle (or moved for the deepest unit)
  const yAuto = Math.max(0, half >= deep || D - cw < deep ? half : D - cw - deep);
  const y0 = r3(p.corrY != null && Number.isFinite(Number(p.corrY)) ? Math.max(0, Math.min(D - cw, Number(p.corrY))) : yAuto), y1 = r3(y0 + cw);
  const dN = y0, dS = D - y1;
  // the core on the north band
  // a staircase from its width, the storey height, the riser and going. Each core piece: its clear inside and a full RC wall
  // (coreWall) all round; pieces side by side overlap by one wall, so they share it
  const sw = n(p.stairWidth, 1200) / 1000, cwl = n(p.coreWall, 0.25), SZ = stairSize({ width: sw, storeyH: p.storeyH, riser: p.riser, going: p.going, type: p.stairType });
  const per = SZ.count;   // staircases an enclosure holds: 2 for a scissor
  const W2 = 2 * cwl, stW = r3(SZ.W + W2), stD = r3(SZ.D + W2), lobD = r3(n(p.lobbyDepth, 1.8) + W2);
  const fl = { flats: want.length };
  // the persons: each flat from its usable floor area (Table B1, as the staircases), unless a number a flat is given
  const fac = (b1("1b-1") || {}).factor || 9;
  const perFlat = (u) => (p.persons != null && p.persons !== "" && Number(p.persons) > 0 ? Number(p.persons) : ceilPersons(figOf(u).internal / fac));
  const popFloor = want.reduce((s2, u) => s2 + perFlat(u), 0);
  const lf = lifts({ floors: n(p.floorsAbove, n(p.storeys, 1)), population: (p.popFloorAll != null ? n(p.popFloorAll) : popFloor) * n(p.storeys, 1), car: p.car, storeyH: p.storeyH, hc5: p.hc5, interval: p.interval });
  let nL = Math.max(1, Math.round(n(p.lifts, 0)) || lf.n), nS = Math.max(1, Math.round(n(p.stairs, 2)));
  const core = [];
  const mid = [];
  for (let i = 0; i < nL; i++) mid.push({ kind: "lift", w: p.lift[0] + W2, h: p.lift[1] + W2, label: "Lift " + (i + 1) });
  mid.push({ kind: "refuse", w: p.refuse[0] + W2, h: p.refuse[1] + W2, label: "Refuse" }, { kind: "riser", w: p.emr[0] + W2, h: p.emr[1] + W2, label: "E&M riser" });
  const nE = Math.ceil(nS / per);
  const stairs = Array.from({ length: nE }, (_, i) => ({ kind: "stair", w: stW, h: stD, label: per > 1 ? `Stairs ${String.fromCharCode(65 + 2 * i)} + ${String.fromCharCode(66 + 2 * i)}` : "Stair " + String.fromCharCode(65 + i) }));
  let xs = [];
  const pushX = (x) => { for (let k = 0; k < per; k++) xs.push(x); };
  const walled = (k) => k !== "passage";
  // a row from x: each next piece overlaps the one before by a wall when both have walls
  const rowW = (list) => list.reduce((s2, q, i) => s2 + q.w - (i && walled(q.kind) && walled(list[i - 1].kind) ? cwl : 0), 0);
  const putRow = (list, x0) => {
    let x = x0;
    list.forEach((q, i) => {
      if (i && walled(q.kind) && walled(list[i - 1].kind)) x -= cwl;
      core.push(Object.assign({}, q, { x: r3(x), h: r3(Math.min(q.h, dN)), up: q.up || 0 }));
      if (q.kind === "stair") pushX(x + q.w / 2);
      x += q.w;
    });
    return x;
  };
  // with protected lobbies: a lobby between each staircase and the corridor, the staircase behind it sharing its wall
  const lob = !!p.lobby;
  const withLobby = (st) => (lob ? [{ kind: "lobby", w: st.w, h: lobD, label: "Lobby" }, Object.assign({}, st, { up: lobD - cwl })] : [st]);
  if (p.core === "none") {
    // a leg of a bending corridor with no core of its own (the core stands in another leg)
  } else if (p.core === "behind") {
    // the lifts, refuse room and riser on the corridor with a passage (or a protected lobby) beside them; the first staircase across behind them
    const pw = Math.max(cw, 1.2), rowD = Math.max(...mid.map((q) => q.h));
    const s0 = stairs[0], turned = { kind: "stair", w: s0.h, h: s0.w, label: s0.label };
    const first = lob ? { kind: "lobby", w: r3(pw + W2), h: rowD, label: "Lobby" } : { kind: "passage", w: r3(pw), h: r3(rowD - cwl), label: "Passage", for: s0.label, auto: true, width: r3(pw) };
    const row = [first, ...mid], rw = rowW(row);
    const rest = stairs.slice(1);
    const tot = Math.max(rw, turned.w) + rest.reduce((s2, q) => s2 + q.w - cwl, 0);
    const x0 = (L - tot) / 2;
    const xe = putRow(row, x0);
    core.push(Object.assign({}, turned, { x: r3(x0), up: rowD - cwl })); pushX(x0 + turned.w / 2);
    let x = Math.max(xe, x0 + turned.w);
    for (const q of rest) { const ls = withLobby(q); for (const z of ls) core.push(Object.assign({}, z, { x: r3(x - cwl) })); pushX(x - cwl + q.w / 2); x += q.w - cwl; }
  } else if (p.core === "ends" && nE >= 2) {
    const put1 = (st, x) => { for (const z of withLobby(st)) core.push(Object.assign({}, z, { x: r3(x) })); pushX(x + st.w / 2); };
    put1(stairs[0], 0); put1(stairs[1], r3(L - stairs[1].w));
    const list = [...mid, ...stairs.slice(2)];
    const xe = putRow(list, (L - rowW(list)) / 2);
    void xe;
  } else {
    // staircases at the ends of the row, the lifts, refuse room and riser between
    const seq = [stairs[0], ...mid, ...stairs.slice(1)];
    const x0 = (L - rowW(seq)) / 2;
    let x = x0;
    seq.forEach((q, i) => {
      if (i) x -= cwl;
      if (q.kind === "stair") { for (const z of withLobby(q)) core.push(Object.assign({}, z, { x: r3(x), h: r3(z.h) })); pushX(x + q.w / 2); }
      else core.push(Object.assign({}, q, { x: r3(x), h: r3(Math.min(q.h, dN)) }));
      x += q.w;
    });
  }
  // each piece's outer face on the corridor's edge (those behind another, up by it)
  for (const c of core) { c.y = r3(y0 - c.h - (c.up || 0)); delete c.up; c.full = true; }
  // a core moved by hand: its pieces as stored, anywhere on the plate (stored before the full walls: grown by half a wall all round)
  const coreAuto = core.map((c) => Object.assign({}, c));
  const coreEdited = Array.isArray(p.pieces) && p.pieces.length > 0;
  if (coreEdited) {
    core.length = 0; xs = [];
    for (const c of p.pieces) {
      const grow = c.full || c.kind === "passage" ? 0 : cwl / 2;
      const q = { kind: c.kind, label: c.label || c.kind, x: r3(n(c.x) - grow), y: r3(n(c.y) - grow), w: r3(Math.max(0.3, n(c.w, 1) + 2 * grow)), h: r3(Math.max(0.3, n(c.h, 1) + 2 * grow)), full: true };
      if (c.kind === "passage" && Array.isArray(c.path) && c.path.length >= 2) { q.path = c.path.map((pt) => [r3(n(pt[0])), r3(n(pt[1]))]); q.width = r3(Math.max(0.6, n(c.width, 1.2))); }
      if (c.kind === "passage") { if (c.for) q.for = c.for; if (c.auto === false) q.auto = false; else if (c.for) q.auto = true; if (c.width) q.width = r3(Math.max(0.6, n(c.width, 1.2))); }
      if (c.door && /^[nsew]$/.test(c.door.side || "")) q.door = { side: c.door.side, at: Math.max(0, Math.min(1, n(c.door.at, 0.5))) };
      if (c.door && c.door.type) q.door.type = c.door.type;
      if (Array.isArray(c.openings) && c.openings.length) q.openings = c.openings.filter((o) => /^[nsew]$/.test(o.side || "")).map((o) => ({ side: o.side, at: Math.max(0, Math.min(1, n(o.at, 0.5))), w: r3(Math.max(0.4, n(o.w, 0.9))), type: o.type || "door" }));
      if (Number(c.wt) > 0) q.wt = r3(Number(c.wt));
      q.pi = c._i != null ? c._i : core.length;   // its place in the stored list
      core.push(q); if (q.kind === "stair") pushX(q.x + q.w / 2);
    }
    nS = Math.max(1, core.filter((c) => c.kind === "stair").length * per); nL = Math.max(1, core.filter((c) => c.kind === "lift").length);
  }
  // a passage: a centre line (straight, or with bends: L, Z ...) at a clear width; its footprint the rectangles of its segments
  for (const c of core) if (c.kind === "passage") passageShape(c);
  // the core's doors, on the face onto the corridor, a passage or a lobby (or where the user put one)
  coreDoors(core, { y0, y1, cwl, L, per });
  // a passage that follows its staircase's door: routed from it to the corridor, then the doors again (the others see it)
  let routed = false;
  for (const c of core) {
    if (c.kind !== "passage" || c.auto === false || !c.for) continue;
    const st = core.find((q) => q.kind === "stair" && q.label === c.for), d = st && st.doors && st.doors[0];
    if (!d) continue;
    c.path = routePassage(st, d, { y0, y1, width: c.width || cw, cwl: Number(st.wt) > 0 ? Number(st.wt) : cwl });
    passageShape(c); routed = true;
  }
  if (routed) coreDoors(core, { y0, y1, cwl, L, per });
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
  // a unit at (x, y): its own shape - each room out to its walls' outer faces - not its bounding box; the balcony, UP and A/C platform left out
  const insideUnit = (x, y, rooms, wall) => unitInside(F.poly, x, y, rooms, wall);
  const BLK = Array.isArray(p.blockPolys) ? p.blockPolys : [];
  // the checks: against the whole plate (a leg of a bending corridor is placed in its own part, but may reach past it)
  const fullP = Array.isArray(p.fullPoly) && p.fullPoly.length >= 3 ? p.fullPoly : F.poly;
  const insideFull = (q) => [[q.x + 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + 0.05], [q.x + q.w - 0.05, q.y + q.h - 0.05], [q.x + 0.05, q.y + q.h - 0.05]].every(([px, py]) => inPoly(fullP, px, py));
  void inside;
  // two units, or a unit and a core piece, overlapping: by their rooms (a unit's wall may share a core wall)
  const roomsOv = (q, b, tol) => q.rooms.some((r) => Math.min(q.x + r.x + r.w, b.x + b.w) - Math.max(q.x + r.x, b.x) > tol && Math.min(q.y + r.y + r.h, b.y + b.h) - Math.max(q.y + r.y, b.y) > tol);
  const unitsOv = (q, o) => o.rooms.some((r) => roomsOv(q, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h }, 0.05));
  const placed = [], left = [];
  // between units the party wall: what the plans hold at their ends (half their own party wall each) less the RC wall set here
  // a party wall's own thickness (partyT["band:order"]: the one after a unit put from the left, before one put from the right) over partyWall
  const PT = p.partyT && typeof p.partyT === "object" ? p.partyT : {};
  const ptOf = (key) => (PT[key] != null && PT[key] !== "" && Number(PT[key]) > 0 ? Number(PT[key]) : n(p.partyWall, 0.2));
  const gapOf = (t, key) => r3(Math.max(0, ptOf(key) - n(t.party, 0.15)));
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
      for (let nudge = 0, nn = Math.max(40, Math.ceil((run.r - run.l) / 0.25) + 1); nudge < nn; nudge++) {
        const x = end === "l" ? run.l + nudge * 0.25 : run.r - t.W - nudge * 0.25;
        if (x < run.l - 1e-6 || x + t.W > run.r + 0.01) break;
        const y = band === "s" ? y1 + t.wall / 2 : y0 - t.D - t.wall / 2, box = { x: r3(x), y: r3(y), w: t.W, h: t.D };
        if (!insideUnit(box.x, box.y, t.rooms, t.wall)) continue;
        // clear of what the other legs of a bending corridor already hold
        if (BLK.length && t.rooms.some((rm) => { const q = [[box.x + rm.x - t.wall / 2 + 0.05, box.y + rm.y - t.wall / 2 + 0.05], [box.x + rm.x + rm.w + t.wall / 2 - 0.05, box.y + rm.y - t.wall / 2 + 0.05], [box.x + rm.x + rm.w + t.wall / 2 - 0.05, box.y + rm.y + rm.h + t.wall / 2 - 0.05], [box.x + rm.x - t.wall / 2 + 0.05, box.y + rm.y + rm.h + t.wall / 2 - 0.05]]; return BLK.some((b) => quadsOverlap(q, b)); })) continue;
        const key = band + ":" + order[band];
        if (!probe) { if (end === "l") run.l = r3(x + t.W + gapOf(t, key)); else run.r = r3(x - gapOf(t, key)); if (end === "l") c.i = k; else c.j = k; }
        return Object.assign(box, { gs: end, gk: key });
      }
      if (probe) return null; // only the current run, for the best fit
      k += end === "l" ? 1 : -1;
    }
    return null;
  };
  const order = { s: 0, n: 0 };
  const placeAt = (u, band, box, t, e, si) => placed.push(Object.assign({ u, name: u.name, band, fig: figOf(u), si: si != null ? si : order[band]++, m: !!(e && e.m), r: (e && n(e.r)) || 0, fixed: !!(e && e.x != null), entry: e || { u: u.name, m: false } }, box, { rooms: t.rooms, extras: t.extras, doors: t.doors, ops: t.ops, wt: t.wall }));
  if (SEQ) {
    // units put by hand (x given) first, where they were put; the runs keep clear of them
    for (const band of ["s", "n"]) {
      SEQ[band].forEach((e, k) => {
        if (e.x == null) return;
        const u = unitOf(e), t = tOf(u, band, e.r), x = r3(n(e.x)), y = band === "s" ? y1 + t.wall / 2 : y0 - t.D - t.wall / 2;
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
        if (t.D + t.wall > depth[band] + 0.05) { order[band]++; return left.push({ u, why: `${u.name || "Unit"} is ${t.D.toFixed(2)} m deep from its entrance; the ${band === "s" ? "south" : "north"} side is ${depth[band].toFixed(2)} m` }); }
        const end = p.corners && k % 2 ? "r" : "l";
        const box = take(band, end, t) || take(band, end === "l" ? "r" : "l", t);
        if (!box) { order[band]++; return left.push({ u, why: `no room left along the corridor for ${u.name || "a unit"}` }); }
        placeAt(u, band, box, t, e, k);
      });
    }
  } else {
    // from the mix: at each end the next unit that still fits its run (so a smaller one takes a gap)
    const rest = want.map((u) => ({ u, t: { n: tOf(u, "n"), s: tOf(u, "s") } }));
    for (const q of rest) if (q.t.s.D + q.t.s.wall > dS + 0.05 && q.t.n.D + q.t.n.wall > dN + 0.05) { q.gone = true; left.push({ u: q.u, why: `${q.u.name || "Unit"} is ${q.t.s.D.toFixed(2)} m deep from its entrance; the corridor leaves ${Math.max(dN, dS).toFixed(2)} m` }); }
    for (const band of ["s", "n"]) {
      const ends = p.corners ? ["l", "r"] : ["l"], done = new Set();
      let turnI = 0, guard = 0;
      while (done.size < ends.length && guard++ < 500) {
        const end = ends[turnI % ends.length]; turnI++;
        if (done.has(end)) continue;
        const c = cursor[band], k = end === "l" ? c.i : c.j;
        if (k < 0 || k >= sides[band].length || c.i > c.j) { done.add(end); continue; }
        const q = rest.find((z) => !z.gone && z.t[band].D + z.t[band].wall <= depth[band] + 0.05 && take(band, end, z.t[band], true));
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
  const ov = (a, b, tol = 0.05) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol;
  const issues = [];
  for (const [i, q] of placed.entries()) {
    q.flags = [];
    if (!unitInside(fullP, q.x, q.y, q.rooms, q.wt)) q.flags.push("outside the plate");
    for (const [j, o] of placed.entries()) if (j !== i && ov(q, o) && unitsOv(q, o)) { q.flags.push("overlaps " + (o.name || "a unit")); break; }
    const c = core.find((cc) => roomsOv(q, cc, cwl / 2 + 0.05)); if (c) q.flags.push("overlaps " + c.label);
    if (q.r % 360) q.flags.push("entrance not on the corridor");
    for (const fl of q.flags) issues.push(`${q.name}: ${fl}`);
  }
  for (const [i, c] of core.entries()) {
    c.flags = [];
    if (!insideFull(c)) c.flags.push("outside the plate");
    for (const [j, o] of core.entries()) if (j > i && ov(c, o, cwl + 0.05)) c.flags.push("overlaps " + o.label);
    for (const fl of c.flags) issues.push(`${c.label}: ${fl}`);
  }
  const seqOut = { s: placed.filter((q) => q.band === "s").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })), n: placed.filter((q) => q.band === "n").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })) };
  // those that did not fit stay in the edited floor (listed as not placed) so it still matches the mix
  if (!SEQ && !p.noLeftInSeq) for (const q of left) seqOut.s.push({ u: q.u.name, m: false });
  // areas
  const plate = Math.abs(area(F.poly));
  // walls drawn on the floor (closing off what is not units or core), at any angle
  const fwalls = floorWalls(p.walls, cwl);
  // a wall across the corridor cuts it: the corridor is the part between the cuts that holds the core (its lifts, else its middle;
  // in a leg of a bending corridor, the end at its joint)
  const coreMid = p.corrAnchor != null ? n(p.corrAnchor) : (() => { const ls = core.filter((c) => c.kind === "lift"), P = ls.length ? ls : core; return P.length ? P.reduce((a, c) => a + c.x + c.w / 2, 0) / P.length : L / 2; })();
  const cuts = corridorCuts(fwalls, (y0 + y1) / 2, -1, L + 1);
  // a leg's corridor: between its spine's points
  let cx0 = p.corrSpan ? Math.max(0, n(p.corrSpan[0])) : 0, cx1 = p.corrSpan ? Math.min(L, n(p.corrSpan[1], L)) : L;
  for (const [a, b] of cuts) { if (b <= coreMid) cx0 = Math.max(cx0, b); else if (a >= coreMid) cx1 = Math.min(cx1, a); }
  const corrLen = Math.max(0, cx1 - cx0);
  const corrA = corrLen * cw + core.filter((c) => c.kind === "passage").reduce((s2, c) => s2 + unionArea(c.rects), 0);
  // JPN 1: the corridor in front of the lifts is the lift lobby, with its own widths; the rest is the common corridor.
  // The exempt part of each: its width over the minimum, up to the maximum, along its length
  const onCorr = core.filter((c) => c.kind === "lift" && (Math.abs(c.y + c.h - y0) < 0.02 || Math.abs(c.y - y1) < 0.02));
  const llob = onCorr.length ? { x0: r3(Math.max(cx0, Math.min(...onCorr.map((c) => c.x)))), x1: r3(Math.min(cx1, Math.max(...onCorr.map((c) => c.x + c.w)))) } : null;
  const lobLen = llob ? Math.max(0, llob.x1 - llob.x0) : 0;
  const exCorrW = Math.max(0, Math.min(cw, n(p.wideMax, 2.4)) - n(p.wideBase, 1.5)), exLobW = Math.max(0, Math.min(cw, n(p.lobbyMax, 3.0)) - n(p.lobbyMin, 2.0));
  const wideEx = exCorrW * Math.max(0, corrLen - lobLen), lobbyEx = exLobW * lobLen;
  // a staircase, lift or lobby: its inside and half its walls; the refuse room and riser: the inside (exempt); the rest of the walls round the core
  const wtC = (c) => (Number(c.wt) > 0 ? Number(c.wt) : cwl);   // a piece's own wall, else the core's
  const A = (k2) => core.filter((c) => c.kind === k2).reduce((s, c) => s + Math.max(0, c.w - wtC(c)) * Math.max(0, c.h - wtC(c)), 0);
  const clearA = (k2) => core.filter((c) => c.kind === k2).reduce((s, c) => s + Math.max(0, c.w - 2 * wtC(c)) * Math.max(0, c.h - 2 * wtC(c)), 0);
  const stairA = A("stair"), liftA = A("lift"), lobbyA = A("lobby"), refA = clearA("refuse"), riserA = clearA("riser");
  const coreU = unionArea(core.filter((c) => c.kind !== "passage").map((c) => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h })));
  const fwallA = p.noWallArea ? 0 : fwalls.reduce((s2, w) => s2 + w.pieces.reduce((a, q) => a + WC.polyArea(q), 0), 0);
  const coreWallA = Math.max(0, coreU - stairA - liftA - lobbyA - refA - riserA) + fwallA;     // the walls count, the refuse room and riser inside are exempt
  // the party walls between units on a side: the gaps
  let partyA = 0;
  for (const band of ["s", "n"]) { const q = placed.filter((o) => o.band === band).sort((a, b) => a.x - b.x); for (let k = 1; k < q.length; k++) { const gp = q[k].x - (q[k - 1].x + q[k - 1].w); if (gp > 1e-6 && gp < 0.6) partyA += gp * Math.min(q[k].h, q[k - 1].h); } }
  const unitBox = placed.reduce((s, q) => s + q.w * q.h, 0);
  const unitGfa = placed.reduce((s, q) => s + q.fig.gfa, 0), sale = placed.reduce((s, q) => s + q.fig.saleable, 0);
  const unitUfa = placed.reduce((s, q) => s + q.fig.internal, 0);
  const balEx = placed.reduce((s, q) => s + q.fig.balEx + q.fig.upEx + q.fig.acpFree + q.fig.cwEx + q.fig.pcEx + q.fig.acpCapEx, 0);
  // what is left of the plate: found as regions (slivers aside), each taken as E&M
  const residuals = residualRegions(F.poly, [
    ...placed.flatMap((q) => [...q.rooms.map((rm) => ({ x0: q.x + rm.x - q.wt / 2, y0: q.y + rm.y - q.wt / 2, x1: q.x + rm.x + rm.w + q.wt / 2, y1: q.y + rm.y + rm.h + q.wt / 2 })), ...(q.extras || []).map((e) => ({ x0: q.x + e.x, y0: q.y + e.y, x1: q.x + e.x + e.w, y1: q.y + e.y + e.h }))]),
    ...core.flatMap((c) => (c.rects ? c.rects : [{ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }])),
    { x0: cx0, y0: y0, x1: cx1, y1: y1 },
  ], 0.5, 0.4, [...fwalls.flatMap((w) => w.pieces), ...(p.coverPolys || [])]);
  const residual = residuals.reduce((s2, q) => s2 + q.area, 0);
  let gfa = unitGfa + corrA - wideEx - lobbyEx + stairA + liftA + lobbyA + coreWallA + partyA;
  const mic = p.mic ? gfa * n(p.micPct, 10) / 100 : 0;
  gfa -= mic;
  // staircases: the persons on a floor (Table B1 1b-1 with five or more flats a floor a staircase)
  const qs = quickStairs([{ floors: n(p.storeys, 1), key: placed.length / nS >= 5 ? "1b-1" : "1b-2", area: unitUfa }], { stairs: nS, width: n(p.stairWidth, 1200) });
  // travel along the corridor: each flat door (the middle of its frontage) to the nearest staircase
  const tr = travelFor("1b");
  let worst = { d: 0, dead: false, name: "" };
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (xs.length) for (const q of placed) {
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
    { what: "Units placed", ok: !left.length, text: want.length ? `${placed.length} of ${want.length}` : `${placed.length} placed by hand (no unit mix)` },
    { what: "Clashes", ok: !issues.length, text: issues.length ? issues.slice(0, 6).join("; ") + (issues.length > 6 ? ` … ${issues.length - 6} more` : "") : "none: inside the plate, nothing overlapping" },
  ];
  if (between != null) checks.push({ what: "Between the staircases", ok: between <= tr.between, text: `${between} m, at most ${tr.between} m (B11.3(b))` });
  return {
    seq: SEQ ? { s: SEQ.s.map((e) => Object.assign({}, e)), n: SEQ.n.map((e) => Object.assign({}, e)) } : seqOut, edited: !!SEQ, note, cornerFac: r3(cornerFac),
    jpn1: { lobby: llob, corrW: r3(exCorrW), lobW: r3(exLobW), corrLen: r3(Math.max(0, corrLen - lobLen)), lobLen: r3(lobLen) },
    corr: { x0: r3(cx0), x1: r3(cx1) }, walls: fwalls, fwallA: r3(fwallA),
    coreOut: core.map((c) => Object.assign({ kind: c.kind, label: c.label, x: c.x, y: c.y, w: c.w, h: c.h, full: true }, c.path ? { path: c.path.map((q) => q.slice()), width: c.width } : {}, c.for ? { for: c.for, auto: c.auto !== false } : {}, c.door ? { door: Object.assign({}, c.door) } : {}, c.openings && c.openings.length ? { openings: c.openings.map((o) => Object.assign({}, o)) } : {}, Number(c.wt) > 0 ? { wt: c.wt } : {})), residuals, persons: { factor: fac, floor: popFloor }, coreAuto, coreEdited, issues, frameAxis: { ux: F.ux, uy: F.uy },
    F, L: r3(L), D: r3(D), y0, y1, cw, core, placed, left, stairsX: xs.map(r3), lifts: lf, nL, nS, stairs: qs, checks,
    figures: {
      plate: r3(plate), units: placed.length, saleable: r3(sale), unitGfa: r3(unitGfa), corridor: r3(corrA), wideEx: r3(wideEx), lobbyEx: r3(lobbyEx),
      stair: r3(stairA), lift: r3(liftA), lobby: r3(lobbyA), refuse: r3(refA), riser: r3(riserA), coreWalls: r3(coreWallA), partyWalls: r3(partyA), residual: r3(residual), mic: r3(mic), unitEx: r3(balEx),
      gfa: r3(gfa), acc: plate ? r3(gfa / plate * 100) : null, efficiency: gfa ? r3(sale / gfa * 100) : null,
      conc: r3(plate - gfa),
    },
    deep: r3(deep), fl, stair: SZ, coreWall: cwl,
  };
}

/* a floor along a bending corridor: the spine (f.spine: {path} in the plate frame, its width the corridor's) cut into straight
   legs; each leg laid out on its own (its axis along the leg, its corridor on the spine, its part of the plate between the
   bisectors at its joints), the core in one leg (coreLeg, else the longest), the units the core leg leaves going on to the
   next legs. Without a spine (or a straight one along the plate), layout() as ever.
   -> layout()'s result for one leg; for more: {multi, legs: [{k, r, xf}], F, L, D, cw, spine, corrPoly, walls, figures, checks …}
   where xf takes a leg's frame to the plate frame: [ox + c u - s v, oy + s u + c v] */
export function layoutLegs(o) {
  const p = Object.assign({}, DEF, o || {});
  const PF = frame(p.poly, p.frame);
  if (!PF) return null;
  const sp = p.spine && Array.isArray(p.spine.path) ? WC.cleanPath(p.spine.path) : null;
  const straight = sp && sp.length === 2 && Math.abs(sp[1][1] - sp[0][1]) < 1e-6;
  if (!sp || sp.length < 2 || straight) {
    const q = Object.assign({}, p);
    if (straight) { const a = Math.min(sp[0][0], sp[1][0]), b = Math.max(sp[0][0], sp[1][0]); q.corrY = sp[0][1] - n(p.corridor, 1.5) / 2; if (a > 0.05 || b < PF.L - 0.05) q.corrSpan = [a, b]; }
    const r = layout(q); if (!r) return r;
    r.legs = [{ k: 0, r, xf: { ox: 0, oy: 0, c: 1, s: 0, ang: 0 }, A: [0, 0], po: 0, co: 0 }];
    for (const q2 of r.placed) q2.leg = 0;
    for (const c of r.core) c.leg = 0;
    r.spine = { path: [[r.corr.x0, r3((r.y0 + r.y1) / 2)], [r.corr.x1, r3((r.y0 + r.y1) / 2)]], width: r.cw, auto: !sp };
    if (sp) r.spine.path = sp.map((q2) => [r3(q2[0]), r3(q2[1])]);
    r.corrPoly = WC.wallPoly(r.spine.path, r.cw, "c");
    return r;
  }
  const cw = n(p.corridor, 1.5), XY = sp.map((q) => PF.from(q)), m = XY.length - 1;
  const D = XY.slice(0, m).map((a, k) => WC.dirOf(a, XY[k + 1]));
  const nb = (j) => { const a = D[j - 1].d, b = D[j].d, x = a[0] + b[0], y = a[1] + b[1], L = Math.hypot(x, y) || 1; return [x / L, y / L]; };
  const lens = D.map((q) => q.L), hasPieces = Array.isArray(p.pieces) && p.pieces.length > 0;
  // the core's leg: as set; with pieces placed, the leg holding most of them; else the longest
  const byPieces = () => { const c = new Array(m).fill(0); for (const q of p.pieces) { const k = q.leg == null ? -1 : q.leg; if (k >= 0 && k < m) c[k]++; } const mx = Math.max(...c); return mx > 0 ? c.indexOf(mx) : null; };
  const coreLeg = p.coreLeg != null && p.coreLeg >= 0 && p.coreLeg < m ? Math.round(p.coreLeg) : (hasPieces && byPieces() != null ? byPieces() : lens.indexOf(Math.max(...lens)));
  // the order the legs take their units: the core's leg, then out from it
  const order = [coreLeg]; for (let d = 1; order.length < m; d++) { if (coreLeg - d >= 0) order.push(coreLeg - d); if (coreLeg + d < m) order.push(coreLeg + d); }
  const want = []; for (const q of p.mix || []) for (let i = 0; i < Math.max(0, Math.round(n(q.n))); i++) want.push(q.u);
  const legSeq = Array.isArray(p.legSeq) ? p.legSeq : [];
  // units in the legs edited by hand come out of the mix for the others
  const used = new Map();
  for (const sq of legSeq) if (sq) for (const e of [...(sq.s || []), ...(sq.n || [])]) used.set(e.u, (used.get(e.u) || 0) + 1);
  let pool = want.filter((u) => { const k = used.get(u.name) || 0; if (k > 0) { used.set(u.name, k - 1); return false; } return true; });
  const corrPolyXY = WC.wallPoly(XY, cw, "c");
  const legs = [];
  // the persons and lifts for the whole floor (all the mix's flats), not the core leg's alone
  const fac = (b1("1b-1") || {}).factor || 9;
  const popAll = want.reduce((s2, u) => s2 + (p.persons != null && p.persons !== "" && Number(p.persons) > 0 ? Number(p.persons) : ceilPersons(U.figures(u).internal / fac)), 0);
  const run = (k, extra) => {
    let sub = p.poly.map((q) => [n(q[0]), n(q[1])]);
    if (k > 0) sub = WC.clipHalf(sub, XY[k], nb(k));
    if (k < m - 1) { const v = nb(k + 1); sub = WC.clipHalf(sub, XY[k + 1], [-v[0], -v[1]]); }
    if (sub.length < 3) return null;
    // the leg's axis along it, turned to read left to right on the plan (its labels the right way up)
    const fw = D[k].d[0] * PF.ux + D[k].d[1] * PF.uy, rev = fw < -1e-9 || (Math.abs(fw) <= 1e-9 && -D[k].d[0] * PF.uy + D[k].d[1] * PF.ux < 0);
    const axis = rev ? { ux: -D[k].d[0], uy: -D[k].d[1] } : { ux: D[k].d[0], uy: D[k].d[1] }, LF = frame(sub, axis);
    const A = LF.to(XY[k]), B = LF.to(XY[k + 1]), T = (pt) => LF.to(PF.from(pt));
    // what is stored for a leg (its units' x, its pieces) is measured from its spine's start, so it stays put when the plate changes
    const sh = (e) => (e.x != null ? Object.assign({}, e, { x: r3(n(e.x) + A[0]) }) : Object.assign({}, e));
    const seqIn = legSeq[k] ? { s: (legSeq[k].s || []).map(sh), n: (legSeq[k].n || []).map(sh) } : null;
    const pcs = Array.isArray(p.pieces) && p.pieces.length ? p.pieces.map((c, i) => Object.assign({}, c, { _i: i })).filter((c) => (c.leg == null ? coreLeg : c.leg) === k).map((c) => Object.assign(c, { x: r3(n(c.x) + A[0]), y: r3(n(c.y) + A[1]) }, Array.isArray(c.path) ? { path: c.path.map((pt) => [r3(n(pt[0]) + A[0]), r3(n(pt[1]) + A[1])]) } : {})) : null;
    const q = Object.assign({}, p, extra || {}, {
      poly: sub, frame: axis, corrY: A[1] - cw / 2, corrSpan: [Math.min(A[0], B[0]), Math.max(A[0], B[0])],
      // pieces placed: each leg has those it holds, and no leg makes a core of its own
      core: hasPieces ? "none" : k === coreLeg ? p.core : "none", seq: seqIn,
      // the core pieces stand in their own legs (piece.leg; none: the core's leg)
      pieces: pcs,
      walls: (p.walls || []).map((w) => Object.assign({}, w, { path: (w.path || []).map(T) })), noWallArea: true,
      coverPolys: [corrPolyXY.map((pt) => LF.to(pt))], popFloorAll: popAll, noLeftInSeq: true,
      blockPolys: legs.flatMap((l0) => [...l0.r.placed.flatMap((q2) => q2.rooms.map((rm) => [[q2.x + rm.x - q2.wt / 2, q2.y + rm.y - q2.wt / 2], [q2.x + rm.x + rm.w + q2.wt / 2, q2.y + rm.y - q2.wt / 2], [q2.x + rm.x + rm.w + q2.wt / 2, q2.y + rm.y + rm.h + q2.wt / 2], [q2.x + rm.x - q2.wt / 2, q2.y + rm.y + rm.h + q2.wt / 2]])), ...l0.r.core.map((c) => [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]])].map((qd) => qd.map((pt) => LF.to(PF.from([l0.xf.ox + l0.xf.c * pt[0] - l0.xf.s * pt[1], l0.xf.oy + l0.xf.s * pt[0] + l0.xf.c * pt[1]]))))), fullPoly: p.poly.map((pt) => LF.to([n(pt[0]), n(pt[1])])), partyT: (p.legPartyT || [])[k] || (k === 0 ? p.partyT : null),
    });
    if (k < coreLeg) q.corrAnchor = B[0]; else if (k > coreLeg) q.corrAnchor = A[0];
    if (!legSeq[k]) q.mix = pool.map((u) => ({ u, n: 1 }));
    const r = layout(q); if (!r) return null;
    for (const q2 of r.placed) q2.leg = k;
    for (const c of r.core) c.leg = k;
    // back to the stored form: from the spine's start
    r.coreOut = r.coreOut.map((c) => Object.assign(c, { leg: k, x: r3(c.x - A[0]), y: r3(c.y - A[1]) }, c.path ? { path: c.path.map((pt) => [r3(pt[0] - A[0]), r3(pt[1] - A[1])]) } : {}));
    r.seq = { s: (r.seq.s || []).map((e) => (e.x != null ? Object.assign({}, e, { x: r3(n(e.x) - A[0]) }) : e)), n: (r.seq.n || []).map((e) => (e.x != null ? Object.assign({}, e, { x: r3(n(e.x) - A[0]) }) : e)) };
    // leg -> plate frame: the leg's origin and axis seen in the plate frame
    const o0 = PF.to(LF.from([0, 0])), o1 = PF.to(LF.from([1, 0])), c = o1[0] - o0[0], sn = o1[1] - o0[1];
    return { k, r, xf: { ox: o0[0], oy: o0[1], c, s: sn, ang: Math.atan2(sn, c) }, LF, A: [r3(A[0]), r3(A[1])] };
  };
  for (const k of order) {
    const L1 = run(k); if (!L1) continue;
    legs.push(L1);
    if (!legSeq[k]) { const got = new Set(L1.r.placed.map((q) => q.u)); const keep = []; const placedCount = new Map(); for (const q of L1.r.placed) placedCount.set(q.u, (placedCount.get(q.u) || 0) + 1); for (const u of pool) { const c = placedCount.get(u) || 0; if (c > 0) placedCount.set(u, c - 1); else keep.push(u); } void got; pool = keep; }
  }
  legs.sort((a, b) => a.k - b.k);
  const coreR = (legs.find((l) => l.k === coreLeg) || legs[0] || {}).r;
  if (!coreR) return null;
  const C0 = legs.find((l) => l.k === coreLeg).r;
  const toP = (l, pt) => [l.xf.ox + l.xf.c * pt[0] - l.xf.s * pt[1], l.xf.oy + l.xf.s * pt[0] + l.xf.c * pt[1]];
  // along the spine: each flat door and each staircase, by the distance along it
  const cum = [0]; for (let k = 0; k < m; k++) cum.push(cum[k] + WC.segLen(sp, k));
  const arc = (pt) => { const q = WC.nearestOnPath(pt, sp); return cum[q.seg] + q.s; };
  const cl = legs.find((l) => l.k === coreLeg), yc = (cl.r.y0 + cl.r.y1) / 2;
  const sArc = legs.flatMap((l) => l.r.stairsX.map((x) => arc(toP(l, [x, (l.r.y0 + l.r.y1) / 2]))));
  void yc;
  const nSAll = legs.reduce((s2, l) => s2 + (l.r.core.some((c) => c.kind === "stair") ? l.r.nS : 0), 0) || C0.nS;
  const tr = travelFor("1b");
  let worst = { d: 0, dead: false, name: "" };
  const lo = Math.min(...sArc), hi = Math.max(...sArc);
  for (const l of legs) for (const q of l.r.placed) {
    const a = arc(toP(l, [q.x + q.w / 2, (l.r.y0 + l.r.y1) / 2])), d = (sArc.length ? Math.min(...sArc.map((x) => Math.abs(x - a))) : Infinity) + cw / 2;
    const dead = nSAll < 2 || a < lo || a > hi, lim = dead ? tr.deadend : tr.max;
    if (d / lim > worst.d / (worst.lim || 1)) worst = { d: r3(d), dead, lim, name: q.name };
  }
  // across the legs: a unit or piece of one leg on another's; and what is left of each leg not under another leg's units
  const quad = (l, q) => [[q.x, q.y], [q.x + q.w, q.y], [q.x + q.w, q.y + q.h], [q.x, q.y + q.h]].map((pt) => toP(l, pt));
  const roomQuads = (l, q) => q.rooms.map((rm) => quad(l, { x: q.x + rm.x - q.wt / 2 + 0.05, y: q.y + rm.y - q.wt / 2 + 0.05, w: rm.w + q.wt - 0.1, h: rm.h + q.wt - 0.1 }));
  const things = legs.flatMap((l) => [...l.r.placed.map((q) => ({ l, q, name: q.name, polys: roomQuads(l, q) })), ...l.r.core.filter((c) => c.kind !== "passage").map((c) => ({ l, q: c, name: c.label, polys: [quad(l, { x: c.x + 0.05, y: c.y + 0.05, w: c.w - 0.1, h: c.h - 0.1 })] }))]);
  for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
    const A = things[i], B = things[j]; if (A.l === B.l) continue;
    if (A.polys.some((pa) => B.polys.some((pb) => quadsOverlap(pa, pb)))) {
      A.q.flags.push("overlaps " + B.name); B.q.flags.push("overlaps " + A.name);
      A.l.r.issues.push(`${A.name}: overlaps ${B.name}`);
    }
  }
  for (const l of legs) {
    const others = things.filter((t) => t.l !== l).flatMap((t) => t.polys).map((pq) => pq.map((pt) => { const dx = pt[0] - l.xf.ox, dy = pt[1] - l.xf.oy; return [l.xf.c * dx + l.xf.s * dy, -l.xf.s * dx + l.xf.c * dy]; }));
    if (!others.length) continue;
    l.r.residuals = l.r.residuals.map((z) => {
      const cells = z.cells.filter((c) => !others.some((pq) => inPoly(pq, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2)));
      const area2 = cells.reduce((s2, c) => s2 + cellArea(c), 0);
      if (cells.length === z.cells.length) return z;
      const big = cells.reduce((m2, c) => (!m2 || cellArea(c) > cellArea(m2) ? c : m2), null);
      return big ? Object.assign({}, z, { cells, area: r3(area2), at: cellMid(big) }) : null;
    }).filter((z) => z && z.area >= 0.5);
    l.r.figures.residual = r3(l.r.residuals.reduce((s2, z) => s2 + z.area, 0));
  }
  const walls = floorWalls(p.walls, C0.coreWall);
  const fwallA = walls.reduce((s2, w) => s2 + w.pieces.reduce((a, q) => a + WC.polyArea(q), 0), 0);
  const sum = (k) => legs.reduce((s2, l) => s2 + (Number(l.r.figures[k]) || 0), 0);
  const plate = Math.abs(area(PF.poly));
  const fig = {};
  for (const k of ["units", "saleable", "unitGfa", "corridor", "wideEx", "lobbyEx", "stair", "lift", "lobby", "refuse", "riser", "coreWalls", "partyWalls", "residual", "mic", "unitEx", "gfa"]) fig[k] = r3(sum(k));
  fig.coreWalls = r3(fig.coreWalls + fwallA); fig.gfa = r3(fig.gfa + fwallA * (1 - (p.mic ? n(p.micPct, 10) / 100 : 0)));
  Object.assign(fig, { plate: r3(plate), acc: plate ? r3(fig.gfa / plate * 100) : null, efficiency: fig.gfa ? r3(fig.saleable / fig.gfa * 100) : null, conc: r3(plate - fig.gfa) });
  const placedN = legs.reduce((s2, l) => s2 + l.r.placed.length, 0), wantN = want.length;
  const issues = legs.flatMap((l) => l.r.issues.map((t) => (legs.length > 1 ? `leg ${l.k + 1}: ` : "") + t));
  const left = [...legs.flatMap((l) => (legSeq[l.k] ? l.r.left : [])), ...pool.map((u) => ({ u, why: `no room left along the corridor for ${u.name || "a unit"}` }))];
  const checks = C0.checks.filter((c) => /Staircases|Lifts/.test(c.what));
  checks.push({ what: "Travel: flat door to a staircase (B11)", ok: worst.d <= (worst.lim || tr.max) + 1e-9, text: placedN ? `${worst.d} m along the corridor from ${worst.name}${worst.dead ? ", in a dead end" : ""}, limit ${worst.lim || tr.max} m` : "–" });
  checks.push({ what: "Units placed", ok: placedN >= wantN, text: wantN ? `${placedN} of ${wantN} on ${legs.length} legs` : `${placedN} placed by hand on ${legs.length} legs (no unit mix)` });
  checks.push({ what: "Clashes", ok: !issues.length, text: issues.length ? issues.slice(0, 6).join("; ") + (issues.length > 6 ? ` … ${issues.length - 6} more` : "") : "none: inside the plate, nothing overlapping" });
  if (sArc.length >= 2) checks.push({ what: "Between the staircases", ok: hi - lo <= tr.between, text: `${r3(hi - lo)} m along the corridor, at most ${tr.between} m (B11.3(b))` });
  const jp = (k) => legs.reduce((s2, l) => s2 + (Number(l.r.jpn1[k]) || 0), 0);
  return Object.assign({}, C0, {
    multi: true, coreLeg, legs: (() => { let po = 0, co = 0; return legs.map((l) => { const o2 = { k: l.k, r: l.r, xf: l.xf, A: l.A, po, co }; po += l.r.placed.length; co += l.r.core.length; return o2; }); })(), F: PF,
    core: legs.flatMap((l) => l.r.core), coreOut: legs.flatMap((l) => l.r.coreOut), coreEdited: legs.some((l) => l.r.coreEdited), L: r3(PF.L), D: r3(PF.D), cw, spine: { path: sp.map((q) => [r3(q[0]), r3(q[1])]), width: cw },
    corrPoly: WC.wallPoly(sp, cw, "c"), walls, fwallA: r3(fwallA), placed: legs.flatMap((l) => l.r.placed), left, issues, checks, figures: fig,
    jpn1: Object.assign({}, C0.jpn1, { corrLen: r3(jp("corrLen")) }), legSeq: legs.map((l) => l.r.seq), edited: legs.some((l) => l.r.edited),
    residuals: legs.flatMap((l) => l.r.residuals.map((z) => Object.assign({ leg: l.k }, z))), frameAxis: { ux: PF.ux, uy: PF.uy },
  });
}

/* two convex quadrilaterals overlapping (more than touching): the separating axis test */
export function quadsOverlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], nx = b[1] - a[1], ny = a[0] - b[0];
    const pa = A.map((q) => q[0] * nx + q[1] * ny), pb = B.map((q) => q[0] * nx + q[1] * ny);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
  }
  return true;
}
/* a leg of a spine (plate frame): its axis, turned to read left to right as layoutLegs turns it -> {ux, uy} */
export function legAxis(sp, k) {
  const a = sp[k], b = sp[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, d = [dx / L, dy / L];
  const rev = d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0);
  return rev ? { ux: -d[0], uy: -d[1] } : { ux: d[0], uy: d[1] };
}
/* a plate-frame point in leg k's frame, from the leg's spine start (as stored: units' x, pieces' x / y) */
export function toLegRel(sp, k, pt) {
  const { ux, uy } = legAxis(sp, k), dx = pt[0] - sp[k][0], dy = pt[1] - sp[k][1];
  return [dx * ux + dy * uy, -dx * uy + dy * ux];
}
export function fromLegRel(sp, k, q) {
  const { ux, uy } = legAxis(sp, k);
  return [sp[k][0] + q[0] * ux - q[1] * uy, sp[k][1] + q[0] * uy + q[1] * ux];
}

/* a floor's units and core pieces, as laid out (R from layoutLegs), carried onto a new spine (plate frame): each into the leg
   its middle stands by, on its side of the corridor, from that leg's spine start -> {legSeq, pieces} (or {seq, pieces} for a
   straight spine along the plate, stored as layout() reads them) */
/* the start of each segment of a spine, as distance along it */
export function arcStarts(sp) { const out = [0]; for (let k = 0; k < sp.length - 1; k++) out.push(out[k] + Math.hypot(sp[k + 1][0] - sp[k][0], sp[k + 1][1] - sp[k][1])); return out; }
/* a plate point P near segment kOld of the old spine, taken to the new spine at the same distance along it and the same
   offset from it: {k (the new segment), f (a map of plate points, turning with the corridor about P), rot (the turn)} */
export function arcMap(spOld, spNew, kOld, P) {
  const seg = (sp, k) => { const a = sp[k], b = sp[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; return { a, d, n: [-d[1], d[0]], L }; };
  const kO = Math.max(0, Math.min(spOld.length - 2, kOld)), o = seg(spOld, kO), S0 = arcStarts(spOld), S1 = arcStarts(spNew);
  const t = (P[0] - o.a[0]) * o.d[0] + (P[1] - o.a[1]) * o.d[1], v = (P[0] - o.a[0]) * o.n[0] + (P[1] - o.a[1]) * o.n[1], s = S0[kO] + t;
  // the same legs (one moved or turned): each its own, from its start; else (a bend added or taken away) by the distance along the whole corridor
  let k = 0, u;
  if (spOld.length === spNew.length) { k = kO; u = t; }
  else { while (k < spNew.length - 2 && s > S1[k + 1]) k++; u = s - S1[k]; }
  const q = seg(spNew, k), P2 = [q.a[0] + q.d[0] * u + q.n[0] * v, q.a[1] + q.d[1] * u + q.n[1] * v];
  const rot = Math.atan2(q.d[1], q.d[0]) - Math.atan2(o.d[1], o.d[0]), c = Math.cos(rot), sn = Math.sin(rot);
  return { k, rot, f: (pt) => { const dx = pt[0] - P[0], dy = pt[1] - P[1]; return [P2[0] + c * dx - sn * dy, P2[1] + sn * dx + c * dy]; } };
}
export function migrateToSpine(R, sp2, keepX) {
  const toP = (l, pt) => [l.xf.ox + l.xf.c * pt[0] - l.xf.s * pt[1], l.xf.oy + l.xf.s * pt[0] + l.xf.c * pt[1]];
  const straight = sp2.length === 2 && Math.abs(sp2[1][1] - sp2[0][1]) < 1e-6;
  const rel = (k, pt) => (straight ? [pt[0], pt[1] - sp2[0][1]] : toLegRel(sp2, k, pt));
  // the old corridor's line: what stands by it keeps its distance along it and its offset from it
  const sp1 = R.spine && Array.isArray(R.spine.path) && R.spine.path.length >= 2 ? R.spine.path : [[0, 0], [1, 0]];
  const AM = (l, P) => { const m = arcMap(sp1, sp2, l.k, P); if (straight) m.k = 0; return m; };
  // the leg frame turned 180° against the old one (turned with the corridor): the sides of a door swap
  const flipOf = (l, m) => { const ax = straight ? { ux: 1, uy: 0 } : legAxis(sp2, m.k), c = Math.cos(m.rot), sn = Math.sin(m.rot); return ax.ux * (c * l.xf.c - sn * l.xf.s) + ax.uy * (sn * l.xf.c + c * l.xf.s) < 0; };
  const nL = straight ? 1 : sp2.length - 1, seqs = Array.from({ length: nL }, () => ({ s: [], n: [] }));
  for (const l of R.legs || []) for (const q of l.r.placed) {
    const cs = [[q.x, q.y], [q.x + q.w, q.y], [q.x + q.w, q.y + q.h], [q.x, q.y + q.h]].map((pt) => toP(l, pt));
    const mid = [(cs[0][0] + cs[2][0]) / 2, (cs[0][1] + cs[2][1]) / 2], m = AM(l, mid), k = Math.min(nL - 1, m.k), rs = cs.map((pt) => rel(k, m.f(pt))), rm = rel(k, m.f(mid));
    // in order along the leg; a unit put by hand keeps its place, the others are laid along it again (so none overlap)
    seqs[k][rm[1] < 0 ? "n" : "s"].push(Object.assign({ u: (q.entry && q.entry.u) || q.name, m: !!q.m, at: Math.min(...rs.map((v) => v[0])) }, q.fixed || keepX ? { x: r3(Math.min(...rs.map((v) => v[0]))) } : {}, q.r ? { r: q.r } : {}));
  }
  for (const S2 of seqs) for (const b of ["s", "n"]) { S2[b].sort((a, c) => a.at - c.at); for (const e of S2[b]) delete e.at; }
  const pieces = [], FLIP = { n: "s", s: "n", e: "w", w: "e" };
  // a leg's core moves as one: mapped by its middle, each piece keeping its place about it (so a core across a joint is not torn apart, and it turns with its leg)
  for (const l of R.legs || []) {
    if (!l.r.core.length) continue;
    const cs = l.r.core.filter((c) => c.kind !== "passage"), G = cs.length ? cs : l.r.core;
    const gm = toP(l, [G.reduce((s2, c) => s2 + c.x + c.w / 2, 0) / G.length, G.reduce((s2, c) => s2 + c.y + c.h / 2, 0) / G.length]);
    const m = AM(l, gm), k = Math.min(nL - 1, m.k), flip = flipOf(l, m);
    const map = (pt) => rel(k, m.f(toP(l, pt)));
    for (const c of l.r.core) {
      const rm = map([c.x + c.w / 2, c.y + c.h / 2]);
      const q = { kind: c.kind, label: c.label, x: r3(rm[0] - c.w / 2), y: r3(rm[1] - c.h / 2), w: c.w, h: c.h, full: true };
      if (straight) q.y = r3(q.y + sp2[0][1]); else q.leg = k;
      if (c.kind === "passage" && Array.isArray(c.path)) { q.path = orthoPath(c.path.map((pt) => { const v = map(pt); return straight ? [r3(v[0]), r3(v[1] + sp2[0][1])] : [r3(v[0]), r3(v[1])]; })); q.width = c.width; q.auto = false; }
      for (const key of ["door", "openings", "wt", "for"]) if (c[key] != null) q[key] = JSON.parse(JSON.stringify(c[key]));
      if (flip) for (const o of [q.door, ...(q.openings || [])]) if (o && FLIP[o.side]) { o.side = FLIP[o.side]; if (o.at != null) o.at = r3(1 - o.at); }
      if (c.kind === "passage" && c.for) q.auto = true;
      pieces.push(q);
    }
  }
  return straight ? { seq: seqs[0], pieces } : { legSeq: seqs, pieces };
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
  const type = ["dogleg2", "scissor"].includes(o.type) ? o.type : "dogleg";
  const nR = Math.max(2, Math.ceil(H / rMax - 1e-9)), r = H / nR;
  const landing = Math.max(w, n(o.landing, 0));
  if (type === "scissor") {
    // two staircases in one enclosure: each a single flight a storey, side by side and opposite, an RC wall between; a landing at each end serves one's top and the other's foot
    const t1 = nR - 1, run = t1 * g, mid = 0.2;
    return { type, count: 2, width: w, risers: nR, riser: r3(r), going: g, n1: nR, n2: nR, t1, t2: t1, land2: 0, run: r3(run), landing: r3(landing), well: mid, W: r3(2 * w + mid), D: r3(run + 2 * landing) };
  }
  // a dog-leg: two flights; with "dogleg2" two of the risers are on the half landing, across it, so the flights are shorter
  const land2 = type === "dogleg2" ? 2 : 0, nF = Math.max(2, nR - land2);
  const n1 = Math.ceil(nF / 2), n2 = nF - n1, t1 = n1 - 1, t2 = n2 - 1;
  // the well: 100 mm, or with 2 risers on the half landing at least their tread's depth (the step sits across it)
  const run = Math.max(t1, t2) * g, well = land2 ? Math.max(0.1, g) : 0.1;
  return { type, count: 1, width: w, risers: nR, riser: r3(r), going: g, n1, n2, t1, t2, land2, run: r3(run), landing: r3(landing), well, W: r3(2 * w + well), D: r3(run + 2 * landing) };
}

/* the area of a union of rectangles {x0, y0, x1, y1} */
export function unionArea(rects) {
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b), ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const ny = ys.length - 1, hit = new Uint8Array(Math.max(0, (xs.length - 1) * ny));
  rasterise(xs, ys, rects, (c) => { hit[c] = 1; });
  let a = 0;
  for (let c = 0; c < hit.length; c++) if (hit[c]) { const i = Math.floor(c / ny), j = c % ny; a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]); }
  return a;
}

const area2 = (P) => { let s2 = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s2 += a[0] * b[1] - b[0] * a[1]; } return s2 / 2; };
function onEdge(P, x, y, tol = 1e-6) {
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); if (Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) <= tol) return true; }
  return false;
}
/* a polygon cut to a rectangle {x0, y0, x1, y1} (Sutherland-Hodgman: the rectangle is convex, the polygon need not be) */
/* a cell's middle: of its part inside, when it is cut */
const norm2 = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
const cellMid = (c) => (c.poly ? [c.poly.reduce((a, p) => a + p[0], 0) / c.poly.length, c.poly.reduce((a, p) => a + p[1], 0) / c.poly.length] : [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]);
const cellArea = (c) => (c.poly ? Math.abs(area2(c.poly)) : (c.x1 - c.x0) * (c.y1 - c.y0));
export function clipToRect(P, r) {
  let out = P.map((p) => [p[0], p[1]]);
  const edges = [[(p) => p[0] >= r.x0, (a, b) => { const t = (r.x0 - a[0]) / (b[0] - a[0]); return [r.x0, a[1] + t * (b[1] - a[1])]; }], [(p) => p[0] <= r.x1, (a, b) => { const t = (r.x1 - a[0]) / (b[0] - a[0]); return [r.x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= r.y0, (a, b) => { const t = (r.y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), r.y0]; }], [(p) => p[1] <= r.y1, (a, b) => { const t = (r.y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), r.y1]; }]];
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) { const a = src[i], b = src[(i + 1) % src.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); }
    if (!out.length) break;
  }
  return out;
}
/* what of the plate nothing covers: connected regions of cells, each {area, box, at (its largest cell's middle), cells};
   slivers (under 0.5 m2, or under 0.4 m across) left out */
export function residualRegions(poly, rects, minA = 0.5, minW = 0.4, polys) {
  // polygons that cover too (walls at an angle, a bending corridor's corner): sampled every 0.2 m over their boxes
  const PL = (polys || []).filter((q) => q && q.length >= 3), gx = [], gy = [];
  for (const q of PL) {
    const xa = Math.min(...q.map((p) => p[0])), xb = Math.max(...q.map((p) => p[0])), ya = Math.min(...q.map((p) => p[1])), yb = Math.max(...q.map((p) => p[1]));
    const rect = q.length === 4 && q.every((p) => q.filter((o) => Math.abs(o[0] - p[0]) < 1e-6 || Math.abs(o[1] - p[1]) < 1e-6).length >= 3);
    gx.push(xa, xb); gy.push(ya, yb);
    if (!rect) { for (let x = xa; x < xb; x += 0.2) gx.push(x); for (let y = ya; y < yb; y += 0.2) gy.push(y); }
  }
  const xs = [...new Set([...poly.map((p) => p[0]), ...rects.flatMap((r) => [r.x0, r.x1]), ...gx].map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set([...poly.map((p) => p[1]), ...rects.flatMap((r) => [r.y0, r.y1]), ...gy].map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1, free = new Uint8Array(Math.max(0, nx * ny)), cov = new Uint8Array(free.length);
  rasterise(xs, ys, rects, (c) => { cov[c] = 1; });
  if (PL.length) {
    const lb = (A, v) => { let a = 0, b = A.length; while (a < b) { const m = (a + b) >> 1; if (A[m] < v - 1e-9) a = m + 1; else b = m; } return a; };
    for (const q of PL) {
      const i0 = lb(xs, Math.min(...q.map((p) => p[0]))), i1 = lb(xs, Math.max(...q.map((p) => p[0]))), j0 = lb(ys, Math.min(...q.map((p) => p[1]))), j1 = lb(ys, Math.max(...q.map((p) => p[1])));
      for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (inPoly(q, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)) cov[i * ny + j] = 1;
    }
  }
  const slanted = poly.some((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.abs(q[0] - p[0]) > 1e-6 && Math.abs(q[1] - p[1]) > 1e-6; });
  // inside the plate: one crossing test a row of cells (the cells' middles on a line y)
  for (let j = 0; j < ny; j++) {
    if (ys[j + 1] - ys[j] < 1e-6) continue;
    const cy = (ys[j] + ys[j + 1]) / 2, cuts = [];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > cy) !== (yb > cy)) cuts.push(xa + (cy - ya) * (xb - xa) / (yb - ya)); }
    cuts.sort((p, q) => p - q);
    for (let i = 0; i < nx; i++) {
      if (xs[i + 1] - xs[i] < 1e-6 || cov[i * ny + j]) continue;
      const cx = (xs[i] + xs[i + 1]) / 2;
      let n = 0; for (const c of cuts) if (c < cx) n++;
      if (n % 2) free[i * ny + j] = 1;
      // its middle outside but part of it inside (a slanted edge across it): kept, cut to that part below
      else if (slanted && Math.abs(area2(clipToRect(poly, { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] }))) > 0.01) free[i * ny + j] = 1;
    }
  }
  const seen = new Uint8Array(free.length), out = [];
  for (let k = 0; k < free.length; k++) {
    if (!free[k] || seen[k]) continue;
    const st = [k], cells = []; seen[k] = 1;
    while (st.length) {
      const c = st.pop(), i = Math.floor(c / ny), j = c % ny; cells.push([i, j]);
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = a * ny + b; if (free[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
    }
    let area = 0, big = null, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const rc = cells.map(([i, j]) => {
      const r = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] };
      // a cell across a slanted edge of the plate (or of the leg's part of it): only its part inside, drawn and counted
      let a = (r.x1 - r.x0) * (r.y1 - r.y0);
      if (![[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].every(([x, y]) => inPoly(poly, x, y) || onEdge(poly, x, y))) { const cp = clipToRect(poly, r); if (cp.length >= 3) { r.poly = cp; a = Math.abs(area2(cp)); } }
      area += a; if (!big || a > big.a) big = Object.assign({ a }, r); bx0 = Math.min(bx0, r.x0); by0 = Math.min(by0, r.y0); bx1 = Math.max(bx1, r.x1); by1 = Math.max(by1, r.y1); return r; });
    // slivers left out: too small, or thin (its box, as a region can be cut into small cells where polygons were sampled)
    if (area < minA || Math.min(bx1 - bx0, by1 - by0) < minW || (PL.length === 0 && Math.min(big.x1 - big.x0, big.y1 - big.y0) < minW)) continue;
    out.push({ area: r3(area), box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, at: cellMid(big), cells: rc });
  }
  return out;
}

/* the doors of the core pieces: a staircase's on its face onto the corridor, a passage or a lobby (two on a scissor), a lift's
   opening on the corridor or lobby, the refuse room's and riser's onto the corridor; a lobby's from the corridor.
   Each door {H, O, sn, w, slide}: on its wall's middle line, the hinge, the closed end, the side it opens to */
export function coreDoors(core, o) {
  const { y0, y1, cwl } = o, E2 = 0.01;
  const wtOf = (c) => (Number(c.wt) > 0 ? Number(c.wt) : cwl);
  const open = core.filter((c) => c.kind === "passage" || c.kind === "lobby");
  // a door on a face: side n|s|e|w, from a to b along it (x for n / s, y for e / w)
  const door = (c, side, mid, w, into, slide, a0, b0) => {
    const t = wtOf(c), horiz = side === "n" || side === "s";
    const lo = (a0 != null ? a0 : horiz ? c.x : c.y) + t + 0.05, hi = (b0 != null ? b0 : horiz ? c.x + c.w : c.y + c.h) - t - 0.05;
    const a = Math.max(lo, Math.min(hi - w, mid - w / 2)), b = Math.min(hi, a + w);
    if (b - a < 0.5) return;
    const line = side === "s" ? c.y + c.h - t / 2 : side === "n" ? c.y + t / 2 : side === "e" ? c.x + c.w - t / 2 : c.x + t / 2;
    const sOut = side === "s" || side === "e" ? 1 : -1, s2 = into ? -sOut : sOut;
    c.doors.push(horiz ? { H: [r3(a), r3(line)], O: [r3(b), r3(line)], sn: [0, s2], w: r3(b - a), slide: !!slide, side, t }
      : { H: [r3(line), r3(a)], O: [r3(line), r3(b)], sn: [s2, 0], w: r3(b - a), slide: !!slide, side, t });
  };
  for (const c of core) {
    c.doors = [];
    if (c.kind === "passage") continue;
    const t = wtOf(c);
    // a door placed by the user: its face and where along it (0 .. 1)
    if (c.door && /^[nsew]$/.test(c.door.side || "")) {
      const horiz = c.door.side === "n" || c.door.side === "s", len = horiz ? c.w : c.h, start = horiz ? c.x : c.y;
      const at = Math.max(0, Math.min(1, Number(c.door.at != null ? c.door.at : 0.5)));
      const w = c.kind === "lift" ? 1.0 : c.kind === "stair" || c.kind === "lobby" ? 0.9 : 0.75;
      door(c, c.door.side, start + t + (len - 2 * t) * at, w, c.kind === "stair" || c.kind === "lobby", c.kind === "lift");
      if (c.doors.length) { if (c.door.type) c.doors[c.doors.length - 1].type = c.door.type; else if (c.kind === "riser") c.doors[c.doors.length - 1].type = "panel"; }
      extra(c);
      continue;
    }
    const faces = [];
    // the faces onto the corridor
    if (Math.abs(c.y + c.h - y0) < E2) faces.push({ side: "s", a: c.x, b: c.x + c.w });
    if (Math.abs(c.y - y1) < E2) faces.push({ side: "n", a: c.x, b: c.x + c.w });
    // onto a passage or lobby (not for a lobby itself)
    if (c.kind !== "lobby") for (const q of open) {
      if (q === c) continue;
      const R = q.rects || [{ x0: q.x, y0: q.y, x1: q.x + q.w, y1: q.y + q.h }], inner = q.kind === "lobby" ? wtOf(q) : 0;
      for (const r of R) {
        const ox0 = Math.max(c.x, r.x0), ox1 = Math.min(c.x + c.w, r.x1), oy0 = Math.max(c.y, r.y0), oy1 = Math.min(c.y + c.h, r.y1);
        if (ox1 - ox0 > 0.8) {
          if (Math.abs(c.y + c.h - (r.y0 + inner)) < E2 + t && c.y < r.y0) faces.push({ side: "s", a: ox0 + inner, b: ox1 - inner, open: true });
          else if (Math.abs(c.y - (r.y1 - inner)) < E2 + t && c.y > r.y0) faces.push({ side: "n", a: ox0 + inner, b: ox1 - inner, open: true });
        }
        if (oy1 - oy0 > 0.8) {
          if (Math.abs(c.x + c.w - (r.x0 + inner)) < E2 + t && c.x < r.x0) faces.push({ side: "e", a: oy0 + inner, b: oy1 - inner, open: true });
          else if (Math.abs(c.x - (r.x1 - inner)) < E2 + t && c.x > r.x0) faces.push({ side: "w", a: oy0 + inner, b: oy1 - inner, open: true });
        }
      }
    }
    if (!faces.length) { extra(c); continue; }
    const f = faces.find((q) => q.open) || faces[0];
    const clip = (v) => [f.a, f.b];
    const [A, B] = clip();
    const m = (A + B) / 2;
    if (c.kind === "stair") {
      // into the staircase, the way of escape; a scissor's two staircases each their own
      if (o.per > 1) { door(c, f.side, A + (B - A) * 0.27, 0.9, true, false, A, B); door(c, f.side, A + (B - A) * 0.73, 0.9, true, false, A, B); } else door(c, f.side, m, 0.9, true, false, A, B);
    } else if (c.kind === "lift") door(c, f.side, m, 1.0, false, true, A, B);
    else if (c.kind === "lobby") door(c, f.side, m, 0.9, true, false, A, B);
    else { door(c, f.side, m, c.kind === "riser" ? 0.6 : 0.75, false, false, A, B); if (c.kind === "riser" && c.doors.length) c.doors[c.doors.length - 1].type = "panel"; }   // a PD / riser: an access panel, not a door
    extra(c);
  }
  return core;
  // the openings added by the user (a second door, a window, an opening): each on its face, at (0 .. 1) along it
  function extra(c) {
    (c.openings || []).forEach((q, i) => {
      const horiz = q.side === "n" || q.side === "s", t = wtOf(c), len = horiz ? c.w : c.h, start = horiz ? c.x : c.y, k0 = c.doors.length;
      door(c, q.side, start + t + (len - 2 * t) * q.at, n(q.w, 0.9), c.kind === "stair" || c.kind === "lobby", q.type === "sliding" || q.type === "sliding2");
      if (c.doors.length > k0) Object.assign(c.doors[k0], { type: q.type, oi: i });
    });
  }
}

/* the walls drawn on a floor, at any angle: {path, t, m, just, openings, pieces (their solid parts as polygons), ops, rects (when square)} */
export function floorWalls(list, tDef = 0.25) {
  return (Array.isArray(list) ? list : []).filter((w) => w && Array.isArray(w.path) && w.path.length >= 2).map((w) => {
    const t = Math.max(0.05, n(w.t, tDef)), m = w.m === "blk" ? "blk" : "rc", just = w.just === "l" || w.just === "r" ? w.just : "c";
    const out = { path: WC.cleanPath(w.path.map((q) => [n(q[0]), n(q[1])])), t: r3(t), m, just, openings: (w.openings || []).map((o) => Object.assign({}, o)) };
    if (out.path.length < 2) return null;
    const G = WC.wallPieces(out);
    out.pieces = G.pieces.map((q) => q.pts.map((pt) => [r3(pt[0]), r3(pt[1])]));
    out.ops = G.ops;
    const sq = (q) => q.every((pt, i) => { const o = q[(i + 1) % 4]; return Math.abs(o[0] - pt[0]) < 1e-6 || Math.abs(o[1] - pt[1]) < 1e-6; });
    out.rects = out.pieces.every(sq) ? out.pieces.map((q) => ({ x0: Math.min(...q.map((pt) => pt[0])), y0: Math.min(...q.map((pt) => pt[1])), x1: Math.max(...q.map((pt) => pt[0])), y1: Math.max(...q.map((pt) => pt[1])), m })) : [];
    return out;
  }).filter(Boolean);
}
/* where walls cross a corridor's centre line (y = yc, from xa to xb): [[from, to]] along it, from face to face */
export function corridorCuts(fwalls, yc, xa, xb) {
  const out = [];
  for (const w of fwalls) {
    const [oa, ob] = WC.offsets(w.t, w.just);
    const hits = [];
    for (const o of [oa, ob]) {
      const P = WC.offsetPath(w.path, o);
      for (let k = 0; k < P.length - 1; k++) { const c = WC.segCross([xa, yc], [xb, yc], P[k], P[k + 1]); if (c) hits.push(xa + (xb - xa) * c.s); }
    }
    if (hits.length >= 2) { hits.sort((a, b) => a - b); for (let i = 0; i + 1 < hits.length; i += 2) out.push([r3(hits[i]), r3(hits[i + 1])]); }
  }
  return out;
}

/* a passage from a staircase's door to the corridor: out of the door at right angles, then to the corridor's edge (y0 above it,
   y1 below), round the staircase when the door faces away; its centre line, orthogonal */
export function routePassage(stair, d, o) {
  const { y0, y1 } = o, w = Number(o.width) || 1.2, t = d.t || o.cwl || 0.25;
  const M = [(d.H[0] + d.O[0]) / 2, (d.H[1] + d.O[1]) / 2], n = [-d.sn[0], -d.sn[1]];   // out of the staircase
  const A = [r3(M[0] + n[0] * t / 2), r3(M[1] + n[1] * t / 2)];                       // its outer face
  const above = stair.y + stair.h / 2 < (y0 + y1) / 2, ty = above ? y0 : y1;           // the corridor's near edge
  const out = w / 2 + 0.1, P = [A];
  if (n[0] === 0 && Math.sign(n[1]) === (above ? 1 : -1)) P.push([A[0], ty]);          // straight onto the corridor
  else if (n[1] === 0) { const B = [r3(A[0] + n[0] * out), A[1]]; P.push(B, [B[0], ty]); }   // a side face: out, then along to it
  else {
    // facing away: out, round the nearer end of the staircase, then to the corridor
    const B = [A[0], r3(A[1] + n[1] * out)], side = A[0] - stair.x < stair.x + stair.w - A[0] ? -1 : 1;
    const X = r3(side < 0 ? stair.x - out : stair.x + stair.w + out);
    P.push(B, [X, B[1]], [X, ty]);
  }
  return orthoPath(P);
}

/* a placed unit's walls in plan metres: its turned rooms through wallGeom, its doors cut; [{x0, y0, x1, y1, m}] and the door openings */
const PW = new WeakMap();   // a placed unit's walls (its own frame), kept while the layout stands (its rooms array the key)
export function placedWalls(q, at) {
  const ox = at ? at.x : q.x, oy = at ? at.y : q.y;
  let w = PW.get(q.rooms);
  if (!w) { w = placedWalls0(q); PW.set(q.rooms, w); }
  return { rects: w.rects.map((r) => ({ x0: ox + r.x0, y0: oy + r.y0, x1: ox + r.x1, y1: oy + r.y1, m: r.m })), ops: w.ops.map((s) => ({ x1: ox + s.x1, y1: oy + s.y1, x2: ox + s.x2, y2: oy + s.y2 })) };
}
function placedWalls0(q) {
  const ox = 0, oy = 0;
  const pu = { rooms: q.rooms, walls: Object.fromEntries(Object.entries(q.u.walls || {}).filter(([k2]) => k2.includes("|"))), partySides: [] };
  const ed = U.edges(pu), tOf = (e) => (e.kind === "part" ? Number(q.u.part ?? 0.075) || 0.075 : Number(q.u.wall ?? 0.15) || 0.15);
  const ops = (q.doors || []).map((d) => ({ x1: d.H[0], y1: d.H[1], x2: d.O[0], y2: d.O[1] })).map((s) => (s.x1 > s.x2 || s.y1 > s.y2 ? { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 } : s));
  const G = wallGeom(pu, ed, { tOf, isOpen: (e) => U.isOpen(pu, e), solid: (e) => U.solidPart(pu, e), openings: ops });
  return { rects: G.rects.map((r) => ({ x0: ox + r.x0, y0: oy + r.y0, x1: ox + r.x1, y1: oy + r.y1, m: r.m })), ops: ops.map((s) => ({ x1: ox + s.x1, y1: oy + s.y1, x2: ox + s.x2, y2: oy + s.y2 })) };
}

/* the core's RC walls: each piece's four bands (coreWall), the doors cut through every band at them */
export function coreWallRects(core, cwl) {
  const wtOf = (c) => (Number(c.wt) > 0 ? Number(c.wt) : cwl);
  // each door's opening through the wall it is in (and the wall of a piece sharing it)
  const cuts = core.flatMap((c) => (c.doors || []).map((d) => {
    const t = (d.t || wtOf(c)) / 2 + 0.001, horiz = Math.abs(d.H[1] - d.O[1]) < 1e-6;
    return horiz ? { x0: Math.min(d.H[0], d.O[0]), x1: Math.max(d.H[0], d.O[0]), y0: d.H[1] - t, y1: d.H[1] + t, horiz } : { y0: Math.min(d.H[1], d.O[1]), y1: Math.max(d.H[1], d.O[1]), x0: d.H[0] - t, x1: d.H[0] + t, horiz };
  }));
  const out = [];
  for (const c of core) {
    if (c.kind === "passage") continue;
    const t = wtOf(c);
    const bands = [
      { x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + t, h: true }, { x0: c.x, y0: c.y + c.h - t, x1: c.x + c.w, y1: c.y + c.h, h: true },
      { x0: c.x, y0: c.y, x1: c.x + t, y1: c.y + c.h, h: false }, { x0: c.x + c.w - t, y0: c.y, x1: c.x + c.w, y1: c.y + c.h, h: false },
    ];
    for (const b of bands) {
      let segs = b.h ? [[b.x0, b.x1]] : [[b.y0, b.y1]];
      for (const k of cuts) {
        if (k.horiz !== b.h) continue;
        if (b.h ? !(k.y0 <= b.y0 + 1e-6 && k.y1 >= b.y1 - 1e-6) : !(k.x0 <= b.x0 + 1e-6 && k.x1 >= b.x1 - 1e-6)) continue;
        const [k0, k1] = b.h ? [k.x0, k.x1] : [k.y0, k.y1];
        segs = segs.flatMap(([p, q]) => (k1 <= p || k0 >= q ? [[p, q]] : [[p, k0], [k1, q]].filter(([u, v]) => v - u > 1e-6)));
      }
      for (const [p, q] of segs) out.push(b.h ? { x0: p, y0: b.y0, x1: q, y1: b.y1, m: "rc" } : { x0: b.x0, y0: p, x1: b.x1, y1: q, m: "rc" });
    }
  }
  return out;
}
void outlineOf;

/* a unit at (x, y) inside a plate: each room out to its walls' outer faces (less 60 mm, so a plate traced on them passes), tested
   at its corners and every metre along its edges; its balcony, UP and A/C platform are not tested */
export function unitInside(poly, x, y, rooms, wall) {
  const g = (wall || 0) / 2 - 0.06;
  for (const r of rooms) {
    const x0 = x + r.x - g, y0 = y + r.y - g, x1 = x + r.x + r.w + g, y1 = y + r.y + r.h + g;
    const nx = Math.max(1, Math.ceil(x1 - x0)), ny = Math.max(1, Math.ceil(y1 - y0));
    for (let i = 0; i <= nx; i++) for (const yy of [y0, y1]) if (!inPoly(poly, x0 + (x1 - x0) * i / nx, yy)) return false;
    for (let j = 0; j <= ny; j++) for (const xx of [x0, x1]) if (!inPoly(poly, xx, y0 + (y1 - y0) * j / ny)) return false;
  }
  return true;
}

/* a passage's shape: its centre line (path, orthogonal segments) and clear width; one made from its box when it has none
   (down the middle of its longer side). Sets c.path, c.width, c.rects (a rectangle a segment, squared at the bends) and its box. */
export function passageShape(c) {
  if (!Array.isArray(c.path) || c.path.length < 2) {
    if (c.h >= c.w) { c.width = r3(c.w); c.path = [[r3(c.x + c.w / 2), r3(c.y + c.h)], [r3(c.x + c.w / 2), r3(c.y)]]; }
    else { c.width = r3(c.h); c.path = [[r3(c.x), r3(c.y + c.h / 2)], [r3(c.x + c.w), r3(c.y + c.h / 2)]]; }
  }
  c.path = orthoPath(c.path);
  const hw = n(c.width, 1.2) / 2, P = c.path;
  c.rects = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1];
    const ea = i > 0 ? hw : 0, eb = i < P.length - 2 ? hw : 0;   // squared at the bends, flush at the ends
    if (Math.abs(ax - bx) < 1e-6) { const lo = Math.min(ay, by), hi = Math.max(ay, by), e0 = ay < by ? ea : eb, e1 = ay < by ? eb : ea; c.rects.push({ x0: ax - hw, x1: ax + hw, y0: lo - e0, y1: hi + e1 }); }
    else { const lo = Math.min(ax, bx), hi = Math.max(ax, bx), e0 = ax < bx ? ea : eb, e1 = ax < bx ? eb : ea; c.rects.push({ x0: lo - e0, x1: hi + e1, y0: ay - hw, y1: ay + hw }); }
  }
  const x0 = Math.min(...c.rects.map((r) => r.x0)), y0 = Math.min(...c.rects.map((r) => r.y0)), x1 = Math.max(...c.rects.map((r) => r.x1)), y1 = Math.max(...c.rects.map((r) => r.y1));
  Object.assign(c, { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) });
  return c;
}
/* a path made orthogonal: a slanting segment turned into two (across, then along), points on one line merged */
export function orthoPath(P0) {
  const P = [];
  for (const pt of P0) {
    const q = [r3(pt[0]), r3(pt[1])], last = P[P.length - 1];
    if (last && Math.abs(last[0] - q[0]) > 1e-6 && Math.abs(last[1] - q[1]) > 1e-6) P.push([q[0], last[1]]);
    if (!last || Math.abs(last[0] - q[0]) > 1e-6 || Math.abs(last[1] - q[1]) > 1e-6) P.push(q);
  }
  return P;   // a point in line with its neighbours is kept: a bend still to be dragged out
}

/* a floor's stored positions moved by (du, dv) in the plate frame: when an edit of the plate moves the frame's origin, so that the
   units, core, walls and grid stay where they were */
export function shiftFrame(f, du, dv) {
  if (!f || (!du && !dv)) return f;
  const R = (v) => Math.round(v * 1000) / 1000;
  const bent = !!(f.spine && Array.isArray(f.spine.path) && f.spine.path.length >= 2);
  // a bending corridor's legs keep their pieces and units from the spine, which moves with the frame
  if (bent) f.spine.path = f.spine.path.map(([x, y]) => [R(x + du), R(y + dv)]);
  if (!bent) for (const q of f.pieces || []) {
    if (q.x != null) q.x = R(q.x + du); if (q.y != null) q.y = R(q.y + dv);
    if (Array.isArray(q.path)) q.path = q.path.map(([x, y]) => [R(x + du), R(y + dv)]);
  }
  for (const band of ["s", "n"]) for (const e of (f.seq && f.seq[band]) || []) if (e.x != null) e.x = R(e.x + du);
  for (const w of f.walls || []) if (Array.isArray(w.path)) w.path = w.path.map(([x, y]) => [R(x + du), R(y + dv)]);
  if (f.gridOX != null && f.gridOX !== "") f.gridOX = R(Number(f.gridOX) + du);
  else if (du && Number(f.gridX) > 0) f.gridOX = R(du);
  if (f.gridOY != null && f.gridOY !== "") f.gridOY = R(Number(f.gridOY) + dv);
  else if (dv && Number(f.gridY) > 0) f.gridOY = R(dv);
  if (f.corrY != null) f.corrY = R(Number(f.corrY) + dv);
  return f;
}

/* the outline round a set of convex shapes (the units' rooms out to their walls' faces, the core, the corridor), in one
   frame: the shapes filled on a grid of cell, the gaps and notches narrower than gap closed, holes filled, the largest
   piece's outer edge traced, straightened (Douglas-Peucker) and its corners put back on the shapes' own corners near them */
export function hugOutline(shapes, gap = 0.5, cell = 0.05) {
  const S2 = (shapes || []).filter((q) => q && q.length >= 3);
  if (!S2.length) return null;
  const all = S2.flat(), pad = gap + 3 * cell;
  const X0 = Math.min(...all.map((p) => p[0])) - pad, Y0 = Math.min(...all.map((p) => p[1])) - pad;
  const nx = Math.ceil((Math.max(...all.map((p) => p[0])) + pad - X0) / cell), ny = Math.ceil((Math.max(...all.map((p) => p[1])) + pad - Y0) / cell);
  let G = new Uint8Array(nx * ny);
  // each convex shape: a row's span between its edges at the cells' middle
  for (const Q of S2) {
    const ya = Math.min(...Q.map((p) => p[1])), yb = Math.max(...Q.map((p) => p[1]));
    for (let j = Math.max(0, Math.floor((ya - Y0) / cell)); j <= Math.min(ny - 1, Math.ceil((yb - Y0) / cell)); j++) {
      const cy = Y0 + (j + 0.5) * cell; let a = Infinity, b = -Infinity;
      for (let k = 0; k < Q.length; k++) { const p = Q[k], q = Q[(k + 1) % Q.length]; if ((p[1] > cy) !== (q[1] > cy)) { const x = p[0] + (cy - p[1]) * (q[0] - p[0]) / (q[1] - p[1]); a = Math.min(a, x); b = Math.max(b, x); } }
      if (a > b) continue;
      for (let i = Math.max(0, Math.round((a - X0) / cell)); i < Math.min(nx, Math.round((b - X0) / cell)); i++) G[j * nx + i] = 1;
    }
  }
  // the closing: grown by r cells then shrunk by r (a square; rows then columns, each by a running count)
  const r = Math.max(0, Math.round(gap / 2 / cell));
  const pass = (A, want) => {
    const out = new Uint8Array(A.length);
    const tmp = new Uint8Array(A.length);
    for (let j = 0; j < ny; j++) { let c = 0; for (let i = -r; i < nx + r; i++) { const add = i + r, rem = i - r - 1; if (add < nx && A[j * nx + add] === want) c++; if (rem >= 0 && rem < nx && A[j * nx + rem] === want) c--; if (i >= 0 && i < nx) tmp[j * nx + i] = c > 0 ? want : 1 - want; } }
    for (let i = 0; i < nx; i++) { let c = 0; for (let j = -r; j < ny + r; j++) { const add = j + r, rem = j - r - 1; if (add < ny && tmp[add * nx + i] === want) c++; if (rem >= 0 && rem < ny && tmp[rem * nx + i] === want) c--; if (j >= 0 && j < ny) out[j * nx + i] = c > 0 ? want : 1 - want; } }
    return out;
  };
  if (r > 0) G = pass(pass(G, 1), 0);
  // holes filled: what of the outside the border does not reach is inside
  const outside = new Uint8Array(G.length), st = [];
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) if (!G[j * nx + i]) { outside[j * nx + i] = 1; st.push(j * nx + i); }
  for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) if (!G[j * nx + i] && !outside[j * nx + i]) { outside[j * nx + i] = 1; st.push(j * nx + i); }
  while (st.length) { const c = st.pop(), i = c % nx, j = (c - i) / nx; for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const k = b * nx + a; if (!G[k] && !outside[k]) { outside[k] = 1; st.push(k); } } }
  // the largest piece
  const lab = new Int32Array(G.length); let best = 0, bestN = 0, id = 0;
  for (let k = 0; k < G.length; k++) {
    if (outside[k] || lab[k]) continue;
    id++; let n2 = 0; const s3 = [k]; lab[k] = id;
    while (s3.length) { const c = s3.pop(), i = c % nx, j = (c - i) / nx; n2++; for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) { if (a < 0 || b < 0 || a >= nx || b >= ny) continue; const q = b * nx + a; if (!outside[q] && !lab[q]) { lab[q] = id; s3.push(q); } } }
    if (n2 > bestN) { bestN = n2; best = id; }
  }
  if (!best) return null;
  const inn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && lab[j * nx + i] === best;
  // its outer edge: the cell sides with it on the left, chained (corners kept where the edge turns)
  const nxt = new Map(), K = (i, j) => i + "," + j;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    if (inn(i, j) && !inn(i, j - 1)) nxt.set(K(i, j) + ">", [i + 1, j]);        // top side, going +x
    if (inn(i - 1, j - 1) && !inn(i - 1, j)) nxt.set(K(i, j) + "<", [i - 1, j]); // bottom side of the cell above-left, going -x
    if (inn(i - 1, j) && !inn(i, j)) nxt.set(K(i, j) + "v", [i, j + 1]);        // right side, going +y
    if (inn(i, j - 1) && !inn(i - 1, j - 1)) nxt.set(K(i, j) + "^", [i, j - 1]);  // left side, going -y
  }
  // start at the top-left most top side, walk keeping the inside on the right of the direction (y down: clockwise on screen)
  let s0 = null; for (const k of nxt.keys()) if (k.endsWith(">")) { const [i, j] = k.slice(0, -1).split(",").map(Number); if (!s0 || j < s0[1] || (j === s0[1] && i < s0[0])) s0 = [i, j]; }
  if (!s0) return null;
  const ring = []; let cur = s0, dir = ">", guard = 0;
  const turnOrder = { ">": ["v", ">", "^"], "v": ["<", "v", ">"], "<": ["^", "<", "v"], "^": [">", "^", "<"] };
  do {
    const nq = nxt.get(K(cur[0], cur[1]) + dir); if (!nq) break;
    ring.push(cur); cur = nq;
    const d2 = turnOrder[dir].find((d) => nxt.has(K(cur[0], cur[1]) + d)); if (!d2) break; dir = d2;
  } while (!(cur[0] === s0[0] && cur[1] === s0[1] && dir === ">") && guard++ < 1e6);
  // corners only, then straightened
  let P = ring.map(([i, j]) => [X0 + i * cell, Y0 + j * cell]);
  const col = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-9;
  P = P.filter((p, k) => !col(P[(k - 1 + P.length) % P.length], p, P[(k + 1) % P.length]));
  const dp = (pts, tol) => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; let mi = 0, md = 0;
    for (let k = 1; k < pts.length - 1; k++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[k][1]) - (a[0] - pts[k][0]) * (b[1] - a[1])) / L; if (d > md) { md = d; mi = k; } }
    return md > tol ? [...dp(pts.slice(0, mi + 1), tol).slice(0, -1), ...dp(pts.slice(mi), tol)] : [a, b];
  };
  // split the closed ring at its two farthest points, straighten each half
  let fi = 0; for (let k = 1; k < P.length; k++) if (Math.hypot(P[k][0] - P[0][0], P[k][1] - P[0][1]) > Math.hypot(P[fi][0] - P[0][0], P[fi][1] - P[0][1])) fi = k;
  P = [...dp(P.slice(0, fi + 1), cell * 1.2).slice(0, -1), ...dp([...P.slice(fi), P[0]], cell * 1.2).slice(0, -1)];
  // each edge put on the shapes' face it follows: the outermost face parallel to it (within 1 degree) and within 1.5 cells,
  // its corners where the edges' lines then cross; an edge on no face (across a gap closed) stays where the grid put it
  const segs = [];
  for (const Sh of S2) for (let k = 0; k < Sh.length; k++) { const a = Sh[k], b = Sh[(k + 1) % Sh.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 1e-6) segs.push([a, b, [(b[0] - a[0]) / L, (b[1] - a[1]) / L]]); }
  const off = (a, p, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9; return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L; };
  const tidy = (Q) => { for (let again = true; again && Q.length > 3;) { again = false; for (let k = 0; k < Q.length; k++) { const a = Q[(k - 1 + Q.length) % Q.length], b = Q[(k + 1) % Q.length]; if (off(a, Q[k], b) < 0.006 || Math.hypot(Q[k][0] - b[0], Q[k][1] - b[1]) < 1e-4) { Q.splice(k, 1); again = true; break; } } } return Q; };
  P = tidy(P.map((p) => [p[0], p[1]]));
  // the edges as lines: a direction d, the outward normal o (the ring keeps its inside on the right, y down), the offset c = o . p
  const lines = P.map((p, k) => { const q = P[(k + 1) % P.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9, d = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], o = [d[1], -d[0]]; return { d, o, c: o[0] * p[0] + o[1] * p[1], a: p, b: q }; });
  const sin1 = Math.sin(3 * Math.PI / 180);
  for (const ln of lines) {
    const t0 = Math.min(ln.d[0] * ln.a[0] + ln.d[1] * ln.a[1], ln.d[0] * ln.b[0] + ln.d[1] * ln.b[1]), t1 = Math.max(ln.d[0] * ln.a[0] + ln.d[1] * ln.a[1], ln.d[0] * ln.b[0] + ln.d[1] * ln.b[1]);
    let best = null;
    for (const [a, b, d] of segs) {
      if (Math.abs(d[0] * ln.d[1] - d[1] * ln.d[0]) > sin1) continue;
      const c2 = ln.o[0] * a[0] + ln.o[1] * a[1]; if (Math.abs(c2 - ln.c) > cell * 2) continue;
      const s0 = Math.min(ln.d[0] * a[0] + ln.d[1] * a[1], ln.d[0] * b[0] + ln.d[1] * b[1]), s1 = Math.max(ln.d[0] * a[0] + ln.d[1] * a[1], ln.d[0] * b[0] + ln.d[1] * b[1]);
      if (Math.min(s1, t1) - Math.max(s0, t0) < Math.min(0.05, (t1 - t0) / 2)) continue;
      if (best == null || c2 > best) best = c2;
    }
    if (best != null) { ln.c = best; ln.on = true; } else ln.c = ln.c + cell * 0.5;   // across a gap: half a cell out, clear of what it closes
    // a snapped edge takes its face's own direction
    if (best != null) { const f = segs.find(([a, b, d]) => Math.abs(d[0] * ln.d[1] - d[1] * ln.d[0]) <= sin1 && Math.abs(ln.o[0] * a[0] + ln.o[1] * a[1] - best) < 1e-9); if (f) { const sg = f[2][0] * ln.d[0] + f[2][1] * ln.d[1] >= 0 ? 1 : -1; ln.d = [f[2][0] * sg, f[2][1] * sg]; ln.o = [ln.d[1], -ln.d[0]]; ln.c = ln.o[0] * f[0][0] + ln.o[1] * f[0][1]; } }
  }
  // a short step the grid left between two edges on faces (at a turned corner): dropped, its neighbours meet
  for (let again = true; again && lines.length > 3;) { again = false; for (let k = 0; k < lines.length; k++) { const A = lines[(k - 1 + lines.length) % lines.length], B = lines[k], Cn = lines[(k + 1) % lines.length]; if (!B.on && (A.on || Cn.on) && Math.hypot(B.b[0] - B.a[0], B.b[1] - B.a[1]) < cell * 8 && Math.abs(A.d[0] * Cn.d[1] - A.d[1] * Cn.d[0]) > 0.05) { lines.splice(k, 1); again = true; break; } } }
  // edges next to each other on the same face: one
  for (let k = lines.length - 1; k > 0 && lines.length > 3; k--) { const A = lines[k - 1], B = lines[k]; if (A.on && B.on && Math.abs(A.d[0] * B.d[1] - A.d[1] * B.d[0]) < 1e-9 && A.d[0] * B.d[0] + A.d[1] * B.d[1] > 0 && Math.abs(A.c - B.c) < 1e-6) lines.splice(k, 1); }
  const corners = () => lines.map((B, k) => { const A = lines[(k - 1 + lines.length) % lines.length], det = A.o[0] * B.o[1] - A.o[1] * B.o[0];
    if (Math.abs(det) < 1e-9) { const p = B.a, t = B.c - (B.o[0] * p[0] + B.o[1] * p[1]); return [p[0] + B.o[0] * t, p[1] + B.o[1] * t]; }
    return [(A.c * B.o[1] - A.o[1] * B.c) / det, (A.o[0] * B.c - A.c * B.o[0]) / det]; });
  // every shape inside: points along each face, 50 mm in from it; one outside pushes the edge nearest it out to it
  const probes = [];
  const inPiece = (Sh) => { const cx = Sh.reduce((a2, p) => a2 + p[0], 0) / Sh.length, cy = Sh.reduce((a2, p) => a2 + p[1], 0) / Sh.length, i = Math.floor((cx - X0) / cell), j = Math.floor((cy - Y0) / cell); return inn(i, j); };
  for (const Sh of S2.filter(inPiece)) {
    const cx = Sh.reduce((a2, p) => a2 + p[0], 0) / Sh.length, cy = Sh.reduce((a2, p) => a2 + p[1], 0) / Sh.length;
    for (let k = 0; k < Sh.length; k++) {
      const a = Sh[k], b = Sh[(k + 1) % Sh.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n3 = Math.max(1, Math.ceil(L / 0.25));
      for (let i = 0; i <= n3; i++) { const p = [a[0] + (b[0] - a[0]) * i / n3, a[1] + (b[1] - a[1]) * i / n3], d = Math.hypot(cx - p[0], cy - p[1]) || 1, e = Math.min(0.05, d / 2); probes.push([p[0] + (cx - p[0]) / d * e, p[1] + (cy - p[1]) / d * e]); }
    }
  }
  let Q = corners();
  for (let it = 0; it < 4; it++) {
    const bad = probes.filter((v) => !inPoly(Q, v[0], v[1])); if (!bad.length) break;
    for (const v of bad) {
      let bk = -1, bd = Infinity;
      for (let k = 0; k < Q.length; k++) { const a = Q[k], b = Q[(k + 1) % Q.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2)), d = Math.hypot(a[0] + t * dx - v[0], a[1] + t * dy - v[1]); if (d < bd) { bd = d; bk = k; } }
      const ln = lines[bk];   // edge bk runs from corner bk to corner bk + 1: line bk
      const need = ln.o[0] * v[0] + ln.o[1] * v[1] + 0.051; if (need > ln.c) ln.c = need;
    }
    Q = corners();
  }
  // corners are where line k-1 meets line k: corner k starts edge k
  P = tidy(Q.map((p) => [r3(p[0]), r3(p[1])]));
  return P.length >= 3 ? P : null;
}
