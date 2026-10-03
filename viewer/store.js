/* Shared issue store.
 *
 * Replaces the browser's localStorage, which was never going to work for
 * three offices: it is private to one browser on one machine, and it caps
 * out around 5 MB - about a dozen issues once snapshots are counted.
 *
 * Sync is polling, not a live connection. The development tunnel does not
 * support Server-Sent Events, and an SSE client against it fails by
 * connecting successfully and then never delivering anything, which is far
 * harder to diagnose than not having it. Polling asks for changes since the
 * last revision it saw, so the request stays small however many issues
 * accumulate.
 *
 * Working without a connection (site staff, a basement, a lift lobby):
 *
 *   - The server's copy of every item is also kept on the device
 *     (IndexedDB, idb.js), per person and per project, so the page opens
 *     with the issues and markups it last saw.
 *   - A change made while the server cannot be reached - a new or edited
 *     item, a delete, a picture - goes into a queue on the device and the
 *     page carries on as if it were saved: put(), remove() and
 *     uploadSnapshot() resolve once the change is safely in the queue.
 *     The queue survives a reload and a restart of the browser.
 *   - Back online the queue goes up by itself, oldest first; an item's
 *     pictures before the item that shows them. An entry leaves the queue
 *     only when the server has answered, so closing the tab half-way loses
 *     nothing: the rest goes up next time, and sending an item twice is
 *     harmless (the server replaces by id).
 *   - A change the server refuses (400 / 403: a Viewer, a locked layer) is
 *     set aside with its reason and shown; it is not retried for ever.
 *   - If someone else changed the same item meanwhile, the two are merged
 *     rather than the older copy overwriting the newer one - see merge3().
 */

import * as DB from "./idb.js";

const POLL_MS = 5000;
const READ_MS = 15000;          // a request with no answer after this long counts as no connection
const WRITE_MS = 30000;

const S = {
  token: null,
  name: "",
  rev: 0,
  items: new Map(),
  /* The server's copy of each item, as text. The page edits the objects it
     is given in place (the issue window does), so the copy an offline
     change started from has to be kept somewhere the page cannot reach. */
  pristine: new Map(),
  /* Writes that have not reached the server yet: id -> { id, op, body,
     base, seq, at, ver }. Without this, a markup drawn while the
     connection is down is replaced by the server's view on the next poll
     and simply vanishes - which looks like the drawing tools being broken
     rather than a failed save. */
  pending: new Map(),
  refused: [],                  // set aside: the server said no
  notices: [],                  // what the user should be told about a sync
  listeners: [],
  stateListeners: [],
  timer: null,
  tick: null,
  online: false,
  lastError: null,
  scope: "",
  seq: 0,
  full: false,                  // a complete list has come from the server since this page opened
  hydrated: false,              // the page opened with a copy from the device
  volatile: false,              // nowhere to keep the queue: it lives only as long as this page
  decided: false,               // the first request to the server has come back, one way or the other
  uploading: false,
  auth: "ok",                   // "needed": the sign-in ran out; queued work waits for a new one
  lastSync: 0,
  started: false,
  busy: null,
  chan: null,
};

/* ------------------------------------------------------------- project */

/* Which project this page is showing. It travels in the URL (?project=)
   so a link to a sheet or an issue opens the right job, and is remembered
   so the next visit starts where the last one left off. Every request
   carries it; the server keeps each project's issues apart. */
const PROJECT_KEY = "lwk-viewer:project";

export function currentProject() {
  const q = new URLSearchParams(location.search).get("project");
  if (q) return q;
  try { return localStorage.getItem(PROJECT_KEY) || ""; } catch (e) { return ""; }
}

export function setProject(id) {
  try { localStorage.setItem(PROJECT_KEY, id); } catch (e) {}
}

/* Where this project's files are served from. */
export const dataUrl = (rel) => {
  const p = currentProject();
  return "/data/" + (p ? encodeURIComponent(p) + "/" : "") + rel;
};

/* A link to the other page, keeping the project. */
export const pageUrl = (page) => {
  const p = currentProject();
  return page + (p ? "?project=" + encodeURIComponent(p) : "");
};

/* ------------------------------------------- what is kept on the device */

/* The projects kept for offline use, as offline.js records them:
   { project: { at, bytes, parts, title, state } }. Read here (and in
   selfcheck.js) without waiting, so the start-up path can tell "no
   connection, but there is a copy" from "nothing to show". */
const COPIES_KEY = "lwk-offline:copies";
const LAST_KEY = "lwk-offline:last:";          // + name: the last good answer of a start-up request

