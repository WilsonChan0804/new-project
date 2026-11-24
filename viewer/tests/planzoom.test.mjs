/* node viewer/tests/planzoom.test.mjs - the plans' zoom and pan */
import * as PZ from "../planzoom.js";
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const s = PZ.create(), bw = 400, bh = 300, at = (v, x) => v.OX + x * v.SC;
const v0 = PZ.apply(s, 20, 50, 40, bw, bh);
ok(v0.SC === 20 && v0.OX === 50 && v0.OY === 40, "no zoom: the fitted drawing as it is");
// the point under (130, 0 + ...) stays put when zooming about it
const px = 130, xm = (px - v0.OX) / v0.SC;
PZ.zoomAt(s, 2.5, px, 100, bw, bh);
const v1 = PZ.apply(s, 20, 50, 40, bw, bh);
ok(near(v1.SC, 50, 1e-9) && near(at(v1, xm), px, 1e-9), "zoom 2.5× about a point: that point stays where it is");
s.px += 30; ok(near(PZ.apply(s, 20, 50, 40, bw, bh).OX, v1.OX + 30, 1e-9), "a pan moves the drawing");
PZ.zoomAt(s, 1000, 0, 0, bw, bh); ok(s.z === PZ.ZMAX, "the zoom is limited");
PZ.reset(s); ok(s.z === 1 && s.px === 0 && s.py === 0, "Fit: back to the start");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
