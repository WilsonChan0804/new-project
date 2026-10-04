"""Messenger - the team's chat, inside the viewer (what Lark Messenger did).

Registered by app.py:  chat.register(app, core).

Rooms:
  project  one channel per job on the Projects page. Task and issue
           updates of that job are posted into it as cards, the way the
           Lark bots posted into the group chats.
  group    any group of people, named by whoever starts it
  dm       two people

A task's own discussion stays on the task (tasks.py comments); the
Messenger lists the ones you follow beside the rooms.

Storage: <data>/chat.db, and the pictures and files people send in
<data>/chat_files/ (50 MB each - drawings and models stay in OneDrive and
ACC and are sent as links).

New messages reach the page through /api/chat/sync with the last revision
it saw. With ?wait=N the request is held (up to N seconds) until something
changes, so a message shows up at once without asking every few seconds.
"""

import asyncio

import json
import mimetypes
import os
import re
import sqlite3
import threading
import time
import uuid

from fastapi import HTTPException, Request, Header
from fastapi.responses import FileResponse

SCHEMA = """
CREATE TABLE IF NOT EXISTS counter (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO counter (name, value) VALUES ('rev', 0);
CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    project     TEXT NOT NULL DEFAULT '',
    dm_key      TEXT NOT NULL DEFAULT '',
    created_by  TEXT, created_uid INTEGER, created_at TEXT,
    last_seq    INTEGER NOT NULL DEFAULT 0,
    last_at     TEXT NOT NULL DEFAULT '',
    last_text   TEXT NOT NULL DEFAULT '',
    rev         INTEGER NOT NULL DEFAULT 0,
    deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project);
CREATE TABLE IF NOT EXISTS room_members (
    room      TEXT NOT NULL,
    uid       INTEGER NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
    last_read INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT,
    PRIMARY KEY (room, uid)
);
CREATE INDEX IF NOT EXISTS idx_members_uid ON room_members(uid);
CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    room       TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    uid        INTEGER,
    author     TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'text',
    body       TEXT NOT NULL DEFAULT '',
    card       TEXT NOT NULL DEFAULT '',
    files      TEXT NOT NULL DEFAULT '[]',
    reply_to   TEXT NOT NULL DEFAULT '',
    mentions   TEXT NOT NULL DEFAULT ',',
    created_at TEXT NOT NULL,
    edited_at  TEXT NOT NULL DEFAULT '',
    deleted    INTEGER NOT NULL DEFAULT 0,
    rev        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, seq);
CREATE INDEX IF NOT EXISTS idx_messages_rev ON messages(rev);
CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    room       TEXT NOT NULL DEFAULT '',
    task       TEXT NOT NULL DEFAULT '',
    name       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    mime       TEXT NOT NULL DEFAULT '',
    uid        INTEGER,
    author     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    stored     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_room ON files(room);
"""

MAX_FILE = 50 * 1024 * 1024
MAX_TEXT = 8000
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{4,48}$")
KINDS = ("project", "group", "dm")

_LOCK = threading.Lock()
_READY = set()
CORE = None


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id():
    return uuid.uuid4().hex[:20]


def clean_text(v, limit, multiline=False):
    s = "" if v is None else str(v)
    if multiline:
        s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+", "", s)
    else:
        s = re.sub(r"[\x00-\x1f\x7f]+", " ", s).strip()
    return s[:limit]


class Db(object):
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        _LOCK.acquire()
        try:
            if not os.path.isdir(os.path.dirname(self.path)):
                os.makedirs(os.path.dirname(self.path))
            if not os.path.isfile(self.path):
                _READY.discard(self.path)
            self.db = sqlite3.connect(self.path, timeout=10)
            self.db.row_factory = sqlite3.Row
            if self.path not in _READY:
                self.db.execute("PRAGMA journal_mode=WAL")
                self.db.executescript(SCHEMA)
                have = set(r[1] for r in self.db.execute("PRAGMA table_info(rooms)"))
                if "description" not in have:     # added later: the chat's "about", as in WhatsApp
                    self.db.execute("ALTER TABLE rooms ADD COLUMN description TEXT NOT NULL DEFAULT ''")
                have = set(r[1] for r in self.db.execute("PRAGMA table_info(messages)"))
                if "reactions" not in have:       # added later: {emoji: [uid, ...]}
                    self.db.execute("ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}'")
                self.db.commit()
                _READY.add(self.path)
        except Exception:
            _LOCK.release()
            raise
        return self.db

    def __exit__(self, kind, value, tb):
        try:
            if kind is None:
                self.db.commit()
            else:
                self.db.rollback()
        finally:
            try:
                self.db.close()
            finally:
                _LOCK.release()
        return False