export function offlineCopies() {
  try { return JSON.parse(localStorage.getItem(COPIES_KEY) || "{}") || {}; } catch (e) { return {}; }
}
export function offlineCopy(project) {
  const c = offlineCopies()[project || currentProject() || "default"];
  return c || null;
}
function remember(name, value) {
  try { localStorage.setItem(LAST_KEY + name, JSON.stringify(value)); } catch (e) {}
}
function recall(name) {
  try { return JSON.parse(localStorage.getItem(LAST_KEY + name) || "null"); } catch (e) { return null; }
}
/* A request that never got an answer (as opposed to one the server refused). */
const noAnswer = (e) => !e || e.status === undefined || e.status === null;
const worthFallingBack = () => Object.keys(offlineCopies()).length > 0 || S.hydrated;

/* Does the saved token still work? Checked against the project list, which
   needs no project chosen: on a first visit there is none yet, and asking
   for the issues of "no project" failed in a way that looked exactly like
   a bad passphrase - so the user was sent round the sign-in form forever. */
/* Headers for a request that sends its own body type (an uploaded file). */
export const authHeaders = () => {
  const h = headers();
  delete h["Content-Type"];
  return h;
};

export async function validate() {
  let res;
  try {
    res = await fetch("/api/projects", { headers: headers() });
  } catch (e) {
    /* No connection. Someone who was signed in and has a copy on the
       device carries on with it; whether the sign-in is still good is
       settled when the server can be asked again. */
    if (S.token && worthFallingBack()) return true;
    throw e;
  }
  if (res.status === 401) {
    S.token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    throw new Error("Not signed in");
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return true;
}

export async function listProjects() {
  let res;
  try {
    res = await fetch("/api/projects", { headers: headers() });
  } catch (e) {
    const last = recall("projects");
    if (last) return last;
    throw e;
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!res.headers.get("X-LWK-Offline")) remember("projects", data);
  return data;
}

const TOKEN_KEY = "lwk-viewer:token";
const NAME_KEY = "lwk-viewer:name";
const USER_KEY = "lwk-offline:user";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (S.token) h["X-Viewer-Token"] = S.token;
  const p = currentProject();
  if (p) h["X-Project"] = p;
  return h;
}

/* Who the work on this device belongs to: the account (its number is in
   the token) or, with the shared passphrase, everyone alike. Remembered, so
   that work queued before a sign-in ran out is still found afterwards. */
export function userKey() {
  let t = S.token;
  if (!t) { try { t = localStorage.getItem(TOKEN_KEY); } catch (e) {} }
  let k = null;
  if (t) {
    const m = /^u\.(\d+)\./.exec(t);
    k = m ? "u" + m[1] : "pp";
    try { localStorage.setItem(USER_KEY, k); } catch (e) {}
  } else {
    try { k = localStorage.getItem(USER_KEY); } catch (e) {}
  }
  return k || "pp";
}

async function call(path, options, ms) {
  const opts = Object.assign({ headers: headers() }, options || {});
  let timer = null;
  if (typeof AbortController !== "undefined") {
    const ac = new AbortController();
    opts.signal = ac.signal;
    timer = setTimeout(() => ac.abort(), ms || (opts.method && opts.method !== "GET" ? WRITE_MS : READ_MS));
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new Error("no connection to the server");       // no status: nothing was refused
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401) {
    // The passphrase changed, or this token was issued by an earlier run.
    /* Only a request that carried the token says anything about the token.
       The pages ask for a few things before the session is restored (the
       layers, the templates), going by the cookie alone; a 401 there used
       to throw away a perfectly good saved sign-in whenever the cookie had
       gone - and with it, here, the way back to the queue of offline work. */
    if (S.token) {
      S.token = null;
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      S.auth = "needed";
      emitState();
    }
    const err = new Error("Not signed in");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* For the dashboard and admin pages: the same headers and error handling. */
export const api = (path, options) => call(path, options);

/* ------------------------------------------------------------- session */

export async function ping() {
  let res;
  try {
    res = await fetch("/api/ping");
  } catch (e) {
    const last = recall("ping");
    if (last && worthFallingBack()) return Object.assign({}, last, { offline: true });
    throw new Error("Cannot reach the server - check the connection (or, on the server PC, start server\\run.bat). "
      + "Nothing is kept on this device for working offline yet.");
  }
  /* The page loaded but there is no API behind it: this is the old
     file-only server from the viewer folder, not the real one. Saying
     "not reachable" sent people looking for a server that was in fact
     running, just on a different port. */
  if (res.status === 404) {
    throw new Error("This page is being served by the old viewer server. "
      + "Close viewer\\run.bat and open http://127.0.0.1:8713/ instead.");
  }
  if (!res.ok) throw new Error("Server answered " + res.status + ".");
  const info = await res.json();
  if (res.headers.get("X-LWK-Offline")) info.offline = true;
  else remember("ping", info);
  return info;
}

export async function login(passphrase, name) {
  let res;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: passphrase || "", name: name || "" }),
    });
  } catch (e) {
    throw new Error("No connection - signing in needs the server.");
  }
  if (res.status === 401 || res.status === 429) {
    let detail = "Wrong passphrase";
    try { detail = (await res.json()).detail || detail; } catch (e) {}
    throw new Error(detail);
  }
  if (!res.ok) throw new Error("HTTP " + res.status);

  const data = await res.json();
  S.token = data.token;
  // With accounts the server says who this is; the typed text was an email.
  S.name = data.user ? data.user.name : (name || "");
  try {
    localStorage.setItem(TOKEN_KEY, S.token);
    localStorage.setItem(NAME_KEY, S.name);
  } catch (e) {}
  S.auth = "ok";
  userKey();
  return data;
}

