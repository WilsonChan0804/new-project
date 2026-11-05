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
import { fillAt, offset, net, unite, meet, tidy, area as polyArea } from "./areafill.js";

const KEEP = "lwk-sheets:areatool";
const IGNORE = "lwk-sheets:area-ignore:";
const MODES = [["points", "Points I click"], ["fill", "Click inside"], ["lines", "Pick lines"]];
// what of the Revit model bounds a room (planroute.py categories)
const MODEL_CATS = ["Walls", "Doors", "Windows", "Columns", "Structural Columns", "Curtain Panels", "Curtain Mullions"];

export function createAreaTool(ctx) {
  const { S, status, redraw, persist, remember, snapLines, pxPerMM, activeScale, roomAt, hasRooms, cutAt, hasCut, finish, newDraft } = ctx;
  const A = { mode: "points", gap_mm: 1200, rooms: true, model: true, noDash: true, noSwing: true, next: "new",
    pickKind: "line", picked: [], pickOp: "new", panel: null, lastId: "", ignorePick: "", ownStart: null, cache: null };
  try { Object.assign(A, JSON.parse(localStorage.getItem(KEEP) || "{}"), { picked: [], ignorePick: "", ownStart: null, cache: null }); } catch (e) {}
  const keep = () => { try { localStorage.setItem(KEEP, JSON.stringify({ mode: A.mode, gap_mm: A.gap_mm, rooms: A.rooms, model: A.model, noDash: A.noDash, noSwing: A.noSwing })); } catch (e) {} };

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

  /* Door swings: arcs of a door's width (0.45 - 1.6 m) through about a quarter turn */
  function swings(idx, sc) {
    const C = idx.curves || [], n = C.length / 6, out = new Uint8Array(Math.max(1, n));
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
      if (deg >= 55 && deg <= 100) out[i] = 1;
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
    const sig = [idx.count, sc, A.noDash, A.noSwing, ig.c.join(";"), ig.l.length, ig.l.slice(-3).join(";")].join("#");
    if (A.cache && A.cache.idx === idx && A.cache.sig === sig) return { L: A.cache.L, from: "drawing", left: A.cache.left };
    const L = idx.lines, n = L.length / 4;
    const igc = new Set(ig.c), igl = new Set(ig.l);
    const cls = idx.cls, classes = idx.classes || [];
    const off = classes.map((c) => igc.has(classKey(c)) || (A.noDash && c.dash));
    const sw = A.noSwing && idx.curve ? swings(idx, sc) : null;
    const keepL = [];
    let left = 0;
    for (let s = 0; s < n; s++) {
      if ((cls && off[cls[s]]) || (sw && idx.curve[s] && sw[idx.curve[s]]) || (igl.size && igl.has(lineKey(L, s)))) { left++; continue; }
      keepL.push(L[4 * s], L[4 * s + 1], L[4 * s + 2], L[4 * s + 3]);
    }
    A.cache = { idx, sig, L: Float64Array.from(keepL), left };
    return { L: A.cache.L, from: "drawing", left };
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
    status(`Outline found (${r.pts.length} corners${B.from === "model" ? ", bounded by the Revit model's walls" : ""}). `
      + (B.from === "model" ? "" : "Cut short by a dimension or other line? Ignore a line (panel), then click again. ")
      + "Shift+click adds a region (merged), Alt+click cuts a hole.");
  }

  /* -------------------------------------------------------- pick lines */
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) < 1e-6;
  const proj = (l, p) => {
    const dx = l[2] - l[0], dy = l[3] - l[1], q = (dx * dx + dy * dy) || 1;
    const t = ((p[0] - l[0]) * dx + (p[1] - l[1]) * dy) / q;
    return [l[0] + t * dx, l[1] + t * dy];
  };
  const segDist = (p, l) => {
    const dx = l[2] - l[0], dy = l[3] - l[1], q = (dx * dx + dy * dy) || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - l[0]) * dx + (p[1] - l[1]) * dy) / q));
    return Math.hypot(p[0] - l[0] - t * dx, p[1] - l[1] - t * dy);
  };
  /* where two picks in a row meet: their crossing, unless they never meet
     near the lines (parallel, or the crossing far off): then null */
  function corner(a, b) {
    const q = meet([a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]);
    if (!q) return null;                       // parallel (inLine tells whether that is fine)
    const far = Math.max(unitAt(q) * 4, 0.5 * Math.max(Math.hypot(a[2] - a[0], a[3] - a[1]), Math.hypot(b[2] - b[0], b[3] - b[1])));
    return Math.min(segDist(q, a), segDist(q, b)) > far ? null : q;
  }
  /* The picks as a chain: where each meets the next (trimmed or extended),
     and the part of each line between its two corners. closed: the last
     meets the first. Two picks that never meet near the lines are joined
     straight across, end to end (warn: which). */
  function chain(closed) {
    const P = A.picked, n = P.length, warn = [];
    const C = new Array(n).fill(null);          // C[i]: the corner between pick i-1 and pick i
    for (let i = closed ? 0 : 1; i < n; i++) {
      const a = P[(i + n - 1) % n].l, b = P[i].l;
      C[i] = corner(a, b);
      // two pieces of one line (either side of a doorway) join straight across: that is right, no warning
      if (!C[i] && !inLine(a, b)) warn.push(i);
    }
    const startOf = (i) => C[i] || (!closed && i === 0 ? proj(P[0].l, P[0].at) : nearerEnd(P[i].l, P[(i + n - 1) % n].l));
    const endOf = (i) => {
      const k = (i + 1) % n;
      if (!closed && i === n - 1) return proj(P[i].l, P[i].at);
      return C[k] || nearerEnd(P[i].l, P[k].l);
    };
    const pts = [], segs = [];
    for (let i = 0; i < n; i++) {
      const a = startOf(i), b = endOf(i);
      // a corner shared with the line before is already in; a straight join adds both ends
      if (!(C[i] && pts.length && pts[pts.length - 1] === C[i])) pts.push(a);
      pts.push(b);
      segs.push([a[0], a[1], b[0], b[1]]);
    }
    // closed: the last end is the first corner again
    if (closed && pts.length > 2) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop();
    }
    return { pts, segs, warn };
  }
  /* parallel and on one line (a wall face broken by an opening) */
  function inLine(a, b) {
    const L = Math.hypot(a[2] - a[0], a[3] - a[1]) || 1;
    const off = (x, y) => Math.abs((a[2] - a[0]) * (a[1] - y) - (a[0] - x) * (a[3] - a[1])) / L;
    const tol = Math.max(0.05, unitAt([a[0], a[1]]) * 0.01);
    return off(b[0], b[1]) < tol && off(b[2], b[3]) < tol;
  }
  function nearerEnd(l, o) {
    const e = [[l[0], l[1]], [l[2], l[3]]];
    return segDist(e[0], o) <= segDist(e[1], o) ? e[0] : e[1];
  }
  function previewLines() {
    const P = A.picked;
    if (!P.length && !A.ownStart) { S.draft = null; redraw(); return; }
    let pts, segs;
    if (P.length >= 3) { const c = chain(true); pts = c.pts; segs = c.segs; }
    else if (P.length) { const c = chain(false); pts = c.pts; segs = c.segs; }
    else { pts = []; segs = []; }
    S.draft = newDraft("area", pts.length ? pts : [A.ownStart, A.ownStart]);
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
      P.push({ l: [a[0], a[1], q[0], q[1]], at: [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2], own: true });
      afterPick();
      return;
    }
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const l = idx.nearest(p, 8 / pxPerMM());
    if (!l) { status("No line there - click on a line of the area's edge, or Ctrl+click two points to draw one."); return; }
    if (P.length >= 3 && (same(l, P[0].l) || same(l, P[P.length - 1].l))) { endPick(); return; }
    if (P.some((x) => same(x.l, l))) { status("That line is picked already."); return; }
    if (!P.length) A.pickOp = opOf(ev);
    P.push({ l, at: p });
    afterPick();
  }
  function afterPick() {
    const P = A.picked;
    previewLines();
    const c = chain(P.length >= 3);
    const w = c.warn.filter((i) => i > 0 || P.length >= 3);
    if (w.length) {
      status(`Lines ${w.map((i) => `${i === 0 ? P.length : i} and ${i + 1}`).join(", ")} do not meet near the area - joined straight across. If that is wrong: Backspace, then Ctrl+click two points to draw the line yourself.`);
    } else {
      status(P.length < 3 ? `Line ${P.length} picked - pick the next line round the area (Ctrl+click two points draws one).`
        : `${P.length} lines - pick the next, or click the first line again (or Enter) to close.`);
    }
  }
  function endPick() {
    const P = A.picked;
    if (P.length < 3) { status("Pick at least three lines."); return; }
    const pts = tidy(chain(true).pts);
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
      if ((A.picked.length || A.ownStart) && S.tool !== "area") { A.picked = []; A.ownStart = null; if (S.draft && S.draft.picking) S.draft = null; }
      A.ignorePick = "";
      return;
    }
    if (!p) { p = A.panel = document.createElement("div"); p.id = "area-panel"; p.className = "rp-panel"; document.body.appendChild(p); }
    p.hidden = false;
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
              + `<div class="rp-r"><label><input type="checkbox" data-k="noDash"${A.noDash ? " checked" : ""}> Ignore dashed lines</label>`
              + `<label><input type="checkbox" data-k="noSwing"${A.noSwing ? " checked" : ""}> Ignore door swings</label></div>`
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
    for (const el of p.querySelectorAll("[name=ap-mode]")) el.onchange = () => { A.mode = el.value; A.picked = []; A.ownStart = null; A.ignorePick = ""; S.draft = null; keep(); redraw(); paintPanel(); };
    for (const el of p.querySelectorAll("[name=ap-next]")) el.onchange = () => { A.next = el.value; };
    for (const el of p.querySelectorAll("[name=ap-kind]")) el.onchange = () => { A.pickKind = el.value; };
    const g = p.querySelector("[data-k=gap_mm]");
    if (g) g.onchange = () => { A.gap_mm = Math.max(0, Number(g.value) || 0); keep(); };
    for (const k of ["rooms", "model", "noDash", "noSwing"]) {
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
  }

  return { click, key, paintPanel, cancelPick, active, picking: () => A.picked.length > 0 };
}
