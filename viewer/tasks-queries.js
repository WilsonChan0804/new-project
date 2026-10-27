/* Queries: questions raised on a project (queries.py), answered by the team.
 *
 * Tasks > Queries: the project's register (Q-001 ...), a query's detail on
 * the right (who it is to, when it is due, the pictures of the sheet / 3D
 * view it is about - a click opens that exact view - its answer, linked
 * tasks and discussion), a small dashboard, and the register as a report
 * (print, save as PDF, keep in Folders).
 *
 * A picture comes from Sheets or 3D: "Add to query" there captures the view
 * and opens this page with ?mode=queries&addview=1 (the view handed over in
 * localStorage, VIEW_KEY): it goes to an open query, or starts a new one.
 */

import { esc, uid, today, addDays, daysBetween, fmtDate, fmtWhen, skeleton } from "./tasks-util.js";
import { donut, hbars } from "./tasks-dash.js";
import { keptBig, keepBig } from "./nav.js";

export const VIEW_KEY = "lwk-viewer:query-view";
const REG_KEY = "lwk-tasks:query-reg";
const STATUS = ["Open", "Answered", "Closed"];
const COL = { Open: "#f28022", Answered: "#0284c7", Closed: "#0e9f6e", over: "#e2453c" };
const newQid = () => "q" + (crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 19) : uid().replace(/[^0-9a-f]/g, "0").slice(0, 19).padEnd(19, "0"));

const Q = {
  projects: null, reg: "", rows: new Map(), rev: 0, people: [], admin: false,
  view: "list", f: { status: "active", who: "all", q: "" }, open: "", detail: null, poll: 0, loaded: "",
};

const isOver = (q) => q.status === "Open" && q.due && q.due < today();
const toMe = (T, q) => (q.to || []).some((p) => p.uid === (T.me && T.me.uid));
const mine = (T, q) => q.raised_uid === (T.me && T.me.uid);

/* ---------------------------------------------------------------- data */

async function projects(T) {
  if (!Q.projects) Q.projects = (await T.api("/api/queries/projects")).projects || [];
  return Q.projects;
}

async function load(T, reg, fresh) {
  if (Q.loaded !== reg || fresh) {
    Q.rows = new Map(); Q.rev = 0; Q.loaded = reg;
    const k = await keptBig("queries:" + reg);
    if (k && k.rows) { for (const q of k.rows) Q.rows.set(q.id, q); Q.people = k.people || []; Q.admin = !!k.admin; }
    const r = await T.api("/api/queries?reg=" + encodeURIComponent(reg));
    Q.rows = new Map(r.queries.map((q) => [q.id, q]));
    Q.rev = r.rev; Q.people = r.people || []; Q.admin = r.admin;
    keep(reg);
    return true;
  }
  const r = await T.api(`/api/queries?reg=${encodeURIComponent(reg)}&since=${Q.rev}`);
  let changed = false;
  for (const q of r.queries) { changed = true; q.deleted ? Q.rows.delete(q.id) : Q.rows.set(q.id, q); }
  Q.rev = r.rev;
  if (changed) keep(reg);
  return changed;
}

function keep(reg) {
  keepBig("queries:" + reg, { rev: Q.rev, rows: [...Q.rows.values()], people: Q.people, admin: Q.admin });
}

async function save(T, patch, extra) {
  const r = await T.api("/api/queries", { method: "POST", body: JSON.stringify(Object.assign({ reg: Q.reg, queries: [patch] }, extra || {})) });
  for (const q of r.queries) Q.rows.set(q.id, q);
  Q.rev = Math.max(Q.rev, r.rev);
  keep(Q.reg);
  return r.queries[0];
}

/* ---------------------------------------------------------------- view */

export async function render(T, el, opts) {
  opts = opts || {};
  const ps = await projects(T).catch(() => []);
  if (!ps.length) {
    el.innerHTML = `<div class="t-empty"><h3>No project to raise queries on</h3><p>Queries belong to a project on the Projects page; you are not one of any project's people yet.</p></div>`;
    return;
  }
  const want = opts.reg || Q.reg || localStorage.getItem(REG_KEY) || "";
  Q.reg = ps.some((p) => p.id === want) ? want : ps[0].id;
  try { localStorage.setItem(REG_KEY, Q.reg); } catch (e) {}
  if (Q.loaded !== Q.reg) el.innerHTML = skeleton(6);
  try { await load(T, Q.reg); } catch (e) { el.innerHTML = `<p class="bad" style="padding:20px">Could not load the queries: ${esc(e.message)}</p>`; return; }
  draw(T, el);
  if (opts.q && Q.rows.has(opts.q)) openDetail(T, opts.q);
  clearInterval(Q.poll);
  Q.poll = setInterval(async () => {
    if (T.S.mode !== "queries") { clearInterval(Q.poll); return; }
    if (document.hidden) return;
    try { if (await load(T, Q.reg)) { draw(T, el); if (Q.open) openDetail(T, Q.open, true); } } catch (e) {}
  }, 10000);
}

function filtered(T) {
  const F = Q.f, s = F.q.trim().toLowerCase();
  return [...Q.rows.values()].filter((q) => (F.status === "all" || (F.status === "active" ? q.status !== "Closed" : F.status === "overdue" ? isOver(q) : q.status === F.status))
    && (F.who === "all" || (F.who === "to" ? toMe(T, q) : mine(T, q)))
    && (!s || `${q.code} ${q.title} ${q.question} ${q.answer} ${(q.to || []).map((p) => p.name).join(" ")}`.toLowerCase().includes(s)))
    .sort((a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status) || (a.due || "9999").localeCompare(b.due || "9999") || b.number - a.number);
}

