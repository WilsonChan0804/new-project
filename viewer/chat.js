/* Messenger page (server side: chat.py).
 *
 * Left: the chats - project channels, groups, direct messages - and the
 * task discussions you follow. Middle: the conversation. New messages come
 * from /api/chat/sync every few seconds.
 *
 * A task discussion is the task's own comments (tasks.py), shown here like
 * a chat so nobody has to look in two places.
 */

import { api } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { $, esc, avatar, ago, fmtWhen, pickPeople, pickOne, modal, toast, closePop, ic, pop } from "./tasks-util.js";
import { linkify, badge } from "./filelinks.js";
import { upload, filesHtml, pendingHtml, catchFiles } from "./uploads.js";

const C = {
  me: null, uid: null, people: [], byUid: {}, rooms: [], joinable: [], threads: [], projects: {},
  room: null, msgs: [], more: false, rev: 0, reply: null, pend: [], q: "",
};
const TASK = "task:";

/* ------------------------------------------------------------ loading */

async function loadRooms() {
  const r = await api("/api/chat/rooms");
  C.rooms = r.rooms;
  C.joinable = r.joinable;
  try {
    const t = await api("/api/tasks-mine?view=subscribed");
    C.threads = t.tasks.filter((x) => x.comment_count > 0)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 30);
  } catch (e) { C.threads = []; }
  try {
    const p = await api("/api/registry");
    C.projects = Object.fromEntries(p.projects.map((x) => [x.id, x]));
  } catch (e) { C.projects = {}; }
  paintRooms();
}

function roomIcon(r) {
  if (r.kind === "dm") return avatar({ name: r.title }, 34);
  if (r.kind === "project") return `<span class="c-ico pj">P</span>`;
  if (r.kind === "task") return `<span class="c-ico tk">&#10003;</span>`;
  return `<span class="c-ico gr">&#128101;</span>`;
}

function paintRooms() {
  const q = C.q.trim().toLowerCase();
  const match = (r) => !q || (r.title || "").toLowerCase().includes(q) || (r.last_text || "").toLowerCase().includes(q);
  const row = (r) => `<a class="cr${C.room && C.room.id === r.id ? " on" : ""}${r.unread ? " unread" : ""}" data-room="${esc(r.id)}">`
    + roomIcon(r)
    + `<span class="cr-m"><span class="cr-t"><b>${esc(r.title)}</b><small>${r.last_at ? esc(short(r.last_at)) : ""}</small></span>`
    + `<span class="cr-l">${esc(r.last_text || "")}</span></span>`
    + (r.unread ? `<b class="cr-n${r.mention ? " at" : ""}">${r.mention ? "@" : ""}${r.unread > 99 ? "99+" : r.unread}</b>` : "")
    + `</a>`;
  const sec = (title, list) => list.length ? `<div class="cs-h">${title}</div>` + list.map(row).join("") : "";
  const by = (k) => C.rooms.filter((r) => r.kind === k && match(r));
  const threads = C.threads.filter((t) => !q || t.title.toLowerCase().includes(q)).map((t) => ({
    id: TASK + t.id, kind: "task", title: t.title || "Untitled task", last_text: `${t.list_title} / ${t.group_title} · ${t.comment_count} comment${t.comment_count > 1 ? "s" : ""}`,
    last_at: t.updated_at, task: t }));
  const join = C.joinable.filter(match);
  $("#c-rooms").innerHTML = sec("Project channels", by("project")) + sec("Groups", by("group")) + sec("Direct messages", by("dm"))
    + sec("Task discussions", threads)
    + (join.length ? `<div class="cs-h">Channels you can join</div>` + join.map((r) => `<a class="cr join" data-join="${esc(r.id)}">${roomIcon(r)}`
      + `<span class="cr-m"><span class="cr-t"><b>${esc(r.title)}</b></span><span class="cr-l">Join</span></span></a>`).join("") : "")
    + (!C.rooms.length && !threads.length && !join.length ? `<p class="muted cs-none">No chats yet. Start one with the pencil above.</p>` : "");
  const n = C.rooms.reduce((s, r) => s + (r.unread || 0), 0);
  document.title = (n ? `(${n}) ` : "") + "LWK Viewer - Chat";
}

