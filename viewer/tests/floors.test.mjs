/* node viewer/tests/floors.test.mjs - stage 4: a typical floor */
import * as U from "../unitcore.js";
import * as F from "../floorcore.js";
import { TEMPLATES } from "../unittables.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const r3 = (v) => Math.round(v * 1000) / 1000;
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
{
  // a plate edit that moves the frame's origin: what is stored moves with it; the corridor stays
  const f = { pieces: [{ x: 5, y: 2, w: 3, h: 3 }, { kind: "passage", path: [[1, 1], [1, 4]] }], seq: { s: [{ u: "a", x: 7 }], n: [{ u: "b" }] }, gridX: 8, corrY: 6 };
  F.shiftFrame(f, 2, 1.5);
  ok(f.pieces[0].x === 7 && f.pieces[0].y === 3.5 && f.pieces[1].path[1][1] === 5.5 && f.seq.s[0].x === 9 && f.seq.n[0].x == null && f.gridOX === 2 && f.corrY === 7.5, "shiftFrame: pieces, passage path, placed units, grid and corridor moved by the frame's shift");
  const P0 = [[0, 0], [48, 0], [48, 18], [0, 18]];
  const A = F.layout({ poly: P0, mix, storeys: 30 }), B = F.layout({ poly: [[0, 0], [48, 0], [48, 22], [0, 22]], mix, storeys: 30, corrY: A.y0 });
  ok(B.y0 === A.y0, "the corridor kept at its place when the plate gets deeper: y0 " + B.y0);
}
{
  // a staircase's door put on its west face: the passage linked to it routes from there to the corridor
  const P0 = [[0, 0], [48, 0], [48, 18], [0, 18]];
  const Lb = F.layout({ poly: P0, mix, storeys: 30, core: "behind" });
  const pieces = Lb.coreOut.map((q) => JSON.parse(JSON.stringify(q)));
  const st = pieces.find((q) => q.kind === "stair"), pa = pieces.find((q) => q.kind === "passage");
  ok(pa.for === st.label && pa.auto, "the passage behind the lifts follows its staircase (" + pa.for + ")");
  st.door = { side: "w", at: 0.5 };
  const Lw = F.layout({ poly: P0, mix, storeys: 30, core: "behind", pieces });
  const s2 = Lw.core.find((q) => q.kind === "stair"), p2 = Lw.core.find((q) => q.kind === "passage");
  ok(s2.doors.length === 1 && s2.doors[0].side === "w" && s2.doors[0].sn[0] === 1, "the door on the staircase's west face, opening into it");
  const last = p2.path[p2.path.length - 1];
  ok(p2.path.length === 3 && Math.abs(p2.path[0][0] - s2.x) < 1e-6 && Math.abs(last[1] - Lw.y0) < 1e-6, "the passage: out of the door, then down to the corridor - an L " + JSON.stringify(p2.path));
  ok(F.coreWallRects(Lw.core, 0.25).every((r) => !(r.x0 < s2.x + 0.1 && r.x1 > s2.x && r.y0 < s2.doors[0].H[1] + 0.3 && r.y1 > s2.doors[0].O[1] - 0.3 && r.y1 - r.y0 > 1.2 && r.x1 - r.x0 < 0.3)), "the west wall cut at the door");
  // a piece's own wall: its inside follows
  const pz = Lb.coreOut.map((q) => JSON.parse(JSON.stringify(q))), li = pz.findIndex((q) => q.kind === "lift");
  pz[li].wt = 0.35;
  const Lt = F.layout({ poly: P0, mix, storeys: 30, core: "behind", pieces: pz });
  ok(Lt.figures.lift < Lb.figures.lift && F.coreWallRects(Lt.core, 0.25).some((r) => Math.abs((r.y1 - r.y0) - 0.35) < 1e-6 || Math.abs((r.x1 - r.x0) - 0.35) < 1e-6), "a lift's own 350 mm wall: its bands that thick, its shaft smaller");
}
{
  // a wall drawn across the corridor near its west end: the corridor ends there, what lies beyond is left over (E&M)
  const P0 = [[0, 0], [48, 0], [48, 18], [0, 18]];
  const A = F.layout({ poly: P0, mix, storeys: 30, corridor: 1.8 });
  const B = F.layout({ poly: P0, mix, storeys: 30, corridor: 1.8, corrY: A.y0, walls: [{ path: [[4, A.y0 - 1], [4, A.y1 + 1]], t: 0.2 }] });
  ok(Math.abs(B.corr.x0 - 4.1) < 1e-6 && B.corr.x1 === 48, "the corridor cut by the wall: from x 4.100 (the wall's face) to 48");
  ok(Math.abs(B.figures.corridor - (A.figures.corridor - 4.1 * 1.8)) < 1e-6, "its area 4.1 × 1.8 m less: " + B.figures.corridor);
  ok(Math.abs(B.figures.wideEx - 0.3 * B.jpn1.corrLen) < 1e-6 && B.jpn1.corrLen < A.jpn1.corrLen, "JPN 1 along the shorter corridor");
  ok(B.walls.length === 1 && B.fwallA > 0 && B.figures.coreWalls > A.figures.coreWalls - 1e-9, "the wall counted with the walls (" + B.fwallA + " m²)");
}
// a party wall's own thickness; the units' windows, curtain walls and sliding doors through turn()
{
  const sq = [[0, 0], [48, 0], [48, 16], [0, 16]];
  const L0 = F.layout({ poly: sq, mix, storeys: 30 });
  const s0 = L0.placed.filter((q) => q.band === "s").sort((a, b) => a.x - b.x), A = s0[0];
  ok(A.gs === "l" && A.gk === "s:" + A.si, "the first unit on the south, put from the left: its gap after it is keyed " + A.gk);
  const L1 = F.layout({ poly: sq, mix, storeys: 30, partyT: { [A.gk]: 0.4 } });
  const s1 = L1.placed.filter((q) => q.band === "s").sort((a, b) => a.x - b.x);
  const g0 = s0[1].x - (s0[0].x + s0[0].w), g1 = s1[1].x - (s1[0].x + s1[0].w);
  ok(near(g1 - g0, 0.2, 1e-6) && L1.figures.partyWalls > L0.figures.partyWalls, `that party wall alone at 400 mm: its gap 200 mm wider (${g0.toFixed(3)} -> ${g1.toFixed(3)}), more party wall area`);
  const u = JSON.parse(JSON.stringify(TEMPLATES["2R-B"]));
  u.rooms = u.rooms || U.fromRows(u).rooms;
  const r0 = u.rooms[0];
  u.windows = [{ room: r0.id, side: "n", at: 0.2, w: 1.0 }];
  u.walls = Object.assign({}, u.walls, { [r0.id + ":w"]: { f: "cw" } });
  u.doors = [{ room: r0.id, side: "n", at: 0.2, w: 1.6, type: "sliding2" }];
  const T = F.turn(u, 1);
  const win = T.ops.find((o) => o.k === "win"), cw = T.ops.find((o) => o.k === "cw");
  ok(win && near(Math.hypot(win.b[0] - win.a[0], win.b[1] - win.a[1]), 1, 1e-6) && win.no[0] === 1 && win.no[1] === 0, "a north window, turned a quarter: 1 m long, facing east");
  ok(cw && T.doors[0].type === "sliding2", "the curtain wall edge and the sliding door come through");
}
// a bending corridor: an L-shaped plate, the spine along both arms
{
  const mx = [{ u: TEMPLATES["2R-B"], n: 6 }, { u: TEMPLATES["1R-B"], n: 6 }];
  const poly = [[0, 0], [50, 0], [50, 17], [17, 17], [17, 50], [0, 50]];
  const one = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3 });
  const plain = F.layout({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3 });
  ok(one.legs.length === 1 && one.figures.gfa === plain.figures.gfa && one.placed.length === plain.placed.length, "no spine: one leg, the same as ever");
  const R = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: [[50, 8.5], [8.5, 8.5], [8.5, 50]] } });
  ok(R.multi && R.legs.length === 2 && R.legs.every((l) => l.r.placed.length > 0), "an L: two legs, units on both (" + R.legs.map((l) => l.r.placed.length).join(" + ") + ")");
  ok(R.placed.length === 12 && !R.issues.length, "all 12 flats placed, none outside the plate or overlapping");
  ok(R.legs[0].r.core.length > 0 && R.legs[1].r.core.length === 0 && R.coreLeg === 0, "the core in the longer leg");
  const toP = (l, pt) => [l.xf.ox + l.xf.c * pt[0] - l.xf.s * pt[1], l.xf.oy + l.xf.s * pt[0] + l.xf.c * pt[1]];
  const inL = (x, y) => F.inPoly(poly, x, y);
  ok(R.legs.every((l) => l.r.placed.every((q) => [[q.x + 0.3, q.y + 0.3], [q.x + q.w - 0.3, q.y + q.h - 0.3]].every((pt) => inL(...toP(l, pt))))), "each unit inside the L in the plate frame");
  ok(near(R.figures.corridor, (41.5 + 41.5) * 1.5, 1e-6), "the corridor: the spine's length × its width (" + R.figures.corridor + " m²)");
  ok(near(R.figures.gfa, R.legs.reduce((s, l) => s + l.r.figures.gfa, 0), 1e-6) && R.figures.plate === Math.round(Math.abs(F.area(poly)) * 1000) / 1000, "the figures summed over the legs, on the whole plate");
  ok(R.checks.some((c) => /along the corridor/.test(c.text)), "travel measured along the bending corridor");
  ok(R.legs.every((l) => l.r.figures.residual > 50) && R.figures.gfa + R.figures.residual <= R.figures.plate + 1, `what is left found in both legs (${R.legs.map((l) => Math.round(l.r.figures.residual)).join(" + ")} m²), within the plate`);
  // a staircase moved into the far leg: the far end is no longer a dead end
  const pc = R.coreOut.map((c) => Object.assign({}, c));
  const st = R.legs[0].r.coreOut.find((c) => c.kind === "stair" && c.label === "Stair B");
  const moved = [...R.legs[0].r.coreOut.filter((c) => c !== st && c.kind !== "passage"), Object.assign({}, st, { leg: 1, x: 30, y: 0.5 })];
  void pc;
  const R2 = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: [[50, 8.5], [8.5, 8.5], [8.5, 50]] }, pieces: moved });
  ok(R2.legs[1].r.core.some((c) => c.kind === "stair"), "a staircase put in the far leg stands there");
  const tv = (r) => Number((r.checks.find((c) => /^Travel/.test(c.what)).text.match(/^([\d.]+)/) || [0, 99])[1]);
  ok(tv(R2) < tv(R), `travel shorter with it (${tv(R)} -> ${tv(R2)} m)`);
  // 120 degrees
  const a = Math.PI / 3, P = [[0, 0], [40, 0]], e = [40 + 30 * Math.cos(a), 30 * Math.sin(a)];
  const poly2 = [[0, -9], [40 + 9 * Math.tan(a / 2), -9], [e[0] + 9 * Math.sin(a), e[1] - 9 * Math.cos(a)], [e[0] - 9 * Math.sin(a), e[1] + 9 * Math.cos(a)], [40 - 9 * Math.tan(a / 2), 9], [0, 9]];
  const fr = F.frame(poly2, { ux: 1, uy: 0 }), sp = [...P, e].map((q) => fr.to(q));
  const R3 = F.layoutLegs({ poly: poly2, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: sp } });
  ok(R3.legs.length === 2 && Math.abs(R3.legs[1].xf.ang - R3.legs[0].xf.ang) > 0.9 && R3.placed.length >= 8 && !R3.issues.length, `a bend of 120° (turning 60°): two legs, ${R3.placed.length} flats, no clashes`);
  // a wall across the far leg ends its corridor
  const R4 = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: [[50, 8.5], [8.5, 8.5], [8.5, 50]] }, walls: [{ path: [[6, 40], [11, 40]], t: 0.2 }] });
  ok(R4.figures.corridor < R.figures.corridor - 5 && R4.fwallA > 0, "a wall across the far leg cuts its corridor (" + R4.figures.corridor + " m²)");
}
// a bend added to a floor of units placed by hand (no mix): its units go into the new legs
{
  const poly = [[0, 0], [50, 0], [50, 17], [17, 17], [17, 50], [0, 50]];
  const U2 = TEMPLATES["2R-B"], U1 = TEMPLATES["1R-B"], lib = [U2, U1];
  const seq = { s: [{ u: U2.name }, { u: U1.name }, { u: U2.name }], n: [{ u: U1.name }, { u: U1.name }] };
  const A = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: [], lib, seq, storeys: 30, persons: 3, corrY: 7.75 });
  ok(A.placed.length === 5, "a floor of 5 units put by hand, no mix: " + A.placed.length);
  const sp2 = [[50, 8.5], [8.5, 8.5], [8.5, 50]], M2 = F.migrateToSpine(A, sp2);
  const n2 = M2.legSeq.reduce((s2, q) => s2 + q.s.length + q.n.length, 0);
  ok(n2 === 5 && M2.pieces.length === A.core.length, `carried onto the bent spine: ${n2} units, ${M2.pieces.length} pieces`);
  const B = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: [], lib, storeys: 30, persons: 3, spine: { path: sp2 }, legSeq: M2.legSeq, pieces: M2.pieces });
  ok(B.placed.length === 5, "laid out on the bent corridor: all 5 still there (" + B.placed.length + ")");
  // the stored form: from the leg's spine start, in the plate frame
  const l1 = B.legs[1], q = l1.r.placed[0];
  if (q) { const pP = F.fromLegRel(sp2, 1, [q.x - l1.A[0], q.y - l1.A[1]]), pX = [l1.xf.ox + l1.xf.c * q.x - l1.xf.s * q.y, l1.xf.oy + l1.xf.s * q.x + l1.xf.c * q.y]; ok(near(pP[0], pX[0], 1e-6) && near(pP[1], pX[1], 1e-6), "a leg's stored positions: from its spine start (toLegRel / fromLegRel)"); }
  const rt = F.toLegRel(sp2, 1, F.fromLegRel(sp2, 1, [3.2, -1.5]));
  ok(near(rt[0], 3.2, 1e-9) && near(rt[1], -1.5, 1e-9), "to and from a leg's frame");
  // two legs' units on each other: flagged
  const mx = [{ u: TEMPLATES["2R-B"], n: 6 }, { u: TEMPLATES["1R-B"], n: 6 }];
  const R = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: sp2 } });
  const ls = R.legSeq.map((q2) => JSON.parse(JSON.stringify(q2)));
  // a unit of leg 0 moved to the corner, onto leg 1's first unit
  const e = ls[0].s[0];
  e.x = -48;   // leg 0 runs from x 50: 48 m along it is the corner, where leg 1's units stand
  const R2 = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: mx, storeys: 30, persons: 3, spine: { path: sp2 }, legSeq: ls });
  const qd = (l, q) => [[q.x, q.y], [q.x + q.w, q.y], [q.x + q.w, q.y + q.h], [q.x, q.y + q.h]].map(([u, v]) => [l.xf.ox + l.xf.c * u - l.xf.s * v, l.xf.oy + l.xf.s * u + l.xf.c * v]);
  let silent = 0;
  const rq = (l, q) => q.rooms.map((rm) => qd(l, { x: q.x + rm.x, y: q.y + rm.y, w: rm.w, h: rm.h }));
  for (const qa of R2.legs[0].r.placed) for (const qb of R2.legs[1].r.placed) if (rq(R2.legs[0], qa).some((A2) => rq(R2.legs[1], qb).some((B2) => F.quadsOverlap(A2, B2))) && !(qa.flags.length || qb.flags.length)) silent++;
  ok(silent === 0, "a unit pushed to the corner: the other leg's units keep clear of it, or the clash is flagged (" + R2.issues.slice(0, 2).join("; ") + ")");
  ok(F.quadsOverlap([[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [3, 1], [3, 3], [1, 3]]) && !F.quadsOverlap([[0, 0], [2, 0], [2, 2], [0, 2]], [[2.5, 0], [4, 0], [4, 2], [2.5, 2]]), "quadsOverlap: overlapping and apart");
  // the E&M left over: none of it under the other leg's units
  const under = R.legs.some((l) => l.r.residuals.some((z) => z.cells.some((c) => R.legs.filter((o) => o !== l).some((o) => o.r.placed.some((u) => {
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, P = [l.xf.ox + l.xf.c * cx - l.xf.s * cy, l.xf.oy + l.xf.s * cx + l.xf.c * cy], dx = P[0] - o.xf.ox, dy = P[1] - o.xf.oy, lp = [o.xf.c * dx + o.xf.s * dy, -o.xf.s * dx + o.xf.c * dy];
    return lp[0] > u.x + 0.3 && lp[0] < u.x + u.w - 0.3 && u.rooms.some((rm) => lp[0] > u.x + rm.x + 0.2 && lp[0] < u.x + rm.x + rm.w - 0.2 && lp[1] > u.y + rm.y + 0.2 && lp[1] < u.y + rm.y + rm.h - 0.2);
  })))));
  ok(!under, "no E&M hatch under the other leg's units");
}
// openings on core pieces
{
  const sq = [[0, 0], [48, 0], [48, 16], [0, 16]];
  const A = F.layout({ poly: sq, mix, storeys: 30 });
  const pcs = A.coreOut.map((c) => (c.kind === "lift" && c.label === "Lift 1" ? Object.assign({}, c, { openings: [{ side: "n", at: 0.5, w: 1.0, type: "window" }] }) : c.kind === "refuse" ? Object.assign({}, c, { door: { side: "s", at: 0.5, type: "opening" } }) : c));
  const B = F.layout({ poly: sq, mix, storeys: 30, pieces: pcs });
  const l1 = B.core.find((c) => c.label === "Lift 1"), rf = B.core.find((c) => c.kind === "refuse");
  ok(l1.doors.length === 2 && l1.doors[1].type === "window" && l1.doors[1].side === "n", "a window added on a lift's back wall");
  ok(rf.doors[0].type === "opening", "the refuse room's door made an opening");
  ok(F.coreWallRects(B.core, 0.25).length > F.coreWallRects(A.core, 0.25).length, "the walls cut at the new opening");
  ok(B.coreOut.find((c) => c.label === "Lift 1").openings.length === 1, "and kept with the piece");
}
// the corridor moved or bent: what stands by it keeps its distance along it and its offset from it
{
  const sp = [[0, 8], [20, 8], [40, 8]], m = F.arcMap(sp, [[0, 9.5], [20, 9.5], [40, 9.5]], 1, [25, 5]);
  ok(m.k === 1 && near(m.f([25, 5])[0], 25, 1e-9) && near(m.f([25, 5])[1], 6.5, 1e-9), "arcMap: a leg moved 1.5 m across takes a point 1.5 m with it");
  const t = 0.3, m2 = F.arcMap(sp, [[0, 8], [20, 8], [20 + 20 * Math.cos(t), 8 + 20 * Math.sin(t)]], 1, [30, 8]), q = m2.f([30, 8]);
  ok(near(q[0], 20 + 10 * Math.cos(t), 1e-9) && near(q[1], 8 + 10 * Math.sin(t), 1e-9) && near(m2.rot, t, 1e-9), "arcMap: a turned leg takes a point along it, turned");
  // the corridor's start pulled out 3 m: what stands by the first leg stays where it is
  const m3 = F.arcMap(sp, [[-3, 8], [20, 8], [40, 8]], 0, [6, 5]), q3 = m3.f([6, 5]);
  ok(near(q3[0], 6, 1e-9) && near(q3[1], 5, 1e-9), "arcMap: the corridor's start pulled out keeps the units by it");
  const m4 = F.arcMap([[0, 8], [40, 8]], [[-3, 8], [40, 8]], 0, [6, 5]), q4 = m4.f([6, 5]);
  ok(near(q4[0], 6, 1e-9) && near(q4[1], 5, 1e-9), "arcMap: a straight corridor's start pulled out keeps the units");
  const poly = [[0, 0], [46, 0], [46, 16.5], [0, 16.5]], base = { poly, frame: { ux: 1, uy: 0 }, mix, storeys: 30, persons: 3 };
  const R0 = F.layoutLegs(base), y0 = (R0.y0 + R0.y1) / 2;
  const M = F.migrateToSpine(R0, [[R0.spine.path[0][0], y0 + 1.5], [R0.spine.path[1][0], y0 + 1.5]], true);
  const R1 = F.layoutLegs(Object.assign({}, base, { spine: { path: [[R0.spine.path[0][0], y0 + 1.5], [R0.spine.path[1][0], y0 + 1.5]] }, seq: M.seq, pieces: M.pieces }));
  ok(R1.core.length === R0.core.length && R0.core.every((c) => { const d = R1.core.find((e) => e.label === c.label); return d && near(d.y - c.y, 1.5, 1e-3) && near(d.x, c.x, 1e-3); }), "the corridor moved 1.5 m across: its core moves 1.5 m with it");
  const mid = R0.spine.path.map((p) => p.slice()); mid.splice(1, 0, [(mid[0][0] + mid[1][0]) / 2, mid[0][1]]);
  const M2 = F.migrateToSpine(R0, mid, true), R2 = F.layoutLegs(Object.assign({}, base, { spine: { path: mid }, legSeq: M2.legSeq, pieces: M2.pieces }));
  const abs = (R, c) => { const l = R.legs[c.leg]; return [l.xf.ox + l.xf.c * c.x - l.xf.s * c.y, l.xf.oy + l.xf.s * c.x + l.xf.c * c.y]; };
  ok(R0.core.every((c) => { const d = R2.core.find((e) => e.label === c.label); if (!d) return false; const a = abs(R0, c), b = abs(R2, d); return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3; }), "a bend added in a straight run: the core where it was");
}
// the E&M left over at a slanted edge: only its part inside the plate drawn and counted
{
  const poly = [[0, 0], [30, 0], [30, 20], [0, 20]], t = 20 * Math.PI / 180;
  const R = F.layoutLegs({ poly, frame: { ux: 1, uy: 0 }, mix: [], storeys: 6, spine: { path: [[0, 13.4], [14, 13.4], [14 + 16.5 * Math.cos(t), 13.4 - 16.5 * Math.sin(t)]] } });
  const toP = (l, p) => [l.xf.ox + l.xf.c * p[0] - l.xf.s * p[1], l.xf.oy + l.xf.s * p[0] + l.xf.c * p[1]];
  const outside = R.legs.some((l) => l.r.residuals.some((z) => z.cells.some((c) => (c.poly || [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]]).some((p) => { const q = toP(l, p); return q[0] < -0.01 || q[0] > 30.01 || q[1] < -0.01 || q[1] > 20.01; }))));
  ok(!outside, "a leg turned 20°: its E&M left over all inside the plate");
  ok(R.figures.residual < 600 - R.figures.corridor - 1, "and its area within the plate's (" + R.figures.residual + " m²)");
  const sq = F.clipToRect([[0, 0], [4, 0], [0, 4]], { x0: 1, y0: 1, x1: 3, y1: 3 });
  ok(near(Math.abs(F.area(sq)), 2, 1e-9), "clipToRect: a triangle cut to a square");
}
// the plate fitted close round the layout: gaps under the fit gap closed, the corners on the shapes'
{
  const R = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const o1 = F.hugOutline([R(0, 0, 10, 8), R(10.3, 0, 20, 6)], 0.5);
  ok(o1 && near(Math.abs(F.area(o1)), 140, 0.01) && o1.length === 6, "hugOutline: a 300 mm gap closed, one outline of 6 corners (" + JSON.stringify(o1) + ")");
  const o2 = F.hugOutline([R(0, 0, 10, 8), R(10.7, 0, 20, 8), R(0, 8, 20, 9.5)], 0.5);
  ok(o2 && Math.abs(F.area(o2)) < 20 * 9.5 - 0.7 * 8 + 0.01 && Math.abs(F.area(o2)) > 20 * 9.5 - 0.7 * 8 - 0.5, "hugOutline: a 700 mm gap wider than 500 mm stays a notch");
  const a = 0.3, rot = (Q) => Q.map(([x, y]) => [20 + (x - 20) * Math.cos(a) - y * Math.sin(a), (x - 20) * Math.sin(a) + y * Math.cos(a)]);
  const o3 = F.hugOutline([R(0, 0, 20, 8), rot(R(20, 0, 35, 8))], 0.5);
  ok(o3 && o3.some((p) => near(p[0], 20 + 15 * Math.cos(a), 1e-3) && near(p[1], 15 * Math.sin(a), 1e-3)) && o3.length <= 7, "hugOutline: a turned leg's corner kept exactly, the edges straight (" + o3.length + " corners)");
  // the riser's door: an access panel unless set
  const sq = [[0, 0], [48, 0], [48, 16], [0, 16]], L0 = F.layout({ poly: sq, mix, storeys: 30 });
  const rz = L0.core.find((c) => c.kind === "riser");
  ok(rz && rz.doors.length && rz.doors[0].type === "panel", "the E&M riser's way in is an access panel");
  const L1 = F.layout({ poly: sq, mix, storeys: 30, pieces: L0.coreOut.map((c) => (c.kind === "riser" ? Object.assign({}, c, { door: { side: rz.doors[0].side, at: 0.5, type: "door" } }) : c)) });
  ok(L1.core.find((c) => c.kind === "riser").doors[0].type === "door", "a door set on it is kept");
}
// fit plate: the outline on the units' external walls' outer faces
{
  const sq = [[0, 0], [48, 0], [48, 16], [0, 16]], L0 = F.layout({ poly: sq, mix, storeys: 30 }), shapes = [];
  const rect = (x0, y0, x1, y1) => shapes.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  let wx0 = Infinity, wy0 = Infinity, wy1 = -Infinity;
  for (const q of L0.placed) { for (const rm of q.rooms) rect(q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h); for (const w of F.placedWalls(q).rects) { rect(w.x0, w.y0, w.x1, w.y1); wx0 = Math.min(wx0, w.x0); wy0 = Math.min(wy0, w.y0); wy1 = Math.max(wy1, w.y1); } }
  for (const c of L0.core) if (c.kind !== "passage") rect(c.x, c.y, c.x + c.w, c.y + c.h);
  rect(L0.corr.x0, L0.y0, L0.corr.x1, L0.y1);
  const o = F.hugOutline(shapes, 0.5), xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  ok(Math.abs(Math.min(...ys) - wy0) < 0.001 && Math.abs(Math.max(...ys) - wy1) < 0.001 && Math.min(...xs) <= wx0 + 0.001, `fit plate on the walls' outer faces: top ${Math.min(...ys)} / ${r3(wy0)}, bottom ${Math.max(...ys)} / ${r3(wy1)}`);
}
{
  // a target mix: 40 / 40 / 20 of 10 flats, each type to its unit (the current mix's first)
  const U = (name, br) => ({ name, rooms: [{ kind: "LD" }, ...Array.from({ length: br }, (_, i) => ({ kind: i ? "BR" : "MBR" }))] });
  const lib = [U("S1", 0), U("A1", 1), U("A2", 1), U("B1", 2), U("C1", 3)];
  const mx = F.mixForTarget(lib, { 0: 40, 1: 40, 2: 20 }, 10, [{ u: "A2", n: 3 }]);
  const by = Object.fromEntries(mx.map((q) => [q.u, q.n]));
  ok(by.S1 === 4 && by.A2 === 4 && by.B1 === 2 && !by.A1 && mx.reduce((s, q) => s + q.n, 0) === 10, "mixForTarget: 40/40/20 of 10 -> " + JSON.stringify(mx));
  const m2 = F.mixForTarget(lib, { 1: 1, 2: 1, 3: 1 }, 7, []);
  ok(m2.reduce((s, q) => s + q.n, 0) === 7 && m2.every((q) => q.n >= 2), "mixForTarget: thirds of 7 -> " + JSON.stringify(m2));
  ok(F.unitType(U("x", 5)) === "3" && F.unitType(U("y", 0)) === "0", "unitType: by bedrooms, 3 or more as one");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
