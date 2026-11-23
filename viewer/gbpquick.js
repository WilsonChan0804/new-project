/* GBP workbook > Quick check: the three checks an architect does first, with
 * a few inputs each and the answers as large figures and pictures:
 *   1  Site - plot ratio and site coverage (Cap. 123F First Schedule; reg 21
 *      for a composite building, with the non-domestic share on a slider)
 *   2  Occupancy and exits (FS Code Table B1 -> Table B2, B7.3)
 *   3  Staircase discharge (Table B3 / B4, B12.1)
 * The sums are gbpcore.js's (tested in tests/gbpcore.test.mjs); this file
 * draws them. The values are kept with the project's workbook (data.quick).
 */
import { esc, toast } from "./tasks-util.js";
import * as C from "./gbpcore.js";
import { FIRST_SCHEDULE, B1, SRC, STAIR_BANDS } from "./gbptables.js";

const f3 = (x) => (x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const f0 = (x) => (x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-GB"));
const f2 = (x) => (x == null || !isFinite(x) ? "—" : (Math.round(x * 1000) / 1000).toString());
const CLS = [["A", "Class A", "one street"], ["B", "Class B", "two streets, a corner"], ["C", "Class C", "three streets"]];

let Q = null, ctx = null, root = null;

export function quickData(d) {
  d.quick = d.quick || {};
  const q = d.quick;
  q.mode = q.mode || "single";
  q.cls = q.cls || "A";
  q.kind = q.kind || "domestic";
  q.hmode = q.hmode || "band";
  if (q.band == null) q.band = 0;
  if (q.nband == null) q.nband = 0;
  q.occ = Object.assign({ key: "1b-2", how: "area", area: null, persons: null, widths: [] }, q.occ || {});
  q.st = Object.assign({ rows: [], stairs: 2, width: 1050, sprinkler: true }, q.st || {});
  return q;
}

/* the building's height (m) from the way it was given */
function heightOf(q, part) {
  if (part === "non") return q.nhmode === "m" ? Number(q.nheight) || null : FIRST_SCHEDULE[q.nband] ? bandHeight(q.nband) : null;
  if (q.hmode === "m") return q.height === "" || q.height == null ? null : Number(q.height);
  if (q.hmode === "levels") {
    const lo = Number(q.street_low), hi = Number(q.street_high), roof = Number(q.roof);
    return isFinite(lo) && isFinite(hi) && isFinite(roof) && q.street_low !== "" && q.street_high !== "" && q.roof !== "" && q.roof != null ? roof - (lo + hi) / 2 : null;
  }
  return bandHeight(q.band);
}
// a height inside the band (its upper limit; just over 61 m for the last)
const bandHeight = (i) => { const b = FIRST_SCHEDULE[i]; return b ? (b.upto != null ? b.upto : b.over + 1) : null; };

function siteCalc(q) {
  const h = heightOf(q);
  const s = C.site({ area: q.area, cls: q.cls, kind: q.mode === "composite" ? "composite" : q.kind, height: h });
  let nonSc = null, comp = null;
  if (s.status === "ok" && q.mode === "composite") {
    const hn = heightOf(q, "non");
    const sn = hn != null ? C.site({ area: q.area, cls: q.cls, kind: "non-domestic", height: hn }) : null;
    nonSc = sn && sn.status === "ok" ? sn.non : null;
    comp = C.compositePr(s, q.npr);
  }
  return { h, s, nonSc, comp };
}

/* --------------------------------------------------------------- pictures */

/* the street, the site and the building, as in an isometric sketch: the
   street on the sides the class of site says, the building on the covered
   share of the site, as tall as its height (scaled) */
function sketch(q, R) {
  const s = R.s, sc = s.status === "ok" ? (q.mode === "composite" ? s.dom.sc : s.sc) : 60;
  const h = R.h == null ? 30 : Math.max(4, Math.min(120, R.h));
  const z0 = 30 + h * 1.6;                     // the drawn height of the building
  const W = 460, H = 330;
  // isometric: x along one side, y along the other
  const P = (x, y, z) => [230 + (x - y) * 0.87, 170 + (x + y) * 0.5 - z];
  const poly = (pts, cls) => `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" class="${cls}"/>`;
  const S = 100, st = 30;          // site half-size, street width
  const streets = { A: ["s"], B: ["s", "e"], C: ["s", "e", "w"] }[q.cls] || ["s"];
  let out = "";
  const sideRect = { s: [[-S, S], [S, S], [S, S + st], [-S, S + st]], e: [[S, -S], [S + st, -S], [S + st, S + (streets.includes("s") ? st : 0)], [S, S]],
    w: [[-S - st, -S], [-S, -S], [-S, S], [-S - st, S + (streets.includes("s") ? st : 0)]] };
  for (const k of streets) out += poly(sideRect[k].map(([x, y]) => P(x, y, 0)), "qk-street");
  out += poly([[-S, -S], [S, -S], [S, S], [-S, S]].map(([x, y]) => P(x, y, 0)), "qk-site");
  const b = S * Math.sqrt(Math.max(5, Math.min(100, sc)) / 100);
  const z = Math.min(150, z0);
  const top = [[-b, -b], [b, -b], [b, b], [-b, b]].map(([x, y]) => P(x, y, z));
  out += poly([P(b, -b, 0), P(b, b, 0), P(b, b, z), P(b, -b, z)], "qk-b-r");
  out += poly([P(-b, b, 0), P(b, b, 0), P(b, b, z), P(-b, b, z)], "qk-b-l");
  out += poly(top, "qk-b-t");
  const t = (x, y, txt, cls = "") => `<text x="${x}" y="${y}" class="qk-lab ${cls}">${esc(txt)}</text>`;
  const sp = P(0, S + st / 2, 0), hp = P(b, b, z / 2), ap = P(-S * 0.7, S * 0.2, 0);
  out += t(sp[0] - 40, sp[1] + 18, "Street" + (R.s.mean != null ? ` · mean ${f2(R.s.mean)} mPD` : ""));
  out += t(hp[0] + 10, hp[1], R.h != null ? `H ${f2(R.h)} m` : "Height ?", "qk-strong");
  out += t(ap[0] - 70, ap[1] + 44, q.area ? `Site ${f0(q.area)} m²` : "Site area ?");
  if (s.status === "ok") { const cp = P(-b, -b, z); out += t(cp[0] - 20, cp[1] - 10, `covers ≤ ${sc}%`, "qk-strong"); }
  return `<svg class="qk-sketch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Street, site and building">${out}</svg>`;
}
// a small plan for each class of site: the site and its streets
function clsIcon(k) {
  const st = { A: ["s"], B: ["s", "e"], C: ["s", "e", "w"] }[k];
  const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;
  return `<svg viewBox="0 0 48 40" class="qk-cls-ic">${r(10, 6, 28, 24, "qk-site")}${st.includes("s") ? r(4, 31, 40, 7, "qk-street") : ""}${st.includes("e") ? r(39, 2, 7, 36, "qk-street") : ""}${st.includes("w") ? r(2, 2, 7, 36, "qk-street") : ""}</svg>`;
}

/* --------------------------------------------------------------- the page */

const big = (label, value, unit, sub, cls = "") => `<div class="qk-big ${cls}"><small>${label}</small><b>${value}${unit ? `<span>${unit}</span>` : ""}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
const chip = (st, txt) => `<span class="gb-st gb-${st || "check"}">${esc(txt || { ok: "OK", fail: "Fails", check: "Check", na: "—" }[st] || "Check")}</span>`;
const srcBtn = (k) => (SRC[k] ? `<button type="button" class="gb-src" data-clause="${esc(SRC[k].doc + " " + SRC[k].ref)}" title="Find it in the library">§ ${esc(SRC[k].doc)} · ${esc(SRC[k].ref)}</button>` : "");
const dis = () => (ctx.can() ? "" : " disabled");
const num = (f, v, ph, extra = "") => `<input type="number" step="any" data-qf="${f}" value="${esc(v == null ? "" : v)}" placeholder="${esc(ph || "")}"${dis()} ${extra}>`;
const seg = (f, cur, opts) => `<div class="qk-seg">${opts.map(([v, t]) => `<button type="button" data-qs="${f}" data-v="${v}" class="${String(cur) === v ? "on" : ""}"${dis()}>${t}</button>`).join("")}</div>`;
const bandSel = (f, cur) => `<select data-qf="${f}"${dis()}>${FIRST_SCHEDULE.map((b, i) => `<option value="${i}"${+cur === i ? " selected" : ""}>${b.upto == null ? "> 61 m" : (b.over ? `> ${b.over} – ` : "≤ ") + b.upto + " m"}</option>`).join("")}</select>`;
const b1Opts = (cur) => B1.map((b) => `<option value="${esc(b.key)}"${b.key === cur ? " selected" : ""}>${esc(b.key)} · ${esc(b.use.length > 70 ? b.use.slice(0, 68) + "…" : b.use)}${b.factor ? ` — ${b.factor} m²/p` : " — by number"}</option>`).join("");

function step1(q) {
  const R = siteCalc(q), s = R.s, comp = q.mode === "composite";
  const hIn = q.hmode === "band" ? bandSel("band", q.band) : q.hmode === "m" ? num("height", q.height, "e.g. 32.5") :
    `<div class="qk-row3">${num("street_low", q.street_low, "low mPD")}${num("street_high", q.street_high, "high mPD")}${num("roof", q.roof, "roof mPD")}</div>`;
  let res = "";
  if (s.status !== "ok") res = `<p class="qk-need">${esc(s.why)}</p>`;
  else if (!comp) {
    res = `<div class="qk-bigs">${big("Max site coverage", s.sc, "%", q.area ? `covered area ${f3(s.sc_area)} m²` : "give the site area for m²")}${big("Max plot ratio", s.pr, "", q.area ? `max GFA ${f3(s.gfa)} m²` : "")}${big("Height band", esc(s.band.replace("Not exceeding", "≤").replace(/Over (\d+) m but not exceeding/, "> $1 –")), "", R.h != null ? `building ${f2(R.h)} m` : "", "qk-small")}</div>`;
  } else {
    const c = R.comp, nsc = R.nonSc || s.non;
    res = `<div class="qk-bigs">${big("Non-domestic part: site coverage", nsc.sc, "%", q.area ? `max covered ${f3(q.area * nsc.sc / 100)} m²` : "", "qk-non")}${big("Domestic part: site coverage", s.dom.sc, "%", q.area ? `max covered ${f3(s.dom.sc_area)} m²` : "", "qk-dom")}</div>
      <div class="qk-comp">
        <div class="qk-comp-in"><b>1 · Proposed non-domestic PR</b> <small class="muted">its maximum ${s.non.pr}</small>
          <div class="qk-sl"><input type="range" min="0" max="${s.non.pr}" step="0.01" value="${c.nonPr}" data-qf="npr"${dis()}>${num("npr", c.nonPr, "", 'class="qk-n"')}</div>
          <label class="qk-l">or a target non-domestic GFA (m²)${num("ngfa", q.area ? Math.round(c.nonGfa * 1000) / 1000 : "", "m²")}</label>
          <small class="muted">uses ${(c.share * 100).toFixed(1)}% of what the non-domestic part may have</small></div>
        <div class="qk-comp-out"><b>2 · Remaining domestic PR</b> <small class="muted">its maximum ${s.dom.pr}</small>
          <div class="qk-huge">${c.domPr.toFixed(3)}</div>
          ${q.area ? `<div class="qk-gfa">Max domestic GFA <b>${f3(c.domGfa)} m²</b></div>` : ""}
          <small class="muted">${((1 - c.share) * 100).toFixed(1)}% left for the domestic part</small></div>
      </div>
      <div class="qk-bar"><span class="qk-non" style="width:${(c.share * 100).toFixed(1)}%">${c.share > 0.08 ? "Non-dom" : ""}</span><span class="qk-dom" style="width:${((1 - c.share) * 100).toFixed(1)}%">${c.share < 0.92 ? "Domestic" : ""}</span></div>
      <p class="qk-formula">Domestic PR = ${s.dom.pr} × [ 1 − ( ${c.nonPr.toFixed(2)} / ${s.non.pr} ) ] = <b>${c.domPr.toFixed(3)}</b>${q.area ? ` · total GFA ${f3(c.nonGfa)} + ${f3(c.domGfa)} = <b>${f3(c.total)} m²</b>` : ""}</p>`;
  }
  return `<section class="qk-card" id="qk-site"><div class="qk-head"><i>1</i><h3>Site: plot ratio and site coverage</h3>${ctx.why("site")}<span class="spacer"></span><button type="button" class="ghost qk-copy" data-copy="1">Copy</button></div>
    <div class="qk-grid">
      <div class="qk-in">
        ${seg("mode", q.mode, [["single", "Single use"], ["composite", "Composite use"]])}
        <div class="qk-lbl">Class of site</div>
        <div class="qk-cls">${CLS.map(([k, t, sub]) => `<button type="button" data-qs="cls" data-v="${k}" class="${q.cls === k ? "on" : ""}"${dis()}>${clsIcon(k)}<b>${t}</b><small>${sub}</small></button>`).join("")}</div>
        ${comp ? "" : `<div class="qk-lbl">Building</div>${seg("kind", q.kind, [["domestic", "Domestic"], ["non-domestic", "Non-domestic"]])}`}
        <div class="qk-lbl">${comp ? "Total height of the building" : "Height of the building"} ${seg("hmode", q.hmode, [["band", "Band"], ["m", "Metres"], ["levels", "From levels"]])}</div>
        ${hIn}
        ${comp ? `<div class="qk-lbl">Height of the non-domestic part ${seg("nhmode", q.nhmode || "band", [["band", "Band"], ["m", "Metres"]])}</div>${(q.nhmode || "band") === "band" ? bandSel("nband", q.nband) : num("nheight", q.nheight, "e.g. 15")}` : ""}
        <div class="qk-lbl">Site area (m²)</div>${num("area", q.area, "e.g. 1000")}
      </div>
      <div class="qk-pic">${sketch(q, R)}</div>
    </div>
    <div class="qk-res" id="qk-res1">${res}</div>
    <p class="gb-srcs">${srcBtn("first")}${comp ? ' <span class="muted">· reg 20(3): each part\'s site coverage by its own height; reg 21: the parts\' shares add to no more than 1</span>' : ""}</p></section>`;
}

function step2(q) {
  const o = q.occ, t = C.b1(o.key);
  const persons = o.how === "persons" ? (o.persons == null || o.persons === "" ? null : Math.max(0, Math.round(Number(o.persons))))
    : t && t.factor && o.area ? C.ceilPersons(Number(o.area) / t.factor) : null;
  let res = "";
  if (persons == null) res = `<p class="qk-need">${t && !t.factor && o.how !== "persons" ? `${esc(t.by || "By number")}: type the number of persons.` : "Give the usable floor area (or the number of persons)."}</p>`;
  else {
    const e = C.exitsFor(persons);
    if (e.none || e.beyond) res = `<div class="qk-bigs">${big("Occupant capacity", f0(persons), "persons", o.how === "area" ? `${f0(o.area)} ÷ ${t.factor} m²/p` : "")}</div><p class="qk-need">${esc(e.why)}</p>`;
    else {
      const ws = (o.widths || []).map(Number).filter((x) => x > 0);
      const chk = ws.length ? C.checkExits(persons, { widths: ws }) : null;
      res = `<div class="qk-bigs qk-b2">${big("Occupant capacity", f0(persons), "persons", o.how === "area" ? `${f0(o.area)} ÷ ${t.factor} m²/p, rounded up` : "typed", "qk-hi")}
        ${big("Min. exits", e.n, "", "Table B2")}
        ${big("Exit routes, total", f0(e.routes || e.route), "mm", `each at least ${f0(e.route)} mm`)}
        ${big("Exit doors, total", f0(e.doors || e.door), "mm", `each at least ${f0(e.door)} mm`)}</div>
        <div class="qk-check"><div class="qk-lbl">Check your design: the width of each exit door (mm)</div>
          <div class="qk-ws">${ws.map((w, i) => `<span class="qk-w">#${i + 1} <input type="number" data-qw="${i}" value="${w}"${dis()}> mm <button type="button" class="gb-x" data-qwx="${i}"${dis()}>✕</button></span>`).join("")}
            <button type="button" class="qk-add" data-qwadd${dis()}>+ Exit</button></div>
          ${chk ? `<div class="qk-ticks">${chk.items.map((x) => `<span class="qk-tick ${x.status}">${x.status === "ok" ? "✓" : x.status === "fail" ? "✗" : "?"} ${esc(x.what.replace("exit doors", "doors").replace(" (mm)", ""))}: ${f0(x.have)} / ${f0(x.need)}</span>`).join("")}</div>
            <div class="qk-banner ${chk.status}">${chk.status === "ok" ? "✓ Passes Table B2: number and widths of the exits" : chk.status === "fail" ? "✗ Does not pass Table B2 - see the red ones" : "Check the widths"}</div>
            ${chk.items.some((x) => x.note) ? `<small class="muted">Wider doors count as 1.5 × the narrowest (B7.3).</small>` : ""}` : `<small class="muted">Add the exits to check them against Table B2.</small>`}
        </div>`;
    }
  }
  return `<section class="qk-card" id="qk-moe"><div class="qk-head"><i>2</i><h3>Occupancy and exits</h3>${ctx.why("moe")}<span class="spacer"></span><button type="button" class="ghost qk-copy" data-copy="2">Copy</button></div>
    <div class="qk-in qk-in-row">
      <label class="qk-l qk-wide">Use (FS Code Table B1)<select data-qo="key"${dis()}>${b1Opts(o.key)}</select></label>
      <div><div class="qk-lbl">Count by</div>${seg("occ.how", o.how, [["area", "Floor area"], ["persons", "Persons"]])}</div>
      ${o.how === "persons" ? `<label class="qk-l">Persons<input type="number" data-qo="persons" value="${esc(o.persons == null ? "" : o.persons)}"${dis()}></label>`
        : `<label class="qk-l">Usable floor area (m²)<input type="number" step="any" data-qo="area" value="${esc(o.area == null ? "" : o.area)}" placeholder="e.g. 450"${dis()}></label>`}
    </div>
    <div class="qk-res">${res}</div>
    <p class="gb-srcs">${srcBtn("b1")} ${srcBtn("b2")} ${srcBtn("b7")} <button type="button" class="gb-src" data-clause="FS Code 2011 Clause B11 travel distance" title="Travel distance is not in the quick check yet - find the clause">§ Travel distance: Clause B11 ›</button></p></section>`;
}

function stairsPic(r) {
  if (!r.rows.length) return "";
  const n = Math.min(r.storeys, 30), H = 18 * n + 30, W = 300;
  let o = "";
  let y = 10, k = 0;
  for (const row of r.rows) for (let i = 0; i < row.floors && k < n; i++, k++) {
    o += `<rect x="70" y="${H - 20 - (k + 1) * 18}" width="160" height="16" rx="2" class="qk-fl"/><text x="150" y="${H - 20 - (k + 1) * 18 + 12}" class="qk-flt">${row.each == null ? "?" : row.each}</text>`;
  }
  void y;
  const good = r.status === "ok" ? "ok" : r.status === "fail" ? "fail" : "check";
  for (let s = 0; s < Math.min(r.stairs, 4); s++) o += `<rect x="${236 + s * 14}" y="${H - 20 - n * 18}" width="10" height="${n * 18}" rx="2" class="qk-stair ${good}"/>`;
  o += `<rect x="40" y="${H - 20}" width="250" height="4" class="qk-ground"/><text x="40" y="${H - 6}" class="qk-flt">G/F · ${r.storeys} storeys above${r.storeys > n ? " (first 30 drawn)" : ""}</text>`;
  return `<svg class="qk-stairs" viewBox="0 0 ${W} ${H}">${o}</svg>`;
}

function step3(q) {
  const st = q.st;
  const r = C.quickStairs(st.rows, { stairs: st.stairs, width: st.width, sprinkler: st.sprinkler });
  const rows = r.rows.map((x, i) => `<tr>
      <td><input data-qr="${i}" data-f="label" value="${esc(x.label || "")}" placeholder="1/F – 10/F"${dis()}></td>
      <td><input type="number" data-qr="${i}" data-f="floors" value="${esc(x.floors)}" class="qk-n"${dis()}></td>
      <td><select data-qr="${i}" data-f="key"${dis()}>${b1Opts(x.key)}</select></td>
      <td><input type="number" step="any" data-qr="${i}" data-f="area" value="${esc(x.area == null ? "" : x.area)}" class="qk-n" placeholder="m²"${dis()}></td>
      <td><input type="number" data-qr="${i}" data-f="persons" value="${esc(x.persons == null ? "" : x.persons)}" class="qk-n" placeholder="${x.each == null ? "?" : x.each}" title="Persons per floor - worked out from the area, or type your own"${dis()}></td>
      <td class="n"><b>${x.sum == null ? "?" : f0(x.sum)}</b></td><td><button type="button" class="gb-x" data-qrx="${i}"${dis()}>✕</button></td></tr>`).join("");
  return `<section class="qk-card" id="qk-stairs"><div class="qk-head"><i>3</i><h3>Staircase discharge</h3>${ctx.why("stairs")}<span class="spacer"></span><button type="button" class="ghost" data-qex${dis()}>Load an example</button><button type="button" class="ghost qk-copy" data-copy="3">Copy</button></div>
    <div class="qk-scroll"><table class="qk-t"><tr><th>Floors</th><th>No. of floors</th><th>Use (Table B1)</th><th>Area / floor</th><th>Persons / floor</th><th>Persons</th><th></th></tr>${rows}
      <tr class="tot"><td colspan="5">Above the ground storey: ${r.storeys} storeys</td><td class="n"><b>${f0(r.total)}</b></td><td></td></tr></table></div>
    <p><button type="button" class="qk-add" data-qradd${dis()}>+ Floors</button></p>
    <div class="qk-grid">
      <div class="qk-in">
        <label class="qk-chk"><input type="checkbox" data-qt="sprinkler"${st.sprinkler ? " checked" : ""}${dis()}> Sprinkler protected building (Table B4; else B3)</label>
        <div class="qk-row3"><label class="qk-l">Required staircases<input type="number" min="1" data-qt="stairs" value="${esc(st.stairs)}"${dis()}></label>
          <label class="qk-l">Clear width<select data-qt="width"${dis()}>${STAIR_BANDS.map((w) => `<option value="${w}"${+st.width === w ? " selected" : ""}>${w} mm${w === 1700 ? " +" : ""}</option>`).join("")}</select></label></div>
        ${r.total ? `<div class="qk-bigs">${big("Each staircase takes", f0(r.per), "persons", `${f0(r.total)} ÷ ${r.stairs}`)}${big("Its capacity", r.capacity == null ? "—" : f0(r.capacity), "", `Table ${r.table} · ${r.storeys} storeys · ${st.width} mm`, r.status === "ok" ? "qk-ok" : r.status === "fail" ? "qk-bad" : "")}</div>
          <div class="qk-banner ${r.status}">${r.status === "ok" ? `✓ ${r.stairs} staircases of ${st.width} mm take them (B12.1)` : r.status === "fail" ? `✗ Not enough: ${f0(r.per)} each against ${f0(r.capacity)}` : esc(r.note || "Check")}</div>
          ${r.status === "fail" && r.suggest ? `<p class="qk-tip">${r.stairs} staircases of <b>${r.suggest.width} mm</b> would take ${f0(r.suggest.capacity)} each - or add a staircase.</p>` : r.status === "fail" ? `<p class="qk-tip">Wider than 1700 mm is not enough either: add a staircase.</p>` : ""}` : `<p class="qk-need">Add the floors above the ground storey.</p>`}
      </div>
      <div class="qk-pic">${stairsPic(r)}</div>
    </div>
    <p class="gb-srcs">${srcBtn(st.sprinkler ? "b4" : "b3")} ${srcBtn("b12")}</p></section>`;
}

export function renderQuick(el, data, c) {
  root = el; ctx = c; Q = quickData(data);
  el.innerHTML = `<div class="qk">${step1(Q)}${step2(Q)}${step3(Q)}
    <p class="gb-disc">Worked from the code tables as transcribed (each result names its source). Check against the current documents before submission; the Building Authority's decision prevails.</p></div>`;
}

/* the text of a step, to paste into a report or a chat */
function copyText(n) {
  const L = [];
  if (n === 1) {
    const R = siteCalc(Q), s = R.s;
    L.push("Site: plot ratio and site coverage (Cap. 123F First Schedule)", `Class ${Q.cls} site, ${Q.area || "?"} m2, height ${R.h != null ? f2(R.h) + " m" : "?"} (${s.band || "?"})`);
    if (s.status === "ok" && Q.mode !== "composite") L.push(`Max site coverage ${s.sc}% (${f3(s.sc_area)} m2); max plot ratio ${s.pr} (GFA ${f3(s.gfa)} m2)`);
    if (s.status === "ok" && Q.mode === "composite" && R.comp) L.push(`Composite: non-domestic PR ${R.comp.nonPr} of ${R.comp.nonMax} -> domestic PR ${R.comp.domPr.toFixed(3)} (GFA ${f3(R.comp.domGfa)} m2); total GFA ${f3(R.comp.total)} m2`);
  } else if (n === 2) {
    const o = Q.occ, t = C.b1(o.key);
    const p = o.how === "persons" ? o.persons : t && t.factor && o.area ? C.ceilPersons(o.area / t.factor) : null;
    const e = p ? C.exitsFor(p) : null;
    L.push("Occupancy and exits (FS Code Table B1 / B2)", `${t ? t.use : o.key}: ${o.how === "persons" ? p + " persons" : `${o.area} m2 / ${t && t.factor} = ${p} persons`}`);
    if (e && !e.none && !e.beyond) L.push(`Min. ${e.n} exits; exit routes ${e.routes || e.route} mm total (each ${e.route}); exit doors ${e.doors || e.door} mm total (each ${e.door})`);
  } else {
    const r = C.quickStairs(Q.st.rows, Q.st);
    L.push("Staircase discharge (FS Code Table " + (Q.st.sprinkler ? "B4" : "B3") + ")", ...r.rows.map((x) => `${x.label || ""} ${x.floors} floor(s) x ${x.each} = ${x.sum}`),
      `${r.total} persons above G/F; ${r.stairs} staircases of ${Q.st.width} mm: ${r.per} each vs capacity ${r.capacity} - ${r.status === "ok" ? "OK" : "not enough"}`);
  }
  const text = L.join("\n");
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Copied"), () => toast(text));
}

/* the page's events (once): edits go into Q and repaint */
export function wireQuick(el, onChange) {
  const repaint = () => { onChange(); };
  const setQ = (f, v) => {
    const q = Q;
    if (f === "npr") q.npr = v;
    else if (f === "ngfa") { const R = siteCalc(q); if (q.area && R.s.status === "ok") q.npr = Math.min(R.s.non.pr, (Number(v) || 0) / q.area); }
    else q[f] = v;
  };
  el.addEventListener("click", (ev) => {
    if (!Q || !ev.target.closest(".qk")) return;
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.qs) { const f = b.dataset.qs; if (f === "occ.how") Q.occ.how = b.dataset.v; else Q[f] = b.dataset.v; return repaint(); }
    if (b.dataset.copy) return copyText(+b.dataset.copy);
    if (b.hasAttribute("data-qwadd")) { Q.occ.widths.push(1050); return repaint(); }
    if (b.dataset.qwx != null) { Q.occ.widths.splice(+b.dataset.qwx, 1); return repaint(); }
    if (b.hasAttribute("data-qradd")) { Q.st.rows.push({ label: "", floors: 1, key: "4a-1", area: null, persons: null }); return repaint(); }
    if (b.dataset.qrx != null) { Q.st.rows.splice(+b.dataset.qrx, 1); return repaint(); }
    if (b.hasAttribute("data-qex")) {
      Q.st.rows = [{ label: "1/F – 10/F", floors: 10, key: "7", area: 1350, persons: null }];
      Q.st.stairs = 2; Q.st.width = 1050; Q.st.sprinkler = true;
      return repaint();
    }
  });
  el.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!Q || t.type !== "range" || t.dataset.qf !== "npr") return;
    Q.npr = Number(t.value);
    // live: only the results under step 1, so the slider keeps working
    const box = document.getElementById("qk-res1");
    const tmp = document.createElement("div");
    tmp.innerHTML = step1(Q);
    const fresh = tmp.querySelector("#qk-res1");
    if (box && fresh) {
      const nb = box.querySelector('input[type="number"][data-qf="npr"]');
      [...box.querySelectorAll(".qk-huge, .qk-gfa, .qk-comp-out small, .qk-comp-in > small")].forEach((x, i) => { const y = fresh.querySelectorAll(".qk-huge, .qk-gfa, .qk-comp-out small, .qk-comp-in > small")[i]; if (y) x.outerHTML = y.outerHTML; });
      const bar = box.parentElement.querySelector(".qk-bar"), fb = fresh.querySelector(".qk-bar");
      if (bar && fb) bar.outerHTML = fb.outerHTML;
      const fm = box.querySelector(".qk-formula"), ff = fresh.querySelector(".qk-formula");
      if (fm && ff) fm.outerHTML = ff.outerHTML;
      if (nb) nb.value = Q.npr;
    }
  });
  el.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!Q || !t.closest(".qk")) return;
    const v = t.type === "checkbox" ? t.checked : t.type === "number" || t.type === "range" ? (t.value === "" ? null : Number(t.value)) : t.value;
    if (t.dataset.qf) { setQ(t.dataset.qf, t.dataset.qf === "band" || t.dataset.qf === "nband" ? Number(v) : v); return repaint(); }
    if (t.dataset.qo) { Q.occ[t.dataset.qo] = v; return repaint(); }
    if (t.dataset.qw != null) { Q.occ.widths[+t.dataset.qw] = v; return repaint(); }
    if (t.dataset.qr != null) { const r = Q.st.rows[+t.dataset.qr]; r[t.dataset.f] = t.dataset.f === "key" || t.dataset.f === "label" ? v : v; return repaint(); }
    if (t.dataset.qt) { Q.st[t.dataset.qt] = t.dataset.qt === "width" ? Number(v) : v; return repaint(); }
  });
}

/* scroll to a step (from a guide's gbp: link) */
export function showStep(part) {
  const id = { site: "qk-site", moe: "qk-moe", stairs: "qk-stairs" }[part];
  const el = id && document.getElementById(id);
  if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  return !!el;
}
export const _testQuick = { siteCalc, heightOf };
