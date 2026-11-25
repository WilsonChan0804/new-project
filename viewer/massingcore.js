/* Site study, phase 2: the massing - blocks of floor plates stacked in
 * groups of storeys, each with its use. Pure: the figures and the rules;
 * tested in tests/massing.test.mjs.
 *
 * Footprints are [x, y] metres on the site's local plane (sitecore toXY about
 * the site's centroid). A block stands on the ground or on another block
 * (a tower on its podium).
 */
import { areaXY } from "./sitecore.js";

export const USES = {
  dom: { label: "Domestic", acc: 100, cls: "dom", color: "#f6d86b", cap: true },
  hotel: { label: "Hotel / serviced apt", acc: 100, cls: "non", color: "#d9a8ec", cap: true },
  non: { label: "Office", acc: 100, cls: "non", color: "#7dbbf0", cap: true },
  retail: { label: "Retail", acc: 100, cls: "non", color: "#f47b6b", cap: true },
  fnb: { label: "F&B", acc: 100, cls: "non", color: "#f9a65a", cap: true },
  lobby: { label: "Lobby / G/F", acc: 100, cls: "dom", color: "#f7c9a8", cap: true },
  club: { label: "Clubhouse / amenity", acc: 0, cls: "dom", color: "#8ed6a1" },
  refuge: { label: "Refuge floor", acc: 0, cls: "dom", color: "#4cc3b8" },
  gic: { label: "GIC / community", acc: 100, cls: "non", color: "#6e8ff2" },
  land: { label: "Landscape / roof deck", acc: 0, cls: "non", color: "#bce070" },
  car: { label: "Car park", acc: 0, cls: "non", color: "#bcc6d2" },
  em: { label: "E&M / plant", acc: 0, cls: "non", color: "#9eaabb" },
  load: { label: "Loading / service", acc: 0, cls: "non", color: "#8794a3" },
  base: { label: "Basement", acc: 0, cls: "non", color: "#c8ac90" },
  transfer: { label: "Transfer plate", acc: 0, cls: "non", color: "#5b6470", storey: false },
  emzone: { label: "E&M zone (not a storey)", acc: 0, cls: "non", color: "#aeb8c6", storey: false },
  void: { label: "Void", acc: 0, cls: "non", color: "#e6e9ee" },
};

/* FS Code 2011 Clause B18 (refuge floors):
   B18.1 buildings exceeding 25 storeys above the lowest ground storey: refuge
   floors at not more than 25 storeys (20 for Use Classification 6) from the
   street or any other refuge floor; B18.5 a building of not more than 40
   storeys may have its refuge on the roof instead. The refuge floor itself is
   not counted in the 25 (BD, ADF 2/2020); storeys of plant are counted. */
export const REFUGE = { over: 25, every: 25, everyUc6: 20, roofUpTo: 40, src: "FS Code 2011 B18.1, B18.5; ADF 2/2020" };

/* the storeys of each building (a block and what stands on it) bottom up */
export function stacks(m) {
  const blocks = (m && m.blocks) || [];
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const base = (b, seen = new Set()) => {
    if (!b.on || !byId[b.on] || seen.has(b.id)) return 0;
    seen.add(b.id);
    const p = byId[b.on];
    return base(p, seen) + groupsOf(p).reduce((s, g) => s + ((g.storey == null ? (USES[g.use] || USES.dom).storey !== false : g.storey) ? g.n : 0), 0);
  };
  const zOf = (b, seen = new Set()) => {
    if (!b.on || !byId[b.on] || seen.has(b.id)) return 0;
    seen.add(b.id);
    const p = byId[b.on];
    return zOf(p, seen) + groupsOf(p).reduce((s, g) => s + g.n * g.h, 0);
  };
  const out = [];
  for (const b of blocks) {
    const a = b.fp && b.fp.length >= 3 ? areaXY(b.fp) : 0;
    let k = base(b), z = zOf(b);
    const storeys = [];
    for (const [gi, g] of groupsOf(b).entries()) {
      const u = USES[g.use] || USES.dom;
      const fp = g.fp && g.fp.length >= 3 ? g.fp : b.fp, ga = g.fp && g.fp.length >= 3 ? areaXY(g.fp) : a;
      const isStorey = g.storey == null ? u.storey !== false : !!g.storey;
      // a floor of more than one use: strips of the plate, each its share of the area
      const parts = Array.isArray(g.parts) && g.parts.length >= 2 ? g.parts : null;
      const pieces = parts ? strips(fp, parts.map((q) => Math.max(0, Number(q.share) || 0))).map((pf, j) => ({ fp: pf, use: parts[j].use || "dom", acc: parts[j].acc }))
        : [{ fp, use: g.use, acc: g.acc, whole: true }];
      for (let i = 0; i < g.n; i++) {
        const no = isStorey ? ++k : null;
        for (const pc of pieces) {
          const pu = USES[pc.use] || USES.dom, pa = pc.whole ? ga : areaXY(pc.fp);
          const acc = Math.max(0, Math.min(100, pc.acc == null || pc.acc === "" ? pu.acc : Number(pc.acc)));
          const gfa = pa * acc / 100;
          // the floor area not counted is the concession; any extra (balconies, UP outside the footprint) on top
          const conc = pa - gfa + (pc === pieces[0] ? Number(g.extra) || 0 : 0);
          storeys.push({ block: b.id, gi, no, storey: isStorey, use: pc.use, cls: pu.cls, cap: !!pu.cap, h: g.h, z0: z, z1: z + g.h, area: pa, gfa, conc, fp: pc.fp, part: !pc.whole });
        }
        z += g.h;
      }
    }
    out.push({ block: b, area: a, storeys });
  }
  return out;
}
function groupsOf(b) {
  return (b.groups || []).map((g) => ({ use: g.use || "dom", n: Math.max(0, Math.round(Number(g.n) || 0)), h: Math.max(0, Number(g.h) || 0), acc: g.acc, extra: g.extra != null ? g.extra : g.conc, storey: g.storey, fp: g.fp, parts: g.parts }));
}

