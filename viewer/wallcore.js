/* Site study: walls, corridors and lobbies drawn at any angle - a polyline
 * (its centre line, or one face) at a thickness, mitred at its bends.
 * Pure, tested in tests/walls.test.mjs.
 *
 * A wall: {path: [[x, y], ...], t, m: "rc"|"blk", just: "c"|"l"|"r",
 *          openings: [{seg, at, w, type, hinge, swing}]}
 *   just "c": the path is the wall's centre line; "l" / "r": the path is the
 *   face on its left / right (looking along the path, y down as on the plan),
 *   the wall standing to the other side.
 *   an opening: on segment seg, at metres from the segment's start to the
 *   opening's start, w wide; type door | door2 | sliding | sliding2 | opening
 *   | window | cw.
 */
const r3 = (x) => Math.round(x * 1000) / 1000;
const n = (v, d = 0) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));
const EPS = 1e-9;

/* the faces' offsets from the path: [left, right] (positive to the left) */
export function offsets(t, just) {
  return just === "l" ? [0, -t] : just === "r" ? [t, 0] : [t / 2, -t / 2];
}
/* a segment's unit direction and its left normal (y down: left of the direction on screen) */
export function dirOf(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return { d: [dx / L, dy / L], nl: [dy / L, -dx / L], L: Math.hypot(dx, dy) };
}
export const segLen = (path, k) => Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
export const pathLen = (path) => path.slice(1).reduce((s, q, k) => s + segLen(path, k), 0);

/* the line offset by o to the left: through a point, along d */
function lineAt(a, b, o) {
  const { d, nl } = dirOf(a, b);
  return { p: [a[0] + nl[0] * o, a[1] + nl[1] * o], d };
}
function meet(l1, l2) {
  const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
  if (Math.abs(den) < 1e-9) return null;
  const dx = l2.p[0] - l1.p[0], dy = l2.p[1] - l1.p[1];
  const s = (dx * l2.d[1] - dy * l2.d[0]) / den;
  return [l1.p[0] + l1.d[0] * s, l1.p[1] + l1.d[1] * s];
}
/* the path offset by o, mitred at its bends (a sharp bend's mitre held to 4 times the offset) */
export function offsetPath(path, o) {
  const P = cleanPath(path), out = [];
  if (P.length < 2) return out;
  for (let i = 0; i < P.length; i++) {
    if (i === 0) { const l = lineAt(P[0], P[1], o); out.push(l.p); continue; }
    if (i === P.length - 1) { const l = lineAt(P[i - 1], P[i], o), { L } = dirOf(P[i - 1], P[i]); out.push([l.p[0] + l.d[0] * L, l.p[1] + l.d[1] * L]); continue; }
    const l1 = lineAt(P[i - 1], P[i], o), l2 = lineAt(P[i], P[i + 1], o), m = meet(l1, l2);
    if (!m || Math.hypot(m[0] - P[i][0], m[1] - P[i][1]) > Math.max(4 * Math.abs(o), 0.05)) { const { L } = dirOf(P[i - 1], P[i]); out.push([l1.p[0] + l1.d[0] * L, l1.p[1] + l1.d[1] * L]); }
    else out.push(m);
  }
  return out;
}
/* consecutive repeated points and straight-through points taken out */
export function cleanPath(path) {
  const out = [];
  for (const q of path || []) {
    const p = [n(q[0]), n(q[1])];
    if (out.length && Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) < 1e-6) continue;
    out.push(p);
  }
  return out;
}

/* the wall's outline: the left face forward, the right face back -> [[x, y], ...] */
export function wallPoly(path, t, just = "c") {
  const [a, b] = offsets(n(t, 0.2), just);
  const L = offsetPath(path, a), R = offsetPath(path, b);
  return [...L, ...R.reverse()].map((p) => [r3(p[0]), r3(p[1])]);
}
/* each segment's own quadrilateral, mitred where it meets the next: [[A0, A1, B1, B0], ...] */
export function segQuads(path, t, just = "c") {
  const P = cleanPath(path), [a, b] = offsets(n(t, 0.2), just);
  const L = offsetPath(P, a), R = offsetPath(P, b), out = [];
  for (let k = 0; k < P.length - 1; k++) out.push([L[k], L[k + 1], R[k + 1], R[k]]);
  return out;
}
export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
/* the wall's area: its segments' quadrilaterals (a self-crossing path counts its crossing twice) */
export function wallArea(w) { return segQuads(w.path, w.t, w.just).reduce((s, q) => s + polyArea(q), 0); }

