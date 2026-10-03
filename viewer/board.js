/* Board: a shared canvas for a project team - sticky notes, text, shapes,
 * connectors, mind maps, pictures, frames - in the manner of Miro and
 * Lucidchart, but living with the project's sheets, model and issues.
 *
 * How this file is laid out:
 *
 *   state            what is open, what is selected, the view
 *   changes + undo   every edit goes through begin / rec / commit
 *   drawing          one DOM element per object, redrawn only when it changed
 *   mind maps        layout is worked out here, never stored (board-mind.js)
 *   pointer          one "gesture" at a time: move, resize, draw, connect ...
 *   typing           text is edited in place
 *   commands         delete, duplicate, copy / paste, align, order, lock
 *   toolbars         the tool rail and the bar that follows the selection
 *   boards           the list, new / rename / duplicate / delete
 *   start            sign-in, project, opening a board
 *
 * The network side is board-sync.js; search, comments, export, the link
 * picker, presenting and the timer are in board-extra.js.
 */

import { api, link, project, signOut } from "./nav.js";
import { esc, uid, clone, clamp, round1, col, STICKY_COLORS, INK_COLORS, SHAPE_FILLS, BRANCH_COLORS, isDark, personColor,
         initials, ago, icon, center, unionBox, boxesTouch, route, arrowHead, simplify, penPath } from "./board-util.js";
import { createSync } from "./board-sync.js";
import * as mind from "./board-mind.js";
import { TEMPLATES, makeTemplate, templateThumb } from "./board-templates.js";
import { remap, statusColor } from "./board-export.js";
import { initExtra } from "./board-extra.js";

const $ = (s) => document.querySelector(s);
const stage = $("#bd-stage"), world = $("#bd-world"), objsEl = $("#bd-objs"), branchSvg = $("#bd-branches"),
      connSvg = $("#bd-conns"), labelsEl = $("#bd-labels"), cursorsEl = $("#bd-cursors"), overlay = $("#bd-overlay"),
      ctxEl = $("#bd-ctx"), popEl = $("#bd-pop");
const SVGNS = "http://www.w3.org/2000/svg";

/* ------------------------------------------------------------------ state */

const NONE = new Map();
const A = {
  me: null, name: "", role: "admin", canEdit: true, accounts: false,
  boards: [], board: null, sync: null,
  tool: "select", sel: new Set(), edit: null,
  view: { x: 0, y: 0, s: 1 },
  undo: [], redo: [],
  els: new Map(),          // object id -> its element (connectors: the <g>)
  labels: new Map(),       // connector id -> its label element
  F: mind.forest(NONE),    // the mind-map trees, rebuilt at each layout
  meta: new Map(),         // object id -> { comments: n, reacts: Map(emoji -> [names]) }
  people: [],              // who else is here
  cursor: null,            // this person's pointer, in board coordinates
  space: false,
  hoverNode: null,
  overlayExtra: "",
  zTop: 0, zBottom: 0,
  opts: { stickyFill: STICKY_COLORS[0], shapeKind: "rect", penColor: "#1f2430", penW: 3, connKind: "curve" },
  issues: null, sheets: null,
  presenting: false,
  hits: null,              // search matches
};
const O = () => (A.sync ? A.sync.S.objs : NONE);
const get = (id) => O().get(id);
const strip = (o) => A.sync.strip(o);

const META = new Set(["comment", "react", "timer"]);          // objects that are not drawn on the canvas
const TEXTY = new Set(["sticky", "text", "shape", "node", "frame", "conn"]);
const ATTACH = new Set(["sticky", "text", "shape", "node", "image", "link"]);   // what a connector can hold on to
const TYPE_LABEL = { sticky: "Sticky note", text: "Text", shape: "Shape", conn: "Connector", node: "Mind-map node",
                     pen: "Pen stroke", image: "Picture", frame: "Frame", link: "Link card" };
const FONT_STEPS = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96];
const DEFAULT_FS = { sticky: 16, text: 16, shape: 14, node: 13, frame: 14, conn: 12 };

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
const selObjs = () => Array.from(A.sel).map(get).filter(Boolean);

function toast(text, ms) {
  const t = $("#bd-toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms || 3200);
}

/* "Are you sure?" as part of the page: a browser's own confirm box cannot
   be styled, and on an iPad it appears at the top, away from the finger. */
function ask(text, yes) {
  return new Promise((resolve) => {
    const back = $("#bd-ask-back");
    $("#ask-text").textContent = text;
    $("#ask-yes").textContent = yes || "Delete";
    back.hidden = false;
    const done = (v) => { back.hidden = true; resolve(v); document.removeEventListener("keydown", key, true); };
    const key = (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); done(false); }
      if (ev.key === "Enter") { ev.stopPropagation(); ev.preventDefault(); done(true); }
    };
    document.addEventListener("keydown", key, true);
    $("#ask-yes").onclick = () => done(true);
    $("#ask-no").onclick = () => done(false);
    $("#ask-yes").focus();
  });
}

/* ------------------------------------------------------------------- view */

const stageRect = () => stage.getBoundingClientRect();
function toWorld(cx, cy) {
  const r = stageRect(), v = A.view;
  return { x: (cx - r.left - v.x) / v.s, y: (cy - r.top - v.y) / v.s };
}
const toScreen = (x, y) => ({ x: x * A.view.s + A.view.x, y: y * A.view.s + A.view.y });   // within the stage

function applyView() {
  const v = A.view;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.s})`;
  // The dots thin out when zoomed far out, instead of turning into a grey wash.
  let g = 24 * v.s;
  while (g < 14) g *= 2;
  stage.style.backgroundSize = `${g}px ${g}px`;
  stage.style.backgroundPosition = `${v.x - g / 2}px ${v.y - g / 2}px`;
  $("#z-100").textContent = Math.round(v.s * 100) + "%";
  for (const el of cursorsEl.children) placeCursor(el);
  queueOverlay();
  saveViewSoon();
  if (X.viewChanged) X.viewChanged();
}

function zoomAt(sx, sy, factor) {
  const v = A.view, s = clamp(v.s * factor, 0.05, 4);
  v.x = sx - (sx - v.x) * (s / v.s);
  v.y = sy - (sy - v.y) * (s / v.s);
  v.s = s;
  applyView();
}
function zoomCenter(factor) {
  const r = stageRect();
  zoomAt(r.width / 2, r.height / 2, factor);
}

/* The box an object takes up on the board (a connector: around its line). */
function objBox(o) {
  if (!o || o._hidden || META.has(o.t)) return null;
  if (o.t === "conn") {
    const r = o._r;
    if (!r) return null;
    const xs = r.pts.map((p) => p.x), ys = r.pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: o.x || 0, y: o.y || 0, w: o.w || 0, h: o.h || 0 };
}

function fitBox(b, maxScale, margin) {
  const r = stageRect(), m = margin == null ? 60 : margin;
  if (!b || !r.width) return;
  const s = clamp(Math.min((r.width - m * 2) / Math.max(b.w, 1), (r.height - m * 2) / Math.max(b.h, 1)), 0.05, maxScale || 1.5);
  A.view.s = s;
  A.view.x = r.width / 2 - (b.x + b.w / 2) * s;
  A.view.y = r.height / 2 - (b.y + b.h / 2) * s;
  applyView();
}
function fitAll() {
  const b = unionBox(Array.from(O().values()).map(objBox).filter(Boolean));
  if (b) fitBox(b, 1); else { A.view = { x: stageRect().width / 2, y: stageRect().height / 2, s: 1 }; applyView(); }
}

const viewKey = () => "lwk-board:view:" + project() + ":" + (A.board ? A.board.id : "");
let viewTimer = 0;
function saveViewSoon() {
  if (!A.board || A.presenting) return;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    try { localStorage.setItem(viewKey(), JSON.stringify(A.view)); } catch (e) {}
  }, 400);
}

/* --------------------------------------------------------- changes + undo */

/* Every edit: begin(), rec() each object before touching it, change the
   objects, commit(). commit() works out what really changed, remembers how
   to undo it, queues it for the server and redraws it. Undo therefore only
   ever puts back the objects THIS person changed - it never rolls back
   what someone else did meanwhile to other objects. */
const begin = () => new Map();
function rec(tx, id) {
  if (!tx.has(id)) {
    const o = get(id);
    tx.set(id, o ? clone(strip(o)) : null);
  }
}
function put(tx, o) {
  rec(tx, o.id);
  O().set(o.id, o);
  invalidate([o.id]);
}
function del(tx, id) {
  rec(tx, id);
  O().delete(id);
  invalidate([id]);
}
function commit(tx, opt) {
  if (!A.canEdit || !A.sync) return false;
  const before = new Map(), after = new Map();
  for (const [id, b] of tx) {
    const o = get(id), a = o ? clone(strip(o)) : null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    before.set(id, b);
    after.set(id, a);
  }
  if (!before.size) return false;
  const last = A.undo[A.undo.length - 1];
  if (opt && opt.merge && last) {
    // typing into a note that was just made is one step with making it
    for (const [id, a] of after) {
      if (!last.before.has(id)) last.before.set(id, before.get(id));
      last.after.set(id, a);
    }
  } else {
    A.undo.push({ before, after });
    if (A.undo.length > 200) A.undo.shift();
  }
  A.redo.length = 0;
  A.sync.touch(Array.from(after.keys()));
  invalidate(after.keys());
  toolState();
  return true;
}

function applyState(map) {
  for (const [id, s] of map) {
    if (s === null) {
      O().delete(id);
    } else {
      const cur = get(id) || {};
      const keep = {};
      for (const k of ["rev", "cby", "cat", "uby", "uat"]) if (cur[k] !== undefined) keep[k] = cur[k];
      O().set(id, Object.assign(keep, clone(s)));
    }
  }
  A.sync.touch(Array.from(map.keys()));
  invalidate(map.keys());
  select(Array.from(A.sel).filter((id) => O().has(id)));
}
function undo() {
  if (!A.canEdit) return;
  commitEdit();
  const e = A.undo.pop();
  if (!e) return;
  A.redo.push(e);
  applyState(e.before);
  toolState();
}
function redo() {
  if (!A.canEdit) return;
  commitEdit();
  const e = A.redo.pop();
  if (!e) return;
  A.undo.push(e);
  applyState(e.after);
  toolState();
}

const topZ = () => ++A.zTop;

/* ---------------------------------------------------------------- drawing */

/* Nothing is drawn where it is changed. A change marks ids; once per frame
   the marked objects are redrawn, the mind maps laid out if a node was
   among them, and only the connectors that touch something that moved are
   routed again. */
const dirty = new Set();
let raf = 0, overlayQueued = false, needLayout = false, needMeta = false;

function invalidate(ids) {
  for (const id of ids) dirty.add(id);
  if (!raf) raf = requestAnimationFrame(frame);
}
function queueOverlay() {
  overlayQueued = true;
  if (!raf) raf = requestAnimationFrame(frame);
}
function flushFrame() {
  if (raf) cancelAnimationFrame(raf);
  frame();
}

function frame() {
  raf = 0;
  if (dirty.size || needLayout || needMeta) {
    const ids = new Set(dirty);
    dirty.clear();
    let nodes = needLayout, meta = needMeta;
    const texts = [];
    needLayout = needMeta = false;
    for (const id of ids) {
      const o = get(id);
      if (!o) {
        const el = A.els.get(id);
        if (el) {
          if (el._t === "node") nodes = true;
          el.remove();
          A.els.delete(id);
        } else {
          meta = true;                      // it may have been a comment or a reaction
        }
        const lb = A.labels.get(id);
        if (lb) { lb.remove(); A.labels.delete(id); }
        continue;
      }
      if (o.z > A.zTop) A.zTop = o.z;
      if (o.z < A.zBottom) A.zBottom = o.z;
      if (o.t === "comment" || o.t === "react") { meta = true; continue; }
      if (o.t === "timer") { if (X.timerChanged) X.timerChanged(); continue; }
      if (o.t === "conn") continue;
      renderObj(o);
      if (o.t === "node") nodes = true;
      if (o.t === "text") texts.push(o);
    }
    // Text boxes are as tall as their words: measured together, after all the writing above.
    for (const o of texts) {
      const el = A.els.get(o.id);
      if (el && A.edit?.id !== o.id) o.h = Math.max(el.offsetHeight, 20);
    }
    if (nodes) layoutMind();
    if (meta) rebuildMeta();
    for (const o of O().values()) {
      if (o.t === "conn" && (nodes || ids.has(o.id) || (o.a && ids.has(o.a.o)) || (o.b && ids.has(o.b.o)))) renderConn(o);
    }
    if (X.contentChanged) X.contentChanged(ids);
    overlayQueued = true;
  }
  if (overlayQueued) {
    overlayQueued = false;
    drawOverlay();
  }
}

function makeEl(o) {
  let el;
  if (o.t === "pen") {
    el = document.createElementNS(SVGNS, "svg");
    el.setAttribute("class", "ob pen");
    el.setAttribute("preserveAspectRatio", "none");
    el.innerHTML = `<path class="hitline" vector-effect="non-scaling-stroke"/><path class="ink" vector-effect="non-scaling-stroke"/>`;
  } else {
    el = document.createElement("div");
    el.className = "ob " + o.t;
    if (o.t === "image") el.innerHTML = `<img alt="" draggable="false">`;
    else if (o.t === "frame") {
      el.innerHTML = `<div class="ft"><div class="tx"></div></div><div class="fe n"></div><div class="fe s"></div>`
        + `<div class="fe w"></div><div class="fe e"></div>`;
    } else if (o.t === "shape") el.innerHTML = `<div class="shp"></div><div class="tx"></div>`;
    else if (o.t !== "link") el.innerHTML = `<div class="tx"></div>`;
  }
  el.setAttribute("data-id", o.id);
  el._t = o.t;
  return el;
}

const px = (v) => Math.round((v || 0) * 100) / 100 + "px";

/* Where and how big - all a drag has to touch. */
function place(el, o) {
  el.style.left = px(o.x);
  el.style.top = px(o.y);
  if (o.t === "node") return;
  el.style.width = px(Math.max(o.w || 0, 1));
  if (o.t !== "text") el.style.height = px(Math.max(o.h || 0, 1));
}

function renderObj(o) {
  let el = A.els.get(o.id);
  if (el && el._t !== o.t) { el.remove(); el = null; }
  if (!el) {
    el = makeEl(o);
    A.els.set(o.id, el);
    objsEl.appendChild(el);
  }
  place(el, o);
  el.style.zIndex = String(o.t === "frame" ? (o.z || 0) - 1000000 : (o.z || 0));
  el.classList.toggle("locked", !!o.lock);

  if (o.t === "pen") {
    const ow = Math.max(o.ow || o.w || 1, 1), oh = Math.max(o.oh || o.h || 1, 1);
    el.setAttribute("viewBox", `0 0 ${ow} ${oh}`);
    const d = penPath(Array.isArray(o.pts) ? o.pts : []);
    const [hit, ink] = el.children;
    hit.setAttribute("d", d);
    hit.setAttribute("stroke-width", String(Math.max(14, (o.sw || 3) + 10)));
    ink.setAttribute("d", d);
    ink.setAttribute("stroke", col(o.color, "#1f2430"));
    ink.setAttribute("stroke-width", String(o.sw || 3));
    return;
  }
  if (o.t === "image") {
    const img = el.firstChild;
    // only a path this server handed out is ever loaded
    const src = /^\/snapshots\/[0-9a-f]{8,40}\.(jpg|png)$/.test(o.src || "") ? o.src : "";
    if (img.getAttribute("src") !== src) { if (src) img.setAttribute("src", src); else img.removeAttribute("src"); }
    el.classList.toggle("loading", !!o._uploading);
    renderBadges(el, o);
    return;
  }
  if (o.t === "link") {
    renderLink(el, o);
    renderBadges(el, o);
    return;
  }

  const tx = el.querySelector(".tx");
  if (!(A.edit && A.edit.id === o.id)) {
    const text = o.text || "";
    if (tx.textContent !== text) tx.textContent = text;
  }
  const fill = o.t === "sticky" ? col(o.fill, STICKY_COLORS[0]) : o.fill ? col(o.fill, "") : "";
  const fs = clamp(Number(o.fs) || 0, 0, 400);
  el.style.fontSize = fs ? fs + "px" : "";
  el.style.fontWeight = o.bold === undefined ? "" : o.bold ? "700" : "400";
  el.style.textAlign = o.align || "";
  if (o.t === "sticky") {
    el.style.background = fill;
    el.style.color = col(o.color, isDark(fill) ? "#ffffff" : "#1f2430");
  } else if (o.t === "text") {
    el.style.color = col(o.color, "#1f2430");
    el.classList.toggle("empty", !o.text);
  } else if (o.t === "shape") {
    const kind = ["rect", "round", "ellipse", "diamond"].includes(o.kind) ? o.kind : "rect";
    el.className = el.className.replace(/\bk-\w+/g, "").trim() + " k-" + kind;
    const shp = el.firstChild, stroke = col(o.stroke, "#1f2430"), bg = col(o.fill, "#ffffff"), sw = clamp(Number(o.sw) || 2, 0.5, 40);
    if (kind === "diamond") {
      shp.style.cssText = "position:absolute;inset:0";
      shp.innerHTML = `<svg class="shp" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,0 100,50 50,100 0,50" `
        + `fill="${bg}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    } else {
      shp.innerHTML = "";
      shp.style.cssText = `position:absolute;inset:0;box-sizing:border-box;background:${bg};border:${sw}px solid ${stroke};`
        + `border-radius:${kind === "ellipse" ? "50%" : kind === "round" ? Math.round(Math.min(o.w, o.h) * 0.22) + "px" : "2px"}`;
    }
    el.style.color = col(o.color, isDark(o.fill) ? "#ffffff" : "#1f2430");
  } else if (o.t === "frame") {
    el.style.background = col(o.fill, "#ffffff");
    el.querySelector(".ft").style.color = col(o.color, "");
  } else if (o.t === "node") {
    el.style.background = fill;
    el.style.borderColor = fill ? fill : "";
    el.style.color = o.color ? col(o.color, "") : fill ? (isDark(fill) ? "#ffffff" : "#1f2430") : "";
  }
  renderBadges(el, o);
}

function renderLink(el, o) {
  const p = encodeURIComponent(project());
  let head, st = "#3b82f6", status = "", title = o.title || "", metaLine = "", late = false, href, gone = false;
  if (o.kind === "sheet") {
    const s = (A.sheets || []).find((x) => x.number === o.ref);
    if (s) title = s.name || title;
    head = "Sheet " + (o.ref || "");
    href = "index.html?project=" + p + "&sheet=" + encodeURIComponent(o.ref || "");
  } else {
    // The live issue when it has been fetched; otherwise what the card remembered when it was made.
    const live = A.issues && A.issues.get(o.ref);
    gone = !!A.issues && !live;
    const i = live || { number: o.num, title: o.title, status: o.status, assignee: o.who, due: o.due, sheet: o.sheet, p3d: o.p3d };
    head = "#" + (i.number || "?");
    status = gone ? "Deleted" : i.status || "Open";
    st = gone ? "#9aa3af" : statusColor(status);
    title = i.title || "(no title)";
    late = !!i.due && !["Resolved", "Closed", "Not an issue"].includes(status) && i.due < new Date().toISOString().slice(0, 10);
    metaLine = [i.assignee || "Unassigned", i.due ? "due " + i.due : "", i.sheet ? "sheet " + i.sheet : i.p3d ? "3D" : ""]
      .filter(Boolean).join("  ·  ");
    href = i.sheet ? "index.html?project=" + p + "&sheet=" + encodeURIComponent(i.sheet) + "&select=" + encodeURIComponent(o.ref || "")
      : "model.html?project=" + p + "&select=" + encodeURIComponent(o.ref || "");
  }
  el.style.setProperty("--st", st);
  el.innerHTML = `<div class="lk-top"><b>${esc(head)}</b>${status ? `<span class="lk-st">${esc(status)}</span>` : ""}</div>`
    + `<div class="lk-t">${esc(title)}</div>`
    + `<div class="lk-m${late ? " late" : ""}">${esc(metaLine)}</div>`
    + (gone ? "" : `<a class="lk-open" href="${esc(href)}" target="_blank" rel="noopener" title="Open it in the viewer">View &#8599;</a>`);
  el._href = gone ? "" : href;
}

