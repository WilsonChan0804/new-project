/* Areas without clicking every corner (the Area tool's other ways):
 *
 *   fillAt(L, p, opt)    Click inside: the closed outline round a point,
 *                        from the sheet's own lines (sheetsnap.js). Gaps
 *                        narrower than opt.gap (a doorway) are closed as
 *                        if drawn across; furniture and text inside are
 *                        ignored (only the outer edge counts). The edges
 *                        are then laid onto the drawing's lines, so the
 *                        corners are the drawing's corners, not a pixel off.
 *   fromLines(lines)     Pick lines: each line picked is trimmed or
 *                        extended to meet the next; the corners where they
 *                        meet are the outline.
 *   offset(pts, d)       The outline moved out (d > 0) or in by d, with
 *                        square corners: to the inside face, the centre
 *                        line or the outside face of the walls.
 *   area(pts), net(item) the area, with added regions and holes.
 *
 * All in paper mm; plain functions, so a test runs them in Node.
 */

const MAX_CELLS = 4.5e6;

/* ---------------------------------------------------------- polygons */

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
export const area = (pts) => Math.abs(signedArea(pts));

/* The area of an Area markup: its outline, plus the regions added, less the holes */
export function net(item) {
  let a = item.points_mm && item.points_mm.length > 2 ? area(item.points_mm) : 0;
  for (const l of item.loops_mm || []) a += (l.sub ? -1 : 1) * area(l.pts || []);
  return Math.max(0, a);
}

/* The crossing of the infinite lines through a-b and c-d, or null when parallel */
export function meet(a, b, c, d) {
  const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1], x3 = c[0], y3 = c[1], x4 = d[0], y4 = d[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const l = Math.hypot(x2 - x1, y2 - y1) * Math.hypot(x4 - x3, y4 - y3);
  if (Math.abs(den) < 1e-9 * l + 1e-15) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/* Pick lines: lines [[x1, y1, x2, y2] ...] in order round the outline; the
   corners are where each meets the next (the last meets the first). Two
   lines in a row that never meet (parallel): the join goes straight
   across from the end of one to the start of the next. */
export function fromLines(lines) {
  const n = lines.length;
  if (n < 3) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const q = meet([a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]);
    if (q) out.push(q);
    else {
      // parallel: the nearer ends of the two
      const ends = [[a[0], a[1]], [a[2], a[3]]], bs = [[b[0], b[1]], [b[2], b[3]]];
      let best = null, bd = Infinity;
      for (const e of ends) for (const f of bs) { const d = Math.hypot(e[0] - f[0], e[1] - f[1]); if (d < bd) { bd = d; best = [e, f]; } }
      out.push(best[0], best[1]);
    }
  }
  return out;
}

/* Moved out by d (paper mm; negative: in), corners kept square */
export function offset(pts, d) {
  if (!pts || pts.length < 3 || !d) return pts ? pts.map((p) => p.slice()) : pts;
  const ccw = signedArea(pts) > 0;
  const n = pts.length;
  // each edge moved along its outward normal
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;      // right of a->b
    if (!ccw) { nx = -nx; ny = -ny; }                          // outward either way
    edges.push([[a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d]]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const e0 = edges[(i + n - 1) % n], e1 = edges[i];
    const q = meet(e0[0], e0[1], e1[0], e1[1]);
    // a very sharp corner: its point would fly off, so it is cut at twice d
    if (!q || Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) > Math.abs(d) * 4) out.push(e0[1], e1[0]);
    else out.push(q);
  }
  return out;
}

/* An arc through three points: from a, passing m, to b, as points along it
   (about 0.6 mm apart, 6 to 96 pieces). In line: just a to b. */
export function arc3(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return [a.slice(), b.slice()];
  const A2 = a[0] * a[0] + a[1] * a[1], M2 = m[0] * m[0] + m[1] * m[1], B2 = b[0] * b[0] + b[1] * b[1];
  const cx = (A2 * (m[1] - b[1]) + M2 * (b[1] - a[1]) + B2 * (a[1] - m[1])) / d;
  const cy = (A2 * (b[0] - m[0]) + M2 * (a[0] - b[0]) + B2 * (m[0] - a[0])) / d;
  const R = Math.hypot(a[0] - cx, a[1] - cy);
  const ang = (p) => Math.atan2(p[1] - cy, p[0] - cx);
  const a0 = ang(a), am = ang(m), a1 = ang(b);
  const TAU = Math.PI * 2;
  const ccw = (x) => ((x % TAU) + TAU) % TAU;
  // the way round from a to b that passes m
  let sweep = ccw(a1 - a0);
  if (ccw(am - a0) > sweep) sweep -= TAU;
  const n = Math.max(6, Math.min(96, Math.ceil(Math.abs(sweep) * R / 0.6)));
  const out = [a.slice()];
  for (let i = 1; i < n; i++) { const t = a0 + sweep * i / n; out.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); }
  out.push(b.slice());
  return out;
}