/* a segment's solid parts between its openings: [[s0, s1], ...] in metres from its start */
export function solidParts(len, ops) {
  const cuts = (ops || []).map((o) => [Math.max(0, n(o.at)), Math.min(len, n(o.at) + n(o.w, 0.9))]).filter((c) => c[1] > c[0]).sort((p, q) => p[0] - q[0]);
  const out = []; let s = 0;
  for (const [a, b] of cuts) { if (a > s + 1e-6) out.push([s, a]); s = Math.max(s, b); }
  if (len > s + 1e-6) out.push([s, len]);
  return out;
}
/* the wall drawn: its solid pieces as polygons (the ends of a piece by an opening square to the wall, the others mitred) and its openings' frames */
export function wallPieces(w) {
  const P = cleanPath(w.path), Q = segQuads(P, w.t, w.just), [oa, ob] = offsets(n(w.t, 0.2), w.just), out = [], ops = [];
  for (let k = 0; k < P.length - 1; k++) {
    const len = segLen(P, k), { d, nl } = dirOf(P[k], P[k + 1]), my = (w.openings || []).filter((o) => o.seg === k);
    const at = (s, o) => [P[k][0] + d[0] * s + nl[0] * o, P[k][1] + d[1] * s + nl[1] * o];
    for (const [s0, s1] of solidParts(len, my)) {
      const q = Q[k];
      const A0 = s0 < 1e-6 ? q[0] : at(s0, oa), B0 = s0 < 1e-6 ? q[3] : at(s0, ob);
      const A1 = s1 > len - 1e-6 ? q[1] : at(s1, oa), B1 = s1 > len - 1e-6 ? q[2] : at(s1, ob);
      out.push({ seg: k, pts: [A0, A1, B1, B0] });
    }
    for (const o of my) {
      const s0 = Math.max(0, n(o.at)), s1 = Math.min(len, n(o.at) + n(o.w, 0.9));
      ops.push(Object.assign({}, o, { a: at(s0, (oa + ob) / 2), b: at(s1, (oa + ob) / 2), A: [at(s0, oa), at(s1, oa)], B: [at(s0, ob), at(s1, ob)], d, nl, t: n(w.t, 0.2) }));
    }
  }
  return { pieces: out, ops };
}

/* the point on a path nearest to pt: {seg, s (along it), d (distance), p, side (+ left)} */
export function nearestOnPath(pt, path) {
  const P = cleanPath(path);
  let best = null;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1], { d, nl, L } = dirOf(a, b);
    const s = Math.max(0, Math.min(L, (pt[0] - a[0]) * d[0] + (pt[1] - a[1]) * d[1]));
    const p = [a[0] + d[0] * s, a[1] + d[1] * s], dist = Math.hypot(pt[0] - p[0], pt[1] - p[1]);
    if (!best || dist < best.d) best = { seg: k, s, d: dist, p, side: Math.sign((pt[0] - p[0]) * nl[0] + (pt[1] - p[1]) * nl[1]) };
  }
  return best;
}
/* the wall nearest to pt within maxD of its face: {i, seg, s, d, p, side}, the distance from its middle line less half its thickness */
export function nearestOnWalls(pt, walls, maxD = 0.5) {
  let best = null;
  (walls || []).forEach((w, i) => {
    const [oa, ob] = offsets(n(w.t, 0.2), w.just), mid = (oa + ob) / 2;
    const c = offsetPath(w.path, mid), q = nearestOnPath(pt, c); if (!q) return;
    const dd = Math.max(0, q.d - n(w.t, 0.2) / 2);
    if (dd <= maxD && (!best || dd < best.d)) best = Object.assign(q, { i, d: dd });
  });
  return best;
}

