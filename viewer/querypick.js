/* "+ Query" on a sheet or in 3D: which query the picture goes to.
 *
 * A small menu under the button: a new query (just its subject), or one of
 * the project's open queries - the one used last on top, so a query made of
 * several sheet and 3D views takes one click per view. After adding, either
 * stay here to capture the next view, or open the query in Tasks (the
 * choice is remembered). The picture is taken when the query is chosen,
 * with the menu already closed.
 */

import { api } from "./nav.js";

const AFTER_KEY = "lwk-viewer:qpick-after";        // "stay" | "open"
const LAST_KEY = "lwk-viewer:qpick-last:";         // + reg: the query used last (this tab)
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newQid = () => "q" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 19);
const ss = { get: (k) => { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const queryUrl = (reg, id) => `tasks.html?mode=queries&reg=${encodeURIComponent(reg)}&q=${encodeURIComponent(id)}`;

let OPEN = null;

function close() {
  if (OPEN) { OPEN.remove(); OPEN = null; }
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", onKey, true);
}
function outside(ev) { if (OPEN && !OPEN.contains(ev.target) && !ev.target.closest("#lwk-send-query")) close(); }
function onKey(ev) { if (ev.key === "Escape") close(); }

export function toast(html, ms) {
  const t = document.createElement("div");
  t.className = "qp-toast";
  t.innerHTML = html;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 6000);
  return t;
}

/* btn: the + Query link; project: the viewer project; cap(): the view now;
   fallback(): the old way (hand the view to Tasks) when no list can load. */
export async function pickQuery(btn, project, cap, fallback) {
  if (OPEN) { close(); return; }
  // the menu shows at once; the queries fill it when they come
  const el = document.createElement("div");
  el.className = "qp";
  // in 3D's ⋯ menu: that menu closes, and this one comes under its button
  const menu = btn.closest(".v3-menu");
  if (menu) menu.hidden = true;
  const anchor = menu && document.getElementById("v3-more-btn") || btn;
  const r = anchor.getBoundingClientRect();
  el.style.top = Math.round(r.bottom + 6) + "px";
  el.style.maxHeight = Math.max(240, Math.round(window.innerHeight - r.bottom - 18)) + "px";
  el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 348, r.right - 340))) + "px";
  el.innerHTML = `<div class="qp-h">Add this view to a query</div><p class="qp-none">Loading the project's queries ...</p>`;
  document.body.appendChild(el);
  OPEN = el;
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  let reg = "", rows = [];
  try {
    const ps = (await api("/api/queries/projects")).projects || [];
    const hit = ps.find((p) => (p.viewers || []).includes(project));
    reg = hit ? hit.id : "";
    if (!reg) { close(); fallback(); return; }
    rows = ((await api("/api/queries?reg=" + encodeURIComponent(reg))).queries || [])
      .filter((q) => q.status !== "Closed" && !q.deleted).sort((a, b) => b.number - a.number);
  } catch (e) { close(); fallback(); return; }
  if (OPEN !== el) return;                          // closed meanwhile
  const last = rows.find((q) => q.id === ss.get(LAST_KEY + reg));
  let after = ls.get(AFTER_KEY) === "open" ? "open" : "stay";
  const rowHtml = (q) => `<button type="button" class="qp-row" data-q="${esc(q.id)}"><b>${esc(q.code)}</b> <span>${esc(q.title || "Untitled query")}</span>`
    + `<small>${esc(q.status)}${(q.views || []).length ? " · " + q.views.length + " picture" + (q.views.length > 1 ? "s" : "") : ""}</small></button>`;
  el.innerHTML = `<div class="qp-h">Add this view to a query</div>`
    + `<div class="qp-after">After adding: <button type="button" data-after="stay">Stay here</button><button type="button" data-after="open">Open the query</button></div>`
    + (last ? `<button type="button" class="qp-row qp-last" data-q="${esc(last.id)}">&#10133; Add another to <b>${esc(last.code)}</b> <span>${esc(last.title || "")}</span></button>` : "")
    + `<form class="qp-new"><input name="title" placeholder="New query - its subject" maxlength="200" autocomplete="off"><button class="primary">Create</button></form>`
    + (rows.length ? `<input class="qp-q" type="search" placeholder="Find an open query" autocomplete="off"><div class="qp-list">${rows.map(rowHtml).join("")}</div>`
      : `<p class="qp-none">No open query on this project yet.</p>`);
  const paintAfter = () => { for (const b of el.querySelectorAll("[data-after]")) b.classList.toggle("on", b.dataset.after === after); };
  paintAfter();
  for (const b of el.querySelectorAll("[data-after]")) b.onclick = () => { after = b.dataset.after; ls.set(AFTER_KEY, after); paintAfter(); };
  const q = el.querySelector(".qp-q");
  if (q) q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    for (const b of el.querySelectorAll(".qp-list .qp-row")) b.hidden = !!s && !b.textContent.toLowerCase().includes(s);
  };
  (last ? el.querySelector(".qp-last") : el.querySelector(".qp-new input")).focus();

  const go = async (target) => {
    // a tab opened now, while the click is fresh: one opened after waiting is blocked
    const win = after === "open" ? window.open("", "_blank") : null;
    close();
    const was = btn.textContent;
    btn.textContent = "Capturing ...";
    try {
      const v = await cap();
      let id = target.id, code = "", n = 1;
      if (target.title != null) {
        id = newQid();
        const due = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
        const r = await api("/api/queries", { method: "POST", body: JSON.stringify({ reg, queries: [{ id, title: target.title, due, views: [v] }] }) });
        code = r.queries[0].code;
      } else {
        const cur = await api("/api/queries/" + encodeURIComponent(id));      // as it is now: others may have added
        const views = (cur.views || []).concat([v]);
        const r = await api("/api/queries", { method: "POST", body: JSON.stringify({ reg, queries: [{ id, views }] }) });
        code = r.queries[0].code; n = views.length;
      }
      ss.set(LAST_KEY + reg, id);
      const url = queryUrl(reg, id);
      if (win) win.location.href = url;
      else toast(`Added to <b>${esc(code)}</b> (${n} picture${n > 1 ? "s" : ""}). Move to the next view and click <b>+ Query</b> again. <a href="${esc(url)}" target="_blank" rel="noopener">Open the query</a>`);
    } catch (e) {
      if (win) win.close();
      alert("Could not add the view: " + e.message);
    } finally { btn.textContent = was; }
  };
  for (const b of el.querySelectorAll("[data-q]")) b.onclick = () => go({ id: b.dataset.q });
  el.querySelector(".qp-new").onsubmit = (ev) => {
    ev.preventDefault();
    const t = ev.target.title.value.trim();
    if (!t) { ev.target.title.focus(); return; }
    go({ title: t });
  };
}

