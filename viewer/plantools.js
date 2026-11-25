/* Site study: the plan pages' drawing tools - an icon toolbar along the top
 * of the plan, a property bar under it for what is selected (in place of the
 * small floating menus), the right-click menu, a clipboard, and a library of
 * doors, windows and openings dragged onto the walls.
 *
 * The bars live in #st-ptop, outside the plan that redraws on every change,
 * so a field being typed in is not replaced under the cursor.
 */
import { iconSvg, iconColor, hasIcon } from "./icons.js";
import { openMenu } from "./ctxmenu.js";
import * as KS from "./keysheet.js";

const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* the doors, windows and openings to drag onto a wall: id, icon, label, default width */
export const OPENINGS = [
  { id: "door", icon: "door", label: "Door", w: 0.9 },
  { id: "door2", icon: "door2", label: "Double door", w: 1.5 },
  { id: "doorU", icon: "door2", label: "Unequal double", w: 1.2 },
  { id: "sliding", icon: "sliding", label: "Sliding, 1 leaf", w: 1.2 },
  { id: "sliding2", icon: "sliding", label: "Sliding, 2 leaves", w: 2.0 },
  { id: "opening", icon: "opening", label: "Opening", w: 0.9 },
  { id: "panel", icon: "panel", label: "Access panel", w: 0.6 },
  { id: "window", icon: "window", label: "Window", w: 1.2 },
  { id: "cw", icon: "window", label: "Curtain wall", w: 3.0 },
];
export const OPEN_BY = Object.fromEntries(OPENINGS.map((o) => [o.id, o]));

let HOST = null, PAGE = "", H = {}, libOpen = false;
const host = () => HOST || (HOST = document.getElementById("st-ptop"));

let KPAGE = "";
const btn = (b, active) => {
  if (b === "|") return `<span class="pt-sep"></span>`;
  if (b.html) return b.html;
  // the key the user has for it (the shortcuts table), else the one given
  if (KPAGE && b.id && b.id in KS.keysOf(KPAGE)) b = Object.assign({}, b, { key: KS.keyFor(KPAGE, b.id) });
  const on = b.on != null ? b.on : active === b.id;
  const ic = hasIcon(b.icon) ? iconSvg(b.icon, 18) : `<b>${esc(b.text || b.icon)}</b>`;
  return `<button type="button" class="pt-b${on ? " on" : ""}${b.text && hasIcon(b.icon) ? " wt" : ""}" data-pt="${esc(b.id)}" title="${esc(b.title + (b.key ? "  (" + b.key + ")" : ""))}" style="--ico:${hasIcon(b.icon) ? iconColor(b.icon) : "#555"}"${b.disabled ? " disabled" : ""}>${ic}${b.text ? `<span>${esc(b.text)}</span>` : ""}</button>`;
};

/* the toolbar: groups of {id, icon, title, key, on, text, disabled} (or "|", or {html}) */
export function toolbar(groups, active, page) {
  KPAGE = page || "";
  const G = page ? [...groups, [...(LEGEND_ITEMS[page] ? [{ id: "legend", icon: "legend", title: "Legend: what the colours, hatches and symbols mean" }] : []), { id: "keys", icon: "keys", title: "Keyboard shortcuts", key: "?" }]] : groups;
  const h = `<div class="pt-bar" role="toolbar">${G.map((g) => `<div class="pt-grp">${g.map((b) => btn(b, active)).join("")}</div>`).join("")}</div>`;
  KPAGE = ""; return h;
}
export { KS };

/* a property bar: a title (an icon and words), fields and action buttons.
   field: {key, label, icon, type: num|sel|seg|chk|txt|read, value, step, min, max, unit, options: [[v, l]] | [[v, icon, title]], title, w} */
