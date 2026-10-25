/* Light & Ventilation: the Revit Light & Vent check's result in the viewer.
 *
 * The check runs in the Calculation model and sends each room's outline,
 * label point and floor level, and each window's position, in SHARED
 * coordinates (lv_api.py keeps it). Each plan viewport of a sheet carries a
 * shared -> paper transform (manifest shared_to_paper) and its level in
 * shared Z, so the rooms are drawn on the plans of their own floor - also on
 * sheets published from another model (the Layout model), as long as the
 * two sit on the same shared coordinates. No room-by-room matching.
 *
 *   loadReport()            the report (kept on the device too)
 *   createLvSheets(ctx)     Sheets: View > Light & Vent, the coloured rooms,
 *                           the room card, Make issue / Show in 3D
 *   renderTable(box, rep)   the table (3D page, Checks > Light & Vent)
 *   sheetFor(manifest, r)   the sheet whose plan shows a room
 */

import { api, project, link, keptBig, keepBig, headers } from "./nav.js";
import { insideLoops } from "./areas.js";

export const LEVEL_TOL_MM = 300;
const COL = { OK: "#16a34a", "NOT OK": "#dc2626", "NO WINDOW": "#dc2626", "NEEDS DATA": "#d97706" };
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f3 = (v) => (v == null || v === "" ? "-" : Number(v).toFixed(3));

/* ---------------------------------------------------------------- report */

let _rep = null, _repAt = 0;
export async function loadReport(fresh) {
  if (_rep && !fresh && Date.now() - _repAt < 60000) return _rep;
  const key = "lv:" + project();
  try {
    const r = await api("/api/lv");
    _rep = index(r.report);
    _repAt = Date.now();
    if (r.report) keepBig(key, { at: Date.now(), report: r.report });
  } catch (e) {
    const k = await keptBig(key);
    _rep = k ? index(k.report) : null;
  }
  return _rep;
}

/* rooms by uid; a room counted with another ("WITH 131") takes its host's result */
function index(rep) {
  if (!rep) return null;
  const byUid = new Map((rep.rooms || []).map((r) => [r.uid, r]));
  const byNum = new Map((rep.rooms || []).map((r) => [(r.level || "") + "|" + r.number, r]));
  for (const r of rep.rooms || []) {
    if (String(r.status || "").startsWith("WITH")) {
      r._host = byUid.get(r.merged_into_uid) || byNum.get((r.level || "") + "|" + String(r.status).slice(5)) || null;
    }
  }
  rep._byUid = byUid;
  return rep;
}

export const merged = (r) => String(r.status || "").startsWith("WITH");
export function result(r) { return merged(r) && r._host ? r._host.status : r.status; }
export function colour(r) { return COL[result(r)] || "#6b7280"; }

export function counts(rep) {
  const c = { OK: 0, "NOT OK": 0, "NEEDS DATA": 0, "NO WINDOW": 0, merged: 0 };
  for (const r of (rep && rep.rooms) || []) merged(r) ? c.merged++ : (c[r.status] = (c[r.status] || 0) + 1);
  return c;
}

export function aff(t, x, y) { return [t[0][0] * x + t[0][1] * y + t[0][2], t[1][0] * x + t[1][1] * y + t[1][2]]; }
const onFloor = (vp, r) => vp.level_sh_mm != null && r.level_sh_mm != null && Math.abs(vp.level_sh_mm - r.level_sh_mm) <= LEVEL_TOL_MM;
const inRect = (rc, p) => p[0] >= rc[0] && p[0] <= rc[0] + rc[2] && p[1] >= rc[1] && p[1] <= rc[1] + rc[3];
function anchorOf(r) {
  if (r.label_sh) return r.label_sh;
  const L = (r.loops_sh || [])[0] || [];
  return L.length ? [L.reduce((s, p) => s + p[0], 0) / L.length, L.reduce((s, p) => s + p[1], 0) / L.length] : null;
}

const nrm = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().toUpperCase();
const centre = (L) => [L.reduce((s, p) => s + p[0], 0) / L.length, L.reduce((s, p) => s + p[1], 0) / L.length];

/* the plans of a sheet that show a room: [{vp, loops (paper mm), at, via}].
   A plan published with the updated add-in places the room exactly, by
   shared coordinates ("shared"). An older plan has no such placement: then
   the plan's own rooms (published on sheets with a room schedule) are
   matched by room number + name ("name") - until the plans are published
   again. only: just that viewport. */
