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
  dom: { label: "Domestic", acc: 100, cls: "dom", color: "#f2a25c" },
  non: { label: "Non-domestic", acc: 100, cls: "non", color: "#5b8fd6" },
  club: { label: "Clubhouse", acc: 0, cls: "dom", color: "#e3c25a" },
  car: { label: "Car park", acc: 0, cls: "non", color: "#9aa3ad" },
  em: { label: "E&M / plant", acc: 0, cls: "non", color: "#9a7fc4" },
  refuge: { label: "Refuge floor", acc: 0, cls: "dom", color: "#5fb36b" },
  lobby: { label: "Lobby / G/F", acc: 100, cls: "dom", color: "#e88e7a" },
  void: { label: "Void / transfer", acc: 0, cls: "non", color: "#c9ced4" },
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
    return base(p, seen) + groupsOf(p).reduce((s, g) => s + g.n, 0);
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
    for (const g of groupsOf(b)) {
      const u = USES[g.use] || USES.dom;
      for (let i = 0; i < g.n; i++) {
        const acc = g.acc == null || g.acc === "" ? u.acc : Number(g.acc);
        const gfa = Math.max(0, a * acc / 100 - (Number(g.conc) || 0));
        storeys.push({ block: b.id, no: ++k, use: g.use, cls: u.cls, h: g.h, z0: z, z1: z + g.h, area: a, gfa, conc: Math.min(Number(g.conc) || 0, a * acc / 100) });
        z += g.h;
      }
    }
    out.push({ block: b, area: a, storeys });
  }
  return out;
}
function groupsOf(b) {
  return (b.groups || []).map((g) => ({ use: g.use || "dom", n: Math.max(0, Math.round(Number(g.n) || 0)), h: Math.max(0, Number(g.h) || 0), acc: g.acc, conc: g.conc }));
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
export function refuge(storeys, uc6) {
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
  let dom = 0, non = 0, conc = 0;
  for (const x of st) for (const s of x.storeys) { if (s.cls === "dom") dom += s.gfa; else non += s.gfa; conc += s.conc; }
  const covered = unionArea(st.filter((x) => x.storeys.length).map((x) => x.block.fp));
  const bs = buildings(m).map((b) => {
    const top = b.storeys.length ? b.storeys[b.storeys.length - 1].z1 : 0;
    const lv = Number(level);
    return { top: b.top, storeys: b.storeys.length, height: top, mpd: level === "" || level == null || isNaN(lv) ? null : lv + top, refuge: refuge(b.storeys, uc6) };
  });
  const A = Number(siteArea) || 0;
  const r = (x) => Math.round(x * 1000) / 1000;
  return {
    dgfa: r(dom), ngfa: r(non), gfa: r(dom + non), conc: r(conc), covered: r(covered),
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
export function inset(xy, d) {
  const n = xy.length;
  if (n < 3 || !d) return xy.map((p) => p.slice());
  let s = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % n]; s += x1 * y2 - x2 * y1; }
  const sg = s > 0 ? 1 : -1; // anticlockwise: inward is to the left
  // inward normal: (-dy, dx) for anticlockwise
  const L2 = xy.map((a, i) => {
    const b = xy[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * sg, ny = dx / L * sg;
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
        const fp = x.block.fp, n = fp.length;
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
