/* Site study, stage 3: the units - each project's unit layouts (rows of rooms
 * with their sizes, the balcony, utility platform and A/C platforms), drawn to
 * scale with partitions to drag, their saleable area, GFA and concessions,
 * and the office's library (/api/units/library). Kept in study.units.
 */
import * as U from "./unitcore.js";
import { TEMPLATES } from "./unittables.js";
import { api } from "./nav.js";
import { toast } from "./tasks-util.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

let C = null, ON = false, LIB = { units: [] }, HIST = [], HI = -1;

export function init(ctx) {
  C = ctx;
  const P = $("#st-upanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  document.addEventListener("keydown", (ev) => {
    if (!ON || !(ev.ctrlKey || ev.metaKey) || ev.target.closest("input,select,textarea")) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(-1); }
    if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); undo(1); }
  });
  wirePlan();
}
export function store() {
  const s = C.study();
  s.units = s.units && typeof s.units === "object" ? s.units : {};
  s.units.list = Array.isArray(s.units.list) ? s.units.list : [];
  if (s.units.sel == null || s.units.sel >= s.units.list.length) s.units.sel = s.units.list.length ? 0 : -1;
  return s.units;
}
const cur = () => { const st = store(); return st.list[st.sel] || null; };

export async function show(on) {
  ON = on;
  $("#st-upanel").hidden = !on;
  $("#st-uplan").hidden = !on;
  document.body.classList.toggle("st-units", on);
  if (!on) return;
  if (!HIST.length) snap();
  render();
  try { LIB = await api("/api/units/library"); render(); } catch (e) {}
}

