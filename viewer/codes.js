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
import { mountGbp, showPart } from "./gbp.js";

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
  try { CX.kb = await api("/api/kb/status"); } catch (e) { CX.kb = null; }
  const s = CX.st;
  const kbTxt = CX.kb && CX.kb.on ? ` · summaries: ${CX.kb.pages} pages` : "";
  $("#cx-state").innerHTML = s.sources
    ? `${s.sources} document${s.sources === 1 ? "" : "s"}, ${s.clauses} clauses${kbTxt}`
    : (s.manage ? `The library is empty: <a href="#" id="cx-first">find the documents on the BD site</a> or <a href="#" id="cx-first2">add your own</a>` : "The library is empty - ask a site admin to add the codes");
  const f = $("#cx-first");
  if (f) f.onclick = (ev) => { ev.preventDefault(); openLibrary("find"); };
  const f2 = $("#cx-first2");
  if (f2) f2.onclick = (ev) => { ev.preventDefault(); openLibrary(); };
  paintKbBar();
  const lt = document.querySelector('.cx-tab[data-tab="lib"]');
  if (lt) lt.hidden = !s.manage;
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

/* -------------------------------------------- the knowledge base's answers */

const KB_ICON = { guide: "&#128218;", regulation: "&#167;", code: "&#128214;", pnap: "&#128196;", jpn: "&#128196;", apsec: "&#128172;", glossary: "&#128292;", workflow: "&#128260;" };
function kbHtml(t, i) {
  const items = t.kb || [];
  if (!items.length) return "";
  return `<div class="cx-kb"><div class="cx-facts-h"><b>From the summaries</b><span class="muted">the office's knowledge base</span></div>`
    + items.slice(0, 5).map((x, k) => `<div class="cx-kbc cx-kb-${esc(x.kind)}">`
      + `<div class="cx-kbc-h"><span class="cx-kbk">${KB_ICON[x.kind] || ""} ${esc(x.kind_label)}${x.date ? " \u00b7 " + esc(x.date) : ""}</span>`
      + (x.draft ? `<span class="cx-kbdraft" title="The author marked this page as a draft - not yet checked">draft</span>` : "")
      + (x.edited_by ? `<span class="cx-kbed" title="Edited in the viewer">&#9998; edited by ${esc(x.edited_by)}</span>` : "")
      + `<button type="button" class="cx-kbt" data-kb="${i}:${k}" title="Open in the Knowledge base">${esc(x.title)}${x.zh ? ` <small>${esc(x.zh)}</small>` : ""}</button></div>`
      + (x.section ? `<div class="cx-kbs">${esc(x.section)}</div>` : "")
      + `<div class="cx-kbx">${marked(x.edits ? x.edits.slice(0, 320) : x.snippet, t.terms)}</div>`
      + `<details class="cx-kbd"><summary>Read here</summary><div class="cx-kbr">${marked(x.read, t.terms)}${x.read_zh ? `<hr>${marked(x.read_zh, t.terms)}` : ""}</div></details>`
      + `<div class="cx-kba"><button type="button" class="ghost" data-kb="${i}:${k}">Open the page &rsaquo;</button>`
      + (x.info && x.info["version summarised"] ? `<span class="muted">version ${esc(x.info["version summarised"])}${x.info["last checked"] ? " \u00b7 checked " + esc(x.info["last checked"].slice(0, 10)) : ""}</span>` : "")
      + `</div></div>`).join("") + `</div>`;
}
function kbFactsHtml(t, i) {
  const f = t.kbfacts || [];
  if (!f.length) return "";
  return `<div class="cx-facts cx-facts-kb"><div class="cx-facts-h"><b>Quick facts</b><span class="muted">from the summaries - their figures and conditions</span></div>`
    + f.map((c) => `<div class="cx-fc"><button type="button" class="cx-fref" data-kbf="${esc(c.url)}#${esc(c.anchor || "")}" title="Open in the Knowledge base">${esc(c.title || "")}${c.ref ? " \u00b7 " + esc(c.ref) : ""}</button>`
      + (c.lead ? `<div class="cx-flead">${marked(c.lead, t.terms)}</div>` : "")
      + `<table class="cx-ft">${c.facts.map((x) => `<tr><td class="cx-fig">${esc(x.figure)}</td><td>${x.when ? `<span class="cx-when">${esc(x.when)}</span>` : ""}${marked(x.text, t.terms)}</td></tr>`).join("")}</table></div>`).join("")
    + `</div>`;
}
function kbFigsHtml(t, i) {
  const figs = [];
  (t.kb || []).forEach((x, k) => (x.figures || []).forEach((f) => { if (figs.length < 6 && !figs.some((g) => g.url === f.url)) figs.push(Object.assign({ k, title: x.title }, f)); }));
  if (!figs.length) return "";
  return `<div class="cx-dgs">${figs.map((f) => `<button type="button" class="cx-dg cx-kbfig" data-kb="${i}:${f.k}" title="${esc(f.alt)} - open the page">`
    + `<img src="${esc(f.url)}" alt="${esc(f.alt)}" loading="lazy"><span><b>${esc((f.alt || "Diagram").slice(0, 80))}</b><small>${esc(f.title)}</small></span></button>`).join("")}</div>`;
}

