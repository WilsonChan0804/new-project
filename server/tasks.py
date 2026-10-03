"""Tasks - team task lists, the Lark replacement, joined to the viewer.

Registered by app.py:  tasks.register(app, core)  where `core` is the app
module itself (who, require_project, CFG, ACC, send_mail ...).

Why the lists are not per project, as issues and boards are: a team (say
LWK-MANILA) runs one list across every job it works on, with a group per job
(SKW, Kai Tak 2A3, NDH ...). So tasks live in one file for the whole server,
<data>/tasks.db, and each group may name the viewer project it is about.
That is what lets a task point at that project's issues, sheets and 3D
views, and an issue show the tasks that point at it.

How saving works:

  * A browser sends only the fields it changed (a patch), never the whole
    task. Two people editing different fields of one task therefore both
    keep their change; the same field: the later save wins.
  * Every write takes the next number from one revision counter and stamps
    it on the rows it touched; a browser asks for "everything in this list
    after revision N".
  * Every changed field is written to the activity table here, on the
    server, so the history cannot be edited away from a browser - the same
    rule as the issue history in app.py stamp().

Files in OneDrive, SharePoint and ACC are stored as links on the task (and
on issues, in app.py). Opening them is left to OneDrive / ACC themselves,
so their own permissions keep applying.
"""

import csv
import io
import json
import os
import re
import sqlite3
import threading
import time
import uuid

from fastapi import HTTPException, Request, Header

SCHEMA = """
CREATE TABLE IF NOT EXISTS counter (
    name  TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO counter (name, value) VALUES ('rev', '0');

CREATE TABLE IF NOT EXISTS lists (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    team        TEXT NOT NULL DEFAULT '',
    next_number INTEGER NOT NULL DEFAULT 1,
    rev         INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT, created_uid INTEGER, created_at TEXT,
    updated_by  TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS list_members (
    list_id TEXT NOT NULL,
    uid     INTEGER NOT NULL,
    role    TEXT NOT NULL,
    PRIMARY KEY (list_id, uid)
);
CREATE TABLE IF NOT EXISTS groups (
    id       TEXT PRIMARY KEY,
    list_id  TEXT NOT NULL,
    title    TEXT NOT NULL,
    project  TEXT NOT NULL DEFAULT '',
    sort     REAL NOT NULL DEFAULT 0,
    rev      INTEGER NOT NULL,
    deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_groups_list ON groups(list_id, rev);
CREATE TABLE IF NOT EXISTS fields (
    id       TEXT PRIMARY KEY,
    list_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    type     TEXT NOT NULL,
    options  TEXT NOT NULL DEFAULT '[]',
    sort     REAL NOT NULL DEFAULT 0,
    rev      INTEGER NOT NULL,
    deleted  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fields_list ON fields(list_id, rev);
CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    list_id       TEXT NOT NULL,
    group_id      TEXT NOT NULL DEFAULT '',
    parent_id     TEXT NOT NULL DEFAULT '',
    number        INTEGER,
    title         TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    done          INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    priority      TEXT NOT NULL DEFAULT '',
    start         TEXT NOT NULL DEFAULT '',
    due           TEXT NOT NULL DEFAULT '',
    owners        TEXT NOT NULL DEFAULT '[]',
    vals          TEXT NOT NULL DEFAULT '{}',
    links         TEXT NOT NULL DEFAULT '[]',
    subscribers   TEXT NOT NULL DEFAULT '[]',
    sort          REAL NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    rev           INTEGER NOT NULL,
    deleted       INTEGER NOT NULL DEFAULT 0,
    created_by TEXT, created_uid INTEGER, created_at TEXT,
    updated_by TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id, rev);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE TABLE IF NOT EXISTS issue_links (
    task_id  TEXT NOT NULL,
    project  TEXT NOT NULL,
    issue    TEXT NOT NULL,
    PRIMARY KEY (task_id, project, issue)
);
CREATE INDEX IF NOT EXISTS idx_issue_links ON issue_links(project, issue);
CREATE TABLE IF NOT EXISTS comments (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL,
    author     TEXT,
    uid        INTEGER,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
CREATE TABLE IF NOT EXISTS activity (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id  TEXT NOT NULL,
    task_id  TEXT NOT NULL DEFAULT '',
    title    TEXT NOT NULL DEFAULT '',
    at       TEXT NOT NULL,
    by       TEXT,
    event    TEXT NOT NULL,
    field    TEXT NOT NULL DEFAULT '',
    old      TEXT NOT NULL DEFAULT '',
    new      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_activity_list ON activity(list_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id, id);
"""

MAX_BODY = 2 * 1024 * 1024
MAX_TITLE = 300
MAX_DESC = 20000
MAX_COMMENT = 8000
MAX_BATCH = 2000
MAX_LINKS = 60
MAX_PEOPLE = 30
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{4,48}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")
PRIORITIES = ("", "Low", "Medium", "High", "Urgent")
FIELD_TYPES = ("person", "select", "text", "date", "number")
LIST_ROLES = {"viewer": 1, "editor": 2, "owner": 3}
LINK_KINDS = ("issue", "sheet", "view3d", "onedrive", "sharepoint", "acc", "url")
# What a patch may set. Everything else is the server's to say.
PATCHABLE = ("group_id", "parent_id", "title", "description", "done", "priority", "start",
             "due", "owners", "vals", "links", "sort")
# Fields worth a line in the activity feed.
TRACKED = ("title", "done", "priority", "start", "due", "owners", "group_id", "parent_id",
           "description", "vals", "links")

_LOCK = threading.Lock()
_READY = set()


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def clean_text(v, limit, multiline=False):
    s = "" if v is None else str(v)
    if multiline:
        s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+", "", s)
    else:
        s = re.sub(r"[\x00-\x1f\x7f]+", " ", s).strip()
    return s[:limit]


def new_id():
    return uuid.uuid4().hex[:20]


class Db(object):
    """The server's task file, opened per request (like boards.py). Writes
    are serialised by one lock and each is one transaction."""

    def __init__(self, path):
        self.path = path

    def __enter__(self):
        _LOCK.acquire()
        try:
            folder = os.path.dirname(self.path)
            if not os.path.isdir(folder):
                os.makedirs(folder)
            if not os.path.isfile(self.path):
                _READY.discard(self.path)
            self.db = sqlite3.connect(self.path, timeout=10)
            self.db.row_factory = sqlite3.Row
            if self.path not in _READY:
                self.db.execute("PRAGMA journal_mode=WAL")
                self.db.executescript(SCHEMA)
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


def next_rev(db):
    db.execute("UPDATE counter SET value = CAST(value AS INTEGER) + 1 WHERE name = 'rev'")
    return int(db.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()["value"])


def current_rev(db):
    r = db.execute("SELECT value FROM counter WHERE name = 'rev'").fetchone()
    return int(r["value"]) if r else 0


