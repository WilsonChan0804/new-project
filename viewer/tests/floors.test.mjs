/* node viewer/tests/floors.test.mjs - stage 4: a typical floor */
import * as U from "../unitcore.js";
import * as F from "../floorcore.js";
import { TEMPLATES } from "../unittables.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;

// the plate's long axis, whatever way it is turned
const rot = (P, t) => P.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t) + 100, x * Math.sin(t) + y * Math.cos(t) - 40]);
const box = [[0, 0], [48, 0], [48, 16], [0, 16]];
const fr = F.frame(rot(box, 0.7));
ok(near(fr.L, 48, 1e-6) && near(fr.D, 16, 1e-6), "the frame of a 48 × 16 m plate turned 40°: 48 along, 16 across");
ok(fr.poly.every(([u, v]) => u > -1e-6 && u < 48 + 1e-6 && v > -1e-6 && v < 16 + 1e-6), "the plate in its own frame");
const back = fr.from(fr.to([105, -30]));
ok(near(back[0], 105, 1e-9) && near(back[1], -30, 1e-9), "to and from the frame");

// a quarter turn keeps the room areas
const t = F.turn(TEMPLATES["2R-B"], 1), a0 = TEMPLATES["2R-B"].rooms.reduce((s, r) => s + r.w * r.h, 0);
ok(near(t.rooms.reduce((s, r) => s + r.w * r.h, 0), a0, 1e-6) && t.rooms.every((r) => r.x >= -1e-9 && r.y >= -1e-9), "a unit turned 90°: the same rooms, from (0, 0)");

// the lifts: a round trip by CIBSE Guide D
const lf = F.lifts({ floors: 30, population: 30 * 10 * 3, car: 13, storeyH: 3.15, hc5: 6, interval: 60 });
ok(lf.speed === 3.5 && lf.rtt > 120 && lf.rtt < 240 && lf.n >= 3, `30 floors, 900 persons: ${lf.n} lifts, round trip ${lf.rtt} s at ${lf.speed} m/s`);
ok(lf.hc5 >= 6 - 1e-9 && lf.interval <= 60, "they carry 6% in 5 minutes at an interval of 60 s or less");
ok(F.lifts({ floors: 6, population: 60, interval: 120 }).n === 1 && F.lifts({ floors: 12, population: 100, interval: 300 }).n === 2, "a low block may have one lift; over 30 m of travel at least two");

