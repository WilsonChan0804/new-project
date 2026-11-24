# -*- coding: utf-8 -*-
"""Site study, stage 3: the office's library of residential unit layouts,
shared by every project (each project keeps its own working units in its
site study).

  GET    /api/units/library          {units: [{id, name, type, unit, by, at}]}
  PUT    /api/units/library          {id?, unit} (a project member) -> the library
  DELETE /api/units/library?id=      (a site admin, or whoever added it)

Kept in <data>/units/library.json.
"""
import json
import os
import time
import uuid

from fastapi import HTTPException, Request, Header

MAX_UNITS = 500
MAX_BYTES = 64 * 1024


def _path(core):
    d = os.path.join(core.CFG["data"], "units")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "library.json")


def load(core):
    try:
        with open(_path(core), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"units": []}


def _write(core, data):
    p = _path(core)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def clean_unit(u):
    if not isinstance(u, dict) or not ((isinstance(u.get("rooms"), list) and u["rooms"]) or (isinstance(u.get("rows"), list) and u["rows"])):
        raise HTTPException(status_code=400, detail="A unit is rooms")
    if len(json.dumps(u)) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The unit is too big")
    out = {k: u[k] for k in ("name", "type", "wall", "party", "part", "left", "right", "corridor", "rows", "rooms", "doors", "windows", "fixtures", "walls", "extras", "facade", "facadeType", "partySides", "src", "ft2", "note") if k in u}
    out["name"] = str(out.get("name") or "Unit")[:80]
    return out


def put(core, uid_, unit, who):
    data = load(core)
    u = clean_unit(unit)
    row = next((x for x in data["units"] if x["id"] == uid_), None) if uid_ else None
    if row:
        row.update(name=u["name"], type=u.get("type", ""), unit=u, at=time.strftime("%Y-%m-%d"))
    else:
        if len(data["units"]) >= MAX_UNITS:
            raise HTTPException(status_code=400, detail="The library is full")
        data["units"].append({"id": uuid.uuid4().hex[:10], "name": u["name"], "type": u.get("type", ""), "unit": u,
                              "by": who or "", "at": time.strftime("%Y-%m-%d")})
    _write(core, data)
    return data


def remove(core, uid_, who, admin):
    data = load(core)
    row = next((x for x in data["units"] if x["id"] == uid_), None)
    if not row:
        return data
    if not admin and row.get("by") != who:
        raise HTTPException(status_code=403, detail="Only a site admin, or whoever added it, removes a unit from the library")
    data["units"] = [x for x in data["units"] if x["id"] != uid_]
    _write(core, data)
    return data


def register(app, core):

    @app.get("/api/units/library")
    def units_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        return load(core)

    @app.put("/api/units/library")
    async def units_put(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        b = await request.json()
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Send {id?, unit}")
        return put(core, b.get("id"), b.get("unit"), getattr(w, "name", "") or "")

    @app.delete("/api/units/library")
    def units_delete(request: Request, id: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "viewer", x_viewer_token)
        admin = (not core.accounts_on()) or bool(getattr(w, "site_admin", False))
        return remove(core, id, getattr(w, "name", "") or "", admin)
