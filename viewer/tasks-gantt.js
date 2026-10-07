/* Gantt: the tasks on a timeline. Drag a bar to move it, drag its ends to
 * change the start or the due date; click an empty row to give a task
 * dates. A task with only a due date is a diamond. */

import { esc, people, fmtDate, today, addDays, daysBetween, isOverdue, avatarColor, modal } from "./tasks-util.js";

/* Where a task sits on the timeline: [first day, last day, kind].
   plan  start and due date            a solid bar
   due   due date only                 a diamond on the day
   open  start date only               runs to today (or to when it was done), fading out
   none  no dates at all               from when it was made, drawn as an outline */
function spanOf(t) {
  const s = (t.start || "").slice(0, 10), d = (t.due || "").slice(0, 10);
  const fin = (t.completed_at || "").slice(0, 10), now = today();
  if (s && d) return [s, d < s ? s : d, "plan"];
  if (d) return [d, d, "due"];
  if (s) return [s, fin && fin >= s ? fin : t.done ? s : (now > s ? now : s), "open"];
  const c = (t.created_at || "").slice(0, 10);
  if (c) return [c, fin && fin >= c ? fin : t.done ? c : (now > c ? now : c), "none"];
  return null;
}

const DONE = "#16a34a";
function colourOf(t) {
  if (t.done) return DONE;
  if (isOverdue(t)) return "#e2453c";
  return t.owners[0] ? avatarColor(t.owners[0].name) : "#3b82f6";
}

const LEGEND = `<span class="gt-leg">`
  + `<span><i class="lg-bar" style="--c:#3b82f6"></i>Planned (colour of the first owner)</span>`
  + `<span><i class="lg-bar" style="--c:${DONE}"></i>Done</span>`
  + `<span><i class="lg-bar" style="--c:#e2453c"></i>Overdue</span>`
  + `<span><i class="lg-bar open" style="--c:#6366f1"></i>Start date only</span>`
  + `<span><i class="lg-bar none" style="--c:#6366f1"></i>No dates</span>`
  + `<span><i class="lg-ms"></i>Due date only</span>`
  + `<span><i class="lg-ms gold"></i>Milestone</span>`
  + `<span><i class="lg-today"></i>Today</span></span>`;

const ZOOM = { day: 34, week: 14, month: 4 };
const LEFT = 300;

