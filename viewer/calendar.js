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
 *
 * Holidays shows the public holidays of Hong Kong and / or the Philippines
 * (holidays.js, plus what a site admin added). + Leave (or right-click a
 * day, or drag across days) puts your annual leave in; the people who share
 * a calendar group with you (Groups) see it, and you see theirs.
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, modal, toast, ic, pop, closePop, skeleton } from "./tasks-util.js";
import { taskForm } from "./chatcards.js";
import { makeFilter } from "./filterbtn.js";
import { REGIONS, merged } from "./holidays.js";
import { day, wday } from "./dates.js";

const K = {
  view: matchMedia("(max-width: 700px)").matches ? "list" : "month",
  at: new Date(),             // a day in the month shown
  kinds: new Set(["meeting", "task", "issue", "leave"]),
  entries: [], from: "", to: "",
  hol: { hk: true, ph: true },       // the holidays shown (Holidays chip)
  holExtra: {},                       // added by a site admin (server)
  group: "",                          // leave of: "" every group of mine, or one group
  groups: [],
  weekStart: 1,                       // the leftmost day: 1 Monday, 0 Sunday
};
try {
  const v = localStorage.getItem("lwk-viewer:cal-view");
  if (v === "month" || v === "list" || v === "week") K.view = v;
  const k = JSON.parse(localStorage.getItem("lwk-viewer:cal-kinds") || "null");
  if (Array.isArray(k)) { K.kinds = new Set(k); if (!localStorage.getItem("lwk-viewer:cal-kinds-leave")) K.kinds.add("leave"); }
  const h = JSON.parse(localStorage.getItem("lwk-viewer:cal-hol") || "null");
  if (h && typeof h === "object") K.hol = { hk: !!h.hk, ph: !!h.ph };
  if (localStorage.getItem("lwk-viewer:cal-week") === "0") K.weekStart = 0;
} catch (e) {}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const fromIso = (s) => new Date(s.slice(0, 10) + "T00:00");

/* The days the view covers: whole weeks round the month (Monday or
   Sunday first). */
const col = (d) => (d.getDay() - K.weekStart + 7) % 7;      // 0 = the leftmost column
function range() {
  const first = new Date(K.at.getFullYear(), K.at.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - col(first));
  const last = new Date(K.at.getFullYear(), K.at.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - col(last)));
  if (K.view === "week") {
    const ws = new Date(K.at.getFullYear(), K.at.getMonth(), K.at.getDate() - col(K.at));
    return [ws, new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6)];
  }
  return K.view === "month" ? [start, end] : [new Date(first), last];
}
const stepBy = (n) => {
  K.at = K.view === "week" ? new Date(K.at.getFullYear(), K.at.getMonth(), K.at.getDate() + 7 * n)
    : new Date(K.at.getFullYear(), K.at.getMonth() + n, 1);
  load();
};

async function load() {
  const [a, b] = range();
  K.from = iso(a);
  K.to = iso(b);
  $("#cal-body").innerHTML = `<div class="cal-wait">${skeleton(6, "Loading the calendar")}</div>`;
  try {
    const r = await api(`/api/calendar?from=${K.from}&to=${K.to}`);
    K.entries = r.entries.concat(holidayEntries());
  } catch (e) {
    $("#cal-body").innerHTML = `<p class="bad" style="padding:16px">${esc(e.message)}</p>`;
    return;
  }
  paint();
}

const shown = () => K.entries.filter((e) => e.kind === "holiday" ? K.hol[e.region]
  : e.kind === "leave" ? K.kinds.has("leave") && (e.mine || !K.group || (e.groups || []).includes(K.group))
  : K.kinds.has(e.kind));

/* Public holidays in the days shown, for the regions ticked (both are made;
   shown() picks). */
function holidayEntries() {
  const out = [];
  for (const reg of Object.keys(REGIONS)) {
    const list = merged(reg, K.holExtra);
    for (const [d, name] of Object.entries(list)) {
      if (d < K.from || d > K.to) continue;
      out.push({ kind: "holiday", region: reg, id: `h-${reg}-${d}`, title: `${REGIONS[reg].short} · ${name}`,
        start: d, end: d, all_day: true, from: REGIONS[reg].name + " public holiday", url: "#" });
    }
  }
  return out;
}

