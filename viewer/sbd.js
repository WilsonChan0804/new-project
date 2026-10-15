/* SBD on the 3D page (Checks > SBD): PNAP APP-152 Design Requirement (2),
 * permeability P and separating distances S1 / S2 / S3, and (1) the street
 * canyon U, from the building masses exported from Revit (SBD Export).
 *
 * The server (server/sbd) cuts the masses into the Low (0-20 m), Middle
 * (20-60 m) and High (60 m +) zones and runs the SBD panel's rules on each
 * zone's own footprints. This tab shows the result: the table, a plan of
 * each zone (the gaps green or red, the pinch points, the air corridors),
 * the masses and zones in 3D, and keeps results, issues and a report.
 */
import * as Store from "./store.js";
import { reportTab, tabSay, writeReport } from "./checkexport.js";
import { dueIn, nextNumber, numberText } from "./checkissue.js";

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ZONE_LABEL = { LOW: "Low (0-20 m)", MIDDLE: "Middle (20-60 m)", HIGH: "High (60 m +)" };
const ZONE_COLOR = { LOW: "#f59e0b", MIDDLE: "#3b82f6", HIGH: "#8b5cf6" };
// every number on the SBD drawings and in the working: 3 decimals
const f3 = (v) => (v == null ? "-" : Number(v).toFixed(3));
const f1 = f3, f2 = f3;
// a gap's S value: as measured (side region's Area / Depth, the corridor's
// width, S2 / S3) - the projected width only for a blocked gap
const gapM = (g) => (g.type === "FAIL" || g.type === "OPEN" || !g.distance_m ? g.width_m : g.distance_m);
// the gaps numbered S1, S2, S3 ... in order along the plane (as GB082):
// gap index -> "S1"; its kind in words
export function gapNums(ax) {
  const m = new Map();
  let n = 0;
  for (const it of (ax && ax.edge) || []) if (it.kind === "gap" && it.gap != null && !m.has(it.gap)) m.set(it.gap, "S" + (++n));
  ((ax && ax.gaps) || []).forEach((g, i) => { if (!m.has(i)) m.set(i, "S" + (++n)); });
  return m;
}
const gapKind = (g) => (g.side ? "side setback" : g.corridor ? "air corridor" : g.type === "FAIL" ? "blocked" : g.type === "OPEN" ? "open" : g.type === "S3" ? "angled boundary" : g.type === "S2" ? "between buildings" : "setback");
// the working of one gap, as the Plan and the report give it
function gapHow(g, ax, num) {
  const sd = g.side && ax.sides && ax.sides[g.side];
  const k = num.slice(1);
  if (sd) return `${num} = A${k} / L${k} = ${f3(sd.area_m2)} m² / ${f3(sd.depth_m)} m = ${f3(sd.avg_m)} m${sd.angle_deg ? `, edge turned ${f3(Math.abs(sd.angle_deg))}°` : ""}`;
  if (g.corridor) return `${num} = air corridor width ${f3(g.distance_m)} m${g.bend_deg ? `, turned ${f3(Math.abs(g.bend_deg))}°` : ", straight"}`;
  if (g.type === "S3") return `${num} = A / D = ${f3(g.area_m2)} m² / ${f3(g.depth_m)} m = ${f3(g.distance_m)} m`;
  if (g.type === "S1") return `${num} = projected width ${f3(gapM(g))} m`;
  if (g.type === "S2") return `${num} = nearest distance between the buildings ${f3(gapM(g))} m`;
  return `${num}: ${f3(gapM(g))} m, blocked`;
}
// a canyon's name, as GB081: A, B ... per building, B1, B2 ... with streets
const canyonLetter = (bi, j, n) => String.fromCharCode(65 + bi) + (n > 1 ? String(j + 1) : "");
// Design Requirement (1) for one building, as GB081's calculation
function canyonWorking(b, bi) {
  const rows = [];
  const st = b.streets || [];
  st.forEach((r, j) => {
    const L = canyonLetter(bi, j, st.length);
    rows.push([`U${L}`, `Street Canyon Area ${L} / Length ${L} (${r.street}) = ${f3(r.area_m2)} m² / ${f3(r.L_m)} m = ${f3(r.U_m)} m`]);
  });
  const ci = Math.max(0, st.findIndex((r) => r.street === b.ctrl_street));
  const Lc = canyonLetter(bi, ci, st.length);
  if (st.length > 1) rows.push(["Controlling U", st.map((r, j) => `U${canyonLetter(bi, j, st.length)}`).sort((x, y) => (x === `U${Lc}` ? -1 : y === `U${Lc}` ? 1 : 0)).join(" < ") + ` - U${Lc} = ${f3(b.U_m)} m`]);
  rows.push([`Max Lp`, `5 x U${Lc} = 5 x ${f3(b.U_m)} = ${f3(b.Lp_max_m)} m`]);
  rows.push([`Actual Lp`, `${f3(b.Lp_m)} m (the facade projected on the street)`]);
  rows.push(["Result", b.pass ? `Actual Lp ${f3(b.Lp_m)} m < Max Lp ${f3(b.Lp_max_m)} m - complies with the requirement of continuous projected facade length (Lp) of building(s) abutting a street`
    : `Actual Lp ${f3(b.Lp_m)} m > Max Lp ${f3(b.Lp_max_m)} m - does NOT comply`]);
  return rows;
}
// a round length for a scale bar about a quarter of w
function niceLen(w) {
  const c = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return c.reduce((b, x) => (Math.abs(x - w / 4) < Math.abs(b - w / 4) ? x : b), c[0]);
}

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: Object.assign({ "Content-Type": "application/json" }, Store.authHeaders()) }, opts || {}));
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return d;
}

