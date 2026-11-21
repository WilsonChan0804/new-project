/* LWK Viewer backend for the knowledge base's editing (kb.js).
 *
 * Inside the LWK Viewer the site is served at /kb/ and edits are kept on the
 * viewer's server under each person's viewer account. This gives kb.js the
 * same small interface it already uses with the claude.ai runtime, so its
 * editing code needs only three lines changed (see the note at the end):
 *
 *   KBViewer.me()       -> {uid, name, admin, can_edit} when inside the viewer and
 *                          signed in, else null (then use the claude.ai runtime)
 *   KBViewer.db()       -> {collection("edits").add(doc), .where("page","==",p).onSnapshot(cb, err)}
 *   KBViewer.user(me)   -> {id(), can(), profiles(ids)}  (names come from the viewer)
 *   KBViewer.undo(id)   -> undo an edit (its author, or a site admin)
 *   KBViewer.history(p) -> every edit of a page, including the undone ones
 *   KBViewer.pageId()   -> the page's source path, e.g. "pnap/app-2.md"
 *
 * Viewer API (same origin, the viewer's sign-in cookie):
 *   GET  /api/kb/me                      {uid, name, admin, can_edit, viewer: true}  (401: not signed in)
 *   GET  /api/kb/edits?page=<source path>    {items: [{id, page, block, anchor, text, note, original, uid, name, at, ...}]}
 *   POST /api/kb/edits  {page, block, anchor, text, note, original}  -> the saved edit (uid, name, at set by the server)
 *   POST /api/kb/edits/<id>/undo         -> the edit, undone
 *   GET  /api/kb/history?page=           {items: [...]} including undone ones
 */
(function () {
  "use strict";
  var names = {};
  var subs = [];
  var ME = null;

  function pageId() {
    var m = document.querySelector('meta[name="kb-page"]');
    if (m && m.content) return m.content;
    // fallback: from the address under /kb/ (directory URLs): pnap/app-2/ -> pnap/app-2.md
    var p = decodeURIComponent(location.pathname).replace(/^.*?\/kb\//, "").replace(/index\.html$/, "");
    if (!p) return "index.md";
    return p.replace(/\/$/, "") + ".md";
  }

  async function me() {
    if (ME) return ME;
    try {
      var r = await fetch("/api/kb/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      var j = await r.json();
      ME = j && j.viewer ? j : null;
      return ME;
    } catch (e) { return null; }
  }

  function asDocs(items) {
    return {
      docs: items.map(function (e) {
        names[e.uid] = { name: e.name };
        var d = { id: e.id, page: e.page, block: e.block, anchor: e.anchor, text: e.text, note: e.note, original: e.original,
          by: e.uid, name: e.name, at: e.at };
        return { id: String(e.id), data: function () { return d; } };
      }),
    };
  }

  async function refresh(page) {
    var r = await fetch("/api/kb/edits?page=" + encodeURIComponent(page), { credentials: "same-origin" });
    if (!r.ok) throw new Error("edits " + r.status);
    var j = await r.json();
    var snap = asDocs(j.items || []);
    subs.forEach(function (s) { if (s.page === page) { try { s.cb(snap); } catch (e) {} } });
  }
  function refreshAll() { subs.forEach(function (s) { refresh(s.page).catch(function (e) { if (s.err) s.err(e); }); }); }
  setInterval(refreshAll, 30000);
  window.addEventListener("focus", refreshAll);

  function db() {
    return {
      collection: function () {
        return {
          add: async function (doc) {
            var r = await fetch("/api/kb/edits", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ page: doc.page, block: doc.block, anchor: doc.anchor || "", text: doc.text, note: doc.note || "", original: doc.original || "" }),
            });
            if (!r.ok) {
              var err = new Error("not saved");
              err.code = r.status === 401 || r.status === 403 ? "not_granted" : "failed";
              throw err;
            }
            var saved = await r.json();
            refresh(doc.page).catch(function () {});
            return saved;
          },
          where: function (field, op, value) {
            return {
              onSnapshot: function (cb, err) {
                var s = { page: value, cb: cb, err: err };
                subs.push(s);
                refresh(value).catch(function (e) { if (err) err(e); });
                return function () { subs = subs.filter(function (x) { return x !== s; }); };
              },
            };
          },
        };
      },
    };
  }

  function user(m) {
    return {
      id: async function () { return m.uid; },
      can: async function () { return !!m.can_edit; },
      profiles: async function (ids) { var o = {}; ids.forEach(function (i) { o[i] = names[i] || { name: "" }; }); return o; },
      admin: !!m.admin,
      name: m.name,
    };
  }

  async function undo(id) {
    var r = await fetch("/api/kb/edits/" + encodeURIComponent(id) + "/undo", { method: "POST", credentials: "same-origin" });
    if (!r.ok) throw new Error(r.status === 403 ? "Only its author or a site admin can undo an edit" : "Not undone");
    refreshAll();
    return r.json();
  }
  async function history(page) {
    var r = await fetch("/api/kb/history?page=" + encodeURIComponent(page || pageId()), { credentials: "same-origin" });
    return r.ok ? (await r.json()).items : [];
  }

  window.KBViewer = { me: me, db: db, user: user, undo: undo, history: history, pageId: pageId };
})();

/* In kb.js (three changes):
 *
 * 1. var PAGE = (window.KBViewer && KBViewer.pageId()) || <the current way>;
 *
 * 2. In startEditing(), first:
 *      var V = window.KBViewer ? await KBViewer.me() : null;
 *      if (!V && (!window.claude || typeof window.claude.use !== "function")) return;
 *      var db = V ? KBViewer.db() : await window.claude.use("db");
 *      ...
 *      state.user = V ? KBViewer.user(V) : await window.claude.use("user");
 *
 * 3. (Better) show "Undo" beside "Edited by NAME" when state.me === e.by or
 *    state.user.admin, calling KBViewer.undo(e.id).
 *
 * Load this file before kb.js (extra_javascript order in mkdocs.yml).
 */
