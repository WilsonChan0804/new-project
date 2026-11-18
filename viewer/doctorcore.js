/* Model Doctor's checks, on the models loaded on the 3D page - plain numbers,
 * no page and no three.js, so the same code runs in doctor-worker.js and in
 * a test (tests/doctorcore.test.mjs).
 *
 * The same checks as the Revit tool (LWK Model Doctor, lib/modeldoctor): the
 * same ids, problem names and settings, so a finding means the same thing
 * on both sides and "Not an error" said here holds there too. What Revit
 * reads off the API (location lines, sketches) is read here off what is
 * drawn: each element's box and triangles. The exporter adds the few facts
 * the triangles cannot give (fast3d.py doctor_facts: wall width, phase,
 * design option, pinned, in a group).
 *
 * An element: { k, model, host, cat, type, name, level, uid, box, tris, dr }
 *   box   [minX, minY, minZ, maxX, maxY, maxZ], world metres, Y up
 *   tris  Float32Array, 9 numbers a triangle (world metres), or null
 *   dr    { w, ph: [made, demolished], opt: [option, set], pin, grp } or null
 * Plan is X and Z; Y is up.
 *
 * A finding: { check, problem, severity (3 critical, 2 warning, 1 info),
 *   els: [k ...], primary: k, value_mm, text, scoreless, fix }
 */
import { pairs, judge } from "./clashcore.js";

export const SEV = { CRITICAL: 3, WARNING: 2, INFO: 1 };
export const SEV_NAME = { 3: "Critical", 2: "Warning", 1: "Info" };

const PHASE = { same_phase_only: ["Only compare elements in overlapping phases", true, ""],
  same_option_only: ["Only compare elements that can coexist in design options", true, ""] };

/* The checks, as in the Revit tool. options: key -> [label, default, unit].
   fix: what Model Doctor in Revit does when it is asked to fix one
   ("Fix in Revit"); null where Revit cannot fix it either. */
export const CHECKS = [
  { id: "duplicates", title: "Duplicate / coincident elements", group: "Hygiene",
    description: "Elements stacked on top of each other with the same category, type, size and position (OVERKILL in AutoCAD).",
    fix: "Delete duplicates (keep lowest ID)",
    options: { tolerance_mm: ["Position tolerance", 1.0, "mm"], skip_grouped: ["Ignore elements inside groups", true, ""],
      skip_pinned: ["Ignore pinned elements", true, ""], ...PHASE } },
  { id: "wall_overlaps", title: "Walls overlapping each other", group: "Walls",
    description: "Walls running into or along each other: collinear and parallel overlaps, an end running into another wall, a wall inside another.",
    fix: "Trim the shorter wall to the face",
    options: { min_volume_m3: ["Ignore overlaps smaller than", 0.0005, "m3"], skip_crossing: ["Ignore full crossings (both walls run through)", true, ""], ...PHASE } },
  { id: "wall_gaps", title: "Walls that nearly touch", group: "Walls",
    description: "Wall ends stopping a hair short of another wall: end-to-end, corner and T-junction gaps, and parallel slivers.",
    fix: "Extend the wall to the other wall",
    options: { tolerance_mm: ["Maximum gap to report", 10.0, "mm"], min_gap_mm: ["Ignore gaps smaller than", 0.05, "mm"],
      report_parallel: ["Report parallel slivers", true, ""], ...PHASE } },
  { id: "wall_column_gaps", title: "Walls that nearly touch a column", group: "Columns",
    description: "Wall ends stopping just short of a column.",
    fix: "Extend the wall onto the column face",
    options: { tolerance_mm: ["Maximum gap to report", 10.0, "mm"], min_gap_mm: ["Ignore gaps smaller than", 0.05, "mm"], ...PHASE } },
  { id: "column_clashes", title: "Columns overlapping walls or each other", group: "Columns",
    description: "Walls running into columns, and columns overlapping columns.",
    fix: "Trim the wall back to the column face",
    options: { min_volume_m3: ["Ignore overlaps smaller than", 0.0005, "m3"], check_wall_column: ["Check walls against columns", true, ""],
      check_column_column: ["Check columns against each other", true, ""], ...PHASE } },
  { id: "link_clashes", title: "Host elements clashing with a link", group: "Links",
    description: "The main model's walls, columns, beams, floors and equipment in the same space as another model loaded here (a link or a consultant's model).",
    fix: null,
    options: { min_volume_m3: ["Ignore overlaps smaller than", 0.001, "m3"], link_name_filter: ["Only these models (comma separated, blank = all)", "", "text"] } },
  { id: "link_gaps", title: "Host walls that nearly touch a link", group: "Links",
    description: "Main-model wall ends stopping just short of a wall, column or beam in another model.",
    fix: "Extend the host wall onto the linked face",
    options: { tolerance_mm: ["Maximum gap to report", 10.0, "mm"], min_gap_mm: ["Ignore gaps smaller than", 0.05, "mm"],
      link_name_filter: ["Only these models (comma separated, blank = all)", "", "text"] } },
  { id: "link_duplicates", title: "Host elements duplicating a link", group: "Links",
    description: "Main-model elements in exactly the same place as an element of another model - typically an architectural wall modelled again over the structural one.",
    fix: "Delete the host copy",
    options: { tolerance_mm: ["Position tolerance", 5.0, "mm"], match_type_name: ["Only when the type names match too", false, ""],
      link_name_filter: ["Only these models (comma separated, blank = all)", "", "text"] } },
  { id: "door_floor", title: "Doors not sitting on the floor", group: "Openings",
    description: "Door sill compared with the floor directly under it: the \"level offset changed, door left behind\" case.",
    fix: "Reset sill to floor level",
    options: { allowance_mm: ["Allowed sill height above floor (e.g. plant room upstand)", 25.0, "mm"],
      below_tol_mm: ["Ignore drops smaller than", 1.0, "mm"], search_mm: ["Search distance for a floor below", 4000.0, "mm"],
      include_windows: ["Also check windows", false, ""] } },
  { id: "wall_base_floor", title: "Wall base not level with its slab", group: "Walls",
    description: "Wall bases sitting above, or buried in, the slab under them.",
    fix: null,
    options: { tolerance_mm: ["Ignore differences smaller than", 2.0, "mm"], search_mm: ["Search distance for a slab below", 2000.0, "mm"],
      samples: ["Sample points along each wall", 5, ""] } },
  { id: "wall_top_soffit", title: "Wall top not meeting the soffit above", group: "Walls",
    description: "Wall tops stopping short of, or running past, the underside of the slab above.",
    fix: null,
    options: { tolerance_mm: ["Ignore differences smaller than", 2.0, "mm"], search_mm: ["Search distance for a soffit above", 6000.0, "mm"],
      include_ceilings: ["Include ceilings as well as slabs", true, ""], overshoot_mm: ["How far a wall may already poke through", 1000.0, "mm"],
      samples: ["Sample points along each wall", 5, ""] } },
  { id: "element_floor", title: "Components sunk into the floor", group: "Components",
    description: "Fixtures, furniture, equipment and generic models whose base is below the top of the floor under them.",
    fix: "Raise to floor level",
    options: { tolerance_mm: ["Ignore drops smaller than", 2.0, "mm"], search_mm: ["Search distance for a floor below", 4000.0, "mm"],
      skip_recessed: ["Ignore components deeper than", 300.0, "mm"] } },
];
export const checkById = (id) => CHECKS.find((c) => c.id === id) || null;
/* Revit-only: 2D lines are not in the 3D export */
export const REVIT_ONLY = [{ id: "curve_overlaps", title: "Overlapping lines and boundaries",
  why: "2D lines, room separation and sketch lines are not in the 3D model - run this one in Revit." }];

