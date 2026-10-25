# -*- coding: utf-8 -*-
"""Light & Ventilation (the Revit Light & Vent check) on the server.

  POST /api/lv/report        the add-in's result (member): rooms with their
                             outlines in shared coordinates, windows, status
  GET  /api/lv               the latest report (viewer); ?summary=1: counts only
  POST /api/lv/pdf           the diagrams PDF {name, b64} (member): kept here
                             and in Folders > 00 BIM > Exports > Light & Ventilation
  GET  /api/lv/pdf           that PDF
  POST /api/lv/diagrams      the window diagrams (lv_report_manifest.json) from a PC
                             that could not make the PDF: made here (lv_diagram_pdf.py,
                             a copy of the add-in's, in its own process)

Kept in <project>/lv/: report.json, history/<time>.json (the last 10),
diagrams.pdf. The rooms are drawn by the viewer on the plan sheets of the
same floor - also sheets of another model on the same shared coordinates.
"""

import base64
import json
import os
import re
import threading
import time

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

MAX_REPORT = 80 * 1024 * 1024
MAX_PDF = 100 * 1024 * 1024
KEEP_HISTORY = 10
STATUSES = ("OK", "NOT OK", "NEEDS DATA", "NO WINDOW")


def _dir(core, pid, sub=""):
    d = os.path.join(core.project_root_for(pid), "lv", sub)
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


def counts(rooms):
    """Rooms by status; a room counted with another ("WITH 131") as merged."""
    out = dict((s, 0) for s in STATUSES)
    out["merged"] = 0
    for r in rooms or []:
        st = str(r.get("status") or "")
        if st.startswith("WITH"):
            out["merged"] += 1
        else:
            out[st] = out.get(st, 0) + 1
    return out


def summarise(rep):
    if not rep:
        return {"report": False}
    rooms = rep.get("rooms") or []
    by_tower = {}
    for r in rooms:
        by_tower.setdefault(r.get("block") or "", []).append(r)
    return {"report": True, "counts": counts(rooms), "rooms": len(rooms), "model": rep.get("model") or "",
            "towers": dict((k, counts(v)) for k, v in sorted(by_tower.items()) if k),
            "by": rep.get("by") or "", "at": rep.get("at") or "", "sent_by": rep.get("sent_by") or "",
            "sent_at": rep.get("sent_at") or "", "levels": rep.get("levels") or [],
            "placed": sum(1 for r in rooms if r.get("loops_sh")), "pdf": bool(rep.get("pdf")),
            "pdf_state": rep.get("pdf_state") or "", "pdf_error": rep.get("pdf_error") or ""}


def clean(data):
    if not isinstance(data, dict) or not isinstance(data.get("rooms"), list):
        raise HTTPException(status_code=400, detail="Send the result the Light & Vent check makes")
    for r in data["rooms"]:
        if not isinstance(r, dict):
            raise HTTPException(status_code=400, detail="A room is not an object")
    return data


