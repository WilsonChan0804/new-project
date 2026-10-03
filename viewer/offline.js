/* Working offline.
 *
 * Site staff download a project to the device - its sheets, its 3D model -
 * and carry on with no signal: look at the drawings and the model, raise
 * and answer issues, draw markups. What they did uploads by itself when
 * the connection is back.
 *
 * Three parts work together:
 *
 *   sw.js      the service worker: serves the viewer and a downloaded
 *              project from the device when the network does not answer.
 *   store.js   keeps the items and the queue of changes made offline
 *              (IndexedDB), uploads the queue, merges with what others did.
 *   this file  registers the worker; downloads / updates / removes a
 *              project's offline copy (it runs in the page, so a long
 *              download shows progress and is not cut off when the browser
 *              stops an idle worker); and shows the state in the header:
 *              nothing when all is normal, "Offline - copy of <date>",
 *              "N changes waiting", "All changes uploaded".
 *
 * What a copy holds is exactly what THIS device would ask the server for:
 * a phone or tablet takes the streamed tiles of a model (or its phone copy)
 * and the picture tiles of the sheets; a computer takes the whole model
 * file. The rules mirror model.js (S.lowMemory, S.tiles, PHONE_WHOLE_MAX_MB)
 * and app.js (wantTiles); nothing here changes what those pages load, or
 * the memory budget they keep to.
 *
 * Files are streamed straight from the network into Cache Storage, one at a
 * time per lane - never held whole in memory - into
 *   lwk-data-<project>   whole files, keyed by their /data/... path
 *   lwk-snap-v1          issue pictures
 *   lwk-cdn-v1           pdf.js
 * and the record of the copy (which files, their tags, when) in IndexedDB,
 * with a short summary in localStorage for code that cannot wait.
 */

import * as Store from "./store.js";
import * as DB from "./idb.js";

const CDN_CACHE = "lwk-cdn-v1";
const API_CACHE = "lwk-api-v1";
const SNAP_CACHE = "lwk-snap-v1";
const dataCache = (p) => "lwk-data-" + encodeURIComponent(p);
const COPIES_KEY = "lwk-offline:copies";
const SESSION_KEY = "lwk-offline:session-user";
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

const QS = new URLSearchParams(location.search);
const EMBED = QS.get("embed") === "1";
const VIEWER_PAGE = !!document.getElementById("gate") && !document.body.classList.contains("own-nav");
const PAGE_3D = !!document.getElementById("canvas-wrap");
const HAS_SW = "serviceWorker" in navigator && typeof caches !== "undefined";

/* The same tests as model.js (S.lowMemory) and app.js (IS_MOBILE_UA). */
const UA_MOBILE = /iP(hone|ad|od)|Android/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const LOW_MEMORY = UA_MOBILE || (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2);
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = (() => {
  try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
  catch (e) { return false; }
})();
const PHONE_WHOLE_MAX_MB = 12;              // model.js: the biggest model a phone opens whole

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const proj = () => Store.currentProject() || "default";

function size(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return Math.round(n / 1024) + " kB";
  if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB";
  return (n / 1073741824).toFixed(1) + " GB";
}
function when(t, long) {
  const d = new Date(t);
  if (isNaN(d)) return "";
  const o = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  if (long || d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return d.toLocaleString(undefined, o);
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : (many || one + "s"));

/* ------------------------------------------------------------- the worker */

let REG = null;

async function registerWorker() {
  if (!HAS_SW) return null;
  try {
    REG = await navigator.serviceWorker.register("sw.js");
  } catch (e) {
    console.warn("offline: the service worker could not be registered", e);
    REG = null;
  }
  return REG;
}

/* Is a worker in charge of this page (its requests go through it)? */
async function controlled(ms) {
  if (!HAS_SW || !REG) return false;
  if (navigator.serviceWorker.controller) return true;
  await Promise.race([
    new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true })),
    new Promise((r) => setTimeout(r, ms || 6000)),
  ]);
  return !!navigator.serviceWorker.controller;
}

function ask(msg, ms) {
  return new Promise((resolve) => {
    const w = HAS_SW && (navigator.serviceWorker.controller || (REG && (REG.active || REG.waiting || REG.installing)));
    if (!w) return resolve(null);
    let done = false;
    const ch = new MessageChannel();
    ch.port1.onmessage = (ev) => { done = true; resolve(ev.data); };
    try { w.postMessage(msg, [ch.port2]); } catch (e) { return resolve(null); }
    setTimeout(() => { if (!done) resolve(null); }, ms || 20000);
  });
}

/* ------------------------------------------------------- record of copies */

const copies = () => Store.offlineCopies();
const copyOf = (p) => copies()[p || proj()] || null;

function mirror(project, rec) {
  const all = copies();
  if (rec) all[project] = rec; else delete all[project];
  try { localStorage.setItem(COPIES_KEY, JSON.stringify(all)); } catch (e) {}
}
async function loadMeta(project) {
  return (await DB.kvGet("copy|" + project)) || null;
}
async function saveMeta(meta) {
  await DB.kvSet("copy|" + meta.project, meta);
  const was = copyOf(meta.project) || {};
  mirror(meta.project, {
    title: meta.title, at: meta.at, bytes: meta.bytes, parts: meta.parts, state: meta.state,
    user: meta.user, count: Object.keys(meta.files || {}).length, device: meta.device,
    update: meta.state === "complete" ? (was.update || null) : null,
  });
}

/* --------------------------------------------------------------- the plan */

/* Would this computer stream a model's tiles rather than read it whole?
   (model.js, S.tiles - a slow line, or the Performance panel's choice.) */
function desktopStreams() {
  const q = QS.get("tiles");
  if (q === "1" || q === "0") return q === "1";
  try { const v = localStorage.getItem("lwk.tiles"); if (v === "1" || v === "0") return v === "1"; } catch (e) {}
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || "") || (c.downlink && c.downlink < 5))) return true;
  try { const m = Number(localStorage.getItem("lwk.lastMbps")); if (m > 0 && m < 30) return true; } catch (e) {}
  return false;
}
/* Would sheets be shown from the server's pictures here? (app.js, wantTiles:
   phones and tablets, and a computer on a slow line.) */
function sheetTilesGenerally() {
  if (UA_MOBILE) return true;
  const c = navigator.connection;
  return !!(c && (c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || "") || (c.downlink && c.downlink < 3)));
}
function sheetTilesHere(sh, opts) {
  let mode = QS.get("draw");
  if (!mode) { try { mode = localStorage.getItem("lwk.sheetDraw"); } catch (e) {} }
  if (mode === "pdf") return false;
  if (mode === "tiles") return true;
  if (opts.sheetTiles || (sh.bytes || 0) > 6e6) return true;
  return false;
}
/* The choices that depend on the line's speed are made once per copy and
   kept (they may be added to, never dropped): a copy must not look out of
   date just because the connection is faster or slower today.
   fixed = go only by what the copy was made with (for "is there an update?"). */
function deviceOpts(prev, fixed) {
  const now = fixed ? {} : { sheetTiles: sheetTilesGenerally(), modelTiles: LOW_MEMORY || desktopStreams() };
  return { sheetTiles: !!((prev && prev.sheetTiles) || now.sheetTiles),
           modelTiles: !!((prev && prev.modelTiles) || now.modelTiles) };
}

/* What this device would ask the server for, with sizes.
   parts: { sheets, model }. */
