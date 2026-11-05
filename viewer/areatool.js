/* The Area tool's ways of making an area (areafill.js does the geometry):
 *
 *   Points I click  as before: click the corners (with snapping).
 *   Click inside    one click in a room: on a Revit plan published with
 *                   its rooms, that room's own outline (and holes); on any
 *                   other drawing, the closed outline round the click from
 *                   the drawing's lines, doorways closed up to the gap set.
 *   Pick lines      click the lines round the area in turn; each is trimmed
 *                   or extended to meet the next. Click the first line
 *                   again (or Enter) to close it.
 *
 * A region can be added to an area, or cut out of it as a hole: Shift+click
 * adds, Alt+click cuts (or choose it under "Next click"). An area keeps its
 * outline in points_mm (edited as before) and the extra regions in
 * loops_mm [{pts, sub}]; its label is the net area.
 *
 * With an area chosen, Offset moves its edge out or in by a wall thickness:
 * to the inside face, the centre line or the outside face.
 */
import { fillAt, fromLines, offset, net } from "./areafill.js";

const KEEP = "lwk-sheets:areatool";
const MODES = [["points", "Points I click"], ["fill", "Click inside"], ["lines", "Pick lines"]];

export function createAreaTool(ctx) {
  const { S, status, redraw, persist, remember, snapLines, pxPerMM, activeScale, roomAt, hasRooms, finish, newDraft } = ctx;
  const A = { mode: "points", gap_mm: 1200, rooms: true, next: "new", picked: [], pickOp: "new", panel: null, lastId: "" };
  try { Object.assign(A, JSON.parse(localStorage.getItem(KEEP) || "{}"), { picked: [] }); } catch (e) {}
  const keep = () => { try { localStorage.setItem(KEEP, JSON.stringify({ mode: A.mode, gap_mm: A.gap_mm, rooms: A.rooms })); } catch (e) {} };

  const active = () => S.tool === "area" && A.mode !== "points";
  const opOf = (ev) => (ev && ev.shiftKey ? "add" : ev && ev.altKey ? "sub" : A.next);
  const scaleAt = (p) => { const s = activeScale(p, null); return s ? s.scale : null; };

  /* The area an added region or a hole goes to: the one chosen, else the last made here */
  function target() {
    if (S.sel && S.sel.length === 1) {
      const it = S.items.find((x) => x.id === S.sel[0]);
      if (it && it.type === "area") return it;
    }
    const it = S.items.find((x) => x.id === A.lastId && x.sheet === (S.sheet && S.sheet.number));
    return it && it.type === "area" ? it : null;
  }

  /* A region made: a new area, or added to / cut out of the target */
  const inPoly = (P, L) => {
    let c = false;
    for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const a = L[i], b = L[j];
      if ((a[1] > P[1]) !== (b[1] > P[1]) && P[0] < (b[0] - a[0]) * (P[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
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
    t.loops_mm = (t.loops_mm || []).concat([{ pts, sub }], (holes || []).map((h) => ({ pts: h, sub: !sub })));
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
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const sc = scaleAt(p);
    const gap = A.gap_mm > 0 ? (sc ? A.gap_mm / sc : 12) : 0;
    status("Finding the outline ...");
    const r = fillAt(idx.lines, p, { gap, page: S.pageMM });
    if (!r.pts) {
      status({
        open: "No closed outline round that point - the lines leave a gap wider than the gap set" + (A.gap_mm ? ` (${A.gap_mm} mm)` : "") + ". Raise it, or use Pick lines.",
        "on-line": "That point is on a line - click inside the area.",
        small: "The outline round that point is too small - click inside the area.",
        outside: "Click on the drawing.",
      }[r.error] || "No outline found.");
      return;
    }
    place(r.pts, null, null, op, p);
    status(`Outline found (${r.pts.length} corners). Drag a corner to adjust; Shift+click adds another region, Alt+click cuts a hole.`);
  }

  /* -------------------------------------------------------- pick lines */
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) < 1e-6;
  function previewLines() {
    const P = A.picked;
    if (!P.length) { S.draft = null; redraw(); return; }
    const pts = P.length >= 3 ? fromLines(P) : P.flatMap((l) => [[l[0], l[1]], [l[2], l[3]]]);
    S.draft = newDraft("area", pts || []);
    S.draft.picking = P.map((l) => l.slice());
    redraw();
  }
  function pick(p, ev) {
    const idx = snapLines();
    if (!idx) { status("Reading this drawing's lines ... click again in a moment."); return; }
    const l = idx.nearest(p, 8 / pxPerMM());
    if (!l) { status("No line there - click on a line of the area's edge."); return; }
    const P = A.picked;
    if (P.length >= 3 && (same(l, P[0]) || same(l, P[P.length - 1]))) { endPick(); return; }
    if (P.some((x) => same(x, l))) { status("That line is picked already."); return; }
    if (!P.length) { A.pickOp = opOf(ev); A.pickAt = p; }
    P.push(l);
    previewLines();
    status(P.length < 3 ? `Line ${P.length} picked - pick the next line round the area.`
      : `${P.length} lines - pick the next, or click the first line again (or Enter) to close.`);
  }
  function endPick() {
    const P = A.picked;
    if (P.length < 3) { status("Pick at least three lines."); return; }
    const pts = fromLines(P);
    A.picked = [];
    S.draft = null;
    if (pts) {
      // a hole by its lines: its middle stands for it
      const mid = [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
      place(pts, null, null, A.pickOp, mid);
    }
    redraw();
  }
  function cancelPick() { if (!A.picked.length) return false; A.picked = []; S.draft = null; redraw(); status("Pick lines cancelled."); return true; }

  /* the pointer on the paper, with the Area tool in hand: true when taken */
  function click(p, ev) {
    if (!active()) return false;
    if (A.mode === "fill") fill(p, ev);
    else pick(p, ev);
    return true;
  }
  function key(ev) {
    if (!active() || A.mode !== "lines" || !A.picked.length) return false;
    if (ev.key === "Enter") { endPick(); return true; }
    if (ev.key === "Escape") return cancelPick();
    if (ev.key === "Backspace") { A.picked.pop(); previewLines(); return true; }
    return false;
  }

  /* ------------------------------------------------------- the panel */
  function selectedArea() {
    if (!S.sel || S.sel.length !== 1) return null;
    const it = S.items.find((x) => x.id === S.sel[0]);
    return it && it.type === "area" ? it : null;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function paintPanel() {
    const it = selectedArea();
    const on = S.tool === "area" || !!it;
    let p = A.panel;
    if (!on) { if (p) p.hidden = true; if (A.picked.length && S.tool !== "area") A.picked = []; return; }
    if (!p) { p = A.panel = document.createElement("div"); p.id = "area-panel"; p.className = "rp-panel"; document.body.appendChild(p); }
    p.hidden = false;
    const loops = (it && it.loops_mm) || [];
    const adds = loops.filter((l) => !l.sub).length, holes = loops.filter((l) => l.sub).length;
    const sc = it ? (it.scale || scaleAt(it.points_mm[0])) : null;
    const m2 = it && sc ? net(it) * sc * sc / 1e6 : null;
    const tip = { points: "Click the corners (they snap to the drawing), then double-click or Enter.",
      fill: "Click inside a room: its outline is found from the drawing" + (hasRooms() ? " (on Revit plans, the room's own outline)" : "") + ".",
      lines: "Click the lines round the area in turn - each is trimmed or extended to meet the next. Click the first line again or press Enter to close; Backspace undoes a pick." }[A.mode];
    p.innerHTML = `<div class="rp-h"><b>${it ? "Area" : "New area"}</b>`
      + (it ? `<span class="rp-len">${m2 == null ? "set a scale" : m2.toFixed(2) + " m²"}</span>`
        + (it.room ? `<small>Room ${esc([it.room.number, it.room.name].filter(Boolean).join(" "))}${it.room.area_m2 ? ` - Revit: ${esc(it.room.area_m2)} m²` : ""}</small>` : "") : "")
      + `</div>`
      + (S.tool === "area"
        ? `<div class="rp-r rp-mode">${MODES.map(([v, l]) => `<label><input type="radio" name="ap-mode" value="${v}"${A.mode === v ? " checked" : ""}> ${l}</label>`).join("")}</div>`
          + (A.mode === "fill" ? `<div class="rp-r"><label>Close gaps up to <input data-k="gap_mm" type="number" min="0" step="100" value="${esc(A.gap_mm)}"> mm</label></div>`
            + (hasRooms() ? `<div class="rp-r"><label><input type="checkbox" data-k="rooms"${A.rooms ? " checked" : ""}> Use the Revit rooms where published</label></div>` : "") : "")
          + (A.mode !== "points" ? `<div class="rp-r rp-mode"><span>Next:</span>${[["new", "New area"], ["add", "Add (Shift)"], ["sub", "Cut hole (Alt)"]]
            .map(([v, l]) => `<label><input type="radio" name="ap-next" value="${v}"${A.next === v ? " checked" : ""}> ${l}</label>`).join("")}</div>` : "")
          + `<div class="rp-tip">${tip}</div>`
        : "")
      + (it ? `<div class="rp-r"><span>${1 + adds} region${adds ? "s" : ""}${holes ? `, ${holes} hole${holes > 1 ? "s" : ""}` : ""}</span>`
          + (loops.length ? `<button type="button" data-act="undo-region">Remove the last</button>` : "") + `</div>`
        + `<div class="rp-r"><label>Offset the edge <input data-k="off" type="number" step="50" min="0" placeholder="mm" value="${esc(A.off || "")}"> mm</label>`
          + `<button type="button" data-act="out" title="Move the edge outwards: e.g. from the inside face to the centre line or the outside face">Out</button>`
          + `<button type="button" data-act="in" title="Move the edge inwards">In</button></div>` : "");
    for (const el of p.querySelectorAll("[name=ap-mode]")) el.onchange = () => { A.mode = el.value; A.picked = []; S.draft = null; keep(); redraw(); paintPanel(); };
    for (const el of p.querySelectorAll("[name=ap-next]")) el.onchange = () => { A.next = el.value; };
    const g = p.querySelector("[data-k=gap_mm]");
    if (g) g.onchange = () => { A.gap_mm = Math.max(0, Number(g.value) || 0); keep(); };
    const rm = p.querySelector("[data-k=rooms]");
    if (rm) rm.onchange = () => { A.rooms = rm.checked; keep(); };
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
