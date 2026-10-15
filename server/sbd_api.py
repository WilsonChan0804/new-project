# -*- coding: utf-8 -*-
"""SBD (PNAP APP-152) on the server: the masses exported from Revit
(sbd.json) and the assessment of them (sbd/engine.py).

  POST /api/sbd/model           the add-in's export (member); runs the check
  GET  /api/sbd                 what the page shows: the model and the result
  POST /api/sbd/run             run again {axis, angle_deg, levels} (member)
  POST /api/sbd/cad             the drawings as DXF / DWG (?format=dxf|dwg)
  GET  /api/sbd/template.dxf    the CAD template (no Revit: draw the model in CAD)
  POST /api/sbd/cad-model       that drawing back (DXF, or DWG via ODA) -> the model
  GET  /api/sbd/saved           saved results;  POST {name} keeps the current one
  GET  /api/sbd/saved/{id}      one;  DELETE removes it (member)

Kept in <project>/sbd/: model.json, result.json, saved/<id>.json.
"""

import json
import os
import re
import shutil
import time
import uuid

from fastapi import HTTPException, Request, Header, Response

from sbd import engine
from sbd.ifcwrite import masses_ifc

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


def masses_ref(core, pid, model, who, uid):
    """The masses as a model in this project's 3D (a consultant-style model,
    refs.py): the one made by an earlier export is replaced."""
    import refs as R
    root = core.project_root_for(pid)
    folder = os.path.join(root, "refs")
    if not os.path.isdir(folder):
        os.makedirs(folder)
    old = [r for r in R.read_refs(root) if r.get("sbd")]
    rid = uuid.uuid4().hex[:12]
    src = os.path.join(folder, rid + ".ifc")
    with open(src, "w", encoding="ascii", errors="replace") as f:
        f.write(masses_ifc(model["masses"], "SBD masses - " + (model.get("model") or "Revit"), who))
    r = {"id": rid, "kind": "ifc", "sbd": True, "name": ("SBD masses - " + (model.get("model") or "Revit"))[:80],
         "company": "", "discipline": "SBD", "source_file": "sbd-masses.ifc",
         "ifc": "refs/%s.ifc" % rid, "fragments": "refs/%s.frag" % rid, "format": "frag",
         "status": "waiting", "progress": 0, "error": "", "mb": None, "ifc_mb": round(os.path.getsize(src) / 1048576.0, 2),
         # the masses are on the exporting Revit model's internal origin
         "placement": R.placement_of({"mode": "internal"}), "opacity": 0.6, "on": True,
         "by": who, "by_uid": uid, "at": R.now_iso()}
    with R._LOCK:
        refs = [x for x in R.read_refs(root) if not x.get("sbd")]
        refs.append(r)
        R.write_refs(root, refs)
    for o in old:
        for ext in (".ifc", ".frag", ".frag.part"):
            q = os.path.join(folder, o["id"] + ext)
            if os.path.isfile(q):
                os.remove(q)
    R.convert(core, root, pid, rid, src, os.path.join(folder, rid + ".frag"))
    return rid


def drop_masses_ref(core, pid):
    import refs as R
    root = core.project_root_for(pid)
    with R._LOCK:
        refs = R.read_refs(root)
        old = [r for r in refs if r.get("sbd")]
        R.write_refs(root, [r for r in refs if not r.get("sbd")])
    for o in old:
        for ext in (".ifc", ".frag", ".frag.part"):
            q = os.path.join(root, "refs", o["id"] + ext)
            if os.path.isfile(q):
                os.remove(q)
    return len(old)


# the layers of the SBD drawings in CAD: AutoCAD colour index
LAYER_ACI = {"SBD-SITE": 7, "SBD-STREET": 8, "SBD-STREET-CL": 8, "SBD-STREET-OPP": 7, "SBD-IS": 3, "SBD-NOT": 1, "SBD-PE": 5,
             "SBD-EXEMPT": 8, "SBD-OPEN": 9, "SBD-BLDG": 251, "SBD-BLDG-OTHER": 9, "SBD-CORRIDOR": 5, "SBD-CANYON": 3, "SBD-LP": 1,
             "SBD-ZONE": 1, "SBD-DIM": 4, "SBD-TEXT": 7, "SBD-AXES": 30, "SBD-SCALE": 7, "SBD-TITLE": 7, "SBD-MISC": 7}