export function restoreSession() {
  try {
    S.token = localStorage.getItem(TOKEN_KEY) || null;
    S.name = localStorage.getItem(NAME_KEY) || "";
  } catch (e) {}
  return !!S.token;
}

export const author = () => S.name;
export const isOnline = () => S.online;
export const lastError = () => S.lastError;

/* --------------------------------------------------------------- items */

/* What the page shows: the server's items with the changes still waiting
   laid over them - an edited item as it was edited, a deleted one gone, a
   new one present. */
export const all = () => {
  const out = [];
  for (const [id, it] of S.items) {
    const p = S.pending.get(id);
    if (!p) out.push(it);
    else if (p.op !== "delete") out.push(p.body);
  }
  for (const [id, p] of S.pending) {
    if (p.op !== "delete" && !S.items.has(id)) out.push(p.body);
  }
  return out;
};
export const get = (id) => {
  const p = S.pending.get(id);
  if (p) return p.op === "delete" ? null : p.body;
  return S.items.get(id) || null;
};
export const pendingCount = () => S.pending.size;

export function onChange(fn) {
  S.listeners.push(fn);
  return () => {
    const i = S.listeners.indexOf(fn);
    if (i >= 0) S.listeners.splice(i, 1);
  };
}

function emit() {
  for (const fn of S.listeners) {
    try { fn(all()); } catch (e) { /* a bad listener must not stop sync */ }
  }
  emitState();
}