function short(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------ a room */

async function openRoom(id) {
  closePop();
  C.reply = null;
  C.pend = [];
  paintPend();
  $("#c-reply").hidden = true;
  $("#c-right").hidden = true;
  if (id.startsWith(TASK)) return openThread(id.slice(TASK.length));
  const r = await api(`/api/chat/rooms/${encodeURIComponent(id)}/messages?limit=60`);
  C.room = r.room;
  C.msgs = r.messages;
  C.more = r.more;
  history.replaceState(null, "", "messenger.html?room=" + encodeURIComponent(id));
  paintHead();
  paintMsgs(true);
  markRead();
  paintRooms();
  $("#c-text").focus();
}

async function openThread(tid) {
  const r = await api("/api/tasks/" + encodeURIComponent(tid));
  const t = r.task;
  const meta = C.threads.find((x) => x.id === tid) || {};
  C.room = { id: TASK + tid, kind: "task", title: t.title || "Untitled task", member: r.role !== "viewer", task: t,
    list_title: meta.list_title || "", group_title: meta.group_title || "", members: (t.subscribers || []).map((s) => s.uid) };
  C.msgs = r.comments.map((c) => ({ id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files || [],
    created_at: c.created_at, kind: "text", seq: 0 }));
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
  const p = r.kind === "project" ? C.projects[r.project] : null;
  $("#c-sub").textContent = r.description ? r.description.split("\n")[0]
    : r.kind === "project" ? "Project channel" + (p && p.code ? " · " + p.code : "")
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
    const say = { created: "New task", assigned: "Assigned", completed: "Completed", comment: "New comment", reopened: "Reopened" }[c.event] || "Updated";
    return `<div class="c-card task ev-${esc(c.event)}"><div class="cc-h">${badge("task")} <b>${esc(say)}</b> <span class="muted">${esc(c.list)} / ${esc(c.group)}</span></div>`
      + `<div class="cc-t">${esc(c.title)}</div>`
      + (c.text ? `<div class="cc-x">${c.event === "assigned" ? "to " : ""}${esc(c.text)}</div>` : "")
      + `<div class="cc-f">${c.owners && c.owners.length ? "Owner: " + esc(c.owners.join(", ")) : ""}${c.due ? " · Due " + esc(c.due) : ""}`
      + `<span class="spacer"></span><a href="tasks.html?list=${esc(c.list_id)}&task=${esc(c.task_id)}">View task</a></div></div>`;
  }
  if (c.type === "issue") {
    const url = c.sheet ? `index.html?project=${encodeURIComponent(c.project)}&sheet=${encodeURIComponent(c.sheet)}&select=${encodeURIComponent(c.id)}`
      : `model.html?project=${encodeURIComponent(c.project)}&select=${encodeURIComponent(c.id)}`;
    return `<div class="c-card issue"><div class="cc-h">${badge("issue")} <b>${c.event === "raised" ? "New issue" : "Issue " + esc(c.status)}</b> <span class="muted">${esc(c.project)}${c.sheet ? " · " + esc(c.sheet) : ""}</span></div>`
      + `<div class="cc-t">#${esc(c.number || "?")} ${esc(c.title)}</div>`
      + `<div class="cc-f">${c.assigned_to ? "Assigned to " + esc(c.assigned_to) : ""}${c.due ? " · Due " + esc(c.due) : ""}<span class="spacer"></span><a href="${esc(url)}">Show in viewer</a></div></div>`;
  }
  return "";
}

/* An "Embed" code pasted from OneDrive / SharePoint (<iframe src="...">)
   is kept as its address, which linkify() shows as a player. */
const unframe = (t) => String(t || "").replace(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>(\s*<\/iframe>)?/gi, " $1 ");

function textHtml(body) {
  return mention(linkify(esc(unframe(body))));
}

