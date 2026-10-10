import { attachTemplates } from "./templates.js";
import { smoothPath, simplify, recognize } from "./ink.js";
import { buildBcf, download } from "./bcf.js";
import * as Store from "./store.js";
import { ensureProject, sheetSets } from "./projects.js";
import * as MK from "./markup.js";
import { iconButton, iconSvg, decorateIcons } from "./icons.js";
import { attachPalette } from "./palette.js";
import * as Check from "./selfcheck.js";
import { openIssue as openIssueDetail } from "./issuepanel.js";
import { openMenu } from "./ctxmenu.js";
import { ISSUE_TYPES, typeOf, typeColor, typeOptions, shortDate } from "./issuetypes.js";
import { buildPdf } from "./pdfwriter.js";
import { annotateMarkups } from "./pdfannots.js";
import { createCompare } from "./compare.js";
import { createSync3D } from "./sync3d.js";
import { createSheetLinks } from "./sheetlinks.js";
import { startGoto, issueLink } from "./goto.js";
import * as Tele from "./telemetry.js";
import { makeTilePage, tileStats } from "./sheettiles.js";
import { initPanels, initSplitter, initVGrip } from "./panels.js";
import { copyLink } from "./share.js";
import { createAreas, pdfAreas, locateRows } from "./areas.js";
/* pdf-lib, for exports that keep the original drawing. Loaded on demand
   and optional: without it the export falls back to the picture-based
   writer rather than failing. */
let _pdfLib;
async function pdfLib() {
  if (_pdfLib !== undefined) return _pdfLib;
  try { _pdfLib = await import("./vendor/pdf-lib.js"); }
  catch (e) { _pdfLib = null; }
  return _pdfLib;
}

/* LWK Viewer - sheet stage.
 *
 * Data model note. A MARKUP and an ISSUE are different things, as in ACC.
 * Every drawing is an annotation; an annotation may optionally carry an
 * issue. Most redlining never becomes a tracked issue, and forcing a form
 * after every stroke makes the tool unusable for ordinary comments.
 *
 * Geometry is stored in PAPER MILLIMETRES from the titleblock corner, the
 * same system the Revit exporter writes. Zoom, rotation and re-export do
 * not touch stored data. Screen coordinates go through the pdf.js viewport
 * so page rotation is handled by the library rather than by hand.
 */

const PT_MM = 25.4 / 72;
const MM_PT = 72 / 25.4;

// pdf.js is served by the viewer (vendor/), through the import map's cached copy
pdfjsLib.GlobalWorkerOptions.workerSrc = (typeof import.meta.resolve === "function" ? import.meta.resolve("./vendor/pdf.worker.min.js")
    : new URL("vendor/pdf.worker.min.js", location.href).href);

/* kind: how the pointer builds the geometry.
   drag2 = press-drag-release, free = sampled path,
   poly  = repeated clicks then Enter/double-click, click = single point. */
const TOOLS = [
  { id: "select",   label: "Select",   kind: "pick" },
  { id: "pan",      label: "Pan",      kind: "pan" },
  { id: "rect",     label: "Rect",     kind: "drag2" },
  { id: "ellipse",  label: "Circle",   kind: "drag2" },
  { id: "line",     label: "Line",     kind: "drag2" },
  { id: "arrow",    label: "Arrow",    kind: "drag2" },
  { id: "cloud",    label: "Cloud",    kind: "drag2" },
  { id: "cloudpoly", label: "Cloud (free shape)", kind: "poly" },
  { id: "polyline", label: "Polyline", kind: "poly" },
  { id: "polygon",  label: "Polygon",  kind: "poly" },
  { id: "pen",      label: "Pen",      kind: "free" },
  { id: "highlight", label: "Highlighter", kind: "free" },
  { id: "text",     label: "Text",     kind: "click" },
  { id: "textbox",  label: "Text box", kind: "drag2" },
  { id: "callout",  label: "Callout",  kind: "drag2" },
  { id: "stamp",    label: "Stamp",    kind: "click" },
  { id: "measure",  label: "Measure",  kind: "drag2" },
  { id: "dimension", label: "Dimension", kind: "drag2" },
  { id: "snip",     label: "Snip",     kind: "drag2" },
  { id: "selecttext", label: "Select text", kind: "textsel" },
  { id: "area",     label: "Area",     kind: "poly"  },
  { id: "angle",    label: "Angle",    kind: "poly"  },
  { id: "eraser",   label: "Eraser",   kind: "erase" },
  { id: "match",    label: "Match properties", kind: "match" },
];

/* What a tool does when it touches the paper, for the tablet rules below. */
const DRAWING_KINDS = new Set(["drag2", "free", "poly", "click", "erase", "match"]);

const S = {
  set: "",                 // the set of sheets shown: "" = from Revit, else uploaded PDFs
  manifest: null, sheet: null, pdf: null, page: null,
  scale: 1, rotation: 0, viewport: null, pageMM: [0, 0],
  tool: "select", mode: "comment",
  style: { color: "#ff3b30", fill: "#ff3b30", tcolor: "#ff3b30", fillop: 0,
           width: 0.5, dash: "none", font: "Segoe UI", size: 3.5,
           align: "start" },
  items: [], sel: [], draft: null, clip: [], filter: "all",
  pendingIssueFor: null,
};

// for tests and fault-finding in the browser console
window.SHEETS = { S };
/* What each sheet cost to load and draw, for the Performance panel. */
const PERF = { since: performance.now(), sheets: new Map(), cur: null };
function perfSheet(sheet) {
  let p = PERF.sheets.get(sheet.number);
  if (!p) { p = { number: sheet.number, name: sheet.name || "", opens: 0 }; PERF.sheets.set(sheet.number, p); }
  PERF.cur = p;
  return p;
}
const $ = (s) => document.querySelector(s);
const svgEl = (t, a) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", t);
  for (const k in a) if (a[k] !== undefined && a[k] !== null)
    n.setAttribute(k, a[k]);
  return n;
};
const status = (m) => { $("#status").textContent = m; };

/* Sheet version compare (compare.js) and 2D + 3D side by side (sync3d.js).
   Both draw into the markup layer at the end of every redraw. */
const CMP = createCompare({
  S, $, status, Store,
  redraw: () => redraw(),
  setScale: (s) => { S.scale = s; preview(); settle(160); },
});
const SYNC = createSync3D({
  S, $, status, Store,
  redraw: () => redraw(),
  fit: () => fit(),
  paperFrom: (x, y) => paperFrom(x, y),
  canvasFrom: (u, v) => canvasFrom(u, v),
  openSheet: (sh) => openSheet(sh),
  closeSplit: () => { if (!$("#split-pane").hidden) toggleSplit(false); },
  detailSoon: () => detailSoon(),
});
const LINKS = createSheetLinks({
  S, $, status,
  canvasFrom: (u, v) => canvasFrom(u, v),
  openSheet: (sh) => openSheet(sh),
  zoomToPaper: (r) => zoomToPaper(r),
  wordsFor: (sh) => wordsFor(sh),
  pageSizePt: () => S.page ? [S.page.view[2] - S.page.view[0], S.page.view[3] - S.page.view[1]] : null,
});

const AREAS = createAreas({
  S, $, status,
  canvasFrom: (u, v) => canvasFrom(u, v),
  wordsFor: (sh) => wordsFor(sh),
  pageSizePt: () => S.page ? [S.page.view[2] - S.page.view[0], S.page.view[3] - S.page.view[1]] : null,
  revealPaper: (r) => revealPaper(r),
  vgrip: (box) => initVGrip({ el: box, key: "sheets-area-info", def: 0.4, inside: true }),
});
window.SHEETS = window.SHEETS || {};
window.SHEETS.AREAS = AREAS;

/* Scroll (without zooming) so a paper rectangle [x, y, w, h] mm is in view,
   when it is not already. */
function revealPaper(r) {
  if (!S.page) return;
  const sc = $("#scroll");
  const a = canvasFrom(r[0], r[1]), b = canvasFrom(r[0] + r[2], r[1] + r[3]);
  const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
  const x0 = P.left + Math.min(a[0], b[0]), x1 = P.left + Math.max(a[0], b[0]);
  const y0 = P.top + Math.min(a[1], b[1]), y1 = P.top + Math.max(a[1], b[1]);
  if (x0 >= R.left && x1 <= R.right && y0 >= R.top && y1 <= R.bottom) return;
  sc.scrollLeft += (x0 + x1) / 2 - (R.left + R.right) / 2;
  sc.scrollTop += (y0 + y1) / 2 - (R.top + R.bottom) / 2;
  settle(160);
}

/* Zoom the main sheet so a paper rectangle [x, y, w, h] (mm) fills most of
   the view, and scroll it to the middle. */
function zoomToPaper(r) {
  if (!S.page) return;
  const sc = $("#scroll");
  const c0 = canvasFrom(r[0], r[1]), c1 = canvasFrom(r[0] + r[2], r[1] + r[3]);
  const wpx = Math.abs(c1[0] - c0[0]) || 1, hpx = Math.abs(c1[1] - c0[1]) || 1;
  const k = Math.min(sc.clientWidth * 0.9 / wpx, sc.clientHeight * 0.9 / hpx);
  S.scale = Math.max(0.08, Math.min(12, S.scale * k));
  preview();
  const a = canvasFrom(r[0] + r[2] / 2, r[1] + r[3] / 2);
  const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
  sc.scrollLeft += (P.left - R.left) + a[0] - sc.clientWidth / 2;
  sc.scrollTop += (P.top - R.top) + a[1] - sc.clientHeight / 2;
  settle(160);
}

function decorate(svg) {
  try { LINKS.draw(); } catch (e) { showError("links", e); }
  try { AREAS.draw(); } catch (e) { showError("areas", e); }
  try { CMP.decorate(svg); } catch (e) { showError("compare", e); }
  try { SYNC.drawHere(svg); } catch (e) { showError("sync3d", e); }
}

/* Errors need somewhere that does not get overwritten. Firefox's
   error.stack carries no message line, so the name and message are built
   explicitly rather than taken from the stack. */
function showError(where, err) {
  let msg;
  if (err instanceof Error) {
    msg = (err.name || "Error") + ": " + (err.message || "(no message)");
    if (err.stack) msg += "\n" + err.stack;
  } else {
    msg = String(err);
  }
  const el = document.getElementById("errlog");
  if (el) {
    el.hidden = false;
    el.textContent = "[" + where + "] " + msg.slice(0, 900);
  }
  status("Error in " + where + " - see the bar above.");
}

addEventListener("error", (e) => showError("window", e.error || e.message));
addEventListener("unhandledrejection", (e) => showError("promise", e.reason));
const toolOf = (id) => TOOLS.find((t) => t.id === id);

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ------------------------------------------------------------- storage */

/* Items live on the server now; these keep the rest of the file unchanged. */
function load() {
  S.items = Store.all();
}

function save() {
  S.items = Store.all();
}

async function putItem(item) {
  let ok = true;
  const numBefore = item.issue ? item.issue.number : undefined;
  try {
    await Store.put(item);
  } catch (e) {
    ok = false;
    status("Not saved to the server yet (" + e.message
           + "). It stays on screen and will retry.");
  }
  S.items = Store.all();
  /* A new issue gets its number from the server: the list and the pins
     showed a stand-in (or the last issue's) until they were drawn again. */
  const saved = S.items.find((x) => x.id === item.id);
  if (saved && saved.issue && saved.issue.number !== numBefore) { redraw(); renderList(); }
  return ok;
}

/* --------------------------------------------------------- coordinates */

/* pdf.js owns the page transform, including rotation, so both directions
   go through its viewport rather than through arithmetic here. */
/* Paper millimetres are measured from the page's lower-left corner, as
   Revit measures its sheets. A PDF's own coordinates start wherever its
   page box says: at the corner for most, but at the CENTRE of the page for
   the sheets exported from STS - so a click on the 1/F plan of A003 came
   out at (146, 235) instead of (740, 655), missed every viewport, and the
   issue was "2D only". The page box origin is now taken off, whatever it is. */
function pageOrigin() {
  const v = S.page && S.page.view;
  return v ? [v[0], v[1]] : [0, 0];
}
function paperFrom(px, py) {
  const p = S.viewport.convertToPdfPoint(px, py);
  const o = pageOrigin();
  return [(p[0] - o[0]) * PT_MM, (p[1] - o[1]) * PT_MM];
}
function canvasFrom(u, v) {
  const o = pageOrigin();
  return S.viewport.convertToViewportPoint(u * MM_PT + o[0], v * MM_PT + o[1]);
}
const pxPerMM = () => S.scale * MM_PT;

function eventPoint(ev) {
  if (!S.viewport) return [0, 0];
  const r = $("#overlay").getBoundingClientRect();
  return paperFrom(ev.clientX - r.left, ev.clientY - r.top);
}

/* Which mapped viewport holds this paper point, and where in the model.
   Viewports the exporter could only guess return no model coordinate: a
   wrong 3D position is worse than none, because downstream it looks
   authoritative. */
function resolve(u, v) {
  if (!S.sheet) return null;
  return resolveIn(S.sheet.viewports || [], u, v);
}

/* The same, against any set of viewports (an earlier version's). */
function resolveIn(viewports, u, v) {
  /* Views can overlap on a sheet (one without its crop switched on reaches
     over the others): the tightest box round the point is the one meant. */
  let pick = null, best = Infinity;
  for (const vp of viewports) {
    const m = vp.paper_to_model, r = vp.paper_rect_mm;
    if (!m || !r) continue;
    if (u < r[0] || u > r[0] + r[2] || v < r[1] || v > r[1] + r[3]) continue;
    const score = r[2] * r[3] * (vp.crop_active === false ? 50 : 1);
    if (score < best) { best = score; pick = vp; }
  }
  for (const vp of pick ? [pick] : []) {
    const m = vp.paper_to_model;
    const conf = (vp.diagnostics || {}).confidence || "unknown";
    const out = { view_name: vp.view_name, view_id: vp.view_id,
                  scale: vp.scale, confidence: conf, model_mm: null,
                  /* The view's own direction, so an issue raised on a
                     drawing can still produce a camera looking the way the
                     drawing looks. */
                  normal: (m.normal || [0, 0, -1]).slice(),
                  error_mm: (vp.diagnostics || {}).max_position_error_mm || 0 };
    if (conf !== "guessed") {
      out.model_mm = [0, 1, 2].map(
        (i) => m.origin[i] + u * m.x_axis[i] + v * m.y_axis[i]);
    }
    return out;
  }
  return null;
}

/* ------------------------------------------------------------ geometry */

function dashArray(dash, w) {
  const u = Math.max(1, w * pxPerMM());
  if (dash === "dash") return `${u * 4} ${u * 3}`;
  if (dash === "dot") return `${u} ${u * 2}`;
  if (dash === "dashdot") return `${u * 5} ${u * 2} ${u} ${u * 2}`;
  return null;
}

function cloudPath(pts, bump) {
  const r = Math.max(bump, 4);
  // arcs bulge outward whichever way round the shape was drawn
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
  if (area < 0 && pts.length > 4) pts = pts.slice().reverse();
  const d = [`M ${pts[0][0]} ${pts[0][1]}`];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / (r * 2)));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      d.push(`A ${r} ${r} 0 0 1 ${a[0] + (b[0] - a[0]) * t} ${a[1] + (b[1] - a[1]) * t}`);
    }
  }
  return d.join(" ");
}

const corners = (a, b) => [a, [b[0], a[1]], b, [a[0], b[1]]];

/* How wide a line of text is drawn, in canvas pixels. */
let _measureCtx = null;
/* The same font list on the sheet as in the measuring below: with only
   "Segoe UI" named, a computer without it drew the words in its own wider
   default while the box was sized for Arial, and the words ran out of it. */
function fontFamily(font) {
  const f = font || "Segoe UI";
  return `"${f.replace(/"/g, "")}", "Segoe UI", Arial, "Microsoft JhengHei", "PingFang TC", sans-serif`;
}
function textWidth(str, fs, font) {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  _measureCtx.font = `${fs}px ${fontFamily(font)}`;
  return _measureCtx.measureText(str || "").width;
}
/* Lines of text; with maxW, long lines are broken at spaces to fit (a text
   box keeps its words inside its frame). */
function wrapText(node, str, x, y, lh, align, maxW, fs, font) {
  let lines = (str || "").split("\n");
  if (maxW && fs) {
    const out = [];
    for (const ln of lines) {
      const words = ln.split(" ");
      let cur = "";
      for (const w of words) {
        const tryL = cur ? cur + " " + w : w;
        if (cur && textWidth(tryL, fs, font) > maxW) { out.push(cur); cur = w; } else cur = tryL;
      }
      out.push(cur);
    }
    lines = out;
  }
  lines.forEach((ln, i) => {
    const t = svgEl("tspan", { x: x, dy: i === 0 ? 0 : lh });
    t.textContent = ln;
    node.appendChild(t);
  });
  node.setAttribute("text-anchor", align);
  return lines.length;
}

/* ------------------------------------------------------------ drawing */

/* Shapes are described once, then drawn twice: an invisible fat-stroked
   twin underneath for hit testing, and the real thing on top with pointer
   events off. Without the twin the user has to click the exact pixel of a
   0.5 mm line, which is unusable at any sensible zoom. */
function render(item, opts) {
  opts = opts || {};
  const st = item.style || S.style;
  // Text has its own colour; markups from before it existed use the line's.
  const tc = st.tcolor || st.color;
  const P = item.points_mm.map((p) => canvasFrom(p[0], p[1]));
  const w = Math.max(0.8, st.width * pxPerMM());
  const hitW = Math.max(14, w * 4);

  const stroke = {
    fill: "none", stroke: st.color, "stroke-width": w,
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "stroke-dasharray": dashArray(st.dash, st.width),
  };
  // A highlighter is a see-through stroke; everything else is solid.
  if (st.op) stroke["stroke-opacity"] = st.op / 100;
  const filled = Object.assign({}, stroke, st.fillop > 0
    ? { fill: st.fill, "fill-opacity": st.fillop / 100 } : {});

  const fs = Math.max(9, st.size * pxPerMM());
  const specs = [];
  const add = (tag, attrs, hit) => specs.push({ tag: tag, attrs: attrs, hit: hit });

  const box = (a, b) => ({
    x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
    width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]),
  });

  if (item.type === "rect" && P.length > 1) {
    add("rect", Object.assign({}, filled, box(P[0], P[1])), "stroke");

  } else if (item.type === "stamp" && P.length > 1) {
    const b = box(P[0], P[1]);
    const col = (item.stamp && item.stamp.color) || "#b91c1c";
    const sw = Math.max(1.2, 0.7 * pxPerMM());
    add("rect", { x: b.x, y: b.y, width: b.width, height: b.height, rx: b.height * 0.18,
      fill: "#ffffff", "fill-opacity": 0.82, stroke: col, "stroke-width": sw * 1.6 }, "all");
    add("rect", { x: b.x + sw * 2.2, y: b.y + sw * 2.2, width: Math.max(1, b.width - sw * 4.4),
      height: Math.max(1, b.height - sw * 4.4), rx: b.height * 0.12, fill: "none", stroke: col,
      "stroke-width": sw * 0.6 }, null);
    const t1 = svgEl("text", { x: b.x + b.width / 2, y: b.y + b.height * 0.56, fill: col,
      "font-size": b.height * 0.4, "font-weight": 800, "font-family": "Arial, Helvetica, sans-serif",
      "text-anchor": "middle", "letter-spacing": b.height * 0.02, "pointer-events": "none" });
    t1.textContent = item.text || "STAMP";
    specs.push({ tag: "__node", node: t1 });
    const s2 = item.stamp || {};
    const t2 = svgEl("text", { x: b.x + b.width / 2, y: b.y + b.height * 0.84, fill: col,
      "font-size": b.height * 0.17, "font-family": "Arial, Helvetica, sans-serif",
      "text-anchor": "middle", "pointer-events": "none" });
    t2.textContent = [s2.by || item.author || "", s2.at ? shortDate(s2.at) : ""].filter(Boolean).join("  \u00b7  ");
    specs.push({ tag: "__node", node: t2 });

  } else if (item.type === "ellipse" && P.length > 1) {
    const b = box(P[0], P[1]);
    add("ellipse", Object.assign({}, filled, {
      cx: b.x + b.width / 2, cy: b.y + b.height / 2,
      rx: b.width / 2, ry: b.height / 2 }), "stroke");

  } else if (item.type === "line" && P.length > 1) {
    add("line", Object.assign({}, stroke,
      { x1: P[0][0], y1: P[0][1], x2: P[1][0], y2: P[1][1] }), "stroke");

  } else if (item.type === "arrow" && P.length > 1) {
    const [a, b] = P;
    add("line", Object.assign({}, stroke,
      { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), "stroke");
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h = Math.max(7, w * 4);
    add("path", Object.assign({}, stroke, {
      fill: st.color, "stroke-dasharray": null,
      d: `M ${b[0]} ${b[1]} L ${b[0] - h * Math.cos(ang - .4)} ${b[1] - h * Math.sin(ang - .4)}`
       + ` L ${b[0] - h * Math.cos(ang + .4)} ${b[1] - h * Math.sin(ang + .4)} Z` }), "all");

  } else if (item.type === "cloud" && P.length > 1) {
    add("path", Object.assign({}, filled,
      { d: cloudPath(corners(P[0], P[1]), 3 * pxPerMM()) }), "stroke");

  } else if (item.type === "cloudpoly" && P.length > 2) {
    add("path", Object.assign({}, filled, { d: cloudPath(P, 3 * pxPerMM()) + " Z" }), "stroke");

  } else if (item.type === "cloudpoly" && P.length === 2) {
    add("polyline", Object.assign({}, stroke, { points: P.map((p) => p.join(",")).join(" ") }), "stroke");

  } else if (item.type === "polygon" && P.length > 2) {
    add("polygon", Object.assign({}, filled,
      { points: P.map((p) => p.join(",")).join(" ") }), "stroke");

  } else if (item.type === "pen" && P.length > 1) {
    // Handwriting as curves through the points, not a chain of straight bits.
    add("path", Object.assign({}, stroke, { d: smoothPath(P) }), "stroke");

  } else if (item.type === "polyline" && P.length > 1) {
    add("polyline", Object.assign({}, stroke,
      { points: P.map((p) => p.join(",")).join(" ") }), "stroke");

  } else if (item.type === "area" && P.length > 2) {
    add("polygon", Object.assign({}, filled, {
      "fill-opacity": st.fillop > 0 ? st.fillop / 100 : 0.12,
      fill: st.fill || st.color,
      points: P.map((p) => p.join(",")).join(" ") }), "stroke");
    let cx = 0, cy = 0;
    for (const p of P) { cx += p[0]; cy += p[1]; }
    const t = svgEl("text", { x: cx / P.length, y: cy / P.length,
      fill: tc, "font-size": fs, "font-family": fontFamily(st.font),
      "text-anchor": "middle", "pointer-events": "none" });
    t.textContent = areaLabel(item.points_mm, item);
    specs.push({ tag: "__node", node: t });

  } else if (item.type === "angle" && P.length > 1) {
    add("polyline", Object.assign({}, stroke,
      { points: P.map((p) => p.join(",")).join(" ") }), "stroke");
    if (P.length > 2) {
      const t = svgEl("text", { x: P[1][0] + 8, y: P[1][1] - 8,
        fill: tc, "font-size": fs, "font-family": fontFamily(st.font),
        "pointer-events": "none" });
      t.textContent = angleLabel(item.points_mm);
      specs.push({ tag: "__node", node: t });
    }

  } else if (item.type === "snip" && P.length > 1) {
    /* The area being snipped, while the user drags it: a dashed frame with
       a light wash and the size, so it is clear what will be copied. */
    const b = box(P[0], P[1]);
    add("rect", Object.assign({}, b, { fill: "rgba(242,128,34,0.10)", stroke: "#f28022",
      "stroke-width": 1.5, "stroke-dasharray": "6 4", "pointer-events": "none" }));
    const wmm = Math.abs(item.points_mm[1][0] - item.points_mm[0][0]);
    const hmm = Math.abs(item.points_mm[1][1] - item.points_mm[0][1]);
    const t = svgEl("text", { x: b.x + 4, y: b.y - 5, fill: "#b4530b", "font-size": 11,
      "font-family": "Segoe UI, Arial, sans-serif", "pointer-events": "none" });
    t.textContent = `${wmm.toFixed(0)} x ${hmm.toFixed(0)} mm`;
    specs.push({ tag: "__node", node: t });

  } else if (item.type === "image" && P.length > 1 && item.href) {
    /* A clipped piece of a drawing, or a picture pasted in. Stretched to
       its box, so resizing it by the corners works like any other shape. */
    const b = box(P[0], P[1]);
    const im = svgEl("image", { x: b.x, y: b.y, width: b.width, height: b.height,
      href: item.href, preserveAspectRatio: "none", "pointer-events": "all" });
    specs.push({ tag: "__node", node: im });
    add("rect", Object.assign({}, stroke, b, { fill: "none",
      "stroke-width": Math.max(1, w * 0.7) }), "stroke");

  } else if (item.type === "dimension" && P.length > 1) {
    /* Drawn the way Revit draws an aligned dimension: extension lines
       leaving a small gap at the measured points, a dimension line
       parallel to them, architectural ticks rather than arrowheads, and
       the value set along the line above it. The third point is the
       offset - dragging it slides the dimension line in or out, which is
       the adjustment people actually make. */
    const A = P[0], B = P[1];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const nrm = [-u[1], u[0]];
    const C = P[2] || [A[0] + nrm[0] * 24, A[1] + nrm[1] * 24];
    const off = (C[0] - A[0]) * nrm[0] + (C[1] - A[1]) * nrm[1];
    const sgn = off >= 0 ? 1 : -1;
    const gap = 3, over = 6;
    const at = (q, k) => [q[0] + nrm[0] * k, q[1] + nrm[1] * k];
    const A2 = at(A, off), B2 = at(B, off);

    const thin = Object.assign({}, stroke, { "stroke-width": Math.max(0.6, w * 0.6),
                                             "stroke-dasharray": null });
    add("line", Object.assign({}, thin, {
      x1: at(A, sgn * gap)[0], y1: at(A, sgn * gap)[1],
      x2: at(A, off + sgn * over)[0], y2: at(A, off + sgn * over)[1] }), null);
    add("line", Object.assign({}, thin, {
      x1: at(B, sgn * gap)[0], y1: at(B, sgn * gap)[1],
      x2: at(B, off + sgn * over)[0], y2: at(B, off + sgn * over)[1] }), null);
    add("line", Object.assign({}, stroke, { "stroke-dasharray": null,
      x1: A2[0] - u[0] * over, y1: A2[1] - u[1] * over,
      x2: B2[0] + u[0] * over, y2: B2[1] + u[1] * over }), "stroke");

    // 45 degree ticks across each end, as on an architectural dimension.
    const tk = Math.max(4, w * 3);
    const d45 = [(u[0] + nrm[0]) * 0.7071, (u[1] + nrm[1]) * 0.7071];
    for (const E of [A2, B2]) {
      add("line", Object.assign({}, stroke, { "stroke-dasharray": null,
        "stroke-width": Math.max(1.2, w * 1.4),
        x1: E[0] - d45[0] * tk, y1: E[1] - d45[1] * tk,
        x2: E[0] + d45[0] * tk, y2: E[1] + d45[1] * tk }), null);
    }

    // Text along the line, turned so it never reads upside down.
    let deg = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const mid = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2];
    /* Text grows away from its baseline in one direction, and rotating it
       turns that direction too. Offsetting along the dimension's normal
       therefore pushed the text ONTO the line whenever the rotation had
       turned it the other way - which is why vertical dimensions came out
       overlapping and had to be flipped by hand. Working out where the
       text will actually grow, and stepping the baseline that way, puts it
       clear of the line at every angle. */
    const rad = deg * Math.PI / 180;
    const up = [Math.sin(rad), -Math.cos(rad)];
    const lift = [mid[0] + up[0] * fs * 0.25, mid[1] + up[1] * fs * 0.25];
    const t = svgEl("text", { x: lift[0], y: lift[1], fill: tc,
      "font-size": fs, "font-family": fontFamily(st.font), "text-anchor": "middle",
      transform: `rotate(${deg} ${lift[0]} ${lift[1]})`,
      "pointer-events": "none" });
    t.textContent = measureLabel(item.points_mm.slice(0, 2), item);
    specs.push({ tag: "__node", node: t });

  } else if (item.type === "measure" && P.length > 1) {
    add("line", Object.assign({}, stroke,
      { x1: P[0][0], y1: P[0][1], x2: P[1][0], y2: P[1][1] }), "stroke");
  }

  const g = svgEl("g", { class: "mk", "data-id": item.id });
  if (item.rot && P.length) {
    // Paper y runs up and screen y runs down, so the sign flips on screen.
    const c = centreOf(P);
    g.setAttribute("transform", `rotate(${-item.rot} ${c[0]} ${c[1]})`);
  }

  for (const sp of specs) {
    if (!sp.hit || sp.node) continue;
    g.appendChild(svgEl(sp.tag, Object.assign({}, sp.attrs, {
      stroke: "transparent", "stroke-width": hitW,
      "stroke-dasharray": null,
      fill: sp.hit === "all" ? "transparent" : "none",
      "fill-opacity": null, "pointer-events": sp.hit })));
  }
  for (const sp of specs) {
    // A few shapes carry a ready-made node (a measurement label) rather
    // than attributes to build one from.
    if (sp.node) { g.appendChild(sp.node); continue; }
    g.appendChild(svgEl(sp.tag,
      Object.assign({}, sp.attrs, { "pointer-events": "none" })));
  }

  /* Text-bearing shapes are built directly: their hit area is the box or
     the glyphs, so the fat-stroke trick does not apply. */
  if (item.type === "text" && P.length) {
    const t = svgEl("text", { x: P[0][0], y: P[0][1], fill: tc,
      "font-size": fs, "font-family": fontFamily(st.font), "pointer-events": "all" });
    wrapText(t, item.text, P[0][0], P[0][1], fs * 1.25, st.align);
    g.appendChild(t);

  } else if (item.type === "textbox" && P.length > 1) {
    const b = box(P[0], P[1]);
    g.appendChild(svgEl("rect", Object.assign({}, filled, b,
      { "pointer-events": "all", "fill-opacity": st.fillop > 0
        ? st.fillop / 100 : 0.001 })));
    const tx = st.align === "start" ? b.x + 4
             : st.align === "end" ? b.x + b.width - 4 : b.x + b.width / 2;
    const t = svgEl("text", { x: tx, y: b.y + fs, fill: tc,
      "font-size": fs, "font-family": fontFamily(st.font), "pointer-events": "none" });
    wrapText(t, item.text, tx, b.y + fs, fs * 1.25, st.align, Math.max(fs * 2, b.width - 8), fs, st.font);
    g.appendChild(t);

  } else if (item.type === "callout" && P.length > 1) {
    /* The PDF-XChange / Bluebeam callout: an arrow at the thing being
       pointed at, a knee, and a short horizontal run into the label. The
       knee is what lets the leader come off the box level and then turn
       towards its target, instead of one steep line cutting across the
       drawing. Points: [target, knee, label]. A two-point callout from an
       older version gets its knee worked out rather than rejected. */
    const target = P[0];
    const anchor = P[P.length - 1];
    const lines = (item.text || " ").split("\n");
    // as wide as its longest line really is (capitals and wide fonts ran out of the box)
    const cw = Math.max(fs * 2, ...lines.map((s) => textWidth(s, fs, st.font))) + 14;
    const ch = lines.length * fs * 1.25 + 8;
    const rightOfTarget = anchor[0] >= target[0];
    const b = { x: rightOfTarget ? anchor[0] : anchor[0] - cw,
                y: anchor[1] - ch / 2, width: cw, height: ch };
    // The leader joins the box on the side facing the target, level with
    // the label's middle.
    const join = [rightOfTarget ? b.x : b.x + b.width, anchor[1]];
    const knee = P.length >= 3 ? P[1]
      : [join[0] + (rightOfTarget ? -1 : 1) * Math.min(40, Math.abs(join[0] - target[0]) * 0.35),
         join[1]];

    const path = [target, knee, join];
    const pts = path.map((q) => q.join(",")).join(" ");
    g.appendChild(svgEl("polyline", { points: pts, fill: "none",
      stroke: "transparent", "stroke-width": hitW, "pointer-events": "stroke" }));
    g.appendChild(svgEl("polyline", Object.assign({}, stroke,
      { points: pts, fill: "none", "pointer-events": "none" })));

    // Arrowhead along the first segment, pointing at the target.
    const ang = Math.atan2(knee[1] - target[1], knee[0] - target[0]);
    const hd = Math.max(7, w * 3.5);
    g.appendChild(svgEl("path", Object.assign({}, stroke, {
      fill: st.color, "stroke-dasharray": null, "pointer-events": "none",
      d: `M ${target[0]} ${target[1]} `
       + `L ${target[0] + hd * Math.cos(ang - .38)} ${target[1] + hd * Math.sin(ang - .38)} `
       + `L ${target[0] + hd * Math.cos(ang + .38)} ${target[1] + hd * Math.sin(ang + .38)} Z` })));

    g.appendChild(svgEl("rect", Object.assign({}, filled, b, {
      "pointer-events": "all",
      "fill-opacity": st.fillop > 0 ? st.fillop / 100 : 0.94,
      fill: st.fillop > 0 ? (st.fill || st.color) : "#ffffff" })));
    const tx = st.align === "start" ? b.x + 5
             : st.align === "end" ? b.x + b.width - 5 : b.x + b.width / 2;
    const t = svgEl("text", { x: tx, y: b.y + fs + 2, fill: tc,
      "font-size": fs, "font-family": fontFamily(st.font), "pointer-events": "none" });
    wrapText(t, item.text, tx, b.y + fs + 2, fs * 1.25, st.align);
    g.appendChild(t);

  } else if (item.type === "measure" && P.length > 1) {
    const t = svgEl("text", {
      x: (P[0][0] + P[1][0]) / 2, y: (P[0][1] + P[1][1]) / 2 - 5,
      fill: tc, "font-size": fs, "font-family": fontFamily(st.font),
      "text-anchor": "middle", "pointer-events": "none" });
    t.textContent = measureLabel(item.points_mm, item);
    g.appendChild(t);
  }

  if (opts.pin) {
    const p = P[0] || [0, 0];
    g.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 9,
      fill: item.issue ? typeColor(item) : "#8b93a1",
      stroke: "#fff", "stroke-width": 2, "pointer-events": "all" }));
    const n = svgEl("text", { x: p[0], y: p[1] + 4, fill: "#fff",
      "font-size": 11, "text-anchor": "middle", "font-family": "Segoe UI",
      "pointer-events": "none" });
    n.textContent = opts.pin;
    g.appendChild(n);
  }
  return g;
}