// the layout
const mix = [{ u: TEMPLATES["2R-B"], n: 4 }, { u: TEMPLATES["3R-A"], n: 2 }, { u: TEMPLATES["1R-B"], n: 4 }];
const L = F.layout({ poly: rot(box, 0.3), mix, storeys: 30 });
const ov = (a, b, t = 0.01) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > t && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > t;
const cwl = 0.25;
ok(L.placed.length >= 8 && !L.placed.some((a, i) => L.placed.some((b, j) => j > i && ov(a, b))) && !L.placed.some((a) => L.core.some((c) => ov(a, c, cwl / 2 + 0.01))), `${L.placed.length} units and the core placed, nothing overlapping`);
ok(!L.core.some((a, i) => L.core.some((b, j) => j > i && ov(a, b, cwl + 0.01))), "the core's pieces overlap by no more than their shared wall");
const nb = L.core.filter((c) => c.y + c.h === L.y0).sort((a, b) => a.x - b.x);
ok(nb.slice(1).every((c, k) => near(c.x, nb[k].x + nb[k].w - cwl, 1e-6)), "pieces side by side share one wall: each overlaps the one before by 250 mm");
ok(L.placed.every((q) => (q.band === "s" ? near(q.y - q.wt / 2, L.y1, 1e-6) : near(q.y + q.h + q.wt / 2, L.y0, 1e-6))), "every unit on the corridor, its wall's face on the corridor's edge");
ok(L.core.filter((c) => c.kind === "stair").length === 2 && L.core.filter((c) => c.kind === "lift").length === L.nL, "two staircases and the lifts in the core");
const Fg = L.figures;
ok(near(Fg.plate, 48 * 16, 1e-6) && near(Fg.residual, L.residuals.reduce((s, q) => s + q.area, 0), 1e-3) && L.residuals.every((q) => q.area >= 0.5), "the residual: the regions left of the plate, slivers aside (" + L.residuals.length + ", " + Fg.residual + " m²)");
{ // a residual region is not covered by any unit or core piece
  const hit = L.residuals.some((z) => z.cells.some((c) => { const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2; return L.core.some((k) => cx > k.x && cx < k.x + k.w && cy > k.y && cy < k.y + k.h); }));
  ok(!hit, "no residual cell under the core");
}
ok(near(Fg.gfa, Fg.unitGfa + Fg.corridor + Fg.stair + Fg.lift + Fg.coreWalls + Fg.partyWalls, 1e-3), "the floor GFA: units + corridor + staircases + lift shafts + the walls (refuse, riser, residual exempt)");
// the staircase from the storey height, riser and going; the walls between
{
  const st = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.175, going: 0.25 });
  ok(st.risers === 18 && near(st.riser, 0.175, 1e-9) && st.t1 === 8 && near(st.run, 2.0, 1e-9) && near(st.W, 2.5, 1e-9) && near(st.D, 4.4, 1e-9), `3.15 m, 1.2 m wide, 175 / 250: ${st.risers} risers, ${st.t1} treads a flight, run ${st.run}, inside ${st.W} × ${st.D} m`);
  const lo = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.16, going: 0.25 });
  ok(lo.risers === 20 && lo.D > st.D, "a lower riser (160): more steps, a longer staircase");
  const Lw = F.layout({ poly: [[0, 0], [48, 0], [48, 16], [0, 16]], mix, storeys: 30, partyWall: 0.3 });
  const sS = Lw.placed.filter((q) => q.band === "s").sort((a, b) => a.x - b.x);
  ok(sS.length > 1 && near(sS[1].x - (sS[0].x + sS[0].w), 0.15, 1e-6) && Lw.figures.partyWalls > 0, "a 300 mm party wall between units: 150 mm more than the plans hold (they hold half of 150 each)");
  const stairPiece = Lw.core.find((c) => c.kind === "stair");
  ok(near(stairPiece.w, st.W + 0.5, 1e-6) && Lw.figures.coreWalls > 0, "a staircase piece: its inside and the RC core wall");
}
{
  // staircase types: 2 risers on the half landing shorten the flights; a scissor holds two staircases in one enclosure
  const d1 = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.175, going: 0.25 }), d2 = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.175, going: 0.25, type: "dogleg2" });
  ok(d2.n1 + d2.n2 + d2.land2 === d2.risers && d2.D < d1.D && d2.count === 1, "dog-leg with 2 risers on the half landing: " + d2.n1 + " + " + d2.n2 + " + 2 risers, " + d2.D + " m long against " + d1.D);
  const sc = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.175, going: 0.25, type: "scissor" });
  ok(sc.count === 2 && sc.t1 === sc.risers - 1 && Math.abs(sc.W - 2.6) < 1e-9, "scissor: one flight of " + sc.t1 + " treads each, 2 staircases in " + sc.W + " m");
  const Ls = F.layout({ poly: [[0, 0], [48, 0], [48, 16], [0, 16]], mix, storeys: 30, stairType: "scissor" });
  ok(Ls.core.filter((c) => c.kind === "stair").length === 1 && Ls.nS === 2, "a scissor: one enclosure counted as two staircases");
  const Ld = F.layout({ poly: [[0, 0], [48, 0], [48, 16], [0, 16]], mix, storeys: 30 });
  ok(Ls.figures.stair < Ld.figures.stair, "and less staircase area than two dog-legs: " + Ls.figures.stair + " < " + Ld.figures.stair);
  const Lb = F.layout({ poly: [[0, 0], [48, 0], [48, 18], [0, 18]], mix, storeys: 30, core: "behind" });
  const pa = Lb.core.find((c) => c.kind === "passage"), sA = Lb.core.find((c) => c.kind === "stair"), lf = Lb.core.find((c) => c.kind === "lift");
  ok(pa && sA && sA.y + sA.h <= lf.y + 0.25 + 1e-6 && Math.abs(pa.x - sA.x) < 1e-6 && Math.abs(pa.y + pa.h - Lb.y0) < 1e-6 && Math.abs(pa.y - (sA.y + sA.h)) < 1e-6, "behind the lifts: the staircase behind them, a passage from the corridor beside the lifts to it");
  ok(Lb.figures.corridor > Ld.figures.corridor - 1e-6 + pa.w * pa.h - 0.01, "the passage counted with the corridor");
}
const W = F.layout({ poly: rot(box, 0.3), mix, storeys: 30, corridor: 2.0 });
ok(near(W.figures.wideEx, (2.0 - 1.5) * W.jpn1.corrLen, 1e-6) && near(W.jpn1.corrLen + W.jpn1.lobLen, 48, 1e-6), "a 2 m corridor: 0.5 m of its width exempt along the corridor (48 m less the lift lobby " + W.jpn1.lobLen + " m)");
ok(W.figures.lobbyEx === 0, "a 2 m lift lobby: nothing over its 2.0 m minimum");
{
  for (const [cw2, ce, le] of [[1.5, 0, 0], [1.8, 0.3, 0], [2.6, 0.9, 0.6]]) {
    const Z = F.layout({ poly: rot(box, 0.3), mix, storeys: 30, corridor: cw2 });
    ok(near(Z.figures.wideEx, ce * Z.jpn1.corrLen, 1e-6) && near(Z.figures.lobbyEx, le * Z.jpn1.lobLen, 1e-6) && Z.jpn1.lobLen > 0, `corridor ${cw2} m: corridor ${ce} m × ${Z.jpn1.corrLen}, lift lobby ${le} m × ${Z.jpn1.lobLen} exempt`);
  }
}
const MiC = F.layout({ poly: rot(box, 0.3), mix, storeys: 30, mic: true, micPct: 10 });
ok(near(MiC.figures.gfa, Fg.gfa * 0.9, 1e-3), "MiC at 10%: the floor GFA less 10%");
ok(L.checks.some((c) => /Staircases/.test(c.what) && c.ok) && L.checks.some((c) => /Travel/.test(c.what)), "the checks: staircases (Table B3) and travel");
const far = F.layout({ poly: [[0, 0], [90, 0], [90, 16], [0, 16]], mix: [{ u: TEMPLATES["2R-B"], n: 20 }], storeys: 20 });
ok(far.checks.some((c) => /Travel/.test(c.what) && !c.ok), "a 90 m slab with a middle core: a flat too far from a staircase");
const ends = F.layout({ poly: [[0, 0], [90, 0], [90, 16], [0, 16]], mix: [{ u: TEMPLATES["2R-B"], n: 20 }], storeys: 20, core: "ends" });
ok(ends.stairsX[0] < 3 && ends.stairsX[1] > 87, "staircases at the ends");

