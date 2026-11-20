/* Codes page (server side: codes.py).
 *
 * Search the office's library of building regulations: the Buildings
 * Ordinance and its Regulations, PNAPs, Codes of Practice, design manuals
 * and the office's own notes, put in by a site admin (Library).
 *
 * Search finds the clauses that match (no AI): Quick facts - the figures
 * the clauses give, with their conditions - the diagrams they refer to, and
 * the clauses themselves, each with its reference, edition and page, and
 * the page of the PDF a click away.
 */

import { api, headers, project } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, toast, pop, closePop } from "./tasks-util.js";
import { mountGbp } from "./gbp.js";

const KEEP = "lwk-viewer:codes-chat";
const CX = { st: null, turns: [], shown: -1, me: null, kinds: [] };
const phone = () => matchMedia("(max-width: 800px)").matches;

function save() {
  try { sessionStorage.setItem(KEEP, JSON.stringify(CX.turns.slice(-20).map((t) => Object.assign({}, t, { busy: false })))); } catch (e) {}
}
function load() {
  try { CX.turns = JSON.parse(sessionStorage.getItem(KEEP) || "[]") || []; } catch (e) { CX.turns = []; }
}

/* ------------------------------------------------------------- status */

async function loadStatus() {
  try { CX.st = await api("/api/codes/status"); } catch (e) { CX.st = null; $("#cx-state").textContent = e.message; return; }
  const s = CX.st;
  $("#cx-state").innerHTML = s.sources
    ? `${s.sources} document${s.sources === 1 ? "" : "s"}, ${s.clauses} clauses`
    : (s.manage ? `The library is empty: <a href="#" id="cx-first">find the documents on the BD site</a> or <a href="#" id="cx-first2">add your own</a>` : "The library is empty - ask a site admin to add the codes");
  const f = $("#cx-first");
  if (f) f.onclick = (ev) => { ev.preventDefault(); openLibrary("find"); };
  const f2 = $("#cx-first2");
  if (f2) f2.onclick = (ev) => { ev.preventDefault(); openLibrary(); };
}

/* -------------------------------------------------------- highlighting */

function marked(text, terms) {
  const ts = (terms || []).filter((t) => t && t.length > 1).sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ts.length) return esc(text);
  const re = new RegExp("(" + ts.join("|") + ")", "gi");
  return String(text).split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join("");
}

/* ------------------------------------------------- quick facts, diagrams */

// the answer at a glance, no AI: each clause about what was asked, with its
// figures and the conditions above them (server codesread.quick_facts)
function factsHtml(t, i) {
  const f = t.facts || [];
  if (!f.length) return "";
  const src = t.sources || [];
  return `<div class="cx-facts"><div class="cx-facts-h"><b>Quick facts</b><span class="muted">picked from the clauses by their figures - read the clause for its full conditions</span></div>`
    + f.map((c) => {
      const s = src[c.k - 1] || {};
      const head = c.ref || s.label || "";
      return `<div class="cx-fc"><button type="button" class="cx-fref" data-turn="${i}" data-s="${c.k}" title="${esc(s.label || "")}">${esc(head)}${c.page ? " \u00b7 p." + c.page : ""}</button>`
        + (c.lead ? `<div class="cx-flead">${marked(c.lead.replace(/^Clause\s+\S+\s*/i, ""), t.terms)}</div>` : "")
        + `<table class="cx-ft">${c.facts.map((x) => `<tr><td class="cx-fig">${esc(x.figure)}</td><td>${x.when ? `<span class="cx-when">${esc(x.when)}</span>` : ""}${marked(x.text, t.terms)}</td></tr>`).join("")}</table></div>`;
    }).join("") + `</div>`;
}

const pageImg = (d, w) => `/api/codes/sources/${encodeURIComponent(d.source)}/page/${d.page}.png?w=${w || 400}`;

function diagramsHtml(t, i) {
  const ds = t.diagrams || [];
  if (!ds.length) return "";
  return `<div class="cx-dgs">${ds.map((d, k) => `<button type="button" class="cx-dg" data-dg="${i}:${k}" title="Diagram ${esc(d.label)} - ${esc(d.caption)} (click to enlarge)">`
    + `<img src="${pageImg(d, 400)}" alt="Diagram ${esc(d.label)}" loading="lazy"><span><b>Diagram ${esc(d.label)}</b> ${esc(d.caption)}<small>${esc(d.title)} \u00b7 p.${d.page}</small></span></button>`).join("")}</div>`;
}

