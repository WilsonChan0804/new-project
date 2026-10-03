/* Measuring in 3D.
 *
 * Snapping first, measuring second. A distance taken from wherever the ray
 * happened to land is worse than no measurement at all: it looks precise
 * and is wrong by whatever the user's aim was off by. So every click is
 * pulled onto a real feature of the geometry - a corner, an edge, the
 * middle of an edge - and the readout says which, so the reader can judge
 * whether to trust it.
 *
 * Geometry lives in the worker, so the vertices are fetched per element on
 * demand (getItemsGeometry) and cached. Only the element under the cursor
 * is ever fetched, which keeps this usable on a 450 MB federated model.
 */

const SNAP_PX = 18;          // how close on screen a feature must be
const CACHE_MAX = 40;        // elements kept; enough for one measuring run

export const SNAP_KINDS = {
  vertex: { label: "corner", color: 0xe2453c },
  midpoint: { label: "midpoint", color: 0x7c3aed },
  perpendicular: { label: "perpendicular", color: 0x16a34a },
  edge: { label: "edge", color: 0x3b82f6 },
  face: { label: "surface", color: 0x6b7280 },
};

export function createMeasure(ctx) {
  const { THREE, scene, renderer, fragments } = ctx;
  // the viewer swaps between a perspective and a parallel camera
  const cameraOf = () => (ctx.getCamera ? ctx.getCamera() : ctx.camera);
  let ortho = false;               // second point kept straight along X, Y or height

  const cache = new Map();          // "modelId:localId" -> {verts, edges}
  const points = [];                // confirmed picks, world space
  let mode = "distance";            // distance | angle | area
  let preview = null;               // the snap under the cursor

  /* ------------------------------------------------------ scene objects */

  const group = new THREE.Group();
  group.renderOrder = 999;
  scene.add(group);

  const markerGeo = new THREE.SphereGeometry(1, 12, 10);
  const marker = new THREE.Mesh(markerGeo,
    new THREE.MeshBasicMaterial({ color: 0xe2453c, depthTest: false }));
  marker.visible = false;
  marker.renderOrder = 1000;
  group.add(marker);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xf28022, depthTest: false, linewidth: 2 });
  const line = new THREE.Line(new THREE.BufferGeometry(), lineMat);
  line.renderOrder = 1000;
  group.add(line);

  const dotsGeo = new THREE.SphereGeometry(1, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xf28022, depthTest: false });
  const dots = [];

  const label = document.createElement("div");
  label.className = "meas3d-label";
  label.hidden = true;
  renderer.domElement.parentElement.appendChild(label);

  /* --------------------------------------------------------- geometry */

  async function featuresOf(part, localId) {
    const key = part.id + ":" + localId;
    if (cache.has(key)) return cache.get(key);

    const out = { verts: [], edges: [], tris: [] };
    try {
      const meshes = await part.model.getItemsGeometry([localId]);
      for (const group of meshes || []) {
        for (const md of group || []) {
          if (!md || !md.positions) continue;
          const m = md.transform || new THREE.Matrix4();
          const pos = md.positions;
          const seen = new Set();

          for (let i = 0; i + 2 < pos.length; i += 3) {
            const v = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2])
              .applyMatrix4(m);
            // Meshes repeat vertices per face; a rounded key removes the
            // duplicates so one corner is one snap target.
            const k = v.x.toFixed(4) + "," + v.y.toFixed(4) + "," + v.z.toFixed(4);
            if (seen.has(k)) continue;
            seen.add(k);
            out.verts.push(v);
          }

          const idx = md.indices;
          if (idx) {
            /* Real edges only: an edge between two triangles of the same
               flat face (the diagonal a rectangle is split along) is not
               an edge anyone means to measure to. */
            const at = (n) => new THREE.Vector3(
              pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]).applyMatrix4(m);
            const nrm = (i) => {
              const a = at(idx[i]), b = at(idx[i + 1]), c = at(idx[i + 2]);
              return b.sub(a).cross(c.sub(a)).normalize();
            };
            const edgeTris = new Map();
            for (let i = 0; i + 2 < idx.length; i += 3) {
              const tri = [idx[i], idx[i + 1], idx[i + 2]];
              out.tris.push(at(tri[0]), at(tri[1]), at(tri[2]));
              for (let e = 0; e < 3; e++) {
                const a = tri[e], b = tri[(e + 1) % 3];
                const k = a < b ? a + "_" + b : b + "_" + a;
                const l = edgeTris.get(k);
                if (l) l.push(i); else edgeTris.set(k, [i]);
              }
            }
            for (const [k, tris] of edgeTris) {
              if (tris.length === 2 && Math.abs(nrm(tris[0]).dot(nrm(tris[1]))) > 0.985) continue;
              const [a, b] = k.split("_").map(Number);
              out.edges.push([at(a), at(b)]);
            }
          }
        }
      }
    } catch (e) {
      // No geometry: fall back to surface-point snapping only.
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  }

  /* ----------------------------------------------------------- snapping */

  const toScreen = (v) => {
    const p = v.clone().project(cameraOf());
    const r = renderer.domElement.getBoundingClientRect();
    return [(p.x + 1) / 2 * r.width + r.left, (-p.y + 1) / 2 * r.height + r.top];
  };

  function nearestOnSegment(p, a, b) {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1,
      p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
    return a.clone().add(ab.multiplyScalar(t));
  }

  /* The candidates are ranked by distance ON SCREEN, not in world space:
     what matters is how close the feature looks to the cursor, which is
     also how the user judges it. Corners beat midpoints beat edges when
     they are within a few pixels of each other, because a corner is the
     thing people mean to click. */
  /* With a section on, only what is left standing counts: corners that
     were cut away are dropped, edges are trimmed to the kept side (and
     where a plane trims one, that point is a corner of the cut), and the
     outline of the cut itself - where each plane passes through the
     element - becomes edges to snap to, which is what a plan shows. */
  const EPS = 1e-4;
  function clipSeg(a, b, planes) {
    let t0 = 0, t1 = 1;
    for (const pl of planes) {
      const da = pl.distanceToPoint(a), db = pl.distanceToPoint(b);
      if (da < -EPS && db < -EPS) return null;
      if (da < -EPS) t0 = Math.max(t0, da / (da - db));
      else if (db < -EPS) t1 = Math.min(t1, da / (da - db));
    }
    if (t1 - t0 < 1e-6) return null;
    const ab = b.clone().sub(a);
    return [a.clone().add(ab.clone().multiplyScalar(t0)), a.clone().add(ab.multiplyScalar(t1)), t0 > 0, t1 < 1];
  }
  function mergeSegs(segs) {
    // pieces of one straight cut line, one per triangle, joined back up
    const out = segs.map((s) => [s[0], s[1]]);
    let joined = true;
    while (joined) {
      joined = false;
      for (let i = 0; i < out.length && !joined; i++) {
        for (let j = i + 1; j < out.length && !joined; j++) {
          const [a, b] = out[i], [c, d] = out[j];
          const di = b.clone().sub(a).normalize(), dj = d.clone().sub(c).normalize();
          if (Math.abs(di.dot(dj)) < 0.9995) continue;
          let m = null;
          if (b.distanceTo(c) < 1e-4) m = [a, d];
          else if (b.distanceTo(d) < 1e-4) m = [a, c];
          else if (a.distanceTo(c) < 1e-4) m = [b, d];
          else if (a.distanceTo(d) < 1e-4) m = [b, c];
          if (m) { out[i] = m; out.splice(j, 1); joined = true; }
        }
      }
    }
    return out;
  }
  function visibleFeatures(f) {
    const planes = (renderer.clippingPlanes || []).filter(Boolean);
    if (!planes.length) return f;
    const key = planes.map((p) => p.normal.toArray().map((x) => x.toFixed(5)).join(",") + ":" + p.constant.toFixed(5)).join("|");
    if (f.clipKey === key) return f.clipped;
    const inside = (v) => planes.every((p) => p.distanceToPoint(v) >= -EPS);
    const verts = f.verts.filter(inside), edges = [];
    for (const [a, b] of f.edges) {
      const c = clipSeg(a, b, planes);
      if (!c) continue;
      edges.push([c[0], c[1]]);
      if (c[2]) verts.push(c[0]);
      if (c[3]) verts.push(c[1]);
    }
    for (const pl of planes) {
      const others = planes.filter((q) => q !== pl), segs = [];
      for (let i = 0; i + 2 < f.tris.length; i += 3) {
        const tri = [f.tris[i], f.tris[i + 1], f.tris[i + 2]];
        const d = tri.map((v) => pl.distanceToPoint(v));
        const pts = [];
        for (let e = 0; e < 3; e++) {
          const a = tri[e], b = tri[(e + 1) % 3], da = d[e], db = d[(e + 1) % 3];
          if ((da > 0) !== (db > 0) && Math.abs(da - db) > 1e-9) pts.push(a.clone().lerp(b, da / (da - db)));
        }
        if (pts.length !== 2 || pts[0].distanceTo(pts[1]) < 1e-5) continue;
        const c = clipSeg(pts[0], pts[1], others);
        if (c) segs.push(c);
      }
      for (const [a, b] of mergeSegs(segs)) { edges.push([a, b]); verts.push(a, b); }
    }
    f.clipKey = key;
    f.clipped = { verts, edges };
    return f.clipped;
  }

  async function snapAt(ev, hit, part) {
    const cursor = [ev.clientX, ev.clientY];
    const best = { point: hit.point.clone(), kind: "face", d: SNAP_PX + 1 };

    if (!part || hit.localId == null) return best;
    const f = visibleFeatures(await featuresOf(part, hit.localId));

    /* Two features on the same spot of the screen (in a plan, the top and
       the foot of a cut wall's corner) - the one nearer the eye, the one
       that is seen, wins. */
    const cam = cameraOf();
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const consider = (v, kind, bias) => {
      const s = toScreen(v);
      const d = Math.hypot(s[0] - cursor[0], s[1] - cursor[1]) - (bias || 0);
      const z = v.distanceTo(eye);
      if (d < best.d - 0.5 || (d <= best.d + 0.5 && best.kind === kind && z < best.z - 1e-4)) {
        best.d = Math.min(d, best.d); best.point = v.clone(); best.kind = kind; best.z = z;
      }
    };

    for (const v of f.verts) consider(v, "vertex", 6);
    const from = points.length ? points[points.length - 1] : null;
    // the point on an edge nearest the cursor, found on screen
    const ray = new THREE.Raycaster();
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((cursor[0] - r.left) / r.width * 2 - 1, -(cursor[1] - r.top) / r.height * 2 + 1), cameraOf());
    const onRay = new THREE.Vector3();
    for (const [a, b] of f.edges) {
      consider(a.clone().add(b).multiplyScalar(0.5), "midpoint", 3);
      ray.ray.distanceSqToSegment(a, b, null, onRay);
      consider(onRay, "edge", 0);
      // square off an edge from the point before
      if (from) {
        const ab = b.clone().sub(a), L2 = ab.lengthSq();
        if (L2 > 1e-8) {
          const t = from.clone().sub(a).dot(ab) / L2;
          if (t > 0.001 && t < 0.999) consider(a.clone().add(ab.multiplyScalar(t)), "perpendicular", 4);
        }
      }
    }
    if (best.d > SNAP_PX) {
      best.point = hit.point.clone();
      best.kind = "face";
    }
    return best;
  }

  /* Straight: from the last point, only along the axis the move is
     mostly on (X, Y or height). */
  function straighten(snap, ev) {
    const on = ortho !== !!(ev && ev.shiftKey);
    if (!on || !points.length || mode === "angle" && points.length !== 1 && points.length !== 2) return snap;
    const from = points[points.length - 1];
    const d = snap.point.clone().sub(from);
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    const p = from.clone();
    if (ax >= ay && ax >= az) p.x += d.x;
    else if (ay >= ax && ay >= az) p.y += d.y;
    else p.z += d.z;
    return { point: p, kind: snap.kind, d: snap.d, straight: true };
  }

  /* The ring that runs out from a new snap. */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false,
    side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 40), ringMat);
  ring.renderOrder = 1001;
  ring.visible = false;
  group.add(ring);
  let pulseAt = 0;
  function pulse(snap) {
    pulseAt = performance.now();
    ring.position.copy(snap.point);
    ringMat.color.setHex(SNAP_KINDS[snap.kind].color);
    ring.visible = true;
    if (typeof navigator !== "undefined" && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
  }
  function animatePulse(now) {
    if (!ring.visible) return false;
    const t = (now - pulseAt) / 420;
    if (t >= 1) { ring.visible = false; return true; }
    const cam = cameraOf();
    ring.quaternion.copy(cam.quaternion);        // facing the viewer
    ring.scale.setScalar(pxAt(ring.position) * 9 * (1 + t * 2.5));
    ringMat.opacity = 1 - t;
    return true;
  }

  /* ------------------------------------------------------------ readout */

  const fmt = (m) => m >= 1 ? m.toFixed(3) + " m"
                            : (m * 1000).toFixed(0) + " mm";

  function polygonArea(pts) {
    // Newell's method: works for any planar polygon in 3D, and degrades
    // sensibly rather than silently for slightly non-planar picks.
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n.length() / 2;
  }

  function readout(live) {
    const P = live && mode === "distance" && points.length === 1 && preview ? [points[0], preview.point] : points;
    if (mode === "distance" && P.length >= 2) {
      const d = P[0].distanceTo(P[1]);
      const dx = Math.abs(P[1].x - P[0].x);
      const dy = Math.abs(P[1].z - P[0].z);   // plan, scene is Y-up
      const dz = Math.abs(P[1].y - P[0].y);
      return `${fmt(d)}\n` + `plan ${fmt(Math.hypot(dx, dy))}  `
        + `height ${fmt(dz)}`;
    }
    if (mode === "angle" && points.length >= 3) {
      const u = points[0].clone().sub(points[1]);
      const v = points[2].clone().sub(points[1]);
      if (!u.length() || !v.length()) return "";
      const deg = u.angleTo(v) * 180 / Math.PI;
      return deg.toFixed(1) + "\u00B0";
    }
    if (mode === "area" && points.length >= 3) {
      const a = polygonArea(points);
      return a.toFixed(2) + " m\u00B2 (" + points.length + " points)";
    }
    return "";
  }

  /* How big one screen pixel is at a point - markers keep a steady size
     on screen whether the view is a tower or a door handle, zoomed or not. */
  function pxAt(v) {
    const cam = cameraOf(), h = renderer.domElement.clientHeight || 600;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / (cam.zoom || 1) / h;
    const d = cam.getWorldPosition(new THREE.Vector3()).distanceTo(v);
    return 2 * d * Math.tan((cam.fov || 50) * Math.PI / 360) / (cam.zoom || 1) / h;
  }
  function rescale() {
    for (const d of dots) d.scale.setScalar(pxAt(d.position) * 5);
    if (marker.visible) marker.scale.setScalar(pxAt(marker.position) * 6);
  }

  function draw() {
    for (const d of dots) group.remove(d);
    dots.length = 0;

    const all = preview && points.length < limit()
      ? points.concat([preview.point]) : points.slice();

    for (const p of points) {
      const d = new THREE.Mesh(dotsGeo, dotMat);
      d.position.copy(p);
      d.renderOrder = 1000;
      group.add(d);
      dots.push(d);
    }
    rescale();

    const pts = mode === "area" && all.length > 2 ? all.concat([all[0]]) : all;
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);

    if (preview) {
      marker.visible = true;
      marker.position.copy(preview.point);
      marker.material.color.setHex(SNAP_KINDS[preview.kind].color);
    } else {
      marker.visible = false;
    }

    let text = readout(true);
    if (text && points.length === 1 && preview && preview.kind !== "face") text = SNAP_KINDS[preview.kind].label + " - " + text;
    if (!text && preview && preview.kind !== "face") {
      text = SNAP_KINDS[preview.kind].label + (preview.straight ? " (straight)" : "");
    } else if (text && preview && preview.straight) text += "  (straight)";
    if (text) {
      const anchor = (preview && points.length < 2 ? preview.point : null) || points[points.length - 1] || preview.point;
      const s = toScreen(anchor);
      const r = renderer.domElement.getBoundingClientRect();
      label.hidden = false;
      label.style.left = (s[0] - r.left + 14) + "px";
      label.style.top = (s[1] - r.top - 10) + "px";
      label.textContent = text;
    } else {
      label.hidden = true;
    }
  }

  const limit = () => mode === "distance" ? 2 : mode === "angle" ? 3 : 64;

  /* -------------------------------------------------------------- API */

  return {
    get mode() { return mode; },
    setMode(m) { mode = m; this.clear(); },
    get pointCount() { return points.length; },

    async hover(ev, hit, part) {
      if (!hit || !hit.point) { preview = null; draw(); return null; }
      const was = preview;
      preview = straighten(await snapAt(ev, hit, part), ev);
      // a new snap: a ring runs out from it, so it is noticed
      if (preview.kind !== "face" && (!was || was.kind !== preview.kind || was.point.distanceTo(preview.point) > 1e-3)) pulse(preview);
      draw();
      return preview;
    },

    async click(ev, hit, part) {
      if (!hit || !hit.point) return null;
      const snap = straighten(await snapAt(ev, hit, part), ev);
      if (mode !== "area" && points.length >= limit()) points.length = 0;
      points.push(snap.point);
      preview = null;
      draw();
      return { snap: snap, done: points.length >= limit(), text: readout() };
    },

    /* Straight: the next point kept along X, Y or height from the last
       (also while Shift is held). */
    get ortho() { return ortho; },
    setOrtho(on) { ortho = !!on; },
    /* Called every frame while measuring: the snap ring's animation.
       True while it runs (the frame must be drawn). */
    tick(now) { rescale(); return animatePulse(now); },
    /* Esc: the measurement being taken is dropped. */
    cancel() { const had = points.length > 0 || !!preview; points.length = 0; preview = null; draw(); return had; },
    // the points of the measurement on screen, for keeping it as a dimension
    get points() { return points.map((p) => p.clone()); },
    undo() { points.pop(); draw(); },
    clear() { points.length = 0; preview = null; draw(); },
    result() { return readout(); },

    dispose() {
      this.clear();
      scene.remove(group);
      label.remove();
      cache.clear();
    },
  };
}
