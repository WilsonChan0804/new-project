/* Messenger page (server side: chat.py).
 *
 * Left: the chats - project channels, groups, direct messages - and the
 * task discussions you follow. Middle: the conversation. New messages come
 * from /api/chat/sync, held open by the server until something changes.
 *
 * Fast to open: the last chats and their last messages are kept on this
 * device and shown at once, then replaced by the server's answer; a message
 * sent shows at once, "sending ...", until the server has it.
 *
 * In the message box: @ a person, # a task, ! an issue, $ a sheet, % the 3D
 * model or a saved view - picked from a list, sent as [label](address) and
 * shown as a chip. Enter is a new line; the Send button (or Ctrl+Enter)
 * sends.
 *
 * A task discussion is the task's own comments (tasks.py), shown here like
 * a chat so nobody has to look in two places.
 *
 * A project channel can have topics (sub-channels for one subject), listed
 * under it. Messages can be pinned (the bar under the chat's name), carry
 * a poll, an event or a task (the + button), and be formatted the way
 * WhatsApp does it (Aa: *bold* _italic_ ~strike~, lists, quotes, code).
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, avatar, ago, fmtWhen, pickPeople, pickOne, modal, toast, closePop, ic, pop } from "./tasks-util.js";
import { linkify, badge, chip, classify } from "./filelinks.js";
import { upload, filesHtml, pendingHtml, catchFiles } from "./uploads.js";
import { emojiPicker, QUICK } from "./emoji.js";
import * as Undo from "./undo.js";
import { toWhatsApp, parseWhatsApp, readExport, waText } from "./whatsapp.js";
import { formatHtml, plainText, formatKey } from "./chatfmt.js";
import { RichBox } from "./richbox.js";
import { pollHtml, eventHtml, pollForm, eventForm, taskForm, vote, closePoll, rsvp } from "./chatcards.js";

const C = {
  me: null, uid: null, people: [], byUid: {}, rooms: [], joinable: [], threads: [], projects: {},
  room: null, msgs: [], more: false, newer: false, rev: 0, reply: null, pend: [], q: "", pins: [], pinAt: 0,
};
const TASK = "task:";
let BOX = null;                 // the message box (richbox.js)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ kept on this device */

/* The last chats and the last messages of the last few opened, so the page
   shows them at once. Per account; signing out clears them (nav.js). */
const CK = "lwk-viewer:chat:";
function keep(k, v) {
  try { localStorage.setItem(CK + C.uid + ":" + k, JSON.stringify(v)); } catch (e) {}
}
function kept(k) {
  try { return JSON.parse(localStorage.getItem(CK + C.uid + ":" + k) || "null"); } catch (e) { return null; }
}
let keepTimer = null;
function keepRoom() {
  const r = C.room;
  if (!r || r.kind === "task") return;
  clearTimeout(keepTimer);
  keepTimer = setTimeout(() => {
    keep("m:" + r.id, { room: r, messages: C.msgs.filter((m) => !m.pending && !m.failed).slice(-60), more: C.more || C.msgs.length > 60 });
    const order = [r.id].concat((kept("opened") || []).filter((x) => x !== r.id));
    for (const old of order.slice(10)) { try { localStorage.removeItem(CK + C.uid + ":m:" + old); } catch (e) {} }
    keep("opened", order.slice(0, 10));
  }, 800);
}
function forget(id) {
  try { localStorage.removeItem(CK + C.uid + ":m:" + id); } catch (e) {}
}

/* ------------------------------------------------------------ loading */

async function loadRooms() {
  const r = await api("/api/chat/rooms");
  C.rooms = r.rooms;
  C.joinable = r.joinable;
  keep("rooms", { rooms: C.rooms, joinable: C.joinable });
  paintRooms();
  loadExtras().catch(() => {});
}

/* The task discussions you follow and the projects' names: after the
   chats are on screen, not before. */
