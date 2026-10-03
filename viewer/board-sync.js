/* Keeping one board the same on everybody's screen.
 *
 * Polling, like the issue store (see store.js for why there is no live
 * connection). Every couple of seconds the page says "I am here, I have
 * seen revision N" and gets back who else is here and what changed.
 *
 * The rules that keep work from being lost:
 *
 *   - A change is applied to the local copy at once and queued. The queue
 *     goes up as one batch a moment later; if the network is down it stays
 *     queued (and is kept in this browser's storage) until it gets through.
 *   - What comes down never replaces an object that is queued, being typed
 *     in or being dragged. The local version is on its way up and will be
 *     the later save - which is the one that wins.
 *   - Objects are saved whole and one by one. Two people working on
 *     different objects cannot overwrite each other, whatever the timing.
 *   - An answer that is older than what this page already holds (a poll
 *     that crossed a save on the wire) is ignored, by revision number.
 */

import { api, project } from "./nav.js";
import { clone } from "./board-util.js";

const POLL_MS = 1500;
const POLL_IDLE_MS = 6000;       // tab in the background
const FLUSH_MS = 250;
const STAMPS = ["rev", "cby", "cat", "uby", "uat"];

export function createSync(opts) {
  // opts: bid, name, canEdit, onRemote(upserts, deletes), onStatus(), onPresence(list), onBoard(meta), onGone(), isBusy(id), cursor()
  const S = {
    bid: opts.bid,
    objs: new Map(),           // id -> object (the local truth the page draws)
    rev: 0,                    // the last revision seen from the server
    dirty: new Map(),          // id -> change number, not yet confirmed saved
    tomb: new Map(),           // id -> revision at which this page deleted it
    held: new Map(),           // id -> a remote version waiting for a local edit to end
    seq: 0,
    sending: false,
    online: true,
    error: "",
    stopped: false,
    cid: "c" + Math.random().toString(36).slice(2, 12),
    clockSkew: 0,              // server time minus this machine's, ms
    timer: null,
    flushTimer: null,
    polling: false,
    lastSaved: 0,
  };
  const path = "/api/boards/" + encodeURIComponent(S.bid);
  const storeKey = "lwk-board:pending:" + project() + ":" + S.bid;

  const strip = (o) => {
    const c = {};
    for (const k in o) if (!STAMPS.includes(k) && k[0] !== "_") c[k] = o[k];
    return c;
  };

  function status() {
    if (opts.onStatus) {
      opts.onStatus({ online: S.online, pending: S.dirty.size, sending: S.sending, error: S.error,
                      savedAt: S.lastSaved });
    }
  }

  /* The queue survives a closed tab: a plane, a tunnel, a laptop lid. */
  function persist() {
    try {
      if (!S.dirty.size) { localStorage.removeItem(storeKey); return; }
      const ups = [], dels = [];
      for (const id of S.dirty.keys()) {
        const o = S.objs.get(id);
        if (o) ups.push(strip(o)); else dels.push(id);
      }
      localStorage.setItem(storeKey, JSON.stringify({ at: Date.now(), ups, dels }));
    } catch (e) { /* storage full or private mode: the queue still lives in memory */ }
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) {}
    if (!saved || !opts.canEdit) return;
    // A week-old queue is more likely to undo someone's later work than to rescue anything.
    if (Date.now() - (saved.at || 0) > 7 * 86400000) { try { localStorage.removeItem(storeKey); } catch (e) {} return; }
    const ups = [], dels = [];
    for (const o of saved.ups || []) {
      if (!o || !o.id) continue;
      S.objs.set(o.id, clean(Object.assign({}, S.objs.get(o.id) || {}, o)));
      S.dirty.set(o.id, ++S.seq);
      ups.push(S.objs.get(o.id));
    }
    for (const id of saved.dels || []) {
      if (S.objs.delete(id)) dels.push(id);
      S.dirty.set(id, ++S.seq);
    }
    if (ups.length || dels.length) schedule();
  }

  /* What arrives was written by another browser, and the page puts some of
     it into markup and styles. Sizes and positions are made to be numbers
     and text to be text here, once, so that no drawing code has to wonder. */
  const NUMS = ["x", "y", "w", "h", "z", "fs", "sw", "ord", "ow", "oh", "ts", "end", "left", "dur", "num"];
  function clean(o) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      // only the connector ends are objects and only the pen's points a list; anything else nested is not ours
      if (v !== null && typeof v === "object" && !(k === "a" || k === "b" || (k === "pts" && Array.isArray(v)))) delete o[k];
    }
    for (const k of NUMS) {
      const v = o[k];
      if (v === undefined) continue;
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e15) delete o[k]; else o[k] = n;      // 1e15: room for a time in milliseconds
    }
    if (o.text !== undefined && typeof o.text !== "string") o.text = typeof o.text === "number" ? String(o.text) : "";
    if (o.pts !== undefined) o.pts = Array.isArray(o.pts) ? o.pts.slice(0, 8000).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)) : [];
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    for (const end of ["a", "b"]) {
      const e = o[end];
      if (e === undefined) continue;
      if (!e || typeof e !== "object") { o[end] = { x: 0, y: 0 }; continue; }
      o[end] = typeof e.o === "string" ? { o: e.o, x: num(e.x), y: num(e.y) } : { x: num(e.x), y: num(e.y) };
    }
    return o;
  }

  function applyRemote(list) {
    const ups = [], dels = [];
    for (const o of list) {
      if (!o.deleted) clean(o);
      const id = o.id;
      if (S.dirty.has(id)) continue;                      // ours is on its way up
      if (opts.isBusy && opts.isBusy(id)) { S.held.set(id, o); continue; }
      if ((S.tomb.get(id) || 0) >= o.rev) continue;       // older than our own delete
      const cur = S.objs.get(id);
      if (o.deleted) {
        if (cur) { S.objs.delete(id); dels.push(id); }
        continue;
      }
      if (cur && (cur.rev || 0) >= o.rev) continue;       // already have this or newer
      S.objs.set(id, o);
      ups.push(o);
    }
    if ((ups.length || dels.length) && opts.onRemote) opts.onRemote(ups, dels);
  }

  async function load() {
    const data = await api(path + "/objects?since=0");
    S.rev = data.rev;
    S.clockSkew = (data.now || Date.now()) - Date.now();
    for (const o of data.objects || []) S.objs.set(o.id, clean(o));
    restore();
    return data;
  }

  function schedule() {
    status();
    persist();
    if (S.flushTimer || S.stopped) return;
    S.flushTimer = setTimeout(() => { S.flushTimer = null; flush(); }, FLUSH_MS);
  }

  /* A local change to these objects (already made in S.objs, or removed
     from it): queue it for the server. */
  function touch(ids) {
    if (!opts.canEdit) return;
    for (const id of ids) {
      S.dirty.set(id, ++S.seq);
      S.held.delete(id);
    }
    schedule();
  }

  async function flush(keepalive) {
    if (S.sending || !S.dirty.size || S.stopped) return;
    const sent = new Map(S.dirty);
    const upsert = [], del = [];
    for (const id of sent.keys()) {
      const o = S.objs.get(id);
      if (o) upsert.push(strip(o)); else del.push(id);
    }
    S.sending = true;
    status();
    try {
      const res = await api(path + "/objects", {
        method: "POST", keepalive: !!keepalive,
        body: JSON.stringify({ upsert, delete: del, by: opts.name || "" }),
      });
      for (const [id, n] of sent) {
        const o = S.objs.get(id);
        // The revision this save got. A poll answer from before it is now recognisably old.
        if (o) {
          o.rev = res.rev;
          o.uby = opts.name || o.uby;
          o.uat = new Date(Date.now() + S.clockSkew).toISOString();
          if (!o.cby) { o.cby = opts.name || ""; o.cat = o.uat; }
        } else {
          S.tomb.set(id, res.rev);
        }
        if (S.dirty.get(id) === n) S.dirty.delete(id);    // not changed again while this was in the air
      }
      S.online = true;
      S.error = "";
      S.lastSaved = Date.now();
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 413 || e.status === 404) {
        // Refused, not offline: sending it again would be refused again.
        for (const [id, n] of sent) if (S.dirty.get(id) === n) S.dirty.delete(id);
        S.error = e.message;
        if (e.status === 404 && opts.onGone) opts.onGone();
        if (opts.onRefused) opts.onRefused(e, Array.from(sent.keys()));
      } else {
        S.online = false;                                  // stays queued; the next poll tries again
      }
    }
    S.sending = false;
    persist();
    status();
    S.error = "";                      // said once; the next save starts clean
    if (S.dirty.size && S.online && !S.stopped) schedule();
  }

  async function poll() {
    if (S.polling || S.stopped) return;
    S.polling = true;
    try {
      if (S.dirty.size && !S.sending) await flush();
      // Remote versions that arrived while an object was being edited, and
      // whose edit ended without a change (a cancelled drag, Escape).
      if (S.held.size) {
        const free = [];
        for (const [id, o] of S.held) {
          if (!(opts.isBusy && opts.isBusy(id))) { free.push(o); S.held.delete(id); }
        }
        if (free.length) applyRemote(free);
      }
      const cur = (opts.cursor && opts.cursor()) || {};
      const data = await api(path + "/presence", {
        method: "POST",
        body: JSON.stringify({ cid: S.cid, by: opts.name || "", since: S.rev, x: cur.x, y: cur.y }),
      });
      const wasOffline = !S.online;
      S.online = true;
      S.clockSkew = (data.now || Date.now()) - Date.now();
      if (data.objects) applyRemote(data.objects);
      S.rev = Math.max(S.rev, data.rev);
      if (opts.onPresence) opts.onPresence(data.presence || []);
      if (opts.onBoard && data.board) opts.onBoard(data.board);
      if (wasOffline) status();
    } catch (e) {
      if (e.status === 404) {
        if (opts.onGone) opts.onGone();
      } else if (e.status === 401 || e.status === 403) {
        S.error = e.message;
        status();
        S.error = "";
      } else if (S.online) {
        S.online = false;
        status();
      }
    }
    S.polling = false;
  }

  function loop() {
    if (S.stopped) return;
    S.timer = setTimeout(async () => {
      await poll();
      loop();
    }, document.hidden ? POLL_IDLE_MS : POLL_MS);
  }

  function start() {
    loop();
    // A tab that is closed with something queued gets one last try; the
    // browser lets a small request outlive the page.
    addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisible);
  }
  const onHide = () => {
    if (S.dirty.size) flush(true);
    try {
      fetch(path + "/presence?project=" + encodeURIComponent(project()), {
        method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid: S.cid, leave: true }),
      }).catch(() => {});
    } catch (e) {}
  };
  const onVisible = () => { if (!document.hidden) poll(); };

  function stop() {
    onHide();                          // one last save, and "I have left"
    S.stopped = true;
    clearTimeout(S.timer);
    clearTimeout(S.flushTimer);
    removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisible);
  }

  return { S, load, start, stop, touch, flush, poll, strip,
           now: () => Date.now() + S.clockSkew,
           snapshot: () => Array.from(S.objs.values()).map((o) => clone(strip(o))) };
}