async function planFor(project, parts, fixed) {
  const plan = await Store.api("/api/offline/plan?project=" + encodeURIComponent(project));
  const prev = await loadMeta(project);
  const opts = deviceOpts(prev && prev.opts, fixed);
  const files = new Map();                  // path -> { rel, bytes, tag, part }
  const apis = [];
  const notes = [];
  const sums = { sheets: 0, model: 0 };
  const count = (part) => {
    let n = 0;
    for (const f of files.values()) if (f.part === part) n += f.bytes;
    return n;
  };
  const all = { sheets: [], model: [] };
  const seen = new Set();
  const add = (f, part) => {
    if (!f || seen.has(f.path)) return;
    seen.add(f.path);
    const rec = { rel: f.path, bytes: f.bytes, tag: f.tag, part };
    all[part].push(rec);
    if (parts[part]) files.set(f.path, rec);
  };

  for (const sh of plan.sheets || []) {
    add({ path: sh.pdf, bytes: sh.bytes, tag: sh.tag }, "sheets");
    const q = "pdf=" + encodeURIComponent(sh.pdf) + "&page=" + (sh.page || 1)
      + "&project=" + encodeURIComponent(project);
    if (parts.sheets) apis.push("/api/sheet-text?" + q);
    if (sh.tiles && sheetTilesHere(sh, opts)) {
      add(sh.tiles, "sheets");
      if (parts.sheets) apis.push("/api/sheet-tiles?" + q);
    }
  }

  for (const m of plan.models || []) {
    const by = (use) => (m.files || []).filter((f) => f.use === use);
    const whole = by("whole")[0], tidx = by("tidx")[0], tbin = by("tbin")[0];
    if (m.format !== "lwkm") { add(whole, "model"); by("props").forEach((f) => add(f, "model")); continue; }
    by("ext").forEach((f) => add(f, "model"));
    by("props").forEach((f) => add(f, "model"));
    if (LOW_MEMORY) {
      if (m.tiles && tidx && tbin) { add(tidx, "model"); add(tbin, "model"); }
      else {
        by("mobile").forEach((f) => add(f, "model"));
        if (whole && whole.bytes <= PHONE_WHOLE_MAX_MB * 1048576) add(whole, "model");
        else if (whole && !by("mobile").length) {
          notes.push(`${m.name}: not prepared for phones and tablets yet (${size(whole.bytes)}) - it is left out, as it is online.`);
        }
      }
    } else {
      add(whole, "model");
      if (m.tiles && tidx && tbin && opts.modelTiles) { add(tidx, "model"); add(tbin, "model"); }
    }
  }
  for (const part of ["sheets", "model"]) sums[part] = all[part].reduce((n, f) => n + f.bytes, 0);
  return {
    plan, project, opts, title: plan.title, files: Array.from(files.values()), apis, notes,
    bytes: count("sheets") + count("model"),
    sheets: { n: (plan.sheets || []).length, bytes: sums.sheets },
    model: { n: (plan.models || []).length, bytes: sums.model },
  };
}

/* --------------------------------------------------------------- download */

const pathOf = (url) => new URL(url, location.origin).pathname;
const tagOf = (res) => String(res.headers.get("ETag") || "").replace(/^W\//, "").replace(/"/g, "");

/* One file, streamed from the network into a cache. The copy is stored
   with headers of our own making: what a proxy added in transit (an
   encoding, a length of the compressed body) is not true of the stored
   bytes. Returns its tag and size. */
async function fetchInto(cache, url, signal, onBytes, size) {
  // the sign-in travels in the header as well: the cookie the file requests
  // normally go by may have run out, and this renews it
  const auth = {};
  const t = Store.authHeaders()["X-Viewer-Token"];
  if (t) auth["X-Viewer-Token"] = t;
  const res = await fetch(url, { cache: "no-cache", credentials: "same-origin", headers: auth, signal });
  if (res.headers.get("X-LWK-Offline")) throw new Error("no connection");
  if (!res.ok) {
    const err = new Error(pathOf(url).split("/").pop() + ": HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  const h = new Headers();
  for (const k of ["Content-Type", "ETag", "Last-Modified"]) {
    const v = res.headers.get(k);
    if (v) h.set(k, v);
  }
  /* The length matters: with it (and Accept-Ranges, which the worker adds)
     pdf.js reads a big drawing in pieces from the device, as it does from
     the server, instead of taking the whole file into memory. It is the
     length of the stored bytes - the server's file size from the plan. */
  if (size > 0) h.set("Content-Length", String(size));
  let n = 0;
  let body = res.body;
  if (body && typeof TransformStream !== "undefined") {
    body = body.pipeThrough(new TransformStream({
      transform(chunk, ctl) { n += chunk.byteLength; if (onBytes) onBytes(chunk.byteLength); ctl.enqueue(chunk); },
    }));
    await cache.put(pathOf(url), new Response(body, { status: 200, headers: h }));
  } else {
    // an older browser: the file is read, then stored (one file in memory at a time)
    const blob = await res.blob();
    n = blob.size;
    if (onBytes) onBytes(n);
    await cache.put(pathOf(url), new Response(blob, { status: 200, headers: h }));
  }
  if (size > 0 && n !== size) {
    // the file changed between the plan and the download: store it again with its real length
    const blob = await (await cache.match(pathOf(url))).blob();
    h.set("Content-Length", String(blob.size));
    await cache.put(pathOf(url), new Response(blob, { status: 200, headers: h }));
    n = blob.size;
  }
  return { tag: tagOf(res), bytes: n };
}

async function cacheCdn(signal) {
  if (typeof caches === "undefined") return false;
  const urls = new Set([PDFJS + "pdf.min.js", PDFJS + "pdf.worker.min.js"]);
  for (const s of document.querySelectorAll("script[src^='https://cdnjs.cloudflare.com/']")) urls.add(s.src);
  try {
    const w = window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions && window.pdfjsLib.GlobalWorkerOptions.workerSrc;
    if (w && /^https:\/\/cdnjs\.cloudflare\.com\//.test(w)) urls.add(w);
  } catch (e) {}
  const c = await caches.open(CDN_CACHE);
  let ok = true;
  for (const u of urls) {
    if (await c.match(u)) continue;
    try {
      let r;
      try { r = await fetch(u, { mode: "cors", credentials: "omit", signal }); }
      catch (e) { r = await fetch(u, { mode: "no-cors", signal }); }
      if (r.ok || r.type === "opaque") await c.put(u, r); else ok = false;
    } catch (e) { ok = false; }
  }
  return ok;
}

/* The strings in the items that name a picture on the server. */
function snapshotPaths(items) {
  const out = new Set();
  const walk = (v, depth) => {
    if (typeof v === "string") { if (/^\/snapshots\/[0-9a-f]{8,40}\.(jpg|png)$/.test(v)) out.add(v); return; }
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) { for (const x of v) if (typeof x !== "number") walk(x, depth + 1); return; }
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  for (const it of items) walk(it, 0);
  return Array.from(out);
}

/* The pictures of this project's issues, kept beside the copy; brought up
   to date quietly while online, so a copy's issues can always be read. */
let _snapBusy = false;
async function cacheSnapshots(project, signal) {
  if (_snapBusy || typeof caches === "undefined" || project !== proj()) return 0;
  _snapBusy = true;
  let added = 0;
  try {
    const c = await caches.open(SNAP_CACHE);
    const paths = snapshotPaths(Store.all());
    const meta = await loadMeta(project);
    const known = new Set((meta && meta.snaps) || []);
    for (const p of paths) {
      if (signal && signal.aborted) break;
      if (await c.match(p)) { known.add(p); continue; }
      try {
        const r = await fetch(p, { credentials: "same-origin", signal });
        if (r.ok && !r.headers.get("X-LWK-Offline")) { await c.put(p, r); known.add(p); added++; }
      } catch (e) { break; }
    }
    if (meta && (added || known.size !== ((meta.snaps || []).length))) {
      const fresh = (await loadMeta(project)) || meta;
      fresh.snaps = Array.from(known);
      await saveMeta(fresh);
    }
  } finally { _snapBusy = false; }
  return added;
}

/* The answers a page asks for when it starts, fetched once through the
   worker so it has them to fall back on. */
async function primeApi(apis, signal) {
  if (!(await controlled(3000))) return;
  const head = Store.authHeaders();
  const first = ["/api/ping", "/api/me", "/api/projects", "/api/members", "/api/layers", "/api/templates"];
  const queue = first.concat(apis || []);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      if (signal && signal.aborted) return;
      const u = queue.shift();
      try { await fetch(u, u === "/api/ping" ? {} : { headers: head, credentials: "same-origin", signal }); }
      catch (e) { /* that answer is simply not there offline */ }
    }
  }));
}

