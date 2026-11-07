/* Pictures and files sent in the Messenger and in task comments.
 *
 * The file goes up as the request body itself (chat.py /api/chat/upload),
 * so a screenshot pasted from the clipboard needs no form around it. Up to
 * 50 MB; drawings and models stay in OneDrive / ACC and are sent as links.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

import { saveToFoldersFlow } from "./folderpick.js";

export const MAX = 50 * 1024 * 1024;

function headers() {
  const h = {};
  try {
    const t = localStorage.getItem("lwk-viewer:token");
    if (t) h["X-Viewer-Token"] = t;
  } catch (e) {}
  return h;
}

/* where: { room } or { task }. Resolves with { id, name, size, mime, url }. */
export async function upload(file, where, name) {
  if (file.size > MAX) throw new Error(`${file.name || "That file"} is over 50 MB - send a OneDrive or ACC link instead`);
  const q = new URLSearchParams(Object.assign({ name: name || file.name || "pasted.png" }, where));
  const res = await fetch("/api/chat/upload?" + q.toString(), {
    method: "POST", body: file,
    headers: Object.assign(headers(), { "Content-Type": file.type || "application/octet-stream" }),
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.detail) || "Upload failed (HTTP " + res.status + ")");
  return data;
}

export function size(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " kB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

const ICON = { pdf: "PDF", dwg: "DWG", rvt: "RVT", xlsx: "XLS", xls: "XLS", docx: "DOC", doc: "DOC", zip: "ZIP", pptx: "PPT", ifc: "IFC" };

/* Attachments as shown under a message or a comment: pictures as
   thumbnails (click: full size), other files as chips. Each has a folder
   button: keep a copy of it in Folders (folderpick.js). */
const keepBtn = (f) => `<button type="button" class="up-keep" data-keep-url="${esc(f.url)}" data-keep-name="${esc(f.name)}" title="Keep a copy in Folders ...">&#128193;</button>`;
export function filesHtml(files) {
  if (!files || !files.length) return "";
  const pics = files.filter((f) => (f.mime || "").startsWith("image/"));
  const vids = files.filter((f) => (f.mime || "").startsWith("video/"));
  const rest = files.filter((f) => !(f.mime || "").startsWith("image/") && !(f.mime || "").startsWith("video/"));
  return `<div class="up-files">`
    + pics.map((f) => `<span class="up-w"><a class="up-pic" href="${esc(f.url)}" target="_blank" title="${esc(f.name)}"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>${keepBtn(f)}</span>`).join("")
    + vids.map((f) => `<div class="up-vid up-w"><video src="${esc(f.url)}" controls preload="metadata" playsinline></video><small>${esc(f.name)} · ${esc(size(f.size || 0))}</small>${keepBtn(f)}</div>`).join("")
    + rest.map((f) => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      return `<span class="up-w"><a class="up-file" href="${esc(f.url)}" target="_blank" title="Open / download"><span class="up-ext">${esc(ICON[ext] || ext.toUpperCase().slice(0, 4) || "FILE")}</span>`
        + `<span class="up-n">${esc(f.name)}</span><small>${esc(size(f.size || 0))}</small></a>${keepBtn(f)}</span>`;
    }).join("")
    + `</div>`;
}

/* Files waiting to be sent, under a text box. */
export function pendingHtml(list) {
  return list.map((p, i) => `<span class="up-pend${p.error ? " bad" : ""}" data-i="${i}">`
    + `${(p.mime || "").startsWith("image/") && p.url ? `<img src="${esc(p.url)}">` : ""}`
    + `<span>${esc(p.name)}</span><small>${p.error ? esc(p.error) : p.id ? esc(size(p.size)) : "uploading ..."}</small>`
    + `<button type="button" class="ghost" data-unpend="${i}" title="Remove">&#10005;</button></span>`).join("");
}

/* A pasted screenshot comes as "image.png": it gets a name that says what
   and when, so the card in the chat (and Folders) can be told apart. */
function named(f) {
  if (!/^(image|pasted|blob)(\.\w+)?$/i.test(f.name || "") || typeof File === "undefined") return f;
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const ext = ((f.type || "").split("/")[1] || "png").replace("jpeg", "jpg");
  const nm = `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`;
  try { return new File([f], nm, { type: f.type }); } catch (e) { return f; }
}

/* Paste and drop onto an element: calls take(fileList). */
export function catchFiles(el, take) {
  el.addEventListener("paste", (ev) => {
    const fs = Array.from((ev.clipboardData && ev.clipboardData.files) || []).map(named);
    if (fs.length) { ev.preventDefault(); take(fs); }
  });
  el.addEventListener("dragover", (ev) => {
    if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files")) { ev.preventDefault(); el.classList.add("up-drop"); }
  });
  el.addEventListener("dragleave", () => el.classList.remove("up-drop"));
  el.addEventListener("drop", (ev) => {
    el.classList.remove("up-drop");
    const fs = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
    if (fs.length) { ev.preventDefault(); take(fs); }
  });
}

