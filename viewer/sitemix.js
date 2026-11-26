/* Site study, stage 5: the flat mix. The table of the flat types (by band:
 * studio, 1-BR, 2-BR, 3-BR, special) and the diagrammatic elevation of each
 * tower, floor by floor: each flat coloured by its type with its saleable
 * area, round the plate (the north side left to right, the core, the south
 * side right to left); the floors of other uses as bands (podium, refuge,
 * transfer plate, clubhouse ...). From the massing (2) and each domestic
 * group's typical floor (4 · Floors).
 */
import * as X from "./mixcore.js";
import * as M from "./massingcore.js";
import * as UC from "./unitcore.js";
import * as FL from "./sitefloor.js";
import * as PT from "./plantools.js";
import { toast } from "./tasks-util.js";
import { headers } from "./nav.js";
import { iconSvg, iconColor } from "./icons.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let C = null, ON = false, LAST = null;
const pref = (k, d) => { try { return localStorage.getItem("lwk-viewer:" + k) || d; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem("lwk-viewer:" + k, v); } catch (e) { /* none */ } };
const FIG = new WeakMap();
const figOf = (u) => { if (!u || typeof u !== "object") return null; let f = FIG.get(u); if (!f) { try { f = UC.figures(u); } catch (e) { f = { saleable: 0 }; } FIG.set(u, f); } return f; };
const ft = () => pref("mx-unit", "ft") === "ft";
const saTxt = (m2) => (ft() ? Math.round(m2 * X.M2_FT2).toLocaleString("en-GB") : (Math.round(m2 * 10) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const saUnit = () => (ft() ? "ft²" : "m²");
const n0 = (v) => Math.round(v).toLocaleString("en-GB");
const p2 = (v) => v.toFixed(2) + "%";

export function init(ctx) {
  C = ctx;
  const P = $("#st-xpanel"), V = $("#st-xview");
  P.addEventListener("click", onClick); V.addEventListener("click", onClick);
  P.addEventListener("change", onChange); V.addEventListener("change", onChange);
  V.addEventListener("pointermove", hover);
  V.addEventListener("pointerleave", () => { const t = $(".mx-tip"); if (t) t.hidden = true; });
}
export function show(on) {
  ON = on;
  $("#st-xpanel").hidden = !on; $("#st-xview").hidden = !on;
  document.body.classList.toggle("st-mix", on);
  if (on) render();
}
export function refresh() { if (ON) render(); }

/* ---------- the figures */
function model() {
  const s = C.study(), m = s.massing || {};
  if (!s.pts || s.pts.length < 3) return { blocks: [] };
  const o = C.S.centroid(s.pts), xy = (fp) => (fp && fp.length >= 3 ? C.S.toXY(fp, o) : null);
  return { blocks: (m.blocks || []).map((b) => Object.assign({}, b, { fp: xy(b.fp) || [], groups: (b.groups || []).map((g) => Object.assign({}, g, { fp: xy(g.fp) })) })) };
}
function compute() {
  const s = C.study(), mx = s.mix || {}, lib = (s.units && s.units.list) || [];
  const L = FL.layouts();
  const byKey = new Map(L.map((o) => [o.x.b.id + "|" + o.x.gi, o]));
  // each domestic group's floor: its flats round the plate (or the mix, in its order, when not laid out)
  const ringC = new Map();
  const cellsOf = (bid, gi) => {
    const k = bid + "|" + gi; if (ringC.has(k)) return ringC.get(k);
    const o = byKey.get(k); let c = null;
    if (o && o.r && (o.r.placed || []).length) c = X.ring(o.r).map((q) => Object.assign(q, { key: o.x.key }));
    else if (o && o.mix.length) { c = []; for (const q of o.mix) for (let i = 0; i < q.n; i++) c.push({ kind: "unit", name: q.u.name, sa: (figOf(q.u) || {}).saleable || 0, key: o.x.key, mixOnly: true }); }
    ringC.set(k, c); return c;
  };
  const md = model(), blds = M.buildings(md), lv = s.plan && s.plan.level, figs = M.figures(md, 0, lv === "" || lv == null ? 0 : Number(lv)).buildings;
  const E = X.elevation(blds, cellsOf, figs, M.USES);
  const rows = X.rowsOf(L.map((o) => ({ floors: o.x.g.n, r: o.r && (o.r.placed || []).length ? o.r : null, mix: o.mix })), (u, q) => (q && q.fig ? q.fig.saleable : (figOf(u) || {}).saleable || 0));
  const T = X.table(rows, lib, mx.colors || {});
  return { s, L, E, T, lib, level: lv };
}

/* ---------- the panel and the page */
function render() {
  if (!ON) return;
  const P = $("#st-xpanel"), V = $("#st-xview");
  const s = C.study();
  if (!s.pts || s.pts.length < 3) {
    P.innerHTML = `<section class="st-card"><h3>5 · Flat mix</h3><p class="muted">Draw the site (1 · Site), then the massing (2), the units (3) and each domestic group's floor (4). The table and the elevation are made from them.</p></section>`;
    V.innerHTML = ""; return;
  }
  const D = (LAST = compute()), T = D.T, can = C.can();
  const view = pref("mx-view", "both");
  const notLaid = D.L.filter((o) => !(o.r && (o.r.placed || []).length));
  const perTower = D.E.map((b) => ({ name: b.name, n: b.rows.reduce((a, r) => a + (r.cells ? r.cells.filter((c) => c.kind === "unit").length : 0), 0) }));
  P.innerHTML = `
    <section class="st-card"><h3>5 · Flat mix</h3>
      <table class="ms-fig">
        <tr><td>Flats</td><td>${n0(T.total.n)}</td><td>${T.total.types} types</td></tr>
        <tr><td>Saleable area</td><td>${saTxt(T.total.tot)} ${saUnit()}</td><td></td></tr>
        <tr><td>Average saleable</td><td>${T.total.n ? saTxt(T.total.tot / T.total.n) : "–"} ${saUnit()}</td><td></td></tr>
        ${perTower.map((t) => `<tr><td>${esc(t.name)}</td><td>${n0(t.n)}</td><td>flats</td></tr>`).join("")}
      </table>
      ${notLaid.length ? `<p class="muted small">${notLaid.map((o) => esc(o.x.label)).join("; ")}: ${notLaid.length > 1 ? "not" : "not"} laid out on 4 · Floors${notLaid.some((o) => o.mix.length) ? " – their flats are taken from the unit mix, in its order" : ""}.</p>` : ""}
    </section>
    <section class="st-card"><h3>Show</h3>
      <div class="fl-set">
        <label>Saleable area in <select data-x="unit"><option value="ft"${ft() ? " selected" : ""}>ft² (sq ft)</option><option value="m2"${ft() ? "" : " selected"}>m²</option></select></label>
        <label>Show <select data-x="view"><option value="both"${view === "both" ? " selected" : ""}>Table and elevation</option><option value="table"${view === "table" ? " selected" : ""}>Table</option><option value="elev"${view === "elev" ? " selected" : ""}>Elevation</option></select></label>
        <label>Each flat shows <select data-x="cell">${[["sa", "Its saleable area"], ["no", "Its type number"], ["name", "Its name"]].map(([k, l]) => `<option value="${k}"${pref("mx-cell", "sa") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
    </section>
    <section class="st-card"><h3>Domestic floors</h3>
      <ul class="fl-checks">${D.L.map((o) => `<li class="${o.r && (o.r.placed || []).length ? "" : "bad"}"><a href="#" data-g="${esc(o.x.key)}">${esc(o.x.label)}</a><br><small>${o.r && (o.r.placed || []).length ? `${o.r.placed.length} flats a floor × ${o.x.g.n} = ${o.r.placed.length * o.x.g.n}` : o.mix.length ? `from the mix: ${o.mix.reduce((a, q) => a + q.n, 0)} a floor (not laid out)` : "no unit mix"}</small></li>`).join("") || `<li class="bad">No domestic floors in the massing</li>`}</ul>
    </section>
    <section class="st-card"><h3>Export</h3>
      <div class="row wrap">
        <button type="button" data-x="xlsx">Excel</button>
        <button type="button" data-x="png" title="The elevation as a picture">PNG</button>
        <button type="button" data-x="svg" title="The elevation as a drawing (SVG)">SVG</button>
        <button type="button" data-x="print">Print / PDF</button>
      </div>
    </section>`;
  V.innerHTML = `<div class="mx-bar"><span class="mx-ttl">Flat mix</span><span class="spacer"></span>${legendBtn()}</div>
    <div class="mx-body">
      ${view !== "elev" ? `<div class="mx-tblw">${tableHtml(D, can)}<label class="mx-notes"><span class="muted small">Notes under the table</span><textarea data-x="notes" rows="3"${can ? "" : " disabled"} placeholder="#Minimized corridor layout&#10;^Based on with communal area at every 2 floors">${esc((s.mix || {}).notes || "")}</textarea></label></div>` : ""}
      ${view !== "table" ? `<div class="mx-elw">${elevSvg(D)}</div>` : ""}
    </div><div class="mx-tip" hidden></div>`;
  PT.syncLegend();
}
const legendBtn = () => `<button type="button" class="pt-b" data-legend="mix" title="Legend: the flat types' colours and the uses" style="--ico:${iconColor("legend")}">${iconSvg("legend", 18)}</button>`;

/* the table, as the reference: bands with their rotated label, each type's row in its colour, the band's totals merged */
function tableHtml(D, can) {
  const T = D.T, U = saUnit();
  if (!T.bands.length) return `<p class="muted">No flats yet: give the domestic floors a unit mix (2 · Massing or 4 · Floors).</p>`;
  let h = `<table class="mx-t"><thead><tr><th class="mx-bk"></th><th colspan="2">FLAT TYPE</th><th>SA<br><small>${U}</small></th><th>Total SA<br><small>${U}</small></th><th>Unit</th><th></th><th>% by no.</th><th>% by Area</th></tr></thead><tbody>`;
  for (const b of T.bands) {
    const mid = b.rows[Math.floor(b.rows.length / 2)].color, sp = b.k === "sp";
    b.rows.forEach((r, i) => {
      const st = `background:${r.color};color:${X.ink(r.color)}`;
      h += `<tr class="${sp ? "mx-sp" : ""}">`;
      if (i === 0) h += `<td class="mx-bk" rowspan="${b.rows.length}">${sp ? "" : `<span title="${b.label}: ${b.rows.length} type${b.rows.length > 1 ? "s" : ""}">${b.rows.length > 1 ? `${b.rows.length} TYPE` : b.short}</span>`}</td>`;
      h += `<td class="mx-no" style="${st}">${can ? `<label class="mx-sw" title="Change this type's colour"><input type="color" data-x="color" data-u="${esc(r.name)}" value="${r.color}">${r.no}</label>` : r.no}</td>`;
      h += `<td class="mx-nm" style="${st}">${esc(r.name)}</td><td class="n" style="${st}">${saTxt(r.sa)}</td><td class="n" style="${st}">${saTxt(r.tot)}</td><td class="n" style="${st}">${n0(r.n)}</td>`;
      if (i === 0) h += `<td class="n mx-sub" rowspan="${b.rows.length}" style="background:${mid};color:${X.ink(mid)}">${n0(b.n)}</td><td class="n" rowspan="${b.rows.length}">${p2(b.pn)}</td><td class="n" rowspan="${b.rows.length}">${p2(b.pa)}</td>`;
      h += `</tr>`;
    });
  }
  h += `<tr class="mx-tot"><td class="mx-bk"></td><td colspan="3">TOTAL</td><td class="n">${saTxt(T.total.tot)}</td><td class="n">${n0(T.total.n)}</td><td></td><td class="n" colspan="2">100.00%</td></tr>`;
  return h + `</tbody></table>`;
}

/* ---------- the elevation (SVG) */
const K = 4.6, CW = 34, GAP = 70, LEFT = 96, TOPM = 64;
function elevSvg(D, forExport) {
  const E = D.E; if (!E.length) return `<p class="muted">No buildings in the massing.</p>`;
  const cellMode = pref("mx-cell", "sa"), noOf = new Map(D.T.bands.flatMap((b) => b.rows.map((r) => [r.name, r.no])));
  // each building's column: as wide as its widest floor; the blocks under more than one (a podium) span them
  const W = E.map((b) => X.widthOf(b) * CW);
  const x0 = []; let x = LEFT; for (const w of W) { x0.push(x); x += w + GAP; }
  const shared = new Map(); // block id -> [building index]
  E.forEach((b, i) => { for (const id of b.blocks) { const a = shared.get(id) || []; a.push(i); shared.set(id, a); } });
  const H = Math.max(...E.map((b) => b.top)) * K, totW = x - GAP + LEFT;
  const Y = (z) => TOPM + H - z * K;
  const font = "font-family:Arial,Helvetica,sans-serif";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" class="mx-el" viewBox="0 0 ${totW} ${TOPM + H + 40}" width="${totW}" height="${TOPM + H + 40}" style="${font}">`;
  s += `<defs><pattern id="mx-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f4f5f7"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9ced6" stroke-width="2"/></pattern>
    <marker id="mx-ar" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="#222"/></marker></defs>`;
  if (forExport) s += `<rect width="100%" height="100%" fill="#fff"/>`;
  const drawn = new Set();
  E.forEach((b, bi) => {
    const bx = x0[bi], bw = W[bi];
    for (const r of b.rows) {
      const y = Y(r.z0 + r.h), h = Math.max(r.h * K, 3);
      // a block standing under more than one building: drawn once, spanning them
      const sh = shared.get(r.block) || [bi];
      let rx = bx, rw = bw;
      if (sh.length > 1) {
        const key = r.block + "|" + r.z0.toFixed(3);
        if (drawn.has(key)) continue; drawn.add(key);
        rx = x0[sh[0]] - CW * 0.5; rw = x0[sh[sh.length - 1]] + W[sh[sh.length - 1]] + CW * 0.5 - rx;
      }
      const title = r.no ? `${r.no}/F` : "";
      if (r.cells) {
        const cw = (rw * (r.domShare || 1)) / r.cells.length;
        r.cells.forEach((c, ci) => {
          const cx = rx + ci * cw;
          if (c.kind === "core") { s += `<rect x="${cx}" y="${y}" width="${cw}" height="${h}" fill="#fdf6d3" stroke="#fff" stroke-width=".6"/>`; if (r.no && h >= 9) s += `<text x="${cx + cw / 2}" y="${y + h / 2 + 3}" font-size="6.5" text-anchor="middle" fill="#6b5d1f">CORE</text>`; return; }
          const col = D.T.colors[c.name] || "#ddd", t = cellMode === "no" ? `#${noOf.get(c.name) || ""}` : cellMode === "name" ? c.name : saTxt(c.sa);
          s += `<rect x="${cx}" y="${y}" width="${cw}" height="${h}" fill="${col}" stroke="#fff" stroke-width=".6" data-c="${esc(c.name)}|${c.sa}|${title}|${b.name}" data-g="${esc(c.key || "")}"/>`;
          if (h >= 9) s += `<text x="${cx + cw / 2}" y="${y + h / 2 + 3}" font-size="${cellMode === "name" ? 5.5 : 7.5}" text-anchor="middle" fill="${X.ink(col)}" pointer-events="none">${esc(cellMode === "name" ? String(t).slice(0, 10) : t)}</text>`;
        });
        if (r.bar) { let ax = rx + rw * (r.domShare || 1); for (const p of r.bar) { const pw = rw * p.share; s += band(ax, y, pw, h, p); ax += pw; } }
      } else {
        let ax = rx;
        for (const p of r.bar) { const pw = rw * p.share; s += p.empty ? `<rect x="${ax}" y="${y}" width="${pw}" height="${h}" fill="url(#mx-hatch)" stroke="#fff" stroke-width=".6"><title>${esc(title)}: no flats (no unit mix)</title></rect>` : band(ax, y, pw, h, p, !r.storey); ax += pw; }
      }
      // the floor number, small, at the column's left
      if (r.no && (bi === 0 || sh.length === 1)) s += `<text x="${rx - 3}" y="${y + h / 2 + 2.5}" font-size="6" text-anchor="end" fill="#8a929c">${r.no}</text>`;
    }
    // the floor groups: a bracket with arrows and "16 FLOOR" on the outer side
    const left = bi === 0 || E.length === 1, gx = left ? bx - 26 : bx + bw + 26;
    for (const g of b.runs) {
      const r0 = b.rows[g.from], r1 = b.rows[g.to], ya = Y(r1.z0 + r1.h), yb = Y(r0.z0);
      if (yb - ya < 14) continue;
      s += `<line x1="${gx}" y1="${ya + 1}" x2="${gx}" y2="${yb - 1}" stroke="#222" stroke-width="1.6" marker-start="url(#mx-ar)" marker-end="url(#mx-ar)"/>`;
      const tx = left ? gx - 8 : gx + 14, ty = (ya + yb) / 2;
      s += `<text x="${tx}" y="${ty}" font-size="12" font-weight="700" text-anchor="middle" transform="rotate(-90 ${tx} ${ty})">${esc(g.label)}</text>`;
    }
    // the top: the building's name and its mPD with a red mark
    const ty = Y(b.top), cx = bx + bw / 2;
    s += `<path d="M${cx - 7} ${ty - 14}h14l-7 11z" fill="#c00000"/>`;
    s += `<text x="${cx}" y="${ty - 20}" font-size="13" font-weight="700" text-anchor="middle" fill="#c00000">${b.mpd != null ? `+${b.mpd.toFixed(1)}mPD` : ""}</text>`;
    s += `<text x="${cx}" y="${ty - 38}" font-size="12" font-weight="700" text-anchor="middle" fill="#222">${esc(b.name)}</text>`;
  });
  // the ground
  s += `<line x1="${LEFT - 60}" y1="${Y(0)}" x2="${totW - 10}" y2="${Y(0)}" stroke="#333" stroke-width="1.4"/>`;
  if (D.level != null && D.level !== "") s += `<text x="${LEFT - 58}" y="${Y(0) + 13}" font-size="9" fill="#555">Site +${Number(D.level).toFixed(2)}mPD</text>`;
  return s + `</svg>`;
}
/* a band of another use: its colour, its name in capitals and its area */
function band(x, y, w, h, p, thin) {
  const u = M.USES[p.use] || {}, col = u.color || "#ccc", nm = (p.use === "transfer" ? "TP" : (u.label || p.use).replace(/ \/.*$/, "")).toUpperCase();
  const t = w > 150 && !thin && p.area ? `${nm} · ${n0(p.area)} m²` : nm;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" stroke="#fff" stroke-width=".8"><title>${esc((u.label || p.use) + (p.area ? ` · ${n0(p.area)} m²` : ""))}</title></rect>`;
  if (h >= 7 && w > 20) s += `<text x="${x + w / 2}" y="${y + h / 2 + 3}" font-size="${h >= 14 ? 8.5 : 7}" text-anchor="middle" fill="${X.ink(col)}" pointer-events="none">${esc(t)}</text>`;
  return s;
}

function hover(ev) {
  const t = $(".mx-tip"); if (!t) return;
  const c = ev.target.closest && ev.target.closest("[data-c]");
  if (!c) { t.hidden = true; return; }
  const [nm, sa, fl, bn] = c.dataset.c.split("|");
  t.innerHTML = `<b>${esc(nm)}</b><br>${saTxt(Number(sa))} ${saUnit()} · ${esc(fl)} · ${esc(bn)}<br><small class="muted">Click: open the floor (4 · Floors)</small>`;
  const V = $("#st-xview").getBoundingClientRect();
  t.style.left = (ev.clientX - V.left + 14) + "px"; t.style.top = (ev.clientY - V.top + 14) + "px"; t.hidden = false;
}

/* ---------- events */
function onChange(ev) {
  const el = ev.target.closest("[data-x]"); if (!el) return;
  const k = el.dataset.x, s = C.study();
  if (k === "unit") { setPref("mx-unit", el.value); return render(); }
  if (k === "view") { setPref("mx-view", el.value); return render(); }
  if (k === "cell") { setPref("mx-cell", el.value); return render(); }
  if (!C.can()) return;
  if (k === "color") { const mx = s.mix || (s.mix = {}); mx.colors = Object.assign({}, mx.colors || {}, { [el.dataset.u]: el.value }); C.save(); return render(); }
  if (k === "notes") { const mx = s.mix || (s.mix = {}); mx.notes = el.value.slice(0, 2000); C.save(); }
}
function onClick(ev) {
  const g = ev.target.closest("[data-g]");
  if (g && g.dataset.g) { ev.preventDefault(); FL.select(g.dataset.g); if (C.go) C.go("floors"); return; }
  const lb = ev.target.closest("[data-legend]");
  if (lb) { PT.toggleLegend(lb, "mix"); return; }
  const b = ev.target.closest("button[data-x]"); if (!b) return;
  const k = b.dataset.x;
  if (k === "png") return savePng();
  if (k === "svg") return download(new Blob([elevSvg(LAST || compute(), true)], { type: "image/svg+xml" }), fileName() + " elevation.svg");
  if (k === "xlsx") return exportXlsx();
  if (k === "print") return printPage();
}
const fileName = () => ((C.study().name || "Flat mix") + "").replace(/[\\/:*?"<>|]+/g, "_");
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function savePng() {
  const svg = elevSvg(LAST || compute(), true), m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg), w = Number(m[1]), h = Number(m[2]), k = 2;
  const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }).catch(() => null);
  const cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(url);
  cv.toBlob((b) => { if (b) { download(b, fileName() + " elevation.png"); toast("Saved the elevation (PNG)"); } }, "image/png");
}
function printPage() {
  const D = LAST || compute(), notes = esc((C.study().mix || {}).notes || "").replace(/\n/g, "<br>");
  const css = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].filter((r) => /\.mx-/.test(r.cssText)).map((r) => r.cssText).join("\n"); } catch (e) { return ""; } }).join("\n");
  const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to print", true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileName())} – flat mix</title><style>body{font-family:Arial,sans-serif;margin:16px;color:#111}${css}.mx-el{max-width:100%;height:auto}@page{size:A3 landscape;margin:10mm}</style></head><body>
    <h2>${esc(fileName())} – flat mix</h2><div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap"><div>${tableHtml(D, false)}<p style="font-size:11px;font-style:italic">${notes}</p></div><div>${elevSvg(D, true)}</div></div>
    <script>setTimeout(function(){print()},300)<\/script></body></html>`);
  w.document.close();
}
async function exportXlsx() {
  const D = LAST || compute(), U = saUnit(), cv = (m2) => (ft() ? Math.round(m2 * X.M2_FT2) : Math.round(m2 * 10) / 10);
  const rows = [], fills = [], marks = [];
  for (const b of D.T.bands) for (const [i, r] of b.rows.entries()) {
    rows.push([i === 0 ? (b.k === "sp" ? "Special" : `${b.label} · ${b.rows.length} type${b.rows.length > 1 ? "s" : ""}`) : "", r.no, r.name, cv(r.sa), cv(r.tot), r.n, i === 0 ? b.n : "", i === 0 ? Math.round(b.pn * 100) / 100 : "", i === 0 ? Math.round(b.pa * 100) / 100 : ""]);
    fills.push([null, r.color, r.color, r.color, r.color, r.color, null, null, null]); marks.push("");
  }
  rows.push(["", "", "TOTAL", "", cv(D.T.total.tot), D.T.total.n, D.T.total.n, 100, 100]); fills.push([]); marks.push("bold");
  const notes = (C.study().mix || {}).notes || "";
  // the elevation as a sheet: each floor of each building, its flats round the plate
  const erows = [], efills = [];
  const wmax = Math.max(1, ...D.E.map((b) => X.widthOf(b)));
  for (const b of D.E) for (const r of [...b.rows].reverse()) {
    if (r.cells) { erows.push([b.name, r.no ? r.no + "/F" : "", ...r.cells.map((c) => (c.kind === "core" ? "CORE" : `${c.name} (${cv(c.sa)})`))]); efills.push([null, null, ...r.cells.map((c) => (c.kind === "core" ? "#fdf6d3" : D.T.colors[c.name] || null))]); }
    else { erows.push([b.name, r.no ? r.no + "/F" : "", ...r.bar.map((p) => (p.empty ? "(no flats)" : (M.USES[p.use] || {}).label || p.use))]); efills.push([null, null, ...r.bar.map((p) => (p.empty ? null : (M.USES[p.use] || {}).color || null))]); }
  }
  const sheets = [
    { name: "Flat mix", title: "Flat mix", note: notes, head: ["Band", "#", "Flat type", `SA ${U}`, `Total SA ${U}`, "Units", "Band units", "% by no.", "% by area"], widths: [20, 6, 36, 10, 14, 8, 10, 10, 10], rows, fills, marks },
    { name: "Elevation", title: "Flat mix by floor (round the plate: north side left to right, the core, south side right to left)", head: ["Building", "Floor", ...Array.from({ length: wmax }, (_, i) => String(i + 1))], widths: [16, 8, ...Array.from({ length: wmax }, () => 16)], rows: erows, fills: efills },
  ];
  try {
    const res = await fetch("/api/gbp/xlsx", { method: "POST", headers: headers(true), body: JSON.stringify({ name: fileName() + " flat mix", sheets }) });
    if (!res.ok) { let m = "HTTP " + res.status; try { m = (await res.json()).detail || m; } catch (e) { /* none */ } throw new Error(m); }
    download(await res.blob(), fileName() + " flat mix.xlsx"); toast("Saved the flat mix (Excel)");
  } catch (e) { toast("No Excel: " + e.message, true); }
}

/* the legend: the flat types and the uses */
PT.legendItems("mix", () => {
  const sw = (c, st = "#fff") => `<rect x="2" y="2" width="24" height="12" fill="${c}" stroke="${st}" stroke-width="0.8"/>`;
  const D = LAST; const out = [];
  if (D) for (const b of D.T.bands) { out.push(b.label); for (const r of b.rows) out.push({ svg: sw(r.color, "#999"), label: `#${r.no} ${r.name}` }); }
  out.push("Other floors", { svg: sw("#fdf6d3", "#999"), label: "Core" }, { svg: `<rect x="2" y="2" width="24" height="12" fill="#eee" stroke="#999"/><path d="M4 14l8-12M12 14l8-12M20 14l6-9" stroke="#bbb"/>`, label: "Domestic floor with no flats yet" });
  for (const k of ["club", "refuge", "transfer", "lobby", "retail", "car", "em"]) out.push({ svg: sw(M.USES[k].color, "#999"), label: M.USES[k].label });
  return out;
});
