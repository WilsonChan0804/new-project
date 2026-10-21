/* One way of writing dates on every page:
 *   day()      "7 Oct" this year, "7 Oct 2025" another year
 *   dayTime()  "7 Oct, 14:32"
 *   ago()      "just now", "5 min ago", "2 h ago", "yesterday", "3 d ago" (under a week), else day()
 *   overdueBy() "41 days overdue" / "due today" / "due in 3 days"
 * Anything a date can be given as: a Date, an ISO string, "YYYY-MM-DD",
 * or seconds / milliseconds since 1970. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") return new Date(v < 1e11 ? v * 1000 : v);
  const s = String(v);
  // a plain day is that day where you are, not midnight in London
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export function day(v, withYear) {
  const d = toDate(v);
  if (!d) return "";
  const y = d.getFullYear();
  return `${d.getDate()} ${MON[d.getMonth()]}` + (withYear || y !== new Date().getFullYear() ? ` ${y}` : "");
}

const hm = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

export function dayTime(v, withYear) {
  const d = toDate(v);
  return d ? day(d, withYear) + ", " + hm(d) : "";
}

export function time(v) {
  const d = toDate(v);
  return d ? hm(d) : "";
}

export function ago(v, now) {
  const d = toDate(v);
  if (!d) return "";
  const s = ((now || Date.now()) - d.getTime()) / 1000;
  if (s < 0) return day(d);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 2) return "yesterday";
  if (s < 86400 * 7) return Math.floor(s / 86400) + " d ago";
  return day(d);
}

const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/* Whole days from today to v: negative is past. */
export function daysFromToday(v) {
  const d = toDate(v);
  return d ? Math.round((startOf(d) - startOf(new Date())) / 86400000) : null;
}

export function overdueBy(v) {
  const n = daysFromToday(v);
  if (n == null) return "";
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "due today";
  return `due in ${n} day${n === 1 ? "" : "s"}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WDL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/* "Wed 21 Oct" (long: "Wednesday 21 Oct") */
export function wday(v, long, withYear) {
  const d = toDate(v);
  return d ? (long ? WDL : WD)[d.getDay()] + " " + day(d, withYear) : "";
}
