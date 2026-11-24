# -*- coding: utf-8 -*-
"""My programmes: programmes that belong to a person, not to a project - for
a tender or a job that is not in the viewer yet. The owner can share one
with people (view or edit) or with everyone in the office, and copy it into
a project when the project starts. The programme itself is the same as a
project's (programme.py: clean, versions, history); the page is
programme.html?mine=<id>.

  GET    /api/myprog/list                 [{id, name, role, owner_name, tasks, by, at, share, all}]
  POST   /api/myprog/list                 {name, from?: {project, pg} | {mine}} -> {id, name}
  PATCH  /api/myprog/list/<id>            {name?, share?: {uid: view|edit}, all?: ""|view|edit}
  DELETE /api/myprog/list/<id>            (the owner) - moved to myprog/deleted/
  GET    /api/myprog/<id>[?rev=]          the programme (+ can_edit, role, me)
  PUT    /api/myprog/<id>                 {rev, data} (owner / edit)
  GET    /api/myprog/<id>/history
  POST   /api/myprog/<id>/pdf             as /api/programme/pdf, not filed in a project
  POST   /api/myprog/<id>/to-project      {project, name} (a member of that project) -> {id}

Kept in <data>/myprog/<id>/programme.json; who may do what in
<data>/myprog/index.json.
"""
import json
import os
import re
import shutil
import threading
import time
import uuid

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

import programme as PG

ID = re.compile(r"^[a-z0-9]{10}$")
MAX_OWN = 200
_lock = threading.Lock()


def _root(core):
    d = os.path.join(core.CFG["data"], "myprog")
    os.makedirs(d, exist_ok=True)
    return d


