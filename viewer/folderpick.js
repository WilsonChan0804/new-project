/* Choose a folder in Folders (any project you can open, any folder but the
 * read-only 00 BIM) and keep a file there. Used after a PDF is imported on
 * the Sheets page and for any file sent in the Messenger or a task
 * ("Save to Folders").
 *
 *   pickFolder({ title, project, file })  -> { reg, path, label } or null
 *   keepIn(target, blob, name)            -> { reg, path, name }
 *   saveToFoldersFlow(blob, name, opts)   both, with the result shown
 *
 * The last folder chosen is remembered per viewer project (or once for
 * the Messenger), so the next file goes to the same place in one click.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BIM = "00 BIM";
const LAST = "lwk-viewer:keep-folder:";

function headers(json) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  try { const t = localStorage.getItem("lwk-viewer:token"); if (t) h["X-Viewer-Token"] = t; } catch (e) {}
  return h;
}
async function get(path) {
  const r = await fetch(path, { headers: headers() });
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return d;
}

function style() {
  if (document.getElementById("fp-style")) return;
  const s = document.createElement("style");
  s.id = "fp-style";
  s.textContent = `.fp-back{position:fixed;inset:0;z-index:2147483100;background:rgba(20,26,36,.38);display:flex;align-items:center;justify-content:center;padding:12px}
  .fp{background:var(--panel,#fff);color:var(--ink,#1f2937);border-radius:12px;box-shadow:0 12px 40px rgba(20,26,36,.3);width:min(460px,100%);max-height:calc(100vh - 24px);display:flex;flex-direction:column;font:13px system-ui,sans-serif}
  .fp h3{margin:0;padding:14px 16px 6px;font-size:16px}
  .fp .fp-file{padding:0 16px 8px;color:var(--ink-2,#64748b);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fp label{display:flex;flex-direction:column;gap:4px;padding:0 16px 8px;font-weight:600;font-size:12px}
  .fp select{font:inherit;padding:5px 6px}
  .fp-tree{margin:0 16px;border:1px solid var(--line,#e2e8f0);border-radius:8px;overflow:auto;min-height:160px;max-height:46vh}
  .fp-tree div{padding:5px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fp-tree div:hover{background:var(--panel-2,#f1f5f9)}
  .fp-tree div.on{background:var(--accent-soft,#fff1e6);box-shadow:inset 3px 0 0 var(--accent,#f28022);font-weight:600}
  .fp-foot{display:flex;gap:8px;align-items:center;padding:12px 16px}
  .fp-foot .sp{flex:1}
  .fp button{font:inherit;border-radius:7px;padding:6px 12px;border:1px solid var(--line,#cbd5e1);background:var(--panel,#fff);color:inherit;cursor:pointer}
  .fp button.pri{background:#f28022;border-color:#f28022;color:#fff;font-weight:700}
  .fp button:disabled{opacity:.5;cursor:default}
  .fp .fp-msg{padding:0 16px;color:#b91c1c;font-size:12px;min-height:0}`;
  document.head.appendChild(s);
}

/* The Folders projects I can open; the ones linked to this viewer project first. */
async function projects(viewerProject) {
  const d = await get("/api/files/projects");
  const list = d.projects || [];
  const linked = list.filter((p) => viewerProject && (p.parts || []).includes(viewerProject));
  return { list: linked.concat(list.filter((p) => !linked.includes(p))), linked };
}