export function propBar(title, fields, acts) {
  const f = (q) => {
    const lab = q.icon && hasIcon(q.icon) ? `<span class="pt-fi" title="${esc(q.title || q.label || "")}">${iconSvg(q.icon, 15)}</span>` : q.label ? `<span class="pt-fl">${esc(q.label)}</span>` : "";
    let inp = "";
    if (q.type === "read") inp = `<span class="pt-ro">${esc(q.value)}</span>`;
    else if (q.type === "sel") inp = `<select data-pp="${esc(q.key)}" title="${esc(q.title || q.label || "")}"${q.disabled ? " disabled" : ""}>${q.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(q.value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    else if (q.type === "seg") inp = `<span class="pt-seg">${q.options.map(([v, ic, ti]) => `<button type="button" data-pp="${esc(q.key)}" data-v="${esc(v)}" class="${String(v) === String(q.value) ? "on" : ""}" title="${esc(ti || v)}">${hasIcon(ic) ? iconSvg(ic, 15) : esc(ic)}</button>`).join("")}</span>`;
    else if (q.type === "chk") inp = `<label class="pt-chk" title="${esc(q.title || "")}"><input type="checkbox" data-pp="${esc(q.key)}"${q.value ? " checked" : ""}> ${esc(q.text || "")}</label>`;
    else if (q.type === "txt") inp = `<input type="text" data-pp="${esc(q.key)}" value="${esc(q.value)}" style="width:${q.w || 120}px" title="${esc(q.title || "")}">`;
    else {
      const v = q.value == null || q.value === "" || isNaN(q.value) ? "" : q.step != null && q.step >= 1 ? Math.round(q.value) : Number(q.value).toFixed(q.dp != null ? q.dp : 3);
      inp = `<input type="number" data-pp="${esc(q.key)}" value="${v}" step="${q.step != null ? q.step : 0.001}"${q.min != null ? ` min="${q.min}"` : ""}${q.max != null ? ` max="${q.max}"` : ""} placeholder="${esc(q.ph || "")}" style="width:${q.w || 68}px" title="${esc(q.title || q.label || "")}"${q.disabled ? " disabled" : ""}>`;
    }
    return `<span class="pt-f">${lab}${inp}${q.unit ? `<span class="pt-u">${esc(q.unit)}</span>` : ""}</span>`;
  };
  return `<div class="pt-prop">${title ? `<span class="pt-pt">${title.icon ? iconSvg(title.icon, 16) : ""}<b>${esc(title.text)}</b>${title.sub ? `<small>${esc(title.sub)}</small>` : ""}</span>` : ""}${fields.map(f).join("")}<span class="pt-acts">${(acts || []).map((a) => btn(a)).join("")}</span></div>`;
}

/* the library drawer: tiles to drag onto a wall */
function library(items) {
  return `<div class="pt-lib"><div class="pt-libh"><b>Drag onto a wall</b><button type="button" data-pt="lib:close" class="pt-b" title="Close">${iconSvg("close", 14)}</button></div><div class="pt-tiles">${items.map((o) => `<div class="pt-tile" data-lib="${esc(o.id)}" title="${esc(o.label)} · ${o.w} m">${tileSvg(o.id)}<span>${esc(o.label)}</span></div>`).join("")}</div></div>`;
}
/* a small plan of each opening type, for the library */
export function tileSvg(id) {
  const W = "#2b3440", L = (x1, y1, x2, y2, w = 1.4) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${W}" stroke-width="${w}"/>`;
  const wall = `<rect x="2" y="27" width="10" height="6" fill="#9aa1a8"/><rect x="44" y="27" width="10" height="6" fill="#9aa1a8"/>`;
  let g = wall;
  if (id === "door") g += L(12, 30, 12, 6) + `<path d="M12 6 A24 24 0 0 1 36 30" fill="none" stroke="${W}" stroke-width=".8"/>` + L(36, 30, 44, 30, 0.6);
  else if (id === "door2") g += L(12, 30, 12, 14) + L(44, 30, 44, 14) + `<path d="M12 14 A16 16 0 0 1 28 30 A16 16 0 0 1 44 14" fill="none" stroke="${W}" stroke-width=".8"/>`;
  else if (id === "doorU") g += L(12, 30, 12, 10) + L(44, 30, 44, 20) + `<path d="M12 10 A20 20 0 0 1 32 30 A12 12 0 0 1 44 20" fill="none" stroke="${W}" stroke-width=".8"/>`;
  else if (id === "sliding") g += `<rect x="12" y="27.5" width="18" height="2.5" fill="#fff" stroke="${W}"/><rect x="26" y="30" width="18" height="2.5" fill="#eef4fa" stroke="${W}"/>` + L(16, 22, 26, 22, 0.8);
  else if (id === "sliding2") g += `<rect x="12" y="27.5" width="17" height="2.5" fill="#fff" stroke="${W}"/><rect x="27" y="30" width="17" height="2.5" fill="#fff" stroke="${W}"/>` + L(24, 22, 16, 22, 0.8) + L(32, 38, 40, 38, 0.8);
  else if (id === "opening") g += L(12, 27, 12, 33) + L(44, 27, 44, 33) + `<line x1="12" y1="30" x2="44" y2="30" stroke="${W}" stroke-width=".6" stroke-dasharray="2 2"/>`;
  else if (id === "panel") g += `<rect x="12" y="27" width="32" height="6" fill="#fff"/>` + L(12, 28, 44, 28, 0.7) + L(12, 30, 44, 30, 0.7) + L(12, 32, 44, 32, 0.7) + `<text x="28" y="22" font-size="7" text-anchor="middle" fill="${W}">AP</text>`;
  else if (id === "window") g += `<rect x="12" y="27" width="32" height="6" fill="#fff" stroke="${W}"/>` + L(12, 29.4, 44, 29.4, 0.6) + L(12, 30.6, 44, 30.6, 0.6);
  else if (id === "cw") g += `<rect x="12" y="28.5" width="32" height="3" fill="#dbe9f7" stroke="#2b6cb0"/>` + L(12, 27, 12, 33, 2) + L(28, 27, 28, 33, 2) + L(44, 27, 44, 33, 2);
  return `<svg viewBox="0 0 56 44" width="56" height="44">${g}</svg>`;
}

/* show this page's bars: page, the toolbar's html, the property bar's html (or ""), the library's items (or null);
   a field being typed in is kept (the rest waits for its change) */
export function mount(page, tb, pb, lib) {
  const h = host(); if (!h) return;
  h.hidden = !page;
  if (!page) { h.innerHTML = ""; PAGE = ""; return; }
  const a = document.activeElement, typing = a && h.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT") && PAGE === page;
  const html = `${tb}${pb || ""}${libOpen && lib ? library(lib) : ""}`;
  if (typing) { h.dataset.pending = "1"; mount.next = [page, tb, pb, lib]; return; }
  if (h.dataset.html === html && PAGE === page) return;
  h.innerHTML = html; h.dataset.html = html; PAGE = page; delete h.dataset.pending;
}
export function unmount(page) { if (PAGE === page) mount(""); }
export const libraryOpen = () => libOpen;
export function toggleLibrary(on) { libOpen = on == null ? !libOpen : !!on; }

/* the page's handlers: {tool(id, el), prop(key, value, el), drag: {over(item, ev), drop(item, ev), end()}} */
export function handlers(page, h) { H[page] = h; wire(); }
let wired = false;
function wire() {
  if (wired) return; const h = host(); if (!h) return; wired = true;
  const cur = () => H[PAGE] || {};
  h.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pt]");
    if (b) { ev.preventDefault(); if (b.dataset.pt === "keys") return KS.openPage(PAGE);
      if (b.dataset.pt === "legend") return toggleLegend(b, LEGEND_ITEMS[PAGE] || []);
      if (b.dataset.pt === "lib:close") { libOpen = false; return cur().refresh && cur().refresh(); } return cur().tool && cur().tool(b.dataset.pt, b, ev); }
    const s = ev.target.closest("button[data-pp]");
    if (s) { ev.preventDefault(); return cur().prop && cur().prop(s.dataset.pp, s.dataset.v, s); }
  });
  const apply = (ev) => {
    const t = ev.target; if (!t.dataset || t.dataset.pp == null || t.tagName === "BUTTON") return;
    const v = t.type === "checkbox" ? t.checked : t.value;
    t.blur && ev.type === "keydown" && t.blur();
    if (cur().prop) cur().prop(t.dataset.pp, v, t);
    if (mount.next && h.dataset.pending) { const n2 = mount.next; mount.next = null; setTimeout(() => mount(...n2), 0); }
  };
  h.addEventListener("change", apply);
  h.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.tagName === "INPUT") { ev.preventDefault(); ev.target.blur(); } if (ev.key === "Escape") ev.target.blur && ev.target.blur(); ev.stopPropagation(); });
  h.addEventListener("focusout", () => { if (mount.next && h.dataset.pending) setTimeout(() => { if (!h.contains(document.activeElement) && mount.next) { const n2 = mount.next; mount.next = null; mount(...n2); } }, 0); });
  // the library: a tile dragged out onto the plan
  h.addEventListener("pointerdown", (ev) => {
    const t = ev.target.closest("[data-lib]"); if (!t) return;
    ev.preventDefault();
    const item = OPEN_BY[t.dataset.lib], g = document.createElement("div");
    g.className = "pt-ghost"; g.innerHTML = tileSvg(item.id); document.body.appendChild(g);
    const mv = (e) => { g.style.left = e.clientX + 8 + "px"; g.style.top = e.clientY + 8 + "px"; const d = cur().drag; if (d && d.over) d.over(item, e); };
    const up = (e) => { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); g.remove(); const d = cur().drag; if (d && d.drop) d.drop(item, e); };
    mv(ev);
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  });
}

