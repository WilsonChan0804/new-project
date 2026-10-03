/* Drag handles for sectioning.
 *
 * Written against three's core only, deliberately (TransformControls needs
 * the vendor bundle rebuilt).
 *
 * Each handle belongs to one face of the section box (or to the section
 * plane) and moves only along that face's normal. A handle is a dot with a
 * soft bright ring, standing a little off the face on a thin stem that
 * shows which way it moves - X red, Y green, height blue, the plane's own
 * normal orange. The faces themselves are drawn by the box's outline; with
 * a mouse, a face lights up (faint orange) only while the pointer is on its
 * edge, and can be pulled from there. The face never covers the model.
 *
 * Touch: one finger on a dot drags it; two fingers are always the view's
 * (pinch to zoom, turn), whatever they start on.
 */

const PANEL_COLOR = 0xf28022;
const AXIS_COLOR = { x: 0xe2453c, z: 0x16a34a, y: 0x3b82f6, plane: 0xf28022 };
const HOVER_COLOR = 0xffd166;
const EDGE_PX = 12;                 // how near a face's edge the mouse must be

export function createArrows(ctx) {
  const { THREE, scene, renderer, controls } = ctx;
  const cam = () => (ctx.getCamera ? ctx.getCamera() : ctx.camera);

  const group = new THREE.Group();
  group.name = "__section_arrows";
  group.renderOrder = 998;
  scene.add(group);

  const handles = [];            // dots: { key, origin, dir, obj, core, ring, stem, grip, color, onDrag, onEnd }
  const sheets = [];             // faces: { key, corners, dir, obj, fill, onDrag, onEnd }
  const ray = new THREE.Raycaster();
  let drag = null, pending = null, hovered = null;
  const pointers = new Map();    // active pointers (touch: more than one = the view's)

  const ringTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 14, 32, 32, 31);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.95)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c);
    return t;
  })();

  function makeDot(color) {
    const obj = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), coreMat);
    core.renderOrder = 999;
    const ringMat = new THREE.SpriteMaterial({ map: ringTex, color, depthTest: false, transparent: true, opacity: 0.85 });
    const ring = new THREE.Sprite(ringMat);
    ring.scale.setScalar(0.62);
    ring.renderOrder = 998;
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    obj.add(core); obj.add(ring); obj.add(grip);
    const stemMat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 });
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), stemMat);
    stem.renderOrder = 997;
    return { obj, core, coreMat, ring, ringMat, grip, stem, stemMat };
  }

  function makeSheet(corners, color) {
    const obj = new THREE.Group();
    const c0 = corners.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / corners.length);
    const pts = corners.map((p) => p.clone().sub(c0));
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]), fillMat);
    fill.renderOrder = 990;
    fill.visible = false;
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
    const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    loop.renderOrder = 991;
    obj.add(fill); obj.add(loop);
    obj.position.copy(c0);
    return { obj, fill, fillMat, loop, lineMat, center: c0 };
  }

  /* Keep the handles a constant size on screen, as a CAD grip is. */
  function screenScale(pos) {
    const c = cam();
    if (c.isOrthographicCamera) return Math.max(0.05, (c.top - c.bottom) / (c.zoom || 1) * 0.06);
    const d = c.position.distanceTo(pos);
    return Math.max(0.05, 2 * Math.tan(c.fov * Math.PI / 360) * d * 0.06);
  }

  function place(h) {
    const s = screenScale(h.origin);
    // the dot stands off the face along the way it moves; the stem joins them
    const tip = h.origin.clone().add(h.dir.clone().multiplyScalar(s * (h.stand || 1.6)));
    h.obj.position.copy(tip);
    h.obj.scale.setScalar(s);
    const p = h.stem.geometry.attributes.position;
    p.setXYZ(0, h.origin.x, h.origin.y, h.origin.z);
    p.setXYZ(1, tip.x, tip.y, tip.z);
    p.needsUpdate = true;
    h.stem.geometry.computeBoundingSphere();
  }

  function paint(h, on) {
    const c = on ? HOVER_COLOR : h.color;
    h.coreMat.color.setHex(c); h.ringMat.color.setHex(c); h.stemMat.color.setHex(c);
    h.ringMat.opacity = on ? 1 : 0.85;
    h.stemMat.opacity = on ? 1 : 0.7;
  }
  function lightSheet(sh, on) {
    sh.fill.visible = on;
    sh.fillMat.opacity = on ? 0.16 : 0;
    sh.lineMat.color.setHex(on ? HOVER_COLOR : PANEL_COLOR);
  }

  const api = {
    clear() {
      for (const h of handles) { group.remove(h.obj); group.remove(h.stem); }
      for (const sh of sheets) group.remove(sh.obj);
      handles.length = 0; sheets.length = 0;
      drag = null; pending = null; hovered = null;
    },
    /* specs: [{ key, origin, dir, color, onDrag(distance), onEnd }] - a dot;
       [{ key, corners: [4 points], dir, onDrag, onEnd, outline }] - a face */
    set(specs) {
      api.clear();
      for (const s of specs) {
        if (s.corners) {
          const m = makeSheet(s.corners, PANEL_COLOR);
          m.loop.visible = s.outline !== false;
          const sh = { key: s.key, corners: s.corners.map((p) => p.clone()), dir: s.dir.clone().normalize(),
                       onDrag: s.onDrag, onEnd: s.onEnd, obj: m.obj, fill: m.fill, fillMat: m.fillMat,
                       loop: m.loop, lineMat: m.lineMat, outline: s.outline !== false };
          group.add(sh.obj);
          sheets.push(sh);
          continue;
        }
        const color = AXIS_COLOR[s.color] || s.color || PANEL_COLOR;
        const m = makeDot(color);
        const h = { key: s.key, origin: s.origin.clone(), dir: s.dir.clone().normalize(), color,
                    onDrag: s.onDrag, onEnd: s.onEnd, stand: s.stand, ...m };
        place(h);
        group.add(h.obj); group.add(h.stem);
        handles.push(h);
      }
    },
    update() { for (const h of handles) place(h); },
    // where the dots are (for tests and tools)
    list() { return handles.map((h) => ({ key: h.key, pos: h.obj.position.clone(), dir: h.dir.clone() })); },
    faces() { return sheets.map((sh) => ({ key: sh.key, corners: sh.corners.map((c) => c.clone()), lit: sh.fillMat.opacity > 0 })); },
    get active() { return !!drag; },
    get count() { return handles.length + sheets.length; },
  };

  const el = renderer.domElement;
  function ndc(ev) {
    const r = el.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }
  function toScreen(p) {
    const r = el.getBoundingClientRect();
    const q = p.clone().project(cam());
    return { x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height, z: q.z };
  }
  function hitDot(ev) {
    if (!handles.length) return null;
    ray.setFromCamera(ndc(ev), cam());
    let best = null;
    for (const h of handles) {
      const x = ray.intersectObject(h.grip, false)[0];
      if (x && (!best || x.distance < best.d)) best = { h, d: x.distance };
    }
    return best && best.h;
  }
  /* A face under the mouse: only near its edge (it never takes clicks
     meant for the model behind it). */
  function hitSheet(ev) {
    let best = null;
    for (const sh of sheets) {
      const s = sh.corners.map(toScreen);
      if (s.some((q) => q.z > 1 || q.z < -1)) continue;
      for (let i = 0; i < 4; i++) {
        const a = s[i], b = s[(i + 1) % 4];
        const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((ev.clientX - a.x) * vx + (ev.clientY - a.y) * vy) / L2));
        const d = Math.hypot(a.x + vx * t - ev.clientX, a.y + vy * t - ev.clientY);
        if (d < EDGE_PX && (!best || d < best.d)) best = { sh, d };
      }
    }
    return best && best.sh;
  }

  /* Moving the pointer by (dx, dy) pixels: how far along the handle's
     normal. Across the screen, the movement is projected on the normal's
     screen direction. When the normal points nearly at the eye (a plane
     seen face on), sliding the finger up pushes the cut away, down brings
     it nearer - on a phone the old projection flipped over at that point,
     which is why pushing moved the plane out. */
  function dragMap(origin, dir) {
    const c = cam();
    const r = el.getBoundingClientRect();
    const p0 = origin.clone().project(c), p1 = origin.clone().add(dir).project(c);
    const v = new THREE.Vector2((p1.x - p0.x) * r.width / 2, -(p1.y - p0.y) * r.height / 2);
    const s = screenScale(origin) / 0.06;                  // metres across the screen height at that depth
    const pxPerM = r.height / s;
    if (v.length() > 0.3 * pxPerM) return { mode: "screen", v, px: v.length() };
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    return { mode: "depth", sign: dir.dot(f) >= 0 ? 1 : -1, pxPerM };
  }
  function metresOf(dm, dx, dy) {
    if (dm.mode === "screen") return (dx * dm.v.x + dy * dm.v.y) / dm.v.length() / dm.px;
    return (-dy / dm.pxPerM) * dm.sign;
  }

  const startDrag = (target, ev) => {
    drag = { t: target, x: ev.clientX, y: ev.clientY, dm: dragMap(target.origin || target.corners[0], target.dir), total: 0, id: ev.pointerId };
    controls.enabled = false;
    try { el.setPointerCapture(ev.pointerId); } catch (e) {}
  };
  const cancelDrag = () => {
    if (drag) {
      const t = drag.t;
      drag = null;
      if (t.onEnd) t.onEnd();
    }
    pending = null;
    controls.enabled = true;
  };

  el.addEventListener("pointerdown", (ev) => {
    pointers.set(ev.pointerId, ev.pointerType);
    // a second finger: the gesture is the view's (pinch, turn) - let go of any handle
    if (pointers.size > 1) { cancelDrag(); return; }
    if (ev.button !== 0) return;
    const h = hitDot(ev);
    if (h) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
      if (ev.pointerType === "touch") {
        // wait a moment: a second finger may follow (then it is a pinch)
        pending = { t: h, ev: { clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId } };
        return;
      }
      startDrag(h, ev);
      return;
    }
    if (ev.pointerType !== "touch") {
      const sh = hitSheet(ev);
      if (sh) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        startDrag({ ...sh, origin: sh.corners.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(0.25) }, ev);
        drag.sheet = sh;
      }
    }
  }, true);

  el.addEventListener("pointermove", (ev) => {
    if (pending && !drag && ev.pointerId === pending.ev.pointerId) {
      if (pointers.size > 1) { pending = null; return; }
      if (Math.hypot(ev.clientX - pending.ev.clientX, ev.clientY - pending.ev.clientY) > 4) {
        startDrag(pending.t, pending.ev);
        pending = null;
      } else { ev.stopImmediatePropagation(); return; }
    }
    if (drag) {
      if (ev.pointerId !== drag.id) return;
      ev.stopImmediatePropagation();
      const metres = metresOf(drag.dm, ev.clientX - drag.x, ev.clientY - drag.y);
      const step = metres - drag.total;
      drag.total = metres;
      if (step) {
        if (drag.sheet) {
          const sh = drag.sheet, mv = sh.dir.clone().multiplyScalar(step);
          sh.obj.position.add(mv);
          for (const p of sh.corners) p.add(mv);
        } else if (drag.t.origin) { drag.t.origin.add(drag.t.dir.clone().multiplyScalar(step)); place(drag.t); }
        drag.t.onDrag(step);
      }
      return;
    }
    if (ev.pointerType === "touch") return;
    // hover (mouse): a dot, else a face's edge
    const h = hitDot(ev);
    const sh = h ? null : hitSheet(ev);
    const now = h || sh;
    if (now !== hovered) {
      if (hovered) { if (hovered.corners) lightSheet(hovered, false); else paint(hovered, false); }
      hovered = now;
      if (h) paint(h, true);
      if (sh) lightSheet(sh, true);
      el.style.cursor = now ? (sh ? "move" : "grab") : "";
      if (ctx.onChange) ctx.onChange();
    }
  }, true);

  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (pending && pending.ev.pointerId === ev.pointerId) pending = null;
    if (!drag || drag.id !== ev.pointerId) return;
    ev.stopImmediatePropagation();
    try { el.releasePointerCapture(ev.pointerId); } catch (e) {}
    const t = drag.t;
    drag = null;
    controls.enabled = true;
    if (t.onEnd) t.onEnd();
  };
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
  el.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "touch") pointers.delete(ev.pointerId); }, true);

  return api;
}
