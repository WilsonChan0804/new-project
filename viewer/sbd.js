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
import { layout as cadLayout, downloadCad } from "./sbddxf.js";

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
    const ps = r.parts || [];
    if (ps.length > 1) {
      // Fig B7: U = (A(a) + A(b)) / (L(a) + L(b))
      const nm = (q) => `${L}(${q.tag})`;
      rows.push([`U${L}`, `(Street Canyon Area ${ps.map(nm).join(" + ")}) / (Length ${ps.map(nm).join(" + ")}) (${r.street}) = (${ps.map((q) => f3(q.area_m2)).join(" + ")}) m² / (${ps.map((q) => f3(q.L_m)).join(" + ")}) m = ${f3(r.area_m2)} / ${f3(r.L_m)} = ${f3(r.U_m)} m`]);
      rows.push([`Lp${L}`, `${ps.map((q) => `Lp${nm(q)}`).join(" + ")} = ${ps.map((q) => f3(q.Lp_m)).join(" + ")}${Math.abs(ps.reduce((t, q) => t + q.Lp_m, 0) - r.Lp_m) > 0.001 ? ` + the facade between the group's buildings` : ""} = ${f3(r.Lp_m)} m`]);
    } else rows.push([`U${L}`, `Street Canyon Area ${L} / Length ${L} (${r.street}) = ${f3(r.area_m2)} m² / ${f3(r.L_m)} m = ${f3(r.U_m)} m`]);
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
// the buildings that do not abut a street, and the spacings between them
function canyonExtra(c) {
  return [...(c.spacing || []).map((sp) => [`${sp.a} - ${sp.b}`, `${f3(sp.d_m)} m apart: ${sp.grouped ? "under 15 m, one group for Lp" : "15 m or more, separate"}`]),
    ...(c.others || []).map((o) => [`${o.building}`, `Lp ${f3(o.Lp_m)} m - the shorter side of its smallest bounding rectangle (${f3(o.Lp_m)} x ${f3(o.long_m != null ? o.long_m : o.Lp_m)} m); ${f3(o.nearest_m)} m from the centreline of ${o.street} (over 30 m): not abutting a street`])];
}
// a round length for a scale bar about a quarter of w
function niceLen(w) {
  const c = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return c.reduce((b, x) => (Math.abs(x - w / 4) < Math.abs(b - w / 4) ? x : b), c[0]);
}

/* Labels that do not overlap: each is tried where it belongs, then moved
 * off it step by step (across its line, then along it) until it clears the
 * labels already placed and the blocked areas (the axes, the scale bar); a
 * label moved far gets a leader line back to its point. Drawing units,
 * y down. */
function makeLabels(fs, VW, VH) {
  const taken = [];
  const list = [];
  // text width: capitals and figures are wider than lower case
  const tw = (t, size) => [...String(t)].reduce((w, ch) => w + (/[A-Z0-9=²°℄]/.test(ch) ? 0.66 : /[ il.,:;|'()\-]/.test(ch) ? 0.32 : 0.55), 0) * size;
  const over = (a, b, m) => a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;
  // the label's box (axis-aligned) when drawn at x, y (anchor, rotation)
  const box = (o, x, y) => {
    const w = tw(o.t, o.size), h = o.size * 1.1;
    const lx0 = o.anchor === "end" ? -w : o.anchor === "start" ? 0 : -w / 2;
    const ly0 = o.mid ? -h / 2 : -o.size * 0.82;
    const r = (o.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    const pts = [[lx0, ly0], [lx0 + w, ly0], [lx0 + w, ly0 + h], [lx0, ly0 + h]].map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]);
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  };
  return {
    block(b) { taken.push(b); },
    /* o: {x, y, t, size, anchor, rot, mid, fill, cls, attrs, title, prio, fixed, along} */
    add(o) { list.push(Object.assign({ prio: 0, anchor: "middle" }, o)); },
    render() {
      let out = "";
      const order = list.map((o, i) => [o, i]).sort((a, b) => b[0].prio - a[0].prio || a[1] - b[1]);
      for (const [o] of order) {
        const w = tw(o.t, o.size), h = o.size * 1.15;
        const r = (o.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
        const steps = o.fixed ? [[0, 0]] : [[0, 0], [0, -1], [0, 1], [0, -2], [0, 2]]
          .concat(o.along === false ? [] : [[0.6, 0], [-0.6, 0], [1.1, 0], [-1.1, 0], [0.6, -1], [-0.6, -1], [0.6, 1], [-0.6, 1]])
          .concat([[0, -3], [0, 3], [0, -4], [0, 4], [1.6, 0], [-1.6, 0], [0, -5], [0, 5], [1.1, -2], [-1.1, -2], [1.1, 2], [-1.1, 2],
            [0, -6], [0, 6], [2.2, 0], [-2.2, 0], [0, -8], [0, 8]]);
        let pick = null, least = null;
        for (const [a, b] of steps) {
          const du = a * w, dv = b * h;
          const x = o.x + du * c - dv * sn, y = o.y + du * sn + dv * c;
          const bx = box(o, x, y);
          if (VW && (bx[0] < 0 || bx[1] < 0 || bx[2] > VW || bx[3] > VH)) continue;
          const n = taken.filter((t) => over(bx, t, o.size * 0.08)).length;
          if (!n) { pick = [x, y, bx, Math.hypot(du, dv)]; break; }
          if (!least || n < least[4]) least = [x, y, bx, Math.hypot(du, dv), n];
        }
        if (!pick) pick = least || [o.x, o.y, box(o, o.x, o.y), 0];
        const [x, y, bx, d] = pick;
        taken.push(bx);
        if (d > h * 2.5 && !o.noLeader) {
          const cx = Math.max(bx[0], Math.min(o.x, bx[2])), cy = Math.max(bx[1], Math.min(o.y, bx[3]));
          out += `<line class="sbd-leader" x1="${o.x.toFixed(2)}" y1="${o.y.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${o.fill || "#0f172a"}" stroke-width="${fs / 16}"/>`;
        }
        out += `<text${o.cls ? ` class="${o.cls}"` : ""} x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${o.size.toFixed(3)}" text-anchor="${o.anchor}"${o.mid ? ` dominant-baseline="middle"` : ""} fill="${o.fill || "#0f172a"}"`
          + `${o.rot != null ? ` transform="rotate(${o.rot.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})"` : ""}${o.attrs ? " " + o.attrs : ""}>${o.title ? `<title>${esc(o.title)}</title>` : ""}${esc(o.t)}</text>`;
      }
      return out;
    },
  };
}
const HALO = (fs) => `stroke="#fff" stroke-width="${(fs / 5).toFixed(3)}" paint-order="stroke"`;

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: Object.assign({ "Content-Type": "application/json" }, Store.authHeaders()) }, opts || {}));
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return d;
}

// the plan level a zone was assessed at
const levelOf = (z) => (z && z.plan_level != null ? `plan at +${f3(z.plan_level)}` : "plan: all levels (worst)");
// which side the plane is on: both side regions are measured from it
function nearText(ax) {
  const sd = Object.values((ax && ax.sides) || {});
  if (!ax || !ax.near || !sd.length) return "";
  const cl = sd.some((x) => x.to_cl);
  return ` · the plane on one side of the site (its near edge); both side regions measured from it${cl ? ", next to a street on to its centreline" : ""}`;
}
// Level 0, as the result says it
function levelText(r) {
  if (!r.level0) return r.ground_z != null ? `+${f3(r.ground_z)}${r.ground_source ? ` (${r.ground_source})` : ""}` : "-";
  const l = r.level0;
  return `+${f3(l.z)} - the mean level of ${l.street}` + (l.streets.length > 1 ? `, the lowest of the streets abutting the site (${l.streets.map((s) => `${s.name} +${f3(s.level)}`).join(", ")})` : "");
}

/* The plan of one zone as SVG (metres, north up as modelled). */
const PLANE_NAME = { axis1: "Projection Plane X", axis2: "Projection Plane Y" };
function inPoly(x, y, loop) {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) c = !c;
  }
  return c;
}
export function zoneSvg(res, zone, axisKey, opt) {
  opt = opt || {};
  const z = (res.zones || []).find((x) => x.zone === zone);
  if (!z) return "";
  const streets = res.streets || [];
  const ax = z[axisKey];
  // the drawing is the site and its buildings (and the canyons, the near
  // edge's dimensions): the streets run on beyond its edge, cut off
  const c1z = (res.case1 || []).filter((x) => x.zone === zone);
  const pts = [...res.site, ...z.footprints.flatMap((f) => f.loop),
    ...(opt.canyon ? c1z.flatMap((c) => c.buildings.flatMap((b) => (b.streets || []).flatMap((r) => [...(r.canyon || []).flat(), ...(r.lp_line || []), ...(r.len_line || [])]))) : []),
    ...(opt.canyon ? (res.street_legs || []).flatMap((lg) => (lg.width_dim ? [lg.width_dim[0], lg.width_dim[1]] : []).filter((p) => p[0] > -1e9)) : [])];
  const bounds = (ps) => [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[1]))];
  let [x0, x1, y0, y1] = bounds(pts);
  if (ax && ax.near && (ax.edge || []).length) {
    // the chain along the near edge, outside the site: in the drawing too
    const fs0 = Math.max(x1 - x0, y1 - y0) / 50;
    const av = [-ax.axis[1], ax.axis[0]];
    const v = ax.near.v_m + (ax.near.low ? -1 : 1) * fs0 * 4;
    for (const u of [ax.edge[0].lo, ax.edge[ax.edge.length - 1].hi]) pts.push([u * ax.axis[0] + v * av[0], u * ax.axis[1] + v * av[1]]);
    [x0, x1, y0, y1] = bounds(pts);
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.2 + 8;      // room for the axes and the scale bar
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W = x1 - x0, H = y1 - y0;
  const P = (p) => `${(p[0] - x0).toFixed(3)},${(y1 - p[1]).toFixed(3)}`;
  const D = (p) => [p[0] - x0, y1 - p[1]];          // plan -> drawing
  const poly = (loop) => loop.map(P).join(" ");
  // what a street's labels should keep clear of (on the canyon view): the
  // canyons, the Lp rectangles and the buildings
  const busyPts = opt.canyon ? [...c1z.flatMap((c) => c.buildings.flatMap((b) => (b.streets || []).flatMap((r) => [...(r.canyon || []).flat(), ...(r.lp_rect || [])]))),
    ...z.footprints.flatMap((f) => f.loop)] : [];
  // along a line (u from a to b, point(u)): the spot farthest from them, in view
  const clearSpot = (ua, ub, point, avoid) => {
    let best = null;
    for (let i = 0; i <= 24; i++) {
      const u = ua + (ub - ua) * i / 24;
      const q = point(u);
      if (q[0] < x0 || q[0] > x1 || q[1] < y0 || q[1] > y1) continue;
      let d = Math.min(1e9, ...busyPts.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])));
      if (avoid != null) d = Math.min(d, Math.abs(u - avoid) * 0.5 + 0.01);
      if (!best || d > best[1]) best = [u, d];
    }
    return best ? best[0] : (ua + ub) / 2;
  };
  const fs = Math.max(W, H) / 60;          // label size in metres
  const LB = makeLabels(fs, W, H);
  const id = "c" + Math.random().toString(36).slice(2, 8);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" class="sbd-svg" data-cad="${x0.toFixed(4)} ${y1.toFixed(4)}"${opt.w ? ` width="${opt.w}" height="${Math.round(opt.w * H / W)}"` : ""} font-family="system-ui,sans-serif">`
    + `<defs><clipPath id="${id}"><polygon points="${poly(res.site)}"/></clipPath>`
    + `<pattern id="${id}h" width="${fs}" height="${fs}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${fs}" stroke="#94a3b8" stroke-width="${fs / 8}"/></pattern></defs>`
    + `<rect width="100%" height="100%" fill="#fff"/>`;
  // what is drawn (plan polygons): the axes and the scale bar go where
  // there is least of it
  const objects = [res.site, ...streets.map((st) => st.outline || []).filter((l) => l.length > 2), ...z.footprints.map((f) => f.loop), ...(z.others || [])];
  if (ax) {
    for (const sd of Object.values(ax.sides || {})) if (sd.band || sd.polygon) objects.push(sd.band || sd.polygon);
    for (const g of ax.gaps) if (g.band || g.corridor) objects.push(g.band || g.corridor);
  }
  const busy = (bx) => {        // drawing box -> how much of it is drawn on
    let n = 0;
    for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
      const X = bx[0] + (bx[2] - bx[0]) * i / 7, Y = bx[1] + (bx[3] - bx[1]) * j / 7;
      if (objects.some((l) => l.length > 2 && inPoly(X + x0, y1 - Y, l))) n++;
    }
    return n;
  };
  // the emptiest place for a box w x h: a grid of spots over the drawing,
  // the one with least drawn under it (then the nearest the drawing's edge)
  const overlap = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
  const pickSpot = (w, h, avoid) => {
    let best = null;
    const nx = 14, ny = 14;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
      const x = fs * 0.5 + (W - w - fs) * i / nx, y = fs * 0.5 + (H - h - fs) * j / ny;
      const b = [x, y, x + w, y + h];
      if (avoid && overlap(b, avoid)) continue;
      const edge = Math.min(x, y, W - b[2], H - b[3]) / Math.max(W, H);
      const sc = busy(b) + edge;
      if (!best || sc < best[1]) best = [b, sc];
    }
    return best ? best[0] : [fs, fs, fs + w, fs + h];
  };
  s += `<polygon data-l="SBD-SITE" points="${poly(res.site)}" fill="#f8fafc" stroke="#0f172a" stroke-width="${fs / 6}" stroke-dasharray="${fs} ${fs / 3}"/>`;
  // the streets: the slab, its centreline (dash-dot) and the opposite boundary
  for (const st of streets) {
    if (st.outline && st.outline.length) s += `<polygon data-l="SBD-STREET" points="${poly(st.outline)}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="${fs / 12}"/>`;
    if (st.centreline && st.centreline.length > 1) {
      s += `<polyline data-l="SBD-STREET-CL" points="${poly(st.centreline)}" fill="none" stroke="#64748b" stroke-width="${fs / 10}" stroke-dasharray="${fs} ${fs / 3} ${fs / 6} ${fs / 3}"/>`;
      // its name along it (clear of the line), the centre-line symbol at its
      // end, and its own mean street level (Level 0 when it is the lowest);
      // the centreline as drawn, cut to the drawing (densified: a long
      // straight street is two far-away points)
      const cl = [];
      st.centreline.forEach((p, i) => {
        const q = st.centreline[i + 1];
        if (!q) { cl.push(p); return; }
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (fs / 2)));
        for (let k = 0; k < n; k++) cl.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
      });
      const inView = cl.filter((p) => p[0] > x0 + fs && p[0] < x1 - fs && p[1] > y0 + fs && p[1] < y1 - fs);
      const ms = inView.length ? inView : cl;
      let mi = Math.floor(ms.length / 2);
      if (busyPts.length) {
        let bd = -1;
        for (let i = 1; i < ms.length - 1; i += Math.max(1, Math.floor(ms.length / 30))) {
          const d = Math.min(1e9, ...busyPts.map((p) => Math.hypot(p[0] - ms[i][0], p[1] - ms[i][1])));
          if (d > bd) { bd = d; mi = i; }
        }
      }
      const m = ms[mi], mn = ms[Math.min(ms.length - 1, mi + 1)] || m;
      let ang = Math.atan2(-(mn[1] - m[1]), mn[0] - m[0]) * 180 / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const nrm = [Math.sin(ang * Math.PI / 180), Math.cos(ang * Math.PI / 180)];
      const [mx, my] = D(m);
      LB.add({ x: mx - nrm[0] * fs * 0.8, y: my - nrm[1] * fs * 0.8, t: st.label || st.name || "Street", size: fs * 0.9, rot: ang, cls: "sbd-stname", fill: "#475569", attrs: `font-style="italic"`, prio: 5 });
      const lvl = st.level != null ? st.level : res.ground_z;
      if (lvl != null) {
        const zero = res.ground_z != null && Math.abs(lvl - res.ground_z) < 0.0005;
        LB.add({ x: mx + nrm[0] * fs * 1.3, y: my + nrm[1] * fs * 1.3, t: `Mean street level ${lvl < 0 ? "" : "+"}${f3(lvl)}${zero ? " (Level 0)" : ""}`, size: fs * 0.7, rot: ang, cls: "sbd-msl", fill: "#0f766e", prio: 5 });
      }
      const end = ms[ms.length - 1], pre = ms[Math.max(0, ms.length - 2)];
      const dl = Math.hypot(end[0] - pre[0], end[1] - pre[1]) || 1;
      const ex = end[0] - x0 + (end[0] - pre[0]) / dl * fs * 0.2, ey = y1 - end[1] - (end[1] - pre[1]) / dl * fs * 0.2;
      LB.add({ x: ex, y: ey, t: "℄", size: fs * 1.3, mid: true, cls: "sbd-cl", fill: "#475569", attrs: `stroke="#fff" stroke-width="${fs / 6}" paint-order="stroke"`, prio: 6 });
    }
    if (st.opposite && st.opposite.length > 1) s += `<polyline data-l="SBD-STREET-OPP" points="${poly(st.opposite)}" fill="none" stroke="#0f172a" stroke-width="${fs / 8}"/>`;
  }
  // the gaps: strips across the site (faint: the projection), green when
  // they count, red when not; the S1 side regions (Area / Depth) and the S2
  // corridors are drawn over them as measured
  if (ax) {
    const measured = (g) => (g.side && ax.sides && ax.sides[g.side]) || g.corridor;
    s += `<g clip-path="url(#${id})">` + ax.gaps.filter((g) => !measured(g) && !(["S1", "S3"].includes(g.type) && Object.keys(ax.sides || {}).length)).map((g) => `<polygon points="${poly(g.strip)}" fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity="${measured(g) ? ".07" : ".22"}" stroke="${g.qualifies ? "#16a34a" : "#dc2626"}" stroke-width="${fs / 14}" stroke-dasharray="${measured(g) ? `${fs / 3} ${fs / 4}` : "none"}"/>`).join("") + `</g>`;
    for (const k of ["left", "right"]) {
      const sd = ax.sides && ax.sides[k];
      if (!sd || !sd.polygon || sd.polygon.length < 3) continue;
      const g = ax.gaps.find((x) => x.side === k);
      const ok = g ? g.qualifies : sd.avg_m >= 7.5;
      // the band (its inner edge carried past the site), clipped to the site:
      // the hatch runs to the boundary; next to a street, the region runs on
      // to the street's centreline
      // the region exactly as measured: to the site boundary, and beside a
      // street on to its centreline (between lines through the frontage's
      // corners, parallel to the plane)
      s += `<polygon class="sbd-side${sd.to_cl ? " sbd-tocl" : ""}" data-l="${ok ? "SBD-IS" : "SBD-NOT"}" points="${poly(sd.polygon)}" fill="${ok ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${ok ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
    for (const g of ax.gaps) {
      if (g.corridor && g.corridor.length > 2) s += `<polygon data-l="${g.qualifies ? "SBD-IS" : "SBD-NOT"}" points="${poly(g.ring || g.band || g.corridor)}"${!g.ring && g.band ? ` clip-path="url(#${id})"` : ""} fill="${g.qualifies ? "#16a34a" : "#dc2626"}" fill-opacity=".28" stroke="${g.qualifies ? "#15803d" : "#b91c1c"}" stroke-width="${fs / 8}"/>`;
    }
  }
  // the neighbours' buildings, and this zone's
  s += (z.others || []).map((l) => `<polygon data-l="SBD-BLDG-OTHER" points="${poly(l)}" fill="url(#${id}h)" stroke="#94a3b8" stroke-width="${fs / 12}"/>`).join("");
  s += z.footprints.map((f) => `<polygon data-l="SBD-BLDG" points="${poly(f.loop)}" fill="#475569" fill-opacity=".55" stroke="#1e293b" stroke-width="${fs / 10}"/>`).join("");
  // the air corridors (dashed blue outline over the measured band)
  s += ((ax && ax.gaps.filter((g) => g.corridor).map((g) => ({ polygon: g.ring || g.band || g.corridor, band: !g.ring && !!g.band }))) || []).map((c) => `<polygon data-l="SBD-CORRIDOR" points="${poly(c.polygon)}"${c.band ? ` clip-path="url(#${id})"` : ""} fill="none" stroke="#2563eb" stroke-width="${fs / 7}" stroke-dasharray="${fs / 2} ${fs / 3}"/>`).join("");
  // the buildings' names (the same on the elevations)
  for (const b of z.buildings || []) LB.add({ x: b.at[0] - x0, y: y1 - b.at[1], t: b.label, size: fs * 1.1, title: b.name || "", fill: "#fff", attrs: `font-weight="700" stroke="#1e293b" stroke-width="${fs / 6}" paint-order="stroke"`, prio: 9 });
  // a dimension line a-e (plan metres), with ticks; its text through the placer
  const dim = (pa, pe, text, col, cls, prio) => {
    const [a, e] = [pa, pe].map(D);
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const tx = -(e[1] - a[1]) / L * fs * 0.5, ty = (e[0] - a[0]) / L * fs * 0.5;
    let deg = Math.atan2(e[1] - a[1], e[0] - a[0]) * 180 / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const m = [(a[0] + e[0]) / 2 - tx * 1.8, (a[1] + e[1]) / 2 - ty * 1.8];
    LB.add({ x: m[0], y: m[1], t: text, size: fs * 0.8, mid: true, rot: deg, fill: col, cls: (cls || "sbd-dim") + "-t", attrs: HALO(fs), prio: prio || 3 });
    return `<g class="${cls || "sbd-dim"}"><line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${e[0].toFixed(2)}" y2="${e[1].toFixed(2)}" stroke="${col}" stroke-width="${fs / 8}"/>`
      + [a, e].map((p) => `<line x1="${(p[0] - tx).toFixed(2)}" y1="${(p[1] - ty).toFixed(2)}" x2="${(p[0] + tx).toFixed(2)}" y2="${(p[1] + ty).toFixed(2)}" stroke="${col}" stroke-width="${fs / 8}"/>`).join("") + `</g>`;
  };
  // an angle symbol: the arc from direction d0 to d1 (unit, plan) at p, and its value
  const arc = (p, d0, d1, text, col, r0) => {
    const r = r0 || fs * 3;
    const a0 = Math.atan2(d0[1], d0[0]), a1 = Math.atan2(d1[1], d1[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const q = (a) => [p[0] + Math.cos(a) * r - x0, y1 - (p[1] + Math.sin(a) * r)];
    const [b0, b1, bm] = [q(a0), q(a0 + da), q(a0 + da / 2)];
    const tl = [p[0] + Math.cos(a0 + da / 2) * r * 1.6 - x0, y1 - (p[1] + Math.sin(a0 + da / 2) * r * 1.6)];
    LB.add({ x: tl[0], y: tl[1], t: text, size: fs * 0.8, mid: true, fill: col, cls: "sbd-arc-t", attrs: HALO(fs), prio: 4 });
    return `<g class="sbd-arc"><line x1="${(p[0] - x0).toFixed(2)}" y1="${(y1 - p[1]).toFixed(2)}" x2="${b0[0].toFixed(2)}" y2="${b0[1].toFixed(2)}" stroke="${col}" stroke-width="${fs / 12}" stroke-dasharray="${fs / 3} ${fs / 5}"/>`
      + `<path d="M${b0[0].toFixed(2)},${b0[1].toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 0 ${da > 0 ? 0 : 1} ${b1[0].toFixed(2)},${b1[1].toFixed(2)}" fill="none" stroke="${col}" stroke-width="${fs / 8}"/>`
      + `<circle cx="${bm[0].toFixed(2)}" cy="${bm[1].toFixed(2)}" r="${fs / 6}" fill="${col}"/></g>`;
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
  // the axes symbol and the scale bar: in the emptiest corners, and nothing
  // else is put there
  const SL = niceLen(W);
  const sbW = SL + fs * 2.5, sbH = fs * 2.2;
  const axR = Math.max(W, H) * 0.05;
  // the axes symbol's extent about its centre: the arrows and their names
  let axExt = null;
  if (ax) {
    const ext = [-fs, -fs, fs, fs];
    for (const k of ["axis1", "axis2"]) {
      const a = z[k] && z[k].axis;
      if (!a) continue;
      const ex = a[0] * axR, ey = -a[1] * axR;
      const tw = PLANE_NAME[k].length * fs * 0.9 * 0.56;
      const tx = ex + a[0] * fs * 1.2, ty = ey - a[1] * fs * 1.2;
      const lx0 = a[0] > 0.3 ? tx : a[0] < -0.3 ? tx - tw : tx - tw / 2;
      ext[0] = Math.min(ext[0], ex, lx0); ext[2] = Math.max(ext[2], ex, lx0 + tw);
      ext[1] = Math.min(ext[1], ey, ty - fs); ext[3] = Math.max(ext[3], ey, ty + fs * 0.6);
    }
    axExt = ext;
  }
  const axBox = axExt ? pickSpot(axExt[2] - axExt[0] + fs, axExt[3] - axExt[1] + fs) : null;
  const sbBox = pickSpot(sbW, sbH, axBox);
  if (axBox) LB.block(axBox);
  LB.block(sbBox);
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
      LB.add({ x: c[0] - x0, y: y1 - c[1], t: `${nm} = ${f3(gapM(g))} m`, size: fs, title: gapKind(g), fill: col, attrs: HALO(fs), prio: 8 });
      if (sd) {
        // A (the hatch's area) and L (its depth across the plane): S = A / L
        const k = nm.slice(1);
        LB.add({ x: c[0] - x0, y: y1 - c[1] + fs * 1.2, t: `A${k} = ${f3(sd.area_m2)} m²`, size: fs * 0.8, fill: col, attrs: HALO(fs), prio: 7 });
        const uv = sd.polygon.map((p) => [p[0] * ax.axis[0] + p[1] * ax.axis[1], p[0] * avv[0] + p[1] * avv[1]]);
        const us = uv.map((q) => q[0]), vs = uv.map((q) => q[1]);
        const sc = res.site.map((p) => p[0] * ax.axis[0] + p[1] * ax.axis[1]);
        const mid = (Math.min(...sc) + Math.max(...sc)) / 2;
        const out = (Math.min(...us) + Math.max(...us)) / 2 < mid ? Math.min(...us) - fs * 1.5 : Math.max(...us) + fs * 1.5;
        const P2 = (u, v) => [u * ax.axis[0] + v * avv[0], u * ax.axis[1] + v * avv[1]];
        s += dim(P2(out, Math.min(...vs)), P2(out, Math.max(...vs)), `L${k} = ${f3(sd.depth_m)} m`, col, "sbd-dim sbd-ldim", 6);
        // witness lines from the region's two ends to the dimension
        for (const vEnd of [Math.min(...vs), Math.max(...vs)]) {
          const q = uv[vs.indexOf(vEnd)];
          const [a, e] = [P2(q[0], q[1]), P2(out, vEnd)].map(D);
          s += `<line class="sbd-wit" x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${e[0].toFixed(2)}" y2="${e[1].toFixed(2)}" stroke="${col}" stroke-width="${fs / 16}" stroke-dasharray="${fs / 4} ${fs / 6}"/>`;
        }
      }
      // the turn (any angle 0-15°): an arc from the perpendicular
      const deg = g.corridor ? g.bend_deg : sd ? sd.angle_deg : null;
      const edge = g.corridor && g.band ? g.band.slice(0, g.band.length / 2) : sd ? sd.edge : null;
      const t = turnAt(edge, avv, deg);
      if (t) s += arc(t.p, t.pv, t.u, `${f3(Math.abs(deg))}°`, "#7c3aed");
    }
    // the near edge (the plane's side): the gaps and the buildings' shadows
    // as the plane sees them - the widths the elevation is laid out with
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
        const txt = it.kind === "gap" ? `${num.get(it.gap) || it.label} ${f3(it.s_m)}${it.pass ? "" : " ✗"}` : `${it.label} ${f3(it.hi - it.lo)}`;
        LB.add({ x: m[0], y: m[1], t: txt, size: fs * 0.75, mid: true, rot: deg, fill: col, cls: "sbd-dims-t", attrs: HALO(fs), prio: 6 });
      }
      s += `</g>`;
    }
    // Projection Planes X and Y (the one drawn, bold) and the angle between
    // them, in the emptiest corner
    const ctr = [axBox[0] + fs / 2 - axExt[0] + x0, y1 - (axBox[1] + fs / 2 - axExt[1])];
    s += `<defs>${[["axis1", "#f28022"], ["axis2", "#7c3aed"]].map(([k, c]) => `<marker id="${id}${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}</defs>`;
    s += `<g class="sbd-axes">`;
    let axt = "";
    for (const k of ["axis1", "axis2"]) {
      const a = z[k] && z[k].axis;
      if (!a) continue;
      const e = [ctr[0] + a[0] * axR, ctr[1] + a[1] * axR];
      const col = k === "axis1" ? "#f28022" : "#7c3aed";
      s += `<line x1="${(ctr[0] - x0).toFixed(2)}" y1="${(y1 - ctr[1]).toFixed(2)}" x2="${(e[0] - x0).toFixed(2)}" y2="${(y1 - e[1]).toFixed(2)}" stroke="${col}" stroke-width="${k === axisKey ? fs / 4 : fs / 9}" marker-end="url(#${id}${k})"/>`;
      const tx = e[0] + a[0] * fs * 1.2 - x0, ty = y1 - e[1] - a[1] * fs * 1.2;
      axt += `<text x="${tx.toFixed(2)}" y="${(ty + fs * 0.35).toFixed(2)}" font-size="${fs * 0.9}" fill="${col}" text-anchor="${a[0] > 0.3 ? "start" : a[0] < -0.3 ? "end" : "middle"}" font-weight="${k === axisKey ? 700 : 400}" ${HALO(fs)}>${PLANE_NAME[k]}</text>`;
    }
    if (z.axis1 && z.axis2) {
      const a1 = z.axis1.axis, a2 = z.axis2.axis;
      const ang = Math.acos(Math.max(-1, Math.min(1, a1[0] * a2[0] + a1[1] * a2[1]))) * 180 / Math.PI;
      const rr = axR * 0.45;
      const a0 = Math.atan2(a1[1], a1[0]);
      let da = Math.atan2(a2[1], a2[0]) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const q = (t) => [ctr[0] + Math.cos(t) * rr - x0, y1 - (ctr[1] + Math.sin(t) * rr)];
      const [b0, b1] = [q(a0), q(a0 + da)];
      const tm = [ctr[0] - Math.cos(a0 + da / 2) * fs * 1.6 - x0, y1 - (ctr[1] - Math.sin(a0 + da / 2) * fs * 1.6)];
      s += `<g class="sbd-arc"><path d="M${b0[0].toFixed(2)},${b0[1].toFixed(2)} A${rr.toFixed(2)},${rr.toFixed(2)} 0 0 ${da > 0 ? 0 : 1} ${b1[0].toFixed(2)},${b1[1].toFixed(2)}" fill="none" stroke="#0f172a" stroke-width="${fs / 8}"/>`
        + `<text x="${tm[0].toFixed(2)}" y="${(tm[1] + fs * 0.3).toFixed(2)}" font-size="${fs * 0.8}" text-anchor="middle" fill="#0f172a" ${HALO(fs)}>${f3(ang)}°</text></g>`;
    }
    s += axt + `</g>`;
  }
  // Design Requirement (1): the street canyon of each building facing a
  // street in this zone, its facade, and Lp along the street
  if (opt.canyon) {
    // as GB081: each canyon hatched with its area, the Actual Lp beyond the
    // building, the Length beyond the opposite boundary, a typical width
    for (const c of c1z) {
      c.buildings.forEach((b, bi) => {
        const col = b.pass ? "#15803d" : "#dc2626";
        (b.streets || []).forEach((r, j) => {
          const L = canyonLetter(bi, j, b.streets.length);
          // each part of the canyon (a facade set back beyond 30 m between
          // two parts makes two: Fig B7 A2(a), A2(b)), with its area, its
          // Length and its Actual Lp
          const parts = r.parts || [{ tag: "", canyon: (r.canyon || [])[0], facade: (r.facade || [])[0], area_m2: r.area_m2, L_m: r.L_m, Lp_m: r.Lp_m, lp_line: r.lp_line, len_line: r.len_line }];
          for (const q of parts) {
            const nm = L + (q.tag ? `(${q.tag})` : "");
            if (q.canyon) s += `<polygon data-l="SBD-CANYON" points="${poly(q.canyon)}" fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="${fs / 12}"/>`;
            if (q.facade && q.facade.length > 1) s += `<polyline data-l="SBD-CANYON" points="${poly(q.facade)}" fill="none" stroke="${col}" stroke-width="${fs / 4}"/>`;
            if (q.canyon) {
              const ct = D(q.canyon.reduce((m, p) => [m[0] + p[0] / q.canyon.length, m[1] + p[1] / q.canyon.length], [0, 0]));
              LB.add({ x: ct[0], y: ct[1] - fs * 0.5, t: `STREET CANYON AREA ${nm}`, size: fs * 0.85, fill: "#7f1d1d", attrs: HALO(fs), prio: 7 });
              LB.add({ x: ct[0], y: ct[1] + fs * 0.6, t: `= ${f3(q.area_m2)} m²`, size: fs * 0.85, fill: "#7f1d1d", attrs: HALO(fs), prio: 7 });
            }
            if (q.lp_line) s += dim(q.lp_line[0], q.lp_line[1], `ACTUAL Lp${nm} = ${f3(q.Lp_m)} m`, "#b91c1c", "sbd-dim sbd-lpdim", 6);
            if (q.len_line) s += dim(q.len_line[0], q.len_line[1], `LENGTH ${nm} = ${f3(q.L_m)} m`, "#b91c1c", "sbd-dim sbd-lendim", 6);
          }
          if (r.width_dim) s += dim(r.width_dim[0], r.width_dim[1], `${f3(r.width_dim[2])} m`, "#b91c1c", "sbd-dim", 2);
          if (r.lp_rect) s += `<polygon class="sbd-lprect" data-l="SBD-LP" points="${poly(r.lp_rect)}" fill="none" stroke="#b91c1c" stroke-width="${fs / 8}" stroke-dasharray="${fs * 0.6} ${fs * 0.35}"/>`;
        });
      });
      // the buildings not within 30 m of a street: their smallest bounding
      // rectangle, and Lp = its shorter side, dimensioned along it
      for (const o of c.others || []) {
        s += `<polygon class="sbd-lprect sbd-na" data-l="SBD-LP" points="${poly(o.lp_rect)}" fill="none" stroke="#64748b" stroke-width="${fs / 12}" stroke-dasharray="${fs * 0.6} ${fs * 0.35}"/>`;
        if (o.lp_side) {
          // the dimension just outside the rectangle, beside its short side
          const rc = o.lp_rect.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
          const [p0, p1] = o.lp_side;
          const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const out = [mid[0] - rc[0], mid[1] - rc[1]];
          const ol = Math.hypot(out[0], out[1]) || 1;
          const k = fs * 1.4 / ol;
          s += dim([p0[0] + out[0] * k, p0[1] + out[1] * k], [p1[0] + out[0] * k, p1[1] + out[1] * k], `${o.building} Lp = ${f3(o.Lp_m)} m`, "#475569", "sbd-dim sbd-lpdim-na", 5);
        }
      }
      // the clear distance between neighbouring buildings: under 15 m they
      // are one group for Lp
      for (const sp of c.spacing || []) s += dim(sp.p, sp.q, `${f3(sp.d_m)} m ${sp.grouped ? "< 15 m: one group" : "≥ 15 m"}`, sp.grouped ? "#b45309" : "#475569", "sbd-dim sbd-spdim", 5);
    }
    // each street leg: the 30 m offset from its centreline as a dashed line
    // across the site, its 30 m dimension and the street's width - both where
    // the drawing is clear of the canyons
    for (const lg of res.street_legs || []) {
      const dd = lg.dir, nn = lg.normal;
      const c0p = lg.centreline[0];
      const us = res.site.map((p) => (p[0] - c0p[0]) * dd[0] + (p[1] - c0p[1]) * dd[1]);
      const ua = Math.min(...us) - 10, ub = Math.max(...us) + 10;
      const at = (u, w) => [c0p[0] + dd[0] * u + nn[0] * w, c0p[1] + dd[1] * u + nn[1] * w];
      const [a, b] = [at(ua, 30), at(ub, 30)].map(D);
      s += `<line class="sbd-30" data-l="SBD-DIM" x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="#2563eb" stroke-width="${fs / 10}" stroke-dasharray="${fs * 0.9} ${fs * 0.45}"/>`;
      const u0 = clearSpot(ua + 10, ub - 10, (u) => at(u, 15));
      s += dim(at(u0, 0), at(u0, 30), "30 m", "#2563eb", "sbd-dim sbd-30dim", 4);
      if (lg.width_dim) {
        const w = lg.width_dim[2];
        const u1 = clearSpot(ua + 10, ub - 10, (u) => at(u, 0), u0);
        s += dim(at(u1, -w / 2), at(u1, w / 2), `${f3(w)} m wide`, "#475569", "sbd-dim sbd-wdim", 4);
      }
    }
  }
  // the scale bar: 0 - half - a round length about a quarter of the drawing
  {
    const h = fs * 0.5, bx = sbBox[0] + fs * 0.5, by = sbBox[3] - fs * 0.6;
    s += `<g class="sbd-scale">` + [0, 1, 2, 3].map((i) => `<rect x="${(bx + SL / 4 * i).toFixed(2)}" y="${(by - h).toFixed(2)}" width="${(SL / 4).toFixed(2)}" height="${h.toFixed(2)}" fill="${i % 2 ? "#fff" : "#0f172a"}" stroke="#0f172a" stroke-width="${fs / 20}"/>`).join("")
      + [[0, "0"], [SL / 2, String(SL / 2)], [SL, SL + " m"]].map(([d, t]) => `<text x="${(bx + d).toFixed(2)}" y="${(by - h - fs * 0.3).toFixed(2)}" font-size="${fs * 0.75}" text-anchor="middle">${t}</text>`).join("") + `</g>`;
  }
  return s + LB.render() + `</svg>`;
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
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW.toFixed(2)} ${VH.toFixed(2)}" class="sbd-svg" data-cad="${(-L).toFixed(4)} ${(T + e.H_m + e.z0).toFixed(4)}"${opt.w ? ` width="${opt.w}" height="${Math.round(opt.w * VH / VW)}"` : ""} font-family="system-ui,sans-serif">`
    + `<defs><pattern id="${id}H" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="100%" height="100%" fill="#cbd5e1"/><line x1="0" y1="0" x2="0" y2="${fs * 0.8}" stroke="#334155" stroke-width="${fs / 6}"/></pattern>`
    + `<pattern id="${id}D" width="${fs * 0.7}" height="${fs * 0.7}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dcfce7"/><circle cx="${fs * 0.35}" cy="${fs * 0.35}" r="${fs / 9}" fill="#15803d"/></pattern>`
    + `<pattern id="${id}N" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="100%" height="100%" fill="#fff"/><line x1="0" y1="0" x2="0" y2="${fs * 0.8}" stroke="#dc2626" stroke-width="${fs / 8}"/></pattern>`
    + `<pattern id="${id}G" width="${fs * 0.8}" height="${fs * 0.8}" patternUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="#dbeafe"/><path d="M0 0H${fs * 0.8}M0 0V${fs * 0.8}" stroke="#1d4ed8" stroke-width="${fs / 10}"/></pattern></defs>`
    + `<rect width="100%" height="100%" fill="#fff"/>`;
  for (const [u0, u1, h0, h1, k] of e.rects) {
    s += `<rect data-l="SBD-${{ bldg: "BLDG", exempt: "EXEMPT", is: "IS", sky: "IS", pe: "PE", nis: "NOT" }[k] || "OPEN"}" x="${X(u0)}" y="${Y(h1)}" width="${(u1 - u0).toFixed(3)}" height="${(h1 - h0).toFixed(3)}" fill="${fill(k)}" stroke="${k === "bldg" ? "#475569" : k === "nis" ? "#dc2626" : "none"}" stroke-width="${fs / 14}"/>`;
  }
  const LB = makeLabels(fs, VW, VH);
  // the counted parts, numbered IS1, IS2 ... (PE1 ...) with their sizes: in
  // the part, or beside it (with a leader) when it is too small
  for (const g of isGroups(e)) {
    const [u0, u1, h0, h1] = g.box;
    const col = g.pe ? "#1e3a8a" : "#14532d";
    const small = u1 - u0 < fs * 2 || h1 - h0 < fs * 1.2;
    const cx = Number(X((u0 + u1) / 2)), cy = Number(Y((h0 + h1) / 2));
    LB.add({ x: cx, y: cy - (small ? 0 : fs * 0.2), t: g.name, size: fs * 0.8, fill: col, attrs: HALO(fs), prio: 6, along: !small });
    LB.add({ x: cx, y: cy + fs * 0.75, t: g.how, size: fs * 0.65, fill: col, attrs: HALO(fs), prio: 5 });
  }
  // the buildings' profile: each step of their tops dimensioned above the
  // zone, and its height
  const prof = profile(e);
  if (prof.length) {
    const yp = T - fs * 2.4;
    const tk = (x) => `<line x1="${X(x)}" y1="${yp - fs / 2}" x2="${X(x)}" y2="${yp + fs / 2}" stroke="#1d4ed8" stroke-width="${fs / 10}"/>`;
    s += `<g class="sbd-prof"><line x1="${X(prof[0][0])}" y1="${yp}" x2="${X(prof[prof.length - 1][1])}" y2="${yp}" stroke="#1d4ed8" stroke-width="${fs / 10}"/>`;
    for (const [a, b, h, hLow] of prof) {
      s += tk(a) + tk(b) + `<line x1="${X(a)}" y1="${yp}" x2="${X(a)}" y2="${Y(h)}" stroke="#1d4ed8" stroke-width="${fs / 20}" stroke-dasharray="${fs / 3} ${fs / 4}"/>`
        + (b - a >= fs * 2.5 ? `<text x="${X((a + b) / 2)}" y="${yp - fs * 0.35}" font-size="${fs * 0.7}" text-anchor="middle" fill="#1d4ed8">${f3(b - a)}${hLow != null ? " (sloped)" : ""}</text>` : "");
      LB.add({ x: Number(X((a + b) / 2)), y: Number(Y(h)) + fs * 1.1, t: `h ${hLow != null ? `${f3(hLow)} - ${f3(h)}` : f3(h)}`, size: fs * 0.65, fill: "#0f172a", attrs: HALO(fs), prio: 7 });
    }
    s += tk(prof[prof.length - 1][1]) + `</g>`;
  }
  // the zone frame (dashed red, as in the sample), its levels and W
  s += `<rect data-l="SBD-ZONE" x="${X(0)}" y="${Y(e.H_m)}" width="${e.W_m}" height="${e.H_m}" fill="none" stroke="#dc2626" stroke-width="${fs / 8}" stroke-dasharray="${fs} ${fs / 2}"/>`;
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
    s += tick(it.x0) + tick(it.x1);
    LB.add({ x: Number(X((it.x0 + it.x1) / 2)), y: yb - fs * 0.35, t: it.kind === "gap" ? `${num.get(it.gap) || it.label} ${f3(it.w_m)}${it.pass ? "" : it.joined ? (it.w_m >= 3 ? " (IS + PE)" : " (IS)") : it.w_m >= 3 ? " (PE)" : " ✗"}` : `${it.label} ${f3(it.w_m)}`,
      size: fs * 0.8, fill: col, attrs: HALO(fs), prio: 8, along: false });
  }
  const yw = yb + fs * 2.4;
  s += `<line x1="${X(0)}" y1="${yw}" x2="${X(e.W_m)}" y2="${yw}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<line x1="${X(0)}" y1="${yw - fs / 2}" x2="${X(0)}" y2="${yw + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/><line x1="${X(e.W_m)}" y1="${yw - fs / 2}" x2="${X(e.W_m)}" y2="${yw + fs / 2}" stroke="#0f172a" stroke-width="${fs / 10}"/>`
    + `<text x="${X(e.W_m / 2)}" y="${yw - fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="#0f172a">W ${f2(e.W_m)} m</text>`
    + `<text x="${X(e.W_m / 2)}" y="${yw + fs * 1.4}" font-size="${fs * 0.9}" text-anchor="middle" fill="#475569">Deformed elevation on ${axisKey === "axis1" ? "Projection Plane X" : "Projection Plane Y"} · H ${f2(e.H_m)} m</text>`
    + `<text x="${X(0)}" y="${fs * 1.6}" font-size="${fs * 1.1}" fill="#0f172a" font-weight="600">${esc(ZONE_LABEL[zone] || zone)} (${levelOf(z)}) · P = ${f2(e.P_is)} % IS + ${f2(e.P_pe)} % PE = ${f2(e.P)} %</text>`;
  return s + LB.render() + `</svg>`;
}