/* the right-click menu: entries {label, icon, key, action, disabled, danger} or "-" */
export function ctx(ev, entries) {
  ev.preventDefault();
  const list = entries.filter((e) => e).map((e) => (e === "-" ? e : Object.assign({}, e, { label: e.label })));
  while (list.length && list[list.length - 1] === "-") list.pop();
  if (list.length) openMenu(ev.clientX, ev.clientY, list);
}

/* the clipboard: one thing of a kind at a time, kept for the session */
export const clip = {
  set(kind, data) { clip.v = { kind, data: JSON.parse(JSON.stringify(data)) }; try { sessionStorage.setItem("lwk-viewer:planclip", JSON.stringify(clip.v)); } catch (e) { /* private window */ } },
  get(kind) {
    if (!clip.v) { try { clip.v = JSON.parse(sessionStorage.getItem("lwk-viewer:planclip") || "null"); } catch (e) { clip.v = null; } }
    return clip.v && (!kind || clip.v.kind === kind || (Array.isArray(kind) && kind.includes(clip.v.kind))) ? JSON.parse(JSON.stringify(clip.v)) : null;
  },
  v: null,
};

/* the keys a plan page answers (the page says when it is on): Ctrl+C / X / V / D / Z / Y, Delete, Esc and the tools' letters */
export function keys(on, map) {
  document.addEventListener("keydown", (ev) => {
    if (!on()) return;
    const t = ev.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const k = (ev.ctrlKey || ev.metaKey ? "ctrl+" : "") + (ev.shiftKey && ev.key.length > 1 ? "shift+" : "") + ev.key.toLowerCase();
    const f = map[k]; if (!f) return;
    if (f(ev) !== false) ev.preventDefault();
  });
}

