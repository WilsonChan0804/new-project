/* Drawing links, as ACC and Dalux have them: every section mark, callout
 * and elevation marker on a sheet becomes a small tag naming the sheet it
 * refers to; a tap opens that sheet, zoomed onto the view.
 *
 * The exporter reads the references from Revit (the sheet and detail
 * number each mark prints) into manifest.json, per viewport, with where the
 * mark sits on the paper ("links": [{sheet, detail, view_name, box_mm}]).
 * Tags are drawn in a layer of their own above the markups, at a constant
 * size on screen, and work whatever tool is in use.
 */

export function createSheetLinks(ctx) {
  const { S, $, status } = ctx;
  const L = { on: true };

  const layer = () => $("#linklayer");

  function targets() {
    const have = new Set((S.manifest && S.manifest.sheets || []).filter((s) => s.pdf).map((s) => s.number));
    return have;
  }

  // Where the tags of one reference go, in paper mm: a section line gets
  // one at each end (where its heads are), anything else one at its
  // top-right corner (a callout's box) or centre (an elevation marker).
  function spots(link) {
    const [u0, v0, u1, v1] = link.box_mm;
    const w = u1 - u0, h = v1 - v0;
    if (link.kind === "elevation") return [[(u0 + u1) / 2, (v0 + v1) / 2]];
    const long = Math.max(w, h), short = Math.max(0.1, Math.min(w, h));
    if (long / short > 4) {
      return w >= h ? [[u0, (v0 + v1) / 2], [u1, (v0 + v1) / 2]]
                    : [[(u0 + u1) / 2, v0], [(u0 + u1) / 2, v1]];
    }
    return [[u1, v1]];
  }

  /* Marks drawn with their own text. Many offices label a section,
     elevation or callout mark with its Mark or Comments value - the sheet
     number typed in by hand - rather than Revit's own reference, which
     then points at a working view that is on no sheet. So the words
     printed on the drawing are read too (the server keeps them with their
     places), and any word that is a sheet number of this project - written
     the same or nearly so: "A-101", "a101", "3/A101" - becomes a link. */
  const norm = (t) => String(t || "").toUpperCase().replace(/[\s\-_.]/g, "");
  const loose = (t) => norm(t).replace(/(^|\D)0+(?=\d)/g, "$1");
  function sheetIndex() {
    const key = (S.manifest && S.manifest.sheets || []).length;
    if (L.idx && L.idxKey === key) return L.idx;
    const m = new Map();
    for (const sh of (S.manifest && S.manifest.sheets) || []) {
      if (!sh.pdf || !sh.number) continue;
      const n = norm(sh.number);
      // a sheet number needs a letter and a figure, or it would catch room
      // numbers and dimensions
      if (n.length < 3 || !/\d/.test(n) || !/[A-Z]/.test(n)) continue;
      m.set(n, sh);
      if (!m.has(loose(sh.number))) m.set(loose(sh.number), sh);
    }
    L.idx = m; L.idxKey = key;
    return m;
  }
  function wordLinks(sheet, words, sizePt) {
    const idx = sheetIndex();
    if (!idx.size || !words) return [];
    const PT = 25.4 / 72, H = sizePt[1];
    const out = [];
    /* Only marks: exports from 30 Sep list where every section, callout and
       elevation mark sits (mark_boxes); a word outside them - a grid bubble
       named like a sheet, a title - is not a link. Older exports: at least
       the grids they name are left out. */
    const vps = sheet.viewports || [];
    const known = vps.some((v) => Array.isArray(v.mark_boxes));
    const boxes = known ? vps.flatMap((v) => v.mark_boxes || []) : null;
    const grids = new Set();
    for (const v of vps) for (const c of v.calibration || []) {
      const m = /^grid_(.+)_end\d$/.exec(c.label || "");
      if (m) grids.add(norm(m[1]));
    }
    for (const w of words) {
      const [t, x, y, ww, hh] = w;
      if (!t || t.length < 3 || t.length > 24) continue;
      const cu = (x + ww / 2) * PT, cv = (H - y - hh / 2) * PT;
      if (boxes && !boxes.some((b) => cu >= b[0] - 3 && cu <= b[2] + 3 && cv >= b[1] - 3 && cv <= b[3] + 3)) continue;
      if (!boxes && grids.has(norm(t))) continue;
      const parts = String(t).split(/[\/\\]/).filter(Boolean);
      let hit = null, detail = "";
      for (const p of parts) {
        const sh = idx.get(norm(p)) || idx.get(loose(p));
        if (sh) { hit = sh; } else if (/^\d{1,3}$/.test(p)) detail = p;
      }
      if (!hit || hit.number === sheet.number) continue;
      out.push({ sheet: hit.number, detail, text: t, u: (x + ww) * PT, v: (H - y) * PT, kind: "word" });
      if (out.length >= 400) break;
    }
    return out;
  }
  function textLinks(sheet) {
    L.words = L.words || new Map();
    const k = sheet.pdf + "|" + (sheet.page || 1);
    if (L.words.has(k)) return L.words.get(k);
    L.words.set(k, null);
    if (ctx.wordsFor) {
      ctx.wordsFor(sheet).then((words) => {
        const sizePt = ctx.pageSizePt ? ctx.pageSizePt() : null;
        if (!sizePt || S.sheet !== sheet) { L.words.delete(k); return; }
        L.words.set(k, wordLinks(sheet, words, sizePt));
        draw();
      }).catch(() => {});
    }
    return null;
  }

  function draw() {
    const box = layer();
    if (!box) return;
    box.innerHTML = "";
    if (!L.on || !S.sheet || !S.viewport) return;
    const have = targets();
    const frag = document.createDocumentFragment();
    let n = 0;
    const placed = [];
    for (const vp of S.sheet.viewports || []) {
      for (const lk of vp.links || []) {
        if (!have.has(lk.sheet) || lk.sheet === S.sheet.number && !lk.view_name) continue;
        const label = (lk.detail ? lk.detail + "/" : "") + lk.sheet;
        for (const [u, v] of spots(lk)) {
          placed.push([u, v, lk.sheet]);
          const [x, y] = ctx.canvasFrom(u, v);
          const b = document.createElement("button");
          b.className = "sheet-link" + (lk.kind === "elevation" ? " elev" : "");
          b.textContent = label;
          b.title = "Open " + lk.sheet + (lk.view_name ? " - " + lk.view_name : "");
          b.style.left = Math.round(x) + "px";
          b.style.top = Math.round(y) + "px";
          b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          b.addEventListener("click", (ev) => { ev.stopPropagation(); follow(lk); });
          frag.appendChild(b);
          n++;
        }
      }
    }
    // the marks labelled by hand (see above)
    for (const lk of textLinks(S.sheet) || []) {
      if (!have.has(lk.sheet)) continue;
      // Revit's own reference already tagged here
      if (placed.some((p) => p[2] === lk.sheet && Math.hypot(p[0] - lk.u, p[1] - lk.v) < 15)) continue;
      const [x, y] = ctx.canvasFrom(lk.u, lk.v);
      const b = document.createElement("button");
      b.className = "sheet-link word";
      b.textContent = (lk.detail ? lk.detail + "/" : "") + lk.sheet;
      b.title = "Open " + lk.sheet + " (the mark reads \"" + lk.text + "\")";
      b.style.left = Math.round(x) + "px";
      b.style.top = Math.round(y) + "px";
      b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      b.addEventListener("click", (ev) => { ev.stopPropagation(); follow({ sheet: lk.sheet, view_name: "" }); });
      frag.appendChild(b);
      n++;
    }
    box.appendChild(frag);
    const btn = $("#links-toggle");
    if (btn) btn.dataset.count = n;
  }

  async function follow(lk) {
    const sheet = (S.manifest.sheets || []).find((s) => s.number === lk.sheet);
    if (!sheet) return;
    const from = S.sheet && S.sheet.number;
    L.back = from;
    await ctx.openSheet(sheet);
    // the view the mark refers to, on that sheet
    const vp = (sheet.viewports || []).find((v) => v.view_name === lk.view_name && v.paper_rect_mm);
    if (vp) {
      await new Promise((r) => setTimeout(r, 120));
      ctx.zoomToPaper(vp.paper_rect_mm);
    }
    const bk = $("#links-back");
    if (bk && from) { bk.hidden = false; bk.textContent = "← " + from; }
    status("From " + from + ": " + lk.sheet + (lk.view_name ? " - " + lk.view_name : ""));
  }

  function wire() {
    const t = $("#links-toggle");
    if (t) t.addEventListener("click", () => {
      L.on = !L.on;
      t.classList.toggle("active", L.on);
      draw();
    });
    const bk = $("#links-back");
    if (bk) bk.addEventListener("click", async () => {
      const s = (S.manifest.sheets || []).find((x) => x.number === L.back);
      bk.hidden = true;
      if (s) await ctx.openSheet(s);
    });
  }

  return { draw, wire, follow, get state() { return L; } };
}
