# -*- coding: utf-8 -*-
"""The GBP workbook (Codes > GBP workbook): what a project's people put in
beside the model - the site's data, a room's use or the doors it has where
the model does not say, rows of their own, the staircases - kept with the
project. The calculations are the page's (viewer/gbpcore.js); the server
keeps the inputs and makes the Excel.

  GET  /api/gbp            the workbook (viewer)
  PUT  /api/gbp            {rev, data} (member); a stale rev -> 409 with the
                           current one, so two people do not overwrite each other
  POST /api/gbp/xlsx       {name, sheets: [{name, title, note, head, rows, marks}]}
                           -> the .xlsx, kept too in Folders > 00 BIM > Exports > GBP

Kept in <project>/gbp/workbook.json; the last 20 versions in gbp/history/.
"""
import json
import os
import re
import time

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 8 * 1024 * 1024
KEEP_HISTORY = 20
PARTS = ("site", "map", "rooms", "areas", "stairs", "storeys", "b1", "limits", "notes", "sanitary", "fire", "green", "eva")


def _dir(core, pid, sub=""):
    d = os.path.join(core.project_root_for(pid), "gbp", sub)
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
    """Only the workbook's own parts, each a dict or list as sent."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="The workbook is an object")
    out = {}
    for k in PARTS:
        v = data.get(k)
        if v is None:
            continue
        if not isinstance(v, (dict, list)):
            raise HTTPException(status_code=400, detail="Workbook part %s is not a table" % k)
        out[k] = v
    return out


def load(core, pid):
    wb = _read(os.path.join(_dir(core, pid), "workbook.json"))
    return wb or {"rev": 0, "data": {}, "by": "", "at": ""}


def save(core, pid, rev, data, who):
    d = _dir(core, pid)
    cur = load(core, pid)
    if int(rev or 0) != int(cur.get("rev") or 0):
        raise HTTPException(status_code=409, detail={"message": "Someone else changed the workbook meanwhile", "current": cur})
    out = {"rev": int(cur.get("rev") or 0) + 1, "data": clean(data), "by": who or "",
           "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    _write(os.path.join(d, "workbook.json"), out)
    h = _dir(core, pid, "history")
    _write(os.path.join(h, "%s-r%d.json" % (time.strftime("%Y%m%d-%H%M%S"), out["rev"])), out)
    for f in sorted(os.listdir(h))[:-KEEP_HISTORY]:
        try:
            os.remove(os.path.join(h, f))
        except OSError:
            pass
    return out


def make_xlsx(sheets, project=""):
    """sheets: [{name, title, note, head: [..], rows: [[..]], marks: ["ok"|"fail"|"check"|""], widths}]"""
    import xlsx
    wb = xlsx.Workbook()
    st_title = wb.style(bold=True, size=12)
    st_note = wb.style(italic=True, color="595959", wrap=True)
    st_head = wb.style(bold=True, fill="3A3A3A", color="FFFFFF", border=True, wrap=True, v="center")
    st_cell = wb.style(border=True, wrap=True)
    st_fail = wb.style(border=True, wrap=True, color="B42318", bold=True)
    st_check = wb.style(border=True, wrap=True, color="9A6700")
    st_ok = wb.style(border=True, wrap=True, color="1A7F37")
    for s in sheets or []:
        head = [str(h) for h in (s.get("head") or [])][:60]
        widths = s.get("widths") or [max(10, min(48, len(h) + 4)) for h in head]
        ws = wb.sheet(re.sub(r"[\[\]:*?/\\]", " ", str(s.get("name") or "Sheet"))[:31] or "Sheet", widths=widths)
        ws.row([str(s.get("title") or s.get("name") or "")], style=st_title, height=20)
        if project:
            ws.row(["Project: " + project], style=st_note)
        if s.get("note"):
            ws.row([str(s["note"])[:2000]], style=st_note)
        ws.row([])
        ws.row(head, style=st_head, height=30)
        marks = s.get("marks") or []
        for i, r in enumerate((s.get("rows") or [])[:20000]):
            m = marks[i] if i < len(marks) else ""
            st = {"fail": st_fail, "check": st_check, "ok": st_cell}.get(m, st_cell)
            vals = []
            for v in r[:60]:
                vals.append(v if isinstance(v, (int, float)) and not isinstance(v, bool) else ("" if v is None else str(v)))
            styles = [st] * len(vals)
            if m in ("ok", "fail", "check") and vals:
                styles[-1] = {"ok": st_ok, "fail": st_fail, "check": st_check}[m]
            ws.row(vals, styles=styles)
    return wb.save()


def register(app, core):

    @app.get("/api/gbp")
    def gbp_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, role = core.require_project(request, x_project, "viewer", x_viewer_token)
        out = load(core, x_project)
        out["can_edit"] = core.RANK.get(role, 0) >= core.RANK["member"] or not core.accounts_on()
        return out

    @app.put("/api/gbp")
    async def gbp_put(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        raw = await request.body()
        if len(raw) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="The workbook is over 8 MB")
        try:
            body = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send {rev, data}")
        return await run_in_threadpool(save, core, x_project, body.get("rev"), body.get("data"), getattr(w, "name", "") or "")

    @app.post("/api/gbp/xlsx")
    async def gbp_xlsx(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "viewer", x_viewer_token)
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("sheets"), list):
            raise HTTPException(status_code=400, detail="Send {name, sheets}")
        name = re.sub(r"[^\w .()&+-]+", "_", str(body.get("name") or "GBP workbook"))[:100].strip() or "GBP workbook"
        if not name.lower().endswith(".xlsx"):
            name += ".xlsx"
        data = await run_in_threadpool(make_xlsx, body["sheets"], str(body.get("project") or "")[:200])
        kept = ""
        if body.get("keep", True):
            try:
                import files as F
                import tasks
                regs = tasks.reg_ids_for_viewer(core, "default" if core.CFG["single"] else x_project)
                if regs:
                    kept = await run_in_threadpool(F.keep_file, regs[0], [F.BIM, "Exports", "GBP"], name, data,
                                                   getattr(w, "uid", None), getattr(w, "name", "") or "")
            except Exception as ex:
                print("gbp: not kept in Folders: %s" % ex)
        return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": 'attachment; filename="%s"' % name,
                                 "X-Kept": str(kept or "")[:500]})