/* ---------- the legend: a card of what the plan's colours, hatches and symbols mean, opened from a toolbar button.
   items: [{svg: an inner SVG drawing in a 28 x 16 box, label}] or "group name" strings */
const SW = {
  fill: (c, st = "#333", dash = "") => `<rect x="2" y="2" width="24" height="12" fill="${c}" stroke="${st}" stroke-width="0.8"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
  hatch: (c, l) => `<rect x="2" y="2" width="24" height="12" fill="${c}"/>${[0, 6, 12, 18, 24].map((x) => `<line x1="${x}" y1="14" x2="${x + 8}" y2="2" stroke="${l}" stroke-width="0.8"/>`).join("")}<rect x="2" y="2" width="24" height="12" fill="none" stroke="${l}" stroke-width="0.6"/>`,
  line: (c, w = 1.5, dash = "") => `<line x1="2" y1="8" x2="26" y2="8" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
};
export const LEGEND_ITEMS = {
  floors: [
    "Rooms and spaces",
    { svg: SW.fill("#fbf3d5"), label: "Unit (flat)" },
    { svg: SW.fill("#eceff3", "#9aa5b1"), label: "Corridor" },
    { svg: SW.fill("#e3f1e3", "#8cc28c", "3 2"), label: "Corridor exempt (JPN 1)" },
    { svg: SW.fill("#e3edf9", "#7fa6d6", "3 2"), label: "Lift lobby exempt (JPN 1)" },
    { svg: SW.hatch("#f6e7c4", "#d9b56a"), label: "E&M left over (exempt, to check)" },
    { svg: SW.fill("#dfe9f3", "#3c4650", "4 2"), label: "Balcony / UP / A/C platform" },
    "Core",
    { svg: `${SW.fill("#e5e1f5", "#444")}<rect x="7" y="3" width="14" height="3" fill="#d9dce0" stroke="#333" stroke-width="0.5"/>`, label: "Lift: car, counterweight at the back" },
    { svg: `${SW.fill("#fff", "#222")}<polyline points="8,13 8,4 20,4 20,13" fill="none" stroke="#a5642a" stroke-width="1"/><circle cx="8" cy="13" r="1.3" fill="#a5642a"/>`, label: "Staircase: UP / DN walking line, break line" },
    { svg: SW.fill("#e3e7d3"), label: "Refuse room" },
    { svg: SW.fill("#f1d6d6"), label: "E&M riser / PD" },
    "Walls and openings",
    { svg: SW.fill("#8b9096", "#5c6166"), label: "RC wall" },
    { svg: SW.hatch("#fff", "#8a8f95"), label: "Block wall" },
    { svg: SW.fill("#a9b0b7", "#5c6166", "3 2"), label: "Precast wall" },
    { svg: `<line x1="4" y1="14" x2="4" y2="2" stroke="#222" stroke-width="1.3"/><path d="M4 2 A12 12 0 0 1 16 14" fill="none" stroke="#444" stroke-width="0.7"/><rect x="2" y="13" width="3" height="2" fill="#fff" stroke="#222" stroke-width="0.5"/>`, label: "Door, with its frame" },
    { svg: `<rect x="2" y="6" width="12" height="2" fill="#fff" stroke="#222" stroke-width="0.6"/><rect x="12" y="8" width="12" height="2" fill="#fff" stroke="#222" stroke-width="0.6"/>`, label: "Sliding door" },
    { svg: `<rect x="2" y="5" width="24" height="6" fill="#fff" stroke="#111" stroke-width="0.7"/><line x1="2" y1="7.5" x2="26" y2="7.5" stroke="#2b6cb0" stroke-width="0.5"/><line x1="2" y1="8.5" x2="26" y2="8.5" stroke="#2b6cb0" stroke-width="0.5"/>`, label: "Window" },
    { svg: `<rect x="2" y="7" width="24" height="2" fill="#d6e6f5" stroke="#2b6cb0" stroke-width="0.6"/><rect x="2" y="6" width="2" height="4" fill="#334"/><rect x="13" y="6" width="2" height="4" fill="#334"/><rect x="24" y="6" width="2" height="4" fill="#334"/>`, label: "Curtain wall: mullions, panels" },
    { svg: `<rect x="2" y="5" width="24" height="6" fill="#fff" stroke="#222" stroke-width="0.6"/><line x1="2" y1="6.5" x2="26" y2="6.5" stroke="#222" stroke-width="0.6"/><line x1="2" y1="8" x2="26" y2="8" stroke="#222" stroke-width="0.6"/><line x1="2" y1="9.5" x2="26" y2="9.5" stroke="#222" stroke-width="0.6"/>`, label: "Access panel (AP)" },
    "Lines",
    { svg: SW.line("#c62828", 0.9, "8 3 2 3"), label: "Structural grid" },
    { svg: SW.line("#0b57d0", 1.2), label: "Measure" },
  ],
  units: [
    "Rooms",
    { svg: SW.fill("#fbf3d5"), label: "Living, bedrooms, kitchen" },
    { svg: SW.fill("#eef6f4"), label: "Bathroom" },
    { svg: SW.fill("#f3f1ea"), label: "Store" },
    { svg: SW.fill("#dfe9f3", "#3c4650", "4 2"), label: "Balcony / UP / A/C platform" },
    "Walls and openings",
    { svg: SW.fill("#8b9096", "#5c6166"), label: "External / party wall (RC)" },
    { svg: SW.hatch("#fff", "#8a8f95"), label: "Partition (block)" },
    { svg: SW.fill("#a9b0b7", "#5c6166", "3 2"), label: "Precast wall" },
    { svg: `<line x1="4" y1="14" x2="4" y2="2" stroke="#222" stroke-width="1.3"/><path d="M4 2 A12 12 0 0 1 16 14" fill="none" stroke="#444" stroke-width="0.7"/>`, label: "Door" },
    { svg: `<rect x="2" y="5" width="24" height="6" fill="#fff" stroke="#111" stroke-width="0.7"/><line x1="2" y1="8" x2="26" y2="8" stroke="#2b6cb0" stroke-width="0.6"/>`, label: "Window" },
    { svg: `<rect x="2" y="7" width="24" height="2" fill="#d6e6f5" stroke="#2b6cb0" stroke-width="0.6"/><rect x="2" y="6" width="2" height="4" fill="#222"/><rect x="24" y="6" width="2" height="4" fill="#222"/>`, label: "Curtain wall" },
    { svg: `<line x1="2" y1="6" x2="26" y2="6" stroke="#222" stroke-width="0.6"/><line x1="2" y1="8" x2="26" y2="8" stroke="#222" stroke-width="0.6"/><line x1="2" y1="10" x2="26" y2="10" stroke="#222" stroke-width="0.6"/>`, label: "Access panel" },
    "Lines",
    { svg: SW.line("#c62828", 1.6, "9 3 2 3"), label: "Saleable area line" },
    { svg: SW.line("#1565c0", 1.6, "6 3"), label: "GFA line" },
    { svg: SW.line("#0b57d0", 1.2), label: "Measure" },
  ],
};
let LEG = null;
/* open or close the legend card under the button b: items, or a function giving them */
export function toggleLegend(b, items) {
  if (LEG) { LEG.remove(); LEG = null; return; }
  const list = typeof items === "function" ? items() : items;
  const el = document.createElement("div");
  el.className = "pt-legend";
  el.innerHTML = `<div class="pt-legh"><b>Legend</b><button type="button" class="pt-b" data-legclose title="Close">${iconSvg("close", 14)}</button></div><div class="pt-legb">${list.map((q) => (typeof q === "string" ? `<h5>${esc(q)}</h5>` : `<div class="pt-legi"><svg viewBox="0 0 28 16" width="28" height="16">${q.svg}</svg><span>${esc(q.label)}</span></div>`)).join("")}</div>`;
  document.body.appendChild(el);
  const r = b.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left)) + "px";
  el.style.top = Math.min(innerHeight - el.offsetHeight - 8, r.bottom + 6) + "px";
  el.addEventListener("click", (ev) => { if (ev.target.closest("[data-legclose]")) { el.remove(); LEG = null; } });
  LEG = el;
}
