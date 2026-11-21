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
from fastapi.responses import FileResponse, RedirectResponse, Response
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
    tags, body, summary, keywords = [], text, "", []
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            fm = text[3:end]
            body = text[end + 4:]
            # tags: the list under "tags:"; keywords: a list or a comma line; summary: one line
            block, cur = {}, None
            for ln in fm.split("\n"):
                m = re.match(r"^([A-Za-z_]+):\s*(.*)$", ln)
                if m:
                    cur = m.group(1).lower()
                    block[cur] = [m.group(2).strip()] if m.group(2).strip() else []
                elif cur and re.match(r"^\s*-\s+", ln):
                    block[cur].append(re.sub(r"^\s*-\s+", "", ln))
            clean = lambda v: re.sub(r"\s+#.*$", "", v).strip().strip('"\'')
            tags = [clean(v) for v in block.get("tags", []) if clean(v)]
            kw = block.get("keywords", [])
            keywords = [clean(x) for v in kw for x in (v.strip("[]").split(",") if len(kw) == 1 else [v]) if clean(x)]
            summary = clean(" ".join(block.get("summary", [])))[:400]
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
    if summary:
        info["summary"] = summary
    if keywords:
        info["keywords"] = keywords[:30]
    if any(t.lower() == "draft" for t in tags):
        info["draft"] = True
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
                head = " ".join([s["heading"], page["title"], page["zh"], " ".join(page["tags"]), " ".join(page["info"].get("keywords", []))])
                c.execute("INSERT INTO sections_fts (rowid, body, head) VALUES (?,?,?)",
                          (cur.lastrowid, codes.index_text(s["en"] + "\n" + s["zh"]), codes.index_text(head)))
                n_secs += 1
    c.commit()
    c.close()
    os.replace(tmp, db_path)
    try:
        overlay_edits()
    except Exception as ex:
        print("kb: edits not overlaid: %s" % ex)
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
            "SELECT s.*, p.url, p.title, p.zh AS page_zh, p.kind, p.tags, p.info, p.path, se.names AS edited, se.text AS edit_text,"
            " bm25(sections_fts, 1.0, 3.0) AS score"
            " FROM sections_fts JOIN sections s ON s.id = sections_fts.rowid JOIN pages p ON p.id = s.page"
            " LEFT JOIN section_edits se ON se.section = s.id"
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
    info = json.loads(r["info"] or "{}")
    ed = r.get("edited") or ""
    return {"draft": bool(info.get("draft")), "summary": info.get("summary", ""), "edited_by": ed,
            "edits": r.get("edit_text") or "", "id": r["id"], "url": r["url"], "anchor": r["anchor"], "title": r["title"], "zh": r["page_zh"], "section": r["heading"],
            "kind": r["kind"], "kind_label": KIND_LABEL.get(r["kind"], "Page"), "tags": json.loads(r["tags"] or "[]")[:8],
            "date": r["date"], "info": json.loads(r["info"] or "{}"), "snippet": snippet(r["en"] or r["zh"], terms),
            "read": codesread.reflow(r["en"])[:6000], "read_zh": codesread.reflow(r["zh"])[:4000],
            "figures": [dict(f, url="/kb/" + f["src"].lstrip("/")) if not re.match(r"^(https?:)?//", f["src"]) else f for f in figs][:4]}


# ------------------------------------------------------- the thin pages

# the documents architects use every week: the full template is expected
TIER_A = {"pnap/app-%d.md" % n for n in (2, 19, 40, 41, 42, 89, 93, 104, 111, 130, 132, 136, 147, 151, 152, 153, 156, 172, 175)} | \
    {"pnap/adm-2.md", "pnap/adm-19.md", "pnap/adv-35.md"} | {"pnap/jpn-%d.md" % n for n in range(1, 10)} | \
    {"regulations/bpr-18a-22.md", "regulations/bpr-23-23a.md", "regulations/bpr-24-37.md", "regulations/bpr-39-49e.md", "regulations/bpr-71-73.md",
     "codes/fsc-part-b-means-of-escape.md", "codes/fsc-part-c-fire-resisting-construction.md", "codes/fsc-part-d-means-of-access.md", "codes/bfa-2008.md"}
