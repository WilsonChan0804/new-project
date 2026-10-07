/* Folders page (server side: files.py).
 *
 * A project's files, in its folder on the server: browse, upload (drop
 * files or whole folders), make folders, rename, move (drag onto a folder),
 * delete (to a bin, Ctrl+Z brings it back), preview PDFs and pictures, pin
 * documents for everyone (project admins) and star them for yourself.
 * A PDF can be sent to the Sheets page as a set of sheets. A project's
 * folder tree can be saved as a template and laid out in another project.
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, modal, toast, pop, closePop } from "./tasks-util.js";
import * as Undo from "./undo.js";

const F = {
  projects: [], siteAdmin: false, reg: "", proj: null,
  path: "", items: [], admin: false, me: null,
  mode: "folder",          // folder | pinned | starred | recent | bin | search
  q: "", sel: new Set(), last: null,
  tree: [], open: new Set([""]), quick: { pinned: [], starred: [], recent: [] },
};
const LS = "lwk-viewer:folders:";
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} };

const base = () => `/api/files/${encodeURIComponent(F.reg)}`;
const post = (path, body) => api(base() + path, { method: "POST", body: JSON.stringify(body || {}) });
const fileUrl = (p, dl) => `${base()}/file?path=${encodeURIComponent(p)}${dl ? "&download=1" : ""}`;
const parentOf = (p) => p.split("/").slice(0, -1).join("/");
const nameOf = (p) => p.split("/").pop();

const ICON = { pdf: "&#128213;", dwg: "&#128208;", dxf: "&#128208;", rvt: "&#127959;", ifc: "&#127959;", nwd: "&#127959;", skp: "&#127959;",
  xlsx: "&#128202;", xls: "&#128202;", csv: "&#128202;", docx: "&#128221;", doc: "&#128221;", pptx: "&#128202;", txt: "&#128196;",
  zip: "&#128230;", rar: "&#128230;", "7z": "&#128230;", mp4: "&#127916;", mov: "&#127916;", mp3: "&#127925;",
  jpg: "&#128444;", jpeg: "&#128444;", png: "&#128444;", gif: "&#128444;", webp: "&#128444;", heic: "&#128444;", svg: "&#128444;" };
const extOf = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");
const iconOf = (e) => (e.dir ? "&#128193;" : ICON[extOf(e.name)] || "&#128196;");
const isPdf = (e) => !e.dir && extOf(e.name) === "pdf";
const PREVIEW = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "csv", "mp4", "webm", "mp3", "json"]);

function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i];
}
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const same = d.toDateString() === new Date().toDateString();
  return same ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/* ------------------------------------------------------------ loading */

