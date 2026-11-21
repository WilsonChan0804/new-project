/* Knowledge base page helpers:
 *  1. "Back" button on every page.
 *  2. Shared editing of paragraphs / clauses with the editor's name shown.
 *     Uses the claude.ai Artifact runtime (db + user capabilities) when the
 *     site is opened as a hosted Artifact; elsewhere the editing UI stays hidden.
 */
(function () {
  "use strict";

  /* ---------- 1. Back button ---------- */
  function addBack() {
    var art = document.querySelector("article.md-content__inner");
    if (!art || art.querySelector(".kb-back")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "kb-back";
    b.textContent = "← Back 返回";
    b.title = "Go back to the previous page 返回上一頁";
    b.addEventListener("click", function () {
      if (history.length > 1) history.back();
      else location.href = document.querySelector(".md-header__button.md-logo")?.href || "index.html";
    });
    art.insertBefore(b, art.firstChild);
  }

  /* ---------- 2. Shared editing ---------- */
  var PAGE = (location.pathname.split("/").slice(-2).join("/") || "index.html").replace(/\/$/, "/index.html");
  var state = { db: null, user: null, me: null, edits: [], names: {}, canWrite: false };

  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function blocks() {
    var art = document.querySelector("article.md-content__inner");
    if (!art) return [];
    return Array.prototype.filter.call(art.querySelectorAll("p, li"), function (el) {
      if (el.closest(".kb-ui, nav, figure, .md-source-file, .kb-back, .tabbed-labels")) return false;
      if (el.tagName === "LI" && el.querySelector("ul, ol, p")) return false;
      return (el.textContent || "").trim().length >= 20;
    });
  }
  function keyOf(el) {
    if (!el.dataset.kbKey) {
      el.dataset.kbOrig = el.innerHTML;
      el.dataset.kbKey = hash(el.textContent.trim().slice(0, 400));
    }
    return el.dataset.kbKey;
  }
  function fmt(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ""; } }
  function nameOf(id) { return (state.names[id] && state.names[id].name) || "Someone 某用戶"; }

  async function resolveNames() {
    var ids = Array.from(new Set(state.edits.map(function (e) { return e.by; }).filter(Boolean)));
    if (!ids.length || !state.user || !state.user.profiles) return;
    try { state.names = await state.user.profiles(ids); } catch (e) { /* names optional */ }
  }

  function latestByBlock() {
    var m = {};
    state.edits.forEach(function (e) { if (!m[e.block] || e.at > m[e.block].at) m[e.block] = e; });
    return m;
  }

  function render() {
    var latest = latestByBlock();
    blocks().forEach(function (el) {
      var k = keyOf(el);
      var old = el.querySelector(":scope > .kb-badge"); if (old) old.remove();
      var e = latest[k];
      if (e) {
        if (!el.dataset.kbShowOrig) el.textContent = e.text;
        el.classList.add("kb-edited");
        var n = state.edits.filter(function (x) { return x.block === k; }).length;
        var badge = document.createElement("span");
        badge.className = "kb-badge kb-ui";
        badge.textContent = "✎ Edited by " + nameOf(e.by) + " · " + fmt(e.at) + (n > 1 ? " · " + n + " edits" : "") + " ";
        var tog = document.createElement("button");
        tog.type = "button";
        tog.textContent = el.dataset.kbShowOrig ? "Show edited 顯示修改" : "Show original 顯示原文";
        tog.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (el.dataset.kbShowOrig) { delete el.dataset.kbShowOrig; } else { el.dataset.kbShowOrig = "1"; el.innerHTML = el.dataset.kbOrig; }
          render();
        });
        badge.appendChild(tog);
        el.appendChild(badge);
      } else {
        el.classList.remove("kb-edited");
      }
      if (state.canWrite && !el.querySelector(":scope > .kb-pen")) {
        var pen = document.createElement("button");
        pen.type = "button"; pen.className = "kb-pen kb-ui"; pen.title = "Edit this paragraph 編輯此段"; pen.textContent = "✎";
        pen.addEventListener("click", function (ev) { ev.stopPropagation(); openEditor(el); });
        el.appendChild(pen);
      }
    });
    renderLog();
  }

  function openEditor(el) {
    if (el.nextElementSibling && el.nextElementSibling.classList.contains("kb-editor")) return;
    var k = keyOf(el);
    var latest = latestByBlock()[k];
    var box = document.createElement("div");
    box.className = "kb-editor kb-ui";
    var ta = document.createElement("textarea");
    var tmp = document.createElement("div"); tmp.innerHTML = el.dataset.kbOrig;
    ta.value = latest ? latest.text : tmp.textContent.trim();
    ta.rows = Math.min(12, Math.max(3, Math.ceil(ta.value.length / 90)));
    var note = document.createElement("input");
    note.placeholder = "Reason for the change (optional) 修改原因（選填）";
    var save = document.createElement("button"); save.type = "button"; save.textContent = "Save 儲存";
    var cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel 取消";
    var msg = document.createElement("span"); msg.className = "kb-msg";
    cancel.addEventListener("click", function () { box.remove(); });
    save.addEventListener("click", async function () {
      var text = ta.value.trim();
      if (!text) { msg.textContent = "Text cannot be empty 內容不能空白"; return; }
      save.disabled = true; msg.textContent = "Saving… 儲存中";
      try {
        await state.db.collection("edits").add({
          page: PAGE, block: k, text: text.slice(0, 5000), note: note.value.slice(0, 300),
          original: tmp.textContent.trim().slice(0, 600), by: state.me, at: Date.now()
        });
        box.remove();
      } catch (e) {
        save.disabled = false;
        msg.textContent = (e && (e.code === "not_granted" || e.code === "invalid_argument")) ? "You do not have permission to edit 你沒有編輯權限" : "Could not save, please try again 無法儲存";
      }
    });
    box.append(ta, note, save, cancel, msg);
    el.insertAdjacentElement("afterend", box);
    ta.focus();
  }

  function renderLog() {
    var art = document.querySelector("article.md-content__inner");
    if (!art) return;
    var panel = document.querySelector(".kb-log");
    if (!state.edits.length) { if (panel) panel.remove(); return; }
    if (!panel) {
      panel = document.createElement("details");
      panel.className = "kb-log kb-ui";
      art.appendChild(panel);
    }
    var list = state.edits.slice().sort(function (a, b) { return b.at - a.at; });
    panel.innerHTML = "";
    var sum = document.createElement("summary");
    sum.textContent = "Edit history on this page 本頁修改紀錄 (" + list.length + ")";
    panel.appendChild(sum);
    var ul = document.createElement("ul");
    list.forEach(function (e) {
      var li = document.createElement("li");
      var a = document.createElement("a"); a.href = "#"; a.textContent = "Go to paragraph 前往段落";
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var el = blocks().find(function (b) { return keyOf(b) === e.block; });
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("kb-flash"); setTimeout(function () { el.classList.remove("kb-flash"); }, 1600); }
      });
      var who = document.createElement("strong"); who.textContent = nameOf(e.by);
      li.append(who, document.createTextNode(" · " + fmt(e.at) + (e.note ? " · " + e.note : "") + " · "), a);
      var q = document.createElement("div"); q.className = "kb-log-diff";
      var o = document.createElement("del"); o.textContent = (e.original || "").slice(0, 160);
      var n = document.createElement("ins"); n.textContent = (e.text || "").slice(0, 160);
      q.append(o, document.createElement("br"), n);
      li.appendChild(q);
      ul.appendChild(li);
    });
    panel.appendChild(ul);
  }

  async function startEditing() {
    if (!window.claude || typeof window.claude.use !== "function") return;   // static site: no editing
    var db = await window.claude.use("db");
    if (!db) return;
    state.db = db;
    state.user = await window.claude.use("user");
    try { state.me = state.user ? await state.user.id() : null; } catch (e) { state.me = null; }
    try {
      var c = state.user && state.user.can ? await state.user.can("data.write") : null;
      state.canWrite = c !== false && !!state.me;
    } catch (e) { state.canWrite = !!state.me; }
    document.documentElement.classList.add("kb-can-edit");
    var timer = setTimeout(function () { render(); }, 10000);
    db.collection("edits").where("page", "==", PAGE).onSnapshot(async function (snap) {
      clearTimeout(timer);
      state.edits = snap.docs.map(function (d) { return d.data(); }).filter(function (e) { return e && e.block && typeof e.text === "string"; });
      await resolveNames();
      render();
    }, function () { clearTimeout(timer); render(); });
  }

  /* ---------- 3. Checklist ticks kept in this browser ---------- */
  function checklists() {
    var boxes = document.querySelectorAll("article .task-list-item input[type=checkbox]");
    if (!boxes.length) return;
    var key = "kb-check:" + PAGE, saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { saved = {}; }
    boxes.forEach(function (cb, i) {
      cb.disabled = false;
      if (saved[i]) cb.checked = true;
      cb.addEventListener("change", function () {
        saved[i] = cb.checked;
        try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* storage unavailable */ }
      });
    });
  }

  function init() { addBack(); checklists(); startEditing(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  // Material instant navigation
  if (window.document$ && window.document$.subscribe) window.document$.subscribe(function () { addBack(); });
})();