function draw(T, el) {
  const ps = Q.projects || [];
  const F = Q.f;
  const rows = filtered(T);
  const all = [...Q.rows.values()];
  const c = { open: all.filter((q) => q.status === "Open").length, over: all.filter(isOver).length, ans: all.filter((q) => q.status === "Answered").length };
  el.innerHTML = `<div class="q-bar">`
    + `<select id="q-reg" title="Project">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === Q.reg ? " selected" : ""}>${esc(p.short + (p.code ? " · " + p.code : ""))}</option>`).join("")}</select>`
    + `<span class="q-tabs"><button data-qv="list" class="${Q.view === "list" ? "on" : ""}">List</button><button data-qv="dash" class="${Q.view === "dash" ? "on" : ""}">Dashboard</button></span>`
    + `<button id="q-new" class="primary">+ New query</button>`
    + `<span class="spacer"></span>`
    + `<span class="q-k"><b>${c.open}</b> open${c.over ? ` · <b class="bad">${c.over}</b> overdue` : ""} · <b>${c.ans}</b> answered</span>`
    + `<button id="q-report" class="ghost" title="The register as a report: print, save as PDF or keep in Folders">Report (PDF)</button></div>`
    + (Q.view === "list"
      ? `<div class="q-bar q-f"><input id="q-q" type="search" placeholder="Search queries" value="${esc(F.q)}">`
        + `<select id="q-st">${[["active", "Open and answered"], ["Open", "Open"], ["overdue", "Overdue"], ["Answered", "Answered (to close)"], ["Closed", "Closed"], ["all", "All"]]
          .map(([v, l]) => `<option value="${v}"${F.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>`
        + `<select id="q-who">${[["all", "Everyone's"], ["to", "To me"], ["mine", "Raised by me"]].map(([v, l]) => `<option value="${v}"${F.who === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`
        + `<div id="q-newform"></div>`
        + listHtml(T, rows)
      : dashHtml(T, all));
  el.querySelector("#q-reg").onchange = (ev) => { Q.reg = ev.target.value; Q.open = ""; closeDetail(); render(T, el); };
  for (const b of el.querySelectorAll("[data-qv]")) b.onclick = () => { Q.view = b.dataset.qv; draw(T, el); };
  el.querySelector("#q-new").onclick = () => { if (Q.view !== "list") { Q.view = "list"; draw(T, el); } newForm(T, el); };
  el.querySelector("#q-report").onclick = () => openReport(T, Q.view === "list" ? rows : all);
  if (Q.view === "list") {
    const q = el.querySelector("#q-q");
    q.oninput = () => { F.q = q.value; const pos = q.selectionStart; draw(T, el); const n = el.querySelector("#q-q"); n.focus(); n.setSelectionRange(pos, pos); };
    el.querySelector("#q-st").onchange = (ev) => { F.status = ev.target.value; draw(T, el); };
    el.querySelector("#q-who").onchange = (ev) => { F.who = ev.target.value; draw(T, el); };
    for (const r of el.querySelectorAll("[data-q]")) r.onclick = () => openDetail(T, r.dataset.q);
  } else {
    for (const b of el.querySelectorAll("[data-filter]")) b.onclick = () => {
      const [k, v] = b.dataset.filter.split(":");
      Q.view = "list"; Q.f = { status: k === "status" ? v : "all", who: "all", q: k === "to" ? v : "" };
      draw(T, el);
    };
  }
  const pend = takeView();
  if (pend) offerView(T, el, pend);
}

function chip(q) {
  return `<span class="q-chip" style="--c:${isOver(q) ? COL.over : COL[q.status]}">${isOver(q) ? "Overdue" : esc(q.status)}</span>`;
}

function listHtml(T, rows) {
  if (!rows.length) return `<div class="t-empty"><p>No query matches.${Q.rows.size ? "" : " Raise the first with <b>+ New query</b> - or from a sheet or the 3D model: <b>Add to query</b> in its share menu."}</p></div>`;
  return `<div class="q-list">` + rows.map((q) => `<div class="q-row${q.id === Q.open ? " on" : ""}" data-q="${esc(q.id)}">`
    + `<span class="q-code">${esc(q.code)}</span>`
    + `<span class="q-t"><b>${esc(q.title || "Untitled query")}</b><small>${esc(q.raised_by)}${(q.to || []).length ? " → " + esc(q.to.map((p) => p.name).join(", ")) : ""}</small></span>`
    + `<span class="q-m">${(q.views || []).length ? `<span title="Pictures of the sheet / 3D view">&#128247; ${q.views.length}</span>` : ""}${(q.tasks || []).length ? `<span title="Linked tasks">&#9745; ${q.tasks.length}</span>` : ""}${(q.followups || []).length ? `<span title="Follow-up questions and answers">&#8635; ${q.followups.length}</span>` : ""}</span>`
    + `<span class="q-due${isOver(q) ? " bad" : ""}">${q.due ? esc(fmtDate(q.due)) : ""}</span>${chip(q)}</div>`).join("") + `</div>`;
}

/* ------------------------------------------------------------- new query */

function newForm(T, el, view) {
  const box = el.querySelector("#q-newform");
  if (!box) return;
  const pics = view ? [view] : [];
  box.innerHTML = `<form class="q-form" autocomplete="off"><b>New query</b>`
    + `<input name="title" placeholder="Subject (what is unclear)" required maxlength="200">`
    + `<textarea name="question" rows="3" placeholder="The question - paste a screenshot (Ctrl+V) or drop pictures here"></textarea>`
    + `<div class="q-thumbs"></div><div class="q-fr">${addPicHtml()}${addViewBtns()}<small class="muted">or paste a screenshot (Ctrl+V) / drop pictures here</small></div>`
    + `<div class="q-fr"><label>To ${peopleSelect("to")}</label><label>Due <input type="date" name="due" value="${addDays(today(), 7)}"></label>`
    + `<label>Priority <select name="priority"><option>Normal</option><option>High</option><option>Urgent</option></select></label></div>`
    + `<div class="q-fr"><button class="primary">Raise query</button><button type="button" class="ghost" data-cancel>Cancel</button></div></form>`;
  const f = box.querySelector("form");
  const thumbs = f.querySelector(".q-thumbs");
  const paint = () => {
    thumbs.innerHTML = pics.map((v, i) => viewThumb(v, i)).join("");
    for (const b of thumbs.querySelectorAll("[data-unview]")) b.onclick = (ev) => { ev.preventDefault(); pics.splice(+b.dataset.unview, 1); paint(); };
    for (const b of thumbs.querySelectorAll("[data-mark]")) b.onclick = async (ev) => {
      ev.preventDefault();
      try { const v = await markView(T, pics[+b.dataset.mark]); if (v) { pics[+b.dataset.mark] = v; paint(); } } catch (e) { alert(e.message); }
    };
    wirePics(thumbs, pics);
  };
  paint();
  wireAddPic(T, f, async (vs) => { pics.push(...vs); paint(); });
  f.title.focus();
  f.querySelector("[data-cancel]").onclick = () => { box.innerHTML = ""; };
  const raise = async () => {
    const to = [...f.querySelectorAll("[name=to] option:checked")].map((o) => ({ uid: +o.value }));
    return save(T, { id: newQid(), title: f.title.value.trim(), question: f.question.value, to, due: f.due.value,
      priority: f.priority.value, views: pics });
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const q = await raise();
      box.innerHTML = "";
      Q.f.status = "active";
      draw(T, el);
      openDetail(T, q.id);
    } catch (e) { alert(e.message); }
  };
  // + Sheet view / + 3D view: the query is raised first, then its views are added there
  for (const b of f.querySelectorAll("[data-go]")) b.onclick = async (ev) => {
    if (!f.title.value.trim()) { alert("Give the query its subject first - it is raised, then you add the views on the sheets / in 3D."); f.title.focus(); return; }
    try { const q = await raise(); goAddViews(q, b.dataset.go, ev); } catch (e) { alert(e.message); }
  };
}

function peopleSelect(name, chosen) {
  const set = new Set((chosen || []).map((p) => p.uid));
  return `<select name="${name}" multiple size="${Math.min(6, Math.max(3, Q.people.length))}" title="Ctrl-click to choose several">`
    + Q.people.map((p) => `<option value="${p.uid}"${set.has(p.uid) ? " selected" : ""}>${esc(p.name)}</option>`).join("") + `</select>`;
}

/* ------------------------------------------------------- views (pictures) */

const KIND_SAY = { sheet: "Sheet", view3d: "3D view", image: "Picture" };
const KIND_MARK = { sheet: "&#128196; ", view3d: "&#9635; ", image: "&#128444; " };

function viewThumb(v, i) {
  const pic = v.kind === "image";
  return `<span class="q-view${pic ? " pic" : ""}" title="${esc(v.title || "")}">`
    + (pic ? `<a href="${esc(v.snapshot)}" data-pic="${esc(v.snapshot)}" title="Show the picture full size">`
      : `<a href="${esc(v.url)}" target="_blank" rel="noopener" title="Open this ${v.kind === "sheet" ? "sheet" : "3D view"} as it was captured">`)
    + (v.snapshot ? `<img src="${esc(v.snapshot)}" alt="" loading="lazy">` : `<span class="q-noimg">${v.kind === "sheet" ? "Sheet" : "3D"}</span>`)
    + `<small>${KIND_MARK[v.kind] || ""}${esc(v.title || KIND_SAY[v.kind] || "View")}</small></a>`
    + (i >= 0 && v.snapshot ? `<button type="button" class="ghost q-mk" data-mark="${i}" title="Mark up this picture (cloud, arrow, text ...)">&#9998;${(v.markup || []).length ? " " + v.markup.length : ""}</button>` : "")
    + (i >= 0 ? `<button type="button" class="ghost" data-unview="${i}" title="Remove this picture">&#10005;</button>` : "") + `</span>`;
}

/* A picture marked up (picedit.js): the drawing put on it, the picture as
   taken and the drawing kept beside it, so it can be changed later. */
async function markView(T, v) {
  const { editPicture } = await import("./picedit.js");
  const r = await editPicture(v.clean || v.snapshot, v.markup || []);
  if (!r) return null;
  if (!r.markup.length) return Object.assign({}, v, { snapshot: v.clean || v.snapshot, clean: undefined, markup: undefined });
  const up = await T.api("/api/snapshots", { method: "POST", body: JSON.stringify({ data_url: r.image }) });
  return Object.assign({}, v, { snapshot: up.path, clean: v.clean || v.snapshot, markup: r.markup });
}

/* + Sheet view / + 3D view: off to the project's sheets or model, where
   + Query (or a right-click) adds the views to this query - it is the one
   offered first there (querypick.js), and a bar says so. */
function goAddViews(q, page, ev) {
  const p = (Q.projects || []).find((x) => x.id === q.reg) || {};
  const parts = p.viewers || [];
  if (!parts.length) { alert("This project has no sheets or 3D model in the viewer yet."); return; }
  const go = (part) => {
    try {
      sessionStorage.setItem("lwk-viewer:qpick-last:" + q.reg, q.id);
      sessionStorage.setItem("lwk-viewer:qadd", JSON.stringify({ id: q.id, reg: q.reg, code: q.code, title: q.title || "", back: location.pathname.split("/").pop() + "?mode=queries&reg=" + q.reg + "&q=" + q.id }));
    } catch (e) {}
    location.href = page + "?project=" + encodeURIComponent(part);
  };
  if (parts.length === 1) { go(parts[0]); return; }
  // a project of several parts: which one
  const m = document.createElement("div");
  m.className = "q-partpick";
  m.innerHTML = `<b>Which part?</b>` + parts.map((x) => `<button type="button" data-p="${esc(x)}">${esc(x)}</button>`).join("");
  document.body.appendChild(m);
  const r = ev && ev.target ? ev.target.getBoundingClientRect() : { left: 200, bottom: 200 };
  m.style.left = Math.max(8, Math.min(innerWidth - 280, r.left)) + "px";
  m.style.top = Math.min(innerHeight - 40 - parts.length * 34, r.bottom + 4) + "px";
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } };
  setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  m.onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { m.remove(); go(b.dataset.p); } };
}
const addViewBtns = () => `<button type="button" class="ghost q-goview" data-go="index.html" title="Open the sheets: + Query (or right-click a sheet) adds the view you see to this query">&#128196; + Sheet view</button>`
  + `<button type="button" class="ghost q-goview" data-go="model.html" title="Open the 3D model: + Query (or right-click the model) adds the view you see to this query">&#9635; + 3D view</button>`;