/* The lines of the dimensions on a sheet: each dimension line (a line
 * carrying two or more tick marks), its ticks (short lines across it at
 * about 45 degrees, their middle on it) and its extension lines (square to
 * it, through a tick). around(p, tol, fn) calls fn(s) for the lines near p.
 * Returns a flag per line (1: part of a dimension). Paper mm. */
export function dimensionParts(L, around) {
  const n = L.length / 4, flag = new Uint8Array(n);
  const len = (s) => Math.hypot(L[4 * s + 2] - L[4 * s], L[4 * s + 3] - L[4 * s + 1]);
  const dir = (s) => { const l = len(s) || 1; return [(L[4 * s + 2] - L[4 * s]) / l, (L[4 * s + 3] - L[4 * s + 1]) / l]; };
  const distSeg = (p, s) => {
    const x1 = L[4 * s], y1 = L[4 * s + 1], dx = L[4 * s + 2] - x1, dy = L[4 * s + 3] - y1, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2));
    return Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
  };
  const ticksOn = new Map();          // dimension line -> [tick, its middle]
  for (let t = 0; t < n; t++) {
    const lt = len(t);
    if (lt < 0.6 || lt > 6) continue;
    const m = [(L[4 * t] + L[4 * t + 2]) / 2, (L[4 * t + 1] + L[4 * t + 3]) / 2], ut = dir(t);
    around(m, 0.2, (s) => {
      if (s === t || len(s) < lt * 1.5) return;
      const us = dir(s);
      const sin = Math.abs(ut[0] * us[1] - ut[1] * us[0]);
      if (sin < 0.42 || sin > 0.91) return;                 // 25 - 65 degrees
      if (distSeg(m, s) > 0.12) return;
      let a = ticksOn.get(s);
      if (!a) ticksOn.set(s, a = []);
      if (!a.some((x) => x[0] === t)) a.push([t, m]);
    });
  }
  for (const [s, ticks] of ticksOn) {
    if (ticks.length < 2) continue;
    /* A dimension line ends just past its outer ticks; a wall that two
       dimensions cross runs on far beyond them */
    const us = dir(s), x0 = L[4 * s], y0 = L[4 * s + 1];
    const ts = ticks.map(([, m]) => (m[0] - x0) * us[0] + (m[1] - y0) * us[1]);
    if (Math.min(...ts) > 6 || len(s) - Math.max(...ts) > 6) continue;
    flag[s] = 1;
    for (const [t, m] of ticks) {
      flag[t] = 1;
      // the extension line through this tick point: square to the dimension line
      around(m, 0.2, (w) => {
        if (w === s || flag[w]) return;
        const uw = dir(w);
        if (Math.abs(uw[0] * us[0] + uw[1] * us[1]) > 0.17) return;
        // through the tick point, and ending just past it (a wall would run on)
        const e0 = Math.hypot(L[4 * w] - m[0], L[4 * w + 1] - m[1]), e1 = Math.hypot(L[4 * w + 2] - m[0], L[4 * w + 3] - m[1]);
        if (distSeg(m, w) < 0.15 && Math.min(e0, e1) < 6) flag[w] = 1;
      });
    }
  }
  return flag;
}

