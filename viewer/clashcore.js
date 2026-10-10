/* Clash and clearance geometry - plain numbers, no page and no three.js, so
 * the same code runs in the clash worker (clash-worker.js) and in a test.
 *
 * An element is { tris, box }: tris a Float32Array of world positions, 9
 * numbers per triangle (metres, Y up), box [minX, minY, minZ, maxX, maxY,
 * maxZ].
 *
 * How two elements are judged:
 *   1. their boxes must overlap by the tolerance on every axis (pairs());
 *   2. where their surfaces cross (triangle against triangle) tells where
 *      they meet; touching - a wall butting against another, a floor on a
 *      wall - is not crossing and is let go;
 *   3. how deep they overlap: rays along X, Y and Z through the crossing
 *      zone, each counting how far it runs inside both solids at once; the
 *      depth is the smallest of the three longest runs (an overlap thinner
 *      than the tolerance in any direction is a touch, not a clash);
 *   4. one wholly inside the other (a pipe buried in a wall) has no
 *      crossing: one of its points is tested inside the other instead.
 * Elements whose surfaces are not closed (a single sheet) cannot be tested
 * for inside or outside; for them a crossing longer than the tolerance is
 * the clash, without a depth.
 */

const EPS = 1e-9;

/* ------------------------------------------------------------ broad pass */

/* Pairs of boxes that overlap by at least `need` on every axis (need < 0:
   come within -need of each other). a, b: arrays of boxes; same = the two
   lists are one (each pair once, never an element with itself). Returns
   [[ia, ib], ...]. A sweep along X keeps it near-linear. */
export function pairs(a, b, need, same) {
  const out = [];
  const ev = [];
  for (let i = 0; i < a.length; i++) if (a[i]) ev.push([a[i][0], 0, i]);
  if (!same) for (let i = 0; i < b.length; i++) if (b[i]) ev.push([b[i][0], 1, i]);
  ev.sort((x, y) => x[0] - y[0]);
  const act = [[], []];
  const ov = (p, q) => Math.min(p[3], q[3]) - Math.max(p[0], q[0]) >= need
    && Math.min(p[4], q[4]) - Math.max(p[1], q[1]) >= need
    && Math.min(p[5], q[5]) - Math.max(p[2], q[2]) >= need;
  for (const [x, s, i] of ev) {
    const bx = s ? b[i] : a[i];
    // drop the ones that end before this one starts (allowing for need)
    for (const L of act) {
      let w = 0;
      for (let k = 0; k < L.length; k++) {
        const o = L[k];
        const ob = o[0] ? b[o[1]] : a[o[1]];
        if (ob[3] - x >= need) L[w++] = o;
      }
      L.length = w;
    }
    if (same) {
      for (const o of act[0]) if (ov(a[o[1]], bx)) out.push(o[1] < i ? [o[1], i] : [i, o[1]]);
    } else {
      for (const o of act[1 - s]) {
        const ob = o[0] ? b[o[1]] : a[o[1]];
        if (ov(ob, bx)) out.push(s ? [o[1], i] : [i, o[1]]);
      }
    }
    act[same ? 0 : s].push([s, i]);
  }
  return out;
}

/* ------------------------------------------------------------- helpers */

export function boxOfTris(t) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], y = t[i + 1], z = t[i + 2];
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
  }
  return b;
}
const boxAnd = (p, q) => [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2]),
  Math.min(p[3], q[3]), Math.min(p[4], q[4]), Math.min(p[5], q[5])];
const boxEmpty = (b) => !(b[0] <= b[3] && b[1] <= b[4] && b[2] <= b[5]);
const grow = (b, d) => [b[0] - d, b[1] - d, b[2] - d, b[3] + d, b[4] + d, b[5] + d];

/* Each edge used an even number of times (after joining vertices that sit
   within 0.1 mm): a closed surface, which has an inside. */
