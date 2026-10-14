/* Files > A CAD drawing (DWG / DXF) on the Sheets page.
 *
 * The drawing and its xrefs (or a .zip) go to the server one by one; the
 * person ticks which files are drawings (the rest are only xrefs), names
 * the set and chooses black or colour; the server reads the DWGs (ODA File
 * Converter), draws every layout and adds them as a set of imported sheets
 * (server/cad.py). This window shows how far it is and what came of it.
 */

import { keepRow, keepImported, pickFolderFiles, folderFile } from "./folderpick.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function style() {
  if (document.getElementById("cad-style")) return;
  const s = document.createElement("style");
  s.id = "cad-style";
  s.textContent = `.cad-back{position:fixed;inset:0;z-index:2147483100;background:rgba(20,26,36,.38);display:flex;align-items:center;justify-content:center;padding:12px}
  .cad{background:var(--panel,#fff);color:var(--ink,#1f2937);border-radius:12px;box-shadow:0 12px 40px rgba(20,26,36,.3);width:min(520px,100%);max-height:calc(100vh - 24px);overflow:auto;font:13px system-ui,sans-serif;padding:14px 16px}
  .cad h3{margin:0 0 8px;font-size:16px}
  .cad .cad-files{border:1px solid var(--line,#e2e8f0);border-radius:8px;max-height:36vh;overflow:auto;margin:6px 0 10px}
  .cad .cad-files label{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--line-soft,#f1f5f9)}
  .cad .cad-files label:last-child{border-bottom:0}
  .cad .cad-files small{color:var(--ink-2,#64748b);margin-left:auto}
  .cad .cad-files input{width:auto;margin:0}
  .cad .cad-row{display:flex;flex-direction:column;gap:4px;margin:8px 0;font-weight:600;font-size:12px}
  .cad .cad-row input[type=text]{font:inherit;padding:5px 6px}
  .cad .cad-chk{display:flex;align-items:center;gap:6px;font-size:13px;margin:6px 0}
  .cad .cad-chk input{width:auto;margin:0}
  .cad .muted{color:var(--ink-2,#64748b);font-size:12px}
  .cad .bad{color:#b91c1c}
  .cad .cad-bar{height:8px;border-radius:4px;background:var(--panel-2,#eef2f7);overflow:hidden;margin:10px 0 6px}
  .cad .cad-bar i{display:block;height:100%;background:#f28022;width:0;transition:width .3s}
  .cad .cad-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  .cad button{font:inherit;border-radius:7px;padding:6px 12px;border:1px solid var(--line,#cbd5e1);background:var(--panel,#fff);color:inherit;cursor:pointer}
  .cad button.pri{background:#f28022;border-color:#f28022;color:#fff;font-weight:700}
  .cad ul{margin:6px 0;padding-left:18px}`;
  document.head.appendChild(s);
}