async function loadProjects() {
  const r = await api("/api/files/projects");
  F.projects = r.projects;
  F.siteAdmin = r.site_admin;
  const q = new URLSearchParams(location.search);
  const viewer = q.get("project");
  let reg = q.get("reg") || "";
  if (!reg && viewer) { const p = F.projects.find((x) => x.parts.includes(viewer)); if (p) reg = p.id; }
  if (!F.projects.some((p) => p.id === reg)) reg = lsGet("reg", "");
  if (!F.projects.some((p) => p.id === reg)) reg = F.projects.length ? F.projects[0].id : "";
  $("#fo-proj").innerHTML = F.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.code && p.code !== p.name ? " · " + esc(p.code) : ""}</option>`).join("");
  return reg;
}

async function openProject(reg, path) {
  F.reg = reg;
  F.proj = F.projects.find((p) => p.id === reg) || null;
  $("#fo-proj").value = reg;
  lsSet("reg", reg);
  F.open = new Set([""]);
  await Promise.all([loadTree(), loadQuick()]);
  await go(path || "");
}

async function loadTree() {
  try { F.tree = (await api(base() + "/tree")).folders; } catch (e) { F.tree = []; }
  paintTree();
}

async function loadQuick() {
  try { F.quick = await api(base() + "/quick"); } catch (e) { F.quick = { pinned: [], starred: [], recent: [] }; }
  $("#fo-n-pinned").textContent = F.quick.pinned.length || "";
  $("#fo-n-starred").textContent = F.quick.starred.length || "";
}

/* a folder */
async function go(path, keepSel) {
  F.mode = "folder";
  F.path = path;
  if (!keepSel) F.sel.clear();
  $("#fo-search").value = "";
  try {
    const r = await api(`${base()}/list?path=${encodeURIComponent(path)}`);
    F.items = r.items;
    F.admin = r.admin;
    F.me = r.me;
    F.path = r.path;
  } catch (e) {
    if (path) return go(parentOf(path));
    F.items = [];
    $("#fo-list").innerHTML = `<div class="fo-empty"><b>The folder cannot be opened</b>${esc(e.message)}</div>`;
    return;
  }
  for (let p = F.path; p; p = parentOf(p)) F.open.add(p);
  const u = new URL(location.href);
  u.searchParams.set("reg", F.reg);
  u.searchParams.delete("project");
  if (F.path) u.searchParams.set("path", F.path); else u.searchParams.delete("path");
  window.history.replaceState(null, "", u);
  paint();
  paintTree();
}

async function showQuick(kind) {
  F.mode = kind;
  F.sel.clear();
  if (kind === "bin") {
    try { F.items = (await api(base() + "/bin")).items.map((b) => Object.assign({ name: nameOf(b.path), bin: true }, b)); }
    catch (e) { F.items = []; toast(e.message, true); }
  } else {
    await loadQuick();
    F.items = F.quick[kind] || [];
  }
  paint();
  paintTree();
}

async function search(q) {
  F.q = q;
  if (!q.trim()) return go(F.path);
  F.mode = "search";
  const r = await api(`${base()}/search?q=${encodeURIComponent(q)}`);
  if (F.q !== q) return;
  F.items = r.items;
  F.sel.clear();
  paint();
}

const refresh = async () => {
  if (F.mode === "folder") await go(F.path, true);
  else if (F.mode === "search") await search(F.q);
  else await showQuick(F.mode);
  loadQuick();
};

/* ------------------------------------------------------------ painting */

function paintCrumbs() {
  const c = $("#fo-crumbs");
  const titles = { pinned: "Pinned", starred: "Starred", recent: "Recent files", bin: "Recently deleted", search: `Search: "${F.q}"` };
  if (F.mode !== "folder") { c.innerHTML = `<a href="#" data-go="">${esc(F.proj ? F.proj.name : "Files")}</a><span class="sep">&rsaquo;</span><a>${esc(titles[F.mode])}</a>`; return; }
  const parts = F.path ? F.path.split("/") : [];
  let h = `<a href="#" data-go="" class="fo-drop-t" data-path="">${esc(F.proj ? F.proj.name : "Files")}</a>`;
  parts.forEach((p, i) => {
    const at = parts.slice(0, i + 1).join("/");
    h += `<span class="sep">&rsaquo;</span><a href="#" data-go="${esc(at)}" class="fo-drop-t" data-path="${esc(at)}">${esc(p)}</a>`;
  });
  c.innerHTML = h;
}

function paint() {
  paintCrumbs();
  for (const b of document.querySelectorAll(".fo-quick button")) b.classList.toggle("on", b.dataset.q === F.mode);
  const list = $("#fo-list");
  const elsewhere = F.mode !== "folder";
  if (!F.items.length) {
    const msg = {
      folder: ["This folder is empty", "Drop files here, or use Upload. + Folder makes a folder."],
      pinned: ["Nothing pinned yet", F.admin ? "Pin key documents with ⋯ > Pin for everyone - they show here for the whole team." : "Project admins pin the key documents here for everyone."],
      starred: ["Nothing starred", "Star the files you open often (⋯ > Star): they are listed here, for you only."],
      recent: ["No files yet", ""], bin: ["The bin is empty", "Deleted files and folders wait here, so they can be put back."],
      search: ["Nothing found", "Names are searched, in every folder of this project."],
    }[F.mode];
    list.innerHTML = `<div class="fo-empty"><b>${esc(msg[0])}</b>${esc(msg[1])}</div>`;
    return;
  }
  let h = `<div class="fo-head"><span></span><span>Name</span><span>${F.mode === "bin" ? "Deleted" : "Modified"}</span><span class="c-size">Size</span><span class="c-by">${F.mode === "bin" ? "Deleted by" : "Uploaded by"}</span><span></span></div>`;
  for (const e of F.items) {
    const where = elsewhere && parentOf(e.path) ? `<span class="fo-where">${esc(parentOf(e.path))}</span>` : "";
    const flags = (e.pinned ? `<span class="flags" title="Pinned for everyone">&#128204;</span>` : "") + (e.starred ? `<span class="flags" title="Starred">&#11088;</span>` : "");
    h += `<div class="fo-row${F.sel.has(e.path) ? " sel" : ""}${e.dir ? " fo-drop-t" : ""}" data-path="${esc(e.path)}" draggable="${!e.bin}"${e.bin ? ` data-bin="${esc(e.id)}"` : ""}>`
      + `<span class="ico">${iconOf(e)}</span>`
      + `<span><span class="nm" data-open>${esc(e.name)}</span>${e.dir && e.count != null ? `<small class="muted"> ${e.count} item${e.count === 1 ? "" : "s"}</small>` : ""}${flags}${where}</span>`
      + `<span class="muted">${esc(when(e.bin ? e.at : e.mtime))}</span>`
      + `<span class="muted c-size">${e.dir ? "" : esc(size(e.size))}</span>`
      + `<span class="muted c-by">${esc(e.by || "")}</span>`
      + `<button class="fo-dots" data-dots title="More">&#8943;</button></div>`;
  }
  list.innerHTML = h;
}

