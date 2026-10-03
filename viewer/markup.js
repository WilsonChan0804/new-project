/* Markup engine shared by any backdrop - a PDF page, a 3D snapshot.
 *
 * Geometry is stored in BACKDROP coordinates (0..1 of width and height),
 * never in screen pixels. A snapshot taken at one window size and reviewed
 * at another still lines up, and the records survive a re-export at a
 * different resolution.
 *
 * The tool set deliberately matches the sheets page. Someone who has learnt
 * to redline a drawing should not have to learn a second, smaller set of
 * tools to redline a 3D view.
 */

import { smoothPath } from "./ink.js";

export const TOOLS = [
  { id: "select", label: "Select", kind: "pick" },
  { id: "rect", label: "Rect", kind: "drag2" },
  { id: "ellipse", label: "Circle", kind: "drag2" },
  { id: "line", label: "Line", kind: "drag2" },
  { id: "arrow", label: "Arrow", kind: "drag2" },
  { id: "cloud", label: "Cloud", kind: "drag2" },
  { id: "polyline", label: "Polyline", kind: "poly" },
  { id: "polygon", label: "Polygon", kind: "poly" },
  { id: "pen", label: "Pen", kind: "free" },
  { id: "text", label: "Text", kind: "click" },
  { id: "textbox", label: "Text box", kind: "drag2" },
  { id: "callout", label: "Callout", kind: "drag2" },
  { id: "eraser", label: "Eraser", kind: "erase" },
];

export const DEFAULT_STYLE = {
  color: "#ff3b30",
  fill: "#ff3b30",
  fillop: 0,
  width: 0.004,
  dash: "none",
  font: "Segoe UI",
  size: 0.035,
  align: "start",
};

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  }
  return n;
};

const toolOf = (id) => TOOLS.find((t) => t.id === id) || TOOLS[0];
const uid = () => Math.random().toString(36).slice(2, 10);

function dashArray(dash, lw) {
  const u = Math.max(1, lw);
  if (dash === "dash") return `${u * 4} ${u * 3}`;
  if (dash === "dot") return `${u} ${u * 2}`;
  if (dash === "dashdot") return `${u * 5} ${u * 2} ${u} ${u * 2}`;
  return null;
}

function cloudPath(pts, bump) {
  const r = Math.max(bump, 3);
  const d = [`M ${pts[0][0]} ${pts[0][1]}`];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.round(
      Math.hypot(b[0] - a[0], b[1] - a[1]) / (r * 2)));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      d.push(`A ${r} ${r} 0 0 1 ${a[0] + (b[0] - a[0]) * t} `
        + `${a[1] + (b[1] - a[1]) * t}`);
    }
  }
  return d.join(" ");
}

const corners = (a, b) => [a, [b[0], a[1]], b, [a[0], b[1]]];

const boxOf = (a, b) => ({
  x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
  width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]),
});

function putText(node, str, x, y, lh, align) {
  (str || "").split("\n").forEach((ln, i) => {
    const t = el("tspan", { x: x, dy: i === 0 ? 0 : lh });
    t.textContent = ln;
    node.appendChild(t);
  });
  node.setAttribute("text-anchor", align || "start");
}

/* Each shape is described once, then drawn twice: an invisible fat-stroked
   twin underneath for hit testing, and the real thing on top with pointer
   events off. Without the twin, selecting means clicking the exact pixel of
   a thin line. */
