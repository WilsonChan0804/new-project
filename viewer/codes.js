/* Codes page (server side: codes.py).
 *
 * Ask the office's library of building regulations: the Buildings
 * Ordinance and its Regulations, PNAPs, Codes of Practice, design manuals
 * and the office's own notes, put in by a site admin (Library).
 *
 * Find clauses searches the library (no AI). Ask finds the clauses that
 * match and has Claude answer from them only, citing them as [S1] [S2] ...;
 * a click on a citation shows the clause - with its reference, edition and
 * page, and the page of the PDF a click away. A follow-up question keeps the
 * conversation (New starts again).
 */

import { api, headers, project } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, toast, pop, closePop } from "./tasks-util.js";
import { formatHtml } from "./chatfmt.js";

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
    ? `${s.sources} document${s.sources === 1 ? "" : "s"}, ${s.clauses} clauses · `
      + (s.ask ? `answers by ${esc(s.model_label.replace(/ \(.*\)$/, ""))}` : `<span class="cx-off" title="${esc(s.why_off)}">Ask is off - Find clauses works</span>`)
    : (s.manage ? `The library is empty: <a href="#" id="cx-first">add the first documents</a>` : "The library is empty - ask a site admin to add the codes");
  const f = $("#cx-first");
  if (f) f.onclick = (ev) => { ev.preventDefault(); openLibrary(); };
  $("#cx-ask").disabled = false;
  $("#cx-ask").title = s.ask ? "Find the clauses and have Claude answer from them" : s.why_off;
}

/* -------------------------------------------------------- highlighting */

function marked(text, terms) {
  const ts = (terms || []).filter((t) => t && t.length > 1).sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ts.length) return esc(text);
  const re = new RegExp("(" + ts.join("|") + ")", "gi");
  return String(text).split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join("");
}

/* The answer as HTML: the chat formatting, and [S3] as a chip */
function answerHtml(t, i) {
  const n = (t.sources || []).length;
  const render = (s) => esc(s).replace(/\[S(\d+)\]/g, (m, k) => (Number(k) >= 1 && Number(k) <= n
    ? `<button type="button" class="cx-cite" data-turn="${i}" data-s="${k}" title="${esc(t.sources[k - 1].label)}">${k}</button>` : ""));
  return formatHtml(t.a || "", render);
}

/* ------------------------------------------------------------- the log */

function turnHtml(t, i) {
  const q = `<div class="cx-q"><div class="cx-bubble">${esc(t.q)}</div></div>`;
  let a = "";
  const n = (t.sources || []).length;
  if (t.kind === "search") {
    a = `<div class="cx-found">${n ? `${n} clause${n === 1 ? "" : "s"} found` : "No clause in the library matches - try the words the code uses"}`
      + (n ? ` <button type="button" class="ghost" data-show="${i}">Show</button>` : "") + `</div>`;
  } else {
    const body = t.a ? `<div class="cx-text">${answerHtml(t, i)}</div>` : (t.busy ? `<div class="cx-text cx-wait">${n ? `Reading ${n} clauses ...` : "Finding the clauses ..."}</div>` : "");
    const note = t.why ? `<p class="cx-why ${t.err ? "bad" : ""}">${esc(t.why)}</p>` : "";
    const used = (t.cited || []).length;
    const foot = t.busy ? "" : `<div class="cx-foot">`
      + (n ? `<button type="button" class="ghost" data-show="${i}">${used ? `${used} clause${used === 1 ? "" : "s"} cited` : `${n} clauses found`} &rsaquo;</button>` : "")
      + (t.a ? `<button type="button" class="ghost" data-copy="${i}" title="Copy the answer with its references">Copy</button>` : "")
      + (t.a && CX.st && CX.st.manage ? `<button type="button" class="ghost" data-note="${i}" title="Keep this answer in the library as an office note">Save as note</button>` : "")
      + (t.a ? `<span class="cx-disc">Check each figure against the current edition of the document - this is a reading aid, not advice.</span>` : "")
      + `</div>`;
    a = `<div class="cx-a">${body}${note}${foot}</div>`;
  }
  return `<div class="cx-turn" data-i="${i}">${q}${a}</div>`;
}

