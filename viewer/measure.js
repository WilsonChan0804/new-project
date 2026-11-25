/* The plans' measure tool: click two points, each snapped to a corner, a face's middle or a point on a face; the
 * length shown with its ΔX and ΔY. Two points on two parallel faces give the clear distance between the faces,
 * square to them. The measures stay on the plan until cleared (kept for the visit, not stored).
 * A page gives its geometry: {pts: [[x, y]], segs: [[a, b]]} in its plan frame, and draws with its sx / sy.
 */
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

export function create() {
  return { a: null, hover: null, list: [] };
}

/* a plan point snapped: a corner, a face's middle, then onto a face (tol in plan units) -> {p, seg, kind} */
export function snap(P, geo, tol) {
  let best = null, bd = tol;
  for (const c of geo.pts || []) { const d = Math.hypot(c[0] - P[0], c[1] - P[1]); if (d < bd) { bd = d; best = { p: [c[0], c[1]], kind: "corner" }; } }
  // a face's middle (not a short one's: the end of a thin wall would take the point off the face it is on)
  for (const s of geo.segs || []) { if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) < 3 * tol) continue; const m = [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2], d = Math.hypot(m[0] - P[0], m[1] - P[1]); if (d < bd) { bd = d; best = { p: m, seg: s, kind: "middle" }; } }
  if (best) { best.segs = segsAt(best.p, geo.segs); return best; }
  let bs = null; bd = tol;
  for (const s of geo.segs || []) { const q = near(P, s); if (q.d < bd) { bd = q.d; bs = { p: q.p, segs: [s], kind: "face" }; } }
  return bs || { p: [P[0], P[1]], kind: "free" };
}
function near(P, [a, b]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2));
  const p = [a[0] + t * dx, a[1] + t * dy];
  return { p, d: Math.hypot(p[0] - P[0], p[1] - P[1]) };
}
/* the faces through a point (a corner has two or more) */
const segsAt = (p, segs) => (segs || []).filter((s) => near(p, s).d < 1e-6);
const dirOf = (s) => { const dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };

/* a measure from two snapped points: on two parallel faces, the clear distance square to them */
export function measureOf(A, B) {
  // a face through each point, the two parallel: the clear distance square to them
  let bestC = null;
  for (const s1 of A.segs || []) for (const s2 of B.segs || []) {
    const d1 = dirOf(s1), d2 = dirOf(s2);
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > 1e-3) continue;
    const n = [-d1[1], d1[0]], gap = (s2[0][0] - A.p[0]) * n[0] + (s2[0][1] - A.p[1]) * n[1];
    if (Math.abs(gap) < 1e-6) continue;
    // faces across the line between the points (at corners, each has faces both ways: the ones the measure crosses)
    const ab = [B.p[0] - A.p[0], B.p[1] - A.p[1]], L = Math.hypot(ab[0], ab[1]);
    if (L > 1e-6 && Math.abs(ab[0] * n[0] + ab[1] * n[1]) / L < 0.7) continue;
    // B square to A's face, onto B's face
    if (!bestC || Math.abs(gap) < Math.abs(bestC.gap)) bestC = { gap, n };
  }
  if (bestC) { const b = [A.p[0] + bestC.n[0] * bestC.gap, A.p[1] + bestC.n[1] * bestC.gap]; return { a: A.p, b, L: Math.abs(bestC.gap), clear: true }; }
  return { a: A.p, b: B.p, L: Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]), dx: Math.abs(B.p[0] - A.p[0]), dy: Math.abs(B.p[1] - A.p[1]) };
}

/* a click: the first point, or the second and the measure made */
export function click(M, snapped) {
  if (!M.a) { M.a = snapped; return null; }
  const m = measureOf(M.a, snapped); M.a = null; M.hover = null;
  if (m.L > 1e-4) M.list.push(m);
  return m;
}
export function clear(M) { M.a = null; M.hover = null; M.list = []; }

/* the measures drawn (sx, sy: plan to screen) */
export function svg(M, sx, sy) {
  const one = (m, live) => {
    const A = [sx(m.a[0]), sy(m.a[1])], B = [sx(m.b[0]), sy(m.b[1])];
    const ang = Math.atan2(B[1] - A[1], B[0] - A[0]), n = [-Math.sin(ang) * 5, Math.cos(ang) * 5], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    let rot = ang * 180 / Math.PI; if (rot > 90) rot -= 180; if (rot < -90) rot += 180;
    const txt = `${f3(m.L)} m${m.clear ? " clear" : m.dx != null && m.dx > 0.001 && m.dy > 0.001 ? ` (Δx ${f3(m.dx)} · Δy ${f3(m.dy)})` : ""}`;
    const col = live ? "#1f6feb" : "#0b57d0";
    return `<g pointer-events="none"><line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="${col}" stroke-width="1.2"${live ? ' stroke-dasharray="4 3"' : ""} />`
      + [A, B].map((p) => `<line x1="${p[0] - n[0]}" y1="${p[1] - n[1]}" x2="${p[0] + n[0]}" y2="${p[1] + n[1]}" stroke="${col}" stroke-width="1.2" /><circle cx="${p[0]}" cy="${p[1]}" r="2.2" fill="${col}" />`).join("")
      + `<text x="${mid[0]}" y="${mid[1]}" dy="-5" text-anchor="middle" font-size="11.5" font-weight="700" fill="${col}" paint-order="stroke" stroke="#fff" stroke-width="3.5" transform="rotate(${rot} ${mid[0]} ${mid[1]})">${txt}</text></g>`;
  };
  let g = M.list.map((m) => one(m, false)).join("");
  if (M.a) {
    g += `<circle cx="${sx(M.a.p[0])}" cy="${sy(M.a.p[1])}" r="3.5" fill="#1f6feb" pointer-events="none" />`;
    if (M.hover) g += one(measureOf(M.a, M.hover), true);
  }
  if (M.hover && !M.a) g += `<circle cx="${sx(M.hover.p[0])}" cy="${sy(M.hover.p[1])}" r="4" fill="none" stroke="#1f6feb" stroke-width="1.5" pointer-events="none" />`;
  return g;
}
