/* node viewer/tests/doctorcore.test.mjs - Model Doctor's checks on hand-made
   elements (boxes in plan metres, Y up), with the faults placed on purpose. */
import { runCheck, health, signature, defaults, CHECKS, coexist, rectOf } from "../doctorcore.js";

const BOXF = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
// Revit-style x, y plan and z up -> scene x, z plan and y up; returns an element
let K = 0;
function el(cat, name, [x0, y0, z0], [x1, y1, z1], extra = {}) {
  const P = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]].map(([x, y, z]) => [x, z, -y]);
  const t = new Float32Array(BOXF.length * 9);
  BOXF.forEach((f, i) => f.forEach((v, j) => { t[i * 9 + j * 3] = P[v][0]; t[i * 9 + j * 3 + 1] = P[v][1]; t[i * 9 + j * 3 + 2] = P[v][2]; }));
  const k = K++;
  return Object.assign({ k, model: "host", host: true, cat, type: name, name, level: "L1", uid: "u" + k, rid: 100 + k,
    box: [Math.min(x0, x1), Math.min(z0, z1), Math.min(-y0, -y1), Math.max(x0, x1), Math.max(z0, z1), Math.max(-y0, -y1)], tris: t, dr: null }, extra);
}
const wall = (a, b, t, z0, z1, extra) => {
  const [[ax, ay], [bx, by]] = [a, b];
  return ay === by ? el("Walls", "Wall 200", [Math.min(ax, bx), ay - t / 2, z0], [Math.max(ax, bx), ay + t / 2, z1], extra)
    : el("Walls", "Wall 200", [ax - t / 2, Math.min(ay, by), z0], [ax + t / 2, Math.max(ay, by), z1], extra);
};

const els = [
  el("Floors", "Slab", [-1, -1, -0.2], [21, 11, 0]),
  el("Floors", "Slab", [-1, -1, 3.3], [21, 11, 3.5], { level: "L2" }),
  wall([0, 0], [10, 0], 0.2, 0, 3.3),                    // 2  W1
  wall([10.105, 0.105], [10.105, 8], 0.2, 0, 3.3),       // 3  W2 corner gap 5 mm
  wall([8, 0], [14, 0], 0.2, 0, 3.3),                    // 4  W3 collinear overlap 2 m
  wall([0, 10], [20, 10], 0.2, 0, 3.2),                  // 5  W4 100 mm short of the soffit
  wall([2, 5], [4.796, 5], 0.2, 0, 3.3),                 // 6  W5 4 mm short of the column
  el("Structural Columns", "Column 400", [4.8, 4.8, 0], [5.2, 5.2, 3.3]),   // 7
  el("Doors", "Door 900", [3, -0.1, 0.04], [3.9, 0.1, 2.14]),               // 8  40 mm above the floor
  el("Furniture", "Desk", [6, 6, 0], [7.2, 6.8, 0.75]),                    // 9
  el("Furniture", "Desk", [6, 6, 0], [7.2, 6.8, 0.75]),                    // 10 duplicate of 9
  el("Furniture", "Desk", [6, 6, 0], [7.2, 6.8, 0.75], { dr: { opt: [900, 800] } }),  // 11 option A
  el("Furniture", "Desk", [6, 6, 0], [7.2, 6.8, 0.75], { dr: { opt: [901, 800] } }),  // 12 option B
  el("Casework", "Cabinet", [12, 3, -0.05], [13, 3.6, 0.9]),               // 13 sunk 50 mm
  wall([15, 2], [19, 2], 0.2, 0, 3.3),                   // 14 clean
  // another model: a structural wall exactly where W5 is, and a column in W1
  el("Walls", "Wall 200", [2, 4.9, 0], [4.796, 5.1, 3.3], { model: "str", host: false, modelLabel: "Tower STR" }),
  el("Structural Columns", "SC", [1, -0.3, 0], [1.4, 0.3, 3.3], { model: "str", host: false, modelLabel: "Tower STR" }),
];

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const run = (id, o) => runCheck(id, els, o || defaults());
const probs = (r) => r.issues.map((f) => f.problem + ":" + f.els.join("+") + (f.value_mm != null ? "=" + f.value_mm : ""));

let r = run("duplicates");
ok(r.issues.length === 1 && r.issues[0].els.join() === "9,10", "duplicates: the two desks, not the option copies " + JSON.stringify(probs(r)));
ok(!coexist(els[11], els[12]) && coexist(els[9], els[11]), "design options: A and B of one set never meet; main meets both");