export async function pickFolder({ title, project, file } = {}) {
  style();
  let ps;
  try { ps = await projects(project); } catch (e) { alert("Folders could not be read: " + e.message); return null; }
  if (!ps.list.length) { alert("You have no project in Folders to keep it in."); return null; }
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST + (project || "chat")) || "null"); } catch (e) {}
  let reg = (last && ps.list.some((p) => p.id === last.reg) ? last.reg : (ps.linked[0] || ps.list[0]).id);
  let at = last && last.reg === reg ? last.path || "" : "";
  let folders = [];
  return await new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "fp-back";
    back.innerHTML = `<div class="fp" role="dialog" aria-modal="true"><h3>${esc(title || "Keep in Folders")}</h3>`
      + (file ? `<div class="fp-file">${esc(file)}</div>` : "")
      + `<label>Project<select class="fp-proj">${ps.list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${ps.linked.includes(p) ? " (this project)" : ""}</option>`).join("")}</select></label>`
      + `<label style="padding-bottom:4px">Folder</label><div class="fp-tree" role="listbox"></div><div class="fp-msg"></div>`
      + `<div class="fp-foot"><button type="button" class="fp-new">+ New folder</button><span class="sp"></span>`
      + `<button type="button" class="fp-no">Cancel</button><button type="button" class="pri fp-ok">Keep it here</button></div></div>`;
    document.body.appendChild(back);
    const $ = (s) => back.querySelector(s);
    const end = (v) => { back.remove(); resolve(v); };
    const name = () => (ps.list.find((p) => p.id === reg) || {}).name || "";
    const paint = () => {
      $(".fp-tree").innerHTML = [""].concat(folders).map((f) => {
        const depth = f ? f.split("/").length : 0;
        return `<div data-f="${esc(f)}" class="${f === at ? "on" : ""}" style="padding-left:${8 + depth * 14}px">&#128193; ${esc(f ? f.split("/").pop() : name() + " (top)")}</div>`;
      }).join("");
      const on = $(".fp-tree .on");
      if (on) on.scrollIntoView({ block: "nearest" });
    };
    const load = async () => {
      $(".fp-tree").innerHTML = `<div style="color:#94a3b8">Reading the folders ...</div>`;
      try {
        const d = await get("/api/files/" + encodeURIComponent(reg) + "/tree");
        folders = (d.folders || []).filter((f) => f !== BIM && !f.startsWith(BIM + "/")).sort((a, b) => a.localeCompare(b));
      } catch (e) { folders = []; $(".fp-msg").textContent = e.message; }
      if (at && !folders.includes(at)) at = "";
      paint();
    };
    $(".fp-proj").value = reg;
    $(".fp-proj").onchange = () => { reg = $(".fp-proj").value; at = ""; load(); };
    $(".fp-tree").onclick = (ev) => { const d = ev.target.closest("[data-f]"); if (!d) return; at = d.dataset.f; paint(); };
    $(".fp-tree").ondblclick = (ev) => { if (ev.target.closest("[data-f]")) $(".fp-ok").click(); };
    $(".fp-new").onclick = async () => {
      const nm = (prompt(`New folder in ${at || name() + " (top)"}:`) || "").trim();
      if (!nm) return;
      try {
        const r = await fetch("/api/files/" + encodeURIComponent(reg) + "/mkdir", { method: "POST", headers: headers(true), body: JSON.stringify({ path: at, name: nm }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || "HTTP " + r.status);
        folders.push(d.path); folders.sort((a, b) => a.localeCompare(b));
        at = d.path;
        paint();
      } catch (e) { $(".fp-msg").textContent = e.message; }
    };
    $(".fp-no").onclick = () => end(null);
    back.addEventListener("pointerdown", (ev) => { if (ev.target === back) end(null); });
    back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") end(null); });
    $(".fp-ok").onclick = () => {
      try { localStorage.setItem(LAST + (project || "chat"), JSON.stringify({ reg, path: at })); } catch (e) {}
      end({ reg, path: at, label: name() + (at ? " / " + at : "") });
    };
    load().then(() => $(".fp-ok").focus());
  });
}

/* Put the file there (a name already there gets " (2)"). */
export async function keepIn(target, blob, name) {
  const q = new URLSearchParams({ path: target.path || "", name });
  const r = await fetch("/api/files/" + encodeURIComponent(target.reg) + "/upload?" + q.toString(), {
    method: "POST", body: blob, headers: Object.assign(headers(), { "Content-Type": blob.type || "application/octet-stream" }) });
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return Object.assign({ reg: target.reg }, d);
}

export function foldersUrl(reg, path) {
  const parts = String(path || "").split("/");
  const nm = parts.pop();
  return "folders.html?" + new URLSearchParams({ reg, path: parts.join("/"), open: nm }).toString();
}