export function defaults() {
  const out = {};
  for (const c of CHECKS) out[c.id] = Object.fromEntries(Object.entries(c.options).map(([k, v]) => [k, v[1]]));
  return out;
}
const optOf = (opts, id) => Object.assign({}, defaults()[id], (opts && opts[id]) || {});

/* --------------------------------------------------------------- kinds */

const RX = {
  wall: /^(Walls|IFCWALL|IFCWALLSTANDARDCASE|IFCWALLELEMENTEDCASE)$/,
  floor: /^(Floors|IFCSLAB)$/,
  roof: /^(Roofs|IFCROOF)$/,
  ceiling: /^(Ceilings|IFCCOVERING)$/,
  column: /^(Columns|Structural Columns|IFCCOLUMN)$/,
  beam: /^(Structural Framing|IFCBEAM)$/,
  door: /^(Doors|IFCDOOR)$/,
  window: /^(Windows|IFCWINDOW)$/,
  component: /^(Furniture|Furniture Systems|Casework|Generic Models|Specialty Equipment|Plumbing Fixtures|Mechanical Equipment|Electrical Equipment|IFCFURNITURE|IFCFURNISHINGELEMENT|IFCBUILDINGELEMENTPROXY|IFCSANITARYTERMINAL|IFCFLOWTERMINAL|IFCUNITARYEQUIPMENT|IFCENERGYCONVERSIONDEVICE|IFCELECTRICAPPLIANCE)$/,
  equip: /^(Generic Models|Mechanical Equipment|Plumbing Fixtures|IFCBUILDINGELEMENTPROXY|IFCFLOWTERMINAL|IFCSANITARYTERMINAL|IFCUNITARYEQUIPMENT|IFCENERGYCONVERSIONDEVICE)$/,
};
export function kindOf(cat) {
  for (const k of ["wall", "floor", "roof", "ceiling", "column", "beam", "door", "window"]) if (RX[k].test(cat || "")) return k;
  if (RX.component.test(cat || "")) return "component";
  return "other";
}
/* which elements each check reads (the page loads their triangles) */
export function needs(id, opt) {
  const o = Object.assign({}, defaults()[id] || {}, opt || {});
  switch (id) {
    case "duplicates": return { all: true, tris: false };
    case "wall_overlaps": case "wall_gaps": return { kinds: ["wall"], tris: true };
    case "wall_column_gaps": case "column_clashes": return { kinds: ["wall", "column"], tris: true };
    case "link_clashes": case "link_gaps": case "link_duplicates":
      return { kinds: ["wall", "column", "beam", "floor", "component"], tris: id !== "link_duplicates", links: true };
    case "door_floor": return { kinds: o.include_windows ? ["door", "window", "floor"] : ["door", "floor"], tris: true };
    case "wall_base_floor": return { kinds: ["wall", "floor"], tris: true };
    case "wall_top_soffit": return { kinds: o.include_ceilings ? ["wall", "floor", "roof", "ceiling"] : ["wall", "floor", "roof"], tris: true };
    case "element_floor": return { kinds: ["component", "floor"], tris: true };
    default: return { kinds: [], tris: false };
  }
}

/* ------------------------------------------------------- may they meet */

/* Two elements in different options of the same option set never stand
   together; phases that never overlap neither (context.py coexist). */
export function coexist(a, b, o) {
  const da = a.dr || {}, db = b.dr || {};
  if ((!o || o.same_option_only !== false) && da.opt && db.opt && da.opt[0] !== db.opt[0] && da.opt[1] === db.opt[1] && da.opt[1] !== -1) return false;
  if (!o || o.same_phase_only !== false) {
    const span = (d) => [d.ph ? d.ph[0] : -1, d.ph && d.ph[1] >= 0 ? d.ph[1] : Infinity];
    const [ca, xa] = span(da), [cb, xb] = span(db);
    if (!(ca <= xb && cb <= xa)) return false;
  }
  return true;
}