r = run("wall_overlaps");
ok(r.issues.some((f) => f.problem === "Collinear overlap" && f.els.includes(2) && f.els.includes(4) && Math.abs(f.value_mm - 2000) < 1), "collinear overlap W1/W3 2000 mm " + JSON.stringify(probs(r)));

r = run("wall_gaps");
// W2's end is 5 mm off W1's end - and off the middle of W3, which overlaps W1 there
const g = r.issues.find((f) => f.els[0] === 3);
ok(g && ["Corner gap", "T-junction gap"].includes(g.problem) && Math.abs(g.value_mm - 5) < 0.6, "W2 stops 5 mm short " + JSON.stringify(probs(r)));
const els2 = els.filter((e) => e.k !== 4).map((e) => Object.assign({}, e, { _rect: undefined }));
const r2 = runCheck("wall_gaps", els2, defaults());
ok(r2.issues.some((f) => f.els.join() === "3,2" && f.problem === "Corner gap"), "without W3: a corner gap to W1 " + JSON.stringify(probs(r2)));
ok(!r.issues.some((f) => f.els[0] === 14), "the clean wall has no gap");

r = run("wall_column_gaps");
ok(r.issues.some((f) => f.problem === "Wall short of column" && f.els.join() === "6,7" && Math.abs(f.value_mm - 4) < 0.6), "wall 4 mm short of column " + JSON.stringify(probs(r)));

r = run("door_floor");
ok(r.issues.length === 1 && r.issues[0].problem === "Door above floor" && Math.abs(r.issues[0].value_mm - 40) < 0.6, "door 40 mm above floor " + JSON.stringify(probs(r)));

r = run("element_floor");
ok(r.issues.length === 1 && r.issues[0].els.join() === "13,0" && Math.abs(r.issues[0].value_mm + 50) < 0.6, "cabinet sunk 50 mm " + JSON.stringify(probs(r)));

r = run("wall_top_soffit");
ok(r.issues.some((f) => f.els[0] === 5 && f.problem === "Wall top short of soffit" && Math.abs(f.value_mm + 100) < 0.6), "W4 100 mm short of soffit " + JSON.stringify(probs(r)));
ok(!r.issues.some((f) => f.els[0] === 2), "W1 meets the soffit");

r = run("wall_base_floor");
ok(r.issues.length === 0, "wall bases on the slab " + JSON.stringify(probs(r)));

r = run("link_duplicates");
ok(r.issues.length === 1 && r.issues[0].els.join() === "6,15", "W5 duplicates the STR wall " + JSON.stringify(probs(r)));
r = run("link_clashes");
ok(r.issues.some((f) => f.els.join() === "2,16"), "W1 clashes with the STR column " + JSON.stringify(probs(r)));

r = run("column_clashes");
ok(!r.issues.length, "no wall runs into the host column " + JSON.stringify(probs(r)));

