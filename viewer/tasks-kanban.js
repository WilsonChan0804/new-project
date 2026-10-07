/* Kanban: a column per group (or owner, priority, status, due - whatever
 * "Group by" says), a card per task; drag a card to move it. */

import { esc, people, fmtDate, isOverdue, priorityPill, progress } from "./tasks-util.js";
import { badge } from "./filelinks.js";
import { groupLinks } from "./tasks-list.js";

function card(T, t) {
  const p = T.progressOf(t.id);
  const span = t.start && t.due ? `${fmtDate(t.start)} – ${fmtDate(t.due)}` : t.due ? "Due " + fmtDate(t.due) : t.start ? "Starts " + fmtDate(t.start) : "";
  const personFields = T.fields().filter((f) => !T.S.hidden.has("f:" + f.id));
  const kinds = [...new Set(t.links.map((l) => l.kind))];
  return `<div class="kb-card${t.done ? " done" : ""}${T.S.openId === t.id ? " sel" : ""}" data-id="${esc(t.id)}"${T.canEdit() ? ` draggable="true"` : ""}>`
    + `<div class="kb-top"><button class="tick${t.done ? " on" : ""}" data-act="done"></button><span class="kb-t">${esc(t.title || "Untitled task")}</span></div>`
    + `<div class="kb-line">${span ? `<span class="${isOverdue(t) ? "bad" : "muted"}">&#128197; ${esc(span)}</span>` : ""}<span class="spacer"></span>${people(t.owners, 3)}</div>`
    + (p.total ? `<div class="kb-line">${progress(p.done, p.total)} <small class="muted">${p.done}/${p.total}</small></div>` : "")
    + ((t.links.length || t.comment_count) ? `<div class="kb-line muted">${kinds.slice(0, 4).map(badge).join(" ")}`
      + (t.links.length ? ` <small>${t.links.length}</small>` : "") + (t.comment_count ? ` <small>&#128172; ${t.comment_count}</small>` : "") + `</div>` : "")
    + (t.priority && !T.S.hidden.has("priority") ? `<div class="kb-f"><span class="muted">Priority</span>${priorityPill(t.priority)}</div>` : "")
    + personFields.map((f) => {
      const v = t.vals[f.id];
      if (v == null || (Array.isArray(v) && !v.length)) return "";
      return `<div class="kb-f"><span class="muted">${esc(f.name)}</span>${Array.isArray(v) ? people(v, 3) : esc(v)}</div>`;
    }).join("")
    + `</div>`;
}