const JOB = { running: false, ac: null, done: 0, total: 0, files: 0, of: 0, note: "", error: "" };

/* Download (or bring up to date) the offline copy of the current project.
   Only files whose tag differs from the one on the device are fetched. */
async function download(parts) {
  if (JOB.running) return;
  const project = proj();
  Object.assign(JOB, { running: true, ac: new AbortController(), done: 0, total: 0, files: 0, of: 0,
                       note: "Getting ready ...", error: "" });
  const signal = JOB.ac.signal;
  paint();
  let meta = null;
  try {
    if (navigator.storage && navigator.storage.persist) {
      try { UI.persisted = await navigator.storage.persist(); } catch (e) {}
    }
    // 1. the viewer itself, as one complete set, and pdf.js
    if (await controlled(8000)) {
      const r = await ask({ type: "refresh-shell" }, 120000);
      if (!r || !r.ok) throw new Error("the viewer's own files could not be kept (no connection?)");
    } else if (HAS_SW) {
      throw new Error("the offline service of this browser did not start - reload the page and try again");
    } else {
      throw new Error("this browser cannot keep pages for offline use (a private window, or an http:// address)");
    }
    await cacheCdn(signal);

    // 2. what this device needs of the project
    const want = await planFor(project, parts);
    UI.plan = null;
    meta = (await loadMeta(project)) || { project, files: {}, snaps: [] };
    const hadComplete = meta.state === "complete";
    Object.assign(meta, { title: want.title, user: Store.userKey(), device: LOW_MEMORY ? "phone" : "computer", opts: want.opts });
    const main = await caches.open(dataCache(project));
    // an update is fetched beside the copy and swapped in whole, so a model's
    // index and its pieces are never from two different exports
    const stageName = dataCache(project) + "~next";
    const stage = hadComplete ? await caches.open(stageName) : main;

    const todo = [];
    for (const f of want.files) {
      const url = Store.dataUrl(f.rel);
      const have = meta.files[f.rel];
      if (have && have.tag === f.tag && (await main.match(pathOf(url)))) continue;
      if (hadComplete) {
        const st = await stage.match(pathOf(url));
        if (st && tagOf(st) === f.tag) { f.staged = true; todo.push(f); continue; }
      }
      todo.push(f);
    }
    JOB.total = todo.reduce((n, f) => n + (f.staged ? 0 : f.bytes), 0);
    JOB.of = todo.length;
    JOB.note = "";
    if (!hadComplete) { meta.state = "partial"; meta.parts = parts; await saveMeta(meta); }
    paint();

    const fresh = {};
    const queue = todo.slice();
    let failed = null;
    await Promise.all(Array.from({ length: LOW_MEMORY ? 2 : 3 }, async () => {
      while (queue.length && !failed && !signal.aborted) {
        const f = queue.shift();
        try {
          if (!f.staged) {
            const got = await fetchInto(stage, Store.dataUrl(f.rel), signal, (n) => { JOB.done += n; progress(); }, f.bytes);
            fresh[f.rel] = { tag: got.tag || f.tag, bytes: got.bytes || f.bytes, part: f.part };
          } else {
            fresh[f.rel] = { tag: f.tag, bytes: f.bytes, part: f.part };
          }
          JOB.files++;
          if (!hadComplete) meta.files[f.rel] = fresh[f.rel];
          progress();
        } catch (e) { failed = e; }
      }
    }));
    if (!hadComplete) await saveMeta(meta);
    if (signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
    if (failed) throw failed;

    // 3. the manifest as it is now, the start-up answers, the issue pictures
    JOB.note = "Finishing ...";
    progress();
    const man = await fetchInto(stage, Store.dataUrl("manifest.json"), signal);
    fresh["manifest.json"] = { tag: man.tag || String(Date.now()), bytes: man.bytes, part: "base" };
    await primeApi(want.apis, signal);

    // 4. swap the update in, and drop what is no longer wanted
    if (hadComplete) {
      for (const rel of Object.keys(fresh)) {
        const key = pathOf(Store.dataUrl(rel));
        const r = await stage.match(key);
        if (r) await main.put(key, r);
      }
      await caches.delete(stageName);
    }
    const keep = new Set(want.files.map((f) => f.rel).concat(["manifest.json"]));
    for (const rel of Object.keys(meta.files)) {
      if (!keep.has(rel)) { await main.delete(pathOf(Store.dataUrl(rel))); delete meta.files[rel]; }
    }
    Object.assign(meta.files, fresh);
    meta.parts = parts;
    meta.state = "complete";
    meta.at = Date.now();
    meta.bytes = Object.values(meta.files).reduce((n, f) => n + (f.bytes || 0), 0);
    meta.notes = want.notes;
    await saveMeta(meta);
    const rec = copyOf(project);
    if (rec) { rec.update = null; mirror(project, rec); }
    await cacheSnapshots(project, signal);
    UI.update = { count: 0, bytes: 0, at: Date.now() };
    toast(hadComplete ? "The offline copy is up to date." : "This project is now available offline on this device.");
  } catch (e) {
    if (e && (e.cancelled || e.name === "AbortError")) JOB.error = "Stopped. What was downloaded is kept - Continue download carries on from there.";
    else if (e && e.name === "QuotaExceededError") JOB.error = "Not enough free space on this device for the offline copy.";
    else JOB.error = "The download stopped: " + ((e && e.message) || e) + ". What was downloaded is kept - try again to carry on.";
  } finally {
    JOB.running = false;
    JOB.ac = null;
    UI.est = null;
    paint();
    renderDialog();
    if (UI.back && !UI.back.hidden) refreshDialogData();     // sizes and "up to date" as they are now
  }
}

/* A cache, emptied entry by entry and then deleted. caches.delete() alone
   only unlists it: Chrome gives the space back when the last handle on the
   cache is let go, which with a running service worker can be the next
   start of the browser. Emptied first, the space is free at once. */
async function dropCache(name) {
  try {
    if (!(await caches.has(name))) return;
    const c = await caches.open(name);
    for (const req of await c.keys()) await c.delete(req);
    await caches.delete(name);
  } catch (e) { /* what could be removed, was */ }
}

async function removeCopy(project) {
  const meta = await loadMeta(project);
  try {
    await dropCache(dataCache(project));
    await dropCache(dataCache(project) + "~next");
    const left = Object.keys(copies()).filter((p) => p !== project);
    if (!left.length) {
      await dropCache(SNAP_CACHE);
    } else if (meta && meta.snaps && meta.snaps.length) {
      const c = await caches.open(SNAP_CACHE);
      for (const p of meta.snaps) await c.delete(p);
    }
    const api = await caches.open(API_CACHE);
    const prefix = "/__api/" + encodeURIComponent(project) + "/";
    for (const req of await api.keys()) {
      if (new URL(req.url).pathname.startsWith(prefix)) await api.delete(req);
    }
  } catch (e) { /* what could be removed, was */ }
  await DB.kvDel("copy|" + project);
  mirror(project, null);
  if (project === proj()) { UI.update = null; UI.plan = null; }
  UI.est = null;
}

/* Has the server newer files than the copy? Only what changed would be
   fetched; this counts it. */
async function checkUpdate(project) {
  const meta = await loadMeta(project);
  if (!meta || meta.state !== "complete") return null;
  const want = await planFor(project, meta.parts || { sheets: true, model: true }, true);
  let n = 0, bytes = 0;
  for (const f of want.files) {
    const have = meta.files[f.rel];
    if (!have || have.tag !== f.tag) { n++; bytes += f.bytes; }
  }
  // the manifest is rebuilt by the server on every request: compared by content
  // (a sheet or a model taken away shows there)
  try {
    const key = pathOf(Store.dataUrl("manifest.json"));
    const kept = await (await caches.open(dataCache(project))).match(key);
    const now = await fetch(Store.dataUrl("manifest.json"), { cache: "no-store", credentials: "same-origin" });
    if (kept && now.ok && !now.headers.get("X-LWK-Offline") && (await kept.text()) !== (await now.text())) n = Math.max(n, 1);
  } catch (e) {}
  const up = { count: n, bytes, at: Date.now() };
  const rec = copyOf(project);
  if (rec) { rec.update = n ? up : null; mirror(project, rec); }
  return up;
}

/* ------------------------------------------------------------ connection */

/* What the header goes by. Once the page's store runs, its poll is the
   truth (it asks the server every five seconds); before that - the sign-in
   form, a page that could not start - one small request of our own. */
const NETSTATE = { probe: null };
async function probe() {
  if (navigator.onLine === false) { NETSTATE.probe = false; return false; }
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    NETSTATE.probe = r.ok && !r.headers.get("X-LWK-Offline");
  } catch (e) { NETSTATE.probe = false; }
  return NETSTATE.probe;
}
/* Has the store's first request to the server come back, one way or the other? */
const decided = (st) => !!st.decided;
function isOnline() {
  const st = Store.state();
  if (navigator.onLine === false) return false;
  if (decided(st)) return st.online;
  return NETSTATE.probe !== false;
}

