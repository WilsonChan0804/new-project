# -*- coding: utf-8 -*-
"""The Programme (programme.html): a project's programme - its tasks,
milestones and links, the working calendar, baselines and the title block -
kept with the project. The scheduling is the page's (viewer/progcore.js);
the server keeps the programme and prints it (programme_pdf.py).

  GET  /api/programme       the programme (viewer)
  PUT  /api/programme       {rev, data} (member); a stale rev -> 409 with the
                            current one, so two people do not overwrite each other
  POST /api/programme/pdf   what to draw (see programme_pdf.py) -> the PDF,
                            kept too in Folders > 00 BIM > Exports > Programme
  GET  /api/programme/history   the last versions: who saved, when, how many tasks

Kept in <project>/programme/programme.json; the last 30 versions in
programme/history/.
"""
import json
import os
import re
import time

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 8 * 1024 * 1024
KEEP_HISTORY = 30
PARTS = {"tasks": list, "calendar": dict, "baselines": list, "cover": dict, "columns": list, "remarks": list, "view": dict}
MAX_TASKS = 5000


def _dir(core, pid, sub=""):
    d = os.path.join(core.project_root_for(pid), "programme", sub)
    if not os.path.isdir(d):
        os.makedirs(d)
    return d


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def clean(data):
    """Only the programme's own parts, each of its kind; tasks checked."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="The programme is an object")
    out = {}
    for k, kind in PARTS.items():
        v = data.get(k)
        if v is None:
            continue
        if not isinstance(v, kind):
            raise HTTPException(status_code=400, detail="Programme part %s is not a %s" % (k, "list" if kind is list else "table"))
        out[k] = v
    tasks = out.get("tasks") or []
    if len(tasks) > MAX_TASKS:
        raise HTTPException(status_code=400, detail="At most %d tasks" % MAX_TASKS)
    ids = set()
    for t in tasks:
        if not isinstance(t, dict) or not t.get("id") or not isinstance(t.get("id"), str):
            raise HTTPException(status_code=400, detail="Each task needs an id")
        if t["id"] in ids:
            raise HTTPException(status_code=400, detail="Two tasks have the id %s" % t["id"][:40])
        ids.add(t["id"])
        if t.get("start") and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(t["start"])):
            raise HTTPException(status_code=400, detail="%s: start is yyyy-mm-dd" % str(t.get("name") or "A task")[:60])
        deps = t.get("deps") or []
        if not isinstance(deps, list):
            raise HTTPException(status_code=400, detail="deps is a list")
        for d in deps:
            if not isinstance(d, dict) or d.get("type", "FS") not in ("FS", "SS", "FF", "SF"):
                raise HTTPException(status_code=400, detail="A link is {from, type FS|SS|FF|SF, lag}")
    for t in tasks:          # links to tasks that are gone go too
        t["deps"] = [d for d in (t.get("deps") or []) if d.get("from") in ids and d.get("from") != t["id"]]
    return out


def load(core, pid):
    p = _read(os.path.join(_dir(core, pid), "programme.json"))
    return p or {"rev": 0, "data": {}, "by": "", "at": ""}


def save(core, pid, rev, data, who):
    d = _dir(core, pid)
    cur = load(core, pid)
    if int(rev or 0) != int(cur.get("rev") or 0):
        raise HTTPException(status_code=409, detail={"message": "Someone else changed the programme meanwhile", "current": cur})
    out = {"rev": int(cur.get("rev") or 0) + 1, "data": clean(data), "by": who or "",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    _write(os.path.join(d, "programme.json"), out)
    h = _dir(core, pid, "history")
    _write(os.path.join(h, "%s-r%06d.json" % (time.strftime("%Y%m%d-%H%M%S"), out["rev"])), out)
    for f in sorted(os.listdir(h))[:-KEEP_HISTORY]:
        try:
            os.remove(os.path.join(h, f))
        except OSError:
            pass
    return out


def history(core, pid):
    h = _dir(core, pid, "history")
    out = []
    for f in sorted(os.listdir(h), reverse=True):
        v = _read(os.path.join(h, f))
        if v:
            out.append({"rev": v.get("rev"), "by": v.get("by"), "at": v.get("at"),
                        "tasks": len((v.get("data") or {}).get("tasks") or [])})
    return out


def register(app, core):

    def can_edit(role):
        return core.RANK.get(role, 0) >= core.RANK["member"] or not core.accounts_on()

    @app.get("/api/programme")
    def programme_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default=""), rev: int = 0):
        w, role = core.require_project(request, x_project, "viewer", x_viewer_token)
        out = load(core, x_project)
        if rev and rev != out.get("rev"):         # an earlier version, to look at or bring back
            for f in os.listdir(_dir(core, x_project, "history")):
                if f.endswith("-r%06d.json" % rev):
                    out = _read(os.path.join(_dir(core, x_project, "history"), f)) or out
                    out["old"] = True
                    break
        out["can_edit"] = can_edit(role)
        out["me"] = getattr(w, "name", "") or ""
        return out

    @app.get("/api/programme/history")
    def programme_history(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        return {"items": history(core, x_project)}

    @app.put("/api/programme")
    async def programme_put(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="The programme is over 8 MB")
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send {rev, data}")
        return await run_in_threadpool(save, core, x_project, body.get("rev"), body.get("data"), getattr(w, "name", "") or "")

    @app.post("/api/programme/pdf")
    async def programme_pdf(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "viewer", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Too much to print")
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict) or not isinstance(body.get("rows"), list):
            raise HTTPException(status_code=400, detail="Send {cover, columns, rows, links}")
        import programme_pdf
        data = await run_in_threadpool(programme_pdf.build, body)
        name = re.sub(r"[^\w .()&+-]+", "_", str(body.get("name") or "Programme"))[:100].strip() or "Programme"
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        kept = ""
        if body.get("keep", True):
            try:
                import files as F
                import tasks
                regs = tasks.reg_ids_for_viewer(core, "default" if core.CFG["single"] else x_project)
                if regs:
                    kept = await run_in_threadpool(F.keep_file, regs[0], [F.BIM, "Exports", "Programme"], name, data,
                                                   getattr(w, "uid", None), getattr(w, "name", "") or "")
            except Exception as ex:
                print("programme: not kept in Folders: %s" % ex)
        return Response(content=data, media_type="application/pdf",
                        headers={"Content-Disposition": 'attachment; filename="%s"' % name, "X-Kept": str(kept or "")[:500]})
