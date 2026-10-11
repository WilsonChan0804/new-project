/* Issues raised from the model checks (clash.js, headroom.js): their names
 * ("Clash issue 007"), what they say, and when they are due.
 *
 * Due: three working days after today - Monday to Friday, not the Hong
 * Kong general holidays below (from the Government Gazette; add next
 * year's when it is published).
 */

export const HK_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19", "2026-04-03", "2026-04-04", "2026-04-06", "2026-04-07",
  "2026-05-01", "2026-05-25", "2026-06-19", "2026-07-01", "2026-09-26", "2026-10-01", "2026-10-19", "2026-12-25", "2026-12-26",
  // 2027
  "2027-01-01", "2027-02-06", "2027-02-08", "2027-02-09", "2027-03-26", "2027-03-27", "2027-03-29", "2027-04-05",
  "2027-05-01", "2027-05-13", "2027-06-09", "2027-07-01", "2027-09-16", "2027-10-01", "2027-10-08", "2027-12-25", "2027-12-27",
]);

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
