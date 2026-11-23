/* Site study: the site boundary's geometry and the rules read from it.
 * Pure functions, no page; tested in tests/sitecore.test.mjs.
 *
 * Points are [lat, lng] (WGS84, as the map gives them). Lengths and areas are
 * worked in metres on a local plane about the site (equirectangular, at the
 * site's latitude): for a site of a few hundred metres the error is far under
 * 0.01% - well within a survey's tolerance for a schematic study.
 */

const R_EARTH = 6378137; // WGS84 semi-major axis (m)
const RAD = Math.PI / 180;

export function centre(pts) {
  let la = 0, ln = 0;
  for (const [a, b] of pts) { la += a; ln += b; }
  return [la / pts.length, ln / pts.length];
}

/* the ellipsoid's radii at a latitude: along the meridian (north) and
   across it (east, times cos lat) - a sphere would be 0.5% out north-south */
const E2 = 6.69437999014e-3; // WGS84
function radii(lat) {
  const s = Math.sin(lat * RAD), w = 1 - E2 * s * s;
  return [R_EARTH / Math.sqrt(w) * Math.cos(lat * RAD), R_EARTH * (1 - E2) / Math.pow(w, 1.5)];
}
/* [lat,lng] -> [x,y] metres about the origin o */
export function toXY(pts, o = centre(pts)) {
  const [kx, ky] = radii(o[0]);
  return pts.map(([a, b]) => [(b - o[1]) * RAD * kx, (a - o[0]) * RAD * ky]);
}
export function fromXY(xy, o) {
  const [kx, ky] = radii(o[0]);
  return xy.map(([x, y]) => [o[0] + y / (RAD * ky), o[1] + x / (RAD * kx)]);
}