export function isClosed(t) {
  const q = (v) => Math.round(v * 1e4);
  const key = (i) => q(t[i]) + "," + q(t[i + 1]) + "," + q(t[i + 2]);
  const edges = new Map();
  for (let i = 0; i < t.length; i += 9) {
    const k = [key(i), key(i + 3), key(i + 6)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;    // a sliver
    for (let e = 0; e < 3; e++) {
      const a = k[e], b = k[(e + 1) % 3];
      const ek = a < b ? a + "|" + b : b + "|" + a;
      edges.set(ek, (edges.get(ek) || 0) + 1);
    }
  }
  if (!edges.size) return false;
  for (const n of edges.values()) if (n & 1) return false;
  return true;
}

/* The triangles (indices) of t that touch box b. */
function trisIn(t, b) {
  const out = [];
  for (let i = 0; i < t.length; i += 9) {
    const x0 = Math.min(t[i], t[i + 3], t[i + 6]), x1 = Math.max(t[i], t[i + 3], t[i + 6]);
    if (x1 < b[0] || x0 > b[3]) continue;
    const y0 = Math.min(t[i + 1], t[i + 4], t[i + 7]), y1 = Math.max(t[i + 1], t[i + 4], t[i + 7]);
    if (y1 < b[1] || y0 > b[4]) continue;
    const z0 = Math.min(t[i + 2], t[i + 5], t[i + 8]), z1 = Math.max(t[i + 2], t[i + 5], t[i + 8]);
    if (z1 < b[2] || z0 > b[5]) continue;
    out.push(i);
  }
  return out;
}

/* ------------------------------------------------ where the surfaces cross */

/* Triangle p (at t1[i]) against triangle q (at t2[j]): the segment where
   they cross, or null. Touching (one only meets the other's plane, or both
   lie in one plane) is not crossing. */
function triCross(t1, i, t2, j, out) {
  const a0x = t1[i], a0y = t1[i + 1], a0z = t1[i + 2];
  const a1x = t1[i + 3], a1y = t1[i + 4], a1z = t1[i + 5];
  const a2x = t1[i + 6], a2y = t1[i + 7], a2z = t1[i + 8];
  const b0x = t2[j], b0y = t2[j + 1], b0z = t2[j + 2];
  const b1x = t2[j + 3], b1y = t2[j + 4], b1z = t2[j + 5];
  const b2x = t2[j + 6], b2y = t2[j + 7], b2z = t2[j + 8];
  // plane of q
  let ux = b1x - b0x, uy = b1y - b0y, uz = b1z - b0z, vx = b2x - b0x, vy = b2y - b0y, vz = b2z - b0z;
  let nbx = uy * vz - uz * vy, nby = uz * vx - ux * vz, nbz = ux * vy - uy * vx;
  let l = Math.hypot(nbx, nby, nbz); if (l < 1e-14) return false;
  nbx /= l; nby /= l; nbz /= l;
  const db = -(nbx * b0x + nby * b0y + nbz * b0z);
  const da0 = nbx * a0x + nby * a0y + nbz * a0z + db;
  const da1 = nbx * a1x + nby * a1y + nbz * a1z + db;
  const da2 = nbx * a2x + nby * a2y + nbz * a2z + db;
  const e = 1e-6;
  if (!(Math.min(da0, da1, da2) < -e && Math.max(da0, da1, da2) > e)) return false;
  // plane of p
  ux = a1x - a0x; uy = a1y - a0y; uz = a1z - a0z; vx = a2x - a0x; vy = a2y - a0y; vz = a2z - a0z;
  let nax = uy * vz - uz * vy, nay = uz * vx - ux * vz, naz = ux * vy - uy * vx;
  l = Math.hypot(nax, nay, naz); if (l < 1e-14) return false;
  nax /= l; nay /= l; naz /= l;
  const dA = -(nax * a0x + nay * a0y + naz * a0z);
  const db0 = nax * b0x + nay * b0y + naz * b0z + dA;
  const db1 = nax * b1x + nay * b1y + naz * b1z + dA;
  const db2 = nax * b2x + nay * b2y + naz * b2z + dA;
  if (!(Math.min(db0, db1, db2) < -e && Math.max(db0, db1, db2) > e)) return false;
  // where each triangle meets the other's plane: a segment on the common line
  const segA = cutSeg(a0x, a0y, a0z, a1x, a1y, a1z, a2x, a2y, a2z, da0, da1, da2);
  const segB = cutSeg(b0x, b0y, b0z, b1x, b1y, b1z, b2x, b2y, b2z, db0, db1, db2);
  if (!segA || !segB) return false;
  const Dx = nay * nbz - naz * nby, Dy = naz * nbx - nax * nbz, Dz = nax * nby - nay * nbx;
  const pr = (k, s) => s[k] * Dx + s[k + 1] * Dy + s[k + 2] * Dz;
  let ta0 = pr(0, segA), ta1 = pr(3, segA), tb0 = pr(0, segB), tb1 = pr(3, segB);
  let A0 = 0, A1 = 3;
  if (ta0 > ta1) { [ta0, ta1] = [ta1, ta0]; A0 = 3; A1 = 0; }
  if (tb0 > tb1) [tb0, tb1] = [tb1, tb0];
  const s0 = Math.max(ta0, tb0), s1 = Math.min(ta1, tb1);
  if (s1 - s0 <= 1e-9) return false;
  const span = ta1 - ta0;
  const at = (s, o) => {
    const f = span > 1e-12 ? (s - ta0) / span : 0;
    out[o] = segA[A0] + (segA[A1] - segA[A0]) * f;
    out[o + 1] = segA[A0 + 1] + (segA[A1 + 1] - segA[A0 + 1]) * f;
    out[o + 2] = segA[A0 + 2] + (segA[A1 + 2] - segA[A0 + 2]) * f;
  };
  at(s0, 0); at(s1, 3);
  return true;
}
function cutSeg(x0, y0, z0, x1, y1, z1, x2, y2, z2, d0, d1, d2) {
  const p = [];
  const edge = (ax, ay, az, bx, by, bz, da, dbb) => {
    if ((da < 0 && dbb > 0) || (da > 0 && dbb < 0)) {
      const u = da / (da - dbb);
      p.push(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);
    } else if (da === 0) p.push(ax, ay, az);
  };
  edge(x0, y0, z0, x1, y1, z1, d0, d1);
  edge(x1, y1, z1, x2, y2, z2, d1, d2);
  edge(x2, y2, z2, x0, y0, z0, d2, d0);
  if (p.length < 6) return null;
  return p.slice(0, 6);
}

/* Every crossing of the two surfaces inside region r: a box round them all
   and their total length. */
function crossings(A, B, r) {
  const ta = trisIn(A.tris, r), tb = trisIn(B.tris, r);
  if (!ta.length || !tb.length) return null;
  // a grid over the region, so each triangle meets only its neighbours
  const n = Math.max(1, Math.min(24, Math.round(Math.cbrt(Math.min(ta.length, tb.length)))));
  const sx = (r[3] - r[0]) / n || 1, sy = (r[4] - r[1]) / n || 1, sz = (r[5] - r[2]) / n || 1;
  const cell = (v, lo, s) => Math.max(0, Math.min(n - 1, Math.floor((v - lo) / s)));
  const grid = new Map();
  const T = B.tris;
  for (const j of tb) {
    const x0 = cell(Math.min(T[j], T[j + 3], T[j + 6]), r[0], sx), x1 = cell(Math.max(T[j], T[j + 3], T[j + 6]), r[0], sx);
    const y0 = cell(Math.min(T[j + 1], T[j + 4], T[j + 7]), r[1], sy), y1 = cell(Math.max(T[j + 1], T[j + 4], T[j + 7]), r[1], sy);
    const z0 = cell(Math.min(T[j + 2], T[j + 5], T[j + 8]), r[2], sz), z1 = cell(Math.max(T[j + 2], T[j + 5], T[j + 8]), r[2], sz);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = (x * n + y) * n + z;
      let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(j);
    }
  }
  const S = A.tris, seg = new Float64Array(6), box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let len = 0, count = 0;
  const done = new Set();
  for (const i of ta) {
    const x0 = cell(Math.min(S[i], S[i + 3], S[i + 6]), r[0], sx), x1 = cell(Math.max(S[i], S[i + 3], S[i + 6]), r[0], sx);
    const y0 = cell(Math.min(S[i + 1], S[i + 4], S[i + 7]), r[1], sy), y1 = cell(Math.max(S[i + 1], S[i + 4], S[i + 7]), r[1], sy);
    const z0 = cell(Math.min(S[i + 2], S[i + 5], S[i + 8]), r[2], sz), z1 = cell(Math.max(S[i + 2], S[i + 5], S[i + 8]), r[2], sz);
    done.clear();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const L = grid.get((x * n + y) * n + z);
      if (!L) continue;
      for (const j of L) {
        if (done.has(j)) continue;
        done.add(j);
        if (!triCross(S, i, T, j, seg)) continue;
        count++;
        len += Math.hypot(seg[3] - seg[0], seg[4] - seg[1], seg[5] - seg[2]);
        for (let o = 0; o < 6; o += 3) {
          if (seg[o] < box[0]) box[0] = seg[o]; if (seg[o + 1] < box[1]) box[1] = seg[o + 1]; if (seg[o + 2] < box[2]) box[2] = seg[o + 2];
          if (seg[o] > box[3]) box[3] = seg[o]; if (seg[o + 1] > box[4]) box[4] = seg[o + 1]; if (seg[o + 2] > box[5]) box[5] = seg[o + 2];
        }
      }
    }
  }
  return count ? { box, len, count } : null;
}