/* Choose, keep, and say where (a small bar with Open). blob may be a
   function giving it (fetched only once a folder is chosen). */
export async function saveToFoldersFlow(blob, name, opts = {}) {
  const t = await pickFolder({ title: opts.title || "Keep a copy in Folders", project: opts.project, file: name });
  if (!t) return null;
  try {
    const b = typeof blob === "function" ? await blob() : blob;
    const r = await keepIn(t, b, name);
    note(`Kept in Folders: <b>${esc(t.label.split(" / ")[0])} / ${esc(r.path)}</b>`, foldersUrl(t.reg, r.path));
    return r;
  } catch (e) {
    note("Not kept: " + esc(e.message));
    return null;
  }
}

function note(html, href) {
  let bar = document.getElementById("fp-bar");
  if (bar) bar.remove();
  bar = document.createElement("div");
  bar.id = "fp-bar";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;"
    + "max-width:min(560px,calc(100vw - 24px));padding:8px 12px;border-radius:8px;background:#2b3342;color:#fff;font:12.5px system-ui,sans-serif;box-shadow:0 6px 24px rgba(20,26,36,.28)";
  bar.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${html}</span>`
    + (href ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="color:#fff;background:#f28022;border-radius:6px;padding:4px 10px;text-decoration:none;white-space:nowrap">Open</a>` : "")
    + `<button type="button" aria-label="Close" style="background:none;border:0;color:#fff;cursor:pointer">&#10005;</button>`;
  document.body.appendChild(bar);
  bar.querySelector("button").onclick = () => bar.remove();
  setTimeout(() => bar.remove(), 12000);
}

/* After an import on the Sheets page: "Imported x. [Keep a copy in Folders]". */
export function offerKeep(blob, name, project, what) {
  let bar = document.getElementById("fp-bar");
  if (bar) bar.remove();
  bar = document.createElement("div");
  bar.id = "fp-bar";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;"
    + "max-width:min(560px,calc(100vw - 24px));padding:8px 12px;border-radius:8px;background:#2b3342;color:#fff;font:12.5px system-ui,sans-serif;box-shadow:0 6px 24px rgba(20,26,36,.28)";
  bar.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(what || "Imported " + name)}</span>`
    + `<button type="button" data-keep style="font:inherit;border:1px solid #f28022;background:#f28022;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap">Keep a copy in Folders ...</button>`
    + `<button type="button" data-x aria-label="Close" style="background:none;border:0;color:#fff;cursor:pointer">&#10005;</button>`;
  document.body.appendChild(bar);
  const t = setTimeout(() => bar.remove(), 15000);
  bar.querySelector("[data-x]").onclick = () => bar.remove();
  bar.querySelector("[data-keep]").onclick = () => { clearTimeout(t); bar.remove(); saveToFoldersFlow(blob, name, { project }); };
}

/* ------------------------------------------------------------ imports
   The "Keep in Folders" line of the Sheets page's import windows (a PDF,
   CAD drawings): by default 00 BIM / Import / PDF (or CAD) / <set>;
   Change ... for any other folder; Don't keep a copy. Remembered per
   project and kind. */

const KEEP = "lwk-viewer:import-keep:";

function viewerHeaders(project, json) {
  const h = headers(json);
  if (project) h["X-Project"] = project;
  return h;
}

/* el: an element to fill. -> { target(), ready } where target() is
   { mode: "default" | "folder" | "none", reg, path, label }. */
