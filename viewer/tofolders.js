/* Exports kept in the project's Folders (00 BIM/Exports/<folder>), as well
 * as downloaded: a report, a spreadsheet, BCF, a markup PDF, a board
 * picture. After each download a small bar offers "Save to Folders"; a
 * report tab has the same button beside Print (made into a PDF on the
 * server).
 *
 * The server finds the Folders project from the viewer project
 * (POST /api/files/for-viewer/save, files.py).
 */
import { headers, project } from "./nav.js";

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Keep a file in Folders. pdf: the body is a web page, to be made a PDF.
   Returns { reg, path, name, note }; throws with the server's reason. */
export async function saveToFolders(body, name, folder, opt) {
  opt = opt || {};
  const q = new URLSearchParams({ name, folder, pdf: opt.pdf ? "1" : "0" });
  const res = await fetch("/api/files/for-viewer/save?" + q.toString(), {
    method: "POST", headers: Object.assign(headers(false), { "Content-Type": "application/octet-stream" }), body,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.detail) || "HTTP " + res.status);
  return data;
}

/* Where a kept file is opened in Folders. */
export function foldersLink(r) {
  const parts = String(r.path || "").split("/");
  const nm = parts.pop();
  return "folders.html?" + new URLSearchParams({ project: project(), reg: r.reg, path: parts.join("/"), open: nm }).toString();
}

function style(doc) {
  if (doc.getElementById("tf-style")) return;
  const s = doc.createElement("style");
  s.id = "tf-style";
  s.textContent = `#tf-bar{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;
    max-width:min(560px,calc(100vw - 24px));padding:8px 12px;border-radius:8px;background:#2b3342;color:#fff;font:12.5px system-ui,sans-serif;
    box-shadow:0 6px 24px rgba(20,26,36,.28)}
    #tf-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    #tf-bar button,#tf-bar a{font:inherit;border:1px solid #f28022;background:#f28022;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap;text-decoration:none}
    #tf-bar button.x{background:transparent;border-color:transparent;padding:4px 6px}
    @media (max-width:600px){#tf-bar{bottom:calc(66px + env(safe-area-inset-bottom))}}`;
  doc.head.appendChild(s);
}

/* After a download: "Downloaded name. [Save to Folders]" for a few seconds. */
export function offerSave(blob, name, folder) {
  if (!folder || !project()) return;
  style(document);
  let bar = document.getElementById("tf-bar");
  if (bar) bar.remove();
  bar = document.createElement("div");
  bar.id = "tf-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>Downloaded <b>${esc(name)}</b></span><button type="button" data-save title="Keep a copy in Folders > 00 BIM > Exports > ${esc(folder)}">Save to Folders</button>`
    + `<button type="button" class="x" data-x aria-label="Close">✕</button>`;
  document.body.appendChild(bar);
  let t = setTimeout(() => bar.remove(), 9000);
  bar.querySelector("[data-x]").onclick = () => bar.remove();
  bar.querySelector("[data-save]").onclick = async (ev) => {
    clearTimeout(t);
    const b = ev.target;
    b.disabled = true; b.textContent = "Saving ...";
    try {
      const r = await saveToFolders(blob, name, folder);
      bar.innerHTML = `<span>Saved in Folders: <b>${esc(r.path)}</b></span><a href="${esc(foldersLink(r))}" target="_blank" rel="noopener">Open</a>`
        + `<button type="button" class="x" data-x aria-label="Close">✕</button>`;
    } catch (e) {
      bar.innerHTML = `<span>Not saved: ${esc(e.message)}</span><button type="button" class="x" data-x aria-label="Close">✕</button>`;
    }
    bar.querySelector("[data-x]").onclick = () => bar.remove();
    t = setTimeout(() => bar.remove(), 12000);
  };
}

/* The page as one file: its pictures, drawings (canvases) and style sheets
   put inside it, so the server can make it a PDF without asking back. */
async function selfContained(doc) {
  const copy = doc.documentElement.cloneNode(true);
  // canvases (pdf.js drawings) lose their pixels in a copy: pictures of them
  const cs = [...doc.querySelectorAll("canvas")], cc = [...copy.querySelectorAll("canvas")];
  cc.forEach((c, i) => {
    try { const img = doc.createElement("img"); img.src = cs[i].toDataURL("image/jpeg", 0.85); img.style.cssText = cs[i].style.cssText; img.width = cs[i].width; c.replaceWith(img); } catch (e) {}
  });
  copy.querySelectorAll(".bar, .noprint, [data-noprint], script").forEach((x) => x.remove());
  const asData = async (url) => {
    const b = await (await fetch(url, { credentials: "same-origin" })).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(url); r.readAsDataURL(b); });
  };
  for (const img of copy.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (/^data:/.test(src)) continue;
    try { img.setAttribute("src", await asData(new URL(src, doc.baseURI).href)); } catch (e) {}
  }
  for (const l of copy.querySelectorAll('link[rel="stylesheet"][href]')) {
    try {
      const css = await (await fetch(new URL(l.getAttribute("href"), doc.baseURI).href)).text();
      const s = doc.createElement("style");
      s.textContent = css;
      l.replaceWith(s);
    } catch (e) { l.remove(); }
  }
  // LibreOffice reads a page's own table and picture settings better than its CSS
  for (const tb of copy.querySelectorAll("table")) {
    if (!tb.hasAttribute("border")) { tb.setAttribute("border", "1"); tb.setAttribute("cellspacing", "0"); tb.setAttribute("cellpadding", "4"); }
    if (!tb.hasAttribute("width")) tb.setAttribute("width", "100%");
  }
  for (const img of copy.querySelectorAll("img")) if (!img.hasAttribute("width") || Number(img.getAttribute("width")) > 640) img.setAttribute("width", "640");
  return "<!doctype html>\n" + copy.outerHTML;
}

/* A report in its own tab (checkexport.writeReport, report.html): a
   "Save to Folders (PDF)" button in its bar. The page sent is the report
   as shown, without the bar. */
export function reportSaveButton(doc, btn, name, folder) {
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Saving ...";
    try {
      const html = await selfContained(doc);
      const r = await saveToFolders(new Blob([html], { type: "text/html" }), name, folder, { pdf: true });
      btn.textContent = "Saved";
      const a = doc.createElement("a");
      a.href = new URL(foldersLink(r), location.href).href;
      a.target = "_blank";
      a.textContent = (r.note ? r.note + ": " : "In Folders: ") + r.path;
      a.style.cssText = "margin-left:8px;color:#1e6fd9";
      btn.after(a);
    } catch (e) {
      btn.textContent = was;
      btn.disabled = false;
      doc.defaultView.alert("Not saved: " + e.message);
    }
  };
}