export function render(T, el) {
  const S = T.S;
  const buckets = T.buckets(T.visible()).filter((b) => S.groupBy === "group" || b.tasks.length || b.key === "_");
  const x = el.querySelector(".kb") ? el.querySelector(".kb").scrollLeft : 0;
  el.innerHTML = `<div class="kb">` + buckets.map((b) =>
    `<section class="kb-col" data-b="${esc(b.key)}"><header><b>${esc(b.title)}</b> <span class="muted">${b.tasks.length}</span>`
    + `</header>` + (b.project || (b.group && b.group.reg) ? `<div class="kb-links">${groupLinks(b)}</div>` : "")
    + `<div class="kb-cards">${b.tasks.map((t) => card(T, t)).join("")}</div>`
    + (T.canEdit() && (S.groupBy !== "group" || b.group) ? `<input class="kb-new" placeholder="+ New task">` : "")
    + `</section>`).join("")
    + `</div>`;
  el.querySelector(".kb").scrollLeft = x;
  wireScroll(el);

  const bucketOf = (k) => buckets.find((b) => b.key === k);
  el.onclick = (ev) => {
    const c = ev.target.closest(".kb-card");
    if (!c) return;
    const t = T.task(c.dataset.id);
    if (ev.target.closest("[data-act=done]")) return T.toggleDone(t);
    T.openTask(t.id);
  };
  el.onkeydown = (ev) => {
    const inp = ev.target.closest(".kb-new");
    if (!inp || ev.key !== "Enter" || !inp.value.trim()) return;
    const b = bucketOf(inp.closest(".kb-col").dataset.b);
    const f = { title: inp.value.trim() };
    if (b.group) f.group_id = b.group.id;
    if (b.priority !== undefined) f.priority = b.priority;
    if (b.person) f.owners = [b.person];
    if (b.done !== undefined) f.done = b.done;
    T.create(f);
    setTimeout(() => { const n = el.querySelector(`.kb-col[data-b="${CSS.escape(b.key)}"] .kb-new`); if (n) n.focus(); }, 0);
  };

  let dragId = null;
  el.ondragstart = (ev) => {
    const c = ev.target.closest(".kb-card");
    if (!c) return;
    dragId = c.dataset.id;
    T.S.dragging = true;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", dragId);
    c.classList.add("dragging");
  };
  const clear = () => { for (const x of el.querySelectorAll(".drop-before, .drop-in, .dragging")) x.classList.remove("drop-before", "drop-in", "dragging"); };
  el.ondragend = () => { dragId = null; T.S.dragging = false; clear(); };
  el.ondragover = (ev) => {
    if (!dragId) return;
    const col = ev.target.closest(".kb-col");
    if (!col) return;
    ev.preventDefault();
    clear();
    const c = ev.target.closest(".kb-card");
    if (c && c.dataset.id !== dragId) c.classList.add("drop-before"); else col.classList.add("drop-in");
  };
  el.ondrop = (ev) => {
    if (!dragId) return;
    ev.preventDefault();
    const col = ev.target.closest(".kb-col");
    const c = ev.target.closest(".kb-card");
    const t = T.task(dragId);
    const b = col && bucketOf(col.dataset.b);
    clear();
    if (t && b) T.dropInto(t, b, c && c.dataset.id !== dragId ? c.dataset.id : null);
  };
}

/* Moving sideways without reaching for the scrollbar: the mouse wheel with
   Shift (or a sideways swipe), dragging the board's empty space, and the
   ‹ › buttons at the edges. */
function wireScroll(el) {
  const kb = el.querySelector(".kb");
  for (const b of el.querySelectorAll(".kb-edge")) b.remove();
  const mk = (cls, txt, d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kb-edge " + cls;
    b.innerHTML = txt;
    b.title = d < 0 ? "Earlier columns" : "More columns";
    b.onclick = () => kb.scrollBy({ left: d * Math.max(280, kb.clientWidth * 0.8), behavior: "smooth" });
    el.appendChild(b);
    return b;
  };
  const L = mk("l", "&lsaquo;", -1), R = mk("r", "&rsaquo;", 1);
  const edges = () => {
    L.hidden = kb.scrollLeft < 4;
    R.hidden = kb.scrollLeft + kb.clientWidth >= kb.scrollWidth - 4;
  };
  kb.addEventListener("scroll", edges, { passive: true });
  edges();
  kb.addEventListener("wheel", (ev) => {
    if (!ev.shiftKey || ev.deltaX) return;
    kb.scrollLeft += ev.deltaY;
    ev.preventDefault();
  }, { passive: false });
  kb.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.pointerType !== "mouse" || ev.target.closest(".kb-card, input, button, a, .kb-cards")) return;
    DRAG.kb = kb;
    DRAG.x = ev.clientX;
    DRAG.left = kb.scrollLeft;
    kb.classList.add("grab");
  });
  if (!DRAG.wired) {
    DRAG.wired = true;
    addEventListener("pointermove", (ev) => { if (DRAG.kb) DRAG.kb.scrollLeft = DRAG.left - (ev.clientX - DRAG.x); });
    addEventListener("pointerup", () => { if (DRAG.kb) { DRAG.kb.classList.remove("grab"); DRAG.kb = null; } });
  }
}
const DRAG = { kb: null, x: 0, left: 0, wired: false };
