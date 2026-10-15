/* Help: the user manual inside the viewer, searchable, on every page.
 *
 * The content is the manual itself (docs/manual, English and Cantonese),
 * written to help-content.js by build_manual.py - so each update of the
 * manual updates the Help. It is loaded only when the Help is opened.
 * Opens with the ? button in the header, Help in the profile menu, or F1,
 * at the section for the page (or the topic asked, e.g. SBD's how-to). */

const LANG = "lwk-viewer:help-lang";
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.1"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/></svg>`;

// the page (or topic) -> the English heading it opens at
const PAGE = {
  "": "Sheets (2D)", "index.html": "Sheets (2D)", "model.html": "3D: moving around", "projects.html": "Projects",
  "dashboard.html": "Dashboard and projects", "tasks.html": "Tasks", "board.html": "Board", "messenger.html": "Messenger",
  "calendar.html": "Calendar", "folders.html": "Folders", "admin.html": "For admins", "report.html": "Issues and BCF",
};
const TOPIC = { sbd: "SBD: how to prepare the model and send it", clash: "Clash and headroom checks", search: "Search", shortcuts: "Shortcuts cheat sheet" };

let DATA = null;
const S = { lang: "en", id: "", q: "" };

async function data() {
  if (!DATA) DATA = (await import("./help-content.js")).HELP;
  return DATA;
}

function lang() {
  try { const l = localStorage.getItem(LANG); if (l) return l; } catch (e) {}
  return /^zh/i.test(navigator.language || "") ? "yue" : "en";
}

function idFor(title) {
  const en = (DATA && DATA.en) || [];
  const s = en.find((x) => x.h === title) || en.find((x) => x.h.startsWith(title));
  return s ? s.id : (en[0] || {}).id;
}

const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/* Every word of the query must be in the section (heading or text); the
   heading's matches count most. Cantonese has no spaces: a word is also
   matched as a run of characters. */
export function searchHelp(list, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const s of list) {
    const h = (s.ch + " " + s.h).toLowerCase();
    const t = (s._t || (s._t = text(s.html))).toLowerCase();
    let score = 0, ok = true;
    for (const w of words) {
      const inH = h.includes(w), inT = t.includes(w);
      if (!inH && !inT) { ok = false; break; }
      score += (inH ? 10 : 0) + (inT ? 1 + Math.min(4, t.split(w).length - 2) : 0);
    }
    if (ok) out.push({ s, score });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.s);
}