/* --------------------------------------------------- pictures of your own */

const addPicHtml = () => `<label class="q-addpic ghost" title="Add pictures: image files, or paste a screenshot (Ctrl+V), or drop them here">`
  + `&#128444; + Add picture<input type="file" accept="image/*" multiple hidden></label>`;

/* an image file as a JPEG at most 2000 px, kept on the server (/snapshots) */
async function picView(T, file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error(file.name + " is not a picture the browser can read")); i.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const r = await T.api("/api/snapshots", { method: "POST", body: JSON.stringify({ data_url: c.toDataURL("image/jpeg", 0.88) }) });
    return { kind: "image", title: (file.name || "Picture").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 200), snapshot: r.path,
      by: (T.me && T.me.name) || "", at: new Date().toISOString().slice(0, 16) };
  } finally { URL.revokeObjectURL(url); }
}

/* + Add picture, paste and drop on `area` (paste on `pasteOn`, the area by
   default): add(views) with the pictures made. Wiring the same element
   again (the detail panel is drawn again on each change) replaces it. */
function wireAddPic(T, area, add, pasteOn, when) {
  const take = async (files) => {
    const imgs = Array.from(files || []).filter((f) => (f.type || "").startsWith("image/"));
    if (!imgs.length) return false;
    const lab = area.querySelector(".q-addpic");
    if (lab) lab.classList.add("busy");
    try {
      const vs = [];
      for (const f of imgs) vs.push(await picView(T, f));
      await add(vs);
    } catch (e) { alert("Could not add the picture: " + e.message); }
    finally { if (lab) lab.classList.remove("busy"); }
    return true;
  };
  const inp = area.querySelector(".q-addpic input");
  if (inp) inp.onchange = () => { take(inp.files); inp.value = ""; };
  const inForm = (ev) => ev.target && ev.target.closest && ev.target.closest(".q-cform");     // a comment takes its own files
  const h = {
    paste: (ev) => {
      if (inForm(ev) || !area.isConnected || area.hidden || (when && !when())) return;
      const fs = Array.from((ev.clipboardData && ev.clipboardData.files) || []);
      if (fs.some((f) => (f.type || "").startsWith("image/"))) { ev.preventDefault(); take(fs); }
    },
    dragover: (ev) => {
      if (inForm(ev)) return;
      if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files")) { ev.preventDefault(); area.classList.add("q-drop"); }
    },
    dragleave: () => area.classList.remove("q-drop"),
    drop: (ev) => {
      area.classList.remove("q-drop");
      if (inForm(ev)) return;
      const fs = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
      if (fs.length) { ev.preventDefault(); take(fs); }
    },
  };
  const old = area._qpic;
  if (old) {
    old.pasteOn.removeEventListener("paste", old.h.paste);
    for (const k of ["dragover", "dragleave", "drop"]) area.removeEventListener(k, old.h[k]);
  }
  const po = pasteOn || area;
  area._qpic = { h, pasteOn: po };
  po.addEventListener("paste", h.paste);
  for (const k of ["dragover", "dragleave", "drop"]) area.addEventListener(k, h[k]);
}