/* Measurement.
 *
 * Paper millimetres are known exactly, so the only unknown is the drawing
 * scale. Where a viewport was mapped during export the scale comes from the
 * manifest; where it was not - a scanned sheet, a detail without a viewport
 * - the user sets it once in the toolbar and every measurement follows.
 */
function activeScale(mid, item) {
  /* A measurement keeps the scale it was taken at. A single global setting
     meant that changing it for a 1:50 detail silently rewrote every 1:100
     dimension already on the sheet. The toolbar value is now only the
     default for the next measurement. */
  if (item && item.scale > 0) return { scale: item.scale, from: "own" };
  const manual = Number((document.getElementById("meas-scale") || {}).value);
  if (manual && manual > 0) return { scale: manual, from: "set" };
  const r = mid && resolve(mid[0], mid[1]);
  if (r) return { scale: Number(r.scale), from: "viewport" };
  return null;
}

const fmtLen = (mm) => mm >= 1000 ? (mm / 1000).toFixed(2) + " m"
                                  : mm.toFixed(0) + " mm";

function measureLabel(pts, item) {
  const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const s = activeScale(mid, item);
  if (s) return fmtLen(d * s.scale) + (item && item.scale ? "  (1:" + item.scale + ")" : "");
  return d.toFixed(1) + " mm (paper - set a scale)";
}

/* Shoelace on the paper polygon, then squared by the scale: a 1:300
   drawing is 300 times longer in each direction, so 90000 times the area. */
function areaLabel(pts, item) {
  if (pts.length < 3) return "";
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a2 += p[0] * q[1] - q[0] * p[1];
    cx += p[0]; cy += p[1];
  }
  const paper = Math.abs(a2) / 2;
  const s = activeScale([cx / pts.length, cy / pts.length], item);
  if (!s) return paper.toFixed(0) + " mm2 (paper - set a scale)";
  const mm2 = paper * s.scale * s.scale;
  const m2 = mm2 / 1e6;
  return m2 >= 0.01 ? m2.toFixed(2) + " m\u00B2" : mm2.toFixed(0) + " mm\u00B2";
}

/* Angle at the middle point. Scale is irrelevant: it does not change
   angles, which is worth knowing rather than guessing at. */
function angleLabel(pts) {
  if (pts.length < 3) return "";
  const [a, b, c] = pts;
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
  if (!lu || !lv) return "";
  let cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
  cos = Math.max(-1, Math.min(1, cos));
  const deg = Math.acos(cos) * 180 / Math.PI;
  return deg.toFixed(1) + "\u00B0";
}

function drawMarquee(m) {
  const svg = $("#overlay");
  let r = svg.querySelector(".marquee");
  if (!r) {
    r = svgEl("rect", { class: "marquee" });
    svg.appendChild(r);
  }
  const a = canvasFrom(m.a[0], m.a[1]);
  const b = canvasFrom(m.b[0], m.b[1]);
  r.setAttribute("x", Math.min(a[0], b[0]));
  r.setAttribute("y", Math.min(a[1], b[1]));
  r.setAttribute("width", Math.abs(b[0] - a[0]));
  r.setAttribute("height", Math.abs(b[1] - a[1]));
}

function redraw(target) {
  // A second pane (split view) draws the same markups into its own layer.
  const svg = target || $("#overlay");
  // Hiding markups is a view setting, not a change: the records are
  // untouched and the toolbar keeps saying so.
  if (S.hideMarkups) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!target) decorate(svg);
    return;
  }
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  // a sheet chosen but its page not shown yet: nothing to draw on (the draw
  // after the page is ready follows)
  if (!S.sheet || !S.viewport || !S.page) return;

  const mine = S.items.filter((i) => i.sheet === S.sheet.number);
  const hid = S.hiddenLayers || new Set();
  let n = 0;
  for (const it of mine) {
    const pin = it.issue ? String(it.issue.number || ++n) : null;
    if (hid.size && hid.has(layerOf(it))) continue;       // numbers stay the same
    if (S.hideDone && issueDone(it)) continue;            // "Hide closed" (numbers stay)
    // an issue made elsewhere (the API, a task) may have no shape on the sheet
    if (!it.points_mm || !it.points_mm.length) continue;
    svg.appendChild(render(it, { pin: pin }));
  }
  if (S.draft) svg.appendChild(render(S.draft, {}));

  const selItems = S.sel.map((id) => S.items.find((x) => x.id === id))
    // (an issue with no shape on the sheet - made from a task or the API - has no box to draw)
    .filter((it) => it && it.sheet === S.sheet.number && it.points_mm && it.points_mm.length);
  const allPx = [];
  for (const it of selItems) {
    const P = it.points_mm.map((p) => canvasFrom(p[0], p[1]));
    allPx.push(...P);
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    svg.appendChild(svgEl("rect", { class: "selbox",
      x: Math.min(...xs) - 4, y: Math.min(...ys) - 4,
      width: Math.max(...xs) - Math.min(...xs) + 8,
      height: Math.max(...ys) - Math.min(...ys) + 8 }));
    // Vertex handles only for a single, unrotated shape: on a rotated box
    // the stored corners are not where the drawn corners are, so dragging
    // one would move the wrong thing.
    if (selItems.length === 1) {
      /* On a rotated box the stored corners are the UNROTATED ones, so the
         handles are drawn turned by the same angle - on the corners the
         user actually sees - and a drag is turned back before it is
         applied. */
      const c = centreOf(P);
      const rad = it.rot && BOXY.has(it.type) ? -it.rot * Math.PI / 180 : 0;
      P.forEach((p, i) => {
        const q = rad ? rotatePoint(p, c, rad) : p;
        svg.appendChild(svgEl("circle",
          { class: "handle", cx: q[0], cy: q[1], r: 5, "data-h": i }));
      });
      /* A small square on each segment adds a point there when dragged -
         the way PDF and CAD editors let a polyline be reshaped without
         redrawing it. Freehand pen strokes are left out: they already
         have hundreds of points. */
      if (VERTEX_EDIT.has(it.type)) {
        const closed = it.type === "polygon" || it.type === "cloudpoly" || it.type === "area";
        const segs = closed ? P.length : P.length - 1;
        for (let i = 0; i < segs; i++) {
          const a0 = P[i], b0 = P[(i + 1) % P.length];
          const mx = (a0[0] + b0[0]) / 2, my = (a0[1] + b0[1]) / 2;
          svg.appendChild(svgEl("rect", { class: "midhandle", "data-seg": i,
            x: mx - 3.5, y: my - 3.5, width: 7, height: 7 }));
        }
      }
    }
  }

  if (allPx.length) {
    const xs = allPx.map((p) => p[0]), ys = allPx.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const top = Math.min(...ys) - 4;
    if (selItems.length > 1) {
      // A dashed box round the whole group, so it reads as one thing.
      svg.appendChild(svgEl("rect", { class: selGroup() ? "selgroup formal" : "selgroup",
        x: Math.min(...xs) - 8, y: top - 4,
        width: Math.max(...xs) - Math.min(...xs) + 16,
        height: Math.max(...ys) - Math.min(...ys) + 16 }));
      /* corners that scale the whole selection about the opposite corner
         (shapes, text size and line weights together) */
      const gx = [Math.min(...xs) - 8, Math.max(...xs) + 8], gy = [top - 4, Math.max(...ys) + 12];
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([i, j], c) => {
        svg.appendChild(svgEl("rect", { class: "ghandle", "data-c": c,
          x: gx[i] - 5, y: gy[j] - 5, width: 10, height: 10 }));
      });
    }
    svg.appendChild(svgEl("line", { class: "rotstem",
      x1: cx, y1: top, x2: cx, y2: top - 22 }));
    svg.appendChild(svgEl("circle", { class: "rothandle",
      cx: cx, cy: top - 28, r: 7 }));
  }
  if (!target) { placeSelbar(allPx); decorate(svg); }
  syncButtons();
}

/* ------------------------------------------------- touch selection bar */

/* Phones and tablets have no right-click and no Delete key. A selected
   markup gets a small bar of big buttons above it instead, as GoodNotes
   does after a lasso. Shown only when the last input was a finger or a
   pen, so a mouse user keeps the uncluttered sheet. */
function placeSelbar(allPx) {
  let bar = document.getElementById("selbar");
  const touchy = S.lastPointer === "touch" || S.lastPointer === "pen";
  if (!allPx.length || !touchy || S.dragging || S.tool === "match" || !S.selByDrag) {
    if (bar) bar.hidden = true;
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "selbar";
    bar.innerHTML =
      `<button data-a="issue">Issue</button>`
      + `<button data-a="dup">Duplicate</button>`
      + `<button data-a="copy">Copy</button>`
      + `<button data-a="match" title="Copy this one's look (and issue details) onto others">Match</button>`
      + `<button data-a="del" class="danger">Delete</button>`;
    $("#page").appendChild(bar);
    bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const a = b.dataset.a;
      const one = S.sel.length === 1 && S.items.find((x) => x.id === S.sel[0]);
      if (a === "del") deleteSelection();
      else if (a === "copy") copySelection();
      else if (a === "dup") { copySelection(); paste(); }
      else if (a === "match" && one) { setTool("match"); S.matchSrc = one.id;
        status("Match: tap the markups to copy its look" + (one.issue ? " and issue details" : "")
          + " onto, or tap empty paper to place a copy. Pick another tool when done."); }
      else if (a === "issue") {
        const tgt = issueTarget();
        if (tgt && tgt.issue) openIssueFromSheet(tgt);
        else if (tgt) $("#a-issue").click();
      }
    });
  }
  const one = S.sel.length === 1 && S.items.find((x) => x.id === S.sel[0]);
  const tgt = issueTarget();
  bar.querySelector('[data-a="issue"]').textContent = tgt && tgt.issue ? "Open issue" : (selGroup() ? "Raise issue on group" : "Raise issue");
  bar.querySelector('[data-a="issue"]').hidden = !tgt;
  bar.querySelector('[data-a="match"]').hidden = !one;
  const xs = allPx.map((p) => p[0]), ys = allPx.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  bar.hidden = false;
  const bw = bar.offsetWidth || 300;
  const pw = $("#page").offsetWidth;
  let left = Math.max(4, Math.min(pw - bw - 4, cx - bw / 2));
  let top = Math.min(...ys) - 92;              // above the rotate handle
  if (top < 4) top = Math.max(...ys) + 14;     // no room above: below instead
  bar.style.left = left + "px";
  bar.style.top = top + "px";
}

/* ----------------------------------------------------------- selection */

const MEASURE_TYPES = ["measure", "area", "angle", "dimension"];

/* Typed geometry.
 *
 * Dragging is fast but imprecise; a redline that has to sit exactly on a
 * gridline needs numbers. These fields show the selection's position, size
 * and angle in paper millimetres - the unit the markup is stored in, so a
 * typed value round-trips without rounding. For several items they edit
 * the group as a whole, the way a CAD properties palette does. */
function selBounds(items) {
  const pts = items.flatMap((it) => it.points_mm);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys),
           x1: Math.max(...xs), y1: Math.max(...ys) };
}

function fillGeometry() {
  const items = S.sel.map((id) => S.items.find((x) => x.id === id))
    .filter((it) => it && it.points_mm && it.points_mm.length);
  const box = $("#a-geom");
  box.hidden = !items.length;
  if (!items.length) return;
  const b = selBounds(items);
  const focused = document.activeElement && document.activeElement.id;
  const set = (id, v) => { if (focused !== id) $("#" + id).value = v.toFixed(1); };
  set("g-x", b.x0);
  set("g-y", b.y0);
  set("g-w", b.x1 - b.x0);
  set("g-h", b.y1 - b.y0);
  if (focused !== "g-r") {
    $("#g-r").value = items.length === 1 ? (items[0].rot || 0).toFixed(0) : "0";
  }
}

function applyGeometry(field) {
  const items = S.sel.map((id) => S.items.find((x) => x.id === id)).filter(Boolean);
  if (!items.length) return;
  remember(S.sel);
  const b = selBounds(items);
  const v = Number($("#" + field).value);
  if (!isFinite(v)) return;

  if (field === "g-x" || field === "g-y") {
    const dx = field === "g-x" ? v - b.x0 : 0;
    const dy = field === "g-y" ? v - b.y0 : 0;
    for (const it of items) it.points_mm = it.points_mm.map((p) => [p[0] + dx, p[1] + dy]);
  } else if (field === "g-w" || field === "g-h") {
    // Scale about the lower-left corner, the reference a typed X and Y use.
    const w = b.x1 - b.x0 || 1, h = b.y1 - b.y0 || 1;
    const kx = field === "g-w" ? Math.max(0.01, v) / w : 1;
    const ky = field === "g-h" ? Math.max(0.01, v) / h : 1;
    for (const it of items) {
      it.points_mm = it.points_mm.map((p) => [b.x0 + (p[0] - b.x0) * kx,
                                              b.y0 + (p[1] - b.y0) * ky]);
    }
  } else if (field === "g-r") {
    // One item: an absolute angle. A group: turn by the typed amount.
    const delta = items.length === 1 ? v - (items[0].rot || 0) : v;
    if (delta) rotateSelection(delta);
    if (items.length > 1) $("#g-r").value = "0";
  }
  redraw();
  persist(S.sel);
}

function syncButtons() {
  const one = S.sel.length === 1;
  const it = one && S.items.find((x) => x.id === S.sel[0]);
  $("#a-delete").disabled = !S.sel.length;
  $("#a-copy").disabled = !S.sel.length;
  const tgt = issueTarget();
  $("#a-issue").disabled = !tgt || !!tgt.issue;
  $("#a-issue").title = tgt && selGroup() ? "Raise an issue on this group of markups" : "Raise an issue on the selected markup";
  if ($("#a-group")) {
    $("#a-group").disabled = S.sel.length < 2 || !!selGroup();
    $("#a-ungroup").hidden = !S.sel.some((id) => { const x = S.items.find((y) => y.id === id); return x && x.group; });
  }
  $("#a-rotl").disabled = !S.sel.length;
  $("#a-rotr").disabled = !S.sel.length;

  fillGeometry();

  // The scale field appears only when every selected item is a measurement,
  // and shows a value only when they all agree.
  const meas = S.sel.map((id) => S.items.find((x) => x.id === id))
    .filter((x) => x && MEASURE_TYPES.indexOf(x.type) >= 0);
  const wrap = $("#a-scale-wrap");
  wrap.hidden = !meas.length || meas.length !== S.sel.length;
  if (!wrap.hidden) {
    const vals = new Set(meas.map((x) => x.scale || ""));
    $("#a-scale").value = vals.size === 1 ? Array.from(vals)[0] : "";
    $("#a-scale").placeholder = vals.size === 1 ? "auto" : "mixed";
  }
}

/* ------------------------------------------------------------- groups
   Markups grouped together select, move, rotate, copy and delete as one,
   and an issue can be raised on the group: it is held by one of them (the
   "lead") and its snapshot and pin cover the whole group. */
function groupMembers(it) {
  if (!it) return [];
  if (!it.group) return [it];
  const m = S.items.filter((x) => x.group === it.group && x.sheet === it.sheet);
  return m.length ? m : [it];
}
function expandGroups(ids) {
  const out = new Set(ids);
  for (const id of ids) {
    const it = S.items.find((x) => x.id === id);
    if (it && it.group) for (const m of groupMembers(it)) out.add(m.id);
  }
  return Array.from(out);
}
/* the selection is exactly one whole group: its id */
function selGroup(ids = S.sel) {
  const its = ids.map((id) => S.items.find((x) => x.id === id)).filter(Boolean);
  if (its.length < 2) return null;
  const g = its[0].group;
  if (!g || its.some((x) => x.group !== g)) return null;
  return groupMembers(its[0]).length === its.length ? g : null;
}
/* the markup an issue on the selection belongs to: the one selected, or
   the group's lead (the one already holding its issue, else the first) */
function issueTarget() {
  if (S.sel.length === 1) return S.items.find((x) => x.id === S.sel[0]) || null;
  const g = selGroup();
  if (!g) return null;
  const mem = S.items.filter((x) => x.group === g);
  return mem.find((x) => x.issue) || mem.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))[0];
}
function groupSelection() {
  const its = S.sel.map((id) => S.items.find((x) => x.id === id)).filter(Boolean);
  if (its.length < 2) { status("Select two or more markups to group them."); return; }
  if (its.some((it) => layerLocked(it))) { status("A markup in the selection is on a locked layer."); return; }
  if (its.filter((it) => it.issue).length > 1) {
    status("Two of these markups already carry issues - a group can hold one issue. Resolve or delete one first.");
    return;
  }
  remember(S.sel);
  const g = "g" + uid();
  for (const it of its) it.group = g;
  persist(S.sel);
  redraw(); renderList();
  status(`${its.length} markups grouped - they now select, move and rotate together. Right-click > Raise issue on group.`);
}
function ungroupSelection() {
  const its = S.sel.map((id) => S.items.find((x) => x.id === id)).filter((it) => it && it.group);
  if (!its.length) return;
  remember(S.sel);
  for (const it of its) delete it.group;
  persist(its.map((it) => it.id));
  redraw(); renderList();
  status(`Ungrouped ${its.length} markups.`);
}

function select(ids, add, byDrag) {
  ids = expandGroups(ids);
  S.sel = add ? Array.from(new Set(S.sel.concat(ids))) : ids.slice();
  /* The touch bar of big buttons is for a drag-selection; a tap or a long
     press has the menu instead (it offered the same actions twice). */
  S.selByDrag = !!byDrag && S.sel.length > 0;
  redraw(); renderList();
}

/* ------------------------------------------------------------ undo/redo */

/* History is a list of snapshots of the markups on the sheets that
   changed. Snapshots rather than inverse operations: every edit here -
   move, rotate, restyle, a typed width, a paste - becomes undoable without
   each one having to know how to reverse itself, which is where undo
   implementations usually go wrong.

   Only this user's own edits are recorded. Undo must never reach into a
   colleague's change that arrived by sync. */
const HISTORY_MAX = 80;
const history = { past: [], future: [] };

const cloneItems = (ids) => ids.map((id) => {
  const it = S.items.find((x) => x.id === id);
  return it ? JSON.parse(JSON.stringify(it)) : { id: id, __absent: true };
});

/* Call BEFORE changing items: records how they looked. */
function remember(ids) {
  if (!ids || !ids.length) return;
  history.past.push(cloneItems(ids));
  if (history.past.length > HISTORY_MAX) history.past.shift();
  history.future.length = 0;
  syncUndoButtons();
}

function restoreSnapshot(snap) {
  const back = cloneItems(snap.map((s) => s.id));
  const toDelete = [];
  for (const s of snap) {
    const i = S.items.findIndex((x) => x.id === s.id);
    if (s.__absent) {
      if (i >= 0) { S.items.splice(i, 1); toDelete.push(s.id); }
    } else if (i >= 0) {
      S.items[i] = JSON.parse(JSON.stringify(s));
    } else {
      S.items.push(JSON.parse(JSON.stringify(s)));
    }
  }
  S.sel = S.sel.filter((id) => S.items.some((x) => x.id === id));
  redraw(); renderList();
  persist(snap.filter((s) => !s.__absent).map((s) => s.id));
  for (const id of toDelete) Store.remove(id).catch(() => {});
  return back;
}

function undo() {
  if (INK.pending.length) flushInk();
  const snap = history.past.pop();
  if (!snap) { status("Nothing to undo."); return; }
  history.future.push(restoreSnapshot(snap));
  syncUndoButtons();
  status("Undone.");
}

function redo() {
  if (INK.pending.length) flushInk();
  const snap = history.future.pop();
  if (!snap) { status("Nothing to redo."); return; }
  history.past.push(restoreSnapshot(snap));
  syncUndoButtons();
  status("Redone.");
}

function syncUndoButtons() {
  const u = document.getElementById("undo"), r = document.getElementById("redo");
  if (u) u.disabled = !history.past.length;
  if (r) r.disabled = !history.future.length;
}

/* Every edit must reach the server. save() became a no-op when storage
   moved off the browser, and the move and erase paths still called it -
   so a dragged markup snapped back and an erased one reappeared on the
   next poll, five seconds later. These two are the only ways edits leave
   this page now. */
function persist(ids) {
  for (const id of ids) {
    const it = S.items.find((x) => x.id === id);
    if (it) putItem(it);
  }
}

function removeItems(ids) {
  if (!ids.length) return;
  remember(ids);
  S.items = S.items.filter((i) => ids.indexOf(i.id) < 0);
  S.sel = S.sel.filter((id) => ids.indexOf(id) < 0);
  redraw(); renderList();
  Promise.all(ids.map((id) => Store.remove(id).catch(() => {})))
    .then(() => { S.items = Store.all(); redraw(); renderList(); });
}

/* ------------------------------------------------------------- rotation */

/* Shapes defined by two corners - a rectangle, a cloud, a text box - cannot
   be rotated by moving those corners: any two corners still describe an
   upright box. They carry an angle instead, applied around their centre
   when drawn. Everything defined by a run of points rotates by moving the
   points themselves. */
const BOXY = new Set(["rect", "ellipse", "cloud", "textbox", "text", "image"]);
// Shapes whose points can be inserted and removed individually.
const VERTEX_EDIT = new Set(["polyline", "polygon", "cloudpoly", "area", "line", "arrow"]);

function centreOf(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function rotatePoint(p, c, rad) {
  const s = Math.sin(rad), k = Math.cos(rad);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * k - dy * s, c[1] + dx * s + dy * k];
}

/* Rotate the selection as a group about its common centre, so several
   markups keep their arrangement - the same as rotating a group in CAD. */
function rotateSelection(deg, noHistory) {
  const items = S.sel.map((id) => S.items.find((x) => x.id === id))
    .filter(Boolean);
  if (!items.length) return;
  if (!noHistory) remember(S.sel);
  const pivot = centreOf(items.flatMap((it) => it.points_mm));
  const rad = deg * Math.PI / 180;

  for (const it of items) {
    if (BOXY.has(it.type)) {
      const c = centreOf(it.points_mm);
      const nc = rotatePoint(c, pivot, rad);
      const dx = nc[0] - c[0], dy = nc[1] - c[1];
      it.points_mm = it.points_mm.map((p) => [p[0] + dx, p[1] + dy]);
      // Paper y runs up, the screen's runs down, so the visual sense of the
      // angle flips when it is drawn.
      it.rot = ((it.rot || 0) + deg) % 360;
    } else {
      it.points_mm = it.points_mm.map((p) => rotatePoint(p, pivot, rad));
    }
  }
  redraw();
}

function deleteSelection() {
  if (!S.sel.length) return;
  const issues = S.sel.map((id) => S.items.find((x) => x.id === id))
    .filter((it) => it && it.issue);
  // Removing an issue removes someone's record for everyone, so it asks.
  // Plain comments go without a prompt, like any drawing tool.
  if (issues.length && !confirm(issues.length === 1
      ? "Delete this issue for everyone?"
      : `Delete ${issues.length} issues for everyone?`)) return;
  removeItems(S.sel.slice());
  return;
  const ids = S.sel.slice();
  S.items = S.items.filter((i) => ids.indexOf(i.id) < 0);
  S.sel = []; redraw(); renderList();
  // Removal has to reach the server, or it reappears on the next poll.
  Promise.all(ids.map((id) => Store.remove(id).catch(() => {})))
    .then(() => { S.items = Store.all(); redraw(); renderList(); });
}

function copySelection() {
  S.clip = S.items.filter((i) => S.sel.indexOf(i.id) >= 0)
                  .map((i) => JSON.parse(JSON.stringify(i)));
  status(S.clip.length + " copied. Ctrl+V to paste.");
}

function paste() {
  if (!S.clip || !S.clip.length || !S.sheet) return;
  /* Pasting onto the sheet it came from offsets the copy so it can be seen;
     onto another sheet it keeps the same position - the usual reason is
     the same spot on another floor's plan. */
  const sameSheet = S.clip.every((c) => c.sheet === S.sheet.number);
  const now = new Date().toISOString();
  const me = Store.author();
  const regroup = new Map();
  const made = S.clip.map((src) => {
    const c = JSON.parse(JSON.stringify(src));
    c.id = uid();
    if (c.group) {
      if (!regroup.has(c.group)) regroup.set(c.group, "g" + uid());
      c.group = regroup.get(c.group);
    }
    c.sheet = S.sheet.number;
    if (sameSheet) c.points_mm = c.points_mm.map((p) => [p[0] + 5, p[1] - 5]);
    c.anchor = resolve(c.points_mm[0][0], c.points_mm[0][1]);
    c.author = me;
    c.created_at = now;
    /* An issue pastes as a NEW issue - same title, type, priority, assignee
       and description, but open, without the original's discussion or
       dismissal, and raised by whoever pasted it. It used to paste as a
       plain comment, which made copying issues look broken. */
    if (c.issue) {
      c.issue.status = "Open";
      c.issue.comments = [];
      delete c.issue.dismissed;
      c.issue.created_at = now;
      c.issue.author = me;
      c.issue.guid = uid();
      c.issue.updated_at = now;
    }
    // the copied picture shows the ORIGINAL place: a new one is taken below
    delete c.snapshot;
    return c;
  });
  remember(made.map((m) => m.id));
  S.items = S.items.concat(made);
  // Pasted markups are new records and have to be written, or they vanish
  // at the next poll like every other unsaved edit did.
  persist(made.map((m) => m.id));
  select(made.map((m) => m.id), false);
  const n = made.filter((m) => m.issue).length;
  status(`${made.length} pasted` + (n ? `, ${n} as new issue(s)` : "") + ".");
  if (n) retakeSnapshots(made.filter((m) => m.issue));
}

/* New pictures for pasted / copied issues, taken where they now are once
   the markups are drawn. */
function retakeSnapshots(items) {
  requestAnimationFrame(() => setTimeout(async () => {
    for (const it of items) {
      try {
        if (await resnapSheet(it)) await putItem(it);
      } catch (e) { status("Could not take a new snapshot: " + e.message); }
    }
  }, 50));
}

/* ------------------------------------------------------------ pointer */

function commitDraft(after) {
  const d = S.draft;
  S.draft = null;
  if (!d) return;
  d.id = uid();
  d.sheet = S.sheet.number;
  d.created_at = new Date().toISOString();
  d.anchor = resolve(d.points_mm[0][0], d.points_mm[0][1]);
  d.issue = null;
  d.author = Store.author();
  if (d.type === "dimension" && d.points_mm.length === 2) {
    const [p0, p1] = d.points_mm;
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    // Offset of 6 mm on paper, on the left of the direction drawn.
    const n0 = [-(p1[1] - p0[1]) / L, (p1[0] - p0[0]) / L];
    d.points_mm.push([(p0[0] + p1[0]) / 2 + n0[0] * 6,
                      (p0[1] + p1[1]) / 2 + n0[1] * 6]);
  }
  if (d.type === "callout" && d.points_mm.length === 2) {
    const [t0, a0] = d.points_mm;
    // Knee a third of the way back from the label, level with it.
    d.points_mm = [t0, [a0[0] + (t0[0] - a0[0]) * 0.35, a0[1]], a0];
  }
  remember([d.id]);            // absent before: undo removes it again
  S.items.push(d);
  redraw(); renderList();
  putItem(d).then(() => { redraw(); renderList(); });
  if (after) after(d);
}

/* ------------------------------------------------ ink written quickly */

/* Handwriting ("cat" is five strokes) used to commit every stroke the
   moment the Pencil lifted: the whole markup layer and the issue list
   were rebuilt and the stroke sent to the server before the next stroke
   could start - the pause felt between letters. Finished strokes now wait
   on their own light layer, exactly as drawn, and are committed together
   once the writing pauses (or anything else happens), in one redraw. */
const INK = { pending: [], timer: null };
const INK_IDLE_MS = 900;

function inkLayer() { return document.getElementById("inklayer"); }
addEventListener("pagehide", () => flushInk());
document.addEventListener("visibilitychange", () => { if (document.hidden) flushInk(); });

