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

/* Is the surface closed (a solid, with an inside), and which way do its
   faces point? A closed surface encloses the same signed volume whatever
   point it is measured from; an open one does not. Unlike pairing edges,
   this does not mind the way Revit triangulates each face on its own (a
   corner of one face on the edge of the next) or positions stored to the
   nearest millimetre or so, piece by piece. sign: 1 faces out, -1 in. */
export function solidity(t) {
  if (!t.length) return { closed: false, sign: 1, vol: 0 };
  const b = boxOfTris(t);
  const vol = (rx, ry, rz) => {
    let v = 0;
    for (let i = 0; i < t.length; i += 9) {
      const ax = t[i] - rx, ay = t[i + 1] - ry, az = t[i + 2] - rz;
      const bx = t[i + 3] - rx, by = t[i + 4] - ry, bz = t[i + 5] - rz;
      const cx = t[i + 6] - rx, cy = t[i + 7] - ry, cz = t[i + 8] - rz;
      v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return v / 6;
  };
  const v1 = vol(b[0], b[1], b[2]), v2 = vol(b[3], b[4], b[5]);
  const closed = Math.abs(v1) > 1e-9 && Math.abs(v1 - v2) <= 0.01 * Math.abs(v1) + 1e-9;
  return { closed, sign: v1 >= 0 ? 1 : -1, vol: Math.abs(v1) };
}
export function isClosed(t) { return solidity(t).closed; }

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
  // within 2 mm of the other's plane is on it: touching, give or take how
  // positions are stored (to about a millimetre)
  const e = 0.002;
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
   in order) crosses the triangles listed (out), and which way: +1 going
   in, -1 coming out (sg; from the way each triangle faces, times the
   element's sign). */
function lineHits(t, list, axis, pu, pv, out, sg, sign) {
  const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
  out.length = 0;
  if (sg) sg.length = 0;
  for (const i of list) {
    const au = t[i + u], av = t[i + v], bu = t[i + 3 + u], bv = t[i + 3 + v], cu = t[i + 6 + u], cv = t[i + 6 + v];
    const d = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(d) < 1e-14) continue;               // seen edge-on
    const l1 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / d;
    if (l2 < 0 || l1 + l2 > 1) continue;
    out.push(l1 * t[i + axis] + l2 * t[i + 3 + axis] + (1 - l1 - l2) * t[i + 6 + axis]);
    if (sg) {
      // the triangle's normal along the line: against it, the line goes in
      const n = (bu - au) * (cv - av) - (bv - av) * (cu - au);
      const along = axis === 1 ? -n : n;           // (u, v, axis) is left-handed for Y
      sg.push(along < 0 ? sign : -sign);
    }
  }
  // in order along the line (a handful of hits: insertion sort, both lists)
  for (let k = 1; k < out.length; k++) {
    const x = out[k], g = sg ? sg[k] : 0;
    let j = k - 1;
    while (j >= 0 && out[j] > x) { out[j + 1] = out[j]; if (sg) sg[j + 1] = sg[j]; j--; }
    out[j + 1] = x; if (sg) sg[j + 1] = g;
  }
  // the same crossing found on two triangles (the line through their edge)
  let w = 0;
  for (let k = 0; k < out.length; k++) {
    if (w && out[k] - out[w - 1] <= 1e-7 && (!sg || sg[k] === sg[w - 1])) continue;
    out[w] = out[k]; if (sg) sg[w] = sg[k]; w++;
  }
  out.length = w;
  if (sg) sg.length = w;
  return out;
}

/* The stretches of a line inside an element: from its crossings in order
   and their directions, where the count of ins over outs is above 0 - so
   the face two layers share (out of one, into the next) changes nothing. */
function spans(hits, sg, out) {
  out.length = 0;
  let w = 0, start = 0;
  for (let k = 0; k < hits.length; k++) {
    const was = w;
    w += sg[k];
    if (was <= 0 && w > 0) {
      // back in within 2 mm (layers stored a hair apart): one stretch
      if (out.length && hits[k] - out[out.length - 1] < 0.002) start = out.splice(-2, 2)[0];
      else start = hits[k];
    } else if (was > 0 && w <= 0) out.push(start, hits[k]);
  }
  return out;
}