/* a click on a picture of your own: full size, ‹ › through the query's pictures */
function wirePics(box, views) {
  for (const a of box.querySelectorAll("[data-pic]")) a.onclick = (ev) => {
    ev.preventDefault();
    const list = views.filter((v) => v.snapshot);
    lightbox(list, Math.max(0, list.findIndex((v) => v.snapshot === a.dataset.pic)));
  };
}

function lightbox(list, i) {
  const ov = document.createElement("div");
  ov.className = "q-lb";
  const show = () => {
    const v = list[i];
    ov.innerHTML = `<button class="q-lb-x" title="Close (Esc)">&#10005;</button>`
      + (list.length > 1 ? `<button class="q-lb-p" title="Previous">&#8249;</button><button class="q-lb-n" title="Next">&#8250;</button>` : "")
      + `<figure><img src="${esc(v.snapshot)}" alt=""><figcaption>${KIND_MARK[v.kind] || ""}${esc(v.title || KIND_SAY[v.kind] || "")}`
      + (v.kind !== "image" && v.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener">Open this ${v.kind === "sheet" ? "sheet" : "3D view"}</a>` : "")
      + ` <small>${i + 1} / ${list.length}</small></figcaption></figure>`;
    ov.querySelector(".q-lb-x").onclick = done;
    if (list.length > 1) {
      ov.querySelector(".q-lb-p").onclick = (e) => { e.stopPropagation(); i = (i + list.length - 1) % list.length; show(); };
      ov.querySelector(".q-lb-n").onclick = (e) => { e.stopPropagation(); i = (i + 1) % list.length; show(); };
    }
  };
  const key = (e) => {
    if (e.key === "Escape") done();
    else if (e.key === "ArrowLeft" && list.length > 1) { i = (i + list.length - 1) % list.length; show(); }
    else if (e.key === "ArrowRight" && list.length > 1) { i = (i + 1) % list.length; show(); }
  };
  function done() { ov.remove(); document.removeEventListener("keydown", key, true); }
  ov.onclick = (e) => { if (e.target === ov) done(); };
  document.addEventListener("keydown", key, true);
  document.body.appendChild(ov);
  show();
}

function takeView() {
  if (new URLSearchParams(location.search).get("addview") !== "1") return null;
  let v = null;
  try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch (e) {}
  try { localStorage.removeItem(VIEW_KEY); } catch (e) {}
  const q = new URLSearchParams(location.search);
  q.delete("addview");
  history.replaceState(null, "", "tasks.html?" + q.toString());
  return v && Date.now() - (v.t || 0) < 10 * 60 * 1000 ? v : null;
}

/* A picture from Sheets / 3D: to an open query of the project, or a new one. */
function offerView(T, el, v) {
  delete v.t;
  const open = [...Q.rows.values()].filter((q) => q.status !== "Closed").sort((a, b) => b.number - a.number);
  const box = el.querySelector("#q-newform") || el;
  const wrap = document.createElement("div");
  wrap.className = "q-form q-offer";
  wrap.innerHTML = `<b>Add this ${v.kind === "sheet" ? "sheet view" : "3D view"} to a query</b><div class="q-thumbs">${viewThumb(v, -1)}</div>`
    + `<div class="q-fr"><button class="primary" data-new>New query with it</button>`
    + (open.length ? `<span class="muted">or add it to</span><select data-pick><option value="">an open query ...</option>`
      + open.map((q) => `<option value="${esc(q.id)}">${esc(q.code + " " + (q.title || ""))}</option>`).join("") + `</select>` : "")
    + `<button class="ghost" data-skip>Not now</button></div>`;
  box.prepend(wrap);
  wrap.querySelector("[data-new]").onclick = () => { wrap.remove(); newForm(T, el, v); };
  wrap.querySelector("[data-skip]").onclick = () => wrap.remove();
  const pick = wrap.querySelector("[data-pick]");
  if (pick) pick.onchange = async () => {
    const q = Q.rows.get(pick.value);
    if (!q) return;
    try { await save(T, { id: q.id, views: (q.views || []).concat([v]) }); wrap.remove(); draw(T, el); openDetail(T, q.id); }
    catch (e) { alert(e.message); }
  };
}

/* --------------------------------------------------------------- detail */

function closeDetail() {
  const d = document.getElementById("t-detail");
  if (d) { d.hidden = true; d.innerHTML = ""; }
  document.body.classList.remove("detail-on");
  Q.open = "";
}

async function openDetail(T, id, quiet) {
  const q0 = Q.rows.get(id);
  if (!q0) return;
  Q.open = id;
  const panel = document.getElementById("t-detail");
  panel.hidden = false;
  document.body.classList.add("detail-on");
  for (const r of document.querySelectorAll(".q-row")) r.classList.toggle("on", r.dataset.q === id);
  if (!quiet) panel.innerHTML = `<div class="td-body">${skeleton(5)}</div>`;
  let q;
  try { q = await T.api("/api/queries/" + id); } catch (e) { panel.innerHTML = `<div class="td-body"><p class="bad">${esc(e.message)}</p></div>`; return; }
  if (Q.open !== id) return;
  Q.detail = q;
  const me = T.me && T.me.uid;
  const raiser = q.raised_uid === me, to = (q.to || []).some((p) => p.uid === me), admin = Q.admin;
  const canEdit = raiser || to || admin, canAnswer = to || admin, canClose = raiser || admin;
  const row = (l, v) => `<div class="td-r"><span class="td-l">${l}</span><span class="td-v">${v}</span></div>`;
  panel.innerHTML = `<div class="td-top"><b>${esc(q.code)}</b>${chip(q)}<span class="spacer" style="flex:1"></span>`
    + `<button class="ghost" data-act="chat" title="Post this query's card in the project's chat">Send to chat</button>`
    + `<button class="ghost" data-act="close" title="Close the panel">&#10005;</button></div>`
    + `<div class="td-body">`
    + (canEdit ? `<textarea class="td-title" data-f="title" rows="1">${esc(q.title)}</textarea>` : `<h3 class="td-title">${esc(q.title)}</h3>`)
    + `<div class="td-num muted">Raised by ${esc(q.raised_by)} · ${esc(fmtWhen(q.created_at))}</div>`
    + row("To", canEdit ? peopleSelect("to", q.to) : esc((q.to || []).map((p) => p.name).join(", ") || "-"))
    + row("Due", canEdit ? `<input type="date" data-f="due" value="${esc(q.due)}">${isOver(q) ? ` <span class="bad">overdue ${daysBetween(q.due, today())} day(s)</span>` : ""}` : esc(q.due ? fmtDate(q.due) : "-"))
    + row("Priority", canEdit ? `<select data-f="priority">${["Normal", "High", "Urgent"].map((p) => `<option${p === q.priority ? " selected" : ""}>${p}</option>`).join("")}</select>` : esc(q.priority))
    + `<div class="q-sec"><b>Question</b>` + (canEdit ? `<textarea data-f="question" rows="4">${esc(q.question)}</textarea>` : `<p class="q-text">${esc(q.question || "-")}</p>`) + `</div>`
    + `<div class="q-sec q-pics"><b>Pictures &amp; views</b> <small class="muted">a sheet / 3D picture opens that exact view; your own pictures open full size</small>`
    + `<div class="q-thumbs">${(q.views || []).map((v, i) => viewThumb(v, canEdit ? i : -1)).join("") || `<span class="muted">None yet. On a sheet or in 3D click <b>+ Query</b>; or add a picture of your own here.</span>`}</div>`
    + `<div class="q-fr">${addPicHtml()}${addViewBtns()}<small class="muted">or paste a screenshot (Ctrl+V) / drop pictures on this panel; &#9998; marks up a picture</small></div></div>`
    + `<div class="q-sec q-conv"><b>Answer &amp; follow-ups</b>`
    + convHtml(q, canAnswer)
    + `<div class="q-fr">${canClose && q.status !== "Closed" ? `<button data-act="closeq">Close the query</button>` : ""}`
    + `${q.status === "Closed" && (canClose || to) ? `<button data-act="reopen">Reopen</button>` : ""}`
    + `${raiser || admin ? `<button class="ghost bad" data-act="delete">Delete</button>` : ""}</div></div>`
    + `<div class="q-sec"><b>Tasks</b><div class="q-tasks">`
    + ((q.task_rows || []).map((t) => `<a class="q-task" href="tasks.html?list=${esc(t.list_id)}&task=${esc(t.id)}"><span>${t.done ? "&#9745;" : "&#9744;"}</span>${esc(t.title || "Untitled task")}${t.due ? ` <small>${esc(fmtDate(t.due))}</small>` : ""}</a>`).join("") || `<span class="muted">No task linked.</span>`)
    + `</div>${canEdit ? `<div class="q-fr"><button data-act="newtask">+ New task from this query</button><button class="ghost" data-act="linktask">Link a task</button></div><div id="q-taskform"></div>` : ""}</div>`
    + `<div class="q-sec"><b>Discussion</b><div class="q-comments">`
    + ((q.comments || []).map((c) => `<div class="q-c"><b>${esc(c.author)}</b> <small class="muted">${esc(fmtWhen(c.created_at))}</small><div>${esc(c.body)}</div>${filesHtmlLazy(c.files)}</div>`).join("") || `<span class="muted">No comment yet.</span>`)
    + `</div><form class="q-cform"><textarea name="body" rows="2" placeholder="Comment"></textarea><div class="q-fr"><input type="file" name="files" multiple><button class="primary">Send</button></div></form></div>`
    + `<div class="q-sec"><b>History</b><ul class="q-hist">${(q.history || []).slice().reverse().map((h) => `<li><small class="muted">${esc(fmtWhen(h.at))}</small> ${esc(h.by)} ${esc(h.event === "changed" ? "changed " + h.field : h.event)}</li>`).join("")}</ul></div>`
    + `</div>`;
  wireDetail(T, panel, q, { canEdit });
}

/* The answer and the conversation after it: follow-up questions (anyone on
   the project) and their answers (the people it is to), as bubbles. */
function convHtml(q, canAnswer) {
  const fu = q.followups || [];
  const bubble = (kind, text, by, at) => `<div class="q-bub ${kind}"><div class="q-bub-h">${kind === "question" ? "Follow-up" : "Answer"} · <b>${esc(by || "")}</b> <small>${esc(fmtWhen(at))}</small></div><div class="q-text">${esc(text)}</div></div>`;
  let h = "";
  if (!q.answer && !fu.length) {
    h += canAnswer && q.status !== "Closed"
      ? `<textarea data-ans rows="4" placeholder="The answer"></textarea><div class="q-fr"><button class="primary" data-act="answer">Mark answered</button></div>`
      : `<p class="q-text"><span class="muted">Not answered yet.</span></p>`;
  } else if (q.answer && !fu.length && canAnswer && q.status !== "Closed") {
    // the first answer can still be put right until someone asks again
    h += `<div class="q-bub answer"><div class="q-bub-h">Answer · <b>${esc(q.answered_by || "")}</b> <small>${esc(fmtWhen(q.answered_at))}</small></div>`
      + `<textarea data-ans rows="3">${esc(q.answer)}</textarea><div class="q-fr"><button class="ghost" data-act="answer">Update answer</button></div></div>`;
  } else if (q.answer) {
    h += bubble("answer", q.answer, q.answered_by, q.answered_at);
  }
  for (const f of fu) h += bubble(f.kind, f.text, f.by, f.at);
  const last = fu.length ? fu[fu.length - 1].kind : q.answer ? "answer" : "";
  if (last) {
    h += `<div class="q-fr q-more"><button type="button" data-act="followup">+ Follow-up question</button>`
      + (canAnswer && last === "question" ? `<button type="button" class="primary" data-act="answer2">+ Answer</button>` : "") + `</div>`
      + `<div class="q-reply" hidden><textarea rows="3"></textarea><div class="q-fr"><button type="button" class="primary" data-act="sendreply">Send</button><button type="button" class="ghost" data-act="cancelreply">Cancel</button></div></div>`;
  }
  return h;
}

function filesHtmlLazy(files) {
  if (!files || !files.length) return "";
  return `<div class="up-files">` + files.map((f) => (f.mime || "").startsWith("image/")
    ? `<a class="up-pic" href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy"></a>`
    : `<a class="up-file" href="${esc(f.url)}" target="_blank"><span class="up-n">${esc(f.name)}</span></a>`).join("") + `</div>`;
}

function wireDetail(T, panel, q, can) {
  const el = document.getElementById("t-view");
  const redraw = async (id) => { draw(T, el); await openDetail(T, id || q.id, true); };
  const act = (k) => panel.querySelector(`[data-act="${k}"]`);
  act("close").onclick = closeDetail;
  act("chat").onclick = async () => { try { await T.api(`/api/queries/${q.id}/send`, { method: "POST" }); act("chat").textContent = "Sent"; } catch (e) { alert(e.message); } };
  const put = async (patch) => { try { await save(T, Object.assign({ id: q.id }, patch)); await redraw(); } catch (e) { alert(e.message); await redraw(); } };
  wirePics(panel, q.views || []);
  for (const b of panel.querySelectorAll(".q-goview")) b.onclick = (ev) => goAddViews(q, b.dataset.go, ev);
  for (const b of panel.querySelectorAll("[data-mark]")) b.onclick = async (ev) => {
    ev.preventDefault();
    const i = +b.dataset.mark, was = (q.views || [])[i];
    try {
      const v = await markView(T, was);
      if (!v) return;
      // as it is now (someone may have added a picture meanwhile): this one replaced
      const cur = await T.api("/api/queries/" + q.id);
      const same = (x) => x.kind === was.kind && x.url === was.url && x.snapshot === was.snapshot;
      const views = (cur.views || []).map((x) => (same(x) ? v : x));
      await put({ views });
    } catch (e) { alert(e.message); }
  };
  // anyone on the project may add pictures (the server takes additions from everyone)
  wireAddPic(T, panel, async (vs) => {
    const cur = await T.api("/api/queries/" + q.id);            // as it is now: someone may have added one
    await put({ views: (cur.views || []).concat(vs) });
  }, document, () => Q.open === q.id && T.S.mode === "queries");
  if (can.canEdit) {
    for (const f of panel.querySelectorAll("[data-f]")) f.onchange = () => put({ [f.dataset.f]: f.value });
    const sel = panel.querySelector("select[name=to]");
    if (sel) sel.onchange = () => put({ to: [...sel.selectedOptions].map((o) => ({ uid: +o.value })) });
    for (const b of panel.querySelectorAll("[data-unview]")) b.onclick = (ev) => {
      ev.preventDefault();
      if (!confirm("Remove this picture from the query?")) return;
      put({ views: (q.views || []).filter((_, i) => i !== +b.dataset.unview) });
    };
  }
  if (act("answer")) act("answer").onclick = () => {
    const a = panel.querySelector("[data-ans]").value.trim();
    if (!a) { alert("Write the answer first."); return; }
    put({ answer: a, status: "Answered" });
  };
  // + Follow-up question / + Answer: one box for either
  const reply = panel.querySelector(".q-reply");
  let replyKind = "";
  const openReply = (kind) => {
    replyKind = kind;
    reply.hidden = false;
    const ta = reply.querySelector("textarea");
    ta.placeholder = kind === "question" ? "Your follow-up question - the query is open again until it is answered" : "The answer";
    act("sendreply").textContent = kind === "question" ? "Ask" : "Send answer";
    ta.focus();
  };
  if (act("followup")) act("followup").onclick = () => openReply("question");
  if (act("answer2")) act("answer2").onclick = () => openReply("answer");
  if (act("cancelreply")) act("cancelreply").onclick = () => { reply.hidden = true; };
  if (act("sendreply")) act("sendreply").onclick = async () => {
    const text = reply.querySelector("textarea").value.trim();
    if (!text) { alert("Write something first."); return; }
    act("sendreply").disabled = true;
    try {
      const r = await T.api(`/api/queries/${q.id}/thread`, { method: "POST", body: JSON.stringify({ kind: replyKind, text }) });
      Q.rows.set(r.query.id, r.query); Q.rev = Math.max(Q.rev, r.rev); keep(Q.reg);
      await redraw();
    } catch (e) { alert(e.message); act("sendreply").disabled = false; }
  };
  if (act("closeq")) act("closeq").onclick = () => put({ status: "Closed" });
  if (act("reopen")) act("reopen").onclick = () => put({ status: "Open" });
  if (act("delete")) act("delete").onclick = async () => {
    if (!confirm(`Delete ${q.code}? Everyone loses it.`)) return;
    try {
      await T.api("/api/queries", { method: "POST", body: JSON.stringify({ reg: Q.reg, queries: [], deleted: [q.id] }) });
      Q.rows.delete(q.id); keep(Q.reg); closeDetail(); draw(T, el);
    } catch (e) { alert(e.message); }
  };
  if (act("newtask")) act("newtask").onclick = () => taskForm(T, panel, q, redraw);
  if (act("linktask")) act("linktask").onclick = () => linkTaskForm(T, panel, q, redraw);
  const cf = panel.querySelector(".q-cform");
  cf.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = cf.querySelector("button");
    btn.disabled = true;
    try {
      const ids = [];
      if (cf.files.files.length) {
        const { upload } = await import("./uploads.js");
        for (const f of cf.files.files) ids.push((await upload(f, { task: q.id })).id);
      }
      await T.api(`/api/queries/${q.id}/comments`, { method: "POST", body: JSON.stringify({ body: cf.body.value, files: ids }) });
      await redraw();
    } catch (e) { alert(e.message); btn.disabled = false; }
  };
}

