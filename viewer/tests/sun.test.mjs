import * as SUN from "../sun.js";
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// solar noon in Hong Kong is about 12:20-12:30 local (114.17°E against the 120°E of UTC+8)
const noon = SUN.position(6, 21, 12 + 23 / 60);
ok(noon.alt > 88 && noon.alt < 90, `21 Jun, solar noon: altitude ${noon.alt.toFixed(2)}° (90 - |22.3 - 23.44|)`);
const w = SUN.position(12, 21, 9);
ok(w.az > 125 && w.az < 140 && w.alt > 15 && w.alt < 30, `21 Dec 09:00: azimuth ${w.az.toFixed(1)}° (south-east), altitude ${w.alt.toFixed(1)}°`);
const e = SUN.position(3, 21, 18.4);
ok(e.az > 260 && e.az < 280 && Math.abs(e.alt) < 3, `21 Mar about 18:25: setting due west (${e.az.toFixed(1)}°, ${e.alt.toFixed(1)}°)`);
const d = SUN.daylight(6, 21);
ok(d.rise > 5.5 && d.rise < 5.9 && d.set > 19 && d.set < 19.3, `21 Jun daylight ${SUN.hhmm(d.rise)} - ${SUN.hhmm(d.set)} (HKO: about 05:40 - 19:11)`);
const v = noon.dir;
ok(Math.abs(Math.hypot(...v) - 1) < 1e-9, "the direction is a unit vector");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
