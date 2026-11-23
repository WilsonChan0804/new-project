/* node viewer/tests/gbpcore.test.mjs - the GBP workbook's calculations
   against the worked numbers of the office's Revit GBP setting (a 5-storey
   school, site class B) and the code tables. */
import * as C from "../gbpcore.js";
import { site, band, gfa, siteCoverage, occupancy, exitsFor, checkExits, effectiveTotal, stairCapacity, discharge, storeyLoads, num, yes, ceilPersons, compositeIndex } from "../gbpcore.js";
import { FIRST_SCHEDULE, B1, B2, APP151 } from "../gbptables.js";

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e = 0.0005) => Math.abs(a - b) <= e;

// --- the tables as transcribed
ok(FIRST_SCHEDULE.length === 12 && FIRST_SCHEDULE.every((b) => b.dsc.length === 3 && b.npr.length === 3), "First Schedule: 12 height bands, 3 classes");
ok(B2.length === 14 && B2[0].from === 4 && B2[13].to === 3000, "Table B2: 4 to 3000 persons");
ok(APP151.filter((a) => a.cap).map((a) => a.item).join(",") === "2.3,5,11,12,14,15,19,20,22,25,26,29", "APP-151: the items under the 10% cap");
ok(new Set(B1.map((x) => x.key)).size === B1.length, "Table B1: keys unique");

// --- helpers
ok(num("9.000 m²") === 9 && num("1,108.351 m²") === 1108.351 && num("") === null && num("abc") === null, "num() reads Revit's texts");
ok(yes("Yes") && yes(true) && !yes("No") && !yes(""), "yes() reads Revit's Yes/No");
ok(ceilPersons(91.016) === 92 && ceilPersons(8.0000000001) === 8 && ceilPersons(7.324) === 8, "persons round up, not on floating point");

// --- Site: 7192.891 m2, class B, street 156.790 - 161.180, roof 178.600
const s = site({ area: 7192.891, cls: "B", kind: "non-domestic", street_low: 156.79, street_high: 161.18, roof: 178.6 });
ok(near(s.mean, 158.985) && near(s.height, 19.615), `mean level ${s.mean}, height ${s.height}`);
ok(s.band === "Over 18 m but not exceeding 21 m" && s.sc === 95 && s.pr === 6.7, `band ${s.band}: SC ${s.sc}% PR ${s.pr}`);
ok(near(s.sc_area, 6833.246) && near(s.gfa, 48192.37), `permitted SC ${s.sc_area} m2, GFA ${s.gfa} m2`);
ok(band(15).label === "Not exceeding 15 m" && band(15.001).upto === 18 && band(70).upto === null, "height bands: 15 m is in the first, over 61 m the last");
ok(site({ area: 1000, cls: "A", kind: "domestic", height: 12 }).gfa === 3300 && site({ area: 1000, cls: "A", kind: "domestic", height: 12 }).sc === 66.6, "domestic class A <= 15 m: 66.6% / 3.3");
ok(site({ area: 1000, cls: "B" }).status === "check", "no height: check");
const ci = compositeIndex(site({ area: 1000, cls: "A", height: 12 }), 1650, 2500, 0, 0);
ok(ci.pr === 1 && ci.ok_pr, `composite: 1650/3300 + 2500/5000 = ${ci.pr}`);