/* the selection only: rows stay as they are (a double click needs that) */
function paintSel() {
  for (const r of document.querySelectorAll("#fo-list .fo-row")) r.classList.toggle("sel", F.sel.has(r.dataset.path));
}

function paintTree() {
  const kids = new Map();
  for (const f of F.tree) {
    const p = parentOf(f);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(f);
  }
  const node = (p, label) => {
    const ks = kids.get(p) || [];
    const open = F.open.has(p);
    return `<div class="fo-node${open ? " open" : ""}" data-node="${esc(p)}">`
      + `<button class="fo-nl fo-drop-t${F.mode === "folder" && F.path === p ? " on" : ""}" data-path="${esc(p)}">`
      + `<span class="tw" data-tw>${ks.length ? "&#9654;" : ""}</span><span>&#128193;</span><span class="nm">${esc(label)}</span></button>`
      + (ks.length && open ? `<div class="fo-kids">${ks.map((k) => node(k, nameOf(k))).join("")}</div>` : "")
      + `</div>`;
  };
  $("#fo-tree").innerHTML = node("", F.proj ? F.proj.name : "Files");
}

/* ------------------------------------------------------------ opening */

function openItem(e) {
  if (e.bin) return;
  if (e.dir) return go(e.path);
  if (PREVIEW.has(extOf(e.name))) return preview(e);
  location.href = fileUrl(e.path, true);
}

function preview(e) {
  const box = $("#fo-prev");
  const ext = extOf(e.name);
  const url = fileUrl(e.path);
  let body;
  if (ext === "pdf" || ext === "txt" || ext === "csv" || ext === "json") body = `<iframe src="${esc(url)}" title="${esc(e.name)}"></iframe>`;
  else if (["mp4", "webm"].includes(ext)) body = `<video src="${esc(url)}" controls></video>`;
  else if (ext === "mp3") body = `<audio src="${esc(url)}" controls></audio>`;
  else body = `<img src="${esc(url)}" alt="${esc(e.name)}">`;
  box.innerHTML = `<div class="pv-bar"><b title="${esc(e.path)}">${esc(e.name)}</b>`
    + (isPdf(e) ? `<button class="ghost" data-pv="sheets" title="Add its pages to a set on the Sheets page">To Sheets</button>` : "")
    + `<a class="ghost btn" href="${esc(url)}" target="_blank" rel="noopener" title="Open in a new tab">&#8599;</a>`
    + `<a class="ghost btn" href="${esc(fileUrl(e.path, true))}" title="Download">&#11015;</a>`
    + `<button class="ghost" data-pv="x" title="Close">&times;</button></div><div class="pv-body">${body}</div>`;
  box.hidden = false;
  box.onclick = (ev) => {
    const b = ev.target.closest("[data-pv]");
    if (!b) return;
    if (b.dataset.pv === "x") { box.hidden = true; box.innerHTML = ""; }
    if (b.dataset.pv === "sheets") toSheets(e);
  };
}

/* ------------------------------------------------------------ changes */

async function newFolder() {
  if (F.mode !== "folder") await go(F.path);
  const f = await modal("New folder", `<label>Name <input name="n" maxlength="200" placeholder="e.g. 02 Drawings"></label>`
    + `<p class="muted" style="font-size:12px;margin:6px 0 0">In ${esc(F.path || (F.proj ? F.proj.name : ""))}</p>`, "Make");
  if (!f || !f.n.value.trim()) return;
  try {
    const r = await post("/mkdir", { path: F.path, name: f.n.value.trim() });
    Undo.record({ label: `new folder "${f.n.value.trim()}"`, undo: async () => { await post("/delete", { paths: [r.path] }); await afterChange(); },
      redo: async () => { await post("/mkdir", { path: parentOf(r.path), name: nameOf(r.path) }); await afterChange(); } });
    await afterChange();
  } catch (e) { toast(e.message, true); }
}

async function afterChange() {
  await Promise.all([loadTree(), refresh()]);
}

async function rename(e) {
  const f = await modal("Rename", `<label>Name <input name="n" maxlength="200" value="${esc(e.name)}"></label>`, "Rename");
  if (!f) return;
  const nm = f.n.value.trim();
  if (!nm || nm === e.name) return;
  try {
    const r = await post("/rename", { path: e.path, name: nm });
    const back = { path: r.path, name: e.name }, again = { path: e.path, name: nm };
    Undo.record({ label: `renamed "${e.name}"`, undo: async () => { await post("/rename", back); await afterChange(); },
      redo: async () => { await post("/rename", again); await afterChange(); } });
    await afterChange();
  } catch (err) { toast(err.message, true); }
}

