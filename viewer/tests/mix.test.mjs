/* node viewer/tests/mix.test.mjs - the flat mix table and the elevation */
import * as X from "../mixcore.js";
import * as M from "../massingcore.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };

const rm = (k) => ({ id: k + Math.random(), kind: k, x: 0, y: 0, w: 3, h: 3 });
const lib = [
  { name: "A1", rooms: [rm("LD"), rm("MBR")] },
  { name: "A2", rooms: [rm("LD"), rm("MBR")] },
  { name: "B1", rooms: [rm("LD"), rm("MBR"), rm("BR")] },
  { name: "C1", rooms: [rm("LD"), rm("MBR"), rm("BR"), rm("BR"), rm("BR")] },
  { name: "SP", band: "sp", rooms: [rm("LD"), rm("MBR"), rm("BR")] },
];
ok(X.band(lib[0]) === "1" && X.band(lib[2]) === "2" && X.band(lib[3]) === "3" && X.band(lib[4]) === "sp", "bands: by bedrooms, or as set on the unit");

const T = X.table([{ name: "A2", sa: 32, n: 100 }, { name: "A1", sa: 28, n: 50 }, { name: "B1", sa: 45, n: 120 }, { name: "B1", sa: 45, n: 30 }, { name: "C1", sa: 70, n: 77 }, { name: "SP", sa: 130, n: 3 }], lib);
ok(T.total.n === 380 && Math.abs(T.total.tot - (28 * 50 + 32 * 100 + 45 * 150 + 70 * 77 + 130 * 3)) < 1e-9, "totals: 380 flats, " + T.total.tot);
ok(T.bands.map((b) => b.k).join(",") === "1,2,3,sp", "bands in order 1-BR, 2-BR, 3-BR, special: " + T.bands.map((b) => b.k));
ok(T.bands[0].rows[0].name === "A1" && T.bands[0].rows[0].no === 1 && T.bands[1].rows[0].no === 3, "rows by SA within a band, numbered through");
const pn = T.bands.reduce((s, b) => s + b.pn, 0), pa = T.bands.reduce((s, b) => s + b.pa, 0);
ok(Math.abs(pn - 100) < 1e-9 && Math.abs(pa - 100) < 1e-9, `percentages add up to 100.00 (${pn.toFixed(2)}, ${pa.toFixed(2)})`);
ok(T.bands[1].n === 150, "the same type from two groups is one row");
ok(T.colors.A1 !== T.colors.A2 && /^#[0-9a-f]{6}$/.test(T.colors.B1), "a colour for each type");
ok(X.table([{ name: "A1", sa: 28, n: 5 }], lib, { A1: "#123456" }).colors.A1 === "#123456", "a colour set by hand stays");

// ring order: north left to right, the core, south right to left
const q = (name, band, x, w = 6) => ({ name, band, x, w, fig: { saleable: 40 } });
const r = { placed: [q("n2", "n", 20), q("n1", "n", 0), q("n3", "n", 40), q("s1", "s", 0), q("s2", "s", 30)], core: [{ kind: "stair", x: 28, w: 6 }, { kind: "passage", x: 0, w: 60 }], L: 50 };
const ring = X.ring(r).map((c) => c.name).join(",");
ok(ring === "n1,n2,Core,n3,s2,s1", "ring order round the corridor: " + ring);
// two legs: the second leg's flats after the first's
const r2 = { multi: true, legs: [{ k: 1, r: { L: 20, placed: [q("b", "n", 2)], core: [] } }, { k: 0, r: { L: 30, placed: [q("a", "n", 5)], core: [] } }] };
ok(X.ring(r2).map((c) => c.name).join(",") === "a,b", "legs in their order along the corridor");

// the elevation: a podium, a tower of 2 groups (16 + 1), a refuge between, a transfer plate
const sq = (w, d, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const m = { blocks: [
  { id: "p", name: "Podium", fp: sq(60, 40), groups: [{ use: "car", n: 2, h: 4.5 }, { use: "club", n: 1, h: 5 }, { use: "transfer", n: 1, h: 2.5 }] },
  { id: "t", name: "T1", on: "p", fp: sq(30, 20), groups: [{ use: "dom", n: 16, h: 3.15 }, { use: "refuge", n: 1, h: 4.5 }, { use: "dom", n: 13, h: 3.15 }, { use: "dom", n: 1, h: 3.15 }] },
] };
const blds = M.buildings(m), figs = M.figures(m, 4000, 6).buildings;
const cells = [{ kind: "unit", name: "A1", sa: 30 }, { kind: "core", name: "Core" }];
const E = X.elevation(blds, (b, gi) => (b === "t" ? cells : null), figs, M.USES);
ok(E.length === 1 && E[0].rows.length === 4 + 31, "one row per floor (podium 4 incl. TP, tower 31): " + E[0].rows.length);
ok(E[0].rows[0].use === "car" && E[0].rows[3].use === "transfer" && E[0].rows[4].cells.length === 2, "car park at the bottom, then TP, then flats");
ok(E[0].runs.map((g) => g.label).join(",") === "16 FLOOR,13+1 FLOOR", "side labels: " + E[0].runs.map((g) => g.label));
ok(Math.abs(E[0].mpd - (6 + 9 + 5 + 2.5 + 16 * 3.15 + 4.5 + 14 * 3.15)) < 1e-6, "the top mPD: " + E[0].mpd);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
