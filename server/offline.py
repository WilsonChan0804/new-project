"""Offline copies - the two lists a browser needs before it can keep a
project on the device (viewer/offline.js, viewer/sw.js).

Registered by app.py:  offline.register(app, core)  where `core` is the app
module itself (require_project, project_dir, CFG, VIEWER_DIR ...).

  GET /api/offline/shell
      The viewer's own files (html, js, css, vendor, icons) with a size and
      a tag each, and one version for the whole set. The service worker
      keeps a complete copy of exactly this set - never some files from one
      update and some from another - and asks again on every page load;
      the answer is a few kB and an unchanged set costs nothing more.
      No sign-in: these are the files anyone can already fetch from "/".

  GET /api/offline/plan?project=<id>
      Every file of the project a device could ask for - sheet PDFs, the
      picture tiles of each sheet, the model files in each of their forms
      (whole, streamed tiles, phone copy, exterior list, properties) - with
      sizes and tags. The browser picks what THIS device would load, shows
      how much that is before downloading, and later compares tags to fetch
      only what changed. The tag is the one /data/... sends as its ETag.

Nothing here writes anything.
"""

import hashlib
import json
import os
import re

from fastapi import Header, HTTPException, Request
from fastapi.responses import JSONResponse

# What the pages load from "/" - not the .bat / .py helpers beside them.
SHELL_EXT = (".html", ".js", ".css", ".json", ".webmanifest", ".png", ".svg",
             ".ico", ".jpg", ".woff", ".woff2", ".wasm")


def _tag(path):
    st = os.stat(path)
    return "%x-%x" % (st.st_mtime_ns, st.st_size), st.st_size


def _entry(root, rel, use=None):
    """One file of a project, or None when it is not there."""
    rel = (rel or "").replace("\\", "/")
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        return None
    p = os.path.join(root, *rel.split("/"))
    if not os.path.isfile(p):
        return None
    tag, size = _tag(p)
    out = {"path": rel, "bytes": size, "tag": tag}
    if use:
        out["use"] = use
    return out


def register(app, core):

    @app.get("/api/offline/shell")
    async def offline_shell():
        files = []
        top = core.VIEWER_DIR
        for folder, dirs, names in os.walk(top):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d != "__pycache__")
            for n in sorted(names):
                if n.startswith(".") or not n.lower().endswith(SHELL_EXT):
                    continue
                p = os.path.join(folder, n)
                try:
                    tag, size = _tag(p)
                except OSError:
                    continue
                files.append({"path": os.path.relpath(p, top).replace(os.sep, "/"),
                              "bytes": size, "tag": tag})
        h = hashlib.sha1()
        for f in files:
            h.update(("%s|%s\n" % (f["path"], f["tag"])).encode("utf-8"))
        return JSONResponse({"version": h.hexdigest()[:16], "files": files},
                            headers={"Cache-Control": "no-store"})

    @app.get("/api/offline/plan")
    async def offline_plan(request: Request, project: str = "",
                           x_viewer_token: str = Header(default=""),
                           x_project: str = Header(default="")):
        pid = "default" if core.CFG["single"] else (project or x_project)
        core.require_project(request, pid, "viewer", x_viewer_token)
        root = core.project_dir(pid)
        if not root:
            raise HTTPException(status_code=404, detail="No such project")
        try:
            with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
                man = json.load(f)
        except (OSError, ValueError):
            raise HTTPException(status_code=422, detail="manifest.json of this project is empty or damaged")

        # ---- sheets: the PDF, and the server's picture tiles of each page
        sheets, seen_pdf = [], {}
        for sh in list(man.get("sheets") or []) + list(core.read_imported(root)):
            rel = str(sh.get("pdf") or "").replace("\\", "/")
            if not rel:
                continue
            try:
                page = max(1, int(sh.get("page") or 1))
            except (TypeError, ValueError):
                page = 1
            if rel not in seen_pdf:
                seen_pdf[rel] = _entry(root, rel, "pdf")
            pdf = seen_pdf[rel]
            if not pdf:
                continue
            rec = {"number": sh.get("number"), "pdf": rel, "page": page,
                   "bytes": pdf["bytes"], "tag": pdf["tag"], "tiles": None}
            try:
                _, meta, binp = core._tiles_paths(root, rel, page)
                if meta and os.path.isfile(meta) and os.path.isfile(binp):
                    rec["tiles"] = _entry(root, os.path.relpath(binp, root).replace(os.sep, "/"), "stb")
            except Exception:
                pass
            sheets.append(rec)

        # ---- models: every form a device might load
        models = []
        for m in man.get("models") or []:
            fr = str(m.get("fragments") or "").replace("\\", "/")
            if not fr:
                continue
            files = []
            whole = _entry(root, fr, "whole")
            if whole:
                files.append(whole)
            tiles = False
            if m.get("format") == "lwkm" and fr.lower().endswith(".lwkm"):
                stem = fr[:-5]
                src = os.path.join(root, *fr.split("/"))
                tidx, tbin = _entry(root, stem + ".tidx", "tidx"), _entry(root, stem + ".tbin", "tbin")
                try:
                    # the same test as the manifest's "tiles" (app.py, get_data)
                    tiles = bool(tidx and tbin and os.path.getmtime(src[:-5] + ".tidx")
                                 >= os.path.getmtime(src) - 1)
                except OSError:
                    tiles = False
                if tiles:
                    files += [tidx, tbin]
                ext = _entry(root, stem + ".ext.json", "ext")
                if ext:
                    files.append(ext)
                # phone copies: <name>.mobile<rule>.lwkm (model.js asks for its own rule's)
                folder = os.path.dirname(src)
                base = os.path.basename(stem)
                try:
                    sides = sorted(os.listdir(folder))
                except OSError:
                    sides = []
                for side in sides:
                    if re.match(re.escape(base) + r"\.mobile\d*\.lwkm$", side):
                        e = _entry(root, os.path.dirname(fr) + "/" + side, "mobile")
                        if e:
                            files.append(e)
            if m.get("props"):
                p = _entry(root, str(m.get("props")), "props")
                if p:
                    files.append(p)
            models.append({"name": m.get("name"), "format": m.get("format") or "",
                           "fragments": fr, "tiles": tiles, "files": files})

        mtag, _ = _tag(os.path.join(root, "manifest.json"))
        imp = os.path.join(root, core.IMPORTED)
        if os.path.isfile(imp):
            mtag += "+" + _tag(imp)[0]
        return JSONResponse({
            "project": pid,
            "title": (man.get("source") or {}).get("title") or pid,
            "manifest_tag": mtag,
            "sheets": sheets,
            "models": models,
        }, headers={"Cache-Control": "no-store"})