async function move(paths, to) {
  paths = paths.filter((p) => p !== to && parentOf(p) !== to && !to.startsWith(p + "/"));
  if (!paths.length) return;
  try {
    const r = await post("/move", { paths, to });
    const moved = r.moved;
    Undo.record({ label: `moved ${moved.length === 1 ? `"${nameOf(moved[0].from)}"` : moved.length + " items"}`,
      undo: async () => { for (const m of moved) await post("/move", { paths: [m.path], to: parentOf(m.from) }); await afterChange(); },
      redo: async () => { for (const m of moved) await post("/move", { paths: [m.from], to }); await afterChange(); } });
    toast(`Moved to ${to || (F.proj ? F.proj.name : "the top")}`);
    await afterChange();
  } catch (e) { toast(e.message, true); }
}

async function chooseFolder(title, start) {
  let at = start || "";
  const list = () => [""].concat(F.tree).map((f) => `<div data-f="${esc(f)}" class="${f === at ? "on" : ""}" style="padding-left:${8 + (f ? f.split("/").length : 0) * 14}px">&#128193; ${esc(f ? nameOf(f) : (F.proj ? F.proj.name : "Top"))}</div>`).join("");
  const p = modal(title, `<div class="fo-pick">${list()}</div>`, "Move here");
  setTimeout(() => {
    const box = document.querySelector(".t-modal .fo-pick");
    if (box) box.onclick = (ev) => { const d = ev.target.closest("[data-f]"); if (!d) return; at = d.dataset.f; box.innerHTML = list(); };
  }, 30);
  return (await p) ? at : null;
}

async function remove(paths) {
  if (!paths.length) return;
  const n = paths.length;
  if (!confirm(n === 1 ? `Delete "${nameOf(paths[0])}"?\n\nIt goes to Recently deleted, from where it can be put back.` : `Delete ${n} items?\n\nThey go to Recently deleted, from where they can be put back.`)) return;
  try {
    const r = await post("/delete", { paths });
    const ids = r.deleted.map((x) => x.id);
    let again = paths;
    Undo.record({ label: `deleted ${n === 1 ? `"${nameOf(paths[0])}"` : n + " items"}`,
      undo: async () => { const x = await post("/restore", { ids }); again = x.restored.map((y) => y.path); await afterChange(); },
      redo: async () => { const x = await post("/delete", { paths: again }); ids.splice(0, ids.length, ...x.deleted.map((y) => y.id)); await afterChange(); } });
    toast(n === 1 ? "Deleted - Ctrl+Z to undo" : `${n} deleted - Ctrl+Z to undo`);
    F.sel.clear();
    await afterChange();
  } catch (e) { toast(e.message, true); }
}

async function restore(ids) {
  try {
    const r = await post("/restore", { ids });
    toast(r.restored.length === 1 ? `Put back in ${parentOf(r.restored[0].path) || "the top folder"}` : `${r.restored.length} put back`);
    await afterChange();
  } catch (e) { toast(e.message, true); }
}

async function pin(e, on) {
  try { await post("/pin", { path: e.path, on }); toast(on ? "Pinned for everyone in the project" : "Unpinned"); await refresh(); }
  catch (err) { toast(err.message, true); }
}
async function star(e, on) {
  try { await post("/star", { path: e.path, on }); toast(on ? "Starred - see Starred on the left" : "Star taken off"); await refresh(); }
  catch (err) { toast(err.message, true); }
}

function copyLink(e) {
  const u = new URL("folders.html", location.href);
  u.searchParams.set("reg", F.reg);
  u.searchParams.set("path", e.dir ? e.path : parentOf(e.path));
  if (!e.dir) u.searchParams.set("open", e.name);
  navigator.clipboard.writeText(u.href).then(() => toast("Link copied - only the project's people can open it"), () => prompt("Copy this link", u.href));
}

/* ------------------------------------------------------------ to the Sheets page */

let pdfjsReady = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsReady) pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = () => rej(new Error("The PDF reader did not load"));
    document.head.appendChild(s);
  });
  return pdfjsReady;
}

