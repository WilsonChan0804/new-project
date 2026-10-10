/* The headroom scan off the page's thread (headroom.js sends the
   triangles; headcore.js does the work). */
import { scan } from "./headcore.js";

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type !== "scan") return;
  let out = null, err = null;
  try { out = scan(m.walk, m.above, m.opt); } catch (e) { err = String(e && e.message || e); }
  self.postMessage({ type: "scanned", id: m.id, out, err });
};