/* --------------------------------------------- the Knowledge base tab */

let KB_LOADED = "";
function openKb(path) {
  showTab("kb", path || "");
}
function paintKbBar() {
  const bar = $("#kb-ver");
  if (!bar) return;
  const k = CX.kb;
  bar.textContent = k && k.on ? `Version ${String(k.sha || "").slice(0, 7)} \u00b7 ${k.date ? new Date(k.date).toLocaleDateString() : ""} \u00b7 ${k.message || ""}` : "";
  const empty = $("#kb-empty");
  if (empty) {
    empty.hidden = !!(k && k.on);
    empty.innerHTML = k && k.on ? "" : `<h3>The knowledge base is not connected yet</h3><p class="muted">${k && k.updating ? "It is being fetched and built now ..." : k && k.manage
      ? `Connect it in <a href="#" id="kb-setup">Library > Knowledge base</a>: the GitHub branch the summaries are written on, and a read-only token.`
      : "A site admin connects it in Codes > Library > Knowledge base."}</p>${k && k.error ? `<p class="cx-why bad">${esc(k.error)}</p>` : ""}`;
    const a = $("#kb-setup");
    if (a) a.onclick = (ev) => { ev.preventDefault(); openLibrary(); };
  }
  $("#kb-frame").hidden = !(k && k.on);
}