# ------------------------------------------------------------ cleaning

def clean_people(v):
    """[{uid, name}] - a person is kept by name too, so a list still reads
    right in passphrase mode and after an account is removed."""
    out, seen = [], set()
    for p in (v if isinstance(v, list) else []):
        if isinstance(p, str):
            p = {"name": p}
        if not isinstance(p, dict):
            continue
        name = clean_text(p.get("name"), 100)
        uid = p.get("uid")
        uid = int(uid) if isinstance(uid, (int, float)) or (isinstance(uid, str) and uid.isdigit()) else None
        if not name and uid is None:
            continue
        key = uid if uid is not None else name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"uid": uid, "name": name})
        if len(out) >= MAX_PEOPLE:
            break
    return out


def clean_date(v):
    s = clean_text(v, 16)
    if not s:
        return ""
    if not DATE.match(s):
        raise HTTPException(status_code=400, detail="Dates are YYYY-MM-DD (got %s)" % s[:20])
    return s


def clean_links(v):
    out = []
    for l in (v if isinstance(v, list) else []):
        if not isinstance(l, dict):
            continue
        kind = l.get("kind") if l.get("kind") in LINK_KINDS else "url"
        url = clean_text(l.get("url"), 2000)
        if url and not re.match(r"^(https?://|index\.html|model\.html|/)", url, re.I):
            raise HTTPException(status_code=400, detail="A link must start with https://")
        item = {"id": clean_text(l.get("id"), 48) or new_id(), "kind": kind, "url": url,
                "title": clean_text(l.get("title"), 300),
                "project": clean_text(l.get("project"), 80), "ref": clean_text(l.get("ref"), 120),
                "added_by": clean_text(l.get("added_by"), 100), "added_at": clean_text(l.get("added_at"), 30)}
        if kind == "issue" and not (item["project"] and item["ref"]):
            continue
        if kind != "issue" and not url:
            continue
        out.append(item)
        if len(out) >= MAX_LINKS:
            break
    return out


def clean_vals(v, fields):
    """Custom field values, by field id, cleaned by the field's type."""
    out = {}
    if not isinstance(v, dict):
        return out
    for fid, val in v.items():
        f = fields.get(fid)
        if not f:
            continue
        t = f["type"]
        if t == "person":
            val = clean_people(val)
            if val:
                out[fid] = val
        elif t == "date":
            val = clean_date(val)
            if val:
                out[fid] = val
        elif t == "number":
            try:
                if val not in (None, ""):
                    out[fid] = float(val)
            except (TypeError, ValueError):
                pass
        else:
            val = clean_text(val, 500)
            if val:
                out[fid] = val
    return out


# ------------------------------------------------------------ rows

def list_row(r):
    return {"id": r["id"], "title": r["title"], "team": r["team"] or "", "rev": r["rev"],
            "deleted": bool(r["deleted"]),
            "created_by": r["created_by"] or "", "created_at": r["created_at"] or "",
            "updated_by": r["updated_by"] or "", "updated_at": r["updated_at"] or ""}


def group_row(r):
    if r["deleted"]:
        return {"id": r["id"], "deleted": True, "rev": r["rev"]}
    return {"id": r["id"], "list_id": r["list_id"], "title": r["title"], "project": r["project"] or "",
            "sort": r["sort"], "rev": r["rev"]}


def field_row(r):
    if r["deleted"]:
        return {"id": r["id"], "deleted": True, "rev": r["rev"]}
    return {"id": r["id"], "list_id": r["list_id"], "name": r["name"], "type": r["type"],
            "options": json.loads(r["options"] or "[]"), "sort": r["sort"], "rev": r["rev"]}


def task_row(r):
    if r["deleted"]:
        return {"id": r["id"], "deleted": True, "rev": r["rev"], "list_id": r["list_id"]}
    return {"id": r["id"], "list_id": r["list_id"], "group_id": r["group_id"] or "",
            "parent_id": r["parent_id"] or "", "number": r["number"], "title": r["title"],
            "description": r["description"] or "", "done": bool(r["done"]),
            "completed_at": r["completed_at"] or "", "priority": r["priority"] or "",
            "start": r["start"] or "", "due": r["due"] or "",
            "owners": json.loads(r["owners"] or "[]"), "vals": json.loads(r["vals"] or "{}"),
            "links": json.loads(r["links"] or "[]"), "subscribers": json.loads(r["subscribers"] or "[]"),
            "sort": r["sort"], "comment_count": r["comment_count"], "rev": r["rev"],
            "created_by": r["created_by"] or "", "created_uid": r["created_uid"],
            "created_at": r["created_at"] or "",
            "updated_by": r["updated_by"] or "", "updated_at": r["updated_at"] or ""}


def short(field, v):
    """How a value reads in the activity feed."""
    if field == "done":
        return "done" if v else "not done"
    if field == "owners":
        return ", ".join(p.get("name") or "?" for p in (v or [])) or "nobody"
    if field == "links":
        return "%d link%s" % (len(v or []), "" if len(v or []) == 1 else "s")
    if field == "vals":
        return ""
    if field == "description":
        s = str(v or "")
        return (s[:80] + "...") if len(s) > 80 else s
    return str(v if v is not None else "")


# ------------------------------------------------------------ CSV import

def parse_csv(text):
    """A Lark (or Excel) export. The column names Lark uses are matched
    loosely, so a sheet tidied up by hand still comes in."""
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        return [], []
    head = [h.strip().lower() for h in rows[0]]

    def col(*names):
        for n in names:
            for i, h in enumerate(head):
                if h == n:
                    return i
        for n in names:
            for i, h in enumerate(head):
                if n in h:
                    return i
        return None
    cols = {
        "title": col("task title", "title", "task", "name", "summary"),
        "group": col("custom group", "group", "section", "project"),
        "parent": col("parent task", "parent"),
        "owner": col("owner", "assignee", "assigned to", "assignees"),
        "priority": col("priority"),
        "start": col("start time", "start date", "start"),
        "due": col("due date", "due", "deadline", "end"),
        "done": col("status", "completed", "done", "state"),
        "completed_at": col("completed at", "completed time", "completion time"),
        "description": col("description", "notes", "details"),
    }
    if cols["title"] is None:
        raise HTTPException(status_code=400, detail="No title column found (looked for Task Title, Title, Task, Name)")
    known = set(i for i in cols.values() if i is not None)
    extra = [(i, rows[0][i].strip()) for i in range(len(head)) if i not in known and rows[0][i].strip()]
    out = []
    for r in rows[1:]:
        def g(k):
            i = cols[k]
            return (r[i].strip() if i is not None and i < len(r) else "")
        if not g("title"):
            continue
        row = dict((k, g(k)) for k in cols)
        row["extra"] = dict((n, r[i].strip() if i < len(r) else "") for i, n in extra)
        out.append(row)
    return out, [n for _, n in extra]