/* Corners only: the same point twice, and points in line with their neighbours, dropped */
export function tidy(pts, tol) {
  tol = tol || 0.005;
  let out = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4; });
  for (let pass = 0; pass < 3 && out.length > 3; pass++) {
    const keep = out.filter((p, i) => {
      const q = out[(i + out.length - 1) % out.length], r = out[(i + 1) % out.length];
      const L = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1e-9;
      return Math.abs((r[0] - q[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (r[1] - q[1])) / L > tol;
    });
    if (keep.length === out.length || keep.length < 3) break;
    out = keep;
  }
  return out;
}

/* Fewer points: corners kept, the points along a straight edge dropped */
export function simplify(pts, tol) {
  if (pts.length < 4) return pts.slice();
  // Douglas-Peucker on the closed ring, split at its two farthest points
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; b = i; }
  }
  const dp = (P) => {
    if (P.length < 3) return P;
    const s = P[0], e = P[P.length - 1];
    const L = Math.hypot(e[0] - s[0], e[1] - s[1]) || 1e-9;
    let k = -1, md = -1;
    for (let i = 1; i < P.length - 1; i++) {
      const d = Math.abs((e[0] - s[0]) * (s[1] - P[i][1]) - (s[0] - P[i][0]) * (e[1] - s[1])) / L;
      if (d > md) { md = d; k = i; }
    }
    if (md <= tol) return [s, e];
    return dp(P.slice(0, k + 1)).slice(0, -1).concat(dp(P.slice(k)));
  };
  const r1 = dp(pts.slice(a, b + 1)), r2 = dp(pts.slice(b).concat([pts[0]]));
  const out = r1.slice(0, -1).concat(r2.slice(0, -1));
  // a last pass: three points in a line
  return out.filter((p, i) => {
    const q = out[(i + out.length - 1) % out.length], r = out[(i + 1) % out.length];
    const L = Math.hypot(r[0] - q[0], r[1] - q[1]) || 1e-9;
    return Math.abs((r[0] - q[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (r[1] - q[1])) / L > tol * 0.5;
  });
}

/* ---------------------------------------------------- click inside */

/* Chamfer distance (in cells) from every cell to the nearest set cell */
function distance(mask, W, H) {
  const D = new Float32Array(W * H);
  const INF = 1e9, S2 = Math.SQRT2;
  for (let k = 0; k < D.length; k++) D[k] = mask[k] ? 0 : INF;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let d = D[k];
    if (!d) continue;
    if (i > 0) d = Math.min(d, D[k - 1] + 1);
    if (j > 0) {
      d = Math.min(d, D[k - W] + 1);
      if (i > 0) d = Math.min(d, D[k - W - 1] + S2);
      if (i < W - 1) d = Math.min(d, D[k - W + 1] + S2);
    }
    D[k] = d;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let d = D[k];
    if (!d) continue;
    if (i < W - 1) d = Math.min(d, D[k + 1] + 1);
    if (j < H - 1) {
      d = Math.min(d, D[k + W] + 1);
      if (i < W - 1) d = Math.min(d, D[k + W + 1] + S2);
      if (i > 0) d = Math.min(d, D[k + W - 1] + S2);
    }
    D[k] = d;
  }
  return D;
}

/* The outer edge of a filled region of cells, as a ring of cell corners */
function outline(fill, W, H) {
  // the first filled cell in reading order: its top-left corner is on the outer edge
  let k0 = -1;
  for (let k = 0; k < fill.length; k++) if (fill[k]) { k0 = k; break; }
  if (k0 < 0) return null;
  const f = (i, j) => i >= 0 && j >= 0 && i < W && j < H && fill[j * W + i] === 1;
  // walk the corners with the region on the right (j grows downwards here)
  const sx = k0 % W, sy = (k0 - sx) / W;
  let x = sx, y = sy, dir = 0;                     // 0 right, 1 down, 2 left, 3 up
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const ring = [[x, y]];
  for (let guard = 0; guard < 8 * (W + H) * 50; guard++) {
    // the four cells round corner (x, y): a = up-left, b = up-right, c = down-left, d = down-right
    const tryDir = (d) => {
      // moving in d keeps a filled cell on the right and an empty one on the left
      if (d === 0) return f(x, y) && !f(x, y - 1);
      if (d === 1) return f(x - 1, y) && !f(x, y);
      if (d === 2) return f(x - 1, y - 1) && !f(x - 1, y);
      return f(x, y - 1) && !f(x - 1, y - 1);
    };
    // prefer a right turn, then straight, then left (keeps to the outer edge)
    let nd = -1;
    for (const d of [(dir + 1) % 4, dir, (dir + 3) % 4, (dir + 2) % 4]) if (tryDir(d)) { nd = d; break; }
    if (nd < 0) break;
    dir = nd;
    x += DX[dir]; y += DY[dir];
    if (x === sx && y === sy) break;
    const last = ring[ring.length - 1], prev = ring[ring.length - 2];
    // only the corners of the walk
    if (prev && (prev[0] === last[0] && last[0] === x || prev[1] === last[1] && last[1] === y)) ring[ring.length - 1] = [x, y];
    else ring.push([x, y]);
  }
  return ring;
}

/* The click-inside outline: { pts } in paper mm, or { error } */
export function fillAt(L, p, opt) {
  opt = opt || {};
  const r = fillWith(L, p, opt);
  // a shape narrower than the gap (a column, a duct) is filled solid by the
  // closing: inside it, its own outline without closing gaps
  if (!r.pts && (r.error === "on-line" || r.error === "small") && opt.gap > 0) {
    const r0 = fillWith(L, p, Object.assign({}, opt, { gap: 0 }));
    if (r0.pts) return r0;
  }
  return r;
}