export function keepRow(el, { kind, project, setName }) {
  const key = KEEP + (project || "") + ":" + kind;
  let st = { mode: "default" };
  try { st = JSON.parse(localStorage.getItem(key) || "null") || st; } catch (e) {}
  let where = { reg: null, name: "" };
  const sub = kind === "cad" ? "CAD" : "PDF";
  const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} };
  const paint = () => {
    const set = (setName() || "").trim();
    let what;
    if (st.mode === "none") what = `<i>Not kept</i> - the file is only used for the sheets`;
    else if (st.mode === "folder") what = `<b>${esc(st.label || st.path || "(top)")}</b>`;
    else if (!where.reg) what = `<span style="color:#b91c1c">This model is not in a Folders project yet, so the file cannot be kept there (Projects page: add the model to a project).</span>`;
    else what = `<b>${esc(where.name)} / 00 BIM / Import / ${sub}${set ? " / " + esc(set) : ""}</b>`;
    el.innerHTML = `<div style="font-weight:600;font-size:12px;margin:8px 0 4px">Keep the ${kind === "cad" ? "CAD files" : "PDF"} in Folders</div>`
      + `<div style="font-size:12.5px;margin-bottom:6px">${what}</div>`
      + `<div style="display:flex;gap:6px;flex-wrap:wrap">`
      + `<button type="button" data-k="change">Change folder ...</button>`
      + (st.mode !== "default" ? `<button type="button" data-k="default">00 BIM / Import / ${sub}</button>` : "")
      + (st.mode !== "none" ? `<button type="button" data-k="none">Don't keep a copy</button>` : "")
      + `</div>`;
  };
  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-k]");
    if (!b) return;
    if (b.dataset.k === "change") {
      const t = await pickFolder({ title: "Keep the imported " + (kind === "cad" ? "CAD files" : "PDF") + " in", project });
      if (t) { st = { mode: "folder", reg: t.reg, path: t.path, label: t.label }; save(); }
    } else {
      st = { mode: b.dataset.k };
      save();
    }
    paint();
  });
  const ready = fetch("/api/files/for-viewer/where", { headers: viewerHeaders(project) })
    .then((r) => r.ok ? r.json() : { reg: null }).then((w) => { where = w || where; paint(); }, () => paint());
  paint();
  return { target: () => Object.assign({}, st, { linked: where }), repaint: paint, ready };
}

/* Keep the files where keepRow says. -> { kept: [{name, path, reg}], errors: [text], label, href } */
export async function keepImported(target, files, { kind, project, setName }) {
  const out = { kept: [], errors: [], label: "", href: "" };
  if (!target || target.mode === "none") return out;
  for (const f of files) {
    const q = new URLSearchParams({ kind, name: f.name, set: setName || "" });
    if (target.mode === "folder") { q.set("path", target.path || ""); q.set("reg", target.reg || ""); }
    try {
      const r = await fetch("/api/files/for-viewer/import?" + q.toString(), {
        method: "POST", body: f, headers: Object.assign(viewerHeaders(project), { "Content-Type": f.type || "application/octet-stream" }) });
      let d = null;
      try { d = await r.json(); } catch (e) {}
      if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
      out.kept.push(d);
    } catch (e) {
      out.errors.push(f.name + ": " + e.message);
    }
  }
  if (out.kept.length) {
    const p = out.kept[0];
    const dir = p.path.split("/").slice(0, -1).join("/");
    out.label = dir;
    out.href = "folders.html?" + new URLSearchParams({ reg: p.reg, path: dir }).toString();
  }
  return out;
}

/* Pick files that are already in Folders (Sheets page imports "From
   Folders"): one Folders project, browse its folders, tick files of the
   given kinds. -> { reg, paths: [...], names: [...] } or null. */