MAX_ENTS = 200000


def cad_file(ents):
    """The drawings' entities (sbddxf.js) -> DXF text."""
    from sbd.dxfwrite import Dxf
    d = Dxf()
    for nm, col in LAYER_ACI.items():
        d.layer(nm, col)
    num = lambda v: float(v) if v is not None and v == v and abs(float(v)) < 1e9 else 0.0
    pt = lambda q: (num(q[0]), num(q[1]))
    for e in ents[:MAX_ENTS]:
        if not isinstance(e, dict):
            continue
        l = str(e.get("l") or "SBD-MISC")[:60]
        if l not in d.layers:
            d.layer(l, LAYER_ACI.get(l, 7))
        c = e.get("c")
        c = int(c) if isinstance(c, (int, float)) else None
        t = e.get("t")
        try:
            if t == "line":
                d.line(l, pt(e["p"][0]), pt(e["p"][1]), rgb=c)
            elif t == "pl":
                d.poly(l, [pt(q) for q in e["p"]], closed=bool(e.get("closed")), rgb=c)
            elif t == "fill":
                d.fill(l, [pt(q) for q in e["p"]], rgb=c, alpha=num(e.get("a", 1)))
            elif t == "circle":
                d.circle(l, pt(e["p"]), num(e.get("r")), rgb=c)
            elif t == "text":
                d.text(l, pt(e["p"]), max(0.01, num(e.get("h"))), str(e.get("s") or "")[:500], rot=num(e.get("r")),
                       align=e.get("a") if e.get("a") in ("l", "c", "r") else "l", valign=e.get("v") if e.get("v") in ("b", "m", "t") else "b", rgb=c)
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return d.write()


def clean_levels(lv):
    """{zone: plan level m | None} from the page."""
    out = {}
    for k, v in (lv or {}).items() if isinstance(lv, dict) else []:
        if k in ("LOW", "MIDDLE", "HIGH") and v is not None:
            try:
                out[k] = round(max(-50.0, min(1000.0, float(v))), 3)
            except (TypeError, ValueError):
                pass
    return out