async function toSheets(e) {
  const parts = (F.proj && F.proj.parts) || [];
  if (!parts.length) { toast("This project has no Sheets page yet (no viewer project linked on the Projects page)", true); return; }
  let sets = [];
  try {
    const m = await (await fetch(`/data/${encodeURIComponent(parts[0])}/manifest.json`, { cache: "no-store" })).json();
    sets = [...new Set((m.sheets || []).filter((s) => s.set).map((s) => s.set))];
  } catch (err) {}
  const stem = e.name.replace(/\.pdf$/i, "");
  const f = await modal("Add to the Sheets page", `<p class="muted" style="margin:0 0 8px;font-size:12px">Each page of <b>${esc(e.name)}</b> becomes a sheet, in a set of its own in the drop-down at the top of the Sheets page.</p>`
    + (parts.length > 1 ? `<label>Sheets of <select name="p">${parts.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>` : "")
    + `<label>Set <input name="s" list="fo-sets" value="${esc(sets[0] || "Uploaded PDFs")}" maxlength="60"></label><datalist id="fo-sets">${sets.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`
    + `<label>Sheet number (pages are numbered after it) <input name="n" value="${esc(stem.slice(0, 24))}" maxlength="40"></label>`, "Add");
  if (!f) return;
  const project = f.p ? f.p.value : parts[0];
  const set = f.s.value.trim() || "Uploaded PDFs";
  const prefix = f.n.value.trim() || stem.slice(0, 24);
  toast("Adding to the Sheets page ...");
  try {
    const lib = await loadPdfJs();
    const buf = await (await fetch(fileUrl(e.path))).arrayBuffer();
    const doc = await lib.getDocument({ data: buf }).promise;
    const pages = doc.numPages;
    let labels = null;
    try { labels = await doc.getPageLabels(); } catch (err) {}
    const up = await post("/to-sheets", { path: e.path, project });
    const sheets = [];
    for (let p = 1; p <= pages; p++) {
      const label = labels && labels[p - 1];
      sheets.push({ number: pages === 1 ? prefix : `${prefix}-${label || String(p).padStart(2, "0")}`, name: stem + (pages > 1 ? " p" + p : ""), pdf: up.pdf, page: p });
    }
    const r = await api("/api/import/sheets", { method: "POST", headers: { "X-Project": project }, body: JSON.stringify({ sheets, set }) });
    const n = (r.added || []).length;
    const go2 = `index.html?project=${encodeURIComponent(project)}&set=${encodeURIComponent(set)}`;
    const t = document.createElement("div");
    t.className = "t-toast on";
    t.innerHTML = `${n} sheet${n === 1 ? "" : "s"} added to "${esc(set)}" - <a href="${esc(go2)}" style="color:#fdba74;font-weight:600">open the Sheets page</a>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 8000);
  } catch (err) { toast(err.message, true); }
}

/* ------------------------------------------------------------ uploads */

const queue = [];
let uploading = false;

function addUploads(files, to) {
  for (const f of files) queue.push({ file: f, to, name: f.relPath || f.webkitRelativePath || f.name, pct: 0, state: "wait" });
  paintProg();
  if (!uploading) runUploads();
}

function paintProg() {
  const box = $("#fo-prog");
  const live = queue.filter((x) => x.state !== "gone");
  box.hidden = !live.length;
  const done = live.filter((x) => x.state === "done").length;
  box.innerHTML = `<b>Uploading ${done} of ${live.length}</b>` + live.slice(-6).map((x) => `<div class="pg${x.state === "bad" ? " bad" : ""}"><div class="pg-n"><span>${esc(x.name)}</span><span class="muted">${x.state === "bad" ? esc(x.err || "failed") : x.state === "done" ? "done" : Math.round(x.pct) + "%"}</span></div><div class="pg-b"><i style="width:${x.state === "done" ? 100 : x.pct}%"></i></div></div>`).join("");
}

function sendOne(x) {
  return new Promise((res) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base()}/upload?path=${encodeURIComponent(x.to)}&name=${encodeURIComponent(x.name)}`);
    try { xhr.setRequestHeader("X-Viewer-Token", localStorage.getItem("lwk-viewer:token") || ""); } catch (e) {}
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) { x.pct = ev.loaded / ev.total * 100; paintProg(); } };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { x.state = "done"; try { x.res = JSON.parse(xhr.responseText); } catch (e) {} }
      else { x.state = "bad"; try { x.err = JSON.parse(xhr.responseText).detail; } catch (e) { x.err = "HTTP " + xhr.status; } }
      res();
    };
    xhr.onerror = () => { x.state = "bad"; x.err = "No connection"; res(); };
    xhr.send(x.file);
  });
}

async function runUploads() {
  uploading = true;
  const batch = [];
  let x;
  while ((x = queue.find((q) => q.state === "wait"))) {
    x.state = "up";
    paintProg();
    await sendOne(x);
    batch.push(x);
    paintProg();
  }
  uploading = false;
  const ok = batch.filter((b) => b.state === "done" && b.res);
  if (ok.length) {
    const paths = ok.map((b) => b.res.path);
    let ids = [];
    Undo.record({ label: `uploaded ${ok.length === 1 ? `"${ok[0].res.name}"` : ok.length + " files"}`,
      undo: async () => { ids = (await post("/delete", { paths })).deleted.map((d) => d.id); await afterChange(); },
      redo: async () => { await post("/restore", { ids }); await afterChange(); } });
    await afterChange();
  }
  setTimeout(() => {
    for (const q of queue) if (q.state === "done") q.state = "gone";
    paintProg();
  }, 2500);
}