function openDiagram(t, k) {
  const ds = t.diagrams || [];
  let at = k;
  const back = document.createElement("div");
  back.className = "cx-lightbox";
  const paint = () => {
    const d = ds[at];
    const pdf = `/api/codes/sources/${encodeURIComponent(d.source)}/file#page=${d.page}`;
    back.innerHTML = `<div class="cx-lb-card"><div class="cx-lb-h"><b>Diagram ${esc(d.label)}</b> <span>${esc(d.caption)}</span><span class="spacer"></span>`
      + `${ds.length > 1 ? `<button type="button" class="ghost" data-lb="prev" title="Previous">&lsaquo;</button><span class="muted">${at + 1} / ${ds.length}</span><button type="button" class="ghost" data-lb="next" title="Next">&rsaquo;</button>` : ""}`
      + `<a class="ghost btn-a" href="${pdf}" target="_blank" rel="noopener">Open page ${d.page}</a><a class="ghost btn-a" href="${pageImg(d, 1400)}" download="Diagram ${esc(d.label)}.png">Download</a>`
      + `<button type="button" class="ghost" data-lb="x" title="Close">&times;</button></div>`
      + `<div class="cx-lb-img"><img src="${pageImg(d, 1400)}" alt="Diagram ${esc(d.label)}"></div><div class="cx-lb-f muted">${esc(d.title)} \u00b7 page ${d.page}</div></div>`;
  };
  paint();
  document.body.appendChild(back);
  const end = () => { back.remove(); document.removeEventListener("keydown", key, true); };
  const key = (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); end(); }
    else if (ev.key === "ArrowRight" && ds.length > 1) { at = (at + 1) % ds.length; paint(); }
    else if (ev.key === "ArrowLeft" && ds.length > 1) { at = (at - 1 + ds.length) % ds.length; paint(); }
  };
  document.addEventListener("keydown", key, true);
  back.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lb]");
    if (ev.target === back || (b && b.dataset.lb === "x")) return end();
    if (b && b.dataset.lb === "next") { at = (at + 1) % ds.length; paint(); }
    if (b && b.dataset.lb === "prev") { at = (at - 1 + ds.length) % ds.length; paint(); }
  });
}

/* ------------------------------------------------------------- the log */

function turnHtml(t, i) {
  const q = `<div class="cx-q"><div class="cx-bubble">${esc(t.q)}</div></div>`;
  let a = "";
  const n = (t.sources || []).length;
  // a search: Quick facts, the diagrams, the clauses (an answer kept from
  // before the Codes page had no AI is shown the same way)
  if (t.busy) a = `<div class="cx-found cx-wait">Finding the clauses ...</div>`;
  else if (t.err) a = `<p class="cx-why bad">${esc(t.why || "Not found")}</p>`;
  else {
    a = factsHtml(t, i) + diagramsHtml(t, i)
      + `<div class="cx-found">${n ? `${n} clause${n === 1 ? "" : "s"} found` : "No clause in the library matches - try the words the code uses"}`
      + (n ? ` <button type="button" class="ghost" data-show="${i}">Show</button>` : "") + `</div>`;
  }
  return `<div class="cx-turn" data-i="${i}">${q}${a}</div>`;
}

function render() {
  const log = $("#cx-log");
  if (!CX.turns.length) {
    log.innerHTML = `<div class="cx-empty"><h3>Search the building codes</h3>`
      + `<p class="muted">The clauses come from the documents in the office's library, with Quick facts - their figures and conditions - and the diagrams they refer to.</p>`
      + `<div class="cx-eg">${["What is the maximum travel distance in a dead end?", "Minimum width of a required staircase serving 200 persons?",
        "When is a fireman's lift required?", "TRS 的要求是甚麼？"].map((x) => `<button type="button" class="ghost">${esc(x)}</button>`).join("")}</div></div>`;
    for (const b of log.querySelectorAll(".cx-eg button")) b.onclick = () => { $("#cx-q").value = b.textContent; $("#cx-q").focus(); };
    return;
  }
  log.innerHTML = CX.turns.map(turnHtml).join("");
  log.scrollTop = log.scrollHeight;
}

