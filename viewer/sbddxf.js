/* The SBD drawings for CAD: each drawing (the plan, elevation and canyon
 * SVGs of sbd.js) read back into plain entities in metres - lines,
 * polylines, solid fills, circles and texts, each on its layer - which the
 * server writes as a DXF (AutoCAD 2000), or a DWG through the ODA File
 * Converter (POST /api/sbd/cad).
 *
 * A drawing's <svg data-cad="ax by"> gives its world: X = x + ax,
 * Y = by - y (a plan is in the model's coordinates, an elevation in metres
 * along the plane and above Level 0). Shapes carry their layer (data-l);
 * a band drawn clipped to the site is written as the region it stands for
 * (data-cad-points), and anything else clipped (the faint strips) is left
 * out.
 */
import * as Store from "./store.js";

// pattern fills as plain colours (IS dots, PE grid, Low zone exempt, a gap
// that does not count, the neighbours' buildings)
const PATTERN = { D: 0x86efac, G: 0x93c5fd, H: 0xcbd5e1, N: 0xfecaca, h: 0xe2e8f0 };

function rgbOf(c) {
  if (!c || c === "none") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return parseInt(h, 16);
}

function layerOf(el) {
  const own = el.closest("[data-l]");
  if (own) return own.getAttribute("data-l");
  const g = el.closest("g[class]");
  const cls = (g && g.getAttribute("class")) || el.getAttribute("class") || "";
  if (/sbd-scale/.test(cls)) return "SBD-SCALE";
  if (/sbd-axes/.test(cls)) return "SBD-AXES";
  if (/sbd-dim|sbd-arc|sbd-prof/.test(cls) || /sbd-wit|sbd-leader|sbd-30/.test(el.getAttribute("class") || "")) return "SBD-DIM";
  if (el.tagName === "text") return /-t$/.test(el.getAttribute("class") || "") ? "SBD-DIM" : "SBD-TEXT";
  return "SBD-MISC";
}

/* One drawing (SVG text) -> {ents, box: [x0, y0, x1, y1]} in its world, metres. */
export function svgEntities(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  const [ax, by] = (svg.getAttribute("data-cad") || "0 0").split(" ").map(Number);
  const W = (x, y) => [x + ax, by - y];
  const ents = [];
  const num = (el, k) => Number(el.getAttribute(k) || 0);
  const pts = (s) => (s || "").trim().split(/\s+/).filter(Boolean).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  const skip = (el) => el.closest("defs") || el.closest("clipPath") || (el.closest("[clip-path]") && !el.hasAttribute("data-cad-points"));
  for (const el of svg.querySelectorAll("line, polyline, polygon, rect, circle, path, text")) {
    if (skip(el)) continue;
    const l = layerOf(el);
    if (l === "-") continue;
    const stroke = rgbOf(el.getAttribute("stroke"));
    const fillA = el.getAttribute("fill") || "";
    const op = el.hasAttribute("fill-opacity") ? Number(el.getAttribute("fill-opacity")) : 1;
    const pat = /url\(#\w+?([A-Za-z])\)/.exec(fillA);
    const fill = pat ? PATTERN[pat[1]] ?? null : rgbOf(fillA);
    const t = el.tagName;
    if (t === "line") {
      ents.push({ t: "line", l, c: stroke, p: [W(num(el, "x1"), num(el, "y1")), W(num(el, "x2"), num(el, "y2"))] });
    } else if (t === "polyline" || t === "polygon") {
      const ps = pts(el.getAttribute("data-cad-points") || el.getAttribute("points")).map(([x, y]) => W(x, y));
      if (ps.length < 2) continue;
      if (t === "polygon" && fill != null && fill !== 0xffffff) ents.push({ t: "fill", l, c: fill, p: ps, a: Math.max(0.15, Math.min(1, op)) });
      if (stroke != null || t === "polyline") ents.push({ t: "pl", l, c: stroke, p: ps, closed: t === "polygon" });
    } else if (t === "rect") {
      if (el.getAttribute("width") === "100%") continue;           // the white sheet
      const x = num(el, "x"), y = num(el, "y"), w = num(el, "width"), h = num(el, "height");
      const ps = [W(x, y), W(x + w, y), W(x + w, y + h), W(x, y + h)];
      if (fill != null && fill !== 0xffffff) ents.push({ t: "fill", l, c: fill, p: ps, a: Math.max(0.15, Math.min(1, op)) });
      if (stroke != null || fill === 0xffffff) ents.push({ t: "pl", l, c: stroke, p: ps, closed: true });
    } else if (t === "circle") {
      ents.push({ t: "circle", l, c: fill ?? stroke, p: W(num(el, "cx"), num(el, "cy")), r: num(el, "r") });
    } else if (t === "path") {
      // an arc: M x,y A r,r 0 large sweep x2,y2 - sampled
      const m = /M\s*([-\d.]+)[ ,]([-\d.]+)\s*A\s*([-\d.]+)[ ,]([-\d.]+)\s+[-\d.]+\s+(\d)\s+(\d)\s+([-\d.]+)[ ,]([-\d.]+)/.exec(el.getAttribute("d") || "");
      if (!m) continue;
      const [x1, y1, r, , large, sweep, x2, y2] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => Number(m[i]));
      const dx = (x2 - x1) / 2, dy = (y2 - y1) / 2, d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const rr = Math.max(r, d), hh = Math.sqrt(Math.max(0, rr * rr - d * d));
      const sg = (large === sweep) ? -1 : 1;
      const cx = x1 + dx + sg * hh * (-dy / d), cy = y1 + dy + sg * hh * (dx / d);
      let a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
      let da = a1 - a0;
      if (sweep && da < 0) da += 2 * Math.PI;
      if (!sweep && da > 0) da -= 2 * Math.PI;
      const n = Math.max(4, Math.ceil(Math.abs(da) / (Math.PI / 24)));
      ents.push({ t: "pl", l, c: stroke, p: Array.from({ length: n + 1 }, (_, i) => W(cx + rr * Math.cos(a0 + da * i / n), cy + rr * Math.sin(a0 + da * i / n))) });
    } else if (t === "text") {
      const s = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();
      if (!s) continue;
      const tr = /rotate\(\s*([-\d.]+)/.exec(el.getAttribute("transform") || "");
      const anc = el.getAttribute("text-anchor");
      const mid = el.getAttribute("dominant-baseline") === "middle";
      ents.push({ t: "text", l, c: rgbOf(el.getAttribute("fill")), p: W(num(el, "x"), num(el, "y")), h: Number(el.getAttribute("font-size")) * 0.72,
        s, r: tr ? -Number(tr[1]) : 0, a: anc === "middle" ? "c" : anc === "end" ? "r" : "l", v: mid ? "m" : "b" });
    }
  }
  const xs = [], ys = [];
  for (const e of ents) for (const q of e.t === "circle" || e.t === "text" ? [e.p] : e.p) { xs.push(q[0]); ys.push(q[1]); }
  return { ents, box: xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0] };
}