function fillWith(L, p, opt) {
  const gap = Math.max(0, opt.gap || 0);        // paper mm: openings narrower than this close
  const page = opt.page || null;                // [w, h] paper mm: the farthest the search goes
  const unit = opt.unit || 10;                  // paper mm per metre in the building (10 at 1:100)
  let half = opt.start || Math.max(40, gap * 6, unit * 6);
  for (let round = 0; round < 6; round++) {
    const x0 = p[0] - half, y0 = p[1] - half, x1 = p[0] + half, y1 = p[1] + half;
    const r = tryWindow(L, p, [x0, y0, x1, y1], gap, unit);
    if (r.pts || r.error !== "open") return r;
    if (page && x0 <= 0 && y0 <= 0 && x1 >= page[0] && y1 >= page[1]) break;
    half *= 2.2;
  }
  return { error: "open" };
}

function tryWindow(L, p, box, gap, unit) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  let c = Math.max(0.05, Math.sqrt((w * h) / MAX_CELLS));
  // fine enough for the gap to be a few cells, coarse enough to be quick
  c = Math.min(c, Math.max(0.05, gap / 6 || c));
  if ((w / c) * (h / c) > MAX_CELLS) c = Math.sqrt((w * h) / MAX_CELLS);
  // the doorways: lines across them, from the jambs either side (no rounding of the room's corners)
  const win = [];
  for (let s = 0; s < L.length; s += 4) {
    const ax = L[s], ay = L[s + 1], bx = L[s + 2], by = L[s + 3];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    win.push(ax, ay, bx, by);
  }
  const bridges = gap > 0 ? openings(win, gap, unit) : [];
  L = bridges.length ? Float64Array.from(win.concat(bridges)) : win;
  const W = Math.ceil(w / c) + 1, H = Math.ceil(h / c) + 1;
  // j grows downwards (rows from the top of the window)
  const cell = (u, v) => [Math.floor((u - x0) / c), Math.floor((y1 - v) / c)];
  const wall = new Uint8Array(W * H);
  const n = L.length / 4;
  const near = [];                     // the lines in the window, for laying the edges on
  for (let s = 0; s < n; s++) {
    const ax = L[4 * s], ay = L[4 * s + 1], bx = L[4 * s + 2], by = L[4 * s + 3];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    near.push(ax, ay, bx, by);
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
    let pi = -1, pj = -1;
    for (let t = 0; t <= steps; t++) {
      const [i, j] = cell(ax + (bx - ax) * t / steps, ay + (by - ay) * t / steps);
      if (i === pi && j === pj) continue;
      if (i >= 0 && j >= 0 && i < W && j < H) wall[j * W + i] = 1;
      // a diagonal step: the cell beside it too, so nothing leaks between the two
      if (pi >= 0 && i !== pi && j !== pj && pi >= 0 && pi < W && j >= 0 && j < H) wall[j * W + pi] = 1;
      pi = i; pj = j;
    }
  }
  /* Doorways are bridged above. What is left to close: slivers where
     lines nearly meet (about 30 mm in the building) - not the gap, which
     rounded every corner and joined up dashed lines. */
  let block = wall;
  const r = gap > 0 ? Math.max(1, (unit * 0.03) / c) : 0;
  if (r >= 1) {
    /* Small loose things - a chair, a stroke of text, a door leaf - are
       left out first: closed up to a wall they would cut a piece off the
       room. Walls hang together, so they stay. (Inside the room they are
       islands, which never count anyway.) */
    const ci = cell(p[0], p[1]);
    dropSmall(wall, W, H, Math.min(gap * 2, unit * 1.5) / c, ci[0], ci[1]);
    const d1 = distance(wall, W, H);
    const grown = new Uint8Array(W * H);
    for (let k = 0; k < grown.length; k++) grown[k] = d1[k] <= r ? 1 : 0;
    const out = new Uint8Array(W * H);
    for (let k = 0; k < out.length; k++) out[k] = grown[k] ? 0 : 1;
    const d2 = distance(out, W, H);
    block = new Uint8Array(W * H);
    for (let k = 0; k < block.length; k++) block[k] = wall[k] || d2[k] > r - 0.5 ? (grown[k] ? 1 : 0) : 0;
  }
  // flood from the click
  const [si, sj] = cell(p[0], p[1]);
  if (si < 0 || sj < 0 || si >= W || sj >= H) return { error: "outside" };
  if (block[sj * W + si]) return { error: "on-line" };
  const fill = new Uint8Array(W * H);
  const st = [sj * W + si];
  fill[st[0]] = 1;
  let touches = false, count = 0;
  while (st.length) {
    const k = st.pop();
    count++;
    const i = k % W, j = (k - i) / W;
    if (i === 0 || j === 0 || i === W - 1 || j === H - 1) { touches = true; break; }
    for (const nk of [k - 1, k + 1, k - W, k + W]) if (!fill[nk] && !block[nk]) { fill[nk] = 1; st.push(nk); }
  }
  if (touches) return { error: "open" };
  if (count < 4) return { error: "small" };
  const ring = outline(fill, W, H);
  if (!ring || ring.length < 3) return { error: "small" };
  // cell corners -> paper mm; the region stops half a line short of the wall: grown back by half a cell
  let pts = ring.map(([i, j]) => [x0 + i * c, y1 - j * c]);
  pts = simplify(pts, c * 1.6);
  if (pts.length < 3) return { error: "small" };
  pts = offset(pts, c * 0.5);
  pts = layOnLines(pts, near, c * 2.5, r * c);
  pts = tidy(simplify(pts, c * 0.3));
  return { pts, cell: c };
}