(function css() {
  if (document.getElementById("qp-css")) return;
  const st = document.createElement("style");
  st.id = "qp-css";
  st.textContent = `
.qp { position: fixed; z-index: 3000; width: 340px; max-height: 70vh; display: flex; flex-direction: column; gap: 6px; padding: 10px;
  background: var(--panel, #fff); color: var(--ink, #222); border: 1px solid var(--line, #ddd); border-top: 3px solid #0284c7; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.18); font-size: 13px; }
.qp-h { font-weight: 700; color: #0284c7; }
.qp-new { display: flex; gap: 6px; }
.qp-new input, .qp-q { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--line, #ccc); border-radius: 6px; background: var(--bg, #fff); color: inherit; font: inherit; }
.qp-list { overflow: auto; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.qp-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; text-align: left; width: 100%; padding: 6px 8px; border: 1px solid transparent; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
.qp-row:hover, .qp-row:focus { border-color: #0284c7; background: rgba(2,132,199,.08); }
.qp-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qp-row small { color: var(--muted, #777); width: 100%; }
.qp-last { border-color: #0284c7; background: rgba(2,132,199,.1); }
.qp-none { margin: 0; color: var(--muted, #777); }
.qp-after { display: flex; gap: 4px; align-items: center; color: var(--muted, #777); font-size: 12px; }
.qp-after button { padding: 2px 8px; border: 1px solid var(--line, #ccc); border-radius: 12px; background: none; color: inherit; font: inherit; cursor: pointer; }
.qp-after button.on { background: #0284c7; border-color: #0284c7; color: #fff; }
.qp-toast { position: fixed; z-index: 3001; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: min(560px, calc(100vw - 32px)); padding: 10px 14px; border-radius: 8px;
  background: #0c4a6e; color: #fff; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.qp-toast a { color: #7dd3fc; font-weight: 700; margin-left: 6px; }
`;
  document.head.appendChild(st);
})();
