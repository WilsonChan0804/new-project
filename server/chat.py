"""Messenger - the team's chat, inside the viewer (what Lark Messenger did).

Registered by app.py:  chat.register(app, core).

Rooms:
  project  one channel per job on the Projects page. Task and issue
           updates of that job are posted into it as cards, the way the
           Lark bots posted into the group chats.
  group    any group of people, named by whoever starts it
  dm       two people
  topic    a sub-channel of a project channel for one subject (parent =
           the channel); everyone on the project can open and join one

Besides text, a message may carry a poll, an event (with replies and an
.ics for Outlook) or a task, and may be pinned (many per chat).
Formatting is WhatsApp's: *bold* _italic_ ~strike~ `code`, ``` blocks,
lines starting - / 1. / > for lists and quotes.

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
import calendar

import json
import mimetypes
import os
import re
import sqlite3
import threading
import time
import uuid

from fastapi import HTTPException, Request, Header
from fastapi.responses import FileResponse, Response

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
-- What concerns one person outside the chats (a task made theirs, an
-- @mention on a task or an issue, an issue assigned ...): shown and pushed
-- like a message, and listed under the bell.
CREATE TABLE IF NOT EXISTS inbox (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    uid    INTEGER NOT NULL,
    kind   TEXT NOT NULL DEFAULT '',
    title  TEXT NOT NULL DEFAULT '',
    body   TEXT NOT NULL DEFAULT '',
    url    TEXT NOT NULL DEFAULT '',
    at     TEXT NOT NULL,
    rev    INTEGER NOT NULL,
    read   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inbox_uid ON inbox(uid, rev);
CREATE TABLE IF NOT EXISTS notify_prefs (
    uid    INTEGER PRIMARY KEY,
    level  TEXT NOT NULL DEFAULT 'all',
    muted  TEXT NOT NULL DEFAULT '[]'
);
"""

MAX_FILE = 50 * 1024 * 1024
MAX_TEXT = 8000
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{4,48}$")
KINDS = ("project", "group", "dm", "topic")
MAX_PINS = 100

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
                for col in ("pinned_at", "pinned_by"):    # added later: pinned messages
                    if col not in have:
                        self.db.execute("ALTER TABLE messages ADD COLUMN %s TEXT NOT NULL DEFAULT ''" % col)
                if "answers" not in have:         # added later: poll votes, event replies {value: [uid, ...]}
                    self.db.execute("ALTER TABLE messages ADD COLUMN answers TEXT NOT NULL DEFAULT '{}'")
                if "kept" not in have:            # added later: a deleted message's content, for Undo (24 h)
                    self.db.execute("ALTER TABLE messages ADD COLUMN kept TEXT NOT NULL DEFAULT ''")
                have = set(r[1] for r in self.db.execute("PRAGMA table_info(rooms)"))
                if "parent" not in have:          # added later: a topic's project channel
                    self.db.execute("ALTER TABLE rooms ADD COLUMN parent TEXT NOT NULL DEFAULT ''")
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


WHEN = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")
RSVP = ("yes", "maybe", "no")


def poll_card(c):
    """{type: poll, question, options: [text], multi, anonymous, closes}"""
    q = clean_text(c.get("question"), 300)
    opts = []
    for x in (c.get("options") or [])[:10]:
        t = clean_text(x.get("text") if isinstance(x, dict) else x, 120)
        if t and t not in [o["text"] for o in opts]:
            opts.append({"id": "o%d" % (len(opts) + 1), "text": t})
    if not q or len(opts) < 2:
        raise HTTPException(status_code=400, detail="A poll needs a question and at least 2 different choices")
    closes = clean_text(c.get("closes"), 10)    # the last day votes are taken
    return {"type": "poll", "question": q, "title": q, "options": opts, "multi": bool(c.get("multi")),
            "anonymous": bool(c.get("anonymous")), "closes": closes if WHEN.match(closes) else "", "closed": False}


def event_card(c):
    """{type: event, title, start, end, all_day, tz (minutes east of UTC),
    location, link, notes}. Times are the writer's local time."""
    title = clean_text(c.get("title"), 160)
    start, end = clean_text(c.get("start"), 16), clean_text(c.get("end"), 16)
    all_day = bool(c.get("all_day"))
    if all_day:
        start, end = start[:10], (end or start)[:10]
    elif start and not end:
        end = start
    if not title or not WHEN.match(start) or not WHEN.match(end):
        raise HTTPException(status_code=400, detail="An event needs a title and a start date")
    if end < start:
        raise HTTPException(status_code=400, detail="The event ends before it starts")
    try:
        tz = max(-14 * 60, min(14 * 60, int(c.get("tz") or 0)))
    except (TypeError, ValueError):
        tz = 0
    link = clean_text(c.get("link"), 1000)
    if link and not re.match(r"^https?://", link):
        link = ""
    return {"type": "event", "title": title, "start": start, "end": end, "all_day": all_day, "tz": tz,
            "location": clean_text(c.get("location"), 200), "link": link,
            "notes": clean_text(c.get("notes"), 2000, True), "cancelled": False}


