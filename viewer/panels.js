/* Side columns the user can size, pin and fold away, and a draggable
 * divider between the two halves of a split view.
 *
 *   - drag the inner edge of a column to make it wider or narrower
 *     (double-click the edge: back to the usual width);
 *   - the small tab on that edge carries a pin. Pinned (the default), the
 *     column always stays. Unpinned, a triangle appears on the tab that
 *     folds the column away and brings it back - until it is pinned again;
 *   - in 2D + 3D and the split sheet view, drag the bar between the two
 *     halves (double-click: halves again).
 *
 * Kept per page in this browser. Phones and upright tablets keep their
 * slide-in drawers: none of this shows there.
 */

const MIN = 120, FOLD = 0;

function load(key) {
  try { return JSON.parse(localStorage.getItem("lwk.panels." + key) || "{}") || {}; } catch (e) { return {}; }
}
function save(key, st) {
  try { localStorage.setItem("lwk.panels." + key, JSON.stringify(st)); } catch (e) {}
}
const drawerMode = () => document.body.classList.contains("drawers") || document.body.classList.contains("drawers2d");
function kick() {
  // canvases, the 3D view and the sharp overlay follow a window resize
  try { window.dispatchEvent(new Event("resize")); } catch (e) {}
}

/* layout: the grid; left/right: its two <aside> columns; key: page name */
export function initPanels({ layout, left, right, key }) {
  if (!layout || !left || !right) return null;
  const st = Object.assign({ l: {}, r: {} }, load(key));
  st.l = Object.assign({ pin: true, hid: false }, st.l);
  st.r = Object.assign({ pin: true, hid: false }, st.r);
  if (getComputedStyle(layout).position === "static") layout.style.position = "relative";

  const side = {
    l: { el: left, st: st.l, grip: null, tab: null },
    r: { el: right, st: st.r, grip: null, tab: null },
  };

  function usual(s) {
    // the width the page's own style gives this column
    const saved = layout.style.gridTemplateColumns;
    layout.style.gridTemplateColumns = "";
    const w = s.el.getBoundingClientRect().width;
    layout.style.gridTemplateColumns = saved;
    return Math.round(w) || 220;
  }

  function widthOf(s) {
    if (s.st.hid && !s.st.pin) return FOLD;
    return s.st.w ? Math.max(MIN, Math.min(s.st.w, innerWidth * 0.45)) : null;
  }

  function apply() {
    if (drawerMode() || getComputedStyle(left).display === "none") {
      layout.style.gridTemplateColumns = "";
      for (const s of Object.values(side)) { s.el.classList.remove("folded"); if (s.grip) s.grip.hidden = true; if (s.tab) s.tab.hidden = true; }
      return;
    }
    const lw = widthOf(side.l), rw = widthOf(side.r);
    if (lw === null && rw === null) layout.style.gridTemplateColumns = "";
    else {
      const L = lw === null ? usual(side.l) : lw, R = rw === null ? usual(side.r) : rw;
      layout.style.gridTemplateColumns = `${L}px minmax(0, 1fr) ${R}px`;
    }
    for (const [k, s] of Object.entries(side)) {
      const folded = s.st.hid && !s.st.pin;
      s.el.classList.toggle("folded", folded);
      s.grip.hidden = folded;
      s.tab.hidden = false;
      place(k, s);
      const pin = s.tab.querySelector(".pnl-pin"), tri = s.tab.querySelector(".pnl-tri");
      pin.classList.toggle("on", s.st.pin);
      pin.title = s.st.pin ? "Pinned: this column stays. Unpin to be able to fold it away" : "Pin this column so it always stays";
      tri.hidden = s.st.pin;
      const openGlyph = k === "l" ? "◀" : "▶", closedGlyph = k === "l" ? "▶" : "◀";
      tri.textContent = folded ? closedGlyph : openGlyph;
      tri.title = folded ? "Show this column" : "Fold this column away";
      s.tab.classList.toggle("folded", folded);
    }
  }

  function place(k, s) {
    const lr = layout.getBoundingClientRect(), er = s.el.getBoundingClientRect();
    const folded = s.st.hid && !s.st.pin;
    const edge = k === "l" ? (folded ? 0 : er.right - lr.left) : (folded ? lr.width : er.left - lr.left);
    s.grip.style.left = (edge - 3) + "px";
    s.tab.style.left = (k === "l" ? edge : edge - 20) + "px";
  }

  function build(k, s) {
    const g = document.createElement("div");
    g.className = "pnl-grip pnl-" + k;
    g.title = "Drag to size this column (double-click: usual width)";
    layout.appendChild(g);
    s.grip = g;
    const t = document.createElement("div");
    t.className = "pnl-tab pnl-" + k;
    t.innerHTML = `<button type="button" class="pnl-pin" aria-label="Pin">\u{1F4CC}</button><button type="button" class="pnl-tri" aria-label="Fold"></button>`;
    layout.appendChild(t);
    s.tab = t;
    t.querySelector(".pnl-pin").addEventListener("click", () => {
      s.st.pin = !s.st.pin;
      if (s.st.pin) s.st.hid = false;
      save(key, st); apply(); kick();
    });
    t.querySelector(".pnl-tri").addEventListener("click", () => {
      s.st.hid = !s.st.hid;
      save(key, st); apply(); kick();
    });
    g.addEventListener("dblclick", () => { delete s.st.w; save(key, st); apply(); kick(); });
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      g.classList.add("drag");
      document.body.classList.add("pnl-dragging");
      const x0 = e.clientX, w0 = s.el.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - x0;
        s.st.w = Math.round(Math.max(MIN, Math.min(innerWidth * 0.45, k === "l" ? w0 + dx : w0 - dx)));
        apply();
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        g.classList.remove("drag");
        document.body.classList.remove("pnl-dragging");
        save(key, st); kick();
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
  }

  build("l", side.l);
  build("r", side.r);
  apply();
  addEventListener("resize", () => requestAnimationFrame(apply));
  // the drawers switch on and off with the window's shape
  new MutationObserver(() => apply()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (window.ResizeObserver) new ResizeObserver(() => { for (const [k, s] of Object.entries(side)) if (!drawerMode()) place(k, s); }).observe(layout);
  return { apply, state: st };
}

/* row: the flex row holding the main pane first; panes: the second halves
   (only one shows at a time); modes: the row's classes that mean "split" */
export function initSplitter({ row, first, key, modes }) {
  if (!row || !first) return null;
  const st = load(key);
  const g = document.createElement("div");
  g.className = "row-grip";
  g.title = "Drag to share the space between the two views (double-click: halves)";
  first.after(g);
  const mode = () => modes.find((m) => row.classList.contains(m)) || "";
  const vertical = () => getComputedStyle(row).flexDirection === "column";

  function apply() {
    const m = mode();
    g.hidden = !m;
    g.classList.toggle("v", vertical());
    const pct = m && st[m];
    first.style.flex = pct ? `0 0 ${pct}%` : "";
  }

  g.addEventListener("dblclick", () => { delete st[mode()]; save(key, st); apply(); kick(); });
  g.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !mode()) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    g.classList.add("drag");
    document.body.classList.add("pnl-dragging");
    const r = row.getBoundingClientRect(), v = vertical(), m = mode();
    const move = (ev) => {
      const f = v ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
      st[m] = Math.round(Math.max(15, Math.min(85, f * 100)) * 10) / 10;
      apply();
    };
    const up = () => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      g.removeEventListener("pointercancel", up);
      g.classList.remove("drag");
      document.body.classList.remove("pnl-dragging");
      save(key, st); kick();
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  });
  new MutationObserver(apply).observe(row, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", apply);
  apply();
  return { apply };
}