// --- GFA, 1/F of the school
const A = (name, type, area, deduct = false) => ({ level: "1/F", name, type, area, deduct });
const rows = [
  A("FLOOR AREA & COVERED AREA", "GFA-ND0", 2163.895), A("COLUMN", "GFA-ND0", 0.49), A("COLUMN", "GFA-ND0", 0.49),
  A("H.R.", "GFA-ND0", 0.383, true), A("P.D.", "GFA-ND0", 0.775, true), A("P.D.", "GFA-ND0", 1.6, true),
  A("AHU ROOM '1'", "GFA-C2.3", 86.527), A("P.D.", "GFA-ND0", 1.148, true), A("ELV ROOM '1'", "GFA-ND0", 12.495, true),
  A("VOID ABOVE OF ASSEMBLY HALL", "GFA-C24", 312.225), A("VOID ABOVE OF COVERED PLAYGROUND", "GFA-C25", 232.58),
  A("P.D.", "GFA-ND0", 0.68, true), A("P.D.", "GFA-ND0", 0.4, true), A("P.D.", "GFA-ND0", 0.68, true), A("P.D.", "GFA-ND0", 0.665, true),
  A("IRRIGATION/FLUSHING/CLEANSING/POTABLE WATER PUMP & TANK ROOM", "GFA-C2.2", 87.628), A("ELV ROOM '2'", "GFA-ND0", 14.152, true),
  A("MAIN SWITCH ROOM", "GFA-ND0", 33.435, true), A("PLANT ROOM CORRIDOR", "GFA-ND0", 21.725, true),
];
const g = gfa(rows, { permitted: s.gfa });
const f1 = g.levels.find((L) => L.level === "1/F");
// the deck adds Revit's own areas; these are its 3-decimal printouts, so sums may differ by 0.001
ok(near(f1.outline, 2971.972, 0.002) && near(f1.deduct, 807.097, 0.002) && near(f1.gfa, 2164.875), `1/F: ${f1.outline} - ${f1.deduct} = ${f1.gfa} m2`);
const ahu = g.limits.find((x) => x.item === "2.3");
ok(ahu && near(ahu.allowed, 86.595) && ahu.status === "ok", `AHU room 86.527 m2 <= 4% of 1/F GFA = ${ahu && ahu.allowed} m2`);
ok(g.concessions.map((c) => c.item).join(",") === "2.2,2.3,24,25", "concessions by APP-151 item: " + g.concessions.map((c) => c.item).join(","));
ok(near(g.capped, 86.527 + 232.58) && near(g.cap_allowed, 216.488) && g.cap_status === "fail", `items under the cap ${g.capped} vs 10% x GFA = ${g.cap_allowed}`);
ok(g.status === "ok", "GFA within the permitted GFA");
const floors = [["G/F", 2781.145], ["1/F", 2164.875], ["2/F", 2242.161], ["3/F", 1567.589], ["4/F", 1619.891], ["R/F", 148.962]];
const g2 = gfa(floors.map(([l, a]) => ({ level: l, type: "GFA-ND0", area: a })), { permitted: s.gfa });
ok(near(g2.total, 10524.624, 0.002) && near(g2.total * 0.1, 1052.462, 0.001), `total GFA ${g2.total} m2; 10% = ${(g2.total * 0.1).toFixed(3)}`);

// --- site coverage
const sc = siteCoverage([{ type: "SC-ND0", area: 3102.172 }, { type: "SC-ND1", area: 50, deduct: true }, { type: "SC-ND0", area: 36.054 }, { type: "SC-ND0", area: 70 }], s.sc_area);
ok(near(sc.actual, 3208.226) && sc.status === "ok", `actual site coverage ${sc.actual} m2 <= ${s.sc_area}`);

// --- occupancy and exits
const R = (name, area, key, by) => ({ level: "G/F", name, area, key, by_number: by });
const occ = occupancy([
  R("ASSEMBLY HALL", 353.145, "5d-1"), R("CONFERENCE ROOM", 73.24, "4a-2"), R("MEDICAL ROOM", 11.73, "N", 2),
  R("STUDENT ACTIVITY CENTRE", 182.032, "5b-3"), R("PHYSICAL EDUCATION STORE", 25.383, "6c"), R("STORE ROOM '1'", 4.847, "6c"),
  R("SWITCH ROOM", 80, "8"), R("UNKNOWN", 20, "ZZ"), R("NO USE", 10, ""),
]);
const L = (nm) => occ.find((r) => r.name === nm).load;
ok(L("ASSEMBLY HALL") === 707 && L("CONFERENCE ROOM") === 8 && L("MEDICAL ROOM") === 2 && L("STUDENT ACTIVITY CENTRE") === 92 && L("PHYSICAL EDUCATION STORE") === 1 && L("STORE ROOM '1'") === 1,
  "room loads 707 / 8 / 2 / 92 / 1 / 1");
ok(L("SWITCH ROOM") === 0, "class 8 of 100 m2 or less counts zero (Table B1 note 7)");
ok(occ.find((r) => r.name === "UNKNOWN").status === "check" && occ.find((r) => r.name === "NO USE").status === "check", "unknown or missing use: check");
const e = exitsFor(707);
ok(e.n === 3 && e.doors === 4500 && e.door === 1200, "707 persons: 3 exits, 4500 mm doors, 1200 mm each");
ok(exitsFor(3).none && exitsFor(3001).beyond && exitsFor(30).n === 1 && exitsFor(31).n === 2, "Table B2 ends: <=3 none, >3000 BA, 30 / 31");
ok(effectiveTotal([900, 1600]) === 2250, "B7.3: 1600 next to 900 counts as 1350");
const ce = checkExits(707, { widths: [1500, 1500, 1500, 1500] });
ok(ce.status === "ok" && ce.prov.total === 6000, "assembly hall with 4 x 1500 doors: OK");
const cf = checkExits(707, { widths: [1200, 1200] });
ok(cf.status === "fail" && cf.items[0].status === "fail", "assembly hall with 2 doors: fails on the number");
const cs = checkExits(10, { n: 1, least: 1050, total: 1050 }, { storey: true });
ok(cs.need.n === 2 && cs.status === "fail", "a storey needs 2 exit routes however few persons (B8.1)");