/* Working days from a to b: not weekends, not the holidays of the regions
   ticked under Holidays (Hong Kong when none is). */
function workingDays(a, b) {
  const regs = Object.keys(K.hol).filter((r) => K.hol[r]);
  const hol = new Set();
  for (const r of regs.length ? regs : ["hk"]) for (const d of Object.keys(merged(r, K.holExtra))) hol.add(d);
  let n = 0;
  for (let d = fromIso(a); iso(d) <= b; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && !hol.has(iso(d))) n++;
  }
  return { n, regs: regs.length ? regs : ["hk"] };
}

/* on this day (an event over several days shows on each) */
const onDay = (e, day) => e.start.slice(0, 10) <= day && (e.end || e.start).slice(0, 10) >= day;

function timeOf(e) {
  if (e.kind !== "meeting" || e.all_day) return "";
  const t0 = e.start.slice(11, 16), t1 = e.end.slice(11, 16);
  return t0 + (t1 && t1 !== t0 && e.end.slice(0, 10) === e.start.slice(0, 10) ? "-" + t1 : "");
}

function chip(e, long) {
  const cls = `ce ${e.kind}${e.region ? " " + e.region : ""}${e.mine ? " mine" : ""}${e.done ? " done" : ""}${e.cancelled ? " cancelled" : ""}${e.reply ? " r-" + e.reply : ""}`;
  const t = timeOf(e);
  const icon = { meeting: "calendar", task: "task", issue: "flag", leave: "user", holiday: "calendar" }[e.kind];
  return `<a class="${cls}" href="${esc(e.url)}" data-id="${esc(e.id)}" title="${esc(e.title + (e.parent ? " - sub-task of " + e.parent : "") + (e.from ? " - " + e.from : ""))}">`
    + `<span class="ce-i">${ic(icon, 12)}</span>`
    + (t ? `<b class="ce-t">${esc(t)}</b>` : "")
    + `<span class="ce-n">${e.kind === "issue" ? "Due · " : ""}${esc(e.title)}</span>`
    + (long ? `<small class="ce-f">${esc([e.parent ? "Sub-task of " + e.parent : "", e.from, e.where].filter(Boolean).join(" · "))}</small>` : "")
    + `</a>`;
}

function paint() {
  let title = K.at.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (K.view === "week") { const [wa, wb] = range(); title = `${day(wa)} – ${day(wb, true)}`; }
  $("#cal-title").textContent = title;
  for (const b of document.querySelectorAll("#cal-view button")) b.classList.toggle("on", b.dataset.v === K.view);
  paintLegend();
  const list = shown();
  if (K.view === "list") return paintList(list);
  if (K.view === "week") return paintWeek(list);
  const [a, b] = range();
  const t = today();
  const month = K.at.getMonth();
  let h = `<div class="cm"><div class="cm-h">` + (K.weekStart === 0 ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]).map((d) => `<span>${d}</span>`).join("") + `</div><div class="cm-g">`;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    const es = list.filter((e) => onDay(e, day));
    const more = es.length > 4 ? es.length - 3 : 0;
    const hol = es.some((e) => e.kind === "holiday");
    h += `<div class="cm-d${d.getMonth() !== month ? " out" : ""}${day === t ? " today" : ""}${[0, 6].includes(d.getDay()) ? " we" : ""}${hol ? " hol" : ""}" data-day="${day}">`
      + `<span class="cm-n">${d.getDate()}</span>`
      + (more ? es.slice(0, 3) : es).map((e) => chip(e)).join("")
      + (more ? `<button type="button" class="cm-more" data-day="${day}">+${more} more</button>` : "")
      + `</div>`;
  }
  h += `</div></div>`;
  if (!list.length) h += `<p class="muted cal-none">Nothing in ${esc(title)} for you${K.kinds.size < 4 ? " (with these filters)" : ""}.</p>`;
  $("#cal-body").innerHTML = h;
}

/* One week, every entry of each day shown (no "+3 more"). */
function paintWeek(list) {
  const [a] = range();
  const t = today();
  let h = `<div class="cw">`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i);
    const k = iso(d);
    const es = list.filter((e) => onDay(e, k));
    h += `<div class="cw-d${k === t ? " today" : ""}${[0, 6].includes(d.getDay()) ? " we" : ""}${es.some((e) => e.kind === "holiday") ? " hol" : ""}" data-day="${k}">`
      + `<div class="cw-h"><span>${esc(wday(d).split(" ")[0])}</span><b class="cm-n">${d.getDate()}</b></div>`
      + es.map((e) => chip(e, true)).join("") + `</div>`;
  }
  $("#cal-body").innerHTML = h + `</div>`;
}