function render() {
  const log = $("#cx-log");
  if (!CX.turns.length) {
    log.innerHTML = `<div class="cx-empty"><h3>Ask a question about the building codes</h3>`
      + `<p class="muted">Answers come only from the documents in the office's library, and cite the clauses they use.</p>`
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
  $("#cx-side-title").textContent = t.kind === "search" ? `Clauses for "${t.q.slice(0, 40)}${t.q.length > 40 ? "..." : ""}"` : "Clauses of this answer";
  const order = src.map((s, k) => k + 1).sort((a, b) => (cited.has(b) - cited.has(a)) || a - b);
  $("#cx-clauses").innerHTML = src.length ? order.map((k) => {
    const s = src[k - 1];
    const file = s.pdf || s.source ? `/api/codes/sources/${encodeURIComponent(s.source)}/file${s.pdf && s.page ? "#page=" + s.page : ""}` : "";
    return `<div class="cx-cl${cited.has(k) ? " cited" : ""}" id="cx-cl-${k}">`
      + `<div class="cx-cl-h"><span class="cx-n">${k}</span><b>${esc(s.label)}</b></div>`
      + `<div class="cx-cl-m">${esc(s.kind_label)}${s.edition ? " · edition " + esc(s.edition) : ""}${s.status === "superseded" ? ` · <span class="cx-sup">superseded</span>` : ""}${s.kind === "internal" ? ` · <span class="cx-int">office note, not law</span>` : ""}</div>`
      + `<div class="cx-cl-t">${marked(s.text, t.terms)}</div>`
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

function withRefs(t) {
  const used = (t.cited || []).length ? t.cited : (t.sources || []).map((s, k) => k + 1);
  return `Q: ${t.q}\n\n${t.a}\n\nReferences:\n` + used.map((k) => {
    const s = t.sources[k - 1];
    return s ? `[S${k}] ${s.label}${s.edition ? " (edition " + s.edition + ")" : ""}` : "";
  }).filter(Boolean).join("\n");
}

/* ------------------------------------------------------ asking, finding */

async function ask(useAi) {
  const q = $("#cx-q").value.trim();
  if (!q) return $("#cx-q").focus();
  if (CX.turns.some((t) => t.busy)) return;
  $("#cx-q").value = "";
  const i = CX.turns.length;
  if (!useAi) {
    CX.turns.push({ q, kind: "search", sources: [], busy: true });
    render();
    try {
      const r = await api("/api/codes/search?" + new URLSearchParams({ q, n: 25 }));
      Object.assign(CX.turns[i], { sources: r.items, terms: r.terms, busy: false });
    } catch (e) { Object.assign(CX.turns[i], { busy: false, why: e.message, err: true, kind: "ask" }); }
    paintTurn(i);
    save();
    if (CX.turns[i].sources.length) showSources(i);
    return;
  }
  const history = CX.turns.filter((t) => t.kind !== "search" && t.a && !t.err).slice(-4).map((t) => ({ q: t.q, a: t.a }));
  const t = { q, kind: "ask", a: "", sources: [], cited: [], busy: true };
  CX.turns.push(t);
  render();
  try {
    const res = await fetch("/api/codes/ask", { method: "POST", headers: headers(true), body: JSON.stringify({ q, history, project: project() || "" }) });
    if (!res.ok) {
      let d = null; try { d = await res.json(); } catch (e) {}
      throw new Error((d && d.detail) || "HTTP " + res.status);
    }
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = "", pending = false;
    const repaint = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; paintTurn(i); }); } };
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.type === "sources") { t.sources = m.items; t.terms = m.terms; if (!phone() && m.items.length) showSources(i); }
        else if (m.type === "text") t.a += m.t;
        else if (m.type === "off") { t.why = m.why; t.kind = "search"; }
        else if (m.type === "error") { t.why = m.why; t.err = true; }
        else if (m.type === "done") { t.cited = m.cited || []; t.model = m.model; }
        repaint();
      }
    }
  } catch (e) { t.why = e.message; t.err = true; }
  t.busy = false;
  paintTurn(i);
  if (CX.shown === i || (!phone() && t.sources.length)) showSources(i);
  save();
}

