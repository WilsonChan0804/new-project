"""Folders: a project's files, kept in a folder on the server, shown in the
viewer (folders.html) the way ACC Docs or a shared drive shows them.

Each project on the Projects page has one folder. A site admin says where
(any path the server can reach: a drive of the VM, a network share, later
a cloud or local server's disk); until then it is
<data>/project_files/<project id>. Files put there by other means (Windows
Explorer, a sync tool) simply show up - the folder on disk is the truth,
nothing is copied into a database.

Who may do what:
  - the project's people (its owners and the members of its viewer
    projects): see, download, upload, make folders, rename and move;
  - deleting: the person who uploaded it, or a project admin. A delete
    goes to a hidden bin (.lwk-bin), so it can be undone (Ctrl+Z on the
    page) or restored by an admin later;
  - pinning for everyone and folder templates: project admins;
  - starring is each person's own.

Folder templates: a project's folder tree (folders only, no files) saved
by name, then applied to another project - the missing folders are made,
nothing is ever deleted or renamed.

Every path a page sends is a path inside the project's folder ("Drawings/
Arch/A-101.pdf"); it is resolved on the disk and refused unless it stays
inside that folder - no "..", no hidden names, no links leading out.

00 BIM: every project's folder starts with it. It is not on the disk: it
shows what the viewer already holds for the project - its sheets (PDFs from
Revit and the uploaded PDF sets) and its 3D models (opened on the 3D page;
an IFC can be downloaded) - always up to date, nothing copied. Everyone
can open and download there; nobody can add, rename, move or delete (a
real folder of that name on the disk is shown inside it, read-only too).
"""

import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid

from fastapi import Header, HTTPException, Request
from fastapi.responses import FileResponse

