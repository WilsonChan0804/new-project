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
PARTS = ("quick", "study", "site", "map", "rooms", "areas", "stairs", "storeys", "b1", "limits", "notes", "sanitary", "fire", "green", "eva")


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


TILE_URL = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/%d/%d/%d.png"
SEARCH_HOSTS = ["https://www.map.gov.hk", "https://geodata.gov.hk", "https://mapapi.geodata.gov.hk"]
SEARCH_PATH = "/gs/api/v1.0.0/locationSearch?q="


def _search_rows(body):
    """the Location Search answer: a list of places, or {results: [...]}; None when it is not one"""
    try:
        d = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if isinstance(d, dict) and isinstance(d.get("results"), list):
        d = d["results"]
    return d if isinstance(d, list) else None


def run_search(q, fetch=None):
    """the Lands Department's Location Search (www.map.gov.hk; the older hosts after it): HK 1980 Grid back"""
    import urllib.parse
    import urllib.request

    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "LWK-Viewer site study"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.read()
    fetch = fetch or get
    rows, tried = None, []
    for h in SEARCH_HOSTS:
        try:
            rows = _search_rows(fetch(h + SEARCH_PATH + urllib.parse.quote(q)))
            if rows is not None:
                break
            tried.append("%s: not a place list" % h.split("//")[1])
        except Exception as ex:
            tried.append("%s: %s" % (h.split("//")[1], ex))
    if rows is None:
        raise HTTPException(status_code=502, detail="The map search did not answer (" + "; ".join(tried) + ")")
    out = []
    for x in rows[:20]:
        try:
            out.append({"name": x.get("nameEN") or x.get("nameZH") or x.get("name") or "", "zh": x.get("nameZH") or "",
                        "address": x.get("addressEN") or x.get("addressZH") or x.get("address") or "",
                        "x": float(x.get("x", x.get("X"))), "y": float(x.get("y", x.get("Y")))})
        except (AttributeError, TypeError, ValueError):
            continue
    return out


def make_xlsx(sheets, project=""):
    """sheets: [{name, title, note, head: [..], rows: [[..]], marks: ["ok"|"fail"|"check"|"bold"|""], widths,
    fills: [[cell fill "#rrggbb" | None, ..] per row]}]"""
    import xlsx
    wb = xlsx.Workbook()
    st_title = wb.style(bold=True, size=12)
    st_note = wb.style(italic=True, color="595959", wrap=True)
    st_head = wb.style(bold=True, fill="3A3A3A", color="FFFFFF", border=True, wrap=True, v="center")
    st_cell = wb.style(border=True, wrap=True)
    st_fail = wb.style(border=True, wrap=True, color="B42318", bold=True)
    st_check = wb.style(border=True, wrap=True, color="9A6700")
    st_ok = wb.style(border=True, wrap=True, color="1A7F37")
    st_bold = wb.style(border=True, wrap=True, bold=True)
    fill_st = {}
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
            fr = (s.get("fills") or [])[i] if i < len(s.get("fills") or []) else None
            if isinstance(fr, list):
                for j, fc in enumerate(fr[:len(vals)]):
                    if isinstance(fc, str) and re.match(r"^#?[0-9A-Fa-f]{6}$", fc):
                        key = fc.lstrip("#").upper()
                        if key not in fill_st:
                            fill_st[key] = wb.style(border=True, wrap=True, fill=key, bold=m == "bold")
                        styles[j] = fill_st[key]
            if m == "bold":
                styles = [x if x is not st else st_bold for x in styles]
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

    @app.get("/api/site/tile/{z}/{x}/{y}")
    def site_tile(z: int, x: int, y: int):
        """Site study 3D ground: a Lands Department map tile through this
        server (the page cannot read it across origins), kept a while."""
        if not (10 <= z <= 19) or not (0 <= x < 2 ** z) or not (0 <= y < 2 ** z):
            raise HTTPException(status_code=400, detail="Not a tile")
        d = os.path.join(core.CFG["data"], "tiles", str(z), str(x))
        f = os.path.join(d, "%d.png" % y)
        if os.path.exists(f) and time.time() - os.path.getmtime(f) < 30 * 86400:
            with open(f, "rb") as fh:
                return Response(content=fh.read(), media_type="image/png", headers={"Cache-Control": "max-age=86400"})
        import urllib.request
        try:
            req = urllib.request.Request(TILE_URL % (z, x, y), headers={"User-Agent": "LWK-Viewer site study"})
            with urllib.request.urlopen(req, timeout=12) as r:
                data = r.read()
        except Exception as ex:
            raise HTTPException(status_code=502, detail="The map did not answer: %s" % ex)
        try:
            os.makedirs(d, exist_ok=True)
            with open(f, "wb") as fh:
                fh.write(data)
        except OSError:
            pass
        return Response(content=data, media_type="image/png", headers={"Cache-Control": "max-age=86400"})

    @app.get("/api/site/search")
    def site_search(request: Request, q: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """Site study: find a place by name or address - the Lands Department's
        location search (geodata.gov.hk), HK 1980 Grid coordinates back."""
        core.require_project(request, x_project, "viewer", x_viewer_token)
        q = (q or "").strip()[:200]
        if not q:
            return {"results": []}
        return {"results": run_search(q)}

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