/* Lines across the doorways (and other openings up to `gap` wide), from
 * what a plan draws either side of one:
 *   - two jambs: short lines, joined at both ends, parallel and facing
 *     each other across the opening: joined end to end, one line along
 *     each face of the wall;
 *   - a wall face that stops and carries on, in line, after the opening:
 *     its two free ends joined.
 * A line free at both ends (a loose dash, a stroke of text) never bridges.
 * All in paper mm; unit = paper mm per metre in the building. */
export function openings(S, gap, unit) {
  const n = S.length / 4;
  const eps = Math.max(0.02, unit * 0.005);      // ends this close meet (5 mm in the building)
  const maxJamb = unit * 0.7, minOpen = unit * 0.25, minFace = unit * 0.25;
  const out = [];
  if (!n) return out;
  // ends by place, and lines by place, to tell which ends are joined
  const G = Math.max(eps * 8, gap);
  const ends = new Map(), segs = new Map();
  const k = (x, y, g) => Math.floor(x / g) * 1048576 + Math.floor(y / g);
  for (let s = 0; s < n; s++) {
    for (const e of [0, 1]) {
      const x = S[4 * s + 2 * e], y = S[4 * s + 2 * e + 1], q = k(x, y, eps * 4);
      let a = ends.get(q); if (!a) ends.set(q, a = []); a.push(s * 2 + e);
    }
    const x0 = Math.min(S[4 * s], S[4 * s + 2]), x1 = Math.max(S[4 * s], S[4 * s + 2]);
    const y0 = Math.min(S[4 * s + 1], S[4 * s + 3]), y1 = Math.max(S[4 * s + 1], S[4 * s + 3]);
    if ((x1 - x0) / G * (y1 - y0) / G > 400) continue;
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(y0 / G); j <= Math.floor(y1 / G); j++) {
      const q = i * 1048576 + j; let a = segs.get(q); if (!a) segs.set(q, a = []); a.push(s);
    }
  }
  const P = (s, e) => [S[4 * s + 2 * e], S[4 * s + 2 * e + 1]];
  const len = (s) => Math.hypot(S[4 * s + 2] - S[4 * s], S[4 * s + 3] - S[4 * s + 1]);
  const distSeg = (p, s) => {
    const x1 = S[4 * s], y1 = S[4 * s + 1], dx = S[4 * s + 2] - x1, dy = S[4 * s + 3] - y1, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / l2));
    return Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
  };
  const near = (p, g) => {
    const out2 = new Set();
    for (let i = Math.floor((p[0] - g) / G); i <= Math.floor((p[0] + g) / G); i++)
      for (let j = Math.floor((p[1] - g) / G); j <= Math.floor((p[1] + g) / G); j++) for (const s of segs.get(i * 1048576 + j) || []) out2.add(s);
    return out2;
  };
  // is this end of line s joined to another line (its end, or along it)?
  const joined = new Uint8Array(n * 2);
  for (let s = 0; s < n; s++) for (const e of [0, 1]) {
    const p = P(s, e);
    let j = false;
    const q0 = Math.floor(p[0] / (eps * 4)), q1 = Math.floor(p[1] / (eps * 4));
    for (let di = -1; di <= 1 && !j; di++) for (let dj = -1; dj <= 1 && !j; dj++) {
      for (const t2 of ends.get((q0 + di) * 1048576 + q1 + dj) || []) {
        const t = t2 >> 1; if (t === s) continue;
        const r = P(t, t2 & 1); if (Math.hypot(r[0] - p[0], r[1] - p[1]) <= eps) { j = true; break; }
      }
    }
    if (!j) for (const t of near(p, eps)) if (t !== s && distSeg(p, t) <= eps) { j = true; break; }
    joined[s * 2 + e] = j ? 1 : 0;
  }
  const dir = (s) => { const l = len(s) || 1; return [(S[4 * s + 2] - S[4 * s]) / l, (S[4 * s + 3] - S[4 * s + 1]) / l]; };
  const parallel = (a, b) => { const u = dir(a), v = dir(b); return Math.abs(u[0] * v[1] - u[1] * v[0]) < 0.05; };
  const seen = new Set();
  const bridge = (p, q) => {
    const key = [p, q].map((r) => r[0].toFixed(3) + "," + r[1].toFixed(3)).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p[0], p[1], q[0], q[1]);
  };
  // 1. jambs facing each other
  const jambs = [];
  for (let s = 0; s < n; s++) { const l = len(s); if (l > eps && l <= maxJamb && joined[2 * s] && joined[2 * s + 1]) jambs.push(s); }
  for (const a of jambs) {
    const pa = P(a, 0), pb = P(a, 1), u = dir(a), la = len(a);
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    for (const b of near(mid, gap)) {
      if (b <= a || len(b) > maxJamb || !joined[2 * b] || !joined[2 * b + 1] || !parallel(a, b)) continue;
      const qa = P(b, 0), qb = P(b, 1);
      const mb = [(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2];
      // across: b's distance from a's line, and their overlap along it
      const d = Math.abs((mb[0] - pa[0]) * u[1] - (mb[1] - pa[1]) * u[0]);
      if (d < minOpen || d > gap) continue;
      const ta = [0, la], tb = [(qa[0] - pa[0]) * u[0] + (qa[1] - pa[1]) * u[1], (qb[0] - pa[0]) * u[0] + (qb[1] - pa[1]) * u[1]].sort((x, y) => x - y);
      const ov = Math.min(ta[1], tb[1]) - Math.max(ta[0], tb[0]);
      if (ov < 0.5 * Math.min(la, len(b))) continue;
      // facing: straight across, not along
      if (Math.abs(Math.hypot(mb[0] - mid[0], mb[1] - mid[1]) - d) > 0.35 * la + eps) continue;
      const da = (r) => (r[0] - pa[0]) * u[0] + (r[1] - pa[1]) * u[1];
      const [q0, q1] = da(qa) <= da(qb) ? [qa, qb] : [qb, qa];
      bridge(pa, q0); bridge(pb, q1);
    }
  }
  // 2. a wall face that stops and carries on after the opening
  for (let s = 0; s < n; s++) {
    if (len(s) < minFace) continue;
    for (const e of [0, 1]) {
      if (joined[2 * s + e] || !joined[2 * s + (1 - e)]) continue;
      const p = P(s, e), o = P(s, 1 - e);
      const out3 = [(p[0] - o[0]) / len(s), (p[1] - o[1]) / len(s)];      // pointing out of the line's free end
      let best = null, bd = gap + eps;
      for (const t of near(p, gap)) {
        if (t === s || len(t) < minFace || !parallel(s, t)) continue;
        for (const f of [0, 1]) {
          if (joined[2 * t + f] || !joined[2 * t + (1 - f)]) continue;
          const q = P(t, f);
          const ahead = (q[0] - p[0]) * out3[0] + (q[1] - p[1]) * out3[1];
          const off = Math.abs((q[0] - p[0]) * out3[1] - (q[1] - p[1]) * out3[0]);
          const dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (ahead > eps && off < Math.max(eps * 2, dd * 0.03) && dd < bd) { bd = dd; best = q; }
        }
      }
      if (best) bridge(p, best);
    }
  }
  return out;
}

