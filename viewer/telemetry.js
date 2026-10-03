/* How the viewer copes on each device, reported to the server.
 *
 * Phones and tablets do not say why a page failed: Safari simply reloads
 * the tab ("A problem repeatedly occurred") when it runs out of memory, and
 * the WebGL context can be lost without any message. So the page keeps a
 * small heartbeat in the browser's storage while it runs, and the next page
 * that opens looks for heartbeats that stopped without the page closing -
 * that is how a crash is noticed. Besides that, a summary goes to the
 * server once the models are in and again when the page is left: what was
 * loaded, how much graphics memory it took, how smooth moving the view was.
 *
 * Nothing here changes how the viewer draws; it only watches.
 */

const BEAT_MS = 5000;
const KEY = "lwk:tele:";                 // + session id
const STALE_MS = 15000;                  // a live page beats every 5 s

const T = {
  sid: Math.random().toString(36).slice(2, 10),
  page: "",
  project: "",
  started: Date.now(),
  snapshot: () => ({}),
  peak: { gpuMB: 0, cpuMB: 0, tris: 0, heapMB: 0, calls: 0 },
  // frame gaps while the view moves (ms)
  moving: [],
  stalls: 0, worstStall: 0,
  events: [],
  sent: 0,
  lastSent: 0,
  hidden: false,
  token: () => "",
};

function device() {
  const ua = navigator.userAgent;
  let kind = "computer";
  if (/iPhone|iPod/.test(ua)) kind = "iPhone";
  else if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) kind = "iPad";
  else if (/Android/.test(ua)) kind = /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  let browser = "other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/CriOS|Chrome\//.test(ua)) browser = "Chrome";
  else if (/FxiOS|Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  const os = (ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Android (\d+)/) || [])[0] || "";
  return { kind, browser, os: os.replace(/_/g, "."), ua,
           screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
           memoryGB: navigator.deviceMemory || null, cores: navigator.hardwareConcurrency || null };
}

function gpuOf(renderer) {
  try {
    if (renderer.backend && renderer.backend.isWebGPUBackend) {
      const i = (renderer.backend.adapter && renderer.backend.adapter.info) || {};
      return "WebGPU " + [i.vendor, i.architecture, i.description].filter(Boolean).join(" ");
    }
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch (e) { return ""; }
}

function pct(arr, p) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

function report(event, extra) {
  const snap = safeSnap();
  const gaps = T.moving;
  const body = {
    sid: T.sid, event, page: T.page, project: T.project,
    at: new Date().toISOString(), up_s: Math.round((Date.now() - T.started) / 1000),
    device: T.device, gpu: T.gpu,
    peak: T.peak, now: snap,
    moving: gaps.length ? {
      frames: gaps.length,
      fps_median: Math.round(1000 / pct(gaps, 0.5)),
      fps_worst10: Math.round(1000 / pct(gaps, 0.9)),
    } : null,
    stalls: T.stalls, worst_stall_ms: Math.round(T.worstStall),
    events: T.events.slice(-20),
    extra: extra || null,
    token: T.token(),
  };
  const json = JSON.stringify(body);
  T.sent++;
  T.lastSent = Date.now();
  try {
    if (event === "leave" || event === "hidden") {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/telemetry", new Blob([json], { type: "application/json" }))) return;
    }
    fetch("/api/telemetry", { method: "POST", keepalive: json.length < 60000,
      headers: { "Content-Type": "application/json", "X-Viewer-Token": T.token() }, body: json })
      .catch(() => {});
  } catch (e) { /* never in the way */ }
}

function safeSnap() {
  try { return T.snapshot() || {}; } catch (e) { return { error: String(e && e.message || e) }; }
}

function beat() {
  const snap = safeSnap();
  for (const k of ["gpuMB", "cpuMB", "tris", "heapMB", "calls"]) {
    if (typeof snap[k] === "number" && snap[k] > T.peak[k]) T.peak[k] = Math.round(snap[k] * 10) / 10;
  }
  try {
    localStorage.setItem(KEY + T.sid, JSON.stringify({
      sid: T.sid, page: T.page, project: T.project, at: Date.now(), started: T.started, hidden: T.hidden,
      device: T.device, gpu: T.gpu, peak: T.peak, snap, events: T.events.slice(-12), stage: T.stage || "",
    }));
  } catch (e) { /* storage full or blocked */ }
}

/* Pages that stopped beating without closing. A page closed while in the
   background is not a crash (the phone freed it); one that stopped while
   on screen is - most likely Safari running out of memory. */
function findCrashes() {
  let keys = [];
  try { keys = Object.keys(localStorage).filter((k) => k.startsWith(KEY)); } catch (e) { return; }
  for (const k of keys) {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(k)); } catch (e) {}
    if (!v || v.sid === T.sid) continue;
    if (Date.now() - v.at < STALE_MS) continue;          // another tab, alive
    try { localStorage.removeItem(k); } catch (e) {}
    if (Date.now() - v.at > 3 * 86400e3) continue;        // too old to matter
    const body = {
      sid: v.sid, event: v.hidden ? "gone-in-background" : "crash",
      page: v.page, project: v.project, at: new Date(v.at).toISOString(),
      device: v.device, gpu: v.gpu, peak: v.peak, now: v.snap, events: v.events,
      // how long the page had been open, and what it was doing when it stopped
      up_s: v.started ? Math.round((v.at - v.started) / 1000) : null,
      extra: { stage: v.stage || "", noticed_after_s: Math.round((Date.now() - v.at) / 1000) },
      noticed_by: T.sid, token: T.token(),
    };
    try {
      fetch("/api/telemetry", { method: "POST",
        headers: { "Content-Type": "application/json", "X-Viewer-Token": T.token() },
        body: JSON.stringify(body) }).catch(() => {});
    } catch (e) {}
  }
}