def register(app, core):

    def run_and_keep(pid, model, opts, who):
        lv = clean_levels(opts.get("levels"))
        r = engine.run(model, axis=opts.get("axis") or "street", angle_deg=float(opts.get("angle_deg") or 0), levels=lv)
        r["options"] = {"axis": opts.get("axis") or "street", "angle_deg": float(opts.get("angle_deg") or 0), "levels": lv}
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
        return take_model(x_project, data, w)

    def take_model(pid, data, w):
        """A model (from Revit or from CAD): kept, assessed, its masses in the 3D."""
        model = clean_model(data)
        model["uploaded_by"] = w.name or ""
        model["uploaded_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _write(os.path.join(_dir(core, pid), "model.json"), model)
        prev = _read(os.path.join(_dir(core, pid), "result.json")) or {}
        r = run_and_keep(pid, model, prev.get("options") or {}, w.name or "")
        try:
            masses_ref(core, pid, model, w.name or "", w.uid)       # the masses in the 3D
        except Exception as e:
            core.bg_log("%s: SBD masses not added to the 3D: %s" % (pid, e))
        return {"ok": r.get("ok"), "controlling_p": r.get("controlling_p"), "required_p": r.get("required_p"),
                "pass": r.get("pass"), "warnings": r.get("warnings"), "masses": len(model["masses"])}

    @app.get("/api/sbd/template.dxf")
    async def sbd_template():
        """The CAD template: the layers to draw the SBD model on (the same
        for everyone - no project needed)."""
        from sbd.cadmodel import template_dxf
        return Response(content=template_dxf().encode("ascii", "replace"), media_type="application/dxf",
                        headers={"Content-Disposition": 'attachment; filename="SBD model template.dxf"'})

    @app.post("/api/sbd/cad-model")
    async def sbd_cad_model(request: Request, name: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """The SBD model drawn in CAD (the template's layers): DXF, or DWG
        through the ODA File Converter -> the same as an export from Revit."""
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_MODEL:
            raise HTTPException(status_code=413, detail="The drawing is over 200 MB")
        import tempfile
        import cad as CAD
        import cad_dxf
        from sbd.cadmodel import read_model
        tmp = tempfile.mkdtemp(prefix="lwk-sbdin-")
        try:
            is_dwg = name.lower().endswith(".dwg") or raw[:4] == b"AC10"
            src = os.path.join(tmp, "m.dwg" if is_dwg else "m.dxf")
            with open(src, "wb") as f:
                f.write(raw)
            dxf = os.path.join(tmp, "m2.dxf")
            if is_dwg:
                oda = CAD.find_oda()
                if not oda:
                    raise HTTPException(status_code=501, detail="A DWG needs the ODA File Converter on the server - save the drawing as DXF and send that")
                if not CAD.convert_one(oda, src, dxf):
                    raise HTTPException(status_code=422, detail="The DWG could not be read - save it as DXF and send that")
            else:
                dxf = src
            try:
                doc = cad_dxf.read(dxf)
            except Exception as e:
                raise HTTPException(status_code=422, detail="Not a DXF the viewer can read: %s" % e)
            data, probs = read_model(doc, project=x_project, by=w.name or "")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if not data:
            raise HTTPException(status_code=422, detail=" ".join(probs))
        data["model"] = ("CAD: " + os.path.basename(name or "drawing"))[:80]
        data["at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        out = take_model(x_project, data, w)
        out["problems"] = probs
        out["streets"] = len(data["streets"])
        return out

    @app.delete("/api/sbd")
    async def sbd_delete(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """Remove the masses sent from Revit, the result and the masses' model
        in the 3D (saved results stay)."""
        core.require_project(request, x_project, "member", x_viewer_token)
        d = _dir(core, x_project)
        for f in ("model.json", "result.json"):
            if os.path.isfile(os.path.join(d, f)):
                os.remove(os.path.join(d, f))
        return {"removed_models": drop_masses_ref(core, x_project)}

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
        return run_and_keep(x_project, model, {"axis": axis, "angle_deg": ang, "levels": body.get("levels")}, w.name or "")

    @app.post("/api/sbd/cad")
    async def sbd_cad(request: Request, format: str = "dxf", name: str = "SBD", x_viewer_token: str = Header(default=""),
                      x_project: str = Header(default="")):
        """The SBD drawings as a DXF, or a DWG (the ODA File Converter)."""
        core.require_project(request, x_project, "viewer", x_viewer_token)
        raw = await request.body()
        if len(raw) > 80 * 1048576:
            raise HTTPException(status_code=413, detail="Too much to draw")
        try:
            ents = json.loads(raw.decode("utf-8")).get("ents") or []
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Not JSON")
        text = cad_file(ents)
        fname = (re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", name).strip(" .") or "SBD")[:120]
        if format == "dwg":
            import cad as CAD
            oda = CAD.find_oda()
            if not oda:
                raise HTTPException(status_code=501, detail="DWG needs the ODA File Converter on the server - take the DXF (AutoCAD opens it)")
            import tempfile
            tmp = tempfile.mkdtemp(prefix="lwk-sbdcad-")
            try:
                src, dst = os.path.join(tmp, "a.dxf"), os.path.join(tmp, "a.dwg")
                with open(src, "w", encoding="ascii", errors="replace", newline="") as f:
                    f.write(text)
                if not CAD.dxf_to_dwg(oda, src, dst):
                    raise HTTPException(status_code=500, detail="The DWG could not be made - take the DXF")
                with open(dst, "rb") as f:
                    data = f.read()
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            return Response(content=data, media_type="application/acad",
                            headers={"Content-Disposition": 'attachment; filename="%s.dwg"' % fname.encode("ascii", "replace").decode()})
        return Response(content=text.encode("ascii", "replace"), media_type="application/dxf",
                        headers={"Content-Disposition": 'attachment; filename="%s.dxf"' % fname.encode("ascii", "replace").decode()})

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