/* Regions that touch or overlap, made one: [[x, y] ...] polygons in, the
   united outlines out (largest first). The shared edges go; the corners
   stay those of the regions. */
export function unite(polys) {
  polys = polys.filter((q) => q && q.length > 2);
  if (polys.length < 2) return polys.map((q) => q.map((v) => v.slice()));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of polys) for (const [x, y] of q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.max(x1 - x0, y1 - y0);
  let c = Math.max(0.02, size / 1800);
  x0 -= 3 * c; y0 -= 3 * c; x1 += 3 * c; y1 += 3 * c;
  const W = Math.ceil((x1 - x0) / c) + 1, H = Math.ceil((y1 - y0) / c) + 1;
  const m = new Uint8Array(W * H);
  // each polygon filled at the cell centres (rows from the top)
  for (const q of polys) {
    for (let j = 0; j < H; j++) {
      const y = y1 - (j + 0.5) * c, xs = [];
      for (let i = 0, k = q.length - 1; i < q.length; k = i++) {
        const a = q[i], b = q[k];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((u, v) => u - v);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const i0 = Math.max(0, Math.ceil((xs[t] - x0) / c - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[t + 1] - x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) m[j * W + i] = 1;
      }
    }
  }
  // a hairline between two regions laid on the same line: closed
  const d1 = distance(m, W, H);
  const grown = new Uint8Array(W * H);
  for (let t = 0; t < m.length; t++) grown[t] = d1[t] <= 1.5 ? 1 : 0;
  const inv = new Uint8Array(W * H);
  for (let t = 0; t < m.length; t++) inv[t] = grown[t] ? 0 : 1;
  const d2 = distance(inv, W, H);
  for (let t = 0; t < m.length; t++) m[t] = m[t] || (grown[t] && d2[t] > 1.0) ? 1 : 0;
  // each piece's outer edge, laid back onto the regions' own edges
  const edges = [];
  for (const q of polys) for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; edges.push(a[0], a[1], b[0], b[1]); }
  const lab = new Int32Array(W * H).fill(-1);
  const res = [];
  for (let k0 = 0; k0 < m.length; k0++) {
    if (!m[k0] || lab[k0] >= 0) continue;
    const id = res.length, st = [k0], comp = new Uint8Array(W * H);
    lab[k0] = id; comp[k0] = 1;
    while (st.length) {
      const k = st.pop();
      for (const nk of [k - 1, k + 1, k - W, k + W]) if (nk >= 0 && nk < m.length && m[nk] && lab[nk] < 0) { lab[nk] = id; comp[nk] = 1; st.push(nk); }
    }
    const ring = outline(comp, W, H);
    if (!ring || ring.length < 3) { res.push(null); continue; }
    let pts = ring.map(([i, j]) => [x0 + i * c, y1 - j * c]);
    pts = simplify(pts, c * 1.2);
    if (pts.length < 3) { res.push(null); continue; }
    pts = layOnLines(pts, edges, c * 2.5, 0);
    res.push(tidy(simplify(pts, c * 0.2)));
  }
  return res.filter((q) => q && q.length > 2).sort((a, b) => area(b) - area(a));
}

