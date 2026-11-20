# -*- coding: utf-8 -*-
"""Codes: the building regulations library, and searches of it (no AI).

The office's own library - the Buildings Ordinance and its Regulations,
PNAPs, the Codes of Practice, design manuals, and the office's notes - put
in by a site admin as PDF, Word or text. Each document is split into its
clauses (or paragraphs), keeping clause numbers and pages, and indexed for
search (SQLite FTS5, built into Python: nothing else to install).

  * Search: the clauses that match, with their reference and page, and the
    page in the PDF a click away; Quick facts (their figures and
    conditions) and the diagrams they refer to (codesread.py). Nothing is
    sent anywhere: no AI.

  GET  /api/codes/status              what is in the library
  GET  /api/codes/sources             the documents
  POST /api/codes/sources?file=&title=&kind=&edition=&url=   body: the file (site admin)
  POST /api/codes/notes               {title, kind, edition, url, text} pasted text / office note (site admin)
  PATCH  /api/codes/sources/{id}      {title, kind, edition, url, status} (site admin)
  DELETE /api/codes/sources/{id}      (site admin)
  GET  /api/codes/sources/{id}/file   the document as put in
  GET  /api/codes/search?q=&n=        clauses that match
  GET  /api/codes/clause/{id}         one clause, with the ones either side
  GET  /api/codes/sources/{id}/page/{n}.png   a page as a picture (diagrams)
  GET  /api/codes/history             my last searches
  GET  /api/codes/catalogue, POST /api/codes/fetch   the BD's documents (codesweb.py)

Kept in <data>/codes/: codes.db, files/<id>.<ext>, pages/ (page pictures),
web/ (the BD catalogue), pending/ (fetched, not yet added).
"""

import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from html import unescape
from urllib.parse import quote

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

import codesread

MAX_FILE = 200 * 1024 * 1024
SAFE = re.compile(r"^[0-9a-f]{12}$")
KINDS = ("ordinance", "regulation", "pnap", "code", "guide", "internal", "other")
KIND_LABEL = {"ordinance": "Ordinance", "regulation": "Regulation", "pnap": "PNAP / practice note",
              "code": "Code of Practice", "guide": "Design manual / guide", "internal": "Office note",
              "other": "Other"}
MAX_CHUNK = 1800        # characters in one clause piece

CORE = {"c": None}
READY = {}
LOCK = threading.Lock()


# ---------------------------------------------------------------- storage

def _dir(sub=""):
    d = os.path.join(CORE["c"].CFG["data"], "codes", sub)
    os.makedirs(d, exist_ok=True)
    return d


@contextmanager
def db():
    path = os.path.join(_dir(), "codes.db")
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    if READY.get("path") != path:          # the tables, once per data folder (made on first use:
        c.executescript(SCHEMA)            # the data folder is only known once the server starts)
        READY["path"] = path
    try:
        yield c
        c.commit()
    finally:
        c.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, title TEXT, kind TEXT, edition TEXT, url TEXT,
  file TEXT, ext TEXT, pages INTEGER, chunks INTEGER, status TEXT DEFAULT 'current',
  added_by TEXT, added_at INTEGER, size INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY, source TEXT, seq INTEGER, ref TEXT, page INTEGER, text TEXT);