let extrasAt = 0;
async function loadExtras(force) {
  const jobs = [api("/api/tasks-mine?view=subscribed").then((t) => {
    C.threads = t.tasks.filter((x) => x.comment_count > 0)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 30);
  }).catch(() => {})];
  if (force || Date.now() - extrasAt > 600e3) {
    jobs.push(api("/api/registry?lite=1").then((p) => {
      C.projects = Object.fromEntries(p.projects.map((x) => [x.id, x]));
      extrasAt = Date.now();
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  paintRooms();
  if (C.room && (C.room.kind === "project" || C.room.kind === "topic")) paintHead();
}

function setPeople(list) {
  C.people = list || [];
  C.byUid = Object.fromEntries(C.people.map((p) => [p.uid, p]));
}

function roomIcon(r) {
  if (r.kind === "dm") return avatar({ name: r.title }, 34);
  if (r.kind === "project") return `<span class="c-ico pj">P</span>`;
  if (r.kind === "topic") return `<span class="c-ico tp">#</span>`;
  if (r.kind === "task") return `<span class="c-ico tk">&#10003;</span>`;
  return `<span class="c-ico gr">&#128101;</span>`;
}

function paintRooms() {
  const q = C.q.trim().toLowerCase();
  const match = (r) => !q || (r.title || "").toLowerCase().includes(q) || (r.last_text || "").toLowerCase().includes(q);
  const row = (r) => `<a class="cr${C.room && C.room.id === r.id ? " on" : ""}${r.unread ? " unread" : ""}" data-room="${esc(r.id)}">`
    + roomIcon(r)
    + `<span class="cr-m"><span class="cr-t"><b>${esc(r.title)}</b><small>${r.last_at ? esc(short(r.last_at)) : ""}</small></span>`
    + `<span class="cr-l">${esc(plainLabels(r.last_text || ""))}</span></span>`
    + (r.unread ? `<b class="cr-n${r.mention ? " at" : ""}">${r.mention ? "@" : ""}${r.unread > 99 ? "99+" : r.unread}</b>` : "")
    + `</a>`;
  const sec = (title, list) => list.length ? `<div class="cs-h">${title}</div>` + list.map(row).join("") : "";
  const by = (k) => C.rooms.filter((r) => r.kind === k && match(r));
  // a channel's topics just under it (indented); a topic whose channel is
  // not in the list (not joined) on its own
  const channels = C.rooms.filter((r) => r.kind === "project");
  const topicsOf = (id) => C.rooms.filter((t) => t.kind === "topic" && t.parent === id && (match(t) || q && match(C.rooms.find((x) => x.id === id) || {})));
  const pjRows = channels.map((r) => {
    const ts = topicsOf(r.id);
    if (!match(r) && !ts.length) return "";
    return row(r) + ts.map((t) => row(t).replace('class="cr', 'class="cr sub')).join("");
  }).join("") + C.rooms.filter((t) => t.kind === "topic" && !channels.some((c) => c.id === t.parent) && match(t)).map(row).join("");
  const threads = C.threads.filter((t) => !q || t.title.toLowerCase().includes(q)).map((t) => ({
    id: TASK + t.id, kind: "task", title: t.title || "Untitled task", last_text: `${t.list_title} / ${t.group_title} · ${t.comment_count} comment${t.comment_count > 1 ? "s" : ""}`,
    last_at: t.updated_at, task: t }));
  const join = C.joinable.filter(match);
  $("#c-rooms").innerHTML = (pjRows ? `<div class="cs-h">Project channels</div>` + pjRows : "") + sec("Groups", by("group")) + sec("Direct messages", by("dm"))
    + sec("Task discussions", threads)
    + (join.length ? `<div class="cs-h">Channels you can join</div>` + join.map((r) => `<a class="cr join" data-join="${esc(r.id)}">${roomIcon(r)}`
      + `<span class="cr-m"><span class="cr-t"><b>${esc(r.title)}</b></span><span class="cr-l">${r.kind === "topic" ? "Topic in " + esc(roomTitle(r.parent) || "a project channel") + " · " : ""}Join</span></span></a>`).join("") : "")
    + (!C.rooms.length && !threads.length && !join.length ? `<p class="muted cs-none">No chats yet. Start one with the pencil above.</p>` : "");
  const n = C.rooms.reduce((s, r) => s + (r.unread || 0), 0);
  document.title = (n ? `(${n}) ` : "") + "LWK Viewer - Chat";
}

const plainLabels = (t) => plainText(String(t || "").replace(/\[([^\]\n]{1,200})\]\([^\s)]+\)/g, "$1"));
const roomTitle = (id) => ((C.rooms.find((x) => x.id === id) || C.joinable.find((x) => x.id === id) || {}).title || "");

function short(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------ a room */

/* at: a message to show (a pin, a search hit, a link with &msg=). */
async function openRoom(id, at) {
  window.LWKOpenRoom = id;           // notify.js: no notification for the chat in front
  closePop();
  C.reply = null;
  C.pend = [];
  paintPend();
  $("#c-reply").hidden = true;
  $("#c-right").hidden = true;
  if (id.startsWith(TASK)) return openThread(id.slice(TASK.length));
  const ticket = ++openTicket;
  const was = kept("m:" + id);
  if (was && was.room) {
    // what this device showed last time, straight away
    C.room = was.room;
    C.msgs = was.messages || [];
    C.more = was.more;
    paintHead();
    paintMsgs(true);
    paintRooms();
  }
  let r;
  try {
    r = await api(`/api/chat/rooms/${encodeURIComponent(id)}/messages?limit=60${at ? "&at=" + encodeURIComponent(at) : ""}`);
  } catch (e) {
    if (was) { forget(id); if (ticket === openTicket) closeRoom(id); }
    throw e;
  }
  if (ticket !== openTicket) return;           // another chat was opened meanwhile
  const mine = C.room && C.room.id === id ? C.msgs.filter((m) => m.pending || m.failed) : [];
  C.room = r.room;
  C.newer = !!r.newer;
  C.msgs = C.newer ? r.messages : r.messages.concat(mine);
  C.more = r.more;
  if (!was || was.room.id !== id) { C.pins = []; C.pinAt = 0; }
  history.replaceState(null, "", "messenger.html?room=" + encodeURIComponent(id));
  paintHead();
  paintMsgs(!was && !at);
  if (at) flash(at);
  markRead();
  paintRooms();
  loadPins();
  if (matchMedia("(hover: hover)").matches && !at) $("#c-text").focus();
}

/* A message brought into view and lit up for a moment. Not on the page
   (an older one): the messages round it are fetched. */
async function jumpTo(mid) {
  if (!C.room) return;
  if (!C.msgs.some((m) => m.id === mid)) return openRoom(C.room.id, mid);
  flash(mid);
}
function flash(mid) {
  const el = document.querySelector(`.c-msg[data-id="${CSS.escape(mid)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("lit");
  setTimeout(() => el.classList.remove("lit"), 2200);
}

/* ------------------------------------------------------------ pins */

async function loadPins() {
  const room = C.room;
  if (!room || room.kind === "task" || room.member === false) { C.pins = []; return paintPins(); }
  try {
    const r = await api(`/api/chat/rooms/${room.id}/pins`);
    if (!C.room || C.room.id !== room.id) return;
    C.pins = r.messages;
    C.pinAt = Math.min(C.pinAt, Math.max(0, C.pins.length - 1));
  } catch (e) { C.pins = []; }
  paintPins();
}

/* The bar under the chat's name: one pinned message at a time (the latest
   first); a click shows it and moves the bar on to the next. */
function paintPins() {
  const bar = $("#c-pins");
  const ps = C.pins || [];
  if (!ps.length || !C.room) { bar.hidden = true; return; }
  const m = ps[C.pinAt] || ps[0];
  bar.hidden = false;
  bar.innerHTML = `<span class="pn-ico">${ic("pin", 15)}</span>`
    + `<button type="button" class="pn-m" data-pjump="${esc(m.id)}"><small class="muted">Pinned${ps.length > 1 ? ` · ${C.pinAt + 1} of ${ps.length}` : ""}</small>`
    + `<span>${esc(m.author ? m.author + ": " : "")}${esc(pinText(m))}</span></button>`
    + (ps.length > 1 ? `<button type="button" class="ghost pn-all" data-pall>All ${ps.length}</button>` : "");
}
const pinText = (m) => (plainLabels(m.body || "") || (m.card && (m.card.question || m.card.title)) || ((m.files || [])[0] || {}).name || "").slice(0, 140);

async function pinMsg(m, on) {
  try {
    const r = await api(`/api/chat/messages/${m.id}/pin`, { method: "POST", body: JSON.stringify({ on }) });
    Object.assign(m, r);
    if (!r.pinned) delete m.pinned;
    paintMsgs(false);
    if (!Undo.replaying()) {
      toast(on ? "Pinned - everyone in the chat sees it at the top" : "Unpinned");
      Undo.record({ label: on ? "pinned a message" : "unpinned a message", undo: () => pinMsg(m, !on), redo: () => pinMsg(m, on) });
    }
    await loadPins();
  } catch (e) { toast(e.message, true); }
}

function pinsPanel() {
  const box = $("#c-right");
  box.hidden = false;
  box.dataset.v = "p";
  const ps = C.pins || [];
  box.innerHTML = `<div class="cp-h"><b>Pinned messages</b> <span class="muted">${ps.length}</span><span class="spacer"></span><button class="ghost" data-x>${ic("close")}</button></div>`
    + (ps.map((m) => `<div class="cp-pin"><a class="cp-s" data-pjump="${esc(m.id)}"><b>${esc(m.author || "Update")}</b> <small class="muted">${esc(short(m.created_at))}</small><br>`
      + `<span>${esc(pinText(m))}</span></a><small class="muted">pinned by ${esc((m.pinned || {}).by || "")}</small>`
      + ` <button type="button" class="ghost linkish" data-unpin="${esc(m.id)}">unpin</button></div>`).join("") || `<p class="muted">Nothing pinned.</p>`);
  box.onclick = async (ev) => {
    if (ev.target.closest("[data-x]")) { box.hidden = true; return; }
    const j = ev.target.closest("[data-pjump]");
    if (j) return jumpTo(j.dataset.pjump);
    const u = ev.target.closest("[data-unpin]");
    if (u) {
      const m = C.msgs.find((x) => x.id === u.dataset.unpin) || C.pins.find((x) => x.id === u.dataset.unpin);
      if (m) { await pinMsg(m, false); pinsPanel(); }
    }
  };
}
let openTicket = 0;

async function openThread(tid) {
  const ticket = ++openTicket;
  const r = await api("/api/tasks/" + encodeURIComponent(tid));
  if (ticket !== openTicket) return;
  const t = r.task;
  const meta = C.threads.find((x) => x.id === tid) || {};
  C.room = { id: TASK + tid, kind: "task", title: t.title || "Untitled task", member: r.role !== "viewer", task: t,
    list_title: meta.list_title || "", group_title: meta.group_title || "", members: (t.subscribers || []).map((s) => s.uid) };
  C.msgs = r.comments.map((c) => ({ id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files || [],
    edited_at: c.edited_at || "", created_at: c.created_at, kind: "text", seq: 0 }));
  C.more = false;
  history.replaceState(null, "", "messenger.html?task=" + encodeURIComponent(tid));
  paintHead();
  paintMsgs(true);
  paintRooms();
}

function paintHead() {
  const r = C.room;
  $("#c-app").classList.add("in-room");
  $("#c-empty").hidden = true;
  $("#c-conv").hidden = false;
  $("#c-icon").outerHTML = `<span id="c-icon">${roomIcon(r)}</span>`;
  $("#c-title").textContent = r.title;
  const p = r.kind === "project" || r.kind === "topic" ? C.projects[r.project] : null;
  $("#c-sub").textContent = r.description ? r.description.split("\n")[0]
    : r.kind === "project" ? "Project channel" + (p && p.code ? " · " + p.code : "")
      : r.kind === "topic" ? "Topic in " + (roomTitle(r.parent) || "the project channel")
      : r.kind === "dm" ? "Direct message" : r.kind === "task" ? `Task discussion · ${r.list_title} / ${r.group_title}`
        : `Group · ${r.members.length} people`;
  $("#c-mcount").textContent = r.members ? r.members.length : "";
  $("#c-members-btn").hidden = r.kind === "dm";
  $("#c-files-btn").hidden = r.kind === "task";
  let links = "";
  if (p) {
    links += `<a href="projects.html?p=${esc(p.id)}">Project</a>`;
    if (p.stats && p.stats.groups[0]) links += `<a href="tasks.html?list=${esc(p.stats.groups[0].list_id)}">Tasks</a>`;
    if (p.viewer && p.viewer_ok) {
      const q = "?project=" + encodeURIComponent(p.viewer);
      links += `<a href="index.html${q}">Sheets</a><a href="model.html${q}">3D</a>`;
    }
  }
  if (r.kind === "task") links += `<a href="tasks.html?list=${esc(r.task.list_id)}&task=${esc(r.task.id)}">Open the task</a>`;
  $("#c-links").innerHTML = links;
  $("#c-join").hidden = r.member !== false || r.kind === "task";
  $("#c-compose").hidden = r.member === false;
  $("#c-plus").hidden = r.kind === "task";
  paintTopics();
  paintPins();
}

/* A project channel and its topics, as tabs under the chat's name. */
function paintTopics() {
  const r = C.room, bar = $("#c-topics");
  const chan = r && (r.kind === "project" ? r : r.kind === "topic" ? C.rooms.find((x) => x.id === r.parent) : null);
  if (!chan) { bar.hidden = true; return; }
  const ts = C.rooms.filter((x) => x.kind === "topic" && x.parent === chan.id)
    .concat(C.joinable.filter((x) => x.kind === "topic" && x.parent === chan.id).map((x) => Object.assign({ join: true }, x)));
  bar.hidden = false;
  bar.innerHTML = `<button type="button" class="tp-c${r.id === chan.id ? " on" : ""}" data-topic="${esc(chan.id)}"># General</button>`
    + ts.map((t) => `<button type="button" class="tp-c${r.id === t.id ? " on" : ""}${t.join ? " join" : ""}${t.unread ? " unread" : ""}" data-topic="${esc(t.id)}"${t.join ? ` data-tjoin="1" title="Join this topic"` : ""}># ${esc(t.title)}${t.unread ? ` <b>${t.unread}</b>` : ""}</button>`).join("")
    + `<button type="button" class="tp-c add" data-newtopic="${esc(chan.id)}" title="A sub-channel for one subject, e.g. Facade, MEP coordination">${ic("plus", 13)} Topic</button>`;
}

async function newTopic(parent) {
  const f = await modal("New topic", `<p class="muted" style="font-size:12px">A sub-channel of ${esc(roomTitle(parent) || "the project channel")} for one subject. Everyone in the channel is added.</p>`
    + `<label>Name <input name="t" maxlength="80" placeholder="e.g. Facade, MEP coordination, Site visits" required></label>`
    + `<label>What it is for <textarea name="d" rows="2" maxlength="2000" placeholder="optional"></textarea></label>`, "Open topic");
  if (!f || !f.t.value.trim()) return;
  try {
    const r = await api("/api/chat/rooms", { method: "POST", body: JSON.stringify({ kind: "topic", parent, title: f.t.value.trim(), description: f.d.value.trim() }) });
    await loadRooms();
    openRoom(r.id);
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ messages */

function mention(html) {
  for (const p of C.people) {
    const e = esc("@" + p.name);
    if (html.includes(e)) html = html.split(e).join(`<b class="mention${p.uid === C.uid ? " me" : ""}">${e}</b>`);
  }
  return html;
}

function cardHtml(m) {
  const c = m.card || {};
  if (c.type === "task") {
    const say = { created: "New task", assigned: "Assigned", completed: "Completed", comment: "New comment", reopened: "Reopened", shared: c.done ? "Task (done)" : "Task" }[c.event] || "Updated";
    return `<div class="c-card task ev-${esc(c.event)}"><div class="cc-h">${badge("task")} <b>${esc(say)}</b> <span class="muted">${esc(c.list)} / ${esc(c.group)}</span></div>`
      + `<div class="cc-t">${esc(c.title)}</div>`
      + (c.text ? `<div class="cc-x">${c.event === "assigned" ? "to " : ""}${esc(c.text)}</div>` : "")
      + `<div class="cc-f">${c.owners && c.owners.length ? "Owner: " + esc(c.owners.join(", ")) : c.event === "shared" ? "No owner yet" : ""}${c.due ? " · Due " + esc(c.due) : ""}`
      + `<span class="spacer"></span><a href="tasks.html?list=${esc(c.list_id)}&task=${esc(c.task_id)}">View task</a></div></div>`;
  }
  if (c.type === "issue") {
    const url = c.sheet ? `index.html?project=${encodeURIComponent(c.project)}&sheet=${encodeURIComponent(c.sheet)}&select=${encodeURIComponent(c.id)}`
      : `model.html?project=${encodeURIComponent(c.project)}&select=${encodeURIComponent(c.id)}`;
    return `<div class="c-card issue"><div class="cc-h">${badge("issue")} <b>${c.event === "raised" ? "New issue" : "Issue " + esc(c.status)}</b> <span class="muted">${esc(c.project)}${c.sheet ? " · " + esc(c.sheet) : ""}</span></div>`
      + `<div class="cc-t">#${esc(c.number || "?")} ${esc(c.title)}</div>`
      + `<div class="cc-f">${c.assigned_to ? "Assigned to " + esc(c.assigned_to) : ""}${c.due ? " · Due " + esc(c.due) : ""}<span class="spacer"></span><a href="${esc(url)}">Show in viewer</a></div></div>`;
  }
  const ctx = { uid: C.uid, byUid: C.byUid };
  if (m.pending && ["poll", "event", "task_ref"].includes(c.type)) return `<div class="c-card"><div class="cc-t">${esc(c.question || c.title || "")}</div></div>`;
  if (c.type === "poll") return pollHtml(m, ctx);
  if (c.type === "event") return eventHtml(m, ctx);
  return "";
}

/* An "Embed" code pasted from OneDrive / SharePoint (<iframe src="...">)
   is kept as its address, which linkify() shows as a player. */
const unframe = (t) => String(t || "").replace(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>(\s*<\/iframe>)?/gi, " $1 ");

/* [label](viewer address) - what # ! $ % put in - as a chip with the label.
   Only the viewer's own pages: anything else stays as the words typed. */
const LINK_MD = /\[([^\]\n]{1,200})\]\(((?:https?:\/\/[^\s)]+\/)?(?:index|model|tasks|projects|dashboard)\.html\?[^\s)]*)\)/g;

/* The words of a message: WhatsApp's formatting (chatfmt.js) round the
   page's own drawing of plain text (links, chips, @mentions). */
function textHtml(body) {
  return formatHtml(unframe(body), plainHtml);
}

const MD_LINK = /^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)$/;
function plainHtml(src) {
  // a link made with the box's link button: its words, linked
  const ext = MD_LINK.exec(src);
  if (ext && new URL(ext[2]).origin !== location.origin) return `<a href="${esc(ext[2])}" target="_blank" rel="noopener">${esc(ext[1])}</a>`;
  let out = "", at = 0, m;
  LINK_MD.lastIndex = 0;
  while ((m = LINK_MD.exec(src))) {
    out += mention(linkify(esc(src.slice(at, m.index))));
    const url = new URL(m[2], location.href);
    const c = url.origin === location.origin ? classify(url.href) : null;
    out += c ? chip({ kind: c.kind === "url" ? "url" : c.kind, url: url.pathname.replace(/^.*\//, "") + url.search, title: m[1] })
      : esc(m[0]);
    at = m.index + m[0].length;
  }
  return out + mention(linkify(esc(src.slice(at))));
}

/* Messages from WhatsApp (pasted, or an exported chat) as one quote. */
const waOpen = new Set();
function waHtml(m) {
  const c = m.card, files = m.files || [];
  const all = c.lines || [];
  const open = waOpen.has(m.id) || all.length <= 8;
  const lines = open ? all : all.slice(-8);
  const row = (l) => {
    const f = l.file && files.find((x) => x.name === l.file);
    return `<div class="wa-l"><div class="wa-n"><b>${esc(l.name)}</b><small>${esc(l.at)}</small></div>`
      + (l.text ? `<div class="wa-t">${textHtml(l.text)}</div>` : "")
      + (f ? filesHtml([f]) : l.file ? `<small class="muted">${ic("clip", 12)} ${esc(l.file)} (not brought in)</small>` : "") + `</div>`;
  };
  return `<div class="c-card wa"><div class="cc-h"><span class="fl-badge wa-b">WA</span> <b>${esc(c.title || "From WhatsApp")}</b>`
    + ` <span class="muted">${all.length} message${all.length === 1 ? "" : "s"}${c.cut ? " (the oldest left out)" : ""}</span></div>`
    + (!open ? `<button type="button" class="ghost linkish wa-more" data-wa-all="${esc(m.id)}">Show all ${all.length}</button>` : "")
    + `<div class="wa-lines">${lines.map(row).join("")}</div></div>`;
}

function reactsHtml(m) {
  const rs = Object.entries(m.reactions || {});
  if (!rs.length) return "";
  return `<div class="c-rxs">` + rs.map(([e, us]) => {
    const names = us.map((u) => (u === C.uid ? "You" : (C.byUid[u] || {}).name || "Someone")).join(", ");
    return `<button type="button" class="c-rx${us.includes(C.uid) ? " me" : ""}" data-rx="${esc(e)}" data-mid="${esc(m.id)}" title="${esc(names)}">${e}<b>${us.length}</b></button>`;
  }).join("") + `<button type="button" class="c-rx add" data-react="${esc(m.id)}" title="React">${ic("smile", 14)}</button></div>`;
}

/* Editing in place: the words in a box, Save / Cancel. */
function editorHtml(m) {
  return `<div class="c-edit"><div class="c-ebox" data-etext="${esc(m.id)}"></div>`
    + `<div class="c-edit-b"><button type="button" class="primary" data-esave="${esc(m.id)}">Save</button>`
    + `<button type="button" class="ghost" data-ecancel>Cancel</button><small class="muted">Ctrl+Enter saves · Esc cancels</small></div></div>`;
}

/* Only the person who sent it - not a chat admin, not a site admin. */
function canDelete(m) {
  return !!m && m.uid != null && m.uid === C.uid && m.kind !== "card";
}

function startEdit(id) {
  const m = C.msgs.find((x) => x.id === id);
  if (!m) return;
  C.editing = id;
  C.editText = m.body || "";
  C.editBox = null;
  paintMsgs(false);
  if (C.editBox) { C.editBox.focus(); C.editBox.caretToEnd(); }
}

function stopEdit() {
  C.editing = null;
  C.editText = null;
  C.editBox = null;
  paintMsgs(false);
}

async function saveEdit(id) {
  const m = C.msgs.find((x) => x.id === id);
  const t = (C.editText || "").trim();
  if (!m) return stopEdit();
  if (t === (m.body || "").trim()) return stopEdit();
  const was = m.body || "";
  const task = C.room.kind === "task" ? C.room.task : null;
  try {
    await setBody(m, t, false, task);
    stopEdit();
    toast("Message changed");
    Undo.record({ label: "edited a message", undo: () => setBody(m, was, true, task), redo: () => setBody(m, t, true, task) });
  } catch (e) { toast(e.message, true); }
}

/* a message's text, saved (for an edit and its Undo / Redo) */
async function setBody(m, t, paint, task) {
  if (task) {
    const c = await api(`/api/tasks/${task.id}/comments/${m.id}`, { method: "PATCH", body: JSON.stringify({ body: t }) });
    Object.assign(m, { body: c.body, edited_at: c.edited_at });
  } else {
    Object.assign(m, await api(`/api/chat/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ body: t }) }));
  }
  if (paint) paintMsgs(false);
}

async function deleteMsg(m) {
  if (!m || !confirm("Delete this message for everyone?")) return;
  try {
    if (C.room.kind === "task") {
      await api(`/api/tasks/${C.room.task.id}/comments/${m.id}`, { method: "DELETE" });
      C.msgs = C.msgs.filter((x) => x.id !== m.id);
    } else {
      await api(`/api/chat/messages/${m.id}`, { method: "DELETE" });
      m.deleted = true;
      // the sender can bring it back for a day (Ctrl+Z)
      Undo.record({ label: "deleted a message", undo: () => restoreMsg(m), redo: () => dropMsg(m) });
    }
    paintMsgs(false);
  } catch (e) { toast(e.message, true); }
}
async function restoreMsg(m) {
  const r = await api(`/api/chat/messages/${m.id}/restore`, { method: "POST", body: "{}" });
  delete m.deleted;
  Object.assign(m, r);
  paintMsgs(false);
  loadPins();
}
async function dropMsg(m) {
  await api(`/api/chat/messages/${m.id}`, { method: "DELETE" });
  m.deleted = true;
  paintMsgs(false);
}

/* More: the rest of what can be done with a message, with words. */
function moreMenu(btn, id) {
  const m = C.msgs.find((x) => x.id === id);
  if (!m) return;
  const room = C.room.kind !== "task";
  const el = pop(btn, `<div class="po-row" data-k="copy">${ic("copy")} Copy</div>`
    + (room ? `<div class="po-row" data-k="pin">${ic("pin")} ${m.pinned ? "Unpin" : "Pin"}</div>` : "")
    + (room ? `<div class="po-row" data-k="task">${ic("task")} Make a task</div>` : "")
    + (room ? `<div class="po-row" data-k="fwd">${ic("forward")} Forward to another chat</div>` : "")
    + (room ? `<div class="po-row" data-k="wa">${ic("whatsapp")} Send to WhatsApp</div>` : "")
    + (room ? `<div class="po-row" data-k="link">${ic("link")} Copy link to this message</div>` : "")
    + (m.uid === C.uid && m.kind !== "card" ? `<div class="po-row" data-k="edit">${ic("edit")} Edit</div>` : "")
    + (canDelete(m) ? `<div class="po-row bad" data-k="del">${ic("trash")} Delete</div>` : ""), 240);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    for (const x of document.querySelectorAll(".c-msg.show-acts")) x.classList.remove("show-acts");
    const k = r.dataset.k;
    if (k === "copy") copyMsg(m);
    if (k === "pin") pinMsg(m, !m.pinned);
    if (k === "task") taskFromMsg(m);
    if (k === "link") copyMsg({ body: new URL(`messenger.html?room=${encodeURIComponent(C.room.id)}&msg=${encodeURIComponent(m.id)}`, location.href).href, files: [] });
    if (k === "fwd") forwardMsg(m);
    if (k === "wa") toWhatsApp(m, C.room.title).catch((e) => toast(e.message, true));
    if (k === "edit") startEdit(m.id);
    if (k === "del") deleteMsg(m);
  });
}

function msgHtml(m, prev) {
  if (m.kind === "system") return `<div class="c-sys">${esc(m.body)} · ${esc(short(m.created_at))}</div>`;
  const fwd = m.card && m.card.type === "forward" ? m.card : null;
  const same = prev && prev.kind !== "system" && prev.uid === m.uid && prev.author === m.author && !fwd
    && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60e3 && !m.reply_to;
  const mine = m.uid != null && m.uid === C.uid;
  const reply = m.reply_to && C.msgs.find((x) => x.id === m.reply_to);
  const by = m.kind === "card" ? (m.author ? m.author + " · update" : "Update") : m.author;
  const wa = m.card && m.card.type === "whatsapp";
  const own = m.card && ["poll", "event", "task", "task_ref"].includes(m.card.type);
  const inner = fwd ? (fwd.inner ? cardHtml({ card: fwd.inner }) : "") : m.kind === "card" || own ? cardHtml(m) : wa ? waHtml(m) : "";
  const shown = wa ? new Set((m.card.lines || []).map((l) => l.file).filter(Boolean)) : null;
  const files = shown ? (m.files || []).filter((f) => !shown.has(f.name)) : m.files;
  const room = C.room.kind !== "task";
  return `<div class="c-msg${same ? " cont" : ""}${mine ? " mine" : ""}" data-id="${esc(m.id)}">`
    + (same ? `<span class="c-av"></span>` : `<span class="c-av">${m.kind === "card" ? `<span class="c-ico bot">${ic("bell", 18)}</span>` : avatar({ name: m.author }, 34)}</span>`)
    + `<div class="c-body">`
    + (same && !m.pinned ? "" : `<div class="c-meta"><b>${same ? "" : esc(by)}</b><small title="${esc(fmtWhen(m.created_at))}">${same ? "" : esc(short(m.created_at))}</small>`
      + (m.pinned ? `<span class="c-pinned" title="Pinned by ${esc(m.pinned.by)}">${ic("pin", 12)} pinned</span>` : "") + `</div>`)
    + (m.deleted ? `<div class="c-del">message deleted</div>`
      : (reply ? `<div class="c-quote" data-pjump="${esc(reply.id)}"><b>${esc(reply.author)}</b> ${esc(plainLabels(reply.body || (reply.card && (reply.card.question || reply.card.title)) || "").slice(0, 120))}</div>` : "")
        + (fwd ? `<div class="c-fwd">${ic("forward", 13)} Forwarded from <b>${esc(fwd.from)}</b> in ${esc(fwd.room)}</div>` : "")
        + `<div class="${fwd ? "c-fwd-body" : ""}">`
        + inner
        + (C.editing === m.id ? editorHtml(m)
          : m.body ? `<div class="c-text">${textHtml(m.body)}${m.edited_at ? ` <small class="muted">(edited)</small>` : ""}</div>` : "")
        + filesHtml(files) + `</div>`
        + (m.pending ? `<div class="c-state">sending ...</div>` : "")
        + (m.failed ? `<div class="c-state bad">Not sent - <button type="button" class="ghost linkish" data-retry="${esc(m.id)}">send again</button> · <button type="button" class="ghost linkish" data-drop="${esc(m.id)}">remove</button></div>` : "")
        + (room ? reactsHtml(m) : ""))
    + `</div>`
    // the buttons: React, Reply, Edit (your own), and More (Copy, Forward,
    // WhatsApp, Delete). A task's comments: Edit and More.
    + (!m.deleted && !m.pending && !m.failed && C.editing !== m.id ? `<div class="c-acts">`
      + (room ? `<button class="ghost" data-react="${esc(m.id)}" title="React">${ic("smile")}</button>` : "")
      + (room ? `<button class="ghost" data-reply="${esc(m.id)}" title="Reply">${ic("reply")}</button>` : "")
      + (mine && m.kind !== "card" ? `<button class="ghost" data-edit="${esc(m.id)}" title="Edit">${ic("edit")}</button>` : "")
      + `<button class="ghost" data-more="${esc(m.id)}" title="More: copy, pin, make a task, forward, WhatsApp${canDelete(m) ? ", delete" : ""}">${ic("more")}</button>`
      + `</div>` : "")
    + `</div>`;
}

function paintMsgs(toBottom) {
  const box = $("#c-msgs");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  let day = "", h = C.more ? `<button class="ghost c-more">Earlier messages</button>` : "";
  C.msgs.forEach((m, i) => {
    const d = new Date(m.created_at).toDateString();
    if (d !== day) {
      day = d;
      h += `<div class="c-day"><span>${esc(new Date(m.created_at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</span></div>`;
      return void (h += msgHtml(m, null));
    }
    h += msgHtml(m, C.msgs[i - 1]);
  });
  if (!C.msgs.length) h += `<p class="muted c-none">${C.room.kind === "task" ? "No comments on this task yet." : "No messages yet - say hello."}</p>`;
  if (C.newer) h += `<button class="ghost c-latest" data-latest>${ic("down", 14)} Newer messages - go to the latest</button>`;
  // a message being changed keeps its box (and caret) through a repaint
  const eb = C.editing && C.editBox;
  const had = eb && eb.el.contains(document.activeElement) || (eb && document.activeElement === eb.el);
  if (had) eb.saveRange();
  const top = box.scrollTop;
  box.innerHTML = h;
  const slot = C.editing && box.querySelector(`[data-etext="${CSS.escape(C.editing)}"]`);
  if (slot) {
    if (eb) slot.replaceWith(eb.el);
    else {
      C.editBox = new RichBox(slot);
      C.editBox.value = C.editText || "";
    }
    if (had) { eb.restoreRange(); box.scrollTop = top; }
  }
  if (toBottom || atBottom) box.scrollTop = box.scrollHeight;
  for (const img of box.querySelectorAll("img")) img.addEventListener("load", () => { if (toBottom || atBottom) box.scrollTop = box.scrollHeight; }, { once: true });
  keepRoom();
}

let readTimer = null;
function markRead() {
  if (!C.room || C.room.kind === "task" || !C.room.member || document.hidden) return;
  clearTimeout(readTimer);
  readTimer = setTimeout(async () => {
    const last = C.msgs.length ? C.msgs[C.msgs.length - 1].seq : 0;
    const r = C.rooms.find((x) => x.id === C.room.id);
    if (r) { r.unread = 0; r.mention = 0; paintRooms(); }
    try { await api(`/api/chat/rooms/${C.room.id}/read`, { method: "POST", body: JSON.stringify({ seq: last }) }); } catch (e) {}
  }, 400);
}
document.addEventListener("visibilitychange", markRead);
addEventListener("focus", markRead);

/* ------------------------------------------------------------ sending */

function paintPend() { $("#c-pend").innerHTML = pendingHtml(C.pend); }

async function addFiles(files) {
  if (!C.room) return;
  for (const f of files) {
    const p = { name: f.name || "pasted.png", mime: f.type, size: f.size, url: (f.type || "").startsWith("image/") ? URL.createObjectURL(f) : "" };
    C.pend.push(p);
    paintPend();
    try {
      Object.assign(p, await upload(f, C.room.kind === "task" ? { task: C.room.task.id } : { room: C.room.id }, p.name));
    } catch (e) { p.error = e.message; }
    paintPend();
  }
}

/* The message shows at once ("sending ..."); the server's copy replaces it.
   One that did not go stays, with "send again". */
async function send() {
  const body = BOX.value.trim();
  if (!C.room) return;
  if (C.pend.some((p) => !p.id && !p.error)) return toast("Still uploading - a moment", true);
  const files = C.pend.filter((p) => p.id);
  if (!body && !files.length) return;
  closePop();
  BOX.clear();
  C.pend = [];
  paintPend();
  const tmp = { id: "tmp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), uid: C.uid,
    author: (C.me.user || {}).name || "", body, files, created_at: new Date().toISOString(), kind: "text",
    reply_to: C.reply || "", pending: true, seq: 1e12 };
  C.reply = null;
  $("#c-reply").hidden = true;
  C.msgs.push(tmp);
  paintMsgs(true);
  await deliver(tmp, C.room);
}

async function deliver(tmp, room, card) {
  tmp.pending = true;
  tmp.failed = false;
  try {
    let m;
    if (room.kind === "task") {
      const c = await api(`/api/tasks/${room.task.id}/comments`, { method: "POST", body: JSON.stringify({ body: tmp.body, files: tmp.files.map((f) => f.id) }) });
      m = { id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files, created_at: c.created_at, kind: "text" };
    } else {
      m = await api(`/api/chat/rooms/${room.id}/messages`, { method: "POST",
        body: JSON.stringify({ body: tmp.body, files: tmp.files.map((f) => f.id), reply_to: tmp.reply_to || "", card: card || tmp.card || null }) });
    }
    if (!C.room || C.room.id !== room.id) return;
    const i = C.msgs.indexOf(tmp);
    if (C.msgs.some((x) => x.id === m.id)) { if (i >= 0) C.msgs.splice(i, 1); }
    else if (i >= 0) C.msgs[i] = m;
    else C.msgs.push(m);
    C.msgs.sort((a, b) => (a.seq || 0) - (b.seq || 0) || 0);
  } catch (e) {
    tmp.pending = false;
    tmp.failed = true;
    tmp.error = e.message;
    toast(e.message, true);
  }
  if (C.room && C.room.id === room.id) paintMsgs(true);
}

/* The + in the message box: a poll, an event or a task. */
function plusMenu() {
  const el = pop($("#c-plus"), `<div class="po-row" data-k="poll">${ic("poll")} Poll</div>`
    + `<div class="po-row" data-k="event">${ic("calendar")} Event / meeting</div>`
    + `<div class="po-row" data-k="task">${ic("task")} Task</div>`
    + `<div class="po-row" data-k="link">${ic("hash")} Link a task, issue, sheet or 3D view</div>`, 260);
  el.addEventListener("click", async (ev) => {
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    if (r.dataset.k === "poll") { const c = await pollForm(); if (c) sendCard(c); }
    if (r.dataset.k === "event") { const c = await eventForm(); if (c) sendCard(c); }
    if (r.dataset.k === "task") sendTask();
    if (r.dataset.k === "link") linkMenu($("#c-plus"));
  });
}

async function sendTask(prefill, body) {
  const room = C.room;
  const t = await taskForm({ room, people: C.people, byUid: C.byUid }, prefill);
  if (!t) return;
  if (!C.room || C.room.id !== room.id) await openRoom(room.id);
  await sendCard({ type: "task_ref", task: t.task, title: (prefill && prefill.title) || "Task" }, [], body || "");
  toast("Task made");
}

/* More > Make a task: the words as its title and description, the people
   @mentioned as owners, a link back to the message. */
function taskFromMsg(m) {
  const text = plainLabels(m.body || (m.card && (m.card.question || m.card.title)) || "").trim();
  const first = text.split("\n").find((l) => l.trim()) || "";
  const owners = C.people.filter((p) => p.uid !== C.uid && (m.body || "").includes("@" + p.name)).map((p) => p.uid);
  const url = `/messenger.html?room=${encodeURIComponent(C.room.id)}&msg=${encodeURIComponent(m.id)}`;
  return sendTask({
    title: first.slice(0, 200),
    owners,
    description: (m.author ? m.author + " wrote in " + C.room.title + ":\n" : "") + text,
    links: [{ kind: "url", url, title: "The message in " + C.room.title }],
  }, "");
}

/* A card someone sends (WhatsApp quotes, polls, events, tasks): the same
   way as a message. */
async function sendCard(card, files, body) {
  if (!C.room || C.room.kind === "task") return;
  const tmp = { id: "tmp" + Date.now().toString(36), uid: C.uid, author: (C.me.user || {}).name || "", body: body || "",
    files: files || [], card, created_at: new Date().toISOString(), kind: "text", pending: true, seq: 1e12 };
  C.msgs.push(tmp);
  paintMsgs(true);
  await deliver(tmp, C.room, card);
}


/* @ lists the people in this chat; # ! $ % the tasks, issues, sheets and 3D
   of the project (all your projects outside a project channel). */
const LINK_KINDS = { "#": "task", "!": "issue", "$": "sheet", "%": "model" };
const LINK_SAY = { task: "tasks", issue: "issues", sheet: "sheets", model: "3D models or saved views" };
let lsTimer = null, lsSeq = 0;

/* a picked task, issue, sheet or view: a chip in the box, sent as [label](address) */
function putLink(row) {
  const label = row.label.replace(/[\[\]\n]/g, " ").trim();
  BOX.insertChip(`[${label}](${row.url})`, label);
}

function rowHtml(x, i) {
  return `<div class="po-row lk-row" data-v="${i}">${badge(x.kind)}<span class="lk-m"><b>${esc(x.label)}</b>`
    + (x.sub ? `<small class="muted">${esc(x.sub)}</small>` : "") + `</span></div>`;
}

/* Which project the lists look in: chosen first (the chips / the select),
   starting from the channel's own project, else the one chosen last. */
const LK = { byRoom: {} };
const LK_KEY = "lwk-viewer:link-project";
function linkScope() {
  if (!C.room) return "";
  if (C.room.id in LK.byRoom) return LK.byRoom[C.room.id];
  if (C.room.kind === "project" && C.room.project) return C.room.project;
  let v = "";
  try { v = localStorage.getItem(LK_KEY) || ""; } catch (e) {}
  return v && C.projects[v] ? v : "";
}
function setScope(reg) {
  if (C.room) LK.byRoom[C.room.id] = reg;
  try { localStorage.setItem(LK_KEY, reg); } catch (e) {}
}
function scopeList() {
  return [["", "All projects"]].concat(Object.values(C.projects)
    .map((p) => [p.id, p.short || p.name]).sort((a, b) => a[1].localeCompare(b[1])));
}
function scopeChips(cur) {
  return `<div class="lk-proj" title="Choose the project first">` + scopeList().map(([id, n]) =>
    `<button type="button" class="lk-pc${id === cur ? " on" : ""}" data-reg="${esc(id)}">${esc(n)}</button>`).join("") + `</div>`;
}

async function searchLinks(kind, q, reg) {
  const r = await api(`/api/link-search?kind=${kind}&q=${encodeURIComponent(q)}&reg=${encodeURIComponent(reg || "")}`);
  return r.rows || [];
}

/* The list under the message box while # ! $ % is typed: the project
   chips first, then what matches in the chosen project. */
async function inlineLinks(sym, q) {
  const box = $("#c-text");
  const token = sym + q, kind = LINK_KINDS[sym], reg = linkScope();
  const seq = ++lsSeq;
  let rows = [];
  try { rows = await searchLinks(kind, q, reg); } catch (e) { return; }
  // still the word being typed (not an older, shorter one)
  const now = /(^|\s)([#!$%])([^\s#!$%]{0,40})$/.exec(BOX.textBefore());
  if (seq !== lsSeq || !now || now[2] + now[3] !== token) return;
  BOX.saveRange();
  const where = reg ? ` in ${(C.projects[reg] || {}).short || (C.projects[reg] || {}).name || "this project"}` : "";
  const el = pop(box, scopeChips(reg)
    + (rows.length ? `<div class="lk-h muted">${esc(sym)} ${LINK_SAY[kind]}${esc(where)} - pick one to link it</div>` + rows.map(rowHtml).join("")
      : `<div class="po-empty muted">No ${LINK_SAY[kind]}${q ? ` matching "${esc(q)}"` : ""}${esc(where)}</div>`), 360);
  el.classList.add("lk-pop");
  kbFirst(el);
  // nothing in the list takes the focus (or the caret) from the message box
  el.addEventListener("pointerdown", (ev) => ev.preventDefault());
  el.addEventListener("click", (ev) => {
    const pc = ev.target.closest(".lk-pc");
    if (pc) { setScope(pc.dataset.reg); BOX.restoreRange(); inlineLinks(sym, q); return; }
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    BOX.restoreRange();
    BOX.replaceBefore(token.length, "");
    putLink(rows[Number(r.dataset.v)]);
  });
}

function wirePickers() {
  const box = $("#c-text");
  box.addEventListener("input", () => {
    const upto = BOX.textBefore();
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
    const lm = /(^|\s)([#!$%])([^\s#!$%]{0,40})$/.exec(upto);
    clearTimeout(lsTimer);
    if (lm && C.room) {
      const q = lm[3];
      lsTimer = setTimeout(() => inlineLinks(lm[2], q), q ? 160 : 0);
      return;
    }
    // nothing to pick: a list of people or links goes (the emoji panel stays)
    const pickerOpen = () => { const o = document.querySelector(".t-pop"); return o && !o.classList.contains("ej-pop"); };
    if (!m || !C.room) { if (pickerOpen()) closePop(); return; }
    const q = m[2].toLowerCase();
    const pool = C.people.filter((p) => !C.room.members || C.room.kind === "task" || C.room.members.includes(p.uid));
    const opts = pool.filter((p) => p.uid !== C.uid && p.name.toLowerCase().includes(q)).slice(0, 8);
    if (!opts.length) { if (pickerOpen()) closePop(); return; }
    BOX.saveRange();
    const el = pickOne(box, opts.map((p) => ({ value: p.name, label: avatar(p) + " " + esc(p.name) })), "", (name) => {
      BOX.restoreRange();
      BOX.replaceBefore(m[2].length + 1, "@" + name + "\u00a0");
    });
    el.addEventListener("pointerdown", (ev) => ev.preventDefault());
    kbFirst(el);
    setTimeout(() => { if (document.activeElement !== box) BOX.restoreRange(); }, 0);
  });
}

/* WhatsApp lines pasted: send them as one quote, if that is what is wanted.
   True when it took them. */
function pastedWhatsApp(t) {
  if (!C.room || C.room.kind === "task") return false;
  const lines = parseWhatsApp(t);
  if (lines.length < 2) return false;
  if (!confirm(`These look like ${lines.length} messages copied from WhatsApp. Send them as a WhatsApp quote?\n\n(Cancel: paste them as plain text.)`)) return false;
  sendCard({ type: "whatsapp", title: "From WhatsApp", lines });
  return true;
}

/* The arrow keys move through an open list; Enter or Tab picks. */
function kbFirst(el) {
  const first = el && el.querySelector(".po-row");
  if (first) first.classList.add("kb");
}
function kbNav(ev) {
  const el = document.querySelector(".t-pop:not(.ej-pop)");
  if (!el || !["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(ev.key) || ev.ctrlKey || ev.metaKey) return false;
  const rows = [...el.querySelectorAll(".po-row")];
  if (!rows.length) return false;
  let i = rows.findIndex((r) => r.classList.contains("kb"));
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (i >= 0) rows[i].classList.remove("kb");
    i = ev.key === "ArrowDown" ? (i + 1) % rows.length : (i <= 0 ? rows.length - 1 : i - 1);
    rows[i].classList.add("kb");
    rows[i].scrollIntoView({ block: "nearest" });
  } else {
    (rows[i >= 0 ? i : 0]).click();
  }
  ev.preventDefault();
  return true;
}

/* The # button: the same lists, with tabs, for a phone (or anyone who does
   not remember the symbols). */
function linkMenu(anchor) {
  BOX.saveRange();
  const tabs = [["task", "# Task"], ["issue", "! Issue"], ["sheet", "$ Sheet"], ["model", "% 3D"]];
  const cur = linkScope();
  const el = pop(anchor && anchor.nodeType ? anchor : $("#c-linkbtn"), `<label class="lk-ps">Project <select class="lk-psel">${scopeList().map(([id, n]) => `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`
    + `<div class="lk-tabs">${tabs.map(([k, l], i) => `<button type="button" class="ghost${i ? "" : " on"}" data-k="${k}">${l}</button>`).join("")}</div>`
    + `<input class="lk-q" placeholder="Search" autocomplete="off"><div class="lk-list"><p class="muted">Loading ...</p></div>`, 360);
  el.classList.add("lk-pop");
  let kind = "task", rows = [], seq = 0, timer = null;
  const q = el.querySelector(".lk-q"), list = el.querySelector(".lk-list"), psel = el.querySelector(".lk-psel");
  psel.onchange = () => { setScope(psel.value); run(); };
  const run = async () => {
    const n = ++seq;
    try { rows = await searchLinks(kind, q.value.trim(), psel.value); } catch (e) { list.innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
    if (n !== seq) return;
    list.innerHTML = rows.length ? rows.map(rowHtml).join("") : `<p class="muted">No ${LINK_SAY[kind]} found${psel.value ? " in this project" : ""}.</p>`;
  };
  el.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-k]");
    if (t) {
      kind = t.dataset.k;
      for (const b of el.querySelectorAll("[data-k]")) b.classList.toggle("on", b === t);
      run();
      return;
    }
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    BOX.restoreRange();
    putLink(rows[Number(r.dataset.v)]);
  });
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 160); };
  q.onkeydown = (ev) => {
    if (ev.key === "Enter" && rows.length) { ev.preventDefault(); closePop(); BOX.restoreRange(); putLink(rows[0]); }
  };
  if (matchMedia("(hover: hover)").matches) q.focus();
  run();
}

/* WhatsApp's "Export chat" (.txt, or .zip with the pictures): one quote. */
async function importWhatsApp(file) {
  if (!C.room || C.room.kind === "task") return;
  let ex;
  try { ex = await readExport(file); } catch (e) { return toast(e.message, true); }
  const big = ex.media.filter((f) => f.size > 50 * 1024 * 1024);
  const media = ex.media.filter((f) => f.size <= 50 * 1024 * 1024).slice(0, 200);
  if (!confirm(`Bring ${ex.lines.length} WhatsApp messages${media.length ? ` and ${media.length} picture${media.length === 1 ? "" : "s"} / file${media.length === 1 ? "" : "s"}` : ""} into "${C.room.title}"?`
    + (big.length ? `\n\n${big.length} file(s) over 50 MB are left out.` : ""))) return;
  const room = C.room, got = [];
  for (let i = 0; i < media.length; i++) {
    toast(`Uploading ${i + 1} of ${media.length} ...`);
    try { got.push(await upload(media[i], { room: room.id }, media[i].name)); } catch (e) { /* that one is listed as not brought in */ }
  }
  if (!C.room || C.room.id !== room.id) await openRoom(room.id);
  await sendCard({ type: "whatsapp", title: ex.title, lines: ex.lines }, got);
  toast("WhatsApp chat brought in");
}

/* Copy: the words as they read, links as "label: address". The clipboard
   API needs https; on the office network (plain http) the old way works. */
async function copyMsg(m) {
  if (!m) return;
  const text = waText(m, "");
  let done = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); done = true; } catch (e) {}
  }
  if (!done) {
    const t = document.createElement("textarea");
    t.value = text;
    t.setAttribute("readonly", "");
    t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(t);
    t.select();
    t.setSelectionRange(0, text.length);
    try { done = document.execCommand("copy"); } catch (e) {}
    t.remove();
  }
  toast(done ? "Copied" : "Could not copy - select the text and copy it", !done);
  closePop();
  for (const x of document.querySelectorAll(".c-msg.show-acts")) x.classList.remove("show-acts");
}

/* Reactions: the quick ones, and + for the rest. */
function reactMenu(btn, mid) {
  const el = pop(btn, `<div class="rx-quick">${QUICK.map((e) => `<button type="button" class="ej" data-e="${e}">${e}</button>`).join("")}`
    + `<button type="button" class="ghost rx-more" title="More">${ic("plus")}</button></div>`, 280);
  el.classList.add("rx-pop");
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-e]");
    if (b) { closePop(); react(mid, b.dataset.e); return; }
    if (ev.target.closest(".rx-more")) emojiPicker(btn, (e) => react(mid, e));
  });
}

async function react(mid, e) {
  const m = C.msgs.find((x) => x.id === mid);
  if (!m) return;
  // shown at once; the server's answer settles it
  const rs = Object.assign({}, m.reactions || {});
  const us = (rs[e] || []).slice();
  const i = us.indexOf(C.uid);
  if (i >= 0) us.splice(i, 1); else us.push(C.uid);
  if (us.length) rs[e] = us; else delete rs[e];
  m.reactions = rs;
  paintMsgs(false);
  try {
    const r = await api(`/api/chat/messages/${mid}/react`, { method: "POST", body: JSON.stringify({ emoji: e }) });
    Object.assign(m, r, { reactions: r.reactions || {} });
    if (!Undo.replaying()) Undo.record({ label: "reaction " + e, undo: () => react(mid, e), redo: () => react(mid, e) });
  } catch (err) { toast(err.message, true); }
  paintMsgs(false);
}

/* ------------------------------------------------------------ sync */

/* wait: hold the request open (seconds) until something changes. Resolves
   true when something did. */
async function sync(wait) {
  const r = await api("/api/chat/sync?since=" + C.rev + (wait && C.rev ? "&wait=" + wait : ""));
  const first = !C.rev;
  const changed = r.rev !== C.rev;
  C.rev = r.rev;
  if (first || !changed) return changed;
  let roomsChanged = false;
  for (const x of r.rooms) {
    const i = C.rooms.findIndex((y) => y.id === x.id);
    roomsChanged = true;
    if (x.deleted) {
      if (i >= 0) C.rooms.splice(i, 1);
      forget(x.id);
      closeRoom(x.id);
      continue;
    }
    if (i >= 0) C.rooms[i] = x; else C.rooms.unshift(x);
  }
  let mine = false;
  let pins = false;
  for (const m of r.messages) {
    if (!C.room || m.room !== C.room.id) continue;
    const i = C.msgs.findIndex((y) => y.id === m.id);
    if (m.pinned || (i >= 0 && C.msgs[i].pinned) || m.deleted || (m.kind === "system" && / pinned a message$/.test(m.body || ""))) pins = true;
    if (i >= 0) C.msgs[i] = m;
    else if (C.newer) continue;             // looking at older messages: "go to the latest" shows them
    else {
      // my own message, back before the send itself has answered
      const t = m.uid === C.uid ? C.msgs.findIndex((y) => y.pending && (y.body || "") === (m.body || "")) : -1;
      if (t >= 0) C.msgs.splice(t, 1);
      C.msgs.push(m);
    }
    mine = true;
  }
  if (roomsChanged) {
    C.rooms.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
    if (C.room) {
      const cur = C.rooms.find((x) => x.id === C.room.id);
      if (cur && C.room.kind !== "task") { Object.assign(C.room, cur); }
    }
  }
  if (mine) {
    C.msgs.sort((a, b) => a.seq - b.seq);
    paintMsgs(false);
    markRead();
  }
  if (pins) loadPins();
  if (roomsChanged && C.room && (C.room.kind === "project" || C.room.kind === "topic")) paintTopics();
  if (roomsChanged) { paintRooms(); keep("rooms", { rooms: C.rooms, joinable: C.joinable }); }
  return true;
}

/* Always one request waiting for the next change. A server too old to hold
   it (answers at once with nothing new) is asked every 3 seconds instead;
   a hidden page asks less often. */
async function syncLoop() {
  let fails = 0;
  for (;;) {
    const t0 = Date.now();
    let changed = false;
    try { changed = await sync(document.hidden ? 0 : 25); fails = 0; } catch (e) { fails++; }
    if (fails) await sleep(Math.min(20000, 2000 * fails));
    else if (document.hidden) await sleep(10000);
    else if (!changed && Date.now() - t0 < 1500) await sleep(3000);
  }
}

/* a task discussion has no sync of its own: look again now and then */
setInterval(async () => {
  if (document.hidden || !C.room || C.room.kind !== "task") return;
  try {
    const r = await api("/api/tasks/" + encodeURIComponent(C.room.task.id));
    const sig = (l) => JSON.stringify(l.map((c) => [c.id, c.body, c.edited_at || ""]));
    if (!C.editing && sig(r.comments) !== sig(C.msgs.filter((x) => !x.pending && !x.failed))) {
      C.msgs = r.comments.map((c) => ({ id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files || [], edited_at: c.edited_at || "", created_at: c.created_at, kind: "text" }));
      paintMsgs(false);
    }
  } catch (e) {}
}, 6000);

/* ------------------------------------------------------------ new chats, members, files */

async function newChat() {
  const projects = Object.values(C.projects).filter((p) => !C.rooms.some((r) => r.kind === "project" && r.project === p.id)
    && !C.joinable.some((r) => r.project === p.id));
  const chans = C.rooms.filter((r) => r.kind === "project");
  const f = modal("New chat", `
    <label class="row-check"><input type="radio" name="k" value="dm" checked> Direct message</label>
    <label class="row-check"><input type="radio" name="k" value="group"> Group chat</label>
    ${projects.length ? `<label class="row-check"><input type="radio" name="k" value="project"> Project channel</label>` : ""}
    ${chans.length ? `<label class="row-check"><input type="radio" name="k" value="topic"> Topic in a project channel</label>` : ""}
    <div class="nc-dm"><label>With <select name="user">${C.people.filter((p) => p.uid !== C.uid).map((p) => `<option value="${p.uid}">${esc(p.name)}${p.team ? " · " + esc(p.team) : ""}</option>`).join("")}</select></label></div>
    <div class="nc-group" hidden><label>Name <input name="title" placeholder="e.g. SKW modelling team"></label>
      <label>People <div class="nc-people td-v act"><span class="muted">choose</span></div></label></div>
    <div class="nc-project" hidden><label>Project <select name="project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.short || p.name)}${p.code ? " · " + esc(p.code) : ""}</option>`).join("")}</select></label>
      <p class="muted" style="font-size:11px">Everyone on the project (its owners, viewer project members and task list members) is added. Task and issue updates are posted into it.</p></div>
    <div class="nc-topic" hidden><label>Channel <select name="parent">${chans.map((r) => `<option value="${esc(r.id)}"${C.room && (C.room.id === r.id || C.room.parent === r.id) ? " selected" : ""}>${esc(r.title)}</option>`).join("")}</select></label>
      <label>Topic <input name="ttitle" maxlength="80" placeholder="e.g. Facade, MEP coordination"></label>
      <p class="muted" style="font-size:11px">A sub-channel for one subject. Everyone in the channel is added.</p></div>`, "Start");
  const form = document.querySelector(".t-modal");
  let chosen = [];
  const show = () => {
    const k = form.querySelector("input[name=k]:checked").value;
    form.querySelector(".nc-dm").hidden = k !== "dm";
    form.querySelector(".nc-group").hidden = k !== "group";
    form.querySelector(".nc-project").hidden = k !== "project";
    form.querySelector(".nc-topic").hidden = k !== "topic";
  };
  for (const r of form.querySelectorAll("input[name=k]")) r.onchange = show;
  form.querySelector(".nc-people").onclick = (ev) => pickPeople(ev.currentTarget, chosen, C.people.filter((p) => p.uid !== C.uid), (v) => {
    chosen = v;
    form.querySelector(".nc-people").innerHTML = v.map((p) => esc(p.name)).join(", ") || `<span class="muted">choose</span>`;
  });
  const done = await f;
  if (!done) return;
  const k = done.querySelector("input[name=k]:checked").value;
  const body = k === "dm" ? { kind: "dm", user: Number(done.user.value) }
    : k === "group" ? { kind: "group", title: done.title.value, members: chosen.map((p) => p.uid) }
      : k === "topic" ? { kind: "topic", parent: done.parent.value, title: done.ttitle.value }
        : { kind: "project", project: done.project.value };
  try {
    const r = await api("/api/chat/rooms", { method: "POST", body: JSON.stringify(body) });
    await loadRooms();
    openRoom(r.id);
  } catch (e) { toast(e.message, true); }
}

/* Chat info: what it is for (the description, as in WhatsApp), who is in
   it, and leaving or deleting it. */
function info(rr) {
  const r = rr || C.room;
  const box = $("#c-right");
  if (!rr && !box.hidden && box.dataset.v === "i") { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.v = "i";
  const admin = r.role === "admin" || C.me.site_admin || (r.kind !== "group" && r.kind !== "dm" && r.can_delete);
  const list = (r.members || []).map((u) => C.byUid[u] || { uid: u, name: "?" })
    .sort((a, b) => (b.uid === C.uid) - (a.uid === C.uid) || a.name.localeCompare(b.name));
  const p = r.kind === "project" || r.kind === "topic" ? C.projects[r.project] : null;
  const topics = r.kind === "project" ? C.rooms.filter((t) => t.kind === "topic" && t.parent === r.id) : [];
  box.innerHTML = `<div class="cp-h"><b>${r.kind === "task" ? "Task discussion" : r.kind === "dm" ? "Direct message" : "Chat info"}</b><span class="spacer"></span>`
    + `<button class="ghost" data-x title="Close">${ic("close")}</button></div>`
    + `<div class="ci-top">${roomIcon(r)}<div><b>${esc(r.title)}</b><small class="muted">${r.kind === "project" ? "Project channel" + (p && p.code ? " · " + esc(p.code) : "") : r.kind === "topic" ? "Topic in " + esc(roomTitle(r.parent) || "the project channel") : r.kind === "group" ? "Group" : r.kind === "dm" ? "Direct message" : ""}</small></div></div>`
    + (r.kind !== "dm" && r.kind !== "task" ? `<div class="ci-sec"><div class="ci-h">Description${admin ? ` <button class="ghost linkish" data-desc>edit</button>` : ""}</div>`
      + `<div class="ci-desc">${r.description ? textHtml(r.description) : `<span class="muted">${admin ? "Say what this chat is for - its rules, key links, who to ask." : "No description."}</span>`}</div></div>` : "")
    + (r.created_by ? `<div class="ci-sec muted" style="font-size:11px">Started by ${esc(r.created_by)} · ${esc(fmtWhen(r.created_at))}</div>` : "")
    + (r.kind === "project" ? `<div class="ci-sec"><div class="ci-h">Topics <span class="muted">${topics.length}</span></div>`
      + topics.map((t) => `<a class="ci-topic" data-open="${esc(t.id)}"># ${esc(t.title)}</a>`).join("")
      + `<button class="ghost linkish" data-newtopic="${esc(r.id)}">${ic("plus", 13)} New topic</button></div>` : "")
    + (r.kind !== "task" ? `<div class="ci-sec"><div class="ci-h">Pinned <span class="muted">${C.room && C.room.id === r.id ? (C.pins || []).length : ""}</span></div>`
      + (C.room && C.room.id === r.id && C.pins.length ? `<button class="ghost linkish" data-pall>Show the pinned messages</button>` : `<span class="muted" style="font-size:12px">Pin a message from its ⋯ menu: everyone sees it at the top.</span>`) + `</div>` : "")
    + `<div class="ci-sec"><div class="ci-h">${r.kind === "task" ? "Followers" : "Members"} <span class="muted">${list.length}</span></div>`
    + list.map((u) => `<div class="cp-p">${avatar(u, 30)}<span class="cp-n"><b>${esc(u.name)}${u.uid === C.uid ? " <small class=\"muted\">(you)</small>" : ""}</b>`
      + `<small class="muted">${esc([u.team, u.office].filter(Boolean).join(" · "))}</small></span>`
      + (u.uid !== C.uid ? `<button class="ghost" data-dm="${u.uid}" title="Direct message">${ic("chat")}</button>` : "")
      + (r.kind !== "task" && r.kind !== "dm" && u.uid !== C.uid && admin ? `<button class="ghost" data-rm="${u.uid}" title="Remove from the chat">${ic("close")}</button>` : "")
      + `</div>`).join("")
    + (r.kind !== "task" && r.kind !== "dm" ? `<button class="cp-add icon-btn">${ic("plus")} Add people</button>` : "") + `</div>`
    + (r.kind !== "task" ? `<div class="ci-sec ci-actions">`
      + `<button class="ghost icon-btn" data-files>${ic("clip")} Pictures and files</button>`
      + (() => {
        // notifications for this chat (notify.js): a muted chat stays quiet unless I'm @mentioned
        const muted = window.LWKNotify && window.LWKNotify.state().muted.includes(r.id);
        return `<button class="ghost icon-btn" data-mute="${muted ? 0 : 1}">${ic(muted ? "bell" : "belloff")} ${muted ? "Unmute notifications" : "Mute notifications"}</button>`;
      })()
      + `<button class="ghost icon-btn" data-wa-in title="WhatsApp > the chat > More > Export chat: send the .txt or .zip here">${ic("download")} Import WhatsApp chat</button>`
      + (r.kind !== "dm" ? `<button class="ghost icon-btn" data-leave>${ic("exit")} Leave this chat</button>` : "")
      + (r.can_delete ? `<button class="ghost danger icon-btn" data-delroom>${ic("trash")} Delete this ${r.kind === "topic" ? "topic" : "chat"}</button>` : "")
      + `</div>` : "");
  box.onclick = async (ev) => {
    if (ev.target.closest("[data-x]")) { box.hidden = true; return; }
    const rm = ev.target.closest("[data-rm]"), dm = ev.target.closest("[data-dm]");
    try {
      const mu = ev.target.closest("[data-mute]");
      if (mu && window.LWKNotify) {
        const on = mu.dataset.mute === "1";
        await window.LWKNotify.muteRoom(r.id, on);
        toast(on ? "Muted - you hear about this chat only when @mentioned" : "Notifications on for this chat");
        mu.dataset.mute = on ? "0" : "1";
        mu.innerHTML = `${ic(on ? "bell" : "belloff")} ${on ? "Unmute notifications" : "Mute notifications"}`;
        return;
      }
      if (ev.target.closest("[data-desc]")) {
        const f = await modal("Description of " + r.title, `<textarea name="d" rows="6" maxlength="2000" placeholder="What is this chat for? Rules, key links, who to ask ...">${esc(r.description || "")}</textarea>`
          + (r.kind !== "dm" ? `<label>Name <input name="t" value="${esc(r.title)}" maxlength="80"></label>` : ""), "Save");
        if (!f) return;
        await api(`/api/chat/rooms/${r.id}`, { method: "PATCH", body: JSON.stringify({ description: f.d.value, title: f.t ? f.t.value : r.title }) });
        r.description = f.d.value; if (f.t) r.title = f.t.value || r.title;
        if (C.room && C.room.id === r.id) paintHead();
        await loadRooms(); info(r);
      }
      if (rm) {
        await api(`/api/chat/rooms/${r.id}/members`, { method: "PUT", body: JSON.stringify({ remove: [Number(rm.dataset.rm)] }) });
        r.members = r.members.filter((u) => u !== Number(rm.dataset.rm));
        info(r);
      }
      if (dm) {
        const x = await api("/api/chat/rooms", { method: "POST", body: JSON.stringify({ kind: "dm", user: Number(dm.dataset.dm) }) });
        await loadRooms(); openRoom(x.id);
      }
      if (ev.target.closest(".cp-add")) {
        pickPeople(ev.target.closest(".cp-add"), [], C.people.filter((p) => !r.members.includes(p.uid)), async (v) => {
          const add = v.map((p) => p.uid).filter((u) => !r.members.includes(u));
          if (!add.length) return;
          await api(`/api/chat/rooms/${r.id}/members`, { method: "PUT", body: JSON.stringify({ add }) });
          r.members = r.members.concat(add);
          if (C.room && C.room.id === r.id) paintHead();
        });
      }
      if (ev.target.closest("[data-files]")) { box.dataset.v = ""; files(); }
      const op = ev.target.closest("[data-open]");
      if (op) openRoom(op.dataset.open);
      const nt = ev.target.closest("[data-newtopic]");
      if (nt) await newTopic(nt.dataset.newtopic);
      if (ev.target.closest("[data-pall]")) pinsPanel();
      if (ev.target.closest("[data-wa-in]")) $("#c-wa-file").click();
      if (ev.target.closest("[data-leave]")) await leave(r);
      if (ev.target.closest("[data-delroom]")) await removeRoom(r);
    } catch (e) { toast(e.message, true); }
  };
}

