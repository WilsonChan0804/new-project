/* node viewer/tests/floors.test.mjs - stage 4: a typical floor */
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
const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
const all = [...L.placed, ...L.core];
ok(L.placed.length >= 8 && !all.some((a, i) => all.some((b, j) => j > i && ov(a, b))), `${L.placed.length} units and the core placed, nothing overlapping`);
ok(L.placed.every((q) => (q.band === "s" ? near(q.y, L.y1, 1e-6) : near(q.y + q.h, L.y0, 1e-6))), "every unit on the corridor");
ok(L.core.filter((c) => c.kind === "stair").length === 2 && L.core.filter((c) => c.kind === "lift").length === L.nL, "two staircases and the lifts in the core");
const Fg = L.figures;
ok(near(Fg.plate, 48 * 16, 1e-6) && near(Fg.residual, Fg.plate - L.placed.reduce((s, q) => s + q.w * q.h, 0) - Fg.corridor - Fg.stair - Fg.lift - Fg.refuse - Fg.riser, 1e-3), "the residual is what the units, corridor and core leave");
ok(near(Fg.gfa, Fg.unitGfa + Fg.corridor + Fg.stair + Fg.lift, 1e-3), "the floor GFA: units + corridor + staircases + lift shafts (refuse, riser, residual exempt)");
const W = F.layout({ poly: rot(box, 0.3), mix, storeys: 30, corridor: 2.0 });
ok(near(W.figures.wideEx, (2.0 - 1.5) * 48, 1e-6), "a 2 m corridor: 0.5 m of its width exempt along 48 m (wider corridor)");
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
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