/* the polygon's area in m2 (shoelace), always positive */
export function areaXY(xy) {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
export const area = (pts) => (pts && pts.length >= 3 ? areaXY(toXY(pts)) : 0);

/* the length of each edge i (from point i to point i+1), metres */
export function edges(pts) {
  if (!pts || pts.length < 2) return [];
  const xy = toXY(pts);
  return xy.map((p, i) => { const q = xy[(i + 1) % xy.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
}
export const perimeter = (pts) => edges(pts).reduce((a, b) => a + b, 0);

/* the area's centroid (not the mean of the points), [lat,lng] */
export function centroid(pts) {
  const o = centre(pts), xy = toXY(pts, o);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length], c = x1 * y2 - x2 * y1;
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-9) return o;
  return fromXY([[cx / (3 * a), cy / (3 * a)]], o)[0];
}

/* the boundary scaled about its centroid so that its area is `target` m2.
   -> {pts, factor}; the shape and its angles stay, each length x factor. */
export function scaleTo(pts, target) {
  const a = area(pts);
  if (!(a > 0) || !(target > 0)) return { pts, factor: 1 };
  // twice: the local plane about the centroid and the one area() uses differ
  // by a hair on a large site
  let out = pts, f = 1;
  for (let k = 0; k < 3; k++) {
    const fk = Math.sqrt(target / area(out)), o = centroid(out);
    out = fromXY(toXY(out, o).map(([x, y]) => [x * fk, y * fk]), o);
    f *= fk;
  }
  return { pts: out, factor: f };
}

/* does the boundary cross itself? (its area would then mean nothing) */
export function selfCrosses(pts) {
  if (!pts || pts.length < 4) return false;
  const xy = toXY(pts), n = xy.length;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const hit = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (hit(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
    }
  return false;
}

/* The class of site, B(P)R reg. 2 (definitions):
     Class A - not class B or C (one street, or none);
     Class B - a corner site abutting on two specified streets;
     Class C - a corner site abutting on three specified streets.
   A "specified street" is not less than 4.5 m wide (reg. 18A / definition of
   "street" for the classes); a street narrower than that does not count.
   Two streets count as a corner only where they meet: on edges side by side
   (next to each other round the boundary). Two streets on opposite sides
   with no corner between them leave the site class A.
   streets: [{edge: i, width: m}] -> {cls, why, counted: [edge,...]} */
export const STREET_MIN = 4.5;
export const SAME_STREET_DEG = 20;
export function siteClass(n, streets, pts) {
  const ok = (streets || []).filter((s) => s && Number(s.width) >= STREET_MIN && s.edge >= 0 && s.edge < n);
  const set = [...new Set(ok.map((s) => s.edge))].sort((a, b) => a - b);
  const narrow = (streets || []).filter((s) => s && s.width !== "" && s.width != null && Number(s.width) < STREET_MIN).length;
  const next = (a, b) => (a + 1) % n === b; // edge a then edge b, meeting at corner b
  const adj = (a, b) => next(a, b) || next(b, a);
  // edges side by side that hardly turn are one street (a corner added on a
  // street edge, or a road drawn in two pieces): no street corner between them
  const bend = pts && pts.length === n ? turns(pts) : null;
  const same = (a, b) => bend && (next(a, b) ? bend[b] : bend[a]) < SAME_STREET_DEG;
  // streets: the runs of street edges that are one street
  const id = {}; let k = 0;
  for (const e of set) id[e] = id[e] != null ? id[e] : k++;
  for (let pass = 0; pass < n; pass++)
    for (const a of set) for (const b of set) if (a !== b && adj(a, b) && same(a, b) && id[a] !== id[b]) { const lo = Math.min(id[a], id[b]); id[a] = id[b] = lo; }
  // the largest group of streets joined at corners
  let chain = 0;
  const seen = new Set();
  for (const s0 of set) {
    if (seen.has(s0)) continue;
    const ids = new Set(); const stack = [s0]; seen.add(s0);
    while (stack.length) {
      const e = stack.pop(); ids.add(id[e]);
      for (const t of set) if (!seen.has(t) && adj(e, t)) { seen.add(t); stack.push(t); }
    }
    chain = Math.max(chain, ids.size);
  }
  const count = new Set(set.map((e) => id[e])).size;
  const note = narrow ? ` (${narrow} street${narrow > 1 ? "s" : ""} under ${STREET_MIN} m not counted)` : "";
  const out = (cls, why) => ({ cls, why: why + note, counted: set, streets: count, streetOf: id });
  if (chain >= 3) return out("C", "A corner site on three streets");
  if (chain === 2) return out("B", "A corner site on two streets");
  if (count >= 2) return out("A", "Streets on more than one side but they do not meet at a corner");
  if (count === 1) return out("A", "One street");
  return out("A", "No street marked yet: class A until streets are marked");
}

/* the turn at each corner i (between edge i-1 and edge i), degrees 0-180 */
export function turns(pts) {
  const xy = toXY(pts), n = xy.length;
  return xy.map((p, i) => {
    const a = xy[(i - 1 + n) % n], b = xy[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]];
    const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
    return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
  });
}

/* HK 1980 Grid (EPSG:2326) easting / northing -> WGS84 [lat, lng].
   The Survey and Mapping Office's published formulae: transverse Mercator on
   the International 1924 ellipsoid, then the HK80 -> WGS84 shift
   (lat - 5.5", lng + 8.8"), good to a few metres - enough to find the site. */
export function hk80ToWgs84(E, N) {
  const a = 6378388, e2 = 6.722670022e-3, m0 = 1;
  const N0 = 819069.80, E0 = 836694.05, M0 = 2468395.723;
  const phi0 = (22 + 18 / 60 + 43.68 / 3600) * RAD, lam0 = (114 + 10 / 60 + 42.80 / 3600) * RAD;
  const A0 = 1 - e2 / 4 - 3 * e2 * e2 / 64, A2 = 3 / 8 * (e2 + e2 * e2 / 4), A4 = 15 / 256 * e2 * e2;
  const meridian = (p) => a * (A0 * p - A2 * Math.sin(2 * p) + A4 * Math.sin(4 * p));
  // the footpoint latitude
  const M = (N - N0 + M0) / m0;
  let p = phi0;
  for (let i = 0; i < 20; i++) p += (M - meridian(p)) / (a * A0);
  const s = Math.sin(p), t = Math.tan(p);
  const nu = a / Math.sqrt(1 - e2 * s * s), rho = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), psi = nu / rho;
  const dE = E - E0;
  const lat = p - (t / (m0 * rho)) * (dE * dE / (2 * m0 * nu));
  const lng = lam0 + (1 / Math.cos(p)) * (dE / (m0 * nu)) - (1 / Math.cos(p)) * (Math.pow(dE, 3) / (6 * Math.pow(m0 * nu, 3))) * (psi + 2 * t * t);
  return [lat / RAD - 5.5 / 3600, lng / RAD + 8.8 / 3600];
}

/* a starting rectangle of `area` m2 (2:3) centred on c, when no boundary is drawn */
export function rectangle(c, areaM2) {
  const w = Math.sqrt(areaM2 * 1.5), d = areaM2 / w;
  return fromXY([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], c);
}

/* Development potential: B(P)R, the OZP and the lease side by side, the
   strictest of each governing. Every input may be missing (null).
   i: {area, bpr: {dpr, npr, sc}, ozp: {dpr, npr, pr, sc, bh, storeys},
       lease: {gfa, dgfa, ngfa, sc, bh, storeys}}
   -> [{key, label, unit, bpr, ozp, lease, value, by}] */
export function potential(i) {
  const a = Number(i.area) > 0 ? Number(i.area) : null;
  const n = (x) => (x === "" || x == null || isNaN(Number(x)) ? null : Number(x));
  const B = i.bpr || {}, O = i.ozp || {}, L = i.lease || {};
  const g = (pr) => (a != null && n(pr) != null ? Math.round(a * n(pr) * 1000) / 1000 : null);
  const ozTot = n(O.pr) != null ? g(O.pr) : n(O.dpr) != null || n(O.npr) != null ? (g(O.dpr) || 0) + (g(O.npr) || 0) : null;
  const rows = [
    { key: "dgfa", label: "Domestic GFA", unit: "m²", bpr: g(B.dpr), ozp: g(O.dpr), lease: n(L.dgfa) },
    { key: "ngfa", label: "Non-domestic GFA", unit: "m²", bpr: g(B.npr), ozp: g(O.npr), lease: n(L.ngfa) },
    { key: "gfa", label: "Total GFA", unit: "m²", bpr: null, ozp: ozTot, lease: n(L.gfa) },
    { key: "sc", label: "Site coverage", unit: "%", bpr: n(B.sc), ozp: n(O.sc), lease: n(L.sc) },
    { key: "bh", label: "Building height", unit: "mPD", bpr: null, ozp: n(O.bh), lease: n(L.bh) },
    { key: "storeys", label: "Storeys", unit: "", bpr: null, ozp: n(O.storeys), lease: n(L.storeys) },
  ];
  const NAMES = { bpr: "B(P)R", ozp: "OZP", lease: "Lease" };
  for (const r of rows) {
    let v = null, by = [];
    for (const k of ["bpr", "ozp", "lease"]) {
      if (r[k] == null) continue;
      if (v == null || r[k] < v - 1e-9) { v = r[k]; by = [NAMES[k]]; }
      else if (Math.abs(r[k] - v) <= 1e-9) by.push(NAMES[k]);
    }
    r.value = v; r.by = by.join(" + ");
  }
  return rows;
}

/* ---------- streets by name (2027-02-27)
   edgeStreet: {edge: id}; roads: {id: {name, width}}. A road with no width
   counts (taken as 4.5 m or more, and said so); a typed width under 4.5 m
   drops it. Two different roads meet at a corner on neighbouring edges, or
   across short edges (splays, under SPLAY m) between them. */
export const SPLAY = 3;
export function roadClass(n, edgeStreet, roads, lens) {
  const R = roads || {}, E = edgeStreet || {};
  const wOf = (id) => { const r = R[id]; return r && r.width !== "" && r.width != null && !isNaN(Number(r.width)) ? Number(r.width) : null; };
  const used = [...new Set(Object.entries(E).filter(([e]) => +e >= 0 && +e < n).map(([, id]) => String(id)))];
  const counts = used.filter((id) => wOf(id) == null || wOf(id) >= STREET_MIN);
  const narrow = used.filter((id) => wOf(id) != null && wOf(id) < STREET_MIN);
  const noWidth = counts.filter((id) => wOf(id) == null);
  const ok = new Set(counts);
  const idAt = (e) => (E[e] != null && ok.has(String(E[e])) ? String(E[e]) : null);
  // corners: from each street edge, walk on past short unmarked edges
  const link = {};
  for (const id of counts) link[id] = new Set();
  for (let e = 0; e < n; e++) {
    const a = idAt(e);
    if (a == null) continue;
    let f = (e + 1) % n, steps = 0;
    while (steps < n && idAt(f) == null && E[f] == null && lens && lens[f] < SPLAY) { f = (f + 1) % n; steps++; }
    const b = idAt(f);
    if (b != null && b !== a) { link[a].add(b); link[b].add(a); }
  }
  let best = [];
  const seen = new Set();
  for (const id of counts) {
    if (seen.has(id)) continue;
    const comp = [], st = [id]; seen.add(id);
    while (st.length) { const x = st.pop(); comp.push(x); for (const y of link[x]) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    if (comp.length > best.length) best = comp;
  }
  const nm = (id) => (R[id] && R[id].name) || "Street " + (used.indexOf(id) + 1);
  const list = (ids) => ids.map(nm).join(ids.length > 2 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1");
  const notes = [];
  if (noWidth.length) notes.push(`width not given for ${list(noWidth)} – taken as ≥ ${STREET_MIN} m`);
  if (narrow.length) notes.push(`${list(narrow)} under ${STREET_MIN} m: not counted`);
  const note = notes.length ? " (" + notes.join("; ") + ")" : "";
  const out = (cls, why) => ({ cls, why: why + note, streets: counts.length, corner: best });
  if (best.length >= 3) return out("C", `A corner site on ${list(best.slice(0, 3))}${best.length > 3 ? " (and more)" : ""}`);
  if (best.length === 2) return out("B", `A corner site on ${list(best)}`);
  if (counts.length >= 2) return out("A", `${list(counts)} do not meet at a corner`);
  if (counts.length === 1) return out("A", `One street: ${nm(counts[0])}`);
  return out("A", used.length ? "No street counts" : "No street marked yet: class A until streets are marked");
}

/* the old saved form {edge: {width}} -> {streets: {edge: id}, roads} */
export function migrateStreets(old, pts) {
  const edges = Object.keys(old || {}).map(Number).sort((a, b) => a - b), n = (pts || []).length;
  const g = siteClass(n, edges.map((e) => ({ edge: e, width: 99 })), pts).streetOf || {};
  const streets = {}, roads = {}, ids = {};
  let k = 0;
  for (const e of edges) {
    const grp = g[e] != null ? g[e] : "e" + e;
    if (ids[grp] == null) { ids[grp] = ++k; roads[k] = { name: "", width: old[e] && old[e].width != null ? old[e].width : "" }; }
    streets[e] = ids[grp];
  }
  return { streets, roads };
}

/* Match the area keeping the street edges: the corners on a street stay,
   the others move along the line from the centroid (one factor for all,
   found by bisection). -> {pts, factor, moved} or null when nothing can move */
export function matchKeeping(pts, target, fixed, freeEdges) {
  const n = pts.length, fx = new Set(fixed || []);
  if (!(target > 0) || n < 3) return null;
  const o = centroid(pts), xy = toXY(pts, o);
  const solve = (at, lo, hi) => {
    const f = (t) => { const q = at(t); return q ? area(q) - target : NaN; };
    let flo = f(lo), fhi = f(hi);
    if (flo > 0 && fhi < 0) { [lo, hi] = [hi, lo]; [flo, fhi] = [fhi, flo]; }
    if (!(flo <= 0 && fhi >= 0)) {
      // too far either way breaks the shape: close in from both ends
      let ok2 = false;
      for (let k = 0; k < 40 && !ok2; k++) { lo = lo * 0.7; hi = hi * 0.7; flo = f(lo); fhi = f(hi); if (flo > 0 && fhi < 0) { [lo, hi] = [hi, lo]; [flo, fhi] = [fhi, flo]; } ok2 = flo <= 0 && fhi >= 0; }
      if (!ok2) return null;
    }
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2, fm = f(m); if (!(fm < 0)) hi = m; else lo = m; }
    const out = at((lo + hi) / 2);
    return out && !selfCrosses(out) ? { pts: out, factor: (lo + hi) / 2 } : null;
  };
  if (fx.size < n) {
    // the corners off the streets move along the line from the centroid
    const r = solve((t) => fromXY(xy.map((p, i) => (fx.has(i) ? p : [p[0] * t, p[1] * t])), o), 0.2, 5);
    if (r) return Object.assign(r, { moved: n - fx.size, how: "corners" });
  }
  // every corner is on a street: push the edges off the streets in or out,
  // parallel, their ends sliding along the edges either side
  const free = (freeEdges || []).filter((e) => e >= 0 && e < n);
  if (!free.length) return null;
  const sgn = Math.sign(xy.reduce((s2, p, i) => { const q = xy[(i + 1) % n]; return s2 + p[0] * q[1] - q[0] * p[1]; }, 0)) || 1;
  const meet = (p1, d1, p2, d2) => { const den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-9) return null; const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]; };
  const at = (d) => {
    const q = xy.map((p) => p.slice());
    for (const e of free) {
      const a = q[e], b = q[(e + 1) % n], pa = q[(e - 1 + n) % n], nb = q[(e + 2) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nrm = [sgn * dy / L, -sgn * dx / L]; // outward
      const a0 = [a[0] + nrm[0] * d, a[1] + nrm[1] * d], dir = [dx, dy];
      const na = meet(pa, [a[0] - pa[0], a[1] - pa[1]], a0, dir), nb2 = meet(nb, [b[0] - nb[0], b[1] - nb[1]], a0, dir);
      if (!na || !nb2) return null;
      q[e] = na; q[(e + 1) % n] = nb2;
    }
    return fromXY(q, o);
  };
  const span = Math.sqrt(area(pts)) * 2;
  const r = solve(at, -span, span);
  return r ? Object.assign(r, { moved: free.length, how: "edges", offset: r.factor }) : null;
}

/* the distance between two [lat,lng] points, m */
export function distance(a, b) {
  const [p, q] = toXY([a, b], a);
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}