async function leave(r) {
  if (!confirm("Leave " + r.title + "? You can be added back by anyone in it.")) return;
  await api(`/api/chat/rooms/${r.id}/members`, { method: "PUT", body: JSON.stringify({ remove: [C.uid] }) });
  closeRoom(r.id);
  await loadRooms();
}

async function removeRoom(r) {
  const n = r.kind === "project" ? C.rooms.filter((t) => t.kind === "topic" && t.parent === r.id).length : 0;
  if (!confirm(r.kind === "dm" ? `Delete this conversation with ${r.title}? It goes for both of you.`
    : `Delete "${r.title}" for everyone? Its messages will no longer be shown to anyone.${n ? `\n\nIts ${n} topic${n === 1 ? "" : "s"} go${n === 1 ? "es" : ""} too.` : ""}`)) return;
  await api(`/api/chat/rooms/${r.id}`, { method: "DELETE" });
  closeRoom(r.id);
  await loadRooms();
  toast("Chat deleted");
}

function closeRoom(id) {
  if (!C.room || C.room.id !== id) return;
  C.room = null;
  $("#c-conv").hidden = true; $("#c-empty").hidden = false; $("#c-right").hidden = true;
  $("#c-app").classList.remove("in-room");
  history.replaceState(null, "", "messenger.html");
}