/* The connection and the queue, for the header (offline.js). */
export const state = () => ({
  online: S.online, pending: S.pending.size, uploading: S.uploading, auth: S.auth,
  refused: S.refused.map((r) => ({ id: r.id, op: r.op, error: r.error, at: r.at, title: titleOf(r.body) })),
  notices: S.notices.slice(), lastSync: S.lastSync, lastError: S.lastError,
  volatile: S.volatile, hydrated: S.hydrated, full: S.full, started: S.started, decided: S.decided, scope: S.scope,
});
export function onState(fn) {
  S.stateListeners.push(fn);
  return () => {
    const i = S.stateListeners.indexOf(fn);
    if (i >= 0) S.stateListeners.splice(i, 1);
  };
}
function emitState() {
  const st = state();
  for (const fn of S.stateListeners) {
    try { fn(st); } catch (e) { /* never in the way */ }
  }
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function titleOf(body) {
  if (!body) return "";
  const iss = body.issue;
  if (iss) return (iss.number ? "#" + iss.number + " " : "") + (iss.title || "Issue");
  return (body.type || body.placement || "markup") + (body.sheet ? " on " + body.sheet : "");
}

/* What the server sent: into the page's list and onto the device.
   full = the complete list (the first answer after the page opens), so
   anything held here that is not in it has been deleted meanwhile. */
function applyServer(data, full) {
  const list = data.items || [];
  let changed = false;
  const puts = [], dels = [];
  if (full) {
    const seen = new Set(list.map((it) => it.id));
    for (const id of Array.from(S.items.keys())) {
      if (!seen.has(id)) { S.items.delete(id); S.pristine.delete(id); dels.push(DB.key(S.scope, id)); changed = true; }
    }
  }
  for (const it of list) {
    if (it.deleted) {
      if (S.items.delete(it.id)) changed = true;
      S.pristine.delete(it.id);
      dels.push(DB.key(S.scope, it.id));
    } else {
      const had = S.items.get(it.id);
      if (!had || had.rev !== it.rev) puts.push({ k: DB.key(S.scope, it.id), scope: S.scope, item: it });
      S.items.set(it.id, it);
      S.pristine.set(it.id, JSON.stringify(it));
      changed = true;
    }
  }
  if (S.rev > (data.rev || 0) && !full) S.full = false;      // the server's count went back: ask for everything next time
  else if (full) S.full = true;
  S.rev = data.rev || 0;
  if (puts.length || dels.length) DB.write("items", puts, dels);
  return changed;
}

export function sync() {
  if (S.busy) return S.busy;
  S.busy = doSync().finally(() => { S.busy = null; });
  return S.busy;
}

async function doSync() {
  /* First what changed on the server - an upload of a queued change has to
     know whether its item moved on meanwhile. */
  const full = !S.full;
  const data = await call("/api/items?since=" + (full ? 0 : S.rev));
  let changed = applyServer(data, full);
  S.auth = "ok";
  if (!S.online) { S.online = true; S.lastError = null; }     // the server answered
  S.decided = true;

  // Anything still queued goes up next, so a reconnect does not leave a
  // markup sitting locally for ever.
  if (S.pending.size) {
    const sent = await locked(uploadQueue);
    if (sent) {
      const again = await call("/api/items?since=" + S.rev);
      changed = applyServer(again, false) || changed;
    }
    changed = true;
  }
  if (changed || S.pending.size === 0) emit();
  return changed;
}

/* ---------------------------------------------------------------- queue */

/* One tab uploads at a time. Two pages of the same person and project
   (the sheets and the 3D page, or 2D + 3D side by side) share one queue on
   the device; without this each would send it. */
async function locked(fn) {
  if (typeof navigator !== "undefined" && navigator.locks && navigator.locks.request) {
    return navigator.locks.request("lwk-sync|" + S.scope, { ifAvailable: true },
      (lock) => (lock ? fn() : 0));
  }
  return fn();
}

function tellTabs() {
  try { if (S.chan) S.chan.postMessage({ t: "queue", scope: S.scope }); } catch (e) {}
}

function takeQueue(rows) {
  const waiting = new Map();
  const refused = [];
  rows.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const r of rows) {
    S.seq = Math.max(S.seq, r.seq || 0);
    if (r.state === "refused") { refused.push(r); continue; }
    const mine = S.pending.get(r.id);
    // an entry this page changed and has not finished writing wins over the disk's
    waiting.set(r.id, mine && (mine.ver || 0) > (r.ver || 0) ? mine : r);
  }
  // only in memory (the write is on its way, or there is no disk to write to)
  for (const [id, e] of S.pending) {
    if (!waiting.has(id) && (S.volatile || e.writing)) waiting.set(id, e);
  }
  S.pending = waiting;
  S.refused = refused;
}

async function reloadQueue() {
  if (S.volatile) return;
  takeQueue(await DB.allIn("queue", S.scope));
}

async function saveEntry(e) {
  if (S.volatile) return false;
  e.writing = true;
  const rec = { k: DB.key(S.scope, e.id), scope: S.scope, id: e.id, op: e.op, body: e.body || null,
                base: e.base || null, seq: e.seq, at: e.at, ver: e.ver || 1,
                state: e.state || "wait", error: e.error || null, tries: e.tries || 0 };
  const ok = await DB.write("queue", [rec], []);
  e.writing = false;
  if (!ok) S.volatile = true;        // kept in memory; the header says so
  return ok;
}

async function dropEntry(id) {
  S.pending.delete(id);
  if (!S.volatile) await DB.write("queue", [], [DB.key(S.scope, id)]);
}

/* Put a change in the queue. Several changes to one item become one entry
   (the item goes up whole), and it remembers the server's copy the first
   of them started from. */
async function enqueue(op, body) {
  const id = body.id;
  let e = S.pending.get(id);
  if (op === "delete" && e && !e.base && !S.items.has(id)) {
    // made and deleted without the server ever seeing it: nothing to send
    await dropEntry(id);
    emit(); tellTabs();
    return;
  }
  if (S.refused.some((r) => r.id === id)) S.refused = S.refused.filter((r) => r.id !== id);
  if (e) {
    e.op = op;
    e.body = op === "delete" ? null : body;
    e.ver = (e.ver || 1) + 1;
    e.tries = 0;
  } else {
    e = { id, op, body: op === "delete" ? null : body, base: S.pristine.get(id) || null,
          seq: ++S.seq, at: new Date().toISOString(), ver: 1, tries: 0 };
    S.pending.set(id, e);
  }
  await saveEntry(e);
  emit(); tellTabs();
}

