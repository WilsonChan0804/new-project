/* The shortest way across a plan, around what blocks it.
 *
 * The plan's cut (planroute.py in the add-in: walls, doors, columns ... as
 * segments in paper mm, by category) is drawn onto a grid of small cells -
 * the blocking categories only, each widened by a clearance, the room a
 * person needs beside a wall. A* then finds the cheapest way from cell to
 * cell (8 directions, never cutting a blocked corner), and the steps are
 * pulled tight: a corner is kept only where a straight line would pass
 * through something, so the route runs straight across a room and turns
 * at the door frame, as a person walks and as the codes measure it.
 *
 * Plain functions on arrays, so the worker (route-worker.js) runs them and
 * a test runs them in Node.
 */

/* The grid of a viewport: rect [x, y, w, h] in paper mm, cell in paper mm,
   clear (clearance) in paper mm. segs: [Float64Array|Array of x1 y1 x2 y2]. */
export function makeGrid(segs, rect, cell, clear) {
  const [x0, y0, w, h] = rect;
  // at most ~6 million cells: a big plan at a fine cell is made coarser
  let c = cell;
  while (Math.ceil(w / c) * Math.ceil(h / c) > 6e6) c *= 1.25;
  const W = Math.ceil(w / c) + 2, H = Math.ceil(h / c) + 2;
  const g = new Uint8Array(W * H);
  const ox = x0 - c, oy = y0 - c;
  const mark = [];
  const set = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return;
    const k = j * W + i;
    if (!g[k]) { g[k] = 1; mark.push(k); }
  };
  for (const s of segs) {
    for (let n = 0; n + 3 < s.length; n += 4) {
      const ax = (s[n] - ox) / c, ay = (s[n + 1] - oy) / c, bx = (s[n + 2] - ox) / c, by = (s[n + 3] - oy) / c;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2));
      for (let t = 0; t <= steps; t++) {
        const f = t / steps;
        set(Math.floor(ax + (bx - ax) * f), Math.floor(ay + (by - ay) * f));
      }
    }
  }
  // the clearance: every blocked cell grown into a disc
  const r = Math.max(0, Math.round(clear / c));
  if (r > 0) {
    const disc = [];
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r + r * 0.6) disc.push([di, dj]);
    const base = mark.slice();
    for (const k of base) {
      const i = k % W, j = (k - i) / W;
      for (const [di, dj] of disc) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < W && b < H) g[b * W + a] = g[b * W + a] || 2;
      }
    }
  }
  return { g, W, H, ox, oy, c, clearR: r };
}

const toCell = (G, p) => [Math.floor((p[0] - G.ox) / G.c), Math.floor((p[1] - G.oy) / G.c)];
const toMm = (G, i, j) => [G.ox + (i + 0.5) * G.c, G.oy + (j + 0.5) * G.c];
const free = (G, i, j) => i >= 0 && j >= 0 && i < G.W && j < G.H && !G.g[j * G.W + i];

/* The nearest free cell to a point (a click on a wall line lands in its clearance) */
function nearestFree(G, i, j, maxR) {
  if (free(G, i, j)) return [i, j];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (free(G, i + di, j + dj)) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; } }
    }
    if (best) return best;
  }
  return null;
}

/* A straight line from cell to cell crosses nothing blocked (every cell it touches is free) */
export function sight(G, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3));
  let pi = a[0], pj = a[1];
  if (!free(G, pi, pj)) return false;
  for (let k = 1; k <= n; k++) {
    // cell centres: (a + 0.5) .. (b + 0.5)
    const i = Math.floor(a[0] + 0.5 + dx * k / n), j = Math.floor(a[1] + 0.5 + dy * k / n);
    if (i === pi && j === pj) continue;
    if (!free(G, i, j)) return false;
    // through a corner: neither cell beside it may be blocked
    if (i !== pi && j !== pj && (!free(G, i, pj) || !free(G, pi, j))) return false;
    pi = i; pj = j;
  }
  return true;
}

/* A* from cell to cell: the cells of the way, or null */
function astar(G, s, t) {
  const { W, H } = G, N = W * H;
  const gs = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [], hf = [];
  const push = (k, f) => {
    heap.push(k); hf.push(f);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= hf[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; [hf[p], hf[i]] = [hf[i], hf[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop(), lf = hf.pop();
    if (heap.length) {
      heap[0] = last; hf[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && hf[l] < hf[m]) m = l;
        if (r < heap.length && hf[r] < hf[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; [hf[m], hf[i]] = [hf[i], hf[m]]; i = m;
      }
    }
    return top;
  };
  const hx = (i, j) => { const dx = Math.abs(i - t[0]), dy = Math.abs(j - t[1]); return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy); };
  const sk = s[1] * W + s[0], tk = t[1] * W + t[0];
  gs[sk] = 0;
  push(sk, hx(s[0], s[1]));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let budget = N * 2;
  while (heap.length && budget-- > 0) {
    const k = pop();
    if (closed[k]) continue;
    if (k === tk) break;
    closed[k] = 1;
    const i = k % W, j = (k - i) / W;
    for (const [di, dj, w] of D) {
      const a = i + di, b = j + dj;
      if (!free(G, a, b)) continue;
      if (di && dj && (!free(G, i + di, j) || !free(G, i, j + dj))) continue;   // no corner cutting
      const nk = b * W + a;
      if (closed[nk]) continue;
      const ng = gs[k] + w;
      if (ng < gs[nk]) { gs[nk] = ng; from[nk] = k; push(nk, ng + hx(a, b)); }
    }
  }
  if (from[tk] < 0 && tk !== sk) return null;
  const out = [];
  for (let k = tk; k >= 0; k = from[k]) { const i = k % W; out.push([i, (k - i) / W]); if (k === sk) break; }
  return out.reverse();
}

/* The cells pulled tight: a corner kept only where the line of sight breaks */
function pull(G, cells) {
  if (cells.length <= 2) return cells.slice();
  const out = [cells[0]];
  let a = 0;
  while (a < cells.length - 1) {
    // the farthest cell still in sight (searched from the far end: fewer checks on long open runs)
    const lo = a + 1;
    let best = lo;
    for (let k = cells.length - 1; k > lo; k--) { if (sight(G, cells[a], cells[k])) { best = k; break; } }
    out.push(cells[best]);
    a = best;
  }
  return out;
}

const len = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

/* One leg: from paper point a to paper point b. [[x, y], ...] in paper mm,
   from a exactly to b exactly; or null when nothing gets through. */
export function route(G, a, b) {
  const reach = Math.max(4, Math.round(1.2 * (G.clearR || 3)));
  const s = nearestFree(G, ...toCell(G, a), reach + 6);
  const t = nearestFree(G, ...toCell(G, b), reach + 6);
  if (!s || !t) return null;
  const cells = astar(G, s, t);
  if (!cells) return null;
  const pts = pull(G, cells).map(([i, j]) => toMm(G, i, j));
  // the clicked points themselves at both ends (not the centres of their cells)
  pts[0] = [a[0], a[1]];
  if (pts.length === 1) pts.push([b[0], b[1]]); else pts[pts.length - 1] = [b[0], b[1]];
  // a middle corner the ends can see past is dropped
  while (pts.length > 2 && sight(G, toCell(G, pts[0]), toCell(G, pts[2])) && free(G, ...toCell(G, pts[0]))) pts.splice(1, 1);
  while (pts.length > 2 && sight(G, toCell(G, pts[pts.length - 3]), toCell(G, pts[pts.length - 1])) && free(G, ...toCell(G, pts[pts.length - 1]))) pts.splice(pts.length - 2, 1);
  return pts;
}

export { len as pathLength };
