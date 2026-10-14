/* Issues raised from the model checks (clash.js, headroom.js): their names
 * ("Clash issue 007"), what they say, and when they are due.
 *
 * Due: three working days after today - Monday to Friday, not the Hong
 * Kong general holidays (holidays.js; add next year's there when the
 * Government Gazette publishes them).
 */
import { HK } from "./holidays.js";

// the Hong Kong general holidays, with their names, are in holidays.js
export const HK_HOLIDAYS = new Set(Object.keys(HK));

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const isWorkingDay = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !HK_HOLIDAYS.has(ymd(d));

/* The date n working days after `from` (today), as YYYY-MM-DD. */
export function dueIn(n, from) {
  const d = from ? new Date(from) : new Date();
  d.setHours(12, 0, 0, 0);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d)) left--;
  }
  return ymd(d);
}

/* The next free number after "Clash issue" (or "Headroom issue") among the
   issues there are: 001, 002 ... */
export function nextNumber(items, prefix) {
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\d+)", "i");
  let max = 0;
  for (const it of items || []) {
    const t = it && !it.deleted && it.issue && it.issue.title;
    const m = t ? re.exec(t) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
export const numberText = (n) => String(n).padStart(3, "0");

/* One element, for a description line. */
export const elementLine = (e) => [e.model, e.cat, e.name, e.type && e.type !== e.name ? "(" + e.type + ")" : "", e.id ? "id " + e.id : ""]
  .filter(Boolean).join(" - ");
export const xyzText = (mm) => (mm && mm.length === 3 ? `X ${Math.round(mm[0])}, Y ${Math.round(mm[1])}, Z ${Math.round(mm[2])} mm (project)` : "");