/* Comments and reactions are separate small objects that point at the
   thing they are on (so two people commenting at once cannot overwrite
   each other). This gathers them per object for the little badges. */
function rebuildMeta() {
  const old = A.meta;
  const now = new Map();
  const slot = (id) => {
    if (!now.has(id)) now.set(id, { comments: 0, reacts: new Map() });
    return now.get(id);
  };
  for (const o of O().values()) {
    if (o.t === "comment" && o.on) slot(o.on).comments++;
    else if (o.t === "react" && o.on && typeof o.e === "string" && o.e.length <= 8) {
      const m = slot(o.on).reacts;
      if (!m.has(o.e)) m.set(o.e, []);
      m.get(o.e).push(o.who || o.cby || "");
    }
  }
  A.meta = now;
  for (const id of new Set([...old.keys(), ...now.keys()])) {
    const o = get(id), el = A.els.get(id);
    if (o && el && o.t !== "conn" && o.t !== "pen") renderBadges(el, o);
  }
  if (X.metaChanged) X.metaChanged();
}

function renderBadges(el, o) {
  const m = A.meta.get(o.id);
  let bdg = el.querySelector(":scope > .bdg"), rx = el.querySelector(":scope > .rx");
  if (!m || !m.comments) { if (bdg) bdg.remove(); }
  else {
    if (!bdg) { bdg = document.createElement("div"); bdg.className = "bdg"; el.appendChild(bdg); }
    bdg.innerHTML = `<span class="cm" title="Comments">${m.comments}</span>`;
  }
  if (!m || !m.reacts.size) { if (rx) rx.remove(); }
  else {
    if (!rx) { rx = document.createElement("div"); rx.className = "rx"; el.appendChild(rx); }
    rx.innerHTML = Array.from(m.reacts).map(([e, names]) =>
      `<span data-e="${esc(e)}" class="${names.includes(A.name) ? "mine" : ""}" title="${esc(names.join(", "))}">${esc(e)} ${names.length}</span>`).join("");
  }
}

/* -------------------------------------------------------------- connectors */

function connEnds(o) {
  // -> [A object or null, B object or null], or null when an end is folded away
  const end = (e) => {
    if (e && e.o) {
      const t = get(e.o);
      if (t && !META.has(t.t)) return t._hidden ? false : t;
    }
    return null;
  };
  const a = end(o.a), b = end(o.b);
  return a === false || b === false ? null : [a, b];
}

function renderConn(o) {
  let g = A.els.get(o.id);
  if (!g) {
    g = document.createElementNS(SVGNS, "g");
    g.setAttribute("data-id", o.id);
    g._t = "conn";
    g.innerHTML = `<path class="hitline"/><path class="ln"/><path class="hd"/>`;
    connSvg.appendChild(g);
    A.els.set(o.id, g);
  }
  const ends = connEnds(o);
  if (!ends) {
    g.style.display = "none";
    o._r = null;
    const lb = A.labels.get(o.id);
    if (lb) lb.style.display = "none";
    return;
  }
  g.style.display = "";
  const r = o._r = route(o.kind || "straight", ends[0], ends[1], o.a || { x: 0, y: 0 }, o.b || { x: 0, y: 0 });
  const [hit, ln, hd] = g.children;
  const c = col(o.color, "#1f2430"), sw = clamp(Number(o.sw) || 2, 0.5, 40);
  hit.setAttribute("d", r.d);
  ln.setAttribute("d", r.d);
  ln.setAttribute("stroke", c);
  ln.setAttribute("stroke-width", String(sw));
  ln.setAttribute("stroke-dasharray", o.dash ? "8 6" : "");
  const size = 8 + sw * 2, arrow = o.arrow || "end";
  hd.setAttribute("d", (arrow !== "none" ? arrowHead(r.p2, r.from2, size) : "")
    + (arrow === "both" ? arrowHead(r.p1, r.from1, size) : ""));
  hd.setAttribute("stroke", c);
  hd.setAttribute("stroke-width", String(sw));
  g.setAttribute("class", (o.lock ? "locked " : "") + (A.sel.has(o.id) ? "sel" : ""));

  let lb = A.labels.get(o.id);
  const editing = A.edit && A.edit.id === o.id;
  if (!o.text && !editing) {
    if (lb) { lb.remove(); A.labels.delete(o.id); }
    return;
  }
  if (!lb) {
    lb = document.createElement("div");
    lb.className = "cl";
    lb.setAttribute("data-id", o.id);
    lb.innerHTML = `<div class="tx"></div>`;
    labelsEl.appendChild(lb);
    A.labels.set(o.id, lb);
  }
  lb.style.display = "";
  lb.style.left = px(r.mid.x);
  lb.style.top = px(r.mid.y);
  lb.style.fontSize = (o.fs || 12) + "px";
  lb.style.color = col(o.color, "#1f2430");
  if (!editing && lb.firstChild.textContent !== o.text) lb.firstChild.textContent = o.text;
}

function updateConns(ids, all) {
  for (const o of O().values()) {
    if (o.t === "conn" && (all || ids.has(o.id) || (o.a && ids.has(o.a.o)) || (o.b && ids.has(o.b.o)))) renderConn(o);
  }
}

/* --------------------------------------------------------------- mind maps */

function layoutMind() {
  const F = A.F = mind.forest(O());
  // 1. what each node looks like (its depth decides its font) and whether it is folded away
  const hidden = new Set();
  const hide = (id) => { for (const k of mind.childrenOf(F, id)) { hidden.add(k.id); hide(k.id); } };
  for (const n of F.byId.values()) if (n.collapsed) hide(n.id);
  for (const n of F.byId.values()) {
    const el = A.els.get(n.id);
    if (!el) continue;
    const d = Math.min(F.depth.get(n.id) || 0, 2);
    const cls = "ob node d" + d + (n.lock ? " locked" : "") + (A.sel.has(n.id) ? " sel" : "")
      + (el.classList.contains("ghost") ? " ghost" : "") + (el.classList.contains("hit") ? " hit" : "")
      + (el.classList.contains("drop") ? " drop" : "")
      + (el.classList.contains("cur") ? " cur" : "") + (A.edit && A.edit.id === n.id && A.edit.isNew ? " new" : "");
    if (el.className !== cls) el.className = cls;
    el.style.display = hidden.has(n.id) ? "none" : "";
  }
  // 2. measure them all in one go
  const size = new Map();
  for (const n of F.byId.values()) {
    const el = A.els.get(n.id);
    if (el && !hidden.has(n.id)) size.set(n.id, { w: el.offsetWidth, h: el.offsetHeight });
  }
  // 3. place them
  let paths = "";
  for (const root of F.roots) {
    const pos = mind.layout(F, root, (n) => size.get(n.id) || { w: 60, h: 28 });
    for (const [id, p] of pos) {
      const n = F.byId.get(id), el = A.els.get(id);
      n._hidden = !!p.hidden;
      if (p.hidden) { n.x = p.x; n.y = p.y; continue; }
      const s = size.get(id) || { w: 60, h: 28 };
      n.x = p.x; n.y = p.y; n.w = s.w; n.h = s.h;
      n._dir = p.dir; n._color = p.color; n._depth = p.depth;
      n._below = n.collapsed ? mind.countBelow(F, id) : 0;
      if (!el) continue;
      el.style.left = px(p.x);
      el.style.top = px(p.y);
      if (p.color) el.style.setProperty("--bc", p.color); else el.style.removeProperty("--bc");
      // the little button that folds a branch away, or says how much is folded
      let fold = el.querySelector(":scope > .nd-fold");
      const kids = mind.childrenOf(F, id).length;
      if (!kids || p.depth === 0) { if (fold) fold.remove(); }
      else {
        if (!fold) { fold = document.createElement("button"); fold.type = "button"; el.appendChild(fold); }
        fold.className = "nd-fold " + (p.dir < 0 ? "l" : "r") + (n.collapsed ? " shut" : " open");
        fold.textContent = n.collapsed ? String(n._below) : "−";
        fold.title = n.collapsed ? "Show the " + n._below + " folded below" : "Fold this branch away";
      }
      const parent = F.parentOf.get(id) && F.byId.get(F.parentOf.get(id));
      if (parent && !parent._hidden) {
        paths += `<path d="${mind.branchPath(parent, n, p.dir)}" stroke="${col(p.color, "#9aa3af")}"/>`;
      }
    }
  }
  branchSvg.innerHTML = paths;
}

const isRootNode = (id) => A.F.byId.has(id) && !A.F.parentOf.get(id);

/* ----------------------------------------------------------------- overlay */

const RESIZE = { sticky: "all", shape: "all", frame: "all", link: "all", image: "corners", pen: "corners", text: "sides" };

function drawOverlay() {
  const parts = [];
  const sel = selObjs();
  const v = A.view;
  const sbox = (b) => ({ x: b.x * v.s + v.x, y: b.y * v.s + v.y, w: b.w * v.s, h: b.h * v.s });
  const boxes = [];
  sel.forEach((o, i) => {
    const b = objBox(o);
    if (!b) return;
    boxes.push(b);
    if (o.t === "conn" || i > 80) return;
    const s = sbox(b);
    parts.push(`<div class="sel-box${o.lock ? " locked" : ""}" style="left:${s.x - 3}px;top:${s.y - 3}px;width:${s.w + 6}px;height:${s.h + 6}px"></div>`);
  });
  if (sel.length > 1 && boxes.length) {
    const s = sbox(unionBox(boxes));
    parts.push(`<div class="sel-box group" style="left:${s.x - 8}px;top:${s.y - 8}px;width:${s.w + 16}px;height:${s.h + 16}px"></div>`);
  }
  const one = sel.length === 1 ? sel[0] : null;
  if (one && A.canEdit && !one.lock && !A.edit && !A.presenting) {
    if (one.t === "conn" && one._r) {
      for (const [end, p] of [["a", one._r.p1], ["b", one._r.p2]]) {
        const s = toScreen(p.x, p.y);
        parts.push(`<div class="hnd end" data-end="${end}" style="left:${s.x}px;top:${s.y}px"></div>`);
      }
    } else if (RESIZE[one.t]) {
      const s = sbox(objBox(one)), mode = RESIZE[one.t];
      const at = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
      for (const [h, [fx, fy]] of Object.entries(at)) {
        if (mode === "corners" && h.length < 2) continue;
        if (mode === "sides" && h !== "e" && h !== "w") continue;
        parts.push(`<div class="hnd h-${h}" data-h="${h}" style="left:${s.x - 3 + (s.w + 6) * fx}px;top:${s.y - 3 + (s.h + 6) * fy}px"></div>`);
      }
    }
    // dots to pull a connector out of the thing
    if (ATTACH.has(one.t) && one.t !== "node" && !G) {
      const s = sbox(objBox(one)), off = 24;
      for (const [x, y] of [[s.x + s.w / 2, s.y - off], [s.x + s.w + off, s.y + s.h / 2], [s.x + s.w / 2, s.y + s.h + off], [s.x - off, s.y + s.h / 2]]) {
        parts.push(`<div class="cdot" title="Drag to connect" style="left:${x}px;top:${y}px"></div>`);
      }
    }
  }
  // "+" on a mind-map node: the selected one, and the one under the mouse
  if (A.canEdit && !A.edit && !G && !A.presenting) {
    const shown = new Set();
    for (const n of [one && one.t === "node" ? one : null, A.hoverNode ? get(A.hoverNode) : null]) {
      if (!n || n.t !== "node" || n._hidden || n.lock || shown.has(n.id)) continue;
      shown.add(n.id);
      const s = sbox(objBox(n)), gap = 16, plus = icon("plus", 14);
      const btn = (x, y, kind, side, tip) => parts.push(`<button class="nplus" data-id="${n.id}" data-kind="${kind}" `
        + `data-side="${side}" title="${tip}" style="left:${x}px;top:${y}px">${plus}</button>`);
      if (isRootNode(n.id)) {
        btn(s.x + s.w + gap, s.y + s.h / 2, "child", "r", "Add a branch (Tab)");
        btn(s.x - gap, s.y + s.h / 2, "child", "l", "Add a branch on this side");
      } else {
        const out = n._dir < 0 ? s.x - gap - (n.collapsed ? 16 : 6) : s.x + s.w + gap + (n.collapsed ? 16 : 6);
        btn(out, s.y + s.h / 2, "child", "", "Add a child (Tab)");
        btn(s.x + s.w / 2, s.y + s.h + gap, "sibling", isRootNode(A.F.parentOf.get(n.id)) ? (n.side === "l" ? "l" : "r") : "", "Add one below (Enter)");
      }
    }
  }
  overlay.innerHTML = parts.join("") + A.overlayExtra;

  // which elements wear the "selected" look
  for (const el of objsEl.querySelectorAll(".ob.sel")) if (!A.sel.has(el.getAttribute("data-id"))) el.classList.remove("sel");
  for (const g of connSvg.querySelectorAll("g.sel")) if (!A.sel.has(g.getAttribute("data-id"))) g.classList.remove("sel");
  for (const id of A.sel) { const el = A.els.get(id); if (el) el.classList.add("sel"); }
  placeCtx(boxes.length ? sbox(unionBox(boxes)) : null);
}