/* Forward a message: choose the chats, add a line if you like. */
async function forwardMsg(m) {
  const rooms = C.rooms.filter((r) => !C.room || r.id !== C.room.id);
  if (!rooms.length) return toast("No other chat to forward to - start one first", true);
  const p = modal("Forward to", `<div class="fw-prev">${esc((m.body || (m.card && (m.card.title || (m.card.inner || {}).title)) || (m.files[0] || {}).name || "").slice(0, 160))}</div>`
    + `<input class="fw-q" placeholder="Search chats">`
    + `<div class="fw-list">${rooms.map((r) => `<label class="fw-row">`
      + `<input type="checkbox" value="${esc(r.id)}">${roomIcon(r)}<span><b>${esc(r.title)}</b><small class="muted">${r.kind === "project" ? "Project channel" : r.kind === "topic" ? "Topic in " + esc(roomTitle(r.parent)) : r.kind === "dm" ? "Direct message" : "Group"}</small></span></label>`).join("")}</div>`
    + `<label>Add a message <input name="note" placeholder="optional"></label>`, "Forward");
  const form = document.querySelector(".t-modal");
  form.querySelector(".fw-q").oninput = (ev) => {
    const q = ev.target.value.toLowerCase();
    for (const row of form.querySelectorAll(".fw-row")) row.hidden = q && !row.textContent.toLowerCase().includes(q);
  };
  const f = await p;
  if (!f) return;
  const ids = [...f.querySelectorAll(".fw-row input:checked")].map((i) => i.value);
  if (!ids.length) return toast("Choose at least one chat", true);
  try {
    const r = await api(`/api/chat/messages/${m.id}/forward`, { method: "POST", body: JSON.stringify({ rooms: ids, note: f.note.value }) });
    toast(`Forwarded to ${r.sent.length} chat${r.sent.length === 1 ? "" : "s"}`);
  } catch (e) { toast(e.message, true); }
}