/* the buildings: each top block with everything under it, storeys bottom up */
export function buildings(m) {
  const st = stacks(m), blocks = (m && m.blocks) || [];
  const hasTop = new Set(blocks.filter((b) => b.on).map((b) => b.on));
  const byId = Object.fromEntries(st.map((x) => [x.block.id, x]));
  const out = [];
  for (const x of st) {
    if (hasTop.has(x.block.id)) continue; // something stands on it: part of another building
    const chain = [x];
    let b = x.block, guard = 0;
    while (b.on && byId[b.on] && guard++ < 20) { chain.unshift(byId[b.on]); b = byId[b.on].block; }
    out.push({ top: x.block, blocks: chain.map((c) => c.block.id), storeys: chain.flatMap((c) => c.storeys) });
  }
  return out;
}

/* refuge floors for one building's storeys -> {need, why, due: [storey no], ok} */
export function refuge(all, uc6) {
  const byNo = new Map();
  for (const s of all || []) if (s.storey !== false) { const o = byNo.get(s.no); if (!o) byNo.set(s.no, Object.assign({}, s)); else if (s.use === "refuge") o.use = "refuge"; }
  const storeys = [...byNo.values()];
  const every = uc6 ? REFUGE.everyUc6 : REFUGE.every;
  const counted = storeys.filter((s) => s.use !== "refuge").length;
  const placed = storeys.filter((s) => s.use === "refuge").map((s) => s.no);
  if (counted <= REFUGE.over) return { need: "none", why: `${counted} storeys: not over ${REFUGE.over}, no refuge floor needed`, due: [], placed, ok: true, counted };
  const due = [];
  let run = 0, ok = true;
  for (const s of storeys) {
    if (s.use === "refuge") { run = 0; continue; }
    run++;
    if (run > every) { due.push(s.no); ok = false; run = 1; }
  }
  if (counted <= REFUGE.roofUpTo && !placed.length)
    return { need: "roof", why: `${counted} storeys: over ${REFUGE.over} and not over ${REFUGE.roofUpTo} - a refuge on the roof (B18.5), or refuge floors not more than ${every} storeys apart`, due, placed, ok: true, counted, roof: true };
  return { need: "floors", why: `${counted} storeys: refuge floors not more than ${every} storeys apart from the street or another refuge floor (B18.1)${ok ? " - placed" : ""}`, due, placed, ok, counted };
}
/* where refuge floors should go for n counted storeys: storey numbers */
export function refugeAt(n, uc6) {
  const every = uc6 ? REFUGE.everyUc6 : REFUGE.every;
  if (n <= REFUGE.over) return [];
  const out = [];
  let k = 0, run = 0, left = n;
  while (left > 0) { k++; if (run === every) { out.push(k); run = 0; continue; } run++; left--; }
  return out;
}

/* the site coverage: the area of the union of the footprints at ground
   (all blocks, a tower over its podium counted once), by sampling */