const PENDING_PIC = ";lwkpending=1;";
const isPendingPic = (s) => typeof s === "string" && s.length > 40 && s.startsWith("data:image/") && s.indexOf(PENDING_PIC) > 0 && s.indexOf(PENDING_PIC) < 40;

function findPics(node, out, depth) {
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (isPendingPic(node[i])) out.push([node, i]);
      else if (node[i] && typeof node[i] === "object") findPics(node[i], out, depth + 1);
    }
  } else if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (isPendingPic(node[k])) out.push([node, k]);
      else if (node[k] && typeof node[k] === "object") findPics(node[k], out, depth + 1);
    }
  }
  return out;
}
const hasPics = (body) => findPics(body, [], 0).length > 0;

/* A short name for a picture, so one that went up just before the tab was
   closed is not sent a second time. */
function picKey(url) {
  let h = 5381;
  const step = Math.max(1, Math.floor(url.length / 4000));
  for (let i = 0; i < url.length; i += step) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return "pic|" + url.length + "|" + (h >>> 0).toString(36);
}

/* The pictures of a queued item go up before the item, and the item is
   rewritten to hold their paths. */
async function uploadPictures(e) {
  const spots = findPics(e.body, [], 0);
  for (const [holder, k] of spots) {
    const marked = holder[k];
    if (!isPendingPic(marked)) continue;              // the same picture, replaced a moment ago
    const key = picKey(marked);
    let path = await DB.kvGet(key);
    if (!path) {
      const r = await call("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({ data_url: marked.replace(PENDING_PIC, ";") }),
      });
      path = r.path;
      await DB.kvSet(key, path);
    }
    // every place this picture is used, in every queued item
    for (const other of S.pending.values()) {
      if (!other.body) continue;
      let hit = false;
      for (const [h2, k2] of findPics(other.body, [], 0)) {
        if (h2[k2] === marked) { h2[k2] = path; hit = true; }
      }
      if (hit) await saveEntry(other);
    }
  }
  return spots.length;
}

/* The rule when an item changed on the server while a change to it waited
   on the device. base = the server's copy the offline change started from,
   mine = the item as edited here, theirs = the server's copy now.

     - A field edited here is sent as edited here (last write wins, per
       field): status, title, the geometry of a markup ...
     - A field NOT edited here keeps the server's value - so an offline copy
       never silently puts back what someone else has changed since.
     - Discussion: every message of both sides is kept (the server merges
       by message id as well); a message's flags and text follow whoever
       changed them.
     - Photos added on either side are kept; ones removed here are removed.
     - What only the server may say (number, history, who and when) is left
       to it; the history records the fields this upload changed.

   Returns the item to send and whether the other side had really changed
   anything, so the user can be told which issues were merged. */
const SERVER_SAYS = new Set(["rev", "updated_at", "updated_by", "updated_by_id", "author", "author_id", "created_at"]);
const SERVER_SAYS_ISSUE = new Set(["number", "history", "updated_at", "updated_by", "closed_at", "author", "author_id", "created_at"]);
const commentKey = (c) => c.id || ((c.author || "") + "|" + (c.at || "") + "|" + String(c.text || "").slice(0, 80));

function mergeFields(base, mine, theirs, skip, special) {
  const out = clone(theirs) || {};
  const fields = [];
  for (const k of new Set(Object.keys(base || {}).concat(Object.keys(mine || {})))) {
    if (skip.has(k) || (special && special.has(k))) continue;
    if (same(mine[k], (base || {})[k])) continue;          // not touched here: theirs stands
    if (k in mine) out[k] = mine[k]; else delete out[k];
    fields.push(k);
  }
  return { out, fields };
}