/* Right-click (or long-press) a chat in the list. */
function roomMenu(ev, id) {
  const r = C.rooms.find((x) => x.id === id);
  if (!r) return;
  ev.preventDefault();
  const el = pop(ev.target.closest(".cr"), `<div class="po-row" data-k="open">${ic("chat")} Open</div>`
    + `<div class="po-row" data-k="info">${ic("info")} Details</div>`
    + (r.unread ? `<div class="po-row" data-k="read">${ic("read")} Mark as read</div>` : "")
    + `<div class="po-row" data-k="wa-in">${ic("download")} Import WhatsApp chat ...</div>`
    + `<div class="po-row" data-k="wa-out">${ic("whatsapp")} Send chat link to WhatsApp</div>`
    + (r.kind !== "dm" ? `<div class="po-row" data-k="leave">${ic("exit")} Leave</div>` : "")
    + (r.kind === "project" ? `<div class="po-row" data-k="topic">${ic("hash")} New topic</div>` : "")
    + (r.can_delete ? `<div class="po-row bad" data-k="del">${ic("trash")} Delete ${r.kind === "topic" ? "topic" : "chat"}</div>` : ""), 200);
  // where it was asked for, but wholly on screen (it is taller with more rows)
  el.style.bottom = "";
  el.style.left = Math.max(4, Math.min(innerWidth - el.offsetWidth - 8, ev.clientX)) + "px";
  el.style.top = Math.max(4, Math.min(innerHeight - el.offsetHeight - 8, ev.clientY)) + "px";
  el.onclick = async (e) => {
    const k = (e.target.closest(".po-row") || {}).dataset;
    if (!k) return;
    closePop();
    try {
      if (k.k === "open") openRoom(r.id);
      if (k.k === "info") { if (!C.room || C.room.id !== r.id) await openRoom(r.id); info(C.room); }
      if (k.k === "read") {
        await api(`/api/chat/rooms/${r.id}/read`, { method: "POST", body: JSON.stringify({ seq: r.last_seq }) });
        r.unread = 0; r.mention = 0; paintRooms();
      }
      if (k.k === "leave") await leave(r);
      if (k.k === "del") await removeRoom(r);
      if (k.k === "topic") await newTopic(r.id);
      if (k.k === "wa-in") { if (!C.room || C.room.id !== r.id) await openRoom(r.id); $("#c-wa-file").click(); }
      if (k.k === "wa-out") await toWhatsApp({ body: `${r.title} - LWK Viewer chat\n` + new URL("messenger.html?room=" + encodeURIComponent(r.id), location.href).href });
    } catch (err) { toast(err.message, true); }
  };
}