function paintKbBox() {
  const box = $("#cx-kbbox");
  if (!box) return;
  const k = CX.kb || {};
  const st = k.settings || {};
  const ver = k.on ? `<p>In the viewer: <b>${k.pages} pages</b>, ${k.sections} sections · commit <code>${esc(String(k.sha || "").slice(0, 7))}</code> ${k.date ? "of " + esc(new Date(k.date).toLocaleString()) : ""} - ${esc(k.message || "")}${k.checked ? ` · checked ${esc(new Date(k.checked).toLocaleString())}` : ""}</p>` : `<p class="muted">Not connected yet.</p>`;
  box.innerHTML = `<h3>Knowledge base</h3><p class="muted">The office's summaries of the Ordinance, regulations, Codes of Practice, PNAPs and APSEC - written on a GitHub branch, built here with MkDocs, and searched first by Codes.</p>${ver}`
    + (k.updating ? `<p class="cx-wait">${esc(k.log || "Updating ...")}</p>` : "")
    + (k.error ? `<p class="cx-why bad">${esc(k.error)}</p>` : "")
    + (k.manage ? `<form class="cx-kbform" onsubmit="return false">
      <div class="cx-grid"><label>Source<select name="source"><option value="github"${st.source !== "folder" ? " selected" : ""}>GitHub branch</option><option value="folder"${st.source === "folder" ? " selected" : ""}>A folder on the server</option></select></label>
      <label class="kb-gh">Repository (owner/name)<input name="repo" value="${esc(st.repo || "")}"></label>
      <label class="kb-gh">Branch<input name="branch" value="${esc(st.branch || "")}"></label>
      <label class="kb-gh">GitHub token ${st.token_set ? `<span class="cx-ok">saved</span>` : ""}<input name="token" type="password" autocomplete="off" placeholder="${st.token_set ? "leave empty to keep it" : "a fine-grained token: Contents read-only"}"></label>
      <label class="kb-fo">Folder on the server (a checkout of the branch)<input name="folder" value="${esc(st.folder || "")}"></label>
      <label class="row-check"><input type="checkbox" name="auto"${st.auto !== false ? " checked" : ""}> Update every day</label></div>
      <div class="row end"><button type="button" class="ghost" id="kb-save">Save</button><button type="button" class="primary" id="kb-now"${k.updating ? " disabled" : ""}>Update now</button></div>
      <p class="muted small">The token is kept on the server and never shown again. GitHub > Settings > Developer settings > Fine-grained tokens: this repository only, Contents: Read-only.</p></form>` : "");
  box.insertAdjacentHTML("beforeend", `<div class="cx-kbedits" id="cx-kbedits"><p class="muted">Loading the edits ...</p></div>`
    + (k.on ? `<div class="cx-kbthin" id="cx-kbthin"></div>` : ""));
  paintKbEdits();
  if (k.on) paintKbThin();
  const f = box.querySelector("form");
  if (!f) return;
  const showSrc = () => { for (const el of f.querySelectorAll(".kb-gh")) el.hidden = f.source.value !== "github"; for (const el of f.querySelectorAll(".kb-fo")) el.hidden = f.source.value !== "folder"; };
  f.source.onchange = showSrc; showSrc();
  const send = async () => {
    const body = { source: f.source.value, repo: f.repo.value.trim(), branch: f.branch.value.trim(), folder: f.folder.value.trim(), auto: f.auto.checked };
    if (f.token.value.trim()) body.token = f.token.value.trim();
    await api("/api/kb/settings", { method: "POST", body: JSON.stringify(body) });
  };
  $("#kb-save").onclick = async () => { try { await send(); toast("Saved"); await loadStatus(); paintKbBox(); } catch (e) { toast(e.message, true); } };
  $("#kb-now").onclick = async () => {
    try { await send(); await api("/api/kb/update?force=1", { method: "POST" }); } catch (e) { return toast(e.message, true); }
    toast("Fetching and building the knowledge base ...");
    const poll = async () => {
      await loadStatus(); paintKbBox();
      if (CX.kb && CX.kb.updating) return setTimeout(poll, 1500);
      KB_LOADED = "";
      toast(CX.kb && CX.kb.error ? "Not updated: " + CX.kb.error : `Knowledge base updated: ${CX.kb.pages} pages`, !!(CX.kb && CX.kb.error));
    };
    setTimeout(poll, 1200);
  };
}