// --- storey loads and staircase discharge (sprinkler protected)
const sl = storeyLoads(occ);
ok(sl.get("G/F") === 707 + 8 + 2 + 92 + 1 + 1 + 0, "storey load = the rooms' loads");
const storeys = [
  { level: "R/F", capacity: 10, stairs: ["S-1", "S-2"] }, { level: "4/F", capacity: 410, stairs: ["S-1", "S-2", "S-3"] },
  { level: "3/F", capacity: 410, stairs: ["S-1", "S-2", "S-3"] }, { level: "2/F", capacity: 571, stairs: ["S-1", "S-2", "S-3", "S-4"] },
  { level: "1/F", capacity: 283, stairs: ["S-1", "S-2", "S-3", "S-4"] }, { level: "G/F", capacity: 2267, ground: true, stairs: [] },
];
const stairs = ["S-1", "S-2", "S-3", "S-4"].map((m) => ({ mark: m, width: 1200 }));
const d = discharge(storeys, stairs, { sprinkler: true });
const D = (m) => d.stairs.find((x) => x.mark === m);
ok([493, 493, 486, 212].join() === ["S-1", "S-2", "S-3", "S-4"].map((m) => D(m).value).join(), "discharge values 493 / 493 / 486 / 212: " + ["S-1", "S-2", "S-3", "S-4"].map((m) => D(m).value).join(" / "));
ok([632, 632, 594, 518].join() === ["S-1", "S-2", "S-3", "S-4"].map((m) => D(m).capacity).join(), "capacities (B4, 1200 mm) 632 / 632 / 594 / 518");
ok(["S-1", "S-2", "S-3", "S-4"].map((m) => D(m).served).join() === "5,5,4,2", "storeys served 5 / 5 / 4 / 2");
ok(d.status === "ok" && d.total.above === 1684 && d.total.capacity === 2376, `B12.1: ${d.total.above} persons above G/F, staircases take ${d.total.capacity}`);
ok(d.storeys.find((r) => r.level === "2/F").shares["S-4"] === 142, "2/F 571 over 4: 143 + 143 + 143 + 142");
const d2 = discharge(storeys, stairs, { sprinkler: false });
ok(D("S-1").capacity === 632 && d2.stairs.find((x) => x.mark === "S-1").capacity === 392 && d2.stairs.find((x) => x.mark === "S-1").status === "fail", "non-sprinklered (B3): 392 < 493 fails");
ok(stairCapacity(1100, 3, { sprinkler: true }).value === 484 && stairCapacity(1750, 12, {}).value === 898 + 2 * 62, "B4 1050-1200 x 3 = 484; B3 1700 x 12 = 1022");
ok(stairCapacity(1000, 3).status === "check" && stairCapacity(2000, 2).status === "check", "narrower than 1050 or wider than 1800: check");
ok(stairCapacity(1200, 5, { sprinkler: true, up: true }).value === Math.floor(632 * 0.8), "exit upwards x 0.8 (B12.6)");

// --- Quick check (his reference tool's worked examples)
{
    const s = C.site({ area: 1000, cls: "A", kind: "composite", height: 15 });
  const c = C.compositePr(s, 0.61);
  ok(c.domPr === 2.897 && c.domGfa === 2897.4 && c.nonGfa === 610 && c.total === 3507.4, `composite A, <=15 m, 1000 m2, non-dom PR 0.61 -> dom PR ${c.domPr}, GFA ${c.domGfa}, total ${c.total}`);
  const r = C.occupancy([{ area: 450, key: "1b-2" }])[0];
  const e = C.exitsFor(r.load);
  ok(r.load === 50 && e.n === 2 && e.routes === 2100 && e.doors === 1750 && e.route === 1050 && e.door === 850, "Flats 450 m2 / 9 -> 50 persons: 2 exits, 2100 / 1750 mm, each 1050 / 850");
  const pass = C.checkExits(50, { widths: [1050, 1050] });
  ok(pass.status === "ok", "two 1050 mm exit doors pass for 50 persons");
  const q = C.quickStairs([{ floors: 10, key: "7", area: 1350 }], { stairs: 2, width: 1050, sprinkler: true });
  ok(q.total === 450 && q.per === 225 && q.storeys === 10 && q.capacity === 708 && q.status === "ok", `10 floors x 45 persons, 2 stairs of 1050 mm, sprinklered: ${q.per} each vs ${q.capacity} (Table B4)`);
}

console.log(`\n${n - fails} of ${n} passed`);
if (fails) process.exit(1);
console.log("all passed");