def register(app, core):

    def keep(pid, data, who):
        d = _dir(core, pid)
        old = _read(os.path.join(d, "report.json"))
        data["sent_by"] = who
        data["sent_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        if old and old.get("pdf"):
            data.setdefault("pdf", old["pdf"])          # the diagrams of the last run, until new ones come
        _write(os.path.join(d, "report.json"), data)
        h = _dir(core, pid, "history")
        _write(os.path.join(h, time.strftime("%Y%m%d-%H%M%S") + ".json"), data)
        for f in sorted(os.listdir(h))[:-KEEP_HISTORY]:
            try:
                os.remove(os.path.join(h, f))
            except OSError:
                pass
        return summarise(data)

    def keep_pdf(pid, pdf, name, uid, who):
        """The diagrams PDF: kept here, noted on the report, and in Folders
        (00 BIM > Exports > Light & Ventilation) when the project has them."""
        d = _dir(core, pid)
        tmp = os.path.join(d, "diagrams.pdf.tmp")
        with open(tmp, "wb") as f:
            f.write(pdf)
        os.replace(tmp, os.path.join(d, "diagrams.pdf"))
        rep = _read(os.path.join(d, "report.json"))
        if rep is not None:
            rep["pdf"] = {"name": name, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "by": who}
            rep.pop("pdf_state", None)
            rep.pop("pdf_error", None)
            _write(os.path.join(d, "report.json"), rep)
        kept = None
        try:
            import files as F
            import tasks
            regs = tasks.reg_ids_for_viewer(core, "default" if core.CFG["single"] else pid)
            if regs:
                kept = F.keep_file(regs[0], [F.BIM, "Exports", "Light & Ventilation"], name, pdf, uid, who)
        except Exception as ex:
            print("lv: diagrams not kept in Folders: %s" % ex)
        return kept

    def note(pid, **kw):
        p = os.path.join(_dir(core, pid), "report.json")
        rep = _read(p)
        if rep is not None:
            rep.update(kw)
            _write(p, rep)

    def make_pdf(pid, src, uid, who):
        """The diagrams JSON into the PDF, in its own process (reportlab)."""
        import procjob
        d = _dir(core, pid)
        out = os.path.join(d, "diagrams-new.pdf")
        try:
            procjob.run("lv_diagram_pdf", "build_pdf", [src, out], timeout=1800)
            with open(out, "rb") as f:
                pdf = f.read()
            os.remove(out)
            keep_pdf(pid, pdf, "light_and_ventilation_diagrams.pdf", uid, who)
        except Exception as ex:
            msg = str(ex)
            if "reportlab" in msg:
                msg = "the server needs reportlab for the diagrams (pip install reportlab, then restart)"
            note(pid, pdf_state="error", pdf_error=msg[-300:])

    @app.post("/api/lv/diagrams")
    async def lv_diagrams(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_REPORT:
            raise HTTPException(status_code=413, detail="The diagrams are over 80 MB")
        try:
            data = await run_in_threadpool(lambda: json.loads(raw.decode("utf-8")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(data, dict) or not isinstance(data.get("diagrams"), list):
            raise HTTPException(status_code=400, detail="Send the diagrams file Light & Vent makes")
        src = os.path.join(_dir(core, x_project), "diagrams.json")
        await run_in_threadpool(_write, src, data)
        note(x_project, pdf_state="making", pdf_error="")
        threading.Thread(target=make_pdf, args=(x_project, src, w.uid, w.name or ""), daemon=True).start()
        return {"ok": True, "making": True, "diagrams": len(data["diagrams"])}

    @app.post("/api/lv/report")
    async def lv_report(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_REPORT:
            raise HTTPException(status_code=413, detail="The report is over 80 MB")
        try:
            data = await run_in_threadpool(lambda: json.loads(raw.decode("utf-8")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        clean(data)
        return await run_in_threadpool(keep, x_project, data, w.name or "")

    @app.get("/api/lv")
    def lv_get(request: Request, summary: int = 0,
               x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        rep = _read(os.path.join(_dir(core, x_project), "report.json"))
        if summary:
            return summarise(rep)
        return {"report": rep, "summary": summarise(rep)}

    @app.post("/api/lv/pdf")
    async def lv_pdf(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        body = await request.body()
        if len(body) > MAX_PDF * 4 // 3 + 4096:
            raise HTTPException(status_code=413, detail="The PDF is over 100 MB")
        try:
            j = json.loads(body.decode("utf-8"))
            pdf = base64.b64decode(j.get("b64") or "")
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Send {name, b64}")
        if not pdf.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Not a PDF")
        name = re.sub(r"[^\w .()-]+", "_", j.get("name") or "light_and_ventilation_diagrams.pdf")[:120]
        if not name.lower().endswith(".pdf"):
            name += ".pdf"

        def _rest():
            return {"ok": True, "folders": keep_pdf(x_project, pdf, name, w.uid, w.name or "")}
        return await run_in_threadpool(_rest)

    @app.get("/api/lv/pdf")
    def lv_pdf_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        p = os.path.join(_dir(core, x_project), "diagrams.pdf")
        if not os.path.isfile(p):
            raise HTTPException(status_code=404, detail="No diagrams PDF yet - in Revit, Light & Vent with the diagrams")
        rep = _read(os.path.join(_dir(core, x_project), "report.json")) or {}
        name = ((rep.get("pdf") or {}).get("name")) or "light_and_ventilation_diagrams.pdf"
        with open(p, "rb") as f:
            data = f.read()
        return Response(content=data, media_type="application/pdf",
                        headers={"Content-Disposition": 'inline; filename="%s"' % name.replace('"', "")})
