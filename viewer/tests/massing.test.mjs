/* node viewer/tests/massing.test.mjs - the massing's figures and rules */
import * as M from "../massingcore.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;

const sq = (w, d, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
// a 60 x 40 podium (3 storeys: G/F lobby 6 m, 2 car park 4.5 m) and a 30 x 25 tower on it of 40 domestic storeys at 3.15 m
const m = { blocks: [
  { id: "p", name: "Podium", fp: sq(60, 40), groups: [{ use: "lobby", n: 1, h: 6 }, { use: "car", n: 2, h: 4.5 }] },
  { id: "t", name: "Tower", on: "p", fp: sq(30, 25, 15, 8), groups: [{ use: "dom", n: 40, h: 3.15, acc: 750 > 0 ? (700 / 750) * 100 : 100 }] },
] };
const f = M.figures(m, 4000, 6);
ok(near(f.dgfa, 2400 + 40 * (750 - 50), 0.01), "domestic GFA: G/F lobby 2,400 + 40 × (750 − 50) = " + f.dgfa);
ok(f.ngfa === 0, "the car park is not accountable by default");
ok(near(f.capConc, 40 * 50, 0.01) && near(f.conc, 2000 + 2 * 2400, 0.01), "concessions: 2,000 m2 under the cap, plus the car park 4,800 exempt");
ok(near(f.sc, 60, 0.5), "site coverage: the podium's 2,400 of 4,000 = 60% (" + f.sc + ")");
ok(near(f.height, 6 + 9 + 126, 1e-9) && near(f.mpd, 147, 1e-9), "height 141 m, 147 mPD");
ok(f.storeys === 43, "43 storeys in the building (podium 3 + tower 40)");
const rf = f.buildings[0].refuge;
ok(rf.need === "floors" && !rf.ok && rf.due.join(",") === "26", "43 storeys: refuge floors, one due at the 26th storey (25/F) · " + rf.due);
// with a refuge floor placed after 22 tower storeys (storey 26)
const m2 = JSON.parse(JSON.stringify(m));
m2.blocks[1].groups = [{ use: "dom", n: 22, h: 3.15 }, { use: "refuge", n: 1, h: 4.5 }, { use: "dom", n: 18, h: 3.15 }];
const r2 = M.figures(m2, 4000, 6).buildings[0].refuge;
ok(r2.ok && r2.placed.join(",") === "26", "the refuge floor at storey 26 clears it");
ok(M.refuge(Array.from({ length: 30 }, (_, i) => ({ no: i + 1, use: "dom" }))).need === "roof", "30 storeys: refuge roof (B18.5)");
ok(M.refuge(Array.from({ length: 25 }, (_, i) => ({ no: i + 1, use: "dom" }))).need === "none", "25 storeys: none");
ok(M.refugeAt(60).join(",") === "26,52", "60 storeys: refuge at the 26th and 52nd storey (25/F and 50/F)");
ok(M.refugeAt(45, true).join(",") === "21,42", "UC 6, 45 storeys: every 20");
// union of two overlapping squares: 100 + 100 - 25
ok(near(M.unionArea([sq(10, 10), sq(10, 10, 5, 5)]), 175, 1.5), "union of two overlapping squares ≈ 175");
// inset a 60 x 40 rectangle by 3 m: 54 x 34
ok(near(Math.abs(M.inset(sq(60, 40), 3).reduce((s, p, i, a) => { const q = a[(i + 1) % a.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2), 54 * 34, 1e-6), "a 3 m set-back: 54 × 34");
// limits
const a = M.against(f, [{ key: "dgfa", value: 31000, by: "OZP" }, { key: "bh", value: 140, by: "OZP" }]);
ok(a[0].status === "ok" && a[4].status === "over", "against: GFA within, height 147 over 140 mPD");
// OBJ: 3 + 40 storeys, 8 vertices each
const obj = M.toObj(m, 6);
ok((obj.match(/^v /gm) || []).length === 43 * 8 && /^o Tower_dom$/m.test(obj), "OBJ: 43 prisms, one object per block and use");
// GFA % gives the concession: 750 m2 at 80% -> 600 GFA, 150 concession
{
  const f3 = M.figures({ blocks: [{ id: "a", fp: sq(30, 25), groups: [{ use: "dom", n: 1, h: 3, acc: 80 }] }] }, 1000, 0);
  ok(near(f3.dgfa, 600, 1e-6) && near(f3.conc, 150, 1e-6) && near(f3.capConc, 150, 1e-6), "750 m2 at 80%: GFA 600, concession 150 (under the cap)");
  // a transfer plate is not a storey; the refuge still at the 26th storey
  const m4 = { blocks: [{ id: "a", fp: sq(30, 25), groups: [{ use: "lobby", n: 1, h: 6 }, { use: "transfer", n: 1, h: 3 }, { use: "dom", n: 40, h: 3.15 }] }] };
  const f4 = M.figures(m4, 1000, 0);
  ok(f4.storeys === 41 && f4.buildings[0].refuge.due.join(",") === "26" && near(f4.height, 6 + 3 + 126, 1e-9), "a transfer plate: 41 storeys, height includes it, refuge at storey 26");
  const one = M.inset(sq(60, 40), [3, 0, 0, 0]);
  ok(near(Math.abs(one.reduce((s2, p, i, a) => { const q = a[(i + 1) % a.length]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0) / 2), 60 * 37, 1e-6), "3 m set back on one edge only: 60 × 37");
  const sb = M.setbacks(sq(30, 20, 5, 3), sq(60, 40));
  ok(near(sb[0], 3, 1e-9) && near(sb[3], 5, 1e-9), "set-backs from the boundary: 3 m (south), 5 m (west)");
}
// a different floor plate for the upper floors
{
  const m5 = { blocks: [{ id: "a", fp: sq(30, 25), groups: [{ use: "dom", n: 10, h: 3 }, { use: "dom", n: 10, h: 3, fp: sq(20, 25) }] }] };
  const f5 = M.figures(m5, 1000, 0);
  ok(near(f5.dgfa, 10 * 750 + 10 * 500, 1e-6) && near(f5.sc, 75, 1), "a smaller plate above: GFA 12,500, site coverage still 750 m² (75%)");
}
// a floor split: 60% retail, 40% lobby on a 30 x 25 plate
{
  const st = M.strips(sq(30, 25), [60, 40]);
  const a = st.map((p) => Math.abs(p.reduce((s2, q, i, x) => { const r = x[(i + 1) % x.length]; return s2 + q[0] * r[1] - r[0] * q[1]; }, 0) / 2));
  ok(near(a[0], 450, 0.01) && near(a[1], 300, 0.01), "strips: 450 + 300 m2");
  const f6 = M.figures({ blocks: [{ id: "a", fp: sq(30, 25), groups: [{ use: "retail", n: 2, h: 5, parts: [{ use: "retail", share: 60 }, { use: "car", share: 40 }] }, { use: "dom", n: 3, h: 3 }] }] }, 1000, 0);
  ok(near(f6.ngfa, 2 * 450, 0.01) && f6.storeys === 5 && near(f6.dgfa, 3 * 750, 0.01), "split floors: retail 900 m2 GFA, car park none, 5 storeys");
}

// APP-152 Design Requirement (1)(b): 7.5 m from the centreline of a street under 15 m wide, up to 15 m above it
{
  const site = sq(60, 40); // edge 0 runs along y = 0: the street is south of it
  const at = (y0) => M.stacks({ blocks: [{ id: "a", fp: sq(20, 10, 10, y0), groups: [{ use: "dom", n: 10, h: 3 }] }] })[0].storeys;
  const E6 = M.streetEdges(site, { 0: "r1" }, { r1: { name: "Kau Road", width: 6 } });
  const a = M.streetSetback(at(4), site, E6)[0], b = M.streetSetback(at(4.5), site, E6)[0];
  ok(a.applies && !a.ok && near(a.min, 7, 1e-9) && near(a.need, 4.5, 1e-9), `a 6 m street: 4 m from the boundary is 7 m from the centreline - short of 7.5 m (${a.min})`);
  ok(b.ok && near(b.min, 7.5, 1e-9), "4.5 m from the boundary: 7.5 m, complies");
  const w15 = M.streetSetback(at(1), site, M.streetEdges(site, { 0: "r1" }, { r1: { width: 15 } }))[0];
  ok(!w15.applies && w15.ok, "a 15 m street: not applicable");
  const up = M.stacks({ blocks: [{ id: "p", fp: sq(60, 10, 0, 8), groups: [{ use: "retail", n: 1, h: 16 }] }, { id: "t", on: "p", fp: sq(20, 10, 10, 1), groups: [{ use: "dom", n: 10, h: 3 }] }] });
  const st = up.flatMap((x) => x.storeys);
  ok(M.streetSetback(st, site, E6)[0].min === 11, "only the building up to 15 m above the street: the podium 8 m back counts, the tower from 16 m does not (" + M.streetSetback(st, site, E6)[0].min + ")");
  ok(near(M.streetEdges(site, { 0: "r9" }, {})[0].width, 8, 1e-9) && M.streetEdges(site, { 0: "r9" }, {})[0].assumed, "no width: 8 m taken, and said so");
  const body = M.toSbd({ blocks: [{ id: "a", name: "T1", fp: sq(20, 10, 10, 5), groups: [{ use: "dom", n: 10, h: 3 }] }] }, site, E6, 5);
  const ms = body.masses[0];
  ok(body.masses.length === 1 && ms.verts.length === 8 && ms.tris.length === 12 && Math.max(...ms.verts.map((v) => v[2])) === 35, "the SBD model: one prism of 12 triangles to +35 m");
  ok(body.streets.length === 1 && near(body.streets[0].centreline[0][1], -3, 1e-9) && near(body.streets[0].opposite[0][1], -6, 1e-9), "the street's centreline 3 m out, its far side 6 m out");
  const L = M.triangulate([[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]]);
  ok(L.length === 3, "an L-shaped plate in 3 triangles");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