/* folders dropped whole: every file inside, with its path */
async function filesFrom(dt) {
  const out = [];
  const items = dt.items ? [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean) : [];
  if (!items.length) return [...dt.files];
  const walk = async (entry, pre) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      f.relPath = pre + f.name;
      out.push(f);
    } else if (entry.isDirectory) {
      const rd = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => rd.readEntries(res, rej));
        for (const e of batch) await walk(e, pre + entry.name + "/");
      } while (batch.length);
    }
  };
  for (const e of items) await walk(e, "");
  return out;
}

/* ------------------------------------------------------------ templates and location */

async function moreMenu(btn) {
  const rows = [];
  if (F.admin) rows.push(["savetpl", "Save these folders as a template"], ["applytpl", "Lay out folders from a template"]);
  else rows.push(["applytpl-x", "Folder templates (project admins)"]);
  rows.push(["updir", "Upload a whole folder"]);
  if (F.siteAdmin) rows.push(["root", "Folder on the server ..."]);
  const el = pop(btn, rows.map(([k, t]) => `<div class="po-row" data-k="${k}">${esc(t)}</div>`).join(""), 270);
  el.onclick = async (ev) => {
    const r = ev.target.closest("[data-k]");
    if (!r) return;
    closePop();
    const k = r.dataset.k;
    if (k === "savetpl") return saveTemplate();
    if (k === "applytpl") return applyTemplate();
    if (k === "applytpl-x") return toast("Saving and laying out folder templates is for project admins", true);
    if (k === "updir") return $("#fo-dir").click();
    if (k === "root") return setRoot();
  };
}

async function saveTemplate() {
  const f = await modal("Save as a template", `<p class="muted" style="margin:0 0 8px;font-size:12px">The folders of ${esc(F.proj.name)} (${F.tree.length}), without their files, saved by name - to lay out the same folders in another project.</p><label>Template name <input name="n" maxlength="80" placeholder="e.g. LWK standard project folders"></label>`, "Save");
  if (!f || !f.n.value.trim()) return;
  try { await post("/template", { name: f.n.value.trim() }); toast("Template saved"); } catch (e) { toast(e.message, true); }
}

async function applyTemplate() {
  let ts = [];
  try { ts = (await api("/api/files/templates")).templates; } catch (e) { toast(e.message, true); return; }
  if (!ts.length) { toast("No templates yet - open a project with good folders and Save these folders as a template", true); return; }
  const f = await modal("Lay out folders from a template", `<p class="muted" style="margin:0 0 4px;font-size:12px">The folders missing in <b>${esc(F.path || F.proj.name)}</b> are made. Nothing is deleted, moved or renamed.</p>`
    + `<div class="fo-tpl">${ts.map((t, i) => `<label><input type="radio" name="t" value="${esc(t.id)}"${i ? "" : " checked"}> <span><b>${esc(t.name)}</b><br><small>${t.folders.length} folders · by ${esc(t.by)} · ${esc(t.folders.filter((x) => !x.includes("/")).slice(0, 6).join(", "))}</small></span></label>`).join("")}</div>`, "Make the folders");
  if (!f) return;
  const id = [...f.querySelectorAll("input[name=t]")].find((x) => x.checked).value;
  try {
    const r = await post("/apply-template", { id, path: F.path });
    toast(r.made ? `${r.made} folder${r.made === 1 ? "" : "s"} made` : "All the template's folders were already here");
    await afterChange();
  } catch (e) { toast(e.message, true); }
}

