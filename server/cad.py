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
import collections
import subprocess
import sys
import threading
import time
import uuid
import zipfile

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

import cad_dxf
import cad_pdf
import cad_render
import procjob

_Sheet = collections.namedtuple("_Sheet", "name")

_RUN = threading.Semaphore(1)        # one drawing set at a time
# only what a file name cannot hold is changed (long CAD names with & ( ) - stay)
UNSAFE = re.compile(r'[\x00-\x1f<>:"/\\|?*]+')


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


def oda_convert(oda, src_dir, name, out_dir, timeout=900, fmt="DXF"):
    """One DWG -> DXF (ACAD2018), or (fmt "DWG") a DXF -> DWG. True when
    the output is there (the converter's exit code says little: on Linux it
    often 'crashes' after a good conversion)."""
    cmd = [oda, src_dir, out_dir, "ACAD2018", fmt, "0", "1", name]
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
    return os.path.isfile(os.path.join(out_dir, stem + "." + fmt.lower()))


def dxf_to_dwg(oda, dxf_path, dwg_path, timeout=300):
    """A DXF -> DWG (AutoCAD 2018), through a plain temporary name."""
    import tempfile
    tmp = tempfile.mkdtemp(prefix="lwk-oda-")
    try:
        i, o = os.path.join(tmp, "in"), os.path.join(tmp, "out")
        os.makedirs(i); os.makedirs(o)
        shutil.copyfile(dxf_path, os.path.join(i, "f.dxf"))
        if not oda_convert(oda, i, "f.dxf", o, timeout, fmt="DWG"):
            return False
        shutil.move(os.path.join(o, "f.dwg"), dwg_path)
        return True
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def clean(name):
    """A file name to keep: its folder dropped, unusable characters made
    "_", and a very long name shortened in its stem - never its extension."""
    name = os.path.basename(str(name or "").replace("\\", "/"))
    name = UNSAFE.sub("_", name).strip(" .")
    stem, ext = os.path.splitext(name)
    if len(name.encode("utf-8")) > 200:
        while len((stem + ext).encode("utf-8")) > 200:
            stem = stem[:-1]
        name = stem.rstrip(" .") + ext
    return name or "drawing.dwg"


def stem_key(name):
    """How an xref is matched to a file: its name without folder or
    extension, any case."""
    return os.path.splitext(os.path.basename(str(name or "").replace("\\", "/")))[0].strip().lower()


def convert_one(oda, src_path, out_path, timeout=900):
    """One DWG -> DXF, through a plain temporary name so that nothing in
    the real name ([ ] & spaces, length) can trouble the converter."""
    import tempfile
    tmp = tempfile.mkdtemp(prefix="lwk-oda-")
    try:
        i, o = os.path.join(tmp, "in"), os.path.join(tmp, "out")
        os.makedirs(i); os.makedirs(o)
        try:
            os.link(src_path, os.path.join(i, "f.dwg"))
        except OSError:
            shutil.copyfile(src_path, os.path.join(i, "f.dwg"))
        if not oda_convert(oda, i, "f.dwg", o, timeout):
            return False
        shutil.move(os.path.join(o, "f.dxf"), out_path)
        return True
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ensure_converted(src, out, names=None, progress=None):
    """DXF for each DWG / DXF in src (or the names given) in out, made
    once. -> the names that could not be converted."""
    os.makedirs(out, exist_ok=True)
    have = sorted(f for f in os.listdir(src) if os.path.splitext(f)[1].lower() in (".dwg", ".dxf"))
    todo = [f for f in have if names is None or f in names]
    failed = []
    oda = None
    for k, f in enumerate(todo):
        dest = os.path.join(out, os.path.splitext(f)[0] + ".dxf")
        if os.path.isfile(dest):
            continue
        if f.lower().endswith(".dxf"):
            shutil.copyfile(os.path.join(src, f), dest)
            continue
        oda = oda or find_oda()
        if progress:
            progress(k, len(todo), f)
        if not oda or not convert_one(oda, os.path.join(src, f), dest):
            failed.append(f)
    return failed


