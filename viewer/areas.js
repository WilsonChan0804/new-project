/* Area plans and their schedules, linked the way Revit links them.
 *
 * The exporter writes, for each sheet, the areas drawn on its area plans
 * (number, name, m2 and the boundary as paper millimetres) and the area
 * schedules placed on it (each row's cells, and which areas the row is).
 * Here:
 *   - a click on a schedule row lights up that area's boundary on the plan
 *     (and on every plan of this sheet that shows it);
 *   - a click inside an area on the plan (Select tool, empty paper) lights
 *     up the area and its schedule row;
 *   - Esc, or a click on the paper outside every area, turns it off.
 *
 * Where each row sits on the paper is read from the words the server
 * found on the sheet (the area number printed in the row), so it matches
 * the PDF exactly; the exporter's own estimate is used only when the
 * number is not found. The same rows and boundaries go into the PDF
 * download as links that show and hide the boundaries (see pdfAreas).
 */

const PT = 25.4 / 72;
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toUpperCase();

/* point in polygon, even-odd, over all loops */
export function insideLoops(loops, u, v) {
  let n = 0;
  for (const L of loops || []) {
    for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
      const [xi, yi] = L[i], [xj, yj] = L[j];
      if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) n++;
    }
  }
  return n % 2 === 1;
}

function loopArea(L) {
  let a = 0;
  for (let i = 0, j = L.length - 1; i < L.length; j = i++) a += (L[j][0] + L[i][0]) * (L[j][1] - L[i][1]);
  return Math.abs(a / 2);
}

/* Where each schedule row is on the paper: [{row, sched, box:[u0,v0,u1,v1]}].
   words: the server's [text, x, y, w, h] in points from the top left;
   hPt: the page height in points. */
export function locateRows(sheet, words, hPt) {
  const out = [];
  const areas = sheet.areas || [];
  const byUid = new Map(areas.map((a) => [a.uid, a]));
  for (const sc of sheet.schedules || []) {
    const r = sc.rect_mm;
    if (!r) continue;
    const [x0, y0, x1, y1] = r;
    // the words inside this schedule, as paper mm boxes
    const inside = [];
    for (const w of words || []) {
      const [t, x, y, ww, hh] = w;
      const u0 = x * PT, u1 = (x + ww) * PT, v1 = (hPt - y) * PT, v0 = (hPt - y - hh) * PT;
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      if (cu < x0 - 1 || cu > x1 + 1 || cv < y0 - 1 || cv > y1 + 1) continue;
      inside.push({ t: norm(t), box: [u0, v0, u1, v1], used: false });
    }
    const rowH = (sc.row_h_mm || 0) || 4;
    // the schedule's title is above the body: its words never place a row
    const body = isFinite(sc.body_top_mm) ? inside.filter((w) => (w.box[1] + w.box[3]) / 2 < sc.body_top_mm + 0.5) : inside;
    const count = new Map();
    for (const w of body) count.set(w.t, (count.get(w.t) || 0) + 1);
    const numeric = (c) => /^[\d.,\s]+(M2|M²|SQM|SQ\.?M|%)?$/.test(c);
    for (const row of sc.rows || []) {
      if (!row.uids || !row.uids.length) continue;
      const cells = (row.cells || []).map(norm).filter(Boolean);
      // the area numbers this row prints, else its rarest word that is not a figure
      const nums = row.uids.map((u) => byUid.get(u)).filter(Boolean).map((a) => norm(a.number))
        .filter((n) => n && cells.indexOf(n) >= 0);
      let keys = nums;
      if (!keys.length) {
        const toks = [];
        for (const c of cells) if (!numeric(c)) for (const t of c.split(" ")) if (t.length > 1 && !numeric(t)) toks.push(t);
        toks.sort((a, b) => (count.get(a) || 99) - (count.get(b) || 99));
        keys = toks.filter((t) => count.has(t)).slice(0, 2);
      }
      let cands = body.filter((w) => !w.used && keys.indexOf(w.t) >= 0);
      // the title's height was only estimated: when nothing is found under
      // it, every word of the schedule is looked at
      if (!cands.length && body !== inside) cands = inside.filter((w) => !w.used && keys.indexOf(w.t) >= 0);
      if (row.box_mm && cands.length) {
        const cy = (row.box_mm[1] + row.box_mm[3]) / 2;
        const near = cands.filter((w) => Math.abs((w.box[1] + w.box[3]) / 2 - cy) < rowH * 3);
        if (near.length) cands = near;
        cands.sort((a, b) => Math.abs((a.box[1] + a.box[3]) / 2 - cy) - Math.abs((b.box[1] + b.box[3]) / 2 - cy));
      }
      let box = null;
      if (cands.length) {
        const pick = cands[0];
        // every word on the same line goes with it
        const cv = (pick.box[1] + pick.box[3]) / 2;
        for (const w of body) if (Math.abs((w.box[1] + w.box[3]) / 2 - cv) < (pick.box[3] - pick.box[1]) * 0.4) w.used = true;
        const est = row.box_mm ? row.box_mm[3] - row.box_mm[1] : rowH;
        const half = Math.max((pick.box[3] - pick.box[1]) * 0.85, Math.min(est, rowH * 1.6) / 2);
        box = [x0, cv - half, x1, cv + half];
      } else if (row.box_mm) {
        box = row.box_mm.slice();
      } else if (isFinite(row.i) && sc.n_rows) {
        // no word to go by and no height (a split schedule): its place in
        // the list, spread over the schedule's body
        const topv = isFinite(sc.body_top_mm) ? sc.body_top_mm : y1;
        const step = (topv - y0) / sc.n_rows;
        const cv = topv - (row.i + 0.5) * step;
        box = [x0, cv - step / 2, x1, cv + step / 2];
      }
      if (box) out.push({ row, sched: sc, box });
    }
  }
  return out;
}

