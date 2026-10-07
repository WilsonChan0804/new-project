/* Calendar page (server side: calendar_feed.py).
 *
 * What is coming up for you: meetings sent in the Messenger (with your
 * reply), the tasks you own and the issues assigned to you, on their dates.
 * Month view on a computer, a list on a phone (either can be chosen).
 *
 * Add to Outlook gives your calendar's own address: Outlook subscribes to
 * it (webcal:// opens Outlook on the PC; or Add calendar > From internet)
 * and shows it beside your Outlook calendar, kept up to date by itself.
 * + Event makes the event in a chat, so the people in it are invited and
 * can reply.
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, modal, toast, ic, pop, closePop } from "./tasks-util.js";
import { taskForm } from "./chatcards.js";

const K = {
  view: matchMedia("(max-width: 700px)").matches ? "list" : "month",
  at: new Date(),             // a day in the month shown
  kinds: new Set(["meeting", "task", "issue"]),
  entries: [], from: "", to: "",
};
try {
  const v = localStorage.getItem("lwk-viewer:cal-view");
  if (v === "month" || v === "list") K.view = v;
  const k = JSON.parse(localStorage.getItem("lwk-viewer:cal-kinds") || "null");
  if (Array.isArray(k)) K.kinds = new Set(k);
} catch (e) {}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const fromIso = (s) => new Date(s.slice(0, 10) + "T00:00");

/* The days the view covers: whole weeks round the month (Monday first). */
function range() {
  const first = new Date(K.at.getFullYear(), K.at.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(K.at.getFullYear(), K.at.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  return K.view === "month" ? [start, end] : [new Date(first), last];
}

async function load() {
  const [a, b] = range();
  K.from = iso(a);
  K.to = iso(b);
  $("#cal-body").innerHTML = `<p class="muted cal-wait">Loading ...</p>`;
  try {
    const r = await api(`/api/calendar?from=${K.from}&to=${K.to}`);
    K.entries = r.entries;
  } catch (e) {
    $("#cal-body").innerHTML = `<p class="bad" style="padding:16px">${esc(e.message)}</p>`;
    return;
  }
  paint();
}

const shown = () => K.entries.filter((e) => K.kinds.has(e.kind));

/* on this day (an event over several days shows on each) */
const onDay = (e, day) => e.start.slice(0, 10) <= day && (e.end || e.start).slice(0, 10) >= day;

function timeOf(e) {
  if (e.kind !== "meeting" || e.all_day) return "";
  const t0 = e.start.slice(11, 16), t1 = e.end.slice(11, 16);
  return t0 + (t1 && t1 !== t0 && e.end.slice(0, 10) === e.start.slice(0, 10) ? "-" + t1 : "");
}

function chip(e, long) {
  const cls = `ce ${e.kind}${e.done ? " done" : ""}${e.cancelled ? " cancelled" : ""}${e.reply ? " r-" + e.reply : ""}`;
  const t = timeOf(e);
  const icon = { meeting: "calendar", task: "task", issue: "flag" }[e.kind];
  return `<a class="${cls}" href="${esc(e.url)}" data-id="${esc(e.id)}" title="${esc(e.title + (e.from ? " - " + e.from : ""))}">`
    + `<span class="ce-i">${ic(icon, 12)}</span>`
    + (t ? `<b class="ce-t">${esc(t)}</b>` : "")
    + `<span class="ce-n">${esc(e.title)}</span>`
    + (long ? `<small class="ce-f">${esc([e.from, e.where].filter(Boolean).join(" · "))}</small>` : "")
    + `</a>`;
}

function paint() {
  const title = K.at.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("#cal-title").textContent = title;
  for (const b of document.querySelectorAll("#cal-view button")) b.classList.toggle("on", b.dataset.v === K.view);
  const list = shown();
  if (K.view === "list") return paintList(list);
  const [a, b] = range();
  const t = today();
  const month = K.at.getMonth();
  let h = `<div class="cm"><div class="cm-h">` + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span>${d}</span>`).join("") + `</div><div class="cm-g">`;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    const es = list.filter((e) => onDay(e, day));
    const more = es.length > 4 ? es.length - 3 : 0;
    h += `<div class="cm-d${d.getMonth() !== month ? " out" : ""}${day === t ? " today" : ""}${[0, 6].includes(d.getDay()) ? " we" : ""}" data-day="${day}">`
      + `<span class="cm-n">${d.getDate()}</span>`
      + (more ? es.slice(0, 3) : es).map((e) => chip(e)).join("")
      + (more ? `<button type="button" class="cm-more" data-day="${day}">+${more} more</button>` : "")
      + `</div>`;
  }
  h += `</div></div>`;
  if (!list.length) h += `<p class="muted cal-none">Nothing in ${esc(title)} for you${K.kinds.size < 3 ? " (with these filters)" : ""}.</p>`;
  $("#cal-body").innerHTML = h;
}

function paintList(list, onlyDay) {
  const days = {};
  for (const e of list) {
    // an event over several days: under each of its days in the month
    for (let d = fromIso(e.start); iso(d) <= (e.end || e.start).slice(0, 10); d.setDate(d.getDate() + 1)) {
      const k = iso(d);
      if (k < K.from || k > K.to || (onlyDay && k !== onlyDay)) continue;
      (days[k] = days[k] || []).push(e);
    }
  }
  const t = today();
  const keys = Object.keys(days).sort();
  $("#cal-body").innerHTML = `<div class="cl">` + (keys.map((k) => `<div class="cl-day${k === t ? " today" : ""}${k < t ? " past" : ""}" data-day="${k}">`
    + `<div class="cl-h"><b>${esc(fromIso(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }))}</b>${k === t ? ` <span class="cl-today">Today</span>` : ""}</div>`
    + days[k].map((e) => chip(e, true)).join("") + `</div>`).join("")
    || `<p class="muted cal-none">Nothing this month for you${K.kinds.size < 3 ? " (with these filters)" : ""}.</p>`) + `</div>`;
}

/* The details of one entry, beside the calendar (Open goes to it). */
function details(e) {
  const box = $("#cal-side");
  box.hidden = false;
  const when = e.kind === "meeting" && !e.all_day
    ? `${fromIso(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${timeOf(e)}`
    : fromIso(e.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      + (e.end && e.end.slice(0, 10) !== e.start.slice(0, 10) ? " - " + fromIso(e.end).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
  const say = { meeting: "Meeting", task: e.done ? "Task (done)" : "Task due", issue: "Issue due" }[e.kind];
  const reply = { yes: "You are going", maybe: "You said maybe", no: "You can't go" }[e.reply] || (e.kind === "meeting" ? "Not answered yet" : "");
  box.innerHTML = `<div class="cs-h"><span class="ce-dot ${e.kind}"></span><b>${esc(say)}</b><span class="spacer"></span><button class="ghost" data-x>${ic("close")}</button></div>`
    + `<h3>${e.cancelled ? "<s>" : ""}${esc(e.title)}${e.cancelled ? "</s> <span class='bad'>cancelled</span>" : ""}</h3>`
    + `<div class="cs-r">${ic("calendar", 14)} ${esc(when)}</div>`
    + (e.where ? `<div class="cs-r">${esc(e.where)}</div>` : "")
    + (e.link ? `<div class="cs-r"><a href="${esc(e.link)}" target="_blank" rel="noopener">Join online</a></div>` : "")
    + (e.from ? `<div class="cs-r muted">${esc(e.from)}${e.by ? " · from " + esc(e.by) : ""}</div>` : "")
    + (reply ? `<div class="cs-r"><b>${esc(reply)}</b>${e.going ? ` <span class="muted">· ${e.going} going</span>` : ""}</div>` : "")
    + (e.notes ? `<div class="cs-notes">${esc(e.notes)}</div>` : "")
    + `<a class="primary cs-open" href="${esc(e.url)}">${e.kind === "meeting" ? "Open in the chat (reply there)" : e.kind === "task" ? "Open the task" : "Show the issue"}</a>`;
  box.onclick = (ev) => { if (ev.target.closest("[data-x]")) box.hidden = true; };
}

/* ------------------------------------------------------------ Outlook */

async function outlook() {
  let f;
  try { f = await api("/api/calendar/feed"); } catch (e) { return toast(e.message, true); }
  const p = modal("See this calendar in Outlook", `
    <p style="font-size:13px;margin-top:0">Your meetings from the Messenger, your tasks and your issues, beside your own Outlook calendar.
      Outlook keeps it up to date by itself (every hour or so). It only shows them: replies are made here.</p>
    <a class="primary ol-b" href="${esc(f.webcal)}">${ic("calendar", 15)} Open in Outlook on this PC</a>
    <p class="muted" style="font-size:12px;margin:6px 0 12px">Outlook asks <i>Add this Internet calendar to Outlook and subscribe to updates?</i> - choose <b>Yes</b>.</p>
    <label>Or subscribe by hand - your calendar's address
      <div class="ol-row"><input id="ol-url" readonly value="${esc(f.url)}"><button type="button" class="ghost" id="ol-copy">Copy</button></div></label>
    <ol class="ol-steps">
      <li><b>Outlook on a PC:</b> Calendar &gt; <b>Add calendar</b> &gt; <b>From Internet</b>, paste the address, OK.</li>
      <li><b>Outlook on the web:</b> Calendar &gt; <b>Add calendar</b> &gt; <b>Subscribe from web</b>, paste it, name it <i>LWK Viewer</i>.</li>
    </ol>
    <p class="muted" style="font-size:11px">Outlook on the web and on phones fetch the calendar from Microsoft's servers, so they can only reach it
      when the viewer is reachable from the internet. Outlook on a PC in the office always can.<br>
      The address is your own: anyone with it can read these dates and titles. <button type="button" class="ghost linkish" id="ol-new">Make a new address</button> (the old one stops working).</p>`, "Done");
  const form = document.querySelector(".t-modal");
  form.querySelector("[data-x]").hidden = true;
  form.querySelector("#ol-copy").onclick = async () => {
    const i = form.querySelector("#ol-url");
    i.select();
    let ok = false;
    try { await navigator.clipboard.writeText(i.value); ok = true; } catch (e) { try { ok = document.execCommand("copy"); } catch (e2) {} }
    toast(ok ? "Copied" : "Select it and press Ctrl+C", !ok);
  };
  form.querySelector("#ol-new").onclick = async () => {
    if (!confirm("Make a new address? Outlook stops getting updates from the old one until you subscribe again.")) return;
    try {
      const n = await api("/api/calendar/feed", { method: "POST" });
      form.querySelector("#ol-url").value = n.url;
      form.querySelector(".ol-b").href = n.webcal;
      toast("New address made - subscribe again in Outlook");
    } catch (e) { toast(e.message, true); }
  };
  await p;
}

/* + Event: events are sent in a chat, so its people are invited and reply.
   day / time: from a right-click on a day (a meeting has a time). */
async function newEvent(day, time, title) {
  let rooms = [];
  try { rooms = (await api("/api/chat/rooms")).rooms; } catch (e) { return toast(e.message, true); }
  if (!rooms.length) return toast("Start a chat first: an event is sent to the people in a chat", true);
  const f = await modal("New event", `<p class="muted" style="font-size:12px;margin-top:0">An event is sent in a chat: everyone in it is invited,
      replies Going / Maybe / Can't go and gets it in their calendar.</p>
    <label>Chat <select name="room">${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}${r.kind === "project" ? " (project)" : r.kind === "topic" ? " (topic)" : ""}</option>`).join("")}</select></label>`, "Next");
  if (!f) return;
  const extra = typeof day === "string" && day ? "&date=" + day + (time ? "&time=" + time : "") + (title ? "&title=" + encodeURIComponent(title) : "") : "";
  location.href = "messenger.html?room=" + encodeURIComponent(f.room.value) + "&new=event" + extra;
}

/* A task due on a day, made right here. */
async function newTask(day) {
  let ppl = [];
  try { ppl = (await api("/api/people")).people || []; } catch (e) {}
  const me = K.me && K.me.user;
  const byUid = Object.fromEntries(ppl.map((p) => [p.uid, p]));
  const r = await taskForm({ room: null, people: ppl, byUid }, { due: day, owners: me && byUid[me.id] ? [me.id] : [] });
  if (r) { toast("Task made, due " + day); load(); }
}

/* Right-click (or hold on a phone) a day: add an event, a meeting or a task on it. */
function dayMenu(day, x, y) {
  const label = new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const el = pop({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) },
    `<div class="muted" style="padding:4px 8px;font-size:11px">${esc(label)}</div>`
    + `<div class="po-row" data-k="event">Add event (all day)</div>`
    + `<div class="po-row" data-k="meeting">Add meeting</div>`
    + `<div class="po-row" data-k="task">Add task due this day</div>`, 220);
  el.onclick = (ev) => {
    const r = ev.target.closest("[data-k]");
    if (!r) return;
    closePop();
    if (r.dataset.k === "event") newEvent(day);
    if (r.dataset.k === "meeting") newEvent(day, "10:00", "Meeting");
    if (r.dataset.k === "task") newTask(day);
  };
}

/* ------------------------------------------------------------ wiring */

function wire() {
  $("#cal-prev").onclick = () => { K.at = new Date(K.at.getFullYear(), K.at.getMonth() - 1, 1); load(); };
  $("#cal-next").onclick = () => { K.at = new Date(K.at.getFullYear(), K.at.getMonth() + 1, 1); load(); };
  $("#cal-today").onclick = () => { K.at = new Date(); load(); };
  $("#cal-view").onclick = (ev) => {
    const b = ev.target.closest("[data-v]");
    if (!b) return;
    K.view = b.dataset.v;
    try { localStorage.setItem("lwk-viewer:cal-view", K.view); } catch (e) {}
    load();
  };
  for (const c of document.querySelectorAll("#cal-kinds input")) {
    c.checked = K.kinds.has(c.value);
    c.onchange = () => {
      if (c.checked) K.kinds.add(c.value); else K.kinds.delete(c.value);
      try { localStorage.setItem("lwk-viewer:cal-kinds", JSON.stringify([...K.kinds])); } catch (e) {}
      paint();
    };
  }
  $("#cal-outlook").onclick = outlook;
  $("#cal-new").onclick = () => newEvent();
  $("#cal-body").addEventListener("contextmenu", (ev) => {
    const d = ev.target.closest("[data-day]");
    if (!d || ev.target.closest(".ce")) return;
    ev.preventDefault();
    dayMenu(d.dataset.day, ev.clientX, ev.clientY);
  });
  // a phone: hold a day
  let holdT = null;
  $("#cal-body").addEventListener("touchstart", (ev) => {
    const d = ev.target.closest("[data-day]");
    if (!d || ev.target.closest(".ce")) return;
    const t = ev.touches[0];
    holdT = setTimeout(() => dayMenu(d.dataset.day, t.clientX, t.clientY), 550);
  }, { passive: true });
  for (const e of ["touchend", "touchmove", "touchcancel"]) $("#cal-body").addEventListener(e, () => clearTimeout(holdT), { passive: true });
  $("#cal-body").addEventListener("click", (ev) => {
    const more = ev.target.closest(".cm-more");
    if (more) { paintList(shown(), more.dataset.day); return; }
    const a = ev.target.closest(".ce");
    if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const e = K.entries.find((x) => x.id === a.dataset.id);
    if (!e) return;
    ev.preventDefault();
    details(e);
  });
  // a swipe on a phone: the next or the previous month
  let x0 = null;
  $("#cal-body").addEventListener("touchstart", (ev) => { x0 = ev.touches[0].clientX; }, { passive: true });
  $("#cal-body").addEventListener("touchend", (ev) => {
    if (x0 == null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 80) (dx < 0 ? $("#cal-next") : $("#cal-prev")).click();
  });
}

async function start() {
  const me = await ensureSignedIn();
  K.me = me;
  header(me);
  if (!me.accounts) {
    $("#cal").innerHTML = `<div class="t-empty"><h3>The calendar needs accounts</h3><p>A site admin can switch accounts on (Admin page).</p></div>`;
    return;
  }
  wire();
  await load();
}

start().catch((e) => { const m = $("#cal-body"); if (m) m.innerHTML = `<p class="bad" style="padding:16px">${esc(e.message)}</p>`; });