/* The colours, which are also the switches: click one to hide or show it. */
const LEGEND = [["issue", "Issue due dates"], ["task", "Tasks"], ["holiday", "Holidays"], ["leave", "Team leave"], ["meeting", "Meetings"]];
function paintLegend() {
  const box = $("#cal-legend");
  if (!box) return;
  const anyHol = Object.values(K.hol).some(Boolean);
  const regs = Object.keys(K.hol).filter((r) => K.hol[r]).map((r) => REGIONS[r].short);
  box.innerHTML = `<span class="lg-show">Show</span>` + LEGEND.map(([k, label0]) => {
    const label = k === "holiday" && regs.length ? label0 + " · " + regs.join(" + ") : label0;
    const on = k === "holiday" ? anyHol : K.kinds.has(k);
    return `<button type="button" class="lg-k ${k}${on ? " on" : ""}" data-k="${k}" aria-pressed="${on}" title="${on ? "Hide" : "Show"} ${esc(label.toLowerCase())}">`
      + `<span class="ce-dot ${k}"></span>${esc(label)}`
      + (k === "holiday" ? `<span class="lg-caret" data-hreg title="Which places' public holidays">&#9662;</span>` : "") + `</button>`;
  }).join("");
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
    + `<div class="cl-h"><b>${esc(wday(fromIso(k), true))}</b>${k === t ? ` <span class="cl-today">Today</span>` : ""}</div>`
    + days[k].map((e) => chip(e, true)).join("") + `</div>`).join("")
    || `<p class="muted cal-none">Nothing this month for you${K.kinds.size < 4 ? " (with these filters)" : ""}.</p>`) + `</div>`;
}

/* The details of one entry, beside the calendar (Open goes to it). */
function details(e) {
  const box = $("#cal-side");
  box.hidden = false;
  const when = e.kind === "meeting" && !e.all_day
    ? `${wday(fromIso(e.start))} · ${timeOf(e)}`
    : wday(fromIso(e.start))
      + (e.end && e.end.slice(0, 10) !== e.start.slice(0, 10) ? " - " + day(fromIso(e.end)) : "");
  const say = { meeting: "Meeting", task: e.done ? "Task (done)" : "Task due", issue: "Issue due",
    leave: e.type || "Leave", holiday: "Public holiday" }[e.kind];
  const reply = { yes: "You are going", maybe: "You said maybe", no: "You can't go" }[e.reply] || (e.kind === "meeting" ? "Not answered yet" : "");
  box.innerHTML = `<div class="cs-h"><span class="ce-dot ${e.kind}"></span><b>${esc(say)}</b><span class="spacer"></span><button class="ghost" data-x>${ic("close")}</button></div>`
    + `<h3>${e.cancelled ? "<s>" : ""}${esc(e.title)}${e.cancelled ? "</s> <span class='bad'>cancelled</span>" : ""}</h3>`
    + `<div class="cs-r">${ic("calendar", 14)} ${esc(when)}</div>`
    + (e.where ? `<div class="cs-r">${esc(e.where)}</div>` : "")
    + (e.link ? `<div class="cs-r"><a href="${esc(e.link)}" target="_blank" rel="noopener">Join online</a></div>` : "")
    + (e.parent ? `<div class="cs-r">Sub-task of <b>${esc(e.parent)}</b></div>` : "")
    + (e.from ? `<div class="cs-r muted">${esc(e.from)}${e.by ? " · from " + esc(e.by) : ""}</div>` : "")
    + (reply ? `<div class="cs-r"><b>${esc(reply)}</b>${e.going ? ` <span class="muted">· ${e.going} going</span>` : ""}</div>` : "")
    + (e.notes ? `<div class="cs-notes">${esc(e.notes)}</div>` : "")
    + (e.kind === "leave"
      ? `<div class="cs-r muted">${workingDays(e.start, e.end).n} working day(s)${e.half ? " · half a day (" + esc(e.half.toUpperCase()) + ")" : ""}</div>`
        + (e.mine ? `<button type="button" class="ghost cs-del" data-del>Remove this leave</button>` : "")
      : e.kind === "holiday" ? ""
      : `<a class="primary cs-open" href="${esc(e.url)}">${e.kind === "meeting" ? "Open in the chat (reply there)" : e.kind === "task" ? "Open the task" : "Show the issue"}</a>`);
  box.onclick = async (ev) => {
    if (ev.target.closest("[data-x]")) box.hidden = true;
    if (ev.target.closest("[data-del]")) {
      if (!confirm("Remove this leave?")) return;
      try { await api("/api/calendar/leave/" + encodeURIComponent(e.leave_id), { method: "DELETE" }); } catch (er) { return toast(er.message, true); }
      box.hidden = true;
      toast("Leave removed");
      load();
    }
  };
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
  const label = wday(day);
  const el = pop({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) },
    `<div class="muted" style="padding:4px 8px;font-size:11px">${esc(label)}</div>`
    + `<div class="po-row" data-k="event">Add event (all day)</div>`
    + `<div class="po-row" data-k="meeting">Add meeting</div>`
    + `<div class="po-row" data-k="task">Add task due this day</div>`
    + `<div class="po-row" data-k="leave">Add leave</div>`, 220);
  el.onclick = (ev) => {
    const r = ev.target.closest("[data-k]");
    if (!r) return;
    closePop();
    if (r.dataset.k === "event") newEvent(day);
    if (r.dataset.k === "meeting") newEvent(day, "10:00", "Meeting");
    if (r.dataset.k === "task") newTask(day);
    if (r.dataset.k === "leave") newLeave(day);
  };
}


