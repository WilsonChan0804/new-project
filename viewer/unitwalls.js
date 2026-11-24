/* The walls of a unit as one drawing: each wall a band at its thickness,
 * joined at corners and tees (each end runs to the far face of the wall it
 * meets), the openings cut out, then drawn as a union - the outer lines
 * heavy, a thin line only where two materials meet.
 *
 * Partitions sit on their grid line (centre) or, by default, flush with the
 * inner face of a thicker external / party wall in line with them ("edge"):
 * u.join = "edge" | "centre"; u.walls[key].align = "c" (centre) | "flip"
 * (flush to the other face) overrides it for one wall.
 *
 * Pure: no DOM; plan metres in and out. */

const E = 1e-6;
const OUT = { e: 1, w: -1, s: 1, n: -1 };

/* opts: tOf(e), isOpen(e), solid(e) -> [a, b], openings [{x1, y1, x2, y2}] */
export function wallGeom(u, edges, opts) {
  const tOf = opts.tOf, W = u.walls || {}, mode = u.join === "centre" ? "centre" : "edge";
  const live = edges.filter((e) => !opts.isOpen(e) && !(e.kind === "ext" && e.facade === "cw" && !opts.withCw));
  const cw = edges.filter((e) => e.kind === "ext" && e.facade === "cw");
  const vert = (e) => Math.abs(e.x1 - e.x2) < E;
  const lineOf = (e) => (vert(e) ? e.x1 : e.y1);
  const lo = (e) => (vert(e) ? e.y1 : e.x1), hi = (e) => (vert(e) ? e.y2 : e.x2);
  const solid = new Map(live.map((e) => [e, e.kind === "part" ? opts.solid(e) : [0, e.len]]));

  // the centre line of each wall: partitions flush with a thicker wall in line
  const off = new Map();
  for (const e of live) {
    let o = 0;
    if (e.kind === "part") {
      const al = (W[e.key] || {}).align;
      if (al !== "c" && (mode === "edge" || al === "flip")) {
        const t = tOf(e), [sa, sb] = solid.get(e);
        for (const [p, ok] of [[lo(e), sa < E], [hi(e), sb > e.len - E]]) {
          if (!ok) continue;
          for (const q of live) {
            if (q === e || q.kind === "part" || vert(q) !== vert(e) || Math.abs(lineOf(q) - lineOf(e)) > E) continue;
            if (Math.abs(lo(q) - p) > E && Math.abs(hi(q) - p) > E) continue;
            const T = tOf(q);
            if (T > t + E) { const so = OUT[q.face] || 0; const v = -so * (T - t) / 2; if (Math.abs(v) > Math.abs(o)) o = v; }
          }
        }
        if (al === "flip") o = -o;
      }
    }
    off.set(e, o);
  }
  for (const e of cw) if (!off.has(e)) off.set(e, 0);

  // where a wall is solid, cut by the openings on its line
  const cutBy = (e, a, b) => {
    let segs = [[a, b]];
    for (const op of opts.openings || []) {
      const ov = Math.abs(op.x1 - op.x2) < E;
      if (ov !== vert(e)) continue;
      if (Math.abs((ov ? op.x1 : op.y1) - lineOf(e)) > E) continue;
      const s = Math.min(ov ? op.y1 : op.x1, ov ? op.y2 : op.x2) - lo(e), t = Math.max(ov ? op.y1 : op.x1, ov ? op.y2 : op.x2) - lo(e);
      segs = segs.flatMap(([p, q]) => (t <= p + E || s >= q - E ? [[p, q]] : [[p, s], [t, q]].filter(([x, y]) => y - x > E)));
    }
    return segs;
  };
  // how far an end at plan point P, going along d (+1 / -1), runs into the walls it meets across it
  const reach = (e, P, d) => {
    let best = 0;
    for (const q of live.concat(cw)) {
      if (q === e || vert(q) === vert(e)) continue;
      const along = vert(e) ? P[0] : P[1];          // where P is along q
      if (along < lo(q) - E || along > hi(q) + E) continue;
      const qline = lineOf(q) + (off.get(q) || 0), pc = vert(e) ? P[1] : P[0];
      if (Math.abs(lineOf(q) - pc) > E) continue;
      const tq = tOf(q);
      let far = qline + d * tq / 2;
      if (q.facade === "cw" && e.kind === "part") far = qline - (OUT[q.face] || 0) * tq / 2;   // a partition stops at the curtain wall's inside
      const r = (far - pc) * d;
      if (r > best) best = r;
    }
    return best;
  };
  const MAT = (e) => (e.kind === "part" ? "blk" : e.kind === "ext" && e.facade === "pc" ? "pc" : e.facade === "cw" ? "cw" : "rc");
  const rects = [];
  for (const e of live) {
    const t = tOf(e), [a, b] = solid.get(e), c = lineOf(e) + off.get(e), v = vert(e);
    for (const [p, q] of cutBy(e, a, b)) {
      const s0 = lo(e) + p, s1 = lo(e) + q;
      const P0 = v ? [e.x1, s0] : [s0, e.y1], P1 = v ? [e.x1, s1] : [s1, e.y1];
      const x0 = p < E && a < E ? reach(e, P0, -1) : 0, x1 = q > e.len - E && b > e.len - E ? reach(e, P1, 1) : 0;
      const r = v ? { x0: c - t / 2, x1: c + t / 2, y0: s0 - x0, y1: s1 + x1 } : { x0: s0 - x0, x1: s1 + x1, y0: c - t / 2, y1: c + t / 2 };
      rects.push(Object.assign(r, { m: MAT(e), key: e.key }));
    }
  }
  return { rects, off, lines: outlineOf(rects) };
}

/* the union's lines: [{x1, y1, x2, y2, k}] k = the filled material on the edge, "join" between two materials */
const PRI = { rc: 3, pc: 3, blk: 1 };
export function outlineOf(rects) {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]).map((v) => +v.toFixed(5)))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]).map((v) => +v.toFixed(5)))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1, cell = new Array(nx * ny).fill(null);
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ny; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      let m = null;
      for (const r of rects) if (cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1 && (!m || PRI[r.m] > PRI[m])) m = r.m;
      cell[i * ny + j] = m;
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : cell[i * ny + j]);
  const kind = (A, B) => (A && !B ? A : B && !A ? B : A && B && A !== B ? "join" : null);
  const out = [];
  const add = (x1, y1, x2, y2, k) => {
    const last = out[out.length - 1];
    if (last && last.k === k && ((x1 === x2 && last.x1 === last.x2 && last.x1 === x1 && Math.abs(last.y2 - y1) < E) || (y1 === y2 && last.y1 === last.y2 && last.y1 === y1 && Math.abs(last.x2 - x1) < E))) { last.x2 = x2; last.y2 = y2; return; }
    out.push({ x1, y1, x2, y2, k });
  };
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) { const k = kind(at(i - 1, j), at(i, j)); if (k) add(xs[i], ys[j], xs[i], ys[j + 1], k); }
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) { const k = kind(at(i, j - 1), at(i, j)); if (k) add(xs[i], ys[j], xs[i + 1], ys[j], k); }
  return out;
}