/* Is point p inside the closed surface t (facing sign)? Lines along the
   three axes vote, so a line grazing an edge cannot decide on its own. */
export function inside(t, p, sign = 1) {
  let yes = 0;
  const hits = [], sg = [];
  const all = [];
  for (let i = 0; i < t.length; i += 9) all.push(i);
  for (let axis = 0; axis < 3; axis++) {
    const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
    lineHits(t, all, axis, p[u] + 1.13e-6, p[v] - 0.71e-6, hits, sg, sign);
    let w = 0;
    for (let k = 0; k < hits.length; k++) if (hits[k] < p[axis]) w += sg[k];
    if (w > 0) yes++;
  }
  return yes >= 2;
}

/* Along `axis`, over a grid of lines spanning region r in the other two
   directions: the longest stretch any line spends inside both A and B,
   and the middle of the overlap (weighted). Each line meets only the
   triangles over its own cell. */
function runs(A, B, r, axis, step) {
  const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
  const lu = r[3 + u] - r[u], lv = r[3 + v] - r[v];
  const nu = Math.max(1, Math.min(16, Math.ceil(lu / step))), nv = Math.max(1, Math.min(16, Math.ceil(lv / step)));
  const su = lu / nu, sv = lv / nv;
  const band = [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];
  band[u] = r[u]; band[3 + u] = r[3 + u]; band[v] = r[v]; band[3 + v] = r[3 + v];
  // the triangles over each cell of the lines' grid
  const cellsOf = (t, list) => {
    const cells = Array.from({ length: nu * nv }, () => []);
    for (const i of list) {
      const iu0 = Math.max(0, Math.floor((Math.min(t[i + u], t[i + 3 + u], t[i + 6 + u]) - r[u]) / su));
      const iu1 = Math.min(nu - 1, Math.floor((Math.max(t[i + u], t[i + 3 + u], t[i + 6 + u]) - r[u]) / su));
      const iv0 = Math.max(0, Math.floor((Math.min(t[i + v], t[i + 3 + v], t[i + 6 + v]) - r[v]) / sv));
      const iv1 = Math.min(nv - 1, Math.floor((Math.max(t[i + v], t[i + 3 + v], t[i + 6 + v]) - r[v]) / sv));
      for (let a = iu0; a <= iu1; a++) for (let b = iv0; b <= iv1; b++) cells[a * nv + b].push(i);
    }
    return cells;
  };
  const ca = cellsOf(A.tris, trisIn(A.tris, band)), cb = cellsOf(B.tris, trisIn(B.tris, band));
  const ha = [], hb = [], ga = [], gb = [], sa = [], sb = [];
  let best = 0, wsum = 0, cx = 0, cy = 0, cz = 0, vol = 0;
  const ob = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nu; i++) {
    // a little off the grid, so lines do not run along the model's own edges
    const pu = r[u] + (i + 0.5) * su + su * 0.0137;
    for (let j = 0; j < nv; j++) {
      const la = ca[i * nv + j], lb = cb[i * nv + j];
      if (la.length < 2 || lb.length < 2) continue;
      const pv = r[v] + (j + 0.5) * sv - sv * 0.0089;
      lineHits(A.tris, la, axis, pu, pv, ha, ga, A.sign);
      if (ha.length < 2) continue;
      lineHits(B.tris, lb, axis, pu, pv, hb, gb, B.sign);
      if (hb.length < 2) continue;
      // stretches inside each, then where both are
      spans(ha, ga, sa); spans(hb, gb, sb);
      let ia = 0, ib = 0;
      while (ia + 1 < sa.length && ib + 1 < sb.length) {
        const s0 = Math.max(sa[ia], sb[ib]), e = Math.min(sa[ia + 1], sb[ib + 1]);
        if (e > s0) {
          const L = e - s0;
          if (L > best) best = L;
          vol += L * su * sv;
          // the overlap's extent (its two ends on this line)
          for (const w of [s0, e]) {
            const q = [0, 0, 0]; q[axis] = w; q[u] = pu; q[v] = pv;
            for (let d = 0; d < 3; d++) { if (q[d] < ob[d]) ob[d] = q[d]; if (q[d] > ob[3 + d]) ob[3 + d] = q[d]; }
          }
          const m = (s0 + e) / 2;
          const p = [0, 0, 0]; p[axis] = m; p[u] = pu; p[v] = pv;
          cx += p[0] * L; cy += p[1] * L; cz += p[2] * L; wsum += L;
        }
        if (sa[ia + 1] < sb[ib + 1]) ia += 2; else ib += 2;
      }
    }
  }
  return { best, vol, obox: ob, centre: wsum ? [cx / wsum, cy / wsum, cz / wsum] : null };
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
  const ra = trisIn(A.tris, grow(B.tbox || B.box, limit)), rb = trisIn(B.tris, grow(A.tbox || A.box, limit));
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

