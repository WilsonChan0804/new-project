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
  let half = opt.start || Math.max(40, gap * 6);
  for (let round = 0; round < 6; round++) {
    const x0 = p[0] - half, y0 = p[1] - half, x1 = p[0] + half, y1 = p[1] + half;
    const r = tryWindow(L, p, [x0, y0, x1, y1], gap);
    if (r.pts || r.error !== "open") return r;
    if (page && x0 <= 0 && y0 <= 0 && x1 >= page[0] && y1 >= page[1]) break;
    half *= 2.2;
  }
  return { error: "open" };
}

function tryWindow(L, p, box, gap) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  let c = Math.max(0.05, Math.sqrt((w * h) / MAX_CELLS));
  // fine enough for the gap to be a few cells, coarse enough to be quick
  c = Math.min(c, Math.max(0.05, gap / 6 || c));
  if ((w / c) * (h / c) > MAX_CELLS) c = Math.sqrt((w * h) / MAX_CELLS);
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
  // gaps narrower than `gap` closed: walls grown by half the gap, then shrunk back
  let block = wall;
  const r = gap / 2 / c;
  if (r >= 1) {
    /* Small loose things - a chair, a stroke of text, a door leaf - are
       left out first: closed up to a wall they would cut a piece off the
       room. Walls hang together, so they stay. (Inside the room they are
       islands, which never count anyway.) */
    const ci = cell(p[0], p[1]);
    dropSmall(wall, W, H, (gap * 2) / c, ci[0], ci[1]);
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
  pts = simplify(pts, c * 0.3);
  return { pts, cell: c };
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