function queueInk(d, path) {
  d.id = uid();
  d.sheet = S.sheet.number;
  d.created_at = new Date().toISOString();
  d.author = Store.author();
  d.issue = null;
  INK.pending.push({ d, path });
  clearTimeout(INK.timer);
  INK.timer = setTimeout(flushInk, INK_IDLE_MS);
}

function flushInk() {
  clearTimeout(INK.timer);
  INK.timer = null;
  if (!INK.pending.length) return;
  const batch = INK.pending.splice(0);
  const ids = batch.map((b) => b.d.id);
  remember(ids);                  // one undo takes the word back
  for (const { d } of batch) {
    d.anchor = resolve(d.points_mm[0][0], d.points_mm[0][1]);
    S.items.push(d);
  }
  redraw(); renderList();
  // the committed copies are drawn now; the quick ones can go
  for (const { path } of batch) { try { path.remove(); } catch (e) {} }
  Promise.all(batch.map(({ d }) => putItem(d))).then(() => { redraw(); renderList(); });
}

function openIssueFromSheet(one) {
  const nums = new Map(); let k = 0;
  for (const it of S.items) if (it.issue) nums.set(it.id, it.issue.number || ++k);
  openIssueDetail(one, { number: nums.get(one.id), author: Store.author(), latest: () => Store.all().find((x) => x.id === one.id),
    onUpload: (d) => Store.uploadSnapshot(d),
    onSave: async (item) => { await putItem(item); renderList(); },
    onDelete: async (item) => { removeItems([item.id]); },
    onResnap: resnapSheet, resnapHint: "Take the picture again from the sheet as it shows now (e.g. after pasting a copy onto another floor)",
    onShow3D: show3D });
}

/* ------------------------------------------------------ match properties */

/* Like Match Properties in CAD, and the "same again" of issue registers:
   tap a markup to copy from, then tap others to give them its colour,
   line and text style. If the source is an issue, a plain markup tapped
   becomes a NEW issue with the same title, type, priority, assignee, due
   date and description (open, with no discussion yet). Tapping empty
   paper places a copy of the source there - the fastest way to raise the
   same issue at several places. */
function issueFrom(src) {
  return {
    title: src.title, type: src.type, priority: src.priority,
    assigned_to: src.assigned_to || "", due_date: src.due_date || "",
    description: src.description || "", status: "Open", comments: [],
    created_at: new Date().toISOString(), author: Store.author(), guid: uid(),
  };
}

function matchOnto(srcId, targetId) {
  const src = S.items.find((x) => x.id === srcId);
  const t = S.items.find((x) => x.id === targetId);
  if (!src || !t || src === t) return;
  remember([t.id]);
  t.style = JSON.parse(JSON.stringify(src.style || S.style));
  let made = false;
  if (src.issue && !t.issue) { t.issue = issueFrom(src.issue); made = true; }
  redraw(); renderList();
  persist([t.id]);
  if (made && !t.snapshot) retakeSnapshots([t]);
  status(made ? "Style matched, and raised as a new issue with the same details."
              : "Style matched.");
}

function placeMatchCopy(srcId, at) {
  const src = S.items.find((x) => x.id === srcId);
  if (!src || !S.sheet) return;
  const c = JSON.parse(JSON.stringify(src));
  const ctr = centreOf(c.points_mm);
  c.id = uid();
  c.sheet = S.sheet.number;
  c.points_mm = c.points_mm.map((q) => [q[0] - ctr[0] + at[0], q[1] - ctr[1] + at[1]]);
  c.anchor = resolve(at[0], at[1]);
  c.author = Store.author();
  c.created_at = new Date().toISOString();
  for (const k of ["rev", "updated_at", "updated_by", "updated_by_id", "author_id"]) delete c[k];
  if (src.issue) c.issue = issueFrom(src.issue);
  delete c.snapshot;
  remember([c.id]);
  S.items.push(c);
  redraw(); renderList();
  persist([c.id]);
  if (c.issue) retakeSnapshots([c]);
  status(src.issue ? "Placed a copy as a new issue." : "Placed a copy.");
}

function newDraft(type, pts) {
  return { type: type, points_mm: pts, text: "", layer: LAYERS.current(),
           style: JSON.parse(JSON.stringify(S.style)) };
}

/* ------------------------------------------------------------ layers

   Markups go on layers ("General" unless chosen): by discipline, by
   reviewer, "My notes" ... Each person shows or hides layers for
   themselves (remembered on this device); the markups themselves are
   shared as always. Issues stay in the issue list whatever is hidden. */
const LAYERS = {
  key: (k) => "lwk-viewer:" + k + ":" + (Store.currentProject() || "default"),
  current() {
    try { return localStorage.getItem(this.key("layer")) || "General"; } catch (e) { return "General"; }
  },
  setCurrent(v) { try { localStorage.setItem(this.key("layer"), v); } catch (e) {} },
  hidden() {
    try { return new Set(JSON.parse(localStorage.getItem(this.key("hidden-layers")) || "[]")); } catch (e) { return new Set(); }
  },
  setHidden(set) { try { localStorage.setItem(this.key("hidden-layers"), JSON.stringify([...set])); } catch (e) {} S.hiddenLayers = set; },
  all() {
    const names = new Set(["General", this.current()]);
    for (const it of S.items || []) if (!it.deleted) names.add(it.layer || "General");
    for (const n of this.extra) names.add(n);
    return [...names].sort((a, b) => (a === "General" ? -1 : b === "General" ? 1 : a.localeCompare(b)));
  },
  extra: new Set(),
};
const layerOf = (it) => it.layer || "General";
// set by the project admin (server): may this person change markups on it?
const layerLocked = (it) => !!(S.layerRules && S.layerRules.mine
  && S.layerRules.mine[layerOf(it)] && S.layerRules.mine[layerOf(it)].edit === false);
const layerEditable = (name) => !(S.layerRules && S.layerRules.mine && S.layerRules.mine[name]
  && S.layerRules.mine[name].edit === false);

function renderLayerPick() {
  const sel = document.getElementById("p-layer");
  if (!sel) return;
  let cur = LAYERS.current();
  if (!layerEditable(cur)) { cur = "General"; LAYERS.setCurrent(cur); }
  sel.innerHTML = LAYERS.all().map((n) => `<option value="${n.replace(/"/g, "&quot;")}"${n === cur ? " selected" : ""}`
    + `${layerEditable(n) ? "" : " disabled"}>${layerEditable(n) ? "" : "\u{1F512} "}${n.replace(/</g, "&lt;")}</option>`).join("")
    + `<option value="__new">New layer ...</option>`;
}

async function loadLayerRules() {
  try {
    S.layerRules = await Store.api("/api/layers");
  } catch (e) { S.layerRules = null; return; }
  for (const n of Object.keys(S.layerRules.layers || {})) LAYERS.extra.add(n);
  // hidden to start with, unless this person has chosen for themselves
  let chosen = false;
  try { chosen = localStorage.getItem(LAYERS.key("hidden-layers")) !== null; } catch (e) {}
  if (!chosen) {
    const hid = new Set(Object.entries(S.layerRules.layers || {}).filter(([, v]) => v.hidden_default).map(([k]) => k));
    S.hiddenLayers = hid;
  }
  renderLayerPick();
  redraw();
}

function wireLayers() {
  S.hiddenLayers = LAYERS.hidden();
  renderLayerPick();
  loadLayerRules();
  const sel = document.getElementById("p-layer");
  sel.addEventListener("change", () => {
    let v = sel.value;
    if (v === "__new") {
      v = (prompt("Name of the new layer:") || "").trim();
      if (!v) { renderLayerPick(); return; }
      LAYERS.extra.add(v);
    }
    LAYERS.setCurrent(v);
    // selected markups move to the chosen layer
    const ids = (S.sel || []).filter((id) => { const it = S.items.find((x) => x.id === id); return it && layerOf(it) !== v; });
    if (ids.length) {
      remember(ids);
      for (const id of ids) { const it = S.items.find((x) => x.id === id); if (it) it.layer = v; }
      persist(ids);
      status(`${ids.length} markup(s) moved to the layer "${v}".`);
    }
    renderLayerPick();
    redraw();
  });
  document.getElementById("layers-btn").addEventListener("click", (ev) => {
    const old = document.getElementById("layers-pop");
    if (old) { old.remove(); return; }
    const counts = new Map();
    for (const it of S.items || []) if (!it.deleted) counts.set(layerOf(it), (counts.get(layerOf(it)) || 0) + 1);
    const pop = document.createElement("div");
    pop.id = "layers-pop";
    const r = ev.target.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 240, r.left) + "px";
    pop.style.top = (r.bottom + 4) + "px";
    pop.innerHTML = `<div class="lp-head">Markup layers <span class="muted">(shown for you)</span></div>`
      + LAYERS.all().map((n) => `<label class="row-check"><input type="checkbox" data-l="${n.replace(/"/g, "&quot;")}"`
        + `${S.hiddenLayers.has(n) ? "" : " checked"} style="width:auto"> ${n.replace(/</g, "&lt;")}`
        + ` <span class="muted">${counts.get(n) || 0}</span></label>`).join("")
      + `<div class="lp-foot"><button class="ghost" data-a="all">All</button><button class="ghost" data-a="only">Only the current layer</button></div>`
      + (S.layerRules && S.layerRules.admin && S.layerRules.accounts
        ? `<div class="lp-foot"><a href="${"admin.html?project=" + encodeURIComponent(Store.currentProject() || "")}#layers">Who can see and edit each layer ...</a></div>` : "");
    document.body.appendChild(pop);
    const apply = () => {
      const hid = new Set();
      pop.querySelectorAll("input[data-l]").forEach((c) => { if (!c.checked) hid.add(c.dataset.l); });
      LAYERS.setHidden(hid);
      S.sel = (S.sel || []).filter((id) => { const it = S.items.find((x) => x.id === id); return it && !hid.has(layerOf(it)); });
      redraw();
    };
    pop.addEventListener("change", apply);
    pop.addEventListener("click", (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      pop.querySelectorAll("input[data-l]").forEach((c) => { c.checked = a === "all" || c.dataset.l === LAYERS.current(); });
      apply();
    });
    const away = (e) => { if (!pop.contains(e.target) && e.target.id !== "layers-btn") { pop.remove(); document.removeEventListener("pointerdown", away, true); } };
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  });
}

/* -------------------------------------------------------- snip and paste */

/* Snip takes the part of the drawing inside the box the user drags, at
   the resolution it is currently rendered, and drops a copy beside it -
   already selected, so the next thing the user does is drag it to where it
   is wanted. A detail lifted from one corner of a sheet to sit next to the
   comment about it is the use this is for. */
async function snipRegion(item) {
  /* Rendered afresh from the PDF at print resolution, not copied off the
     screen. The screen canvas is only as sharp as the current zoom, which
     is why snips came out blurred. Only the snipped area is drawn, so even
     300 dpi stays small. */
  const [p0, p1] = item.points_mm;
  const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]);
  const y0 = Math.min(p0[1], p1[1]), y1 = Math.max(p0[1], p1[1]);
  const wmm = x1 - x0, hmm = y1 - y0;
  if (wmm < 2 || hmm < 2) { status("Drag a larger box to snip."); return; }
  if (!S.page) return;

  let scale = 300 / 72;
  const longest = Math.max(wmm, hmm) * MM_PT * scale;
  if (longest > 4000) scale *= 4000 / longest;          // keep the image manageable
  const vp = S.page.getViewport({ scale: scale, rotation: 0 });
  const o = pageOrigin();
  // the snip's top-left corner (paper y runs up, so that is y1)
  const [ax, ay] = vp.convertToViewportPoint(x0 * MM_PT + o[0], y1 * MM_PT + o[1]);
  const W = Math.max(1, Math.round(wmm * MM_PT * scale));
  const H = Math.max(1, Math.round(hmm * MM_PT * scale));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  status(`Snipping ${wmm.toFixed(0)} x ${hmm.toFixed(0)} mm at ${Math.round(scale * 72)} dpi ...`);
  await S.page.render({ canvasContext: ctx, viewport: vp,
                        transform: [1, 0, 0, 1, -ax, -ay] }).promise;
  await placeImage(c.toDataURL("image/png"), item.points_mm, true);
}

/* Place an image on the sheet. `near` is the box it came from, for a snip;
   without one it is centred in the visible part of the sheet. */
async function placeImage(dataUrl, near, offset) {
  status("Placing image ...");
  let path = null;
  try { path = await Store.uploadSnapshot(dataUrl); }
  catch (e) { status("Could not store the image: " + e.message); return; }

  const img = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = dataUrl;
  });
  if (!img) { status("That image could not be read."); return; }

  let box;
  if (near) {
    const xs = near.map((p) => p[0]), ys = near.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const dx = offset ? w + 8 : 0;
    box = [[Math.min(...xs) + dx, Math.min(...ys)],
           [Math.min(...xs) + dx + w, Math.min(...ys) + h]];
  } else {
    // A pasted picture: sized to a sensible share of the sheet, keeping
    // its proportions, in the middle of what is on screen.
    const sc = $("#scroll"), r = $("#page").getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const cx = (sr.left + sr.width / 2) - r.left, cy = (sr.top + sr.height / 2) - r.top;
    const mid = paperFrom(cx, cy);
    const wmm = Math.min(S.pageMM[0] * 0.25, img.width / pxPerMM());
    const hmm = wmm * img.height / img.width;
    box = [[mid[0] - wmm / 2, mid[1] - hmm / 2], [mid[0] + wmm / 2, mid[1] + hmm / 2]];
  }

  const it = newDraft("image", box);
  it.href = path;
  it.natural = [img.width, img.height];
  S.draft = it;
  commitDraft(() => {});
  S.draft = null;
  select([it.id], false);
  setTool("select");
  status("Image placed and selected - drag it where you want it.");
}

/* Review stamps, as on a paper drawing: a framed word in its colour, with
   who stamped it and when underneath. */
const STAMPS = [
  { k: "approved", label: "APPROVED", color: "#15803d" },
  { k: "noted", label: "APPROVED AS NOTED", color: "#0f766e" },
  { k: "revise", label: "REVISE & RESUBMIT", color: "#c2410c" },
  { k: "rejected", label: "REJECTED", color: "#b91c1c" },
  { k: "reviewed", label: "REVIEWED", color: "#1d4ed8" },
  { k: "info", label: "FOR INFORMATION", color: "#4b5563" },
  { k: "void", label: "VOID", color: "#4b5563" },
];
const STAMP_H = 14;                     // paper mm

function pickStamp(item, cb) {
  const old = document.getElementById("stamp-pick");
  if (old) old.remove();
  const r = $("#overlay").getBoundingClientRect();
  const c = canvasFrom(item.points_mm[0][0], item.points_mm[0][1]);
  const box = document.createElement("div");
  box.id = "stamp-pick";
  box.style.left = Math.min(innerWidth - 220, Math.max(8, r.left + c[0])) + "px";
  box.style.top = Math.min(innerHeight - 300, Math.max(8, r.top + c[1])) + "px";
  box.innerHTML = STAMPS.map((st) => `<button data-k="${st.k}" style="color:${st.color};border-color:${st.color}">`
    + `${st.label}</button>`).join("") + `<button data-k="" class="ghost">Cancel</button>`;
  document.body.appendChild(box);
  const done = (k) => { box.remove(); document.removeEventListener("pointerdown", away, true); cb(k); };
  const away = (ev) => { if (!box.contains(ev.target)) done(null); };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (b) done(b.dataset.k || null);
  });
}

function finishDrawing(item) {
  if (item.type === "stamp") {
    pickStamp(item, (k) => {
      const st = STAMPS.find((x) => x.k === k);
      if (!st) { S.draft = null; redraw(); return; }
      const w = Math.max(40, st.label.length * STAMP_H * 0.42 + 10);
      const c = item.points_mm[0];
      // two corners, like a box: moving, rotating and selecting just work
      item.points_mm = [[c[0] - w / 2, c[1] + STAMP_H / 2], [c[0] + w / 2, c[1] - STAMP_H / 2]];
      item.text = st.label;
      item.stamp = { kind: st.k, color: st.color, by: Store.author(), at: new Date().toISOString() };
      commitDraft((made) => { if (S.mode === "issue") openIssue(made); });
    });
    return;
  }
  if (item.type === "snip") {
    S.draft = null;
    redraw();
    snipRegion(item).catch((e) => showError("snip", e));
    return;
  }
  // Stamp the scale in force now, so a later change of the default leaves
  // this measurement alone.
  if (["measure", "area", "angle", "dimension"].indexOf(item.type) >= 0 && !item.scale) {
    const s = activeScale(centreOf(item.points_mm), null);
    if (s) item.scale = s.scale;
  }
  const needsText = ["text", "textbox", "callout"].indexOf(item.type) >= 0;
  if (needsText) {
    askText((body) => {
      if (body === null) { S.draft = null; redraw(); return; }
      item.text = body;
      commitDraft((made) => { if (S.mode === "issue") openIssue(made); });
    });
    return;
  }
  commitDraft((made) => { if (S.mode === "issue") openIssue(made); });
}

/* Change the words of a text, text box or callout already on the sheet
   (double-click it, or "Edit text" on its menu). */
function editText(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it || ["text", "textbox", "callout"].indexOf(it.type) < 0) return false;
  askText((body) => {
    // the list may have been refreshed from the server while the words were typed
    const cur = S.items.find((x) => x.id === id);
    if (!cur || body === null || body === cur.text) return;
    remember([id]);
    cur.text = body;
    redraw();
    persist([id]);
  }, it.text || "");
  return true;
}