function paintTurn(i) {
  const el = document.querySelector(`.cx-turn[data-i="${i}"]`);
  if (!el) return render();
  const near = $("#cx-log").scrollHeight - $("#cx-log").scrollTop - $("#cx-log").clientHeight < 80;
  el.outerHTML = turnHtml(CX.turns[i], i);
  if (near) $("#cx-log").scrollTop = $("#cx-log").scrollHeight;
}

/* ---------------------------------------------------------- the clauses */

function showSources(i, focus) {
  const t = CX.turns[i];
  if (!t) return;
  CX.shown = i;
  const side = $("#cx-side");
  side.classList.add("on");
  const src = t.sources || [];
  const cited = new Set(t.cited || []);
  $("#cx-side-title").textContent = `Clauses for "${t.q.slice(0, 40)}${t.q.length > 40 ? "..." : ""}"`;
  const order = src.map((s, k) => k + 1).sort((a, b) => (cited.has(b) - cited.has(a)) || a - b);
  $("#cx-clauses").innerHTML = src.length ? order.map((k) => {
    const s = src[k - 1];
    const file = s.pdf || s.source ? `/api/codes/sources/${encodeURIComponent(s.source)}/file${s.pdf && s.page ? "#page=" + s.page : ""}` : "";
    return `<div class="cx-cl${cited.has(k) ? " cited" : ""}" id="cx-cl-${k}">`
      + `<div class="cx-cl-h"><span class="cx-n">${k}</span><b>${esc(s.label)}</b></div>`
      + `<div class="cx-cl-m">${esc(s.kind_label)}${s.edition ? " · edition " + esc(s.edition) : ""}${s.status === "superseded" ? ` · <span class="cx-sup">superseded</span>` : ""}${s.kind === "internal" ? ` · <span class="cx-int">office note, not law</span>` : ""}</div>`
      + `<div class="cx-cl-t">${marked(s.read || s.text, t.terms)}</div>`
      + ((t.diagrams || []).some((d) => d.for === s.id) ? `<div class="cx-cl-dg">${(t.diagrams || []).map((d, dk) => (d.for === s.id ? `<button type="button" class="ghost" data-dg="${CX.turns.indexOf(t)}:${dk}">Diagram ${esc(d.label)} &rsaquo;</button>` : "")).join("")}</div>` : "")
      + `<div class="cx-cl-a">${file ? `<a href="${file}" target="_blank" rel="noopener">${s.pdf && s.page ? "Open page " + s.page : "Open document"}</a>` : ""}`
      + `${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Official page</a>` : ""}`
      + `<button type="button" class="ghost" data-more="${s.id}">More around it</button>`
      + `<button type="button" class="ghost" data-copycl="${k}">Copy</button></div></div>`;
  }).join("") : `<p class="muted cx-hint">No clauses.</p>`;
  for (const b of $("#cx-clauses").querySelectorAll("[data-copycl]")) {
    b.onclick = () => { const s = src[b.dataset.copycl - 1]; copy(`${s.label}${s.edition ? " (" + s.edition + ")" : ""}\n${s.text}`); };
  }
  for (const b of $("#cx-clauses").querySelectorAll("[data-more]")) b.onclick = () => more(b);
  if (focus) {
    const el = document.getElementById("cx-cl-" + focus);
    if (el) { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  } else $("#cx-clauses").scrollTop = 0;
}

async function more(b) {
  const box = b.closest(".cx-cl").querySelector(".cx-cl-t");
  b.disabled = true;
  try {
    const r = await api("/api/codes/clause/" + b.dataset.more);
    box.innerHTML = r.around.map((x) => `<div class="${x.id === r.clause.id ? "cx-here" : "cx-nb"}">${x.ref ? `<small>${esc(x.ref)}${x.page ? " · p." + x.page : ""}</small>` : ""}${esc(x.text)}</div>`).join("");
    b.remove();
  } catch (e) { toast(e.message, true); b.disabled = false; }
}

function copy(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard")))
    .then(() => toast("Copied"), () => {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("Copied"); } catch (e) { toast("Could not copy", true); }
      ta.remove();
    });
}

/* ------------------------------------------------------------- finding */

async function find() {
  const q = $("#cx-q").value.trim();
  if (!q) return $("#cx-q").focus();
  if (CX.turns.some((t) => t.busy)) return;
  $("#cx-q").value = "";
  const i = CX.turns.length;
  CX.turns.push({ q, kind: "search", sources: [], busy: true });
  render();
  try {
    const r = await api("/api/codes/search?" + new URLSearchParams({ q, n: 25 }));
    Object.assign(CX.turns[i], { sources: r.items, terms: r.terms, facts: r.facts || [], diagrams: r.diagrams || [], busy: false });
  } catch (e) { Object.assign(CX.turns[i], { busy: false, why: e.message, err: true }); }
  paintTurn(i);
  save();
  if (CX.turns[i].sources.length && !phone()) showSources(i);
}

/* --------------------------------------------------------------- library */

const KIND_HINT = { ordinance: "e.g. Buildings Ordinance (Cap 123)", regulation: "e.g. Building (Planning) Regulations (Cap 123F)",
  pnap: "e.g. PNAP APP-152", code: "e.g. Code of Practice for Fire Safety in Buildings 2011", guide: "e.g. Design Manual: Barrier Free Access 2008",
  internal: "e.g. BD comments on GBP, our practice", other: "" };

/* The catalogue of what the Buildings Department publishes (server reads
   its index pages, kept a day): for Find documents, and to mark a library
   document that has a newer edition on the web. */
let CAT = null;
async function catalogue(refresh) {
  if (CAT && !refresh) return CAT;
  CAT = await api("/api/codes/catalogue" + (refresh ? "?refresh=1" : ""));
  return CAT;
}

async function openLibrary(tab) {
  closePop();
  let r;
  try { r = await api("/api/codes/sources"); } catch (e) { return toast(e.message, true); }
  CX.kinds = r.kinds;
  const admin = CX.st && CX.st.manage;
  const back = document.createElement("div");
  back.className = "t-modal-back";
  back.innerHTML = `<div class="t-modal cx-libm"><div class="cx-libtabs"><h3>Library</h3><button type="button" class="cx-ltab on" data-lt="lib">In the library</button>`
    + `<button type="button" class="cx-ltab" data-lt="find" title="The codes, PNAPs and practice notes the Buildings Department publishes">Find documents</button></div>`
    + `<div class="cx-lib-body"></div><div class="cx-find-body" hidden></div>`
    + `<div class="t-modal-foot"><span class="spacer"></span><button type="button" class="primary" data-x>Done</button></div></div>`;
  document.body.appendChild(back);
  const end = () => { back.remove(); loadStatus(); };
  back.querySelector("[data-x]").onclick = end;
  back.addEventListener("pointerdown", (ev) => { if (ev.target === back) end(); });
  back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") end(); });
  const body = back.querySelector(".cx-lib-body");
  const fbody = back.querySelector(".cx-find-body");
  let PEND = null;          // a document fetched from the web, waiting for Add
  const showTab = (t) => {
    for (const b of back.querySelectorAll(".cx-ltab")) b.classList.toggle("on", b.dataset.lt === t);
    body.hidden = t !== "lib"; fbody.hidden = t !== "find";
    if (t === "find") paintFind();
  };
  for (const b of back.querySelectorAll(".cx-ltab")) b.onclick = () => showTab(b.dataset.lt);
  const newerOf = (sid) => (CAT ? CAT.docs.find((d) => d.in_library === sid && d.newer) : null);
  const kindOpts = (sel) => CX.kinds.map((k) => `<option value="${k.id}"${k.id === sel ? " selected" : ""}>${esc(k.label)}</option>`).join("");

  const paint = async () => {
    const list = r.sources;
    let html = `<table class="cx-lib"><thead><tr><th>Document</th><th>Kind</th><th>Edition</th><th class="num">Clauses</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>`
      + (list.length ? list.map((s) => `<tr class="${s.status === "superseded" ? "sup" : ""}" data-id="${s.id}">`
        + `<td><a href="/api/codes/sources/${s.id}/file" target="_blank" rel="noopener">${esc(s.title)}</a>${s.status === "superseded" ? ` <span class="cx-sup">superseded</span>` : ""}`
        + (newerOf(s.id) ? ` <button type="button" class="cx-newer" data-newer="${esc(newerOf(s.id).url)}" title="The Buildings Department lists ${esc(newerOf(s.id).edition || newerOf(s.id).date)} - get it and add it (then mark this one superseded)">newer on the web: ${esc(newerOf(s.id).edition || newerOf(s.id).date)}</button>` : "")
        + `<br><small class="muted">${s.pages ? s.pages + " pages · " : ""}${esc(s.ext.toUpperCase())} · added by ${esc(s.added_by || "?")} ${new Date(s.added_at * 1000).toLocaleDateString()}</small></td>`
        + `<td>${esc(s.kind_label)}</td><td>${esc(s.edition || "-")}</td><td class="num">${s.chunks}</td>`
        + (admin ? `<td class="cx-lib-act"><button type="button" class="ghost" data-edit="${s.id}">Edit</button></td>` : "") + `</tr>`).join("")
        : `<tr><td colspan="5" class="muted">No documents yet.</td></tr>`) + `</tbody></table>`;
    if (admin) {
      html += `<details class="cx-add" open><summary>Add a document</summary>`
        + `<div class="cx-web"><label>From the web<input id="lb-web" type="url" placeholder="https://www.bd.gov.hk/doc/en/.../APP151.pdf - the address of the PDF"></label>`
        + `<button type="button" class="ghost" id="lb-get" title="Download it on the server and read its title, kind and edition">Get</button>`
        + `<button type="button" class="ghost" id="lb-find" title="Find it in the list of the Buildings Department's documents">Find documents ...</button></div>`
        + `<p class="muted small" id="lb-got"></p>`
        + `<div class="cx-grid"><label>or a file (PDF, Word, text)<input type="file" id="lb-file" accept=".pdf,.docx,.txt,.md"></label>`
        + `<label>Title<input id="lb-title" placeholder="${esc(KIND_HINT.code)}"></label>`
        + `<label>Kind<select id="lb-kind">${kindOpts("code")}</select></label>`
        + `<label>Edition / date<input id="lb-ed" placeholder="e.g. 2011 (Dec 2015 amendment)"></label>`
        + `<label class="wide">Official page (optional)<input id="lb-url" placeholder="https://www.bd.gov.hk/..."></label></div>`
        + `<div class="row end"><span class="muted" id="lb-msg"></span><button type="button" class="primary" id="lb-go">Add to the library</button></div>`
        + `<p class="muted small">A scanned PDF needs its text first (Acrobat > Scan &amp; OCR). Each document is split into its clauses, keeping clause numbers and pages.</p></details>`
        + `<details class="cx-add"><summary>Add an office note (pasted text)</summary>`
        + `<div class="cx-grid"><label>Title<input id="nt-title" placeholder="e.g. BD comments - MOE, 2025"></label><label>Kind<select id="nt-kind">${kindOpts("internal")}</select></label>`
        + `<label class="wide">Text<textarea id="nt-text" rows="6" placeholder="Paste the text. Number the points (1. 2. or B5.1 ...) to keep them apart."></textarea></label></div>`
        + `<div class="row end"><button type="button" class="primary" id="nt-go">Add the note</button></div></details>`;
    }
    body.innerHTML = html;
    if (!admin) return;
    $("#lb-kind", body).onchange = () => { $("#lb-title", body).placeholder = KIND_HINT[$("#lb-kind", body).value] || ""; };
    $("#lb-file", body).onchange = () => {
      const f = $("#lb-file", body).files[0];
      if (f) { PEND = null; $("#lb-got", body).textContent = ""; }
      if (f && !$("#lb-title", body).value) $("#lb-title", body).value = f.name.replace(/\.[^.]+$/, "");
    };
    $("#lb-find", body).onclick = () => showTab("find");
    $("#lb-get", body).onclick = () => getFromWeb($("#lb-web", body).value.trim());
    $("#lb-web", body).onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); getFromWeb($("#lb-web", body).value.trim()); } };
    for (const b of body.querySelectorAll("[data-newer]")) b.onclick = () => getFromWeb(b.dataset.newer);
    $("#lb-go", body).onclick = async () => {
      const f = $("#lb-file", body).files[0];
      if (!f && !PEND) return toast("Choose a file, or Get one from the web first", true);
      const btn = $("#lb-go", body); btn.disabled = true;
      $("#lb-msg", body).textContent = f ? "Uploading and reading the clauses ..." : "Reading the clauses ...";
      try {
        const qs = new URLSearchParams({ file: f ? f.name : PEND.name, title: $("#lb-title", body).value, kind: $("#lb-kind", body).value, edition: $("#lb-ed", body).value, url: $("#lb-url", body).value });
        if (!f) qs.set("pending", PEND.pending);
        const res = await fetch("/api/codes/sources?" + qs, { method: "POST", headers: headers(false), body: f || "" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.detail || "HTTP " + res.status);
        toast(`Added: ${d.source.title} - ${d.source.chunks} clauses`);
        PEND = null;
        r = await api("/api/codes/sources");
        CAT = null;              // asked again (the server's copy, marked afresh): "in the library"
        paint();
      } catch (e) { $("#lb-msg", body).textContent = e.message; btn.disabled = false; }
    };
    $("#nt-go", body).onclick = async () => {
      try {
        const d = await api("/api/codes/notes", { method: "POST", body: JSON.stringify({ title: $("#nt-title", body).value, kind: $("#nt-kind", body).value, text: $("#nt-text", body).value }) });
        toast(`Added: ${d.source.title}`);
        r = await api("/api/codes/sources");
        paint();
      } catch (e) { toast(e.message, true); }
    };
    for (const b of body.querySelectorAll("[data-edit]")) b.onclick = () => editSource(r.sources.find((s) => s.id === b.dataset.edit), async () => { r = await api("/api/codes/sources"); paint(); });
  };

  // a document from a web address: downloaded on the server, its details
  // read (the BD catalogue, the address, the PDF) and put in the form
  async function getFromWeb(url) {
    if (!admin) return;
    showTab("lib");
    const add = body.querySelector(".cx-add"); if (add) add.open = true;
    if (!/^https?:\/\//i.test(url || "")) return toast("A web address starting with https:// please", true);
    $("#lb-web", body).value = url;
    const got = $("#lb-got", body), btn = $("#lb-get", body);
    got.textContent = "Getting it and reading its details ..."; btn.disabled = true;
    try {
      const d = await api("/api/codes/fetch", { method: "POST", body: JSON.stringify({ url }) });
      PEND = d;
      const g = d.guess;
      $("#lb-file", body).value = "";
      $("#lb-title", body).value = g.title || "";
      if (g.kind && [...$("#lb-kind", body).options].some((o) => o.value === g.kind)) $("#lb-kind", body).value = g.kind;
      $("#lb-ed", body).value = g.edition || "";
      $("#lb-url", body).value = url;
      for (const id of ["#lb-title", "#lb-kind", "#lb-ed"]) $(id, body).classList.toggle("cx-guessed", !!g.from);
      got.innerHTML = `Got <b>${esc(d.name)}</b> (${(d.size / 1048576).toFixed(1)} MB${d.pages ? `, ${d.pages} pages` : ""}).`
        + (g.from ? ` Title, kind and edition from ${esc(g.from)} - check them, then <b>Add to the library</b>.` : " Fill in its details, then Add to the library.");
      $("#lb-title", body).focus();
    } catch (e) { got.textContent = e.message; PEND = null; }
    finally { btn.disabled = false; }
  }

  // Find documents: what the Buildings Department publishes, searchable
  let FQ = "", FSRC = "";
  async function paintFind(refresh) {
    if (!fbody.dataset.ready) {
      fbody.dataset.ready = "1";
      fbody.innerHTML = `<div class="cx-fhead"><input id="fd-q" type="search" placeholder="Number or words - e.g. APP-151, fire safety, JPN 1"><button type="button" class="ghost" id="fd-ref" title="Read the Buildings Department's pages again">Refresh</button></div>`
        + `<div class="cx-fsrc"></div><div class="cx-flist"><p class="muted">Reading the Buildings Department's lists ...</p></div>`;
      const q = $("#fd-q", fbody);
      q.oninput = () => { FQ = q.value; list(); };
      $("#fd-ref", fbody).onclick = () => paintFind(true);
      setTimeout(() => q.focus(), 30);
    }
    try { await catalogue(!!refresh); } catch (e) {
      $(".cx-flist", fbody).innerHTML = `<p class="cx-why bad">Could not read the Buildings Department's site from the server: ${esc(e.message)}. Choose File still works.</p>`;
      return;
    }
    const srcs = CAT.sources;
    $(".cx-fsrc", fbody).innerHTML = [`<button type="button" class="cx-chip${!FSRC ? " on" : ""}" data-src="">All</button>`]
      .concat(srcs.map((x) => `<button type="button" class="cx-chip${FSRC === x.id ? " on" : ""}${x.ok ? "" : " bad"}" data-src="${x.id}" title="${esc(x.ok ? x.page : x.error)}">${esc(x.label)}${x.ok ? ` <small>${x.n}</small>` : " (not read)"}</button>`)).join("");
    for (const b of fbody.querySelectorAll("[data-src]")) b.onclick = () => { FSRC = b.dataset.src; paintFind(); };
    list();
    // the library list's "newer on the web" marks: once (or after Refresh) -
    // drawing it again empties what is typed in Add a document
    if (refresh || !body.dataset.marked) { body.dataset.marked = "1"; paint(); }
  }
  function list() {
    if (!CAT) return;
    const words = FQ.toLowerCase().replace(/[-\s]+/g, " ").split(" ").filter(Boolean);
    const hay = (d) => (d.number + " " + d.title + " " + d.edition + " " + d.source).toLowerCase().replace(/[-\s]+/g, " ");
    const hits = CAT.docs.filter((d) => (!FSRC || d.src === FSRC) && words.every((w) => hay(d).includes(w)));
    const shown = hits.slice(0, 200);
    $(".cx-flist", fbody).innerHTML = (hits.length ? `<p class="muted small">${hits.length} document${hits.length === 1 ? "" : "s"}${hits.length > 200 ? " - the first 200 shown; type more to narrow it" : ""} · read ${new Date(CAT.at * 1000).toLocaleString()}</p>` : `<p class="muted">Nothing matches.</p>`)
      + `<table class="cx-lib cx-cat"><tbody>` + shown.map((d) => `<tr><td class="cx-no">${esc(d.number)}</td><td>${esc(d.title)}<br><small class="muted">${esc(d.source)}${d.edition || d.date ? " · " + esc(d.edition || d.date) : ""}${d.availability ? " · print copy: " + esc(d.availability).toLowerCase() : ""}</small></td>`
        + `<td class="cx-st">${d.in_library ? (d.newer ? `<span class="cx-newer-b" title="In the library as ${esc(d.library_edition)}">newer than the library's</span>` : `<span class="cx-inlib">in the library</span>`) : ""}</td>`
        + `<td class="cx-lib-act"><a class="ghost btn-a" href="${esc(d.url)}" target="_blank" rel="noopener">Open</a>`
        + (admin && !d.open_only && (!d.in_library || d.newer) ? ` <button type="button" class="ghost" data-get="${esc(d.url)}">Add</button>` : "")
        + (d.open_only ? ` <small class="muted" title="eLegislation's pages are built by script: download the PDF there (its download button), then Choose File">download it there</small>` : "") + `</td></tr>`).join("") + `</tbody></table>`;
    for (const b of fbody.querySelectorAll("[data-get]")) b.onclick = () => getFromWeb(b.dataset.get);
  }

  paint();
  if (tab === "find") showTab("find");
  else catalogue().then(() => { if (!body.dataset.marked && !PEND && !(body.querySelector("#lb-title") || {}).value) { body.dataset.marked = "1"; paint(); } }).catch(() => {});
}

