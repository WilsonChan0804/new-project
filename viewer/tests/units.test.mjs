/* node viewer/tests/units.test.mjs - unit areas and concessions */
import * as U from "../unitcore.js";
import { TEMPLATES } from "../unittables.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;

const t1 = TEMPLATES["1R"], f1 = U.figures(t1);
// inner 3.1 x (1.6 + 2.6 + 2.4 + 2 x 0.1) = 3.1 x 6.8; outer + 2 x 0.1 (party halves) and 0.2 + 0.2 (façade, corridor)
ok(near(f1.layout.W, 3.1, 1e-9) && near(f1.layout.D, 6.8, 1e-9), "1-room inner 3.1 × 6.8 m");
ok(near(f1.enclosed, 3.3 * 7.2, 1e-6), "enclosed to the party walls' middles and the outside of the external walls: 23.76 m²");
ok(near(f1.saleable, 23.76 + 2 + 1.5, 1e-6) && near(f1.saleableFt, 293, 1), "saleable 27.26 m² (293 ft²) with the balcony 2.0 and UP 1.5, not the A/C platform");
ok(near(f1.balEx, 1, 1e-9) && near(f1.upEx, 0.75, 1e-9), "balcony exempt 1 m² (50% of 2 capped at max(1, 2.5% UFS)), UP 0.75 m²");
ok(near(f1.gfa, 23.76 + 1 + 0.75, 1e-6), "unit GFA 25.51 m²");
// widen the bedroom 0.3 m: the unit widens 0.3 m
const f2 = U.figures(U.setWidth(t1, 2, 0, 2.7));
ok(near(f2.layout.outW - f1.layout.outW, 0.3, 1e-9) && near(f2.enclosed - f1.enclosed, 0.3 * 7.2, 1e-6), "bedroom 0.3 m wider: the unit 0.3 m wider, +2.16 m²");
const f3 = U.figures(U.movePartition(t1, 2, 0, -0.2));
ok(near(f3.layout.W, 3.1, 1e-9) && /Bedroom: 2\.20/.test(f3.warn.join()) === false && f3.layout.rooms.find((r) => r.name === "Bedroom").w === 2.2, "moving the partition keeps the width, the bedroom 2.2 m");
const f4 = U.figures(U.setWidth(t1, 2, 0, 2.0));
ok(f4.warn.some((w) => /Bedroom: 2\.00 m is under 2\.1/.test(w)), "a 2.0 m bedroom warns");
// a deep A/C platform is exempt only under the cap
const t5 = JSON.parse(JSON.stringify(t1)); t5.extras.push({ kind: "acp", w: 1.0, d: 0.9 });
const f5 = U.figures(t5);
ok(near(f5.acpCapEx, 0.9, 1e-9) && near(f5.acpFree, 0.6, 1e-9) && f5.warn.some((w) => /over 750 mm/.test(w)), "A/C platform 0.9 m deep: under the cap, with a warning");
// a small balcony: no exemption
const t6 = JSON.parse(JSON.stringify(t1)); t6.extras[0] = { kind: "bal", w: 1.2, d: 1.2 };
ok(U.figures(t6).balEx === 0, "a 1.44 m² balcony: not exempted (under 2 m²)");
for (const [k, t] of Object.entries(TEMPLATES)) { const f = U.figures(t); ok(f.saleable > 15 && f.saleable < 90, `${k}: ${f.saleableFt} ft² saleable`); }
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