/* ----------------------------------------------------- inside and depth */

/* Where a line along `axis` through (pu, pv) (the other two coordinates,
   in order) crosses the triangles listed. */
function lineHits(t, list, axis, pu, pv, out) {
  const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
  out.length = 0;
  for (const i of list) {
    const au = t[i + u], av = t[i + v], bu = t[i + 3 + u], bv = t[i + 3 + v], cu = t[i + 6 + u], cv = t[i + 6 + v];
    const d = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(d) < 1e-14) continue;               // seen edge-on
    const l1 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / d;
    if (l2 < 0 || l1 + l2 > 1) continue;
    out.push(l1 * t[i + axis] + l2 * t[i + 3 + axis] + (1 - l1 - l2) * t[i + 6 + axis]);
  }
  out.sort((x, y) => x - y);
  // the same crossing found on two triangles (the line through their edge)
  let w = 0;
  for (let k = 0; k < out.length; k++) if (!w || out[k] - out[w - 1] > 1e-7) out[w++] = out[k];
  out.length = w;
  return out;
}

/* Is point p inside the closed surface t? Lines along the three axes vote,
   so a line grazing an edge cannot decide on its own. */
export function inside(t, p) {
  let yes = 0;
  const hits = [];
  const all = [];
  for (let i = 0; i < t.length; i += 9) all.push(i);
  for (let axis = 0; axis < 3; axis++) {
    const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
    lineHits(t, all, axis, p[u] + 1.13e-6, p[v] - 0.71e-6, hits);
    let before = 0;
    for (const h of hits) if (h < p[axis]) before++;
    if (before & 1) yes++;
  }
  return yes >= 2;
}