def db():
    return Db(os.path.join(CORE.CFG["data"], "chat.db"))


def files_dir():
    d = os.path.join(CORE.CFG["data"], "chat_files")
    if not os.path.isdir(d):
        os.makedirs(d)
    return d


# The latest revision, kept in memory so a waiting /api/chat/sync can see a
# change without asking the database (set by next_rev; the writer holds the
# lock until it has committed, so a reader woken by it sees the new rows).
_REV = [0]


def next_rev(d):
    d.execute("UPDATE counter SET value = value + 1 WHERE name = 'rev'")
    rev = d.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"]
    _REV[0] = max(_REV[0], rev)
    return rev


# [label](viewer address) - a task, issue, sheet or 3D link picked with # ! $ %
LINK_MD = re.compile(r"\[([^\]\n]{1,200})\]\(((?:https?://[^\s)]+/)?(?:index|model|tasks|projects|dashboard)\.html\?[^\s)]*)\)")


def whatsapp_card(c):
    """A card a person may send: messages from WhatsApp (pasted, or an
    exported chat), cleaned and capped. Anything else: None."""
    if not isinstance(c, dict) or c.get("type") != "whatsapp":
        return None
    lines = []
    for x in (c.get("lines") or [])[:3000]:
        if not isinstance(x, dict):
            continue
        lines.append({"at": clean_text(x.get("at"), 40), "name": clean_text(x.get("name"), 80),
                      "text": clean_text(x.get("text"), 2000, True), "file": clean_text(x.get("file"), 200)})
    if not lines:
        return None
    out = {"type": "whatsapp", "title": clean_text(c.get("title"), 120) or "From WhatsApp", "lines": lines}
    while len(json.dumps(out)) > 400000 and len(out["lines"]) > 1:
        out["lines"] = out["lines"][len(out["lines"]) // 10 or 1:]
        out["cut"] = True
    return out


def plain_links(text):
    """The text as it reads, for the chat list and for emails."""
    return LINK_MD.sub(lambda m: m.group(1), text or "")


def msg_row(r):
    out = {"id": r["id"], "room": r["room"], "seq": r["seq"], "uid": r["uid"], "author": r["author"],
           "kind": r["kind"], "created_at": r["created_at"], "rev": r["rev"]}
    if r["deleted"]:
        out["deleted"] = True
        return out
    out.update({"body": r["body"], "card": json.loads(r["card"]) if r["card"] else None,
                "files": json.loads(r["files"] or "[]"), "reply_to": r["reply_to"], "edited_at": r["edited_at"]})
    try:
        re_ = json.loads(r["reactions"] or "{}")
    except (IndexError, KeyError, ValueError):
        re_ = {}
    if re_:
        out["reactions"] = re_
    return out


def file_meta(r):
    return {"id": r["id"], "name": r["name"], "size": r["size"], "mime": r["mime"],
            "url": "/api/chat/files/%s/%s" % (r["id"], re.sub(r"[^A-Za-z0-9._-]+", "_", r["name"]))}


# ------------------------------------------------------------ posting

def _insert(d, room, uid, author, kind, body="", card=None, files=None, reply_to="", mentions=()):
    r = d.execute("SELECT * FROM rooms WHERE id = ?", (room,)).fetchone()
    seq = r["last_seq"] + 1
    rev = next_rev(d)
    t = now_iso()
    mid = new_id()
    d.execute("INSERT INTO messages (id, room, seq, uid, author, kind, body, card, files, reply_to, mentions, created_at, rev) "
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (mid, room, seq, uid, author, kind, body, json.dumps(card) if card else "", json.dumps(files or []),
               reply_to, "," + ",".join(str(m) for m in mentions) + ",", t, rev))
    preview = plain_links(body) or (card or {}).get("title") or ("%d file%s" % (len(files or []), "" if len(files or []) == 1 else "s"))
    d.execute("UPDATE rooms SET last_seq = ?, last_at = ?, last_text = ?, rev = ? WHERE id = ?",
              (seq, t, ((author + ": ") if author else "") + preview[:120], rev, room))
    if uid is not None:
        d.execute("UPDATE room_members SET last_read = ? WHERE room = ? AND uid = ?", (seq, room, uid))
    return d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()


def post_card(reg_ids, card, author=""):
    """A task or issue update, into the channels of those register projects
    (called by tasks.py and app.py). Never raises: a card that cannot be
    posted must not stop the save it reports."""
    if CORE is None or not reg_ids:
        return
    try:
        with db() as d:
            for reg in set(reg_ids):
                r = d.execute("SELECT id FROM rooms WHERE kind = 'project' AND project = ? AND deleted = 0",
                              (reg,)).fetchone()
                if r:
                    _insert(d, r["id"], None, author, "card", card=card)
    except Exception as ex:
        print("chat card: %s" % ex)


def files_for(ids, task="", room=""):
    """The stored files with these ids that were sent to this task / room."""
    ids = [i for i in (ids or []) if isinstance(i, str) and SAFE_ID.match(i)][:20]
    if not ids:
        return []
    with db() as d:
        q = "SELECT * FROM files WHERE id IN (%s) AND task = ? AND room = ?" % ",".join("?" * len(ids))
        return [file_meta(r) for r in d.execute(q, ids + [task, room])]


def register(app, core):
    global CORE
    CORE = core
    tasks = None
    try:
        import tasks as _tasks
        tasks = _tasks
    except Exception:
        pass

    async def read_json(request):
        raw = await request.body()
        if len(raw) > 512 * 1024:
            raise HTTPException(status_code=413, detail="Too long")
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Expected a JSON object")
        return body

    def me(request, token):
        w = core.who(request, token)
        if w.uid is None:
            raise HTTPException(status_code=400, detail="The Messenger needs accounts switched on (Admin page)")
        return w

    def users():
        return dict((u["id"], u) for u in core.ACC.list() if u["active"])

    def get_room(d, rid):
        if not isinstance(rid, str) or not SAFE_ID.match(rid):
            raise HTTPException(status_code=404, detail="No such chat")
        r = d.execute("SELECT * FROM rooms WHERE id = ? AND deleted = 0", (rid,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such chat (it may have been deleted)")
        return r

    def membership(d, rid, uid):
        return d.execute("SELECT * FROM room_members WHERE room = ? AND uid = ?", (rid, uid)).fetchone()

    def project_people(reg):
        """Who belongs in a project's channel: its owners and members (the
        Admin page's members of the project)."""
        if tasks is None:
            return set(), None
        return tasks.project_people(core, reg)

    def can_join(w, room):
        if w.site_admin:
            return True
        if room["kind"] != "project":
            return False
        uids, _ = project_people(room["project"])
        return w.uid in uids

    def room_view(d, r, uid, names=None):
        m = membership(d, r["id"], uid)
        last_read = m["last_read"] if m else r["last_seq"]
        unread = mention = 0
        if m and r["last_seq"] > last_read:
            c = d.execute("SELECT SUM(CASE WHEN uid IS NULL OR uid != ? THEN 1 ELSE 0 END) AS n, "
                          "SUM(CASE WHEN mentions LIKE ? THEN 1 ELSE 0 END) AS m "
                          "FROM messages WHERE room = ? AND seq > ? AND deleted = 0",
                          (uid, "%%,%d,%%" % uid, r["id"], last_read)).fetchone()
            unread, mention = c["n"] or 0, c["m"] or 0
        mem = [x["uid"] for x in d.execute("SELECT uid FROM room_members WHERE room = ?", (r["id"],))]
        title = r["title"]
        if r["kind"] == "dm":
            other = [u for u in mem if u != uid]
            title = (names or {}).get(other[0], "Someone") if other else "Just you"
        return {"id": r["id"], "kind": r["kind"], "title": title, "project": r["project"],
                "description": r["description"], "created_by": r["created_by"] or "", "created_at": r["created_at"] or "",
                "last_seq": r["last_seq"], "last_at": r["last_at"], "last_text": r["last_text"],
                "unread": unread, "mention": mention, "member": bool(m), "role": m["role"] if m else "",
                "members": mem, "last_read": last_read, "rev": r["rev"]}

    def mentions_in(text, pool):
        low = (text or "").lower()
        return [u["id"] for u in pool.values() if u["name"] and ("@" + u["name"].lower()) in low]

    def mail(uids, subject, text):
        if not core.smtp_ready():
            return
        us = users()
        targets = [(us[u]["name"], us[u]["email"]) for u in uids if u in us and us[u]["email"]]

        def run():
            for n, e in targets:
                try:
                    core.send_mail(e, subject, "Hello %s,\n\n%s\n\n- LWK Viewer Messenger" % (n, text))
                except Exception as ex:
                    print("chat mail %s: %s" % (e, ex))
        if targets:
            threading.Thread(target=run, daemon=True).start()

    # ------------------------------------------------------------ rooms

    @app.get("/api/chat/rooms")
    async def rooms(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        names = dict((k, v["name"]) for k, v in users().items())
        with db() as d:
            mine = d.execute("SELECT r.* FROM rooms r JOIN room_members m ON m.room = r.id "
                             "WHERE m.uid = ? AND r.deleted = 0 ORDER BY r.last_at DESC", (w.uid,)).fetchall()
            out = [room_view(d, r, w.uid, names) for r in mine]
            have = set(r["id"] for r in mine)
            others = d.execute("SELECT * FROM rooms WHERE kind = 'project' AND deleted = 0").fetchall()
        joinable = []
        for r in others:
            if r["id"] not in have and can_join(w, r):
                joinable.append({"id": r["id"], "kind": "project", "title": r["title"], "project": r["project"]})
        return {"rooms": out, "joinable": joinable, "me": w.uid}

    @app.post("/api/chat/rooms")
    async def room_create(request: Request, x_viewer_token: str = Header(default="")):
        """{kind: "dm", user} | {kind: "group", title, members} | {kind: "project", project}"""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        kind = body.get("kind")
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail="kind: dm, group or project")
        us = users()
        t = now_iso()
        with db() as d:
            if kind == "dm":
                try:
                    other = int(body.get("user"))
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="Who to talk to?")
                if other not in us:
                    raise HTTPException(status_code=404, detail="No such person")
                key = "%d:%d" % tuple(sorted((w.uid, other)))
                r = d.execute("SELECT * FROM rooms WHERE kind = 'dm' AND dm_key = ? AND deleted = 0", (key,)).fetchone()
                if r:
                    return room_view(d, r, w.uid, dict((k, v["name"]) for k, v in us.items()))
                members, title, project = {w.uid, other}, "", ""
            elif kind == "group":
                title = clean_text(body.get("title"), 80) or "Group chat"
                members = set(int(u) for u in (body.get("members") or []) if str(u).isdigit() and int(u) in us)
                members.add(w.uid)
                project, key = "", ""
            else:
                project = clean_text(body.get("project"), 48)
                r = d.execute("SELECT * FROM rooms WHERE kind = 'project' AND project = ? AND deleted = 0",
                              (project,)).fetchone()
                if r:
                    return room_view(d, r, w.uid)
                uids, reg = project_people(project)
                if not reg:
                    raise HTTPException(status_code=404, detail="No such project on the Projects page")
                if not w.site_admin and w.uid not in uids:
                    raise HTTPException(status_code=403, detail="You are not on this project")
                members = set(u for u in uids if u in us) | {w.uid}
                title = reg["short"] or reg["name"]
                key = ""
            rid = new_id()
            d.execute("INSERT INTO rooms (id, kind, title, project, dm_key, created_by, created_uid, created_at, last_at, rev) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?)", (rid, kind, title, project, key, w.name, w.uid, t, t, next_rev(d)))
            for u in members:
                d.execute("INSERT INTO room_members (room, uid, role, joined_at) VALUES (?, ?, ?, ?)",
                          (rid, u, "admin" if u == w.uid else "member", t))
            if kind != "dm":
                _insert(d, rid, None, "", "system", body="%s started %s" % (w.name, title))
            return room_view(d, d.execute("SELECT * FROM rooms WHERE id = ?", (rid,)).fetchone(), w.uid,
                             dict((k, v["name"]) for k, v in us.items()))

    @app.patch("/api/chat/rooms/{rid}")
    async def room_rename(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            r = get_room(d, rid)
            m = membership(d, rid, w.uid)
            if r["kind"] == "dm" or not (w.site_admin or (m and m["role"] == "admin")):
                raise HTTPException(status_code=403, detail="Only the chat's admins can change its name and description")
            title = clean_text(body.get("title"), 80) or r["title"] if "title" in body else r["title"]
            desc = clean_text(body.get("description"), 2000, True) if "description" in body else r["description"]
            d.execute("UPDATE rooms SET title = ?, description = ?, rev = ? WHERE id = ?", (title, desc, next_rev(d), rid))
            if title != r["title"]:
                _insert(d, rid, None, "", "system", body="%s renamed the chat to %s" % (w.name, title))
            if desc != r["description"]:
                _insert(d, rid, None, "", "system", body="%s changed the description" % w.name)
        return {"ok": True}

    @app.delete("/api/chat/rooms/{rid}")
    async def room_delete(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """Gone for everyone (a chat admin or a site admin). Its messages are
        kept in the file, out of sight, in case it was a mistake."""
        w = me(request, x_viewer_token)
        with db() as d:
            r = get_room(d, rid)
            m = membership(d, rid, w.uid)
            if not (w.site_admin or (m and m["role"] == "admin" and r["kind"] != "dm")):
                raise HTTPException(status_code=403, detail="Only the chat's admins or a site admin can delete it")
            d.execute("UPDATE rooms SET deleted = 1, rev = ? WHERE id = ?", (next_rev(d), rid))
        return {"ok": True}

    @app.post("/api/chat/messages/{mid}/forward")
    async def forward(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{rooms: [id], note}: the message (its text, pictures and files)
        into other chats, marked as forwarded from where it was written."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        note = clean_text(body.get("note"), MAX_TEXT, True).strip()
        sent = []
        with db() as d:
            m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
            if not m or not membership(d, m["room"], w.uid):
                raise HTTPException(status_code=404, detail="No such message")
            src = d.execute("SELECT * FROM rooms WHERE id = ?", (m["room"],)).fetchone()
            for rid in (body.get("rooms") or [])[:20]:
                if not isinstance(rid, str) or not SAFE_ID.match(rid):
                    continue
                r = d.execute("SELECT * FROM rooms WHERE id = ? AND deleted = 0", (rid,)).fetchone()
                if not r or not membership(d, rid, w.uid):
                    continue
                # the files are shared, not copied: a new record in the new chat
                fs = []
                for f in json.loads(m["files"] or "[]"):
                    old = d.execute("SELECT * FROM files WHERE id = ?", (f["id"],)).fetchone()
                    if not old:
                        continue
                    fid = new_id()
                    d.execute("INSERT INTO files (id, room, task, name, size, mime, uid, author, created_at, stored) "
                              "VALUES (?,?,'',?,?,?,?,?,?,?)", (fid, rid, old["name"], old["size"], old["mime"],
                                                               w.uid, w.name, now_iso(), old["stored"]))
                    fs.append(file_meta(d.execute("SELECT * FROM files WHERE id = ?", (fid,)).fetchone()))
                card = json.loads(m["card"]) if m["card"] else None
                fwd = {"type": "forward", "from": m["author"] or "Update",
                       "room": src["title"] if src["kind"] != "dm" else "a direct message", "at": m["created_at"],
                       "inner": card}
                if note:
                    _insert(d, rid, w.uid, w.name, "text", body=note)
                _insert(d, rid, w.uid, w.name, "text", body=m["body"], card=fwd, files=fs)
                sent.append(rid)
        return {"sent": sent}

    @app.post("/api/chat/rooms/{rid}/join")
    async def room_join(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with db() as d:
            r = get_room(d, rid)
            if membership(d, rid, w.uid):
                return {"ok": True}
            if not can_join(w, r):
                raise HTTPException(status_code=403, detail="Ask someone in the chat to add you")
            d.execute("INSERT INTO room_members (room, uid, role, last_read, joined_at) VALUES (?, ?, 'member', ?, ?)",
                      (rid, w.uid, max(0, r["last_seq"] - 30), now_iso()))
            _insert(d, rid, None, "", "system", body="%s joined" % w.name)
        return {"ok": True}

    @app.put("/api/chat/rooms/{rid}/members")
    async def room_members(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """{add: [uid], remove: [uid]}. Anyone in a group or project chat may
        add people; removing others takes a chat admin; leaving is free."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        us = users()
        with db() as d:
            r = get_room(d, rid)
            m = membership(d, rid, w.uid)
            if r["kind"] == "dm":
                raise HTTPException(status_code=400, detail="Start a group chat to talk to more people")
            if not m and not w.site_admin:
                raise HTTPException(status_code=403, detail="You are not in this chat")
            admin = w.site_admin or (m and m["role"] == "admin")
            added, removed = [], []
            for u in body.get("add") or []:
                u = int(u) if str(u).isdigit() else None
                if u in us and not membership(d, rid, u):
                    d.execute("INSERT INTO room_members (room, uid, role, last_read, joined_at) VALUES (?, ?, 'member', ?, ?)",
                              (rid, u, max(0, r["last_seq"] - 30), now_iso()))
                    added.append(us[u]["name"])
            for u in body.get("remove") or []:
                u = int(u) if str(u).isdigit() else None
                if u is None or (u != w.uid and not admin):
                    continue
                d.execute("DELETE FROM room_members WHERE room = ? AND uid = ?", (rid, u))
                removed.append(us[u]["name"] if u in us else "someone")
            if added:
                _insert(d, rid, None, "", "system", body="%s added %s" % (w.name, ", ".join(added)))
            for n in removed:
                _insert(d, rid, None, "", "system", body=("%s left" % n) if n == w.name else "%s removed %s" % (w.name, n))
            d.execute("UPDATE rooms SET rev = ? WHERE id = ?", (next_rev(d), rid))
        return {"ok": True}

    # ------------------------------------------------------------ messages

    @app.get("/api/chat/rooms/{rid}/messages")
    async def messages(request: Request, rid: str, before: int = 0, limit: int = 60,
                       x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        names = dict((k, v["name"]) for k, v in users().items())
        with db() as d:
            r = get_room(d, rid)
            if not membership(d, rid, w.uid) and not w.site_admin:
                raise HTTPException(status_code=403, detail="You are not in this chat")
            q = "SELECT * FROM messages WHERE room = ?" + (" AND seq < ?" if before else "") + " ORDER BY seq DESC LIMIT ?"
            args = [rid] + ([before] if before else []) + [max(1, min(200, limit))]
            rows = [msg_row(x) for x in d.execute(q, args)][::-1]
            view = room_view(d, r, w.uid, names)
        return {"room": view, "messages": rows, "more": bool(rows) and rows[0]["seq"] > 1}

    @app.post("/api/chat/rooms/{rid}/messages")
    async def send(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """{body, files: [file id], reply_to, card}. The only card a person
        may send is {type: "whatsapp"}: messages copied or exported from
        WhatsApp, shown as a quote."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_TEXT, True).strip()
        card = whatsapp_card(body.get("card"))
        us = users()
        with db() as d:
            r = get_room(d, rid)
            if not membership(d, rid, w.uid):
                raise HTTPException(status_code=403, detail="You are not in this chat")
            # an exported WhatsApp chat brings its pictures along: more of them
            ids = [i for i in (body.get("files") or []) if isinstance(i, str) and SAFE_ID.match(i)][:200 if card else 20]
            fs = [file_meta(f) for f in d.execute(
                "SELECT * FROM files WHERE id IN (%s) AND room = ?" % ",".join("?" * len(ids)), ids + [rid])] if ids else []
            if not text and not fs and not card:
                raise HTTPException(status_code=400, detail="An empty message")
            members = set(x["uid"] for x in d.execute("SELECT uid FROM room_members WHERE room = ?", (rid,)))
            ments = [u for u in mentions_in(text, us) if u in members and u != w.uid]
            reply = clean_text(body.get("reply_to"), 48)
            row = _insert(d, rid, w.uid, w.name, "text", body=text, card=card, files=fs, reply_to=reply, mentions=ments)
            title = r["title"] if r["kind"] != "dm" else "a direct message"
        if ments:
            base = core.CFG.get("base_url") or ""
            mail(ments, "%s mentioned you in %s" % (w.name, title),
                 "%s wrote in %s:\n\n%s\n\n%smessenger.html?room=%s" % (w.name, title, plain_links(text), base, rid))
        return msg_row(row)

    @app.patch("/api/chat/messages/{mid}")
    async def edit(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_TEXT, True).strip()
        with db() as d:
            m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
            if not m or m["uid"] != w.uid:
                raise HTTPException(status_code=403, detail="Only your own messages can be edited")
            if not text and not json.loads(m["files"] or "[]"):
                raise HTTPException(status_code=400, detail="An empty message - delete it instead")
            d.execute("UPDATE messages SET body = ?, edited_at = ?, rev = ? WHERE id = ?", (text, now_iso(), next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone())

    @app.delete("/api/chat/messages/{mid}")
    async def remove(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with db() as d:
            m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
            if not m:
                raise HTTPException(status_code=404, detail="No such message")
            mem = membership(d, m["room"], w.uid)
            if m["uid"] != w.uid and not w.site_admin and not (mem and mem["role"] == "admin"):
                raise HTTPException(status_code=403, detail="Only the writer or a chat admin can delete a message")
            d.execute("UPDATE messages SET deleted = 1, body = '', card = '', files = '[]', rev = ? WHERE id = ?",
                      (next_rev(d), mid))
        return {"ok": True}

    @app.post("/api/chat/messages/{mid}/react")
    async def react(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{emoji}: add my reaction, or take it away when it is there."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        e = clean_text(body.get("emoji"), 16)
        if not e or re.search(r"[A-Za-z0-9<>&\"']", e):
            raise HTTPException(status_code=400, detail="Pick an emoji")
        with db() as d:
            m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
            if not m or not membership(d, m["room"], w.uid):
                raise HTTPException(status_code=404, detail="No such message")
            try:
                rs = json.loads(m["reactions"] or "{}")
            except ValueError:
                rs = {}
            who = rs.get(e) or []
            if w.uid in who:
                who.remove(w.uid)
            else:
                if e not in rs and len(rs) >= 20:
                    raise HTTPException(status_code=400, detail="That message has enough different reactions")
                who.append(w.uid)
            if who:
                rs[e] = who
            else:
                rs.pop(e, None)
            d.execute("UPDATE messages SET reactions = ?, rev = ? WHERE id = ?", (json.dumps(rs), next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone())

    @app.post("/api/chat/rooms/{rid}/read")
    async def read(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            r = get_room(d, rid)
            seq = min(int(body.get("seq") or r["last_seq"]), r["last_seq"])
            d.execute("UPDATE room_members SET last_read = MAX(last_read, ?) WHERE room = ? AND uid = ?", (seq, rid, w.uid))
        return {"ok": True}

    @app.get("/api/chat/sync")
    async def sync(request: Request, since: int = 0, wait: int = 0, x_viewer_token: str = Header(default="")):
        """What changed in my chats since revision `since`: the rooms (with
        their unread counts) and the new or changed messages. wait=N (up to
        30): when nothing has changed yet, answer as soon as something does,
        or after N seconds."""
        w = me(request, x_viewer_token)
        if wait and since:
            if not _REV[0]:
                with db() as d:
                    _REV[0] = max(_REV[0], d.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"])
            end = time.time() + max(1, min(30, wait))
            while _REV[0] <= since and time.time() < end:
                if await request.is_disconnected():
                    return {"rev": since, "rooms": [], "messages": []}
                await asyncio.sleep(0.2)
        with db() as d:
            rev = d.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"]
            if since >= rev:
                return {"rev": rev, "rooms": [], "messages": []}
            names = dict((k, v["name"]) for k, v in users().items())
            rs = d.execute("SELECT r.* FROM rooms r JOIN room_members m ON m.room = r.id "
                           "WHERE m.uid = ? AND r.rev > ?", (w.uid, since)).fetchall()
            msgs = d.execute("SELECT x.* FROM messages x JOIN room_members m ON m.room = x.room "
                             "WHERE m.uid = ? AND x.rev > ? ORDER BY x.rev LIMIT 500", (w.uid, since)).fetchall() if since else []
            # a chat deleted since: just that, so the page takes it off its list
            return {"rev": rev, "rooms": [{"id": r["id"], "deleted": True} if r["deleted"] else room_view(d, r, w.uid, names) for r in rs],
                    "messages": [msg_row(m) for m in msgs]}

    @app.get("/api/chat/unread")
    async def unread(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if w.uid is None:
            return {"total": 0, "mentions": 0}
        with db() as d:
            r = d.execute(
                "SELECT COUNT(*) AS n, SUM(CASE WHEN x.mentions LIKE ? THEN 1 ELSE 0 END) AS m FROM messages x "
                "JOIN room_members rm ON rm.room = x.room AND rm.uid = ? "
                "JOIN rooms r ON r.id = x.room AND r.deleted = 0 "
                "WHERE x.seq > rm.last_read AND x.deleted = 0 AND (x.uid IS NULL OR x.uid != ?)",
                ("%%,%d,%%" % w.uid, w.uid, w.uid)).fetchone()
        return {"total": r["n"] or 0, "mentions": r["m"] or 0}

    @app.get("/api/chat/search")
    async def search(request: Request, q: str = "", x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        q = clean_text(q, 100)
        if len(q) < 2:
            return {"messages": []}
        with db() as d:
            rows = d.execute("SELECT x.* FROM messages x JOIN room_members m ON m.room = x.room AND m.uid = ? "
                             "WHERE x.deleted = 0 AND (x.body LIKE ? OR x.files LIKE ? OR x.card LIKE ?) "
                             "ORDER BY x.created_at DESC LIMIT 100",
                             (w.uid, "%" + q + "%", "%" + q + "%", "%" + q + "%")).fetchall()
        return {"messages": [msg_row(r) for r in rows]}

    @app.get("/api/chat/project-room")
    async def project_room(request: Request, project: str = "", x_viewer_token: str = Header(default="")):
        """The channel of a register project, if it has one."""
        w = me(request, x_viewer_token)
        with db() as d:
            r = d.execute("SELECT * FROM rooms WHERE kind = 'project' AND project = ? AND deleted = 0", (project,)).fetchone()
            if not r:
                return {"room": None}
            return {"room": {"id": r["id"], "title": r["title"], "member": bool(membership(d, r["id"], w.uid))}}

    # ------------------------------------------------------------ files

    def task_access(w, tid):
        """The task's list role, through tasks.py."""
        if tasks is None:
            return None
        with tasks.Db(os.path.join(core.CFG["data"], "tasks.db")) as td:
            t = td.execute("SELECT list_id FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
            if not t:
                return None
            if w.site_admin:
                return "owner"
            m = td.execute("SELECT role FROM list_members WHERE list_id = ? AND uid = ?", (t["list_id"], w.uid)).fetchone()
            return m["role"] if m else None

    @app.post("/api/chat/upload")
    async def upload(request: Request, room: str = "", task: str = "", name: str = "file",
                     x_viewer_token: str = Header(default="")):
        """The file itself is the request body (no form encoding), so a
        pasted screenshot goes up as it is. ?room= for a chat, ?task= for a
        task comment."""
        w = me(request, x_viewer_token)
        if room:
            with db() as d:
                get_room(d, room)
                if not membership(d, room, w.uid):
                    raise HTTPException(status_code=403, detail="You are not in this chat")
        elif task:
            if task_access(w, task) not in ("owner", "editor"):
                raise HTTPException(status_code=403, detail="You cannot add to this task")
        else:
            raise HTTPException(status_code=400, detail="Send to a chat (room=) or a task (task=)")
        try:
            n = int(request.headers.get("content-length") or 0)
        except ValueError:
            n = 0
        if n > MAX_FILE:
            raise HTTPException(status_code=413, detail="Files up to 50 MB - send a OneDrive or ACC link for larger ones")
        data = await request.body()
        if len(data) > MAX_FILE:
            raise HTTPException(status_code=413, detail="Files up to 50 MB - send a OneDrive or ACC link for larger ones")
        if not data:
            raise HTTPException(status_code=400, detail="An empty file")
        name = clean_text(os.path.basename(name.replace("\\", "/")), 160) or "file"
        mime = (request.headers.get("content-type") or "").split(";")[0].strip() \
            or mimetypes.guess_type(name)[0] or "application/octet-stream"
        fid = new_id()
        ext = re.sub(r"[^a-z0-9]", "", os.path.splitext(name)[1].lower())[:8]
        stored = fid + ("." + ext if ext else "")
        with open(os.path.join(files_dir(), stored), "wb") as f:
            f.write(data)
        with db() as d:
            d.execute("INSERT INTO files (id, room, task, name, size, mime, uid, author, created_at, stored) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?)", (fid, room, task, name, len(data), mime, w.uid, w.name, now_iso(), stored))
            return file_meta(d.execute("SELECT * FROM files WHERE id = ?", (fid,)).fetchone())

    @app.get("/api/chat/files/{fid}/{name}")
    async def download(request: Request, fid: str, name: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)      # the cookie, for <img> and links
        with db() as d:
            f = d.execute("SELECT * FROM files WHERE id = ?", (fid,)).fetchone()
            if not f:
                raise HTTPException(status_code=404, detail="No such file")
            if f["room"]:
                if not membership(d, f["room"], w.uid) and not w.site_admin:
                    raise HTTPException(status_code=403, detail="You are not in that chat")
        if f["task"] and not task_access(w, f["task"]):
            raise HTTPException(status_code=403, detail="You cannot open that task")
        path = os.path.join(files_dir(), f["stored"])
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="The file is no longer on the server")
        inline = f["mime"].split("/")[0] in ("image", "video", "audio") or f["mime"] == "application/pdf"
        return FileResponse(path, media_type=f["mime"], filename=f["name"],
                            content_disposition_type="inline" if inline else "attachment")

    @app.get("/api/chat/rooms/{rid}/files")
    async def room_files(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with db() as d:
            get_room(d, rid)
            if not membership(d, rid, w.uid) and not w.site_admin:
                raise HTTPException(status_code=403, detail="You are not in this chat")
            sent = set()
            for m in d.execute("SELECT files FROM messages WHERE room = ? AND deleted = 0 AND files != '[]'", (rid,)):
                sent.update(x["id"] for x in json.loads(m["files"]))
            rows = d.execute("SELECT * FROM files WHERE room = ? ORDER BY created_at DESC", (rid,)).fetchall()
        return {"files": [dict(file_meta(r), author=r["author"], created_at=r["created_at"]) for r in rows if r["id"] in sent]}