/* The IS and PE areas of an elevation, each a connected region (a sloped
 * face's thin steps make one): {name, pe, area, box, how, rects}, left to
 * right, numbered IS1, IS2 ... and PE1 ... */
function isGroups(e) {
  const r = isParts(e);
  const cls = (q) => (q[4] === "pe" ? "pe" : "is");
  const par = r.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const T = 1e-3;
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (cls(a) !== cls(b)) continue;
      const side = (Math.abs(a[1] - b[0]) < T || Math.abs(b[1] - a[0]) < T) && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > T;
      const stack = (Math.abs(a[3] - b[2]) < T || Math.abs(b[3] - a[2]) < T) && Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > T;
      if (side || stack) par[find(i)] = find(j);
    }
  }
  const m = new Map();
  r.forEach((q, i) => { const k = find(i); if (!m.has(k)) m.set(k, []); m.get(k).push(q); });
  const gs = [...m.values()].map((qs) => {
    const box = [Math.min(...qs.map((q) => q[0])), Math.max(...qs.map((q) => q[1])), Math.min(...qs.map((q) => q[2])), Math.max(...qs.map((q) => q[3]))];
    const area = qs.reduce((t, q) => t + (q[1] - q[0]) * (q[3] - q[2]), 0);
    const bw = box[1] - box[0], bh = box[3] - box[2];
    const how = qs.length === 1 ? `${f3(bw)} x ${f3(bh)}`
      : Math.abs(area - bw * bh) < 1e-6 * (1 + bw * bh) ? `${f3(bw)} x ${f3(bh)}`
      : Math.abs(area - bw * bh / 2) < 0.12 * bw * bh ? `½ x ${f3(bw)} x ${f3(bh)} (triangle)`
      : `${f3(area)} m² (stepped)`;
    return { pe: cls(qs[0]) === "pe", area, box, how, rects: qs };
  }).sort((a, b) => a.box[0] - b.box[0] || a.box[2] - b.box[2]);
  let ni = 0, np = 0;
  for (const g of gs) g.name = g.pe ? "PE" + (++np) : "IS" + (++ni);
  return gs;
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
  // steps narrower than 0.5 m (a sloped face cut into rows) are one sloped step
  const merged = [];
  for (const p of out.filter((q) => q[1] - q[0] > 1e-3)) {
    const last = merged[merged.length - 1];
    if (p[1] - p[0] < 0.5 && last && last.thin && Math.abs(last[1] - p[0]) < 1e-6) {
      last[1] = p[1];
      last[2] = Math.max(last[2], p[2]);
      last[3] = Math.min(last[3], p[2]);
    } else {
      const q = [p[0], p[1], p[2], p[1] - p[0] < 0.5 ? p[2] : null];
      q.thin = p[1] - p[0] < 0.5;
      merged.push(q);
    }
  }
  return merged.map((q) => (q.thin && Math.abs(q[2] - q[3]) > 1e-6 ? [q[0], q[1], q[2], q[3]] : [q[0], q[1], q[2], null]));
}