/* Along `axis`, over a grid of lines spanning region r in the other two
   directions: the longest stretch any line spends inside both A and B,
   and the middle of the overlap (weighted). */
function runs(A, B, r, axis, step) {
  const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
  const lu = r[3 + u] - r[u], lv = r[3 + v] - r[v];
  const nu = Math.max(1, Math.min(48, Math.ceil(lu / step))), nv = Math.max(1, Math.min(48, Math.ceil(lv / step)));
  const su = lu / nu, sv = lv / nv;
  // only the triangles the lines can meet (the whole length of each line)
  const band = [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];
  band[u] = r[u]; band[3 + u] = r[3 + u]; band[v] = r[v]; band[3 + v] = r[3 + v];
  const ta = trisIn(A.tris, band), tb = trisIn(B.tris, band);
  const ha = [], hb = [];
  let best = 0, wsum = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < nu; i++) {
    // a little off the grid, so lines do not run along the model's own edges
    const pu = r[u] + (i + 0.5) * su + su * 0.0137;
    for (let j = 0; j < nv; j++) {
      const pv = r[v] + (j + 0.5) * sv - sv * 0.0089;
      lineHits(A.tris, ta, axis, pu, pv, ha);
      if (ha.length < 2) continue;
      lineHits(B.tris, tb, axis, pu, pv, hb);
      if (hb.length < 2) continue;
      // stretches inside each (pairs of crossings), then where both are
      let ia = 0, ib = 0;
      while (ia + 1 < ha.length && ib + 1 < hb.length) {
        const s = Math.max(ha[ia], hb[ib]), e = Math.min(ha[ia + 1], hb[ib + 1]);
        if (e > s) {
          const L = e - s;
          if (L > best) best = L;
          const m = (s + e) / 2;
          const p = [0, 0, 0]; p[axis] = m; p[u] = pu; p[v] = pv;
          cx += p[0] * L; cy += p[1] * L; cz += p[2] * L; wsum += L;
        }
        if (ha[ia + 1] < hb[ib + 1]) ia += 2; else ib += 2;
      }
    }
  }
  return { best, centre: wsum ? [cx / wsum, cy / wsum, cz / wsum] : null };
}

