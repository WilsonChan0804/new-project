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
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
