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

/* the cells of a grid (xs, ys sorted) each rectangle covers: binary search its span, visit those cells only */
export function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v - 1e-9) lo = m + 1; else hi = m; } return lo; }
export function rasterise(xs, ys, rects, visit) {
  const ny = ys.length - 1;
  for (let k = 0; k < rects.length; k++) {
    const r = rects[k];
    const i0 = lowerBound(xs, r.x0), i1 = lowerBound(xs, r.x1), j0 = lowerBound(ys, r.y0), j1 = lowerBound(ys, r.y1);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) visit(i * ny + j, r, k);
  }
}
const uniq = (v) => { const a = v.map((q) => +q.toFixed(5)).sort((x, y) => x - y); const o = []; for (const q of a) if (!o.length || q - o[o.length - 1] > 1e-9) o.push(q); return o; };

/* the union's lines: [{x1, y1, x2, y2, k}] k = the filled material on the edge, "join" between two materials */
const PRI = { rc: 3, pc: 3, blk: 1 };
const MI = ["", "blk", "rc", "pc"], MK = { blk: 1, rc: 2, pc: 3 };
export function outlineOf(rects) {
  if (!rects.length) return [];
  const xs = uniq(rects.flatMap((r) => [r.x0, r.x1])), ys = uniq(rects.flatMap((r) => [r.y0, r.y1]));
  const nx = xs.length - 1, ny = ys.length - 1, cell = new Uint8Array(Math.max(0, nx * ny));
  // the highest-priority material on each cell
  rasterise(xs, ys, rects, (c, r) => { const m = MK[r.m] || 1, cur = cell[c]; if (!cur || PRI[r.m] > PRI[MI[cur]]) cell[c] = m; });
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : MI[cell[i * ny + j]] || null);
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

/* ---------- the walls of a unit with polygon rooms ----------
   each wall a band along its edge (centred), cut by the openings on it; where walls meet at a corner each end meets its
   neighbours' faces (a mitre at a corner, the stem of a tee to the bar's face, straight on where two run on in line);
   -> {rects (the bands square to the axes, for the clear sizes), polys [{pts, m, key}], off (none), lines (the union's
   outline: [{x1, y1, x2, y2, k}])} */