/* a new task from the query: in a list and group of yours, linked both ways */
async function taskForm(T, panel, q, redraw) {
  const box = panel.querySelector("#q-taskform");
  const lists = (T.S.lists || []).filter((l) => l.role === "owner" || l.role === "editor" || T.S.siteAdmin);
  if (!lists.length) { box.innerHTML = `<p class="muted">You can add tasks to no task list.</p>`; return; }
  box.innerHTML = `<form class="q-form"><label>List <select name="list">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>`
    + `<label>Group <select name="group"><option>...</option></select></label>`
    + `<input name="title" value="${esc(q.code + " " + (q.title || ""))}">`
    + `<div class="q-fr"><button class="primary">Create task</button><button type="button" class="ghost" data-x>Cancel</button></div></form>`;
  const f = box.querySelector("form");
  const groups = async () => {
    f.group.innerHTML = `<option>...</option>`;
    try {
      const r = await T.api(`/api/tasks?list=${encodeURIComponent(f.list.value)}&since=0`);
      const gs = (r.groups || []).filter((g) => !g.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0));
      f.group.innerHTML = gs.map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join("") || `<option value="">(no group)</option>`;
    } catch (e) { f.group.innerHTML = `<option value="">(no group)</option>`; }
  };
  f.list.onchange = groups;
  await groups();
  f.querySelector("[data-x]").onclick = () => { box.innerHTML = ""; };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const tid = uid();
    const back = `/tasks.html?mode=queries&reg=${encodeURIComponent(q.reg)}&q=${encodeURIComponent(q.id)}`;
    try {
      await T.api("/api/tasks", { method: "POST", body: JSON.stringify({ list: f.list.value, tasks: [{
        id: tid, group_id: f.group.value || "", title: f.title.value.trim() || q.title, due: q.due || "",
        owners: (q.to || []).map((p) => ({ uid: p.uid, name: p.name })),
        description: q.question || "",
        links: [{ kind: "url", url: back, title: `${q.code} ${q.title || ""}`.trim() }].concat((q.views || []).slice(0, 10).map((v) => ({ kind: v.kind, url: v.url, title: v.title || "" }))),
      }] }) });
      await save(T, { id: q.id, tasks: (q.tasks || []).concat([tid]) });
      await redraw();
    } catch (e) { alert(e.message); }
  };
}