function snippet(s, q) {
  const t = s._t || (s._t = text(s.html));
  const w = q.toLowerCase().split(/\s+/).filter(Boolean);
  const i = Math.max(0, ...w.map((x) => t.toLowerCase().indexOf(x)).filter((n) => n >= 0).slice(0, 1));
  let part = (i > 60 ? "... " : "") + t.slice(Math.max(0, i - 60), i + 160) + (t.length > i + 160 ? " ..." : "");
  part = esc(part);
  for (const x of w) part = part.replace(new RegExp("(" + x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
  return part;
}

function css() {
  if (document.getElementById("hp-css")) return;
  const s = document.createElement("style");
  s.id = "hp-css";
  s.textContent = `
#lwk-help { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1600; width: 480px; max-width: 100vw; display: flex; flex-direction: column;
  background: var(--panel, #fff); color: var(--ink, #1f2430); border-left: 1px solid var(--line, #e2e6ec); box-shadow: -12px 0 34px rgba(20, 26, 36, .18); font-size: 13px; }
#lwk-help .hp-top { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line, #e2e6ec); border-top: 4px solid var(--accent, #f28022); }
#lwk-help .hp-top b { font-size: 15px; margin-right: auto; }
#lwk-help .hp-lang button { border: 1px solid var(--line, #e2e6ec); background: none; color: inherit; padding: 2px 8px; cursor: pointer; font-size: 12px; }
#lwk-help .hp-lang button:first-child { border-radius: 6px 0 0 6px; } #lwk-help .hp-lang button:last-child { border-radius: 0 6px 6px 0; border-left: 0; }
#lwk-help .hp-lang button.on { background: var(--accent, #f28022); color: #fff; border-color: var(--accent, #f28022); }
#lwk-help .hp-x { border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--muted, #6b7480); }
#lwk-help .hp-q { margin: 10px 12px 4px; width: calc(100% - 24px); box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--line, #e2e6ec); border-radius: 8px; font-size: 14px; background: var(--bg, #fff); color: inherit; }
#lwk-help .hp-body { flex: 1; overflow: auto; padding: 4px 16px 16px; line-height: 1.5; }
#lwk-help .hp-crumb { color: var(--muted, #6b7480); font-size: 11px; margin-top: 8px; }
#lwk-help h2 { font-size: 17px; margin: 2px 0 8px; }
#lwk-help table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12px; }
#lwk-help td, #lwk-help th { border: 1px solid var(--line, #e2e6ec); padding: 3px 6px; text-align: left; vertical-align: top; }
#lwk-help ul, #lwk-help ol { padding-left: 20px; } #lwk-help li { margin: 3px 0; }
#lwk-help .hp-r { display: block; padding: 8px 6px; border-bottom: 1px solid var(--line-soft, #eef0f3); cursor: pointer; text-decoration: none; color: inherit; }
#lwk-help .hp-r:hover { background: var(--hover, rgba(242, 128, 34, .08)); }
#lwk-help .hp-r small { display: block; color: var(--muted, #6b7480); }
#lwk-help .hp-r span { display: block; font-size: 12px; margin-top: 2px; }
#lwk-help mark { background: #fde68a; color: inherit; padding: 0 1px; }
#lwk-help .hp-toc a { display: block; padding: 3px 0; color: inherit; text-decoration: none; cursor: pointer; }
#lwk-help .hp-toc a.l3 { padding-left: 14px; color: var(--muted, #6b7480); font-size: 12px; }
#lwk-help .hp-toc a:hover { color: var(--accent, #f28022); }
#lwk-help .hp-nav { display: flex; gap: 6px; justify-content: space-between; margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--line-soft, #eef0f3); }
#lwk-help .hp-foot { padding: 8px 12px; border-top: 1px solid var(--line, #e2e6ec); font-size: 12px; display: flex; gap: 12px; }
#lwk-help .hp-foot a { color: var(--accent, #f28022); cursor: pointer; }
@media (max-width: 600px) { #lwk-help { width: 100vw; } }`;
  document.head.appendChild(s);
}

const L = {
  en: { title: "Help", search: "Search the help ...", none: "Nothing found. Try other words.", toc: "Contents", prev: "‹ Previous", next: "Next ›",
    news: "What's new", all: "Contents", found: (n) => `${n} section(s)` },
  yue: { title: "說明", search: "搜尋說明 ...", none: "搵唔到。試下其他字。", toc: "目錄", prev: "‹ 上一節", next: "下一節 ›",
    news: "最新功能", all: "目錄", found: (n) => `${n} 節` },
};

function paint(el) {
  const list = DATA[S.lang] || DATA.en;
  const t = L[S.lang] || L.en;
  el.querySelectorAll(".hp-lang button").forEach((b) => b.classList.toggle("on", b.dataset.l === S.lang));
  el.querySelector(".hp-q").placeholder = t.search;
  el.querySelector(".hp-top b").textContent = t.title;
  el.querySelector("[data-hp=toc]").textContent = t.all;
  el.querySelector("[data-hp=news]").textContent = t.news;
  const body = el.querySelector(".hp-body");
  if (S.q.trim()) {
    const hits = searchHelp(list, S.q);
    body.innerHTML = `<div class="hp-crumb">${esc(t.found(hits.length))}</div>` + (hits.length
      ? hits.slice(0, 40).map((s) => `<a class="hp-r" data-id="${s.id}"><small>${esc(s.ch)}</small><b>${esc(s.h)}</b><span>${snippet(s, S.q)}</span></a>`).join("")
      : `<p class="muted">${esc(t.none)}</p>`);
    return;
  }
  if (!S.id) {
    body.innerHTML = `<h2>${esc(t.toc)}</h2><div class="hp-toc">` + list.map((s) => `<a class="l${s.lv}" data-id="${s.id}">${esc(s.h)}</a>`).join("") + `</div>`;
    return;
  }
  const i = Math.max(0, list.findIndex((x) => x.id === S.id));
  const s = list[i];
  // a chapter shows its own text, then its sections' headings to go on
  const subs = s.lv === 2 ? list.slice(i + 1).filter((x, k, a) => x.lv === 3 && a.slice(0, k).every((y) => y.lv === 3)) : [];
  body.innerHTML = `<div class="hp-crumb">${esc(s.ch)}</div><h2>${esc(s.h)}</h2>${s.html}`
    + (subs.length ? `<div class="hp-toc">${subs.map((x) => `<a class="l3" data-id="${x.id}">${esc(x.h)}</a>`).join("")}</div>` : "")
    + `<div class="hp-nav">${i > 0 ? `<button class="ghost" data-id="${list[i - 1].id}">${esc(t.prev)}</button>` : "<span></span>"}`
    + `${i < list.length - 1 ? `<button class="ghost" data-id="${list[i + 1].id}">${esc(t.next)}</button>` : ""}</div>`;
  body.scrollTop = 0;
}

/* Open the Help: at a topic ("sbd" ...), a search, or the page's section. */
export async function openHelp(opt) {
  opt = opt || {};
  css();
  await data();
  S.lang = lang();
  const page = (location.pathname.split("/").pop() || "").toLowerCase();
  S.id = idFor(TOPIC[opt.topic] || PAGE[page] || "Quick start");
  S.q = opt.q || "";
  let el = document.getElementById("lwk-help");
  if (!el) {
    el = document.createElement("div");
    el.id = "lwk-help";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Help");
    el.innerHTML = `<div class="hp-top"><b>Help</b><span class="hp-lang"><button data-l="en" title="English">EN</button><button data-l="yue" title="廣東話">粵</button></span>`
      + `<button class="hp-x" title="Close (Esc)">&#10005;</button></div><input class="hp-q" type="search" aria-label="Search the help">`
      + `<div class="hp-body"></div><div class="hp-foot"><a data-hp="toc">Contents</a><a data-hp="news">What's new</a></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-id],[data-l],[data-hp],.hp-x");
      if (!a) return;
      if (a.classList.contains("hp-x")) { el.remove(); return; }
      if (a.dataset.l) { S.lang = a.dataset.l; try { localStorage.setItem(LANG, S.lang); } catch (e) {} }
      if (a.dataset.id) { S.id = a.dataset.id; S.q = ""; el.querySelector(".hp-q").value = ""; }
      if (a.dataset.hp === "toc") { S.id = ""; S.q = ""; el.querySelector(".hp-q").value = ""; }
      if (a.dataset.hp === "news") { import("./whatsnew.js").then((w) => w.showWhatsNew()); return; }
      paint(el);
    });
    el.querySelector(".hp-q").addEventListener("input", (ev) => { S.q = ev.target.value; paint(el); });
    const esc_ = (ev) => {
      if (!document.body.contains(el)) { document.removeEventListener("keydown", esc_, true); return; }
      if (ev.key === "Escape") { ev.stopPropagation(); el.remove(); document.removeEventListener("keydown", esc_, true); }
    };
    document.addEventListener("keydown", esc_, true);
  }
  el.querySelector(".hp-q").value = S.q;
  paint(el);
  if (S.q) el.querySelector(".hp-q").focus();
}

/* The ? button beside the search in the header, and F1, on every page. */
export function installHelp() {
  let tries = 0;
  const place = () => {
    if (document.getElementById("lwk-help-btn")) return true;
    const nav = document.getElementById("lwk-nav");
    const after = document.getElementById("lwk-search-btn");
    if (!nav || !after) return false;
    const b = document.createElement("a");
    b.href = "#";
    b.id = "lwk-help-btn";
    b.title = "Help - how to use the viewer, searchable (F1)";
    b.setAttribute("aria-label", "Help");
    b.innerHTML = ICON;
    b.onclick = (ev) => { ev.preventDefault(); if (document.getElementById("lwk-help")) document.getElementById("lwk-help").remove(); else openHelp(); };
    after.after(b);
    return true;
  };
  const tick = () => { if (!place() && ++tries < 120) setTimeout(tick, 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  addEventListener("keydown", (ev) => {
    if (ev.key === "F1") { ev.preventDefault(); openHelp(); }
  });
}
