# -*- coding: utf-8 -*-
"""Codes: the building regulations library, and questions asked of it.

The office's own library - the Buildings Ordinance and its Regulations,
PNAPs, the Codes of Practice, design manuals, and the office's notes - put
in by a site admin as PDF, Word or text. Each document is split into its
clauses (or paragraphs), keeping clause numbers and pages, and indexed for
search (SQLite FTS5, built into Python: nothing else to install).

  * Search works with no AI at all: the clauses that match, with their
    reference and page, and the page in the PDF a click away.
  * Ask: the clauses that match the question are sent, with the question,
    to Claude (Anthropic API, key on the server only). The answer may only
    use those clauses and cites them as [S1], [S2] ...; when they do not
    answer it, it says so. A site admin chooses the model, or turns it off.

  GET  /api/codes/status              what is in the library, whether Ask is on
  GET  /api/codes/sources             the documents
  POST /api/codes/sources?file=&title=&kind=&edition=&url=   body: the file (site admin)
  POST /api/codes/notes               {title, kind, edition, url, text} pasted text / office note (site admin)
  PATCH  /api/codes/sources/{id}      {title, kind, edition, url, status} (site admin)
  DELETE /api/codes/sources/{id}      (site admin)
  GET  /api/codes/sources/{id}/file   the document as put in
  GET  /api/codes/search?q=&n=        clauses that match
  GET  /api/codes/clause/{id}         one clause, with the ones either side
  POST /api/codes/ask                 {q, history: [{q, a}], project} -> NDJSON stream
  GET  /api/codes/history             my last questions
  GET/POST /api/codes/settings        model, API key (write only), use (site admin)

Kept in <data>/codes/: codes.db, files/<id>.<ext>, api_key (when one is
saved here rather than set as ANTHROPIC_API_KEY).
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

MAX_FILE = 200 * 1024 * 1024
SAFE = re.compile(r"^[0-9a-f]{12}$")
KINDS = ("ordinance", "regulation", "pnap", "code", "guide", "internal", "other")
KIND_LABEL = {"ordinance": "Ordinance", "regulation": "Regulation", "pnap": "PNAP / practice note",
              "code": "Code of Practice", "guide": "Design manual / guide", "internal": "Office note",
              "other": "Other"}
MODELS = {   # what Admin offers: id -> (label, $ per 1M input, $ per 1M output)
    "claude-sonnet-5-5": ("Claude Sonnet 5.5 (recommended)", 2.0, 10.0),
    "claude-haiku-5-5": ("Claude Haiku 5.5 (cheapest)", 0.10, 0.50),
    "claude-opus-5-5": ("Claude Opus 5.5 (most careful)", 4.0, 20.0),
}
DEFAULT_MODEL = "claude-sonnet-5-5"
FALLBACK_OK = ("claude-sonnet-5-5", "claude-opus-5-5")   # server-side refusal fallback
N_CONTEXT = 12          # clauses sent with a question
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
    ("dead end", "dead-end", "死胡同"),
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
            rows = c.execute(sql, (fts_match(terms), int(n))).fetchall()
        except sqlite3.OperationalError:
            rows = []
    return [dict(r) for r in rows], shown


def ref_of(r):
    bits = [r["title"]]
    if r.get("ref"):
        bits.append(r["ref"])
    if r.get("page"):
        bits.append("p.%d" % r["page"])
    return " · ".join(bits)


# --------------------------------------------------------------------- ask

SYSTEM = """You answer questions about building requirements in Hong Kong - the Buildings Ordinance and its regulations, practice notes (PNAPs), Codes of Practice, design manuals and the office's own notes - for the architects of LWK + PARTNERS.