/* ------------------------------------------------------- nearest distance */

function ptTri(px, py, pz, t, i) {
  // the nearest point of triangle i to p (Ericson, Real-Time Collision Detection 5.1.5)
  const ax = t[i], ay = t[i + 1], az = t[i + 2], bx = t[i + 3], by = t[i + 4], bz = t[i + 5], cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const w = d1 / (d1 - d3); return Math.hypot(apx - w * abx, apy - w * aby, apz - w * abz); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return Math.hypot(apx - w * acx, apy - w * acy, apz - w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz)));
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return Math.hypot(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}
function segSeg(p1, q1, p2, q2) {
  // nearest distance between two segments (Ericson 5.1.9)
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= EPS && e <= EPS) return Math.hypot(...r);
  if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return Math.hypot(p1[0] + d1[0] * s - p2[0] - d2[0] * t, p1[1] + d1[1] * s - p2[1] - d2[1] * t, p1[2] + d1[2] * s - p2[2] - d2[2] * t);
}
/* The nearest two elements come, if it is under `limit` (else Infinity),
   and the point midway. */
function nearest(A, B, limit) {
  const ra = trisIn(A.tris, grow(B.box, limit)), rb = trisIn(B.tris, grow(A.box, limit));
  if (!ra.length || !rb.length) return null;
  let best = limit, at = null;
  const S = A.tris, T = B.tris;
  const tb = (j) => [Math.min(T[j], T[j + 3], T[j + 6]), Math.min(T[j + 1], T[j + 4], T[j + 7]), Math.min(T[j + 2], T[j + 5], T[j + 8]),
    Math.max(T[j], T[j + 3], T[j + 6]), Math.max(T[j + 1], T[j + 4], T[j + 7]), Math.max(T[j + 2], T[j + 5], T[j + 8])];
  const boxesB = rb.map(tb);
  let work = 0;
  for (const i of ra) {
    const bi = [Math.min(S[i], S[i + 3], S[i + 6]), Math.min(S[i + 1], S[i + 4], S[i + 7]), Math.min(S[i + 2], S[i + 5], S[i + 8]),
      Math.max(S[i], S[i + 3], S[i + 6]), Math.max(S[i + 1], S[i + 4], S[i + 7]), Math.max(S[i + 2], S[i + 5], S[i + 8])];
    for (let k = 0; k < rb.length; k++) {
      const bj = boxesB[k];
      if (bi[0] - bj[3] > best || bj[0] - bi[3] > best || bi[1] - bj[4] > best || bj[1] - bi[4] > best
        || bi[2] - bj[5] > best || bj[2] - bi[5] > best) continue;
      const j = rb[k];
      if (++work > 4e6) return best < limit ? { dist: best, point: at } : null;   // enough
      for (let o = 0; o < 9; o += 3) {
        let d = ptTri(S[i + o], S[i + o + 1], S[i + o + 2], T, j);
        if (d < best) { best = d; at = [S[i + o], S[i + o + 1], S[i + o + 2]]; }
        d = ptTri(T[j + o], T[j + o + 1], T[j + o + 2], S, i);
        if (d < best) { best = d; at = [T[j + o], T[j + o + 1], T[j + o + 2]]; }
      }
      for (let ea = 0; ea < 9; ea += 3) {
        const p1 = [S[i + ea], S[i + ea + 1], S[i + ea + 2]], q1i = i + (ea + 3) % 9;
        const q1 = [S[q1i], S[q1i + 1], S[q1i + 2]];
        for (let eb = 0; eb < 9; eb += 3) {
          const p2 = [T[j + eb], T[j + eb + 1], T[j + eb + 2]], q2i = j + (eb + 3) % 9;
          const d = segSeg(p1, q1, p2, [T[q2i], T[q2i + 1], T[q2i + 2]]);
          if (d < best) { best = d; at = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2]; }
        }
      }
    }
  }
  return best < limit ? { dist: best, point: at } : null;
}

