/* Files > A CAD drawing (DWG / DXF) on the Sheets page.
 *
 * The drawing and its xrefs (or a .zip) go to the server one by one; the
 * person ticks which files are drawings (the rest are only xrefs), names
 * the set and chooses black or colour; the server reads the DWGs (ODA File
 * Converter), draws every layout and adds them as a set of imported sheets
 * (server/cad.py). This window shows how far it is and what came of it.
 */

import { keepRow, keepImported } from "./folderpick.js";

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

/* files: a FileList / array. opts: { headers(), done(setName) } */
export async function importCad(files, opts) {
  files = [...(files || [])].filter((f) => /\.(dwg|dxf|zip)$/i.test(f.name));
  if (!files.length) { alert("Choose DWG or DXF files (or a .zip of them)."); return; }
  const H = opts.headers;
  const api = async (path, init) => {
    const r = await fetch(path, Object.assign({}, init || {}, { headers: Object.assign({}, H(), (init && init.headers) || {}) }));
    let d = null;
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
    return d;
  };
  let tools = {};
  try { tools = await api("/api/import/cad/tools"); } catch (e) {}
  if (files.some((f) => /\.dwg$/i.test(f.name)) && tools.oda === false) {
    alert("This server cannot read DWG files yet: the ODA File Converter is not installed on it (the server's admin installs it - see the manual).\n\nDXF files can be imported now: in AutoCAD, Save As > DXF.");
    return;
  }
  // 1. send them
  const up = dialog(`<h3>Importing CAD drawings</h3><div class="muted cad-msg">Sending ...</div><div class="cad-bar"><i></i></div>`);
  let job = "", list = [];
  try {
    for (let i = 0; i < files.length; i++) {
      up.querySelector(".cad-msg").textContent = `Sending ${files[i].name} (${i + 1} of ${files.length}) ...`;
      up.querySelector(".cad-bar i").style.width = Math.round(100 * i / files.length) + "%";
      const r = await api(`/api/import/cad/file?${new URLSearchParams({ job, name: files[i].name })}`, {
        method: "POST", body: files[i], headers: { "Content-Type": "application/octet-stream" } });
      job = r.job; list = r.files;
    }
  } catch (e) {
    up.remove();
    alert("Not sent: " + e.message);
    return;
  }
  up.remove();
  if (!list.length) { alert("There was no DWG or DXF file in that."); return; }
  // 2. which are drawings, the set, black or colour
  const stem = (n) => n.replace(/\.[^.]+$/, "");
  const guessXref = (n) => /(^|[-_ ])(x|xr|xref|bg|base|grid|title|tb|border)([-_ .]|$)/i.test(stem(n));
  const choose = dialog(`<h3>CAD drawings</h3>
    <div class="muted">Tick the drawings to make into sheets (each layout becomes a sheet). Leave the <b>xrefs</b> unticked: they are drawn inside the drawings that use them.</div>
    <div class="cad-files">${list.map((f) => `<label><input type="checkbox" value="${esc(f.name)}"${list.length === 1 || !guessXref(f.name) ? " checked" : ""}> ${esc(f.name)}<small>${f.mb} MB</small></label>`).join("")}</div>
    <label class="cad-row">Set (its entry in the drop-down)<input type="text" class="cad-set" maxlength="60" value="${esc(stem(list.find((f) => !guessXref(f.name))?.name || list[0].name))}"></label>
    <label class="cad-chk"><input type="checkbox" class="cad-mono" checked> Black lines, as plotted (untick for the drawing's colours)</label>
    <div class="cad-keep"></div>
    ${tools.font ? "" : `<div class="muted">Note: the server has no Chinese font for drawings yet, so Chinese text may show as boxes (it is still found by search).</div>`}
    <div class="cad-foot"><button type="button" class="cad-no">Cancel</button><button type="button" class="pri cad-go">Make sheets</button></div>`);
  const keep = keepRow(choose.querySelector(".cad-keep"), { kind: "cad", project: opts.project,
    setName: () => choose.querySelector(".cad-set").value });
  choose.querySelector(".cad-set").addEventListener("input", () => keep.repaint());
  const pick = await new Promise((resolve) => {
    choose.querySelector(".cad-no").onclick = () => resolve(null);
    choose.querySelector(".cad-go").onclick = () => {
      const drawings = [...choose.querySelectorAll(".cad-files input:checked")].map((c) => c.value);
      if (!drawings.length) { alert("Tick at least one drawing."); return; }
      resolve({ drawings, set: choose.querySelector(".cad-set").value.trim() || "CAD drawings", mono: choose.querySelector(".cad-mono").checked });
    };
  });
  const keepTo = keep.target();
  choose.remove();
  if (!pick) return;
  // 3. made on the server: progress, then the result
  const prog = dialog(`<h3>Making sheets</h3><div class="cad-msg">Starting ...</div><div class="cad-bar"><i></i></div><div class="cad-out"></div>
    <div class="cad-foot"><button type="button" class="cad-close" disabled>Working ...</button></div>`);
  try {
    await api("/api/import/cad/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ job }, pick)) });
  } catch (e) {
    prog.remove();
    alert("Not started: " + e.message);
    return;
  }
  let j = null;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1200));
    try { j = await api("/api/import/cad/" + job); } catch (e) { continue; }
    prog.querySelector(".cad-msg").textContent = j.message || "";
    prog.querySelector(".cad-bar i").style.width = (j.progress || 0) + "%";
    if (j.status === "done" || j.status === "failed") break;
  }
  // the files sent, kept in Folders (from here: the server does not keep them)
  let kept = null;
  if (keepTo.mode !== "none") {
    prog.querySelector(".cad-msg").textContent = "Keeping the CAD files in Folders ...";
    kept = await keepImported(keepTo, files, { kind: "cad", project: opts.project, setName: pick.set });
  }
  const rep = (j.report || []).map((r) => `<li><b>${esc(r.file)}</b>: `
    + (r.error ? `<span class="bad">${esc(r.error)}</span>`
      : `${r.sheets.length} sheet(s) - ${esc(r.sheets.join(", "))}`
        + (r.missing_xrefs && r.missing_xrefs.length ? `<br><span class="bad">Xrefs not sent (drawn without them): ${esc(r.missing_xrefs.join(", "))}</span>` : "")
        + (r.left_out && Object.keys(r.left_out).length ? `<br><span class="muted">Not drawn: ${esc(Object.entries(r.left_out).map(([k, v]) => `${k} (${v})`).join(", "))}</span>` : ""))
    + `</li>`).join("");
  prog.querySelector(".cad-msg").textContent = j.message || "";
  prog.querySelector(".cad-out").innerHTML = `<ul>${rep}</ul>`
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
export async function pdfImportDialog({ file, pages, stem, sets, set, project }) {
  const d = dialog(`<h3>Import ${esc(file.name)}</h3>
    <div class="muted">${pages === 1 ? "One page: it becomes one sheet." : `${pages} pages: each becomes a sheet, numbered after the prefix.`}</div>
    <label class="cad-row">${pages === 1 ? "Sheet number" : "Sheet number prefix"}<input type="text" class="pi-prefix" maxlength="40" value="${esc(stem.slice(0, 24))}"></label>
    <label class="cad-row">Set (its entry in the drop-down at the top)<input type="text" class="pi-set" maxlength="60" list="pi-sets" value="${esc(set)}">
      <datalist id="pi-sets">${(sets || []).map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
    <div class="pi-keep"></div>
    <div class="cad-foot"><button type="button" class="cad-no">Cancel</button><button type="button" class="pri cad-go">Import</button></div>`);
  const keep = keepRow(d.querySelector(".pi-keep"), { kind: "pdf", project, setName: () => d.querySelector(".pi-set").value });
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

export { keepImported };
