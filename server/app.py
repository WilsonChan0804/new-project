"""LWK Viewer server.

    python app.py --root "C:\\dev\\lwk-viewer\\exports" --pass lwk2026

Every folder under --root that holds a manifest.json is a project. Each
project keeps its own issues, so a markup raised on one job never appears
on another. The older single-project form still works:

    python app.py --export "C:\\dev\\lwk-viewer\\exports\\merged01" --pass lwk2026

Serves three things from one origin, which is what makes the viewer work
unchanged from Hong Kong, Manila or the UK:

    /            the viewer's own HTML, JS and CSS
    /data/...    the export folder - manifest, fragments, sheet PDFs
    /api/...     issues and comments, shared by everyone

Access has two modes:

  passphrase  one shared passphrase (the original, for a single PC and a
              tunnel). Used while no account exists.
  accounts    people sign in with email and password; each project has
              members with a role (admin / member / viewer) and a site admin
              manages accounts - see accounts.py. Switched on by creating the
              first site admin:
                  python app.py --root ... --add-admin you@lwk.com --admin-name "Your Name"
"""

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import threading
import time
import uuid

try:
    from fastapi import FastAPI, HTTPException, Request, Header
    from fastapi.responses import FileResponse, JSONResponse, Response
    from fastapi.staticfiles import StaticFiles
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    sys.exit("Missing dependencies. Run:  pip install -r requirements.txt")

from store import Store
from accounts import Accounts, ROLES, ROLE_LABEL, public as public_user

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER_DIR = os.path.normpath(os.path.join(HERE, "..", "viewer"))

CFG = {
    "root": None,        # folder holding one sub-folder per project
    "single": None,      # set only in the old one-project mode
    "data": None,
    "export": None,
    "passphrase": None,
    "snapshots": None,
    "secret": None,
}
ACC = None               # Accounts, opened in main()
DB = None
STORES = {}              # project id -> Store, opened on first use

app = FastAPI(title="LWK Viewer")

# The viewer is served from the same origin, so CORS is not needed for normal
# use. It is opened up only for local development against a separate dev
# server; the passphrase, not the origin, is what guards the data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------- auth

def make_token(passphrase):
    """A token the server can verify without storing sessions.

    It is derived from the passphrase and a per-installation secret, so
    tokens survive a restart but every token stops working the moment the
    passphrase changes - which is the behaviour you want when someone
    leaves the project.
    """
    return hmac.new(CFG["secret"], passphrase.encode("utf-8"),
                    hashlib.sha256).hexdigest()


COOKIE = "lwk_token"
# publisher: a member who may also publish drawings and models from Revit
RANK = {"viewer": 1, "member": 2, "publisher": 3, "admin": 4}


def accounts_on():
    """Account mode is on once the first account exists."""
    return ACC is not None and CFG.get("accounts_on", False)


def user_token(u, days=30):
    """uid, password version and expiry, signed. Changing a password or
    deactivating an account bumps the version, which signs that person out
    everywhere at once."""
    exp = int(time.time()) + days * 86400
    payload = "u.%d.%d.%d" % (u["id"], u["pw_ver"], exp)
    sig = hmac.new(CFG["secret"], payload.encode("ascii"), hashlib.sha256).hexdigest()[:40]
    return payload + "." + sig


def user_from_token(tok):
    try:
        kind, uid, ver, exp, sig = (tok or "").split(".")
        if kind != "u":
            return None
        payload = "u.%s.%s.%s" % (uid, ver, exp)
        good = hmac.new(CFG["secret"], payload.encode("ascii"), hashlib.sha256).hexdigest()[:40]
        if not hmac.compare_digest(sig, good) or int(exp) < time.time():
            return None
        u = ACC.get(int(uid))
        if not u or not u["active"] or int(ver) != u["pw_ver"]:
            return None
        return u
    except Exception:
        return None


def token_ok(token):
    if accounts_on():
        return user_from_token(token) is not None
    if not CFG["passphrase"]:
        return True
    return bool(token) and hmac.compare_digest(token, make_token(CFG["passphrase"]))


class Who(object):
    """The person behind a request. In passphrase mode there is no person,
    only "someone who knows the passphrase", who may do everything."""

    def __init__(self, user=None):
        self.user = user

    @property
    def uid(self):
        return self.user["id"] if self.user else None

    @property
    def name(self):
        return self.user["name"] if self.user else ""

    @property
    def site_admin(self):
        return (not accounts_on()) or bool(self.user and self.user["is_admin"])


def who(request, header_token=""):
    tok = (header_token or request.headers.get("x-viewer-token", "")
           or request.cookies.get(COOKIE, ""))
    if accounts_on():
        u = user_from_token(tok)
        if not u:
            raise HTTPException(status_code=401, detail="Sign in first")
        return Who(u)
    if not token_ok(tok):
        raise HTTPException(status_code=401, detail="Bad or missing token")
    return Who(None)


def role_in(w, pid):
    if not accounts_on() or w.site_admin:
        return "admin"
    return ACC.role(w.uid, pid)


def require_project(request, pid, need="viewer", header_token=""):
    """Signed in, the project exists, and this person's role is enough."""
    w = who(request, header_token)
    if CFG["single"]:
        pid = "default"
    elif not project_dir(pid):
        raise HTTPException(status_code=404, detail="No such project: %s" % pid)
    r = role_in(w, pid)
    if not r:
        raise HTTPException(status_code=403, detail="You are not a member of this project")
    if RANK[r] < RANK[need]:
        raise HTTPException(status_code=403, detail="Your role on this project (%s) cannot do that"
                            % ROLE_LABEL.get(r, r))
    return w, r


def require_request(request, header_token=""):
    """For files: the drawings, the models and the snapshots.

    These are fetched by pdf.js, by <img> tags and by the browser itself,
    none of which can be made to send a custom header - which is why they
    were served to anyone holding the URL, passphrase or not. A cookie is
    sent automatically on every same-site request, so it closes that gap
    without touching how any of those loaders work."""
    return who(request, header_token)


def require_token(token):
    if accounts_on():
        if not user_from_token(token):
            raise HTTPException(status_code=401, detail="Sign in first")
        return
    if not CFG["passphrase"]:
        return                      # no passphrase configured: open server
    expected = make_token(CFG["passphrase"])
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Bad or missing token")


