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
const f1 = (v) => (v == null ? "-" : Number(v).toFixed(1));
const f2 = (v) => (v == null ? "-" : Number(v).toFixed(2));
// a gap's S value: as measured (side region's Area / Depth, the corridor's
// width, S2 / S3) - the projected width only for a blocked gap
const gapM = (g) => (g.type === "FAIL" || g.type === "OPEN" || !g.distance_m ? g.width_m : g.distance_m);

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
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 4;
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
      s += `<text x="${(m[0] - x0).toFixed(2)}" y="${(y1 - m[1] - fs * 0.4).toFixed(2)}" font-size="${fs * 0.9}" text-anchor="middle" fill="#475569" font-style="italic">${esc(st.name || "")}</text>`;
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
      s += `<polygon points="${poly(sd.polygon)}" fill="${ok ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${ok ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
    for (const g of ax.gaps) {
      if (g.corridor && g.corridor.length > 2) s += `<polygon points="${poly(g.corridor)}" fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${g.qualifies ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
  }
  // the neighbours' buildings, and this zone's
  s += (z.others || []).map((l) => `<polygon points="${poly(l)}" fill="url(#${id}h)" stroke="#94a3b8" stroke-width="${fs / 12}"/>`).join("");
  s += z.footprints.map((f) => `<polygon points="${poly(f.loop)}" fill="#475569" fill-opacity=".55" stroke="#1e293b" stroke-width="${fs / 10}"/>`).join("");
  // the air corridors (dashed blue outline over the measured band)
  s += ((ax && ax.gaps.filter((g) => g.corridor).map((g) => ({ polygon: g.corridor }))) || z.corridors || []).map((c) => `<polygon points="${poly(c.polygon)}" fill="none" stroke="#2563eb" stroke-width="${fs / 7}" stroke-dasharray="${fs / 2} ${fs / 3}"/>`).join("");
  if (ax) {
    for (const g of ax.gaps) {
      if (g.pinch) {
        const [a, b] = g.pinch;
        s += `<line x1="${(a[0] - x0).toFixed(3)}" y1="${(y1 - a[1]).toFixed(3)}" x2="${(b[0] - x0).toFixed(3)}" y2="${(y1 - b[1]).toFixed(3)}" stroke="${g.pass ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 6}"/>`;
      }
      // the label in the middle of what was measured (side region, corridor or strip)
      const shape = (g.side && ax.sides && ax.sides[g.side] && ax.sides[g.side].polygon) || g.corridor || g.strip;
      const c = shape.reduce((m, p) => [m[0] + p[0] / shape.length, m[1] + p[1] / shape.length], [0, 0]);
      const t = `${g.type === "FAIL" ? "blocked" : g.type} ${f1(gapM(g))} m`;
      s += `<text x="${(c[0] - x0).toFixed(2)}" y="${(y1 - c[1]).toFixed(2)}" font-size="${fs}" text-anchor="middle" fill="${g.qualifies ? "#14532d" : "#7f1d1d"}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${esc(t)}</text>`;
    }
    // Axis: the direction the gaps are measured along
    const ctr = res.site.reduce((m, p) => [m[0] + p[0] / res.site.length, m[1] + p[1] / res.site.length], [0, 0]);
    const L = Math.max(W, H) * 0.12;
    const e = [ctr[0] + ax.axis[0] * L, ctr[1] + ax.axis[1] * L];
    s += `<line x1="${(ctr[0] - x0).toFixed(2)}" y1="${(y1 - ctr[1]).toFixed(2)}" x2="${(e[0] - x0).toFixed(2)}" y2="${(y1 - e[1]).toFixed(2)}" stroke="#f28022" stroke-width="${fs / 4}" marker-end="url(#${id}a)"/>`
      + `<defs><marker id="${id}a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#f28022"/></marker></defs>`
      + `<text x="${(e[0] - x0).toFixed(2)}" y="${(y1 - e[1] - fs * 0.6).toFixed(2)}" font-size="${fs}" fill="#c2410c" text-anchor="middle" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${axisKey === "axis1" ? "Axis 1" : "Axis 2"}${ax.sweep_deg ? ` (${ax.sweep_deg > 0 ? "+" : ""}${ax.sweep_deg}°)` : ""}</text>`;
  }
  // a 10 m scale bar
  s += `<g><line x1="${fs}" y1="${H - fs}" x2="${fs + 10}" y2="${H - fs}" stroke="#0f172a" stroke-width="${fs / 5}"/><text x="${fs + 5}" y="${H - fs * 1.4}" font-size="${fs * 0.8}" text-anchor="middle">10 m</text></g>`;
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
  open: { fill: "#fff", label: "open, not counted" },
};
export function elevSvg(res, zone, axisKey, opt) {
  opt = opt || {};
  const z = (res.zones || []).find((x) => x.zone === zone);
  const e = z && z[axisKey] && z[axisKey].elev;
  if (!e) return "";
  const fs = Math.max(e.W_m, e.H_m * 2) / 55;
  const L = fs * 11, T = fs * 3.5, Bm = fs * 4.5, R = fs * 2;
  const VW = L + e.W_m + R, VH = T + e.H_m + Bm;
  const id = "e" + Math.random().toString(36).slice(2, 8);
  const X = (u) => (L + u).toFixed(3), Y = (h) => (T + e.H_m - h).toFixed(3);
  const fill = (k) => (ELEV_KIND[k] || ELEV_KIND.open).fill.replace(/url\(#(\w)\)/, `url(#${id}$1)`);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW.toFixed(2)} ${VH.toFixed(2)}" class="sbd-svg"${opt.w ? ` width="${opt.w}" height="${Math.round(opt.w * VH / VW)}"` : ""} font-family="system-ui,sans-serif">`
    + `<defs><pattern id="${id}H" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="#cbd5e1"/><line x1="0" y1="0" x2="0" y2="${fs * 0.8}" stroke="#334155" stroke-width="${fs / 6}"/></pattern>`
    + `<pattern id="${id}D" width="${fs * 0.7}" height="${fs * 0.7}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dcfce7"/><circle cx="${fs * 0.35}" cy="${fs * 0.35}" r="${fs / 9}" fill="#15803d"/></pattern>`
    + `<pattern id="${id}G" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dbeafe"/><path d="M0 0H${fs * 0.8}M0 0V${fs * 0.8}" stroke="#1d4ed8" stroke-width="${fs / 10}"/></pattern></defs>`
    + `<rect width="100%" height="100%" fill="#fff"/>`;
  for (const [u0, u1, h0, h1, k] of e.rects) {
    s += `<rect x="${X(u0)}" y="${Y(h1)}" width="${(u1 - u0).toFixed(3)}" height="${(h1 - h0).toFixed(3)}" fill="${fill(k)}" stroke="${k === "bldg" ? "#475569" : "none"}" stroke-width="${fs / 14}"/>`;
  }
  // the counted parts' sizes
  for (const [u0, u1, h0, h1, k] of e.rects) {
    if (!["is", "sky", "pe"].includes(k) || u1 - u0 < fs * 3 || h1 - h0 < fs * 1.2) continue;
    s += `<text x="${X((u0 + u1) / 2)}" y="${Y((h0 + h1) / 2 - fs * 0.35)}" font-size="${fs * 0.85}" text-anchor="middle" fill="${k === "pe" ? "#1e3a8a" : "#14532d"}" stroke="#fff" stroke-width="${fs / 5}" paint-order="stroke">${k === "pe" ? "PE" : "IS"} ${f1(u1 - u0)} x ${f1(h1 - h0)}</text>`;
  }
  // the zone frame (dashed red, as in the sample), its levels and W
  s += `<rect x="${X(0)}" y="${Y(e.H_m)}" width="${e.W_m}" height="${e.H_m}" fill="none" stroke="#dc2626" stroke-width="${fs / 8}" stroke-dasharray="${fs} ${fs / 2}"/>`;
  s += `<line x1="${X(-fs)}" y1="${Y(0)}" x2="${X(e.W_m + fs)}" y2="${Y(0)}" stroke="#dc2626" stroke-width="${fs / 5}"/>`;
  const lev = (h, t) => `<text x="${X(-fs * 0.6)}" y="${(Number(Y(h)) + fs * 0.35).toFixed(2)}" font-size="${fs * 0.9}" text-anchor="end" fill="#0f172a">${t}</text>`;
  s += lev(0, `${f1(e.z0)} m${e.z0 ? "" : " (Level 0)"}`) + lev(e.H_m, `${f1(e.z0 + e.H_m)} m`);
  if (e.exempt_m) s += lev(e.exempt_m, `1/3 H ${f2(e.exempt_m)}`);
  const yb = T + e.H_m + fs * 2.2;
  s += `<line x1="${X(0)}" y1="${yb}" x2="${X(e.W_m)}" y2="${yb}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<line x1="${X(0)}" y1="${yb - fs / 2}" x2="${X(0)}" y2="${yb + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/><line x1="${X(e.W_m)}" y1="${yb - fs / 2}" x2="${X(e.W_m)}" y2="${yb + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<text x="${X(e.W_m / 2)}" y="${yb - fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="#0f172a">W ${f2(e.W_m)} m</text>`
    + `<text x="${X(e.W_m / 2)}" y="${yb + fs * 1.4}" font-size="${fs * 0.9}" text-anchor="middle" fill="#475569">Projected facade through ${axisKey === "axis1" ? "Projection Plane X" : "Projection Plane Y"} · H ${f2(e.H_m)} m</text>`
    + `<text x="${X(0)}" y="${T - fs}" font-size="${fs * 1.1}" fill="#0f172a" font-weight="600">${esc(ZONE_LABEL[zone] || zone)} · P = ${f2(e.P_is)} % IS + ${f2(e.P_pe)} % PE = ${f2(e.P)} %</text>`;
  return s + `</svg>`;
}

/* The working of a zone's elevation, as rows [label, text]. */
function elevWorking(e, req) {
  const parts = e.parts.filter((p) => p.kind !== "pe");
  const pes = e.parts.filter((p) => p.kind === "pe");
  const rows = [
    ["Zone area", `W x H = ${f2(e.W_m)} x ${f2(e.H_m)} = ${f1(e.zone_area_m2)} m²`],
    ["IS area", (parts.length ? parts.map((p) => `${f1(p.w_m)} x ${f1(p.h_m)}`).join(" + ") + " = " : "") + `${f1(e.is_area_m2)} m²`],
    ["P by the IS", `${f1(e.is_area_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_is)} %` + (req ? ` (IS alone must reach 2/3 x ${f1(req)} = ${f2(req * 2 / 3)} %: ${e.is_min_ok ? "OK" : "NOT OK"})` : "")],
    ["PE area", pes.length ? pes.map((p) => `${f1(p.w_m)} x ${f1(p.h_m)}`).join(" + ") + ` = ${f1(e.pe_area_m2)} m²` : "none (a void through the building, ≥ 3 m wide and high)"],
  ];
  if (e.pe_area_m2) rows.push(["P by the PE", `${f1(e.pe_used_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_pe)} %` + (e.pe_cap_m2 != null ? ` (up to 1/3 x ${f1(req)} = ${f2(req / 3)} %${e.pe_used_m2 < e.pe_area_m2 - 0.01 ? ", the rest not counted" : ", all accountable"})` : "")]);
  rows.push(["P", `${f2(e.P_is)} + ${f2(e.P_pe)} = ${f2(e.P)} %` + (req ? ` (required ${f1(req)} %: ${e.P >= req - 1e-9 && e.is_min_ok !== false ? "OK" : "NOT OK"})` : "")]);
  if (e.exempt_m) rows.push(["Low zone", `the portion ≤ 1/3 H (${f2(e.exempt_m)} m) is disregarded: not IS, and left out of the footprints and Lp`]);
  return rows;
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
      <label class="muted" for="sbd-axis">Axis 1</label>
      <select id="sbd-axis" title="Projection Plane X: the direction the gaps are measured along">
        <option value="street">along the street line</option><option value="pca">the site's main direction</option><option value="angle">at an angle ...</option></select>
      <input id="sbd-ang" type="number" step="1" min="-180" max="180" title="Degrees from the model's X axis" hidden>
      <button id="sbd-run" class="primary" title="Assess again with these settings">Run</button>
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
    <div class="muted hint">From the building masses: in Revit, <b>LWK > Viewer tools > SBD Export</b>. P, S1/S2/S3 and the air corridors follow the SBD panel's rules, for each zone's own footprints; P is taken on each zone's elevation (IS + PE).</div>`;
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
      : `No masses yet. In Revit: model the buildings as <b>Masses</b>, then <b>LWK > Viewer tools > SBD Export</b>.`;
    for (const b of box.querySelectorAll("#sbd-run, #sbd-save, #sbd-plan, #sbd-3d, #sbd-issue, #sbd-report")) b.disabled = !r || !r.ok;
    $("#sbd-remove").disabled = !m && !B.res;
    if (!r) { $("#sbd-sum").innerHTML = ""; return; }
    if (r.options && !B.view) {
      $("#sbd-axis").value = r.options.axis || "street";
      $("#sbd-ang").value = r.options.angle_deg || 0;
      $("#sbd-ang").hidden = $("#sbd-axis").value !== "angle";
    }
    if (!r.ok) { $("#sbd-sum").innerHTML = `<div class="bad">${(r.warnings || []).map(esc).join("<br>")}</div>`; return; }
    const pz = (a) => (a.P_zone != null ? a.P_zone : a.P);
    const cell = (a) => `<td class="n ${a.pass === false ? "bad" : ""}${a.required_p == null && a.pass == null && r.required_p != null ? " muted" : ""}" title="${a.elev ? `Elevation: IS ${f2(a.elev.P_is)} % + PE ${f2(a.elev.P_pe)} % · on plan IS / W ${f1(a.P)} %` : ""}${a.required_p == null && r.required_p != null ? " - for information (a site under 2 ha is checked on Plane X)" : ""}">${f1(pz(a))}`;
    const rows = r.zones.map((z) => `<tr><td><span class="sbd-dot" style="background:${ZONE_COLOR[z.zone]}"></span>${esc(ZONE_LABEL[z.zone] || z.zone)}</td>`
      + (z.assessed ? `${cell(z.axis1)}<small class="muted sbd-ang">${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + Math.round(z.plane_x_deg) + "°" : ""}</small></td>${cell(z.axis2)}<small class="muted sbd-ang">${z.plane_y_deg != null ? Math.round(z.plane_y_deg) + "°" : ""}</small></td><td class="n">${z.axis1.gaps.filter((g) => g.qualifies).length}/${z.axis1.gaps.length}</td>`
        : `<td colspan="3" class="muted">no building</td>`) + `</tr>`).join("");
    const ok = r.pass;
    $("#sbd-sum").innerHTML = `
      <div class="sbd-verdict ${ok == null ? "" : ok ? "ok" : "bad"}">P = <b>${f1(r.controlling_p)} %</b>${r.required_p != null ? ` · required ${f1(r.required_p)} %${r.required_p_y != null ? ` (Plane Y ${f1(r.required_p_y)} %)` : ""}` : " · no P required (Table 1)"}`
        + `${ok == null ? "" : ok ? " · <b>PASS</b>" : " · <b>FAIL</b>"}</div>
      <table class="sbd-t"><tr><th>Zone</th><th class="n" title="Projection Plane X: (IS + PE) / (W x H) on the zone's elevation; its angle from the street small">P X %</th><th class="n" title="Projection Plane Y, 75-105° from X">P Y %</th><th class="n" title="Gaps that count / all gaps on Axis 1">gaps</th></tr>${rows}</table>
      <div class="muted sbd-lp">Site ${f1(r.site_area_m2)} m² · Lp ${f1(r.lp.projected_m)} m (projected, all buildings)`
        + `${r.required_p !== r.required_p_addin ? ` <span class="bad" title="The SBD panel takes the shorter side of one building (${f1(r.lp.addin_m)} m), which gives a different required P - confirm the reading of APP-152">· add-in Lp ${f1(r.lp.addin_m)} m</span>` : ""}</div>`
      + ((r.case1 || []).length ? `<table class="sbd-t"><tr><th title="Design Requirement (1): Lp ≤ 5 U, per zone">Case 1</th><th class="n" title="Canyon area / its length along the street">U m</th><th class="n" title="The facade projected on the street (Low zone: above 1/3 H)">Lp m</th><th class="n">5U m</th></tr>`
        + r.case1.flatMap((s) => s.buildings.map((b) => `<tr title="${esc(`${s.street}: U = ${f1(b.area_m2)} m² / ${f1(b.L_m)} m = ${f2(b.U_m)} m${b.setback_m != null ? `, facade ${f1(b.setback_m)} m back from the street` : ""}; Lp ${f1(b.Lp_m)} m ${b.pass ? "≤" : ">"} 5U ${f1(b.Lp_max_m)} m`)}"><td>${s.zone ? `<span class="sbd-dot" style="background:${ZONE_COLOR[s.zone]}"></span>` : ""}${esc(s.street)}${b.name ? " · " + esc(b.name) : s.buildings.length > 1 ? " · " + b.building : ""}</td><td class="n">${f1(b.U_m)}</td><td class="n ${b.pass ? "" : "bad"}">${f1(b.Lp_m)}</td><td class="n">${f1(b.Lp_max_m)}</td></tr>`)).join("") + `</table>` : "")
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

  $("#sbd-axis").onchange = () => { $("#sbd-ang").hidden = $("#sbd-axis").value !== "angle"; };
  $("#sbd-run").onclick = async () => {
    if (B.busy) return;
    B.busy = true;
    $("#sbd-run").textContent = "Running ...";
    try {
      B.res = await api("/api/sbd/run", { method: "POST", body: JSON.stringify({ axis: $("#sbd-axis").value, angle_deg: Number($("#sbd-ang").value) || 0 }) });
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
      <div class="sbd-wh"><span class="sbd-ztabs"><button class="ghost" data-v="plan">Plan</button><button class="ghost" data-v="elev" title="The zone's elevational projection on the plane: IS, PE and P by area">Elevation</button></span><span class="sbd-ztabs">${r.zones.map((z) => `<button class="ghost" data-z="${z.zone}"${z.assessed ? "" : " disabled"}>${esc(ZONE_LABEL[z.zone] || z.zone)}${z.assessed ? ` · ${f1(z.P)}%` : ""}</button>`).join("")}</span>
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
      if (view === "elev") {
        const e = ax && ax.elev;
        const req = ax && (ax.required_p != null ? ax.required_p : null);
        back.querySelector(".sbd-plan").innerHTML = e ? elevSvg(r, zone, axisKey) : `<div class="muted">No elevation in this result - run it again.</div>`;
        back.querySelector(".sbd-gaps").innerHTML = e ? `<div class="sbd-ptot">P = ${f2(e.P)} %<br><span class="muted">(IS + PE) / (W x H) on ${axisKey === "axis1" ? "Plane X" : "Plane Y"}${req == null && r.required_p != null ? " - for information: a site under 2 ha is checked on Plane X" : ""}</span></div>`
          + `<table class="sbd-t">${elevWorking(e, req != null ? req : r.required_p).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
          + `<div class="muted sbd-note">IS: in a gap that counts on plan (S1, S3 ≥ 7.5 m; S2 ≥ 15 m), at least 2/3 of the zone's height, or open to above over a lower building (with the IS beside it ≥ 7.5 m wide). PE: a void through the building ≥ 3 m wide and high; it counts up to 1/3 of the required P. Low zone: the portion ≤ 1/3 H is disregarded. On plan (IS / W): ${f1(ax.P)} %.</div>` : "";
        return;
      }
      back.querySelector(".sbd-plan").innerHTML = zoneSvg(r, zone, axisKey);
      const planes = z && z.plane_x_deg != null ? `Plane X ${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + f1(z.plane_x_deg) + "° from the street" : "along the street"} · Plane Y ${f1(z.plane_y_deg)}° from X` : "";
      back.querySelector(".sbd-gaps").innerHTML = ax ? `<div class="sbd-ptot">P = ${f1(ax.P)} %<br><span class="muted">IS ${f2(ax.IS_m)} m / W ${f2(ax.W_m)} m${ax.sweep_deg ? ` · plane side turned ${ax.sweep_deg}°` : ""}</span>${planes ? `<br><span class="muted">${esc(planes)}</span>` : ""}</div>`
        + `<table class="sbd-t"><tr><th>Gap</th><th class="n">S m</th><th></th></tr>` + ax.gaps.map((g) => {
          const sd = g.side && ax.sides && ax.sides[g.side];
          const how = sd ? `S1 (${g.side === "left" ? "left" : "right"} side) = A / D = ${f1(sd.area_m2)} m² / ${f2(sd.depth_m)} m = ${f2(sd.avg_m)} m${sd.angle_deg ? `, edge at ${f1(sd.angle_deg)}°` : ""}`
            : g.corridor ? `S2 corridor ${f2(g.distance_m)} m wide${g.bend_deg ? `, bends ${f1(g.bend_deg)}°` : ", straight"}`
            : g.type === "S3" ? `S3 = A / D = ${f1(g.area_m2)} m² / ${f2(g.depth_m)} m` : g.type === "S1" ? "S1 projected width" : g.type === "S2" ? "S2 nearest distance between the buildings" : "";
          return `<tr><td>${esc(g.type === "FAIL" ? "blocked" : g.type)}</td><td class="n">${f2(gapM(g))}</td><td class="${g.qualifies ? "ok" : "bad"}">${g.qualifies ? "counts" : "no"}${g.threshold_m ? ` <span class="muted">(${g.threshold_m} m)</span>` : ""}${g.encroach_m != null ? ` <span class="bad">${f2(g.encroach_m)} m to the boundary</span>` : ""}</td></tr>`
            + (how ? `<tr class="sbd-how"><td colspan="3">${esc(how)}</td></tr>` : "");
        }).join("") + `</table>`
          + `<div class="muted sbd-note">P = IS / W x 100 %, IS = the S widths that count (S1, S3 ≥ 7.5 m; S2 ≥ 15 m). Corridors may turn up to 15° and return; each side region's edge follows the outer building corners (≤ 15°) - the panel's rules.</div>` : "";
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
    for (const c of r.case1 || []) for (const b of c.buildings) if (!b.pass) lines.push(`Case 1, ${ZONE_LABEL[c.zone] || c.zone || ""} ${c.street}: Lp ${f1(b.Lp_m)} m > 5U ${f1(b.Lp_max_m)} m (U ${f2(b.U_m)} m)`);
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
        items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · ${k === "axis1" ? "Axis 1" : "Axis 2"}`, tag: `P ${f1(ax.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(zoneSvg(r, z.zone, k), 1400),
          rows: [["Gaps", `${f2(ax.IS_m)} m of ${f2(ax.W_m)} m${ax.sweep_deg ? ` (axis turned ${ax.sweep_deg}°)` : ""}`],
            ...ax.gaps.map((g) => [g.type === "FAIL" ? "Blocked" : g.type, `${f2(gapM(g))} m - ${g.qualifies ? "counts" : "does not count"}`, g.qualifies ? "#16a34a" : "#dc2626"]),
            ...((z.corridors || []).length ? [["Air corridors", z.corridors.map((c) => f1(c.width_m) + " m").join(", ")]] : [])] });
        if (ax.elev) items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · elevation on ${k === "axis1" ? "Plane X" : "Plane Y"}`, tag: `P ${f2(ax.elev.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(elevSvg(r, z.zone, k), 1400), rows: elevWorking(ax.elev, ax.required_p != null ? ax.required_p : r.required_p) });
      }
    }
    writeReport(w, {
      title: "SBD report (PNAP APP-152)", project: ctx.projectName(), unit: "zone plans", folder: "SBD",
      sub: new Date().toLocaleString() + (ctx.author() ? " · prepared by " + ctx.author() : ""),
      meta: [["Controlling P", `${f1(r.controlling_p)} %`], ["Required P (Table 1)", r.required_p != null ? `${f1(r.required_p)} %` : "none"],
        ["Result", r.pass == null ? "-" : r.pass ? "PASS" : "FAIL"], ["Site area", `${f1(r.site_area_m2)} m²`],
        ["Lp (projected, all buildings)", `${f1(r.lp.projected_m)} m`], ["Axis 1", r.axis.source === "street" ? "along the street line" : r.axis.source === "pca" ? "the site's main direction" : "at a set angle"],
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
