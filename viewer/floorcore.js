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
    doors.push(Object.assign({ H: P(H), O: P(O), sn: [Math.round(sn[0]), Math.round(sn[1])], w, entry: !!d.entry }, d.type === "sliding" || d.type === "sliding2" ? { type: d.type, flip: d.hinge === "end" } : {}));
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
  const lf = lifts({ floors: n(p.floorsAbove, n(p.storeys, 1)), population: popFloor * n(p.storeys, 1), car: p.car, storeyH: p.storeyH, hc5: p.hc5, interval: p.interval });
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
  if (p.core === "behind") {
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
      if (Number(c.wt) > 0) q.wt = r3(Number(c.wt));
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
      for (let nudge = 0; nudge < 40; nudge++) {
        const x = end === "l" ? run.l + nudge * 0.25 : run.r - t.W - nudge * 0.25;
        if (x < run.l - 1e-6 || x + t.W > run.r + 0.01) break;
        const y = band === "s" ? y1 + t.wall / 2 : y0 - t.D - t.wall / 2, box = { x: r3(x), y: r3(y), w: t.W, h: t.D };
        if (!insideUnit(box.x, box.y, t.rooms, t.wall)) continue;
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
    if (!insideUnit(q.x, q.y, q.rooms, q.wt)) q.flags.push("outside the plate");
    for (const [j, o] of placed.entries()) if (j !== i && ov(q, o) && unitsOv(q, o)) { q.flags.push("overlaps " + (o.name || "a unit")); break; }
    const c = core.find((cc) => roomsOv(q, cc, cwl / 2 + 0.05)); if (c) q.flags.push("overlaps " + c.label);
    if (q.r % 360) q.flags.push("entrance not on the corridor");
    for (const fl of q.flags) issues.push(`${q.name}: ${fl}`);
  }
  for (const [i, c] of core.entries()) {
    c.flags = [];
    if (!inside(c)) c.flags.push("outside the plate");
    for (const [j, o] of core.entries()) if (j > i && ov(c, o, cwl + 0.05)) c.flags.push("overlaps " + o.label);
    for (const fl of c.flags) issues.push(`${c.label}: ${fl}`);
  }
  const seqOut = { s: placed.filter((q) => q.band === "s").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })), n: placed.filter((q) => q.band === "n").sort((a, b) => a.si - b.si).map((q) => ({ u: q.name, m: q.m })) };
  // those that did not fit stay in the edited floor (listed as not placed) so it still matches the mix
  if (!SEQ) for (const q of left) seqOut.s.push({ u: q.u.name, m: false });
  // areas
  const plate = Math.abs(area(F.poly));
  // walls drawn on the floor (closing off what is not units or core): a rectangle a run at their thickness, squared at the bends
  const fwalls = (Array.isArray(p.walls) ? p.walls : []).filter((w) => Array.isArray(w.path) && w.path.length >= 2).map((w) => {
    const t = Math.max(0.05, n(w.t, cwl)), sh = passageShape({ path: w.path.map((q) => [n(q[0]), n(q[1])]), width: t });
    return { path: sh.path, t: r3(t), m: w.m === "blk" ? "blk" : "rc", rects: sh.rects.map((q) => Object.assign({ m: w.m === "blk" ? "blk" : "rc" }, q)) };
  });
  // a wall across the corridor cuts it: the corridor is the part between the cuts that holds the core (its lifts, else its middle)
  const coreMid = (() => { const ls = core.filter((c) => c.kind === "lift"), P = ls.length ? ls : core; return P.length ? P.reduce((a, c) => a + c.x + c.w / 2, 0) / P.length : L / 2; })();
  const cuts = fwalls.flatMap((w) => w.rects).filter((q) => q.y0 <= y0 + 0.05 && q.y1 >= y1 - 0.05 && q.x1 - q.x0 < 1.5).map((q) => [q.x0, q.x1]);
  let cx0 = 0, cx1 = L;
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
  const fwallA = unionArea(fwalls.flatMap((w) => w.rects));
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
    ...fwalls.flatMap((w) => w.rects),
  ]);
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
    jpn1: { lobby: llob, corrW: r3(exCorrW), lobW: r3(exLobW), corrLen: r3(Math.max(0, corrLen - lobLen)), lobLen: r3(lobLen) },
    corr: { x0: r3(cx0), x1: r3(cx1) }, walls: fwalls, fwallA: r3(fwallA),
    coreOut: core.map((c) => Object.assign({ kind: c.kind, label: c.label, x: c.x, y: c.y, w: c.w, h: c.h, full: true }, c.path ? { path: c.path.map((q) => q.slice()), width: c.width } : {}, c.for ? { for: c.for, auto: c.auto !== false } : {}, c.door ? { door: Object.assign({}, c.door) } : {}, Number(c.wt) > 0 ? { wt: c.wt } : {})), residuals, persons: { factor: fac, floor: popFloor }, coreAuto, coreEdited, issues, frameAxis: { ux: F.ux, uy: F.uy },
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

/* what of the plate nothing covers: connected regions of cells, each {area, box, at (its largest cell's middle), cells};
   slivers (under 0.5 m2, or under 0.4 m across) left out */
export function residualRegions(poly, rects, minA = 0.5, minW = 0.4) {
  const xs = [...new Set([...poly.map((p) => p[0]), ...rects.flatMap((r) => [r.x0, r.x1])].map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set([...poly.map((p) => p[1]), ...rects.flatMap((r) => [r.y0, r.y1])].map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1, free = new Uint8Array(Math.max(0, nx * ny)), cov = new Uint8Array(free.length);
  rasterise(xs, ys, rects, (c) => { cov[c] = 1; });
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
    const rc = cells.map(([i, j]) => { const r = { x0: xs[i], y0: ys[j], x1: xs[i + 1], y1: ys[j + 1] }; const a = (r.x1 - r.x0) * (r.y1 - r.y0); area += a; if (!big || a > big.a) big = Object.assign({ a }, r); bx0 = Math.min(bx0, r.x0); by0 = Math.min(by0, r.y0); bx1 = Math.max(bx1, r.x1); by1 = Math.max(by1, r.y1); return r; });
    if (area < minA || Math.min(big.x1 - big.x0, big.y1 - big.y0) < minW) continue;
    out.push({ area: r3(area), box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, at: [(big.x0 + big.x1) / 2, (big.y0 + big.y1) / 2], cells: rc });
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
    if (!faces.length) continue;
    const f = faces.find((q) => q.open) || faces[0];
    const clip = (v) => [f.a, f.b];
    const [A, B] = clip();
    const m = (A + B) / 2;
    if (c.kind === "stair") {
      // into the staircase, the way of escape; a scissor's two staircases each their own
      if (o.per > 1) { door(c, f.side, A + (B - A) * 0.27, 0.9, true, false, A, B); door(c, f.side, A + (B - A) * 0.73, 0.9, true, false, A, B); } else door(c, f.side, m, 0.9, true, false, A, B);
    } else if (c.kind === "lift") door(c, f.side, m, 1.0, false, true, A, B);
    else if (c.kind === "lobby") door(c, f.side, m, 0.9, true, false, A, B);
    else door(c, f.side, m, 0.75, false, false, A, B);
  }
  return core;
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
  for (const q of f.pieces || []) {
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
