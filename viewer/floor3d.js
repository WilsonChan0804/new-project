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
  ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };   // the middle button pans
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
  const slab0 = (g, poly, z0, z1, m) => {
    const sh = new THREE.Shape(); poly.forEach(([x, y], i) => (i ? sh.lineTo(x, -y) : sh.moveTo(x, -y))); sh.closePath();
    const me = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false }), m); me.position.z = z0; g.add(me);
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
    const later = [];
    for (let k = 0; k < lower; k++) {
      const z = k * H;
      slab(grp, r.F.poly, z, z + sl, mat(0xc9ced4));
      legs.forEach((l, li) => {
        for (const q of l.r.placed) {
          // its body (the rooms), not its box: the balcony, UP and A/C platform are not in it, but drawn as themselves
          for (const rm of q.rooms) box(LG[li], q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h, z + sl, z + H, mat(colOf.get(q.name), 0.92), true);
          for (const e of q.extras || []) later.push(() => extra3d(LG[li], q, e, z + sl));
          // its windows and curtain walls on the outside, as glass a little proud of the box
          for (const o of q.ops || []) {
            const ax = q.x + o.a[0], ay = q.y + o.a[1], bx = q.x + o.b[0], by = q.y + o.b[1], vv = Math.abs(ax - bx) < 1e-6, za = z + sl + (o.k === "win" ? 0.9 : 0), zb = z + sl + (o.k === "win" ? 2.2 : H - sl - 0.2);
            // on the rooms' face it is in, a little proud on the side away from the rooms
            const mx = (ax + bx) / 2, my = (ay + by) / 2, inR = (px, py) => q.rooms.some((rm) => px > q.x + rm.x && px < q.x + rm.x + rm.w && py > q.y + rm.y && py < q.y + rm.y + rm.h);
            const out = vv ? (inR(mx - 0.1, my) ? 1 : -1) : (inR(mx, my - 0.1) ? 1 : -1);
            const w0 = FC.placedWalls(q).rects.find((w) => mx >= w.x0 - 0.02 && mx <= w.x1 + 0.02 && my >= w.y0 - 0.02 && my <= w.y1 + 0.02);
            const c = w0 ? (vv ? (out > 0 ? w0.x1 : w0.x0) : (out > 0 ? w0.y1 : w0.y0)) : vv ? ax : ay, e2 = 0.02 * out;
            if (vv) box(LG[li], Math.min(c, c + e2), Math.min(ay, by), Math.max(c, c + e2), Math.max(ay, by), za, zb, mat(0x8fc3ea, 0.6));
            else box(LG[li], Math.min(ax, bx), Math.min(c, c + e2), Math.max(ax, bx), Math.max(c, c + e2), za, zb, mat(0x8fc3ea, 0.6));
          }
        }
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
      for (const o of w.ops || []) {
        const Q = [o.A[0], o.A[1], o.B[1], o.B[0]];
        if (o.type === "window") { slab(grp, Q, wz, wz + 1.0, blkM); slab(grp, Q, wz + 2.3, wz + wh, blkM); glassQuad(grp, o, wz + 1.0, wz + 2.3); }
        else if (o.type === "cw") glassQuad(grp, o, wz, wz + wh, true);
        else if (o.type === "panel") { slab(grp, Q, wz, wz + wh, blkM); }
        else slab(grp, Q, wz + 2.1, wz + wh, blkM);
      }
    }
    const furnM = mat(0xf4f1ea), FIXH = { wardrobe: 2.1, counter: 0.9, sink: 0.9, hob: 0.9, fridge: 1.8, wm: 0.85, bath: 0.55, shower: 0.03, wc: 0.4, basin: 0.85, bed1: 0.5, bed: 0.5, bedq: 0.5, sofa: 0.8, sofa2: 0.8, dining: 0.75, dining6: 0.75, desk: 0.75, tv: 0.5, shoe: 1.0 };
    const glassM = mat(0x8fc3ea, 0.38), frameM = mat(0x3a4048), steelM = mat(0x59616b), louvreM = mat(0x8d949c);
    // a wall (axis-aligned box in a leg) with the windows and curtain walls on it: solid where there is none,
    // a window: a sill to 1.0 m, glass in a frame to 2.3 m, a head above; a curtain wall: glass slab to soffit, mullions about 1.5 m apart, a transom at 1.1 m
    function wall3d(g, w, ops, z0, hh, m) {
      const v = w.y1 - w.y0 > w.x1 - w.x0, a0 = v ? w.y0 : w.x0, a1 = v ? w.y1 : w.x1, c0 = v ? w.x0 : w.y0, c1 = v ? w.x1 : w.y1, cm = (c0 + c1) / 2;
      const on = ops.filter((o) => { const ov = Math.abs(o.a[0] - o.b[0]) < 1e-6; if (ov !== v) return false; const c = v ? o.a[0] : o.a[1]; return c >= c0 - 0.03 && c <= c1 + 0.03; })
        .map((o) => ({ k: o.k, s0: Math.max(a0, Math.min(v ? o.a[1] : o.a[0], v ? o.b[1] : o.b[0])), s1: Math.min(a1, Math.max(v ? o.a[1] : o.a[0], v ? o.b[1] : o.b[0])) })).filter((o) => o.s1 - o.s0 > 0.05).sort((p, q) => p.s0 - q.s0);
      const B = (s0, s1, za, zb, mm, cA = c0, cB = c1, edges = true) => (v ? box(g, cA, s0, cB, s1, za, zb, mm, edges) : box(g, s0, cA, s1, cB, za, zb, mm, edges));
      if (!on.length) return B(a0, a1, z0, z0 + hh, m);
      let at = a0;
      for (const o of on) {
        if (o.s0 > at + 1e-4) B(at, o.s0, z0, z0 + hh, m);
        const gl = 0.012, f = 0.05;
        if (o.k === "win") {
          B(o.s0, o.s1, z0, z0 + 1.0, m); B(o.s0, o.s1, z0 + 2.3, z0 + hh, m);
          B(o.s0, o.s1, z0 + 1.0, z0 + 2.3, glassM, cm - gl, cm + gl, false);
          B(o.s0, o.s0 + f, z0 + 1.0, z0 + 2.3, frameM, cm - 0.03, cm + 0.03, false); B(o.s1 - f, o.s1, z0 + 1.0, z0 + 2.3, frameM, cm - 0.03, cm + 0.03, false);
          B(o.s0, o.s1, z0 + 1.0, z0 + 1.0 + f, frameM, cm - 0.03, cm + 0.03, false); B(o.s0, o.s1, z0 + 2.3 - f, z0 + 2.3, frameM, cm - 0.03, cm + 0.03, false);
        } else {
          B(o.s0, o.s1, z0, z0 + hh, glassM, cm - gl, cm + gl, false);
          const k = Math.max(1, Math.round((o.s1 - o.s0) / 1.5));
          for (let i = 0; i <= k; i++) { const c = Math.min(o.s1 - 0.0375, Math.max(o.s0 + 0.0375, o.s0 + (o.s1 - o.s0) * i / k)); B(c - 0.0375, c + 0.0375, z0, z0 + hh, frameM, cm - 0.075, cm + 0.075, false); }
          B(o.s0, o.s1, z0 + 1.08, z0 + 1.14, frameM, cm - 0.05, cm + 0.05, false);
          B(o.s0, o.s1, z0 + hh - 0.25, z0 + hh, mat(0x6f7882), cm - 0.04, cm + 0.04, false);
        }
        at = Math.max(at, o.s1);
      }
      if (a1 > at + 1e-4) B(at, a1, z0, z0 + hh, m);
    }
    // a floor wall's window or curtain wall at any angle: the glass on its middle line, a frame or mullions
    function glassQuad(g, o, za, zb, cw2) {
      const L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) || 1, d = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], n2 = [-d[1], d[0]];
      const q = (s0, s1, h) => [[o.a[0] + d[0] * s0 + n2[0] * h, o.a[1] + d[1] * s0 + n2[1] * h], [o.a[0] + d[0] * s1 + n2[0] * h, o.a[1] + d[1] * s1 + n2[1] * h], [o.a[0] + d[0] * s1 - n2[0] * h, o.a[1] + d[1] * s1 - n2[1] * h], [o.a[0] + d[0] * s0 - n2[0] * h, o.a[1] + d[1] * s0 - n2[1] * h]];
      slab0(g, q(0, L, 0.012), za, zb, glassM);
      const k = cw2 ? Math.max(1, Math.round(L / 1.5)) : 1;
      for (let i = 0; i <= k; i++) { const c = Math.min(L - 0.0375, Math.max(0.0375, (L * i) / k)); slab0(g, q(c - 0.0375, c + 0.0375, 0.06), za, zb, frameM); }
      if (cw2) slab0(g, q(0, L, 0.05), za + 1.08, za + 1.14, frameM);
      else { slab0(g, q(0, L, 0.03), za, za + 0.05, frameM); slab0(g, q(0, L, 0.03), zb - 0.05, zb, frameM); }
    }
    // a balcony: a slab and a glass balustrade on its open sides; UP: a slab and a railing; A/C platform: a slab and louvres
    function extra3d(g, q, e, z0) {
      const x0 = q.x + e.x, y0 = q.y + e.y, x1 = x0 + e.w, y1 = y0 + e.h, kind = e.kind || "bal";
      box(g, x0, y0, x1, y1, z0 - 0.15, z0 + 0.02, mat(kind === "bal" ? 0xdfe4ea : kind === "up" ? 0xe4e1d8 : 0xd8dde2), true);
      const room = (px, py) => q.rooms.some((rm) => px >= q.x + rm.x - 0.06 && px <= q.x + rm.x + rm.w + 0.06 && py >= q.y + rm.y - 0.06 && py <= q.y + rm.y + rm.h + 0.06);
      const sides = [["n", [x0, y0], [x1, y0]], ["s", [x0, y1], [x1, y1]], ["w", [x0, y0], [x0, y1]], ["e", [x1, y0], [x1, y1]]].filter(([, a, b]) => !room((a[0] + b[0]) / 2 + (a[1] === b[1] ? 0 : (a[0] === x0 ? -0.1 : 0.1)), (a[1] + b[1]) / 2 + (a[1] === b[1] ? (a[1] === y0 ? -0.1 : 0.1) : 0)));
      const t = 0.03;
      for (const [, a, b] of sides) {
        const v = a[0] === b[0], s0 = v ? a[1] : a[0], s1 = v ? b[1] : b[0], c = v ? a[0] : a[1];
        const B = (sa, sb, za, zb, m, h = t) => (v ? box(g, c - h, sa, c + h, sb, za, zb, m) : box(g, sa, c - h, sb, c + h, za, zb, m));
        if (kind === "bal") { B(s0, s1, z0 + 0.1, z0 + 1.05, glassM, 0.008); B(s0, s1, z0 + 1.05, z0 + 1.1, steelM, 0.025); }
        else if (kind === "up") { B(s0, s1, z0 + 1.05, z0 + 1.1, steelM, 0.02); B(s0, s1, z0 + 0.55, z0 + 0.58, steelM, 0.012); for (let p = s0; p <= s1 + 1e-6; p += Math.max(0.5, (s1 - s0) / Math.max(1, Math.round((s1 - s0) / 1.0)))) B(p - 0.02, p + 0.02, z0, z0 + 1.1, steelM, 0.02); }
        else { for (let p = s0 + 0.05; p < s1 - 0.02; p += 0.1) B(p - 0.012, p + 0.012, z0 + 0.05, z0 + 1.0, louvreM, 0.04); B(s0, s1, z0 + 1.0, z0 + 1.04, steelM, 0.04); }
      }
    }
    for (const f of later) f();
    legs.forEach((l, li) => buildLeg(LG[li], l.r, z, wz, wh));
    function buildLeg(grp, r) {
    box(grp, r.corr ? r.corr.x0 : 0, r.y0, r.corr ? r.corr.x1 : r.L, r.y1, wz, wz + 0.01, mat(0xe6e9ee));
    for (const q of r.placed) {
      // the floor of each room, by its use
      for (const rm of q.rooms) box(grp, q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h, wz, wz + 0.02, mat(/BATH|ENS/.test(rm.kind) ? 0xd9ebe7 : colOf.get(q.name)));
      for (const e of q.extras || []) extra3d(grp, q, e, wz);
      // the fittings and furniture as low boxes (a wardrobe full height, a counter to the worktop)
      for (const fx of q.fixtures || []) { const h = FIXH[fx.kind] || 0.5; box(grp, q.x + fx.x, q.y + fx.y, q.x + fx.x + fx.w, q.y + fx.y + fx.h, wz + 0.02, wz + 0.02 + h, furnM); }
      // its walls, cut by its doors, a lintel over each door; its windows and curtain walls in them
      const PW = FC.placedWalls(q), ops = (q.ops || []).map((o) => ({ k: o.k, a: [q.x + o.a[0], q.y + o.a[1]], b: [q.x + o.b[0], q.y + o.b[1]] }));
      for (const w of PW.rects) wall3d(grp, w, ops, wz, wh, w.m === "blk" ? blkM : w.m === "pc" ? pcM : rcM);
      // a lintel over each door, in the wall as built (its line and thickness)
      const loc = (q.doors || []).length ? FC.placedWalls(q, { x: 0, y: 0 }).rects : [];
      for (const d0 of q.doors || []) {
        const { d, t } = FC.doorOnWall(d0, loc, q.wt || 0.15), v = Math.abs(d.H[0] - d.O[0]) < 1e-6;
        const x1 = q.x + Math.min(d.H[0], d.O[0]), x2 = q.x + Math.max(d.H[0], d.O[0]), y1 = q.y + Math.min(d.H[1], d.O[1]), y2 = q.y + Math.max(d.H[1], d.O[1]);
        if (v) box(grp, x1 - t / 2, y1, x1 + t / 2, y2, wz + 2.1, wz + wh, blkM);
        else box(grp, x1, y1 - t / 2, x2, y1 + t / 2, wz + 2.1, wz + wh, blkM);
      }
    }
    // the core: its RC walls (shared where pieces meet, cut by the doors), the lift cars, the staircases' flights
    for (const w of FC.coreWallRects(r.core, cw)) box(grp, w.x0, w.y0, w.x1, w.y1, wz, z + H, rcM, true);
    for (const c of r.core) for (const d of c.doors || []) {
      const hz = Math.abs(d.H[1] - d.O[1]) < 1e-6, a0 = hz ? Math.min(d.H[0], d.O[0]) : Math.min(d.H[1], d.O[1]), a1 = hz ? Math.max(d.H[0], d.O[0]) : Math.max(d.H[1], d.O[1]), cc = hz ? d.H[1] : d.H[0];
      const B = (za, zb, m, h = cw / 2) => (hz ? box(grp, a0, cc - h, a1, cc + h, za, zb, m) : box(grp, cc - h, a0, cc + h, a1, za, zb, m));
      // an access panel: the wall closed, a grey panel on it from 0.3 m up; a door: the lintel over it
      if (d.type === "panel") { B(wz, z + H, rcM); B(wz + 0.3, wz + 0.3 + Math.min(1.5, a1 - a0 + 0.9), mat(0x7d858e), cw / 2 + 0.01); }
      else if (d.type === "window") { B(wz, wz + 1.0, rcM); B(wz + 2.3, z + H, rcM); B(wz + 1.0, wz + 2.3, glassM, 0.012); }
      else B(wz + 2.1, z + H, rcM);
    }
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