/* The plan of one zone as SVG (metres, north up as modelled). */
export function zoneSvg(res, zone, axisKey, opt) {
  opt = opt || {};
  const z = (res.zones || []).find((x) => x.zone === zone);
  if (!z) return "";
  const streets = res.streets || [];
  const pts = [...res.site, ...z.footprints.flatMap((f) => f.loop), ...streets.flatMap((s) => (s.outline && s.outline.length ? s.outline : s.centreline))];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.14 + 6;      // room for the near edge's dimensions
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W = x1 - x0, H = y1 - y0;
  const P = (p) => `${(p[0] - x0).toFixed(3)},${(y1 - p[1]).toFixed(3)}`;
  const poly = (loop) => loop.map(P).join(" ");
  const fs = Math.max(W, H) / 60;          // label size in metres
  const ax = z[axisKey];
  const id = "c" + Math.random().toString(36).slice(2, 8);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" class="sbd-svg"${opt.w ? ` width="${opt.w}" height="${Math.round(opt.w * H / W)}"` : ""} font-family="system-ui,sans-serif">`
    + `<defs><clipPath id="${id}"><polygon points="${poly(res.site)}"/></clipPath>`
    + `<pattern id="${id}h" width="${fs}" height="${fs}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${fs}" stroke="#94a3b8" stroke-width="${fs / 8}"/></pattern></defs>`
    + `<rect width="100%" height="100%" fill="#fff"/>`
    + `<polygon points="${poly(res.site)}" fill="#f8fafc" stroke="#0f172a" stroke-width="${fs / 6}" stroke-dasharray="${fs} ${fs / 3}"/>`;
  // the streets: the slab, its centreline (dash-dot) and the opposite boundary
  for (const st of streets) {
    if (st.outline && st.outline.length) s += `<polygon points="${poly(st.outline)}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="${fs / 12}"/>`;
    if (st.centreline && st.centreline.length > 1) {
      s += `<polyline points="${poly(st.centreline)}" fill="none" stroke="#64748b" stroke-width="${fs / 10}" stroke-dasharray="${fs} ${fs / 3} ${fs / 6} ${fs / 3}"/>`;
      const m = st.centreline[Math.floor(st.centreline.length / 2)];
      s += `<text x="${(m[0] - x0).toFixed(2)}" y="${(y1 - m[1] - fs * 0.4).toFixed(2)}" font-size="${fs * 0.9}" text-anchor="middle" fill="#475569" font-style="italic">℄ ${esc(st.name || "Street")}</text>`;
    }
    if (st.opposite && st.opposite.length > 1) s += `<polyline points="${poly(st.opposite)}" fill="none" stroke="#0f172a" stroke-width="${fs / 8}"/>`;
  }
  // the gaps: strips across the site (faint: the projection), green when
  // they count, red when not; the S1 side regions (Area / Depth) and the S2
  // corridors are drawn over them as measured
  if (ax) {
    const measured = (g) => (g.side && ax.sides && ax.sides[g.side]) || g.corridor;
    s += `<g clip-path="url(#${id})">` + ax.gaps.map((g) => `<polygon points="${poly(g.strip)}" fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity="${measured(g) ? ".07" : ".22"}" stroke="${g.qualifies ? "#16a34a" : "#dc2626"}" stroke-width="${fs / 14}" stroke-dasharray="${measured(g) ? `${fs / 3} ${fs / 4}` : "none"}"/>`).join("") + `</g>`;
    for (const k of ["left", "right"]) {
      const sd = ax.sides && ax.sides[k];
      if (!sd || !sd.polygon || sd.polygon.length < 3) continue;
      const g = ax.gaps.find((x) => x.side === k);
      const ok = g ? g.qualifies : sd.avg_m >= 7.5;
      // the band (its inner edge carried past the site), clipped to the site:
      // the hatch runs to the boundary
      s += `<polygon points="${poly(sd.band || sd.polygon)}"${sd.band ? ` clip-path="url(#${id})"` : ""} fill="${ok ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${ok ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
    for (const g of ax.gaps) {
      if (g.corridor && g.corridor.length > 2) s += `<polygon points="${poly(g.band || g.corridor)}"${g.band ? ` clip-path="url(#${id})"` : ""} fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${g.qualifies ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
  }
  // the neighbours' buildings, and this zone's
  s += (z.others || []).map((l) => `<polygon points="${poly(l)}" fill="url(#${id}h)" stroke="#94a3b8" stroke-width="${fs / 12}"/>`).join("");
  s += z.footprints.map((f) => `<polygon points="${poly(f.loop)}" fill="#475569" fill-opacity=".55" stroke="#1e293b" stroke-width="${fs / 10}"/>`).join("");
  // the air corridors (dashed blue outline over the measured band)
  s += ((ax && ax.gaps.filter((g) => g.corridor).map((g) => ({ polygon: g.band || g.corridor, band: !!g.band }))) || z.corridors || []).map((c) => `<polygon points="${poly(c.polygon)}"${c.band ? ` clip-path="url(#${id})"` : ""} fill="none" stroke="#2563eb" stroke-width="${fs / 7}" stroke-dasharray="${fs / 2} ${fs / 3}"/>`).join("");
  // the buildings' names (the same on the elevations)
  s += (z.buildings || []).map((b) => `<text x="${(b.at[0] - x0).toFixed(2)}" y="${(y1 - b.at[1]).toFixed(2)}" font-size="${fs * 1.1}" font-weight="700" text-anchor="middle" fill="#fff" stroke="#1e293b" stroke-width="${fs / 6}" paint-order="stroke"><title>${esc(b.name || "")}</title>${esc(b.label)}</text>`).join("");
  // a dimension line a-e (plan metres), with ticks and its text
  const dim = (pa, pe, text, col, cls) => {
    const [a, e] = [pa, pe].map((p) => [p[0] - x0, y1 - p[1]]);
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const tx = -(e[1] - a[1]) / L * fs * 0.5, ty = (e[0] - a[0]) / L * fs * 0.5;
    let deg = Math.atan2(e[1] - a[1], e[0] - a[0]) * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const m = [(a[0] + e[0]) / 2 - tx * 1.8, (a[1] + e[1]) / 2 - ty * 1.8];
    return `<g class="${cls || "sbd-dim"}"><line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${e[0].toFixed(2)}" y2="${e[1].toFixed(2)}" stroke="${col}" stroke-width="${fs / 8}"/>`
      + [a, e].map((p) => `<line x1="${(p[0] - tx).toFixed(2)}" y1="${(p[1] - ty).toFixed(2)}" x2="${(p[0] + tx).toFixed(2)}" y2="${(p[1] + ty).toFixed(2)}" stroke="${col}" stroke-width="${fs / 8}"/>`).join("")
      + `<text x="${m[0].toFixed(2)}" y="${m[1].toFixed(2)}" font-size="${fs * 0.8}" text-anchor="middle" dominant-baseline="middle" fill="${col}" transform="rotate(${deg.toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)})" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${esc(text)}</text></g>`;
  };
  // an angle symbol: the arc from direction d0 to d1 (unit, plan) at p, and its value
  const arc = (p, d0, d1, text, col) => {
    const r = fs * 3;
    const a0 = Math.atan2(d0[1], d0[0]), a1 = Math.atan2(d1[1], d1[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const q = (a) => [p[0] + Math.cos(a) * r - x0, y1 - (p[1] + Math.sin(a) * r)];
    const [b0, b1, bm] = [q(a0), q(a0 + da), q(a0 + da / 2)];
    const tl = [p[0] + Math.cos(a0 + da / 2) * r * 1.6 - x0, y1 - (p[1] + Math.sin(a0 + da / 2) * r * 1.6)];
    return `<g class="sbd-arc"><line x1="${(p[0] - x0).toFixed(2)}" y1="${(y1 - p[1]).toFixed(2)}" x2="${b0[0].toFixed(2)}" y2="${b0[1].toFixed(2)}" stroke="${col}" stroke-width="${fs / 12}" stroke-dasharray="${fs / 3} ${fs / 5}"/>`
      + `<path d="M${b0[0].toFixed(2)},${b0[1].toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 0 ${da > 0 ? 0 : 1} ${b1[0].toFixed(2)},${b1[1].toFixed(2)}" fill="none" stroke="${col}" stroke-width="${fs / 8}"/>`
      + `<circle cx="${bm[0].toFixed(2)}" cy="${bm[1].toFixed(2)}" r="${fs / 6}" fill="${col}"/>`
      + `<text x="${tl[0].toFixed(2)}" y="${tl[1].toFixed(2)}" font-size="${fs * 0.8}" text-anchor="middle" dominant-baseline="middle" fill="${col}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${esc(text)}</text></g>`;
  };
  // the edge of a band where it turns off the perpendicular: the segment
  // whose angle to it is closest to the reported one
  const turnAt = (pts, avv, deg) => {
    if (!pts || pts.length < 2 || !deg || Math.abs(deg) < 0.05) return null;
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
      const L = Math.hypot(d[0], d[1]);
      if (L < 1e-6) continue;
      const u = [d[0] / L, d[1] / L];
      const s0 = Math.sign(u[0] * avv[0] + u[1] * avv[1]) || 1;
      const pv = [avv[0] * s0, avv[1] * s0];
      const ang = Math.acos(Math.max(-1, Math.min(1, u[0] * pv[0] + u[1] * pv[1]))) * 180 / Math.PI;
      if (!best || Math.abs(ang - Math.abs(deg)) < Math.abs(best.ang - Math.abs(deg))) best = { p: pts[i], pv, u, ang };
    }
    return best && best.ang > 0.05 ? best : null;
  };
  if (ax) {
    const num = gapNums(ax);
    const avv = [-ax.axis[1], ax.axis[0]];
    for (const [i, g] of ax.gaps.entries()) {
      if (g.pinch) {
        const [a, b] = g.pinch;
        s += `<line x1="${(a[0] - x0).toFixed(3)}" y1="${(y1 - a[1]).toFixed(3)}" x2="${(b[0] - x0).toFixed(3)}" y2="${(y1 - b[1]).toFixed(3)}" stroke="${g.pass ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 6}"/>`;
      }
      // the label in the middle of what was measured (side region, corridor or strip)
      const shape = (g.side && ax.sides && ax.sides[g.side] && ax.sides[g.side].polygon) || g.corridor || g.strip;
      const c = shape.reduce((m, p) => [m[0] + p[0] / shape.length, m[1] + p[1] / shape.length], [0, 0]);
      const sd = g.side && ax.sides && ax.sides[g.side];
      const nm = num.get(i);
      const col = g.qualifies ? "#14532d" : "#7f1d1d";
      s += `<text x="${(c[0] - x0).toFixed(2)}" y="${(y1 - c[1]).toFixed(2)}" font-size="${fs}" text-anchor="middle" fill="${col}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke"><title>${esc(gapKind(g))}</title>${esc(`${nm} = ${f3(gapM(g))} m`)}</text>`;
      if (sd) {
        // A (the hatch's area) and L (its depth across the plane): S = A / L
        const k = nm.slice(1);
        s += `<text x="${(c[0] - x0).toFixed(2)}" y="${(y1 - c[1] + fs * 1.2).toFixed(2)}" font-size="${fs * 0.8}" text-anchor="middle" fill="${col}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${esc(`A${k} = ${f3(sd.area_m2)} m²`)}</text>`;
        const uv = sd.polygon.map((p) => [p[0] * ax.axis[0] + p[1] * ax.axis[1], p[0] * avv[0] + p[1] * avv[1]]);
        const us = uv.map((q) => q[0]), vs = uv.map((q) => q[1]);
        const sc = res.site.map((p) => p[0] * ax.axis[0] + p[1] * ax.axis[1]);
        const mid = (Math.min(...sc) + Math.max(...sc)) / 2;
        const out = (Math.min(...us) + Math.max(...us)) / 2 < mid ? Math.min(...us) - fs * 1.5 : Math.max(...us) + fs * 1.5;
        const P2 = (u, v) => [u * ax.axis[0] + v * avv[0], u * ax.axis[1] + v * avv[1]];
        s += dim(P2(out, Math.min(...vs)), P2(out, Math.max(...vs)), `L${k} = ${f3(sd.depth_m)} m`, col, "sbd-dim sbd-ldim");
      }
      // the turn (any angle 0-15°): an arc from the perpendicular
      const deg = g.corridor ? g.bend_deg : sd ? sd.angle_deg : null;
      const edge = g.corridor && g.band ? g.band.slice(0, g.band.length / 2) : sd ? sd.edge : null;
      const t = turnAt(edge, avv, deg);
      if (t) s += arc(t.p, t.pv, t.u, `${f3(Math.abs(deg))}°`, "#7c3aed");
    }
    // the near edge (the street side): the gaps and the buildings' shadows
    // as Plane X sees them - the widths the elevation is laid out with
    if (ax.near && (ax.edge || []).length) {
      const av = [-ax.axis[1], ax.axis[0]];
      const sg = ax.near.low ? -1 : 1;
      const v = ax.near.v_m + sg * fs * 2.4;
      const at = (u, vv) => [u * ax.axis[0] + vv * av[0] - x0, y1 - (u * ax.axis[1] + vv * av[1])];
      let deg = Math.atan2(-ax.axis[1], ax.axis[0]) * 180 / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      const line = (p, q, c, w) => `<line x1="${p[0].toFixed(2)}" y1="${p[1].toFixed(2)}" x2="${q[0].toFixed(2)}" y2="${q[1].toFixed(2)}" stroke="${c}" stroke-width="${w}"/>`;
      s += `<g class="sbd-dims">` + line(at(ax.edge[0].lo, v), at(ax.edge[ax.edge.length - 1].hi, v), "#0f172a", fs / 12);
      for (const it of ax.edge) {
        for (const u of [it.lo, it.hi]) s += line(at(u, v - sg * fs * 0.5), at(u, v + sg * fs * 0.5), "#0f172a", fs / 12);
        const col = it.kind === "gap" ? (it.pass ? "#15803d" : "#b91c1c") : "#334155";
        s += line(at(it.lo, v), at(it.hi, v), col, fs / 5);
        const m = at((it.lo + it.hi) / 2, v + sg * fs * 0.9);
        const txt = it.kind === "gap" ? `${num.get(it.gap) || it.label} ${f3(it.s_m)}${it.pass ? "" : " ✗"} (proj ${f3(it.hi - it.lo)})` : `${it.label} ${f3(it.hi - it.lo)}`;
        s += `<text x="${m[0].toFixed(2)}" y="${m[1].toFixed(2)}" font-size="${fs * 0.75}" text-anchor="middle" dominant-baseline="middle" fill="${col}" transform="rotate(${deg.toFixed(2)} ${m[0].toFixed(2)} ${m[1].toFixed(2)})" stroke="#fff" stroke-width="${fs / 6}" paint-order="stroke">${esc(txt)}</text>`;
      }
      s += `</g>`;
    }
    // Axis 1 and Axis 2 (the one drawn, bold) and the angle between them
    // drawn at the top left corner, clear of the plan
    const L = Math.max(W, H) * 0.08;
    const ctr = [x0 + L * 1.6, y1 - L * 1.6];
    s += `<defs>${[["axis1", "#f28022"], ["axis2", "#7c3aed"]].map(([k, c]) => `<marker id="${id}${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}</defs>`;
    for (const k of ["axis1", "axis2"]) {
      const a = z[k] && z[k].axis;
      if (!a) continue;
      const e = [ctr[0] + a[0] * L, ctr[1] + a[1] * L];
      const col = k === "axis1" ? "#f28022" : "#7c3aed";
      s += `<line x1="${(ctr[0] - x0).toFixed(2)}" y1="${(y1 - ctr[1]).toFixed(2)}" x2="${(e[0] - x0).toFixed(2)}" y2="${(y1 - e[1]).toFixed(2)}" stroke="${col}" stroke-width="${k === axisKey ? fs / 4 : fs / 9}" marker-end="url(#${id}${k})"/>`
        + `<text x="${(e[0] + a[0] * fs - x0).toFixed(2)}" y="${(y1 - e[1] - a[1] * fs).toFixed(2)}" font-size="${fs}" fill="${col}" text-anchor="middle" font-weight="${k === axisKey ? 700 : 400}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${k === "axis1" ? "Axis 1 (X)" : "Axis 2 (Y)"}</text>`;
    }
    if (z.axis1 && z.axis2) {
      const a1 = z.axis1.axis, a2 = z.axis2.axis;
      const ang = Math.acos(Math.max(-1, Math.min(1, a1[0] * a2[0] + a1[1] * a2[1]))) * 180 / Math.PI;
      s += arc(ctr, a1, a2, `${f3(ang)}°`, "#0f172a");
    }
  }
  // Design Requirement (1): the street canyon of each building facing a
  // street in this zone, its facade, and Lp along the street
  if (opt.canyon) {
    // as GB081: each canyon hatched with its area, the Actual Lp beyond the
    // building, the Length beyond the opposite boundary, a typical width
    for (const c of (res.case1 || []).filter((x) => x.zone === zone)) {
      c.buildings.forEach((b, bi) => {
        const col = b.pass ? "#15803d" : "#dc2626";
        (b.streets || []).forEach((r, j) => {
          const L = canyonLetter(bi, j, b.streets.length);
          for (const pg of r.canyon || []) s += `<polygon points="${poly(pg)}" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="${fs / 12}"/>`;
          for (const f of r.facade || []) s += `<polyline points="${poly(f)}" fill="none" stroke="${col}" stroke-width="${fs / 4}"/>`;
          const pg = (r.canyon || [])[0];
          if (pg) {
            const ct = pg.reduce((m, p) => [m[0] + p[0] / pg.length, m[1] + p[1] / pg.length], [0, 0]);
            s += `<text x="${(ct[0] - x0).toFixed(2)}" y="${(y1 - ct[1] - fs * 0.5).toFixed(2)}" font-size="${fs * 0.85}" text-anchor="middle" fill="#7f1d1d" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">STREET CANYON AREA ${L}</text>`
              + `<text x="${(ct[0] - x0).toFixed(2)}" y="${(y1 - ct[1] + fs * 0.6).toFixed(2)}" font-size="${fs * 0.85}" text-anchor="middle" fill="#7f1d1d" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">= ${f3(r.area_m2)} m²</text>`;
          }
          if (r.lp_line) s += dim(r.lp_line[0], r.lp_line[1], `ACTUAL Lp${L} = ${f3(r.Lp_m)} m`, "#b91c1c", "sbd-dim sbd-lpdim");
          if (r.len_line) s += dim(r.len_line[0], r.len_line[1], `LENGTH ${L} = ${f3(r.L_m)} m`, "#b91c1c", "sbd-dim sbd-lendim");
          if (r.width_dim) s += dim(r.width_dim[0], r.width_dim[1], `${f3(r.width_dim[2])} m`, "#b91c1c", "sbd-dim");
        });
      });
    }
  }
  // the scale bar: 0 - half - a round length about a quarter of the drawing
  {
    const SL = niceLen(W), h = fs * 0.5, bx = fs, by = H - fs * 1.5;
    s += `<g class="sbd-scale">` + [0, 1, 2, 3].map((i) => `<rect x="${(bx + SL / 4 * i).toFixed(2)}" y="${by.toFixed(2)}" width="${(SL / 4).toFixed(2)}" height="${h.toFixed(2)}" fill="${i % 2 ? "#fff" : "#0f172a"}" stroke="#0f172a" stroke-width="${fs / 20}"/>`).join("")
      + [[0, "0"], [SL / 2, String(SL / 2)], [SL, SL + " m"]].map(([d, t]) => `<text x="${(bx + d).toFixed(2)}" y="${(by - fs * 0.3).toFixed(2)}" font-size="${fs * 0.75}" text-anchor="middle">${t}</text>`).join("") + `</g>`;
  }
  return s + `</svg>`;
}

/* A zone's elevational projection on one plane (Fig B10 / B11, the BD
 * sample case): the buildings, the IS (in the gaps that count, and open to
 * above over a lower building), the PE (voids >= 3 m x 3 m) and, in the Low
 * zone, the portion <= 1/3 H disregarded. */
const ELEV_KIND = {
  bldg: { fill: "#94a3b8", label: "building" },
  exempt: { fill: "url(#H)", label: "Low zone portion ≤ 1/3 H, disregarded" },
  is: { fill: "url(#D)", label: "IS" },
  sky: { fill: "url(#D)", label: "IS (open to above)" },
  pe: { fill: "url(#G)", label: "PE" },
  nis: { fill: "url(#N)", label: "a gap that does not count" },
  open: { fill: "#fff", label: "open, not counted" },
};
export function elevSvg(res, zone, axisKey, opt) {
  opt = opt || {};
  const z = (res.zones || []).find((x) => x.zone === zone);
  const e = z && z[axisKey] && z[axisKey].elev;
  if (!e) return "";
  const fs = Math.max(e.W_m, e.H_m * 2) / 55;
  const num = gapNums(z[axisKey]);
  const gz = res.ground_z;
  const L = fs * 13, T = fs * 7, Bm = fs * 7, R = fs * 2;
  const VW = L + e.W_m + R, VH = T + e.H_m + Bm;
  const id = "e" + Math.random().toString(36).slice(2, 8);
  const X = (u) => (L + u).toFixed(3), Y = (h) => (T + e.H_m - h).toFixed(3);
  const fill = (k) => (ELEV_KIND[k] || ELEV_KIND.open).fill.replace(/url\(#(\w)\)/, `url(#${id}$1)`);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW.toFixed(2)} ${VH.toFixed(2)}" class="sbd-svg"${opt.w ? ` width="${opt.w}" height="${Math.round(opt.w * VH / VW)}"` : ""} font-family="system-ui,sans-serif">`
    + `<defs><pattern id="${id}H" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="#cbd5e1"/><line x1="0" y1="0" x2="0" y2="${fs * 0.8}" stroke="#334155" stroke-width="${fs / 6}"/></pattern>`
    + `<pattern id="${id}D" width="${fs * 0.7}" height="${fs * 0.7}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dcfce7"/><circle cx="${fs * 0.35}" cy="${fs * 0.35}" r="${fs / 9}" fill="#15803d"/></pattern>`
    + `<pattern id="${id}N" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="100%" height="100%" fill="#fff"/><line x1="0" y1="0" x2="0" y2="${fs * 0.8}" stroke="#dc2626" stroke-width="${fs / 8}"/></pattern>`
    + `<pattern id="${id}G" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dbeafe"/><path d="M0 0H${fs * 0.8}M0 0V${fs * 0.8}" stroke="#1d4ed8" stroke-width="${fs / 10}"/></pattern></defs>`
    + `<rect width="100%" height="100%" fill="#fff"/>`;
  for (const [u0, u1, h0, h1, k] of e.rects) {
    s += `<rect x="${X(u0)}" y="${Y(h1)}" width="${(u1 - u0).toFixed(3)}" height="${(h1 - h0).toFixed(3)}" fill="${fill(k)}" stroke="${k === "bldg" ? "#475569" : k === "nis" ? "#dc2626" : "none"}" stroke-width="${fs / 14}"/>`;
  }
  // the counted parts, numbered IS1, IS2 ... (PE1 ...) with their sizes
  for (const [i, [u0, u1, h0, h1, k]] of isParts(e).entries()) {
    if (u1 - u0 < fs * 2 || h1 - h0 < fs * 1.2) continue;
    const nm = (k === "pe" ? "PE" : "IS") + (i + 1);
    s += `<text x="${X((u0 + u1) / 2)}" y="${Y((h0 + h1) / 2 + fs * 0.2)}" font-size="${fs * 0.8}" text-anchor="middle" fill="${k === "pe" ? "#1e3a8a" : "#14532d"}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${nm}</text>`
      + `<text x="${X((u0 + u1) / 2)}" y="${Y((h0 + h1) / 2 - fs * 0.9)}" font-size="${fs * 0.65}" text-anchor="middle" fill="${k === "pe" ? "#1e3a8a" : "#14532d"}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${f3(u1 - u0)} x ${f3(h1 - h0)}</text>`;
  }
  // the buildings' profile: each step of their tops dimensioned above the
  // zone, and its height
  const prof = profile(e);
  if (prof.length) {
    const yp = T - fs * 2.4;
    const tk = (x) => `<line x1="${X(x)}" y1="${yp - fs / 2}" x2="${X(x)}" y2="${yp + fs / 2}" stroke="#1d4ed8" stroke-width="${fs / 10}"/>`;
    s += `<g class="sbd-prof"><line x1="${X(prof[0][0])}" y1="${yp}" x2="${X(prof[prof.length - 1][1])}" y2="${yp}" stroke="#1d4ed8" stroke-width="${fs / 10}"/>`;
    for (const [a, b, h] of prof) {
      s += tk(a) + tk(b) + `<line x1="${X(a)}" y1="${yp}" x2="${X(a)}" y2="${Y(h)}" stroke="#1d4ed8" stroke-width="${fs / 20}" stroke-dasharray="${fs / 3} ${fs / 4}"/>`
        + (b - a >= fs * 2.5 ? `<text x="${X((a + b) / 2)}" y="${yp - fs * 0.35}" font-size="${fs * 0.7}" text-anchor="middle" fill="#1d4ed8">${f3(b - a)}</text>` : "")
        + `<text x="${X((a + b) / 2)}" y="${Number(Y(h)) + fs * 1.1}" font-size="${fs * 0.65}" text-anchor="middle" fill="#0f172a">h ${f3(h)}</text>`;
    }
    s += tk(prof[prof.length - 1][1]) + `</g>`;
  }
  // the zone frame (dashed red, as in the sample), its levels and W
  s += `<rect x="${X(0)}" y="${Y(e.H_m)}" width="${e.W_m}" height="${e.H_m}" fill="none" stroke="#dc2626" stroke-width="${fs / 8}" stroke-dasharray="${fs} ${fs / 2}"/>`;
  s += `<line x1="${X(-fs)}" y1="${Y(0)}" x2="${X(e.W_m + fs)}" y2="${Y(0)}" stroke="#dc2626" stroke-width="${fs / 5}"/>`;
  const lev = (h, t) => `<text x="${X(-fs * 0.6)}" y="${(Number(Y(h)) + fs * 0.35).toFixed(2)}" font-size="${fs * 0.9}" text-anchor="end" fill="#0f172a">${t}</text>`;
  const lv = (h) => `${f3(h)} m` + (gz != null ? ` (+${f3(gz + h)})` : "");
  s += lev(0, lv(e.z0) + (e.z0 ? "" : " Level 0")) + lev(e.H_m, lv(e.z0 + e.H_m));
  if (e.exempt_m) s += lev(e.exempt_m, `1/3 H ${f2(e.exempt_m)}`);
  // the dimensions: each gap at its S value, each shadow at its width on
  // the near edge - the numbers on the plan - then W, their sum
  const yb = T + e.H_m + fs * 2.2;
  const tick = (x) => `<line x1="${X(x)}" y1="${yb - fs / 2}" x2="${X(x)}" y2="${yb + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/>`;
  s += `<line x1="${X(0)}" y1="${yb}" x2="${X(e.W_m)}" y2="${yb}" stroke="#0f172a" stroke-width="${fs / 10}"/>`;
  for (const it of e.items || []) {
    const col = it.kind === "gap" ? (it.pass ? "#15803d" : "#b91c1c") : "#334155";
    s += tick(it.x0) + tick(it.x1)
      + `<text x="${X((it.x0 + it.x1) / 2)}" y="${yb - fs * 0.35}" font-size="${fs * 0.8}" text-anchor="middle" fill="${col}" stroke="#fff" stroke-width="${fs / 6}" paint-order="stroke">${esc(it.kind === "gap" ? `${num.get(it.gap) || it.label} ${f3(it.w_m)}${it.pass ? "" : " ✗"}` : `${it.label} ${f3(it.w_m)}`)}</text>`;
  }
  const yw = yb + fs * 2.4;
  s += `<line x1="${X(0)}" y1="${yw}" x2="${X(e.W_m)}" y2="${yw}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<line x1="${X(0)}" y1="${yw - fs / 2}" x2="${X(0)}" y2="${yw + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/><line x1="${X(e.W_m)}" y1="${yw - fs / 2}" x2="${X(e.W_m)}" y2="${yw + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<text x="${X(e.W_m / 2)}" y="${yw - fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="#0f172a">W ${f2(e.W_m)} m</text>`
    + `<text x="${X(e.W_m / 2)}" y="${yw + fs * 1.4}" font-size="${fs * 0.9}" text-anchor="middle" fill="#475569">Deformed elevation on ${axisKey === "axis1" ? "Projection Plane X" : "Projection Plane Y"} · H ${f2(e.H_m)} m</text>`
    + `<text x="${X(0)}" y="${fs * 1.6}" font-size="${fs * 1.1}" fill="#0f172a" font-weight="600">${esc(ZONE_LABEL[zone] || zone)} · P = ${f2(e.P_is)} % IS + ${f2(e.P_pe)} % PE = ${f2(e.P)} %</text>`;
  return s + `</svg>`;
}

/* The IS / PE rectangles of an elevation, left to right. */
function isParts(e) {
  return e.rects.filter((q) => ["is", "sky", "pe"].includes(q[4])).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
}
/* The buildings' top profile: [[x0, x1, top]] where a building stands. */
function profile(e) {
  const b = e.rects.filter((q) => q[4] === "bldg");
  const xs = [...new Set(b.flatMap((q) => [q[0], q[1]]))].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const m = (xs[i] + xs[i + 1]) / 2;
    const top = Math.max(0, ...b.filter((q) => q[0] <= m && m <= q[1]).map((q) => q[3]));
    if (top <= 0) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - xs[i]) < 1e-6 && Math.abs(last[2] - top) < 1e-6) last[1] = xs[i + 1];
    else out.push([xs[i], xs[i + 1], top]);
  }
  return out.filter((p) => p[1] - p[0] > 1e-3);
}

/* The working of a zone's elevation, as rows [label, text]. */
function elevWorking(e, req, ax) {
  const ip = isParts(e);
  const parts = ip.map((q, i) => ({ n: "IS" + (i + 1), w_m: q[1] - q[0], h_m: q[3] - q[2], kind: q[4] })).filter((p) => p.kind !== "pe");
  const pes = ip.map((q, i) => ({ n: "PE" + (i + 1), w_m: q[1] - q[0], h_m: q[3] - q[2], kind: q[4] })).filter((p) => p.kind === "pe");
  const num = gapNums(ax);
  const its = e.items || [];
  const bad = its.filter((i) => i.kind === "gap" && !i.pass);
  const rows = [
    ...(its.length ? [["W", its.map((i) => `${f3(i.w_m)} (${i.kind === "gap" ? num.get(i.gap) || i.label : i.label})`).join(" + ") + ` = ${f3(e.W_m)} m`]] : []),
    ["Zone area", `W x H = ${f2(e.W_m)} x ${f2(e.H_m)} = ${f1(e.zone_area_m2)} m²`],
    ["IS area", (parts.length ? parts.map((p) => p.n).join(" + ") + " = " + parts.map((p) => `(${f3(p.w_m)} x ${f3(p.h_m)})`).join(" + ") + " = " : "") + `${f3(e.is_area_m2)} m²`],
    ["P by the IS", `${f1(e.is_area_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_is)} %` + (req ? ` (IS alone must reach 2/3 x ${f1(req)} = ${f2(req * 2 / 3)} %: ${e.is_min_ok ? "OK" : "NOT OK"})` : "")],
    ["PE area", pes.length ? pes.map((p) => `${f1(p.w_m)} x ${f1(p.h_m)}`).join(" + ") + ` = ${f1(e.pe_area_m2)} m²` : "none (a void through the building, ≥ 3 m wide and high)"],
  ];
  if (e.pe_area_m2) rows.push(["P by the PE", `${f1(e.pe_used_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_pe)} %` + (e.pe_cap_m2 != null ? ` (up to 1/3 x ${f1(req)} = ${f2(req / 3)} %${e.pe_used_m2 < e.pe_area_m2 - 0.01 ? ", the rest not counted" : ", all accountable"})` : "")]);
  rows.push(["P", `${f2(e.P_is)} + ${f2(e.P_pe)} = ${f2(e.P)} %` + (req ? ` (required ${f1(req)} %: ${e.P >= req - 1e-9 && e.is_min_ok !== false ? "OK" : "NOT OK"})` : "")]);
  if (bad.length) rows.push(["Not counted", bad.map((i) => `${num.get(i.gap) || i.label} ${f3(i.w_m)} m (${{ S1: "setback", S2: "between buildings", S3: "angled boundary" }[i.label] || i.label}, below ${i.label === "S2" ? 15 : 7.5} m${i.label === "blocked" ? ", blocked" : ""})`).join(", ")]);
  if (e.exempt_m) rows.push(["Low zone", `the portion ≤ 1/3 H (${f2(e.exempt_m)} m) is disregarded: not IS, and left out of the footprints and Lp`]);
  return rows;
}

/* Zoom and pan a drawing: the wheel (or a pinch) zooms at the pointer,
 * a drag pans, a double-click (or Fit) shows it all; + and - buttons. */
function zoomable(host) {
  const svg = host && host.querySelector("svg");
  if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
  const b = svg.viewBox.baseVal;
  const base = [b.x, b.y, b.width, b.height];
  let v = base.slice();
  const set = () => svg.setAttribute("viewBox", v.map((n) => n.toFixed(3)).join(" "));
  const at = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    const k = Math.min(r.width / v[2], r.height / v[3]) || 1;
    return [v[0] + (cx - (r.left + (r.width - v[2] * k) / 2)) / k, v[1] + (cy - (r.top + (r.height - v[3] * k) / 2)) / k, k];
  };
  const zoom = (f, cx, cy) => {
    f = Math.max(base[2] / 40 / v[2], Math.min(base[2] * 2 / v[2], f));
    const [x, y] = at(cx, cy);
    v = [x - (x - v[0]) * f, y - (y - v[1]) * f, v[2] * f, v[3] * f];
    set();
  };
  const mid = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  svg.style.touchAction = "none";
  svg.style.cursor = "grab";
  svg.addEventListener("wheel", (ev) => { ev.preventDefault(); zoom(Math.pow(1.0015, ev.deltaY), ev.clientX, ev.clientY); }, { passive: false });
  const pts = new Map();
  let pinch = 0;
  svg.addEventListener("pointerdown", (ev) => { pts.set(ev.pointerId, [ev.clientX, ev.clientY]); svg.setPointerCapture(ev.pointerId); svg.style.cursor = "grabbing"; });
  svg.addEventListener("pointermove", (ev) => {
    const old = pts.get(ev.pointerId);
    if (!old) return;
    if (pts.size === 1) {
      const k = at(ev.clientX, ev.clientY)[2];
      v[0] -= (ev.clientX - old[0]) / k;
      v[1] -= (ev.clientY - old[1]) / k;
      set();
    }
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pts.size === 2) {
      const [p, q] = [...pts.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (pinch) zoom(pinch / d, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      pinch = d;
    }
  });
  const up = (ev) => { pts.delete(ev.pointerId); pinch = 0; if (!pts.size) svg.style.cursor = "grab"; };
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("dblclick", () => { v = base.slice(); set(); });
  host.querySelector(".sbd-zoom")?.remove();
  const bar = document.createElement("div");
  bar.className = "sbd-zoom";
  bar.innerHTML = `<button class="ghost" data-zm="in" title="Zoom in (or the wheel)">+</button><button class="ghost" data-zm="out" title="Zoom out">&minus;</button><button class="ghost" data-zm="fit" title="Show it all (or double-click)">Fit</button>`;
  bar.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-zm]");
    if (!k) return;
    ev.stopPropagation();
    if (k.dataset.zm === "fit") { v = base.slice(); set(); } else zoom(k.dataset.zm === "in" ? 1 / 1.5 : 1.5, ...mid());
  });
  host.appendChild(bar);
}