/* --------------------------------------------------------------- the header */

const ICON = `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 .5 8.47"/><path d="M12 11v8"/><path d="m8.5 16 3.5 3.5 3.5-3.5"/></svg>`;
const ICON_OFF = `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 1.7-3.2M11 4.1A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 1.9 7.9"/><path d="M3 3l18 18"/></svg>`;
const ICON_UP = `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 .5 8.47"/><path d="M12 20v-8"/><path d="m8.5 15.5 3.5-3.5 3.5 3.5"/></svg>`;
const ICON_OK = `<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

const UI = {
  btn: null, pill: null, back: null,
  plan: null, planErr: "", planFor: "", est: null, persisted: null,
  parts: null, update: null, elsewhere: null,
  wasPending: 0, doneUntil: 0, told: false, noticeShown: false,
};

function buildHeader() {
  const conn = document.getElementById("conn");
  const header = document.querySelector("header");
  if (!header || UI.btn) return;
  const b = document.createElement("button");
  b.id = "off-btn";
  b.type = "button";
  b.className = "ghost";
  b.title = "Work offline: keep this project on this device, and see what is waiting to upload";
  b.innerHTML = ICON + `<span class="lab">Offline</span>`;
  if (conn && conn.parentElement === header) conn.after(b); else header.appendChild(b);
  b.addEventListener("click", () => openDialog());
  UI.btn = b;
  // phones: the header has no room for a sentence; it goes in a small pill over the view
  const p = document.createElement("button");
  p.id = "off-pill";
  p.type = "button";
  p.hidden = true;
  p.addEventListener("click", () => openDialog());
  document.body.appendChild(p);
  UI.pill = p;
}

/* What to say, if anything. */
function headline() {
  const st = Store.state();
  const online = isOnline();
  const n = st.pending;
  const c = copyOf();
  const waiting = n ? plural(n, "change") + " waiting" : "";
  if (JOB.running) {
    const pct = JOB.total ? Math.min(100, Math.round(100 * JOB.done / JOB.total)) : 0;
    return { cls: "is-busy", icon: ICON, text: "Downloading " + pct + "%", short: pct + "%",
             title: "Downloading this project for offline use" };
  }
  if (!online) {
    let text, title;
    if (c && c.state === "complete") {
      text = "Offline - copy of " + when(c.at);
      title = "No connection. Working from the copy downloaded on " + when(c.at, true) + ".";
    } else if (c) {
      text = "Offline - copy incomplete";
      title = "No connection, and the download of this project was not finished.";
    } else {
      text = "Offline - no copy here";
      title = "No connection, and this project is not kept on this device.";
    }
    const pill = text + (n ? " - " + n + " to upload" : "");
    if (n) { text += " - " + waiting; title += " " + plural(n, "change") + " will upload when the connection is back."; }
    return { cls: "is-off", icon: ICON_OFF, text, pill, short: n ? "Offline - " + n : "Offline", title };
  }
  if (st.auth === "needed" && n) {
    return { cls: "is-warn", icon: ICON_UP, text: "Sign in to upload " + plural(n, "change"), short: "Sign in - " + n,
             title: "Your sign-in has run out. Your changes are kept on this device; sign in again and they upload." };
  }
  if (n) {
    return { cls: "is-wait", icon: ICON_UP, text: st.uploading ? "Uploading " + plural(n, "change") + " ..." : waiting + " to upload",
             short: n + " waiting", title: "Changes made on this device that have not reached the server yet. They upload by themselves." };
  }
  if (Date.now() < UI.doneUntil) {
    return { cls: "is-done", icon: ICON_OK, text: "All changes uploaded", short: "Uploaded", title: "Everything made on this device is on the server." };
  }
  if (st.refused.length) {
    return { cls: "is-warn", icon: ICON_UP, text: plural(st.refused.length, "change") + " not accepted", short: "Check",
             title: "The server refused these changes. They are set aside - open to see why." };
  }
  if (st.volatile && st.started) return null;
  return null;
}

function paint() {
  if (!UI.btn) return;
  const st = Store.state();
  if (UI.wasPending > 0 && st.pending === 0 && isOnline() && decided(st)) {
    UI.doneUntil = Date.now() + 6000;
    setTimeout(paint, 6100);
  }
  UI.wasPending = st.pending;
  const h = headline();
  const c = copyOf();
  UI.btn.className = "ghost" + (h ? " on " + h.cls : "") + (c && c.update && c.update.count ? " has-update" : "");
  UI.btn.innerHTML = (h ? h.icon : ICON) + `<span class="lab">${esc(h ? h.text : "Offline")}</span>`
    + (h && h.short ? `<span class="short">${esc(h.short)}</span>` : "")
    + (c && c.update && c.update.count && !h ? `<i class="dot" title="Newer files on the server"></i>` : "");
  UI.btn.title = h ? h.title : (c && c.state === "complete"
    ? "This project is available offline (copy of " + when(c.at, true) + ")" + (c.update && c.update.count ? " - an update is available" : "")
    : "Work offline: keep this project on this device");
  document.body.classList.toggle("off-state", !!h);
  document.body.classList.toggle("lwk-offline", !isOnline());
  if (UI.pill) {
    UI.pill.hidden = !h;
    if (h) { UI.pill.className = h.cls; UI.pill.innerHTML = h.icon + `<span>${esc(h.pill || h.text)}</span>`; }
  }
  if (!UI.back || UI.back.hidden) return;
  progress();
}

/* ------------------------------------------------------------- the window */

function ensureDialog() {
  if (UI.back) return;
  const back = document.createElement("div");
  back.id = "off-back";
  back.hidden = true;
  back.innerHTML = `<div id="off-dlg" role="dialog" aria-label="Work offline">
      <div class="off-head"><b>Work offline</b><span id="off-net"></span><span class="spacer"></span>
        <button type="button" class="ghost" id="off-close" title="Close">&#10005;</button></div>
      <div id="off-body"></div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener("pointerdown", (ev) => { if (ev.target === back) closeDialog(); });
  back.querySelector("#off-close").addEventListener("click", closeDialog);
  back.querySelector("#off-body").addEventListener("click", onAct);
  back.querySelector("#off-body").addEventListener("change", onTick);
  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !back.hidden) { ev.stopPropagation(); closeDialog(); }
  }, true);
  UI.back = back;
}
function closeDialog() { if (UI.back) UI.back.hidden = true; }