export function merge3(base, mine, theirs) {
  const top = mergeFields(base, mine, theirs, SERVER_SAYS, new Set(["issue"]));
  const item = top.out;
  let fields = top.fields;
  const bi = base.issue, mi = mine.issue, ti = theirs.issue;
  if (mi && bi && ti && typeof mi === "object" && typeof ti === "object") {
    const iss = mergeFields(bi, mi, ti, SERVER_SAYS_ISSUE, new Set(["comments", "images"]));
    // discussion
    const bm = new Map((bi.comments || []).map((c) => [commentKey(c), c]));
    const mm = new Map((mi.comments || []).map((c) => [commentKey(c), c]));
    const seen = new Set();
    const comments = [];
    for (const c of ti.comments || []) {
      const k = commentKey(c);
      seen.add(k);
      const m = mm.get(k);
      comments.push(m && !same(m, bm.get(k)) ? m : c);
    }
    for (const c of mi.comments || []) if (!seen.has(commentKey(c))) comments.push(c);
    comments.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    if (comments.length || ti.comments || mi.comments) iss.out.comments = comments;
    if (!same(mi.comments, bi.comments)) iss.fields.push("comments");
    // photos
    const b = bi.images || [], m = mi.images || [], t = ti.images || [];
    if (b.length || m.length || t.length) {
      const removed = b.filter((x) => !m.includes(x));
      const added = m.filter((x) => !b.includes(x));
      iss.out.images = t.filter((x) => !removed.includes(x)).concat(added.filter((x) => !t.includes(x)));
      if (removed.length || added.length) iss.fields.push("images");
    }
    item.issue = iss.out;
    fields = fields.concat(iss.fields);
  } else if (!same(mi, bi)) {
    if (mi) item.issue = mi; else delete item.issue;
    fields.push("issue");
  }
  return { item, fields, theirsChanged: !same(bare(base), bare(theirs)) };
}

function notice(n) {
  n.at = new Date().toISOString();
  S.notices.push(n);
  S.notices = S.notices.slice(-60);
  DB.kvSet("notices|" + S.scope, S.notices);
}
export function clearNotices() {
  S.notices = [];
  DB.kvDel("notices|" + S.scope);
  emitState();
}

async function setAside(e, why) {
  S.pending.delete(e.id);
  e.state = "refused";
  e.error = why;
  S.refused = S.refused.filter((r) => r.id !== e.id).concat([e]);
  await saveEntry(e);
  S.lastError = why;
  notice({ kind: "refused", id: e.id, title: titleOf(e.body) || "a deleted item", detail: why });
}

/* One queued change, sent. Throws when it could not be (the caller tells
   "refused" from "no connection" by the error's status). */
