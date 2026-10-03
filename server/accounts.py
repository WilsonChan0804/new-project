"""People, and which projects they may open.

Until now the server had one shared passphrase: anyone holding it could
open every project and could type any name as the author of an issue. That
is fine for one person testing, not for Hong Kong, Manila and the UK
working on several jobs, where the questions become "who raised this",
"who is it assigned to" and "should this person see that project at all".

Modelled on ACC and Dalux:
  - a person has ONE account on the server (email + password);
  - a site admin manages accounts;
  - each project has members, each with a role:
        admin    manages the project's members, edits and deletes anything
        member   raises and edits issues and comments, deletes their own
        viewer   reads everything, changes nothing
  - a site admin can open every project.

Passwords are stored as PBKDF2-SHA256 hashes with a per-user salt, never as
text. New accounts get a one-off temporary password that must be changed at
first sign-in, since the server has no mailbox to send invitations from yet
(the service mailbox is in the IT request).

The server switches from passphrase mode to account mode as soon as the
first account exists, so the local PC server keeps working unchanged.
"""

import datetime
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading

ROLES = ("admin", "publisher", "member", "viewer")
ROLE_LABEL = {"admin": "Project admin", "publisher": "Publisher", "member": "Member", "viewer": "Viewer"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL,
    office      TEXT NOT NULL DEFAULT '',
    company     TEXT NOT NULL DEFAULT '',
    is_admin    INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    pw_hash     TEXT NOT NULL,
    pw_salt     TEXT NOT NULL,
    pw_ver      INTEGER NOT NULL DEFAULT 1,
    must_change INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    last_login  TEXT
);
CREATE TABLE IF NOT EXISTS members (
    project     TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    role        TEXT NOT NULL,
    added_at    TEXT NOT NULL,
    added_by    TEXT,
    PRIMARY KEY (project, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS project_settings (
    project     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (project, key)
);
"""

ITERATIONS = 200000


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                               bytes.fromhex(salt), ITERATIONS).hex()


def temp_password():
    """Readable over the phone: no 0/O or 1/l/I."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def public(u):
    """What any signed-in member may see of a person."""
    if u is None:
        return None
    return {"id": u["id"], "email": u["email"], "name": u["name"],
            "office": u["office"], "company": u["company"],
            "team": u.get("team") or "", "discipline": u.get("discipline") or "",
            "is_admin": bool(u["is_admin"]), "active": bool(u["active"]),
            "must_change": bool(u["must_change"]),
            "created_at": u["created_at"], "last_login": u["last_login"]}


class Accounts(object):

    def __init__(self, path):
        self._lock = threading.Lock()
        d = os.path.dirname(os.path.abspath(path))
        if d and not os.path.isdir(d):
            os.makedirs(d)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        with self._lock:
            self._db.executescript(SCHEMA)
            # added later: which team (Design, Project, Production, BIM ...)
            # and which discipline a person belongs to
            cols = {r[1] for r in self._db.execute("PRAGMA table_info(users)").fetchall()}
            for c in ("team", "discipline"):
                if c not in cols:
                    self._db.execute("ALTER TABLE users ADD COLUMN %s TEXT NOT NULL DEFAULT ''" % c)
            self._db.commit()

    # ------------------------------------------------------------ people

    def count(self):
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def get(self, uid):
        with self._lock:
            r = self._db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        return dict(r) if r else None

    def by_email(self, email):
        with self._lock:
            r = self._db.execute("SELECT * FROM users WHERE email = ?",
                                 ((email or "").strip(),)).fetchone()
        return dict(r) if r else None

    def list(self):
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]

    def create(self, email, name, office="", company="", is_admin=False, team="", discipline=""):
        """Returns (user, temporary password)."""
        email = (email or "").strip()
        name = (name or "").strip()
        if "@" not in email or len(email) > 200:
            raise ValueError("A valid email address is needed.")
        if not name:
            raise ValueError("A name is needed.")
        pw = temp_password()
        salt = secrets.token_hex(16)
        with self._lock:
            try:
                cur = self._db.execute(
                    "INSERT INTO users (email, name, office, company, team, discipline, is_admin, pw_hash,"
                    " pw_salt, must_change, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)",
                    (email, name[:100], (office or "")[:40], (company or "")[:80],
                     (team or "")[:60], (discipline or "")[:60],
                     1 if is_admin else 0, _hash(pw, salt), salt, now()))
            except sqlite3.IntegrityError:
                raise ValueError("There is already an account for %s." % email)
            self._db.commit()
            uid = cur.lastrowid
        return self.get(uid), pw

    def update(self, uid, **fields):
        allowed = {"name", "email", "office", "company", "team", "discipline", "is_admin", "active"}
        sets, vals = [], []
        for k, v in fields.items():
            if k in allowed and v is not None:
                if k == "email":
                    v = str(v).strip()
                    if "@" not in v or len(v) > 200:
                        raise ValueError("A valid email address is needed.")
                if k == "name" and not str(v).strip():
                    raise ValueError("A name is needed.")
                sets.append("%s = ?" % k)
                vals.append(int(bool(v)) if k in ("is_admin", "active") else str(v).strip()[:200])
        if not sets:
            return self.get(uid)
        with self._lock:
            try:
                self._db.execute("UPDATE users SET %s WHERE id = ?" % ", ".join(sets),
                                 vals + [uid])
            except sqlite3.IntegrityError:
                raise ValueError("Another account already uses that email.")
            if fields.get("active") is False:
                # Signing out everywhere: every token carries pw_ver.
                self._db.execute("UPDATE users SET pw_ver = pw_ver + 1 WHERE id = ?", (uid,))
            self._db.commit()
        return self.get(uid)

    def delete(self, uid):
        """Remove an account and its project memberships. Issues and
        comments it made keep the name they were stamped with."""
        with self._lock:
            self._db.execute("DELETE FROM members WHERE user_id = ?", (uid,))
            cur = self._db.execute("DELETE FROM users WHERE id = ?", (uid,))
            self._db.commit()
        return cur.rowcount > 0

    def site_admins(self):
        return [u for u in self.list() if u["is_admin"] and u["active"]]

    def verify(self, email, password):
        u = self.by_email(email)
        if not u or not u["active"]:
            # Same work either way, so timing does not reveal which emails exist.
            _hash(password or "", "00" * 16)
            return None
        if not hmac.compare_digest(_hash(password or "", u["pw_salt"]), u["pw_hash"]):
            return None
        with self._lock:
            self._db.execute("UPDATE users SET last_login = ? WHERE id = ?", (now(), u["id"]))
            self._db.commit()
        return self.get(u["id"])

    def set_password(self, uid, password, must_change=False):
        if len(password or "") < 8:
            raise ValueError("Use at least 8 characters.")
        salt = secrets.token_hex(16)
        with self._lock:
            self._db.execute(
                "UPDATE users SET pw_hash = ?, pw_salt = ?, pw_ver = pw_ver + 1,"
                " must_change = ? WHERE id = ?",
                (_hash(password, salt), salt, 1 if must_change else 0, uid))
            self._db.commit()
        return self.get(uid)

    def reset_password(self, uid):
        pw = temp_password()
        salt = secrets.token_hex(16)
        with self._lock:
            self._db.execute(
                "UPDATE users SET pw_hash = ?, pw_salt = ?, pw_ver = pw_ver + 1,"
                " must_change = 1 WHERE id = ?", (_hash(pw, salt), salt, uid))
            self._db.commit()
        return pw

    # ----------------------------------------------------------- projects

    def role(self, uid, project):
        with self._lock:
            r = self._db.execute("SELECT role FROM members WHERE project = ? AND user_id = ?",
                                 (project, uid)).fetchone()
        return r["role"] if r else None

    def memberships(self, uid):
        with self._lock:
            rows = self._db.execute("SELECT project, role FROM members WHERE user_id = ?",
                                    (uid,)).fetchall()
        return {r["project"]: r["role"] for r in rows}

    def members(self, project):
        with self._lock:
            rows = self._db.execute(
                "SELECT u.*, m.role, m.added_at, m.added_by FROM members m"
                " JOIN users u ON u.id = m.user_id WHERE m.project = ?"
                " ORDER BY u.name COLLATE NOCASE", (project,)).fetchall()
        out = []
        for r in rows:
            p = public(dict(r))
            p.update({"role": r["role"], "added_at": r["added_at"], "added_by": r["added_by"]})
            out.append(p)
        return out

    def member_counts(self):
        with self._lock:
            rows = self._db.execute(
                "SELECT project, COUNT(*) AS n FROM members GROUP BY project").fetchall()
        return {r["project"]: r["n"] for r in rows}

    def set_member(self, project, uid, role, by=""):
        if role not in ROLES:
            raise ValueError("Role must be one of %s." % ", ".join(ROLES))
        with self._lock:
            self._db.execute(
                "INSERT INTO members (project, user_id, role, added_at, added_by)"
                " VALUES (?,?,?,?,?) ON CONFLICT(project, user_id)"
                " DO UPDATE SET role = excluded.role", (project, uid, role, now(), by))
            self._db.commit()

    def remove_member(self, project, uid):
        with self._lock:
            cur = self._db.execute("DELETE FROM members WHERE project = ? AND user_id = ?",
                                   (project, uid))
            self._db.commit()
        return cur.rowcount > 0

    def project_rows(self, project):
        """Everything kept about one project (members and settings), as plain
        rows - saved beside a deleted project so a restore brings it back."""
        with self._lock:
            m = [dict(r) for r in self._db.execute(
                "SELECT * FROM members WHERE project = ?", (project,)).fetchall()]
            s = [dict(r) for r in self._db.execute(
                "SELECT * FROM project_settings WHERE project = ?", (project,)).fetchall()]
        return {"members": m, "settings": s}

    def drop_project(self, project):
        """Forget a project's members and settings, so a new project given
        the same name later does not inherit who could see the old one."""
        with self._lock:
            self._db.execute("DELETE FROM members WHERE project = ?", (project,))
            self._db.execute("DELETE FROM project_settings WHERE project = ?", (project,))
            self._db.commit()

    def restore_project(self, project, rows):
        with self._lock:
            for r in rows.get("members") or []:
                if not self._db.execute("SELECT 1 FROM users WHERE id = ?", (r["user_id"],)).fetchone():
                    continue            # the account was deleted meanwhile
                self._db.execute(
                    "INSERT OR REPLACE INTO members (project, user_id, role, added_at, added_by)"
                    " VALUES (?,?,?,?,?)",
                    (project, r["user_id"], r["role"], r["added_at"], r.get("added_by")))
            for r in rows.get("settings") or []:
                self._db.execute(
                    "INSERT OR REPLACE INTO project_settings (project, key, value) VALUES (?,?,?)",
                    (project, r["key"], r["value"]))
            self._db.commit()

    def setting(self, project, key, default=""):
        with self._lock:
            r = self._db.execute("SELECT value FROM project_settings WHERE project = ? AND key = ?",
                                 (project, key)).fetchone()
        return r["value"] if r else default

    def set_setting(self, project, key, value):
        with self._lock:
            if value:
                self._db.execute(
                    "INSERT INTO project_settings (project, key, value) VALUES (?,?,?)"
                    " ON CONFLICT(project, key) DO UPDATE SET value = excluded.value",
                    (project, key, value))
            else:
                self._db.execute("DELETE FROM project_settings WHERE project = ? AND key = ?",
                                 (project, key))
            self._db.commit()

    def admins_of(self, project):
        return [m for m in self.members(project) if m["role"] == "admin" and m["active"]]
