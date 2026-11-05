/* Snapping to the sheet's own lines, as in CAD: a dimension or a line drawn
 * on a sheet lands on the end of a wall line, the crossing of two grid
 * lines, the middle of a line or a point along it, rather than a hair off.
 *
 * The lines are read once per sheet from the PDF's drawing commands
 * (pdf.js getOperatorList), with the current transform kept, so they are the
 * exact plotted lines - not traced from pixels. Curves (arcs, door swings,
 * curved walls) are kept as short straight pieces along them.
 * Kept in paper millimetres in a coarse grid, so finding the lines under the
 * pointer is quick on a sheet of a million strokes.
 *
 *   const idx = await readLines(page, toMm)     // toMm(x, y): PDF user space -> paper mm [u, v]
 *   idx.snap([u, v], tolMm, { anchor, wide }) -> { p: [u, v], kind, guides } | null
 *   kind: "end" | "cross" | "perp" | "align2" | "ext" | "align" | "mid" | "on"; guides: dashed lines to show
 *   idx.lines                                   the lines, flat x1 y1 x2 y2 ... (areafill.js)
 *   idx.nearest([u, v], tolMm) -> [x1, y1, x2, y2] | null   the line under the pointer (Area > Pick lines)
 *   idx.nearestIndex([u, v], tolMm) -> line number | -1
 *   idx.cls[i], idx.classes[id] = {w, color, dash, fill, n}   how line i is drawn (width mm, colour, dashed)
 *   idx.curve[i]: the curve line i is a piece of (0: none); idx.curves: per curve start, middle, end
 * Only painted lines count: a clipping path (a viewport's crop) is not a line.
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
  const fl = [];                    // per line: 1 its start is inside a curve, 2 its end is, 4 no midpoint
  const cl = [];                    // per line: its class (how it is drawn: width, colour, dash)
  const cv = [];                    // per line: the curve it is a piece of (0: a straight line)
  const curves = [0, 0, 0, 0, 0, 0]; // per curve: its start, middle and end (mm), for telling door swings
  const classes = [], classOf = new Map();
  const to = toMm || pdfFrame(page);
  // the drawing state, as save / restore keep it
  let G = { ctm: [1, 0, 0, 1, 0, 0], w: 1, sc: "000000", fc: "000000", dash: false };
  const stack = [];
  const P = (x, y) => to(x * G.ctm[0] + y * G.ctm[2] + G.ctm[4], x * G.ctm[1] + y * G.ctm[3] + G.ctm[5]);
  const hex = (a) => Array.from(a || [0, 0, 0]).slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  /* A path is only a line once it is painted: a clip (a viewport's crop,
     never seen) is dropped. Its pieces wait here for the paint. */
  let pend = [];
  let start = null, cur = null, curRaw = null, startRaw = null;
  const seg = (a, b, f, c) => {
    if (Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) return;
    pend.push(a[0], a[1], b[0], b[1], f || 0, c || 0);
  };
  const paint = (stroked) => {
    // the width on paper: the line width through the transform's scale
    const k = Math.sqrt(Math.abs(G.ctm[0] * G.ctm[3] - G.ctm[1] * G.ctm[2])) || 1;
    const w = stroked ? Math.round(Math.max(0, G.w) * k * PT_MM * 100) / 100 : 0;
    const color = stroked ? G.sc : "f" + G.fc;
    const key = w + "|" + color + "|" + (stroked && G.dash ? 1 : 0);
    let id = classOf.get(key);
    if (id === undefined) { id = classes.length; classes.push({ w, color, dash: !!(stroked && G.dash), fill: !stroked, n: 0 }); classOf.set(key, id); }
    for (let q = 0; q < pend.length && xs.length / 4 < MAX_SEG; q += 6) {
      xs.push(pend[q], pend[q + 1], pend[q + 2], pend[q + 3]);
      fl.push(pend[q + 4]); cv.push(pend[q + 5]); cl.push(id);
      classes[id].n++;
    }
    pend = [];
  };
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill]);
  const CLOSE = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < fn.length && xs.length / 4 < MAX_SEG; i++) {
    const f = fn[i], a = args[i];
    if (f === OPS.save) stack.push(Object.assign({}, G));
    else if (f === OPS.restore) { if (stack.length) G = stack.pop(); }
    else if (f === OPS.transform) G.ctm = mul(a, G.ctm);
    else if (f === OPS.paintFormXObjectBegin) { stack.push(Object.assign({}, G)); if (a && a[0]) G.ctm = mul(a[0], G.ctm); }
    else if (f === OPS.paintFormXObjectEnd) { if (stack.length) G = stack.pop(); }
    else if (f === OPS.setLineWidth) G.w = a[0];
    else if (f === OPS.setDash) G.dash = !!(a && a[0] && a[0].length && a[0].some((v) => v > 0));
    else if (f === OPS.setStrokeRGBColor) G.sc = hex(a);
    else if (f === OPS.setFillRGBColor) G.fc = hex(a);
    else if (f === OPS.setGState) {
      for (const [k, v] of (a && a[0]) || []) {
        if (k === "LW") G.w = v;
        else if (k === "D") G.dash = !!(v && v[0] && v[0].length && v[0].some((x) => x > 0));
      }
    }
    else if (STROKE.has(f) || FILL.has(f)) {
      if (CLOSE.has(f) && cur && start) seg(cur, start);
      paint(STROKE.has(f));
    }
    else if (f === OPS.endPath) pend = [];          // a clip: not drawn
    else if (f === OPS.constructPath) {
      const ops = a[0], c = a[1];
      let k = 0;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = start = P(c[k], c[k + 1]); curRaw = startRaw = [c[k], c[k + 1]]; k += 2; }
        else if (op === OPS.lineTo) { const q = P(c[k], c[k + 1]); curRaw = [c[k], c[k + 1]]; k += 2; if (cur) seg(cur, q); cur = q; }
        else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
          // a Bezier curve, as straight pieces about 1.5 mm long (4 to 24): close enough
          // for a curved wall to snap to and to bound an area within a tenth of a per cent
          let c1, c2, e;
          if (op === OPS.curveTo) { c1 = [c[k], c[k + 1]]; c2 = [c[k + 2], c[k + 3]]; e = [c[k + 4], c[k + 5]]; k += 6; }
          else if (op === OPS.curveTo2) { c1 = null; c2 = [c[k], c[k + 1]]; e = [c[k + 2], c[k + 3]]; k += 4; }
          else { c1 = [c[k], c[k + 1]]; c2 = null; e = [c[k + 2], c[k + 3]]; k += 4; }
          const q = P(e[0], e[1]);
          if (cur) {
            const p0 = curRaw, a1 = c1 || p0, a2 = c2 || e;
            const m1 = P(a1[0], a1[1]), m2 = P(a2[0], a2[1]);
            const hull = Math.hypot(m1[0] - cur[0], m1[1] - cur[1]) + Math.hypot(m2[0] - m1[0], m2[1] - m1[1]) + Math.hypot(q[0] - m2[0], q[1] - m2[1]);
            const N = Math.max(4, Math.min(24, Math.ceil(hull / 1.5)));
            const bz = (u) => { const w = 1 - u; return [w * w * w * p0[0] + 3 * w * w * u * a1[0] + 3 * w * u * u * a2[0] + u * u * u * e[0],
              w * w * w * p0[1] + 3 * w * w * u * a1[1] + 3 * w * u * u * a2[1] + u * u * u * e[1]]; };
            const id = curves.length / 6;
            const mid = P(...bz(0.5));
            curves.push(cur[0], cur[1], mid[0], mid[1], q[0], q[1]);
            let prev = cur;
            for (let t = 1; t <= N; t++) {
              const pt = t === N ? q : P(...bz(t / N));
              // only the curve's own two ends snap as ends; no midpoints of its pieces
              seg(prev, pt, (t > 1 ? 1 : 0) | (t < N ? 2 : 0) | 4, id);
              prev = pt;
            }
          }
          cur = q; curRaw = e;
        }
        else if (op === OPS.rectangle) {
          const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
          const r = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
          for (let j = 0; j < 4; j++) seg(r[j], r[(j + 1) % 4]);
          cur = start = r[0]; curRaw = startRaw = [x, y];
        }
        else if (op === OPS.closePath) { if (cur && start) seg(cur, start); cur = start; curRaw = startRaw; }
      }
    }
  }
  const idx = makeIndex(Float64Array.from(xs), Uint8Array.from(fl));
  // how each line is drawn, for the Area tool to leave some out (areatool.js)
  idx.cls = Uint16Array.from(cl);
  idx.classes = classes;
  idx.curve = Uint32Array.from(cv);
  idx.curves = Float64Array.from(curves);
  return idx;
}