/* the thin pages: the summaries too brief for their tier, to fill in first */
let THIN_TIER = "A";
async function paintKbThin() {
  const el = $("#cx-kbthin");
  if (!el) return;
  let r;
  try { r = await api("/api/kb/thin"); } catch (e) { el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const c = r.counts;
  const TIERS = { A: "Key documents (full template)", B: "Other APP / JPN / regulations / codes / guides", C: "ADM / ADV notes" };
  const rows = r.items.filter((x) => x.tier === THIN_TIER && x.thin);
  const tick = (v) => (v ? `<span class="cx-ok">&#10003;</span>` : `<span class="cx-no">&ndash;</span>`);
  el.innerHTML = `<h4>Thin pages</h4><p class="muted">Summaries too brief to answer from, by what their tier needs. Fill these in first (send the list to the knowledge base's author).</p>`
    + `<div class="cx-thin-tiers">${"ABC".split("").map((t) => `<button type="button" class="ghost${t === THIN_TIER ? " on" : ""}" data-tier="${t}" title="${esc(TIERS[t])}">Tier ${t}: <b>${c[t].thin}</b> of ${c[t].pages}</button>`).join("")}`
    + `<span class="spacer"></span><a class="ghost btn-a" href="/api/kb/thin?format=md" download>Download the list</a><a class="ghost btn-a" href="/api/kb/thin?format=csv" download>CSV</a></div>`
    + `<p class="muted small">${esc(TIERS[THIN_TIER])}. Pages with <code>summary:</code>: ${c.summary} of ${c.all}; with <code>keywords:</code>: ${c.keywords} of ${c.all}.</p>`
    + (rows.length ? `<div class="cx-thin-wrap"><table class="cx-lib cx-thin"><thead><tr><th>Page</th><th class="num">Words</th><th title="At a glance">Glance</th><th title="Key clauses">Clauses</th><th title="Explanation">Expl.</th><th title="Practical notes / pitfalls">Notes</th><th title="Worked example">Ex.</th><th>What is missing</th></tr></thead><tbody>`
      + rows.map((x) => `<tr><td><a href="#" data-kbgo="${esc(x.path)}">${esc(x.title)}</a><br><small class="muted">${esc(x.path)}</small></td><td class="num">${x.words}</td>`
        + `<td>${tick(x.has.glance)}</td><td>${tick(x.has.clauses)}</td><td>${tick(x.has.explanation)}</td><td>${tick(x.has.notes)}</td><td>${tick(x.has.example)}</td>`
        + `<td><small>${esc(x.why.filter((w) => !/^no (summary|keywords):/.test(w)).join("; "))}</small></td></tr>`).join("") + `</tbody></table></div>`
      : `<p class="muted">None in this tier - well done.</p>`);
  el.onclick = (ev) => {
    const t = ev.target.closest("[data-tier]");
    if (t) { THIN_TIER = t.dataset.tier; paintKbThin(); return; }
    const g = ev.target.closest("[data-kbgo]");
    if (g) { ev.preventDefault(); const p = g.dataset.kbgo.replace(/\.md$/, "/").replace(/(^|\/)index\/$/, "$1"); KB_LOADED = ""; showTab("kb", p); }
  };
}

/* edits made in the knowledge base pages, under the viewer's accounts */
async function paintKbEdits() {
  const el = $("#cx-kbedits");
  if (!el) return;
  let r;
  try { r = await api("/api/kb/edits/recent?n=15"); } catch (e) { el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const k = CX.kb || {};
  const when = (t) => new Date(t).toLocaleString();
  el.innerHTML = `<h4>Edits made in the viewer</h4><p>${r.live} live edit${r.live === 1 ? "" : "s"}, <b>${r.not_merged}</b> not yet in the source.`
    + (k.manage ? ` <a class="ghost btn-a" href="/api/kb/edits/all?format=md" download>Download edits (for the knowledge base's author)</a> <a class="ghost btn-a" href="/api/kb/edits/all" download>JSON</a>` : "") + `</p>`
    + (r.items.length ? `<table class="cx-lib cx-edl"><thead><tr><th>When</th><th>Who</th><th>Page</th><th>Change</th><th></th></tr></thead><tbody>${r.items.map((e) => `<tr class="${e.undone ? "sup" : ""}">`
      + `<td>${esc(when(e.at))}</td><td>${esc(e.name)}</td><td><a href="#" data-kbgo="${esc(e.page)}">${esc(e.page)}</a></td>`
      + `<td><del>${esc((e.original || "").slice(0, 90))}</del><br><ins>${esc((e.text || "").slice(0, 90))}</ins>${e.note ? `<br><small class="muted">${esc(e.note)}</small>` : ""}</td>`
      + `<td>${e.undone ? `<small class="muted">undone${e.undone_by ? " by " + esc(e.undone_by) : ""}</small>` : e.merged ? `<small class="muted">in the source</small>` : (k.manage || (CX.me && CX.me.user && CX.me.user.id === e.uid)) ? `<button type="button" class="ghost" data-kbundo="${e.id}">Undo</button>` : ""}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">No edits yet. Anyone signed in can edit a paragraph in the Knowledge base (the &#9998; pen); the edit shows at once with their name.</p>`);
  el.onclick = async (ev) => {
    const u = ev.target.closest("[data-kbundo]");
    if (u) {
      if (!confirm("Undo this edit?")) return;
      try { await api(`/api/kb/edits/${u.dataset.kbundo}/undo`, { method: "POST" }); toast("Edit undone"); paintKbEdits(); } catch (e) { toast(e.message, true); }
      return;
    }
    const g = ev.target.closest("[data-kbgo]");
    if (g) { ev.preventDefault(); const p = g.dataset.kbgo.replace(/\.md$/, "/").replace(/(^|\/)index\/$/, "$1"); KB_LOADED = ""; showTab("kb", p); }
  };
}

/* ------------------------------------------------------------- the log */

function turnHtml(t, i) {
  const q = `<div class="cx-q"><div class="cx-bubble">${esc(t.q)}</div></div>`;
  let a = "";
  const n = (t.sources || []).length;
  // a search: Quick facts, the diagrams, the clauses (an answer kept from
  // before the Codes page had no AI is shown the same way)
  if (t.busy) a = `<div class="cx-found cx-wait">Finding the summaries and the clauses ...</div>`;
  else if (t.err) a = `<p class="cx-why bad">${esc(t.why || "Not found")}</p>`;
  else {
    a = kbHtml(t, i) + kbFactsHtml(t, i) + factsHtml(t, i) + kbFigsHtml(t, i) + diagramsHtml(t, i)
      + `<div class="cx-found">${n ? `<b>Official text:</b> ${n} clause${n === 1 ? "" : "s"} in the Library` : "No clause in the Library matches - try the words the code uses"}`
      + (n ? ` <button type="button" class="ghost" data-show="${i}">Show</button>` : "") + `</div>`
      + ((t.kb || []).length ? `<p class="cx-disc">Summaries are the office's study notes - the official text prevails; check the clause.</p>` : "");
  }
  return `<div class="cx-turn" data-i="${i}">${q}${a}</div>`;
}

function render() {
  const log = $("#cx-log");
  if (!CX.turns.length) {
    log.innerHTML = `<div class="cx-empty"><h3>Search the building codes</h3>`
      + `<p class="muted">Answers come from the office's knowledge base first - the summaries, topic guides and the current APSEC positions - then from the official clauses in the Library, with Quick facts and the diagrams.</p>`
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
  if ($("#kbtab").hidden) showTab("kb");
  panel("search");
  const i = CX.turns.length;
  CX.turns.push({ q, kind: "search", sources: [], busy: true });
  render();
  try {
    const [r, k] = await Promise.all([api("/api/codes/search?" + new URLSearchParams({ q, n: 25 })),
      CX.kb && CX.kb.on ? api("/api/kb/search?" + new URLSearchParams({ q, n: 6 })).catch(() => null) : Promise.resolve(null)]);
    Object.assign(CX.turns[i], { sources: r.items, terms: r.terms, facts: r.facts || [], diagrams: r.diagrams || [],
      kb: k ? k.items : [], kbfacts: k ? k.facts : [], busy: false });
  } catch (e) { Object.assign(CX.turns[i], { busy: false, why: e.message, err: true }); }
  paintTurn(i);
  save();
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

const isAdmin = () => !!(CX.st && CX.st.manage);
async function openLibrary(tab) {
  closePop();
  if (!isAdmin()) { showTab("kb"); return; }            // the Library is for site admins
  // the Library is a tab of its own: its documents, Find documents, and the knowledge base's set-up
  showTab("lib", null, true);
  let r;
  try { r = await api("/api/codes/sources"); } catch (e) { return toast(e.message, true); }
  CX.kinds = r.kinds;
  const admin = CX.st && CX.st.manage;
  const page = $("#cx-libpage");
  const back = document.createElement("div");
  back.className = "cx-libpage-in";
  back.innerHTML = `<div class="cx-libm cx-inline"><div class="cx-libtabs"><h3>Library</h3><button type="button" class="cx-ltab on" data-lt="lib">In the library</button>`
    + `<button type="button" class="cx-ltab" data-lt="find" title="The codes, PNAPs and practice notes the Buildings Department publishes">Find documents</button>`
    + `<span class="spacer"></span><button type="button" class="ghost" data-x title="Back to the Knowledge base">Back</button></div>`
    + `<div class="cx-lib-body"></div><div class="cx-find-body" hidden></div></div>`;
  page.innerHTML = "";
  page.appendChild(back);
  page.insertAdjacentHTML("beforeend", `<div class="cx-kbbox" id="cx-kbbox"></div>`);
  paintKbBox();
  const end = () => { loadStatus(); showTab("kb"); };
  back.querySelector("[data-x]").onclick = end;
  const body = back.querySelector(".cx-lib-body");
  const fbody = back.querySelector(".cx-find-body");
  let PEND = null;          // a document fetched from the web, waiting for Add
  const libTab = (t) => {
    for (const b of back.querySelectorAll(".cx-ltab")) b.classList.toggle("on", b.dataset.lt === t);
    body.hidden = t !== "lib"; fbody.hidden = t !== "find";
    if (t === "find") paintFind();
  };
  for (const b of back.querySelectorAll(".cx-ltab")) b.onclick = () => libTab(b.dataset.lt);
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
    $("#lb-find", body).onclick = () => libTab("find");
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
    libTab("lib");
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
  if (tab === "find") libTab("find");
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

/* Codes: the Knowledge base (the summaries, with the search and the GBP
   workbook in a panel beside the page) | Library | GBP workbook (a tab of its
   own too). The workbook is one: it moves between its tab and the panel. */
let GBP_ON = false;
function gbpOpts(part) {
  return {
    part,
    findClause: (q) => { panel("search"); $("#cx-q").value = q; find(); },
    openGuide: (p) => { showTab("kb", p); panel("gbp"); },
  };
}
function ensureGbp(part) {
  if (GBP_ON) { if (part) showPart(part); return; }
  GBP_ON = true;
  mountGbp($("#gbp"), gbpOpts(part)).catch((e) => { GBP_ON = false; $("#gbp").innerHTML = `<p class="muted" style="padding:20px">${esc(e.message)}</p>`; });
}
function placeGbp(where) {
  const g = $("#gbp");
  const host = where === "panel" ? $("#kbp-gbp") : $("#gbptab");
  if (g.parentElement !== host) host.appendChild(g);
}
/* the panel beside the page: "search" | "gbp" | "" (closed) */
function panel(view, part) {
  const p = $("#kb-panel");
  if (!view) { p.hidden = true; $("#kbtab").classList.remove("p-on"); $("#kb-ptog").innerHTML = "Results &#9656;"; try { sessionStorage.setItem("lwk-viewer:kb-panel", ""); } catch (e) {} return; }
  p.hidden = false;
  $("#kbtab").classList.add("p-on");
  $("#kbtab").classList.toggle("p-gbp", view === "gbp");
  $("#kb-ptog").innerHTML = "Hide &#9666;";
  for (const b of p.querySelectorAll("[data-pv]")) b.classList.toggle("on", b.dataset.pv === view);
  $("#kbp-search").hidden = view !== "search";
  $("#kbp-gbp").hidden = view !== "gbp";
  for (const id of ["cx-recent", "cx-new", "cx-state"]) $("#" + id).hidden = view !== "search";
  if (view === "gbp") { placeGbp("panel"); ensureGbp(part); }
  try { sessionStorage.setItem("lwk-viewer:kb-panel", view); } catch (e) {}
}
function showTab(tab, kbPath, quiet) {
  if (tab === "ask") { tab = "kb"; }
  for (const b of document.querySelectorAll(".cx-tab")) b.classList.toggle("on", b.dataset.tab === tab);
  $("#gbptab").hidden = tab !== "gbp";
  $("#kbtab").hidden = tab !== "kb";
  $("#libtab").hidden = tab !== "lib";
  try { localStorage.setItem("lwk-viewer:codes-tab", tab); } catch (e) {}
  const u = new URL(location.href);
  if (tab !== "kb") u.searchParams.set("tab", tab); else u.searchParams.delete("tab");
  if (tab !== "kb") u.searchParams.delete("page");
  history.replaceState(null, "", u.pathname + u.search);
  if (tab === "kb") {
    paintKbBar();
    const fr = $("#kb-frame");
    if (CX.kb && CX.kb.on && (kbPath !== undefined && kbPath !== null ? true : !KB_LOADED)) {
      const want = "/kb/" + String(kbPath || "").replace(/^\/+/, "");
      if (KB_LOADED !== want) { fr.src = want; KB_LOADED = want; }
    }
  }
  if (tab === "lib" && !quiet && !$("#cx-libpage").childElementCount) openLibrary();
  if (tab === "gbp") {
    if (!$("#kb-panel").hidden && !$("#kbp-gbp").hidden) panel("search");
    placeGbp("tab"); ensureGbp();
  }
}

/* a page of the knowledge base: its gbp: links open the workbook beside it;
   a link to another site (the BD's PDFs ...) opens in a new tab - those sites
   refuse to be shown inside the viewer - or the Library's copy when it has it */
let LIB_URLS = null;
const normUrl = (u) => String(u || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
async function libUrls() {
  if (LIB_URLS) return LIB_URLS;
  LIB_URLS = new Map();
  try {
    const r = await api("/api/codes/sources");
    for (const x of r.items || r.sources || []) if (x.url && x.id != null) LIB_URLS.set(normUrl(x.url), x);
  } catch (e) {}
  return LIB_URLS;
}
async function openOutside(href) {
  const w = window.open("about:blank", "_blank");
  const m = (await libUrls()).get(normUrl(href));
  const to = m ? `/api/codes/sources/${encodeURIComponent(m.id)}/file` : href;
  if (w) { try { w.opener = null; } catch (e) {} w.location.href = to; } else location.assign(to);
}
function wireFrame() {
  const fr = $("#kb-frame");
  let doc;
  try { doc = fr.contentDocument; } catch (e) { return; }
  if (!doc || !doc.body || doc.body.dataset.lwk) return;
  doc.body.dataset.lwk = "1";
  const st = doc.createElement("style");
  st.textContent = `a[href^="gbp:"]{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin:4px 0;border-radius:8px;border:1px solid #e8731a;color:#c2560a!important;background:#fff4ea;font-weight:600;text-decoration:none!important}
a[href^="gbp:"]::before{content:"\\1F9EE";}a[href^="gbp:"]:hover{background:#ffe6d0}
a.lwk-out::after{content:" \\2197";font-size:.85em;opacity:.7}`;
  doc.head.appendChild(st);
  for (const a of doc.querySelectorAll("a[href]")) {
    if (a.protocol && /^https?:$/.test(a.protocol) && a.host !== location.host) { a.classList.add("lwk-out"); if (!a.title) a.title = "Opens in a new tab"; }
  }
  doc.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    if (/^gbp:/i.test(a.getAttribute("href"))) { ev.preventDefault(); panel("gbp", a.getAttribute("href").slice(4).trim().toLowerCase()); return; }
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
    if (a.protocol && /^https?:$/.test(a.protocol) && a.host !== location.host) { ev.preventDefault(); ev.stopPropagation(); openOutside(a.href); }
  }, true);
  doc.addEventListener("keydown", (ev) => { if (ev.key === "/" && !/INPUT|TEXTAREA/.test((ev.target.tagName || "")) && !ev.target.isContentEditable) { ev.preventDefault(); $("#cx-q").focus(); } });
}

async function start() {
  CX.me = await ensureSignedIn();
  header(CX.me);
  for (const b of document.querySelectorAll(".cx-tab")) b.onclick = () => (b.dataset.tab === "lib" ? openLibrary() : showTab(b.dataset.tab));
  load();
  render();
  await loadStatus();
  {
    const sp = new URLSearchParams(location.search);
    let t = sp.get("tab");
    if (!t) { try { t = localStorage.getItem("lwk-viewer:codes-tab"); } catch (e) {} }
    const sec = sp.get("sec");
    if (t === "gbp") { showTab("gbp"); if (sec) ensureGbp(sec); }
    else if (t === "lib" && isAdmin()) openLibrary();
    else {
      showTab("kb", sp.get("page") || null);
      let pv = "";
      try { pv = sessionStorage.getItem("lwk-viewer:kb-panel") || ""; } catch (e) {}
      if (t === "ask" || sp.get("q") || (pv === "search" && CX.turns.length)) panel("search");
      else if (pv === "gbp" || sec) panel("gbp", sec || undefined);
    }
  }
  $("#kb-frame").addEventListener("load", wireFrame);
  $("#kb-ptog").onclick = () => panel($("#kb-panel").hidden ? "search" : "");
  $("#kb-px").onclick = () => panel("");
  $("#kb-fab").onclick = () => { panel("search"); $("#cx-q").focus(); };
  for (const b of document.querySelectorAll("[data-pv]")) b.onclick = () => panel(b.dataset.pv);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "/" && !$("#kbtab").hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { ev.preventDefault(); $("#cx-q").focus(); }
    if (ev.key === "Escape" && document.activeElement === $("#cx-q") && !$("#cx-side").classList.contains("on")) $("#cx-q").blur();
  });
  // the knowledge base's own page: Back / Home / a window of its own
  $("#kb-back").onclick = () => { try { $("#kb-frame").contentWindow.history.back(); } catch (e) {} };
  $("#kb-home").onclick = () => { KB_LOADED = ""; showTab("kb", ""); };
  $("#kb-open").onclick = () => { let u = "/kb/"; try { u = $("#kb-frame").contentWindow.location.href; } catch (e) {} open(u, "_blank", "noopener"); };
  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("#cx-q").value = q; history.replaceState(null, "", location.pathname + (project() ? "?project=" + encodeURIComponent(project()) : "")); }
  $("#cx-form").onsubmit = () => { find(); return false; };
  $("#cx-q").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); find(); } });
  $("#cx-new").onclick = () => { CX.turns = []; CX.shown = -1; save(); render(); $("#cx-side").classList.remove("on"); $("#cx-clauses").innerHTML = ""; $("#cx-q").focus(); };
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
    const kf = ev.target.closest("[data-kbf]");
    if (kf) return openKb(kf.dataset.kbf);
    const kc = ev.target.closest("[data-kb]");
    if (kc) { const [ti, k] = kc.dataset.kb.split(":").map(Number); const x = CX.turns[ti] && CX.turns[ti].kb[k]; if (x) openKb(x.url + (x.anchor ? "#" + x.anchor : "")); return; }
    const fr = ev.target.closest(".cx-fref");
    if (fr) return showSources(Number(fr.dataset.turn), Number(fr.dataset.s));
    const s = ev.target.closest("[data-show]");
    if (s) return showSources(Number(s.dataset.show));
  });
  const last = CX.turns.length - 1;
  if (!phone()) $("#cx-q").focus();
}

start().catch((e) => { if (!/Set your own password/.test(e.message)) toast(e.message, true); });