PLACEHOLDER = re.compile(r"\b(later|other|remaining|subsequent) (paras?\.?|paragraphs) (cover|deal|set out|give|provide)|其後各段|其餘各段|其他各段", re.I)


def tier_of(path, kind):
    if path in TIER_A:
        return "A"
    if kind in ("pnap", "jpn") and re.search(r"/(adm|adv)-", path):
        return "C"
    if kind in ("pnap", "jpn", "regulation", "code", "guide"):
        return "B"
    return ""


def thin_report():
    """Each summary page against what its tier needs: words, the sections it has,
    placeholders - the pages to fill in first."""
    c = _db()
    if c is None:
        return {"items": [], "counts": {}}
    try:
        pages = list(c.execute("SELECT id, path, url, title, kind, info FROM pages"))
        secs = {}
        for r in c.execute("SELECT page, heading, en FROM sections"):
            secs.setdefault(r["page"], []).append((r["heading"] or "", r["en"] or ""))
    finally:
        c.close()
    out = []
    for p in pages:
        tier = tier_of(p["path"], p["kind"])
        if not tier:
            continue
        ss = secs.get(p["id"], [])
        heads = " | ".join(h for h, _ in ss).lower()
        text = "\n".join(t for _, t in ss)
        words = len(re.findall(r"[A-Za-z]+", text))
        info = json.loads(p["info"] or "{}")
        has = {"glance": "at a glance" in heads, "clauses": "key clause" in heads or "official wording" in heads,
               "explanation": "explanation" in heads or "step " in heads or "big picture" in heads,
               "notes": "practical notes" in heads or "pitfall" in heads or "common mistakes" in heads,
               "example": bool(re.search(r"worked example|計算例子|example", text, re.I)),
               "diagram": "diagram" in heads or "figure" in heads, "summary": bool(info.get("summary")), "keywords": bool(info.get("keywords"))}
        ph = bool(PLACEHOLDER.search(text))
        why = []
        if tier == "A":
            if words < 1200:
                why.append("short for a key document (%d words, aim 1,200+)" % words)
            for k, lab in (("glance", "At a glance"), ("clauses", "Key clauses"), ("explanation", "Explanation"), ("notes", "Practical notes / pitfalls"), ("example", "worked example")):
                if not has[k] and not (p["kind"] == "guide" and k == "clauses"):
                    why.append("no " + lab)
        elif tier == "B":
            if words < 300:
                why.append("short (%d words, aim 300+: one line per paragraph)" % words)
            if not has["glance"]:
                why.append("no At a glance")
        else:
            if not has["glance"]:
                why.append("no At a glance")
            if words < 120:
                why.append("very short (%d words)" % words)
        if ph:
            why.append('"later paragraphs cover ..." without their content')
        if not has["summary"]:
            why.append("no summary:")
        if not has["keywords"]:
            why.append("no keywords:")
        out.append({"path": p["path"], "url": p["url"], "title": p["title"], "kind": p["kind"], "tier": tier, "words": words,
                    "has": has, "placeholder": ph, "why": why,
                    "thin": any(not w.startswith("no summary") and not w.startswith("no keywords") for w in why)})
    out.sort(key=lambda x: ({"A": 0, "B": 1, "C": 2}[x["tier"]], not x["thin"], x["words"]))
    counts = {t: {"pages": sum(1 for x in out if x["tier"] == t), "thin": sum(1 for x in out if x["tier"] == t and x["thin"])} for t in "ABC"}
    counts["summary"] = sum(1 for x in out if x["has"]["summary"])
    counts["keywords"] = sum(1 for x in out if x["has"]["keywords"])
    counts["all"] = len(out)
    return {"items": out, "counts": counts}


# ------------------------------------------------------------ the edits

EDIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS edits (id INTEGER PRIMARY KEY, page TEXT, block TEXT, anchor TEXT, text TEXT, note TEXT,
  original TEXT, uid INTEGER, name TEXT, at INTEGER, undone_at INTEGER, undone_by TEXT, merged_sha TEXT);
