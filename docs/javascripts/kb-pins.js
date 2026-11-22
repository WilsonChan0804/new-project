/* Pins and history 釘選及瀏覽記錄
 *
 * - Pin a whole document (button by the page title), a section (by each h2/h3)
 *   or a single clause (each row of the clause tables).
 * - Every page you open is recorded; the panel shows Recent and Most used.
 * - Kept in this browser only (localStorage), per viewer. Nothing is sent anywhere.
 */
(function () {
  "use strict";
  var KEY = "kb-pins-v1", HKEY = "kb-history-v1", MAXH = 200;
  var CLAUSE_SECTIONS = ["clause-by-clause", "key-clauses-table", "regulation-by-regulation"];

  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // Site root, so stored paths work under both directory and .html URLs.
  function root() {
    try {
      var c = JSON.parse(document.getElementById("__config").textContent);
      return new URL(c.base + "/", location.href);
    } catch (e) { return new URL("./", location.href); }
  }
  function relPath() {
    var r = root().pathname, p = location.pathname;
    return p.indexOf(r) === 0 ? p.slice(r.length) : p;
  }
  function href(rel, anchor) { return new URL(rel, root()).href + (anchor ? "#" + anchor : ""); }
  function pageTitle() {
    var h = document.querySelector(".md-content h1");
    if (!h) return document.title;
    var c = h.cloneNode(true);
    c.querySelectorAll(".kb-pin, .headerlink").forEach(function (x) { x.remove(); });
    return c.textContent.replace(/\s+/g, " ").trim();
  }
  function textOf(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll(".kb-pin, .headerlink, .kb-pen, .kb-ui").forEach(function (x) { x.remove(); });
    return c.textContent.replace(/\s+/g, " ").trim();
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }

  var pins = load(KEY, []);
  function idOf(rel, anchor) { return rel + "#" + (anchor || ""); }
  function isPinned(id) { return pins.some(function (p) { return p.id === id; }); }
  function toggle(item) {
    if (isPinned(item.id)) pins = pins.filter(function (p) { return p.id !== item.id; });
    else pins.unshift(item);
    save(KEY, pins); refreshButtons(); renderPanel();
  }

  function pinButton(item, cls) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "kb-pin " + (cls || ""); b.dataset.pinId = item.id;
    b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); toggle(item); });
    paint(b);
    return b;
  }
  function paint(b) {
    var on = isPinned(b.dataset.pinId);
    b.classList.toggle("on", on);
    b.textContent = on ? "📌" : "📍";
    b.title = on ? "Unpin 取消釘選" : "Pin 釘選";
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function refreshButtons() { document.querySelectorAll(".kb-pin").forEach(paint); }

  function decorate() {
    var art = document.querySelector(".md-content article");
    if (!art) return;
    var rel = relPath(), title = pageTitle();
    var h1 = art.querySelector("h1");
    if (h1 && !h1.querySelector(".kb-pin"))
      h1.appendChild(pinButton({ id: idOf(rel, ""), type: "doc", rel: rel, anchor: "", label: title, page: title }, "kb-pin-doc"));
    art.querySelectorAll("h2[id], h3[id]").forEach(function (h) {
      if (h.querySelector(".kb-pin")) return;
      h.appendChild(pinButton({ id: idOf(rel, h.id), type: "section", rel: rel, anchor: h.id, label: textOf(h), page: title }));
    });
    // clause rows: tables that follow a clause-table heading
    CLAUSE_SECTIONS.forEach(function (sid) {
      var h = document.getElementById(sid);
      if (!h) return;
      var el = h.nextElementSibling, used = {};
      while (el && !/^H[12]$/.test(el.tagName)) {
        el.querySelectorAll("tbody tr").forEach(function (tr) {
          var c = tr.cells[0];
          if (!c || c.querySelector(".kb-pin")) return;
          var lab = textOf(c), base = "cl-" + (slug(lab) || "row"), id = base, n = 2;
          while (used[id] || (document.getElementById(id) && document.getElementById(id) !== tr)) id = base + "-" + n++;
          used[id] = 1; tr.id = id;
          var desc = tr.cells[1] ? textOf(tr.cells[1]).slice(0, 90) : "";
          c.appendChild(pinButton({ id: idOf(rel, id), type: "clause", rel: rel, anchor: id, label: lab + (desc ? " — " + desc : ""), page: title }, "kb-pin-row"));
        });
        el = el.nextElementSibling;
      }
    });
    // arriving on a clause link: ids are set by this script, so scroll now
    if (location.hash) {
      var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t && t.tagName === "TR") { t.scrollIntoView({ block: "center" }); t.classList.add("kb-flash"); setTimeout(function () { t.classList.remove("kb-flash"); }, 1800); }
    }
  }

  function record() {
    var rel = relPath();
    if (!document.querySelector(".md-content h1")) return;
    var h = load(HKEY, []), now = Date.now(), e = h.find(function (x) { return x.rel === rel; });
    if (e) { if (now - e.at > 3000) e.n = (e.n || 1) + 1; e.at = now; e.title = pageTitle(); }
    else h.push({ rel: rel, title: pageTitle(), at: now, n: 1 });
    h.sort(function (a, b) { return b.at - a.at; });
    save(HKEY, h.slice(0, MAXH));
  }

  // ---- panel ----
  var panel, tab = "pins";
  function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }
  function ago(t) {
    var s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " d";
  }
  function row(text, sub, url, onRemove) {
    var li = el("li"), a = el("a", null, text); a.href = url;
    a.addEventListener("click", function () { panel.hidden = true; });
    li.appendChild(a);
    if (sub) li.appendChild(el("small", null, sub));
    if (onRemove) {
      var x = el("button", "kb-x", "✕"); x.type = "button"; x.title = "Remove 移除";
      x.addEventListener("click", onRemove); li.appendChild(x);
    }
    return li;
  }
  function renderPanel() {
    if (!panel || panel.hidden) return;
    var body = panel.querySelector(".kb-pp-body"); body.innerHTML = "";
    panel.querySelectorAll(".kb-pp-tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === tab); });
    if (tab === "pins") {
      if (!pins.length) { body.appendChild(el("p", "kb-pp-empty", "No pins yet. Click 📍 beside a title, heading or clause. 未有釘選：按標題、章節或條文旁的 📍。")); return; }
      [["doc", "Documents 文件"], ["section", "Sections 章節"], ["clause", "Clauses 條文"]].forEach(function (g) {
        var items = pins.filter(function (p) { return p.type === g[0]; });
        if (!items.length) return;
        body.appendChild(el("h4", null, g[1] + " (" + items.length + ")"));
        var ul = el("ul");
        items.forEach(function (p) {
          ul.appendChild(row(p.label, g[0] === "doc" ? "" : p.page, href(p.rel, p.anchor), function () { toggle(p); }));
        });
        body.appendChild(ul);
      });
      var clr = el("button", "kb-pp-clear", "Clear all pins 清除所有釘選"); clr.type = "button";
      clr.addEventListener("click", function () { if (confirm("Clear all pins? 清除所有釘選？")) { pins = []; save(KEY, pins); refreshButtons(); renderPanel(); } });
      body.appendChild(clr);
    } else {
      var h = load(HKEY, []);
      if (!h.length) { body.appendChild(el("p", "kb-pp-empty", "No history yet. 未有記錄。")); return; }
      var list = tab === "recent" ? h.slice(0, 30) : h.slice().sort(function (a, b) { return (b.n || 1) - (a.n || 1) || b.at - a.at; }).slice(0, 20);
      var ul = el("ul");
      list.forEach(function (e) {
        ul.appendChild(row(e.title, tab === "recent" ? ago(e.at) + " ago" : (e.n || 1) + " visits 次", href(e.rel), function () {
          save(HKEY, load(HKEY, []).filter(function (x) { return x.rel !== e.rel; })); renderPanel();
        }));
      });
      body.appendChild(ul);
      var c2 = el("button", "kb-pp-clear", "Clear history 清除記錄"); c2.type = "button";
      c2.addEventListener("click", function () { if (confirm("Clear history? 清除瀏覽記錄？")) { save(HKEY, []); renderPanel(); } });
      body.appendChild(c2);
    }
  }
  function buildPanel() {
    if (document.querySelector(".kb-pp-fab")) return;
    var fab = el("button", "kb-pp-fab", "📌"); fab.type = "button"; fab.title = "My pins & history 我的釘選及記錄";
    panel = el("div", "kb-pp"); panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "My pins and history");
    var head = el("div", "kb-pp-head"); head.appendChild(el("strong", null, "My pins 我的釘選"));
    var close = el("button", "kb-x", "✕"); close.type = "button"; close.title = "Close 關閉";
    close.addEventListener("click", function () { panel.hidden = true; }); head.appendChild(close);
    var tabs = el("div", "kb-pp-tabs");
    [["pins", "📌 Pinned 釘選"], ["recent", "🕘 Recent 最近"], ["top", "⭐ Most used 常用"]].forEach(function (t) {
      var b = el("button", null, t[1]); b.type = "button"; b.dataset.t = t[0];
      b.addEventListener("click", function () { tab = t[0]; renderPanel(); }); tabs.appendChild(b);
    });
    panel.appendChild(head); panel.appendChild(tabs); panel.appendChild(el("div", "kb-pp-body"));
    panel.appendChild(el("p", "kb-pp-note", "Saved in this browser only. 只儲存在此瀏覽器。"));
    fab.addEventListener("click", function () { panel.hidden = !panel.hidden; renderPanel(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") panel.hidden = true; });
    var hdr = document.querySelector(".md-header__inner"), srch = hdr && hdr.querySelector(".md-search");
    if (hdr) { fab.classList.add("kb-pp-hdr"); hdr.insertBefore(fab, srch || null); } else document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  function init() { pins = load(KEY, []); buildPanel(); decorate(); record(); renderPanel(); }
  if (window.document$ && window.document$.subscribe) window.document$.subscribe(init);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("storage", function (e) { if (e.key === KEY) { pins = load(KEY, []); refreshButtons(); renderPanel(); } });
})();