function wirePointer() {
  const svg = $("#overlay");
  let mode = null, handle = -1, last = null, poly = null;
  let marquee = null, rotPivot = null, rotLast = 0, gscale = null;

  svg.addEventListener("dblclick", (ev) => {
    if (poly) { ev.preventDefault(); endPoly(); return; }
    // double-click a text: change its words
    const tg = ev.target.closest && ev.target.closest(".mk");
    if (tg && !(ev.target.closest && ev.target.closest(".handle")) && editText(tg.dataset.id)) { ev.preventDefault(); return; }
    // Double-clicking a point of a polyline or polygon removes it.
    const h = ev.target.closest && ev.target.closest(".handle");
    if (!h || S.sel.length !== 1) return;
    const it = S.items.find((x) => x.id === S.sel[0]);
    if (!it || !VERTEX_EDIT.has(it.type)) return;
    const min = it.type === "polygon" || it.type === "cloudpoly" || it.type === "area" ? 3 : 2;
    if (it.points_mm.length <= min) {
      status("A " + it.type + " needs at least " + min + " points.");
      return;
    }
    ev.preventDefault();
    remember(S.sel);
    it.points_mm.splice(+h.dataset.h, 1);
    redraw();
    persist(S.sel);
  });

  function endPoly() {
    if (!poly) return;
    const it = S.draft;
    poly = null;
    // Drop the point that follows the cursor, unless the shape was already
    // trimmed to size (the angle case).
    if (it && it.type !== "angle" && it.points_mm.length > 2) {
      const n = it.points_mm.length;
      const a0 = it.points_mm[n - 1], b0 = it.points_mm[n - 2];
      if (Math.hypot(a0[0] - b0[0], a0[1] - b0[1]) < 0.01) it.points_mm.pop();
    }
    $("#poly-finish").hidden = true;
    if (!it || it.points_mm.length < 2) { S.draft = null; redraw(); return; }
    finishDrawing(it);
  }
  S.endPoly = endPoly;   // the Finish button and the gesture code call this

  /* A polyline on a phone: double-tap is unreliable and tapping the exact
     first point is impossible, so a tap near the first point closes it. */
  function nearFirst(p) {
    const it = S.draft;
    if (!it || it.points_mm.length < 3) return false;
    const a0 = it.points_mm[0];
    const tol = 6 / pxPerMM();            // six screen pixels, in mm
    return Math.hypot(p[0] - a0[0], p[1] - a0[1]) < tol;
  }

  /* Right-click on a markup selects it and offers what can be done to it;
     on empty paper it offers what can be done here. Right-drag still pans,
     so the menu only opens on a click that did not move. */
  let ctxDown = null;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) ctxDown = { x: ev.clientX, y: ev.clientY };
  });
  svg.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (ctxDown && Math.hypot(ev.clientX - ctxDown.x, ev.clientY - ctxDown.y) > 4) return;
    const g = ev.target.closest && ev.target.closest(".mk");
    if (g && S.sel.indexOf(g.dataset.id) < 0) select([g.dataset.id], false);
    const n = S.sel.length;
    const grp = selGroup();
    const one = (n === 1 && S.items.find((x) => x.id === S.sel[0])) || (grp && issueTarget());
    const onSheet = S.items.filter((i) => S.sheet && i.sheet === S.sheet.number);
    const anyGrouped = S.sel.some((id) => { const x = S.items.find((y) => y.id === id); return x && x.group; });

    openMenu(ev.clientX, ev.clientY, n ? [
      one && one.issue
        ? { label: "Open issue", action: () => {
              const nums = new Map(); let k = 0;
              for (const it of S.items) if (it.issue) nums.set(it.id, it.issue.number || ++k);
              openIssueDetail(one, { number: nums.get(one.id), author: Store.author(), latest: () => Store.all().find((x) => x.id === one.id),
                onUpload: (d) => Store.uploadSnapshot(d),
                onSave: async (item) => { await putItem(item); renderList(); },
                onDelete: async (item) => { removeItems([item.id]); },
                onResnap: resnapSheet, resnapHint: "Take the picture again from the sheet as it shows now (e.g. after pasting a copy onto another floor)",
                onShow3D: show3D });
            } }
        : { label: grp ? "Raise issue on group" : "Raise issue", disabled: !one, action: () => $("#a-issue").click() },
      ...(n > 1 && !grp ? [{ label: `Group ${n} markups`, key: "Ctrl+G", action: () => groupSelection() }] : []),
      ...(anyGrouped ? [{ label: "Ungroup", key: "Ctrl+Shift+G", action: () => ungroupSelection() }] : []),
      { label: "Show in 3D", disabled: !(one && one.anchor && one.anchor.model_mm),
        action: () => show3D(one) },
      ...(n === 1 && one && ["text", "textbox", "callout"].indexOf(one.type) >= 0
        ? [{ label: "Edit text", key: "double-click", action: () => editText(one.id) }] : []),
      "-",
      { label: "Rotate 90\u00B0 clockwise", key: "R",
        action: () => { rotateSelection(90); persist(S.sel); } },
      { label: "Rotate 90\u00B0 anticlockwise", key: "Shift+R",
        action: () => { rotateSelection(-90); persist(S.sel); } },
      { label: "Rotate 180\u00B0",
        action: () => { rotateSelection(180); persist(S.sel); } },
      "-",
      { label: "Copy", key: "Ctrl+C", action: () => copySelection() },
      { label: "Apply current style", action: () => applyStyleToSelection() },
      { label: "Select all on sheet", key: "Ctrl+A",
        action: () => select(onSheet.map((i) => i.id), false) },
      "-",
      { label: n > 1 ? `Delete ${n} markups` : "Delete", key: "Del",
        danger: true, action: () => deleteSelection() },
    ] : [
      { label: "Paste", key: "Ctrl+V", disabled: !(S.clip && S.clip.length),
        action: () => paste() },
      { label: "Select all on sheet", key: "Ctrl+A", disabled: !onSheet.length,
        action: () => select(onSheet.map((i) => i.id), false) },
      "-",
      { label: "Fit sheet", action: () => $("#zoom-fit").click() },
      { label: "Rotate sheet", action: () => $("#rotate").click() },
    ]);
  });

  /* Long press = right-click, for fingers and the Pencil. */
  let lp = null;
  const cancelLongPress = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  svg.addEventListener("pointermove", (ev) => {
    if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 8) cancelLongPress();
  });
  svg.addEventListener("pointerup", cancelLongPress);
  svg.addEventListener("pointercancel", cancelLongPress);

  svg.addEventListener("pointerdown", (ev) => {
    if (!S.page) return;
    if (ev.button !== 0) return;      // middle/right belong to panning
    if (S.gesture) return;            // two fingers: navigation owns this
    S.lastPointer = ev.pointerType;
    if (ev.pointerType === "pen") S.penSeen = true;
    const t = toolOf(S.tool);
    if (INK.pending.length && t.kind !== "free") flushInk();
    /* Palm rejection: once an Apple Pencil has been used, a finger or the
       side of a hand no longer draws - it pans, as in GoodNotes. */
    if (S.penSeen && ev.pointerType === "touch" && DRAWING_KINDS.has(t.kind)) return;
    const p = eventPoint(ev);
    /* A second press on the same text within a moment: change its words.
       (The page redraws between the two presses, so the browser's own
       double-click never arrives.) */
    if (t.kind === "pick") {
      const tg = ev.target.closest && ev.target.closest(".mk");
      const now = performance.now(), L = S._lastPress;
      S._lastPress = tg ? { id: tg.dataset.id, t: now, x: ev.clientX, y: ev.clientY } : null;
      if (tg && L && L.id === tg.dataset.id && now - L.t < 450 && Math.hypot(ev.clientX - L.x, ev.clientY - L.y) < 8) {
        S._lastPress = null;
        if (editText(tg.dataset.id)) { ev.preventDefault(); return; }
      }
    }
    S.dragging = true;

    if ((ev.pointerType === "touch" || ev.pointerType === "pen") && t.kind === "pick") {
      cancelLongPress();
      const x = ev.clientX, y = ev.clientY;
      lp = { x, y, t: setTimeout(() => {
        lp = null;
        mode = null; marquee = null; S.dragging = false;
        const under = document.elementFromPoint(x, y) || svg;
        under.dispatchEvent(new MouseEvent("contextmenu",
          { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }, 550) };
    }

    if (t.kind === "match") {
      const g = ev.target.closest && ev.target.closest(".mk");
      if (!S.matchSrc) {
        if (g) {
          S.matchSrc = g.dataset.id;
          select([g.dataset.id], false);
          const src = S.items.find((x) => x.id === S.matchSrc);
          status("Copying from this one. Now tap markups to give them its look"
            + (src && src.issue ? " and issue details" : "")
            + ", or tap empty paper to place a copy.");
        } else {
          status("Match: tap the markup to copy from first.");
        }
      } else if (g) {
        matchOnto(S.matchSrc, g.dataset.id);
      } else {
        placeMatchCopy(S.matchSrc, p);
      }
      S.dragging = false;
      return;
    }

    /* Shift turns any tool into Select for one gesture. Drawing a cloud and
       noticing the last one is in the wrong place should not mean a trip
       to the toolbar and back. */
    const picking = t.kind === "pick" || ev.shiftKey;

    if (t.kind === "erase" && !ev.shiftKey) {
      /* Rub out: everything the pen or finger passes over goes, like a
         GoodNotes stroke eraser. Faded while rubbing, deleted on lift. */
      erased = new Set();
      const g = ev.target.closest && ev.target.closest(".mk");
      if (g) { erased.add(g.dataset.id); g.style.opacity = 0.15; }
      mode = "erase";
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    if (picking) {
      const rh = ev.target.closest && ev.target.closest(".rothandle");
      const gh = ev.target.closest && ev.target.closest(".ghandle");
      const h = ev.target.closest && ev.target.closest(".handle");
      const g = ev.target.closest && ev.target.closest(".mk");

      // markups on a layer locked for this person: selectable, not editable
      const locked = () => {
        const bad = S.sel.map((id) => S.items.find((x) => x.id === id)).find((it) => it && layerLocked(it));
        if (bad) status(`"${layerOf(bad)}" is a locked layer: you can open its issues but not change its markups.`);
        return !!bad;
      };
      if (gh && S.sel.length > 1) {
        if (locked()) return;
        remember(S.sel);
        const items = S.sel.map((id) => S.items.find((x) => x.id === id)).filter(Boolean);
        const b = selBounds(items);
        const c = +gh.dataset.c;
        // the dragged corner, in paper mm; the fixed one is opposite it
        const corners = [[b.x0, b.y1], [b.x1, b.y1], [b.x1, b.y0], [b.x0, b.y0]];
        const sc = canvasFrom(...corners[c]), sf = canvasFrom(...corners[(c + 2) % 4]);
        gscale = { fixed: corners[(c + 2) % 4], d0: Math.hypot(sc[0] - sf[0], sc[1] - sf[1]) || 1, sf,
          orig: items.map((it) => ({ it, pts: it.points_mm.map((q) => q.slice()),
            style: it.style ? JSON.parse(JSON.stringify(it.style)) : null })) };
        mode = "gscale";
        svg.setPointerCapture(ev.pointerId);
        return;
      }
      if (rh) {
        if (locked()) return;
        remember(S.sel);
        mode = "rotate";
        const items = S.sel.map((id) => S.items.find((x) => x.id === id))
          .filter(Boolean);
        rotPivot = centreOf(items.flatMap((it) => it.points_mm));
        rotLast = Math.atan2(p[1] - rotPivot[1], p[0] - rotPivot[0]);
        svg.setPointerCapture(ev.pointerId);
        return;
      }
      const mh = ev.target.closest && ev.target.closest(".midhandle");
      if (mh && S.sel.length === 1) {
        const it = S.items.find((x) => x.id === S.sel[0]);
        if (it && !locked()) {
          remember(S.sel);
          const seg = +mh.dataset.seg;
          // A two-point line becomes a polyline once it gains a bend.
          if (it.type === "line") it.type = "polyline";
          it.points_mm.splice(seg + 1, 0, p);
          mode = "handle"; handle = seg + 1; last = p;
          svg.setPointerCapture(ev.pointerId);
          redraw();
          return;
        }
      }
      if (h) { if (locked()) return;
               remember(S.sel); mode = "handle"; handle = +h.dataset.h; last = p;
               svg.setPointerCapture(ev.pointerId); return; }
      if (g) {
        const id = g.dataset.id;
        if (ev.ctrlKey || ev.metaKey) {
          // Ctrl toggles one markup in or out of the selection.
          const i = S.sel.indexOf(id);
          if (i >= 0) { const out = new Set(expandGroups([id])); S.sel = S.sel.filter((x) => !out.has(x)); redraw(); return; }
          select([id], true);
        } else if (S.sel.indexOf(id) < 0) {
          select([id], ev.shiftKey && t.kind === "pick");
        }
        if (S.sel.some((sid) => { const it = S.items.find((x) => x.id === sid); return it && layerLocked(it); })) {
          redraw(); return;                    // selected, to read - not moved
        }
        remember(S.sel);
        mode = "move"; last = p; svg.setPointerCapture(ev.pointerId);
        return;
      }
      // Empty paper: start a selection box.
      mode = "marquee";
      marquee = { a: p, b: p, add: ev.ctrlKey || ev.metaKey };
      if (!marquee.add) select([], false);
      svg.setPointerCapture(ev.pointerId);
      return;
    }

    if (t.kind === "poly") {
      $("#poly-finish").hidden = false;
      if (poly && nearFirst(p)) {           // p is already in paper mm
        endPoly();
        return;
      }
      /* Trust the draft, not the flag. Changing tool, pressing Escape or a
         two-finger gesture can clear S.draft while `poly` is still set,
         and the next click then dereferenced null. */
      if (!poly || !S.draft || S.draft.type !== S.tool) {
        poly = true;
        S.draft = newDraft(S.tool, [p, p]);
      } else {
        S.draft.points_mm.push(p);
      }
      // An angle is exactly three points; asking for a double-click to end
      // it is a step nobody should have to remember.
      if (S.tool === "angle" && S.draft.points_mm.length > 3) {
        S.draft.points_mm = S.draft.points_mm.slice(0, 3);
        endPoly();
        return;
      }
      redraw();
      return;
    }

    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    if (t.kind === "click") {
      S.draft = newDraft(S.tool, [p]);
      finishDrawing(S.draft);
      return;
    }
    mode = "draw";
    if (t.kind === "free") {
      S.draft = newDraft("pen", [p]);
      if (S.tool === "highlight") {
        Object.assign(S.draft.style, { color: S.hlColor || "#ffd400",
          width: S.hlWidth || 4, op: 40, dash: "none" });
      }
      startInk(ev);
      return;
    }
    S.draft = newDraft(S.tool, [p, p]);
    redraw();
  });

  /* ------------------------------------------------ live freehand ink */

  let ink = null;
  let erased = null;

  function startInk(ev) {
    const st = S.draft.style;
    const path = svgEl("path", { fill: "none", stroke: st.color,
      "stroke-width": Math.max(0.8, st.width * pxPerMM()),
      "stroke-linecap": "round", "stroke-linejoin": "round",
      "stroke-opacity": st.op ? st.op / 100 : 1, class: "live-ink" });
    (inkLayer() || svg).appendChild(path);
    const r = svg.getBoundingClientRect();
    // The page does not move while a stroke is drawn: measure it once, not
    // for every one of the Pencil's 240 samples a second (each measurement
    // made the browser lay the page out again - the lag felt while writing).
    ink = { path, px: [[ev.clientX - r.left, ev.clientY - r.top]], raf: 0, hold: null,
            anchor: [ev.clientX, ev.clientY], shape: null, preview: null,
            left: r.left, top: r.top, pred: [] };
    armHold(ev);
  }

  function drawInk() {
    if (!ink) return;
    ink.raf = 0;
    // The Pencil's predicted next points are drawn ahead of the real ones
    // (as Notes and GoodNotes do), so the line keeps up with the tip.
    if (!ink.shape) ink.path.setAttribute("d", smoothPath(ink.pred.length ? ink.px.concat(ink.pred) : ink.px));
  }

  function armHold(ev) {
    clearTimeout(ink.hold);
    ink.anchor = [ev.clientX, ev.clientY];
    // Hold still at the end of a stroke: it becomes a clean shape.
    ink.hold = setTimeout(() => {
      if (!ink || !S.draft || S.snapShapes === false) return;
      const shape = recognize(S.draft.points_mm);
      if (!shape) return;
      const P = shape.points;
      const size = shape.type === "line" ? Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1])
        : Math.min(Math.abs(P[1][0] - P[0][0]), Math.abs(P[1][1] - P[0][1]));
      if (size < 4) return;                    // a tick or a dot stays ink
      ink.shape = shape;
      ink.path.setAttribute("d", "");
      const preview = render(Object.assign({}, S.draft,
        { type: shape.type, points_mm: shape.points }), {});
      preview.classList.add("live-ink");
      if (ink.preview) ink.preview.remove();
      ink.preview = preview;
      (inkLayer() || svg).appendChild(preview);
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
      status("Snapped to a " + (shape.type === "ellipse" ? "circle" : shape.type)
        + " - lift to keep it, or keep drawing for freehand.");
    }, 550);
  }

  function moveInk(ev) {
    const evs = (ev.getCoalescedEvents && ev.getCoalescedEvents().length)
      ? ev.getCoalescedEvents() : [ev];
    const minMM = 0.12 / Math.max(0.25, S.scale);
    const pts = S.draft.points_mm;
    for (const e of evs) {
      const x = e.clientX - ink.left, y = e.clientY - ink.top;
      const q = paperFrom(x, y);
      const l = pts[pts.length - 1];
      if (Math.hypot(q[0] - l[0], q[1] - l[1]) < minMM) continue;
      pts.push(q);
      ink.px.push([x, y]);
    }
    try {
      ink.pred = ev.getPredictedEvents
        ? ev.getPredictedEvents().slice(0, 3).map((e) => [e.clientX - ink.left, e.clientY - ink.top]) : [];
    } catch (e) { ink.pred = []; }
    if (Math.hypot(ev.clientX - ink.anchor[0], ev.clientY - ink.anchor[1]) > 6) {
      if (ink.shape) {                         // moving on: back to freehand
        ink.shape = null;
        if (ink.preview) { ink.preview.remove(); ink.preview = null; }
      }
      armHold(ev);
    }
    if (!ink.raf) ink.raf = requestAnimationFrame(drawInk);
  }

  function endInk(keep) {
    if (!ink) return null;
    clearTimeout(ink.hold);
    if (ink.raf) cancelAnimationFrame(ink.raf);
    if (keep && !ink.shape) keep.path = ink.path;
    else ink.path.remove();
    if (ink.preview) ink.preview.remove();
    const shape = ink.shape;
    ink = null;
    return shape;
  }

  svg.addEventListener("pointermove", (ev) => {
    if (!S.page) return;
    const p = eventPoint(ev);

    if (poly && S.draft) {
      S.draft.points_mm[S.draft.points_mm.length - 1] = p;
      redraw(); return;
    }
    if (!mode) return;

    if (mode === "erase") {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const g = under && under.closest && under.closest(".mk");
      if (g && !erased.has(g.dataset.id)) { erased.add(g.dataset.id); g.style.opacity = 0.15; }
      return;
    }
    if (mode === "draw") {
      /* A second finger on a tablet turns the stroke into a pinch-zoom and
         throws the half-drawn markup away; the first finger's moves still
         arrive after that. */
      if (!S.draft) { mode = null; endInk(); return; }
      if (ink) { moveInk(ev); return; }
      S.draft.points_mm[1] = p;
      redraw();
    } else if (mode === "move") {
      const dx = p[0] - last[0], dy = p[1] - last[1];
      for (const id of S.sel) {
        const it = S.items.find((x) => x.id === id);
        if (it) it.points_mm = it.points_mm.map((q) => [q[0] + dx, q[1] + dy]);
      }
      last = p; redraw();
    } else if (mode === "handle") {
      const it = S.items.find((x) => x.id === S.sel[0]);
      if (it && it.points_mm[handle]) {
        if (it.rot && BOXY.has(it.type)) {
          /* The corner opposite the one being dragged stays put on screen.
             Solve in the box's own frame, where the shape is upright, then
             re-centre so the fixed corner does not drift. */
          const other = it.points_mm[handle === 0 ? 1 : 0];
          const rad = it.rot * Math.PI / 180;
          const c0 = centreOf(it.points_mm);
          const fixedScreen = rotatePoint(other, c0, rad);
          const mid = [(fixedScreen[0] + p[0]) / 2, (fixedScreen[1] + p[1]) / 2];
          const a1 = rotatePoint(fixedScreen, mid, -rad);
          const b1 = rotatePoint(p, mid, -rad);
          it.points_mm[handle === 0 ? 1 : 0] = a1;
          it.points_mm[handle] = b1;
        } else {
          it.points_mm[handle] = p;
        }
      }
      redraw();
    } else if (mode === "gscale" && gscale) {
      const r = $("#overlay").getBoundingClientRect();
      const d = Math.hypot(ev.clientX - r.left - gscale.sf[0], ev.clientY - r.top - gscale.sf[1]);
      const k = Math.max(0.05, d / gscale.d0);
      const f = gscale.fixed;
      for (const o of gscale.orig) {
        o.it.points_mm = o.pts.map((q) => [f[0] + (q[0] - f[0]) * k, f[1] + (q[1] - f[1]) * k]);
        if (o.style) {
          o.it.style = Object.assign({}, o.style);
          if (o.style.size) o.it.style.size = Math.round(o.style.size * k * 100) / 100;
          if (o.style.width) o.it.style.width = Math.round(o.style.width * k * 1000) / 1000;
        }
      }
      status(`Scale ${Math.round(k * 100)}%`);
      redraw();
    } else if (mode === "rotate") {
      const ang = Math.atan2(p[1] - rotPivot[1], p[0] - rotPivot[0]);
      let deg = (ang - rotLast) * 180 / Math.PI;
      if (ev.shiftKey) {
        // Shift snaps to 15 degree steps, the increments people actually use.
        const total = Math.round(deg / 15) * 15;
        if (!total) return;
        deg = total;
      }
      rotateSelection(deg, true);
      rotLast += deg * Math.PI / 180;
    } else if (mode === "marquee") {
      marquee.b = p;
      drawMarquee(marquee);
    }
  });

  svg.addEventListener("pointerup", (ev) => {
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    S.dragging = false;
    if (mode === "erase") {
      const ids = Array.from(erased || []);
      erased = null; mode = null;
      if (ids.length) removeItems(ids);
      else redraw();
      return;
    }
    if (mode === "draw" && ink) {
      const kept = {};
      const shape = endInk(kept);
      const dropKept = () => { if (kept.path) kept.path.remove(); };
      if (S.draft) {
        const pts = S.draft.points_mm;
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (shape) {
          S.draft.type = shape.type;
          S.draft.points_mm = shape.points;
          if (S.draft.style.op) delete S.draft.style.op;     // a snapped shape is a normal line
        } else {
          // Judged by length drawn, not start-to-end: a circle ends where it began.
          if (len < 1.2) { dropKept(); S.draft = null; mode = null; redraw(); return; }
          S.draft.points_mm = simplify(pts, 0.04 / Math.max(0.25, S.scale) + 0.02);
        }
        if (!shape && kept.path && S.mode !== "issue" && S.draft.type === "pen") {
          // Written ink: keep the stroke as drawn and commit with the rest
          // of the word (see flushInk).
          kept.path.setAttribute("d", smoothPath(S.draft.points_mm.map((q) => canvasFrom(q[0], q[1]))));
          queueInk(S.draft, kept.path);
          S.draft = null;
        } else {
          dropKept();
          finishDrawing(S.draft);
        }
      } else {
        dropKept();
      }
      mode = null; handle = -1;
      return;
    }
    if (mode === "move" || mode === "handle" || mode === "rotate" || mode === "gscale") {
      gscale = null;
      for (const id of S.sel) {
        const it = S.items.find((x) => x.id === id);
        if (it) it.anchor = resolve(it.points_mm[0][0], it.points_mm[0][1]);
      }
      persist(S.sel);
      renderList();
    } else if (mode === "marquee" && marquee) {
      const x0 = Math.min(marquee.a[0], marquee.b[0]);
      const x1 = Math.max(marquee.a[0], marquee.b[0]);
      const y0 = Math.min(marquee.a[1], marquee.b[1]);
      const y1 = Math.max(marquee.a[1], marquee.b[1]);
      // Window selection: a markup is picked when it lies wholly inside,
      // as in CAD. Catching everything the box merely touches grabs half
      // the sheet on a dense drawing.
      const hit = S.items.filter((it) => it.sheet === S.sheet.number
        && it.points_mm.every((q) => q[0] >= x0 && q[0] <= x1
                                    && q[1] >= y0 && q[1] <= y1))
        .map((it) => it.id);
      if (hit.length) select(hit, marquee.add, true);
      // a click (no box dragged) inside an area of an area plan lights it up
      else if (x1 - x0 < 1.5 && y1 - y0 < 1.5) { try { AREAS.clickAt((x0 + x1) / 2, (y0 + y1) / 2); } catch (e) {} }
      marquee = null;
      redraw();
    } else if (mode === "draw" && S.draft) {
      const a = S.draft.points_mm[0];
      const b = S.draft.points_mm[S.draft.points_mm.length - 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1.2) {
        S.draft = null; redraw();       // stray click, not a markup
      } else {
        finishDrawing(S.draft);
      }
    }
    mode = null; handle = -1;
  });

  /* A picture on the system clipboard - a screenshot, a site photo copied
     from an email - is pasted straight onto the sheet. Markups copied
     inside the viewer still paste as markups; the browser only offers an
     image here when there is one. */
  document.addEventListener("paste", (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || "")) return;
    if (!S.page) return;
    const items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (const ci of items) {
      if (ci.type && ci.type.indexOf("image/") === 0) {
        ev.preventDefault();
        const file = ci.getAsFile();
        const fr = new FileReader();
        fr.onload = () => placeImage(fr.result, null, false)
          .catch((e) => showError("paste", e));
        fr.readAsDataURL(file);
        return;
      }
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if ((ev.key === "PageDown" || ev.key === "PageUp") && !poly) {
      ev.preventDefault();
      stepSheet(ev.key === "PageDown" ? 1 : -1);
      return;
    }
    // Order matters: the drawing case has to be tested before the general
    // Escape, or the general one always wins and the run is thrown away.
    if (ev.key === "Enter" && poly) endPoly();
    else if (ev.key === "Escape" && poly && S.draft) {
      /* Escape ends the run, keeping what has been placed. Throwing away
         six carefully placed points because the last one was a mistake is
         not what anyone means by Escape here; Backspace takes points back
         one at a time, and Escape on a run too short to keep still
         cancels. */
      ev.preventDefault();
      const min = S.tool === "polygon" || S.tool === "cloudpoly" ? 4 : 3;   // plus the trailing point
      if (S.draft.points_mm.length >= min) endPoly();
      else {
        poly = null; S.draft = null;
        $("#poly-finish").hidden = true;
        redraw();
        status("Drawing cancelled.");
      }
    }
    else if (ev.key === "Escape") { poly = null; S.draft = null; try { AREAS.clear(); } catch (e) {} select([], false); }
    else if (ev.key === "Backspace" && poly && S.draft) {
      /* While a polyline is being drawn, Backspace takes back the last
         point rather than deleting whatever happens to be selected. The
         last entry is the one trailing the cursor, so the placed point is
         the one before it. */
      ev.preventDefault();
      const pts = S.draft.points_mm;
      if (pts.length > 2) {
        pts.splice(pts.length - 2, 1);
        redraw();
        status((pts.length - 1) + " point(s) placed. Backspace removes another.");
      } else {
        poly = null; S.draft = null;
        $("#poly-finish").hidden = true;
        redraw();
        status("Drawing cancelled.");
      }
    }
    else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      deleteSelection();
    }
    else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "g" || ev.key === "G") && S.sel.length) {
      ev.preventDefault();
      if (ev.shiftKey) ungroupSelection(); else groupSelection();
    }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key === "a") {
      ev.preventDefault();
      select(S.items.filter((i) => S.sheet && i.sheet === S.sheet.number)
        .map((i) => i.id), false);
    }
    else if (ev.key === "r" && S.sel.length) {
      // R rotates 90 degrees; Shift+R the other way.
      rotateSelection(ev.shiftKey ? -90 : 90);
      persist(S.sel);
    }
    else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "z") {
      ev.preventDefault(); undo();
    }
    else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "y"
             || (ev.shiftKey && ev.key.toLowerCase() === "z"))) {
      ev.preventDefault(); redo();
    }
    else if (ev.ctrlKey && ev.key === "c") {
      // Selected drawing text belongs to the browser's own copy.
      if (S.tool === "selecttext") return;
      copySelection();
    }
    else if (ev.ctrlKey && ev.key === "v") paste();
    else if (!ev.ctrlKey && !ev.metaKey) {
      // one key per tool, as set in Shortcuts (the keyboard button)
      const t = toolForKey(keyName(ev));
      if (t) { ev.preventDefault(); setTool(t); }
    }
  });
}

/* ------------------------------------------------ tool shortcuts

   One key per tool, like a CAD or PDF editor. The defaults avoid the keys
   already taken (R rotates, N steps through changes, Page Up / Down turn
   sheets); each person can change them in the Shortcuts window, kept in
   this browser. */
const DEFAULT_KEYS = {
  select: "v", pan: "h", rect: "b", ellipse: "o", line: "l", arrow: "a", cloud: "c",
  cloudpoly: "shift+c", polyline: "p", polygon: "g", pen: "f", highlight: "i",
  text: "t", textbox: "x", callout: "k", stamp: "s", measure: "m", dimension: "d",
  snip: "q", selecttext: "y", area: "e", angle: "u", eraser: "w", match: "j",
};
const RESERVED_KEYS = new Set(["r", "shift+r", "n", "shift+n", "delete", "backspace", "enter", "escape",
  "pageup", "pagedown", " ", "shift+ ", "tab", "shift+tab"]);
function keyName(ev) {
  let k = (ev.key || "").toLowerCase();
  if (k === "shift" || k === "alt" || k === "control" || k === "meta") return "";
  return (ev.altKey ? "alt+" : "") + (ev.shiftKey ? "shift+" : "") + k;
}
function userKeys() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("lwk.keys") || "{}"); } catch (e) {}
  return Object.assign({}, DEFAULT_KEYS, saved);
}
function toolForKey(k) {
  if (!k) return null;
  const m = userKeys();
  for (const id in m) if (m[id] === k && TOOLS.some((t) => t.id === id)) return id;
  return null;
}
const keyLabel = (k) => (k || "").split("+").map((p) => p === " " ? "Space" : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join("+");
function labelToolKeys() {
  const m = userKeys();
  for (const t of TOOLS) {
    const b = document.querySelector(`#tools [data-tool="${t.id}"]`);
    if (b) b.title = t.label + (m[t.id] ? `  (${keyLabel(m[t.id])})` : "");
  }
}
function openShortcuts() {
  let back = document.getElementById("keys-back");
  if (back) back.remove();
  back = document.createElement("div");
  back.id = "keys-back";
  const m = userKeys();
  back.innerHTML = `<div id="keys-dlg" role="dialog" aria-label="Tool shortcuts">
    <h3>Tool shortcuts</h3>
    <p class="muted" style="margin:0 0 8px;font-size:12px">Click a box, then press the key (Shift or Alt with it if you like). Backspace clears it. Kept in this browser.</p>
    <div class="keys-grid">${TOOLS.map((t) => `<label>${t.label}<input data-tool="${t.id}" readonly value="${keyLabel(m[t.id] || "")}"></label>`).join("")}</div>
    <div class="row end"><button type="button" id="keys-reset" class="ghost">Back to defaults</button><button type="button" id="keys-close">Done</button></div>
  </div>`;
  document.body.appendChild(back);
  const saveAll = (mm) => {
    const diff = {};
    for (const id in mm) if (mm[id] !== DEFAULT_KEYS[id]) diff[id] = mm[id];
    try { localStorage.setItem("lwk.keys", JSON.stringify(diff)); } catch (e) {}
    labelToolKeys();
  };
  back.querySelectorAll("input[data-tool]").forEach((inp) => {
    inp.addEventListener("keydown", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const mm = userKeys();
      if (ev.key === "Backspace" || ev.key === "Delete") { mm[inp.dataset.tool] = ""; inp.value = ""; saveAll(mm); return; }
      if (ev.ctrlKey || ev.metaKey) { status("Ctrl and Cmd keys are kept for copy, paste and undo."); return; }
      const k = keyName(ev);
      if (!k) return;
      if (RESERVED_KEYS.has(k)) { status(keyLabel(k) + " is already used by the sheet page."); return; }
      // a key belongs to one tool: taken from the other one
      for (const id in mm) if (mm[id] === k && id !== inp.dataset.tool) {
        mm[id] = "";
        const o = back.querySelector(`input[data-tool="${id}"]`); if (o) o.value = "";
      }
      mm[inp.dataset.tool] = k;
      inp.value = keyLabel(k);
      saveAll(mm);
    });
  });
  back.querySelector("#keys-reset").addEventListener("click", () => {
    try { localStorage.removeItem("lwk.keys"); } catch (e) {}
    labelToolKeys();
    openShortcuts();
  });
  const close = () => back.remove();
  back.querySelector("#keys-close").addEventListener("click", close);
  back.addEventListener("pointerdown", (ev) => { if (ev.target === back) close(); });
}

/* --------------------------------------------------------------- pages */

/* The last sheet open, per project, so coming back from the 3D page - or
   the next morning - lands on it again. With a hundred sheets, finding the
   one you were on is the slowest thing on the page. */
const lastSheetKey = () => "lwk-viewer:last-sheet:" + (Store.currentProject() || "default");

/* ------------------------------------------------ fast sheet switching

   Opening a sheet used to download and read its PDF and draw every line
   of it, each time: 3-5 s on a busy sheet. Now:
   - PDFs already opened stay open (a few, the oldest let go);
   - the sheets next to the one on screen are read and drawn while the
     page is idle, so the next and previous ones appear at once;
   - a picture of every sheet is kept on the server (sent by the first
     computer that draws it), shown immediately while the PDF is drawn
     behind it - the first open of a sheet, and phones, need not wait. */
const DOC_KEEP = IS_IOS_EARLY() ? 2 : 4;
const BMP_KEEP = IS_IOS_EARLY() ? 2 : 4;
const _docs = new Map();              // pdf path -> Promise<PDFDocumentProxy>
const _bmps = new Map();              // key -> {canvas, w, h}
function IS_IOS_EARLY() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
/* ------------------------------------ the server's pictures, or the PDF

   A sheet is shown from the server's picture tiles (sheettiles.js) when
   its PDF is big, the line is slow, or on a phone or tablet - and from the
   PDF itself otherwise, which stays sharp at any zoom. The Performance
   panel's "Drawing" (or ?draw=tiles / pdf) sets it by hand. */
const IS_MOBILE_UA = /iP(hone|ad|od)|Android/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function drawMode() {
  const q = new URLSearchParams(location.search).get("draw");
  if (q === "tiles" || q === "pdf" || q === "auto") return q;
  try { const v = localStorage.getItem("lwk.sheetDraw"); if (v === "tiles" || v === "pdf") return v; } catch (e) {}
  return "auto";
}
let _measuredSlow = false;             // a PDF came down slower than 0.6 MB/s
function slowLine() {
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || "") || (c.downlink && c.downlink < 3))) return true;
  return _measuredSlow;
}
// sheets whose PDF took long to draw here: pictures next time
const SLOW_KEY = "lwk.slowSheets";
function slowSheets() { try { return new Set(JSON.parse(localStorage.getItem(SLOW_KEY) || "[]")); } catch (e) { return new Set(); } }
function markSlowSheet(pdf) {
  try { const s = slowSheets(); s.add(pdf); localStorage.setItem(SLOW_KEY, JSON.stringify([...s].slice(-200))); } catch (e) {}
}
const _tileMeta = new Map();           // pdf|page -> meta (ready ones only)
async function tileMetaFor(sheet) {
  const k = sheet.pdf + "|" + (sheet.page || 1);
  if (_tileMeta.has(k)) return _tileMeta.get(k);
  try {
    const r = await fetch("/api/sheet-tiles?pdf=" + encodeURIComponent(sheet.pdf) + "&page=" + (sheet.page || 1)
      + "&project=" + encodeURIComponent(Store.currentProject() || ""), { credentials: "same-origin", headers: Store.authHeaders() });
    if (!r.ok) return null;
    const m = await r.json();
    if (m.status === "ready") { _tileMeta.set(k, m); return m; }
    return m;                          // queued / working: not usable yet
  } catch (e) { return null; }
}
async function wantTiles(sheet) {
  const mode = drawMode();
  if (mode === "pdf" || !sheet.pdf) return null;
  const m = await tileMetaFor(sheet);
  if (!m || m.status !== "ready") {
    if (m && mode === "tiles") PERF.tileNote = "the server is still drawing this sheet's pictures (" + m.status + ")";
    return null;
  }
  if (mode === "tiles") return m;
  if (IS_MOBILE_UA || slowLine() || (m.pdf_bytes || 0) > 6e6 || slowSheets().has(sheet.pdf)) return m;
  return null;
}
function tilePageFor(sheet, meta) {
  const page = makeTilePage(meta, (p) => Store.dataUrl(p));
  // the PDF only when its text or its exact lines are needed
  page.loadPdfPage = async () => page.pdfPage || (page.pdfPage = await (await getDoc(sheet.pdf)).getPage(sheet.page || 1));
  page.getTextContent = async () => (await page.loadPdfPage()).getTextContent();
  return page;
}
/* the page of a sheet, from pictures or from its PDF */
async function pageFor(sheet) {
  const meta = await wantTiles(sheet);
  if (meta) return tilePageFor(sheet, meta);
  const doc = await getDoc(sheet.pdf);
  return doc.getPage(sheet.page || 1);
}

function getDoc(pdf) {
  let p = _docs.get(pdf);
  if (p) { _docs.delete(pdf); _docs.set(pdf, p); return p; }
  p = pdfjsLib.getDocument(Store.dataUrl(pdf)).promise;
  p.catch(() => _docs.delete(pdf));
  _docs.set(pdf, p);
  /* The drawings in use are never let go: the sheet being opened, the one
     still on screen while it opens (a sharper redraw of it was asked of a
     closed document - "messageHandler is null"), and the split view's. */
  const inUse = new Set([pdf, S.sheet && S.sheet.pdf, S._pagePdf,
    typeof SP !== "undefined" && SP.sheet && SP.sheet.pdf].filter(Boolean));
  while (_docs.size > DOC_KEEP) {
    const victim = [..._docs.keys()].find((k) => !inUse.has(k));
    if (!victim) break;
    const op = _docs.get(victim);
    _docs.delete(victim);
    op.then((d) => d.destroy()).catch(() => {});
  }
  return p;
}
const bmpKey = (sheet, scale, rot) => `${sheet.pdf}|${sheet.page || 1}|${scale.toFixed(4)}|${rot}`;
function putBmp(key, canvas) {
  _bmps.delete(key);
  _bmps.set(key, canvas);
  while (_bmps.size > BMP_KEEP) {
    const [old, c] = _bmps.entries().next().value;
    _bmps.delete(old);
    freeCanvas(c);
  }
}
function takeBmp(key) {
  const c = _bmps.get(key);
  if (c) { _bmps.delete(key); _bmps.set(key, c); }
  return c || null;
}
function fitScaleFor(page) {
  const v1 = page.getViewport({ scale: 1, rotation: 0 });
  return Math.max(0.1, ($("#scroll").clientWidth - 40) / v1.width);
}
function previewUrl(sheet) {
  return "/api/sheet-preview?pdf=" + encodeURIComponent(sheet.pdf)
    + "&page=" + (sheet.page || 1)
    + "&project=" + encodeURIComponent(Store.currentProject() || "");
}

/* The server's picture, shown in the page canvas while the PDF loads. */
let _openSeq = 0;
function showPreview(sheet, seq) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (seq !== _openSeq) return resolve(false);
      if ($("#page").classList.contains("ready") && _rendered.scale) return resolve(false);
      if (S._restored === sheet) return resolve(false);   // sized to the last view already
      const cw = Math.max(200, $("#scroll").clientWidth - 40);
      const h = Math.round(cw * img.naturalHeight / img.naturalWidth);
      const c = $("#pdf");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      c.style.width = cw + "px"; c.style.height = h + "px";
      $("#page").style.width = cw + "px"; $("#page").style.height = h + "px";
      $("#page").classList.add("ready");
      const d = $("#pdf-detail"); if (d) d.hidden = true;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = previewUrl(sheet);
  });
}

/* Send the server a picture of this sheet, if it has none yet. */
const _previewSent = new Set();
async function sendPreview(sheet) {
  if (IS_IOS_EARLY() || !sheet || !sheet.pdf || S.rotation) return;
  if (S.page && S.page.isTilePage) return;          // the server has its pictures
  const k = sheet.pdf + "|" + (sheet.page || 1);
  if (_previewSent.has(k)) return;
  _previewSent.add(k);
  try {
    const chk = await fetch(previewUrl(sheet) + "&check=1", { credentials: "same-origin" });
    if (!chk.ok || (await chk.json()).exists) return;     // one there already
    const page = await (await getDoc(sheet.pdf)).getPage(sheet.page || 1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2400 / v1.width, 2400 / v1.height, 4);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    freeCanvas(c);
    if (!blob) return;
    await fetch("/api/sheet-preview?pdf=" + encodeURIComponent(sheet.pdf) + "&page=" + (sheet.page || 1), {
      method: "POST", body: blob, credentials: "same-origin",
      headers: Object.assign(Store.authHeaders(), { "Content-Type": "image/jpeg" }),
    });
  } catch (e) { /* a viewer cannot send; the next member will */ }
}

