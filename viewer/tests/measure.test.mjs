import * as ME from "../measure.js";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// a corridor 1.5 m clear (y 0 .. 1.5), a wall end on each side: two corners, each with a face each way
const geo = {
  pts: [[10, 0], [10.825, 1.5]],
  segs: [[[0, 0], [10, 0]], [[10, 0], [10, -2]], [[10.825, 1.5], [20, 1.5]], [[10.825, 1.5], [10.825, 4]]],
};
const A = ME.snap([10.02, 0.02], geo, 0.3), B = ME.snap([10.8, 1.48], geo, 0.3);
ok(A.kind === "corner" && B.kind === "corner", "both points on corners");
const m = ME.measureOf(A, B);
ok(m.clear && Math.abs(m.L - 1.5) < 1e-9, `corner to corner across the corridor: the clear width ${m.L} (not the 0.825 between the wall ends)`);
// a short face's middle does not take the point off the long face it is on
const g2 = { pts: [], segs: [[[0, 0], [20, 0]], [[5, 0], [5.2, 0]]] };
const S = ME.snap([5.3, 0.01], g2, 0.5);
ok(S.kind === "face" || (S.kind === "middle" && Math.abs(S.p[0] - 10) < 1e-9), "a 200 mm face's middle is not snapped to: " + S.kind + " " + S.p);
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
