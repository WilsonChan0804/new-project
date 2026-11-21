# -*- coding: utf-8 -*-
"""The knowledge base (Codes > Knowledge base): the office's summaries of the
Buildings Ordinance, regulations, Codes of Practice, PNAPs and the APSEC
forum - an MkDocs site another Claude session writes on its own git branch.
The server fetches that branch, builds the site with MkDocs (so it looks as
its author made it) and indexes its pages, section by section, so the Codes
search answers from the summaries first (no AI).

  GET  /api/kb/status          what is in: commit, date, pages; updating / error
  GET  /api/kb/settings        (site admin) source, repo, branch, folder, auto
  POST /api/kb/settings        (site admin) the same, and a token (kept, never shown)
  POST /api/kb/update          (site admin) fetch, build and index now
  GET  /api/kb/search?q=       the sections that answer: summaries, guides,
                               regulations, APSEC (only current positions)
  GET  /kb/<path>              the built site (signed in)

Kept in <data>/kb/: settings.json, token, src/<sha>/ (the branch), site/<sha>/
(the build), kb.db (the index), current.json.
"""
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile

from fastapi import HTTPException, Request, Header
from fastapi.responses import FileResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

import codes
import codesread

DEFAULTS = {"source": "github", "repo": "WilsonChan0804/new-project", "branch": "claude/happy-edison-lbpdz9", "folder": "", "auto": True}
MAX_ZIP = 300 * 1024 * 1024
KIND_W = {"guide": 4.0, "regulation": 2.0, "code": 2.0, "pnap": 2.0, "jpn": 2.0, "workflow": 1.0, "apsec": 0.0, "glossary": -1.0, "index": -3.0, "other": -2.0}
KIND_LABEL = {"guide": "Guide", "regulation": "Regulation", "code": "Code of Practice", "pnap": "PNAP", "jpn": "JPN", "apsec": "APSEC",
              "glossary": "Glossary", "workflow": "Workflow", "index": "Index", "other": "Page"}
SKIP = {"contributing.md", "tags.md"}
STATE = {"updating": False, "error": "", "log": "", "started": 0}
LOCK = threading.Lock()
CFG = {"data": "", "core": None}


def _dir(sub=""):
    if not CFG["data"] and CFG["core"] is not None:
        CFG["data"] = CFG["core"].CFG.get("data") or ""
    if not CFG["data"]:
        raise RuntimeError("kb: no data folder yet")
    d = os.path.join(CFG["data"], "kb", sub)
    os.makedirs(d, exist_ok=True)
    return d


