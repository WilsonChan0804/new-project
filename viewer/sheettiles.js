/* A sheet drawn from the server's pictures instead of its PDF.
 *
 * The server draws every sheet once as a pyramid of 512 px pictures
 * (server/app.py, "sheets as picture tiles"). This module makes that look
 * like a pdf.js page to the rest of the sheets page: getViewport() is
 * pdf.js's own PageViewport over the page's size, and render() paints the
 * pictures that cover the part being drawn, at the level the drawing's
 * scale needs - so zoom, rotation, the sharp overlay, markups and the split
 * view all work unchanged.
 *
 * Only the pictures in view are fetched, and each is fetched once (then
 * kept by the browser for good: the file's name changes with the sheet).
 * A big drawing therefore opens in the time a few small pictures take,
 * even on a slow line, and never needs the browser to read the whole PDF.
 * The PDF itself is still read when something needs its text (search,
 * select text, links between sheets).
 */

const MOBILE = /iP(hone|ad|od)|Android/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const KEEP = MOBILE ? 80 : 260;            // decoded pictures kept
const PARALLEL = 6;                        // fetches at once

const _bitmaps = new Map();                // url|o -> ImageBitmap (least recently used first)
const _loading = new Map();                // key -> Promise
let _active = 0;
const _waiting = [];
export const tileStats = { fetched: 0, bytes: 0, hits: 0, failed: 0, ms: 0 };

function remember(key, bmp) {
  _bitmaps.delete(key);
  _bitmaps.set(key, bmp);
  while (_bitmaps.size > KEEP) {
    const [old, b] = _bitmaps.entries().next().value;
    _bitmaps.delete(old);
    try { b.close(); } catch (e) {}
  }
}

function slot() {
  if (_active < PARALLEL) { _active++; return Promise.resolve(); }
  return new Promise((r) => _waiting.push(r));
}
function release() {
  const next = _waiting.shift();
  if (next) next(); else _active--;
}

function fetchTile(url, fmt, key, signal) {
  const have = _bitmaps.get(key);
  if (have) { tileStats.hits++; remember(key, have); return Promise.resolve(have); }
  let p = _loading.get(key);
  if (p) return p;
  p = (async () => {
    await slot();
    const t0 = performance.now();
    try {
      if (signal && signal.aborted) throw new DOMException("cancelled", "AbortError");
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      const bmp = await createImageBitmap(new Blob([buf], { type: "image/" + fmt }));
      tileStats.fetched++; tileStats.bytes += buf.byteLength; tileStats.ms += performance.now() - t0;
      remember(key, bmp);
      return bmp;
    } catch (e) {
      if (!(e && e.name === "AbortError")) tileStats.failed++;
      throw e;
    } finally {
      release();
      _loading.delete(key);
    }
  })();
  _loading.set(key, p);
  return p;
}

/* pdf.js's PageViewport, the same arithmetic (display_utils.js, v3.11):
   the markups, the zoom and the rotation all speak in these. */