/* The sheets before and after this one, read and drawn while idle. */
let _prefetchTimer = null;
function prefetchNeighbours() {
  clearTimeout(_prefetchTimer);
  _prefetchTimer = setTimeout(async () => {
    // never ahead of the sheet on screen: it has the one PDF reader to itself
    if (_task || _detailTask) { prefetchNeighbours(); return; }
    // a heavy drawing: reading its neighbours too would only slow the page
    if (S.page && !S.page.isTilePage && PERF.cur && PERF.cur.drawMs > 1500) { sendPreview(S.sheet); return; }
    const list = (S.manifest && S.manifest.sheets || []).filter((s) => s.pdf);
    const i = list.findIndex((s) => S.sheet && s.number === S.sheet.number);
    if (i < 0) return;
    const around = IS_IOS_EARLY() ? [list[i + 1]] : [list[i + 1], list[i - 1], list[i + 2]];
    for (const sh of around) {
      if (!sh) continue;
      try { await prerender(sh); } catch (e) { /* only a head start */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    // and the picture of the sheet on screen, for everyone after
    sendPreview(S.sheet);
  }, 400);
}
async function prerender(sheet) {
  const page = await pageFor(sheet);
  const scale = baseScaleFor(page, 0);
  const key = bmpKey(sheet, scale, 0);
  if (_bmps.has(key)) return;
  const vp = page.getViewport({ scale, rotation: 0 });
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  putBmp(key, c);
  // the drawing's decoded pictures and fonts are let go until it is opened
  if (!S.sheet || S.sheet.pdf !== sheet.pdf) { try { page.cleanup(); } catch (e) {} }
}


/* ------------------------------------------------- search every sheet

   Sheet numbers and names match at once. The words printed on the
   drawings are read once per version of each PDF (by the first computer
   to search, then kept on the server) and searched here. Choosing a
   result opens the sheet with every place the words occur marked. */
const FIND = { text: new Map(), words: new Map(), building: null, q: "", hits: [] };

function sheetTextUrl(sheet) {
  return "/api/sheet-text?pdf=" + encodeURIComponent(sheet.pdf) + "&page=" + (sheet.page || 1)
    + "&project=" + encodeURIComponent(Store.currentProject() || "");
}
async function readSheetText(sheet) {
  const doc = await getDoc(sheet.pdf);
  const page = await doc.getPage(sheet.page || 1);
  const tc = await page.getTextContent();
  let out = "", lastY = null;
  for (const it of tc.items) {
    if (!it.str) continue;
    const y = it.transform ? Math.round(it.transform[5]) : null;
    out += (lastY !== null && y !== lastY ? "\n" : " ") + it.str;
    lastY = y;
  }
  return out.replace(/[ \t]+/g, " ");
}
function buildTextIndex() {
  if (FIND.building) return FIND.building;
  const sheets = ((S.manifest && S.manifest.sheets) || []).filter((s) => s.pdf);
  const note = document.getElementById("sheet-find-note");
  FIND.building = (async () => {
    let done = 0;
    const one = async (sh) => {
      const key = sh.pdf + "|" + (sh.page || 1);
      if (FIND.text.has(key)) return;
      let text = null;
      try {
        const r = await fetch(sheetTextUrl(sh), { credentials: "same-origin" });
        if (r.ok) {
          const j = await r.json();
          text = j.text;
          // a scan read on the server: where each word is, for marking
          if (Array.isArray(j.words)) FIND.words.set(key, j.words);
        }
      } catch (e) {}
      if (text === null || text === undefined) {
        try {
          text = await readSheetText(sh);
          fetch("/api/sheet-text?pdf=" + encodeURIComponent(sh.pdf) + "&page=" + (sh.page || 1), {
            method: "POST", credentials: "same-origin", body: JSON.stringify({ text }),
            headers: Object.assign(Store.authHeaders(), { "Content-Type": "application/json" }),
          }).catch(() => {});
        } catch (e) { text = ""; }
      }
      FIND.text.set(key, String(text || "").toLowerCase());
      done++;
      if (note) { note.hidden = false; note.textContent = `Reading the drawings ... ${done} of ${sheets.length}`; }
      if (FIND.q) runFind(FIND.q, true);
    };
    // a few at a time: the server's copies come quickly, reading a PDF does not
    const queue = sheets.slice();
    const lanes = IS_IOS_EARLY() ? 1 : 3;
    await Promise.all(Array.from({ length: lanes }, async () => {
      while (queue.length) await one(queue.shift());
    }));
    if (note) note.hidden = true;
  })();
  return FIND.building;
}
function runFind(q, quiet) {
  FIND.q = q;
  const list = document.getElementById("find-list"), sl = document.getElementById("sheet-list");
  if (!q) { list.hidden = true; sl.hidden = false; clearFindMarks(); return; }
  const ql = q.toLowerCase();
  const rows = [];
  for (const sh of (S.manifest && S.manifest.sheets) || []) {
    const title = (sh.number + " " + (sh.name || "")).toLowerCase();
    const t = sh.pdf ? FIND.text.get(sh.pdf + "|" + (sh.page || 1)) : null;
    let n = 0, at = -1;
    if (t) { let i = t.indexOf(ql); at = i; while (i >= 0) { n++; i = t.indexOf(ql, i + ql.length); } }
    const inTitle = title.includes(ql);
    if (!inTitle && !n) continue;
    let snip = "";
    if (at >= 0) {
      const a = Math.max(0, at - 30), b = Math.min(t.length, at + ql.length + 40);
      snip = (a ? "..." : "") + t.slice(a, b).replace(/\n/g, " ") + (b < t.length ? "..." : "");
    }
    rows.push({ sh, n, inTitle, snip });
  }
  rows.sort((a, b) => (b.inTitle - a.inTitle) || (b.n - a.n));
  list.innerHTML = "";
  sl.hidden = true; list.hidden = false;
  if (!rows.length) {
    list.innerHTML = `<li class="muted" style="cursor:default">${FIND.building && FIND.text.size < ((S.manifest.sheets || []).length) ? "Nothing yet - still reading the drawings." : "Nothing found."}</li>`;
    return;
  }
  const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const mark = (x) => esc(x).replace(new RegExp(ql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;"), "gi"), (m) => `<mark>${m}</mark>`);
  for (const r of rows) {
    const li = document.createElement("li");
    li.dataset.num = r.sh.number;
    li.innerHTML = `<div class="num">${mark(r.sh.number)}${r.n ? ` <span class="count-chip">${r.n}</span>` : ""}</div>`
      + `<div class="nm">${mark(r.sh.name || "")}</div>`
      + (r.snip ? `<div class="snip">${mark(r.snip)}</div>` : "");
    li.addEventListener("click", async () => {
      FIND.pending = ql;
      if (!S.sheet || S.sheet.number !== r.sh.number) await openSheet(r.sh);
      else markFind();
    });
    list.appendChild(li);
  }
  if (!quiet && S.sheet) markFind();
}
function clearFindMarks() {
  FIND.hits = [];
  const L = document.getElementById("find-layer");
  if (L) L.innerHTML = "";
}
/* The places on the open sheet where the words are, kept in PDF units and
   drawn again at every zoom. */
/* The words on a sheet with where they are, as the server read them
   (points from the top left), or null. Kept per sheet. */
const _wordsLoading = new Map();
function wordsFor(sheet) {
  if (!sheet || !sheet.pdf) return Promise.resolve(null);
  const key = sheet.pdf + "|" + (sheet.page || 1);
  if (FIND.words.has(key)) return Promise.resolve(FIND.words.get(key));
  if (_wordsLoading.has(key)) return _wordsLoading.get(key);
  const p = (async () => {
    try {
      const r = await fetch(sheetTextUrl(sheet), { credentials: "same-origin" });
      if (!r.ok) return null;
      const j = await r.json();
      if (Array.isArray(j.words)) { FIND.words.set(key, j.words); return j.words; }
    } catch (e) {}
    /* Not read on the server yet (a small sheet shown from its PDF, never
       prepared): the words from the PDF open on screen, in the same form. */
    try {
      const pg = S.sheet === sheet && S.page && !S.page.isTilePage ? S.page : null;
      if (pg) {
        const tc = await pg.getTextContent();
        const v = pg.view, out = [];
        for (const it of tc.items) {
          const str = it.str || "";
          if (!str.trim()) continue;
          const tr = it.transform;
          const h = Math.hypot(tr[2], tr[3]) || it.height || 8;
          const W = it.width || h * str.length * 0.5;
          const x0 = tr[4] - v[0], top = v[3] - tr[5] - h;
          // one entry per word, placed along the run by character count
          let pos = 0;
          for (const part of str.split(/(\s+)/)) {
            if (part && !/^\s+$/.test(part)) out.push([part, x0 + W * pos / str.length, top, W * part.length / str.length, h]);
            pos += part.length;
          }
        }
        if (out.length) { FIND.words.set(key, out); return out; }
      }
    } catch (e) {}
    return null;
  })();
  _wordsLoading.set(key, p);
  p.finally(() => _wordsLoading.delete(key));
  return p;
}
window.SHEETS = window.SHEETS || {};
window.SHEETS.wordsFor = wordsFor;

async function markFind() {
  const q = FIND.q && FIND.q.toLowerCase();
  clearFindMarks();
  if (!q || !S.page) return;
  const page = S.page;
  let tc = { items: [] };
  // shown from the server's pictures: its word list, not the whole PDF
  const served = page.isTilePage ? await wordsFor(S.sheet) : null;
  if (!served) {
    try { tc = await page.getTextContent(); } catch (e) { return; }
  }
  if (page !== S.page) return;
  for (const it of tc.items) {
    if (!it.str || !it.str.toLowerCase().includes(q)) continue;
    const tr = it.transform;
    const fh = Math.hypot(tr[2], tr[3]) || it.height || 8;
    FIND.hits.push({ tr: tr.slice(), w: it.width || fh * it.str.length * 0.5, h: fh });
  }
  // a scanned sheet: the words the server read (points from the top left)
  const ow = FIND.words.get(S.sheet.pdf + "|" + (S.sheet.page || 1));
  if (!FIND.hits.length && ow) {
    const v = page.view, top = v[3];
    for (const [t, x, y, w, h] of ow) {
      if (!String(t).toLowerCase().includes(q)) continue;
      FIND.hits.push({ tr: [h, 0, 0, h, v[0] + x, top - y - h], w, h });
    }
  }
  paintFind(true);
  status(`${FIND.hits.length} place(s) with "${FIND.q}" on ${S.sheet.number}.`);
}
function paintFind(scroll) {
  const L = document.getElementById("find-layer");
  if (!L || !S.viewport) return;
  const w = Math.round(S.viewport.width), h = Math.round(S.viewport.height);
  L.setAttribute("width", w); L.setAttribute("height", h);
  L.setAttribute("viewBox", `0 0 ${w} ${h}`);
  L.innerHTML = "";
  let first = null;
  for (const hit of FIND.hits) {
    // the text's own frame, run through the page's view
    const m = pdfjsLib.Util.transform(S.viewport.transform, hit.tr);
    const ang = Math.atan2(m[1], m[0]);
    const sx = Math.hypot(m[0], m[1]) / Math.max(1e-6, Math.hypot(hit.tr[0], hit.tr[1]));
    const ww = hit.w * sx, hh = hit.h * sx;
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", m[4] - 2); r.setAttribute("y", m[5] - hh - 1);
    r.setAttribute("width", ww + 4); r.setAttribute("height", hh + 3);
    r.setAttribute("rx", 2);
    if (Math.abs(ang) > 0.01) r.setAttribute("transform", `rotate(${ang * 180 / Math.PI} ${m[4]} ${m[5]})`);
    L.appendChild(r);
    if (!first) first = [m[4], m[5]];
  }
  if (scroll && first) {
    const sc = $("#scroll");
    sc.scrollTo({ left: Math.max(0, first[0] - sc.clientWidth / 2), top: Math.max(0, first[1] - sc.clientHeight / 2), behavior: "smooth" });
  }
}
function wireSheetFind() {
  const box = document.getElementById("sheet-find");
  if (!box) return;
  let t = null;
  box.addEventListener("focus", () => buildTextIndex());
  box.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { buildTextIndex(); runFind(box.value.trim()); }, 200);
  });
}

async function openSheet(sheet) {
  if (INK.pending.length) flushInk();
  // a sheet of another set (from an issue, a link, a search): its set too
  if (S.manifest && sheetSet(sheet) !== S.set) showSet(sheetSet(sheet), true);
  try { localStorage.setItem(lastSheetKey(), sheet.number); } catch (e) {}
  // the previous sheet's page and viewport must not be drawn on with this
  // sheet's markups (layer rules, sync answers can arrive in between)
  S.sheet = sheet; S.sel = []; S.rotation = 0; S._restored = null; S.viewport = null;
  try { AREAS.sheetOpened(); } catch (e) {}
  _rendered = { scale: 0, rotation: -1, page: null };   // new page, bitmap is stale
  // the sheet being left lets go of its decoded pictures and fonts
  if (S.page) { const old = S.page; setTimeout(() => { if (old !== S.page) { try { old.cleanup(); } catch (e) {} } }, 0); }
  S.page = null;            // until this sheet's page is here (zooming meanwhile waits)
  if (_task) { try { _task.cancel(); } catch (e) {} _task = null; }
  document.querySelectorAll("#sheet-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.num === sheet.number);
    // the sheet you are on stays in view in the list
    if (li.dataset.num === sheet.number && li.offsetParent) li.scrollIntoView({ block: "nearest" });
  });

  if (!sheet.pdf) { status(sheet.number + " has no PDF in this export."); return; }
  $("#empty").hidden = true;
  const seq = ++_openSeq;
  const t0 = performance.now();
  status("Loading " + sheet.number + " ...");
  // the server's picture first, unless the drawing beats it
  showPreview(sheet, seq);
  let page;
  const pf = perfSheet(sheet);
  pf.opens++; pf.t0 = t0; pf.cached = _docs.has(sheet.pdf);
  try {
    const meta = await wantTiles(sheet);
    if (meta) {
      page = tilePageFor(sheet, meta);
      pf.loadMs = performance.now() - t0;
      pf.how = "pictures";
      pf.bytes = meta.pdf_bytes;
    } else {
      const doc = await getDoc(sheet.pdf);
      page = await doc.getPage(sheet.page || 1);
      pf.loadMs = performance.now() - t0;
      pf.how = "PDF";
      doc.getDownloadInfo().then((i) => {
        pf.bytes = i.length;
        // a big PDF that came down slowly: this is a slow line
        if (!pf.cached && i.length > 2e6 && pf.loadMs > 0 && i.length / (pf.loadMs / 1000) < 0.6e6) _measuredSlow = true;
      }).catch(() => {});
    }
  } catch (e) {
    if (seq === _openSeq) status("Could not open " + sheet.pdf + ": " + e.message);
    return;
  }
  if (seq !== _openSeq) return;               // another sheet was clicked meanwhile
  S.pdf = page.isTilePage ? null : await getDoc(sheet.pdf);
  S.page = page;
  S._pagePdf = sheet.pdf;
  const v1 = S.page.getViewport({ scale: 1 });
  S.pageMM = [v1.width * PT_MM, v1.height * PT_MM];
  S._openT0 = t0;
  // where you were on this sheet last time (coming back from 3D, or later)
  if (!restoreSheetView(sheet)) fit();
  followViews(sheet).catch((e) => console.warn("followViews", e));
  prefetchNeighbours();
  if (FIND.q) markFind(); else clearFindMarks();
}

/* Each sheet's last zoom and place, kept on this device: the zoom as a
   share of the fitted view (so another window size still makes sense) and
   the paper point in the middle of the screen. */
const viewKeyFor = () => "lwk.sheetview." + (Store.currentProject() || "default");
function readSheetViews() { try { return JSON.parse(localStorage.getItem(viewKeyFor()) || "{}"); } catch (e) { return {}; } }
let _viewSaveT = null;
function saveSheetViewSoon() {
  clearTimeout(_viewSaveT);
  _viewSaveT = setTimeout(saveSheetViewNow, 400);
}
// leaving for 3D (or closing) within the moment above kept the older view
addEventListener("pagehide", () => { if (_viewSaveT) { clearTimeout(_viewSaveT); saveSheetViewNow(); } });
function saveSheetViewNow() {
  _viewSaveT = null;
  {
    if (!S.page || !S.sheet || !S.viewport) return;
    const sc = $("#scroll"), P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
    const mid = paperFrom(R.left + R.width / 2 - P.left, R.top + R.height / 2 - P.top);
    const all = readSheetViews();
    all[S.sheet.number] = { rel: S.scale / fitScaleFor(S.page), mid: mid.map((v) => Math.round(v * 10) / 10), rot: S.rotation, t: Date.now() };
    // the 60 most recent sheets are enough
    const keys = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
    for (const k of keys.slice(60)) delete all[k];
    try { localStorage.setItem(viewKeyFor(), JSON.stringify(all)); } catch (e) {}
  }
}
function restoreSheetView(sheet) {
  const v = readSheetViews()[sheet.number];
  if (!v || !(v.rel > 0) || !S.page) return false;
  S.rotation = v.rot || 0;
  S._restored = sheet;
  S.scale = Math.max(0.08, Math.min(12, fitScaleFor(S.page) * v.rel));
  const page = S.page;
  const centre = () => {
    if (S.page !== page) return;
    const sc = $("#scroll");
    const a = canvasFrom(v.mid[0], v.mid[1]);
    const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
    sc.scrollLeft += (P.left - R.left) + a[0] - sc.clientWidth / 2;
    sc.scrollTop += (P.top - R.top) + a[1] - sc.clientHeight / 2;
  };
  // sizes the page at once; the drawing follows - and the page can only be
  // scrolled once it is shown, so the place is set again when it is
  const drawn = renderPage();
  centre();
  const sc0 = $("#scroll"), was = [sc0.scrollLeft, sc0.scrollTop];
  Promise.resolve(drawn).then(() => {
    // not if the user has moved the sheet meanwhile
    if (sc0.scrollLeft === was[0] && sc0.scrollTop === was[1]) centre();
  }).catch(() => {});
  return true;
}

/* Previous / next sheet in the list (PageUp / PageDown). */
function stepSheet(d) {
  const list = S.manifest ? setSheets() : [];
  const i = list.findIndex((s) => S.sheet && s.number === S.sheet.number);
  const nx = list[i + d];
  if (nx) {
    openSheet(nx);
    const li = document.querySelector(`#sheet-list li[data-num="${CSS.escape(nx.number)}"]`);
    if (li) li.scrollIntoView({ block: "nearest" });
  }
}

/* ------------------------------------------ markups follow their views */

/* A re-exported sheet can have its views moved on the paper, re-scaled or
   moved to another sheet altogether - and markups kept in paper mm then
   pointed at the wrong room. Every markup remembers the model point under
   its first point and the view it sits in (its anchor). When the sheet is
   opened, each one is put back where that model point now is on the paper
   (and resized if the view's scale changed); one whose view has gone to
   another sheet goes with it. The change is saved, so it happens once. */