export function placements(sheet, r, only) {
  const out = [];
  const a = anchorOf(r);
  for (const vp of only ? [only] : (sheet && sheet.viewports) || []) {
    if (!vp.paper_rect_mm) continue;
    if (vp.shared_to_paper) {
      if (!r.loops_sh || !r.loops_sh.length || !onFloor(vp, r)) continue;
      const at = a ? aff(vp.shared_to_paper, a[0], a[1]) : null;
      if (!at || !inRect(vp.paper_rect_mm, at)) continue;
      out.push({ vp, at, via: "shared", loops: r.loops_sh.map((L) => L.map((p) => aff(vp.shared_to_paper, p[0], p[1]))) });
    } else {
      const want = nrm(r.number) + "|" + nrm(r.name);
      for (const ar of (sheet && sheet.areas) || []) {
        if (ar.kind !== "room" || !(ar.loops || []).length || nrm(ar.number) + "|" + nrm(ar.name) !== want) continue;
        if (ar.view_id != null && vp.view_id != null && ar.view_id !== vp.view_id) continue;
        const at = ar.label || centre(ar.loops[0]);
        if (!inRect(vp.paper_rect_mm, at)) continue;
        out.push({ vp, at, via: "name", loops: ar.loops });
      }
    }
  }
  return out;
}

const mStr = (mm) => (mm >= 0 ? "+" : "") + (mm / 1000).toFixed(2) + " m";
/* why a room is on no plan, in words */
export function whyNot(manifest, r) {
  const vps = ((manifest && manifest.sheets) || []).flatMap((sh) => sh.viewports || []);
  const placed = vps.filter((vp) => vp.shared_to_paper);
  if (!placed.length) {
    return "No plan sheet is published with its shared-coordinate placement yet, and no room on the plans has this "
      + "number and name. Publish the Layout model's plan sheets again with the updated add-in.";
  }
  if (!r.loops_sh || !r.loops_sh.length) return "This room was sent without its outline: run Light & Vent and send it again with the updated add-in.";
  const lv = Array.from(new Set(placed.map((vp) => vp.level_sh_mm).filter((x) => x != null))).sort((x, y) => x - y);
  if (r.level_sh_mm != null && !lv.some((z) => Math.abs(z - r.level_sh_mm) <= LEVEL_TOL_MM)) {
    return `No plan of this floor is published: this room is at ${mStr(r.level_sh_mm)} (shared); the plans are at `
      + lv.slice(0, 8).map(mStr).join(", ") + (lv.length > 8 ? " ..." : "") + ".";
  }
  return "The plans of this floor do not show this part of the building (or the two models are not on the same shared coordinates).";
}

/* the linked models a sheet's plans were printed without: [{name, why}] */
export function missingLinks(sheet) {
  const seen = new Map();
  for (const vp of (sheet && sheet.viewports) || []) {
    for (const m of vp.links_missing || []) if (!seen.has(m.name)) seen.set(m.name, m);
  }
  return Array.from(seen.values());
}

/* the sheet whose plans show the most of these rooms: {sheet, n}, or null */
export function bestSheet(manifest, rooms) {
  let best = null;
  for (const sh of (manifest && manifest.sheets) || []) {
    if (!(sh.viewports || []).some((vp) => vp.paper_rect_mm)) continue;
    let n = 0;
    for (const r of rooms) if (placements(sh, r).length) n++;
    if (n && (!best || n > best.n)) best = { sheet: sh, n };
  }
  return best;
}

/* the first sheet with a plan showing the room */
export function sheetFor(manifest, r) {
  for (const sh of (manifest && manifest.sheets) || []) if (placements(sh, r).length) return sh;
  return null;
}

/* the Sheets page on that sheet, with the room shown */
export const sheetUrl = (sh, r) => link("index.html", { sheet: sh.number, lv: r.uid });

/* ------------------------------------------------------------------ card */