/* A point well inside solid X: the middle of where a line through the
   middle of its box runs inside it (an L-shaped element's box middle can
   be outside it). */
function innerPoint(X) {
  const all = [];
  for (let i = 0; i < X.tris.length; i += 9) all.push(i);
  const c = [(X.tbox[0] + X.tbox[3]) / 2, (X.tbox[1] + X.tbox[4]) / 2, (X.tbox[2] + X.tbox[5]) / 2];
  const h = [], g = [], sp = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
    lineHits(X.tris, all, axis, c[u] + 1.13e-5, c[v] - 0.71e-5, h, g, X.sign);
    spans(h, g, sp);
    let best = -1, at = 0;
    for (let k = 0; k + 1 < sp.length; k += 2) if (sp[k + 1] - sp[k] > best) { best = sp[k + 1] - sp[k]; at = (sp[k] + sp[k + 1]) / 2; }
    if (best > 0) { const p = c.slice(); p[axis] = at; p[u] += 1.13e-5; p[v] -= 0.71e-5; return p; }
  }
  return null;
}

/* Walls, floors, columns, beams, stairs meeting - a join - or a real
   clash? A join's overlap is long in one direction at most: a wall through
   a slab (wall thickness x slab thickness x the wall's length), a finish
   under a wall, a beam into a column, a landing into a wall. A clash's is a
   sheet (two walls side by side, overlapping along their length) or most of
   one of them (a duplicate). From the overlap's volume, its depth (the
   thinnest way through) and its length (corner to corner), its middle size
   is volume / (depth x length): small for a join, whichever way the
   building turns. */
function isJoin(A, B, r, depth) {
  const small = Math.min(A.vol || 0, B.vol || 0);
  if (!(small > 0)) return false;
  const step = Math.max(Math.max(r[3] - r[0], r[5] - r[2]) / 16, 0.005);
  const q = runs(A, B, r, 1, step);
  if (!(q.vol > 0)) return true;
  if (q.vol >= 0.8 * small) return false;               // most of one: a duplicate
  const o = q.obox;
  const len = Math.hypot(o[3] - o[0] + step, o[4] - o[1], o[5] - o[2] + step);
  const mid = q.vol / (Math.max(depth, 1e-3) * Math.max(len, 1e-3));
  return mid <= Math.max(0.25 * len, 0.75);
}

/* How far an open surface Q goes into the solid P: points over Q's
   triangles near the region, those inside P, and the farthest of them from
   P's surface. */