CORE = None
_LOCK = threading.Lock()
BIN = ".lwk-bin"
MAX_UPLOAD = 2 * 1024 * 1024 * 1024
BAD_NAME = re.compile(r'[\x00-\x1f<>:"/\\|?*]')
RESERVED = {"con", "prn", "aux", "nul"} | {"com%d" % i for i in range(1, 10)} | {"lpt%d" % i for i in range(1, 10)}
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
INLINE = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt", ".csv", ".mp4", ".webm", ".mp3", ".json"}
SKIP = {"desktop.ini", "thumbs.db", ".ds_store"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    reg TEXT NOT NULL, path TEXT NOT NULL, uid INTEGER, name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
    PRIMARY KEY (reg, path)
);
CREATE TABLE IF NOT EXISTS pins (
    reg TEXT NOT NULL, path TEXT NOT NULL, by TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
    PRIMARY KEY (reg, path)
);
CREATE TABLE IF NOT EXISTS stars (
    reg TEXT NOT NULL, uid INTEGER NOT NULL, path TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY (reg, uid, path)
);
CREATE TABLE IF NOT EXISTS bin (
    id TEXT PRIMARY KEY, reg TEXT NOT NULL, path TEXT NOT NULL, dir INTEGER NOT NULL DEFAULT 0,
    by_uid INTEGER, by_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0
);
"""


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Meta(object):
    """files_meta.db, one writer at a time."""

    def __enter__(self):
        _LOCK.acquire()
        try:
            self.db = sqlite3.connect(os.path.join(CORE.CFG["data"], "files_meta.db"), timeout=10)
            self.db.row_factory = sqlite3.Row
            self.db.executescript(SCHEMA)
        except Exception:
            _LOCK.release()
            raise
        return self.db

    def __exit__(self, et, ev, tb):
        try:
            if et is None:
                self.db.commit()
            self.db.close()
        finally:
            _LOCK.release()


# ------------------------------------------------------------ where things are

def roots_file():
    return os.path.join(CORE.CFG["data"], "files_roots.json")


def read_roots():
    try:
        with open(roots_file(), encoding="utf-8") as f:
            r = json.load(f)
        return r if isinstance(r, dict) else {}
    except Exception:
        return {}


def default_root(reg):
    return os.path.join(CORE.CFG["data"], "project_files", reg)


def root_of(reg, make=True):
    p = read_roots().get(reg) or default_root(reg)
    if make and not os.path.isdir(p):
        try:
            os.makedirs(p)
        except OSError:
            raise HTTPException(status_code=503, detail="The project's folder on the server cannot be reached: %s" % p)
    return os.path.realpath(p)


def clean_rel(path):
    """A path inside the project's folder, as parts. Refuses anything that
    could step outside it or into hidden places."""
    path = str(path or "").replace("\\", "/").strip("/")
    if not path:
        return []
    parts = path.split("/")
    for p in parts:
        if not p or p in (".", "..") or p.startswith(".") or BAD_NAME.search(p) or len(p) > 200:
            raise HTTPException(status_code=400, detail="Not a path in this folder: %s" % path[:200])
    return parts


def inside(root, parts):
    full = os.path.realpath(os.path.join(root, *parts)) if parts else root
    if full != root and os.path.commonpath([full, root]) != root:
        raise HTTPException(status_code=400, detail="That path leads outside the project's folder")
    return full


def clean_name(name):
    n = re.sub(r"\s+", " ", str(name or "")).strip().rstrip(". ")
    if not n or n.startswith(".") or BAD_NAME.search(n) or len(n) > 200 or n.split(".")[0].lower() in RESERVED:
        raise HTTPException(status_code=400, detail="That name cannot be used for a file or folder (no / \\ : * ? \" < > |)")
    return n


def free_name(folder, name):
    """name, or "name (2).ext" when it is taken."""
    if not os.path.exists(os.path.join(folder, name)):
        return name
    stem, ext = os.path.splitext(name)
    k = 2
    while os.path.exists(os.path.join(folder, "%s (%d)%s" % (stem, k, ext))):
        k += 1
    return "%s (%d)%s" % (stem, k, ext)


def rel_of(root, full):
    return os.path.relpath(full, root).replace(os.sep, "/")


def visible(name):
    return not name.startswith(".") and name.lower() not in SKIP and not name.startswith("~$")


def move_meta(d, reg, old, new):
    """A file or folder moved or renamed: its uploader, pin and stars go with it."""
    for t in ("uploads", "pins", "stars"):
        d.execute("UPDATE %s SET path = ? || substr(path, ?) WHERE reg = ? AND (path = ? OR path LIKE ? ESCAPE '\\')" % t,
                  (new, len(old) + 1, reg, old, old.replace("%", r"\%").replace("_", r"\_") + "/%"))


# ------------------------------------------------------------ templates

def templates_file():
    return os.path.join(CORE.CFG["data"], "folder_templates.json")


def read_templates():
    try:
        with open(templates_file(), encoding="utf-8") as f:
            t = json.load(f)
        return t if isinstance(t, list) else []
    except Exception:
        return []


def write_templates(t):
    tmp = templates_file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(t, f, indent=1, ensure_ascii=False)
    os.replace(tmp, templates_file())


def folder_tree(root, limit=2000):
    """Every folder below root, as relative paths (for a template)."""
    out = []
    for dp, dns, _ in os.walk(root):
        dns[:] = sorted(x for x in dns if visible(x))
        for n in dns:
            out.append(rel_of(root, os.path.join(dp, n)))
            if len(out) >= limit:
                return out
    return out


BIM = "00 BIM"


def bim_parts(parts):
    """Is this path in 00 BIM?"""
    return bool(parts) and parts[0].lower() == BIM.lower()


def bim_name(n):
    """A name usable as a path part."""
    n = BAD_NAME.sub("-", re.sub(r"\s+", " ", str(n or ""))).strip().strip(".").strip()
    return n[:150] or "unnamed"


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def register(app, core):
    global CORE
    CORE = core
    import tasks

    def person(request, token):
        w = core.who(request, token)
        if w.uid is None:
            raise HTTPException(status_code=400, detail="Folders need accounts switched on (Admin page)")
        return w

    def access(request, token, reg, need="member"):
        """(who, is project admin, project row) - refused unless one of the project's people."""
        w = person(request, token)
        if not SAFE_ID.match(reg or ""):
            raise HTTPException(status_code=404, detail="No such project")
        uids, row = tasks.project_people(core, reg)
        if row is None:
            raise HTTPException(status_code=404, detail="No such project")
        admin = tasks.project_admin(core, w, reg)
        if not admin and w.uid not in uids:
            raise HTTPException(status_code=403, detail="You are not one of this project's people")
        if need == "admin" and not admin:
            raise HTTPException(status_code=403, detail="Only a project admin can do that")
        return w, admin, row

    async def body_of(request):
        try:
            b = json.loads((await request.body()).decode("utf-8") or "{}")
        except Exception:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Expected a JSON object")
        return b

    def names():
        try:
            return dict((u["id"], u["name"]) for u in core.ACC.list())
        except Exception:
            return {}

    def entry(root, full, meta):
        st = os.stat(full)
        rel = rel_of(root, full)
        isdir = os.path.isdir(full)
        e = {"name": os.path.basename(full), "path": rel, "dir": isdir, "size": 0 if isdir else st.st_size,
             "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
             "pinned": rel in meta["pins"], "starred": rel in meta["stars"], "by": meta["by"].get(rel, "")}
        if isdir:
            try:
                e["count"] = sum(1 for x in os.listdir(full) if visible(x))
            except OSError:
                e["count"] = 0
        return e

    def meta_for(reg, uid):
        with Meta() as d:
            pins = set(r["path"] for r in d.execute("SELECT path FROM pins WHERE reg = ?", (reg,)))
            stars = set(r["path"] for r in d.execute("SELECT path FROM stars WHERE reg = ? AND uid = ?", (reg, uid)))
            ups = d.execute("SELECT path, uid, name FROM uploads WHERE reg = ?", (reg,)).fetchall()
        nm = names()
        return {"pins": pins, "stars": stars, "by": dict((r["path"], nm.get(r["uid"], r["name"])) for r in ups),
                "by_uid": dict((r["path"], r["uid"]) for r in ups)}

    # ------------------------------------------------------------ 00 BIM

    def bim_index(row):
        """{path: node} for 00 BIM: folders ({"dir": True}) and files
        ({"full": file on the server or "", "open": page link, "kind"})."""
        idx = {BIM: {"dir": True}}
        parts = tasks.viewers_of(row)
        for pid in parts:
            try:
                root = os.path.realpath(core.project_root_for(pid))
            except Exception:
                continue
            man = read_json(os.path.join(root, "manifest.json")) or {}
            title = (man.get("source") or {}).get("title") or pid
            base = BIM if len(parts) == 1 else BIM + "/" + bim_name(title if title != pid else pid)
            idx[base] = {"dir": True}

            def under(rel):
                full = os.path.realpath(os.path.join(root, str(rel or "")))
                return full if rel and os.path.commonpath([full, root]) == root and os.path.isfile(full) else ""

            def add(folder, name, node):
                idx.setdefault(folder, {"dir": True})
                stem, ext = os.path.splitext(bim_name(name))
                nm, k = stem + ext, 2
                while folder + "/" + nm in idx:
                    nm, k = "%s (%d)%s" % (stem, k, ext), k + 1
                idx[folder + "/" + nm] = node

            sheets_dir = base + "/2D Sheets"
            seen = set()
            for sh in man.get("sheets") or []:
                full = under(sh.get("pdf"))
                if full and full not in seen:
                    seen.add(full)
                    add(sheets_dir, "%s %s.pdf" % (sh.get("number") or "", sh.get("name") or ""),
                        {"full": full, "kind": "sheet", "open": ""})
            imp = read_json(os.path.join(root, "imported_sheets.json")) or {}
            for sh in imp.get("sheets") or []:
                full = under(sh.get("pdf"))
                if full and full not in seen:
                    seen.add(full)
                    stem = re.sub(r"-[0-9a-f]{8}$", "", os.path.splitext(os.path.basename(full))[0])
                    add(sheets_dir + "/" + bim_name(sh.get("set") or "Uploaded PDFs"), stem + ".pdf",
                        {"full": full, "kind": "sheet", "open": ""})
            models_dir = base + "/3D Models"
            link = "model.html?project=" + pid
            for m in man.get("models") or []:
                if not m.get("fragments") or m.get("status") == "converting":
                    continue
                f = under(m.get("fragments"))
                ifc = under(os.path.splitext(m.get("fragments"))[0] + ".ifc")
                nm = m.get("name") or "model"
                if ifc:
                    add(models_dir, nm + ".ifc", {"full": ifc, "kind": "model", "open": link})
                elif f:
                    # a Revit export: seen on the 3D page (its file is for the viewer only)
                    add(models_dir, nm + " (3D)", {"full": "", "kind": "model", "open": link, "size": os.path.getsize(f),
                                                   "mtime": os.path.getmtime(f)})
            refs = read_json(os.path.join(root, "refs.json")) or {}
            for r in refs.get("refs") or []:
                ifc = under(r.get("ifc")) if r.get("kind") == "ifc" else ""
                if ifc:
                    who = " - " + r["company"] if r.get("company") else ""
                    add(models_dir + "/Consultant models", "%s%s.ifc" % (r.get("name") or "model", who),
                        {"full": ifc, "kind": "model", "open": link})
        return idx

    def bim_entry(path, node, idx, meta):
        name = path.split("/")[-1]
        if node.get("dir"):
            n = sum(1 for k in idx if k.rsplit("/", 1)[0] == path and k != path)
            return {"name": name, "path": path, "dir": True, "size": 0, "mtime": "", "count": n,
                    "pinned": False, "starred": False, "by": "", "locked": True}
        full = node.get("full") or ""
        try:
            st = os.stat(full) if full else None
        except OSError:
            st = None
        mt = st.st_mtime if st else node.get("mtime")
        return {"name": name, "path": path, "dir": False, "size": st.st_size if st else node.get("size", 0),
                "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mt)) if mt else "",
                "pinned": False, "starred": False, "by": "", "locked": True,
                "open": node.get("open") or "", "nofile": not full, "kind": node.get("kind", "")}

    def bim_list(row, root, parts, meta):
        """What is in a folder of 00 BIM: what the viewer holds, then a real
        folder of that name on the disk, if there is one."""
        idx = bim_index(row)
        path = "/".join([BIM] + parts[1:])
        if path not in idx and not os.path.isdir(os.path.join(root, *parts)):
            raise HTTPException(status_code=404, detail="That folder is not there any more")
        items = [bim_entry(k, v, idx, meta) for k, v in idx.items() if k != path and k.rsplit("/", 1)[0] == path]
        names = set(e["name"].lower() for e in items)
        try:
            real = inside(root, parts)
        except HTTPException:
            real = ""
        if real and os.path.isdir(real):
            for n in os.listdir(real):
                if not visible(n) or n.lower() in names:
                    continue
                try:
                    e = entry(root, os.path.join(real, n), meta)
                    e["locked"] = True
                    items.append(e)
                except OSError:
                    continue
        items.sort(key=lambda e: (not e["dir"], e["name"].lower()))
        return path, items

    def bim_file(row, root, parts):
        """The file on the server behind a 00 BIM path."""
        node = bim_index(row).get("/".join([BIM] + parts[1:]))
        if node and node.get("full"):
            return node["full"]
        full = inside(root, parts)
        return full if os.path.isfile(full) else ""

    def not_bim(*paths):
        for p in paths:
            parts = clean_rel(p) if isinstance(p, str) or p is None else p
            if bim_parts(parts):
                raise HTTPException(status_code=403, detail="00 BIM is kept by the viewer: its models and sheets "
                                    "can be opened and downloaded, not added to, changed or deleted")

    # ------------------------------------------------------------ the folder

    @app.get("/api/files/projects")
    async def file_projects(request: Request, x_viewer_token: str = Header(default="")):
        """The projects whose folders I can open (for the page's picker)."""
        w = person(request, x_viewer_token)
        with tasks.Db(os.path.join(core.CFG["data"], "tasks.db")) as d:
            rows = [dict(r) for r in d.execute("SELECT * FROM projects WHERE deleted = 0 ORDER BY sort, name").fetchall()]
        out = []
        for r in rows:
            uids, _ = tasks.project_people(core, r["id"])
            if w.site_admin or w.uid in uids or tasks.project_admin(core, w, r["id"]):
                out.append({"id": r["id"], "name": r["short"] or r["name"], "full": r["name"], "code": r["code"],
                            "parts": tasks.viewers_of(r)})
        # office_preview: LibreOffice found, so Office files are shown as in Office
        return {"projects": out, "site_admin": bool(w.site_admin), "office_preview": bool(soffice())}

    @app.get("/api/files/{reg}/list")
    async def file_list(request: Request, reg: str, path: str = "", x_viewer_token: str = Header(default="")):
        w, admin, row = access(request, x_viewer_token, reg)
        root = root_of(reg)
        parts = clean_rel(path)
        meta = meta_for(reg, w.uid)
        if bim_parts(parts):
            rel, items = bim_list(row, root, parts, meta)
            return {"path": rel, "items": items, "admin": admin, "locked": True,
                    "project": {"id": reg, "name": row["short"] or row["name"], "parts": tasks.viewers_of(row)},
                    "me": w.uid}
        full = inside(root, parts)
        if not os.path.isdir(full):
            raise HTTPException(status_code=404, detail="That folder is not there any more")
        items = []
        if full == root:
            idx = bim_index(row)
            items.append(bim_entry(BIM, idx[BIM], idx, meta))
        for n in os.listdir(full):
            if not visible(n) or (full == root and n.lower() == BIM.lower()):
                continue
            p = os.path.join(full, n)
            try:
                if os.path.islink(p) and os.path.commonpath([os.path.realpath(p), root]) != root:
                    continue
                items.append(entry(root, p, meta))
            except (OSError, ValueError):
                continue
        items.sort(key=lambda e: (not e.get("locked"), not e["dir"], e["name"].lower()))
        return {"path": rel_of(root, full) if full != root else "", "items": items, "admin": admin,
                "project": {"id": reg, "name": row["short"] or row["name"], "parts": tasks.viewers_of(row)},
                "me": w.uid}

    @app.get("/api/files/{reg}/tree")
    async def file_tree(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """Every folder, for the tree on the left."""
        _, _, row = access(request, x_viewer_token, reg)
        root = root_of(reg)
        bim = [k for k, v in bim_index(row).items() if v.get("dir")]
        real = folder_tree(root, 5000)
        have = set(x.lower() for x in bim)
        return {"folders": bim + [f for f in real if f.lower() not in have], "locked": [BIM]}

    @app.get("/api/files/{reg}/quick")
    async def file_quick(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """Pinned (for everyone), starred (mine) and the latest files."""
        w, admin, _ = access(request, x_viewer_token, reg)
        root = root_of(reg)
        meta = meta_for(reg, w.uid)

        def ok(paths):
            out = []
            for rel in sorted(paths):
                try:
                    full = inside(root, clean_rel(rel))
                    if os.path.exists(full):
                        out.append(entry(root, full, meta))
                except HTTPException:
                    pass
            return out
        recent = []
        seen = 0
        for dp, dns, fns in os.walk(root):
            dns[:] = [x for x in dns if visible(x)]
            for n in fns:
                if not visible(n):
                    continue
                seen += 1
                p = os.path.join(dp, n)
                try:
                    recent.append((os.path.getmtime(p), p))
                except OSError:
                    pass
            if seen > 20000:
                break
        recent.sort(reverse=True)
        return {"pinned": ok(meta["pins"]), "starred": ok(meta["stars"]),
                "recent": [entry(root, p, meta) for _, p in recent[:30]]}

    @app.get("/api/files/{reg}/search")
    async def file_search(request: Request, reg: str, q: str = "", x_viewer_token: str = Header(default="")):
        w, _, row = access(request, x_viewer_token, reg)
        words = [x for x in str(q or "").lower().split() if x][:5]
        if not words:
            return {"items": []}
        root = root_of(reg)
        meta = meta_for(reg, w.uid)
        idx = bim_index(row)
        out = [bim_entry(k, v, idx, meta) for k, v in idx.items()
               if all(x in k.split("/")[-1].lower() for x in words)][:100]
        seen = 0
        for dp, dns, fns in os.walk(root):
            dns[:] = [x for x in dns if visible(x)]
            for n in dns + fns:
                seen += 1
                if visible(n) and all(x in n.lower() for x in words):
                    try:
                        out.append(entry(root, os.path.join(dp, n), meta))
                    except OSError:
                        pass
            if len(out) >= 200 or seen > 50000:
                break
        return {"items": out}

    # ------------------------------------------------------------ Office files, read in the page

    OFFICE = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".pps", ".ppsx"}
    _CONVERT = threading.Lock()

    def soffice():
        """LibreOffice, when the server has it: LWK_SOFFICE, the PATH, or
        where its Windows installer puts it."""
        cands = [os.environ.get("LWK_SOFFICE") or "", shutil.which("soffice") or "", shutil.which("libreoffice") or "",
                 r"C:\Program Files\LibreOffice\program\soffice.exe",
                 r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                 "/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"]
        return next((c for c in cands if c and os.path.isfile(c)), "")

    @app.get("/api/files/{reg}/preview")
    async def file_preview(request: Request, reg: str, path: str = "", x_viewer_token: str = Header(default="")):
        """A Word, Excel or PowerPoint file as a PDF, to read in the page
        without downloading it. Made with LibreOffice on the server and kept
        (until the file changes) in <data>/preview_cache."""
        _, _, row = access(request, x_viewer_token, reg)
        parts = clean_rel(path)
        full = bim_file(row, root_of(reg), parts) if bim_parts(parts) else inside(root_of(reg), parts)
        if not full or not os.path.isfile(full):
            raise HTTPException(status_code=404, detail="That file is not there any more")
        if os.path.splitext(full)[1].lower() not in OFFICE:
            raise HTTPException(status_code=400, detail="Only Office files are turned into a preview")
        exe = soffice()
        if not exe:
            raise HTTPException(status_code=501, detail="LibreOffice is not installed on the server")
        st = os.stat(full)
        import hashlib
        key = hashlib.sha1(("%s|%s|%d|%d" % (reg, full, st.st_size, int(st.st_mtime))).encode("utf-8")).hexdigest()
        cache = os.path.join(CORE.CFG["data"], "preview_cache")
        out = os.path.join(cache, key + ".pdf")
        if not os.path.isfile(out):
            if not os.path.isdir(cache):
                os.makedirs(cache)

            why = []

            def convert():
                with _CONVERT:
                    if os.path.isfile(out):
                        return True
                    work = os.path.join(cache, "w-" + key)
                    os.makedirs(work, exist_ok=True)
                    src = os.path.join(work, "in" + os.path.splitext(full)[1].lower())
                    shutil.copyfile(full, src)
                    try:
                        import subprocess
                        pr = subprocess.run([exe, "--headless", "--norestore", "-env:UserInstallation=file:///" +
                                        os.path.join(cache, "profile").replace("\\", "/").lstrip("/"),
                                        "--convert-to", "pdf", "--outdir", work, src],
                                       capture_output=True, timeout=600)   # a 100 MB document takes minutes
                        made = os.path.join(work, "in.pdf")
                        if os.path.isfile(made):
                            os.replace(made, out)
                            return True
                        why.append((pr.stdout or b"").decode("utf-8", "replace") + (pr.stderr or b"").decode("utf-8", "replace"))
                        return False
                    except subprocess.TimeoutExpired:
                        why.append("timeout")
                        return False
                    except Exception as e:
                        why.append(str(e))
                        return False
                    finally:
                        shutil.rmtree(work, ignore_errors=True)
            import asyncio
            ok = await asyncio.get_event_loop().run_in_executor(None, convert)
            if not ok:
                w = " ".join(why)
                if "could not be loaded" in w:
                    # only libreoffice-core: Writer, Calc and Impress are packages of their own
                    detail = ("LibreOffice on the server cannot read this kind of file - install "
                              "libreoffice-writer, libreoffice-calc and libreoffice-impress")
                elif "timeout" in w:
                    detail = "The file is too big to convert in 10 minutes"
                else:
                    detail = "LibreOffice could not open that file"
                print("preview of %s failed: %s" % (path, w.strip()[-300:]), flush=True)
                raise HTTPException(status_code=422, detail=detail)
        r = FileResponse(out, media_type="application/pdf", filename=os.path.splitext(os.path.basename(full))[0] + ".pdf",
                         content_disposition_type="inline")
        r.headers["Cache-Control"] = "private, max-age=3600"
        return r

    @app.get("/api/files/{reg}/file")
    async def file_get(request: Request, reg: str, path: str = "", download: int = 0,
                       x_viewer_token: str = Header(default="")):
        _, _, row = access(request, x_viewer_token, reg)
        parts = clean_rel(path)
        full = bim_file(row, root_of(reg), parts) if bim_parts(parts) else inside(root_of(reg), parts)
        if not full or not os.path.isfile(full):
            raise HTTPException(status_code=404, detail="That file is not there any more")
        ext = os.path.splitext(full)[1].lower()
        how = "inline" if ext in INLINE and not download else "attachment"
        # in 00 BIM it goes by the name shown there ("A-101 Ground floor plan.pdf")
        r = FileResponse(full, filename=parts[-1] if bim_parts(parts) else os.path.basename(full), content_disposition_type=how)
        r.headers["Cache-Control"] = "private, no-cache"
        r.headers["X-Content-Type-Options"] = "nosniff"
        if ext == ".svg":
            r.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        return r

    # ------------------------------------------------------------ changes

    @app.post("/api/files/{reg}/upload")
    async def file_upload(request: Request, reg: str, path: str = "", name: str = "",
                          x_viewer_token: str = Header(default="")):
        """The body is the file itself. A name already there gets " (2)"."""
        w, _, _ = access(request, x_viewer_token, reg)
        root = root_of(reg)
        parts = clean_rel(path)
        not_bim(parts)
        rel_name = str(name or "").replace("\\", "/")
        sub = [clean_name(x) for x in rel_name.split("/")[:-1] if x]   # a folder dropped whole
        nm = clean_name(rel_name.split("/")[-1])
        folder = inside(root, parts + sub)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        nm = free_name(folder, nm)
        dest = os.path.join(folder, nm)
        tmp = os.path.join(folder, ".lwk-up-%s" % uuid.uuid4().hex[:10])
        size = 0
        try:
            with open(tmp, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_UPLOAD:
                        raise HTTPException(status_code=413, detail="Files up to 2 GB")
                    f.write(chunk)
            if os.path.exists(dest):
                nm = free_name(folder, nm)
                dest = os.path.join(folder, nm)
            os.replace(tmp, dest)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        rel = rel_of(root, dest)
        with Meta() as d:
            d.execute("INSERT OR REPLACE INTO uploads (reg, path, uid, name, at) VALUES (?,?,?,?,?)",
                      (reg, rel, w.uid, w.name, now_iso()))
            for i in range(len(sub)):
                d.execute("INSERT OR IGNORE INTO uploads (reg, path, uid, name, at) VALUES (?,?,?,?,?)",
                          (reg, "/".join(parts + sub[:i + 1]), w.uid, w.name, now_iso()))
        return {"path": rel, "name": nm, "size": size}

    @app.post("/api/files/{reg}/mkdir")
    async def file_mkdir(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        w, _, _ = access(request, x_viewer_token, reg)
        b = await body_of(request)
        root = root_of(reg)
        not_bim(b.get("path"), (clean_rel(b.get("path")) + [clean_name(b.get("name"))]))
        parent = inside(root, clean_rel(b.get("path")))
        nm = clean_name(b.get("name"))
        full = os.path.join(parent, nm)
        if os.path.exists(full):
            raise HTTPException(status_code=409, detail="There is already a %s called %s here" % ("folder" if os.path.isdir(full) else "file", nm))
        os.makedirs(full)
        rel = rel_of(root, full)
        with Meta() as d:
            d.execute("INSERT OR REPLACE INTO uploads (reg, path, uid, name, at) VALUES (?,?,?,?,?)",
                      (reg, rel, w.uid, w.name, now_iso()))
        return {"path": rel}

    def do_move(reg, root, src_rel, dest_parent_rel, new_name=None):
        not_bim(src_rel, dest_parent_rel)
        if new_name is not None or not clean_rel(dest_parent_rel):
            not_bim(clean_rel(dest_parent_rel) + [clean_name(new_name if new_name is not None else (clean_rel(src_rel) or [""])[-1])])
        src = inside(root, clean_rel(src_rel))
        if src == root or not os.path.exists(src):
            raise HTTPException(status_code=404, detail="That is not there any more")
        parent = inside(root, clean_rel(dest_parent_rel))
        if not os.path.isdir(parent):
            raise HTTPException(status_code=404, detail="No such folder")
        nm = clean_name(new_name) if new_name is not None else os.path.basename(src)
        dest = os.path.join(parent, nm)
        if os.path.isdir(src) and (parent == src or parent.startswith(src + os.sep)):
            raise HTTPException(status_code=400, detail="A folder cannot go inside itself")
        if os.path.exists(dest) and os.path.normcase(dest) != os.path.normcase(src):
            raise HTTPException(status_code=409, detail="There is already something called %s there" % nm)
        old_rel, new_rel = rel_of(root, src), rel_of(root, dest)
        if old_rel == new_rel:
            return old_rel, new_rel
        os.rename(src, dest) if os.path.dirname(src) == parent else shutil.move(src, dest)
        with Meta() as d:
            move_meta(d, reg, old_rel, new_rel)
        return old_rel, new_rel

    @app.post("/api/files/{reg}/rename")
    async def file_rename(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{path, name}"""
        access(request, x_viewer_token, reg)
        b = await body_of(request)
        root = root_of(reg)
        parts = clean_rel(b.get("path"))
        if not parts:
            raise HTTPException(status_code=400, detail="The project's folder itself cannot be renamed here")
        old, new = do_move(reg, root, b.get("path"), "/".join(parts[:-1]), b.get("name"))
        return {"from": old, "path": new}

    @app.post("/api/files/{reg}/move")
    async def file_move(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{paths: [...], to: folder}"""
        access(request, x_viewer_token, reg)
        b = await body_of(request)
        root = root_of(reg)
        done = []
        for p in (b.get("paths") or [])[:500]:
            old, new = do_move(reg, root, p, b.get("to") or "")
            done.append({"from": old, "path": new})
        return {"moved": done}

    def may_delete(w, admin, reg, root, full, meta_uid):
        if admin:
            return True
        rel = rel_of(root, full)
        if os.path.isfile(full):
            return meta_uid.get(rel) == w.uid
        # a folder: its maker, when everything in it is theirs too
        if meta_uid.get(rel) != w.uid:
            return False
        for dp, dns, fns in os.walk(full):
            for n in fns:
                if visible(n) and meta_uid.get(rel_of(root, os.path.join(dp, n))) != w.uid:
                    return False
        return True

    @app.post("/api/files/{reg}/delete")
    async def file_delete(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{paths: [...]} - to the bin, from where they can be restored."""
        w, admin, _ = access(request, x_viewer_token, reg)
        b = await body_of(request)
        root = root_of(reg)
        with Meta() as d:
            ups = dict((r["path"], r["uid"]) for r in d.execute("SELECT path, uid FROM uploads WHERE reg = ?", (reg,)))
        out = []
        for p in (b.get("paths") or [])[:500]:
            not_bim(p)
            full = inside(root, clean_rel(p))
            if full == root or not os.path.exists(full):
                continue
            if not may_delete(w, admin, reg, root, full, ups):
                raise HTTPException(status_code=403, detail="Only the person who uploaded %s, or a project admin, can delete it"
                                    % os.path.basename(full))
            bid = uuid.uuid4().hex[:16]
            box = os.path.join(root, BIN, bid)
            os.makedirs(box)
            isdir = os.path.isdir(full)
            size = os.path.getsize(full) if not isdir else 0
            shutil.move(full, os.path.join(box, os.path.basename(full)))
            rel = rel_of(root, full)
            with Meta() as d:
                d.execute("INSERT INTO bin (id, reg, path, dir, by_uid, by_name, at, size) VALUES (?,?,?,?,?,?,?,?)",
                          (bid, reg, rel, 1 if isdir else 0, w.uid, w.name, now_iso(), size))
                # pins and stars are kept for a restore; uploaders too
            out.append({"id": bid, "path": rel})
        return {"deleted": out}

    @app.get("/api/files/{reg}/bin")
    async def file_bin(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        w, admin, _ = access(request, x_viewer_token, reg)
        with Meta() as d:
            rows = d.execute("SELECT * FROM bin WHERE reg = ? ORDER BY at DESC LIMIT 300", (reg,)).fetchall()
        return {"items": [{"id": r["id"], "path": r["path"], "dir": bool(r["dir"]), "by": r["by_name"], "at": r["at"],
                           "size": r["size"], "can_restore": admin or r["by_uid"] == w.uid} for r in rows]}

    @app.post("/api/files/{reg}/restore")
    async def file_restore(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{ids: [...]} - back where they were (" (2)" if that name is taken now)."""
        w, admin, _ = access(request, x_viewer_token, reg)
        b = await body_of(request)
        root = root_of(reg)
        out = []
        for bid in (b.get("ids") or [])[:500]:
            if not SAFE_ID.match(str(bid)):
                continue
            with Meta() as d:
                r = d.execute("SELECT * FROM bin WHERE id = ? AND reg = ?", (bid, reg)).fetchone()
            if not r:
                continue
            if not admin and r["by_uid"] != w.uid:
                raise HTTPException(status_code=403, detail="Only the person who deleted it, or a project admin, can restore it")
            box = os.path.join(root, BIN, bid)
            parts = clean_rel(r["path"])
            src = os.path.join(box, parts[-1])
            if not os.path.exists(src):
                continue
            parent = inside(root, parts[:-1])
            if not os.path.isdir(parent):
                os.makedirs(parent)
            nm = free_name(parent, parts[-1])
            dest = os.path.join(parent, nm)
            shutil.move(src, dest)
            shutil.rmtree(box, ignore_errors=True)
            new_rel = rel_of(root, dest)
            with Meta() as d:
                d.execute("DELETE FROM bin WHERE id = ?", (bid,))
                if new_rel != r["path"]:
                    move_meta(d, reg, r["path"], new_rel)
            out.append({"id": bid, "path": new_rel})
        return {"restored": out}

    # ------------------------------------------------------------ pins and stars

    @app.post("/api/files/{reg}/pin")
    async def file_pin(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{path, on} - for everyone in the project (project admins)."""
        w, _, _ = access(request, x_viewer_token, reg, "admin")
        b = await body_of(request)
        not_bim(b.get("path"))
        rel = "/".join(clean_rel(b.get("path")))
        if not rel or not os.path.exists(inside(root_of(reg), clean_rel(rel))):
            raise HTTPException(status_code=404, detail="That is not there any more")
        with Meta() as d:
            if b.get("on", True):
                d.execute("INSERT OR REPLACE INTO pins (reg, path, by, at) VALUES (?,?,?,?)", (reg, rel, w.name, now_iso()))
            else:
                d.execute("DELETE FROM pins WHERE reg = ? AND path = ?", (reg, rel))
        return {"ok": True}

    @app.post("/api/files/{reg}/star")
    async def file_star(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{path, on} - my own."""
        w, _, _ = access(request, x_viewer_token, reg)
        b = await body_of(request)
        not_bim(b.get("path"))
        rel = "/".join(clean_rel(b.get("path")))
        if not rel:
            raise HTTPException(status_code=400, detail="Nothing to star")
        with Meta() as d:
            if b.get("on", True):
                d.execute("INSERT OR REPLACE INTO stars (reg, uid, path, at) VALUES (?,?,?,?)", (reg, w.uid, rel, now_iso()))
            else:
                d.execute("DELETE FROM stars WHERE reg = ? AND uid = ? AND path = ?", (reg, w.uid, rel))
        return {"ok": True}

    # ------------------------------------------------------------ templates

    @app.get("/api/files/templates")
    async def tpl_list(request: Request, x_viewer_token: str = Header(default="")):
        person(request, x_viewer_token)
        return {"templates": [{"id": t["id"], "name": t["name"], "folders": t["folders"], "by": t.get("by", ""),
                               "at": t.get("at", "")} for t in read_templates()]}

    @app.post("/api/files/{reg}/template")
    async def tpl_save(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{name}: this project's folders, saved as a template (replaces one of that name)."""
        w, _, _ = access(request, x_viewer_token, reg, "admin")
        b = await body_of(request)
        nm = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()[:80]
        if not nm:
            raise HTTPException(status_code=400, detail="Give the template a name")
        folders = [f for f in folder_tree(root_of(reg)) if not bim_parts(f.split("/"))]
        if not folders:
            raise HTTPException(status_code=400, detail="This project's folder has no folders to save")
        with _LOCK:
            ts = [t for t in read_templates() if t["name"].lower() != nm.lower()]
            t = {"id": uuid.uuid4().hex[:12], "name": nm, "folders": folders, "by": w.name, "at": now_iso(), "from": reg}
            ts.append(t)
            write_templates(ts)
        return {"template": t}

    @app.delete("/api/files/templates/{tid}")
    async def tpl_delete(request: Request, tid: str, x_viewer_token: str = Header(default="")):
        w = person(request, x_viewer_token)
        with _LOCK:
            ts = read_templates()
            t = next((x for x in ts if x["id"] == tid), None)
            if not t:
                raise HTTPException(status_code=404, detail="No such template")
            if not (w.site_admin or t.get("by") == w.name or tasks.project_admin(core, w, t.get("from", ""))):
                raise HTTPException(status_code=403, detail="Only who saved it, or a site admin, can delete a template")
            write_templates([x for x in ts if x["id"] != tid])
        return {"ok": True}

    @app.post("/api/files/{reg}/apply-template")
    async def tpl_apply(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{id, path}: make the template's folders (those missing) under path."""
        w, _, _ = access(request, x_viewer_token, reg, "admin")
        b = await body_of(request)
        t = next((x for x in read_templates() if x["id"] == b.get("id")), None)
        if not t:
            raise HTTPException(status_code=404, detail="No such template")
        root = root_of(reg)
        base = clean_rel(b.get("path"))
        not_bim(base)
        made = 0
        with Meta() as d:
            for f in t["folders"]:
                try:
                    parts = base + clean_rel(f)
                except HTTPException:
                    continue
                if bim_parts(parts):
                    continue
                full = inside(root, parts)
                if not os.path.isdir(full):
                    os.makedirs(full)
                    made += 1
                    d.execute("INSERT OR IGNORE INTO uploads (reg, path, uid, name, at) VALUES (?,?,?,?,?)",
                              (reg, "/".join(parts), w.uid, w.name, now_iso()))
        return {"made": made, "total": len(t["folders"])}

    # ------------------------------------------------------------ to the Sheets page

    @app.post("/api/files/{reg}/to-sheets")
    async def to_sheets(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{path, project}: a copy of a PDF into that viewer project's
        uploaded drawings (the page then adds its pages to a PDF set with
        /api/import/sheets, as an upload on the Sheets page does)."""
        w, _, row = access(request, x_viewer_token, reg)
        b = await body_of(request)
        pid = str(b.get("project") or "")
        if pid not in tasks.viewers_of(row):
            raise HTTPException(status_code=400, detail="That is not one of this project's sheet sets")
        core.require_project(request, pid, "member", x_viewer_token)
        not_bim(b.get("path"))
        full = inside(root_of(reg), clean_rel(b.get("path")))
        if not os.path.isfile(full) or not full.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only a PDF can go to the Sheets page")
        with open(full, "rb") as f:
            if f.read(5) != b"%PDF-":
                raise HTTPException(status_code=400, detail="That file is not a PDF")
        root = core.project_root_for(pid)
        folder = os.path.join(root, "imported")
        if not os.path.isdir(folder):
            os.makedirs(folder)
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.splitext(os.path.basename(full))[0])[:60] or "drawing"
        fname = "%s-%s.pdf" % (stem, uuid.uuid4().hex[:8])
        shutil.copyfile(full, os.path.join(folder, fname))
        try:
            core.queue_ocr(root, ["imported/" + fname])
        except Exception:
            pass
        return {"pdf": "imported/" + fname}

    # ------------------------------------------------------------ where (site admin)

    @app.get("/api/files/{reg}/root")
    async def root_get(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        w, admin, _ = access(request, x_viewer_token, reg)
        p = read_roots().get(reg) or ""
        return {"path": p if w.site_admin else "", "default": default_root(reg) if w.site_admin else "",
                "custom": bool(p), "can_set": bool(w.site_admin)}

    @app.put("/api/files/{reg}/root")
    async def root_set(request: Request, reg: str, x_viewer_token: str = Header(default="")):
        """{path}: the folder on the server for this project ("" = the default)."""
        w = person(request, x_viewer_token)
        if not w.site_admin:
            raise HTTPException(status_code=403, detail="Only a site admin can say where a project's files are")
        access(request, x_viewer_token, reg)
        b = await body_of(request)
        p = str(b.get("path") or "").strip().strip('"')
        if p:
            if not os.path.isabs(p):
                raise HTTPException(status_code=400, detail="Give the full path, e.g. D:\\Projects\\SKW or \\\\server\\share\\SKW")
            if not os.path.isdir(p):
                try:
                    os.makedirs(p)
                except OSError as e:
                    raise HTTPException(status_code=400, detail="The server cannot reach or make that folder: %s" % e)
            if os.path.realpath(p) == os.path.realpath(core.CFG["data"]) or \
                    os.path.commonpath([os.path.realpath(p), os.path.realpath(core.CFG["data"])]) == os.path.realpath(p):
                raise HTTPException(status_code=400, detail="That folder holds the server's own data - pick another")
        with _LOCK:
            r = read_roots()
            if p:
                r[reg] = p
            else:
                r.pop(reg, None)
            tmp = roots_file() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(r, f, indent=1)
            os.replace(tmp, roots_file())
        return {"path": p}
