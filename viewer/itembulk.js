/* Comments and issues: what Sheets and 3D share.

   Endorsed and archived items leave the drawing and the list; ticking rows
   (Select) for one action on them all; the markup layers (an eye each, made,
   emptied and moved between in one panel). Each page makes one kit with its
   own hooks:

     S          the page state: items, hiddenLayers, layerRules, showArchived, showEndorsed, sel
     putItem    save one item (true when saved)
     remember   ids -> an undo step (optional)
     status     a line in the status bar
     redraw     repaint the drawing / the 3D pins
     renderList rebuild the list
     inScope    the items this page counts on layers
     here       the items on what is open now (this sheet; the 3D model)
     selection  ids selected on the drawing (optional)
     moveItems  ids -> move to another sheet (Sheets only)
     onLayers   the layer list changed (the page's own layer picker)
     reloadLayerRules  read /api/layers again
     kindLabel  a markup type's name (optional)

   The server checks the same rules: app.py check_item_rules. */
import * as Store from "./store.js";
import { openMenu } from "./ctxmenu.js";
import { iconSvg } from "./icons.js";

export function createItemKit(env) {
  const S = env.S;
  const onLayers = () => { if (env.onLayers) env.onLayers(); };
  const LAYERS = {
    key: (k) => "lwk-viewer:" + k + ":" + (Store.currentProject() || "default"),
    current() {
      try { return localStorage.getItem(this.key("layer")) || "General"; } catch (e) { return "General"; }
    },
    setCurrent(v) { try { localStorage.setItem(this.key("layer"), v); } catch (e) {} },
    hidden() {
      try { return new Set(JSON.parse(localStorage.getItem(this.key("hidden-layers")) || "[]")); } catch (e) { return new Set(); }
    },
    setHidden(set) { try { localStorage.setItem(this.key("hidden-layers"), JSON.stringify([...set])); } catch (e) {} S.hiddenLayers = set; },
    // layers made here, kept on this device per project (an empty one survives a reload)
    local() { try { return JSON.parse(localStorage.getItem(this.key("extra-layers")) || "[]"); } catch (e) { return []; } },
    addLocal(n) { const l = new Set(this.local()); l.add(n); try { localStorage.setItem(this.key("extra-layers"), JSON.stringify([...l])); } catch (e) {} },
    removeLocal(n) { try { localStorage.setItem(this.key("extra-layers"), JSON.stringify(this.local().filter((x) => x !== n))); } catch (e) {} },
    all() {
      const names = new Set(["General", this.current()]);
      for (const it of S.items || []) if (!it.deleted) names.add(it.layer || "General");
      for (const n of this.extra) names.add(n);
      for (const n of this.local()) names.add(n);
      return [...names].sort((a, b) => (a === "General" ? -1 : b === "General" ? 1 : a.localeCompare(b)));
    },
    extra: new Set(),
  };
  const layerOf = (it) => it.layer || "General";
  // set by the project admin (server): may this person change markups on it?
  /* who may do what to a markup (the server checks the same: app.py check_item_rules) */
  const myUid = () => { const m = /^u(\d+)$/.exec(Store.userKey() || ""); return m ? +m[1] : null; };
  const isAdmin = () => !S.layerRules || !S.layerRules.accounts || !!S.layerRules.admin;
  const madeByMe = (it) => it.author_id == null || myUid() === +it.author_id;
  const raisedByMe = (it) => { const a = it.issue && it.issue.author_id != null ? it.issue.author_id : it.author_id; return a == null || myUid() === +a; };
  const assignedToMe = (it) => !!it.issue && !!(it.issue.assigned_to || "").trim()
    && (it.issue.assigned_to || "").trim().toLowerCase() === (Store.author() || "").trim().toLowerCase();
  const layerLocked = (it) => !!(S.layerRules && S.layerRules.mine
    && S.layerRules.mine[layerOf(it)] && S.layerRules.mine[layerOf(it)].edit === false);
  const layerEditable = (name) => !(S.layerRules && S.layerRules.mine && S.layerRules.mine[name]
    && S.layerRules.mine[name].edit === false);

  /* The markup layers, as in Photoshop: an eye each (shown for you, on this
     device), Only this, All on / All off; + New layer; ▸ opens a layer's
     markups on this sheet, which drag onto another layer (ticked ones go
     together); ⇥ moves the drawing's selection onto a layer; 🗑 removes a
     layer nothing is on. The drawing, the list and the PDF window follow. */
  const LP_OPEN = new Set();
  function openLayersPop(anchor, keep) {
    const sel = () => (env.selection ? env.selection() : []) || [];
    const old = document.getElementById("layers-pop");
    if (old && !keep) { old.remove(); return; }
    const pop = old || document.createElement("div");
    pop.id = "layers-pop";
    const ticked = new Set();
    const eye = (on) => on
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>';
    const q = (n) => String(n).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const adminLayer = (n) => !!(S.layerRules && S.layerRules.layers && S.layerRules.layers[n]);
    const kind = (t) => (env.kindLabel && env.kindLabel(t)) || (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/[-_]/g, " ") : "Markup");
    const label = (it) => (it.issue ? `#${it.issue.number || "?"} ${it.issue.title || "Issue"}` : (it.text || kind(it.type))) + (it.author ? " \u00b7 " + it.author : "");
    const paint = () => {
      const counts = new Map();
      for (const it of S.items || []) if (!it.deleted && env.inScope(it)) counts.set(layerOf(it), (counts.get(layerOf(it)) || 0) + 1);
      const here = (n) => (S.items || []).filter((it) => !it.deleted && env.here(it) && layerOf(it) === n);
      const cur = LAYERS.current(), nsel = sel().length;
      pop.innerHTML = `<div class="lp-head">Markup layers <span class="muted">(shown for you)</span></div>`
        + `<form class="lp-new"><input type="text" maxlength="60" placeholder="New layer name" aria-label="New layer name"><button type="submit">+ New layer</button></form>`
        + LAYERS.all().map((n) => {
          const on = !S.hiddenLayers.has(n), c = counts.get(n) || 0, ed = layerEditable(n), open = LP_OPEN.has(n);
          const canRm = n !== "General" && !c && (!adminLayer(n) || isAdmin());
          const rmTip = n === "General" ? "General is always there" : c ? `${c} markup(s) are on it - move them first` : adminLayer(n) && !isAdmin() ? "Set by a project admin" : "Remove this empty layer";
          let h = `<div class="lp-row${on ? "" : " off"}${ed ? "" : " locked"}" data-l="${q(n)}">`
            + `<button type="button" class="lp-open" data-open="${q(n)}" title="${open ? "Close" : "Show"} its markups on this sheet">${open ? "▾" : "▸"}</button>`
            + `<button type="button" class="lp-eye" data-eye="${q(n)}" title="${on ? "Hide" : "Show"} this layer">${eye(on)}</button>`
            + `<span class="lp-n" data-cur="${q(n)}" title="Double-click: draw on this layer">${q(n)}${n === cur ? ' <small class="muted">current</small>' : ""}${ed ? "" : " \u{1F512}"}</span>`
            + `<span class="muted lp-c">${c}</span>`
            + (nsel && ed ? `<button type="button" class="lp-here" data-here="${q(n)}" title="Move the ${nsel} selected ${env.noun || "markup"}(s) onto this layer">⇥</button>` : "")
            + `<button type="button" class="lp-solo" data-solo="${q(n)}" title="Show only this layer">Only</button>`
            + `<button type="button" class="lp-rm" data-rm="${q(n)}" title="${q(rmTip)}"${canRm ? "" : " disabled"}>\u{1F5D1}</button></div>`;
          if (open) {
            const list = here(n);
            h += `<div class="lp-objs" data-l="${q(n)}">` + (list.length ? list.map((it) => `<div class="lp-obj" draggable="true" data-id="${q(it.id)}" title="Drag onto another layer">`
              + `<input type="checkbox" data-tick="${q(it.id)}"${ticked.has(it.id) ? " checked" : ""}><span class="lp-on">${iconSvg(it.type, 13) || ""}</span><span class="lp-ot">${q(label(it)).slice(0, 80)}</span></div>`).join("")
              : `<div class="lp-none muted">${env.emptyHere || "Nothing on this sheet"}</div>`) + `</div>`;
          }
          return h;
        }).join("")
        + `<div class="lp-foot"><button class="ghost" data-a="all">All on</button><button class="ghost" data-a="none">All off</button><button class="ghost" data-a="only">Only the current</button></div>`
        + (S.layerRules && S.layerRules.admin && S.layerRules.accounts
          ? `<div class="lp-foot"><a href="${"admin.html?project=" + encodeURIComponent(Store.currentProject() || "")}#layers">Who can see and edit each layer ...</a></div>` : "");
    };
    const set = (hid) => {
      LAYERS.setHidden(hid);
      if (S.sel) S.sel = S.sel.filter((id) => { const it = S.items.find((x) => x.id === id); return it && !hid.has(layerOf(it)); });
      paint(); env.redraw(); env.renderList();
    };
    const moveTo = async (ids, target) => {
      if (!layerEditable(target)) { env.status(`The layer "${target}" is locked for you.`); return; }
      ids = ids.filter((id) => { const it = S.items.find((x) => x.id === id); return it && layerOf(it) !== target; });
      if (!ids.length) return;
      await bulkApply(ids, "layer", target);
      ticked.clear();
      onLayers();
      paint();
    };
    paint();
    if (!old) {
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(6, Math.min(innerWidth - pop.offsetWidth - 6, r.left)) + "px";
      pop.style.top = (r.bottom + 360 < innerHeight ? r.bottom + 4 : Math.max(6, r.top - pop.offsetHeight - 4)) + "px";
      const away = (e) => { if (!document.body.contains(pop)) { document.removeEventListener("pointerdown", away, true); return; }
        if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target) && !e.target.closest("#ctxmenu")) { pop.remove(); document.removeEventListener("pointerdown", away, true); } };
      setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    }
    pop.onsubmit = (e) => {
      e.preventDefault();
      const inp = pop.querySelector(".lp-new input"), v = inp.value.trim();
      if (!v) return;
      if (LAYERS.all().some((n) => n.toLowerCase() === v.toLowerCase())) { inp.classList.add("bad"); env.status(`There is a layer "${v}" already.`); return; }
      LAYERS.extra.add(v); LAYERS.addLocal(v); LAYERS.setCurrent(v);
      onLayers(); paint();
      env.status(`Layer "${v}" made - new markups go on it.`);
    };
    pop.onkeydown = (e) => e.stopPropagation();
    pop.onchange = (e) => { const t = e.target.dataset && e.target.dataset.tick; if (t) { if (e.target.checked) ticked.add(t); else ticked.delete(t); } };
    pop.ondblclick = (e) => { const c = e.target.closest("[data-cur]"); if (c && layerEditable(c.dataset.cur)) { LAYERS.setCurrent(c.dataset.cur); onLayers(); paint(); } };
    pop.onclick = async (e) => {
      const t = e.target.closest("[data-eye],[data-solo],[data-a],[data-open],[data-here],[data-rm]");
      if (!t) return;
      const all = LAYERS.all(), d = t.dataset;
      if (d.eye !== undefined) { const h = new Set(S.hiddenLayers); if (h.has(d.eye)) h.delete(d.eye); else h.add(d.eye); set(h); }
      else if (d.solo !== undefined) set(new Set(all.filter((n) => n !== d.solo)));
      else if (d.open !== undefined) { if (LP_OPEN.has(d.open)) LP_OPEN.delete(d.open); else LP_OPEN.add(d.open); paint(); }
      else if (d.here !== undefined) moveTo(sel().slice(), d.here);
      else if (d.rm !== undefined && !t.disabled) {
        const n = d.rm;
        if (adminLayer(n) && isAdmin()) {
          if (!confirm(`Remove the layer "${n}" for everyone on the project (its who-can-see rules go too)?`)) return;
          const layers = Object.assign({}, S.layerRules.layers); delete layers[n];
          try { await Store.api("/api/layers", { method: "PUT", body: JSON.stringify({ layers }) }); await env.reloadLayerRules(); }
          catch (err) { env.status("Could not remove the layer: " + err.message); return; }
        }
        LAYERS.extra.delete(n); LAYERS.removeLocal(n);
        if (LAYERS.current() === n) LAYERS.setCurrent("General");
        const h = new Set(S.hiddenLayers); h.delete(n); LAYERS.setHidden(h);
        onLayers(); paint(); env.redraw(); env.renderList();
        env.status(`Layer "${n}" removed.`);
      }
      else if (d.a === "all") set(new Set());
      else if (d.a === "none") set(new Set(all));
      else if (d.a === "only") set(new Set(all.filter((n) => n !== LAYERS.current())));
    };
    // drag a markup (or the ticked ones) onto another layer
    pop.ondragstart = (e) => {
      const o = e.target.closest(".lp-obj");
      if (!o) return;
      const ids = ticked.has(o.dataset.id) ? [...ticked] : [o.dataset.id];
      e.dataTransfer.setData("text/plain", JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
    };
    pop.ondragover = (e) => { const r = e.target.closest(".lp-row, .lp-objs"); if (r) { e.preventDefault(); pop.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); r.classList.add("drop"); } };
    pop.ondragleave = (e) => { const r = e.target.closest(".lp-row, .lp-objs"); if (r && !r.contains(e.relatedTarget)) r.classList.remove("drop"); };
    pop.ondrop = (e) => {
      const r = e.target.closest(".lp-row, .lp-objs");
      if (!r) return;
      e.preventDefault();
      r.classList.remove("drop");
      let ids = [];
      try { ids = JSON.parse(e.dataTransfer.getData("text/plain") || "[]"); } catch (err) {}
      if (Array.isArray(ids) && ids.length) moveTo(ids, r.dataset.l);
    };
  }

  const isEndorsed = (it) => !!(it && it.issue && it.issue.endorsed && (it.issue.status || "Open") === "Closed");
  const offView = (it) => (it.archived && !S.showArchived) || (isEndorsed(it) && !S.showEndorsed);

  /* Ticking rows in the list (Select), then one action for them all. Each is
     done only where this person may (as the server rules: app.py
     check_item_rules); the rest are counted and said. */
  const PICK_L = { on: false, sel: new Set(), last: null };
  function bulkRule(it, kind) {
    if (!it) return "gone";
    if (["archive", "restore", "move", "layer"].includes(kind) && layerLocked(it)) return "its layer is locked for you";
    if (kind === "close") {
      if (!it.issue) return "not an issue";
      if ((it.issue.status || "Open") === "Closed") return "already closed";
      return assignedToMe(it) || isAdmin() ? "" : "not assigned to you";
    }
    if (kind === "endorse") {
      if (!it.issue) return "not an issue";
      if ((it.issue.status || "Open") !== "Closed") return "not closed yet";
      if (it.issue.endorsed) return "already endorsed";
      return raisedByMe(it) || isAdmin() ? "" : "not raised by you";
    }
    if (kind === "archive") return it.archived ? "already archived" : madeByMe(it) || isAdmin() ? "" : "not made by you";
    if (kind === "restore") return !it.archived ? "not archived" : madeByMe(it) || isAdmin() ? "" : "not made by you";
    if (kind === "move") return madeByMe(it) || isAdmin() ? "" : "not made by you";
    if (kind === "layer") return "";
    return "unknown";
  }
  async function bulkApply(ids, kind, arg) {
    const items = ids.map((id) => S.items.find((x) => x.id === id));
    const ok = [], skip = new Map();
    items.forEach((it, i) => {
      let why = bulkRule(it, kind);
      if (!why && kind === "layer" && !layerEditable(arg)) why = "that layer is locked for you";
      if (!why && kind === "move" && it.sheet === arg) why = "already on that sheet";
      if (why) skip.set(why, (skip.get(why) || 0) + 1); else ok.push(it || items[i]);
    });
    if (!ok.length) { env.status("Nothing changed: " + [...skip].map(([w, n]) => `${n} ${w}`).join(", ") + "."); return 0; }
    if (env.remember) env.remember(ok.map((it) => it.id));
    const now = new Date().toISOString(), me = Store.author() || "";
    for (const it of ok) {
      if (kind === "close") it.issue.status = "Closed";
      else if (kind === "endorse") it.issue.endorsed = { by: me, at: now };
      else if (kind === "archive") it.archived = { by: me, at: now };
      else if (kind === "restore") delete it.archived;
      else if (kind === "move") it.sheet = arg;
      else if (kind === "layer") it.layer = arg;
    }
    let saved = 0;
    for (let i = 0; i < ok.length; i++) {
      if (ok.length > 5) env.status(`Saving ${i + 1} of ${ok.length} ...`);
      if (await env.putItem(ok[i])) saved++;
    }
    const verb = { close: "Closed", endorse: "Endorsed", archive: "Archived", restore: "Restored", move: "Moved to " + arg, layer: "Put on layer " + arg }[kind];
    env.status(`${verb}: ${saved}` + (skip.size ? " · skipped " + [...skip].map(([w, n]) => `${n} (${w})`).join(", ") : "") + (kind === "layer" || kind === "archive" || kind === "move" || kind === "restore" ? " · Ctrl+Z undoes" : ""));
    PICK_L.sel.clear();
    S.items = Store.all();
    env.redraw(); env.renderList();
    return saved;
  }

  function paintBulkBar(shownIds, barId) {
    const bar = document.getElementById(barId || "list-bulk");
    if (!bar) return;
    bar.hidden = !PICK_L.on;
    if (!PICK_L.on) return;
    for (const id of [...PICK_L.sel]) if (!S.items.some((x) => x.id === id)) PICK_L.sel.delete(id);
    const n = PICK_L.sel.size;
    const ids = () => [...PICK_L.sel];
    bar.innerHTML = `<div class="lb-top"><b>${n} chosen</b><button type="button" data-b="all">All shown (${shownIds.length})</button>`
      + `<button type="button" data-b="none"${n ? "" : " disabled"}>Clear</button><span class="spacer"></span><button type="button" data-b="done">Done</button></div>`
      + `<div class="lb-acts">`
      + `<button type="button" data-b="close"${n ? "" : " disabled"}>Close</button>`
      + `<button type="button" data-b="endorse"${n ? "" : " disabled"}>Endorse</button>`
      + (S.showArchived ? `<button type="button" data-b="restore"${n ? "" : " disabled"}>Restore</button>` : "")
      + `<button type="button" data-b="archive"${n ? "" : " disabled"}>Archive</button>`
      + (env.moveItems ? `<button type="button" data-b="move"${n ? "" : " disabled"}>Move to sheet ...</button>` : "")
      + `<button type="button" data-b="layer"${n ? "" : " disabled"}>Layer ▸</button></div>`;
    bar.onclick = (ev) => {
      const b = ev.target.closest("[data-b]");
      if (!b || b.disabled) return;
      const k = b.dataset.b;
      if (k === "all") { shownIds.forEach((id) => PICK_L.sel.add(id)); env.renderList(); }
      else if (k === "none") { PICK_L.sel.clear(); env.renderList(); }
      else if (k === "done") { PICK_L.on = false; PICK_L.sel.clear(); const lp = document.getElementById("list-pick"); if (lp) lp.classList.remove("active"); env.renderList(); }
      else if (k === "move") env.moveItems(ids());
      else if (k === "layer") {
        const r = b.getBoundingClientRect();
        openMenu(r.left, r.top - 8, LAYERS.all().map((name) => ({ label: name, disabled: !layerEditable(name), action: () => bulkApply(ids(), "layer", name) })));
      } else bulkApply(ids(), k);
    };
  }

  return { LAYERS, layerOf, myUid, isAdmin, madeByMe, raisedByMe, assignedToMe, layerLocked, layerEditable,
    openLayersPop, isEndorsed, offView, PICK_L, bulkRule, bulkApply, paintBulkBar };
}