@app.middleware("http")
async def revalidate_viewer(request: Request, call_next):
    """Make browsers check the viewer's own files on every load.

    The viewer is a dozen JavaScript modules that import each other. A
    browser left to its own caching will happily run a new app.js against
    last week's store.js, and the page then dies on a function that does
    not exist yet. "no-cache" does not mean "do not cache": the browser
    keeps its copy and asks the server if it is still current, getting a
    tiny 304 when it is. The cost is one quick round trip per file; the
    benefit is that every file on the page is always the same version."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.middleware("http")
async def session_cookie(request: Request, call_next):
    response = await call_next(request)
    tok = request.headers.get("x-viewer-token", "")
    if tok and token_ok(tok) and request.cookies.get(COOKIE) != tok:
        response.set_cookie(COOKIE, tok, httponly=True, samesite="lax",
                            path="/", max_age=60 * 60 * 24 * 30)
    return response


# ---------------------------------------------------------------- projects

SAFE_PROJECT = re.compile(r"^[A-Za-z0-9._ -]{1,80}$")


def project_dir(pid):
    """The folder for a project id, or None. The id is a folder name and is
    checked before use: it arrives from the browser, and an id such as
    '../../Windows' must never become a path."""
    if CFG["single"]:
        return CFG["single"] if not pid or pid == "default" else None
    if not pid or not SAFE_PROJECT.match(pid) or pid.startswith("."):
        return None
    d = os.path.normpath(os.path.join(CFG["root"], pid))
    if os.path.dirname(d) != os.path.normpath(CFG["root"]):
        return None
    return d if os.path.isfile(os.path.join(d, "manifest.json")) else None


def store_for(pid):
    """Each project has its own database. One shared table with a project
    column would work too, but a separate file means a project can be
    archived, handed over or deleted by moving one folder, with nothing
    left behind in the others."""
    if CFG["single"]:
        pid = "default"
    if not project_dir(pid):
        raise HTTPException(status_code=404, detail="No such project: %s" % pid)
    if pid not in STORES:
        folder = os.path.join(CFG["data"], "projects", pid)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        STORES[pid] = Store(os.path.join(folder, "viewer.db"))
    return STORES[pid]


def list_projects():
    if CFG["single"]:
        dirs = [("default", CFG["single"])]
    else:
        dirs = []
        for name in sorted(os.listdir(CFG["root"])):
            d = os.path.join(CFG["root"], name)
            if (os.path.isdir(d) and SAFE_PROJECT.match(name)
                    and os.path.isfile(os.path.join(d, "manifest.json"))):
                dirs.append((name, d))

    out = []
    for pid, d in dirs:
        title, sheets, models = pid, 0, 0
        try:
            with open(os.path.join(d, "manifest.json"), encoding="utf-8") as f:
                m = json.load(f)
            title = (m.get("source") or {}).get("title") or pid
            sheets = len(m.get("sheets") or [])
            models = len(m.get("models") or [])
        except Exception:
            # Listed, so it can be found - but saying what is wrong with it.
            title = pid + " (manifest.json empty or damaged - export again)"
        out.append({
            "id": pid, "title": title, "sheets": sheets, "models": models,
            "updated": os.path.getmtime(os.path.join(d, "manifest.json")),
        })
    # Most recently exported first: that is usually the one being opened.
    out.sort(key=lambda p: -p["updated"])
    return out


@app.get("/api/projects")
async def projects(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    ps = list_projects()
    if accounts_on():
        mine = {} if w.site_admin else ACC.memberships(w.uid)
        ps = [dict(p, role="admin" if w.site_admin else mine[p["id"]])
              for p in ps if w.site_admin or p["id"] in mine]
    return {"projects": ps, "single": bool(CFG["single"])}


FAILS = {}                 # ip -> [times of failed sign-ins]


def too_many(ip):
    t = time.time()
    FAILS[ip] = [x for x in FAILS.get(ip, []) if t - x < 900]
    return len(FAILS[ip]) >= 10


@app.post("/api/login")
async def login(request: Request):
    body = await request.json() or {}
    if accounts_on():
        email = (body.get("email") or body.get("name") or "").strip()
        # Counted per person, not per address: a whole office comes from one
        # address, and one colleague's wrong guesses used to lock everyone
        # there out for 15 minutes.
        ip = "%s|%s" % (request.client.host if request.client else "?", email.lower())
        if too_many(ip):
            raise HTTPException(status_code=429,
                                detail="Too many attempts for this account - wait 15 minutes and try again, "
                                       "or ask an admin to reset the password")
        u = ACC.verify(email, body.get("password") or body.get("passphrase") or "")
        if not u:
            FAILS.setdefault(ip, []).append(time.time())
            hint = "" if "@" in email else " - sign in with your email address (accounts are on; the old passphrase no longer works)"
            raise HTTPException(status_code=401, detail="Wrong email or password" + hint)
        FAILS.pop(ip, None)
        # Revit tools (LWK Issues, the nightly upload) ask for a year, so the
        # overnight export does not stop when a 30-day sign-in runs out.
        tok = user_token(u, days=365 if body.get("long") else 30)
        resp = JSONResponse({"token": tok, "name": u["name"], "user": public_user(u),
                             "accounts": True})
        resp.set_cookie(COOKIE, tok, httponly=True, samesite="lax",
                        path="/", max_age=60 * 60 * 24 * 30)
        return resp
    given = body.get("passphrase") or ""
    if CFG["passphrase"] and not hmac.compare_digest(given, CFG["passphrase"]):
        raise HTTPException(status_code=401, detail="Wrong passphrase")
    tok = make_token(CFG["passphrase"] or "")
    resp = JSONResponse({"token": tok, "name": (body or {}).get("name") or ""})
    resp.set_cookie(COOKIE, tok, httponly=True, samesite="lax",
                    path="/", max_age=60 * 60 * 24 * 30)
    return resp


@app.post("/api/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE, path="/")
    return resp


SERVER_VERSION = "2026-10-08"


@app.get("/api/ping")
async def ping():
    """Unauthenticated, so the viewer can tell "server is down" apart from
    "passphrase is wrong" instead of showing one confusing message."""
    return {"ok": True, "version": SERVER_VERSION, "projects": len(list_projects()),
            "single": bool(CFG["single"]),
            "needs_passphrase": bool(CFG["passphrase"]) or accounts_on(),
            "accounts": accounts_on()}


# --------------------------------------------------------------- items

@app.get("/api/items")
async def get_items(request: Request, since: int = 0,
                    x_viewer_token: str = Header(default=""),
                    x_project: str = Header(default="")):
    w, role = require_project(request, x_project, "viewer", x_viewer_token)
    rev, items = store_for(x_project).changes_since(since)
    if accounts_on() and role != "admin" and any(
            (v.get("see") == "list") for v in layer_settings(x_project).values()):
        # markups on a layer this person may not see are not sent at all
        items = [it for it in items if it.get("deleted")
                 or layer_can(x_project, w, role, _layer_of(it), "see")]
    return {"rev": rev, "items": items}


TRACKED = ("status", "assigned_to", "due_date", "priority", "type", "title")
CLOSED = ("Resolved", "Closed")


def stamp(prev, item, w, store=None):
    """What only the server can say truthfully: who made the item, who
    changed it last, and what changed. The viewer sends the whole record;
    fields it cannot be trusted with are taken from the stored copy.

    The issue history is what the dashboard's trends, "closed this week" and
    "last updated" are built from. It is appended here, never taken from
    the browser, so it cannot be edited away."""
    t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    by = w.name or item.get("author") or (prev or {}).get("author") or ""
    if prev is None:
        if w.user:
            item["author"] = w.name
            item["author_id"] = w.uid
    else:
        for k in ("author", "author_id", "created_at"):
            if k in prev:
                item[k] = prev[k]
    item["updated_by"] = by
    if w.user:
        item["updated_by_id"] = w.uid

    iss = item.get("issue")
    piss = (prev or {}).get("issue") or None
    if isinstance(iss, dict):
        hist = list((piss or {}).get("history") or [])
        if not piss:
            if w.user:
                iss["author"] = w.name
                iss["author_id"] = w.uid
            iss.setdefault("created_at", t)
            # A new issue - including a pasted or matched copy - always gets
            # a new number from the server.
            if store is not None:
                iss["number"] = store.next_number()
            hist.append({"at": t, "by": by, "event": "created",
                         "to": iss.get("status") or "Open"})
        else:
            for k in ("author", "author_id", "created_at", "number"):
                if k in piss:
                    iss[k] = piss[k]
            iss["comments"] = merge_comments(piss.get("comments"), iss.get("comments"), w)
            if "number" not in iss and store is not None:
                iss["number"] = store.next_number()
            for f in TRACKED:
                if (iss.get(f) or "") != (piss.get(f) or ""):
                    hist.append({"at": t, "by": by, "field": f,
                                 "from": piss.get(f) or "", "to": iss.get(f) or ""})
            if len(iss.get("comments") or []) > len(piss.get("comments") or []):
                hist.append({"at": t, "by": by, "event": "comment"})
            # OneDrive / SharePoint / ACC links on the issue (filelinks.js)
            fa = set(f.get("url") for f in (iss.get("files") or []) if isinstance(f, dict))
            fb = set(f.get("url") for f in (piss.get("files") or []) if isinstance(f, dict))
            if fa - fb:
                hist.append({"at": t, "by": by, "event": "file", "to": "%d added" % len(fa - fb)})
            if fb - fa:
                hist.append({"at": t, "by": by, "event": "file", "from": "%d removed" % len(fb - fa)})
        st = iss.get("status") or "Open"
        was_closed = (piss or {}).get("status") in CLOSED
        if st in CLOSED:
            iss["closed_at"] = ((piss or {}).get("closed_at") if was_closed else None) or t
        else:
            iss.pop("closed_at", None)
        iss["updated_at"] = t
        iss["updated_by"] = by
        iss["history"] = hist[-200:]
    return item


def _comment_key(c):
    if not isinstance(c, dict):
        return None
    return c.get("id") or "%s|%s|%s" % (c.get("author") or "", c.get("at") or "", (c.get("text") or "")[:80])


def merge_comments(old, new, w):
    """The discussion on an issue is a conversation: two people answering
    at once must both be kept. What the browser sends is merged with what
    is stored - nothing stored is lost; a comment only ever changes by its
    own flags (resolved, deleted, edited text by its author)."""
    old = [c for c in (old or []) if isinstance(c, dict)]
    new = [c for c in (new or []) if isinstance(c, dict)]
    by_key = {}
    out = []
    for c in old:
        k = _comment_key(c)
        by_key[k] = c
        out.append(c)
    for c in new:
        k = _comment_key(c)
        if k in by_key:
            o = by_key[k]
            for f in ("resolved", "resolved_by", "resolved_at", "deleted", "edited_at"):
                if f in c:
                    o[f] = c[f]
            if c.get("text") != o.get("text") and c.get("edited_at") and \
                    (not w.user or o.get("author") == w.name):
                o["text"] = c.get("text")
            continue
        if w.user:
            c["author"] = w.name          # who wrote it is the server's to say
        by_key[k] = c
        out.append(c)
    out.sort(key=lambda c: c.get("at") or "")
    return out


@app.post("/api/items")
async def put_item(request: Request, x_viewer_token: str = Header(default=""),
                   x_project: str = Header(default="")):
    w, role = require_project(request, x_project, "member", x_viewer_token)
    item = await request.json()
    if not isinstance(item, dict) or not item.get("id"):
        raise HTTPException(status_code=400, detail="Item needs an id")
    st = store_for(x_project)
    prev = st.get(item["id"])
    check_layer_edit(x_project, w, role, prev, item)
    CFG["base_url"] = str(request.base_url)
    rev, item = save_item(x_project, prev, item, w, str(request.base_url))
    out = {"rev": rev, "id": item["id"], "item": item}
    # resolved or closed: the tasks still open on it are named, so the page
    # can offer to complete them too (tasks.py)
    iss, piss = item.get("issue"), (prev or {}).get("issue") or {}
    if isinstance(iss, dict) and iss.get("status") in CLOSED and piss.get("status") not in CLOSED:
        try:
            import tasks
            out["open_tasks"] = tasks.issue_resolved(sys.modules[__name__], x_project, item["id"], iss, w.name)
        except Exception as ex:
            print("issue -> tasks: %s" % ex)
    return out


def save_item(pid, prev, item, w, base_url=""):
    """Every change to an item, from the page or from the server itself (a
    task closing its issues): history, then the Teams, email and chat
    messages that go with it."""
    st = store_for(pid)
    item = stamp(prev, item, w, st)
    rev = st.put(item, author=item.get("author"))
    notify_teams(pid, prev, item, base_url or CFG.get("base_url") or "")
    notify_people(pid, prev, item, base_url or CFG.get("base_url") or "", w)
    chat_issue_card(pid, prev, item, w)
    return rev, item


def set_issue_status(pid, iid, status, w, note=""):
    """Change one issue's status from the server (tasks.py, a task marked
    done resolving its issues), as if it was changed in the viewer.
    Returns (ok, reason)."""
    if not project_dir(pid):
        return False, "no such project"
    r = role_in(w, pid)
    if not r or RANK.get(r, 0) < RANK["member"]:
        return False, "you are not a member of " + pid
    st = store_for(pid)
    prev = st.get(iid)
    if not prev or prev.get("deleted") or not isinstance(prev.get("issue"), dict):
        return False, "no such issue"
    item = json.loads(json.dumps(prev))
    item["issue"]["status"] = status
    if note:
        cs = list(item["issue"].get("comments") or [])
        cs.append({"id": "c" + uuid.uuid4().hex[:12], "author": w.name or "", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "text": note[:2000]})
        item["issue"]["comments"] = cs
    save_item(pid, prev, item, w)
    return True, ""


def chat_issue_card(pid, prev, item, w):
    """A new issue, or one whose status changed, as a card in the job's
    Messenger channel (chat.py), when the job is on the Projects page."""
    iss = item.get("issue")
    if not isinstance(iss, dict) or not accounts_on():
        return
    piss = (prev or {}).get("issue") or {}
    if piss and (piss.get("status") or "Open") == (iss.get("status") or "Open"):
        return
    try:
        import chat
        import tasks
        regs = tasks.reg_ids_for_viewer(sys.modules[__name__], "default" if CFG["single"] else pid)
        if regs:
            chat.post_card(regs, {
                "type": "issue", "event": "status" if piss else "raised", "project": pid, "id": item["id"],
                "number": iss.get("number"), "title": iss.get("title") or "Issue", "status": iss.get("status") or "Open",
                "sheet": item.get("sheet") or "", "assigned_to": iss.get("assigned_to") or "",
                "due": iss.get("due_date") or ""}, w.name or item.get("author") or "")
    except Exception as ex:
        print("issue card: %s" % ex)


# ------------------------------------------------------------- Teams

def teams_events(prev, item):
    """What is worth telling the channel about this change, if anything."""
    iss = item.get("issue")
    if not isinstance(iss, dict) or iss.get("dismissed"):
        return []
    piss = (prev or {}).get("issue") or None
    if not piss:
        return ["raised" + (" and assigned to " + iss["assigned_to"] if iss.get("assigned_to") else "")]
    ev = []
    if (iss.get("assigned_to") or "") != (piss.get("assigned_to") or "") and iss.get("assigned_to"):
        ev.append("assigned to " + iss["assigned_to"])
    if (iss.get("status") or "") != (piss.get("status") or ""):
        ev.append("now " + (iss.get("status") or "Open"))
    if (iss.get("due_date") or "") != (piss.get("due_date") or "") and iss.get("due_date"):
        ev.append("due " + iss["due_date"])
    if len(iss.get("comments") or []) > len(piss.get("comments") or []):
        c = (iss.get("comments") or [])[-1] or {}
        ev.append("new comment: \"%s\"" % str(c.get("text") or "")[:140])
    return ev


def new_mentions(pid, prev, item):
    """(name, email) of the members @named in the comments this change added."""
    iss = item.get("issue") or {}
    piss = (prev or {}).get("issue") or {}
    added = (iss.get("comments") or [])[len(piss.get("comments") or []):]
    if not added:
        return []
    try:
        ms = [m for m in ACC.members(pid) if m.get("active") and m.get("name")]
    except Exception:
        return []
    out, seen = [], set()
    for c in added:
        text = str((c or {}).get("text") or "").lower()
        named = set(n.lower() for n in ((c or {}).get("mentions") or []))
        for m in ms:
            n = m["name"]
            if (n.lower() in named or ("@" + n.lower()) in text) and n not in seen:
                seen.add(n)
                out.append((n, m.get("email") or ""))
    return out


def teams_card(pid, item, events, base, mentioned=()):
    iss = item["issue"]
    title = "#%s %s" % (iss.get("number", "?"), iss.get("title") or "Issue")
    where = ("sheet " + item["sheet"]) if item.get("sheet") else "3D model"
    link = "%sindex.html?project=%s&sheet=%s&select=%s" % (base, pid, item.get("sheet") or "", item["id"]) \
        if item.get("sheet") else "%smodel.html?project=%s&select=%s" % (base, pid, item["id"])
    facts = [{"title": k, "value": v} for k, v in (
        ("Project", pid), ("Status", iss.get("status") or "Open"),
        ("Assigned to", iss.get("assigned_to") or "-"), ("Due", iss.get("due_date") or "-"),
        ("Priority", iss.get("priority") or "Normal"), ("Where", where),
        ("By", item.get("updated_by") or iss.get("author") or ""))]
    body = [
        {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
        {"type": "TextBlock", "text": "; ".join(events), "wrap": True, "color": "Accent"},
    ]
    content = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard", "version": "1.4", "body": body,
        "actions": [{"type": "Action.OpenUrl", "title": "Open in LWK Viewer", "url": link}],
    }
    # A real Teams @mention (by the person's work email): it notifies them,
    # which a name written in the text does not.
    ents = [(n, e) for n, e in mentioned if e]
    if mentioned:
        body.append({"type": "TextBlock", "wrap": True, "text": "For " + ", ".join(
            ("<at>%s</at>" % n) if e else ("@" + n) for n, e in mentioned)})
    if ents:
        content["msteams"] = {"entities": [
            {"type": "mention", "text": "<at>%s</at>" % n, "mentioned": {"id": e, "name": n}}
            for n, e in ents]}
    body.append({"type": "FactSet", "facts": facts})
    return {"type": "message", "attachments": [{
        "contentType": "application/vnd.microsoft.card.adaptive", "content": content}]}


def post_json(url, payload):
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status


# ------------------------------------------------ personal notifications
#
# Who a change is for, beyond the channel: the person it is now assigned
# to, the one whose query was just answered, the one who raised an issue
# that is now resolved or closed. They are @mentioned in the Teams card
# (Teams itself then notifies them) and - when the server has an email
# account set (LWK_SMTP_* in /etc/lwk-viewer.env) - sent an email.

def _member_by_name(pid, name):
    if not name:
        return None
    try:
        for m in ACC.members(pid):
            if m.get("active") and (m.get("name") or "").strip().lower() == name.strip().lower():
                return m
    except Exception:
        pass
    return None


def personal_targets(pid, prev, item, actor=""):
    """[(name, email, why)] - never the person who made the change."""
    iss = item.get("issue")
    if not isinstance(iss, dict):
        return []
    piss = (prev or {}).get("issue") or {}
    out = []

    def add(name, why):
        m = _member_by_name(pid, name)
        if not m or (actor and m.get("name", "").lower() == actor.lower()):
            return
        if any(o[0] == m["name"] for o in out):
            return
        out.append((m["name"], m.get("email") or "", why))

    if iss.get("assigned_to") and (iss.get("assigned_to") or "") != (piss.get("assigned_to") or ""):
        add(iss["assigned_to"], "assigned to you")
    old_keys = set(_comment_key(c) for c in (piss.get("comments") or []))
    comments = [c for c in (iss.get("comments") or []) if isinstance(c, dict)]
    by_id = dict((c.get("id"), c) for c in comments if c.get("id"))
    for c in comments:
        if _comment_key(c) in old_keys:
            continue
        q = by_id.get(c.get("reply_to"))
        if q is not None and q.get("kind") == "query":
            add(q.get("author") or "", "your query was answered by %s" % (c.get("author") or "someone"))
        elif q is not None:
            add(q.get("author") or "", "%s replied to you" % (c.get("author") or "someone"))
    st, pst = iss.get("status") or "Open", piss.get("status") or "Open"
    if piss and st != pst and st in ("Resolved", "Closed"):
        add(iss.get("author") or "", "the issue you raised is now %s" % st)
    return out


def smtp_ready():
    return bool(os.environ.get("LWK_SMTP_HOST") and os.environ.get("LWK_SMTP_FROM"))


def send_mail(to, subject, text):
    """Plain email through the account in LWK_SMTP_* (Office 365: host
    smtp.office365.com, port 587, STARTTLS, a mailbox's user and password)."""
    import smtplib
    from email.mime.text import MIMEText
    msg = MIMEText(text, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = os.environ["LWK_SMTP_FROM"]
    msg["To"] = to
    port = int(os.environ.get("LWK_SMTP_PORT") or 587)
    host = os.environ["LWK_SMTP_HOST"]
    if port == 465:
        srv = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        srv = smtplib.SMTP(host, port, timeout=20)
        if (os.environ.get("LWK_SMTP_TLS") or "1") != "0":
            srv.starttls()
    try:
        if os.environ.get("LWK_SMTP_USER"):
            srv.login(os.environ["LWK_SMTP_USER"], os.environ.get("LWK_SMTP_PASS") or "")
        srv.sendmail(os.environ["LWK_SMTP_FROM"], [to], msg.as_string())
    finally:
        try:
            srv.quit()
        except Exception:
            pass


def issue_link(pid, item, base):
    if item.get("sheet"):
        return "%sindex.html?project=%s&sheet=%s&select=%s" % (base, pid, item.get("sheet") or "", item["id"])
    return "%smodel.html?project=%s&select=%s" % (base, pid, item["id"])


def notify_people(pid, prev, item, base, w):
    if not accounts_on():
        return
    try:
        targets = personal_targets(pid, prev, item, getattr(w, "name", "") or "")
    except Exception as ex:
        print("notify: %s" % ex)
        return
    if not targets:
        return
    iss = item["issue"]
    import threading

    def send():
        # (Teams: the channel card itself @mentions them - notify_teams)
        if smtp_ready():
            for name, email, why in targets:
                if not email or ACC.setting("_user:%s" % email.lower(), "email_off") == "1":
                    continue
                try:
                    send_mail(email, "[LWK Viewer] #%s %s - %s" % (iss.get("number", "?"), iss.get("title") or "Issue", why),
                              "Hello %s,\n\n%s on %s:\n\n  #%s %s\n  Status: %s   Due: %s\n\nOpen it: %s\n\n"
                              "(LWK Viewer - you get this because it concerns you.)\n"
                              % (name, why[0].upper() + why[1:], pid, iss.get("number", "?"), iss.get("title") or "",
                                 iss.get("status") or "Open", iss.get("due_date") or "-", issue_link(pid, item, base)))
                except Exception as ex:
                    print("mail to %s: %s" % (email, ex))
    threading.Thread(target=send, daemon=True).start()


def due_reminders(pid, base):
    """Open issues due tomorrow (or overdue since yesterday): the people they
    are assigned to, once a day."""
    st = store_for(pid)
    items = st.changes_since(0)[1]
    tomorrow = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400))
    today = time.strftime("%Y-%m-%d", time.gmtime())
    due = []
    for it in items:
        iss = it.get("issue") if isinstance(it, dict) else None
        if not isinstance(iss, dict) or it.get("deleted") or iss.get("dismissed"):
            continue
        if (iss.get("status") or "Open") in ("Resolved", "Closed"):
            continue
        d = (iss.get("due_date") or "")[:10]
        if d in (tomorrow, today) and iss.get("assigned_to"):
            due.append(it)
    by_person = {}
    for it in due:
        m = _member_by_name(pid, it["issue"]["assigned_to"])
        if m:
            by_person.setdefault(m["name"], (m, []))[1].append(it)
    url = ACC.setting(pid, "teams_webhook")
    for name, (m, its) in by_person.items():
        if url:
            for it in its[:10]:
                try:
                    post_json(url, teams_card(pid, it, ["due %s" % it["issue"]["due_date"]], base,
                                              [(name, m.get("email") or "")]))
                except Exception as ex:
                    print("due teams: %s" % ex)
        if smtp_ready() and m.get("email") and ACC.setting("_user:%s" % m["email"].lower(), "email_off") != "1":
            lines = "\n".join("  #%s %s - due %s\n    %s" % (it["issue"].get("number", "?"), it["issue"].get("title") or "",
                                                           it["issue"].get("due_date"), issue_link(pid, it, base)) for it in its)
            try:
                send_mail(m["email"], "[LWK Viewer] %d issue(s) due soon on %s" % (len(its), pid),
                          "Hello %s,\n\nThese issues assigned to you are due today or tomorrow:\n\n%s\n" % (name, lines))
            except Exception as ex:
                print("due mail: %s" % ex)


def notify_teams(pid, prev, item, base):
    """Post to the project's Teams channel (a Teams Workflows webhook set on
    the Admin page). In the background: a slow or broken webhook never
    holds up saving the issue."""
    if not accounts_on():
        return
    url = ACC.setting(pid, "teams_webhook")
    if not url:
        return
    events = teams_events(prev, item)
    mentioned = new_mentions(pid, prev, item)
    # the people this change is for, @mentioned in the same card
    try:
        for n, e, why in personal_targets(pid, prev, item, item.get("updated_by") or ""):
            if not any(m[0] == n for m in mentioned):
                mentioned.append((n, e))
            txt = ("assigned to " + n) if why.startswith("assigned") else why
            if txt not in events and not (why.startswith("assigned") and any(x.startswith("raised and assigned") for x in events)):
                events.append(txt)
    except Exception as ex:
        print("teams targets: %s" % ex)
    if not events:
        return
    import threading

    def send():
        try:
            post_json(url, teams_card(pid, item, events, base, mentioned))
        except Exception as ex:
            print("teams: %s" % ex)
    threading.Thread(target=send, daemon=True).start()


@app.delete("/api/items/{item_id}")
async def delete_item(request: Request, item_id: str,
                      x_viewer_token: str = Header(default=""),
                      x_project: str = Header(default="")):
    w, role = require_project(request, x_project, "member", x_viewer_token)
    st = store_for(x_project)
    if accounts_on() and role != "admin":
        prev = st.get(item_id)
        if prev and prev.get("author_id") not in (None, w.uid):
            raise HTTPException(status_code=403,
                                detail="Only its author or a project admin can delete this")
    check_layer_edit(x_project, w, role, st.get(item_id), None)
    rev = st.delete(item_id)
    if rev is None:
        raise HTTPException(status_code=404, detail="No such item")
    return {"rev": rev, "id": item_id}


# ----------------------------------------------------------- people

def need_accounts():
    if not accounts_on():
        raise HTTPException(status_code=409, detail=(
            "This server uses a shared passphrase. Create the first site admin "
            "(--add-admin) to switch on accounts."))


