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
  // the gaps: strips across the site, green when they count, red when not
  if (ax) {
    s += `<g clip-path="url(#${id})">` + ax.gaps.map((g) => `<polygon points="${poly(g.strip)}" fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity=".22" stroke="${g.qualifies ? "#16a34a" : "#dc2626"}" stroke-width="${fs / 12}"/>`).join("") + `</g>`;
  }
  // the neighbours' buildings, and this zone's
  s += (z.others || []).map((l) => `<polygon points="${poly(l)}" fill="url(#${id}h)" stroke="#94a3b8" stroke-width="${fs / 12}"/>`).join("");
  s += z.footprints.map((f) => `<polygon points="${poly(f.loop)}" fill="#475569" fill-opacity=".55" stroke="#1e293b" stroke-width="${fs / 10}"/>`).join("");
  // the air corridors found (15 m or more)
  s += (z.corridors || []).map((c) => `<polygon points="${poly(c.polygon)}" fill="none" stroke="#2563eb" stroke-width="${fs / 7}" stroke-dasharray="${fs / 2} ${fs / 3}"/>`).join("");
  if (ax) {
    for (const g of ax.gaps) {
      if (g.pinch) {
        const [a, b] = g.pinch;
        s += `<line x1="${(a[0] - x0).toFixed(3)}" y1="${(y1 - a[1]).toFixed(3)}" x2="${(b[0] - x0).toFixed(3)}" y2="${(y1 - b[1]).toFixed(3)}" stroke="${g.pass ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 6}"/>`;
      }
      // the label at the strip's middle, on the site's side nearest the axis start
      const c = g.strip.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
      const t = `${g.type === "FAIL" ? "blocked" : g.type} ${f1(g.type === "S2" || g.type === "S3" ? g.distance_m : g.width_m)} m`;
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
      <button id="sbd-plan" class="ghost" title="The plan of each zone: the gaps, the pinch points and the air corridors">Plan ...</button>
      <label class="row-check" style="width:auto" title="The masses and the zone limits in the model"><input type="checkbox" id="sbd-3d"> 3D</label>
      <button id="sbd-issue" class="ghost" title="An issue for what fails">Make issue</button>
      <button id="sbd-report" class="ghost" title="A report: the table and a plan of each zone (Print / Save to Folders)">Report</button>
    </div>
    <div class="muted hint">From the building masses: in Revit, <b>LWK > Viewer tools > SBD Export</b>. P, S1/S2/S3 and the air corridors follow the SBD panel's rules, for each zone's own footprints.</div>`;
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
    if (!r) { $("#sbd-sum").innerHTML = ""; return; }
    if (r.options && !B.view) {
      $("#sbd-axis").value = r.options.axis || "street";
      $("#sbd-ang").value = r.options.angle_deg || 0;
      $("#sbd-ang").hidden = $("#sbd-axis").value !== "angle";
    }
    if (!r.ok) { $("#sbd-sum").innerHTML = `<div class="bad">${(r.warnings || []).map(esc).join("<br>")}</div>`; return; }
    const rows = r.zones.map((z) => `<tr><td><span class="sbd-dot" style="background:${ZONE_COLOR[z.zone]}"></span>${esc(ZONE_LABEL[z.zone] || z.zone)}</td>`
      + (z.assessed ? `<td class="n">${f1(z.axis1.P)}</td><td class="n">${f1(z.axis2.P)}</td><td class="n">${z.axis1.gaps.filter((g) => g.qualifies).length}/${z.axis1.gaps.length}</td>`
        : `<td colspan="3" class="muted">no building</td>`) + `</tr>`).join("");
    const ok = r.pass;
    $("#sbd-sum").innerHTML = `
      <div class="sbd-verdict ${ok == null ? "" : ok ? "ok" : "bad"}">P = <b>${f1(r.controlling_p)} %</b>${r.required_p != null ? ` · required ${f1(r.required_p)} %` : " · no P required (Table 1)"}`
        + `${ok == null ? "" : ok ? " · <b>PASS</b>" : " · <b>FAIL</b>"}</div>
      <table class="sbd-t"><tr><th>Zone</th><th class="n" title="Axis 1 (best of ±15° and both sides)">P1 %</th><th class="n" title="Axis 2 (at right angles)">P2 %</th><th class="n" title="Gaps that count / all gaps on Axis 1">gaps</th></tr>${rows}</table>
      <div class="muted sbd-lp">Site ${f1(r.site_area_m2)} m² · Lp ${f1(r.lp.projected_m)} m (projected, all buildings)`
        + `${r.required_p !== r.required_p_addin ? ` <span class="bad" title="The SBD panel takes the shorter side of one building (${f1(r.lp.addin_m)} m), which gives a different required P - confirm the reading of APP-152">· add-in Lp ${f1(r.lp.addin_m)} m</span>` : ""}</div>`
      + ((r.case1 || []).length ? `<table class="sbd-t"><tr><th>Street (Case 1)</th><th class="n">U m</th><th class="n">Lp m</th><th class="n">5U m</th></tr>`
        + r.case1.flatMap((s) => s.buildings.map((b) => `<tr><td>${esc(s.street)}${s.buildings.length > 1 ? " · " + b.building : ""}</td><td class="n">${f1(b.U_m)}</td><td class="n ${b.pass ? "" : "bad"}">${f1(b.Lp_m)}</td><td class="n">${f1(b.Lp_max_m)}</td></tr>`)).join("") + `</table>` : "")
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
    let zone = (zones.find((z) => z.P === r.controlling_p) || zones[0] || {}).zone, axisKey = "axis1";
    const back = document.createElement("div");
    back.className = "sbd-back";
    back.innerHTML = `<div class="sbd-win" role="dialog" aria-label="SBD plan">
      <div class="sbd-wh"><b>SBD plan</b><span class="sbd-ztabs">${r.zones.map((z) => `<button class="ghost" data-z="${z.zone}"${z.assessed ? "" : " disabled"}>${esc(ZONE_LABEL[z.zone] || z.zone)}${z.assessed ? ` · ${f1(z.P)}%` : ""}</button>`).join("")}</span>
        <span class="sbd-ztabs"><button class="ghost" data-a="axis1">Axis 1</button><button class="ghost" data-a="axis2">Axis 2</button></span>
        <span class="spacer"></span><button class="ghost" data-x title="Close">&#10005;</button></div>
      <div class="sbd-wb"><div class="sbd-plan"></div><div class="sbd-gaps"></div></div>
      <div class="sbd-legend muted"><span class="sw" style="background:#16a34a55;border-color:#16a34a"></span>a gap that counts <span class="sw" style="background:#dc262655;border-color:#dc2626"></span>does not (too narrow, or blocked)
        <span class="sw" style="background:#47556999"></span>this zone's buildings <span class="sw dash"></span>air corridor ≥ 15 m <span class="sw" style="background:#f28022"></span>axis
        <span class="sw" style="background:#e2e8f0;border-color:#94a3b8"></span>street, its centreline and the opposite boundary</div></div>`;
    document.body.appendChild(back);
    const draw = () => {
      back.querySelectorAll("[data-z]").forEach((b) => b.classList.toggle("active", b.dataset.z === zone));
      back.querySelectorAll("[data-a]").forEach((b) => b.classList.toggle("active", b.dataset.a === axisKey));
      back.querySelector(".sbd-plan").innerHTML = zoneSvg(r, zone, axisKey);
      const z = r.zones.find((x) => x.zone === zone);
      const ax = z && z[axisKey];
      back.querySelector(".sbd-gaps").innerHTML = ax ? `<div class="sbd-ptot">P = ${f1(ax.P)} %<br><span class="muted">gaps ${f1(ax.IS_m)} m of ${f1(ax.W_m)} m${ax.sweep_deg ? ` · axis turned ${ax.sweep_deg}°` : ""}</span></div>`
        + `<table class="sbd-t"><tr><th>Gap</th><th class="n">m</th><th></th></tr>` + ax.gaps.map((g) => `<tr><td>${esc(g.type === "FAIL" ? "blocked" : g.type)}</td>`
          + `<td class="n">${f2(g.type === "S2" || g.type === "S3" ? g.distance_m : g.width_m)}</td><td class="${g.qualifies ? "ok" : "bad"}">${g.qualifies ? "counts" : "no"}${g.threshold_m ? ` <span class="muted">(${g.threshold_m} m)</span>` : ""}${g.encroach_m != null ? ` <span class="bad">${f2(g.encroach_m)} m to the boundary</span>` : ""}</td></tr>`).join("") + `</table>`
          + ((z.corridors || []).length ? `<div class="muted">Air corridors: ${z.corridors.map((c) => f1(c.width_m) + " m").join(", ")}</div>` : "") : "";
    };
    back.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (ev.target === back || (b && b.hasAttribute("data-x"))) { back.remove(); return; }
      if (!b) return;
      if (b.dataset.z) zone = b.dataset.z;
      if (b.dataset.a) axisKey = b.dataset.a;
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
      lines.push(`${ZONE_LABEL[z.zone] || z.zone}: P ${f1(z.axis1.P)} % (Axis 1), ${f1(z.axis2.P)} % (Axis 2)`
        + (bad.length ? ` - not counted: ${bad.map((g) => `${g.type === "FAIL" ? "blocked gap" : g.type} ${f2(g.type === "S2" || g.type === "S3" ? g.distance_m : g.width_m)} m`).join(", ")}` : ""));
    }
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
            ...ax.gaps.map((g) => [g.type === "FAIL" ? "Blocked" : g.type, `${f2(g.type === "S2" || g.type === "S3" ? g.distance_m : g.width_m)} m - ${g.qualifies ? "counts" : "does not count"}`, g.qualifies ? "#16a34a" : "#dc2626"]),
            ...((z.corridors || []).length ? [["Air corridors", z.corridors.map((c) => f1(c.width_m) + " m").join(", ")]] : [])] });
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
      table: { cols: ["Zone", "P Axis 1 %", "P Axis 2 %"], rows: r.zones.map((z) => [ZONE_LABEL[z.zone] || z.zone, z.assessed ? f1(z.axis1.P) : "-", z.assessed ? f1(z.axis2.P) : "-"]) },
      items,
    });
    ctx.status("SBD report ready in a new tab - Print / Save as PDF there, or Save to Folders.");
  };

  return { refresh: load, close: () => show3d(false) };
}
