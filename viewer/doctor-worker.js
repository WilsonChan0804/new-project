/* Model Doctor's checks off the page's thread (doctor.js sends the elements
   once, then asks for the checks one by one; doctorcore.js does the work). */
import { runCheck } from "./doctorcore.js";

let els = [];
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "els") { els = m.els || []; return; }
  if (m.type === "check") {
    let r = null, err = null;
    const t0 = Date.now();
    try { r = runCheck(m.id, els, m.opts); } catch (e) { err = String((e && e.stack) || e); }
    // only what the page needs back (no triangles)
    if (r) r.issues = r.issues.map((f) => Object.assign({}, f));
    self.postMessage({ type: "checked", id: m.id, seq: m.seq, result: r, error: err, ms: Date.now() - t0 });
  }
  if (m.type === "clear") els = [];
};
