# -*- coding: utf-8 -*-
"""Admin > Viewer update: a site admin brings this server's code up to the
newest commit of its GitHub branch, from the viewer itself.

  GET  /api/admin/update            what is installed, the newest commit, the job's log
  POST /api/admin/update            {repo?, branch?, token?} saves the settings; {go: true} updates
  POST /api/admin/update/rollback   puts the code of the last update back

The update: the branch's newest commit as a zip -> checked (server/app.py,
viewer/index.html, every server/*.py compiles) -> the current server/ and
viewer/ kept in <data>/code-backups (the last 3) -> the new files copied over
(nothing deleted; run.bat, tunnel.bat, server/data and databases left alone)
-> pip install when requirements.txt changed -> the server restarts itself
(POSIX: os.execv, same process id, so systemd carries on; Windows: the admin
starts run.bat again).
"""
import datetime
import io
import json
import os
import py_compile
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile

from fastapi import HTTPException, Request, Header

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                    # holds server/ and viewer/
PARTS = ("server", "viewer")
KEEP = {"run.bat", "tunnel.bat", "data", "__pycache__", ".env", "settings.local.json"}
KEEP_EXT = (".db", ".db-wal", ".db-shm", ".sqlite", ".log", ".pyc")
DEFAULT = {"repo": "wilsonchan0804/new-project", "branch": "claude/amazing-fermi-96v958"}

CFG = {"data": None}
JOB = {"running": False, "log": [], "error": "", "done": "", "at": 0}
LOCK = threading.Lock()
_latest = {"at": 0, "key": "", "v": None}


def _dir():
    d = os.path.join(CFG["data"] or os.path.join(HERE, "data"), "update")
    os.makedirs(d, exist_ok=True)
    return d


def settings():
    try:
        with open(os.path.join(_dir(), "update.json"), encoding="utf-8") as f:
            v = json.load(f)
    except (OSError, ValueError):
        v = {}
    return dict(DEFAULT, **{k: v[k] for k in v if v.get(k) not in (None, "")})


