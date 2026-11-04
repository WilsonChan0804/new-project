/* Snapping to the sheet's own lines, as in CAD: a dimension or a line drawn
 * on a sheet lands on the end of a wall line, the crossing of two grid
 * lines, the middle of a line or a point along it, rather than a hair off.
 *
 * The lines are read once per sheet from the PDF's drawing commands
 * (pdf.js getOperatorList), with the current transform kept, so they are the
 * exact plotted lines - not traced from pixels. Curves count by their ends.
 * Kept in paper millimetres in a coarse grid, so finding the lines under the
 * pointer is quick on a sheet of a million strokes.
 *
 *   const idx = await readLines(page, toMm)     // toMm(x, y): PDF user space -> paper mm [u, v]
 *   idx.snap([u, v], tolMm, { anchor, wide }) -> { p: [u, v], kind, guides } | null
 *   kind: "end" | "cross" | "perp" | "align2" | "ext" | "align" | "mid" | "on"; guides: dashed lines to show
 */

const PT_MM = 25.4 / 72;
const CELL = 5;                    // mm
const MAX_SEG = 600000;            // beyond this, the rest of a sheet is not read

function mul(m, n) {               // m then n, as pdf.js Util.transform(n, m) reversed: [a b c d e f]
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
          m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
          m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

/* The usual converter: the PDF's own frame less its CropBox corner, as the
   sheets drawn from the PDF place markups (app.js paperFrom). */
export const pdfFrame = (page) => (x, y) => [(x - page.view[0]) * PT_MM, (y - page.view[1]) * PT_MM];
/* A sheet shown from the server's pictures: the sheet as displayed (origin
   at the CropBox corner, turned upright by its /Rotate), which is the PDF
   through its own default viewport; H: the displayed height in points. */
export const shownFrame = (page, H) => {
  const vp = page.getViewport({ scale: 1 });
  return (x, y) => { const q = vp.convertToViewportPoint(x, y); return [q[0] * PT_MM, (H - q[1]) * PT_MM]; };
};

export async function readLines(page, toMm) {
  const OPS = pdfjsLib.OPS;
  const ol = await page.getOperatorList();
  const fn = ol.fnArray, args = ol.argsArray;
  const xs = [];                    // flat x1, y1, x2, y2 in mm
  const to = toMm || pdfFrame(page);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const P = (x, y) => to(x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]);
  const seg = (a, b) => {
    if (xs.length / 4 >= MAX_SEG) return;
    if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) return;
    xs.push(a[0], a[1], b[0], b[1]);
  };
  for (let i = 0; i < fn.length && xs.length / 4 < MAX_SEG; i++) {
    const f = fn[i], a = args[i];
    if (f === OPS.save) stack.push(ctm);
    else if (f === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (f === OPS.transform) ctm = mul(a, ctm);
    else if (f === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (f === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (f === OPS.constructPath) {
      const ops = a[0], c = a[1];
      let k = 0, start = null, cur = null;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = start = P(c[k], c[k + 1]); k += 2; }
        else if (op === OPS.lineTo) { const q = P(c[k], c[k + 1]); k += 2; if (cur) seg(cur, q); cur = q; }
        else if (op === OPS.curveTo) { const q = P(c[k + 4], c[k + 5]); k += 6; cur = q; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { const q = P(c[k + 2], c[k + 3]); k += 4; cur = q; }
        else if (op === OPS.rectangle) {
          const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
          const r = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
          for (let j = 0; j < 4; j++) seg(r[j], r[(j + 1) % 4]);
          cur = start = r[0];
        }
        else if (op === OPS.closePath) { if (cur && start) seg(cur, start); cur = start; }
      }
    }
  }
  return makeIndex(Float64Array.from(xs));
}

export function makeIndex(L) {
  const n = L.length / 4;
  const grid = new Map();
  const key = (i, j) => i * 1048576 + j;
  for (let s = 0; s < n; s++) {
    const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
    const i0 = Math.floor(Math.min(x1, x2) / CELL), i1 = Math.floor(Math.max(x1, x2) / CELL);
    const j0 = Math.floor(Math.min(y1, y2) / CELL), j1 = Math.floor(Math.max(y1, y2) / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) continue;       // a huge diagonal: skip
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        // a long slanted line only goes in the cells it actually crosses
        if (i1 > i0 && j1 > j0 && !crossesCell(x1, y1, x2, y2, i * CELL, j * CELL)) continue;
        const k = key(i, j);
        let a = grid.get(k);
        if (!a) grid.set(k, a = []);
        a.push(s);
      }
    }
  }
  const seen = new Uint32Array(n);
  let stamp = 0;

  /* opt.anchor: the point already placed (a dimension's first point, a
     polyline's last, the other end of a dragged point) - for perpendicular
     and for lining up with it. opt.wide: how far (mm) alignment looks. In
     order: endpoint, intersection, perpendicular, aligned / extension,
     midpoint, on line. */
  function snap(p, tol, opt) {
    opt = opt || {};
    const [u, v] = p;
    const A = opt.anchor || null;
    stamp++;
    let bestEnd = null, dEnd = tol, bestMid = null, dMid = tol * 0.8;
    const near = [];                 // [dist, s, qx, qy] of the lines within tol
    const i0 = Math.floor((u - tol) / CELL), i1 = Math.floor((u + tol) / CELL);
    const j0 = Math.floor((v - tol) / CELL), j1 = Math.floor((v + tol) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = grid.get(key(i, j));
        if (!a) continue;
        for (const s of a) {
          if (seen[s] === stamp) continue;
          seen[s] = stamp;
          const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
          let d = Math.hypot(u - x1, v - y1);
          if (d < dEnd) { dEnd = d; bestEnd = [x1, y1]; }
          d = Math.hypot(u - x2, v - y2);
          if (d < dEnd) { dEnd = d; bestEnd = [x2, y2]; }
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          d = Math.hypot(u - mx, v - my);
          if (d < dMid) { dMid = d; bestMid = [mx, my]; }
          const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
          const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (l2 || 1)));
          const qx = x1 + t * dx, qy = y1 + t * dy;
          d = Math.hypot(u - qx, v - qy);
          if (d < tol) near.push([d, s, qx, qy]);
        }
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    // 1. a corner (end of a line)
    if (bestEnd) return { p: bestEnd, kind: "end" };
    // 2. the crossing of the nearest line with the next one not parallel to it
    if (near.length > 1) {
      const s = near[0][1];
      for (let k = 1; k < Math.min(near.length, 12); k++) {
        const x = cross(L, s, near[k][1]);
        if (x && Math.hypot(u - x[0], v - x[1]) < tol) return { p: x, kind: "cross" };
      }
    }
    // 3. perpendicular from the point already placed onto a line here
    if (A) {
      let best = null, bd = tol;
      for (const [, s] of near) {
        const x1 = L[4 * s], y1 = L[4 * s + 1], dx = L[4 * s + 2] - x1, dy = L[4 * s + 3] - y1, l2 = dx * dx + dy * dy;
        if (l2 < 1e-9) continue;
        const t = ((A[0] - x1) * dx + (A[1] - y1) * dy) / l2;
        if (t < -0.02 || t > 1.02) continue;
        const f = [x1 + t * dx, y1 + t * dy];
        const d = Math.hypot(u - f[0], v - f[1]);
        if (d < bd && Math.hypot(f[0] - A[0], f[1] - A[1]) > 1e-3) { bd = d; best = f; }
      }
      if (best) return { p: best, kind: "perp", guides: [[A[0], A[1], best[0], best[1]]] };
    }
    // 4. aligned: straight across / up from a corner nearby (or the point
    //    already placed), or a line carried on past its end
    const al = align(u, v, tol, opt.wide || tol * 30, A, near);
    if (al) return al;
    // 5. the middle of a line
    if (bestMid) return { p: bestMid, kind: "mid" };
    // 6. anywhere along a line
    if (near.length) return { p: [near[0][2], near[0][3]], kind: "on" };
    return null;
  }

  let stamp2 = 0;
  const seen2 = new Uint32Array(n);
  function align(u, v, tol, R, A, near) {
    stamp2++;
    let vx = null, hy = null, ext = null;            // [offset, value, from x, from y] / [d, p, end]
    const take = (ex, ey) => {
      if (Math.hypot(u - ex, v - ey) < tol) return;   // that is the corner itself (1. above)
      const ox = Math.abs(u - ex), oy = Math.abs(v - ey);
      if (ox < tol && (!vx || ox < vx[0])) vx = [ox, ex, ex, ey];
      if (oy < tol && (!hy || oy < hy[0])) hy = [oy, ey, ex, ey];
    };
    if (A) take(A[0], A[1]);
    // the line under the pointer does not line up with its own ends
    const own = new Set(near.map((x) => x[1]));
    const i0 = Math.floor((u - R) / CELL), i1 = Math.floor((u + R) / CELL);
    const j0 = Math.floor((v - R) / CELL), j1 = Math.floor((v + R) / CELL);
    let looked = 0;
    for (let i = i0; i <= i1 && looked < 20000; i++) {
      for (let j = j0; j <= j1 && looked < 20000; j++) {
        const a = grid.get(key(i, j));
        if (!a) continue;
        for (const s of a) {
          if (seen2[s] === stamp2) continue;
          seen2[s] = stamp2;
          if (++looked > 20000) break;
          const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
          if (!own.has(s)) { take(x1, y1); take(x2, y2); }
          // past an end, on the line's own direction
          const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
          if (len < tol) continue;
          const t = ((u - x1) * dx + (v - y1) * dy) / (len * len);
          if (t >= 0 && t <= 1) continue;
          const f = [x1 + t * dx, y1 + t * dy];
          const d = Math.hypot(u - f[0], v - f[1]);
          const end = t < 0 ? [x1, y1] : [x2, y2];
          if (d < tol && Math.hypot(f[0] - end[0], f[1] - end[1]) < R && (!ext || d < ext[0])) ext = [d, f, end];
        }
      }
    }
    if (vx && hy) {
      return { p: [vx[1], hy[1]], kind: "align2",
        guides: [[vx[2], vx[3], vx[1], hy[1]], [hy[2], hy[3], vx[1], hy[1]]] };
    }
    if (ext) return { p: ext[1], kind: "ext", guides: [[ext[2][0], ext[2][1], ext[1][0], ext[1][1]]] };
    const one = vx && (!hy || vx[0] <= hy[0]) ? "v" : hy ? "h" : null;
    if (!one) return null;
    // lined up and on the line under the pointer at once, when there is one
    let q = one === "v" ? [vx[1], v] : [u, hy[1]];
    if (near.length) {
      const s = near[0][1], x1 = L[4 * s], y1 = L[4 * s + 1], dx = L[4 * s + 2] - x1, dy = L[4 * s + 3] - y1;
      const t = one === "v" ? (Math.abs(dx) > 1e-9 ? (vx[1] - x1) / dx : NaN) : (Math.abs(dy) > 1e-9 ? (hy[1] - y1) / dy : NaN);
      if (t >= 0 && t <= 1) {
        const w = [x1 + t * dx, y1 + t * dy];
        if (Math.hypot(u - w[0], v - w[1]) < tol) q = w;
      }
    }
    const src = one === "v" ? [vx[2], vx[3]] : [hy[2], hy[3]];
    return { p: q, kind: "align", guides: [[src[0], src[1], q[0], q[1]]] };
  }
  return { count: n, snap };
}

function crossesCell(x1, y1, x2, y2, cx, cy) {
  // the segment's line passes through the cell when the cell's corners are not all on one side
  const side = (x, y) => (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const a = side(cx, cy), b = side(cx + CELL, cy), c = side(cx, cy + CELL), d = side(cx + CELL, cy + CELL);
  return !((a > 0 && b > 0 && c > 0 && d > 0) || (a < 0 && b < 0 && c < 0 && d < 0));
}

function cross(L, s, r) {
  const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
  const x3 = L[4 * r], y3 = L[4 * r + 1], x4 = L[4 * r + 2], y4 = L[4 * r + 3];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const l1 = Math.hypot(x2 - x1, y2 - y1), l2 = Math.hypot(x4 - x3, y4 - y3);
  if (Math.abs(den) < 1e-6 * l1 * l2 + 1e-12) return null;              // parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const w = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  const e = 1e-3;
  if (t < -e || t > 1 + e || w < -e || w > 1 + e) return null;          // they do not meet
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}