/* --------------------------------------------------------------- library */

const KIND_HINT = { ordinance: "e.g. Buildings Ordinance (Cap 123)", regulation: "e.g. Building (Planning) Regulations (Cap 123F)",
  pnap: "e.g. PNAP APP-152", code: "e.g. Code of Practice for Fire Safety in Buildings 2011", guide: "e.g. Design Manual: Barrier Free Access 2008",
  internal: "e.g. BD comments on GBP, our practice", other: "" };

async function openLibrary() {
  closePop();
  let r;
  try { r = await api("/api/codes/sources"); } catch (e) { return toast(e.message, true); }
  CX.kinds = r.kinds;
  const admin = CX.st && CX.st.manage;
  const back = document.createElement("div");
  back.className = "t-modal-back";
  back.innerHTML = `<div class="t-modal cx-libm"><h3>Library</h3><div class="cx-lib-body"></div>`
    + `<div class="t-modal-foot"><span class="spacer"></span><button type="button" class="primary" data-x>Done</button></div></div>`;
  document.body.appendChild(back);
  const end = () => { back.remove(); loadStatus(); };
  back.querySelector("[data-x]").onclick = end;
  back.addEventListener("pointerdown", (ev) => { if (ev.target === back) end(); });
  back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") end(); });
  const body = back.querySelector(".cx-lib-body");
  const kindOpts = (sel) => CX.kinds.map((k) => `<option value="${k.id}"${k.id === sel ? " selected" : ""}>${esc(k.label)}</option>`).join("");

  const paint = async () => {
    const list = r.sources;
    let html = `<table class="cx-lib"><thead><tr><th>Document</th><th>Kind</th><th>Edition</th><th class="num">Clauses</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>`
      + (list.length ? list.map((s) => `<tr class="${s.status === "superseded" ? "sup" : ""}" data-id="${s.id}">`
        + `<td><a href="/api/codes/sources/${s.id}/file" target="_blank" rel="noopener">${esc(s.title)}</a>${s.status === "superseded" ? ` <span class="cx-sup">superseded</span>` : ""}`
        + `<br><small class="muted">${s.pages ? s.pages + " pages · " : ""}${esc(s.ext.toUpperCase())} · added by ${esc(s.added_by || "?")} ${new Date(s.added_at * 1000).toLocaleDateString()}</small></td>`
        + `<td>${esc(s.kind_label)}</td><td>${esc(s.edition || "-")}</td><td class="num">${s.chunks}</td>`
        + (admin ? `<td class="cx-lib-act"><button type="button" class="ghost" data-edit="${s.id}">Edit</button></td>` : "") + `</tr>`).join("")
        : `<tr><td colspan="5" class="muted">No documents yet.</td></tr>`) + `</tbody></table>`;
    if (admin) {
      html += `<details class="cx-add" open><summary>Add a document</summary>`
        + `<div class="cx-grid"><label>File (PDF, Word, text)<input type="file" id="lb-file" accept=".pdf,.docx,.txt,.md"></label>`
        + `<label>Title<input id="lb-title" placeholder="${esc(KIND_HINT.code)}"></label>`
        + `<label>Kind<select id="lb-kind">${kindOpts("code")}</select></label>`
        + `<label>Edition / date<input id="lb-ed" placeholder="e.g. 2011 (Dec 2015 amendment)"></label>`
        + `<label class="wide">Official page (optional)<input id="lb-url" placeholder="https://www.bd.gov.hk/..."></label></div>`
        + `<div class="row end"><span class="muted" id="lb-msg"></span><button type="button" class="primary" id="lb-go">Add to the library</button></div>`
        + `<p class="muted small">A scanned PDF needs its text first (Acrobat > Scan &amp; OCR). Each document is split into its clauses, keeping clause numbers and pages.</p></details>`
        + `<details class="cx-add"><summary>Add an office note (pasted text)</summary>`
        + `<div class="cx-grid"><label>Title<input id="nt-title" placeholder="e.g. BD comments - MOE, 2025"></label><label>Kind<select id="nt-kind">${kindOpts("internal")}</select></label>`
        + `<label class="wide">Text<textarea id="nt-text" rows="6" placeholder="Paste the text. Number the points (1. 2. or B5.1 ...) to keep them apart."></textarea></label></div>`
        + `<div class="row end"><button type="button" class="primary" id="nt-go">Add the note</button></div></details>`
        + `<details class="cx-add" id="lb-ai"><summary>Answers by Claude (API key, model, cost)</summary><div class="cx-ai muted">Loading ...</div></details>`;
    }
    body.innerHTML = html;
    if (!admin) return;
    $("#lb-kind", body).onchange = () => { $("#lb-title", body).placeholder = KIND_HINT[$("#lb-kind", body).value] || ""; };
    $("#lb-file", body).onchange = () => { const f = $("#lb-file", body).files[0]; if (f && !$("#lb-title", body).value) $("#lb-title", body).value = f.name.replace(/\.[^.]+$/, ""); };
    $("#lb-go", body).onclick = async () => {
      const f = $("#lb-file", body).files[0];
      if (!f) return toast("Choose a file first", true);
      const btn = $("#lb-go", body); btn.disabled = true;
      $("#lb-msg", body).textContent = "Uploading and reading the clauses ...";
      try {
        const qs = new URLSearchParams({ file: f.name, title: $("#lb-title", body).value, kind: $("#lb-kind", body).value, edition: $("#lb-ed", body).value, url: $("#lb-url", body).value });
        const res = await fetch("/api/codes/sources?" + qs, { method: "POST", headers: headers(false), body: f });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.detail || "HTTP " + res.status);
        toast(`Added: ${d.source.title} - ${d.source.chunks} clauses`);
        r = await api("/api/codes/sources");
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
    paintAi($(".cx-ai", body));
  };
  paint();
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

async function paintAi(box) {
  let s;
  try { s = await api("/api/codes/settings"); } catch (e) { box.textContent = e.message; return; }
  const per = (m) => `about US$${((10000 * m.in + 1000 * m.out) / 1e6).toFixed(m.in < 1 ? 4 : 3)} a question`;
  box.classList.remove("muted");
  box.innerHTML = `<label>Model<select id="ai-model"><option value="off"${s.model === "off" ? " selected" : ""}>Off - Find clauses only</option>`
    + s.models.map((m) => `<option value="${m.id}"${m.id === s.model ? " selected" : ""}>${esc(m.label)} - ${per(m)}</option>`).join("") + `</select></label>`
    + `<p class="small">API key: ${s.key_set ? `<b>set</b> (ends ${esc(s.key_end)}${s.key_from === "env" ? ", from ANTHROPIC_API_KEY on the server" : ", kept on the server"})` : "<b>not set</b>"}. `
    + `Get one at console.anthropic.com (pay as you go, no subscription); it stays on this server and is never shown again.</p>`
    + (s.key_from === "env" ? "" : `<label>${s.key_set ? "Replace the key" : "Claude API key"}<input id="ai-key" type="password" autocomplete="off" placeholder="sk-ant-..."></label>`)
    + `<p class="small muted">This month: ${s.month.questions} question${s.month.questions === 1 ? "" : "s"}, about US$${s.month.usd.toFixed(2)} · since the start: ${s.total.questions}, US$${s.total.usd.toFixed(2)}. Questions and the matching clauses are sent to Anthropic to write the answer.</p>`
    + `<div class="row end">${s.key_set && s.key_from === "saved" ? `<button type="button" class="ghost danger" id="ai-clear">Remove the key</button>` : ""}<button type="button" class="primary" id="ai-save">Save</button></div>`;
  const send = async (b) => {
    try { await api("/api/codes/settings", { method: "POST", body: JSON.stringify(b) }); toast("Saved"); paintAi(box); loadStatus(); } catch (e) { toast(e.message, true); }
  };
  $("#ai-save", box).onclick = () => { const k = $("#ai-key", box); send({ model: $("#ai-model", box).value, key: k ? k.value.trim() : "" }); };
  const c = $("#ai-clear", box);
  if (c) c.onclick = () => { if (confirm("Remove the saved API key? Ask stops until another is added.")) send({ clear_key: true }); };
}

/* ----------------------------------------------------------------- start */

async function recent(btn) {
  let r;
  try { r = await api("/api/codes/history"); } catch (e) { return toast(e.message, true); }
  const items = r.items || [];
  const p = pop(btn, items.length ? items.map((x, k) => `<button type="button" class="cx-rq" data-k="${k}">${esc(x.q.slice(0, 120))}<small class="muted">${new Date(x.at * 1000).toLocaleString()}</small></button>`).join("")
    : `<p class="muted" style="padding:8px">No questions yet.</p>`, 380);
  for (const b of p.querySelectorAll(".cx-rq")) {
    b.onclick = () => {
      const x = items[b.dataset.k];
      closePop();
      CX.turns.push({ q: x.q, kind: "ask", a: x.answer || "", sources: [], cited: [], why: "From your earlier questions - ask again to see its clauses." });
      render(); save();
      $("#cx-q").value = x.q;
    };
  }
}

async function start() {
  CX.me = await ensureSignedIn();
  header(CX.me);
  load();
  render();
  await loadStatus();
  const q = new URLSearchParams(location.search).get("q");
  if (q) { $("#cx-q").value = q; history.replaceState(null, "", location.pathname + (project() ? "?project=" + encodeURIComponent(project()) : "")); }
  $("#cx-form").onsubmit = () => { ask(!!(CX.st && CX.st.ask)); return false; };
  $("#cx-search").onclick = () => ask(false);
  $("#cx-q").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ask(!!(CX.st && CX.st.ask)); } });
  $("#cx-new").onclick = () => { CX.turns = []; CX.shown = -1; save(); render(); $("#cx-side").classList.remove("on"); $("#cx-clauses").innerHTML = ""; $("#cx-q").focus(); };
  $("#cx-lib").onclick = openLibrary;
  $("#cx-recent").onclick = () => recent($("#cx-recent"));
  $("#cx-side-x").onclick = () => $("#cx-side").classList.remove("on");
  $("#cx-log").addEventListener("click", (ev) => {
    const c = ev.target.closest(".cx-cite");
    if (c) return showSources(Number(c.dataset.turn), Number(c.dataset.s));
    const s = ev.target.closest("[data-show]");
    if (s) return showSources(Number(s.dataset.show));
    const cp = ev.target.closest("[data-copy]");
    if (cp) return copy(withRefs(CX.turns[cp.dataset.copy]));
    const nt = ev.target.closest("[data-note]");
    if (nt) {
      const t = CX.turns[nt.dataset.note];
      nt.disabled = true;
      api("/api/codes/notes", { method: "POST", body: JSON.stringify({ title: "Answer: " + t.q.slice(0, 120), kind: "internal", text: withRefs(t) }) })
        .then(() => { toast("Kept in the library as an office note"); loadStatus(); }, (e) => { toast(e.message, true); nt.disabled = false; });
    }
  });
  const last = CX.turns.length - 1;
  if (last >= 0 && !phone() && (CX.turns[last].sources || []).length) showSources(last);
  $("#cx-q").focus();
}

start().catch((e) => { if (!/Set your own password/.test(e.message)) toast(e.message, true); });