export function render(T, el) {
  const S = T.S;
  const zoom = S.ganttZoom || "week";
  const px = ZOOM[zoom];
  const tasks = T.visible();
  const rows = [];
  for (const b of T.buckets(tasks)) {
    if (S.groupBy !== "group" && !b.tasks.length) continue;
    rows.push({ head: b });
    if (S.collapsed.has(b.key)) continue;
    for (const t of b.tasks) {
      const add = (x, depth) => {
        rows.push({ t: x, depth });
        if (S.expanded.has(x.id)) for (const k of T.children(x.id)) add(k, depth + 1);
      };
      add(t, 0);
    }
  }
  // the span shown: everything dated, with room either side, and today
  const dates = [today()];
  for (const r of rows) if (r.t) { const sp = spanOf(r.t); if (sp) dates.push(sp[0], sp[1]); }
  dates.sort();
  let d0 = addDays(dates[0], zoom === "month" ? -30 : -10);
  let d1 = addDays(dates[dates.length - 1], zoom === "month" ? 90 : 30);
  if (zoom !== "day") d0 = addDays(d0, -((new Date(d0 + "T00:00:00Z").getUTCDay() + 6) % 7));   // a Monday
  const n = daysBetween(d0, d1) + 1;
  const W = n * px;
  const x = (ymd) => daysBetween(d0, ymd.slice(0, 10)) * px;

  // header: months over days / weeks
  let top = "", bot = "";
  for (let i = 0; i < n; i++) {
    const d = addDays(d0, i), dt = new Date(d + "T00:00:00Z");
    if (dt.getUTCDate() === 1 || i === 0) {
      top += `<span style="left:${i * px}px">${dt.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</span>`;
    }
    if (zoom === "day") bot += `<span class="${[0, 6].includes(dt.getUTCDay()) ? "we" : ""}" style="left:${i * px}px;width:${px}px">${dt.getUTCDate()}</span>`;
    else if (zoom === "week" && dt.getUTCDay() === 1) bot += `<span style="left:${i * px}px;width:${7 * px}px">${dt.getUTCDate()}</span>`;
  }
  // weekend shading and month lines, drawn once as a background
  let grid = "";
  for (let i = 0; i < n; i++) {
    const dt = new Date(addDays(d0, i) + "T00:00:00Z");
    if (zoom !== "month" && [0, 6].includes(dt.getUTCDay())) grid += `<i class="we" style="left:${i * px}px;width:${px}px"></i>`;
    if (dt.getUTCDate() === 1) grid += `<i class="ml" style="left:${i * px}px"></i>`;
  }
  const tx = x(today());

  const bar = (t) => {
    const sp = spanOf(t);
    if (!sp) return `<span class="gt-hint">${T.canEdit() ? "click to schedule" : ""}</span>`;
    const [s, e, kind] = sp;
    const col = colourOf(t);
    const ms = T.isMilestone(t);
    const tip = `${t.title}\n${kind === "plan" ? fmtDate(s) + " - " + fmtDate(e) : kind === "due" ? "Due " + fmtDate(e)
      : kind === "open" ? "Started " + fmtDate(s) + " - no due date" : "No dates - shown from when it was made"}${t.done ? "\nDone" : isOverdue(t) ? "\nOverdue" : ""}`;
    if (ms || kind === "due") {
      return `<span class="gt-ms${ms ? " gold" : ""}" data-id="${esc(t.id)}" data-kind="ms" style="left:${x(e) + px / 2 - 8}px;${ms ? "" : "background:" + col}" title="${esc(tip)}"></span>`
        + `<span class="gt-lab" style="left:${x(e) + px + 8}px">${ms ? "<b>Milestone</b> · " : ""}${esc(t.title)}</span>`;
    }
    const w = Math.max(px, (daysBetween(s, e) + 1) * px);
    return `<span class="gt-bar k-${kind}${t.done ? " done" : ""}" data-id="${esc(t.id)}" style="left:${x(s)}px;width:${w}px;--c:${col}" `
      + `title="${esc(tip)}"><b class="gt-h l"></b><em>${esc(w > 80 ? t.title : "")}</em><b class="gt-h r"></b></span>`
      + (w <= 80 ? `<span class="gt-lab" style="left:${x(s) + w + 6}px">${esc(t.title)}</span>` : "");
  };


  const prevScroll = el.querySelector(".gt-scroll");
  const sx = prevScroll ? prevScroll.scrollLeft : null, sy = prevScroll ? prevScroll.scrollTop : 0;
  el.innerHTML = `<div class="gt-bar-top">Zoom <span class="gt-zoom">${Object.keys(ZOOM).map((z) =>
    `<button data-z="${z}" class="${z === zoom ? "on" : ""}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}</span>`
    + `<button class="ghost gt-today">Today</button><span class="muted" style="font-size:11px">Drag bars to move; drag the ends to change dates.</span></div>`
    + `<div class="gt-legend">${LEGEND}</div>`
    + `<div class="gt-scroll"><div class="gt" style="width:${LEFT + W}px;--left:${LEFT}px">`
    + `<div class="gt-row gt-headrow"><div class="gt-l"><b>Task</b></div><div class="gt-r" style="width:${W}px"><div class="gt-mon">${top}</div><div class="gt-day">${bot}</div></div></div>`
    + `<div class="gt-body"><div class="gt-grid" style="left:${LEFT}px;width:${W}px">${grid}<i class="today" style="left:${tx + px / 2}px"></i></div>`
    + rows.map((r) => r.head
      ? `<div class="gt-row gt-g" data-b="${esc(r.head.key)}"><div class="gt-l"><button class="ghost tl-gt">${S.collapsed.has(r.head.key) ? "&#9656;" : "&#9662;"}</button><b>${esc(r.head.title)}</b> <span class="muted">${r.head.tasks.length}</span></div><div class="gt-r" style="width:${W}px"></div></div>`
      : `<div class="gt-row${r.t.done ? " done" : ""}${S.openId === r.t.id ? " sel" : ""}" data-id="${esc(r.t.id)}">`
        + `<div class="gt-l" style="padding-left:${10 + r.depth * 20}px">`
        + (T.children(r.t.id).length ? `<button class="ghost tl-exp${S.expanded.has(r.t.id) ? " open" : ""}" data-act="exp">&#9656;</button>` : `<span class="tl-exp"></span>`)
        + `<span class="gt-t" data-act="open">${esc(r.t.title || "Untitled task")}</span>${people(r.t.owners, 2)}</div>`
        + `<div class="gt-r" style="width:${W}px">${bar(r.t)}</div></div>`).join("")
    + `</div></div></div>`;
  const sc = el.querySelector(".gt-scroll");
  sc.scrollTop = sy;
  // first time: the earliest unfinished work, or today
  const firstOpen = rows.filter((r) => r.t && !r.t.done && (r.t.start || r.t.due)).map((r) => (r.t.start || r.t.due).slice(0, 10)).sort()[0];
  const home = Math.max(0, Math.min(tx, firstOpen ? x(firstOpen) : tx) - 200);
  sc.scrollLeft = sx != null && S.ganttZoomWas === zoom ? sx : home;
  S.ganttZoomWas = zoom;

  el.querySelector(".gt-zoom").onclick = (ev) => {
    const b = ev.target.closest("[data-z]");
    if (b) { S.ganttZoom = b.dataset.z; render(T, el); }
  };
  el.querySelector(".gt-today").onclick = () => { sc.scrollLeft = Math.max(0, tx - 200); };

  el.onclick = (ev) => {
    if (ev.target.closest(".gt-bar, .gt-ms")) return;
    const g = ev.target.closest(".gt-g");
    if (g) {
      const k = g.dataset.b;
      S.collapsed.has(k) ? S.collapsed.delete(k) : S.collapsed.add(k);
      T.saveCollapsed();
      return render(T, el);
    }
    const r = ev.target.closest(".gt-row[data-id]");
    if (!r) return;
    const t = T.task(r.dataset.id);
    const act = ev.target.closest("[data-act]");
    if (act && act.dataset.act === "exp") {
      S.expanded.has(t.id) ? S.expanded.delete(t.id) : S.expanded.add(t.id);
      return render(T, el);
    }
    const right = ev.target.closest(".gt-r");
    if (right && T.canEdit() && !t.start && !t.due) {
      const day = addDays(d0, Math.floor((ev.clientX - right.getBoundingClientRect().left) / px));
      return T.save(t.id, { start: day, due: addDays(day, zoom === "day" ? 0 : 4) });
    }
    T.openTask(t.id);
  };

  /* dragging a bar: the middle moves it, an end changes that date */
  el.onpointerdown = (ev) => {
    const b = ev.target.closest(".gt-bar, .gt-ms");
    if (!b || !T.canEdit() || ev.button !== 0) return;
    const t = T.task(b.dataset.id);
    const mode = b.dataset.kind === "ms" ? "ms" : ev.target.closest(".gt-h.l") ? "l" : ev.target.closest(".gt-h.r") ? "r" : "m";
    const x0 = ev.clientX, left0 = b.offsetLeft, w0 = b.offsetWidth;
    let dd = 0, moved = false;
    b.setPointerCapture(ev.pointerId);
    b.classList.add("drag");
    T.S.dragging = true;
    const move = (e) => {
      dd = Math.round((e.clientX - x0) / px);
      if (Math.abs(e.clientX - x0) > 3) moved = true;
      if (mode === "m" || mode === "ms") b.style.left = left0 + dd * px + "px";
      else if (mode === "l") { const d = Math.min(dd, Math.round(w0 / px) - 1); b.style.left = left0 + d * px + "px"; b.style.width = w0 - d * px + "px"; }
      else b.style.width = Math.max(px, w0 + dd * px) + "px";
    };
    const up = () => {
      b.removeEventListener("pointermove", move);
      b.removeEventListener("pointerup", up);
      b.removeEventListener("pointercancel", up);
      b.classList.remove("drag");
      T.S.dragging = false;
      if (!moved) return T.openTask(t.id);
      if (!dd) return render(T, el);
      const [s, e] = spanOf(t);
      let patch;
      if (mode === "ms") patch = { due: addDays(e, dd) };
      else if (mode === "m") patch = { start: addDays(s, dd), due: addDays(e, dd) };
      else if (mode === "l") patch = { start: addDays(s, Math.min(dd, daysBetween(s, e))) };
      else patch = { due: addDays(e, Math.max(dd, -daysBetween(s, e))), start: t.start || s };
      confirmMove(t, patch).then((yes) => { if (yes) T.save(t.id, patch); else render(T, el); });
    };
    b.addEventListener("pointermove", move);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    ev.preventDefault();
  };
}

/* A bar is easily moved by mistake: say what will change and ask first
   (unless "don't ask again today" was ticked on this device). */
const ASK_KEY = "lwk-viewer:gantt-no-ask";
async function confirmMove(t, patch) {
  try { if (localStorage.getItem(ASK_KEY) === today()) return true; } catch (e) {}
  const span = (a, b) => (a && b && a !== b ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(b || a) || "no date");
  const was = span((t.start || "").slice(0, 10), (t.due || "").slice(0, 10));
  const now = span(("start" in patch ? patch.start : t.start || "").slice(0, 10), ("due" in patch ? patch.due : t.due || "").slice(0, 10));
  const f = await modal("Change the dates?", `<p style="margin:0 0 8px"><b>${esc(t.title || "Untitled task")}</b></p>`
    + `<p class="muted" style="margin:0 0 4px">From <b>${esc(was)}</b></p><p style="margin:0 0 10px">to <b>${esc(now)}</b></p>`
    + `<label class="row-check"><input type="checkbox" name="noask"> Don't ask again today</label>`, "Save");
  if (!f) return false;
  if (f.noask.checked) { try { localStorage.setItem(ASK_KEY, today()); } catch (e) {} }
  return true;
}
