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
  POST /api/programme/mspdi/import   MS Project XML -> {tasks, calendar, warnings} (programme_xml.py)
  POST /api/programme/mspdi/export   {title, calendar, rows} -> MS Project XML

A project can have several programmes (?pg=<id> on each of the calls
above; none = the first, "main"):
  GET    /api/programme/list          [{id, name, tasks, by, at}]
  POST   /api/programme/list          {name, copy} (member) -> a new one, empty or a copy
  PATCH  /api/programme/list/<id>     {name} (member)
  DELETE /api/programme/list/<id>     (member; not the first) - moved to programme/deleted/

Kept in <project>/programme/programme.json (the first) or
programme/p/<id>/programme.json; the last 30 versions in history/ beside it.
"""
import json
import os
import re
import shutil
import time
import uuid

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 8 * 1024 * 1024
KEEP_HISTORY = 30
PARTS = {"tasks": list, "calendar": dict, "baselines": list, "cover": dict, "columns": list, "remarks": list, "view": dict,
         "categories": list, "format": dict}
MAX_TASKS = 5000


PG_ID = re.compile(r"^[a-z0-9]{6,16}$")


def _pg(pg):
    pg = (pg or "").strip()
    if pg in ("", "main"):
        return ""
    if not PG_ID.match(pg):
        raise HTTPException(status_code=400, detail="No such programme")
    return pg


def _base(core, pid, pg=""):
    b = os.path.join(core.project_root_for(pid), "programme")
    return os.path.join(b, "p", pg) if pg else b


def _dir(core, pid, sub="", pg=""):
    d = os.path.join(_base(core, pid, pg), sub)
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
        if t.get("fnet") and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(t["fnet"])):
            raise HTTPException(status_code=400, detail="%s: finish no earlier than is yyyy-mm-dd" % str(t.get("name") or "A task")[:60])
        deps = t.get("deps") or []
        if not isinstance(deps, list):
            raise HTTPException(status_code=400, detail="deps is a list")
        for d in deps:
            if not isinstance(d, dict) or d.get("type", "FS") not in ("FS", "SS", "FF", "SF"):
                raise HTTPException(status_code=400, detail="A link is {from, type FS|SS|FF|SF, lag}")
    for t in tasks:          # links to tasks that are gone go too
        t["deps"] = [d for d in (t.get("deps") or []) if d.get("from") in ids and d.get("from") != t["id"]]
    return out


def load_at(d):
    """the programme kept in folder d (made when missing)"""
    os.makedirs(d, exist_ok=True)
    return _read(os.path.join(d, "programme.json")) or {"rev": 0, "data": {}, "by": "", "at": ""}


def save_at(d, rev, data, who):
    """a new version in folder d: the rev must be the current one (else 409), the last KEEP_HISTORY kept"""
    os.makedirs(d, exist_ok=True)
    cur = load_at(d)
    if int(rev or 0) != int(cur.get("rev") or 0):
        raise HTTPException(status_code=409, detail={"message": "Someone else changed the programme meanwhile", "current": cur})
    out = {"rev": int(cur.get("rev") or 0) + 1, "data": clean(data), "by": who or "",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    _write(os.path.join(d, "programme.json"), out)
    h = os.path.join(d, "history")
    os.makedirs(h, exist_ok=True)
    _write(os.path.join(h, "%s-r%06d.json" % (time.strftime("%Y%m%d-%H%M%S"), out["rev"])), out)
    for f in sorted(os.listdir(h))[:-KEEP_HISTORY]:
        try:
            os.remove(os.path.join(h, f))
        except OSError:
            pass
    return out


def history_at(d):
    h = os.path.join(d, "history")
    os.makedirs(h, exist_ok=True)
    out = []
    for f in sorted(os.listdir(h), reverse=True):
        v = _read(os.path.join(h, f))
        if v:
            out.append({"rev": v.get("rev"), "by": v.get("by"), "at": v.get("at"),
                        "tasks": len((v.get("data") or {}).get("tasks") or [])})
    return out


def version_at(d, rev):
    """an earlier version, to look at or bring back"""
    h = os.path.join(d, "history")
    if os.path.isdir(h):
        for f in os.listdir(h):
            if f.endswith("-r%06d.json" % rev):
                v = _read(os.path.join(h, f))
                if v:
                    v["old"] = True
                    return v
    return None


def load(core, pid, pg=""):
    if pg and not os.path.isfile(os.path.join(_base(core, pid, pg), "programme.json")):
        raise HTTPException(status_code=404, detail="That programme is not in this project (deleted?)")
    return load_at(_dir(core, pid, pg=pg))


def save(core, pid, rev, data, who, pg=""):
    return save_at(_dir(core, pid, pg=pg), rev, data, who)


def history(core, pid, pg=""):
    return history_at(_dir(core, pid, pg=pg))


# ------------------------------------------------------------ several programmes

def _index(core, pid):
    v = _read(os.path.join(_dir(core, pid), "index.json"))
    return v if isinstance(v, dict) else {}


def _set_index(core, pid, ix):
    _write(os.path.join(_dir(core, pid), "index.json"), ix)


def programmes(core, pid):
    ix = _index(core, pid)
    names = ix.get("names") or {}
    order = [""] + [x for x in (ix.get("order") or []) if x and os.path.isfile(os.path.join(_base(core, pid, x), "programme.json"))]
    out = []
    for pg in order:
        doc = _read(os.path.join(_base(core, pid, pg), "programme.json")) or {}
        title = ((doc.get("data") or {}).get("cover") or {}).get("title") or ""
        out.append({"id": pg or "main", "name": names.get(pg or "main") or (title if not pg else "") or ("Programme" if not pg else "Programme " + pg[:4]),
                    "tasks": len((doc.get("data") or {}).get("tasks") or []), "by": doc.get("by") or "", "at": doc.get("at") or ""})
    return out


def _name(v):
    n = re.sub(r"\s+", " ", str(v or "")).strip()[:80]
    if not n:
        raise HTTPException(status_code=400, detail="Give the programme a name")
    return n


def create(core, pid, name, copy, who):
    name = _name(name)
    ix = _index(core, pid)
    if len(ix.get("order") or []) >= 50:
        raise HTTPException(status_code=400, detail="At most 50 programmes in a project")
    pg = uuid.uuid4().hex[:10]
    data = {}
    if copy not in (None, ""):
        src = load(core, pid, _pg(copy))
        data = json.loads(json.dumps(src.get("data") or {}))
        data.setdefault("cover", {})
        data["cover"]["title"] = name
    else:
        data = {"cover": {"title": name}}
    _write(os.path.join(_dir(core, pid, pg=pg), "programme.json"), {"rev": 0, "data": {}, "by": "", "at": ""})
    out = save(core, pid, 0, data, who, pg)
    ix.setdefault("order", []).append(pg)
    ix.setdefault("names", {})[pg] = name
    _set_index(core, pid, ix)
    return {"id": pg, "name": name, "rev": out["rev"]}


def rename(core, pid, pg, name):
    name = _name(name)
    pg = _pg(pg)
    load(core, pid, pg)
    ix = _index(core, pid)
    ix.setdefault("names", {})[pg or "main"] = name
    _set_index(core, pid, ix)
    return {"id": pg or "main", "name": name}


def remove(core, pid, pg):
    pg = _pg(pg)
    if not pg:
        raise HTTPException(status_code=400, detail="The first programme cannot be deleted - clear its tasks instead")
    load(core, pid, pg)
    dest = os.path.join(_base(core, pid), "deleted")
    os.makedirs(dest, exist_ok=True)
    shutil.move(_base(core, pid, pg), os.path.join(dest, "%s-%s" % (pg, time.strftime("%Y%m%d-%H%M%S"))))
    ix = _index(core, pid)
    ix["order"] = [x for x in (ix.get("order") or []) if x != pg]
    (ix.get("names") or {}).pop(pg, None)
    _set_index(core, pid, ix)
    return {"ok": True}


def register(app, core):

    def can_edit(role):
        return core.RANK.get(role, 0) >= core.RANK["member"] or not core.accounts_on()

    @app.get("/api/programme")
    def programme_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default=""), rev: int = 0, pg: str = ""):
        w, role = core.require_project(request, x_project, "viewer", x_viewer_token)
        pg = _pg(pg)
        out = load(core, x_project, pg)
        if rev and rev != out.get("rev"):         # an earlier version, to look at or bring back
            out = version_at(_dir(core, x_project, pg=pg), rev) or out
        out["can_edit"] = can_edit(role)
        out["me"] = getattr(w, "name", "") or ""
        return out

    @app.get("/api/programme/history")
    def programme_history(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default=""), pg: str = ""):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        return {"items": history(core, x_project, _pg(pg))}

    @app.get("/api/programme/list")
    def programme_list(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, role = core.require_project(request, x_project, "viewer", x_viewer_token)
        return {"items": programmes(core, x_project), "can_edit": can_edit(role)}

    @app.post("/api/programme/list")
    async def programme_new(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        try:
            body = json.loads((await request.body()).decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send {name, copy}")
        return await run_in_threadpool(create, core, x_project, body.get("name"), body.get("copy"), getattr(w, "name", "") or "")

    @app.patch("/api/programme/list/{pg}")
    async def programme_rename(pg: str, request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        try:
            body = json.loads((await request.body()).decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        return await run_in_threadpool(rename, core, x_project, pg, (body or {}).get("name"))

    @app.delete("/api/programme/list/{pg}")
    def programme_delete(pg: str, request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        return remove(core, x_project, pg)

    @app.put("/api/programme")
    async def programme_put(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default=""), pg: str = ""):
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
        return await run_in_threadpool(save, core, x_project, body.get("rev"), body.get("data"), getattr(w, "name", "") or "", _pg(pg))

    @app.post("/api/programme/mspdi/import")
    async def programme_xml_in(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.who(request, x_viewer_token)          # signed in: it reads the file sent, nothing of a project
        raw = await request.body()
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="The file is over 20 MB")
        import programme_xml
        try:
            if programme_xml.is_mpp(raw):
                raw = await run_in_threadpool(programme_xml.mpp_to_xml, raw)
            return await run_in_threadpool(programme_xml.read, raw)
        except programme_xml.Refused as ex:
            raise HTTPException(status_code=400, detail=str(ex))

    @app.post("/api/programme/mspdi/export")
    async def programme_xml_out(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.who(request, x_viewer_token)
        try:
            body = json.loads((await request.body()).decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict) or not isinstance(body.get("rows"), list):
            raise HTTPException(status_code=400, detail="Send {title, calendar, rows}")
        import programme_xml
        data = await run_in_threadpool(programme_xml.write, body)
        name = re.sub(r"[^\w .()&+-]+", "_", str(body.get("name") or "Programme"))[:100].strip() or "Programme"
        if not name.lower().endswith(".xml"):
            name += ".xml"
        return Response(content=data, media_type="application/xml", headers={"Content-Disposition": 'attachment; filename="%s"' % name})

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