function penetration(P, Q, r) {
  const qt = trisIn(Q.tris, r), pt = trisIn(P.tris, grow(r, 0.5));
  if (!qt.length || !pt.length) return 0;
  const T = Q.tris, S = P.tris;
  let best = 0, n = 0;
  const per = Math.max(1, Math.floor(600 / qt.length));
  for (const i of qt) {
    const e = Math.max(Math.hypot(T[i + 3] - T[i], T[i + 4] - T[i + 1], T[i + 5] - T[i + 2]),
                       Math.hypot(T[i + 6] - T[i], T[i + 7] - T[i + 1], T[i + 8] - T[i + 2]));
    const k = Math.max(1, Math.min(per, Math.ceil(e / 0.05), 10));
    for (let a = 0; a <= k; a++) for (let b = 0; a + b <= k; b++) {
      const l1 = a / k, l2 = b / k, l3 = 1 - l1 - l2;
      const p = [l1 * T[i] + l2 * T[i + 3] + l3 * T[i + 6], l1 * T[i + 1] + l2 * T[i + 4] + l3 * T[i + 7], l1 * T[i + 2] + l2 * T[i + 5] + l3 * T[i + 8]];
      if (p[0] < r[0] || p[1] < r[1] || p[2] < r[2] || p[0] > r[3] || p[1] > r[4] || p[2] > r[5]) continue;
      if (++n > 1500) return best;
      if (!inside(S, p, P.sign)) continue;
      let d = Infinity;
      for (const j of pt) { const q = ptTri(p[0], p[1], p[2], S, j); if (q < d) d = q; }
      if (d > best) best = d;
    }
  }
  return best;
}

/* Judge one pair. opt: { tol (m, the overlap that counts), clear (m, the
   gap wanted between them; 0 = not checked), open (true: report open
   surfaces crossing each other, which have no depth) }. Returns null
   (fine) or { kind: "hard" | "inside" | "cross" | "clearance", depth, dist,
   point, box }. */
export function judge(A, B, opt) {
  const tol = opt.tol || 0, clear = opt.clear || 0;
  for (const X of [A, B]) {
    if (X.closed === undefined) { const q = solidity(X.tris); X.closed = q.closed; X.sign = q.sign; X.vol = q.vol; }
    // the box of the triangles themselves (the model's box can be a hair
    // smaller: positions are stored rounded)
    if (!X.tbox) X.tbox = boxOfTris(X.tris);
  }
  const r = grow(boxAnd(A.tbox, B.tbox), 0.005);
  const mid = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  if (!boxEmpty(grow(r, 1e-6))) {
    const cr = crossings(A, B, grow(r, 1e-6));
    if (cr) {
      if (A.closed && B.closed) {
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
          // walls, floors, beams ... meeting: a join, unless one is mostly in the other
          if (opt.join && isJoin(A, B, r, depth)) return null;
          return { kind: "hard", depth, dist: 0, box: cr.box, point: centre || mid(cr.box) };
        }
      } else if (opt.join) {
        // fabric with an open surface: no volume to weigh - taken as a join
      } else if (A.closed || B.closed) {
        // an open surface against a solid: how deep it goes in
        const [P, Q] = A.closed ? [A, B] : [B, A];
        const depth = penetration(P, Q, grow(cr.box, Math.max(tol, 0.01)));
        if (depth >= tol && depth > 1e-4) return { kind: "hard", depth, dist: 0, box: cr.box, point: mid(cr.box), open: true };
      } else if (opt.open) {
        const big = Math.max(cr.box[3] - cr.box[0], cr.box[4] - cr.box[1], cr.box[5] - cr.box[2]);
        if (big >= Math.max(tol, 1e-3)) return { kind: "cross", depth: null, dist: 0, box: cr.box, point: mid(cr.box) };
      }
      if (!clear) return null;
    } else if (A.closed && B.closed) {
      // no crossing: one inside the other?
      const inBox = (p, q) => p[0] >= q[0] && p[1] >= q[1] && p[2] >= q[2] && p[3] <= q[3] && p[4] <= q[4] && p[5] <= q[5];
      for (const [X, Y] of [[A, B], [B, A]]) {
        if (!inBox(X.tbox, grow(Y.tbox, 0.005))) continue;
        const c = mid(X.tbox);
        const q = innerPoint(X) || c;
        if (inside(Y.tris, q, Y.sign)) {
          const depth = Math.min(X.tbox[3] - X.tbox[0], X.tbox[4] - X.tbox[1], X.tbox[5] - X.tbox[2]);
          if (depth >= tol) return { kind: "inside", depth, dist: 0, box: X.tbox.slice(), point: c };
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