async function setRoot() {
  let cur;
  try { cur = await api(base() + "/root"); } catch (e) { toast(e.message, true); return; }
  const f = await modal("Folder on the server", `<p class="muted" style="margin:0 0 8px;font-size:12px">Where ${esc(F.proj.name)}'s files are kept, as the <b>server</b> sees it: a drive of the VM, or a network share the server's account can reach. Files already there show up as they are. Empty = the default:<br><code>${esc(cur.default)}</code></p>`
    + `<label>Path <input name="p" value="${esc(cur.path)}" placeholder="D:\\Projects\\SKW  or  \\\\fileserver\\projects\\SKW"></label>`, "Save");
  if (!f) return;
  try { await api(base() + "/root", { method: "PUT", body: JSON.stringify({ path: f.p.value.trim() }) }); toast("Saved"); await openProject(F.reg, ""); }
  catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ the menus */

function itemMenu(e, x, y) {
  const many = F.sel.size > 1 && F.sel.has(e.path);
  const paths = many ? [...F.sel] : [e.path];
  if (e.bin) {
    const el = pop({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) },
      e.can_restore ? `<div class="po-row" data-k="restore">Put back</div>` : `<div class="po-row muted">Only who deleted it, or a project admin, can put it back</div>`, 240);
    el.onclick = (ev) => { if (ev.target.closest("[data-k=restore]")) { closePop(); restore(many ? F.items.filter((i) => F.sel.has(i.path)).map((i) => i.id) : [e.id]); } };
    return;
  }
  const rows = many ? [["move", `Move ${paths.length} items to ...`], ["delete", `Delete ${paths.length} items`]] : [
    ["open", e.dir ? "Open" : PREVIEW.has(extOf(e.name)) ? "Preview" : "Download"],
    ...(e.dir ? [] : [["download", "Download"]]),
    ...(isPdf(e) ? [["sheets", "Add to the Sheets page ..."]] : []),
    ["star", e.starred ? "Take the star off" : "Star (for me)"],
    ...(F.admin ? [["pin", e.pinned ? "Unpin" : "Pin for everyone"]] : []),
    ["link", "Copy link"],
    ...(F.mode !== "folder" ? [["where", "Show in its folder"]] : []),
    ["rename", "Rename"], ["move", "Move to ..."], ["delete", "Delete"],
  ];
  const el = pop({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) },
    rows.map(([k, t]) => `<div class="po-row${k === "delete" ? " bad" : ""}" data-k="${k}">${esc(t)}</div>`).join(""), 230);
  el.onclick = async (ev) => {
    const r = ev.target.closest("[data-k]");
    if (!r) return;
    closePop();
    const k = r.dataset.k;
    if (k === "open") openItem(e);
    else if (k === "download") location.href = fileUrl(e.path, true);
    else if (k === "sheets") toSheets(e);
    else if (k === "star") star(e, !e.starred);
    else if (k === "pin") pin(e, !e.pinned);
    else if (k === "link") copyLink(e);
    else if (k === "where") { await go(parentOf(e.path)); F.sel = new Set([e.path]); paint(); }
    else if (k === "rename") rename(e);
    else if (k === "move") { const to = await chooseFolder(paths.length === 1 ? `Move "${e.name}" to` : `Move ${paths.length} items to`, parentOf(e.path)); if (to !== null) move(paths, to); }
    else if (k === "delete") remove(paths);
  };
}

/* ------------------------------------------------------------ wiring */