def xref_names(dxf_path):
    """The files a drawing references as xrefs (their names, as written)."""
    try:
        doc = cad_dxf.read(dxf_path)
    except Exception:
        return []
    out = []
    for b in doc.blocks.values():
        if b.is_xref:
            nm = os.path.basename((b.xref or (b.name + ".dwg")).replace("\\", "/"))
            if nm and nm not in out:
                out.append(nm)
    return out


def folders_roots(core, pid, w=None):
    """The folders (on the server) of the Folders projects this model is
    in - with w, only those the person can open."""
    try:
        import files
        import tasks
        regs = tasks.reg_ids_for_viewer(core, pid)
    except Exception:
        return []
    out = []
    for r in regs:
        try:
            if w is not None:
                files.can_open(core, w, r)
            out.append((r, files.root_of(r, make=False)))
        except Exception:
            continue
    return out


def find_in_folders(core, pid, keys, limit=60000, w=None):
    """{stem key: full path} for the files named like keys (.dwg / .dxf)
    anywhere in the model's Folders projects (the newest copy of each)."""
    found = {}
    keys = set(keys)
    seen = 0
    for reg, root in folders_roots(core, pid, w):
        if not root or not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if not x.startswith(".")]
            for f in filenames:
                seen += 1
                if seen > limit:
                    return found
                if os.path.splitext(f)[1].lower() not in (".dwg", ".dxf"):
                    continue
                k = stem_key(f)
                if k in keys:
                    full = os.path.join(dirpath, f)
                    try:
                        t = os.path.getmtime(full)
                    except OSError:
                        continue
                    if k not in found or t > found[k][1]:      # several copies: the newest
                        found[k] = (full, t)
    return {k: v[0] for k, v in found.items()}


def sheet_number(stem, layout):
    """The layout's name when it reads like a drawing number (A-101,
    GBP-201), else the file's name with it."""
    if re.search(r"\d", layout) and len(layout) <= 30 and not re.match(r"(?i)^(layout|sheet|布局)\s*\d+$", layout):
        return layout
    return "%s %s" % (stem, layout) if layout.lower() != "model" else stem