export function polyWallGeom(u, edges, opts) {
  const tOf = opts.tOf;
  const live = edges.filter((e) => !opts.isOpen(e) && !(e.kind === "ext" && e.facade === "cw" && !opts.withCw));
  const cw = edges.filter((e) => e.kind === "ext" && e.facade === "cw");
  const all = live.concat(cw.filter((e) => !live.includes(e)));
  const MAT = (e) => (e.kind === "part" ? "blk" : e.kind === "ext" && e.facade === "pc" ? "pc" : e.facade === "cw" ? "cw" : "rc");
  const geo = (e) => { const L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1e-9, d = [(e.x2 - e.x1) / L, (e.y2 - e.y1) / L]; return { p: [e.x1, e.y1], q: [e.x2, e.y2], L, d, lf: [-d[1], d[0]] }; };
  const G = new Map(all.map((e) => [e, geo(e)]));
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
  // the walls at point V: each as the way it leaves V {e, u (unit, away from V), h (half thickness)}
  const at = (V, self) => {
    const out = [];
    for (const q of all) {
      if (q === self) continue;
      const g = G.get(q), h = tOf(q) / 2;
      if (near(g.p, V)) out.push({ e: q, u: g.d, h });
      else if (near(g.q, V)) out.push({ e: q, u: [-g.d[0], -g.d[1]], h });
      else {
        const s = (V[0] - g.p[0]) * g.d[0] + (V[1] - g.p[1]) * g.d[1], off = (V[0] - g.p[0]) * g.lf[0] + (V[1] - g.p[1]) * g.lf[1];
        if (Math.abs(off) < 1e-4 && s > 1e-4 && s < g.L - 1e-4) out.push({ e: q, u: g.d, h }, { e: q, u: [-g.d[0], -g.d[1]], h });
      }
    }
    return out;
  };
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const meet = (p1, d1, p2, d2) => { const den = cross(d1, d2); if (Math.abs(den) < 1e-9) return null; const t = cross([p2[0] - p1[0], p2[1] - p1[1]], d2) / den; return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]; };
  const ang = (a, b) => { const v = Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]); return v <= 1e-9 ? v + 2 * Math.PI : v; };   // from a round to b, (0, 2pi]
  // an end at V, the wall leaving V along u (half thickness h): its two corner points [on the left of u, on the right]
  const endAt = (e, V, uu, h) => {
    const L = [-uu[1], uu[0]];
    let O = at(V, e);
    const lp = [V[0] + L[0] * h, V[1] + L[1] * h], rp = [V[0] - L[0] * h, V[1] - L[1] * h];
    // an outer or party wall joins the outer and party walls there (a partition meeting the corner stops at their faces)
    if (e.kind !== "part" && O.some((o) => o.e.kind !== "part")) O = O.filter((o) => o.e.kind !== "part");
    if (!O.length) return [lp, rp];
    // one running straight on from it: square across (the stem of a tee meets the bar's face)
    if (O.some((o) => o.u[0] * uu[0] + o.u[1] * uu[1] < -0.99999)) return [lp, rp];
    // the neighbour turning left of u first, and the one turning right first
    let le = null, ri = null;
    for (const o of O) { const a = ang(uu, o.u); if (!le || a < le.a) le = Object.assign({ a }, o); if (!ri || a > ri.a) ri = Object.assign({ a }, o); }
    const lim = 3 * Math.max(h, le.h, ri.h);
    const side = (nb, P0, sg) => {
      if (!nb || Math.abs(Math.sin(nb.a)) < 1e-6) return P0;          // straight on (or back on itself): square across
      const NL = [-nb.u[1], nb.u[0]];
      // the neighbour's face toward this wedge: its right face for the one on our left, its left face for the one on our right
      const P = [V[0] - sg * NL[0] * nb.h, V[1] - sg * NL[1] * nb.h];
      const X = meet(P0, uu, P, nb.u);
      if (!X || Math.hypot(X[0] - V[0], X[1] - V[1]) > lim) return P0;
      return X;
    };
    return [side(le, lp, 1), side(ri, rp, -1)];
  };
  const polys = [], rects = [];
  for (const e of live) {
    const g = G.get(e), t = tOf(e), h = t / 2, [a, b] = e.kind === "part" ? opts.solid(e) : [0, g.L];
    // cut by the openings along it
    let segs = [[a, b]];
    for (const op of opts.openings || []) {
      const P = [op.x1, op.y1], Q = [op.x2, op.y2];
      const oP = (P[0] - g.p[0]) * g.lf[0] + (P[1] - g.p[1]) * g.lf[1], oQ = (Q[0] - g.p[0]) * g.lf[0] + (Q[1] - g.p[1]) * g.lf[1];
      if (Math.abs(oP) > 1e-4 || Math.abs(oQ) > 1e-4) continue;
      const s1 = (P[0] - g.p[0]) * g.d[0] + (P[1] - g.p[1]) * g.d[1], s2 = (Q[0] - g.p[0]) * g.d[0] + (Q[1] - g.p[1]) * g.d[1];
      const s = Math.min(s1, s2), tt = Math.max(s1, s2);
      segs = segs.flatMap(([p0, q0]) => (tt <= p0 + 1e-6 || s >= q0 - 1e-6 ? [[p0, q0]] : [[p0, s], [tt, q0]].filter(([x, y]) => y - x > 1e-6)));
    }
    for (const [p0, q0] of segs) {
      const S = [g.p[0] + g.d[0] * p0, g.p[1] + g.d[1] * p0], T = [g.p[0] + g.d[0] * q0, g.p[1] + g.d[1] * q0], lf = g.lf;
      // the start: leaving S along d (left = lf); the end: leaving T along -d (its left = -lf)
      const [sL, sR] = p0 < 1e-6 && a < 1e-6 ? endAt(e, S, g.d, h) : [[S[0] + lf[0] * h, S[1] + lf[1] * h], [S[0] - lf[0] * h, S[1] - lf[1] * h]];
      const [tL, tR] = q0 > g.L - 1e-6 && b > g.L - 1e-6 ? endAt(e, T, [-g.d[0], -g.d[1]], h) : [[T[0] - lf[0] * h, T[1] - lf[1] * h], [T[0] + lf[0] * h, T[1] + lf[1] * h]];
      // around: the start's left, the end's right (the same face), the end's left, the start's right
      const pts = [sL, tR, tL, sR];
      polys.push({ pts, m: MAT(e), key: e.key });
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const axis = !e.angled && pts.every((q) => xs.some((x) => Math.abs(x - q[0]) < 1e-9)) && new Set(xs.map((x) => x.toFixed(5))).size === 2 && new Set(ys.map((y) => y.toFixed(5))).size === 2;
      if (axis) rects.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), m: MAT(e), key: e.key });
    }
  }
  return { rects, polys, off: new Map(), lines: polyLines(polys) };
}
/* the outline of a union of convex polygons by material: each side split where other polygons' sides cross it, each piece
   kept where one side of it is filled and the other not (k = that material) or two materials meet ("join") */