CREATE INDEX IF NOT EXISTS idx_edits_page ON edits(page);
"""


def _edb():
    c = sqlite3.connect(os.path.join(_dir(), "edits.db"))
    c.row_factory = sqlite3.Row
    c.executescript(EDIT_SCHEMA)
    return c


def edit_row(r):
    return {"id": r["id"], "page": r["page"], "block": r["block"], "anchor": r["anchor"] or "", "text": r["text"], "note": r["note"] or "",
            "original": r["original"] or "", "uid": r["uid"], "name": r["name"] or "", "at": int(r["at"] or 0) * 1000 // 1000,
            "undone": bool(r["undone_at"]), "undone_by": r["undone_by"] or "", "merged": r["merged_sha"] or ""}


def live_edits(page=None):
    c = _edb()
    try:
        q = "SELECT * FROM edits WHERE undone_at IS NULL" + (" AND page = ?" if page else "") + " ORDER BY at, id"
        return [edit_row(r) for r in c.execute(q, (page,) if page else ())]
    finally:
        c.close()


def _norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[*_`]", "", t or "")).strip().lower()


def overlay_edits(page=None):
    """The edited wording into the search index: each section whose text
    holds an edit's original (or has its anchor) is found by the new text too."""
    c = _db()
    if c is None:
        return 0
    n = 0
    try:
        pages = {r["path"]: r["id"] for r in c.execute("SELECT id, path FROM pages")}
        by_sec = {}
        for e in live_edits(page):
            pid = pages.get(e["page"]) or pages.get(re.sub(r"(index)?\.html?$|/$", "", e["page"]) + ".md")
            if not pid:
                continue
            secs = list(c.execute("SELECT id, anchor, en, zh FROM sections WHERE page = ?", (pid,)))
            orig = _norm(e["original"])[:120]
            hit = None
            if orig:
                hit = next((s for s in secs if orig[:60] in _norm(s["en"] + " " + s["zh"])), None)
            if hit is None and e["anchor"]:
                hit = next((s for s in secs if s["anchor"] == e["anchor"]), None)
            if hit is not None:
                by_sec.setdefault(hit["id"], []).append(e)
        touched = set(by_sec)
        if page:
            pid = pages.get(page)
            if pid:
                touched |= {r["id"] for r in c.execute("SELECT id FROM sections WHERE page = ?", (pid,))}
        c.execute("CREATE TABLE IF NOT EXISTS section_edits (section INTEGER PRIMARY KEY, text TEXT, names TEXT)")
        for sid in touched:
            s = c.execute("SELECT s.*, p.title, p.zh AS pzh, p.tags, p.info FROM sections s JOIN pages p ON p.id = s.page WHERE s.id = ?", (sid,)).fetchone()
            es = by_sec.get(sid, [])
            extra = "\n".join(e["text"] for e in es)
            names = ", ".join(dict.fromkeys(e["name"] for e in es if e["name"]))
            c.execute("DELETE FROM sections_fts WHERE rowid = ?", (sid,))
            info = json.loads(s["info"] or "{}")
            head = " ".join([s["heading"], s["title"], s["pzh"], " ".join(json.loads(s["tags"] or "[]")), " ".join(info.get("keywords", []))])
            c.execute("INSERT INTO sections_fts (rowid, body, head) VALUES (?,?,?)", (sid, codes.index_text(s["en"] + "\n" + s["zh"] + "\n" + extra), codes.index_text(head)))
            if es:
                c.execute("INSERT OR REPLACE INTO section_edits (section, text, names) VALUES (?,?,?)", (sid, extra[:6000], names))
            else:
                c.execute("DELETE FROM section_edits WHERE section = ?", (sid,))
            n += 1
        c.commit()
    finally:
        c.close()
    return n


def mark_merged(sha):
    """An edit whose new wording is now in the source (and its original gone) is merged."""
    c = _db()
    if c is None:
        return 0
    n = 0
    try:
        text = {}
        for r in c.execute("SELECT p.path, s.en, s.zh FROM sections s JOIN pages p ON p.id = s.page"):
            text[r["path"]] = text.get(r["path"], "") + " " + _norm(r["en"] + " " + r["zh"])
    finally:
        c.close()
    e = _edb()
    try:
        for r in e.execute("SELECT * FROM edits WHERE undone_at IS NULL AND (merged_sha IS NULL OR merged_sha = '')").fetchall():
            t = text.get(r["page"], "")
            new, old = _norm(r["text"])[:60], _norm(r["original"])[:60]
            if t and new and new in t and (not old or old not in t):
                e.execute("UPDATE edits SET merged_sha = ? WHERE id = ?", (sha or "merged", r["id"]))
                n += 1
        e.commit()
    finally:
        e.close()
    return n