/* A picture opened in the page, not a new tab: on a phone a new tab is the
   bare image with no way back to the chat. × (or a tap beside it, Esc, the
   phone's Back) closes it; ‹ › and a swipe go through the message's other
   pictures; pinch or double-tap zooms. */
export function openPictures(list, i) {
  if (!list.length) return;
  let k = Math.max(0, Math.min(list.length - 1, i || 0));
  const v = document.createElement("div");
  v.className = "up-view";
  v.innerHTML = `<button type="button" class="up-x" title="Close (Esc)" aria-label="Close">\u00D7</button>`
    + (list.length > 1 ? `<button type="button" class="up-nav up-prev" aria-label="Previous">\u2039</button><button type="button" class="up-nav up-next" aria-label="Next">\u203A</button>` : "")
    + `<div class="up-stage"><img alt=""></div>`
    + `<div class="up-bar"><span class="up-name"></span><a class="up-open" target="_blank" rel="noopener">Open original</a><a class="up-dl" download>Download</a></div>`;
  document.body.appendChild(v);
  const img = v.querySelector("img");
  let z = 1, tx = 0, ty = 0;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`; };
  const show = () => {
    const f = list[k];
    z = 1; tx = ty = 0; apply();
    img.src = f.url;
    v.querySelector(".up-name").textContent = (list.length > 1 ? `${k + 1} / ${list.length}  ` : "") + (f.name || "");
    v.querySelector(".up-open").href = f.url;
    const dl = v.querySelector(".up-dl"); dl.href = f.url; dl.setAttribute("download", f.name || "picture");
  };
  const go = (d) => { if (list.length > 1) { k = (k + d + list.length) % list.length; show(); } };
  // Back closes it, not the page: one history entry while it is open
  let pushed = false;
  try { history.pushState({ upView: 1 }, ""); pushed = true; } catch (e) {}
  let closed = false;
  const close = (fromBack) => {
    if (closed) return;
    closed = true;
    v.remove();
    removeEventListener("keydown", key, true);
    removeEventListener("popstate", onBack);
    if (pushed && !fromBack) { try { history.back(); } catch (e) {} }
  };
  const onBack = () => close(true);
  const key = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === "ArrowLeft") go(-1);
    else if (ev.key === "ArrowRight") go(1);
  };
  addEventListener("keydown", key, true);
  addEventListener("popstate", onBack);
  v.querySelector(".up-x").onclick = () => close();
  const pv = v.querySelector(".up-prev"), nx = v.querySelector(".up-next");
  if (pv) pv.onclick = (ev) => { ev.stopPropagation(); go(-1); };
  if (nx) nx.onclick = (ev) => { ev.stopPropagation(); go(1); };
  v.addEventListener("click", (ev) => { if (ev.target === v || ev.target.classList.contains("up-stage")) close(); });
  // pinch, drag when zoomed, swipe, double-tap
  const pts = new Map();
  let start = null, lastTap = 0;
  img.addEventListener("pointerdown", (ev) => {
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    try { img.setPointerCapture(ev.pointerId); } catch (e) {}
    const P = [...pts.values()];
    start = { z, tx, ty, P: P.map((q) => q.slice()), d: P.length > 1 ? Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]) : 0, t: Date.now() };
    ev.preventDefault();
  });
  img.addEventListener("pointermove", (ev) => {
    if (!pts.has(ev.pointerId) || !start) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const P = [...pts.values()];
    if (P.length > 1 && start.d) {
      z = Math.max(1, Math.min(8, start.z * Math.hypot(P[0][0] - P[1][0], P[0][1] - P[1][1]) / start.d));
    } else if (z > 1) {
      tx = start.tx + (P[0][0] - start.P[0][0]); ty = start.ty + (P[0][1] - start.P[0][1]);
    }
    apply();
  });
  const up = (ev) => {
    const p0 = start && start.P[0], p1 = pts.get(ev.pointerId);
    pts.delete(ev.pointerId);
    if (pts.size || !start) return;
    const dx = p1 && p0 ? p1[0] - p0[0] : 0, dy = p1 && p0 ? p1[1] - p0[1] : 0;
    if (z === 1 && start.P.length === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && start.P.length === 1) {
      const now = Date.now();
      if (now - lastTap < 320) { z = z > 1 ? 1 : 2.5; tx = ty = 0; apply(); lastTap = 0; } else lastTap = now;
    }
    start = null;
  };
  img.addEventListener("pointerup", up);
  img.addEventListener("pointercancel", up);
  img.addEventListener("wheel", (ev) => { ev.preventDefault(); z = Math.max(1, Math.min(8, z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15))); if (z === 1) tx = ty = 0; apply(); }, { passive: false });
  show();
}

// every picture under a message or comment opens in the page (Ctrl / middle click: a new tab, as before)
if (typeof document !== "undefined" && !window.__upViewWired) {
  window.__upViewWired = true;
  document.addEventListener("click", (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest("a.up-pic");
    if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
    ev.preventDefault();
    const group = a.closest(".up-files");
    const all = group ? Array.from(group.querySelectorAll("a.up-pic")) : [a];
    openPictures(all.map((x) => ({ url: x.getAttribute("href"), name: x.getAttribute("title") || "" })), all.indexOf(a));
  }, true);
}

(function css() {
  if (document.getElementById("up-css")) return;
  const st = document.createElement("style");
  st.id = "up-css";
  st.textContent = `
.up-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.up-view { position: fixed; inset: 0; z-index: 2000; background: rgba(10,12,16,.96); display: flex; align-items: center; justify-content: center; touch-action: none; }
.up-view .up-stage { position: absolute; inset: 0 0 52px 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.up-view img { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center; user-select: none; -webkit-user-drag: none; touch-action: none; }
.up-view .up-x { position: absolute; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); z-index: 2;
  width: 46px; height: 46px; border-radius: 23px; border: 0; background: rgba(255,255,255,.16); color: #fff; font-size: 30px; line-height: 44px; cursor: pointer; }
.up-view .up-nav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 44px; height: 64px; border: 0; border-radius: 10px;
  background: rgba(255,255,255,.12); color: #fff; font-size: 34px; cursor: pointer; }
.up-view .up-prev { left: 8px; } .up-view .up-next { right: 8px; }
.up-view .up-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 52px; padding: 0 14px calc(env(safe-area-inset-bottom, 0px)) 14px;
  display: flex; align-items: center; gap: 14px; color: #e5e7eb; font-size: 13px; }
.up-view .up-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-view .up-bar a { color: #fff; text-decoration: underline; white-space: nowrap; }
.up-vid video { max-width: 420px; width: 100%; max-height: 300px; border-radius: 8px; background: #000; display: block; }
.up-vid small { color: var(--muted, #6b7480); font-size: 10px; }
.up-pic img { max-width: 240px; max-height: 180px; border-radius: 6px; border: 1px solid var(--line, #e2e6ec); display: block; object-fit: cover; }
.up-file { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line, #e2e6ec); border-radius: 8px; padding: 6px 10px;
  text-decoration: none; color: var(--ink, #1f2430); background: var(--panel, #fff); max-width: 300px; }
.up-file:hover { border-color: var(--accent, #f28022); }
.up-ext { background: var(--accent-deep, #d1660e); color: #fff; font-size: 9px; font-weight: 700; border-radius: 4px; padding: 3px 5px; }
.up-n { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-file small { color: var(--muted, #6b7480); font-size: 10px; white-space: nowrap; }
.up-pend { display: inline-flex; align-items: center; gap: 6px; background: var(--panel-2, #f7f8fa); border: 1px solid var(--line, #e2e6ec);
  border-radius: 6px; padding: 2px 4px 2px 6px; margin: 4px 4px 0 0; font-size: 11px; }
.up-pend img { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; }
.up-pend small { color: var(--muted, #6b7480); }
.up-pend.bad small { color: var(--bad, #e2453c); }
.up-pend button { padding: 0 4px !important; font-size: 10px; }
.up-drop { outline: 2px dashed var(--accent, #f28022); outline-offset: -2px; }
.up-w { position: relative; display: inline-flex; align-items: flex-start; }
.up-keep { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; padding: 0 !important; border-radius: 50%;
  border: 1px solid var(--line, #e2e6ec); background: var(--panel, #fff); font-size: 11px; line-height: 20px; cursor: pointer;
  opacity: 0; transition: opacity .12s; box-shadow: 0 1px 4px rgba(20,26,36,.15); }
.up-w:hover .up-keep, .up-keep:focus-visible { opacity: 1; }
@media (hover: none) { .up-keep { opacity: .9; } }
`;
  document.head.appendChild(st);
})();

/* the folder button on an attachment: choose a folder, keep a copy there */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest && ev.target.closest("[data-keep-url]");
  if (!b) return;
  ev.preventDefault();
  ev.stopPropagation();
  const url = b.dataset.keepUrl;
  saveToFoldersFlow(async () => {
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error("the file could not be read (HTTP " + r.status + ")");
    return await r.blob();
  }, b.dataset.keepName || "file");
}, true);
