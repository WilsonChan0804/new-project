/* node viewer/tests/units.test.mjs - unit plans: areas and concessions */
import * as U from "../unitcore.js";
import { TEMPLATES } from "../unittables.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const R = (id, kind, x, y, w, h) => ({ id, kind, name: id, x, y, w, h });

// an L of two rooms: 4 x 3 and 2 x 2 below its left part
const L = { wall: 0.2, party: 0.2, part: 0.1, facade: "s", partySides: [], rooms: [R("a", "LD", 0, 0, 4, 3), R("b", "BR", 0, 3, 2, 2.4)], extras: [] };
const fL = U.figures(L);
ok(near(fL.area, 12 + 4.8, 1e-9), "an L of 4 × 3 and 2 × 2.4: 16.8 m² to the centrelines");
const ext = fL.edges.filter((e) => e.kind === "ext").reduce((s, e) => s + e.len, 0);
ok(near(ext, 2 * (4 + 5.4), 1e-9) && fL.edges.filter((e) => e.kind === "part").length === 1, "its outline 18.8 m, one partition 2 m");
ok(near(fL.enclosed, 16.8 + 18.8 * 0.1 + 4 * 0.01, 1e-9), "enclosed to the outside of the external walls: + 18.8 × 0.1 + corners");
const P = Object.assign({}, L, { partySides: ["w"] });
ok(near(U.figures(P).enclosed, 16.8 + (18.8 - 5.4) * 0.1 + 0.04, 1e-9), "a party wall on the west: measured to its middle, no half-wall added");
// moving the shared wall line keeps the total when both sides move
const two = { wall: 0.2, party: 0.2, part: 0.1, partySides: [], rooms: [R("a", "LD", 0, 0, 3, 3), R("b", "BR", 3, 0, 2.5, 3)], extras: [] };
const mv = U.moveLine(two, "x", 3, 0.3);
ok(near(U.figures(mv).area, U.figures(two).area, 1e-9) && near(mv.rooms[0].w, 3.3, 1e-9) && near(mv.rooms[1].w, 2.2, 1e-9), "the wall between moved 0.3 m: 3.3 + 2.2, the total kept");
const mvOut = U.moveLine(two, "x", 5.5, 0.5);
ok(near(U.figures(mvOut).area, 16.5 + 1.5, 1e-9), "the outer wall moved 0.5 m: 1.5 m² more");
// templates against their brochures
for (const [k, t] of Object.entries(TEMPLATES)) if (t.ft2) { const f = U.figures(t); ok(Math.abs(f.saleableFt - t.ft2) / t.ft2 <= 0.03, `${k}: ${f.saleableFt} ft² against ${t.ft2} ft² (${t.src})`); }
// concessions (the 1-room B: balcony 2.04, UP 1.5)
const f1 = U.figures(TEMPLATES["1R-B"]);
ok(near(f1.bal, 2.04, 1e-6) && near(f1.balEx, 1, 1e-9) && near(f1.upEx, 0.75, 1e-9), "balcony 2.04 m² exempt 1 m² (capped), UP exempt 0.75 m²");
ok(near(f1.saleable, f1.enclosed + f1.bal + f1.up, 1e-9) && near(f1.gfa, f1.enclosed + f1.bal - 1 + f1.up - 0.75, 1e-9), "saleable adds the balcony and UP; the GFA adds what is not exempt");
// the first form (rows) converts with the same areas
const old = { wall: 0.2, party: 0.2, part: 0.1, rows: [{ depth: 2.4, rooms: [{ kind: "BR", w: 2.4 }, { kind: "BATH", w: 1.5 }] }, { depth: 3, rooms: [{ kind: "LD", w: 4.0 }] }], extras: [] };
const conv = U.fromRows(old);
ok(conv.rooms.length === 3 && near(U.figures(conv).area, 4.0 * (2.5 + 3), 1e-9), "a row unit converts: 4.0 × 5.5 m to the centrelines");
// warnings
const narrow = U.moveLine(TEMPLATES["2R-B"], "x", TEMPLATES["2R-B"].rooms.find((r) => r.id === "r").w, -0.8, TEMPLATES["2R-B"].rooms.find((r) => r.id === "r").y, 99);
ok(U.figures(narrow).warn.some((w) => /Bedroom 1: .* under 2\.1/.test(w)), "a bedroom narrowed under 2.1 m warns");
// round 2: deleted walls, split / join, own thickness, the bay, defaults, windows
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"]));
  ok(T.wall === 0.1 && T.part === 0.075, "templates: external 100 mm, partitions 75 mm");
  const f0 = U.figures(T), e = f0.edges.find((q) => q.kind === "part" && !U.isOpen(T, q));
  T.walls = { [e.key]: { open: true } };
  const f1 = U.figures(T);
  ok(near(f1.area, f0.area, 1e-9) && f1.internal > f0.internal && U.isOpen(T, f1.edges.find((q) => q.key === e.key)), "a deleted partition: same area, more usable floor");
  T.walls = { [e.key]: { t: 0.2 } };
  ok(U.figures(T).internal < f0.internal, "a thicker partition: less usable floor");
  const sp = U.splitRoom(TEMPLATES["2R-B"], "l", "x", 1.5);
  const fs = U.figures(sp);
  ok(sp.rooms.length === TEMPLATES["2R-B"].rooms.length + 1 && near(fs.area, f0.area, 1e-9) && fs.edges.filter((q) => q.kind === "part").length > f0.edges.filter((q) => q.kind === "part").length, "split the living room: one more room and partition, the same area");
  const jn = U.joinRooms(sp, "l", sp.rooms.find((r) => r.id.startsWith("ls")).id);
  ok(jn && jn.rooms.length === TEMPLATES["2R-B"].rooms.length && near(U.figures(jn).area, f0.area, 1e-9), "join them back");
  const bayU = { wall: 0.15, part: 0.075, party: 0.15, rooms: [R("a", "LD", 0, 0, 4, 3)], extras: [{ kind: "bay", x: 4, y: 0, w: 1.2, h: 3.55, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.25 }, { kind: "acp", len: 0.6 }] }] };
  const sepU = Object.assign({}, bayU, { extras: [{ kind: "bal", x: 4, y: 0, w: 1.2, h: 1.7 }, { kind: "up", x: 4, y: 1.7, w: 1.2, h: 1.25 }, { kind: "acp", x: 4, y: 2.95, w: 1.2, h: 0.6 }] });
  const fb = U.figures(bayU), fsep = U.figures(sepU);
  ok(near(fb.saleable, fsep.saleable, 1e-9) && near(fb.gfa, fsep.gfa, 1e-9) && near(fb.acpFree, fsep.acpFree, 1e-9), "a combined bay counts as its parts would");
  const nw = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])); nw.windows = nw.windows.filter((w) => w.room !== "r");
  ok(U.figures(nw).warn.some((w) => /Bedroom 1: no window/.test(w)), "a bedroom without its window warns");
  const fx = U.rotateFixture({ kind: "counter", x: 0, y: 0, w: 2, h: 0.6, rot: 0 });
  ok(near(fx.w, 0.6, 1e-9) && near(fx.h, 2, 1e-9) && fx.rot === 90 && near(fx.x + fx.w / 2, 1, 1e-9), "rotating a counter 90° about its centre");
}
// façades: a curtain wall's projection is not GFA; a precast wall's thickness up to 150 mm exempt under the cap
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])), f0 = U.figures(T);
  const e = f0.edges.find((q) => q.kind === "ext" && q.a === "m" && q.face === "w");
  T.walls = { [e.key]: { f: "cw" } };
  const fc = U.figures(T);
  ok(near(fc.cwEx, e.len * 0.15 / 2, 1e-3) && near(fc.gfa, U.figures(Object.assign({}, T, { walls: { [e.key]: { t: 0.15 } } })).gfa - e.len * 0.075, 2e-3), "a curtain wall 150 mm: its outer half not GFA, outside the cap");
  T.walls = { [e.key]: { f: "pc" } };
  const fp = U.figures(T);
  ok(near(fp.pcEx, e.len * 0.15, 1e-3) && fp.capped > f0.capped, "a precast wall 150 mm: its thickness exempt, under the cap");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