export function drawMarkup(svg, item, w, h) {
  const st = Object.assign({}, DEFAULT_STYLE, item.style || {});
  const P = item.points.map((p) => [p[0] * w, p[1] * h]);
  const lw = Math.max(1, st.width * Math.min(w, h));
  const hitW = Math.max(14, lw * 4);
  const fs = Math.max(10, st.size * Math.min(w, h));

  const stroke = {
    fill: "none", stroke: st.color, "stroke-width": lw,
    "stroke-linecap": "round", "stroke-linejoin": "round",
    "stroke-dasharray": dashArray(st.dash, lw),
  };
  if (st.op) stroke["stroke-opacity"] = st.op / 100;       // highlighter
  const filled = Object.assign({}, stroke, st.fillop > 0
    ? { fill: st.fill || st.color, "fill-opacity": st.fillop / 100 } : {});

  const specs = [];
  const add = (tag, attrs, hit) => specs.push({ tag, attrs, hit });

  if (item.type === "rect" && P.length > 1) {
    add("rect", Object.assign({}, filled, boxOf(P[0], P[1])), "stroke");

  } else if (item.type === "ellipse" && P.length > 1) {
    const b = boxOf(P[0], P[1]);
    add("ellipse", Object.assign({}, filled, {
      cx: b.x + b.width / 2, cy: b.y + b.height / 2,
      rx: b.width / 2, ry: b.height / 2 }), "stroke");

  } else if (item.type === "line" && P.length > 1) {
    add("line", Object.assign({}, stroke,
      { x1: P[0][0], y1: P[0][1], x2: P[1][0], y2: P[1][1] }), "stroke");

  } else if (item.type === "arrow" && P.length > 1) {
    const [a, b] = P;
    add("line", Object.assign({}, stroke,
      { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), "stroke");
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const hd = Math.max(8, lw * 4);
    add("path", Object.assign({}, stroke, {
      fill: st.color, "stroke-dasharray": null,
      d: `M ${b[0]} ${b[1]} L ${b[0] - hd * Math.cos(ang - .4)} `
       + `${b[1] - hd * Math.sin(ang - .4)} L ${b[0] - hd * Math.cos(ang + .4)} `
       + `${b[1] - hd * Math.sin(ang + .4)} Z` }), "all");

  } else if (item.type === "cloud" && P.length > 1) {
    add("path", Object.assign({}, filled,
      { d: cloudPath(corners(P[0], P[1]), Math.min(w, h) * 0.02) }), "stroke");

  } else if (item.type === "polygon" && P.length > 2) {
    add("polygon", Object.assign({}, filled,
      { points: P.map((p) => p.join(",")).join(" ") }), "stroke");

  } else if (item.type === "pen" && P.length > 1) {
    // freehand drawn as a smooth curve through its points, as on the sheets
    add("path", Object.assign({}, stroke, { d: smoothPath(P) }), "stroke");

  } else if (item.type === "polyline" && P.length > 1) {
    add("polyline", Object.assign({}, stroke,
      { points: P.map((p) => p.join(",")).join(" ") }), "stroke");
  }

  const g = el("g", { "data-id": item.id, class: "mk" });

  for (const sp of specs) {
    if (!sp.hit) continue;
    g.appendChild(el(sp.tag, Object.assign({}, sp.attrs, {
      stroke: "transparent", "stroke-width": hitW, "stroke-dasharray": null,
      fill: sp.hit === "all" ? "transparent" : "none",
      "fill-opacity": null, "pointer-events": sp.hit })));
  }
  for (const sp of specs) {
    g.appendChild(el(sp.tag,
      Object.assign({}, sp.attrs, { "pointer-events": "none" })));
  }

  /* Text-bearing shapes carry their own hit area - the box, or the glyphs -
     so the fat-stroke trick does not apply to them. */
  if (item.type === "text" && P.length) {
    const t = el("text", { x: P[0][0], y: P[0][1], fill: st.tcolor || st.color,
      "font-size": fs, "font-family": `"${st.font || "Segoe UI"}", "Segoe UI", Arial, "Microsoft JhengHei", sans-serif`, "pointer-events": "all" });
    putText(t, item.text, P[0][0], P[0][1], fs * 1.25, st.align);
    g.appendChild(t);

  } else if (item.type === "textbox" && P.length > 1) {
    const b = boxOf(P[0], P[1]);
    g.appendChild(el("rect", Object.assign({}, filled, b, {
      "pointer-events": "all",
      "fill-opacity": st.fillop > 0 ? st.fillop / 100 : 0.001 })));
    const tx = st.align === "start" ? b.x + 4
             : st.align === "end" ? b.x + b.width - 4 : b.x + b.width / 2;
    const t = el("text", { x: tx, y: b.y + fs, fill: st.tcolor || st.color,
      "font-size": fs, "font-family": `"${st.font || "Segoe UI"}", "Segoe UI", Arial, "Microsoft JhengHei", sans-serif`, "pointer-events": "none" });
    putText(t, item.text, tx, b.y + fs, fs * 1.25, st.align);
    g.appendChild(t);

  } else if (item.type === "callout" && P.length > 1) {
    /* The same callout as on the sheets page: arrow at the thing being
       pointed at, a knee, then a short level run into the label. Kept
       identical on purpose - a callout should not mean two different
       shapes depending on which half of the viewer drew it. Points:
       [target, knee, label]; a two-point callout from an older snapshot
       gets its knee worked out. */
    const target = P[0];
    const anchor = P[P.length - 1];
    const lines = (item.text || " ").split("\n");
    const cw = Math.max(...lines.map((s) => s.length), 3) * fs * 0.56 + 10;
    const ch = lines.length * fs * 1.25 + 8;
    const right = anchor[0] >= target[0];
    const b = { x: right ? anchor[0] : anchor[0] - cw,
                y: anchor[1] - ch / 2, width: cw, height: ch };
    const join = [right ? b.x : b.x + b.width, anchor[1]];
    const knee = P.length >= 3 ? P[1]
      : [join[0] + (right ? -1 : 1)
           * Math.min(40, Math.abs(join[0] - target[0]) * 0.35), join[1]];

    const pts = [target, knee, join].map((q) => q.join(",")).join(" ");
    g.appendChild(el("polyline", { points: pts, fill: "none",
      stroke: "transparent", "stroke-width": hitW, "pointer-events": "stroke" }));
    g.appendChild(el("polyline", Object.assign({}, stroke,
      { points: pts, fill: "none", "pointer-events": "none" })));

    const ang = Math.atan2(knee[1] - target[1], knee[0] - target[0]);
    const hd = Math.max(7, lw * 3.5);
    g.appendChild(el("path", Object.assign({}, stroke, {
      fill: st.color, "stroke-dasharray": null, "pointer-events": "none",
      d: `M ${target[0]} ${target[1]} `
       + `L ${target[0] + hd * Math.cos(ang - .38)} `
       + `${target[1] + hd * Math.sin(ang - .38)} `
       + `L ${target[0] + hd * Math.cos(ang + .38)} `
       + `${target[1] + hd * Math.sin(ang + .38)} Z` })));

    g.appendChild(el("rect", Object.assign({}, filled, b, {
      "pointer-events": "all",
      "fill-opacity": st.fillop > 0 ? st.fillop / 100 : 0.94,
      fill: st.fillop > 0 ? (st.fill || st.color) : "#ffffff" })));
    const tx = st.align === "start" ? b.x + 5
             : st.align === "end" ? b.x + b.width - 5 : b.x + b.width / 2;
    const t = el("text", { x: tx, y: b.y + fs + 2, fill: st.tcolor || st.color,
      "font-size": fs, "font-family": `"${st.font || "Segoe UI"}", "Segoe UI", Arial, "Microsoft JhengHei", sans-serif`, "pointer-events": "none" });
    putText(t, item.text, tx, b.y + fs + 2, fs * 1.25, st.align);
    g.appendChild(t);
  }

  svg.appendChild(g);
  return g;
}

export function redraw(svg, items, w, h, draft, selectedId) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  for (const it of items) drawMarkup(svg, it, w, h);
  if (draft) drawMarkup(svg, draft, w, h);

  // Selection outline and vertex handles, drawn last so they sit on top.
  const sel = items.find((x) => x.id === selectedId);
  if (!sel) return;
  const P = sel.points.map((p) => [p[0] * w, p[1] * h]);
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  svg.appendChild(el("rect", {
    class: "selbox", fill: "none", stroke: "#4c8dff",
    "stroke-width": 1, "stroke-dasharray": "4 3", "pointer-events": "none",
    x: Math.min(...xs) - 4, y: Math.min(...ys) - 4,
    width: Math.max(...xs) - Math.min(...xs) + 8,
    height: Math.max(...ys) - Math.min(...ys) + 8 }));
  P.forEach((p, i) => svg.appendChild(el("circle", {
    class: "handle", "data-h": i, cx: p[0], cy: p[1], r: 5,
    fill: "#fff", stroke: "#4c8dff", "stroke-width": 2 })));
}

