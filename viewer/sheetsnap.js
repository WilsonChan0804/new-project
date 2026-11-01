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
 *   const idx = await readLines(page, origin)   // origin: page.view's [x0, y0]
 *   idx.snap([u, v], tolMm) -> { p: [u, v], kind } | null
 *   kind: "end" | "cross" | "mid" | "on"
 */

const PT_MM = 25.4 / 72;
const CELL = 5;                    // mm
const MAX_SEG = 600000;            // beyond this, the rest of a sheet is not read

function mul(m, n) {               // m then n, as pdf.js Util.transform(n, m) reversed: [a b c d e f]
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
          m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
          m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

export async function readLines(page, origin) {
  const OPS = pdfjsLib.OPS;
  const ol = await page.getOperatorList();
  const fn = ol.fnArray, args = ol.argsArray;
  const xs = [];                    // flat x1, y1, x2, y2 in mm
  const o = origin || [0, 0];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const P = (x, y) => [((x * ctm[0] + y * ctm[2] + ctm[4]) - o[0]) * PT_MM,
                       ((x * ctm[1] + y * ctm[3] + ctm[5]) - o[1]) * PT_MM];
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

  function snap(p, tol) {
    const [u, v] = p;
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
    if (bestEnd) return { p: bestEnd, kind: "end" };
    if (near.length > 1) {
      near.sort((a, b) => a[0] - b[0]);
      // the crossing of the nearest line with the next one not parallel to it
      const s = near[0][1];
      for (let k = 1; k < Math.min(near.length, 12); k++) {
        const x = cross(L, s, near[k][1]);
        if (x && Math.hypot(u - x[0], v - x[1]) < tol) return { p: x, kind: "cross" };
      }
    }
    if (bestMid) return { p: bestMid, kind: "mid" };
    if (near.length) {
      near.sort((a, b) => a[0] - b[0]);
      return { p: [near[0][2], near[0][3]], kind: "on" };
    }
    return null;
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