async function linkTaskForm(T, panel, q, redraw) {
  const box = panel.querySelector("#q-taskform");
  box.innerHTML = `<div class="q-form"><input type="search" placeholder="Find a task" autofocus><div class="q-pick"></div></div>`;
  const inp = box.querySelector("input"), out = box.querySelector(".q-pick");
  const find = async () => {
    try {
      const r = await T.api(`/api/link-search?kind=task&q=${encodeURIComponent(inp.value)}&reg=${encodeURIComponent(q.reg)}`);
      out.innerHTML = (r.rows || []).map((x, i) => `<a href="#" data-i="${i}">${esc(x.label)} <small class="muted">${esc(x.sub || "")}</small></a>`).join("") || `<span class="muted">No task found.</span>`;
      for (const a of out.querySelectorAll("[data-i]")) a.onclick = async (ev) => {
        ev.preventDefault();
        const tid = new URL(r.rows[+a.dataset.i].url, location.href).searchParams.get("task");
        if (!tid) return;
        try { await save(T, { id: q.id, tasks: Array.from(new Set((q.tasks || []).concat([tid]))) }); await redraw(); } catch (e) { alert(e.message); }
      };
    } catch (e) { out.textContent = e.message; }
  };
  let t = 0;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(find, 250); };
  find();
  inp.focus();
}

