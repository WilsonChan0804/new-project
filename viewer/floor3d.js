/* Site study, stage 4 in 3D: the floor group's typical floor stacked to its
 * storeys. The lower floors as slabs and a box a unit (coloured by its
 * plan); the top floor open, its walls at their thickness with the doors
 * cut through, the core's RC walls, the lift shafts and the staircases'
 * flights and landings, so the layout reads from above.
 * Plan frame (x along the corridor, y across, y down) -> three (x, -y, z up).
 */
import * as FC from "./floorcore.js";

let V = null, R = null;   // three, and the one scene

const COLS = [0xf6d7a7, 0xcfe3f5, 0xd9ecd0, 0xf3cfd6, 0xe3dbf3, 0xf7e7b4, 0xd2ece9, 0xf2d9c4];

export async function show(host, r, o) {
  if (!V) V = await import("./vendor/three-fragments.js");
  if (!R) R = scene(V.THREE, V.OrbitControls, host);
  R.build(r, o || {});
  return R;
}
export function hide() { if (R) R.paused = true; }

function scene(THREE, Orbit, host) {
  const rd = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  rd.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.appendChild(rd.domElement);
  rd.domElement.className = "fl3-cv";
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0xf3f5f8);
  const cam = new THREE.PerspectiveCamera(36, 1, 0.5, 5000); cam.up.set(0, 0, 1);
  const ctl = new Orbit(cam, rd.domElement);
  ctl.enableDamping = true;
  sc.add(new THREE.HemisphereLight(0xffffff, 0xdfe3e8, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-60, -90, 140); sc.add(sun);
  let grp = null, first = true, key = "";
  const self = { paused: false };
  const resize = () => {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    rd.setSize(w, h, false); rd.domElement.style.width = "100%"; rd.domElement.style.height = "100%";
    cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  const loop = () => { if (!self.paused && !host.hidden) { ctl.update(); rd.render(sc, cam); } requestAnimationFrame(loop); };
  loop();
  const mats = new Map();
  const mat = (c, op = 1) => { const k = c + ":" + op; if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: c, transparent: op < 1, opacity: op, depthWrite: op >= 1 })); return mats.get(k); };
  const edgeM = new THREE.LineBasicMaterial({ color: 0x3c4650, transparent: true, opacity: 0.55 });
  const box = (g, x0, y0, x1, y1, z0, z1, m, edges) => {
    const w = x1 - x0, d = y1 - y0, h = z1 - z0;
    if (w < 1e-4 || d < 1e-4 || h < 1e-4) return;
    const geo = new THREE.BoxGeometry(w, d, h), me = new THREE.Mesh(geo, m);
    me.position.set(x0 + w / 2, -(y0 + d / 2), z0 + h / 2);
    g.add(me);
    if (edges) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeM); l.position.copy(me.position); g.add(l); }
  };
  const slab = (g, poly, z0, z1, m) => {
    const sh = new THREE.Shape(); poly.forEach(([x, y], i) => (i ? sh.lineTo(x, -y) : sh.moveTo(x, -y))); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false });
    const me = new THREE.Mesh(geo, m); me.position.z = z0; g.add(me);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeM); l.position.z = z0; g.add(l);
  };
  self.build = (r, o) => {
    self.paused = false;
    if (grp) { sc.remove(grp); grp.traverse((q) => q.geometry && q.geometry.dispose()); }
    grp = new THREE.Group(); sc.add(grp);
    const H = Number(o.storeyH) || 3.15, N = Math.max(1, Math.round(Number(o.storeys) || 1)), show = o.show || "all", cw = r.coreWall || 0.25, sl = 0.2;
    const colOf = new Map();
    for (const q of r.placed) if (!colOf.has(q.name)) colOf.set(q.name, COLS[colOf.size % COLS.length]);
    const lower = show === "top" ? 0 : N - 1;
    // each leg of the floor in its own direction (one leg: as it is)
    const legs = r.legs && r.legs.length ? r.legs : [{ r, xf: { ox: 0, oy: 0, ang: 0 } }];
    const legGroup = (l) => { const g = new THREE.Group(); g.position.set(l.xf.ox, -l.xf.oy, 0); g.rotation.z = -l.xf.ang; grp.add(g); return g; };
    const LG = legs.map(legGroup);
    // the lower floors: a slab, a box a unit, the core all the way up
    for (let k = 0; k < lower; k++) {
      const z = k * H;
      slab(grp, r.F.poly, z, z + sl, mat(0xc9ced4));
      legs.forEach((l, li) => {
        for (const q of l.r.placed) box(LG[li], q.x, q.y, q.x + q.w, q.y + q.h, z + sl, z + H, mat(colOf.get(q.name), 0.92), true);
        for (const c of l.r.core) if (c.kind !== "passage") box(LG[li], c.x, c.y, c.x + c.w, c.y + c.h, z + sl, z + H, mat(0x9aa1a8), true);
      });
    }
    // the top floor, open
    const z = lower * H, wz = z + sl, wh = Math.min(H - sl, 2.8);
    slab(grp, r.F.poly, z, wz, mat(0xd4d8dd));
    const rcM = mat(0xa3a9b0), blkM = mat(0xeeeae0), pcM = mat(0xa9b0b7);
    if (r.corrPoly && r.multi) slab(grp, r.corrPoly, wz, wz + 0.01, mat(0xe6e9ee));
    // the walls drawn on the floor (any angle): their solid parts, a lintel over each opening
    for (const w of r.walls || []) {
      for (const q of w.pieces || []) slab(grp, q, wz, wz + wh, w.m === "blk" ? blkM : rcM);
      for (const o of w.ops || []) if (o.type !== "window" && o.type !== "cw") slab(grp, [o.A[0], o.A[1], o.B[1], o.B[0]], wz + 2.1, wz + wh, blkM);
    }
    legs.forEach((l, li) => buildLeg(LG[li], l.r, z, wz, wh));
    function buildLeg(grp, r) {
    box(grp, r.corr ? r.corr.x0 : 0, r.y0, r.corr ? r.corr.x1 : r.L, r.y1, wz, wz + 0.01, mat(0xe6e9ee));
    for (const q of r.placed) {
      // the floor of each room, by its use
      for (const rm of q.rooms) box(grp, q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h, wz, wz + 0.02, mat(/BATH|ENS/.test(rm.kind) ? 0xd9ebe7 : colOf.get(q.name)));
      for (const e of q.extras || []) box(grp, q.x + e.x, q.y + e.y, q.x + e.x + e.w, q.y + e.y + e.h, wz, wz + 0.02, mat(0xe8edf2));
      // its walls, cut by its doors, a lintel over each door
      const PW = FC.placedWalls(q);
      for (const w of PW.rects) box(grp, w.x0, w.y0, w.x1, w.y1, wz, wz + wh, w.m === "blk" ? blkM : w.m === "pc" ? pcM : rcM, true);
      for (const s2 of PW.ops) {
        const v = Math.abs(s2.x1 - s2.x2) < 1e-6, t = 0.15;
        if (v) box(grp, s2.x1 - t / 2, s2.y1, s2.x1 + t / 2, s2.y2, wz + 2.1, wz + wh, blkM);
        else box(grp, s2.x1, s2.y1 - t / 2, s2.x2, s2.y1 + t / 2, wz + 2.1, wz + wh, blkM);
      }
    }
    // the core: its RC walls (shared where pieces meet, cut by the doors), the lift cars, the staircases' flights
    for (const w of FC.coreWallRects(r.core, cw)) box(grp, w.x0, w.y0, w.x1, w.y1, wz, z + H, rcM, true);
    for (const c of r.core) for (const d of c.doors || []) { const x0 = Math.min(d.H[0], d.O[0]), x1 = Math.max(d.H[0], d.O[0]); box(grp, x0, d.H[1] - cw / 2, x1, d.H[1] + cw / 2, wz + 2.1, z + H, rcM); }
    for (const c of r.core) {
      if (c.kind === "passage" || c.kind === "lobby") { for (const q of c.rects || [{ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }]) box(grp, q.x0, q.y0, q.x1, q.y1, wz, wz + 0.01, mat(0xe6e9ee)); continue; }
      const t = Number(c.wt) > 0 ? Number(c.wt) : cw;
      if (c.kind === "lift") box(grp, c.x + t + 0.3, c.y + t + 0.3, c.x + c.w - t - 0.3, c.y + c.h - t - 0.3, wz, wz + 2.4, mat(0xb7b3e0, 0.85), true);
      if (c.kind === "stair" && r.stair) stairs(grp, r.stair, c.x + t, c.y + t, c.w - 2 * t, c.h - 2 * t, z, H, box, mat(0xc8c2b6));
      if (c.kind === "refuse" || c.kind === "riser") box(grp, c.x + t, c.y + t, c.x + c.w - t, c.y + c.h - t, wz, wz + 0.02, mat(c.kind === "refuse" ? 0xe3e7d3 : 0xf1d6d6));
    }
    // the E&M regions left over
    for (const zr of r.residuals || []) for (const c of zr.cells) {
      if (!c.poly) { box(grp, c.x0, c.y0, c.x1, c.y1, wz, wz + 0.03, mat(0xf3dfae)); continue; }
      // a cell cut by a slanted edge: only its part inside the plate
      const sh = new THREE.Shape(); c.poly.forEach(([x, y], i) => (i ? sh.lineTo(x, -y) : sh.moveTo(x, -y))); sh.closePath();
      const me = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }), mat(0xf3dfae)); me.position.z = wz; grp.add(me);
    }
    }
    // the camera: once, from the south-west above, the whole stack in view
    const k2 = `${r.L}|${r.D}|${N}|${show}`;
    if (first || k2 !== key) {
      const top = N * H, one = show === "top", span = one ? Math.max(r.L, r.D) : Math.max(r.L, r.D, top);
      const tz = one ? z : top * 0.5, d = one ? [-0.25, -0.6, 0.95] : [-0.8, -1.5, 0.55];
      ctl.target.set(r.L / 2, -r.D / 2, tz);
      cam.position.set(r.L / 2 + span * d[0], -r.D / 2 + span * d[1], tz + span * d[2]);
      cam.far = span * 20; cam.updateProjectionMatrix();
      first = false; key = k2;
    }
    resize();
  };
  return self;
}

