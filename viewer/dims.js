/* Dimension strings for the plans: a line along a→b (plan metres), offset from it by off screen pixels to its left
 * (or right, negative), a 45° tick at each point along it (ts: distances from a), each span's length written over it
 * (3 d.p., left out where it would not fit). sx / sy: plan to screen.
 */
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

export function chain(a, b, ts, off, sx, sy, o) {
  o = o || {};
  const fs = o.fs || 9, col = o.col || "#333";
  const A = [sx(a[0]), sy(a[1])], B = [sx(b[0]), sy(b[1])], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, Lm = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [d[1], -d[0]], k = L / Lm;
  const v = [...new Set(ts.map((t) => Math.round(t * 1000) / 1000))].sort((p, q) => p - q);
  if (v.length < 2) return "";
  const P = (t) => [A[0] + d[0] * t * k + n[0] * off, A[1] + d[1] * t * k + n[1] * off];
  let ang = Math.atan2(d[1], d[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  const p0 = P(v[0]), p1 = P(v[v.length - 1]);
  let g = `<g class="dimc" pointer-events="none"><line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="${col}" stroke-width="0.7" />`;
  // the extension lines back towards what is measured (short, from a little off it)
  for (const t of v) {
    const p = P(t), e0 = [p[0] - n[0] * Math.min(Math.abs(off), 6) * Math.sign(off || 1), p[1] - n[1] * Math.min(Math.abs(off), 6) * Math.sign(off || 1)];
    const tk = [(d[0] + n[0]) * 3.5, (d[1] + n[1]) * 3.5];
    g += `<line x1="${e0[0]}" y1="${e0[1]}" x2="${p[0] + n[0] * 3 * Math.sign(off || 1)}" y2="${p[1] + n[1] * 3 * Math.sign(off || 1)}" stroke="${col}" stroke-width="0.45" /><line x1="${p[0] - tk[0]}" y1="${p[1] - tk[1]}" x2="${p[0] + tk[0]}" y2="${p[1] + tk[1]}" stroke="${col}" stroke-width="1" />`;
  }
  for (let i = 1; i < v.length; i++) {
    const span = v[i] - v[i - 1]; if (span * k < fs * 3.2) continue;
    const m = P((v[i] + v[i - 1]) / 2), up = Math.sign(off || 1) * 3;
    const tx = m[0] + n[0] * up, ty = m[1] + n[1] * up;
    g += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="${off >= 0 ? "auto" : "hanging"}" font-size="${fs}" fill="${col}" paint-order="stroke" stroke="#fff" stroke-width="2.5" transform="rotate(${ang} ${tx} ${ty})">${f3(span)}</text>`;
  }
  return g + "</g>";
}
