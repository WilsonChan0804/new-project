/* First on every page (the server puts it there - assets.py): asks for the
 * data the page is about to need, while the page's big scripts are still
 * on their way.
 *
 * Nothing on the pages changes to use it: fetch() is wrapped, and a GET the
 * page makes for something already asked for gets that answer (the same
 * address, project and sign-in). It also means two parts of a page asking
 * for the same thing at the same moment share one request.
 *
 * Kept short-lived on purpose: an early answer is used only in the first
 * 10 seconds, a shared one only while it is on its way, and anything the
 * page sends (a save, a delete) clears them all - so nothing read here can
 * hide a change.
 */

const nativeFetch = window.fetch.bind(window);
const API_T = [];               // how long each data request took (Admin > Speed)
let readyAt = 0;
function realFetch(input, init) {
  const t = performance.now();
  const p = nativeFetch(input, init);
  try {
    const u = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
    if (u.origin === location.origin && (u.pathname.startsWith("/api/") || u.pathname.startsWith("/data/"))
        && !u.pathname.startsWith("/api/perf/") && u.pathname !== "/api/chat/sync") {
      const done = () => {
        const now = performance.now();
        if (API_T.length < 300) API_T.push({ path: u.pathname.replace(/^\/data\/[^/]+\//, "/data/{project}/"), ms: Math.round(now - t), at: Math.round(t) });
      };
      p.then(done, () => {});
    }
  } catch (e) { /* never in the way */ }
  return p;
}
const HOLD = new Map();          // key -> { at, p, early }
const EARLY_MS = 10000;

function token() {
  try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; }
}
function project() {
  // this tab's project first (store.js currentProject), the last one used only for a new tab
  const q = new URLSearchParams(location.search).get("project");
  if (q) { try { sessionStorage.setItem("lwk-viewer:tab-project", q); } catch (e) {} return q; }
  try { const t = sessionStorage.getItem("lwk-viewer:tab-project"); if (t) return t; } catch (e) {}
  try { return localStorage.getItem("lwk-viewer:project") || ""; } catch (e) { return ""; }
}
function header(init, name) {
  const h = init && init.headers;
  if (!h) return "";
  if (typeof Headers !== "undefined" && h instanceof Headers) return h.get(name) || "";
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return String(h[k] || "");
  return "";
}

/* Which requests may be shared: the server's JSON and a project manifest. */
function keyOf(input, init) {
  if (typeof input !== "string" && !(input instanceof URL)) return null;
  const method = ((init && init.method) || "GET").toUpperCase();
  if (method !== "GET") return "write";
  if (init && (init.body || init.cache === "no-store" || init.cache === "reload")) return null;
  let u;
  try { u = new URL(String(input), location.href); } catch (e) { return null; }
  if (u.origin !== location.origin) return null;
  if (!(u.pathname.startsWith("/api/") || /^\/data\/[^/]+\/manifest\.json$/.test(u.pathname))) return null;
  if (u.pathname === "/api/chat/sync" || u.pathname.startsWith("/api/offline/")) return null;
  return u.pathname + u.search + "|" + header(init, "x-project") + "|" + (header(init, "x-viewer-token") ? 1 : 0);
}

window.fetch = function (input, init) {
  const k = keyOf(input, init);
  if (k === "write") {
    HOLD.clear();                // something is being changed: read afresh
    return realFetch(input, init);
  }
  if (!k) return realFetch(input, init);
  const e = HOLD.get(k);
  if (e && (e.pending || (e.early && Date.now() - e.at < EARLY_MS))) {
    return e.p.then((r) => r.clone());
  }
  return hold(k, realFetch(input, init), false).then((r) => r.clone());
};

function hold(k, p, early) {
  const e = { at: Date.now(), p, early, pending: true };
  HOLD.set(k, e);
  p.then((r) => {
    e.pending = false;
    if (!r.ok || !early) { if (HOLD.get(k) === e) HOLD.delete(k); }
  }, () => { if (HOLD.get(k) === e) HOLD.delete(k); });
  return p;
}

/* The asking, as the pages themselves ask (nav.js / store.js headers). */
function ask(path, opts) {
  opts = opts || {};
  const h = {};
  const t = token();
  if (opts.plain) {
    // as fetch(url) with nothing more: /api/ping, a manifest
  } else {
    if (t) h["X-Viewer-Token"] = t;
    const p = project();
    if (p && opts.project !== false) h["X-Project"] = p;
  }
  const init = Object.keys(h).length ? { headers: h } : undefined;
  const k = keyOf(path, init);
  if (!k || k === "write" || HOLD.has(k)) return;
  hold(k, realFetch(path, init), true).catch(() => {});
}

(function start() {
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const t = token();
  ask("/api/ping", { plain: true });
  if (!t) return;
  const p = project();
  const pq = encodeURIComponent(p);
  // the rev of the copy this page keeps on the device (nav.js keepBig): ask for what changed since
  const keptRev = (name) => {
    try {
      const u = localStorage.getItem("lwk-viewer:keep:uid");
      return (u && localStorage.getItem("lwk-viewer:keep:" + u + ":rev:" + name)) || "0";
    } catch (e) { return "0"; }
  };
  ask("/api/me");
  ask("/api/chat/unread");
  if (page === "index.html" || page === "model.html") {
    ask("/api/projects");
    ask("/api/project-choices");
    if (p) {
      ask("/data/" + pq + "/manifest.json", { plain: true });
      ask("/api/items?since=0");
      ask("/api/members");
      ask("/api/layers");
      ask("/api/templates");
    }
  } else if (page === "dashboard.html") {
    ask("/api/projects");
    ask("/api/project-choices");
    ask("/api/registry?lite=1");
    if (p) {
      ask("/data/" + pq + "/manifest.json", { plain: true });
      ask("/api/items?since=" + keptRev("dash:" + p));
      ask("/api/members");
      ask("/api/digest?days=7");
      ask("/api/projects/" + pq + "/exports");
      ask("/api/publish-jobs?project=" + pq);
    }
  } else if (page === "board.html") {
    ask("/api/projects");
    ask("/api/project-choices");
    if (p) ask("/api/boards");
  } else if (page === "tasks.html") {
    ask("/api/people");
    ask("/api/task-lists");
    ask("/api/tasks-mine?view=owned");
    const q = new URLSearchParams(location.search);
    let list = q.get("list");
    if (!list) { try { list = JSON.parse(localStorage.getItem("lwk-tasks:list") || "null"); } catch (e) { list = null; } }
    if (list && !q.get("mode") && !q.get("quick") && !q.get("attach")) ask("/api/tasks?list=" + encodeURIComponent(list) + "&since=" + keptRev("tasks:" + list));
  } else if (page === "projects.html") {
    ask("/api/registry");
    ask("/api/chat/rooms");
  } else if (page === "messenger.html") {
    ask("/api/people");
    ask("/api/chat/rooms");
  }
})();

/* How long this page took for the person opening it (Admin > Speed, the
   server's perf.py): the first byte, the page loaded, and "ready" - when a
   page says so (window.lwkReady(), the first sheet or the models shown), or
   else when its data requests went quiet. Sent once, in the background. */
window.lwkReady = function () { if (!readyAt) readyAt = performance.now(); };
(function report() {
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    try {
      const nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {};
      const load = nav.loadEventEnd || 0;
      // the data the page asked for while it opened (up to a second after
      // it loaded) all in - not the checks it then repeats every few seconds
      const quiet = API_T.filter((a) => a.at <= (load || 5000) + 1000).reduce((m, a) => Math.max(m, a.at + a.ms), 0);
      const ready = readyAt || Math.max(load, quiet) || performance.now();
      const c = navigator.connection || {};
      const ua = navigator.userAgent || "";
      const body = {
        page: (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index",
        project: project(), token: token(),
        ttfb_ms: Math.round(nav.responseStart || 0), dom_ms: Math.round(nav.domContentLoadedEventEnd || 0),
        load_ms: Math.round(load), ready_ms: Math.round(ready),
        how: readyAt ? "page said" : "data quiet",
        cached: nav.transferSize === 0 || !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        net: { type: c.effectiveType || "", rtt: c.rtt, down: c.downlink },
        device: /iPad|Tablet/.test(ua) ? "tablet" : /iPhone|Android.*Mobile/.test(ua) ? "phone" : /Android/.test(ua) ? "tablet" : "desktop",
        api: API_T.filter((a) => a.at < 30000).sort((a, b) => b.ms - a.ms).slice(0, 8).map((a) => ({ path: a.path, ms: a.ms })),
      };
      if (!body.token) return;
      const json = JSON.stringify(body);
      if (!(navigator.sendBeacon && navigator.sendBeacon("/api/perf/client", new Blob([json], { type: "application/json" })))) {
        nativeFetch("/api/perf/client", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: json }).catch(() => {});
      }
    } catch (e) { /* never in the way */ }
  };
  // after the page has settled (or when it is left sooner)
  setTimeout(send, 25000);
  addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") send(); });
})();