Each question comes with numbered extracts from the office's library, <source id="S1" ref="..." edition="..." kind="...">...</source>. Rules:
- Answer only from those extracts. Cite every requirement you state with the extract it comes from, like [S3] (several: [S1][S4]). Never cite a source you were not given, and never make up clause numbers, figures or editions.
- When the extracts do not answer the question, say plainly that the library does not cover it, say what is missing, and suggest which document or words to search for. A partial answer says which part is not covered.
- Give the figures (distances, widths, ratings, areas) exactly as the extracts state them, with their conditions and exceptions.
- Extracts of kind "internal" are the office's own notes, not law: say so when you rely on one.
- Where extracts disagree, or an edition looks old, point it out.
- Reply in the language of the question: English, or written Cantonese / Traditional Chinese when the question is in Chinese. Keep the code terms and clause numbers as in the extract.
- Be brief and practical: the answer first, then the conditions, as short paragraphs or a short list. No preamble."""


def api_key():
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if k:
        return k, "env"
    try:
        with open(os.path.join(_dir(), "api_key"), encoding="utf-8") as f:
            k = f.read().strip()
        return (k, "saved") if k else ("", "")
    except OSError:
        return "", ""


def model_choice():
    m = meta("model", DEFAULT_MODEL)
    return m if (m == "off" or m in MODELS) else DEFAULT_MODEL


def cost_of(model, tin, tout):
    p = MODELS.get(model)
    return round((tin * p[1] + tout * p[2]) / 1e6, 5) if p else 0.0


def claude_stream(key, model, system, messages):
    """Yield ("text", t) as the answer comes, then ("done", usage dict).
    Replaced in the tests (CALL)."""
    import anthropic
    client = anthropic.Anthropic(api_key=key, max_retries=2, timeout=120.0)
    args = dict(model=model, max_tokens=16000, output_config={"effort": "medium"},
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages)
    if model in FALLBACK_OK:
        cm = client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **args)
    else:
        cm = client.messages.stream(**args)
    with cm as stream:
        for t in stream.text_stream:
            yield "text", t
        final = stream.get_final_message()
    u = final.usage
    tin = (u.input_tokens or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0) + (getattr(u, "cache_read_input_tokens", 0) or 0)
    yield "done", {"stop": final.stop_reason, "in": tin, "out": u.output_tokens or 0, "model": final.model}


CALL = {"fn": claude_stream}


def explain_error(ex):
    try:
        import anthropic
    except ImportError:
        return "The server is missing the anthropic package: pip install anthropic"
    if isinstance(ex, anthropic.AuthenticationError):
        return "The Claude API key is not accepted - a site admin can change it in the Codes page > Library."
    if isinstance(ex, anthropic.PermissionDeniedError):
        return "The Claude API key may not use this model - a site admin can choose another in the Codes page > Library."
    if isinstance(ex, anthropic.RateLimitError):
        return "Claude is busy for this account (rate limit or credit) - try again in a minute."
    if isinstance(ex, anthropic.APIConnectionError):
        return "The server cannot reach the Claude API (internet, firewall or proxy)."
    if isinstance(ex, anthropic.APIStatusError):
        return "Claude API error %s: %s" % (ex.status_code, getattr(ex, "message", "") or ex)
    return "Could not write an answer: %s" % ex


def build_messages(q, rows, history):
    msgs = []
    for h in (history or [])[-4:]:
        hq, ha = str(h.get("q") or "")[:2000], re.sub(r"\[S\d+\]", "", str(h.get("a") or ""))[:4000]
        if hq and ha:
            msgs += [{"role": "user", "content": hq}, {"role": "assistant", "content": ha}]
    src = []
    for i, r in enumerate(rows):
        src.append('<source id="S%d" ref="%s" edition="%s" kind="%s"%s>\n%s\n</source>' % (
            i + 1, ref_of(r).replace('"', "'"), (r.get("edition") or "not stated").replace('"', "'"),
            r.get("kind") or "", ' status="superseded"' if r.get("status") == "superseded" else "", r["text"]))
    body = ("Extracts from the library:\n\n" + "\n\n".join(src)) if src else "The library has no extracts that match this question."
    msgs.append({"role": "user", "content": body + "\n\nQuestion: " + q})
    return msgs


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
        with db() as c:
            n = c.execute("SELECT COUNT(*) n, COALESCE(SUM(chunks), 0) k FROM sources").fetchone()
        key, _ = api_key()
        m = model_choice()
        return {"sources": n["n"], "clauses": n["k"], "ask": bool(key) and m != "off",
                "model": m, "model_label": MODELS.get(m, ("Off",))[0], "manage": w.site_admin,
                "why_off": "" if key and m != "off" else ("A site admin has turned Ask off" if m == "off"
                                                          else "No Claude API key is set up yet (the Codes page > Library)")}

    @app.get("/api/codes/sources")
    def codes_sources(request: Request, x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        with db() as c:
            rows = c.execute("SELECT * FROM sources ORDER BY status, kind, title").fetchall()
        return {"sources": [source_row(r) for r in rows], "kinds": [{"id": k, "label": KIND_LABEL[k]} for k in KINDS]}

    @app.post("/api/codes/sources")
    async def codes_upload(request: Request, file: str = "", title: str = "", kind: str = "other",
                           edition: str = "", url: str = "", x_viewer_token: str = Header(default="")):
        w = admin(request, x_viewer_token)
        ext = os.path.splitext(file.lower())[1].lstrip(".")
        if ext not in ("pdf", "docx", "txt", "md"):
            raise HTTPException(status_code=400, detail="A PDF, Word (.docx) or text file please")
        sid = uuid.uuid4().hex[:12]
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
                "label": ref_of(r), "pdf": r["ext"] == "pdf", "url": r["url"] or ""}

    @app.get("/api/codes/search")
    def codes_search(request: Request, q: str = "", n: int = 20, all: int = 0, x_viewer_token: str = Header(default="")):
        who(request, x_viewer_token)
        rows, terms = search(q[:500], max(1, min(50, n)), current_only=not all)
        return {"items": [public(r) for r in rows], "terms": terms}

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

    @app.post("/api/codes/ask")
    async def codes_ask(request: Request, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        body = await request.json()
        q = str(body.get("q") or "").strip()[:2000]
        if not q:
            raise HTTPException(status_code=400, detail="Ask a question")
        history = body.get("history") if isinstance(body.get("history"), list) else []
        history = [h for h in history if isinstance(h, dict)]
        project = clean(body.get("project"), 60)
        key, _ = api_key()
        model = model_choice()
        # a follow-up ("and for a residential building?") searches with the question before it too
        look = q + (" " + str(history[-1].get("q") or "")[:500] if history else "")

        def gen():          # a plain generator: Starlette runs it in the threadpool
            rows, terms = search(look, N_CONTEXT)
            sources = [public(r) for r in rows]
            yield json.dumps({"type": "sources", "items": sources, "terms": terms}, ensure_ascii=False) + "\n"
            if not key or model == "off":
                yield json.dumps({"type": "off", "why": "A site admin has turned Ask off" if model == "off"
                                  else "No Claude API key is set up yet - a site admin adds it in the Codes page > Library. The matching clauses are above."}) + "\n"
                return
            if not rows:
                yield json.dumps({"type": "text", "t": "Nothing in the library matches this question, so there is nothing to answer from. "
                                  "Try other words (e.g. the term the code uses), or ask a site admin to add the document."}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
                return
            parts, usage = [], {}
            try:
                for kind, v in CALL["fn"](key, model, SYSTEM, build_messages(q, rows, history)):
                    if kind == "text":
                        parts.append(v)
                        yield json.dumps({"type": "text", "t": v}, ensure_ascii=False) + "\n"
                    elif kind == "done":
                        usage = v
            except Exception as ex:
                yield json.dumps({"type": "error", "why": explain_error(ex)}) + "\n"
                return
            answer = "".join(parts)
            if usage.get("stop") == "refusal":
                yield json.dumps({"type": "error", "why": "Claude declined to answer this question."}) + "\n"
            elif usage.get("stop") == "max_tokens":
                yield json.dumps({"type": "text", "t": "\n\n(The answer was cut off - ask a narrower question.)"}) + "\n"
            cited = sorted(set(int(x) for x in re.findall(r"\[S(\d+)\]", answer) if 0 < int(x) <= len(rows)))
            cost = cost_of(model, usage.get("in", 0), usage.get("out", 0))
            try:
                with db() as c:
                    c.execute("INSERT INTO asked(at, uid, name, project, q, answer, cites, model, tin, tout, cost)"
                              " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                              (int(time.time()), w.uid, w.name, project, q, answer,
                               json.dumps([sources[i - 1]["id"] for i in cited]), usage.get("model") or model,
                               usage.get("in", 0), usage.get("out", 0), cost))
            except sqlite3.Error as ex:
                print("codes log: %s" % ex)
            yield json.dumps({"type": "done", "cited": cited, "model": usage.get("model") or model}) + "\n"

        from fastapi.responses import StreamingResponse
        return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @app.get("/api/codes/history")
    def codes_history(request: Request, x_viewer_token: str = Header(default="")):
        w = who(request, x_viewer_token)
        with db() as c:
            rows = c.execute("SELECT id, at, q, answer FROM asked WHERE uid IS ? ORDER BY id DESC LIMIT 30", (w.uid,)).fetchall()
        return {"items": [dict(r) for r in rows]}

    @app.get("/api/codes/settings")
    def codes_settings(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        key, src = api_key()
        month = time.strftime("%Y-%m")
        start = int(time.mktime(time.strptime(month + "-01", "%Y-%m-%d")))
        with db() as c:
            u = c.execute("SELECT COUNT(*) n, COALESCE(SUM(cost), 0) cost FROM asked WHERE at >= ?", (start,)).fetchone()
            tot = c.execute("SELECT COUNT(*) n, COALESCE(SUM(cost), 0) cost FROM asked").fetchone()
        return {"model": model_choice(), "models": [{"id": k, "label": v[0], "in": v[1], "out": v[2]} for k, v in MODELS.items()],
                "key_set": bool(key), "key_from": src, "key_end": key[-4:] if key else "",
                "month": {"questions": u["n"], "usd": round(u["cost"], 2)},
                "total": {"questions": tot["n"], "usd": round(tot["cost"], 2)}}

    @app.post("/api/codes/settings")
    async def codes_settings_set(request: Request, x_viewer_token: str = Header(default="")):
        admin(request, x_viewer_token)
        body = await request.json()
        return await run_in_threadpool(save_settings, body, request, x_viewer_token)

    def save_settings(body, request, x_viewer_token):
        m = body.get("model")
        if m is not None:
            if m != "off" and m not in MODELS:
                raise HTTPException(status_code=400, detail="Unknown model")
            set_meta("model", m)
        if body.get("clear_key"):
            try:
                os.remove(os.path.join(_dir(), "api_key"))
            except OSError:
                pass
        k = str(body.get("key") or "").strip()
        if k:
            if not re.match(r"^sk-ant-[A-Za-z0-9_\-]{20,}$", k):
                raise HTTPException(status_code=400, detail="That does not look like a Claude API key (it starts sk-ant-)")
            path = os.path.join(_dir(), "api_key")
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                f.write(k)
            try:
                os.chmod(path + ".tmp", 0o600)
            except OSError:
                pass
            os.replace(path + ".tmp", path)
        return codes_settings(request, x_viewer_token)
