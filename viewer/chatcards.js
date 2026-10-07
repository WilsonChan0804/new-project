/* What a message can carry besides words (chat.py person_card / task_ref):
 *
 *   poll   a question and 2-10 choices; one or several answers, by name or
 *          anonymous; the writer closes it
 *   event  a meeting or site visit: when, where, a Teams link; Going /
 *          Maybe / Can't go, and an .ics for Outlook or the phone
 *   task   a task made here (or from a message), shown as its card
 *
 * The forms are the page's modal (tasks-util.js); the cards are drawn by
 * chat.js through pollHtml / eventHtml.
 */

import { api } from "./nav.js";
import { esc, modal, toast, pickPeople, ic } from "./tasks-util.js";

/* ------------------------------------------------------------ poll */

export function pollHtml(m, ctx) {
  const c = m.card;
  const counts = m.counts || {}, mine = m.mine || [], voters = m.voters || null;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const people = m.voters_n || 0;
  const closed = c.closed || (c.closes && c.closes < new Date().toISOString().slice(0, 10));
  const name = (u) => (u === ctx.uid ? "You" : (ctx.byUid[u] || {}).name || "Someone");
  const rows = c.options.map((o) => {
    const n = counts[o.id] || 0, pct = total ? Math.round((100 * n) / total) : 0;
    const who = voters && voters[o.id] ? voters[o.id].map(name).join(", ") : "";
    return `<button type="button" class="pl-o${mine.includes(o.id) ? " me" : ""}" data-vote="${esc(m.id)}" data-opt="${esc(o.id)}"${closed ? " disabled" : ""} title="${esc(who || (c.anonymous ? "Anonymous poll" : "No votes yet"))}">`
      + `<span class="pl-bar" style="width:${pct}%"></span>`
      + `<span class="pl-box ${c.multi ? "sq" : "rd"}${mine.includes(o.id) ? " on" : ""}">${mine.includes(o.id) ? ic("check", 11) : ""}</span>`
      + `<span class="pl-t">${esc(o.text)}</span><span class="pl-n">${n}${total ? ` · ${pct}%` : ""}</span></button>`
      + (who ? `<div class="pl-who muted">${esc(who)}</div>` : "");
  }).join("");
  const mineMsg = m.uid === ctx.uid;
  return `<div class="c-card poll${closed ? " closed" : ""}"><div class="cc-h"><span class="cc-badge poll">${ic("poll", 14)}</span> <b>Poll</b>`
    + ` <span class="muted">${c.multi ? "choose any" : "choose one"}${c.anonymous ? " · anonymous" : ""}${closed ? " · closed" : c.closes ? " · until " + esc(c.closes) : ""}</span></div>`
    + `<div class="cc-t">${esc(c.question)}</div><div class="pl-os">${rows}</div>`
    + `<div class="cc-f"><span class="muted">${people} ${people === 1 ? "person" : "people"} voted</span><span class="spacer"></span>`
    + (mineMsg ? `<button type="button" class="ghost linkish" data-pclose="${esc(m.id)}" data-on="${closed ? 0 : 1}">${closed ? "Reopen" : "Close poll"}</button>` : "")
    + `</div></div>`;
}

export async function vote(m, opt) {
  const c = m.card;
  let pick = (m.mine || []).slice();
  if (c.multi) pick = pick.includes(opt) ? pick.filter((x) => x !== opt) : pick.concat(opt);
  else pick = pick.includes(opt) ? [] : [opt];
  return api(`/api/chat/messages/${m.id}/vote`, { method: "POST", body: JSON.stringify({ options: pick }) });
}

export async function closePoll(m, on) {
  return api(`/api/chat/messages/${m.id}/close`, { method: "POST", body: JSON.stringify({ closed: on }) });
}