/* --------------------------------------------------------------- a pair */

/* Judge one pair. opt: { tol (m, the overlap that counts), clear (m, the
   gap wanted between them; 0 = not checked) }. Returns null (fine) or
   { kind: "hard" | "inside" | "cross" | "clearance", depth, dist, point,
     box }. */
export function judge(A, B, opt) {
  const tol = opt.tol || 0, clear = opt.clear || 0;
  if (A.closed === undefined) A.closed = isClosed(A.tris);
  if (B.closed === undefined) B.closed = isClosed(B.tris);
  const r = boxAnd(A.box, B.box);
  if (!boxEmpty(grow(r, 1e-6))) {
    const cr = crossings(A, B, grow(r, 1e-6));
    if (cr) {
      if (!A.closed || !B.closed) {
        const big = Math.max(cr.box[3] - cr.box[0], cr.box[4] - cr.box[1], cr.box[5] - cr.box[2]);
        if (big >= Math.max(tol, 1e-3)) {
          return { kind: "cross", depth: null, dist: 0, box: cr.box,
                   point: [(cr.box[0] + cr.box[3]) / 2, (cr.box[1] + cr.box[4]) / 2, (cr.box[2] + cr.box[5]) / 2] };
        }
      } else {
        // the overlap lies round the crossings: measure it there
        const zone = boxAnd(grow(cr.box, Math.max(tol, 0.005)), r);
        const dims = [zone[3] - zone[0], zone[4] - zone[1], zone[5] - zone[2]];
        const step = Math.max(Math.min(tol > 0 ? tol / 2 : 0.005, Math.max(...dims) / 8), 0.002);
        let depth = Infinity, centre = null;
        for (let ax = 0; ax < 3; ax++) {
          const q = runs(A, B, zone, ax, step);
          depth = Math.min(depth, q.best);
          if (!centre && q.centre) centre = q.centre;
          if (depth < tol) break;
        }
        if (depth >= tol && depth > 1e-4 && isFinite(depth)) {
          return { kind: "hard", depth, dist: 0, box: cr.box,
                   point: centre || [(cr.box[0] + cr.box[3]) / 2, (cr.box[1] + cr.box[4]) / 2, (cr.box[2] + cr.box[5]) / 2] };
        }
        if (!clear) return null;
      }
    } else if (A.closed && B.closed) {
      // no crossing: one inside the other?
      const inBox = (p, q) => p[0] >= q[0] && p[1] >= q[1] && p[2] >= q[2] && p[3] <= q[3] && p[4] <= q[4] && p[5] <= q[5];
      for (const [X, Y] of [[A, B], [B, A]]) {
        if (!inBox(X.box, grow(Y.box, 1e-6))) continue;
        const p = [X.tris[0], X.tris[1], X.tris[2]];
        // a point a hair inside X, off its corner
        const c = [(X.box[0] + X.box[3]) / 2, (X.box[1] + X.box[4]) / 2, (X.box[2] + X.box[5]) / 2];
        const q = [p[0] + (c[0] - p[0]) * 1e-3, p[1] + (c[1] - p[1]) * 1e-3, p[2] + (c[2] - p[2]) * 1e-3];
        if (inside(Y.tris, q)) {
          const depth = Math.min(X.box[3] - X.box[0], X.box[4] - X.box[1], X.box[5] - X.box[2]);
          if (depth >= tol) return { kind: "inside", depth, dist: 0, box: X.box.slice(), point: c };
        }
      }
    }
  }
  if (clear > 0) {
    const nr = nearest(A, B, clear);
    if (nr) return { kind: "clearance", depth: null, dist: nr.dist, point: nr.point, box: null };
  }
  return null;
}