async function files() {
  const box = $("#c-right");
  if (!box.hidden && box.dataset.v === "f") { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.v = "f";
  box.innerHTML = `<p class="muted">Loading ...</p>`;
  const r = await api(`/api/chat/rooms/${C.room.id}/files`);
  box.innerHTML = `<div class="cp-h"><b>Files</b> <span class="muted">${r.files.length}</span><span class="spacer"></span><button class="ghost" data-x>&#10005;</button></div>`
    + (r.files.map((f) => `<div class="cp-f">${filesHtml([f])}<small class="muted">${esc(f.author)} · ${esc(ago(f.created_at))}</small></div>`).join("")
      || `<p class="muted">Nothing sent here yet.</p>`);
  box.onclick = (ev) => { if (ev.target.closest("[data-x]")) box.hidden = true; };
}

async function searchMessages(q) {
  const r = await api("/api/chat/search?q=" + encodeURIComponent(q));
  const box = $("#c-right");
  box.hidden = false;
  box.dataset.v = "s";
  const title = (id) => (C.rooms.find((x) => x.id === id) || {}).title || "";
  box.innerHTML = `<div class="cp-h"><b>"${esc(q)}"</b> <span class="muted">${r.messages.length} found</span><span class="spacer"></span><button class="ghost" data-x>&#10005;</button></div>`
    + (r.messages.map((m) => `<a class="cp-s" data-room="${esc(m.room)}" data-msg="${esc(m.id)}"><b>${esc(title(m.room))}</b> <small class="muted">${esc(short(m.created_at))}</small><br>`
      + `<span>${esc(m.author)}: ${esc((plainLabels(m.body || "") || (m.card && (m.card.question || m.card.title)) || (m.files[0] || {}).name || "").slice(0, 160))}</span></a>`).join("") || `<p class="muted">Nothing found.</p>`);
  box.onclick = (ev) => {
    if (ev.target.closest("[data-x]")) { box.hidden = true; return; }
    const a = ev.target.closest("[data-room]");
    if (a) openRoom(a.dataset.room, a.dataset.msg).catch((e) => toast(e.message, true));
  };
}

/* messenger.html?share=<url>&title=... - from a task, an issue, a view */
async function share(url, title) {
  if (!C.rooms.length) return toast("Start a chat first, then share into it", true);
  const f = await modal("Send to a chat", `<p class="muted" style="font-size:12px">${esc(title)}</p>`
    + `<label>Chat <select name="room">${C.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}${r.kind === "project" ? " (project)" : ""}</option>`).join("")}</select></label>`
    + `<label>Message <textarea name="msg" rows="2" placeholder="optional"></textarea></label>`, "Send");
  if (!f) return;
  try {
    await api(`/api/chat/rooms/${f.room.value}/messages`, { method: "POST",
      body: JSON.stringify({ body: (f.msg.value.trim() ? f.msg.value.trim() + "\n" : "") + title + "\n" + url }) });
    await openRoom(f.room.value);
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ wiring */

/* The format buttons, as in Lark. */
const FMT = [
  ["b", "<b class=\"fl\">B</b>", "Bold (Ctrl+B)"],
  ["s", "<s class=\"fl\">S</s>", "Strikethrough (Ctrl+Shift+X)"],
  ["i", "<i class=\"fl\">I</i>", "Italic (Ctrl+I)"],
  ["u", "<u class=\"fl\">U</u>", "Underline (Ctrl+U)"],
  ["|"],
  ["ol", ic("olist", 18), "Numbered list"],
  ["ul", ic("ulist", 18), "Bulleted list"],
  ["quote", ic("quote", 16), "Quote"],
  ["|"],
  ["link", ic("link", 17), "Link"],
  ["code", ic("code", 17), "Code"],
  ["pre", ic("braces", 17), "Block of code"],
];

/* the format buttons light up for what the caret is in */
function paintFmt() {
  const bar = $("#c-fmtbar");
  if (!BOX || bar.hidden) return;
  const st = BOX.states();
  for (const b of bar.querySelectorAll("[data-fmt]")) b.classList.toggle("on", !!st[b.dataset.fmt]);
}

async function linkForm() {
  BOX.saveRange();
  const r = BOX.saved;
  const sel = r && !r.collapsed ? r.toString() : "";
  const f = await modal("Link", `<label>Address <input name="u" placeholder="https://..." value="${esc(/^https?:\/\//.test(sel) ? sel : "")}" required></label>`
    + `<label>Text <input name="t" value="${esc(/^https?:\/\//.test(sel) ? "" : sel)}" placeholder="optional - the address shows when empty"></label>`, "Add link");
  if (!f || !f.u.value.trim()) { BOX.restoreRange(); return; }
  BOX.link(f.u.value.trim(), f.t.value.trim());
}

function icons() {
  $("#c-back").innerHTML = ic("back", 20) + `<span>Chats</span>`;
  $("#c-files-btn").innerHTML = ic("clip") + `<span class="lab">Files</span>`;
  $("#c-members-btn").innerHTML = ic("users") + ` <span id="c-mcount"></span>`;
  $("#c-members-btn").title = "Chat info and members";
  $("#c-new").innerHTML = ic("compose", 18);
  $("#c-attach").innerHTML = ic("clip", 19);
  $("#c-plus").innerHTML = ic("pluscircle", 19);
  $("#c-fmt").innerHTML = `<span class="aa">A<small>a</small></span>`;
  $("#c-at").innerHTML = ic("at", 19);
  $("#c-linkbtn").innerHTML = ic("hash", 18);
  $("#c-expand").innerHTML = ic("expand", 17);
  $("#c-fmtbar").innerHTML = FMT.map(([k, label, title]) => k === "|" ? `<span class="cb-sep"></span>`
    : `<button type="button" class="cb-b" data-fmt="${k}" title="${title}">${label}</button>`).join("");
  $("#c-emoji").innerHTML = ic("smile", 19);
  $("#c-send").innerHTML = ic("sendfill", 20) + `<span class="lab">Send</span>`;
}

function wire() {
  icons();
  $("#c-rooms").onclick = async (ev) => {
    const j = ev.target.closest("[data-join]");
    if (j) {
      try { await api(`/api/chat/rooms/${j.dataset.join}/join`, { method: "POST", body: "{}" }); await loadRooms(); openRoom(j.dataset.join); }
      catch (e) { toast(e.message, true); }
      return;
    }
    const a = ev.target.closest("[data-room]");
    if (a) openRoom(a.dataset.room).catch((e) => toast(e.message, true));
  };
  $("#c-q").oninput = (ev) => { C.q = ev.target.value; paintRooms(); };
  $("#c-q").onkeydown = (ev) => { if (ev.key === "Enter" && C.q.trim().length > 1) searchMessages(C.q.trim()); };
  $("#c-new").onclick = newChat;
  $("#c-empty-new").onclick = newChat;
  $("#c-send").onclick = send;
  // Enter is a new line (phone and computer alike); the Send button sends,
  // and so does Ctrl+Enter / Cmd+Enter on a keyboard.
  BOX = new RichBox($("#c-text"), { onPaste: pastedWhatsApp });
  $("#c-text").addEventListener("keydown", (ev) => {
    if (kbNav(ev)) return;
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); }
    const fk = formatKey(ev);
    if (fk) { ev.preventDefault(); BOX.format(fk); paintFmt(); }
    if (ev.key === "Escape" && C.reply) { C.reply = null; $("#c-reply").hidden = true; }
  });
  document.addEventListener("selectionchange", () => { if (document.activeElement === $("#c-text")) paintFmt(); });
  // the Send button must not take the focus (a phone's keyboard would close)
  $("#c-send").addEventListener("pointerdown", (ev) => ev.preventDefault());
  // the format bar works on the message box without taking its focus
  // the box's buttons keep the focus (and the caret) in the box
  for (const b of document.querySelectorAll("#c-compose .cb-bar")) b.addEventListener("pointerdown", (ev) => { if (ev.target.closest("button")) ev.preventDefault(); });
  $("#c-fmtbar").onclick = (ev) => {
    const b = ev.target.closest("[data-fmt]");
    if (!b) return;
    if (b.dataset.fmt === "link") return linkForm();
    BOX.format(b.dataset.fmt);
    paintFmt();
  };
  const showFmt = (on) => {
    $("#c-fmtbar").hidden = !on;
    $("#c-fmt").classList.toggle("on", on);
    $("#c-compose").classList.toggle("fmt-on", on);
    paintFmt();
  };
  $("#c-fmt").onclick = () => {
    const on = $("#c-fmtbar").hidden;
    showFmt(on);
    try { localStorage.setItem("lwk-viewer:chat-fmt", on ? "1" : "0"); } catch (e) {}
  };
  // on at first on a computer, off on a phone (room for the words), then as left
  let fmtPref = null;
  try { fmtPref = localStorage.getItem("lwk-viewer:chat-fmt"); } catch (e) {}
  showFmt(fmtPref ? fmtPref === "1" : matchMedia("(hover: hover) and (min-width: 700px)").matches);
  $("#c-at").onclick = () => { if (!BOX.range()) BOX.caretToEnd(); BOX.insertText((/\S$/.test(BOX.textBefore()) ? " " : "") + "@"); };
  $("#c-expand").onclick = () => {
    const big = $("#c-compose").classList.toggle("big");
    $("#c-expand").innerHTML = ic(big ? "shrink" : "expand", 17);
    BOX.focus();
  };
  $("#c-plus").onclick = plusMenu;
  $("#c-topics").onclick = async (ev) => {
    const nt = ev.target.closest("[data-newtopic]");
    if (nt) return newTopic(nt.dataset.newtopic);
    const t = ev.target.closest("[data-topic]");
    if (!t) return;
    try {
      if (t.dataset.tjoin) { await api(`/api/chat/rooms/${t.dataset.topic}/join`, { method: "POST", body: "{}" }); await loadRooms(); }
      await openRoom(t.dataset.topic);
    } catch (e) { toast(e.message, true); }
  };
  $("#c-pins").onclick = (ev) => {
    if (ev.target.closest("[data-pall]")) return pinsPanel();
    const j = ev.target.closest("[data-pjump]");
    if (!j) return;
    jumpTo(j.dataset.pjump);
    if (C.pins.length > 1) { C.pinAt = (C.pinAt + 1) % C.pins.length; paintPins(); }
  };
  wirePickers();
  $("#c-linkbtn").onclick = () => linkMenu();
  $("#c-emoji").onclick = () => {
    BOX.saveRange();
    emojiPicker($("#c-emoji"), (e) => { BOX.restoreRange(); BOX.insertText(e); BOX.saveRange(); }, true);
  };
  $("#c-wa-file").onchange = (ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; if (f) importWhatsApp(f); };
  $("#c-attach").onclick = () => $("#c-file").click();
  $("#c-file").onchange = (ev) => { addFiles(Array.from(ev.target.files || [])); ev.target.value = ""; };
  catchFiles($("#c-text"), addFiles);
  catchFiles($("#c-msgs"), addFiles);
  $("#c-pend").onclick = (ev) => {
    const b = ev.target.closest("[data-unpend]");
    if (b) { C.pend.splice(Number(b.dataset.unpend), 1); paintPend(); }
  };
  $("#c-back").onclick = () => $("#c-app").classList.remove("in-room");
  $("#c-members-btn").onclick = () => info();
  $("#c-head .ch-title").onclick = () => { if (C.room && C.room.kind !== "dm") info(); };
  $("#c-rooms").addEventListener("contextmenu", (ev) => {
    const a = ev.target.closest(".cr[data-room]");
    if (a && !a.dataset.room.startsWith(TASK)) roomMenu(ev, a.dataset.room);
  });
  // a phone: hold a chat for its menu
  let hold = null;
  $("#c-rooms").addEventListener("touchstart", (ev) => {
    const a = ev.target.closest(".cr[data-room]");
    if (!a || a.dataset.room.startsWith(TASK)) return;
    const t = ev.touches[0];
    hold = setTimeout(() => { hold = "fired"; roomMenu({ preventDefault() {}, target: a, clientX: t.clientX, clientY: t.clientY }, a.dataset.room); }, 550);
  }, { passive: true });
  $("#c-rooms").addEventListener("touchend", (ev) => { if (hold === "fired") ev.preventDefault(); clearTimeout(hold); hold = null; });
  $("#c-rooms").addEventListener("touchmove", () => { clearTimeout(hold); hold = null; }, { passive: true });
  $("#c-files-btn").onclick = files;
  $("#c-join-btn").onclick = async () => {
    try { await api(`/api/chat/rooms/${C.room.id}/join`, { method: "POST", body: "{}" }); await loadRooms(); openRoom(C.room.id); }
    catch (e) { toast(e.message, true); }
  };
  $("#c-msgs").onclick = async (ev) => {
    if (ev.target.closest(".c-more")) {
      const r = await api(`/api/chat/rooms/${C.room.id}/messages?limit=60&before=${C.msgs[0].seq}`);
      const box = $("#c-msgs"), h0 = box.scrollHeight;
      C.msgs = r.messages.concat(C.msgs);
      C.more = r.more;
      paintMsgs(false);
      box.scrollTop = box.scrollHeight - h0;
      return;
    }
    if (ev.target.closest("[data-latest]")) return openRoom(C.room.id);
    const pj = ev.target.closest("[data-pjump]");
    if (pj) return jumpTo(pj.dataset.pjump);
    const msgOf = (el, k) => C.msgs.find((x) => x.id === el.dataset[k]);
    const settle = async (m, job) => {
      try { const r = await job; Object.assign(m, r); if (!r.voters) delete m.voters; paintMsgs(false); }
      catch (e) { toast(e.message, true); }
    };
    const vo = ev.target.closest("[data-vote]");
    if (vo) { const m = msgOf(vo, "vote"); return m && settle(m, vote(m, vo.dataset.opt)); }
    const pc = ev.target.closest("[data-pclose]");
    if (pc) {
      const m = msgOf(pc, "pclose");
      if (m && (pc.dataset.on !== "1" || confirm("Close this poll? Nobody can vote after that (you can reopen it)."))) settle(m, closePoll(m, pc.dataset.on === "1"));
      return;
    }
    const rs = ev.target.closest("[data-rsvp]");
    if (rs) { const m = msgOf(rs, "rsvp"); return m && settle(m, rsvp(m, rs.dataset.v)); }
    const ee = ev.target.closest("[data-evedit]");
    if (ee) {
      const m = msgOf(ee, "evedit");
      const c = m && await eventForm(m.card);
      if (c) settle(m, api(`/api/chat/messages/${m.id}/event`, { method: "PATCH", body: JSON.stringify(c) }));
      return;
    }
    const ec = ev.target.closest("[data-evcancel]");
    if (ec) {
      const m = msgOf(ec, "evcancel");
      if (m && confirm(`Cancel "${m.card.title}"? Everyone in the chat is told.`)) settle(m, api(`/api/chat/messages/${m.id}/event`, { method: "PATCH", body: JSON.stringify({ cancelled: true }) }));
      return;
    }
    const fw = ev.target.closest("[data-fwd]");
    if (fw) return forwardMsg(C.msgs.find((x) => x.id === fw.dataset.fwd));
    const rx = ev.target.closest("[data-rx]");
    if (rx) return react(rx.dataset.mid, rx.dataset.rx);
    const ra = ev.target.closest("[data-react]");
    if (ra) return reactMenu(ra, ra.dataset.react);
    const cp = ev.target.closest("[data-copy]");
    if (cp) return copyMsg(C.msgs.find((x) => x.id === cp.dataset.copy));
    const mo = ev.target.closest("[data-more]");
    if (mo) return moreMenu(mo, mo.dataset.more);
    const eb = ev.target.closest("[data-edit]");
    if (eb) return startEdit(eb.dataset.edit);
    const es = ev.target.closest("[data-esave]");
    if (es) return saveEdit(es.dataset.esave);
    if (ev.target.closest("[data-ecancel]")) return stopEdit();
    if (ev.target.closest(".c-edit")) return;
    const wa = ev.target.closest("[data-wa]");
    if (wa) return toWhatsApp(C.msgs.find((x) => x.id === wa.dataset.wa), C.room.title).catch((e) => toast(e.message, true));
    const all = ev.target.closest("[data-wa-all]");
    if (all) { waOpen.add(all.dataset.waAll); return paintMsgs(false); }
    const rt = ev.target.closest("[data-retry]");
    if (rt) { const m = C.msgs.find((x) => x.id === rt.dataset.retry); if (m) deliver(m, C.room, m.card); return paintMsgs(false); }
    const dr = ev.target.closest("[data-drop]");
    if (dr) { C.msgs = C.msgs.filter((x) => x.id !== dr.dataset.drop); return paintMsgs(false); }
    // a phone has no hover: a tap on a message shows its buttons
    const msg = ev.target.closest(".c-msg");
    if (msg && !ev.target.closest("a, button, video, iframe") && matchMedia("(hover: none)").matches) {
      for (const x of document.querySelectorAll(".c-msg.show-acts")) if (x !== msg) x.classList.remove("show-acts");
      msg.classList.toggle("show-acts");
      return;
    }
    const rp = ev.target.closest("[data-reply]");
    if (rp) {
      const m = C.msgs.find((x) => x.id === rp.dataset.reply);
      C.reply = m.id;
      $("#c-reply").hidden = false;
      $("#c-reply").innerHTML = `Replying to <b>${esc(m.author || "Update")}</b>: ${esc(plainLabels(m.body || (m.card && (m.card.question || m.card.title)) || "").slice(0, 80))} <button class="ghost linkish" id="c-noreply">cancel</button>`;
      $("#c-noreply").onclick = () => { C.reply = null; $("#c-reply").hidden = true; };
      $("#c-text").focus();
    }
  };
  // the box a message is changed in
  $("#c-msgs").addEventListener("input", (ev) => {
    const t = ev.target.closest("[data-etext]");
    if (t && t._rb) C.editText = t._rb.value;
  });
  $("#c-msgs").addEventListener("keydown", (ev) => {
    const t = ev.target.closest("[data-etext]");
    if (!t) return;
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); saveEdit(t.dataset.etext); }
    const fk = formatKey(ev);
    if (fk && t._rb) { ev.preventDefault(); t._rb.format(fk); C.editText = t._rb.value; }
    if (ev.key === "Escape") { ev.preventDefault(); stopEdit(); }
  });
}

async function start() {
  const q = new URLSearchParams(location.search);
  /* Signed in on this device before: everything is asked for at once, and
     what the device showed last time is on screen before the server has
     answered anything - the sign-in check included. */
  let last = 0, early = null, opening = null, want = "";
  try { last = Number(localStorage.getItem(CK + "uid")) || 0; } catch (e) {}
  if (last) {
    C.uid = last;
    early = [api("/api/people").catch(() => null), api("/api/chat/rooms").catch(() => null)];
    wire();
    const was = kept("rooms");
    if (was) { C.rooms = was.rooms || []; C.joinable = was.joinable || []; }
    setPeople(kept("people") || []);
    if (was) paintRooms();
    want = q.get("room") || (!q.get("task") && !q.get("share") && !q.get("incoming") && innerWidth > 900 && C.rooms[0] ? C.rooms[0].id : "");
    if (want && C.rooms.some((r) => r.id === want)) opening = openRoom(want).catch(() => null);
  }
  const me = await ensureSignedIn();
  C.me = me;
  header(me);
  if (!me.accounts) {
    $("#c-app").innerHTML = `<div class="t-empty"><h3>The Messenger needs accounts</h3><p>This server runs with a shared passphrase, so it does not know who is who. A site admin can switch accounts on (Admin page).</p></div>`;
    return;
  }
  if (last && last !== me.user.id) {
    // someone else on this device: nothing of the last person's stays
    try { localStorage.setItem(CK + "uid", String(me.user.id)); } catch (e) {}
    location.reload();
    return;
  }
  C.uid = me.user.id;
  try { localStorage.setItem(CK + "uid", String(C.uid)); } catch (e) {}
  if (!last) {
    wire();
    want = q.get("room") || "";
    if (want) opening = openRoom(want).catch(() => null);
  }
  const got = early ? await Promise.all(early) : [];
  const ppl = got[0] || await api("/api/people").catch(() => null);
  const rooms = got[1] || await api("/api/chat/rooms");
  if (ppl) { setPeople(ppl.people || []); keep("people", C.people); }
  C.rooms = rooms.rooms;
  C.joinable = rooms.joinable;
  keep("rooms", { rooms: C.rooms, joinable: C.joinable });
  paintRooms();
  if (C.room && ppl) paintMsgs(false);         // names and @mentions, now known
  loadExtras(true).catch(() => {});
  syncLoop();
  if (q.get("incoming")) await incoming(q.get("incoming"));
  else if (q.get("share")) await share(q.get("share"), q.get("title") || "Link");
  else if (q.get("room")) {
    const id = q.get("room");
    if (!C.rooms.some((r) => r.id === id) && C.joinable.some((r) => r.id === id)) {
      try { await api(`/api/chat/rooms/${id}/join`, { method: "POST", body: "{}" }); await loadRooms(); } catch (e) {}
    }
    if (opening) await opening;
    if (!C.room || C.room.id !== id || q.get("msg")) await openRoom(id, q.get("msg") || "").catch((e) => toast(e.message, true));
    // from the Calendar page's + Event: the event form, in this chat
    if (q.get("new") === "event" && C.room && C.room.id === id) {
      history.replaceState(null, "", "messenger.html?room=" + encodeURIComponent(id));
      // from the Calendar's right-click on a day: that day (and time)
      const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "") ? q.get("date") : "";
      const tm = /^\d{2}:\d{2}$/.test(q.get("time") || "") ? q.get("time") : "";
      const c = await eventForm(null, day ? { start: day + "T" + (tm || "10:00"), all_day: !tm, title: q.get("title") || "" } : null);
      if (c) sendCard(c);
    }
  } else if (q.get("task")) await openRoom(TASK + q.get("task")).catch((e) => toast(e.message, true));
  else if (!opening && C.rooms[0] && innerWidth > 900) await openRoom(C.rooms[0].id);
}

/* Shared from another app (Android: WhatsApp > Share > LWK Viewer). sw.js
   kept what came in; choose the chat, and it waits in the message box. */
async function incoming(id) {
  let meta = null, files = [];
  try {
    const c = await caches.open("lwk-share");
    const r = await c.match(`/__share/${id}/meta`);
    if (r) {
      meta = await r.json();
      for (let i = 0; i < (meta.files || []).length; i++) {
        const f = await c.match(`/__share/${id}/${i}`);
        if (f) files.push(new File([await f.blob()], meta.files[i].name || "shared", { type: meta.files[i].type || "" }));
      }
      for (const k of await c.keys()) if (new URL(k.url).pathname.startsWith(`/__share/${id}/`)) await c.delete(k);
    }
  } catch (e) { /* nothing kept */ }
  history.replaceState(null, "", "messenger.html");
  if (!meta) return toast("Nothing came in - share it again", true);
  if (!C.rooms.length) return toast("Start a chat first, then share into it", true);
  const text = [meta.title, meta.text, meta.url].filter(Boolean).join("\n");
  const f = await modal("Send to a chat", `<p class="muted" style="font-size:12px">${esc(text.slice(0, 200))}${files.length ? `<br>${files.length} file${files.length === 1 ? "" : "s"}: ${esc(files.map((x) => x.name).join(", ").slice(0, 200))}` : ""}</p>`
    + `<label>Chat <select name="room">${C.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}${r.kind === "project" ? " (project)" : ""}</option>`).join("")}</select></label>`, "Next");
  if (!f) return;
  await openRoom(f.room.value);
  const lines = parseWhatsApp(text);
  if (lines.length >= 2 && confirm(`Send these ${lines.length} WhatsApp messages as a WhatsApp quote?`)) {
    const got = [];
    for (const x of files) { try { got.push(await upload(x, { room: C.room.id }, x.name)); } catch (e) {} }
    return sendCard({ type: "whatsapp", title: "From WhatsApp", lines }, got);
  }
  BOX.value = text;
  if (files.length) await addFiles(files);
  toast("Check it and press Send");
}

start().catch((e) => { const m = $("#c-main"); if (m) m.innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`; });
