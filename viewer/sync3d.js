/* 2D + 3D side by side, as Dalux does it.
 *
 * The sheet stays on the left with all its tools; the model opens on the
 * right (model.html?embed=1 in a frame). The two are tied through each
 * plan viewport's own mapping, the same one issues use:
 *
 *   click on the sheet  -> the 3D view goes there: the walker stands on
 *                          that spot ("Stand there"), or the room around
 *                          it is framed ("Look at");
 *   move in 3D          -> a "you are here" marker on the sheet, with a
 *                          cone showing which way the camera faces. With
 *                          Follow on, the sheet scrolls to keep it in view,
 *                          and walking onto another floor opens the plan
 *                          of that floor.
 *
 * Only plan views take part (their direction is straight up or down): a
 * point on a section or an elevation has no single place to stand.
 */

export function createSync3D(ctx) {
  const { S, $, status, Store } = ctx;
  const Y = {
    on: false, frame: null, hello: false, ready: false,
    cam: null, click: "walk", follow: true,
    queue: [], switchTimer: null, lastSwitch: 0,
  };

  const setStatus = (m) => { const el = $("#sync-status"); if (el) el.textContent = m || ""; };

  /* ------------------------------------------------------ the mapping */

  function toPaper(m, mm) {
    const o = m.origin, ex = m.x_axis, ey = m.y_axis;
    const d = [mm[0] - o[0], mm[1] - o[1], mm[2] - o[2]];
    const ex2 = ex[0] * ex[0] + ex[1] * ex[1] + ex[2] * ex[2];
    const ey2 = ey[0] * ey[0] + ey[1] * ey[1] + ey[2] * ey[2];
    return [(d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2]) / ex2,
            (d[0] * ey[0] + d[1] * ey[1] + d[2] * ey[2]) / ey2];
  }

  const isPlan = (vp) => {
    const m = vp.paper_to_model;
    if (!m || !vp.paper_rect_mm) return false;
    if ((vp.diagnostics || {}).confidence === "guessed") return false;
    const n = m.normal || [0, 0, -1];
    return Math.abs(n[2]) > 0.9;
  };

  /* How far (mm, vertically) a model point is from what a plan shows:
     0 inside its view range, otherwise the distance to it. Without a view
     range, the plan is taken to show about one storey above its origin. */
  function storeyGap(vp, z) {
    const r = vp.view_range_mm;
    let lo, hi;
    if (r && isFinite(r.bottom_mm) && isFinite(r.top_mm)) {
      lo = Math.min(r.bottom_mm, isFinite(r.view_depth_mm) ? r.view_depth_mm : r.bottom_mm) - 300;
      hi = Math.max(r.top_mm, (isFinite(r.cut_mm) ? r.cut_mm : r.bottom_mm) + 1500) + 300;
    } else {
      const z0 = vp.paper_to_model.origin[2];
      lo = z0 - 300; hi = z0 + 3500;
    }
    return z < lo ? lo - z : z > hi ? z - hi : 0;
  }

  // The plan on a sheet that shows this point best: inside its crop, and
  // nearest in height.
  /* The floor a plan is of, in model mm: its bottom clip when that sits
     just under the cut (the usual "level + 0"), else the cut less 1.2 m. */
  function floorOf(vp) {
    if (isFinite(vp.level_mm)) return vp.level_mm;         // the plan's own level (exports from 30 Sep)
    const r = vp.view_range_mm;
    if (r && isFinite(r.cut_mm)) {
      if (isFinite(r.bottom_mm) && r.bottom_mm <= r.cut_mm && r.cut_mm - r.bottom_mm <= 6000) return r.bottom_mm;
      return r.cut_mm - 1200;
    }
    return vp.paper_to_model.origin[2];
  }

  const vpKey = (vp) => String(vp.element_id || vp.view_id || vp.view_name || "");

  function placeOn(sheet, mm) {
    /* The plan last clicked keeps the marker while the 3D point stays near
       the height that click went to - whatever the view ranges say. Roof
       plans (R/F, LMR/F, T/R/F) cover the same ground and their ranges
       overlap, so the ranges alone sent a point inside the R/F rooms to
       another roof's plan. */
    if (Y.lastVp && isFinite(Y.lastZ) && Math.abs(mm[2] - Y.lastZ) < 2600) {
      const vp = ((sheet && sheet.viewports) || []).find((v) => vpKey(v) === Y.lastVp && isPlan(v));
      if (vp) {
        const uv = toPaper(vp.paper_to_model, mm);
        const r = vp.paper_rect_mm;
        if (uv[0] >= r[0] && uv[0] <= r[0] + r[2] && uv[1] >= r[1] && uv[1] <= r[1] + r[3]) {
          return { vp, uv, gap: 0, area: r[2] * r[3], near: -1 };
        }
      }
    }
    let best = null;
    for (const vp of (sheet && sheet.viewports) || []) {
      if (!isPlan(vp)) continue;
      const uv = toPaper(vp.paper_to_model, mm);
      const r = vp.paper_rect_mm;
      if (uv[0] < r[0] || uv[0] > r[0] + r[2] || uv[1] < r[1] || uv[1] > r[1] + r[3]) continue;
      const gap = storeyGap(vp, mm[2]);
      /* Several plans of one sheet (R/F, LMR/F, T/R/F ...) can all reach
         this height - a roof plan's range is often open upwards. Among
         those, the one whose floor is nearest the point (a point on a
         floor, or an eye 1.6 m above it: about 1 m over the floor), and
         the plan last clicked keeps the marker while the point stays on
         its storey. */
      let near = Math.abs(mm[2] - (floorOf(vp) + 1000));
      if (Y.lastVp && vpKey(vp) === Y.lastVp && near < 2600) near = -1;
      const area = r[2] * r[3] * (vp.crop_active === false ? 50 : 1);
      if (!best || gap < best.gap || (gap === best.gap && (near < best.near - 1
          || (Math.abs(near - best.near) <= 1 && area < best.area)))) best = { vp, uv, gap, area, near };
    }
    return best;
  }

  /* ------------------------------------------------------- the frame */

  function post(msg) {
    if (!Y.frame || !Y.hello) { Y.queue.push(msg); return; }
    Y.frame.contentWindow.postMessage(Object.assign({ lwk: 1 }, msg), location.origin);
  }

  function onMessage(ev) {
    if (!Y.frame || ev.source !== Y.frame.contentWindow || ev.origin !== location.origin) return;
    const m = ev.data || {};
    if (m.lwk !== 1) return;
    if (m.type === "hello") {
      Y.hello = true;
      const q = Y.queue.splice(0);
      q.forEach(post);
    } else if (m.type === "ready") {
      Y.ready = true;
      setStatus("Click a plan on the sheet to go there in 3D.");
    } else if (m.type === "status") {
      if (Y.ready && m.text) setStatus(m.text.length > 90 ? m.text.slice(0, 88) + "..." : m.text);
    } else if (m.type === "cam") {
      Y.cam = m;
      $("#sync-walk").classList.toggle("active", !!m.walking);
      paintHere();
      if (Y.follow) follow();
    }
  }

  function open() {
    const host = $("#sync-host");
    if (Y.frame) return;
    Y.hello = false; Y.ready = false; Y.cam = null; Y.queue = [];
    if (Y.pinsOn === false) Y.queue.push({ type: "pins", show: false });
    if (S.hideDone) Y.queue.push({ type: "hidedone", on: true });
    const f = document.createElement("iframe");
    f.id = "sync-frame";
    f.title = "3D model";
    const base = Store.pageUrl("model.html");
    f.src = base + (base.indexOf("?") >= 0 ? "&" : "?") + "embed=1";
    f.setAttribute("allow", "fullscreen");
    host.appendChild(f);
    Y.frame = f;
    setStatus("Loading the model ...");
  }

  // Closing gives the frame's memory back: on an iPad the sheet and the
  // model together are close to what Safari allows one tab.
  function close() {
    if (Y.frame) {
      try { Y.frame.src = "about:blank"; } catch (e) {}
      Y.frame.remove();
    }
    Y.frame = null; Y.hello = false; Y.ready = false; Y.cam = null;
  }

  function toggle(on) {
    const want = on === undefined ? !Y.on : on;
    if (want === Y.on) return;
    Y.on = want;
    if (want && ctx.closeSplit) ctx.closeSplit();
    $("#sync-pane").hidden = !want;
    $("#stage-row").classList.toggle("sync", want);
    $("#sync-toggle").classList.toggle("active", want);
    if (want) open(); else close();
    ctx.redraw();
    // The sheet pane changed width; refit so it does not overflow.
    setTimeout(() => { if (S.page) ctx.fit(); }, 40);
  }

  /* --------------------------------------------- sheet -> model (click) */

  function wireClicks() {
    const sc = $("#scroll");
    let down = null;
    sc.addEventListener("pointerdown", (ev) => {
      down = null;
      if (!Y.on || !ev.isPrimary || ev.button !== 0) return;
      if (S.tool !== "select" && S.tool !== "pan") return;
      if (ev.target.closest && ev.target.closest(".mk, .handle, .midhandle, .rothandle, #selbar, button")) return;
      down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    sc.addEventListener("pointerup", (ev) => {
      const d = down; down = null;
      if (!d || !Y.on) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const r = $("#overlay").getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientY < r.top || ev.clientX > r.right || ev.clientY > r.bottom) return;
      const uv = ctx.paperFrom(ev.clientX - r.left, ev.clientY - r.top);
      goFromSheet(uv);
    });
    sc.addEventListener("pointercancel", () => { down = null; });
  }

  function goFromSheet(uv) {
    const sheet = S.sheet;
    if (!sheet) return;
    /* The view under the click. A sheet with several plans often has
       views whose boxes overlap - a plan without its crop switched on
       reaches over the whole sheet - and the first one in the list used to
       win, so most of the plans could never be clicked (and the 3D went to
       that one view's floor). Now: plans first, and of those the one whose
       box fits the click most tightly. */
    let vp = null, best = Infinity;
    for (const v of sheet.viewports || []) {
      const r = v.paper_rect_mm;
      if (!r || uv[0] < r[0] || uv[0] > r[0] + r[2] || uv[1] < r[1] || uv[1] > r[1] + r[3]) continue;
      const score = r[2] * r[3] * (isPlan(v) ? 1 : 1e6) * (v.crop_active === false ? 50 : 1);
      if (score < best) { best = score; vp = v; }
    }
    if (!vp || !vp.paper_to_model) { setStatus("That is not inside a model view."); return; }
    if (!isPlan(vp)) { setStatus(vp.view_name + " is not a plan - click on a floor plan to move the 3D view."); return; }
    Y.lastVp = vpKey(vp);
    const m = vp.paper_to_model;
    const mm = [0, 1, 2].map((i) => m.origin[i] + uv[0] * m.x_axis[i] + uv[1] * m.y_axis[i]);
    const r = vp.view_range_mm;
    /* Height: 1.2 m over the plan's floor, so the 3D side finds that floor
       right below. Not the plan's cut: a roof plan is often cut high to see
       over parapets, and from there the first surface below a covered room
       was the roof over it (R/F rooms went to T/R/F). */
    mm[2] = floorOf(vp) + 1200;
    if (r && isFinite(r.cut_mm) && r.cut_mm < mm[2]) mm[2] = r.cut_mm;
    Y.lastZ = mm[2];
    post({ type: "goto", mm, mode: Y.click, label: sheet.number + " / " + vp.view_name });
    // Keys (W A S D) should now walk: give the 3D side the keyboard.
    if (Y.click === "walk" && Y.frame) { try { Y.frame.contentWindow.focus(); } catch (e) {} }
    setStatus(Y.click === "walk" ? "Standing at the point clicked on " + vp.view_name
      + ". W A S D to walk, drag in 3D to look." : "Looking at the point clicked on " + vp.view_name + ".");
  }

  /* ------------------------------------- model -> sheet (you are here) */

  function where() {
    const c = Y.cam;
    if (!c || !S.sheet) return null;
    const pt = c.walking ? c.eye : (c.target || c.eye);
    const hit = placeOn(S.sheet, pt);
    return hit ? Object.assign(hit, { pt }) : { pt, vp: null };
  }

  function svgEl(t, a) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", t);
    for (const k in a) n.setAttribute(k, a[k]);
    return n;
  }

  function drawHere(svg) {
    if (!Y.on || !Y.cam || !S.viewport) return;
    const w = where();
    if (!w || !w.vp) return;
    const c = Y.cam;
    const [x, y] = ctx.canvasFrom(w.uv[0], w.uv[1]);
    const g = svgEl("g", { class: "here" + (w.gap > 0 ? " other" : "") + (c.walking ? " walking" : "") });

    // Which way the camera faces, turned onto the paper and then onto the
    // screen (so page rotation is taken care of by canvasFrom).
    const m = w.vp.paper_to_model;
    const f = c.fwd || [0, 1, 0];
    const ex = m.x_axis, ey = m.y_axis;
    const du = (f[0] * ex[0] + f[1] * ex[1] + f[2] * ex[2]) / (ex[0] * ex[0] + ex[1] * ex[1] + ex[2] * ex[2]);
    const dv = (f[0] * ey[0] + f[1] * ey[1] + f[2] * ey[2]) / (ey[0] * ey[0] + ey[1] * ey[1] + ey[2] * ey[2]);
    const len = Math.hypot(du, dv);
    if (len > 1e-9) {
      const k = 5 / len;       // a few paper mm along the view direction
      const [x2, y2] = ctx.canvasFrom(w.uv[0] + du * k, w.uv[1] + dv * k);
      const a = Math.atan2(y2 - y, x2 - x);
      const R = c.walking ? 46 : 34, half = 35 * Math.PI / 180;
      const p1 = [x + R * Math.cos(a - half), y + R * Math.sin(a - half)];
      const p2 = [x + R * Math.cos(a + half), y + R * Math.sin(a + half)];
      g.appendChild(svgEl("path", { class: "here-cone",
        d: `M ${x} ${y} L ${p1[0]} ${p1[1]} A ${R} ${R} 0 0 1 ${p2[0]} ${p2[1]} Z` }));
    }
    if (c.walking) {
      g.appendChild(svgEl("circle", { class: "here-dot", cx: x, cy: y, r: 8 }));
    } else {
      g.appendChild(svgEl("circle", { class: "here-ring", cx: x, cy: y, r: 10 }));
      g.appendChild(svgEl("path", { class: "here-cross",
        d: `M ${x - 15} ${y} H ${x - 5} M ${x + 5} ${y} H ${x + 15} M ${x} ${y - 15} V ${y - 5} M ${x} ${y + 5} V ${y + 15}` }));
    }
    const label = w.gap > 0 ? "3D: " + (c.level || "another floor") : (c.walking ? "You" : "3D");
    const t = svgEl("text", { class: "here-label", x: x + 13, y: y - 12 });
    t.textContent = label;
    g.appendChild(t);
    svg.appendChild(g);
  }

  // Between full redraws (every camera message): replace just the marker.
  function paintHere() {
    const svg = $("#overlay");
    svg.querySelectorAll("g.here").forEach((n) => n.remove());
    drawHere(svg);
  }

  /* Keep the marker in sight; after walking onto another floor, open a
     sheet that has that floor's plan - the one most like the sheet being
     read (same scale, same series of numbers). */
  function follow() {
    // a sheet still opening (the walk switched it): nothing to follow on yet
    if (!S.viewport || !S.page) return;
    const w = where();
    if (!w) return;
    if (w.vp && w.gap === 0) {
      clearTimeout(Y.switchTimer); Y.switchTimer = null;
      keepInView(w.uv);
      return;
    }
    if (!Y.cam.walking || Y.switchTimer) return;
    // Wait a moment: a stair or a jump between floors passes through
    // heights that belong to no plan.
    Y.switchTimer = setTimeout(() => {
      Y.switchTimer = null;
      const again = where();
      if (!again || (again.vp && again.gap === 0)) return;
      if (performance.now() - Y.lastSwitch < 2500) return;
      const target = bestSheetFor(again.pt, again.vp || currentPlan());
      if (target && target !== S.sheet) {
        Y.lastSwitch = performance.now();
        status("Following the walk to " + target.number + " - " + (target.name || ""));
        Promise.resolve(ctx.openSheet(target)).then(() => { paintHere(); });
      }
    }, 700);
  }

  function currentPlan() {
    return ((S.sheet && S.sheet.viewports) || []).find(isPlan) || null;
  }

  function bestSheetFor(pt, like) {
    const cur = S.sheet;
    const prefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
    let best = null;
    for (const sh of S.manifest.sheets || []) {
      if (!sh.pdf) continue;
      const hit = placeOn(sh, pt);
      if (!hit || hit.gap > 0) continue;
      let score = prefix(String(sh.number), String(cur ? cur.number : ""));
      if (like && hit.vp.scale === like.scale) score += 3;
      if (like && hit.vp.view_type === like.view_type) score += 1;
      if (!best || score > best.score) best = { sheet: sh, score };
    }
    return best && best.sheet;
  }

  function keepInView(uv) {
    const sc = $("#scroll");
    if (!S.viewport || !sc || !$("#page")) return;
    const [x, y] = ctx.canvasFrom(uv[0], uv[1]);
    const P = $("#page").getBoundingClientRect(), R = sc.getBoundingClientRect();
    const sx = P.left - R.left + x, sy = P.top - R.top + y;   // in the visible box
    const mx = sc.clientWidth * 0.15, my = sc.clientHeight * 0.15;
    if (sx < mx || sx > sc.clientWidth - mx || sy < my || sy > sc.clientHeight - my) {
      sc.scrollLeft += sx - sc.clientWidth / 2;
      sc.scrollTop += sy - sc.clientHeight / 2;
      if (ctx.detailSoon) ctx.detailSoon();
    }
  }

  /* ------------------------------------------------------------- wire */

  function wire() {
    addEventListener("message", onMessage);
    $("#sync-toggle").addEventListener("click", () => toggle());
    $("#sync-close").addEventListener("click", () => toggle(false));
    const addIss = $("#sync-issue");
    if (addIss) addIss.addEventListener("click", () => {
      post({ type: "addissue" });
      if (Y.frame) { try { Y.frame.contentWindow.focus(); } catch (e) {} }
      setStatus("Click the spot in the 3D view to raise the issue (Esc to cancel).");
    });
    const pins = $("#sync-pins");
    if (pins) pins.addEventListener("click", () => {
      Y.pinsOn = !pins.classList.contains("active");
      pins.classList.toggle("active", Y.pinsOn);
      post({ type: "pins", show: Y.pinsOn });
    });
    const depth = $("#sync-depth");
    if (depth) {
      let on = true;
      try { const v = localStorage.getItem("lwk.depthfx"); on = v === null ? !/iP(hone|ad|od)|Android/.test(navigator.userAgent) : v === "1"; } catch (e) {}
      depth.classList.toggle("active", on);
      depth.addEventListener("click", () => {
        const now = !depth.classList.contains("active");
        depth.classList.toggle("active", now);
        post({ type: "depth", on: now });
      });
    }
    $("#sync-open").addEventListener("click", () => {
      const base = Store.pageUrl("model.html");
      location.href = base;
    });
    $("#sync-follow").addEventListener("change", (ev) => { Y.follow = ev.target.checked; });
    document.querySelectorAll("#sync-click button").forEach((b) => b.addEventListener("click", () => {
      Y.click = b.dataset.v;
      document.querySelectorAll("#sync-click button").forEach((x) =>
        x.classList.toggle("active", x === b));
    }));
    $("#sync-walk").addEventListener("click", () => {
      if (Y.cam && Y.cam.walking) post({ type: "stop" });
      else {
        Y.click = "walk";
        document.querySelectorAll("#sync-click button").forEach((x) =>
          x.classList.toggle("active", x.dataset.v === "walk"));
        setStatus("Click a floor plan on the sheet - or a floor in 3D - to stand there.");
        post({ type: "walk" });
      }
    });
    wireClicks();
  }

  return { post, wire, toggle, drawHere, get state() { return Y; }, placeOn, toPaper, goFromSheet };
}