function paperOfModel(vp, mm) {
  const m = vp.paper_to_model;
  const x = m.x_axis, y = m.y_axis;
  const d = [0, 1, 2].map((i) => mm[i] - m.origin[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const xx = dot(x, x), xy = dot(x, y), yy = dot(y, y), xd = dot(x, d), yd = dot(y, d);
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-12) return null;
  return [(xd * yy - yd * xy) / det, (yd * xx - xd * xy) / det];
}

function usableVp(vp) {
  return vp && vp.paper_to_model && vp.paper_rect_mm
    && ((vp.diagnostics || {}).confidence || "unknown") !== "guessed";
}

/* Markups drawn before markups remembered their view (no anchor): the
   view they were drawn in is worked out now, from the version of the sheet
   that was current when they were drawn - the server keeps each replaced
   version's viewports next to its PDF. From then on they follow like any
   other. */
async function anchorOldMarkups(sheet) {
  const old = (S.items || []).filter((it) => it.sheet === sheet.number && !it.deleted
    && it.placement !== "view" && it.placement !== "calibration"
    && Array.isArray(it.points_mm) && it.points_mm.length
    && (!it.anchor || it.anchor.view_id == null || !it.anchor.model_mm));
  if (!old.length || !sheet.pdf) return 0;
  let ver = null;
  try { ver = await Store.api("/api/versions?pdf=" + encodeURIComponent(sheet.pdf)); } catch (e) { return 0; }
  const cur = ver && ver.current ? Date.parse(ver.current) : 0;
  const versions = ((ver && ver.versions) || []).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const viewsCache = new Map();
  const viewsOf = async (v) => {
    if (!v.views) return null;
    if (!viewsCache.has(v.id)) {
      viewsCache.set(v.id, fetch(Store.dataUrl(v.views)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    const j = await viewsCache.get(v.id);
    if (!j) return null;
    const sh = (j.sheets || []).find((x) => x.number === sheet.number && (x.page || 1) === (sheet.page || 1))
      || (j.sheets || [])[0];
    return sh ? sh.viewports || [] : null;
  };
  let fixed = 0;
  for (const it of old) {
    const T = Date.parse(it.created_at || it.updated_at || "") || 0;
    let vps = null;
    if (!T || !cur || T >= cur - 60000 || !versions.length) vps = sheet.viewports || [];
    else {
      const v = versions.find((x) => Date.parse(x.at) <= T);
      if (!v) continue;                   // older than any version kept
      vps = await viewsOf(v);
    }
    if (!vps) continue;
    const p0 = it.points_mm[0];
    const a = resolveIn(vps, p0[0], p0[1]);
    if (!a || !a.model_mm || a.view_id == null) continue;
    it.anchor = Object.assign({}, it.anchor || {}, a);
    fixed++;
  }
  return fixed;
}

async function followViews(sheet) {
  if (!sheet || !S.manifest) return;
  try { await anchorOldMarkups(sheet); } catch (e) { console.warn("old markups", e); }
  const mine = (S.items || []).filter((it) => it.sheet === sheet.number && !it.deleted
    && it.placement !== "view" && it.placement !== "calibration"
    && it.anchor && it.anchor.view_id != null && it.anchor.model_mm
    && Array.isArray(it.points_mm) && it.points_mm.length);
  if (!mine.length) return;
  const here = new Map((sheet.viewports || []).filter(usableVp).map((vp) => [String(vp.view_id), vp]));
  let moved = 0, left = 0;
  for (const it of mine) {
    const a = it.anchor;
    let vp = here.get(String(a.view_id));
    let dest = sheet;
    if (!vp) {
      // the view is on another sheet now?
      const found = [];
      for (const sh of S.manifest.sheets || []) {
        for (const v of sh.viewports || []) {
          if (String(v.view_id) === String(a.view_id) && usableVp(v)) found.push([sh, v]);
        }
      }
      if (found.length !== 1 || !found[0][0].pdf) continue;
      [dest, vp] = found[0];
    }
    const p = paperOfModel(vp, a.model_mm);
    if (!p) continue;
    const p0 = it.points_mm[0];
    const k = (a.scale && vp.scale && a.scale !== vp.scale) ? a.scale / vp.scale : 1;
    const dx = p[0] - p0[0], dy = p[1] - p0[1];
    if (dest === sheet && Math.hypot(dx, dy) < 1 && k === 1) continue;
    const item = JSON.parse(JSON.stringify(it));
    item.points_mm = it.points_mm.map((q) => [p[0] + (q[0] - p0[0]) * k, p[1] + (q[1] - p0[1]) * k]);
    item.anchor = Object.assign({}, a, { scale: vp.scale, view_name: vp.view_name });
    item.sheet = dest.number;
    item.followed = { at: new Date().toISOString(), from_sheet: sheet.number,
                      shift_mm: [Math.round(dx), Math.round(dy)], scale_factor: k };
    item.updated_at = new Date().toISOString();
    await putItem(item);
    if (dest === sheet) moved++; else left++;
  }
  if (moved || left) {
    S.items = Store.all();
    redraw();
    renderList();
    status((moved ? moved + " markup(s) moved with their views on this re-exported sheet" : "")
      + (moved && left ? "; " : "")
      + (left ? left + " went with their view to another sheet" : "") + ".");
  }
}

let _task = null;
let _rendered = { scale: 0, rotation: -1, page: null };
let _settle = null;

/* How big one canvas may be. iPad and iPhone Safari refuse a canvas above
   about 16.7 million pixels - it simply stays blank - and count every
   canvas against a small memory budget. An A0 at 400% is roughly 80
   million, so zooming in on an iPad went white. The whole page is now drawn
   at most this size (softer when zoomed right in), and the part on screen
   is drawn again, sharp, on a second canvas laid over it. */
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const MAX_CANVAS_PX = IS_IOS ? 12e6 : 36e6;
let _baseScale = 0;            // scale the whole-page canvas was drawn at
let _detail = null;            // {scale, rotation, x0, y0, x1, y1} drawn in the sharp overlay
let _detailTask = null;
let _detailTimer = null;
// tests: is what is on screen drawn sharp?
window.SHEETS.sharp = () => !!S.page && (_baseScale >= S.scale * Math.min(2, window.devicePixelRatio || 1) * 0.95
  || !!(_detail && _detail.scale === S.scale && !$("#pdf-detail").hidden));

// Give a canvas's memory back straight away; Safari otherwise holds it
// until garbage collection, and runs out first.
function freeCanvas(c) { try { c.width = 0; c.height = 0; } catch (e) {} }

/* The canvas bitmap and the on-screen size are deliberately decoupled.
   During a zoom gesture only the CSS size changes, so the existing bitmap
   is stretched instantly and the page stays responsive; a crisp re-render
   follows once the wheel stops. Re-rendering an A0 on every wheel tick is
   what made zooming feel heavy. */
function applyDisplaySize() {
  const w = Math.round(S.viewport.width), h = Math.round(S.viewport.height);
  const c = $("#pdf"), pg = $("#page"), svg = $("#overlay");
  c.style.width = w + "px";
  c.style.height = h + "px";
  pg.style.width = w + "px";
  pg.style.height = h + "px";
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const ink = inkLayer();
  if (ink) {
    ink.setAttribute("width", w);
    ink.setAttribute("height", h);
    ink.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  return [w, h];
}

function setViewport() {
  S.viewport = S.page.getViewport({ scale: S.scale, rotation: S.rotation });
}

/* Cheap: no page render, just resize and redraw the vector overlay. */
function preview() {
  if (!S.page) return;
  // quick ink is in screen pixels of the old zoom: commit it first
  if (INK.pending.length) flushInk();
  // The sharp overlay is positioned in page pixels: wrong the moment the
  // zoom changes, so it goes until the gesture settles.
  const d = $("#pdf-detail");
  if (d && !d.hidden) { d.hidden = true; _detail = null; }
  setViewport();
  applyDisplaySize();
  redraw();
  $("#zoom-label").textContent = Math.round(S.scale * 100) + "%";
}

/* The whole-page picture is drawn ONCE per sheet (and turn), at a fixed
   resolution a little sharper than the fitted view; zooming only stretches
   it, and the part on screen is drawn sharp on the overlay (renderDetail).
   Drawing the whole page again at every zoom - up to 36 million pixels,
   every line of the drawing each time - is what made a big sheet take ten
   seconds or more to sharpen after each zoom, and held gigabytes. */
const BASE_PX = IS_IOS ? 6e6 : 14e6;
function baseScaleFor(page, rotation) {
  const v1 = page.getViewport({ scale: 1, rotation: rotation || 0 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = Math.max(0.1, ($("#scroll").clientWidth - 40) / v1.width);
  return Math.max(0.05, Math.min(fit * dpr * 1.5, Math.sqrt(BASE_PX / Math.max(1, v1.width * v1.height))));
}

async function renderPage() {
  if (!S.page) return;
  setViewport();
  const [w, h] = applyDisplaySize();

  // the picture of this sheet is already there: only the sharp part is redrawn
  if (_rendered.page === S.page && _rendered.rotation === S.rotation) {
    _rendered.scale = S.scale;
    $("#zoom-label").textContent = Math.round(S.scale * 100) + "%";
    redraw();
    renderDetail();
    saveSheetViewSoon();
    return;
  }

  /* Draw into an offscreen canvas first. Assigning canvas.width clears it,
     so rendering straight onto the visible canvas leaves it blank for the
     whole render - that is the flicker during zoom. */
  const bs = baseScaleFor(S.page, S.rotation);
  const key = S.sheet ? bmpKey(S.sheet, bs, S.rotation) : null;
  let off = key ? takeBmp(key) : null;          // drawn ahead while idle?
  const pre = !!off;
  if (!off) {
    const bvp = S.page.getViewport({ scale: bs, rotation: S.rotation });
    off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(bvp.width)); off.height = Math.max(1, Math.round(bvp.height));
    const sheetNow = S.sheet;
    if (_task) { try { _task.cancel(); } catch (e) {} }
    _task = S.page.render({ canvasContext: off.getContext("2d"), viewport: bvp });
    const tDraw = performance.now();
    try {
      await _task.promise;
      if (PERF.cur) { PERF.cur.drawMs = performance.now() - tDraw; PERF.cur.basePx = off.width * off.height; }
      // a drawing this slow is shown from the server's pictures next time
      if (!S.page.isTilePage && performance.now() - tDraw > 3000 && S.sheet) markSlowSheet(S.sheet.pdf);
    } catch (e) {
      freeCanvas(off);
      if (e && e.name === "RenderingCancelledException") return;
      status("Render failed: " + e.message); return;
    }
    _task = null;
    if (sheetNow !== S.sheet) { freeCanvas(off); return; }
    // the zoom may have moved on while it drew: take the size of now
    setViewport();
  }
  const [w2, h2] = applyDisplaySize();

  const c = $("#pdf");
  c.width = off.width; c.height = off.height;
  c.getContext("2d").drawImage(off, 0, 0);
  // kept, so coming back to this sheet is instant
  if (key) putBmp(key, off); else freeCanvas(off);
  c.style.width = w2 + "px";
  c.style.height = h2 + "px";
  _baseScale = bs;
  _detail = null;
  $("#page").classList.add("ready");
  renderDetail();                   // needs the page laid out, so after "ready"
  _rendered = { scale: S.scale, rotation: S.rotation, page: S.page };
  if (S.tool === "selecttext") buildTextLayer();

  $("#zoom-label").textContent = Math.round(S.scale * 100) + "%";
  redraw();
  saveSheetViewSoon();

  CMP.onPage();
  if (FIND.hits.length) paintFind(false);

  const mapped = (S.sheet.viewports || []).filter((v) => v.paper_to_model).length;
  if (S._openT0 && PERF.cur) { PERF.cur.onScreenMs = performance.now() - S._openT0; PERF.cur.drawnAhead = pre; }
  if (S._openT0) {
    console.info(`sheet ${S.sheet.number} on screen in ${Math.round(performance.now() - S._openT0)} ms`
      + (pre ? " (drawn ahead)" : ""));
    S._openT0 = 0;
  }
  status(`${S.sheet.number} - ${S.sheet.name}  |  `
    + `${S.pageMM[0].toFixed(0)} x ${S.pageMM[1].toFixed(0)} mm  |  `
    + `${mapped} mapped viewport(s)`);
}

/* The sharp overlay: only the part of the page on screen (plus a margin
   for small pans), drawn at the screen's full resolution. Needed whenever
   the whole-page canvas is softer than the screen - on a retina screen
   that is most of the time, and always when zoomed in far. */
async function renderDetail() {
  const d = $("#pdf-detail");
  if (!d || !S.page || !S.viewport) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (_baseScale >= S.scale * dpr * 0.95) { d.hidden = true; _detail = null; return; }

  const sc = $("#scroll"), pg = $("#page");
  const pr = pg.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  let x0 = Math.max(0, sr.left - pr.left), y0 = Math.max(0, sr.top - pr.top);
  let x1 = Math.min(pr.width, sr.right - pr.left), y1 = Math.min(pr.height, sr.bottom - pr.top);
  if (x1 <= x0 || y1 <= y0) { d.hidden = true; return; }
  // Already covered by what is drawn? Then nothing to do.
  const D = _detail;
  if (D && !d.hidden && D.scale === S.scale && D.rotation === S.rotation
      && x0 >= D.x0 && y0 >= D.y0 && x1 <= D.x1 && y1 <= D.y1) return;
  const mx = (x1 - x0) * 0.25, my = (y1 - y0) * 0.25;
  x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my);
  x1 = Math.min(pr.width, x1 + mx); y1 = Math.min(pr.height, y1 + my);

  let k = dpr;
  if ((x1 - x0) * (y1 - y0) * k * k > MAX_CANVAS_PX) {
    k = Math.sqrt(MAX_CANVAS_PX / ((x1 - x0) * (y1 - y0)));
  }
  if (S.scale * k <= _baseScale * 1.05) { d.hidden = true; _detail = null; return; }
  const pw = Math.ceil((x1 - x0) * k), ph = Math.ceil((y1 - y0) * k);
  const vp = S.page.getViewport({ scale: S.scale * k, rotation: S.rotation,
                                  offsetX: -x0 * k, offsetY: -y0 * k });
  const want = { scale: S.scale, rotation: S.rotation, x0, y0, x1, y1 };
  const off = document.createElement("canvas");
  off.width = pw; off.height = ph;
  if (_detailTask) { try { _detailTask.cancel(); } catch (e) {} }
  try {
    _detailTask = S.page.render({ canvasContext: off.getContext("2d"), viewport: vp });
  } catch (e) {
    // the page's document was closed under it (another sheet opening): skip
    _detailTask = null;
    return;
  }
  const tDet = performance.now();
  try {
    await _detailTask.promise;
    if (PERF.cur) { const ms = performance.now() - tDet; PERF.cur.detailMs = ms; PERF.cur.detailN = (PERF.cur.detailN || 0) + 1;
      PERF.cur.detailSum = (PERF.cur.detailSum || 0) + ms; }
  } catch (e) {
    freeCanvas(off);
    return;                       // cancelled by a newer zoom or pan
  }
  _detailTask = null;
  // Stale if the zoom changed while it was drawing.
  if (S.scale !== want.scale || S.rotation !== want.rotation) { freeCanvas(off); return; }
  d.width = pw; d.height = ph;
  d.getContext("2d").drawImage(off, 0, 0);
  freeCanvas(off);
  Object.assign(d.style, { left: x0 + "px", top: y0 + "px",
                           width: (x1 - x0) + "px", height: (y1 - y0) + "px" });
  d.hidden = false;
  _detail = want;
}

function detailSoon() {
  clearTimeout(_detailTimer);
  _detailTimer = setTimeout(renderDetail, 180);
}

function settle(delay) {
  if (_settle) clearTimeout(_settle);
  _settle = setTimeout(() => { _settle = null; renderPage(); }, delay || 160);
}

function fit() {
  if (!S.page) return;                   // a sheet still on its way
  const v1 = S.page.getViewport({ scale: 1, rotation: S.rotation });
  S.scale = Math.max(0.1, ($("#scroll").clientWidth - 40) / v1.width);
  renderPage();
}

function zoomAt(factor, clientX, clientY) {
  if (!S.page) return;
  const from = S.scale;
  const next = Math.min(12, Math.max(0.08, S.scale * factor));
  if (next === from) return;

  const r = $("#page").getBoundingClientRect();
  const fx = clientX === undefined ? r.width / 2 : clientX - r.left;
  const fy = clientY === undefined ? r.height / 2 : clientY - r.top;

  S.scale = next;
  preview();                       // instant, stretches the current bitmap

  const k = next / from;
  const sc = $("#scroll");
  sc.scrollLeft += fx * k - fx;
  sc.scrollTop += fy * k - fy;

  settle(160);                     // crisp re-render once the gesture stops
}

/* Two fingers navigate; one finger draws.
 *
 * The browser would normally handle pinch as page zoom, so touch-action is
 * disabled on the stage and the gesture is reconstructed from pointer
 * events. A second finger cancels any drawing in progress: nobody means to
 * draw with one hand while zooming with the other. */
function wireTouch() {
  const sc = $("#scroll");
  /* iOS turns a Pencil or finger resting on the page into its own
     gestures - a text selection with a Copy / Share bubble, a magnifier,
     a long-press menu - and pausing for them is part of the lag felt while
     writing. On the drawing area those are switched off at the source:
     the touch events behind them are cancelled (drawing, panning and
     pinching all run on pointer events, which still arrive). */
  const onPage = (t) => t && t.closest && t.closest("#scroll") && !t.closest("input, textarea, select, button, a, label, .textLayer, #selbar");
  sc.addEventListener("touchstart", (ev) => {
    if (S.tool === "selecttext") return;
    if (onPage(ev.target)) ev.preventDefault();
  }, { passive: false });
  sc.addEventListener("touchmove", (ev) => {
    if (S.tool === "selecttext") return;
    if (onPage(ev.target)) ev.preventDefault();
  }, { passive: false });
  document.addEventListener("selectstart", (ev) => {
    if (S.tool !== "selecttext" && onPage(ev.target)) ev.preventDefault();
  });
  sc.addEventListener("contextmenu", (ev) => {
    // the long-press menu on the page is ours (select tool), not the browser's
    if (S.lastPointer === "pen" || S.lastPointer === "touch") ev.preventDefault();
  }, true);
  // Panning exposes new parts of the page: draw them sharp once it stops.
  sc.addEventListener("scroll", () => { detailSoon(); saveSheetViewSoon(); }, { passive: true });
  addEventListener("resize", detailSoon);
  const touches = new Map();          // pointerId -> [clientX, clientY]
  let lastDist = 0, lastMid = null;

  const geom = () => {
    const pts = Array.from(touches.values());
    const [p, q] = pts;
    return {
      dist: Math.hypot(q[0] - p[0], q[1] - p[1]),
      mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
    };
  };

  /* Two-finger tap = undo, three-finger tap = redo, as in GoodNotes. A
     tap is short and does not move; a pinch or a pan never counts. */
  let tap = null;
  sc.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (touches.size === 1) tap = { t: Date.now(), max: 1, moved: 0, start: new Map() };
    if (tap) {
      tap.max = Math.max(tap.max, touches.size);
      tap.start.set(ev.pointerId, [ev.clientX, ev.clientY]);
    }
    if (touches.size === 2) {
      S.gesture = true;
      if (S.draft) {
        if (S.endPoly) S.endPoly();
        S.draft = null;
        redraw();
      }
      const g = geom();
      lastDist = g.dist;
      lastMid = g.mid;
    }
  }, true);

  sc.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "touch" || !touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (tap && tap.start.has(ev.pointerId)) {
      const s0 = tap.start.get(ev.pointerId);
      tap.moved = Math.max(tap.moved, Math.hypot(ev.clientX - s0[0], ev.clientY - s0[1]));
    }
    if (touches.size < 2) return;
    ev.preventDefault();

    const g = geom();
    if (lastDist > 0 && g.dist > 0) {
      const k = g.dist / lastDist;
      if (Math.abs(k - 1) > 0.005) zoomAt(k, g.mid[0], g.mid[1]);
    }
    if (lastMid) {
      sc.scrollLeft -= g.mid[0] - lastMid[0];
      sc.scrollTop -= g.mid[1] - lastMid[1];
    }
    lastDist = g.dist;
    lastMid = g.mid;
  }, { capture: true, passive: false });

  const lift = (ev) => {
    if (ev.pointerType !== "touch") return;
    touches.delete(ev.pointerId);
    if (touches.size < 2) {
      lastDist = 0;
      lastMid = null;
      // Keep blocking drawing until every finger is up, so the finger that
      // lifts second does not leave a stray dot.
      if (touches.size === 0) S.gesture = false;
    }
    if (touches.size === 0 && tap) {
      const quick = Date.now() - tap.t < 350 && tap.moved < 12;
      if (quick && tap.max === 2) undo();
      else if (quick && tap.max === 3) redo();
      tap = null;
    }
  };
  sc.addEventListener("pointerup", lift, true);
  sc.addEventListener("pointercancel", lift, true);
}

/* Drag to pan: middle mouse anywhere, or left mouse with the Pan tool. */
function wirePan() {
  const sc = $("#scroll");
  let on = false, sx = 0, sy = 0, l = 0, t = 0;

  sc.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) ev.preventDefault();   // stop Firefox autoscroll
  });
  sc.addEventListener("auxclick", (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });

  sc.addEventListener("pointerdown", (ev) => {
    const mid = ev.button === 1;
    // After a Pencil has been used, a single finger pans whatever the tool.
    const palm = S.penSeen && ev.pointerType === "touch"
      && DRAWING_KINDS.has(toolOf(S.tool).kind);
    if (!mid && !(S.tool === "pan" && ev.button === 0) && !palm) return;
    on = true;
    sx = ev.clientX; sy = ev.clientY;
    l = sc.scrollLeft; t = sc.scrollTop;
    sc.style.cursor = "grabbing";
    try { sc.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  });

  sc.addEventListener("pointermove", (ev) => {
    if (!on) return;
    if (S.gesture) return;            // a pinch took over from the one-finger pan
    sc.scrollLeft = l - (ev.clientX - sx);
    sc.scrollTop = t - (ev.clientY - sy);
    ev.preventDefault();
  });

  const stop = (ev) => {
    if (!on) return;
    on = false; sc.style.cursor = S.tool === "pan" ? "grab" : "";
    try { sc.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  sc.addEventListener("pointerup", stop);
  sc.addEventListener("pointercancel", stop);
}

/* ------------------------------------------------------------ dialogs */

function askText(cb, initial) {
  const back = $("#text-back");
  $("#t-body").value = initial || "";
  back.hidden = false;
  $("#t-body").focus();
  const done = (val) => {
    back.hidden = true;
    $("#t-ok").onclick = null; $("#t-cancel").onclick = null;
    cb(val);
  };
  $("#t-ok").onclick = () => done($("#t-body").value);
  $("#t-cancel").onclick = () => done(null);
}

function openIssue(item) {
  if (!$("#dialog-back").hidden && S.pendingIssueFor && S.pendingIssueFor !== item.id) {
    status("Finish or cancel the issue being written first - the new markup stays a comment.");
    return;
  }
  S.pendingIssueFor = item.id;
  $("#f-type").innerHTML = typeOptions(S.lastIssueType || "general");
  const a = item.anchor;
  let txt;
  if (!a) {
    txt = `Sheet ${item.sheet}, paper ${item.points_mm[0][0].toFixed(0)}, `
        + `${item.points_mm[0][1].toFixed(0)} mm\n`
        + "Outside any model-mapped viewport - this issue is 2D only.";
  } else if (!a.model_mm) {
    txt = `Sheet ${item.sheet}, view "${a.view_name}"\n`
        + "Viewport position was only guessed, so no model coordinate is stored.";
  } else {
    txt = `Sheet ${item.sheet}, view "${a.view_name}" (1:${a.scale})\n`
        + `Model ${a.model_mm.map((n) => n.toFixed(0)).join(", ")} mm`
        + (a.error_mm ? `  (+/-${a.error_mm.toFixed(0)} mm on paper)` : "  (exact)");
  }
  $("#f-anchor").textContent = txt;
  $("#f-title").value = ""; $("#f-desc").value = "";
  $("#dialog-back").hidden = false;
  $("#f-title").focus();
}

function saveIssue() {
  const title = $("#f-title").value.trim();
  if (!title) { $("#f-title").focus(); return; }
  const it = S.items.find((x) => x.id === S.pendingIssueFor);
  if (it) {
    if (!it.snapshot) {
      captureSheetSnapshot(it).then((shot) => {
        if (!shot) return;
        return Store.uploadSnapshot(shot).then((p) => { it.snapshot = p; return putItem(it); });
      }).catch(() => {});
    }
    it.issue = {
      guid: uid(), title: title,
      description: $("#f-desc").value.trim(),
      status: $("#f-status").value,
      priority: $("#f-priority").value,
      assigned_to: $("#f-assignee").value.trim(),
      due_date: $("#f-due").value || null,
      created_at: new Date().toISOString(),
      author: Store.author(),
      type: $("#f-type").value || "general",
    };
    S.lastIssueType = it.issue.type;
    putItem(it);
  }
  $("#dialog-back").hidden = true;
  S.pendingIssueFor = null;
  redraw(); renderList();
}

/* A new picture for an issue from the sheet as it shows now: after a copy
   is pasted onto another floor, or when the drawing has moved on. Opens
   the issue's sheet first if another one is showing. Returns true once
   item.snapshot holds the new picture (the caller saves the item). */
async function resnapSheet(item) {
  if (!item || !item.sheet) return false;
  if (!S.sheet || S.sheet.number !== item.sheet) {
    const sh = S.manifest && S.manifest.sheets.find((x) => x.number === item.sheet);
    if (!sh) return false;
    await openSheet(sh);
  }
  // wait for the page to be drawn (a sheet just opened is still rendering)
  for (let k = 0; k < 60; k++) {
    const c = $("#pdf");
    if (c && c.width && !_task && S.page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const shot = await captureSheetSnapshot(item);
  if (!shot) return false;
  item.snapshot = await Store.uploadSnapshot(shot);
  return true;
}

/* A BCF topic without a picture is much harder to act on. Sheet markups
   have no camera, but they do have a page, so a crop of the drawing around
   the markup serves the same purpose. */
const SNAP_DPI = 200, SNAP_MAX_PX = 3000;
async function captureSheetSnapshot(item) {
  try {
    const c = $("#pdf");
    if (!S.viewport || ((!c || !c.width) && !S.page)) return null;

    /* A sheet item is itself the markup: its geometry is on the item, not
       nested under a `markup` property. Reading the wrong one silently
       produced no snapshot at all. */
    const members = groupMembers(item).filter((m) => m.points_mm && m.points_mm.length);
    if (!members.length) return null;
    const allPx = [].concat(...members.map((m) => m.points_mm.map((p) => canvasFrom(p[0], p[1]))));
    const xs = allPx.map((p) => p[0]), ys = allPx.map((p) => p[1]);
    const pad = Math.max(120, 0.12 * Math.max(
      Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));

    // positions are page pixels at the current zoom (S.viewport)
    let x0 = Math.max(0, Math.min(...xs) - pad);
    let y0 = Math.max(0, Math.min(...ys) - pad);
    let x1 = Math.min(S.viewport.width, Math.max(...xs) + pad);
    let y1 = Math.min(S.viewport.height, Math.max(...ys) + pad);
    if (x1 - x0 < 60 || y1 - y0 < 60) return null;

    /* The picture is drawn afresh from the PDF at about 200 dpi (longest
       side at most 3000 px), not copied off the screen: the screen canvas
       is only as sharp as the zoom, the device's canvas limit and the
       "server pictures" mode a slow computer may be on, which is why
       issue pictures came out blurred. The screen copy is the fallback. */
    let scale = SNAP_DPI / 72 / S.scale;
    const longest = Math.max(x1 - x0, y1 - y0) * scale;
    if (longest > SNAP_MAX_PX) scale *= SNAP_MAX_PX / longest;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round((x1 - x0) * scale));
    out.height = Math.max(1, Math.round((y1 - y0) * scale));
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    let drawn = false;
    if (S.page) {
      try {
        const vp = S.page.getViewport({ scale: S.scale * scale, rotation: S.rotation,
                                        offsetX: -x0 * scale, offsetY: -y0 * scale });
        await S.page.render({ canvasContext: ctx, viewport: vp }).promise;
        drawn = true;
      } catch (e) { /* the page was closed or the render failed: use the screen */ }
    }
    if (!drawn) {
      if (!c || !c.width) return null;
      // The page canvas may be drawn smaller than it shows (see
      // MAX_CANVAS_PX): positions are page pixels, the bitmap is kb of that.
      const cssW = parseFloat(c.style.width) || c.width;
      const kb = c.width / cssW;
      scale = Math.min(1, 1400 / (x1 - x0));
      out.width = Math.round((x1 - x0) * scale);
      out.height = Math.round((y1 - y0) * scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(c, x0 * kb, y0 * kb, (x1 - x0) * kb, (y1 - y0) * kb,
                    0, 0, out.width, out.height);
    }

    // The markup itself is drawn on top, in the crop's own coordinates.
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-x0, -y0);
    for (const item of members) {
    const px = item.points_mm.map((p) => canvasFrom(p[0], p[1]));
    const st = item.style || S.style;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(1.5, st.width * pxPerMM());
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (item.type === "rect" || item.type === "textbox"
        || item.type === "callout" || item.type === "cloud") {
      const a = px[0], b = px[px.length - 1];
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                     Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    } else if (item.type === "ellipse") {
      const a = px[0], b = px[1];
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2,
                  Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2,
                  0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (px.length > 1) {
      ctx.beginPath();
      ctx.moveTo(px[0][0], px[0][1]);
      for (let i = 1; i < px.length; i++) ctx.lineTo(px[i][0], px[i][1]);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(px[0][0], px[0][1], 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    }
    ctx.restore();

    return out.toDataURL("image/jpeg", 0.85);
  } catch (e) {
    // A missing picture must not block the issue, but it should be said.
    status("Could not capture a snapshot of this markup: " + e.message);
    return null;
  }
}

/* --------------------------------------------------------------- lists */

/* Sets of sheets. The sheets published from Revit are one set (""); PDFs
   uploaded from outside go in sets of their own ("Uploaded PDFs", or a
   name given at upload), each its own entry in the header's drop-down, so
   they do not pile up under the drawings from the model. They stay in the
   same project: markups, issues, search and compare work across sets. */
const PDF_SET = "Uploaded PDFs";
const sheetSet = (s) => (s && s.external ? (s.set || PDF_SET) : "");
const setNames = () => [...new Set(S.manifest.sheets.filter((s) => s.external).map(sheetSet))];
const setSheets = () => S.manifest.sheets.filter((s) => sheetSet(s) === S.set);

function pickSet(want) {
  const names = setNames();
  const hasRevit = S.manifest.sheets.some((s) => !s.external);
  S.set = want && names.includes(want) ? want : hasRevit || !names.length ? "" : names[0];
}

/* Show another set (the drop-down, or a sheet of another set opened from
   an issue or a link). */
function showSet(name, keepSheet) {
  pickSet(name);
  const url = new URL(location.href);
  if (S.set) url.searchParams.set("set", S.set); else url.searchParams.delete("set");
  window.history.replaceState(null, "", url.toString());   // (app.js has a history of its own: undo)
  renderSheets();
  sheetSets(setNames(), S.set, (n) => showSet(n));
  if (!keepSheet) {
    const first = setSheets()[0];
    if (first && (!S.sheet || sheetSet(S.sheet) !== S.set)) openSheet(first);
  }
}

function renderSheets() {
  const ul = $("#sheet-list"); ul.innerHTML = "";
  const list = setSheets();
  const tot = document.getElementById("sheet-total");
  if (tot) tot.textContent = list.length;
  const lab = document.getElementById("sheet-set");
  if (lab) { lab.textContent = S.set || ""; lab.hidden = !S.set; }
  for (const s of list) {
    const vps = s.viewports || [];
    const mapped = vps.filter((v) => v.paper_to_model).length;
    const li = document.createElement("li");
    li.dataset.num = s.number;
    li.innerHTML = `<div class="num">${s.number}</div>`
      + `<div class="nm">${s.name || ""}</div>`
      + (s.external
        // An imported drawing has no link to the model: say so plainly,
        // because issues raised on it will be 2D only.
        ? `<div class="tags"><span class="ext-tag">Imported</span> 2D only`
          + (s.page > 1 ? ` &middot; page ${s.page}` : "")
          + `<button class="ghost ext-del" title="Remove this imported sheet">&#10005;</button></div>`
        : `<div class="tags">${mapped}/${vps.length} mapped`
          + (s.pdf ? "" : " &middot; no PDF") + "</div>");
    li.addEventListener("click", () => openSheet(s));
    // pointing at a sheet starts reading its PDF (computers)
    if (s.pdf) li.addEventListener("mouseenter", () => {
      if (IS_IOS_EARLY() || slowLine() || drawMode() === "tiles") return;
      const m = _tileMeta.get(s.pdf + "|" + (s.page || 1));
      if (m && (m.pdf_bytes || 0) > 6e6) return;     // shown from pictures: no need
      getDoc(s.pdf).catch(() => {});
    });
    const del = li.querySelector(".ext-del");
    if (del) del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeImportedSheet(s);
    });
    ul.appendChild(li);
  }
}

/* How the list is arranged. Sheet first, because that is how a set of
   drawings is navigated; the others exist because "show me everything
   assigned to me" and "show me what is still open" are the two questions
   people actually ask a list of issues. */
const GROUPERS = {
  sheet: { label: "Sheet", of: (it) => it.sheet || "No sheet" },
  status: { label: "Status",
            of: (it) => (it.issue && it.issue.status) || "Comment" },
  author: { label: "Raised by", of: (it) => it.author || "Unknown" },
  assignee: { label: "Assigned to",
              of: (it) => (it.issue && it.issue.assigned_to) || "Unassigned" },
  view: { label: "View",
          of: (it) => (it.anchor && it.anchor.view_name) || "Not in a view" },
  issuetype: { label: "Issue type",
               of: (it) => it.issue ? typeOf(it).label : "Comment" },
  type: { label: "Markup type", of: (it) => it.type || "Issue" },
  none: { label: "No grouping", of: () => "All" },
};

const STATUS_CLASS = {
  "Open": "open", "In progress": "progress",
  "Resolved": "resolved", "Closed": "closed",
};

const closedGroups = new Set();

function matchesSearch(it, q) {
  if (!q) return true;
  const hay = [
    it.issue && it.issue.title, it.issue && it.issue.description,
    it.issue && it.issue.assigned_to, it.text, it.sheet, it.author,
    it.anchor && it.anchor.view_name,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.indexOf(q.toLowerCase()) >= 0;
}

/* A list card says only enough to pick the issue out: number, title (cut
   short), type, who raised it, when, and its status. Everything else is one
   tap away in the issue itself - the list used to take a third of an iPad
   screen away from the drawing. */
/* resolved, closed or marked not an issue: what "Hide closed" leaves out */
function issueDone(it) {
  const iss = it && it.issue;
  if (!iss) return false;
  return !!iss.dismissed || iss.status === "Resolved" || iss.status === "Closed";
}

function cardHtml(it, n) {
  const iss = it.issue;
  const status = iss ? (iss.status || "Open") : "Comment";
  const cls = iss ? (STATUS_CLASS[status] || "open") : "comment";
  const label = esc(iss ? (iss.title || "Issue")
    : (it.text || ((MK.TOOLS.find((t) => t.id === it.type) || {}).label || "Markup")));
  const color = iss ? typeColor(it) : "#9ca3af";
  const when = shortDate((iss && iss.created_at) || it.created_at);
  const who = esc((iss && iss.author) || it.author || "");
  const msgs = iss ? (iss.comments || []).filter((c) => c && !c.deleted) : [];
  const openQ = msgs.filter((c) => c.kind === "query" && !c.resolved).length;
  const talk = msgs.length ? `<span class="talk${openQ ? " q" : ""}" title="${msgs.length} message(s) in the discussion`
    + `${openQ ? ", " + openQ + " open query" : ""}">&#128172; ${msgs.length}${openQ ? " ?" + openQ : ""}</span>` : "";
  const bits = [iss ? typeOf(it).label : "Comment", who, when].filter(Boolean).join(" &middot; ") + (talk ? " " + talk : "");
  return `<div class="card compact" title="${label}">`
    + `<span class="pin" style="background:${color}">${iss ? n : "&middot;"}</span>`
    + `<div class="body"><div class="t">${label}</div>`
    + `<div class="tline">${bits}</div></div>`
    + `<span class="chip ${cls}">${status}</span></div>`;
}

/* The status filter: a status, or a family of them, or "has a query
   waiting for an answer". Shared with the 3D page's list. */
function statusMatches(iss, f) {
  const stt = iss.status || "Open";
  if (f === "open-any") return stt === "Open" || stt === "In progress";
  if (f === "done-any") return stt === "Resolved" || stt === "Closed";
  if (f === "query") return (iss.comments || []).some((c) => c && c.kind === "query" && !c.resolved && !c.deleted);
  return stt === f;
}

function renderList() {
  try { renderLayerPick(); } catch (e) {}
  const ul = $("#item-list");
  ul.innerHTML = "";

  const groupBy = ($("#group-by") || {}).value || "sheet";
  const q = (($("#item-search") || {}).value || "").trim();
  const grouper = GROUPERS[groupBy] || GROUPERS.sheet;
  const fType = ($("#flt-type") || {}).value || "";
  const fStatus = ($("#flt-status") || {}).value || "";
  const sortBy = ($("#sort-by") || {}).value || "number";

  // Issue numbers stay stable whatever the grouping or filter, so a number
  // quoted in a meeting still refers to the same issue afterwards.
  const numbers = new Map();
  let n = 0;
  // The server numbers issues for good (#23 is #23 everywhere); counting
  // is only the fallback for a server that does not yet.
  for (const it of S.items) if (it.issue) numbers.set(it.id, it.issue.number || ++n);

  const shown = S.items.filter((it) => {
    // Issues raised in the model and saved views live on the 3D page.
    // 3D issues, saved views and project settings live on the 3D page.
    if (it.placement === "3d" || it.placement === "view" || it.placement === "calibration" || it.placement === "clashrule" || it.placement === "checkcfg") return false;
    if (S.filter === "issue" && !it.issue) return false;
    if (S.filter === "comment" && it.issue) return false;
    // type and status: issues only (a comment has neither)
    if (fType && (!it.issue || typeOf(it).id !== fType)) return false;
    if (fStatus) {
      const stt = it.issue && (it.issue.status || "Open");
      if (!it.issue) return false;
      if (!statusMatches(it.issue, fStatus)) return false;
    }
    return matchesSearch(it, q);
  });

  /* The total is counted within the current filter: with Issues selected
     it counts issues, not issues plus every comment on the drawings. */
  const pool = S.items.filter((it) =>
    it.placement !== "3d" && it.placement !== "view" && it.placement !== "calibration" && it.placement !== "clashrule" && it.placement !== "checkcfg").filter((it) =>
    S.filter === "issue" ? !!it.issue
    : S.filter === "comment" ? !it.issue : true);
  $("#issue-total").textContent =
    shown.length + (shown.length === pool.length ? "" : " of " + pool.length);

  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = S.items.length
      ? "Nothing matches this filter."
      : "No comments or issues yet. Draw on a sheet to make one.";
    ul.appendChild(li);
    redraw();
    return;
  }

  const groups = new Map();
  for (const it of shown) {
    const k = grouper.of(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const PRI = { Critical: 0, High: 1, Normal: 2, Low: 3 };
  const when = (it) => (it.issue && it.issue.created_at) || it.created_at || "";
  const sorters = {
    number: (a, b) => (numbers.get(a.id) || 1e9) - (numbers.get(b.id) || 1e9) || String(when(a)).localeCompare(String(when(b))),
    newest: (a, b) => String(when(b)).localeCompare(String(when(a))),
    oldest: (a, b) => String(when(a)).localeCompare(String(when(b))),
    due: (a, b) => String((a.issue && a.issue.due_date) || "9999").localeCompare(String((b.issue && b.issue.due_date) || "9999")),
    priority: (a, b) => (PRI[a.issue && a.issue.priority] ?? 5) - (PRI[b.issue && b.issue.priority] ?? 5),
    type: (a, b) => (a.issue ? typeOf(a).label : "~").localeCompare(b.issue ? typeOf(b).label : "~"),
    title: (a, b) => String((a.issue && a.issue.title) || a.text || "").localeCompare(String((b.issue && b.issue.title) || b.text || "")),
  };
  for (const key of Array.from(groups.keys()).sort()) {
    const rows = groups.get(key).slice().sort(sorters[sortBy] || sorters.number);
    if (groupBy !== "none") {
      const head = document.createElement("li");
      const closed = closedGroups.has(key);
      head.className = "grp-head" + (closed ? " closed" : "");
      head.innerHTML = `<span class="caret">${iconSvg("polyline", 0) || ""}`
        + "&#9662;</span>" + key
        + `<span class="count">${rows.length}</span>`;
      head.addEventListener("click", () => {
        if (closedGroups.has(key)) closedGroups.delete(key);
        else closedGroups.add(key);
        renderList();
      });
      ul.appendChild(head);
      if (closed) continue;
    }

    for (const it of rows) {
      const li = document.createElement("li");
      li.className = S.sel.indexOf(it.id) >= 0 ? "sel" : "";
      li.innerHTML = cardHtml(it, numbers.get(it.id));
      const jump = () => {
        const sh = S.manifest.sheets.find((s) => s.number === it.sheet);
        if (sh && sh !== S.sheet) return openSheet(sh).then(() => select([it.id], false));
        select([it.id], false);
        return Promise.resolve();
      };
      const open = () => {
        // A comment is just a drawing: go to it. An issue has things to
        // read and decide, so it opens in full.
        if (!it.issue) { jump(); return; }
        openIssueDetail(it, {
          latest: () => Store.all().find((x) => x.id === it.id),
          number: numbers.get(it.id),
          author: Store.author(),
          onUpload: (dataUrl) => Store.uploadSnapshot(dataUrl),
          onSave: async (item) => { await putItem(item); renderList(); },
          onDelete: async (item) => {
            await Store.remove(item.id).catch((e) => status(e.message));
            S.items = Store.all(); redraw(); renderList();
          },
          onJump: jump,
          onShow3D: show3D,
          onResnap: resnapSheet, resnapHint: "Take the picture again from the sheet as it shows now (e.g. after pasting a copy onto another floor)",
        });
      };
      li.addEventListener("click", open);
      li.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        openMenu(ev.clientX, ev.clientY, listMenu(it, open, jump));
      });
      ul.appendChild(li);
    }
  }
  redraw();
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* The right-click menu of an issue or comment in the list: the everyday
   actions without opening anything first. */
function listMenu(it, open, jump) {
  const iss = it.issue;
  const save = async (why) => {
    await putItem(it);
    redraw(); renderList();
    if (why) status(why);
  };
  const setStatus = (st) => async () => {
    iss.status = st;
    await save(`${iss.title || "Issue"}: ${st}.`);
  };
  const entries = [
    { label: iss ? "Open issue" : "Go to comment", action: open },
    { label: "Show on sheet", action: jump },
    { label: "Show in 3D", disabled: !(it.anchor && it.anchor.model_mm), action: () => show3D(it) },
    "-",
  ];
  if (!iss) {
    entries.push({ label: "Raise issue", action: () => jump().then(() => $("#a-issue").click()) });
  } else {
    const st = iss.status || "Open";
    if (st !== "In progress") entries.push({ label: "Mark in progress", action: setStatus("In progress") });
    if (st !== "Resolved") entries.push({ label: "Mark resolved", action: setStatus("Resolved") });
    if (st === "Resolved" || st === "Closed") entries.push({ label: "Reopen", action: setStatus("Open") });
    if (!iss.dismissed) {
      entries.push({ label: "Not an issue...", action: async () => {
        const reason = prompt("Why is this not an issue? The person who raised it will see this.");
        if (!reason || !reason.trim()) return;
        iss.dismissed = { by: Store.author() || "?", at: new Date().toISOString(), reason: reason.trim() };
        iss.status = "Closed";
        await save("Marked not an issue.");
      } });
    }
  }
  entries.push("-",
    { label: "Copy", key: "Ctrl+C", action: () => {
      S.clip = [JSON.parse(JSON.stringify(it))];
      status("Copied. Paste it on any sheet with Ctrl+V.");
    } },
    { label: "Delete", action: () => {
      if (confirm(`Delete ${iss ? "issue \"" + (iss.title || "") + "\"" : "this comment"}?`)) removeItems([it.id]);
    } });
  return entries;
}

/* ------------------------------------------------------------ split view */

/* A second sheet beside the first, for reading page 1 against page 30.
   The right pane is for looking, not drawing: two editable canvases would
   need two sets of tools, two selections and a rule for which one a key
   press belongs to, and the question it answers is always "what does the
   other sheet say here". Its markups are drawn by the same renderer as the
   main pane, pointed at its own viewport for the moment it draws. */
const SP = { sheet: null, page: null, viewport: null, scale: 1, task: null };

async function openSplitSheet(sheet) {
  if (!sheet || !sheet.pdf) return;
  SP.sheet = sheet;
  SP.base = null;
  $("#split-status").textContent = "Loading " + sheet.number + " ...";
  try {
    SP.page = await pageFor(sheet);                // PDFs shared with the main pane
  } catch (e) {
    $("#split-status").textContent = "Could not open " + sheet.number;
    return;
  }
  fitSplit();
}

function fitSplit() {
  if (!SP.page) return;
  const v1 = SP.page.getViewport({ scale: 1 });
  const box = $("#split-scroll").getBoundingClientRect();
  SP.scale = Math.max(0.05, Math.min((box.width - 20) / v1.width,
                                     (box.height - 20) / v1.height));
  renderSplit();
}

/* The split pane works like the main one: the whole sheet is drawn once,
   zooming only stretches it (so the view never jumps while a drawing is
   being made), and the part on screen is drawn sharp once zooming stops. */
function splitSize() {
  SP.viewport = SP.page.getViewport({ scale: SP.scale, rotation: 0 });
  const w = Math.round(SP.viewport.width), h = Math.round(SP.viewport.height);
  const c = $("#split-pdf");
  c.style.width = w + "px"; c.style.height = h + "px";
  $("#split-page").style.width = w + "px";
  $("#split-page").style.height = h + "px";
  return [w, h];
}
async function renderSplit() {
  if (!SP.page) return;
  splitSize();
  const d = $("#split-detail");
  if (d) d.hidden = true;
  if (!SP.base || SP.base.page !== SP.page) {
    const page = SP.page;
    const v1 = page.getViewport({ scale: 1 });
    const bs = Math.min(3, Math.sqrt((IS_IOS ? 5e6 : 10e6) / Math.max(1, v1.width * v1.height)));
    const vp = page.getViewport({ scale: bs, rotation: 0 });
    const off = document.createElement("canvas");
    off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    if (SP.task) { try { SP.task.cancel(); } catch (e) {} }
    SP.task = page.render({ canvasContext: off.getContext("2d"), viewport: vp });
    try { await SP.task.promise; } catch (e) { freeCanvas(off); return; }
    if (page !== SP.page) { freeCanvas(off); return; }
    const c = $("#split-pdf");
    c.width = off.width; c.height = off.height;
    c.getContext("2d").drawImage(off, 0, 0);
    freeCanvas(off);
    SP.base = { page, scale: bs };
  }
  drawSplitMarkups();
  $("#split-status").textContent = SP.sheet.number + "  " + Math.round(SP.scale * 100) + "%";
  splitDetailSoon();
}
let _spDetailT = null, _spDetailTask = null;
function splitDetailSoon() { clearTimeout(_spDetailT); _spDetailT = setTimeout(renderSplitDetail, 220); }
async function renderSplitDetail() {
  const d = $("#split-detail");
  if (!d || !SP.page || !SP.base) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (SP.base.scale >= SP.scale * dpr * 0.95) { d.hidden = true; return; }
  const sc = $("#split-scroll"), pg = $("#split-page");
  const pr = pg.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  const x0 = Math.max(0, sr.left - pr.left), y0 = Math.max(0, sr.top - pr.top);
  const x1 = Math.min(pr.width, sr.right - pr.left), y1 = Math.min(pr.height, sr.bottom - pr.top);
  if (x1 <= x0 || y1 <= y0) return;
  const k = Math.min(dpr, Math.sqrt(MAX_CANVAS_PX / ((x1 - x0) * (y1 - y0))));
  const want = SP.scale;
  const vp = SP.page.getViewport({ scale: SP.scale * k, rotation: 0, offsetX: -x0 * k, offsetY: -y0 * k });
  const off = document.createElement("canvas");
  off.width = Math.ceil((x1 - x0) * k); off.height = Math.ceil((y1 - y0) * k);
  if (_spDetailTask) { try { _spDetailTask.cancel(); } catch (e) {} }
  _spDetailTask = SP.page.render({ canvasContext: off.getContext("2d"), viewport: vp });
  try { await _spDetailTask.promise; } catch (e) { freeCanvas(off); return; }
  if (want !== SP.scale) { freeCanvas(off); return; }
  d.width = off.width; d.height = off.height;
  d.getContext("2d").drawImage(off, 0, 0);
  freeCanvas(off);
  Object.assign(d.style, { left: x0 + "px", top: y0 + "px", width: (x1 - x0) + "px", height: (y1 - y0) + "px" });
  d.hidden = false;
}

function drawSplitMarkups() {
  const svg = $("#split-svg");
  const w = Math.round(SP.viewport.width), h = Math.round(SP.viewport.height);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // Borrow the main renderer for one draw, then put everything back.
  const saved = { sheet: S.sheet, page: S.page, viewport: S.viewport,
                  sel: S.sel, draft: S.draft };
  S.sheet = SP.sheet; S.page = SP.page; S.viewport = SP.viewport;
  S.sel = []; S.draft = null;
  try { redraw(svg); }
  finally {
    S.sheet = saved.sheet; S.page = saved.page; S.viewport = saved.viewport;
    S.sel = saved.sel; S.draft = saved.draft;
  }
}

function toggleSplit(on) {
  const want = on === undefined ? $("#split-pane").hidden : on;
  $("#split-pane").hidden = !want;
  $("#stage-row").classList.toggle("split", want);
  $("#split-toggle").classList.toggle("active", want);
  if (want) SYNC.toggle(false);
  if (want) {
    const sel = $("#split-sheet");
    if (!sel.options.length) {
      for (const s of S.manifest.sheets) {
        const o = document.createElement("option");
        o.value = s.number;
        o.textContent = s.number + "  " + (s.name || "");
        sel.appendChild(o);
      }
    }
    // Start on the sheet after the current one: the usual reason to split.
    const list = S.manifest.sheets;
    const i = S.sheet ? list.indexOf(S.sheet) : -1;
    const pick = SP.sheet || list[Math.min(list.length - 1, i + 1)] || list[0];
    sel.value = pick.number;
    openSplitSheet(pick);
  }
  /* The main pane changed width: it keeps its zoom and the same point in
     the middle (it used to fit the whole sheet again - a zoom out). */
  if (S.page && S.viewport) {
    const sc = $("#scroll");
    const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
    const mid = paperFrom(R.left + R.width / 2 - P.left, R.top + R.height / 2 - P.top);
    setTimeout(() => {
      if (!S.page) return;
      const a = canvasFrom(mid[0], mid[1]);
      const P2 = $("#page").getBoundingClientRect(), R2 = sc.getBoundingClientRect();
      sc.scrollLeft += (P2.left - R2.left) + a[0] - sc.clientWidth / 2;
      sc.scrollTop += (P2.top - R2.top) + a[1] - sc.clientHeight / 2;
      detailSoon();
    }, 30);
  }
}

function sheetPerfReport() {
  const mb = (b) => b ? (b / 1048576).toFixed(1) + " MB" : "?";
  const sec = (ms) => ms === undefined ? "-" : (ms / 1000).toFixed(1) + " s";
  const L = [];
  L.push(`LWK viewer sheets performance - ${Store.currentProject() || ""} - ${new Date().toLocaleString()}`);
  L.push(`Browser: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, "")}`);
  L.push(`Screen: ${innerWidth} x ${innerHeight} @${devicePixelRatio}x   memory ${navigator.deviceMemory || "?"} GB, ${navigator.hardwareConcurrency || "?"} cores`);
  const conn = navigator.connection;
  if (conn && conn.downlink) L.push(`Network estimate: ${conn.downlink} Mbit/s, ${conn.effectiveType || ""}`);
  if (performance.memory) L.push(`JavaScript memory: ${mb(performance.memory.usedJSHeapSize)}`);
  L.push(`Open drawings kept: ${_docs.size} of ${DOC_KEEP}; sheet pictures kept: ${_bmps.size} of ${BMP_KEEP}`);
  L.push(`Drawing: ${drawMode()}${slowLine() ? " (slow line detected: big sheets from the server's pictures)" : ""}; `
    + `this sheet from ${S.page ? (S.page.isTilePage ? "the server's pictures" : "its PDF") : "-"}`);
  L.push(`Server pictures: ${tileStats.fetched} fetched (${mb(tileStats.bytes)}, avg ${tileStats.fetched ? Math.round(tileStats.ms / tileStats.fetched) : 0} ms), `
    + `${tileStats.hits} reused, ${tileStats.failed} failed` + (PERF.tileNote ? `; note: ${PERF.tileNote}` : ""));
  L.push("");
  L.push("Sheets (file size; opened; on screen; whole-sheet drawing; sharp part at the last zoom, average):");
  const rows = [...PERF.sheets.values()].sort((a, b) => (b.t0 || 0) - (a.t0 || 0));
  for (const p of rows) {
    L.push(`  ${p.number} ${p.name}`);
    L.push(`    ${p.how ? "from " + p.how + "; " : ""}${mb(p.bytes)}; opened ${p.opens}x${p.cached ? " (already open)" : ""}; read ${sec(p.loadMs)}; on screen ${sec(p.onScreenMs)}${p.drawnAhead ? " (drawn ahead)" : ""}; `
      + `whole sheet ${sec(p.drawMs)}${p.basePx ? ` at ${(p.basePx / 1e6).toFixed(1)} Mpx` : ""}; sharp part ${sec(p.detailMs)}`
      + (p.detailN ? ` (avg ${sec(p.detailSum / p.detailN)} over ${p.detailN})` : ""));
  }
  if (!rows.length) L.push("  (no sheet opened yet)");
  return L.join("\n");
}
/* The Files window: the header's downloads and imports in one place. */
function wireFilesMenu() {
  const back = document.getElementById("files-back"), btn = document.getElementById("files-btn");
  if (!back || !btn) return;
  const close = () => { back.hidden = true; };
  btn.addEventListener("click", () => { back.hidden = !back.hidden; });
  document.getElementById("files-close").addEventListener("click", close);
  back.addEventListener("pointerdown", (ev) => { if (ev.target === back) close(); });
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !back.hidden) close(); });
  back.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    close();
    const go = b.dataset.go;
    if (go === "bcf-3d") { location.href = Store.pageUrl("model.html") + (Store.pageUrl("model.html").includes("?") ? "&" : "?") + "importbcf=1"; return; }
    const t = document.getElementById(go);
    if (t) t.click();
  }));
}

