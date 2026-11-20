/* node viewer/tests/progcore.test.mjs - the Programme's scheduling: the
   working-day calendar, the four link types with lag, the critical path on
   a textbook network, summaries, loops, baselines and CSV. */
import { Calendar, schedule, parseDur, parseDeps, formatDeps, outline, takeBaseline, variance, expectedPct, toCsv, fromCsv, isoFromText, hkHolidays, dayOf, isoOf } from "../progcore.js";

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const T = (id, dur, deps = [], x = {}) => Object.assign({ id, name: id, level: 0, kind: "task", start: "", dur, pct: 0, deps }, x);
const fs = (from, lag = 0) => ({ from, type: "FS", lag });

// --- calendar
const wk = new Calendar({ week: "mon-fri", holidays: hkHolidays() });
ok(isoOf(dayOf("2027-03-01")) === "2027-03-01", "dates round trip");
ok(wk.add("2027-03-05", 1) === "2027-03-08", "Fri + 1 working day = Mon");
ok(wk.add("2027-03-25", 1) === "2027-03-30", "Thu 25 Mar 2027 + 1 skips Good Friday, Sat and Easter Monday");
ok(wk.add("2027-02-05", 1) === "2027-02-10", "Lunar New Year 2027 (6, 8, 9 Feb) skipped");
const sat = new Calendar({ week: "mon-sat", holidays: [] });
ok(sat.add("2027-03-05", 1) === "2027-03-06", "Mon - Sat: Fri + 1 = Sat");
const all = new Calendar({ week: "all" });
ok(all.add("2027-03-05", 2) === "2027-03-07", "calendar days count weekends");
const shut = new Calendar({ week: "mon-fri", off: ["2027-07-05..2027-07-09"] });
ok(shut.add("2027-07-02", 1) === "2027-07-12", "the office's own week off is skipped");
ok(wk.between("2027-03-01", "2027-03-08") === 5, "working days between two Mondays = 5");
ok(parseDur("10") === 10 && parseDur("2w") === 10 && parseDur("2w", 6) === 12 && parseDur("3 days") === 3 && parseDur("x") === null, "durations: 10, 2w, 3 days");

// --- the textbook network (calendar days, start 2027-01-01)
//   A3 -> B4 -> D5 -> F2 ; A -> C2 -> E3 -> F
const net = [T("A", 3, [], { start: "2027-01-01" }), T("B", 4, [fs("A")]), T("C", 2, [fs("A")]), T("D", 5, [fs("B")]), T("E", 3, [fs("C")]), T("F", 2, [fs("D"), fs("E")])];
let s = schedule(net, all);
const r = Object.fromEntries(s.rows.map((x) => [x.id, x]));
ok(s.days === 14 && s.finish === "2027-01-14", `project 14 days, finish ${s.finish}`);
ok(["A", "B", "D", "F"].every((k) => r[k].critical) && !r.C.critical && !r.E.critical, "critical path A-B-D-F");
ok(r.C.tf === 4 && r.E.tf === 4 && r.C.ff === 0 && r.E.ff === 4, `floats: C tf ${r.C.tf} ff ${r.C.ff}, E tf ${r.E.tf} ff ${r.E.ff}`);
ok(r.D.start === "2027-01-08" && r.D.finish === "2027-01-12" && r.F.start === "2027-01-13", "D 8 - 12 Jan, F from 13 Jan");
ok(r.E.late_start === "2027-01-10", "E may start as late as 10 Jan");

// --- link types and lag (working days)
const base = { start: "2027-03-01" };
const two = (type, lag, d2 = 3) => schedule([T("P", 5, [], { start: "2027-03-01" }), T("S", d2, [{ from: "P", type, lag }])], wk, base).rows[1];
ok(two("FS", 0).start === "2027-03-08", "FS: after P's finish (Fri 5 Mar) -> Mon 8 Mar");
ok(two("FS", 2).start === "2027-03-10", "FS+2d -> Wed 10 Mar");
ok(two("FS", -2).start === "2027-03-04", "FS-2d (lead) -> Thu 4 Mar");
ok(two("SS", 2).start === "2027-03-03", "SS+2d -> Wed 3 Mar");
ok(two("FF", 0).finish === "2027-03-05" && two("FF", 0).start === "2027-03-03", "FF: finishes with P");
const sf = schedule([T("P", 5, [], { start: "2027-03-08" }), T("S", 2, [{ from: "P", type: "SF", lag: 0 }])], wk, base).rows[1];
ok(sf.finish === "2027-03-05" && sf.start === "2027-03-04", "SF: finishes as P starts (P from Mon 8 Mar -> S Thu 4 - Fri 5 Mar)");
ok(two("FF", 1).finish === "2027-03-08", "FF+1d: finishes a day after P");
// a start date of its own holds a task later than its link
const own = schedule([T("P", 2, [], { start: "2027-03-01" }), T("S", 2, [fs("P")], { start: "2027-03-15" })], wk, base);
ok(own.rows[1].start === "2027-03-15" && own.rows[0].tf === 8 && !own.rows[0].critical, "a task's own later start date holds; its predecessor gets float");