/* ------------------------------------------------------------- selection */

function select(ids) {
  A.sel = new Set(ids);
  selectionChanged();
}
function selectionChanged() {
  closePop();
  buildCtx();
  const sel = selObjs(), info = $("#bd-info");
  if (sel.length === 1) {
    const o = sel[0], now = A.sync.now();
    info.textContent = [TYPE_LABEL[o.t] || o.t, o.cby ? "created by " + o.cby : "",
      o.uby ? "last edited by " + o.uby + (o.uat ? " " + ago(o.uat, now) : "") : "", o.lock ? "locked" : ""].filter(Boolean).join("  ·  ");
    info.hidden = false;
  } else if (sel.length > 1) {
    info.textContent = sel.length + " objects selected";
    info.hidden = false;
  } else {
    info.hidden = true;
  }
  if (X.selectionChanged) X.selectionChanged();
  queueOverlay();
}

/* ---------------------------------------------------------------- pointer */

/* One gesture at a time. A gesture is an object with move / up / cancel;
   which one starts depends on the tool and on what is under the pointer.
   Two fingers always mean "move and zoom the board", whatever was going on. */
const PT = new Map();
let G = null, pinch = null, waitAllUp = false;
const CHROME = "#bd-tools,#bd-toolopts,#bd-ctx,#bd-pop,#bd-zoom,#bd-mini,#bd-home,#bd-present-bar,#bd-info";

stage.addEventListener("pointerdown", onDown);
window.addEventListener("pointermove", onMove);
window.addEventListener("pointerup", onUp);
window.addEventListener("pointercancel", (ev) => onUp(ev, true));
stage.addEventListener("contextmenu", (ev) => { if (!isTyping(ev.target)) ev.preventDefault(); });

function onDown(ev) {
  // two taps make a double tap only if nothing else was pressed in between
  if (lastTap && (lastTap.id !== hitId(ev.target) || ev.target.closest(CHROME))) lastTap = null;
  if (!A.sync || ev.target.closest(CHROME)) return;
  if (ev.target.closest("a.lk-open")) return;                   // a real link: let the browser follow it
  closePop();
  if (A.edit) {
    if (A.edit.el.contains(ev.target)) return;                  // placing the caret in the text being typed
    commitEdit();
  }
  if (ev.pointerType === "mouse" && ev.button === 2) return;
  if (ev.button === 1) lastMiddle = performance.now();
  ev.preventDefault();
  if (isTyping(document.activeElement)) document.activeElement.blur();
  // Everything this finger does next comes to the stage, even if the
  // element it landed on is redrawn (and so removed) while it moves.
  try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
  // a first finger (or the mouse) always starts clean, whatever an earlier gesture left behind
  if (ev.isPrimary) { PT.clear(); pinch = null; waitAllUp = false; }
  PT.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (ev.pointerType === "touch" && PT.size === 2) {
    if (G) { if (G.cancel) G.cancel(); G = null; A.overlayExtra = ""; }
    startPinch();
    return;
  }
  if (PT.size > 1 || waitAllUp) return;
  G = pickGesture(ev);
  queueOverlay();
}

function onMove(ev) {
  if (ev.pointerType === "mouse") {
    const r = stageRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    A.cursor = inside && A.sync ? toWorld(ev.clientX, ev.clientY) : null;
    if (!G && A.sync) hoverNode(ev);
  }
  if (!PT.has(ev.pointerId)) return;
  PT.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch) { movePinch(); return; }
  if (G && G.move) G.move(ev);
}

function onUp(ev, cancelled) {
  if (ev.button === 1) lastMiddle = performance.now();
  if (!PT.has(ev.pointerId)) return;
  PT.delete(ev.pointerId);
  if (pinch) {
    pinch = null;
    waitAllUp = PT.size > 0;            // the finger left behind does not start dragging things
    return;
  }
  if (waitAllUp) { waitAllUp = PT.size > 0; return; }
  const g = G;
  G = null;
  if (g) {
    if (cancelled) { if (g.cancel) g.cancel(); } else if (g.up) g.up(ev);
  }
  A.overlayExtra = "";
  stage.classList.remove("panning");
  queueOverlay();
}

function startPinch() {
  const [a, b] = Array.from(PT.values());
  const r = stageRect();
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
            v: Object.assign({}, A.view) };
}
function movePinch() {
  const [a, b] = Array.from(PT.values());
  if (!a || !b) return;
  const r = stageRect(), p = pinch;
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
  const s = clamp(p.v.s * (d / p.d), 0.05, 4);
  // the board point that was between the fingers stays between the fingers
  A.view.s = s;
  A.view.x = mx - (p.mx - p.v.x) * (s / p.v.s);
  A.view.y = my - (p.my - p.v.y) * (s / p.v.s);
  applyView();
}

const hitId = (t) => {
  const el = t && t.closest ? t.closest("[data-id]") : null;
  return el ? el.getAttribute("data-id") : null;
};

function pickGesture(ev) {
  const t = ev.target, p = toWorld(ev.clientX, ev.clientY);
  if (ev.button === 1 || A.space || A.tool === "hand" || A.presenting) return panGesture(ev);

  // things that act at once
  const cm = t.closest(".bdg .cm");
  if (cm) { const id = hitId(cm); select([id]); if (X.openThread) X.openThread(id); return null; }
  const rx = t.closest(".rx span");
  if (rx) { if (X.toggleReact) X.toggleReact(hitId(rx), rx.getAttribute("data-e")); return null; }
  const fold = t.closest(".nd-fold");
  if (fold) { toggleFold(hitId(fold)); return null; }
  if (A.canEdit) {
    const np = t.closest(".nplus");
    if (np) { addNode(np.dataset.id, np.dataset.kind, np.dataset.side); return null; }
    const h = t.closest(".hnd");
    if (h) return h.dataset.end ? endGesture(ev, h.dataset.end) : resizeGesture(ev, h.dataset.h);
    if (t.closest(".cdot")) return connGesture(ev, { o: Array.from(A.sel)[0] });
  }

  const id = hitId(t);
  switch (A.canEdit ? A.tool : "select") {
    case "sticky": case "text": case "shape": case "frame": case "node":
      return createGesture(ev, p);
    case "pen":
      return penGesture(ev, p);
    case "conn": {
      const o = id && get(id);
      return connGesture(ev, o && ATTACH.has(o.t) ? { o: id } : { x: round1(p.x), y: round1(p.y) });
    }
    default:
      if (id && get(id)) return objectGesture(ev, id, p);
      return ev.pointerType === "touch" ? touchEmptyGesture(ev, p) : marqueeGesture(ev, p);
  }
}

/* --- move the board */
function panGesture(ev) {
  let x = ev.clientX, y = ev.clientY;
  stage.classList.add("panning");
  return {
    move(e) {
      A.view.x += e.clientX - x;
      A.view.y += e.clientY - y;
      x = e.clientX; y = e.clientY;
      applyView();
    },
  };
}

/* --- a finger on empty board: move the board; hold still first to draw a selection box */
function touchEmptyGesture(ev, p0) {
  const pan = panGesture(ev);
  stage.classList.remove("panning");
  const sx = ev.clientX, sy = ev.clientY;
  let moved = false, box = null;
  const timer = setTimeout(() => {
    if (moved) return;
    box = marqueeGesture(ev, p0);
    A.overlayExtra = `<div class="marquee" style="left:${sx - stageRect().left - 14}px;top:${sy - stageRect().top - 14}px;width:28px;height:28px;border-radius:50%"></div>`;
    queueOverlay();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
  }, 450);
  return {
    move(e) {
      if (box) return box.move(e);
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
      moved = true;
      pan.move(e);
    },
    up(e) {
      clearTimeout(timer);
      if (box) return box.up(e);
      if (!moved) select([]);
    },
    cancel() { clearTimeout(timer); },
  };
}

/* --- a selection box */
let lastEmptyTap = null;
function marqueeGesture(ev, p0) {
  const add = ev.shiftKey;
  const base = add ? new Set(A.sel) : new Set();
  const sx = ev.clientX, sy = ev.clientY;
  let box = null;
  return {
    move(e) {
      if (!box && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      const p = toWorld(e.clientX, e.clientY);
      box = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      const a = toScreen(box.x, box.y);
      A.overlayExtra = `<div class="marquee" style="left:${a.x}px;top:${a.y}px;width:${box.w * A.view.s}px;height:${box.h * A.view.s}px"></div>`;
      queueOverlay();
    },
    up(e) {
      if (!box) {
        if (!add) select([]);
        // double-click on empty board: start typing there
        const now = performance.now();
        if (A.canEdit && lastEmptyTap && now - lastEmptyTap.t < 400 && Math.hypot(e.clientX - lastEmptyTap.x, e.clientY - lastEmptyTap.y) < 10) {
          lastEmptyTap = null;
          createObject("text", null, p0);
        } else lastEmptyTap = { t: now, x: e.clientX, y: e.clientY };
        return;
      }
      const ids = new Set(base);
      for (const o of O().values()) {
        const b = objBox(o);
        if (!b || o.lock) continue;
        // a frame, a line: only when the box goes right round it - otherwise every box inside a frame would take the frame too
        const whole = b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
        if (o.t === "frame" || o.t === "conn" ? whole : boxesTouch(b, box)) ids.add(o.id);
      }
      select(ids);
    },
  };
}

/* --- press on an object: select it; drag moves it (a mind-map node: re-parents it) */
let lastTap = null;
function objectGesture(ev, id, p0) {
  const multi = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  const wasSelected = A.sel.has(id);
  if (multi) {
    const s = new Set(A.sel);
    if (wasSelected) s.delete(id); else s.add(id);
    select(s);
    return {};
  }
  if (!wasSelected) select([id]);
  const thr = ev.pointerType === "touch" ? 8 : 4, sx = ev.clientX, sy = ev.clientY;
  let mode = null, movers = null, tx = null, rp = null, startBox = null, others = null, dropNode = null;
  const g = {
    ids: new Set(),                 // what the poll must leave alone while this goes on
    move(e) {
      const p = toWorld(e.clientX, e.clientY);
      if (!mode) {
        if (!A.canEdit || Math.hypot(e.clientX - sx, e.clientY - sy) < thr) return;
        const o = get(id);
        if (!o) return;
        if (o.t === "node" && !isRootNode(id) && !o.lock) {
          mode = "reparent";
          const el = A.els.get(id);
          el.classList.add("ghost");
          rp = { o, el, sub: new Set(mind.subtree(A.F, id)), x: o.x, y: o.y, target: null };
          g.ids.add(id);
        } else {
          movers = collectMovers();
          if (!movers.size) { mode = "none"; return; }
          mode = "move";
          tx = begin();
          for (const mid of movers.keys()) { rec(tx, mid); g.ids.add(mid); }
          startBox = unionBox(Array.from(movers.values()).filter((m) => m.o.t !== "conn").map((m) => objBox(m.o)).filter(Boolean));
          others = snapCandidates(new Set(movers.keys()));
        }
        queueOverlay();
      }
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (mode === "reparent") {
        rp.el.style.left = px(rp.x + dx);
        rp.el.style.top = px(rp.y + dy);
        setDrop(nodeAt(e.clientX, e.clientY, rp.sub));
        rp.target = dropNode;
        return;
      }
      if (mode !== "move") return;
      A.overlayExtra = "";
      if (startBox && !e.ctrlKey && !e.metaKey) {
        const sn = snap({ x: startBox.x + dx, y: startBox.y + dy, w: startBox.w, h: startBox.h }, others);
        dx += sn.dx; dy += sn.dy;
        A.overlayExtra = sn.html;
      }
      moveBy(movers, dx, dy);
      // a whole mind map dragged onto a node of another one joins it
      const only = movers.size === 1 ? Array.from(movers.values())[0].o : null;
      if (only && only.t === "node") setDrop(nodeAt(e.clientX, e.clientY, new Set(mind.subtree(A.F, only.id))));
    },
    up(e) {
      if (mode === "reparent") {
        rp.el.classList.remove("ghost");
        const target = dropNode;
        setDrop(null);
        finishReparent(rp.o, target, toWorld(e.clientX, e.clientY));
        return;
      }
      if (mode === "move") {
        const only = movers.size === 1 ? Array.from(movers.values())[0].o : null;
        const target = dropNode;
        setDrop(null);
        if (only && only.t === "node" && target) {
          const m = movers.get(only.id);
          only.x = m.x; only.y = m.y;
          attachNode(tx, only, target, toWorld(e.clientX, e.clientY));
        }
        commit(tx);
        return;
      }
      // a tap: twice (or once on what is already selected, with a finger) starts typing
      const o = get(id), now = performance.now();
      const dbl = lastTap && lastTap.id === id && now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 12;
      lastTap = { id, t: now, x: e.clientX, y: e.clientY };
      if (!o) return;
      if (dbl && o.t === "link") { openLink(o); return; }
      if ((dbl || (e.pointerType === "touch" && wasSelected && A.sel.size === 1)) && TEXTY.has(o.t)) {
        lastTap = null;
        startEdit(id, {});
      }
    },
    cancel() {
      setDrop(null);
      if (mode === "reparent") { rp.el.classList.remove("ghost"); needLayout = true; queueOverlay(); }
      if (mode === "move") { moveBy(movers, 0, 0); }
    },
  };
  return g;

  function setDrop(n) {
    if (dropNode === n) return;
    if (dropNode) { const el = A.els.get(dropNode.id); if (el) el.classList.remove("drop"); }
    dropNode = n;
    if (n) { const el = A.els.get(n.id); if (el) el.classList.add("drop"); }
  }
}

/* What moves when the selection is dragged: the selected things that are
   free to move, plus whatever sits inside a selected frame. A mind map
   moves by its root; the other nodes follow because the layout says so. */
function collectMovers() {
  const out = new Map();
  const add = (o) => {
    if (!o || o.lock || out.has(o.id) || META.has(o.t) || o._hidden) return;
    if (o.t === "node" && !isRootNode(o.id)) return;
    if (o.t === "conn") { out.set(o.id, { o, a: clone(o.a || {}), b: clone(o.b || {}) }); return; }
    out.set(o.id, { o, x: o.x || 0, y: o.y || 0 });
  };
  for (const o of selObjs()) {
    add(o);
    if (o.t === "frame" && !o.lock) {
      for (const k of O().values()) {
        if (k === o || k.t === "conn" || META.has(k.t)) continue;
        const c = center(k);
        if (c.x >= o.x && c.x <= o.x + o.w && c.y >= o.y && c.y <= o.y + o.h && !(k.t === "frame" && k.w * k.h >= o.w * o.h)) add(k);
      }
    }
  }
  return out;
}

function moveBy(movers, dx, dy) {
  let roots = false;
  const ids = new Set();
  for (const [id, m] of movers) {
    const o = m.o;
    ids.add(id);
    if (o.t === "conn") {
      if (!(o.a && o.a.o)) o.a = { x: round1((m.a.x || 0) + dx), y: round1((m.a.y || 0) + dy) };
      if (!(o.b && o.b.o)) o.b = { x: round1((m.b.x || 0) + dx), y: round1((m.b.y || 0) + dy) };
      continue;
    }
    o.x = round1(m.x + dx);
    o.y = round1(m.y + dy);
    if (o.t === "node") roots = true;
    const el = A.els.get(id);
    if (el) place(el, o);
  }
  if (roots) layoutMind();
  updateConns(ids, roots);
  drawOverlay();
}

/* Lining up while dragging: the edges and the middle of what is being
   moved against the edges and middles of what is on screen. */
function snapCandidates(moving) {
  const r = stageRect(), a = toWorld(r.left, r.top), b = toWorld(r.right, r.bottom);
  const view = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  const out = [];
  for (const o of O().values()) {
    if (moving.has(o.id) || o.t === "conn" || o.t === "pen") continue;
    if (o.t === "node" && !isRootNode(o.id) && moving.has(A.F.rootOf.get(o.id))) continue;
    const bx = objBox(o);
    if (bx && boxesTouch(bx, view)) out.push(bx);
    if (out.length > 150) break;
  }
  return out;
}
function snap(box, others) {
  const tol = 6 / A.view.s;
  let bestX = null, bestY = null;
  const mx = [box.x, box.x + box.w / 2, box.x + box.w], my = [box.y, box.y + box.h / 2, box.y + box.h];
  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w], oy = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const m of mx) for (const t of ox) {
      const d = t - m;
      if (Math.abs(d) < tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: t, o };
    }
    for (const m of my) for (const t of oy) {
      const d = t - m;
      if (Math.abs(d) < tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: t, o };
    }
  }
  let html = "";
  const dx = bestX ? bestX.d : 0, dy = bestY ? bestY.d : 0;
  if (bestX) {
    const y0 = Math.min(box.y + dy, bestX.o.y), y1 = Math.max(box.y + dy + box.h, bestX.o.y + bestX.o.h);
    const a = toScreen(bestX.at, y0), b = toScreen(bestX.at, y1);
    html += `<div class="guide v" style="left:${a.x}px;top:${a.y}px;height:${b.y - a.y}px"></div>`;
  }
  if (bestY) {
    const x0 = Math.min(box.x + dx, bestY.o.x), x1 = Math.max(box.x + dx + box.w, bestY.o.x + bestY.o.w);
    const a = toScreen(x0, bestY.at), b = toScreen(x1, bestY.at);
    html += `<div class="guide h" style="left:${a.x}px;top:${a.y}px;width:${b.x - a.x}px"></div>`;
  }
  return { dx, dy, html };
}

