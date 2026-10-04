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
from urllib.parse import urlencode

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

-- The project register (Projects page): one row per job, with its code,
-- who runs it, where its files are and which viewer project shows it.
-- Task groups point at it (groups.reg), which is how a job's tasks, its
-- issues and its chat channel find each other.
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    short       TEXT NOT NULL DEFAULT '',
    owners      TEXT NOT NULL DEFAULT '[]',
    team        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'Active',
    viewer      TEXT NOT NULL DEFAULT '',
    links       TEXT NOT NULL DEFAULT '[]',
    notes       TEXT NOT NULL DEFAULT '',
    sort        REAL NOT NULL DEFAULT 0,
    rev         INTEGER NOT NULL DEFAULT 0,
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT
);
-- Members of a project that has no viewer project (no export yet). A
-- project with a viewer project keeps its members in accounts.db, as before.
CREATE TABLE IF NOT EXISTS reg_members (
    reg   TEXT NOT NULL,
    uid   INTEGER NOT NULL,
    role  TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (reg, uid)
);
"""

# Columns added after the first release: (table, column, definition).
MIGRATIONS = (
    ("tasks", "ext_id", "TEXT NOT NULL DEFAULT ''"),      # the Lark task id, so a re-import updates
    ("groups", "reg", "TEXT NOT NULL DEFAULT ''"),        # projects.id
    ("comments", "files", "TEXT NOT NULL DEFAULT '[]'"),  # attachments (chat.py stores them)
    ("projects", "viewers", "TEXT NOT NULL DEFAULT '[]'"), # every viewer project (model + sheets) of a job
)

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
FIELD_TYPES = ("person", "select", "text", "date", "number", "check")
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
                for table, col, sql in MIGRATIONS:
                    have = set(r[1] for r in self.db.execute("PRAGMA table_info(%s)" % table))
                    if col not in have:
                        self.db.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, sql))
                self.db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_ext ON tasks(list_id, ext_id)")
                # a project from before it could hold several models: its one viewer project
                for r in self.db.execute("SELECT id, viewer FROM projects WHERE viewer != '' AND viewers = '[]'").fetchall():
                    self.db.execute("UPDATE projects SET viewers = ? WHERE id = ?", (json.dumps([r[1]]), r[0]))
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


def link_kind(url):
    """onedrive / sharepoint / acc / url, from the address (as filelinks.js does)."""
    m = re.match(r"^https?://([^/]+)(/[^?#]*)?", url or "", re.I)
    if not m:
        return "url"
    host, path = m.group(1).lower(), (m.group(2) or "")
    if host == "1drv.ms" or host.endswith("onedrive.live.com") or host.endswith("-my.sharepoint.com"):
        return "onedrive"
    if host.endswith(".sharepoint.com"):
        return "sharepoint"
    if host == "acc.autodesk.com" or host.endswith(".b360.autodesk.com") or \
            (host.endswith("autodesk.com") and re.search(r"/(docs|build|projects)/", path)):
        return "acc"
    return "url"


def clean_links(v):
    out = []
    for l in (v if isinstance(v, list) else []):
        if not isinstance(l, dict):
            continue
        kind = l.get("kind") if l.get("kind") in LINK_KINDS else "url"
        url = clean_text(l.get("url"), 2000)
        if kind == "url":
            kind = link_kind(url)
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
        elif t == "check":
            if val in (True, 1, "1", "true", "yes", "Yes"):
                out[fid] = True
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
            "reg": r["reg"] or "", "sort": r["sort"], "rev": r["rev"]}


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
            "sort": r["sort"], "comment_count": r["comment_count"], "rev": r["rev"], "ext_id": r["ext_id"] or "",
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


# ------------------------------------------------------------ import (Lark, Excel, CSV)
#
# Lark's "Export" of a task list is an .xlsx with one row per task and per
# sub-task. Python's own zipfile and XML reader are enough to read it, so
# the server needs nothing new installed. A CSV (Excel "Save as CSV") goes
# through the same mapping.

XNS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
HYPERLINK = re.compile(r'HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[,;]\s*"((?:[^"]|"")*)"\s*\)', re.I)
BUILTIN_DATES = set(range(14, 23)) | {45, 46, 47}


class Cell(str):
    """A cell's text, with the address of the link it carried (Lark puts
    each task's own Lark link on its title)."""
    url = ""


def _col_index(ref):
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def read_xlsx(data):
    """The first sheet of a workbook as rows of cells (str, Cell or
    datetime)."""
    import datetime
    import zipfile
    import xml.etree.ElementTree as ET
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="That is not an Excel (.xlsx) file")
    names = set(z.namelist())
    shared = []
    if "xl/sharedStrings.xml" in names:
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(XNS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(XNS + "t")))
    dates = set()
    if "xl/styles.xml" in names:
        st = ET.fromstring(z.read("xl/styles.xml"))
        custom = {}
        nf = st.find(XNS + "numFmts")
        for f in (nf if nf is not None else []):
            custom[int(f.get("numFmtId"))] = f.get("formatCode") or ""
        xfs = st.find(XNS + "cellXfs")
        for i, xf in enumerate(xfs if xfs is not None else []):
            fid = int(xf.get("numFmtId") or 0)
            code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", custom.get(fid, "")).lower()
            if fid in BUILTIN_DATES or (fid in custom and re.search(r"[dy]", code)):
                dates.add(i)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    first = wb.find(XNS + "sheets")[0]
    rid = first.get(RNS + "id")
    target = "worksheets/sheet1.xml"
    if "xl/_rels/workbook.xml.rels" in names:
        for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
            if r.get("Id") == rid:
                target = r.get("Target")
    path = target.lstrip("/") if target.startswith("/") else "xl/" + target
    sheet = ET.fromstring(z.read(path))
    rows = []
    for row in sheet.iter(XNS + "row"):
        cells = {}
        for c in row.iter(XNS + "c"):
            t = c.get("t")
            v = c.find(XNS + "v")
            f = c.find(XNS + "f")
            val = v.text if v is not None and v.text is not None else ""
            if t == "s" and val:
                val = shared[int(val)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(XNS + "t"))
            elif t in (None, "n") and val and int(c.get("s") or 0) in dates:
                try:
                    val = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(val))
                except (ValueError, OverflowError):
                    pass
            if isinstance(val, str):
                m = HYPERLINK.search(f.text or "" if f is not None else "") or HYPERLINK.search(val)
                if m:
                    cell = Cell(m.group(2).replace('""', '"'))
                    cell.url = m.group(1).replace('""', '"')
                    val = cell
            cells[_col_index(c.get("r") or "A")] = val
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def read_csv(text):
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    out = []
    for r in csv.reader(io.StringIO(text), dialect):
        cells = []
        for v in r:
            m = HYPERLINK.search(v)
            if m:
                c = Cell(m.group(2))
                c.url = m.group(1)
                v = c
            cells.append(v)
        out.append(cells)
    return out