/* ------------------------------------------------------------- in plan */

/* the convex hull of plan points (x, z pairs, flat), as [[x, z] ...] */
function hullOf(flatPts) {
  const seen = new Set(), P = [];
  for (let i = 0; i < flatPts.length; i += 2) {
    const x = Math.round(flatPts[i] * 1e5) / 1e5, z = Math.round(flatPts[i + 1] * 1e5) / 1e5;
    const k = x + "," + z;
    if (!seen.has(k)) { seen.add(k); P.push([x, z]); }
  }
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

/* An element's footprint as a rectangle along its own length: from the
   triangles' corners (their main direction), or the box when there are none.
   { o: [x, z] origin, u: along, v: across, s0, s1, t0, t1, len, thk, y0, y1 } */
export function rectOf(el) {
  if (el._rect !== undefined) return el._rect;
  const b = el.box;
  let pts = null;
  if (el.tris && el.tris.length >= 9) {
    pts = [];
    const T = el.tris;
    for (let i = 0; i < T.length; i += 3) pts.push(T[i], T[i + 2]);
  }
  let u = [1, 0];
  let o = [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2];
  if (pts) {
    // the smallest rectangle round the footprint: one of its sides lies
    // along an edge of the convex hull (rotating calipers)
    const hull = hullOf(pts);
    let best = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 1e-9) continue;
      const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, z] of hull) {
        const s = x * ux + z * uz, t = -x * uz + z * ux;
        if (s < a0) a0 = s; if (s > a1) a1 = s; if (t < b0) b0 = t; if (t > b1) b1 = t;
      }
      const area = (a1 - a0) * (b1 - b0);
      if (area < best - 1e-12) { best = area; u = [ux, uz]; }
    }
    if (Math.abs(u[1]) < 1e-6) u = [1, 0];
    else if (Math.abs(u[0]) < 1e-6) u = [0, 1];
    else if (u[0] < 0) u = [-u[0], -u[1]];
    let mx = 0, mz = 0;
    for (const [x, z] of hull) { mx += x; mz += z; }
    o = [mx / hull.length, mz / hull.length];
  } else if (b[5] - b[2] > b[3] - b[0]) u = [0, 1];
  const v = [-u[1], u[0]];
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  const take = (x, z) => {
    const dx = x - o[0], dz = z - o[1];
    const s = dx * u[0] + dz * u[1], t = dx * v[0] + dz * v[1];
    if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
  };
  if (pts) for (let i = 0; i < pts.length; i += 2) take(pts[i], pts[i + 1]);
  else { take(b[0], b[2]); take(b[3], b[5]); take(b[0], b[5]); take(b[3], b[2]); }
  // the length along the longer side
  let r = { o, u, v, s0, s1, t0, t1, y0: b[1], y1: b[4] };
  if (t1 - t0 > s1 - s0) r = { o, u: v, v: [-v[1], v[0]], s0: -t1, s1: -t0, t0: s0, t1: s1, y0: b[1], y1: b[4] };
  r.len = r.s1 - r.s0;
  r.thk = r.t1 - r.t0;
  el._rect = r;
  return r;
}
const local = (r, x, z) => { const dx = x - r.o[0], dz = z - r.o[1]; return [dx * r.u[0] + dz * r.u[1], dx * r.v[0] + dz * r.v[1]]; };
const world = (r, s, t) => [r.o[0] + r.u[0] * s + r.v[0] * t, r.o[1] + r.u[1] * s + r.v[1] * t];
/* the point of a rectangle nearest to x, z (plan) */
function closestOnRect(r, x, z) {
  const [s, t] = local(r, x, z);
  return world(r, Math.min(r.s1, Math.max(r.s0, s)), Math.min(r.t1, Math.max(r.t0, t)));
}
/* distance (plan) from a point to a rectangle; 0 inside */
export function distToRect(r, x, z) {
  const [s, t] = local(r, x, z);
  const ds = Math.max(r.s0 - s, 0, s - r.s1), dt = Math.max(r.t0 - t, 0, t - r.t1);
  return Math.hypot(ds, dt);
}
const sinBetween = (a, b) => Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0]);
const yOverlap = (a, b, tol = 0) => Math.min(a.box[4], b.box[4]) - Math.max(a.box[1], b.box[1]) > tol;
/* a wall's two end caps: [centre, corner, corner] in plan, end 0 at s0 */
function caps(r) {
  const tm = (r.t0 + r.t1) / 2;
  return [0, 1].map((e) => {
    const s = e ? r.s1 : r.s0;
    return [world(r, s, tm), world(r, s, r.t0 + 1e-4), world(r, s, r.t1 - 1e-4)];
  });
}
/* a simple grid over plan boxes, for near neighbours */
function grid(els, cell = 4) {
  const g = new Map();
  const key = (i, j) => i + "," + j;
  for (const e of els) {
    const b = e.box;
    for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[3] / cell); i++)
      for (let j = Math.floor(b[2] / cell); j <= Math.floor(b[5] / cell); j++) {
        const k = key(i, j);
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(e);
      }
  }
  return (b, pad) => {
    const out = new Set();
    for (let i = Math.floor((b[0] - pad) / cell); i <= Math.floor((b[3] + pad) / cell); i++)
      for (let j = Math.floor((b[2] - pad) / cell); j <= Math.floor((b[5] + pad) / cell); j++)
        for (const e of g.get(key(i, j)) || []) out.add(e);
    return out;
  };
}
const mm = (m) => Math.round(m * 10000) / 10;            // metres -> mm, 0.1
const fmt = (m) => (Math.round(m * 10000) / 10).toFixed(1) + " mm";