// the score: health.py's verify_score case - 144 findings over 1913 elements in one of ten checks
const res = {};
for (let i = 0; i < 10; i++) res["c" + i] = { population: 1913, issues: [] };
res.c0.issues = Array.from({ length: 144 }, (_, i) => ({ primary: i }));
const h = health(res);
ok(Math.abs(h.score - (100 - 144 / 1913 * 10)) < 1e-9 && h.grade === "A", "score " + h.score.toFixed(2) + " " + h.grade);
const h2 = health(res, (f) => f.primary < 44);
ok(Math.abs(h2.score - (100 - 100 / 1913 * 10)) < 1e-9 && h2.accepted === 44, "accepted findings leave the score");
ok(signature({ check: "wall_gaps", problem: "Corner gap", els: [3, 2] }, (k) => "u" + k) === "wall_gaps|Corner gap|u2,u3", "signature: sorted uids");
ok(CHECKS.length === 12, "12 checks");
ok(Math.abs(rectOf(els[2]).len - 10) < 1e-6 && Math.abs(rectOf(els[2]).thk - 0.2) < 1e-6, "wall rectangle 10 m x 200 mm");
// more walls, on their own
K = 1000;
const slab = el("Floors", "Slab", [-1, -1, -0.2], [30, 30, 0]);
const A = wall([0, 20], [10, 20], 0.2, 0, 3), B = wall([5, 20.07], [5, 25], 0.2, 0, 3);   // B runs 30 mm into A
const C = wall([0, 22.25], [4, 22.25], 0.2, 0, 3), D = wall([0, 22.0], [4, 22.0], 0.2, 0, 3);  // 50 mm apart, side by side
const E = wall([20, 20], [28, 20], 0.2, 0, 3), F = wall([24, 16], [24, 24], 0.2, 0, 3);    // a full crossing
const G = wall([20, 28], [28, 28], 0.2, 0, 3, { dr: { ph: [0, 1] } }), Hh = wall([24, 28.1], [24, 29], 0.2, 0, 3, { dr: { ph: [2, -1] } }); // demolished before H is built
const more = [slab, A, B, C, D, E, F, G, Hh];
r = runCheck("wall_overlaps", more, defaults());
ok(r.issues.some((f) => f.problem === "End over-run into wall" && f.els[0] === B.k && Math.abs(f.value_mm - 30) < 1), "B runs 30 mm into A " + JSON.stringify(probs(r)));
ok(!r.issues.some((f) => f.els.includes(E.k)), "a full crossing is let go (skip_crossing)");
const o2 = defaults(); o2.wall_overlaps.skip_crossing = false;
ok(runCheck("wall_overlaps", more, o2).issues.some((f) => f.problem === "Crossing over-run"), "... and reported when asked");
const o3 = defaults(); o3.wall_gaps.tolerance_mm = 60;
r = runCheck("wall_gaps", more, o3);
ok(r.issues.some((f) => f.problem === "Parallel sliver" && Math.abs(f.value_mm - 50) < 1), "parallel sliver 50 mm (tolerance 60) " + JSON.stringify(probs(r)));
ok(!r.issues.some((f) => f.els.includes(Hh.k)), "phases that never overlap: no gap reported");

// the dimension drawn at each finding: where it was measured
const len = (d) => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]);
const fOf = (id, prob, o) => runCheck(id, els, o || defaults()).issues.find((f) => f.problem === prob);
let f = fOf("wall_gaps", "T-junction gap") || fOf("wall_gaps", "Corner gap");
ok(f && f.dim && Math.abs(len(f.dim) * 1000 - f.value_mm) < 0.2 && /gap$/.test(f.dim.label), "gap dimension " + (f && JSON.stringify(f.dim)));
ok(f && Math.abs(f.dim.a[1] - 1.65) < 0.01, "... at mid height");
f = fOf("wall_overlaps", "Collinear overlap");
ok(f && Math.abs(len(f.dim) - 2) < 0.002 && /overlap/.test(f.dim.label), "overlap dimension 2000 mm " + (f && f.dim.label));
f = fOf("door_floor", "Door above floor");
ok(f && Math.abs(len(f.dim) - 0.04) < 1e-4 && f.dim.a[0] === f.dim.b[0] && f.dim.a[2] === f.dim.b[2], "door: vertical 40 mm " + (f && f.dim.label));
f = fOf("wall_top_soffit", "Wall top short of soffit");
ok(f && Math.abs(len(f.dim) - 0.1) < 1e-4, "soffit: 100 mm " + (f && f.dim.label));
f = fOf("wall_column_gaps", "Wall short of column");
ok(f && Math.abs(len(f.dim) - 0.004) < 2e-4, "column gap 4 mm " + (f && f.dim.label));
f = fOf("element_floor", "Component sunk into floor");
ok(f && Math.abs(len(f.dim) - 0.05) < 1e-4, "sunk 50 mm " + (f && f.dim.label));
f = fOf("link_clashes", "Clash with linked model");
ok(f && f.dim && /deep/.test(f.dim.label), "link clash depth " + (f && f.dim.label));
ok(!fOf("duplicates", "Stacked duplicate").dim, "duplicates: no dimension");
r = runCheck("wall_overlaps", more, defaults());
f = r.issues.find((x) => x.problem === "End over-run into wall");
ok(f && Math.abs(len(f.dim) - 0.03) < 0.001, "over-run 30 mm dimension " + (f && JSON.stringify(f.dim)));
r = runCheck("wall_gaps", more, o3);
f = r.issues.find((x) => x.problem === "Parallel sliver");
ok(f && Math.abs(len(f.dim) - 0.05) < 0.001, "sliver 50 mm dimension " + (f && f.dim.label));

if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("all passed");