function editSource(s, done) {
  const kindOpts = CX.kinds.map((k) => `<option value="${k.id}"${k.id === s.kind ? " selected" : ""}>${esc(k.label)}</option>`).join("");
  const html = `<div class="cx-grid"><label class="wide">Title<input id="es-title" value="${esc(s.title)}"></label>`
    + `<label>Kind<select id="es-kind">${kindOpts}</select></label><label>Edition / date<input id="es-ed" value="${esc(s.edition || "")}"></label>`
    + `<label class="wide">Official page<input id="es-url" value="${esc(s.url || "")}"></label>`
    + `<label class="wide cx-chk"><input type="checkbox" id="es-sup"${s.status === "superseded" ? " checked" : ""}> Superseded - left out of searches and answers (kept for the record)</label></div>`
    + `<p><button type="button" class="ghost danger" id="es-del">Remove from the library ...</button></p>`;
  const back = document.createElement("div");
  back.className = "t-modal-back";
  back.innerHTML = `<form class="t-modal" onsubmit="return false"><h3>${esc(s.title)}</h3>${html}<div class="t-modal-foot"><span class="spacer"></span>`
    + `<button type="button" class="ghost" data-x>Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
  document.body.appendChild(back);
  const f = back.querySelector("form");
  back.querySelector("[data-x]").onclick = () => back.remove();
  f.querySelector("#es-del").onclick = async () => {
    if (!confirm(`Remove "${s.title}" and its ${s.chunks} clauses from the library?`)) return;
    try { await api("/api/codes/sources/" + s.id, { method: "DELETE" }); back.remove(); toast("Removed"); done(); } catch (e) { toast(e.message, true); }
  };
  f.onsubmit = async () => {
    try {
      await api("/api/codes/sources/" + s.id, { method: "PATCH", body: JSON.stringify({ title: f.querySelector("#es-title").value, kind: f.querySelector("#es-kind").value,
        edition: f.querySelector("#es-ed").value, url: f.querySelector("#es-url").value, status: f.querySelector("#es-sup").checked ? "superseded" : "current" }) });
      back.remove(); done();
    } catch (e) { toast(e.message, true); }
    return false;
  };
}

/* ----------------------------------------------------------------- start */

async function recent(btn) {
  let r;
  try { r = await api("/api/codes/history"); } catch (e) { return toast(e.message, true); }
  const items = r.items || [];
  const p = pop(btn, items.length ? items.map((x, k) => `<button type="button" class="cx-rq" data-k="${k}">${esc(x.q.slice(0, 120))}<small class="muted">${new Date(x.at * 1000).toLocaleString()}</small></button>`).join("")
    : `<p class="muted" style="padding:8px">No searches yet.</p>`, 380);
  for (const b of p.querySelectorAll(".cx-rq")) {
    b.onclick = () => {
      const x = items[b.dataset.k];
      closePop();
      $("#cx-q").value = x.q;
      find();
    };
  }
}

/* Search the codes | GBP workbook (gbp.js): the workbook opens on first use;
   a § source in it finds that clause in the library here */
let GBP_ON = false;
function showTab(tab) {
  for (const b of document.querySelectorAll(".cx-tab")) b.classList.toggle("on", b.dataset.tab === tab);
  $("#codes").hidden = tab !== "ask";
  $("#gbp").hidden = tab !== "gbp";
  try { localStorage.setItem("lwk-viewer:codes-tab", tab); } catch (e) {}
  const u = new URL(location.href);
  if (tab === "gbp") u.searchParams.set("tab", "gbp"); else u.searchParams.delete("tab");
  history.replaceState(null, "", u.pathname + u.search);
  if (tab === "gbp" && !GBP_ON) {
    GBP_ON = true;
    mountGbp($("#gbp"), { findClause: (q) => { showTab("ask"); $("#cx-q").value = q; find(); } })
      .catch((e) => { GBP_ON = false; $("#gbp").innerHTML = `<p class="muted" style="padding:20px">${esc(e.message)}</p>`; });
  }
}

async function start() {
  CX.me = await ensureSignedIn();
  header(CX.me);
  for (const b of document.querySelectorAll(".cx-tab")) b.onclick = () => showTab(b.dataset.tab);
  {
    let t = new URLSearchParams(location.search).get("tab");
    if (!t) { try { t = localStorage.getItem("lwk-viewer:codes-tab"); } catch (e) {} }
    if (t === "gbp") showTab("gbp");
  }
  load();
  render();
  await loadStatus();
  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("#cx-q").value = q; history.replaceState(null, "", location.pathname + (project() ? "?project=" + encodeURIComponent(project()) : "")); }
  $("#cx-form").onsubmit = () => { find(); return false; };
  $("#cx-q").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); find(); } });
  $("#cx-new").onclick = () => { CX.turns = []; CX.shown = -1; save(); render(); $("#cx-side").classList.remove("on"); $("#cx-clauses").innerHTML = ""; $("#cx-q").focus(); };
  $("#cx-lib").onclick = () => openLibrary();
  $("#cx-recent").onclick = () => recent($("#cx-recent"));
  $("#cx-side-x").onclick = () => $("#cx-side").classList.remove("on");
  const dgClick = (ev) => {
    const d = ev.target.closest("[data-dg]");
    if (!d) return false;
    const [ti, k] = d.dataset.dg.split(":").map(Number);
    if (CX.turns[ti]) openDiagram(CX.turns[ti], k);
    return true;
  };
  $("#cx-clauses").addEventListener("click", (ev) => { dgClick(ev); });
  $("#cx-log").addEventListener("click", (ev) => {
    if (dgClick(ev)) return;
    const fr = ev.target.closest(".cx-fref");
    if (fr) return showSources(Number(fr.dataset.turn), Number(fr.dataset.s));
    const s = ev.target.closest("[data-show]");
    if (s) return showSources(Number(s.dataset.show));
  });
  const last = CX.turns.length - 1;
  if (last >= 0 && !phone() && (CX.turns[last].sources || []).length) showSources(last);
  $("#cx-q").focus();
}

start().catch((e) => { if (!/Set your own password/.test(e.message)) toast(e.message, true); });
