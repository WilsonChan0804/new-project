"""CAD drawings (DWG / DXF) as sheets on the Sheets page.

Registered by app.py:  cad.register(app, core).

  1. The page sends the drawing(s) and their xrefs (or a .zip of them):
     POST /api/import/cad/file?job=&name=       (the body is the file)
  2. and says which files are drawings (the others are xrefs only):
     POST /api/import/cad/run {job, drawings, set, mono}
  3. On the server: the ODA File Converter turns every DWG into DXF
     (DXF files are used as they are), cad_render.py draws each layout
     of each drawing as a page of one PDF, and the pages are added as a set
     of imported sheets - as an uploaded PDF is.
     GET /api/import/cad/<job>                 progress, then the result
  GET /api/import/cad/tools                    what the server has

The ODA File Converter (free, from the Open Design Alliance) is found by
LWK_ODA, on the PATH (ODAFileConverter), or where its installer puts it.
On Linux it is a desktop program, so it is run inside a virtual screen
(xvfb-run, apt install xvfb). DXF files need no converter.
"""

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile

from fastapi import HTTPException, Request, Header

import cad_dxf
import cad_pdf
import cad_render

_RUN = threading.Semaphore(1)        # one drawing set at a time
SAFE = re.compile(r"[^A-Za-z0-9._ ()+-]+")


def find_oda():
    env = os.environ.get("LWK_ODA", "")
    if env and os.path.isfile(env):
        return env
    w = shutil.which("ODAFileConverter")
    if w:
        return w
    cands = ["/usr/bin/ODAFileConverter"] + sorted(glob.glob("/opt/ODAFileConverter*/ODAFileConverter"), reverse=True) \
        + sorted(glob.glob("/usr/lib/ODAFileConverter*/ODAFileConverter"), reverse=True) \
        + sorted(glob.glob("C:\\Program Files\\ODA\\ODAFileConverter*\\ODAFileConverter.exe"), reverse=True)
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def oda_convert(oda, src_dir, name, out_dir, timeout=900):
    """One DWG -> DXF (ACAD2018). True when the DXF is there (the
    converter's exit code says little: on Linux it often 'crashes' after
    a good conversion)."""
    cmd = [oda, src_dir, out_dir, "ACAD2018", "DXF", "0", "1", name]
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        xr = shutil.which("xvfb-run")
        if xr:
            cmd = [xr, "-a"] + cmd
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False
    except OSError:
        return False
    stem = os.path.splitext(name)[0]
    return os.path.isfile(os.path.join(out_dir, stem + ".dxf"))


def clean(name):
    name = os.path.basename(str(name or "").replace("\\", "/"))
    name = SAFE.sub("_", name).strip(" .")[:120]
    return name or "drawing.dwg"


def sheet_number(stem, layout):
    """The layout's name when it reads like a drawing number (A-101,
    GBP-201), else the file's name with it."""
    if re.search(r"\d", layout) and len(layout) <= 30 and not re.match(r"(?i)^(layout|sheet|布局)\s*\d+$", layout):
        return layout
    return "%s %s" % (stem, layout) if layout.lower() != "model" else stem


