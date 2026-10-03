"""Storage for the viewer's issues and comments.

SQLite rather than a JSON file, for one reason: three offices writing at
once. A file store has no way to stop Manila's save from overwriting Hong
Kong's, and the loss is silent. SQLite gives real transactions, and WAL mode
lets readers carry on while a write is in progress.

Every change bumps a single global revision number. Clients poll with the
last revision they saw and get back only what changed since, which keeps the
sync payload small no matter how many issues accumulate.
"""

import json
import os
import sqlite3
import threading
import datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,
    rev         INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL,
    author      TEXT,
    body        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_rev ON items(rev);

CREATE TABLE IF NOT EXISTS counter (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counter (name, value) VALUES ('rev', 0);
"""


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class Store(object):

    def __init__(self, path):
        self.path = path
        # One connection guarded by a lock. The server is single-process and
        # the writes are tiny, so a pool would add moving parts for nothing.
        self._lock = threading.Lock()
        d = os.path.dirname(os.path.abspath(path))
        if d and not os.path.isdir(d):
            os.makedirs(d)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()
            # Issues from before server numbering get their numbers now.
            self._number_existing()

    def _next_rev(self):
        cur = self._db.execute(
            "UPDATE counter SET value = value + 1 WHERE name = 'rev'")
        if cur.rowcount == 0:
            self._db.execute(
                "INSERT INTO counter (name, value) VALUES ('rev', 1)")
        row = self._db.execute(
            "SELECT value FROM counter WHERE name = 'rev'").fetchone()
        return int(row["value"])

    def current_rev(self):
        with self._lock:
            row = self._db.execute(
                "SELECT value FROM counter WHERE name = 'rev'").fetchone()
            return int(row["value"]) if row else 0

    def changes_since(self, since):
        """Items created, changed or deleted after `since`.

        Deletions are kept as tombstones rather than removed, so a client
        that was offline still learns the item is gone instead of silently
        keeping a stale copy.
        """
        with self._lock:
            rows = self._db.execute(
                "SELECT id, rev, deleted, updated_at, author, body "
                "FROM items WHERE rev > ? ORDER BY rev", (int(since),)
            ).fetchall()
            rev = self.current_rev_locked()

        out = []
        for r in rows:
            if r["deleted"]:
                out.append({"id": r["id"], "deleted": True, "rev": r["rev"]})
            else:
                item = json.loads(r["body"])
                item["id"] = r["id"]
                item["rev"] = r["rev"]
                item["updated_at"] = r["updated_at"]
                if r["author"]:
                    item["author"] = r["author"]
                out.append(item)
        return rev, out

    def current_rev_locked(self):
        row = self._db.execute(
            "SELECT value FROM counter WHERE name = 'rev'").fetchone()
        return int(row["value"]) if row else 0

    def all_items(self):
        return self.changes_since(0)

    def put(self, item, author=None):
        """Insert or replace one item, whole. The viewer always holds the
        complete record, so a full replace avoids merge rules that would
        only ever be wrong in interesting ways."""
        iid = item.get("id")
        if not iid:
            raise ValueError("item has no id")

        body = dict(item)
        body.pop("rev", None)
        body.pop("updated_at", None)

        with self._lock:
            rev = self._next_rev()
            self._db.execute(
                "INSERT INTO items (id, rev, deleted, updated_at, author, body) "
                "VALUES (?, ?, 0, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "  rev = excluded.rev, deleted = 0, "
                "  updated_at = excluded.updated_at, "
                "  author = COALESCE(excluded.author, items.author), "
                "  body = excluded.body",
                (iid, rev, now(), author, json.dumps(body)))
            self._db.commit()
        return rev

    def next_number(self):
        """The next issue number for this project. Numbers are handed out
        by the server and never reused, so "#23" means the same issue in
        the viewer, the dashboard, a report, Revit and a Teams message -
        whoever looks, and even after other issues are deleted."""
        with self._lock:
            self._number_existing()
            self._db.execute("UPDATE counter SET value = value + 1 WHERE name = 'issue'")
            row = self._db.execute("SELECT value FROM counter WHERE name = 'issue'").fetchone()
            self._db.commit()
            return int(row["value"])

    def _number_existing(self):
        """Once per project: issues raised before numbers existed get them,
        oldest first, in place. Called with the lock held."""
        if self._db.execute("SELECT 1 FROM counter WHERE name = 'issue'").fetchone():
            return
        rows = self._db.execute("SELECT id, body FROM items WHERE deleted = 0").fetchall()
        issues = []
        for r in rows:
            b = json.loads(r["body"])
            iss = b.get("issue")
            if isinstance(iss, dict):
                issues.append((iss.get("created_at") or b.get("created_at") or "", r["id"], b))
        issues.sort(key=lambda x: (x[0], x[1]))
        n = 0
        for _, iid, b in issues:
            n += 1
            b["issue"]["number"] = n
            rev = self._next_rev()
            self._db.execute("UPDATE items SET body = ?, rev = ? WHERE id = ?",
                             (json.dumps(b, ensure_ascii=False), rev, iid))
        self._db.execute("INSERT INTO counter (name, value) VALUES ('issue', ?)", (n,))
        self._db.commit()

    def get(self, iid):
        """One live item's stored body (as last written), or None."""
        with self._lock:
            r = self._db.execute(
                "SELECT body, author FROM items WHERE id = ? AND deleted = 0",
                (iid,)).fetchone()
        if not r:
            return None
        item = json.loads(r["body"])
        if r["author"] and not item.get("author"):
            item["author"] = r["author"]
        return item

    def delete(self, iid):
        with self._lock:
            row = self._db.execute(
                "SELECT id FROM items WHERE id = ?", (iid,)).fetchone()
            if not row:
                return None
            rev = self._next_rev()
            self._db.execute(
                "UPDATE items SET deleted = 1, rev = ?, updated_at = ? "
                "WHERE id = ?", (rev, now(), iid))
            self._db.commit()
        return rev

    def count(self):
        with self._lock:
            row = self._db.execute(
                "SELECT COUNT(*) AS n FROM items WHERE deleted = 0").fetchone()
            return int(row["n"])