export async function pickFolderFiles({ title, project, exts }) {
  style();
  let ps;
  try { ps = await projects(project); } catch (e) { alert("Folders could not be read: " + e.message); return null; }
  if (!ps.list.length) { alert("You have no project in Folders."); return null; }
  let reg = (ps.linked[0] || ps.list[0]).id;
  let at = "";
  try { const l = JSON.parse(localStorage.getItem(LAST + "pick:" + (project || "")) || "null"); if (l && ps.list.some((p) => p.id === l.reg)) { reg = l.reg; at = l.path || ""; } } catch (e) {}
  const chosen = new Map();               // path -> name
  const okExt = (n) => exts.some((x) => n.toLowerCase().endsWith(x));
  return await new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "fp-back";
    back.innerHTML = `<div class="fp" role="dialog" aria-modal="true"><h3>${esc(title || "Choose from Folders")}</h3>`
      + `<label>Project<select class="fp-proj">${ps.list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${ps.linked.includes(p) ? " (this project)" : ""}</option>`).join("")}</select></label>`
      + `<div class="fp-file fp-crumb"></div><div class="fp-tree fp-files" role="listbox"></div><div class="fp-msg"></div>`
      + `<div class="fp-foot"><span class="fp-count" style="font-size:12px;color:var(--ink-2,#64748b)"></span><span class="sp"></span>`
      + `<button type="button" class="fp-no">Cancel</button><button type="button" class="pri fp-ok" disabled>Use these</button></div></div>`;
    document.body.appendChild(back);
    const $ = (s) => back.querySelector(s);
    const end = (v) => { back.remove(); resolve(v); };
    const count = () => {
      $(".fp-count").textContent = chosen.size ? chosen.size + " chosen" : "";
      $(".fp-ok").disabled = !chosen.size;
    };
    const load = async () => {
      $(".fp-crumb").innerHTML = `<a href="#" data-up="">${esc((ps.list.find((p) => p.id === reg) || {}).name || "")}</a>`
        + (at ? at.split("/").map((p, i, a) => ` / <a href="#" data-up="${esc(a.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join("") : "");
      $(".fp-files").innerHTML = `<div style="color:#94a3b8">Reading ...</div>`;
      let items = [];
      try {
        items = (await get("/api/files/" + encodeURIComponent(reg) + "/list?path=" + encodeURIComponent(at))).items || [];
        $(".fp-msg").textContent = "";
      } catch (e) { $(".fp-msg").textContent = e.message; }
      const dirs = items.filter((i) => i.dir), fls = items.filter((i) => !i.dir && okExt(i.name));
      $(".fp-files").innerHTML = (at ? `<div data-open="${esc(at.split("/").slice(0, -1).join("/"))}">&#8617; ..</div>` : "")
        + dirs.map((i) => `<div data-open="${esc(i.path)}">&#128193; ${esc(i.name)}</div>`).join("")
        + fls.map((i) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 8px;cursor:pointer"><input type="checkbox" data-pick="${esc(i.path)}" data-name="${esc(i.name)}"${chosen.has(i.path) ? " checked" : ""} style="width:auto;margin:0"> ${esc(i.name)}</label>`).join("")
        + (!dirs.length && !fls.length ? `<div style="color:#94a3b8">No ${exts.join(" / ")} files here.</div>` : "");
    };
    $(".fp-proj").value = reg;
    $(".fp-proj").onchange = () => { reg = $(".fp-proj").value; at = ""; chosen.clear(); count(); load(); };
    back.addEventListener("click", (ev) => {
      const o = ev.target.closest("[data-open]");
      if (o) { at = o.dataset.open; load(); return; }
      const u = ev.target.closest("[data-up]");
      if (u) { ev.preventDefault(); at = u.dataset.up; load(); }
    });
    back.addEventListener("change", (ev) => {
      const c = ev.target.closest("[data-pick]");
      if (!c) return;
      if (c.checked) chosen.set(c.dataset.pick, c.dataset.name); else chosen.delete(c.dataset.pick);
      count();
    });
    $(".fp-no").onclick = () => end(null);
    back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") end(null); });
    $(".fp-ok").onclick = () => {
      try { localStorage.setItem(LAST + "pick:" + (project || ""), JSON.stringify({ reg, path: at })); } catch (e) {}
      end({ reg, paths: [...chosen.keys()], names: [...chosen.values()] });
    };
    load();
  });
}

/* A file in Folders as a File (to import it as if chosen on this PC). */
export async function folderFile(reg, path, name) {
  const r = await fetch("/api/files/" + encodeURIComponent(reg) + "/file?path=" + encodeURIComponent(path), { headers: headers() });
  if (!r.ok) throw new Error(name + ": HTTP " + r.status);
  const b = await r.blob();
  return new File([b], name, { type: b.type || "application/octet-stream" });
}