/* The pieces of drawing (8-connected cells) smaller than `min` cells,
   removed - but not one round the click (a column clicked to cut it out) */
function dropSmall(mask, W, H, min, ci, cj) {
  const seen = new Uint8Array(W * H);
  const st = [], comp = [];
  for (let k0 = 0; k0 < mask.length; k0++) {
    if (!mask[k0] || seen[k0]) continue;
    st.length = 0; comp.length = 0;
    st.push(k0); seen[k0] = 1;
    let big = false, bi0 = W, bi1 = -1, bj0 = H, bj1 = -1;
    while (st.length) {
      const k = st.pop();
      if (!big) comp.push(k);
      if (comp.length >= min) big = true;
      const i = k % W, j = (k - i) / W;
      if (i < bi0) bi0 = i; if (i > bi1) bi1 = i; if (j < bj0) bj0 = j; if (j > bj1) bj1 = j;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const nk = b * W + a;
        if (mask[nk] && !seen[nk]) { seen[nk] = 1; st.push(nk); }
      }
    }
    if (!big && !(ci >= bi0 && ci <= bi1 && cj >= bj0 && cj <= bj1)) for (const k of comp) mask[k] = 0;
  }
}

/* Each edge laid onto the drawing line it runs along (within tol, nearly
   parallel), the corners then where those lines meet. An edge with no
   such line (a closed gap, a doorway) stays where it is. */
