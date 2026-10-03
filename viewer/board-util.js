/* Small things the board's modules share: escaping, ids, colours, icons
 * and the geometry of connectors.
 *
 * Nothing here touches the page or the network.
 */

export const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Object ids are made in the browser, so an object exists (and can be
   connected to, undone, edited) before the server has heard of it. */
export function uid(prefix) {
  const a = new Uint8Array(9);
  (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a)
    : a.forEach((_, i) => { a[i] = Math.random() * 256; });
  return (prefix || "o") + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round1 = (v) => Math.round(v * 10) / 10;

/* A colour that came from the server is another person's input. Only a
   plain hex colour is ever put into a style, so a stored "url(...)" or
   anything cleverer never reaches the page. */
export function col(v, fallback) {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v
    : v === "none" ? "transparent" : (fallback === undefined ? "transparent" : fallback);
}

export const STICKY_COLORS = ["#fff3a3", "#ffd6a5", "#ffc2c2", "#f7c6e8", "#d9c8ff",
                              "#bfd9ff", "#b5ecf2", "#c3efc0", "#e6efae", "#ffffff", "#e5e7eb", "#2b303b"];
export const INK_COLORS = ["#1f2430", "#6b7480", "#e2453c", "#f28022", "#e8a13a", "#0e9f6e",
                           "#0ea5b7", "#3b82f6", "#7c3aed", "#d6409f", "#ffffff"];
export const SHAPE_FILLS = ["#ffffff", "#ffeedd", "#fff3a3", "#ffc2c2", "#d9c8ff", "#bfd9ff",
                            "#b5ecf2", "#c3efc0", "#e5e7eb", "#f28022", "#3b82f6", "#1f2430", "none"];
/* One colour per main branch of a mind map, in order. */
export const BRANCH_COLORS = ["#f28022", "#3b82f6", "#0e9f6e", "#d6409f", "#7c3aed", "#0ea5b7", "#e8a13a", "#e2453c"];
export const PERSON_COLORS = ["#3b82f6", "#0e9f6e", "#d6409f", "#7c3aed", "#0ea5b7", "#e2453c", "#b7791f", "#4b5563"];

/* Is this background dark enough that the text on it should be white? */
export function isDark(hex) {
  const m = /^#([0-9a-f]{6})/i.exec(hex || "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 120;
}

/* The same person gets the same colour on every screen. */
export function personColor(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

export function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function ago(iso, now) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const s = Math.max(0, ((now || Date.now()) - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  if (s < 86400 * 14) return Math.round(s / 86400) + " d ago";
  return new Date(t).toLocaleDateString();
}

/* ---------------------------------------------------------------- icons */

/* 24x24, stroke-based, like icons.js - drawn here rather than imported so
   the board's own tools (sticky, frame, mind map ...) sit in one place. */
const ICONS = {
  select: "M5 3l14 8-6 1.5L9.5 19z",
  hand: "M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v4a6 6 0 01-6 6h-1.5a5 5 0 01-4-2L6 14.5a1.5 1.5 0 012-2.2L9.5 14",
  sticky: "M5 4h14v10l-5 5H5zM14 19v-5h5",
  text: "M6 6h12M12 6v12M9 18h6",
  shape: "M4 5h9v9H4zM16.5 20a4.5 4.5 0 100-9 4.5 4.5 0 000 9z",
  rect: "M4 6h16v12H4z",
  round: "M8 6h8a4 4 0 014 4v4a4 4 0 01-4 4H8a4 4 0 01-4-4v-4a4 4 0 014-4z",
  ellipse: "M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z",
  diamond: "M12 4l8 8-8 8-8-8z",
  conn: "M5 18L19 6M19 6h-6M19 6v6",
  mind: "M10 12h4M14 12c2 0 2-6 6-6M14 12c2 0 2 6 6 6M4 9.5h6v5H4z",
  pen: "M4 20s2-6 6-10 8-5 8-5-1 4-5 8-9 7-9 7z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  undo: "M9 7L4 12l5 5M4 12h10a5 5 0 010 10h-2",
  redo: "M15 7l5 5-5 5M20 12H10a5 5 0 000 10h2",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  copy: "M8 8h11v12H8zM5 16V4h11",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z",
  unlock: "M7 11V8a5 5 0 019.6-2M5 11h14v9H5z",
  front: "M9 9h11v11H9zM4 4h11v2M4 4v11h2",
  back: "M4 4h11v11H4zM9 20h11V9h-2M9 20v-2",
  bold: "M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z",
  alignl: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignc: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignr: "M4 6h16M10 10h10M4 14h16M10 18h10",
  comment: "M4 5h16v11H10l-4 4v-4H4z",
  smile: "M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 14.5a4.5 4.5 0 007 0M9 10h.01M15 10h.01",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  play: "M7 4l13 8-13 8z",
  timer: "M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l3 2M9 2h6",
  map: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14",
  align: "M4 3v18M8 6h10v4H8zM8 14h6v4H8z",
  straight: "M4 18L20 6",
  elbow: "M4 18h8V6h8",
  curve: "M4 18c8 0 8-12 16-12",
  arrowend: "M4 12h15M14 7l5 5-5 5",
  arrowboth: "M5 12h14M10 7l-5 5 5 5M14 7l5 5-5 5",
  arrownone: "M4 12h16",
  dash: "M3 12h4M10 12h4M17 12h4",
  chevl: "M15 5l-7 7 7 7",
  chevr: "M9 5l7 7-7 7",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  check: "M5 12.5l4.5 4.5L19 7",
  outline: "M4 6h6M8 12h8M12 18h8",
  sheet: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7",
  issue: "M12 3l9 16H3zM12 10v4M12 17h.01",
};

export function icon(name, size) {
  const s = size || 18;
  return `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" `
    + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ""}"/></svg>`;
}

/* ------------------------------------------------------------- geometry */

export const bbox = (o) => ({ x: o.x || 0, y: o.y || 0, w: o.w || 0, h: o.h || 0 });
export const center = (o) => ({ x: (o.x || 0) + (o.w || 0) / 2, y: (o.y || 0) + (o.h || 0) / 2 });

export function unionBox(list) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of list) {
    if (b.x < x0) x0 = b.x;
    if (b.y < y0) y0 = b.y;
    if (b.x + b.w > x1) x1 = b.x + b.w;
    if (b.y + b.h > y1) y1 = b.y + b.h;
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const boxesTouch = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* Where the line from the middle of a box towards `to` leaves the box -
   or the ellipse or diamond drawn in it, so an arrow touches the outline
   that is actually visible and not an invisible corner. */
export function edgePoint(o, to, gap) {
  const c = center(o), hw = (o.w || 1) / 2, hh = (o.h || 1) / 2;
  let dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) dx = 1;
  let k;
  if (o.t === "shape" && o.kind === "ellipse") {
    k = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (o.t === "shape" && o.kind === "diamond") {
    k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  }
  const len = Math.hypot(dx, dy) || 1, g = gap || 0;
  return { x: c.x + dx * k + (dx / len) * g, y: c.y + dy * k + (dy / len) * g };
}

/* The side of a box that faces a point: [normal x, normal y]. */
function facing(o, to) {
  const c = center(o), dx = to.x - c.x, dy = to.y - c.y;
  // compared in units of the box, so a wide box still offers its top to something above it
  return Math.abs(dx) / ((o.w || 1) / 2 + 1) >= Math.abs(dy) / ((o.h || 1) / 2 + 1)
    ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
}
const sideMid = (o, n, gap) => {
  const c = center(o);
  return { x: c.x + n[0] * ((o.w || 0) / 2 + gap), y: c.y + n[1] * ((o.h || 0) / 2 + gap) };
};

/* The path of a connector between two ends. An end is an object (attached)
   or a bare point. Returns the SVG path, the points where it starts and
   stops, the direction it arrives from (for the arrow head) and where its
   label sits. */
export function route(kind, A, B, a, b) {
  // A, B: attached objects or null; a, b: {x, y} fallbacks when free
  const pa = A ? center(A) : a, pb = B ? center(B) : b;
  const GAP = 3;
  if (kind === "elbow" || kind === "curve") {
    const na = A ? facing(A, pb) : null, nb = B ? facing(B, pa) : null;
    const p1 = A ? sideMid(A, na, GAP) : a, p2 = B ? sideMid(B, nb, GAP) : b;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (kind === "curve") {
      const pull = Math.max(30, Math.min(160, dist * 0.45));
      const va = na || [Math.sign(p2.x - p1.x) || 1, 0];
      const vb = nb || [-(Math.sign(p2.x - p1.x) || 1), 0];
      const c1 = { x: p1.x + va[0] * pull, y: p1.y + va[1] * pull };
      const c2 = { x: p2.x + vb[0] * pull, y: p2.y + vb[1] * pull };
      const mid = bez(p1, c1, c2, p2, 0.5);
      return { d: `M${r(p1.x)} ${r(p1.y)}C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`,
               p1, p2, from1: c1, from2: c2, mid, pts: [p1, c1, c2, p2], curve: true };
    }
    // elbow: leave along the facing side, turn once (or twice) to arrive
    const va = na || (Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? [1, 0] : [0, 1]);
    const vb = nb || va;
    let pts;
    if (va[0] && vb[0]) {            // both horizontal: a step in the middle
      const mx = (p1.x + p2.x) / 2;
      pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    } else if (va[1] && vb[1]) {     // both vertical
      const my = (p1.y + p2.y) / 2;
      pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    } else if (va[0]) {              // out sideways, in from above or below
      pts = [p1, { x: p2.x, y: p1.y }, p2];
    } else {
      pts = [p1, { x: p1.x, y: p2.y }, p2];
    }
    const mid = polyMid(pts);
    return { d: "M" + pts.map((p) => r(p.x) + " " + r(p.y)).join("L"), p1, p2,
             from1: pts[1], from2: pts[pts.length - 2], mid, pts };
  }
  const p1 = A ? edgePoint(A, pb, GAP) : a, p2 = B ? edgePoint(B, pa, GAP) : b;
  return { d: `M${r(p1.x)} ${r(p1.y)}L${r(p2.x)} ${r(p2.y)}`, p1, p2, from1: p2, from2: p1,
           mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, pts: [p1, p2] };
}

const r = (v) => Math.round(v * 10) / 10;

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
           y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
}

function polyMid(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg && seg > 0) {
      const t = half / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= seg;
  }
  return pts[0];
}

