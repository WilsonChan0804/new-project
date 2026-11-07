/* The Area tool's ways of making an area (areafill.js does the geometry):
 *
 *   Points I click  as before: click the corners (with snapping).
 *   Click inside    one click in a room. On a Revit plan published with its
 *                   rooms, that room's own outline (and holes). Otherwise the
 *                   closed outline round the click - bounded by the Revit
 *                   model's own walls, doors and columns where the plan's cut
 *                   is published (no dimension, grid or text in the way), or
 *                   by the drawing's lines less those left out: dashed lines,
 *                   door swings, and any line the person picks to ignore
 *                   (that one, or all drawn like it - every dimension line).
 *                   Doorways up to the gap set are closed across.
 *   Pick lines      click the lines round the area in turn; each is trimmed
 *                   or extended to meet the next. Where the drawing has no
 *                   line (a doorway), Ctrl+click two points to draw one.
 *                   Click the first line again (or Enter) to close it.
 *
 * A region can be added to an area - it is merged with what it touches, so
 * no line is left between them - or cut out of it as a hole: Shift+click
 * adds, Alt+click cuts (or choose it under "Next"). An area keeps its
 * outline in points_mm (edited as before) and further regions and holes in
 * loops_mm [{pts, sub}]; its label is the net area.
 *
 * With an area chosen, Offset moves its edge out or in by a wall thickness:
 * to the inside face, the centre line or the outside face.
 */
import { fillAt, offset, net, unite, meet, tidy, dimensionParts, area as polyArea } from "./areafill.js";
import { dock, finishDock, undock } from "./rppanel.js";

const KEEP = "lwk-sheets:areatool";
const IGNORE = "lwk-sheets:area-ignore:";
const MODES = [["points", "Points I click"], ["fill", "Click inside"], ["lines", "Pick lines"]];
// what of the Revit model bounds a room (planroute.py categories)
const MODEL_CATS = ["Walls", "Doors", "Windows", "Columns", "Structural Columns", "Curtain Panels", "Curtain Mullions"];