/* The thing under a screen point that a connector may hold on to. */
function attachAt(cx, cy, not) {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const ob = el.closest && el.closest(".ob[data-id]");
    if (!ob) continue;
    const o = get(ob.getAttribute("data-id"));
    if (o && ATTACH.has(o.t) && o.id !== not) return o;
  }
  return null;
}
function nodeAt(cx, cy, notIn) {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const ob = el.closest && el.closest(".ob.node[data-id]");
    if (!ob) continue;
    const o = get(ob.getAttribute("data-id"));
    if (o && !notIn.has(o.id)) return o;
  }
  return null;
}

/* --- resize by a handle */
function resizeGesture(ev, h) {
  const o = selObjs()[0];
  if (!o) return null;
  const tx = begin();
  rec(tx, o.id);
  const b0 = { x: o.x, y: o.y, w: o.w, h: o.h }, p0 = toWorld(ev.clientX, ev.clientY);
  const keep = o.t === "image" || o.t === "pen";
  const min = o.t === "frame" ? 60 : 24;
  const el = A.els.get(o.id);
  return {
    ids: new Set([o.id]),
    move(e) {
      const p = toWorld(e.clientX, e.clientY), dx = p.x - p0.x, dy = p.y - p0.y;
      let { x, y, w, h: hh } = b0;
      if (h.includes("e")) w = Math.max(min, b0.w + dx);
      if (h.includes("s")) hh = Math.max(min, b0.h + dy);
      if (h.includes("w")) { w = Math.max(min, b0.w - dx); x = b0.x + b0.w - w; }
      if (h.includes("n")) { hh = Math.max(min, b0.h - dy); y = b0.y + b0.h - hh; }
      if ((keep || e.shiftKey) && h.length === 2 && b0.w > 0 && b0.h > 0) {
        // a picture keeps its shape: the larger pull decides
        const k = Math.max(w / b0.w, hh / b0.h);
        w = b0.w * k; hh = b0.h * k;
        if (h.includes("w")) x = b0.x + b0.w - w;
        if (h.includes("n")) y = b0.y + b0.h - hh;
      }
      o.x = round1(x); o.y = round1(y); o.w = round1(w);
      if (o.t !== "text") o.h = round1(hh);
      if (o.t === "shape" || o.t === "pen") renderObj(o); else place(el, o);
      if (o.t === "text") o.h = Math.max(el.offsetHeight, 20);
      updateConns(new Set([o.id]));
      drawOverlay();
    },
    up() { commit(tx); },
    cancel() { Object.assign(o, b0); invalidate([o.id]); },
  };
}

/* --- draw a new connector out of a thing, or from empty board */
function connGesture(ev, from) {
  const sx = ev.clientX, sy = ev.clientY;
  let target = null, moved = false;
  const fromObj = from.o ? get(from.o) : null;
  const setTarget = (o) => {
    if (target === o) return;
    if (target) { const el = A.els.get(target.id); if (el) el.classList.remove("drop"); }
    target = o;
    if (o) { const el = A.els.get(o.id); if (el) el.classList.add("drop"); }
  };
  return {
    move(e) {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      moved = true;
      setTarget(attachAt(e.clientX, e.clientY, from.o));
      const r = stageRect();
      const a = fromObj ? center(fromObj) : from, s1 = toScreen(a.x, a.y);
      const s2 = target ? toScreen(center(target).x, center(target).y) : { x: e.clientX - r.left, y: e.clientY - r.top };
      A.overlayExtra = `<svg class="live-line"><path d="M${s1.x} ${s1.y}L${s2.x} ${s2.y}" stroke="#3b82f6" stroke-width="2" `
        + `stroke-dasharray="6 5" fill="none"/></svg>`;
      queueOverlay();
    },
    up(e) {
      const t = target;
      setTarget(null);
      if (!moved) return;
      const p = toWorld(e.clientX, e.clientY);
      const o = { id: uid("c"), t: "conn", a: from.o ? { o: from.o } : { x: from.x, y: from.y },
                  b: t ? { o: t.id } : { x: round1(p.x), y: round1(p.y) }, kind: A.opts.connKind, arrow: "end", z: topZ() };
      const tx = begin();
      put(tx, o);
      commit(tx);
      setTool("select");
      select([o.id]);
    },
    cancel() { setTarget(null); },
  };
}

/* --- drag one end of an existing connector */
function endGesture(ev, end) {
  const o = selObjs()[0];
  if (!o || o.t !== "conn") return null;
  const tx = begin();
  rec(tx, o.id);
  const before = clone(o[end] || {});
  const other = o[end === "a" ? "b" : "a"] || {};
  let target = null;
  const setTarget = (t) => {
    if (target === t) return;
    if (target) { const el = A.els.get(target.id); if (el) el.classList.remove("drop"); }
    target = t;
    if (t) { const el = A.els.get(t.id); if (el) el.classList.add("drop"); }
  };
  return {
    ids: new Set([o.id]),
    move(e) {
      const p = toWorld(e.clientX, e.clientY);
      setTarget(attachAt(e.clientX, e.clientY, other.o));
      o[end] = target ? { o: target.id } : { x: round1(p.x), y: round1(p.y) };
      renderConn(o);
      drawOverlay();
    },
    up() { setTarget(null); commit(tx); },
    cancel() { setTarget(null); o[end] = before; invalidate([o.id]); },
  };
}