async function openDialog() {
  ensureDialog();
  UI.back.hidden = false;
  renderDialog();
  refreshDialogData();
}

async function refreshDialogData() {
  const project = proj();
  const jobs = [];
  if (navigator.storage && navigator.storage.estimate) {
    jobs.push(navigator.storage.estimate().then((e) => { UI.est = e; }).catch(() => {}));
  }
  if (navigator.storage && navigator.storage.persisted) {
    jobs.push(navigator.storage.persisted().then((p) => { UI.persisted = p; }).catch(() => {}));
  }
  jobs.push(Store.queuedElsewhere().then((q) => { UI.elsewhere = q; }).catch(() => {}));
  if (!Store.state().started) jobs.push(probe());
  await Promise.all(jobs);
  renderDialog();
  if (!isOnline() || JOB.running) return;
  try {
    const c = copyOf(project);
    if (!UI.parts) UI.parts = (c && c.parts) ? Object.assign({}, c.parts) : { sheets: true, model: true };
    UI.planErr = "";
    UI.plan = await planFor(project, UI.parts);
    UI.planFor = project;
    if (c && c.state === "complete") UI.update = await checkUpdate(project);
  } catch (e) {
    UI.plan = null;
    UI.planErr = e.status === 404 ? "This server does not offer offline copies yet (it needs updating)."
      : e.status === 401 ? "Sign in first." : "The project's file list could not be read (" + e.message + ").";
  }
  renderDialog();
  paint();
}

function partsLine(parts) {
  const out = [];
  if (parts && parts.sheets) out.push("sheets");
  if (parts && parts.model) out.push("3D model");
  return out.join(" and ") || "nothing";
}

