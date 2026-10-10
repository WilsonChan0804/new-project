/* Headroom geometry - plain numbers, no page (head-worker.js runs it; a test
 * can too).
 *
 * Where people stand: the top of each solid part of the walkable elements
 * (floors, stair treads and landings, ramps), sampled on a grid. From each
 * such point a line goes straight up to the first thing overhead (a slab's
 * underside, a beam, a duct, a ceiling, a stair above). The clear height is
 * the distance. Anything within 0.3 m above the standing point is not
 * "overhead" (a floor finish laid on a slab, the nosing of the next tread).
 *
 * Elements: { k (key), tris (Float32Array, 9 per triangle, world metres,
 * Y up), box, stair (true: the stair or ramp limit applies) }.
 */

const NEAR = 0.3;

/* Where a vertical line at (x, z) meets the triangles listed: the heights. */
function hitsAt(t, list, x, z, out) {
  out.length = 0;
  for (const i of list) {
    const ax = t[i], az = t[i + 2], bx = t[i + 3], bz = t[i + 5], cx = t[i + 6], cz = t[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;                 // a vertical face
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (l2 < 0 || l1 + l2 > 1) continue;
    out.push(l1 * t[i + 1] + l2 * t[i + 4] + (1 - l1 - l2) * t[i + 7]);
  }
  out.sort((p, q) => p - q);
  let w = 0;
  for (let k = 0; k < out.length; k++) if (!w || out[k] - out[w - 1] > 1e-5) out[w++] = out[k];
  out.length = w;
  return out;
}

/* The height where a vertical line at (x, z) meets triangle i, or NaN. */
function hitY(t, i, x, z) {
  const ax = t[i], az = t[i + 2], bx = t[i + 3], bz = t[i + 5], cx = t[i + 6], cz = t[i + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return NaN;
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  if (l1 < 0 || l1 > 1) return NaN;
  const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  if (l2 < 0 || l1 + l2 > 1) return NaN;
  return l1 * t[i + 1] + l2 * t[i + 4] + (1 - l1 - l2) * t[i + 7];
}

/* Triangles binned on a plan grid (cell metres), for "what is over (x, z)". */
function bins(els, cell) {
  const map = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  els.forEach((e, n) => {
    const t = e.tris;
    for (let i = 0; i < t.length; i += 9) {
      const x0 = Math.floor(Math.min(t[i], t[i + 3], t[i + 6]) / cell), x1 = Math.floor(Math.max(t[i], t[i + 3], t[i + 6]) / cell);
      const z0 = Math.floor(Math.min(t[i + 2], t[i + 5], t[i + 8]) / cell), z1 = Math.floor(Math.max(t[i + 2], t[i + 5], t[i + 8]) / cell);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) continue;      // a huge flat triangle seen edge-on: skip
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) {
        const k = key(a, b);
        let L = map.get(k); if (!L) map.set(k, (L = []));
        L.push(n, i);
      }
    }
  });
  return { at: (x, z) => map.get(key(Math.floor(x / cell), Math.floor(z / cell))) || null };
}

/* opt: { step (m, floors), stairStep (m), fine (m: under narrow things
   overhead), yLo, yHi (standing heights checked), limit, stairLimit (m),
   maxH (m: above this, open space) }.
   Returns { points: [[x, y, z, h, fail(1)/close(2), walk index, above
   index, size]], zones: [...], checked } */