function wire() {
  $("#fo-proj").onchange = (ev) => openProject(ev.target.value, "");
  $("#fo-side").addEventListener("click", (ev) => {
    const q = ev.target.closest("[data-q]");
    if (q) { document.body.classList.remove("fo-side-open"); return showQuick(q.dataset.q); }
    const nl = ev.target.closest(".fo-nl");
    if (!nl) return;
    const p = nl.dataset.path;
    if (ev.target.closest("[data-tw]") && p !== "") { F.open.has(p) ? F.open.delete(p) : F.open.add(p); return paintTree(); }
    F.open.add(p);
    document.body.classList.remove("fo-side-open");
    go(p);
  });
  $("#fo-side-open").onclick = () => document.body.classList.toggle("fo-side-open");
  $("#fo-crumbs").onclick = (ev) => { const a = ev.target.closest("[data-go]"); if (!a) return; ev.preventDefault(); go(a.dataset.go); };
  let t = null;
  $("#fo-search").oninput = (ev) => { clearTimeout(t); t = setTimeout(() => search(ev.target.value).catch((e) => toast(e.message, true)), 300); };
  $("#fo-newdir").onclick = newFolder;
  $("#fo-up").onclick = () => $("#fo-file").click();
  $("#fo-more").onclick = (ev) => moreMenu(ev.currentTarget);
  $("#fo-file").onchange = (ev) => { addUploads([...ev.target.files], F.mode === "folder" ? F.path : ""); ev.target.value = ""; };
  $("#fo-dir").onchange = (ev) => { addUploads([...ev.target.files], F.mode === "folder" ? F.path : ""); ev.target.value = ""; };

  const list = $("#fo-list");
  const itemOf = (row) => row && F.items.find((i) => i.path === row.dataset.path);
  list.addEventListener("click", (ev) => {
    const row = ev.target.closest(".fo-row");
    if (!row) { F.sel.clear(); paintSel(); return; }
    const e = itemOf(row);
    if (ev.target.closest("[data-dots]")) { const r = ev.target.getBoundingClientRect(); return itemMenu(e, r.left - 200, r.bottom); }
    if (ev.target.closest("[data-open]") && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) return openItem(e);
    if (ev.ctrlKey || ev.metaKey) { F.sel.has(e.path) ? F.sel.delete(e.path) : F.sel.add(e.path); }
    else if (ev.shiftKey && F.last) {
      const a = F.items.findIndex((i) => i.path === F.last), b = F.items.indexOf(e);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) F.sel.add(F.items[i].path);
    } else F.sel = new Set([e.path]);
    F.last = e.path;
    paintSel();
  });
  list.addEventListener("dblclick", (ev) => { const e = itemOf(ev.target.closest(".fo-row")); if (e) openItem(e); });
  list.addEventListener("contextmenu", (ev) => {
    const e = itemOf(ev.target.closest(".fo-row"));
    if (!e) return;
    ev.preventDefault();
    if (!F.sel.has(e.path)) { F.sel = new Set([e.path]); paintSel(); }
    itemMenu(e, ev.clientX, ev.clientY);
  });
  list.addEventListener("keydown", (ev) => {
    if (ev.target.closest("input, textarea")) return;
    const sel = F.items.filter((i) => F.sel.has(i.path) && !i.bin);
    if (ev.key === "Delete" && sel.length) { ev.preventDefault(); remove(sel.map((i) => i.path)); }
    else if (ev.key === "F2" && sel.length === 1) { ev.preventDefault(); rename(sel[0]); }
    else if (ev.key === "Enter" && sel.length === 1) { ev.preventDefault(); openItem(sel[0]); }
    else if (ev.key === "Backspace" && F.mode === "folder" && F.path) { ev.preventDefault(); go(parentOf(F.path)); }
  });

  /* drag rows onto folders (the list, the tree, the path at the top) to move them */
  let drag = null;
  document.addEventListener("dragstart", (ev) => {
    const row = ev.target.closest && ev.target.closest(".fo-row");
    if (!row || row.dataset.bin) return;
    if (!F.sel.has(row.dataset.path)) { F.sel = new Set([row.dataset.path]); paintSel(); }
    drag = [...F.sel];
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/x-lwk-files", JSON.stringify(drag));
  });
  document.addEventListener("dragend", () => { drag = null; for (const x of document.querySelectorAll(".drop")) x.classList.remove("drop"); });
  const target = (ev) => ev.target.closest && ev.target.closest(".fo-drop-t");
  let depth = 0;
  const dropBox = $("#fo-drop");
  const outside = (ev) => !drag && ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  $("#fo").addEventListener("dragenter", (ev) => {
    if (!outside(ev) || F.mode !== "folder") return;
    depth++;
    $("#fo-drop-to").textContent = F.path || (F.proj ? F.proj.name : "");
    dropBox.hidden = false;
  });
  $("#fo").addEventListener("dragleave", (ev) => { if (outside(ev) && --depth <= 0) { depth = 0; dropBox.hidden = true; } });
  $("#fo").addEventListener("dragover", (ev) => {
    const tg = target(ev);
    for (const x of document.querySelectorAll(".drop")) if (x !== tg) x.classList.remove("drop");
    if (drag) {
      if (tg && !drag.includes(tg.dataset.path)) { ev.preventDefault(); tg.classList.add("drop"); }
      return;
    }
    if (outside(ev)) {
      ev.preventDefault();
      if (tg && tg.classList.contains("fo-row")) { tg.classList.add("drop"); $("#fo-drop-to").textContent = tg.dataset.path; }
      else $("#fo-drop-to").textContent = F.path || (F.proj ? F.proj.name : "");
    }
  });
  $("#fo").addEventListener("drop", async (ev) => {
    const tg = target(ev);
    depth = 0;
    dropBox.hidden = true;
    for (const x of document.querySelectorAll(".drop")) x.classList.remove("drop");
    if (drag) {
      ev.preventDefault();
      const paths = drag;
      drag = null;
      if (tg) move(paths, tg.dataset.path);
      return;
    }
    if (!outside(ev)) return;
    ev.preventDefault();
    if (F.mode !== "folder") { toast("Open a folder first, then drop the files on it", true); return; }
    const to = tg && tg.classList.contains("fo-row") ? tg.dataset.path : F.path;
    const files = await filesFrom(ev.dataTransfer);
    if (files.length) addUploads(files, to);
  });
}

async function start() {
  const me = await ensureSignedIn();
  header(me);
  if (!me.accounts) {
    $("#fo").innerHTML = `<div class="fo-empty" style="flex:1"><b>Folders need accounts</b>A site admin can switch accounts on (Admin page).</div>`;
    return;
  }
  wire();
  const reg = await loadProjects();
  if (!reg) {
    $("#fo-list").innerHTML = `<div class="fo-empty"><b>No projects yet</b>You see the folders of the projects you are in (Projects page).</div>`;
    return;
  }
  const q = new URLSearchParams(location.search);
  await openProject(reg, q.get("reg") === reg ? q.get("path") || "" : "");
  const want = q.get("open");
  if (want) {
    const e = F.items.find((i) => i.name === want);
    if (e) { F.sel = new Set([e.path]); paint(); openItem(e); }
  }
  setInterval(() => { if (!document.hidden && F.mode === "folder" && !uploading && !document.querySelector(".t-modal")) go(F.path, true).catch(() => {}); }, 60000);
}

start().catch((e) => { const m = $("#fo-list"); if (m) m.innerHTML = `<div class="fo-empty"><b>Something went wrong</b>${esc(e.message)}</div>`; });