function renderDialog() {
  if (!UI.back || UI.back.hidden) return;
  const st = Store.state();
  const online = isOnline();
  const project = proj();
  const c = copyOf(project);
  const net = UI.back.querySelector("#off-net");
  net.className = online ? "ok" : "off";
  net.textContent = online ? "Connected" : "No connection";
  let h = "";

  // ---- changes made on this device
  const n = st.pending;
  if (n || st.refused.length || st.notices.length || (UI.elsewhere && Object.keys(UI.elsewhere).length) || st.volatile) {
    h += `<section class="off-sec"><h4>Your changes</h4>`;
    if (n) {
      h += `<div class="off-row"><div class="off-grow"><b>${plural(n, "change")} waiting to upload</b><div class="muted">`
        + (st.auth === "needed" && online ? "Your sign-in has run out. They are kept on this device and upload once you have signed in again."
          : online ? (st.uploading ? "Uploading now ..." : "They upload by themselves; this can take a few seconds.")
            : "Kept on this device. They upload by themselves when the connection is back - nothing to do.")
        + `</div></div>`
        + (st.auth === "needed" && online ? `<button data-act="signin">Sign in</button>`
          : `<button data-act="sync"${online ? "" : " disabled"}>Sync now</button>`)
        + `</div>`;
    } else if (st.started && online) {
      h += `<div class="off-row"><div class="off-grow"><b class="okc">${st.refused.length ? "Everything else has been uploaded" : "All changes uploaded"}</b></div></div>`;
    }
    if (st.volatile && st.started) {
      h += `<div class="off-warn">This browser gives the viewer nowhere to keep changes (a private window?). `
        + `Changes made without a connection last only while this page stays open.</div>`;
    }
    for (const r of st.refused) {
      h += `<div class="off-row off-item"><div class="off-grow"><b>${esc(r.title || "A change")}</b> was not accepted`
        + `<div class="muted">${esc(r.error || "refused by the server")} - set aside on this device, not sent again.</div></div>`
        + `<button class="ghost" data-act="retry" data-id="${esc(r.id)}"${online ? "" : " disabled"}>Try again</button>`
        + `<button class="ghost danger" data-act="discard" data-id="${esc(r.id)}">Discard</button></div>`;
    }
    const told = st.notices.filter((x) => x.kind !== "refused");
    if (told.length) {
      h += `<div class="off-notes"><div class="off-notes-h">While you were offline<span class="spacer"></span>`
        + `<button class="ghost linkish" data-act="clear-notes">OK, clear</button></div>`;
      for (const x of told.slice(-12)) {
        const who = x.by ? esc(x.by) : "someone else";
        h += `<div class="off-note">` + (x.kind === "merged"
          ? `<b>${esc(x.title)}</b> was also changed by ${who}. Your changes were put on top of theirs; what you had not touched keeps their version, and every message of the discussion is kept.`
          : x.kind === "kept"
            ? `<b>${esc(x.title)}</b> was changed by ${who} after you deleted it here, so it was <b>not deleted</b>. Delete it again if it should still go.`
            : `<b>${esc(x.title)}</b> had been deleted on the server meanwhile; your version was saved as a new item rather than thrown away.`)
          + `</div>`;
      }
      h += `</div>`;
    }
    if (UI.elsewhere) {
      for (const scope of Object.keys(UI.elsewhere)) {
        const [who, p] = [scope.slice(0, scope.indexOf("|")), scope.slice(scope.indexOf("|") + 1)];
        const mine = who === Store.userKey();
        h += `<div class="off-row off-item"><div class="off-grow muted">${plural(UI.elsewhere[scope], "change")} `
          + (mine ? `in project <b>${esc(p)}</b> ${UI.elsewhere[scope] === 1 ? "waits" : "wait"} on this device, and upload${UI.elsewhere[scope] === 1 ? "s" : ""} when that project is opened.`
            : `of another sign-in on this device (project ${esc(p)}) ${UI.elsewhere[scope] === 1 ? "waits" : "wait"} until that person signs in again.`)
          + `</div>` + (mine ? `<button class="ghost" data-act="open" data-p="${esc(p)}">Open</button>` : "") + `</div>`;
      }
    }
    h += `</section>`;
  }

  // ---- this project
  const title = (c && c.title) || (UI.plan && UI.plan.title) || (document.getElementById("project") || {}).textContent || project;
  h += `<section class="off-sec"><h4>This project</h4><div class="off-proj"><b>${esc(title)}</b> <span class="muted">${esc(project)}</span></div>`;
  if (!HAS_SW) {
    h += `<div class="off-warn">This browser cannot keep pages for offline use here (a private window, or the page is not on https).</div>`;
  } else if (JOB.running) {
    h += `<div id="off-prog"><div class="off-bar"><i></i></div><div class="off-row"><div class="off-grow muted" id="off-prog-t"></div>`
      + `<button data-act="cancel">Cancel</button></div></div>`;
  } else {
    if (JOB.error) h += `<div class="off-warn">${esc(JOB.error)}</div>`;
    if (c && c.state === "complete") {
      h += `<div class="off-have">${ICON_OK}<div><b>Available offline since ${esc(when(c.at, true))}</b> <span class="nowrap">(${size(c.bytes)})</span>`
        + `<div class="muted">${esc(partsLine(c.parts))}, as this ${c.device === "phone" ? "phone or tablet" : "computer"} loads them; issues and markups are always included.</div></div></div>`;
    } else if (c && !JOB.error) {
      h += `<div class="off-warn">The download of this project was not finished (${plural(c.count || 0, "file")} so far). Download again to carry on.</div>`;
    }
    const parts = UI.parts || (c && c.parts) || { sheets: true, model: true };
    const P = UI.plan && UI.planFor === project ? UI.plan : null;
    const line = (part, label, info) => `<label class="off-part"><input type="checkbox" data-part="${part}"${parts[part] ? " checked" : ""}`
      + `${P && !info.n ? " disabled" : ""}> <span><b>${label}</b> <span class="muted">${P ? (info.n ? info.what + " - " + size(info.bytes) : "none in this project") : ""}</span></span></label>`;
    if (online || P) {
      h += `<div class="off-parts">`
        + line("sheets", "Sheets", P ? { n: P.sheets.n, bytes: P.sheets.bytes, what: plural(P.sheets.n, "sheet") } : {})
        + line("model", "3D model", P ? { n: P.model.n, bytes: P.model.bytes, what: plural(P.model.n, "model") + (LOW_MEMORY ? ", the version for phones and tablets" : "") } : {})
        + `</div>`;
    }
    if (UI.planErr) h += `<div class="off-warn">${esc(UI.planErr)}</div>`;
    if (P) for (const note of P.notes) h += `<div class="off-warn">${esc(note)}</div>`;
    const free = UI.est && UI.est.quota ? Math.max(0, UI.est.quota - (UI.est.usage || 0)) : null;
    const complete = c && c.state === "complete";
    const sameParts = complete && c.parts && !!c.parts.sheets === !!parts.sheets && !!c.parts.model === !!parts.model;
    const up = UI.update;
    if (!online) {
      h += `<div class="muted off-line">${complete ? "Checking for newer drawings needs a connection." : "Downloading this project needs a connection."}</div>`;
    } else if (P) {
      const need = complete && sameParts && up ? up.bytes : P.bytes;
      if (complete && sameParts) {
        h += `<div class="off-line">` + (up && up.count
          ? `<b class="warnc">Update available</b> - ${plural(up.count, "file")} changed on the server (${size(up.bytes)} to download).`
          : up ? `<span class="okc">Up to date</span> <span class="muted">- the server has nothing newer.</span>` : `<span class="muted">Checking for newer files ...</span>`)
          + `</div>`;
      } else {
        h += `<div class="off-line">To download: <b>${size(P.bytes)}</b>`
          + (free !== null ? ` <span class="muted">- about ${size(free)} free on this device</span>` : "") + `</div>`;
      }
      if (free !== null && need > free) h += `<div class="off-warn">That is more than the space this browser has left for the viewer.</div>`;
    } else if (!UI.planErr) {
      h += `<div class="muted off-line">Reading what there is to download ...</div>`;
    }
    const none = !parts.sheets && !parts.model;
    h += `<div class="off-actions">`;
    if (complete) {
      h += `<button data-act="download" class="${up && up.count || !sameParts ? "primary" : ""}"${online && P && !none ? "" : " disabled"}>`
        + (sameParts ? "Update" : "Update with this choice") + `</button>`
        + `<button class="ghost danger" data-act="remove" data-p="${esc(project)}">Remove offline copy</button>`;
    } else {
      h += `<button data-act="download" class="primary"${online && P && !none ? "" : " disabled"}>${c ? "Continue download" : "Download for offline"}</button>`
        + (c ? `<button class="ghost danger" data-act="remove" data-p="${esc(project)}">Remove</button>` : "");
    }
    h += `</div>`;
  }
  h += `</section>`;

  // ---- other projects kept here
  const others = Object.keys(copies()).filter((p) => p !== project);
  if (others.length) {
    h += `<section class="off-sec"><h4>Also on this device</h4>`;
    for (const p of others) {
      const o = copies()[p];
      h += `<div class="off-row off-item"><div class="off-grow"><b>${esc(o.title || p)}</b>`
        + `<div class="muted">${o.state === "complete" ? "copy of " + esc(when(o.at, true)) : "download not finished"} - ${size(o.bytes || 0)} - ${esc(partsLine(o.parts))}</div></div>`
        + `<button class="ghost" data-act="open" data-p="${esc(p)}">Open</button>`
        + `<button class="ghost danger" data-act="remove" data-p="${esc(p)}">Remove</button></div>`;
    }
    h += `</section>`;
  }

  // ---- the small print
  h += `<section class="off-sec off-foot">`;
  if (UI.est && UI.est.quota) {
    h += `<div>The viewer uses ${size(UI.est.usage || 0)} on this device`
      + (UI.persisted ? ", protected from automatic clean-up." : ".") + `</div>`;
  }
  if (IS_IOS && !STANDALONE) {
    h += `<div><b>iPhone and iPad:</b> add the viewer to the Home Screen (Share, then "Add to Home Screen"), open it from there and download the project <i>there</i>. `
      + `Safari may clear a site it has not seen for some weeks; the Home Screen app keeps its copy, and has its own sign-in and storage.</div>`;
  } else if (UI.persisted === false && Object.keys(copies()).length) {
    h += `<div>The browser may clear this copy if the device runs short of space. Installing the viewer (browser menu, "Install" or "Add to Home Screen") protects it.</div>`;
  }
  h += `<div>Offline you can read the downloaded sheets and model, draw markups, raise issues, comment and change status. `
    + `The dashboard, admin, whiteboards, tasks, comparing with earlier versions and adding PDFs need a connection; Teams and email notices go out when your changes upload.</div>`;
  h += `</section>`;

  UI.back.querySelector("#off-body").innerHTML = h;
  progress();
}

