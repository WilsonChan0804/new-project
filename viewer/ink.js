/* Freehand ink, the GoodNotes way.
 *
 * Three things make handwriting on a tablet feel right, and the viewer had
 * none of them:
 *
 *  - Speed. Every pen movement used to redraw every markup on the sheet;
 *    with a few dozen markups that is visibly behind the pencil. The stroke
 *    in progress is now one SVG path updated once per frame, and the
 *    browser's coalesced events are used so a fast Apple Pencil stroke keeps
 *    all its points instead of the ~60 a second the screen reports.
 *  - Smoothness. Points are joined by quadratic curves through their
 *    midpoints rather than straight segments, so curves are curves.
 *  - Shapes. Draw a rough line, box or circle and HOLD at the end: it
 *    snaps to a clean one, as in GoodNotes. Nothing snaps unless you hold.
 *
 * Coordinates here are plain [x, y] pairs; the callers decide whether they
 * are screen pixels or paper millimetres.
 */

/* SVG path through the points, smoothed. */
export function smoothPath(P) {
  if (!P.length) return "";
  if (P.length < 3) {
    return `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`
      + P.slice(1).map((p) => ` L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  }
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
    d += ` Q${P[i][0].toFixed(1)},${P[i][1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const L = P[P.length - 1];
  return d + ` L${L[0].toFixed(1)},${L[1].toFixed(1)}`;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/* Fewer points, same shape (Ramer-Douglas-Peucker). A stroke sampled at
   240 Hz is several hundred points; stored and synced like that, every
   sheet with handwriting gets heavy for nothing. */
export function simplify(P, tol) {
  if (P.length < 3) return P.slice();
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(P[i], P[a], P[b]);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return P.filter((_, i) => keep[i]);
}

function pathLength(P) {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return s;
}

/* What a held stroke was meant to be: a line, a rectangle or an ellipse,
   or null when it is none of them (then the ink stays as drawn). Tolerances
   are fractions of the shape's own size, so it works at any zoom. */
export function recognize(P) {
  if (P.length < 4) return null;
  const len = pathLength(P);
  if (len <= 0) return null;
  const a = P[0], b = P[P.length - 1];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);

  // A line: nothing strays far from the chord.
  if (chord > 0.85 * len) {
    const dev = Math.max(...P.map((p) => segDist(p, a, b)));
    if (dev < 0.06 * chord) return { type: "line", points: [a.slice(), b.slice()] };
  }

  // A closed shape: the end comes back near the start.
  if (chord > 0.25 * len) return null;
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  if (w < 1e-6 || h < 1e-6) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = w / 2, ry = h / 2;
  let eRect = 0, eEll = 0;
  for (const p of P) {
    // distance to the box outline
    const dx = Math.min(Math.abs(p[0] - x0), Math.abs(p[0] - x1));
    const dy = Math.min(Math.abs(p[1] - y0), Math.abs(p[1] - y1));
    eRect += Math.min(dx, dy);
    // radial distance to the ellipse outline
    const nx = (p[0] - cx) / rx, ny = (p[1] - cy) / ry;
    const r = Math.hypot(nx, ny);
    eEll += Math.abs(r - 1) * Math.min(rx, ry);
  }
  eRect /= P.length; eEll /= P.length;
  const size = Math.min(w, h);
  const best = eRect < eEll ? "rect" : "ellipse";
  const err = Math.min(eRect, eEll);
  if (err > 0.12 * size) return null;
  return { type: best, points: [[x0, y0], [x1, y1]] };
}
