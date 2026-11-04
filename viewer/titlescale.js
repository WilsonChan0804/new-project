/* The scale a sheet's title block states ("SCALE 1:100", "比例 1:200",
   "1:50 @ A1"), read from its words (wordsFor: [text, x, top, w, h] in
   points, the OCR'd words for a scan). A value beside a SCALE label counts,
   in the title block's corner first; several different ones there (a sheet
   of details), or "AS INDICATED", give none - the 1: box then says which
   were seen. W, H: the sheet in points. */
export function scaleFromWords(words, W, H) {
  if (!Array.isArray(words) || !words.length) return { scale: null, all: [] };
  const toks = words.filter((w) => w && w[0]).map((w) => ({ t: String(w[0]), x: +w[1], y: +w[2], w: +w[3] || 0, h: +w[4] || 6 }));
  // lines: words at the same height, left to right
  toks.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const k of toks) {
    const L = lines.find((l) => Math.abs(l.y - k.y) < Math.max(2, Math.min(l.h, k.h) * 0.6));
    if (L) L.w.push(k); else lines.push({ y: k.y, h: k.h, w: [k] });
  }
  const values = [], labels = [];
  for (const L of lines) {
    L.w.sort((a, b) => a.x - b.x);
    // the line as text, with each character's x, so a match knows where it is
    let text = "", xs = [];
    for (const k of L.w) {
      if (text) { text += " "; xs.push(k.x); }
      for (let i = 0; i < k.t.length; i++) { text += k.t[i]; xs.push(k.x + (k.w * i) / Math.max(1, k.t.length)); }
    }
    for (const m of text.matchAll(/(?:^|[^\d.])1\s*[:\/]\s*(\d{1,4})(?![\d./])/g)) {
      const n = +m[1];
      if (n >= 1 && n <= 5000) values.push({ n, x: xs[m.index + m[0].indexOf("1")], y: L.y, h: L.h });
    }
    for (const m of text.matchAll(/scale|比例/gi)) {
      const rest = text.slice(m.index, m.index + 40);
      labels.push({ x: xs[m.index], y: L.y, h: L.h, none: /as\s*indicated|n\.?\s*t\.?\s*s\.?\b|not\s+to\s+scale/i.test(rest) });
    }
  }
  const inCorner = (v) => v.x > W * 0.65 || v.y > H * 0.75;
  const near = (v) => labels.some((l) => (Math.abs(v.y - l.y) < Math.max(3, l.h) && v.x >= l.x - 2 && v.x - l.x < 140)
    || (v.y > l.y && v.y - l.y < 45 && Math.abs(v.x - l.x) < 110));
  const distinct = (arr) => [...new Set(arr.map((v) => v.n))];
  const titled = values.filter(near);
  const all = distinct(values).sort((a, b) => a - b);
  for (const pick of [titled.filter(inCorner), titled]) {
    const d = distinct(pick);
    if (d.length === 1) return { scale: d[0], all };
    if (d.length > 1) return { scale: null, all: d.sort((a, b) => a - b), several: true };
  }
  if (labels.some((l) => l.none)) return { scale: null, all, indicated: true };
  return { scale: null, all };
}