export function makeIndex(L, F) {
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
          const f = F ? F[s] : 0;
          let d = Math.hypot(u - x1, v - y1);
          if (!(f & 1) && d < dEnd) { dEnd = d; bestEnd = [x1, y1]; }
          d = Math.hypot(u - x2, v - y2);
          if (!(f & 2) && d < dEnd) { dEnd = d; bestEnd = [x2, y2]; }
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          d = Math.hypot(u - mx, v - my);
          if (!(f & 4) && d < dMid) { dMid = d; bestMid = [mx, my]; }
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
  /* The line nearest the point, within tol: [x1, y1, x2, y2] (its number: nearestIndex) */
  function nearest(p, tol) {
    const s = nearestIndex(p, tol);
    return s < 0 ? null : [L[4 * s], L[4 * s + 1], L[4 * s + 2], L[4 * s + 3]];
  }
  function nearestIndex(p, tol) {
    const [u, v] = p;
    stamp++;
    let best = null, bd = tol;
    const i0 = Math.floor((u - tol) / CELL), i1 = Math.floor((u + tol) / CELL);
    const j0 = Math.floor((v - tol) / CELL), j1 = Math.floor((v + tol) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = grid.get(key(i, j));
      if (!a) continue;
      for (const s of a) {
        if (seen[s] === stamp) continue;
        seen[s] = stamp;
        const x1 = L[4 * s], y1 = L[4 * s + 1], x2 = L[4 * s + 2], y2 = L[4 * s + 3];
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (l2 || 1)));
        const d = Math.hypot(u - (x1 + t * dx), v - (y1 + t * dy));
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best === null ? -1 : best;
  }

  /* every line in the cells near p (each once): fn(line number) */
  function around(p, tol, fn) {
    stamp++;
    const i0 = Math.floor((p[0] - tol) / CELL), i1 = Math.floor((p[0] + tol) / CELL);
    const j0 = Math.floor((p[1] - tol) / CELL), j1 = Math.floor((p[1] + tol) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = grid.get(key(i, j));
      if (!a) continue;
      for (const s of a) { if (seen[s] === stamp) continue; seen[s] = stamp; fn(s); }
    }
  }

  return { count: n, snap, nearest, nearestIndex, around, lines: L };
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