/* An SVG as a PNG data URL (for the report). */
function svgPng(svg, w) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = Math.round(w * img.height / img.width) || w;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg ", `<svg width="${w}" height="${w}" `));
  });
}

export function createSbd(ctx) {
  const { THREE } = ctx;
  const box = document.getElementById("sbd-box");
  if (!box) return null;
  const B = { model: null, res: null, view: "", saved: [], three: null, busy: false };
  box.innerHTML = `
    <div id="sbd-src" class="muted sbd-src">Reading ...</div>
    <div class="chk-row sbd-opts">
      <span class="muted sbd-auto" title="Low zone: Plane X along the street (BD sample case). Middle and High: the Plane X angle giving the most P is found. Plane Y: the best angle within 75-105° of X in every zone.">Planes: found automatically</span>
      <button id="sbd-run" class="primary" title="Assess the masses again">Run</button>
    </div>
    <div class="chk-row"><select id="sbd-saved" title="Saved results" aria-label="Saved results"></select>
      <button id="sbd-save" class="ghost" title="Keep this result (everyone on the project sees it)">Save</button>
      <button id="sbd-del" class="ghost" title="Delete this saved result" hidden>&#10005;</button></div>
    <div id="sbd-sum"></div>
    <div class="chk-row sbd-acts">
      <button id="sbd-plan" class="ghost" title="The plan and the elevations of each zone: the gaps, the air corridors, IS and PE">Plan ...</button>
      <label class="row-check" style="width:auto" title="The masses and the zone limits in the model"><input type="checkbox" id="sbd-3d"> 3D</label>
      <button id="sbd-issue" class="ghost" title="An issue for what fails">Make issue</button>
      <button id="sbd-report" class="ghost" title="A report: the table and a plan of each zone (Print / Save to Folders)">Report</button>
      <button id="sbd-remove" class="ghost danger" title="Remove the masses sent from Revit, this result and the masses' model in the 3D (saved results stay)">Remove ...</button>
    </div>
    <div class="muted hint"><a href="#" class="sbd-howto">How to prepare the model ...</a> From the building masses: in Revit, <b>LWK > Viewer tools > SBD Export</b>. P, S1/S2/S3 and the air corridors follow the SBD panel's rules, for each zone's own footprints; P is taken on each zone's elevation (IS + PE).</div>`;
  const $ = (s) => box.querySelector(s);
  const cur = () => (B.view ? B.viewRes : B.res);

  function paintSaved() {
    $("#sbd-saved").innerHTML = `<option value="">Latest run</option>` + B.saved.map((s) =>
      `<option value="${esc(s.id)}">${esc(s.name)} · ${esc((s.at || "").slice(0, 10))}${s.controlling_p != null ? " · P " + f1(s.controlling_p) + "%" : ""}</option>`).join("");
    $("#sbd-saved").value = B.view;
    $("#sbd-del").hidden = !B.view;
  }

  function paint() {
    const r = cur();
    const m = B.model;
    $("#sbd-src").innerHTML = m
      ? `${m.masses.length} mass(es) from <b>${esc(m.model || "Revit")}</b>, ${esc((m.at || m.uploaded_at || "").replace("T", " ").slice(0, 16))}${m.by ? " · " + esc(m.by) : ""}`
        + `<br>zones from ${f2(m.ground_z)} m${m.ground_source ? ` (${esc(m.ground_source)})` : ""}${(m.streets || []).length ? ` · ${m.streets.length} street(s)` : ""}`
      : `No masses yet. In Revit: model the buildings as <b>Masses</b>, then <b>LWK > Viewer tools > SBD Export</b>. <a href="#" class="sbd-howto">How to prepare the model ...</a>`;
    for (const b of box.querySelectorAll("#sbd-run, #sbd-save, #sbd-plan, #sbd-3d, #sbd-issue, #sbd-report")) b.disabled = !r || !r.ok;
    $("#sbd-remove").disabled = !m && !B.res;
    if (!r) { $("#sbd-sum").innerHTML = ""; return; }
    if (!r.ok) { $("#sbd-sum").innerHTML = `<div class="bad">${(r.warnings || []).map(esc).join("<br>")}</div>`; return; }
    const pz = (a) => (a.P_zone != null ? a.P_zone : a.P);
    const cell = (a) => `<td class="n ${a.pass === false ? "bad" : ""}${a.required_p == null && a.pass == null && r.required_p != null ? " muted" : ""}" title="${a.elev ? `Elevation: IS ${f2(a.elev.P_is)} % + PE ${f2(a.elev.P_pe)} % · on plan IS / W ${f1(a.P)} %` : ""}${a.required_p == null && r.required_p != null ? " - for information (a site under 2 ha is checked on Plane X)" : ""}">${f1(pz(a))}`;
    const rows = r.zones.map((z) => `<tr><td><span class="sbd-dot" style="background:${ZONE_COLOR[z.zone]}"></span>${esc(ZONE_LABEL[z.zone] || z.zone)}</td>`
      + (z.assessed ? `${cell(z.axis1)}<small class="muted sbd-ang">${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + Math.round(z.plane_x_deg) + "°" : ""}</small></td>${cell(z.axis2)}<small class="muted sbd-ang">${z.plane_y_deg != null ? Math.round(z.plane_y_deg) + "°" : ""}</small></td><td class="n">${z.axis1.gaps.filter((g) => g.qualifies).length}/${z.axis1.gaps.length}</td>`
        : `<td colspan="3" class="muted">no building</td>`) + `</tr>`).join("");
    const ok = r.pass;
    $("#sbd-sum").innerHTML = `
      <div class="sbd-verdict ${ok == null ? "" : ok ? "ok" : "bad"}">P = <b>${f1(r.controlling_p)} %</b>${r.required_p != null ? ` · required ${f1(r.required_p)} %${r.required_p_y != null ? ` (Plane Y ${f1(r.required_p_y)} %)` : ""}` : " · no P required (Table 1)"}`
        + `${ok == null ? "" : ok ? " · <b>PASS</b>" : " · <b>FAIL</b>"}<small class="muted"> (2) permeability</small></div>`
      + (r.case1_pass != null ? `<div class="sbd-verdict ${r.case1_pass ? "ok" : "bad"}" title="Design Requirement (1): each building's Lp along the street ≤ 5 x the canyon's U, in each zone">Street canyon: Lp ≤ 5U${r.case1_pass ? " · <b>PASS</b>" : ` · <b>FAIL</b> (${r.case1.flatMap((c) => c.buildings.filter((b) => !b.pass).map((b) => `${c.zone} ${b.building}`)).join(", ")})`}<small class="muted"> (1) street canyon</small></div>`
        : (r.streets || []).length ? `<div class="sbd-verdict" title="${esc((r.case1 || []).flatMap((c) => c.notes || []).join(" / "))}">Street canyon: not applicable - no building within 30 m of a street's centreline<small class="muted"> (1) street canyon</small></div>` : "")
      + `
      <table class="sbd-t"><tr><th>Zone</th><th class="n" title="Projection Plane X: (IS + PE) / (W x H) on the zone's elevation; its angle from the street small">P X %</th><th class="n" title="Projection Plane Y, 75-105° from X">P Y %</th><th class="n" title="Gaps that count / all gaps on Axis 1">gaps</th></tr>${rows}</table>
      <div class="muted sbd-lp">Site ${f1(r.site_area_m2)} m² · Lp ${f1(r.lp.projected_m)} m (projected, all buildings)`
        + `${r.required_p !== r.required_p_addin ? ` <span class="bad" title="The SBD panel takes the shorter side of one building (${f1(r.lp.addin_m)} m), which gives a different required P - confirm the reading of APP-152">· add-in Lp ${f1(r.lp.addin_m)} m</span>` : ""}</div>`
      + ((r.case1 || []).some((c) => c.buildings.length) ? `<table class="sbd-t"><tr><th title="Design Requirement (1): Lp ≤ 5 U, per zone">Case 1</th><th class="n" title="Canyon area / its length along the street">U m</th><th class="n" title="The facade projected on the street (Low zone: above 1/3 H)">Lp m</th><th class="n">5U m</th></tr>`
        + r.case1.flatMap((s) => s.buildings.map((b, bi) => `<tr title="${esc(canyonWorking(b, bi).map(([k, v]) => k + ": " + v).join("\n"))}"><td><span class="sbd-dot" style="background:${ZONE_COLOR[s.zone]}"></span>${esc(b.building)}${b.name ? " · " + esc(b.name) : ""} <span class="muted">${esc(b.ctrl_street || "")}</span></td><td class="n">${f1(b.U_m)}</td><td class="n ${b.pass ? "" : "bad"}">${f1(b.Lp_m)}</td><td class="n">${f1(b.Lp_max_m)}</td></tr>`)).join("") + `</table>` : "")
      + ((r.warnings || []).length ? `<div class="bad sbd-warn">${r.warnings.map(esc).join("<br>")}</div>` : "")
      + (B.view ? `<div class="muted">Saved ${esc((cur().saved_at || "").replace("T", " ").slice(0, 16))} by ${esc(cur().saved_by || "")}</div>` : `<div class="muted">Run ${esc((r.run_at || "").replace("T", " ").slice(0, 16))}${r.run_by ? " · " + esc(r.run_by) : ""}</div>`);
    if (B.three) show3d(true);
  }

  async function load() {
    try {
      const d = await api("/api/sbd");
      B.model = d.model;
      B.res = d.result;
      B.saved = (await api("/api/sbd/saved")).saved || [];
    } catch (e) {
      $("#sbd-src").textContent = "Not read: " + e.message;
      return;
    }
    paintSaved();
    paint();
  }

  // the procedure and requirements: the Help, at SBD
  box.addEventListener("click", (ev) => {
    const a = ev.target.closest(".sbd-howto");
    if (!a) return;
    ev.preventDefault();
    import("./help.js").then((h) => h.openHelp({ topic: "sbd" }));
  });
  $("#sbd-run").onclick = async () => {
    if (B.busy) return;
    B.busy = true;
    $("#sbd-run").textContent = "Running ...";
    try {
      B.res = await api("/api/sbd/run", { method: "POST", body: JSON.stringify({ axis: "street" }) });
      B.view = "";
      paintSaved();
      paint();
      ctx.status(`SBD: P ${f1(B.res.controlling_p)} %${B.res.required_p != null ? " (required " + f1(B.res.required_p) + " %)" : ""}.`);
    } catch (e) { ctx.status("SBD not run: " + e.message); }
    B.busy = false;
    $("#sbd-run").textContent = "Run";
  };
  $("#sbd-save").onclick = async () => {
    const name = prompt("Name this result:", "SBD " + new Date().toISOString().slice(0, 10));
    if (name == null) return;
    try {
      const s = await api("/api/sbd/saved", { method: "POST", body: JSON.stringify({ name }) });
      B.saved = (await api("/api/sbd/saved")).saved || [];
      paintSaved();
      ctx.status(`SBD result saved as "${s.name}".`);
    } catch (e) { ctx.status("Not saved: " + e.message); }
  };
  $("#sbd-saved").onchange = async () => {
    const id = $("#sbd-saved").value;
    if (!id) { B.view = ""; paintSaved(); paint(); return; }
    try {
      B.viewRes = await api("/api/sbd/saved/" + encodeURIComponent(id));
      B.view = id;
    } catch (e) { ctx.status("Not read: " + e.message); B.view = ""; }
    paintSaved();
    paint();
  };
  $("#sbd-remove").onclick = async () => {
    if (!B.model && !B.res) return;
    if (!confirm("Remove the SBD masses sent from Revit, the latest result and the masses' model in the 3D?\n\nSaved results stay. Send the masses again with SBD Export.")) return;
    try {
      const r = await api("/api/sbd", { method: "DELETE" });
      show3d(false);
      $("#sbd-3d").checked = false;
      B.model = null; B.res = null; B.view = "";
      paintSaved();
      paint();
      ctx.status(`SBD removed${r.removed_models ? " - and its model in the 3D (reload the page to take it off the Models list)" : ""}.`);
    } catch (e) { ctx.status("Not removed: " + e.message); }
  };
  $("#sbd-del").onclick = async () => {
    const s = B.saved.find((x) => x.id === B.view);
    if (!s || !confirm(`Delete the saved result "${s.name}"?`)) return;
    try { await api("/api/sbd/saved/" + encodeURIComponent(s.id), { method: "DELETE" }); } catch (e) { ctx.status("Not deleted: " + e.message); return; }
    B.saved = B.saved.filter((x) => x.id !== s.id);
    B.view = "";
    paintSaved();
    paint();
  };

  /* ------------------------------------------------------------ the plan */
  function planWindow() {
    const r = cur();
    if (!r || !r.ok) return;
    const zones = r.zones.filter((z) => z.assessed);
    let zone = (zones.find((z) => z.P === r.controlling_p) || zones[0] || {}).zone, axisKey = "axis1", view = "plan";
    const back = document.createElement("div");
    back.className = "sbd-back";
    back.innerHTML = `<div class="sbd-win" role="dialog" aria-label="SBD plan and elevations">
      <div class="sbd-wh"><span class="sbd-ztabs"><button class="ghost" data-v="plan">Plan</button><button class="ghost" data-v="elev" title="The zone's elevational projection on the plane: IS, PE and P by area">Elevation</button>${(r.streets || []).length ? `<button class="ghost" data-v="canyon" title="Design Requirement (1): the street canyon U and Lp, for each zone">Street canyon</button>` : ""}</span><span class="sbd-ztabs">${r.zones.map((z) => `<button class="ghost" data-z="${z.zone}"${z.assessed ? "" : " disabled"}>${esc(ZONE_LABEL[z.zone] || z.zone)}${z.assessed ? ` · ${f1(z.P)}%` : ""}</button>`).join("")}</span>
        <span class="sbd-ztabs"><button class="ghost" data-a="axis1" title="Projection Plane X (Axis 1)">Plane X</button><button class="ghost" data-a="axis2" title="Projection Plane Y (Axis 2)">Plane Y</button></span>
        <span class="spacer"></span><button class="ghost" data-x title="Close">&#10005;</button></div>
      <div class="sbd-wb"><div class="sbd-plan"></div><div class="sbd-gaps"></div></div>
      <div class="sbd-legend muted" data-l="elev"><span class="sw" style="background:#94a3b8"></span>building <span class="sw" style="background:radial-gradient(#15803d 30%,#dcfce7 35%);background-size:6px 6px"></span>IS (a gap that counts, or open to above ≥ 7.5 m wide)
        <span class="sw" style="background:#dbeafe;border-color:#1d4ed8"></span>PE (a void ≥ 3 m x 3 m) <span class="sw" style="background:repeating-linear-gradient(45deg,#334155 0 2px,#cbd5e1 2px 5px)"></span>Low zone ≤ 1/3 H, disregarded <span class="sw dash" style="border-color:#dc2626"></span>the zone</div>
      <div class="sbd-legend muted" data-l="plan"><span class="sw" style="background:#16a34a55;border-color:#16a34a"></span>a gap that counts <span class="sw" style="background:#dc262655;border-color:#dc2626"></span>does not (too narrow, or blocked)
        <span class="sw" style="background:#47556999"></span>this zone's buildings <span class="sw dash"></span>air corridor ≥ 15 m <span class="sw" style="background:#f28022"></span>axis
        <span class="sw" style="background:#e2e8f0;border-color:#94a3b8"></span>street, its centreline and the opposite boundary</div></div>`;
    document.body.appendChild(back);
    const draw = () => {
      back.querySelectorAll("[data-z]").forEach((b) => b.classList.toggle("active", b.dataset.z === zone));
      back.querySelectorAll("[data-a]").forEach((b) => b.classList.toggle("active", b.dataset.a === axisKey));
      back.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("active", b.dataset.v === view));
      back.querySelectorAll("[data-l]").forEach((b) => { b.hidden = b.dataset.l !== view; });
      const z = r.zones.find((x) => x.zone === zone);
      const ax = z && z[axisKey];
      back.querySelectorAll("[data-a]").forEach((b) => { b.hidden = view === "canyon"; });
      if (view === "canyon") {
        back.querySelector(".sbd-plan").innerHTML = zoneSvg(r, zone, null, { canyon: true });
        zoomable(back.querySelector(".sbd-plan"));
        const cs = (r.case1 || []).filter((c) => c.zone === zone);
        back.querySelector(".sbd-gaps").innerHTML = `<div class="sbd-ptot">Street canyon<br><span class="muted">Design Requirement (1): Lp ≤ 5 U, ${esc(ZONE_LABEL[zone] || zone)}</span></div>`
          + cs.map((c) => c.buildings.map((b, bi) => `<table class="sbd-t sbd-c1"><tr><th colspan="2">${esc(b.building)}${b.name ? " · " + esc(b.name) : ""}</th></tr>`
              + canyonWorking(b, bi).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="${k === "Result" ? (b.pass ? "ok" : "bad") : ""}">${esc(v)}</td></tr>`).join("") + `</table>`).join("")
            + (c.notes || []).map((n) => `<p class="muted sbd-c1note">${esc(n)}</p>`).join("")).join("")
          + (cs.length ? "" : `<p class="muted">No building in this zone abuts a street (none within 30 m of a street's centreline).</p>`)
          + `<div class="muted sbd-note">A building (or group) abuts a street when any part of it is within 30 m of the street's centreline. Its canyon runs over its whole projected length on that street, from the facade to the opposite site boundary: U = canyon area / length. With two streets the smaller U controls. Actual Lp (the facade projected on the street) must not exceed 5 x U. In the Low zone the portion ≤ 1/3 H is left out. Fig B7, GB081.</div>`;
        return;
      }
      if (view === "elev") {
        const e = ax && ax.elev;
        const req = ax && (ax.required_p != null ? ax.required_p : null);
        back.querySelector(".sbd-plan").innerHTML = e ? elevSvg(r, zone, axisKey) : `<div class="muted">No elevation in this result - run it again.</div>`;
        zoomable(back.querySelector(".sbd-plan"));
        back.querySelector(".sbd-gaps").innerHTML = e ? `<div class="sbd-ptot">P = ${f2(e.P)} %<br><span class="muted">(IS + PE) / (W x H) on ${axisKey === "axis1" ? "Plane X" : "Plane Y"}${req == null && r.required_p != null ? " - for information: a site under 2 ha is checked on Plane X" : ""}</span></div>`
          + `<table class="sbd-t">${elevWorking(e, req != null ? req : r.required_p, ax).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
          + `<div class="muted sbd-note">IS: in a gap that counts on plan (S1, S3 ≥ 7.5 m; S2 ≥ 15 m), at least 2/3 of the zone's height, or open to above over a lower building (with the IS beside it ≥ 7.5 m wide). PE: a void through the building ≥ 3 m wide and high; it counts up to 1/3 of the required P. Low zone: the portion ≤ 1/3 H is disregarded. On plan (IS / W): ${f1(ax.P)} %.</div>` : "";
        return;
      }
      back.querySelector(".sbd-plan").innerHTML = zoneSvg(r, zone, axisKey);
      zoomable(back.querySelector(".sbd-plan"));
      const planes = z && z.plane_x_deg != null ? `Plane X ${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + f1(z.plane_x_deg) + "° from the street" : "along the street"} · Plane Y ${f1(z.plane_y_deg)}° from X` : "";
      back.querySelector(".sbd-gaps").innerHTML = ax ? `<div class="sbd-ptot">P = ${f1(ax.P_zone != null ? ax.P_zone : ax.P)} %<br><span class="muted">on the elevation · on plan IS ${f2(ax.IS_m)} m / W ${f2(ax.W_m)} m = ${f1(ax.P)} %${ax.sweep_deg ? ` · plane side turned ${ax.sweep_deg}°` : ""}</span>${planes ? `<br><span class="muted">${esc(planes)}</span>` : ""}</div>`
        + `<table class="sbd-t"><tr><th>Gap</th><th class="n">S m</th><th></th></tr>` + (() => {
          const num = gapNums(ax);
          return ax.gaps.map((g, i) => [num.get(i), g, i]).sort((p, q) => Number(p[0].slice(1)) - Number(q[0].slice(1))).map(([nm, g]) => {
            const how = gapHow(g, ax, nm);
            return `<tr><td>${esc(nm)} <span class="muted">${esc(gapKind(g))}</span></td><td class="n">${f3(gapM(g))}</td><td class="${g.qualifies ? "ok" : "bad"}">${g.qualifies ? "counts" : "no"}${g.threshold_m ? ` <span class="muted">(${g.threshold_m} m)</span>` : ""}${g.encroach_m != null ? ` <span class="bad">${f3(g.encroach_m)} m to the boundary</span>` : ""}</td></tr>`
              + `<tr class="sbd-how"><td colspan="3">${esc(how)}</td></tr>`;
          }).join("");
        })() + `</table>`
          + ((ax.edge || []).length ? `<table class="sbd-t sbd-edge"><tr><th title="Along the site's edge nearest the plane (the street side)">Near edge</th><th class="n" title="Projected on the plane">proj m</th><th class="n" title="Drawn on the elevation: a gap at its S value, a shadow at its projected width">elev m</th></tr>`
            + ax.edge.map((it) => `<tr><td class="${it.kind === "gap" ? (it.pass ? "ok" : "bad") : ""}">${esc(it.kind === "gap" ? gapNums(ax).get(it.gap) || it.label : it.label)}${it.kind === "gap" && it.bend_deg != null ? ` <span class="muted">${f1(Math.abs(it.bend_deg))}°</span>` : ""}</td><td class="n">${f2(it.hi - it.lo)}</td><td class="n">${f2(it.kind === "gap" ? it.s_m : it.hi - it.lo)}</td></tr>`).join("") + `</table>` : "")
          + ((z.tried || []).length > 1 ? `<table class="sbd-t sbd-tried"><tr><th title="The plane pairs assessed in full; the one giving the most P is used">Planes tried</th><th class="n">P X %</th><th class="n">P Y %</th></tr>`
            + z.tried.map((t) => `<tr${t.chosen ? ' class="sbd-chosen"' : ""}><td>X ${t.x_deg > 0 ? "+" : ""}${f1(t.x_deg)}° · Y ${f1(t.y_deg)}°${t.chosen ? " ✓" : ""}</td><td class="n">${f1(t.P_x)}</td><td class="n">${f1(t.P_y)}</td></tr>`).join("") + `</table>` : "")
          + `<div class="muted sbd-note">IS = the S widths that count (S1, S3 ≥ 7.5 m; S2 ≥ 15 m). Corridors may turn any angle up to 15° and return; each side region's edge follows the outer building corners (≤ 15°) - the panel's rules. The near edge's widths are what Plane X sees: a turned corridor makes the shadows beside it wider or narrower.</div>` : "";
    };
    back.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (ev.target === back || (b && b.hasAttribute("data-x"))) { back.remove(); return; }
      if (!b) return;
      if (b.dataset.z) zone = b.dataset.z;
      if (b.dataset.a) axisKey = b.dataset.a;
      if (b.dataset.v) view = b.dataset.v;
      draw();
    });
    document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { back.remove(); document.removeEventListener("keydown", k); } });
    draw();
  }
  $("#sbd-plan").onclick = planWindow;

  /* ------------------------------------------------------------ 3D */
  function show3d(on) {
    const grp = ctx.overlay && ctx.overlay();
    if (B.three) { if (grp) grp.remove(B.three); B.three.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); B.three = null; }
    if (!on || !grp || !B.model) { ctx.redraw(); return; }
    const M = ctx.internalToScene ? ctx.internalToScene() : null;
    if (!M) { $("#sbd-3d").checked = false; ctx.status("SBD in 3D needs the model published with LWK Publish (its Revit coordinates)."); return; }
    const g = new THREE.Group();
    g.name = "sbd";
    const gz = B.model.ground_z;
    for (const m of B.model.masses) {
      const pos = new Float32Array(m.tris.length * 9);
      let i = 0;
      for (const t of m.tris) for (const k of t) { const v = m.verts[k]; pos[i++] = v[0]; pos[i++] = v[1]; pos[i++] = v[2]; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf28022, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      mesh.applyMatrix4(M);
      g.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0xc2410c }));
      edges.applyMatrix4(M);
      g.add(edges);
    }
    // the site at ground level, and the zone limits (20 m, 60 m) over it
    const site = B.model.site;
    for (const [h, col] of [[0, 0x0f172a], [20, ZONE_COLOR.MIDDLE], [60, ZONE_COLOR.HIGH]]) {
      const pts = [...site, site[0]].map((p) => new THREE.Vector3(p[0], p[1], gz + h));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(col) }));
      line.applyMatrix4(M);
      g.add(line);
    }
    grp.add(g);
    B.three = g;
    ctx.redraw();
  }
  $("#sbd-3d").onchange = () => show3d($("#sbd-3d").checked);

  /* ------------------------------------------------------------ issue + report */
  function failText(r) {
    const lines = [];
    for (const z of r.zones.filter((x) => x.assessed)) {
      const bad = z.axis1.gaps.filter((g) => !g.qualifies);
      const pz = (a) => (a.P_zone != null ? a.P_zone : a.P);
      lines.push(`${ZONE_LABEL[z.zone] || z.zone}: P ${f1(pz(z.axis1))} % (Plane X), ${f1(pz(z.axis2))} % (Plane Y)`
        + (bad.length ? ` - not counted: ${bad.map((g) => `${g.type === "FAIL" ? "blocked gap" : g.type} ${f2(gapM(g))} m`).join(", ")}` : ""));
    }
    for (const c of r.case1 || []) for (const b of c.buildings) if (!b.pass) lines.push(`Design Requirement (1), ${ZONE_LABEL[c.zone] || c.zone || ""} ${b.building} (${b.ctrl_street}): Lp ${f1(b.Lp_m)} m > 5U ${f1(b.Lp_max_m)} m (U ${f2(b.U_m)} m)`);
    return lines;
  }
  $("#sbd-issue").onclick = async () => {
    const r = cur();
    if (!r || !r.ok) return;
    const n = nextNumber(ctx.items(), "SBD issue");
    const M = ctx.internalToScene ? ctx.internalToScene() : null;
    const c = r.site.reduce((m, p) => [m[0] + p[0] / r.site.length, m[1] + p[1] / r.site.length], [0, 0]);
    const at = M ? new THREE.Vector3(c[0], c[1], (B.model ? B.model.ground_z : 0) + 10).applyMatrix4(M) : ctx.target ? ctx.target() : new THREE.Vector3();
    await ctx.makeIssue(at, null, {
      title: `SBD issue ${numberText(n)} - P ${f1(r.controlling_p)} %${r.required_p != null ? ` (required ${f1(r.required_p)} %)` : ""}`.slice(0, 120),
      description: [`SBD (PNAP APP-152) permeability from the masses${B.model && B.model.model ? " of " + B.model.model : ""}: controlling P ${f1(r.controlling_p)} %`
        + (r.required_p != null ? `, required ${f1(r.required_p)} % - ${r.pass ? "passes" : "FAILS"}.` : "."), ...failText(r),
        `Run ${(r.run_at || "").replace("T", " ").slice(0, 16)}.`].join("\n"),
      type: "design", status: "Open", due_date: dueIn(5),
    });
  };
  $("#sbd-report").onclick = async () => {
    const r = cur();
    if (!r || !r.ok) return;
    const w = reportTab("SBD report");
    if (!w) { ctx.status("Allow pop-ups for this site to open the report."); return; }
    tabSay(w, "Drawing the zones ...");
    const items = [];
    for (const z of r.zones.filter((x) => x.assessed)) {
      for (const k of ["axis1", "axis2"]) {
        const ax = z[k];
        const num = gapNums(ax);
        items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · plan, ${k === "axis1" ? "Projection Plane X (Axis 1)" : "Projection Plane Y (Axis 2)"}`, tag: `P ${f2(ax.P_zone != null ? ax.P_zone : ax.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(zoneSvg(r, z.zone, k), 1400),
          rows: [["Planes", `Plane X ${f3(z.plane_x_deg)}° from the street · Plane Y ${f3(z.plane_y_deg)}° from Plane X`],
            ...ax.gaps.map((g, i) => [num.get(i), g, i]).sort((p, q) => Number(p[0].slice(1)) - Number(q[0].slice(1)))
              .map(([nm, g]) => [`${nm} (${gapKind(g)})`, `${gapHow(g, ax, nm)} - ${g.qualifies ? "counts" : `does not count (min ${g.threshold_m || 7.5} m)`}`, g.qualifies ? "#16a34a" : "#dc2626"]),
            ...((ax.edge || []).length ? [["Near edge (projected)", ax.edge.map((it) => `${it.kind === "gap" ? num.get(it.gap) || it.label : it.label} ${f3(it.hi - it.lo)}`).join(" + ") + ` = ${f3(ax.edge.reduce((t, it) => t + it.hi - it.lo, 0))} m`]] : []),
            ...(k === "axis1" && (z.tried || []).length > 1 ? [["Planes tried", z.tried.map((t) => `X ${f3(t.x_deg)}° / Y ${f3(t.y_deg)}°: P X ${f2(t.P_x)} %, P Y ${f2(t.P_y)} %${t.chosen ? " (used)" : ""}`).join("; ")]] : [])] });
        if (ax.elev) items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · elevation on ${k === "axis1" ? "Plane X" : "Plane Y"}`, tag: `P ${f2(ax.elev.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(elevSvg(r, z.zone, k), 1400), rows: elevWorking(ax.elev, ax.required_p != null ? ax.required_p : r.required_p, ax) });
      }
    }
    // Design Requirement (1) - Lp of building(s) abutting a street (GB081)
    if ((r.streets || []).length) {
      let any = false;
      for (const z of r.zones) {
        const cs = (r.case1 || []).filter((c) => c.zone === z.zone);
        if (!cs.length) continue;
        any = true;
        const bs = cs.flatMap((c) => c.buildings);
        items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · Design Requirement (1) - Lp of building(s) abutting a street`,
          tag: !bs.length ? "not applicable" : bs.every((b) => b.pass) ? "Lp ≤ 5U" : "Lp > 5U", tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(zoneSvg(r, z.zone, null, { canyon: true }), 1400),
          rows: [...cs.flatMap((c) => c.buildings.flatMap((b, bi) => canyonWorking(b, bi).map(([k, v], i) => [`${i ? "" : b.building + " · "}${k}`, v, k === "Result" ? (b.pass ? "#16a34a" : "#dc2626") : undefined]))),
            ...cs.flatMap((c) => (c.notes || []).map((n) => ["Note", n]))] });
      }
      if (!any) items.push({ head: "Design Requirement (1) - Lp of building(s) abutting a street", tag: "not applicable", tagColor: "#64748b",
        rows: [["Note", "No building is within 30 m of the centreline of a street in any zone - the requirement does not apply."]] });
    }
    writeReport(w, {
      title: "SBD report (PNAP APP-152)", project: ctx.projectName(), unit: "zone plans", folder: "SBD",
      sub: new Date().toLocaleString() + (ctx.author() ? " · prepared by " + ctx.author() : ""),
      meta: [["Controlling P", `${f1(r.controlling_p)} %`], ["Required P (Table 1)", r.required_p != null ? `${f1(r.required_p)} %` : "none"],
        ["Result", r.pass == null ? "-" : r.pass ? "PASS" : "FAIL"], ["Design Requirement (1) Lp ≤ 5U", r.case1_pass == null ? ((r.streets || []).length ? "not applicable" : "-") : r.case1_pass ? "PASS" : "FAIL"], ["Site area", `${f1(r.site_area_m2)} m²`],
        ["Lp (projected, all buildings)", `${f1(r.lp.projected_m)} m`], ["Planes", "found automatically (Low zone: Plane X along the street)"],
        ["Masses", B.model ? `${B.model.masses.length}, from ${B.model.model || "Revit"} (${(B.model.at || "").slice(0, 10)})` : ""],
        ...((r.warnings || []).length ? [["Warnings", r.warnings.join(" / ")]] : [])],
      table: { cols: ["Zone", "P Plane X %", "P Plane Y %", "Case 1: Lp / 5U m"], rows: r.zones.map((z) => [ZONE_LABEL[z.zone] || z.zone,
        z.assessed ? f1(z.axis1.P_zone != null ? z.axis1.P_zone : z.axis1.P) : "-", z.assessed ? f1(z.axis2.P_zone != null ? z.axis2.P_zone : z.axis2.P) : "-",
        (r.case1 || []).filter((c) => c.zone === z.zone).flatMap((c) => c.buildings.map((b) => `${f1(b.Lp_m)} / ${f1(b.Lp_max_m)}${b.pass ? "" : " FAIL"}`)).join(", ") || "-"]) },
      items,
    });
    ctx.status("SBD report ready in a new tab - Print / Save as PDF there, or Save to Folders.");
  };

  return { refresh: load, close: () => show3d(false) };
}