/* ------------------------------------------------------------ dashboard */

function dashHtml(T, all) {
  const t0 = today(), soon = addDays(t0, 7), month = t0.slice(0, 7);
  const open = all.filter((q) => q.status === "Open");
  const answered = all.filter((q) => q.status === "Answered");
  const closedMonth = all.filter((q) => q.status === "Closed" && (q.closed_at || "").slice(0, 7) === month);
  const done = all.filter((q) => q.answered_at);
  const avg = done.length ? Math.round(done.reduce((s, q) => s + Math.max(0, daysBetween(q.created_at.slice(0, 10), q.answered_at.slice(0, 10))), 0) / done.length * 10) / 10 : null;
  const tile = (lab, n, cls, filter) => `<div class="td-kpi ${cls || ""}${filter ? " click" : ""}"${filter ? ` data-filter="${filter}"` : ""}><span>${lab}</span><b>${n}</b></div>`;
  // open queries per person addressed (overdue part red)
  const per = new Map();
  for (const q of open) for (const p of (q.to || []).length ? q.to : [{ name: "(nobody)" }]) {
    const k = p.name;
    const e = per.get(k) || { label: k, total: 0, over: 0 };
    e.total++; if (isOver(q)) e.over++;
    per.set(k, e);
  }
  const bars = [...per.values()].sort((a, b) => b.total - a.total).slice(0, 12)
    .map((e) => ({ label: e.label, total: e.total, key: e.label, parts: [{ n: e.over, c: COL.over }, { n: e.total - e.over, c: COL.Open }] }));
  // raised and answered per week, the last 8 weeks
  const mon = addDays(t0, -((new Date(t0 + "T00:00:00Z").getUTCDay() + 6) % 7));
  const wk = [];
  for (let i = 7; i >= 0; i--) {
    const a = addDays(mon, -7 * i), b = addDays(a, 7);
    wk.push({ a, r: all.filter((q) => q.created_at.slice(0, 10) >= a && q.created_at.slice(0, 10) < b).length,
      d: all.filter((q) => (q.answered_at || "").slice(0, 10) >= a && (q.answered_at || "").slice(0, 10) < b).length });
  }
  const mx = Math.max(1, ...wk.map((w) => Math.max(w.r, w.d)));
  const W = 560, H = 140, bw = W / wk.length;
  const chart = `<svg class="tw" viewBox="0 0 ${W} ${H + 20}" width="100%" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>`
    + wk.map((w, i) => {
      const hr = (w.r / mx) * (H - 18), hd = (w.d / mx) * (H - 18), x = i * bw;
      return `<rect x="${x + bw * 0.18}" y="${H - hr}" width="${bw * 0.3}" height="${Math.max(hr, w.r ? 2 : 0)}" rx="2" fill="${COL.Open}"><title>Week of ${fmtDate(w.a)}: ${w.r} raised</title></rect>`
        + `<rect x="${x + bw * 0.52}" y="${H - hd}" width="${bw * 0.3}" height="${Math.max(hd, w.d ? 2 : 0)}" rx="2" fill="${COL.Answered}"><title>Week of ${fmtDate(w.a)}: ${w.d} answered</title></rect>`
        + `<text x="${x + bw / 2}" y="${H + 14}" text-anchor="middle" class="tw-x">${esc(fmtDate(w.a))}</text>`;
    }).join("") + `</svg>`;
  return `<div class="q-dash"><div class="td-kpis q-kpis">`
    + tile("Open", open.length, "", "status:Open") + tile("Overdue", open.filter(isOver).length, open.some(isOver) ? "bad" : "", "status:overdue")
    + tile("Due in 7 days", open.filter((q) => q.due && q.due >= t0 && q.due <= soon).length, "warn", "status:Open")
    + tile("Answered - to close", answered.length, "", "status:Answered") + tile("Closed this month", closedMonth.length, "ok", "status:Closed")
    + tile("Days to answer (avg)", avg == null ? "-" : avg, "") + `</div>`
    + `<div class="q-cards"><section class="card"><h3>By status</h3>${donut(STATUS.map((s) => ({ label: s, n: all.filter((q) => q.status === s).length, c: COL[s] })), String(all.length), "queries")}</section>`
    + `<section class="card"><h3>Open, by who it is to <small class="muted">red: overdue</small></h3>${hbars(bars)}</section></div>`
    + `<section class="card"><h3>Raised and answered per week <small class="muted"><i class="q-sw" style="background:${COL.Open}"></i>raised <i class="q-sw" style="background:${COL.Answered}"></i>answered</small></h3>${chart}</section></div>`;
}