def register(app, core):

    def job_dir(root, job):
        if not re.match(r"^[0-9a-f]{12}$", job or ""):
            raise HTTPException(status_code=400, detail="No such import")
        return os.path.join(root, "imported", "cad", job)

    def read_job(d):
        try:
            with open(os.path.join(d, "job.json"), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def write_job(d, **kw):
        j = read_job(d)
        j.update(kw)
        tmp = os.path.join(d, "job.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(j, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(d, "job.json"))
        return j

    @app.get("/api/import/cad/tools")
    async def cad_tools(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        f = cad_pdf.cjk_font()
        return {"oda": bool(find_oda()), "xvfb": bool(shutil.which("xvfb-run")) or not sys.platform.startswith("linux"),
                "font": os.path.basename(f.path) if f else None}

    @app.post("/api/import/cad/file")
    async def cad_file(request: Request, job: str = "", name: str = "", x_viewer_token: str = Header(default=""),
                       x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        job = job or uuid.uuid4().hex[:12]
        d = job_dir(root, job)
        src = os.path.join(d, "src")
        os.makedirs(src, exist_ok=True)
        nm = clean(name)
        ext = os.path.splitext(nm)[1].lower()
        if ext not in (".dwg", ".dxf", ".zip"):
            raise HTTPException(status_code=400, detail="%s: send DWG or DXF files (or a .zip of them)" % nm)
        dest = os.path.join(src, nm)
        size = 0
        with open(dest, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > 1024 * 1048576:
                    raise HTTPException(status_code=413, detail="Files up to 1 GB")
                f.write(chunk)
        files = []
        if ext == ".zip":
            try:
                with zipfile.ZipFile(dest) as z:
                    for info in z.infolist():
                        inner = clean(info.filename)
                        if info.is_dir() or os.path.splitext(inner)[1].lower() not in (".dwg", ".dxf"):
                            continue
                        with z.open(info) as fi, open(os.path.join(src, inner), "wb") as fo:
                            shutil.copyfileobj(fi, fo)
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="%s is not a readable .zip" % nm)
            os.remove(dest)
        for f in sorted(os.listdir(src)):
            if os.path.splitext(f)[1].lower() in (".dwg", ".dxf"):
                files.append({"name": f, "mb": round(os.path.getsize(os.path.join(src, f)) / 1048576.0, 1)})
        write_job(d, status="uploading", files=files)
        return {"job": job, "files": files}

    @app.post("/api/import/cad/run")
    async def cad_run(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        body = await request.json() or {}
        d = job_dir(root, body.get("job"))
        src = os.path.join(d, "src")
        if not os.path.isdir(src):
            raise HTTPException(status_code=404, detail="Send the files first")
        have = [f for f in os.listdir(src) if os.path.splitext(f)[1].lower() in (".dwg", ".dxf")]
        drawings = [clean(x) for x in (body.get("drawings") or []) if clean(x) in have] or have
        set_name = core.clean_set_name(body.get("set")) or "CAD drawings"
        mono = body.get("mono", True) is not False
        if any(f.lower().endswith(".dwg") for f in have) and not find_oda():
            raise HTTPException(status_code=400, detail="The server has no ODA File Converter, so it cannot read DWG files. "
                                "Ask the server's admin to install it - or send DXF files.")
        write_job(d, status="waiting", progress=0, message="Waiting to start ...", drawings=drawings, set=set_name, by=w.name)
        pid = x_project

        def run():
            with _RUN:
                try:
                    convert_job(core, root, pid, d, src, have, drawings, set_name, mono)
                except Exception as e:
                    core.bg_log("%s: CAD import failed: %s" % (pid, e))
                    write_job(d, status="failed", message="Not done: %s" % e)
        threading.Thread(target=run, daemon=True).start()
        return {"job": os.path.basename(d)}

    @app.get("/api/import/cad/{job}")
    async def cad_job(request: Request, job: str, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        j = read_job(job_dir(root, job))
        if not j:
            raise HTTPException(status_code=404, detail="No such import")
        return j

    def convert_job(core_, root, pid, d, src, have, drawings, set_name, mono):
        t0 = time.time()
        out = os.path.join(d, "dxf")
        os.makedirs(out, exist_ok=True)
        # 1. DWG -> DXF (every file: the xrefs too)
        dwgs = [f for f in have if f.lower().endswith(".dwg")]
        failed = []
        if dwgs:
            oda = find_oda()
            for k, f in enumerate(dwgs):
                write_job(d, status="converting", progress=int(40 * k / len(dwgs)), message="Reading %s (%d of %d) ..." % (f, k + 1, len(dwgs)))
                if not oda_convert(oda, src, f, out):
                    failed.append(f)
        for f in have:
            if f.lower().endswith(".dxf"):
                shutil.copyfile(os.path.join(src, f), os.path.join(out, f))
        by_stem = {}
        for f in os.listdir(out):
            if f.lower().endswith(".dxf"):
                by_stem[os.path.splitext(f)[0].lower()] = os.path.join(out, f)
        cache = {}

        def xref(path):
            stem = os.path.splitext(os.path.basename(str(path).replace("\\", "/")))[0].lower()
            p = by_stem.get(stem)
            if not p:
                return None
            if stem not in cache:
                try:
                    cache[stem] = cad_dxf.read(p)
                except Exception:
                    cache[stem] = None
            return cache[stem]

        # 2. each drawing: its layouts as pages
        added, report = [], []
        for k, f in enumerate(drawings):
            stem = os.path.splitext(f)[0]
            write_job(d, status="drawing", progress=40 + int(55 * k / max(1, len(drawings))), message="Drawing %s (%d of %d) ..." % (f, k + 1, len(drawings)))
            p = by_stem.get(stem.lower())
            if not p:
                report.append({"file": f, "error": "could not be read" + (" (the converter failed)" if f in failed else "")})
                continue
            notes = {}
            try:
                doc = cad_dxf.read(p)
                pdf, sheets = cad_render.render(doc, xref=xref, mono=mono, notes=notes)
            except Exception as e:
                report.append({"file": f, "error": "could not be drawn: %s" % e})
                continue
            if not sheets:
                report.append({"file": f, "error": "nothing to draw (no layouts and an empty model)"})
                continue
            for sh in sheets:
                pdf.add_page(sh.w, sh.h, sh.content)
            fname = "%s-%s.pdf" % (re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:60] or "drawing", uuid.uuid4().hex[:8])
            folder = os.path.join(root, "imported")
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, fname), "wb") as fo:
                fo.write(pdf.bytes())
            recs = core_.add_imported(root, set_name, [
                {"number": sheet_number(stem, sh.name), "name": "%s - %s" % (stem, sh.name), "pdf": "imported/" + fname, "page": i + 1}
                for i, sh in enumerate(sheets)])
            added += recs
            missing = sorted(notes.pop("_missing_xrefs", set()))
            report.append({"file": f, "sheets": [r["number"] for r in recs], "missing_xrefs": missing,
                           "left_out": {k2: v for k2, v in notes.items()}})
            try:
                core_.queue_ocr(root, ["imported/" + fname])
            except Exception:
                pass
        core_.bg_log("%s: CAD import of %d drawing(s), %d sheet(s), in %.0f s" % (pid, len(drawings), len(added), time.time() - t0))
        write_job(d, status="done" if added else "failed", progress=100, report=report,
                  sheets=[r["number"] for r in added], set=set_name,
                  message=("%d sheet(s) made" % len(added)) if added else "No sheet could be made")
        # the source files are not kept (the PDF is): the folder goes, the job file stays for the page
        for sub in ("src", "dxf"):
            shutil.rmtree(os.path.join(d, sub), ignore_errors=True)
