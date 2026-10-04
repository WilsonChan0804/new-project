/* Search on every page: projects, tasks, issues, sheets, 3D views,
 * messages and file links, from one box (server: tasks.py /api/search).
 *
 * The magnifier in the header, Ctrl+K, or "/" (when not typing somewhere)
 * opens it. Arrow keys and Enter open a result. The last searches are kept
 * on this device.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BADGE = {
  project: ["P", "#4f46e5"], task: ["&#10003;", "#0e9f6e"], issue: ["#", "#e2453c"], sheet: ["2D", "#d1660e"],
  view3d: ["3D", "#7c3aed"], message: ["&#128172;", "#0ea5e9"], onedrive: ["OD", "#0a64d6"],
  sharepoint: ["SP", "#03787c"], acc: ["ACC", "#1e1e1e"], url: ["&#8599;", "#6b7480"],
};
const RECENT = "lwk-viewer:search-recent";
const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

const S = { el: null, seq: 0, timer: null, rows: [], at: -1, more: {} };

function headers() {
  const h = {};
  try { const t = localStorage.getItem("lwk-viewer:token"); if (t) h["X-Viewer-Token"] = t; } catch (e) {}
  return h;
}
function recent() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (e) { return []; } }
function remember(q) {
  try { localStorage.setItem(RECENT, JSON.stringify([q].concat(recent().filter((x) => x !== q)).slice(0, 8))); } catch (e) {}
}

function badge(kind) {
  const b = BADGE[kind] || BADGE.url;
  return `<span class="sr-b" style="background:${b[1]}">${b[0]}</span>`;
}

function open() {
  if (!S.el) build();
  S.el.hidden = false;
  document.body.classList.add("sr-on");
  const q = S.el.querySelector(".sr-q");
  q.focus();
  q.select();
  if (!q.value.trim()) paintRecent();
}
function close() {
  if (!S.el) return;
  S.el.hidden = true;
  document.body.classList.remove("sr-on");
}

function build() {
  const el = document.createElement("div");
  el.id = "lwk-search";
  el.hidden = true;
  el.innerHTML = `<div class="sr-box" role="dialog" aria-label="Search">
    <div class="sr-top">${ICON}<input class="sr-q" type="search" placeholder="Search tasks, issues, sheets, messages, files ..." autocomplete="off" spellcheck="false">
      <button type="button" class="sr-x" title="Close (Esc)">&#10005;</button></div>
    <div class="sr-res"></div>
    <div class="sr-foot">↑ ↓ to move · Enter to open · Esc to close · Ctrl+K or / opens this on any page</div></div>`;
  document.body.appendChild(el);
  S.el = el;
  const q = el.querySelector(".sr-q");
  q.addEventListener("input", () => {
    clearTimeout(S.timer);
    const v = q.value.trim();
    if (!v) { paintRecent(); return; }
    S.timer = setTimeout(() => run(v), 200);
  });
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!S.rows.length) return;
      S.at = ev.key === "ArrowDown" ? (S.at + 1) % S.rows.length : (S.at <= 0 ? S.rows.length - 1 : S.at - 1);
      mark();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const a = S.rows[S.at >= 0 ? S.at : 0];
      if (a) a.click();
    } else if (ev.key === "Escape") {
      close();
    }
  });
  el.addEventListener("click", (ev) => {
    if (ev.target === el || ev.target.closest(".sr-x")) return close();
    const r = ev.target.closest("[data-recent]");
    if (r) { q.value = r.dataset.recent; run(q.value); return; }
    const m = ev.target.closest("[data-more]");
    if (m) { S.more[m.dataset.more] = true; run(q.value.trim()); return; }
    const a = ev.target.closest("a.sr-row");
    if (a) { remember(q.value.trim()); if (!a.target) close(); }
  });
}

function paintRecent() {
  const r = recent();
  S.rows = []; S.at = -1;
  S.el.querySelector(".sr-res").innerHTML = r.length
    ? `<div class="sr-h">Recent searches</div>` + r.map((x) => `<button type="button" class="sr-rec" data-recent="${esc(x)}">${ICON} ${esc(x)}</button>`).join("")
    : `<p class="sr-none">Type a word or two: a task, an issue number (#12), a sheet (A-101), a person, a file ...</p>`;
}

async function run(q) {
  if (q.replace(/\s/g, "").length < 2) return;
  const seq = ++S.seq;
  const box = S.el.querySelector(".sr-res");
  if (!box.querySelector(".sr-row")) box.innerHTML = `<p class="sr-none">Searching ...</p>`;
  let d;
  try {
    const big = Object.keys(S.more).length ? 30 : 8;
    const res = await fetch("/api/search?q=" + encodeURIComponent(q) + "&limit=" + big, { headers: headers() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    d = await res.json();
  } catch (e) {
    if (seq === S.seq) box.innerHTML = `<p class="sr-none">Could not search: ${esc(e.message)}</p>`;
    return;
  }
  if (seq !== S.seq) return;                       // an older answer
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hi = (t) => {
    let h = esc(t);
    for (const w of words) {
      const e = esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (e) h = h.replace(new RegExp("(" + e + ")", "ig"), "<mark>$1</mark>");
    }
    return h;
  };
  box.innerHTML = d.groups.length ? d.groups.map((g) => `<div class="sr-h">${esc(g.title)}</div>`
    + g.rows.map((r) => `<a class="sr-row${r.done ? " done" : ""}" href="${esc(r.url)}"${r.external ? ` target="_blank" rel="noopener"` : ""}>`
      + badge(r.kind) + `<span class="sr-m"><b>${hi(r.title)}</b><small>${hi(r.sub || "")}</small></span>`
      + (r.status ? `<span class="sr-st st-${esc(String(r.status).toLowerCase().replace(/\s+/g, "-"))}">${esc(r.status)}</span>` : "")
      + `</a>`).join("")
    + (g.more ? `<button type="button" class="sr-more" data-more="${esc(g.key)}">${g.more} more ${esc(g.title.toLowerCase())}</button>` : "")).join("")
    : `<p class="sr-none">Nothing found for "${esc(q)}".</p>`;
  S.rows = [...box.querySelectorAll("a.sr-row")];
  S.at = S.rows.length ? 0 : -1;
  mark();
}

function mark() {
  S.rows.forEach((r, i) => r.classList.toggle("on", i === S.at));
  if (S.rows[S.at]) S.rows[S.at].scrollIntoView({ block: "nearest" });
}

/* The button in the header, once the header is there (the sheets and 3D
   pages make theirs after signing in), and the keys. */