export async function pollForm() {
  const p = modal("New poll", `<label>Question <input name="q" maxlength="300" placeholder="e.g. Which date suits the facade workshop?" required></label>`
    + `<div class="pl-edit"></div><button type="button" class="ghost linkish pl-add">+ Add a choice</button>`
    + `<label class="row-check"><input type="checkbox" name="multi"> Allow more than one answer</label>`
    + `<label class="row-check"><input type="checkbox" name="anon"> Anonymous (nobody sees who voted for what)</label>`
    + `<label>Voting closes after <input type="date" name="closes"> <small class="muted">optional</small></label>`, "Send poll");
  const form = document.querySelector(".t-modal");
  const box = form.querySelector(".pl-edit");
  const add = (v) => {
    if (box.children.length >= 10) return toast("Up to 10 choices", true);
    const row = document.createElement("div");
    row.className = "pl-erow";
    row.innerHTML = `<input name="opt" maxlength="120" placeholder="Choice ${box.children.length + 1}" value="${esc(v || "")}"><button type="button" class="ghost" title="Remove">&#10005;</button>`;
    row.querySelector("button").onclick = () => { if (box.children.length > 2) row.remove(); };
    box.appendChild(row);
    return row;
  };
  add(); add();
  form.querySelector(".pl-add").onclick = () => add().querySelector("input").focus();
  // Enter in the last choice: another one
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.name === "opt") {
      ev.preventDefault();
      const rows = [...box.children];
      if (ev.target === rows[rows.length - 1].querySelector("input") && ev.target.value.trim()) add().querySelector("input").focus();
      else { const i = rows.findIndex((r) => r.contains(ev.target)); if (rows[i + 1]) rows[i + 1].querySelector("input").focus(); }
    }
  });
  const f = await p;
  if (!f) return null;
  const options = [...f.querySelectorAll("[name=opt]")].map((i) => i.value.trim()).filter(Boolean);
  if (!f.q.value.trim() || options.length < 2) { toast("A poll needs a question and at least 2 choices", true); return null; }
  return { type: "poll", question: f.q.value.trim(), options, multi: f.multi.checked, anonymous: f.anon.checked, closes: f.closes.value || "" };
}

/* ------------------------------------------------------------ event */