function wireSheetPerf() {
  const open = document.getElementById("sheet-perf-open");
  const panel = document.getElementById("sheet-perf-panel");
  if (!open || !panel) return;
  const paint = () => { document.getElementById("sheet-perf-text").textContent = sheetPerfReport(); };
  open.addEventListener("click", (ev) => { ev.preventDefault(); panel.hidden = !panel.hidden; if (!panel.hidden) paint(); });
  document.getElementById("sheet-perf-close").addEventListener("click", () => { panel.hidden = true; });
  document.getElementById("sheet-perf-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(sheetPerfReport()); status("Performance report copied - paste it into a message."); }
    catch (e) { status("Could not copy - select the text and copy it by hand."); }
  });
  setInterval(() => { if (!panel.hidden) paint(); }, 2000);
  const sel = document.getElementById("sheet-draw");
  if (sel) {
    sel.value = drawMode() === "auto" ? "" : drawMode();
    sel.addEventListener("change", () => {
      try { if (sel.value) localStorage.setItem("lwk.sheetDraw", sel.value); else localStorage.removeItem("lwk.sheetDraw"); } catch (e) {}
      status("Saved - the next sheet you open uses it.");
      if (S.sheet) openSheet(S.sheet);
    });
  }
  // a live line in the status bar, as on the 3D page
  const live = document.getElementById("sheet-perf-live");
  if (live) setInterval(() => {
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "";
    const how = S.page ? (S.page.isTilePage ? "pictures" : "PDF") : "";
    live.textContent = [how, heap].filter(Boolean).join(" · ");
  }, 2000);
}

function wireSplit() {
  $("#split-toggle").addEventListener("click", () => toggleSplit());
  $("#split-sheet").addEventListener("change", () => {
    const s = S.manifest.sheets.find((x) => x.number === $("#split-sheet").value);
    openSplitSheet(s);
  });
  $("#split-fit").addEventListener("click", fitSplit);
  const zoomSplit = (k) => {
    if (!SP.page) return;
    const sc = $("#split-scroll");
    const cx = sc.scrollLeft + sc.clientWidth / 2, cy = sc.scrollTop + sc.clientHeight / 2;
    SP.scale = Math.max(0.05, Math.min(10, SP.scale * k));
    splitSize();
    sc.scrollLeft = cx * k - sc.clientWidth / 2; sc.scrollTop = cy * k - sc.clientHeight / 2;
    renderSplit();
  };
  $("#split-in").addEventListener("click", () => zoomSplit(1.25));
  $("#split-out").addEventListener("click", () => zoomSplit(1 / 1.25));
  $("#split-close").addEventListener("click", () => toggleSplit(false));

  // Wheel zooms the right pane about the pointer, like the main one.
  const sc = $("#split-scroll");
  sc.addEventListener("wheel", (ev) => {
    if (!SP.page) return;
    ev.preventDefault();
    const r = $("#split-page").getBoundingClientRect();
    const fx = ev.clientX - r.left, fy = ev.clientY - r.top;
    const from = SP.scale;
    SP.scale = Math.max(0.05, Math.min(10, SP.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const k = SP.scale / from;
    // the page is resized and scrolled in the same moment, so the point
    // under the pointer stays put (it used to jump back after each draw)
    splitSize();
    sc.scrollLeft += fx * k - fx;
    sc.scrollTop += fy * k - fy;
    renderSplit();
  }, { passive: false });
  sc.addEventListener("scroll", splitDetailSoon, { passive: true });

  // Drag to pan.
  let drag = null;
  sc.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, l: sc.scrollLeft, t: sc.scrollTop };
    sc.setPointerCapture(ev.pointerId);
    sc.style.cursor = "grabbing";
  });
  sc.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    sc.scrollLeft = drag.l - (ev.clientX - drag.x);
    sc.scrollTop = drag.t - (ev.clientY - drag.y);
  });
  const end = () => { drag = null; sc.style.cursor = "grab"; };
  sc.addEventListener("pointerup", end);
  sc.addEventListener("pointercancel", end);
}

/* ------------------------------------------------------------ PDF export */

/* Each sheet is rendered by pdf.js at print resolution, its markups are
   drawn on top, and the result is wrapped as one page of a PDF at the
   sheet's true paper size.

   The markups are drawn by the same renderer as on screen - the page is
   pointed at a viewport of the export size and redrawn - so what prints is
   exactly what the reviewer saw, not a second approximation of it. The
   overlay is SVG, so it scales to the export resolution without losing
   sharpness. The drawing itself is rasterised: merging vector PDFs needs a
   PDF library, and none is available offline. At 150 dpi an A1 sheet is
   crisp enough to read every dimension. */
async function renderSheetForPdf(sheet, dpi) {
  const doc = await pdfjsLib.getDocument(Store.dataUrl(sheet.pdf)).promise;
  const page = await doc.getPage(sheet.page || 1);
  const v1 = page.getViewport({ scale: 1 });

  // Cap the longest side: an A0 at full resolution would not fit in memory
  // on a laptop, and nobody reads a sheet at more than this.
  let scale = dpi / 72;
  const longest = Math.max(v1.width, v1.height) * scale;
  if (longest > 7200) scale *= 7200 / longest;

  const vp = page.getViewport({ scale: scale, rotation: 0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  // Draw this sheet's markups at the export viewport.
  const saved = { sheet: S.sheet, page: S.page, viewport: S.viewport,
                  sel: S.sel, hide: S.hideMarkups, done: S.hideDone, draft: S.draft };
  S.sheet = sheet; S.page = page; S.viewport = vp;
  S.sel = []; S.hideMarkups = false; S.hideDone = false; S.draft = null;
  const svg = $("#overlay");
  const prevW = svg.getAttribute("width"), prevH = svg.getAttribute("height");
  svg.setAttribute("width", canvas.width);
  svg.setAttribute("height", canvas.height);
  svg.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  redraw();

  const markup = svg.cloneNode(true);
  markup.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Hand-drawn images must be inline: an SVG drawn as a picture cannot
  // fetch anything, so a linked snapshot would simply be missing.
  await inlineImages(markup);

  Object.assign(S, { sheet: saved.sheet, page: saved.page,
                     viewport: saved.viewport, sel: saved.sel,
                     hideMarkups: saved.hide, hideDone: saved.done, draft: saved.draft });
  svg.setAttribute("width", prevW);
  svg.setAttribute("height", prevH);
  svg.setAttribute("viewBox", `0 0 ${prevW} ${prevH}`);
  redraw();

  const xml = new XMLSerializer().serializeToString(markup);
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("markup layer failed to draw"));
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpeg = await new Promise((res) => canvas.toBlob(
    (b) => b.arrayBuffer().then((buf) => res(new Uint8Array(buf))),
    "image/jpeg", 0.88));
  return { jpeg: jpeg, px: [canvas.width, canvas.height],
           pt: [v1.width, v1.height] };
}

async function inlineImages(svgRoot) {
  for (const im of svgRoot.querySelectorAll("image")) {
    const href = im.getAttribute("href") || im.getAttribute("xlink:href");
    if (!href || href.startsWith("data:")) continue;
    try {
      const blob = await (await fetch(href)).blob();
      const data = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      im.setAttribute("href", data);
    } catch (e) { /* a missing picture must not stop the export */ }
  }
}

/* ------------------------------------------------ vector-preserving PDF */

/* The markups of one sheet as a transparent picture the size of the page.
   The drawing itself is NOT in it: the original page is copied into the
   output untouched, so its lines stay lines and its text stays text, and
   only the markups are laid over the top. */
async function markupLayer(sheet, bytes, dpi) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(sheet.page || 1);
  let scale = dpi / 72;
  const v1 = page.getViewport({ scale: 1, rotation: 0 });
  const longest = Math.max(v1.width, v1.height) * scale;
  if (longest > 9000) scale *= 9000 / longest;
  const vp = page.getViewport({ scale: scale, rotation: 0 });
  const w = Math.round(vp.width), h = Math.round(vp.height);

  const saved = { sheet: S.sheet, page: S.page, viewport: S.viewport,
                  sel: S.sel, hide: S.hideMarkups, done: S.hideDone, draft: S.draft };
  const svg = $("#overlay");
  const prev = [svg.getAttribute("width"), svg.getAttribute("height")];
  S.sheet = sheet; S.page = page; S.viewport = vp;
  S.sel = []; S.hideMarkups = false; S.hideDone = false; S.draft = null;
  svg.setAttribute("width", w); svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  redraw();
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  await inlineImages(clone);
  Object.assign(S, { sheet: saved.sheet, page: saved.page,
                     viewport: saved.viewport, sel: saved.sel,
                     hideMarkups: saved.hide, hideDone: saved.done, draft: saved.draft });
  svg.setAttribute("width", prev[0]); svg.setAttribute("height", prev[1]);
  svg.setAttribute("viewBox", `0 0 ${prev[0]} ${prev[1]}`);
  redraw();

  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("markup layer failed to draw"));
    im.src = "data:image/svg+xml;charset=utf-8,"
      + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  });
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);      // transparent ground
  const png = await new Promise((res) => c.toBlob(
    (b) => b.arrayBuffer().then((buf) => res(new Uint8Array(buf))), "image/png"));
  return png;
}

/* ------------------------------------------------------ issue report */

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    // Break at spaces where there are any; Chinese has none, so fall back
    // to breaking between characters.
    const tokens = /\s/.test(para) ? para.split(/(\s+)/) : Array.from(para);
    for (const t of tokens) {
      if (ctx.measureText(line + t).width > maxW && line) {
        out.push(line.trimEnd()); line = t.trimStart();
      } else line += t;
    }
    out.push(line);
  }
  return out;
}

async function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

/* Report pages, A4 portrait. Drawn on a canvas with the browser's own text
   rendering: the fonts built into PDF cover Latin only, and an issue titled
   in Chinese would otherwise fail the whole export. */
async function reportPages(entries, title) {
  const PT = [595.28, 841.89];                 // A4 in points
  const K = 2.4;                               // canvas pixels per point
  const W = Math.round(PT[0] * K), H = Math.round(PT[1] * K);
  const M = 36 * K, colW = W - 2 * M;
  const pages = [];
  let c, ctx, y;

  const newPage = () => {
    c = document.createElement("canvas");
    c.width = W; c.height = H;
    ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f28022"; ctx.fillRect(0, 0, W, 10 * K);
    ctx.fillStyle = "#1f2430"; ctx.font = `700 ${13 * K}px Segoe UI, Arial, sans-serif`;
    ctx.fillText(title + " - issue report", M, 34 * K);
    ctx.fillStyle = "#6b7480"; ctx.font = `${8 * K}px Segoe UI, Arial, sans-serif`;
    ctx.fillText("Exported " + new Date().toLocaleString() + " by "
      + (Store.author() || "unknown"), M, 48 * K);
    y = 64 * K;
  };
  const finish = async () => {
    ctx.fillStyle = "#9ca3af"; ctx.font = `${7.5 * K}px Segoe UI, Arial, sans-serif`;
    ctx.fillText("Page " + (pages.length + 1), W - M - 40 * K, H - 18 * K);
    const jpg = await new Promise((res) => c.toBlob(
      (b) => b.arrayBuffer().then((buf) => res(new Uint8Array(buf))), "image/jpeg", 0.9));
    pages.push({ jpeg: jpg, pt: PT });
  };

  newPage();

  // Summary: how many, in what state, of what kind.
  const all = entries.map((e) => e.it);
  const by = (f) => all.reduce((m, it) => { const k = f(it); m[k] = (m[k] || 0) + 1; return m; }, {});
  const sum = [
    ["Issues", String(all.length)],
    ["By status", Object.entries(by((it) => it.issue.status || "Open")).map(([k, v]) => k + " " + v).join(",  ")],
    ["By type", Object.entries(by((it) => typeOf(it).label)).map(([k, v]) => k + " " + v).join(",  ")],
  ];
  ctx.font = `${9 * K}px Segoe UI, Arial, sans-serif`;
  for (const [k, v] of sum) {
    ctx.fillStyle = "#6b7480"; ctx.fillText(k, M, y);
    ctx.fillStyle = "#1f2430";
    for (const ln of wrapLines(ctx, v, colW - 90 * K)) { ctx.fillText(ln, M + 90 * K, y); y += 13 * K; }
  }
  y += 10 * K;

  for (const e of entries) {
    const it = e.it, iss = it.issue;
    const thumb = it.snapshot ? await loadImage(it.snapshot) : null;
    const tw = thumb ? 150 * K : 0;
    const textW = colW - (tw ? tw + 12 * K : 0);

    ctx.font = `${8.6 * K}px Segoe UI, Arial, sans-serif`;
    const desc = wrapLines(ctx, iss.description || "", textW);
    const comments = (iss.comments || []).flatMap((cm) =>
      wrapLines(ctx, (cm.author || "?") + ", " + shortDate(cm.at) + ": " + cm.text, textW - 10 * K));
    const lines = 4 + desc.length + (comments.length ? comments.length + 1 : 0);
    const need = Math.max(lines * 12.5 * K + 22 * K, thumb ? tw * 0.72 + 26 * K : 0);

    if (y + need > H - 40 * K) { await finish(); newPage(); }

    const top = y;
    ctx.fillStyle = "#e2e6ec"; ctx.fillRect(M, top - 12 * K, colW, 1 * K);
    // Number badge in the issue's type colour.
    ctx.fillStyle = typeColor(it);
    ctx.beginPath(); ctx.arc(M + 9 * K, top + 3 * K, 9 * K, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${8 * K}px Segoe UI, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.fillText(String(e.n), M + 9 * K, top + 6 * K);
    ctx.textAlign = "left";

    const x0 = M + 24 * K;
    ctx.fillStyle = "#1f2430"; ctx.font = `700 ${10.5 * K}px Segoe UI, Arial, sans-serif`;
    ctx.fillText(wrapLines(ctx, iss.title || "Issue", textW - 24 * K)[0], x0, top + 6 * K);
    y = top + 20 * K;
    ctx.font = `${8.6 * K}px Segoe UI, Arial, sans-serif`;
    const meta = [
      `${typeOf(it).label}  |  ${iss.status || "Open"}  |  ${iss.priority || "Normal"} priority`,
      `Sheet ${it.sheet || "-"}${it.anchor && it.anchor.view_name ? "  |  " + it.anchor.view_name : ""}`,
      `Assigned to ${iss.assigned_to || "nobody"}${iss.due_date ? "  |  due " + shortDate(iss.due_date) : ""}`,
      `Raised by ${it.author || iss.author || "unknown"}, ${shortDate(iss.created_at || it.created_at)}`,
    ];
    ctx.fillStyle = "#414a5a";
    for (const m of meta) { ctx.fillText(m, x0, y); y += 12.5 * K; }
    if (iss.dismissed) {
      ctx.fillStyle = "#b45309";
      ctx.fillText("Marked not an issue by " + iss.dismissed.by + ": " + iss.dismissed.reason, x0, y);
      y += 12.5 * K;
    }
    ctx.fillStyle = "#1f2430";
    y += 3 * K;
    for (const ln of desc) { ctx.fillText(ln, x0, y); y += 12.5 * K; }
    if (comments.length) {
      y += 3 * K; ctx.fillStyle = "#6b7480"; ctx.fillText("Comments", x0, y); y += 12.5 * K;
      for (const ln of comments) { ctx.fillText(ln, x0 + 10 * K, y); y += 12.5 * K; }
    }
    if (thumb) {
      const th = tw * thumb.height / thumb.width;
      ctx.drawImage(thumb, M + colW - tw, top - 4 * K, tw, Math.min(th, 120 * K));
      ctx.strokeStyle = "#e2e6ec"; ctx.lineWidth = 1 * K;
      ctx.strokeRect(M + colW - tw, top - 4 * K, tw, Math.min(th, 120 * K));
      y = Math.max(y, top - 4 * K + Math.min(th, 120 * K) + 8 * K);
    }
    y += 18 * K;
  }
  await finish();
  return pages;
}

/* ------------------------------------------------ editable markups in PDF */

const TEXT_TYPES = new Set(["text", "textbox", "callout"]);

/* The value a measurement shows on screen, for the same markup in the PDF.
   The scale is looked up on the sheet being exported - the lookup reads
   the current sheet, so it is pointed at this one while labels are made. */
function pdfLabel(it) {
  const pts = it.points_mm || [];
  if (it.type === "measure") return measureLabel(pts, it);
  if (it.type === "dimension") return measureLabel(pts.slice(0, 2), it);
  if (it.type === "area") return areaLabel(pts, it);
  if (it.type === "angle") return angleLabel(pts);
  return "";
}

/* Text the standard PDF fonts cannot draw, as a picture for the
   annotation's appearance. Sized exactly as pdfannots.js sizes the box, so
   the picture is not stretched. */
/* The "who and when" line of a stamp, as a picture the stamp's width. */
function rasterStampLinePng(it) {
  const pts = it.points_mm || [[0, 0], [60, 14]];
  const wPt = Math.abs(pts[1][0] - pts[0][0]) * MM_PT, hPt = Math.abs(pts[1][1] - pts[0][1]) * MM_PT;
  const lineH = hPt * 0.26, fs = hPt * 0.17;
  const K = 4;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(wPt * K)); c.height = Math.max(1, Math.round(lineH * K));
  const g = c.getContext("2d");
  g.scale(K, K);
  g.fillStyle = (it.stamp && it.stamp.color) || "#b91c1c";
  g.font = `${fs}px Arial, "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  const st = it.stamp || {};
  g.fillText([st.by || it.author || "", st.at ? String(st.at).slice(0, 10) : ""].filter(Boolean).join("  -  "),
             wPt / 2, lineH / 2);
  const url = c.toDataURL("image/png");
  return Uint8Array.from(atob(url.split(",")[1]), (ch) => ch.charCodeAt(0));
}

function rasterTextPng(it) {
  const st = it.style || {};
  const fs = Math.max(6, (Number(st.size) || 3.5) * MM_PT);
  const lines = String(it.text || "").split("\n");
  const pts = it.points_mm || [];
  const wPt = it.type === "textbox" && pts.length > 1
    ? Math.abs(pts[1][0] - pts[0][0]) * MM_PT
    : Math.max(...lines.map((s) => s.length)) * fs * 0.55 + 8;
  const hPt = it.type === "textbox" && pts.length > 1
    ? Math.abs(pts[1][1] - pts[0][1]) * MM_PT : lines.length * fs * 1.25 + 6;
  const K = 4;                                   // pixels per point: sharp in print
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(wPt * K));
  c.height = Math.max(1, Math.round(hPt * K));
  const g = c.getContext("2d");
  g.scale(K, K);
  g.fillStyle = st.color || "#ff3b30";
  g.font = `${fs}px ${st.font || "Segoe UI"}, "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textBaseline = "alphabetic";
  lines.forEach((s, i) => g.fillText(s, 4, 3 + fs * (i + 1) * 1.1));
  const url = c.toDataURL("image/png");
  return Uint8Array.from(atob(url.split(",")[1]), (ch) => ch.charCodeAt(0));
}

async function embedPicture(out, href) {
  const buf = new Uint8Array(await (await fetch(href)).arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  return (png ? await out.embedPng(buf) : await out.embedJpg(buf)).ref;
}

async function annotateSheet(P, out, page, sh, mine) {
  const images = {}, rasters = {};
  for (const it of mine) {
    try {
      if (it.type === "image" && it.href) images[it.id] = await embedPicture(out, it.href);
      if (TEXT_TYPES.has(it.type) && /[^\u0000-\u00ff]/.test(it.text || "")) {
        rasters[it.id] = (await out.embedPng(rasterTextPng(it))).ref;
      }
      // a stamp signed with a Chinese name: that line as a picture
      if (it.type === "stamp" && /[^\u0000-\u00ff]/.test((it.stamp && it.stamp.by) || it.author || "")) {
        rasters[it.id] = (await out.embedPng(rasterStampLinePng(it))).ref;
      }
    } catch (e) { /* one picture failing must not lose the sheet */ }
  }
  const saved = S.sheet;
  S.sheet = sh;
  try {
    return annotateMarkups(P, out, page, mine, {
      author: Store.author(), labelFor: pdfLabel, images, rasters,
      issueColor: (it) => typeColor(it),
    });
  } finally {
    S.sheet = saved;
  }
}

async function exportPdfVector(sheets, dpi, withReport) {
  const P = await pdfLib();
  const out = await P.PDFDocument.create();
  const title = (S.manifest.source && S.manifest.source.title) || "Sheets";
  out.setTitle(title + " - marked up");
  out.setAuthor(Store.author() || "");
  out.setProducer("LWK Viewer");

  const entries = [];
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    status(`Adding ${sh.number} (${i + 1} of ${sheets.length}) ...`);
    const bytes = new Uint8Array(await (await fetch(Store.dataUrl(sh.pdf))).arrayBuffer());
    const src = await P.PDFDocument.load(bytes, { ignoreEncryption: true });
    const [page] = await out.copyPages(src, [(sh.page || 1) - 1]);
    out.addPage(page);

    const mine = S.items.filter((it) => it.sheet === sh.number
      && it.placement !== "3d" && it.placement !== "view" && it.placement !== "clashrule" && it.placement !== "checkcfg");
    if (mine.length) {
      const editable = (document.getElementById("pdf-markups") || {}).value !== "flat";
      if (editable) {
        // Real annotations: select, move, edit and reply in any PDF editor.
        await annotateSheet(P, out, page, sh, mine);
      } else {
        const png = await markupLayer(sh, bytes, dpi);
        const img = await out.embedPng(png);
        const box = page.getCropBox();
        page.drawImage(img, { x: box.x, y: box.y, width: box.width, height: box.height });
      }
    }
    // area plans: rows of the area schedule show the boundary (Acrobat)
    if (sh.areas && sh.areas.length) {
      try {
        const words = await wordsFor(sh);
        const cb = page.getCropBox();
        pdfAreas(P, out, page, sh, locateRows(sh, words || [], cb.height));
      } catch (e) { showError("pdf areas " + sh.number, e); }
    }
    // Numbered exactly as the pins on the sheet are: per sheet, in order.
    let n = 0;
    for (const it of mine) if (it.issue) entries.push({ it: it, n: sh.number + "-" + (++n) });
  }

  if (withReport && entries.length) {
    status("Writing the issue report ...");
    for (const rp of await reportPages(entries, title)) {
      const img = await out.embedJpg(rp.jpeg);
      const pg = out.addPage(rp.pt);
      pg.drawImage(img, { x: 0, y: 0, width: rp.pt[0], height: rp.pt[1] });
    }
  }
  const bytes = await out.save();
  return { blob: new Blob([bytes], { type: "application/pdf" }), pages: out.getPageCount(),
           issues: entries.length, title: title };
}