/* --------------------------------------------------------------- report */

export function reportHtml(T, rows, project) {
  const all = rows.slice().sort((a, b) => a.number - b.number);
  const c = (s) => all.filter((q) => q.status === s).length;
  const when = new Date().toISOString().slice(0, 10);
  const detail = (q) => `<div class="q"><h3>${esc(q.code)} ${esc(q.title || "Untitled query")} <span class="st" style="color:${isOver(q) ? COL.over : COL[q.status]}">${esc(isOver(q) ? "Overdue" : q.status)}</span></h3>`
    + `<div class="meta">Raised by ${esc(q.raised_by)} on ${esc((q.created_at || "").slice(0, 10))}${(q.to || []).length ? " · to " + esc(q.to.map((p) => p.name).join(", ")) : ""}${q.due ? " · due " + esc(q.due) : ""} · ${esc(q.priority)}</div>`
    + `<p><b>Question</b><br>${esc(q.question || "-").replace(/\n/g, "<br>")}</p>`
    + ((q.views || []).length ? `<div class="views">${q.views.map((v) => `<figure>${v.snapshot ? `<img src="${esc(v.snapshot)}">` : ""}<figcaption>${esc(v.title || (v.kind === "sheet" ? "Sheet" : "3D view"))}</figcaption></figure>`).join("")}</div>` : "")
    + `<p><b>Answer</b>${q.answered_by ? ` <small>(${esc(q.answered_by)}, ${esc((q.answered_at || "").slice(0, 10))})</small>` : ""}<br>${q.answer ? esc(q.answer).replace(/\n/g, "<br>") : "<i>Not answered yet.</i>"}</p>`
    + (q.followups || []).map((f) => `<p class="fu ${f.kind}"><b>${f.kind === "question" ? "Follow-up question" : "Answer"}</b> <small>(${esc(f.by)}, ${esc((f.at || "").slice(0, 10))})</small><br>${esc(f.text).replace(/\n/g, "<br>")}</p>`).join("")
    + `</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Queries - ${esc(project)}</title><style>
body{font:11px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#222;margin:18px}h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}th{background:#f3f3f3}
.q{break-inside:avoid;border-top:1px solid #ddd;padding-top:6px;margin-top:10px}.q h3{font-size:12.5px;margin:0}.q .st{font-size:11px;margin-left:6px}
.meta{color:#666;margin:2px 0 4px}.views{display:flex;flex-wrap:wrap;gap:8px}.views figure{margin:0;width:230px}.views img{width:230px;border:1px solid #ccc}
.views figcaption{font-size:10px;color:#555}.fu{margin-left:14px;padding-left:8px;border-left:3px solid #f28022}.fu.answer{border-left-color:#0284c7}.k span{margin-right:16px}.k b{font-size:15px}
.bar{position:sticky;top:0;background:#fff;padding:6px 0;border-bottom:1px solid #ddd;margin-bottom:8px}.bar button{margin-right:6px}
@media print{.bar{display:none}body{margin:8mm}}</style></head><body>
<div class="bar"><button onclick="print()">Print / Save as PDF</button><button id="keep">Save to Folders</button><span id="kept"></span></div>
<h1>Queries - ${esc(project)}</h1><div>${when} · ${all.length} quer${all.length === 1 ? "y" : "ies"}</div>
<p class="k"><span><b>${c("Open")}</b> open</span><span><b>${all.filter(isOver).length}</b> overdue</span><span><b>${c("Answered")}</b> answered</span><span><b>${c("Closed")}</b> closed</span></p>
<h2>Register</h2><table><tr><th>No.</th><th>Subject</th><th>Raised by</th><th>Raised</th><th>To</th><th>Due</th><th>Status</th><th>Answered</th></tr>
${all.map((q) => `<tr><td>${esc(q.code)}</td><td>${esc(q.title)}</td><td>${esc(q.raised_by)}</td><td>${esc((q.created_at || "").slice(0, 10))}</td>`
    + `<td>${esc((q.to || []).map((p) => p.name).join(", "))}</td><td>${esc(q.due || "")}</td><td style="color:${isOver(q) ? COL.over : COL[q.status]}">${esc(isOver(q) ? "Overdue" : q.status)}</td>`
    + `<td>${esc((q.answered_at || "").slice(0, 10))}</td></tr>`).join("")}</table>
<h2>Queries</h2>${all.map(detail).join("")}</body></html>`;
}

/* the pictures inside the page itself: the server makes the PDF from it, without the sign-in */
async function inline(html) {
  const urls = Array.from(new Set(Array.from(html.matchAll(/src="(\/snapshots\/[^"]+)"/g), (m) => m[1])));
  for (const u of urls) {
    try {
      const b = await (await fetch(u)).blob();
      const d = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
      html = html.split(`src="${u}"`).join(`src="${d}"`);
    } catch (e) {}
  }
  return html;
}

function openReport(T, rows) {
  const p = (Q.projects || []).find((x) => x.id === Q.reg) || {};
  const name = (p.short || p.name || "Project") + (p.code ? " (" + p.code + ")" : "");
  const html = reportHtml(T, rows, name);
  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups for this site to open the report."); return; }
  win.document.open(); win.document.write(html); win.document.close();
  const btn = win.document.getElementById("keep");
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    const out = win.document.getElementById("kept");
    out.textContent = " Saving ...";
    try {
      const { saveToFolders } = await import("./tofolders.js");
      const r = await saveToFolders(await inline(html), `Queries_${(p.code || p.short || "project").replace(/[^\w-]+/g, "_")}_${today()}.html`, "Queries", { pdf: true });
      out.textContent = " Kept in Folders: " + ((r && (r.path || r.name)) || "done");
    } catch (e) { out.textContent = " Not kept: " + e.message; btn.disabled = false; }
  };
}

export { closeDetail };