function snap() { const j = JSON.stringify(store()); if (HIST[HI] === j) return; HIST = HIST.slice(0, HI + 1); HIST.push(j); if (HIST.length > 80) HIST.shift(); HI = HIST.length - 1; }
function undo(step) {
  const k = HI + step;
  if (k < 0 || k >= HIST.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  HI = k; C.study().units = JSON.parse(HIST[HI]); C.save(); render();
}
function changed() { snap(); C.save(); render(); }

/* ---------- the panel */
function render() {
  if (!ON) return;
  const st = store(), u = cur(), can = C.can(), dis = can ? "" : " disabled";
  const kindOpt = (k) => Object.entries(U.KINDS).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const exOpt = (k) => Object.entries(U.EXTRAS).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const tabs = st.list.map((x, i) => { const f = U.figures(x); return `<button type="button" class="un-tab${i === st.sel ? " on" : ""}" data-usel="${i}">${esc(x.name || "Unit")}<small>${f.saleableFt} ft²</small></button>`; }).join("");
  let body = "";
  if (u) {
    const f = U.figures(u);
    const rows = u.rows.map((r, ri) => `<div class="un-row">
        <div class="un-rh"><b>Row ${ri + 1}</b>${ri === 0 ? " <small>(corridor side)</small>" : ri === u.rows.length - 1 ? " <small>(façade)</small>" : ""}<label>depth <input type="number" step="0.05" min="0.5" data-ud="${ri}" value="${esc(r.depth)}"${dis}> m</label>
          ${can ? `<span class="un-ra"><button type="button" class="ghost st-ib" data-uradd="${ri}" title="A room in this row">+ room</button><button type="button" class="ghost st-ib" data-urup="${ri}" title="Move up">↑</button><button type="button" class="ghost st-ib" data-urdel="${ri}" title="Remove the row">×</button></span>` : ""}</div>
        ${r.rooms.map((q, qi) => { const L = f.layout.rooms.find((x) => x.ri === ri && x.qi === qi); return `<div class="un-room" style="--c:${(U.KINDS[q.kind] || {}).color || "#eee"}">
          <select data-uk="${ri}.${qi}"${dis}>${kindOpt(q.kind)}</select><input data-un="${ri}.${qi}" value="${esc(q.name || "")}" placeholder="name"${dis}>
          <input type="number" step="0.05" min="0.3" data-uw="${ri}.${qi}" value="${esc(q.w)}"${dis}> m <small>${L ? f2(L.area) + " m²" : ""}</small>
          ${can ? `<button type="button" class="ghost st-ib" data-uqdel="${ri}.${qi}" title="Remove">×</button>` : ""}</div>`; }).join("")}
      </div>`).join("");
    const extras = (u.extras || []).map((e, ei) => `<div class="un-room" style="--c:${U.EXTRAS[e.kind] ? U.EXTRAS[e.kind].color : "#eee"}">
        <select data-uek="${ei}"${dis}>${exOpt(e.kind)}</select><input type="number" step="0.05" min="0.1" data-uew="${ei}" value="${esc(e.w)}"${dis}> × <input type="number" step="0.05" min="0.1" data-ued="${ei}" value="${esc(e.d)}"${dis}> m <small>${f2((+e.w || 0) * (+e.d || 0))} m²</small>
        ${e.kind === "acp" ? `<label class="st-chk" title="Complies with the Code of Practice for external maintenance (APP-19 para 3(c))"><input type="checkbox" data-uedfs="${ei}"${e.dfs ? " checked" : ""}${dis}> DfS</label>` : ""}
        ${can ? `<button type="button" class="ghost st-ib" data-uedel="${ei}">×</button>` : ""}</div>`).join("");
    const big = (l, v, s2) => `<div class="st-big"><small>${l}</small><b>${v}</b>${s2 ? `<span>${s2}</span>` : ""}</div>`;
    body = `
      <section class="st-card">
        <div class="st-head"><input class="ms-name" data-uf="name" value="${esc(u.name || "")}"${dis}><span class="muted">${f2(f.layout.outW)} × ${f2(f.layout.outD)} m</span></div>
        <div class="st-bigs un-bigs">
          ${big("Saleable area", `${f1(f.saleable)} <i>m²</i>`, `${f.saleableFt} ft² · incl. balcony ${f2(f.bal)} + UP ${f2(f.up)} m²`)}
          ${big("Unit GFA", `${f1(f.gfa)} <i>m²</i>`, `enclosed ${f2(f.enclosed)} m²`)}
          ${big("Concessions", `${f2(f.balEx + f.upEx + f.acpFree + f.acpCapEx)} <i>m²</i>`, `under the 10% cap ${f2(f.capped)} · A/C platforms not counted ${f2(f.acpFree)}`)}
        </div>
        ${f.warn.length ? `<ul class="un-warn">${f.warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="st-sent good">No warnings.</p>`}
        <p class="muted st-note">Saleable area (First-hand Sales Ordinance s.8): to the outside of external walls and the middle of party walls, partitions included; balcony and utility platform added, A/C platform not. Concessions: balcony ${esc(U.RULES.bal.src)}; utility platform ${esc(U.RULES.up.src)}; A/C platform ${esc(U.RULES.acp.src)}.</p>
      </section>
      <section class="st-card">
        <div class="st-head"><b>Rooms</b><span class="muted">rows from the corridor to the façade</span></div>
        ${rows}
        ${can ? `<button type="button" class="ghost st-ib" data-urowadd>+ Row</button>` : ""}
      </section>
      <section class="st-card">
        <div class="st-head"><b>Balcony, UP and A/C platforms</b><span class="muted">at the façade</span></div>
        ${extras || `<p class="muted st-note">None.</p>`}
        ${can ? `<button type="button" class="ghost st-ib" data-ueadd>+ Add</button>` : ""}
      </section>
      <section class="st-card">
        <div class="st-head"><b>Walls</b></div>
        <div class="un-walls">
          <label>External <input type="number" step="0.01" min="0" data-uf="wall" value="${esc(u.wall)}"${dis}> m</label>
          <label>Party <input type="number" step="0.01" min="0" data-uf="party" value="${esc(u.party)}"${dis}> m</label>
          <label>Partition <input type="number" step="0.01" min="0" data-uf="part" value="${esc(u.part)}"${dis}> m</label>
          <label>Left side <select data-uf="left"${dis}><option value="party"${u.left !== "ext" ? " selected" : ""}>party wall</option><option value="ext"${u.left === "ext" ? " selected" : ""}>external</option></select></label>
          <label>Right side <select data-uf="right"${dis}><option value="party"${u.right !== "ext" ? " selected" : ""}>party wall</option><option value="ext"${u.right === "ext" ? " selected" : ""}>external</option></select></label>
        </div>
      </section>`;
  }
  const libOpt = (LIB.units || []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${U.figures(x.unit).saleableFt} ft²${x.by ? " · " + esc(x.by) : ""}</option>`).join("");
  $("#st-upanel").innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>Units</b>${can ? `<span class="ms-undo"><button type="button" class="ghost st-ib" data-uundo="-1"${HI > 0 ? "" : " disabled"}>↶ Undo</button><button type="button" class="ghost st-ib" data-uundo="1"${HI < HIST.length - 1 ? "" : " disabled"}>↷</button></span>` : ""}<span class="muted" id="un-saved">${can ? "Saved with the project" : "View only"}</span></div>
      <div class="un-tabs">${tabs || `<p class="st-need">No units yet: start from a template or the office library.</p>`}</div>
      ${can ? `<div class="st-row"><select data-unew><option value="">+ New from a template …</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)} · ${U.figures(t).saleableFt} ft²</option>`).join("")}</select>
        <select data-ulib><option value="">+ From the office library …</option>${libOpt}</select></div>
        ${u ? `<div class="st-row"><button type="button" class="ghost st-ib" data-udup>Duplicate</button><button type="button" class="ghost st-ib" data-udel>Remove</button><button type="button" class="ghost st-ib" data-usave>Save to the office library</button><button type="button" class="ghost st-ib" data-usvg>SVG</button></div>` : ""}` : ""}
    </section>
    ${body}`;
  drawPlan();
}

function onChange(ev) {
  const t = ev.target, st = store(), u = cur(), d = t.dataset;
  const num = (v, x) => (isNaN(parseFloat(v)) ? x : Math.max(0, parseFloat(v)));
  if (d.unew != null && t.value) { const c = JSON.parse(JSON.stringify(TEMPLATES[t.value])); let nm = c.name, k = 2; while (st.list.some((q) => q.name === nm)) nm = `${c.name} (${k++})`; c.name = nm; st.list.push(c); st.sel = st.list.length - 1; return changed(); }
  if (d.ulib != null && t.value) { const x = LIB.units.find((q) => q.id === t.value); if (x) { const c = JSON.parse(JSON.stringify(x.unit)); let nm = c.name, k = 2; while (st.list.some((q) => q.name === nm)) nm = `${c.name} (${k++})`; c.name = nm; st.list.push(c); st.sel = st.list.length - 1; toast(`${x.name} copied into this project`); return changed(); } }
  if (!u) return;
  if (d.uf) { u[d.uf] = ["name", "left", "right"].includes(d.uf) ? t.value : num(t.value, u[d.uf]); return changed(); }
  if (d.ud != null) { u.rows[+d.ud].depth = num(t.value, 1); return changed(); }
  const rq = (k) => k.split(".").map(Number);
  if (d.uk) { const [ri, qi] = rq(d.uk), q = u.rows[ri].rooms[qi]; const old = (U.KINDS[q.kind] || {}).label; q.kind = t.value; if (!q.name || q.name === old) q.name = U.KINDS[t.value].label; return changed(); }
  if (d.un) { const [ri, qi] = rq(d.un); u.rows[ri].rooms[qi].name = t.value; return changed(); }
  if (d.uw) { const [ri, qi] = rq(d.uw); u.rows[ri].rooms[qi].w = Math.max(0.3, num(t.value, 1)); return changed(); }
  if (d.uek != null) { u.extras[+d.uek].kind = t.value; return changed(); }
  if (d.uew != null) { u.extras[+d.uew].w = num(t.value, 1); return changed(); }
  if (d.ued != null) { u.extras[+d.ued].d = num(t.value, 1); return changed(); }
  if (d.uedfs != null) { u.extras[+d.uedfs].dfs = t.checked; return changed(); }
}

async function onClick(ev) {
  const t = ev.target.closest("button"); if (!t) return;
  const st = store(), u = cur(), d = t.dataset;
  if (d.uundo) return undo(+d.uundo);
  if (d.usel != null) { st.sel = +d.usel; C.save(); return render(); }
  if (!u) return;
  if (d.udup != null) { const c = JSON.parse(JSON.stringify(u)); c.name += " (copy)"; st.list.push(c); st.sel = st.list.length - 1; return changed(); }
  if (d.udel != null) { if (!confirm(`Remove ${u.name}?`)) return; st.list.splice(st.sel, 1); st.sel = Math.min(st.sel, st.list.length - 1); return changed(); }
  if (d.usave != null) {
    try {
      const ex = (LIB.units || []).find((x) => x.name === u.name);
      if (ex && !confirm(`${u.name} is in the office library already. Replace it?`)) return;
      LIB = await api("/api/units/library", { method: "PUT", body: JSON.stringify({ id: ex ? ex.id : null, unit: u }) });
      toast(`${u.name} saved to the office library`); render();
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (d.usvg != null) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("#st-uplan").innerHTML], { type: "image/svg+xml" })); a.download = (u.name || "unit") + ".svg"; a.click(); return; }
  if (d.urowadd != null) { u.rows.push({ depth: 2.4, rooms: [{ kind: "BR", name: "Bedroom", w: 2.4 }] }); return changed(); }
  if (d.uradd != null) { u.rows[+d.uradd].rooms.push({ kind: "STORE", name: "Store", w: 0.8 }); return changed(); }
  if (d.urup != null) { const i = +d.urup; if (i > 0) [u.rows[i - 1], u.rows[i]] = [u.rows[i], u.rows[i - 1]]; return changed(); }
  if (d.urdel != null) { if (u.rows.length <= 1) return toast("A unit needs one row at least", true); u.rows.splice(+d.urdel, 1); return changed(); }
  if (d.uqdel) { const [ri, qi] = d.uqdel.split(".").map(Number); if (u.rows[ri].rooms.length <= 1) return toast("A row needs one room at least: remove the row", true); u.rows[ri].rooms.splice(qi, 1); return changed(); }
  if (d.ueadd != null) { (u.extras = u.extras || []).push({ kind: "acp", w: 1.0, d: 0.6 }); return changed(); }
  if (d.uedel != null) { u.extras.splice(+d.uedel, 1); return changed(); }
}

/* ---------- the plan, to scale; drag a partition (snaps to 50 mm) or a row's lower edge */
let SC = 60, OX = 40, OY = 40;
function drawPlan() {
  const host = $("#st-uplan"), u = cur();
  if (!u) { host.innerHTML = `<div class="un-empty">Choose a template or a unit from the office library.</div>`; return; }
  const f = U.figures(u), L = f.layout, wall = +u.wall || 0.2;
  const ex = u.extras || [];
  const exW = ex.reduce((s, e) => s + (+e.w || 0) + 0.15, 0), exD = Math.max(0, ...ex.map((e) => +e.d || 0));
  const W = Math.max(L.outW, exW), H = L.outD + exD;
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  SC = Math.max(20, Math.min((bw - 160) / W, (bh - 160) / H));
  OX = (bw - W * SC) / 2; OY = 60;
  const sx = (x) => OX + x * SC, sy = (y) => OY + y * SC;
  const lw = (u.left === "ext" ? wall : (+u.party || 0.2) / 2);
  const x0 = lw, y0 = (u.corridor === "party" ? (+u.party || 0.2) / 2 : wall); // the inner face, from the outer edge
  let g = `<rect x="${sx(0)}" y="${sy(0)}" width="${L.outW * SC}" height="${L.outD * SC}" fill="#5b6470" />`;
  g += `<rect x="${sx(x0)}" y="${sy(y0)}" width="${L.W * SC}" height="${L.D * SC}" fill="#9aa3ad" />`;
  for (const r of L.rooms) {
    const X = sx(x0 + r.x), Y = sy(y0 + r.y), w = r.w * SC, h = r.d * SC;
    g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${(U.KINDS[r.kind] || {}).color || "#fff"}" />`;
    const fs = Math.max(9, Math.min(14, w / 8));
    if (w > 30 && h > 24) g += `<text x="${X + w / 2}" y="${Y + h / 2 - 3}" text-anchor="middle" font-size="${fs}" font-weight="600">${esc(r.name)}</text><text x="${X + w / 2}" y="${Y + h / 2 + fs}" text-anchor="middle" font-size="${fs - 2}" fill="#555">${f2(r.w)} × ${f2(r.d)} · ${f2(r.area)} m²</text>`;
  }
  // the partitions to drag: between rooms in a row, and under each row but the last
  for (const r of L.rooms) {
    const next = L.rooms.find((q) => q.ri === r.ri && q.qi === r.qi + 1);
    if (next) g += `<rect class="un-drag v" data-pv="${r.ri}.${r.qi}" x="${sx(x0 + r.x + r.w) - 4}" y="${sy(y0 + r.y)}" width="${(+u.part || 0.1) * SC + 8}" height="${r.d * SC}" />`;
  }
  u.rows.forEach((row, ri) => {
    if (ri === u.rows.length - 1) return;
    const r = L.rooms.find((q) => q.ri === ri); if (!r) return;
    g += `<rect class="un-drag h" data-ph="${ri}" x="${sx(x0)}" y="${sy(y0 + r.y + r.d) - 4}" width="${L.W * SC}" height="${(+u.part || 0.1) * SC + 8}" />`;
  });
  // the extras below the façade
  let ex0 = 0;
  for (const e of ex) {
    const w = (+e.w || 0) * SC, h = (+e.d || 0) * SC, X = sx(ex0), Y = sy(L.outD);
    g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${(U.EXTRAS[e.kind] || {}).color}" stroke="#5b6470" stroke-width="1.2" stroke-dasharray="4 3" />`;
    if (w > 26) g += `<text x="${X + w / 2}" y="${Y + h / 2 + 4}" text-anchor="middle" font-size="10">${{ bal: "BAL", up: "U.P.", acp: "A.C.P." }[e.kind] || ""} ${f2((+e.w || 0) * (+e.d || 0))}</text>`;
    ex0 += (+e.w || 0) + 0.15;
  }
  // overall dimensions
  g += `<line x1="${sx(0)}" y1="${sy(0) - 18}" x2="${sx(L.outW)}" y2="${sy(0) - 18}" stroke="#333" /><text x="${sx(L.outW / 2)}" y="${sy(0) - 24}" text-anchor="middle" font-size="12">${f2(L.outW)} m</text>`;
  g += `<line x1="${sx(L.outW) + 18}" y1="${sy(0)}" x2="${sx(L.outW) + 18}" y2="${sy(L.outD)}" stroke="#333" /><text x="${sx(L.outW) + 24}" y="${sy(L.outD / 2)}" font-size="12">${f2(L.outD)} m</text>`;
  g += `<text x="${sx(L.outW / 2)}" y="${sy(0) - 40}" text-anchor="middle" font-size="11" fill="#777">corridor</text><text x="${sx(L.outW / 2)}" y="${sy(H) + 22}" text-anchor="middle" font-size="11" fill="#777">façade</text>`;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="sans-serif">${g}</svg>`;
}
function wirePlan() {
  const host = $("#st-uplan");
  let drag = null;
  host.addEventListener("pointerdown", (ev) => {
    const t = ev.target; if (!C.can() || !(t.dataset.pv || t.dataset.ph)) return;
    drag = { t, x: ev.clientX, y: ev.clientY, u0: JSON.parse(JSON.stringify(cur())) };
    host.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const st = store(), d = drag.t.dataset;
    let v = drag.u0;
    if (d.pv) { const [ri, qi] = d.pv.split(".").map(Number); v = U.movePartition(drag.u0, ri, qi, (ev.clientX - drag.x) / SC); }
    else { const ri = +d.ph; v = JSON.parse(JSON.stringify(drag.u0)); v.rows[ri].depth = Math.max(0.6, Math.round((+v.rows[ri].depth + (ev.clientY - drag.y) / SC) * 20) / 20); }
    st.list[st.sel] = v;
    render();
    drag.t = host.querySelector(d.pv ? `[data-pv="${d.pv}"]` : `[data-ph="${d.ph}"]`) || drag.t;
  });
  const end = () => { if (drag) { drag = null; changed(); } };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => ON && drawPlan());
}
