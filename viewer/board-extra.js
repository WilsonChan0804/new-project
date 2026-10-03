/* The parts of the Board page that sit around the canvas rather than on it:
 * pictures, comments and reactions, the card linked to an issue or a sheet,
 * search, export / import, presenting frame by frame, the shared timer,
 * the overview map and the shortcut list.
 *
 * board.js hands over `app` (its state and the functions that change it);
 * what this file offers back is hung on app.X, so the two never import
 * each other.
 */

import { esc, uid, icon, ago, unionBox, col, clamp, round1, personColor } from "./board-util.js";
import * as mind from "./board-mind.js";
import { toCanvas, canvasBlob, download, safeName, exportJson, importJson } from "./board-export.js";

export function initExtra(app) {
  const { A, O, get, $, X, api, project } = app;

  const viewCentre = () => {
    const r = app.stageRect();
    return app.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  /* Where a new thing of this size goes when nobody said where: the middle
     of the screen - stepping down and right while something already sits
     exactly there, so three cards added in a row do not hide each other. */
  function freeSpot(w, h) {
    const c = viewCentre();
    let x = round1(c.x - w / 2), y = round1(c.y - h / 2);
    const taken = () => Array.from(O().values()).some((o) => Math.abs((o.x || 0) - x) < 6 && Math.abs((o.y || 0) - y) < 6 && !app.META.has(o.t));
    for (let i = 0; i < 40 && taken(); i++) { x += 28; y += 28; }
    return { x, y };
  }

  /* ---------------------------------------------------------------- pictures */

  /* A phone photo is 4000 px wide and 5 MB; on a board it is shown a few
     hundred pixels wide. It is brought down to a sensible size before it is
     uploaded, and stored once through /api/snapshots - the board only keeps
     its path. */
  async function prepareImage(file) {
    let src, w, h, done = () => {};
    if (window.createImageBitmap) {
      try { src = await createImageBitmap(file); w = src.width; h = src.height; } catch (e) { src = null; }
    }
    if (!src) {
      const url = URL.createObjectURL(file);
      done = () => URL.revokeObjectURL(url);
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("this file is not a picture the browser can read"));
        img.src = url;
      });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const k = Math.min(1, 2400 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext("2d");
    const png = file.type === "image/png" || file.type === "image/gif";
    if (!png) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(src, 0, 0, c.width, c.height);
    done();
    let url = png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
    if (png && url.length > 3.5e6) {                    // a screenshot-sized PNG: not worth its weight
      const c2 = document.createElement("canvas");
      c2.width = c.width; c2.height = c.height;
      const g2 = c2.getContext("2d");
      g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height);
      g2.drawImage(c, 0, 0);
      url = c2.toDataURL("image/jpeg", 0.88);
    }
    return { url, w: c.width, h: c.height };
  }

  X.addImage = async function (file, at) {
    if (!A.canEdit || !A.sync) return null;
    if (!/^image\//.test(file.type || "")) { app.toast("Only pictures can be put on a board (png, jpg)."); return null; }
    app.toast("Adding the picture ...", 20000);
    try {
      const { url, w, h } = await prepareImage(file);
      const res = await api("/api/snapshots", { method: "POST", body: JSON.stringify({ data_url: url }) });
      const k = Math.min(1, 420 / w, 420 / h);
      const at2 = at ? { x: round1(at.x - (w * k) / 2), y: round1(at.y - (h * k) / 2) } : freeSpot(w * k, h * k);
      const o = { id: uid("i"), t: "image", src: res.path, x: at2.x, y: at2.y, w: round1(w * k), h: round1(h * k), z: app.topZ() };
      const tx = app.begin();
      app.put(tx, o);
      app.commit(tx);
      app.setTool("select");
      app.select([o.id]);
      app.toast("Picture added", 1200);
      return o;
    } catch (e) {
      app.toast("Could not add the picture: " + e.message, 6000);
      return null;
    }
  };

  /* ------------------------------------------------- comments and reactions */

  const thread = { id: null };
  const panel = $("#bd-thread");

  function renderThread() {
    if (panel.hidden) return;
    const o = get(thread.id);
    if (!o) { panel.hidden = true; return; }
    const now = A.sync.now();
    const list = Array.from(O().values()).filter((c) => c.t === "comment" && c.on === thread.id)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    $("#th-on").textContent = "on: " + (String(o.text || o.title || "").replace(/\s+/g, " ").slice(0, 40) || o.t);
    $("#th-list").innerHTML = list.length ? list.map((c) => {
      const who = c.cby || c.by || "Someone";
      const mine = A.canEdit && (who === A.name || A.role === "admin");
      return `<div class="th-c" data-cid="${esc(c.id)}"><div class="h"><b style="color:${personColor(who)}">${esc(who)}</b>`
        + `<span>${esc(ago(c.cat || new Date(c.ts || now).toISOString(), now))}</span>`
        + (mine ? `<button type="button" data-rm="1" title="Delete this comment">${icon("trash", 13)}</button>` : "") + `</div>`
        + `<div class="b">${esc(c.text)}</div></div>`;
    }).join("") : `<div class="th-none">No comments yet${A.canEdit ? " - write the first one below." : "."}</div>`;
    $("#th-list").scrollTop = 1e6;
  }

  X.openThread = function (id) {
    thread.id = id;
    panel.hidden = false;
    renderThread();
    if (A.canEdit && matchMedia("(pointer: fine)").matches) $("#th-text").focus();
  };
  function sendComment() {
    const text = $("#th-text").value.trim();
    if (!text || !A.canEdit || !get(thread.id)) return;
    const tx = app.begin();
    app.put(tx, { id: uid("m"), t: "comment", on: thread.id, text: text.slice(0, 2000), by: A.name, ts: A.sync.now() });
    app.commit(tx);
    $("#th-text").value = "";
    app.flushFrame();
  }
  $("#th-send").onclick = sendComment;
  $("#th-text").onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); sendComment(); }
    if (ev.key === "Escape") panel.hidden = true;
  };
  $("#th-close").onclick = () => { panel.hidden = true; };
  $("#th-list").onclick = (ev) => {
    const rm = ev.target.closest("[data-rm]");
    if (!rm) return;
    const tx = app.begin();
    app.del(tx, rm.closest("[data-cid]").dataset.cid);
    app.commit(tx);
  };
  X.metaChanged = () => { renderThread(); app.buildCtx(); };

  /* One small object per person, per thing, per emoji - so a workshop of
     twenty people voting at once is twenty separate saves, none of which
     can overwrite another. */
  const EMOJI = ["\u{1F44D}", "❤️", "✅", "❓", "\u{1F525}", "⭐"];
  X.toggleReact = function (id, e) {
    if (!A.canEdit || !get(id) || !EMOJI.includes(e)) return;
    const mine = Array.from(O().values()).find((r) => r.t === "react" && r.on === id && r.e === e && (r.who || r.cby) === A.name);
    const tx = app.begin();
    if (mine) app.del(tx, mine.id);
    else app.put(tx, { id: uid("r"), t: "react", on: id, e, who: A.name });
    app.commit(tx);
  };
  X.reactMenu = function (btn, id) {
    app.pop(btn, `<div class="icon-row emo">` + EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("") + `</div>`,
      (ev) => { const b = ev.target.closest("[data-e]"); if (b) { X.toggleReact(id, b.dataset.e); app.closePop(); } });
  };

  /* ----------------------------------------------------- link to the project */

  async function loadIssues() {
    const data = await api("/api/items?since=0");
    const m = new Map();
    for (const it of data.items || []) {
      if (it.deleted || !it.issue) continue;
      const i = it.issue;
      m.set(it.id, { id: it.id, number: i.number, title: i.title || "", status: i.status || "Open", assignee: i.assigned_to || "",
                     due: i.due_date || "", sheet: it.sheet || "", p3d: it.placement === "3d" || !it.sheet, type: i.type || "" });
    }
    A.issues = m;
    refreshLinks();
    return m;
  }
  async function loadSheets() {
    const res = await fetch("/data/" + encodeURIComponent(project()) + "/manifest.json");
    const man = res.ok ? await res.json() : {};
    A.sheets = (man.sheets || []).map((s) => ({ number: String(s.number || ""), name: String(s.name || "") }));
    refreshLinks();
    return A.sheets;
  }
  function refreshLinks() {
    const ids = [];
    for (const o of O().values()) if (o.t === "link") ids.push(o.id);
    if (ids.length) app.invalidate(ids);
  }

  const picker = { tab: "issue" };
  function renderPicker() {
    const q = $("#lk-q").value.trim().toLowerCase();
    $("#lk-tab-issue").classList.toggle("on", picker.tab === "issue");
    $("#lk-tab-sheet").classList.toggle("on", picker.tab === "sheet");
    let html = "";
    if (picker.tab === "issue") {
      if (!A.issues) html = `<li class="none">Loading the issues ...</li>`;
      else {
        const list = Array.from(A.issues.values())
          .filter((i) => !q || ("#" + i.number + " " + i.title + " " + i.assignee + " " + i.status + " " + i.sheet).toLowerCase().includes(q))
          .sort((a, b) => (b.number || 0) - (a.number || 0)).slice(0, 200);
        html = list.map((i) => `<li data-ref="${esc(i.id)}"><b>#${esc(i.number || "?")}</b><span class="t">${esc(i.title || "(no title)")}</span>`
          + `<span class="m">${esc([i.status, i.assignee, i.sheet || (i.p3d ? "3D" : "")].filter(Boolean).join(" · "))}</span></li>`).join("")
          || `<li class="none">${A.issues.size ? "Nothing matches." : "This project has no issues yet."}</li>`;
      }
    } else if (!A.sheets) html = `<li class="none">Loading the sheets ...</li>`;
    else {
      html = A.sheets.filter((s) => !q || (s.number + " " + s.name).toLowerCase().includes(q)).slice(0, 300)
        .map((s) => `<li data-ref="${esc(s.number)}"><b>${esc(s.number)}</b><span class="t">${esc(s.name)}</span></li>`).join("")
        || `<li class="none">${A.sheets.length ? "Nothing matches." : "This project has no sheets."}</li>`;
    }
    $("#lk-list").innerHTML = html;
  }
  X.openLinkPicker = function () {
    if (!A.canEdit || !A.sync) return;
    $("#bd-link-back").hidden = false;
    $("#lk-q").value = "";
    renderPicker();
    if (matchMedia("(pointer: fine)").matches) $("#lk-q").focus();
    // fetched again each time: issues change by the hour
    loadIssues().then(renderPicker).catch(() => { A.issues = A.issues || new Map(); renderPicker(); });
    loadSheets().then(renderPicker).catch(() => { A.sheets = A.sheets || []; renderPicker(); });
  };
  const closePicker = () => { $("#bd-link-back").hidden = true; };
  $("#lk-cancel").onclick = closePicker;
  $("#lk-tab-issue").onclick = () => { picker.tab = "issue"; renderPicker(); };
  $("#lk-tab-sheet").onclick = () => { picker.tab = "sheet"; renderPicker(); };
  $("#lk-q").oninput = renderPicker;
  $("#lk-q").onkeydown = (ev) => { if (ev.key === "Escape") closePicker(); };
  $("#bd-link-back").addEventListener("pointerdown", (ev) => { if (ev.target.id === "bd-link-back") closePicker(); });
  $("#lk-list").onclick = (ev) => {
    const li = ev.target.closest("li[data-ref]");
    if (!li) return;
    const spot = freeSpot(240, 92);
    const o = { id: uid("k"), t: "link", kind: picker.tab, ref: li.dataset.ref, x: spot.x, y: spot.y, w: 240, h: 92, z: app.topZ() };
    if (picker.tab === "issue") {
      // remembered on the card, so it still says something if the issue list cannot be read later
      const i = A.issues.get(o.ref);
      Object.assign(o, { num: i.number, title: i.title, status: i.status, who: i.assignee, due: i.due, sheet: i.sheet, p3d: i.p3d });
    } else {
      const s = A.sheets.find((x) => x.number === o.ref);
      Object.assign(o, { title: s ? s.name : "", h: 70 });
    }
    const tx = app.begin();
    app.put(tx, o);
    app.commit(tx);
    closePicker();
    app.setTool("select");
    app.select([o.id]);
  };

  /* ------------------------------------------------------------------ search */

  const search = { hits: [], at: 0 };
  function clearHits() {
    for (const el of document.querySelectorAll("#bd-objs .hit")) el.classList.remove("hit", "cur");
  }
  function runSearch() {
    clearHits();
    const q = $("#bd-search-in").value.trim().toLowerCase();
    search.hits = [];
    search.at = 0;
    if (q && A.sync) {
      const found = new Set();
      for (const o of O().values()) {
        const hay = o.t === "link" ? [o.title, "#" + o.num, o.ref].join(" ") : o.text;
        if (typeof hay !== "string" || !hay.toLowerCase().includes(q)) continue;
        const id = o.t === "comment" ? o.on : o.id;          // a comment leads to the thing it is on
        if (get(id) && get(id).t !== "react") found.add(id);
      }
      search.hits = Array.from(found).map(get).sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0)).map((o) => o.id);
    }
    showHit();
  }
  function showHit() {
    const n = search.hits.length;
    $("#bd-search-n").textContent = $("#bd-search-in").value.trim() ? (n ? search.at + 1 + " / " + n : "0") : "";
    if (!n) return;
    const id = search.hits[search.at];
    const o = get(id);
    if (!o) return;
    // a match folded away inside a branch: open the branch (only on this screen)
    if (o.t === "node") {
      let p = A.F.parentOf.get(id), opened = false;
      while (p) {
        const n2 = get(p);
        if (n2 && n2.collapsed) { delete n2.collapsed; app.invalidate([p]); opened = true; }
        p = A.F.parentOf.get(p);
      }
      if (opened) app.flushFrame();
    }
    clearHits();
    for (const h of search.hits) { const el = A.els.get(h); if (el && el.classList) el.classList.add("hit"); }
    const el = A.els.get(id);
    if (el && el.classList) el.classList.add("cur");
    const b = app.objBox(o);
    if (!b) return;
    const r = app.stageRect(), s = A.view.s;
    if (b.w * s > r.width - 120 || b.h * s > r.height - 120 || s < 0.45) app.fitBox(b, 1, 120);
    else {
      A.view.x = r.width / 2 - (b.x + b.w / 2) * s;
      A.view.y = r.height / 2 - (b.y + b.h / 2) * s;
      app.applyView();
    }
    app.select([id]);
  }
  X.openSearch = function () {
    $("#bd-search").hidden = false;
    $("#bd-search-btn").hidden = true;
    $("#bd-search-in").focus();
    $("#bd-search-in").select();
  };
  function closeSearch() {
    $("#bd-search").hidden = true;
    $("#bd-search-btn").hidden = false;
    $("#bd-search-in").value = "";
    $("#bd-search-n").textContent = "";
    search.hits = [];
    clearHits();
  }
  const step = (d) => {
    if (!search.hits.length) return;
    search.at = (search.at + d + search.hits.length) % search.hits.length;
    showHit();
  };
  $("#bd-search-btn").onclick = X.openSearch;
  $("#bd-search-x").onclick = closeSearch;
  $("#bd-search-next").onclick = () => step(1);
  $("#bd-search-prev").onclick = () => step(-1);
  $("#bd-search-in").oninput = runSearch;
  $("#bd-search-in").onkeydown = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); step(ev.shiftKey ? -1 : 1); }
    if (ev.key === "Escape") { closeSearch(); app.stage.focus(); }
  };

  /* ------------------------------------------------------- export and import */

  X.lastExport = null;
  X.exportPng = async function (selectionOnly) {
    if (!A.sync) return null;
    let list;
    if (selectionOnly && A.sel.size) {
      const ids = new Set();
      for (const o of app.selObjs()) {
        if (o.t === "node") for (const k of mind.subtree(A.F, o.id)) ids.add(k); else ids.add(o.id);
      }
      list = Array.from(ids).map(get).filter(Boolean);
    } else {
      list = Array.from(O().values());
    }
    list = list.filter((o) => !app.META.has(o.t));
    if (!list.length) { app.toast("There is nothing on the board to save as a picture."); return null; }
    app.toast("Drawing the picture ...", 20000);
    try {
      const canvas = await toCanvas(list, O(), { scale: 2, background: "#ffffff" });
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("the picture is too large for this device");
      X.lastExport = { w: canvas.width, h: canvas.height, bytes: blob.size, canvas };
      download(blob, safeName(A.board.title) + (selectionOnly ? "-selection" : "") + ".png");
      app.toast("Picture saved (" + canvas.width + " x " + canvas.height + ")", 2500);
      return X.lastExport;
    } catch (e) {
      app.toast("Could not make the picture: " + e.message, 6000);
      return null;
    }
  };

  X.exportJson = async function () {
    if (!A.sync) return null;
    app.commitEdit();
    const data = await exportJson(A.board.title, A.sync.snapshot());
    const text = JSON.stringify(data);
    X.lastJson = data;
    download(new Blob([text], { type: "application/json" }), safeName(A.board.title) + ".board.json");
    app.toast("Backup saved - bring it back with Import a backup", 3000);
    return data;
  };

  X.importData = async function (data) {
    const upload = async (url) => (await api("/api/snapshots", { method: "POST", body: JSON.stringify({ data_url: url }) })).path;
    const made = await importJson(data, upload);
    const res = await api("/api/boards", { method: "POST", body: JSON.stringify({ title: made.title, by: A.name, objects: made.objects }) });
    await app.loadBoards();
    await app.openBoard(res.board.id, true);
    return res.board;
  };
  $("#bd-import-file").onchange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    try {
      if (f.size > 40e6) throw new Error("the file is too large");
      await X.importData(JSON.parse(await f.text()));
      app.toast("Imported as a new board");
    } catch (e) {
      app.toast("Could not import: " + e.message, 6000);
    }
  };
  $("#bl-import").onclick = () => $("#bd-import-file").click();

  $("#bd-export").onclick = (ev) => {
    if (!A.sync) return;
    app.pop(ev.currentTarget, `<div class="menu">`
      + `<button type="button" data-x="png">${icon("image", 16)} Picture of the whole board (PNG)</button>`
      + (A.sel.size ? `<button type="button" data-x="sel">${icon("image", 16)} Picture of the selection (PNG)</button>` : "")
      + `<button type="button" data-x="json">${icon("download", 16)} Backup file (.json)</button>`
      + (A.canEdit ? `<button type="button" data-x="import">${icon("upload", 16)} Import a backup as a new board</button>` : "")
      + `</div>`,
    (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      app.closePop();
      if (b.dataset.x === "png") X.exportPng(false);
      else if (b.dataset.x === "sel") X.exportPng(true);
      else if (b.dataset.x === "json") X.exportJson();
      else $("#bd-import-file").click();
    });
  };

  /* --------------------------------------------------------------- presenting */

  /* Frames, one after another, like slides: top row first, left to right. */
  const show = { frames: [], at: 0, back: null };
  function framesInOrder() {
    return Array.from(O().values()).filter((o) => o.t === "frame")
      .sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
  }
  function showFrame() {
    const f = show.frames[show.at];
    if (!f) return;
    app.fitBox({ x: f.x, y: f.y - 30, w: f.w, h: f.h + 30 }, 4, 24);
    $("#pr-label").textContent = show.at + 1 + " / " + show.frames.length + "  ·  " + (f.text || "Frame");
  }
  function startPresent() {
    if (!A.sync) return;
    show.frames = framesInOrder();
    if (!show.frames.length) { app.toast("Presenting goes frame by frame - add a frame (F) around each part first."); return; }
    app.commitEdit();
    app.select([]);
    show.back = Object.assign({}, A.view);
    show.at = 0;
    A.presenting = true;
    document.body.classList.add("presenting");
    $("#bd-present-bar").hidden = false;
    app.buildCtx();
    showFrame();
  }
  function stopPresent() {
    if (!A.presenting) return;
    A.presenting = false;
    document.body.classList.remove("presenting");
    $("#bd-present-bar").hidden = true;
    if (show.back) { Object.assign(A.view, show.back); app.applyView(); }
  }
  const go = (d) => { show.at = clamp(show.at + d, 0, show.frames.length - 1); showFrame(); };
  X.presentKey = (ev) => {
    if (ev.key === "Escape") stopPresent();
    else if (["ArrowRight", "ArrowDown", "PageDown", "Enter"].includes(ev.key)) { ev.preventDefault(); go(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(ev.key)) { ev.preventDefault(); go(-1); }
  };
  $("#bd-present").onclick = startPresent;
  $("#pr-next").onclick = () => go(1);
  $("#pr-prev").onclick = () => go(-1);
  $("#pr-stop").onclick = stopPresent;
  addEventListener("resize", () => { if (A.presenting) showFrame(); });

  /* -------------------------------------------------------------------- timer */

  /* One countdown for everyone on the board: "ten minutes to write your
     notes". It is an ordinary object, so it reaches the others the same way
     a sticky does; clocks are compared with the server's, not each other's. */
  const TIMER = "timer_main";
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  function drawTimer() {
    const t = A.sync ? get(TIMER) : null, view = $("#bd-timer-view");
    if (!t) { view.hidden = true; return; }
    const left = t.run ? (t.end || 0) - A.sync.now() : (t.left || 0);
    // an hour after it ran out nobody is waiting for it any more
    if (t.run && left < -3600000) { view.hidden = true; return; }
    view.hidden = false;
    view.textContent = fmt(left) + (t.run ? "" : " paused");
    view.classList.toggle("done", !!t.run && left <= 0);
    view.title = "Countdown" + (t.uby ? " - set by " + t.uby : "");
  }
  setInterval(drawTimer, 500);
  X.timerChanged = drawTimer;
  function timerMenu(anchor) {
    if (!A.sync) return;
    const t = get(TIMER);
    const mins = t && t.dur ? Math.round(t.dur / 60000) : 5;
    app.pop(anchor, `<div class="tm"><h4>Countdown for everyone on this board</h4>`
      + (A.canEdit ? `<div class="row"><input id="tm-min" type="number" min="1" max="180" value="${mins}"> minutes</div>`
        + `<div class="row"><button type="button" class="primary" data-t="start">Start</button>`
        + (t && t.run ? `<button type="button" data-t="pause">Pause</button>` : t && t.left ? `<button type="button" data-t="resume">Resume</button>` : "")
        + (t ? `<button type="button" data-t="clear">Clear</button>` : "") + `</div>`
        : `<div class="muted">Only people who can edit the board can set it.</div>`) + `</div>`,
    (e) => {
      const b = e.target.closest("[data-t]");
      if (!b || !A.canEdit) return;
      const now = A.sync.now(), cur = get(TIMER);
      const tx = app.begin();
      if (b.dataset.t === "clear") { if (cur) app.del(tx, TIMER); }
      else {
        const dur = clamp(Number($("#tm-min").value) || 5, 1, 180) * 60000;
        const o = { id: TIMER, t: "timer", dur };
        if (b.dataset.t === "start") Object.assign(o, { run: true, end: now + dur });
        else if (b.dataset.t === "pause" && cur) Object.assign(o, { run: false, left: Math.max(0, cur.end - now), dur: cur.dur });
        else if (b.dataset.t === "resume" && cur) Object.assign(o, { run: true, end: now + (cur.left || 0), dur: cur.dur });
        app.put(tx, Object.assign(cur ? { rev: cur.rev } : {}, o));
      }
      // a countdown is not something Ctrl+Z should take back
      if (app.commit(tx)) A.undo.pop();
      app.closePop();
      drawTimer();
    });
  }
  $("#bd-timer-btn").onclick = (ev) => timerMenu(ev.currentTarget);
  $("#bd-timer-view").onclick = (ev) => timerMenu(ev.currentTarget);

  /* ---------------------------------------------------------------- overview */

  const mini = $("#bd-mini");
  let miniQueued = false, miniMap = null;
  const miniOn = () => !mini.hidden;
  function drawMini() {
    miniQueued = false;
    if (!miniOn() || !A.sync) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 200, H = 130;
    if (mini.width !== W * dpr) { mini.width = W * dpr; mini.height = H * dpr; }
    const g = mini.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const r = app.stageRect();
    const a = app.toWorld(r.left, r.top), b = app.toWorld(r.right, r.bottom);
    const view = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const boxes = [];
    for (const o of O().values()) { const bx = app.objBox(o); if (bx && o.t !== "conn") boxes.push([o, bx]); }
    const all = unionBox(boxes.map((x) => x[1]).concat([view]));
    const k = Math.min((W - 12) / all.w, (H - 12) / all.h);
    const ox = (W - all.w * k) / 2 - all.x * k, oy = (H - all.h * k) / 2 - all.y * k;
    miniMap = { k, ox, oy };
    for (const [o, bx] of boxes) {
      const x = bx.x * k + ox, y = bx.y * k + oy, w = Math.max(bx.w * k, 1.5), h = Math.max(bx.h * k, 1.5);
      if (o.t === "frame") { g.strokeStyle = "#b4bcc8"; g.lineWidth = 1; g.strokeRect(x, y, w, h); continue; }
      g.fillStyle = o.t === "sticky" ? col(o.fill, "#fff3a3") : o.t === "node" ? col(o._color, "#1f2430")
        : o.t === "image" ? "#9aa3af" : o.t === "pen" ? col(o.color, "#1f2430") : o.t === "link" ? "#3b82f6" : "#c3cad4";
      if (o.t === "sticky" && g.fillStyle === "#ffffff") g.fillStyle = "#e5e7eb";
      g.fillRect(x, y, w, h);
    }
    g.strokeStyle = "#f28022"; g.lineWidth = 1.5;
    g.strokeRect(view.x * k + ox, view.y * k + oy, view.w * k, view.h * k);
  }
  const queueMini = () => { if (miniOn() && !miniQueued) { miniQueued = true; requestAnimationFrame(drawMini); } };
  X.viewChanged = queueMini;
  X.contentChanged = () => { queueMini(); };
  const setMini = (on) => {
    mini.hidden = !on;
    $("#z-map").classList.toggle("on", on);
    try { localStorage.setItem("lwk-board:minimap", on ? "1" : "0"); } catch (e) {}
    queueMini();
  };
  $("#z-map").onclick = () => setMini(mini.hidden);
  const miniGo = (ev) => {
    if (!miniMap) return;
    const r = mini.getBoundingClientRect(), s = app.stageRect();
    const wx = (ev.clientX - r.left - miniMap.ox) / miniMap.k, wy = (ev.clientY - r.top - miniMap.oy) / miniMap.k;
    A.view.x = s.width / 2 - wx * A.view.s;
    A.view.y = s.height / 2 - wy * A.view.s;
    app.applyView();
  };
  mini.addEventListener("pointerdown", (ev) => { mini.setPointerCapture(ev.pointerId); miniGo(ev); });
  mini.addEventListener("pointermove", (ev) => { if (ev.buttons || ev.pointerType === "touch") miniGo(ev); });

  /* ------------------------------------------------------------------- help */

  const HELP = [
    ["Moving about", [["Move the board", "Space + drag, middle button, or the hand tool (H)"], ["Zoom", "Mouse wheel, pinch, + and -"],
      ["Fit everything", "Shift + 1"], ["Back to 100%", "Ctrl + 0"], ["Find text", "Ctrl + F"]]],
    ["Tools", [["Select", "V"], ["Sticky note", "N"], ["Text", "T  (or double-click the board)"], ["Shape", "R"], ["Connector", "L"],
      ["Mind map", "M"], ["Pen", "P"], ["Frame", "F"], ["Picture", "paste it, or drop the file"]]],
    ["Editing", [["Edit the text", "Double-click, Enter, or just type"], ["Finish typing", "Esc  (Ctrl + Enter)"], ["Select several", "Drag a box, or Shift + click"],
      ["Duplicate", "Ctrl + D"], ["Copy / paste", "Ctrl + C / Ctrl + V - also to another board"], ["Undo / redo", "Ctrl + Z / Ctrl + Y"],
      ["Delete", "Del"], ["Nudge", "Arrow keys (Shift: 10)"], ["Front / back", "]  /  ["], ["Bold", "Ctrl + B"], ["Lock", "Ctrl + L"],
      ["Drag without snapping", "hold Ctrl"]]],
    ["Mind map", [["Add a child", "Tab"], ["Add one below", "Enter"], ["Rename", "just type, or F2"], ["Walk the map", "Arrow keys"],
      ["Delete the branch", "Del"], ["Move a branch", "drag it onto another node"], ["Fold / unfold", "the small button on the node"]]],
    ["Touch", [["Move the board", "one finger on empty board, or two fingers"], ["Zoom", "pinch"], ["Select several", "hold still, then drag a box"],
      ["Edit the text", "tap a selected note again"], ["Mind map", "the + buttons on the selected node"]]],
  ];
  X.openHelp = function () {
    $("#help-body").innerHTML = HELP.map(([h, rows]) => `<h4>${esc(h)}</h4>` + rows.map(([a, b]) =>
      `<div><span>${esc(a)}</span><kbd>${esc(b)}</kbd></div>`).join("")).join("");
    $("#bd-help-back").hidden = false;
  };
  const closeHelp = () => { $("#bd-help-back").hidden = true; };
  $("#bd-help").onclick = X.openHelp;
  $("#help-close").onclick = closeHelp;
  $("#bd-help-back").addEventListener("pointerdown", (ev) => { if (ev.target.id === "bd-help-back") closeHelp(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!$("#bd-help-back").hidden) closeHelp();
    if (!$("#bd-link-back").hidden) closePicker();
    if (!$("#bd-new-back").hidden) $("#bd-new-back").hidden = true;
  });

  X.escape = () => { if (!panel.hidden) panel.hidden = true; };
  X.selectionChanged = () => {
    // the comments panel follows the selection while it is open
    if (!panel.hidden && A.sel.size === 1) {
      const id = Array.from(A.sel)[0], o = get(id);
      if (o && !["conn", "pen"].includes(o.t) && id !== thread.id) { thread.id = id; renderThread(); }
    }
  };
  X.boardOpened = () => {
    let on = false;
    try { on = localStorage.getItem("lwk-board:minimap") === "1"; } catch (e) {}
    setMini(on && innerWidth > 700);
    drawTimer();
    // the cards linked to issues show the issue as it is now, not as it was when the card was made
    const links = Array.from(O().values()).filter((o) => o.t === "link");
    if (links.some((o) => o.kind !== "sheet")) loadIssues().catch(() => {});
    if (links.some((o) => o.kind === "sheet")) loadSheets().catch(() => {});
  };
  X.boardClosed = () => {
    panel.hidden = true;
    stopPresent();
    closeSearch();
    $("#bd-timer-view").hidden = true;
  };
}