/* --- place a new sticky / text / shape / frame / mind map: click, or drag to size it */
function createGesture(ev, p0) {
  const tool = A.tool, sx = ev.clientX, sy = ev.clientY;
  let box = null;
  return {
    move(e) {
      if (tool === "node" || tool === "text") return;
      if (!box && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      const p = toWorld(e.clientX, e.clientY);
      box = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
      const a = toScreen(box.x, box.y);
      A.overlayExtra = `<div class="marquee" style="left:${a.x}px;top:${a.y}px;width:${box.w * A.view.s}px;height:${box.h * A.view.s}px"></div>`;
      queueOverlay();
    },
    up() { createObject(tool, box && box.w > 12 && box.h > 12 ? box : null, p0); },
  };
}

function createObject(tool, box, p) {
  if (!A.canEdit) return null;
  const o = { id: uid(tool === "node" ? "n" : "o"), t: tool, z: topZ() };
  const centred = (w, h) => (box ? { x: box.x, y: box.y, w: box.w, h: box.h } : { x: p.x - w / 2, y: p.y - h / 2, w, h });
  if (tool === "sticky") Object.assign(o, centred(150, 150), { text: "", fill: A.opts.stickyFill });
  else if (tool === "text") Object.assign(o, { x: p.x, y: p.y - 13, w: 240, h: 26, text: "" });
  else if (tool === "shape") Object.assign(o, centred(150, 100), { text: "", kind: A.opts.shapeKind });
  else if (tool === "frame") Object.assign(o, centred(640, 420), { text: "Frame" });
  else if (tool === "node") Object.assign(o, { x: p.x - 60, y: p.y - 20, parent: null, text: "Central topic" });
  else return null;
  for (const k of ["x", "y", "w", "h"]) if (o[k] !== undefined) o[k] = round1(o[k]);
  const tx = begin();
  put(tx, o);
  commit(tx);
  setTool("select");
  select([o.id]);
  flushFrame();
  startEdit(o.id, { isNew: true, all: true });
  return o;
}

/* --- freehand */
function penGesture(ev, p0) {
  const pts = [[p0.x, p0.y]];
  const r = stageRect();
  const scr = [[ev.clientX - r.left, ev.clientY - r.top]];
  return {
    move(e) {
      // every sample the pen or mouse produced since the last frame, not just the latest
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of list.length ? list : [e]) {
        const p = toWorld(c.clientX, c.clientY);
        pts.push([p.x, p.y]);
        scr.push([c.clientX - r.left, c.clientY - r.top]);
      }
      A.overlayExtra = `<svg class="live-line"><path d="M${scr.map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}" `
        + `stroke="${col(A.opts.penColor, "#1f2430")}" stroke-width="${A.opts.penW * A.view.s}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      queueOverlay();
    },
    up() {
      const simple = simplify(pts, 0.7 / A.view.s);
      const xs = simple.map((q) => q[0]), ys = simple.map((q) => q[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(Math.max(...xs) - x, 1), h = Math.max(Math.max(...ys) - y, 1);
      const flat = [];
      for (const q of simple.slice(0, 4000)) flat.push(round1(q[0] - x), round1(q[1] - y));
      const o = { id: uid("p"), t: "pen", x: round1(x), y: round1(y), w: round1(w), h: round1(h), ow: round1(w), oh: round1(h),
                  pts: flat, color: A.opts.penColor, sw: A.opts.penW, z: topZ() };
      const tx = begin();
      put(tx, o);
      commit(tx);
    },
  };
}

/* The node under the mouse gets its "+" buttons. */
let hoverTimer = 0;
function hoverNode(ev) {
  const t = ev.target;
  if (!t || !t.closest) return;
  if (t.closest(".nplus")) { clearTimeout(hoverTimer); hoverTimer = 0; return; }
  const el = t.closest(".ob.node");
  const id = el ? el.getAttribute("data-id") : null;
  if (id) {
    clearTimeout(hoverTimer); hoverTimer = 0;
    if (A.hoverNode !== id) { A.hoverNode = id; queueOverlay(); }
  } else if (A.hoverNode && !hoverTimer) {
    // not at once: the mouse has to cross a gap to reach the "+"
    hoverTimer = setTimeout(() => { hoverTimer = 0; A.hoverNode = null; queueOverlay(); }, 350);
  }
}

/* --- wheel: a mouse wheel zooms at the pointer; two fingers on a trackpad move the board, pinching zooms */
let wheelMode = null, wheelAt = 0;
stage.addEventListener("wheel", (ev) => {
  if (!A.sync || ev.target.closest("#bd-home,#bd-pop,#bd-tools,#bd-ctx,#bd-toolopts")) return;
  ev.preventDefault();
  const r = stageRect(), now = performance.now();
  if (now - wheelAt > 200 || !wheelMode) {
    wheelMode = ev.ctrlKey || ev.metaKey ? "zoom"
      : ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY)) ? "zoom" : "pan";
  }
  if (ev.ctrlKey || ev.metaKey) wheelMode = "zoom";
  wheelAt = now;
  if (wheelMode === "zoom") {
    const unit = ev.deltaMode === 1 ? 33 : 1;
    const k = ev.ctrlKey && Math.abs(ev.deltaY) < 40 ? 0.01 : 0.0015;       // a pinch sends small steps
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * unit * k));
  } else {
    A.view.x -= ev.deltaX;
    A.view.y -= ev.deltaY;
    applyView();
  }
}, { passive: false });

/* ------------------------------------------------------------------ typing */

function startEdit(id, opt) {
  const o = get(id);
  if (!A.canEdit || !o || o.lock || !TEXTY.has(o.t)) return;
  commitEdit();
  if (o.t === "conn") {
    A.edit = { id, pending: true };
    renderConn(o);
  }
  const host = o.t === "conn" ? A.labels.get(id) : A.els.get(id);
  const el = host && host.querySelector(".tx");
  if (!el) { A.edit = null; return; }
  const tx = begin();
  rec(tx, id);
  A.edit = { id, el, tx, isNew: !!opt.isNew };
  el.contentEditable = "plaintext-only";
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";     // older Firefox
  if (opt.replace != null) el.textContent = opt.replace;
  if (o.t === "node") layoutMind();
  el.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(el);
  if (!opt.all || opt.replace != null) range.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(range);
  el.addEventListener("keydown", editKey);
  el.addEventListener("input", editInput);
  el.addEventListener("blur", editBlur);
  el.addEventListener("paste", editPaste);
  queueOverlay();
  buildCtx();
}

function editKey(ev) {
  ev.stopPropagation();
  if (ev.isComposing) return;                       // an input method is still putting a character together
  const o = get(A.edit.id);
  const oneLine = o && (o.t === "node" || o.t === "conn" || o.t === "frame");
  if (ev.key === "Escape" || (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey || (oneLine && !ev.shiftKey)))) {
    ev.preventDefault();
    commitEdit();
    stage.focus({ preventScroll: true });
  } else if (ev.key === "Tab") {
    ev.preventDefault();
    const id = A.edit.id;
    commitEdit();
    if (o && o.t === "node" && get(id)) addNode(id, "child");
    else stage.focus({ preventScroll: true });
  }
}
function editInput() {
  const e = A.edit;
  if (!e) return;
  const o = get(e.id);
  if (!o) return;
  if (o.t === "node") { layoutMind(); updateConns(new Set(), true); }
  else if (o.t === "sticky") growSticky(o);
}
/* A sticky grows downwards rather than hide what was typed. */
function growSticky(o) {
  const el = A.els.get(o.id), tx = el && el.querySelector(".tx");
  if (!tx) return;
  const need = tx.scrollHeight + 24;
  if (need > o.h + 1) {
    o.h = round1(need);
    place(el, o);
    updateConns(new Set([o.id]));
  }
}
function editBlur() {
  // Not at once: a tap on the toolbar blurs the text too, and must find the edit still open to style it.
  const e = A.edit;
  setTimeout(() => { if (A.edit === e && document.activeElement !== e.el) commitEdit(); }, 120);
}
function editPaste(ev) {
  // only the words, never the formatting (or the markup) that came with them
  ev.preventDefault();
  ev.stopPropagation();
  const text = (ev.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
}

function commitEdit() {
  const e = A.edit;
  if (!e || e.pending) return;
  A.edit = null;
  const el = e.el;
  el.removeEventListener("keydown", editKey);
  el.removeEventListener("input", editInput);
  el.removeEventListener("blur", editBlur);
  el.removeEventListener("paste", editPaste);
  let text = (el.innerText || "").replace(/ /g, " ").replace(/\r/g, "").replace(/\n+$/, "");
  if (text.length > 8000) text = text.slice(0, 8000);
  el.removeAttribute("contenteditable");
  if (document.activeElement === el) el.blur();
  try { getSelection().removeAllRanges(); } catch (err) {}
  const o = get(e.id);
  if (!o) return;
  if (o.t === "text" && !text.trim()) {
    // a text box with nothing in it is nothing
    del(e.tx, o.id);
    A.sel.delete(o.id);
    commit(e.tx, { merge: e.isNew });
    selectionChanged();
    return;
  }
  o.text = text;
  el.textContent = text;
  if (o.t === "sticky") growSticky(o);
  if (o.t === "text") o.h = Math.max(A.els.get(o.id).offsetHeight, 20);
  commit(e.tx, { merge: e.isNew });
  invalidate([o.id]);
  buildCtx();
}

/* ---------------------------------------------------------------- commands */

function toggleFold(id) {
  const o = get(id);
  if (!o) return;
  if (!A.canEdit) {                     // a Viewer may fold for their own reading; nothing is saved
    if (o.collapsed) delete o.collapsed; else o.collapsed = true;
    invalidate([id]);
    return;
  }
  const tx = begin();
  rec(tx, id);
  if (o.collapsed) delete o.collapsed; else o.collapsed = true;
  commit(tx);
}

function addNode(id, kind, side) {
  if (!A.canEdit) return;
  commitEdit();
  const F = A.F = mind.forest(O());
  const n = get(id);
  if (!n || n.t !== "node") return;
  const pid = kind === "child" ? id : (F.parentOf.get(id) || id);
  const asSibling = pid !== id;
  const parent = get(pid);
  const nn = { id: uid("n"), t: "node", parent: pid, text: "", z: topZ() };
  const main = !F.parentOf.get(pid);                       // a child of the root: a main branch
  if (main) {
    // A new main branch goes to the emptier side, so the map grows balanced
    // by itself - unless the "+" under a branch asked for that very place.
    nn.side = side === "l" || side === "r" ? side : mind.lighterSide(F, pid);
    nn.bc = mind.nextBranchColor(F, pid);
  }
  if (asSibling && (!main || nn.side === (n.side === "l" ? "l" : "r"))) {
    const sibs = mind.childrenOf(F, pid).filter((k) => !main || (k.side === "l") === (n.side === "l"));
    const next = sibs[sibs.indexOf(n) + 1];
    nn.ord = next ? ((n.ord || 0) + (next.ord || 0)) / 2 : (n.ord || 0) + 1;
  } else {
    nn.ord = mind.nextOrd(F, pid);
  }
  const tx = begin();
  if (parent.collapsed) { rec(tx, pid); delete parent.collapsed; }
  put(tx, nn);
  commit(tx);
  select([nn.id]);
  flushFrame();
  startEdit(nn.id, { isNew: true });
  reveal(nn);
}

/* Bring something into view if it is off the edge (a new node on a big map). */
function reveal(o) {
  const b = objBox(o);
  if (!b) return;
  const r = stageRect(), a = toScreen(b.x, b.y), m = 70;
  const w = b.w * A.view.s, h = b.h * A.view.s;
  let dx = 0, dy = 0;
  if (a.x < m) dx = m - a.x; else if (a.x + w > r.width - m) dx = r.width - m - a.x - w;
  if (a.y < m) dy = m - a.y; else if (a.y + h > r.height - m) dy = r.height - m - a.y - h;
  if (dx || dy) { A.view.x += dx; A.view.y += dy; applyView(); }
}

/* Make `n` a child of `target` (dropping a node, or a whole map, onto it). */
function attachNode(tx, n, target, p) {
  const F = A.F;
  rec(tx, n.id);
  n.parent = target.id;
  n.ord = mind.nextOrd(F, target.id);
  if (isRootNode(target.id)) {
    n.side = p.x < center(target).x ? "l" : "r";
    if (!n.bc) n.bc = mind.nextBranchColor(F, target.id);
  } else {
    delete n.side;
    delete n.bc;
  }
  if (target.collapsed) { rec(tx, target.id); delete target.collapsed; }
  invalidate([n.id, target.id]);
}

function finishReparent(n, target, p) {
  const F = A.F, tx = begin();
  if (target) {
    attachNode(tx, n, target, p);
  } else {
    const rootId = F.rootOf.get(n.id);
    const tree = unionBox(mind.subtree(F, rootId).map((id) => objBox(get(id))).filter(Boolean));
    const near = tree && p.x > tree.x - 90 && p.x < tree.x + tree.w + 90 && p.y > tree.y - 90 && p.y < tree.y + tree.h + 90;
    rec(tx, n.id);
    if (near) {
      // dropped among its own: a new place among its siblings (and, for a main branch, maybe the other side)
      const pid = F.parentOf.get(n.id), parent = get(pid);
      const main = isRootNode(pid);
      if (main) n.side = p.x < center(parent).x ? "l" : "r";
      const sibs = mind.childrenOf(F, pid).filter((k) => k !== n && (!main || (k.side === "l") === (n.side === "l")));
      const i = sibs.findIndex((k) => center(k).y > p.y);
      const prev = i < 0 ? sibs[sibs.length - 1] : sibs[i - 1], next = i < 0 ? null : sibs[i];
      n.ord = prev && next ? ((prev.ord || 0) + (next.ord || 0)) / 2 : next ? (next.ord || 0) - 1 : prev ? (prev.ord || 0) + 1 : 1;
    } else {
      // pulled well clear of the map: it becomes a map of its own
      n.parent = null;
      n.x = round1(p.x - (n.w || 0) / 2);
      n.y = round1(p.y - (n.h || 0) / 2);
      delete n.side; delete n.bc; delete n.ord;
    }
  }
  needLayout = true;
  if (!commit(tx)) queueOverlay();
}

async function deleteSelection() {
  if (!A.canEdit) return;
  const ids = new Set();
  let nodes = 0;
  for (const o of selObjs()) {
    if (o.lock) continue;
    if (o.t === "node") {
      for (const k of mind.subtree(A.F, o.id)) { if (!ids.has(k)) nodes++; ids.add(k); }
    } else ids.add(o.id);
  }
  if (!ids.size) return;
  if (nodes > 1 && !(await ask("Delete this branch?\n" + nodes + " nodes will be removed.", "Delete"))) return;
  removeObjects(ids);
}

function removeObjects(ids) {
  const tx = begin();
  for (const o of Array.from(O().values())) {
    if (ids.has(o.id)) continue;
    if ((o.t === "comment" || o.t === "react") && ids.has(o.on)) { del(tx, o.id); continue; }
    if (o.t !== "conn") continue;
    const gone = ["a", "b"].filter((end) => o[end] && o[end].o && ids.has(o[end].o));
    if (gone.length === 2) { del(tx, o.id); continue; }
    // a line that loses one of the things it joined keeps its end where it was
    for (const end of gone) {
      rec(tx, o.id);
      const pt = o._r ? (end === "a" ? o._r.p1 : o._r.p2) : center(get(o[end].o));
      o[end] = { x: round1(pt.x), y: round1(pt.y) };
      invalidate([o.id]);
    }
  }
  for (const id of ids) del(tx, id);
  commit(tx);
  select(Array.from(A.sel).filter((id) => O().has(id)));
}

/* The selection as plain objects, ready to be copied: whole branches for
   mind-map nodes, connector ends remembered as points in case what they
   hold on to does not come along. */
function gather() {
  const ids = new Set();
  for (const o of selObjs()) {
    if (o.t === "node") for (const k of mind.subtree(A.F, o.id)) ids.add(k);
    else if (!META.has(o.t)) ids.add(o.id);
  }
  return Array.from(ids).map(get).filter(Boolean).map((o) => {
    const c = clone(strip(o));
    if (c.t === "conn" && o._r) {
      if (c.a && c.a.o) Object.assign(c.a, { x: round1(o._r.p1.x), y: round1(o._r.p1.y) });
      if (c.b && c.b.o) Object.assign(c.b, { x: round1(o._r.p2.x), y: round1(o._r.p2.y) });
    }
    delete c.lock;
    return c;
  });
}

/* Put copies on the board. `at` (a board point) is where their middle
   goes; without it they land a little down and right of the originals. */
function pasteObjects(list, at, offset) {
  if (!A.canEdit || !list || !list.length) return;
  const copies = remap(list.filter((o) => o && !META.has(o.t)));
  if (!copies.length) return;
  const placed = copies.filter((c) => c.t !== "conn" && !(c.t === "node" && c.parent));
  const bb = unionBox(placed.map((c) => ({ x: c.x || 0, y: c.y || 0, w: c.w || 0, h: c.h || 0 })));
  let dx = offset || 0, dy = offset || 0;
  if (at && bb) { dx = at.x - (bb.x + bb.w / 2); dy = at.y - (bb.y + bb.h / 2); }
  copies.sort((a, b) => (a.z || 0) - (b.z || 0));
  const tx = begin();
  for (const c of copies) {
    c.z = topZ();
    if (c.t === "conn") {
      for (const end of ["a", "b"]) if (c[end] && !c[end].o) { c[end].x = round1((c[end].x || 0) + dx); c[end].y = round1((c[end].y || 0) + dy); }
    } else if (c.x !== undefined) { c.x = round1(c.x + dx); c.y = round1(c.y + dy); }
    put(tx, c);
  }
  commit(tx);
  select(copies.filter((c) => !(c.t === "node" && c.parent)).map((c) => c.id));
  flushFrame();
  if (X.contentChanged) X.contentChanged(new Set());
}

function duplicate() {
  const list = gather();
  if (list.length) pasteObjects(list, null, 24);
}

/* Copy and paste go through the browser's clipboard, so they work between
   boards and between tabs; a copy is also kept in this browser's storage
   for the browsers that will not carry our own format. */
const CLIP_MIME = "application/x-lwk-board";
const CLIP_KEY = "lwk-board:clipboard";
function clipText(list) {
  return list.map((o) => (o.t === "node" || o.t === "conn" ? "" : o.text || "")).filter(Boolean).join("\n")
    || list.filter((o) => o.t === "node").map((o) => o.text || "").join("\n") || "(board objects)";
}
function onCopy(ev, cut) {
  if (isTyping(ev.target) || !A.sync || !A.sel.size) return;
  const list = gather();
  if (!list.length) return;
  const json = JSON.stringify({ lwkBoard: 1, objs: list }), text = clipText(list);
  try {
    ev.clipboardData.setData(CLIP_MIME, json);
    ev.clipboardData.setData("text/plain", text);
    ev.preventDefault();
  } catch (e) {}
  try { localStorage.setItem(CLIP_KEY, JSON.stringify({ text, objs: list })); } catch (e) {}
  pasteCount = 0;
  if (cut) deleteSelection();
}
let pasteCount = 0, lastMiddle = -1e9;
async function onPaste(ev) {
  if (isTyping(ev.target) || !A.sync || !A.canEdit) return;
  // On Linux the middle button pastes whatever text was last selected. Here
  // the middle button moves the board, and must not leave a note behind.
  if (performance.now() - lastMiddle < 600) { ev.preventDefault(); return; }
  const cd = ev.clipboardData;
  if (!cd) return;
  const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
  if (files.length) {
    ev.preventDefault();
    for (const f of files) await X.addImage(f);
    return;
  }
  ev.preventDefault();
  let list = null;
  try { const own = cd.getData(CLIP_MIME); if (own) list = JSON.parse(own).objs; } catch (e) {}
  const text = cd.getData("text/plain") || "";
  if (!list) {
    let stash = null;
    try { stash = JSON.parse(localStorage.getItem(CLIP_KEY) || "null"); } catch (e) {}
    if (stash && (stash.text === text || !text.trim())) list = stash.objs;
  }
  if (list) {
    pasteCount++;
    // under the mouse if it is over the board, otherwise stepping away from the original
    const r = stageRect();
    const c = A.cursor || toWorld(r.left + r.width / 2, r.top + r.height / 2);
    pasteObjects(list, pasteCount > 1 && !A.cursor ? { x: c.x + pasteCount * 24, y: c.y + pasteCount * 24 } : c);
  } else if (text.trim()) {
    // words from somewhere else become a sticky note
    const r = stageRect();
    const c = A.cursor || toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const o = { id: uid(), t: "sticky", x: round1(c.x - 90), y: round1(c.y - 75), w: 180, h: 150, text: text.trim().slice(0, 4000),
                fill: A.opts.stickyFill, z: topZ() };
    const tx = begin();
    put(tx, o);
    commit(tx);
    select([o.id]);
    flushFrame();
    growSticky(o);
    A.sync.touch([o.id]);
  }
}
document.addEventListener("copy", (ev) => onCopy(ev, false));
document.addEventListener("cut", (ev) => { if (A.canEdit) onCopy(ev, true); });
document.addEventListener("paste", onPaste);

/* Set one property on everything selected that it applies to. */
function setProp(key, value, types) {
  const tx = begin();
  for (const o of selObjs()) {
    if (o.lock || (types && !types.includes(o.t))) continue;
    rec(tx, o.id);
    if (value === null || value === undefined) delete o[key]; else o[key] = value;
    invalidate([o.id]);
  }
  commit(tx);
  buildCtx();
}

function order(front) {
  const tx = begin();
  const list = selObjs().sort((a, b) => (a.z || 0) - (b.z || 0));
  if (!front) list.reverse();
  for (const o of list) {
    if (o.t === "conn") continue;
    rec(tx, o.id);
    o.z = front ? topZ() : --A.zBottom;
  }
  commit(tx);
}

function toggleLock() {
  const sel = selObjs();
  const lock = !sel.every((o) => o.lock);
  const tx = begin();
  for (const o of sel) { rec(tx, o.id); if (lock) o.lock = true; else delete o.lock; invalidate([o.id]); }
  commit(tx);
  selectionChanged();
}

function alignSel(how) {
  const list = selObjs().filter((o) => !o.lock && o.t !== "conn" && !(o.t === "node" && !isRootNode(o.id)) && objBox(o));
  if (list.length < 2) return;
  const bb = unionBox(list.map(objBox));
  const tx = begin();
  const set = (o, x, y) => { rec(tx, o.id); if (x != null) o.x = round1(x); if (y != null) o.y = round1(y); invalidate([o.id]); };
  if (how === "dh" || how === "dv") {
    // equal gaps between the first and the last
    const ax = how === "dh" ? "x" : "y", sz = how === "dh" ? "w" : "h";
    const sorted = list.slice().sort((a, b) => a[ax] - b[ax]);
    const total = sorted.reduce((n, o) => n + o[sz], 0);
    const gap = (bb[sz] - total) / (sorted.length - 1);
    let at = bb[ax];
    for (const o of sorted) { if (how === "dh") set(o, at, null); else set(o, null, at); at += o[sz] + gap; }
  } else {
    for (const o of list) {
      if (how === "l") set(o, bb.x, null);
      if (how === "c") set(o, bb.x + bb.w / 2 - o.w / 2, null);
      if (how === "r") set(o, bb.x + bb.w - o.w, null);
      if (how === "t") set(o, null, bb.y);
      if (how === "m") set(o, null, bb.y + bb.h / 2 - o.h / 2);
      if (how === "b") set(o, null, bb.y + bb.h - o.h);
    }
  }
  if (list.some((o) => o.t === "node")) needLayout = true;
  commit(tx);
}

function nudge(dx, dy) {
  const movers = collectMovers();
  if (!movers.size) return;
  const tx = begin();
  for (const id of movers.keys()) rec(tx, id);
  moveBy(movers, dx, dy);
  commit(tx);
}

/* Arrow keys walk a mind map: towards the root, away from it, up and down. */
function walkNode(key) {
  const n = selObjs()[0], F = A.F;
  const kids = mind.childrenOf(F, n.id).filter((k) => !k._hidden);
  const pid = F.parentOf.get(n.id);
  let go = null;
  const horiz = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  if (horiz) {
    if (!pid) go = kids.find((k) => (k.side === "l" ? -1 : 1) === horiz);
    else if (horiz === n._dir) go = kids[0];
    else go = get(pid);
  } else {
    const sibs = pid ? mind.childrenOf(F, pid).filter((k) => !isRootNode(pid) || (k.side === "l") === (n.side === "l")) : F.roots;
    const i = sibs.indexOf(n) + (key === "ArrowDown" ? 1 : -1);
    go = sibs[i];
  }
  if (go) { select([go.id]); reveal(go); }
}

/* Several stickies (or texts, or shapes) become one mind map: a topic in
   the middle and one branch for each. */
function toMindMap() {
  const src = selObjs().filter((o) => ["sticky", "text", "shape"].includes(o.t) && !o.lock)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (src.length < 2) return;
  const bb = unionBox(src.map(objBox));
  const tx = begin();
  const root = { id: uid("n"), t: "node", parent: null, text: "Topic", x: round1(bb.x + bb.w / 2 - 40), y: round1(bb.y + bb.h / 2 - 20), z: topZ() };
  put(tx, root);
  src.forEach((o, i) => {
    put(tx, { id: uid("n"), t: "node", parent: root.id, text: (o.text || "").trim() || "(empty)", ord: i + 1,
              side: i < Math.ceil(src.length / 2) ? "r" : "l", bc: BRANCH_COLORS[i % BRANCH_COLORS.length], z: topZ() });
  });
  commit(tx);
  removeObjects(new Set(src.map((o) => o.id)));
  // one step to take back, not two
  const b = A.undo.pop(), a = A.undo[A.undo.length - 1];
  if (a && b) { for (const [id, s] of b.before) if (!a.before.has(id)) a.before.set(id, s); for (const [id, s] of b.after) a.after.set(id, s); }
  select([root.id]);
  flushFrame();
  startEdit(root.id, { all: true });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (err) {}
    ta.remove();
  }
}

function openLink(o) {
  const el = A.els.get(o.id);
  if (el && el._href) window.open(el._href, "_blank", "noopener");
}

/* ---------------------------------------------------------------- keyboard */

window.addEventListener("keydown", (ev) => {
  lastTap = null;
  if (!A.sync) return;
  if (ev.key === " " && !isTyping(ev.target)) {
    if (!A.space) { A.space = true; stage.classList.add("space"); }
    ev.preventDefault();
    return;
  }
  if (isTyping(ev.target) || document.querySelector(".bd-back:not([hidden])")) return;
  if (A.presenting) { if (X.presentKey) X.presentKey(ev); return; }
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key, low = k.length === 1 ? k.toLowerCase() : k;
  const sel = selObjs(), one = sel.length === 1 ? sel[0] : null;
  const done = () => ev.preventDefault();

  if (mod) {
    if (low === "z") { done(); return ev.shiftKey ? redo() : undo(); }
    if (low === "y") { done(); return redo(); }
    if (low === "d") { done(); return duplicate(); }
    if (low === "a") { done(); return select(Array.from(O().values()).filter((o) => objBox(o) && !o.lock).map((o) => o.id)); }
    if (low === "f") { done(); return X.openSearch && X.openSearch(); }
    if (low === "b" && sel.length) { done(); return setProp("bold", !sel.every((o) => o.bold), ["sticky", "text", "shape", "node"]); }
    if (low === "l" && sel.length) { done(); return toggleLock(); }
    if (k === "0") { done(); const r = stageRect(); return zoomAt(r.width / 2, r.height / 2, 1 / A.view.s); }
    return;                                           // Ctrl+C / V / X arrive as copy / paste / cut events
  }
  if (k === "Escape") {
    if (G) { if (G.cancel) G.cancel(); G = null; A.overlayExtra = ""; queueOverlay(); }
    else if (!popEl.hidden) closePop();
    else if (A.tool !== "select") setTool("select");
    else select([]);
    if (X.escape) X.escape();
    return;
  }
  if (k === "?" || (k === "/" && ev.shiftKey)) { done(); return X.openHelp && X.openHelp(); }
  if (k === "+" || k === "=") { done(); return zoomCenter(1.25); }
  if (k === "-") { done(); return zoomCenter(0.8); }
  if (k === "!" || (k === "1" && ev.shiftKey)) { done(); return fitAll(); }
  if (!A.canEdit) return;

  if (k === "Delete" || k === "Backspace") { done(); return deleteSelection(); }
  if (one && one.t === "node" && !one.lock) {
    if (k === "Tab") { done(); return addNode(one.id, "child"); }
    if (k === "Enter") { done(); return addNode(one.id, "sibling"); }
    if (k === "F2") { done(); return startEdit(one.id, { all: true }); }
    if (k.startsWith("Arrow")) { done(); return walkNode(k); }
  }
  if (k === "Enter" && one && TEXTY.has(one.t)) { done(); return startEdit(one.id, { all: true }); }
  if (k.startsWith("Arrow") && sel.length) {
    done();
    const d = ev.shiftKey ? 10 : 1;
    return nudge(k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0);
  }
  if (k === "[") return order(false);
  if (k === "]") return order(true);
  // An input method (Chinese, Japanese ...) is about to compose a character:
  // open the text now, so that what is composed lands in it.
  if (k === "Process" && one && TEXTY.has(one.t) && one.t !== "frame" && one.t !== "conn" && !one.lock) {
    return startEdit(one.id, { all: true });
  }
  // just start typing on a selected note or node
  if (one && k.length === 1 && !ev.altKey && TEXTY.has(one.t) && one.t !== "frame" && one.t !== "conn" && !one.lock) {
    done();
    return startEdit(one.id, { replace: k });
  }
  const tool = { v: "select", h: "hand", n: "sticky", t: "text", r: "shape", l: "conn", m: "node", p: "pen", f: "frame" }[low];
  if (tool) { done(); setTool(tool); }
});
window.addEventListener("keyup", (ev) => {
  if (ev.key === " ") { A.space = false; stage.classList.remove("space"); }
});
window.addEventListener("blur", () => { A.space = false; stage.classList.remove("space"); });

/* ---------------------------------------------------------------- toolbars */

const TOOLS = [
  ["select", "select", "Select and move (V)"],
  ["hand", "hand", "Move the board (H, or hold Space and drag)"],
  null,
  ["sticky", "sticky", "Sticky note (N)", 1],
  ["text", "text", "Text (T)", 1],
  ["shape", "shape", "Shape (R)", 1],
  ["conn", "conn", "Connector: drag from one thing to another (L)", 1],
  ["node", "mind", "Mind map: click to start one (M)", 1],
  ["pen", "pen", "Pen (P)", 1],
  ["frame", "frame", "Frame: a titled area (F)", 1],
  ["image", "image", "Picture - or paste one, or drop a file on the board", 1],
  ["link", "link", "Card linked to an issue or a sheet of this project", 1],
  null,
  ["undo", "undo", "Undo (Ctrl+Z)", 1],
  ["redo", "redo", "Redo (Ctrl+Y)", 1],
];

function buildTools() {
  $("#bd-tools").innerHTML = TOOLS.map((t) => (t
    ? `<button type="button" data-tool="${t[0]}" class="${t[3] ? "edit" : ""}" title="${esc(t[2])}" aria-label="${esc(t[2])}">${icon(t[1], 20)}</button>`
    : `<hr class="edit">`)).join("");
  $("#bd-tools").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-tool]");
    if (!b) return;
    const t = b.dataset.tool;
    if (t === "undo") return undo();
    if (t === "redo") return redo();
    if (t === "image") { commitEdit(); return $("#bd-file").click(); }
    if (t === "link") { commitEdit(); return X.openLinkPicker && X.openLinkPicker(); }
    setTool(t);
  });
  for (const el of document.querySelectorAll(".i[data-icon]")) el.innerHTML = icon(el.dataset.icon, 18);
}

function setTool(t) {
  commitEdit();
  A.tool = t;
  stage.className = stage.className.replace(/\bt-\w+/g, "").trim() + " t-" + t;
  if (t !== "select") select([]);
  toolState();
  // what the tool will make: colour, shape, pen
  const box = $("#bd-toolopts");
  const sw = (list, cur, key) => `<div class="sw-row">` + list.map((c) =>
    `<button type="button" class="sw${c === cur ? " on" : ""}${c === "none" ? " none" : ""}" data-opt="${key}" data-v="${c}" `
    + `style="background:${col(c, "#fff")}" aria-label="colour ${c}"></button>`).join("") + `</div>`;
  let html = "";
  if (t === "sticky") html = sw(STICKY_COLORS, A.opts.stickyFill, "stickyFill");
  else if (t === "shape") {
    html = `<div class="opt-row">` + ["rect", "round", "ellipse", "diamond"].map((k) =>
      `<button type="button" class="${A.opts.shapeKind === k ? "active" : ""}" data-opt="shapeKind" data-v="${k}" title="${k}">${icon(k)}</button>`).join("") + `</div>`;
  } else if (t === "pen") {
    html = sw(INK_COLORS.slice(0, 8), A.opts.penColor, "penColor") + `<div class="opt-row">` + [2, 3, 6, 10].map((w) =>
      `<button type="button" class="${A.opts.penW === w ? "active" : ""}" data-opt="penW" data-v="${w}" title="${w} px">`
      + `<svg width="22" height="18"><path d="M3 9h16" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/></svg></button>`).join("") + `</div>`;
  } else if (t === "conn") {
    html = `<div class="opt-row">` + [["curve", "Curved"], ["elbow", "Right angles"], ["straight", "Straight"]].map(([k, tip]) =>
      `<button type="button" class="${A.opts.connKind === k ? "active" : ""}" data-opt="connKind" data-v="${k}" title="${tip}">${icon(k)}</button>`).join("") + `</div>`;
  }
  box.innerHTML = html;
  box.hidden = !html || !A.canEdit;
}
$("#bd-toolopts").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-opt]");
  if (!b) return;
  A.opts[b.dataset.opt] = b.dataset.opt === "penW" ? Number(b.dataset.v) : b.dataset.v;
  setTool(A.tool);
});

