/* Public holidays: Hong Kong (general holidays, Government Gazette) and the
 * Philippines (regular holidays and special non-working days: Proclamation
 * No. 1006 for 2026, No. 1427 for 2027).
 *
 * The Calendar shows them (Holidays button); checkissue.js leaves the Hong
 * Kong ones out of issue due dates. A site admin adds next year's dates, and
 * the Philippine Eid'l Fitr / Eid'l Adha once they are proclaimed, on the
 * Calendar (Holidays > Edit the list): they are kept on the server and laid
 * over these (GET /api/holidays).
 */

export const HK = {
  "2026-01-01": "The first day of January",
  "2026-02-17": "Lunar New Year's Day",
  "2026-02-18": "The second day of Lunar New Year",
  "2026-02-19": "The third day of Lunar New Year",
  "2026-04-03": "Good Friday",
  "2026-04-04": "The day following Good Friday",
  "2026-04-06": "The day following Ching Ming Festival",
  "2026-04-07": "The day following Easter Monday",
  "2026-05-01": "Labour Day",
  "2026-05-25": "The day following the Birthday of the Buddha",
  "2026-06-19": "Tuen Ng Festival",
  "2026-07-01": "HKSAR Establishment Day",
  "2026-09-26": "The day following Chinese Mid-Autumn Festival",
  "2026-10-01": "National Day",
  "2026-10-19": "The day following Chung Yeung Festival",
  "2026-12-25": "Christmas Day",
  "2026-12-26": "The first weekday after Christmas Day",
  "2027-01-01": "The first day of January",
  "2027-02-06": "Lunar New Year's Day",
  "2027-02-08": "The third day of Lunar New Year",
  "2027-02-09": "The fourth day of Lunar New Year",
  "2027-03-26": "Good Friday",
  "2027-03-27": "The day following Good Friday",
  "2027-03-29": "Easter Monday",
  "2027-04-05": "Ching Ming Festival",
  "2027-05-01": "Labour Day",
  "2027-05-13": "The Birthday of the Buddha",
  "2027-06-09": "Tuen Ng Festival",
  "2027-07-01": "HKSAR Establishment Day",
  "2027-09-16": "The day following Chinese Mid-Autumn Festival",
  "2027-10-01": "National Day",
  "2027-10-08": "Chung Yeung Festival",
  "2027-12-25": "Christmas Day",
  "2027-12-27": "The first weekday after Christmas Day",
};

export const PH = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year (special)",
  "2026-04-02": "Maundy Thursday",
  "2026-04-03": "Good Friday",
  "2026-04-04": "Black Saturday (special)",
  "2026-04-09": "Araw ng Kagitingan",
  "2026-05-01": "Labor Day",
  "2026-06-12": "Independence Day",
  "2026-08-21": "Ninoy Aquino Day (special)",
  "2026-08-31": "National Heroes Day",
  "2026-11-01": "All Saints' Day (special)",
  "2026-11-02": "All Souls' Day (special)",
  "2026-11-30": "Bonifacio Day",
  "2026-12-08": "Feast of the Immaculate Conception (special)",
  "2026-12-24": "Christmas Eve (special)",
  "2026-12-25": "Christmas Day",
  "2026-12-30": "Rizal Day",
  "2026-12-31": "Last Day of the Year (special)",
  "2027-01-01": "New Year's Day",
  "2027-02-06": "Chinese New Year (special)",
  "2027-03-25": "Maundy Thursday",
  "2027-03-26": "Good Friday",
  "2027-03-27": "Black Saturday (special)",
  "2027-04-09": "Araw ng Kagitingan",
  "2027-05-01": "Labor Day",
  "2027-06-12": "Independence Day",
  "2027-08-21": "Ninoy Aquino Day (special)",
  "2027-08-30": "National Heroes Day",
  "2027-11-01": "All Saints' Day (special)",
  "2027-11-02": "All Souls' Day (special)",
  "2027-11-30": "Bonifacio Day",
  "2027-12-08": "Feast of the Immaculate Conception (special)",
  "2027-12-24": "Christmas Eve (special)",
  "2027-12-25": "Christmas Day",
  "2027-12-30": "Rizal Day",
  "2027-12-31": "Last Day of the Year (special)",
};

export const REGIONS = { hk: { name: "Hong Kong", short: "HK", list: HK }, ph: { name: "Philippines", short: "PH", list: PH } };

/* The built-in list with an admin's additions laid over (a name "-" takes a
   date away). */
export function merged(region, extra) {
  const out = Object.assign({}, REGIONS[region].list);
  for (const [d, n] of Object.entries((extra && extra[region]) || {})) {
    if (n === "-") delete out[d]; else out[d] = n;
  }
  return out;
}