export function unionArea(polys, step) {
  const ps = polys.filter((p) => p && p.length >= 3);
  if (!ps.length) return 0;
  if (ps.length === 1) return areaXY(ps[0]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const d = step || Math.max((x1 - x0) / 500, (y1 - y0) / 500, 0.05);
  let n = 0;
  for (let x = x0 + d / 2; x < x1; x += d)
    for (let y = y0 + d / 2; y < y1; y += d)
      if (ps.some((p) => inside(p, x, y))) n++;
  return n * d * d;
}
export function inside(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/* the figures: GFA, SC, PR, heights, storeys, refuge */
export function figures(m, siteArea, level, uc6) {
  const st = stacks(m);
  let dom = 0, non = 0, conc = 0, capConc = 0;
  for (const x of st) for (const s of x.storeys) { if (s.cls === "dom") dom += s.gfa; else non += s.gfa; conc += s.conc; if (s.cap) capConc += s.conc; }
  // the site coverage: every floor plate seen from above, together
  const plates = [];
  for (const x of st) { if (!x.storeys.length) continue; const seen = new Set(); for (const s2 of x.storeys) if (!seen.has(s2.fp)) { seen.add(s2.fp); plates.push(s2.fp); } }
  const covered = unionArea(plates);
  const bs = buildings(m).map((b) => {
    const top = b.storeys.length ? b.storeys[b.storeys.length - 1].z1 : 0;
    const lv = Number(level);
    return { top: b.top, storeys: new Set(b.storeys.filter((x) => x.storey !== false).map((x) => x.no)).size, height: top, mpd: level === "" || level == null || isNaN(lv) ? null : lv + top, refuge: refuge(b.storeys, uc6) };
  });
  const A = Number(siteArea) || 0;
  const r = (x) => Math.round(x * 1000) / 1000;
  return {
    dgfa: r(dom), ngfa: r(non), gfa: r(dom + non), conc: r(conc), capConc: r(capConc), covered: r(covered),
    sc: A ? r(covered / A * 100) : null, dpr: A ? r(dom / A) : null, npr: A ? r(non / A) : null, pr: A ? r((dom + non) / A) : null,
    storeys: bs.length ? Math.max(...bs.map((b) => b.storeys)) : 0,
    height: bs.length ? Math.max(...bs.map((b) => b.height)) : 0,
    mpd: bs.some((b) => b.mpd != null) ? Math.max(...bs.filter((b) => b.mpd != null).map((b) => b.mpd)) : null,
    buildings: bs,
  };
}

/* the figures against the governing limits (sitecore potential rows) */
export function against(f, rows) {
  const g = Object.fromEntries((rows || []).map((r) => [r.key, r]));
  const one = (key, label, v, unit, lim) => ({ key, label, value: v, unit, limit: lim ? lim.value : null, by: lim ? lim.by : "",
    status: lim && lim.value != null && v != null ? (v > lim.value + 1e-6 ? "over" : "ok") : "" });
  return [
    one("dgfa", "Domestic GFA", f.dgfa, "m²", g.dgfa),
    one("ngfa", "Non-domestic GFA", f.ngfa, "m²", g.ngfa),
    one("gfa", "Total GFA", f.gfa, "m²", g.gfa),
    one("sc", "Site coverage", f.sc, "%", g.sc),
    one("bh", "Building height", f.mpd, "mPD", g.bh),
    one("storeys", "Storeys", f.storeys, "", g.storeys),
  ];
}

/* the boundary offset inwards by d m (each edge moved in, its ends where the
   moved neighbours meet) - for a podium set back from the site */
export function inset(xy, dd) {
  const n = xy.length, dOf = (i) => (Array.isArray(dd) ? Number(dd[i]) || 0 : Number(dd) || 0);
  if (n < 3 || (!Array.isArray(dd) && !dd)) return xy.map((p) => p.slice());
  let s = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % n]; s += x1 * y2 - x2 * y1; }
  const sg = s > 0 ? 1 : -1; // anticlockwise: inward is to the left
  // inward normal: (-dy, dx) for anticlockwise
  const L2 = xy.map((a, i) => {
    const b = xy[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * sg, ny = dx / L * sg, d = dOf(i);
    return { p: [a[0] + nx * d, a[1] + ny * d], dir: [dx, dy] };
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = L2[(i - 1 + n) % n], B = L2[i];
    const den = A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0];
    if (Math.abs(den) < 1e-9) { out.push(B.p.slice()); continue; }
    const t = ((B.p[0] - A.p[0]) * B.dir[1] - (B.p[1] - A.p[1]) * B.dir[0]) / den;
    out.push([A.p[0] + A.dir[0] * t, A.p[1] + A.dir[1] * t]);
  }
  return out;
}

/* a rectangle of `area` m2, w:d = ratio, centred on c */
export function rect(c, area, ratio = 1.6) {
  const w = Math.sqrt(area * ratio), d = area / w;
  return [[c[0] - w / 2, c[1] - d / 2], [c[0] + w / 2, c[1] - d / 2], [c[0] + w / 2, c[1] + d / 2], [c[0] - w / 2, c[1] + d / 2]];
}

/* OBJ text: each storey a prism; one object per block and use */
export function toObj(m, level) {
  const st = stacks(m), lv = Number(level) || 0;
  let out = "# LWK Viewer site study massing (metres; z = mPD)\n", v = 0;
  for (const x of st) {
    const groups = {};
    for (const s of x.storeys) (groups[s.use] = groups[s.use] || []).push(s);
    for (const [use, ss] of Object.entries(groups)) {
      out += `o ${(x.block.name || x.block.id).replace(/\s+/g, "_")}_${use}\n`;
      for (const s of ss) {
        const fp = s.fp || x.block.fp, n = fp.length;
        for (const [px, py] of fp) out += `v ${px.toFixed(3)} ${(s.z0 + lv).toFixed(3)} ${(-py).toFixed(3)}\n`;
        for (const [px, py] of fp) out += `v ${px.toFixed(3)} ${(s.z1 + lv).toFixed(3)} ${(-py).toFixed(3)}\n`;
        const b = v + 1, t = v + 1 + n;
        out += "f " + fp.map((_, i) => b + (n - 1 - i)).join(" ") + "\n";
        out += "f " + fp.map((_, i) => t + i).join(" ") + "\n";
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; out += `f ${b + i} ${b + j} ${t + j} ${t + i}\n`; }
        v += 2 * n;
      }
    }
  }
  return out;
}