# What each column means, by the names Lark and Excel users give them.
ALIASES = {
    "title": ("task title", "title", "task", "task name", "name", "summary"),
    "description": ("task description", "description", "notes", "details"),
    "done": ("completion status", "status", "completed", "done", "state"),
    "group": ("custom group", "group", "section"),
    "owner": ("owner", "owners", "assignee", "assignees", "assigned to"),
    "subscribers": ("subscriber", "subscribers", "followers"),
    "creator": ("creator", "created by"),
    "created": ("created on", "created at", "created time"),
    "start": ("start date", "start time", "start"),
    "completed_at": ("completed on", "completed at", "completion time"),
    "due": ("due date", "due", "deadline", "end date"),
    "updated": ("updated on", "updated at"),
    "priority": ("priority",),
    "ext": ("task id",),
    "parent_ext": ("parent task id",),
    "parent": ("parent task", "parent"),
    "list": ("task list",),
}
# Columns that become custom fields of a known kind.
KNOWN_FIELDS = {
    "modelers": "person", "project manager": "person", "task completers": "person",
    "completion method": "select", "milestone": "check",
}
# Lark's own working columns: counts and lookups it works out itself.
IGNORED = re.compile(r"^(task list id|sub-task count|comment count|predecessor task id|successor task id|"
                     r"by owner|by incomplete|by completed|completion rate|overdue|overdue days|task days|"
                     r"sourceid|sub-task progress|parent items.*|lookup.*|l\d|main task group|main task title|"
                     r"text \d+|link \d+)$", re.I)


def map_columns(head):
    """{canonical key: column index}, {field name: (index, type)}."""
    low = [str(h or "").strip().lower() for h in head]
    cols, fields = {}, {}
    for key, names in ALIASES.items():
        for n in names:
            if n in low and low.index(n) not in cols.values():
                cols[key] = low.index(n)
                break
    for i, h in enumerate(low):
        if not h or i in cols.values() or IGNORED.match(h):
            continue
        fields[str(head[i]).strip()] = (i, KNOWN_FIELDS.get(h, "text"))
    return cols, fields


