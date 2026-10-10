/* The clash check's exact pass, off the page's thread (clash.js sends the
   elements' triangles and the pairs to judge; clashcore.js judges them). */
import { judge } from "./clashcore.js";

const els = new Map();     // element key -> { tris, box, closed }

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "add") {
    for (const e of m.els) els.set(e.k, { tris: e.tris, box: e.box });
  } else if (m.type === "drop") {
    for (const k of m.keys) els.delete(k);
  } else if (m.type === "clear") {
    els.clear();
  } else if (m.type === "judge") {
    const out = [];
    // a pair's 4th item: both are walls, floors, beams ... (joins left out)
    const optJ = Object.assign({}, m.opt, { join: true });
    for (const [n, a, b, j] of m.pairs) {
      const A = els.get(a), B = els.get(b);
      if (!A || !B) { out.push([n, null, "missing"]); continue; }
      let r = null, err = null;
      try { r = judge(A, B, j ? optJ : m.opt); } catch (e) { err = String(e && e.message || e); }
      out.push([n, r, err]);
    }
    self.postMessage({ type: "judged", id: m.id, out });
  }
};
