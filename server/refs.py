"""Consultant models in the 3D view: a structure, interior, MEP or façade
model from another company, in whatever program they use, shown with the
project's own model.

Ask them for IFC (IFC 2x3 or IFC4 - SketchUp, Revit, Tekla, ArchiCAD,
Rhino and the rest all export it). The server turns it into the viewer's
own 3D format with tools/ifc2frag.mjs (Node.js, already used for the
phone copies; the converter itself is bundled in tools/ifc/), keeping the elements, their properties and their real
coordinates.

Three ways to use one:
  1. Added to this project's 3D (refs below): switched on and off like a
     layer, with its own transparency, placed on the project's shared
     coordinates, its internal origin, or by hand (move and rotate).
  2. An overlay of another project's 3D model (a project of its own on
     the Projects page): the same, the files read from that project.
  3. A 3D project of its own (POST /api/admin/projects/from-ifc): a
     standalone reference with its own page, for a model on coordinates
     nobody has aligned - and still available to overlay later.

Kept in <project>/refs/ with the list in <project>/refs.json - apart from
the folders a Revit export replaces, so a night export never removes them.
"""

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

from fastapi import Header, HTTPException, Request

CORE = None
_LOCK = threading.Lock()
LIST = "refs.json"
MAX_IFC = 3 * 1024 * 1024 * 1024
MODES = ("shared", "internal", "fit")
SAFE_ID = re.compile(r"^[a-f0-9]{8,32}$")


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_refs(root):
    try:
        with open(os.path.join(root, LIST), encoding="utf-8") as f:
            r = json.load(f).get("refs", [])
        return r if isinstance(r, list) else []
    except Exception:
        return []


def write_refs(root, refs):
    p = os.path.join(root, LIST)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"refs": refs}, f, indent=1, ensure_ascii=False)
    os.replace(tmp, p)


def update_ref(root, rid, **kw):
    with _LOCK:
        refs = read_refs(root)
        for r in refs:
            if r["id"] == rid:
                r.update(kw)
        write_refs(root, refs)


def clean(v, n):
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(v or "")).strip()[:n]


def placement_of(p):
    p = p if isinstance(p, dict) else {}
    num = lambda k, lim: max(-lim, min(lim, float(p.get(k) or 0)))
    return {"mode": p.get("mode") if p.get("mode") in MODES else "shared",
            "x": num("x", 1e9), "y": num("y", 1e9), "z": num("z", 1e7), "rot": num("rot", 360)}