async function uploadEntry(e) {
  const ver = e.ver;
  const base = e.base ? JSON.parse(e.base) : null;
  const theirs = S.items.get(e.id) || null;
  const moved = !!(base && theirs && theirs.rev !== base.rev);

  if (e.op === "delete") {
    if (!theirs) { await dropEntry(e.id); return; }       // gone already
    if (moved && !same(bare(base), bare(theirs))) {
      /* Someone changed it after this device last saw it. Deleting it now
         would throw their change away unseen: it stays, and the user is told. */
      notice({ kind: "kept", id: e.id, title: titleOf(theirs), by: theirs.updated_by || theirs.author || "" });
      await dropEntry(e.id);
      return;
    }
    try {
      await call("/api/items/" + encodeURIComponent(e.id), { method: "DELETE" });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    S.items.delete(e.id); S.pristine.delete(e.id);
    DB.write("items", [], [DB.key(S.scope, e.id)]);
    if (e.ver === ver) await dropEntry(e.id);
    return;
  }

  await uploadPictures(e);
  let body = clone(e.body);
  if (base && !theirs) {
    // deleted on the server meanwhile; the work done here is not thrown away
    notice({ kind: "restored", id: e.id, title: titleOf(body) });
  } else if (moved) {
    const m = merge3(base, body, theirs);
    body = m.item;
    if (m.theirsChanged) {
      notice({ kind: "merged", id: e.id, title: titleOf(body), by: theirs.updated_by || "", fields: m.fields });
    }
  }
  delete body.rev; delete body.updated_at;
  const saved = await call("/api/items", { method: "POST", body: JSON.stringify(body) });
  const it = (saved && saved.item) || body;
  if (saved && saved.rev) it.rev = saved.rev;
  S.items.set(e.id, it);
  S.pristine.set(e.id, JSON.stringify(it));
  DB.write("items", [{ k: DB.key(S.scope, e.id), scope: S.scope, item: it }], []);
  if (e.ver === ver) await dropEntry(e.id);
  else { e.base = JSON.stringify(it); await saveEntry(e); }      // edited again while it went up: once more
}
/* An item without what only the server writes: for "did anything real change?" */
function bare(it) {
  const c = clone(it) || {};
  for (const k of SERVER_SAYS) delete c[k];
  if (c.issue) for (const k of SERVER_SAYS_ISSUE) delete c.issue[k];
  return c;
}

const REFUSALS = new Set([400, 403, 404, 409, 413, 422]);

async function uploadQueue() {
  await reloadQueue();
  if (!S.pending.size) return 0;
  S.uploading = true;
  emitState();
  let sent = 0;
  try {
    const list = Array.from(S.pending.values()).sort((a, b) => a.seq - b.seq);
    for (const e of list) {
      if (S.pending.get(e.id) !== e) continue;
      try {
        await uploadEntry(e);
        sent++;
        emitState();
      } catch (err) {
        if (REFUSALS.has(err.status)) {
          // Refused, not offline: retrying for ever would never succeed.
          await setAside(e, err.message);
          sent++;
          continue;
        }
        if (err.status >= 500) {
          // the server stumbled on this one: a few more tries, then aside
          e.tries = (e.tries || 0) + 1;
          if (e.tries >= 5) { await setAside(e, err.message); sent++; }
          else await saveEntry(e);
          continue;
        }
        throw err;               // no connection, or signed out: the rest waits
      }
    }
  } finally {
    S.uploading = false;
    tellTabs();
    emitState();
  }
  return sent;
}

/* Changes set aside because the server refused them. */
export const refused = () => S.refused.slice();
export async function discardRefused(id) {
  S.refused = S.refused.filter((r) => r.id !== id);
  await DB.write("queue", [], [DB.key(S.scope, id)]);
  emit(); tellTabs();
}
export async function retryRefused(id) {
  const e = S.refused.find((r) => r.id === id);
  if (!e) return;
  S.refused = S.refused.filter((r) => r.id !== id);
  e.state = "wait"; e.error = null; e.tries = 0; e.ver = (e.ver || 1) + 1;
  S.pending.set(id, e);
  await saveEntry(e);
  emit(); tellTabs();
  kick();
}

/* Try the server now (the header's "Sync now", a reconnect, the page
   coming back to the front). */
let _kick = null;
function kick() {
  if (_kick || !S.tick) return;
  _kick = setTimeout(() => { _kick = null; if (S.tick) S.tick(); }, 0);
}
export function syncNow() {
  return S.tick ? S.tick() : Promise.resolve();
}

const offlineNow = () => !S.online || (typeof navigator !== "undefined" && navigator.onLine === false);

/* Writes go to the server first and the local copy is updated from what
   comes back. Updating locally first would show a saved issue that in fact
   failed to save, which is the one outcome worth avoiding here.

   Without a connection the write goes into the queue on the device
   instead, and that counts as done: the header says how many changes are
   waiting, and they upload by themselves. Only a refusal (400 / 403)
   throws. */
export async function put(item) {
  const body = Object.assign({}, item);
  if (!body.author && S.name) body.author = S.name;

  if (offlineNow() || S.pending.has(body.id) || hasPics(body)) {
    await enqueue("put", body);
    kick();
    return body;
  }

  let saved = null;
  try {
    saved = await call("/api/items", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    if (e.status === 403 || e.status === 400) {
      // A viewer, or not a member: say so, and do not queue a retry.
      S.lastError = e.message;
      emit();
      throw e;
    }
    // Hold it on the device and keep showing it; sync() retries on every poll.
    if (noAnswer(e)) { S.online = false; S.lastError = e.message; }
    await enqueue("put", body);
    return body;
  }

  // The server's copy: it sets the author, who changed it and the history.
  const it = (saved && saved.item) || body;
  if (saved && saved.rev && it.rev === undefined) it.rev = saved.rev;
  S.items.set(body.id, it);
  S.pristine.set(body.id, JSON.stringify(it));
  DB.write("items", [{ k: DB.key(S.scope, body.id), scope: S.scope, item: it }], []);
  emit();
  try { await sync(); } catch (e) { /* it is saved; the next poll catches up */ }
  return body;
}

export async function remove(id) {
  if (offlineNow() || S.pending.has(id)) {
    await enqueue("delete", { id });
    kick();
    return;
  }
  try {
    await call("/api/items/" + encodeURIComponent(id), { method: "DELETE" });
  } catch (e) {
    if (e.status === 404) { /* gone already */ }
    else if (noAnswer(e) || e.status === 401 || e.status >= 500) {
      if (noAnswer(e)) { S.online = false; S.lastError = e.message; }
      await enqueue("delete", { id });
      return;
    } else throw e;
  }
  S.items.delete(id);
  S.pristine.delete(id);
  DB.write("items", [], [DB.key(S.scope, id)]);
  emit();
  try { await sync(); } catch (e) { /* the next poll catches up */ }
}

/* Snapshots are uploaded and referenced by path. Keeping the data URL in the
   record is what filled localStorage; a path is about 40 bytes.

   Without a connection the picture cannot go up yet. It is handed back as
   a marked data URL - which shows in the page like any picture - and
   travels inside the queued item (IndexedDB has room for it); at upload it
   goes to the server first and every queued item that uses it is rewritten
   to the /snapshots/... path. */
export async function uploadSnapshot(dataUrl) {
  if (!dataUrl) return null;
  if (!/^data:/.test(dataUrl)) return dataUrl;      // already a path
  if (isPendingPic(dataUrl)) return dataUrl;        // waiting for the connection already
  const canHold = /^data:image\/(png|jpe?g);base64,/i.test(dataUrl);
  const held = () => dataUrl.replace(";base64,", PENDING_PIC + "base64,");
  if (canHold && offlineNow()) return held();
  try {
    const r = await call("/api/snapshots", {
      method: "POST",
      body: JSON.stringify({ data_url: dataUrl }),
    });
    return r.path;
  } catch (e) {
    if (canHold && (noAnswer(e) || e.status === 401 || e.status >= 500)) {
      if (noAnswer(e)) { S.online = false; S.lastError = e.message; emitState(); }
      return held();
    }
    throw e;
  }
}

/* ------------------------------------------------------------- polling */

/* What was kept on the device for this person and project: shown at once,
   before (or without) the server's answer. */
async function hydrate() {
  S.scope = userKey() + "|" + (currentProject() || "default");
  if (!(await DB.available())) { S.volatile = true; return; }
  const [items, queue, notices] = await Promise.all([
    DB.allIn("items", S.scope), DB.allIn("queue", S.scope), DB.kvGet("notices|" + S.scope)]);
  for (const r of items) {
    if (!r.item || !r.item.id) continue;
    S.items.set(r.item.id, r.item);
    S.pristine.set(r.item.id, JSON.stringify(r.item));
  }
  takeQueue(queue);
  S.notices = Array.isArray(notices) ? notices : [];
  S.hydrated = items.length > 0 || queue.length > 0;
}

export async function start(onStatus) {
  await hydrate();
  S.started = true;
  if (S.hydrated) emit();

  const tick = async () => {
    try {
      await sync();
      if (!S.online) { S.online = true; S.lastError = null; }
      S.lastSync = Date.now();
      if (onStatus) onStatus(true, null);
    } catch (e) {
      if (e.status === 401) S.online = true;          // reached, but not let in
      else S.online = false;
      S.decided = true;
      S.lastError = e.message;
      if (onStatus) onStatus(false, e.message);
    }
    emitState();
  };
  S.tick = tick;

  /* With a copy on the device the page does not wait on a connection that
     may never answer: it opens with what it has, and the server's answer
     is merged in when (if) it comes. */
  const first = tick();
  if (S.hydrated || offlineCopy()) {
    await Promise.race([first, new Promise((r) => setTimeout(r, 2500))]);
  } else {
    await first;
  }
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(tick, POLL_MS);

  // No Background Sync on iOS Safari: the page itself notices the
  // connection coming back, and being brought to the front again.
  addEventListener("online", () => kick());
  addEventListener("offline", () => { S.online = false; emitState(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (S.pending.size || !S.online)) kick();
  });
  try {
    if (typeof BroadcastChannel !== "undefined") {
      S.chan = new BroadcastChannel("lwk-offline");
      S.chan.onmessage = async (ev) => {
        if (!ev.data || ev.data.t !== "queue" || ev.data.scope !== S.scope) return;
        await reloadQueue();
        emit();
      };
    }
  } catch (e) { /* older Safari: each tab finds out at its next poll */ }
}

export function stop() {
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
}

/* How many changes wait on this device for other people or projects, for
   the offline window ("2 changes of another account wait here"). */
export async function queuedElsewhere() {
  const rows = await DB.allOf("queue");
  const out = {};
  for (const r of rows) {
    if (r.scope === S.scope || r.state === "refused") continue;
    out[r.scope] = (out[r.scope] || 0) + 1;
  }
  return out;
}

/* One-off move of anything still sitting in this browser from before the
   server existed. Local records are left alone so a failed upload can be
   retried rather than losing the only copy. */
export async function importLocal(key) {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(key) || "[]"); }
  catch (e) { return { moved: 0, failed: 0 }; }
  if (!local.length) return { moved: 0, failed: 0 };

  let moved = 0, failed = 0;
  for (const it of local) {
    try {
      if (it.snapshot && /^data:/.test(it.snapshot)) {
        it.snapshot = await uploadSnapshot(it.snapshot);
      }
      await put(it);
      moved++;
    } catch (e) {
      failed++;
    }
  }
  return { moved, failed };
}
