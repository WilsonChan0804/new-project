/* LWK Viewer - service worker (scope "/").
 *
 * Makes the viewer open, and a downloaded project readable, with no
 * connection. It never changes what an ONLINE user gets: every request goes
 * to the network first and the network's answer is what the page receives.
 * The caches are what is fallen back on when the network does not answer.
 *
 * Four kinds of request:
 *
 * 1. The viewer's own files (html, js, css, vendor) - "the shell".
 *    server/app.py makes browsers re-check these on every load because a
 *    new app.js running against last week's store.js kills the page. The
 *    same rule holds here, so the shell is never cached file by file as
 *    pages happen to ask: the worker keeps ONE COMPLETE SET, built from the
 *    server's list (/api/offline/shell) and swapped in whole once every
 *    file of it has arrived ("a generation"). Offline, a page is served
 *    from that set only - all of it from the same moment.
 *    Online, files come from the network. If the network fails half-way
 *    through a page load, the set may fill in ONLY while everything the
 *    page has had so far is identical to the set (same ETag); once a page
 *    has been given a file newer than the set, a failed file is a failed
 *    file, exactly as without a worker. (PINS below.)
 *
 * 2. pdf.js from the CDN: the address carries its version, so the file can
 *    never change - kept on first use, served from the cache from then on.
 *
 * 3. Project files, /data/<project>/... and /snapshots/...: the network's
 *    answer when there is one (so a new export is seen at once, as before);
 *    otherwise the device's offline copy of that project (put there by
 *    offline.js, whole files only). Range requests and the model / sheet
 *    tile slices (?o=&n=) are cut from the whole file - Cache Storage
 *    cannot hold a 206.
 *
 * 4. GET /api/... that a page needs to start (ping, me, projects, members,
 *    layers, templates, the sheets' words and tile indexes): the network's
 *    answer, remembered; the last good one when there is no network. The
 *    key includes the project (it travels in a header, not the URL). The
 *    answers are wiped when someone signs out or another person signs in.
 *    /api/items is NOT handled here: store.js keeps the items itself.
 *
 * POST / DELETE / PUT are never touched.
 */

const SHELL_PREFIX = "lwk-shell-";
const CDN_CACHE = "lwk-cdn-v1";
const API_CACHE = "lwk-api-v1";
const SNAP_CACHE = "lwk-snap-v1";
const DATA_PREFIX = "lwk-data-";            // + encodeURIComponent(project)
const META_CACHE = "lwk-meta-v1";
const META_SHELL = "/__lwk/shell";
const META_SESSION = "/__lwk/session";

const NAV_MS = 5000;                        // a page that has not started to arrive by then opens from the device
const FILE_MS = 8000;
const API_MS = 5000;
const DOWN_MS = 8000;                       // after a failure, how long the caches are used without asking again

const API_OK = /^\/api\/(ping|me|projects|members|layers|templates|sheet-tiles|sheet-text|lwkm-mobile)$/;
const API_ANY_PROJECT = /^\/api\/(ping|me|projects)$/;
const CDN_OK = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\//;

const NET = { okAt: 0, failAt: 0 };
const netOk = () => { NET.okAt = Date.now(); };
const netFail = () => { NET.failAt = Date.now(); };
const looksDown = () => self.navigator.onLine === false
  || (NET.failAt > NET.okAt && Date.now() - NET.failAt < DOWN_MS);

/* client id -> "set" (served from the kept set) | "net" (has had a file
   newer than the set); and client id + project -> "copy" | "net" likewise
   for a project's files. Forgotten with the worker: a page then simply
   starts unpinned again. */
const PINS = new Map();
function pin(key, v) {
  if (!key) return;
  PINS.set(key, v);
  if (PINS.size > 400) PINS.delete(PINS.keys().next().value);
}

/* ------------------------------------------------------------ small records */