function toolState() {
  for (const b of document.querySelectorAll("#bd-tools button[data-tool]")) {
    b.classList.toggle("active", b.dataset.tool === A.tool);
    if (b.dataset.tool === "undo") b.disabled = !A.undo.length;
    if (b.dataset.tool === "redo") b.disabled = !A.redo.length;
  }
}

/* The bar that follows the selection: only what applies to what is selected. */
function buildCtx() {
  const sel = selObjs();
  if (!sel.length || !A.sync || A.presenting) { ctxEl.hidden = true; ctxEl.innerHTML = ""; return; }
  const types = new Set(sel.map((o) => o.t));
  const has = (...t) => t.some((x) => types.has(x));
  const one = sel.length === 1 ? sel[0] : null;
  const locked = sel.every((o) => o.lock);
  const b = (act, inner, tip, on) => `<button type="button" data-act="${act}" title="${esc(tip)}" aria-label="${esc(tip)}"${on ? ' class="on"' : ""}>${inner}</button>`;
  const sep = `<span class="sep"></span>`;
  const first = sel[0];
  let h = "";
  if (A.canEdit && !locked) {
    if (has("sticky", "shape", "frame", "node")) {
      const f = sel.find((o) => ["sticky", "shape", "frame", "node"].includes(o.t));
      const c = f.fill || (f.t === "sticky" ? STICKY_COLORS[0] : f.t === "node" ? "" : "#ffffff");
      h += b("fill", `<span class="dot${c === "none" || !c ? " none" : ""}" style="background:${col(c, "#fff")}"></span>`, "Fill colour");
    }
    if (has("shape", "conn", "pen")) {
      const f = sel.find((o) => ["shape", "conn", "pen"].includes(o.t));
      h += b("stroke", `<span class="dot ring" style="--c:${col(f.t === "shape" ? f.stroke : f.color, "#1f2430")}"></span>`, "Line colour and thickness");
    }
    if (has("sticky", "text", "shape", "node", "frame")) {
      const f = sel.find((o) => ["sticky", "text", "shape", "node", "frame"].includes(o.t));
      const fs = Number(f.fs) || DEFAULT_FS[f.t];
      h += b("tcolor", `<span class="txa" style="--c:${col(f.color, "#1f2430")}">A</span>`, "Text colour");
      h += b("fs-", icon("minus", 14), "Smaller text") + `<span class="fsv">${fs}</span>` + b("fs+", icon("plus", 14), "Larger text");
      if (has("sticky", "text", "shape", "node")) {
        h += b("bold", icon("bold", 16), "Bold (Ctrl+B)", sel.every((o) => o.bold));
        if (has("sticky", "text", "shape")) {
          const al = f.align || (f.t === "text" ? "left" : "center");
          h += b("align", icon(al === "left" ? "alignl" : al === "right" ? "alignr" : "alignc", 16), "Text to the left, middle, right");
        }
      }
      h += sep;
    }
    if (types.size === 1 && has("shape")) h += b("kind", icon(first.kind || "rect", 16), "Shape") + sep;
    if (types.size === 1 && has("conn")) {
      h += b("ckind", icon(first.kind || "straight", 16), "Straight, right-angled or curved");
      h += b("arrow", icon((first.arrow || "end") === "end" ? "arrowend" : first.arrow === "both" ? "arrowboth" : "arrownone", 16), "Arrow heads");
      h += b("dash", icon("dash", 16), "Dashed", sel.every((o) => o.dash));
      if (one) h += b("label", icon("text", 16), "Label (or double-click the line)");
      h += sep;
    }
    if (one && one.t === "node") {
      h += b("child", icon("plus", 16), "Add a child (Tab)");
      if (mind.childrenOf(A.F, one.id).length && !isRootNode(one.id)) h += b("fold", one.collapsed ? "▸" : "▾", one.collapsed ? "Unfold" : "Fold this branch");
      h += sep;
    }
    if (sel.length > 1) h += b("alignmenu", icon("align", 16), "Line up, space out") + sep;
  }
  if (one && !["conn", "pen"].includes(one.t)) {
    const m = A.meta.get(one.id);
    const n = m ? m.comments : 0;
    if (A.canEdit || n) h += b("comment", icon("comment", 16) + (n ? `<span class="cnt">${n}</span>` : ""), "Comments");
    if (A.canEdit) h += b("react", icon("smile", 16), "React / vote");
    h += sep;
  }
  if (A.canEdit) {
    if (!locked) h += b("front", icon("front", 16), "Bring to front ( ] )") + b("back", icon("back", 16), "Send to back ( [ )");
    h += b("lock", icon(locked ? "lock" : "unlock", 16), locked ? "Unlock" : "Lock: cannot be moved or changed", locked);
    if (!locked) h += b("dup", icon("copy", 16), "Duplicate (Ctrl+D)") + b("del", icon("trash", 16), "Delete (Del)");
  }
  h += b("more", icon("more", 16), "More");
  ctxEl.innerHTML = h;
  ctxEl.hidden = false;
  queueOverlay();
}