def edits_markdown(rows):
    out = ["# Knowledge base edits made in the LWK Viewer", "",
           "Apply each to the Markdown source (find the original text on the page), then commit. %d edits." % len(rows), ""]
    for e in rows:
        out += ["## %s%s" % (e["page"], (" #" + e["anchor"]) if e["anchor"] else ""),
                "- **By** %s, %s%s" % (e["name"] or "?", time.strftime("%Y-%m-%d %H:%M", time.localtime(e["at"] / 1000.0 if e["at"] > 1e11 else e["at"])),
                                      (" - why: " + e["note"]) if e["note"] else ""),
                "- **Edit id** %d · block `%s`%s" % (e["id"], e["block"], " · undone" if e["undone"] else ""), "",
                "Original:", "", "> " + (e["original"] or "").replace("\n", "\n> "), "", "New:", "", "> " + (e["text"] or "").replace("\n", "\n> "), ""]
    return "\n".join(out)


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
        try:
            mark_merged(meta.get("sha"))
        except Exception as ex:
            print("kb: merged check: %s" % ex)
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

    @app.get("/api/kb/thin")
    def kb_thin(request: Request, format: str = "json", x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        r = thin_report()
        if format == "csv":
            import csv
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["Tier", "Page", "Title", "Words", "Thin", "What is missing", "At a glance", "Key clauses", "Explanation", "Practical notes", "Example", "Diagram", "summary:", "keywords:"])
            for x in r["items"]:
                h = x["has"]
                w.writerow([x["tier"], x["path"], x["title"], x["words"], "yes" if x["thin"] else "", "; ".join(x["why"]),
                            *["yes" if h[k] else "" for k in ("glance", "clauses", "explanation", "notes", "example", "diagram", "summary", "keywords")]])
            return Response(content="\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                            headers={"Content-Disposition": 'attachment; filename="kb-thin-pages.csv"'})
        if format == "md":
            lines = ["# Knowledge base: thin pages", "",
                     "Tier A = key documents (full template expected), B = other APP / JPN / regulations / codes / guides (one line per paragraph), C = ADM / ADV.", ""]
            for t in "ABC":
                th = [x for x in r["items"] if x["tier"] == t and x["thin"]]
                lines += ["## Tier %s: %d of %d pages to fill in" % (t, len(th), r["counts"][t]["pages"]), ""]
                lines += ["- **%s** (%s, %d words): %s" % (x["path"], x["title"], x["words"], "; ".join(x["why"])) for x in th] + [""]
            return Response(content="\n".join(lines), media_type="text/markdown; charset=utf-8",
                            headers={"Content-Disposition": 'attachment; filename="kb-thin-pages.md"'})
        return r

    # ---- editing, under the viewer's own accounts
    def me_of(request, tok=""):
        w = who(request, tok)
        uid = getattr(w, "uid", None)
        name = getattr(w, "name", "") or ""
        if uid is None and not name:
            raise HTTPException(status_code=401, detail="Sign in first")
        return w, uid, name

    @app.get("/api/kb/me")
    def kb_me(request: Request, x_viewer_token: str = Header(default="")):
        w, uid, name = me_of(request, x_viewer_token)
        return {"uid": uid, "name": name, "can_edit": True, "admin": bool(getattr(w, "site_admin", False)), "viewer": True}

    def page_param(page):
        page = str(page or "").strip().lstrip("/")[:300]
        if not page or ".." in page:
            raise HTTPException(status_code=400, detail="Which page?")
        return page

    @app.get("/api/kb/edits")
    def kb_edits(request: Request, page: str = "", x_viewer_token: str = Header(default="")):
        me_of(request, x_viewer_token)
        return {"items": live_edits(page_param(page))}

    @app.get("/api/kb/history")
    def kb_history(request: Request, page: str = "", x_viewer_token: str = Header(default="")):
        me_of(request, x_viewer_token)
        c = _edb()
        try:
            return {"items": [edit_row(r) for r in c.execute("SELECT * FROM edits WHERE page = ? ORDER BY at DESC, id DESC", (page_param(page),))]}
        finally:
            c.close()

    @app.post("/api/kb/edits")
    async def kb_edit_post(request: Request, x_viewer_token: str = Header(default="")):
        w, uid, name = me_of(request, x_viewer_token)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Send {page, block, text}")
        page = page_param(body.get("page"))
        block = str(body.get("block") or "").strip()[:200]
        text = str(body.get("text") or "").strip()
        if not block or not text:
            raise HTTPException(status_code=400, detail="An edit needs its paragraph and its new text")
        if len(text) > 5000:
            raise HTTPException(status_code=400, detail="At most 5000 characters")
        c = _edb()
        try:
            cur = c.execute("INSERT INTO edits (page, block, anchor, text, note, original, uid, name, at) VALUES (?,?,?,?,?,?,?,?,?)",
                            (page, block, str(body.get("anchor") or "")[:120], text, str(body.get("note") or "").strip()[:300],
                             str(body.get("original") or "").strip()[:2000], uid, name[:100], int(time.time() * 1000)))
            c.commit()
            row = edit_row(c.execute("SELECT * FROM edits WHERE id = ?", (cur.lastrowid,)).fetchone())
        finally:
            c.close()
        try:
            await run_in_threadpool(overlay_edits, page)
        except Exception as ex:
            print("kb: overlay: %s" % ex)
        return row

    @app.post("/api/kb/edits/{eid}/undo")
    async def kb_edit_undo(eid: int, request: Request, x_viewer_token: str = Header(default="")):
        w, uid, name = me_of(request, x_viewer_token)
        c = _edb()
        try:
            r = c.execute("SELECT * FROM edits WHERE id = ?", (eid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such edit")
            if r["uid"] != uid and not getattr(w, "site_admin", False):
                raise HTTPException(status_code=403, detail="Only its author or a site admin can undo an edit")
            c.execute("UPDATE edits SET undone_at = ?, undone_by = ? WHERE id = ?", (int(time.time() * 1000), name[:100], eid))
            c.commit()
            page = r["page"]
            row = edit_row(c.execute("SELECT * FROM edits WHERE id = ?", (eid,)).fetchone())
        finally:
            c.close()
        await run_in_threadpool(overlay_edits, page)
        return row

    @app.get("/api/kb/edits/all")
    def kb_edits_all(request: Request, since: int = 0, format: str = "json", undone: int = 0, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        c = _edb()
        try:
            rows = [edit_row(r) for r in c.execute("SELECT * FROM edits WHERE at >= ? %s ORDER BY page, at" % ("" if undone else "AND undone_at IS NULL"), (since,))]
        finally:
            c.close()
        if format == "md":
            return Response(content=edits_markdown(rows), media_type="text/markdown; charset=utf-8",
                            headers={"Content-Disposition": 'attachment; filename="kb-edits.md"'})
        return Response(content=json.dumps({"edits": rows, "exported": time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False, indent=1),
                        media_type="application/json", headers={"Content-Disposition": 'attachment; filename="kb-edits.json"'})

    @app.get("/api/kb/edits/recent")
    def kb_edits_recent(request: Request, n: int = 20, x_viewer_token: str = Header(default="")):
        me_of(request, x_viewer_token)
        c = _edb()
        try:
            rows = [edit_row(r) for r in c.execute("SELECT * FROM edits ORDER BY at DESC, id DESC LIMIT ?", (max(1, min(n, 200)),))]
            live = c.execute("SELECT COUNT(*) FROM edits WHERE undone_at IS NULL").fetchone()[0]
            open_ = c.execute("SELECT COUNT(*) FROM edits WHERE undone_at IS NULL AND (merged_sha IS NULL OR merged_sha = '')").fetchone()[0]
        finally:
            c.close()
        return {"items": rows, "live": live, "not_merged": open_}

    @app.post("/api/kb/edits/merged")
    async def kb_edits_merged(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        body = await request.json()
        ids = [int(i) for i in (body.get("ids") or []) if str(i).isdigit()] if isinstance(body, dict) else []
        sha = str((body or {}).get("sha") or current().get("sha") or "merged")[:60]
        c = _edb()
        try:
            for i in ids:
                c.execute("UPDATE edits SET merged_sha = ? WHERE id = ?", (sha, i))
            c.commit()
        finally:
            c.close()
        return {"merged": len(ids)}

    @app.get("/kb")
    def kb_root():
        return RedirectResponse(url="/kb/")

    threading.Thread(target=_daily, daemon=True).start()