/* the set-back of each footprint edge from the site boundary: the
   perpendicular distance to the nearest near-parallel site edge -> [m|null] */
export function setbacks(fp, site) {
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  return fp.map((a, i) => {
    const b = fp[(i + 1) % fp.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t = ang(a, b);
    let best = null;
    site.forEach((p, j) => {
      const q = site[(j + 1) % site.length];
      let d = Math.abs(((t - ang(p, q)) + Math.PI * 2) % Math.PI);
      d = Math.min(d, Math.PI - d);
      if (d > 10 * Math.PI / 180) return;
      const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
      const u = ((m[0] - p[0]) * dx + (m[1] - p[1]) * dy) / (L * L);
      if (u < -0.2 || u > 1.2) return;
      const dist = Math.abs((m[0] - p[0]) * dy - (m[1] - p[1]) * dx) / L;
      if (best == null || dist < best) best = dist;
    });
    return best;
  });
}
/* the polygon grown (d > 0) or shrunk (d < 0) by d m */
export const grow = (xy, d) => inset(xy, -d);

/* half-plane clip: the part of poly where (p - a)·n >= 0 */
function clipHalf(poly, a, n) {
  const out = [], f = (p) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
/* the plate cut into strips across its longest edge, each the share of the
   area given (shares in any units) -> [poly] */
export function strips(fp, shares) {
  const n = fp.length, tot = shares.reduce((x, y) => x + y, 0) || 1, A = areaXY(fp);
  let li = 0, ll = 0;
  for (let i = 0; i < n; i++) { const q = fp[(i + 1) % n], L = Math.hypot(q[0] - fp[i][0], q[1] - fp[i][1]); if (L > ll) { ll = L; li = i; } }
  const q = fp[(li + 1) % n], u = [(q[0] - fp[li][0]) / ll, (q[1] - fp[li][1]) / ll];
  const proj = fp.map((p) => p[0] * u[0] + p[1] * u[1]), lo = Math.min(...proj), hi = Math.max(...proj);
  const at = (t) => [u[0] * t, u[1] * t];
  const below = (t) => clipHalf(fp, at(t), [-u[0], -u[1]]); // the part with projection <= t
  const cuts = [lo];
  let acc = 0;
  for (let j = 0; j < shares.length - 1; j++) {
    acc += shares[j] / tot * A;
    let a = lo, b = hi;
    for (let k = 0; k < 50; k++) { const m = (a + b) / 2, pm = below(m); if ((pm.length >= 3 ? areaXY(pm) : 0) < acc) a = m; else b = m; }
    cuts.push((a + b) / 2);
  }
  cuts.push(hi);
  const out = [];
  for (let j = 0; j < shares.length; j++) {
    let p = clipHalf(fp, at(cuts[j]), u);
    p = clipHalf(p, at(cuts[j + 1]), [-u[0], -u[1]]);
    out.push(p.length >= 3 ? p : []);
  }
  return out;
}
