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
import { FIRST_SCHEDULE, B1, SRC, STAIR_BANDS, APP151, CAP_PCT } from "./gbptables.js";
/* travel distance: FS Code B11.2 / B11.3 (gbptables.js TRAVEL) */

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
  q.gfa = Object.assign({ total: null, use_permitted: true, items: {}, all: false }, q.gfa || {});
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
  // each street a strip along its side of the site; where two meet, the corner
  const sideRect = { s: [[-S, S], [S, S], [S, S + st], [-S, S + st]], e: [[S, -S], [S + st, -S], [S + st, S], [S, S]],
    w: [[-S - st, -S], [-S, -S], [-S, S], [-S - st, S]] };
  const corners = [];
  if (streets.includes("s") && streets.includes("e")) corners.push([[S, S], [S + st, S], [S + st, S + st], [S, S + st]]);
  if (streets.includes("s") && streets.includes("w")) corners.push([[-S - st, S], [-S, S], [-S, S + st], [-S - st, S + st]]);
  for (const k of streets) out += poly(sideRect[k].map(([x, y]) => P(x, y, 0)), "qk-street");
  for (const c of corners) out += poly(c.map(([x, y]) => P(x, y, 0)), "qk-street qk-corner");
  out += poly([[-S, -S], [S, -S], [S, S], [-S, S]].map(([x, y]) => P(x, y, 0)), "qk-site");
  // the footprint at most 88% of the site's side, so the site always shows round it
  const b = S * Math.min(0.88, Math.sqrt(Math.max(5, Math.min(100, sc)) / 100));
  if (sc >= 77) out += `<polygon points="${[[-S, -S], [S, -S], [S, S], [-S, S]].map(([x, y]) => P(x, y, 0).join(",")).join(" ")}" class="qk-edge"/>`;
  const z = Math.min(150, z0);
  const top = [[-b, -b], [b, -b], [b, b], [-b, b]].map(([x, y]) => P(x, y, z));
  out += poly([P(b, -b, 0), P(b, b, 0), P(b, b, z), P(b, -b, z)], "qk-b-r");
  out += poly([P(-b, b, 0), P(b, b, 0), P(b, b, z), P(-b, b, z)], "qk-b-l");
  out += poly(top, "qk-b-t");
  // the labels sit outside the shapes; the drawing is framed to all of it, so nothing is cut
  const box = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
  const grow = (x, y) => { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); };
  for (const m of out.matchAll(/points="([^"]+)"/g)) for (const pt of m[1].split(" ")) { const [x, y] = pt.split(",").map(Number); grow(x, y); }
  const t = (x, y, txt, anchor = "middle", cls = "") => {
    const w = txt.length * 6.6, x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    grow(x0, y - 12); grow(x0 + w, y + 4);
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="qk-lab ${cls}">${esc(txt)}</text>`;
  };
  const tp = P(-b, -b, z), right = P(b, -b, z / 2), left = P(-S, S, 0);
  const sts = streets.map((k2) => sideRect[k2].map(([x, y]) => P(x, y, 0)));
  const low = sts.flat().reduce((a, p2) => (p2[1] > a[1] ? p2 : a), [0, -1e9]);
  let lab = "";
  const siteTxt = q.area ? `Site ${f0(q.area)} m²` : "Site area ?";
  lab += t(tp[0], tp[1] - 12, s.status === "ok" ? `${siteTxt} · covers ≤ ${sc}%` : siteTxt, "middle", "qk-strong");
  lab += t(right[0] + 10, right[1] + 4, R.h != null ? `H ${f2(R.h)} m` : "Height ?", "start", "qk-strong");
  void left;
  // each street named on its strip's outer side
  const mid = { s: [0, S + st], e: [S + st, 0], w: [-S - st, S * 0.55] };
  streets.forEach((k2, i) => {
    const [mx, my] = mid[k2], pt = P(mx, my, 0);
    const name = streets.length > 1 ? `Street ${i + 1}` : "Street";
    const off = k2 === "s" ? [0, 18, "middle"] : k2 === "e" ? [10, 16, "start"] : [-12, 8, "end"];
    lab += t(pt[0] + off[0], pt[1] + off[1], name + (i === 0 && R.s.mean != null ? ` · mean ${f2(R.s.mean)} mPD` : ""), off[2]);
  });
  void low;
  if (corners.length) { const c = P(S + st / 2, S + st / 2, 0); if (streets.includes("e")) lab += t(c[0] + 12, c[1] + 22, "corner", "start", "qk-corner-t"); }
  out += lab;
  const pad = 8, vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad].map((v) => Math.round(v));
  return `<svg class="qk-sketch" viewBox="${vb.join(" ")}" role="img" aria-label="Street, site and building">${out}</svg>`;
}
// a small plan for each class of site: the site and its streets
function clsIcon(k) {
  const st = { A: ["s"], B: ["s", "e"], C: ["s", "e", "w"] }[k];
  const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;
  // the site in the middle; streets on its sides, and the corner squares where two meet
  return `<svg viewBox="0 0 48 40" class="qk-cls-ic">${r(10, 4, 28, 26, "qk-site")}${st.includes("s") ? r(10, 31, 28, 7, "qk-street") : ""}${st.includes("e") ? r(39, 4, 7, 26, "qk-street") : ""}${st.includes("w") ? r(2, 4, 7, 26, "qk-street") : ""}`
    + `${st.includes("s") && st.includes("e") ? r(39, 31, 7, 7, "qk-street qk-corner") : ""}${st.includes("s") && st.includes("w") ? r(2, 31, 7, 7, "qk-street qk-corner") : ""}</svg>`;
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
  return `<section class="qk-card" id="qk-site"><div class="qk-head"><i>1</i><h3>Site: plot ratio and site coverage</h3>${ctx.why("site")}<span class="spacer"></span>${clearBtn(1)}<button type="button" class="ghost qk-copy" data-copy="1">Copy</button></div>
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
    const b5 = t && t.cls === "5a" && o.high;
    const e = b5 ? C.exitsFor5a(persons) : C.exitsFor(persons);
    if (b5 && e.b5) res = `<div class="qk-bigs qk-b2">${big("Occupant capacity", f0(persons), "persons", o.how === "area" ? `${f0(o.area)} ÷ ${t.factor} m²/p, rounded up` : "typed", "qk-hi")}
        ${big("Min. exits", e.n, "", "Table B5")}${big("Exit routes, total", f0(e.routes), "mm", "Table B5 (5a at 12 m or more)")}</div>
        <p class="qk-need">Use Classification 5a at 12 m or more above G/F: Table B5 gives the exits and the total width of the exit routes (Clause B21.1).</p>`;
    else if (e.none || e.beyond) res = `<div class="qk-bigs">${big("Occupant capacity", f0(persons), "persons", o.how === "area" ? `${f0(o.area)} ÷ ${t.factor} m²/p` : "")}</div><p class="qk-need">${esc(e.why)}</p>`;
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
  return `<section class="qk-card" id="qk-moe"><div class="qk-head"><i>2</i><h3>Occupancy and exits</h3>${ctx.why("moe")}<span class="spacer"></span>${clearBtn(2)}<button type="button" class="ghost qk-copy" data-copy="2">Copy</button></div>
    <div class="qk-in qk-in-row">
      <label class="qk-l qk-wide">Use (FS Code Table B1)<select data-qo="key"${dis()}>${b1Opts(o.key)}</select></label>
      <div><div class="qk-lbl">Count by</div>${seg("occ.how", o.how, [["area", "Floor area"], ["persons", "Persons"]])}</div>
      <div><div class="qk-lbl">Balcony approach (B10.6)</div>${seg("occ.balcony", o.balcony ? "1" : "", [["", "No"], ["1", "Yes"]])}</div>
      ${t && t.cls === "5a" ? `<div><div class="qk-lbl">At 12 m or more above G/F</div>${seg("occ.high", o.high ? "1" : "", [["", "No"], ["1", "Yes (Table B5)"]])}</div>` : ""}
      ${o.how === "persons" ? `<label class="qk-l">Persons<input type="number" data-qo="persons" value="${esc(o.persons == null ? "" : o.persons)}"${dis()}></label>`
        : `<label class="qk-l">Usable floor area (m²)<input type="number" step="any" data-qo="area" value="${esc(o.area == null ? "" : o.area)}" placeholder="e.g. 450"${dis()}></label>`}
    </div>
    <div class="qk-res">${res}</div>
    ${travelHtml(o, t)}
    <p class="gb-srcs">${srcBtn("b1")} ${srcBtn(t && t.cls === "5a" && o.high ? "b5" : "b2")} ${srcBtn("b7")} ${srcBtn("b11")}</p></section>`;
}