export function polyLines(polys) {
  const PRI2 = { rc: 3, pc: 3, cw: 2, blk: 1 };
  const inside = (P, poly) => { const p = poly.pts; let sg = 0; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length], z = (b[0] - a[0]) * (P[1] - a[1]) - (b[1] - a[1]) * (P[0] - a[0]); if (Math.abs(z) < 1e-12) continue; const s = Math.sign(z); if (!sg) sg = s; else if (s !== sg) return false; } return true; };
  const matAt = (P) => { let best = null; for (const q of polys) if (inside(P, q) && (!best || PRI2[q.m] > PRI2[best])) best = q.m; return best; };
  const out = [], seen = new Set();
  for (const A of polys) {
    const p = A.pts;
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-7) continue;
      const ts = [0, 1];
      for (const B of polys) {
        if (B === A) continue;
        const q = B.pts;
        for (let j = 0; j < q.length; j++) {
          const c = q[j], d = q[(j + 1) % q.length], ex = d[0] - c[0], ey = d[1] - c[1], den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) {
            // along the same line: its ends split this side
            if (Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / L < 1e-6) for (const P of [c, d]) { const t = ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / (L * L); if (t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
            continue;
          }
          const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den, s = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
          if (t > 1e-6 && t < 1 - 1e-6 && s > -1e-6 && s < 1 + 1e-6) ts.push(t);
        }
      }
      ts.sort((x, y) => x - y);
      const nx = -dy / L, ny = dx / L, eps = 2e-4;
      for (let i = 0; i < ts.length - 1; i++) {
        if (ts[i + 1] - ts[i] < 1e-7) continue;
        const m = [a[0] + dx * (ts[i] + ts[i + 1]) / 2, a[1] + dy * (ts[i] + ts[i + 1]) / 2];
        const M1 = matAt([m[0] + nx * eps, m[1] + ny * eps]), M2 = matAt([m[0] - nx * eps, m[1] - ny * eps]);
        const kk = M1 && !M2 ? M1 : M2 && !M1 ? M2 : M1 && M2 && M1 !== M2 ? "join" : null;
        if (!kk) continue;
        const P = [a[0] + dx * ts[i], a[1] + dy * ts[i]], Q = [a[0] + dx * ts[i + 1], a[1] + dy * ts[i + 1]];
        const key = [P, Q].map((z) => z[0].toFixed(4) + "," + z[1].toFixed(4)).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x1: P[0], y1: P[1], x2: Q[0], y2: Q[1], k: kk === "cw" ? "rc" : kk });
      }
    }
  }
  return out;
}
