import { dayTime } from "./dates.js";
import { openMenu } from "./ctxmenu.js";
/* Sheet version compare - the overlay Bluebeam and ACC call "compare".
 *
 * The sheet on screen (current) and an earlier PDF of it are rendered at
 * the same size and laid over each other pixel by pixel:
 *
 *   red    ink only in the earlier drawing  - removed
 *   green  ink only in the current drawing  - added
 *   grey   ink in both                      - unchanged, faded back
 *
 * Where the earlier drawing comes from:
 *   - the server's history: every upload that changes a sheet's drawing
 *     keeps the PDF it replaces (see keep_version in server/app.py);
 *   - another sheet of this project - an imported PDF of the last issue,
 *     say;
 *   - a PDF file on this computer or tablet.
 *
 * The result is one canvas laid over the page, below the markups, stretched
 * with the page as it zooms (so markups can still be drawn on top). The
 * changed areas are grouped into boxes; the arrows step through them.
 *
 * A one-pixel tolerance is applied either way before calling ink "new" or
 * "gone", so anti-aliasing and a hair of shift between two exports do not
 * outline every line on the sheet in red and green.
 */

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// Pixels the comparison is worked at: three copies of the page are held
// at once, so the budget is well below the page canvas's.
const MAX_PX = IS_IOS ? 6e6 : 16e6;
const DPI = 200;

const RED = [214, 32, 32];
const GREEN = [18, 150, 60];
const GREY = [150, 154, 160];

