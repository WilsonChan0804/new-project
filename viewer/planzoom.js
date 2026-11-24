/* Zoom and pan for a plan drawn in an SVG box (the unit plan, the floor
 * plan): the drawing fits the box first (fitSC, fitOX, fitOY), then this
 * zoom about the box centre and the pan are applied. Wheel zooms about the
 * cursor; two pointers pinch (zoom about their middle, pan with it).
 */
export const ZMIN = 0.3, ZMAX = 12;
export function create() { return { z: 1, px: 0, py: 0, pts: new Map(), pinch: null }; }
export function reset(s) { s.z = 1; s.px = 0; s.py = 0; s.pinch = null; s.pts.clear(); }

/* the drawing's scale and offset after the zoom: a point p of the fitted
   drawing (sx = OX + x SC) goes to c + (p - c) z + pan, c the box centre */
export function apply(s, fitSC, fitOX, fitOY, bw, bh) {
  const cx = bw / 2, cy = bh / 2;
  return { SC: fitSC * s.z, OX: cx + (fitOX - cx) * s.z + s.px, OY: cy + (fitOY - cy) * s.z + s.py };
}
/* zoom by k keeping the box point (x, y) where it is */
export function zoomAt(s, k, x, y, bw, bh) {
  const z1 = Math.max(ZMIN, Math.min(ZMAX, s.z * k)), f = z1 / s.z;
  if (f === 1) return false;
  const cx = bw / 2, cy = bh / 2;
  // q = c + (p - c) z + pan; keep q(x, y): pan' = (x - c) - ((x - c) - pan) f
  s.px = (x - cx) - ((x - cx) - s.px) * f;
  s.py = (y - cy) - ((y - cy) - s.py) * f;
  s.z = z1;
  return true;
}
export function wheel(s, ev, box) {
  const k = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
  return zoomAt(s, k, ev.clientX - box.left, ev.clientY - box.top, box.width, box.height);
}
/* pointers: down / move / up; returns true while two pointers pinch */
export function down(s, ev) {
  s.pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (s.pts.size === 2) { const [a, b] = [...s.pts.values()]; s.pinch = { d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return true; }
  return false;
}
export function move(s, ev, box) {
  if (!s.pts.has(ev.pointerId)) return false;
  s.pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (!s.pinch || s.pts.size < 2) return false;
  const [a, b] = [...s.pts.values()], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  s.px += m[0] - s.pinch.m[0]; s.py += m[1] - s.pinch.m[1];
  zoomAt(s, d / s.pinch.d, m[0] - box.left, m[1] - box.top, box.width, box.height);
  s.pinch = { d, m };
  return true;
}
export function up(s, ev) { s.pts.delete(ev.pointerId); if (s.pts.size < 2) s.pinch = null; }

/* the zoom bar's markup: + / - / Fit / full plan */
export function bar(full) {
  return `<div class="pz-bar"><button type="button" data-pz="in" title="Zoom in">＋</button><button type="button" data-pz="out" title="Zoom out">−</button><button type="button" data-pz="fit" title="Fit the plan">Fit</button><button type="button" data-pz="full" class="${full ? "on" : ""}" title="${full ? "Show the panel again" : "The plan full screen"}">⤢</button></div>`;
}
/* a click on the zoom bar; returns true when handled */
export function barClick(s, btn, box, redraw) {
  const k = btn.dataset.pz;
  if (!k) return false;
  if (k === "in") zoomAt(s, 1.4, box.width / 2, box.height / 2, box.width, box.height);
  else if (k === "out") zoomAt(s, 1 / 1.4, box.width / 2, box.height / 2, box.width, box.height);
  else if (k === "fit") reset(s);
  else if (k === "full") { document.body.classList.toggle("st-planfull"); setTimeout(redraw, 30); return true; }
  redraw();
  return true;
}