/* Wire pointer events on an SVG so it produces markup records.
 *
 * opts: { getStyle, onChange, onText, onSelect } */
export function attach(svg, items, opts) {
  /* One controller per drawing surface. The editor is opened again for
     every snapshot on the SAME <svg>; the listeners of the time before
     stayed on it with their own tool and their own list, so the second
     time the tool buttons changed a controller that was no longer the one
     drawing ("cannot change tools after a polyline or a text"). */
  if (svg._lwkDetach) { try { svg._lwkDetach(); } catch (e) {} }
  const life = new AbortController();
  const sig = { signal: life.signal };
  const state = { tool: "select", draft: null, selected: null, poly: false };
  let mode = null, handle = -1, last = null;
  let rect = null;                 // measured once per stroke, not per sample
  let live = null, raf = 0, penSeen = false;

  const rel = (ev) => {
    const r = rect || svg.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  };
  const viewSize = () => {
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    return vb.length === 4 && vb[2] ? [vb[2], vb[3]] : [1, 1];
  };
  /* A freehand stroke is drawn live on its own path, updated once a frame,
     instead of redrawing every markup for each Pencil sample (240 a
     second) - which is what made the pen on a 3D snapshot lag behind. */
  const drawLive = () => {
    raf = 0;
    if (!live || !state.draft) return;
    const [w, h] = viewSize();
    live.setAttribute("d", smoothPath(state.draft.points.map((q) => [q[0] * w, q[1] * h])));
  };
  // iPad: the page's own long-press / selection gestures stay out of the way
  svg.style.touchAction = "none";
  svg.addEventListener("touchstart", (ev) => { ev.preventDefault(); }, { passive: false, signal: life.signal });
  const paint = () => opts.onChange && opts.onChange();

  const finishPoly = () => {
    if (!state.poly) return;
    const d = state.draft;
    state.poly = false;
    state.draft = null;
    if (d && d.points.length >= 2) {
      d.points.pop();              // drop the point that trails the cursor
      if (d.points.length >= 2) items.push(d);
    }
    paint();
  };

  svg.addEventListener("dblclick", (ev) => {
    if (state.poly) { ev.preventDefault(); finishPoly(); }
  }, sig);

  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    /* Shift turns any tool into Select for one gesture, as on the sheets
       page: reaching back to the toolbar to nudge the last callout, then
       back again to keep drawing, is the interruption this removes. */
    const t = ev.shiftKey ? toolOf("select") : toolOf(state.tool);
    if (ev.pointerType === "pen") penSeen = true;
    // palm rejection: once a Pencil is used, a finger does not draw
    if (penSeen && ev.pointerType === "touch" && t.kind !== "pick") return;
    rect = svg.getBoundingClientRect();
    const p = rel(ev);

    if (t.kind === "erase") {
      const g = ev.target.closest && ev.target.closest(".mk");
      if (g) {
        const i = items.findIndex((x) => x.id === g.dataset.id);
        if (i >= 0) { items.splice(i, 1); state.selected = null; paint(); }
      }
      return;
    }

    if (t.kind === "pick") {
      if (state.poly) return;          // never break into a polyline run
      const hnd = ev.target.closest && ev.target.closest(".handle");
      if (hnd) {
        mode = "handle"; handle = +hnd.dataset.h; last = p;
        try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }
      const g = ev.target.closest && ev.target.closest(".mk");
      state.selected = g ? g.dataset.id : null;
      if (opts.onSelect) opts.onSelect(state.selected);
      if (g) {
        mode = "move"; last = p;
        try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      paint();
      return;
    }

    ev.preventDefault();

    if (t.kind === "poly") {
      if (!state.poly) {
        state.poly = true;
        state.draft = { id: uid(), type: state.tool, points: [p, p],
                        style: opts.getStyle(), text: "" };
      } else {
        state.draft.points.push(p);
      }
      paint();
      return;
    }

    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}

    if (t.kind === "click") {
      const mk = { id: uid(), type: state.tool, points: [p],
                   style: opts.getStyle(), text: "" };
      Promise.resolve(opts.onText ? opts.onText() : "").then((txt) => {
        if (txt === null || txt === undefined || txt === "") return;
        mk.text = txt;
        items.push(mk);
        paint();
      });
      return;
    }

    mode = "draw";
    state.draft = { id: uid(), type: state.tool,
                    points: t.kind === "free" ? [p] : [p, p],
                    style: opts.getStyle(), text: "" };
    if (t.kind === "free") {
      const st = Object.assign({}, DEFAULT_STYLE, state.draft.style || {});
      const [w, h] = viewSize();
      live = el("path", { fill: "none", stroke: st.color,
        "stroke-width": Math.max(1, st.width * Math.min(w, h)),
        "stroke-opacity": st.op ? st.op / 100 : 1,
        "stroke-linecap": "round", "stroke-linejoin": "round", "pointer-events": "none" });
      svg.appendChild(live);
      return;
    }
    paint();
  }, sig);

  svg.addEventListener("pointermove", (ev) => {
    const p = rel(ev);

    if (state.poly && state.draft) {
      state.draft.points[state.draft.points.length - 1] = p;
      paint();
      return;
    }
    if (!mode) return;

    if (mode === "draw") {
      if (toolOf(state.tool).kind === "free") {
        const evs = (ev.getCoalescedEvents && ev.getCoalescedEvents().length)
          ? ev.getCoalescedEvents() : [ev];
        const pts = state.draft.points;
        for (const e of evs) {
          const q = rel(e), l = pts[pts.length - 1];
          if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.0008) pts.push(q);
        }
        if (!raf) raf = requestAnimationFrame(drawLive);
        return;
      }
      state.draft.points[1] = p;
      paint();
    } else if (mode === "move") {
      const it = items.find((x) => x.id === state.selected);
      if (it) {
        const dx = p[0] - last[0], dy = p[1] - last[1];
        it.points = it.points.map((q) => [q[0] + dx, q[1] + dy]);
        last = p;
        paint();
      }
    } else if (mode === "handle") {
      const it = items.find((x) => x.id === state.selected);
      if (it && it.points[handle]) { it.points[handle] = p; paint(); }
    }
  }, sig);

  svg.addEventListener("pointerup", (ev) => {
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    rect = null;
    if (live) { live.remove(); live = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }

    if (mode === "draw" && state.draft) {
      const a = state.draft.points[0];
      const b = state.draft.points[state.draft.points.length - 1];
      const needsText =
        ["textbox", "callout"].indexOf(state.draft.type) >= 0;

      // A stray click is not a markup.
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 0.004) {
        state.draft = null;
      } else if (needsText) {
        const mk = state.draft;
        if (mk.type === "callout" && mk.points.length === 2) {
          const [t0, a0] = mk.points;
          mk.points = [t0, [a0[0] + (t0[0] - a0[0]) * 0.35, a0[1]], a0];
        }
        state.draft = null;
        Promise.resolve(opts.onText ? opts.onText() : "").then((txt) => {
          if (txt === null || txt === undefined) return;
          mk.text = txt;
          items.push(mk);
          paint();
        });
      } else {
        items.push(state.draft);
        state.draft = null;
      }
      paint();
    }
    mode = null;
    handle = -1;
  }, sig);

  const detach = () => {
    life.abort();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (live) { live.remove(); live = null; }
    state.draft = null; state.poly = false;
    if (svg._lwkDetach === detach) svg._lwkDetach = null;
  };
  svg._lwkDetach = detach;

  return {
    detach,
    setTool: (id) => {
      finishPoly();
      state.tool = id;
      if (id !== "select") { state.selected = null; paint(); }
    },
    getTool: () => state.tool,
    getDraft: () => state.draft,
    selectedId: () => state.selected,
    selected: () => items.find((x) => x.id === state.selected) || null,
    deleteSelected: () => {
      const i = items.findIndex((x) => x.id === state.selected);
      if (i >= 0) { items.splice(i, 1); state.selected = null; paint(); }
    },
    /* Restyling the selection is what makes the style controls feel like
       they belong to the drawing rather than only to the next stroke. */
    applyStyle: (style) => {
      const it = items.find((x) => x.id === state.selected);
      if (it) { it.style = Object.assign({}, style); paint(); }
    },
    cancel: () => {
      finishPoly();
      state.draft = null;
      state.selected = null;
      paint();
    },
  };
}