function dialog(html) {
  style();
  const back = document.createElement("div");
  back.className = "cad-back";
  back.innerHTML = `<div class="cad" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  return back;
}

/* Where the files come from: this PC (files, or a whole folder) or the
   viewer's Folders. -> { files: [File] } | { folders: {reg, paths, names} } | null */
const isCad = (n) => /\.(dwg|dxf|zip)$/i.test(n);
function pickLocal(folder, accept) {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    i.multiple = true;
    if (folder) i.webkitdirectory = true; else i.accept = accept;
    i.style.display = "none";
    document.body.appendChild(i);
    i.onchange = () => { const f = [...(i.files || [])]; i.remove(); resolve(f); };
    i.addEventListener("cancel", () => { i.remove(); resolve([]); });
    i.click();
  });
}

export async function chooseSource(kind, project) {
  const cad = kind === "cad";
  const d = dialog(`<h3>${cad ? "Import CAD drawings" : "Import a PDF drawing"}</h3>
    <div class="muted">Where are the ${cad ? "drawings" : "PDFs"}?</div>
    <div class="cad-foot" style="justify-content:flex-start;flex-wrap:wrap">
      <button type="button" data-s="files">${cad ? "Files on this PC ..." : "From this PC ..."}</button>
      ${cad ? `<button type="button" data-s="folder">A folder on this PC ...</button>` : ""}
      <button type="button" data-s="folders">From Folders ...</button></div>
    ${cad ? `<div class="muted" style="margin-top:6px">A folder: the drawings in it and its sub-folders are listed; only the drawings you tick and the xrefs they use are sent.</div>` : ""}
    <div class="cad-foot"><button type="button" class="cad-no">Cancel</button></div>`);
  const how = await new Promise((resolve) => {
    d.querySelector(".cad-no").onclick = () => resolve(null);
    d.querySelectorAll("[data-s]").forEach((b) => { b.onclick = () => resolve(b.dataset.s); });
  });
  d.remove();
  if (!how) return null;
  if (how === "folders") {
    const r = await pickFolderFiles({ title: cad ? "CAD drawings in Folders" : "PDF drawings in Folders", project,
      exts: cad ? [".dwg", ".dxf"] : [".pdf"] });
    return r ? { folders: r } : null;
  }
  const fs = await pickLocal(how === "folder", cad ? ".dwg,.dxf,.zip" : "application/pdf,.pdf");
  const ok = fs.filter((f) => cad ? isCad(f.name) : /\.pdf$/i.test(f.name));
  if (!ok.length) { if (fs.length) alert(cad ? "There is no DWG or DXF file in that." : "Choose PDF files."); return null; }
  return { files: ok };
}

/* opts: { headers(), project, done(setName, sheets), source? } */
export async function importCad(files, opts) {
  const H = opts.headers;
  const api = async (path, init) => {
    const r = await fetch(path, Object.assign({}, init || {}, { headers: Object.assign({}, H(), (init && init.headers) || {}) }));
    let d = null;
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
    return d;
  };
  let src = files && files.length ? { files: [...files].filter((f) => isCad(f.name)) } : await chooseSource("cad", opts.project);
  if (!src) return;
  const stemKey = (n) => String(n || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "").trim().toLowerCase();
  const pool = new Map();                  // stem key -> File (this PC: what may be sent when needed)
  const addPool = (fs) => { for (const f of fs) if (/\.(dwg|dxf)$/i.test(f.name) && !pool.has(stemKey(f.name))) pool.set(stemKey(f.name), f); };
  if (src.files) addPool(src.files);
  let tools = {};
  try { tools = await api("/api/import/cad/tools"); } catch (e) {}
  const names = src.files ? src.files.map((f) => f.webkitRelativePath || f.name) : src.folders.names;
  if (names.some((n) => /\.dwg$/i.test(n)) && tools.oda === false) {
    alert("This server cannot read DWG files yet: the ODA File Converter is not installed on it (the server's admin installs it - see the manual).\n\nDXF files can be imported now: in AutoCAD, Save As > DXF.");
    return;
  }
  // 1. which are drawings, the set, black or colour, where the files are kept
  const stem = (n) => n.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const guessXref = (n) => /(^|\/)[^/]*x-?ref[^/]*\//i.test(n) || /(^|[-_ ])(x|xr|xref|bg|base|grid|title|tb|border)([-_ .]|$)/i.test(stem(n)) || /^x[_ -]/i.test(stem(n));
  const rows = names.map((n, i) => ({ n, i, zip: /\.zip$/i.test(n) }));
  const many = rows.length > 12;
  const choose = dialog(`<h3>CAD drawings</h3>
    <div class="muted">Tick the drawings to make into sheets (each layout becomes a sheet). <b>Xrefs</b> need no tick: the ones a drawing uses are found by themselves - among these files, then in the project's Folders.</div>
    ${many ? `<input type="search" class="cad-find" placeholder="Find a drawing" style="width:100%;margin-top:6px">` : ""}
    <div class="cad-files">${rows.map((r) => `<label data-n="${esc(r.n.toLowerCase())}"><input type="checkbox" value="${r.i}"${r.zip || rows.length === 1 || (!guessXref(r.n) && !many) ? " checked" : ""}> ${esc(r.n)}</label>`).join("")}</div>
    <label class="cad-row">Set (its entry in the drop-down)<input type="text" class="cad-set" maxlength="60" value="${esc(stem((rows.find((r) => !guessXref(r.n)) || rows[0]).n))}"></label>
    <label class="cad-chk"><input type="checkbox" class="cad-mono" checked> Black lines, as plotted (untick for the drawing's colours)</label>
    <div class="cad-keep"></div>
    ${tools.font ? "" : `<div class="muted">Note: the server has no Chinese font for drawings yet, so Chinese text may show as boxes (it is still found by search).</div>`}
    <div class="cad-foot"><button type="button" class="cad-no">Cancel</button><button type="button" class="pri cad-go">Make sheets</button></div>`);
  const find = choose.querySelector(".cad-find");
  if (find) find.oninput = () => { const q = find.value.trim().toLowerCase(); for (const l of choose.querySelectorAll(".cad-files label")) l.hidden = !!q && !l.dataset.n.includes(q); };
  const keepEl = choose.querySelector(".cad-keep");
  let keep = null;
  if (src.files) {
    keep = keepRow(keepEl, { kind: "cad", project: opts.project, setName: () => choose.querySelector(".cad-set").value });
    choose.querySelector(".cad-set").addEventListener("input", () => keep.repaint());
  } else {
    keepEl.innerHTML = `<div class="muted" style="margin-top:6px">These drawings are already in Folders: nothing more is kept.</div>`;
  }
  const pick = await new Promise((resolve) => {
    choose.querySelector(".cad-no").onclick = () => resolve(null);
    choose.querySelector(".cad-go").onclick = () => {
      const idx = [...choose.querySelectorAll(".cad-files input:checked")].map((c) => Number(c.value));
      if (!idx.length) { alert("Tick at least one drawing."); return; }
      resolve({ idx, set: choose.querySelector(".cad-set").value.trim() || "CAD drawings", mono: choose.querySelector(".cad-mono").checked });
    };
  });
  const keepTo = keep ? keep.target() : { mode: "none" };
  choose.remove();
  if (!pick) return;
  // 2. send the drawings ticked (or copy them from Folders)
  const prog = dialog(`<h3>Making sheets</h3><div class="cad-msg">Sending ...</div><div class="cad-bar"><i></i></div><div class="cad-out"></div>
    <div class="cad-foot"><button type="button" class="cad-close" disabled>Working ...</button></div>`);
  const msg = (t, pc) => { prog.querySelector(".cad-msg").textContent = t; if (pc != null) prog.querySelector(".cad-bar i").style.width = pc + "%"; };
  const fail = (t) => { prog.remove(); alert(t); };
  let job = "";
  const sent = [];                          // Files sent from this PC (kept in Folders afterwards)
  const send = async (fs) => {
    for (let i = 0; i < fs.length; i++) {
      msg(`Sending ${fs[i].name} (${i + 1} of ${fs.length}) ...`, Math.round(30 * i / fs.length));
      const r = await api(`/api/import/cad/file?${new URLSearchParams({ job, name: fs[i].name })}`, {
        method: "POST", body: fs[i], headers: { "Content-Type": "application/octet-stream" } });
      job = r.job;
      sent.push(fs[i]);
    }
  };
  let drawings;
  try {
    if (src.files) {
      const chosen = pick.idx.map((i) => src.files[i]);
      await send(chosen);
      drawings = chosen.filter((f) => !/\.zip$/i.test(f.name)).map((f) => f.name);
      if (chosen.some((f) => /\.zip$/i.test(f.name))) drawings = null;      // a zip: every drawing in it
    } else {
      msg("Copying the drawings from Folders ...", 10);
      const r = await api("/api/import/cad/from-folders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reg: src.folders.reg, paths: pick.idx.map((i) => src.folders.paths[i]) }) });
      job = r.job;
      drawings = pick.idx.map((i) => src.folders.names[i]);
    }
  } catch (e) { return fail("Not sent: " + e.message); }
  // 3. read them and fill in the xrefs: from what was chosen on this PC, from Folders (on the server), then by asking
  const poll = async (want) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      let j;
      try { j = await api("/api/import/cad/" + job); } catch (e) { continue; }
      if (j.message) msg(j.message);
      if (want.includes(j.status) || j.status === "failed") return j;
    }
  };
  let j = null, askedOut = false, folders = false;    // the files chosen on this PC first, then Folders
  for (let round = 0; round < 16; round++) {
    try {
      await api("/api/import/cad/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, drawings, folders }) });
    } catch (e) { return fail("Not read: " + e.message); }
    msg("Reading the drawings ...", 35);
    j = await poll(["scanned"]);
    if (j.status === "failed") return fail(j.message || "The drawings could not be read.");
    const need = j.needed || [];
    if (!need.length) break;
    const have = need.map((n) => pool.get(stemKey(n))).filter(Boolean).filter((f) => !sent.includes(f));
    if (have.length) { try { await send(have); } catch (e) { return fail("Not sent: " + e.message); } continue; }
    if (!folders) { folders = true; continue; }
    if (askedOut) break;
    // still missing: ask
    prog.hidden = true;
    const a = dialog(`<h3>Xrefs to find</h3>
      <div class="muted">The drawings use ${need.length} xref(s) that are not among the files chosen${j.from_folders && j.from_folders.length ? ` (${j.from_folders.length} found in Folders)` : " nor in the project's Folders"}:</div>
      <ul>${need.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <div class="cad-foot" style="justify-content:flex-start;flex-wrap:wrap">
        <button type="button" data-a="files">Choose files ...</button><button type="button" data-a="folder">Choose a folder ...</button>
        <button type="button" data-a="without">Make the sheets without them</button></div>
      <div class="cad-foot"><button type="button" data-a="cancel">Cancel</button></div>`);
    const ans = await new Promise((resolve) => a.querySelectorAll("[data-a]").forEach((b) => { b.onclick = () => resolve(b.dataset.a); }));
    a.remove();
    prog.hidden = false;
    if (ans === "cancel") { prog.remove(); return; }
    if (ans === "without") { askedOut = true; break; }
    const more = await pickLocal(ans === "folder", ".dwg,.dxf");
    addPool(more);
    if (src.files) src.files.push(...more.filter((f) => /\.(dwg|dxf)$/i.test(f.name)));
  }
  // 4. make the sheets
  try {
    await api("/api/import/cad/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, drawings: drawings || undefined, set: pick.set, mono: pick.mono }) });
  } catch (e) { return fail("Not started: " + e.message); }
  j = await poll(["done"]);
  // the files sent from this PC, kept in Folders (the server does not keep them)
  let kept = null;
  if (keepTo.mode !== "none" && sent.length) {
    msg("Keeping the CAD files in Folders ...");
    kept = await keepImported(keepTo, sent, { kind: "cad", project: opts.project, setName: pick.set });
  }
  const rep = (j.report || []).map((r) => `<li><b>${esc(r.file)}</b>: `
    + (r.error ? `<span class="bad">${esc(r.error)}</span>`
      : `${r.sheets.length} sheet(s) - ${esc(r.sheets.join(", "))}`
        + (r.missing_xrefs && r.missing_xrefs.length ? `<br><span class="bad">Xrefs not found (drawn without them): ${esc(r.missing_xrefs.join(", "))}</span>` : "")
        + (r.left_out && Object.keys(r.left_out).length ? `<br><span class="muted">Not drawn: ${esc(Object.entries(r.left_out).map(([k, v]) => `${k} (${v})`).join(", "))}</span>` : ""))
    + `</li>`).join("");
  msg(j.message || "", 100);
  prog.querySelector(".cad-out").innerHTML = `<ul>${rep}</ul>`
    + (j.from_folders && j.from_folders.length ? `<div class="muted">Xrefs taken from Folders: ${esc(j.from_folders.join(", "))}</div>` : "")
    + (kept && kept.kept.length ? `<div>The ${kept.kept.length} CAD file(s) are kept in Folders: <a href="${esc(kept.href)}" target="_blank" rel="noopener">${esc(kept.label)}</a></div>` : "")
    + (kept && kept.errors.length ? `<div class="bad">Not kept in Folders: ${esc(kept.errors.join("; "))}</div>` : "")
    + (j.status === "done" ? `<div class="muted">Fonts are drawn with a standard font, complex line types as plain dashes. For the exact look, publish a PDF from AutoCAD and import that.</div>` : "");
  const btn = prog.querySelector(".cad-close");
  btn.disabled = false;
  btn.className = "pri cad-close";
  btn.textContent = j.status === "done" ? "Show the sheets" : "Close";
  await new Promise((r) => { btn.onclick = r; });
  prog.remove();
  if (j.status === "done" && opts.done) opts.done(j.set, j.sheets || []);
}

/* The window of Files > A PDF drawing: the sheet number (prefix for a PDF
   of several pages), the set, and where the PDF is kept in Folders.
   -> { prefix, set, keep } or null. */
export async function pdfImportDialog({ file, pages, stem, sets, set, project, fromFolders }) {
  const d = dialog(`<h3>Import ${esc(file.name)}</h3>
    <div class="muted">${pages === 1 ? "One page: it becomes one sheet." : `${pages} pages: each becomes a sheet, numbered after the prefix.`}</div>
    <label class="cad-row">${pages === 1 ? "Sheet number" : "Sheet number prefix"}<input type="text" class="pi-prefix" maxlength="40" value="${esc(stem.slice(0, 24))}"></label>
    <label class="cad-row">Set (its entry in the drop-down at the top)<input type="text" class="pi-set" maxlength="60" list="pi-sets" value="${esc(set)}">
      <datalist id="pi-sets">${(sets || []).map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
    <div class="pi-keep"></div>
    <div class="cad-foot"><button type="button" class="cad-no">Cancel</button><button type="button" class="pri cad-go">Import</button></div>`);
  // a PDF taken from Folders is there already: nothing more to keep
  const keep = fromFolders ? { target: () => ({ mode: "none" }), repaint() {} }
    : keepRow(d.querySelector(".pi-keep"), { kind: "pdf", project, setName: () => d.querySelector(".pi-set").value });
  if (fromFolders) d.querySelector(".pi-keep").innerHTML = `<div class="muted" style="margin-top:6px">From Folders: it stays where it is there.</div>`;
  d.querySelector(".pi-set").addEventListener("input", () => keep.repaint());
  setTimeout(() => d.querySelector(".pi-prefix").select(), 30);
  const r = await new Promise((resolve) => {
    d.querySelector(".cad-no").onclick = () => resolve(null);
    d.addEventListener("keydown", (ev) => { if (ev.key === "Escape") resolve(null); if (ev.key === "Enter" && ev.target.tagName === "INPUT") d.querySelector(".cad-go").click(); });
    d.querySelector(".cad-go").onclick = () => {
      const prefix = d.querySelector(".pi-prefix").value.trim();
      if (!prefix) { alert("Give the sheet a number."); return; }
      resolve({ prefix, set: d.querySelector(".pi-set").value.trim().slice(0, 60), keep: keep.target() });
    };
  });
  d.remove();
  return r;
}

export { keepImported, pickFolderFiles, folderFile };