// editing the floor: the order along each side, swaps, mirrored units, corner units
{
  const poly = [[0, 0], [48, 0], [48, 16], [0, 16]];
  const A = F.layout({ poly, mix, storeys: 30 });
  const seq = JSON.parse(JSON.stringify(A.seq));
  const B = F.layout({ poly, mix, storeys: 30, seq });
  ok(B.edited && !B.note && JSON.stringify(B.placed.map((q) => [q.name, q.x])) === JSON.stringify(A.placed.map((q) => [q.name, q.x])), "the snapshot of the automatic floor lays out the same");
  const sw = JSON.parse(JSON.stringify(seq)); [sw.s[0], sw.s[4]] = [sw.s[4], sw.s[0]];
  const Cs = F.layout({ poly, mix, storeys: 30, seq: sw }), first = Cs.placed.find((q) => q.band === "s" && q.si === 0);
  ok(first.name === seq.s[4].u && near(first.x, 0, 1e-6), "a swap: the fifth unit now first along the south side");
  const mi = JSON.parse(JSON.stringify(seq)); mi.s[0].m = true;
  const Mi = F.layout({ poly, mix, storeys: 30, seq: mi }), q0 = Mi.placed.find((q) => q.band === "s" && q.si === 0);
  ok(q0.m && near(q0.fig.saleable, A.placed.find((q) => q.band === "s" && q.si === 0).fig.saleable, 1e-6) && near(Mi.figures.gfa, A.figures.gfa, 1e-6), "a mirrored unit: the same areas");
  const rm = JSON.parse(JSON.stringify(seq)); rm.s.pop();
  ok(/differs from the unit mix/.test(F.layout({ poly, mix, storeys: 30, seq: rm }).note), "one removed: the floor differs from the mix");
  const Co = F.layout({ poly, mix, storeys: 30, corners: true }), sS = Co.placed.filter((q) => q.band === "s");
  ok(sS.some((q) => near(q.x, 0, 1e-6) && q.corner === "w") && sS.some((q) => near(q.x + q.w, 48, 1e-6) && q.corner === "e") && Co.cornerFac > 0, "corner units: flats at both ends of the south side");
  const Cq = F.layout({ poly, mix, storeys: 30, corners: true, seq: Co.seq });
  ok(JSON.stringify(Cq.placed.map((q) => [q.name, q.x])) === JSON.stringify(Co.placed.map((q) => [q.name, q.x])), "corner units: the snapshot lays out the same");
}
// the core and the units by hand, the plate's frame kept
{
  const poly = [[0, 0], [48, 0], [48, 16], [0, 16]];
  const A = F.layout({ poly, mix, storeys: 30 });
  const core = JSON.parse(JSON.stringify(A.coreOut));
  // the lifts to the south side, against the corridor
  for (const c of core) if (c.kind === "lift") c.y = A.y1;
  const B = F.layout({ poly, mix, storeys: 30, pieces: core });
  const lifts = B.core.filter((c) => c.kind === "lift"), sUnits = B.placed.filter((q) => q.band === "s");
  ok(B.coreEdited && lifts.every((c) => near(c.y, A.y1, 1e-9)) && !sUnits.some((q) => lifts.some((c) => Math.min(q.x + q.w, c.x + c.w) - Math.max(q.x, c.x) > 0.05)), "the lifts moved to the south side: the units there go round them");
  ok(B.checks.find((c) => c.what === "Clashes").ok, "no clashes");
  const seq = JSON.parse(JSON.stringify(A.seq)); seq.s[0].x = 20;
  const Cx = F.layout({ poly, mix, storeys: 30, seq }), fx = Cx.placed.find((q) => q.band === "s" && q.si === 0);
  ok(near(fx.x, 20, 1e-9) && fx.fixed, "a unit put by hand at x = 20 stays there");
  const seq2 = JSON.parse(JSON.stringify(A.seq)); seq2.s[0].x = 44;
  const Cy = F.layout({ poly, mix, storeys: 30, seq: seq2 });
  ok(Cy.issues.some((t) => /outside the plate/.test(t)), "a unit pushed past the plate's end: flagged outside the plate");
  const seq3 = JSON.parse(JSON.stringify(A.seq)); seq3.s[1].x = seq3.s[0].x = undefined; seq3.s[0].x = 3; seq3.s[1].x = 5;
  ok(F.layout({ poly, mix, storeys: 30, seq: seq3 }).issues.some((t) => /overlaps/.test(t)), "two units put on each other: flagged");
  const seq4 = JSON.parse(JSON.stringify(A.seq)); seq4.s[0].r = 90;
  ok(F.layout({ poly: [[0, 0], [48, 0], [48, 24], [0, 24]], mix, storeys: 30, seq: seq4 }).issues.some((t) => /entrance not on the corridor/.test(t)), "a unit turned 90°: its entrance not on the corridor");
  const t = 0.4, rp = poly.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
  const fr0 = F.frame(rp), moved = rp.map((p, i) => (i === 1 ? [p[0] + 3, p[1] + 6] : p)), fr1 = F.frame(moved, { ux: fr0.ux, uy: fr0.uy });
  ok(near(fr1.ux, fr0.ux, 1e-12) && near(fr1.uy, fr0.uy, 1e-12), "the frame kept on its axis while a corner moves");
  ok(F.snap1(8.17, 2, [10.3]) === 8.3 && F.snap1(3.02, 2, [20]) === 3, "snap to a neighbour's edge within 0.3 m, else the 50 mm grid");
}
{
  // protected lobbies, doors, the dog-leg's well, persons by the usable floor area, old stored pieces, the E&M left over
  const P0 = [[0, 0], [48, 0], [48, 18], [0, 18]];
  const Lo = F.layout({ poly: P0, mix, storeys: 30, lobby: true }), Ln = F.layout({ poly: P0, mix, storeys: 30 });
  const lobs = Lo.core.filter((c) => c.kind === "lobby"), sts = Lo.core.filter((c) => c.kind === "stair");
  ok(lobs.length === 2 && sts.every((s0) => lobs.some((l) => Math.abs(l.x - s0.x) < 1e-6 && Math.abs(l.y + l.h - Lo.y0) < 1e-6 && Math.abs(s0.y + s0.h - (l.y + 0.25)) < 1e-6)), "protected lobbies: one between each staircase and the corridor, sharing the staircase's wall");
  ok(Lo.figures.lobby > 0 && Math.abs(Lo.figures.gfa - Ln.figures.gfa - Lo.figures.lobby) < 3, "the lobbies in the GFA: " + Lo.figures.lobby + " m²");
  ok(lobs.every((l) => l.doors.length === 1) && sts.every((s0) => s0.doors.length === 1 && s0.doors[0].sn[1] === -1), "a door from the corridor into each lobby, and one from the lobby into the staircase");
  ok(Ln.core.filter((c) => c.kind === "lift").every((c) => c.doors.length === 1 && c.doors[0].slide), "each lift: its sliding doors on the corridor");
  const d2 = F.stairSize({ width: 1.2, storeyH: 3.15, riser: 0.175, going: 0.225, type: "dogleg2" });
  ok(Math.abs(d2.W - (2 * 1.2 + 0.225)) < 1e-9, "2 risers on the half landing: the well as deep as their tread, W = 2 × 1.2 + 0.225");
  ok(F.DEF.going === 0.225, "going 225 mm by default");
  const fac = Ln.persons.factor, want = mix.reduce((s2, m) => s2 + m.n * Math.ceil(U.figures(m.u).internal / fac - 1e-7), 0);
  ok(Ln.persons.floor === want, "persons a floor from each flat's usable floor area at " + fac + " m² a person: " + want);
  const L3 = F.layout({ poly: P0, mix, storeys: 30, persons: 3 });
  ok(L3.persons.floor === 3 * 10, "a number a flat given: that");
  const old = Ln.coreOut.map((c) => Object.assign({}, c, { x: c.x + 0.125, y: c.y + 0.125, w: c.w - 0.25, h: c.h - 0.25, full: undefined }));
  const Lp = F.layout({ poly: P0, mix, storeys: 30, pieces: old });
  ok(Lp.core.every((c, k) => Math.abs(c.w - Ln.core[k].w) < 1e-6 && Math.abs(c.x - Ln.core[k].x) < 1e-6), "pieces stored before the full walls: grown by half a wall all round, the same insides");
  ok(Ln.residuals.length > 0 && Ln.residuals.every((z) => z.area >= 0.5 && z.cells.length), "the plate's leftovers as E&M regions: " + Ln.residuals.map((z) => z.area).join(", "));
}
{
  // a plate traced round an L-shaped unit's outer wall faces: inside, its balcony outside the plate not counted
  const rooms = [{ x: 0, y: 0, w: 4, h: 3 }, { x: 0, y: 3, w: 2, h: 2 }], t = 0.2, g = t / 2;
  const L = [[-g, -g], [4 + g, -g], [4 + g, 3 + g], [2 + g, 3 + g], [2 + g, 5 + g], [-g, 5 + g]];
  ok(F.unitInside(L, 0, 0, rooms, t), "an L-shaped unit in a plate traced to its outer faces: inside (by its rooms, not its box)");
  ok(!F.unitInside([[-g, -g], [4 + g, -g], [4 + g, 5 + g], [-g, 5 + g]].map(([x, y]) => [x * 0.9, y]), 0, 0, rooms, t), "the plate cutting into a room: outside");
  // unionArea / residualRegions against a plain count
  const R = [{ x0: 0, y0: 0, x1: 2, y1: 1 }, { x0: 1, y0: 0, x1: 3, y1: 2 }, { x0: 5, y0: 5, x1: 6, y1: 7 }];
  ok(Math.abs(F.unionArea(R) - (2 + 4 - 1 + 2)) < 1e-9, "the union of overlapping rectangles: 7 m²");
  const res = F.residualRegions([[0, 0], [10, 0], [10, 10], [0, 10]], [{ x0: 0, y0: 0, x1: 10, y1: 4 }, { x0: 0, y0: 6, x1: 10, y1: 10 }, { x0: 4.8, y0: 4, x1: 5.2, y1: 6 }]);
  ok(res.length === 2 && res.every((z) => Math.abs(z.area - 9.6) < 1e-6), "what is left: two regions of 4.8 × 2 m");
}
{
  // a passage turned into an L: its area the union of its runs, counted with the corridor
  const c = F.passageShape({ kind: "passage", path: [[10, 8], [10, 5], [14, 5]], width: 1.2 });
  ok(c.rects.length === 2 && Math.abs(F.unionArea(c.rects) - (1.2 * 3.6 + 1.2 * 3.4)) < 1e-6, "an L passage: two runs, squared at the bend, " + F.unionArea(c.rects).toFixed(3) + " m²");
  ok(JSON.stringify(F.orthoPath([[0, 0], [3, 4]])) === JSON.stringify([[0, 0], [3, 0], [3, 4]]), "a slanting run made orthogonal: across, then along");
  const P0 = [[0, 0], [48, 0], [48, 18], [0, 18]];
  const Lb = F.layout({ poly: P0, mix, storeys: 30, core: "behind" });
  const pieces = Lb.coreOut.map((q) => Object.assign({}, q));
  const pa = pieces.find((q) => q.kind === "passage");
  pa.path = [pa.path[0], [pa.path[0][0], pa.path[0][1] - 1], [pa.path[0][0] - 2, pa.path[0][1] - 1], [pa.path[0][0] - 2, pa.path[1][1]]];   // a Z
  const Lz = F.layout({ poly: P0, mix, storeys: 30, core: "behind", pieces });
  const pz = Lz.core.find((q) => q.kind === "passage");
  ok(pz.path.length === 4 && Math.abs(Lz.figures.corridor - (Lz.L * Lz.cw + F.unionArea(pz.rects))) < 1e-6, "a Z passage kept, its area with the corridor's");
  // a piece resized: its clear inside follows, its walls stay
  const rs = Lb.coreOut.map((q) => Object.assign({}, q)), li = rs.findIndex((q) => q.kind === "lift");
  rs[li].w += 0.5;
  const Lr = F.layout({ poly: P0, mix, storeys: 30, core: "behind", pieces: rs });
  ok(Math.abs(Lr.core[li].w - Lb.core[li].w - 0.5) < 1e-6 && Lr.figures.lift > Lb.figures.lift, "a lift shaft made 0.5 m wider: its area grows");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
