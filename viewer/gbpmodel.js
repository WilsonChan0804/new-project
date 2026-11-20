/* The rooms and areas of the model, for the GBP workbook: what the publish
 * put on the plan sheets (manifest.json sheets[].areas - rooms on floor
 * plans, areas on area plans, each with every parameter Revit shows), each
 * once (by its Revit id), read through the workbook's parameter names.
 *
 * Only what is on a published plan sheet is here: a room or area on no
 * sheet is not published, and the page says so.
 */
import { num, yes } from "./gbpcore.js";

/* The parameter names the office's GBP setting uses (Revit GBP setting):
   renamed per project in the workbook's Mapping. */
export const MAP_DEFAULTS = {
  use: "Use Classification",
  ufa: "UFA Accountable",
  bynum: "Occupancy Factor by Number",
  exits: "Number of Exits Provided",
  doors_total: "Total Width Exit Doors Provided",
  door_each: "Min. Width of Each Exit Door Provided",
  routes_total: "Total Width Exit Routes Provided",
  route_each: "Min. Width of Each Exit Route Provided",
  type: "Area-Type",
  deduct: "Area Deduct",
};
export const MAP_LABELS = {
  use: "Room: Use Classification (Table B1 key)",
  ufa: "Room: counted in the UFA (Yes/No)",
  bynum: "Room: occupants by number",
  exits: "Room: number of exit doors provided",
  doors_total: "Room: total width of exit doors provided",
  door_each: "Room: least width of an exit door provided",
  routes_total: "Room: total width of exit routes provided",
  route_each: "Room: least width of an exit route provided",
  type: "Area: Area-Type (GFA-ND0, GFA-C2.3, SC-ND0, FC-0 ...)",
  deduct: "Area: deducted (Yes/No)",
};

export async function loadModel(pid, hdrs) {
  const res = await fetch(`/data/${encodeURIComponent(pid)}/manifest.json`, { headers: hdrs, cache: "no-store" });
  if (!res.ok) throw new Error("Could not read the project's sheets (HTTP " + res.status + ")");
  return collect(await res.json());
}

/* -> {rooms: [..], areas: [..], schemes: [..], sheets: n} - raw, with their params */
export function collect(man) {
  const seen = new Map();
  let sheets = 0;
  for (const sh of (man && man.sheets) || []) {
    if (!(sh.areas || []).length) continue;
    sheets++;
    for (const a of sh.areas) {
      const id = a.uid || (a.kind + ":" + a.id);
      if (seen.has(id)) { seen.get(id).sheets.push(sh.number); continue; }
      const p = {};
      for (const kv of a.params || []) if (Array.isArray(kv) && kv.length >= 2) p[String(kv[0]).toLowerCase()] = kv[1];
      seen.set(id, { uid: id, kind: a.kind || "area", number: a.number || "", name: a.name || "", level: a.level || "",
        scheme: a.scheme || "", area: Number(a.area_m2) || 0, params: p, sheets: [sh.number] });
    }
  }
  const all = [...seen.values()];
  return { rooms: all.filter((x) => x.kind === "room"), areas: all.filter((x) => x.kind !== "room"),
    schemes: [...new Set(all.filter((x) => x.kind !== "room").map((x) => x.scheme).filter(Boolean))], sheets };
}

const P = (x, name) => (name ? x.params[String(name).toLowerCase()] : undefined);

/* the model's rooms as workbook rows, through the mapping, with the
   person's changes on top (over[uid]) and their own rows (add) after */
export function roomRows(model, map, over, add, hide) {
  const m = Object.assign({}, MAP_DEFAULTS, map || {});
  const o = over || {}, gone = new Set(hide || []);
  const rows = (model ? model.rooms : []).filter((r) => !gone.has(r.uid)).map((r) => {
    const base = {
      uid: r.uid, from: "model", level: r.level, number: r.number, name: r.name, area: r.area,
      key: String(P(r, m.use) || "").trim(),
      ufa: P(r, m.ufa) == null ? true : yes(P(r, m.ufa)),
      by_number: num(P(r, m.bynum)),
      exits: num(P(r, m.exits)), doors_total: num(P(r, m.doors_total)), door_each: num(P(r, m.door_each)),
      routes_total: num(P(r, m.routes_total)), route_each: num(P(r, m.route_each)), widths: "",
    };
    return withOver(base, o[r.uid]);
  });
  for (const a of add || []) rows.push(Object.assign({ from: "added", ufa: true }, a, { uid: a.id }));
  return rows;
}

export function areaRows(model, map, over, add, hide) {
  const m = Object.assign({}, MAP_DEFAULTS, map || {});
  const o = over || {}, gone = new Set(hide || []);
  const rows = (model ? model.areas : []).filter((r) => !gone.has(r.uid)).map((r) => withOver({
    uid: r.uid, from: "model", level: r.level, number: r.number, name: r.name, area: r.area, scheme: r.scheme,
    type: String(P(r, m.type) || "").trim(), deduct: yes(P(r, m.deduct)),
  }, o[r.uid]));
  for (const a of add || []) rows.push(Object.assign({ from: "added" }, a, { uid: a.id }));
  return rows;
}

function withOver(base, ov) {
  if (!ov) return base;
  const out = Object.assign({}, base, { changed: Object.keys(ov) });
  for (const [k, v] of Object.entries(ov)) out[k] = v;
  return out;
}

/* "900, 1050 x2" -> [900, 1050, 1050] */
export function widthsOf(text) {
  const out = [];
  for (const part of String(text || "").split(/[,;/]+/)) {
    const m = /(\d+(?:\.\d+)?)\s*(?:[x×*]\s*(\d+))?/.exec(part.trim());
    if (!m) continue;
    for (let i = 0; i < Math.min(50, Number(m[2] || 1)); i++) out.push(Number(m[1]));
  }
  return out;
}