def to_date(s):
    """'Jul 4', '2026/07/04', '04/07/2026', '2026-07-04 10:00' -> YYYY-MM-DD."""
    s = (s or "").strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", s)
    if m:     # day first, as written in Hong Kong and the UK
        return "%04d-%02d-%02d" % (int(m.group(3)), int(m.group(2)), int(m.group(1)))
    for fmt in ("%b %d, %Y", "%b %d %Y", "%d %b %Y", "%B %d, %Y", "%b %d"):
        try:
            t = time.strptime(s.split(",")[0] if fmt == "%b %d" else s, fmt)
            y = t.tm_year if "%Y" in fmt else time.gmtime().tm_year
            return "%04d-%02d-%02d" % (y, t.tm_mon, t.tm_mday)
        except ValueError:
            pass
    return ""


# ------------------------------------------------------------ routes

def register(app, core):

    def db():
        return Db(os.path.join(core.CFG["data"], "tasks.db"))

    async def read_json(request):
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

    def person(w, body=None):
        return w.name or clean_text((body or {}).get("by"), 60) or "Someone"

    def list_role(d, w, lid):
        """owner / editor / viewer / None. A site admin (and everyone in
        passphrase mode) owns every list."""
        if w.site_admin:
            return "owner"
        r = d.execute("SELECT role FROM list_members WHERE list_id = ? AND uid = ?", (lid, w.uid)).fetchone()
        return r["role"] if r else None

    def need_list(d, w, lid, need="viewer"):
        if not isinstance(lid, str) or not SAFE_ID.match(lid):
            raise HTTPException(status_code=404, detail="No such task list")
        row = d.execute("SELECT * FROM lists WHERE id = ? AND deleted = 0", (lid,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No such task list (it may have been deleted)")
        role = list_role(d, w, lid)
        if not role:
            raise HTTPException(status_code=403, detail="You are not a member of this task list")
        if LIST_ROLES[role] < LIST_ROLES[need]:
            raise HTTPException(status_code=403, detail="Your role on this list (%s) cannot do that" % role)
        return row, role

    def visible_lists(d, w):
        if w.site_admin:
            rows = d.execute("SELECT * FROM lists WHERE deleted = 0 ORDER BY title").fetchall()
            return [(r, "owner") for r in rows]
        rows = d.execute("SELECT l.*, m.role AS my_role FROM lists l JOIN list_members m ON m.list_id = l.id "
                         "WHERE l.deleted = 0 AND m.uid = ? ORDER BY l.title", (w.uid,)).fetchall()
        return [(r, r["my_role"]) for r in rows]

    def fields_of(d, lid):
        return dict((r["id"], {"type": r["type"], "name": r["name"]}) for r in d.execute(
            "SELECT * FROM fields WHERE list_id = ? AND deleted = 0", (lid,)))

    def log(d, lid, tid, title, by, event, field="", old="", new=""):
        d.execute("INSERT INTO activity (list_id, task_id, title, at, by, event, field, old, new) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  (lid, tid, (title or "")[:200], now_iso(), by, event, field,
                   str(old or "")[:300], str(new or "")[:300]))

    def sync_issue_links(d, tid, links):
        d.execute("DELETE FROM issue_links WHERE task_id = ?", (tid,))
        for l in links:
            if l.get("kind") == "issue":
                d.execute("INSERT OR IGNORE INTO issue_links (task_id, project, issue) VALUES (?, ?, ?)",
                          (tid, l["project"], l["ref"]))

    def project_ok(w, pid):
        """May this person link to that viewer project at all?"""
        if not pid:
            return True
        if not core.project_dir(pid):
            return False
        return bool(core.role_in(w, pid))

    # ------------------------------------------------ notifications

    def people_emails(people):
        """[(name, email)] for the people with accounts."""
        out = []
        if not core.accounts_on():
            return out
        for p in people:
            u = core.ACC.get(p["uid"]) if p.get("uid") is not None else None
            if u and u["active"] and u["email"]:
                out.append((u["name"], u["email"]))
        return out

    def notify(people, subject, text, actor_uid=None):
        targets = [(n, e) for n, e in people_emails([p for p in people if p.get("uid") != actor_uid])]
        if not targets or not core.smtp_ready():
            return

        def run():
            for name, email in targets:
                try:
                    core.send_mail(email, subject, "Hello %s,\n\n%s\n\n- LWK Viewer" % (name, text))
                except Exception as ex:
                    print("task mail to %s: %s" % (email, ex))
        threading.Thread(target=run, daemon=True).start()

    def task_url(t):
        return "%stasks.html?list=%s&task=%s" % (core.CFG.get("base_url") or "", t["list_id"], t["id"])

    # ------------------------------------------------ people

    @app.get("/api/people")
    async def people(request: Request, x_viewer_token: str = Header(default="")):
        """The organisation, for pickers and the People page. Contact
        details only - never roles on other projects or anything private."""
        w = core.who(request, x_viewer_token)
        if not core.accounts_on():
            return {"accounts": False, "people": [], "me": None}
        out = []
        for u in core.ACC.list():
            if not u["active"]:
                continue
            p = {k: u.get(k) or "" for k in ("name", "email", "office", "company", "team", "discipline")}
            p["uid"] = u["id"]
            out.append(p)
        out.sort(key=lambda p: p["name"].lower())
        return {"accounts": True, "people": out, "me": w.uid}

    # ------------------------------------------------ lists

    @app.get("/api/task-lists")
    async def lists_get(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        today = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))
        with db() as d:
            out = []
            for r, role in visible_lists(d, w):
                l = list_row(r)
                l["role"] = role
                l["groups"] = [group_row(g) for g in d.execute(
                    "SELECT * FROM groups WHERE list_id = ? AND deleted = 0 ORDER BY sort, title", (r["id"],))]
                c = d.execute(
                    "SELECT COUNT(*) AS n, SUM(done) AS done, "
                    "SUM(CASE WHEN done = 0 AND due != '' AND substr(due, 1, 10) < ? THEN 1 ELSE 0 END) AS overdue "
                    "FROM tasks WHERE list_id = ? AND deleted = 0 AND parent_id = ''", (today, r["id"])).fetchone()
                l["counts"] = {"total": c["n"] or 0, "done": c["done"] or 0, "overdue": c["overdue"] or 0}
                l["members"] = [{"uid": m["uid"], "role": m["role"]} for m in d.execute(
                    "SELECT * FROM list_members WHERE list_id = ?", (r["id"],))]
                out.append(l)
        return {"lists": out, "site_admin": w.site_admin, "accounts": core.accounts_on(),
                "me": {"uid": w.uid, "name": w.name}}

    @app.post("/api/task-lists")
    async def lists_create(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if core.accounts_on() and not w.site_admin:
            # anyone who is at least a member somewhere may start a list
            if not any(core.RANK.get(r, 0) >= core.RANK["member"] for r in core.ACC.memberships(w.uid).values()):
                raise HTTPException(status_code=403, detail="Only project members can start a task list")
        body = await read_json(request)
        title = clean_text(body.get("title"), 120) or "Untitled list"
        by, t = person(w, body), now_iso()
        lid = new_id()
        with db() as d:
            rev = next_rev(d)
            d.execute("INSERT INTO lists (id, title, team, rev, created_by, created_uid, created_at, updated_by, updated_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (lid, title, clean_text(body.get("team"), 80), rev, by, w.uid, t, by, t))
            if w.uid is not None:
                d.execute("INSERT INTO list_members (list_id, uid, role) VALUES (?, ?, 'owner')", (lid, w.uid))
            for i, g in enumerate(body.get("groups") or [{"title": "General"}]):
                if not isinstance(g, dict):
                    continue
                pid = clean_text(g.get("project"), 80)
                if not project_ok(w, pid):
                    pid = ""
                d.execute("INSERT INTO groups (id, list_id, title, project, sort, rev) VALUES (?, ?, ?, ?, ?, ?)",
                          (new_id(), lid, clean_text(g.get("title"), 120) or "Group", pid, i, rev))
            default_fields = body.get("fields")
            if default_fields is None:
                default_fields = [{"name": "Modelers", "type": "person"},
                                  {"name": "Project Manager", "type": "person"}]
            for i, f in enumerate(default_fields):
                if isinstance(f, dict) and f.get("type") in FIELD_TYPES and clean_text(f.get("name"), 60):
                    d.execute("INSERT INTO fields (id, list_id, name, type, options, sort, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (new_id(), lid, clean_text(f.get("name"), 60), f["type"],
                               json.dumps([clean_text(o, 60) for o in (f.get("options") or [])][:50]), i, rev))
            log(d, lid, "", title, by, "list-created")
        return {"id": lid}

    @app.patch("/api/task-lists/{lid}")
    async def lists_patch(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            row, _ = need_list(d, w, lid, "owner")
            title = clean_text(body.get("title"), 120) or row["title"]
            team = clean_text(body.get("team"), 80) if "team" in body else row["team"]
            rev = next_rev(d)
            d.execute("UPDATE lists SET title = ?, team = ?, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                      (title, team, rev, person(w), now_iso(), lid))
            if title != row["title"]:
                log(d, lid, "", title, person(w), "list-renamed", "title", row["title"], title)
        return {"ok": True}

    @app.delete("/api/task-lists/{lid}")
    async def lists_delete(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            need_list(d, w, lid, "owner")
            d.execute("UPDATE lists SET deleted = 1, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                      (next_rev(d), person(w), now_iso(), lid))
        return {"ok": True}

    @app.get("/api/admin/task-lists")
    async def lists_admin(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if not w.site_admin:
            raise HTTPException(status_code=403, detail="Site admins only")
        with db() as d:
            rows = d.execute("SELECT * FROM lists ORDER BY deleted, title").fetchall()
            out = []
            for r in rows:
                l = list_row(r)
                l["tasks"] = d.execute("SELECT COUNT(*) AS n FROM tasks WHERE list_id = ? AND deleted = 0",
                                       (r["id"],)).fetchone()["n"]
                l["members"] = d.execute("SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?",
                                         (r["id"],)).fetchone()["n"]
                out.append(l)
        return {"lists": out}

    @app.post("/api/admin/task-lists/{lid}/restore")
    async def lists_restore(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if not w.site_admin:
            raise HTTPException(status_code=403, detail="Site admins only")
        with db() as d:
            d.execute("UPDATE lists SET deleted = 0, rev = ? WHERE id = ?", (next_rev(d), lid))
        return {"ok": True}

    @app.put("/api/task-lists/{lid}/members")
    async def lists_members(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """The whole member list at once: [{uid, role}]."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        ms = body.get("members")
        if not isinstance(ms, list):
            raise HTTPException(status_code=400, detail="members: a list of {uid, role}")
        with db() as d:
            need_list(d, w, lid, "owner")
            clean = {}
            for m in ms:
                if not isinstance(m, dict) or m.get("role") not in LIST_ROLES:
                    continue
                try:
                    uid = int(m.get("uid"))
                except (TypeError, ValueError):
                    continue
                if core.accounts_on() and not core.ACC.get(uid):
                    continue
                clean[uid] = m["role"]
            if not w.site_admin and clean.get(w.uid) != "owner":
                raise HTTPException(status_code=400, detail="Keep yourself as an owner (or ask a site admin)")
            if "owner" not in clean.values():
                raise HTTPException(status_code=400, detail="A list needs at least one owner")
            d.execute("DELETE FROM list_members WHERE list_id = ?", (lid,))
            for uid, role in clean.items():
                d.execute("INSERT INTO list_members (list_id, uid, role) VALUES (?, ?, ?)", (lid, uid, role))
            d.execute("UPDATE lists SET rev = ? WHERE id = ?", (next_rev(d), lid))
        return {"ok": True}

    @app.post("/api/task-lists/{lid}/groups")
    async def groups_save(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """Add, rename, re-map, re-order or delete groups: {groups: [...]}."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            need_list(d, w, lid, "editor")
            rev = next_rev(d)
            for g in body.get("groups") or []:
                if not isinstance(g, dict):
                    continue
                gid = g.get("id") if isinstance(g.get("id"), str) and SAFE_ID.match(g.get("id")) else new_id()
                old = d.execute("SELECT * FROM groups WHERE id = ?", (gid,)).fetchone()
                if old and old["list_id"] != lid:
                    raise HTTPException(status_code=400, detail="That group belongs to another list")
                if g.get("deleted"):
                    if old:
                        live = d.execute("SELECT COUNT(*) AS n FROM tasks WHERE group_id = ? AND deleted = 0",
                                         (gid,)).fetchone()["n"]
                        if live:
                            raise HTTPException(status_code=400, detail="Move or delete the %d tasks in \"%s\" first"
                                                % (live, old["title"]))
                        d.execute("UPDATE groups SET deleted = 1, rev = ? WHERE id = ?", (rev, gid))
                    continue
                pid = clean_text(g.get("project"), 80) if "project" in g else (old["project"] if old else "")
                if not project_ok(w, pid):
                    raise HTTPException(status_code=400, detail="No project %s (or you are not on it)" % pid)
                title = clean_text(g.get("title"), 120) or (old["title"] if old else "Group")
                sort = float(g.get("sort")) if isinstance(g.get("sort"), (int, float)) else (old["sort"] if old else 0)
                if old:
                    d.execute("UPDATE groups SET title = ?, project = ?, sort = ?, rev = ?, deleted = 0 WHERE id = ?",
                              (title, pid, sort, rev, gid))
                else:
                    d.execute("INSERT INTO groups (id, list_id, title, project, sort, rev) VALUES (?, ?, ?, ?, ?, ?)",
                              (gid, lid, title, pid, sort, rev))
            d.execute("UPDATE lists SET rev = ? WHERE id = ?", (rev, lid))
        return {"rev": rev}

    @app.post("/api/task-lists/{lid}/fields")
    async def fields_save(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """Custom columns (Modelers, Project Manager, Discipline ...)."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            need_list(d, w, lid, "owner")
            rev = next_rev(d)
            for f in body.get("fields") or []:
                if not isinstance(f, dict):
                    continue
                fid = f.get("id") if isinstance(f.get("id"), str) and SAFE_ID.match(f.get("id")) else new_id()
                old = d.execute("SELECT * FROM fields WHERE id = ?", (fid,)).fetchone()
                if old and old["list_id"] != lid:
                    raise HTTPException(status_code=400, detail="That field belongs to another list")
                if f.get("deleted"):
                    if old:
                        d.execute("UPDATE fields SET deleted = 1, rev = ? WHERE id = ?", (rev, fid))
                    continue
                typ = f.get("type") if f.get("type") in FIELD_TYPES else (old["type"] if old else "text")
                name = clean_text(f.get("name"), 60) or (old["name"] if old else "Field")
                opts = json.dumps([clean_text(o, 60) for o in (f.get("options") or [])][:50])
                sort = float(f.get("sort")) if isinstance(f.get("sort"), (int, float)) else (old["sort"] if old else 0)
                if old:
                    d.execute("UPDATE fields SET name = ?, type = ?, options = ?, sort = ?, rev = ?, deleted = 0 WHERE id = ?",
                              (name, typ, opts, sort, rev, fid))
                else:
                    d.execute("INSERT INTO fields (id, list_id, name, type, options, sort, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (fid, lid, name, typ, opts, sort, rev))
            d.execute("UPDATE lists SET rev = ? WHERE id = ?", (rev, lid))
        return {"rev": rev}

    # ------------------------------------------------ tasks

    @app.get("/api/tasks")
    async def tasks_get(request: Request, list: str = "", since: int = 0,
                        x_viewer_token: str = Header(default="")):
        """Everything in a list changed after `since` (0: all of it)."""
        w = core.who(request, x_viewer_token)
        with db() as d:
            row, role = need_list(d, w, list)
            rev = current_rev(d)
            gs = [group_row(r) for r in d.execute(
                "SELECT * FROM groups WHERE list_id = ? AND rev > ? ORDER BY sort", (list, since))]
            fs = [field_row(r) for r in d.execute(
                "SELECT * FROM fields WHERE list_id = ? AND rev > ? ORDER BY sort", (list, since))]
            ts = [task_row(r) for r in d.execute(
                "SELECT * FROM tasks WHERE list_id = ? AND rev > ?" + (" AND deleted = 0" if not since else ""),
                (list, since))]
            members = [{"uid": m["uid"], "role": m["role"]} for m in d.execute(
                "SELECT * FROM list_members WHERE list_id = ?", (list,))]
        l = list_row(row)
        l["members"] = members
        return {"rev": rev, "full": not since, "role": role, "list": l,
                "groups": gs, "fields": fs, "tasks": ts}

    @app.post("/api/tasks")
    async def tasks_save(request: Request, x_viewer_token: str = Header(default="")):
        """{list, tasks: [patch, ...], deleted: [id, ...]}. A patch names a
        task by id and carries only the fields that changed; an id the
        server has never seen makes a new task."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        lid = body.get("list")
        patches = body.get("tasks") or []
        dels = body.get("deleted") or []
        if not isinstance(patches, list) or len(patches) > MAX_BATCH:
            raise HTTPException(status_code=400, detail="tasks: a list of at most %d" % MAX_BATCH)
        by, t = person(w, body), now_iso()
        out, events = [], []
        with db() as d:
            _, role = need_list(d, w, lid, "editor")
            fields = fields_of(d, lid)
            groups = dict((r["id"], r) for r in d.execute(
                "SELECT * FROM groups WHERE list_id = ? AND deleted = 0", (lid,)))
            rev = next_rev(d)
            for p in patches:
                if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not SAFE_ID.match(p["id"]):
                    raise HTTPException(status_code=400, detail="Bad task id")
                tid = p["id"]
                old = d.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone()
                if old and old["list_id"] != lid:
                    raise HTTPException(status_code=400, detail="That task belongs to another list")
                cur = task_row(old) if old and not old["deleted"] else None
                new = dict(cur) if cur else {
                    "group_id": "", "parent_id": "", "title": "", "description": "", "done": False,
                    "priority": "", "start": "", "due": "", "owners": [], "vals": {}, "links": [],
                    "sort": time.time(), "subscribers": []}
                for k in PATCHABLE:
                    if k not in p:
                        continue
                    v = p[k]
                    if k == "title":
                        v = clean_text(v, MAX_TITLE)
                    elif k == "description":
                        v = clean_text(v, MAX_DESC, multiline=True)
                    elif k == "done":
                        v = bool(v)
                    elif k == "priority":
                        v = v if v in PRIORITIES else ""
                    elif k in ("start", "due"):
                        v = clean_date(v)
                    elif k == "owners":
                        v = clean_people(v)
                    elif k == "vals":
                        merged = dict(new.get("vals") or {})
                        if isinstance(v, dict):
                            merged.update(v)       # one field of the custom set at a time
                        v = clean_vals(merged, fields)
                    elif k == "links":
                        v = clean_links(v)
                        for l in v:
                            if l["kind"] == "issue" and not project_ok(w, l["project"]):
                                raise HTTPException(status_code=403, detail="You cannot link to project %s" % l["project"])
                            if not l["added_by"]:
                                l["added_by"], l["added_at"] = by, t
                    elif k == "sort":
                        v = float(v) if isinstance(v, (int, float)) else new["sort"]
                    elif k in ("group_id", "parent_id"):
                        v = v if isinstance(v, str) else ""
                    new[k] = v
                if new["group_id"] and new["group_id"] not in groups:
                    raise HTTPException(status_code=400, detail="No such group in this list")
                if not new["group_id"] and groups and not new["parent_id"]:
                    new["group_id"] = sorted(groups.values(), key=lambda g: g["sort"])[0]["id"]
                if new["parent_id"]:
                    if new["parent_id"] == tid:
                        raise HTTPException(status_code=400, detail="A task cannot be its own sub-task")
                    par = d.execute("SELECT list_id, group_id, parent_id FROM tasks WHERE id = ? AND deleted = 0",
                                    (new["parent_id"],)).fetchone()
                    if not par or par["list_id"] != lid:
                        raise HTTPException(status_code=400, detail="The parent task is not in this list")
                    new["group_id"] = par["group_id"]
                completed_at = (cur or {}).get("completed_at") or ""
                if new["done"] and not (cur or {}).get("done"):
                    completed_at = t
                elif not new["done"]:
                    completed_at = ""
                subs = list(new.get("subscribers") or [])
                # the people on a task follow it, as in Lark
                for pp in new["owners"]:
                    if pp.get("uid") is not None and pp["uid"] not in [s.get("uid") for s in subs]:
                        subs.append({"uid": pp["uid"], "name": pp["name"]})
                if not cur and w.uid is not None and w.uid not in [s.get("uid") for s in subs]:
                    subs.append({"uid": w.uid, "name": w.name})
                if cur:
                    d.execute(
                        "UPDATE tasks SET group_id=?, parent_id=?, title=?, description=?, done=?, completed_at=?, "
                        "priority=?, start=?, due=?, owners=?, vals=?, links=?, subscribers=?, sort=?, rev=?, "
                        "updated_by=?, updated_at=? WHERE id=?",
                        (new["group_id"], new["parent_id"], new["title"], new["description"], int(new["done"]),
                         completed_at, new["priority"], new["start"], new["due"], json.dumps(new["owners"]),
                         json.dumps(new["vals"]), json.dumps(new["links"]), json.dumps(subs), new["sort"], rev,
                         by, t, tid))
                    for f in TRACKED:
                        if cur.get(f) != new.get(f):
                            if f == "vals":
                                for fid in set(list(cur["vals"].keys()) + list(new["vals"].keys())):
                                    if cur["vals"].get(fid) != new["vals"].get(fid) and fid in fields:
                                        fv = lambda v: short("owners", v) if fields[fid]["type"] == "person" else v
                                        log(d, lid, tid, new["title"], by, "changed", fields[fid]["name"],
                                            fv(cur["vals"].get(fid)), fv(new["vals"].get(fid)))
                                continue
                            name = f
                            o, n = short(f, cur.get(f)), short(f, new.get(f))
                            if f == "group_id":
                                name = "group"
                                o = groups[cur[f]]["title"] if cur[f] in groups else ""
                                n = groups[new[f]]["title"] if new[f] in groups else ""
                            log(d, lid, tid, new["title"], by, "completed" if f == "done" and new["done"]
                                else "reopened" if f == "done" else "changed", name, o, n)
                    added = [pp for pp in new["owners"] if pp not in cur["owners"]]
                    if added:
                        events.append(("owner", dict(new, id=tid, list_id=lid), added))
                    if new["done"] and not cur["done"]:
                        events.append(("done", dict(new, id=tid, list_id=lid), subs))
                else:
                    if old:   # was deleted: the id is not to be reused
                        raise HTTPException(status_code=409, detail="That task was deleted")
                    num = d.execute("SELECT next_number FROM lists WHERE id = ?", (lid,)).fetchone()["next_number"]
                    d.execute("UPDATE lists SET next_number = next_number + 1 WHERE id = ?", (lid,))
                    d.execute(
                        "INSERT INTO tasks (id, list_id, group_id, parent_id, number, title, description, done, "
                        "completed_at, priority, start, due, owners, vals, links, subscribers, sort, rev, "
                        "created_by, created_uid, created_at, updated_by, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (tid, lid, new["group_id"], new["parent_id"], num, new["title"], new["description"],
                         int(new["done"]), completed_at, new["priority"], new["start"], new["due"],
                         json.dumps(new["owners"]), json.dumps(new["vals"]), json.dumps(new["links"]),
                         json.dumps(subs), new["sort"], rev, by, w.uid, t, by, t))
                    log(d, lid, tid, new["title"], by, "created")
                    if new["owners"]:
                        events.append(("owner", dict(new, id=tid, list_id=lid), new["owners"]))
                if "links" in p:
                    sync_issue_links(d, tid, new["links"])
                if cur and cur["group_id"] != new["group_id"]:
                    # sub-tasks go where their parent goes
                    d.execute("UPDATE tasks SET group_id = ?, rev = ? WHERE parent_id = ? AND deleted = 0",
                              (new["group_id"], rev, tid))
                out.append(tid)
            for tid in dels if isinstance(dels, list) else []:
                if not isinstance(tid, str) or not SAFE_ID.match(tid):
                    continue
                old = d.execute("SELECT * FROM tasks WHERE id = ? AND list_id = ? AND deleted = 0", (tid, lid)).fetchone()
                if not old:
                    continue
                if role != "owner" and old["created_uid"] != w.uid and core.accounts_on():
                    raise HTTPException(status_code=403, detail="Only the person who made a task, or a list owner, can delete it")
                ids = [tid] + [r["id"] for r in d.execute(
                    "SELECT id FROM tasks WHERE parent_id = ? AND deleted = 0", (tid,))]
                for i in ids:
                    d.execute("UPDATE tasks SET deleted = 1, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                              (rev, by, t, i))
                    d.execute("DELETE FROM issue_links WHERE task_id = ?", (i,))
                log(d, lid, tid, old["title"], by, "deleted")
            rows = [task_row(r) for r in d.execute(
                "SELECT * FROM tasks WHERE rev = ? AND list_id = ?", (rev, lid))]
        for kind, task, who_ in events:
            if kind == "owner":
                notify(who_, "Task for you: %s" % task["title"],
                       "%s made you an owner of \"%s\"%s.\n\n%s" % (
                           by, task["title"], (", due " + task["due"]) if task["due"] else "", task_url(task)),
                       w.uid)
            else:
                notify(who_, "Completed: %s" % task["title"],
                       "%s marked \"%s\" as done.\n\n%s" % (by, task["title"], task_url(task)), w.uid)
        return {"rev": rev, "tasks": rows}

    @app.get("/api/tasks/{tid}")
    async def task_one(request: Request, tid: str, x_viewer_token: str = Header(default="")):
        """One task with its comments and history, for the detail panel."""
        w = core.who(request, x_viewer_token)
        with db() as d:
            r = d.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone()
            if not r or r["deleted"]:
                raise HTTPException(status_code=404, detail="No such task (it may have been deleted)")
            _, role = need_list(d, w, r["list_id"])
            cs = [{"id": c["id"], "author": c["author"] or "", "uid": c["uid"], "body": c["body"],
                   "created_at": c["created_at"]} for c in d.execute(
                "SELECT * FROM comments WHERE task_id = ? AND deleted = 0 ORDER BY created_at", (tid,))]
            hist = [dict(a) for a in d.execute(
                "SELECT at, by, event, field, old, new FROM activity WHERE task_id = ? ORDER BY id DESC LIMIT 200", (tid,))]
        return {"task": task_row(r), "comments": cs, "activity": hist, "role": role}

    @app.post("/api/tasks/{tid}/comments")
    async def task_comment(request: Request, tid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_COMMENT, multiline=True).strip()
        if not text:
            raise HTTPException(status_code=400, detail="An empty comment")
        by, t = person(w, body), now_iso()
        with db() as d:
            r = d.execute("SELECT * FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such task")
            need_list(d, w, r["list_id"], "editor")
            cid = new_id()
            d.execute("INSERT INTO comments (id, task_id, author, uid, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                      (cid, tid, by, w.uid, text, t))
            subs = json.loads(r["subscribers"] or "[]")
            # "@Full Name", by the exact names of the accounts (names have spaces)
            mentioned = []
            if "@" in text and core.accounts_on():
                low = text.lower()
                for u in core.ACC.list():
                    if u["active"] and u["name"] and ("@" + u["name"].lower()) in low:
                        mentioned.append({"uid": u["id"], "name": u["name"]})
            for m in mentioned:
                if m["uid"] not in [s.get("uid") for s in subs]:
                    subs.append(m)
            if w.uid is not None and w.uid not in [s.get("uid") for s in subs]:
                subs.append({"uid": w.uid, "name": w.name})
            d.execute("UPDATE tasks SET comment_count = comment_count + 1, subscribers = ?, rev = ? WHERE id = ?",
                      (json.dumps(subs), next_rev(d), tid))
            log(d, r["list_id"], tid, r["title"], by, "comment", "", "", text[:200])
            task = task_row(d.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone())
        url = task_url(task)
        notify(mentioned, "%s mentioned you: %s" % (by, task["title"]),
               "%s wrote on \"%s\":\n\n%s\n\n%s" % (by, task["title"], text, url), w.uid)
        others = [s for s in subs if s.get("uid") not in [m["uid"] for m in mentioned]]
        notify(others, "New comment: %s" % task["title"],
               "%s wrote on \"%s\":\n\n%s\n\n%s" % (by, task["title"], text, url), w.uid)
        return {"id": cid, "author": by, "uid": w.uid, "body": text, "created_at": t, "task": task}

    @app.delete("/api/tasks/{tid}/comments/{cid}")
    async def task_comment_delete(request: Request, tid: str, cid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            r = d.execute("SELECT * FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
            c = d.execute("SELECT * FROM comments WHERE id = ? AND task_id = ? AND deleted = 0", (cid, tid)).fetchone()
            if not r or not c:
                raise HTTPException(status_code=404, detail="No such comment")
            _, role = need_list(d, w, r["list_id"], "editor")
            if role != "owner" and core.accounts_on() and c["uid"] != w.uid:
                raise HTTPException(status_code=403, detail="Only the writer or a list owner can delete a comment")
            d.execute("UPDATE comments SET deleted = 1 WHERE id = ?", (cid,))
            d.execute("UPDATE tasks SET comment_count = MAX(0, comment_count - 1), rev = ? WHERE id = ?",
                      (next_rev(d), tid))
        return {"ok": True}

    @app.post("/api/tasks/{tid}/subscribe")
    async def task_subscribe(request: Request, tid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        if w.uid is None:
            raise HTTPException(status_code=400, detail="Following a task needs accounts switched on")
        body = await read_json(request)
        with db() as d:
            r = d.execute("SELECT * FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such task")
            need_list(d, w, r["list_id"])
            subs = [s for s in json.loads(r["subscribers"] or "[]") if s.get("uid") != w.uid]
            if body.get("on", True):
                subs.append({"uid": w.uid, "name": w.name})
            d.execute("UPDATE tasks SET subscribers = ?, rev = ? WHERE id = ?", (json.dumps(subs), next_rev(d), tid))
        return {"subscribers": subs}

    # ------------------------------------------------ across lists

    @app.get("/api/tasks-mine")
    async def tasks_mine(request: Request, view: str = "owned", x_viewer_token: str = Header(default="")):
        """Quick Access: owned (open, mine), subscribed, assigned (by me to
        others), created, completed (mine), all (every list I can see)."""
        w = core.who(request, x_viewer_token)
        with db() as d:
            lists = dict((r["id"], (r, role)) for r, role in visible_lists(d, w))
            if not lists:
                return {"tasks": [], "lists": {}}
            q = ",".join("?" * len(lists))
            rows = d.execute("SELECT * FROM tasks WHERE deleted = 0 AND list_id IN (%s)" % q,
                             list(lists.keys())).fetchall()
            groups = dict((g["id"], group_row(g)) for g in d.execute(
                "SELECT * FROM groups WHERE deleted = 0 AND list_id IN (%s)" % q, list(lists.keys())))

        def mine(people):
            return any((p.get("uid") is not None and p.get("uid") == w.uid)
                       or (w.uid is None and w.name and (p.get("name") or "").lower() == w.name.lower())
                       for p in people)
        out = []
        for r in rows:
            t = task_row(r)
            if view == "owned":
                ok = mine(t["owners"]) and not t["done"]
            elif view == "subscribed":
                ok = mine(t["subscribers"])
            elif view == "assigned":
                ok = t["created_uid"] == w.uid and w.uid is not None and t["owners"] and not mine(t["owners"])
            elif view == "created":
                ok = t["created_uid"] == w.uid and w.uid is not None
            elif view == "completed":
                ok = t["done"] and mine(t["owners"])
            else:
                ok = True
            if ok:
                t["list_title"] = lists[t["list_id"]][0]["title"]
                g = groups.get(t["group_id"])
                t["group_title"] = g["title"] if g else ""
                t["project"] = g["project"] if g else ""
                out.append(t)
        out.sort(key=lambda t: (t["done"], t["due"] or "9999", t["title"].lower()))
        return {"tasks": out[:2000], "lists": {k: v[0]["title"] for k, v in lists.items()}}

    @app.get("/api/tasks-by-issue")
    async def tasks_by_issue(request: Request, issue: str = "", project: str = "",
                             x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """The tasks pointing at one issue - for the issue window."""
        pid = project or x_project
        if core.CFG["single"]:
            pid = pid or "default"
        w, _ = core.require_project(request, pid, "viewer", x_viewer_token)
        with db() as d:
            mine = dict((r["id"], role) for r, role in visible_lists(d, w))
            rows = d.execute("SELECT t.* FROM tasks t JOIN issue_links l ON l.task_id = t.id "
                             "WHERE l.project = ? AND l.issue = ? AND t.deleted = 0", (pid, issue)).fetchall()
            titles = dict((r["id"], r["title"]) for r in d.execute("SELECT id, title FROM lists"))
        out = []
        for r in rows:
            t = task_row(r)
            t["list_title"] = titles.get(t["list_id"], "")
            t["can_open"] = t["list_id"] in mine
            if not t["can_open"]:
                # someone outside the list learns only that a task exists
                t = dict((k, t[k]) for k in ("id", "list_id", "list_title", "number", "title", "done", "due", "owners"))
                t["can_open"] = False
            out.append(t)
        lists = [{"id": r["id"], "title": r["title"], "role": role} for r, role in
                 [(rr, rl) for rr, rl in _lists_for(w) if LIST_ROLES[rl] >= LIST_ROLES["editor"]]]
        return {"tasks": out, "lists": lists}

    def _lists_for(w):
        with db() as d:
            return visible_lists(d, w)

    @app.get("/api/task-activity")
    async def task_activity(request: Request, list: str = "", limit: int = 200, before: int = 0,
                            x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            if list:
                need_list(d, w, list)
                ids = [list]
            else:
                ids = [r["id"] for r, _ in visible_lists(d, w)]
            if not ids:
                return {"activity": []}
            q = ",".join("?" * len(ids))
            args = ids + ([before] if before else []) + [max(1, min(500, limit))]
            rows = d.execute("SELECT * FROM activity WHERE list_id IN (%s)%s ORDER BY id DESC LIMIT ?"
                             % (q, " AND id < ?" if before else ""), args).fetchall()
        return {"activity": [dict(r) for r in rows]}

    # ------------------------------------------------ import

    @app.post("/api/task-lists/{lid}/import")
    async def tasks_import(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """A Lark export saved as CSV: {csv: "..."}. Groups are made as
        needed, owners matched to accounts by name, a "Parent task" column
        makes sub-tasks, and columns this list does not know become text
        fields."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        rows, extra = parse_csv(str(body.get("csv") or ""))
        if not rows:
            raise HTTPException(status_code=400, detail="Nothing to import")
        by, t = person(w, body), now_iso()
        users = {}
        if core.accounts_on():
            for u in core.ACC.list():
                users[u["name"].lower()] = {"uid": u["id"], "name": u["name"]}

        def people_of(s):
            out = []
            for n in re.split(r"[,;/、，\n]+", s or ""):
                n = n.strip()
                if n:
                    out.append(users.get(n.lower()) or {"uid": None, "name": n})
            return clean_people(out)
        made = 0
        with db() as d:
            lrow, _ = need_list(d, w, lid, "editor")
            rev = next_rev(d)
            groups = dict((r["title"].lower(), r["id"]) for r in d.execute(
                "SELECT * FROM groups WHERE list_id = ? AND deleted = 0", (lid,)))
            fields = dict((r["name"].lower(), (r["id"], r["type"])) for r in d.execute(
                "SELECT * FROM fields WHERE list_id = ? AND deleted = 0", (lid,)))
            for i, name in enumerate(extra):
                if name.lower() not in fields:
                    fid = new_id()
                    d.execute("INSERT INTO fields (id, list_id, name, type, options, sort, rev) VALUES (?, ?, ?, 'text', '[]', ?, ?)",
                              (fid, lid, clean_text(name, 60), 100 + i, rev))
                    fields[name.lower()] = (fid, "text")
            by_title = {}
            pending_parent = []
            num = d.execute("SELECT next_number FROM lists WHERE id = ?", (lid,)).fetchone()["next_number"]
            for i, r in enumerate(rows):
                gname = r["group"] or "Imported"
                if gname.lower() not in groups:
                    gid = new_id()
                    d.execute("INSERT INTO groups (id, list_id, title, project, sort, rev) VALUES (?, ?, ?, '', ?, ?)",
                              (gid, lid, clean_text(gname, 120), len(groups), rev))
                    groups[gname.lower()] = gid
                done = r["done"].strip().lower() in ("done", "completed", "complete", "true", "yes", "1", "closed", "已完成")
                vals = {}
                for name, v in (r.get("extra") or {}).items():
                    fid, typ = fields[name.lower()]
                    if v:
                        vals[fid] = people_of(v) if typ == "person" else v[:500]
                tid = new_id()
                pr = r["priority"].strip().capitalize()
                d.execute(
                    "INSERT INTO tasks (id, list_id, group_id, parent_id, number, title, description, done, "
                    "completed_at, priority, start, due, owners, vals, links, subscribers, sort, rev, "
                    "created_by, created_uid, created_at, updated_by, updated_at) "
                    "VALUES (?,?,?,'',?,?,?,?,?,?,?,?,?,?,'[]','[]',?,?,?,?,?,?,?)",
                    (tid, lid, groups[gname.lower()], num, clean_text(r["title"], MAX_TITLE),
                     clean_text(r["description"], MAX_DESC, True), int(done),
                     (to_date(r["completed_at"]) or t[:10]) if done else "",
                     pr if pr in PRIORITIES else "", to_date(r["start"]), to_date(r["due"]),
                     json.dumps(people_of(r["owner"])), json.dumps(vals), i, rev, by, w.uid, t, by, t))
                num += 1
                made += 1
                by_title.setdefault(r["title"].strip().lower(), tid)
                if r["parent"]:
                    pending_parent.append((tid, r["parent"].strip().lower()))
            for tid, parent in pending_parent:
                pid = by_title.get(parent)
                if pid and pid != tid:
                    d.execute("UPDATE tasks SET parent_id = ?, group_id = (SELECT group_id FROM tasks WHERE id = ?) "
                              "WHERE id = ?", (pid, pid, tid))
            d.execute("UPDATE lists SET next_number = ?, rev = ? WHERE id = ?", (num, rev, lid))
            log(d, lid, "", lrow["title"], by, "imported", "", "", "%d tasks" % made)
        return {"imported": made}

    # ------------------------------------------------ due reminders

    def reminders_once():
        """One email per person: what of theirs is due tomorrow or overdue."""
        if not core.accounts_on() or not core.smtp_ready():
            return
        local = time.gmtime(time.time() + 8 * 3600)
        today = time.strftime("%Y-%m-%d", local)
        tomorrow = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600 + 86400))
        with db() as d:
            last = d.execute("SELECT value FROM counter WHERE name = 'remind_last'").fetchone()
            if (last and last["value"] == today) or local.tm_hour < 9:
                return
            d.execute("INSERT OR REPLACE INTO counter (name, value) VALUES ('remind_last', ?)", (today,))
            rows = [task_row(r) for r in d.execute(
                "SELECT t.* FROM tasks t JOIN lists l ON l.id = t.list_id "
                "WHERE t.deleted = 0 AND l.deleted = 0 AND t.done = 0 AND t.due != '' AND substr(t.due, 1, 10) <= ?",
                (tomorrow,))]
        per = {}
        for t in rows:
            for p in t["owners"]:
                if p.get("uid") is not None:
                    per.setdefault(p["uid"], []).append(t)
        for uid, ts in per.items():
            lines = []
            for t in sorted(ts, key=lambda t: t["due"]):
                state = "OVERDUE" if t["due"][:10] < today else "due today" if t["due"][:10] == today else "due tomorrow"
                lines.append("- %s (%s, %s)\n  %s" % (t["title"], state, t["due"][:10], task_url(t)))
            notify([{"uid": uid}], "Tasks due: %d" % len(ts), "These tasks of yours need attention:\n\n" + "\n".join(lines))

    def reminder_loop():
        while True:
            time.sleep(1200)
            try:
                reminders_once()
            except Exception as ex:
                print("task reminders: %s" % ex)

    threading.Thread(target=reminder_loop, daemon=True).start()