async function metaGet(name) {
  try {
    const c = await caches.open(META_CACHE);
    const r = await c.match(name);
    return r ? await r.json() : null;
  } catch (e) { return null; }
}
async function metaSet(name, value) {
  const c = await caches.open(META_CACHE);
  await c.put(name, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
}

let SESSION = null;          // { user, locked }
async function session() {
  if (!SESSION) SESSION = (await metaGet(META_SESSION)) || { user: null, locked: false };
  return SESSION;
}

/* ------------------------------------------------------------- the shell set */

let SHELL = null;            // { gen, version, tags: {path: tag}, at, count, bytes }
let SHELL_LOADED = false;
async function shell() {
  if (!SHELL_LOADED) { SHELL = await metaGet(META_SHELL); SHELL_LOADED = true; }
  return SHELL;
}

const shellKey = (url) => {
  let p = url.pathname;
  if (p === "/" || p === "") p = "/index.html";
  return p;
};

async function fromSet(key) {
  const s = await shell();
  if (!s) return null;
  const c = await caches.open(s.gen);
  return (await c.match(key, { ignoreVary: true, ignoreSearch: true })) || null;
}

let _refreshing = null, _refreshAgain = false, _lastRefresh = 0;
function refreshShell(force) {
  if (_refreshing) { _refreshAgain = true; return _refreshing; }
  if (!force && Date.now() - _lastRefresh < 20000) return Promise.resolve(SHELL);
  _refreshing = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await buildSet()) break;
      }
    } catch (e) { /* no connection: the set that is here stays */ }
    _lastRefresh = Date.now();
    _refreshing = null;
    if (_refreshAgain) { _refreshAgain = false; return refreshShell(true); }
    return SHELL;
  })();
  return _refreshing;
}

async function shellList() {
  const r = await fetch("/api/offline/shell", { cache: "no-store" });
  if (!r.ok) throw new Error("shell list: HTTP " + r.status);
  return r.json();
}

/* True when the kept set matches the server's list (already, or now). */
async function buildSet() {
  const list = await shellList();
  const cur = await shell();
  if (cur && cur.version === list.version) return true;
  const gen = SHELL_PREFIX + Date.now().toString(36);
  const next = await caches.open(gen);
  const old = cur ? await caches.open(cur.gen) : null;
  const tags = {};
  let bytes = 0;
  const queue = list.files.slice();
  const one = async (f) => {
    const key = "/" + f.path;
    tags[key] = f.tag;
    bytes += f.bytes || 0;
    if (old && cur.tags[key] === f.tag) {
      const have = await old.match(key);
      if (have) { await next.put(key, have); return; }
    }
    // "no-cache": the browser's own copy is used when the server says it is current
    const r = await fetch(key, { cache: "no-cache" });
    if (!r.ok) throw new Error(key + ": HTTP " + r.status);
    await next.put(key, r);
  };
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) await one(queue.shift());
    }));
    // a file changed while the set was being fetched: this set is a mix, start again
    const check = await shellList();
    if (check.version !== list.version) { await caches.delete(gen); return false; }
  } catch (e) {
    await caches.delete(gen);
    throw e;
  }
  const rec = { gen, version: list.version, tags, at: Date.now(), count: list.files.length, bytes };
  await metaSet(META_SHELL, rec);
  SHELL = rec; SHELL_LOADED = true;
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== gen) await caches.delete(name);
  }
  tell({ type: "shell", version: rec.version, at: rec.at });
  return true;
}

async function tell(msg) {
  try {
    for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
  } catch (e) {}
}

/* ------------------------------------------------------------------ fetching */

/* fetch with a limit on how long the answer may take to START; the body of
   a big file may take as long as it needs. */
function timed(request, ms) {
  if (!ms || typeof AbortController === "undefined") return fetch(request);
  const ac = new AbortController();
  let late = false;
  const t = setTimeout(() => { late = true; ac.abort(); }, ms);
  // the page giving the request up (it was closed, or moved on) still cancels it
  try { if (request.signal) request.signal.addEventListener("abort", () => ac.abort()); } catch (e) {}
  return fetch(request, { signal: ac.signal }).then(
    (r) => { clearTimeout(t); return r; },
    (e) => {
      clearTimeout(t);
      if (late) { const err = new Error("no answer in time"); err.timeout = true; throw err; }
      throw e;
    });
}
/* The page gave up on the request: that says nothing about the connection. */
const gaveUp = (e) => !!e && e.name === "AbortError" && !e.timeout;

