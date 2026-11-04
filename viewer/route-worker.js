/* The Route tool's searching, off the page's thread (routecore.js).
 *
 *   {op: "load", key, vps}            a sheet's plan cuts, kept by key
 *   {op: "route", req, key, vp, rect, block, cell, clear, legs: [[a, b] ...]}
 *        -> {req, legs: [[[x, y] ...] | null ...]}
 *
 * The grid of a viewport is kept for the same categories, cell and
 * clearance, so dragging a point re-routes at once. */
import { makeGrid, route } from "./routecore.js";

const DATA = new Map();      // key -> {vpid: {cats: {name: [..]}}}
const GRIDS = new Map();     // key|vp|block|cell|clear -> grid

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.op === "load") {
    DATA.set(m.key, m.vps || {});
    for (const k of GRIDS.keys()) if (k.startsWith(m.key + "|")) GRIDS.delete(k);
    return;
  }
  if (m.op !== "route") return;
  try {
    const vps = DATA.get(m.key) || {};
    const v = vps[m.vp];
    if (!v) { self.postMessage({ req: m.req, legs: m.legs.map(() => null), error: "no plan cut" }); return; }
    const gk = [m.key, m.vp, (m.block || []).join(","), m.cell, m.clear].join("|");
    let G = GRIDS.get(gk);
    if (!G) {
      const segs = (m.block || []).map((c) => (v.cats || {})[c]).filter(Boolean);
      G = makeGrid(segs, m.rect, m.cell, m.clear);
      if (GRIDS.size > 6) GRIDS.delete(GRIDS.keys().next().value);
      GRIDS.set(gk, G);
    }
    self.postMessage({ req: m.req, legs: m.legs.map(([a, b]) => route(G, a, b)) });
  } catch (e) {
    self.postMessage({ req: m.req, legs: (m.legs || []).map(() => null), error: String(e && e.message || e) });
  }
};