// --- milestones, summaries, links to a summary
const tree = [
  T("ph1", 0, [], { level: 0, name: "Design" }),
  T("a", 5, [], { level: 1, start: "2027-03-01", pct: 100 }),
  T("b", 5, [fs("a")], { level: 1, pct: 0 }),
  T("m", 0, [fs("ph1")], { level: 0, kind: "milestone", name: "Design approved" }),
  T("ph2", 0, [fs("m")], { level: 0, name: "Construction" }),
  T("c", 10, [], { level: 1 }),
];
s = schedule(tree, wk, base);
const t = Object.fromEntries(s.rows.map((x) => [x.id, x]));
ok(t.ph1.summary && t.ph1.start === "2027-03-01" && t.ph1.finish === "2027-03-12" && t.ph1.pct === 50, `summary rolls up: ${t.ph1.start} - ${t.ph1.finish}, ${t.ph1.pct}%`);
ok(t.m.milestone && t.m.start === "2027-03-12" && t.m.ms_end && t.m.finish === t.m.start, "a milestone after the summary: at the end of its last day, 12 Mar (a link from a summary = from its tasks)");
ok(t.c.start === "2027-03-15" && t.c.critical, "a link to a summary reaches its tasks");
ok(outline(tree).map((o) => o.wbs).join(" ") === "1 1.1 1.2 2 3 3.1", "WBS numbers 1, 1.1, 1.2, 2, 3, 3.1");

// --- a loop
const loop = schedule([T("x", 2, [fs("z")], { start: "2027-03-01" }), T("y", 2, [fs("x")]), T("z", 2, [fs("y")])], wk, base);
ok(loop.errors.some((e) => e.kind === "loop" && /x/.test(e.message) && /z/.test(e.message)), "a loop is reported, with its tasks");

// --- predecessors text
const pr = parseDeps("1FS+2d; 2ss; 1FF-1w", net, "F");
ok(!pr.error && pr.deps.length === 3 && pr.deps[1].type === "SS" && pr.deps[2].lag === -5, "parse 1FS+2d; 2ss; 1FF-1w");
ok(formatDeps(pr.deps, net) === "1+2d; 2SS; 1FF-5d" || formatDeps(pr.deps, net) === "1FS+2d; 2SS; 1FF-5d", "format back: " + formatDeps(pr.deps, net));
ok(parseDeps("6", net, "F").error && parseDeps("9", net, "F").error && parseDeps("1XX", net, "F").error, "itself, no such row, nonsense are refused");

// --- baseline and variance, expected %
const b0 = takeBaseline(schedule(net, all), "Tender");
const moved = net.map((x) => (x.id === "B" ? Object.assign({}, x, { dur: 6 }) : x));
const s2 = schedule(moved, all);
const vF = variance(s2.rows[5], b0, s2.cal);
ok(vF.finish === 2 && vF.bfinish === "2027-01-14", "B 2 days longer -> F finishes 2 days late against the baseline");
ok(expectedPct({ es: all.ordOf("2027-01-01"), dur: 10 }, "2027-01-05", all) === 50, "expected % by the status date");

// --- CSV
const csv = toCsv(net, schedule(net, all), b0);
ok(csv.startsWith("﻿ID,WBS,Name") && csv.includes("Yes") && csv.split("\r\n").length === 8, "CSV: BOM, header, 6 rows");
const back = fromCsv(csv);
const s3 = schedule(back.tasks, all);
ok(back.tasks.length === 6 && s3.finish === "2027-01-14" && s3.rows[5].critical, "CSV round trip keeps the network");
const msp = "ID,Outline Level,Task Name,Duration,Start,Predecessors\n1,1,Design,10 days,Mon 1/3/27,\n2,2,Brief,5 days,Mon 1/3/27,\n3,2,Scheme,5 days,Mon 8/3/27,2\n4,1,Approval,0 days,Mon 15/3/27,3FS+2 days";
const im = fromCsv(msp);
ok(im.tasks.length === 4 && im.tasks[1].level === 1 && im.tasks[3].kind === "milestone" && im.tasks[3].deps[0].lag === 2 && im.tasks[1].start === "2027-03-01", "an MS Project CSV: outline levels, days, dates, lags");
ok(isoFromText("05-Jun-19") === "2019-06-05" && isoFromText("6/3/2019") === "2019-03-06", "dates as text, day first");

console.log(`${n - fails}/${n} passed`);
if (fails) { console.log("FAILED"); process.exit(1); } else console.log("all passed");