function msgHtml(m, prev) {
  if (m.kind === "system") return `<div class="c-sys">${esc(m.body)} · ${esc(short(m.created_at))}</div>`;
  const fwd = m.card && m.card.type === "forward" ? m.card : null;
  const same = prev && prev.kind !== "system" && prev.uid === m.uid && prev.author === m.author && !fwd
    && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60e3 && !m.reply_to;
  const mine = m.uid != null && m.uid === C.uid;
  const reply = m.reply_to && C.msgs.find((x) => x.id === m.reply_to);
  const by = m.kind === "card" ? (m.author ? m.author + " · update" : "Update") : m.author;
  const inner = fwd ? (fwd.inner ? cardHtml({ card: fwd.inner }) : "") : m.kind === "card" ? cardHtml(m) : "";
  const room = C.room.kind !== "task";
  return `<div class="c-msg${same ? " cont" : ""}${mine ? " mine" : ""}" data-id="${esc(m.id)}">`
    + (same ? `<span class="c-av"></span>` : `<span class="c-av">${m.kind === "card" ? `<span class="c-ico bot">${ic("bell", 18)}</span>` : avatar({ name: m.author }, 34)}</span>`)
    + `<div class="c-body">`
    + (same ? "" : `<div class="c-meta"><b>${esc(by)}</b><small title="${esc(fmtWhen(m.created_at))}">${esc(short(m.created_at))}</small></div>`)
    + (m.deleted ? `<div class="c-del">message deleted</div>`
      : (reply ? `<div class="c-quote"><b>${esc(reply.author)}</b> ${esc((reply.body || "").slice(0, 120))}</div>` : "")
        + (fwd ? `<div class="c-fwd">${ic("forward", 13)} Forwarded from <b>${esc(fwd.from)}</b> in ${esc(fwd.room)}</div>` : "")
        + `<div class="${fwd ? "c-fwd-body" : ""}">`
        + inner
        + (m.body ? `<div class="c-text">${textHtml(m.body)}${m.edited_at ? ` <small class="muted">(edited)</small>` : ""}</div>` : "")
        + filesHtml(m.files) + `</div>`)
    + `</div>`
    + (!m.deleted && room ? `<div class="c-acts">`
      + (m.kind !== "card" ? `<button class="ghost" data-reply="${esc(m.id)}" title="Reply">${ic("reply")}</button>` : "")
      + `<button class="ghost" data-fwd="${esc(m.id)}" title="Forward to another chat">${ic("forward")}</button>`
      + (mine && m.kind !== "card" ? `<button class="ghost" data-edit="${esc(m.id)}" title="Edit">${ic("edit")}</button><button class="ghost" data-del="${esc(m.id)}" title="Delete">${ic("trash")}</button>` : "")
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
  box.innerHTML = h;
  if (toBottom || atBottom) box.scrollTop = box.scrollHeight;
  for (const img of box.querySelectorAll("img")) img.addEventListener("load", () => { if (toBottom || atBottom) box.scrollTop = box.scrollHeight; }, { once: true });
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

async function send() {
  const ta = $("#c-text");
  const body = ta.value.trim();
  if (C.pend.some((p) => !p.id && !p.error)) return toast("Still uploading - a moment", true);
  const files = C.pend.filter((p) => p.id).map((p) => p.id);
  if (!body && !files.length) return;
  ta.value = "";
  fit();
  const pend = C.pend;
  C.pend = [];
  paintPend();
  try {
    if (C.room.kind === "task") {
      const c = await api(`/api/tasks/${C.room.task.id}/comments`, { method: "POST", body: JSON.stringify({ body, files }) });
      C.msgs.push({ id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files, created_at: c.created_at, kind: "text" });
    } else {
      const m = await api(`/api/chat/rooms/${C.room.id}/messages`, { method: "POST",
        body: JSON.stringify({ body, files, reply_to: C.reply || "" }) });
      if (!C.msgs.some((x) => x.id === m.id)) C.msgs.push(m);
    }
    C.reply = null;
    $("#c-reply").hidden = true;
    paintMsgs(true);
  } catch (e) {
    ta.value = body;
    C.pend = pend;
    paintPend();
    toast(e.message, true);
  }
}

function fit() {
  const ta = $("#c-text");
  ta.style.height = "auto";
  ta.style.height = Math.min(180, ta.scrollHeight) + "px";
}

/* @ lists the people in this chat */
function wireMentions() {
  const ta = $("#c-text");
  ta.addEventListener("input", () => {
    fit();
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
    if (!m || !C.room) return closePop();
    const q = m[2].toLowerCase();
    const pool = C.people.filter((p) => !C.room.members || C.room.kind === "task" || C.room.members.includes(p.uid));
    const opts = pool.filter((p) => p.uid !== C.uid && p.name.toLowerCase().includes(q)).slice(0, 8);
    if (!opts.length) return closePop();
    pickOne(ta, opts.map((p) => ({ value: p.name, label: avatar(p) + " " + esc(p.name) })), "", (name) => {
      const start = upto.length - m[2].length - 1;
      ta.value = ta.value.slice(0, start) + "@" + name + " " + ta.value.slice(ta.selectionStart);
      ta.focus();
    });
    setTimeout(() => ta.focus(), 0);
  });
}

/* ------------------------------------------------------------ sync */

async function sync() {
  if (document.hidden && C.rev) return;
  let r;
  try { r = await api("/api/chat/sync?since=" + C.rev); } catch (e) { return; }
  const first = !C.rev;
  C.rev = r.rev;
  if (first) return;
  let roomsChanged = false;
  for (const x of r.rooms) {
    const i = C.rooms.findIndex((y) => y.id === x.id);
    if (i >= 0) C.rooms[i] = x; else C.rooms.unshift(x);
    roomsChanged = true;
  }
  let mine = false;
  for (const m of r.messages) {
    if (!C.room || m.room !== C.room.id) continue;
    const i = C.msgs.findIndex((y) => y.id === m.id);
    if (i >= 0) C.msgs[i] = m; else C.msgs.push(m);
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
  if (roomsChanged) paintRooms();
}

/* a task discussion has no sync of its own: look again now and then */
setInterval(async () => {
  if (document.hidden || !C.room || C.room.kind !== "task") return;
  try {
    const r = await api("/api/tasks/" + encodeURIComponent(C.room.task.id));
    if (r.comments.length !== C.msgs.length) {
      C.msgs = r.comments.map((c) => ({ id: c.id, uid: c.uid, author: c.author, body: c.body, files: c.files || [], created_at: c.created_at, kind: "text" }));
      paintMsgs(false);
    }
  } catch (e) {}
}, 6000);

/* ------------------------------------------------------------ new chats, members, files */

async function newChat() {
  const projects = Object.values(C.projects).filter((p) => !C.rooms.some((r) => r.kind === "project" && r.project === p.id)
    && !C.joinable.some((r) => r.project === p.id));
  const f = modal("New chat", `
    <label class="row-check"><input type="radio" name="k" value="dm" checked> Direct message</label>
    <label class="row-check"><input type="radio" name="k" value="group"> Group chat</label>
    ${projects.length ? `<label class="row-check"><input type="radio" name="k" value="project"> Project channel</label>` : ""}
    <div class="nc-dm"><label>With <select name="user">${C.people.filter((p) => p.uid !== C.uid).map((p) => `<option value="${p.uid}">${esc(p.name)}${p.team ? " · " + esc(p.team) : ""}</option>`).join("")}</select></label></div>
    <div class="nc-group" hidden><label>Name <input name="title" placeholder="e.g. SKW modelling team"></label>
      <label>People <div class="nc-people td-v act"><span class="muted">choose</span></div></label></div>
    <div class="nc-project" hidden><label>Project <select name="project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.short || p.name)}${p.code ? " · " + esc(p.code) : ""}</option>`).join("")}</select></label>
      <p class="muted" style="font-size:11px">Everyone on the project (its owners, viewer project members and task list members) is added. Task and issue updates are posted into it.</p></div>`, "Start");
  const form = document.querySelector(".t-modal");
  let chosen = [];
  const show = () => {
    const k = form.querySelector("input[name=k]:checked").value;
    form.querySelector(".nc-dm").hidden = k !== "dm";
    form.querySelector(".nc-group").hidden = k !== "group";
    form.querySelector(".nc-project").hidden = k !== "project";
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
  const admin = r.role === "admin" || C.me.site_admin;
  const list = (r.members || []).map((u) => C.byUid[u] || { uid: u, name: "?" })
    .sort((a, b) => (b.uid === C.uid) - (a.uid === C.uid) || a.name.localeCompare(b.name));
  const p = r.kind === "project" ? C.projects[r.project] : null;
  box.innerHTML = `<div class="cp-h"><b>${r.kind === "task" ? "Task discussion" : r.kind === "dm" ? "Direct message" : "Chat info"}</b><span class="spacer"></span>`
    + `<button class="ghost" data-x title="Close">${ic("close")}</button></div>`
    + `<div class="ci-top">${roomIcon(r)}<div><b>${esc(r.title)}</b><small class="muted">${r.kind === "project" ? "Project channel" + (p && p.code ? " · " + esc(p.code) : "") : r.kind === "group" ? "Group" : r.kind === "dm" ? "Direct message" : ""}</small></div></div>`
    + (r.kind !== "dm" && r.kind !== "task" ? `<div class="ci-sec"><div class="ci-h">Description${admin ? ` <button class="ghost linkish" data-desc>edit</button>` : ""}</div>`
      + `<div class="ci-desc">${r.description ? textHtml(r.description) : `<span class="muted">${admin ? "Say what this chat is for - its rules, key links, who to ask." : "No description."}</span>`}</div></div>` : "")
    + (r.created_by ? `<div class="ci-sec muted" style="font-size:11px">Started by ${esc(r.created_by)} · ${esc(fmtWhen(r.created_at))}</div>` : "")
    + `<div class="ci-sec"><div class="ci-h">${r.kind === "task" ? "Followers" : "Members"} <span class="muted">${list.length}</span></div>`
    + list.map((u) => `<div class="cp-p">${avatar(u, 30)}<span class="cp-n"><b>${esc(u.name)}${u.uid === C.uid ? " <small class=\"muted\">(you)</small>" : ""}</b>`
      + `<small class="muted">${esc([u.team, u.office].filter(Boolean).join(" · "))}</small></span>`
      + (u.uid !== C.uid ? `<button class="ghost" data-dm="${u.uid}" title="Direct message">${ic("chat")}</button>` : "")
      + (r.kind !== "task" && r.kind !== "dm" && u.uid !== C.uid && admin ? `<button class="ghost" data-rm="${u.uid}" title="Remove from the chat">${ic("close")}</button>` : "")
      + `</div>`).join("")
    + (r.kind !== "task" && r.kind !== "dm" ? `<button class="cp-add icon-btn">${ic("plus")} Add people</button>` : "") + `</div>`
    + (r.kind !== "task" ? `<div class="ci-sec ci-actions">`
      + `<button class="ghost icon-btn" data-files>${ic("clip")} Pictures and files</button>`
      + (r.kind !== "dm" ? `<button class="ghost icon-btn" data-leave>${ic("exit")} Leave this chat</button>` : "")
      + (admin && (r.kind !== "dm" || C.me.site_admin) ? `<button class="ghost danger icon-btn" data-delroom>${ic("trash")} Delete this chat</button>` : "")
      + `</div>` : "");
  box.onclick = async (ev) => {
    if (ev.target.closest("[data-x]")) { box.hidden = true; return; }
    const rm = ev.target.closest("[data-rm]"), dm = ev.target.closest("[data-dm]");
    try {
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
  if (!confirm(`Delete "${r.title}" for everyone? Its messages will no longer be shown to anyone.`)) return;
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
      + `<input type="checkbox" value="${esc(r.id)}">${roomIcon(r)}<span><b>${esc(r.title)}</b><small class="muted">${r.kind === "project" ? "Project channel" : r.kind === "dm" ? "Direct message" : "Group"}</small></span></label>`).join("")}</div>`
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
  const admin = r.role === "admin" || C.me.site_admin;
  const el = pop(ev.target.closest(".cr"), `<div class="po-row" data-k="open">${ic("chat")} Open</div>`
    + `<div class="po-row" data-k="info">${ic("info")} Details</div>`
    + (r.unread ? `<div class="po-row" data-k="read">${ic("read")} Mark as read</div>` : "")
    + (r.kind !== "dm" ? `<div class="po-row" data-k="leave">${ic("exit")} Leave</div>` : "")
    + (admin && (r.kind !== "dm" || C.me.site_admin) ? `<div class="po-row bad" data-k="del">${ic("trash")} Delete chat</div>` : ""), 200);
  el.style.left = Math.min(innerWidth - 210, ev.clientX) + "px";
  el.style.top = Math.min(innerHeight - 200, ev.clientY) + "px";
  el.style.bottom = "";
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
    + (r.messages.map((m) => `<a class="cp-s" data-room="${esc(m.room)}"><b>${esc(title(m.room))}</b> <small class="muted">${esc(short(m.created_at))}</small><br>`
      + `<span>${esc(m.author)}: ${esc((m.body || (m.card && m.card.title) || (m.files[0] || {}).name || "").slice(0, 160))}</span></a>`).join("") || `<p class="muted">Nothing found.</p>`);
  box.onclick = (ev) => {
    if (ev.target.closest("[data-x]")) { box.hidden = true; return; }
    const a = ev.target.closest("[data-room]");
    if (a) openRoom(a.dataset.room);
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

function icons() {
  $("#c-back").innerHTML = ic("back", 20) + `<span>Chats</span>`;
  $("#c-files-btn").innerHTML = ic("clip") + `<span class="lab">Files</span>`;
  $("#c-members-btn").innerHTML = ic("users") + ` <span id="c-mcount"></span>`;
  $("#c-members-btn").title = "Chat info and members";
  $("#c-new").innerHTML = ic("compose", 18);
  $("#c-attach").innerHTML = ic("clip", 18);
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
  $("#c-text").onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !document.querySelector(".t-pop")) { ev.preventDefault(); send(); }
    if (ev.key === "Escape" && C.reply) { C.reply = null; $("#c-reply").hidden = true; }
  };
  wireMentions();
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
    const fw = ev.target.closest("[data-fwd]");
    if (fw) return forwardMsg(C.msgs.find((x) => x.id === fw.dataset.fwd));
    // a phone has no hover: a tap on a message shows its buttons
    const msg = ev.target.closest(".c-msg");
    if (msg && !ev.target.closest("a, button, video, iframe") && matchMedia("(hover: none)").matches) {
      for (const x of document.querySelectorAll(".c-msg.show-acts")) if (x !== msg) x.classList.remove("show-acts");
      msg.classList.toggle("show-acts");
      return;
    }
    const rp = ev.target.closest("[data-reply]"), ed = ev.target.closest("[data-edit]"), dl = ev.target.closest("[data-del]");
    if (rp) {
      const m = C.msgs.find((x) => x.id === rp.dataset.reply);
      C.reply = m.id;
      $("#c-reply").hidden = false;
      $("#c-reply").innerHTML = `Replying to <b>${esc(m.author)}</b>: ${esc((m.body || "").slice(0, 80))} <button class="ghost linkish" id="c-noreply">cancel</button>`;
      $("#c-noreply").onclick = () => { C.reply = null; $("#c-reply").hidden = true; };
      $("#c-text").focus();
    }
    try {
      if (ed) {
        const m = C.msgs.find((x) => x.id === ed.dataset.edit);
        const t = prompt("Edit your message", m.body);
        if (t === null || t.trim() === m.body) return;
        Object.assign(m, await api(`/api/chat/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ body: t }) }));
        paintMsgs(false);
      }
      if (dl) {
        if (!confirm("Delete this message for everyone?")) return;
        await api(`/api/chat/messages/${dl.dataset.del}`, { method: "DELETE" });
        const m = C.msgs.find((x) => x.id === dl.dataset.del);
        m.deleted = true;
        paintMsgs(false);
      }
    } catch (e) { toast(e.message, true); }
  };
}

async function start() {
  const me = await ensureSignedIn();
  C.me = me;
  header(me);
  if (!me.accounts) {
    $("#c-app").innerHTML = `<div class="t-empty"><h3>The Messenger needs accounts</h3><p>This server runs with a shared passphrase, so it does not know who is who. A site admin can switch accounts on (Admin page).</p></div>`;
    return;
  }
  C.uid = me.user.id;
  try { C.people = (await api("/api/people")).people || []; } catch (e) { C.people = []; }
  C.byUid = Object.fromEntries(C.people.map((p) => [p.uid, p]));
  wire();
  await loadRooms();
  await sync();
  setInterval(sync, 3000);
  setInterval(() => { if (!document.hidden) loadRooms().catch(() => {}); }, 120000);
  const q = new URLSearchParams(location.search);
  if (q.get("share")) await share(q.get("share"), q.get("title") || "Link");
  else if (q.get("room")) {
    const id = q.get("room");
    if (!C.rooms.some((r) => r.id === id) && C.joinable.some((r) => r.id === id)) {
      try { await api(`/api/chat/rooms/${id}/join`, { method: "POST", body: "{}" }); await loadRooms(); } catch (e) {}
    }
    await openRoom(id).catch((e) => toast(e.message, true));
  } else if (q.get("task")) await openRoom(TASK + q.get("task")).catch((e) => toast(e.message, true));
  else if (C.rooms[0] && innerWidth > 900) await openRoom(C.rooms[0].id);
}

start().catch((e) => { const m = $("#c-main"); if (m) m.innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`; });