/* The bar is docked at the top of the canvas (above the tools on a phone)
   rather than floating over the selection: on a mind map the thing right
   above the selected node is another node, and a floating bar would sit
   exactly on it. */
function placeCtx(s) {
  if (ctxEl.hidden) return;
  if (!s) { ctxEl.hidden = true; return; }
  ctxEl.style.visibility = G && G.move ? "hidden" : "";
}

function pop(anchor, html, onClick) {
  popEl.innerHTML = html;
  popEl.hidden = false;
  popEl.onclick = onClick;
  const r = stageRect(), a = anchor.getBoundingClientRect();
  const w = popEl.offsetWidth, h = popEl.offsetHeight;
  let x = a.left - r.left + a.width / 2 - w / 2, y = a.bottom - r.top + 8;
  if (y + h > r.height - 6) y = a.top - r.top - h - 8;
  popEl.style.left = clamp(x, 6, Math.max(6, r.width - w - 6)) + "px";
  popEl.style.top = Math.max(6, y) + "px";
}
function closePop() {
  if (!popEl.hidden) { popEl.hidden = true; popEl.innerHTML = ""; }
}
const swatches = (list, cur) => `<div class="sw-grid">` + list.map((c) =>
  `<button type="button" class="sw${c === cur ? " on" : ""}${c === "none" ? " none" : ""}" data-v="${c}" style="background:${col(c, "#fff")}" aria-label="${c}"></button>`).join("") + `</div>`;

// mousedown would take the focus (and so end the typing) before the click arrives
ctxEl.addEventListener("pointerdown", (ev) => { if (A.edit) ev.preventDefault(); });
popEl.addEventListener("pointerdown", (ev) => { if (A.edit && !isTyping(ev.target)) ev.preventDefault(); });

ctxEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const act = btn.dataset.act, sel = selObjs(), one = sel.length === 1 ? sel[0] : null, first = sel[0];
  if (!first) return;
  const TXT = ["sticky", "text", "shape", "node", "frame"];
  switch (act) {
    case "fill": {
      const shapes = sel.some((o) => o.t === "shape" || o.t === "frame");
      pop(btn, swatches(shapes ? SHAPE_FILLS : STICKY_COLORS, first.fill), (e) => {
        const s = e.target.closest(".sw");
        if (!s) return;
        if (first.t === "sticky") A.opts.stickyFill = s.dataset.v;
        setProp("fill", s.dataset.v, ["sticky", "shape", "frame", "node"]);
        closePop();
      });
      break;
    }
    case "stroke":
      pop(btn, swatches(INK_COLORS, first.t === "shape" ? first.stroke : first.color)
        + `<h4 style="margin-top:8px">Thickness</h4><div class="icon-row">` + [1, 2, 4, 6, 10].map((w) =>
          `<button type="button" data-w="${w}" class="${(first.sw || (first.t === "pen" ? 3 : 2)) === w ? "on" : ""}"><svg width="22" height="18"><path d="M3 9h16" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/></svg></button>`).join("") + `</div>`,
      (e) => {
        const s = e.target.closest(".sw"), w = e.target.closest("[data-w]");
        if (s) {
          const tx = begin();
          for (const o of selObjs()) {
            if (o.lock || !["shape", "conn", "pen"].includes(o.t)) continue;
            rec(tx, o.id);
            o[o.t === "shape" ? "stroke" : "color"] = s.dataset.v;
          }
          commit(tx);
          buildCtx();
          closePop();
        } else if (w) { setProp("sw", Number(w.dataset.w), ["shape", "conn", "pen"]); closePop(); }
      });
      break;
    case "tcolor":
      pop(btn, swatches(INK_COLORS, first.color), (e) => {
        const s = e.target.closest(".sw");
        if (s) { setProp("color", s.dataset.v, TXT); closePop(); }
      });
      break;
    case "fs-": case "fs+": {
      const tx = begin();
      for (const o of sel) {
        if (o.lock || !TXT.includes(o.t)) continue;
        const cur = o.fs || DEFAULT_FS[o.t];
        let i = FONT_STEPS.findIndex((s) => s >= cur);
        if (i < 0) i = FONT_STEPS.length - 1;
        i = clamp(i + (act === "fs+" ? 1 : -1), 0, FONT_STEPS.length - 1);
        rec(tx, o.id);
        o.fs = FONT_STEPS[i];
        invalidate([o.id]);
      }
      commit(tx);
      buildCtx();
      break;
    }
    case "bold": setProp("bold", !sel.every((o) => o.bold), ["sticky", "text", "shape", "node"]); break;
    case "align": {
      const cur = first.align || (first.t === "text" ? "left" : "center");
      setProp("align", cur === "left" ? "center" : cur === "center" ? "right" : "left", ["sticky", "text", "shape"]);
      break;
    }
    case "kind":
      pop(btn, `<div class="icon-row">` + ["rect", "round", "ellipse", "diamond"].map((k) =>
        `<button type="button" data-v="${k}" class="${(first.kind || "rect") === k ? "on" : ""}">${icon(k)}</button>`).join("") + `</div>`,
      (e) => { const s = e.target.closest("[data-v]"); if (s) { A.opts.shapeKind = s.dataset.v; setProp("kind", s.dataset.v, ["shape"]); closePop(); } });
      break;
    case "ckind":
      pop(btn, `<div class="icon-row">` + [["straight", "Straight"], ["elbow", "Right angles"], ["curve", "Curved"]].map(([k, tip]) =>
        `<button type="button" data-v="${k}" title="${tip}" class="${(first.kind || "straight") === k ? "on" : ""}">${icon(k)}</button>`).join("") + `</div>`,
      (e) => { const s = e.target.closest("[data-v]"); if (s) { A.opts.connKind = s.dataset.v; setProp("kind", s.dataset.v, ["conn"]); closePop(); } });
      break;
    case "arrow":
      pop(btn, `<div class="icon-row">` + [["none", "arrownone", "No arrow"], ["end", "arrowend", "Arrow at the end"], ["both", "arrowboth", "Arrows at both ends"]].map(([k, ic, tip]) =>
        `<button type="button" data-v="${k}" title="${tip}" class="${(first.arrow || "end") === k ? "on" : ""}">${icon(ic)}</button>`).join("") + `</div>`,
      (e) => { const s = e.target.closest("[data-v]"); if (s) { setProp("arrow", s.dataset.v, ["conn"]); closePop(); } });
      break;
    case "dash": setProp("dash", sel.every((o) => o.dash) ? null : true, ["conn"]); break;
    case "label": startEdit(one.id, { all: true }); break;
    case "child": addNode(one.id, "child"); break;
    case "fold": toggleFold(one.id); buildCtx(); break;
    case "alignmenu":
      pop(btn, `<h4>Line up</h4><div class="icon-row">`
        + [["l", "Left edges"], ["c", "Centres"], ["r", "Right edges"], ["t", "Tops"], ["m", "Middles"], ["b", "Bottoms"]].map(([k, tip]) =>
          `<button type="button" data-v="${k}" title="${tip}">${alignIcon(k)}</button>`).join("") + `</div>`
        + `<h4 style="margin-top:8px">Space out evenly</h4><div class="menu">`
        + `<button type="button" data-v="dh"${sel.length < 3 ? " disabled" : ""}>Across</button>`
        + `<button type="button" data-v="dv"${sel.length < 3 ? " disabled" : ""}>Down</button></div>`,
      (e) => { const s = e.target.closest("[data-v]"); if (s && !s.disabled) alignSel(s.dataset.v); });
      break;
    case "comment": if (X.openThread) X.openThread(one.id); break;
    case "react": if (X.reactMenu) X.reactMenu(btn, one.id); break;
    case "front": order(true); break;
    case "back": order(false); break;
    case "lock": toggleLock(); break;
    case "dup": duplicate(); break;
    case "del": deleteSelection(); break;
    case "more": moreMenu(btn); break;
  }
});

function alignIcon(k) {
  const bar = { l: "M4 3v18", c: "M12 3v18", r: "M20 3v18", t: "M3 4h18", m: "M3 12h18", b: "M3 20h18" }[k];
  const boxes = { l: "M7 6h10v4H7zM7 14h6v4H7z", c: "M6 6h12v4H6zM8 14h8v4H8z", r: "M7 6h10v4H7zM11 14h6v4h-6z",
                  t: "M6 7h4v10H6zM14 7h4v6h-4z", m: "M6 6h4v12H6zM14 8h4v8h-4z", b: "M6 7h4v10H6zM14 11h4v6h-4z" }[k];
  return `<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${bar}${boxes}"/></svg>`;
}

function moreMenu(btn) {
  const sel = selObjs(), one = sel.length === 1 ? sel[0] : null;
  const stickies = sel.filter((o) => ["sticky", "text", "shape"].includes(o.t)).length;
  let h = `<div class="menu">`;
  if (A.canEdit) {
    h += `<button type="button" data-m="copy">${icon("copy", 16)} Copy</button>`;
    if (stickies >= 2) h += `<button type="button" data-m="tomind">${icon("mind", 16)} Turn into a mind map</button>`;
  }
  if (one && one.t === "node") h += `<button type="button" data-m="outline">${icon("outline", 16)} Copy as a text outline</button>`;
  h += `<button type="button" data-m="png">${icon("download", 16)} Save the selection as a picture</button>`;
  if (one) {
    const now = A.sync.now();
    h += `<div class="note">${esc(TYPE_LABEL[one.t] || one.t)}`
      + (one.cby ? `<br>Created by ${esc(one.cby)}${one.cat ? ", " + esc(ago(one.cat, now)) : ""}` : "")
      + (one.uby ? `<br>Last edited by ${esc(one.uby)}${one.uat ? ", " + esc(ago(one.uat, now)) : ""}` : "") + `</div>`;
  }
  h += `</div>`;
  pop(btn, h, async (e) => {
    const m = e.target.closest("[data-m]");
    if (!m) return;
    closePop();
    if (m.dataset.m === "copy") {
      const list = gather(), text = clipText(list);
      try { localStorage.setItem(CLIP_KEY, JSON.stringify({ text, objs: list })); } catch (err) {}
      await copyText(text);
      pasteCount = 0;
      toast("Copied - paste with Ctrl+V, here or on another board");
    } else if (m.dataset.m === "tomind") toMindMap();
    else if (m.dataset.m === "outline") { await copyText(mind.outline(A.F, one.id)); toast("The outline is on the clipboard"); }
    else if (m.dataset.m === "png") X.exportPng(true);
  });
}

/* ---------------------------------------------------------------- presence */