/* ----------------------------------------------------------- floors */

/* The flat-ish triangles of the floors (slabs, roofs, ceilings) in a plan
   grid: the top of the floor under a point, and the underside of what is
   over it. Which way a triangle faces is not read from its winding (an IFC
   may wind either way): at a point, an element's highest surface is its top
   and its lowest its underside. An element without triangles answers with
   its box. */
export function floorProbe(floors, cell = 2) {
  const flat = new Map();
  const key = (i, j) => i + "," + j;
  const add = (M, i, j, rec) => { const k = key(i, j); if (!M.has(k)) M.set(k, []); M.get(k).push(rec); };
  const boxes = [];
  for (const f of floors) {
    const T = f.tris;
    if (!T || T.length < 9) { boxes.push(f); continue; }
    for (let q = 0; q < T.length; q += 9) {
      const ax = T[q], ay = T[q + 1], az = T[q + 2], bx = T[q + 3], by = T[q + 4], bz = T[q + 5], cx = T[q + 6], cy = T[q + 7], cz = T[q + 8];
      // the normal's Y (up) part, from the plan winding
      const ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const area = Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay), ny, (bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      if (area < 1e-12 || Math.abs(ny) / area < 0.5) continue;      // steeper than 60 degrees: a side
      const rec = [ax, ay, az, bx, by, bz, cx, cy, cz, f];
      for (let i = Math.floor(Math.min(ax, bx, cx) / cell); i <= Math.floor(Math.max(ax, bx, cx) / cell); i++)
        for (let j = Math.floor(Math.min(az, bz, cz) / cell); j <= Math.floor(Math.max(az, bz, cz) / cell); j++) add(flat, i, j, rec);
    }
  }
  const yAt = (t, x, z) => {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-14) return null;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    const e = -1e-7;
    if (l1 < e || l2 < e || l3 < e) return null;
    return l1 * ay + l2 * by + l3 * cy;
  };
  // each element's [lowest, highest] surface at x, z
  const spans = (x, z) => {
    const by = new Map();
    for (const t of flat.get(key(Math.floor(x / cell), Math.floor(z / cell))) || []) {
      const y = yAt(t, x, z);
      if (y === null) continue;
      const f = t[9], s = by.get(f);
      if (!s) by.set(f, [y, y]); else { if (y < s[0]) s[0] = y; if (y > s[1]) s[1] = y; }
    }
    for (const f of boxes) {
      const b = f.box;
      if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) by.set(f, [b[1], b[4]]);
    }
    return by;
  };
  const pick = (x, z, lo, hi, which) => {
    const out = [];
    for (const [el, s] of spans(x, z)) { const y = s[which]; if (y >= lo && y <= hi) out.push({ y, el }); }
    return out;
  };
  return {
    count: floors.length,
    /* the tops of the floors at x, z between lo and hi */
    tops: (x, z, lo, hi) => pick(x, z, lo, hi, 1),
    /* the undersides at x, z between lo and hi */
    bottoms: (x, z, lo, hi) => pick(x, z, lo, hi, 0),
  };
}

/* --------------------------------------------------------------- run */

const notice = (check, what) => ({ check, problem: "No reference geometry", severity: SEV.INFO, els: [], primary: null, value_mm: null,
  text: `No ${what} in the models loaded here, so nothing could be measured. Load the model that has them (Models), then run again.`,
  scoreless: true });
