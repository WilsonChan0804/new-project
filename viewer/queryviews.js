/* Queries on the drawings and in the model (Sheets: app.js, 3D: model.js).
 *
 * Every picture of a query taken on a sheet or in 3D is a marker there:
 * a badge where it was pinned (and on a sheet, the area it showed). The
 * markers come from the queries themselves (/api/query-views), so a deleted
 * query takes its markers with it; deleting a marker removes that picture
 * from its query and leaves the query.
 */

import { api } from "./nav.js";

export const COLOR = { Open: "#f28022", Answered: "#0284c7", Closed: "#0e9f6e", over: "#e2453c" };
const HIDE_KEY = "lwk-viewer:query-markers-hidden";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const Q = { project: "", views: [], timer: 0, listeners: new Set(), loading: null };

export const colorOf = (e) => (e.overdue ? COLOR.over : COLOR[e.status] || COLOR.Open);
export const sayStatus = (e) => (e.overdue ? "Overdue" : e.status);
export const queryUrl = (e) => `tasks.html?mode=queries&reg=${encodeURIComponent(e.reg)}&q=${encodeURIComponent(e.qid)}`;

export function hidden() { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { return false; } }
export function setHidden(on) {
  try { localStorage.setItem(HIDE_KEY, on ? "1" : "0"); } catch (e) {}
  changed();
}

export const all = () => Q.views;
export function onChange(fn) { Q.listeners.add(fn); return () => Q.listeners.delete(fn); }
function changed() { for (const fn of Q.listeners) { try { fn(Q.views); } catch (e) { console.warn("query markers", e); } } }

/* The markers of a viewer project; again every 20 s while the page shows,
   and at once after a picture was added here (querypick.js). */
export async function load(project) {
  if (project !== Q.project) { Q.project = project; Q.views = []; }
  if (!project) return [];
  if (Q.loading) return Q.loading;
  Q.loading = (async () => {
    try {
      const r = await api("/api/query-views?project=" + encodeURIComponent(project));
      const sig = (v) => JSON.stringify(v.map((e) => [e.qid, e.i, e.key, e.status, e.overdue, e.title, e.due]));
      const was = sig(Q.views);
      Q.views = r.views || [];
      if (sig(Q.views) !== was) changed();
    } catch (e) { /* offline or no access: the markers stay as they were */ }
    finally { Q.loading = null; }
    return Q.views;
  })();
  if (!Q.timer) {
    Q.timer = setInterval(() => { if (!document.hidden && Q.project) load(Q.project); }, 20000);
    window.addEventListener("lwk-query-changed", () => setTimeout(() => load(Q.project), 300));
  }
  return Q.loading;
}

/* A marker deleted: its picture leaves the query (the query stays). */
export async function remove(e) {
  if (!confirm(`Remove this picture from ${e.code}? The query itself stays.`)) return false;
  try {
    await api(`/api/queries/${encodeURIComponent(e.qid)}/views/remove`, { method: "POST", body: JSON.stringify({ i: e.i, key: e.key }) });
  } catch (err) { alert("Could not remove it: " + err.message); await load(Q.project); return false; }
  Q.views = Q.views.filter((x) => !(x.qid === e.qid && x.key === e.key));
  changed();
  setTimeout(() => load(Q.project), 300);         // the indexes after it moved up
  return true;
}

export function matches(e, text, status) {
  if (status === "open-any" && e.status !== "Open") return false;
  if (status === "done-any" && e.status !== "Closed") return false;
  if (["Open", "Answered", "Closed"].includes(status) && e.status !== status) return false;
  if (status && !["open-any", "done-any", "Open", "Answered", "Closed"].includes(status)) return false;
  const q = (text || "").trim().toLowerCase();
  return !q || `${e.code} ${e.title} ${(e.to || []).join(" ")} ${e.view_title}`.toLowerCase().includes(q);
}

/* One row of the list in the right-hand column. */
export function rowHtml(e) {
  return `<li class="qv-row" data-qv="${esc(e.qid + "|" + e.i)}" title="Show it here and open its card">`
    + `<span class="qv-dot" style="background:${colorOf(e)}">?</span>`
    + `<span class="qv-t"><b>${esc(e.code)}</b> ${esc(e.title)}<small>${esc(sayStatus(e))}${e.due ? " · due " + esc(e.due) : ""}${e.to && e.to.length ? " · to " + esc(e.to.join(", ")) : ""}</small></span></li>`;
}