/* The working of a zone's elevation, as rows [label, text]. */
function elevWorking(e, req, ax) {
  const gs = isGroups(e);
  const parts = gs.filter((g) => !g.pe), pes = gs.filter((g) => g.pe);
  const num = gapNums(ax);
  const its = e.items || [];
  const bad = its.filter((i) => i.kind === "gap" && !i.pass);
  const rows = [
    ...(its.length ? [["W", its.map((i) => `${f3(i.w_m)} (${i.kind === "gap" ? num.get(i.gap) || i.label : i.label})`).join(" + ") + ` = ${f3(e.W_m)} m`]] : []),
    ["Zone area", `W x H = ${f2(e.W_m)} x ${f2(e.H_m)} = ${f1(e.zone_area_m2)} m²`],
    ["IS area", (parts.length ? parts.map((p) => p.name).join(" + ") + " = " + parts.map((p) => `(${p.how})`).join(" + ") + " = " : "") + `${f3(e.is_area_m2)} m²`],
    ["P by the IS", `${f1(e.is_area_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_is)} %` + (req ? ` (IS alone must reach 2/3 x ${f1(req)} = ${f2(req * 2 / 3)} %: ${e.is_min_ok ? "OK" : "NOT OK"})` : "")],
    ["PE area", pes.length ? pes.map((p) => p.name).join(" + ") + " = " + pes.map((p) => `(${p.how})`).join(" + ") + ` = ${f3(e.pe_area_m2)} m²`
      + (bad.some((i) => i.w_m >= 3) ? ` - incl. the gaps under their S but ≥ 3 m wide: ${bad.filter((i) => i.w_m >= 3).map((i) => `${num.get(i.gap) || i.label} ${f3(i.w_m)}`).join(", ")}` : "")
      : "none (a void through the building, or a gap under its S, ≥ 3 m wide and high)"],
  ];
  if (e.pe_area_m2) rows.push(["P by the PE", `${f1(e.pe_used_m2)} / ${f1(e.zone_area_m2)} = ${f2(e.P_pe)} %` + (e.pe_cap_m2 != null ? ` (up to 1/3 x ${f1(req)} = ${f2(req / 3)} %${e.pe_used_m2 < e.pe_area_m2 - 0.01 ? ", the rest not counted" : ", all accountable"})` : "")]);
  rows.push(["P", `${f2(e.P_is)} + ${f2(e.P_pe)} = ${f2(e.P)} %` + (req ? ` (required ${f1(req)} %: ${e.P >= req - 1e-9 && e.is_min_ok !== false ? "OK" : "NOT OK"})` : "")]);
  // IS and PE taken horizontally: a gap short of its S that opens on to the
  // sky over the building beside it
  const jn = its.filter((i) => i.kind === "gap" && i.joined);
  if (jn.length) rows.push(["Taken horizontally", jn.map((i) => `${num.get(i.gap) || i.label} ${f3(i.w_m)} m with the open area beside it, above +${f3(i.joined.z_from + e.z0)}: ${f3(i.joined.run_m)} m ≥ ${f3(i.joined.need_m)} m - IS there${i.w_m >= 3 ? ", PE below" : ""}`).join("; ")]);
  const badN = bad.filter((i) => i.w_m < 3 && !i.joined);
  if (badN.length) rows.push(["Not counted", badN.map((i) => `${num.get(i.gap) || i.label} ${f3(i.w_m)} m (${{ S1: "setback", S2: "between buildings", S3: "angled boundary" }[i.label] || i.label}, under 3 m, below ${i.label === "S2" ? 15 : 7.5} m${i.label === "blocked" ? ", blocked" : ""})`).join(", ")]);
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
    <div class="chk-row sbd-levels" id="sbd-levels" hidden title="The height each zone's plan is taken at: the podium's shape can differ level to level. All levels (worst) takes every height in the zone. The elevation is always the true 3D."></div>
    <div class="chk-row"><select id="sbd-saved" title="Saved results" aria-label="Saved results"></select>
      <button id="sbd-save" class="ghost" title="Keep this result (everyone on the project sees it)">Save</button>
      <button id="sbd-del" class="ghost" title="Delete this saved result" hidden>&#10005;</button></div>
    <div id="sbd-sum"></div>
    <div class="chk-row sbd-acts">
      <button id="sbd-plan" class="ghost" title="The plan and the elevations of each zone: the gaps, the air corridors, IS and PE">Plan ...</button>
      <label class="row-check" style="width:auto" title="The masses and the zone limits in the model"><input type="checkbox" id="sbd-3d"> 3D</label>
      <button id="sbd-issue" class="ghost" title="An issue for what fails">Make issue</button>
      <button id="sbd-report" class="ghost" title="A report: the table and a plan of each zone (Print / Save to Folders)">Report</button>
      <span class="sbd-cadwrap"><button id="sbd-cad" class="ghost" title="Every plan, elevation and street canyon as a CAD drawing (DXF or DWG), one layer per kind (SBD-IS, SBD-PE, SBD-BLDG ...), in metres">CAD ...</button>
        <span class="sbd-cadmenu" hidden><button class="ghost" data-cad="dxf" title="AutoCAD and most CAD programs open a DXF">DXF</button><button class="ghost" data-cad="dwg" title="Made by the ODA File Converter on the server">DWG</button></span></span>
      <button id="sbd-remove" class="ghost danger" title="Remove the masses sent from Revit, this result and the masses' model in the 3D (saved results stay)">Remove ...</button>
    </div>
    <div class="chk-row sbd-cadin"><span class="muted" title="Draw the site, the streets and the building masses on the template's layers in AutoCAD, SketchUp, Rhino ..., then import it: the same check as from Revit">No Revit?</span>
      <a href="/api/sbd/template.dxf" download="SBD model template.dxf" class="sbd-tpl" title="A DXF with the layers to draw on (SBD-SITE, SBD-STREET-&lt;name&gt;, SBD-MASS) and the rules">CAD template</a>
      <button id="sbd-cadin" class="ghost" title="A DXF (or DWG) drawn on the template's layers: it becomes this project's SBD model and its masses in the 3D">Import CAD model ...</button>
      <input type="file" id="sbd-cadfile" accept=".dxf,.dwg" hidden></div>
    <div class="muted hint"><a href="#" class="sbd-howto">How to prepare the model ...</a> From the building masses: in Revit, <b>LWK > Viewer tools > SBD Export</b>. P, S1/S2/S3 and the air corridors follow the SBD panel's rules, for each zone's own footprints; P is taken on each zone's elevation (IS + PE).</div>`;
  const $ = (s) => box.querySelector(s);
  const cur = () => (B.view ? B.viewRes : B.res);

  /* ------------------------------------------------------------ CAD */
  // every drawing of a result, a row per zone: plan X, elevation X, plan Y,
  // elevation Y, street canyon
  function cadDrawings(r) {
    const out = [];
    r.zones.filter((z) => z.assessed).forEach((z, i) => {
      const zl = ZONE_LABEL[z.zone] || z.zone;
      for (const k of ["axis1", "axis2"]) {
        out.push({ row: i, title: `${zl} - plan${z.plan_level != null ? ` at +${f3(z.plan_level)}` : ""}, ${PLANE_NAME[k]} - P ${f3(z[k].P_zone != null ? z[k].P_zone : z[k].P)} %`, svg: zoneSvg(r, z.zone, k) });
        if (z[k].elev) out.push({ row: i, title: `${zl} - elevation on ${PLANE_NAME[k]} - P ${f3(z[k].elev.P)} %`, svg: elevSvg(r, z.zone, k) });
      }
      if ((r.case1 || []).some((c) => c.zone === z.zone)) out.push({ row: i, title: `${zl} - Design Requirement (1), street canyon`, svg: zoneSvg(r, z.zone, null, { canyon: true }) });
    });
    return out;
  }
  async function cadSave(drawings, name, format) {
    ctx.status(`Making the ${format.toUpperCase()} ...`);
    try {
      const n = await downloadCad(cadLayout(drawings), name, format);
      ctx.status(`${name}.${format} saved (${Math.max(1, Math.round(n / 1024))} KB): one layer per kind - SBD-IS, SBD-PE, SBD-BLDG, SBD-DIM ...; metres.`);
    } catch (e) { ctx.status(`Not made: ${e.message}`); }
  }
  let odaOk = null;
  const hasOda = async () => {
    if (odaOk == null) {
      try { odaOk = !!(await api("/api/import/cad/tools")).oda; } catch (e) { odaOk = false; }
    }
    return odaOk;
  };

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
    for (const b of box.querySelectorAll("#sbd-run, #sbd-save, #sbd-plan, #sbd-3d, #sbd-issue, #sbd-report, #sbd-cad")) b.disabled = !r || !r.ok;
    $("#sbd-remove").disabled = !m && !B.res;
    if (!r) { $("#sbd-sum").innerHTML = ""; return; }
    if (!r.ok) { $("#sbd-sum").innerHTML = `<div class="bad">${(r.warnings || []).map(esc).join("<br>")}</div>`; return; }
    const pz = (a) => (a.P_zone != null ? a.P_zone : a.P);
    const cell = (a) => `<td class="n ${a.pass === false ? "bad" : ""}${a.required_p == null && a.pass == null && r.required_p != null ? " muted" : ""}" title="${a.elev ? `Elevation: IS ${f2(a.elev.P_is)} % + PE ${f2(a.elev.P_pe)} % · on plan IS / W ${f1(a.P)} %` : ""}${a.required_p == null && r.required_p != null ? " - for information (a site under 2 ha is checked on Plane X)" : ""}">${f1(pz(a))}`;
    const rows = r.zones.map((z) => `<tr><td><span class="sbd-dot" style="background:${ZONE_COLOR[z.zone]}"></span>${esc(ZONE_LABEL[z.zone] || z.zone)} <small class="muted sbd-pl" title="The plan level the zone was assessed at">${z.plan_level != null ? `@+${f3(z.plan_level)}` : "all levels"}</small></td>`
      + (z.assessed ? `${cell(z.axis1)}<small class="muted sbd-ang">${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + Math.round(z.plane_x_deg) + "°" : ""}</small></td>${cell(z.axis2)}<small class="muted sbd-ang">${z.plane_y_deg != null ? Math.round(z.plane_y_deg) + "°" : ""}</small></td><td class="n">${z.axis1.gaps.filter((g) => g.qualifies).length}/${z.axis1.gaps.length}</td>`
        : `<td colspan="3" class="muted">no building</td>`) + `</tr>`).join("");
    const ok = r.pass;
    $("#sbd-sum").innerHTML = `
      <div class="sbd-verdict ${ok == null ? "" : ok ? "ok" : "bad"}">P = <b>${f1(r.controlling_p)} %</b>${r.required_p != null ? ` · required ${f1(r.required_p)} %${r.required_p_y != null ? ` (Plane Y ${f1(r.required_p_y)} %)` : ""}` : " · no P required (Table 1)"}`
        + `${ok == null ? "" : ok ? " · <b>PASS</b>" : " · <b>FAIL</b>"}<small class="muted"> (2) permeability</small></div>`
      + (r.case1_pass != null ? `<div class="sbd-verdict ${r.case1_pass ? "ok" : "bad"}" title="Design Requirement (1): each building's Lp along the street ≤ 5 x the canyon's U, in each zone">Street canyon: Lp ≤ 5U${r.case1_pass ? " · <b>PASS</b>" : ` · <b>FAIL</b> (${r.case1.flatMap((c) => c.buildings.filter((b) => !b.pass).map((b) => `${c.zone} ${b.building}`)).join(", ")})`}<small class="muted"> (1) street canyon</small></div>`
        : (r.streets || []).length ? `<div class="sbd-verdict" title="${esc((r.case1 || []).flatMap((c) => c.notes || []).join(" / "))}">Street canyon: not applicable - no building within 30 m of a street's centreline<small class="muted"> (1) street canyon</small></div>` : "")
      + `
      <table class="sbd-t"><tr><th>Zone</th><th class="n" title="Projection Plane X: (IS + PE) / (W x H) on the zone's elevation; its angle from the street small">P X %</th><th class="n" title="Projection Plane Y, 75-105° from X">P Y %</th><th class="n" title="Gaps that count / all gaps on Projection Plane X">gaps</th></tr>${rows}</table>
      <div class="muted sbd-lp">Site ${f1(r.site_area_m2)} m² · Lp ${f1(r.lp.projected_m)} m (projected, all buildings)`
        + `${r.required_p !== r.required_p_addin ? ` <span class="bad" title="The SBD panel takes the shorter side of one building (${f1(r.lp.addin_m)} m), which gives a different required P - confirm the reading of APP-152">· add-in Lp ${f1(r.lp.addin_m)} m</span>` : ""}</div>`
      + ((r.case1 || []).some((c) => c.buildings.length) ? `<table class="sbd-t"><tr><th title="Design Requirement (1): Lp ≤ 5 U, per zone">Case 1</th><th class="n" title="Canyon area / its length along the street">U m</th><th class="n" title="The facade projected on the street (Low zone: above 1/3 H)">Lp m</th><th class="n">5U m</th></tr>`
        + r.case1.flatMap((s) => s.buildings.map((b, bi) => `<tr title="${esc(canyonWorking(b, bi).map(([k, v]) => k + ": " + v).join("\n"))}"><td><span class="sbd-dot" style="background:${ZONE_COLOR[s.zone]}"></span>${esc(b.building)}${b.name ? " · " + esc(b.name) : ""} <span class="muted">${esc(b.ctrl_street || "")}</span></td><td class="n">${f1(b.U_m)}</td><td class="n ${b.pass ? "" : "bad"}">${f1(b.Lp_m)}</td><td class="n">${f1(b.Lp_max_m)}</td></tr>`)).join("") + `</table>` : "")
      + ((r.warnings || []).length ? `<div class="bad sbd-warn">${r.warnings.map(esc).join("<br>")}</div>` : "")
      + (B.view ? `<div class="muted">Saved ${esc((cur().saved_at || "").replace("T", " ").slice(0, 16))} by ${esc(cur().saved_by || "")}</div>` : `<div class="muted">Run ${esc((r.run_at || "").replace("T", " ").slice(0, 16))}${r.run_by ? " · " + esc(r.run_by) : ""}</div>`);
    paintLevels(r);
    if (B.three) show3d(true);
  }

  // a plan level per zone: All levels (worst), or one of the heights where
  // the masses keep one shape
  function paintLevels(r) {
    const el = $("#sbd-levels");
    const zs = (r.zones || []).filter((z) => z.assessed && (z.levels || []).length >= 1);
    el.hidden = !zs.length || !!B.view;
    if (el.hidden) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="muted">Plan level</span>` + zs.map((z) => `<label class="sbd-lv">${esc((ZONE_LABEL[z.zone] || z.zone).split(" ")[0])}
      <select data-lv="${z.zone}" aria-label="${esc(ZONE_LABEL[z.zone] || z.zone)} plan level"><option value="">All levels (worst)</option>${z.levels.map((l) => `<option value="${l.z}"${z.plan_level != null && Math.abs(z.plan_level - l.z) < 0.01 ? " selected" : ""}>+${f3(l.from)} to +${f3(l.to)}</option>`).join("")}</select></label>`).join("");
  }
  const levelsChosen = () => {
    const out = {};
    for (const sel of box.querySelectorAll("#sbd-levels select")) if (sel.value !== "") out[sel.dataset.lv] = Number(sel.value);
    return out;
  };
  $("#sbd-levels").addEventListener("change", () => $("#sbd-run").click());

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
      B.res = await api("/api/sbd/run", { method: "POST", body: JSON.stringify({ axis: "street", levels: levelsChosen() }) });
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
    if (!confirm("Remove the SBD masses (sent from Revit or imported from CAD), the latest result and the masses' model in the 3D?\n\nSaved results stay. Send the masses again with SBD Export, or import the CAD model again.")) return;
    try {
      const r = await api("/api/sbd", { method: "DELETE" });
      show3d(false);
      $("#sbd-3d").checked = false;
      B.model = null; B.res = null; B.view = "";
      paintSaved();
      paint();
      let off = 0;
      try { if (ctx.dropSbdRefs) off = await ctx.dropSbdRefs(); } catch (e) {}
      ctx.status(`SBD removed${r.removed_models || off ? " - and its masses' model in the 3D" : ""}.`);
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
        <span class="sbd-ztabs"><button class="ghost" data-a="axis1" title="Projection Plane X">Plane X</button><button class="ghost" data-a="axis2" title="Projection Plane Y">Plane Y</button></span>
        <span class="spacer"></span><button class="ghost" data-cadv="dxf" title="This drawing as a DXF: a plan in the model's own coordinates (it lies over the site plan), in metres">DXF</button><button class="ghost" data-cadv="dwg" title="This drawing as a DWG (the ODA File Converter on the server)">DWG</button><button class="ghost" data-x title="Close">&#10005;</button></div>
      <div class="sbd-wb"><div class="sbd-plan"></div><div class="sbd-gaps"></div></div>
      <div class="sbd-legend muted" data-l="elev"><span class="sw" style="background:#94a3b8"></span>building <span class="sw" style="background:radial-gradient(#15803d 30%,#dcfce7 35%);background-size:6px 6px"></span>IS (a gap that counts, or open space side by side as wide as its S)
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
            + (canyonExtra(c).length ? `<table class="sbd-t sbd-c1x">${canyonExtra(c).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>` : "")
            + (c.notes || []).map((n) => `<p class="muted sbd-c1note">${esc(n)}</p>`).join("")).join("")
          + (cs.length ? "" : `<p class="muted">No building in this zone abuts a street (none within 30 m of a street's centreline).</p>`)
          + `<div class="muted sbd-note">A building (or a group: buildings under 15 m apart) abuts a street when any part of it is within 30 m of the street's centreline; only that part counts. Its canyon runs over its projected length on that street, from the facade to the opposite site boundary: U = canyon area / length. Each street has its own U; the smallest controls. Actual Lp (the facade projected on the street) must not exceed 5 x U. In the Low zone the portion ≤ 1/3 H is left out. Fig B7, GB081.</div>`;
        return;
      }
      if (view === "elev") {
        const e = ax && ax.elev;
        const req = ax && (ax.required_p != null ? ax.required_p : null);
        back.querySelector(".sbd-plan").innerHTML = e ? elevSvg(r, zone, axisKey) : `<div class="muted">No elevation in this result - run it again.</div>`;
        zoomable(back.querySelector(".sbd-plan"));
        back.querySelector(".sbd-gaps").innerHTML = e ? `<div class="sbd-ptot">P = ${f2(e.P)} %<br><span class="muted">(IS + PE) / (W x H) on ${axisKey === "axis1" ? "Plane X" : "Plane Y"}${req == null && r.required_p != null ? " - for information: a site under 2 ha is checked on Plane X" : ""}</span></div>`
          + `<table class="sbd-t">${elevWorking(e, req != null ? req : r.required_p, ax).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
          + `<div class="muted sbd-note">IS: in a gap that counts on plan (S1, S3 ≥ 7.5 m; S2 ≥ 15 m). IS and PE are taken horizontally: at each height, the open space side by side - a gap and the space open to above over a lower building beside it - is IS where together it is as wide as the gap's S (7.5 m; 15 m between buildings); the rest of a gap short of its S is PE when ≥ 3 m wide. PE: a void through the building ≥ 3 m wide and high; it counts up to 1/3 of the required P. Low zone: the portion ≤ 1/3 H is disregarded. On plan (IS / W): ${f1(ax.P)} %.</div>` : "";
        return;
      }
      back.querySelector(".sbd-plan").innerHTML = zoneSvg(r, zone, axisKey);
      zoomable(back.querySelector(".sbd-plan"));
      const planes = z && z.plane_x_deg != null ? `Plane X ${z.plane_x_deg ? (z.plane_x_deg > 0 ? "+" : "") + f1(z.plane_x_deg) + "° from the street" : "along the street"} · Plane Y ${f1(z.plane_y_deg)}° from X · ${levelOf(z)}` : "";
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
      if (b.dataset.cadv) {
        const zl = ZONE_LABEL[zone] || zone;
        const svg = view === "canyon" ? zoneSvg(r, zone, null, { canyon: true }) : view === "elev" ? elevSvg(r, zone, axisKey) : zoneSvg(r, zone, axisKey);
        const what = view === "canyon" ? "street canyon" : `${view === "elev" ? "elevation" : "plan"} ${PLANE_NAME[axisKey]}`;
        cadSave([{ svg }], `SBD ${zl.split(" ")[0]} ${what}`, b.dataset.cadv);
        return;
      }
      if (b.dataset.z) zone = b.dataset.z;
      if (b.dataset.a) axisKey = b.dataset.a;
      if (b.dataset.v) view = b.dataset.v;
      draw();
    });
    document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { back.remove(); document.removeEventListener("keydown", k); } });
    draw();
  }
  $("#sbd-plan").onclick = planWindow;
  // a model drawn in CAD (the template's layers)
  $("#sbd-cadin").onclick = () => $("#sbd-cadfile").click();
  $("#sbd-cadfile").onchange = async () => {
    const f = $("#sbd-cadfile").files[0];
    $("#sbd-cadfile").value = "";
    if (!f) return;
    if (B.model && !confirm(`Replace the SBD model (${B.model.masses.length} mass(es) from ${B.model.model || "Revit"}) with ${f.name}?`)) return;
    ctx.status(`Reading ${f.name} ...`);
    $("#sbd-cadin").disabled = true;
    try {
      const r = await fetch("/api/sbd/cad-model?name=" + encodeURIComponent(f.name), { method: "POST", headers: Object.assign({ "Content-Type": "application/octet-stream" }, Store.authHeaders()), body: f });
      let d = null;
      try { d = await r.json(); } catch (e) {}
      if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
      await load();
      ctx.status(`${f.name}: ${d.masses} mass(es), ${d.streets} street(s) - P ${f1(d.controlling_p)} %${(d.problems || []).length ? " · " + d.problems.join(" ") : ""}`);
      if ((d.problems || []).length) alert(`${f.name} was read, with these notes:\n\n- ` + d.problems.join("\n- "));
    } catch (e) { ctx.status(`${f.name} not read: ${e.message}`); alert(`${f.name} was not read:\n\n${e.message}`); }
    $("#sbd-cadin").disabled = false;
  };
  $("#sbd-cad").onclick = async (ev) => {
    ev.stopPropagation();
    const m = box.querySelector(".sbd-cadmenu");
    m.hidden = !m.hidden;
    if (!m.hidden) {
      const dwg = m.querySelector('[data-cad="dwg"]');
      const ok = await hasOda();
      dwg.disabled = !ok;
      dwg.title = ok ? "Made by the ODA File Converter on the server" : "DWG needs the ODA File Converter on the server - take the DXF (AutoCAD opens it)";
    }
  };
  box.querySelector(".sbd-cadmenu").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cad]");
    if (!b) return;
    box.querySelector(".sbd-cadmenu").hidden = true;
    const r = cur();
    if (r && r.ok) cadSave(cadDrawings(r), `SBD ${ctx.projectName ? ctx.projectName() : ""} ${new Date().toISOString().slice(0, 10)}`.replace(/\s+/g, " ").trim(), b.dataset.cad);
  });
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".sbd-cadwrap")) { const m = box.querySelector(".sbd-cadmenu"); if (m) m.hidden = true; } });

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
        items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · ${levelOf(z)}, ${PLANE_NAME[k]}`, tag: `P ${f2(ax.P_zone != null ? ax.P_zone : ax.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(zoneSvg(r, z.zone, k), 2000), big: true,
          rows: [["Planes", `Plane X ${f3(z.plane_x_deg)}° from the street · Plane Y ${f3(z.plane_y_deg)}° from Plane X` + nearText(ax)],
            ["Plan level", z.plan_level != null ? `+${f3(z.plan_level)} (chosen): the masses cut at this height for the plan; the elevation is the true 3D` : "all levels (worst): every height in the zone; the elevation is the true 3D"],
            ...ax.gaps.map((g, i) => [num.get(i), g, i]).sort((p, q) => Number(p[0].slice(1)) - Number(q[0].slice(1)))
              .map(([nm, g]) => [`${nm} (${gapKind(g)})`, `${gapHow(g, ax, nm)} - ${g.qualifies ? "counts" : `does not count (min ${g.threshold_m || 7.5} m)`}`, g.qualifies ? "#16a34a" : "#dc2626"]),
            ...((ax.edge || []).length ? [["Along the plane (W)", ax.edge.map((it) => it.kind === "gap" ? `${num.get(it.gap) || it.label} ${f3(it.s_m)}` : `${it.label} ${f3(it.hi - it.lo)}`).join(" + ") + ` = ${f3(ax.edge.reduce((t, it) => t + (it.kind === "gap" ? it.s_m : it.hi - it.lo), 0))} m`]] : []),
            ...(k === "axis1" && (z.tried || []).length > 1 ? [["Planes tried", z.tried.map((t) => `X ${f3(t.x_deg)}° / Y ${f3(t.y_deg)}°: P X ${f2(t.P_x)} %, P Y ${f2(t.P_y)} %${t.chosen ? " (used)" : ""}`).join("; ")]] : [])] });
        if (ax.elev) items.push({ head: `${ZONE_LABEL[z.zone] || z.zone} · elevation on ${k === "axis1" ? "Plane X" : "Plane Y"} (${levelOf(z)})`, tag: `P ${f2(ax.elev.P)} %`, tagColor: ZONE_COLOR[z.zone],
          img: await svgPng(elevSvg(r, z.zone, k), 2000), big: true, rows: elevWorking(ax.elev, ax.required_p != null ? ax.required_p : r.required_p, ax) });
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
          img: await svgPng(zoneSvg(r, z.zone, null, { canyon: true }), 2000), big: true,
          rows: [...cs.flatMap((c) => c.buildings.flatMap((b, bi) => canyonWorking(b, bi).map(([k, v], i) => [`${i ? "" : b.building + " · "}${k}`, v, k === "Result" ? (b.pass ? "#16a34a" : "#dc2626") : undefined]))),
            ...cs.flatMap((c) => canyonExtra(c)),
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
        ["Level 0", levelText(r)],
        ["Masses", B.model ? `${B.model.masses.length}, from ${B.model.model || "Revit"} (${(B.model.at || "").slice(0, 10)})` : ""],
        ...((r.warnings || []).length ? [["Warnings", r.warnings.join(" / ")]] : [])],
      table: { cols: ["Zone", "Plan level", "P Plane X %", "P Plane Y %", "Case 1: Lp / 5U m"], rows: r.zones.map((z) => [ZONE_LABEL[z.zone] || z.zone, z.assessed ? (z.plan_level != null ? `+${f3(z.plan_level)}` : "all levels (worst)") : "-",
        z.assessed ? f1(z.axis1.P_zone != null ? z.axis1.P_zone : z.axis1.P) : "-", z.assessed ? f1(z.axis2.P_zone != null ? z.axis2.P_zone : z.axis2.P) : "-",
        (r.case1 || []).filter((c) => c.zone === z.zone).flatMap((c) => c.buildings.map((b) => `${f1(b.Lp_m)} / ${f1(b.Lp_max_m)}${b.pass ? "" : " FAIL"}`)).join(", ") || "-"]) },
      items,
    });
    ctx.status("SBD report ready in a new tab - Print / Save as PDF there, or Save to Folders.");
  };

  return { refresh: load, close: () => show3d(false) };
}