/* a staircase's flights a storey: from z up to z + H; dog-leg (two flights, half landing) or scissor (one flight each way, a wall between) */
function stairs(g, st, X, Y, W, D, z, H, box, m) {
  const along = D >= W, L = along ? D : W, A = along ? W : D;
  const k = L / (st.run + 2 * st.landing), run = st.run * k, land = st.landing * k, rH = H / st.risers;
  const fw = st.type === "scissor" ? (A - 0.2) / 2 : (A - st.well * (A / st.W)) / 2;
  // u along the flights from the far end, v across
  const B = (u0, u1, v0, v1, z0, z1) => (along ? box(g, X + v0, Y + u0, X + v1, Y + u1, z0, z1, m, true) : box(g, X + u0, Y + v0, X + u1, Y + v1, z0, z1, m, true));
  const flight = (v0, v1, nR, zFrom, up) => {
    // nR risers over the run, from the floor landing (u large) towards u small when up, else the other way
    const nT = Math.max(1, nR - 1), gu = run / nT;
    for (let i = 0; i < nT; i++) {
      const u0 = up ? land + run - (i + 1) * gu : land + i * gu;
      B(u0, u0 + gu, v0, v1, zFrom + (i + 1) * rH - 0.18, zFrom + (i + 1) * rH);
    }
  };
  if (st.type === "scissor") {
    flight(0, fw, st.risers, z, true);
    flight(A - fw, A, st.risers, z, false);
    B(0, land, 0, A, z + H - 0.18, z + H); B(land + run, L, 0, A, z - 0.18 + 0.2, z + 0.2);
    B(land, land + run, fw, A - fw, z, z + H);
  } else {
    flight(0, fw, st.n1, z, true);
    const l2 = st.land2 || 0, zL = z + st.n1 * rH, zHalf = zL + l2 * rH;
    if (l2) {
      // the half landing in three: its first part, one tread, then the part two risers up
      const wl = A - 2 * fw;
      B(0, land, 0, fw, zL - 0.18, zL); B(0, land, fw, fw + wl, zL + rH - 0.18, zL + rH); B(0, land, fw + wl, A, zHalf - 0.18, zHalf);
    } else B(0, land, 0, A, zL - 0.18, zL);
    flight(A - fw, A, st.n2, zHalf, false);
    B(land + run, L, 0, A, z + 0.02, z + 0.2);
  }
}