/* ?areadebug in the address: every linked schedule row outlined, with how
   many areas it lights - to see at a glance which rows were not linked */
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("areadebug");
if (DEBUG && typeof document !== "undefined") document.documentElement.classList.add("areas-debug");

export function createAreas(ctx) {
  const { S, $, status } = ctx;
  const A = { on: true, cur: null, rows: new Map(), note: null };   // cur: the uids lit

  const sheetKey = (sh) => sh.number + "|" + (sh.pdf || "");
  const has = (sh) => sh && ((sh.areas && sh.areas.length) || (sh.schedules && sh.schedules.length));

  function rowsFor(sh) {
    const k = sheetKey(sh);
    if (A.rows.has(k)) return A.rows.get(k);
    A.rows.set(k, null);
    const hPt = ctx.pageSizePt && ctx.pageSizePt();
    ctx.wordsFor(sh).then((words) => {
      const h = (ctx.pageSizePt && ctx.pageSizePt()) || hPt;
      if (!h) { A.rows.delete(k); return; }
      A.rows.set(k, locateRows(sh, words || [], h[1]));
      if (S.sheet === sh) draw();
    }).catch(() => { A.rows.set(k, locateRows(sh, [], (hPt || [0, 0])[1])); });
    return null;
  }

  const svgNS = "http://www.w3.org/2000/svg";
  function layers() {
    let svg = document.getElementById("area-layer");
    let div = document.getElementById("area-hot");
    if (!svg) {
      const page = $("#page");
      if (!page) return {};
      svg = document.createElementNS(svgNS, "svg");
      svg.id = "area-layer";
      const before = document.getElementById("find-layer");
      page.insertBefore(svg, before || page.firstChild);
      div = document.createElement("div");
      div.id = "area-hot";
      page.appendChild(div);
    }
    return { svg, div };
  }

  function path(loops) {
    return loops.map((L) => L.map(([u, v], i) => {
      const [x, y] = ctx.canvasFrom(u, v);
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ") + " Z").join(" ");
  }

  function selected(sh) {
    if (!A.cur || !A.cur.length) return [];
    return (sh.areas || []).filter((a) => A.cur.indexOf(a.uid) >= 0);
  }

  function draw() {
    const { svg, div } = layers();
    if (!svg) return;
    svg.innerHTML = ""; div.innerHTML = "";
    const sh = S.sheet;
    if (!A.on || !sh || !S.viewport || !has(sh)) { svg.style.display = "none"; return; }
    svg.style.display = "";
    const w = Math.round(S.viewport.width), h = Math.round(S.viewport.height);
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const rows = rowsFor(sh) || [];
    const live = !S.tool || S.tool === "select";
    // the lit area
    for (const a of selected(sh)) {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", path(a.loops || []));
      p.setAttribute("class", "area-lit");
      p.setAttribute("fill-rule", "evenodd");
      svg.appendChild(p);
    }
    // the row lit: the one clicked, or the most specific row listing the area clicked on the plan
    const litRows = new Set();
    if (A.cur && A.cur.length) {
      if (A.row && rows.indexOf(A.row) >= 0) litRows.add(A.row);
      else { const r0 = rowsListing(sh, A.cur[0])[0]; if (r0) litRows.add(r0); }
    }
    // schedule rows: a hot strip each, lit when it is the current area
    for (const R of rows) {
      const [u0, v0, u1, v1] = R.box;
      const a = ctx.canvasFrom(u0, v1), b = ctx.canvasFrom(u1, v0);
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      const ww = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
      const on = litRows.has(R);
      if (on) {
        const r = document.createElementNS(svgNS, "rect");
        r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", ww); r.setAttribute("height", hh);
        r.setAttribute("class", "area-row-lit");
        svg.appendChild(r);
      }
      if (!live) continue;
      const d = document.createElement("div");
      d.className = "area-row" + (on ? " on" : "");
      d.style.left = x + "px"; d.style.top = y + "px"; d.style.width = ww + "px"; d.style.height = hh + "px";
      const ars = (sh.areas || []).filter((q) => R.row.uids.indexOf(q.uid) >= 0);
      d.title = ars.length > 1 ? `Show these ${new Set(ars.map((q) => q.uid)).size} areas on the plan`
        : ars.length ? `Show ${ars[0].number || ""} ${ars[0].name || ""} on the plan`.replace(/\s+/g, " ") : "Show this area on the plan";
      if (DEBUG) { d.dataset.n = R.row.uids.length; d.title += `  [${R.row.uids.length} area(s); ${(R.row.cells || []).filter(Boolean).join(" | ")}]`; }
      d.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      d.addEventListener("click", (ev) => { ev.stopPropagation(); A.row = R; pick(R.row.uids, true); });
      div.appendChild(d);
    }
  }

  function describe(a) {
    const m2 = a.area_m2 != null ? `${Number(a.area_m2).toFixed(3)} m²` : "";
    return [a.number, a.name, m2].filter(Boolean).join(" · ");
  }

  /* light up areas (uids) - from a row (brought into view) or the plan */
  function pick(uids, fromRow, clicked) {
    const sh = S.sheet;
    if (!sh) return;
    uids = Array.isArray(uids) ? uids.slice() : [uids];
    const same = A.cur && A.cur.length === uids.length && uids.every((u) => A.cur.indexOf(u) >= 0);
    A.cur = same && !fromRow ? null : uids;
    A.clicked = A.cur ? (clicked || null) : null;
    draw();
    showInfo(sh);
    const list = selected(sh);
    if (!list.length) { status(A.cur ? "That area is not drawn on a plan on this sheet." : ""); return; }
    const n = new Set(list.map((a) => a.uid)).size;
    if (n > 1) {
      const tot = list.filter((a, i) => list.findIndex((b) => b.uid === a.uid) === i).reduce((t, a) => t + (Number(a.area_m2) || 0), 0);
      status(`${n} areas lit: ` + Array.from(new Set(list.map((a) => [a.number, a.name].filter(Boolean).join(" ")))).slice(0, 6).join(", ")
        + (n > 6 ? " ..." : "") + `  (together ${tot.toFixed(3)} m\u00B2)  -  Esc to clear`);
    } else {
      status((list[0].kind === "room" ? "Room " : "Area ") + describe(list[0]) + (list.length > 1 ? `  (on ${list.length} plans here)` : "") + "  -  Esc to clear");
    }
    if (fromRow && ctx.revealPaper) {
      // bring the boundary into view if it is off screen
      const pts = list.flatMap((a) => (a.loops || []).flat());
      if (pts.length) {
        const us = pts.map((p) => p[0]), vs = pts.map((p) => p[1]);
        ctx.revealPaper([Math.min(...us), Math.min(...vs), Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)]);
      }
    }
  }

  /* a click on empty paper with the Select tool; true when it hit an area */
  function clickAt(u, v) {
    const sh = S.sheet;
    if (!A.on || !has(sh)) return false;
    // the smallest area holding the point (areas can sit inside others)
    let best = null, bestA = Infinity;
    for (const a of sh.areas || []) {
      if (!insideLoops(a.loops, u, v)) continue;
      const ar = (a.loops || []).reduce((s, L) => s + loopArea(L), 0);
      if (ar < bestA) { bestA = ar; best = a; }
    }
    if (!best) { if (A.cur) { A.cur = null; draw(); } return false; }
    // an area listed with others on one schedule row (a flat's rooms,
    // balcony and utility platform) lights up with them
    // (only those on the plan clicked: never the same room on another floor)
    // A click on the plan picks that one area or room; its schedule row
    // (which may list a whole flat or floor) is lit to show where it is
    // listed. Clicking the row itself lights everything the row lists.
    const uids = [best.uid];
    A.row = null;
    pick(uids, false, best);
    return true;
  }

  const GROUP_MAX = 12;
  /* the schedule rows listing an area, the most specific (fewest areas) first */
  function rowsListing(sh, uid) {
    return (rowsFor(sh) || []).filter((R) => R.row.uids.indexOf(uid) >= 0)
      .sort((a, b) => a.row.uids.length - b.row.uids.length);
  }

  function clear() { if (A.cur) { A.cur = null; draw(); showInfo(S.sheet); return true; } return false; }

  function sheetOpened() { A.cur = null; showInfo(null); }

  /* The lit area's properties - every parameter Revit gave it - at the top
     of the right-hand column, as the 3D page shows a clicked element's. */
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function showInfo(sh) {
    let box = document.getElementById("area-info");
    const host = document.getElementById("items");
    if (!box && host) {
      box = document.createElement("div");
      box.id = "area-info";
      box.hidden = true;
      host.insertBefore(box, host.firstChild);
      if (ctx.vgrip) { try { ctx.vgrip(box); } catch (e) {} }
    }
    if (!box) return;
    const list = sh ? selected(sh) : [];
    // one entry per area (an area on two plans of the sheet is one area)
    const seen = new Set(), areas = [];
    for (const a of list) if (!seen.has(a.uid)) { seen.add(a.uid); areas.push(a); }
    let inner = box.querySelector(".ai-inner");
    if (!inner) { inner = document.createElement("div"); inner.className = "ai-inner"; box.insertBefore(inner, box.firstChild); }
    if (!areas.length) { box.hidden = true; inner.innerHTML = ""; return; }
    const first = A.clicked && seen.has(A.clicked.uid) ? A.clicked.uid : areas[0].uid;
    areas.sort((a, b) => (a.uid === first ? -1 : b.uid === first ? 1 : 0));
    const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    const one = (a, open) => {
      const basics = [["Number", a.number], ["Name", a.name], ["Area", a.area_m2 != null ? Number(a.area_m2).toFixed(3) + " m\u00B2" : ""],
        ["Level", a.level], ["Area scheme", a.scheme]].filter((x) => x[1]);
      const params = (a.params || []).filter((p) => !basics.some((b) => b[0] === p[0]));
      return `<div class="pset${open ? "" : " closed"}"><div class="pset-head"><span class="caret">&#9662;</span>`
        + `${esc([a.number, a.name].filter(Boolean).join(" ") || "Area")}<span class="count">${params.length + basics.length}</span></div>`
        + `<div class="pset-body">${basics.map((b) => kv(b[0], b[1])).join("")}`
        + (params.length ? params.map((p) => kv(p[0], p[1])).join("")
          : `<div class="muted" style="font-size:10.5px;padding:4px 0">Publish the area plans again for every parameter.</div>`)
        + `</div></div>`;
    };
    const tot = areas.reduce((t, a) => t + (Number(a.area_m2) || 0), 0);
    box.hidden = false;
    const noun = areas.every((a) => a.kind === "room") ? "room" : areas.some((a) => a.kind === "room") ? "area/room" : "area";
    inner.innerHTML = `<div class="ai-head"><b>${areas.length > 1 ? areas.length + " " + noun + "s" : noun[0].toUpperCase() + noun.slice(1)}</b>`
      + (areas.length > 1 ? `<span class="muted">together ${tot.toFixed(3)} m\u00B2</span>` : "")
      + `<span class="spacer"></span><button class="ghost linkish" id="ai-close" title="Clear (Esc)">&#10005;</button></div>`
      + (() => {
        // which schedule row lists it - or that none does (a row the exporter could not match)
        const rows = rowsListing(sh, areas[0].uid);
        return `<div class="ai-row muted">${rows.length
          ? rows.slice(0, 3).map((R) => "In schedule: " + esc(R.sched.name || "") + " - "
              + esc((R.row.cells || []).filter(Boolean).join(" | "))
              + (R.row.uids.length > 1 ? ` <i>(row of ${R.row.uids.length})</i>` : "")).join("<br>")
          : "Not linked to a row of a schedule on this sheet"}</div>`;
      })()
      + `<div class="ai-body">${areas.map((a, i) => one(a, i === 0)).join("")}</div>`;
    box.querySelector("#ai-close").onclick = () => clear();
    for (const h of box.querySelectorAll(".pset-head")) h.onclick = () => h.parentNode.classList.toggle("closed");
  }

  return { draw, clickAt, clear, pick, sheetOpened, has, rowsFor, get state() { return A; } };
}

/* ------------------------------------------------------------ PDF download
   Each area becomes a hidden Polygon annotation (one per boundary loop)
   drawn in orange; each schedule row and each area's label spot becomes a
   Link that first hides every area of the page and then shows its own - so
   in Acrobat, clicking a row lights up its boundary, as in Revit. The
   "hide all" list is one shared object, so the file grows with the number
   of areas, not its square. Browser PDF viewers ignore show/hide actions:
   there the boundaries simply stay hidden. */
export function pdfAreas(P, doc, page, sheet, rows) {
  const areas = sheet.areas || [];
  if (!areas.length) return 0;
  const ctx = doc.context;
  const MM_PT = 72 / 25.4;
  const box = page.getCropBox();
  const toPt = ([x, y]) => [x * MM_PT + box.x, y * MM_PT + box.y];
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const gs = ctx.register(ctx.obj({ Type: "ExtGState", ca: 0.28, CA: 1 }));
  const byUid = new Map();
  const all = [];
  for (const a of areas) {
    for (const L of a.loops || []) {
      if (!L || L.length < 3) continue;
      const pts = L.map(toPt);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const rect = [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
      const pathOps = pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ") + " h";
      const ap = ctx.stream(`q /G0 gs 0.95 0.5 0.13 rg ${pathOps} f Q q 0.9 0.4 0.05 RG 2.2 w 1 j ${pathOps} S Q`, {
        Type: "XObject", Subtype: "Form", BBox: rect, Matrix: [1, 0, 0, 1, 0, 0],
        Resources: { ExtGState: { G0: gs } },
      });
      const ref = ctx.register(ctx.obj({
        Type: "Annot", Subtype: "Polygon", Rect: rect, F: 2 | 128,
        Vertices: pts.flat(), C: [0.9, 0.4, 0.05], IC: [0.95, 0.5, 0.13], CA: 1,
        BS: { W: 2.2 }, NM: P.PDFString.of("area-" + a.uid + "-" + all.length),
        Contents: P.PDFHexString.fromText([a.number, a.name, a.area_m2 != null ? Number(a.area_m2).toFixed(3) + " m2" : ""].filter(Boolean).join("  ")),
        AP: { N: ctx.register(ap) },
      }));
      page.node.addAnnot(ref);
      all.push(ref);
      if (!byUid.has(a.uid)) byUid.set(a.uid, []);
      byUid.get(a.uid).push(ref);
    }
  }
  if (!all.length) return 0;
  const allRef = ctx.register(ctx.obj(all));
  const actionFor = (uids) => {
    const mine = [].concat(...[].concat(uids).map((u) => byUid.get(u) || []));
    if (!mine.length) return null;
    const show = ctx.register(ctx.obj({ S: "Hide", T: mine.length === 1 ? mine[0] : mine, H: false }));
    return ctx.obj({ S: "Hide", T: allRef, H: true, Next: show });
  };
  const link = (rectMM, uid, tip) => {
    const A = actionFor(uid);
    if (!A) return;
    const a = toPt([rectMM[0], rectMM[1]]), b = toPt([rectMM[2], rectMM[3]]);
    const ref = ctx.register(ctx.obj({
      Type: "Annot", Subtype: "Link", Rect: [a[0], a[1], b[0], b[1]], Border: [0, 0, 0], F: 4, A,
      Contents: P.PDFHexString.fromText(tip || ""),
    }));
    page.node.addAnnot(ref);
  };
  let n = 0;
  for (const R of rows || []) { link(R.box, R.row.uids, "Show this area on the plan"); n++; }
  for (const a of areas) {
    if (!a.label) continue;
    const [u, v] = a.label;
    link([u - 6, v - 4, u + 6, v + 4], a.uid, "Show this area");
  }
  return n;
}