/* the wall cut in two at segment seg, s along it: [first, second] (openings to their parts) */
export function splitWall(w, seg, s) {
  const P = cleanPath(w.path); if (seg < 0 || seg >= P.length - 1) return [w];
  const { d } = dirOf(P[seg], P[seg + 1]), len = segLen(P, seg);
  if (s <= 1e-3 && seg === 0) return [w];
  if (s >= len - 1e-3 && seg === P.length - 2) return [w];
  const X = [r3(P[seg][0] + d[0] * s), r3(P[seg][1] + d[1] * s)];
  const p1 = [...P.slice(0, seg + 1), X], p2 = [X, ...P.slice(seg + 1)];
  const base = { t: w.t, m: w.m, just: w.just };
  const o1 = [], o2 = [];
  for (const o of w.openings || []) {
    if (o.seg < seg || (o.seg === seg && n(o.at) + n(o.w, 0.9) <= s + 1e-6)) o1.push(Object.assign({}, o));
    else if (o.seg === seg && n(o.at) >= s - 1e-6) o2.push(Object.assign({}, o, { seg: 0, at: r3(n(o.at) - s) }));
    else if (o.seg > seg) o2.push(Object.assign({}, o, { seg: o.seg - seg }));
    // an opening the cut runs through is dropped
  }
  return [Object.assign({}, base, { path: cleanPath(p1), openings: o1 }), Object.assign({}, base, { path: cleanPath(p2), openings: o2 })].filter((q) => q.path.length >= 2);
}
/* a wall's path run the other way (its openings measured from the other end, its justification swapped) */
export function reverseWall(w) {
  const P = cleanPath(w.path).slice().reverse(), m = P.length - 1;
  const ops = (w.openings || []).map((o) => { const k = m - 1 - o.seg, len = segLen(P, k); return Object.assign({}, o, { seg: k, at: r3(len - n(o.at) - n(o.w, 0.9)), hinge: o.hinge === "end" ? "start" : o.hinge ? "end" : o.hinge }); });
  return Object.assign({}, w, { path: P, openings: ops, just: w.just === "l" ? "r" : w.just === "r" ? "l" : w.just });
}
/* two walls whose ends meet (within tol) made one polyline; null when they do not meet */
export function joinWalls(a, b, tol = 0.01) {
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
  const A = cleanPath(a.path), B = cleanPath(b.path);
  let x = a, y = b;
  if (near(A[A.length - 1], B[0])) { /* as they are */ }
  else if (near(A[A.length - 1], B[B.length - 1])) y = reverseWall(b);
  else if (near(A[0], B[B.length - 1])) { x = b; y = a; }
  else if (near(A[0], B[0])) { x = reverseWall(a); }
  else return null;
  const X = cleanPath(x.path), Y = cleanPath(y.path), k0 = X.length - 1;
  let path = [...X, ...Y.slice(1)];
  const ops = [...(x.openings || []).map((o) => Object.assign({}, o)), ...(y.openings || []).map((o) => Object.assign({}, o, { seg: o.seg + k0 }))];
  // a straight run through the joint: one segment, the openings of the second measured on
  const i = k0;
  if (i > 0 && i < path.length - 1) {
    const d1 = dirOf(path[i - 1], path[i]).d, d2 = dirOf(path[i], path[i + 1]).d;
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-6 && d1[0] * d2[0] + d1[1] * d2[1] > 0) {
      const l1 = segLen(path, i - 1);
      for (const o of ops) { if (o.seg === i) { o.seg = i - 1; o.at = r3(n(o.at) + l1); } else if (o.seg > i) o.seg -= 1; }
      path = [...path.slice(0, i), ...path.slice(i + 1)];
    }
  }
  return Object.assign({}, x, { path, openings: ops });
}
/* the walls left when segment k is taken out: 0, 1 or 2 */
export function deleteSegment(w, k) {
  const P = cleanPath(w.path); if (k < 0 || k >= P.length - 1) return [w];
  const base = { t: w.t, m: w.m, just: w.just }, out = [];
  if (k > 0) out.push(Object.assign({}, base, { path: P.slice(0, k + 1), openings: (w.openings || []).filter((o) => o.seg < k).map((o) => Object.assign({}, o)) }));
  if (k < P.length - 2) out.push(Object.assign({}, base, { path: P.slice(k + 1), openings: (w.openings || []).filter((o) => o.seg > k).map((o) => Object.assign({}, o, { seg: o.seg - k - 1 })) }));
  return out;
}
/* the next point drawn from prev: its angle held to steps of step degrees (0: free) */
export function snapAngle(prev, pt, step = 15) {
  if (!prev || !step) return pt;
  const dx = pt[0] - prev[0], dy = pt[1] - prev[1], L = Math.hypot(dx, dy);
  if (L < 1e-9) return pt;
  const a = Math.round(Math.atan2(dy, dx) / (step * Math.PI / 180)) * step * Math.PI / 180;
  return [r3(prev[0] + Math.cos(a) * L), r3(prev[1] + Math.sin(a) * L)];
}
/* where two segments cross: {s (along the first, 0..1), u (along the second)} or null */
export function segCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < EPS) return null;
  const q = [c[0] - a[0], c[1] - a[1]], t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { s: t, u } : null;
}
/* a polygon clipped to the half-plane where (x - p) . nv >= 0 (Sutherland-Hodgman) */
export function clipHalf(poly, p, nv) {
  const f = (q) => (q[0] - p[0]) * nv[0] + (q[1] - p[1]) * nv[1], out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length], fa = f(A), fb = f(B);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
  }
  return out;
}
export function inPoly(P, x, y) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/* a wall's opening put where a point falls on segment seg (its middle at s), kept inside the segment */
export function placeOpening(w, seg, s, o) {
  const len = segLen(cleanPath(w.path), seg), ow = Math.min(n(o.w, 0.9), len);
  return Object.assign({}, o, { seg, w: r3(ow), at: r3(Math.max(0, Math.min(len - ow, s - ow / 2))) });
}