def _read(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def settings():
    return dict(DEFAULTS, **(_read(os.path.join(_dir(), "settings.json"), {}) or {}))


def token():
    try:
        with open(os.path.join(_dir(), "token"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return os.environ.get("LWK_KB_TOKEN", "")


def current():
    return _read(os.path.join(_dir(), "current.json"), {}) or {}


# ------------------------------------------------------------------ parsing

def slug(value, seen):
    """As MkDocs' table of contents makes a heading's id."""
    v = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    v = re.sub(r"[^\w\s-]", "", v).strip().lower()
    v = re.sub(r"[-\s]+", "-", v) or "_"
    base, k = v, 1
    while v in seen:
        v = "%s_%d" % (base, k)
        k += 1
    seen.add(v)
    return v


def kind_of(rel):
    p = rel.replace("\\", "/")
    name = p.rsplit("/", 1)[-1]
    if name == "index.md":
        return "index" if "/" in p or p == "index.md" else "index"
    if p.startswith("guides/"):
        return "guide"
    if p.startswith("pnap/"):
        return "jpn" if name.startswith("jpn") else "pnap"
    if p.startswith("regulations/"):
        return "regulation"
    if p.startswith("codes/"):
        return "code"
    if p.startswith("apsec/"):
        return "apsec"
    if name == "glossary.md":
        return "glossary"
    if name == "workflows.md":
        return "workflow"
    return "other"


def url_of(rel):
    p = rel.replace("\\", "/")[:-3]
    if p == "index":
        return ""
    if p.endswith("/index"):
        return p[:-5]
    return p + "/"


MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def clean_lines(lines, figures, base_dir):
    """Markdown with MkDocs extras -> plain lines (English, Chinese)."""
    en, zh, lang = [], [], None
    in_fig = False
    for raw in lines:
        s = raw.rstrip("\n")
        t = s.strip()
        m = re.match(r'^===\s+"([^"]+)"', t)
        if m:
            lang = "zh" if re.search(r"[一-鿿]|中文", m.group(1)) else "en"
            continue
        if raw and not raw.startswith((" ", "\t")) and t and lang:
            lang = None                         # out of the tabs
        if "<figure" in t:
            in_fig = True
        for im in re.finditer(r"!\[([^\]]*)\]\(([^)\s]+)", t):
            src = im.group(2)
            if not re.match(r"^(https?:)?//", src):
                src = os.path.normpath(os.path.join(base_dir, src)).replace("\\", "/")
            figures.append({"src": src, "alt": re.sub(r"\s+", " ", im.group(1)).strip()[:200]})
        if in_fig:
            if "</figure>" in t:
                in_fig = False
            continue
        if re.match(r"^(!!!|\?\?\?\+?)\s", t):                 # an admonition: its title only
            m = re.match(r'^(?:!!!|\?\?\?\+?)\s+\S+(?:\s+"([^"]*)")?', t)
            t = (m.group(1) + ":") if m and m.group(1) else ""
        elif re.match(r"^\|?\s*:?-{3,}", t):                   # a table's rule
            continue
        elif t.startswith("|"):
            cells = [c.strip() for c in t.strip("|").split("|")]
            t = " · ".join(c for c in cells if c)
        t = re.sub(r"!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?", "", t)
        t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
        t = re.sub(r"<br\s*/?>", " ", t)
        t = re.sub(r"<[^>]+>", "", t)
        t = re.sub(r"\{\s*[#.:][^}]*\}", "", t)
        t = re.sub(r"\*\*|__|`|==|~~", "", t)
        t = re.sub(r"(?<!\w)\*(?!\s)([^*]+)\*(?!\w)", r"\1", t)
        t = re.sub(r"^#{1,6}\s+", "", t).strip()
        if t.startswith(">"):
            t = t.lstrip("> ").strip()
        (zh if lang == "zh" else en).append(t)
    tidy = lambda xs: re.sub(r"\n{3,}", "\n\n", "\n".join(xs)).strip()
    return tidy(en), tidy(zh)


def parse_page(text, rel):
    """-> page dict, [section dicts]"""
    tags, body = [], text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            fm = text[3:end]
            body = text[end + 4:]
            tags = [re.sub(r"\s+#.*$", "", m.group(1)).strip().strip('"\'') for m in re.finditer(r"^\s*-\s+(.+)$", fm, re.M)]
    lines = body.split("\n")
    title, zh_title = "", ""
    for ln in lines:
        if ln.startswith("# "):
            h = ln[2:].strip()
            m = re.match(r"^(.*?)<br\s*/?>\s*<small>(.*?)</small>", h)
            title, zh_title = (m.group(1), m.group(2)) if m else (h, "")
            title = re.sub(r"<[^>]+>|\{[^}]*\}", "", title).strip()
            zh_title = re.sub(r"<[^>]+>", "", zh_title).strip()
            break
    info = {}
    for m in re.finditer(r"^\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*(.+?)\s*\|\s*$", body, re.M):
        k = re.sub(r"[^\x00-\x7f]+", "", m.group(1)).strip().lower()
        if k in ("version summarised", "last checked", "type", "first issue", "source"):
            info[k] = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", m.group(2)).strip()[:200]
    kind = kind_of(rel)
    base_dir = os.path.dirname(rel.replace("\\", "/"))
    level = 3 if kind == "apsec" else 2
    seen = set()
    sections, cur, date = [], None, ""
    for ln in lines:
        hm = re.match(r"^(#{2,3})\s+(.+?)\s*$", ln)
        if hm and len(hm.group(1)) <= level:
            head = hm.group(2)
            anc = re.search(r"\{#([\w\-]+)\}\s*$", head)
            head = re.sub(r"\s*\{[^}]*\}\s*$", "", head)
            plain = re.sub(r"<[^>]+>", "", re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", head)).strip()
            if kind == "apsec" and len(hm.group(1)) == 2:
                dm = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", plain)
                if dm and dm.group(2).lower() in MONTHS:
                    date = "%s-%02d-%02d" % (dm.group(3), MONTHS[dm.group(2).lower()], int(dm.group(1)))
            a = anc.group(1) if anc else slug(plain, seen)
            if anc:
                seen.add(a)
            cur = {"heading": plain, "anchor": a, "lines": [], "date": date if kind == "apsec" else "", "depth": len(hm.group(1))}
            sections.append(cur)
            continue
        if ln.startswith("# "):
            continue
        if cur is None:
            cur = {"heading": "", "anchor": "", "lines": [], "date": "", "depth": 1}
            sections.append(cur)
        cur["lines"].append(ln)
    out = []
    for k, s in enumerate(sections):
        figs = []
        en, zh = clean_lines(s["lines"], figs, base_dir)
        if len(en) + len(zh) < 30 and not figs:
            continue
        if kind == "apsec" and s["depth"] == 2:
            continue                                   # a meeting's own heading: its items carry the content
        raw = "\n".join(s["lines"])
        sup = bool(re.search(r'!!!\s+warning\s+"Later discussion', raw))
        newer = ""
        if sup:
            m = re.search(r"Later discussion[^\n]*\n(?:.*\n){0,3}?.*?\[later response\]\(([^)]+)\)", raw)
            newer = m.group(1) if m else ""
        out.append({"heading": s["heading"], "anchor": s["anchor"], "ord": k, "date": s["date"], "superseded": sup, "newer": newer,
                    "en": en[:20000], "zh": zh[:20000], "figures": figs[:8]})
    page = {"path": rel.replace("\\", "/"), "url": url_of(rel), "title": title or rel, "zh": zh_title, "kind": kind, "tags": tags, "info": info}
    return page, out


SCHEMA = """
CREATE TABLE pages (id INTEGER PRIMARY KEY, path TEXT, url TEXT, title TEXT, zh TEXT, kind TEXT, tags TEXT, info TEXT);
CREATE TABLE sections (id INTEGER PRIMARY KEY, page INTEGER, heading TEXT, anchor TEXT, ord INTEGER, date TEXT,
  superseded INTEGER, newer TEXT, en TEXT, zh TEXT, figures TEXT);
CREATE VIRTUAL TABLE sections_fts USING fts5(body, head, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
"""


def index(docs_dir, db_path):
    """Every page's sections into a new index (swapped in when done)."""
    tmp = db_path + ".new"
    if os.path.exists(tmp):
        os.remove(tmp)
    c = sqlite3.connect(tmp)
    c.executescript(SCHEMA)
    n_pages = n_secs = 0
    for root, dirs, files in os.walk(docs_dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in ("assets", "stylesheets", "javascripts"))
        for fn in sorted(files):
            if not fn.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(root, fn), docs_dir).replace("\\", "/")
            if rel in SKIP:
                continue
            try:
                with open(os.path.join(root, fn), encoding="utf-8") as f:
                    text = f.read()
            except (OSError, UnicodeDecodeError):
                continue
            page, secs = parse_page(text, rel)
            cur = c.execute("INSERT INTO pages (path, url, title, zh, kind, tags, info) VALUES (?,?,?,?,?,?,?)",
                            (page["path"], page["url"], page["title"], page["zh"], page["kind"], json.dumps(page["tags"], ensure_ascii=False),
                             json.dumps(page["info"], ensure_ascii=False)))
            pid = cur.lastrowid
            n_pages += 1
            for s in secs:
                cur = c.execute("INSERT INTO sections (page, heading, anchor, ord, date, superseded, newer, en, zh, figures) VALUES (?,?,?,?,?,?,?,?,?,?)",
                                (pid, s["heading"], s["anchor"], s["ord"], s["date"], 1 if s["superseded"] else 0, s["newer"], s["en"], s["zh"],
                                 json.dumps(s["figures"], ensure_ascii=False)))
                head = " ".join([s["heading"], page["title"], page["zh"], " ".join(page["tags"])])
                c.execute("INSERT INTO sections_fts (rowid, body, head) VALUES (?,?,?)",
                          (cur.lastrowid, codes.index_text(s["en"] + "\n" + s["zh"]), codes.index_text(head)))
                n_secs += 1
    c.commit()
    c.close()
    os.replace(tmp, db_path)
    return n_pages, n_secs


def _db():
    p = os.path.join(_dir(), "kb.db")
    if not os.path.exists(p):
        return None
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    return c


def search(q, n=6, include_old=False):
    terms, shown = codes.query_terms(q or "")
    c = _db()
    if not terms or c is None:
        return [], shown
    try:
        rows = [dict(r) for r in c.execute(
            "SELECT s.*, p.url, p.title, p.zh AS page_zh, p.kind, p.tags, p.info, p.path, bm25(sections_fts, 1.0, 3.0) AS score"
            " FROM sections_fts JOIN sections s ON s.id = sections_fts.rowid JOIN pages p ON p.id = s.page"
            " WHERE sections_fts MATCH ? %s ORDER BY score LIMIT 120" % ("" if include_old else "AND s.superseded = 0"),
            (codes.fts_match(terms),)).fetchall()]
    except sqlite3.OperationalError:
        rows = []
    finally:
        c.close()
    keys = [codesread.norm(t) for t in terms if len(codesread.norm(t)) >= 3 and not t.isdigit()]
    named = [codesread.norm(t) for t in terms if re.fullmatch(r"[a-z]{0,4}\d+(?:[.\-]\d+)*[a-z]?", t) and not t.isdigit()]
    for r in rows:
        head = codesread.norm(r["heading"] + " " + r["title"] + " " + r["page_zh"])
        b = KIND_W.get(r["kind"], 0)
        hits = sum(1 for t in keys if t in head)
        b += min(hits, 3) * 2.0
        if re.match(r"^at a glance", r["heading"] or "", re.I):
            b += 3.0
        if re.match(r"^(related|see also|source|references?|document info)\b", r["heading"] or "", re.I) or not r["heading"]:
            b -= 6.0                                  # lists of links, the page's own details
        if named and any(t in head or t in codesread.norm(r["path"]) for t in named):
            b += 8.0
        body = codesread.norm(r["en"])
        b += min(3, sum(1 for t in keys if t in body)) * 0.8
        r["_rank"] = (r["score"] or 0) - b
    rows.sort(key=lambda r: r["_rank"])
    out, per = [], {}
    for r in rows:
        if per.get(r["page"], 0) >= 2:
            continue
        per[r["page"]] = per.get(r["page"], 0) + 1
        out.append(r)
        if len(out) >= n:
            break
    return out, shown


def snippet(text, terms, n=320):
    t = re.sub(r"\s+", " ", text or "").strip()
    low = t.lower()
    at = min([low.find(w.lower()) for w in terms if w and low.find(w.lower()) >= 0] or [0])
    a = max(0, at - 80)
    s = t[a:a + n]
    return ("… " if a else "") + s + (" …" if a + n < len(t) else "")


def public(r, terms):
    figs = json.loads(r["figures"] or "[]")
    return {"id": r["id"], "url": r["url"], "anchor": r["anchor"], "title": r["title"], "zh": r["page_zh"], "section": r["heading"],
            "kind": r["kind"], "kind_label": KIND_LABEL.get(r["kind"], "Page"), "tags": json.loads(r["tags"] or "[]")[:8],
            "date": r["date"], "info": json.loads(r["info"] or "{}"), "snippet": snippet(r["en"] or r["zh"], terms),
            "read": codesread.reflow(r["en"])[:6000], "read_zh": codesread.reflow(r["zh"])[:4000],
            "figures": [dict(f, url="/kb/" + f["src"].lstrip("/")) if not re.match(r"^(https?:)?//", f["src"]) else f for f in figs][:4]}


# ------------------------------------------------------------- the update

def _get(url, tok, accept="application/vnd.github+json", limit=None):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "lwk-viewer-kb", "X-GitHub-Api-Version": "2022-11-28"})
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=60) as r:
        if limit:
            data = r.read(limit + 1)
            if len(data) > limit:
                raise ValueError("The branch is over %d MB" % (limit // 1024 // 1024))
            return data
        return r.read()


def safe_extract(data, dest):
    """A GitHub zipball into dest, without its top folder; nothing outside it."""
    z = zipfile.ZipFile(io.BytesIO(data))
    dest = os.path.abspath(dest)
    total = 0
    for info in z.infolist():
        name = info.filename.replace("\\", "/")
        parts = name.split("/", 1)
        if len(parts) < 2 or not parts[1]:
            continue
        rel = parts[1]
        if rel.startswith("/") or re.match(r"^[A-Za-z]:", rel) or ".." in rel.split("/"):
            raise ValueError("A file outside the branch's folder: " + name)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            continue                                         # no symbolic links
        total += info.file_size
        if total > MAX_ZIP:
            raise ValueError("The branch is too big")
        target = os.path.abspath(os.path.join(dest, rel))
        if not target.startswith(dest + os.sep):
            raise ValueError("A file outside the branch's folder: " + name)
        if name.endswith("/"):
            os.makedirs(target, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)


def fetch(cfg):
    """-> (src folder, {sha, date, message})"""
    if cfg.get("source") == "folder":
        folder = os.path.abspath(cfg.get("folder") or "")
        if not os.path.isfile(os.path.join(folder, "mkdocs.yml")):
            raise ValueError("No mkdocs.yml in the folder %s" % folder)
        meta = {"sha": "", "date": "", "message": ""}
        if os.path.isdir(os.path.join(folder, ".git")) and shutil.which("git"):
            subprocess.run(["git", "-C", folder, "pull", "--ff-only"], capture_output=True, timeout=180)
            r = subprocess.run(["git", "-C", folder, "log", "-1", "--format=%H%n%cI%n%s"], capture_output=True, text=True, timeout=30)
            bits = (r.stdout or "").split("\n")
            if len(bits) >= 3 and bits[0]:
                meta = {"sha": bits[0], "date": bits[1], "message": bits[2]}
        if not meta["sha"]:
            h = hashlib.sha1()
            for root, _, files in os.walk(os.path.join(folder, "docs")):
                for fn in sorted(files):
                    st = os.stat(os.path.join(root, fn))
                    h.update(("%s %d %d" % (fn, st.st_size, int(st.st_mtime))).encode())
            meta = {"sha": "local-" + h.hexdigest()[:12], "date": time.strftime("%Y-%m-%dT%H:%M:%S"), "message": "folder " + folder}
        return folder, meta
    repo = (cfg.get("repo") or "").strip()
    branch = (cfg.get("branch") or "").strip()
    if not re.match(r"^[\w.-]+/[\w.-]+$", repo) or not re.match(r"^[\w./-]+$", branch) or ".." in branch:
        raise ValueError("The repository is owner/name and the branch a branch name")
    tok = token()
    try:
        info = json.loads(_get("https://api.github.com/repos/%s/commits/%s" % (repo, urllib.parse.quote(branch, safe="/")), tok))
    except urllib.error.HTTPError as ex:
        if ex.code in (401, 403, 404):
            raise ValueError("GitHub said %d for %s @ %s - %s" % (ex.code, repo, branch,
                             "check the token (Contents: read-only, for this repository)" if tok else "a private repository needs a token"))
        raise
    sha = info["sha"]
    meta = {"sha": sha, "date": (info.get("commit") or {}).get("committer", {}).get("date", ""),
            "message": ((info.get("commit") or {}).get("message") or "").split("\n")[0][:200]}
    src = os.path.join(_dir("src"), sha)
    if not os.path.isfile(os.path.join(src, "mkdocs.yml")):
        data = _get("https://api.github.com/repos/%s/zipball/%s" % (repo, sha), tok, accept="application/vnd.github+json", limit=MAX_ZIP)
        tmp = src + ".part"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        safe_extract(data, tmp)
        if not os.path.isfile(os.path.join(tmp, "mkdocs.yml")):
            shutil.rmtree(tmp, ignore_errors=True)
            raise ValueError("The branch has no mkdocs.yml - is it the knowledge base's branch?")
        shutil.rmtree(src, ignore_errors=True)
        os.replace(tmp, src)
    return src, meta


def build(src, sha):
    out = os.path.join(_dir("site"), re.sub(r"[^\w-]", "_", sha)[:60])
    tmp = out + ".part"
    shutil.rmtree(tmp, ignore_errors=True)
    env = dict(os.environ, NO_MKDOCS_2_WARNING="1")
    try:
        r = subprocess.run([sys.executable, "-m", "mkdocs", "build", "-q", "-f", os.path.join(src, "mkdocs.yml"), "-d", tmp],
                           capture_output=True, text=True, timeout=600, env=env, cwd=src)
    except FileNotFoundError:
        raise ValueError("Python could not run MkDocs")
    if r.returncode != 0 or not os.path.isfile(os.path.join(tmp, "index.html")):
        err = (r.stderr or r.stdout or "").strip()
        if "No module named mkdocs" in err:
            err = "MkDocs is not installed on the server: pip install mkdocs-material"
        shutil.rmtree(tmp, ignore_errors=True)
        raise ValueError("The site did not build: " + err[-600:])
    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    return out


def update(force=False):
    """Fetch, build, index; one at a time. Returns current()."""
    if not LOCK.acquire(blocking=False):
        return current()
    STATE.update(updating=True, error="", started=time.time(), log="Fetching ...")
    try:
        cfg = settings()
        src, meta = fetch(cfg)
        cur = current()
        if not force and cur.get("sha") == meta["sha"] and os.path.isdir(cur.get("site", "")):
            STATE["log"] = "Up to date"
            cur["checked"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _write(os.path.join(_dir(), "current.json"), cur)
            return cur
        STATE["log"] = "Building the site ..."
        site = build(src, meta["sha"] or "local")
        STATE["log"] = "Indexing ..."
        n_pages, n_secs = index(os.path.join(src, "docs"), os.path.join(_dir(), "kb.db"))
        new = dict(meta, site=site, src=src, pages=n_pages, sections=n_secs, built=time.strftime("%Y-%m-%dT%H:%M:%S"),
                   checked=time.strftime("%Y-%m-%dT%H:%M:%S"), source=cfg.get("source"), branch=cfg.get("branch"))
        _write(os.path.join(_dir(), "current.json"), new)
        # keep this build and the one before
        for sub in ("site", "src"):
            keep = {os.path.basename(new.get(sub, "")), os.path.basename(cur.get(sub, "") or "")}
            base = os.path.join(_dir(), sub)
            if new.get(sub, "").startswith(base):
                for d in os.listdir(base):
                    if d not in keep:
                        shutil.rmtree(os.path.join(base, d), ignore_errors=True)
        STATE["log"] = "Updated"
        return new
    except Exception as ex:
        STATE["error"] = str(ex)[:800]
        STATE["log"] = "Failed"
        return current()
    finally:
        STATE["updating"] = False
        LOCK.release()


def _daily():
    time.sleep(20)
    while True:
        try:
            if settings().get("auto") and (settings().get("source") == "folder" or token() or os.environ.get("LWK_KB_PUBLIC")):
                cur = current()
                last = cur.get("checked", "")
                if not last or time.time() - time.mktime(time.strptime(last[:19], "%Y-%m-%dT%H:%M:%S")) > 23 * 3600:
                    update()
        except Exception as ex:
            print("kb: daily update: %s" % ex)
        time.sleep(3600)


# ------------------------------------------------------------- endpoints

def register(app, core):
    CFG["core"] = core

    def who(request, tok):
        return core.who(request, tok)

    def admin(request, tok):
        w = who(request, tok)
        if not getattr(w, "site_admin", False):
            raise HTTPException(status_code=403, detail="Only a site admin can change the knowledge base")
        return w

    @app.get("/api/kb/status")
    def kb_status(request: Request, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        cur = current()
        on = bool(cur.get("site")) and os.path.isfile(os.path.join(cur.get("site", ""), "index.html"))
        out = {"on": on, "sha": cur.get("sha", ""), "date": cur.get("date", ""), "message": cur.get("message", ""),
               "pages": cur.get("pages", 0), "sections": cur.get("sections", 0), "built": cur.get("built", ""), "checked": cur.get("checked", ""),
               "updating": STATE["updating"], "error": STATE["error"], "log": STATE["log"],
               "manage": bool(getattr(w, "site_admin", False))}
        if out["manage"]:
            s = settings()
            out["settings"] = dict(s, token_set=bool(token()))
        return out

    @app.post("/api/kb/settings")
    async def kb_settings(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send the settings")
        s = settings()
        for k in ("source", "repo", "branch", "folder"):
            if k in body:
                s[k] = str(body[k] or "").strip()[:300]
        if "auto" in body:
            s["auto"] = bool(body["auto"])
        if s["source"] not in ("github", "folder"):
            raise HTTPException(status_code=400, detail="The source is github or folder")
        if s["source"] == "github" and (not re.match(r"^[\w.-]+/[\w.-]+$", s["repo"]) or not re.match(r"^[\w./-]+$", s["branch"]) or ".." in s["branch"]):
            raise HTTPException(status_code=400, detail="The repository is owner/name and the branch a branch name")
        _write(os.path.join(_dir(), "settings.json"), s)
        if body.get("token") is not None:
            t = str(body.get("token") or "").strip()
            p = os.path.join(_dir(), "token")
            if t:
                if not re.match(r"^[\w-]{20,255}$", t):
                    raise HTTPException(status_code=400, detail="That does not look like a GitHub token")
                fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(t)
            elif os.path.exists(p):
                os.remove(p)
        return dict(s, token_set=bool(token()))

    @app.post("/api/kb/update")
    async def kb_update(request: Request, x_viewer_token: str = Header(default=""), force: int = 0, wait: int = 0):
        admin(request, x_viewer_token)
        if wait:
            await run_in_threadpool(update, bool(force))
        else:
            threading.Thread(target=update, args=(bool(force),), daemon=True).start()
            time.sleep(0.05)
        return {"updating": STATE["updating"], "error": STATE["error"], "log": STATE["log"], "current": current()}

    @app.get("/api/kb/search")
    def kb_search(request: Request, q: str = "", n: int = 6, all: int = 0, x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        rows, terms = search(q, max(1, min(int(n), 20)), bool(all))
        items = [public(r, terms) for r in rows]
        facts = codesread.quick_facts([{"text": r["en"], "ref": r["heading"], "page": 0, "title": r["title"]} for r in rows], terms, n_clauses=3, n_rows=8)
        for f in facts:
            it = items[f["k"] - 1]
            f.update(url=it["url"], anchor=it["anchor"], kind_label=it["kind_label"])
        return {"items": items, "terms": terms, "facts": facts}

    @app.api_route("/kb/{path:path}", methods=["GET", "HEAD"])
    def kb_file(path: str, request: Request):
        who(request, "")
        site = current().get("site", "")
        if not site or not os.path.isdir(site):
            raise HTTPException(status_code=404, detail="The knowledge base is not set up yet (Codes > Library > Knowledge base)")
        root = os.path.abspath(site)
        target = os.path.abspath(os.path.join(root, path))
        if target != root and not target.startswith(root + os.sep):
            raise HTTPException(status_code=400, detail="Outside the site")
        if os.path.isdir(target):
            if path and not path.endswith("/"):
                return RedirectResponse(url="/kb/" + path + "/")
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            target404 = os.path.join(root, "404.html")
            if os.path.isfile(target404):
                return FileResponse(target404, status_code=404, headers={"X-Frame-Options": "SAMEORIGIN"})
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(target, headers={"X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'",
                                             "Cache-Control": "no-cache"})

    @app.get("/kb")
    def kb_root():
        return RedirectResponse(url="/kb/")

    threading.Thread(target=_daily, daemon=True).start()
