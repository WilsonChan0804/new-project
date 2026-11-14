/* Mind maps: the tree behind the nodes, and where each node goes.
 *
 * A node stores only what a person decided: its text, its parent, its
 * order among its siblings, which side of the root a main branch is on,
 * whether it is folded. Where it sits on the canvas is NOT stored (except
 * for the root, which is where the map was put): every browser works the
 * layout out again from the tree. So adding a node is one small save
 * instead of "move every node below it", and two people adding nodes to
 * the same map at the same moment cannot leave it with nodes on top of
 * each other - there are no saved positions to disagree about.
 */

import { BRANCH_COLORS } from "./board-util.js";

export const HGAP = 44;          // parent edge to child edge
export const VGAP = 10;          // between siblings
export const VGAP_MAIN = 20;     // between the main branches

/* The trees among the objects: who is whose child, and which node is the
   root of each. A parent that no longer exists, or a loop (two people
   re-parenting into each other at the same moment), makes a node a root
   here rather than a node that is nowhere. */
export function forest(objs) {
  const nodes = [];
  for (const o of objs.values()) if (o.t === "node") nodes.push(o);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const roots = [];
  const parentOf = new Map();

  for (const n of nodes) {
    let p = n.parent && byId.get(n.parent) ? n.parent : null;
    if (p) {
      // walk up: reaching this node again means a loop
      const seen = new Set([n.id]);
      let q = p, loop = false;
      while (q) {
        if (seen.has(q)) { loop = true; break; }
        seen.add(q);
        const up = byId.get(q);
        q = up && up.parent && byId.get(up.parent) ? up.parent : null;
      }
      // break the loop at one agreed place (the smallest id), on every screen alike
      if (loop && n.id === Array.from(seen).sort()[0]) p = null;
    }
    parentOf.set(n.id, p);
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else {
      roots.push(n);
    }
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (a.ord || 0) - (b.ord || 0) || (a.id < b.id ? -1 : 1));
  }
  const rootOf = new Map(), depth = new Map();
  const walk = (n, root, d) => {
    rootOf.set(n.id, root.id);
    depth.set(n.id, d);
    for (const k of kids.get(n.id) || []) walk(k, root, d + 1);
  };
  for (const r of roots) walk(r, r, 0);
  return { byId, kids, roots, parentOf, rootOf, depth };
}

export const childrenOf = (F, id) => F.kids.get(id) || [];

/* A node and everything under it. */
export function subtree(F, id) {
  const out = [];
  const walk = (i) => { out.push(i); for (const k of childrenOf(F, i)) walk(k.id); };
  if (F.byId.has(id)) walk(id);
  return out;
}

export function countBelow(F, id) {
  return subtree(F, id).length - 1;
}

/* Which side of the root the next main branch should go on: the emptier
   one, so the map grows balanced without anyone arranging it. */
export function lighterSide(F, rootId) {
  let l = 0, r = 0;
  for (const k of childrenOf(F, rootId)) {
    const n = subtree(F, k.id).length;
    if (k.side === "l") l += n; else r += n;
  }
  return r <= l ? "r" : "l";
}

/* The next "ord" after the last sibling. */
export function nextOrd(F, parentId) {
  const ks = childrenOf(F, parentId);
  return ks.length ? (ks[ks.length - 1].ord || 0) + 1 : 1;
}

/* The ways a map can be laid out (the root's "st"), as in Xmind. The nodes
   and their order are the same in all of them; only where they go and how
   the lines run changes, so a map can be switched at any time. */