const pad = (n) => String(n).padStart(2, "0");
function dayText(d) {
  const x = new Date(d + "T00:00");
  return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
export function whenText(c) {
  if (c.all_day) return dayText(c.start.slice(0, 10)) + (c.end.slice(0, 10) !== c.start.slice(0, 10) ? " - " + dayText(c.end.slice(0, 10)) : "") + " · all day";
  const t0 = c.start.slice(11, 16), t1 = c.end.slice(11, 16);
  if (c.end.slice(0, 10) === c.start.slice(0, 10)) return `${dayText(c.start.slice(0, 10))} · ${t0}${t1 && t1 !== t0 ? " - " + t1 : ""}`;
  return `${dayText(c.start.slice(0, 10))} ${t0} - ${dayText(c.end.slice(0, 10))} ${t1}`;
}

export function eventHtml(m, ctx) {
  const c = m.card;
  const counts = m.counts || {}, mine = (m.mine || [])[0] || "", voters = m.voters || {};
  const d = new Date(c.start.slice(0, 10) + "T00:00");
  const name = (u) => (u === ctx.uid ? "You" : (ctx.byUid[u] || {}).name || "Someone");
  const who = (k) => (voters[k] || []).map(name).join(", ");
  const past = (c.end || c.start).slice(0, 10) < new Date().toISOString().slice(0, 10);
  const btn = (k, label) => `<button type="button" class="ev-b${mine === k ? " on" : ""}" data-rsvp="${esc(m.id)}" data-v="${k}"${c.cancelled ? " disabled" : ""} title="${esc(who(k) || "Nobody yet")}">${label}${counts[k] ? ` <b>${counts[k]}</b>` : ""}</button>`;
  return `<div class="c-card event${c.cancelled ? " cancelled" : ""}${past ? " past" : ""}">`
    + `<div class="ev-top"><div class="ev-day"><small>${isNaN(d) ? "" : esc(d.toLocaleDateString(undefined, { month: "short" }))}</small><b>${isNaN(d) ? "?" : d.getDate()}</b></div>`
    + `<div class="ev-m"><div class="cc-t">${c.cancelled ? "<s>" : ""}${esc(c.title)}${c.cancelled ? "</s> <span class=\"bad\">cancelled</span>" : ""}</div>`
    + `<div class="ev-w">${esc(whenText(c))}</div>`
    + (c.location ? `<div class="ev-w muted">${esc(c.location)}</div>` : "")
    + (c.link ? `<div class="ev-w"><a href="${esc(c.link)}" target="_blank" rel="noopener">${/teams\.microsoft|teams\.live/.test(c.link) ? "Join the Teams meeting" : "Join online"}</a></div>` : "")
    + `</div></div>`
    + (c.notes ? `<div class="cc-x">${esc(c.notes)}</div>` : "")
    + `<div class="ev-rs">${btn("yes", "Going")}${btn("maybe", "Maybe")}${btn("no", "Can't go")}</div>`
    + (who("yes") ? `<div class="pl-who muted">Going: ${esc(who("yes"))}</div>` : "")
    + `<div class="cc-f"><a href="/api/chat/messages/${esc(m.id)}/event.ics" download>Add to calendar (.ics)</a><span class="spacer"></span>`
    + (m.uid === ctx.uid && !c.cancelled ? `<button type="button" class="ghost linkish" data-evedit="${esc(m.id)}">Change</button> · <button type="button" class="ghost linkish" data-evcancel="${esc(m.id)}">Cancel event</button>` : "")
    + `</div></div>`;
}

export async function rsvp(m, v) {
  const now = (m.mine || [])[0] || "";
  return api(`/api/chat/messages/${m.id}/rsvp`, { method: "POST", body: JSON.stringify({ value: now === v ? "" : v }) });
}

export async function eventForm(old, prefill) {
  const t = new Date(Date.now() + 86400e3);
  // prefill: a new event with some of it given (the Calendar's right-click on a day)
  const c = old || Object.assign({ title: "", start: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T10:00`, end: "", all_day: false, location: "", link: "", notes: "" }, prefill || {});
  const day = c.start.slice(0, 10), t0 = c.start.slice(11, 16) || "10:00";
  const t1 = c.end && c.end.slice(0, 10) === day ? c.end.slice(11, 16) : (() => { const [h, mi] = t0.split(":").map(Number); return `${pad(Math.min(23, h + 1))}:${pad(mi)}`; })();
  const p = modal(old ? "Change the event" : "New event", `<label>Title <input name="title" maxlength="160" value="${esc(c.title)}" placeholder="e.g. Facade workshop" required></label>`
    + `<div class="it-2 ev-when"><label>Date <input type="date" name="day" value="${esc(day)}" required></label>`
    + `<label class="ev-t">From <input type="time" name="t0" value="${esc(t0)}"></label><label class="ev-t">To <input type="time" name="t1" value="${esc(t1)}"></label></div>`
    + `<label class="row-check"><input type="checkbox" name="all"${c.all_day ? " checked" : ""}> All day</label>`
    + `<label>Where <input name="loc" maxlength="200" value="${esc(c.location)}" placeholder="e.g. HK office, Room 3 / site"></label>`
    + `<label>Online meeting link <input name="link" maxlength="1000" value="${esc(c.link)}" placeholder="Paste the Teams meeting link"></label>`
    + `<label>Notes <textarea name="notes" rows="3" maxlength="2000">${esc(c.notes)}</textarea></label>`
    + (old ? "" : `<p class="muted" style="font-size:11px">Everyone in this chat is invited: they can reply Going / Maybe / Can't go and add it to their calendar.</p>`),
  old ? "Save" : "Send invitation");
  const form = document.querySelector(".t-modal");
  const sync = () => { for (const x of form.querySelectorAll(".ev-t")) x.hidden = form.all.checked; };
  form.all.onchange = sync;
  sync();
  const f = await p;
  if (!f) return null;
  if (!f.title.value.trim() || !f.day.value) { toast("An event needs a title and a date", true); return null; }
  const all = f.all.checked;
  let end = all ? f.day.value : `${f.day.value}T${f.t1.value || f.t0.value || "00:00"}`;
  const start = all ? f.day.value : `${f.day.value}T${f.t0.value || "00:00"}`;
  if (end < start) end = start;
  return { type: "event", title: f.title.value.trim(), start, end, all_day: all, tz: -new Date(start.length > 10 ? start : start + "T12:00").getTimezoneOffset(),
    location: f.loc.value.trim(), link: f.link.value.trim(), notes: f.notes.value.trim() };
}

/* ------------------------------------------------------------ task */

const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);

/* A task made in the chat: the project's lists and group first (in a
   project channel or topic), the chat's people first as owners. Resolves
   with {list, task} once it is made, or null. */
export async function taskForm(ctx, prefill) {
  const pre = prefill || {};
  let lists = [];
  try { lists = ((await api("/api/task-lists")).lists || []).filter((l) => l.role === "owner" || l.role === "editor"); }
  catch (e) { toast(e.message, true); return null; }
  if (!lists.length) { toast("You cannot add tasks to any task list yet - ask a list owner", true); return null; }
  const reg = ctx.room && ctx.room.project || "";
  const hasReg = (l) => (l.groups || []).some((g) => g.reg === reg && reg);
  lists.sort((a, b) => hasReg(b) - hasReg(a) || a.title.localeCompare(b.title));
  const inRoom = new Set((ctx.room && ctx.room.members) || []);
  const ppl = ctx.people.slice().sort((a, b) => inRoom.has(b.uid) - inRoom.has(a.uid) || a.name.localeCompare(b.name));
  let owners = (pre.owners || []).map((u) => ctx.byUid[u]).filter(Boolean);
  const ownersHtml = () => owners.map((p) => esc(p.name)).join(", ") || `<span class="muted">nobody yet - choose</span>`;
  const p = modal(pre.title ? "Make a task from this message" : "New task", `<label>Title <input name="title" maxlength="300" value="${esc(pre.title || "")}" required></label>`
    + `<div class="it-2"><label>Task list <select name="list">${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>`
    + `<label>Group <select name="group"></select></label></div>`
    + `<label>Owners <div class="tf-owners td-v act">${ownersHtml()}</div></label>`
    + `<div class="it-2"><label>Due <input type="date" name="due" value="${esc(pre.due || "")}"></label>`
    + `<label>Priority <select name="prio"><option value="">-</option><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label></div>`
    + `<label>Description <textarea name="desc" rows="3" maxlength="20000">${esc(pre.description || "")}</textarea></label>`
    + `<p class="muted" style="font-size:11px">The task goes into the list, and a card for it into this chat.</p>`, "Make the task");
  const form = document.querySelector(".t-modal");
  const fill = () => {
    const l = lists.find((x) => x.id === form.list.value) || lists[0];
    const gs = (l.groups || []).slice().sort((a, b) => (b.reg === reg && !!reg) - (a.reg === reg && !!reg) || (a.sort || 0) - (b.sort || 0));
    form.group.innerHTML = gs.map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join("") || `<option value="">(no groups)</option>`;
  };
  form.list.onchange = fill;
  fill();
  form.querySelector(".tf-owners").onclick = (ev) => pickPeople(ev.currentTarget, owners, ppl, (v) => {
    owners = v;
    form.querySelector(".tf-owners").innerHTML = ownersHtml();
  });
  const f = await p;
  if (!f) return null;
  const title = f.title.value.trim();
  if (!title) { toast("Give the task a title", true); return null; }
  const id = newId();
  const links = (pre.links || []).slice();
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: f.list.value, chat_room: ctx.room ? ctx.room.id : "", tasks: [{
      id, title, group_id: f.group.value || "", due: f.due.value || "", priority: f.prio.value || "",
      owners: owners.map((x) => ({ uid: x.uid, name: x.name })), description: f.desc.value.trim(), links }] }) });
  } catch (e) { toast("Could not make the task: " + e.message, true); return null; }
  return { list: f.list.value, task: id };
}