/* opts.page: "2d" (Sheets) or "3d"; opts.plan: the sheet showing it, or null; opts.why */
export function roomCard(r, opts) {
  opts = opts || {};
  const is3d = opts.page === "3d";
  const res = result(r);
  const host = merged(r) && r._host;
  const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
  const wins = (r.windows || []).map((w) => `<tr><td>${esc(w.mark || "")}</td><td title="${esc(w.key)}">${esc((w.key || "").split(" : ").pop())}</td>`
    + `<td>${w.w_mm ? Math.round(w.w_mm) + "×" + Math.round(w.h_mm || 0) : ""}</td><td>${esc(w.operation || "")}${w.confirmed === false ? " <i>(to confirm)</i>" : ""}</td>`
    + `<td>${f3(w.light_meas != null ? w.light_meas : w.light_bd)}</td><td>${f3(w.open_meas != null ? w.open_meas : w.open_bd)}</td>`
    + `<td>${w.share != null && w.share < 0.999 ? Math.round(w.share * 100) + "%" : ""}</td></tr>`).join("");
  const ok = (p, q) => (p != null && q != null ? (p + 1e-9 >= q ? "ok" : "bad") : "");
  return `<div class="lv-card">`
    + `<div class="ai-head"><span class="lv-dot" style="background:${colour(r)}"></span><b>${esc([r.number, r.name].filter(Boolean).join(" "))}</b>`
    + `<span class="lv-st" style="color:${colour(r)}">${esc(res || "")}</span><span class="spacer"></span>`
    + `<button class="ghost linkish" data-lv="close" title="Close (Esc)">&#10005;</button></div>`
    + `<div class="ai-body">`
    + kv("Tower / flat / floor", esc([r.block, r.flat, r.level].filter(Boolean).join(" · ")))
    + kv("Area", r.area_m2 != null ? Number(r.area_m2).toFixed(3) + " m²" : "-")
    + (host ? kv("Counted with", esc(`${host.number} ${host.name || ""}`) + ` (${esc(host.status)})`) : "")
    + ((r.with || []).length ? kv("Counts with it", esc(r.with.map((w) => `${w.number} ${w.name}`).join(", "))) : "")
    + (!host ? `<div class="lv-tw"><table class="lv-req"><tr><th></th><th>Required</th><th>Provided</th><th>W×H×70%</th></tr>`
      + `<tr><td>Lighting (1/10)</td><td>${f3(r.req_light)}</td><td class="${ok(r.prov_light_meas, r.req_light)}">${f3(r.prov_light_meas)}</td><td>${f3(r.prov_light_bd)}</td></tr>`
      + `<tr><td>Openable (1/16)</td><td>${f3(r.req_open)}</td><td class="${ok(r.prov_open_meas, r.req_open)}">${f3(r.prov_open_meas)}</td><td>${f3(r.prov_open_bd)}</td></tr></table></div>` : "")
    + (wins ? `<details class="lv-wd"${(r.windows || []).length > 6 ? "" : " open"}><summary class="lv-sub">Windows and panels: ${(r.windows || []).length} (m²)</summary>`
      + `<div class="lv-tw"><table class="lv-win"><tr><th>Mark</th><th>Type</th><th>Size</th><th>Opens</th><th>Glass</th><th>Open</th><th>Share</th></tr>${wins}</table></div></details>` : "")
    + ((r.notes || []).length ? `<div class="lv-sub">Notes</div><ul class="lv-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "")
    + (r.source ? kv("From", esc(r.source)) : "")
    + `<div class="lv-acts">`
    + (is3d
      ? `<button class="ghost" data-lv="show3d">Show in 3D</button><button class="ghost" data-lv="issue3d">Make issue (3D)</button>`
        + (opts.plan ? `<button class="ghost" data-lv="plan">Show on plan ${esc(opts.plan.number)}</button>` : "")
      : ((r.windows || []).some((w) => w.uid) ? `<a class="ghost btnlike" data-lv="3d" href="${esc(link("model.html", { elements: (r.windows || []).map((w) => w.uid).filter(Boolean).join(",") }))}">Show in 3D</a>` : "")
        + `<button class="ghost" data-lv="issue">Make issue</button>`)
    + `</div>`
    + (is3d && !opts.plan && opts.why ? `<div class="lv-why">${esc(opts.why)}</div>` : "")
    + `</div></div>`;
}

export function issueText(r) {
  const res = result(r);
  const t = `L&V: ${[r.flat, r.number, r.name].filter((x, i, a) => x && a.indexOf(x) === i).join(" ")} ${res}`.trim();
  const d = [`Light & Vent check (${r.level || ""}): ${res}.`,
    r.req_light != null ? `Lighting: required ${f3(r.req_light)} m², provided ${f3(r.prov_light_meas)} m² (W×H×70%: ${f3(r.prov_light_bd)}).` : "",
    r.req_open != null ? `Openable: required ${f3(r.req_open)} m², provided ${f3(r.prov_open_meas)} m² (W×H×70%: ${f3(r.prov_open_bd)}).` : "",
    ...(r.notes || [])].filter(Boolean).join("\n");
  return { title: t.slice(0, 200), description: d };
}

/* ---------------------------------------------------------------- Sheets */

export function createLvSheets(ctx) {
  const { S, $, status } = ctx;
  const KEY = "lwk-viewer:lv-on", MODE = "lwk-viewer:lv-mode";
  // on: View > Light & Vent; mode: how the rooms show - "fill", "outline" or "off"
  // (the legend's switch, remembered on this device)
  const L = { on: false, mode: "fill", rep: null, drawn: [], cur: null };
  try {
    L.on = localStorage.getItem(KEY) === "1";
    L.mode = ["fill", "outline", "off"].includes(localStorage.getItem(MODE)) ? localStorage.getItem(MODE) : "fill";
  } catch (e) {}
  const svgNS = "http://www.w3.org/2000/svg";

  function layer() {
    let svg = document.getElementById("lv-layer");
    if (!svg) {
      const page = $("#page");
      if (!page) return null;
      svg = document.createElementNS(svgNS, "svg");
      svg.id = "lv-layer";
      const before = document.getElementById("area-layer") || document.getElementById("find-layer");
      page.insertBefore(svg, before || page.firstChild);
    }
    return svg;
  }
  const path = (loops) => loops.map((Lp) => Lp.map(([u, v], i) => {
    const [x, y] = ctx.canvasFrom(u, v);
    return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ") + " Z").join(" ");

  function legend(text) {
    let el = document.getElementById("lv-legend");
    if (!el) {
      el = document.createElement("div");
      el.id = "lv-legend";
      document.body.appendChild(el);
    }
    el.hidden = !text;
    el.innerHTML = text || "";
  }

  function draw() {
    const svg = layer();
    if (!svg) return;
    svg.innerHTML = "";
    L.drawn = [];
    const sh = S.sheet;
    if (!L.on || !L.rep || !sh || !S.viewport) { svg.style.display = "none"; legend(""); return; }
    svg.style.display = "";
    const w = Math.round(S.viewport.width), h = Math.round(S.viewport.height);
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const plans = (sh.viewports || []).filter((vp) => vp.paper_rect_mm);
    const placed = plans.filter((vp) => vp.shared_to_paper).length;
    let byName = 0;
    let n = 0;
    const outline = L.mode === "outline";
    // linked models the plans were printed without (not loaded / closed workset / hidden)
    const missing = missingLinks(sh);
    (L.mode === "off" ? [] : plans).forEach((vp, k) => {
      // clipped to the viewport: a room never spills over another view
      const r0 = vp.paper_rect_mm, a = ctx.canvasFrom(r0[0], r0[1]), b = ctx.canvasFrom(r0[0] + r0[2], r0[1] + r0[3]);
      const cp = document.createElementNS(svgNS, "clipPath");
      cp.id = "lv-clip-" + k;
      const rc = document.createElementNS(svgNS, "rect");
      rc.setAttribute("x", Math.min(a[0], b[0])); rc.setAttribute("y", Math.min(a[1], b[1]));
      rc.setAttribute("width", Math.abs(b[0] - a[0])); rc.setAttribute("height", Math.abs(b[1] - a[1]));
      cp.appendChild(rc); svg.appendChild(cp);
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("clip-path", `url(#lv-clip-${k})`);
      svg.appendChild(g);
      for (const r of L.rep.rooms || []) {
        const pl = placements(sh, r, vp)[0];
        if (!pl) continue;
        n++;
        if (pl.via === "name") byName++;
        L.drawn.push({ r, loops: pl.loops, at: pl.at });
        const p = document.createElementNS(svgNS, "path");
        p.setAttribute("d", path(pl.loops));
        p.setAttribute("fill-rule", "evenodd");
        p.setAttribute("class", "lv-room" + (outline ? " lv-outline" : "") + (merged(r) ? " lv-merged" : "") + (L.cur === r ? " on" : ""));
        p.setAttribute("style", `--c:${colour(r)}`);
        g.appendChild(p);
        if (outline && pl.at) {
          // the room's result at its label, the drawing left uncovered
          const [x, y] = ctx.canvasFrom(pl.at[0], pl.at[1]);
          const d = document.createElementNS(svgNS, "circle");
          d.setAttribute("cx", x.toFixed(1)); d.setAttribute("cy", y.toFixed(1)); d.setAttribute("r", 5);
          d.setAttribute("class", "lv-dotmark");
          d.setAttribute("style", `--c:${colour(r)}`);
          g.appendChild(d);
        }
        for (const wd of pl.via === "shared" ? r.windows || [] : []) {
          if (!wd.pos_sh) continue;
          const [x, y] = ctx.canvasFrom(...aff(vp.shared_to_paper, wd.pos_sh[0], wd.pos_sh[1]));
          const c = document.createElementNS(svgNS, "circle");
          c.setAttribute("cx", x.toFixed(1)); c.setAttribute("cy", y.toFixed(1)); c.setAttribute("r", 3.2);
          c.setAttribute("class", "lv-win");
          c.setAttribute("style", `--c:${colour(r)}`);
          g.appendChild(c);
        }
      }
    });
    const c = counts(L.rep);
    const sw = (k, lab) => `<span><i style="background:${COL[k]}"></i>${c[k]} ${lab}</span>`;
    const seg = `<span class="lv-seg" role="group" aria-label="Room colours">`
      + [["fill", "Filled"], ["outline", "Outline"], ["off", "Off"]].map(([k, lab]) =>
        `<button class="ghost${L.mode === k ? " on" : ""}" data-mode="${k}" title="${k === "fill" ? "Rooms filled with their result colour"
          : k === "outline" ? "Only the rooms' outlines and a dot: the drawing stays fully readable" : "No colours (the legend stays, to turn them on again)"}">${lab}</button>`).join("") + `</span>`;
    if (L.mode === "off") {
      legend(`<b>Light &amp; Vent</b>${seg}`);
      wireLegend();
      return;
    }
    legend(`<b>Light &amp; Vent</b>${seg}` + sw("OK", "OK") + sw("NOT OK", "not OK") + sw("NEEDS DATA", "need data")
      + (c["NO WINDOW"] ? `<span><i style="background:${COL["NO WINDOW"]}"></i>${c["NO WINDOW"]} no window</span>` : "")
      + `<small>${esc(L.rep.model || "")}${L.rep.at ? " · " + esc(String(L.rep.at).replace("T", " ").slice(0, 16)) : ""}</small>`
      + (n ? `<small>${n} room(s) on this sheet - click one${byName ? ` (${byName} matched by room number and name)` : ""}</small>` : "")
      + (plans.length && placed < plans.length
        ? `<small class="bad">${placed ? `${plans.length - placed} of ${plans.length} plans` : "This sheet's plans"} have no shared-coordinate placement`
          + `${byName ? " - rooms there are matched by number and name only" : ""}: publish the Layout model's sheets again with the updated add-in.</small>` : "")
      + (!n && placed ? `<small>No checked room on the floor of this sheet's plans.</small>` : "")
      + (missing.length ? `<small class="bad">Drawn without ${esc(missing.map((m) => m.name + " (" + m.why + ")").join(", "))} when published - `
        + `publish the sheet again with the links loaded and their worksets open.</small>` : "")
      + `<span class="lv-lg-acts"><a href="#" data-lv="report">Full report</a>${L.rep.pdf ? ` · <a href="#" data-lv="pdf">Diagrams (PDF)</a>` : ""}</span>`);
    wireLegend();
  }

  function wireLegend() {
    const lg = document.getElementById("lv-legend");
    if (!lg) return;
    for (const b of lg.querySelectorAll("[data-mode]")) b.onclick = () => setMode(b.dataset.mode);
    const rp = lg.querySelector('[data-lv="report"]');
    if (rp) rp.onclick = (ev) => { ev.preventDefault(); openReport(L.rep); };
    const pd = lg.querySelector('[data-lv="pdf"]');
    if (pd) pd.onclick = (ev) => { ev.preventDefault(); openPdf(); };
  }

  function setMode(m) {
    L.mode = m;
    try { localStorage.setItem(MODE, m); } catch (e) {}
    if (m === "off") { L.cur = null; card(null); }
    draw();
  }

  function card(r) {
    let box = document.getElementById("lv-info");
    const host = document.getElementById("items");
    if (!box && host) {
      box = document.createElement("div");
      box.id = "lv-info";
      host.insertBefore(box, host.firstChild);
    }
    if (!box) return;
    if (!r) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = roomCard(r, { page: "2d" });
    box.querySelector('[data-lv="close"]').onclick = () => clear();
    const mk = box.querySelector('[data-lv="issue"]');
    if (mk) mk.onclick = () => {
      const d = L.drawn.find((x) => x.r === r);
      if (d && ctx.makeIssue) ctx.makeIssue(d.loops, issueText(r));
    };
  }

  function pick(r) {
    L.cur = r;
    draw();
    card(r);
    if (r) status(`${[r.number, r.name].filter(Boolean).join(" ")}: ${result(r)} - Esc to clear`);
  }

  /* a click on the paper (Select tool); true when it hit a room */
  function clickAt(u, v) {
    if (!L.on || !L.drawn.length) return false;
    const hit = L.drawn.filter((d) => insideLoops(d.loops, u, v));
    if (!hit.length) return false;
    const area = (d) => d.loops.reduce((s, Lp) => { let a = 0; for (let i = 0, j = Lp.length - 1; i < Lp.length; j = i++) a += (Lp[j][0] + Lp[i][0]) * (Lp[j][1] - Lp[i][1]); return s + Math.abs(a / 2); }, 0);
    hit.sort((a, b) => area(a) - area(b));
    pick(hit[0].r);
    return true;
  }

  function clear() { if (L.cur) { L.cur = null; draw(); card(null); return true; } return false; }

  function setOn(on) {
    L.on = on;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    const t = $("#lv-toggle");
    if (t) t.classList.toggle("active", on);
    if (!on) card(null);
    draw();
  }

  async function init() {
    L.rep = await loadReport();
    const t = $("#lv-toggle");
    if (!t) return;
    t.hidden = !L.rep;
    t.classList.toggle("active", L.on && !!L.rep);
    t.addEventListener("click", () => setOn(!L.on));
    // from the 3D table: ?lv=<room uid> - turned on, and that room shown;
    // ?lv=on - turned on (Show on sheets)
    const q = new URLSearchParams(location.search), want = q.get("lv");
    if (want) {
      // used once: a reload keeps the colours as the person last set them
      q.delete("lv");
      try { history.replaceState(history.state, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); } catch (e) {}
    }
    if (want && L.rep) {
      L.on = true;
      try { localStorage.setItem(KEY, "1"); } catch (e) {}
      t.classList.add("active");
      if (L.mode === "off") L.mode = "fill";
      if (want === "on") { draw(); return; }
      const r = L.rep._byUid.get(want);
      const go = () => {
        draw();
        const d = L.drawn.find((x) => x.r === r);
        if (!d) return false;
        pick(r);
        const us = d.loops.flat().map((p) => p[0]), vs = d.loops.flat().map((p) => p[1]);
        if (ctx.zoomToPaper) ctx.zoomToPaper([Math.min(...us) - 20, Math.min(...vs) - 20, Math.max(...us) - Math.min(...us) + 40, Math.max(...vs) - Math.min(...vs) + 40]);
        return true;
      };
      let k = 0;
      const tick = () => { if (go() || ++k > 40) return; setTimeout(tick, 250); };
      tick();
    } else draw();
  }

  function sheetOpened() { L.cur = null; card(null); }

  return { init, draw, clickAt, clear, sheetOpened, get state() { return L; } };
}