export function installSearch() {
  if (window.__lwkSearch) return;
  window.__lwkSearch = true;
  let tries = 0;
  const place = () => {
    if (document.getElementById("lwk-search-btn")) return true;
    const nav = document.getElementById("lwk-nav");
    if (!nav) return false;
    const b = document.createElement("a");
    b.href = "#";
    b.id = "lwk-search-btn";
    b.title = "Search everything (Ctrl+K)";
    b.innerHTML = ICON + `<span class="lab">Search</span>`;
    b.onclick = (ev) => { ev.preventDefault(); open(); };
    nav.insertBefore(b, nav.firstChild);
    return true;
  };
  const tick = () => { if (!place() && ++tries < 120) setTimeout(tick, 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
  document.addEventListener("keydown", (ev) => {
    const typing = ev.target.closest && ev.target.closest("input, textarea, select, [contenteditable=true]");
    if ((ev.key === "k" || ev.key === "K") && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); open(); return; }
    if (ev.key === "/" && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); open(); }
  });
  css();
}

function css() {
  if (document.getElementById("sr-css")) return;
  const st = document.createElement("style");
  st.id = "sr-css";
  st.textContent = `
#lwk-search-btn { display: inline-flex; align-items: center; gap: 4px; }
#lwk-search { position: fixed; inset: 0; z-index: 400; background: rgba(20, 26, 36, .35); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
#lwk-search[hidden] { display: none; }
.sr-box { width: min(720px, 94vw); max-height: 78vh; display: flex; flex-direction: column; background: var(--panel, #fff); color: var(--ink, #1f2430);
  border-radius: 12px; box-shadow: 0 20px 60px rgba(20, 26, 36, .3); overflow: hidden; font-size: 14px; }
.sr-top { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line, #e2e6ec); color: var(--muted, #6b7480); }
.sr-q { flex: 1; border: 0 !important; outline: none; font-size: 17px; padding: 6px 2px; background: transparent; color: var(--ink, #1f2430); box-shadow: none !important; }
.sr-x { border: 0; background: none; font-size: 16px; color: var(--muted, #6b7480); cursor: pointer; padding: 4px 8px; }
.sr-res { overflow-y: auto; padding: 4px 6px 8px; }
.sr-h { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--muted, #6b7480); margin: 10px 8px 4px; }
.sr-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; text-decoration: none; color: var(--ink, #1f2430); }
.sr-row.on, .sr-row:hover { background: var(--accent-soft, #fff1e5); }
.sr-row.done b { text-decoration: line-through; color: var(--muted, #6b7480); }
.sr-b { flex: none; min-width: 26px; height: 22px; padding: 0 4px; border-radius: 5px; color: #fff; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.sr-m { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sr-m b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-m small { font-size: 11.5px; color: var(--muted, #6b7480); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-m mark { background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px; }
.sr-st { flex: none; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #fde2e1; color: #b42318; }
.sr-st.st-in-progress { background: #fdeccb; color: #93590b; }
.sr-st.st-resolved, .sr-st.st-closed { background: #e7f7f0; color: #0b7a55; }
.sr-more { margin: 2px 8px 4px 44px; border: 0; background: none; color: var(--accent-deep, #d1660e); font-size: 12px; cursor: pointer; padding: 2px 0; }
.sr-rec { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: none; padding: 7px 10px; border-radius: 8px; cursor: pointer; color: var(--ink, #1f2430); font-size: 14px; }
.sr-rec:hover { background: var(--accent-soft, #fff1e5); }
.sr-none { color: var(--muted, #6b7480); padding: 14px 10px; margin: 0; }
.sr-foot { border-top: 1px solid var(--line, #e2e6ec); padding: 6px 14px; font-size: 11px; color: var(--muted, #6b7480); }
@media (max-width: 700px) {
  #lwk-search { padding-top: 0; }
  .sr-box { width: 100vw; max-height: 100vh; height: 100%; border-radius: 0; }
  .sr-q { font-size: 16px; }
  .sr-foot { display: none; }
  #lwk-search-btn .lab { display: none; }
}
`;
  document.head.appendChild(st);
}