def render_to_file(path, by_stem, mono, out_pdf):
    """One drawing's layouts drawn as a PDF (out_pdf): {"sheets": [{name,
    w, h}], "notes": what was left out}. Plain arguments and result, so it
    runs in its own process (procjob.py) - drawing a big DWG is minutes of
    work the server should not do between its answers."""
    cache = {}

    def xref(p):
        stem = stem_key(p)
        q = by_stem.get(stem)
        if not q:
            return None
        if stem not in cache:
            try:
                cache[stem] = cad_dxf.read(q)
            except Exception:
                cache[stem] = None
        return cache[stem]
    notes = {}
    doc = cad_dxf.read(path)
    pdf, sheets = cad_render.render(doc, xref=xref, mono=mono, notes=notes)
    for sh in sheets:
        pdf.add_page(sh.w, sh.h, sh.content)
    if sheets:
        with open(out_pdf, "wb") as fo:
            fo.write(pdf.bytes())
    clean_notes = {k: (sorted(v) if isinstance(v, (set, frozenset)) else v) for k, v in notes.items()}
    return {"sheets": [{"name": sh.name, "w": sh.w, "h": sh.h} for sh in sheets], "notes": clean_notes}


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
    def cad_tools(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
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
        # the rest on a thread: the server keeps answering everyone meanwhile
        def _rest():
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
            files_ = list_src(src)
            write_job(d, status="uploading", files=files_)
            return {"job": job, "files": files_}
        return await run_in_threadpool(_rest)

    def list_src(src):
        return [{"name": f, "mb": round(os.path.getsize(os.path.join(src, f)) / 1048576.0, 1)}
                for f in sorted(os.listdir(src)) if os.path.splitext(f)[1].lower() in (".dwg", ".dxf")]

    @app.post("/api/import/cad/from-folders")
    async def cad_from_folders(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """Drawings already in Folders into an import (copied on the
        server: nothing is downloaded or sent again)."""
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        body = await request.json() or {}
        # the rest on a thread: the server keeps answering everyone meanwhile
        def _rest():
            import files
            reg = str(body.get("reg") or "")
            froot = files.can_open(core, w, reg)
            job = body.get("job") or uuid.uuid4().hex[:12]
            d = job_dir(root, job)
            src = os.path.join(d, "src")
            os.makedirs(src, exist_ok=True)
            for p in body.get("paths") or []:
                full = files.inside(froot, files.clean_rel(p))
                if not os.path.isfile(full) or os.path.splitext(full)[1].lower() not in (".dwg", ".dxf"):
                    raise HTTPException(status_code=400, detail="%s: not a DWG or DXF file in Folders" % p)
                shutil.copyfile(full, os.path.join(src, clean(os.path.basename(full))))
            files_ = list_src(src)
            write_job(d, status="uploading", files=files_)
            return {"job": job, "files": files_}
        return await run_in_threadpool(_rest)

    @app.post("/api/import/cad/scan")
    async def cad_scan(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        """Reads the drawings (DWG -> DXF) and lists the xrefs they need -
        and the xrefs' own. Those found in the model's Folders are copied
        in by themselves; the rest are listed for the page to send."""
        core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        body = await request.json() or {}
        # the rest on a thread: the server keeps answering everyone meanwhile
        def _rest():
            d = job_dir(root, body.get("job"))
            src = os.path.join(d, "src")
            if not os.path.isdir(src):
                raise HTTPException(status_code=404, detail="Send the files first")
            have = [f["name"] for f in list_src(src)]
            drawings = [clean(x) for x in (body.get("drawings") or []) if clean(x) in have] or have
            if any(f.lower().endswith(".dwg") for f in have) and not find_oda():
                raise HTTPException(status_code=400, detail="The server has no ODA File Converter, so it cannot read DWG files. "
                                    "Ask the server's admin to install it - or send DXF files.")
            use_folders = body.get("folders", True) is not False
            pid = x_project
            w = core.who(request, x_viewer_token)
            write_job(d, status="scanning", progress=0, message="Reading the drawings ...", drawings=drawings)

            def run():
                with _RUN:
                    try:
                        scan_job(d, src, drawings, pid, use_folders, w)
                    except Exception as e:
                        write_job(d, status="failed", message="Not read: %s" % e)
            threading.Thread(target=run, daemon=True).start()
            return {"job": os.path.basename(d)}
        return await run_in_threadpool(_rest)

    def scan_job(d, src, drawings, pid, use_folders, w):
        """Round by round: read (convert) the files of this round, collect
        their xrefs; those not sent are looked for in Folders (one search
        a round) and read in the next round, as are those sent."""
        out = os.path.join(d, "dxf")
        j = read_job(d)
        xr = j.get("xrefs") or {}             # file -> its xref names
        from_folders = list(j.get("from_folders") or [])
        failed = set(j.get("failed") or [])
        done, needed, searched = set(), {}, set()
        queue = list(dict.fromkeys(drawings))
        rounds = 0
        while queue and rounds < 8:
            rounds += 1
            write_job(d, status="scanning", message="Reading %d drawing(s) ..." % len(queue))
            failed |= set(ensure_converted(src, out, queue, progress=lambda k, n, f: write_job(
                d, status="scanning", message="Reading %s (%d of %d) ..." % (f, k + 1, n))))
            local = {stem_key(x): x for x in os.listdir(src) if os.path.splitext(x)[1].lower() in (".dwg", ".dxf")}
            nxt, missing = [], {}
            for f in queue:
                done.add(f)
                dxf = os.path.join(out, os.path.splitext(f)[0] + ".dxf")
                if f not in xr and os.path.isfile(dxf):
                    xr[f] = xref_names(dxf)
                for nm in xr.get(f, []):
                    k = stem_key(nm)
                    if k in local:
                        nxt.append(local[k])
                    else:
                        missing[k] = nm
            if missing and use_folders:
                look = [k for k in missing if k not in searched]
                searched.update(look)
                if look:
                    write_job(d, status="scanning", message="Looking for %d xref(s) in Folders ..." % len(look))
                    for k, hit in find_in_folders(core, pid, look, w=w).items():
                        nm2 = clean(os.path.basename(hit))
                        shutil.copyfile(hit, os.path.join(src, nm2))
                        from_folders.append(os.path.basename(hit))
                        nxt.append(nm2)
                        missing.pop(k, None)
            needed.update(missing)
            queue = [x for x in dict.fromkeys(nxt) if x not in done]
        # an xref found later is not needed any more
        have = {stem_key(x) for x in os.listdir(src)}
        needed = {k: v for k, v in needed.items() if k not in have}
        write_job(d, status="scanned", message="", xrefs=xr, needed=sorted(needed.values(), key=str.lower),
                  from_folders=from_folders, failed=sorted(failed), files=list_src(src))

    @app.post("/api/import/cad/run")
    async def cad_run(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = core.require_project(request, x_project, "member", x_viewer_token)
        root = core.project_root_for(x_project)
        body = await request.json() or {}
        # the rest on a thread: the server keeps answering everyone meanwhile
        def _rest():
            d = job_dir(root, body.get("job"))
            src = os.path.join(d, "src")
            if not os.path.isdir(src):
                raise HTTPException(status_code=404, detail="Send the files first")
            have = [f for f in os.listdir(src) if os.path.splitext(f)[1].lower() in (".dwg", ".dxf")]
            drawings = [clean(x) for x in (body.get("drawings") or []) if clean(x) in have]
            if not drawings:
                # none named (a .zip): the files no other file uses as an xref
                used = {stem_key(n) for names in (read_job(d).get("xrefs") or {}).values() for n in names}
                drawings = [f for f in have if stem_key(f) not in used] or have
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
        return await run_in_threadpool(_rest)

    @app.get("/api/import/cad/{job}")
    def cad_job(request: Request, job: str, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
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
        # 1. DWG -> DXF (every file: the xrefs too; those read by the scan are not read again)
        failed = ensure_converted(src, out, progress=lambda k, n, f: write_job(
            d, status="converting", progress=int(40 * k / max(1, n)), message="Reading %s (%d of %d) ..." % (f, k + 1, n)))
        by_stem = {}
        for f in os.listdir(out):
            if f.lower().endswith(".dxf"):
                by_stem[stem_key(f)] = os.path.join(out, f)
        # 2. each drawing: its layouts as pages
        added, report = [], []
        for k, f in enumerate(drawings):
            stem = os.path.splitext(f)[0]
            write_job(d, status="drawing", progress=40 + int(55 * k / max(1, len(drawings))), message="Drawing %s (%d of %d) ..." % (f, k + 1, len(drawings)))
            p = by_stem.get(stem.lower())
            if not p:
                report.append({"file": f, "error": "could not be read" + (" (the converter failed)" if f in failed else "")})
                continue
            fname = "%s-%s.pdf" % (re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:60] or "drawing", uuid.uuid4().hex[:8])
            folder = os.path.join(root, "imported")
            os.makedirs(folder, exist_ok=True)
            try:
                # drawn in its own process: the server keeps answering meanwhile
                got = procjob.run("cad", "render_to_file", [p, by_stem, mono, os.path.join(folder, fname)], timeout=3600)
            except Exception as e:
                report.append({"file": f, "error": "could not be drawn: %s" % e})
                continue
            sheets = [_Sheet(x["name"]) for x in got["sheets"]]
            notes = dict(got["notes"])
            if not sheets:
                report.append({"file": f, "error": "nothing to draw (no layouts and an empty model)"})
                continue
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
