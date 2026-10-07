/* LWK Viewer - 3D stage.
 *
 * Loads the fragment files listed in manifest.json. Fragments are a binary
 * tile-indexed format produced by tools/convert.mjs; the browser never
 * parses IFC, which is what makes a 17-model federated set openable at all.
 *
 * Coordinates. Each model entry says how it is placed:
 *   "host" - already in host coordinates (Revit's own link export bakes the
 *            instance transform into the IFC, so nothing to apply)
 *   "own"  - exported standalone, so each instance transform from the
 *            manifest has to be applied here
 * autoCoordinate is ON: fragments keeps geometry near a local origin for
 * float precision and aligns models to the first one loaded. Without it,
 * every model draws at its own origin and a whole building flattens onto
 * one level.
 */

import { attachTemplates } from "./templates.js";
import * as Vendor from "./vendor/three-fragments.js";
const { THREE, OrbitControls, FragmentsModels } = Vendor;
/* Optional: only present once tools\build.bat has been re-run. Read off the
   namespace so an older bundle degrades to "no drag handle" instead of
   taking the entire page down. */
const TransformControls = Vendor.TransformControls || null;
import * as MK from "./markup.js";
import { iconButton, iconSvg, decorateIcons } from "./icons.js";
import { attachPalette } from "./palette.js";
import * as Check from "./selfcheck.js";
import { openIssue } from "./issuepanel.js";
import { createMeasure } from "./measure3d.js";
import { createArrows } from "./arrows3d.js";
import { createQuality } from "./quality.js";
import { createWalk } from "./walk.js";
import { openMenu } from "./ctxmenu.js";
import { createViewCube } from "./viewcube.js";
import { typeOf, typeColor, typeOptions, shortDate } from "./issuetypes.js";
import { buildBcf, buildAxisTest, buildTopTest, download, readBcf } from "./bcf.js";
import * as Store from "./store.js";
import { startGoto, issueLink } from "./goto.js";
import { fetchLwkm, parseLwkm, createLwkModel, writeMobileLwkm, ENVELOPE_CATS, pocheUniforms, useNodeMaterials,
         parseTileIndex, gunzipIfNeeded, createTileStream } from "./lwkm.js";
import { ensureProject } from "./projects.js";
import * as Tele from "./telemetry.js";
import { createCutLines } from "./cutlines.js";
import { initPanels, initVGrip } from "./panels.js";
import { createAO } from "./ao.js";
import { copyIds, showInRevit, wireElementBlocks } from "./revit.js";

/* Fragments geometry is in METRES. The Revit exporter writes millimetres
   everywhere - manifest paper_to_model, link transforms, issue positions -
   so everything crossing that boundary is scaled here, in one place. */
const MM_PER_UNIT = 1000;
const toMM = (v) => v * MM_PER_UNIT;
const fromMM = (v) => v / MM_PER_UNIT;

const S = {
  manifest: null,
  fragments: null,
  loaded: new Map(),      // name -> { model, object, entry }
  scene: null, camera: null, renderer: null, controls: null,
  raycaster: new THREE.Raycaster(),
  bounds: new THREE.Box3(),
  dirty: true,
  applyTransforms: true,
  lastPickError: null,
  mouseMode: null,
  picked: null,          // { part, localId } currently highlighted
  mode: "nav",
  items: [],
  pins: null,
  pending: null,
};

/* Anything that marks the view dirty also asks for a new frame: the
   render loop draws only when something changed (see tick), so a still
   view of a large model costs nothing. */
{
  let _dirty = true;
  Object.defineProperty(S, "dirty", {
    get() { return _dirty; },
    set(v) { _dirty = v; if (v) S.needsRender = true; },
    configurable: true,
  });
  S.needsRender = true;
}

const $ = (s) => document.querySelector(s);

/* Phones and tablets. Safari on iPad and iPhone gives a page far less
   memory than a desktop browser and reloads it, without a word, when it
   runs out - which is what "crashes and the page goes wrong" was. On these
   devices the viewer draws at 1x resolution without antialiasing and loads
   typical floors only near the view (light mode, which can be switched
   off in the Models panel, or forced with ?light=1 / ?light=0). */
// far copies (coarser geometry far away); ?lod=0 turns them off to compare
S.lod = new URLSearchParams(location.search).get("lod") !== "0";
// inside a building only this floor and the ones either side; ?band=0 off
S.floorBand = new URLSearchParams(location.search).get("band") !== "0";
// triangles a phone or tablet builds at most (with phone copies)
const PHONE_TRIS = 1800000;
/* Phones and tablets: far away only the building itself, openings nearer,
   furniture and fittings only round the camera (TIER_NEAR in lwkm.js).
   ?tiers=0 draws everything at every distance; ?tiers=1 tries it on a computer. */
S.tiers = (() => {
  const q = new URLSearchParams(location.search).get("tiers");
  if (q === "0") return false;
  if (q === "1") return true;
  return /iP(hone|ad|od)|Android/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
})();
// phones and tablets: no wide outline on a section cut (it trails a
// moving plane there, being worked out afresh each time); ?cutlines=1 / 0
S.cutLineOn = (() => {
  const q = new URLSearchParams(location.search).get("cutlines");
  if (q === "1" || q === "0") return q === "1";
  return !(/iP(hone|ad|od)|Android/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
})();
S.lowMemory = /iP(hone|ad|od)|Android/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  || (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2);
S.light = (() => {
  const q = new URLSearchParams(location.search).get("light");
  if (q === "1" || q === "0") return q === "1";
  try {
    const v = localStorage.getItem("lwk.light");
    if (v === "1" || v === "0") return v === "1";
  } catch (e) {}
  return S.lowMemory;
})();

/* Errors have to be visible in the page. Without a console, an exception
   inside an async handler simply stops that handler with no trace, which is
   exactly how picking appeared to "do nothing" while actually throwing. */
function showError(where, err) {
  /* Firefox's error.stack contains no message line, unlike Chrome's, so
     building the text from the stack alone drops the only part that
     identifies the fault. */
  let msg;
  if (err instanceof Error) {
    msg = (err.name || "Error") + ": " + (err.message || "(no message)");
    if (err.stack) msg += "\n" + err.stack;
  } else {
    msg = String(err);
  }
  const el = document.getElementById("errlog");
  if (el) {
    el.hidden = false;
    el.textContent = `[${where}] ${msg}`.slice(0, 900);
  }
  const panel = document.getElementById("inspect-body");
  if (panel) {
    panel.className = "pad";
    panel.innerHTML = `<b style="color:#e8b23a">Error in ${where}</b>`
      + `<pre style="white-space:pre-wrap;font-size:11px;margin-top:6px">`
      + String(msg).slice(0, 700).replace(/</g, "&lt;") + "</pre>";
  }
}

addEventListener("error", (e) => showError("window", e.error || e.message));
addEventListener("unhandledrejection",
  (e) => showError("promise", e.reason));
const status = (m) => { $("#status").textContent = m; };

/* Sheets and 3D are separate pages, so switching between them is a full
   reload. Without this the model selection is lost every time. */
const selKey = () =>
  "lwk-viewer:models:"
  + ((S.manifest && S.manifest.source && S.manifest.source.title) || "x");

function readSelection() {
  try { return new Set(JSON.parse(localStorage.getItem(selKey()) || "[]")); }
  catch (e) { return new Set(); }
}
function writeSelection() {
  try {
    const on = [...document.querySelectorAll("#model-list input")]
      .filter((b) => b.checked)
      .map((b) => b.dataset.name);
    localStorage.setItem(selKey(), JSON.stringify(on));
  } catch (e) {}
}

/* ---------------------------------------------------------------- scene */

/* Safari on an iPad turns 3D graphics off for a site after that site has
   run it out of memory (the page reloads itself, then every visit fails
   with "getShaderPrecisionFormat ... null"). Say so in words, and how to
   get it back, instead of an error trace. */
function noWebGL(wrap, err, lost) {
  const box = document.createElement("div");
  box.className = "nowebgl";
  box.innerHTML = `<b>${lost ? "The 3D view ran out of memory" : "3D cannot start on this device right now"}</b>`
    + `<p>${S.lowMemory
        ? "Safari has switched 3D graphics off for this site, which it does after a page runs short of memory. "
          + "To get it back: close the viewer's tabs, then close Safari completely (swipe it away in the app "
          + "switcher) and open it again. Light mode (Models panel) loads less next time."
        : "The browser could not give the page a 3D canvas. Close other tabs with 3D content, or restart the browser."}</p>`
    + `<p>The drawings still work: <a href="index.html${location.search.replace(/([?&])(at|select|label)=[^&]*/g, "$1")}">open the sheets</a>.</p>`;
  if (wrap && !wrap.querySelector(".nowebgl")) wrap.appendChild(box);
  status(lost ? "3D ran out of memory." : "3D is not available.");
}

/* Which graphics interface draws the model: WebGL, as always, or the
   WebGPU trial (Performance panel, "Drawing with"; ?gpu=webgpu / webgl).
   The trial keeps every file and model format as it is - only the way the
   picture is drawn changes - so the two can be compared on the same
   project and the same device. */
function wantedGpuMode() {
  const q = new URLSearchParams(location.search).get("gpu");
  if (q === "webgpu" || q === "webgl") {
    // remembered, so ?gpu=webgl once is always a way back
    try { if (q === "webgpu") localStorage.setItem("lwk.gpu", "webgpu"); else localStorage.removeItem("lwk.gpu"); } catch (e) {}
    return q;
  }
  try { return localStorage.getItem("lwk.gpu") === "webgpu" ? "webgpu" : "webgl"; } catch (e) { return "webgl"; }
}

async function makeWebGpuRenderer() {
  if (!navigator.gpu) throw new Error("this browser has no WebGPU (Safari: iOS / macOS 26 or later)");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no WebGPU graphics adapter on this device");
  const GPU = await import("./vendor/three-webgpu.js");
  // tests only (?gpugl=1): the same node materials through WebGL 2
  const forceWebGL = new URLSearchParams(location.search).get("gpugl") === "1";
  const R = new GPU.WebGPURenderer({
    antialias: !S.lowMemory, logarithmicDepthBuffer: true, powerPreference: "high-performance", forceWebGL,
  });
  await R.init();
  if (!forceWebGL && (!R.backend || !R.backend.isWebGPUBackend)) throw new Error("WebGPU did not start (the browser fell back to WebGL)");
  /* tests only (?gpurt=1): draw into a texture, never onto the page - a
     browser without a screen loses its WebGPU device the moment a canvas
     is shown, so a test reads the picture back from the texture instead */
  if (new URLSearchParams(location.search).get("gpurt") === "1") {
    S.gpuRT = new THREE.RenderTarget(1500, 900, { depthBuffer: true });
    R.setRenderTarget(S.gpuRT);
  }
  useNodeMaterials({ GPU, TSL: GPU.TSL });
  S.GPU = GPU;
  /* Section cuts: WebGPU takes its cutting planes from a clipping group
     round the model, not from the renderer. The model scene is put inside
     one, under a root scene that carries the background. */
  S.gpuRoot = new THREE.Scene();
  S.clipGroup = new GPU.ClippingGroup();
  S.clipGroup.clipIntersection = false;
  S.gpuRoot.add(S.clipGroup);
  const info = adapter.info || {};
  S.gpuBackend = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "WebGPU";
  return R;
}

/* The WebGL / WebGPU button says what draws now and what a click gives. */
function gpuButtonLabel() {
  const gb = document.getElementById("perf-gpu");
  if (!gb) return;
  const now = S.gpuMode === "webgpu";
  gb.textContent = now ? "WebGPU (trial) - back to WebGL" : "WebGL - try WebGPU";
  gb.title = S.gpuFailed ? "WebGPU could not start here: " + S.gpuFailed : "";
}

async function initScene() {
  const wrap = $("#canvas-wrap");

  S.scene = new THREE.Scene();
  /* A pale ground rather than black. A dark viewport under a light
     interface reads as an embedded video player; the reference viewers all
     put the model on a light field so it looks like part of the page. */
  S.scene.background = new THREE.Color(0xeef1f5);

  /* Everything that marks up the model - section handles, the box outline,
     issue pins, measurements - lives in a second scene drawn after the
     model with clipping switched off. Clipping planes on the renderer are
     global: they cut every material, and no per-material setting exempts
     one. Putting the handles in the same scene is why the arrows were
     sliced in half by the very cut they control. */
  S.overlay = new THREE.Scene();

  S.fovDefault = 55;
  S.camera = new THREE.PerspectiveCamera(
    55, wrap.clientWidth / wrap.clientHeight, 0.1, 1e6);
  S.camera.position.set(60, 40, 60);
  S.camera.near = 0.005;        // 5 mm, in metres
  S.camera.far = 1e5;           // 100 km

  /* A building spans millimetres to hundreds of metres. A normal depth
     buffer cannot hold both, so close-ups turn to mush no matter how the
     near plane is tuned. A logarithmic buffer distributes precision by
     magnitude instead, which is what makes detail viewing possible. */
  S.gpuMode = wantedGpuMode();
  if (S.gpuMode === "webgpu") {
    try {
      S.renderer = await makeWebGpuRenderer();
    } catch (e) {
      console.warn("WebGPU", e);
      S.gpuMode = "webgl";
      S.gpuFailed = e.message;
      setTimeout(() => status("WebGPU trial could not start - " + e.message + ". Drawing with WebGL."), 1500);
    }
  }
  gpuButtonLabel();
  if (S.gpuMode === "webgpu") {
    S.gpuRoot.background = S.scene.background;
    S.clipGroup.add(S.scene);
  } else try {
    S.renderer = new THREE.WebGLRenderer({
      // Antialiasing multiplies the drawing buffer; a phone cannot spare it.
      antialias: !S.lowMemory,
      logarithmicDepthBuffer: true,
      /* Not kept between frames: keeping it costs every frame (above all
         on phones and tablets). A picture of the view (captureViewpoint)
         draws the frame and reads it in the same moment, which needs no
         kept buffer. */
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    // asking the driver whether each shader compiled stalls until it has;
    // only worth it when looking for a fault (?debug=shaders)
    S.renderer.debug.checkShaderErrors = new URLSearchParams(location.search).get("debug") === "shaders";
  } catch (e) {
    noWebGL(wrap, e);
    throw e;
  }
  S.renderer.domElement.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    noWebGL(wrap, null, true);
  });
  if (S.gpuMode === "webgpu") {
    // no wide cut outline in the trial (it is drawn with a WebGL shader)
    S.cutLineOn = false;
  }
  // how this device copes: reported to the server (telemetry.js)
  Tele.startTelemetry({ page: EMBED ? "3d-beside-sheet" : "3d", project: Store.currentProject(),
    renderer: S.renderer, snapshot: teleSnapshot,
    token: () => { try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; } } });
  // Global clipping: the section box planes are applied to every material,
  // including the ones the fragments loader creates.
  S.renderer.clippingPlanes = [];
  // the cut's outline is clipped by the other cutting planes (its own material)
  S.renderer.localClippingEnabled = true;
  S.cutLines = createCutLines(THREE, S.overlay);
  /* picture quality that follows the frame rate while the view moves;
     Performance panel, or ?autoq=0 / 1 */
  S.quality = createQuality({
    on: (() => {
      const q = new URLSearchParams(location.search).get("autoq");
      if (q === "0" || q === "1") return q === "1";
      try { return localStorage.getItem("lwk.autoq") !== "0"; } catch (e) { return true; }
    })(),
    targetFps: S.lowMemory ? 30 : 40,
  });
  // A phone's 3x screen means nine times the pixels to draw and hold.
  S.renderer.setPixelRatio(S.lowMemory ? 1 : Math.min(devicePixelRatio, 2));
  // Counted per frame (model pass + overlay pass) for the performance
  // readout, so reset by hand at the start of each frame.
  S.renderer.info.autoReset = false;
  S.renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  wrap.appendChild(S.renderer.domElement);
  wireNavCursors(S.renderer.domElement);

  S.controls = new OrbitControls(S.camera, S.renderer.domElement);
  S.controls.enableDamping = true;

  /* Mouse mapping follows the BIM viewers people already use: left button
     selects, middle drags the view, wheel zooms, right button orbits. The
     default three.js mapping puts orbit on the left, which fights with
     picking - every attempt to select an element nudges the camera. */
  S.controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  // Zoom towards the pointer rather than the screen centre, so a detail
  // stays under the cursor as it grows.
  S.controls.zoomToCursor = true;
  S.controls.screenSpacePanning = true;
  S.controls.dampingFactor = 0.12;
  /* Models are in millimetres, so the default pan/zoom speeds feel frozen
     until the distances are scaled up to match. */
  S.controls.panSpeed = 1.5;
  S.controls.zoomSpeed = 1.2;
  /* Without this, dollying moves toward the orbit target, which sits at the
     centre of the whole site. Approaching a corner of the model then stalls
     asymptotically and feels like a zoom limit. */
  S.controls.zoomToCursor = true;
  S.controls.zoomSpeed = 1.2;
  S.controls.minDistance = 0.01;      // 10 mm
  S.controls.maxDistance = 5e6;

  /* Lighting retuned for the pale background: less ambient so faces keep
     their shading, and a soft bounce from below so the underside of a slab
     does not go flat black against a light field. */
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8ccd4, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(1, 2, 1.5);
  S.scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-1, 0.5, -1);
  S.scene.add(fill);

  /* Sized and positioned properly once a model is framed: y = 0 is the
     Revit project base point, which on this project sits inside the podium
     rather than at ground level. */
  // Drawn once the model is in: at the bottom of it, like the ground.
  S.grid = null;

  const fitCanvas = () => {
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    S.camera.aspect = wrap.clientWidth / wrap.clientHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    S.dirty = true;
  };
  addEventListener("resize", fitCanvas);
  /* The ribbon wraps to a second row when tools do not fit, which changes
     the 3D area without any window resize. */
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(wrap);

  /* OrbitControls calls preventDefault on pointerdown and captures the
     pointer, so the browser never dispatches a click event on the canvas.
     Tracking pointerdown/pointerup and treating a near-stationary release as
     a click is the only way to pick reliably while orbiting is enabled. */
  /* When the cursor is over geometry, scale the dolly step to how far that
     surface actually is. Without this the step stays tied to the orbit
     target and shrinks to nothing long before the surface is reached. */
  let wheelBusy = false;
  const el0 = S.renderer.domElement;
  el0.addEventListener("wheel", (ev) => {
    if (wheelBusy || !S.loaded.size) return;
    wheelBusy = true;
    setTimeout(() => { wheelBusy = false; }, 250);
    pickAt(ev).then((found) => {
      if (!found || !found.hit.point) return;
      const toSurface = S.camera.position.distanceTo(found.hit.point);
      const toTarget = S.camera.position.distanceTo(S.controls.target);
      if (toTarget <= 0.001) return;
      // Keep the effective step proportional to the surface distance.
      const k = Math.min(4, Math.max(0.05, toSurface / toTarget));
      S.controls.zoomSpeed = 1.2 * k;
    }).catch(() => {});
  }, { passive: true });

  let downAt = null;
  const el = S.renderer.domElement;
  wireOrbitCentre(el);

  // Throttled: each hover is a worker round trip.
  let hoverAt = 0;
  el.addEventListener("pointermove", (ev) => {
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    if (S.walk && S.walk.picking) walkHover(ev);
    else if (S.mode === "measure") measureHover(ev);
    else if (S.mode === "face" || S.mode === "align") faceHover(ev);
  }, { passive: true });
  /* Hold one finger (or the Pencil) still on the model: a new issue there,
     whatever the tool - a tablet has no right button and a double tap
     already means "focus". A second finger, or moving, cancels it. */
  let press = null;
  const pointersDown = new Set();
  const cancelPress = () => { if (press) { clearTimeout(press.t); press = null; } };
  let rightAt = null;
  el.addEventListener("pointerdown", (ev) => {
    pointersDown.add(ev.pointerId);
    cancelPress();
    /* A mouse moves the view exactly as far as the mouse moved and stops
       where the mouse stops: the drift after letting go (damping) is for
       fingers. With a mouse it carried the view on past the release, which
       read as the view shifting by itself. */
    S.controls.enableDamping = ev.pointerType !== "mouse";
    if (ev.button === 2) rightAt = { x: ev.clientX, y: ev.clientY };
    if (ev.button !== 0) { downAt = null; return; }
    downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    if ((ev.pointerType === "touch" || ev.pointerType === "pen") && pointersDown.size === 1
        && !(S.walk && (S.walk.on || S.walk.picking)) && S.mode !== "measure") {
      const x = ev.clientX, y = ev.clientY;
      press = { x, y, t: setTimeout(async () => {
        press = null;
        downAt = null;                       // not a click as well
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
        status("New issue here ...");
        try {
          const found = await pickAt({ clientX: x, clientY: y });
          if (!found || !found.hit.point) { status("Nothing there to put an issue on."); return; }
          let guid = null;
          try {
            const g = await found.part.model.getGuidsByLocalIds([found.hit.localId]);
            guid = g && g[0];
          } catch (e) {}
          openIssue3D(found.hit.point, { guid, name: found.name, part: found.part, localId: found.hit.localId });
        } catch (e) { showError("long press", e); }
      }, 600) };
    }
  });
  el.addEventListener("pointermove", (ev) => {
    if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress();
  }, { passive: true });
  const lift = (ev) => { pointersDown.delete(ev.pointerId); cancelPress(); };
  el.addEventListener("pointercancel", lift);
  el.addEventListener("pointerleave", (ev) => { if (ev.pointerType !== "mouse") lift(ev); });

  // Right-click re-centres without changing the selection, for working
  // close in without repeatedly picking elements.
  /* Only a right CLICK moves the orbit centre - worked out when the button
     comes up without having moved. (The browser's own "context menu" event
     comes at the release on Windows and at the press elsewhere, and it came
     at the end of every orbit made with the right button too: the centre
     moved, and the view swung, on each release.) */
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());
  el.addEventListener("pointerup", (ev) => {
    if (ev.button !== 2 || !rightAt) return;
    const r = rightAt;
    rightAt = null;
    if (Math.hypot(ev.clientX - r.x, ev.clientY - r.y) > 4) return;
    if (S.walk && S.walk.on) return;       // walking: the view follows the walker
    pickAt(ev).then((found) => {
      if (!found || !found.hit.point) return;
      S.controls.target.copy(found.hit.point);
      S.controls.update();
      S.dirty = true;
      status("Orbit centre moved here.");
    }).catch((e) => showError("recentre", e));
  });
  el.addEventListener("pointerup", (ev) => {
    pointersDown.delete(ev.pointerId);
    cancelPress();
    if (!downAt || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    if (moved <= 4 && held < 600) {
      Promise.resolve(onPick(ev)).catch((e) => showError("click", e));
    }
  });
  el.addEventListener("dblclick", (ev) => {
    Promise.resolve(onFocus(ev)).catch((e) => showError("dblclick", e));
  });

  /* Walking at eye level: its own mouse and keys, and the camera is moved
     by the walker rather than by the orbit controls. */
  S.walk = createWalk({
    THREE, S, status,
    rayHit: rayHit,
    floors: () => S.floorRows || [],
    prepare: prepareWalk,
    onState: walkState,
  });
  S.walk.attach(el);
  wireWalkUi();

  let lastReport = 0;
  let lastFrame = performance.now();
  const tick = () => {
    requestAnimationFrame(tick);
    /* Declared first: the display-mode sweep below reads it, and reading a
       const before its line throws - which, in White and X-ray, stopped the
       rest of every frame (the camera and floor readouts froze). */
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (S.walk && S.walk.on) S.walk.step(dt);
    else S.controls.update();
    // Grips keep a constant size on screen as the camera moves.
    if (S.arrows) S.arrows.update();

    /* Fast 3D models: cull before drawing (what is off screen, cut away
       or too small to see is not drawn - less still while the view is
       moving), and draw only when something changed. */
    const camKey = viewKey();
    const moved = camKey !== S._camKey;
    Tele.frame(dt * 1000, moved || !!(S.walk && S.walk.on));
    if (moved) { S._camKey = camKey; S._movedAt = now; S._settled = false; }
    S._moving = moved || !!(S.walk && S.walk.on);
    const settle = !moved && !S._settled && now - (S._movedAt || 0) > 220;
    const lwkOnly = lwkOnlyScene();
    // far copies waiting: make some, then cull and draw again
    let lodDone = false;
    if (S._lodPending && !S._extBusy) {
      const budget = (S.lowMemory ? 4 : 8) / Math.max(1, S.loaded.size);
      for (const rec of S.loaded.values()) {
        const m = rec.lwk && rec.parts[0] && rec.parts[0].model;
        if (m && m.lodWork && m.lodWork(Math.max(1, budget))) lodDone = true;
      }
    }
    // measuring: the ring that runs out from a new snap
    if (S.measure && S.measure.tick(now)) S.needsRender = true;
    // streamed pieces: more fetched as slots free, a new cull when some arrived
    if (S.tileBudget) S.tileBudget.pump();
    const upNext = (S._uploadPending || (S.tileBudget && S.tileBudget.changed)) && !S._extBusy;
    if (S.tileBudget && S.tileBudget.changed && (S.renderer.clippingPlanes || []).length) scheduleCutLines(900);
    if (moved || settle || S.needsRender || lodDone || upNext) {
      if (moved || settle || lodDone || upNext) lwkCull((lodDone || upNext) && !moved ? false : !settle && moved);
      if (lodDone || upNext) S.needsRender = true;
      if (settle) S._settled = true;
      if (moved || settle) motionResolution(moved && !settle);
    }
    const draw = !lwkOnly || moved || settle || S.needsRender
      || (S.walk && S.walk.on) || now - (S._lastDraw || 0) > 1500;
    if (draw) {
      S.needsRender = false;
      S._lastDraw = now;
      S.renderer.info.reset();
      renderModel();

      // Second pass: no clipping, no clear. Depth is kept from the model pass
      // so a pin can still tell whether the building is in front of it.
      const planes = S.renderer.clippingPlanes;
      S.renderer.clippingPlanes = [];
      S.renderer.autoClear = false;
      S.renderer.render(S.overlay, S.camera);
      S.renderer.autoClear = true;
      S.renderer.clippingPlanes = planes;
    }
    // the frame rate while moving decides the moving picture's quality
    // (not while models are still being built or sent to the graphics card:
    // those frames are slow for another reason)
    const busy = !S.modelsReady || S._uploadPending || S._extBusy;
    if (S.modelsReady && !S._qReset) { S._qReset = true; if (S.quality) S.quality.reset(); }
    if (S.quality && S.quality.frame(now, draw && !busy, (moved || !!(S.walk && S.walk.on)) && !busy)) {
      S._camKey = null;             // cull and size again at the new step
      qualityNote();
    }
    if (S.cube) S.cube.update();
    if (S.display && S.display !== "shaded" && now - (S.lastMatSweep || 0) > 800) {
      S.lastMatSweep = now;
      applyDisplayMaterials();
    }

    /* Distance from camera to orbit target, live. If this keeps falling
       while the view stops changing, geometry is being culled; if it stops
       falling, the camera itself is being clamped. Those are different
       faults with different fixes. */
    perfFrame(now);
    if (EMBED) reportCam(now);
    if (now - lastReport > 200) {
      lastReport = now;
      sizePins();
      const d = S.camera.position.distanceTo(S.controls.target);
      const el = document.getElementById("cam");
      if (el) {
        el.textContent = d >= 1 ? d.toFixed(2) + " m"
                                : (d * 1000).toFixed(0) + " mm";
      }
      // The floor being looked at: the level at the orbit centre.
      const lv = document.getElementById("cam-level");
      if (lv) lv.textContent = levelAt(S.controls.target.y) || "-";
    }
  };
  tick();
}

/* ------------------------------------------------------------ fragments */

async function initFragments() {
  /* The worker is bundled locally by tools/build.mjs. The library's own
     getWorker() pulls it from unpkg, which needs internet access and pins
     the app to a CDN. */
  const res = await fetch("./vendor/fragments-worker.js");
  if (!res.ok) {
    throw new Error("vendor/fragments-worker.js is missing. "
      + "Run tools/build.bat first.");
  }
  const url = URL.createObjectURL(
    new Blob([await res.text()], { type: "text/javascript" }));

  S.fragments = new FragmentsModels(url);

  /* Fragments stores geometry relative to a local base to keep float
     precision usable at survey coordinates, and holds the real placement
     separately. autoCoordinate aligns every model to the first one loaded.
     With it off, each model sits at its own local origin - which is exactly
     what collapsed seventeen floors onto one level. */
  S.fragments.settings.autoCoordinate = true;
  /* Level of detail. The library's lowest setting is 0; below that it
     keeps lowering, so small or distant things (furniture, mullions, far
     floors) drop to outlines or out of view sooner. On a phone the whole
     building on screen at once is what ran Safari out of memory. */
  if (S.lowMemory) S.fragments.settings.graphicsQuality = -1.5;

  S.fragments.onModelLoaded.add((model) => {
    model.useCamera(S.camera);
    /* Deliberately NOT added to the scene here. Each placement is parented
       to its own group in loadModel instead: with autoCoordinate on, the
       library writes to model.object's own matrix during update(), which
       silently discards any transform set on it directly. A parent group is
       ours alone. */
  });

  /* Fragments streams geometry from its worker on demand. Nothing reaches
     the scene until update() is called, which is why every model can report
     "loaded" while the viewport stays empty. It has to run whenever the
     camera settles, so tiles for the new view get requested. */
  S.controls.addEventListener("change", () => { S.dirty = true; });
  setInterval(() => {
    if (!S.dirty || !S.fragments) return;
    S.dirty = false;
    S.fragments.update().catch((e) => showError("fragments.update", e));
  }, 120);
}

/* Placing each copy of a repeated link.

   The IFC exporter puts every copy of a typical floor on the same storey,
   so a repeated link is exported once, on its own, and placed here from
   Revit's own instance transforms. A point of that floor passes through:

     viewer (Y-up)  -> IFC axes (Z-up)                      Zm
     link shared    -> link internal                        PL_link
     link internal  -> host internal (instance transform)   T_i
     host internal  -> host shared                          PL_host^-1
     IFC axes       -> viewer axes                          Zm^-1
     host shared    -> scene                                C_host

   and the copy's own coordination shift (C_copy) is undone first:

     X_i = C_host . Zm^-1 . PL_host^-1 . T_i . PL_link . Zm . C_copy^-1

   Every factor but T_i was already proven on the host: the shared chain
   against a Revit spot coordinate, the internal chain by BCF cameras
   landing in Revit. Checked against a made-up ground truth before use:
   25 floors, largest error 1.6e-10 m. */
const Zm = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

function locationMatrix(pl) {
  if (!pl || !pl.origin_mm) return new THREE.Matrix4();
  const o = pl.origin_mm.map(fromMM);
  const fwd = new THREE.Matrix4().set(
    pl.basis_x[0], pl.basis_y[0], pl.basis_z[0], o[0],
    pl.basis_x[1], pl.basis_y[1], pl.basis_z[1], o[1],
    pl.basis_x[2], pl.basis_y[2], pl.basis_z[2], o[2],
    0, 0, 0, 1);
  // Same direction as was proven for the host: both come from the same
  // Revit call, so they mean the same thing.
  return _plDir === "inverse" ? fwd.invert() : fwd;
}

/* The host model's part - asked for by role, never by which loaded first.
   Every conversion between the scene and Revit is built on the host's
   frame; relying on load order is what made the frame shift between
   sessions. Falls back to the first loaded only for exports that do not
   mark a host. */
function firstHostPart() {
  for (const rec of S.loaded.values()) {
    if (rec.entry && rec.entry.role === "host") {
      for (const p of rec.parts) if (p.coord) return p;
    }
  }
  for (const rec of S.loaded.values()) {
    for (const p of rec.parts) if (p.coord) return p;
  }
  return null;
}

function placeInstanced(entry, parts) {
  const hostPL = projectLocationMatrix();
  const hostC0 = coordinationMatrix();
  const hostPart = firstHostPart();
  const hostC = hostC0 && hostPart
    ? new THREE.Matrix4().multiplyMatrices(
        (hostPart.model.object.updateMatrix(), hostPart.model.object.matrix), hostC0)
    : hostC0;
  if (!hostPL || !hostC) {
    status(`${entry.name}: the host model's frame is not known yet, so its `
      + "copies cannot be placed. Load the host model first.");
    return;
  }
  const linkPL = locationMatrix(entry.link_location);
  const Zi = Zm.clone().invert();
  const hostPLi = hostPL.clone().invert();
  let placed = 0;
  for (const p of parts) {
    if (!p.place || !p.coord) continue;
    /* What fragments actually did to this copy: its own coordinates matrix
       (p.coord), AND - for every model after the first - a translation
       added to model.object.position to line its base point up with the
       first model's (FragmentsModels.load, autoCoordinate). The first
       version of this used p.coord alone, which left the whole stack of
       floors shifted by that translation: right spacing, wrong place. */
    p.model.object.updateMatrix();
    const applied = new THREE.Matrix4().multiplyMatrices(p.model.object.matrix, p.coord);
    const X = new THREE.Matrix4().multiplyMatrices(hostC, Zi)
      .multiply(hostPLi).multiply(matrixOf(p.place))
      .multiply(linkPL).multiply(Zm).multiply(applied.invert());
    X.decompose(p.object.position, p.object.quaternion, p.object.scale);
    p.object.updateMatrixWorld(true);
    placed++;
  }
  status(`${entry.name}: ${placed} of ${parts.length} copies placed from Revit's transforms.`);
}

function matrixOf(t) {
  const m = new THREE.Matrix4();
  const o = t.origin.map(fromMM);      // manifest is mm, scene is metres
  m.set(
    t.basis_x[0], t.basis_y[0], t.basis_z[0], o[0],
    t.basis_x[1], t.basis_y[1], t.basis_z[1], o[1],
    t.basis_x[2], t.basis_y[2], t.basis_z[2], o[2],
    0, 0, 0, 1);
  return m;
}

/* A typical floor is modelled once and linked dozens of times at different
   levels: 41 instances across 17 documents here. Placing only the first is
   what turned a 40-storey tower into a single slab, so every instance gets
   its own placement. */
function placements(entry) {
  if (entry.coordinates === "host") return [null];       // Revit baked it in
  // A repeated link exported on its own: one placement per copy, always.
  // Its frame is resolved after loading, by placeInstanced().
  if (entry.coordinates === "link-shared") {
    /* Two instances at exactly the same place are the same floor twice:
       drawn twice they flicker, and each costs a full copy in memory. TP14
       had one typical-floor copy placed twice at +0.00 m. The exporter now
       leaves such duplicates out; this covers exports made before that. */
    const seen = new Set();
    const out = [];
    let dup = 0;
    for (const i of entry.instances || []) {
      const t = i && i.transform;
      if (!t) continue;
      const key = [...t.origin.map((v) => Math.round(v)),
                   ...t.basis_x.map((v) => v.toFixed(4)),
                   ...t.basis_y.map((v) => v.toFixed(4))].join(",");
      if (seen.has(key)) { dup++; continue; }
      seen.add(key);
      out.push(t);
    }
    if (dup) status(`${entry.name}: ${dup} duplicate placement(s) skipped `
                    + "(same place as another copy).");
    return out;
  }
  if (!S.applyTransforms) return [null];                 // diagnostic override
  const inst = (entry.instances || []).filter((i) => i && i.transform);
  /* An identity placement means the link sits at the model origin and its
     elevation is already in the geometry. Only real placements are applied,
     so a link with one identity instance is drawn once, untouched. */
  const real = inst.filter((i) => !i.identity);
  if (!inst.length) return [null];
  if (!real.length) return [null];
  return real.map((i) => i.transform);
}

/* ------------------------------------------------ fast 3D format (.lwkm)

   Written by the exporter's fast3d.py straight from Revit's renderer: the
   geometry is in Revit's internal coordinates and the manifest says
   exactly how they relate to shared coordinates ("lwk_frame"), so nothing
   has to be probed or calibrated - the frame is known, not worked out:

     scene = C . Zi . IS . L . O . v
       v   a vertex, relative to the model's offset O (metres)
       L   the link's placement in the host (identity for the host)
       IS  internal -> shared coordinates (from Revit's base points)
       Zi  Z-up -> Y-up
       C   a shift that keeps the numbers near the origin

   "Original" coordinates (sceneToOriginal) are shared, Y-up, as with the
   IFC models, so everything that converts - issues, BCF, sheets, floors -
   works unchanged. */
function lwkFrame() {
  if (!S.manifest) return null;
  if (S.lwkFrame !== undefined) return S.lwkFrame;
  const f = S.manifest.lwk_frame;
  if (!f) { S.lwkFrame = null; return null; }
  const r = f.internal_to_shared_mm;
  const IS = new THREE.Matrix4();
  if (r && r.length === 12) {
    IS.set(r[0], r[1], r[2], r[3] / 1000, r[4], r[5], r[6], r[7] / 1000,
           r[8], r[9], r[10], r[11] / 1000, 0, 0, 0, 1);
  }
  const Zi = Zm.clone().invert();
  const c = f.center_internal_m || [0, 0, 0];
  const centre = new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(IS).applyMatrix4(Zi);
  const C = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  S.lwkFrame = { IS, Zi, C, base: new THREE.Matrix4().multiplyMatrices(C, Zi).multiply(IS),
                 PL: IS.clone().invert(), note: f.note || "" };
  return S.lwkFrame;
}

/* Which export a model file is: elements and index count together. An
   exterior list worked out for another export is not used. */
function lwkSig(head) {
  return head.el.id.length + ":" + head.bin.idx[1] + ":" + head.meshes.length;
}

function m12(r) {
  return new THREE.Matrix4().set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7],
                                 r[8], r[9], r[10], r[11], 0, 0, 0, 1);
}

/* Downloads started ahead: while one model is being built, the next one
   is already coming down (the network and the processor both busy). */
const _lwkAhead = new Map();
function lwkFetch(url) {
  const p = _lwkAhead.get(url);
  if (p) { _lwkAhead.delete(url); return p; }
  return fetchLwkm(url);
}
function lwkPrefetch(entry) {
  if (!entry || entry.format !== "lwkm" || S.loaded.has(entry.name)) return;
  // a phone fetches its own copy (or the whole file) in loadLwk; ahead only on a computer
  if (S.lowMemory) return;
  const url = Store.dataUrl(entry.fragments);
  if (_lwkAhead.has(url) || _lwkAhead.size >= 2) return;
  const p = fetchLwkm(url);
  p.catch(() => _lwkAhead.delete(url));
  _lwkAhead.set(url, p);
}

/* A phone's copy of a model (see makeMobileFiles): only what is seen from
   outside, the smallest things left out. Made by the first computer that
   opens the export; used only while it matches the exterior list. */
/* Rule 2: walls, windows and doors are never left out (rule 1 dropped the
   smallest pieces, a short wall or a window among them). A copy made by
   an older rule is simply not used, and a computer makes a new one. */
const MOBILE_RULE = 3;          // 3: made from the grown exterior list (EXT_RULE 2)
/* The exterior list's own rule. 2: openings in the outside walls count as
   outside too (growExterior) - a door deep in a podium's entrance, a window
   behind louvres or a curtain wall panel was often missed from 26
   directions, and then never drawn on a phone. */
const EXT_RULE = 2;
function mobileName(entry) { return entry.fragments.replace(/\.lwkm$/i, `.mobile${MOBILE_RULE}.lwkm`); }

/* ------------------------------------------------------ streamed models

   A model the server has cut into tiles (tools/tiles.mjs: <name>.tidx and
   <name>.tbin) is opened from its index alone - a fraction of the model -
   and its geometry fetched piece by piece as the view needs it, coarse
   copies first, and let go again past the memory budget. Phones and
   tablets use it whenever the tiles are there; a computer with ?tiles=1
   (or the Performance panel). */
S.tiles = (() => {
  const q = new URLSearchParams(location.search).get("tiles");
  if (q === "1" || q === "0") return q === "1";
  try { const v = localStorage.getItem("lwk.tiles"); if (v === "1" || v === "0") return v === "1"; } catch (e) {}
  if (S.lowMemory) { S.tilesWhy = "phone or tablet"; return true; }
  /* A computer on a slow line streams too: only the pieces the view needs,
     coarse first, instead of every model file whole (hundreds of MB on a
     big project - minutes on a slow office line). Slow = what the browser
     estimates, or what the last whole-file download actually managed. */
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || "") || (c.downlink && c.downlink < 5))) {
    S.tilesWhy = `slow connection (${c.downlink || "?"} Mbit/s, ${c.effectiveType || "?"})`; return true;
  }
  try {
    const mbps = Number(localStorage.getItem("lwk.lastMbps"));
    if (mbps > 0 && mbps < 30) { S.tilesWhy = `last downloads ran at ${mbps.toFixed(0)} Mbit/s`; return true; }
  } catch (e) {}
  return false;
})();
/* How much geometry a device keeps (MB): ?budget=, the Performance panel,
   or by kind of device. */
function tileBudgetMB() {
  const q = Number(new URLSearchParams(location.search).get("budget"));
  if (q > 0) return q;
  try { const v = Number(localStorage.getItem("lwk.budgetMB")); if (v > 0) return v; } catch (e) {}
  const ua = navigator.userAgent;
  if (/iPhone|iPod|Android.*Mobile/.test(ua)) return 200;
  if (S.lowMemory) return 400;
  return 1200;
}
function tileStream() {
  if (!S.tileBudget) {
    S.tileBudget = createTileStream({ limitBytes: tileBudgetMB() * 1048576, maxActive: S.lowMemory ? 2 : 6 });
  }
  return S.tileBudget;
}
const tileName = (entry, ext) => entry.fragments.replace(/\.lwkm$/i, ext);
// biggest model file a phone or tablet opens whole (compressed MB)
const PHONE_WHOLE_MAX_MB = 12;
let _prepAsked = false;
function askPrepare() {
  if (_prepAsked) return;
  _prepAsked = true;
  fetch("/api/prepare?project=" + encodeURIComponent(Store.currentProject() || ""), {
    method: "POST", headers: { "X-Viewer-Token": (() => { try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; } })() },
  }).then((r) => r.json()).then((j) => { if (j && j.queued) Tele.note("asked the server to prepare this project for phones"); }).catch(() => {});
}

async function loadTiled(entry) {
  const t0 = performance.now();
  // a model overlaid from another project brings its own frame (refs below)
  const F = entry._frame || lwkFrame();
  const idxUrl = Store.dataUrl(tileName(entry, ".tidx"));
  const res = await fetch(idxUrl).catch(() => null);
  if (!res || !res.ok) return false;
  const raw = await res.arrayBuffer();
  Tele.note(`${entry.name}: tile index ${(raw.byteLength / 1048576).toFixed(1)} MB, opening`);
  let index;
  try { index = parseTileIndex(await gunzipIfNeeded(raw)); } catch (e) { console.warn("tile index", e); return false; }
  const J = index.json;
  if (J.source && J.source !== entry.fragments) return false;
  const t1 = performance.now();
  const packUrl = Store.dataUrl(tileName(entry, ".tbin"));
  const stream = tileStream();
  const head = Object.assign({}, J.head, { inst: [], defs: [], meshes: [], groups: [] });
  const fetchPiece = async (o, n) => {
    const r = await fetch(`${packUrl}?o=${o}&n=${n}&v=${encodeURIComponent(J.sig || "")}`);
    if (!r.ok) throw new Error(`tile piece: HTTP ${r.status}`);
    return gunzipIfNeeded(await r.arrayBuffer());
  };
  const model = await createLwkModel(THREE, { head, pos: null, idx: null, mat: null }, {
    name: entry.name, propsUrl: entry.props ? Store.dataUrl(entry.props) : null, tiers: S.tiers,
    tiled: { index, stream, fetch: fetchPiece } });
  model.sig = J.sig;
  model.mobile = false;
  model.hasExterior = !!J.hasExterior;
  model.extFlags = null;
  model.extRule = J.extRule || 0;
  const off = head.offset || [0, 0, 0];
  const O = new THREE.Matrix4().makeTranslation(off[0], off[1], off[2]);
  let places = entry.role === "host" || !(entry.instances || []).length
    ? [null] : entry.instances.map((i) => i.transform_m);
  const seenPl = new Set();
  places = places.filter((t) => {
    const k = t ? t.map((v) => v.toFixed(3)).join(",") : "host";
    if (seenPl.has(k)) return false;
    seenPl.add(k);
    return true;
  });
  try {
    // (not in the WebGPU trial: there it waits on every batch in turn, and the
    // model's few shaders are made on its first frame anyway)
    if (S.gpuMode !== "webgpu" && S.renderer.compileAsync && S.camera) await S.renderer.compileAsync(model.object, S.camera, S.scene);
  } catch (e) { /* compiled on first draw instead */ }
  const parts = places.map((t, i) => {
    const api = i === 0 ? model : model.place();
    const M = F.base.clone();
    if (t) M.multiply(m12(t));
    M.multiply(O);
    const obj = api.object;
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(M);
    obj.updateMatrixWorld(true);
    S.scene.add(obj);
    api.setCoordinationMatrix(F.C);
    return { id: places.length > 1 ? `${entry.name}#${i}` : entry.name, model: api,
             object: obj, coord: F.C.clone(), place: t, idx: i };
  });
  const rec = { entry, parts, buf: null, places, light: false, calib: null, busy: null, lwk: true,
                extOnly: false, full: false, mobile: false, near: null, tiles: true };
  S.loaded.set(entry.name, rec);
  const st = model.stats();
  recordPerf({ name: entry.name, bytes: raw.byteLength, start: t0, downloadMs: t1 - t0,
               cache: cacheState(idxUrl, raw.byteLength), parseMs: performance.now() - t1,
               placements: parts.length, readyMs: performance.now() - t0, readyAt: performance.now(),
               how: "streamed (index only; pieces as needed)" });
  if (S.display && S.display !== "shaded") applyDisplayMaterials();
  applyCategories().then(renderCategories);
  S.dirty = true;
  S._camKey = null;
  groundSoon();
  reportExtent(entry, parts);
  if (S.modelsReady) { clearTimeout(MB.timer); MB.timer = setTimeout(() => { try { renderModelBrowser(); } catch (e) {} }, 600); }
  status(`${entry.name}: streamed - ${Math.round(st.triangles / 1000)}k triangles in ${st.batches} pieces, `
    + `fetched as the view needs them (budget ${Math.round(stream.limit / 1048576)} MB).`);
  return true;
}

async function loadLwk(entry, mode, near) {
  const t0 = performance.now();
  const F = entry._frame || lwkFrame();
  if (!F) throw new Error("this export has no lwk_frame in its manifest");
  Tele.note(`${entry.name}: loading (${entry.fragments_mb != null ? entry.fragments_mb + " MB" : "size unknown"}`
    + `${entry.tiles ? ", has tiles" : entry.tiles === false ? ", no tiles" : ""}${mode ? ", " + mode : ""}${near ? ", near" : ""})`);
  if (S.tiles && !near && mode !== "full" && !S._noTiles && entry.tiles !== false) {
    try { if (await loadTiled(entry)) return; } catch (e) { console.warn("tiles, falling back to the model file", e); }
  }
  // a phone or tablet without tiles for this model: the server is asked to make them
  if (S.lowMemory && entry.tiles === false) askPrepare();
  let url = Store.dataUrl(entry.fragments);
  const extUrl = Store.dataUrl(entry.fragments.replace(/\.lwkm$/i, ".ext.json"));
  const wantMobile = S.lowMemory && mode !== "full" && !S.noMobileFile;
  const extP = fetch(extUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let buf = null, data = null, mobile = false;
  if (wantMobile) {
    Tele.note(`${entry.name}: looking for the phone copy`);
    const mUrl = Store.dataUrl(mobileName(entry));
    const [mb, ex] = await Promise.all([fetchLwkm(mUrl).catch(() => null), extP]);
    if (mb) {
      try {
        const d = parseLwkm(mb);
        if (ex && d.head.mobile && d.head.mobile.source_sig === ex.sig) {
          buf = mb; data = d; mobile = true; url = mUrl;
        }
      } catch (e) { /* a broken copy: the whole file instead */ }
    }
  }
  if (!buf) {
    /* No tiles and no phone copy: the whole file. A phone or tablet opening
       a big one whole is what makes Safari give up on the page, so past a
       size it is left out, with a word on why, until the server has
       prepared it. */
    let mbz = Number(entry.fragments_mb) || 0;
    if (S.lowMemory && !mbz) {
      // an export that does not say how big the model is: ask before fetching it whole
      try {
        const h = await fetch(url, { method: "HEAD" });
        const n = Number(h.headers.get("content-length"));
        if (h.ok && n > 0) mbz = Math.round(n / 104857.6) / 10;
      } catch (e) {}
    }
    if (S.lowMemory && mbz > PHONE_WHOLE_MAX_MB && !S.forceWhole) {
      S.notPrepared = (S.notPrepared || []).concat(entry.name);
      status(`${entry.name} (${mbz} MB) is not prepared for phones and tablets yet - left out so the page `
        + "does not run out of memory. The server has been asked to prepare it; open the page again in a few minutes.");
      Tele.note(`${entry.name}: left out, ${mbz} MB whole file, not prepared`);
      throw new Error("not prepared for phones yet - left out to save memory");
    }
    Tele.note(`${entry.name}: whole file, ${mbz || "?"} MB${S.lowMemory ? " on a phone / tablet" : ""}`);
    buf = await lwkFetch(url);
    Tele.note(`${entry.name}: downloaded, parsing`);
  }
  const extRec = await extP;
  const t1 = performance.now();
  if (!data) data = parseLwkm(buf);
  const sig = mobile ? data.head.mobile.source_sig : lwkSig(data.head);
  // what is seen from outside, if it was worked out for this very export
  let exterior = null;
  if (extRec && extRec.sig === sig && Array.isArray(extRec.ext)
      && extRec.ext.length >= Math.max(1, data.head.el.id.length * 0.02)) {
    exterior = new Uint8Array(data.head.el.id.length);
    for (const e of extRec.ext) if (e >= 0 && e < exterior.length) exterior[e] = 1;
  }
  /* A phone or a tablet builds only what is seen from outside, and the
     inside of a building only while the camera is in it (lwkInside). */
  const extOnly = !!(S.lowMemory && exterior && mode !== "full");
  const model = await createLwkModel(THREE, data, {
    name: entry.name, propsUrl: entry.props ? Store.dataUrl(entry.props) : null,
    // the phone's copy has already left out what it can do without; inside,
    // small things come in round the camera
    skipSmall: S.lowMemory && !mobile && !near, tiers: S.tiers, exterior, exteriorOnly: extOnly, near: near || null });
  model.sig = sig;
  model.mobile = mobile;
  model.hasExterior = !!exterior;
  model.extFlags = exterior;
  model.extRule = exterior ? (Number(extRec.rule) || 1) : 0;
  model.extViews = exterior ? (Number(extRec.views) || 0) : 0;
  const off = data.head.offset || [0, 0, 0];
  const O = new THREE.Matrix4().makeTranslation(off[0], off[1], off[2]);
  let places = entry.role === "host" || !(entry.instances || []).length
    ? [null] : entry.instances.map((i) => i.transform_m);
  // the same placement twice (a duplicate link instance) is drawn once
  const seenPl = new Set();
  places = places.filter((t) => {
    const k = t ? t.map((v) => v.toFixed(3)).join(",") : "host";
    if (seenPl.has(k)) return false;
    seenPl.add(k);
    return true;
  });
  /* The model's shaders compiled before it is shown, in the background
     where the browser can (KHR_parallel_shader_compile): the first frame
     with a new model no longer stops the page while they compile. */
  try {
    if (S.gpuMode !== "webgpu" && S.renderer.compileAsync && S.camera) await S.renderer.compileAsync(model.object, S.camera, S.scene);
  } catch (e) { /* compiled on first draw instead */ }
  const parts = places.map((t, i) => {
    const api = i === 0 ? model : model.place();
    const M = F.base.clone();
    if (t) M.multiply(m12(t));
    M.multiply(O);
    const obj = api.object;
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(M);
    obj.updateMatrixWorld(true);
    S.scene.add(obj);
    api.setCoordinationMatrix(F.C);
    return { id: places.length > 1 ? `${entry.name}#${i}` : entry.name, model: api,
             object: obj, coord: F.C.clone(), place: t, idx: i };
  });
  const rec = { entry, parts, buf: null, places, light: false, calib: null, busy: null, lwk: true,
                extOnly, full: mode === "full", mobile, near: near ? near.world.clone() : null };
  S.loaded.set(entry.name, rec);
  const st = model.stats();
  recordPerf({ name: entry.name, bytes: buf.byteLength, start: t0, downloadMs: t1 - t0,
               cache: cacheState(url, buf.byteLength), parseMs: performance.now() - t1,
               placements: parts.length, readyMs: performance.now() - t0,
               readyAt: performance.now(),
               how: mobile ? "phone copy" : near ? "whole file, round the camera" : extOnly ? "whole file, outside only" : "whole file" });
  if (S.display && S.display !== "shaded") applyDisplayMaterials();
  applyCategories().then(renderCategories);
  S.dirty = true;
  S._camKey = null;                  // cull the new model on the next frame
  groundSoon();
  reportExtent(entry, parts);
  if (S.modelsReady) { clearTimeout(MB.timer); MB.timer = setTimeout(() => { try { renderModelBrowser(); } catch (e) {} }, 600); }
  status(`${entry.name}: ${Math.round(st.triangles / 1000)}k triangles `
    + (mobile ? "(phone copy) " : near ? `(within ${near.radius} m) ` : "")
    + `(${st.batches} draw batches), ready in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
}

async function loadModel(entry) {
  if (S.loaded.has(entry.name)) return;
  if (entry.format === "lwkm") return loadLwk(entry);
  const t0 = performance.now();
  const url = Store.dataUrl(entry.fragments);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${entry.fragments}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const t1 = performance.now();
  const perf = { name: entry.name, bytes: buf.byteLength, start: t0,
                 downloadMs: t1 - t0, cache: cacheState(url, buf.byteLength) };

  const places = placements(entry);
  /* Light mode (phones and tablets): a typical floor placed dozens of times
     is loaded only for the floors near the view. Every copy is a whole
     model in memory, and 36 of them is what made iPad and iPhone Safari
     give up and reload the page. The first copy loaded tells where every
     other copy sits, so the right ones follow straight after. */
  const light = isLightTypical(entry, places);
  const first = light ? [Math.floor(places.length / 2)] : places.map((_, i) => i);

  const rec = { entry, parts: [],
                buf: entry.coordinates === "link-shared" ? buf : null, places,
                light, calib: null, busy: null };
  const parts = await loadPlacements(entry, buf, places, first);
  if (!parts.length) throw new Error("no placement could be loaded");
  perf.parseMs = performance.now() - t1;
  perf.placements = parts.length;

  rec.parts = parts;
  S.loaded.set(entry.name, rec);
  await S.fragments.update(true);
  await settlePlacements(entry, parts);

  if (light) {
    calibrateCopies(rec);
    status(`${entry.name}: light mode - ${parts.length} of ${places.length} floors `
      + "loaded; more load as you move up and down the building.");
    renderLightNote(rec);
  }
  S.dirty = true;
  perf.readyMs = performance.now() - t0;
  perf.readyAt = performance.now();          // since the page started
  recordPerf(perf);
  groundSoon();
  reportExtent(entry, parts);
  // Tiles keep arriving after the first update, so the extent is measured
  // again once things have settled.
  setTimeout(() => reportExtent(entry, rec.parts), 1500);
  if (light) typicalSoon(true);
}

/* Load the given placements of a model. Each placement is a separate model
   id - fragments has no multi-instance placement API, so this is the
   honest way to show all of them; memory scales with placements.

   load() TRANSFERS the buffer to the worker, which detaches it. So the
   original is never handed over - every placement gets a fresh copy,
   leaving `buf` valid for later calls. */
async function loadPlacements(entry, buf, places, indices) {
  const slots = [];
  let done = 0;
  const loadOne = async (i) => {
    const id = places.length > 1 ? `${entry.name}#${i}` : entry.name;
    try {
      const model = await S.fragments.load(buf.slice(0), { modelId: id });
      if (indices.length > 1) {
        status(`${entry.name}: ${++done} of ${indices.length} placements loaded ...`);
      }
      /* Only wrap when there is a placement to apply. The library's raycast
         works against the model object as it sits in the scene, and an extra
         parent breaks it - which is why picking stopped working once every
         model got a group, transform or not. */
      let object = model.object;
      if (places[i]) {
        const group = new THREE.Group();
        group.name = id;
        group.add(model.object);
        // Instanced links get their true matrix once their frame is known.
        if (entry.coordinates !== "link-shared") group.applyMatrix4(matrixOf(places[i]));
        object = group;
      }
      S.scene.add(object);
      slots.push({ id, model, object, coord: null, place: places[i], idx: i });
    } catch (e) {
      /* One bad placement should not lose the whole model. */
      status(`${entry.name}: placement ${i + 1} failed (${e.message})`);
    }
  };
  /* A few at a time: the host is always in by now (start-up loads it
     first), so the copies can come in any order. Five at once keeps the
     workers busy on a desktop; a phone gets one at a time. */
  let next = 0;
  const worker = async () => { while (next < indices.length) await loadOne(indices[next++]); };
  const lanes = Math.min(S.lowMemory ? 1 : 5, indices.length);
  await Promise.all(Array.from({ length: lanes }, worker));
  // In placement order, whatever order they finished in.
  return slots.sort((a, b) => a.idx - b.idx);
}

/* After loading: record each copy's coordination matrix and put it in
   place, and bring display mode and the element filter onto it.

   autoCoordinate translates models so they line up with the first one
   loaded, which means scene coordinates are NOT the model's original
   coordinates. Anything leaving the viewer - a BCF camera above all - has
   to be mapped back, or it lands a translation away from the real position
   while still looking plausible. */
async function settlePlacements(entry, parts) {
  for (const p of parts) {
    try {
      p.coord = await p.model.getCoordinationMatrix();
    } catch (e) {
      p.coord = null;
    }
  }
  /* The project-location direction is decided by probing a point inside the
     model, which is meaningless until the coordination matrices are in
     hand. Deciding earlier probes the origin, where both directions score
     identically - the "1170.4 km vs 1170.4 km" tie that made the choice
     arbitrary. */
  _plMatrix = undefined;
  if (S.display && S.display !== "shaded") applyDisplayMaterials();
  // the element filter covers the new model too (spaces off, as chosen)
  applyCategories().then(renderCategories);
  if (entry.coordinates === "link-shared") {
    placeInstanced(entry, parts);
    // Culling and level of detail work from where the models now sit.
    try { await S.fragments.update(true); } catch (e) {}
  }
}

/* ---------------------------------------------------------- light mode */

const LIGHT_NEAR = 3;          // typical floors kept around the view
const LIGHT_KEEP = 5;          // loaded before the farthest are let go

function isLightTypical(entry, places) {
  return !!S.light && entry.coordinates === "link-shared" && places.length > LIGHT_KEEP;
}

/* Where each copy sits. The copies differ only by their placement, which
   moves them vertically, so one loaded copy gives the height of all the
   others: its middle, plus the difference in placement height. */
function calibrateCopies(rec) {
  const p = rec.parts[0];
  if (!p || !p.place) return;
  /* What is actually drawn, placed. (model.box is in the model's own frame
     and gave a middle that put every copy nearest the ground.) */
  p.object.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(p.object);
  if (b.isEmpty()) {
    rec._calTries = (rec._calTries || 0) + 1;
    if (rec._calTries < 20) setTimeout(() => { calibrateCopies(rec); typicalSoon(true); }, 700);
    return;
  }
  rec.calib = { mid: b.getCenter(new THREE.Vector3()).y,
                oz: p.place.origin[2] };
}

function copyMidY(rec, i) {
  return rec.calib.mid + fromMM(rec.places[i].origin[2] - rec.calib.oz);
}

/* Bring in the copies nearest a height, and let the farthest go once more
   than LIGHT_KEEP are in. One request at a time per model. */
function ensureTypical(y) {
  const jobs = [];
  for (const rec of S.loaded.values()) {
    if (!rec.light || !rec.calib) continue;
    rec.busy = (rec.busy || Promise.resolve()).then(() => ensureCopies(rec, y))
      .catch((e) => showError("typical floors", e));
    jobs.push(rec.busy);
  }
  return Promise.all(jobs);
}

async function ensureCopies(rec, y) {
  if (!S.loaded.has(rec.entry.name) || !rec.light) return;
  const order = rec.places.map((_, i) => i)
    .sort((a, b) => Math.abs(copyMidY(rec, a) - y) - Math.abs(copyMidY(rec, b) - y));
  const want = order.slice(0, LIGHT_NEAR);
  const have = new Set(rec.parts.map((p) => p.idx));
  const missing = want.filter((i) => !have.has(i));
  if (missing.length) {
    const parts = await loadPlacements(rec.entry, rec.buf, rec.places, missing);
    rec.parts.push(...parts);
    rec.parts.sort((a, b) => a.idx - b.idx);
    await S.fragments.update(true);
    await settlePlacements(rec.entry, parts);
    S.dirty = true;
  }
  // Let go of the farthest beyond the budget.
  if (rec.parts.length > LIGHT_KEEP) {
    const rank = new Map(order.map((i, n) => [i, n]));
    const far = rec.parts.slice().sort((a, b) => rank.get(b.idx) - rank.get(a.idx))
      .slice(0, rec.parts.length - LIGHT_KEEP);
    for (const p of far) await disposePart(rec, p);
  }
  renderLightNote(rec);
}

async function disposePart(rec, p) {
  rec.parts = rec.parts.filter((q) => q !== p);
  try { await S.fragments.disposeModel(p.id); } catch (e) {}
  if (p.object && p.object.parent) p.object.parent.remove(p.object);
  S.dirty = true;
}

/* Every copy, for someone on a phone who really wants the whole tower. */
async function loadAllCopies(rec) {
  const have = new Set(rec.parts.map((p) => p.idx));
  const missing = rec.places.map((_, i) => i).filter((i) => !have.has(i));
  rec.light = false;
  if (!missing.length) return;
  const parts = await loadPlacements(rec.entry, rec.buf, rec.places, missing);
  rec.parts.push(...parts);
  rec.parts.sort((a, b) => a.idx - b.idx);
  await S.fragments.update(true);
  await settlePlacements(rec.entry, parts);
  renderLightNote(rec);
  S.dirty = true;
}

function renderLightNote(rec) {
  const el = document.querySelector(`[data-light="${CSS.escape(rec.entry.name)}"]`);
  if (!el) return;
  if (!rec.places || rec.places.length <= 1 || rec.parts.length >= rec.places.length) {
    el.hidden = true; el.innerHTML = ""; return;
  }
  el.hidden = false;
  el.innerHTML = `Light mode: ${rec.parts.length} of ${rec.places.length} floors loaded, `
    + `those nearest the view. <a href="#">Load all</a>`;
  el.querySelector("a").onclick = (ev) => {
    ev.preventDefault();
    if (S.lowMemory && !confirm(`Load all ${rec.places.length} floors? On a phone or `
        + "tablet this can use more memory than the browser allows, and the page may reload.")) return;
    status(`Loading all ${rec.places.length} floors of ${rec.entry.name} ...`);
    loadAllCopies(rec).then(() => status(`${rec.entry.name}: all floors loaded.`))
      .catch((e) => showError("load all", e));
  };
}

/* Follow the view: when the orbit centre (or the walker) has moved more
   than a storey up or down, the nearest floors are brought in. Checked on
   a timer rather than on every camera event, because sheet jumps, floor
   plans, saved views and walking all move the camera without one. */
let _typicalY = null, _typicalTimer = 0;
function typicalSoon(force) {
  clearTimeout(_typicalTimer);
  _typicalTimer = setTimeout(() => {
    const y = S.controls ? S.controls.target.y : 0;
    if (!force && _typicalY !== null && Math.abs(y - _typicalY) < 2.5) return;
    _typicalY = y;
    ensureTypical(y);
  }, force ? 50 : 400);
}
setInterval(() => {
  if (S.light && S.modelsReady) typicalSoon(false);
  if (S.modelsReady && S.lazyLinks && S.lazyLinks.length) ensureLinks(false);
}, 1500);

/* ------------------------------------------------ light mode: links */

const LINK_NEAR_MM = 20000;     // load linked models within 20 m of the view
const LINK_FAR_MM = 45000;      // let them go beyond 45 m ...
const LINK_KEEP = 6;            // ... once more than this many are in

function linkBox(m) {
  const b = m.instances && m.instances[0] && m.instances[0].bbox_mm;
  return b && b.length === 2 ? b : null;
}

function distToBox(p, b) {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(b[0][k], b[1][k]), hi = Math.max(b[0][k], b[1][k]);
    const v = p[k] < lo ? lo - p[k] : (p[k] > hi ? p[k] - hi : 0);
    d2 += v * v;
  }
  return Math.sqrt(d2);
}

/* ------------------------------------------------ seen from outside

   Once per export, on a computer: which elements can be seen from outside
   the buildings. The project is drawn from 26 directions (the faces, edges
   and corners of a cube round it) with every element in a colour of its
   own; whatever colours come back were seen. Glass is left out of the
   first picture of each direction, so what is behind a curtain wall
   counts as seen, and drawn in a second. The answer is kept next to each
   model on the server; from the next visit on - phones above all - only
   those are drawn while the camera is outside (cameraOutside). */
async function computeExterior() {
  // not beside a sheet (2D + 3D): the full page does it; not in the WebGPU
  // trial (it reads pixels back the WebGL way) - the server does it anyway
  if (S._extBusy || S.lowMemory || EMBED || S.gpuMode === "webgpu") return;
  // streamed models hold no whole geometry to draw from 26 directions: the server did it
  const all = [...S.loaded.values()].filter((r) => r.lwk && r.parts[0] && !r.tiles);
  const todo = all.filter((r) => !r.parts[0].model.hasExterior);
  if (!todo.length) { ensureMobileFiles(all).catch((e) => console.warn("phone copies", e)); return; }
  if (all.length > 250) return;
  S._extBusy = true;
  const R = S.renderer;
  const size = Number(new URLSearchParams(location.search).get("extsize")) || 2048;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  const roots = new Set();
  for (const r of all) for (const p of r.parts) roots.add(p.object);
  const hidden = [];
  for (const c of S.scene.children) if (!roots.has(c) && c.visible) { c.visible = false; hidden.push(c); }
  const bg = S.scene.background, fog = S.scene.fog;
  const planes = R.clippingPlanes;
  const cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
  const t0 = performance.now();
  let views = 0;
  const flags = all.map((r) => new Uint8Array(r.parts[0].model.elementCountForId + 1));
  try {
    status("Working out what is seen from outside (once per export, about half a minute) ...");
    const note = document.createElement("div");
    note.id = "ext-note";
    note.innerHTML = "<b>Preparing this model for faster viewing</b><br>"
      + "The view may stutter or look blurred for about a minute. This is done only once, "
      + "the first time the model is opened after each update; everyone after you gets the result.";
    const wrapEl = document.getElementById("canvas-wrap");
    if (wrapEl && !document.getElementById("ext-note")) wrapEl.appendChild(note);
    all.forEach((r, mi) => r.parts.forEach((p) => p.model.idBegin(mi)));
    S.scene.background = null; S.scene.fog = null;
    R.clippingPlanes = [];
    const box = projectBox();
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size3 = box.getSize(new THREE.Vector3());
    const radius = size3.length() / 2;
    const tiles = Math.max(1, Math.min(2, Math.ceil(Math.max(size3.x, size3.y, size3.z) / 150)));
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, radius * 6);
    const buf = new Uint8Array(size * size * 4), u32 = new Uint32Array(buf.buffer);
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue;
      const dir = new THREE.Vector3(dx, dy, dz).normalize();
      cam.position.copy(centre).addScaledVector(dir, radius * 2.5);
      cam.up.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.9) cam.up.set(0, 0, -1);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      const inv = cam.matrixWorldInverse;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const q = c.clone().applyMatrix4(inv);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      for (let tx = 0; tx < tiles; tx++) for (let ty = 0; ty < tiles; ty++) {
        cam.left = x0 + (x1 - x0) * tx / tiles; cam.right = x0 + (x1 - x0) * (tx + 1) / tiles;
        cam.bottom = y0 + (y1 - y0) * ty / tiles; cam.top = y0 + (y1 - y0) * (ty + 1) / tiles;
        cam.updateProjectionMatrix();
        for (const pass of ["opaque", "glass"]) {
          for (const r of all) for (const p of r.parts) p.model.idSetPass(pass);
          R.setRenderTarget(rt);
          R.setClearColor(0x000000, 0);
          R.clear();
          R.render(S.scene, cam);
          R.readRenderTargetPixels(rt, 0, 0, size, size, buf);
          for (let i = 0; i < u32.length; i++) {
            if (u32[i] === 0) continue;
            const o = i * 4, a = buf[o + 3];
            if (!a) continue;
            const e = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
            const f = flags[a - 1];
            if (f && e > 0 && e < f.length) f[e] = 1;
          }
          views++;
        }
        R.setRenderTarget(null);
        await new Promise((r) => setTimeout(r, 0));     // the page stays usable
      }
    }
  } catch (e) {
    showError("seen from outside", e);
  } finally {
    R.setRenderTarget(null);
    for (const r of all) for (const p of r.parts) { try { p.model.idEnd(); } catch (e) {} }
    for (const c of hidden) c.visible = true;
    S.scene.background = bg; S.scene.fog = fog;
    R.clippingPlanes = planes;
    R.setClearColor(cc, ca);
    rt.dispose();
    S._camKey = null;
    S.needsRender = true;
    S._extBusy = false;
    const n = document.getElementById("ext-note");
    if (n) n.remove();
  }
  // keep the answer next to each model
  let seen = 0, total = 0, saved = 0;
  for (let mi = 0; mi < all.length; mi++) {
    const m = all[mi].parts[0].model;
    if (m.hasExterior) continue;
    // flags are element + 1; grow works on element numbers
    const f0 = flags[mi].subarray(1);
    try { await growExterior(all[mi], f0); } catch (e) { console.warn("grow exterior", e); }
  }
  for (let mi = 0; mi < all.length; mi++) {
    const r = all[mi], m = r.parts[0].model;
    const f = flags[mi];
    const ext = [];
    for (let e = 1; e < f.length; e++) if (f[e]) ext.push(e - 1);
    seen += ext.length; total += f.length - 1;
    if (m.hasExterior) continue;
    // nothing seen at all means the pass did not work: never keep that
    if (ext.length < Math.max(1, (f.length - 1) * 0.02)) continue;
    try {
      await Store.api("/api/exterior", { method: "POST",
        body: JSON.stringify({ file: r.entry.fragments, sig: m.sig, ext, views, rule: EXT_RULE }) });
      m.extFlags = new Uint8Array(f.length - 1);
      for (const e of ext) m.extFlags[e] = 1;
      m.extRule = EXT_RULE;
      saved++;
    } catch (e) { /* a Viewer cannot save; the next member who opens it will */ }
  }
  status(`Seen from outside: ${seen} of ${total} elements (${Math.round(100 * seen / Math.max(1, total))}%), `
    + `worked out in ${((performance.now() - t0) / 1000).toFixed(0)} s`
    + (saved ? "; from the next visit only these are drawn while you are outside." : "."));
  if (saved) makeMobileFiles(all, (mi, e) => flags[mi][e + 1], new Set(todo)).catch((e) => console.warn("phone copies", e));
}

/* Phones and tablets: a copy of each model with only what they draw
   outside (seen from outside, no small things, and at most MOBILE_TRIS
   triangles - the smallest go first, as a game drops far detail). Made
   here, on a computer, once per export, and kept on the server. */
const MOBILE_TRIS = 1500000;         // for all the models together
const MOBILE_KEEP_CATS = ENVELOPE_CATS;     // never left out of the phone's copy
const MOBILE_SKIP_CATS = new Set(["Furniture", "Furniture Systems", "Casework", "Rooms",
  "Plumbing Fixtures", "Lighting Fixtures", "Electrical Fixtures", "Specialty Equipment",
  "Lighting Devices", "Data Devices", "Fire Alarm Devices", "Communication Devices",
  "Security Devices", "Nurse Call Devices", "Telephone Devices", "Food Service Equipment",
  "Medical Equipment", "Signage", "Audio Visual Devices"]);
/* Openings count as outside when they sit in the outside: a door, a
   window, a curtain panel or mullion whose box touches something already
   seen from outside (a wall, a slab, a roof, another opening). Twice, so a
   mullion on a panel in a curtain wall is reached too. Walls are not
   grown (every inside wall touches an outside one somewhere). */
const GROW_FROM = new Set(["Walls", "Curtain Panels", "Curtain Wall Mullions", "Curtain Systems",
  "Floors", "Roofs", "Windows", "Doors", "Structural Columns", "Columns"]);
const GROW_TO = new Set(["Windows", "Doors", "Curtain Panels", "Curtain Wall Mullions", "Curtain Systems",
  "Railings", "Top Rails", "Handrails", "Wall Sweeps", "Fascias", "Gutters", "Roof Soffits"]);
async function growExterior(rec, f) {
  const m = rec.parts[0].model, head = m.head;
  if (!head) return 0;
  const E = head.el.id.length;
  const cat = (e) => head.cats[head.el.cat[e]];
  const ids = [];
  for (let e = 0; e < E; e++) {
    const c = cat(e);
    if ((f[e] && GROW_FROM.has(c)) || (!f[e] && GROW_TO.has(c))) ids.push(e);
  }
  if (!ids.length) return 0;
  const boxes = new Map();
  const bx = await m.getBoxes(ids);
  ids.forEach((e, i) => { if (bx[i] && !bx[i].isEmpty()) boxes.set(e, bx[i]); });
  const CELL = 4;
  let added = 0;
  for (let pass = 0; pass < 2; pass++) {
    const grid = new Map();
    const key = (x, y, z) => x + "," + y + "," + z;
    for (const [e, b] of boxes) {
      if (!f[e] || !GROW_FROM.has(cat(e))) continue;
      for (let x = Math.floor(b.min.x / CELL); x <= Math.floor(b.max.x / CELL); x++)
        for (let y = Math.floor(b.min.y / CELL); y <= Math.floor(b.max.y / CELL); y++)
          for (let z = Math.floor(b.min.z / CELL); z <= Math.floor(b.max.z / CELL); z++) {
            const k = key(x, y, z);
            let a = grid.get(k);
            if (!a) grid.set(k, a = []);
            a.push(b);
          }
    }
    let now = 0;
    for (const [e, b] of boxes) {
      if (f[e] || !GROW_TO.has(cat(e))) continue;
      const q = b.clone().expandByScalar(0.03);
      let hit = false;
      for (let x = Math.floor(q.min.x / CELL); x <= Math.floor(q.max.x / CELL) && !hit; x++)
        for (let y = Math.floor(q.min.y / CELL); y <= Math.floor(q.max.y / CELL) && !hit; y++)
          for (let z = Math.floor(q.min.z / CELL); z <= Math.floor(q.max.z / CELL) && !hit; z++) {
            for (const sb of grid.get(key(x, y, z)) || []) if (sb.intersectsBox(q)) { hit = true; break; }
          }
      if (hit) { f[e] = 1; now++; }
    }
    added += now;
    if (!now) break;
  }
  return added;
}

/* Models already known from outside whose phone copy is missing (or was
   made by an older rule): made now, on this computer. A list made by an
   older rule is grown here and saved again first. */
async function ensureMobileFiles(all) {
  if (S.lowMemory || S._mobileChecked) return;
  S._mobileChecked = true;
  const need = new Set();
  for (const r of all) {
    const m = r.parts[0].model;
    if (!m.hasExterior || !m.extFlags) continue;
    if ((m.extRule || 1) < EXT_RULE) {
      try {
        const added = await growExterior(r, m.extFlags);
        const ext = [];
        for (let e = 0; e < m.extFlags.length; e++) if (m.extFlags[e]) ext.push(e);
        await Store.api("/api/exterior", { method: "POST",
          body: JSON.stringify({ file: r.entry.fragments, sig: m.sig, ext, views: m.extViews || 0, rule: EXT_RULE }) });
        m.extRule = EXT_RULE;
        console.info(`${r.entry.name}: ${added} openings in the outside walls added to the outside`);
      } catch (e) { console.warn("grow exterior", e); continue; }
      need.add(r);
      continue;
    }
    try {
      const res = await fetch("/api/lwkm-mobile?rule=" + MOBILE_RULE + "&file=" + encodeURIComponent(r.entry.fragments)
        + "&project=" + encodeURIComponent(Store.currentProject() || ""), { credentials: "same-origin" });
      if (res.ok && !(await res.json()).exists) need.add(r);
    } catch (e) { /* offline: next time */ }
  }
  if (need.size) await makeMobileFiles(all, (mi, e) => all[mi].parts[0].model.extFlags[e], need);
}

async function makeMobileFiles(all, flagOf, only) {
  let made = 0, bytes = 0, from = 0;
  // the budget shared by size: a podium gets more than a lift core
  const sizes = all.map((r) => { try { return r.parts[0].model.stats().triangles; } catch (e) { return 0; } });
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  for (let mi = 0; mi < all.length; mi++) {
    const r = all[mi], m = r.parts[0].model;
    if (!m.head || !m.smallOf || (only && !only.has(r))) continue;
    try {
      const buf = await fetchLwkm(Store.dataUrl(r.entry.fragments));
      const data = parseLwkm(buf);
      if (lwkSig(data.head) !== m.sig) continue;
      const E = data.head.el.id.length;
      const cats = data.head.cats || [];
      const keep = new Uint8Array(E), protect = new Uint8Array(E);
      for (let e = 0; e < E; e++) {
        const c = cats[data.head.el.cat[e]] || data.head.el.cat[e];
        protect[e] = MOBILE_KEEP_CATS.has(c) ? 1 : 0;
        keep[e] = flagOf(mi, e) && (protect[e] || !m.smallOf[e]) && !MOBILE_SKIP_CATS.has(c) ? 1 : 0;
      }
      const cap = Math.max(30000, Math.round(MOBILE_TRIS * sizes[mi] / sum));
      const out = writeMobileLwkm(data, keep, m.sig, { diag: m.diagOf, maxTris: cap, protect });
      let body = out;
      if (typeof CompressionStream !== "undefined") {
        const cs = new Blob([out]).stream().pipeThrough(new CompressionStream("gzip"));
        body = new Uint8Array(await new Response(cs).arrayBuffer());
      }
      const res = await fetch("/api/lwkm-mobile?rule=" + MOBILE_RULE + "&file=" + encodeURIComponent(r.entry.fragments), {
        method: "POST", body, credentials: "same-origin",
        headers: Object.assign(Store.authHeaders(), { "Content-Type": "application/octet-stream" }),
      });
      if (!res.ok) continue;
      made++; bytes += body.byteLength; from += buf.byteLength;
      await new Promise((res2) => setTimeout(res2, 0));
    } catch (e) { console.warn("phone copy of", r.entry.name, e); }
  }
  if (made) console.info(`phone copies: ${made} models, ${(bytes / 1e6).toFixed(1)} MB`);
}

/* On a computer, after a jump: the linked models not yet in, one by one,
   while the user already looks at the spot. */
async function loadRestOfLinks() {
  const rest = (S.lazyLinks || []).slice();
  S.lazyLinks = [];                      // from now on nothing is let go
  for (const m of rest) {
    if (S.loaded.has(m.name)) continue;
    const box = document.querySelector("#" + CSS.escape("m_" + m.name.replace(/\W/g, "_")));
    if (!box || box.checked) continue;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    try { await box._loading; } catch (e) {}
  }
  setTimeout(() => computeExterior().catch((e) => showError("seen from outside", e)), 3000);
}

let _linksBusy = false, _linksAt = null, _linksCam = null;
/* Streamed models (tiles) cost little until the view needs their pieces:
   they come in from further off, and are never let go to make room - the
   tile stream frees memory piece by piece, far ones first. */
const LINK_NEAR_TILED_MM = 80000;
async function ensureLinks(force) {
  if (_linksBusy || !S.lazyLinks || !S.lazyLinks.length || !S.controls) return;
  const t = S.controls.target, c = S.camera.position;
  if (!force && _linksAt && t.distanceTo(_linksAt) < 3 && _linksCam && c.distanceTo(_linksCam) < 3) return;
  _linksBusy = true;
  _linksAt = t.clone();
  _linksCam = c.clone();
  try {
    /* Near what? Where the camera is AND where it looks: zooming in moves
       the camera, not the point it turns round - measured from that point
       alone, the podium the camera had flown into counted as far away and
       was let go. */
    const pt = sceneToInternalMM(t), pc = sceneToInternalMM(c);
    const streamed = (m) => !!(S.tiles && m.tiles);
    const ranked = S.lazyLinks.map((m) => ({ m, d: Math.min(distToBox(pt, linkBox(m)), distToBox(pc, linkBox(m))) }))
      .sort((a, b) => a.d - b.d);
    const toggle = async (m, on) => {
      const box = document.querySelector("#" + CSS.escape("m_" + m.name.replace(/\W/g, "_")));
      if (!box || box.checked === on) return;
      if (on && box.dataset.userOff) return;       // switched off by hand: stays off
      box.checked = on;
      box.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));
      try { await box._loading; } catch (e) {}
    };
    // Wanted: the nearest few within reach (always at least the nearest);
    // streamed ones from further off, and not counted against the few.
    const whole = ranked.filter((r) => !streamed(r.m));
    const wantWhole = whole.filter((r, i) => i === 0 || r.d <= LINK_NEAR_MM).slice(0, LINK_KEEP);
    const wantTiled = ranked.filter((r) => streamed(r.m) && (r.d <= LINK_NEAR_TILED_MM || r === ranked[0]));
    const want = wantTiled.concat(wantWhole);
    const wantSet = new Set(want.map((r) => r.m.name));
    // Let go first, so memory is free before the next ones arrive: whole
    // models not wanted and far away, or any not wanted once over the budget.
    const loadedWhole = whole.filter((r) => S.loaded.has(r.m.name));
    let count = loadedWhole.length;
    for (const r of loadedWhole.slice().reverse()) {
      if (wantSet.has(r.m.name)) continue;
      // switched on by hand in the Models list: kept
      const cb = document.querySelector("#" + CSS.escape("m_" + r.m.name.replace(/\W/g, "_")));
      if (cb && cb.dataset.userOn) continue;
      if (r.d > LINK_FAR_MM || count + wantWhole.length > LINK_KEEP * 2) { await toggle(r.m, false); count--; }
    }
    // nearest first
    for (const r of want.sort((a, b) => a.d - b.d)) if (!S.loaded.has(r.m.name)) await toggle(r.m, true);
    const n = S.lazyLinks.filter((m) => S.loaded.has(m.name)).length;
    if (n < S.lazyLinks.length) {
      status(`Light mode: ${n} of ${S.lazyLinks.length} linked models loaded - `
        + "the ones near the view. The rest load as you move.");
    }
  } catch (e) {
    showError("light mode links", e);
  } finally {
    _linksBusy = false;
  }
}

/* Measuring a fragments model is awkward: model.box knows about geometry
   that has not streamed in yet but is expressed in the model's own frame,
   while setFromObject only sees the tiles resident right now. Neither alone
   is reliable, so both are taken and the larger, non-empty result wins.
   Getting this wrong is visible immediately: too small and Fit parks the
   camera 100 mm away, too empty and it frames nothing at all. */
function worldBox(part) {
  const out = new THREE.Box3();
  // fast 3D models know their extent (the drawn instances vary with culling)
  if (part.model && part.model.format === "lwkm" && part.model.box) {
    if (part.model.box.isEmpty()) return out;
    part.object.updateMatrixWorld(true);
    return out.copy(part.model.box).applyMatrix4(part.object.matrixWorld);
  }

  /* A fragments model's box is already where it sits in the scene: the
     library applies the model's own matrix (get box()). Applying it again
     doubled a model with an offset - a site plan exported at 835 km came
     out at 1670 km, and Fit flew the camera out of sight. */
  part.object.updateMatrixWorld(true);
  const mb = part.model && part.model.box;
  if (mb && !mb.isEmpty()) {
    // (matrixWorld: a placement's group, typical floors, is in it too)
    const b = mb.clone();
    // Only trust it when it actually describes something of a sane size.
    const s = b.getSize(new THREE.Vector3());
    if (Math.max(s.x, s.y, s.z) > 0.001) return out.copy(b);
  }
  const live = new THREE.Box3().setFromObject(part.object);
  if (!live.isEmpty()) out.union(live);
  return out;
}

function reportExtent(entry, parts) {
  const box = new THREE.Box3();
  for (const part of parts) {
    const b = worldBox(part);
    if (!b.isEmpty()) box.union(b);
  }
  const el = document.querySelector(
    `[data-extent="${CSS.escape(entry.name)}"]`);
  if (!el) return;
  if (box.isEmpty()) { el.textContent = "empty"; return; }

  const m = (v) => v.toFixed(1);
  const inst = entry.instances || [];
  const real = inst.filter((i) => i && i.transform && !i.identity);

  /* The offset autoCoordinate applied to this model. Models that belong on
     the same site should all show the same value; a tower file showing a
     different x or y from a podium file is the horizontal displacement,
     and it comes from the library, not from the placements. */
  let co = "";
  const cm = parts[0] && parts[0].coord;
  if (cm) {
    const o = new THREE.Vector3().setFromMatrixPosition(cm);
    if (o.lengthSq() > 1e-6) {
      co = `  coord offset ${o.x.toFixed(1)}, ${o.y.toFixed(1)}, `
        + `${o.z.toFixed(1)} m`;
    }
  }
  el.textContent =
    `Z ${m(box.min.z)} to ${m(box.max.z)} m`
    + `  ${parts.length} drawn`
    + (inst.length ? ` / ${real.length} placed of ${inst.length}` : "")
    + co
    + (projectLocationNote() ? `  loc ${projectLocationNote()}` : "");
}

async function unloadModel(name) {
  const rec = S.loaded.get(name);
  if (!rec) return;
  S.loaded.delete(name);
  for (const p of rec.parts) {
    if (rec.lwk) { try { p.model.dispose(); } catch (e) {} continue; }
    try { await S.fragments.disposeModel(p.id); } catch (e) {}
    if (p.object && p.object.parent) p.object.parent.remove(p.object);
    else if (p.object) S.scene.remove(p.object);
  }
}

/* ---------------------------------------------------------------- view */

async function fitAll() {
  if (S.fragments) await S.fragments.update(true);

  const box = new THREE.Box3();
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      const b = worldBox(part);
      if (!b.isEmpty()) box.union(b);
    }
  }
  // S.grid and the issue pins live in the scene too; neither is measured
  // here, so the extent stays the extent of the building.
  if (box.isEmpty()) {
    /* Geometry is still streaming. Retry rather than leaving the camera
       wherever it happened to be. */
    if (fitAll._tries === undefined) fitAll._tries = 0;
    if (fitAll._tries < 6) {
      fitAll._tries++;
      status("Waiting for geometry ... (" + fitAll._tries + ")");
      setTimeout(fitAll, 700);
      return;
    }
    fitAll._tries = 0;
    status("Models loaded but nothing measurable is in the scene yet. "
           + "Press Fit again once the model appears.");
    return;
  }
  fitAll._tries = 0;

  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.6 || 10;
  const d = radius / Math.tan((fovOf() * Math.PI) / 360);

  S.camera.position.set(centre.x + d * 0.7, centre.y + d * 0.6, centre.z + d * 0.7);
  // near/far are fixed and wide; the logarithmic buffer keeps precision.
  S.camera.updateProjectionMatrix();
  S.controls.target.copy(centre);
  S.controls.update();
  S.dirty = true;

  // Ground and grid follow the model's extent, measured now it is framed.
  updateGround();

  const pn = projectLocationNote();
  if (pn) status(`Project location transform: ${pn}.`);
  status(`${S.loaded.size} model(s). Extent `
    + `${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m, `
    + `centre ${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}, `
    + `${centre.z.toFixed(1)} m.`);
}

/* What a click does. Four modes shared one set of ad-hoc toggles before,
   which is how the section buttons could stay lit while the mode had
   already changed. */
function setMode(mode) {
  S.mode = mode;
  const map = {
    nav: "#m-nav", issue: "#m-issue", face: "#sec-face", align: "#sec-align",
    measure: "#m-measure",
  };
  if (mode !== "measure" && S.measure) S.measure.clear();
  if (mode !== "face" && mode !== "align") hideFacePreview();
  for (const key of Object.keys(map)) {
    const el = document.querySelector(map[key]);
    if (el) el.classList.toggle("active", key === mode);
  }
  if (S.renderer) {
    S.renderer.domElement.style.cursor = mode === "nav" ? "" : "crosshair";
  }
  const say = {
    nav: "Click an element to select it.",
    issue: "Click a surface to place an issue there.",
    face: "Click a face to put a single section plane on it.",
    align: "Click a wall to square the section box to the building.",
    measure: "Click two points. They snap to corners, midpoints and edges.",
    viewalign: "Click a wall to set which way Front faces.",
    calibrate: "Click the top of a floor slab whose level you know.",
  };
  if (say[mode]) status(say[mode]);
}

/* ---------------------------------------------------------- saved views */

/* A saved view is camera plus section box, stored on the server as an item
   like everything else so it appears on every colleague's machine. The
   coordination meeting workflow is: someone sets up the view once, everyone
   returns to it by name. */
const isView = (it) => it && it.placement === "view";

function currentView(name) {
  const t = S.controls.target;
  const sec = S.section;
  return {
    id: uid(), placement: "view", author: Store.author(),
    name: name, created_at: new Date().toISOString(),
    camera: {
      position_mm: [toMM(S.camera.position.x), toMM(S.camera.position.y),
                    toMM(S.camera.position.z)],
      target_mm: [toMM(t.x), toMM(t.y), toMM(t.z)],
      fov: fovOf(),
    },
    section: sec.on ? {
      on: true,
      box: sec.box ? { min: [sec.box.min.x, sec.box.min.y, sec.box.min.z],
                       max: [sec.box.max.x, sec.box.max.y, sec.box.max.z] } : null,
      rot: Number(document.getElementById("srot").value) || 0,
      sliders: ["sx0","sx1","sz0","sz1","sy0","sy1"].map(
        (id) => Number((document.getElementById(id) || {}).value || 0)),
    } : { on: false },
    hidden: Array.from(S.hidden || []),
    /* The whole state, as viewState records it: the exact section box, all
       six cuts including the height, and a section plane. The "section"
       entry above is kept for older copies of the viewer; it listed sliders
       that do not exist (sz0, sz1) and missed the height cuts entirely,
       which is why a saved view came back cut at a different height. */
    state: viewState(),
    snapshot: null,
  };
}

async function saveView() {
  const name = prompt("Name for this view", "View " + (S.items.filter(isView).length + 1));
  if (!name) return;
  const v = currentView(name.trim());
  try {
    const shot = captureViewpoint();
    v.snapshot = await Store.uploadSnapshot(shot.image);
  } catch (e) { /* a view without a thumbnail is still a view */ }
  await putItem(v);
  renderViewList();
  status(`View "${name}" saved for everyone.`);
}

function restoreView(v) {
  const c = v.camera;
  S.camera.position.set(fromMM(c.position_mm[0]), fromMM(c.position_mm[1]),
                        fromMM(c.position_mm[2]));
  S.controls.target.set(fromMM(c.target_mm[0]), fromMM(c.target_mm[1]),
                        fromMM(c.target_mm[2]));
  if (c.fov && !S.camera.isOrthographicCamera) {
    S.camera.fov = c.fov; S.camera.updateProjectionMatrix();
  }
  S.controls.update();

  const sec = S.section;
  if (v.state) {
    // saved by this version: everything, exactly
    applyViewState(v.state);
    S.dirty = true;
    status(`View "${v.name}".`);
    return;
  }
  if (v.section && v.section.on) {
    // an older saved view: its sliders were stored as
    // [sx0, sx1, (nothing), (nothing), sy0, sy1] and the height not at all
    sec.on = true;
    sec.face = null;
    document.getElementById("sec-on").checked = true;
    sec.box = projectBox();
    if (v.section.box) {
      sec.box.min.set(...v.section.box.min);
      sec.box.max.set(...v.section.box.max);
    }
    document.getElementById("srot").value = v.section.rot || 0;
    const sl = v.section.sliders || [];
    const put = (id, val, dflt) => {
      const el = document.getElementById(id);
      if (el) el.value = isFinite(val) ? val : dflt;
    };
    put("sx0", sl[0], 0); put("sx1", sl[1], 100);
    put("sy0", sl[4], 0); put("sy1", sl[5], 100);
    put("sh0", 0, 0); put("sh1", 100, 100);
    applySection();
  } else if (sec.on) {
    resetSection();
    sec.on = false;
    document.getElementById("sec-on").checked = false;
    applySection();
  }

  applyHidden(new Set(v.hidden || []));
  S.dirty = true;
  status(`View "${v.name}".`);
}

function renderViewList() {
  const ul = document.getElementById("view-list");
  if (!ul) return;
  ul.innerHTML = "";
  const views = S.items.filter(isView);
  if (!views.length) {
    ul.innerHTML = `<li class="empty-note">No saved views. Set up a view and press Save view.</li>`;
    return;
  }
  for (const v of views) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="card">`
      + (v.snapshot ? `<div class="thumb" style="background-image:url('${v.snapshot}')"></div>`
                    : `<div class="thumb"></div>`)
      + `<div class="body"><div class="t">${v.name}</div>`
      + `<div class="meta"><span class="who">${v.author || ""}`
      + (v.section && v.section.on ? " &middot; sectioned" : "")
      + (v.hidden && v.hidden.length ? ` &middot; ${v.hidden.length} hidden` : "")
      + `</span></div></div>`
      + `<button class="ghost vdel" title="Delete view">&#10005;</button></div>`;
    li.querySelector(".body").addEventListener("click", () => restoreView(v));
    li.querySelector(".vdel").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Delete view "${v.name}" for everyone?`)) return;
      await Store.remove(v.id).catch((e) => status(e.message));
      S.items = Store.all();
      renderViewList();
    });
    ul.appendChild(li);
  }
}

/* --------------------------------------------------------- isolate/hide */

/* Visibility goes through the library, because the geometry lives in the
   worker and there is no three.js mesh to toggle. Hidden elements are
   remembered as "model:localId" so a saved view can restore them. */
S.hidden = new Set();

async function setVisible(part, localIds, visible) {
  try {
    await part.model.setVisible(localIds, visible);
  } catch (e) {
    showError("visibility", e);
  }
}

async function applyHidden(next) {
  // Reset everything, then hide what the new set says. Cheaper to reason
  // about than diffing two sets against a worker.
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      try { await part.model.resetVisible(); } catch (e) {}
    }
  }
  S.hidden = next;
  const byPart = new Map();
  for (const key of next) {
    const [pid, lid] = key.split(":");
    if (!byPart.has(pid)) byPart.set(pid, []);
    byPart.get(pid).push(Number(lid));
  }
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      const ids = byPart.get(part.id);
      if (ids && ids.length) await setVisible(part, ids, false);
    }
  }
  await S.fragments.update(true);
  S.dirty = true;
  updateVisButtons();
  // categories switched off in the filter stay off after the reset
  await applyCategories();
}

async function hideSelected() {
  const p = S.picked;
  if (!p) { status("Select an element first."); return; }
  const next = new Set(S.hidden);
  next.add(p.part.id + ":" + p.localId);
  await clearHighlight();
  await applyHidden(next);
  status("Hidden. Show all brings it back.");
}

async function isolateSelected() {
  const p = S.picked;
  if (!p) { status("Select an element first."); return; }
  // Everything except the selection: setVisible(undefined, false) hides a
  // whole model, then the one element is shown again.
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      await setVisible(part, undefined, false);
    }
  }
  await setVisible(p.part, [p.localId], true);
  S.hidden = new Set(["*isolated*"]);   // marker: a view restore resets it
  await S.fragments.update(true);
  S.dirty = true;
  updateVisButtons();
  status("Isolated. Show all brings everything back.");
}

async function showAll() {
  await applyHidden(new Set());
  status("Everything shown.");
}

function updateVisButtons() {
  const n = S.hidden ? S.hidden.size : 0;
  const b = document.getElementById("vis-show");
  if (b) b.disabled = n === 0;
  const c = document.getElementById("vis-count");
  if (c) c.textContent = n && !S.hidden.has("*isolated*") ? `${n} hidden` :
                         S.hidden.has("*isolated*") ? "isolated" : "";
}

/* ------------------------------------------------------------ highlight */

/* A click that only fills in a side panel does not feel like a selection.
   The library keeps its geometry in the worker, so colouring it has to go
   through its own highlight call rather than by touching a three.js
   material. */
const PICK_COLOR = new THREE.Color(0xf28022);

/* ---------------------------------------------------------- display modes

   shaded  - the model's own colours, as exported
   white   - every surface white, lit: form and light without colour noise
   xray    - see-through, to read what is behind or inside

   Textured is not offered: an IFC exported from Revit carries each
   material's colour, not its image textures, so there is nothing to show. */
const WHITE = new THREE.Color(0xf4f4f2);

async function forEachPart(fn) {
  for (const rec of S.loaded.values()) {
    for (const p of rec.parts) {
      try { await fn(p.model); } catch (e) { /* unloaded meanwhile */ }
    }
  }
}

/* Display modes change fragments' shared materials, not the elements.

   The first version called setColor / setOpacity on every element. For
   fragments that means building a highlight copy of the whole model's
   geometry, so the GPU drew everything twice, every frame - which is why
   orbiting in White was slow. fragments keeps a short list of the actual
   three.js materials every element is drawn with; changing those few
   costs nothing per frame. Each material's own values are remembered so
   Shaded restores them exactly. The orange selection highlight is a
   material of its own and is left alone. */
const PICK_HEX = new THREE.Color(PICK_COLOR).getHex();

function sharedMaterials() {
  let out = [];
  try { out = [...S.fragments.models.materials.list.values()]; } catch (e) { out = []; }
  // the fast format's own materials
  for (const rec of S.loaded.values()) {
    if (rec.lwk && rec.parts[0]) out.push(...(rec.parts[0].model.materials || []));
  }
  return out;
}

function applyDisplayMaterials() {
  const mode = S.display || "shaded";
  let changed = 0;
  for (const mat of sharedMaterials()) {
    if (!mat || !mat.color) continue;
    const u = mat.userData || (mat.userData = {});
    if (!u.lwkOrig) {
      u.lwkOrig = { color: mat.color.getHex(), opacity: mat.opacity,
                    transparent: mat.transparent, depthWrite: mat.depthWrite };
    }
    const o = u.lwkOrig;
    if (o.color === PICK_HEX) continue;            // the selection highlight
    if (u.lwkMode === mode) continue;
    mat.color.setHex(mode === "white" ? WHITE.getHex() : o.color);
    // fast 3D materials carry their colours per vertex
    if (u.lwk) mat.vertexColors = mode !== "white";
    if (mode === "xray") {
      mat.transparent = true;
      mat.opacity = Math.min(o.opacity === undefined ? 1 : o.opacity, 0.22);
      mat.depthWrite = false;
    } else {
      mat.transparent = o.transparent;
      mat.opacity = o.opacity;
      mat.depthWrite = o.depthWrite;
    }
    mat.needsUpdate = true;
    u.lwkMode = mode;
    changed++;
  }
  if (changed) S.dirty = true;
  return changed;
}

async function setDisplay(mode) {
  S.display = mode;
  for (const b of document.querySelectorAll("#display-modes button")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  applyDisplayMaterials();
  scheduleCutLines(0);
  status({ shaded: "Shaded: the model's own colours.",
           white: "White: surfaces only, no colour.",
           xray: "X-ray: see-through, to read what is behind." }[mode]);
}

/* The model pass of the render loop. (Kept as its own function so a display
   mode could draw differently; every mode now draws the same way, through
   the shared materials.) */
/* A hand while panning (middle button), turning arrows while orbiting
   (right button): the cursor says which the drag is doing. And any
   pointer movement over the model asks for a frame, for hover previews. */
const CUR_ROTATE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24'>"
  + "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>"
  + "<path d='M20 12a8 8 0 1 1-2.3-5.6' stroke='white' stroke-width='4'/>"
  + "<path d='M20 4v5h-5' stroke='white' stroke-width='4'/>"
  + "<path d='M20 12a8 8 0 1 1-2.3-5.6' stroke='%23b4530b' stroke-width='2'/>"
  + "<path d='M20 4v5h-5' stroke='%23b4530b' stroke-width='2'/></g></svg>\") 14 14, move";
function wireNavCursors(el) {
  let cur = "";
  const set = (c) => { if (c !== cur) { cur = c; el.style.cursor = c; } };
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button === 1) set("grabbing");
    else if (ev.button === 2) set(CUR_ROTATE);
  });
  const up = () => set("");
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
  el.addEventListener("pointermove", () => { S.needsRender = true; }, { passive: true });
}

/* The camera and the section planes as one string: a change means a new
   frame (and a new cull). */
function viewKey() {
  const e = S.camera.matrixWorld.elements, p = S.camera.projectionMatrix.elements;
  let k = "";
  for (let i = 0; i < 16; i++) k += e[i].toFixed(4) + ",";
  k += p[0].toFixed(5) + "," + p[5].toFixed(5) + "," + (S.camera.zoom || 1);
  for (const pl of S.renderer.clippingPlanes || []) k += "|" + pl.normal.x.toFixed(4) + pl.normal.y.toFixed(4)
    + pl.normal.z.toFixed(4) + pl.constant.toFixed(3);
  return k;
}

/* While the view moves, a big model is drawn at one pixel per CSS pixel
   (a 1.5x or 2x screen draws 2-4 times fewer pixels); the sharp frame
   follows as soon as it stops. */
/* A quiet line when the moving picture's quality changes step. */
function qualityNote() {
  const l = S.quality.level;
  const txt = ["full", "a little lighter", "lighter", "much lighter", "lightest"][l];
  if (S._qNoteLevel === l) return;
  S._qNoteLevel = l;
  if (!S.quality.samples && l === 0) return;
  status(`Moving picture: ${txt} (${Math.round(S.quality.fps)} fps while moving) - the still view is always full quality.`);
}

function motionResolution(moving) {
  const full = S.lowMemory ? 1 : Math.min(devicePixelRatio, 2);
  const L = S.quality ? S.quality.settings(moving) : { ratio: null };
  let want = moving && (S.lwkDrawn || 0) > 1.5e6 ? 1 : full;
  // the frame rate's quality step: fewer pixels while moving (quality.js)
  if (moving && L.ratio) want = Math.min(want, L.ratio);
  if (S.renderer.getPixelRatio() !== want) {
    S.renderer.setPixelRatio(want);
    const wrap = S.renderer.domElement.parentElement;
    if (wrap) S.renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  }
}

function lwkOnlyScene() {
  if (!S.loaded.size) return false;
  for (const rec of S.loaded.values()) if (!rec.lwk) return false;
  return true;
}

function lwkCull(moving) {
  // the "seen from outside" pass draws every instance itself
  if (S._extBusy) return;
  let tris = 0;
  const planes = S.renderer.clippingPlanes || [];
  const outside = cameraOutside();
  const lod = S.lod !== false;
  const lodPx = S.lowMemory ? 4 : 3;
  const q = S.quality ? S.quality.settings(moving).q : 1;
  // geometry sent to the GPU per frame (vertices): the rest next frame
  const upload = { left: S.lowMemory ? 400000 : 1500000, pending: false };
  const inside = !outside && S.floorBand !== false ? floorBand() : null;
  const ts = S.tileBudget;
  if (ts) { ts.beginFrame(); ts.changed = false; }
  for (const rec of S.loaded.values()) {
    if (!rec.lwk) continue;
    for (const p of rec.parts) {
      try { tris += p.model.cull(S.camera, planes, moving, { outside, lod, lodPx, upload, band: inside, q }); } catch (e) { console.warn("cull", e); }
    }
  }
  if (ts) { ts.enforce(); ts.pump(); }
  S.lwkDrawn = tris;
  S._uploadPending = upload.pending;
  /* Far copies asked for by this view: made in the spare time of the next
     frames (a few milliseconds each), then the view is culled again. */
  let pending = false;
  for (const rec of S.loaded.values()) {
    if (rec.lwk && rec.parts[0] && rec.parts[0].model.lodPending && rec.parts[0].model.lodPending()) pending = true;
  }
  S._lodPending = pending;
  if (S.lowMemory && !outside) lwkInside();
}

/* A phone or tablet inside a building: the model(s) round the camera are
   built again with their inside; one at a time, and the one left goes back
   to its outside only, so memory stays within what the device has. */
function lwkInside() {
  if (S._swapBusy) return;
  const cp = S.camera.position;
  let want = null, wantPart = null;
  for (const rec of S.loaded.values()) {
    if (!rec.lwk) continue;
    // built already round a spot near here: nothing to do
    if (rec.near && rec.near.distanceTo(cp) < NEAR_RADIUS * 0.6) continue;
    if (!rec.extOnly && !rec.near) continue;
    for (const p of rec.parts) {
      const b = worldBox(p);
      if (!b.isEmpty() && b.expandByScalar(2).containsPoint(cp)) { want = rec; wantPart = p; break; }
    }
    if (want) break;
  }
  if (!want) return;
  S._swapBusy = true;
  const entry = want.entry;
  const local = cp.clone().applyMatrix4(wantPart.object.matrixWorld.clone().invert());
  const near = { point: local, radius: NEAR_RADIUS, world: cp.clone() };
  (async () => {
    try {
      for (const rec of [...S.loaded.values()]) {
        if (rec.lwk && rec.full && rec.entry !== entry) {
          await unloadModel(rec.entry.name);
          await loadLwk(rec.entry, "outside");
        }
      }
      status(`${entry.name}: loading the inside round you ...`);
      await unloadModel(entry.name);
      await loadLwk(entry, "full", near);
      applyHidden(S.hidden || new Set()).catch(() => {});
    } catch (e) {
      showError("inside of the building", e);
    } finally {
      S._swapBusy = false;
      S._camKey = null;
    }
  })();
}
/* How far round the camera a phone builds the inside (metres); walking
   further than about half of it builds the next piece. */
const NEAR_RADIUS = 35;

/* Inside a building, the floors far above and below are hidden behind
   slabs: their rooms need not be drawn. The band is this floor and the one
   above and below it; the outside of the building is always drawn. Not
   with a section (the camera may be high above the cut) or ?band=0. */
function floorBand() {
  const sec = S.section;
  if ((sec && sec.on) || (sec && sec.face)) return null;
  // levels a step apart (FFL / SSL, mezzanine marks) count as one floor
  const rows = [];
  for (const r of S.floorRows || []) {
    if (!rows.length || r.y - rows[rows.length - 1].y > 2.4) rows.push(r);
  }
  if (rows.length < 3) return null;
  const y = S.camera.position.y;
  let i = -1;
  for (let k = 0; k < rows.length; k++) if (rows[k].y <= y + 0.3) i = k;
  const lo = i <= 0 ? -Infinity : rows[i - 1].y - 0.5;
  const hi = i + 2 < rows.length ? rows[i + 2].y + 0.5 : Infinity;
  if (lo === -Infinity && hi === Infinity) return null;
  return { lo, hi };
}

/* Is the camera outside every building? Asked by looking straight up from
   it: a roof or a slab overhead means inside (or under a canopy - which
   also draws everything, the safe side). Only asked again once the camera
   has moved a little. A section cut, the jump from a sheet and walking all
   show the inside, so they count as inside. */
function cameraOutside() {
  const sec = S.section;
  if ((sec && sec.on) || (sec && sec.face) || (S.walk && S.walk.on)) return false;
  let any = false;
  for (const rec of S.loaded.values()) {
    if (rec.lwk && rec.parts[0] && rec.parts[0].model.hasInterior && rec.parts[0].model.hasInterior()) { any = true; break; }
  }
  if (!any) return false;
  const cp = S.camera.position;
  if (S._outAt && S._outAt.distanceTo(cp) < 1.5) return S._outside;
  S._outAt = cp.clone();
  const ray = new THREE.Ray(cp.clone(), new THREE.Vector3(0, 1, 0));
  let hit = false;
  for (const rec of S.loaded.values()) {
    if (!rec.lwk || hit) continue;
    for (const p of rec.parts) {
      try {
        // synchronous under the hood: the promise resolves at once
        const h = p.model.raycastSync ? p.model.raycastSync({ ray, everything: true }) : null;
        if (h && h.distance < 400) { hit = true; break; }
      } catch (e) {}
    }
  }
  if (S._outside !== !hit) status(hit ? "Inside a building: everything is drawn."
                                      : "Outside: only what is seen from outside is drawn.");
  S._outside = !hit;
  return S._outside;
}

/* The cut filled solid (poché) while a section is on, and in a floor plan
   the plan look: surfaces paled towards paper, what is below the floor
   faded. Fast 3D models only (their shader does it); set before each
   frame. The first time a section is used each model works out which of
   its elements are closed solids - a moment, in slices - and the frame is
   drawn again when that is done. */
const PU = pocheUniforms(THREE);
S.poche = (() => { try { return localStorage.getItem("lwk.poche") !== "0"; } catch (e) { return true; } })();
S.planLook = (() => { try { return localStorage.getItem("lwk.planlook") !== "0"; } catch (e) { return true; } })();
function applyPoche() {
  const cutting = (S.renderer.clippingPlanes || []).length > 0;
  const on = !!(S.poche && cutting && S.display !== "xray");
  PU.capOn.value = on;
  if (on) {
    for (const rec of S.loaded.values()) {
      const m = rec.lwk && rec.parts[0] && rec.parts[0].model;
      if (m && m.prepareCaps && !m.capsReady() && !m._capAsked) {
        m._capAsked = true;
        m.prepareCaps().then(() => { S.needsRender = true; S.dirty = true; }).catch(() => {});
      }
    }
  }
  const plan = S.planCut && cutting && S.planLook && S.display !== "xray";
  PU.plan.value.set(plan ? S.planCut.y : 0, 6, plan ? 1 : 0, plan ? (S.display === "white" ? 0 : 0.45) : 0);
}

/* The cut's outline: where each cutting plane passes through closed
   solids, as wide brown lines (cutlines.js). Worked out again a moment
   after the cut changes, or when more of a streamed model arrives. */
let _cutTimer = null, _cutSeq = 0, _cutKey = "";
const planesKey = () => (S.renderer.clippingPlanes || []).map((p) =>
  p.normal.x.toFixed(4) + "," + p.normal.y.toFixed(4) + "," + p.normal.z.toFixed(4) + ":" + p.constant.toFixed(4)).join("|");
function scheduleCutLines(ms) {
  clearTimeout(_cutTimer);
  // the cut moved: the old outline goes at once rather than hang in the
  // air where the plane was, and comes back when the plane stops
  if (S.cutLines && S.cutLines.count && planesKey() !== _cutKey) { S.cutLines.clear(); S.needsRender = true; }
  _cutTimer = setTimeout(() => refreshCutLines().catch((e) => console.warn("cut lines", e)), ms === undefined ? 250 : ms);
}
async function refreshCutLines() {
  if (!S.cutLines) return;
  const seq = ++_cutSeq;
  const planes = (S.renderer.clippingPlanes || []).slice();
  if (!S.cutLineOn || !S.poche || !planes.length || S.display === "xray") { S.cutLines.clear(); S.needsRender = true; return; }
  const key = planesKey();
  const sets = [];
  for (const pl of planes) {
    const parts = [];
    for (const rec of S.loaded.values()) {
      if (!rec.lwk) continue;
      for (const p of rec.parts) {
        if (!p.model.cutSegments) continue;
        if (p.model.prepareCaps && !p.model.capsReady()) await p.model.prepareCaps();
        parts.push(await p.model.cutSegments(pl));
        if (seq !== _cutSeq) return;          // the cut moved again meanwhile
      }
    }
    let n = 0;
    for (const a of parts) n += a.length;
    const segs = new Float32Array(n);
    let o = 0;
    for (const a of parts) { segs.set(a, o); o += a.length; }
    // each set is clipped by the other planes (a box's six), never its own
    sets.push({ segs, clip: planes.filter((q) => q !== pl).map((q) => q.clone()) });
  }
  if (seq !== _cutSeq) return;
  S.cutLines.set(sets, { width: 2.4 * S.renderer.getPixelRatio(), color: 0x7a3b10 });
  _cutKey = key;
  S.needsRender = true;
}

function renderModel() {
  applyPoche();
  if (S.cutLines && S.cutLines.count) {
    const v = S.renderer.getDrawingBufferSize(new THREE.Vector2());
    S.cutLines.update(v.x, v.y);
  }
  renderMain();
}
/* The model scene, with the section's cutting planes. */
function renderMain(cam) {
  if (S.gpuMode === "webgpu") {
    const planes = S.renderer.clippingPlanes || [];
    if (S.clipGroup.clippingPlanes !== planes) S.clipGroup.clippingPlanes = planes;
    S.clipGroup.enabled = planes.length > 0;
    S.renderer.render(S.gpuRoot, cam || S.camera);
  } else if (depthFxNow()) {
    try {
      if (!S.aoFx) { S.aoFx = createAO(THREE); S.aoFx.set(depthFxSettings()); }
      S.aoFx.render(S.renderer, S.scene, cam || S.camera);
    } catch (e) {
      // a graphics card that cannot: plain from now on, and say so once
      S.depthFx = false; S.depthFxFailed = true; syncDepthButton();
      showError("depth", e);
      S.renderer.setRenderTarget(null);
      S.renderer.render(S.scene, cam || S.camera);
    }
  } else {
    S.renderer.render(S.scene, cam || S.camera);
  }
}

/* "Depth" (ao.js): soft shadow in corners and edge lines. Not in X-ray, not
   in the WebGPU trial, and - on a device already lightening the moving
   picture to keep up - only once the view has stopped. */
function depthFxNow() {
  if (!S.depthFx || S.gpuMode === "webgpu" || S.display === "xray") return false;
  if (S._moving && S.quality && S.quality.level >= 1) return false;
  return true;
}
const DFX_USUAL = { strength: 0.55, edge: 0.4, shadeColor: "#000000", edgeColor: "#2b2f36" };
function depthFxSettings() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem("lwk.depthfx.set") || "null"); } catch (e) {}
  return Object.assign({}, DFX_USUAL, v || {});
}
function wireDepthSettings() {
  const ao = document.getElementById("dfx-ao");
  if (!ao) return;
  const edge = document.getElementById("dfx-edge"), aoc = document.getElementById("dfx-ao-col"),
    ec = document.getElementById("dfx-edge-col");
  const show = (v) => {
    ao.value = Math.round(v.strength * 100); edge.value = Math.round(v.edge * 100);
    aoc.value = v.shadeColor; ec.value = v.edgeColor;
  };
  const apply = (v) => {
    try { localStorage.setItem("lwk.depthfx.set", JSON.stringify(v)); } catch (e) {}
    if (S.aoFx) S.aoFx.set(v);
    if (!S.depthFx && S.gpuMode !== "webgpu") setDepthFx(true);
    S.needsRender = true;
  };
  const read = () => ({ strength: ao.value / 100, edge: edge.value / 100, shadeColor: aoc.value, edgeColor: ec.value });
  show(depthFxSettings());
  for (const el of [ao, edge, aoc, ec]) el.addEventListener("input", () => apply(read()));
  document.getElementById("dfx-reset").addEventListener("click", () => { show(DFX_USUAL); apply(Object.assign({}, DFX_USUAL)); });
}
function depthFxDefault() {
  try { const v = localStorage.getItem("lwk.depthfx"); if (v === "1" || v === "0") return v === "1"; } catch (e) {}
  return !S.lowMemory;
}
function syncDepthButton() {
  const b = document.getElementById("depth-toggle");
  if (!b) return;
  b.classList.toggle("active", !!S.depthFx);
  b.disabled = S.gpuMode === "webgpu" || !!S.depthFxFailed;
  b.title = S.gpuMode === "webgpu" ? "Depth shading is drawn with WebGL only - switch back to WebGL to use it"
    : "Depth: soft shadows in corners and fine lines on edges, so the building reads in 3D. Off: plain shading (lighter on slow devices)";
}
function setDepthFx(on) {
  S.depthFx = !!on;
  try { localStorage.setItem("lwk.depthfx", on ? "1" : "0"); } catch (e) {}
  if (!on && S.aoFx) { S.aoFx.dispose(); }
  syncDepthButton();
  S.needsRender = true;
  status(on ? (S.display === "xray" ? "Depth shading is on - it shows in Shaded and White (not X-ray)."
    : "Depth shading on: corners shaded, edges lined.") : "Depth shading off: plain shading.");
}

/* A deselected element simply goes back to its material, which already
   carries the display mode. */
async function restoreItem(model, localId) {
  await model.resetColor([localId]);
}

/* ------------------------------------------------------ element filter

   Categories of element, with how many of each are loaded, each switchable.
   Spaces start switched off: they are volumes, not building parts, and they
   hide the rooms they describe. The choice is remembered per project.
   Hiding and isolating elements resets all visibility first, so the filter
   re-applies itself after every such reset (applyHidden calls it). */
const CAT_NAMES = [
  [/^IFCWALL/, "Walls"], [/^IFCSLAB/, "Floors and slabs"], [/^IFCROOF/, "Roofs"],
  [/^IFCDOOR/, "Doors"], [/^IFCWINDOW/, "Windows"], [/^IFCCOLUMN/, "Columns"],
  [/^IFCBEAM/, "Beams"], [/^IFCSTAIR/, "Stairs"], [/^IFCRAMP/, "Ramps"],
  [/^IFCRAILING/, "Railings"], [/^IFCCURTAINWALL/, "Curtain walls"],
  [/^IFCPLATE/, "Curtain panels and plates"], [/^IFCMEMBER/, "Mullions and members"],
  [/^IFCCOVERING/, "Ceilings and finishes"], [/^IFCFURNI/, "Furniture"],
  [/^IFCBUILDINGELEMENTPROXY/, "Generic models"], [/^IFCSPACE/, "Spaces (rooms)"],
  [/^IFCOPENINGELEMENT/, "Openings"], [/^IFCFOOTING|^IFCPILE/, "Foundations"],
  [/^IFC(FLOW|DISTRIBUTION|ENERGY|SANITARY|LIGHT)/, "Services (MEP)"],
  [/^IFCTRANSPORT/, "Lifts and escalators"],
];
const NOT_PHYSICAL = /^IFC(PROJECT|SITE|BUILDING$|BUILDINGSTOREY|REL|PROPERTY|ELEMENTQUANTITY|GROUP|ZONE|SYSTEM|MATERIAL|OWNERHISTORY|ANNOTATION|GRID)|TYPE$|STYLE/;
const catName = (c) => {
  for (const [re, n] of CAT_NAMES) if (re.test(c)) return n;
  if (!/^IFC/.test(c)) return c;             // a Revit category name (fast format)
  return c.replace(/^IFC/, "").toLowerCase().replace(/^./, (s) => s.toUpperCase());
};
const catKey = () => "lwk-viewer:cat-off:" + (Store.currentProject() || "default");

function catOff() {
  if (!S.catOff) {
    try {
      const saved = JSON.parse(localStorage.getItem(catKey()) || "null");
      S.catOff = new Set(saved || ["Spaces (rooms)", "Openings"]);
    } catch (e) { S.catOff = new Set(["Spaces (rooms)", "Openings"]); }
  }
  return S.catOff;
}

/* Every part's elements, by friendly category name - asked once per part. */
async function partCategories(p) {
  if (p.cats) return p.cats;
  const out = {};
  try {
    // the categories that actually have geometry, as fragments knows them;
    // the name test is only a fallback
    let geo = null;
    try { geo = new Set((await p.model.getItemsWithGeometryCategories()).filter(Boolean)); } catch (e) {}
    const got = await p.model.getItemsOfCategories([/.*/]);
    for (const [c, ids] of Object.entries(got || {})) {
      if (!ids.length || (geo ? !geo.has(c) : NOT_PHYSICAL.test(c))) continue;
      const n = catName(c);
      (out[n] = out[n] || []).push(...ids);
    }
  } catch (e) {}
  p.cats = out;
  return out;
}

async function applyCategories() {
  const off = catOff();
  for (const rec of S.loaded.values()) {
    for (const p of rec.parts) {
      const cats = await partCategories(p);
      for (const [n, ids] of Object.entries(cats)) {
        try { await p.model.setVisible(ids, !off.has(n)); } catch (e) {}
      }
    }
  }
  // elements hidden one by one stay hidden
  for (const key of S.hidden || []) {
    const [pid, lid] = key.split(":");
    for (const rec of S.loaded.values()) {
      for (const p of rec.parts) if (p.id === pid) {
        try { await p.model.setVisible([Number(lid)], false); } catch (e) {}
      }
    }
  }
  try { await S.fragments.update(true); } catch (e) {}
  S.dirty = true;
}

let _catTimer = null;
function renderCategories() {
  clearTimeout(_catTimer);
  _catTimer = setTimeout(async () => {
    const counts = {};
    for (const rec of S.loaded.values()) {
      for (const p of rec.parts) {
        for (const [n, ids] of Object.entries(await partCategories(p))) counts[n] = (counts[n] || 0) + ids.length;
      }
    }
    const ul = document.getElementById("cat-list");
    if (!ul) return;
    const off = catOff();
    const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    ul.innerHTML = names.map((n) =>
      `<li><label class="row-check"><input type="checkbox" data-cat="${n}"${off.has(n) ? "" : " checked"}>`
      + ` ${n} <span class="muted">${counts[n].toLocaleString()}</span></label></li>`).join("")
      || '<li class="empty-note">No elements loaded yet.</li>';
    ul.querySelectorAll("input[data-cat]").forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) off.delete(cb.dataset.cat); else off.add(cb.dataset.cat);
      try { localStorage.setItem(catKey(), JSON.stringify([...off])); } catch (e) {}
      applyCategories();
    }));
  }, 300);
}

/* ------------------------------------------------- the last 3D view kept

   Going to the sheets and back used to reset the 3D view to the whole
   building. The camera, projection, section box or plane, and hidden
   elements are kept per project and put back on return. */
const lastViewKey = () => "lwk-viewer:last3d:" + (Store.currentProject() || "default");

function rememberView() {
  if (!S.modelsReady) return;
  try {
    const t = S.controls.target;
    localStorage.setItem(lastViewKey(), JSON.stringify({
      at: Date.now(), ortho: !!S.ortho,
      pos: S.camera.position.toArray(), target: [t.x, t.y, t.z],
      up: S.camera.up.toArray(), zoom: S.camera.zoom || 1,
      frame: S.camera.isOrthographicCamera ? [S.camera.left, S.camera.right, S.camera.top, S.camera.bottom] : null,
      state: viewState(), floor: S.floorIndex === undefined ? null : S.floorIndex,
      display: S.display || "shaded",
    }));
  } catch (e) {}
}

function restoreLastView() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(lastViewKey()) || "null"); } catch (e) {}
  if (!v || !v.pos) return false;
  /* A view kept from before a fix, or from a model since moved, that
     looks at nothing near the building: fit instead. */
  try {
    const box = sceneBox();
    if (!box.isEmpty()) {
      const t = new THREE.Vector3().fromArray(v.target);
      const far = box.distanceToPoint(t) > 20000 || box.distanceToPoint(new THREE.Vector3().fromArray(v.pos)) > 50000;
      if (far) { try { localStorage.removeItem(lastViewKey()); } catch (e) {} return false; }
    }
  } catch (e) {}
  if (v.ortho && !S.ortho) setOrtho(true);
  if (!v.ortho && S.ortho) setOrtho(false);
  S.camera.up.fromArray(v.up || [0, 1, 0]);
  S.camera.position.fromArray(v.pos);
  S.controls.target.fromArray(v.target);
  if (v.frame && S.camera.isOrthographicCamera) {
    [S.camera.left, S.camera.right, S.camera.top, S.camera.bottom] = v.frame;
  }
  S.camera.zoom = v.zoom || 1;
  S.camera.lookAt(S.controls.target);
  S.camera.updateProjectionMatrix();
  S.controls.update();
  applyViewState(v.state);
  if (v.floor !== null && v.floor !== undefined) {
    S.floorIndex = v.floor;
    const sel = document.getElementById("floor-select");
    if (sel) sel.value = String(v.floor);
  }
  if (v.display && v.display !== "shaded") setDisplay(v.display);
  S.dirty = true;
  status("Back where you left the 3D view. Fit or the home button for the whole building.");
  return true;
}

/* ----------------------------------------------------------- 3D dimensions

   A finished distance measurement can be kept: it then stays in the model
   as a dimension - a line with end ticks and its length - saved with the
   project for everyone, like an issue. Positions are stored in the same
   scene millimetres as issue points. One switch shows or hides them all. */
const isDim = (it) => it && it.placement === "dim3d";

function dimLabel(text) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  g.font = "600 34px Segoe UI, Arial, sans-serif";
  const w = Math.ceil(g.measureText(text).width) + 22;
  c.width = w; c.height = 50;
  g.font = "600 34px Segoe UI, Arial, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillRect(0, 0, w, 50);
  g.strokeStyle = "#1d4ed8"; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, 47);
  g.fillStyle = "#1d4ed8"; g.textBaseline = "middle";
  g.fillText(text, 11, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.scale.set(0.00042 * w, 0.00042 * 50, 1);
  sp.renderOrder = 997;
  return sp;
}

function renderDims() {
  if (S.dimGroup) {
    S.overlay.remove(S.dimGroup);
    S.dimGroup.traverse((o) => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
  }
  const g = new THREE.Group();
  g.name = "__dims";
  const dims = (S.items || []).filter(isDim);
  for (const d of dims) {
    const a = new THREE.Vector3(...d.a_mm.map(fromMM)), b = new THREE.Vector3(...d.b_mm.map(fromMM));
    const mat = new THREE.LineBasicMaterial({ color: 0x1d4ed8, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat);
    line.renderOrder = 996;
    g.add(line);
    for (const p of [a, b]) {
      const tick = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x1d4ed8, depthTest: false }));
      tick.position.copy(p);
      tick.renderOrder = 996;
      g.add(tick);
    }
    const lab = dimLabel(d.label || (a.distanceTo(b)).toFixed(3) + " m");
    lab.position.copy(a).add(b).multiplyScalar(0.5);
    g.add(lab);
  }
  g.visible = S.dimsOn !== false;
  S.dimGroup = g;
  S.overlay.add(g);
  const n = document.getElementById("dim-count");
  if (n) n.textContent = dims.length ? String(dims.length) : "";
  const ul = document.getElementById("dim-list");
  if (ul) {
    ul.innerHTML = dims.map((d) =>
      `<li data-id="${d.id}"><span>${(d.label || "").replace(/</g, "&lt;")}</span>`
      + ` <span class="muted">${(d.author || "").replace(/</g, "&lt;")}</span>`
      + ` <button class="ghost dim-del" title="Remove this dimension">&#10005;</button></li>`).join("");
    ul.querySelectorAll(".dim-del").forEach((b) => b.addEventListener("click", async () => {
      const id = b.closest("li").dataset.id;
      await Store.remove(id).catch((e) => status(e.message));
      S.items = Store.all();
      renderDims();
    }));
  }
  S.dirty = true;
}

async function keepDimension() {
  const m = S.measure;
  const pts = m ? m.points : [];
  if (!m || m.mode !== "distance" || pts.length < 2) {
    status("Measure a distance first (two points), then press Keep.");
    return;
  }
  const [a, b] = pts;
  const item = {
    id: uid(), placement: "dim3d", author: Store.author(), created_at: new Date().toISOString(),
    a_mm: [toMM(a.x), toMM(a.y), toMM(a.z)], b_mm: [toMM(b.x), toMM(b.y), toMM(b.z)],
    label: (a.distanceTo(b)).toFixed(3) + " m",
  };
  await putItem(item);
  m.clear();
  S.dimsOn = true;
  document.getElementById("dims-on").checked = true;
  renderDims();
  status(`Dimension ${item.label} kept - it stays in the model for everyone.`);
}

/* ------------------------------------------------ background and ground

   Background colour, and a ground plane at the bottom of the model, so it
   sits on something rather than floating. Remembered in the browser.
   The plane is not part of any model: picking, measuring and the section
   box's extent never see it. */
const BG_SWATCHES = ["#eef1f5", "#ffffff", "#dfe8f1", "#f4efe7", "#3a3f47"];
const GROUND_SWATCHES = ["#d6dbd2", "#cfc8b8", "#c3c8ce", "#a9b69a", "#8d949c"];
const DISP_KEY = "lwk-viewer:display";

function readDisplay() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(DISP_KEY) || "{}"); } catch (e) {}
  return { bg: d.bg || BG_SWATCHES[0], groundOn: d.groundOn !== false,
           ground: d.ground || GROUND_SWATCHES[0], gridOn: d.gridOn !== false };
}
function saveDisplay() {
  try { localStorage.setItem(DISP_KEY, JSON.stringify(S.disp)); } catch (e) {}
}

function groundY() {
  // The bottom of the model, so nothing hangs below the ground.
  const b = sceneBox();
  return b.isEmpty() ? 0 : b.min.y - 0.02;
}

function updateGround() {
  if (S.ground) {
    S.scene.remove(S.ground);
    S.ground.geometry.dispose();
    S.ground.material.dispose();
    S.ground = null;
  }
  if (S.disp && S.disp.groundOn) {
    const box = sceneBox();
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 2.5 + 50;
      const g = new THREE.Mesh(new THREE.CircleGeometry(r, 72),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(S.disp.ground),
          transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(c.x, groundY(), c.z);
      g.name = "__ground";
      g.renderOrder = -1;
      S.scene.add(g);
      S.ground = g;
    }
  }
  updateGrid();
  S.dirty = true;
}

/* The grid lies at the bottom of the model, just above the ground so the
   two never fight over the same depth. It used to be placed only by "Fit",
   which is skipped when the last view is restored - so it stayed at the
   project base point, inside the podium. */
function updateGrid() {
  if (S.grid) {
    S.scene.remove(S.grid);
    S.grid.geometry.dispose();
    (Array.isArray(S.grid.material) ? S.grid.material : [S.grid.material])
      .forEach((m) => m.dispose());
    S.grid = null;
  }
  if (!S.disp || !S.disp.gridOn) return;
  const box = sceneBox();
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.z) * 2 || 200;
  const g = new THREE.GridHelper(span, 40, 0xb9c0cb, 0xdfe4ea);
  g.name = "__grid";
  g.position.set(c.x, groundY() + 0.01, c.z);
  S.scene.add(g);
  S.grid = g;
}

/* Several models arrive one after another; the ground and grid are
   re-measured once they have stopped arriving. */
let _groundTimer = 0;
function groundSoon() {
  clearTimeout(_groundTimer);
  _groundTimer = setTimeout(updateGround, 600);
}

function applyBackground() {
  S.scene.background = new THREE.Color(S.disp.bg);
  S.dirty = true;
}

function wireDisplay() {
  S.disp = readDisplay();
  const swatch = (wrap, list, key, after) => {
    const el = document.getElementById(wrap);
    el.innerHTML = list.map((c) =>
      `<button class="sw" style="background:${c}" data-c="${c}" title="${c}"></button>`).join("");
    el.querySelectorAll(".sw").forEach((b) => b.addEventListener("click", () => {
      S.disp[key] = b.dataset.c;
      document.getElementById(key === "bg" ? "bg-color" : "ground-color").value = b.dataset.c;
      saveDisplay(); after();
    }));
  };
  swatch("bg-swatches", BG_SWATCHES, "bg", applyBackground);
  swatch("ground-swatches", GROUND_SWATCHES, "ground", () => {
    S.disp.groundOn = true;
    document.getElementById("ground-on").checked = true;
    updateGround();
  });
  const bg = document.getElementById("bg-color");
  bg.value = S.disp.bg;
  bg.addEventListener("input", () => { S.disp.bg = bg.value; saveDisplay(); applyBackground(); });
  const gc = document.getElementById("ground-color");
  gc.value = S.disp.ground;
  gc.addEventListener("input", () => {
    S.disp.ground = gc.value; S.disp.groundOn = true;
    document.getElementById("ground-on").checked = true;
    saveDisplay(); updateGround();
  });
  const grid = document.getElementById("grid-on");
  if (grid) {
    grid.checked = S.disp.gridOn;
    grid.addEventListener("change", () => { S.disp.gridOn = grid.checked; saveDisplay(); updateGrid(); S.dirty = true; });
  }
  const on = document.getElementById("ground-on");
  on.checked = S.disp.groundOn;
  on.addEventListener("change", () => { S.disp.groundOn = on.checked; saveDisplay(); updateGround(); });
  applyBackground();
}

async function clearHighlight() {
  const p = S.picked;
  S.picked = null;
  if (!p || !p.part) return;
  try {
    await restoreItem(p.part.model, p.localId);
    await S.fragments.update(true);
    S.dirty = true;
  } catch (e) { /* the model may have been unloaded meanwhile */ }
}

/* Colouring the picked element.
 *
 * setColor is the call built for this: it changes the colour and leaves
 * every other material property alone, so glass stays glass. The earlier
 * attempt used highlight() with preserveOriginalMaterial, a flag the
 * library's own types mark as internal - which is why nothing appeared on
 * screen. highlight() is kept only as a fallback for builds where setColor
 * is absent.
 */
async function highlight(part, localId) {
  await clearHighlight();
  if (!part || localId == null) return;

  try {
    if (typeof part.model.setColor === "function") {
      await part.model.setColor([localId], PICK_COLOR);
    } else {
      await part.model.highlight([localId], {
        color: PICK_COLOR, opacity: 1, transparent: false, renderedFaces: 0,
      });
    }
    await S.fragments.update(true);
    S.picked = { part: part, localId: localId };
    S.dirty = true;
  } catch (e) {
    showError("highlight", e);
  }
}


/* ------------------------------------------------------------ model browser

   Every element of the fast 3D models, by model, category and family type,
   with a search over names, categories, families, types and levels - and
   "property:value" over the properties file (loaded the first time it is
   asked for). What is picked (a branch or the search result) can be
   selected, isolated or zoomed to. */
const MB = { open: new Set(), pick: null, busy: false, timer: null };

function mbRecs() {
  return [...S.loaded.values()].filter((r) => r.lwk && r.parts[0] && r.parts[0].model.head);
}
function mbIndex(rec) {
  if (rec.mbIndex) return rec.mbIndex;
  const h = rec.parts[0].model.head, E = h.el.id.length;
  const byCat = new Map();
  const text = new Array(E);
  for (let e = 0; e < E; e++) {
    const cat = h.cats[h.el.cat[e]] || "Other";
    const ft = [h.el.family[e], h.el.type[e]].filter(Boolean).join(": ") || h.el.name[e] || "(no type)";
    let m = byCat.get(cat);
    if (!m) byCat.set(cat, m = new Map());
    let a = m.get(ft);
    if (!a) m.set(ft, a = []);
    a.push(e);
    text[e] = [h.el.name[e], cat, h.el.family[e], h.el.type[e], h.el.level[e], h.el.id[e]]
      .filter((x) => x !== null && x !== undefined && x !== "").join(" ").toLowerCase();
  }
  rec.mbIndex = { byCat, text };
  return rec.mbIndex;
}
const mbEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function mbRow(ul, depth, label, n, key, onClick, extra) {
  const li = document.createElement("li");
  li.style.setProperty("--d", depth);
  const hasKids = key !== null;
  li.innerHTML = `<span class="tw">${hasKids ? (MB.open.has(key) ? "&#9662;" : "&#9656;") : ""}</span>`
    + `<span class="nm" title="${mbEsc(label)}">${mbEsc(label)}${extra ? ` <span class="pv">${mbEsc(extra)}</span>` : ""}</span>`
    + (n !== null ? `<span class="n">${n}</span>` : "");
  if (MB.pick && MB.pick.key === (key || label + "|" + depth)) li.classList.add("on");
  li.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(li); });
  ul.appendChild(li);
  return li;
}

function mbSetPick(label, key, sets) {
  MB.pick = { label, key, sets };       // sets: Map(rec -> Set(element))
  const n = [...sets.values()].reduce((t, x) => t + x.size, 0);
  const a = document.getElementById("mb-actions");
  if (a) a.hidden = !n;
  const w = document.getElementById("mb-what");
  if (w) w.textContent = `${label}: ${n} element${n === 1 ? "" : "s"}`;
}

function renderModelBrowser() {
  const ul = document.getElementById("mb-tree");
  if (!ul) return;
  const q = ((document.getElementById("mb-search") || {}).value || "").trim();
  if (q) { mbSearch(q); return; }
  ul.innerHTML = "";
  const recs = mbRecs();
  let total = 0;
  for (const rec of recs) {
    const ix = mbIndex(rec);
    let count = 0;
    for (const m of ix.byCat.values()) for (const a of m.values()) count += a.length;
    total += count;
    const mk = "m|" + rec.entry.name;
    const all = () => { const set = new Set(); for (const m of ix.byCat.values()) for (const a of m.values()) for (const e of a) set.add(e); return set; };
    mbRow(ul, 0, shortModelName(rec.entry.name), count, mk, () => {
      if (MB.open.has(mk)) MB.open.delete(mk); else MB.open.add(mk);
      mbSetPick(shortModelName(rec.entry.name), mk, new Map([[rec, all()]]));
      renderModelBrowser();
    });
    if (!MB.open.has(mk)) continue;
    for (const cat of [...ix.byCat.keys()].sort()) {
      const types = ix.byCat.get(cat);
      const ck = mk + "|" + cat;
      let n = 0; for (const a of types.values()) n += a.length;
      mbRow(ul, 1, cat, n, ck, () => {
        if (MB.open.has(ck)) MB.open.delete(ck); else MB.open.add(ck);
        const set = new Set(); for (const a of types.values()) for (const e of a) set.add(e);
        mbSetPick(cat, ck, new Map([[rec, set]]));
        renderModelBrowser();
      });
      if (!MB.open.has(ck)) continue;
      for (const ft of [...types.keys()].sort()) {
        const els = types.get(ft);
        const tk = ck + "|" + ft;
        mbRow(ul, 2, ft, els.length, tk, () => {
          if (MB.open.has(tk)) MB.open.delete(tk); else MB.open.add(tk);
          mbSetPick(ft, tk, new Map([[rec, new Set(els)]]));
          renderModelBrowser();
        });
        if (!MB.open.has(tk)) continue;
        const h = rec.parts[0].model.head;
        for (const e of els.slice(0, 300)) {
          mbRow(ul, 3, h.el.name[e] || "#" + h.el.id[e], null, null, () => mbElement(rec, e),
                [h.el.level[e], "Id " + h.el.id[e]].filter(Boolean).join(" · "));
        }
        if (els.length > 300) mbRow(ul, 3, `... ${els.length - 300} more (search to narrow)`, null, null, () => {});
      }
    }
  }
  const c = document.getElementById("mb-count");
  if (c) c.textContent = recs.length ? `${total} elements` : "";
  if (!recs.length) ul.innerHTML = `<li class="muted" style="cursor:default">The browser lists fast 3D (.lwkm) models once they are loaded.</li>`;
}

/* words: every word somewhere in the element's name, category, family,
   type, level or id. key:value: a property (instance or type) whose name
   contains key and whose value contains value. */
async function mbSearch(q) {
  const ul = document.getElementById("mb-tree");
  const seq = (MB.seq = (MB.seq || 0) + 1);
  const recs = mbRecs();
  const colon = q.indexOf(":");
  const prop = colon > 0 ? { k: q.slice(0, colon).trim().toLowerCase(), v: q.slice(colon + 1).trim().toLowerCase() } : null;
  const words = prop ? [] : q.toLowerCase().split(/\s+/).filter(Boolean);
  const sets = new Map();
  const rows = [];
  if (prop) ul.innerHTML = `<li class="muted" style="cursor:default">Reading properties ...</li>`;
  for (const rec of recs) {
    const m = rec.parts[0].model, h = m.head, ix = mbIndex(rec);
    const set = new Set();
    if (prop) {
      const P = m.loadProps ? await m.loadProps() : null;
      if (seq !== MB.seq) return;
      const E = h.el.id.length;
      // the element's own fields count as properties too
      const own = (e) => ({ Attributes: { Name: h.el.name[e], Category: h.cats[h.el.cat[e]],
        Family: h.el.family[e], Type: h.el.type[e], Level: h.el.level[e], "Element Id": h.el.id[e] } });
      const hit = (obj) => {
        for (const g of Object.values(obj || {})) {
          for (const [k, v] of Object.entries(g || {})) {
            if (k.toLowerCase().includes(prop.k) && String(v).toLowerCase().includes(prop.v)) return k + ": " + v;
          }
        }
        return null;
      };
      for (let e = 0; e < E; e++) {
        if (ix.text[e] === undefined) continue;
        let found = hit(own(e));
        if (!found && P && P.el) found = hit(P.el[e]);
        if (!found && P && P.type_id && P.types) {
          const t = P.type_id[e];
          if (t != null) found = hit(P.types[String(t)]);
        }
        if (found) { set.add(e); if (rows.length < 400) rows.push([rec, e, found]); }
      }
    } else {
      ix.text.forEach((t, e) => {
        if (t === undefined) return;
        for (const w of words) if (!t.includes(w)) return;
        set.add(e);
        if (rows.length < 400) rows.push([rec, e, null]);
      });
    }
    if (set.size) sets.set(rec, set);
  }
  if (seq !== MB.seq) return;
  ul.innerHTML = "";
  const n = [...sets.values()].reduce((t, x) => t + x.size, 0);
  mbSetPick(`"${q}"`, "search", sets);
  const c = document.getElementById("mb-count");
  if (c) c.textContent = `${n} found`;
  if (!n) { ul.innerHTML = `<li class="muted" style="cursor:default">Nothing matches.</li>`; return; }
  for (const [rec, e, pv] of rows) {
    const h = rec.parts[0].model.head;
    mbRow(ul, 0, (h.el.name[e] || "#" + h.el.id[e]), null, null, () => mbElement(rec, e),
          pv || [h.cats[h.el.cat[e]], h.el.level[e], recs.length > 1 ? shortModelName(rec.entry.name) : ""].filter(Boolean).join(" · "));
  }
  if (n > rows.length) mbRow(ul, 0, `... ${n - rows.length} more - Select or Isolate takes all ${n}`, null, null, () => {});
}

async function mbLids(sets) {
  const out = [];
  for (const [rec, els] of sets) {
    const part = rec.parts[0];
    out.push({ rec, part, lids: part.model.lidsOfElements(els) });
  }
  return out;
}
async function mbClearPicks() {
  await clearHighlight();
  for (const rec of mbRecs()) { try { await rec.parts[0].model.resetColor(); } catch (e) {} }
}
const mbEmpty = () => !MB.pick || ![...MB.pick.sets.values()].some((x) => x.size);
async function mbSelect() {
  if (mbEmpty()) return;
  await mbClearPicks();
  let n = 0;
  for (const { part, lids } of await mbLids(MB.pick.sets)) {
    if (lids.length) { await part.model.setColor(lids, PICK_COLOR); n += lids.length; }
  }
  S.needsRender = true; S.dirty = true;
  S.selEls = selectionFromBrowser();
  status(`${MB.pick.label}: ${n} selected (coloured). Click the model to clear.`
    + (S.selEls.length ? " + Task keeps them on a task; Copy Revit IDs for Revit." : ""));
}
async function mbIsolate() {
  if (mbEmpty()) return;
  const groups = await mbLids(MB.pick.sets);
  for (const rec of S.loaded.values()) for (const part of rec.parts) await setVisible(part, undefined, false);
  for (const { rec, lids } of groups) for (const part of rec.parts) if (lids.length) await setVisible(part, lids, true);
  S.hidden = new Set(["*isolated*"]);
  S.dirty = true; S.needsRender = true;
  updateVisButtons();
  status(`Isolated ${MB.pick.label}. Show all brings everything back.`);
  await mbZoom();
}
async function mbZoom(sets) {
  const box = new THREE.Box3();
  for (const { part, lids } of await mbLids(sets || (MB.pick && MB.pick.sets) || new Map())) {
    const sample = lids.length > 4000 ? lids.filter((_, i) => i % Math.ceil(lids.length / 4000) === 0) : lids;
    const bx = await part.model.getBoxes(sample);
    for (const b of bx) if (b && !b.isEmpty()) box.union(b);
  }
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(1.5, box.getSize(new THREE.Vector3()).length() / 2);
  const dir = S.camera.position.clone().sub(S.controls.target).normalize();
  flyTo(c.clone().add(dir.multiplyScalar(r * 2.4)), c);
}
async function mbElement(rec, e) {
  const part = rec.parts[0];
  const lids = part.model.lidsOfElements([e]);
  if (!lids.length) return;
  await mbClearPicks();
  await highlight(part, lids[0]);
  if (lids.length > 1) await part.model.setColor(lids, PICK_COLOR);
  const bx = await part.model.getBoxes([lids[0]]);
  const c = bx[0] && !bx[0].isEmpty() ? bx[0].getCenter(new THREE.Vector3()) : null;
  let guid = null;
  try { guid = (await part.model.getGuidsByLocalIds([lids[0]]))[0]; } catch (err) {}
  showSelection(rec.entry.name, { localId: lids[0], point: c, part }, guid);
  await mbZoom(new Map([[rec, new Set([e])]]));
  if (S.closeDrawers) S.closeDrawers();
}

function wireModelBrowser() {
  const q = document.getElementById("mb-search");
  if (!q) return;
  q.addEventListener("input", () => {
    clearTimeout(MB.timer);
    MB.timer = setTimeout(renderModelBrowser, 250);
  });
  document.getElementById("mb-select").addEventListener("click", () => mbSelect().catch((e) => showError("browser", e)));
  document.getElementById("mb-isolate").addEventListener("click", () => mbIsolate().catch((e) => showError("browser", e)));
  document.getElementById("mb-zoom").addEventListener("click", () => mbZoom().catch((e) => showError("browser", e)));
}


/* ------------------------------------------------ what changed since last export

   The server keeps the fast 3D file an upload replaced. Both are read and
   matched element by element (Revit's UniqueId): added, removed, changed
   in shape or position, changed in type, level or name. Added and changed
   are coloured and can be isolated in the model; removed ones are drawn
   as red boxes where they were. */
function elementPrints(data) {
  const h = data.head, pos = data.pos, E = h.el.id.length;
  const off = h.offset || [0, 0, 0];
  const meshSig = new Map();
  const ms = (mi) => {
    let v = meshSig.get(mi);
    if (v !== undefined) return v;
    const [vs, vc, is, ic] = h.meshes[mi];
    let sx = 0, sy = 0, sz = 0;
    for (let k = vs; k < vs + vc; k++) { sx += pos[k * 3]; sy += pos[k * 3 + 1]; sz += pos[k * 3 + 2]; }
    v = { vc, ic, sx, sy, sz };
    meshSig.set(mi, v);
    return v;
  };
  const defSig = new Map();
  const ds = (d, depth = 0) => {
    if (defSig.has(d)) return defSig.get(d);
    const df = h.defs[d];
    let t = df.meshes.map((mi) => { const q = ms(mi); return `${q.vc}/${q.ic}/${Math.round(q.sx * 100)}`; }).join(",");
    if (depth < 8) t += "|" + df.kids.map(([k, row]) => ds(k, depth + 1) + "@" + Array.from(data.mat.subarray(row * 12, row * 12 + 12)).map((x) => Math.round(x * 1000)).join(":")).join(";");
    defSig.set(d, t);
    return t;
  };
  const instOf = new Map();
  for (const [e, d, row] of h.inst) {
    const M = Array.from(data.mat.subarray(row * 12, row * 12 + 12)).map((x, i) => Math.round(x * (i % 4 === 3 ? 200 : 1000)));
    const a = instOf.get(e) || [];
    a.push(ds(d) + "@" + M.join(":"));
    instOf.set(e, a);
  }
  const box = new Float64Array(E * 6).fill(NaN);
  const prints = new Array(E);
  for (let e = 0; e < E; e++) {
    let n = 0, sx = 0, sy = 0, sz = 0, parts = [];
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const mi of h.el.baked[e] || []) {
      const q = ms(mi);
      n += q.vc; sx += q.sx + off[0] * q.vc; sy += q.sy + off[1] * q.vc; sz += q.sz + off[2] * q.vc;
      parts.push(q.ic);
      const [vs, vc] = h.meshes[mi];
      for (let k = vs; k < vs + vc; k++) {
        const x = pos[k * 3] + off[0], y = pos[k * 3 + 1] + off[1], z = pos[k * 3 + 2] + off[2];
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
        if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
    }
    if (x0 <= x1) box.set([x0, y0, z0, x1, y1, z1], e * 6);
    // centroid to 5 mm and the triangle counts: a moved or reshaped element changes
    const c = n ? [sx / n, sy / n, sz / n].map((v) => Math.round(v * 200)).join(",") : "";
    prints[e] = `${n}|${parts.sort().join(",")}|${c}|${(instOf.get(e) || []).sort().join(";")}`;
  }
  return { prints, box };
}

async function compareModel(m, pickAt) {
  const rec = S.loaded.get(m.name);
  if (!rec || !rec.lwk) { status("Switch the model on first."); return; }
  status(`${m.name}: looking for the previous export ...`);
  const v = await Store.api("/api/model-versions?file=" + encodeURIComponent(m.fragments));
  const all = v.versions || [];
  const prev = (pickAt && all.find((x) => x.at === pickAt)) || all[0];
  if (!prev) { status(`${m.name}: no previous export kept yet - the next upload keeps this one to compare with.`); return; }
  status(`${m.name}: reading the export of ${prev.at.slice(0, 16).replace("T", " ")} ...`);
  const [nb, ob] = await Promise.all([fetchLwkm(Store.dataUrl(m.fragments)), fetchLwkm(Store.dataUrl(prev.path))]);
  const nd = parseLwkm(nb), od = parseLwkm(ob);
  const np = elementPrints(nd), op = elementPrints(od);
  const key = (h, e) => h.el.uid[e] || h.el.guid[e] || String(h.el.id[e]);
  const oldBy = new Map();
  for (let e = 0; e < od.head.el.id.length; e++) oldBy.set(key(od.head, e), e);
  const added = [], changed = [], retyped = [], removed = [];
  const seen = new Set();
  const nh = nd.head, oh = od.head;
  for (let e = 0; e < nh.el.id.length; e++) {
    const k = key(nh, e);
    const o = oldBy.get(k);
    if (o === undefined) { added.push(e); continue; }
    seen.add(k);
    if (np.prints[e] !== op.prints[o]) changed.push(e);
    else if (nh.el.type[e] !== oh.el.type[o] || nh.el.level[e] !== oh.el.level[o]
             || nh.el.family[e] !== oh.el.family[o]) retyped.push(e);
  }
  for (let o = 0; o < oh.el.id.length; o++) if (!seen.has(key(oh, o))) removed.push(o);
  // the current model's numbering is what the drawn model uses
  const model = rec.parts[0].model;
  if (lwkSig(nh) !== model.sig) { status("The model changed while comparing; switch it off and on and try again."); return; }
  showCompare(rec, prev, { added, changed, retyped, removed, oh, obox: op.box, off: nh.offset || [0, 0, 0], all, m });
}

function showCompare(rec, prev, R) {
  let panel = document.getElementById("cmp3d");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "cmp3d";
    document.getElementById("canvas-wrap").appendChild(panel);
  }
  const h = rec.parts[0].model.head;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const row = (e, hh) => `<li data-e="${e}">${esc(hh.el.name[e] || "#" + hh.el.id[e])}`
    + ` <span class="muted">${esc(hh.cats[hh.el.cat[e]] || "")}${hh.el.level[e] ? " · " + esc(hh.el.level[e]) : ""}</span></li>`;
  const list = (arr, hh, cls) => arr.slice(0, 200).map((e) => row(e, hh)).join("")
    + (arr.length > 200 ? `<li class="muted">... ${arr.length - 200} more</li>` : "");
  panel.innerHTML = `<div class="walk-head"><b>Changes in ${esc(shortModelName(rec.entry.name))}</b><span class="spacer"></span>`
    + `<button class="ghost" data-a="close">Close</button></div>`
    + ((R.all || []).length > 1
      ? `<div class="muted" style="font-size:11px;margin-bottom:6px">Since the export of <select data-a="ver" title="Compare with an earlier export (up to 7 are kept)">`
        + R.all.map((x, k) => `<option value="${esc(x.at)}"${x.at === prev.at ? " selected" : ""}>${esc(x.at.slice(0, 16).replace("T", " "))} UTC${k === 0 ? " (previous)" : ""}</option>`).join("")
        + `</select></div>`
      : `<div class="muted" style="font-size:11px;margin-bottom:6px">Since the export of ${esc(prev.at.slice(0, 16).replace("T", " "))} UTC</div>`)
    + `<div class="c3-btns"><button data-a="added" class="c3-add">Added <b>${R.added.length}</b></button>`
    + `<button data-a="changed" class="c3-chg">Changed <b>${R.changed.length}</b></button>`
    + `<button data-a="retyped" class="c3-typ">New type / level <b>${R.retyped.length}</b></button>`
    + `<button data-a="removed" class="c3-rem">Removed <b>${R.removed.length}</b></button>`
    + `<button data-a="all" class="ghost">All changes</button><button data-a="show" class="ghost">Show all</button></div>`
    + `<details><summary>Added</summary><ul data-l="added">${list(R.added, h)}</ul></details>`
    + `<details><summary>Changed</summary><ul data-l="changed">${list(R.changed, h)}</ul></details>`
    + `<details><summary>New type / level</summary><ul data-l="retyped">${list(R.retyped, h)}</ul></details>`
    + `<details><summary>Removed (red boxes)</summary><ul data-l="removed">${list(R.removed, R.oh)}</ul></details>`;
  panel.hidden = false;
  // removed: red boxes where they were
  if (S.cmpBoxes) { S.overlay.remove(S.cmpBoxes); S.cmpBoxes = null; }
  const pos = [];
  const push = (a, b) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const o of R.removed.slice(0, 3000)) {
    const b = R.obox.subarray(o * 6, o * 6 + 6);
    if (!isFinite(b[0])) continue;
    const c = [];
    for (let k = 0; k < 8; k++) c.push([k & 1 ? b[3] : b[0], k & 2 ? b[4] : b[1], k & 4 ? b[5] : b[2]]);
    for (const [i, j] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) push(c[i], c[j]);
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xdc2626, depthTest: false, transparent: true, opacity: 0.9 }));
    // old absolute model coordinates -> this placement (its matrix holds the current offset)
    const M = rec.parts[0].object.matrixWorld.clone()
      .multiply(new THREE.Matrix4().makeTranslation(-R.off[0], -R.off[1], -R.off[2]));
    lines.matrixAutoUpdate = false;
    lines.matrix.copy(M);
    lines.renderOrder = 997;
    S.cmpBoxes = lines;
    S.overlay.add(lines);
  }
  S.needsRender = true; S.dirty = true;
  const model = rec.parts[0].model;
  const sets = { added: R.added, changed: R.changed, retyped: R.retyped };
  const pick = async (which) => {
    const els = which === "all" ? [...R.added, ...R.changed, ...R.retyped] : sets[which] || [];
    MB.pick = { label: which, key: "cmp", sets: new Map([[rec, new Set(els)]]) };
    if (!els.length) { status("Nothing in that group."); return; }
    await mbIsolate();
    await mbSelect();
  };
  const verSel = panel.querySelector('select[data-a="ver"]');
  if (verSel && R.m) verSel.onchange = () => compareModel(R.m, verSel.value).catch((e) => showError("compare", e));
  panel.onclick = async (ev) => {
    const b = ev.target.closest("button");
    const li = ev.target.closest("li[data-e]");
    try {
      if (b) {
        const a = b.dataset.a;
        if (a === "close") {
          panel.hidden = true;
          if (S.cmpBoxes) { S.overlay.remove(S.cmpBoxes); S.cmpBoxes = null; S.needsRender = true; }
          await showAll();
        } else if (a === "show") { await showAll(); await mbClearPicks(); }
        else if (a === "removed") {
          if (!R.removed.length) return;
          const bb = new THREE.Box3();
          for (const o of R.removed) {
            const q = R.obox.subarray(o * 6, o * 6 + 6);
            if (isFinite(q[0])) bb.union(new THREE.Box3(new THREE.Vector3(q[0], q[1], q[2]), new THREE.Vector3(q[3], q[4], q[5])));
          }
          if (!bb.isEmpty() && S.cmpBoxes) {
            bb.applyMatrix4(S.cmpBoxes.matrix);
            const c = bb.getCenter(new THREE.Vector3()), r = Math.max(2, bb.getSize(new THREE.Vector3()).length() / 2);
            const dir = S.camera.position.clone().sub(S.controls.target).normalize();
            flyTo(c.clone().add(dir.multiplyScalar(r * 2.4)), c);
          }
        } else await pick(a);
      } else if (li) {
        const l = li.parentElement.dataset.l;
        if (l !== "removed") await mbElement(rec, Number(li.dataset.e));
      }
    } catch (e) { showError("compare", e); }
  };
  status(`${rec.entry.name}: ${R.added.length} added, ${R.changed.length} changed, ${R.retyped.length} new type or level, `
    + `${R.removed.length} removed since the previous export.`);
}

/* ------------------------------------------------------------ measuring */

function ensureMeasure() {
  if (!S.measure) {
    S.measure = createMeasure({
      THREE: THREE, scene: S.overlay, camera: S.camera, getCamera: () => S.camera,
      renderer: S.renderer, fragments: S.fragments,
    });
    S.measure.setOrtho(S.measOrtho);
  }
  return S.measure;
}

async function measureClick(ev) {
  const found = await pickAt(ev);
  if (!found) { status("No surface there."); return; }
  const r = await ensureMeasure().click(ev, found.hit, found.part);
  S.dirty = true;
  if (!r) return;
  const kindWord = { vertex: "corner", midpoint: "midpoint", perpendicular: "perpendicular",
                     edge: "edge", face: "surface" }[r.snap.kind];
  status(r.text ? `${r.text}  (snapped to ${kindWord})`
                : `Point on ${kindWord}. Click the next one.`);
}

/* Hovering previews the snap before the click commits to it, so the user
   can see which feature they are about to get. */
let _hoverBusy = false;
async function measureHover(ev) {
  if (S.mode !== "measure" || _hoverBusy) return;
  _hoverBusy = true;
  try {
    const found = await pickAt(ev);
    await ensureMeasure().hover(ev, found && found.hit, found && found.part);
    S.dirty = true;
  } catch (e) { /* hover must never interrupt */ }
  finally { _hoverBusy = false; }
}

/* ---------------------------------------------------------- preset views */

/* Standard views, as on a Revit view cube. Each is built from the model's
   own bounding box, so it frames the building whatever its size. When the
   section box has been squared to the building, "Front" means the front of
   the building rather than world north - otherwise an elevation of a
   rotated tower comes out at an angle, which is not an elevation. */
/* Perspective or parallel.
 *
 * An elevation drawn in perspective is not an elevation: parallel lines
 * converge, so nothing can be compared or measured off it. The two cameras
 * are kept side by side and swapped, because switching an existing camera's
 * type is not something three.js supports - everything holding a reference
 * to it would keep the old projection. */
/* The perspective camera's field of view, or the one the parallel view
   stands in for. Code that frames the model or records a viewpoint needs
   a number either way; reading .fov off a parallel camera gives undefined,
   which turned every distance it fed into NaN. */
const fovOf = () => (S.camera.isOrthographicCamera
  ? (S.fovDefault || 55) : S.camera.fov);

function setOrtho(on) {
  if (!!S.ortho === !!on) return;
  const from = S.camera;
  const dist = from.position.distanceTo(S.controls.target);
  const aspect = from.aspect || (S.renderer.domElement.clientWidth /
                                 Math.max(1, S.renderer.domElement.clientHeight));

  let to;
  if (on) {
    // Frame the same amount of the scene the perspective camera saw at the
    // orbit distance, so the switch does not jump the zoom.
    const h = 2 * Math.tan((from.fov || 55) * Math.PI / 360) * dist;
    const w = h * aspect;
    to = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.01,
                                      Math.max(4000, dist * 20));
    to.userData.baseHeight = h;
  } else {
    to = new THREE.PerspectiveCamera(S.fovDefault || 55, aspect, 0.05,
                                     Math.max(4000, dist * 20));
  }
  to.position.copy(from.position);
  to.up.copy(from.up);
  to.lookAt(S.controls.target);
  to.updateProjectionMatrix();

  S.camera = to;
  S.ortho = !!on;
  S.controls.object = to;

  /* Every loaded model was bound to the perspective camera when it was
     loaded, and fragments uses that camera for its own culling and level of
     detail. Swapping the viewer's camera without telling the models left
     them computing against the old one, and the renderer failed uploading
     a uniform the next frame. The library accepts either kind of camera;
     it only has to be told. */
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      try { part.model.useCamera(to); } catch (e) { showError("camera", e); }
    }
  }
  // Anything else that captured the camera at creation has to follow it.
  if (S.gizmo) S.gizmo.camera = to;

  S.controls.update();
  try { S.fragments.update(true); } catch (e) {}
  if (S.measure) { S.measure.dispose(); S.measure = null; }
  if (S.arrows) { S.arrows.clear(); }
  updateBoxHandles();
  const b = document.getElementById("pv-ortho");
  if (b) {
    b.classList.toggle("active", S.ortho);
    const lab = b.querySelector(".lab");
    if (lab) lab.textContent = S.ortho ? "Parallel" : "Perspective";
    const svg = b.querySelector("svg");
    if (svg) svg.outerHTML = iconSvg(S.ortho ? "ortho" : "persp", 16);
  }
  S.dirty = true;
  status(on ? "Parallel projection: a true elevation or plan."
            : "Perspective projection.");
}

/* The angle the standard views are measured from. Set once - from a wall,
   or from the section box - and every Front, Back, Left and Right uses it
   until it is changed. */
function setViewAlign(deg) {
  S.viewAlign = ((deg % 360) + 360) % 360;
  const el = document.getElementById("pv-align");
  if (el) el.textContent = S.viewAlign ? S.viewAlign.toFixed(0) + "\u00B0" : "world";
  status(S.viewAlign
    ? `Standard views now measured from ${S.viewAlign.toFixed(1)} degrees.`
    : "Standard views back to world axes.");
}

/* Take that angle from a wall the user clicks, so "Front" can be set from
   the building without anyone working out a number. */
async function alignViewsToFace(ev) {
  const found = await pickAt(ev);
  if (!found || !found.hit.normal) { status("Click a flat wall."); return; }
  const n = found.hit.normal;
  if (Math.hypot(n.x, n.z) < 0.2) {
    status("That face points up or down. Pick a wall, not a floor.");
    return;
  }
  let deg = Math.atan2(n.x, n.z) * 180 / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg < -90) deg += 180;
  setViewAlign(deg);
  setMode("nav");
  presetView("front");
}

/* The angle the standard views are measured from - shared by the view
   buttons and the view cube, so FRONT on the cube is always the same view
   as the Front button. */
function viewAlignDeg() {
  return S.viewAlign !== undefined && S.viewAlign !== null
    ? S.viewAlign
    : (S.section && S.section.on
        ? Number(document.getElementById("srot").value) || 0 : 0);
}

/* Orbit the main view by a drag on the view cube: round the vertical, and
   up and down, about the orbit centre. */
function orbitBy(dx, dy) {
  const t = S.controls.target;
  const off = S.camera.position.clone().sub(t);
  const sph = new THREE.Spherical().setFromVector3(off);
  sph.theta -= dx * 0.012;
  sph.phi = Math.max(0.02, Math.min(Math.PI - 0.02, sph.phi - dy * 0.012));
  off.setFromSpherical(sph);
  S.camera.position.copy(t).add(off);
  S.camera.lookAt(t);
  S.controls.update();
  S.dirty = true;
}

function presetView(kind, customDir) {
  const box = sceneBox();
  if (box.isEmpty()) { status("Load a model first."); return; }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  const dist = span / (2 * Math.tan(fovOf() * Math.PI / 360)) * 1.15;

  /* The remembered alignment first; the section box only if none was set,
     so a view direction chosen once is not quietly lost when the section
     is switched off. */
  const deg = viewAlignDeg();
  const turn = new THREE.Matrix4().makeRotationY(deg * Math.PI / 180);
  const V = THREE.Vector3;
  const dirs = {
    top: new V(0, 1, 0.0001), bottom: new V(0, -1, 0.0001),
    front: new V(0, 0, 1), back: new V(0, 0, -1),
    left: new V(-1, 0, 0), right: new V(1, 0, 0),
    iso: new V(1, 0.8, 1).normalize(),
  };
  const d = customDir ? customDir.clone().normalize() : dirs[kind];
  if (!d) return;
  // Every view is turned with the building, plans included, so a plan reads
  // with the building's front at the bottom of the screen - as the cube
  // shows it. A direction from the cube is already turned.
  const dir = customDir ? d : d.clone().applyMatrix4(turn);
  if (customDir && Math.abs(dir.y) > 0.999) dir.z += 0.0001;

  // A plan looks straight down, so "up" on screen has to be a plan axis.
  S.camera.up.set(0, 1, 0);
  if (S.ortho) {
    // A parallel camera cannot zoom by moving back, so the frame is sized
    // to the building instead.
    const across = kind === "top" || kind === "bottom"
      ? Math.max(size.x, size.z)
      : Math.max(size.x, size.z, size.y);
    const aspect = S.camera.right !== undefined
      ? (S.camera.right - S.camera.left) / (S.camera.top - S.camera.bottom) : 1.7;
    const h = across * 1.12;
    S.camera.top = h / 2; S.camera.bottom = -h / 2;
    S.camera.left = -h * aspect / 2; S.camera.right = h * aspect / 2;
    S.camera.updateProjectionMatrix();
  }
  flyTo(c.clone().add(dir.normalize().multiplyScalar(Math.max(dist, span * 2))), c);
  status(kind.charAt(0).toUpperCase() + kind.slice(1) + " view.");
}

/* A view straight at the active section plane - the "section" in plan /
   section / elevation. */
function viewSectionPlane() {
  const sec = S.section;
  if (!sec || !sec.face || !S.planePoint) {
    status("Set a section plane first: right-click a wall, Section on this face.");
    return;
  }
  const n = sec.faceNormal.clone().normalize();
  const box = sceneBox();
  const span = box.isEmpty() ? 30 : box.getSize(new THREE.Vector3()).length() * 0.6;
  // Look from the kept side, towards the cut.
  flyTo(S.planePoint.clone().add(n.clone().multiplyScalar(-span)), S.planePoint.clone());
  status("Looking at the section plane.");
}

/* ---------------------------------------------------------- floor levels */

/* Storeys come from the model itself (IfcBuildingStorey and its Elevation),
   not from a list typed into the viewer, so they follow the Revit levels
   exactly and change when the model does. */
/* Scene height for a Revit internal elevation. The chain scene -> Revit
   internal is already built (sceneToInternalMM); vertically it is a
   straight line - a turn about the vertical and a shift - so two samples
   pin it down exactly and it can be run backwards. */
function internalZToSceneY(zmm) {
  const box = sceneBox();
  const cx = box.isEmpty() ? 0 : (box.min.x + box.max.x) / 2;
  const cz = box.isEmpty() ? 0 : (box.min.z + box.max.z) / 2;
  const z0 = sceneToInternalMM(new THREE.Vector3(cx, 0, cz))[2];
  const z1 = sceneToInternalMM(new THREE.Vector3(cx, 1, cz))[2];
  const perMetre = z1 - z0;
  if (!isFinite(perMetre) || Math.abs(perMetre) < 1e-6) return null;
  return (zmm - z0) / perMetre;
}

/* Heights: the one frame correction the viewer cannot read, only test.

   Choosing 28/F +90.45 cut the model at LMR +123.95 - every floor 33.5 m
   off. The IFC exporter adds the site elevation to every height, while
   the project-location transform used to go back to Revit's frame has no
   vertical part, so heights came back short by that elevation. The
   exporter now records it, but whether it has to be added or taken away
   depends on how the IFC exporter treats it - which is exactly the kind of
   thing that went wrong before when assumed.

   So both signs, and none, are tried. The right one is the one that puts
   the floors inside the building: the lowest level at or above the bottom
   of the geometry, the highest at or below its top. The wrong ones are 33
   and 67 m out, so there is no close call to get wrong. The choice is
   reported, and because it lives in sceneToInternalMM it corrects BCF
   camera heights and sheet-to-model links along with the floor list. */
/* Calibrating heights by hand: one click on a floor slab of a known level.

   The automatic correction did not remove a ~30 m error on STS, so rather
   than guess at a fourth cause the user states one fact - "this slab is GF"
   - and every height follows from it. The correction lives in S.zAdj, the
   same place the automatic one did, so floor cuts, BCF camera heights and
   sheet-to-model links are all corrected together. It is saved with the
   project, so it is done once, by anyone, for everyone. */
const CAL_ID = "calibration-heights";

/* The frame a calibration is made in: the host's coordination shift. A
   calibration saved in another frame - before the host was chosen by role,
   or after a re-export that moved the base point - is ignored instead of
   applied: it describes a different model placement. */
function frameSignature() {
  const C = coordinationMatrix();
  if (!C) return null;
  const e = C.elements;
  return [e[12], e[13], e[14]].map((v) => v.toFixed(1)).join(",");
}

function savedCalibration() {
  const rec = (S.items || []).find((x) => x.id === CAL_ID && x.placement === "calibration");
  if (!rec) return null;
  const sig = frameSignature();
  if (!rec.frame || !sig || rec.frame !== sig) return null;   // made in another frame
  return rec;
}

function recomputeFloors() {
  for (const f of S.floors || []) {
    if (f.source === "revit") {
      const y = internalZToSceneY(f.elev);
      if (y !== null) f.sceneY = y;
    }
  }
  renderFloors();
  refreshPins();
  renderIssueList();
}

async function calibrateAt(ev) {
  const found = await pickAt(ev);
  setMode("nav");
  if (!found || !found.hit.point) { status("Click on the top of a floor slab."); return; }
  const y = found.hit.point.y;
  const rows = S.floorRows || [];
  if (!rows.length) { status("No floors are known yet."); return; }

  // Ask which floor it is, in a small list rather than a typed name.
  const back = document.createElement("div");
  back.id = "cal-back";
  back.innerHTML = `<div id="cal-dlg"><h3>Which floor is this?</h3>
    <p class="muted" style="font-size:12px;margin:0 0 10px">You clicked a surface
      at ${y.toFixed(2)} m. Choose the level this slab belongs to. Every floor
      height is then set from it, for everyone on this project.</p>
    <select id="cal-level" size="10" style="width:100%">${rows.slice().reverse()
      .map((r) => `<option value="${rows.indexOf(r)}">${r.name}</option>`).join("")}</select>
    <div class="row end" style="margin-top:12px">
      <button id="cal-cancel" class="ghost">Cancel</button>
      <button id="cal-ok">Set heights</button></div></div>`;
  document.body.appendChild(back);
  const done = () => back.remove();
  back.querySelector("#cal-cancel").onclick = done;
  back.querySelector("#cal-ok").onclick = async () => {
    const idx = Number(back.querySelector("#cal-level").value);
    if (!isFinite(idx) || !rows[idx]) return;
    const row = rows[idx];
    // The chosen level must end up at the clicked height.
    const before = S.zAdj || 0;
    S.zAdj = before + (row.y - y) * 1000;
    S.heightNote = `calibrated on ${row.name}`;
    recomputeFloors();
    done();
    const rec = {
      id: CAL_ID, placement: "calibration",
      frame: frameSignature(),
      z_adj_mm: Math.round(S.zAdj * 10) / 10,
      level: row.name, clicked_y: y,
      author: Store.author(), created_at: new Date().toISOString(),
    };
    const ok = await putItem(rec);
    status(`Floor heights set from ${row.name}: moved by ${((row.y - y)).toFixed(2)} m`
      + (ok ? ", saved for everyone on this project." : " (not saved - check the connection)."));
  };
}

/* Measuring the height offset instead of guessing or clicking.

   The export records the true Revit bottom and top of a sample of host
   elements. Here the same elements are found by IFC GUID, their boxes
   taken, and the difference between where the height chain puts them and
   where Revit says they are is the correction - measured fresh on every
   open, so it cannot go stale when anything about loading changes.

   Only heights are compared, and that is exact: the model turns about the
   vertical only, so an element's lowest and highest points are the same
   height in both frames whatever the rotation. The median of many is used,
   and the spread is reported: a small spread is the evidence it worked. */
async function measureHeights() {
  if (lwkFrame()) return null;
  const samples = (S.manifest && S.manifest.height_samples) || [];
  if (samples.length < 3) return null;
  const host = firstHostPart();
  if (!host) return null;
  let ids;
  try { ids = await host.model.getLocalIdsByGuids(samples.map((s) => s.ifc_guid)); }
  catch (e) { return null; }
  const pairs = samples.map((s, i) => [s, ids[i]]).filter((p) => p[1] !== null && p[1] !== undefined);
  if (pairs.length < 3) return null;
  let boxes;
  try { boxes = await host.model.getBoxes(pairs.map((p) => p[1])); }
  catch (e) { return null; }

  const save = S.zAdj;
  S.zAdj = 0;
  const diffs = [];
  pairs.forEach(([s, id], i) => {
    const b = boxes[i];
    if (!b || b.isEmpty()) return;
    // world box: the host's own object carries any shift fragments applied
    const wb = b.clone().applyMatrix4(host.model.object.matrixWorld);
    const c = wb.getCenter(new THREE.Vector3());
    const lo = sceneToInternalMM(new THREE.Vector3(c.x, wb.min.y, c.z))[2];
    const hi = sceneToInternalMM(new THREE.Vector3(c.x, wb.max.y, c.z))[2];
    diffs.push(s.zmin_mm - lo, s.zmax_mm - hi);
  });
  S.zAdj = save;
  if (diffs.length < 6) return null;
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  // spread: the middle half of the differences, around the median
  const q1 = diffs[Math.floor(diffs.length / 4)], q3 = diffs[Math.floor(diffs.length * 3 / 4)];
  return { zAdj: med, spread: q3 - q1, n: diffs.length / 2 };
}

/* ------------------------------------------------ floors from the slabs

   Every earlier method turned Revit's level heights into scene heights
   through the coordinate chain, and on STS something in that chain differs
   vertically between IFC, fragments and Revit - so the answer drifted
   between sessions and a calibration click went stale.

   This does not use the chain at all. The floor slabs already in the scene
   have their tops at the level heights, shifted by one unknown constant.
   Revit's level heights form a pattern - 3.50, 3.98, 9.00, 13.78 ... 130.60
   - and the shift is found by sliding that pattern over the slab tops until
   it lines up. Measured in the scene, it cannot go stale.

   Two guards, both tested on the STS levels in 2,400 simulated cases:
   - Only the HOST's slabs choose the shift. The typical floors repeat every
     3.15 m, so one storey up or down lines up just as well; the irregular
     podium and roof levels are what make the answer unique.
   - The typical-floor copies then CONFIRM it: placed from Revit's own
     transforms, their slabs must sit on the 25 typical levels. A wrong
     shift would have to fit both at once.
   With a clear lead and the confirmation, no wrong answer was accepted in
   realistic or harsh conditions. Without them it says so and falls back. */
function matchLevels(tops, levels, tol = 0.12) {
  const uniq = [...new Set(levels.map((l) => Math.round(l * 100) / 100))];
  const T = Float64Array.from(tops).sort();
  if (!T.length) return null;
  const nearest = (y) => {
    let lo = 0, hi = T.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < y) lo = mid + 1; else hi = mid; }
    let d = Math.abs(T[lo] - y);
    if (lo > 0) d = Math.min(d, Math.abs(T[lo - 1] - y));
    return d;
  };
  const cands = new Set();
  for (const t of T) for (const L of uniq) cands.add(Math.round((t - L) * 100) / 100);
  const scored = [];
  for (const k of cands) {
    let s = 0, n = 0;
    for (const L of uniq) {
      const d = nearest(L + k);
      if (d < tol) { s += 1 - d / tol; n++; }
    }
    scored.push({ k, s, n });
  }
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0];
  const second = scored.find((c) => Math.abs(c.k - best.k) > 1.0) || { k: NaN, s: 0 };
  return { k: best.k, score: best.s, matched: best.n, lead: best.s - second.s,
           secondK: second.k, total: uniq.length };
}

async function slabTops(parts) {
  const tops = [];
  for (const p of parts) {
    try {
      const cats = await p.model.getItemsOfCategories([/IFCSLAB/i]);
      const ids = [].concat(...Object.values(cats || {})).slice(0, 6000);
      if (!ids.length) continue;
      // world boxes: fragments applies each model's (and each copy's) placement
      const boxes = await p.model.getBoxes(ids);
      for (const b of boxes) {
        if (!b || b.isEmpty()) continue;
        const sz = b.getSize(new THREE.Vector3());
        if (sz.x * sz.z < 4) continue;          // steps, plinths, kerbs: not floors
        tops.push(b.max.y);
      }
    } catch (e) { /* a model unloaded meanwhile */ }
  }
  return tops;
}

async function floorsFromSlabs(levels) {
  const host = [], typ = [];
  for (const rec of S.loaded.values()) {
    if (rec.entry && rec.entry.role === "host") host.push(...rec.parts);
    else if (rec.entry && rec.entry.coordinates === "link-shared") typ.push(...rec.parts);
  }
  if (!host.length) return null;
  const Ls = levels.map((l) => l.elevation_internal_mm / 1000);
  const hostTops = await slabTops(host);
  const r = matchLevels(hostTops, Ls);
  if (!r) return { ok: false, why: "no floor slabs found in the host model" };

  // the independent check: do the typical copies' slabs sit on the levels?
  let confirm = null;
  if (typ.length) {
    const typTops = (await slabTops(typ)).sort((a, b) => a - b);
    // the typical levels: those a copy's slab can sit on
    const typLevels = [...new Set(typ.map((p) => p.place && p.place.origin
      ? Math.round(p.place.origin[2]) : null).filter((z) => z !== null))];
    let hit = 0, tried = 0;
    for (const L of Ls) {
      const y = L + r.k;
      if (y < typTops[0] - 0.5 || y > typTops[typTops.length - 1] + 0.5) continue;
      tried++;
      if (typTops.some((t) => Math.abs(t - y) < 0.12)) hit++;
    }
    confirm = { hit, tried, share: tried ? hit / tried : 0, copies: typLevels.length };
  }
  const leadNeeded = confirm ? 1.5 : 2.5;
  const ok = r.matched >= 5 && r.lead >= leadNeeded && (!confirm || confirm.share >= 0.8);
  return { ok, k: r.k, r, confirm,
           why: ok ? "" : `slabs do not settle it clearly (lead ${r.lead.toFixed(1)}`
             + (confirm ? `, typical floors agree ${confirm.hit}/${confirm.tried}` : "") + ")" };
}

/* Floor heights: Revit's level heights through the coordinate chain, with
   NO correction.

   Checked against four picks on STS - G/F, 7/F, 36/F and 37/F, on the host
   and on the typical copies - the chain gives each point's height within
   5-10 cm of Revit's level, and names every floor right. Every correction
   that was layered on top of it (site elevation, survey point, measured
   samples, slab fitting, a saved click) was patching a different bug: the
   frame was sometimes taken from the typical floor instead of the host,
   24.3 m lower. With the host chosen by role that bug is gone, and the
   corrections were then pushing every floor 24 m out.

   What remains:
   - a calibration made by hand still applies, but only in the frame it
     was made in (see savedCalibration), so it can never go stale again;
   - the floor slabs are used only to CHECK the heights, and the result is
     reported. They never change anything. */
function calibrateHeights(levels) {
  S.zAdj = 0;
  if (lwkFrame()) {
    // the fast format's frame is exact: nothing to calibrate
    S.heightNote = `from Revit's ${levels.length} levels (exact)`;
    return;
  }
  const cal = savedCalibration();
  if (cal && isFinite(cal.z_adj_mm)) {
    S.zAdj = cal.z_adj_mm;
    S.heightNote = `calibrated by hand on ${cal.level} by ${cal.author || "a colleague"}`;
  } else {
    S.heightNote = `from Revit's ${levels.length} levels`;
  }
  // The check: where do the slabs say the levels are, against the chain?
  const f = S.slabFit;
  if (f && f.r && f.ok && levels.length) {
    const L0 = levels[0].elevation_internal_mm;
    const kChain = internalZToSceneY(L0) - L0 / 1000;
    const diff = f.k - kChain;
    S.heightNote += Math.abs(diff) < 0.3
      ? `; confirmed by the floor slabs (${f.r.matched} levels agree within ${Math.abs(diff * 1000).toFixed(0)} mm)`
      : `; CHECK: the floor slabs put the levels ${diff > 0 ? "+" : ""}${diff.toFixed(2)} m away`;
  }
}

async function loadFloors() {
  /* Levels written by the exporter come first. They are Revit's own - the
     real names and exact elevations, and only the ones marked as building
     storeys - so they beat anything read back out of the IFC. */
  const fromRevit = (S.manifest && S.manifest.levels) || [];
  // The host must be in before anything is measured against it.
  for (let i = 0; i < 100 && !firstHostPart(); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  /* The floors are needed as soon as the host is in - a jump from a sheet
     waits for them. They used to wait for every model, typical copies and
     all, only so the slab check could run first; the check changes nothing
     now, so it runs afterwards and only updates its report. */
  S.slabFit = null;
  (async () => {
    for (let i = 0; i < 600 && !S.modelsReady; i++) await new Promise((r) => setTimeout(r, 200));
    try {
      S.slabFit = fromRevit.length ? await floorsFromSlabs(fromRevit) : null;
      if (fromRevit.length) {
        calibrateHeights(fromRevit);          // only the report changes
        if (S.heightNote) status("Floors: " + S.heightNote + ".");
      }
    } catch (e) { /* a check that cannot run is simply not reported */ }
  })();
  if (fromRevit.length) calibrateHeights(fromRevit);
  if (fromRevit.length) {
    S.floors = fromRevit.map((lv) => ({
      name: lv.name, elev: lv.elevation_internal_mm,
      sceneY: internalZToSceneY(lv.elevation_internal_mm), source: "revit",
    })).filter((f) => f.sceneY !== null);
    if (S.floors.length) { renderFloors(); return; }
  }

  const floors = [];
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      let ids = [];
      try {
        const got = await part.model.getItemsOfCategories([/IFCBUILDINGSTOREY/i]);
        ids = Object.values(got || {}).flat();
      } catch (e) { continue; }
      if (!ids.length) continue;
      let data = [];
      try { data = await part.model.getItemsData(ids, { attributesDefault: true }); }
      catch (e) { continue; }

      /* The storey's placement, as the library has already transformed it
         into the scene. This is the authoritative height: it has been
         through the same unit conversion and coordination shift as the
         geometry, so it lines up with the floors by construction rather
         than by a guess about millimetres and offsets. */
      let pos = [];
      try { pos = await part.model.getPositions(ids); } catch (e) { pos = []; }

      data.forEach((d, i) => {
        const name = propValue(d && d.Name) || propValue(d && d.LongName) || "Level";
        const elev = Number(propValue(d && d.Elevation));
        const p = pos && pos[i];
        const sceneY = p && isFinite(p.y) ? p.y : null;
        if (sceneY !== null || isFinite(elev)) {
          floors.push({ name: name, elev: isFinite(elev) ? elev : 0,
                        sceneY: sceneY, part: part });
        }
      });
    }
  }
  /* IFC elevations are in the file's own units and frame; the scene is in
     metres and shifted by the coordination matrix. The model's own vertical
     extent is used to detect millimetres and to line the two up. */
  /* Fallback: some exports do not expose IfcBuildingStorey as a queryable
     category, but the spatial tree always has the storeys in it. Without
     this the panel came up empty and all the user saw was the cut-height
     box, which is not a floor list. */
  if (!floors.length) {
    for (const rec of S.loaded.values()) {
      for (const part of rec.parts) {
        let tree = null;
        try { tree = await part.model.getSpatialStructure(); } catch (e) { continue; }
        const walk = (node) => {
          if (!node) return;
          const cat = String(node.category || "").toUpperCase();
          if (cat.indexOf("BUILDINGSTOREY") >= 0 || cat.indexOf("STOREY") >= 0) {
            floors.push({ name: node.Name || node.name || "Level",
                          elev: 0, sceneY: null, part: part,
                          localId: node.localId });
          }
          for (const c of node.children || []) walk(c);
        };
        walk(tree);
      }
    }
    // Heights for whatever the tree gave us.
    for (const f of floors) {
      if (f.localId == null) continue;
      try {
        const p = await f.part.model.getPositions([f.localId]);
        if (p && p[0] && isFinite(p[0].y)) f.sceneY = p[0].y;
      } catch (e) {}
    }
  }

  // Storeys with no height at all cannot place a cut; keep them visible but
  // spread them evenly through the model so the list is still usable.
  const noY = floors.filter((f) => f.sceneY === null || f.sceneY === undefined);
  if (noY.length && noY.length === floors.length) {
    const box = sceneBox();
    if (!box.isEmpty()) {
      const lo = box.min.y, hi = box.max.y;
      floors.forEach((f, i) => {
        f.sceneY = lo + (hi - lo) * (i / Math.max(1, floors.length - 1));
        f.estimated = true;
      });
    }
  }

  floors.sort((a, b) => floorSceneY(a) - floorSceneY(b));
  const seen = new Set();
  S.floors = floors.filter((f) => {
    const k = f.name + "@" + f.elev.toFixed(3);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  renderFloors();
}

function floorSceneY(f) {
  if (f.sceneY !== null && f.sceneY !== undefined) return f.sceneY;
  // Fallback only: no placement came back, so estimate from Elevation.
  const box = sceneBox();
  const offsetY = coordinationMatrix()
    ? new THREE.Vector3().setFromMatrixPosition(coordinationMatrix()).y : 0;
  let y = f.elev;
  // Revit usually writes millimetres; a storey 12500 "metres" up is 12.5 m.
  if (Math.abs(y) > 2000) y = y / 1000;
  y = y + offsetY;
  // If the result lands wildly outside the model, trust the model's range.
  if (!box.isEmpty() && (y < box.min.y - 50 || y > box.max.y + 50)) {
    y = f.elev / 1000;
  }
  return y;
}

/* The floor list, one row per height.

   Revit projects gather copies of levels - "GF +3.50 (LAYOUT) Copy 1",
   "Copy 2" and on - that sit at exactly the same height as the real one
   and all carry Building Story. Listing each gave 46 rows for a building
   with far fewer floors. Levels within 10 mm of each other are one floor
   here, named by the shortest name among them (the original, not a copy),
   with the others kept in the tooltip. */
function floorRows() {
  const fl = (S.floors || []).slice().sort((a, b) => floorSceneY(a) - floorSceneY(b));
  const rows = [];
  for (const f of fl) {
    const y = floorSceneY(f);
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - y) < 0.01) {
      last.names.push(f.name);
      if (f.name.length < last.name.length) { last.name = f.name; last.floor = f; }
    } else {
      rows.push({ y: y, name: f.name, names: [f.name], floor: f });
    }
  }
  return rows;
}

function renderFloors() {
  const ul = document.getElementById("floor-list");
  if (!ul) return;
  ul.innerHTML = "";
  if (!S.floors || !S.floors.length) {
    ul.innerHTML = '<li class="empty-note">No storeys found in this model.</li>';
    return;
  }
  S.floorRows = floorRows();
  const count = document.getElementById("floor-count");
  if (count) count.textContent = S.floorRows.length;
  const sel = document.getElementById("floor-select");
  if (sel) {
    sel.innerHTML = '<option value="">Whole building</option>'
      + S.floorRows.slice().reverse().map((r) =>
          `<option value="${S.floorRows.indexOf(r)}">${r.name}</option>`).join("");
    sel.value = S.floorIndex === undefined || S.floorIndex === null ? "" : String(S.floorIndex);
  }
  if (S.heightNote) status("Floors: " + S.heightNote + ".");
  if (S.disp && S.disp.groundOn) updateGround();

  // Top floor first, as a building section reads.
  S.floorRows.slice().reverse().forEach((row) => {
    const idx = S.floorRows.indexOf(row);
    const li = document.createElement("li");
    li.className = "floor-row" + (idx === S.floorIndex ? " active" : "");
    li.dataset.idx = idx;
    if (row.names.length > 1) {
      li.title = "Also: " + row.names.filter((n) => n !== row.name).join(", ");
    }
    li.innerHTML = `<span class="fl-name">${row.name}`
      + (row.names.length > 1 ? ` <span class="fl-dup">+${row.names.length - 1}</span>` : "")
      + `</span><span class="fl-elev">${row.y.toFixed(2)} m</span>`;
    li.addEventListener("click", () => goFloor(idx));
    ul.appendChild(li);
  });
}

/* Go to a floor by its place in the list: highlight it, keep it in view,
   cut the model there. Used by the list, the arrows and Page Up / Down. */
/* The floor a point belongs to: the highest level at or below it. A small
   allowance lets a point on the top face of a slab count as that floor
   rather than the one below. */
function levelAt(y) {
  const rows = S.floorRows || [];
  let found = null;
  for (const r of rows) if (r.y <= y + 0.3) found = r;
  return found ? found.name : null;
}

/* The floor of a saved issue: stored since issues began recording it,
   otherwise worked out from where the issue was placed. */
function levelOf(it) {
  /* Worked out from the issue's position whenever the floors are known.
     A stored name is only a fallback: issues placed before the heights were
     calibrated stored a wrong one ("GF +3.98" on 8/F), and the position is
     the truth. */
  if (it && it.model_mm && S.floorRows && S.floorRows.length) {
    const lv = levelAt(it.model_mm[1] / 1000);
    if (lv) return lv;
  }
  if (it && it.issue && it.issue.level) return it.issue.level;
  if (it && it.level) return it.level;
  return null;
}

/* Right-click on an issue in the 3D list: the everyday actions without
   opening it first. */
function issueMenu3D(it, open, jump) {
  const iss = it.issue || {};
  const save = async (why) => {
    await putItem(it);
    refreshPins(); renderIssueList();
    if (why) status(why);
  };
  const setStatus = (st) => async () => { iss.status = st; await save(`${iss.title || "Issue"}: ${st}.`); };
  const st = iss.status || "Open";
  const entries = [
    { label: "Open issue", action: open },
    { label: "Show in view", action: jump },
    "-",
  ];
  if (st !== "In progress") entries.push({ label: "Mark in progress", action: setStatus("In progress") });
  if (st !== "Resolved") entries.push({ label: "Mark resolved", action: setStatus("Resolved") });
  if (st === "Resolved" || st === "Closed") entries.push({ label: "Reopen", action: setStatus("Open") });
  if (!iss.dismissed) {
    entries.push({ label: "Not an issue...", action: async () => {
      const reason = prompt("Why is this not an issue? The person who raised it will see this.");
      if (!reason || !reason.trim()) return;
      iss.dismissed = { by: Store.author() || "?", at: new Date().toISOString(), reason: reason.trim() };
      iss.status = "Closed";
      await save("Marked not an issue.");
    } });
  }
  entries.push("-", { label: "Delete", action: async () => {
    if (!confirm(`Delete issue "${iss.title || ""}"?`)) return;
    await Store.remove(it.id).catch((e) => status(e.message));
    S.items = Store.all(); refreshPins(); renderIssueList();
  } });
  return entries;
}

function levelIndexAt(y) {
  const rows = S.floorRows || [];
  let idx = -1;
  rows.forEach((r, i) => { if (r.y <= y + 0.3) idx = i; });
  return idx;
}

function goFloor(idx) {
  const rows = S.floorRows || [];
  if (!rows.length) return;
  idx = Math.max(0, Math.min(rows.length - 1, idx));
  S.floorIndex = idx;
  const sel = document.getElementById("floor-select");
  if (sel) sel.value = String(idx);
  const ul = document.getElementById("floor-list");
  if (ul) {
    ul.querySelectorAll(".floor-row").forEach((x) =>
      x.classList.toggle("active", Number(x.dataset.idx) === idx));
    const cur = ul.querySelector(`.floor-row[data-idx="${idx}"]`);
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  cutAtFloor(rows[idx].floor, rows[idx].name);
  if (S.drawingOn) updateDrawing();
}

function stepFloor(delta) {
  if (S.floorIndex === undefined || S.floorIndex === null) {
    // First step starts from the ground rather than the roof.
    goFloor(delta > 0 ? 0 : (S.floorRows || []).length - 1);
  } else {
    goFloor(S.floorIndex + delta);
  }
}

/* A floor plan is a horizontal cut about 1.2 m above the floor, looked at
   from above - the same convention as a Revit plan view range. The box
   also trims just below the slab so the floor underneath is not drawn
   through it. */
function cutAtFloor(f, label) {
  const box = sceneBox();
  if (box.isEmpty()) return;
  const y = floorSceneY(f);
  const cut = Number((document.getElementById("floor-cut") || {}).value) || 1.2;
  const span = box.max.y - box.min.y || 1;
  const pct = (v) => Math.max(0, Math.min(100, (v - box.min.y) / span * 100));

  const sec = S.section;
  sec.on = true;
  sec.face = null;
  if (S.arrows) S.arrows.clear();
  document.getElementById("sec-on").checked = true;
  // The whole floor, whatever the plan sliders were left at.
  for (const id of ["sx0", "sy0"]) document.getElementById(id).value = 0;
  for (const id of ["sx1", "sy1"]) document.getElementById(id).value = 100;
  document.getElementById("sh0").value = pct(y - 0.5);
  document.getElementById("sh1").value = pct(y + cut);
  sec.box = box;
  S._inPlanCut = true;
  try { applySection(); } finally { S._inPlanCut = false; }
  S.planCut = { y };
  /* A plan is read square-on: switched to parallel projection unless the
     user has turned that off, so walls read at their true thickness and
     nothing leans away towards the edges as it does in perspective. */
  const wantOrtho = (document.getElementById("floor-ortho") || {}).checked !== false;
  if (wantOrtho && !S.ortho) setOrtho(true);
  presetView("top");
  status(`${label || f.name}: plan cut ${cut} m above the floor at ${y.toFixed(2)} m. `
    + "Page Up / Page Down for the floor above or below.");
}

/* --------------------------------------------------------- face preview */

/* While a section face is being chosen, the surface under the cursor is
   outlined and its normal shown. Without it the user clicks and hopes: the
   only feedback was the cut appearing somewhere afterwards. */
function facePreview() {
  if (!S.facePrev) {
    const g = new THREE.Group();
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xf28022, transparent: true,
        opacity: 0.22, side: THREE.DoubleSide, depthTest: false }));
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 33 }, (_, i) => {
          const t = i / 32 * Math.PI * 2;
          return new THREE.Vector3(Math.cos(t) / 2, Math.sin(t) / 2, 0);
        })),
      new THREE.LineBasicMaterial({ color: 0xd1660e, depthTest: false }));
    const stem = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(), 1, 0xd1660e, 0.28, 0.16);
    stem.line.material.depthTest = false;
    stem.cone.material.depthTest = false;
    g.add(quad); g.add(ring); g.add(stem);
    g.renderOrder = 996;
    g.visible = false;
    S.overlay.add(g);
    S.facePrev = g;
  }
  return S.facePrev;
}

function showFacePreview(point, normal) {
  const g = facePreview();
  const span = Math.max(0.6, S.camera.position.distanceTo(point) * 0.09);
  g.position.copy(point);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
                                  normal.clone().normalize());
  g.scale.set(span, span, span);
  g.visible = true;
  S.dirty = true;
}

function hideFacePreview() {
  if (S.facePrev) { S.facePrev.visible = false; S.dirty = true; }
}

let _facePrevBusy = false;
async function faceHover(ev) {
  if (S.mode !== "face" && S.mode !== "align") { hideFacePreview(); return; }
  if (_facePrevBusy) return;
  _facePrevBusy = true;
  try {
    const found = await pickAt(ev);
    if (found && found.hit.point && found.hit.normal) {
      showFacePreview(found.hit.point, found.hit.normal);
    } else {
      hideFacePreview();
    }
  } catch (e) { hideFacePreview(); }
  finally { _facePrevBusy = false; }
}

/* ------------------------------------------------------- section arrows */

function ensureArrows() {
  if (!S.arrows) {
    S.arrows = createArrows({ THREE: THREE, scene: S.overlay, camera: S.camera,
                              getCamera: () => S.camera,
                              renderer: S.renderer, controls: S.controls,
                              onChange: () => { S.needsRender = true; } });
  }
  return S.arrows;
}

/* Turn a drag of `metres` along one face into a slider change. The sliders
   stay the single source of truth, so arrows, sliders and saved views can
   never disagree about where the cut is. */
function nudgeSlider(id, metres, span) {
  const el = document.getElementById(id);
  if (!el || !span) return;
  const next = Number(el.value) + (metres / span) * 100;
  el.value = Math.max(0, Math.min(100, next));
}

/* Six arrows, one on each face of the box, pointing outward. Opposite
   faces of the same axis share a colour: X red, plan Y green, height blue. */
function updateBoxHandles() {
  const sec = S.section;
  const f = sec && sec.frame;
  if (!sec || !sec.on || !f || sec.face) {
    if (S.arrows && !(sec && sec.face)) S.arrows.clear();
    return;
  }
  const a = ensureArrows();
  const L = f.local;
  const c = L.getCenter(new THREE.Vector3());
  const V = THREE.Vector3;
  const w = (v) => v.clone().applyMatrix4(f.toWorld).add(f.pivot);
  const d = (v) => v.clone().applyMatrix4(f.toWorld).normalize();
  const spanX = f.lmax.x - f.lmin.x, spanZ = f.lmax.z - f.lmin.z;
  const spanY = f.lmax.y - f.lmin.y;

  const face = (key, pos, n, color, slider, span, sign) => ({
    key: key, origin: w(pos), dir: d(n), color: color,
    onDrag: (m) => { nudgeSlider(slider, sign * m, span); applySectionQuiet(); },
    onEnd: () => { applySection(); },
  });
  /* The six faces as SketchUp-style sheets: grab a face and pull it. */
  const x0 = L.min.x, x1 = L.max.x, y0 = L.min.y, y1 = L.max.y, z0 = L.min.z, z1 = L.max.z;
  const sheet = (key, cs, n, slider, span, sign) => ({
    key: "s" + key, corners: cs.map((q) => w(new V(q[0], q[1], q[2]))), dir: d(n),
    fill: 0, tabs: false, outline: false,      // the box's own lines show it; a face lights up under the pointer
    onDrag: (m) => { nudgeSlider(slider, sign * m, span); applySectionQuiet(); },
    onEnd: () => { applySection(); },
  });

  a.set([
    sheet("x1", [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], new V(1, 0, 0), "sx1", spanX, 1),
    sheet("x0", [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], new V(-1, 0, 0), "sx0", spanX, -1),
    sheet("z1", [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], new V(0, 0, 1), "sy1", spanZ, 1),
    sheet("z0", [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], new V(0, 0, -1), "sy0", spanZ, -1),
    sheet("y1", [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], new V(0, 1, 0), "sh1", spanY, 1),
    sheet("y0", [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], new V(0, -1, 0), "sh0", spanY, -1),
    face("x1", new V(L.max.x, c.y, c.z), new V(1, 0, 0), "x", "sx1", spanX, 1),
    face("x0", new V(L.min.x, c.y, c.z), new V(-1, 0, 0), "x", "sx0", spanX, -1),
    face("z1", new V(c.x, c.y, L.max.z), new V(0, 0, 1), "z", "sy1", spanZ, 1),
    face("z0", new V(c.x, c.y, L.min.z), new V(0, 0, -1), "z", "sy0", spanZ, -1),
    face("y1", new V(c.x, L.max.y, c.z), new V(0, 1, 0), "y", "sh1", spanY, 1),
    face("y0", new V(c.x, L.min.y, c.z), new V(0, -1, 0), "y", "sh0", spanY, -1),
  ]);
}

/* Re-cut without rebuilding the arrows, so the one being dragged is not
   swapped out from under the pointer mid-drag. */
function applySectionQuiet() {
  S._quietSection = true;
  try { applySection(); } finally { S._quietSection = false; }
}

/* The single plane gets one arrow along its normal; its X, Y and Z
   companions let it be carried sideways too, which matters when a plane
   was set on a small face and needs moving to the part of interest. */
function updatePlaneHandles() {
  const sec = S.section;
  if (!sec || !sec.face || !S.planePoint) return;
  scheduleCutLines();
  const a = ensureArrows();
  const n = sec.faceNormal.clone().normalize();
  const move = (dir) => (m) => {
    S.planePoint.add(dir.clone().multiplyScalar(m));
    /* Keep the plane's CURRENT normal. The cut is made with the face
       normal reversed, so that the side facing the viewer is removed, and
       Flip reverses it again. Rebuilding from the raw face normal undid
       both: the first drag swapped which side was cut away, which looked
       exactly like the plane moving against the arrow. */
    sec.face.setFromNormalAndCoplanarPoint(sec.face.normal.clone(), S.planePoint);
    S.renderer.clippingPlanes = [sec.face];
    if (sec.faceHelper) {
      sec.faceHelper.plane = sec.face;
      sec.faceHelper.updateMatrixWorld(true);
    }
    S.dirty = true;
  };
  const V = THREE.Vector3;
  // the plane as a SketchUp-style sheet round the point, sized to the model
  const sb = sceneBox();
  const half = Math.max(4, Math.min(150, (sb.isEmpty() ? 40 : sb.getSize(new V()).length()) * 0.3));
  const u = Math.abs(n.y) < 0.9 ? new V(0, 1, 0).cross(n).normalize() : new V(1, 0, 0).cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  const P0 = S.planePoint;
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
    P0.clone().add(u.clone().multiplyScalar(i * half)).add(v.clone().multiplyScalar(j * half)));
  if (sec.faceHelper) sec.faceHelper.visible = false;
  // the normal's dot stands furthest out; a sideways dot along (nearly)
  // the same line as the normal is left out - it would sit on top of it
  const side = [["px", new V(1, 0, 0), "x"], ["py", new V(0, 1, 0), "y"], ["pz", new V(0, 0, 1), "z"]]
    .filter(([, d]) => Math.abs(d.dot(n)) < 0.9)
    .map(([key, d, color]) => ({ key, origin: S.planePoint, dir: d, color, stand: 1.5,
      onDrag: move(d), onEnd: () => updatePlaneHandles() }));
  a.set([
    { key: "sheet", corners: cs, dir: n, onDrag: move(n), onEnd: () => updatePlaneHandles() },
    { key: "n", origin: S.planePoint, dir: n, color: "plane", stand: 2.6, onDrag: move(n),
      onEnd: () => updatePlaneHandles() },
  ].concat(side));
}

/* A draggable section plane.
 *
 * Three sliders ask the user to hold the building's orientation in their
 * head and guess which slider is which wall. A handle they can grab and
 * pull answers the question by being in the place it cuts. */
function ensureGizmo() {
  if (S.gizmo) return S.gizmo;
  if (!TransformControls) {
    status("Drag handles need the updated library bundle: run tools\\build.bat "
      + "once, then reload. The section plane still works without them.");
    return null;
  }

  const g = new TransformControls(S.camera, S.renderer.domElement);
  g.setMode("translate");
  g.setSize(0.8);
  g.addEventListener("dragging-changed", (ev) => {
    // The orbit controls must let go while a handle is being dragged.
    S.controls.enabled = !ev.value;
  });
  g.addEventListener("objectChange", () => {
    applyPlaneFromProxy();
    S.dirty = true;
  });

  // The proxy is what the handles actually move; the cutting plane is
  // derived from its position each frame.
  S.planeProxy = new THREE.Object3D();
  S.scene.add(S.planeProxy);
  const helper = g.getHelper ? g.getHelper() : g;
  S.scene.add(helper);
  S.gizmoHelper = helper;
  S.gizmo = g;
  return g;
}

function applyPlaneFromProxy() {
  const sec = S.section;
  if (!sec.face || !S.planeProxy) return;
  // Keep the normal, move the offset to wherever the handle now sits.
  sec.face.setFromNormalAndCoplanarPoint(sec.faceNormal.clone(),
                                         S.planeProxy.position);
  S.renderer.clippingPlanes = [sec.face];
  if (sec.faceHelper) {
    sec.faceHelper.plane = sec.face;
    sec.faceHelper.updateMatrixWorld(true);
  }
}

function showPlaneGizmo(point, normal) {
  const g = ensureGizmo();
  if (!g) return;
  S.section.faceNormal = normal.clone().normalize();
  S.planeProxy.position.copy(point);
  g.attach(S.planeProxy);
  // Only the axis closest to the normal is useful; the other two slide the
  // plane along itself and do nothing visible.
  const n = S.section.faceNormal;
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  g.showX = ax >= ay && ax >= az;
  g.showY = ay > ax && ay >= az;
  g.showZ = az > ax && az > ay;
  S.dirty = true;
}

function hidePlaneGizmo() {
  if (S.gizmo) S.gizmo.detach();
  S.dirty = true;
}

/* Right button orbits, and right-clicking a surface first moves the orbit
   centre there. Orbiting around the middle of the whole building is useless
   once you are inside it: the camera swings round the tower while you are
   trying to look at one junction. */
function wireOrbitCentre(dom) {
  let downAt = null;

  dom.addEventListener("contextmenu", (ev) => ev.preventDefault());

  dom.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) downAt = { x: ev.clientX, y: ev.clientY, t: Date.now() };
  });

  dom.addEventListener("pointerup", async (ev) => {
    if (ev.button !== 2 || !downAt) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    const held = Date.now() - downAt.t;
    downAt = null;
    // A drag was an orbit; only a tap means "centre here".
    if (moved > 4 || held > 600) return;

    const found = await pickAt(ev);
    open3DMenu(ev, found);
  });
}

/* Right-click menu for the model. A right-click that did not move opens
   it; a right-drag still orbits. What is offered depends on whether an
   element was under the pointer. */
async function open3DMenu(ev, found) {
  const onElement = !!(found && found.hit && found.hit.point);
  if (onElement) {
    // Selecting first means Hide, Isolate and the properties all refer to
    // the thing the user just right-clicked, not an earlier selection.
    let guid = null;
    try {
      const g = await found.part.model.getGuidsByLocalIds([found.hit.localId]);
      guid = g && g[0];
    } catch (e) { /* no GUID: the rest of the menu still works */ }
    found.guid = guid;
    showSelection(found.name, Object.assign(found.hit, { part: found.part }), guid);
    showProperties(found.part, found.hit.localId);
    await highlight(found.part, found.hit.localId);
  }
  const hiddenCount = S.hidden ? S.hidden.size : 0;
  const sec = S.section || {};

  openMenu(ev.clientX, ev.clientY, [
    onElement ? { label: "Set orbit centre here", action: () => {
        S.controls.target.copy(found.hit.point);
        S.controls.update(); S.dirty = true;
        status("Orbit centre moved. Right-drag to orbit around it.");
      } } : null,
    onElement ? { label: "Zoom to this element", action: () => {
        const dir = S.camera.position.clone().sub(S.controls.target).normalize();
        S.controls.target.copy(found.hit.point);
        S.camera.position.copy(found.hit.point).add(dir.multiplyScalar(6));
        S.controls.update(); S.dirty = true;
      } } : null,
    onElement ? "-" : null,
    onElement ? { label: "Isolate", action: () => isolateSelected() } : null,
    onElement ? { label: "Hide", action: () => hideSelected() } : null,
    { label: "Show all", disabled: !hiddenCount, action: () => showAll() },
    "-",
    onElement && !(S.walk && S.walk.on) ? { label: "Walk from here", action: () => {
        S.walk.startAt(found.hit.point, found.hit.normal);
      } } : null,
    onElement ? { label: "Add issue here", action: () => {
        openIssue3D(found.hit.point, { guid: found.guid, name: found.name, part: found.part, localId: found.hit.localId });
      } } : null,
    onElement ? { label: "Section on this face", action: () => {
        setMode("face"); sectionFromFace(ev);
      } } : null,
    onElement ? { label: "Square section box to this face", action: () => {
        setMode("align"); alignSectionToFace(ev);
      } } : null,
    { label: sec.on ? "Turn section off" : "Turn section on", action: () => {
        const cb = document.getElementById("sec-on");
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      } },
    "-",
    { label: "Measure", action: () => setMode("measure") },
    { label: "Save view...", action: () => saveView() },
    { label: "Fit model", action: () => $("#fit3d").click() },
  ].filter(Boolean));
}

/* -------------------------------------------------------------- picking */

/* Double click pulls the camera to what is under the cursor. Orbiting and
   dollying both work relative to the target, so moving the target is the
   only reliable way to inspect one spot in a large model. */
async function onFocus(ev) {
  const hit = await pickAt(ev);
  if (!hit) return;
  const p = hit.hit.point;
  if (!p) return;

  const dir = S.camera.position.clone().sub(S.controls.target).normalize();
  const dist = Math.max(2, S.camera.position.distanceTo(p) * 0.25);
  S.controls.target.copy(p);
  S.camera.position.copy(p).add(dir.multiplyScalar(dist));
  S.controls.update();
  S.dirty = true;
}

/* The worker-backed raycast can stop answering: the promise neither
   resolves nor rejects, which shows up as a Selection panel stuck on
   "Picking...". A timeout turns that into an ordinary miss so the plain
   three.js fallback below still gets its turn. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ __timeout: label }), ms)),
  ]);
}

async function pickAt(ev) {
  try {
    return await pickAtInner(ev);
  } catch (e) {
    S.lastPickError = e.message;
    showError("pickAt", e);
    return null;
  }
}

/* The library does not document whether `mouse` is normalised device
   coordinates or raw client pixels, and the two are indistinguishable from
   the outside: the wrong one simply returns null. Rather than guess, both
   are tried and whichever answers is remembered for subsequent picks. */
function mouseCandidates(ev, rect) {
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const client = new THREE.Vector2(ev.clientX, ev.clientY);
  const local = new THREE.Vector2(ev.clientX - rect.left, ev.clientY - rect.top);

  const all = [["ndc", ndc], ["client", client], ["local", local]];
  if (!S.mouseMode) return all;
  // Put the known-good one first; keep the others as a fallback in case the
  // canvas moves or the library changes.
  return all.sort((a, b) => (b[0] === S.mouseMode) - (a[0] === S.mouseMode));
}

function onPointerRay(ev, rect, point) {
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, S.camera);
  const d = rc.ray.distanceToPoint(point);
  const along = Math.max(0, point.clone().sub(rc.ray.origin).dot(rc.ray.direction));
  // a few pixels' worth at that distance, and never less than 5 cm
  return d <= Math.max(0.05, along * 0.01);
}

async function pickAtInner(ev) {
  const rect = S.renderer.domElement.getBoundingClientRect();
  const results = [];
  let errors = 0, timeouts = 0, tried = [];
  S.lastPickError = null;

  for (const [label, mouse] of mouseCandidates(ev, rect)) {
    tried.push(label);
    for (const [name, rec] of S.loaded) {
      for (const part of rec.parts) {
        let hit = null;
        /* With a section active, the nearest hit is often a wall that has
           been cut away - invisible, but still first along the ray - so the
           element the user can actually see behind it could not be picked.
           Then every hit along the ray is taken, and the first one that is
           not in a cut-away part wins. */
        const planes = S.renderer.clippingPlanes || [];
        const q = { camera: S.camera, mouse: mouse, dom: S.renderer.domElement, planes };
        try {
          hit = await withTimeout(planes.length ? part.model.raycastAll(q)
                                                : part.model.raycast(q), 1500, name);
        } catch (e) {
          errors++; S.lastPickError = `${label}: ${e.message}`; continue;
        }
        if (hit && hit.__timeout) { timeouts++; continue; }
        if (planes.length && Array.isArray(hit)) {
          hit = hit.filter((h) => h && h.point
                   && planes.every((pl) => pl.distanceToPoint(h.point) >= -0.002))
                   .sort((a, b) => (a.distance || 0) - (b.distance || 0))[0] || null;
        }
        /* The hit has to lie on the ray through the pointer. Given the wrong
           mouse convention the library casts through a screen corner
           instead, and inside a building that ray finds a ceiling - which
           used to be taken as proof the convention was right, after which
           every click picked whatever was in the top-left corner. */
        if (hit && hit.point && !onPointerRay(ev, rect, hit.point)) hit = null;
        if (hit) results.push({ name, part, hit, via: "fragments:" + label });
      }
    }
    if (results.length) {
      if (S.mouseMode !== label) {
        S.mouseMode = label;
        status(`Picking works with '${label}' mouse coordinates.`);
      }
      break;                       // no need to try the other conventions
    }
  }

  if (results.length) {
    // Overlapping models: take the one actually nearest the camera.
    results.sort((a, b) =>
      (a.hit.distance === undefined ? Infinity : a.hit.distance)
      - (b.hit.distance === undefined ? Infinity : b.hit.distance));
    return results[0];
  }

  /* No three.js fallback: fragments keeps its geometry in the worker and on
     the GPU, so the main thread has no position attribute to intersect.
     Attempting it only produced "this.array is undefined". */
  S.lastPickCounts = {
    errors, timeouts, models: S.loaded.size, tried: tried.join(", "),
  };
  return null;
}

async function onPick(ev) {
  try {
    await onPickInner(ev);
  } catch (e) {
    showError("onPick", e);
  }
}

async function onPickInner(ev) {
  if (S.walk && S.walk.picking) {
    const found = await pickAt(ev);
    await S.walk.startAt(found && found.hit.point, found && found.hit.normal);
    return;
  }
  if (S.mode === "face") { await sectionFromFace(ev); return; }
  if (S.mode === "align") { await alignSectionToFace(ev); return; }
  if (S.mode === "measure") { await measureClick(ev); return; }
  if (S.mode === "viewalign") { await alignViewsToFace(ev); return; }
  if (S.mode === "calibrate") { await calibrateAt(ev); return; }

  /* Picking goes through a worker and takes a moment. Without a visible
     response the click feels ignored, so the cursor changes immediately
     and only settles once the answer is back. */
  // a click on an issue pin opens that issue
  if (S.mode !== "issue" && pinAtScreen(ev)) return;
  const el = S.renderer.domElement;
  const cursorWas = el.style.cursor;
  el.style.cursor = "progress";
  try {
    await pickBody(ev);
  } finally {
    el.style.cursor = cursorWas;
  }
}

async function pickBody(ev) {
  showSelection(null, null, null, "Picking...");
  const found = await pickAt(ev);
  if (!found) {
    const c = S.lastPickCounts || {};
    showSelection(null, null, null,
      "No hit.<br>"
      + `Models: ${c.models || 0}. `
      + `Raycast timeouts: ${c.timeouts || 0}. `
      + `Errors: ${c.errors || 0}.<br>`
      + `Mouse conventions tried: ${c.tried || "none"}.<br>`
      + `Last error: ${S.lastPickError || "none"}.`);
    return;
  }

  let guid = null;
  if (found.part && found.hit.localId != null) {
    try {
      const g = await found.part.model.getGuidsByLocalIds([found.hit.localId]);
      guid = g && g[0];
    } catch (e) {}
  }

  if (S.mode === "face") {
    showSelection(found.name, Object.assign(found.hit, { part: found.part }), guid);
    return;
  }
  if (S.mode === "issue") {
    // one issue at a time: the window is open, so a click only picks
    if (!$("#i3-back").hidden) { showSelection(found.name, Object.assign(found.hit, { part: found.part }), guid); status("Finish or cancel the issue being written first."); return; }
    if (!found.hit.point) {
      status("Hit registered but it carried no position, so no issue "
             + "can be placed there.");
      return;
    }
    openIssue3D(found.hit.point, { guid: guid, name: found.name, part: found.part, localId: found.hit.localId });
    return;
  }
  showSelection(found.name, Object.assign(found.hit, { part: found.part }), guid);
  showProperties(found.part, found.hit.localId);
  highlight(found.part, found.hit.localId);

  /* Re-target on the picked point. Dollying and orbiting are both relative
     to the target, so leaving it at the centre of the building is what made
     close approach feel blocked: each wheel step is a fraction of the
     distance to the target, not to the surface in front of you. */
  /* The view itself does not move: the new centre is put on the line of
     sight, at the depth of the picked surface. Putting it ON the picked
     point turned the camera to face it - the jump on every click, and in a
     plan the drawing rotating to suit whatever was clicked. */
  if (found.hit.point) {
    const dir = new THREE.Vector3();
    S.camera.getWorldDirection(dir);
    const depth = found.hit.point.clone().sub(S.camera.position).dot(dir);
    if (depth > 0.05) {
      S.controls.target.copy(S.camera.position).addScaledVector(dir, depth);
      S.controls.update();
      S.dirty = true;
    }
  }
}

/* ------------------------------------------------- Revit elements */

/* The Revit element behind a picked id: { revit_id, revit_uid, ifc_guid,
   name, category, family, type, level, model }. A model exported by the LWK
   add-in (.lwkm) knows all of it; an older one only its IFC GUID and the
   manifest's element list. */
function recOfPart(part) {
  for (const rec of S.loaded.values()) if (rec.parts && rec.parts.includes(part)) return rec;
  return null;
}
function elementOfRec(rec, e) {
  const h = rec.parts[0].model.head, el = h.el;
  const at = (k) => (el[k] ? el[k][e] : undefined);
  return {
    revit_id: at("id") != null ? String(at("id")) : "", revit_uid: at("uid") || "", ifc_guid: at("guid") || "",
    name: at("name") || "", category: (h.cats && el.cat ? h.cats[el.cat[e]] : "") || "",
    family: at("family") || "", type: at("type") || "", level: at("level") || "", model: rec.entry.name,
  };
}
function elementInfo(part, localId, guid) {
  try {
    if (part && part.model && part.model.head && typeof part.model.elementOfId === "function" && localId != null) {
      const e = part.model.elementOfId(localId);
      const rec = recOfPart(part);
      if (e != null && rec) return elementOfRec(rec, e);
    }
  } catch (err) { /* below */ }
  const m = guid && lookupElement(guid);
  if (m) return { revit_id: m.element_id != null ? String(m.element_id) : "", revit_uid: "", ifc_guid: guid, name: "", category: m.category || "", level: m.level || "" };
  return guid ? { revit_id: "", revit_uid: "", ifc_guid: guid } : null;
}
const escH = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const asLink = (x) => ({ id: x.revit_id || "", uid: x.revit_uid || "", name: x.name || x.family || "", category: x.category || "" });

/* What is selected now (a pick, or the model browser's Select), for
   "+ Task", Copy Revit IDs and Show in Revit. */
S.selEls = [];
function selectionFromBrowser() {
  const out = [];
  for (const [rec, els] of (MB.pick && MB.pick.sets) || []) {
    for (const e of els) { out.push(asLink(elementOfRec(rec, e))); if (out.length >= 500) return out; }
  }
  return out;
}
window.LWK3D = Object.assign(window.LWK3D || {}, {
  selectedElements: () => (S.selEls || []).filter((x) => x.id || x.uid),
  // where each loaded model sits in the scene (support and tests)
  extents: () => [...S.loaded].map(([k, rec]) => [k, rec.parts.map((p) => {
    const b = worldBox(p);
    return b.isEmpty() ? null : [b.min.toArray().map((v) => +v.toFixed(2)), b.max.toArray().map((v) => +v.toFixed(2))];
  })]),
});

/* The inspect panel's Copy Revit ID / Show in Revit / + Task. */
function wireSelectionButtons() {
  wireElementBlocks();
  const box = $("#inspect-body");
  if (!box || box.dataset.rvWired) return;
  box.dataset.rvWired = "1";
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("#sel-copyid, #sel-revit, #sel-task");
    if (!b) return;
    const els = window.LWK3D.selectedElements();
    if (b.id === "sel-copyid") copyIds(els);
    if (b.id === "sel-revit") showInRevit(Store.currentProject(), els, { title: els.map((e) => e.name).filter(Boolean).slice(0, 3).join(", ") });
    if (b.id === "sel-task") { const t = document.getElementById("lwk-send-task"); if (t) t.click(); }
  });
}

/* model.html?elements=<UniqueId or ElementId>,... : picked out and zoomed to. */
async function elementsFromUrl() {
  const want = (new URLSearchParams(location.search).get("elements") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!want.length) return;
  for (let i = 0; i < 900 && !S.modelsReady; i++) await new Promise((r) => setTimeout(r, 200));
  if (!mbRecs().length) { status("Finding Revit elements needs a model published by the LWK add-in (.lwkm)."); return; }
  const keys = new Set(want);
  const sets = new Map();
  for (const rec of mbRecs()) {
    const el = rec.parts[0].model.head.el;
    const n = (el.id || []).length;
    for (let e = 0; e < n; e++) {
      if (keys.has((el.uid || [])[e]) || keys.has(String(el.id[e]))) {
        if (!sets.has(rec)) sets.set(rec, new Set());
        sets.get(rec).add(e);
      }
    }
  }
  if (!sets.size) { status("Those Revit elements are not in this model (changed or deleted since)."); return; }
  MB.pick = { sets, label: want.length === 1 ? "the element" : want.length + " elements" };
  await mbSelect();
  S.selEls = selectionFromBrowser();
  await mbZoom(sets);
  const [rec, es] = [...sets.entries()][0];
  const info = elementOfRec(rec, [...es][0]);
  const found = [...sets.values()].reduce((n, x) => n + x.size, 0);
  status(`${found} of ${want.length} element${want.length === 1 ? "" : "s"} found: ${info.category || ""} ${info.name || ""}`.trim());
}

function showSelection(modelName, hit, guid, extra) {
  if (S.drawerNote) S.drawerNote();
  const el = $("#inspect-body");
  if (!modelName) {
    S.selEls = [];
    el.className = "pad muted";
    el.innerHTML = (extra || "Nothing under the cursor.");
    return;
  }
  el.className = "pad";
  const match = guid && lookupElement(guid);
  el.innerHTML =
    `<div class="kv"><span>Model</span><b>${modelName}</b></div>`
    + `<div class="kv"><span>Local id</span><b>${hit.localId != null ? hit.localId : "&mdash;"}</b></div>`
    + `<div class="kv"><span>IFC GUID</span><b>${guid || "&mdash;"}</b></div>`
    + (hit.point && levelAt(hit.point.y)
        /* Where the element actually is in the building. A typical floor's
           own properties say 7/F in every copy - the level it was drawn
           on in its own file - so the placed level is stated first. */
        ? `<div class="kv lvl"><span>Level here</span><b>${levelAt(hit.point.y)}</b></div>`
        : "")
    + (hit.point
        ? `<div class="kv"><span>Point</span><b>${hit.point.x.toFixed(2)}, `
          + `${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)} m</b></div>`
          + (() => {
              const s = sceneToSharedMM(hit.point).map((v) => (v / 1000).toFixed(2));
              return `<div class="kv"><span>Shared E,N,Z</span>`
                + `<b>${s[0]}, ${s[1]}, ${s[2]} m</b></div>`;
            })()
        : "")
    + (() => {
        // the Revit element: what Revit calls it, and the ways back to Revit
        const info = elementInfo(hit.part, hit.localId, guid) || (match ? { revit_id: String(match.element_id || ""), category: match.category, level: match.level } : null);
        S.selEls = info && (info.revit_id || info.revit_uid) ? [asLink(info)] : [];
        if (!info || !(info.revit_id || info.revit_uid || info.category)) return "";
        return (info.category ? `<div class="kv"><span>Category</span><b>${escH(info.category)}</b></div>` : "")
          + (info.family || info.type ? `<div class="kv"><span>Family / type</span><b>${escH([info.family, info.type].filter(Boolean).join(": "))}</b></div>` : "")
          + (info.level ? `<div class="kv"><span>Level</span><b>${escH(info.level)}</b></div>` : "")
          + (info.revit_id ? `<div class="kv"><span>Revit id</span><b>${escH(info.revit_id)}</b></div>` : "")
          + (info.revit_uid ? `<div class="kv"><span>UniqueId</span><b style="font-size:10px;word-break:break-all">${escH(info.revit_uid)}</b></div>` : "")
          + (info.revit_id || info.revit_uid ? `<div class="rv-b" style="margin:6px 0 2px">`
            + `<button type="button" class="ghost" id="sel-copyid" title="In Revit: Manage > Select by ID, paste">Copy Revit ID</button>`
            + `<button type="button" class="ghost" id="sel-revit" title="Revit's LWK add-in selects it">Show in Revit</button>`
            + `<button type="button" class="ghost" id="sel-task" title="Keep it on a task (Tasks page)">+ Task</button></div>` : "");
      })()
    + `<div id="props" class="muted" style="margin-top:8px">Reading properties...</div>`;
}

/* Built-in IFC attributes for the clicked element. Relations are not
   traversed: property sets can be hundreds of entries and the round trip is
   noticeable, so this stays at the level that answers "what is this". */
/* Element properties.
 *
 * The flat attribute list is the handful of fields the library returns by
 * default: category, id, guid, name, type. Everything an architect actually
 * asks about - fire rating, load bearing, area, the type mark, the level -
 * lives in IFC property sets, which are reached through the IsDefinedBy
 * relation and have to be asked for.
 *
 * Sets are shown collapsed so the panel still opens on one screen; Pset
 * names are long and there are usually a dozen of them.
 */
// every set starts folded (the list reads down, one line each); a set opened
// by hand stays open for the next element clicked
const openPsets = new Set();

function propValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.value !== undefined) return propValue(v.value);
    return null;
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    // IFC carries raw SI values; long decimals are noise on screen.
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

const prettyKey = (k) => String(k)
  .replace(/^(Pset_|Qto_)/, "")
  .replace(/([a-z])([A-Z])/g, "$1 $2");

function psetBlock(title, pairs) {
  if (!pairs.length) return "";
  const open = openPsets.has(title);
  const rows = pairs.map(([k, v]) =>
    `<div class="kv"><span>${prettyKey(k)}</span><b>${v}</b></div>`).join("");
  return `<div class="pset${open ? "" : " closed"}" data-pset="${title}">`
    + `<div class="pset-head"><span class="caret">&#9662;</span>`
    + `${prettyKey(title)}<span class="count">${pairs.length}</span></div>`
    + `<div class="pset-body">${rows}</div></div>`;
}

async function showProperties(part, localId) {
  const el = document.getElementById("props");
  if (!el) return;
  if (!part || localId == null) { el.textContent = ""; return; }

  el.innerHTML = '<span class="muted">Reading properties...</span>';

  let data = null;
  try {
    data = (await part.model.getItemsData([localId], {
      attributesDefault: true,
      relations: {
        IsDefinedBy: { attributes: true, relations: true },
        DefinesOccurrence: { attributes: false, relations: false },
        ContainedInStructure: { attributes: true, relations: false },
      },
    }))[0];
  } catch (e) {
    // Property sets are optional; without them the basic attributes are
    // still worth showing rather than failing the whole panel.
    try {
      data = (await part.model.getItemsData([localId],
        { attributesDefault: true }))[0];
    } catch (e2) {
      el.textContent = "Properties unavailable: " + e2.message;
      return;
    }
  }
  if (!data) { el.textContent = "No properties returned."; return; }

  const blocks = [];
  const flat = [];
  const relations = [];

  for (const k of Object.keys(data)) {
    const raw = data[k];
    if (Array.isArray(raw)) { relations.push([k, raw]); continue; }
    const v = propValue(raw);
    if (v !== null) flat.push([k, v]);
  }
  blocks.push(psetBlock("Attributes", flat));

  for (const [relName, list] of relations) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const title = propValue(entry.Name) || propValue(entry.Description)
        || prettyKey(relName);
      const pairs = [];

      // A property set carries its values either as HasProperties or as
      // Quantities, depending on whether it is a Pset or a Qto.
      const bag = entry.HasProperties || entry.Quantities || entry.HasQuantities;
      if (Array.isArray(bag)) {
        for (const p of bag) {
          const pn = propValue(p && p.Name);
          const pv = propValue(p && (p.NominalValue !== undefined ? p.NominalValue
                     : p.LengthValue !== undefined ? p.LengthValue
                     : p.AreaValue !== undefined ? p.AreaValue
                     : p.VolumeValue !== undefined ? p.VolumeValue
                     : p.CountValue !== undefined ? p.CountValue
                     : p.WeightValue !== undefined ? p.WeightValue
                     : p.Value));
          if (pn && pv !== null) pairs.push([pn, pv]);
        }
      } else {
        for (const kk of Object.keys(entry)) {
          if (kk === "Name" || kk === "_localId" || kk === "_category") continue;
          const vv = propValue(entry[kk]);
          if (vv !== null) pairs.push([kk, vv]);
        }
      }
      blocks.push(psetBlock(title, pairs));
    }
  }

  const html = blocks.filter(Boolean).join("");
  el.className = "";
  el.innerHTML = html || '<span class="muted">No named attributes.</span>';

  for (const head of el.querySelectorAll(".pset-head")) {
    head.addEventListener("click", () => {
      const box = head.parentElement;
      const name = box.dataset.pset;
      box.classList.toggle("closed");
      if (box.classList.contains("closed")) openPsets.delete(name);
      else openPsets.add(name);
    });
  }
}


let _guidIndex = null;
function lookupElement(guid) {
  if (!_guidIndex) {
    _guidIndex = new Map();
    for (const e of S.manifest.elements || []) {
      if (e.ifc_guid) _guidIndex.set(e.ifc_guid, e);
    }
  }
  return _guidIndex.get(guid) || null;
}

/* ----------------------------------------------------------------- list */

/* The part of a model's name that tells it apart: "YL52-LWK-Z1-BD_B6_TYP-AR-M3-N"
   among its siblings reads "B6_TYP". The whole name is in the tooltip. */
function shortModelName(name, models) {
  models = models || ((S.manifest && S.manifest.models) || []).filter((m) => m.fragments);
  const names = models.map((m) => m.name);
  if (names.length < 3) return name;
  // the start and the end every name shares, cut at a "-" or "_"
  let pre = names.reduce((a, n) => { let i = 0; while (i < a.length && a[i] === n[i]) i++; return a.slice(0, i); });
  let suf = names.reduce((a, n) => { let i = 0; while (i < a.length && a[a.length - 1 - i] === n[n.length - 1 - i]) i++; return a.slice(a.length - i); });
  const cut = pre.search(/[-_][^-_]*$/);
  pre = cut >= 0 ? pre.slice(0, cut + 1) : "";
  const cs = suf.search(/[-_]/);
  suf = cs >= 0 ? suf.slice(cs) : "";
  let out = name.slice(pre.length, name.length - suf.length).replace(/(^|-)BD_/g, "$1");
  return out.length >= 2 ? out : name;
}

function renderModelList() {
  const models = (S.manifest.models || []).filter((m) => m.fragments && m.status !== "converting");
  $("#model-count").textContent = `(${models.length})`;
  const ul = $("#model-list");
  ul.innerHTML = "";

  for (const m of models) {
    const li = document.createElement("li");
    const id = "m_" + m.name.replace(/\W/g, "_");
    const n = m.coordinates === "host"
      ? 1 : Math.max(1, (m.instances || []).length);
    /* One line per model - the name - with its details folded away behind
       the small arrow: with a dozen links the list was a wall of text. */
    const short = shortModelName(m.name, models);
    li.className = "model-row";
    li.innerHTML =
      `<div class="mrow"><label class="row-check" title="${m.name}">`
      + `<input type="checkbox" id="${id}">`
      + `<span class="nm">${short}</span></label>`
      + `<button class="m-more ghost" title="Details">&#9656;</button></div>`
      + `<div class="m-detail" hidden>`
      + `<div class="tags">${m.role || "link"} &middot; `
      + `${m.fragments_mb != null ? m.fragments_mb + " MB" : ""}`
      + (n > 1 ? ` &middot; ${n} placements` : "") + "</div>"
      + `<div class="tags zrange" data-extent="${m.name}"></div>`
      + `<div class="tags perf-line" data-perf="${m.name}"></div>`
      + (m.format === "lwkm" ? `<button class="ghost m-cmp" title="What changed since the previous export of this model">Compare with previous export</button>` : "")
      + `</div>`
      + `<div class="tags light-note" data-light="${m.name}" hidden></div>`;
    ul.appendChild(li);
    const more = li.querySelector(".m-more"), det = li.querySelector(".m-detail");
    const cmpB = li.querySelector(".m-cmp");
    if (cmpB) cmpB.addEventListener("click", (ev) => { ev.preventDefault(); compareModel(m).catch((e) => showError("compare", e)); });
    more.addEventListener("click", (ev) => {
      ev.preventDefault();
      det.hidden = !det.hidden;
      more.innerHTML = det.hidden ? "&#9656;" : "&#9662;";
    });

    li.querySelector("input").addEventListener("change", async (ev) => {
      const on = ev.target.checked;
      ev.target.disabled = true;
      try {
        if (on) {
          status("Loading " + m.name + " ...");
          // Kept on the box so start-up can wait for it to finish.
          ev.target._loading = loadModel(m);
          await ev.target._loading;
        }
        else await unloadModel(m.name);
        let drawn = 0;
        for (const r of S.loaded.values()) drawn += r.parts.length;
        status(`${S.loaded.size} model(s), ${drawn} placement(s) drawn.`);
      } catch (e) {
        status(m.name + ": " + e.message);
        ev.target.checked = false;
      }
      ev.target.disabled = false;
      writeSelection();
    });
  }
}

async function loadAll(on) {
  const boxes = document.querySelectorAll("#model-list input");
  for (const b of boxes) {
    if (b.checked === on) continue;
    b.checked = on;
    b.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 60));
  }
  writeSelection();
  /* The view stays where it is. Zooming out to the whole development
     asked for every model at once - on a phone or tablet, more than it can
     hold - and it was the user's place in the model that was lost. The
     Fit button is there for the whole view. */
  if (on) status("All models switched on - the view stays where it is (Fit shows everything).");
}


/* ---------------------------------------------------------- section box */

/* Six axis-aligned clipping planes driven by percentage sliders. Global
   clipping is used rather than per-material so it covers the materials the
   fragments loader builds, which this code never sees. */
function initSection() {
  S.section = {
    on: false,
    box: null,
    planes: [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),   // x max
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),    // x min
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),   // y max
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),    // y min
      new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),   // z max
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),    // z min
    ],
    helper: null,
  };
}

function sceneBox() {
  const box = new THREE.Box3();
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      const b = worldBox(part);
      if (!b.isEmpty()) box.union(b);
    }
  }
  return box;
}

/* The whole project's extent, loaded or not: the fast 3D export writes
   each model's box (and each link placement's) into the manifest. A
   section box set up while linked models are still loading - the jump
   from a sheet - is measured against this, not against the few models
   already in (the host alone was a box of nothing, and cut everything
   away: the orange ring on a grey field). */
function projectBox() {
  const box = sceneBox();
  if (!lwkFrame() || !S.manifest) return box;
  const add = (bb) => {
    if (!bb || bb.length !== 2) return;
    for (const x of [bb[0][0], bb[1][0]]) for (const y of [bb[0][1], bb[1][1]])
      for (const z of [bb[0][2], bb[1][2]]) {
        const p = internalToScene([x, y, z]);
        if (p) box.expandByPoint(p);
      }
  };
  for (const m of S.manifest.models || []) {
    if (m.format !== "lwkm") continue;
    if (m.bbox_mm) add(m.bbox_mm);
    for (const i of m.instances || []) add(i.bbox_mm);
  }
  return box;
}

function manifestHasBoxes() {
  const ms = ((S.manifest && S.manifest.models) || []).filter((m) => m.format === "lwkm" && m.role !== "host");
  return ms.length > 0 && ms.every((m) => (m.instances || []).some((i) => i.bbox_mm));
}

/* Fragments serves a Y-up scene even though IFC is Z-up, so the building's
   height is three.js Y and its plan axes are X and Z. Labelling a slider
   "Z" for height is how the vertical control ended up on the wrong axis. */
function applySection() {
  const sec = S.section;
  if (!sec) return;
  // the plan look belongs to a floor plan cut, not to a box moved by hand
  if (!S._inPlanCut && !S._quietSection) S.planCut = null;

  if (!sec.on) {
    S.renderer.clippingPlanes = [];
    if (sec.helper) { S.overlay.remove(sec.helper); sec.helper = null; }
    scheduleCutLines(0);
    S.dirty = true;
    return;
  }

  if (!sec.box || sec.box.isEmpty()) {
    sec.box = projectBox();
    if (sec.box.isEmpty()) {
      status("Nothing to section yet - load a model first.");
      return;
    }
  }

  const b = sec.box;
  const pct = (id) => Number(document.getElementById(id).value) / 100;
  const lerp = (a, z, t) => a + (z - a) * t;

  /* Everything is worked out in the BOX's own frame, then carried back to
     the world. The earlier version measured the extents along the world
     axes and only turned the plane normals, so on an aligned box a slider
     slid the cut diagonally across the building instead of along it.

     The frame pivots about the model's centre and turns about the vertical
     only: tilting a floor cut is never what anyone wants. */
  const deg = Number(document.getElementById("srot").value) || 0;
  const rad = deg * Math.PI / 180;
  const pivot = b.getCenter(new THREE.Vector3());
  const toWorld = new THREE.Matrix4().makeRotationY(rad);
  const toLocal = new THREE.Matrix4().makeRotationY(-rad);

  // The model's extent measured along the rotated axes: its eight corners,
  // expressed in the box frame.
  const lmin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let k = 0; k < 8; k++) {
    const c = new THREE.Vector3(
      k & 1 ? b.max.x : b.min.x,
      k & 2 ? b.max.y : b.min.y,
      k & 4 ? b.max.z : b.min.z).sub(pivot).applyMatrix4(toLocal);
    lmin.min(c);
    lmax.max(c);
  }

  // sx/sy are the plan axes of the box; sh is height.
  const x0 = lerp(lmin.x, lmax.x, pct("sx0"));
  const x1 = lerp(lmin.x, lmax.x, pct("sx1"));
  const z0 = lerp(lmin.z, lmax.z, pct("sy0"));
  const z1 = lerp(lmin.z, lmax.z, pct("sy1"));
  const y0 = lerp(lmin.y, lmax.y, pct("sh0"));
  const y1 = lerp(lmin.y, lmax.y, pct("sh1"));
  const lc = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  const world = (v) => v.clone().applyMatrix4(toWorld).add(pivot);
  const dir = (v) => v.clone().applyMatrix4(toWorld).normalize();
  const V = THREE.Vector3;
  const put = (plane, n, p) => plane.setFromNormalAndCoplanarPoint(dir(n), world(p));

  put(sec.planes[0], new V(-1, 0, 0), new V(x1, lc.y, lc.z));
  put(sec.planes[1], new V(1, 0, 0), new V(x0, lc.y, lc.z));
  put(sec.planes[4], new V(0, 0, -1), new V(lc.x, lc.y, z1));
  put(sec.planes[5], new V(0, 0, 1), new V(lc.x, lc.y, z0));
  put(sec.planes[2], new V(0, -1, 0), new V(lc.x, y1, lc.z));
  put(sec.planes[3], new V(0, 1, 0), new V(lc.x, y0, lc.z));

  S.renderer.clippingPlanes = sec.planes;

  /* The outline, drawn in the box's own frame so it sits exactly on the
     cut. NOT a Box3Helper: that class recomputes its own position and
     scale from the box on every frame and discards any rotation set on
     it, so an aligned box was cutting at an angle while its outline stayed
     square to the world - the two disagreeing is what made the box so
     confusing to aim. */
  if (sec.helper) S.overlay.remove(sec.helper);
  const local = new THREE.Box3(new V(x0, y0, z0), new V(x1, y1, z1));
  const localCentre = local.getCenter(new V());
  const dim = local.getSize(new V());
  const edges = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(Math.max(dim.x, 1e-4), Math.max(dim.y, 1e-4),
                          Math.max(dim.z, 1e-4)));
  sec.helper = new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({ color: 0xf28022, depthTest: false,
                                  transparent: true, opacity: 0.9 }));
  sec.helper.name = "__sectionbox";
  sec.helper.position.copy(world(localCentre));
  sec.helper.rotation.y = rad;
  sec.helper.renderOrder = 997;
  S.overlay.add(sec.helper);

  // Frame kept for the drag handles, which move faces along these axes.
  sec.frame = { pivot: pivot, rad: rad, lmin: lmin, lmax: lmax,
                local: local, toWorld: toWorld, toLocal: toLocal };

  const size = local.getSize(new V());
  status(`Section box ${size.x.toFixed(1)} x ${size.z.toFixed(1)} m in plan, `
    + `${size.y.toFixed(1)} m high` + (deg ? `, turned ${deg} deg` : ""));
  if (!S._quietSection) updateBoxHandles();
  if (!S._quietSection) scheduleCutLines();
  S.dirty = true;
}

/* Aligning a box with sliders is guesswork on a building that is not
   square to the world. Picking a face and using its own normal puts the cut
   exactly on that plane, which is what people actually want. */
async function sectionFromFace(ev) {
  const found = await pickAt(ev);
  if (found) {
    status(`Face pick via ${found.via}, `
      + (found.hit.normal ? "with a normal." : "but it carried no normal."));
  }
  if (!found || !found.hit.point) {
    status("No surface there - click directly on a face.");
    return;
  }
  let n = found.hit.normal;
  if (!n) {
    status("That surface reported no orientation, so a plane cannot be "
           + "aligned to it. Try a flat face.");
    return;
  }
  n = n.clone().normalize();

  const sec = S.section;
  sec.on = true;
  $("#sec-on").checked = true;
  S.planCut = null;
  sec.face = new THREE.Plane().setFromNormalAndCoplanarPoint(
    n.clone().negate(), found.hit.point.clone());

  S.renderer.clippingPlanes = [sec.face];
  if (sec.helper) { S.overlay.remove(sec.helper); sec.helper = null; }
  if (sec.faceHelper) S.overlay.remove(sec.faceHelper);
  sec.faceHelper = new THREE.PlaneHelper(sec.face, 30, 0xf28022);
  sec.faceHelper.name = "__sectionface";
  if (sec.faceHelper.material) sec.faceHelper.material.clippingPlanes = [];
  S.overlay.add(sec.faceHelper);

  sec.faceNormal = n.clone().normalize();
  S.planePoint = found.hit.point.clone();
  updatePlaneHandles();
  S.dirty = true;
  setMode("nav");
  status(`Section plane on the picked face. Drag the arrow to move it. `
    + "Use Flip to cut the other side, or Align to face for a square box.");
}

/* The rotation slider is guesswork on a building that is not square to the
   world: you nudge it and judge the result by eye. A face already knows
   which way it points, so picking one sets the angle exactly and the box
   comes out orthogonal to the building. */
async function alignSectionToFace(ev) {
  const found = await pickAt(ev);
  if (!found || !found.hit.point) {
    status("No surface there - click a flat face of the building.");
    return;
  }
  const n = found.hit.normal;
  if (!n) {
    status("That surface reported no orientation. Try a larger flat face.");
    return;
  }

  // Heading of the face normal in plan. Rotating the box by this angle puts
  // one pair of its sides parallel to the face.
  const horiz = Math.hypot(n.x, n.z);
  if (horiz < 0.2) {
    status("That face points up or down, so it cannot set a plan rotation. "
           + "Pick a wall rather than a floor.");
    return;
  }
  let deg = Math.atan2(n.x, n.z) * 180 / Math.PI;
  // The box is symmetric, so keep the angle in a range the slider can show.
  while (deg > 90) deg -= 180;
  while (deg < -90) deg += 180;

  const sec = S.section;
  sec.on = true;
  $("#sec-on").checked = true;
  sec.face = null;
  hidePlaneGizmo();
  if (sec.faceHelper) { S.overlay.remove(sec.faceHelper); sec.faceHelper = null; }
  sec.box = projectBox();
  document.getElementById("srot").value = Math.round(deg);
  applySection();

  setMode("nav");
  status(`Section box aligned to that face (${deg.toFixed(1)} degrees). `
    + "Use the X, Y and H sliders to cut into it.");
}

function flipFace() {
  const sec = S.section;
  if (!sec || !sec.face) { status("No face plane to flip."); return; }
  sec.face.negate();
  S.renderer.clippingPlanes = [sec.face];
  scheduleCutLines();
  if (sec.faceHelper) S.overlay.remove(sec.faceHelper);
  sec.faceHelper = new THREE.PlaneHelper(sec.face, 30, 0xf28022);
  if (sec.faceHelper.material) sec.faceHelper.material.clippingPlanes = [];
  S.overlay.add(sec.faceHelper);
  S.dirty = true;
}

function resetSection() {
  for (const id of ["sx0", "sy0", "sh0"]) {
    document.getElementById(id).value = 0;
  }
  for (const id of ["sx1", "sy1", "sh1"]) {
    document.getElementById(id).value = 100;
  }
  document.getElementById("srot").value = 0;
  if (S.section) {
    S.section.box = projectBox();
    S.section.face = null;
    if (S.section.faceHelper) {
      S.scene.remove(S.section.faceHelper);
      S.section.faceHelper = null;
    }
  }
  applySection();
}


/* ------------------------------------------------------- snapshot markup */

/* A BCF viewpoint is a picture plus the camera that produced it. Both are
   captured here so an issue can be reviewed by someone who was never at
   that camera position, and so the view can be restored later. */
function captureViewpoint() {
  renderMain();

  const src = S.renderer.domElement;
  const maxW = 1600;
  let url;
  if (src.width > maxW) {
    const c = document.createElement("canvas");
    c.width = maxW;
    c.height = Math.round(src.height * (maxW / src.width));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    url = c.toDataURL("image/jpeg", 0.82);
  } else {
    url = src.toDataURL("image/jpeg", 0.82);
  }

  const t = S.controls.target;
  return {
    image: url,
    camera: {
      // Scene millimetres, for restoring the view inside this viewer.
      position_mm: [toMM(S.camera.position.x), toMM(S.camera.position.y),
                    toMM(S.camera.position.z)],
      target_mm: [toMM(t.x), toMM(t.y), toMM(t.z)],
      // Original model millimetres, for anything leaving the viewer.
      position_model_mm: originalMM(S.camera.position),
      target_model_mm: originalMM(t),
      // Already Z-up and in Revit's own frame: BCF uses these as they are.
      position_internal_mm: sceneToInternalMM(S.camera.position),
      target_internal_mm: sceneToInternalMM(t),
      position_shared_mm: sceneToSharedMM(S.camera.position),
      target_shared_mm: sceneToSharedMM(t),
      up: [S.camera.up.x, S.camera.up.y, S.camera.up.z],
      fov: fovOf(),
      // perspective or parallel, and walking at eye level: Revit opens a
      // walk-through issue as a perspective view from the same eye
      ortho: !!S.ortho,
      walk: !!(S.walk && S.walk.on),
      // the section box / plane as cutting planes in Revit's own frame, so
      // BCF opens in Revit with the same section box (clipping_internal)
      clipping_internal: clippingInternal(),
    },
    // What the author could see, not just where they stood: a sectioned
    // view restored without its section shows the outside of a wall.
    state: viewState(),
  };
}

/* The cutting planes in force, each as a point on it and the direction of
   the side that is cut AWAY (BCF's convention), in Revit internal mm. */
function clippingInternal() {
  const planes = (S.renderer && S.renderer.clippingPlanes) || [];
  const out = [];
  for (const pl of planes) {
    try {
      const pt = pl.coplanarPoint(new THREE.Vector3());
      const ahead = pt.clone().addScaledVector(pl.normal, -1);   // three keeps the normal's side
      const a = sceneToInternalMM(pt), b = sceneToInternalMM(ahead);
      if (!a || !b) continue;
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const n = Math.hypot(d[0], d[1], d[2]) || 1;
      out.push({ location_mm: a, direction: d.map((x) => x / n) });
    } catch (e) {}
  }
  return out.length ? out : null;
}

/* The parts of a view that are not the camera. Shared by saved views and
   issues so both restore identically. */
function viewState() {
  const sec = S.section || {};
  return {
    section: sec.on ? {
      on: true,
      rot: Number(document.getElementById("srot").value) || 0,
      sliders: ["sx0", "sx1", "sy0", "sy1", "sh0", "sh1"].map(
        (id) => Number((document.getElementById(id) || {}).value || 0)),
      face: sec.face && sec.faceNormal && S.planePoint ? {
        normal: sec.faceNormal.toArray(), point: S.planePoint.toArray(),
        // the plane exactly as it cuts: its normal is reversed from the
        // face's (and Flip reverses it again), so the face normal alone
        // cannot say which side is kept
        plane: [sec.face.normal.x, sec.face.normal.y, sec.face.normal.z, sec.face.constant] } : null,
      // the box the sliders are percentages of - restored as it was, not
      // recomputed from whatever happens to be loaded when the view opens
      box: sec.box && !sec.box.isEmpty() ? sec.box.min.toArray().concat(sec.box.max.toArray()) : null,
    } : { on: false },
    hidden: Array.from(S.hidden || []),
    // how it was looked at: parallel or perspective, the floor plan picked,
    // and whether the author was walking (eye height)
    ortho: !!S.ortho,
    zoom: S.camera && S.camera.isOrthographicCamera ? S.camera.zoom || 1 : null,
    floor: S.floorIndex === undefined ? null : S.floorIndex,
    plan_cut: S.planCut ? { y: S.planCut.y } : null,
    walk: S.walk && S.walk.on ? { eye: S.walk.settings.eye } : null,
  };
}

function applyViewState(st) {
  if (!st) return;
  const sec = S.section;
  const s = st.section || { on: false };
  if (s.on) {
    sec.on = true;
    document.getElementById("sec-on").checked = true;
    document.getElementById("srot").value = s.rot || 0;
    ["sx0", "sx1", "sy0", "sy1", "sh0", "sh1"].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el && s.sliders) el.value = s.sliders[i];
    });
    if (s.face) {
      sec.faceNormal = new THREE.Vector3().fromArray(s.face.normal);
      S.planePoint = new THREE.Vector3().fromArray(s.face.point);
      sec.face = s.face.plane
        ? new THREE.Plane(new THREE.Vector3(s.face.plane[0], s.face.plane[1], s.face.plane[2]),
                          s.face.plane[3])
        // views saved before the plane itself was stored: the cut is made
        // with the face normal reversed
        : new THREE.Plane().setFromNormalAndCoplanarPoint(
            sec.faceNormal.clone().negate(), S.planePoint);
      S.renderer.clippingPlanes = [sec.face];
      updatePlaneHandles();
    } else {
      sec.face = null;
      sec.box = s.box
        ? new THREE.Box3(new THREE.Vector3(s.box[0], s.box[1], s.box[2]),
                         new THREE.Vector3(s.box[3], s.box[4], s.box[5]))
        : sceneBox();
      applySection();
    }
  } else if (sec.on) {
    sec.on = false;
    sec.face = null;
    document.getElementById("sec-on").checked = false;
    applySection();
    if (S.arrows) S.arrows.clear();
  }
  if (st.hidden) applyHidden(new Set(st.hidden));
  // older states say nothing about these: leave them as they are
  if (st.floor !== undefined) {
    S.floorIndex = st.floor === null ? undefined : st.floor;
    const sel = document.getElementById("floor-select");
    if (sel) sel.value = st.floor === null ? "" : String(st.floor);
  }
  if (st.plan_cut !== undefined) S.planCut = st.plan_cut ? { y: st.plan_cut.y } : null;
  if (st.ortho !== undefined) {
    if (!!st.ortho !== !!S.ortho) setOrtho(!!st.ortho);
    if (st.ortho && st.zoom && S.camera.isOrthographicCamera) {
      S.camera.zoom = st.zoom;
      S.camera.updateProjectionMatrix();
    }
  }
}

/* An issue's view exactly as its author had it: the camera they stood at,
   AND the section box or plane (with its rotation), hidden elements,
   projection and floor plan in force - so the reviewer sees what the
   author saw, not the outside of the wall they were looking into. Used by
   a click in the list, "Show in view" and ?select= links alike. */
function goToIssueView(it) {
  if (S.walk && (S.walk.on || S.walk.picking)) S.walk.stop();
  const vp = it.viewpoint;
  const st = it.viewpoint_state || (vp && vp.state) || null;
  if (st) applyViewState(st);
  else if (vp && (vp.ortho === true || vp.ortho === false) && !!vp.ortho !== !!S.ortho) setOrtho(!!vp.ortho);
  if (vp && vp.position_mm && vp.target_mm) {
    const pos = new THREE.Vector3(fromMM(vp.position_mm[0]), fromMM(vp.position_mm[1]), fromMM(vp.position_mm[2]));
    const tgt = new THREE.Vector3(fromMM(vp.target_mm[0]), fromMM(vp.target_mm[1]), fromMM(vp.target_mm[2]));
    if (vp.up && vp.up.length === 3) S.camera.up.fromArray(vp.up);
    if ((st && st.walk) || vp.walk) {
      status("This issue was raised while walking: you are at the same eye point - press Walk to carry on from here.");
    }
    return flyTo(pos, tgt, vp.fov);
  }
  const p = issuePoint(it) || S.controls.target.clone();
  const dir = S.camera.position.clone().sub(S.controls.target).normalize();
  return flyTo(p.clone().add(dir.multiplyScalar(8)), p);
}

/* Glide rather than jump. An instant cut to a new viewpoint loses the
   viewer's sense of where in the building they have landed; half a second
   of travel keeps it. */
function flyTo(pos, target, fov, ms) {
  const p0 = S.camera.position.clone(), t0 = S.controls.target.clone();
  const f0 = S.camera.fov || 55, f1 = fov || f0;
  const dur = ms || 550;
  const start = performance.now();
  S.flying = true;
  return new Promise((done) => {
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      S.camera.position.lerpVectors(p0, pos, e);
      S.controls.target.lerpVectors(t0, target, e);
      if (!S.camera.isOrthographicCamera && isFinite(f1)) {
        S.camera.fov = f0 + (f1 - f0) * e;
      }
      S.camera.updateProjectionMatrix();
      S.controls.update();
      S.dirty = true;
      if (k < 1) requestAnimationFrame(step);
      else { S.flying = false; done(); }
    };
    requestAnimationFrame(step);
  });
}

function openSnapshotEditor(shot, onDone, initial) {
  const back = $("#snap-back");
  const img = $("#snap-img");
  const svg = $("#snap-svg");
  /* What was drawn before comes back to be carried on with: the editor
     used to open empty every time, so a second visit threw the first
     visit's markup away. */
  const items = (initial || []).map((x) => JSON.parse(JSON.stringify(x)));
  let ctl = null;

  img.src = shot.image;
  back.hidden = false;

  const size = () => {
    const r = img.getBoundingClientRect();
    return [Math.max(1, r.width), Math.max(1, r.height)];
  };

  const paint = () => {
    const [w, h] = size();
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    // The overlay has to sit exactly on the picture, which is letterboxed
    // inside its container, so it is positioned from the image's own box.
    const ir = img.getBoundingClientRect();
    const sr = $("#snap-stage").getBoundingClientRect();
    svg.style.left = (ir.left - sr.left) + "px";
    svg.style.top = (ir.top - sr.top) + "px";
    MK.redraw(svg, items, w, h, ctl && ctl.getDraft(),
              ctl && ctl.selectedId());
    $("#snap-delete").disabled = !(ctl && ctl.selected());
  };

  const style = () => ({
    color: $("#snap-color").value,
    tcolor: $("#snap-tcolor").value,
    fill: $("#snap-fill").value,
    fillop: Number($("#snap-fillop").value),
    // The editor stores weight and size as fractions of the picture; the
    // fields show the same numbers as the sheets page, so "3.5" means the
    // same text size in both places.
    width: (Number($("#snap-width").value) || 0.5) * 0.008,
    dash: $("#snap-dash").value,
    font: $("#snap-font").value,
    size: (Number($("#snap-size").value) || 3.5) * 0.01,
    align: $("#snap-align").value,
  });

  ctl = MK.attach(svg, items, {
    getStyle: style,
    onChange: paint,
    onText: () => {
      const v = prompt("Text");
      return v === null ? null : v;
    },
    onSelect: () => paint(),
  });

  const tw = $("#snap-tools");
  tw.innerHTML = "";
  for (const t of MK.TOOLS) {
    const b = iconButton(t.id, t.label, t.label);
    if (t.id === "select") b.classList.add("active");
    b.addEventListener("click", () => {
      tw.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      ctl.setTool(t.id);
      paint();
    });
    tw.appendChild(b);
  }

  // Changing a style control restyles the current selection, so the
  // controls edit the drawing rather than only the next stroke.
  for (const id of ["snap-color", "snap-fill", "snap-tcolor", "snap-fillop", "snap-width",
                    "snap-dash", "snap-font", "snap-size", "snap-align"]) {
    $("#" + id).oninput = () => { ctl.applyStyle(style()); paint(); };
  }

  $("#snap-delete").onclick = () => { ctl.deleteSelected(); paint(); };
  $("#snap-undo").onclick = () => { items.pop(); paint(); };
  $("#snap-clear").onclick = () => { items.length = 0; paint(); };

  const onKey = (ev) => {
    if (back.hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && ev.key !== "Escape") return;
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ctl.deleteSelected(); paint();
    } else if (ev.key === "Escape") {
      // Esc confirms the markup (a line being drawn is finished first) -
      // and stops here: the issue panel behind must not close as well
      ev.preventDefault();
      ev.stopPropagation();
      ctl.cancel(); paint();
      finish(true);
    }
  };

  const finish = (keep) => {
    back.hidden = true;
    removeEventListener("resize", paint);
    removeEventListener("keydown", onKey, true);
    // this controller lets go of the drawing surface (see markup.js attach)
    try { ctl.detach(); } catch (e) {}
    onDone(keep ? items.slice() : null);
  };
  $("#snap-cancel").onclick = () => finish(false);
  $("#snap-ok").onclick = () => finish(true);

  addEventListener("resize", paint);
  addEventListener("keydown", onKey, true);
  img.onload = paint;
  paint();
}

/* A saved issue's picture, opened in the markup editor again. With the
   clean picture on record (issues saved since 2 Oct 2026) the earlier
   markup comes back editable; an older issue has it baked into the picture,
   so that picture becomes the base and new markup goes on top. Resolves
   true once item.snapshot / item.markup hold the result (the caller saves). */
async function editSavedSnapshot(item) {
  const base = item.snapshot_raw || item.snapshot;
  if (!base) return false;
  const blob = await (await fetch(base)).blob();
  const image = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("could not read the picture"));
    r.readAsDataURL(blob);
  });
  const shot = { image };
  const before = item.snapshot_raw ? (item.markup || []) : [];
  const items = await new Promise((resolve) => openSnapshotEditor(shot, resolve, before));
  if (!items) return false;                       // cancelled
  const flat = await flatten(shot, items);
  const path = await Store.uploadSnapshot(flat);
  if (!item.snapshot_raw) item.snapshot_raw = item.snapshot;   // the old picture is the base from now on
  item.snapshot = path;
  item.markup = items;
  return true;
}

/* Flatten the snapshot and its markup into one image, so a reviewer gets a
   single picture and BCF gets a conformant viewpoint snapshot. */
function flatten(shot, markup) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);

      if (!markup || !markup.length) { resolve(c.toDataURL("image/jpeg", 0.85)); return; }

      const svg = document.createElementNS(
        "http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", c.width);
      svg.setAttribute("height", c.height);
      MK.redraw(svg, markup, c.width, c.height, null, null);

      const blob = new Blob(
        [new XMLSerializer().serializeToString(svg)],
        { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const overlay = new Image();
      overlay.onload = () => {
        ctx.drawImage(overlay, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      overlay.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      overlay.src = url;
    };
    image.onerror = () => resolve(shot.image);
    image.src = shot.image;
  });
}

/* ------------------------------------------------------------ 3D issues */

/* Same storage key as the sheets page, so an issue raised on a drawing and
   one dropped on a wall land in the same list. Positions are stored in
   millimetres to match everything the Revit exporter writes; the scene is
   metres, so the conversion happens here and nowhere else. */
/* Items live on the server now. These wrappers keep the rest of the file
   unchanged: it still reads S.items and calls saveItems() after a change. */
function loadItems() {
  S.items = Store.all();
}

function saveItems() {
  // Individual writes go through putItem; this only refreshes the cache.
  S.items = Store.all();
}

async function putItem(item) {
  try {
    await Store.put(item);
  } catch (e) {
    status("Could not save to the server: " + e.message);
    showError("save", e);
    return false;
  }
  S.items = Store.all();
  return true;
}

/* Shared (survey) millimetres, Z-up, to the scene: sceneToSharedMM run
   backwards. */
function sharedToScene(mm) {
  const g = new THREE.Vector3(mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000);
  const m = coordinationMatrix();
  if (m) g.applyMatrix4(m);
  return g;
}

/* A .bcfzip from another program, as 3D issues. BCF points are metres;
   whether they are in Revit's internal frame (as this viewer and most
   Revit add-ins write them) or in shared coordinates (as an IFC-based tool
   may) is decided by which of the two puts the topics on the project. */
async function importBcf(buf, name, frame = "auto") {
  status(`Reading ${name} ...`);
  const topics = await readBcf(buf);
  if (!topics.length) { status(`${name}: no topics found.`); return; }
  const box = projectBox();
  const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  const radius = box.isEmpty() ? 1000 : box.getSize(new THREE.Vector3()).length() / 2;
  const mmOf = (v) => v.map((n) => n * 1000);
  const probe = (t) => t.mark || (t.camera && t.camera.eye) || null;
  let dInt = 0, dSh = 0, nP = 0;
  for (const t of topics) {
    const q = probe(t);
    if (!q) continue;
    const a = internalToScene(mmOf(q)), b = sharedToScene(mmOf(q));
    if (a) dInt += Math.min(a.distanceTo(centre), radius * 20);
    if (b) dSh += Math.min(b.distanceTo(centre), radius * 20);
    nP++;
  }
  const shared = frame === "shared" ? true : frame === "internal" ? false : (nP > 0 && dSh < dInt);
  const toScene = (m) => (shared ? sharedToScene(mmOf(m)) : internalToScene(mmOf(m)));
  const have = new Set(S.items.filter((it) => it.issue && it.issue.guid).map((it) => it.issue.guid));
  // IFC GUIDs to elements, for a pin on the selected element
  const guidPoint = async (guids) => {
    for (const rec of S.loaded.values()) {
      for (const part of rec.parts) {
        try {
          const ids = await part.model.getLocalIdsByGuids(guids);
          const got = ids.filter((x) => x !== null && x !== undefined);
          if (!got.length) continue;
          const bx = await part.model.getBoxes(got);
          const all = new THREE.Box3();
          for (const b of bx) if (b && !b.isEmpty()) all.union(b);
          if (!all.isEmpty()) return { p: all.getCenter(new THREE.Vector3()), name: rec.entry.name };
        } catch (e) { /* this model does not know them */ }
      }
    }
    return null;
  };
  let added = 0, skipped = 0, placedBy = { mark: 0, element: 0, camera: 0 };
  for (const t of topics) {
    if (t.guid && have.has(t.guid)) { skipped++; continue; }
    let p = null, modelName = null;
    if (t.mark) { p = toScene(t.mark); placedBy.mark++; }
    if (!p && t.guids.length) {
      const g = await guidPoint(t.guids);
      if (g) { p = g.p; modelName = g.name; placedBy.element++; }
    }
    let eyeS = null, tgtS = null;
    if (t.camera) {
      const d = new THREE.Vector3(...t.camera.dir).normalize();
      const eyeM = t.camera.eye;
      eyeS = toScene(eyeM);
      const tgtM = [eyeM[0] + d.x * 8, eyeM[1] + d.y * 8, eyeM[2] + d.z * 8];
      tgtS = toScene(tgtM);
      if (!p && tgtS) { p = tgtS.clone(); placedBy.camera++; }
    }
    if (!p) { skipped++; continue; }
    let snapshot = null;
    if (t.snapshot) {
      try { snapshot = await Store.uploadSnapshot(t.snapshot); } catch (e) { snapshot = null; }
    }
    const viewpoint = eyeS && tgtS ? {
      position_mm: [toMM(eyeS.x), toMM(eyeS.y), toMM(eyeS.z)],
      target_mm: [toMM(tgtS.x), toMM(tgtS.y), toMM(tgtS.z)],
      position_model_mm: originalMM(eyeS), target_model_mm: originalMM(tgtS),
      position_internal_mm: sceneToInternalMM(eyeS), target_internal_mm: sceneToInternalMM(tgtS),
      position_shared_mm: sceneToSharedMM(eyeS), target_shared_mm: sceneToSharedMM(tgtS),
      up: [0, 1, 0], fov: t.camera.fov || 60,
    } : null;
    const lvl = levelAt(p.y);
    const item = {
      id: uid(),
      placement: "3d",
      model_mm: [toMM(p.x), toMM(p.y), toMM(p.z)],
      model_original_mm: originalMM(p),
      model_internal_mm: sceneToInternalMM(p),
      model_shared_mm: sceneToSharedMM(p),
      ifc_guid: t.guids[0] || null,
      model_name: modelName,
      created_at: t.created || new Date().toISOString(),
      viewpoint, snapshot, markup: [],
      imported: { from: name, at: new Date().toISOString(), frame: shared ? "shared" : "internal" },
      issue: {
        guid: t.guid || uid(), title: t.title,
        type: /clash/i.test(t.type) ? "clash" : (/design|request|rfi/i.test(t.type) ? "design" : "general"),
        description: t.description, status: t.status, priority: t.priority || "",
        assigned_to: t.assigned, due_date: t.due ? t.due.slice(0, 10) : null,
        created_at: t.created || new Date().toISOString(),
        author: t.author || Store.author(),
        level: lvl || null,
        comments: t.comments.map((c) => ({ author: c.author, text: c.text, at: c.at || null })),
        labels: t.labels,
      },
      level: lvl || null,
    };
    if (await putItem(item)) { added++; have.add(item.issue.guid); }
    else skipped++;
  }
  refreshPins();
  renderIssueList();
  status(`${name}: ${added} issue(s) imported`
    + (skipped ? `, ${skipped} skipped (already here or no position)` : "")
    + ` - placed by marked point ${placedBy.mark}, by element ${placedBy.element}, by camera ${placedBy.camera}; `
    + `read as ${shared ? "shared" : "Revit internal"} coordinates`
    + (frame === "auto" ? " (worked out - if every issue is off by the same distance, delete them and import again choosing the other)." : "."));
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const in3D = (it) => it && it.placement === "3d" && it.model_mm;

/* Issues raised on the sheets, shown in 3D too: where their markup sits in
   the model (the viewport's mapping gave it Revit coordinates), a little
   above the floor on a plan. Diamonds, where 3D issues are balls. */
// Switched off (2026-09-30l): seeing the sheet issues in 3D as well was
// more confusing than useful. They stay on the sheets page only.
S.showSheetIssues = false;
const onSheet3D = (it) => !!(it && it.issue && it.placement !== "3d" && !it.deleted && it.sheet
  && it.anchor && Array.isArray(it.anchor.model_mm) && it.anchor.model_mm.length === 3);
const _sheetPt = new Map();
function issuePoint(it) {
  if (in3D(it)) return new THREE.Vector3(fromMM(it.model_mm[0]), fromMM(it.model_mm[1]), fromMM(it.model_mm[2]));
  if (!onSheet3D(it)) return null;
  const a = it.anchor, key = it.id + ":" + a.model_mm.join(",");
  let p = _sheetPt.get(key);
  if (p === undefined) {
    p = internalToScene(a.model_mm);
    // a plan's point is at its level: lift it to eye height in the room
    if (p && a.normal && Math.abs(a.normal[2]) > 0.7) p.y += 1.2;
    if (p && !p.toArray().every(isFinite)) p = null;
    if (p) _sheetPt.set(key, p);        // not kept while no model is placed yet
  }
  return p ? p.clone() : null;
}
const inList3D = (it) => in3D(it) || (S.showSheetIssues && onSheet3D(it) && !!issuePoint(it));

/* Undo the coordination translation. The first loaded model defines the
   scene origin, so its matrix is the one that matters. */
function coordinationMatrix() {
  const p = firstHostPart();
  return p ? p.coord : null;
}

function sceneToOriginal(v) {
  const m = coordinationMatrix();
  const p = v.clone();
  if (m) p.applyMatrix4(new THREE.Matrix4().copy(m).invert());
  return p;
}

const originalMM = (v) => {
  const p = sceneToOriginal(v);
  return [toMM(p.x), toMM(p.y), toMM(p.z)];
};

/* Revit's internal coordinates.
 *
 * Three frames are in play. The scene is shifted so rendering stays precise.
 * The IFC was exported on shared coordinates, so the model's own numbers are
 * Hong Kong grid values around 835 km. Revit, and the BCF readers that talk
 * to it, work in the project's internal coordinates. Only Revit knows the
 * transform between the last two, so the exporter writes it into the
 * manifest and it is applied here. */
let _plMatrix;
let _plNote = "";
let _plDir = "forward";

function projectLocationMatrix() {
  const LF = lwkFrame();
  if (LF) { _plNote = "exact (fast 3D format: " + (LF.note || "base points") + ")"; return LF.PL; }
  if (_plMatrix !== undefined) return _plMatrix;
  const pl = S.manifest && S.manifest.project_location;
  if (!pl || !pl.origin_mm) { _plMatrix = null; return _plMatrix; }

  const o = pl.origin_mm.map(fromMM);
  const fwd = new THREE.Matrix4();
  fwd.set(
    pl.basis_x[0], pl.basis_y[0], pl.basis_z[0], o[0],
    pl.basis_x[1], pl.basis_y[1], pl.basis_z[1], o[1],
    pl.basis_x[2], pl.basis_y[2], pl.basis_z[2], o[2],
    0, 0, 0, 1);
  const inv = fwd.clone().invert();

  /* Revit's documentation does not settle which way GetTotalTransform
     points, and the two directions are a kilometre apart, so guessing is
     not an option. Both are applied to a point known to be in the model and
     the one that lands near the origin wins - internal coordinates are
     always close to the project's own origin, shared ones are 1170 km away
     on this site. */
  const probe = sharedProbePoint();
  if (!probe || probe.length() < 1) {
    // Too close to the origin to tell the directions apart. Leave the choice
    // undecided so it is retried once real coordinates are available.
    _plMatrix = undefined;
    _plNote = "undecided (no usable probe point yet)";
    return null;
  }

  const a = probe.clone().applyMatrix4(fwd).length();
  const b = probe.clone().applyMatrix4(inv).length();
  if (a <= b) { _plMatrix = fwd; _plDir = "forward"; _plNote = `forward (${(a / 1000).toFixed(1)} km`
    + ` vs ${(b / 1000).toFixed(1)} km)`; }
  else { _plMatrix = inv; _plDir = "inverse"; _plNote = `inverse (${(b / 1000).toFixed(1)} km`
    + ` vs ${(a / 1000).toFixed(1)} km)`; }
  return _plMatrix;
}

/* A point inside the model, expressed in shared coordinates and Z-up: the
   yardstick both candidate transforms are measured against. */
function sharedProbePoint() {
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      const b = worldBox(part);
      if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3());
      const g = sceneToOriginal(c);
      return new THREE.Vector3(g.x, -g.z, g.y);
    }
  }
  return null;
}

const projectLocationNote = () => {
  projectLocationMatrix();
  return _plNote;
};

/* Revit internal millimetres to scene metres: sceneToInternalMM run
   backwards. Built as one matrix from the same pieces, so the two can never
   disagree. Used to follow a point from a sheet into the model. */
function internalToScene(mm) {
  const C = coordinationMatrix();
  if (!C) return null;
  const F = new THREE.Matrix4().makeTranslation(0, 0, (S.zAdj || 0) / 1000);
  const PL = projectLocationMatrix();
  if (PL) F.multiply(PL);
  F.multiply(Zm).multiply(C.clone().invert());
  const v = new THREE.Vector3(mm[0] / 1000, mm[1] / 1000, mm[2] / 1000);
  return v.applyMatrix4(F.invert());
}

/* Arriving from a sheet: model.html?...&at=x,y,z&label=...
   The point is in Revit internal millimetres - what the sheet's viewport
   mapping gives. The floor it belongs to is cut and shown in plan, the
   camera is put over the point, and a marker shows exactly where. */
/* Narrow the section box, in plan, to a square of `half` metres either side
   of a point, keeping its heights. Worked out in the box's own frame (it
   turns about the vertical by the R angle), exactly as applySection reads
   the sliders, so a turned box still frames the right room. */
function sectionWindowAround(p, half) {
  const sec = S.section;
  if (!sec || !sec.on) return;
  const b = sec.box || sceneBox();
  if (!b || b.isEmpty()) return;
  const rad = (Number(document.getElementById("srot").value) || 0) * Math.PI / 180;
  const pivot = b.getCenter(new THREE.Vector3());
  const toLocal = new THREE.Matrix4().makeRotationY(-rad);
  const lmin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const q = new THREE.Vector3(x, y, z).sub(pivot).applyMatrix4(toLocal);
    lmin.min(q); lmax.max(q);
  }
  const pl = p.clone().sub(pivot).applyMatrix4(toLocal);
  const pct = (v, lo, hi) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  document.getElementById("sx0").value = pct(pl.x - half, lmin.x, lmax.x);
  document.getElementById("sx1").value = pct(pl.x + half, lmin.x, lmax.x);
  document.getElementById("sy0").value = pct(pl.z - half, lmin.z, lmax.z);
  document.getElementById("sy1").value = pct(pl.z + half, lmin.z, lmax.z);
  applySection();
}

/* A veil over the 3D view while a jump from a sheet is being set up, so the
   user sees neither the whole building nor the steps in between - only the
   room, once it is ready. */
function jumpVeil(on, text) {
  let v = document.getElementById("jump-veil");
  if (on) {
    if (!v) {
      v = document.createElement("div");
      v.id = "jump-veil";
      document.getElementById("canvas-wrap").appendChild(v);
    }
    v.innerHTML = `<div class="jv-box"><div class="jv-spin"></div>${text || ""}</div>`;
    v.classList.remove("gone");
  } else if (v) {
    v.classList.add("gone");                  // fades out, then is removed
    setTimeout(() => v.remove(), 450);
  }
}

/* ------------------------------------------- the plan drawing in the model

   A floor plan from the sheets, laid over the 3D cut of its floor. Every
   plan viewport carries Revit's own paper-to-model transform, so the
   drawing - with its annotations, dimensions, tags and room names - lands
   exactly on the model. Only the viewport's area is rendered from the
   sheet PDF, and the paper's white is made transparent so only the
   linework lies over the model.

   The drawing is drawn over everything (no depth test) at the plan cut
   height: from above it sits exactly on the plan; in a tilted view it
   floats at cut height, as a drawing held over the model would. */
const MM_PT = 72 / 25.4;
if (window.pdfjsLib) {
  // pdf.js is served by the viewer (vendor/), through the import map's cached copy
  pdfjsLib.GlobalWorkerOptions.workerSrc = (typeof import.meta.resolve === "function" ? import.meta.resolve("./vendor/pdf.worker.min.js")
      : new URL("vendor/pdf.worker.min.js", location.href).href);
}

/* The sheet viewports that show a floor: plan views whose own level (the
   height of their paper-to-model origin) falls on that floor. */
function drawingsForFloor(idx) {
  const out = [];
  for (const sh of (S.manifest && S.manifest.sheets) || []) {
    if (!sh.pdf) continue;
    for (const vp of sh.viewports || []) {
      const map = vp.paper_to_model;
      if (!map || !vp.paper_rect_mm) continue;
      if (!/Plan/i.test(vp.view_type || "")) continue;
      const p = internalToScene(map.origin);
      if (p && levelIndexAt(p.y + 0.5) === idx) out.push({ sheet: sh, vp });
    }
  }
  return out;
}

function removeDrawing() {
  if (S.drawing) {
    S.overlay.remove(S.drawing);
    S.drawing.geometry.dispose();
    if (S.drawing.material.map) S.drawing.material.map.dispose();
    S.drawing.material.dispose();
    S.drawing = null;
    S.dirty = true;
  }
}

async function showDrawing(c) {
  removeDrawing();
  if (!window.pdfjsLib) { status("The PDF library did not load, so drawings cannot be shown."); return; }
  const { sheet, vp } = c;
  status(`Laying ${sheet.number} - ${vp.view_name} over the floor ...`);
  const doc = await pdfjsLib.getDocument(Store.dataUrl(sheet.pdf)).promise;
  const page = await doc.getPage(sheet.page || 1);
  const [x, y, w, h] = vp.paper_rect_mm;

  // just the viewport's area, sharp enough to read dimensions
  let scale = 200 / 72;
  const longest = Math.max(w, h) * MM_PT * scale;
  if (longest > 4096) scale *= 4096 / longest;
  const view = page.view;                       // the page's own origin, centre or corner
  const pv = page.getViewport({ scale: scale, rotation: 0 });
  const [ax, ay] = pv.convertToViewportPoint(x * MM_PT + view[0], (y + h) * MM_PT + view[1]);
  const W = Math.max(1, Math.round(w * MM_PT * scale)), H = Math.max(1, Math.round(h * MM_PT * scale));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  await page.render({ canvasContext: g, viewport: pv, transform: [1, 0, 0, 1, -ax, -ay] }).promise;

  // paper white becomes see-through; linework keeps its colour
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const ink = 255 - Math.min(d[i], d[i + 1], d[i + 2]);
    d[i + 3] = Math.min(255, ink * 1.6);
  }
  g.putImageData(img, 0, 0);

  // the four corners through Revit's own transform, into the scene
  const map = vp.paper_to_model;
  const toModel = (u, v) => [0, 1, 2].map((k) => map.origin[k] + u * map.x_axis[k] + v * map.y_axis[k]);
  const row = (S.floorRows || [])[S.floorIndex];
  const cut = Number((document.getElementById("floor-cut") || {}).value) || 1.2;
  const yAt = row ? row.y + cut + 0.01 : internalToScene(map.origin).y;
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([u, v]) => {
    const p = internalToScene(toModel(u, v));
    return [p.x, yAt, p.z];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(corners.flat(), 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 990;
  mesh.name = "__drawing";
  S.overlay.add(mesh);
  S.drawing = mesh;
  S.dirty = true;
  status(`Drawing: ${sheet.number} - ${vp.view_name}. Its annotations and dimensions lie over the cut.`);
}

/* Keep the drawing in step with the floor: called when the floor changes
   and when the Drawing button is pressed. */
async function updateDrawing() {
  const btn = document.getElementById("plan-draw");
  const pick = document.getElementById("plan-draw-pick");
  if (!S.drawingOn || S.floorIndex === undefined || S.floorIndex === null) {
    removeDrawing();
    pick.hidden = true;
    return;
  }
  const cands = drawingsForFloor(S.floorIndex);
  if (!cands.length) {
    removeDrawing();
    pick.hidden = true;
    const row = (S.floorRows || [])[S.floorIndex];
    status(`No sheet shows a plan of ${row ? row.name : "this floor"}.`);
    return;
  }
  pick.innerHTML = cands.map((c, i) =>
    `<option value="${i}">${c.sheet.number} - ${c.vp.view_name}</option>`).join("");
  pick.hidden = cands.length < 2;
  S.drawingCands = cands;
  try { await showDrawing(cands[0]); }
  catch (e) { showError("drawing", e); }
  if (btn) btn.classList.toggle("active", !!S.drawing);
}

/* Straight into the room: one section box and one camera position, set
   together, with nothing animated in between.

   The box runs from just below this floor's slab to just under the slab
   of the floor above - the whole room height, not a 1.2 m plan cut - and
   about 12 m across, centred on the point, in the box's own frame. The
   camera stands off a corner, in perspective, looking in. */
function focusRoom(p, idx) {
  const rows = S.floorRows || [];
  const here = idx >= 0 ? rows[idx] : null;
  const above = idx >= 0 ? rows[idx + 1] : null;
  const yLo = (here ? here.y : p.y) - 0.4;
  const yHi = above ? above.y - 0.1 : (here ? here.y : p.y) + 3.6;

  const sec = S.section;
  sec.on = true;
  sec.face = null;
  sec.box = projectBox();
  document.getElementById("sec-on").checked = true;
  const b = sec.box;
  const pctY = (v) => Math.max(0, Math.min(100, (v - b.min.y) / (b.max.y - b.min.y) * 100));
  document.getElementById("sh0").value = pctY(yLo);
  document.getElementById("sh1").value = pctY(yHi);

  // the window in plan, in the box's frame (it turns about the vertical)
  const rad = (Number(document.getElementById("srot").value) || 0) * Math.PI / 180;
  const pivot = b.getCenter(new THREE.Vector3());
  const toLocal = new THREE.Matrix4().makeRotationY(-rad);
  const lmin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const q = new THREE.Vector3(x, y, z).sub(pivot).applyMatrix4(toLocal);
    lmin.min(q); lmax.max(q);
  }
  const pl = p.clone().sub(pivot).applyMatrix4(toLocal);
  const half = 6;
  const pct = (v, lo, hi) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  document.getElementById("sx0").value = pct(pl.x - half, lmin.x, lmax.x);
  document.getElementById("sx1").value = pct(pl.x + half, lmin.x, lmax.x);
  document.getElementById("sy0").value = pct(pl.z - half, lmin.z, lmax.z);
  document.getElementById("sy1").value = pct(pl.z + half, lmin.z, lmax.z);
  applySection();

  // the floor list shows where we are, without re-cutting
  if (idx >= 0) {
    S.floorIndex = idx;
    const sel = document.getElementById("floor-select");
    if (sel) sel.value = String(idx);
  }

  if (S.ortho) setOrtho(false);
  const a = viewAlignDeg() * Math.PI / 180;
  const back = new THREE.Vector3(7, 0, 9).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
  const eye = p.clone().add(back).add(new THREE.Vector3(0, 6.5, 0));
  S.camera.up.set(0, 1, 0);
  S.camera.position.copy(eye);
  S.controls.target.copy(p);
  S.camera.lookAt(p);
  S.controls.update();
  S.dirty = true;
}

/* ?select=<issue id> (from Revit's LWK Issues, or a shared link): the issue
   is picked out in the list, its details open and the camera goes to where
   its author stood - once the issue has arrived and the model is there. */
async function selectFromUrl() {
  const id = new URLSearchParams(location.search).get("select");
  if (!id) return;
  // a saved view (linked from the Messenger with %): fly to it
  for (let i = 0; i < 900 && !(S.items.some((x) => x.id === id) && S.modelsReady); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const v = S.items.find((x) => x.id === id);
  if (v && isView(v)) { restoreView(v); renderViewList(); return; }
  if (!v) { status("That issue or view is not in this project (deleted, or a sheet issue)."); return; }
  await selectIssue(id);
}

/* Picks an issue out as a click on it in the list does. Waits for the
   models to finish loading first: the loader's own "back where you left
   off" / fit-all runs when they do, and it used to throw the camera back
   out a moment after it had flown in. */
async function selectIssue(id) {
  let it = null;
  for (let i = 0; i < 900; i++) {            // up to 3 minutes on a big model
    it = S.items.find((x) => x.id === id);
    if (it && S.modelsReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!it) { status("That issue is not in this project (deleted, or a sheet issue)."); return false; }
  const find = () => document.querySelector(`#i3-list li[data-id="${CSS.escape(id)}"]`);
  if (!find()) {
    // hidden by a search or a closed group: clear both
    const q = $("#i3-search"); if (q) q.value = "";
    i3Closed.clear();
    renderIssueList();
  }
  const li = find();
  if (!li) return false;
  li.scrollIntoView({ block: "center" });
  li.click();
  return true;
}

async function gotoFromUrl() {
  const q = new URLSearchParams(location.search);
  const at = q.get("at");
  if (!at) return;
  const mm = at.split(",").map(Number);
  if (mm.length !== 3 || mm.some((n) => !isFinite(n))) return;

  jumpVeil(true, "Opening the issue location ...");
  try {
    /* The host and the floors are all the jump needs. The typical-floor
       copies keep loading behind it, so the room can fill in over a few
       moments rather than the veil waiting for all of them. */
    /* A fast 3D export without model boxes (exported before they were
       written): the section box needs every model in to be measured. */
    const needAll = () => lwkFrame() && !manifestHasBoxes() && !S.modelsReady;
    for (let i = 0; i < 900 && (!(firstHostPart() && S.floorRows && S.floorRows.length) || needAll()); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const p = internalToScene(mm);
    if (!p) { status("Could not place the point from the sheet."); return; }
    const idx = levelIndexAt(p.y + 0.5);
    focusRoom(p, idx);
    // let the first frame of the room render before the veil lifts
    await new Promise((r) => setTimeout(r, 120));

    placeGotoMarker(p);

    const fromSheet = q.get("sheet");
    if (fromSheet) {
      try { localStorage.setItem("lwk-viewer:last-sheet:" + (Store.currentProject() || "default"), fromSheet); } catch (e) {}
    }
    const label = q.get("label");
    status(`From ${label || "the sheet"}: ${levelAt(p.y + 0.5) || "no floor found"}. `
      + "The orange ring marks the point. Reset the section box to see the whole building.");
  } finally {
    jumpVeil(false);
  }
}

/* The marker for a point sent from a sheet: a ring and a stalk, drawn over
   everything. */
function placeGotoMarker(p) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xf28022, side: THREE.DoubleSide,
                                    depthTest: false, transparent: true, opacity: 0.95 }));
    ring.rotation.x = -Math.PI / 2;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 10),
      new THREE.MeshBasicMaterial({ color: 0xf28022, depthTest: false }));
    stalk.position.y = 1.1;
    g.add(ring); g.add(stalk);
    g.position.copy(p);
    g.renderOrder = 998;
    if (S.gotoMarker) S.overlay.remove(S.gotoMarker);
    S.gotoMarker = g;
    S.overlay.add(g);
    S.dirty = true;
}

function sceneToInternalMM(v) {
  const g = sceneToOriginal(v);                      // scene -> shared, Y-up
  const shared = new THREE.Vector3(g.x, -g.z, g.y);  // Y-up -> Z-up
  const m = projectLocationMatrix();
  // Undecided means the probe was not usable; the shared value is returned
  // unchanged rather than mangled by an arbitrary guess.
  if (m) shared.applyMatrix4(m);
  // The site elevation the IFC carries but the project location does not
  // (see calibrateHeights). Zero until calibrated.
  shared.z += (S.zAdj || 0) / 1000;
  return [toMM(shared.x), toMM(shared.y), toMM(shared.z)];
}

/* Shared (survey) coordinates, Z-up, in millimetres. These match what Revit
   reports for a Spot Coordinate, which is how the chain was verified. */
function sceneToSharedMM(v) {
  const g = sceneToOriginal(v);
  return [toMM(g.x), toMM(-g.z), toMM(g.y)];
}

/* The issue pin under the pointer (within a finger's width), opened. */
function pinAtScreen(ev) {
  if (!S.pins || !S.pins.children.length) return false;
  const r = S.renderer.domElement.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const lim = ev.pointerType === "touch" ? 22 : 12;
  let best = null, bd = lim;
  const v = new THREE.Vector3();
  const seen = new Set();
  for (const m of S.pins.children) {
    const id = m.userData.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    v.copy(m.position).project(S.camera);
    if (v.z > 1 || v.z < -1) continue;
    const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = id; }
  }
  if (!best) return false;
  selectIssue(best);
  return true;
}

function pinScale() {
  // Pins keep a roughly constant size on screen instead of shrinking away.
  if (S.camera.isOrthographicCamera) {
    return Math.max(0.15, (S.camera.top - S.camera.bottom)
                          / (S.camera.zoom || 1) * 0.012);
  }
  return Math.max(0.15, S.camera.position.distanceTo(S.controls.target) * 0.012);
}

function sizePins() {
  if (!S.pins) return;
  const k = pinScale();
  for (const p of S.pins.children) p.scale.setScalar(k);
}

function issueDone3D(it) {
  const iss = it && it.issue;
  return !!(iss && (iss.dismissed || iss.status === "Resolved" || iss.status === "Closed"));
}
function setHideDone(on) {
  S.hideDone = !!on;
  try { localStorage.setItem("lwk.hideDone", S.hideDone ? "1" : "0"); } catch (e) {}
  const b = document.getElementById("done-toggle");
  if (b) {
    b.classList.toggle("active", S.hideDone);
    b.title = S.hideDone ? "Resolved and closed issues are hidden in the model - click to show them"
      : "Hide resolved and closed issues in the model (the list keeps them; use its status filter)";
  }
  if (S.overlay) { try { refreshPins(); } catch (e) {} }
  S.needsRender = true;
}

function refreshPins() {
  if (S.pins) S.overlay.remove(S.pins);
  if (S.hidePins) { S.pins = null; S.dirty = true; return; }
  S.pins = new THREE.Group();
  S.pins.name = "__pins";
  S.overlay.add(S.pins);

  /* Each pin is drawn twice. A pale copy ignores depth, so a pin is never
     lost behind the building; a solid copy is depth-tested against the
     model, so it only shows where nothing is in front of it. The result:
     a strong pin means "you can see this spot", a faint one means "it is
     on the other side". No per-frame raycasting is needed - the depth
     buffer from the model pass answers the question for free. */
  const ball = new THREE.SphereGeometry(1, 16, 12);
  const diamond = new THREE.OctahedronGeometry(1.25, 0);
  S.items.filter(inList3D).forEach((it) => {
    if (S.hideDone && issueDone3D(it)) return;          // "Hide closed"
    const closed = it.issue && it.issue.status === "Closed";
    const hex = closed ? 0x0e9f6e
      : new THREE.Color(typeColor(it)).getHex();
    const pos = issuePoint(it);
    if (!pos) return;
    const geo = in3D(it) ? ball : diamond;

    const ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: hex, depthTest: false, depthWrite: false,
      transparent: true, opacity: 0.28 }));
    ghost.position.copy(pos);
    ghost.renderOrder = 998;
    ghost.userData.id = it.id;

    const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: hex, depthTest: true, depthWrite: false,
      transparent: true, opacity: 1 }));
    solid.position.copy(pos);
    solid.renderOrder = 999;
    solid.userData.id = it.id;

    // A white rim on the solid pin, so it reads against both a pale sky
    // and an orange-rendered wall.
    const rim = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff, depthTest: true, depthWrite: false,
      side: THREE.BackSide }));
    rim.scale.setScalar(1.22);
    solid.add(rim);

    S.pins.add(ghost);
    S.pins.add(solid);
  });
  sizePins();
}

function openIssue3D(point, hitInfo) {
  S.pending = { point: point.clone(), hit: hitInfo };
  status("Placing issue at "
    + [point.x, point.y, point.z].map((n) => n.toFixed(2)).join(", ") + " m");
  const mm = [toMM(point.x), toMM(point.y), toMM(point.z)];
  S.pending.level = levelAt(point.y);
  $("#i3-anchor").textContent =
    (S.pending.level ? "Level " + S.pending.level + "\n" : "")
    + "Model " + mm.map(function (n) { return n.toFixed(0); }).join(", ") + " mm"
    + (hitInfo && hitInfo.guid ? "\nIFC GUID " + hitInfo.guid : "")
    + (hitInfo && hitInfo.name ? "\nIn " + hitInfo.name : "");
  $("#i3-title").value = "";
  $("#i3-desc").value = "";
  // The kind of issue, as on the sheets (clash, design, ...), last one kept.
  $("#i3-type").innerHTML = typeOptions(S.lastIssueType || "general");

  // Taken now, before the dialog covers the view.
  S.pending.shot = captureViewpoint();
  S.pending.markup = [];
  $("#i3-thumb").src = S.pending.shot.image;
  $("#i3-markup-count").textContent = "";

  $("#i3-back").hidden = false;
  $("#i3-title").focus();
}

async function saveIssue3D() {
  const title = $("#i3-title").value.trim();
  if (!title) { $("#i3-title").focus(); return; }
  const p = S.pending;
  if (!p) return;

  $("#i3-save").disabled = true;
  status("Saving ...");

  /* The picture is uploaded first and the record keeps only its path.
     Holding the data URL in the record is what used to fill the browser's
     storage after a dozen issues. */
  let snapshot = p.flat || (p.shot ? p.shot.image : null);
  /* With markup drawn on it, the clean picture is kept as well: the markup
     can then be edited again later (the saved picture has it baked in). */
  let snapshotRaw = null;
  try {
    snapshot = await Store.uploadSnapshot(snapshot);
    if (p.flat && p.shot && (p.markup || []).length) snapshotRaw = await Store.uploadSnapshot(p.shot.image);
  } catch (e) {
    status("Snapshot upload failed, saving the issue without it: " + e.message);
    snapshot = null;
  }

  const item = {
    id: uid(),
    placement: "3d",
    model_mm: [toMM(p.point.x), toMM(p.point.y), toMM(p.point.z)],
    model_original_mm: originalMM(p.point),
    model_internal_mm: sceneToInternalMM(p.point),
    model_shared_mm: sceneToSharedMM(p.point),
    ifc_guid: (p.hit && p.hit.guid) || null,
    model_name: (p.hit && p.hit.name) || null,
    // the Revit element it is about: its ids for Revit (Select by ID, the add-in, BCF)
    element: (p.hit && elementInfo(p.hit.part, p.hit.localId, p.hit.guid)) || null,
    created_at: new Date().toISOString(),
    viewpoint: p.shot ? p.shot.camera : null,
    /* the section box, plane, hidden elements, projection and floor in force
       when the issue was raised - "Show in view" puts them all back. The
       picture's camera alone was kept before, so a sectioned issue opened
       on the outside of the building. */
    viewpoint_state: p.shot ? p.shot.state : null,
    snapshot: snapshot,
    snapshot_raw: snapshotRaw,
    markup: p.markup || [],
    issue: {
      guid: uid(), title: title,
      type: $("#i3-type").value || "general",
      description: $("#i3-desc").value.trim(),
      status: $("#i3-status").value,
      priority: $("#i3-priority").value,
      assigned_to: $("#i3-assignee").value.trim(),
      due_date: $("#i3-due").value || null,
      created_at: new Date().toISOString(),
      author: Store.author(),
      // Worked out from where it was placed - nobody has to type it.
      level: p.level || null,
    },
    level: p.level || null,
  };

  S.lastIssueType = item.issue.type;
  const ok = await putItem(item);
  $("#i3-save").disabled = false;
  if (!ok) return;

  S.pending = null;
  $("#i3-back").hidden = true;
  status("Issue saved and shared.");
  refreshPins();
  renderIssueList();
}

/* How the 3D issue list is arranged. Status first, because the question a
   coordinator opens this panel with is "what is still open". */
const I3_GROUPERS = {
  status: { of: (it) => (it.issue && it.issue.status) || "Open" },
  level: { of: (it) => levelOf(it) || "No floor" },
  issuetype: { of: (it) => typeOf(it).label },
  assignee: { of: (it) => (it.issue && it.issue.assigned_to) || "Unassigned" },
  author: { of: (it) => it.author || "Unknown" },
  model: { of: (it) => (in3D(it) ? it.model_name || "Unknown model" : "Sheet " + it.sheet) },
  none: { of: () => "All" },
};

const I3_STATUS_CLASS = {
  "Open": "open", "In progress": "progress",
  "Resolved": "resolved", "Closed": "closed",
};

const i3Closed = new Set();

function statusMatches3D(iss, f) {
  const stt = iss.status || "Open";
  if (f === "open-any") return stt === "Open" || stt === "In progress";
  if (f === "done-any") return stt === "Resolved" || stt === "Closed";
  if (f === "query") return (iss.comments || []).some((c) => c && c.kind === "query" && !c.resolved && !c.deleted);
  return stt === f;
}

function renderIssueList() {
  const ul = $("#i3-list");
  ul.innerHTML = "";

  const mine = S.items.filter(inList3D);
  const q = (($("#i3-search") || {}).value || "").trim().toLowerCase();
  const groupBy = (($("#i3-group") || {}).value) || "status";
  const grouper = I3_GROUPERS[groupBy] || I3_GROUPERS.status;

  /* Numbers follow creation order, not the current grouping, so a number
     quoted in a meeting keeps meaning the same issue after someone
     regroups the list. */
  const numbers = new Map();
  let n = 0;
  for (const it of mine) numbers.set(it.id, (it.issue && it.issue.number) || ++n);

  const fType = (($("#i3-ftype") || {}).value) || "";
  const fStatus = (($("#i3-fstatus") || {}).value) || "";
  const shown = mine.filter((it) => {
    if (fType && (!it.issue || typeOf(it).id !== fType)) return false;
    if (fStatus && (!it.issue || !statusMatches3D(it.issue, fStatus))) return false;
    if (!q) return true;
    const hay = [it.issue && it.issue.title, it.issue && it.issue.description,
                 it.issue && it.issue.assigned_to, it.model_name, it.author]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  });

  $("#i3-count").textContent = mine.length
    ? "(" + (shown.length === mine.length ? mine.length
             : shown.length + " of " + mine.length) + ")" : "";

  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = mine.length ? "Nothing matches this search."
      : "No issues in 3D yet. Switch to Add issue and click the model.";
    ul.appendChild(li);
    return;
  }

  const groups = new Map();
  for (const it of shown) {
    const k = grouper.of(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const sortBy = (($("#i3-sort") || {}).value) || "number";
  const when = (it) => (it.issue && it.issue.created_at) || it.created_at || "";
  const cmp = {
    number: (a, b) => (numbers.get(a.id) || 0) - (numbers.get(b.id) || 0),
    newest: (a, b) => String(when(b)).localeCompare(String(when(a))),
    oldest: (a, b) => String(when(a)).localeCompare(String(when(b))),
    due: (a, b) => String((a.issue && a.issue.due_date) || "9999").localeCompare(String((b.issue && b.issue.due_date) || "9999")),
    updated: (a, b) => String((b.issue && b.issue.updated_at) || when(b)).localeCompare(String((a.issue && a.issue.updated_at) || when(a))),
  }[sortBy] || null;
  if (cmp) for (const rowsOf of groups.values()) rowsOf.sort(cmp);
  for (const key of Array.from(groups.keys()).sort()) {
    const rows = groups.get(key);
    if (groupBy !== "none") {
      const head = document.createElement("li");
      const closed = i3Closed.has(key);
      head.className = "grp-head" + (closed ? " closed" : "");
      head.innerHTML = `<span class="caret">&#9662;</span>${key}`
        + `<span class="count">${rows.length}</span>`;
      head.addEventListener("click", () => {
        if (i3Closed.has(key)) i3Closed.delete(key); else i3Closed.add(key);
        renderIssueList();
      });
      ul.appendChild(head);
      if (closed) continue;
    }

    for (const it of rows) {
      const li = document.createElement("li");
      li.dataset.id = it.id;
      // the list is rebuilt whenever an issue changes: keep the one open marked
      if (it.id === S.selIssueId) li.classList.add("sel");
      const st = (it.issue && it.issue.status) || "Open";
      const thumb = it.snapshot
        ? `<div class="thumb" style="background-image:url('${it.snapshot}')"></div>`
        : `<div class="thumb"></div>`;
      const tc = typeColor(it);
      const when = shortDate((it.issue && it.issue.created_at) || it.created_at);
      const title = String((it.issue && it.issue.title) || "Issue").replace(/</g, "&lt;");
      const who = String((it.issue && it.issue.author) || it.author || "").replace(/</g, "&lt;");
      const bits = [in3D(it) ? "" : "Sheet " + String(it.sheet).replace(/</g, "&lt;"),
                    typeOf(it).label, levelOf(it), who, when].filter(Boolean).join(" &middot; ")
        + (() => {
          const msgs = ((it.issue && it.issue.comments) || []).filter((c) => c && !c.deleted);
          const oq = msgs.filter((c) => c.kind === "query" && !c.resolved).length;
          return msgs.length ? ` <span class="talk${oq ? " q" : ""}">&#128172; ${msgs.length}${oq ? " ?" + oq : ""}</span>` : "";
        })();
      li.innerHTML = `<div class="card compact" title="${title.replace(/"/g, "&quot;")}">`
        + `<span class="pin" style="background:${tc}">${numbers.get(it.id)}</span>`
        + `<div class="body"><div class="t">${title}</div><div class="tline">${bits}</div></div>`
        + `<span class="chip ${I3_STATUS_CLASS[st] || "open"}">${st}</span></div>`;

      const jump = () => goToIssueView(it);
      li.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        openMenu(ev.clientX, ev.clientY, issueMenu3D(it, () => li.click(), jump));
      });
      li.addEventListener("click", () => {
        ul.querySelectorAll("li.sel").forEach((x) => x.classList.remove("sel"));
        li.classList.add("sel");
        S.selIssueId = it.id;
        jump();
        openIssue(it, {
          docked: true,
          latest: () => Store.all().find((x) => x.id === it.id),
          number: numbers.get(it.id),
          author: Store.author(),
          onUpload: (dataUrl) => Store.uploadSnapshot(dataUrl),
          onSave: async (item) => { await putItem(item); refreshPins(); renderIssueList(); },
          onDelete: async (item) => {
            await Store.remove(item.id).catch((e) => status(e.message));
            S.items = Store.all(); refreshPins(); renderIssueList();
          },
          onJump: jump,
          level: levelOf(it),
          // a new picture (and camera) from the 3D view as it is now
          onResnap: it.placement === "3d" ? async (item) => {
            const shot = captureViewpoint();
            if (!shot || !shot.image) return false;
            item.snapshot = await Store.uploadSnapshot(shot.image);
            item.viewpoint = shot.camera;
            item.viewpoint_state = shot.state;
            item.markup = [];     // drawn on the old picture
            item.snapshot_raw = null;
            return true;
          } : null,
          // the markup on the picture, edited again after the issue was saved
          onEditSnapshot: (item) => editSavedSnapshot(item),
          resnapHint: "Take the picture again from the 3D view as it shows now - it also becomes the issue's saved view",
        });
      });
      ul.appendChild(li);
    }
  }
}

async function signIn() {
  const back = document.getElementById("gate-back");
  const msg = document.getElementById("gate-msg");

  let info = null;
  try {
    info = await Store.ping();
  } catch (e) {
    back.hidden = false;
    msg.textContent = e.message;
    throw e;
  }

  if (Store.restoreSession()) {
    try {
      await Store.validate();
      back.hidden = true;
      return;
    } catch (e) { /* stale token: fall through to the form */ }
  }

  if (!info.needs_passphrase) {
    await Store.login("", localStorage.getItem("lwk-viewer:name") || "");
    back.hidden = true;
    return;
  }

  back.hidden = false;
  document.getElementById("gate-name").value =
    localStorage.getItem("lwk-viewer:name") || "";
  // The server no longer reports one issue count: issues belong to projects.
  msg.textContent = info.single ? "Sign in to open the project."
    : (info.projects || 0) + " project(s) on this server.";

  await new Promise((resolve) => {
    const go = async () => {
      const btn = document.getElementById("gate-go");
      btn.disabled = true;
      msg.textContent = "Signing in ...";
      const pass = document.getElementById("gate-pass").value;
      const name = document.getElementById("gate-name").value.trim();
      try {
        await Store.login(pass, name);
        await Store.validate();
        back.hidden = true;
        resolve();
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };
    document.getElementById("gate-go").addEventListener("click", go);
    document.getElementById("gate-pass").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); go(); }
    });
  });
}

function connStatus(ok, err) {
  const el = document.getElementById("conn");
  if (!el) return;
  const queued = Store.pendingCount();
  el.classList.toggle("ok", !!ok && !queued);
  if (!ok) el.textContent = "offline" + (err ? ": " + err : "");
  else if (queued) el.textContent = queued + " waiting to save";
  else el.textContent = "online" + (Store.author() ? " - " + Store.author() : "");
}

/* ----------------------------------------------------------------- boot */

/* Phones, and tablets held upright: the 3D view takes the whole screen.
   The Models panel and the Selection / Issues panel slide in over it from
   the left and the right (buttons at the top left of the view), and a tap
   on the view closes them. Three columns side by side left the model a
   strip in the middle, and on a phone held upright the list of models was
   cut off above the view. */
function setupDrawers() {
  const mq = matchMedia("(max-width: 900px), (max-height: 500px)");
  const wrap = document.getElementById("canvas-wrap");
  const models = document.getElementById("models"), inspect = document.getElementById("inspect");
  if (!wrap || !models || !inspect) return;
  const bar = document.createElement("div");
  bar.id = "drawer-btns";
  bar.innerHTML = `<button id="dr-models" title="Models, section, measure, display">&#9776; Models</button>`
    + `<button id="dr-info" title="Selection and issues">&#9432; Details<i class="dot" hidden></i></button>`;
  wrap.appendChild(bar);
  const scrim = document.createElement("div");
  scrim.id = "drawer-scrim";
  scrim.hidden = true;
  document.body.appendChild(scrim);
  const close = () => {
    models.classList.remove("open"); inspect.classList.remove("open");
    scrim.hidden = true;
  };
  const open = (el) => {
    const was = el.classList.contains("open");
    close();
    if (was) return;
    el.classList.add("open");
    scrim.hidden = false;
    if (el === inspect) bar.querySelector(".dot").hidden = true;
  };
  bar.querySelector("#dr-models").addEventListener("click", (e) => { e.stopPropagation(); open(models); });
  bar.querySelector("#dr-info").addEventListener("click", (e) => { e.stopPropagation(); open(inspect); });
  scrim.addEventListener("click", close);
  scrim.addEventListener("touchstart", (e) => { e.preventDefault(); close(); }, { passive: false });
  const hdr = document.querySelector("header");
  // beside a sheet (2D + 3D) there is room for the view only: the Models
  // panel comes in over it, so linked models can be switched on and off
  if (EMBED) bar.querySelector("#dr-info").hidden = true;
  const apply = () => {
    const on = mq.matches || EMBED;
    document.body.classList.toggle("drawers", on);
    if (!on) close();
    if (hdr) document.documentElement.style.setProperty("--hdr-h", (EMBED ? 0 : hdr.offsetHeight) + "px");
    requestAnimationFrame(() => dispatchEvent(new Event("resize")));
  };
  if (mq.addEventListener) mq.addEventListener("change", apply); else mq.addListener(apply);
  addEventListener("orientationchange", () => setTimeout(apply, 250));
  apply();
  /* Something was picked while the panel is closed: a dot on Details. */
  S.drawerNote = () => {
    if (document.body.classList.contains("drawers") && !inspect.classList.contains("open")) {
      bar.querySelector(".dot").hidden = false;
    }
  };
  S.closeDrawers = close;
}

async function boot() {
  try { setupDrawers(); } catch (e) { console.warn("drawers", e); }
  try { initPanels({ layout: document.getElementById("layout3d"), left: document.getElementById("models"), right: document.getElementById("inspect"), key: "model" }); } catch (e) { console.warn("panels", e); }
  try { initVGrip({ el: document.getElementById("inspect-body"), key: "model-selection", def: 0.45 }); } catch (e) { console.warn("vgrip", e); }
  try { wireModelBrowser(); } catch (e) { console.warn("browser", e); }
  try { attachTemplates(Store, document.getElementById("i3-dlg"), "i3"); } catch (e) { console.warn("templates", e); }
  // Before anything calls into store.js: a stale copy is reported by name
  // rather than failing on the first missing function.
  {
    const stale = Check.checkModules(Store);
    if (stale.length) { Check.report(stale); return; }
  }
  /* Say what is broken before trying to use it. Three separate releases
     have shipped with a function accidentally removed by an edit, each
     failing with a ReferenceError that named a line number and nothing
     else. */
  const problems = Check.checkPage("model", [])
    .concat(Check.checkFunctions({
      signIn, connStatus, setMode, initScene, initFragments, loadItems,
      refreshPins, renderIssueList, renderModelList, applySection,
      sectionFromFace, alignSectionToFace, flipFace, resetSection,
      openSnapshotEditor, captureViewpoint, pickAt, highlight,
      showProperties, propValue, psetBlock,
      saveView, restoreView, renderViewList, hideSelected, isolateSelected,
      showAll, applyHidden,
    }))
    .concat(await Check.checkServer());
  if (Check.report(problems)) {
    status("Startup check failed - see the bar above.");
    if (problems.some((p) => p.indexOf("function") === 0)) return;
  }

  /* Sign in before anything else. This page wires its controls further
     down, inside boot itself; there are no separate wiring functions here,
     unlike the sheets page. */
  await signIn();
  // A project must be settled before anything is loaded: every file path
  // and every issue request is scoped to it.
  await ensureProject();

  Store.onChange(() => {
    // Someone in another office added or changed something.
    S.items = Store.all();
    const cal = savedCalibration();
    if (cal && isFinite(cal.z_adj_mm) && cal.z_adj_mm !== S.zAdj) {
      S.zAdj = cal.z_adj_mm;
      S.heightNote = `calibrated by hand on ${cal.level} by ${cal.author || "a colleague"}`;
      recomputeFloors();
    }
    refreshPins();
    renderIssueList();
    renderViewList();
    renderDims();
  });
  await Store.start(connStatus);

  try {
    const res = await fetch(Store.dataUrl("manifest.json"));
    if (!res.ok) throw new Error("HTTP " + res.status);
    S.manifest = await res.json();
  } catch (e) {
    status("Could not load manifest.json: " + e.message); return;
  }

  // the project's title from the Projects page (projects.js), when it has one
  if (!$("#project").textContent) $("#project").textContent =
    (S.manifest.source && S.manifest.source.title) || "";

  // a model made from an IFC is not there until the server has converted it
  const converting = (S.manifest.models || []).filter((m) => m.status === "converting");
  const withFrags = (S.manifest.models || []).filter((m) => m.fragments && m.status !== "converting");
  if (converting.length && !withFrags.length) { waitConversion(); return; }
  if (!withFrags.length) {
    status("No fragments in the manifest. Run tools/convert.bat on this "
      + "export folder first.");
    return;
  }

  await initScene();
  try {
    await initFragments();
  } catch (e) {
    status(e.message); return;
  }

  loadItems();
  refreshPins();
  renderIssueList();
  renderViewList();
  renderModelList();
  loadFloors().catch((e) => showError("floors", e));
  gotoFromUrl().catch((e) => { jumpVeil(false); showError("goto", e); });
  selectFromUrl().catch((e) => showError("select", e));
  elementsFromUrl().catch((e) => showError("elements", e));
  wireSelectionButtons();
  if (new URLSearchParams(location.search).get("embed") !== "1") startGoto(Store, async (g) => {
    if (g.kind !== "3d" || (g.project && g.project !== Store.currentProject())) {
      location.href = issueLink(g);
      return;
    }
    await selectIssue(g.id);
  });
  $("#fit3d").addEventListener("click", fitAll);

  $("#m-nav").addEventListener("click", () => setMode("nav"));
  $("#m-issue").addEventListener("click", () => setMode("issue"));
  $("#i3-cancel").addEventListener("click", () => {
    $("#i3-back").hidden = true; S.pending = null;
  });
  // Esc closes the new-issue window (as Cancel) - even from its title field
  addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || $("#i3-back").hidden) return;
    const snap = document.getElementById("snap-back");
    if (snap && !snap.hidden) return;            // the markup editor has Esc
    ev.preventDefault(); ev.stopPropagation();
    $("#i3-cancel").click();
  }, true);
  $("#view-close").addEventListener("click", () => {
    $("#view-back").hidden = true;
  });

  $("#top-test").addEventListener("click", async () => {
    try {
      const box = new THREE.Box3();
      for (const rec of S.loaded.values()) {
        for (const part of rec.parts) {
          const b = worldBox(part);
          if (!b.isEmpty()) box.union(b);
        }
      }
      if (box.isEmpty()) { status("Load a model first."); return; }

      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const centres = {
        internal: sceneToInternalMM(c),
        shared: sceneToSharedMM(c),
      };
      status("Building top view test ...");
      const r = await buildTopTest(centres, Math.max(size.x, size.z),
                                   captureViewpoint().image);
      download(r.blob, "top-view-test.bcfzip");
      status(`Top view test written (${r.count} topics). Open each in Revit: `
        + "one should show the building in plan, the other nothing.");
    } catch (e) {
      status("Top view test failed: " + e.message);
      showError("topTest", e);
    }
  });

  $("#axis-test").addEventListener("click", async () => {
    try {
      const t = S.controls.target;
      const cams = {
        scene: {
          eye: [toMM(S.camera.position.x), toMM(S.camera.position.y),
                toMM(S.camera.position.z)],
          target: [toMM(t.x), toMM(t.y), toMM(t.z)],
        },
        original: {
          eye: originalMM(S.camera.position),
          target: originalMM(t),
        },
        internal: {
          eye: sceneToInternalMM(S.camera.position),
          target: sceneToInternalMM(t),
        },
        shared: {
          eye: sceneToSharedMM(S.camera.position),
          target: sceneToSharedMM(t),
        },
      };
      status("Building axis test ...");
      const shot = captureViewpoint();
      const r = await buildAxisTest(cams, fovOf(), shot.image);
      download(r.blob, "axis-test.bcfzip");
      status(`Axis test written: ${r.count} topics aimed at the current view. `
        + "Open them in Revit and tell Claude which title lands correctly.");
    } catch (e) {
      status("Axis test failed: " + e.message);
      showError("axisTest", e);
    }
  });

  document.getElementById("m-measure").addEventListener("click",
    () => setMode(S.mode === "measure" ? "nav" : "measure"));
  for (const id of ["meas-distance", "meas-angle", "meas-area"]) {
    document.getElementById(id).addEventListener("click", () => {
      const kind = id.replace("meas-", "");
      ensureMeasure().setMode(kind);
      for (const o of ["meas-distance", "meas-angle", "meas-area"]) {
        document.getElementById(o).classList.toggle("active", o === id);
      }
      setMode("measure");
      S.dirty = true;
    });
  }
  S.measOrtho = (() => { try { return localStorage.getItem("lwk.measOrtho") === "1"; } catch (e) { return false; } })();
  const orthoBtn = document.getElementById("meas-ortho");
  if (orthoBtn) {
    orthoBtn.classList.toggle("active", S.measOrtho);
    orthoBtn.addEventListener("click", () => {
      S.measOrtho = !S.measOrtho;
      orthoBtn.classList.toggle("active", S.measOrtho);
      try { localStorage.setItem("lwk.measOrtho", S.measOrtho ? "1" : "0"); } catch (e) {}
      if (S.measure) S.measure.setOrtho(S.measOrtho);
      status(S.measOrtho ? "Straight: the next point stays in line along X, Y or height with the one before (Shift switches it for a moment)."
                         : "Straight off - points go where they snap (hold Shift to keep one straight).");
    });
  }
  document.getElementById("meas-undo").addEventListener("click",
    () => { ensureMeasure().undo(); S.dirty = true; });
  document.getElementById("meas-clear").addEventListener("click",
    () => { ensureMeasure().clear(); S.dirty = true; });

  for (const k of ["top", "front", "back", "left", "right", "iso"]) {
    const b = document.getElementById("pv-" + k);
    if (b) b.addEventListener("click", () => presetView(k));
  }
  document.getElementById("pv-section").addEventListener("click", viewSectionPlane);
  S.depthFx = depthFxDefault();
  syncDepthButton();
  const dfx = document.getElementById("depth-toggle");
  if (dfx) dfx.addEventListener("click", () => setDepthFx(!S.depthFx));
  try { wireDepthSettings(); } catch (e) { console.warn("depth settings", e); }
  for (const b of document.querySelectorAll("#display-modes button")) {
    b.addEventListener("click", () => setDisplay(b.dataset.mode).catch((e) => showError("display", e)));
  }
  S.display = "shaded";
  decorateIcons(document);
  attachPalette(document.getElementById("snap-color"));
  attachPalette(document.getElementById("snap-fill"));
  attachPalette(document.getElementById("snap-tcolor"));
  try { wireDisplay(); } catch (e) { showError("display settings", e); }
  try {
    S.cube = createViewCube({
      THREE: THREE, wrap: document.getElementById("canvas-wrap"),
      getCamera: () => S.camera, getTarget: () => S.controls.target,
      getAlignRad: () => viewAlignDeg() * Math.PI / 180,
      onView: (face, dir) => { if (face) presetView(face); else presetView("custom", dir); },
      onOrbit: orbitBy,
      onHome: () => presetView("iso"),
      makeRenderer: S.gpuMode === "webgpu"
        ? (canvas) => {
          const r = new S.GPU.WebGPURenderer({ canvas, alpha: true, antialias: true,
            forceWebGL: new URLSearchParams(location.search).get("gpugl") === "1" });
          if (S.gpuRT) r.render = () => {};            // tests: never onto the page
          return r;
        } : null,
    });
    /* Projection and "front" live under the cube, where views are chosen,
       instead of taking a panel of their own. The buttons are moved, not
       rebuilt, so everything already wired to them keeps working. */
    const bar = S.cube.bar;
    for (const id of ["pv-ortho", "pv-setalign", "pv-clearalign"]) {
      const el = document.getElementById(id);
      if (el && bar) bar.appendChild(el);
    }
    const lab = document.getElementById("pv-align");
    if (lab && bar) {
      const note = document.createElement("div");
      note.className = "vc-note";
      note.append("Front: ", lab);
      bar.appendChild(note);
    }
  } catch (e) { showError("view cube", e); }
  document.getElementById("cat-all").addEventListener("click", () => {
    catOff().clear();
    try { localStorage.setItem(catKey(), "[]"); } catch (e) {}
    applyCategories().then(renderCategories);
  });
  document.getElementById("meas-keep").addEventListener("click", () => keepDimension().catch((e) => showError("dimension", e)));
  document.getElementById("dims-on").addEventListener("change", (ev) => {
    S.dimsOn = ev.target.checked;
    if (S.dimGroup) S.dimGroup.visible = S.dimsOn;
    S.dirty = true;
  });
  document.getElementById("plan-draw").addEventListener("click", () => {
    S.drawingOn = !S.drawingOn;
    document.getElementById("plan-draw").classList.toggle("active", S.drawingOn);
    if (S.drawingOn && (S.floorIndex === undefined || S.floorIndex === null)) {
      status("Choose a floor in the Floor plan list, and its drawing will be laid over it.");
    }
    updateDrawing();
  });
  document.getElementById("plan-draw-pick").addEventListener("change", (ev) => {
    const c = (S.drawingCands || [])[Number(ev.target.value)];
    if (c) showDrawing(c).catch((e) => showError("drawing", e));
  });
  document.getElementById("floor-select").addEventListener("change", (ev) => {
    const v = ev.target.value;
    if (v === "") document.getElementById("floor-exit").click();
    else goFloor(Number(v));
    ev.target.blur();          // so Page Up / Down go to the floors, not the list
  });
  document.getElementById("floor-cal").addEventListener("click", () => {
    setMode(S.mode === "calibrate" ? "nav" : "calibrate");
  });
  document.getElementById("floor-up").addEventListener("click", () => stepFloor(1));
  document.getElementById("floor-down").addEventListener("click", () => stepFloor(-1));
  document.getElementById("floor-exit").addEventListener("click", () => {
    S.floorIndex = null;
    removeDrawing();
    renderFloors();
    const cb = document.getElementById("sec-on");
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    if (S.ortho) setOrtho(false);
    presetView("iso");
    status("Back to the whole building.");
  });
  document.getElementById("floor-cut").addEventListener("change", () => {
    if (S.floorIndex !== undefined && S.floorIndex !== null) goFloor(S.floorIndex);
  });
  addEventListener("keydown", (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || "")) return;
    // Esc while measuring: the measurement being taken is dropped
    if (ev.key === "Escape" && S.mode === "measure" && S.measure && S.measure.cancel()) {
      S.dirty = true; S.needsRender = true;
      status("Measurement cancelled - click a first point to start again.");
      return;
    }
    if (ev.key === "PageUp") { ev.preventDefault(); stepFloor(1); }
    else if (ev.key === "PageDown") { ev.preventDefault(); stepFloor(-1); }
  });
  document.getElementById("pv-ortho").addEventListener("click",
    () => setOrtho(!S.ortho));
  document.getElementById("pv-setalign").addEventListener("click", () => {
    setMode("viewalign");
    status("Click a wall to set which way Front faces.");
  });
  document.getElementById("pv-clearalign").addEventListener("click",
    () => setViewAlign(0));

  document.getElementById("pins-toggle").addEventListener("click", () => {
    S.hidePins = !S.hidePins;
    const b = document.getElementById("pins-toggle");
    b.classList.toggle("active", !S.hidePins);
    b.textContent = S.hidePins ? "Show issues" : "Hide issues";
    refreshPins();
    status(S.hidePins ? "Issue markers hidden. Nothing was deleted."
                      : "Issue markers shown.");
  });
  document.getElementById("pins-toggle").classList.add("active");
  try { S.hideDone = localStorage.getItem("lwk.hideDone") === "1"; } catch (e) {}
  const dt = document.getElementById("done-toggle");
  if (dt) { dt.addEventListener("click", () => { setHideDone(!S.hideDone);
    status(S.hideDone ? "Resolved and closed issues hidden in the model. Nothing was deleted." : "All issues shown in the model."); });
    setHideDone(S.hideDone); }

  document.getElementById("view-save").addEventListener("click", saveView);
  document.getElementById("vis-hide").addEventListener("click", hideSelected);
  document.getElementById("vis-isolate").addEventListener("click", isolateSelected);
  document.getElementById("vis-show").addEventListener("click", showAll);
  updateVisButtons();

  const i3t = document.getElementById("i3-ftype");
  if (i3t) i3t.insertAdjacentHTML("beforeend", typeOptions("").replace(/ selected/g, ""));
  for (const id of ["i3-group", "i3-ftype", "i3-fstatus", "i3-sort"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    try { const v = localStorage.getItem("lwk.list3d." + id); if (v !== null && [...el.options].some((o) => o.value === v)) el.value = v; } catch (e) {}
    el.addEventListener("change", () => { try { localStorage.setItem("lwk.list3d." + id, el.value); } catch (e) {} });
  }
  for (const id of ["i3-group", "i3-search", "i3-ftype", "i3-fstatus", "i3-sort"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderIssueList);
  }

  $("#export-bcf").addEventListener("click", async () => {
    try {
      status("Building BCF ...");
      const name = (S.manifest.source && S.manifest.source.title) || "issues";
      const r = await buildBcf(S.items, name);
      download(r.blob, `${name.replace(/[^\w.-]/g, "_")}.bcfzip`);
      status(`Exported ${r.count} issue(s): ${r.withCamera} with a camera `
        + `(${r.withDerivedCamera} derived from a sheet viewport), `
        + `${r.withSnapshot} with a snapshot`
        + (r.skipped ? `, ${r.skipped} comment(s) skipped` : "")
        + (r.onFallback
            ? `. WARNING: ${r.onFallback} topic(s) predate the coordinate fix `
              + "and will be misplaced - raise them again."
            : "."));
    } catch (e) {
      status("BCF export failed: " + e.message);
      showError("bcf", e);
    }
  });
  $("#i3-save").addEventListener("click", saveIssue3D);
  const shBox = document.getElementById("i3-sheet");
  if (shBox) {
    shBox.checked = !!S.showSheetIssues;
    shBox.addEventListener("change", () => {
      S.showSheetIssues = shBox.checked;
      try { localStorage.setItem("lwk-viewer:sheet-issues-3d", shBox.checked ? "1" : "0"); } catch (e) {}
      refreshPins(); renderIssueList();
    });
  }
  /* BCF in one header button: a small menu with its two actions */
  const bm = document.getElementById("bcf-menu");
  if (bm) bm.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const r = bm.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, [
      { label: "Export BCF - download the issues", action: () => $("#export-bcf").click() },
      { label: "Import BCF - bring issues in ...", action: () => {
        // the coordinates picker opens under the BCF button
        const ib = $("#import-bcf");
        ib.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const pick = document.getElementById("bcf-frame-pick");
        if (pick) { pick.style.left = Math.min(innerWidth - 300, r.left) + "px"; pick.style.top = (r.bottom + 4) + "px"; }
      } },
    ]);
  });
  const bcfIn = document.getElementById("import-bcf-file");
  if (bcfIn) {
    /* Which coordinates the file is in: worked out (the default), or said.
       A file from Revit or this viewer is in Revit's internal frame; one
       from an IFC tool (Solibri, some Navisworks set-ups) often in shared
       (survey) coordinates. */
    let frame = "auto";
    $("#import-bcf").addEventListener("click", (ev) => {
      const old = document.getElementById("bcf-frame-pick");
      if (old) { old.remove(); return; }
      const box = document.createElement("div");
      box.id = "bcf-frame-pick";
      const r = ev.target.getBoundingClientRect();
      box.style.left = Math.min(innerWidth - 300, r.left) + "px";
      box.style.top = (r.bottom + 4) + "px";
      box.innerHTML = `<div class="lp-head">Import BCF - the file's coordinates</div>`
        + `<label><input type="radio" name="bcf-frame" value="auto" checked> Work it out (recommended)</label>`
        + `<label><input type="radio" name="bcf-frame" value="internal"> Revit internal (from Revit add-ins, this viewer)</label>`
        + `<label><input type="radio" name="bcf-frame" value="shared"> Shared / survey (from IFC tools)</label>`
        + `<div class="lp-foot"><button class="ghost" data-a="cancel">Cancel</button><button data-a="go">Choose file ...</button></div>`;
      document.body.appendChild(box);
      box.addEventListener("click", (e) => {
        const a = e.target.dataset && e.target.dataset.a;
        if (!a) return;
        if (a === "go") {
          frame = (box.querySelector("input[name=bcf-frame]:checked") || {}).value || "auto";
          bcfIn.click();
        }
        box.remove();
      });
    });
    bcfIn.addEventListener("change", async () => {
      const f = bcfIn.files && bcfIn.files[0];
      bcfIn.value = "";
      if (!f) return;
      try { await importBcf(await f.arrayBuffer(), f.name, frame); }
      catch (e) { status("BCF import failed: " + e.message); showError("bcf import", e); }
    });
  }

  $("#i3-markup").addEventListener("click", () => {
    if (!S.pending || !S.pending.shot) return;
    openSnapshotEditor(S.pending.shot, (items) => {
      if (!items) return;
      S.pending.markup = items;
      $("#i3-markup-count").textContent =
        items.length ? `${items.length} markup(s)` : "";
      flatten(S.pending.shot, items).then((url) => {
        S.pending.flat = items.length ? url : null;
        $("#i3-thumb").src = url;
      }).catch((e) => showError("flatten", e));
    }, S.pending.markup);
  });

  initSection();
  $("#sec-on").addEventListener("change", (ev) => {
    S.section.on = ev.target.checked;
    if (S.section.on) S.section.box = projectBox();
    applySection();
    // Handles belong to a live cut. With the section off they point at
    // nothing and only get in the way of picking.
    if (!S.section.on) {
      if (S.arrows) S.arrows.clear();
      if (S.section.helper) { S.overlay.remove(S.section.helper); S.section.helper = null; }
      if (S.section.faceHelper) { S.overlay.remove(S.section.faceHelper); S.section.faceHelper = null; }
      S.section.face = null;
      S.renderer.clippingPlanes = [];
      scheduleCutLines(0);
      S.dirty = true;
    }
  });
  for (const id of ["sx0", "sx1", "sy0", "sy1", "sh0", "sh1", "srot"]) {
    document.getElementById(id).addEventListener("input", applySection);
  }
  $("#sec-reset").addEventListener("click", resetSection);
  // the cut filled (poché) and the plan look: remembered on this device
  for (const [id, key, prop] of [["sec-poche", "lwk.poche", "poche"], ["sec-planlook", "lwk.planlook", "planLook"]]) {
    const cb = document.getElementById(id);
    if (!cb) continue;
    cb.checked = !!S[prop];
    cb.addEventListener("change", () => {
      S[prop] = cb.checked;
      try { localStorage.setItem(key, cb.checked ? "1" : "0"); } catch (e) {}
      scheduleCutLines(0);
      S.needsRender = true; S.dirty = true;
    });
  }
  $("#sec-face").addEventListener("click", () => {
    setMode(S.mode === "face" ? "nav" : "face");
  });
  $("#sec-align").addEventListener("click", () => {
    setMode(S.mode === "align" ? "nav" : "align");
  });
  $("#sec-flip").addEventListener("click", flipFace);

  $("#xf-toggle").addEventListener("change", async (ev) => {
    S.applyTransforms = ev.target.checked;
    const names = [...S.loaded.keys()];
    for (const n of names) await unloadModel(n);
    for (const n of names) {
      const entry = (S.manifest.models || []).find((m) => m.name === n);
      if (entry) await loadModel(entry);
    }
    await fitAll();
    status(S.applyTransforms
      ? "Link transforms applied."
      : "Link transforms IGNORED - models shown in their own coordinates.");
  });
  $("#all-on").addEventListener("click", () => loadAll(true));
  const lightBox = document.getElementById("light-on");
  if (lightBox) {
    lightBox.checked = !!S.light;
    lightBox.addEventListener("change", async () => {
      S.light = lightBox.checked;
      try { localStorage.setItem("lwk.light", S.light ? "1" : "0"); } catch (e) {}
      for (const rec of S.loaded.values()) {
        if (!rec.places || rec.places.length <= LIGHT_KEEP || !rec.buf) continue;
        if (S.light) {
          rec.light = true;
          if (!rec.calib) calibrateCopies(rec);
        } else {
          await loadAllCopies(rec);
        }
      }
      if (S.light) typicalSoon(true);
      status(S.light ? "Light mode: typical floors load near the view."
                     : "Light mode off: every floor is loaded.");
    });
  }
  $("#all-off").addEventListener("click", () => loadAll(false));

  /* Every model, every time. Remembering the last selection meant that
     arriving from a sheet ("Show in 3D") could open with the typical floors,
     or everything, switched off. Unticking still works for the session.
     The host goes first: the typical-floor copies are placed from its frame. */
  const wanted = withFrags.slice().sort((a, b) =>
    (a.role === "host" ? 0 : 1) - (b.role === "host" ? 0 : 1));

  status(`Loading all ${withFrags.length} model(s) ...`);

  /* Light mode with the building exported link by link: on a phone or a
     tablet only the host and the linked models near the view load at
     first; the rest follow as the view moves (ensureLinks). The whole of a
     large project at once is what ran Safari out of memory. */
  S.lazyLinks = [];
  /* Arriving from a sheet (or an issue): the linked models round that spot
     first, the rest after - on a computer in the background once the view
     is there, on a tablet only as the view moves towards them. */
  const jq = new URLSearchParams(location.search);
  const jumpMode = !!(jq.get("at") || jq.get("select"));
  /* A tablet has a memory budget: past it, further linked models are left
     for the user to tick (Safari reloads the page, then switches 3D off for
     the site, when a page takes more). Megabytes as downloaded. */
  const budgetMB = S.lowMemory ? 24 : Infinity;
  let usedMB = 0;
  const leftOut = [];
  /* Host first; after that, if the sheet beside us (2D + 3D) or an issue
     has asked for a spot, the linked model round that spot next. */
  const queue = wanted.filter(Boolean);
  while (queue.length) {
    let qi = 0;
    if (S.priorityMM && queue[0].role !== "host") {
      let best = Infinity;
      queue.forEach((q, i) => {
        const b = linkBox(q);
        const d = b ? distToBox(S.priorityMM, b) : Infinity;
        if (d < best) { best = d; qi = i; }
      });
    }
    const m = queue.splice(qi, 1)[0];
    if ((S.light || jumpMode) && m.role === "link" && linkBox(m)) { S.lazyLinks.push(m); continue; }
    if (m.format === "lwkm" && m.role === "link") {
      /* With phone copies the budget is what is actually built (triangles);
         without them, the size of the whole files. */
      const recs = [...S.loaded.values()].filter((r) => r.lwk && r.parts[0]);
      if (S.tiles && m.tiles) {
        // streamed: the memory budget of the tile stream decides, not the file size
      } else if (S.lowMemory && recs.some((r) => r.mobile)) {
        const built = recs.reduce((t, r) => t + r.parts[0].model.stats().triangles, 0);
        if (built > PHONE_TRIS) { leftOut.push(m); continue; }
      } else {
        const mb = Number(m.fragments_mb) || 0;
        if (usedMB + mb > budgetMB && usedMB > 0) { leftOut.push(m); continue; }
        usedMB += mb;
      }
    }
    const box = document.querySelector(
      "#" + CSS.escape("m_" + m.name.replace(/\W/g, "_")));
    if (!box || box.checked) continue;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    // the next one down the wire while this one is built
    const nextUp = queue.find((q) => q.format === "lwkm" && !(S.light && q.role === "link" && linkBox(q)));
    if (nextUp) lwkPrefetch(nextUp);
    /* One at a time, host first. fragments lines every model up with
       whichever finished loading FIRST, so loading in parallel let the small
       typical floor win the race some days and the host on others - and the
       frame everything is measured in changed with it. */
    await new Promise((r) => setTimeout(r, 0));
    try { await box._loading; } catch (e) { /* reported by the handler */ }
  }
  S.modelsReady = true;
  // consultant models and overlays (refs.py), after the project's own
  initRefs().catch((e) => showError("refs", e));
  // from the sheets page's Files window: "Issues from BCF"
  if (new URLSearchParams(location.search).get("importbcf") === "1") {
    const ib = document.getElementById("import-bcf"), bm = document.getElementById("bcf-menu");
    if (ib && bm) {
      ib.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const r = bm.getBoundingClientRect(), pick = document.getElementById("bcf-frame-pick");
      if (pick) { pick.style.left = Math.min(innerWidth - 300, r.left) + "px"; pick.style.top = (r.bottom + 4) + "px"; }
    }
  }
  // back from switching WebGL / WebGPU: the same view as before
  try {
    const v = JSON.parse(sessionStorage.getItem("lwk.gpuView") || "null");
    if (v) {
      sessionStorage.removeItem("lwk.gpuView");
      S.camera.position.fromArray(v.p); S.controls.target.fromArray(v.t); S.controls.update();
      S._camKey = null;
      status(S.gpuMode === "webgpu" ? `Drawing with WebGPU (trial) - ${S.gpuBackend}. Compare the fps in Performance.`
        : "Drawing with WebGL (standard).");
    }
  } catch (e) {}
  // sheet issues can be placed now that the model is (issuePoint)
  try { refreshPins(); renderIssueList(); } catch (e) { /* not ready */ }
  try { renderModelBrowser(); } catch (e) { console.warn("browser", e); }
  if (!S.lowMemory && !jumpMode && !leftOut.length && !S.lazyLinks.length) {
    setTimeout(() => computeExterior().catch((e) => showError("seen from outside", e)), 6000);
  }
  if (leftOut.length) {
    status(`${leftOut.length} linked model(s) not loaded, to stay within this device's memory: `
      + "tick them in the Models panel to add them (untick others first).");
  }
  if (S.lazyLinks.length) {
    // wait for the jump to put the camera at the spot, then load round it
    if (jumpMode) await new Promise((r) => setTimeout(r, 400));
    await ensureLinks(true);
    if (jumpMode && !S.light) setTimeout(loadRestOfLinks, 4000);
  }
  S.perf.allReadyAt = performance.now();
  renderPerf();
  Tele.note(`all models ready at ${(performance.now() / 1000).toFixed(1)} s`);
  if (S.notPrepared && S.notPrepared.length) {
    setTimeout(() => status(`${S.notPrepared.length} model(s) not prepared for phones and tablets yet `
      + `(${S.notPrepared.join(", ")}) - left out so the page does not run out of memory. `
      + "The server is preparing them; open the page again in a few minutes."), 2500);
  }
  Tele.ready();
  /* Arriving from a sheet, the camera belongs to the jump: fitting the
     whole building here is an animated move, and it would carry the view
     back out of the room it had just been placed in. */
  const uq = new URLSearchParams(location.search);
  if (!uq.get("at") && !uq.get("select")) {
    if (!restoreLastView()) await fitAll();
  }
  // keep the view, so coming back from the sheets finds it again
  setInterval(rememberView, 2000);
  addEventListener("pagehide", rememberView);
  renderDims();
  updateGround();
}

/* ------------------------------------------------------------- walking */

/* One ray into the model from any point in any direction, answered by the
   fragments worker. The library only raycasts from a camera through a
   screen position, so a small camera is put at the origin looking along
   the ray and asked about the centre of the screen. Only models whose box
   the ray actually passes through are asked: on TP14 that is the host and
   two or three typical-floor copies instead of all 37. */
const _rayCam = new THREE.PerspectiveCamera(20, 1, 0.01, 1e5);
let _walkBoxes = { t: 0, list: [] };

function walkBoxes() {
  const now = performance.now();
  if (now - _walkBoxes.t < 4000 && _walkBoxes.list.length) return _walkBoxes.list;
  const list = [];
  for (const rec of S.loaded.values()) {
    for (const part of rec.parts) {
      const b = worldBox(part);
      if (!b.isEmpty()) list.push({ part, box: b.expandByScalar(0.05) });
    }
  }
  _walkBoxes = { t: now, list };
  return list;
}

/* ------------------------------------------------- consultant models */

/* Models from other companies (refs.py): an IFC the server converted, or
   another project's 3D model overlaid on this one. Each is placed by its
   own coordinates:
     shared    - its IFC numbers are the project's survey coordinates (what
                 Revit's "shared coordinates" export gives, and what a
                 coordinated consultant uses);
     internal  - its numbers are this Revit model's internal origin;
     fit       - nobody agreed coordinates: set down on the middle of the
                 project, to be moved by hand;
   then moved and turned by hand on top (Place). Placement and the default
   on/off are the project's (saved for everyone); a person's own on/off
   and transparency stay on their device.

   The frames, checked against a converted IFC: fragments keeps the IFC's
   world coordinates (Y-up metres, o) and stores geometry as local =
   coord . o; the scene is reached with T . Off . coord^-1. */
const RF = { list: [], open: null, poll: null, sources: null, canAdd: false };
const refKey = (r) => "ref:" + r.id;
const refPref = (r, k, d) => { try { const v = localStorage.getItem(`lwk-ref:${Store.currentProject ? Store.currentProject() : ""}:${r.id}:${k}`); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const refSet = (r, k, v) => { try { localStorage.setItem(`lwk-ref:${Store.currentProject ? Store.currentProject() : ""}:${r.id}:${k}`, JSON.stringify(v)); } catch (e) {} };

async function refApi(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign(Store.authHeaders(), o.json === false ? {} : { "Content-Type": "application/json" }, o.headers || {});
  const r = await fetch(path, o);
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return d;
}

/* this project's shared coordinates (Y-up metres) -> the scene */
function sharedYupToScene() {
  const F = lwkFrame();
  if (F) return F.C.clone();
  const hp = firstHostPart();
  if (!hp || !hp.coord) return null;
  hp.model.object.updateMatrix();
  return new THREE.Matrix4().multiplyMatrices(hp.model.object.matrix, hp.coord);
}
function internalToSharedZ() {
  const F = lwkFrame();
  if (F) return F.IS.clone();
  const PL = projectLocationMatrix();
  return PL ? PL.clone().invert() : new THREE.Matrix4();
}

/* the hand-made move and turn, in shared axes (Z up, mm and degrees) */
function refOffset(pl) {
  const T = new THREE.Matrix4().makeTranslation(fromMM(pl.x || 0), fromMM(pl.y || 0), fromMM(pl.z || 0));
  const R = new THREE.Matrix4().makeRotationZ((pl.rot || 0) * Math.PI / 180);
  return Zm.clone().invert().multiply(T).multiply(R).multiply(Zm);
}

function hostBox() {
  const box = new THREE.Box3();
  for (const [k, rec] of S.loaded) {
    if (k.startsWith("ref:")) continue;
    for (const p of rec.parts) { const b = worldBox(p); if (!b.isEmpty()) box.union(b); }
  }
  return box;
}

/* original (Y-up metres) -> scene, for a placement */
function refTarget(pl, oBox) {
  const Zi = Zm.clone().invert();
  let T = sharedYupToScene();
  if (pl.mode === "internal" && T) T = T.multiply(Zi).multiply(internalToSharedZ()).multiply(Zm);
  if (pl.mode === "fit" || !T) {
    // its footprint's middle on the project's, its bottom on the project's bottom
    const hb = hostBox();
    const c = oBox && !oBox.isEmpty() ? oBox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const want = hb.isEmpty() ? new THREE.Vector3() : hb.getCenter(new THREE.Vector3());
    const dy = hb.isEmpty() || !oBox || oBox.isEmpty() ? 0 : hb.min.y - oBox.min.y;
    T = new THREE.Matrix4().makeTranslation(want.x - c.x, dy, want.z - c.z);
  }
  return T.multiply(refOffset(pl));
}

function placeRef(rec, pl) {
  const p = rec.parts[0];
  // a fast 3D model overlaid from another project is placed as it loads
  if (!p || !p.coord || rec.lwk) return;
  const oBox = rec.oBox;
  const X = refTarget(pl, oBox).multiply(p.coord.clone().invert());
  X.decompose(p.model.object.position, p.model.object.quaternion, p.model.object.scale);
  p.model.object.updateMatrixWorld(true);
  S.dirty = true;
  S._camKey = null;
  if (S.fragments) S.fragments.update(true).catch(() => {});
}

async function setRefOpacity(rec, v) {
  const m = rec.parts[0] && rec.parts[0].model;
  if (!m || !m.setOpacity) return;
  try {
    if (v >= 0.99) await m.resetOpacity(undefined);
    else await m.setOpacity(undefined, v);
  } catch (e) {
    try {
      const ids = await m.getItemsIdsWithGeometry();
      if (v >= 0.99) await m.resetOpacity(ids); else await m.setOpacity(ids, v);
    } catch (e2) { /* left solid */ }
  }
  S.dirty = true;
  if (S.fragments) S.fragments.update(true).catch(() => {});
}

/* the entry an overlay loads: the other project's model, its paths whole */
async function overlayEntry(r) {
  const res = await fetch(`/data/${encodeURIComponent(r.project)}/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${r.project}: you cannot open that project, or it has no 3D`);
  const man = await res.json();
  const m = (man.models || []).find((x) => x.name === r.model);
  if (!m) throw new Error(`${r.model} is not in ${r.project} any more`);
  const e = JSON.parse(JSON.stringify(m));
  const whole = (p) => (p && !p.startsWith("/data/") ? `/data/${encodeURIComponent(r.project)}/${p}` : p);
  for (const k of ["fragments", "props", "mobile", "tiles_index"]) if (typeof e[k] === "string") e[k] = whole(e[k]);
  e.name = refKey(r);
  e.role = "ref";
  e.instances = [];
  e._lwkFrame = man.lwk_frame || null;
  return e;
}

async function loadRef(r) {
  if (S.loaded.has(refKey(r)) || r.status !== "ready") return;
  const pl = r.placement || { mode: "shared" };
  if (r.kind === "overlay") {
    const e = await overlayEntry(r);
    if (e.format === "lwkm") {
      /* its internal -> its shared, then this project's shared -> scene */
      const f = e._lwkFrame;
      const IS = new THREE.Matrix4();
      const t = f && f.internal_to_shared_mm;
      if (t && t.length === 12) IS.set(t[0], t[1], t[2], t[3] / 1000, t[4], t[5], t[6], t[7] / 1000, t[8], t[9], t[10], t[11] / 1000, 0, 0, 0, 1);
      const T = refTarget(Object.assign({}, pl, pl.mode === "internal" ? { mode: "shared" } : {}), null);
      const Zi = Zm.clone().invert();
      const C = (lwkFrame() || {}).C || new THREE.Matrix4();
      e._frame = { base: T.clone().multiply(Zi).multiply(IS), C };
      e.tiles = false;
      await loadLwk(e, "full");
      const rec = S.loaded.get(refKey(r));
      if (rec) { rec.ref = r; rec.oBox = null; }
      return;
    }
    r = Object.assign({}, r, { fragments: e.fragments });
  }
  const url = Store.dataUrl(r.fragments);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${r.name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const id = refKey(r);
  const model = await S.fragments.load(buf, { modelId: id });
  model.useCamera && model.useCamera(S.camera);
  S.scene.add(model.object);
  await S.fragments.update(true);
  let coord = null;
  try { coord = await model.getCoordinationMatrix(); } catch (e) { coord = new THREE.Matrix4(); }
  const part = { id, model, object: model.object, coord, place: null, idx: 0, isRef: true };
  const rec = { entry: { name: id, role: "ref", fragments: r.fragments }, parts: [part], buf: null, places: [null],
                light: false, calib: null, busy: null, ref: r };
  /* its extent in its own coordinates (for "fit"): model.box is where it
     sits now (world = object . local), and local = coord . original */
  try {
    const mb = model.box;
    model.object.updateMatrixWorld(true);
    const toO = coord.clone().invert().multiply(model.object.matrixWorld.clone().invert());
    rec.oBox = mb && !mb.isEmpty() ? mb.clone().applyMatrix4(toO) : null;
  } catch (e) { rec.oBox = null; }
  S.loaded.set(id, rec);
  placeRef(rec, pl);
  const op = refPref(r, "opacity", r.opacity == null ? 1 : r.opacity);
  if (op < 0.99) await setRefOpacity(rec, op);
  if (S.display && S.display !== "shaded") applyDisplayMaterials();
  applyCategories().then(renderCategories);
  status(`${r.name}: shown${r.company ? " (" + r.company + ")" : ""}.`);
}

async function initRefs() {
  if (!$("#ref-panel")) return;
  try {
    const d = await refApi("/api/refs");
    RF.list = d.refs || [];
    RF.canAdd = !!d.can_add;
  } catch (e) {
    RF.list = [];
    RF.canAdd = false;
  }
  renderRefs();
  for (const r of RF.list) {
    if (r.kind === "host" || r.status !== "ready") continue;
    if (!refPref(r, "on", r.on !== false)) continue;
    try { await loadRef(r); } catch (e) { status(e.message); }
  }
  renderRefs();
  pollRefs();
}

/* a conversion under way: asked again every few seconds until it is done */
function pollRefs() {
  clearTimeout(RF.poll);
  if (!RF.list.some((r) => r.status === "waiting" || r.status === "converting")) return;
  RF.poll = setTimeout(async () => {
    try {
      const was = new Map(RF.list.map((r) => [r.id, r.status]));
      RF.list = (await refApi("/api/refs")).refs || [];
      for (const r of RF.list) {
        if (r.status === "ready" && was.get(r.id) !== "ready" && r.kind !== "host") {
          try { await loadRef(r); } catch (e) { status(e.message); }
        }
      }
      renderRefs();
    } catch (e) {}
    pollRefs();
  }, 3000);
}

/* A project made from an IFC, its model still being converted. */
function waitConversion() {
  status("The model is being converted from IFC on the server - it shows here by itself when it is ready.");
  const tick = async () => {
    try {
      const d = await refApi("/api/refs");
      const h = (d.refs || []).find((r) => r.kind === "host");
      if (h && h.status === "failed") { status("The conversion failed: " + (h.error || "")); return; }
      if (h && h.status === "ready") { location.reload(); return; }
      status(`Converting the IFC on the server ... ${h ? h.progress || 0 : 0}%`);
    } catch (e) {}
    setTimeout(tick, 3000);
  };
  tick();
}


function renderRefs() {
  const box = $("#ref-panel");
  if (!box) return;
  const list = RF.list.filter((r) => r.kind !== "host");
  box.hidden = !list.length && !RF.canAdd;
  let h = `<div class="ref-head">Consultant models <span class="muted">${list.length || ""}</span></div>`;
  for (const r of list) {
    const loaded = S.loaded.has(refKey(r));
    const on = r.status === "ready" && refPref(r, "on", r.on !== false);
    const st = r.status === "ready" ? "" : r.status === "failed"
      ? `<div class="ref-bad">Not converted: ${escH(r.error || "")}${r.can_change && r.kind === "ifc" ? ` <button class="ghost ref-b" data-rf="retry">Try again</button>` : ""}</div>`
      : `<div class="ref-prog"><i style="width:${r.progress || 0}%"></i></div><small class="muted">Converting on the server ... ${r.progress || 0}%</small>`;
    const what = [r.company, r.discipline, r.kind === "overlay" ? "from " + r.project : ""].filter(Boolean).join(" · ");
    h += `<div class="ref-row" data-ref="${escH(r.id)}">`
      + `<label class="row-check" title="${escH(r.source_file || r.name)}"><input type="checkbox" data-rf="on"${on ? " checked" : ""}${r.status !== "ready" ? " disabled" : ""}> <span class="nm">${escH(r.name)}</span></label>`
      + (what ? `<small class="muted ref-what">${escH(what)}</small>` : "")
      + st
      + (r.status === "ready" ? `<div class="ref-tools"><input type="range" min="10" max="100" step="5" value="${Math.round(refPref(r, "opacity", r.opacity == null ? 1 : r.opacity) * 100)}" data-rf="op" title="See-through"${loaded ? "" : " disabled"}>`
        + (r.can_change ? `<button class="ghost ref-b" data-rf="place"${loaded ? "" : " disabled"} title="Move and turn it into place (for everyone)">Place</button>` : "")
        + `</div>` : "")
      + (r.can_change ? `<button class="ghost ref-b ref-x" data-rf="del" title="Remove from this project">&times;</button>` : "")
      + (RF.open === r.id ? placeHtml(r) : "")
      + `</div>`;
  }
  if (RF.canAdd) {
    h += `<div class="ref-add"><button class="ghost ref-b" data-rf="add">+ Consultant model (IFC)</button>`
      + `<button class="ghost ref-b" data-rf="overlay">+ Overlay another project</button></div>`
      + `<input type="file" id="ref-file" accept=".ifc" hidden>`
      + `<div id="ref-form"></div>`;
  }
  box.innerHTML = h;
}

function placeHtml(r) {
  const pl = r.placement || { mode: "shared" };
  const num = (k, lab, unit) => `<label>${lab}<input type="number" step="${k === "rot" ? 0.5 : 10}" data-pl="${k}" value="${Number(pl[k] || 0)}"><small>${unit}</small></label>`;
  const mode = (v, t, d) => `<label class="row-check" title="${d}"><input type="radio" name="pl-mode-${escH(r.id)}" data-pl="mode" value="${v}"${(pl.mode || "shared") === v ? " checked" : ""}> ${t}</label>`;
  return `<div class="ref-place">`
    + mode("shared", "Shared coordinates", "Its IFC is on the project's survey coordinates - what a coordinated consultant exports")
    + mode("internal", "This model's origin", "Its IFC is on this Revit model's internal origin")
    + mode("fit", "No coordinates: set in the middle", "Placed on the middle of the project, to be moved by hand")
    + `<div class="ref-nums">${num("x", "East", "mm")}${num("y", "North", "mm")}${num("z", "Up", "mm")}${num("rot", "Turn", "°")}</div>`
    + `<div class="ref-btns"><button class="ghost ref-b" data-rf="pl-cancel">Cancel</button><button class="ref-b" data-rf="pl-save">Save for everyone</button></div></div>`;
}

function readPlace(row, r) {
  const pl = Object.assign({}, r.placement || {});
  for (const el of row.querySelectorAll("[data-pl]")) {
    if (el.type === "radio") { if (el.checked) pl.mode = el.value; }
    else pl[el.dataset.pl] = Number(el.value) || 0;
  }
  return pl;
}

function uploadIfc(file, meta) {
  return new Promise((res, rej) => {
    const q = new URLSearchParams({ file: file.name, name: meta.name || "", company: meta.company || "", discipline: meta.discipline || "" });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/refs/upload?" + q);
    const hd = Store.authHeaders();
    for (const k of Object.keys(hd)) xhr.setRequestHeader(k, hd[k]);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) status(`Uploading ${file.name} ... ${Math.round(ev.loaded / ev.total * 100)}%`); };
    xhr.onload = () => {
      let d = null;
      try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) res(d); else rej(new Error((d && d.detail) || "HTTP " + xhr.status));
    };
    xhr.onerror = () => rej(new Error("No connection"));
    xhr.send(file);
  });
}

async function showOverlayForm() {
  const f = $("#ref-form");
  f.innerHTML = `<small class="muted">Loading the projects ...</small>`;
  let ps = [];
  try { ps = (await refApi("/api/refs/sources")).projects; } catch (e) { f.innerHTML = `<small class="ref-bad">${escH(e.message)}</small>`; return; }
  if (!ps.length) { f.innerHTML = `<small class="muted">No other project with a 3D model that you can open.</small>`; return; }
  f.innerHTML = `<div class="ref-place"><label>Model <select id="ov-pick">${ps.map((p) => `<optgroup label="${escH(p.title)}">${p.models.map((m) =>
      `<option value="${escH(p.id)}|${escH(m.name)}">${escH(m.name)}${m.role ? " (" + escH(m.role) + ")" : ""}</option>`).join("")}</optgroup>`).join("")}</select></label>`
    + `<small class="muted">Placed on the shared coordinates both projects use; Place moves it if they differ. A model with no common coordinates is better opened on its own page.</small>`
    + `<div class="ref-btns"><button class="ghost ref-b" data-rf="form-x">Cancel</button><button class="ref-b" data-rf="ov-go">Overlay</button></div></div>`;
}

function showAddForm(file) {
  const f = $("#ref-form");
  const stem = file.name.replace(/\.ifc$/i, "");
  f.innerHTML = `<div class="ref-place"><b class="ref-fn">${escH(file.name)}</b> <small class="muted">${(file.size / 1048576).toFixed(1)} MB</small>`
    + `<label>Name <input id="rf-name" value="${escH(stem)}" maxlength="80"></label>`
    + `<label>Company <input id="rf-co" maxlength="80" placeholder="e.g. ABC Structural Engineers"></label>`
    + `<label>Discipline <input id="rf-di" maxlength="40" list="rf-dis" placeholder="Structure, MEP, Interior ..."></label>`
    + `<datalist id="rf-dis"><option>Structure</option><option>MEP</option><option>Interior</option><option>Facade</option><option>Landscape</option><option>Survey</option></datalist>`
    + `<div class="ref-btns"><button class="ghost ref-b" data-rf="form-x">Cancel</button><button class="ref-b" data-rf="add-go">Upload and convert</button></div></div>`;
  f._file = file;
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("#ref-panel [data-rf]");
  if (!b || b.type === "checkbox" || b.type === "range") return;
  const k = b.dataset.rf;
  const row = b.closest("[data-ref]");
  const r = row && RF.list.find((x) => x.id === row.dataset.ref);
  try {
    if (k === "add") return $("#ref-file").click();
    if (k === "overlay") return showOverlayForm();
    if (k === "form-x") { $("#ref-form").innerHTML = ""; return; }
    if (k === "add-go") {
      const f = $("#ref-form");
      b.disabled = true;
      const d = await uploadIfc(f._file, { name: $("#rf-name").value, company: $("#rf-co").value, discipline: $("#rf-di").value });
      status(`${d.ref.name}: uploaded - converting on the server.`);
      RF.list.push(Object.assign({ can_change: true }, d.ref));
      renderRefs();
      pollRefs();
      return;
    }
    if (k === "ov-go") {
      const [project, model] = $("#ov-pick").value.split("|");
      const d = await refApi("/api/refs/overlay", { method: "POST", body: JSON.stringify({ project, model }) });
      const nr = Object.assign({ can_change: true }, d.ref);
      RF.list.push(nr);
      renderRefs();
      await loadRef(nr);
      renderRefs();
      return;
    }
    if (!r) return;
    if (k === "del") {
      if (!confirm(`Remove "${r.name}" from this project, for everyone?`)) return;
      await refApi("/api/refs/" + r.id, { method: "DELETE" });
      await unloadModel(refKey(r));
      RF.list = RF.list.filter((x) => x.id !== r.id);
      renderRefs();
      S.dirty = true;
    } else if (k === "retry") {
      await refApi(`/api/refs/${r.id}/convert`, { method: "POST", body: "{}" });
      r.status = "waiting"; r.error = "";
      renderRefs();
      pollRefs();
    } else if (k === "place") {
      RF.open = RF.open === r.id ? null : r.id;
      RF.before = JSON.parse(JSON.stringify(r.placement || {}));
      renderRefs();
    } else if (k === "pl-cancel") {
      r.placement = RF.before;
      const rec = S.loaded.get(refKey(r));
      if (rec && rec.parts[0] && rec.parts[0].coord) placeRef(rec, r.placement);
      RF.open = null;
      renderRefs();
    } else if (k === "pl-save") {
      const pl = readPlace(row, r);
      const d = await refApi("/api/refs/" + r.id, { method: "PATCH", body: JSON.stringify({ placement: pl }) });
      r.placement = d.ref.placement;
      RF.open = null;
      const rec = S.loaded.get(refKey(r));
      if (rec && rec.lwk) { await unloadModel(refKey(r)); await loadRef(r); }
      renderRefs();
      status(`${r.name}: placed for everyone.`);
    }
  } catch (e) { status(e.message); b.disabled = false; }
});

document.addEventListener("change", async (ev) => {
  if (ev.target.id === "ref-file") {
    const f = ev.target.files[0];
    if (f) showAddForm(f);
    ev.target.value = "";
    return;
  }
  const el = ev.target.closest && ev.target.closest("#ref-panel [data-rf], #ref-panel [data-pl]");
  if (!el) return;
  const row = el.closest("[data-ref]");
  const r = row && RF.list.find((x) => x.id === row.dataset.ref);
  if (!r) return;
  if (el.dataset.rf === "on") {
    refSet(r, "on", el.checked);
    el.disabled = true;
    try {
      if (el.checked) { status(`Loading ${r.name} ...`); await loadRef(r); }
      else { await unloadModel(refKey(r)); S.dirty = true; }
    } catch (e) { status(e.message); el.checked = false; }
    renderRefs();
  } else if (el.dataset.pl) {
    const rec = S.loaded.get(refKey(r));
    if (rec && rec.parts[0] && rec.parts[0].coord) placeRef(rec, readPlace(row, r));    // live
  }
});

document.addEventListener("input", (ev) => {
  const el = ev.target.closest && ev.target.closest("#ref-panel [data-rf=op], #ref-panel input[type=number][data-pl]");
  if (!el) return;
  const row = el.closest("[data-ref]");
  const r = row && RF.list.find((x) => x.id === row.dataset.ref);
  const rec = r && S.loaded.get(refKey(r));
  if (!rec) return;
  if (el.dataset.rf === "op") {
    const v = Number(el.value) / 100;
    refSet(r, "opacity", v);
    clearTimeout(RF.opT);
    RF.opT = setTimeout(() => setRefOpacity(rec, v), 120);
  } else if (rec.parts[0] && rec.parts[0].coord) {
    placeRef(rec, readPlace(row, r));
  }
});

async function rayHit(origin, dir, maxDist) {
  const d = dir.clone().normalize();
  const ray = new THREE.Ray(origin.clone(), d);
  const tmp = new THREE.Vector3();
  const parts = walkBoxes()
    .filter(({ box }) => box.containsPoint(origin)
      || (ray.intersectBox(box, tmp) && tmp.distanceTo(origin) <= maxDist))
    .map(({ part }) => part);
  if (!parts.length) return null;

  const dom = S.renderer.domElement;
  const rect = dom.getBoundingClientRect();
  _rayCam.aspect = (rect.width || 1) / (rect.height || 1);
  _rayCam.position.copy(origin);
  // lookAt needs an up that is not along the ray
  if (Math.abs(d.y) > 0.99) _rayCam.up.set(0, 0, 1); else _rayCam.up.set(0, 1, 0);
  _rayCam.lookAt(tmp.copy(origin).add(d));
  _rayCam.updateProjectionMatrix();
  _rayCam.updateMatrixWorld(true);

  const centre = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const planes = S.renderer.clippingPlanes || [];
  for (const [label, mouse] of mouseCandidates(centre, rect)) {
    const answers = await Promise.all(parts.map(async (part) => {
      const q = { camera: _rayCam, mouse, dom };
      let hit;
      try {
        hit = await withTimeout(planes.length ? part.model.raycastAll(q)
                                              : part.model.raycast(q), 800, "walk");
      } catch (e) { return []; }
      if (!hit || hit.__timeout) return [];
      return (Array.isArray(hit) ? hit : [hit]).filter((h) => h && h.point
        && planes.every((pl) => pl.distanceToPoint(h.point) >= -0.002));
    }));
    const all = answers.flat()
      .map((h) => ({ point: h.point.clone(), normal: h.normal || null,
                     distance: h.point.distanceTo(origin) }))
      /* Only hits ON the ray. Read with the wrong mouse convention, the
         library casts through a corner of the screen instead of the centre
         and still finds something - a floor half a metre to one side. */
      .filter((h) => h.distance <= maxDist
        && ray.distanceSqToPoint(h.point) < 0.03 * 0.03
        && tmp.copy(h.point).sub(origin).dot(d) > -0.01)
      .sort((a, b) => a.distance - b.distance);
    if (all.length) {
      if (!S.mouseMode) S.mouseMode = label;
      return all[0];
    }
    if (S.mouseMode === label) break;  // the known convention: a real miss
  }
  return null;
}

/* Before standing in the model: perspective, ordinary navigation, and no
   floor-plan cut or section box - a plan is cut 1.2 m up, which would put
   the walker's eyes above the cut and show nothing. */
function prepareWalk() {
  if (S.mode !== "nav") setMode("nav");
  if (S.floorIndex !== undefined && S.floorIndex !== null) {
    S.floorIndex = null;
    removeDrawing();
    renderFloors();
    const sel = document.getElementById("floor-select");
    if (sel) sel.value = "";
  }
  const cb = document.getElementById("sec-on");
  if (cb && cb.checked) {
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
  }
  if (S.ortho) setOrtho(false);
  if (S.camera.near > 0.05) { S.camera.near = 0.05; S.camera.updateProjectionMatrix(); }
  _walkBoxes.t = 0;                      // the scene may have changed
}

/* While choosing where to stand, the pointer is a little person (as in
   Street View) and a ring on the model shows the spot it would stand on. */
const PEGMAN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>"
  + "<ellipse cx='16' cy='29.5' rx='6.5' ry='2' fill='rgba(0,0,0,.35)'/>"
  + "<circle cx='16' cy='6' r='4.2' fill='#f28022' stroke='#fff' stroke-width='1.6'/>"
  + "<path d='M10.5 11.5h11l1.6 8.2h-2.8l-1.1 8.8h-6.4l-1.1-8.8H8.9z' fill='#f28022' "
  + "stroke='#fff' stroke-width='1.6' stroke-linejoin='round'/></svg>";
const PEGMAN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PEGMAN_SVG)}") 16 29, crosshair`;

function walkMarker() {
  if (S.walkMarker) return S.walkMarker;
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf28022, transparent: true,
    opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 40), mat));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), mat));
  g.name = "__walkmarker";
  g.visible = false;
  g.renderOrder = 10;
  (S.overlay || S.scene).add(g);
  S.walkMarker = g;
  return g;
}

async function walkHover(ev) {
  const found = await pickAt(ev);
  const m = walkMarker();
  if (!S.walk.picking || !found || !found.hit.point) { m.visible = false; S.dirty = true; return; }
  const n = found.hit.normal && found.hit.normal.y > 0.7
    ? found.hit.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
  m.position.copy(found.hit.point).addScaledVector(n, 0.02);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  // same size on screen at any distance, never smaller than life size
  const d = S.camera.position.distanceTo(m.position);
  m.scale.setScalar(Math.max(1, d * 0.03));
  m.visible = true;
  S.dirty = true;
}

function walkState() {
  const w = S.walk;
  const btn = document.getElementById("m-walk");
  if (btn) btn.classList.toggle("active", !!(w && (w.on || w.picking)));
  const hud = document.getElementById("walk-hud");
  if (hud) hud.hidden = !(w && w.on);
  if (S.renderer) {
    S.renderer.domElement.style.cursor = w && w.picking ? PEGMAN_CURSOR
      : (w && w.on ? "grab" : (S.mode === "nav" ? "" : "crosshair"));
  }
  if (S.walkMarker && !(w && w.picking)) { S.walkMarker.visible = false; S.dirty = true; }
  if (w) {
    const st = w.settings;
    const set = (id, prop, v) => { const el = document.getElementById(id); if (el) el[prop] = v; };
    set("walk-eye", "value", st.eye);
    set("walk-speed", "value", st.speed);
    set("walk-speed-val", "textContent", Number(st.speed).toFixed(1));
    set("walk-gravity", "checked", !!st.gravity);
    set("walk-collide", "checked", !!st.collide);
  }
}

function wireWalkUi() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on("m-walk", "click", () => S.walk.begin());
  on("walk-exit", "click", () => S.walk.stop());
  on("walk-eye", "change", (ev) => {
    const v = Math.max(0.8, Math.min(3, Number(ev.target.value) || 1.6));
    S.walk.set({ eye: v }); walkState();
  });
  on("walk-speed", "input", (ev) => {
    S.walk.set({ speed: Number(ev.target.value) || 1.5 }); walkState();
  });
  on("walk-gravity", "change", (ev) => S.walk.set({ gravity: ev.target.checked }));
  on("walk-collide", "change", (ev) => S.walk.set({ collide: ev.target.checked }));
  // Keys typed into the settings must not keep walking the walker.
  for (const id of ["walk-eye", "walk-speed"]) {
    on(id, "keydown", (ev) => ev.stopPropagation());
  }
  document.querySelectorAll("#walk-hud [data-walk]").forEach((b) => {
    const name = b.dataset.walk;
    const down = (ev) => { ev.preventDefault(); S.walk.press(name, true); };
    const up = () => S.walk.press(name, false);
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
  });
  // Clicking another tool ends the walk.
  for (const id of ["m-nav", "m-issue", "m-measure"]) {
    on(id, "click", () => { if (S.walk.on || S.walk.picking) S.walk.stop(); });
  }
  walkState();
}

/* ---------------------------------------------------------- performance */

/* What loading and drawing actually cost, measured in this browser - the
   first step before any change to how models are split or streamed. The
   report is plain text with a Copy button, so it can be pasted into a
   message instead of screenshotted. */
S.perf = { models: new Map(), frames: 0, since: 0, live: null, allReadyAt: null };

function cacheState(url, bytes) {
  try {
    const abs = new URL(url, location.href).href;
    const e = performance.getEntriesByName(abs).pop();
    // Safari does not report sizes for these requests.
    if (!e || (!e.transferSize && !e.encodedBodySize && !e.decodedBodySize)) return "cache state not reported";
    if (e.transferSize === 0) return "browser cache";
    if (e.transferSize < Math.min(8192, bytes / 10)) return "cache, checked unchanged";
    return "downloaded";
  } catch (e) {
    return "unknown";
  }
}

const secs = (ms) => (ms / 1000).toFixed(1) + " s";
const mb = (b) => (b / 1048576).toFixed(1) + " MB";

/* What the telemetry heartbeat records (telemetry.js): memory the models
   take, what is drawn, and how each model was loaded. */
function teleSnapshot() {
  let gpu = 0, cpu = 0;
  const models = [];
  for (const rec of S.loaded.values()) {
    const m = rec.parts[0] && rec.parts[0].model;
    const st = m && m.memStats ? m.memStats() : null;
    if (st) { gpu += st.gpu; cpu += st.cpu; }
    const tri = m && m.stats ? m.stats().triangles : null;
    models.push({ name: rec.entry.name, tris: tri, how: rec.tiles ? "tiles" : rec.mobile ? "phone copy"
      : rec.near ? "near" : rec.extOnly ? "outside only" : rec.full ? "full" : rec.lwk ? "fast3d" : "fragments",
      placements: rec.parts.length, gpuMB: st ? Math.round(st.gpu / 104857.6) / 10 : null,
      stream: m && m.streamStats ? m.streamStats() : undefined });
  }
  const info = S.renderer ? S.renderer.info : null;
  return {
    gpuMB: gpu / 1048576, cpuMB: cpu / 1048576,
    tris: S.lwkDrawn || (info ? info.render.triangles : 0), calls: info ? (info.render.calls ?? info.render.drawCalls) : 0,
    heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    fps: S.perf && S.perf.live ? Math.round(S.perf.live.fps) : null,
    budgetMB: S.tileBudget ? Math.round(S.tileBudget.limit / 1048576) : null,
    lowMemory: !!S.lowMemory, light: !!S.light, outside: S._outside === undefined ? null : S._outside,
    pixelRatio: S.renderer ? S.renderer.getPixelRatio() : null,
    section: !!(S.section && (S.section.on || S.section.face)), walk: !!(S.walk && S.walk.on),
    models: models.slice(0, 40),
  };
}

function recordPerf(p) {
  // how fast whole files really come down here: decides streaming next time
  if (p.cache === "downloaded" && p.bytes > 3e6 && p.downloadMs > 300) {
    const mbps = p.bytes * 8 / 1e6 / (p.downloadMs / 1000);
    try {
      const old = Number(localStorage.getItem("lwk.lastMbps"));
      localStorage.setItem("lwk.lastMbps", String(old > 0 ? old * 0.5 + mbps * 0.5 : mbps));
    } catch (e) {}
  }
  Tele.note(`${p.name}: ${mb(p.bytes)} ${p.cache}, ready ${secs(p.readyMs || 0)}`);
  S.perf.models.set(p.name, p);
  const el = document.querySelector(`[data-perf="${CSS.escape(p.name)}"]`);
  if (el) {
    el.textContent = `${mb(p.bytes)} ${p.cache === "downloaded" ? "downloaded" : "from " + p.cache}`
      + ` in ${secs(p.downloadMs)}, opened in ${secs(p.parseMs || 0)}`;
  }
  renderPerf();
}

function perfFrame(now) {
  const P = S.perf;
  P.frames++;
  if (!P.since) { P.since = now; return; }
  if (now - P.since < 1000) return;
  const info = S.renderer.info;
  const heap = performance.memory ? performance.memory.usedJSHeapSize : null;
  P.live = {
    fps: P.frames * 1000 / (now - P.since),
    tris: info.render.triangles, calls: info.render.calls ?? info.render.drawCalls,
    geoms: info.memory.geometries, textures: info.memory.textures, heap,
  };
  P.frames = 0; P.since = now;
  const el = document.getElementById("perf-live");
  if (el) {
    let memTxt = "";
    try {
      let g = 0;
      for (const rec of S.loaded.values()) {
        const m = rec.parts[0] && rec.parts[0].model;
        if (m && m.memStats) g += m.memStats().gpu;
      }
      if (g) memTxt = ` · ${Math.round(g / 1048576)} MB`
        + (S.tileBudget ? ` of ${Math.round(S.tileBudget.limit / 1048576)}` : "");
    } catch (e) {}
    el.textContent = `${Math.round(P.live.fps)} fps · `
      + `${(P.live.tris / 1e6).toFixed(2)} M triangles` + memTxt
      + (S.quality && S.quality.level ? ` · moving step ${S.quality.level}` : "")
      + (S.gpuMode === "webgpu" ? " · WebGPU" : "");
  }
  const panel = document.getElementById("perf-panel");
  if (panel && !panel.hidden) renderPerf();
}

function gpuName() {
  try {
    if (S.gpuMode === "webgpu") return "WebGPU: " + (S.gpuBackend || "");
    const gl = S.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { return "unknown"; }
}

function perfReport() {
  const P = S.perf;
  const lines = [];
  const proj = (document.getElementById("project") || {}).textContent || "";
  lines.push(`LWK viewer performance - ${proj.trim()} - ${new Date().toLocaleString()}`);
  lines.push(`Browser: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, "")}`);
  lines.push(`Screen: ${innerWidth} x ${innerHeight} @${devicePixelRatio}x   GPU: ${gpuName()}`);
  const conn = navigator.connection;
  if (conn && conn.downlink) lines.push(`Network estimate: ${conn.downlink} Mbit/s, ${conn.effectiveType || ""}`);
  lines.push("");
  lines.push("Models (download / open / ready, times since the page started):");
  let total = 0, fetched = 0;
  const ms = [...P.models.values()].sort((a, b) => a.start - b.start);
  for (const p of ms) {
    total += p.bytes;
    if (p.cache === "downloaded") fetched += p.bytes;
    lines.push(`  ${p.name}`);
    lines.push(`    ${p.how ? p.how + " - " : ""}${mb(p.bytes)}, ${p.cache}; download ${secs(p.downloadMs)}, `
      + `open ${secs(p.parseMs || 0)} (${p.placements} placement${p.placements === 1 ? "" : "s"}), `
      + `ready at ${secs(p.readyAt)}`);
  }
  if (!ms.length) lines.push("  (none loaded yet)");
  lines.push(`  Total ${mb(total)}; actually downloaded this time ${mb(fetched)}`);
  if (P.allReadyAt) lines.push(`  Everything ready at ${secs(P.allReadyAt)}`);
  if (S.notPrepared && S.notPrepared.length) {
    lines.push(`  Left out (not prepared for phones yet): ${S.notPrepared.join(", ")}`);
  }
  let mbpsTxt = "";
  try { const v = Number(localStorage.getItem("lwk.lastMbps")); if (v > 0) mbpsTxt = `; downloads here run at about ${v.toFixed(0)} Mbit/s`; } catch (e) {}
  lines.push(`  Streaming: ${S.tiles ? "on" : "off"}${S.tilesWhy ? " (" + S.tilesWhy + ")" : ""}${mbpsTxt}`);
  lines.push(`  Drawing with: ${S.gpuMode === "webgpu" ? "WebGPU (trial)" + (S.gpuBackend ? " - " + S.gpuBackend : "") : "WebGL"}`);
  if (S.quality) {
    lines.push(`  Quality while moving: ${S.quality.on ? "automatic, step " + S.quality.level + " of 4"
      + (S.quality.samples ? `, ${Math.round(S.quality.fps)} fps while moving (aim ${S.quality.target})` : "") : "always full"}`
      + (S.quality.history.length ? "; changes " + S.quality.history.map((h) => `${h[0]}s:step ${h[1]} at ${h[2]} fps`).join(", ") : ""));
  }
  lines.push("");
  if (P.live) {
    const L = P.live;
    lines.push(`Drawing now: ${Math.round(L.fps)} fps, ${(L.tris / 1e6).toFixed(2)} M triangles, `
      + `${L.calls} draw calls, ${L.geoms} geometries, ${L.textures} textures`);
    if (L.heap) lines.push(`JavaScript memory: ${mb(L.heap)}`);
    try {
      const t = teleSnapshot();
      lines.push(`Model memory (estimate): graphics card ${t.gpuMB.toFixed(0)} MB, page ${t.cpuMB.toFixed(0)} MB`
        + (t.budgetMB ? `, budget ${t.budgetMB} MB` : ""));
    } catch (e) {}
  }
  let drawn = 0;
  for (const r of S.loaded.values()) drawn += r.parts.length;
  lines.push(`Models drawn: ${S.loaded.size}, placements ${drawn}`);
  if (S.tileBudget) {
    const t = S.tileBudget.stats();
    lines.push(`Streaming: ${t.pieces} pieces held (${t.usedMB} of ${t.limitMB} MB), ${t.loading} loading, `
      + `${t.wanted} wanted; ${t.loaded} fetched, ${t.evicted} let go, ${t.failed} failed`
      + (t.pressure > 1 ? `; over budget - coarser copies (x${t.pressure})` : ""));
  }
  return lines.join("\n");
}

function renderPerf() {
  const pre = document.getElementById("perf-text");
  const panel = document.getElementById("perf-panel");
  if (pre && panel && !panel.hidden) pre.textContent = perfReport();
}

/* Left-hand panel sections fold. Section, Measure, Elements, Display and
   Saved views share one column; with all of them open the element list got
   a short scrolling window. A click on a heading folds that section, and
   the choice is remembered. */
(function wirePanels() {
  const KEY = "lwk.panels3d";
  let folded = {};
  try { folded = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  const heads = document.querySelectorAll("#models > .panel-head");
  heads.forEach((head, i) => {
    // the model list folds too (the arrow on its heading): a long list of
    // links pushed Section and Measure far down the panel
    const name = (head.firstChild && head.firstChild.textContent || head.textContent)
      .trim().split(/\s+/)[0] || ("panel" + i);
    const body = [];
    for (let el = head.nextElementSibling; el && !el.classList.contains("panel-head");
         el = el.nextElementSibling) body.push(el);
    const chev = document.createElement("span");
    chev.className = "chev";
    head.insertBefore(chev, head.firstChild);
    head.classList.add("foldable");
    head.title = head.title || "Click to fold or open this section";
    const apply = () => {
      const f = !!folded[name];
      head.classList.toggle("folded", f);
      chev.textContent = f ? "\u25B8" : "\u25BE";
      body.forEach((el) => el.classList.toggle("sec-folded", f));
    };
    head.addEventListener("click", (ev) => {
      if (ev.target.closest("button, input, select, label, a")) return;
      folded[name] = !folded[name];
      try { localStorage.setItem(KEY, JSON.stringify(folded)); } catch (e) {}
      apply();
    });
    apply();
  });
})();

(function wirePerfUi() {
  const open = document.getElementById("perf-open");
  const panel = document.getElementById("perf-panel");
  if (!open || !panel) return;
  open.addEventListener("click", (ev) => {
    ev.preventDefault();
    panel.hidden = !panel.hidden;
    renderPerf();
  });
  document.getElementById("perf-close").addEventListener("click", () => { panel.hidden = true; });
  // streaming and memory budget, kept on this device
  for (const [id, key] of [["perf-tiles", "lwk.tiles"], ["perf-budget", "lwk.budgetMB"]]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    try { sel.value = localStorage.getItem(key) || ""; } catch (e) {}
    sel.addEventListener("change", () => {
      try { if (sel.value) localStorage.setItem(key, sel.value); else localStorage.removeItem(key); } catch (e) {}
      status("Saved - reload the page to use it.");
    });
  }
  /* WebGL <-> WebGPU trial: the renderer is made once, so the page is
     reloaded with the other one (the view comes back where it was). */
  const gb = document.getElementById("perf-gpu");
  if (gb) {
    // (this runs before the renderer is made: which one it is, is read on click)
    gb.addEventListener("click", () => {
      const to = S.gpuMode === "webgpu" ? "webgl" : "webgpu";
      try { if (to === "webgpu") localStorage.setItem("lwk.gpu", "webgpu"); else localStorage.removeItem("lwk.gpu"); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.delete("gpu");
      try { sessionStorage.setItem("lwk.gpuView", JSON.stringify({ p: S.camera.position.toArray(), t: S.controls.target.toArray() })); } catch (e) {}
      location.href = u.toString();
    });
  }
  const aq = document.getElementById("perf-autoq");
  if (aq) {
    aq.value = S.quality && S.quality.on ? "1" : "0";
    aq.addEventListener("change", () => {
      try { if (aq.value === "0") localStorage.setItem("lwk.autoq", "0"); else localStorage.removeItem("lwk.autoq"); } catch (e) {}
      S.quality.setOn(aq.value !== "0");
      S._camKey = null;
      status(aq.value === "0" ? "The moving picture stays at full quality." : "The moving picture follows the frame rate.");
    });
  }
  document.getElementById("perf-copy").addEventListener("click", async () => {
    const text = perfReport();
    try {
      await navigator.clipboard.writeText(text);
      status("Performance report copied - paste it into a message.");
    } catch (e) {
      // Clipboard needs https or localhost; select it for Ctrl+C instead.
      const pre = document.getElementById("perf-text");
      const r = document.createRange(); r.selectNodeContents(pre);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      status("Report selected - press Ctrl+C to copy it.");
    }
  });
})();

/* ------------------------------------------------ beside a sheet (embed) */

/* model.html?embed=1 is the 3D half of the sheets page's "2D + 3D" view
   (sync3d.js there). It has no header or side panels - the sheets page
   carries the controls - and talks to its parent by postMessage:

     in   {type:"goto", mm:[x,y,z], mode:"walk"|"look", label}
            mm is Revit internal millimetres at the plan's cut height;
            "walk" stands the walker on the floor below it, "look" frames
            the room around it, as arriving from a markup does.
          {type:"walk"}  put the person down (next click in 3D)
          {type:"stop"}  stop walking
     out  {type:"hello"} listening; {type:"ready"} the model is in
          {type:"cam", eye, fwd, target, walking, level}  where the camera
            is, a few times a second while it moves, for the "you are
            here" marker on the sheet. */
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
let _camSent = { t: 0, key: "" };

function toParent(msg) {
  if (!EMBED || parent === window) return;
  try { parent.postMessage(Object.assign({ lwk: 1 }, msg), location.origin); } catch (e) {}
}

function reportCam(now) {
  if (now - _camSent.t < 110) return;
  const c = S.camera;
  if (!c || !S.controls) return;
  const key = c.position.toArray().map((n) => n.toFixed(2)).join(",")
    + c.quaternion.toArray().map((n) => n.toFixed(3)).join(",");
  if (key === _camSent.key) return;
  let eye, ahead, target;
  try {
    eye = sceneToInternalMM(c.position);
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    ahead = sceneToInternalMM(c.position.clone().addScaledVector(f, 1));
    target = sceneToInternalMM(S.controls.target);
  } catch (e) { return; }                 // no model placed yet
  if (!eye || eye.some((n) => !isFinite(n))) return;
  _camSent = { t: now, key };
  const walking = !!(S.walk && S.walk.on);
  const feetY = walking ? c.position.y - (S.walk.settings.eye || 1.6) : S.controls.target.y;
  toParent({ type: "cam", eye, target, walking,
             fwd: ahead.map((v, i) => v - eye[i]),
             level: levelAt(feetY + 0.3) || "" });
}

/* The linked model(s) a point is in, loaded before going there: the one a
   plan on the sheet shows, not whichever happened to be near the start. */
/* A model the user switched off stays off (a click on the sheet does not
   bring it back). */
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (!ev.isTrusted || !t || !t.id || !t.id.startsWith("m_")) return;
  if (t.checked) { delete t.dataset.userOff; t.dataset.userOn = "1"; }
  else { t.dataset.userOff = "1"; delete t.dataset.userOn; }
}, true);

async function linksAt(mm) {
  S.priorityMM = mm;
  const models = ((S.manifest && S.manifest.models) || []).filter((m) => m.role === "link" && linkBox(m));
  const here = models.map((m) => ({ m, d: distToBox(mm, linkBox(m)) }))
    .filter((r) => r.d < 3000).sort((a, b) => a.d - b.d).slice(0, 3);
  for (const { m } of here) {
    if (S.loaded.has(m.name)) continue;
    const box = document.querySelector("#" + CSS.escape("m_" + m.name.replace(/\W/g, "_")));
    if (!box) continue;
    if (box.dataset.userOff) continue;          // switched off by the user
    if (!box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));
    }
    status(`Loading ${shortModelName(m.name)} (where the sheet points) ...`);
    try { await box._loading; } catch (e) {}
    for (let i = 0; i < 300 && !S.loaded.has(m.name) && box.checked; i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function embedGoto(m) {
  const mm = m.mm;
  if (!Array.isArray(mm) || mm.length !== 3 || mm.some((n) => !isFinite(n))) return;
  try { await linksAt(mm); } catch (e) { console.warn("links at", e); }
  for (let i = 0; i < 900 && !(firstHostPart() && S.floorRows && S.floorRows.length); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const p = internalToScene(mm);
  if (!p) { status("Could not place the point from the sheet."); return; }
  if (m.mode === "look") {
    if (S.walk && (S.walk.on || S.walk.picking)) S.walk.stop();
    focusRoom(p, levelIndexAt(p.y - 0.6));
    placeGotoMarker(p.clone().setY(p.y - 1.1));
    status(`${m.label || "From the sheet"}: ${levelAt(p.y - 0.6) || ""}`);
    return;
  }
  // Stand on the floor under the point: the point is at the plan's cut, so
  // the first surface below it within a storey is the floor of that plan.
  const hit = await rayHit(p.clone(), new THREE.Vector3(0, -1, 0), 8);
  const at = hit && hit.point ? hit.point.clone() : p.clone().setY(p.y - 1.2);
  if (S.gotoMarker) { S.overlay.remove(S.gotoMarker); S.gotoMarker = null; }
  await S.walk.startAt(at, new THREE.Vector3(0, 1, 0));
}

function wireEmbed() {
  document.body.classList.add("embed");
  addEventListener("message", (ev) => {
    if (ev.source !== parent || ev.origin !== location.origin) return;
    const m = ev.data || {};
    if (m.lwk !== 1) return;
    if (m.type === "goto") embedGoto(m).catch((e) => showError("goto", e));
    else if (m.type === "walk") S.walk && S.walk.begin();
    else if (m.type === "stop") S.walk && S.walk.stop();
    else if (m.type === "pins") { if (!!S.hidePins !== !m.show) document.getElementById("pins-toggle").click(); }
    else if (m.type === "depth") setDepthFx(!!m.on);
    else if (m.type === "hidedone") setHideDone(!!m.on);
    else if (m.type === "addissue") { if (S.walk && S.walk.on) S.walk.stop(); document.getElementById("m-issue").click(); }
  });
  toParent({ type: "hello" });
  (async () => {
    for (let i = 0; i < 900 && !(firstHostPart() && S.floorRows && S.floorRows.length); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    toParent({ type: "ready" });
  })();
  // What the status line says, for the bar on the sheets page.
  const st = document.getElementById("status");
  if (st) new MutationObserver(() => toParent({ type: "status", text: st.textContent }))
    .observe(st, { childList: true, characterData: true, subtree: true });
}
if (EMBED) wireEmbed();

/* ?debug in the address exposes the viewer's state to the browser console
   (LWK.S), for diagnosing a problem on someone's machine. */
if (new URLSearchParams(location.search).has("debug")) {
  window.LWK = { S, rayHit, sceneToInternalMM, internalToScene, importBcf, THREE, perfReport };
}

boot().catch((e) => showError("boot", e));
