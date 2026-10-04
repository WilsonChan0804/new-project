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

const realFetch = window.fetch.bind(window);
const HOLD = new Map();          // key -> { at, p, early }
const EARLY_MS = 10000;

function token() {
  try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; }
}
function project() {
  const q = new URLSearchParams(location.search).get("project");
  if (q) return q;
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
      ask("/api/items?since=0");
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
    if (list && !q.get("mode") && !q.get("quick") && !q.get("attach")) ask("/api/tasks?list=" + encodeURIComponent(list) + "&since=0");
  } else if (page === "projects.html") {
    ask("/api/registry");
    ask("/api/chat/rooms");
  } else if (page === "messenger.html") {
    ask("/api/people");
    ask("/api/chat/rooms");
  }
})();
