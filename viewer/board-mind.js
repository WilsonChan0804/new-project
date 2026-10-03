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

/* Lay one tree out from its root. `size(node)` gives the node's measured
   width and height. Returns id -> { x, y, dir, color, hidden, depth }. */
export function layout(F, root, size) {
  const out = new Map();
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

  const at = { x: root.x || 0, y: root.y || 0, dir: 0, color: null, depth: 0, hidden: false };
  out.set(root.id, at);
  if (root.collapsed) { hide(root); return out; }
  const right = childrenOf(F, root.id).filter((k) => k.side !== "l");
  const left = childrenOf(F, root.id).filter((k) => k.side === "l");
  for (const k of right.concat(left)) subH(k, 1);
  place(root, at, 1, 0, null, right);
  place(root, at, -1, 0, null, left);
  return out;
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