export function createCompare(ctx) {
  const { S, $, status, Store } = ctx;
  const C = {
    on: false,
    src: null,          // { kind: "version"|"sheet"|"file", id, label, url?, data?, sheet? }
    view: "diff",       // diff | old | new
    key: "",            // what the canvas currently shows
    boxes: [],          // changed areas, as fractions of the page {x, y, w, h}
    idx: -1,
    oldDoc: null, oldKey: "",
    seq: 0,
    fileData: null, fileName: "",
    versions: [],
    align: null,        // [a, b, e, f]: the other drawing moved, scaled, turned to fit (see alignKey)
    picking: null,      // picking points to line them up: { stage: "old"|"new", old: [], new: [] }
    nudge: false,
  };

  const bar = () => $("#cmp-bar");
  const canvas = () => $("#cmp");
  const setStatus = (m) => { const el = $("#cmp-status"); if (el) el.textContent = m || ""; };

  /* ----------------------------------------------------------- sources */

  async function loadVersions(sheet) {
    C.versions = [];
    if (!sheet || !sheet.pdf || !/^sheets\//i.test(sheet.pdf)) return;
    try {
      const r = await Store.api("/api/versions?pdf=" + encodeURIComponent(sheet.pdf));
      C.versions = (r && r.versions) || [];
    } catch (e) {
      // The simple local server (serve.py) has no history; nothing to list.
      C.versions = [];
    }
  }

  const when = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return dayTime(d);
  };

  function fillSources() {
    const sel = $("#cmp-src");
    const sheet = S.sheet;
    sel.innerHTML = "";
    const opt = (v, t, parent) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      (parent || sel).appendChild(o);
      return o;
    };
    opt("", "Compare with ...");
    if (C.versions.length) {
      const g = document.createElement("optgroup");
      g.label = "Earlier versions of " + sheet.number;
      C.versions.forEach((v) => opt("version:" + v.id, "Uploaded " + when(v.at), g));
      sel.appendChild(g);
    }
    const others = (S.manifest.sheets || []).filter((s) => s !== sheet && s.pdf);
    if (others.length) {
      const g = document.createElement("optgroup");
      g.label = "Another sheet in this project";
      others.forEach((s) => opt("sheet:" + s.number, s.number + "  " + (s.name || ""), g));
      sel.appendChild(g);
    }
    const g = document.createElement("optgroup");
    g.label = "From this device";
    if (C.fileData) opt("file:last", C.fileName, g);
    opt("file:pick", "Choose a PDF file ...", g);
    sel.appendChild(g);
  }

  function sourceFor(value) {
    if (!value) return null;
    const [kind, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    if (kind === "version") {
      const v = C.versions.find((x) => x.id === id);
      return v && { kind, id, label: "uploaded " + when(v.at), url: Store.dataUrl(v.path) };
    }
    if (kind === "sheet") {
      const s = S.manifest.sheets.find((x) => x.number === id);
      return s && { kind, id, label: s.number, url: Store.dataUrl(s.pdf), page: s.page || 1 };
    }
    if (kind === "file" && id === "last" && C.fileData) {
      return { kind, id: C.fileName, label: C.fileName, data: C.fileData };
    }
    return null;
  }

  async function oldPage() {
    const src = C.src;
    const key = src.kind + ":" + src.id;
    if (C.oldKey !== key || !C.oldDoc) {
      if (C.oldDoc) { try { C.oldDoc.destroy(); } catch (e) {} }
      C.oldDoc = null; C.oldKey = "";
      const task = src.data
        ? pdfjsLib.getDocument({ data: src.data.slice(0) })
        : pdfjsLib.getDocument(src.url);
      C.oldDoc = await task.promise;
      C.oldKey = key;
    }
    return C.oldDoc.getPage(src.page || 1);
  }

  /* --------------------------------------------------------- rendering */

  async function renderTo(page, scale, rotation, w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    await page.render({ canvasContext: g, viewport: page.getViewport({ scale, rotation }) }).promise;
    return c;
  }

  // Ink 0..255 from a rendered page: dark and coloured lines alike.
  function inkOf(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      const a = d[i + 3] / 255;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      out[j] = Math.round((255 - lum) * a);
    }
    return out;
  }

  // 3 x 3 maximum: the one-pixel tolerance.
  function grow(src, w, h) {
    const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let m = src[o + x];
        if (x > 0 && src[o + x - 1] > m) m = src[o + x - 1];
        if (x < w - 1 && src[o + x + 1] > m) m = src[o + x + 1];
        tmp[o + x] = m;
      }
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let m = tmp[o + x];
        if (y > 0 && tmp[o - w + x] > m) m = tmp[o - w + x];
        if (y < h - 1 && tmp[o + w + x] > m) m = tmp[o + w + x];
        out[o + x] = m;
      }
    }
    return out;
  }

  /* The changed areas: the page cut into cells about 4 mm square, a cell
     counts if it holds a few changed pixels, touching cells (with one
     cell of slack) are joined, and each group becomes a box. */
  function findBoxes(changed, w, h, cell) {
    const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
    const count = new Uint16Array(cw * ch);
    for (let y = 0; y < h; y++) {
      const cy = (y / cell) | 0, o = y * w;
      for (let x = 0; x < w; x++) {
        if (changed[o + x]) count[cy * cw + ((x / cell) | 0)]++;
      }
    }
    const hot = new Uint8Array(cw * ch);
    for (let i = 0; i < hot.length; i++) hot[i] = count[i] >= 4 ? 1 : 0;
    const seen = new Uint8Array(cw * ch);
    const boxes = [];
    const stack = [];
    for (let i = 0; i < hot.length; i++) {
      if (!hot[i] || seen[i]) continue;
      let x0 = cw, y0 = ch, x1 = -1, y1 = -1, n = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        const kx = k % cw, ky = (k / cw) | 0;
        n += count[k];
        if (kx < x0) x0 = kx; if (kx > x1) x1 = kx;
        if (ky < y0) y0 = ky; if (ky > y1) y1 = ky;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = kx + dx, ny = ky + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const j = ny * cw + nx;
          if (hot[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      boxes.push({ x: x0 * cell / w, y: y0 * cell / h,
                   w: (x1 - x0 + 1) * cell / w, h: (y1 - y0 + 1) * cell / h, n });
    }
    // Reading order: top to bottom in bands, left to right within a band.
    boxes.sort((a, b) => (Math.round(a.y * 12) - Math.round(b.y * 12)) || (a.x - b.x));
    return boxes.slice(0, 400);
  }

  async function run() {
    const my = ++C.seq;
    const page = S.page, sheet = S.sheet;
    if (!C.on || !page || !sheet) return;
    const cv = canvas();
    if (C.view === "new" || !C.src) {
      cv.hidden = true; C.key = ""; C.boxes = []; C.idx = -1; paintCount(); ctx.redraw();
      if (!C.src) setStatus("Choose an earlier version, another sheet or a PDF file to compare with.");
      return;
    }
    C.align = savedAlign();
    const key = [sheet.number, S.rotation, C.src.kind, C.src.id, C.view, JSON.stringify(C.align)].join("|");
    if (key === C.key && !cv.hidden) return;

    setStatus("Comparing ...");
    const rot = S.rotation;
    const v1 = page.getViewport({ scale: 1, rotation: rot });
    const k = Math.min(DPI / 72, Math.sqrt(MAX_PX / (v1.width * v1.height)));
    const w = Math.max(1, Math.floor(v1.width * k)), h = Math.max(1, Math.floor(v1.height * k));

    let op;
    try { op = await oldPage(); }
    catch (e) { setStatus("Could not open " + C.src.label + ": " + e.message); return; }
    if (my !== C.seq) return;
    const o1 = op.getViewport({ scale: 1, rotation: rot });
    const ko = k * v1.width / o1.width;          // same width; heights checked below
    const aspect = Math.abs(o1.height / o1.width - v1.height / v1.width) / (v1.height / v1.width);
    let note = "";
    if (aspect > 0.01 && !C.align) note = " The two pages are different sizes, so they may not line up - Align \u25be lines them up by two points.";
    if (C.align) note = " Lined up by two points.";

    let oldC, newC;
    try {
      // drawn at the size it will show (an alignment that enlarges it would
      // otherwise stretch a small picture, and blur every line)
      const sA = C.align ? Math.max(0.05, Math.min(20, Math.hypot(C.align[0], C.align[1]))) : 1;
      const ow = Math.max(1, Math.min(8192, Math.floor(o1.width * ko * sA))), oh = Math.max(1, Math.min(8192, Math.floor(o1.height * ko * sA)));
      oldC = await renderTo(op, ko * sA, rot, ow, oh);
      oldC = placed(oldC, w, h, sA);
      if (my !== C.seq) return;
      if (C.view === "old") {
        show(oldC, w, h);
        C.boxes = []; C.idx = -1; C.key = key;
        paintCount(); ctx.redraw();
        setStatus("Showing the earlier drawing (" + C.src.label + ")." + note);
        return;
      }
      // the exact lines of the PDF, not the server's pictures of it
      const cur = page.isTilePage && page.loadPdfPage ? await page.loadPdfPage() : page;
      newC = await renderTo(cur, k, rot, w, h);
    } catch (e) {
      setStatus("Could not draw the comparison: " + (e && e.message));
      return;
    }
    if (my !== C.seq) return;

    const a = inkOf(oldC), b = inkOf(newC);
    oldC.width = 0; oldC.height = 0;
    const aG = grow(a, w, h), bG = grow(b, w, h);
    const g = newC.getContext("2d");
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const changed = new Uint8Array(w * h);
    const fR = RED.map((c) => 1 - c / 255), fG = GREEN.map((c) => 1 - c / 255),
          fS = GREY.map((c) => 1 - c / 255);
    const TH = 70;
    let nChanged = 0;
    for (let j = 0, i = 0; j < changed.length; j++, i += 4) {
      const rem = Math.max(0, a[j] - bG[j]);
      const add = Math.max(0, b[j] - aG[j]);
      const same = Math.max(0, b[j] - add);
      if (rem > TH || add > TH) { changed[j] = 1; nChanged++; }
      const r = rem / 255, ad = add / 255, s = same / 255 * 0.8;
      for (let c = 0; c < 3; c++) {
        d[i + c] = 255 * (1 - r * fR[c]) * (1 - ad * fG[c]) * (1 - s * fS[c]);
      }
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    show(newC, w, h);
    const cell = Math.max(6, Math.round(k * 72 / 25.4 * 4));
    C.boxes = nChanged ? findBoxes(changed, w, h, cell) : [];
    C.idx = -1;
    C.key = key;
    paintCount();
    ctx.redraw();
    setStatus((C.boxes.length
      ? C.boxes.length + " changed area" + (C.boxes.length === 1 ? "" : "s")
      : "No differences found")
      + " against " + C.src.label + "." + note);
  }

  /* -------------------------------------------------- lining them up */

  /* The other drawing as it lies on this one: drawn through the alignment
     (a similarity: move, scale, turn), in units of the page's width, onto a
     white canvas the size of this page. Without one: from the top-left
     corner at the same width, as before. */
  function placed(src, w, h, sA = 1) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    const A = C.align;
    if (A) g.setTransform(A[0] / sA, A[1] / sA, -A[1] / sA, A[0] / sA, A[2] * w, A[3] * w);
    g.drawImage(src, 0, 0);
    src.width = 0; src.height = 0;
    return c;
  }
  // the pair compared, and its alignment kept for everyone on the project
  function alignKey() {
    if (!S.sheet || !C.src) return "";
    const src = C.src.kind === "file" ? "file:" + C.fileName + ":" + (C.fileData ? C.fileData.length : 0) : C.src.kind + ":" + C.src.id;
    return [S.sheet.number, src, S.rotation || 0].join("|");
  }
  const alignId = (k) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return "cmpalign-" + (h >>> 0).toString(16) + k.length.toString(36);
  };
  function savedAlign() {
    const k = alignKey();
    if (!k) return null;
    const it = (Store.all() || []).find((x) => x.id === alignId(k) && !x.deleted);
    return it && Array.isArray(it.m) && it.m.length === 4 ? it.m : null;
  }
  async function keepAlign(m) {
    const k = alignKey();
    if (!k) return;
    try {
      await Store.put({ id: alignId(k), placement: "cmpalign", key: k, m: m || null, deleted: !m, author: Store.author() || "",
        updated_at: new Date().toISOString() });
    } catch (e) { status("Could not keep the alignment: " + e.message); }
    C.key = "";
    run();
  }
  // where a click is on the page, in units of its width (y down)
  function pagePoint(ev) {
    const r = $("#page").getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.width];
  }
  function marks() {
    let m = document.getElementById("cmp-marks");
    if (!C.picking) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement("div"); m.id = "cmp-marks"; $("#page").appendChild(m); }
    const r = $("#page").getBoundingClientRect();
    const pts = C.picking.stage === "old" ? C.picking.shown : C.picking.new;
    m.innerHTML = pts.map((p, i) => `<span class="cmp-x" style="left:${p[0] * 100}%;top:${(p[1] * r.width / r.height) * 100}%">${i + 1}</span>`).join("");
  }
  function pickStart() {
    if (!C.src) { status("Choose what to compare with first."); return; }
    C.picking = { stage: "old", old: [], shown: [], new: [] };
    setView("old");
    marks();
    setStatus("Line up: on the OTHER drawing (shown now), click point 1, e.g. a grid intersection. Esc stops.");
    status("Line up by two points: click point 1 on the other drawing.");
  }
  function pickClick(ev) {
    const P = C.picking;
    const say = (m) => { setStatus(m); status(m); };
    const q = pagePoint(ev);
    if (P.stage === "old") {
      // back through the alignment shown, to the other drawing's own place
      const A = C.align || [1, 0, 0, 0];
      const dx = q[0] - A[2], dy = q[1] - A[3], s2 = A[0] * A[0] + A[1] * A[1];
      P.old.push([(A[0] * dx + A[1] * dy) / s2, (-A[1] * dx + A[0] * dy) / s2]);
      P.shown.push(q);
      marks();
      if (P.old.length < 2) { say("Now point 2 on the other drawing - well apart from point 1."); return; }
      P.stage = "new";
      setView("new");
      marks();
      say("Now the same point 1 on THIS sheet.");
      return;
    }
    P.new.push(q);
    marks();
    if (P.new.length < 2) { say("And the same point 2 on this sheet."); return; }
    // z' = m z + t, from the two pairs (complex numbers: move, scale, turn)
    const [p1, p2] = P.old, [q1, q2] = P.new;
    const dp = [p2[0] - p1[0], p2[1] - p1[1]], dq = [q2[0] - q1[0], q2[1] - q1[1]];
    const d2 = dp[0] * dp[0] + dp[1] * dp[1];
    C.picking = null;
    marks();
    if (d2 < 1e-6) { setStatus("The two points were too close together - try again with points far apart."); setView("diff"); return; }
    const a = (dq[0] * dp[0] + dq[1] * dp[1]) / d2, b = (dq[1] * dp[0] - dq[0] * dp[1]) / d2;
    const m = [a, b, q1[0] - (a * p1[0] - b * p1[1]), q1[1] - (b * p1[0] + a * p1[1])];
    const sc = Math.hypot(a, b), deg = Math.atan2(b, a) * 180 / Math.PI;
    setView("diff");
    keepAlign(m);
    status(`Lined up: scaled ${(sc * 100).toFixed(1)}%, turned ${deg.toFixed(2)}\u00b0 - kept for this pair, for everyone.`);
  }
  function alignMenu(btn) {
    const r = btn.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, [
      { label: "Pick 2 points on each ...", title: "Click two matching points (grid intersections) on the other drawing, then on this sheet", action: pickStart },
      { label: "Nudge (arrow keys)", disabled: !C.align && !C.src, title: "Arrow keys move the other drawing 1 mm (Shift: 10 mm); Esc ends", action: () => { C.nudge = true; setStatus("Nudge: arrow keys move the other drawing 1 mm (Shift 10 mm). Esc ends."); } },
      "-",
      { label: "Reset (top-left, same width)", disabled: !savedAlign(), action: () => { keepAlign(null); status("Alignment cleared."); } },
    ]);
  }
  function nudgeKey(ev) {
    const page = S.page;
    if (!page) return;
    const v1 = page.getViewport({ scale: 1, rotation: S.rotation || 0 });
    const mm = (72 / 25.4) / v1.width;               // 1 mm in units of the page's width
    const step = (ev.shiftKey ? 10 : 1) * mm;
    const A = (C.align || savedAlign() || [1, 0, 0, 0]).slice();
    if (ev.key === "ArrowLeft") A[2] -= step; else if (ev.key === "ArrowRight") A[2] += step;
    else if (ev.key === "ArrowUp") A[3] -= step; else if (ev.key === "ArrowDown") A[3] += step;
    else return false;
    clearTimeout(C._nudgeT);
    C.align = A;
    C._nudgeT = setTimeout(() => keepAlign(A), 250);
    return true;
  }

  function show(src, w, h) {
    const cv = canvas();
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(src, 0, 0);
    src.width = 0; src.height = 0;
    cv.hidden = false;
  }

  /* ------------------------------------------------- the changed areas */

  function paintCount() {
    const n = C.boxes.length;
    $("#cmp-count").textContent = C.view === "diff" && C.src
      ? (n ? (C.idx >= 0 ? (C.idx + 1) + " / " + n : n + " changes") : "0 changes") : "";
    $("#cmp-prev").disabled = $("#cmp-next").disabled = !(n && C.view === "diff");
  }

  // Called by the sheet page's redraw: boxes round the changes, in page
  // pixels, so they stay thin at any zoom.
  function decorate(svg) {
    if (!C.on || C.view !== "diff" || !C.boxes.length || !$("#cmp-boxes").checked) return;
    const w = Number(svg.getAttribute("width")) || 0, h = Number(svg.getAttribute("height")) || 0;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "cmp-boxes");
    C.boxes.forEach((b, i) => {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const pad = 4;
      r.setAttribute("x", b.x * w - pad); r.setAttribute("y", b.y * h - pad);
      r.setAttribute("width", b.w * w + pad * 2); r.setAttribute("height", b.h * h + pad * 2);
      r.setAttribute("rx", 5);
      r.setAttribute("class", i === C.idx ? "cmp-box cur" : "cmp-box");
      g.appendChild(r);
    });
    svg.insertBefore(g, svg.firstChild);
  }

  function goTo(i) {
    const n = C.boxes.length;
    if (!n) return;
    C.idx = ((i % n) + n) % n;
    const b = C.boxes[C.idx];
    const sc = $("#scroll");
    const pw = S.viewport.width, ph = S.viewport.height;
    // Zoom so the area fills about half the view, never beyond 6x fit.
    const want = Math.min(sc.clientWidth * 0.5 / Math.max(1, b.w * pw),
                          sc.clientHeight * 0.5 / Math.max(1, b.h * ph));
    const next = Math.max(0.08, Math.min(12, S.scale * Math.min(want, 4)));
    ctx.setScale(next);
    const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
    const cx = (b.x + b.w / 2) * S.viewport.width, cy = (b.y + b.h / 2) * S.viewport.height;
    sc.scrollLeft += (P.left - R.left) + cx - sc.clientWidth / 2;
    sc.scrollTop += (P.top - R.top) + cy - sc.clientHeight / 2;
    paintCount();
    ctx.redraw();
  }

  /* ---------------------------------------------------------- the bar */

  async function onSheet() {
    if (!C.on) return;
    const keepFile = C.src && C.src.kind === "file" ? C.src : null;
    await loadVersions(S.sheet);
    fillSources();
    // Moving to another sheet: its own latest earlier version, or the same
    // file from this device if that was being used; otherwise ask.
    if (keepFile) { C.src = keepFile; $("#cmp-src").value = "file:last"; }
    else if (C.versions.length) {
      $("#cmp-src").value = "version:" + C.versions[0].id;
      C.src = sourceFor($("#cmp-src").value);
    } else { C.src = null; $("#cmp-src").value = ""; }
    C.key = "";
    run();
  }

  function toggle(on) {
    const want = on === undefined ? !C.on : on;
    C.on = want;
    bar().hidden = !want;
    $("#cmp-toggle").classList.toggle("active", want);
    if (!want) {
      canvas().hidden = true;
      C.key = ""; C.boxes = []; C.idx = -1; C.seq++;
      if (C.oldDoc) { try { C.oldDoc.destroy(); } catch (e) {} C.oldDoc = null; C.oldKey = ""; }
      const cv = canvas(); cv.width = 0; cv.height = 0;
      ctx.redraw();
      return;
    }
    if (!S.sheet) { status("Open a sheet first."); return; }
    C._pageKey = [S.sheet.number, S.rotation].join("|");
    onSheet();
  }

  function setView(v) {
    C.view = v;
    document.querySelectorAll("#cmp-view button").forEach((b) =>
      b.classList.toggle("active", b.dataset.v === v));
    document.querySelector("#cmp-legend").hidden = v !== "diff";
    run();
  }

  function wire() {
    $("#cmp-toggle").addEventListener("click", () => toggle());
    $("#cmp-close").addEventListener("click", () => toggle(false));
    $("#cmp-src").addEventListener("change", (ev) => {
      const v = ev.target.value;
      if (v === "file:pick") {
        $("#cmp-file").value = "";
        $("#cmp-file").click();
        // Back to what it was until a file is actually chosen.
        ev.target.value = C.src ? currentValue() : "";
        return;
      }
      C.src = sourceFor(v);
      C.key = "";
      run();
    });
    $("#cmp-file").addEventListener("change", async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      C.fileData = new Uint8Array(await f.arrayBuffer());
      C.fileName = f.name;
      fillSources();
      $("#cmp-src").value = "file:last";
      C.src = sourceFor("file:last");
      C.oldKey = "";                 // a new file under the same name
      C.key = "";
      run();
    });
    document.querySelectorAll("#cmp-view button").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.v)));
    const ab = $("#cmp-align");
    if (ab) ab.addEventListener("click", () => alignMenu(ab));
    // while lining up, a click on the page is a point, not a markup
    $("#scroll").addEventListener("pointerdown", (ev) => {
      if (!C.picking || ev.button !== 0) return;
      if (!ev.target.closest("#page")) return;
      ev.preventDefault(); ev.stopPropagation();
      pickClick(ev);
    }, true);
    document.addEventListener("keydown", (ev) => {
      if (!C.on) return;
      if (ev.key === "Escape" && (C.picking || C.nudge)) {
        C.picking = null; C.nudge = false; marks(); setView("diff"); setStatus("Stopped lining up."); ev.preventDefault(); ev.stopPropagation(); return;
      }
      if (C.nudge && nudgeKey(ev)) { ev.preventDefault(); ev.stopPropagation(); }
    }, true);
    $("#cmp-prev").addEventListener("click", () => goTo(C.idx < 0 ? C.boxes.length - 1 : C.idx - 1));
    $("#cmp-next").addEventListener("click", () => goTo(C.idx + 1));
    $("#cmp-boxes").addEventListener("change", () => ctx.redraw());
    // N / Shift+N step through the changes while comparing.
    document.addEventListener("keydown", (ev) => {
      if (!C.on || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (ev.key === "n" || ev.key === "N") {
        ev.preventDefault(); ev.stopPropagation();
        goTo(ev.shiftKey ? C.idx - 1 : C.idx + 1);
      }
    }, true);
  }

  function currentValue() {
    const s = C.src;
    if (!s) return "";
    if (s.kind === "file") return "file:last";
    return s.kind + ":" + s.id;
  }

  // The page was re-rendered (new sheet, rotation): refresh if it matters.
  function onPage() {
    if (!C.on) return;
    const key = [S.sheet && S.sheet.number, S.rotation].join("|");
    if (C._pageKey !== key) {
      const sheetChanged = !C._pageKey || C._pageKey.split("|")[0] !== String(S.sheet && S.sheet.number);
      C._pageKey = key;
      if (sheetChanged) onSheet(); else { C.key = ""; run(); }
    }
  }

  return { wire, toggle, onPage, decorate, goTo, get state() { return C; }, run };
}