/* travel distance: the limits for the use (B11.2 / B11.3), a plan of them,
   and the design's own distances checked */
function travelPic(r) {
  const flat = r.group === "1-2";
  const t = (x, y, s, a = "middle", c = "") => `<text x="${x}" y="${y}" text-anchor="${a}" class="qk-tl ${c}">${esc(s)}</text>`;
  let o = `<rect x="10" y="58" width="400" height="26" rx="3" class="qk-cor"/>`;              // the corridor
  o += `<rect x="350" y="40" width="56" height="62" rx="4" class="qk-stair-r"/>${t(378, 75, "Stair 1", "middle", "qk-tb")}`;
  o += `<rect x="350" y="118" width="56" height="44" rx="4" class="qk-stair-r"/>${t(378, 144, "Stair 2", "middle", "qk-tb")}`;
  o += `<rect x="20" y="0" width="120" height="56" rx="3" class="qk-flat"/>${t(80, 22, flat ? "Flat / guestroom" : "Room", "middle", "qk-tb")}`;
  o += `<rect x="128" y="50" width="16" height="8" class="qk-door"/>`;
  // dead end: from the door to the point of choice (here the corner by the staircases)
  o += `<path d="M136 71 H300" class="qk-dead"/>${t(218, 98, `dead end ≤ ${r.deadend} m`, "middle", "qk-tdead")}`;
  if (flat) o += `<path d="M40 40 L132 54" class="qk-in"/>${t(70, 48, `≤ ${r.within} m`, "middle", "qk-tin")}`;
  o += `<path d="M300 71 H350" class="qk-max"/><path d="M300 71 V140 H350" class="qk-max"/>${t(300, 120, `max ≤ ${r.max} m`, "end", "qk-tmax")}`;
  o += `<path d="M412 70 C440 70 440 140 412 140" class="qk-btw"/>${t(446, 110, `≤ ${r.between} m`, "start", "qk-tbtw")}`;
  return `<svg class="qk-travel" viewBox="0 -6 500 176" role="img" aria-label="Travel distance">${o}</svg>`;
}
function travelHtml(o, t) {
  if (!t) return "";
  const r = C.travelFor(t.cls, { balcony: !!o.balcony });
  const ck = C.checkTravel(r, { within: o.d_within, deadend: o.d_deadend, max: o.d_max, between: o.d_between });
  const inp = (k, lbl) => `<label class="qk-l">${lbl}<span class="qk-u"><input type="number" step="any" data-qo="d_${k}" value="${esc(o["d_" + k] == null ? "" : o["d_" + k])}" placeholder="m"${dis()}> m</span></label>`;
  return `<div class="qk-res qk-trav"><div class="qk-sub">Travel distance <small class="muted">${esc(r.label)}${o.balcony ? " · along a balcony approach" : ""}</small></div>
    <div class="qk-grid qk-grid-t"><div><div class="qk-bigs">
      ${r.within != null ? big("Within the flat / room", r.within, "m", `to its exit door · ${r.refs.within}`) : ""}
      ${big(r.group === "1-2" ? "Door to the staircase" : "Dead end", r.deadend, "m", `${r.group === "1-2" ? "dead end · " : ""}${r.refs.deadend}`)}
      ${big("Max travel distance", r.max, "m", `with 2 or more exits · ${r.refs.max}`)}
      ${big("Between staircases", r.between, "m", "B11.3(b), along the route")}</div></div>
      <div class="qk-pic">${travelPic(r)}</div></div>
    <div class="qk-check"><div class="qk-lbl">Check your design: the distances on your plan</div>
      <div class="qk-in-row qk-tin-row">${r.within != null ? inp("within", "Within the flat") : ""}${inp("deadend", r.group === "1-2" ? "Door to staircase" : "Dead end")}${inp("max", "Max travel")}${inp("between", "Between staircases")}</div>
      ${ck.items.some((x) => x.have != null) ? `<div class="qk-ticks">${ck.items.filter((x) => x.have != null).map((x) => `<span class="qk-tick ${x.status}">${x.status === "ok" ? "✓" : "✗"} ${esc(x.what)}: ${x.have} / ${x.limit} m</span>`).join("")}</div>
        <div class="qk-banner ${ck.status}">${ck.status === "ok" ? "✓ Within the travel distances of B11" : ck.status === "fail" ? "✗ Too far - see the red ones" : "Give the other distances to check them all"}</div>` : ""}
      <small class="muted">A point of choice counts only where the lines to the two exits make 30° or more (B11.6 / B11.7). Distances are measured as Part A of the Code defines them.</small>
    </div></div>`;
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
  return `<section class="qk-card" id="qk-stairs"><div class="qk-head"><i>3</i><h3>Staircase discharge</h3>${ctx.why("stairs")}<span class="spacer"></span><button type="button" class="ghost" data-qex${dis()}>Load an example</button>${clearBtn(3)}<button type="button" class="ghost qk-copy" data-copy="3">Copy</button></div>
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

/* step 4: GFA concessions - one area per feature, the 10% cap (APP-151) */
const COMMON = ["5", "12", "11", "2.3", "14", "15", "20", "22", "25", "26", "29", "19", "6", "7", "8", "16", "17", "30"];
function permittedGfa(q) {
  const R = siteCalc(q);
  if (R.s.status !== "ok" || !q.area) return null;
  return q.mode === "composite" && R.comp ? R.comp.total : R.s.gfa;
}
function step4(q) {
  const g = q.gfa, perm = permittedGfa(q);
  const total = g.use_permitted && perm != null ? perm : g.total;
  const r = C.quickCap(g.items, total);
  const used = new Set(Object.keys(g.items).filter((k) => Number(g.items[k]) > 0));
  const list = (g.all ? APP151 : APP151.filter((a) => COMMON.includes(a.item) || used.has(a.item)))
    .slice().sort((a, b) => (g.all ? 0 : COMMON.indexOf(a.item) - COMMON.indexOf(b.item)));
  const rows = list.map((a) => `<tr class="${used.has(a.item) ? "on" : ""}"><td class="qk-it">${esc(a.item)}</td><td>${esc(a.text)}<br><small class="muted">${esc(a.pn)} · ${esc(a.group)}</small></td>
      <td class="c">${a.pre ? '<span class="qk-badge pre" title="Subject to the APP-151 pre-requisites">pre-req</span>' : ""}</td><td class="c">${a.cap ? '<span class="qk-badge cap" title="Counted in the 10% overall cap">10% cap</span>' : '<span class="qk-badge" title="Not in the cap">outside</span>'}</td>
      <td><input type="number" step="any" data-qgi="${esc(a.item)}" value="${esc(g.items[a.item] == null ? "" : g.items[a.item])}" placeholder="m²" class="qk-n"${dis()}></td></tr>`).join("");
  const pct = Math.min(130, r.share * 100), tone = r.status === "fail" ? "fail" : r.share > 0.9 ? "warn" : "ok";
  return `<section class="qk-card" id="qk-gfa"><div class="qk-head"><i>4</i><h3>GFA concessions: the 10% cap</h3>${ctx.why("gfa")}<span class="spacer"></span>${clearBtn(4)}<button type="button" class="ghost qk-copy" data-copy="4">Copy</button></div>
    <div class="qk-in qk-in-row">
      <div><div class="qk-lbl">Total GFA</div>${seg("gfa.use_permitted", g.use_permitted ? "1" : "", [["1", "The permitted GFA (step 1)"], ["", "Type it"]])}</div>
      ${g.use_permitted ? `<div class="qk-l">&nbsp;<b class="qk-tot">${perm != null ? f3(perm) + " m²" : "— give step 1 first"}</b></div>`
        : `<label class="qk-l">Total GFA (m²)<input type="number" step="any" data-qg="total" value="${esc(g.total == null ? "" : g.total)}" placeholder="e.g. 16000"${dis()}></label>`}
    </div>
    <div class="qk-res">${r.total ? `<div class="qk-bigs">${big("Under the 10% cap", f3(r.capped), "m²", `${(r.share * 100).toFixed(1)}% of the cap`, r.status === "fail" ? "qk-bad" : "qk-ok")}${big("The cap", f3(r.cap), "m²", `${CAP_PCT}% of ${f3(r.total)} m²`)}${big("Outside the cap", f3(r.uncapped), "m²", "other exemptions entered")}</div>
      <div class="qk-capbar"><i class="${tone}" style="width:${(pct / 1.3).toFixed(1)}%"></i><b style="left:${(100 / 1.3).toFixed(1)}%" title="the 10% cap"></b></div>
      <div class="qk-banner ${r.status}">${r.status === "ok" ? `✓ Within the 10% overall cap (${f3(r.cap - r.capped)} m² left)` : `✗ Over the cap by ${f3(r.capped - r.cap)} m² - the excess counts as GFA`}</div>
      ${r.pre ? `<p class="qk-tip">${r.pre} of the items entered need the APP-151 pre-requisites (sustainable building design, BEAM Plus, energy).</p>` : ""}`
      : `<p class="qk-need">Give the total GFA (or the site in step 1).</p>`}</div>
    <div class="qk-scroll"><table class="qk-t qk-ct"><tr><th>Item</th><th>Feature (APP-151 Appendix A)</th><th>Pre-req</th><th>Cap</th><th>Area m²</th></tr>${rows}</table></div>
    <p><button type="button" class="ghost" data-qgall>${g.all ? "Show the common ones" : `Show all ${APP151.length} items`}</button></p>
    <p class="gb-srcs">${srcBtn("app151")} ${srcBtn("reg23")}</p></section>`;
}

const clearBtn = (n) => (ctx.can() ? `<button type="button" class="ghost qk-clear" data-qclear="${n}" title="Empty this step (for everyone on the project)">Clear</button>` : "");
const STEP1 = ["mode", "cls", "kind", "hmode", "band", "nband", "nhmode", "height", "nheight", "street_low", "street_high", "roof", "area", "npr"];
const STEP_NAME = { 1: "step 1 (Site)", 2: "step 2 (Occupancy and exits)", 3: "step 3 (Staircase discharge)", 4: "step 4 (GFA concessions)", all: "the whole workbook" };
let UNDO = null;
/* empty a step (or all) back to its defaults; the copy before is kept for Undo */
function clearStep(n) {
  UNDO = JSON.parse(JSON.stringify(Q));
  if (n === "all" || n === "1") for (const k of STEP1) delete Q[k];
  if (n === "all" || n === "2") delete Q.occ;
  if (n === "all" || n === "3") delete Q.st;
  if (n === "all" || n === "4") delete Q.gfa;
}
function undoBar(onUndo) {
  document.querySelectorAll(".qk-undo").forEach((x) => x.remove());
  const bar = document.createElement("div");
  bar.className = "qk-undo";
  bar.innerHTML = `<span>Cleared</span><button type="button">Undo</button>`;
  document.body.appendChild(bar);
  const t = setTimeout(() => bar.remove(), 10000);
  bar.querySelector("button").onclick = () => { clearTimeout(t); bar.remove(); onUndo(); };
}

export function renderQuick(el, data, c) {
  root = el; ctx = c; Q = quickData(data);
  el.innerHTML = `<div class="qk">
    <div class="qk-top"><span class="muted">&#128101; Saved with the project - everyone on it sees the same figures${c.can() ? " (members can change them)" : " (view only)"}.</span><span class="spacer"></span>${c.can() ? `<button type="button" class="ghost qk-clear" data-qclear="all">Clear all</button>` : ""}</div>
    ${step1(Q)}${step2(Q)}${step3(Q)}${step4(Q)}
    ${c.model ? `<p class="qk-model"><button type="button" class="ghost" data-gmode="full">&#128203; The site's figures from the model (GBP area plans) and Excel ›</button></p>` : ""}
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
    if (t) { const r = C.travelFor(t.cls, { balcony: !!o.balcony }); L.push(`Travel distance (B11${o.balcony ? ", balcony approach" : ""}): ${r.within != null ? `within the flat ${r.within} m; door to staircase ` : "dead end "}${r.deadend} m; max ${r.max} m; between staircases ${r.between} m`); }
  } else if (n === 4) {
    const g = Q.gfa, perm = permittedGfa(Q), r = C.quickCap(g.items, g.use_permitted && perm != null ? perm : g.total);
    L.push("GFA concessions: the 10% overall cap (PNAP APP-151)", ...r.rows.map((x) => `Item ${x.item} ${x.text}: ${x.area} m2${x.cap ? " (in the cap)" : ""}`),
      `Under the cap ${r.capped} m2 of ${r.cap} m2 (${r.pct}% of ${r.total} m2) - ${r.status === "ok" ? "OK" : "over"}; outside the cap ${r.uncapped} m2`);
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
    if (b.dataset.qs) { const f = b.dataset.qs; if (f === "occ.how") Q.occ.how = b.dataset.v; else if (f.startsWith("occ.")) Q.occ[f.slice(4)] = b.dataset.v === "1"; else if (f.startsWith("gfa.")) Q.gfa[f.slice(4)] = b.dataset.v === "1"; else Q[f] = b.dataset.v; return repaint(); }
    if (b.dataset.copy) return copyText(+b.dataset.copy);
    if (b.hasAttribute("data-qwadd")) { Q.occ.widths.push(1050); return repaint(); }
    if (b.dataset.qwx != null) { Q.occ.widths.splice(+b.dataset.qwx, 1); return repaint(); }
    if (b.hasAttribute("data-qradd")) { Q.st.rows.push({ label: "", floors: 1, key: "4a-1", area: null, persons: null }); return repaint(); }
    if (b.dataset.qrx != null) { Q.st.rows.splice(+b.dataset.qrx, 1); return repaint(); }
    if (b.dataset.qclear) {
      const n = b.dataset.qclear;
      if (!confirm(`Clear ${STEP_NAME[n]} for everyone on this project?`)) return;
      clearStep(n);
      Object.assign(Q, quickData({ quick: Q }));
      repaint();
      undoBar(() => { if (!UNDO) return; for (const k of Object.keys(Q)) delete Q[k]; Object.assign(Q, UNDO); UNDO = null; repaint(); });
      return;
    }
    if (b.hasAttribute("data-qgall")) { Q.gfa.all = !Q.gfa.all; return repaint(); }
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
    if (t.dataset.qg) { Q.gfa[t.dataset.qg] = v; return repaint(); }
    if (t.dataset.qgi) { if (v == null || v === 0) delete Q.gfa.items[t.dataset.qgi]; else Q.gfa.items[t.dataset.qgi] = v; return repaint(); }
    if (t.dataset.qt) { Q.st[t.dataset.qt] = t.dataset.qt === "width" ? Number(v) : v; return repaint(); }
  });
}

/* scroll to a step (from a guide's gbp: link) */
export function showStep(part) {
  const id = { site: "qk-site", moe: "qk-moe", stairs: "qk-stairs", gfa: "qk-gfa" }[part];
  const el = id && document.getElementById(id);
  if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  return !!el;
}
export const _testQuick = { siteCalc, heightOf };
/* the sketch for the project workbook's site: s = gbpcore site(...) */
export function siteSketch(s) {
  return sketch({ cls: s.cls || "A", mode: s.kind === "composite" ? "composite" : "single", area: s.area }, { s, h: s.height });
}
