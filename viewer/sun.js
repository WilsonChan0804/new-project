/* The sun's place in the sky for a shadow study: NOAA's general solar position equations (about ±0.5° and a minute).
 * Hong Kong by default: 22.30°N 114.17°E, UTC+8.
 * position(month 1-12, day, hour (local, decimal)) -> {az (degrees from north, clockwise), alt (degrees above the horizon), dir [east, north, up]}
 */
const RAD = Math.PI / 180;
export const HK = { lat: 22.3, lon: 114.17, tz: 8 };
export const PRESETS = [["03-21", "21 Mar (equinox)"], ["06-21", "21 Jun (summer)"], ["09-23", "23 Sep (equinox)"], ["12-21", "21 Dec (winter)"]];

export function dayOfYear(month, day) { const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; return cum[Math.max(0, Math.min(11, month - 1))] + day; }

export function position(month, day, hour, at) {
  const P = Object.assign({}, HK, at || {}), n = dayOfYear(month, day);
  const g = (2 * Math.PI / 365) * (n - 1 + (hour - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eq + 4 * P.lon - 60 * P.tz, ha = (tst / 4 - 180) * RAD, lat = P.lat * RAD;
  const cz = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha), zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / RAD + 180;
  az = ((az % 360) + 360) % 360;
  const alt = 90 - zen / RAD, ca = Math.cos(alt * RAD);
  return { az, alt, dir: [Math.sin(az * RAD) * ca, Math.cos(az * RAD) * ca, Math.sin(alt * RAD)] };
}
/* sunrise .. sunset, as local hours (the sun's middle at the horizon), by stepping */
export function daylight(month, day, at) {
  let rise = null, set = null;
  for (let h = 4; h <= 21; h += 1 / 60) { const up = position(month, day, h, at).alt > -0.83; if (up && rise == null) rise = h; if (!up && rise != null && set == null) set = h; }
  return { rise, set };
}
export const hhmm = (h) => { const m = Math.round(h * 60); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