function progress() {
  if (!JOB.running) return;
  if (UI.btn) {
    const lab = UI.btn.querySelector(".lab"), sh = UI.btn.querySelector(".short");
    const pct = JOB.total ? Math.min(100, Math.round(100 * JOB.done / JOB.total)) : 0;
    if (lab) lab.textContent = "Downloading " + pct + "%";
    if (sh) sh.textContent = pct + "%";
    if (UI.pill && !UI.pill.hidden) { const s = UI.pill.querySelector("span"); if (s) s.textContent = "Downloading " + pct + "%"; }
  }
  if (!UI.back || UI.back.hidden) return;
  const bar = UI.back.querySelector(".off-bar i"), t = UI.back.querySelector("#off-prog-t");
  if (!bar || !t) return;
  const pct = JOB.total ? Math.min(100, 100 * JOB.done / JOB.total) : (JOB.of ? 100 * JOB.files / JOB.of : 0);
  bar.style.width = pct.toFixed(1) + "%";
  t.textContent = JOB.note || (JOB.of
    ? `${JOB.files} of ${plural(JOB.of, "file")} - ${size(JOB.done)} of ${size(JOB.total)}`
    : "Nothing new to download ...");
}

function onTick(ev) {
  const box = ev.target.closest("input[data-part]");
  if (!box) return;
  const c = copyOf();
  UI.parts = Object.assign({}, UI.parts || (c && c.parts) || { sheets: true, model: true });
  UI.parts[box.dataset.part] = box.checked;
  if (isOnline()) {
    planFor(proj(), UI.parts).then((p) => { UI.plan = p; UI.planFor = proj(); renderDialog(); }).catch(() => renderDialog());
  } else renderDialog();
}

async function onAct(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === "download") {
    const c = copyOf();
    const parts = UI.parts || (c && c.parts) || { sheets: true, model: true };
    download({ sheets: !!parts.sheets, model: !!parts.model });
    renderDialog();
  } else if (act === "cancel") {
    if (JOB.ac) JOB.ac.abort();
  } else if (act === "remove") {
    const p = b.dataset.p;
    const o = copies()[p] || {};
    if (!confirm(`Remove the offline copy of "${o.title || p}" from this device?\n\n`
      + "Changes still waiting to upload are kept. The project can be downloaded again at any time.")) return;
    b.disabled = true;
    await removeCopy(p);
    renderDialog(); paint();
    refreshDialogData();
  } else if (act === "sync") {
    b.disabled = true;
    b.textContent = "Syncing ...";
    try { await Store.syncNow(); } catch (e) {}
    renderDialog(); paint();
  } else if (act === "signin") {
    location.reload();                     // the sign-in form; the queue is on the device and goes up after it
  } else if (act === "retry") {
    await Store.retryRefused(b.dataset.id);
    renderDialog();
  } else if (act === "discard") {
    if (!confirm("Discard this change? It is removed from this device and never uploaded.")) return;
    await Store.discardRefused(b.dataset.id);
    renderDialog(); paint();
  } else if (act === "clear-notes") {
    Store.clearNotices();
    renderDialog();
  } else if (act === "open") {
    const u = new URL(location.href);
    u.searchParams.set("project", b.dataset.p);
    for (const k of ["sheet", "select"]) u.searchParams.delete(k);
    location.href = u.toString();
  }
}

/* ------------------------------------------------------------ small notes */

let _toastT = null;
function toast(text, ms) {
  let el = document.getElementById("off-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "off-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { el.hidden = true; }, ms || 4500);
}

/* The page opened with no connection and nothing of this project (or not
   this part of it) on the device: say so plainly, once. */
function noCopyNotice() {
  if (UI.noticeShown || !VIEWER_PAGE || EMBED) return;
  const st = Store.state();
  if (!decided(st) || isOnline()) return;
  const project = proj();
  const c = copyOf(project);
  const part = PAGE_3D ? "model" : "sheets";
  if (c && c.state === "complete" && c.parts && c.parts[part]) return;
  UI.noticeShown = true;
  const others = Object.keys(copies()).filter((p) => p !== project && copies()[p].state === "complete");
  const el = document.createElement("div");
  el.id = "off-notice";
  const here = location.pathname.split("/").pop() || "index.html";
  let msg;
  if (c && c.state === "complete") {
    msg = PAGE_3D
      ? `The offline copy of this project on this device holds the sheets, not the 3D model.`
      : `The offline copy of this project on this device holds the 3D model, not the sheets.`;
  } else if (c) {
    msg = `The download of this project to this device was not finished, so it cannot be opened without a connection.`;
  } else {
    msg = `There is no connection, and this project has not been downloaded to this device.`;
  }
  el.innerHTML = `<div class="off-card"><h3>No connection</h3><p>${msg}</p>`
    + `<p class="muted">With a connection, open the project and choose <b>Offline</b> in the header, then <b>Download for offline</b>.</p>`
    + (c && c.state === "complete"
      ? `<p><a class="off-link" href="${PAGE_3D ? "index.html" : "model.html"}?project=${encodeURIComponent(project)}">Open the ${PAGE_3D ? "sheets" : "3D model"} of this project</a></p>` : "")
    + (others.length ? `<p>On this device: ` + others.map((p) =>
      `<a class="off-link" href="${here}?project=${encodeURIComponent(p)}">${esc(copies()[p].title || p)}</a>`).join(", ") + `</p>` : "")
    + `<div class="off-actions"><button data-x="retry" class="primary">Try again</button><button data-x="close" class="ghost">Close</button></div></div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (ev) => {
    const x = ev.target.closest("[data-x]");
    if (!x) return;
    if (x.dataset.x === "retry") location.reload(); else el.remove();
  });
}

/* Things that only the server can do say so, instead of failing oddly. */
const NEEDS = [
  ["#lwk-nav a[href]:not(#lwk-signout)", (el) => (el.textContent || "That page").trim() + " needs a connection."],
  [".m-cmp", () => "Comparing with the previous export needs a connection."],
  ["#import-pdf-btn, [data-go='import-pdf-btn']", () => "Adding a PDF needs a connection."],
  [".tpl-save, .tpl-del", () => "Saving a template needs a connection."],
];
function guardClicks() {
  document.addEventListener("click", (ev) => {
    if (isOnline()) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    for (const [sel, say] of NEEDS) {
      const el = t.closest(sel);
      if (el) {
        ev.preventDefault(); ev.stopPropagation();
        toast(say(el));
        return;
      }
    }
    // a sheet that is not in the copy
    const li = t.closest("#sheet-list li[data-num], #find-list li[data-num]");
    if (li && window.SHEETS && window.SHEETS.S && window.SHEETS.S.manifest) {
      const sh = (window.SHEETS.S.manifest.sheets || []).find((s) => s.number === li.dataset.num);
      const c = copyOf();
      if (sh && sh.pdf && !(c && c.state === "complete" && c.parts && c.parts.sheets) && !li.dataset.offOk) {
        ev.preventDefault(); ev.stopPropagation();
        isKept(sh.pdf).then((ok) => {
          if (ok) { li.dataset.offOk = "1"; li.click(); }
          else toast(`Sheet ${sh.number} is not in this device's offline copy - it needs a connection.`);
        });
      }
    }
  }, true);
}
async function isKept(rel) {
  try {
    if (!(await caches.has(dataCache(proj())))) return false;
    return !!(await (await caches.open(dataCache(proj()))).match(pathOf(Store.dataUrl(rel))));
  } catch (e) { return false; }
}

/* The summary in localStorage and what the browser really holds can part
   ways (the browser cleared the site's caches under storage pressure, the
   person cleared them by hand): a copy that is not there is not offered. */