const filterModels = (others, text) => {
  const want = String(text || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return want.length ? others.filter((e) => want.some((w) => String(e.modelLabel || e.model || "").toUpperCase().includes(w))) : others;
};
const label = (e) => (e.type || e.name || e.cat || "Element") + (e.rid ? " [" + e.rid + "]" : "");
const solid = (e) => ({ tris: e.tris, box: e.box });

/* Run one check over the elements. Returns { issues, population }. */
export function runCheck(id, els, opts) {
  const o = optOf(opts, id);
  const c = checkById(id);
  const out = { issues: [], population: 0 };
  const push = (f) => out.issues.push(Object.assign({ check: id, fix: c && c.fix }, f));
  const host = els.filter((e) => e.host);
  const ofKind = (list, ...ks) => list.filter((e) => ks.includes(kindOf(e.cat)));

  if (id === "duplicates") {
    const tol = o.tolerance_mm / 1000;
    const pool = els.filter((e) => !(o.skip_grouped && e.dr && e.dr.grp) && !(o.skip_pinned && e.dr && e.dr.pin)
      && !/^(Rooms|Areas|Levels|Grids|Lines|IFCSPACE)$/.test(e.cat || ""));
    out.population = pool.length;
    const by = new Map();
    for (const e of pool) {
      // a design option's copy is compared only within its own option
      const k = e.model + "|" + e.cat + "|" + (e.type || e.name || "") + "|" + (e.dr && e.dr.opt ? e.dr.opt[0] : "main");
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(e);
    }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const boxes = list.map((e) => e.box);
      const parent = list.map((_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (const [i, j] of pairs(boxes, boxes, -tol, true)) {
        const a = list[i], b = list[j];
        let same = true;
        for (let d = 0; d < 6; d++) if (Math.abs(a.box[d] - b.box[d]) > tol) { same = false; break; }
        if (!same || !coexist(a, b, o)) continue;
        if (a.tris && b.tris && a.tris.length !== b.tris.length) continue;
        parent[find(i)] = find(j);
      }
      const groups = new Map();
      list.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); });
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        g.sort((a, b) => (a.rid || 0) - (b.rid || 0));
        push({ problem: g.length > 2 ? "Stacked triplicate+" : "Stacked duplicate", severity: g.length > 2 ? SEV.CRITICAL : SEV.WARNING,
          els: g.map((e) => e.k), primary: g[g.length - 1].k, value_mm: null,
          text: `${g.length} ${label(g[0])} in the same place${g[0].level ? " on " + g[0].level : ""} - keep one, delete the others.` });
      }
    }
    return out;
  }

  if (id === "wall_overlaps") {
    const walls = ofKind(host, "wall");
    out.population = walls.length;
    const minV = o.min_volume_m3;
    for (const [i, j] of pairs(walls.map((e) => e.box), null, 0.0005, true)) {
      const a = walls[i], b = walls[j];
      if (!coexist(a, b, o) || !yOverlap(a, b, 0.001)) continue;
      const ra = rectOf(a), rb = rectOf(b);
      const dy = Math.min(a.box[4], b.box[4]) - Math.max(a.box[1], b.box[1]);
      if (sinBetween(ra, rb) < 0.02) {
        // along each other: how far along, and how much across
        const ps = [world(rb, rb.s0, 0), world(rb, rb.s1, 0)].map(([x, z]) => local(ra, x, z)[0]);
        const lo = Math.max(ra.s0, Math.min(...ps)), hi = Math.min(ra.s1, Math.max(...ps));
        const [, tb] = local(ra, rb.o[0], rb.o[1]);
        const tbs = [tb + rb.t0, tb + rb.t1];
        const wlo = Math.max(ra.t0, Math.min(...tbs)), whi = Math.min(ra.t1, Math.max(...tbs));
        const along = hi - lo, across = whi - wlo;
        if (along <= 0.001 || across <= 0.001) continue;
        const vol = along * across * dy;
        if (vol < minV) continue;
        const inA = along >= rb.len - 0.002 && across >= rb.thk - 0.002, inB = along >= ra.len - 0.002 && across >= ra.thk - 0.002;
        const [small, big] = inA ? [b, a] : inB ? [a, b] : (ra.len < rb.len ? [a, b] : [b, a]);
        const centred = Math.abs((wlo + whi) / 2 - (ra.t0 + ra.t1) / 2) < 0.002;
        const problem = inA || inB ? "Wall inside another wall" : centred ? "Collinear overlap" : "Parallel overlap";
        push({ problem, severity: SEV.CRITICAL, els: [small.k, big.k], primary: small.k, value_mm: mm(along),
          text: `${label(small)} ${problem === "Wall inside another wall" ? "lies inside" : "runs " + fmt(along) + " along"} ${label(big)}${a.level ? " (" + a.level + ")" : ""}.` });
        continue;
      }
      // across each other: an end running in, or a full crossing
      const endIn = (r, q) => {
        // how far each end of r runs into q (along r), 0 when it does not
        const res = [];
        for (const [e, s] of [[0, r.s0], [1, r.s1]]) {
          const tm = (r.t0 + r.t1) / 2;
          const p = world(r, s, tm);
          const [qs, qt] = local(q, p[0], p[1]);
          if (qs < q.s0 - 1e-4 || qs > q.s1 + 1e-4) { res.push(0); continue; }
          if (qt <= q.t0 || qt >= q.t1) { res.push(0); continue; }
          // the face of q this wall comes in through (along r's own axis)
          const dir = e ? 1 : -1;
          const k = Math.abs(r.u[0] * q.v[0] + r.u[1] * q.v[1]) || 1;
          const face = dir * (r.u[0] * q.v[0] + r.u[1] * q.v[1]) > 0 ? q.t0 : q.t1;
          res.push(Math.abs(qt - face) / k);
        }
        return res;
      };
      const ea = endIn(ra, rb), eb = endIn(rb, ra);
      const through = (r, q) => {
        // does r run right across q (both its faces)?
        const p0 = world(r, r.s0, (r.t0 + r.t1) / 2), p1 = world(r, r.s1, (r.t0 + r.t1) / 2);
        const t0 = local(q, p0[0], p0[1])[1], t1 = local(q, p1[0], p1[1])[1];
        return (t0 < q.t0 && t1 > q.t1) || (t1 < q.t0 && t0 > q.t1);
      };
      const ta = through(ra, rb), tb2 = through(rb, ra);
      if (ta && tb2) {
        if (o.skip_crossing) continue;
        push({ problem: "Crossing over-run", severity: SEV.CRITICAL, els: [a.k, b.k], primary: a.k, value_mm: null,
          text: `${label(a)} and ${label(b)} run right through each other.` });
        continue;
      }
      const best = Math.max(...ea, ...eb);
      if (best <= 0.001) continue;
      const [vic, kee, run] = Math.max(...ea) >= Math.max(...eb) ? [a, b, Math.max(...ea)] : [b, a, Math.max(...eb)];
      const vol = run * Math.min(rectOf(vic).thk, rectOf(kee).thk) * dy;
      if (vol < minV) continue;
      push({ problem: "End over-run into wall", severity: SEV.CRITICAL, els: [vic.k, kee.k], primary: vic.k, value_mm: mm(run),
        text: `${label(vic)} runs ${fmt(run)} into ${label(kee)}.` });
    }
    return out;
  }

  // wall ends near other things (walls, columns, a link's elements)
  const endGaps = (walls, targets, problemOf, sev = SEV.WARNING) => {
    const tol = o.tolerance_mm / 1000, minG = o.min_gap_mm / 1000;
    const near = grid(targets);
    for (const w of walls) {
      const rw = rectOf(w);
      // not what lies along the wall itself (a copy of it, an overlap: other checks)
      const along = (t) => {
        const rt = rectOf(t);
        if (sinBetween(rw, rt) > 0.02) return false;
        const ps = [world(rt, rt.s0, 0), world(rt, rt.s1, 0)].map(([x, z]) => local(rw, x, z)[0]);
        const ov = Math.min(rw.s1, Math.max(...ps)) - Math.max(rw.s0, Math.min(...ps));
        const tt = local(rw, rt.o[0], rt.o[1])[1];
        return ov > 0.5 * rw.len && Math.abs(tt) < (rw.thk + rt.thk) / 2;
      };
      const cand = [...near(w.box, tol + 0.01)].filter((t) => t !== w && yOverlap(w, t, 0.001) && coexist(w, t, o) && !along(t));
      caps(rw).forEach((cap, end) => {
        let touching = false, best = null;
        for (const t of cand) {
          const rt = rectOf(t);
          const d = Math.min(...cap.map(([x, z]) => distToRect(rt, x, z)));
          if (d <= minG) { touching = true; break; }
          // only what the end points at: the target's nearest point lies
          // ahead of the end (or level with it), not alongside the wall
          const near = cap.reduce((m, [x, z]) => { const q = closestOnRect(rt, x, z); const dd = Math.hypot(q[0] - x, q[1] - z); return dd < m.d ? { d: dd, q } : m; }, { d: Infinity, q: null });
          const sq = local(rw, near.q[0], near.q[1])[0];
          if (end ? sq < rw.s1 - 0.001 : sq > rw.s0 + 0.001) continue;
          if (d <= tol && (!best || d < best.d)) best = { d, t };
        }
        if (touching || !best) return;
        const p = problemOf(w, best.t, end);
        if (p) push({ problem: p, severity: sev, els: [w.k, best.t.k], primary: w.k, value_mm: mm(best.d),
          text: `${label(w)} stops ${fmt(best.d)} short of ${label(best.t)}${w.level ? " (" + w.level + ")" : ""}.`, end });
      });
    }
  };

  if (id === "wall_gaps") {
    const walls = ofKind(host, "wall");
    out.population = walls.length;
    endGaps(walls, walls, (w, t, end) => {
      const rw = rectOf(w), rt = rectOf(t);
      if (sinBetween(rw, rt) < 0.05) return "End-to-end gap";
      const p = world(rw, end ? rw.s1 : rw.s0, (rw.t0 + rw.t1) / 2);
      const s = local(rt, p[0], p[1])[0];
      return s < rt.s0 + rt.thk + 0.001 || s > rt.s1 - rt.thk - 0.001 ? "Corner gap" : "T-junction gap";
    });
    if (o.report_parallel) {
      const tol = o.tolerance_mm / 1000, minG = o.min_gap_mm / 1000;
      for (const [i, j] of pairs(walls.map((e) => e.box), null, -tol, true)) {
        const a = walls[i], b = walls[j];
        const ra = rectOf(a), rb = rectOf(b);
        if (sinBetween(ra, rb) > 0.02 || !yOverlap(a, b, 0.001) || !coexist(a, b, o)) continue;
        const tb = local(ra, rb.o[0], rb.o[1])[1];
        const lo = Math.min(tb + rb.t0, tb + rb.t1), hi = Math.max(tb + rb.t0, tb + rb.t1);
        const gap = lo > ra.t1 ? lo - ra.t1 : ra.t0 > hi ? ra.t0 - hi : -1;
        if (gap <= minG || gap > tol) continue;
        const ps = [world(rb, rb.s0, 0), world(rb, rb.s1, 0)].map(([x, z]) => local(ra, x, z)[0]);
        if (Math.min(ra.s1, Math.max(...ps)) - Math.max(ra.s0, Math.min(...ps)) < 0.05) continue;
        push({ problem: "Parallel sliver", severity: SEV.INFO, els: [a.k, b.k], primary: a.k, value_mm: mm(gap),
          text: `${label(a)} and ${label(b)} run side by side ${fmt(gap)} apart.`, fix: null });
      }
    }
    return out;
  }

  if (id === "wall_column_gaps") {
    const walls = ofKind(host, "wall"), cols = ofKind(host, "column");
    if (!cols.length) { out.issues.push(notice(id, "columns")); return out; }
    out.population = walls.length;
    endGaps(walls, cols, () => "Wall short of column");
    return out;
  }

  if (id === "column_clashes") {
    const walls = ofKind(host, "wall"), cols = ofKind(host, "column");
    if (!cols.length) { out.issues.push(notice(id, "columns")); return out; }
    out.population = cols.length + walls.length;
    const judgeVol = (a, b) => {
      const ib = [Math.max(a.box[0], b.box[0]), Math.max(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]),
        Math.min(a.box[3], b.box[3]), Math.min(a.box[4], b.box[4]), Math.min(a.box[5], b.box[5])];
      const vol = Math.max(0, ib[3] - ib[0]) * Math.max(0, ib[4] - ib[1]) * Math.max(0, ib[5] - ib[2]);
      if (vol < o.min_volume_m3) return null;
      if (a.tris && b.tris) {
        const r = judge(solid(a), solid(b), { tol: 0.001 });
        if (!r) return null;
        return { depth: r.depth, vol };
      }
      return { depth: Math.min(ib[3] - ib[0], ib[5] - ib[2]), vol };
    };
    if (o.check_wall_column) for (const [i, j] of pairs(walls.map((e) => e.box), cols.map((e) => e.box), 0.001, false)) {
      const w = walls[i], c = cols[j];
      if (!coexist(w, c, o)) continue;
      const r = judgeVol(w, c);
      if (!r) continue;
      push({ problem: "Wall over-run into column", severity: SEV.CRITICAL, els: [w.k, c.k], primary: w.k, value_mm: r.depth != null ? mm(r.depth) : null,
        text: `${label(w)} runs ${r.depth != null ? fmt(r.depth) + " " : ""}into ${label(c)}.` });
    }
    if (o.check_column_column) for (const [i, j] of pairs(cols.map((e) => e.box), null, 0.001, true)) {
      const a = cols[i], b = cols[j];
      if (!coexist(a, b, o)) continue;
      const r = judgeVol(a, b);
      if (!r) continue;
      push({ problem: "Column clashing with column", severity: SEV.CRITICAL, els: [a.k, b.k], primary: a.k, value_mm: r.depth != null ? mm(r.depth) : null,
        text: `${label(a)} and ${label(b)} overlap.`, fix: null });
    }
    return out;
  }

  if (id === "link_clashes" || id === "link_gaps" || id === "link_duplicates") {
    const others = filterModels(els.filter((e) => !e.host), o.link_name_filter);
    if (!others.length) { out.issues.push(notice(id, "other models (links or consultants' models)")); return out; }
    if (id === "link_gaps") {
      const walls = ofKind(host, "wall");
      out.population = walls.length;
      endGaps(walls, ofKind(others, "wall", "column", "beam"), () => "Host wall short of link");
      return out;
    }
    const mine = ofKind(host, "wall", "column", "beam", "floor", "component");
    const theirs = ofKind(others, "wall", "column", "beam", "floor", "component");
    out.population = mine.length;
    if (id === "link_duplicates") {
      const tol = o.tolerance_mm / 1000;
      const seen = new Set();
      for (const [i, j] of pairs(mine.map((e) => e.box), theirs.map((e) => e.box), -tol, false)) {
        const a = mine[i], b = theirs[j];
        if (seen.has(a.k) || kindOf(a.cat) !== kindOf(b.cat)) continue;
        if (o.match_type_name && (a.type || "") !== (b.type || "")) continue;
        let same = true;
        for (let d = 0; d < 6; d++) if (Math.abs(a.box[d] - b.box[d]) > tol) { same = false; break; }
        if (!same) continue;
        seen.add(a.k);
        push({ problem: "Duplicates a linked element", severity: SEV.WARNING, els: [a.k, b.k], primary: a.k, value_mm: null,
          text: `${label(a)} is modelled again in ${b.modelLabel || b.model} (${label(b)}).` });
      }
      return out;
    }
    for (const [i, j] of pairs(mine.map((e) => e.box), theirs.map((e) => e.box), 0.005, false)) {
      const a = mine[i], b = theirs[j];
      const ib = [Math.max(a.box[0], b.box[0]), Math.max(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]),
        Math.min(a.box[3], b.box[3]), Math.min(a.box[4], b.box[4]), Math.min(a.box[5], b.box[5])];
      const vol = (ib[3] - ib[0]) * (ib[4] - ib[1]) * (ib[5] - ib[2]);
      if (vol < o.min_volume_m3) continue;
      let depth = null;
      if (a.tris && b.tris) {
        const r = judge(solid(a), solid(b), { tol: 0.005, join: false });
        if (!r) continue;
        depth = r.depth;
      }
      push({ problem: "Clash with linked model", severity: SEV.CRITICAL, els: [a.k, b.k], primary: a.k, value_mm: depth != null ? mm(depth) : null,
        text: `${label(a)} clashes with ${label(b)} in ${b.modelLabel || b.model}${depth != null ? " (" + fmt(depth) + " deep)" : ""}.` });
    }
    return out;
  }

  // ---------------------------------------------------- against the floors
  const floorsOf = (...ks) => ofKind(host, ...ks);
  if (id === "door_floor") {
    const doors = ofKind(host, ...(o.include_windows ? ["door", "window"] : ["door"]));
    const probe = floorProbe(floorsOf("floor"));
    if (!probe.count) { out.issues.push(notice(id, "floors")); return out; }
    out.population = doors.length;
    for (const d of doors) {
      const r = rectOf(d), sill = d.box[1];
      const sm = (r.s0 + r.s1) / 2;
      let top = null;
      // under the door and a little either side of it (the slab may stop at the wall)
      for (const t of [(r.t0 + r.t1) / 2, r.t0 - 0.05, r.t1 + 0.05]) {
        const [x, z] = world(r, sm, t);
        for (const h of probe.tops(x, z, sill - o.search_mm / 1000, sill + 0.3)) if (top === null || h.y > top) top = h.y;
      }
      if (top === null) continue;
      const delta = sill - top;
      if (delta < -o.below_tol_mm / 1000) push({ problem: "Door below floor", severity: SEV.CRITICAL, els: [d.k], primary: d.k, value_mm: mm(delta),
        text: `${label(d)}: its sill is ${fmt(-delta)} below the floor${d.level ? " (" + d.level + ")" : ""}.` });
      else if (delta > o.allowance_mm / 1000) push({ problem: "Door above floor", severity: SEV.WARNING, els: [d.k], primary: d.k, value_mm: mm(delta),
        text: `${label(d)}: its sill is ${fmt(delta)} above the floor${d.level ? " (" + d.level + ")" : ""}.` });
    }
    return out;
  }

  const samplesOf = (r, n) => {
    n = Math.max(1, Math.floor(n));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const s = r.s0 + (r.len * (i + 0.5)) / n;
      pts.push(world(r, s, (r.t0 + r.t1) / 2));
    }
    return pts;
  };
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  if (id === "wall_base_floor") {
    const walls = ofKind(host, "wall");
    const probe = floorProbe(floorsOf("floor"));
    if (!probe.count) { out.issues.push(notice(id, "floors")); return out; }
    out.population = walls.length;
    const tol = o.tolerance_mm / 1000, search = o.search_mm / 1000;
    for (const w of walls) {
      const r = rectOf(w), base = w.box[1];
      const deltas = [];
      for (const [x, z] of samplesOf(r, o.samples)) {
        // the slab surface nearest the base, below it or the one it is buried in
        let best = null;
        for (const h of probe.tops(x, z, base - search, base + Math.min(0.5, search))) if (best === null || Math.abs(h.y - base) < Math.abs(best - base)) best = h.y;
        if (best !== null) deltas.push(base - best);
      }
      if (!deltas.length) continue;
      const delta = median(deltas);
      if (Math.abs(delta) <= tol) continue;
      push({ problem: delta > 0 ? "Wall base above slab" : "Wall base buried in slab", severity: delta > 0 ? SEV.WARNING : SEV.CRITICAL,
        els: [w.k], primary: w.k, value_mm: mm(delta),
        text: `${label(w)}: its base is ${fmt(Math.abs(delta))} ${delta > 0 ? "above" : "below"} the top of the slab${w.level ? " (" + w.level + ")" : ""}.` });
    }
    return out;
  }

  if (id === "wall_top_soffit") {
    const walls = ofKind(host, "wall");
    const probe = floorProbe(floorsOf(...(o.include_ceilings ? ["floor", "roof", "ceiling"] : ["floor", "roof"])));
    if (!probe.count) { out.issues.push(notice(id, "slabs above")); return out; }
    out.population = walls.length;
    const tol = o.tolerance_mm / 1000;
    for (const w of walls) {
      const r = rectOf(w), top = w.box[4];
      const deltas = [];
      for (const [x, z] of samplesOf(r, o.samples)) {
        let best = null;
        for (const h of probe.bottoms(x, z, top - o.overshoot_mm / 1000, top + o.search_mm / 1000)) {
          if (h.y <= w.box[1] + 0.1) continue;            // the slab under the wall itself
          if (best === null || Math.abs(h.y - top) < Math.abs(best - top)) best = h.y;
        }
        if (best !== null) deltas.push(top - best);
      }
      if (!deltas.length) continue;
      const delta = median(deltas);
      if (Math.abs(delta) <= tol) continue;
      push({ problem: delta > 0 ? "Wall top past soffit" : "Wall top short of soffit", severity: SEV.WARNING, els: [w.k], primary: w.k, value_mm: mm(delta),
        text: `${label(w)}: its top is ${fmt(Math.abs(delta))} ${delta > 0 ? "past" : "short of"} the soffit above${w.level ? " (" + w.level + ")" : ""}.` });
    }
    return out;
  }

  if (id === "element_floor") {
    const comps = ofKind(host, "component");
    const probe = floorProbe(floorsOf("floor"));
    if (!probe.count) { out.issues.push(notice(id, "floors")); return out; }
    out.population = comps.length;
    const tol = o.tolerance_mm / 1000, deep = o.skip_recessed / 1000;
    for (const c of comps) {
      const b = c.box, bottom = b[1];
      let top = null;
      for (const [x, z] of [[(b[0] + b[3]) / 2, (b[2] + b[5]) / 2]]) {
        for (const h of probe.tops(x, z, bottom - o.search_mm / 1000, bottom + deep)) if (top === null || h.y > top) top = h.y;
      }
      if (top === null) continue;
      const sunk = top - bottom;
      if (sunk <= tol || sunk > deep) continue;
      push({ problem: "Component sunk into floor", severity: SEV.WARNING, els: [c.k], primary: c.k, value_mm: mm(-sunk),
        text: `${label(c)} sits ${fmt(sunk)} into the floor${c.level ? " (" + c.level + ")" : ""}.` });
    }
    return out;
  }
  return out;
}