/* ---------------------------------------------------------------- report */

/* the diagrams PDF (made in Revit, or on the server): fetched with the
   sign-in, opened in a new tab */
export async function openPdf() {
  const win = window.open("", "_blank");
  try {
    const res = await fetch("/api/lv/pdf", { headers: headers() });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else location.href = url;
  } catch (e) {
    if (win) win.close();
    alert("The diagrams PDF: " + e.message);
  }
}

/* The full report as a page: the schedule of every room (by floor and
   flat, coloured by result), then each room's windows. Print / Save as PDF,
   or keep it in Folders. */
export function reportHtml(rep) {
  const c = counts(rep);
  const rooms = (rep.rooms || []).slice().sort((a, b) => String(a.level).localeCompare(String(b.level))
    || String(a.block).localeCompare(String(b.block)) || String(a.flat).localeCompare(String(b.flat)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  const row = (r) => `<tr><td>${esc(r.level || "")}</td><td>${esc(r.block || "")}</td><td>${esc(r.flat || "")}</td><td>${esc(r.number || "")}</td>`
    + `<td>${esc(r.name || "")}${(r.with || []).length ? " + " + esc(r.with.map((w) => w.name).join(" + ")) : ""}</td><td class="n">${f3(r.area_m2)}</td>`
    + `<td class="n">${merged(r) ? "" : f3(r.req_light)}</td><td class="n">${merged(r) ? "" : f3(r.prov_light_meas)}</td><td class="n">${merged(r) ? "" : f3(r.prov_light_bd)}</td>`
    + `<td class="n">${merged(r) ? "" : f3(r.req_open)}</td><td class="n">${merged(r) ? "" : f3(r.prov_open_meas)}</td><td class="n">${merged(r) ? "" : f3(r.prov_open_bd)}</td>`
    + `<td style="color:${colour(r)};font-weight:600">${esc(r.status)}</td></tr>`;
  const detail = (r) => !(r.windows || []).length && !(r.notes || []).length ? "" : `<div class="room"><h3><i style="background:${colour(r)}"></i>`
    + `${esc([r.level, r.flat, r.number, r.name].filter(Boolean).join(" · "))} <span style="color:${colour(r)}">${esc(r.status)}</span></h3>`
    + ((r.windows || []).length ? `<table><tr><th>Mark</th><th>Type</th><th>W × H mm</th><th>Opens</th><th>Glass m²</th><th>Openable m²</th><th>W×H×70%</th><th>Share</th><th>Model</th></tr>`
      + r.windows.map((w) => `<tr><td>${esc(w.mark || "")}</td><td>${esc(w.key || "")}</td><td>${w.w_mm ? Math.round(w.w_mm) + " × " + Math.round(w.h_mm || 0) : ""}</td>`
        + `<td>${esc(w.operation || "")}${w.confirmed === false ? " (to confirm)" : ""}</td><td class="n">${f3(w.light_meas)}</td><td class="n">${f3(w.open_meas)}</td>`
        + `<td class="n">${f3(w.light_bd)}</td><td class="n">${w.share != null && w.share < 0.999 ? Math.round(w.share * 100) + "%" : ""}</td><td>${esc(w.source || "")}</td></tr>`).join("") + `</table>` : "")
    + ((r.notes || []).length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "") + `</div>`;
  const when = String(rep.at || "").replace("T", " ").slice(0, 16);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Light and Ventilation - ${esc(rep.model || "")}</title><style>
body{font:11px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#222;margin:18px}h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px}
h3{font-size:12px;margin:12px 0 4px}h3 i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #ccc;padding:2px 4px;text-align:left;vertical-align:top}
th{background:#f3f3f3}td.n{text-align:right;font-variant-numeric:tabular-nums}.k span{margin-right:16px}.k b{font-size:15px}
.bar{position:sticky;top:0;background:#fff;padding:6px 0;border-bottom:1px solid #ddd;margin-bottom:8px}.bar button{margin-right:6px}
.room{break-inside:avoid}@media print{.bar{display:none}body{margin:8mm}}</style></head><body>
<div class="bar"><button onclick="print()">Print / Save as PDF</button><button id="keep">Save to Folders</button><span id="kept"></span></div>
<h1>Light and ventilation</h1><div>${esc(rep.model || "")} · checked ${esc(when)}${rep.by ? " by " + esc(rep.by) : ""}${rep.levels && rep.levels.length ? " · floors: " + esc(rep.levels.join(", ")) : ""}</div>
<p class="k"><span><b>${c.OK}</b> OK</span><span><b>${c["NOT OK"]}</b> not OK</span><span><b>${c["NEEDS DATA"]}</b> need data</span><span><b>${c["NO WINDOW"]}</b> no window</span><span><b>${c.merged}</b> counted with another room</span></p>
<p>Required: lighting = room area x 1/10, openable = room area x 1/16. Provided: the glass measured in the model; W×H×70% beside it for reference.</p>
<h2>Schedule</h2><table><tr><th>Floor</th><th>Tower</th><th>Flat</th><th>Room</th><th>Name</th><th>Area m²</th><th>Req. lighting</th><th>Prov. lighting</th><th>W×H×70%</th>
<th>Req. openable</th><th>Prov. openable</th><th>W×H×70%</th><th>Result</th></tr>${rooms.map(row).join("")}</table>
<h2>Rooms and their windows</h2>${rooms.map(detail).join("")}</body></html>`;
}

/* win: a window opened beforehand (a pop-up opened after waiting for the
   network is blocked) */
export function openReport(rep, win) {
  if (!rep) { if (win) win.close(); return; }
  const html = reportHtml(rep);
  win = win || window.open("", "_blank");
  if (!win) { alert("Allow pop-ups for this site to open the report."); return; }
  win.document.open(); win.document.write(html); win.document.close();
  const btn = win.document.getElementById("keep");
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    const out = win.document.getElementById("kept");
    try {
      const { saveToFolders } = await import("./tofolders.js");
      const r = await saveToFolders(html, "Light_and_ventilation_" + String(rep.at || "").slice(0, 10) + ".html", "Light & Ventilation", { pdf: true });
      out.textContent = " Kept in Folders: " + ((r && (r.path || r.name)) || "done");
    } catch (e) { out.textContent = " Not kept: " + e.message; btn.disabled = false; }
  };
}

/* ----------------------------------------------------------------- table */

const ORDER = { "NOT OK": 0, "NO WINDOW": 1, "NEEDS DATA": 2, OK: 3 };

export function csvOf(rep) {
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ["Tower", "Flat", "Level", "Room", "Name", "Area m2", "Req. lighting", "Prov. lighting (measured)", "Prov. lighting (WxHx70%)",
    "Req. openable", "Prov. openable (measured)", "Prov. openable (WxHx70%)", "Status", "Notes"];
  const rows = (rep.rooms || []).map((r) => [r.block, r.flat, r.level, r.number, r.name, r.area_m2, r.req_light, r.prov_light_meas, r.prov_light_bd,
    r.req_open, r.prov_open_meas, r.prov_open_bd, r.status, (r.notes || []).join("; ")]);
  return "﻿" + [head].concat(rows).map((a) => a.map(q).join(",")).join("\r\n");
}

/* The table, with floor / flat / status filters. opts.onRow(room) on a row click. */
export function renderTable(box, rep, opts) {
  opts = opts || {};
  if (!rep) {
    box.innerHTML = `<p class="muted" style="font-size:12px">No Light &amp; Vent result yet. In Revit (the Calculation model): `
      + `<b>Light &amp; Vent</b>, then <b>Send the result to the viewer</b>.</p>`;
    return;
  }
  const F = box._lvF || (box._lvF = { level: "", tower: "", flat: "", status: "bad" });
  const rooms = rep.rooms || [];
  const levels = Array.from(new Set(rooms.map((r) => r.level).filter(Boolean))).sort();
  const towers = Array.from(new Set(rooms.map((r) => r.block).filter(Boolean))).sort();
  const flats = Array.from(new Set(rooms.filter((r) => !F.tower || r.block === F.tower).map((r) => r.flat).filter(Boolean))).sort();
  // the floor / tower / flat chosen (whatever the result): what "Show on sheets" shows
  const scope = rooms.filter((r) => (!F.level || r.level === F.level) && (!F.tower || r.block === F.tower) && (!F.flat || r.flat === F.flat));
  const best = opts.manifest ? bestSheet(opts.manifest, scope) : null;
  const c = counts(rep);
  const opt = (v, cur, lab) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(lab || v)}</option>`;
  const list = scope.filter((r) => F.status === "" || (F.status === "bad" ? result(r) !== "OK" : result(r) === F.status))
    .sort((a, b) => (ORDER[result(a)] ?? 9) - (ORDER[result(b)] ?? 9) || String(a.level).localeCompare(String(b.level))
      || String(a.block).localeCompare(String(b.block)) || String(a.flat).localeCompare(String(b.flat))
      || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  box.innerHTML = (opts.manifest ? `<div class="lv-go">${best
      ? `<button class="primary" data-go="sheet" title="Open sheet ${esc(best.sheet.number)}: ${best.n} of these rooms coloured on its plan">Show on sheets &#9656; <small>${esc(best.sheet.number)} · ${best.n} room(s)</small></button>`
      : `<button class="primary" disabled>Show on sheets &#9656;</button><div class="lv-why">${esc(scope.length ? whyNot(opts.manifest, scope[0]) : "No room matches.")}</div>`}</div>` : "")
    + `<div class="lv-k"><span style="color:${COL.OK}"><b>${c.OK}</b> OK</span><span style="color:${COL["NOT OK"]}"><b>${c["NOT OK"]}</b> not OK</span>`
    + `<span style="color:${COL["NEEDS DATA"]}"><b>${c["NEEDS DATA"]}</b> need data</span><span style="color:${COL["NO WINDOW"]}"><b>${c["NO WINDOW"]}</b> no window</span>`
    + `<span class="muted"><b>${c.merged}</b> counted with another</span></div>`
    + `<div class="muted" style="font-size:11px;margin:2px 0 6px">${esc(rep.model || "")} · ${esc(String(rep.at || "").replace("T", " ").slice(0, 16))}${rep.by ? " · " + esc(rep.by) : ""}</div>`
    + `<div class="lv-f"><select data-f="status">${opt("bad", F.status, "Not OK, need data, no window")}${opt("", F.status, "All rooms")}${opt("OK", F.status, "OK only")}</select>`
    + `<select data-f="level">${opt("", F.level, "All floors")}${levels.map((l) => opt(l, F.level)).join("")}</select>`
    + (towers.length ? `<select data-f="tower">${opt("", F.tower, "All towers")}${towers.map((l) => opt(l, F.tower)).join("")}</select>` : "")
    + `<select data-f="flat">${opt("", F.flat, "All flats")}${flats.map((l) => opt(l, F.flat)).join("")}</select></div>`
    + `<div class="lv-dl"><a href="#" data-dl="report">Full report</a> · <a href="#" data-dl="csv">Table (CSV)</a>`
    + `${rep.pdf ? ` · <a href="#" data-dl="pdf">Diagrams (PDF)</a>` : rep.pdf_state === "making" ? ` · <span class="muted">diagrams PDF being made ...</span>`
      : rep.pdf_error ? ` · <span class="bad" title="${esc(rep.pdf_error)}">diagrams PDF not made</span>` : ""}</div>`
    + `<div class="table-wrap"><table class="lv-t"><thead><tr><th>Room</th><th>Tower</th><th>Flat</th><th>Floor</th><th>Light req / prov</th><th>Open req / prov</th><th>Result</th></tr></thead><tbody>`
    + list.map((r, i) => `<tr data-i="${i}"><td><span class="lv-dot" style="background:${colour(r)}"></span>${esc([r.number, r.name].filter(Boolean).join(" "))}</td>`
      + `<td>${esc(r.block || "")}</td><td>${esc(r.flat || "")}</td><td>${esc(r.level || "")}</td><td>${merged(r) ? "" : f3(r.req_light) + " / " + f3(r.prov_light_meas)}</td>`
      + `<td>${merged(r) ? "" : f3(r.req_open) + " / " + f3(r.prov_open_meas)}</td><td style="color:${colour(r)}">${esc(r.status)}</td></tr>`).join("")
    + `</tbody></table></div>` + (list.length ? "" : `<p class="muted" style="font-size:12px">No room matches.</p>`);
  for (const s of box.querySelectorAll("select[data-f]")) s.onchange = () => {
    F[s.dataset.f] = s.value;
    if (s.dataset.f === "tower") F.flat = "";
    renderTable(box, rep, opts);
  };
  const go = box.querySelector('[data-go="sheet"]');
  if (go) go.onclick = () => { location.href = link("index.html", { sheet: best.sheet.number, lv: "on" }); };
  box.querySelector('[data-dl="csv"]').onclick = (ev) => {
    ev.preventDefault();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvOf(rep)], { type: "text/csv" }));
    a.download = "light_and_ventilation.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  box.querySelector('[data-dl="report"]').onclick = (ev) => { ev.preventDefault(); openReport(rep); };
  const pd = box.querySelector('[data-dl="pdf"]');
  if (pd) pd.onclick = (ev) => { ev.preventDefault(); openPdf(); };
  for (const tr of box.querySelectorAll("tbody tr")) tr.onclick = () => opts.onRow && opts.onRow(list[+tr.dataset.i]);
}