async function reconcile() {
  if (typeof caches === "undefined") return;
  for (const p of Object.keys(copies())) {
    try {
      if (!(await caches.has(dataCache(p)))) { await DB.kvDel("copy|" + p); mirror(p, null); }
    } catch (e) { return; }
  }
}

/* ------------------------------------------------------------- who is here */

/* The worker is told who is signed in; another person's start-up answers
   are wiped, and copies of projects they are not a member of are removed
   (the server would not show them those files). */
async function tellSession() {
  let token = null;
  try { token = localStorage.getItem("lwk-viewer:token"); } catch (e) {}
  if (!token) return;
  const user = Store.userKey();
  let last = null;
  try { last = localStorage.getItem(SESSION_KEY); } catch (e) {}
  await ask({ type: "session", user }, 4000);
  if (last && last !== user && Object.keys(copies()).length) {
    try {
      const mine = new Set(((await Store.listProjects()).projects || []).map((p) => p.id));
      for (const p of Object.keys(copies())) {
        if (!mine.has(p)) await removeCopy(p);
        else { const m = await loadMeta(p); if (m) { m.user = user; await saveMeta(m); } }
      }
    } catch (e) { return; }                 // offline: decided next time
  }
  try { localStorage.setItem(SESSION_KEY, user); } catch (e) {}
}

/* nav.js calls this before it signs out. False = stay signed in. */
async function beforeSignOut() {
  const st = Store.state();
  const online = isOnline();
  if (st.pending) {
    if (!confirm(plural(st.pending, "change") + " made on this device " + (st.pending === 1 ? "has" : "have")
      + " not been uploaded yet.\n\nThey are kept here and upload when you sign in again on this device. Sign out now?")) return false;
  } else if (!online) {
    if (!confirm("There is no connection: after signing out you cannot sign in again, or open the offline copy, until there is one. Sign out?")) return false;
  }
  await ask({ type: "signout" }, 4000);
  return true;
}

/* -------------------------------------------------- pages that need the server */

function serverPage() {
  let el = null;
  const show = (on) => {
    if (!on) { if (el) { el.remove(); el = null; } return; }
    if (el) return;
    el = document.createElement("div");
    el.id = "off-needs";
    el.style.cssText = "position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:200;max-width:min(520px,92vw);"
      + "background:#fff;color:#1f2430;border:1px solid #e2e6ec;border-left:4px solid #e8a13a;border-radius:8px;"
      + "padding:12px 16px;box-shadow:0 10px 40px rgba(20,26,36,.18);font:13px/1.5 'Segoe UI',system-ui,-apple-system,sans-serif";
    const p = Store.currentProject();
    const q = p ? "?project=" + encodeURIComponent(p) : "";
    el.innerHTML = `<b>No connection</b> - this page needs the server and cannot work offline.`
      + `<div style="margin-top:6px;color:#6b7480">The <a href="index.html${q}" style="color:#d1660e;font-weight:600">sheets</a> and the `
      + `<a href="model.html${q}" style="color:#d1660e;font-weight:600">3D model</a> of a downloaded project do. `
      + `This note goes away when the connection is back.</div>`;
    document.body.appendChild(el);
  };
  const check = async () => show(!(await probe()));
  check();
  addEventListener("online", check);
  addEventListener("offline", () => show(true));
  setInterval(() => { if (el || navigator.onLine === false) check(); }, 8000);
}

/* ---------------------------------------------------------------- start-up */

function headLinks() {
  const add = (tag, attrs) => {
    const sel = tag + Object.keys(attrs).filter((k) => k !== "href" && k !== "content").map((k) => `[${k}="${attrs[k]}"]`).join("");
    if (document.head.querySelector(sel)) return;
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    document.head.appendChild(el);
  };
  add("link", { rel: "manifest", href: "app.webmanifest" });
  add("link", { rel: "apple-touch-icon", href: "icons/icon-180.png" });
  add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  add("meta", { name: "mobile-web-app-capable", content: "yes" });
  add("meta", { name: "apple-mobile-web-app-title", content: "LWK Viewer" });
  add("meta", { name: "theme-color", content: "#f28022" });
}

let _lastSnap = 0, _lastCheck = 0;
function upkeep() {
  // quietly, while online and the project has a copy: its issue pictures, and whether the server moved on
  const c = copyOf();
  if (!c || c.state !== "complete" || !isOnline() || JOB.running) return;
  const now = Date.now();
  if (now - _lastSnap > 20000) {
    _lastSnap = now;
    cacheSnapshots(proj()).catch(() => {});
  }
  if (now - _lastCheck > 10 * 60000) {
    _lastCheck = now;
    checkUpdate(proj()).then((u) => { if (u) { UI.update = u; paint(); } }).catch(() => {});
  }
}

async function start() {
  headLinks();
  const reg = registerWorker();
  if (EMBED) return;                        // beside a sheet: the outer page speaks for both
  if (!VIEWER_PAGE) { await reg; serverPage(); return; }

  buildHeader();
  guardClicks();
  window.LWKOffline = {
    beforeSignOut, open: openDialog, download, removeCopy, checkUpdate, planFor, state: () => ({ job: Object.assign({}, JOB, { ac: null }), copies: copies(), online: isOnline() }),
  };
  let sessionTold = "";
  let firstState = true;
  let queuedBefore = Infinity;
  let sig = "";
  Store.onState((st) => {
    paint();
    // the open window follows the state, but is not redrawn for nothing (a poll comes every five seconds)
    const now = [st.online, st.pending, st.uploading, st.auth, st.refused.length, st.notices.length, st.started].join("|");
    if (now !== sig) { sig = now; renderDialogSoon(); }
    if (st.started) {
      const u = Store.userKey();
      if (u !== sessionTold && st.online) { sessionTold = u; tellSession(); }
      if (firstState && decided(st)) { firstState = false; setTimeout(noCopyNotice, 300); setTimeout(upkeep, 3000); }
      // the first change made without a connection: say once where it went
      if (decided(st) && st.pending > queuedBefore && !isOnline() && !UI.told) {
        UI.told = true;
        toast("Saved on this device. It uploads by itself when the connection is back.", 6000);
      }
      if (decided(st)) queuedBefore = st.pending;
      if (st.online) upkeep();
    }
  });
  addEventListener("online", () => { probe().then(paint); });
  addEventListener("offline", () => { NETSTATE.probe = false; paint(); });
  if (HAS_SW) {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data && ev.data.type === "shell") paint();
    });
  }
  paint();
  await reg;
  await probe();
  paint();
  await reconcile();
  paint();
  /* The first visit: have the worker fetch its complete set of the viewer's
     files (several MB, most of it already in the browser's own cache), so
     the pages open without a connection from then on. Someone who has asked
     the browser to save data gets it when they download a project instead. */
  if (NETSTATE.probe && (await controlled(8000))) {
    const s = await ask({ type: "status" }, 5000);
    const saving = !!(navigator.connection && navigator.connection.saveData);
    if (s && !s.shell && (!saving || Object.keys(copies()).length)) ask({ type: "refresh-shell" }, 120000);
    if (!saving) cacheCdn().catch(() => {});
  }
  // a page that never got as far as its store (sign-in form, no server)
  setTimeout(() => { if (!Store.state().started) { probe().then(paint); } }, 4000);
}

let _rd = null;
function renderDialogSoon() {
  if (!UI.back || UI.back.hidden || _rd) return;
  _rd = setTimeout(() => { _rd = null; if (!JOB.running) renderDialog(); }, 150);
}

start().catch((e) => console.warn("offline:", e));
