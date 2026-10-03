/* View cube, as in Revit: top right of the 3D view.

   Click a face for that elevation or plan, an edge for the view between two
   faces, a corner for an isometric from that corner - 26 directions. Drag
   it to orbit. The house button returns to the default isometric.

   The cube follows the main camera every frame, and is turned by the "Set
   front" alignment, so FRONT on the cube is the front of the building - the
   same convention as the Front button: +Y up, +Z front, +X right.

   It is drawn by its own small renderer on its own canvas. Sharing the main
   renderer would mean sharing its clipping planes, so a section box would
   cut the cube.
 */

const FACES = [          // BoxGeometry material order: +x -x +y -y +z -z
  { label: "RIGHT", short: "R", dir: [1, 0, 0] },
  { label: "LEFT", short: "L", dir: [-1, 0, 0] },
  { label: "TOP", short: "T", dir: [0, 1, 0] },
  { label: "BOTTOM", short: "BT", dir: [0, -1, 0] },
  { label: "FRONT", short: "F", dir: [0, 0, 1] },
  { label: "BACK", short: "B", dir: [0, 0, -1] },
];
const ZONE = 0.22;       // how much of each face near its edges counts as edge

/* The look of Autodesk's current ViewCube: pale grey faces with the words
   in a dark grey, thin grey edges, a soft blue for the part under the
   pointer, and a compass ring (N E S W) under the cube. Letters instead of
   words: localStorage "lwk-viewer:cube-letters" = "1". */
function cubeLetters() {
  try { return localStorage.getItem("lwk-viewer:cube-letters") === "1"; } catch (e) { return false; }
}