CREATE INDEX IF NOT EXISTS chunks_src ON chunks(source, seq);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(body, ref, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS asked (
  id INTEGER PRIMARY KEY, at INTEGER, uid INTEGER, name TEXT, project TEXT, q TEXT,
  answer TEXT, cites TEXT, model TEXT, tin INTEGER, tout INTEGER, cost REAL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS diagrams (source TEXT, label TEXT, page INTEGER, caption TEXT);
CREATE INDEX IF NOT EXISTS diagrams_src ON diagrams(source, label);
"""


def meta(k, default=""):
    with db() as c:
        r = c.execute("SELECT v FROM meta WHERE k = ?", (k,)).fetchone()
    return r["v"] if r else default


def set_meta(k, v):
    with db() as c:
        c.execute("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))


# ------------------------------------------------------------ reading text

CJK = re.compile(r"([⺀-⿿぀-ヿ㐀-䶿一-鿿豈-﫿])")


def index_text(s):
    """Chinese has no spaces: each character is its own word for the index
    (and a question's characters are searched as a phrase)."""
    return CJK.sub(r" \1 ", s)


def pdf_pages(path):
    if not shutil.which("pdftotext"):
        raise HTTPException(status_code=500, detail="This server cannot read PDF text: install poppler (pdftotext)")
    out = subprocess.run(["pdftotext", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=900).stdout
    pages = out.decode("utf-8", "replace").split("\f")
    if len(pages) > 1 and not pages[-1].strip():
        pages.pop()                      # the form feed after the last page
    return pages


def docx_paras(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    paras = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        t = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
        t = re.sub(r"<w:tab/>", "\t", t)
        paras.append(unescape(t))
    return paras


# A clause heading: "41.", "4.2.1", "B5.3", "(3)", "Regulation 41", "PNAP APP-152", "Table B2" ...
HEAD = re.compile(
    r"^\s*((?:(?:Regulation|Reg\.?|Section|Sec\.?|Clause|Part|Division|Schedule|Appendix|Annex|Table|Paragraph|Para\.?)\s+[A-Z]?\d+[A-Z]?(?:[.(][\w)]+)*)"
    r"|(?:PNAP|APP|ADM|ADV)\s*[- ]?\d+"
    r"|[A-Z]{1,2}\d{1,3}(?:\.\d{1,3}){0,3}[a-z]?"
    r"|\d{1,3}[A-Z]?(?:\.\d{1,3}){1,4}"
    r"|\d{1,3}[A-Z]?\."
    r"|第[一二三四五六七八九十百零\d]+[條章節部])(?=\s|$|[一-鿿(（])")


def _heading(line):
    m = HEAD.match(line)
    if not m:
        return ""
    return m.group(1).strip().rstrip(".")


def split_clauses(pages):
    """[(page, lines)] -> [(ref, page, text)]: a new piece at each clause
    heading, or at a paragraph once it grows long. A heading on a line of
    its own ("B5 Travel distance") is not a piece: it heads the pieces under
    it, so they are found by its words too; a piece split for length keeps
    its clause number ("(cont.)")."""
    out = []
    st = {"lines": [], "page": 1, "ref": "", "last": "", "section": ""}

    def size():
        return sum(len(x) for x in st["lines"])

    def flush(split=False):
        lines = [x for x in st["lines"]]
        st["lines"] = []
        while lines and not lines[-1]:
            lines.pop()
        if not lines:
            return
        t = re.sub(r"[ \t]+", " ", "\n".join(lines)).strip()
        t = re.sub(r"\n{3,}", "\n\n", t)
        if len(lines) == 1 and st["ref"] and len(t) < 90 and not split and not re.search(r"[.。;；:：]$", t):
            st["section"] = t              # a title line: it heads what follows
            return
        sec = st["section"]
        if sec and not t.startswith(sec):
            t = sec + "\n" + t
        if len(t) >= 12:
            out.append((st["ref"] or (st["last"] + " (cont.)" if st["last"] else ""), st["page"], t))

    for page, lines in pages:
        for raw in lines:
            line = raw.strip()
            if not line:
                if st["lines"] and size() > MAX_CHUNK * 0.6:
                    flush(True)
                    st["ref"] = ""
                elif st["lines"]:
                    st["lines"].append("")
                continue
            h = _heading(line)
            if h and st["lines"]:
                flush()
            if not st["lines"]:
                st["page"] = page
                if h:
                    # a heading one level up ("B6" after "B5.2") starts a new section
                    if st["section"] and not st["section"].startswith(h) and "." not in h:
                        st["section"] = ""
                    st["ref"] = st["last"] = h
                else:
                    st["ref"] = ""
            st["lines"].append(line)
            if size() > MAX_CHUNK * 1.4:
                flush(True)
                st["ref"] = ""
    flush()
    return out


def read_file(path, ext):
    """[(page, [lines])] of a document. Word and text have no pages (0)."""
    if ext == "pdf":
        pages = pdf_pages(path)
        return [(i + 1, p.split("\n")) for i, p in enumerate(pages)], len(pages)
    if ext == "docx":
        return [(0, docx_paras(path))], 0
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "utf-16", "big5", "latin-1"):
        try:
            txt = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return [(0, txt.split("\n"))], 0


def store_chunks(sid, pieces):
    with db() as c:
        old = [r["id"] for r in c.execute("SELECT id FROM chunks WHERE source = ?", (sid,))]
        for i in old:
            c.execute("DELETE FROM chunks_fts WHERE rowid = ?", (i,))
        c.execute("DELETE FROM chunks WHERE source = ?", (sid,))
        for seq, (ref, page, text) in enumerate(pieces):
            cur = c.execute("INSERT INTO chunks(source, seq, ref, page, text) VALUES(?,?,?,?,?)",
                            (sid, seq, ref, page, text))
            c.execute("INSERT INTO chunks_fts(rowid, body, ref) VALUES(?,?,?)",
                      (cur.lastrowid, index_text(text), ref))
        c.execute("UPDATE sources SET chunks = ? WHERE id = ?", (len(pieces), sid))


def store_diagrams(sid, pages):
    """the diagrams a document has (codesread.captions), by label and page"""
    import codesread
    caps = codesread.captions(["\n".join(lines) for _, lines in pages]) if pages and pages[0][0] else []
    with db() as c:
        c.execute("DELETE FROM diagrams WHERE source = ?", (sid,))
        c.executemany("INSERT INTO diagrams(source, label, page, caption) VALUES(?,?,?,?)", [(sid, l, p, cap) for l, p, cap in caps])
    set_meta("diag:" + sid, str(len(caps)))
    return caps


def ensure_diagrams(sid):
    """a document put in before diagrams were indexed: its pages read once"""
    if meta("diag:" + sid, "") != "":
        return
    with db() as c:
        r = c.execute("SELECT file, ext FROM sources WHERE id = ?", (sid,)).fetchone()
    if not r or r["ext"] != "pdf":
        set_meta("diag:" + sid, "0")
        return
    try:
        pages, _ = read_file(os.path.join(_dir("files"), r["file"]), "pdf")
        store_diagrams(sid, pages)
    except Exception as ex:
        print("codes: diagrams of %s not read: %s" % (sid, ex))
        set_meta("diag:" + sid, "0")


MAX_DIAGRAMS = 4


def result_diagrams(rows):
    """The diagrams of a result: those its clauses refer to ("See Diagrams B2
    and B4"), and one captioned on the page of a clause found (a legend on
    a diagram's page) - at most 4, best clause first."""
    import codesread
    out, seen = [], set()
    for r in rows[:10]:
        if r.get("ext") != "pdf":
            continue
        sid = r["source"]
        ensure_diagrams(sid)
        with db() as c:
            have = dict((d["label"], dict(d)) for d in c.execute("SELECT label, page, caption FROM diagrams WHERE source = ?", (sid,)))
        want = codesread.diagram_refs(r.get("text") or "")
        if r.get("page"):
            want += [l for l, d in have.items() if d["page"] == r["page"] and l not in want]
        for lab in want:
            d = have.get(lab)
            if not d or (sid, lab) in seen:
                continue
            seen.add((sid, lab))
            out.append({"source": sid, "label": lab, "page": d["page"], "caption": d["caption"], "title": r.get("title") or "",
                        "for": r.get("id")})
            if len(out) >= MAX_DIAGRAMS:
                return out
    return out


def page_png(sid, page, width):
    """a page of a PDF in the library as a PNG (pdftoppm), kept"""
    with db() as c:
        r = c.execute("SELECT file, ext, pages FROM sources WHERE id = ?", (sid,)).fetchone()
    if not r or r["ext"] != "pdf" or page < 1 or (r["pages"] and page > r["pages"]):
        return None
    out = os.path.join(_dir("pages"), "%s-%d-%d.png" % (sid, page, width))
    if not os.path.exists(out):
        if not shutil.which("pdftoppm"):
            raise HTTPException(status_code=500, detail="This server cannot draw PDF pages: install poppler (pdftoppm)")
        base = out[:-4] + ".tmp"
        subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-png", "-singlefile", "-scale-to-x", str(width), "-scale-to-y", "-1",
                        os.path.join(_dir("files"), r["file"]), base], capture_output=True, timeout=120)
        if not os.path.exists(base + ".png"):
            return None
        os.replace(base + ".png", out)
    return out


def add_source(path, ext, title, kind, edition, url, by, size, note=""):
    pages, n_pages = read_file(path, ext)
    pieces = split_clauses(pages)
    if not pieces:
        raise HTTPException(status_code=400, detail="No text could be read from it - a scanned PDF needs OCR first "
                            "(e.g. Adobe Acrobat > Scan & OCR), then put it in again")
    sid = os.path.basename(path).split(".")[0]
    with db() as c:
        c.execute("INSERT INTO sources(id, title, kind, edition, url, file, ext, pages, chunks, status, added_by, added_at, size, note)"
                  " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (sid, title, kind, edition, url, os.path.basename(path), ext, n_pages, 0, "current", by,
                   int(time.time()), size, note))
    store_chunks(sid, pieces)
    try:
        store_diagrams(sid, pages)
    except Exception as ex:
        print("codes: diagrams not indexed: %s" % ex)
    return sid


# ------------------------------------------------------------------ search

STOP = set("""a an the of to in on at for by with and or is are be been was were it its this that these those
what which who whom how when where why do does did can could should would shall may might must i we you
any all some there their them than then into from as about under over per not no yes if
please tell me need required requirement requirements""".split())

# words that mean the same here: either finds the other
SYNONYMS = [
    ("means of escape", "moe", "escape route", "exit route"),
    ("travel distance", "direct distance", "走火距離"),
    ("dead end", "dead-end", "deadend", "死胡同"),
    ("fireman's lift", "firemans lift", "fire lift", "fireman lift", "消防員升降機"),
    ("temporary refuge space", "trs", "refuge floor", "避火層"),
    ("fire resistance rating", "frr", "fire resistance period", "耐火"),
    ("fire service installation", "fsi", "fire services installation"),
    ("barrier free access", "bfa", "access for persons with a disability", "無障礙"),
    ("staircase", "stair", "stairway", "樓梯"),
    ("plot ratio", "pr", "地積比率"),
    ("site coverage", "sc", "上蓋面積"),
    ("gross floor area", "gfa", "總樓面面積"),
    ("open space", "os", "休憩用地"),
    ("lighting and ventilation", "natural lighting", "light and ventilation", "prescribed window", "採光", "通風"),
    ("sustainable building design", "sbd", "permeability", "building separation", "building setback"),
    ("emergency vehicular access", "eva", "緊急車輛通道"),
    ("protected lobby", "lobby"),
    ("fire compartment", "compartmentation", "compartment"),
    ("usable floor area", "ufa"),
    ("protected exit", "required staircase"),
]
_SYN = {}
for _g in SYNONYMS:
    for _w in _g:
        _SYN[_w] = _g


def _q(term):
    return '"' + term.replace('"', '""') + '"'


def query_terms(q):
    """The question as FTS terms: words, clause numbers, Chinese phrases,
    and the other names of what it mentions."""
    low = q.lower()
    terms, shown = [], []
    for k, group in _SYN.items():
        if (k in low if CJK.search(k) or " " in k or len(k) > 4 else re.search(r"\b%s\b" % re.escape(k), low)):
            for w in group:
                if w not in terms:
                    terms.append(w)
            shown.extend(group)
    for m in re.finditer(r"[a-z]{0,4}\d+[a-z]?(?:[.\-]\d+[a-z]?)*|[a-z][a-z'\-]*[a-z]|[㐀-鿿]+", low):
        w = m.group(0)
        if w in STOP or (len(w) < 2 and not w.isdigit()):
            continue
        if w not in terms:
            terms.append(w)
            shown.append(w)
    return terms[:40], [t for t in dict.fromkeys(shown) if t not in STOP][:40]


def fts_match(terms):
    parts = []
    for t in terms:
        if CJK.search(t):
            parts.append(_q(index_text(t).strip()))
        elif re.fullmatch(r"[a-z]{4,}", t):
            parts.append(_q(t) + "*")       # prefix: "staircase" finds "staircases"
        else:
            parts.append(_q(t))
    return " OR ".join(parts)


def search(q, n=20, current_only=True):
    terms, shown = query_terms(q or "")
    if not terms:
        return [], shown
    where = "AND s.status = 'current'" if current_only else ""
    sql = ("SELECT c.id, c.source, c.ref, c.page, c.text, s.title, s.kind, s.edition, s.status, s.url, s.ext,"
           " bm25(chunks_fts, 1.0, 4.0) AS score FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid"
           " JOIN sources s ON s.id = c.source WHERE chunks_fts MATCH ? %s ORDER BY score LIMIT ?" % where)
    with db() as c:
        try:
            rows = c.execute(sql, (fts_match(terms), int(n) * 2 + 10)).fetchall()
        except sqlite3.OperationalError:
            rows = []
    rows = [dict(r) for r in rows]
    # bm25 marks long clauses down; a clause that names what was asked in
    # its first lines ("The deadend travel distance is limited to:") is about
    # it - it comes up; a clause named in the question ("B11.2") first
    keys = [codesread.norm(t) for t in terms if len(codesread.norm(t)) >= 4 and not t.isdigit()]
    named = [codesread.norm(t) for t in terms if re.fullmatch(r"[a-z]{0,3}\d+(\.\d+)+[a-z]?", t)]
    for k, r in enumerate(rows):
        head = codesread.norm((r.get("text") or "")[:220])
        bonus = 0.0
        if any(t in head for t in keys):
            bonus += 4.0
        if named and any(t in codesread.norm(r.get("ref") or "") for t in named):
            bonus += 20.0
        r["_rank"] = (r.get("score") or 0) - bonus
    rows.sort(key=lambda r: r["_rank"])
    return rows[:int(n)], shown


def ref_of(r):
    bits = [r["title"]]
    if r.get("ref"):
        bits.append(r["ref"])
    if r.get("page"):
        bits.append("p.%d" % r["page"])
    return " · ".join(bits)


# ----------------------------------------------------------------- routes

def register(app, core):
    CORE["c"] = core

    def who(request, tok):
        return core.who(request, tok)

    def admin(request, tok):
        w = who(request, tok)
        if not w.site_admin:
            raise HTTPException(status_code=403, detail="Only a site admin can change the Codes library")
        return w

    def source_row(r):
        d = dict(r)
        d["kind_label"] = KIND_LABEL.get(d.get("kind"), d.get("kind"))
        return d

    def clean(v, n):
        return re.sub(r"\s+", " ", str(v or "")).strip()[:n]

    def clean_url(v):
        v = clean(v, 500)
        return v if re.match(r"^https?://", v) else ""

    @app.get("/api/codes/status")
    def codes_status(request: Request, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        try:                    # no AI: an API key an earlier version kept goes
            os.remove(os.path.join(core.CFG["data"], "codes", "api_key"))
        except OSError:
            pass
        with db() as c:
            n = c.execute("SELECT COUNT(*) n, COALESCE(SUM(chunks), 0) k FROM sources").fetchone()
        return {"sources": n["n"], "clauses": n["k"], "manage": w.site_admin}

    @app.get("/api/codes/sources")
    def codes_sources(request: Request, x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        with db() as c:
            rows = c.execute("SELECT * FROM sources ORDER BY status, kind, title").fetchall()
        return {"sources": [source_row(r) for r in rows], "kinds": [{"id": k, "label": KIND_LABEL[k]} for k in KINDS]}

    # ------------------------------------------------ the web (codesweb.py)

    def lib_rows():
        with db() as c:
            return [dict(r) for r in c.execute("SELECT id, title, kind, edition, url, status FROM sources").fetchall()]

    def mark_library(docs):
        """each catalogue document: in the library already? (by its address,
        else its number in a title), and a newer edition on the web?"""
        lib = lib_rows()
        by_url = dict((str(r["url"] or "").lower(), r) for r in lib if r["url"])
        for d in docs:
            hit = by_url.get(d["url"].lower())
            if not hit and d.get("number"):
                num = re.compile(r"(^|\W)" + re.escape(d["number"]) + r"(\W|$)", re.I)
                hit = next((r for r in lib if num.search(r["title"] or "")), None)
            d["in_library"] = hit["id"] if hit else ""
            ed_web = (d.get("edition") or d.get("date") or "").strip().lower()
            d["newer"] = bool(hit and ed_web and (hit.get("edition") or "").strip().lower() not in ("", ed_web))
            d["library_edition"] = hit.get("edition", "") if hit else ""
        return docs

    @app.get("/api/codes/catalogue")
    def codes_catalogue(request: Request, refresh: int = 0, x_viewer_token: str = Header(default="")):
        """The documents the Buildings Department publishes, read from its
        index pages (kept a day), each marked if it is in the library."""
        who(request, x_viewer_token)
        import codesweb as W
        c = W.catalogue(_dir("web"), refresh=bool(refresh))
        out = dict(c)
        out["docs"] = mark_library([dict(d) for d in c["docs"]])
        return out

    def pending_dir():
        d = _dir("pending")
        for f in os.listdir(d):                       # a day old: gone
            try:
                if time.time() - os.path.getmtime(os.path.join(d, f)) > 86400:
                    os.remove(os.path.join(d, f))
            except OSError:
                pass
        return d

    @app.post("/api/codes/fetch")
    async def codes_fetch(request: Request, x_viewer_token: str = Header(default="")):
        """{url}: the document downloaded on the server, kept as pending (a
        day), with its details recognised - Add to the library adds it."""
        admin(request, x_viewer_token)
        body = await request.json()
        url = str((body or {}).get("url") or "").strip()
        import codesweb as W

        def run():
            pid = uuid.uuid4().hex[:12]
            tmp = os.path.join(pending_dir(), pid + ".part")
            try:
                got = W.fetch(url, tmp)
            except W.Refused as ex:
                raise HTTPException(status_code=400, detail=str(ex))
            path = os.path.join(pending_dir(), pid + "." + got["ext"])
            os.replace(tmp, path)
            meta, text = ({}, "")
            if got["ext"] == "pdf":
                meta, text = W.pdf_meta(path)
            elif got["ext"] in ("txt", "md"):
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read(6000)
            elif got["ext"] == "docx":
                try:
                    text = "\n".join(docx_paras(path)[:60])
                except Exception:
                    text = ""
            try:
                cat = W.catalogue(_dir("web"))
            except Exception:
                cat = None
            g = W.guess_details(got["final_url"] or url, meta, text, cat)
            if g["title"] == "" and not g["number"]:
                g["title"] = clean(os.path.splitext(got["name"])[0], 160)
            with open(path + ".json", "w", encoding="utf-8") as f:
                json.dump({"url": url, "final_url": got["final_url"], "name": got["name"], "ext": got["ext"], "size": got["size"]}, f)
            return {"pending": pid, "name": got["name"], "ext": got["ext"], "size": got["size"],
                    "pages": int(meta.get("pages") or 0) if str(meta.get("pages") or "").isdigit() else None,
                    "url": url, "guess": g, "kind_label": KIND_LABEL.get(g["kind"], g["kind"])}
        return await run_in_threadpool(run)

    @app.post("/api/codes/sources")
    async def codes_upload(request: Request, file: str = "", title: str = "", kind: str = "other",
                           edition: str = "", url: str = "", pending: str = "", x_viewer_token: str = Header(default="")):
        w = admin(request, x_viewer_token)
        sid = uuid.uuid4().hex[:12]
        if pending:
            # a document fetched from the web (POST /api/codes/fetch)
            if not SAFE.match(pending):
                raise HTTPException(status_code=400, detail="No such fetched document")
            pd = _dir("pending")
            info = None
            try:
                meta_f = next(f for f in os.listdir(pd) if f.startswith(pending + ".") and f.endswith(".json"))
                with open(os.path.join(pd, meta_f), encoding="utf-8") as f:
                    info = json.load(f)
            except (StopIteration, OSError, ValueError):
                raise HTTPException(status_code=404, detail="The fetched document is gone (kept a day) - Get it again")
            ext = info["ext"]
            src_path = os.path.join(pd, pending + "." + ext)
            path = os.path.join(_dir("files"), sid + "." + ext)
            shutil.move(src_path, path)
            try:
                os.remove(src_path + ".json")
            except OSError:
                pass
            size = info["size"]
            file = file or info["name"]
            url = url or info["url"]
        else:
            ext = os.path.splitext(file.lower())[1].lstrip(".")
            if ext not in ("pdf", "docx", "txt", "md"):
                raise HTTPException(status_code=400, detail="A PDF, Word (.docx) or text file please")
            path = os.path.join(_dir("files"), sid + "." + ext)
            size = 0
            with open(path, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_FILE:
                        f.close()
                        os.remove(path)
                        raise HTTPException(status_code=413, detail="Files up to 200 MB")
                    f.write(chunk)
            if not size:
                os.remove(path)
                raise HTTPException(status_code=400, detail="The file is empty")
        t = clean(title, 160) or clean(os.path.splitext(file)[0], 160) or "Untitled"

        def run():
            try:
                with LOCK:
                    got = add_source(path, ext, t, kind if kind in KINDS else "other", clean(edition, 60),
                                     clean_url(url), w.name, size)
                return {"source": source_row(source_or_404(got))}
            except Exception:
                try:
                    os.remove(path)
                except OSError:
                    pass
                raise
        return await run_in_threadpool(run)

    @app.post("/api/codes/notes")
    async def codes_note(request: Request, x_viewer_token: str = Header(default="")):
        w = admin(request, x_viewer_token)
        body = await request.json()
        text = str(body.get("text") or "").strip()
        if len(text) < 12:
            raise HTTPException(status_code=400, detail="Write or paste the text of the note")
        if len(text) > 2000000:
            raise HTTPException(status_code=413, detail="Up to 2 million characters - put a long document in as a file")
        sid = uuid.uuid4().hex[:12]
        path = os.path.join(_dir("files"), sid + ".txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        kind = body.get("kind") if body.get("kind") in KINDS else "internal"

        def run():
            with LOCK:
                got = add_source(path, "txt", clean(body.get("title"), 160) or "Office note", kind,
                                 clean(body.get("edition"), 60), clean_url(body.get("url")), w.name,
                                 len(text.encode("utf-8")), clean(body.get("note"), 300))
            return {"source": source_row(source_or_404(got))}
        return await run_in_threadpool(run)

    def source_or_404(sid):
        if not SAFE.match(sid or ""):
            raise HTTPException(status_code=404, detail="No such document")
        with db() as c:
            r = c.execute("SELECT * FROM sources WHERE id = ?", (sid,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="No such document (it may have been removed)")
        return r

    @app.patch("/api/codes/sources/{sid}")
    async def codes_edit(sid: str, request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        body = await request.json()
        return await run_in_threadpool(edit, sid, body)

    def edit(sid, body):
        r = source_or_404(sid)
        v = {"title": clean(body.get("title", r["title"]), 160) or r["title"],
             "kind": body.get("kind") if body.get("kind") in KINDS else r["kind"],
             "edition": clean(body.get("edition", r["edition"]), 60),
             "url": clean_url(body.get("url", r["url"])),
             "status": body.get("status") if body.get("status") in ("current", "superseded") else r["status"]}
        with db() as c:
            c.execute("UPDATE sources SET title=?, kind=?, edition=?, url=?, status=? WHERE id=?",
                      (v["title"], v["kind"], v["edition"], v["url"], v["status"], sid))
        return {"source": source_row(source_or_404(sid))}

    @app.delete("/api/codes/sources/{sid}")
    def codes_delete(sid: str, request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        r = source_or_404(sid)
        with LOCK:
            store_chunks(sid, [])
            with db() as c:
                c.execute("DELETE FROM sources WHERE id = ?", (sid,))
        try:
            os.remove(os.path.join(_dir("files"), r["file"]))
        except OSError:
            pass
        return {"ok": True}

    @app.get("/api/codes/sources/{sid}/file")
    def codes_file(sid: str, request: Request, x_viewer_token: str = Header(default="")):
        core.require_request(request, x_viewer_token)
        r = source_or_404(sid)
        from fastapi.responses import FileResponse
        types = {"pdf": "application/pdf", "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8",
                 "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
        name = re.sub(r'[\\/:*?"<>|]+', "_", r["title"])[:100] + "." + r["ext"]
        return FileResponse(os.path.join(_dir("files"), r["file"]), media_type=types.get(r["ext"], "application/octet-stream"),
                            headers={"Content-Disposition": "inline; filename*=UTF-8''" + quote(name)})

    def public(r, terms=None):
        return {"id": r["id"], "source": r["source"], "title": r["title"], "kind": r["kind"],
                "kind_label": KIND_LABEL.get(r["kind"], r["kind"]), "edition": r["edition"] or "",
                "status": r["status"], "ref": r["ref"] or "", "page": r["page"] or 0, "text": r["text"],
                "label": ref_of(r), "pdf": r["ext"] == "pdf", "url": r["url"] or "", "read": codesread.reflow(r["text"])}

    def extras(rows, terms):
        """Quick facts and the diagrams of a result (no AI)"""
        try:
            facts = codesread.quick_facts(rows, terms)
        except Exception as ex:
            print("codes: quick facts: %s" % ex)
            facts = []
        try:
            diagrams = result_diagrams(rows)
        except Exception as ex:
            print("codes: diagrams: %s" % ex)
            diagrams = []
        return facts, diagrams

    @app.get("/api/codes/search")
    def codes_search(request: Request, q: str = "", n: int = 20, all: int = 0, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        rows, terms = search(q[:500], max(1, min(50, n)), current_only=not all)
        facts, diagrams = extras(rows, terms)
        if q.strip():
            try:                         # for Recent: this person's last searches
                with db() as c:
                    last = c.execute("SELECT q FROM asked WHERE uid IS ? ORDER BY id DESC LIMIT 1", (w.uid,)).fetchone()
                    if not last or last["q"] != q.strip()[:500]:
                        c.execute("INSERT INTO asked(at, uid, name, project, q, answer, cites, model, tin, tout, cost) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                  (int(time.time()), w.uid, w.name, "", q.strip()[:500], "", "[]", "", 0, 0, 0))
            except sqlite3.Error as ex:
                print("codes log: %s" % ex)
        return {"items": [public(r) for r in rows], "terms": terms, "facts": facts, "diagrams": diagrams}

    @app.get("/api/codes/sources/{sid}/page/{page}.png")
    def codes_page_png(sid: str, page: int, request: Request, w: int = 400, x_viewer_token: str = Header(default="")):
        core.require_request(request, x_viewer_token)
        if not SAFE.match(sid):
            raise HTTPException(status_code=404, detail="No such document")
        width = 400 if w <= 600 else 1400
        path = page_png(sid, page, width)
        if not path:
            raise HTTPException(status_code=404, detail="No such page")
        from fastapi.responses import FileResponse
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})

    @app.get("/api/codes/clause/{cid}")
    def codes_clause(cid: int, request: Request, x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        with db() as c:
            r = c.execute("SELECT c.*, s.title, s.kind, s.edition, s.status, s.url, s.ext FROM chunks c"
                          " JOIN sources s ON s.id = c.source WHERE c.id = ?", (cid,)).fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="No such clause (the document may have been put in again)")
            near = c.execute("SELECT c.*, s.title, s.kind, s.edition, s.status, s.url, s.ext FROM chunks c"
                             " JOIN sources s ON s.id = c.source WHERE c.source = ? AND c.seq BETWEEN ? AND ?"
                             " ORDER BY c.seq", (r["source"], r["seq"] - 1, r["seq"] + 1)).fetchall()
        return {"clause": public(r), "around": [public(x) for x in near]}

    @app.get("/api/codes/history")
    def codes_history(request: Request, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        with db() as c:
            rows = c.execute("SELECT id, at, q, answer FROM asked WHERE uid IS ? ORDER BY id DESC LIMIT 30", (w.uid,)).fetchall()
        return {"items": [dict(r) for r in rows]}