def convert(core, root, pid, rid, src, out, after=None):
    """IFC -> .frag on the server's background worker."""
    node = core.node_bin()
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "ifc2frag.mjs")
    if not node:
        update_ref(root, rid, status="failed", error="Node.js is not installed on the server (it is also what makes the phone copies)")
        return
    tools = os.path.dirname(script)
    if not (os.path.isfile(os.path.join(tools, "ifc", "frags.bundle.cjs"))
            or os.path.isdir(os.path.join(tools, "node_modules", "@thatopen", "fragments"))):
        update_ref(root, rid, status="failed",
                   error="The IFC converter is missing from server/tools/ifc - update the server again")
        return

    def run():
        t0 = time.time()
        update_ref(root, rid, status="converting", progress=0)
        try:
            proc = subprocess.Popen([node, "--max-old-space-size=8192", script, src, out],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for line in proc.stdout:
                m = re.match(r"progress (\d+)%", line.strip())
                if m:
                    update_ref(root, rid, progress=int(m.group(1)))
            err = proc.stderr.read()
            code = proc.wait(timeout=4 * 3600)
        except Exception as e:
            code, err = 1, str(e)
        if code or not os.path.isfile(out):
            core.bg_log("%s: IFC %s failed: %s" % (pid, os.path.basename(src), (err or "")[-600:]))
            update_ref(root, rid, status="failed", error=(err or "The conversion failed").strip()[-400:])
            return
        mb = round(os.path.getsize(out) / 1048576.0, 1)
        core.bg_log("%s: IFC %s converted in %.0f s (%s MB)" % (pid, os.path.basename(src), time.time() - t0, mb))
        update_ref(root, rid, status="ready", error="", progress=100, mb=mb)
        if after:
            after()
    core.bg("ifc:%s:%s" % (pid, rid), run)


def register(app, core):
    global CORE
    CORE = core

    def project(request, token, need="viewer"):
        pid = request.headers.get("x-project", "") or request.query_params.get("project", "")
        w, role = core.require_project(request, pid, need, token)
        root = core.project_root_for(pid)
        return w, role, pid, root

    def can_change(w, role, r):
        return role == "admin" or w.site_admin or (w.uid is not None and r.get("by_uid") == w.uid)

    @app.get("/api/refs")
    async def refs_list(request: Request, x_viewer_token: str = Header(default="")):
        w, role, pid, root = project(request, x_viewer_token)
        out = []
        for r in read_refs(root):
            r = dict(r)
            r["can_change"] = can_change(w, role, r)
            out.append(r)
        return {"refs": out, "can_add": core.RANK[role] >= core.RANK["member"],
                "converter": bool(core.node_bin())}

    @app.post("/api/refs/upload")
    async def refs_upload(request: Request, name: str = "", company: str = "", discipline: str = "", file: str = "model.ifc",
                          x_viewer_token: str = Header(default="")):
        """The body is the IFC file itself."""
        w, role, pid, root = project(request, x_viewer_token, "member")
        if not file.lower().endswith(".ifc"):
            raise HTTPException(status_code=400, detail="An .ifc file please (IFC 2x3 or IFC4). Ask the consultant to export IFC from their program.")
        folder = os.path.join(root, "refs")
        if not os.path.isdir(folder):
            os.makedirs(folder)
        rid = uuid.uuid4().hex[:12]
        src = os.path.join(folder, rid + ".ifc")
        size, head = 0, b""
        with open(src, "wb") as f:
            async for chunk in request.stream():
                if len(head) < 64:
                    head += chunk[:64]
                size += len(chunk)
                if size > MAX_IFC:
                    f.close()
                    os.remove(src)
                    raise HTTPException(status_code=413, detail="IFC files up to 3 GB")
                f.write(chunk)
        if not head.lstrip().startswith(b"ISO-10303-21"):
            os.remove(src)
            raise HTTPException(status_code=400, detail="That is not an IFC file (it should start with ISO-10303-21)")
        r = {"id": rid, "kind": "ifc", "name": clean(name, 80) or clean(os.path.splitext(file)[0], 80) or "Consultant model",
             "company": clean(company, 80), "discipline": clean(discipline, 40), "source_file": clean(file, 160),
             "ifc": "refs/%s.ifc" % rid, "fragments": "refs/%s.frag" % rid, "format": "frag",
             "status": "waiting", "progress": 0, "error": "", "mb": None, "ifc_mb": round(size / 1048576.0, 1),
             "placement": placement_of({}), "opacity": 1, "on": True,
             "by": w.name or "", "by_uid": w.uid, "at": now_iso()}
        with _LOCK:
            refs = read_refs(root)
            refs.append(r)
            write_refs(root, refs)
        convert(core, root, pid, rid, src, os.path.join(folder, rid + ".frag"))
        return {"ref": r}

    @app.post("/api/refs/overlay")
    async def refs_overlay(request: Request, x_viewer_token: str = Header(default="")):
        """{project, model, name}: another project's 3D model, overlaid here."""
        w, role, pid, root = project(request, x_viewer_token, "member")
        b = await request.json() or {}
        src = str(b.get("project") or "")
        if src == pid:
            raise HTTPException(status_code=400, detail="That is this project's own model")
        core.require_project(request, src, "viewer", x_viewer_token)
        try:
            with open(os.path.join(core.project_root_for(src), "manifest.json"), encoding="utf-8") as f:
                man = json.load(f)
        except Exception:
            raise HTTPException(status_code=404, detail="That project has no 3D yet")
        models = [m for m in man.get("models") or [] if m.get("name") == b.get("model")]
        if not models:
            raise HTTPException(status_code=404, detail="No such model in that project")
        rid = uuid.uuid4().hex[:12]
        r = {"id": rid, "kind": "overlay", "name": clean(b.get("name"), 80) or "%s · %s" % (src, models[0]["name"]),
             "company": clean(b.get("company"), 80), "discipline": clean(b.get("discipline"), 40),
             "project": src, "model": models[0]["name"], "status": "ready",
             "placement": placement_of(b.get("placement") or {}), "opacity": 1, "on": True,
             "by": w.name or "", "by_uid": w.uid, "at": now_iso()}
        with _LOCK:
            refs = read_refs(root)
            refs.append(r)
            write_refs(root, refs)
        return {"ref": r}

    @app.get("/api/refs/sources")
    async def refs_sources(request: Request, x_viewer_token: str = Header(default="")):
        """The other projects' 3D models I can open (for an overlay)."""
        w, role, pid, root = project(request, x_viewer_token)
        out = []
        for p in core.list_projects():
            if p["id"] == pid or not core.role_in(w, p["id"]):
                continue
            try:
                with open(os.path.join(core.project_root_for(p["id"]), "manifest.json"), encoding="utf-8") as f:
                    man = json.load(f)
            except Exception:
                continue
            ms = [{"name": m.get("name"), "format": m.get("format") or "frag", "role": m.get("role") or ""}
                  for m in man.get("models") or [] if m.get("name")]
            if ms:
                out.append({"id": p["id"], "title": p["title"], "models": ms,
                            "standalone": bool((man.get("source") or {}).get("ifc_only"))})
        return {"projects": out}

    @app.patch("/api/refs/{rid}")
    async def refs_patch(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """{name, company, discipline, placement, opacity, on} - what everyone sees."""
        w, role, pid, root = project(request, x_viewer_token, "member")
        b = await request.json() or {}
        with _LOCK:
            refs = read_refs(root)
            r = next((x for x in refs if x["id"] == rid), None)
            if not r:
                raise HTTPException(status_code=404, detail="No such consultant model")
            if not can_change(w, role, r):
                raise HTTPException(status_code=403, detail="Only who added it, or a project admin, can change it")
            for k, n in (("name", 80), ("company", 80), ("discipline", 40)):
                if k in b:
                    r[k] = clean(b[k], n) or r[k]
            if "placement" in b:
                r["placement"] = placement_of(b["placement"])
            if "opacity" in b:
                r["opacity"] = max(0.1, min(1.0, float(b["opacity"] or 1)))
            if "on" in b:
                r["on"] = bool(b["on"])
            r["changed_by"], r["changed_at"] = w.name or "", now_iso()
            write_refs(root, refs)
        return {"ref": r}

    @app.delete("/api/refs/{rid}")
    async def refs_delete(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        w, role, pid, root = project(request, x_viewer_token, "member")
        if not SAFE_ID.match(rid):
            raise HTTPException(status_code=404, detail="No such consultant model")
        with _LOCK:
            refs = read_refs(root)
            r = next((x for x in refs if x["id"] == rid), None)
            if not r:
                raise HTTPException(status_code=404, detail="No such consultant model")
            if not can_change(w, role, r):
                raise HTTPException(status_code=403, detail="Only who added it, or a project admin, can remove it")
            write_refs(root, [x for x in refs if x["id"] != rid])
        for ext in (".ifc", ".frag", ".frag.part"):
            p = os.path.join(root, "refs", rid + ext)
            if os.path.isfile(p):
                os.remove(p)
        return {"ok": True}

    @app.post("/api/refs/{rid}/convert")
    async def refs_reconvert(request: Request, rid: str, x_viewer_token: str = Header(default="")):
        """Try the conversion again (after installing the converter)."""
        w, role, pid, root = project(request, x_viewer_token, "member")
        r = next((x for x in read_refs(root) if x["id"] == rid), None)
        if not r or r.get("kind") != "ifc" or not SAFE_ID.match(rid):
            raise HTTPException(status_code=404, detail="No such consultant model")
        if not can_change(w, role, r):
            raise HTTPException(status_code=403, detail="Only who added it, or a project admin")
        update_ref(root, rid, status="waiting", error="", progress=0)
        convert(core, root, pid, rid, os.path.join(root, "refs", rid + ".ifc"), os.path.join(root, "refs", rid + ".frag"))
        return {"ok": True}

    # ------------------------------------------------------------ case 3

    @app.post("/api/admin/projects/from-ifc")
    async def project_from_ifc(request: Request, id: str = "", title: str = "", file: str = "model.ifc",
                               x_viewer_token: str = Header(default="")):
        """A site admin makes a 3D project holding one IFC model: its own 3D
        page, a reference that needs no alignment with anything."""
        w = core.who(request, x_viewer_token)
        if core.accounts_on() and not w.site_admin:
            raise HTTPException(status_code=403, detail="Only a site admin can make a project")
        pid = clean(id, 60)
        if not pid or not core.SAFE_PROJECT.match(pid) or pid.startswith("."):
            raise HTTPException(status_code=400, detail="A short project id: letters, digits, - and _ (e.g. SKW-STR)")
        root = os.path.join(core.CFG["root"], pid)
        if os.path.exists(root):
            raise HTTPException(status_code=409, detail="There is already a project %s" % pid)
        if not file.lower().endswith(".ifc"):
            raise HTTPException(status_code=400, detail="An .ifc file please")
        os.makedirs(os.path.join(root, "fragments"))
        src = os.path.join(root, "fragments", "model.ifc")
        size, head = 0, b""
        try:
            with open(src, "wb") as f:
                async for chunk in request.stream():
                    if len(head) < 64:
                        head += chunk[:64]
                    size += len(chunk)
                    if size > MAX_IFC:
                        raise HTTPException(status_code=413, detail="IFC files up to 3 GB")
                    f.write(chunk)
            if not head.lstrip().startswith(b"ISO-10303-21"):
                raise HTTPException(status_code=400, detail="That is not an IFC file")
        except HTTPException:
            shutil.rmtree(root, ignore_errors=True)
            raise
        name = clean(os.path.splitext(file)[0], 80) or "Model"
        man = {"source": {"title": clean(title, 120) or pid, "ifc_only": True, "made_by": w.name or "", "made_at": now_iso()},
               "models": [{"name": name, "format": "frag", "fragments": "fragments/model.frag", "role": "host",
                           "status": "converting"}],
               "sheets": []}
        with open(os.path.join(root, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(man, f, indent=1, ensure_ascii=False)
        rid = uuid.uuid4().hex[:12]

        def done():
            try:
                with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
                    m = json.load(f)
                for x in m.get("models") or []:
                    x.pop("status", None)
                    x["fragments_mb"] = round(os.path.getsize(os.path.join(root, "fragments", "model.frag")) / 1048576.0, 1)
                with open(os.path.join(root, "manifest.json"), "w", encoding="utf-8") as f:
                    json.dump(m, f, indent=1, ensure_ascii=False)
            except Exception as e:
                core.bg_log("%s: manifest after conversion: %s" % (pid, e))

        # its progress is kept in refs.json, as a consultant model's is (the page shows it)
        with _LOCK:
            write_refs(root, [{"id": rid, "kind": "host", "name": name, "status": "waiting", "progress": 0,
                               "fragments": "fragments/model.frag", "format": "frag", "on": True, "opacity": 1,
                               "placement": placement_of({}), "hidden": True}])
        convert(core, root, pid, rid, src, os.path.join(root, "fragments", "model.frag"), after=done)
        return {"project": pid, "title": man["source"]["title"]}