export function scan(walk, above, opt) {
  const step = opt.step || 0.25, stairStep = opt.stairStep || 0.2, fine = opt.fine || 0.1;
  const maxH = opt.maxH || 8, yLo = opt.yLo == null ? -Infinity : opt.yLo, yHi = opt.yHi == null ? Infinity : opt.yHi;
  const BA = bins(above, 0.5), BW = bins(walk, 1.0);
  const walkKeys = new Set(walk.map((w) => w.k));
  const top = Math.max(opt.limit || 0, opt.stairLimit || 0) + 0.1;

  /* Where to look: a grid over the floors, stairs and ramps (on a common
     lattice, so neighbouring floors meet), and a finer one under anything
     narrow hanging low (a duct, a pipe, a beam) that the grid could miss. */
  const cols = new Map();
  const add = (x, z, s) => { const k = Math.round(x / s * 8) + "," + Math.round(z / s * 8); if (!cols.has(k)) cols.set(k, [x, z, s]); };
  for (const w of walk) {
    const s = w.stair ? stairStep : step;
    for (let x = Math.ceil(w.box[0] / s) * s + s * 0.013; x < w.box[3]; x += s)
      for (let z = Math.ceil(w.box[2] / s) * s + s * 0.007; z < w.box[5]; z += s) add(x, z, s);
  }
  if (isFinite(yLo)) {
    for (const a of above) {
      const b = a.box, dx = b[3] - b[0], dz = b[5] - b[2];
      if (walkKeys.has(a.k) || b[1] > yHi + top || b[4] < yLo) continue;
      if (Math.min(dx, dz) >= step * 2) continue;              // wide: the grid sees it
      // a few lines across its narrow side, the grid's spacing along it
      const across = (w) => Math.max(fine, w / Math.max(2, Math.ceil(w / 0.15)));
      const sx = dx < step * 2 ? across(dx) : step, sz = dz < step * 2 ? across(dz) : step;
      for (let x = b[0] + sx / 2; x < b[3]; x += sx) for (let z = b[2] + sz / 2; z < b[5]; z += sz) add(x, z, Math.min(sx, sz));
    }
  }

  const hw = [], ha = [], pts = [];
  let checked = 0;
  for (const [x, z, s] of cols.values()) {
    const LW = BW.at(x, z);
    if (!LW) continue;
    // the walkable elements over this column, each with its triangles here
    const per = new Map();
    for (let k = 0; k < LW.length; k += 2) {
      let L = per.get(LW[k]); if (!L) per.set(LW[k], (L = []));
      L.push(LW[k + 1]);
    }
    for (const [wi, list] of per) {
      const w = walk[wi];
      hitsAt(w.tris, list, x, z, hw);
      if (!hw.length) continue;
      // the top of each solid part (pairs of crossings); one crossing: a sheet
      const tops = [];
      if (hw.length >= 2 && hw.length % 2 === 0) for (let k = 1; k < hw.length; k += 2) tops.push(hw[k]);
      else tops.push(hw[hw.length - 1]);
      for (const y0 of tops) {
        if (y0 < yLo || y0 > yHi) continue;
        checked++;
        const LA = BA.at(x, z);
        let best = Infinity, who = -1, covered = false;
        if (LA) {
          for (let k = 0; k < LA.length; k += 2) {
            const n = LA[k], i = LA[k + 1];
            const e = above[n], tt = e.tris;
            if (Math.max(tt[i + 1], tt[i + 4], tt[i + 7]) <= y0 - 0.01) continue;
            if (Math.min(tt[i + 1], tt[i + 4], tt[i + 7]) >= y0 + best) continue;      // no nearer than what is found
            const y = hitY(tt, i, x, z);
            if (!(y >= y0 - 0.01)) continue;
            // something walkable resting right on it (a finish on a slab, a
            // stair on a floor): nobody stands here - its own top counts instead
            if (e.k !== w.k && walkKeys.has(e.k) && y <= y0 + 0.02) { covered = true; break; }
            // own geometry close above (a stair's own soffit) is not overhead
            const near = e.k === w.k ? 0.6 : NEAR;
            if (y > y0 + near && y - y0 < best) { best = y - y0; who = n; }
          }
        }
        if (covered || !(best < maxH)) continue;    // covered, or open above
        // lower than anyone uses (under a WC, a bench, in a duct or a void, the
        // end of a stair running in under the floor above): not a space
        if (opt.minSpace && best < opt.minSpace) continue;
        const lim = w.stair ? opt.stairLimit : opt.limit;
        const flag = best < lim ? 1 : best < lim + 0.1 ? 2 : 0;
        if (flag) pts.push([x, y0, z, best, flag, wi, who, s]);
      }
    }
  }
  return { points: pts, zones: zones(pts), checked };
}

/* Failing points that touch (plan neighbours, about the same height): one
   zone each, the lowest point first. */
function zones(pts) {
  const fail = pts.map((p, i) => i).filter((i) => pts[i][4] === 1);
  const parent = new Map(fail.map((i) => [i, i]));
  const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
  const cell = 0.5;
  const grid = new Map();
  const ck = (x, z) => Math.floor(x / cell) + "," + Math.floor(z / cell);
  for (const i of fail) { const k = ck(pts[i][0], pts[i][2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  for (const i of fail) {
    const p = pts[i], cx = Math.floor(p[0] / cell), cz = Math.floor(p[2] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const j of grid.get((cx + a) + "," + (cz + b)) || []) {
        if (j <= i) continue;
        const q = pts[j], reach = Math.max(p[7], q[7]) * 1.5;
        if (Math.abs(p[0] - q[0]) <= reach && Math.abs(p[2] - q[2]) <= reach && Math.abs(p[1] - q[1]) < 0.5) parent.set(find(j), find(i));
      }
    }
  }
  const by = new Map();
  for (const i of fail) { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(i); }
  const out = [];
  for (const list of by.values()) {
    let low = list[0];
    // the area: the squares' union on a 0.1 m grid (coarse and fine overlap)
    const cells = new Set();
    const bx = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const i of list) {
      const p = pts[i];
      if (p[3] < pts[low][3]) low = i;
      const h = p[7] / 2;
      for (let cx = Math.round((p[0] - h) * 10); cx < Math.round((p[0] + h) * 10); cx++)
        for (let cz = Math.round((p[2] - h) * 10); cz < Math.round((p[2] + h) * 10); cz++) cells.add(cx * 1e6 + cz);
      bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.min(bx[1], p[1]); bx[2] = Math.min(bx[2], p[2]);
      bx[3] = Math.max(bx[3], p[0]); bx[4] = Math.max(bx[4], p[1] + p[3]); bx[5] = Math.max(bx[5], p[2]);
    }
    const p = pts[low];
    out.push({ n: list.length, area: +(cells.size / 100).toFixed(2), minH: +p[3].toFixed(3), at: [p[0], p[1], p[2]],
               walk: p[5], above: p[6], box: bx });
  }
  out.sort((a, b) => a.minH - b.minH);
  return out;
}