/* A block inside a column (the selected element's properties, an area's
   parameters) whose height the user sets: drag the bar under it; double-
   click the bar for the usual height. Kept per page in this browser.
   el: the block; grip goes after it (or inside it, at its foot, when
   inside is true - so it hides with the block). */
export function initVGrip({ el, key, def = 0.45, min = 60, inside = false }) {
  if (!el) return null;
  const st = load(key);
  const g = document.createElement("div");
  g.className = "vgrip";
  g.title = "Drag to make this taller or shorter (double-click: usual height)";
  if (inside) el.appendChild(g); else el.after(g);
  const col = () => el.closest("aside") || el.parentNode;
  const usual = () => Math.round((col().getBoundingClientRect().height || innerHeight) * def);
  function apply() {
    const h = st.h ? Math.max(min, Math.min(st.h, innerHeight - 120)) : usual();
    el.style.height = h + "px";
    el.style.maxHeight = "none";
  }
  g.addEventListener("dblclick", () => { delete st.h; save(key, st); apply(); });
  g.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    g.classList.add("drag");
    document.body.classList.add("pnl-vdragging");
    const y0 = e.clientY, h0 = el.getBoundingClientRect().height;
    const move = (ev) => { st.h = Math.round(h0 + ev.clientY - y0); apply(); };
    const up = () => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      g.removeEventListener("pointercancel", up);
      g.classList.remove("drag");
      document.body.classList.remove("pnl-vdragging");
      save(key, st);
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  });
  apply();
  addEventListener("resize", apply);
  return { apply };
}

/* Sections that fold: a click on a heading hides what follows it, up to
   the next heading, and the choice is remembered (per device, under key).
   heads: the heading elements, in order. nameOf(head): the name a section
   is remembered by (its first words by default). Can be called again after
   a part of the page is drawn anew: each heading is wired once. */
export function foldSections(heads, key, nameOf) {
  heads = [...heads];
  const set = new Set(heads);
  let folded = {};
  try { folded = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
  heads.forEach((head, i) => {
    const name = nameOf ? nameOf(head, i)
      : (head.textContent || "").trim().split(/\s+/).slice(0, 3).join(" ") || "section" + i;
    const body = [];
    for (let el = head.nextElementSibling; el && !set.has(el); el = el.nextElementSibling) body.push(el);
    let chev = head.querySelector(":scope > .chev");
    if (!chev) {
      chev = document.createElement("span");
      chev.className = "chev";
      head.insertBefore(chev, head.firstChild);
    }
    head.classList.add("foldable");
    if (!head.title) head.title = "Click to fold or open this section";
    const apply = () => {
      const f = !!folded[name];
      head.classList.toggle("folded", f);
      chev.textContent = f ? "▸" : "▾";
      body.forEach((el) => el.classList.toggle("sec-folded", f));
    };
    if (!head._fold) {
      head.addEventListener("click", (ev) => {
        if (ev.target.closest("button, input, select, label, a")) return;
        folded[name] = !folded[name];
        try { localStorage.setItem(key, JSON.stringify(folded)); } catch (e) {}
        head._fold();
      });
    }
    head._fold = apply;
    apply();
  });
}