let CARD = null;
export function closeCard() { if (CARD) { CARD.remove(); CARD = null; document.removeEventListener("pointerdown", outside, true); } }
function outside(ev) { if (CARD && !CARD.contains(ev.target)) closeCard(); }

/* The marker's card, beside the point (x, y) on screen. */
export function openCard(e, x, y) {
  closeCard();
  const el = document.createElement("div");
  el.className = "qv-card";
  el.innerHTML = `<div class="qv-h"><span class="qv-dot" style="background:${colorOf(e)}">?</span><b>${esc(e.code)}</b>`
    + `<span class="qv-st" style="color:${colorOf(e)}">${esc(sayStatus(e))}</span><button type="button" class="qv-x" title="Close">&#10005;</button></div>`
    + `<div class="qv-title">${esc(e.title)}</div>`
    + `<div class="qv-meta">${e.to && e.to.length ? "To " + esc(e.to.join(", ")) : "Not addressed yet"}${e.due ? " · due " + esc(e.due) : ""}</div>`
    + (e.snapshot ? `<img src="${esc(e.snapshot)}" alt="">` : "")
    + `<div class="qv-meta">${esc(e.view_title || "")}${e.by ? " · added by " + esc(e.by) : ""}</div>`
    + `<div class="qv-f"><a class="primary" href="${esc(queryUrl(e))}" target="_blank" rel="noopener">Open query</a>`
    + (e.can_remove ? `<button type="button" class="qv-del" title="Remove this picture (and its marker) from the query - the query stays">Delete marker</button>` : "")
    + `</div>`;
  document.body.appendChild(el);
  // kept on screen - again once its picture has loaded (it grows)
  const place = () => {
    const w = 300, h = el.offsetHeight || 260;
    el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))) + "px";
    el.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, y - 20))) + "px";
  };
  place();
  const img = el.querySelector("img");
  if (img) img.addEventListener("load", place);
  el.querySelector(".qv-x").onclick = closeCard;
  const del = el.querySelector(".qv-del");
  if (del) del.onclick = async () => { if (await remove(e)) closeCard(); };
  CARD = el;
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}

(function css() {
  if (document.getElementById("qv-css")) return;
  const st = document.createElement("style");
  st.id = "qv-css";
  st.textContent = `
.qv-dot { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; color: #fff; font-weight: 800; font-size: 11px; flex: none; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
.qv-row { display: flex; gap: 8px; align-items: flex-start; padding: 6px 10px; cursor: pointer; list-style: none; border-left: 3px solid #0284c7; }
.qv-row:hover { background: rgba(2,132,199,.08); }
.qv-row .qv-t { flex: 1; min-width: 0; font-size: 13px; }
.qv-row small { display: block; color: var(--muted, #777); font-size: 11px; }
.qv-head { list-style: none; padding: 6px 10px 2px; font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: .04em; }
.qv-card { position: fixed; z-index: 3000; width: 300px; max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box; padding: 10px 12px; background: var(--panel, #fff); color: var(--ink, #222); border: 1px solid var(--line, #ddd); border-top: 3px solid #0284c7; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.2); font-size: 13px; }
.qv-card .qv-h { display: flex; align-items: center; gap: 6px; }
.qv-card .qv-st { font-size: 12px; font-weight: 700; }
.qv-card .qv-x { margin-left: auto; border: 0; background: none; color: inherit; cursor: pointer; font-size: 14px; }
.qv-card .qv-title { font-weight: 700; margin: 4px 0 2px; }
.qv-card .qv-meta { color: var(--muted, #777); font-size: 12px; }
.qv-card img { display: block; width: 100%; height: 140px; object-fit: cover; border: 1px solid var(--line, #ddd); border-radius: 6px; margin: 6px 0 2px; }
.qv-card .qv-f { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.qv-card .qv-f a.primary { padding: 4px 10px; border-radius: 6px; background: #0284c7; color: #fff; text-decoration: none; font-weight: 600; }
.qv-card .qv-del { margin-left: auto; border: 1px solid var(--bad, #e2453c); color: var(--bad, #e2453c); background: none; border-radius: 6px; padding: 3px 8px; cursor: pointer; font: inherit; font-size: 12px; }
`;
  document.head.appendChild(st);
})();