def _save(v):
    p = os.path.join(_dir(), "update.json")
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(v, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def _token():
    try:
        with open(os.path.join(_dir(), "token"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def can_restart():
    return os.name == "posix"


def log(msg):
    JOB["log"].append(time.strftime("%H:%M:%S ") + msg)
    JOB["log"] = JOB["log"][-200:]
    print("update: " + msg)


# ---------------------------------------------------------------- GitHub

def _get(url, accept="application/vnd.github+json"):
    h = {"Accept": accept, "User-Agent": "lwk-viewer"}
    tok = _token()
    if tok:
        h["Authorization"] = "Bearer " + tok
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
        return r.read()


def latest(force=False):
    """The branch's newest commit: {sha, date, message} (kept a minute)."""
    s = settings()
    key = s["repo"] + "@" + s["branch"]
    if not force and _latest["key"] == key and time.time() - _latest["at"] < 60:
        return _latest["v"]
    j = json.loads(_get("https://api.github.com/repos/%s/commits/%s" % (s["repo"], urllib.request.quote(s["branch"], safe=""))).decode("utf-8"))
    v = {"sha": j["sha"], "date": ((j.get("commit") or {}).get("committer") or {}).get("date", ""),
         "message": ((j.get("commit") or {}).get("message") or "").split("\n")[0][:200]}
    _latest.update(at=time.time(), key=key, v=v)
    return v


def fetch_zip(sha):
    return _get("https://api.github.com/repos/%s/zipball/%s" % (settings()["repo"], sha), accept="application/vnd.github+json")


# ----------------------------------------------------------- the update

def _kept(name):
    return name in KEEP or name.endswith(KEEP_EXT)


def _copy_tree(src, dst):
    """src over dst: files added or replaced, nothing deleted, the kept names left alone."""
    n = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if not _kept(d)]
        rel = os.path.relpath(root, src)
        out = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(out, exist_ok=True)
        for fn in files:
            if _kept(fn):
                continue
            shutil.copy2(os.path.join(root, fn), os.path.join(out, fn))
            n += 1
    return n


def backups():
    d = os.path.join(_dir(), "code-backups")
    return sorted(os.listdir(d), reverse=True) if os.path.isdir(d) else []


def _backup(tag):
    d = os.path.join(_dir(), "code-backups", time.strftime("%Y%m%d-%H%M%S") + "-" + (tag or "unknown")[:7])
    for part in PARTS:
        src = os.path.join(ROOT, part)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(d, part), ignore=lambda dirpath, names: [x for x in names if _kept(x)])
    for old in backups()[3:]:
        shutil.rmtree(os.path.join(_dir(), "code-backups", old), ignore_errors=True)
    return d


def check_tree(tree):
    if not os.path.isfile(os.path.join(tree, "server", "app.py")) or not os.path.isfile(os.path.join(tree, "viewer", "index.html")):
        raise ValueError("The download is not the viewer (no server/app.py or viewer/index.html)")
    for fn in sorted(os.listdir(os.path.join(tree, "server"))):
        if fn.endswith(".py"):
            try:
                py_compile.compile(os.path.join(tree, "server", fn), cfile=os.path.join(tempfile.gettempdir(), "lwk-check.pyc"), doraise=True)
            except py_compile.PyCompileError as ex:
                raise ValueError("server/%s does not compile: %s" % (fn, str(ex).splitlines()[-1][:200]))


def _req(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def install(data, sha, who=""):
    """A zipball of the code -> in place. Returns the number of files copied."""
    import kb
    with tempfile.TemporaryDirectory() as tmp:
        log("Unpacking ...")
        kb.safe_extract(data, tmp)
        log("Checking the new code ...")
        check_tree(tmp)
        old = (settings().get("installed") or {}).get("sha", "")
        b = _backup(old)
        log("The current code is kept in %s" % os.path.basename(b))
        req0 = _req(os.path.join(ROOT, "server", "requirements.txt"))
        n = sum(_copy_tree(os.path.join(tmp, part), os.path.join(ROOT, part)) for part in PARTS)
        log("%d files updated" % n)
        if _req(os.path.join(ROOT, "server", "requirements.txt")) != req0:
            log("requirements.txt changed - installing the Python packages ...")
            try:
                p = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", os.path.join(ROOT, "server", "requirements.txt")],
                                   capture_output=True, text=True, timeout=300)
                log("Packages installed" if p.returncode == 0 else "Packages not installed (the viewer still runs): " + (p.stderr or "").strip()[-300:])
            except Exception as ex:
                log("Packages not installed: %s" % ex)
    s = settings()
    s["installed"] = {"sha": sha, "at": datetime.datetime.now().replace(microsecond=0).isoformat(), "by": who}
    _save(s)
    return n


def restart():
    """The new code in this same process (systemd sees no stop)."""
    time.sleep(1.5)
    log("Restarting ...")
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    os.execv(sys.executable, [sys.executable] + sys.argv)


def _job(fn, *a):
    try:
        fn(*a)
    except Exception as ex:
        JOB["error"] = str(ex)[:500]
        log("Not done: %s" % JOB["error"])
    finally:
        JOB["running"] = False


def run_update(who):
    log("Asking GitHub for the newest commit of %s ..." % settings()["branch"])
    v = latest(force=True)
    log("Downloading %s - %s" % (v["sha"][:7], v["message"]))
    data = fetch_zip(v["sha"])
    install(data, v["sha"], who)
    JOB["done"] = v["sha"]
    if can_restart():
        restart()
    else:
        log("Updated to %s - close run.bat and start it again to use the new code." % v["sha"][:7])


def run_rollback(who):
    bs = backups()
    if not bs:
        raise ValueError("No earlier code kept yet")
    d = os.path.join(_dir(), "code-backups", bs[0])
    log("Putting back %s ..." % bs[0])
    n = sum(_copy_tree(os.path.join(d, part), os.path.join(ROOT, part)) for part in PARTS if os.path.isdir(os.path.join(d, part)))
    log("%d files put back" % n)
    s = settings()
    s["installed"] = {"sha": bs[0].rsplit("-", 1)[-1], "at": datetime.datetime.now().replace(microsecond=0).isoformat(), "by": who, "rolled_back": True}
    _save(s)
    shutil.rmtree(d, ignore_errors=True)
    JOB["done"] = "rollback"
    if can_restart():
        restart()
    else:
        log("Put back - close run.bat and start it again.")


def start(fn, who):
    with LOCK:
        if JOB["running"]:
            raise HTTPException(status_code=409, detail="An update is running")
        JOB.update(running=True, log=[], error="", done="", at=time.time())
    threading.Thread(target=_job, args=(fn, who), daemon=True).start()


def status():
    s = settings()
    out = {"repo": s["repo"], "branch": s["branch"], "token_set": bool(_token()), "installed": s.get("installed") or {},
           "running": JOB["running"], "log": JOB["log"], "error": JOB["error"], "done": JOB["done"],
           "can_restart": can_restart(), "backups": backups(), "latest": None, "latest_error": ""}
    try:
        out["latest"] = latest()
    except Exception as ex:
        out["latest_error"] = str(ex)[:300]
    inst = (out["installed"] or {}).get("sha", "")
    out["current"] = bool(inst and out["latest"] and out["latest"]["sha"] == inst)
    return out


def register(app, core):
    CFG["data"] = core.CFG.get("data")

    def admin(request, tok):
        w = core.who(request, tok)
        if not getattr(w, "site_admin", False):
            raise HTTPException(status_code=403, detail="Only a site admin can update the viewer")
        return w

    @app.get("/api/admin/update")
    def update_status(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        CFG["data"] = core.CFG.get("data") or CFG["data"]
        return status()

    @app.post("/api/admin/update")
    async def update_post(request: Request, x_viewer_token: str = Header(default="")):
        w = admin(request, x_viewer_token)
        CFG["data"] = core.CFG.get("data") or CFG["data"]
        try:
            body = await request.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        if any(k in body for k in ("repo", "branch", "token")):
            s = settings()
            for k in ("repo", "branch"):
                v = str(body.get(k) or "").strip()
                if v:
                    if len(v) > 200 or any(c in v for c in " \\\n\r\t"):
                        raise HTTPException(status_code=400, detail="Not a valid %s" % k)
                    s[k] = v
            _save(s)
            if body.get("token"):
                p = os.path.join(_dir(), "token")
                with open(p, "w", encoding="utf-8") as f:
                    f.write(str(body["token"]).strip())
                try:
                    os.chmod(p, 0o600)
                except OSError:
                    pass
            _latest["at"] = 0
        if body.get("go"):
            start(run_update, getattr(w, "name", "") or "")
        return status()

    @app.post("/api/admin/update/rollback")
    def update_rollback(request: Request, x_viewer_token: str = Header(default="")):
        w = admin(request, x_viewer_token)
        CFG["data"] = core.CFG.get("data") or CFG["data"]
        start(run_rollback, getattr(w, "name", "") or "")
        return status()