export function createAreaTool(ctx) {
  const { S, status, redraw, persist, remember, snapLines, pxPerMM, activeScale, roomAt, hasRooms, cutAt, hasCut, finish, newDraft } = ctx;
  const A = { mode: "points", gap_mm: 1200, rooms: true, model: true, noDash: true, noDim: true, doors: true, next: "new",
    pickKind: "line", picked: [], pickOp: "new", panel: null, lastId: "", ignorePick: "", ownStart: null, cache: null };
  try { Object.assign(A, JSON.parse(localStorage.getItem(KEEP) || "{}"), { picked: [], ignorePick: "", ownStart: null, cache: null }); } catch (e) {}
  const keep = () => { try { localStorage.setItem(KEEP, JSON.stringify({ mode: A.mode, gap_mm: A.gap_mm, rooms: A.rooms, model: A.model, noDash: A.noDash, noDim: A.noDim, doors: A.doors })); } catch (e) {} };

  const active = () => S.tool === "area" && A.mode !== "points";
  const opOf = (ev) => (ev && ev.shiftKey ? "add" : ev && ev.altKey ? "sub" : A.next);
  const scaleAt = (p) => { const s = activeScale(p, null); return s ? s.scale : null; };
  const unitAt = (p) => { const sc = scaleAt(p); return sc ? 1000 / sc : 10; };     // paper mm per metre

  /* ------------------------------------------- the lines left out, per sheet */
  const sheetKey = () => (S.sheet ? (S.sheet.pdf || S.sheet.number) + "|" + (S.sheet.page || 1) : "");
  function ignored() {
    try { const j = JSON.parse(localStorage.getItem(IGNORE + sheetKey()) || "{}"); return { c: j.c || [], l: j.l || [] }; } catch (e) { return { c: [], l: [] }; }
  }
  function setIgnored(v) {
    try { localStorage.setItem(IGNORE + sheetKey(), JSON.stringify(v)); } catch (e) {}
    A.cache = null;
  }
  const classKey = (c) => c.w + "|" + c.color + "|" + (c.dash ? 1 : 0);
  const lineKey = (L, s) => {
    const a = L[4 * s].toFixed(2) + "," + L[4 * s + 1].toFixed(2), b = L[4 * s + 2].toFixed(2) + "," + L[4 * s + 3].toFixed(2);
    return a < b ? a + "|" + b : b + "|" + a;
  };

  /* Door swings: arcs of a door's width (0.45 - 1.6 m) through about a
     quarter turn. Their hinge is the arc's centre; the leaf closed runs from
     it to one end of the arc, open to the other: both block, as a wall
     does, so the room stops at the door (as a Revit room does). */
  function swings(idx, sc) {
    const C = idx.curves || [], n = C.length / 6, out = new Uint8Array(Math.max(1, n));
    out.leaves = [];
    for (let i = 1; i < n; i++) {
      const ax = C[6 * i], ay = C[6 * i + 1], mx = C[6 * i + 2], my = C[6 * i + 3], bx = C[6 * i + 4], by = C[6 * i + 5];
      const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
      if (Math.abs(d) < 1e-9) continue;
      const ux = ((ax * ax + ay * ay) * (my - by) + (mx * mx + my * my) * (by - ay) + (bx * bx + by * by) * (ay - my)) / d;
      const uy = ((ax * ax + ay * ay) * (bx - mx) + (mx * mx + my * my) * (ax - bx) + (bx * bx + by * by) * (mx - ax)) / d;
      const R = Math.hypot(ax - ux, ay - uy), Rm = R * sc / 1000;
      if (Rm < 0.45 || Rm > 1.6) continue;
      const ang = (x, y) => Math.atan2(y - uy, x - ux);
      let sw = Math.abs(ang(bx, by) - ang(ax, ay));
      if (sw > Math.PI) sw = 2 * Math.PI - sw;
      const deg = sw * 180 / Math.PI;
      if (deg >= 55 && deg <= 100) { out[i] = 1; out.leaves.push(ux, uy, ax, ay, ux, uy, bx, by); }
    }
    return out;
  }

  /* The lines that bound a Click inside at p: { L, from } */
  function barrier(p) {
    if (A.model && cutAt) {
      const L = cutAt(p, MODEL_CATS);
      if (L && L.length) return { L, from: "model" };
    }
    const idx = snapLines();
    if (!idx) return null;
    const sc = scaleAt(p) || 100;
    const ig = ignored();
    const sig = [idx.count, sc, A.noDash, A.noDim, A.doors, ig.c.join(";"), ig.l.length, ig.l.slice(-3).join(";")].join("#");
    if (A.cache && A.cache.idx === idx && A.cache.sig === sig) return { L: A.cache.L, from: "drawing", left: A.cache.left, dims: A.cache.dims };
    const L = idx.lines, n = L.length / 4;
    const igc = new Set(ig.c), igl = new Set(ig.l);
    const cls = idx.cls, classes = idx.classes || [];
    const off = classes.map((c) => igc.has(classKey(c)) || (A.noDash && c.dash));
    const sw = A.doors && idx.curve ? swings(idx, sc) : null;
    // the dimensions (lines, ticks, extension lines): found once per sheet
    if (A.noDim && idx.around && (!A.dimCache || A.dimCache.idx !== idx)) A.dimCache = { idx, flag: dimensionParts(L, idx.around) };
    const dim = A.noDim && A.dimCache && A.dimCache.idx === idx ? A.dimCache.flag : null;
    const keepL = [];
    let left = 0, dims = 0;
    for (let s = 0; s < n; s++) {
      if (dim && dim[s]) { dims++; continue; }
      if ((cls && off[cls[s]]) || (sw && idx.curve[s] && sw[idx.curve[s]]) || (igl.size && igl.has(lineKey(L, s)))) { left++; continue; }
      keepL.push(L[4 * s], L[4 * s + 1], L[4 * s + 2], L[4 * s + 3]);
    }
    if (sw) keepL.push(...sw.leaves);
    A.cache = { idx, sig, L: Float64Array.from(keepL), left, dims };
    return { L: A.cache.L, from: "drawing", left, dims };
  }

  /* Ignore a line: the one clicked, or every line drawn like it */
  function pickIgnore(p) {
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const s = idx.nearestIndex(p, 8 / pxPerMM());
    if (s < 0) { status("No line there - click on the line to leave out."); return; }
    const v = ignored();
    if (A.ignorePick === "class" && idx.cls) {
      const c = idx.classes[idx.cls[s]];
      const k = classKey(c);
      if (!v.c.includes(k)) v.c.push(k);
      status(`Left out: every line drawn like that one (${c.fill ? "filled" : c.w + " mm"}${c.color.replace("f", "") !== "000000" ? ", #" + c.color.replace("f", "") : ""}${c.dash ? ", dashed" : ""}) - ${c.n} lines. Click inside again.`);
    } else {
      const k = lineKey(idx.lines, s);
      if (!v.l.includes(k)) v.l.push(k);
      status("That line is left out. Click inside again.");
    }
    setIgnored(v);
    A.ignorePick = "";
    paintPanel();
  }

  /* The area an added region or a hole goes to: the one chosen, else the last made here */
  function target() {
    if (S.sel && S.sel.length === 1) {
      const it = S.items.find((x) => x.id === S.sel[0]);
      if (it && it.type === "area") return it;
    }
    const it = S.items.find((x) => x.id === A.lastId && x.sheet === (S.sheet && S.sheet.number));
    return it && it.type === "area" ? it : null;
  }

  const inPoly = (P, L) => {
    let c = false;
    for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const a = L[i], b = L[j];
      if ((a[1] > P[1]) !== (b[1] > P[1]) && P[0] < (b[0] - a[0]) * (P[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  /* A region made: a new area, or added to (merged with what it touches) / cut out of the target */
  function place(pts, holes, room, op, at) {
    const t = op === "new" ? null : target();
    // a hole only where the area is (else it would take off area that was never there)
    if (t && op === "sub" && at) {
      const where = [t.points_mm].concat((t.loops_mm || []).filter((l) => !l.sub).map((l) => l.pts));
      if (!where.some((L) => inPoly(at, L)) || (t.loops_mm || []).some((l) => l.sub && inPoly(at, l.pts))) {
        status("That is not inside the area - a hole is cut from inside it (it may be left out already).");
        return;
      }
    }
    if (!t) {
      const d = newDraft("area", pts);
      if (holes && holes.length) d.loops_mm = holes.map((h) => ({ pts: h, sub: true }));
      if (room) d.room = room;
      finish(d, (made) => { A.lastId = made.id; paintPanel(); });
      if (op !== "new") status("No area chosen to add to - a new area was made. Choose an area first, or make one.");
      return;
    }
    remember([t.id]);
    const sub = op === "sub";
    const loops = t.loops_mm || [];
    if (sub) {
      t.loops_mm = loops.concat([{ pts, sub: true }]);
    } else {
      // merged: the regions that touch become one outline, with no line between them
      const parts = unite([t.points_mm].concat(loops.filter((l) => !l.sub).map((l) => l.pts), [pts]));
      if (parts.length) {
        t.points_mm = parts[0];
        t.loops_mm = parts.slice(1).map((q) => ({ pts: q, sub: false })).concat(loops.filter((l) => l.sub), (holes || []).map((h) => ({ pts: h, sub: true })));
        delete t.room;                       // no longer one Revit room's outline
      } else {
        t.loops_mm = loops.concat([{ pts, sub: false }]);
      }
    }
    A.lastId = t.id;
    redraw();
    persist([t.id]);
    paintPanel();
  }

  /* ----------------------------------------------------- click inside */
  function fill(p, ev) {
    const op = opOf(ev);
    // a hole (a column, a shaft) is the drawing's, never the room round it
    const R = A.rooms && roomAt && op !== "sub" ? roomAt(p) : null;
    if (R) {
      place(R.loops[0].map((q) => q.slice()), R.loops.slice(1).map((l) => l.map((q) => q.slice())),
        { number: R.number, name: R.name, area_m2: R.area_m2, uid: R.uid }, op, p);
      status(`Room ${[R.number, R.name].filter(Boolean).join(" ")} - its outline from Revit${R.area_m2 ? ` (Revit: ${R.area_m2} m²)` : ""}.`);
      return;
    }
    const B = barrier(p);
    if (!B) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const sc = scaleAt(p);
    const gap = A.gap_mm > 0 ? (sc ? A.gap_mm / sc : 12) : 0;
    status("Finding the outline ...");
    const r = fillAt(B.L, p, { gap, page: S.pageMM, unit: unitAt(p) });
    if (!r.pts) {
      status({
        open: "No closed outline round that point - an opening is wider than the gap set" + (A.gap_mm ? ` (${A.gap_mm} mm)` : "") + ". Raise it, or use Pick lines (Ctrl+click two points draws a closing line).",
        "on-line": "That point is on a line - click inside the area.",
        small: "The outline round that point is too small - click inside the area.",
        outside: "Click on the drawing.",
      }[r.error] || "No outline found.");
      return;
    }
    place(r.pts, null, null, op, p);
    status(`Outline found (${r.pts.length} corners${B.from === "model" ? ", bounded by the Revit model's walls" : B.dims ? `, ${B.dims} lines of dimensions left out` : ""}). `
      + (B.from === "model" ? "" : "Cut short by a dimension or other line? Ignore a line (panel), then click again. ")
      + "Shift+click adds a region (merged), Alt+click cuts a hole.");
  }

  /* -------------------------------------------------------- pick lines */
  /* A pick is a polyline Q: a straight line is 2 points, a curve (an arc, a
     curved wall) all its pieces, a line of your own 2 points. A place along
     it is a number u: segment floor(u), and the fraction past its start
     (below 0 or past the last segment: the line carried on). */
  const ptAt = (Q, u) => {
    const i = Math.max(0, Math.min(Q.length - 2, Math.floor(u))), t = u - i;
    return [Q[i][0] + (Q[i + 1][0] - Q[i][0]) * t, Q[i][1] + (Q[i + 1][1] - Q[i][1]) * t];
  };
  const qlen = (Q) => { let s = 0; for (let i = 1; i < Q.length; i++) s += Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]); return s; };
  const closedQ = (Q) => Q.length > 3 && Math.hypot(Q[0][0] - Q[Q.length - 1][0], Q[0][1] - Q[Q.length - 1][1]) < 1e-6;
  const sameQ = (a, b) => a.length === b.length && Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]) < 1e-6
    && Math.hypot(a[a.length - 1][0] - b[b.length - 1][0], a[a.length - 1][1] - b[b.length - 1][1]) < 1e-6;
  /* the place on Q nearest p */
  function projU(Q, p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < Q.length - 1; i++) {
      const a = Q[i], b = Q[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (d < bd) { bd = d; best = i + t; }
    }
    return best;
  }
  /* Where two picks in a row meet: their crossing, segment by segment, the
     end segments carried on as far as needed (trim / extend), the crossing
     needing least carrying on. null when they never meet near the lines. */
  function corner(A1, B1) {
    let best = null;
    const nA = A1.length - 1, nB = B1.length - 1;
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      const a0 = A1[i], a1 = A1[i + 1], b0 = B1[j], b1 = B1[j + 1];
      const q = meet(a0, a1, b0, b1);
      if (!q) continue;
      const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1e-12, lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1e-12;
      const ta = ((q[0] - a0[0]) * (a1[0] - a0[0]) + (q[1] - a0[1]) * (a1[1] - a0[1])) / (la * la);
      const tb = ((q[0] - b0[0]) * (b1[0] - b0[0]) + (q[1] - b0[1]) * (b1[1] - b0[1])) / (lb * lb);
      const e = 1e-9;
      if ((ta < -e && i > 0) || (ta > 1 + e && i < nA - 1) || (tb < -e && j > 0) || (tb > 1 + e && j < nB - 1)) continue;
      const extA = ta < 0 ? -ta * la : ta > 1 ? (ta - 1) * la : 0, extB = tb < 0 ? -tb * lb : tb > 1 ? (tb - 1) * lb : 0;
      const cost = extA + extB;
      if (!best || cost < best.cost - 1e-9) best = { q, ua: i + ta, ub: j + tb, cost, extA, extB };
    }
    if (!best) return null;                            // parallel (inLine tells whether that is fine)
    const far = Math.max(unitAt(best.q) * 4, 0.5 * Math.max(qlen(A1), qlen(B1)));
    return Math.min(best.extA, best.extB) > far ? null : best;
  }
  /* parallel and on one line (a wall face broken by an opening): two straight picks */
  function inLine(A1, B1) {
    if (A1.length !== 2 || B1.length !== 2) return false;
    const a = [A1[0][0], A1[0][1], A1[1][0], A1[1][1]];
    const L = Math.hypot(a[2] - a[0], a[3] - a[1]) || 1;
    const off = (x, y) => Math.abs((a[2] - a[0]) * (a[1] - y) - (a[0] - x) * (a[3] - a[1])) / L;
    const tol = Math.max(0.05, unitAt(A1[0]) * 0.01);
    return off(B1[0][0], B1[0][1]) < tol && off(B1[1][0], B1[1][1]) < tol;
  }
  /* the end of Q nearer the other pick, as a place along Q */
  function nearEndU(Q, O) {
    const d = (p) => { const u = projU(O, p); const q = ptAt(O, Math.max(0, Math.min(O.length - 1, u))); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
    return d(Q[0]) <= d(Q[Q.length - 1]) ? 0 : Q.length - 1;
  }
  /* Q from place u0 to place u1, its own corners (a curve's points) between */
  function cut(Q, u0, u1, p0, p1) {
    const out = [p0 || ptAt(Q, u0)];
    const n = Q.length - 1, e = 1e-9;
    if (u0 <= u1) { for (let k = Math.max(0, Math.ceil(u0 + e)); k <= Math.min(n, Math.floor(u1 - e)); k++) out.push(Q[k]); }
    else { for (let k = Math.min(n, Math.floor(u0 - e)); k >= Math.max(0, Math.ceil(u1 + e)); k--) out.push(Q[k]); }
    out.push(p1 || ptAt(Q, u1));
    return out;
  }
  /* The picks as a chain: where each meets the next (trimmed or extended),
     and the part of each between its two corners. closed: the last meets
     the first. Two picks that never meet near the lines are joined straight
     across, end to end (warn: which). */
  function chain(closed) {
    const P = A.picked, n = P.length, warn = [];
    if (n === 1) {
      const Q = P[0].Q;
      const pts = closedQ(Q) ? Q.slice(0, -1) : Q.slice();
      const segs = []; for (let i = 1; i < Q.length; i++) segs.push([Q[i - 1][0], Q[i - 1][1], Q[i][0], Q[i][1]]);
      return { pts, segs, warn };
    }
    const C = new Array(n).fill(null);          // C[i]: where pick i-1 meets pick i
    for (let i = closed ? 0 : 1; i < n; i++) {
      const a = P[(i + n - 1) % n].Q, b = P[i].Q;
      C[i] = corner(a, b);
      // two pieces of one line (either side of a doorway) join straight across: that is right, no warning
      if (!C[i] && !inLine(a, b)) warn.push(i);
    }
    const pts = [], segs = [];
    for (let i = 0; i < n; i++) {
      const Q = P[i].Q, k = (i + 1) % n, h = (i + n - 1) % n;
      const u0 = C[i] ? C[i].ub : (!closed && i === 0 ? projU(Q, P[i].at) : nearEndU(Q, P[h].Q));
      const last = !closed && i === n - 1;
      const u1 = last ? projU(Q, P[i].at) : (C[k] ? C[k].ua : nearEndU(Q, P[k].Q));
      const part = cut(Q, u0, u1, C[i] ? C[i].q : null, !last && C[k] ? C[k].q : null);
      for (let t = 0; t < part.length; t++) {
        // a corner shared with the pick before is already in
        if (t === 0 && C[i] && pts.length) continue;
        pts.push(part[t]);
      }
      for (let t = 1; t < part.length; t++) segs.push([part[t - 1][0], part[t - 1][1], part[t][0], part[t][1]]);
    }
    if (closed && pts.length > 2) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop();
    }
    return { pts, segs, warn };
  }
  /* A picked line of the drawing as a polyline: a piece of a curve brings
     the whole curve - followed by where its pieces meet, not by their order
     in the PDF, since an exporter may draw one arc as several curves (in
     separate paths, in any order) or as many short straight lines. The
     curve ends where the next line does not carry it on: a tangent wall (a
     long straight line), a corner, a junction. */
  function shapeOf(idx, s) {
    const L = idx.lines, cv = idx.curve;
    const E = (k, e) => [L[4 * k + 2 * e], L[4 * k + 2 * e + 1]];
    const len = (k) => Math.hypot(L[4 * k + 2] - L[4 * k], L[4 * k + 3] - L[4 * k + 1]);
    const isCurve = (k) => !!(cv && cv[k]);
    const used = new Set([s]);
    const pts = [E(s, 0), E(s, 1)];
    const lens = [len(s)];
    const turn = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
      const lu = Math.hypot(u[0], u[1]) || 1e-12, lv = Math.hypot(v[0], v[1]) || 1e-12;
      return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI * (lu && lv ? 1 : 0);
    };
    // grow the chain at its end (fwd) or its start
    let sign = 0;                       // the way the curve turns, the same all along it
    const grow = (fwd) => {
      for (let guard = 0; guard < 4000; guard++) {
        const tip = fwd ? pts[pts.length - 1] : pts[0], prev = fwd ? pts[pts.length - 2] : pts[1];
        const lastLen = fwd ? lens[lens.length - 1] : lens[0];
        let best = null, bt = Infinity;
        idx.around(tip, 0.05, (k) => {
          if (used.has(k)) return;
          let far;
          if (Math.hypot(L[4 * k] - tip[0], L[4 * k + 1] - tip[1]) < 0.03) far = E(k, 1);
          else if (Math.hypot(L[4 * k + 2] - tip[0], L[4 * k + 3] - tip[1]) < 0.03) far = E(k, 0);
          else return;
          // the bend at the joint, seen along the chain's way
          const t = fwd ? turn(prev, tip, far) : turn(far, tip, prev);
          if (Math.abs(t) > 25) return;
          const curve = isCurve(k);
          const lk = len(k);
          // a straight piece carries the curve on only if it is short like the last and does bend
          if (!curve && (lk > lastLen * 3 + 1e-9 || lk < lastLen / 3 - 1e-9 || Math.abs(t) < 0.2)) return;
          if (sign && Math.abs(t) > 0.2 && Math.sign(t) !== sign) return;
          if (Math.abs(t) < bt) { bt = Math.abs(t); best = { k, far, t }; }
        });
        if (!best) return;
        used.add(best.k);
        if (!sign && Math.abs(best.t) > 0.2) sign = Math.sign(best.t);
        if (fwd) { pts.push(best.far); lens.push(len(best.k)); } else { pts.unshift(best.far); lens.unshift(len(best.k)); }
        // back where it began: a closed curve
        if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.03 && pts.length > 3) return "closed";
      }
    };
    // a lone short straight piece starts a chain only if a neighbour carries it on as a curve
    if (!isCurve(s)) {
      const probe = (tip, prev) => {
        let ok = false;
        idx.around(tip, 0.05, (k) => {
          if (k === s || ok) return;
          let far;
          if (Math.hypot(L[4 * k] - tip[0], L[4 * k + 1] - tip[1]) < 0.03) far = E(k, 1);
          else if (Math.hypot(L[4 * k + 2] - tip[0], L[4 * k + 3] - tip[1]) < 0.03) far = E(k, 0);
          else return;
          const t = Math.abs(turn(prev, tip, far)), lk = len(k);
          if (t >= 0.2 && t <= 25 && lk <= len(s) * 3 && lk >= len(s) / 3) ok = true;
        });
        return ok;
      };
      if (!probe(pts[1], pts[0]) && !probe(pts[0], pts[1])) return pts;
    }
    if (grow(true) === "closed") return pts;
    grow(false);
    return pts;
  }
  function previewLines() {
    const P = A.picked;
    if (!P.length && !A.ownStart) { S.draft = null; redraw(); return; }
    let pts = [], segs = [];
    if (P.length) { const c = chain(P.length >= 3); pts = c.pts; segs = c.segs; }
    S.draft = newDraft("area", pts.length > 1 ? pts : [A.ownStart || pts[0], A.ownStart || pts[0]]);
    S.draft.picking = segs.concat(A.ownStart ? [[A.ownStart[0] - 0.6, A.ownStart[1], A.ownStart[0] + 0.6, A.ownStart[1]], [A.ownStart[0], A.ownStart[1] - 0.6, A.ownStart[0], A.ownStart[1] + 0.6]] : []);
    redraw();
  }
  function snapAt(p) {
    const idx = snapLines();
    const r = idx && idx.snap(p, 10 / pxPerMM(), { anchor: A.ownStart || undefined, wide: 300 / pxPerMM() });
    return r ? r.p : p;
  }
  function pick(p, ev) {
    const own = A.ownStart || A.pickKind === "own" || (ev && (ev.ctrlKey || ev.metaKey));
    const P = A.picked;
    if (own) {
      const q = snapAt(p);
      if (!A.ownStart) {
        A.ownStart = q;
        if (!P.length) A.pickOp = opOf(ev);
        previewLines();
        status("Your own line: click its other end (ends and crossings of the drawing snap).");
        return;
      }
      const a = A.ownStart;
      A.ownStart = null;
      if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.2) { previewLines(); status("Too short - click two points apart."); return; }
      P.push({ Q: [a.slice(), q.slice()], at: [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2], own: true });
      afterPick();
      return;
    }
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const s = idx.nearestIndex(p, 8 / pxPerMM());
    if (s < 0) { status("No line there - click on a line of the area's edge, or Ctrl+click two points to draw one."); return; }
    const Q = shapeOf(idx, s);
    if (P.length >= 3 && (sameQ(Q, P[0].Q) || sameQ(Q, P[P.length - 1].Q))) { endPick(); return; }
    if (P.some((x) => sameQ(x.Q, Q))) { status("That line is picked already."); return; }
    if (!P.length) A.pickOp = opOf(ev);
    P.push({ Q, at: p });
    // a closed curve alone (a round column, a circular room): that is the area
    if (P.length === 1 && closedQ(Q)) { status("A closed curve - press Enter for its area, or pick on."); previewLines(); return; }
    afterPick();
  }
  function afterPick() {
    const P = A.picked;
    previewLines();
    const c = chain(P.length >= 3);
    const w = c.warn.filter((i) => i > 0 || P.length >= 3);
    const what = (i) => (P[i].Q.length > 2 ? "curve " : "line ") + (i + 1);
    if (w.length) {
      status(`${w.map((i) => `${what((i + P.length - 1) % P.length)} and ${what(i)}`).join(", ")} do not meet near the area - joined straight across. If that is wrong: Backspace, then Ctrl+click two points to draw the line yourself.`);
    } else {
      status(P.length < 3 ? `${P[P.length - 1].Q.length > 2 ? "Curve" : "Line"} ${P.length} picked - pick the next round the area (Ctrl+click two points draws a line).`
        : `${P.length} picked - pick the next, or click the first again (or Enter) to close.`);
    }
  }
  function endPick() {
    const P = A.picked;
    if (P.length < 3 && !(P.length === 1 && closedQ(P[0].Q))) { status("Pick at least three lines (or one closed curve)."); return; }
    const pts = tidy(chain(true).pts, 0.002);
    A.picked = []; A.ownStart = null;
    S.draft = null;
    if (pts && pts.length > 2 && polyArea(pts) > 0) {
      // a hole by its lines: its middle stands for it
      const mid = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
      place(pts, null, null, A.pickOp, mid);
    }
    redraw();
  }
  function cancelPick() {
    if (!A.picked.length && !A.ownStart) return false;
    A.picked = []; A.ownStart = null; S.draft = null; redraw(); status("Pick lines cancelled."); return true;
  }

  /* the pointer on the paper, with the Area tool in hand: true when taken */
  function click(p, ev) {
    if (!active()) return false;
    if (A.ignorePick && A.mode === "fill") { pickIgnore(p); return true; }
    if (A.mode === "fill") fill(p, ev);
    else pick(p, ev);
    return true;
  }
  function key(ev) {
    if (!active()) return false;
    if (ev.key === "Escape" && A.ignorePick) { A.ignorePick = ""; paintPanel(); status(""); return true; }
    if (A.mode !== "lines" || (!A.picked.length && !A.ownStart)) return false;
    if (ev.key === "Enter") { endPick(); return true; }
    if (ev.key === "Escape") return cancelPick();
    if (ev.key === "Backspace") {
      if (A.ownStart) A.ownStart = null; else A.picked.pop();
      previewLines();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------- the panel */
  function selectedArea() {
    if (!S.sel || S.sel.length !== 1) return null;
    const it = S.items.find((x) => x.id === S.sel[0]);
    return it && it.type === "area" ? it : null;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function ignoreHtml() {
    const v = ignored();
    const idx = snapLines();
    const byKey = new Map(((idx && idx.classes) || []).map((c) => [classKey(c), c]));
    const chips = v.c.map((k, i) => {
      const c = byKey.get(k);
      const [w, color, d] = k.split("|");
      const label = (color[0] === "f" ? "filled" : w + " mm") + (color.replace("f", "") !== "000000" ? " #" + color.replace("f", "") : "") + (d === "1" ? " dashed" : "") + (c ? ` (${c.n})` : "");
      return `<span class="ap-chip" title="Every line drawn like this is left out">${esc(label)}<button type="button" data-unc="${i}" title="Use them again">×</button></span>`;
    }).concat(v.l.length ? [`<span class="ap-chip">${v.l.length} line${v.l.length > 1 ? "s" : ""}<button type="button" data-unl title="Use them again">×</button></span>`] : []);
    return `<div class="rp-r"><span>Ignore a line:</span><button type="button" data-ig="one"${A.ignorePick === "one" ? ' class="on"' : ""} title="Then click the line to leave out">This line</button>`
      + `<button type="button" data-ig="class"${A.ignorePick === "class" ? ' class="on"' : ""} title="Then click a line: every line drawn like it (same weight, colour, dash) is left out - e.g. all dimension lines">All lines like it</button></div>`
      + (A.ignorePick ? `<div class="rp-note">Click the line to leave out${A.ignorePick === "class" ? " - every line drawn like it goes too" : ""}. Esc: never mind.</div>` : "")
      + (chips.length ? `<div class="rp-r ap-chips">${chips.join("")}</div>` : "");
  }

  function paintPanel() {
    const it = selectedArea();
    const on = S.tool === "area" || !!it;
    let p = A.panel;
    if (!on) {
      if (p) p.hidden = true;
      undock("area");
      if ((A.picked.length || A.ownStart) && S.tool !== "area") { A.picked = []; A.ownStart = null; if (S.draft && S.draft.picking) S.draft = null; }
      A.ignorePick = "";
      return;
    }
    if (!p) { p = A.panel = document.createElement("div"); p.id = "area-panel"; p.className = "rp-panel"; document.body.appendChild(p); }
    const D = { key: "area", label: "Area", sig: S.tool + "|" + (S.sel || []).join(","), repaint: paintPanel };
    if (!dock(p, D)) return;
    const loops = (it && it.loops_mm) || [];
    const adds = loops.filter((l) => !l.sub).length, holes = loops.filter((l) => l.sub).length;
    const sc = it ? (it.scale || scaleAt(it.points_mm[0])) : null;
    const m2 = it && sc ? net(it) * sc * sc / 1e6 : null;
    const model = hasCut && hasCut();
    const tip = { points: "Click the corners (they snap to the drawing), then double-click or Enter.",
      fill: "Click inside a room: its outline is found" + (hasRooms() ? " (on Revit plans, the room's own outline)" : "") + ". Shift+click another part to add it - it is merged in.",
      lines: "Click the lines round the area in turn - each is trimmed or extended to meet the next. No line there (a doorway)? Ctrl+click two points to draw one. Click the first line again or press Enter to close; Backspace takes the last back." }[A.mode];
    p.innerHTML = `<div class="rp-h"><b>${it ? "Area" : "New area"}</b>`
      + (it ? `<span class="rp-len">${m2 == null ? "set a scale" : m2.toFixed(2) + " m²"}</span>`
        + (it.room ? `<small>Room ${esc([it.room.number, it.room.name].filter(Boolean).join(" "))}${it.room.area_m2 ? ` - Revit: ${esc(it.room.area_m2)} m²` : ""}</small>` : "") : "")
      + `</div>`
      + (S.tool === "area"
        ? `<div class="rp-r rp-mode">${MODES.map(([v, l]) => `<label><input type="radio" name="ap-mode" value="${v}"${A.mode === v ? " checked" : ""}> ${l}</label>`).join("")}</div>`
          + (A.mode === "fill"
            ? (hasRooms() ? `<div class="rp-r"><label><input type="checkbox" data-k="rooms"${A.rooms ? " checked" : ""}> Use the Revit rooms where published</label></div>` : "")
              + (model ? `<div class="rp-r"><label title="Bounded by the model's own walls, doors, windows and columns at the plan's cut - no dimension, grid or text in the way"><input type="checkbox" data-k="model"${A.model ? " checked" : ""}> Use the Revit model's walls</label></div>` : "")
              + `<div class="rp-r"><label>Close openings up to <input data-k="gap_mm" type="number" min="0" step="100" value="${esc(A.gap_mm)}"> mm</label></div>`
              + `<div class="rp-r"><label title="Dimension lines, their tick marks and extension lines"><input type="checkbox" data-k="noDim"${A.noDim ? " checked" : ""}> Ignore dimensions</label>`
              + `<label><input type="checkbox" data-k="noDash"${A.noDash ? " checked" : ""}> Ignore dashed lines</label></div>`
              + `<div class="rp-r"><label title="A door closes the room at its leaf, as a wall does (the swing space stays in the room)"><input type="checkbox" data-k="doors"${A.doors ? " checked" : ""}> Doors close the room</label></div>`
              + ignoreHtml()
            : "")
          + (A.mode === "lines" ? `<div class="rp-r rp-mode"><span>Pick:</span>${[["line", "a line of the drawing"], ["own", "my own line (Ctrl)"]]
            .map(([v, l]) => `<label><input type="radio" name="ap-kind" value="${v}"${A.pickKind === v ? " checked" : ""}> ${l}</label>`).join("")}</div>` : "")
          + (A.mode !== "points" ? `<div class="rp-r rp-mode"><span>Next:</span>${[["new", "New area"], ["add", "Add (Shift)"], ["sub", "Cut hole (Alt)"]]
            .map(([v, l]) => `<label><input type="radio" name="ap-next" value="${v}"${A.next === v ? " checked" : ""}> ${l}</label>`).join("")}</div>` : "")
          + `<div class="rp-tip">${tip}</div>`
        : "")
      + (it ? `<div class="rp-r"><span>${1 + adds} region${adds ? "s" : ""}${holes ? `, ${holes} hole${holes > 1 ? "s" : ""}` : ""}</span>`
          + (loops.length ? `<button type="button" data-act="undo-region">Remove the last</button>` : "") + `</div>`
        + `<div class="rp-r"><label>Offset the edge <input data-k="off" type="number" step="50" min="0" placeholder="mm" value="${esc(A.off || "")}"> mm</label>`
          + `<button type="button" data-act="out" title="Move the edge outwards: e.g. from the inside face to the centre line or the outside face">Out</button>`
          + `<button type="button" data-act="in" title="Move the edge inwards">In</button></div>` : "");
    for (const el of p.querySelectorAll("[name=ap-mode]")) el.onchange = () => { A.mode = el.value; A.picked = []; A.ownStart = null; A.ignorePick = ""; S.draft = null; keep(); redraw(); paintPanel(); if (ctx.onMode) ctx.onMode(); };
    for (const el of p.querySelectorAll("[name=ap-next]")) el.onchange = () => { A.next = el.value; };
    for (const el of p.querySelectorAll("[name=ap-kind]")) el.onchange = () => { A.pickKind = el.value; };
    const g = p.querySelector("[data-k=gap_mm]");
    if (g) g.onchange = () => { A.gap_mm = Math.max(0, Number(g.value) || 0); keep(); };
    for (const k of ["rooms", "model", "noDash", "noDim", "doors"]) {
      const el = p.querySelector(`[data-k=${k}]`);
      if (el) el.onchange = () => { A[k] = el.checked; A.cache = null; keep(); };
    }
    for (const b of p.querySelectorAll("[data-ig]")) b.onclick = () => {
      A.ignorePick = A.ignorePick === b.dataset.ig ? "" : b.dataset.ig;
      paintPanel();
      if (A.ignorePick) status("Click the line to leave out.");
    };
    for (const b of p.querySelectorAll("[data-unc]")) b.onclick = () => { const v = ignored(); v.c.splice(+b.dataset.unc, 1); setIgnored(v); paintPanel(); };
    const unl = p.querySelector("[data-unl]");
    if (unl) unl.onclick = () => { const v = ignored(); v.l = []; setIgnored(v); paintPanel(); };
    const off = p.querySelector("[data-k=off]");
    if (off) off.oninput = () => { A.off = off.value; };
    const und = p.querySelector("[data-act=undo-region]");
    if (und) und.onclick = () => { remember([it.id]); it.loops_mm = (it.loops_mm || []).slice(0, -1); redraw(); persist([it.id]); paintPanel(); };
    for (const k of ["out", "in"]) {
      const b = p.querySelector(`[data-act=${k}]`);
      if (b) b.onclick = () => {
        const mm = Number(A.off);
        if (!(mm > 0)) { status("Type how far to move the edge, in mm (e.g. 100 for half a 200 mm wall)."); return; }
        if (!sc) { status("Set the drawing's scale first."); return; }
        const d = (k === "out" ? 1 : -1) * mm / sc;
        remember([it.id]);
        it.points_mm = offset(it.points_mm, d);
        // an added region moves out with it; a hole shrinks (its edge moves the other way)
        it.loops_mm = (it.loops_mm || []).map((l) => ({ pts: offset(l.pts, l.sub ? -d : d), sub: l.sub }));
        delete it.room;                       // no longer Revit's own outline
        redraw();
        persist([it.id]);
        paintPanel();
      };
    }
    finishDock(p, D);
  }

  /* Points I click (and polylines, polygons, clouds), ⌒ Curve: the curve of
     the drawing clicked, followed from the last point placed - from where
     that point sits on it (snapped there), else from the curve's nearer end
     - on through the click to the curve's end. The points along it, or null
     when no curve is there. */
  function followCurve(last, p) {
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return null; }
    const s = idx.nearestIndex(p, 8 / pxPerMM());
    if (s < 0) return null;
    const Q = shapeOf(idx, s);
    if (Q.length < 3) return null;                 // a straight line: just click its end
    const n = Q.length - 1;
    const uc = projU(Q, p);
    let u0;
    const ul = projU(Q, last), ql = ptAt(Q, ul);
    if (Math.hypot(ql[0] - last[0], ql[1] - last[1]) < 0.5) u0 = ul;        // the last point is on the curve
    else u0 = Math.hypot(Q[0][0] - last[0], Q[0][1] - last[1]) <= Math.hypot(Q[n][0] - last[0], Q[n][1] - last[1]) ? 0 : n;
    // a closed curve (a round column): all the way round, back to the start
    if (closedQ(Q)) {
      const way = cut(Q, u0, uc > u0 ? n : 0).concat(cut(Q, uc > u0 ? 0 : n, u0).slice(1));
      return way;
    }
    const u1 = uc >= u0 ? (u0 === n ? 0 : n) : (u0 === 0 ? n : 0);
    const out = cut(Q, u0, u1);
    // from the last point itself when it is not on the curve: a straight line to the curve first
    if (u0 === 0 || u0 === n) out.unshift(last.slice());
    return out;
  }

  return { click, key, paintPanel, cancelPick, active, followCurve, picking: () => A.picked.length > 0 };
}