function faceTexture(THREE, label, short) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, "#fbfbfc");
  grad.addColorStop(1, "#e4e7eb");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // a soft inner bevel, so the faces read as a solid object
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 6;
  g.strokeRect(9, 9, 238, 238);
  g.strokeStyle = "#b8bec7";
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  g.fillStyle = "#3d4451";
  const letters = cubeLetters() && short;
  const txt = letters ? short : label;
  let size = letters ? 120 : 50;
  g.font = `600 ${size}px "Segoe UI", Arial, sans-serif`;
  while (g.measureText(txt).width > 220 && size > 20) { size -= 2; g.font = `600 ${size}px "Segoe UI", Arial, sans-serif`; }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(txt, 128, 134);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function compassTexture(THREE) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(120,128,140,0.85)";
  g.lineWidth = 16;
  g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#3d4451";
  g.font = '700 30px "Segoe UI", Arial, sans-serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  // N at the top of the texture = towards -Z in the scene (north)
  const put = (txt, a) => {
    const x = 128 + Math.sin(a) * 104, y = 128 - Math.cos(a) * 104;
    g.fillStyle = "#f4f5f7"; g.beginPath(); g.arc(x, y, 19, 0, Math.PI * 2); g.fill();
    g.fillStyle = txt === "N" ? "#c2410c" : "#3d4451";
    g.fillText(txt, x, y + 1);
  };
  put("N", 0); put("E", Math.PI / 2); put("S", Math.PI); put("W", -Math.PI / 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export function createViewCube(opts) {
  const { THREE, wrap, getCamera, getTarget, getAlignRad, onView, onOrbit, onHome } = opts;
  const SIZE = 118;

  const box = document.createElement("div");
  box.id = "viewcube";
  box.innerHTML = '<button id="viewcube-home" title="Home view: the 3D overview">'
    + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/></svg></button>';
  const canvas = document.createElement("canvas");
  box.appendChild(canvas);
  // Under the cube: projection and "which way is front", placed by the page.
  const bar = document.createElement("div");
  bar.id = "viewcube-bar";
  box.appendChild(bar);
  wrap.appendChild(box);

  // (the WebGPU trial passes its own, so the page holds one kind of graphics device)
  const renderer = opts.makeRenderer ? opts.makeRenderer(canvas)
    : new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(SIZE, SIZE, false);
  canvas.style.width = canvas.style.height = SIZE + "px";

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1.05, 1.05, 1.05, -1.05, 0.1, 10);
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const lamp = new THREE.DirectionalLight(0xffffff, 1.2);
  scene.add(lamp);

  const pivot = new THREE.Group();       // turned by the building alignment
  scene.add(pivot);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    FACES.map((f) => new THREE.MeshLambertMaterial({ map: faceTexture(THREE, f.label, f.short) })));
  pivot.add(cube);
  pivot.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x9aa1ab })));
  // the compass ring, flat under the cube, in the world frame (north = -Z)
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75),
    new THREE.MeshBasicMaterial({ map: compassTexture(THREE), transparent: true, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.62;
  scene.add(ring);

  // The region under the pointer, shown as an orange block over it.
  const hi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x5b9bff, transparent: true, opacity: 0.45,
                                  depthTest: false }));
  hi.renderOrder = 5;
  hi.visible = false;
  pivot.add(hi);

  const ray = new THREE.Raycaster();

  /* Which of the 26 regions a point on the cube falls in: each axis is -1,
     0 or +1 depending on whether the point is near that side. One non-zero
     axis is a face, two an edge, three a corner. */
  function regionAt(ev) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1,
                                  -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObject(cube, false)[0];
    if (!hit) return null;
    const p = cube.worldToLocal(hit.point.clone());
    const d = [p.x, p.y, p.z].map((v) => (v > 0.5 - ZONE ? 1 : v < -0.5 + ZONE ? -1 : 0));
    return d.some((v) => v !== 0) ? d : null;
  }

  /* The highlight block for a region. A face lights a thin panel over its
     middle; an edge lights the strip along it; a corner lights its tip.
     Per axis: a side the region touches is either a thin panel just outside
     (for a face) or a band of width ZONE inside (for an edge or corner); an
     axis it does not touch spans the middle of the face. */
  function showRegion(d) {
    if (!d) { hi.visible = false; return; }
    const touching = d.filter((q) => q !== 0).length;
    const t = 0.03;
    const s = [], p = [];
    for (const a of d) {
      if (a === 0) { s.push(1 - 2 * ZONE); p.push(0); }
      else if (touching === 1) { s.push(t); p.push(a * (0.5 + t / 2)); }
      else { s.push(ZONE); p.push(a * (0.5 - ZONE / 2)); }
    }
    hi.scale.set(s[0], s[1], s[2]);
    hi.position.set(p[0], p[1], p[2]);
    hi.visible = true;
  }

  function faceName(d) {
    const k = d.join(",");
    return { "0,1,0": "top", "0,-1,0": "bottom", "0,0,1": "front", "0,0,-1": "back",
             "1,0,0": "right", "-1,0,0": "left" }[k] || null;
  }

  // Clicks and drags. A drag orbits the main view; a click without moving
  // picks a region.
  let down = null;
  canvas.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    down = { x: ev.clientX, y: ev.clientY, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    ev.stopPropagation();
    if (down) {
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
      if (down.moved) {
        onOrbit(dx, dy);
        down.x = ev.clientX; down.y = ev.clientY;
        showRegion(null);
      }
      return;
    }
    showRegion(regionAt(ev));
    draw(true);
  });
  canvas.addEventListener("pointerleave", () => { showRegion(null); draw(true); });
  canvas.addEventListener("pointerup", (ev) => {
    ev.stopPropagation();
    const wasClick = down && !down.moved;
    down = null;
    if (!wasClick) return;
    const d = regionAt(ev);
    if (!d) return;
    const face = faceName(d);
    // the direction in the building's frame: turned like the cube
    const dir = new THREE.Vector3(...d).normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), getAlignRad());
    onView(face, dir);
  });
  canvas.addEventListener("wheel", (ev) => ev.stopPropagation(), { passive: true });
  box.querySelector("#viewcube-home").addEventListener("click", (ev) => {
    ev.stopPropagation();
    onHome();
  });

  let lastKey = "";
  let ready = !opts.makeRenderer || !renderer.init;
  function draw(force) {
    if (!ready) return;
    const main = getCamera();
    const target = getTarget();
    // drawn again only when the view turned (it was every frame)
    const key = main.position.x.toFixed(4) + main.position.y.toFixed(4) + main.position.z.toFixed(4)
      + target.x.toFixed(4) + target.y.toFixed(4) + target.z.toFixed(4) + main.up.y + getAlignRad();
    if (key === lastKey && force !== true) return;
    lastKey = key;
    // look at the cube from the same side the main camera sees the model
    const off = main.position.clone().sub(target);
    if (off.lengthSq() < 1e-12) off.set(1, 1, 1);
    off.normalize().multiplyScalar(3);
    cam.position.copy(off);
    cam.up.copy(main.up);
    cam.lookAt(0, 0, 0);
    lamp.position.copy(off).add(new THREE.Vector3(0.5, 1, 0.3));
    pivot.rotation.y = getAlignRad();
    renderer.render(scene, cam);
  }

  if (opts.makeRenderer && renderer.init) renderer.init().then(() => { ready = true; draw(true); }).catch(() => {});
  return { update: draw, element: box, bar: bar };
}