/* Start watching. opts: page ("3d" / "sheets"), project, renderer,
   snapshot() -> { gpuMB, cpuMB, tris, calls, heapMB, models: [...] },
   token() -> the sign-in token. */
export function startTelemetry(opts) {
  if (new URLSearchParams(location.search).get("telemetry") === "0") return null;
  T.page = opts.page || "";
  T.project = opts.project || "";
  T.snapshot = opts.snapshot || T.snapshot;
  T.token = opts.token || T.token;
  T.device = device();
  T.gpu = opts.renderer ? gpuOf(opts.renderer) : "";
  findCrashes();
  /* Safari reloads a page it ran out of memory on straight away - sooner
     than a heartbeat counts as stopped - so look again a little later:
     the page that died is then reported by the one that replaced it,
     not hours afterwards by the next visit. */
  setTimeout(findCrashes, STALE_MS + 6000);
  beat();
  setInterval(beat, BEAT_MS);
  document.addEventListener("visibilitychange", () => {
    T.hidden = document.visibilityState === "hidden";
    beat();
    if (T.hidden && Date.now() - T.lastSent > 30000) report("hidden");
  });
  addEventListener("pagehide", () => {
    report("leave");
    try { localStorage.removeItem(KEY + T.sid); } catch (e) {}
  });
  if (opts.renderer) {
    const cv = opts.renderer.domElement;
    cv.addEventListener("webglcontextlost", () => { note("context lost"); report("context-lost"); });
    cv.addEventListener("webglcontextrestored", () => note("context restored"));
  }
  return { note, frame, ready, report };
}

/* Something worth knowing afterwards (a model loaded, a mode changed). */
export function note(text) {
  T.events.push([Math.round((Date.now() - T.started) / 1000), String(text).slice(0, 160)]);
  if (T.events.length > 60) T.events.splice(0, T.events.length - 60);
  /* Written down at once: a page that dies while loading used to take its
     last notes with it (the heartbeat is every 5 s), which left a crash
     report with nothing in it. */
  T.stage = String(text).slice(0, 160);
  if (T.device) beat();
}

/* Every animation frame: the gap since the last one, and whether the view
   was moving (only moving frames say how smooth it feels). */
export function frame(gapMs, moving) {
  if (gapMs > 250 && document.visibilityState === "visible") {
    T.stalls++;
    if (gapMs > T.worstStall) T.worstStall = gapMs;
  }
  if (moving && gapMs > 0 && gapMs < 2000) {
    T.moving.push(gapMs);
    if (T.moving.length > 3000) T.moving.splice(0, 1000);
  }
}

/* The models are in: one summary a little later (the first views count). */
export function ready() {
  setTimeout(() => { beat(); report("loaded"); }, 20000);
}
