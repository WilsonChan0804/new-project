/* node viewer/tests/sitecore.test.mjs - Site study geometry and rules */
import * as S from "../sitecore.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;

const c = [22.3, 114.26]; // Tseung Kwan O
const sq = S.fromXY([[0, 0], [40, 0], [40, 50], [0, 50]], c); // 40 x 50 m
ok(near(S.area(sq), 2000, 0.05), "a 40 x 50 m site is 2,000 m2: " + S.area(sq).toFixed(3));
ok(near(S.perimeter(sq), 180, 0.01), "its perimeter 180 m");
ok(S.edges(sq).map((x) => Math.round(x)).join(",") === "40,50,40,50", "edge lengths 40, 50, 40, 50");
const sc = S.scaleTo(sq, 2500);
ok(near(S.area(sc.pts), 2500, 0.05) && near(sc.factor, Math.sqrt(1.25), 1e-6), "scaled to 2,500 m2, factor " + sc.factor.toFixed(4));
const c1 = S.centroid(sq), c2 = S.centroid(sc.pts);
ok(near(c1[0], c2[0], 1e-9) && near(c1[1], c2[1], 1e-9), "scaled about its centroid: it stays put");
const L = S.fromXY([[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]], c);
ok(near(S.area(L), 60 * 20 + 20 * 40, 0.05), "an L-shaped site: 2,000 m2");
ok(near(S.area(S.scaleTo(L, 1234.5).pts), 1234.5, 0.05), "the L scaled to 1,234.5 m2");
ok(S.selfCrosses(S.fromXY([[0, 0], [40, 40], [40, 0], [0, 40]], c)) && !S.selfCrosses(L) && !S.selfCrosses(sq), "a bow tie crosses itself, the L and the rectangle do not");
ok(near(S.area(S.rectangle(c, 1500)), 1500, 0.05), "a starting rectangle of 1,500 m2");

// class of site
ok(S.siteClass(4, []).cls === "A", "no street: class A");
ok(S.siteClass(4, [{ edge: 0, width: 12 }]).cls === "A", "one street: class A");
ok(S.siteClass(4, [{ edge: 0, width: 12 }, { edge: 1, width: 6 }]).cls === "B", "two streets meeting: class B");
ok(S.siteClass(4, [{ edge: 0, width: 12 }, { edge: 3, width: 6 }]).cls === "B", "two streets meeting through the closing edge: class B");
ok(S.siteClass(4, [{ edge: 0, width: 12 }, { edge: 2, width: 6 }]).cls === "A", "two streets on opposite sides, no corner: class A");
ok(S.siteClass(4, [{ edge: 0, width: 12 }, { edge: 1, width: 6 }, { edge: 2, width: 9 }]).cls === "C", "three streets: class C");
const nar = S.siteClass(4, [{ edge: 0, width: 12 }, { edge: 1, width: 3 }]);
ok(nar.cls === "A" && /not counted/.test(nar.why), "a 3 m lane does not count: class A, " + nar.why);

// a corner on a street edge (collinear halves) is still one street
const five = S.fromXY([[0, 0], [20, 0], [40, 0], [40, 50], [0, 50]], c);
ok(S.siteClass(5, [{ edge: 0, width: 12 }, { edge: 1, width: 12 }, { edge: 2, width: 6 }], five).cls === "B", "a street in two pieces + a side street: class B, not C");
ok(S.siteClass(5, [{ edge: 0, width: 12 }, { edge: 1, width: 12 }], five).streets === 1, "the two pieces are one street");
ok(Math.round(S.turns(sq)[1]) === 90 && Math.round(S.turns(five)[1]) === 0, "turns: 90 at a rectangle corner, 0 mid-edge");

// HK 1980 Grid -> WGS84: the HK80 origin and a known point
const o = S.hk80ToWgs84(836694.05, 819069.80);
ok(near(o[0], 22 + 18 / 60 + 43.68 / 3600 - 5.5 / 3600, 1e-6) && near(o[1], 114 + 10 / 60 + 42.8 / 3600 + 8.8 / 3600, 1e-6), "the grid origin: " + o.map((x) => x.toFixed(6)));
// 1 km east and 2 km north of the origin lands 1 km / 2 km away on the ground
const p = S.hk80ToWgs84(836694.05 + 1000, 819069.80 + 2000), dxy = S.toXY([p], o)[0];
ok(near(dxy[0], 1000, 2) && near(dxy[1], 2000, 2), "1 km E, 2 km N of the origin: " + dxy.map((x) => x.toFixed(1)));

// development potential: TKO Area 137A, R(A)9 (S/TKO/32): dom PR 7.5, non-dom 0.3, 200 mPD
const pot = S.potential({ area: 91509, bpr: { dpr: 10, npr: 15, sc: 33.33 }, ozp: { dpr: 7.5, npr: 0.3, sc: null, bh: 200 }, lease: { dgfa: 680000, bh: "" } });
const row = (k) => pot.find((r) => r.key === k);
ok(near(row("dgfa").ozp, 686317.5, 0.001) && row("dgfa").value === 680000 && row("dgfa").by === "Lease", "domestic GFA: OZP 686,317.5, the lease's 680,000 governs");
ok(near(row("ngfa").value, 27452.7, 0.001) && row("ngfa").by === "OZP", "non-domestic GFA: OZP 0.3 governs");
ok(near(row("gfa").value, 713770.2, 0.001), "total GFA from the OZP: 713,770.2");
ok(row("sc").value === 33.33 && row("sc").by === "B(P)R" && row("bh").value === 200 && row("bh").by === "OZP", "SC by B(P)R, height by the OZP");
ok(row("storeys").value === null, "no storey limit given: none");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