/* ------------------------------------------------------------- score */

/* health.py, as it is: every check an equal share of 100; each keeps the
   part of its own elements that are clean. Accepted findings and notices
   do not count; a check that failed or had nothing to look at drops out. */
export const GRADES = [[90, "A", "Healthy", "#2E9E5B"], [80, "B", "Minor issues", "#7FBF3F"], [70, "C", "Needs attention", "#E8A93A"],
  [60, "D", "Poor", "#E1712F"], [0, "F", "Critical", "#C4382E"]];
export function health(results, accepted) {
  const isAcc = (f) => !!(accepted && accepted(f));
  const factor = (id) => (checkById(id) && checkById(id).score_factor) || 1;
  const scoring = Object.entries(results).filter(([, r]) => !r.error && r.population > 0);
  const total = scoring.reduce((s, [id]) => s + factor(id), 0);
  let score = 0, open = 0, acc = 0;
  const per = [];
  for (const [id, r] of Object.entries(results)) {
    const countable = (r.issues || []).filter((f) => !f.scoreless && !isAcc(f));
    const accN = (r.issues || []).filter((f) => isAcc(f)).length;
    open += countable.length; acc += accN;
    const affected = new Set(countable.map((f) => f.primary)).size;
    let share = 0, earned = 0;
    if (!r.error && r.population > 0 && total > 0) {
      share = 100 * factor(id) / total;
      earned = Math.max(0, 1 - affected / r.population) * share;
    }
    score += earned;
    per.push({ id, share, earned, lost: share - earned, issues: countable.length, affected, accepted: accN, population: r.population || 0, error: r.error || null });
  }
  score = Math.max(0, Math.min(100, score));
  const g = GRADES.find(([t]) => score >= t) || GRADES[GRADES.length - 1];
  return { score, lost: 100 - score, grade: g[1], label: g[2], colour: g[3], issues: open, accepted: acc, checks: per, scored: scoring.length };
}

/* Stable identity across runs, and the same as Revit's: the check, the
   problem and the elements (their Revit UniqueIds), not the measured value. */
export function signature(f, uidOf) {
  const ids = (f.els || []).map(uidOf).filter(Boolean).sort();
  return `${f.check}|${f.problem}|${ids.join(",")}`;
}
/* a short key for an item id */
export function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(36);
}