/* The three corners of an arrow head arriving at `tip` from `from`. */
export function arrowHead(tip, from, size) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), s = size || 10;
  const p = (da) => ({ x: tip.x - s * Math.cos(a + da), y: tip.y - s * Math.sin(a + da) });
  const l = p(0.42), rr = p(-0.42);
  return `M${r(l.x)} ${r(l.y)}L${r(tip.x)} ${r(tip.y)}L${r(rr.x)} ${r(rr.y)}`;
}

/* ------------------------------------------------------------- freehand */

/* Fewer points for the same line (Ramer-Douglas-Peucker). A pen stroke
   arrives as hundreds of points; most add nothing but bytes. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0, at = -1;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* A smooth path through points given as a flat [x0, y0, x1, y1 ...]. */
export function penPath(flat) {
  const n = flat.length / 2;
  if (n < 1) return "";
  if (n === 1) return `M${flat[0]} ${flat[1]}l0.01 0`;
  let d = `M${flat[0]} ${flat[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (flat[i * 2] + flat[i * 2 + 2]) / 2, my = (flat[i * 2 + 1] + flat[i * 2 + 3]) / 2;
    d += `Q${flat[i * 2]} ${flat[i * 2 + 1]} ${r(mx)} ${r(my)}`;
  }
  return d + `L${flat[n * 2 - 2]} ${flat[n * 2 - 1]}`;
}