@app.get("/api/me")
async def me(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    if not accounts_on():
        return {"accounts": False, "user": None, "site_admin": True, "projects": {}}
    return {"accounts": True, "user": public_user(w.user), "site_admin": w.site_admin,
            "projects": ACC.memberships(w.uid)}


@app.get("/api/me/notify")
async def my_notify(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    if not w.user:
        raise HTTPException(status_code=401, detail="Sign in first")
    email = (w.user.get("email") or "").lower()
    return {"email_ready": smtp_ready(), "email": email,
            "email_off": ACC.setting("_user:%s" % email, "email_off") == "1"}


@app.post("/api/me/notify")
async def set_my_notify(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    if not w.user:
        raise HTTPException(status_code=401, detail="Sign in first")
    body = await request.json() or {}
    email = (w.user.get("email") or "").lower()
    ACC.set_setting("_user:%s" % email, "email_off", "1" if body.get("email_off") else "")
    return {"email_off": bool(body.get("email_off"))}


@app.post("/api/admin/email-test")
async def email_test(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Site admins only")
    if not smtp_ready():
        raise HTTPException(status_code=400, detail="No email account set on the server (LWK_SMTP_HOST, LWK_SMTP_FROM ... in /etc/lwk-viewer.env)")
    to = (w.user or {}).get("email") or ""
    try:
        send_mail(to, "[LWK Viewer] test", "This is a test from LWK Viewer. Email notifications work.")
    except Exception as ex:
        raise HTTPException(status_code=502, detail="The mail server said: %s" % ex)
    return {"sent_to": to}


@app.post("/api/me/password")
async def change_password(request: Request, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    if not ACC.verify(w.user["email"], body.get("old") or ""):
        raise HTTPException(status_code=400, detail="The current password is not right")
    try:
        u = ACC.set_password(w.uid, body.get("new") or "")
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    tok = user_token(u)
    resp = JSONResponse({"token": tok, "user": public_user(u)})
    resp.set_cookie(COOKIE, tok, httponly=True, samesite="lax", path="/",
                    max_age=60 * 60 * 24 * 30)
    return resp


@app.get("/api/members")
async def project_members(request: Request, x_viewer_token: str = Header(default=""),
                          x_project: str = Header(default="")):
    """The people on a project - for the assignee list and the dashboard."""
    w, role = require_project(request, x_project, "viewer", x_viewer_token)
    if not accounts_on():
        return {"accounts": False, "role": role, "members": []}
    ms = [{k: m.get(k, "") for k in ("id", "name", "email", "office", "company", "team", "discipline", "role", "active")}
          for m in ACC.members(x_project)]
    return {"accounts": True, "role": role, "me": w.uid, "members": ms}


# ------------------------------------------------------------- admin

def admin_projects(w):
    """Projects this person can manage."""
    ps = list_projects()
    if w.site_admin:
        return ps
    mine = ACC.memberships(w.uid)
    return [p for p in ps if mine.get(p["id"]) == "admin"]


@app.get("/api/admin/users")
async def admin_users(request: Request, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin and not admin_projects(w):
        raise HTTPException(status_code=403, detail="Only admins can see the people list")
    users = ACC.list()
    counts = {}
    for u in users:
        counts[u["id"]] = len(ACC.memberships(u["id"]))
    return {"users": [dict(public_user(u), projects=counts[u["id"]]) for u in users],
            "site_admin": w.site_admin}


@app.post("/api/admin/users")
async def admin_add_user(request: Request, x_viewer_token: str = Header(default="")):
    """A site admin adds anyone; a project admin may add a new person to a
    project they manage (never as a site admin)."""
    need_accounts()
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    project = body.get("project") or ""
    role = body.get("role") or "member"
    if not w.site_admin:
        if not project or ACC.role(w.uid, project) != "admin":
            raise HTTPException(status_code=403,
                                detail="Only a site admin, or the project's admin, can add people")
        body["is_admin"] = False
    if project and not project_dir(project):
        raise HTTPException(status_code=404, detail="No such project: %s" % project)
    try:
        u, pw = ACC.create(body.get("email"), body.get("name"), body.get("office"),
                           body.get("company"), bool(body.get("is_admin")),
                           team=body.get("team") or "", discipline=body.get("discipline") or "")
        if project:
            ACC.set_member(project, u["id"], role, by=w.name)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"user": public_user(u), "temp_password": pw}


@app.patch("/api/admin/users/{uid}")
async def admin_edit_user(request: Request, uid: int, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    if not w.site_admin:
        # a project admin may set the team and discipline of the people on
        # the projects they manage - nothing else about an account
        mine = {p for p, r in ACC.memberships(w.uid).items() if r == "admin"}
        theirs = set(ACC.memberships(uid).keys())
        if not (mine & theirs) or set(k for k in body if body.get(k) is not None) - {"team", "discipline"}:
            raise HTTPException(status_code=403, detail="Only a site admin can change accounts")
        u = ACC.update(uid, team=body.get("team"), discipline=body.get("discipline"))
        return {"user": public_user(u)}
    if uid == w.uid and (body.get("active") is False or body.get("is_admin") is False):
        raise HTTPException(status_code=400,
                            detail="You cannot deactivate yourself or remove your own admin rights")
    if not ACC.get(uid):
        raise HTTPException(status_code=404, detail="No such account")
    try:
        u = ACC.update(uid, name=body.get("name"), email=body.get("email"),
                       office=body.get("office"), company=body.get("company"),
                       team=body.get("team"), discipline=body.get("discipline"),
                       is_admin=body.get("is_admin"), active=body.get("active"))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"user": public_user(u)}


@app.delete("/api/admin/users/{uid}")
async def admin_delete_user(request: Request, uid: int, x_viewer_token: str = Header(default="")):
    """For an account made by mistake. Someone who has left is better
    deactivated: the account, and who they were, stay on record."""
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can delete accounts")
    u = ACC.get(uid)
    if not u:
        raise HTTPException(status_code=404, detail="No such account")
    if uid == w.uid:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if u["is_admin"] and [a["id"] for a in ACC.site_admins()] == [uid]:
        raise HTTPException(status_code=400, detail="The last site admin cannot be deleted")
    ACC.delete(uid)
    return {"deleted": uid}


@app.post("/api/admin/users/{uid}/reset")
async def admin_reset(request: Request, uid: int, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can reset passwords")
    u = ACC.get(uid)
    if not u:
        raise HTTPException(status_code=404, detail="No such account")
    # a reset also lifts the "too many attempts" wait for that account
    tail = "|" + (u.get("email") or "").lower()
    for k in [k for k in FAILS if k.endswith(tail)]:
        FAILS.pop(k, None)
    return {"temp_password": ACC.reset_password(uid)}


EXPORTS_FILE = "_exports.json"


def record_export_job(root, job):
    """One entry per Revit file that publishes into this project."""
    path = os.path.join(root, EXPORTS_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            cur = json.load(f) or {}
    except Exception:
        cur = {}
    key = str(job.get("source") or job.get("title") or "?")[:200]
    job["received_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # the log is kept short: its tail says how the run went
    if isinstance(job.get("log"), list):
        job["log"] = [str(x)[:300] for x in job["log"][-60:]]
    cur[key] = job
    tmpf = path + ".tmp"
    with open(tmpf, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)
    os.replace(tmpf, path)


@app.get("/api/projects/{pid}/exports")
async def project_exports(pid: str, request: Request, x_viewer_token: str = Header(default="")):
    """How each Revit file feeding this project is exported - for anyone on
    the project to review (what is included, when it runs, how it went)."""
    require_project(request, pid, "viewer", x_viewer_token)
    root = project_root_for("default" if CFG["single"] else pid)
    try:
        with open(os.path.join(root, EXPORTS_FILE), encoding="utf-8") as f:
            return {"exports": json.load(f) or {}}
    except Exception:
        return {"exports": {}}


# ------------------------------------------------- auto-publish registry
#
# Who has set which Revit file to be published, from which PC, and whether
# it runs at night. The settings themselves live on each PC (Revit runs
# there); every PC reports them here - when they are saved and after every
# run - so one list shows them all and two people cannot set the same
# model to publish at night without being told.

PUBLISH_JOBS = "publish_jobs.json"
_pj_lock = threading.Lock()
_PJ_KEEP = ("source", "acc_model", "acc_project", "pc", "user", "revit", "nightly", "night_time", "night_days",
            "schedule", "sheets", "model_3d", "adds_to_project", "folder", "extension")


def _pj_path():
    return os.path.join(CFG["data"], PUBLISH_JOBS)


def _pj_load():
    try:
        with open(_pj_path(), encoding="utf-8") as f:
            return (json.load(f) or {}).get("jobs") or {}
    except Exception:
        return {}


def _pj_save(jobs):
    tmpf = _pj_path() + ".tmp"
    with open(tmpf, "w", encoding="utf-8") as f:
        json.dump({"jobs": jobs}, f, ensure_ascii=False, indent=1)
    os.replace(tmpf, _pj_path())


def _pj_key(project, job):
    return "|".join(str(x or "").strip().lower() for x in (
        project, job.get("acc_model") or job.get("source") or job.get("title"), job.get("pc"), job.get("user")))[:400]


def _pj_group(e):
    """What makes two entries "the same model": its ACC id, else the same
    file name going to the same viewer project."""
    return (e.get("acc_model") or "").lower() or ("%s|%s" % (e.get("project"), e.get("source"))).lower()


def pj_upsert(project, job, account="", ran=False):
    now_ = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with _pj_lock:
        jobs = _pj_load()
        key = _pj_key(project, job)
        e = jobs.get(key) or {}
        e["project"] = project
        for k in _PJ_KEEP:
            if k in job:
                e[k] = job[k] if isinstance(job[k], (bool, int, float)) else str(job[k])[:400]
        if not e.get("source"):
            e["source"] = str(job.get("title") or "")[:200]
        if ran:
            e["last_run_at"] = now_
            e["last_ok"] = bool(job.get("ok", True)) and not job.get("errors")
            e["last_how"] = str(job.get("how") or "")[:40]
            e["last_by"] = account
        else:
            e["saved_at"] = now_
            e["saved_by"] = account
        e.setdefault("saved_at", now_)
        e.setdefault("saved_by", account)
        jobs[key] = e
        _pj_save(jobs)
        return key, e, jobs


def pj_others(jobs, key):
    """Other PCs / people with the night export ON for the same model."""
    me = jobs.get(key) or {}
    g = _pj_group(me)
    return [dict(e, key=k) for k, e in jobs.items()
            if k != key and e.get("nightly") and _pj_group(e) == g
            and (e.get("pc"), e.get("user")) != (me.get("pc"), me.get("user"))]


def _pj_visible(w):
    if not accounts_on() or w.site_admin:
        return None                      # everything
    return set(ACC.memberships(w.uid).keys())


@app.get("/api/publish-jobs")
async def publish_jobs_list(request: Request, project: str = "", x_viewer_token: str = Header(default="")):
    """Every auto-publish setting reported by the PCs, for the projects this
    person is on (a site admin: all). `duplicate` marks a model whose night
    export is on in more than one place."""
    w = who(request, x_viewer_token)
    jobs = _pj_load()
    vis = _pj_visible(w)
    night = {}
    for k, e in jobs.items():
        if e.get("nightly"):
            night.setdefault(_pj_group(e), set()).add((e.get("pc"), e.get("user")))
    out = []
    for k, e in sorted(jobs.items(), key=lambda kv: (kv[1].get("project") or "", kv[1].get("source") or "")):
        if vis is not None and e.get("project") not in vis:
            continue
        if project and e.get("project") != project:
            continue
        out.append(dict(e, key=k, duplicate=bool(e.get("nightly") and len(night.get(_pj_group(e), ())) > 1)))
    return {"jobs": out}


@app.post("/api/publish-jobs")
async def publish_jobs_save(request: Request, x_viewer_token: str = Header(default="")):
    """A PC reports one model's publish settings (saved, not run). Answers
    with anyone else who already publishes the same model at night."""
    body = await request.json() or {}
    pid = str(body.get("project") or "")
    job = body.get("job") or {}
    if not SAFE_PROJECT.match(pid) or not isinstance(job, dict):
        raise HTTPException(status_code=400, detail="project and job are needed")
    if project_dir(pid):
        w, _ = require_project(request, pid, "publisher", x_viewer_token)
    else:
        w = who(request, x_viewer_token)
        if accounts_on() and not w.site_admin:
            raise HTTPException(status_code=403, detail="'%s' is not on the server yet - a site admin publishes a new "
                                                        "project the first time" % pid)
    key, e, jobs = pj_upsert(pid, job, getattr(w, "name", "") or "")
    return {"ok": True, "key": key, "others": pj_others(jobs, key)}


@app.delete("/api/publish-jobs")
async def publish_jobs_delete(request: Request, key: str = "", x_viewer_token: str = Header(default="")):
    """Take one entry off the list (the PC removed the job, or it is stale).
    This does not stop a PC that still has the job: it reports again when
    it next runs."""
    w = who(request, x_viewer_token)
    with _pj_lock:
        jobs = _pj_load()
        e = jobs.get(key)
        if not e:
            return {"ok": True, "removed": False}
        pid = e.get("project") or ""
        if accounts_on() and not w.site_admin:
            r = ACC.role(w.uid, pid) if project_dir(pid) else None
            if not r or RANK[r] < RANK["publisher"]:
                raise HTTPException(status_code=403, detail="Only a publisher or admin of that project can remove it")
        jobs.pop(key, None)
        _pj_save(jobs)
    return {"ok": True, "removed": True}


@app.get("/api/admin/projects")
async def admin_project_list(request: Request, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    counts = ACC.member_counts()
    return {"projects": [dict(p, members=counts.get(p["id"], 0)) for p in admin_projects(w)],
            "site_admin": w.site_admin}


@app.get("/api/admin/projects/{pid}/members")
async def admin_members(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    require_project(request, pid, "admin", x_viewer_token)
    return {"members": ACC.members(pid)}


@app.put("/api/admin/projects/{pid}/members")
async def admin_set_member(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    w, _ = require_project(request, pid, "admin", x_viewer_token)
    body = await request.json() or {}
    role = body.get("role") or "member"
    ids = body.get("user_ids") or ([body["user_id"]] if body.get("user_id") else [])
    if not ids:
        raise HTTPException(status_code=400, detail="Choose someone to add")
    admins = [m["id"] for m in ACC.admins_of(pid)]
    for uid in ids:
        uid = int(uid)
        if not ACC.get(uid):
            raise HTTPException(status_code=404, detail="No such account: %s" % uid)
        if role != "admin" and admins == [uid] and not w.site_admin:
            raise HTTPException(status_code=400,
                                detail="A project needs at least one project admin")
        try:
            ACC.set_member(pid, uid, role, by=w.name)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
    return {"members": ACC.members(pid)}


@app.delete("/api/admin/projects/{pid}/members/{uid}")
async def admin_remove_member(request: Request, pid: str, uid: int,
                              x_viewer_token: str = Header(default="")):
    need_accounts()
    w, _ = require_project(request, pid, "admin", x_viewer_token)
    admins = [m["id"] for m in ACC.admins_of(pid)]
    if admins == [uid] and not w.site_admin:
        raise HTTPException(status_code=400, detail="A project needs at least one project admin")
    ACC.remove_member(pid, uid)
    return {"members": ACC.members(pid)}


# ------------------------------------------------- device telemetry
#
# Each viewer page reports how the device coped (telemetry.js): a summary
# once the models are in and when the page is left, and - noticed by the
# next page opened on that device - pages that stopped without closing
# (a phone running out of memory). Kept as one JSON line per report, a
# file a month, for the Admin page's Devices tab.

TELE_MAX_FILE = 20 * 1024 * 1024
_tele_seen = {}


def _tele_dir():
    d = os.path.join(CFG["data"], "telemetry")
    if not os.path.isdir(d):
        os.makedirs(d)
    return d


@app.post("/api/telemetry")
async def post_telemetry(request: Request, x_viewer_token: str = Header(default="")):
    try:
        raw = await request.body()
    except Exception:
        raise HTTPException(status_code=400, detail="No body")
    if len(raw) > 200000:
        raise HTTPException(status_code=413, detail="Too big")
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Not JSON")
    # sendBeacon cannot set a header: the token may come in the body
    w = who(request, x_viewer_token or str(body.pop("token", "") or ""))
    body.pop("token", None)
    sid = str(body.get("sid") or "")[:16]
    n = _tele_seen.get(sid, 0)
    if n > 60:
        return {"ok": False, "why": "enough from this page"}
    _tele_seen[sid] = n + 1
    if len(_tele_seen) > 20000:
        _tele_seen.clear()
    rec = {"received": time.strftime("%Y-%m-%dT%H:%M:%S"), "user": w.name or "",
           "ip": (request.client.host if request.client else "")}
    for k in ("sid", "event", "page", "project", "at", "up_s", "device", "gpu", "peak", "now",
              "moving", "stalls", "worst_stall_ms", "events", "extra", "noticed_by"):
        if k in body:
            rec[k] = body[k]
    path = os.path.join(_tele_dir(), time.strftime("%Y-%m") + ".jsonl")
    try:
        if os.path.isfile(path) and os.path.getsize(path) > TELE_MAX_FILE:
            return {"ok": False, "why": "this month's file is full"}
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as ex:
        print("telemetry not saved: %s" % ex)
    return {"ok": True}


@app.get("/api/admin/telemetry")
async def get_telemetry(request: Request, limit: int = 400, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    if accounts_on() and not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can see device reports")
    out = []
    d = _tele_dir()
    for name in sorted(os.listdir(d), reverse=True):
        if not name.endswith(".jsonl"):
            continue
        try:
            with open(os.path.join(d, name), encoding="utf-8") as f:
                lines = f.readlines()
        except Exception:
            continue
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except Exception:
                continue
            if len(out) >= max(1, min(limit, 5000)):
                break
        if len(out) >= limit:
            break
    return {"reports": out}


# ------------------------------------------------- deleting a project
#
# Nothing is really deleted: the project's folder (models, sheets, manifest)
# and its data folder (issues, markups, snapshots) are moved together into
# <data>/_deleted/<project>__<when>/, with its members and settings saved
# beside them. A site admin can put it back from the Admin page; emptying
# the bin is done by hand on the server, on purpose.

def _trash_root():
    d = os.path.join(CFG["data"], "_deleted")
    if not os.path.isdir(d):
        os.makedirs(d)
    return d


def _close_store(pid):
    st = STORES.pop(pid, None)
    if st is not None:
        try:
            st._db.close()
        except Exception:
            pass


def _folder_size(d):
    total = 0
    for base, _, files in os.walk(d):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


@app.delete("/api/admin/projects/{pid}")
async def admin_delete_project(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can delete a project")
    if CFG["single"]:
        raise HTTPException(status_code=400, detail="This server shows a single project")
    body = {}
    try:
        body = await request.json() or {}
    except Exception:
        pass
    # typed by the person, as a guard against the wrong row
    if (body.get("confirm") or "") != pid:
        raise HTTPException(status_code=400, detail="Type the project name to confirm")
    src = project_dir(pid)
    if not src:
        raise HTTPException(status_code=404, detail="No such project: %s" % pid)

    when = time.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(_trash_root(), "%s__%s" % (pid, when))
    os.makedirs(dest)
    _close_store(pid)
    shutil.move(src, os.path.join(dest, "exports"))
    data = os.path.join(CFG["data"], "projects", pid)
    if os.path.isdir(data):
        shutil.move(data, os.path.join(dest, "data"))
    info = {"project": pid, "deleted_at": when, "deleted_by": w.name,
            "rows": ACC.project_rows(pid)}
    with open(os.path.join(dest, "deleted.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    ACC.drop_project(pid)
    print("project deleted (moved to bin): %s by %s -> %s" % (pid, w.name, dest))
    return {"deleted": pid, "bin": os.path.basename(dest)}


@app.get("/api/admin/deleted-projects")
async def admin_deleted_projects(request: Request, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can see deleted projects")
    out = []
    root = os.path.join(CFG["data"], "_deleted")
    if os.path.isdir(root):
        for name in sorted(os.listdir(root), reverse=True):
            d = os.path.join(root, name)
            meta = {}
            try:
                with open(os.path.join(d, "deleted.json"), encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            out.append({"bin": name, "project": meta.get("project"),
                        "deleted_at": meta.get("deleted_at"), "deleted_by": meta.get("deleted_by"),
                        "size": _folder_size(d),
                        "taken": bool(project_dir(meta.get("project") or ""))})
    return {"deleted": out}


@app.post("/api/admin/deleted-projects/{name}/restore")
async def admin_restore_project(request: Request, name: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    w = who(request, x_viewer_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can restore a project")
    root = os.path.join(CFG["data"], "_deleted")
    d = os.path.normpath(os.path.join(root, name))
    if os.path.dirname(d) != os.path.normpath(root) or not os.path.isdir(d):
        raise HTTPException(status_code=404, detail="Not in the bin")
    with open(os.path.join(d, "deleted.json"), encoding="utf-8") as f:
        meta = json.load(f)
    pid = meta["project"]
    target = os.path.join(CFG["root"], pid)
    if os.path.exists(target):
        raise HTTPException(status_code=409, detail=(
            "A project called %s exists again (uploaded since). Delete or rename it first." % pid))
    data = os.path.join(CFG["data"], "projects", pid)
    if os.path.exists(data):
        raise HTTPException(status_code=409, detail=(
            "Issue data for %s is on the server again; move it away first." % pid))
    shutil.move(os.path.join(d, "exports"), target)
    if os.path.isdir(os.path.join(d, "data")):
        shutil.move(os.path.join(d, "data"), data)
    ACC.restore_project(pid, meta.get("rows") or {})
    shutil.rmtree(d)
    print("project restored: %s by %s" % (pid, w.name))
    return {"restored": pid}


# ------------------------------------------------- project settings

@app.get("/api/admin/projects/{pid}/settings")
async def get_project_settings(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    require_project(request, pid, "admin", x_viewer_token)
    return {"teams_webhook": ACC.setting(pid, "teams_webhook"),
            "digest_day": ACC.setting(pid, "digest_day") or "mon",
            "digest_hour": int(ACC.setting(pid, "digest_hour") or 9)}


@app.put("/api/admin/projects/{pid}/settings")
async def put_project_settings(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    require_project(request, pid, "admin", x_viewer_token)
    body = await request.json() or {}
    url = (body.get("teams_webhook") or "").strip()
    if url and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="The Teams webhook address starts with https://")
    ACC.set_setting(pid, "teams_webhook", url)
    if "digest_day" in body:
        day = str(body.get("digest_day") or "off").lower()
        ACC.set_setting(pid, "digest_day", day if day in DIGEST_DAYS else "off")
    if "digest_hour" in body:
        try:
            ACC.set_setting(pid, "digest_hour", str(max(0, min(23, int(body.get("digest_hour"))))))
        except (TypeError, ValueError):
            pass
    return {"teams_webhook": url, "digest_day": ACC.setting(pid, "digest_day") or "mon",
            "digest_hour": int(ACC.setting(pid, "digest_hour") or 9)}


@app.post("/api/admin/projects/{pid}/teams-test")
async def teams_test(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    need_accounts()
    w, _ = require_project(request, pid, "admin", x_viewer_token)
    url = ACC.setting(pid, "teams_webhook")
    if not url:
        raise HTTPException(status_code=400, detail="Save a Teams webhook address first")
    item = {"id": "test", "issue": {"number": 0, "title": "Test message from the LWK Viewer",
                                    "status": "Open", "assigned_to": w.name}, "updated_by": w.name}
    try:
        code = post_json(url, teams_card(pid, item, ["this channel will get issue updates"],
                                         str(request.base_url)))
    except Exception as ex:
        raise HTTPException(status_code=502, detail="Teams did not accept it: %s" % ex)
    return {"ok": True, "status": code}


# ------------------------------------------------------- export upload

UPLOAD_DIRS = ("fragments", "sheets")
UPLOAD_RECORD = ".uploaded.json"


def _sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _upload_target(request, pid, header_token):
    """The project folder an upload may write: a project the person is a
    publisher (or project admin) of, or - for a site admin - a new one."""
    if not SAFE_PROJECT.match(pid or "") or pid.startswith("."):
        raise HTTPException(status_code=400, detail="Project names use letters, digits, spaces, . _ -")
    root = project_dir(pid)
    if root:
        require_project(request, pid, "publisher", header_token)
        return root
    w = who(request, header_token)
    if not w.site_admin:
        raise HTTPException(status_code=403, detail="Only a site admin can add a new project - ask one to publish it once, "
                            "then anyone made Publisher on it can publish updates")
    root = os.path.join(CFG["root"], pid)
    os.makedirs(root, exist_ok=True)
    return root


def _safe_rel(rel):
    rel = (rel or "").replace("\\", "/")
    parts = [p for p in rel.split("/") if p]
    if not parts or any(p in (".", "..") for p in parts):
        return None
    if parts[0] not in UPLOAD_DIRS and rel != "manifest.json":
        return None
    return "/".join(parts)


# ------------------------------------------------------ sheet versions
#
# Each time an upload replaces a sheet PDF whose drawing really changed,
# the one it replaces is kept under _versions/<path>/<when>.pdf, so the
# viewer can overlay the two (Compare). The folder name starts with an
# underscore, so an upload can never write into it (_safe_rel only accepts
# fragments/ and sheets/), but /data/ serves it to members like any file.

VERSIONS_DIR = "_versions"
# how many earlier versions of each sheet PDF are kept (LWK_KEEP_SHEET_VERSIONS)
VERSIONS_KEEP = max(1, int(os.environ.get("LWK_KEEP_SHEET_VERSIONS", "12") or 12))
_PDF_VOLATILE = [
    re.compile(rb"/CreationDate\s*\([^)]*\)"),
    re.compile(rb"/ModDate\s*\([^)]*\)"),
    re.compile(rb"/ID\s*\[[^\]]*\]"),
    re.compile(rb"<xmp:[A-Za-z]*Date>[^<]*</xmp:[A-Za-z]*Date>"),
    re.compile(rb"<xmpMM:(?:Document|Instance)ID>[^<]*</xmpMM:(?:Document|Instance)ID>"),
    re.compile(rb"xref\s[\s\S]*?trailer"),
    re.compile(rb"startxref\s+\d+"),
]


def pdf_fingerprint(data):
    """SHA-1 of a PDF without the parts that change on every export even
    when the drawing does not: dates, document ids and the byte offsets
    that follow from them. Revit stamps each PDF with the time it was
    made, so a plain hash would call every nightly export a new version."""
    for rx in _PDF_VOLATILE:
        data = rx.sub(b"", data)
    return hashlib.sha1(data).hexdigest()


def version_folder(root, rel):
    return os.path.join(root, VERSIONS_DIR, *rel.split("/"))


def keep_version(root, rel, dest, new_data):
    """Before `dest` is overwritten with `new_data`: keep the old file if
    the drawing in it differs. Returns the kept path, or None."""
    if not os.path.isfile(dest):
        return None
    with open(dest, "rb") as f:
        old = f.read()
    if pdf_fingerprint(old) == pdf_fingerprint(new_data):
        return None
    folder = version_folder(root, rel)
    os.makedirs(folder, exist_ok=True)
    when = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(os.path.getmtime(dest)))
    kept = os.path.join(folder, when + ".pdf")
    if not os.path.exists(kept):
        with open(kept + ".part", "wb") as f:
            f.write(old)
        os.replace(kept + ".part", kept)
    # where the views sat on the paper in that version (the manifest now on
    # disk is still the old one: manifest.json is written last), so markups
    # drawn on it can be moved onto the new one (viewer: followViews)
    try:
        sheets = [s for s in (_old_manifest(root).get("sheets") or []) if s.get("pdf") == rel]
        if sheets:
            with open(kept[:-4] + ".json", "w", encoding="utf-8") as f:
                json.dump({"sheets": [{"number": s.get("number"), "page": s.get("page"),
                                       "viewports": s.get("viewports") or []} for s in sheets]},
                          f, separators=(",", ":"))
    except Exception as ex:
        print("version views not kept for %s: %s" % (rel, ex))
    files = sorted(n for n in os.listdir(folder) if n.lower().endswith(".pdf"))
    for n in files[:-VERSIONS_KEEP]:
        for victim in (n, n[:-4] + ".json"):
            try:
                os.remove(os.path.join(folder, victim))
            except OSError:
                pass
    return kept


# how many earlier 3D models are kept (LWK_KEEP_MODEL_VERSIONS); each is the
# size of the model itself, so 7 of a 60 MB model is ~420 MB per project
MODEL_VERSIONS_KEEP = max(1, int(os.environ.get("LWK_KEEP_MODEL_VERSIONS", "7") or 7))


def keep_model_version(root, rel, dest, new_data):
    """The fast 3D model an upload replaces, kept (the last MODEL_VERSIONS_KEEP) so the
    viewer can show what changed between exports."""
    if not os.path.isfile(dest):
        return None
    if os.path.getsize(dest) == len(new_data):
        with open(dest, "rb") as f:
            if f.read() == new_data:
                return None
    folder = version_folder(root, rel)
    os.makedirs(folder, exist_ok=True)
    when = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(os.path.getmtime(dest)))
    kept = os.path.join(folder, when + ".lwkm")
    if not os.path.exists(kept):
        shutil.copyfile(dest, kept + ".part")
        os.replace(kept + ".part", kept)
    files = sorted(n for n in os.listdir(folder) if n.endswith(".lwkm"))
    for n in files[:-MODEL_VERSIONS_KEEP]:
        try:
            os.remove(os.path.join(folder, n))
        except OSError:
            pass
    return kept


@app.get("/api/model-versions")
async def get_model_versions(request: Request, file: str = "", x_viewer_token: str = Header(default=""),
                             x_project: str = Header(default="")):
    require_project(request, x_project, "viewer", x_viewer_token)
    rel = _safe_rel(file)
    if not rel or not rel.lower().endswith(".lwkm"):
        raise HTTPException(status_code=400, detail="file must be fragments/<name>.lwkm")
    root = CFG["single"] or project_dir(x_project)
    folder = version_folder(root, rel)
    out = []
    if os.path.isdir(folder):
        for n in sorted(os.listdir(folder), reverse=True):
            if not n.endswith(".lwkm"):
                continue
            stem = n[:-5]
            try:
                at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.strptime(stem, "%Y%m%dT%H%M%SZ"))
            except ValueError:
                at = stem
            out.append({"id": stem, "at": at, "path": "/".join([VERSIONS_DIR, rel, n]),
                        "size": os.path.getsize(os.path.join(folder, n))})
    return {"file": rel, "versions": out}


_manifest_cache = {}


def _old_manifest(root):
    """The project's manifest.json as it is on disk, read once per version
    of it (an upload keeps many PDFs, each asking)."""
    p = os.path.join(root, "manifest.json")
    try:
        st = os.stat(p)
    except OSError:
        return {}
    key = (p, st.st_mtime_ns, st.st_size)
    if key not in _manifest_cache:
        _manifest_cache.clear()
        with open(p, encoding="utf-8") as f:
            _manifest_cache[key] = json.load(f)
    return _manifest_cache[key]


def list_versions(root, rel):
    folder = version_folder(root, rel)
    if not os.path.isdir(folder):
        return []
    out = []
    for n in sorted(os.listdir(folder), reverse=True):
        if not n.lower().endswith(".pdf"):
            continue
        p = os.path.join(folder, n)
        stem = n[:-4]
        try:
            at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.strptime(stem, "%Y%m%dT%H%M%SZ"))
        except ValueError:
            at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(p)))
        views = os.path.isfile(p[:-4] + ".json")
        out.append({"id": stem, "at": at, "size": os.path.getsize(p),
                    "path": "/".join([VERSIONS_DIR, rel, n]),
                    "views": "/".join([VERSIONS_DIR, rel, stem + ".json"]) if views else None})
    return out


@app.get("/api/versions")
async def get_versions(request: Request, pdf: str = "",
                       x_viewer_token: str = Header(default=""),
                       x_project: str = Header(default="")):
    """Earlier versions of one sheet PDF, newest first. `path` is relative
    to the project folder, for /data/<project>/<path>."""
    require_project(request, x_project, "viewer", x_viewer_token)
    rel = _safe_rel(pdf)
    if not rel or not rel.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="pdf must be a sheets/... PDF path")
    root = CFG["single"] or project_dir(x_project)
    current = os.path.join(root, *rel.split("/"))
    cur = None
    if os.path.isfile(current):
        cur = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(current)))
    return {"pdf": rel, "current": cur, "versions": list_versions(root, rel)}


@app.post("/api/admin/projects/{pid}/upload-plan")
async def upload_plan(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    """Step 1 of an upload: the exporter lists its files with their SHA-1;
    the answer is which of them the server does not have yet. Drawings that
    did not change are not sent again."""
    root = _upload_target(request, pid, x_viewer_token)
    body = await request.json() or {}
    need = []
    for f in body.get("files") or []:
        rel = _safe_rel(f.get("path"))
        if not rel:
            continue
        p = os.path.join(root, *rel.split("/"))
        if not (os.path.isfile(p) and os.path.getsize(p) == f.get("size") and _sha1(p) == f.get("sha1")):
            need.append(rel)
    return {"need": need}


def _upload_source(man, part):
    """The Revit file an upload comes from (its title), or "main"."""
    if part and part.get("source"):
        return str(part["source"])[:120]
    try:
        t = ((man or {}).get("source") or {}).get("title")
        if t:
            return str(t)[:120]
    except Exception:
        pass
    return "main"


MODEL_KEYS = ("models", "lwk_frame", "model", "ifc_exclude", "levels", "grids", "elements", "element_categories")


def _merge_manifest(root, new, source, part):
    """The project's manifest after an upload from one Revit file: that
    file's sheets replace the sheets it sent before; the sheets of other
    files stay; the 3D models are the upload's when it has any, otherwise
    they stay as they were."""
    try:
        with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
            old = json.load(f) or {}
    except Exception:
        old = {}
    out = dict(new)
    for s in out.get("sheets") or []:
        s.setdefault("source", source)
    if not old:
        return out
    # 3D: an upload of sheets only keeps the models (and what goes with them)
    if not (new.get("models") or []):
        for k in MODEL_KEYS:
            # a part (another Revit file's sheets) never replaces the main
            # file's levels, grids and element table either
            if k in old and (part or not new.get(k)):
                out[k] = old[k]
    have = set(str(s.get("number")) for s in out.get("sheets") or [])
    for s in old.get("sheets") or []:
        src = s.get("source")
        mine = src == source or (src is None and not part)
        if mine or str(s.get("number")) in have:
            continue                     # replaced by this upload
        out.setdefault("sheets", []).append(s)
    out["sheets"] = sorted(out.get("sheets") or [], key=lambda s: str(s.get("number") or ""))
    if part:
        # the project keeps the main file's title and settings
        for k in ("source", "exported_at", "units", "schema"):
            if k in old:
                out[k] = old[k]
        out.setdefault("parts", {})
        out["parts"] = dict(old.get("parts") or {}, **{source: new.get("exported_at") or ""})
    elif old.get("parts"):
        out["parts"] = old["parts"]
    return out


@app.post("/api/admin/projects/{pid}/upload")
async def upload_export(request: Request, pid: str, x_viewer_token: str = Header(default="")):
    """Step 2: a zip of the files asked for, plus the full list of files the
    export now has (header X-Keep, JSON). Files an earlier upload put there
    that are no longer in the export are removed; anything else in the
    folder - imported PDFs above all - is left alone. manifest.json goes in
    last, so a viewer never sees a manifest naming files not there yet."""
    import tempfile
    import zipfile
    root = _upload_target(request, pid, x_viewer_token)
    try:
        keep = json.loads(request.headers.get("x-keep") or "[]")
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Keep must be a JSON list")
    keep = [k for k in (_safe_rel(x) for x in keep) if k]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip", dir=CFG["data"])
    try:
        async for chunk in request.stream():
            tmp.write(chunk)
        tmp.close()
        written, manifest_bytes, part = [], None, None
        with zipfile.ZipFile(tmp.name) as z:
            if "_job.json" in z.namelist():
                # how this export was made (from which Revit file and PC, what
                # it includes, the night schedule, the last log): kept for the
                # project's Exports page, never part of what the viewer shows
                try:
                    _job = json.loads(z.read("_job.json").decode("utf-8")) or {}
                    record_export_job(root, _job)
                    # and in the list of every PC's auto-publish settings
                    _w = who(request, x_viewer_token)
                    pj_upsert(pid, dict(_job), getattr(_w, "name", "") or "", ran=True)
                except Exception as ex:
                    print("export job record failed: %s" % ex)
            if "_part.json" in z.namelist():
                # "these sheets come from another Revit file of the same
                # project": added to what is there, nothing else replaced
                try:
                    part = json.loads(z.read("_part.json").decode("utf-8")) or {}
                except ValueError:
                    part = {}
            if "_keep.json" in z.namelist():
                # The full file list travels inside the zip (a header this
                # long would be refused for a project with hundreds of files).
                keep = [k for k in (_safe_rel(x) for x in json.loads(z.read("_keep.json").decode("utf-8"))) if k]
            for info in z.infolist():
                rel = _safe_rel(info.filename)
                if not rel or info.is_dir() or rel in ("_keep.json", "_part.json", "_job.json"):
                    continue
                data = z.read(info)
                if rel == "manifest.json":
                    try:
                        json.loads(data.decode("utf-8"))
                    except Exception:
                        raise HTTPException(status_code=400, detail="manifest.json in the upload is not valid")
                    manifest_bytes = data
                    continue
                dest = os.path.join(root, *rel.split("/"))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                if rel.lower().endswith(".pdf"):
                    try:
                        keep_version(root, rel, dest, data)
                    except Exception as ex:      # history is a nicety, never a failed upload
                        print("version keep failed for %s: %s" % (rel, ex))
                elif rel.lower().endswith(".lwkm"):
                    try:
                        keep_model_version(root, rel, dest, data)
                    except Exception as ex:
                        print("model version keep failed for %s: %s" % (rel, ex))
                with open(dest + ".part", "wb") as f:
                    f.write(data)
                os.replace(dest + ".part", dest)
                written.append(rel)
                if rel.lower().endswith(".lwkm"):
                    # a new model: what the viewer worked out for the old one goes
                    stem = os.path.basename(dest)[:-5]
                    for side in os.listdir(os.path.dirname(dest)):
                        if side in (stem + ".ext.json", stem + ".tidx", stem + ".tbin") or re.match(
                                re.escape(stem) + r"\.mobile\d*\.lwkm$", side):
                            try:
                                os.remove(os.path.join(os.path.dirname(dest), side))
                            except OSError:
                                pass
        # Which Revit file this upload comes from. A project may be made of
        # several (the drawings in one master file, the area plans and
        # schedules in another): each one's files and sheets are its own,
        # and an upload replaces only what came from the same file before.
        rec_path = os.path.join(root, UPLOAD_RECORD)
        try:
            with open(rec_path, encoding="utf-8") as f:
                rec = json.load(f) or {}
        except Exception:
            rec = {}
        new_man = None
        if manifest_bytes is not None:
            new_man = json.loads(manifest_bytes.decode("utf-8"))
        source = _upload_source(new_man, part)
        sources = rec.get("sources")
        if not isinstance(sources, dict):
            # an upload record from before: all of it was the main file's
            sources = {source: list(rec.get("files") or [])} if rec.get("files") and not part else {}
        before = set(sources.get(source) or [])
        # a file another source also lists is theirs too: never removed here
        others = set()
        for k, v in sources.items():
            if k != source:
                others.update(v or [])
        removed = 0
        for rel in before - set(keep) - others:
            p = os.path.join(root, *rel.split("/"))
            if rel != "manifest.json" and os.path.isfile(p):
                os.remove(p)
                removed += 1
        sources[source] = keep
        if new_man is not None:
            merged = _merge_manifest(root, new_man, source, bool(part))
            with open(os.path.join(root, "manifest.json.part"), "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False)
            os.replace(os.path.join(root, "manifest.json.part"), os.path.join(root, "manifest.json"))
        every = sorted(set().union(*[set(v or []) for v in sources.values()])) if sources else keep
        with open(rec_path, "w", encoding="utf-8") as f:
            json.dump({"files": every, "sources": sources,
                       "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    finally:
        try:
            os.remove(tmp.name)
        except Exception:
            pass
    # the phone copies of the new models, made here in the background
    if any(w.lower().endswith(".lwkm") for w in written):
        queue_phone_copies(root, pid)
    # scanned drawings: their words read by OCR, in the background
    pdfs = [w for w in written if w.lower().endswith(".pdf")]
    if pdfs:
        queue_ocr(root, pdfs)
        # and every sheet drawn as pictures, for big drawings and slow lines
        queue_all_sheet_tiles(root, pdfs)
    return {"written": len(written), "removed": removed,
            "manifest": manifest_bytes is not None, "project": pid,
            "phone_copies": bool(node_bin()) and any(w.lower().endswith(".lwkm") for w in written)}


# ------------------------------------------------ "show me" from Revit
#
# Revit's LWK Issues can only open a web page by starting the browser, and a
# browser started with a URL always opens a new tab: a reviewer clicking
# through ten issues ended up with ten tabs. Instead Revit leaves a note
# here ("show issue X") for the person signed in; a viewer page they have
# open (it asks every two seconds) claims the note and goes to the issue
# itself. Only when no page of theirs is open does Revit open a new tab.
# Held in memory: a note is worth nothing after half a minute.

GOTO = {}        # person -> {"seq", "project", "id", "kind", "sheet", "ts", "claimed"}
GOTO_LIVE = {}   # person -> last time a page of theirs asked
GOTO_SEQ = [0]
GOTO_TTL = 30.0


def _goto_key(w):
    return w.uid or "shared"


@app.post("/api/goto")
async def goto_put(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    GOTO_SEQ[0] += 1
    key = _goto_key(w)
    GOTO[key] = {"seq": GOTO_SEQ[0], "project": str(body.get("project") or "")[:80],
                 "id": str(body.get("id") or "")[:80], "kind": str(body.get("kind") or "")[:10],
                 "sheet": str(body.get("sheet") or "")[:80], "ts": time.time(), "claimed": False}
    live = time.time() - GOTO_LIVE.get(key, 0) < 8.0
    return {"seq": GOTO_SEQ[0], "page_open": live}


@app.get("/api/goto")
async def goto_poll(request: Request, after: int = -1, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    key = _goto_key(w)
    GOTO_LIVE[key] = time.time()
    g = GOTO.get(key)
    cur = g["seq"] if g else 0
    if after < 0 or not g or g["seq"] <= after or g["claimed"] or time.time() - g["ts"] > GOTO_TTL:
        return {"goto": None, "seq": cur}
    return {"goto": {k: g[k] for k in ("seq", "project", "id", "kind", "sheet")}, "seq": cur}


# ------------------------------------------------- Revit add-in (viewer -> Revit)
# Kept in memory per person, like GOTO. The add-in polls for what to select;
# it posts what is selected in Revit for the viewer to use. The exchange is
# described for the add-in's developer in server/REVIT_ADDIN_API.md.
REVIT_REQ = {}          # key -> [request, ...] (the last 20)
REVIT_SEQ = [0]
REVIT_SEEN = {}         # key -> time the add-in last polled
REVIT_SEL = {}          # key -> {project, document, elements, at}


def _clean_elements(v, cap=500):
    out = []
    for e in (v if isinstance(v, list) else [])[:cap]:
        if not isinstance(e, dict):
            continue
        rid = str(e.get("id") if e.get("id") is not None else e.get("revit_id") or "")[:20]
        uid = str(e.get("uid") or e.get("revit_uid") or "")[:80]
        if not re.match(r"^-?\d{0,19}$", rid) or not re.match(r"^[A-Za-z0-9-]{0,80}$", uid) or not (rid or uid):
            continue
        out.append({"id": rid, "uid": uid, "name": str(e.get("name") or "")[:120],
                    "category": str(e.get("category") or "")[:80]})
    return out


@app.post("/api/revit/requests")
async def revit_request(request: Request, x_viewer_token: str = Header(default="")):
    """The viewer: {project, kind: "select", elements: [{id, uid}], issue,
    title, viewpoint}. Answers whether the add-in has been listening."""
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    els = _clean_elements(body.get("elements"))
    if not els:
        raise HTTPException(status_code=400, detail="No Revit elements to show")
    key = _goto_key(w)
    REVIT_SEQ[0] += 1
    req = {"seq": REVIT_SEQ[0], "kind": "select", "project": str(body.get("project") or "")[:80],
           "elements": els, "issue": str(body.get("issue") or "")[:80], "title": str(body.get("title") or "")[:200],
           "viewpoint": body.get("viewpoint") if isinstance(body.get("viewpoint"), dict) else None,
           "at": time.time(), "claimed": False}
    REVIT_REQ[key] = (REVIT_REQ.get(key) or [])[-19:] + [req]
    return {"seq": req["seq"], "addin_seen": time.time() - REVIT_SEEN.get(key, 0) < 30}


@app.get("/api/revit/requests")
async def revit_poll(request: Request, after: int = 0, x_viewer_token: str = Header(default="")):
    """The add-in, every few seconds: what to select (unclaimed, under 10 minutes old)."""
    w = who(request, x_viewer_token)
    key = _goto_key(w)
    REVIT_SEEN[key] = time.time()
    now = time.time()
    out = [dict((k, v) for k, v in r.items() if k != "claimed") for r in REVIT_REQ.get(key) or []
           if r["seq"] > after and not r["claimed"] and now - r["at"] < 600]
    return {"requests": out, "seq": REVIT_SEQ[0]}


@app.post("/api/revit/requests/claim")
async def revit_claim(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    for r in REVIT_REQ.get(_goto_key(w)) or []:
        if r["seq"] == int(body.get("seq") or -1):
            r["claimed"] = True
            return {"ok": True}
    return {"ok": False}


@app.get("/api/revit/status")
async def revit_status(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    return {"addin_seen": time.time() - REVIT_SEEN.get(_goto_key(w), 0) < 30}


@app.post("/api/revit/selection")
async def revit_selection_put(request: Request, x_viewer_token: str = Header(default="")):
    """The add-in: {project, document, elements: [{id, uid, name, category}]}"""
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    key = _goto_key(w)
    REVIT_SEEN[key] = time.time()
    REVIT_SEL[key] = {"project": str(body.get("project") or "")[:80], "document": str(body.get("document") or "")[:200],
                      "elements": _clean_elements(body.get("elements")), "at": time.time()}
    return {"ok": True, "count": len(REVIT_SEL[key]["elements"])}


@app.get("/api/revit/selection")
async def revit_selection_get(request: Request, x_viewer_token: str = Header(default="")):
    """The viewer: what is selected in Revit now (sent in the last hour)."""
    w = who(request, x_viewer_token)
    s = REVIT_SEL.get(_goto_key(w))
    if not s or time.time() - s["at"] > 3600:
        return {"elements": [], "project": "", "document": "", "age": None}
    return dict(s, age=int(time.time() - s["at"]))


@app.post("/api/goto/claim")
async def goto_claim(request: Request, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    body = await request.json() or {}
    g = GOTO.get(_goto_key(w))
    if not g or g["seq"] != int(body.get("seq") or -1) or g["claimed"]:
        return {"ok": False}
    g["claimed"] = True
    return {"ok": True}


@app.get("/api/goto/status")
async def goto_status(request: Request, seq: int = 0, x_viewer_token: str = Header(default="")):
    w = who(request, x_viewer_token)
    g = GOTO.get(_goto_key(w))
    return {"claimed": bool(g and g["seq"] == seq and g["claimed"])}


# ------------------------------------------- what is seen from outside
#
# The viewer works out once, on a computer, which elements of a fast 3D
# model are seen from outside the buildings, and keeps the answer next to
# the model (<name>.ext.json): everyone after it, phones above all, draws
# only those while outside. The "sig" names the export it belongs to; the
# viewer ignores a list made for another export.

@app.post("/api/exterior")
async def put_exterior(request: Request, x_viewer_token: str = Header(default=""),
                       x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    body = await request.json() or {}
    rel = str(body.get("file") or "").replace("\\", "/")
    if not re.match(r"^fragments/[^/]+\.lwkm$", rel):
        raise HTTPException(status_code=400, detail="file must be fragments/<name>.lwkm")
    ext = body.get("ext") or []
    if not isinstance(ext, list) or len(ext) > 5_000_000:
        raise HTTPException(status_code=400, detail="ext must be a list of element numbers")
    ext = [int(e) for e in ext if isinstance(e, int) and e >= 0]
    out = os.path.join(root, *rel[:-5].split("/")) + ".ext.json"
    if not os.path.isfile(os.path.join(root, *rel.split("/"))):
        raise HTTPException(status_code=404, detail="No such model file")
    tmp = out + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"sig": str(body.get("sig") or ""), "ext": ext,
                   "made": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "views": int(body.get("views") or 0),
                   "rule": int(body.get("rule") or 1)}, f, separators=(",", ":"))
    os.replace(tmp, out)
    return {"ok": True, "count": len(ext)}


# ------------------------------------------------ the phone's model file
#
# A phone cannot hold a whole tower. The viewer on a computer, having
# worked out what is seen from outside, writes a smaller copy of each fast
# 3D model - outside only, no small fittings - and keeps it here as
# <name>.mobile.lwkm; phones and tablets load that instead.

MOBILE_NAME = re.compile(r"^(fragments/[^/]+?)(\.mobile\d*)?\.lwkm$")


def _mobile_paths(root, rel, rule):
    """(source model, phone copy) for fragments/<name>.lwkm; the copy is
    named after the rule it was made by (<name>.mobile<rule>.lwkm), so a
    copy made by an older viewer is never taken for a current one."""
    rel = (rel or "").replace("\\", "/")
    m = MOBILE_NAME.match(rel)
    if not m or m.group(2):
        return None, None
    try:
        rule = max(1, min(99, int(rule or 1)))
    except (TypeError, ValueError):
        rule = 1
    src = os.path.join(root, *rel.split("/"))
    return src, src[:-5] + (".mobile.lwkm" if rule == 1 else ".mobile%d.lwkm" % rule)


@app.get("/api/lwkm-mobile")
async def check_lwkm_mobile(request: Request, file: str = "", project: str = "", rule: int = 1):
    pid = "default" if CFG["single"] else project
    require_project(request, pid, "viewer")
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    src, out = _mobile_paths(root, file, rule)
    if not src:
        raise HTTPException(status_code=400, detail="file must be fragments/<name>.lwkm")
    return {"exists": bool(out and os.path.isfile(out))}


@app.post("/api/lwkm-mobile")
async def put_lwkm_mobile(request: Request, file: str = "", rule: int = 1,
                          x_viewer_token: str = Header(default=""),
                          x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    src, out = _mobile_paths(root, file, rule)
    if not src:
        raise HTTPException(status_code=400, detail="file must be fragments/<name>.lwkm")
    if not os.path.isfile(src):
        raise HTTPException(status_code=404, detail="No such model file")
    data = await request.body()
    if len(data) < 16 or len(data) > 400 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Bad size")
    # the older copies of this model go
    stem = os.path.basename(src)[:-5]
    for side in os.listdir(os.path.dirname(src)):
        if re.match(re.escape(stem) + r"\.mobile\d*\.lwkm$", side) and side != os.path.basename(out):
            try:
                os.remove(os.path.join(os.path.dirname(src), side))
            except OSError:
                pass
    with open(out + ".part", "wb") as f:
        f.write(data)
    os.replace(out + ".part", out)
    return {"ok": True, "bytes": len(data)}


# ------------------------------------------------------- sheet previews
#
# Opening a sheet means downloading its PDF and drawing every line of it -
# seconds for a busy Revit sheet. The first computer to open a sheet sends
# back a picture of it; everyone after sees that picture at once while the
# PDF is drawn behind it. A picture is kept per version of the PDF (its size
# and time), so a new drawing never shows an old picture.

PREVIEW_DIR = "_previews"


def _preview_path(root, rel, page=1, ext="jpg"):
    rel = (rel or "").replace("\\", "/")
    if not re.match(r"^(sheets|imported)/[^/]+\.pdf$", rel, re.I):
        return None, None
    pdf = os.path.join(root, *rel.split("/"))
    if not os.path.isfile(pdf):
        return None, None
    st = os.stat(pdf)
    try:
        page = max(1, min(9999, int(page or 1)))
    except (TypeError, ValueError):
        page = 1
    name = "%s.p%d.%x-%x.%s" % (re.sub(r"[^\w.-]", "_", rel.replace("/", "__")), page,
                                st.st_size, st.st_mtime_ns, ext)
    return pdf, os.path.join(root, PREVIEW_DIR, name)


@app.get("/api/sheet-preview")
async def get_sheet_preview(request: Request, pdf: str = "", project: str = "", page: int = 1,
                            check: int = 0):
    pid = "default" if CFG["single"] else project
    require_project(request, pid, "viewer")
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    _, out = _preview_path(root, pdf, page)
    if check:        # "is there one?" without a 404 in the browser's console
        return {"exists": bool(out and os.path.isfile(out))}
    if not out or not os.path.isfile(out):
        raise HTTPException(status_code=404, detail="No preview")
    return FileResponse(out, media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/sheet-preview")
async def put_sheet_preview(request: Request, pdf: str = "", page: int = 1,
                            x_viewer_token: str = Header(default=""),
                            x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    src, out = _preview_path(root, pdf, page)
    if not out:
        raise HTTPException(status_code=400, detail="pdf must be sheets/<name>.pdf")
    data = await request.body()
    if len(data) < 100 or len(data) > 12 * 1024 * 1024 or data[:2] != b"\xff\xd8":
        raise HTTPException(status_code=400, detail="Expected a JPEG")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # older pictures of the same sheet go
    stem = os.path.basename(out).rsplit(".", 2)[0]
    for old in os.listdir(os.path.dirname(out)):
        if old.startswith(stem + ".") and old.endswith(".jpg") and old != os.path.basename(out):
            try:
                os.remove(os.path.join(os.path.dirname(out), old))
            except OSError:
                pass
    with open(out + ".part", "wb") as f:
        f.write(data)
    os.replace(out + ".part", out)
    return {"ok": True, "bytes": len(data)}


# ---------------------------------------------------- sheets as picture tiles
#
# A big drawing - a layout with aerial photos, a dense A0 - is tens of MB to
# download and seconds to minutes for a browser to draw, and can take
# gigabytes while it does. On a slow line (Manila) it may never finish. So
# the server draws each sheet once, after the upload, as a pyramid of 512 px
# pictures (poppler's pdftoppm), packed into one file per sheet with an
# index. The viewer then fetches only the pictures of the part on screen, at
# the resolution the screen needs - the whole sheet coarse first, sharper as
# it zooms in - and never has to read the PDF to show it.
#
#   <preview name>.stiles.json   levels, page size in points, where each picture is
#   <preview name>.stiles.stb    the pictures (PNG, or WebP when Pillow is installed)

import math as _math
import subprocess
import threading
import zlib as _zlib
import struct as _struct
import collections as _collections

SHEET_TILE = 512
SHEET_TILE_MAX_PX = 110e6        # the sharpest level, in pixels (an A0 at ~250 dpi)
SHEET_TILE_MAX_DPI = 300
SHEET_TILE_VERSION = 1
SHEETQ = {"q": _collections.deque(), "pending": set(), "thread": None, "cv": threading.Condition(),
          "working": None, "log": []}


def _png(w, h, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(t, d):
        c = _struct.pack(">I", len(d)) + t + d
        return c + _struct.pack(">I", _zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", _struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", _zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _tile_encoder():
    try:
        from PIL import Image  # noqa
        import io

        def enc(w, h, data):
            buf = io.BytesIO()
            Image.frombytes("RGB", (w, h), data).save(buf, "WEBP", quality=85, method=4)
            return buf.getvalue()
        return "webp", enc
    except Exception:
        return "png", None


def _tiles_paths(root, rel, page):
    pdf, base = _preview_path(root, rel, page, "stiles")
    if not base:
        return None, None, None
    return pdf, base + ".json", base + ".stb"


def _page_box(src, page):
    out = subprocess.run(["pdfinfo", "-f", str(page), "-l", str(page), "-box", src],
                         capture_output=True, text=True, timeout=120).stdout
    m = re.search(r"Page\s+%d\s+CropBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)" % page, out)
    if not m:
        m = re.search(r"Page\s+%d\s+MediaBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)" % page, out)
    if not m:
        raise RuntimeError("pdfinfo gave no page size")
    x0, y0, x1, y1 = (float(v) for v in m.groups())
    r = re.search(r"Page\s+%d\s+rot:\s+(\d+)" % page, out)
    rot = int(r.group(1)) % 360 if r else 0
    w, h = abs(x1 - x0), abs(y1 - y0)
    if rot in (90, 270):
        w, h = h, w
    return w, h


def make_sheet_tiles(src, page, meta_path, bin_path):
    import tempfile
    t0 = time.time()
    w_pt, h_pt = _page_box(src, page)
    area_in = max(1e-6, (w_pt / 72.0) * (h_pt / 72.0))
    top = min(SHEET_TILE_MAX_DPI, _math.sqrt(SHEET_TILE_MAX_PX / area_in))
    dpis, d = [], top
    while True:
        dpis.append(d)
        if max(w_pt, h_pt) / 72.0 * d <= 1600 or len(dpis) >= 7:
            break
        d /= 2.0
    dpis.reverse()
    fmt, enc = _tile_encoder()
    T = SHEET_TILE
    levels, offset, blanks, count = [], 0, 0, 0
    with tempfile.TemporaryDirectory() as wd, open(bin_path + ".part", "wb") as out:
        for dpi in dpis:
            base = os.path.join(wd, "lv")
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r", "%.4f" % dpi,
                            "-cropbox", "-singlefile", src, base],
                           capture_output=True, timeout=3600, check=True)
            with open(base + ".ppm", "rb") as f:
                head = []
                while len(head) < 4:
                    line = f.readline()
                    if not line:
                        raise RuntimeError("short picture from pdftoppm")
                    if line.startswith(b"#"):
                        continue
                    head += line.split()
                if head[0] != b"P6":
                    raise RuntimeError("unexpected picture from pdftoppm")
                W, H = int(head[1]), int(head[2])
                nx, ny = (W + T - 1) // T, (H + T - 1) // T
                idx = []
                for ty in range(ny):
                    rn = min(T, H - ty * T)
                    strip = f.read(rn * W * 3)
                    for tx in range(nx):
                        cw = min(T, W - tx * T)
                        a = tx * T * 3
                        rows = [strip[r * W * 3 + a: r * W * 3 + a + cw * 3] for r in range(rn)]
                        tile = b"".join(rows)
                        if not tile.strip(b"\xff"):
                            idx.append(0)            # all white: nothing to fetch
                            blanks += 1
                            continue
                        data = enc(cw, rn, tile) if enc else _png(cw, rn, rows)
                        out.write(data)
                        idx.append([offset, len(data)])
                        offset += len(data)
                        count += 1
            os.remove(base + ".ppm")
            levels.append({"dpi": round(dpi, 4), "px": [W, H], "nx": nx, "ny": ny, "tiles": idx})
    os.replace(bin_path + ".part", bin_path)
    meta = {"v": SHEET_TILE_VERSION, "w": w_pt, "h": h_pt, "tile": T, "fmt": fmt,
            "bin": os.path.basename(bin_path), "bytes": offset, "pdf_bytes": os.path.getsize(src),
            "levels": levels, "made_s": round(time.time() - t0, 1)}
    with open(meta_path + ".part", "w", encoding="utf-8") as fm:
        json.dump(meta, fm, separators=(",", ":"))
    os.replace(meta_path + ".part", meta_path)
    # the pictures of earlier versions of this sheet go
    stem = os.path.basename(meta_path).rsplit(".", 4)[0]
    d = os.path.dirname(meta_path)
    for old in os.listdir(d):
        if old.startswith(stem + ".") and ".stiles." in old and old not in (os.path.basename(meta_path), os.path.basename(bin_path)):
            try:
                os.remove(os.path.join(d, old))
            except OSError:
                pass
    return count, blanks, offset, time.time() - t0


def sheet_words(src, page):
    """The words printed on a sheet and where (points from the top left),
    read here with poppler - so search, and links between sheets, need no
    browser to read the PDF itself."""
    import html as _html
    out = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), "-bbox", src, "-"],
                         capture_output=True, text=True, timeout=600).stdout
    words, lines, last = [], [], None
    for m in re.finditer(r'<word xMin="([-\d.]+)" yMin="([-\d.]+)" xMax="([-\d.]+)" yMax="([-\d.]+)">(.*?)</word>', out):
        x0, y0, x1, y1 = (float(v) for v in m.groups()[:4])
        t = _html.unescape(m.group(5))
        if not t.strip():
            continue
        words.append([t, round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)])
        key = round(y1)
        if last is not None and abs(key - last) > 2:
            lines.append("\n")
        lines.append(t + " ")
        last = key
    return words, "".join(lines)


def write_sheet_words(root, rel, page, src):
    _, out = _preview_path(root, rel, page, "txt.json")
    if not out or not shutil.which("pdftotext"):
        return 0
    try:
        with open(out, encoding="utf-8") as f:
            had = json.load(f)
        if had.get("words"):
            return len(had["words"])           # read already (here, or by OCR)
    except (OSError, ValueError):
        pass
    words, text = sheet_words(src, page)
    _WORDS_OK.add(out)
    if not words:
        return 0                               # a scan: OCR's work
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + ".part", "w", encoding="utf-8") as f:
        json.dump({"text": text, "ocr": False, "words": words}, f, ensure_ascii=False)
    os.replace(out + ".part", out)
    return len(words)


def _sheet_worker():
    while True:
        with SHEETQ["cv"]:
            while not SHEETQ["q"]:
                SHEETQ["cv"].wait()
            key, job = SHEETQ["q"].popleft()
            SHEETQ["working"] = key
        try:
            job()
        except Exception as ex:
            bg_log("sheet pictures %s failed: %s" % (key, ex))
        finally:
            with SHEETQ["cv"]:
                SHEETQ["pending"].discard(key)
                SHEETQ["working"] = None


_WORDS_OK = set()


def _words_done(root, rel, page):
    """Has this sheet's text (with word places) been read here? Checked
    once per sheet and server run."""
    _, out = _preview_path(root, rel, page, "txt.json")
    if not out or out in _WORDS_OK:
        return True
    try:
        with open(out, encoding="utf-8") as f:
            if json.load(f).get("words") is not None:
                _WORDS_OK.add(out)
                return True
    except (OSError, ValueError):
        pass
    return not shutil.which("pdftotext")


def queue_sheet_tiles(root, rel, page=1, first=False):
    """Draw one sheet's pictures in the background. first=True: someone is
    looking at it now, so it goes to the front of the queue."""
    if not shutil.which("pdftoppm"):
        return "unavailable"
    src, meta, binp = _tiles_paths(root, rel, page)
    if not meta:
        return "unavailable"
    if os.path.isfile(meta) and _words_done(root, rel, page):
        return "ready"
    key = meta
    with SHEETQ["cv"]:
        if key == SHEETQ["working"]:
            return "working"
        if key in SHEETQ["pending"]:
            if first:              # to the front
                for i, (k, j) in enumerate(SHEETQ["q"]):
                    if k == key:
                        del SHEETQ["q"][i]
                        SHEETQ["q"].appendleft((k, j))
                        break
            return "queued"

        def run():
            if not os.path.isfile(src):
                return
            try:
                write_sheet_words(root, rel, page, src)
            except Exception as ex:
                bg_log("sheet words %s p%d not read: %s" % (rel, page, ex))
            if os.path.isfile(meta):
                return
            os.makedirs(os.path.dirname(meta), exist_ok=True)
            n, blank, size, secs = make_sheet_tiles(src, page, meta, binp)
            bg_log("sheet pictures %s p%d: %d pictures (%d blank), %.1f MB, %.0f s"
                   % (rel, page, n, blank, size / 1e6, secs))
        SHEETQ["pending"].add(key)
        (SHEETQ["q"].appendleft if first else SHEETQ["q"].append)((key, run))
        if SHEETQ["thread"] is None:
            SHEETQ["thread"] = threading.Thread(target=_sheet_worker, daemon=True)
            SHEETQ["thread"].start()
        SHEETQ["cv"].notify()
    return "queued"


def queue_all_sheet_tiles(root, rels):
    for rel in rels:
        if not rel.lower().endswith(".pdf"):
            continue
        src = os.path.join(root, *rel.split("/"))
        if not os.path.isfile(src):
            continue
        for page in range(1, min(pdf_pages(src), 30) + 1):
            queue_sheet_tiles(root, rel, page)


@app.get("/api/sheet-tiles")
async def get_sheet_tiles(request: Request, pdf: str = "", project: str = "", page: int = 1):
    pid = "default" if CFG["single"] else project
    require_project(request, pid, "viewer")
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    src, meta, _ = _tiles_paths(root, pdf, page)
    if not meta or not os.path.isfile(src):
        raise HTTPException(status_code=404, detail="No such sheet")
    if os.path.isfile(meta):
        if not _words_done(root, pdf, page):
            queue_sheet_tiles(root, pdf, page)      # its words, with where they are
        with open(meta, encoding="utf-8") as f:
            m = json.load(f)
        m["status"] = "ready"
        m["path"] = PREVIEW_DIR + "/" + m["bin"]
        return JSONResponse(m, headers={"Cache-Control": "private, no-cache"})
    st = queue_sheet_tiles(root, pdf, page, first=True)
    with SHEETQ["cv"]:
        waiting = len(SHEETQ["q"])
    return {"status": st, "waiting": waiting, "pdf_bytes": os.path.getsize(src)}


# ---------------------------------------------------- text of every sheet
#
# Searching all the drawings needs the words on each. The first computer to
# read a sheet's PDF sends its text back; kept per version of the PDF next
# to the pictures (_previews/<pdf>.p<page>.<size>-<time>.txt.json).

@app.get("/api/sheet-text")
async def get_sheet_text(request: Request, pdf: str = "", project: str = "", page: int = 1):
    pid = "default" if CFG["single"] else project
    require_project(request, pid, "viewer")
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    _, out = _preview_path(root, pdf, page, "txt.json")
    if not out or not os.path.isfile(out):
        return JSONResponse({"text": None})
    return FileResponse(out, media_type="application/json",
                        headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/sheet-text")
async def put_sheet_text(request: Request, pdf: str = "", page: int = 1,
                         x_viewer_token: str = Header(default=""),
                         x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    src, out = _preview_path(root, pdf, page, "txt.json")
    if not out:
        raise HTTPException(status_code=400, detail="pdf must be sheets/<name>.pdf")
    data = await request.body()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Too large")
    try:
        body = json.loads(data.decode("utf-8"))
        text = str(body.get("text") or "")
    except Exception:
        raise HTTPException(status_code=400, detail="Expected {text}")
    try:
        with open(out, encoding="utf-8") as f:
            had = json.load(f)
        if had.get("ocr") and len(text.strip()) < len((had.get("text") or "").strip()):
            return {"ok": True, "kept": "ocr"}      # the server's reading of a scan stays
        if had.get("words"):
            return {"ok": True, "kept": "server"}   # read here, with where each word is
    except (OSError, ValueError):
        pass
    os.makedirs(os.path.dirname(out), exist_ok=True)
    stem = os.path.basename(out).rsplit(".", 3)[0]
    for old in os.listdir(os.path.dirname(out)):
        if old.startswith(stem + ".") and old.endswith(".txt.json") and old != os.path.basename(out):
            try:
                os.remove(os.path.join(os.path.dirname(out), old))
            except OSError:
                pass
    with open(out + ".part", "w", encoding="utf-8") as f:
        json.dump({"text": text}, f, ensure_ascii=False)
    os.replace(out + ".part", out)
    return {"ok": True, "chars": len(text)}


# ------------------------------------------------------- issue templates
#
# Ready-made issues for what a team raises again and again ("Fire rating
# missing", "Clash with services") - title, description, type, priority,
# who it goes to and how many days until due. Kept per project.

TEMPLATES = "issue_templates.json"


@app.get("/api/templates")
async def get_templates(request: Request, x_viewer_token: str = Header(default=""),
                        x_project: str = Header(default="")):
    require_project(request, x_project, "viewer", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    try:
        with open(os.path.join(root, TEMPLATES), encoding="utf-8") as f:
            return {"templates": json.load(f).get("templates") or []}
    except (OSError, ValueError):
        return {"templates": []}


@app.post("/api/templates")
async def put_templates(request: Request, x_viewer_token: str = Header(default=""),
                        x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_dir("default" if CFG["single"] else x_project)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    body = await request.json() or {}
    items = body.get("templates")
    if not isinstance(items, list) or len(items) > 200:
        raise HTTPException(status_code=400, detail="templates must be a list (200 at most)")
    keep = []
    for t in items:
        if not isinstance(t, dict) or not str(t.get("name") or "").strip():
            continue
        keep.append({k: (str(t.get(k))[:2000] if t.get(k) is not None else None)
                     for k in ("name", "title", "description", "type", "priority", "assigned_to", "due_days")})
    p = os.path.join(root, TEMPLATES)
    with open(p + ".part", "w", encoding="utf-8") as f:
        json.dump({"templates": keep}, f, ensure_ascii=False, indent=1)
    os.replace(p + ".part", p)
    return {"templates": keep}


# ------------------------------------------------------- weekly digest
#
# Once a week (Monday 09:00 Hong Kong time unless set otherwise on the Admin
# page), each project with a Teams channel gets one card: raised and closed
# in the last seven days, what is open, what is overdue and who holds most.
# The Dashboard shows the same numbers and can send it at any time.

DIGEST_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _parse_when(v):
    if not v:
        return None
    if isinstance(v, (int, float)):
        return float(v) / (1000.0 if v > 1e11 else 1.0)
    try:
        v = str(v).replace("Z", "+00:00")
        from datetime import datetime, timezone
        d = datetime.fromisoformat(v if "T" in v else v + "T00:00:00+00:00")
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except Exception:
        return None


def digest_for(pid, days=7):
    now = time.time()
    since = now - days * 86400
    today = time.strftime("%Y-%m-%d", time.gmtime(now + 8 * 3600))
    items = [it for it in store_for(pid).all_items()[1] if it.get("issue") and not it.get("deleted")]
    done = ("Resolved", "Closed")
    raised = [it for it in items if (_parse_when(it["issue"].get("created_at") or it.get("created_at")) or 0) >= since]
    closed = [it for it in items if (it["issue"].get("status") in done)
              and (_parse_when(it.get("updated_at")) or 0) >= since]
    open_ = [it for it in items if it["issue"].get("status") not in done and it["issue"].get("status") != "Not an issue"]
    overdue = [it for it in open_ if (it["issue"].get("due_date") or "9999") < today]
    by_person = {}
    for it in open_:
        k = it["issue"].get("assigned_to") or "Unassigned"
        by_person[k] = by_person.get(k, 0) + 1

    def brief(it):
        i = it["issue"]
        return {"id": it["id"], "number": i.get("number"), "title": i.get("title") or "Issue",
                "assigned_to": i.get("assigned_to") or "", "due_date": i.get("due_date") or "",
                "status": i.get("status") or "Open", "sheet": it.get("sheet") or ""}
    overdue.sort(key=lambda it: it["issue"].get("due_date") or "")
    return {"project": pid, "days": days, "raised": len(raised), "closed": len(closed),
            "open": len(open_), "overdue": len(overdue),
            "by_person": sorted(by_person.items(), key=lambda kv: -kv[1])[:6],
            "overdue_list": [brief(it) for it in overdue[:8]],
            "raised_list": [brief(it) for it in sorted(raised, key=lambda it: it.get("created_at") or "", reverse=True)[:8]]}


def digest_card(pid, d, base):
    title = "Weekly issues - %s" % pid
    facts = [{"title": k, "value": str(v)} for k, v in (
        ("Raised this week", d["raised"]), ("Closed this week", d["closed"]),
        ("Open now", d["open"]), ("Overdue", d["overdue"]))]
    body = [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
            {"type": "FactSet", "facts": facts}]
    if d["by_person"]:
        body.append({"type": "TextBlock", "text": "Open by person: " + ", ".join(
            "%s %d" % (k, n) for k, n in d["by_person"]), "wrap": True})
    if d["overdue_list"]:
        body.append({"type": "TextBlock", "text": "Overdue", "weight": "Bolder", "wrap": True})
        for o in d["overdue_list"]:
            body.append({"type": "TextBlock", "wrap": True, "spacing": "None", "text": "#%s %s - %s, due %s" % (
                o["number"] or "?", o["title"], o["assigned_to"] or "unassigned", o["due_date"])})
    content = {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard",
               "version": "1.4", "body": body,
               "actions": [{"type": "Action.OpenUrl", "title": "Open the dashboard",
                            "url": "%sdashboard.html?project=%s" % (base or "", pid)}]}
    return {"type": "message", "attachments": [{
        "contentType": "application/vnd.microsoft.card.adaptive", "content": content}]}


@app.get("/api/digest")
async def get_digest(request: Request, days: int = 7, x_viewer_token: str = Header(default=""),
                     x_project: str = Header(default="")):
    require_project(request, x_project, "viewer", x_viewer_token)
    d = digest_for("default" if CFG["single"] else x_project, max(1, min(90, days)))
    d["teams"] = bool(accounts_on() and ACC.setting(x_project, "teams_webhook"))
    return d


@app.post("/api/digest/send")
async def send_digest(request: Request, x_viewer_token: str = Header(default=""),
                      x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    if not accounts_on():
        raise HTTPException(status_code=400, detail="Teams posting needs accounts switched on")
    url = ACC.setting(x_project, "teams_webhook")
    if not url:
        raise HTTPException(status_code=400, detail="This project has no Teams channel (Admin page)")
    CFG["base_url"] = str(request.base_url)
    try:
        post_json(url, digest_card(x_project, digest_for(x_project), CFG["base_url"]))
    except Exception as ex:
        raise HTTPException(status_code=502, detail="Teams did not accept it: %s" % ex)
    return {"ok": True}


def digest_loop():
    """Every 20 minutes: is it digest time for a project that has not had
    this week's yet?"""
    while True:
        time.sleep(1200)
        try:
            if not accounts_on() or CFG["single"]:
                continue
            for p in list_projects():
                pid = p["id"] if isinstance(p, dict) else p[0]
                try:
                    tz0 = float(ACC.setting(pid, "digest_tz") or 8)
                    loc0 = time.gmtime(time.time() + tz0 * 3600)
                    today = time.strftime("%Y-%m-%d", loc0)
                    if loc0.tm_hour >= 9 and ACC.setting(pid, "due_last") != today:
                        ACC.set_setting(pid, "due_last", today)
                        due_reminders(pid, CFG.get("base_url") or "")
                except Exception as ex:
                    print("due reminders %s: %s" % (pid, ex))
                url = ACC.setting(pid, "teams_webhook")
                day = (ACC.setting(pid, "digest_day") or "mon").lower()
                if not url or day not in DIGEST_DAYS:
                    continue
                hour = int(ACC.setting(pid, "digest_hour") or 9)
                tz = float(ACC.setting(pid, "digest_tz") or 8)
                local = time.gmtime(time.time() + tz * 3600)
                if DIGEST_DAYS[local.tm_wday] != day or local.tm_hour < hour:
                    continue
                week = time.strftime("%G-W%V", local)
                if ACC.setting(pid, "digest_last") == week:
                    continue
                ACC.set_setting(pid, "digest_last", week)
                try:
                    post_json(url, digest_card(pid, digest_for(pid), CFG.get("base_url") or ""))
                except Exception as ex:
                    print("digest %s: %s" % (pid, ex))
        except Exception as ex:
            print("digest loop: %s" % ex)


# ------------------------------------------------ background work
#
# One worker, one job at a time: making the phone copies of a project's
# fast 3D models (tools/mobile.mjs, needs Node.js) and reading scanned
# drawings (OCR, needs Tesseract). Neither holds up an upload or a page;
# when the tool is missing the job is skipped and the viewer does the phone
# copies on the first computer that opens the project, as before.

import queue as _queue
import subprocess
import threading

BG = {"q": _queue.Queue(), "thread": None, "pending": set(), "log": []}


def _bg_worker():
    while True:
        key, fn = BG["q"].get()
        try:
            fn()
        except Exception as ex:
            bg_log("%s failed: %s" % (key, ex))
        finally:
            BG["pending"].discard(key)


def bg_log(line):
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    BG["log"].append("%s %s" % (stamp, line))
    del BG["log"][:-300]
    print("bg: %s" % line)


def bg(key, fn):
    """Queue a job once (a second request for the same key while it waits
    is dropped)."""
    if key in BG["pending"]:
        return False
    BG["pending"].add(key)
    if BG["thread"] is None:
        BG["thread"] = threading.Thread(target=_bg_worker, daemon=True)
        BG["thread"].start()
    BG["q"].put((key, fn))
    return True


def node_bin():
    return shutil.which(os.environ.get("LWK_NODE") or "node")


def queue_phone_copies(root, pid, force=False):
    node = node_bin()
    if not node:
        bg_log("%s: Node.js not installed - phone copies left to the first computer" % pid)
        return False
    script = os.path.join(HERE, "tools", "mobile.mjs")

    tiles = os.path.join(HERE, "tools", "tiles.mjs")

    def run():
        t0 = time.time()
        cmd = [node, script, root] + (["--force"] if force else [])
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=3 * 3600)
        for line in (r.stdout or "").splitlines()[-40:]:
            bg_log("%s: %s" % (pid, line))
        if r.returncode:
            bg_log("%s: phone copies failed: %s" % (pid, (r.stderr or "")[-800:]))
        else:
            bg_log("%s: phone copies done in %.0f s" % (pid, time.time() - t0))
        # then the streamed form (tiles), which uses the outside list just made
        if os.path.isfile(tiles):
            t1 = time.time()
            r = subprocess.run([node, "--max-old-space-size=6144", tiles, root] + (["--force"] if force else []),
                               capture_output=True, text=True, timeout=3 * 3600)
            for line in (r.stdout or "").splitlines()[-40:]:
                bg_log("%s: %s" % (pid, line))
            if r.returncode:
                bg_log("%s: tiles failed: %s" % (pid, (r.stderr or "")[-800:]))
            else:
                bg_log("%s: tiles done in %.0f s" % (pid, time.time() - t1))
    return bg("phone:" + pid, run)


_prep_asked = {}


@app.post("/api/prepare")
async def prepare_for_phones(request: Request, project: str = "", x_viewer_token: str = Header(default="")):
    """A phone or tablet found a model not prepared for it (no tiles yet):
    any member may ask for the background work, at most every ten minutes
    per project. The work skips what is already up to date."""
    pid = project or request.headers.get("x-project", "")
    require_project(request, pid, "viewer", x_viewer_token)
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    if not node_bin():
        return {"queued": False, "why": "Node.js is not installed on the server"}
    now = time.time()
    if now - _prep_asked.get(pid, 0) < 600:
        return {"queued": False, "why": "asked already"}
    _prep_asked[pid] = now
    bg_log("%s: a phone or tablet asked for it to be prepared" % pid)
    return {"queued": queue_phone_copies(root, pid, False)}


@app.post("/api/admin/projects/{pid}/phone-copies")
async def make_phone_copies(request: Request, pid: str, force: int = 0,
                            x_viewer_token: str = Header(default="")):
    require_project(request, pid, "admin", x_viewer_token)
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project")
    # every sheet drawn as pictures too (big drawings, slow lines)
    try:
        with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
            rels = [s.get("pdf") for s in (json.load(f).get("sheets") or []) if s.get("pdf")]
        rels += [s.get("pdf") for s in (read_imported(root) or []) if s.get("pdf")]
        queue_all_sheet_tiles(root, sorted(set(rels)))
    except Exception as ex:
        bg_log("%s: sheet pictures not queued: %s" % (pid, ex))
    if not node_bin():
        raise HTTPException(status_code=400, detail="Node.js is not installed on the server")
    return {"queued": queue_phone_copies(root, pid, bool(force))}


@app.get("/api/admin/background")
async def background_log(request: Request, x_viewer_token: str = Header(default="")):
    """What the background worker did lately (for the Admin page)."""
    if accounts_on():
        w = who(request, x_viewer_token)
        if not (w and getattr(w, "site_admin", False)):
            raise HTTPException(status_code=403, detail="Site admins only")
    else:
        require_request(request, x_viewer_token)
    with SHEETQ["cv"]:
        sheets_waiting = len(SHEETQ["q"])
        sheet_now = SHEETQ["working"]
    pending = sorted(BG["pending"])
    if sheet_now or sheets_waiting:
        pending.append("sheet pictures: %s%d waiting" % (
            ("drawing " + os.path.basename(sheet_now).split(".stiles")[0] + ", ") if sheet_now else "", sheets_waiting))
    return {"pending": pending, "log": BG["log"][-100:],
            "node": bool(node_bin()), "tesseract": bool(shutil.which("tesseract")),
            "pdftoppm": bool(shutil.which("pdftoppm"))}


# ---------------------------------------------------------------- OCR
#
# A scanned drawing (or one printed to PDF as lines) has no words in it to
# search. Such pages are drawn at 200 dpi and read by Tesseract (English
# and, when installed, Traditional Chinese); the words and where they are
# go into the sheet's text file (the one the viewer's "search all sheets"
# reads), so they can be found and marked like any other.
#   sudo apt install -y poppler-utils tesseract-ocr tesseract-ocr-chi-tra

OCR_DPI = 200
OCR_MIN_TEXT = 30          # a page with fewer characters than this counts as a scan


def ocr_langs():
    try:
        r = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=20)
        have = set((r.stdout + r.stderr).split())
    except Exception:
        return None
    langs = [l for l in ("eng", "chi_tra", "chi_sim") if l in have]
    return "+".join(langs) if langs else None


def pdf_pages(pdf):
    try:
        r = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True, timeout=60)
        m = re.search(r"^Pages:\s+(\d+)", r.stdout, re.M)
        return int(m.group(1)) if m else 1
    except Exception:
        return 1


def ocr_page(pdf, page, langs, workdir):
    """[(text, x, y_top, w, h)] in PDF points from the top left, and the text."""
    prefix = os.path.join(workdir, "p")
    subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(OCR_DPI), "-gray", "-png",
                    pdf, prefix], check=True, timeout=600, capture_output=True)
    imgs = sorted(f for f in os.listdir(workdir) if f.startswith("p") and f.endswith(".png"))
    if not imgs:
        return [], ""
    img = os.path.join(workdir, imgs[-1])
    r = subprocess.run(["tesseract", img, "stdout", "-l", langs, "--psm", "11", "tsv"],
                       capture_output=True, text=True, timeout=1800)
    for f in imgs:
        try:
            os.remove(os.path.join(workdir, f))
        except OSError:
            pass
    k = 72.0 / OCR_DPI
    words, lines, last = [], [], None
    for row in r.stdout.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or c[0] != "5":
            continue
        txt = c[11].strip()
        try:
            conf = float(c[10])
        except ValueError:
            conf = -1
        if not txt or conf < 35:
            continue
        x, y, w, h = (int(c[6]), int(c[7]), int(c[8]), int(c[9]))
        words.append([txt, round(x * k, 1), round(y * k, 1), round(w * k, 1), round(h * k, 1)])
        key = (c[2], c[3], c[4])
        if key != last and lines:
            lines.append("\n")
        lines.append(txt + " ")
        last = key
    return words, "".join(lines)


def queue_ocr(root, pdfs):
    if not (shutil.which("tesseract") and shutil.which("pdftoppm") and shutil.which("pdftotext")):
        return False
    langs = ocr_langs()
    if not langs:
        return False
    import tempfile

    def run():
        for rel in pdfs:
            src = os.path.join(root, *rel.split("/"))
            if not os.path.isfile(src):
                continue
            for page in range(1, min(pdf_pages(src), 60) + 1):
                _, out = _preview_path(root, rel, page, "txt.json")
                if not out:
                    continue
                try:
                    with open(out, encoding="utf-8") as f:
                        if len((json.load(f).get("text") or "").strip()) >= OCR_MIN_TEXT:
                            continue          # already has words
                except (OSError, ValueError):
                    pass
                t = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), src, "-"],
                                   capture_output=True, text=True, timeout=120).stdout
                if len(t.strip()) >= OCR_MIN_TEXT:
                    continue                  # real text: the viewer reads it itself
                t0 = time.time()
                with tempfile.TemporaryDirectory() as wd:
                    words, text = ocr_page(src, page, langs, wd)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out + ".part", "w", encoding="utf-8") as f:
                    json.dump({"text": text, "ocr": True, "words": words}, f, ensure_ascii=False)
                os.replace(out + ".part", out)
                bg_log("OCR %s p%d: %d words in %.0f s" % (rel, page, len(words), time.time() - t0))
    return bg("ocr:" + root + ":" + ",".join(pdfs)[:200], run)


# ------------------------------------------------------- markup layers
#
# A project admin can say, per markup layer: who may draw on it and change
# what is on it (everyone / project admins / chosen members), who may see
# it at all (everyone / chosen members), and whether it starts hidden.
# Kept in <project>/layer_settings.json. Only with accounts: a passphrase
# has no people to tell apart.

LAYER_FILE = "layer_settings.json"


def layer_settings(pid):
    root = project_dir("default" if CFG["single"] else pid)
    try:
        with open(os.path.join(root, LAYER_FILE), encoding="utf-8") as f:
            return json.load(f).get("layers") or {}
    except (OSError, ValueError, TypeError):
        return {}


def _layer_of(item):
    return (item or {}).get("layer") or "General"


def layer_can(pid, w, role, layer, what):
    """what: "edit" or "see"."""
    if not accounts_on() or role == "admin":
        return True
    st = layer_settings(pid).get(layer) or {}
    if what == "see":
        if st.get("see") != "list":
            return True
        return w.uid in (st.get("viewers") or [])
    mode = st.get("edit") or "all"
    if mode == "all":
        return True
    if mode == "admins":
        return False
    return w.uid in (st.get("editors") or [])


GEOMETRY_KEYS = ("points_mm", "type", "text", "style", "rot", "layer", "sheet", "stamp", "href")


def check_layer_edit(pid, w, role, prev, item):
    """Drawing on, moving, restyling or deleting a markup on a locked layer
    is refused; answering its issue (status, comments) is not."""
    if not accounts_on() or role == "admin":
        return
    for it in (prev, item):
        if not it:
            continue
        layer = _layer_of(it)
        if layer_can(pid, w, role, layer, "edit"):
            continue
        if prev and item and all(prev.get(k) == item.get(k) for k in GEOMETRY_KEYS):
            continue
        raise HTTPException(status_code=403, detail='The layer "%s" is locked for you' % layer)


@app.get("/api/layers")
async def get_layers(request: Request, x_viewer_token: str = Header(default=""),
                     x_project: str = Header(default="")):
    w, role = require_project(request, x_project, "viewer", x_viewer_token)
    st = layer_settings(x_project)
    mine = {name: {"edit": layer_can(x_project, w, role, name, "edit"),
                   "see": layer_can(x_project, w, role, name, "see")} for name in st}
    return {"layers": st if role == "admin" else {k: {"hidden_default": bool(v.get("hidden_default")),
                                                       "edit": v.get("edit") or "all",
                                                       "see": v.get("see") or "all"} for k, v in st.items()},
            "mine": mine, "admin": role == "admin", "accounts": accounts_on()}


@app.put("/api/layers")
async def put_layers(request: Request, x_viewer_token: str = Header(default=""),
                     x_project: str = Header(default="")):
    require_project(request, x_project, "admin", x_viewer_token)
    body = await request.json() or {}
    layers = body.get("layers")
    if not isinstance(layers, dict) or len(layers) > 200:
        raise HTTPException(status_code=400, detail="layers must be an object")
    clean = {}
    for name, v in layers.items():
        name = str(name).strip()[:80]
        if not name or not isinstance(v, dict):
            continue
        clean[name] = {
            "edit": v.get("edit") if v.get("edit") in ("all", "admins", "list") else "all",
            "editors": [int(x) for x in (v.get("editors") or []) if str(x).isdigit()][:500],
            "see": v.get("see") if v.get("see") in ("all", "list") else "all",
            "viewers": [int(x) for x in (v.get("viewers") or []) if str(x).isdigit()][:500],
            "hidden_default": bool(v.get("hidden_default")),
        }
    root = project_dir("default" if CFG["single"] else x_project)
    p = os.path.join(root, LAYER_FILE)
    with open(p + ".part", "w", encoding="utf-8") as f:
        json.dump({"layers": clean}, f, ensure_ascii=False, indent=1)
    os.replace(p + ".part", p)
    return {"layers": clean}


# ----------------------------------------------------------- snapshots

SAFE_NAME = re.compile(r"^[0-9a-f]{8,40}\.(jpg|png)$")


@app.post("/api/snapshots")
async def put_snapshot(request: Request,
                       x_viewer_token: str = Header(default="")):
    who(request, x_viewer_token)
    """Snapshots are files, not database rows and not browser storage.

    A single markup snapshot is 150-300 kB. Browser localStorage caps out
    around 5 MB, which is why the viewer could only hold a dozen or so
    issues before saving began to fail silently.
    """
    body = await request.json()
    url = (body or {}).get("data_url") or ""
    m = re.match(r"^data:image/(png|jpe?g);base64,(.+)$", url, re.I)
    if not m:
        raise HTTPException(status_code=400,
                            detail="Expected a png or jpeg data URL")

    ext = "png" if m.group(1).lower() == "png" else "jpg"
    raw = base64.b64decode(m.group(2))
    name = "%s.%s" % (uuid.uuid4().hex, ext)
    with open(os.path.join(CFG["snapshots"], name), "wb") as f:
        f.write(raw)
    return {"path": "/snapshots/" + name, "bytes": len(raw)}


@app.get("/snapshots/{name}")
async def get_snapshot(name: str, request: Request):
    require_request(request)
    if not SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail="Bad name")
    path = os.path.join(CFG["snapshots"], name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)


# -------------------------------------------------- export folder + app

# ------------------------------------------------------ imported PDFs

IMPORTED = "imported_sheets.json"


def project_root_for(pid):
    root = project_dir(pid)
    if not root:
        raise HTTPException(status_code=404, detail="No such project: %s" % pid)
    return root


def read_imported(root):
    p = os.path.join(root, IMPORTED)
    if not os.path.isfile(p):
        return []
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("sheets", [])
    except Exception:
        return []


def write_imported(root, sheets):
    """Written beside manifest.json, never into it. Re-exporting from Revit
    rewrites the manifest from scratch; sheets kept in it would vanish on
    every export. Kept apart, they survive, and the server merges the two
    whenever the manifest is asked for."""
    p = os.path.join(root, IMPORTED)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"sheets": sheets}, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


SAFE_FILE = re.compile(r"[^A-Za-z0-9._-]+")


@app.post("/api/import/pdf")
async def import_pdf(request: Request, name: str = "drawing.pdf",
                     x_viewer_token: str = Header(default=""),
                     x_project: str = Header(default="")):
    """Store a PDF made elsewhere - a consultant's drawing, a scan - in the
    project. The body is the file itself, so a 60 MB drawing is not
    inflated by a third through base64."""
    require_project(request, x_project, "member", x_viewer_token)
    root = project_root_for(x_project)
    body = await request.body()
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="That file is not a PDF.")
    folder = os.path.join(root, "imported")
    if not os.path.isdir(folder):
        os.makedirs(folder)
    stem = SAFE_FILE.sub("_", os.path.splitext(os.path.basename(name))[0])[:60] or "drawing"
    fname = "%s-%s.pdf" % (stem, uuid.uuid4().hex[:8])
    with open(os.path.join(folder, fname), "wb") as f:
        f.write(body)
    queue_ocr(root, ["imported/" + fname])
    return {"pdf": "imported/" + fname, "bytes": len(body)}


@app.post("/api/import/sheets")
async def import_sheets(request: Request, x_viewer_token: str = Header(default=""),
                        x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_root_for(x_project)
    body = await request.json() or {}
    incoming = body.get("sheets") or []
    # The set the drawings go in: their own entry in the Sheets page's
    # drop-down, apart from the sheets published from Revit.
    set_name = re.sub(r"[\x00-\x1f\x7f]+", " ", str(body.get("set") or "")).strip()[:60] or "Uploaded PDFs"
    have = read_imported(root)
    taken = {s.get("number") for s in have}
    try:
        with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
            taken |= {s.get("number") for s in json.load(f).get("sheets", [])}
    except Exception:
        pass
    added = []
    for sh in incoming:
        pdf = str(sh.get("pdf") or "")
        if not pdf.startswith("imported/") or ".." in pdf:
            continue
        num = str(sh.get("number") or "").strip()[:40] or "IMPORT"
        # Sheet numbers must stay unique, or a markup could not say which
        # sheet it belongs to.
        base, k = num, 2
        while num in taken:
            num = "%s (%d)" % (base, k); k += 1
        taken.add(num)
        rec = {"number": num, "name": str(sh.get("name") or "")[:120],
               "pdf": pdf, "page": int(sh.get("page") or 1),
               "external": True, "set": set_name, "viewports": []}
        have.append(rec)
        added.append(rec)
    write_imported(root, have)
    return {"added": added}


@app.delete("/api/import/sheets/{number}")
async def remove_imported(request: Request, number: str,
                          x_viewer_token: str = Header(default=""),
                          x_project: str = Header(default="")):
    require_project(request, x_project, "member", x_viewer_token)
    root = project_root_for(x_project)
    have = read_imported(root)
    keep = [s for s in have if s.get("number") != number]
    if len(keep) == len(have):
        raise HTTPException(status_code=404, detail="No imported sheet " + number)
    write_imported(root, keep)
    return {"removed": number}


@app.api_route("/data/{path:path}", methods=["GET", "HEAD"])
async def get_data(path: str, request: Request):
    """Project files: manifest.json, fragments and sheet PDFs.

    The first part of the path names the project - /data/<project>/sheets/
    A005.pdf. Serving from the same origin as the viewer removes every CORS
    question, and means a colleague needs nothing beyond a browser.
    """
    if CFG["single"]:
        require_project(request, "default", "viewer")
        # The old one-project form: /data/<file>, or /data/default/<file>.
        rel = path[len("default/"):] if path.startswith("default/") else path
        root = CFG["single"]
    else:
        pid, _, rel = path.partition("/")
        root = project_dir(pid)
        if not root:
            raise HTTPException(status_code=404, detail="No such project: " + pid)
        require_project(request, pid, "viewer")

    root = os.path.normpath(root)
    target = os.path.normpath(os.path.join(root, rel))
    if target != root and not target.startswith(root + os.sep):
        raise HTTPException(status_code=400, detail="Outside the project folder")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Not found: " + path)

    if os.path.basename(target) == "manifest.json" and os.path.dirname(target) == root:
        try:
            with open(target, encoding="utf-8") as f:
                man = json.load(f)
        except ValueError:
            # A 0-byte manifest from an export that failed half-way used to
            # surface as a 500 and a stack trace, and a page with nothing on it.
            raise HTTPException(status_code=422, detail=(
                "manifest.json of this project is empty or damaged - "
                "the export did not finish. Export it again."))
        extra = read_imported(root)
        if extra:
            man["sheets"] = list(man.get("sheets") or []) + extra
        # which fast 3D models the server has cut into streamed tiles (made
        # after this very upload): phones and tablets stream those
        for m in man.get("models") or []:
            try:
                fr = m.get("fragments") or ""
                if m.get("format") != "lwkm" or not fr.lower().endswith(".lwkm"):
                    continue
                src = os.path.join(root, *fr.split("/"))
                tidx = src[:-5] + ".tidx"
                m["tiles"] = bool(os.path.isfile(tidx) and os.path.isfile(src[:-5] + ".tbin")
                                  and os.path.getmtime(tidx) >= os.path.getmtime(src) - 1)
            except Exception:
                pass
        # Rebuilt per request (imported sheets are added in), so always fresh.
        return JSONResponse(man, headers={"Cache-Control": "private, no-cache"})

    mime, _ = mimetypes.guess_type(target)
    if target.lower().endswith((".frag", ".lwkm", ".tidx", ".tbin", ".stb")):
        mime = "application/octet-stream"
    # A piece of a streamed model (tools/tiles.mjs): ?o=<offset>&n=<bytes>.
    # With ?v=<the model's signature> the piece never changes - a new export
    # has another signature - so the browser may keep it for good.
    q = request.query_params
    if target.lower().endswith((".tbin", ".stb")) and q.get("o") is not None:
        try:
            o, n = int(q.get("o")), int(q.get("n") or 0)
        except ValueError:
            raise HTTPException(status_code=400, detail="o and n must be numbers")
        size = os.path.getsize(target)
        if o < 0 or n <= 0 or n > 64 * 1024 * 1024 or o + n > size:
            raise HTTPException(status_code=416, detail="Outside the file")
        with open(target, "rb") as f:
            f.seek(o)
            chunk = f.read(n)
        cache = "private, max-age=31536000, immutable" if q.get("v") else "private, no-cache"
        return Response(content=chunk, media_type="application/octet-stream",
                        headers={"Cache-Control": cache})
    # Browser caching. A project's fragments are tens of MB (TP14: 65 MB),
    # so a second visit should not download them again - but after the
    # nightly export it must get the new ones straight away, never a stale
    # model. "no-cache" gives exactly that: the browser keeps its copy and
    # asks every time; unchanged files cost one tiny 304 answer instead of
    # the whole file. "private" keeps shared caches (a Cloudflare tunnel
    # caches .pdf by default) from storing files that sit behind sign-in.
    st = os.stat(target)
    etag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
    headers = {"Cache-Control": "private, no-cache", "ETag": etag}
    if etag_matches(request.headers.get("if-none-match", ""), etag):
        return Response(status_code=304, headers=headers)
    return FileResponse(target, media_type=mime or "application/octet-stream",
                        headers=headers)


def etag_matches(header, etag):
    """If-None-Match holds one or more ETags, possibly weak (W/"...")."""
    if not header:
        return False
    if header.strip() == "*":
        return True
    for tag in header.split(","):
        tag = tag.strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == etag:
            return True
    return False


def adopt_legacy(data_dir, pid):
    """Move the one-project database into a project, once.

    Before projects existed every issue lived in data/viewer.db. Which
    project those belong to cannot be worked out from the file, and a wrong
    guess would pour one job's issues into another, so the user names it.
    The old file is copied, not moved: if the name was wrong, nothing is
    lost."""
    legacy = os.path.join(data_dir, "viewer.db")
    if not os.path.isfile(legacy):
        return None
    if not project_dir(pid):
        sys.exit("--adopt %s: no project folder of that name under %s"
                 % (pid, CFG["root"]))
    dest_dir = os.path.join(data_dir, "projects", pid)
    dest = os.path.join(dest_dir, "viewer.db")
    if os.path.isfile(dest):
        return "already done"
    if not os.path.isdir(dest_dir):
        os.makedirs(dest_dir)
    import shutil
    for ext in ("", "-wal", "-shm"):
        if os.path.isfile(legacy + ext):
            shutil.copy2(legacy + ext, dest + ext)
    return "copied"


# Whiteboards (boards.py) keep their routes in their own module; it gets
# this module to reach who(), require_project(), CFG and the rest.
try:
    import boards
    boards.register(app, sys.modules[__name__])
except Exception as _ex:
    print("boards not loaded: %s" % _ex)

# Tasks (tasks.py): the team task lists, joined to issues, sheets and 3D.
try:
    import tasks
    tasks.register(app, sys.modules[__name__])
except Exception as _ex:
    print("tasks not loaded: %s" % _ex)

# Messenger (chat.py): project channels, group chats and direct messages.
try:
    import chat
    chat.register(app, sys.modules[__name__])
except Exception as _ex:
    print("chat not loaded: %s" % _ex)

# Consultant models (refs.py): IFC from other companies in the 3D view.
try:
    import refs
    refs.register(app, sys.modules[__name__])
except Exception as _ex:
    print("refs not loaded: %s" % _ex)

# Folders (files.py): each project's files, in a folder on the server.
try:
    import files
    files.register(app, sys.modules[__name__])
except Exception as _ex:
    print("files not loaded: %s" % _ex)

# Push (push.py): chat messages to phones and computers with no page open
# (needs https; the pages show them by themselves while open).
try:
    import push
    push.register(app, sys.modules[__name__])
except Exception as _ex:
    print("push not loaded: %s" % _ex)

# Calendar (calendar_feed.py): meetings, tasks and issues due, as a page and
# as a feed Outlook can subscribe to.
try:
    import calendar_feed
    calendar_feed.register(app, sys.modules[__name__])
except Exception as _ex:
    print("calendar not loaded: %s" % _ex)

# Offline copies (offline.py): the two lists a browser asks for before it
# keeps a project on the device. Read-only.
try:
    import offline
    offline.register(app, sys.modules[__name__])
except Exception as _ex:
    print("offline not loaded: %s" % _ex)


def main():
    ap = argparse.ArgumentParser(description="LWK Viewer server")
    ap.add_argument("--root", default="",
                    help="Folder holding one sub-folder per project")
    ap.add_argument("--export", default="",
                    help="One project folder (the older single-project form)")
    ap.add_argument("--adopt", default="",
                    help="Project that the issues from before projects belong to")
    ap.add_argument("--passphrase", "--pass", dest="passphrase", default="",
                    help="Shared passphrase; empty means no access control")
    ap.add_argument("--data", default=os.path.join(HERE, "data"),
                    help="Where the database and snapshots live")
    ap.add_argument("--add-admin", default="", metavar="EMAIL",
                    help="Create a site admin (switches the server to accounts) and exit")
    ap.add_argument("--admin-name", default="", help="Name for --add-admin")
    ap.add_argument("--reset-password", default="", metavar="EMAIL",
                    help="Give an account a new temporary password and exit")
    ap.add_argument("--delete-user", default="", metavar="EMAIL",
                    help="Delete an account (made by mistake) and exit")
    ap.add_argument("--port", type=int, default=8713)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--plain-assets", action="store_true",
                    default=os.environ.get("PLAIN_ASSETS", "") not in ("", "0"),
                    help="Serve the viewer's files as they are: no compression, no import map "
                         "(if a proxy in front of the server has trouble with them)")
    args = ap.parse_args()

    if not args.root and not args.export:
        sys.exit("Give --root (a folder of projects) or --export (one project).")
    if args.root:
        root = os.path.abspath(args.root)
        if not os.path.isdir(root):
            sys.exit("No such folder: %s" % root)
        CFG["root"] = root
    else:
        export = os.path.abspath(args.export)
        if not os.path.exists(os.path.join(export, "manifest.json")):
            sys.exit("No manifest.json in %s" % export)
        CFG["single"] = export
    if not os.path.isdir(VIEWER_DIR):
        sys.exit("Cannot find the viewer folder at %s" % VIEWER_DIR)

    data_dir = os.path.abspath(args.data)
    snaps = os.path.join(data_dir, "snapshots")
    for d in (data_dir, snaps):
        if not os.path.isdir(d):
            os.makedirs(d)

    # A per-installation secret, so tokens are not guessable from the
    # passphrase alone and do not change on every restart.
    secret_path = os.path.join(data_dir, "secret.bin")
    if os.path.exists(secret_path):
        with open(secret_path, "rb") as f:
            secret = f.read()
    else:
        secret = secrets.token_bytes(32)
        with open(secret_path, "wb") as f:
            f.write(secret)

    CFG.update({
        "data": data_dir,
        "passphrase": args.passphrase,
        "snapshots": snaps,
        "secret": secret,
    })

    global ACC
    ACC = Accounts(os.path.join(data_dir, "accounts.db"))
    if args.add_admin:
        try:
            u, pw = ACC.create(args.add_admin, args.admin_name or args.add_admin.split("@")[0],
                               is_admin=True)
        except ValueError as ex:
            sys.exit(str(ex))
        print("site admin created: %s <%s>" % (u["name"], u["email"]))
        print("temporary password: %s   (to be changed at first sign-in)" % pw)
        return
    if args.reset_password:
        u = ACC.by_email(args.reset_password)
        if not u:
            sys.exit("No account for %s" % args.reset_password)
        print("temporary password for %s: %s" % (u["email"], ACC.reset_password(u["id"])))
        return
    if args.delete_user:
        u = ACC.by_email(args.delete_user)
        if not u:
            sys.exit("No account for %s" % args.delete_user)
        ACC.delete(u["id"])
        print("deleted: %s <%s>" % (u["name"], u["email"]))
        return
    CFG["accounts_on"] = ACC.count() > 0
    if CFG["single"]:
        # One project: keep using the original database file in place.
        STORES["default"] = Store(os.path.join(data_dir, "viewer.db"))
    elif args.adopt:
        r = adopt_legacy(data_dir, args.adopt)
        if r == "copied":
            print("adopted : issues from before projects -> %s" % args.adopt)
    elif os.path.isfile(os.path.join(data_dir, "viewer.db")):
        print("NOTE    : %s holds issues from before projects existed."
              % os.path.join(data_dir, "viewer.db"))
        print("          Set ADOPT in run.bat to the project they belong to.")

    # Shared to the installed viewer before its service worker was there to
    # catch it (sw.js shareIn): open the Messenger, which says to share again.
    @app.post("/share-in")
    async def share_in_fallback():
        from fastapi.responses import RedirectResponse
        return RedirectResponse("messenger.html?incoming=none", status_code=303)

    # The viewer's files compressed and kept by the browser, the API's JSON
    # compressed (assets.py). Added last, so they are the outermost.
    import assets
    if not args.plain_assets:
        assets.register_json_gzip(app)
        assets.register(app, sys.modules[__name__])
    else:
        print("assets  : plain (--plain-assets)")

    # Mounted last so the API routes above take precedence over index.html.
    app.mount("/", StaticFiles(directory=VIEWER_DIR, html=True), name="viewer")

    print("viewer  : %s" % VIEWER_DIR)
    if CFG["single"]:
        print("project : %s" % CFG["single"])
    else:
        ps = list_projects()
        print("projects: %s  (%d found)" % (CFG["root"], len(ps)))
        for p in ps:
            print("          %-28s %3d sheets  %s" % (p["id"], p["sheets"], p["title"]))
    print("data    : %s" % data_dir)
    if accounts_on():
        print("access  : accounts (%d) - email and password" % ACC.count())
    else:
        print("access  : %s" % ("passphrase required" if args.passphrase
                                else "OPEN - anyone with the URL can read and write"))
    print("serving : http://127.0.0.1:%d/" % args.port)
    print("")
    print("To share it, run tunnel.bat in another window.")
    import threading
    threading.Thread(target=digest_loop, daemon=True).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
