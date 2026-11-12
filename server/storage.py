# -*- coding: utf-8 -*-
"""Storage (Admin > Storage): how full the server's disks are, and what the
viewer keeps on them.

  GET  /api/admin/storage                 the last count (started in the
                                          background when older than 6 h,
                                          or with ?fresh=1)
  POST /api/admin/storage/prune-backups   {keep: 5} removes the older update
                                          backups (site admins)

Counting every file of a big server takes a while, so it runs on a thread
of its own and the page shows the last result at once.
"""

import os
import re
import shutil
import threading
import time

from fastapi import HTTPException, Request, Header

STALE_S = 6 * 3600
WARN_PCT = 80
BACKUP_NAME = re.compile(r"^update-\d{8}-\d{6}$")
KIND_LABEL = {
    "projects": "Comments, issues and settings",
    "project_files": "Folders (project files)",
    "chat_files": "Chat files and photos",
    "snapshots": "Issue and query pictures",
    "preview_cache": "Sheet pictures (rebuilt when cleared)",
    "_deleted": "Recently deleted (can be restored)",
    "telemetry": "Speed measurements",
    "perf": "Speed measurements (pages)",
    "codes": "Codes library",
}

S = {"result": None, "running": False, "lock": threading.Lock()}


def tree_size(path):
    """Bytes and files under a folder, not following links."""
    total, n = 0, 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        elif e.is_file(follow_symlinks=False):
                            total += e.stat(follow_symlinks=False).st_size
                            n += 1
                    except OSError:
                        continue
        except OSError:
            continue
    return total, n


def disks(paths):
    """One entry per disk the given folders are on (by device)."""
    seen, out = {}, []
    for label, p in paths:
        if not p or not os.path.isdir(p):
            continue
        try:
            dev = os.stat(p).st_dev
            u = shutil.disk_usage(p)
        except OSError:
            continue
        if dev in seen:
            seen[dev]["holds"].append(label)
            continue
        e = {"path": p, "holds": [label], "total": u.total, "used": u.used, "free": u.free,
             "pct": round(100.0 * u.used / u.total, 1) if u.total else 0}
        e["warn"] = e["pct"] >= WARN_PCT
        seen[dev] = e
        out.append(e)
    return out


def backups_dir(data):
    return os.path.join(os.path.dirname(os.path.normpath(data)), "backups")


def backups(data):
    d = backups_dir(data)
    if not os.path.isdir(d):
        return None
    items = []
    for name in os.listdir(d):
        p = os.path.join(d, name)
        if os.path.isdir(p) and BACKUP_NAME.match(name):
            size, _ = tree_size(p)
            items.append({"name": name, "size": size})
    items.sort(key=lambda x: x["name"])
    total, _ = tree_size(d)
    return {"path": d, "count": len(items), "size": total,
            "oldest": items[0]["name"][7:] if items else "", "newest": items[-1]["name"][7:] if items else "",
            "update_size": sum(x["size"] for x in items)}


def count(root, data):
    t0 = time.time()
    out = {"disks": disks([("published sheets and models", root), ("viewer data", data),
                           ("update backups", backups_dir(data)), ("system", "/")]),
           "kinds": [], "projects": [], "backups": None}
    if root and os.path.isdir(root):
        size, n = tree_size(root)
        out["kinds"].append({"key": "published", "label": "Published sheets and 3D models", "path": root, "size": size, "files": n})
        for name in sorted(os.listdir(root)):
            p = os.path.join(root, name)
            if os.path.isdir(p) and not name.startswith("."):
                s, f = tree_size(p)
                out["projects"].append({"id": name, "size": s, "files": f})
        out["projects"].sort(key=lambda x: -x["size"])
    if data and os.path.isdir(data):
        rest = 0
        for name in sorted(os.listdir(data)):
            p = os.path.join(data, name)
            if os.path.isdir(p):
                s, f = tree_size(p)
                out["kinds"].append({"key": name, "label": KIND_LABEL.get(name, name), "path": p, "size": s, "files": f})
            else:
                try:
                    rest += os.path.getsize(p)
                except OSError:
                    pass
        if rest:
            out["kinds"].append({"key": "_files", "label": "Databases and settings", "path": data, "size": rest, "files": 0})
    out["backups"] = backups(data) if data else None
    if out["backups"]:
        out["kinds"].append({"key": "backups", "label": "Update backups", "path": out["backups"]["path"],
                             "size": out["backups"]["size"], "files": 0})
    out["kinds"].sort(key=lambda x: -x["size"])
    out["counted_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    out["took_s"] = round(time.time() - t0, 1)
    return out


def start(root, data):
    with S["lock"]:
        if S["running"]:
            return
        S["running"] = True

    def run():
        try:
            S["result"] = count(root, data)
            S["result"]["at"] = time.time()
        except Exception as ex:
            print("storage count: %s" % ex)
        finally:
            S["running"] = False
    threading.Thread(target=run, daemon=True, name="storage-count").start()


def register(app, core):
    def admin(request, tok):
        w = core.who(request, tok)
        if not w.site_admin:
            raise HTTPException(status_code=403, detail="Site admins only")
        return w

    @app.get("/api/admin/storage")
    def storage(request: Request, fresh: int = 0, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        r = S["result"]
        if fresh or not r or time.time() - r.get("at", 0) > STALE_S:
            start(core.CFG["root"], core.CFG["data"])
        # the disks themselves are read now (quick); the folder sizes come from the last count
        live = disks([("published sheets and models", core.CFG["root"]), ("viewer data", core.CFG["data"]),
                      ("update backups", backups_dir(core.CFG["data"])), ("system", "/")])
        return {"disks": live, "count": r, "counting": S["running"], "warn_pct": WARN_PCT}

    @app.post("/api/admin/storage/prune-backups")
    async def prune(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        try:
            body = await request.json()
        except Exception:
            body = {}
        keep = max(1, min(50, int(body.get("keep") or 5)))
        from starlette.concurrency import run_in_threadpool

        def run():
            d = backups_dir(core.CFG["data"])
            if not os.path.isdir(d):
                return {"removed": 0, "freed": 0, "kept": 0}
            names = sorted(n for n in os.listdir(d) if BACKUP_NAME.match(n) and os.path.isdir(os.path.join(d, n)))
            old = names[:-keep] if len(names) > keep else []
            freed = 0
            for n in old:
                p = os.path.join(d, n)
                s, _ = tree_size(p)
                shutil.rmtree(p, ignore_errors=True)
                if not os.path.exists(p):
                    freed += s
            start(core.CFG["root"], core.CFG["data"])
            return {"removed": len(old), "freed": freed, "kept": min(keep, len(names))}
        return await run_in_threadpool(run)