def to_date(v):
    """A date cell -> YYYY-MM-DD (Hong Kong / Manila day)."""
    import datetime
    if isinstance(v, datetime.datetime):
        return (v + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")
    s = str(v or "").strip()
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


def to_iso(v):
    """A date-and-time cell (Lark exports UTC) -> ISO time."""
    import datetime
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")
    d = to_date(v)
    return d + "T00:00:00Z" if d else ""


def is_done(v):
    return str(v or "").strip().lower() in ("1", "true", "yes", "done", "completed", "complete", "closed", "已完成")


def viewers_of(r):
    """The viewer projects (model and sheets) of a project - one or several
    parts, e.g. MOS Site 1 and Site 2. The first is its main one."""
    try:
        v = json.loads(r["viewers"] or "[]")
    except (TypeError, ValueError, IndexError, KeyError):
        v = []
    if not v and r["viewer"]:
        v = [r["viewer"]]
    return [x for x in v if isinstance(x, str) and x]


def project_people(core, reg):
    """(set of account ids, project row) for a register project: its
    owners and members (chat.py: who is in the project's channel)."""
    try:
        with Db(os.path.join(core.CFG["data"], "tasks.db")) as d:
            r = d.execute("SELECT * FROM projects WHERE id = ? AND deleted = 0", (reg,)).fetchone()
            if not r:
                return set(), None
            r = dict(r)
            uids = set(p.get("uid") for p in json.loads(r["owners"] or "[]") if p.get("uid") is not None)
            parts = [v for v in viewers_of(r) if core.project_dir(v)]
            for v in parts:
                uids.update(m["id"] for m in core.ACC.members(v) if m.get("active"))
            if not parts:
                uids.update(m["uid"] for m in d.execute("SELECT uid FROM reg_members WHERE reg = ?", (reg,)))
            return uids, r
    except Exception:
        return set(), None


def reg_ids_for_viewer(core, pid):
    """The register projects shown by a viewer project (for issue cards)."""
    try:
        with Db(os.path.join(core.CFG["data"], "tasks.db")) as d:
            return [r["id"] for r in d.execute("SELECT * FROM projects WHERE deleted = 0 AND viewers LIKE ?", ('%"' + pid + '"%',))
                    if pid in viewers_of(r)]
    except Exception:
        return []


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

    def card(task, event, by, text=""):
        """A line in the job's chat channel (chat.py) for what just happened
        to a task. Only top-level tasks of a group linked to a project."""
        try:
            import chat
        except Exception:
            return
        try:
            with db() as d:
                g = d.execute("SELECT g.reg, g.title, l.title AS list_title FROM groups g JOIN lists l ON l.id = g.list_id "
                              "WHERE g.id = ?", (task.get("group_id") or "",)).fetchone()
        except Exception:
            return
        if not g or not g["reg"]:
            return
        chat.post_card([g["reg"]], {
            "type": "task", "event": event, "list_id": task["list_id"], "task_id": task["id"],
            "title": task.get("title") or "Untitled task", "group": g["title"], "list": g["list_title"],
            "due": task.get("due") or "", "done": bool(task.get("done")),
            "owners": [p.get("name") for p in task.get("owners") or []], "text": (text or "")[:300]}, by)

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
                # the register project (Projects page); its viewer project wins
                reg = clean_text(g.get("reg"), 48) if "reg" in g else (old["reg"] if old else "")
                if reg:
                    rr = d.execute("SELECT * FROM projects WHERE id = ? AND deleted = 0", (reg,)).fetchone()
                    if not rr:
                        reg = ""
                    elif rr["viewer"]:
                        pid = rr["viewer"]
                if old:
                    d.execute("UPDATE groups SET title = ?, project = ?, reg = ?, sort = ?, rev = ?, deleted = 0 WHERE id = ?",
                              (title, pid, reg, sort, rev, gid))
                else:
                    d.execute("INSERT INTO groups (id, list_id, title, project, reg, sort, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                              (gid, lid, title, pid, reg, sort, rev))
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
                    elif not new["parent_id"]:
                        events.append(("created", dict(new, id=tid, list_id=lid), []))
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
            card(task, {"owner": "assigned", "done": "completed", "created": "created"}[kind], by,
                 ", ".join(p["name"] for p in who_) if kind == "owner" else "")
            if kind == "created":
                continue
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
                   "files": json.loads(c["files"] or "[]"), "created_at": c["created_at"]} for c in d.execute(
                "SELECT * FROM comments WHERE task_id = ? AND deleted = 0 ORDER BY created_at", (tid,))]
            hist = [dict(a) for a in d.execute(
                "SELECT at, by, event, field, old, new FROM activity WHERE task_id = ? ORDER BY id DESC LIMIT 200", (tid,))]
        return {"task": task_row(r), "comments": cs, "activity": hist, "role": role}

    @app.post("/api/tasks/{tid}/comments")
    async def task_comment(request: Request, tid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        text = clean_text(body.get("body"), MAX_COMMENT, multiline=True).strip()
        # pictures and files sent with it were uploaded first (chat.py)
        files = []
        if body.get("files"):
            try:
                import chat
                files = chat.files_for(body.get("files"), task=tid)
            except Exception:
                files = []
        if not text and not files:
            raise HTTPException(status_code=400, detail="An empty comment")
        by, t = person(w, body), now_iso()
        with db() as d:
            r = d.execute("SELECT * FROM tasks WHERE id = ? AND deleted = 0", (tid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such task")
            need_list(d, w, r["list_id"], "editor")
            cid = new_id()
            d.execute("INSERT INTO comments (id, task_id, author, uid, body, created_at, files) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (cid, tid, by, w.uid, text, t, json.dumps(files)))
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
        card(task, "comment", by, text or "%d file%s" % (len(files), "" if len(files) == 1 else "s"))
        return {"id": cid, "author": by, "uid": w.uid, "body": text, "files": files, "created_at": t, "task": task}

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
    def tasks_mine(request: Request, view: str = "owned", x_viewer_token: str = Header(default="")):
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

    # ------------------------------------------------ project register

    def reg_row(r):
        return {"id": r["id"], "code": r["code"], "name": r["name"], "short": r["short"],
                "owners": json.loads(r["owners"] or "[]"), "team": r["team"], "status": r["status"],
                "viewer": r["viewer"], "viewers": viewers_of(r), "links": json.loads(r["links"] or "[]"), "notes": r["notes"],
                "sort": r["sort"], "rev": r["rev"], "updated_by": r["updated_by"] or "", "updated_at": r["updated_at"] or ""}

    def reg_can_edit(w, r):
        if w.site_admin:
            return True
        if r is not None and any(p.get("uid") == w.uid for p in json.loads(r["owners"] or "[]")):
            return True
        if r is not None and any(core.project_dir(v) and core.role_in(w, v) == "admin" for v in viewers_of(r)):
            return True
        return False

    def reg_can_create(w):
        """Projects are added on the Admin page, by a site admin."""
        return w.site_admin

    def ensure_registry(d):
        """Every viewer project (export folder) has its row on the Projects
        page, so the two lists never disagree."""
        have = set()
        for r in d.execute("SELECT * FROM projects WHERE deleted = 0"):
            have.update(viewers_of(r))
        t = now_iso()
        for p in core.list_projects():
            if p["id"] in have:
                continue
            rev = next_rev(d)
            # a project already on the page under that name (made before its first upload): link it
            keys = (p["id"].lower(), p["title"].lower(), split_code(p["title"])[1].lower())
            hit = next((r for r in d.execute("SELECT * FROM projects WHERE viewer = '' AND deleted = 0").fetchall()
                        if any(k and k.lower() in keys for k in (r["short"], r["name"], r["code"]))), None)
            if hit:
                d.execute("UPDATE projects SET viewer = ?, viewers = ?, rev = ? WHERE id = ?",
                          (p["id"], json.dumps([p["id"]]), rev, hit["id"]))
                link_groups(d, d.execute("SELECT * FROM projects WHERE id = ?", (hit["id"],)).fetchone(), rev)
                continue
            code, short = split_code(p["title"])
            d.execute("INSERT INTO projects (id, code, name, short, viewer, viewers, sort, rev, created_by, created_at, updated_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'server', ?, ?)",
                      (new_id(), code, p["title"], short if code else p["id"], p["id"], json.dumps([p["id"]]), time.time(), rev, t, t))
            link_groups(d, d.execute("SELECT * FROM projects WHERE viewer = ? AND deleted = 0", (p["id"],)).fetchone(), rev)

    def members_of(d, r):
        """[{uid, name, email, team, office, role}] - the viewer project's
        members, or (no viewer project yet) the project's own list."""
        out = []
        parts = [v for v in viewers_of(r) if core.project_dir(v)]
        if parts:
            if core.accounts_on():
                rank = core.RANK
                seen = {}
                for v in parts:
                    for m in core.ACC.members(v):
                        if not m.get("active"):
                            continue
                        had = seen.get(m["id"])
                        if had is None:
                            seen[m["id"]] = {"uid": m["id"], "name": m["name"], "email": m.get("email") or "", "team": m.get("team") or "",
                                             "office": m.get("office") or "", "discipline": m.get("discipline") or "", "role": m["role"]}
                        elif rank.get(m["role"], 0) > rank.get(had["role"], 0):
                            had["role"] = m["role"]     # the highest role on any part
                out = list(seen.values())
            return out
        if not core.accounts_on():
            return out
        for m in d.execute("SELECT * FROM reg_members WHERE reg = ?", (r["id"],)).fetchall():
            u = core.ACC.get(m["uid"])
            if u and u["active"]:
                out.append({"uid": u["id"], "name": u["name"], "email": u.get("email") or "", "team": u.get("team") or "",
                            "office": u.get("office") or "", "discipline": u.get("discipline") or "", "role": m["role"]})
        return out

    def split_code(text):
        """"HKA-P-01681-ARC - SKW" -> ("HKA-P-01681-ARC", "SKW")."""
        m = re.match(r"^([A-Z]{2,}[A-Z0-9]*-[A-Z0-9-]*\d[A-Z0-9-]*?)-?\s*-?\s+(.+)$", text.strip())
        return (m.group(1).rstrip("-"), m.group(2).strip()) if m else ("", text.strip())

    def link_groups(d, r, rev):
        """Groups named like the project (its short name, name or code) and
        not yet linked are linked to it; linked groups follow its viewer
        project."""
        keys = [k.lower() for k in (r["short"], r["name"], r["code"]) if k]
        for g in d.execute("SELECT * FROM groups WHERE deleted = 0").fetchall():
            if (not g["reg"] and g["title"].lower() in keys) or g["reg"] == r["id"]:
                d.execute("UPDATE groups SET reg = ?, project = ?, rev = ? WHERE id = ?",
                          (r["id"], r["viewer"] or g["project"], rev, g["id"]))
                d.execute("UPDATE lists SET rev = ? WHERE id = ?", (rev, g["list_id"]))

    def issue_stats(w, pids):
        """Issues of all the project's parts you can open, added up; and per part."""
        if isinstance(pids, str):
            pids = [pids] if pids else []
        titles = dict((p["id"], p["title"]) for p in core.list_projects())
        total = None
        for pid in pids:
            one = issue_stats_one(w, pid)
            if one is None:
                continue
            if total is None:
                total = {"total": 0, "open": 0, "overdue": 0, "by_status": {}, "parts": []}
            for k in ("total", "open", "overdue"):
                total[k] += one[k]
            for k, n in one["by_status"].items():
                total["by_status"][k] = total["by_status"].get(k, 0) + n
            total["parts"].append({"viewer": pid, "title": titles.get(pid, pid), "open": one["open"], "total": one["total"],
                                   "overdue": one["overdue"]})
        return total

    # counted again only when the project's issues changed (its revision)
    _STATS = {}

    def issue_stats_one(w, pid):
        if not pid or not core.project_dir(pid) or not core.role_in(w, pid):
            return None
        today = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))
        try:
            st = core.store_for(pid)
            rev = st.current_rev()
            hit = _STATS.get(pid)
            if hit and hit[0] == rev and hit[1] == today:
                return json.loads(hit[2])
            items = [it for it in st.all_items()[1] if it.get("issue") and not it.get("deleted")]
        except Exception:
            return None
        out = count_issues(items, today)
        _STATS[pid] = (rev, today, json.dumps(out))
        return out

    def count_issues(items, today):
        open_ = [it for it in items if it["issue"].get("status") not in ("Resolved", "Closed")
                 and not it["issue"].get("dismissed")]
        by = {}
        for it in items:
            st = "Not an issue" if it["issue"].get("dismissed") else (it["issue"].get("status") or "Open")
            by[st] = by.get(st, 0) + 1
        return {"total": len(items), "open": len(open_), "by_status": by,
                "overdue": len([it for it in open_ if (it["issue"].get("due_date") or "9999") < today])}

    def reg_stats(d, w, ids=None):
        """Per register project: its task groups, task counts, open tasks."""
        today = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))
        mine = dict((r["id"], r) for r, _ in visible_lists(d, w))
        out = {}
        for g in d.execute("SELECT g.*, l.title AS list_title FROM groups g JOIN lists l ON l.id = g.list_id "
                           "WHERE g.deleted = 0 AND l.deleted = 0 AND g.reg != ''").fetchall():
            if ids and g["reg"] not in ids:
                continue
            st = out.setdefault(g["reg"], {"tasks": 0, "done": 0, "overdue": 0, "groups": [], "open_tasks": []})
            st["groups"].append({"id": g["id"], "title": g["title"], "list_id": g["list_id"],
                                 "list_title": g["list_title"], "can_open": g["list_id"] in mine})
            for t in d.execute("SELECT * FROM tasks WHERE group_id = ? AND parent_id = '' AND deleted = 0",
                               (g["id"],)).fetchall():
                st["tasks"] += 1
                st["done"] += t["done"]
                late = not t["done"] and t["due"] and t["due"][:10] < today
                st["overdue"] += 1 if late else 0
                if not t["done"] and g["list_id"] in mine:
                    st["open_tasks"].append({"id": t["id"], "list_id": t["list_id"], "title": t["title"],
                                             "due": t["due"], "overdue": bool(late),
                                             "owners": json.loads(t["owners"] or "[]")})
        for st in out.values():
            st["open_tasks"].sort(key=lambda x: x["due"] or "9999")
        return out

    # Plain def, not async: the issue counts read every item of every
    # project, and FastAPI runs a plain handler in its thread pool, so a slow
    # answer here does not hold up everyone else's requests (the chat).
    @app.get("/api/registry")
    def reg_list(request: Request, lite: int = 0, x_viewer_token: str = Header(default="")):
        """lite=1: names, members and parts only - no task or issue counts
        (the Messenger)."""
        w = core.who(request, x_viewer_token)
        with db() as d:
            ensure_registry(d)
            rows = d.execute("SELECT * FROM projects WHERE deleted = 0 ORDER BY sort, name").fetchall()
            if lite:
                # just the groups, for the chat's Tasks link
                stats = {}
                mine_l = set(r["id"] for r, _ in visible_lists(d, w))
                for g in d.execute("SELECT id, title, list_id, reg FROM groups WHERE deleted = 0 AND reg != '' ORDER BY sort").fetchall():
                    st = stats.setdefault(g["reg"], {"tasks": 0, "done": 0, "overdue": 0, "groups": [], "open_tasks": []})
                    st["groups"].append({"id": g["id"], "title": g["title"], "list_id": g["list_id"], "list_title": "",
                                         "can_open": g["list_id"] in mine_l})
            else:
                stats = reg_stats(d, w)
            members = dict((r["id"], members_of(d, r)) for r in rows)
        titles = dict((x["id"], x["title"]) for x in core.list_projects())
        out = []
        for r in rows:
            ms = members[r["id"]]
            mine = w.site_admin or any(m["uid"] == w.uid for m in ms) \
                or any(o.get("uid") == w.uid for o in json.loads(r["owners"] or "[]"))
            if not mine:
                continue
            p = reg_row(r)
            p["members"] = ms
            p["can_edit"] = reg_can_edit(w, r)
            p["stats"] = stats.get(r["id"]) or {"tasks": 0, "done": 0, "overdue": 0, "groups": [], "open_tasks": []}
            p["stats"]["open_tasks"] = p["stats"]["open_tasks"][:12]
            p["issues"] = None if lite else issue_stats(w, viewers_of(r))
            p["parts"] = [{"id": v, "title": titles.get(v, v), "ok": bool(core.project_dir(v) and core.role_in(w, v))}
                          for v in viewers_of(r)]
            ok = [x for x in p["parts"] if x["ok"]]
            p["viewer_ok"] = bool(ok)
            if ok and not (r["viewer"] and any(x["id"] == r["viewer"] for x in ok)):
                p["viewer"] = ok[0]["id"]           # links go to a part this person can open
            out.append(p)
        return {"projects": out, "can_create": reg_can_create(w)}

    @app.post("/api/registry")
    async def reg_save(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        by, t = person(w, body), now_iso()
        with db() as d:
            pid = body.get("id") if isinstance(body.get("id"), str) and SAFE_ID.match(body.get("id")) else None
            old = d.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone() if pid else None
            if old and not reg_can_edit(w, old):
                raise HTTPException(status_code=403, detail="Only the project's owners, its viewer admins or a site admin can change it")
            if not old and not reg_can_create(w):
                raise HTTPException(status_code=403, detail="Only project admins and site admins can add projects")
            cur = reg_row(old) if old else {"code": "", "name": "", "short": "", "owners": [], "team": "",
                                            "status": "Active", "viewer": "", "viewers": [], "links": [], "notes": "", "sort": time.time()}
            for k in ("code", "short", "team", "status"):
                if k in body:
                    cur[k] = clean_text(body[k], 80)
            if "name" in body:
                cur["name"] = clean_text(body["name"], 160)
            if "notes" in body:
                cur["notes"] = clean_text(body["notes"], 4000, True)
            if "owners" in body:
                cur["owners"] = clean_people(body["owners"])
            if "links" in body:
                cur["links"] = clean_links(body["links"])
            # its parts: one viewer project or several (Site 1, Site 2 ...)
            if "viewers" in body or "viewer" in body:
                vs = body.get("viewers") if isinstance(body.get("viewers"), list) else [body.get("viewer")]
                vs = [clean_text(v, 80) for v in vs if v]
                vs = list(dict.fromkeys(vs))[:20]
                for v in vs:
                    if not core.project_dir(v):
                        raise HTTPException(status_code=400, detail="No viewer project %s" % v)
                cur["viewers"] = vs
            cur["viewer"] = cur["viewers"][0] if cur["viewers"] else ""
            if not cur["name"]:
                raise HTTPException(status_code=400, detail="A project needs a name")
            if not cur["short"]:
                cur["short"] = split_code(cur["name"])[1]
            if not cur["code"]:
                cur["code"] = split_code(cur["name"])[0]
            rev = next_rev(d)
            pid = pid or new_id()
            before = viewers_of(old) if old else []
            added = [v for v in cur["viewers"] if v not in before]
            if old and added and core.accounts_on():
                # the members gathered before the model existed come along
                for m in d.execute("SELECT * FROM reg_members WHERE reg = ?", (old["id"],)).fetchall():
                    for v in added:
                        if not core.ACC.role(m["uid"], v):
                            core.ACC.set_member(v, m["uid"], m["role"] if m["role"] in core.ROLES else "member", by=by)
            # a part taken from another project: out of that one. An entry the
            # server made for that model alone goes, and its task groups move here.
            for o in d.execute("SELECT * FROM projects WHERE deleted = 0 AND id != ?", (pid,)).fetchall():
                theirs = viewers_of(o)
                if not any(v in theirs for v in added):
                    continue
                left = [v for v in theirs if v not in added]
                if not left and o["created_by"] == "server":
                    d.execute("UPDATE projects SET deleted = 1, viewers = '[]', viewer = '', rev = ? WHERE id = ?", (rev, o["id"]))
                    d.execute("UPDATE groups SET reg = ?, rev = ? WHERE reg = ?", (pid, rev, o["id"]))
                else:
                    d.execute("UPDATE projects SET viewers = ?, viewer = ?, rev = ? WHERE id = ?",
                              (json.dumps(left), left[0] if left else "", rev, o["id"]))
            d.execute("INSERT INTO projects (id, code, name, short, owners, team, status, viewer, viewers, links, notes, sort, rev, "
                      "created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                      "ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, short=excluded.short, "
                      "owners=excluded.owners, team=excluded.team, status=excluded.status, viewer=excluded.viewer, "
                      "viewers=excluded.viewers, links=excluded.links, notes=excluded.notes, rev=excluded.rev, deleted=0, "
                      "created_by=CASE WHEN projects.created_by = 'server' THEN excluded.updated_by ELSE projects.created_by END, "
                      "updated_by=excluded.updated_by, updated_at=excluded.updated_at",
                      (pid, cur["code"], cur["name"], cur["short"], json.dumps(cur["owners"]), cur["team"], cur["status"],
                       cur["viewer"], json.dumps(cur["viewers"]), json.dumps(cur["links"]), cur["notes"], cur["sort"], rev, by, t, by, t))
            link_groups(d, d.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone(), rev)
            row = d.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
        return reg_row(row)

    @app.delete("/api/registry/{pid}")
    async def reg_delete(request: Request, pid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            r = d.execute("SELECT * FROM projects WHERE id = ? AND deleted = 0", (pid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such project")
            if not reg_can_edit(w, r):
                raise HTTPException(status_code=403, detail="You cannot delete this project")
            rev = next_rev(d)
            d.execute("UPDATE projects SET deleted = 1, rev = ? WHERE id = ?", (rev, pid))
            d.execute("UPDATE groups SET reg = '', rev = ? WHERE reg = ?", (rev, pid))
        return {"ok": True}

    def reg_get(d, rid):
        r = d.execute("SELECT * FROM projects WHERE id = ? AND deleted = 0", (rid,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such project")
        return r

    @app.get("/api/registry/{rid}/members")
    async def reg_members_get(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            r = reg_get(d, rid)
            return {"members": members_of(d, r), "viewer": r["viewer"], "viewers": viewers_of(r), "can_edit": reg_can_edit(w, r)}

    @app.put("/api/registry/{rid}/members")
    async def reg_members_put(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """{uid, role} - a project without a viewer project. (One with a
        viewer project: Admin > Projects and members, as before.)"""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            r = reg_get(d, rid)
            if not reg_can_edit(w, r):
                raise HTTPException(status_code=403, detail="Only the project's admins or a site admin")
            if any(core.project_dir(v) for v in viewers_of(r)):
                raise HTTPException(status_code=400, detail="This project's members are those of its viewer projects")
            try:
                uid = int(body.get("uid"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Who?")
            if not core.ACC.get(uid):
                raise HTTPException(status_code=404, detail="No such person")
            role = body.get("role") if body.get("role") in core.ROLES else "member"
            d.execute("INSERT INTO reg_members (reg, uid, role) VALUES (?, ?, ?) "
                      "ON CONFLICT(reg, uid) DO UPDATE SET role = excluded.role", (rid, uid, role))
        return {"ok": True}

    @app.delete("/api/registry/{rid}/members/{uid}")
    async def reg_members_del(request: Request, rid: str, uid: int, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        with db() as d:
            r = reg_get(d, rid)
            if not reg_can_edit(w, r):
                raise HTTPException(status_code=403, detail="Only the project's admins or a site admin")
            d.execute("DELETE FROM reg_members WHERE reg = ? AND uid = ?", (rid, uid))
        return {"ok": True}

    @app.get("/api/registry/{rid}/tasks")
    def reg_tasks(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """The project's tasks, with their sub-tasks, from every task list
        you can open that has a group for this project."""
        w = core.who(request, x_viewer_token)
        with db() as d:
            reg_get(d, rid)
            mine = dict((r["id"], r) for r, _ in visible_lists(d, w))
            out = []
            for g in d.execute("SELECT * FROM groups WHERE reg = ? AND deleted = 0 ORDER BY sort", (rid,)).fetchall():
                if g["list_id"] not in mine:
                    continue
                rows = [task_row(t) for t in d.execute(
                    "SELECT * FROM tasks WHERE group_id = ? AND deleted = 0 ORDER BY sort", (g["id"],))]
                tops = [t for t in rows if not t["parent_id"]]
                for t in tops:
                    t["children"] = [k for k in rows if k["parent_id"] == t["id"]]
                out.append({"group": group_row(g), "list_id": g["list_id"], "list_title": mine[g["list_id"]]["title"],
                            "tasks": tops})
        return {"groups": out}

    @app.get("/api/project-choices")
    def project_choices(request: Request, x_viewer_token: str = Header(default="")):
        """For the project pickers (Board, Dashboard, the sheets and 3D pages):
        the viewer projects you can open, under the names of their projects."""
        w = core.who(request, x_viewer_token)
        mine = [p for p in core.list_projects() if core.role_in(w, p["id"])]
        titles = dict((p["id"], p["title"]) for p in mine)
        with db() as d:
            ensure_registry(d)
            rows = d.execute("SELECT * FROM projects WHERE deleted = 0 ORDER BY sort, name").fetchall()
        out, used = [], set()
        for r in rows:
            parts = [{"id": v, "title": titles[v]} for v in viewers_of(r) if v in titles]
            if not parts:
                continue
            used.update(x["id"] for x in parts)
            out.append({"reg": r["id"], "name": r["short"] or r["name"], "full": r["name"], "code": r["code"], "parts": parts})
        others = [{"id": p["id"], "title": p["title"]} for p in mine if p["id"] not in used]
        return {"projects": out, "others": others}

    # ------------------------------------------------ links for the Messenger

    _ITEMS = {}          # viewer project -> (revision, issues, saved views)

    def items_of(pid):
        try:
            st = core.store_for(pid)
            rev = st.current_rev()
        except Exception:
            return [], []
        hit = _ITEMS.get(pid)
        if hit and hit[0] == rev:
            return hit[1], hit[2]
        try:
            items = st.all_items()[1]
        except Exception:
            items = []
        issues, views = [], []
        for it in items:
            if it.get("deleted"):
                continue
            iss = it.get("issue")
            if isinstance(iss, dict):
                issues.append({"id": it["id"], "number": iss.get("number"), "title": iss.get("title") or "Issue",
                               "status": iss.get("status") or "Open", "dismissed": bool(iss.get("dismissed")),
                               "sheet": it.get("sheet") or ""})
            elif it.get("placement") == "view" and it.get("name"):
                views.append({"id": it["id"], "name": it["name"]})
        _ITEMS[pid] = (rev, issues, views)
        return issues, views

    def sheets_of(pid):
        try:
            with open(os.path.join(core.project_dir(pid), "manifest.json"), encoding="utf-8") as f:
                return [x for x in (json.load(f).get("sheets") or []) if isinstance(x, dict) and x.get("number")]
        except Exception:
            return []

    @app.get("/api/link-search")
    def link_search(request: Request, kind: str = "task", q: str = "", reg: str = "",
                    x_viewer_token: str = Header(default="")):
        """# task, ! issue, $ sheet, % 3D in the Messenger: what matches q, as
        [{label, sub, url, kind}]. In a project's channel (reg) only that
        project; otherwise every project you can open."""
        w = core.who(request, x_viewer_token)
        ql = (q or "").strip().lower()[:60]
        titles = dict((p["id"], p["title"]) for p in core.list_projects())
        with db() as d:
            ensure_registry(d)
            regs = d.execute("SELECT * FROM projects WHERE deleted = 0 ORDER BY sort, name").fetchall()
            one = [r for r in regs if r["id"] == reg]
            scope = one or regs
            out = []
            if kind == "task":
                lists = dict((r["id"], r) for r, _ in visible_lists(d, w))
                if lists:
                    args = list(lists.keys())
                    sql = ("SELECT t.*, g.title AS g_title, g.reg AS g_reg FROM tasks t JOIN groups g ON g.id = t.group_id "
                           "WHERE t.deleted = 0 AND g.deleted = 0 AND t.list_id IN (%s)" % ",".join("?" * len(args)))
                    if one:
                        sql += " AND g.reg = ?"
                        args.append(reg)
                    if ql:
                        sql += " AND (LOWER(t.title) LIKE ? OR LOWER(g.title) LIKE ?)"
                        args += ["%" + ql + "%", "%" + ql + "%"]
                    sql += " ORDER BY t.done, CASE WHEN t.due = '' THEN 1 ELSE 0 END, t.due, t.updated_at DESC LIMIT 20"
                    for t in d.execute(sql, args).fetchall():
                        out.append({"kind": "task", "label": t["title"] or "Untitled task",
                                    "sub": "%s / %s%s" % (lists[t["list_id"]]["title"], t["g_title"], " · done" if t["done"] else ""),
                                    "url": "tasks.html?" + urlencode({"list": t["list_id"], "task": t["id"]})})
                return {"rows": out}
        # issues, sheets, 3D: the viewer projects in scope that you can open
        parts = []
        for r in scope:
            name = r["short"] or r["name"]
            for v in viewers_of(r):
                if core.project_dir(v) and core.role_in(w, v) and v not in [x[0] for x in parts]:
                    parts.append((v, name, titles.get(v, v), len(viewers_of(r)) > 1))
        if not one:
            used = set(x[0] for x in parts)
            for p in core.list_projects():
                if p["id"] not in used and core.role_in(w, p["id"]):
                    parts.append((p["id"], p["title"], p["title"], False))

        def where(name, title, many):
            return name + (" - " + title if many else "") if not one or many else ""
        for v, name, title, many in parts:
            at = where(name, title, many)
            if kind == "issue":
                issues, _ = items_of(v)
                for it in issues:
                    hay = ("#%s %s %s" % (it["number"] or "", it["title"], it["sheet"])).lower()
                    if ql and ql.lstrip("#") not in hay:
                        continue
                    url = ("index.html?" + urlencode({"project": v, "sheet": it["sheet"], "select": it["id"]})) if it["sheet"] \
                        else ("model.html?" + urlencode({"project": v, "select": it["id"]}))
                    closed = it["dismissed"] or it["status"] in ("Resolved", "Closed")
                    out.append({"kind": "issue", "label": "#%s %s" % (it["number"] or "?", it["title"]),
                                "sub": " · ".join(x for x in (at, it["sheet"] or "3D", it["status"]) if x),
                                "url": url, "_k": (closed, -(it["number"] or 0))})
            elif kind == "sheet":
                for sh in sheets_of(v):
                    lab = "%s %s" % (sh.get("number"), sh.get("name") or "")
                    if ql and ql not in lab.lower():
                        continue
                    out.append({"kind": "sheet", "label": lab.strip(), "sub": at,
                                "url": "index.html?" + urlencode({"project": v, "sheet": sh.get("number")}), "_k": (0, 0)})
            elif kind == "model":
                lab = "3D model - " + (title if many or not one else name)
                if not ql or ql in lab.lower() or ql in name.lower():
                    out.append({"kind": "view3d", "label": lab, "sub": "" if one and not many else name,
                                "url": "model.html?" + urlencode({"project": v}), "_k": (0, 0)})
                _, views = items_of(v)
                for vw in views:
                    if ql and ql not in vw["name"].lower():
                        continue
                    out.append({"kind": "view3d", "label": "3D view - " + vw["name"], "sub": at,
                                "url": "model.html?" + urlencode({"project": v, "select": vw["id"]}), "_k": (1, 0)})
        out.sort(key=lambda x: x.get("_k", (0, 0)))
        for x in out:
            x.pop("_k", None)
        return {"rows": out[:30]}

    @app.post("/api/registry/import")
    async def reg_import(request: Request, x_viewer_token: str = Header(default="")):
        """A project table (Lark Base "Projects", or Excel): columns Project,
        Owner, Group / Team, Project Folder, Status, Code, Viewer."""
        w = core.who(request, x_viewer_token)
        if not reg_can_create(w):
            raise HTTPException(status_code=403, detail="Only project admins and site admins can add projects")
        body = await read_json(request)
        rows = rows_from(body)
        if len(rows) < 2:
            raise HTTPException(status_code=400, detail="Nothing to import")
        low = [str(h or "").strip().lower() for h in rows[0]]

        def col(*names):
            for n in names:
                if n in low:
                    return low.index(n)
            return None
        c = {"name": col("project", "project name", "name"), "code": col("code", "project code", "job number"),
             "owner": col("owner", "owners", "project owner"), "team": col("group", "team"),
             "folder": col("project folder", "folder", "link", "onedrive", "acc"), "status": col("status"),
             "viewer": col("viewer", "viewer project")}
        if c["name"] is None:
            raise HTTPException(status_code=400, detail="No Project column found")
        people = matcher()
        projects = core.list_projects()
        by, t = person(w, body), now_iso()
        made = 0
        with db() as d:
            rev = next_rev(d)
            have = dict((r["name"].lower(), r) for r in d.execute("SELECT * FROM projects WHERE deleted = 0"))
            for i, r in enumerate(rows[1:]):
                g = lambda k: (r[c[k]] if c[k] is not None and c[k] < len(r) else "")
                name = clean_text(g("name"), 160)
                if not name:
                    continue
                code, short = split_code(name)
                code = clean_text(g("code"), 80) or code
                folder = g("folder")
                url = getattr(folder, "url", "") or (str(folder) if str(folder).startswith("http") else "")
                label = str(folder).strip()
                links = [{"kind": "url", "url": url,
                          "title": "Project folder" if not label or label.startswith("http") else label}] if url else []
                # "Viewer": one viewer project, or several ("MOS-S1; MOS-S2")
                ids = set(p["id"] for p in projects)
                vs = [v.strip() for v in re.split(r"[,;\n]+", str(g("viewer") or "")) if v.strip() in ids]
                if not vs:
                    vs = [p["id"] for p in projects if p["id"].lower() in (short.lower(), code.lower(), name.lower(), str(folder).strip().lower())
                          or p["title"].lower() in (short.lower(), name.lower())][:1]
                old = have.get(name.lower())
                if old and not vs:
                    vs = viewers_of(old)
                pid = old["id"] if old else new_id()
                d.execute("INSERT INTO projects (id, code, name, short, owners, team, status, viewer, viewers, links, notes, sort, rev, "
                          "created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?) "
                          "ON CONFLICT(id) DO UPDATE SET code=excluded.code, owners=excluded.owners, team=excluded.team, "
                          "status=excluded.status, viewer=excluded.viewer, viewers=excluded.viewers, "
                          "links=excluded.links, rev=excluded.rev, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
                          (pid, code, name, short, json.dumps(people(g("owner"))), clean_text(g("team"), 80),
                           clean_text(g("status"), 40) or "Active", vs[0] if vs else "", json.dumps(vs),
                           json.dumps(clean_links(links)), i, rev, by, t, by, t))
                link_groups(d, d.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone(), rev)
                made += 1
        return {"imported": made, "unmatched": sorted(people.missing)}

    @app.post("/api/task-lists/{lid}/groups/{gid}/reg")
    async def group_reg(request: Request, lid: str, gid: str, x_viewer_token: str = Header(default="")):
        """Link one group to a register project ({reg: id or ""})."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        with db() as d:
            need_list(d, w, lid, "editor")
            g = d.execute("SELECT * FROM groups WHERE id = ? AND list_id = ?", (gid, lid)).fetchone()
            if not g:
                raise HTTPException(status_code=404, detail="No such group")
            reg = clean_text(body.get("reg"), 48)
            r = d.execute("SELECT * FROM projects WHERE id = ? AND deleted = 0", (reg,)).fetchone() if reg else None
            if reg and not r:
                raise HTTPException(status_code=404, detail="No such project")
            rev = next_rev(d)
            d.execute("UPDATE groups SET reg = ?, project = ?, rev = ? WHERE id = ?",
                      (reg, (r["viewer"] if r else "") or (g["project"] if r else ""), rev, gid))
            d.execute("UPDATE lists SET rev = ? WHERE id = ?", (rev, lid))
        return {"ok": True}

    # ------------------------------------------------ import

    def matcher():
        """Names in a Lark export -> accounts. Lark often has first names
        only ("Jake"), so a first name that fits exactly one account is
        taken as that person. A name with no account is kept as a name and
        can be matched later (relink), once the account exists."""
        users = [u for u in core.ACC.list() if u["active"]] if core.accounts_on() else []
        full = dict((u["name"].strip().lower(), u) for u in users if u["name"])
        first = {}
        for u in users:
            f = (u["name"] or "").strip().lower().split(" ")[0]
            first.setdefault(f, []).append(u)
        missing = set()

        def one(name):
            n = (name or "").strip()
            if not n:
                return None
            u = full.get(n.lower())
            if not u:
                hits = first.get(n.lower()) or [x for x in users if x["name"].lower().startswith(n.lower() + " ")]
                u = hits[0] if len(hits) == 1 else None
            if u:
                return {"uid": u["id"], "name": u["name"]}
            missing.add(n)
            return {"uid": None, "name": n}

        def many(v):
            if isinstance(v, list):
                names = [p.get("name") if isinstance(p, dict) else p for p in v]
            else:
                names = re.split(r"[,;/、，\n]+", str(v or ""))
            return clean_people([p for p in (one(x) for x in names) if p])
        many.missing = missing
        many.one = one
        return many

    def do_import(d, w, lid, rows, by):
        if len(rows) < 2:
            raise HTTPException(status_code=400, detail="The file has no rows under its heading")
        cols, extra = map_columns(rows[0])
        if "title" not in cols:
            raise HTTPException(status_code=400, detail="No title column found (looked for Task title, Title, Task, Name)")
        people = matcher()
        t = now_iso()
        rev = next_rev(d)
        body = [r for r in rows[1:] if any(str(c).strip() for c in r)]

        def cell(r, key):
            i = cols.get(key)
            return r[i] if i is not None and i < len(r) else ""

        # custom fields: the ones the list has, and new ones for the file's columns
        fields = dict((r["name"].lower(), (r["id"], r["type"])) for r in d.execute(
            "SELECT * FROM fields WHERE list_id = ? AND deleted = 0", (lid,)))
        n_fields = len(fields)
        for name, (i, typ) in extra.items():
            vals = [r[i] for r in body if i < len(r) and str(r[i]).strip() not in ("", "0")]
            if name.lower() in fields or (typ == "text" and not vals):
                continue
            opts = sorted(set(str(v).strip() for v in vals))[:50] if typ == "select" else []
            fid = new_id()
            d.execute("INSERT INTO fields (id, list_id, name, type, options, sort, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (fid, lid, clean_text(name, 60), typ, json.dumps(opts), n_fields, rev))
            fields[name.lower()] = (fid, typ)
            n_fields += 1
        groups = dict((r["title"].lower(), r["id"]) for r in d.execute(
            "SELECT * FROM groups WHERE list_id = ? AND deleted = 0", (lid,)))
        regs = {}
        for r in d.execute("SELECT * FROM projects WHERE deleted = 0"):
            for k in (r["short"], r["name"], r["code"]):
                if k:
                    regs.setdefault(k.lower(), r)
        known = dict((r["ext_id"], r) for r in d.execute(
            "SELECT * FROM tasks WHERE list_id = ? AND ext_id != '' AND deleted = 0", (lid,)))
        num = d.execute("SELECT next_number FROM lists WHERE id = ?", (lid,)).fetchone()["next_number"]
        made = changed = new_groups = 0
        by_ext, by_title, parents = {}, {}, []
        for i, r in enumerate(body):
            title = cell(r, "title")
            ext = clean_text(cell(r, "ext"), 64)
            gname = clean_text(cell(r, "group"), 120)
            if gname and gname.lower() not in groups:
                gid = new_id()
                reg = regs.get(gname.lower())
                d.execute("INSERT INTO groups (id, list_id, title, project, reg, sort, rev) VALUES (?, ?, ?, ?, ?, ?, ?)",
                          (gid, lid, gname, reg["viewer"] if reg else "", reg["id"] if reg else "", len(groups), rev))
                groups[gname.lower()] = gid
                new_groups += 1
            vals = {}
            for name, (ci, typ) in extra.items():
                if name.lower() not in fields or ci >= len(r):
                    continue
                fid, ftyp = fields[name.lower()]
                v = r[ci]
                if ftyp == "person":
                    v = people(v)
                elif ftyp == "check":
                    v = is_done(v)
                elif ftyp == "date":
                    v = to_date(v)
                elif ftyp == "number":
                    try:
                        v = float(v) if str(v).strip() else None
                    except ValueError:
                        v = None
                else:
                    v = clean_text(v, 500)
                if v not in (None, "", [], False):
                    vals[fid] = v
            done = is_done(cell(r, "done"))
            pr = str(cell(r, "priority") or "").strip().capitalize()
            creator = people.one(str(cell(r, "creator") or "").split(",")[0]) if cell(r, "creator") else None
            links = []
            if getattr(title, "url", ""):
                links.append({"id": "lark-" + (ext or new_id())[:20], "kind": "url", "url": title.url, "title": "Open in Lark",
                              "project": "", "ref": "", "added_by": by, "added_at": t})
            rec = {
                "title": clean_text(title, MAX_TITLE), "description": clean_text(cell(r, "description"), MAX_DESC, True),
                "done": done, "completed_at": (to_iso(cell(r, "completed_at")) or t) if done else "",
                "priority": pr if pr in PRIORITIES else "", "start": to_date(cell(r, "start")), "due": to_date(cell(r, "due")),
                "owners": people(cell(r, "owner")), "subscribers": people(cell(r, "subscribers")),
                "group_id": groups.get(gname.lower(), "") if gname else "",
            }
            old = known.get(ext) if ext else None
            if old:
                tid = old["id"]
                keep = [l for l in json.loads(old["links"] or "[]") if not str(l.get("id", "")).startswith("lark-")]
                merged = dict(json.loads(old["vals"] or "{}"))
                merged.update(vals)
                d.execute("UPDATE tasks SET title=?, description=?, done=?, completed_at=?, priority=?, start=?, due=?, "
                          "owners=?, subscribers=?, group_id=CASE WHEN ? != '' THEN ? ELSE group_id END, vals=?, links=?, "
                          "sort=?, rev=?, updated_by=?, updated_at=? WHERE id=?",
                          (rec["title"], rec["description"], int(done), rec["completed_at"], rec["priority"], rec["start"],
                           rec["due"], json.dumps(rec["owners"]), json.dumps(rec["subscribers"]), rec["group_id"],
                           rec["group_id"], json.dumps(merged), json.dumps(keep + links), i, rev, by,
                           to_iso(cell(r, "updated")) or t, tid))
                changed += 1
            else:
                tid = new_id()
                d.execute(
                    "INSERT INTO tasks (id, list_id, group_id, parent_id, number, title, description, done, completed_at, "
                    "priority, start, due, owners, vals, links, subscribers, sort, rev, ext_id, created_by, created_uid, "
                    "created_at, updated_by, updated_at) VALUES (?,?,?,'',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (tid, lid, rec["group_id"], num, rec["title"], rec["description"], int(done), rec["completed_at"],
                     rec["priority"], rec["start"], rec["due"], json.dumps(rec["owners"]), json.dumps(vals),
                     json.dumps(links), json.dumps(rec["subscribers"]), i, rev, ext,
                     creator["name"] if creator else by, creator["uid"] if creator else w.uid,
                     to_iso(cell(r, "created")) or t, by, to_iso(cell(r, "updated")) or t))
                num += 1
                made += 1
            if ext:
                by_ext[ext] = tid
            by_title.setdefault(rec["title"].lower(), tid)
            parents.append((tid, rec["title"], clean_text(cell(r, "parent_ext"), 64), clean_text(cell(r, "parent"), MAX_TITLE)))
        # sub-tasks under their parents, now that every row has an id
        for tid, title, pext, ptitle in parents:
            pid = by_ext.get(pext) if pext else None
            if not pid and pext:
                row = d.execute("SELECT id FROM tasks WHERE list_id = ? AND ext_id = ? AND deleted = 0", (lid, pext)).fetchone()
                pid = row["id"] if row else None
            if not pid and ptitle:
                pid = by_title.get(ptitle.lower())
            if not pid or pid == tid:
                continue
            par = d.execute("SELECT title, group_id FROM tasks WHERE id = ?", (pid,)).fetchone()
            # Lark writes a sub-task as "Its title < Parent title"
            suffix = " < " + par["title"]
            new_title = title[:-len(suffix)] if title.endswith(suffix) and len(title) > len(suffix) else title
            d.execute("UPDATE tasks SET parent_id = ?, group_id = ?, title = ? WHERE id = ?",
                      (pid, par["group_id"], new_title, tid))
        if not groups:
            d.execute("INSERT INTO groups (id, list_id, title, project, sort, rev) VALUES (?, ?, 'General', '', 0, ?)",
                      (new_id(), lid, rev))
        d.execute("UPDATE tasks SET group_id = (SELECT id FROM groups WHERE list_id = ? AND deleted = 0 ORDER BY sort LIMIT 1) "
                  "WHERE list_id = ? AND group_id = '' AND parent_id = ''", (lid, lid))
        d.execute("UPDATE lists SET next_number = ?, rev = ? WHERE id = ?", (num, rev, lid))
        title = d.execute("SELECT title FROM lists WHERE id = ?", (lid,)).fetchone()["title"]
        log(d, lid, "", title, by, "imported", "", "", "%d new, %d updated" % (made, changed))
        return {"created": made, "updated": changed, "groups": new_groups, "unmatched": sorted(people.missing)}

    def rows_from(body):
        import base64
        if body.get("xlsx"):
            try:
                data = base64.b64decode(str(body["xlsx"]).split(",")[-1])
            except Exception:
                raise HTTPException(status_code=400, detail="The Excel file did not arrive whole")
            return read_xlsx(data)
        if body.get("csv"):
            return read_csv(str(body["csv"]))
        raise HTTPException(status_code=400, detail="Nothing to import")

    @app.post("/api/task-lists/{lid}/import")
    async def tasks_import(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """A Lark export (.xlsx) or a CSV into this list: {xlsx: base64} or
        {csv: text}. Rows with a Lark task id that is already here update
        that task, so the same export can be brought in again."""
        w = core.who(request, x_viewer_token)
        body = await read_json(request)
        rows = rows_from(body)
        with db() as d:
            need_list(d, w, lid, "editor")
            return do_import(d, w, lid, rows, person(w, body))

    @app.post("/api/task-lists/import")
    async def tasks_import_new(request: Request, x_viewer_token: str = Header(default="")):
        """A whole Lark task list as a new list here, named after it."""
        w = core.who(request, x_viewer_token)
        if core.accounts_on() and not w.site_admin:
            if not any(core.RANK.get(r, 0) >= core.RANK["member"] for r in core.ACC.memberships(w.uid).values()):
                raise HTTPException(status_code=403, detail="Only project members can start a task list")
        body = await read_json(request)
        rows = rows_from(body)
        cols, _ = map_columns(rows[0] if rows else [])
        title = clean_text(body.get("title"), 120)
        if not title and "list" in cols and len(rows) > 1:
            title = clean_text(rows[1][cols["list"]], 120)
        title = title or "Imported tasks"
        by, t = person(w, body), now_iso()
        lid = new_id()
        with db() as d:
            d.execute("INSERT INTO lists (id, title, team, rev, created_by, created_uid, created_at, updated_by, updated_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (lid, title, clean_text(body.get("team"), 80), next_rev(d), by, w.uid, t, by, t))
            if w.uid is not None:
                d.execute("INSERT INTO list_members (list_id, uid, role) VALUES (?, ?, 'owner')", (lid, w.uid))
            log(d, lid, "", title, by, "list-created")
            out = do_import(d, w, lid, rows, by)
            # everyone named in the file who has an account may open it
            if core.accounts_on():
                seen = set(r["uid"] for r in d.execute("SELECT uid FROM list_members WHERE list_id = ?", (lid,)))
                for r in d.execute("SELECT owners, subscribers FROM tasks WHERE list_id = ?", (lid,)).fetchall():
                    for p in json.loads(r["owners"]) + json.loads(r["subscribers"]):
                        if p.get("uid") is not None and p["uid"] not in seen:
                            seen.add(p["uid"])
                            d.execute("INSERT INTO list_members (list_id, uid, role) VALUES (?, ?, 'editor')", (lid, p["uid"]))
        out["id"] = lid
        out["title"] = title
        return out

    @app.post("/api/task-lists/{lid}/relink")
    async def tasks_relink(request: Request, lid: str, x_viewer_token: str = Header(default="")):
        """Names kept from an import, matched again to accounts (for people
        whose accounts were made after the import)."""
        w = core.who(request, x_viewer_token)
        people = matcher()
        n = 0
        with db() as d:
            need_list(d, w, lid, "editor")
            ptypes = set(r["id"] for r in d.execute(
                "SELECT id FROM fields WHERE list_id = ? AND type = 'person' AND deleted = 0", (lid,)))
            rev = next_rev(d)
            for r in d.execute("SELECT * FROM tasks WHERE list_id = ? AND deleted = 0", (lid,)).fetchall():
                o, s_, v = json.loads(r["owners"]), json.loads(r["subscribers"]), json.loads(r["vals"])
                if not any(p.get("uid") is None for p in o + s_ + [x for k in ptypes for x in (v.get(k) or [])]):
                    continue
                o2, s2 = people(o), people(s_)
                v2 = dict(v)
                for k in ptypes:
                    if v.get(k):
                        v2[k] = people(v[k])
                if (o2, s2, v2) != (o, s_, v):
                    d.execute("UPDATE tasks SET owners = ?, subscribers = ?, vals = ?, rev = ? WHERE id = ?",
                              (json.dumps(o2), json.dumps(s2), json.dumps(v2), rev, r["id"]))
                    n += 1
        return {"changed": n, "unmatched": sorted(people.missing)}

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
