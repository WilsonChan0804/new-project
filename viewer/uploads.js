/* Pictures and files sent in the Messenger and in task comments.
 *
 * The file goes up as the request body itself (chat.py /api/chat/upload),
 * so a screenshot pasted from the clipboard needs no form around it. Up to
 * 50 MB; drawings and models stay in OneDrive / ACC and are sent as links.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
   thumbnails (click: full size), other files as chips. */
export function filesHtml(files) {
  if (!files || !files.length) return "";
  const pics = files.filter((f) => (f.mime || "").startsWith("image/"));
  const rest = files.filter((f) => !(f.mime || "").startsWith("image/"));
  return `<div class="up-files">`
    + pics.map((f) => `<a class="up-pic" href="${esc(f.url)}" target="_blank" title="${esc(f.name)}"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`).join("")
    + rest.map((f) => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      return `<a class="up-file" href="${esc(f.url)}" target="_blank" title="Open / download"><span class="up-ext">${esc(ICON[ext] || ext.toUpperCase().slice(0, 4) || "FILE")}</span>`
        + `<span class="up-n">${esc(f.name)}</span><small>${esc(size(f.size || 0))}</small></a>`;
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

/* Paste and drop onto an element: calls take(fileList). */
export function catchFiles(el, take) {
  el.addEventListener("paste", (ev) => {
    const fs = Array.from((ev.clipboardData && ev.clipboardData.files) || []);
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

(function css() {
  if (document.getElementById("up-css")) return;
  const st = document.createElement("style");
  st.id = "up-css";
  st.textContent = `
.up-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
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
`;
  document.head.appendChild(st);
})();