function layOnLines(pts, L, tol, round) {
  const n = pts.length, m = L.length / 4;
  const lines = [];
  for (let e = 0; e < n; e++) {
    const a = pts[e], b = pts[(e + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey);
    // a bit of edge much shorter than the gap: the rounding round a corner or a doorway, not a wall
    if (el < Math.max(tol * 1.5, (round || 0) * 0.35)) { lines.push(null); continue; }
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let best = null, bd = tol;
    for (let s = 0; s < m; s++) {
      const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
      if (Math.max(x1, x2) < Math.min(a[0], b[0]) - tol || Math.min(x1, x2) > Math.max(a[0], b[0]) + tol
        || Math.max(y1, y2) < Math.min(a[1], b[1]) - tol || Math.min(y1, y2) > Math.max(a[1], b[1]) + tol) continue;
      const dx = x2 - x1, dy = y2 - y1, dl = Math.hypot(dx, dy);
      if (dl < tol) continue;
      // nearly parallel (within ~3 degrees)
      if (Math.abs(ex * dy - ey * dx) / (el * dl) > 0.055) continue;
      // overlapping along the edge, and close to its middle
      const d = Math.abs(dx * (y1 - my) - dy * (x1 - mx)) / dl;
      const t = ((mx - x1) * dx + (my - y1) * dy) / (dl * dl);
      if (t < -0.2 || t > 1.2) continue;
      if (d < bd) { bd = d; best = [[x1, y1], [x2, y2]]; }
    }
    lines.push(best);
  }
  /* Closing the gaps also rounds the room's corners (by half the gap): a
     short run of edges on no line, between two edges that are, and whose
     lines meet near it, is that rounding - the corner is put back. A
     doorway's edge sits between two lines in line with each other, which
     never meet: it stays. */
  if (round > 0) {
    for (let pass = 0; pass < 400; pass++) {
      let changed = false;
      const k = lines.length;
      for (let i = 0; i < k; i++) {
        if (!lines[i] || lines[(i + 1) % k]) continue;
        // a run of unlaid edges after laid edge i
        let j = (i + 1) % k, len = 0, cnt = 0;
        while (!lines[j] && cnt < k) { const a = pts[j], b = pts[(j + 1) % k]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); j = (j + 1) % k; cnt++; }
        if (!lines[j] || j === i || cnt > 12 || len > round * 3.2) continue;
        const q = meet(lines[i][0], lines[i][1], lines[j][0], lines[j][1]);
        const a = pts[(i + 1) % k];
        if (!q || Math.hypot(q[0] - a[0], q[1] - a[1]) > round * 2.2) {
          /* a doorway: the two lines either side are one wall face (in line):
             the outline goes straight across the opening, along that face */
          const A0 = lines[i][0], A1 = lines[i][1], B0 = lines[j][0];
          const al = Math.hypot(A1[0] - A0[0], A1[1] - A0[1]) || 1;
          const off = Math.abs((A1[0] - A0[0]) * (A0[1] - B0[1]) - (A0[0] - B0[0]) * (A1[1] - A0[1])) / al;
          const par = Math.abs(((A1[0] - A0[0]) * (lines[j][1][1] - B0[1]) - (A1[1] - A0[1]) * (lines[j][1][0] - B0[0])))
            / (al * (Math.hypot(lines[j][1][0] - B0[0], lines[j][1][1] - B0[1]) || 1));
          if (q || off > tol || par > 0.055 || cnt < 2) continue;
          const proj = (P) => { const t = ((P[0] - A0[0]) * (A1[0] - A0[0]) + (P[1] - A0[1]) * (A1[1] - A0[1])) / (al * al); return [A0[0] + t * (A1[0] - A0[0]), A0[1] + t * (A1[1] - A0[1])]; };
          const first = (i + 1) % k, last = j;
          const keepA = proj(pts[first]), keepB = proj(pts[last]);
          const drop = new Set();
          for (let t = 1; t < cnt; t++) drop.add((first + t) % k);
          pts[first] = keepA; pts[last] = keepB;
          const np = [], nl = [];
          for (let t = 0; t < k; t++) if (!drop.has(t)) { np.push(pts[t]); nl.push(t === first ? [A0, A1] : lines[t]); }
          pts = np; lines.length = 0; lines.push(...nl);
          changed = true;
          break;
        }
        // drop the run: the corner becomes the meeting point (vertex i+1 kept, moved there)
        const keep = (i + 1) % k;
        const drop = new Set();
        for (let t = 1; t <= cnt; t++) drop.add((keep + t) % k);
        pts[keep] = q;
        lines[keep] = null;             // the edge from the corner on is the next laid one's
        const np = [], nl = [];
        for (let t = 0; t < k; t++) if (!drop.has(t)) { np.push(pts[t]); nl.push(t === keep ? lines[j] : lines[t]); }
        pts = np; lines.length = 0; lines.push(...nl);
        changed = true;
        break;
      }
      if (!changed) break;
    }
  }
  const nn = pts.length;
  const out = [];
  for (let i = 0; i < nn; i++) {
    const pe = (i + nn - 1) % nn;
    const A = lines[pe] || [pts[pe], pts[i]], B = lines[i] || [pts[i], pts[(i + 1) % nn]];
    if (!lines[pe] && !lines[i]) { out.push(pts[i]); continue; }
    const q = meet(A[0], A[1], B[0], B[1]);
    // the meeting point must be near the corner it replaces
    out.push(q && Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) < tol * 2.5 ? q : pts[i]);
  }
  return out;
}