def when_text(c):
    """"Mon 6 Oct 2026, 14:00-15:30" - for emails and system lines."""
    def day(x):
        try:
            return time.strftime("%a %d %b %Y", time.strptime(x[:10], "%Y-%m-%d")).replace(" 0", " ")
        except ValueError:
            return x[:10]
    if c.get("all_day"):
        return day(c["start"]) + ("" if c["end"][:10] == c["start"][:10] else " - " + day(c["end"])) + " (all day)"
    t0, t1 = c["start"][11:16], c["end"][11:16]
    if c["end"][:10] == c["start"][:10]:
        return "%s, %s%s" % (day(c["start"]), t0 or "", ("-" + t1) if t1 and t1 != t0 else "")
    return "%s %s - %s %s" % (day(c["start"]), t0, day(c["end"]), t1)


def ics_text(c, uid, organiser, room, url, stamp):
    """An iCalendar (RFC 5545) file for one event card."""
    def esc(v):
        return (v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    def utc(x):
        t = time.strptime(x if "T" in x else x + "T00:00", "%Y-%m-%dT%H:%M")
        return time.strftime("%Y%m%dT%H%M00Z", time.gmtime(calendar.timegm(t) - int(c.get("tz") or 0) * 60))

    def fold(line):
        out, b = [], line.encode("utf-8")
        while len(b) > 74:
            cut = 74
            while cut and (b[cut] & 0xC0) == 0x80:
                cut -= 1
            out.append(b[:cut].decode("utf-8"))
            b = b" " + b[cut:]
        out.append(b.decode("utf-8"))
        return "\r\n".join(out)
    if c.get("all_day"):
        end = time.strftime("%Y%m%d", time.gmtime(calendar.timegm(time.strptime(c["end"][:10], "%Y-%m-%d")) + 86400))
        when = ["DTSTART;VALUE=DATE:" + c["start"][:10].replace("-", ""), "DTEND;VALUE=DATE:" + end]
    else:
        end = c["end"] if c["end"] > c["start"] else c["start"]
        when = ["DTSTART:" + utc(c["start"]), "DTEND:" + utc(end)]
        if end == c["start"]:
            when[1] = "DURATION:PT1H"
    notes = "\n".join(x for x in (c.get("notes"), c.get("link"), ("Chat: " + room) if room else "", url) if x)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LWK Viewer//Messenger//EN", "METHOD:PUBLISH",
             "BEGIN:VEVENT", "UID:%s@lwk-viewer" % uid,
             "DTSTAMP:" + time.strftime("%Y%m%dT%H%M%SZ", time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ"))] + when + [
             "SUMMARY:" + esc(("CANCELLED: " if c.get("cancelled") else "") + c["title"]),
             "DESCRIPTION:" + esc(notes)]
    if c.get("location"):
        lines.append("LOCATION:" + esc(c["location"]))
    if c.get("link"):
        lines.append("URL:" + c["link"])
    if organiser:
        lines.append("ORGANIZER;CN=%s:mailto:noreply@lwk-viewer" % esc(organiser).replace(":", ""))
    lines += ["STATUS:" + ("CANCELLED" if c.get("cancelled") else "CONFIRMED"), "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(fold(x) for x in lines) + "\r\n"


def person_card(c):
    """A card a person may send: WhatsApp messages, a poll or an event.
    (A task goes through task_ref in send(): it needs the sender.)"""
    if not isinstance(c, dict):
        return None
    if c.get("type") == "poll":
        return poll_card(c)
    if c.get("type") == "event":
        return event_card(c)
    return whatsapp_card(c)


FORMAT = re.compile(r"(?<![\w*_~`+])(\+\+|[*_~])(?=\S)([^\n]*?\S)\1(?![\w*_~`+])")
# [label](https://...) written in the message box (its link button)
MD_LINK = re.compile(r"\[([^\]\n]{1,200})\]\((https?://[^\s)]+)\)")


def plain_links(text):
    """The text as it reads, for the chat list and for emails: link labels,
    without the formatting marks."""
    t = LINK_MD.sub(lambda m: m.group(1), text or "")
    t = MD_LINK.sub(lambda m: "%s (%s)" % (m.group(1), m.group(2)), t)
    t = re.sub(r"^```\w*\s*$", "", t, flags=re.M).replace("```", "")
    t = re.sub(r"`([^`\n]+)`", r"\1", t)
    for _ in range(3):
        t = FORMAT.sub(r"\2", t)
    return t


def answers_of(r):
    try:
        return json.loads(r["answers"] or "{}") or {}
    except (IndexError, KeyError, ValueError):
        return {}


def msg_row(r, uid=None):
    """A message for the page of person uid (what they voted, and who
    voted for what unless the poll is anonymous)."""
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
    try:
        if r["pinned_at"]:
            out["pinned"] = {"at": r["pinned_at"], "by": r["pinned_by"]}
    except (IndexError, KeyError):
        pass
    c = out["card"] or {}
    if c.get("type") in ("poll", "event"):
        a = answers_of(r)
        out["counts"] = dict((k, len(v)) for k, v in a.items())
        out["mine"] = [k for k, v in a.items() if uid is not None and uid in v]
        out["voters_n"] = len(set(u for v in a.values() for u in v))
        if not c.get("anonymous"):
            out["voters"] = a
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
    icon = {"poll": "Poll: ", "event": "Event: ", "task": "Task: "}.get((card or {}).get("type"), "")
    preview = plain_links(body) or (icon + ((card or {}).get("title") or "") if card and card.get("title") else "") \
        or ("%d file%s" % (len(files or []), "" if len(files or []) == 1 else "s"))
    d.execute("UPDATE rooms SET last_seq = ?, last_at = ?, last_text = ?, rev = ? WHERE id = ?",
              (seq, t, ((author + ": ") if author else "") + preview[:120], rev, room))
    if uid is not None:
        d.execute("UPDATE room_members SET last_read = ? WHERE room = ? AND uid = ?", (seq, room, uid))
    if PUSH_HOOK and kind != "system":
        try:
            PUSH_HOOK(mid)        # push.py: sent from its own thread once this is committed
        except Exception:
            pass
    return d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()


# ------------------------------------------------------------ notifications

PUSH_HOOK = None
PUSH_INBOX = None
LEVELS = ("all", "mentions", "off")


def inbox_post(uid, kind, title, body="", url=""):
    """Tell one person about something that concerns them (tasks.py,
    app.py): it shows on their open pages within a second or two, is pushed
    to their devices, and is listed under the bell."""
    if CORE is None or uid is None:
        return
    try:
        with db() as d:
            if notify_prefs(d, uid)["level"] == "off":
                return
            rev = next_rev(d)
            cur = d.execute("INSERT INTO inbox (uid, kind, title, body, url, at, rev) VALUES (?,?,?,?,?,?,?)",
                            (int(uid), str(kind)[:20], str(title)[:200], str(body)[:400], str(url)[:500], now_iso(), rev))
            iid = cur.lastrowid
            d.execute("DELETE FROM inbox WHERE uid = ? AND id < ?", (int(uid), iid - 300))
    except Exception as e:
        print("inbox: %s" % e)
        return
    if PUSH_INBOX:
        try:
            PUSH_INBOX(int(uid), {"title": str(title)[:200], "body": str(body)[:240], "url": url or "messenger.html",
                                  "tag": "in%d" % iid})
        except Exception:
            pass


def inbox_row(r):
    return {"id": "in%d" % r["id"], "inbox": True, "kind": r["kind"], "title": r["title"], "body": r["body"],
            "url": r["url"], "at": r["at"], "read": bool(r["read"]), "mention": r["kind"] == "mention"}


def notify_prefs(d, uid):
    """{level: all | mentions | off, muted: [room ids]} of a person."""
    r = d.execute("SELECT level, muted FROM notify_prefs WHERE uid = ?", (uid,)).fetchone()
    if not r:
        return {"level": "all", "muted": []}
    try:
        muted = [x for x in json.loads(r["muted"] or "[]") if isinstance(x, str)]
    except ValueError:
        muted = []
    return {"level": r["level"] if r["level"] in LEVELS else "all", "muted": muted}


def wants(pref, room_id, room_kind, mentioned):
    """Does this person want to be told about a message (their level and
    the chats they muted)? A mention of them gets through a muted chat."""
    if pref["level"] == "off":
        return False
    if mentioned:
        return True
    if room_id in pref["muted"]:
        return False
    return pref["level"] == "all" or room_kind == "dm"


def notice_of(r, room, uid):
    """What a notification about message r says, for person uid."""
    text = plain_links(r["body"] or "")
    if not text and r["card"]:
        try:
            c = json.loads(r["card"]) or {}
        except ValueError:
            c = {}
        text = {"poll": "Poll: ", "event": "Event: ", "task": "Task: "}.get(c.get("type"), "") + (c.get("title") or c.get("question") or "")
    if not text:
        try:
            n = len(json.loads(r["files"] or "[]"))
        except ValueError:
            n = 0
        text = "%d file%s" % (n, "" if n == 1 else "s") if n else "New message"
    mentioned = ",%d," % uid in (r["mentions"] or "")
    title = r["author"] or "Messenger"
    if room["kind"] != "dm":
        title = "%s · %s" % (r["author"] or "", room["title"] or "Chat")
    return {"id": r["id"], "room": room["id"], "title": title, "body": text[:240], "mention": mentioned,
            "dm": room["kind"] == "dm", "url": "messenger.html?room=%s&at=%s" % (room["id"], r["id"]),
            "at": r["created_at"]}


def notify_targets(mid):
    """[(uid, notice)] for a new message: everyone in the chat but its
    writer who wants to hear about it (push.py)."""
    with db() as d:
        r = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
        if not r or r["kind"] == "system":
            return []
        room = d.execute("SELECT * FROM rooms WHERE id = ? AND deleted = 0", (r["room"],)).fetchone()
        if not room:
            return []
        out = []
        for m in d.execute("SELECT uid FROM room_members WHERE room = ?", (room["id"],)).fetchall():
            if m["uid"] == r["uid"]:
                continue
            n = notice_of(r, room, m["uid"])
            if wants(notify_prefs(d, m["uid"]), room["id"], room["kind"], n["mention"]):
                out.append((m["uid"], n))
        return out


def search_messages(uid, words, limit=20):
    """Messages in the chats this person is in with every word (the search
    on every page, tasks.py): [{id, room, room_title, author, body, at}]."""
    if CORE is None or uid is None or not words:
        return []
    cond = " AND ".join(["(LOWER(x.body) LIKE ? OR LOWER(x.files) LIKE ? OR LOWER(x.card) LIKE ?)"] * len(words))
    args = [uid]
    for wd in words:
        args += ["%" + wd + "%"] * 3
    with db() as d:
        rows = d.execute("SELECT x.*, r.title AS room_title, r.kind AS room_kind FROM messages x "
                         "JOIN room_members m ON m.room = x.room AND m.uid = ? "
                         "JOIN rooms r ON r.id = x.room AND r.deleted = 0 "
                         "WHERE x.deleted = 0 AND " + cond + " ORDER BY x.created_at DESC LIMIT ?",
                         args + [limit]).fetchall()
    def said(r):
        if r["body"]:
            return plain_links(r["body"])[:300]
        try:
            c = json.loads(r["card"] or "{}") or {}
        except ValueError:
            c = {}
        inner = c.get("inner") or {}
        t = c.get("title") or inner.get("title") or ""
        n = c.get("number") or inner.get("number")
        return (("#%s " % n) if n else "") + t
    return [{"id": r["id"], "room": r["room"], "room_title": r["room_title"] if r["room_kind"] != "dm" else "Direct message",
             "author": r["author"], "body": said(r), "at": r["created_at"],
             "files": [f.get("name") for f in json.loads(r["files"] or "[]")]} for r in rows]


def post_card(reg_ids, card, author="", skip=""):
    """A task or issue update, into the channels of those register projects
    (called by tasks.py and app.py). Never raises: a card that cannot be
    posted must not stop the save it reports. skip: a chat that already
    has it (a task sent there by hand)."""
    if CORE is None or not reg_ids:
        return
    try:
        with db() as d:
            for reg in set(reg_ids):
                r = d.execute("SELECT id FROM rooms WHERE kind = 'project' AND project = ? AND deleted = 0",
                              (reg,)).fetchone()
                if r and r["id"] != skip:
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
        if room["kind"] not in ("project", "topic"):
            return False
        uids, _ = project_people(room["project"])
        return w.uid in uids

    _ADMIN = {}

    def project_admin(w, reg):
        """tasks.project_admin, remembered for half a minute (the chat list
        and every sync ask it for each project channel)."""
        if w.site_admin:
            return True
        if tasks is None or not reg:
            return False
        k = (w.uid, reg)
        hit = _ADMIN.get(k)
        if hit and hit[0] > time.time():
            return hit[1]
        v = tasks.project_admin(core, w, reg)
        if len(_ADMIN) > 5000:
            _ADMIN.clear()
        _ADMIN[k] = (time.time() + 30, v)
        return v

    def can_delete_room(d, w, r, m=None):
        """A direct message: either of the two. A group: its admins. A
        project channel or topic: the project's admins. Site admins: all."""
        m = m if m is not None else membership(d, r["id"], w.uid)
        if r["kind"] == "dm":
            return bool(m) or w.site_admin
        if w.site_admin:
            return True
        if r["kind"] == "group":
            return bool(m and m["role"] == "admin")
        return project_admin(w, r["project"])

    def room_view(d, r, w, names=None):
        uid = w.uid
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
        return {"id": r["id"], "kind": r["kind"], "title": title, "project": r["project"], "parent": r["parent"],
                "can_delete": can_delete_room(d, w, r, m),
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
            out = [room_view(d, r, w, names) for r in mine]
            have = set(r["id"] for r in mine)
            others = d.execute("SELECT * FROM rooms WHERE kind IN ('project', 'topic') AND deleted = 0").fetchall()
        joinable = []
        for r in others:
            if r["id"] not in have and can_join(w, r):
                joinable.append({"id": r["id"], "kind": r["kind"], "title": r["title"], "project": r["project"],
                                 "parent": r["parent"]})
        return {"rooms": out, "joinable": joinable, "me": w.uid}

    @app.post("/api/chat/rooms")
    async def room_create(request: Request, x_viewer_token: str = Header(default="")):
        """{kind: "dm", user} | {kind: "group", title, members} | {kind: "project", project}
        | {kind: "topic", parent: project channel id, title, description}"""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        kind = body.get("kind")
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail="kind: dm, group, project or topic")
        us = users()
        t = now_iso()
        parent, desc = "", ""
        with db() as d:
            if kind == "topic":
                par = get_room(d, clean_text(body.get("parent"), 48))
                if par["kind"] != "project":
                    raise HTTPException(status_code=400, detail="A topic belongs to a project channel")
                if not membership(d, par["id"], w.uid) and not w.site_admin:
                    raise HTTPException(status_code=403, detail="Join the project channel first")
                title = clean_text(body.get("title"), 80)
                if not title:
                    raise HTTPException(status_code=400, detail="Give the topic a name")
                if d.execute("SELECT 1 FROM rooms WHERE kind = 'topic' AND parent = ? AND deleted = 0 AND LOWER(title) = ?",
                             (par["id"], title.lower())).fetchone():
                    raise HTTPException(status_code=409, detail="This channel already has a topic with that name")
                parent, project, key = par["id"], par["project"], ""
                desc = clean_text(body.get("description"), 2000, True)
                members = set(x["uid"] for x in d.execute("SELECT uid FROM room_members WHERE room = ?", (parent,))
                              if x["uid"] in us) | {w.uid}
            elif kind == "dm":
                try:
                    other = int(body.get("user"))
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="Who to talk to?")
                if other not in us:
                    raise HTTPException(status_code=404, detail="No such person")
                key = "%d:%d" % tuple(sorted((w.uid, other)))
                r = d.execute("SELECT * FROM rooms WHERE kind = 'dm' AND dm_key = ? AND deleted = 0", (key,)).fetchone()
                if r:
                    return room_view(d, r, w, dict((k, v["name"]) for k, v in us.items()))
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
                    return room_view(d, r, w)
                uids, reg = project_people(project)
                if not reg:
                    raise HTTPException(status_code=404, detail="No such project on the Projects page")
                if not w.site_admin and w.uid not in uids:
                    raise HTTPException(status_code=403, detail="You are not on this project")
                members = set(u for u in uids if u in us) | {w.uid}
                title = reg["short"] or reg["name"]
                key = ""
            rid = new_id()
            d.execute("INSERT INTO rooms (id, kind, title, project, dm_key, created_by, created_uid, created_at, last_at, rev, "
                      "parent, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      (rid, kind, title, project, key, w.name, w.uid, t, t, next_rev(d), parent, desc))
            for u in members:
                d.execute("INSERT INTO room_members (room, uid, role, joined_at) VALUES (?, ?, ?, ?)",
                          (rid, u, "admin" if u == w.uid else "member", t))
            if kind != "dm":
                _insert(d, rid, None, "", "system", body="%s started %s" % (w.name, title))
            if kind == "topic":
                _insert(d, parent, None, "", "system", body="%s opened the topic # %s" % (w.name, title))
            return room_view(d, d.execute("SELECT * FROM rooms WHERE id = ?", (rid,)).fetchone(), w,
                             dict((k, v["name"]) for k, v in us.items()))

    @app.patch("/api/chat/rooms/{rid}")
    async def room_rename(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            r = get_room(d, rid)
            m = membership(d, rid, w.uid)
            if r["kind"] == "dm" or not (w.site_admin or (m and m["role"] == "admin")
                                         or (r["kind"] in ("project", "topic") and project_admin(w, r["project"]))):
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
        """Gone for everyone. Who may: either person of a direct message, a
        group's admins, a project's admins for its channel and topics, and
        site admins (can_delete_room). A project channel takes its topics
        with it. The messages are kept in the file, out of sight, in case it
        was a mistake."""
        w = me(request, x_viewer_token)
        with db() as d:
            r = get_room(d, rid)
            if not can_delete_room(d, w, r):
                raise HTTPException(status_code=403, detail={
                    "dm": "Only the two people in it can delete a direct message",
                    "group": "Only the group's admins can delete it"}.get(
                        r["kind"], "Only the project's admins can delete its channel and topics"))
            rev = next_rev(d)
            d.execute("UPDATE rooms SET deleted = 1, rev = ? WHERE id = ?", (rev, rid))
            if r["kind"] == "project":
                d.execute("UPDATE rooms SET deleted = 1, rev = ? WHERE kind = 'topic' AND parent = ?", (rev, rid))
            elif r["kind"] == "topic" and r["parent"]:
                _insert(d, r["parent"], None, "", "system", body="%s deleted the topic # %s" % (w.name, r["title"]))
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
    async def messages(request: Request, rid: str, before: int = 0, around: int = 0, at: str = "", limit: int = 60,
                       x_viewer_token: str = Header(default="")):
        """The latest messages, those before seq `before`, or those around
        seq `around` / message `at` (a pinned message or a search hit) -
        then `newer` says there are later ones than this page."""
        w = me(request, x_viewer_token)
        names = dict((k, v["name"]) for k, v in users().items())
        limit = max(1, min(200, limit))
        with db() as d:
            r = get_room(d, rid)
            if not membership(d, rid, w.uid) and not w.site_admin:
                raise HTTPException(status_code=403, detail="You are not in this chat")
            if at:
                x = d.execute("SELECT seq FROM messages WHERE id = ? AND room = ?", (clean_text(at, 48), rid)).fetchone()
                around = x["seq"] if x else 0
            if around and around > r["last_seq"] - limit // 2:
                around = 0          # among the latest anyway
            if around:
                lo = max(1, around - limit // 2)
                rows = [msg_row(x, w.uid) for x in d.execute(
                    "SELECT * FROM messages WHERE room = ? AND seq >= ? AND seq < ? ORDER BY seq", (rid, lo, lo + limit))]
            else:
                q = "SELECT * FROM messages WHERE room = ?" + (" AND seq < ?" if before else "") + " ORDER BY seq DESC LIMIT ?"
                args = [rid] + ([before] if before else []) + [limit]
                rows = [msg_row(x, w.uid) for x in d.execute(q, args)][::-1]
            view = room_view(d, r, w, names)
        return {"room": view, "messages": rows, "more": bool(rows) and rows[0]["seq"] > 1,
                "newer": bool(around) and bool(rows) and rows[-1]["seq"] < r["last_seq"]}

    def task_ref(w, c):
        """{type: task_ref, task}: the task as a card, if the sender may open it."""
        if tasks is None:
            raise HTTPException(status_code=400, detail="Tasks are not available on this server")
        tc = tasks.task_card(core, w, c.get("task"))
        if not tc:
            raise HTTPException(status_code=403, detail="You cannot open that task")
        return tc

    @app.post("/api/chat/rooms/{rid}/messages")
    async def send(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """{body, files: [file id], reply_to, card}. A card a person may send:
        {type: "whatsapp"} (messages copied or exported from WhatsApp),
        {type: "poll"}, {type: "event"} or {type: "task_ref", task}."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_TEXT, True).strip()
        raw = body.get("card")
        card = task_ref(w, raw) if isinstance(raw, dict) and raw.get("type") == "task_ref" else person_card(raw)
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
        base = core.CFG.get("base_url") or ""
        if ments:
            mail(ments, "%s mentioned you in %s" % (w.name, title),
                 "%s wrote in %s:\n\n%s\n\n%smessenger.html?room=%s" % (w.name, title, plain_links(text), base, rid))
        if card and card["type"] == "event":
            mail([u for u in members if u != w.uid], "Invitation: %s (%s)" % (card["title"], when_text(card)),
                 "%s invited %s to:\n\n%s\n%s%s%s\n\nReply and add it to your calendar:\n%smessenger.html?room=%s&msg=%s"
                 % (w.name, title, card["title"], when_text(card),
                    ("\n" + card["location"]) if card["location"] else "", ("\n" + card["link"]) if card["link"] else "",
                    base, rid, row["id"]))
        return msg_row(row, w.uid)

    def own_message(d, w, mid, what):
        m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="No such message")
        if m["uid"] is None or m["uid"] != w.uid:
            raise HTTPException(status_code=403, detail="Only the person who sent a message can %s it" % what)
        return m

    @app.patch("/api/chat/messages/{mid}")
    async def edit(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_TEXT, True).strip()
        with db() as d:
            m = own_message(d, w, mid, "edit")
            if not text and not json.loads(m["files"] or "[]") and not m["card"]:
                raise HTTPException(status_code=400, detail="An empty message - delete it instead")
            d.execute("UPDATE messages SET body = ?, edited_at = ?, rev = ? WHERE id = ?", (text, now_iso(), next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.delete("/api/chat/messages/{mid}")
    async def remove(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """Only the person who sent it (not a chat admin, not a site admin)."""
        w = me(request, x_viewer_token)
        with db() as d:
            m = own_message(d, w, mid, "delete")
            # what it said is kept, unseen by anyone, for a day: the sender
            # can undo the delete (Ctrl+Z) - then it is gone for good
            kept = m["kept"] if m["deleted"] else json.dumps({"at": time.time(), "m": {
                k: m[k] for k in ("body", "card", "files", "answers", "pinned_at", "pinned_by")}})
            d.execute("UPDATE messages SET deleted = 1, body = '', card = '', files = '[]', answers = '{}', "
                      "pinned_at = '', pinned_by = '', kept = ?, rev = ? WHERE id = ?", (kept, next_rev(d), mid))
            forget_kept(d)
        return {"ok": True}

    KEEP_S = 24 * 3600

    def forget_kept(d):
        for r in d.execute("SELECT id, kept FROM messages WHERE kept != ''").fetchall():
            try:
                old = time.time() - json.loads(r["kept"]).get("at", 0) > KEEP_S
            except ValueError:
                old = True
            if old:
                d.execute("UPDATE messages SET kept = '' WHERE id = ?", (r["id"],))

    @app.post("/api/chat/messages/{mid}/restore")
    async def restore(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """Undo a delete: only the sender, within a day."""
        w = me(request, x_viewer_token)
        with db() as d:
            m = d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone()
            if not m:
                raise HTTPException(status_code=404, detail="No such message")
            if m["uid"] is None or m["uid"] != w.uid:
                raise HTTPException(status_code=403, detail="Only the person who sent a message can restore it")
            if not m["deleted"]:
                return msg_row(m, w.uid)
            try:
                k = json.loads(m["kept"] or "")
            except ValueError:
                k = None
            if not k or time.time() - k.get("at", 0) > KEEP_S:
                raise HTTPException(status_code=410, detail="That message was deleted too long ago to bring back")
            v = k.get("m") or {}
            d.execute("UPDATE messages SET deleted = 0, body = ?, card = ?, files = ?, answers = ?, pinned_at = ?, "
                      "pinned_by = ?, kept = '', rev = ? WHERE id = ?",
                      (v.get("body", ""), v.get("card", ""), v.get("files", "[]"), v.get("answers", "{}"),
                       v.get("pinned_at", ""), v.get("pinned_by", ""), next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    # ------------------------------------------------------------ pins

    def member_message(d, w, mid):
        m = d.execute("SELECT * FROM messages WHERE id = ? AND deleted = 0", (mid,)).fetchone()
        if not m or not membership(d, m["room"], w.uid):
            raise HTTPException(status_code=404, detail="No such message")
        return m

    @app.post("/api/chat/messages/{mid}/pin")
    async def pin(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{on: true|false}. Anyone in the chat; up to MAX_PINS a chat."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        on = bool(body.get("on", True))
        with db() as d:
            m = member_message(d, w, mid)
            if m["kind"] == "system":
                raise HTTPException(status_code=400, detail="That line cannot be pinned")
            if on and not m["pinned_at"]:
                n = d.execute("SELECT COUNT(*) AS n FROM messages WHERE room = ? AND deleted = 0 AND pinned_at != ''",
                              (m["room"],)).fetchone()["n"]
                if n >= MAX_PINS:
                    raise HTTPException(status_code=400, detail="This chat has %d pinned messages - unpin one first" % MAX_PINS)
                d.execute("UPDATE messages SET pinned_at = ?, pinned_by = ?, rev = ? WHERE id = ?",
                          (now_iso(), w.name, next_rev(d), mid))
                _insert(d, m["room"], None, "", "system", body="%s pinned a message" % w.name)
            elif not on and m["pinned_at"]:
                d.execute("UPDATE messages SET pinned_at = '', pinned_by = '', rev = ? WHERE id = ?", (next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.get("/api/chat/rooms/{rid}/pins")
    async def pins(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """The pinned messages of a chat, the latest pinned first."""
        w = me(request, x_viewer_token)
        with db() as d:
            get_room(d, rid)
            if not membership(d, rid, w.uid) and not w.site_admin:
                raise HTTPException(status_code=403, detail="You are not in this chat")
            rows = d.execute("SELECT * FROM messages WHERE room = ? AND deleted = 0 AND pinned_at != '' "
                             "ORDER BY pinned_at DESC, seq DESC", (rid,)).fetchall()
        return {"messages": [msg_row(r, w.uid) for r in rows]}

    # ------------------------------------------------------------ polls and events

    def set_answers(d, m, a):
        d.execute("UPDATE messages SET answers = ?, rev = ? WHERE id = ?",
                  (json.dumps(dict((k, v) for k, v in a.items() if v)), next_rev(d), m["id"]))

    @app.post("/api/chat/messages/{mid}/vote")
    async def vote(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{options: [option id]}: my answer to a poll (replaces my last
        one; [] takes it back)."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            m = member_message(d, w, mid)
            c = json.loads(m["card"] or "{}") or {}
            if c.get("type") != "poll":
                raise HTTPException(status_code=400, detail="That message is not a poll")
            if c.get("closed") or (c.get("closes") and c["closes"] < now_iso()[:len(c["closes"])]):
                raise HTTPException(status_code=400, detail="This poll is closed")
            ids = [o["id"] for o in c["options"]]
            pick = [x for x in (body.get("options") or []) if x in ids]
            pick = sorted(set(pick), key=ids.index)
            if not c.get("multi"):
                pick = pick[:1]
            a = answers_of(m)
            for k in ids:
                v = [u for u in a.get(k, []) if u != w.uid]
                if k in pick:
                    v.append(w.uid)
                a[k] = v
            set_answers(d, m, a)
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.post("/api/chat/messages/{mid}/close")
    async def close_poll(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{closed: true|false}: the poll's writer stops (or reopens) the voting."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            m = own_message(d, w, mid, "close")
            c = json.loads(m["card"] or "{}") or {}
            if c.get("type") != "poll":
                raise HTTPException(status_code=400, detail="That message is not a poll")
            c["closed"] = bool(body.get("closed", True))
            if not c["closed"]:
                c["closes"] = ""
            d.execute("UPDATE messages SET card = ?, rev = ? WHERE id = ?", (json.dumps(c), next_rev(d), mid))
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.post("/api/chat/messages/{mid}/rsvp")
    async def rsvp(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """{value: yes | maybe | no | ""}: my reply to an event."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        v = body.get("value") or ""
        if v and v not in RSVP:
            raise HTTPException(status_code=400, detail="yes, maybe or no")
        with db() as d:
            m = member_message(d, w, mid)
            c = json.loads(m["card"] or "{}") or {}
            if c.get("type") != "event":
                raise HTTPException(status_code=400, detail="That message is not an event")
            if c.get("cancelled"):
                raise HTTPException(status_code=400, detail="This event was cancelled")
            a = answers_of(m)
            for k in RSVP:
                a[k] = [u for u in a.get(k, []) if u != w.uid] + ([w.uid] if k == v else [])
            set_answers(d, m, a)
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.patch("/api/chat/messages/{mid}/event")
    async def event_edit(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """The event's writer changes it ({title, start, ...} as when sent)
        or cancels it ({cancelled: true}). The chat is told."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            m = own_message(d, w, mid, "change")
            c = json.loads(m["card"] or "{}") or {}
            if c.get("type") != "event":
                raise HTTPException(status_code=400, detail="That message is not an event")
            if body.get("cancelled"):
                c["cancelled"] = True
                say = "%s cancelled the event %s" % (w.name, c["title"])
            else:
                c = event_card(dict(c, **dict((k, v) for k, v in body.items() if k != "type")))
                say = "%s changed the event %s (%s)" % (w.name, c["title"], when_text(c))
            d.execute("UPDATE messages SET card = ?, edited_at = ?, rev = ? WHERE id = ?",
                      (json.dumps(c), now_iso(), next_rev(d), mid))
            _insert(d, m["room"], None, "", "system", body=say)
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

    @app.get("/api/chat/messages/{mid}/event.ics")
    async def event_ics(request: Request, mid: str, x_viewer_token: str = Header(default="")):
        """The event for Outlook, Google or the phone's calendar."""
        w = core.who(request, x_viewer_token)      # the cookie, for a plain link
        with db() as d:
            m = member_message(d, w, mid)
            c = json.loads(m["card"] or "{}") or {}
            if c.get("type") != "event":
                raise HTTPException(status_code=404, detail="That message is not an event")
            room = d.execute("SELECT * FROM rooms WHERE id = ?", (m["room"],)).fetchone()
        base = core.CFG.get("base_url") or ""
        url = "%smessenger.html?room=%s&msg=%s" % (base, m["room"], mid)
        data = ics_text(c, mid, m["author"], room["title"] if room["kind"] != "dm" else "", url, m["edited_at"] or m["created_at"])
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", c["title"])[:60] or "event"
        return Response(content=data, media_type="text/calendar; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="%s.ics"' % name})

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
            return msg_row(d.execute("SELECT * FROM messages WHERE id = ?", (mid,)).fetchone(), w.uid)

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
            return {"rev": rev, "rooms": [{"id": r["id"], "deleted": True} if r["deleted"] else room_view(d, r, w, names) for r in rs],
                    "messages": [msg_row(m, w.uid) for m in msgs]}

    @app.get("/api/chat/notify")
    async def notify(request: Request, since: int = 0, wait: int = 0, x_viewer_token: str = Header(default="")):
        """For the notifications on every page (notify.js): the new messages
        for me since revision `since` that I want to hear about, and my
        unread counts. wait=N (up to 30): held open until something changes,
        so a message shows within a second or two."""
        w = core.who(request, x_viewer_token)
        if w.uid is None:
            return {"rev": 0, "items": [], "total": 0, "mentions": 0, "level": "off"}
        if wait and since:
            if not _REV[0]:
                with db() as d:
                    _REV[0] = max(_REV[0], d.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"])
            end = time.time() + max(1, min(30, wait))
            while _REV[0] <= since and time.time() < end:
                if await request.is_disconnected():
                    return {"rev": since, "items": [], "same": True}
                await asyncio.sleep(0.3)
        with db() as d:
            rev = d.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"]
            pref = notify_prefs(d, w.uid)
            items = []
            if since and since < rev:
                rows = d.execute(
                    "SELECT x.*, r.kind AS room_kind, r.title AS room_title FROM messages x "
                    "JOIN room_members m ON m.room = x.room AND m.uid = ? "
                    "JOIN rooms r ON r.id = x.room AND r.deleted = 0 "
                    "WHERE x.rev > ? AND x.deleted = 0 AND x.kind != 'system' AND x.edited_at = '' "
                    "AND (x.uid IS NULL OR x.uid != ?) AND x.seq > m.last_read ORDER BY x.rev LIMIT 50",
                    (w.uid, since, w.uid)).fetchall()
                for x in rows:
                    room = {"id": x["room"], "kind": x["room_kind"], "title": x["room_title"]}
                    n = notice_of(x, room, w.uid)
                    if wants(pref, room["id"], room["kind"], n["mention"]):
                        items.append(n)
                if pref["level"] != "off":
                    items += [inbox_row(x) for x in d.execute(
                        "SELECT * FROM inbox WHERE uid = ? AND rev > ? ORDER BY rev LIMIT 30", (w.uid, since))]
            c = d.execute(
                "SELECT COUNT(*) AS n, SUM(CASE WHEN x.mentions LIKE ? THEN 1 ELSE 0 END) AS m FROM messages x "
                "JOIN room_members rm ON rm.room = x.room AND rm.uid = ? "
                "JOIN rooms r ON r.id = x.room AND r.deleted = 0 "
                "WHERE x.seq > rm.last_read AND x.deleted = 0 AND (x.uid IS NULL OR x.uid != ?)",
                ("%%,%d,%%" % w.uid, w.uid, w.uid)).fetchone()
            unseen = d.execute("SELECT COUNT(*) AS n FROM inbox WHERE uid = ? AND read = 0", (w.uid,)).fetchone()["n"]
        return {"rev": rev, "items": items, "total": c["n"] or 0, "mentions": c["m"] or 0,
                "inbox": unseen, "level": pref["level"], "muted": pref["muted"]}

    @app.get("/api/chat/inbox")
    async def inbox_list(request: Request, x_viewer_token: str = Header(default="")):
        """The latest things that concerned me (under the bell)."""
        w = me(request, x_viewer_token)
        with db() as d:
            rows = d.execute("SELECT * FROM inbox WHERE uid = ? ORDER BY id DESC LIMIT 50", (w.uid,)).fetchall()
            unseen = d.execute("SELECT COUNT(*) AS n FROM inbox WHERE uid = ? AND read = 0", (w.uid,)).fetchone()["n"]
        return {"items": [inbox_row(r) for r in rows], "unread": unseen}

    @app.post("/api/chat/inbox/read")
    async def inbox_read(request: Request, x_viewer_token: str = Header(default="")):
        """{ids: ["in12", ...]} or {all: true}."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            if body.get("all"):
                d.execute("UPDATE inbox SET read = 1 WHERE uid = ?", (w.uid,))
            else:
                ids = [int(str(x)[2:]) for x in (body.get("ids") or [])[:200] if str(x).startswith("in") and str(x)[2:].isdigit()]
                for i in ids:
                    d.execute("UPDATE inbox SET read = 1 WHERE uid = ? AND id = ?", (w.uid, i))
        return {"ok": True}

    @app.get("/api/chat/notify-settings")
    async def notify_get(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        with db() as d:
            return notify_prefs(d, w.uid)

    @app.post("/api/chat/notify-settings")
    async def notify_set(request: Request, x_viewer_token: str = Header(default="")):
        """{level: all | mentions | off} and/or {mute_room: id, on: true|false}."""
        w = me(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            p = notify_prefs(d, w.uid)
            if "level" in body:
                if body["level"] not in LEVELS:
                    raise HTTPException(status_code=400, detail="level: all, mentions or off")
                p["level"] = body["level"]
            rid = body.get("mute_room")
            if rid:
                if not membership(d, str(rid), w.uid):
                    raise HTTPException(status_code=404, detail="No such chat")
                p["muted"] = [x for x in p["muted"] if x != rid] + ([str(rid)] if body.get("on", True) else [])
            d.execute("INSERT INTO notify_prefs (uid, level, muted) VALUES (?, ?, ?) "
                      "ON CONFLICT(uid) DO UPDATE SET level = excluded.level, muted = excluded.muted",
                      (w.uid, p["level"], json.dumps(p["muted"])))
            return p

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
        return {"messages": [msg_row(r, w.uid) for r in rows]}

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