/* ------------------------------------------------------------ holidays */

function holidaysPop(anchor) {
  const admin = K.me && K.me.site_admin;
  const el = pop(anchor, `<div class="muted" style="padding:4px 8px;font-size:11px">Public holidays on the calendar</div>`
    + Object.entries(REGIONS).map(([k, r]) => `<label class="po-row hol-row"><input type="checkbox" data-reg="${k}"${K.hol[k] ? " checked" : ""}> ${esc(r.name)}</label>`).join("")
    + (admin ? `<div class="po-row" data-edit>Edit the list ... <small class="muted">(next year, Eid'l Fitr ...)</small></div>` : ""), 240);
  el.addEventListener("change", (ev) => {
    const c = ev.target.closest("[data-reg]");
    if (!c) return;
    K.hol[c.dataset.reg] = c.checked;
    try { localStorage.setItem("lwk-viewer:cal-hol", JSON.stringify(K.hol)); } catch (e) {}
    holBtn();
    paint();
    if (!K.from) return;
    K.entries = K.entries.filter((x) => x.kind !== "holiday").concat(holidayEntries());
  });
  el.addEventListener("click", (ev) => { if (ev.target.closest("[data-edit]")) { closePop(); editHolidays(); } });
}

function holBtn() {
  const b = $("#cal-hol");
  if (!b) return;
  const on = Object.keys(K.hol).filter((k) => K.hol[k]).map((k) => REGIONS[k].short);
  b.innerHTML = "Holidays" + (on.length ? ` <b>· ${on.join(" + ")}</b>` : "") + " &#9662;";
  b.classList.toggle("active", !!on.length);
}

/* A site admin adds dates (one a line: 2028-01-01 New Year's Day), or takes
   a built-in one away ("2027-03-29 -"). */