/* Drawings [{title, svg, row}] -> one set of entities. One drawing stays
 * where it is (a plan in the model's coordinates, so it can be overlaid on
 * the site plan); several are laid out in rows (one row per zone), left to
 * right, each with its title over it. */
export function layout(drawings) {
  const all = [];
  const one = drawings.length === 1;
  const rows = [...new Set(drawings.map((d) => d.row || 0))];
  let top = 0;
  for (const row of rows) {
    let x = 0, rowH = 0;
    const items = drawings.filter((d) => (d.row || 0) === row).map((d) => Object.assign({ d }, svgEntities(d.svg)));
    for (const { d, ents, box } of items) {
      const w = box[2] - box[0], h = box[3] - box[1];
      const ox = one ? 0 : x - box[0], oy = one ? 0 : top - box[3];
      const mv = (q) => [q[0] + ox, q[1] + oy];
      for (const e of ents) all.push(Object.assign({}, e, { p: e.t === "circle" || e.t === "text" ? mv(e.p) : e.p.map(mv) }));
      const th = Math.max(1, Math.max(w, h) * 0.025);
      if (d.title) all.push({ t: "text", l: "SBD-TITLE", c: 0x0f172a, p: [box[0] + ox, box[3] + oy + th * 0.8], h: th, s: d.title, r: 0, a: "l", v: "b" });
      x += w + Math.max(20, w * 0.1);
      rowH = Math.max(rowH, h);
    }
    top -= rowH + Math.max(40, rowH * 0.2);
  }
  return all;
}

/* Send the entities; the file comes back to save. */
export async function downloadCad(ents, name, format) {
  const r = await fetch(`/api/sbd/cad?format=${encodeURIComponent(format)}&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, Store.authHeaders()), body: JSON.stringify({ ents }),
  });
  if (!r.ok) {
    let m = "HTTP " + r.status;
    try { m = (await r.json()).detail || m; } catch (e) {}
    throw new Error(m);
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, "_") + "." + format;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return blob.size;
}