def _index(core):
    try:
        with open(os.path.join(_root(core), "index.json"), encoding="utf-8") as f:
            v = json.load(f)
            return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _set_index(core, ix):
    p = os.path.join(_root(core), "index.json")
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(ix, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def _who(w):
    return str(getattr(w, "uid", "") or ""), getattr(w, "name", "") or ""


def role(core, meta, w):
    """owner | edit | view | "" for this person"""
    if not core.accounts_on():
        return "owner"
    uid, _ = _who(w)
    if meta.get("owner") == uid or getattr(w, "site_admin", False):
        return "owner"
    r = (meta.get("share") or {}).get(uid) or ""
    a = meta.get("all") or ""
    best = max([r, a], key=lambda x: {"": 0, "view": 1, "edit": 2}.get(x, 0))
    return best if best in ("view", "edit") else ""


def _get(core, pid, w, need="view"):
    if not ID.match(pid or ""):
        raise HTTPException(status_code=404, detail="No such programme")
    meta = _index(core).get(pid)
    if not meta:
        raise HTTPException(status_code=404, detail="No such programme (deleted?)")
    r = role(core, meta, w)
    rank = {"": 0, "view": 1, "edit": 2, "owner": 3}
    if rank[r] < rank[need]:
        raise HTTPException(status_code=403, detail="This programme is not shared with you" if not r else "You can only view this programme")
    return meta, r


def _dir(core, pid):
    return os.path.join(_root(core), pid)


def listing(core, w):
    out = []
    for pid, m in _index(core).items():
        r = role(core, m, w)
        if not r:
            continue
        doc = PG._read(os.path.join(_dir(core, pid), "programme.json")) or {}
        out.append({"id": pid, "name": m.get("name") or "Programme", "role": r, "owner_name": m.get("owner_name") or "",
                    "tasks": len((doc.get("data") or {}).get("tasks") or []), "by": doc.get("by") or "", "at": doc.get("at") or m.get("at") or "",
                    "share": (m.get("share") or {}) if r == "owner" else {}, "all": m.get("all") or ""})
    out.sort(key=lambda x: (x["role"] != "owner", x["name"].lower()))
    return out


def create(core, w, name, src):
    name = PG._name(name)
    uid, who = _who(w)
    data = {}
    if isinstance(src, dict) and src.get("mine"):
        _get(core, str(src["mine"]), w, "view")
        data = json.loads(json.dumps(PG.load_at(_dir(core, str(src["mine"]))).get("data") or {}))
    elif isinstance(src, dict) and src.get("project"):
        # a project programme this person can see
        req = src.get("_request")
        core.require_project(req, str(src["project"]), "viewer", src.get("_token") or "")
        data = json.loads(json.dumps(PG.load(core, str(src["project"]), PG._pg(src.get("pg"))).get("data") or {}))
    data.setdefault("cover", {})["title"] = name
    with _lock:
        ix = _index(core)
        if core.accounts_on() and sum(1 for m in ix.values() if m.get("owner") == uid) >= MAX_OWN:
            raise HTTPException(status_code=400, detail="At most %d programmes of your own" % MAX_OWN)
        pid = uuid.uuid4().hex[:10]
        ix[pid] = {"name": name, "owner": uid, "owner_name": who, "share": {}, "all": "", "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        _set_index(core, ix)
    PG.save_at(_dir(core, pid), 0, data, who)
    return {"id": pid, "name": name}


def patch(core, w, pid, body):
    meta, r = _get(core, pid, w, "edit")
    with _lock:
        ix = _index(core)
        m = ix.get(pid) or meta
        if body.get("name") is not None:
            m["name"] = PG._name(body.get("name"))
        if "share" in body or "all" in body:
            if r != "owner":
                raise HTTPException(status_code=403, detail="Only its owner shares a programme")
            if "share" in body:
                sh = body.get("share") or {}
                if not isinstance(sh, dict):
                    raise HTTPException(status_code=400, detail="share is {person: view|edit}")
                m["share"] = {str(k)[:80]: v for k, v in sh.items() if v in ("view", "edit") and str(k) != m.get("owner")}
            if "all" in body:
                m["all"] = body.get("all") if body.get("all") in ("view", "edit") else ""
        ix[pid] = m
        _set_index(core, ix)
    return {"id": pid, "name": m["name"], "share": m.get("share") or {}, "all": m.get("all") or ""}


def remove(core, w, pid):
    _get(core, pid, w, "owner")
    dest = os.path.join(_root(core), "deleted")
    os.makedirs(dest, exist_ok=True)
    if os.path.isdir(_dir(core, pid)):
        shutil.move(_dir(core, pid), os.path.join(dest, "%s-%s" % (pid, time.strftime("%Y%m%d-%H%M%S"))))
    with _lock:
        ix = _index(core)
        ix.pop(pid, None)
        _set_index(core, ix)
    return {"ok": True}


def register(app, core):

    async def body_of(request):
        try:
            b = json.loads((await request.body()).decode("utf-8") or "{}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Send an object")
        return b

    @app.get("/api/myprog/list")
    def myprog_list(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        return {"items": listing(core, w), "accounts": core.accounts_on()}

    @app.post("/api/myprog/list")
    async def myprog_new(request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        b = await body_of(request)
        src = b.get("from") if isinstance(b.get("from"), dict) else None
        if src is not None:
            src = dict(src, _request=request, _token=x_viewer_token)
        return await run_in_threadpool(create, core, w, b.get("name"), src)

    @app.patch("/api/myprog/list/{pid}")
    async def myprog_patch(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        return await run_in_threadpool(patch, core, w, pid, await body_of(request))

    @app.delete("/api/myprog/list/{pid}")
    def myprog_delete(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        return remove(core, w, pid)

    @app.get("/api/myprog/{pid}")
    def myprog_get(pid: str, request: Request, rev: int = 0, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        meta, r = _get(core, pid, w, "view")
        d = _dir(core, pid)
        out = PG.load_at(d)
        if rev and rev != out.get("rev"):
            out = PG.version_at(d, rev) or out
        out.update(can_edit=r in ("owner", "edit"), role=r, me=_who(w)[1], name=meta.get("name") or "", owner_name=meta.get("owner_name") or "")
        return out

    @app.put("/api/myprog/{pid}")
    async def myprog_put(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        _get(core, pid, w, "edit")
        raw = await request.body()
        if len(raw) > PG.MAX_BYTES:
            raise HTTPException(status_code=413, detail="The programme is over 8 MB")
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send {rev, data}")
        return await run_in_threadpool(PG.save_at, _dir(core, pid), body.get("rev"), body.get("data"), _who(w)[1])

    @app.get("/api/myprog/{pid}/history")
    def myprog_history(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        _get(core, pid, w, "view")
        return {"items": PG.history_at(_dir(core, pid))}

    @app.post("/api/myprog/{pid}/pdf")
    async def myprog_pdf(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        _get(core, pid, w, "view")
        raw = await request.body()
        if len(raw) > PG.MAX_BYTES:
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
        return Response(content=data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="%s"' % name, "X-Kept": ""})

    @app.post("/api/myprog/{pid}/to-project")
    async def myprog_to_project(pid: str, request: Request, x_viewer_token: str = Header(default="")):
        w = core.who(request, x_viewer_token)
        meta, _ = _get(core, pid, w, "view")
        b = await body_of(request)
        proj = str(b.get("project") or "")
        core.require_project(request, proj, "member", x_viewer_token)
        data = json.loads(json.dumps(PG.load_at(_dir(core, pid)).get("data") or {}))

        def run():
            made = PG.create(core, proj, b.get("name") or meta.get("name") or "Programme", None, _who(w)[1])
            cur = PG.load(core, proj, made["id"])
            data.setdefault("cover", {})["title"] = made["name"]
            PG.save(core, proj, cur.get("rev"), data, _who(w)[1], made["id"])
            return made
        return await run_in_threadpool(run)
