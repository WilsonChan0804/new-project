/* node viewer/tests/walls.test.mjs - walls, corridors and lobbies at any angle */
import * as W from "../wallcore.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// an L: 4 m along x, then 3 m down, 0.2 thick on its centre line
const L = [[0, 0], [4, 0], [4, 3]];
const P = W.wallPoly(L, 0.2, "c");
ok(P.length === 6, "an L wall: 6 corners");
ok(near(W.polyArea(P), (4 + 3) * 0.2, 1e-9), "its area: its centre line 7 m × 0.2 (the mitre adds as much as it takes)");
const corner = P.find((q) => near(q[0], 4.1) && near(q[1], -0.1)) && P.find((q) => near(q[0], 3.9) && near(q[1], 0.1));
ok(!!corner, "mitred at the bend: (4.1, -0.1) outside and (3.9, 0.1) inside");
// left justification: the path is a face, the wall on one side only
const Pl = W.wallPoly([[0, 0], [5, 0]], 0.25, "l"), ys = Pl.map((q) => q[1]);
ok(near(Math.min(...ys), 0) || near(Math.max(...ys), 0), "left-justified: the path is one face");
ok(near(Math.max(...ys) - Math.min(...ys), 0.25), "and the wall 0.25 thick to its other side");
const Pr = W.wallPoly([[0, 0], [5, 0]], 0.25, "r");
ok(near(Math.min(...Pr.map((q) => q[1])) + Math.min(...ys), -0.25) || near(Math.max(...Pr.map((q) => q[1])) + Math.max(...ys), 0.25), "right-justified: to the other side");
// 120 degrees
const a = 120 * Math.PI / 180, A = [[0, 0], [5, 0], [5 + 4 * Math.cos(Math.PI - a), 4 * Math.sin(Math.PI - a)]];
ok(near(W.polyArea(W.wallPoly(A, 0.2)), 9 * 0.2, 5e-3), "a bend of 120°: the area its centre line × thickness");
// split and join
const w = { path: L, t: 0.2, m: "rc", just: "c", openings: [{ seg: 1, at: 1, w: 0.9, type: "door" }] };
const [w1, w2] = W.splitWall(w, 0, 2);
ok(w1.path.length === 2 && near(w1.path[1][0], 2) && w2.path.length === 3, "split at 2 m on its first segment: 2 m and the rest");
ok(w2.openings.length === 1 && w2.openings[0].seg === 1 && w1.openings.length === 0, "the door goes with the second part");
const j = W.joinWalls(w1, w2);
ok(j && j.path.length === 3 && near(W.pathLen(j.path), 7) && j.openings[0].seg === 1 && near(j.openings[0].at, 1), "joined again: one L, the straight joint taken out, the door where it was");
const jr = W.joinWalls(w2, W.reverseWall(w1));
ok(jr && near(W.pathLen(jr.path), 7), "joined from either end");
ok(W.joinWalls({ path: [[0, 0], [1, 0]] }, { path: [[3, 0], [4, 0]] }) === null, "walls apart do not join");
const ds = W.deleteSegment({ path: [[0, 0], [2, 0], [2, 2], [4, 2]], t: 0.2 }, 1);
ok(ds.length === 2 && ds[0].path.length === 2 && ds[1].path.length === 2, "the middle segment taken out: two walls left");
// nearest
const q = W.nearestOnWalls([2, 0.3], [w]);
ok(q && q.i === 0 && q.seg === 0 && near(q.s, 2) && near(q.d, 0.2), "a point 0.3 m from the centre line: 0.2 m from the face, 2 m along");
ok(W.nearestOnWalls([2, 2], [w], 0.5) === null, "too far: none");
// openings
ok(JSON.stringify(W.solidParts(4, [{ at: 1, w: 0.9 }, { at: 3, w: 0.5 }])) === JSON.stringify([[0, 1], [1.9, 3], [3.5, 4]]), "a segment's solid parts between two openings");
const pc = W.wallPieces(w);
ok(pc.pieces.length === 3 && pc.ops.length === 1, "the L with a door: 3 solid pieces, 1 opening");
const area = pc.pieces.reduce((s, p) => s + W.polyArea(p.pts), 0);
ok(near(area, 7 * 0.2 - 0.9 * 0.2, 1e-6), "the pieces' area: less the door's");
const po = W.placeOpening(w, 0, 3.9, { w: 0.9, type: "window" });
ok(near(po.at, 3.1), "an opening dropped near the end stays on the segment");
ok(near(W.snapAngle([0, 0], [10, 1])[1], 0) && near(W.snapAngle([0, 0], [10, 2.5], 15)[1], Math.hypot(10, 2.5) * Math.sin(Math.PI / 12), 1e-3), "15° steps while drawing");
const cl = W.clipHalf([[0, 0], [10, 0], [10, 10], [0, 10]], [4, 0], [1, 0]);
ok(near(W.polyArea(cl), 60), "a plate clipped at x = 4: 60 m² left");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