async function exportPdf() {
  const withMarkup = new Set(S.items.filter((i) => i.sheet).map((i) => i.sheet));
  const scope = document.getElementById("pdf-scope").value;
  const dpi = Number(document.getElementById("pdf-dpi").value) || 150;

  let sheets = S.manifest.sheets.filter((s) => s.pdf);
  if (scope === "current") sheets = S.sheet ? [S.sheet] : [];
  else if (scope === "marked") sheets = sheets.filter((s) => withMarkup.has(s.number));

  if (!sheets.length) {
    status(scope === "marked" ? "No sheet has any markups yet." : "Open a sheet first.");
    return;
  }
  $("#pdf-back").hidden = true;

  const withReport = document.getElementById("pdf-report").checked;
  if (await pdfLib()) {
    try {
      const r = await exportPdfVector(sheets, dpi, withReport);
      download(r.blob, r.title.replace(/[^\w-]+/g, "_") + "-markup.pdf");
      status(`PDF exported: ${sheets.length} sheet(s) with the original drawing kept`
        + (r.issues ? `, plus a report of ${r.issues} issue(s)` : "")
        + `, ${(r.blob.size / 1048576).toFixed(1)} MB.`);
      return;
    } catch (e) {
      // A drawing pdf-lib cannot parse still gets exported, as a picture.
      showError("vector pdf", e);
      status("The original drawing could not be copied; exporting as pictures instead.");
    }
  }

  const pages = [];
  for (let i = 0; i < sheets.length; i++) {
    status(`Rendering ${sheets[i].number} (${i + 1} of ${sheets.length}) ...`);
    try {
      pages.push(await renderSheetForPdf(sheets[i], dpi));
    } catch (e) {
      showError("pdf " + sheets[i].number, e);
    }
  }
  if (!pages.length) { status("Nothing could be rendered."); return; }

  const title = (S.manifest.source && S.manifest.source.title) || "Sheets";
  const blob = buildPdf(pages, { title: title + " - marked up",
                                 author: Store.author() });
  download(blob, title.replace(/[^\w-]+/g, "_") + "-markup.pdf");
  status(`PDF exported: ${pages.length} sheet(s), ${(blob.size / 1048576).toFixed(1)} MB.`);
}

/* ------------------------------------------------------- sheet to model */

/* Open the model at a markup's point. The anchor's model_mm comes from the
   sheet viewport's own mapping, in Revit internal millimetres; the 3D page
   turns that into the scene, finds the floor, cuts it in plan and marks the
   spot. Markups outside any mapped viewport have no model point and cannot
   be followed - the command is simply not offered for them. */
function show3D(it) {
  const a = it && it.anchor;
  if (!a || !a.model_mm) {
    status("This markup is not inside a model view, so it has no place in 3D.");
    return;
  }
  const base = Store.pageUrl("model.html");
  const sep = base.indexOf("?") >= 0 ? "&" : "?";
  location.href = base + sep + "sheet=" + encodeURIComponent(it.sheet || "")
    + "&at=" + a.model_mm.map((n) => Math.round(n)).join(",")
    + "&label=" + encodeURIComponent((it.sheet || "") + (a.view_name ? " / " + a.view_name : ""));
}

/* ------------------------------------------------------ text selection */

/* The drawing's own text, made selectable. pdf.js lays an invisible copy
   of every word over the rendered page at exactly its position; dragging
   across it selects real text, which Ctrl+C copies - a door schedule, a
   room name, a note to paste into an issue. It is only built while the
   tool is on: a busy sheet has tens of thousands of words, and positioning
   them on every zoom would slow drawing for no reason. */
let _textKey = "";
async function buildTextLayer() {
  const div = $("#textlayer");
  if (!S.page || !S.viewport) return;
  const key = [S.sheet && S.sheet.number, S.scale, S.rotation].join("|");
  if (key === _textKey && div.childElementCount) return;
  _textKey = key;

  div.innerHTML = "";
  div.style.width = Math.round(S.viewport.width) + "px";
  div.style.height = Math.round(S.viewport.height) + "px";
  // pdf.js sizes and places every word from this variable; without it the
  // layer draws, but misaligned with the drawing underneath.
  div.style.setProperty("--scale-factor", S.viewport.scale);

  let tc;
  try { tc = await S.page.getTextContent(); }
  catch (e) { status("Could not read the text of this drawing."); return; }
  if (!tc.items || !tc.items.length) {
    status("This drawing has no text to select - it may be a scan or an image.");
    return;
  }
  const task = pdfjsLib.renderTextLayer({ textContentSource: tc, container: div,
                                          viewport: S.viewport, textDivs: [] });
  try { await task.promise; } catch (e) { return; }
  status(`${tc.items.length} pieces of text selectable. Drag across them, then Ctrl+C.`);
}

function showTextLayer(on) {
  const div = $("#textlayer");
  div.hidden = !on;
  if (on) buildTextLayer();
  else { const sel = getSelection && getSelection(); if (sel) sel.removeAllRanges(); }
}

/* -------------------------------------------------- importing PDFs */

/* A drawing made outside Revit - a consultant's layout, a scanned
   survey - added to the project. Every page becomes its own sheet. Such a
   sheet has no viewports, so markups and issues on it work normally but
   stay 2D: there is nothing to tie a point on it to the model. */
async function importPdf(file) {
  if (!file) return;
  let pages = 1, labels = null;
  try {
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    pages = doc.numPages;
    try { labels = await doc.getPageLabels(); } catch (e) {}
  } catch (e) {
    status("That file could not be read as a PDF.");
    return;
  }

  const stem = file.name.replace(/\.pdf$/i, "");
  const prefix = prompt(
    pages === 1 ? "Sheet number for this drawing:"
      : `This PDF has ${pages} pages. Each becomes a sheet.\n`
        + "Sheet number prefix (pages are numbered after it):",
    stem.slice(0, 24));
  if (prefix === null) return;
  const have = setNames();
  let set = prompt("Which set do these drawings go in? They get their own entry in the drop-down at the top, "
    + "apart from the sheets from Revit.\n\nType a new name for a new set"
    + (have.length ? ", or one of: " + have.join(", ") : "") + ".", S.set || have[0] || PDF_SET);
  if (set === null) return;
  set = set.trim().slice(0, 60) || PDF_SET;

  status(`Uploading ${file.name} ...`);
  const res = await fetch("/api/import/pdf?name=" + encodeURIComponent(file.name), {
    method: "POST",
    headers: Object.assign(Store.authHeaders(), { "Content-Type": "application/pdf" }),
    body: file,
  });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { msg = (await res.json()).detail || msg; } catch (e) {}
    status("Import failed: " + msg);
    return;
  }
  const up = await res.json();

  const sheets = [];
  for (let p = 1; p <= pages; p++) {
    const label = labels && labels[p - 1];
    sheets.push({
      number: pages === 1 ? prefix : `${prefix}-${label || String(p).padStart(2, "0")}`,
      name: stem + (pages > 1 ? " p" + p : ""),
      pdf: up.pdf, page: p,
    });
  }
  const reg = await fetch("/api/import/sheets", {
    method: "POST",
    headers: Object.assign(Store.authHeaders(), { "Content-Type": "application/json" }),
    body: JSON.stringify({ sheets: sheets, set }),
  });
  if (!reg.ok) { status("Import failed while adding the sheets."); return; }
  const added = (await reg.json()).added || [];
  await reloadManifest();
  status(`Imported ${added.length} sheet(s) from ${file.name} into "${set}".`);
  showSet(set, true);
  const first = S.manifest.sheets.find((s) => added[0] && s.number === added[0].number);
  if (first) openSheet(first);
}

async function removeImportedSheet(s) {
  const n = S.items.filter((it) => it.sheet === s.number).length;
  if (!confirm(`Remove imported sheet ${s.number}?`
      + (n ? `\n\n${n} markup(s) on it stay in the project but will have no sheet to show on.` : ""))) return;
  const res = await fetch("/api/import/sheets/" + encodeURIComponent(s.number), {
    method: "DELETE", headers: Store.authHeaders() });
  if (!res.ok) { status("Could not remove " + s.number); return; }
  await reloadManifest();
  status(s.number + " removed.");
}

async function reloadManifest() {
  const res = await fetch(Store.dataUrl("manifest.json"), { cache: "no-store" });
  S.manifest = await res.json();
  pickSet(S.set);
  sheetSets(setNames(), S.set, (n) => showSet(n));
  renderSheets();
  // The split pane's sheet list is built once; rebuild it next time.
  const sel = document.getElementById("split-sheet");
  if (sel) sel.innerHTML = "";
}

/* ------------------------------------------------- comment interchange */

/* Comments and issues, on their own, as JSON. BCF is the format for
   handing issues to Revit; this is the format for moving them between
   copies of this viewer - a colleague working offline, a backup before a
   risky edit, or a set of standard markups reused on the next sheet. */
function exportComments() {
  const payload = {
    format: "lwk.viewer.comments/1",
    exported_at: new Date().toISOString(),
    exported_by: Store.author(),
    project: (S.manifest && S.manifest.source && S.manifest.source.title) || "",
    items: S.items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)],
                        { type: "application/json" });
  download(blob, (payload.project || "comments").replace(/[^\w-]+/g, "_")
    + "-comments.json");
  status(`Exported ${S.items.length} comment(s) and issue(s).`);
}

async function importComments(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    status("That file is not readable JSON.");
    return;
  }
  const incoming = Array.isArray(data) ? data : (data && data.items);
  if (!Array.isArray(incoming) || !incoming.length) {
    status("No comments found in that file.");
    return;
  }

  const known = new Set(S.items.map((x) => x.id));
  const fresh = incoming.filter((x) => x && x.id && x.points_mm);
  const clashes = fresh.filter((x) => known.has(x.id)).length;

  /* Imported records get new ids unless the user chooses to overwrite.
     Silently replacing a colleague's markup because two files happen to
     share an id would be the worst possible outcome here. */
  let overwrite = false;
  if (clashes) {
    overwrite = confirm(`${clashes} of these already exist here.\n\n`
      + "OK: replace them with the imported version.\n"
      + "Cancel: bring them in as copies, keeping both.");
  }

  const made = [];
  for (const src of fresh) {
    const it = JSON.parse(JSON.stringify(src));
    if (known.has(it.id) && !overwrite) it.id = uid();
    it.imported_at = new Date().toISOString();
    const i = S.items.findIndex((x) => x.id === it.id);
    if (i >= 0) S.items[i] = it; else S.items.push(it);
    made.push(it.id);
  }
  remember(made);
  redraw(); renderList();
  persist(made);
  status(`Imported ${made.length} comment(s)`
    + (clashes ? (overwrite ? `, replacing ${clashes}.` : `, ${clashes} as copies.`) : "."));
}

async function exportBcf() {
  try {
    status("Building BCF ...");
    const name = (S.manifest.source && S.manifest.source.title) || "issues";
    const r = await buildBcf(S.items, name);
    download(r.blob, `${name.replace(/[^\w.-]/g, "_")}.bcfzip`);
    status(`Exported ${r.count} issue(s): ${r.withCamera} with a camera `
      + `(${r.withDerivedCamera} derived from a sheet viewport), `
      + `${r.withSnapshot} with a snapshot`
      + (r.skipped ? `, ${r.skipped} comment(s) skipped` : "")
      + (r.onFallback
          ? `. WARNING: ${r.onFallback} topic(s) predate the coordinate fix `
            + "and will be misplaced - raise them again."
          : "."));
  } catch (e) {
    status("BCF export failed: " + e.message);
  }
}

function exportAll() {
  const blob = new Blob([JSON.stringify({
    exported_at: new Date().toISOString(),
    source: S.manifest.source, items: S.items,
  }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "markups-and-issues.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------------------------------------------------------- wire */

function setTool(id) {
  if (INK.pending.length) flushInk();
  if (S.endPoly && id !== S.tool) S.endPoly();
  S.tool = id;
  document.querySelectorAll("#tools button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === id));
  const k = toolOf(id).kind;
  const ov = $("#overlay");
  ov.style.pointerEvents = k === "pan" || k === "textsel" ? "none" : "auto";
  showTextLayer(k === "textsel");
  ov.classList.toggle("draw", ["drag2", "free", "poly", "click"].indexOf(k) >= 0);
  ov.classList.toggle("pick", k === "pick" || k === "erase" || k === "match");
  if (k !== "match") S.matchSrc = null;
  else if (!S.matchSrc && S.sel.length === 1) S.matchSrc = S.sel[0];
  if (k === "match") {
    status(S.matchSrc ? "Match: tap markups to copy the selected one's look (and issue details) onto, "
      + "or tap empty paper to place a copy."
      : "Match: first tap the markup to copy from.");
  }
  $("#scroll").style.cursor = k === "pan" ? "grab" : "";
  try { AREAS.draw(); } catch (e) {}
  // A short name over the sheet as the tool changes (a tablet has no hover
  // tooltip to say which icon is which).
  let chip = document.getElementById("tool-chip");
  const row = document.getElementById("stage-row");
  if (!chip && row) {
    chip = document.createElement("div");
    chip.id = "tool-chip";
    row.style.position = row.style.position || "relative";
    row.appendChild(chip);
  }
  if (chip && !S.toolChipQuiet) {
    chip.textContent = toolOf(id).label || id;
    chip.classList.add("on");
    clearTimeout(chip._t);
    chip._t = setTimeout(() => chip.classList.remove("on"), 900);
  }
}

function applyStyleToSelection() {
  if (!S.sel.length) return;
  remember(S.sel);
  for (const id of S.sel) {
    const it = S.items.find((x) => x.id === id);
    if (it) it.style = JSON.parse(JSON.stringify(S.style));
  }
  redraw();
  persist(S.sel);     // restyling is an edit like any other
}

function wireChrome() {
  const tw = $("#tools");
  for (const t of TOOLS) {
    const b = iconButton(t.id, t.label, t.label);
    b.dataset.tool = t.id;
    b.addEventListener("click", () => setTool(t.id));
    tw.appendChild(b);
  }
  // the keyboard: set a key for each tool
  const kb = document.createElement("button");
  kb.id = "keys-btn"; kb.className = "ibtn"; kb.type = "button";
  kb.title = "Tool shortcuts: one key per tool, yours to change";
  kb.textContent = "\u2328";
  kb.addEventListener("click", openShortcuts);
  tw.appendChild(kb);
  labelToolKeys();
  S.toolChipQuiet = true;           // no name flash on opening the page
  setTool("select");
  S.toolChipQuiet = false;

  const bind = (sel, key, cast) => {
    $(sel).addEventListener("input", () => {
      S.style[key] = cast ? cast($(sel).value) : $(sel).value;
      applyStyleToSelection();
    });
  };
  bind("#p-color", "color"); bind("#p-fill", "fill"); bind("#p-tcolor", "tcolor");
  bind("#p-fillop", "fillop", Number); bind("#p-width", "width", Number);
  bind("#p-dash", "dash"); bind("#p-font", "font");
  bind("#p-size", "size", Number); bind("#p-align", "align");

  $("#mode-comment").addEventListener("click", () => {
    S.mode = "comment";
    $("#mode-comment").classList.add("active");
    $("#mode-issue").classList.remove("active");
  });
  $("#mode-issue").addEventListener("click", () => {
    S.mode = "issue";
    $("#mode-issue").classList.add("active");
    $("#mode-comment").classList.remove("active");
  });

  const ft = document.getElementById("flt-type");
  if (ft) ft.insertAdjacentHTML("beforeend", ISSUE_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join(""));
  // the list's choices are kept on this device
  for (const id of ["group-by", "flt-type", "flt-status", "sort-by"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    try { const v = localStorage.getItem("lwk.list." + id); if (v !== null && [...el.options].some((o) => o.value === v)) el.value = v; } catch (e) {}
    el.addEventListener("change", () => { try { localStorage.setItem("lwk.list." + id, el.value); } catch (e) {} });
  }
  for (const id of ["group-by", "item-search", "flt-type", "flt-status", "sort-by"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderList);
  }

  document.querySelectorAll("#filter-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#filter-tabs button")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      S.filter = b.dataset.filter;
      renderList();
    });
  });

  $("#zoom-in").addEventListener("click", () => zoomAt(1.25));
  $("#zoom-out").addEventListener("click", () => zoomAt(0.8));
  $("#zoom-fit").addEventListener("click", fit);
  $("#poly-finish").addEventListener("click", () => S.endPoly && S.endPoly());
  // a link that opens this sheet
  $("#sheet-link").addEventListener("click", () => {
    if (!S.sheet) return status("Open a sheet first.");
    copyLink("index.html?project=" + encodeURIComponent(Store.currentProject() || "") + "&sheet=" + encodeURIComponent(S.sheet.number),
      "sheet " + S.sheet.number);
  });
  $("#show-markups").addEventListener("click", () => {
    S.hideMarkups = !S.hideMarkups;
    $("#show-markups").classList.toggle("active", !S.hideMarkups);
    $("#show-markups").title = S.hideMarkups
      ? "Markups hidden - click to show them" : "Hide all markups";
    redraw();
    status(S.hideMarkups ? "Markups hidden. Nothing was deleted."
                         : "Markups shown.");
  });
  $("#show-markups").classList.add("active");
  const hd = $("#hide-done");
  if (hd) {
    try { S.hideDone = localStorage.getItem("lwk.hideDone") === "1"; } catch (e) {}
    const paint = () => {
      hd.classList.toggle("active", !!S.hideDone);
      hd.title = S.hideDone ? "Resolved and closed issues are hidden on the drawing - click to show them"
        : "Hide resolved and closed issues on the drawing (the list keeps them; use its status filter)";
    };
    paint();
    hd.addEventListener("click", () => {
      S.hideDone = !S.hideDone;
      try { localStorage.setItem("lwk.hideDone", S.hideDone ? "1" : "0"); } catch (e) {}
      paint();
      if (S.hideDone) S.sel = S.sel.filter((id) => !issueDone(S.items.find((x) => x.id === id)));
      redraw();
      try { SYNC.post && SYNC.post({ type: "hidedone", on: !!S.hideDone }); } catch (e) {}
      status(S.hideDone ? "Resolved and closed issues hidden on the drawing. Nothing was deleted." : "All issues shown on the drawing.");
    });
  }

  $("#export-pdf").addEventListener("click", () => { $("#pdf-back").hidden = false; });
  $("#pdf-go").addEventListener("click", () => exportPdf().catch((e) => showError("pdf", e)));
  $("#pdf-cancel").addEventListener("click", () => { $("#pdf-back").hidden = true; });
  $("#import-pdf-btn").addEventListener("click", () => $("#import-pdf").click());
  $("#import-pdf").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    importPdf(f).catch((e) => showError("import pdf", e));
  });
  $("#export-json").addEventListener("click", exportComments);
  $("#import-json").addEventListener("change", importComments);
  $("#import-btn").addEventListener("click", () => $("#import-json").click());

  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  // Changing the scale changes every measurement label on the sheet.
  $("#meas-scale").addEventListener("input", () => redraw());

  // Editing the scale of chosen measurements, after the fact.
  $("#a-scale").addEventListener("change", () => {
    const v = Number($("#a-scale").value);
    const ids = S.sel.filter((id) => {
      const x = S.items.find((y) => y.id === id);
      return x && MEASURE_TYPES.indexOf(x.type) >= 0;
    });
    for (const id of ids) {
      const x = S.items.find((y) => y.id === id);
      if (v > 0) x.scale = v; else delete x.scale;
    }
    redraw();
    persist(ids);
  });
  for (const f of ["g-x", "g-y", "g-w", "g-h", "g-r"]) {
    // change, not input: applying on every keystroke would move the markup
    // through every intermediate value while a number is being typed.
    $("#" + f).addEventListener("change", () => applyGeometry(f));
    $("#" + f).addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); applyGeometry(f); }
    });
  }
  $("#a-rotl").addEventListener("click", () => { rotateSelection(-90); persist(S.sel); });
  $("#a-rotr").addEventListener("click", () => { rotateSelection(90); persist(S.sel); });
  $("#rotate").addEventListener("click", () => {
    S.rotation = (S.rotation + 90) % 360; renderPage();
  });

  $("#scroll").addEventListener("wheel", (ev) => {
    if (!S.page) return;
    ev.preventDefault();
    zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX, ev.clientY);
  }, { passive: false });

  $("#a-delete").addEventListener("click", deleteSelection);
  $("#a-copy").addEventListener("click", copySelection);
  $("#a-paste").addEventListener("click", paste);
  $("#a-issue").addEventListener("click", () => {
    const it = issueTarget();
    if (it) openIssue(it);
  });
  if ($("#a-group")) {
    $("#a-group").addEventListener("click", groupSelection);
    $("#a-ungroup").addEventListener("click", ungroupSelection);
  }
  $("#f-cancel").addEventListener("click", () => {
    $("#dialog-back").hidden = true; S.pendingIssueFor = null;
  });
  // Esc closes the new-issue window (as Cancel), even from its fields
  addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || $("#dialog-back").hidden) return;
    ev.preventDefault(); ev.stopPropagation();
    $("#f-cancel").click();
  }, true);
  $("#f-save").addEventListener("click", saveIssue);
  $("#export-all").addEventListener("click", exportAll);
  // Icons on the file actions and selection actions; palettes beside colours.
  decorateIcons(document);
  attachPalette($("#p-color"));
  attachPalette($("#p-fill"));
  attachPalette($("#p-tcolor"));
  $("#export-bcf").addEventListener("click", exportBcf);
}

/* ------------------------------------------------------------- session */

/* Everything below waits for a signed-in session. The viewer is now a
   client of a shared server rather than a single-machine tool, so starting
   before the store is ready would show an empty issue list that silently
   fills in later. */
async function signIn() {
  const back = document.getElementById("gate-back");
  const msg = document.getElementById("gate-msg");

  let info = null;
  try {
    info = await Store.ping();
  } catch (e) {
    back.hidden = false;
    msg.textContent = e.message;
    throw e;
  }

  if (Store.restoreSession()) {
    try {
      await Store.validate();
      back.hidden = true;
      return;
    } catch (e) { /* stale token: fall through to the form */ }
  }

  if (!info.needs_passphrase) {
    await Store.login("", localStorage.getItem("lwk-viewer:name") || "");
    back.hidden = true;
    return;
  }

  back.hidden = false;
  document.getElementById("gate-name").value =
    localStorage.getItem("lwk-viewer:name") || "";
  // The server no longer reports one issue count: issues belong to projects.
  msg.textContent = info.single ? "Sign in to open the project."
    : (info.projects || 0) + " project(s) on this server.";

  await new Promise((resolve) => {
    const go = async () => {
      const btn = document.getElementById("gate-go");
      btn.disabled = true;
      msg.textContent = "Signing in ...";
      const pass = document.getElementById("gate-pass").value;
      const name = document.getElementById("gate-name").value.trim();
      try {
        await Store.login(pass, name);
        await Store.validate();
        back.hidden = true;
        resolve();
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };
    document.getElementById("gate-go").addEventListener("click", go);
    document.getElementById("gate-pass").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); go(); }
    });
  });
}

function connStatus(ok, err) {
  const el = document.getElementById("conn");
  if (!el) return;
  const queued = Store.pendingCount();
  el.classList.toggle("ok", !!ok && !queued);
  if (!ok) el.textContent = "offline" + (err ? ": " + err : "");
  else if (queued) el.textContent = queued + " waiting to save";
  else el.textContent = "online" + (Store.author() ? " - " + Store.author() : "");
}


/* Phones and tablets held upright: the drawing takes the whole screen.
   The sheet list and the issue list slide in from the left and the right
   (buttons at the top left of the drawing, with the previous and next
   sheet beside them); choosing a sheet or an issue closes the list. */
function setupDrawers2d() {
  const mq = matchMedia("(max-width: 900px) and (orientation: portrait)");
  const row = document.getElementById("stage-row");
  const sheets = document.getElementById("sheets"), items = document.getElementById("items");
  if (!row || !sheets || !items) return;
  const bar = document.createElement("div");
  bar.id = "drawer-btns";
  bar.innerHTML = `<button id="dr-sheets" title="Sheets">&#9776; Sheets</button>`
    + `<button id="dr-prev" title="Previous sheet">&#8249;</button>`
    + `<button id="dr-next" title="Next sheet">&#8250;</button>`
    + `<button id="dr-items" title="Issues and comments">Issues</button>`;
  row.style.position = "relative";
  row.appendChild(bar);
  const scrim = document.createElement("div");
  scrim.id = "drawer-scrim";
  scrim.hidden = true;
  document.body.appendChild(scrim);
  const close = () => { sheets.classList.remove("open"); items.classList.remove("open"); scrim.hidden = true; };
  const open = (el) => {
    const was = el.classList.contains("open");
    close();
    if (was) return;
    el.classList.add("open");
    scrim.hidden = false;
  };
  bar.querySelector("#dr-sheets").addEventListener("click", () => open(sheets));
  bar.querySelector("#dr-items").addEventListener("click", () => open(items));
  bar.querySelector("#dr-prev").addEventListener("click", () => stepSheet(-1));
  bar.querySelector("#dr-next").addEventListener("click", () => stepSheet(1));
  scrim.addEventListener("click", close);
  const pickClose = (ev) => {
    if (!document.body.classList.contains("drawers")) return;
    if (ev.target.closest("button, input, select, textarea")) return;
    if (ev.target.closest("li")) setTimeout(close, 120);
  };
  document.getElementById("sheet-list").addEventListener("click", pickClose);
  document.getElementById("item-list").addEventListener("click", pickClose);
  const hdr = document.querySelector("header");
  const apply = () => {
    const on = mq.matches;
    document.body.classList.toggle("drawers", on);
    document.body.classList.toggle("drawers2d", on);
    if (!on) close();
    const top = (hdr ? hdr.offsetHeight : 44);
    document.documentElement.style.setProperty("--hdr-h", top + "px");
    requestAnimationFrame(() => { dispatchEvent(new Event("resize")); if (S.page) fit(); });
  };
  if (mq.addEventListener) mq.addEventListener("change", apply); else mq.addListener(apply);
  apply();
}

async function boot() {
  try { setupDrawers2d(); } catch (e) { console.warn("drawers", e); }
  try {
    initPanels({ layout: document.getElementById("layout"), left: document.getElementById("sheets"), right: document.getElementById("items"), key: "sheets" });
    initSplitter({ row: document.getElementById("stage-row"), first: document.getElementById("scroll"), key: "sheets-split", modes: ["sync", "split"] });
  } catch (e) { console.warn("panels", e); }
  try { wireSheetFind(); } catch (e) { console.warn("find", e); }
  try { wireLayers(); } catch (e) { console.warn("layers", e); }
  try { attachTemplates(Store, document.getElementById("dialog"), "f"); } catch (e) { console.warn("templates", e); }
  // Before anything calls into store.js: a stale copy is reported by name
  // rather than failing on the first missing function.
  {
    const stale = Check.checkModules(Store);
    if (stale.length) { Check.report(stale); return; }
  }
  const problems = Check.checkPage("sheets", [])
    .concat(Check.checkFunctions({
      signIn, connStatus, wireChrome, wirePointer, wirePan, setTool,
      renderList, renderSheets, openSheet, redraw, select, save, load,
      commitDraft, saveIssue, deleteSelection, exportBcf,
    }))
    .concat(await Check.checkServer());
  if (Check.report(problems)) {
    status("Startup check failed - see the bar above.");
    if (problems.some((p) => p.indexOf("function") === 0)) return;
  }

  await signIn();
  // A project must be settled before anything is loaded: every file path
  // and every issue request is scoped to it.
  await ensureProject();
  // how this device copes with the sheets page (telemetry.js)
  try {
    Tele.startTelemetry({ page: "sheets", project: Store.currentProject(),
      snapshot: () => ({ heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
                         sheet: S.sheet ? S.sheet.number : "",
                         drawMs: PERF.cur ? Math.round(PERF.cur.drawMs || 0) : null,
                         detailMs: PERF.cur ? Math.round(PERF.cur.detailMs || 0) : null }),
      token: () => { try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; } } });
    let last = performance.now();
    const fr = (t) => { Tele.frame(t - last, false); last = t; requestAnimationFrame(fr); };
    requestAnimationFrame(fr);
    setTimeout(() => Tele.ready(), 1000);
  } catch (e) { console.warn("telemetry", e); }

  for (const [name, fn] of [["chrome", wireChrome], ["pointer", wirePointer],
                            ["pan", wirePan], ["touch", wireTouch],
                            ["split", wireSplit], ["compare", CMP.wire],
                            ["sync3d", SYNC.wire], ["links", LINKS.wire], ["perf", wireSheetPerf], ["files", wireFilesMenu]]) {
    try { fn(); } catch (e) { showError("wire:" + name, e); }
  }
  Store.onChange(() => {
    S.items = Store.all();
    redraw(); renderList();
    if (SP.page && !$("#split-pane").hidden) drawSplitMarkups();
  });
  await Store.start(connStatus);
  try {
    const res = await fetch(Store.dataUrl("manifest.json"));
    if (!res.ok) throw new Error("HTTP " + res.status);
    S.manifest = await res.json();
  } catch (e) {
    status("Could not load manifest.json: " + e.message); return;
  }
  // the project's title from the Projects page (projects.js), when it has one
  if (!$("#project").textContent) $("#project").textContent =
    (S.manifest.source && S.manifest.source.title) || "";
  pickSet(new URLSearchParams(location.search).get("set"));
  sheetSets(setNames(), S.set, (n) => showSet(n));
  load(); renderSheets(); renderList();
  status(`${S.manifest.sheets.length} sheets, `
    + `${(S.manifest.elements || []).length} elements.`);

  // Back where the user left off: the sheet in the link if there is one,
  // otherwise the last sheet opened on this project.
  let want = new URLSearchParams(location.search).get("sheet");
  const named = !!want;
  if (!want) { try { want = localStorage.getItem(lastSheetKey()); } catch (e) {} }
  let again = want && S.manifest.sheets.find((s) => s.number === want);
  // the last sheet opened is of another set than the one asked for: the
  // set's first sheet instead (a sheet named in the address still wins)
  if (!named && again && sheetSet(again) !== S.set) again = setSheets()[0];
  if (again) {
    await openSheet(again);
    const li = document.querySelector(`#sheet-list li[data-num="${CSS.escape(again.number)}"]`);
    if (li) li.scrollIntoView({ block: "center" });
  }
  // From the dashboard: ?select=<issue id> picks the issue out on its sheet
  // once the issues have arrived from the server.
  const selId = new URLSearchParams(location.search).get("select");
  if (selId) {
    for (let i = 0; i < 60 && !S.items.find((x) => x.id === selId); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const it = S.items.find((x) => x.id === selId);
    if (it) {
      select([selId], false);
      // a link to an issue opens it, as a click in the list does
      if (it.issue) openIssueFromSheet(it);
    }
  }
  // "Open in web viewer" from Revit lands in this page, not a new tab
  startGoto(Store, async (g) => {
    if (g.kind === "3d" || (g.project && g.project !== Store.currentProject())) {
      location.href = issueLink(g);
      return;
    }
    const sh = S.manifest.sheets.find((x) => x.number === g.sheet);
    if (sh && (!S.sheet || S.sheet.number !== sh.number)) await openSheet(sh);
    for (let i = 0; i < 40 && !S.items.find((x) => x.id === g.id); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (S.items.find((x) => x.id === g.id)) select([g.id], false);
    status("Opened from Revit: " + (g.sheet || "") );
  });
}

boot();