class TileViewport {
  constructor({ viewBox, scale, rotation = 0, offsetX = 0, offsetY = 0, dontFlip = false }) {
    this.viewBox = viewBox; this.scale = scale; this.rotation = rotation;
    this.offsetX = offsetX; this.offsetY = offsetY;
    const cx = (viewBox[2] + viewBox[0]) / 2, cy = (viewBox[3] + viewBox[1]) / 2;
    let a, b, c, d;
    rotation %= 360; if (rotation < 0) rotation += 360;
    switch (rotation) {
      case 180: a = -1; b = 0; c = 0; d = 1; break;
      case 90: a = 0; b = 1; c = 1; d = 0; break;
      case 270: a = 0; b = -1; c = -1; d = 0; break;
      default: a = 1; b = 0; c = 0; d = -1;
    }
    if (dontFlip) { c = -c; d = -d; }
    let ox, oy, w, h;
    if (a === 0) {
      ox = Math.abs(cy - viewBox[1]) * scale + offsetX; oy = Math.abs(cx - viewBox[0]) * scale + offsetY;
      w = (viewBox[3] - viewBox[1]) * scale; h = (viewBox[2] - viewBox[0]) * scale;
    } else {
      ox = Math.abs(cx - viewBox[0]) * scale + offsetX; oy = Math.abs(cy - viewBox[1]) * scale + offsetY;
      w = (viewBox[2] - viewBox[0]) * scale; h = (viewBox[3] - viewBox[1]) * scale;
    }
    this.transform = [a * scale, b * scale, c * scale, d * scale,
      ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
    this.width = w; this.height = h;
  }
  get rawDims() {
    const vb = this.viewBox;
    return { pageWidth: vb[2] - vb[0], pageHeight: vb[3] - vb[1], pageX: vb[0], pageY: vb[1] };
  }
  clone({ scale = this.scale, rotation = this.rotation, offsetX = this.offsetX, offsetY = this.offsetY, dontFlip = false } = {}) {
    return new TileViewport({ viewBox: this.viewBox.slice(), scale, rotation, offsetX, offsetY, dontFlip });
  }
  convertToViewportPoint(x, y) {
    const m = this.transform;
    return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
  }
  convertToViewportRectangle(r) {
    const p1 = this.convertToViewportPoint(r[0], r[1]), p2 = this.convertToViewportPoint(r[2], r[3]);
    return [p1[0], p1[1], p2[0], p2[1]];
  }
  convertToPdfPoint(x, y) {
    const m = this.transform, det = m[0] * m[3] - m[1] * m[2];
    return [(x * m[3] - y * m[2] + m[2] * m[5] - m[4] * m[3]) / det,
            (-x * m[1] + y * m[0] + m[4] * m[1] - m[5] * m[0]) / det];
  }
}

/* meta: what /api/sheet-tiles answered; dataUrl: Store.dataUrl */
export function makeTilePage(meta, dataUrl) {
  const W = meta.w, H = meta.h, T = meta.tile;
  const levels = meta.levels.slice().sort((a, b) => a.dpi - b.dpi);
  const base = dataUrl(meta.path);
  const Viewport = TileViewport;

  const urlOf = (t) => `${base}?o=${t[0]}&n=${t[1]}&v=${encodeURIComponent(meta.bin)}`;

  /* the coarsest level that is at least as sharp as px per point asks */
  function levelFor(pxPerPt) {
    for (const L of levels) if (L.dpi / 72 >= pxPerPt * 0.98) return L;
    return levels[levels.length - 1];
  }

  /* the tiles of a level that cover a part of the page (in points) */
  function tilesIn(L, x0, y0, x1, y1) {
    const k = L.dpi / 72, out = [];
    // page points (y up) -> picture pixels (y down)
    const u0 = Math.max(0, Math.floor(x0 * k / T)), u1 = Math.min(L.nx - 1, Math.floor(x1 * k / T));
    const v0 = Math.max(0, Math.floor((H - y1) * k / T)), v1 = Math.min(L.ny - 1, Math.floor((H - y0) * k / T));
    for (let ty = v0; ty <= v1; ty++) {
      for (let tx = u0; tx <= u1; tx++) out.push({ tx, ty, t: L.tiles[ty * L.nx + tx] });
    }
    return out;
  }

  function paint(ctx, vp, L, list) {
    const k = 72 / L.dpi;
    ctx.save();
    ctx.setTransform(vp.transform[0], vp.transform[1], vp.transform[2], vp.transform[3], vp.transform[4], vp.transform[5]);
    // picture pixels -> page points
    ctx.transform(k, 0, 0, -k, 0, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const it of list) {
      if (!it.bmp) continue;
      // a hair of overlap hides the seams between pictures
      ctx.drawImage(it.bmp, it.tx * T, it.ty * T, it.bmp.width + 0.6, it.bmp.height + 0.6);
    }
    ctx.restore();
  }

  const page = {
    isTilePage: true,
    _dataUrl: dataUrl,
    meta,
    view: [0, 0, W, H],
    rotate: 0,
    getViewport({ scale = 1, rotation = 0, offsetX = 0, offsetY = 0, dontFlip = false } = {}) {
      return new Viewport({ viewBox: [0, 0, W, H], userUnit: 1, scale, rotation, offsetX, offsetY, dontFlip });
    },
    /* the same shape as pdf.js: {promise, cancel()} */
    render({ canvasContext: ctx, viewport: vp }) {
      const ac = new AbortController();
      let cancelled = false;
      const promise = (async () => {
        const cw = ctx.canvas.width, ch = ctx.canvas.height;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.restore();
        // the part of the page this canvas covers, in page points
        const corners = [vp.convertToPdfPoint(0, 0), vp.convertToPdfPoint(cw, 0),
                         vp.convertToPdfPoint(0, ch), vp.convertToPdfPoint(cw, ch)];
        const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
        const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs));
        const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
        if (x1 <= x0 || y1 <= y0) return;
        const want = levelFor(vp.scale);
        // what is already decoded, coarser, goes down first: no blank patches
        for (const L of levels) {
          if (L.dpi >= want.dpi) break;
          const have = tilesIn(L, x0, y0, x1, y1).map((it) => ({ ...it, bmp: it.t ? _bitmaps.get(`${meta.bin}|${it.t[0]}`) : null }));
          if (have.some((h) => h.bmp)) paint(ctx, vp, L, have);
        }
        const list = tilesIn(want, x0, y0, x1, y1);
        const got = await Promise.all(list.map(async (it) => {
          if (!it.t) return it;                       // all white
          try {
            it.bmp = await fetchTile(urlOf(it.t), meta.fmt, `${meta.bin}|${it.t[0]}`, ac.signal);
          } catch (e) { it.bmp = null; }
          return it;
        }));
        if (cancelled) {
          const err = new Error("Rendering cancelled");
          err.name = "RenderingCancelledException";
          throw err;
        }
        paint(ctx, vp, want, got);
      })();
      return { promise, cancel() { cancelled = true; ac.abort(); } };
    },
    cleanup() {},
    // text is in the PDF: read it only when asked
    async getTextContent() {
      if (!page.pdfPage) throw new Error("no PDF text in picture mode yet");
      return page.pdfPage.getTextContent();
    },
  };
  return page;
}

/* The pictures a view needs, fetched ahead (the whole sheet at the fitted
   size is a handful), so opening it again - or the split view - is instant. */
export function warmTiles(page, pxPerPt) {
  if (!page || !page.isTilePage) return;
  const m = page.meta;
  const L = m.levels.slice().sort((a, b) => a.dpi - b.dpi).find((l) => l.dpi / 72 >= pxPerPt) || m.levels[m.levels.length - 1];
  const base = page.meta.path;
  for (const t of L.tiles) {
    if (!t) continue;
    const key = `${m.bin}|${t[0]}`;
    if (_bitmaps.has(key)) continue;
    // fetched quietly; failures do not matter
    fetchTile(`${page._dataUrl ? page._dataUrl(base) : base}?o=${t[0]}&n=${t[1]}&v=${encodeURIComponent(m.bin)}`, m.fmt, key).catch(() => {});
  }
}