async function editHolidays() {
  const txt = (reg) => Object.entries((K.holExtra || {})[reg] || {}).sort().map(([d, n]) => d + " " + n).join("\n");
  const f = await modal("Public holidays - added dates", `<p class="muted" style="font-size:12px;margin-top:0">The lists for 2026 and 2027 are built in.
      Add next year's here when they are published, and the Philippine Eid'l Fitr / Eid'l Adha once proclaimed.
      One a line: <code>2028-01-01 New Year's Day</code>. <code>2027-03-29 -</code> takes a built-in date away.</p>
    <label>Hong Kong<textarea name="hk" rows="6">${esc(txt("hk"))}</textarea></label>
    <label>Philippines<textarea name="ph" rows="6">${esc(txt("ph"))}</textarea></label>`, "Save");
  if (!f) return;
  const parse = (t) => {
    const o = {};
    for (const line of t.split(/\n/)) {
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s*$/.exec(line);
      if (m) o[m[1]] = m[2];
    }
    return o;
  };
  try {
    K.holExtra = await api("/api/holidays", { method: "PUT", body: JSON.stringify({ hk: parse(f.hk.value), ph: parse(f.ph.value) }) });
    toast("Holiday list saved");
    load();
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ leave */

async function newLeave(a, b) {
  a = a || today();
  b = b && b >= a ? b : a;
  const f0 = modal("Add leave", `<div class="lv-row"><label>From<input type="date" name="start" value="${a}" required></label>
      <label>To<input type="date" name="end" value="${b}" required></label></div>
    <div class="lv-row"><label>Type<select name="type"><option>Annual leave</option><option>Sick leave</option><option>Other leave</option></select></label>
      <label>Half day<select name="half"><option value="">No - whole day(s)</option><option value="am">Morning (AM)</option><option value="pm">Afternoon (PM)</option></select></label></div>
    <label>Note <small class="muted">(optional)</small><input name="note" maxlength="200" placeholder="e.g. back on Monday; urgent: call Peter"></label>
    <p class="muted lv-count" style="font-size:12px"></p>
    <p class="muted" style="font-size:11px">Seen by you and the people in your calendar groups (Groups).</p>`, "Add leave");
  const form = document.querySelector(".t-modal");
  const count = () => {
    const s = form.start.value, e = form.end.value || s;
    const half = form.half;
    half.disabled = s !== e;
    if (s !== e) half.value = "";
    if (!s) return;
    const w = workingDays(s, e < s ? s : e);
    form.querySelector(".lv-count").textContent = (half.value ? "Half a working day" : `${w.n} working day(s)`)
      + ` - weekends and ${w.regs.map((r) => REGIONS[r].name).join(" / ")} holidays left out`;
  };
  form.addEventListener("input", count);
  form.addEventListener("change", count);
  count();
  const f = await f0;
  if (!f) return;
  try {
    await api("/api/calendar/leave", { method: "POST", body: JSON.stringify({ start: f.start.value, end: f.end.value || f.start.value,
      type: f.type.value, half: f.half.value, note: f.note.value }) });
  } catch (e) { return toast(e.message, true); }
  toast("Leave added");
  load();
}

/* ------------------------------------------------------------ groups */

async function loadGroups() {
  try { K.groups = (await api("/api/calendar/groups")).groups || []; } catch (e) { K.groups = []; }
  const sel = $("#cal-lgroup");
  if (!sel) return;
  const cur = K.group;
  sel.innerHTML = `<option value="">All my groups</option>` + K.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
  sel.value = K.groups.some((g) => g.id === cur) ? cur : "";
  K.group = sel.value;
}

async function groupsDialog() {
  await loadGroups();
  const list = K.groups.length ? K.groups.map((g) => `<div class="gp-row" data-g="${esc(g.id)}"><div class="gp-main"><b>${esc(g.name)}</b>`
      + `<small class="muted">${g.members.length} people: ${esc(g.members.map((m) => m.name).join(", "))}</small></div>`
      + (g.can_edit ? `<button type="button" class="ghost" data-gedit>Edit</button><button type="button" class="ghost" data-gdel>Delete</button>`
        : `<button type="button" class="ghost" data-gquit>Leave group</button>`) + `</div>`).join("")
    : `<p class="muted" style="font-size:13px">No groups yet. Make one for your team: its people see each other's leave.</p>`;
  const p = modal("Calendar groups", `<p class="muted" style="font-size:12px;margin-top:0">The people in a group see each other's leave on their calendars.</p>
    <div class="gp-list">${list}</div><button type="button" class="ghost" data-gnew>+ New group</button>`, "Done");
  const form = document.querySelector(".t-modal");
  form.querySelector("[data-x]").hidden = true;
  form.addEventListener("click", async (ev) => {
    const row = ev.target.closest("[data-g]");
    const g = row && K.groups.find((x) => x.id === row.dataset.g);
    let act = null;
    if (ev.target.closest("[data-gnew]")) act = () => editGroup(null);
    else if (g && ev.target.closest("[data-gedit]")) act = () => editGroup(g);
    else if (g && ev.target.closest("[data-gdel]")) act = async () => {
      if (!confirm(`Delete the group "${g.name}"? Its people stop seeing each other's leave through it.`)) return false;
      await api("/api/calendar/groups/" + g.id, { method: "DELETE" });
      return true;
    };
    else if (g && ev.target.closest("[data-gquit]")) act = async () => {
      if (!confirm(`Leave the group "${g.name}"?`)) return false;
      await api("/api/calendar/groups/" + g.id + "/leave-group", { method: "POST" });
      return true;
    };
    if (!act) return;
    form.closest(".t-modal-back").remove();
    try { await act(); } catch (e) { toast(e.message, true); }
    await loadGroups();
    load();
    groupsDialog();
  });
  await p;
}

async function editGroup(g) {
  let ppl = [];
  try { ppl = (await api("/api/people")).people || []; } catch (e) {}
  const me = K.me && K.me.user;
  const have = new Set(g ? g.members.map((m) => m.uid) : me ? [me.id] : []);
  ppl.sort((a, b) => (have.has(b.uid) - have.has(a.uid)) || a.name.localeCompare(b.name));
  const p = modal(g ? "Edit group" : "New calendar group", `<label>Name<input name="name" maxlength="60" required value="${esc(g ? g.name : "")}" placeholder="e.g. BIM team"></label>
    <label>People <input type="search" class="gp-find" placeholder="Find a person"></label>
    <div class="gp-people">${ppl.map((x) => `<label class="gp-p" data-n="${esc((x.name + " " + (x.office || "") + " " + (x.team || "")).toLowerCase())}">`
      + `<input type="checkbox" value="${x.uid}"${have.has(x.uid) ? " checked" : ""}> ${esc(x.name)} <small class="muted">${esc([x.office, x.team].filter(Boolean).join(" · "))}</small></label>`).join("")}</div>`, g ? "Save" : "Make group");
  const form = document.querySelector(".t-modal");
  form.querySelector(".gp-find").addEventListener("input", (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    for (const l of form.querySelectorAll(".gp-p")) l.hidden = !!q && !l.dataset.n.includes(q);
  });
  const f = await p;
  if (!f) return false;
  const members = [...f.querySelectorAll(".gp-p input:checked")].map((c) => Number(c.value));
  const body = JSON.stringify({ name: f.name.value, members });
  await api(g ? "/api/calendar/groups/" + g.id : "/api/calendar/groups", { method: g ? "PUT" : "POST", body });
  toast(g ? "Group saved" : "Group made");
  return true;
}

/* ------------------------------------------------------------ wiring */

function wire() {
  $("#cal-prev").onclick = () => stepBy(-1);
  $("#cal-next").onclick = () => stepBy(1);
  // the legend switches kinds on and off (the same as the Filter's ticks)
  $("#cal-legend").onclick = (ev) => {
    const hr = ev.target.closest("[data-hreg]");
    if (hr) { ev.stopPropagation(); return holidaysPop(hr); }
    const b = ev.target.closest("[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    if (k === "holiday") {
      const anyHol = Object.values(K.hol).some(Boolean);
      if (anyHol) { K.holPrev = Object.assign({}, K.hol); for (const r of Object.keys(K.hol)) K.hol[r] = false; }
      else K.hol = Object.assign({ hk: true, ph: false }, K.holPrev || {});
      try { localStorage.setItem("lwk-viewer:cal-hol", JSON.stringify(K.hol)); } catch (e) {}
      holBtn();
      return paint();
    }
    const c = document.querySelector(`#cal-kinds input[value="${k}"]`);
    if (c) { c.checked = !c.checked; c.dispatchEvent(new Event("change")); }
  };
  // + New: one button for everything that can be added
  $("#cal-add").onclick = (ev) => {
    const el = pop(ev.currentTarget, `<div class="po-row" data-k="event">Event</div><div class="po-row" data-k="meeting">Meeting</div>`
      + `<div class="po-row" data-k="task">Task</div><div class="po-row" data-k="leave">Leave</div>`, 180);
    el.onclick = (e2) => {
      const r = e2.target.closest("[data-k]");
      if (!r) return;
      closePop();
      const d = today();
      if (r.dataset.k === "event") newEvent();
      if (r.dataset.k === "meeting") newEvent(d, "10:00", "Meeting");
      if (r.dataset.k === "task") newTask(d);
      if (r.dataset.k === "leave") newLeave(d);
    };
  };
  $("#cal-today").onclick = () => { K.at = new Date(); load(); };
  addEventListener("keydown", (ev) => { if (ev.target.closest("input, textarea, select")) return;
    if (ev.key === "ArrowLeft" && ev.altKey) stepBy(-1); if (ev.key === "ArrowRight" && ev.altKey) stepBy(1); });
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
      try { localStorage.setItem("lwk-viewer:cal-kinds", JSON.stringify([...K.kinds])); localStorage.setItem("lwk-viewer:cal-kinds-leave", "1"); } catch (e) {}
      paint();
    };
  }
  // what is shown: behind one Filter button (counts what is left out)
  const kinds = $("#cal-kinds");
  for (const c of kinds.querySelectorAll("input")) c.dataset.flt = "1";
  kinds.classList.add("in-flt");
  const lg = $("#cal-lgroup-wrap");
  const gsel = $("#cal-lgroup");
  gsel.dataset.flt = "1";
  gsel.onchange = () => { K.group = gsel.value; paint(); };
  // the week's first day (not a filter: Clear filters leaves it)
  const wk = document.createElement("label");
  wk.className = "cal-wk";
  wk.innerHTML = `<select id="cal-week"><option value="1">Monday</option><option value="0">Sunday</option></select>`;
  const wsel = wk.querySelector("select");
  wsel.value = String(K.weekStart);
  wsel.onchange = () => {
    K.weekStart = wsel.value === "0" ? 0 : 1;
    try { localStorage.setItem("lwk-viewer:cal-week", String(K.weekStart)); } catch (e) {}
    load();
  };
  makeFilter({ before: $("#cal-view"), title: "Meetings, my tasks, my issues, leave", groups: [{ title: "Show", els: [kinds] }, { title: "Leave of", els: [lg] }, { title: "Week starts on", els: [wk] }],
               count: () => [...kinds.querySelectorAll("input")].filter((x) => !x.checked).length + (gsel.value ? 1 : 0) });
  lg.hidden = false;
  $("#cal-hol").onclick = (ev) => { ev.stopPropagation(); holidaysPop(ev.currentTarget); };
  holBtn();
  $("#cal-groups").onclick = groupsDialog;
  $("#cal-leave").onclick = () => newLeave(today());
  // drag across days (month view): leave on those days
  let dragA = null;
  $("#cal-body").addEventListener("pointerdown", (ev) => {
    const d = ev.target.closest(".cm-d");
    dragA = d && ev.button === 0 && !ev.target.closest(".ce, .cm-more") && ev.pointerType === "mouse" ? d.dataset.day : null;
  });
  $("#cal-body").addEventListener("pointerover", (ev) => {
    if (!dragA || !(ev.buttons & 1)) return;
    const d = ev.target.closest(".cm-d");
    if (!d) return;
    const [x, y] = [dragA, d.dataset.day].sort();
    for (const c of document.querySelectorAll(".cm-d")) c.classList.toggle("drag", c.dataset.day >= x && c.dataset.day <= y && x !== y);
  });
  document.addEventListener("pointerup", (ev) => {
    const a = dragA;
    dragA = null;
    const marked = document.querySelectorAll(".cm-d.drag");
    for (const c of marked) c.classList.remove("drag");
    if (!a) return;
    const d = ev.target.closest && ev.target.closest(".cm-d");
    if (d && d.dataset.day !== a) {
      const [x, y] = [a, d.dataset.day].sort();
      newLeave(x, y);
    }
  });
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
  const day = new URLSearchParams(location.search).get("day");
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) K.at = fromIso(day);
  // holidays added by an admin and my groups come alongside, not before
  const extra = api("/api/holidays").then((h) => { K.holExtra = h || {}; }, () => {});
  loadGroups();
  await load();
  await extra;
  if (Object.keys(K.holExtra.hk || {}).length || Object.keys(K.holExtra.ph || {}).length) {
    K.entries = K.entries.filter((e) => e.kind !== "holiday").concat(holidayEntries());
    paint();
  }
}

start().catch((e) => { const m = $("#cal-body"); if (m) m.innerHTML = `<p class="bad" style="padding:16px">${esc(e.message)}</p>`; });