const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LWK Viewer - no connection</title>
<body style="font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:#f2f4f7;color:#1f2430;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:420px;margin:20px;padding:24px;background:#fff;border:1px solid #e2e6ec;border-radius:10px">
<h3 style="margin:0 0 8px">No connection</h3>
<p style="margin:0 0 14px;color:#6b7480">The LWK Viewer cannot reach its server, and this device has not kept the viewer for offline use yet.
Open the viewer once with a connection, then use <b>Offline</b> in its header to download a project.</p>
<button onclick="location.reload()" style="font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #f28022;background:#f28022;color:#fff">Try again</button>
</div></body>`;

/* The pages that work from the device. Any other page of the viewer
   (dashboard, admin, whiteboards, the report) is all server: opened with
   no connection it says so, rather than starting and failing piece by piece. */
const WORKS_OFFLINE = /^\/(index\.html|model\.html)?$/;
function needsConnection(url) {
  const p = url.searchParams.get("project");
  const q = p ? "?project=" + encodeURIComponent(p) : "";
  const name = (url.pathname.split("/").pop() || "").replace(/\.html$/, "").replace(/[^a-z0-9-]/gi, "");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LWK Viewer - needs a connection</title>
<body style="font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:#f2f4f7;color:#1f2430;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:440px;margin:20px;padding:24px;background:#fff;border:1px solid #e2e6ec;border-radius:10px">
<h3 style="margin:0 0 8px">This page needs a connection</h3>
<p style="margin:0 0 14px;color:#6b7480">There is no connection to the server, and the ${name || "page"} works only with one.
The sheets and the 3D model of a project downloaded to this device do work offline.</p>
<p style="margin:0;display:flex;gap:8px;flex-wrap:wrap">
<a href="index.html${q}" style="text-decoration:none;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid #f28022;background:#f28022;color:#fff">Sheets</a>
<a href="model.html${q}" style="text-decoration:none;font-weight:600;padding:6px 14px;border-radius:6px;border:1px solid #f28022;background:#f28022;color:#fff">3D model</a>
<a href="" onclick="location.reload();return false" style="text-decoration:none;padding:6px 14px;border-radius:6px;border:1px solid #e2e6ec;color:#414a5a">Try again</a></p>
</div></body>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "X-LWK-Offline": "1" } });
}

async function shellFetch(event, url) {
  const req = event.request;
  const nav = req.mode === "navigate";
  /* A page's files follow the page (resultingClientId is the page being
     opened); the page itself is judged afresh every time. A browser that
     does not say which page a navigation opens simply starts its files
     unpinned. */
  const cid = nav ? event.resultingClientId : event.clientId;
  const key = shellKey(url);
  const state = nav || !cid ? undefined : PINS.get(cid);

  const online_only = nav && !WORKS_OFFLINE.test(url.pathname) && /\.html$/.test(key);
  /* A page itself is always asked of the network first (unless the device
     says it has none): one failed request a moment ago must not hand an
     online user yesterday's viewer. Its files then follow the page. */
  const down = nav ? self.navigator.onLine === false : looksDown();
  if (!online_only && (state === "set" || (state !== "net" && down))) {
    const have = await fromSet(key);
    if (have) { pin(cid, "set"); return have; }
  }
  const kept = state === "net" ? null : await fromSet(key);
  try {
    const net = await (kept ? timed(req, nav ? NAV_MS : FILE_MS) : fetch(req));
    netOk();
    if (net.ok) {
      const tag = net.headers.get("etag");
      const same = kept && tag && kept.headers.get("etag") === tag;
      if (!same && state !== "set") pin(cid, "net");
      /* The kept set is brought up to date after every page load (a list
         of a few kB when nothing changed). It is first made when
         offline.js asks for it, not behind the back of someone on a
         metered line who never asked for anything offline. */
      if ((nav || !same) && (await shell())) event.waitUntil(refreshShell(!same));
    }
    return net;
  } catch (e) {
    if (gaveUp(e)) return Response.error();
    netFail();
    if (online_only) return needsConnection(url);
    if (kept) { pin(cid, "set"); return kept; }
    if (nav) {
      return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.error();
  }
}

async function cdnFetch(event) {
  const req = event.request;
  const c = await caches.open(CDN_CACHE);
  const have = await c.match(req.url, { ignoreVary: true });
  if (have) return have;
  try {
    // asked for with CORS so the answer can be checked and kept at its real size
    const r = await fetch(req.url, { mode: "cors", credentials: "omit" });
    if (r.ok) { event.waitUntil(c.put(req.url, r.clone())); return r; }
  } catch (e) { /* as the page asked, below */ }
  const r = await fetch(req);
  if (r.type === "opaque" || r.ok) event.waitUntil(c.put(req.url, r.clone()));
  return r;
}

function offlineCopyOf(res, extra) {
  const h = new Headers(res.headers);
  h.set("X-LWK-Offline", "1");
  for (const k of Object.keys(extra || {})) h.set(k, extra[k]);
  return h;
}

/* The kept answers are small, but one is kept per sheet looked at (its
   words, its tiles' index): the oldest go once there are very many. */
let _kept = 0;
async function keepAnswer(c, key, res) {
  await c.put(key, res);
  if (++_kept % 40) return;
  const keys = await c.keys();
  if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1100)) await c.delete(k);
}

async function apiFetch(event, url) {
  const req = event.request;
  const s = await session();
  const project = API_ANY_PROJECT.test(url.pathname) ? ""
    : (req.headers.get("x-project") || url.searchParams.get("project") || "");
  const key = "/__api/" + encodeURIComponent(project) + url.pathname + url.search;
  const c = await caches.open(API_CACHE);
  const have = s.locked ? null : await c.match(key);
  const kept = async () => {
    /* A sheet is shown from the server's pictures only when the device's
       copy holds them; otherwise the page is told there are none, and
       draws the sheet from its PDF (which the copy always holds). */
    if (url.pathname === "/api/sheet-tiles" && !(await tilesKept(have, project))) {
      return new Response(JSON.stringify({ status: "offline", pdf_bytes: 0 }),
        { status: 200, headers: { "Content-Type": "application/json", "X-LWK-Offline": "1" } });
    }
    return new Response(have.body, { status: 200, headers: offlineCopyOf(have) });
  };
  if (have && looksDown()) return kept();
  try {
    const net = await (have ? timed(req, API_MS) : fetch(req));
    netOk();
    if (net.status === 200 && !s.locked) event.waitUntil(keepAnswer(c, key, net.clone()));
    return net;
  } catch (e) {
    if (gaveUp(e)) return Response.error();
    netFail();
    if (have) return kept();
    return Response.error();
  }
}

const dataCacheName = (project) => DATA_PREFIX + encodeURIComponent(project);

async function tilesKept(res, project) {
  try {
    const m = await res.clone().json();
    if (m.status !== "ready" || !m.path) return true;
    if (!(await caches.has(dataCacheName(project)))) return false;
    const key = new URL("/data/" + encodeURIComponent(project) + "/" + m.path, self.location.origin).pathname;
    const c = await caches.open(dataCacheName(project));
    return !!(await c.match(key, { ignoreVary: true, ignoreSearch: true }));
  } catch (e) { return true; }
}

/* A whole file from the offline copy, or the part of it that was asked for. */
async function cut(res, req, url) {
  const o = url.searchParams.get("o");
  const type = res.headers.get("Content-Type") || "application/octet-stream";
  if (o !== null) {
    const off = Number(o), n = Number(url.searchParams.get("n") || 0);
    const blob = await res.blob();
    if (!(off >= 0) || !(n > 0) || off + n > blob.size) {
      return new Response("Outside the file", { status: 416 });
    }
    return new Response(blob.slice(off, off + n), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(n), "X-LWK-Offline": "1" },
    });
  }
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const blob = await res.blob();
    const size = blob.size;
    if (m && (m[1] || m[2])) {
      let a, b;
      if (m[1] === "") { a = Math.max(0, size - Number(m[2])); b = size - 1; }
      else { a = Number(m[1]); b = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2])); }
      if (a > b || a >= size) {
        return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } });
      }
      return new Response(blob.slice(a, b + 1, type), {
        status: 206,
        headers: { "Content-Type": type, "Content-Length": String(b - a + 1),
                   "Content-Range": "bytes " + a + "-" + b + "/" + size,
                   "Accept-Ranges": "bytes", "X-LWK-Offline": "1" },
      });
    }
    return new Response(blob, { status: 200, headers: offlineCopyOf(res, { "Accept-Ranges": "bytes" }) });
  }
  return new Response(res.body, { status: 200, headers: offlineCopyOf(res, { "Accept-Ranges": "bytes" }) });
}

async function dataFetch(event, url) {
  const req = event.request;
  const parts = url.pathname.split("/");            // "", "data", project, ...
  const project = decodeURIComponent(parts[2] || "");
  const key = url.pathname;
  const s = await session();
  const pkey = event.clientId ? event.clientId + "|" + project : "";
  const state = pkey ? PINS.get(pkey) : undefined;
  let copy = null;
  if (!s.locked && state !== "net" && (await caches.has(dataCacheName(project)))) {
    const c = await caches.open(dataCacheName(project));
    copy = (await c.match(key, { ignoreVary: true, ignoreSearch: true })) || null;
  }
  if (copy && (state === "copy" || looksDown())) {
    pin(pkey, "copy");
    return cut(copy, req, url);
  }
  try {
    const net = await (copy ? timed(req, FILE_MS) : fetch(req));
    netOk();
    if (copy && net.ok && state !== "copy") {
      // a file newer than the copy: from here on this page is not given a mix of the two
      const tag = net.headers.get("etag");
      if (tag && copy.headers.get("etag") && tag !== copy.headers.get("etag")) pin(pkey, "net");
    }
    return net;
  } catch (e) {
    if (gaveUp(e)) return Response.error();
    netFail();
    if (copy) { pin(pkey, "copy"); return cut(copy, req, url); }
    return Response.error();
  }
}

async function snapFetch(event, url) {
  const req = event.request;
  const s = await session();
  const keep = !s.locked && (await caches.has(SNAP_CACHE));
  const c = keep ? await caches.open(SNAP_CACHE) : null;
  // a snapshot's name is unique and its picture never changes
  const have = c ? await c.match(url.pathname, { ignoreVary: true }) : null;
  if (have) return have;
  try {
    const net = await fetch(req);
    netOk();
    if (c && net.status === 200) event.waitUntil(c.put(url.pathname, net.clone()));
    return net;
  } catch (e) {
    if (!gaveUp(e)) netFail();
    return Response.error();
  }
}

/* Shared to the installed viewer from another app (Android: WhatsApp >
   Share > LWK Viewer; app.webmanifest share_target). What came in is kept
   here until the Messenger picks it up (chat.js incoming). */
async function shareIn(event) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const form = await event.request.formData();
    const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size);
    const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "",
      files: files.map((f) => ({ name: f.name, type: f.type })) };
    const c = await caches.open("lwk-share");
    await c.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
    for (let i = 0; i < files.length; i++) await c.put(`/__share/${id}/${i}`, new Response(files[i]));
  } catch (e) { /* the page says nothing came in */ }
  return Response.redirect(new URL("messenger.html?incoming=" + id, self.registration.scope).href, 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "POST" && /\/share-in$/.test(new URL(req.url).pathname)) { event.respondWith(shareIn(event)); return; }
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) {
    if (CDN_OK.test(req.url)) event.respondWith(cdnFetch(event));
    return;
  }
  const p = url.pathname;
  if (p.startsWith("/api/")) {
    if (API_OK.test(p)) event.respondWith(apiFetch(event, url));
    return;
  }
  if (p.startsWith("/data/")) { event.respondWith(dataFetch(event, url)); return; }
  if (p.startsWith("/snapshots/")) { event.respondWith(snapFetch(event, url)); return; }
  if (p.startsWith("/__lwk/")) return;
  event.respondWith(shellFetch(event, url));
});

/* ----------------------------------------------------------------- lifecycle */

self.addEventListener("install", (event) => {
  // a new worker takes over at once: it holds no state a page depends on
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  /* Only the claim is waited for: requests are held back until this
     settles, and the kept set (several MB the first time) is fetched after
     - on the first page load and whenever offline.js asks. */
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const d = event.data || {};
  const reply = (v) => { try { if (event.ports && event.ports[0]) event.ports[0].postMessage(v); } catch (e) {} };
  const run = async () => {
    if (d.type === "refresh-shell") {
      const s = await refreshShell(true);
      reply({ ok: !!s, shell: s });
    } else if (d.type === "status") {
      reply({ shell: await shell(), session: await session(), down: looksDown() });
    } else if (d.type === "session") {
      // who is signed in on this device; another person's answers are not theirs to see
      const s = await session();
      if (s.user !== d.user || s.locked) {
        if (s.user && s.user !== d.user) await caches.delete(API_CACHE);
        SESSION = { user: d.user, locked: false };
        await metaSet(META_SESSION, SESSION);
      }
      reply({ ok: true });
    } else if (d.type === "signout") {
      await caches.delete(API_CACHE);
      SESSION = { user: (await session()).user, locked: true };
      await metaSet(META_SESSION, SESSION);
      reply({ ok: true });
    } else if (d.type === "net") {
      if (d.ok) netOk(); else netFail();
      reply({ ok: true });
    } else {
      reply({ ok: false });
    }
  };
  event.waitUntil(run());
});
