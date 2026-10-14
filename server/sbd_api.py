# -*- coding: utf-8 -*-
"""SBD (PNAP APP-152) on the server: the masses exported from Revit
(sbd.json) and the assessment of them (sbd/engine.py).

  POST /api/sbd/model           the add-in's export (member); runs the check
  GET  /api/sbd                 what the page shows: the model and the result
  POST /api/sbd/run             run again {axis, angle_deg} (member)
  GET  /api/sbd/saved           saved results;  POST {name} keeps the current one
  GET  /api/sbd/saved/{id}      one;  DELETE removes it (member)

Kept in <project>/sbd/: model.json, result.json, saved/<id>.json.
"""

import json
import os
import re
import time
import uuid

from fastapi import HTTPException, Request, Header

from sbd import engine

MAX_MODEL = 200 * 1024 * 1024
SAFE = re.compile(r"^[0-9a-f]{8,32}$")


def _dir(core, pid, sub=""):
    d = os.path.join(core.project_root_for(pid), "sbd", sub)
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


def clean_model(data):
    """The export, checked: numbers only, triangles inside their mesh."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Send the sbd.json the add-in makes")
    site = data.get("site") or []
    try:
        site = [[float(p[0]), float(p[1])] for p in site]
    except (TypeError, ValueError, IndexError):
        raise HTTPException(status_code=400, detail="The site boundary is not a list of points")
    masses = []
    for m in data.get("masses") or []:
        try:
            v = [[float(p[0]), float(p[1]), float(p[2])] for p in m.get("verts") or []]
            t = [[int(a), int(b), int(c)] for a, b, c in m.get("tris") or []]
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="A mass's geometry is not readable")
        n = len(v)
        if any(not (0 <= i < n) for tri in t for i in tri):
            raise HTTPException(status_code=400, detail="A mass's triangles point outside its points")
        masses.append({"id": str(m.get("id") or len(masses) + 1)[:40], "name": str(m.get("name") or "")[:120], "verts": v, "tris": t})

    def line(x):
        try:
            return [[float(p[0]), float(p[1])] for p in x] if x else None
        except (TypeError, ValueError, IndexError):
            return None
    streets = []
    for s in data.get("streets") or []:
        if isinstance(s, dict):
            e = {"name": str(s.get("name") or "")[:80], "centreline": line(s.get("centreline")) or [],
                 "opposite": line(s.get("opposite")) or []}
            if s.get("outline"):
                e["outline"] = line(s.get("outline")) or []       # a street slab's outline
            for k in ("level", "length_m", "width_m"):
                try:
                    if s.get(k) is not None:
                        e[k] = float(s[k])
                except (TypeError, ValueError):
                    pass
            streets.append(e)
    return {
        "version": 1, "units": "m",
        "project": str(data.get("project") or "")[:200], "model": str(data.get("model") or "")[:200],
        "by": str(data.get("by") or "")[:120], "at": str(data.get("at") or "")[:40],
        "ground_z": float(data.get("ground_z") or 0.0), "ground_source": str(data.get("ground_source") or "")[:80],
        "site": site, "masses": masses, "street_axis": line(data.get("street_axis")),
        "streets": streets, "corridor": line(data.get("corridor")),
    }


def register(app, core):

    def run_and_keep(pid, model, opts, who):
        r = engine.run(model, axis=opts.get("axis") or "street", angle_deg=float(opts.get("angle_deg") or 0))
        r["options"] = {"axis": opts.get("axis") or "street", "angle_deg": float(opts.get("angle_deg") or 0)}
        r["run_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        r["run_by"] = who
        r["model_at"] = model.get("at") or ""
        _write(os.path.join(_dir(core, pid), "result.json"), r)
        return r

    @app.post("/api/sbd/model")
    async def sbd_model(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_MODEL:
            raise HTTPException(status_code=413, detail="The export is over 200 MB - simplify the masses")
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        model = clean_model(data)
        model["uploaded_by"] = w.name or ""
        model["uploaded_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _write(os.path.join(_dir(core, x_project), "model.json"), model)
        prev = _read(os.path.join(_dir(core, x_project), "result.json")) or {}
        r = run_and_keep(x_project, model, prev.get("options") or {}, w.name or "")
        return {"ok": r.get("ok"), "controlling_p": r.get("controlling_p"), "required_p": r.get("required_p"),
                "pass": r.get("pass"), "warnings": r.get("warnings"), "masses": len(model["masses"])}

    @app.get("/api/sbd")
    async def sbd_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        d = _dir(core, x_project)
        return {"model": _read(os.path.join(d, "model.json")), "result": _read(os.path.join(d, "result.json"))}

    @app.post("/api/sbd/run")
    async def sbd_run(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        body = await request.json() or {}
        model = _read(os.path.join(_dir(core, x_project), "model.json"))
        if not model:
            raise HTTPException(status_code=404, detail="No masses yet - in Revit, run SBD Export")
        axis = body.get("axis") if body.get("axis") in ("street", "pca", "angle") else "street"
        try:
            ang = max(-180.0, min(180.0, float(body.get("angle_deg") or 0)))
        except (TypeError, ValueError):
            ang = 0.0
        return run_and_keep(x_project, model, {"axis": axis, "angle_deg": ang}, w.name or "")

    @app.get("/api/sbd/saved")
    async def sbd_saved(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        d = _dir(core, x_project, "saved")
        out = []
        for f in sorted(os.listdir(d), reverse=True):
            r = _read(os.path.join(d, f)) if f.endswith(".json") else None
            if r:
                out.append({"id": f[:-5], "name": r.get("saved_name"), "at": r.get("saved_at"), "by": r.get("saved_by"),
                            "controlling_p": r.get("controlling_p"), "required_p": r.get("required_p"), "pass": r.get("pass")})
        out.sort(key=lambda x: x.get("at") or "", reverse=True)
        return {"saved": out}

    @app.post("/api/sbd/saved")
    async def sbd_save(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        body = await request.json() or {}
        r = _read(os.path.join(_dir(core, x_project), "result.json"))
        if not r:
            raise HTTPException(status_code=404, detail="Nothing to save yet")
        r["saved_name"] = str(body.get("name") or "").strip()[:80] or time.strftime("SBD %Y-%m-%d %H:%M")
        r["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        r["saved_by"] = w.name or ""
        sid = uuid.uuid4().hex[:12]
        _write(os.path.join(_dir(core, x_project, "saved"), sid + ".json"), r)
        return {"id": sid, "name": r["saved_name"]}

    @app.get("/api/sbd/saved/{sid}")
    async def sbd_saved_one(request: Request, sid: str, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        if not SAFE.match(sid):
            raise HTTPException(status_code=404, detail="No such result")
        r = _read(os.path.join(_dir(core, x_project, "saved"), sid + ".json"))
        if not r:
            raise HTTPException(status_code=404, detail="No such result")
        return r

    @app.delete("/api/sbd/saved/{sid}")
    async def sbd_saved_del(request: Request, sid: str, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        if not SAFE.match(sid):
            raise HTTPException(status_code=404, detail="No such result")
        p = os.path.join(_dir(core, x_project, "saved"), sid + ".json")
        if os.path.isfile(p):
            os.remove(p)
        return {"deleted": sid}
