"""Whiteboards - a free canvas per project for notes, mind maps and rules.

Registered by app.py:  boards.register(app, core)  where `core` is the app
module itself (who, require_project, CFG, accounts_on, ACC ...).

Storage is one SQLite file per project, beside the project's issues
(<data>/projects/<project>/boards.db), for the same reason the issues use
SQLite: several offices write at once, and a JSON file has no way to stop
one save from silently overwriting another.

How people work on one board together:

  * Every object on a board (a sticky, a connector, a mind-map node, a
    comment ...) is its own row. A save replaces whole objects, never the
    whole board, so two people editing different objects never collide.
    Two people editing the SAME object: the later save wins.
  * Each board has its own revision counter. Every save (a batch of
    objects) takes the next number and stamps it on the rows it touched;
    a browser asks for "everything after revision N" and gets only that.
  * Deleting an object leaves a tombstone row, so a browser that was away
    still learns that it is gone.
  * Who is looking at a board right now (names and cursors) is kept in
    memory only - it is worthless after a restart.

The connection is opened for each request and closed again. Nothing here is
hot enough to need a pool, and a file that is never held open can be moved
with its project folder (delete project, restore) without this module
having to be told.
"""

import json
import os
import re
import sqlite3
import threading
import time
import uuid

from fastapi import HTTPException, Request, Header

SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    rev         INTEGER NOT NULL DEFAULT 0,
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_uid INTEGER,
    created_at  TEXT,
    updated_by  TEXT,
    updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS objects (
    board       TEXT NOT NULL,
    id          TEXT NOT NULL,
    rev         INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  TEXT,
    updated_by  TEXT,
    updated_at  TEXT,
    body        TEXT NOT NULL,
    PRIMARY KEY (board, id)
);
CREATE INDEX IF NOT EXISTS idx_objects_rev ON objects(board, rev);
"""

# Limits. A board is notes and diagrams, not a file store: pictures go
# through /api/snapshots and are referenced by path.
MAX_BODY = 4 * 1024 * 1024        # one request
MAX_OBJECT = 64 * 1024            # one object, as JSON
MAX_BATCH = 3000                  # objects in one save
MAX_OBJECTS = 6000                # live objects on one board
MAX_BOARDS = 300                  # live boards in one project
MAX_TITLE = 120
MAX_NAME = 60
PRESENCE_TTL = 12.0               # seconds without a sign of life

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{4,48}$")
SAFE_SRC = re.compile(r"^/snapshots/[0-9a-f]{8,40}\.(jpg|png)$")
TYPES = ("sticky", "text", "shape", "conn", "node", "pen", "image", "frame",
         "link", "comment", "react", "timer")
# What only the server may say about an object.
STAMPS = ("rev", "cby", "cat", "uby", "uat", "deleted")

_LOCKS = {}                       # db path -> lock
_LOCKS_GUARD = threading.Lock()
_READY = set()                    # db paths whose schema has been checked
PRESENCE = {}                     # (project, board) -> {client id: {...}}


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def clean_text(v, limit):
    """A name or a title: one line, bounded, no control characters."""
    s = "" if v is None else str(v)
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", s).strip()
    return s[:limit]


class Db(object):
    """One project's boards. Opened per request (see the note at the top);
    writes are serialised by a lock and run in one transaction each, so a
    save is either wholly there or not at all."""

    def __init__(self, path):
        self.path = path
        with _LOCKS_GUARD:
            self.lock = _LOCKS.setdefault(path, threading.Lock())

    def __enter__(self):
        self.lock.acquire()
        try:
            folder = os.path.dirname(self.path)
            if not os.path.isdir(folder):
                os.makedirs(folder)
                _READY.discard(self.path)
            elif not os.path.isfile(self.path):
                _READY.discard(self.path)       # the project folder was moved away and back
            self.db = sqlite3.connect(self.path, timeout=10)
            self.db.row_factory = sqlite3.Row
            if self.path not in _READY:
                self.db.executescript(SCHEMA)
                self.db.commit()
                _READY.add(self.path)
        except Exception:
            self.lock.release()
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
                self.lock.release()
        return False


def board_row(r, count=None):
    out = {"id": r["id"], "title": r["title"], "rev": r["rev"],
           "created_by": r["created_by"] or "", "created_at": r["created_at"] or "",
           "updated_by": r["updated_by"] or "", "updated_at": r["updated_at"] or ""}
    if count is not None:
        out["count"] = count
    return out


def object_row(r):
    if r["deleted"]:
        return {"id": r["id"], "deleted": True, "rev": r["rev"]}
    o = json.loads(r["body"])
    o["id"] = r["id"]
    o["rev"] = r["rev"]
    o["cby"] = r["created_by"] or ""
    o["cat"] = r["created_at"] or ""
    o["uby"] = r["updated_by"] or ""
    o["uat"] = r["updated_at"] or ""
    return o


def check_object(o):
    """Refuse what should never be stored; return the body to keep."""
    if not isinstance(o, dict):
        raise HTTPException(status_code=400, detail="An object must be a JSON object")
    oid = o.get("id")
    if not isinstance(oid, str) or not SAFE_ID.match(oid):
        raise HTTPException(status_code=400, detail="Bad object id")
    if o.get("t") not in TYPES:
        raise HTTPException(status_code=400, detail="Unknown object type: %s" % str(o.get("t"))[:20])
    body = {k: v for k, v in o.items() if k not in STAMPS and k != "id"}
    src = body.get("src")
    if src is not None and not (isinstance(src, str) and SAFE_SRC.match(src)):
        # Pictures are uploaded as files (/api/snapshots). An inline data URL
        # here is how one board would come to weigh 50 MB.
        raise HTTPException(status_code=400, detail="A picture must be uploaded first (src is not a snapshot path)")
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > MAX_OBJECT:
        raise HTTPException(status_code=413, detail="One object is too large (%d kB at most)" % (MAX_OBJECT // 1024))
    return oid, text


def register(app, core):

    def db_for(pid):
        if core.CFG["single"]:
            pid = "default"
        return Db(os.path.join(core.CFG["data"], "projects", pid, "boards.db"))

    def pkey(pid):
        return "default" if core.CFG["single"] else pid

    def access(request, need, token, project):
        """(who, role, project id). The project comes in the X-Project header
        like every other call; ?project= is accepted too, for a request that
        cannot carry headers."""
        pid = project or request.query_params.get("project", "")
        w, role = core.require_project(request, pid, need, token)
        return w, role, pid

    async def read_json(request):
        try:
            n = int(request.headers.get("content-length") or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY:
            raise HTTPException(status_code=413, detail="Too much in one save")
        raw = await request.body()
        if len(raw) > MAX_BODY:
            raise HTTPException(status_code=413, detail="Too much in one save")
        if not raw:
            return {}
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Expected a JSON object")
        return body

    def person(w, body):
        """Who to write beside a change. With accounts the server knows; with
        the shared passphrase there are no people, so the browser's own
        "your name" is taken at its word, as it is for issues."""
        return w.name or clean_text(body.get("by"), MAX_NAME) or "Someone"

    def get_board(db, bid):
        if not SAFE_ID.match(bid or ""):
            raise HTTPException(status_code=404, detail="No such board")
        r = db.execute("SELECT * FROM boards WHERE id = ? AND deleted = 0", (bid,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such board (it may have been deleted)")
        return r

    def can_delete(w, role, row):
        """The person who made a board, or a project admin."""
        if role == "admin":
            return True
        return bool(w.uid is not None and row["created_uid"] == w.uid)

    def changes(db, bid, since):
        rows = db.execute(
            "SELECT * FROM objects WHERE board = ? AND rev > ? ORDER BY rev",
            (bid, int(since))).fetchall()
        return [object_row(r) for r in rows]

    def write_objects(db, bid, by, upsert, delete, new_board=False):
        """One save: the next revision for the board, stamped on every row
        it touches. Called inside the Db transaction."""
        checked = [check_object(o) for o in upsert]
        ids = [d for d in delete if isinstance(d, str) and SAFE_ID.match(d)]
        if not checked and not ids:
            return db.execute("SELECT rev FROM boards WHERE id = ?", (bid,)).fetchone()["rev"]
        if not new_board:
            live = db.execute("SELECT COUNT(*) AS n FROM objects WHERE board = ? AND deleted = 0",
                              (bid,)).fetchone()["n"]
            fresh = 0
            for oid, _ in checked:
                if not db.execute("SELECT 1 FROM objects WHERE board = ? AND id = ? AND deleted = 0",
                                  (bid, oid)).fetchone():
                    fresh += 1
            if fresh and live + fresh > MAX_OBJECTS:
                raise HTTPException(status_code=413, detail="This board is full (%d objects) - start another one" % MAX_OBJECTS)
        elif len(checked) > MAX_OBJECTS:
            raise HTTPException(status_code=413, detail="Too many objects for one board")
        t = now_iso()
        db.execute("UPDATE boards SET rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ?", (by, t, bid))
        rev = db.execute("SELECT rev FROM boards WHERE id = ?", (bid,)).fetchone()["rev"]
        for oid, text in checked:
            db.execute(
                "INSERT INTO objects (board, id, rev, deleted, created_by, created_at, updated_by, updated_at, body) "
                "VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?) "
                "ON CONFLICT(board, id) DO UPDATE SET rev = excluded.rev, deleted = 0, "
                "  updated_by = excluded.updated_by, updated_at = excluded.updated_at, body = excluded.body",
                (bid, oid, rev, by, t, by, t, text))
        for oid in ids:
            # The body goes too: a tombstone only has to say "gone".
            db.execute("UPDATE objects SET deleted = 1, rev = ?, updated_by = ?, updated_at = ?, body = '{}' "
                       "WHERE board = ? AND id = ?", (rev, by, t, bid, oid))
        return rev

    def presence_list(pid, bid, but=None):
        room = PRESENCE.get((pkey(pid), bid)) or {}
        t = time.time()
        for cid in [c for c, p in room.items() if t - p["ts"] > PRESENCE_TTL]:
            room.pop(cid, None)
        return [{"cid": c, "name": p["name"], "x": p.get("x"), "y": p.get("y"), "ro": p.get("ro", False)}
                for c, p in sorted(room.items()) if c != but]

    # ------------------------------------------------------------ boards

    @app.get("/api/boards")
    async def boards_list(request: Request, x_viewer_token: str = Header(default=""),
                          x_project: str = Header(default="")):
        w, role, pid = access(request, "viewer", x_viewer_token, x_project)
        with db_for(pid) as db:
            rows = db.execute("SELECT * FROM boards WHERE deleted = 0 ORDER BY updated_at DESC").fetchall()
            try:
                # what is on the canvas: not the comments, votes and the timer that hang off it
                counts = dict((r["board"], r["n"]) for r in db.execute(
                    "SELECT board, COUNT(*) AS n FROM objects WHERE deleted = 0 "
                    "AND json_extract(body, '$.t') NOT IN ('comment', 'react', 'timer') GROUP BY board"))
            except sqlite3.OperationalError:
                # an SQLite built without the JSON functions: count everything
                counts = dict((r["board"], r["n"]) for r in db.execute(
                    "SELECT board, COUNT(*) AS n FROM objects WHERE deleted = 0 GROUP BY board"))
            out = []
            for r in rows:
                b = board_row(r, counts.get(r["id"], 0))
                b["can_delete"] = can_delete(w, role, r)
                b["here"] = len(presence_list(pid, r["id"]))
                out.append(b)
        return {"boards": out, "role": role, "can_edit": core.RANK[role] >= core.RANK["member"],
                "name": w.name, "accounts": core.accounts_on()}

    @app.post("/api/boards")
    async def boards_create(request: Request, x_viewer_token: str = Header(default=""),
                            x_project: str = Header(default="")):
        """A new board, optionally with its first objects (a template, an
        imported backup) so that it never exists half-made."""
        w, role, pid = access(request, "member", x_viewer_token, x_project)
        body = await read_json(request)
        title = clean_text(body.get("title"), MAX_TITLE) or "Untitled board"
        objects = body.get("objects") or []
        if not isinstance(objects, list) or len(objects) > MAX_OBJECTS:
            raise HTTPException(status_code=400, detail="Too many objects for one board")
        by = person(w, body)
        bid = "b" + uuid.uuid4().hex[:15]
        t = now_iso()
        with db_for(pid) as db:
            n = db.execute("SELECT COUNT(*) AS n FROM boards WHERE deleted = 0").fetchone()["n"]
            if n >= MAX_BOARDS:
                raise HTTPException(status_code=413, detail="This project has %d boards already - delete some first" % n)
            db.execute("INSERT INTO boards (id, title, rev, deleted, created_by, created_uid, created_at, updated_by, updated_at) "
                       "VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?)", (bid, title, by, w.uid, t, by, t))
            write_objects(db, bid, by, objects, [], new_board=True)
            r = db.execute("SELECT * FROM boards WHERE id = ?", (bid,)).fetchone()
            out = board_row(r, len(objects))
        out["can_delete"] = True
        return {"board": out}

    @app.patch("/api/boards/{bid}")
    async def boards_rename(bid: str, request: Request, x_viewer_token: str = Header(default=""),
                            x_project: str = Header(default="")):
        w, role, pid = access(request, "member", x_viewer_token, x_project)
        body = await read_json(request)
        title = clean_text(body.get("title"), MAX_TITLE)
        if not title:
            raise HTTPException(status_code=400, detail="A board needs a name")
        with db_for(pid) as db:
            get_board(db, bid)
            # No new revision: the title is not an object, and the poll
            # carries it on every round anyway.
            db.execute("UPDATE boards SET title = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                       (title, person(w, body), now_iso(), bid))
            r = get_board(db, bid)
            return {"board": dict(board_row(r), can_delete=can_delete(w, role, r))}

    @app.delete("/api/boards/{bid}")
    async def boards_delete(bid: str, request: Request, x_viewer_token: str = Header(default=""),
                            x_project: str = Header(default="")):
        w, role, pid = access(request, "member", x_viewer_token, x_project)
        with db_for(pid) as db:
            r = get_board(db, bid)
            if not can_delete(w, role, r):
                raise HTTPException(status_code=403, detail="Only the person who made this board (%s) or a project admin can delete it"
                                    % (r["created_by"] or "someone else"))
            # Kept in the file, marked deleted: a board deleted by mistake
            # can be brought back by hand, like a deleted project.
            db.execute("UPDATE boards SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?",
                       (w.name or "", now_iso(), bid))
        PRESENCE.pop((pkey(pid), bid), None)
        return {"deleted": bid}

    @app.post("/api/boards/{bid}/duplicate")
    async def boards_duplicate(bid: str, request: Request, x_viewer_token: str = Header(default=""),
                               x_project: str = Header(default="")):
        w, role, pid = access(request, "member", x_viewer_token, x_project)
        body = await read_json(request)
        by = person(w, body)
        new = "b" + uuid.uuid4().hex[:15]
        t = now_iso()
        with db_for(pid) as db:
            src = get_board(db, bid)
            n = db.execute("SELECT COUNT(*) AS n FROM boards WHERE deleted = 0").fetchone()["n"]
            if n >= MAX_BOARDS:
                raise HTTPException(status_code=413, detail="This project has %d boards already - delete some first" % n)
            title = clean_text(body.get("title"), MAX_TITLE) or clean_text(src["title"] + " (copy)", MAX_TITLE)
            db.execute("INSERT INTO boards (id, title, rev, deleted, created_by, created_uid, created_at, updated_by, updated_at) "
                       "VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?)", (new, title, by, w.uid, t, by, t))
            # Object ids only have to be unique within a board, so the copy
            # keeps them and every connector and parent link stays valid.
            db.execute("INSERT INTO objects (board, id, rev, deleted, created_by, created_at, updated_by, updated_at, body) "
                       "SELECT ?, id, 1, 0, created_by, created_at, updated_by, updated_at, body "
                       "FROM objects WHERE board = ? AND deleted = 0", (new, bid))
            r = db.execute("SELECT * FROM boards WHERE id = ?", (new,)).fetchone()
            count = db.execute("SELECT COUNT(*) AS n FROM objects WHERE board = ?", (new,)).fetchone()["n"]
            out = board_row(r, count)
        out["can_delete"] = True
        return {"board": out}

    # ----------------------------------------------------------- objects

    @app.get("/api/boards/{bid}/objects")
    async def objects_get(bid: str, request: Request, since: int = 0,
                          x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, role, pid = access(request, "viewer", x_viewer_token, x_project)
        with db_for(pid) as db:
            r = get_board(db, bid)
            objs = changes(db, bid, since)
            if not since:
                objs = [o for o in objs if not o.get("deleted")]   # nothing to un-learn on a first load
            return {"rev": r["rev"], "objects": objs,
                    "board": dict(board_row(r), can_delete=can_delete(w, role, r)),
                    "role": role, "can_edit": core.RANK[role] >= core.RANK["member"],
                    "name": w.name, "now": int(time.time() * 1000)}

    @app.post("/api/boards/{bid}/objects")
    async def objects_put(bid: str, request: Request, x_viewer_token: str = Header(default=""),
                          x_project: str = Header(default="")):
        """{"upsert": [object ...], "delete": [id ...], "by": "name"}
        Whole objects replace whole objects; nothing else on the board is
        touched. Answers the board's new revision."""
        w, role, pid = access(request, "member", x_viewer_token, x_project)
        body = await read_json(request)
        upsert = body.get("upsert") or []
        delete = body.get("delete") or []
        if not isinstance(upsert, list) or not isinstance(delete, list):
            raise HTTPException(status_code=400, detail="upsert and delete are lists")
        if len(upsert) + len(delete) > MAX_BATCH:
            raise HTTPException(status_code=413, detail="Too many objects in one save")
        with db_for(pid) as db:
            get_board(db, bid)
            rev = write_objects(db, bid, person(w, body), upsert, delete)
        return {"rev": rev, "saved": len(upsert), "deleted": len(delete)}

    @app.post("/api/boards/{bid}/presence")
    async def presence_post(bid: str, request: Request, x_viewer_token: str = Header(default=""),
                            x_project: str = Header(default="")):
        """The poll. "I am here, my cursor is there, I have seen revision N"
        -> who else is here, and what changed since N. One request does both
        so an open board costs one small round trip every couple of seconds.
        A Viewer may call it: it stores nothing."""
        w, role, pid = access(request, "viewer", x_viewer_token, x_project)
        body = await read_json(request)
        cid = clean_text(body.get("cid"), 40)
        with db_for(pid) as db:
            r = get_board(db, bid)
            out = {"rev": r["rev"], "now": int(time.time() * 1000),
                   "board": dict(board_row(r), can_delete=can_delete(w, role, r))}
            since = body.get("since")
            if isinstance(since, int) and since < r["rev"]:
                out["objects"] = changes(db, bid, since)
        if cid:
            room = PRESENCE.setdefault((pkey(pid), bid), {})
            if body.get("leave"):
                room.pop(cid, None)
            elif cid in room or len(room) < 200:
                def num(v):
                    return round(float(v), 1) if isinstance(v, (int, float)) and abs(v) < 1e7 else None
                room[cid] = {"name": person(w, body), "ts": time.time(), "x": num(body.get("x")),
                             "y": num(body.get("y")), "ro": core.RANK[role] < core.RANK["member"]}
        out["presence"] = presence_list(pid, bid, but=cid)
        return out