export const STRUCTURES = [
  ["map", "Mind map", "Branches on both sides of the centre"],
  ["logic", "Logic chart", "Every branch to the right"],
  ["org", "Org chart", "Top-down, as for a team or a breakdown of work"],
  ["timeline", "Timeline", "Steps along a line, their details above and below"],
  ["fishbone", "Fishbone", "Causes as bones off a spine to the problem at the head"],
  ["table", "Tree table", "The map as a nested table"],
];
const r1 = (v) => Math.round(v * 10) / 10;
const elbowDown = (p, c) => {
  const x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y, ym = (y1 + y2) / 2;
  return `M${r1(x1)} ${r1(y1)}V${r1(ym)}H${r1(x2)}V${r1(y2)}`;
};
const rect = (x, y, w, h) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
const dot = (cx, cy, r) => `M${r1(cx - r)} ${r1(cy)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/* Lay one tree out from its root. `size(node)` gives the node's measured
   width and height. Returns id -> { x, y, dir, color, hidden, depth, link? }
   where link is the line from its parent (else a curve, branchPath), and
   out.extra: other lines (a spine, bones, table cells) as
   [{ d, color, width, fill }]. */
export function layout(F, root, size) {
  const out = new Map();
  out.extra = [];
  const dim = new Map();
  const sz = (n) => {
    if (!dim.has(n.id)) dim.set(n.id, size(n));
    return dim.get(n.id);
  };
  const open = (n) => (n.collapsed ? [] : childrenOf(F, n.id));
  const gapFor = (d) => (d === 0 ? VGAP_MAIN : VGAP);
  const heights = new Map();
  const subH = (n, d, list) => {
    const ks = list || open(n);
    let total = 0;
    ks.forEach((k, i) => { total += subH(k, d + 1) + (i ? gapFor(d) : 0); });
    const h = Math.max(sz(n).h, total);
    if (!list) heights.set(n.id, h);
    return h;
  };
  const hide = (n) => {
    for (const k of childrenOf(F, n.id)) {
      out.set(k.id, { x: n.x || 0, y: n.y || 0, hidden: true });
      hide(k);
    }
  };
  // a sideways tree (the map's two halves, a logic chart, the details of a step)
  const place = (n, pos, dir, d, color, list) => {
    const ks = list || open(n);
    if (n.collapsed) hide(n);
    let total = 0;
    ks.forEach((k, i) => { total += heights.get(k.id) + (i ? gapFor(d) : 0); });
    let y = pos.y + sz(n).h / 2 - total / 2;
    ks.forEach((k, i) => {
      const sh = heights.get(k.id), s = sz(k);
      const c = d === 0 ? branchColor(k, F, n.id) : color;
      const p = { x: dir > 0 ? pos.x + sz(n).w + HGAP : pos.x - HGAP - s.w, y: y + sh / 2 - s.h / 2,
                  dir, color: c, depth: d + 1, hidden: false };
      out.set(k.id, p);
      place(k, p, dir, d + 1, c);
      y += sh + gapFor(d);
    });
  };

  const st = STRUCTURES.some((s) => s[0] === root.st) ? root.st : "map";
  const at = { x: root.x || 0, y: root.y || 0, dir: 0, color: null, depth: 0, hidden: false };
  out.set(root.id, at);
  if (root.collapsed) { hide(root); return out; }
  const mains = childrenOf(F, root.id);
  const rs = sz(root);

  if (st === "map" || st === "logic") {
    const right = st === "logic" ? mains : mains.filter((k) => k.side !== "l");
    const left = st === "logic" ? [] : mains.filter((k) => k.side === "l");
    for (const k of right.concat(left)) subH(k, 1);
    place(root, at, 1, 0, null, right);
    place(root, at, -1, 0, null, left);
    return out;
  }

  if (st === "org") {
    // top-down: each subtree as wide as its children side by side
    const GX = 18, GY = 46;
    const wide = new Map();
    const subW = (n) => {
      const ks = open(n);
      const kw = ks.reduce((a, k, i) => a + subW(k) + (i ? GX : 0), 0);
      const w = Math.max(sz(n).w, kw);
      wide.set(n.id, w);
      return w;
    };
    subW(root);
    const down = (n, p, d, color) => {
      if (n.collapsed) { hide(n); return; }
      const ks = open(n);
      const kw = ks.reduce((a, k, i) => a + wide.get(k.id) + (i ? GX : 0), 0);
      let x = p.x + sz(n).w / 2 - kw / 2;
      const y = p.y + sz(n).h + GY;
      for (const k of ks) {
        const s = sz(k), w = wide.get(k.id);
        const c = d === 0 ? branchColor(k, F, root.id) : color;
        const q = { x: x + w / 2 - s.w / 2, y, dir: 1, color: c, depth: d + 1, hidden: false };
        q.link = elbowDown({ x: p.x, y: p.y, w: sz(n).w, h: sz(n).h }, { x: q.x, y: q.y, w: s.w, h: s.h });
        out.set(k.id, q);
        down(k, q, d + 1, c);
        x += w + GX;
      }
    };
    down(root, at, 0, null);
    return out;
  }

  if (st === "timeline" && root.stdir === "v") {
    // down a line: each step on it, its details to the right and left by turns
    const sx = at.x + rs.w / 2;
    let y = at.y + rs.h + 40;
    mains.forEach((k, i) => {
      subH(k, 1);
      const s = sz(k), c = branchColor(k, F, root.id), side = i % 2 ? -1 : 1;
      const block = Math.max(s.h, heights.get(k.id));
      const p = { x: sx - s.w / 2, y: y + block / 2 - s.h / 2, dir: side, color: c, depth: 1, hidden: false, link: "" };
      out.set(k.id, p);
      // its details beside it, to one side
      const kids = open(k);
      if (kids.length) {
        const anchor = { x: side > 0 ? p.x : p.x, y: p.y };
        place(k, anchor, side, 1, c, kids);
      } else if (k.collapsed) hide(k);
      out.extra.push({ d: dot(sx, p.y - 8, 4), color: c, fill: true });
      y += block + 34;
    });
    out.extra.unshift({ d: `M${r1(sx)} ${r1(at.y + rs.h)}V${r1(y)}`, color: "#1f2430", width: 4 });
    return out;
  }

  if (st === "timeline") {
    // along a line: each step on it, its details stacked above or below by turns
    const sy = at.y + rs.h / 2, ROW = 8, IND = 18;
    let x = at.x + rs.w + 46;
    mains.forEach((k, i) => {
      const s = sz(k), c = branchColor(k, F, root.id), up = i % 2 === 0;
      const p = { x, y: sy - s.h / 2, dir: 1, color: c, depth: 1, hidden: false, link: "" };
      out.set(k.id, p);
      // the details: an indented list on a stem
      const rows = [];
      const walk = (n, d) => { if (n.collapsed) { hide(n); return; } for (const kk of open(n)) { rows.push([kk, d]); walk(kk, d + 1); } };
      walk(k, 0);
      let widest = s.w, yy = up ? p.y - 26 : p.y + s.h + 26;
      const stemX = x + 12;
      let far = up ? p.y : p.y + s.h;
      for (const [n, d] of (up ? rows.slice().reverse() : rows)) {
        const ns = sz(n);
        const q = { x: stemX + 12 + d * IND, y: up ? yy - ns.h : yy, dir: 1, color: c, depth: d + 2, hidden: false };
        q.link = `M${r1(stemX + d * IND)} ${r1(q.y + ns.h / 2)}H${r1(q.x)}`;
        out.set(n.id, q);
        widest = Math.max(widest, 24 + d * IND + ns.w);
        far = up ? Math.min(far, q.y + ns.h / 2) : Math.max(far, q.y + ns.h / 2);
        yy = up ? q.y - ROW : q.y + ns.h + ROW;
      }
      if (rows.length) out.extra.push({ d: `M${r1(stemX)} ${r1(up ? p.y : p.y + s.h)}V${r1(far)}`, color: c, width: 2 });
      // nested rows hang off their own parent's line: draw short stems for deeper levels
      for (const [n, d] of rows) if (d > 0) {
        const q = out.get(n.id), pp = out.get(F.parentOf.get(n.id));
        if (q && pp) out.extra.push({ d: `M${r1(stemX + d * IND)} ${r1(pp.y + sz(F.byId.get(F.parentOf.get(n.id))).h / 2)}V${r1(q.y + sz(n).h / 2)}`, color: c, width: 1.5 });
      }
      out.extra.push({ d: dot(x - 12, sy, 5), color: c, fill: true });
      x += Math.max(widest, s.w) + 54;
    });
    out.extra.unshift({ d: `M${r1(at.x + rs.w)} ${r1(sy)}H${r1(x)}`, color: "#1f2430", width: 4 });
    return out;
  }

  if (st === "fishbone") {
    // the problem at the head (right); causes as bones angled off a spine running left
    const sy = at.y + rs.h / 2, ROWH = 10, ANG = Math.PI / 3;
    let x = at.x - 40;
    mains.forEach((k, i) => {
      const s = sz(k), c = branchColor(k, F, root.id), up = i % 2 === 0;
      const kids = k.collapsed ? [] : open(k);
      if (k.collapsed) hide(k);
      kids.forEach((kk) => subH(kk, 2));
      const need = kids.reduce((a, kk) => a + heights.get(kk.id) + ROWH, 0);
      const L = Math.max(90, need / Math.sin(ANG) + 30);
      const dx = L * Math.cos(ANG), dy = L * Math.sin(ANG);
      const widest = kids.reduce((a, kk) => Math.max(a, sz(kk).w), 0);
      const bx = x - 20;                      // where the bone meets the spine
      const ex = bx - dx, ey = up ? sy - dy : sy + dy;
      const p = { x: ex - s.w / 2, y: up ? ey - s.h - 4 : ey + 4, dir: -1, color: c, depth: 1, hidden: false, link: "" };
      out.set(k.id, p);
      out.extra.push({ d: `M${r1(bx)} ${r1(sy)}L${r1(ex)} ${r1(ey)}`, color: c, width: 3 });
      // ribs: each cause's causes, level, off the bone
      let t = 0.25;
      const step = kids.length ? 0.7 / kids.length : 0;
      for (const kk of kids) {
        const ks = sz(kk);
        const px = bx - dx * t, py = sy + (up ? -dy : dy) * t;
        const q = { x: px - 14 - ks.w, y: py - ks.h / 2, dir: -1, color: c, depth: 2, hidden: false };
        q.link = `M${r1(px)} ${r1(py)}H${r1(q.x + ks.w)}`;
        out.set(kk.id, q);
        place(kk, q, -1, 2, c);
        t += step;
      }
      x = Math.min(bx - dx - widest - 60, ex - s.w / 2 - 40);
    });
    out.extra.unshift({ d: `M${r1(at.x)} ${r1(sy)}H${r1(x)}`, color: "#1f2430", width: 4 });
    return out;
  }

  // st === "table": the root a header over columns, one per main branch
  {
    const PAD = 8, IND = 16, ROW = 6;
    const cols = mains.map((k) => {
      const rows = [];
      const walk = (n, d) => { if (n.collapsed) { hide(n); return; } for (const kk of open(n)) { rows.push([kk, d]); walk(kk, d + 1); } };
      walk(k, 0);
      const w = Math.max(sz(k).w, ...rows.map(([n, d]) => d * IND + sz(n).w)) + PAD * 2;
      return { k, rows, w };
    });
    const total = Math.max(rs.w + PAD * 2, cols.reduce((a, c) => a + c.w, 0));
    const x0 = at.x + rs.w / 2 - total / 2, y0 = at.y - PAD;
    const headH = rs.h + PAD * 2;
    out.extra.push({ d: rect(x0, y0, total, headH), color: "#1f2430", width: 1.5 });
    const mainH = Math.max(0, ...cols.map((c) => sz(c.k).h)) + PAD * 2;
    let x = x0, bottom = y0 + headH + mainH;
    for (const c of cols) {
      let y = y0 + headH + mainH;
      for (const [n, d] of c.rows) y += sz(n).h + PAD + ROW;
      bottom = Math.max(bottom, y);
    }
    cols.forEach((c, i) => {
      const color = branchColor(c.k, F, root.id), s = sz(c.k);
      out.set(c.k.id, { x: x + PAD, y: y0 + headH + PAD, dir: 1, color, depth: 1, hidden: false, link: "" });
      out.extra.push({ d: rect(x, y0 + headH, c.w, mainH), color, width: 1.5 });
      out.extra.push({ d: rect(x, y0 + headH + mainH, c.w, bottom - y0 - headH - mainH), color: "#c3cad4", width: 1 });
      let y = y0 + headH + mainH + PAD;
      for (const [n, d] of c.rows) {
        const ns = sz(n);
        out.set(n.id, { x: x + PAD + d * IND, y, dir: 1, color, depth: d + 2, hidden: false, link: "" });
        y += ns.h + PAD + ROW;
        out.extra.push({ d: `M${r1(x)} ${r1(y - ROW / 2 - PAD / 2)}h${r1(c.w)}`, color: "#e5e7eb", width: 1 });
      }
      x += c.w;
      void s; void i;
    });
    return out;
  }
}

/* A main branch keeps the colour it was given when it was made; older or
   imported maps without one get theirs from their place among the others. */
export function branchColor(node, F, rootId) {
  if (typeof node.bc === "string" && /^#[0-9a-fA-F]{6}$/.test(node.bc)) return node.bc;
  const i = childrenOf(F, rootId).indexOf(node);
  return BRANCH_COLORS[(i < 0 ? 0 : i) % BRANCH_COLORS.length];
}

export function nextBranchColor(F, rootId) {
  const used = childrenOf(F, rootId).map((k) => k.bc);
  for (const c of BRANCH_COLORS) if (!used.includes(c)) return c;
  return BRANCH_COLORS[used.length % BRANCH_COLORS.length];
}

/* The branch line from a parent to a child: a curve that leaves the
   parent's side and arrives level at the child's. */
export function branchPath(p, c, dir) {
  const x1 = dir > 0 ? p.x + p.w : p.x, y1 = p.y + p.h / 2;
  const x2 = dir > 0 ? c.x : c.x + c.w, y2 = c.y + c.h / 2;
  const mx = (x1 + x2) / 2;
  const r = (v) => Math.round(v * 10) / 10;
  return `M${r(x1)} ${r(y1)}C${r(mx)} ${r(y1)} ${r(mx)} ${r(y2)} ${r(x2)} ${r(y2)}`;
}

/* The map as an indented list, for pasting into an email or a document. */
export function outline(F, id, indent) {
  const n = F.byId.get(id);
  if (!n) return "";
  const pad = indent || "";
  let text = pad + (pad ? "- " : "") + String(n.text || "").replace(/\s*\n\s*/g, " ") + "\n";
  for (const k of childrenOf(F, id)) text += outline(F, k.id, pad + "  ");
  return text;
}