function placeCursor(el) {
  el.style.transform = `translate(${el._x}px,${el._y}px) scale(${1 / A.view.s})`;
}
function showPeople(list) {
  A.people = list;
  const all = [{ name: A.name || "You", me: true }].concat(list.map((p) => ({ name: p.name, ro: p.ro })));
  const shown = all.slice(0, 6);
  $("#bd-people").innerHTML = shown.map((p) =>
    `<span class="av${p.me ? " me" : ""}" style="background:${personColor(p.name)}" title="${esc(p.name)}${p.me ? " (you)" : ""}${p.ro ? " - viewing" : ""}">${esc(initials(p.name))}</span>`).join("")
    + (all.length > shown.length ? `<span class="av more" title="${esc(all.slice(6).map((p) => p.name).join(", "))}">+${all.length - shown.length}</span>` : "");
  const seen = new Set();
  for (const p of list) {
    if (p.x == null || p.y == null) continue;
    seen.add(p.cid);
    let el = cursorsEl.querySelector(`[data-cid="${CSS.escape(p.cid)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "cur";
      el.setAttribute("data-cid", p.cid);
      const c = personColor(p.name);
      el.innerHTML = `<svg width="16" height="18" viewBox="0 0 16 18"><path d="M1 1l13 7-6 1.4L5 16z" fill="${c}" stroke="#fff" stroke-width="1.2"/></svg>`
        + `<span style="background:${c}">${esc(p.name)}</span>`;
      el._x = p.x; el._y = p.y;
      el.style.transition = "none";
      cursorsEl.appendChild(el);
      placeCursor(el);
      void el.offsetWidth;
      el.style.transition = "";
    }
    el._x = p.x; el._y = p.y;
    placeCursor(el);
  }
  for (const el of Array.from(cursorsEl.children)) if (!seen.has(el.getAttribute("data-cid"))) el.remove();
}

function showStatus(s) {
  const pill = $("#bd-save");
  clearTimeout(showStatus.timer);
  pill.hidden = false;
  if (s.error) {
    pill.className = "save-pill off";
    pill.textContent = "Not saved: " + s.error;
    pill.title = s.error;
  } else if (!s.online) {
    pill.className = "save-pill off";
    pill.textContent = s.pending ? `Offline - ${s.pending} change${s.pending === 1 ? "" : "s"} waiting` : "Offline";
    pill.title = "The server cannot be reached. Your changes are kept here and are sent as soon as it can.";
  } else if (s.pending || s.sending) {
    pill.className = "save-pill busy";
    pill.textContent = "Saving ...";
    pill.title = "";
  } else {
    pill.className = "save-pill";
    pill.textContent = "Saved";
    pill.title = "Everything is on the server";
    showStatus.timer = setTimeout(() => { pill.hidden = true; }, 2500);
  }
}

function showBoardMeta(b) {
  if (!A.board || b.id !== A.board.id) return;
  const title = $("#bd-title");
  A.board = Object.assign(A.board, b);
  if (document.activeElement !== title && title.value !== b.title) title.value = b.title;
  document.title = b.title + " - Board - LWK Viewer";
  $("#bd-edited").textContent = b.updated_by ? "Edited by " + b.updated_by + " " + ago(b.updated_at, A.sync ? A.sync.now() : 0) : "";
}

/* ------------------------------------------------------------------ boards */

const lastKey = () => "lwk-board:last:" + project();

async function loadBoards() {
  const data = await api("/api/boards");
  A.boards = data.boards || [];
  A.role = data.role;
  A.canEdit = !!data.can_edit;
  A.accounts = !!data.accounts;
  if (data.name) A.name = data.name;
  document.body.classList.toggle("readonly", !A.canEdit);
  $("#bd-readonly").hidden = A.canEdit;
  renderBoardList();
  return A.boards;
}

function boardLine(b, now) {
  return [b.count + (b.count === 1 ? " object" : " objects"),
    b.updated_by ? "edited by " + b.updated_by + " " + ago(b.updated_at, now) : ""].filter(Boolean).join("  ·  ");
}

function renderBoardList() {
  const now = A.sync ? A.sync.now() : Date.now();
  $("#bl-items").innerHTML = A.boards.length ? A.boards.map((b) =>
    `<li data-bid="${esc(b.id)}" class="${A.board && A.board.id === b.id ? "on" : ""}">`
    + `<div class="bl-main"><div class="bl-t">${esc(b.title)}</div><div class="bl-s">${esc(boardLine(b, now))}</div></div>`
    + (b.here && !(A.board && A.board.id === b.id) ? `<span class="bl-here" title="People on this board now">${b.here}</span>` : "")
    + (A.canEdit ? `<button type="button" data-do="rename" title="Rename">${icon("edit", 15)}</button>`
      + `<button type="button" data-do="dup" title="Duplicate">${icon("copy", 15)}</button>`
      + (b.can_delete ? `<button type="button" data-do="del" title="Delete">${icon("trash", 15)}</button>` : "") : "")
    + `</li>`).join("")
    : `<li class="bl-empty">No boards yet${A.canEdit ? " - start one with New board." : "."}</li>`;
  $("#home-items").innerHTML = A.boards.map((b) =>
    `<li data-bid="${esc(b.id)}"><div class="bl-t">${esc(b.title)}</div><div class="bl-s">${esc(boardLine(b, now))}</div></li>`).join("");
  $("#home-list-h").hidden = !A.boards.length;
  $("#bd-msg").textContent = !A.boards.length && !A.canEdit ? "There are no boards on this project yet." : "";
}

function tplCards(host, onPick) {
  host.innerHTML = TEMPLATES.map((t) =>
    `<button type="button" class="tpl" data-tpl="${t.id}">${templateThumb(t.id)}<b>${esc(t.name)}</b><small>${esc(t.hint)}</small></button>`).join("");
  host.onclick = (ev) => {
    const b = ev.target.closest("[data-tpl]");
    if (b) onPick(b.dataset.tpl, b);
  };
}

function openNewDialog(tpl) {
  if (!A.canEdit) return;
  const back = $("#bd-new-back");
  let chosen = tpl || "blank";
  const mark = () => { for (const b of $("#nb-tpls").children) b.classList.toggle("on", b.dataset.tpl === chosen); };
  tplCards($("#nb-tpls"), (id) => { chosen = id; mark(); });
  mark();
  $("#nb-title").value = "";
  back.hidden = false;
  $("#nb-title").focus();
  const close = () => { back.hidden = true; };
  const go = async () => {
    const t = TEMPLATES.find((x) => x.id === chosen);
    const title = $("#nb-title").value.trim() || (chosen === "blank" ? "Untitled board" : t.name);
    $("#nb-go").disabled = true;
    try {
      const res = await api("/api/boards", { method: "POST", body: JSON.stringify({ title, by: A.name, objects: makeTemplate(chosen) }) });
      close();
      await loadBoards();
      await openBoard(res.board.id, true);
    } catch (e) {
      toast("Could not create the board: " + e.message);
    }
    $("#nb-go").disabled = false;
  };
  $("#nb-go").onclick = go;
  $("#nb-cancel").onclick = close;
  $("#nb-title").onkeydown = (ev) => { if (ev.key === "Enter") go(); if (ev.key === "Escape") close(); };
}

async function boardAction(bid, what) {
  const b = A.boards.find((x) => x.id === bid);
  if (!b) return;
  try {
    if (what === "rename") {
      const title = prompt("Board name", b.title);
      if (!title || !title.trim() || title.trim() === b.title) return;
      const res = await api("/api/boards/" + bid, { method: "PATCH", body: JSON.stringify({ title: title.trim(), by: A.name }) });
      showBoardMeta(res.board);
    } else if (what === "dup") {
      if (A.sync && A.board && A.board.id === bid) { commitEdit(); await A.sync.flush(); }     // the copy is made from what the server holds
      const res = await api("/api/boards/" + bid + "/duplicate", { method: "POST", body: JSON.stringify({ by: A.name }) });
      await loadBoards();
      await openBoard(res.board.id, true);
      return;
    } else if (what === "del") {
      if (!(await ask(`Delete the board "${b.title}"?\nIt disappears for everyone on the project.`, "Delete board"))) return;
      await api("/api/boards/" + bid, { method: "DELETE" });
      if (A.board && A.board.id === bid) { closeBoard(); try { localStorage.removeItem(lastKey()); } catch (e) {} }
    }
    await loadBoards();
    if (!A.board) showHome();
  } catch (e) {
    toast(e.message);
  }
}

function showHome() {
  $("#bd-home").hidden = false;
  $("#bd-title").value = "";
  $("#bd-title").disabled = true;
  $("#bd-edited").textContent = "";
  $("#bd-people").innerHTML = "";
  $("#bd-save").hidden = true;
  document.title = "LWK Viewer - Board";
  history.replaceState(null, "", "board.html?project=" + encodeURIComponent(project()));
}

function closeBoard() {
  commitEdit();
  if (A.sync) { A.sync.flush(true); A.sync.stop(); }
  A.sync = null;
  A.board = null;
  A.sel = new Set();
  A.undo = []; A.redo = [];
  A.els.clear(); A.labels.clear(); A.meta = new Map();
  A.F = mind.forest(NONE);
  A.zTop = 0; A.zBottom = 0;
  dirty.clear();
  for (const el of Array.from(objsEl.children)) if (el !== branchSvg) el.remove();
  branchSvg.innerHTML = ""; connSvg.innerHTML = ""; labelsEl.innerHTML = ""; cursorsEl.innerHTML = ""; overlay.innerHTML = "";
  ctxEl.hidden = true;
  $("#bd-info").hidden = true;
  if (X.boardClosed) X.boardClosed();
}

async function openBoard(bid, push) {
  closeBoard();
  const sync = createSync({
    bid, name: A.name, canEdit: A.canEdit,
    isBusy: (id) => (A.edit && A.edit.id === id) || (G && G.ids && G.ids.has(id)),
    cursor: () => A.cursor,
    onRemote(ups, dels) {
      invalidate(ups.map((o) => o.id).concat(dels));
      if (dels.length) {
        const gone = new Set(dels);
        if (Array.from(A.sel).some((id) => gone.has(id))) select(Array.from(A.sel).filter((id) => !gone.has(id)));
      }
      // someone else changed what is selected: the bar should say so
      if (ups.some((o) => A.sel.has(o.id)) && !A.edit && !G) buildCtx();
    },
    onStatus: showStatus,
    onPresence: showPeople,
    onBoard: showBoardMeta,
    onRefused(e) { toast("The server refused that change: " + e.message, 6000); },
    onGone() {
      if (!A.sync || A.sync !== sync) return;
      closeBoard();
      toast("This board was deleted.");
      loadBoards().then(showHome).catch(() => showHome());
    },
  });
  let data;
  try {
    data = await sync.load();
  } catch (e) {
    toast(e.status === 404 ? "That board does not exist (any more)." : "Could not open the board: " + e.message);
    showHome();
    return false;
  }
  A.sync = sync;
  A.board = data.board;
  A.canEdit = !!data.can_edit;
  if (data.name) A.name = data.name;
  document.body.classList.toggle("readonly", !A.canEdit);
  $("#bd-readonly").hidden = A.canEdit;
  $("#bd-home").hidden = true;
  $("#bd-title").disabled = !A.canEdit;
  $("#bd-title").value = data.board.title;
  showBoardMeta(data.board);
  try { localStorage.setItem(lastKey(), bid); } catch (e) {}
  const url = "board.html?project=" + encodeURIComponent(project()) + "&board=" + encodeURIComponent(bid);
  if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);

  for (const o of O().values()) { if (o.z > A.zTop) A.zTop = o.z; if (o.z < A.zBottom) A.zBottom = o.z; }
  needMeta = true;
  invalidate(O().keys());
  flushFrame();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(viewKey()) || "null"); } catch (e) {}
  if (saved && isFinite(saved.x) && isFinite(saved.y) && saved.s > 0) { A.view = { x: saved.x, y: saved.y, s: clamp(saved.s, 0.05, 4) }; applyView(); }
  else fitAll();
  setTool("select");
  select([]);
  showPeople([]);
  renderBoardList();
  sync.start();
  sync.poll();
  if (X.boardOpened) X.boardOpened();
  return true;
}

/* -------------------------------------------------------------- page chrome */

function wireChrome() {
  $("#bd-menu").onclick = () => {
    const list = $("#bd-list");
    list.hidden = !list.hidden;
    $("#bd-menu").classList.toggle("on", !list.hidden);
    if (!list.hidden) loadBoards().catch(() => {});
  };
  $("#bl-close").onclick = () => { $("#bd-list").hidden = true; $("#bd-menu").classList.remove("on"); };
  $("#bl-new").onclick = () => openNewDialog();
  $("#bl-items").onclick = (ev) => {
    const li = ev.target.closest("li[data-bid]");
    if (!li) return;
    const act = ev.target.closest("button[data-do]");
    if (act) return boardAction(li.dataset.bid, act.dataset.do);
    if (!A.board || A.board.id !== li.dataset.bid) openBoard(li.dataset.bid, true);
    if (innerWidth <= 700) $("#bl-close").click();
  };
  $("#home-items").onclick = (ev) => {
    const li = ev.target.closest("li[data-bid]");
    if (li) openBoard(li.dataset.bid, true);
  };
  tplCards($("#home-tpls"), (id) => openNewDialog(id));

  const title = $("#bd-title");
  const rename = async () => {
    if (!A.board || !A.canEdit) return;
    const t = title.value.trim();
    if (!t) { title.value = A.board.title; return; }
    if (t === A.board.title) return;
    try {
      const res = await api("/api/boards/" + A.board.id, { method: "PATCH", body: JSON.stringify({ title: t, by: A.name }) });
      showBoardMeta(res.board);
      loadBoards().catch(() => {});
    } catch (e) { toast(e.message); title.value = A.board.title; }
  };
  title.onchange = rename;
  title.onkeydown = (ev) => {
    if (ev.key === "Enter") title.blur();
    if (ev.key === "Escape") { title.value = A.board ? A.board.title : ""; title.blur(); }
  };

  $("#z-in").onclick = () => zoomCenter(1.25);
  $("#z-out").onclick = () => zoomCenter(0.8);
  $("#z-fit").onclick = fitAll;
  $("#z-100").onclick = () => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, 1 / A.view.s); };

  // pictures: the file picker, and files dropped on the board
  $("#bd-file").onchange = async (ev) => {
    for (const f of Array.from(ev.target.files || [])) await X.addImage(f);
    ev.target.value = "";
  };
  stage.addEventListener("dragover", (ev) => { if (A.sync && A.canEdit) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
  stage.addEventListener("drop", async (ev) => {
    if (!A.sync || !A.canEdit) return;
    ev.preventDefault();
    const at = toWorld(ev.clientX, ev.clientY);
    let i = 0;
    for (const f of Array.from(ev.dataTransfer.files || [])) {
      if (/^image\//.test(f.type)) await X.addImage(f, { x: at.x + i * 30, y: at.y + i++ * 30 });
    }
  });

  addEventListener("resize", () => queueOverlay());
  addEventListener("popstate", () => {
    const bid = new URLSearchParams(location.search).get("board");
    if (bid && (!A.board || A.board.id !== bid)) openBoard(bid, false);
    else if (!bid && A.board) { closeBoard(); showHome(); }
  });
  // the list and "edited ... ago" stay roughly true while the page is left open
  setInterval(() => {
    if (document.hidden) return;
    if (A.board) showBoardMeta(A.board);
    if (!$("#bd-list").hidden || !$("#bd-home").hidden) loadBoards().catch(() => {});
  }, 20000);
}

/* ------------------------------------------------------------------- start */

/* The same sign-in the dashboard uses: the page works for someone who
   arrives on a link without having opened the viewer first. */
async function ensureSignedIn() {
  try {
    A.me = await api("/api/me");
    return;
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  const info = await (await fetch("/api/ping")).json();
  const back = $("#gate-back");
  back.hidden = false;
  if (!info.accounts) {
    $("#gate-name").closest("label").firstChild.textContent = "Your name";
    $("#gate-pass").closest("label").firstChild.textContent = "Project passphrase";
    $("#gate-name").type = "text";
  }
  try { $("#gate-name").value = localStorage.getItem(info.accounts ? "lwk-viewer:email" : "lwk-viewer:name") || ""; } catch (e) {}
  await new Promise((resolve) => {
    const go = async () => {
      $("#gate-msg").textContent = "Signing in ...";
      try {
        const res = await fetch("/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#gate-name").value.trim(), passphrase: $("#gate-pass").value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Sign-in failed");
        localStorage.setItem("lwk-viewer:token", data.token);
        if (info.accounts) localStorage.setItem("lwk-viewer:email", $("#gate-name").value.trim());
        else localStorage.setItem("lwk-viewer:name", $("#gate-name").value.trim());
        back.hidden = true;
        resolve();
      } catch (e) {
        $("#gate-msg").textContent = e.message;
      }
    };
    $("#gate-go").onclick = go;
    $("#gate-pass").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
  });
  A.me = await api("/api/me");
}

async function loadProjects() {
  const data = await api("/api/projects");
  const ps = data.projects || [];
  const sel = $("#b-project");
  sel.innerHTML = ps.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}`
    + `${p.role && A.me.accounts ? " (" + esc(p.role) + ")" : ""}</option>`).join("");
  let want = project();
  if (!ps.find((p) => p.id === want) && ps.length) want = ps[0].id;
  if (!want) {
    $("#bd-home").hidden = false;
    $("#home-new-h").hidden = true;
    $("#home-tpls").hidden = true;
    $("#bd-msg").textContent = A.me.accounts
      ? "You are not a member of any project yet - ask a project admin to add you."
      : "No projects on this server.";
    return false;
  }
  sel.value = want;
  if (want !== project()) {
    localStorage.setItem("lwk-viewer:project", want);
    history.replaceState(null, "", "board.html?project=" + encodeURIComponent(want));
  } else {
    try { localStorage.setItem("lwk-viewer:project", want); } catch (e) {}
  }
  sel.onchange = () => {
    localStorage.setItem("lwk-viewer:project", sel.value);
    location.href = "board.html?project=" + encodeURIComponent(sel.value);
  };
  return true;
}

/* What the other half of the page (board-extra.js) may use. */
const X = {};
const app = {
  A, O, get, $, stage, X, api, project, link,
  begin, rec, put, del, commit, invalidate, flushFrame, select, selObjs, objBox, fitBox, fitAll, applyView, toWorld, toScreen,
  stageRect, topZ, toast, ask, pop, closePop, setTool, startEdit, commitEdit, buildCtx, queueOverlay, renderObj, reveal,
  toggleFold, isTyping, loadBoards, openBoard, copyText, META, TEXTY, strip,
};

async function main() {
  buildTools();
  wireChrome();
  initExtra(app);
  await ensureSignedIn();
  if (A.me.user && A.me.user.must_change) {
    location.href = "admin.html?first=1&next=" + encodeURIComponent(location.pathname + location.search) + "#account";
    return;
  }
  A.name = A.me.user ? A.me.user.name : (localStorage.getItem("lwk-viewer:name") || "");
  if (!A.name) {
    // Signed in with the passphrase and no name: the others still need to
    // tell this person's cursor, comments and votes from the next one's.
    try {
      A.name = sessionStorage.getItem("lwk-board:guest") || "Guest " + (100 + Math.floor(Math.random() * 900));
      sessionStorage.setItem("lwk-board:guest", A.name);
    } catch (e) { A.name = "Guest"; }
  }
  $("#b-who").textContent = A.me.user ? A.me.user.name : "";
  const so = $("#d-signout");
  so.hidden = !A.me.user;
  so.onclick = (ev) => { ev.preventDefault(); signOut(); };
  const manages = A.me.site_admin || Object.values(A.me.projects || {}).includes("admin");
  $("#to-admin").hidden = !(A.me.accounts && manages);
  if (!(await loadProjects())) return;
  $("#to-sheets").href = link("index.html");
  $("#to-3d").href = link("model.html");
  $("#to-dash").href = link("dashboard.html");
  if ($("#to-tasks")) $("#to-tasks").href = link("tasks.html");
  if ($("#to-projects")) $("#to-projects").href = link("projects.html");
  if ($("#to-chat")) $("#to-chat").href = link("messenger.html");
  $("#to-admin").href = link("admin.html");

  await loadBoards();
  const asked = new URLSearchParams(location.search).get("board");
  let last = null;
  try { last = localStorage.getItem(lastKey()); } catch (e) {}
  const bid = asked || (A.boards.find((b) => b.id === last) ? last : A.boards.length ? A.boards[0].id : null);
  if (bid) await openBoard(bid, false); else showHome();
}

main().catch((e) => {
  $("#bd-home").hidden = false;
  $("#bd-msg").textContent = "Could not load: " + (e && e.message ? e.message : e);
});

// for the tests, and for poking at a board from the console
window.LWKBoard = app;
