# -*- coding: utf-8 -*-
"""The Codes library and the web: the documents the Buildings Department
publishes (a catalogue read from its index pages), a document fetched from
a web address, and its details (title, kind, edition) recognised.

  catalogue()        the BD documents: codes and design manuals, PNAPs (ADM /
                     APP / ADV), joint practice notes, practice notes for RSE
                     and for building inspectors - number, title, edition or
                     date, PDF - read from bd.gov.hk, kept for a day; and the
                     Cap. 123 family on eLegislation (open only: its pages are
                     built by script, there is no file to fetch)
  fetch(url)         a document downloaded on the server: http(s) only, no
                     local or private address (also after a redirect), 200 MB
  guess_details()    title, kind, number, edition / date: from the catalogue,
                     then the address, then the PDF itself

Plain Python (urllib, html.parser): nothing to install.
"""
import ipaddress
import json
import os
import re
import socket
import subprocess
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from html.parser import HTMLParser

BD = "https://www.bd.gov.hk"
UA = "LWK-Viewer/1 (codes library)"
MAX_FILE = 200 * 1024 * 1024
TIMEOUT = 60
CATALOGUE_TTL = 24 * 3600

# where the BD lists its documents: (id, label, kind, index page)
SOURCES = [
    ("codes", "Codes and design manuals", "code", BD + "/en/resources/codes-and-references/codes-and-design-manuals/index.html"),
    ("pnap", "PNAPs (ADM / APP / ADV)", "pnap", BD + "/en/resources/codes-and-references/practice-notes-and-circular-letters/index_pnap.html"),
    ("jpn", "Joint Practice Notes", "pnap", BD + "/en/resources/codes-and-references/practice-notes-and-circular-letters/index_joint.html"),
    ("pnrc", "Practice Notes for RSE / RGE (PNRC)", "pnap", BD + "/en/resources/codes-and-references/practice-notes-and-circular-letters/index_pnrc.html"),
    ("pnbi", "Practice Notes for Building Inspectors (PNBI)", "pnap", BD + "/en/resources/codes-and-references/practice-notes-and-circular-letters/index_pnbi.html"),
]
ELEG = "https://www.elegislation.gov.hk/hk/"
# the Cap. 123 family on eLegislation: open there, download its PDF, then Choose File
LAWS = [
    ("123", "Buildings Ordinance", "ordinance"),
    ("123A", "Building (Administration) Regulations", "regulation"),
    ("123B", "Building (Construction) Regulation", "regulation"),
    ("123C", "Building (Demolition Works) Regulations", "regulation"),
    ("123D", "Building (Energy Efficiency) Regulation", "regulation"),
    ("123E", "Building (Private Streets and Access Roads) Regulations", "regulation"),
    ("123F", "Building (Planning) Regulations", "regulation"),
    ("123G", "Building (Refuse Storage and Material Recovery Chambers and Refuse Chutes) Regulations", "regulation"),
    ("123H", "Building (Ventilating Systems) Regulations", "regulation"),
    ("123I", "Building (Standards of Sanitary Fitments, Plumbing, Drainage Works and Latrines) Regulations", "regulation"),
    ("123J", "Building (Oil Storage Installations) Regulations", "regulation"),
    ("123K", "Building (Appeal) Regulations", "regulation"),
    ("123N", "Building (Minor Works) Regulation", "regulation"),
    ("123O", "Building (Planning) (Amendment) / Building (Inspection and Repair) Regulation", "regulation"),
]


# ------------------------------------------------------------ the catalogue

class _Rows(HTMLParser):
    """The rows of a BD index table: for each <tr>, its cells by class
    (notices_no / notices_title / notices_date) - their text, and the links
    in them (href, text)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.row, self.cell, self.link, self.skip = [], None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr":
            self.row = {}
        elif tag == "td" and self.row is not None:
            cls = a.get("class") or ""
            name = next((c for c in ("notices_no", "notices_title", "notices_date") if c in cls), None)
            self.cell = {"name": name, "text": "", "own": "", "links": [], "depth": 0} if name else None
        elif tag == "a" and self.cell is not None:
            self.link = {"href": a.get("href") or "", "text": "", "cls": a.get("class") or ""}
        if self.cell is not None and tag == "div":
            self.cell["depth"] += 1

    def handle_endtag(self, tag):
        if tag == "a" and self.link is not None and self.cell is not None:
            self.cell["links"].append(self.link)
            self.link = None
        elif tag == "div" and self.cell is not None:
            self.cell["depth"] -= 1
        elif tag == "td" and self.cell is not None and self.row is not None:
            self.row[self.cell["name"]] = self.cell
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.rows.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is None:
            return
        self.cell["text"] += data
        if self.link is not None:
            self.link["text"] += data
        # the title's own words: not the "More details" button, not the
        # collapsed links under it
        elif self.cell["depth"] == 0 or self.cell["name"] == "notices_title" and self.cell["depth"] == 0:
            self.cell["own"] += data


def _sp(s):
    return re.sub(r"\s+", " ", unescape(s or "")).strip()


def _abs(base, href):
    return urllib.parse.urljoin(base, href) if href else ""


_EDITION = re.compile(r"\((\d{4}\s+Edition|\d{4}\s+version|[A-Z][a-z]+\s+\d{4}\s+Edition)\)|\b(\d{4})\s*\((\d{4})\s+Edition\)", re.I)


def edition_of(title):
    """'Code of Practice for Fire Safety in Buildings 2011 (2024 Edition)' -> '2011 (2024 Edition)'"""
    t = title or ""
    m = re.search(r"(\b\d{4}\b)?\s*\(([^()]*\b(?:Edition|edition|version|Version)\b[^()]*)\)", t)
    if m:
        return ((m.group(1) + " ") if m.group(1) else "") + "(" + m.group(2).strip() + ")"
    m = re.search(r"\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)", t)
    return m.group(0) if m else ""


def kind_of_title(title, default="code"):
    t = (title or "").lower()
    if "code of practice" in t:
        return "code"
    if re.search(r"\b(design manual|guide|guidelines|handbook|manual)\b", t):
        return "guide"
    return default


def parse_index(html, base, src):
    """One BD index page -> [{src, number, title, edition, date, url, kind}]"""
    sid, label, kind = src[0], src[1], src[2]
    p = _Rows()
    p.feed(html)
    out = []
    for r in p.rows:
        no, ti, da = r.get("notices_no"), r.get("notices_title"), r.get("notices_date")
        if no and no["links"]:                       # PNAP-like: the number is the link
            pdf = next((l for l in no["links"] if l["href"].lower().endswith(".pdf")), no["links"][0])
            number = _sp(pdf["text"]) or _sp(no["text"])
            title = _sp(ti["own"]) if ti else ""
            title = re.sub(r"\s*More details?\s*$", "", title)
            out.append({"src": sid, "source": label, "number": number, "title": title,
                        "date": _sp(da["text"]) if da else "", "edition": _sp(da["text"]) if da else "",
                        "url": _abs(base, pdf["href"]), "kind": kind})
        elif ti and ti["links"]:                     # codes and manuals: the title is the link
            pdf = next((l for l in ti["links"] if l["href"].lower().endswith(".pdf") and "pdficon" in l["cls"].lower()), None)
            if not pdf:
                continue
            title = _sp(pdf["text"])
            old = next((l for l in ti["links"] if "obsolete" in l["text"].lower() or "old" in l["href"].lower() and l is not pdf), None)
            date = _sp(da["text"]) if da else ""
            avail = date if date.lower() in ("for sale", "not available", "free") else ""
            out.append({"src": sid, "source": label, "number": "", "title": title, "edition": edition_of(title),
                        "date": "" if avail else date, "availability": avail,
                        "url": _abs(base, pdf["href"]), "obsolete": _abs(base, old["href"]) if old else "",
                        "kind": kind_of_title(title, kind)})
    # the same PDF listed twice (a signed copy is under "more details", not here): once
    seen, uniq = set(), []
    for d in out:
        if d["url"] in seen or not d["url"].lower().endswith(".pdf"):
            continue
        seen.add(d["url"])
        uniq.append(d)
    return uniq


def laws():
    return [{"src": "laws", "source": "Ordinances and regulations (eLegislation)", "number": "Cap. " + c, "title": t,
             "edition": "", "date": "", "url": ELEG + "cap" + c, "kind": k, "open_only": True} for c, t, k in LAWS]


def _get(url, limit=8 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read(limit + 1)[:limit].decode("utf-8", "replace")


def catalogue(cache_dir, refresh=False, getter=None):
    """{docs: [...], sources: [{id, label, ok, error}], at}"""
    path = os.path.join(cache_dir, "catalogue.json")
    if not refresh:
        try:
            with open(path, encoding="utf-8") as f:
                c = json.load(f)
            if time.time() - c.get("at", 0) < CATALOGUE_TTL:
                return c
        except (OSError, ValueError):
            pass
    get = getter or _get
    docs, srcs = [], []
    for src in SOURCES:
        try:
            got = parse_index(get(src[3]), src[3], src)
            docs += got
            srcs.append({"id": src[0], "label": src[1], "ok": True, "n": len(got), "page": src[3]})
        except Exception as ex:
            srcs.append({"id": src[0], "label": src[1], "ok": False, "error": str(ex)[:200], "page": src[3]})
    docs += laws()
    srcs.append({"id": "laws", "label": "Ordinances and regulations (eLegislation)", "ok": True, "n": len(LAWS), "page": ELEG, "open_only": True})
    c = {"docs": docs, "sources": srcs, "at": time.time()}
    if any(s["ok"] for s in srcs if s["id"] != "laws"):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False)
        os.replace(tmp, path)
    return c


# --------------------------------------------------------------- fetching

class Refused(Exception):
    pass


def _public_host(host):
    """The address is on the internet: not this machine, not a private,
    link-local or reserved network (a request to them from the server could
    reach what is behind it)."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise Refused("No such host: %s" % host)
    for inf in infos:
        ip = ipaddress.ip_address(inf[4][0].split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def check_url(url, resolve=True):
    u = urllib.parse.urlparse(str(url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise Refused("A web address starting with http:// or https:// please")
    if resolve and not _public_host(u.hostname):
        raise Refused("That address is not on the internet (a local or private network) - not fetched")
    return u


class _NoPrivateRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, out_path, limit=MAX_FILE, opener=None):
    """Download to out_path -> {name, ext, size, type, final_url}. Raises Refused."""
    check_url(url)
    op = opener or urllib.request.build_opener(_NoPrivateRedirect())
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/pdf,*/*"})
    try:
        r = op.open(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as ex:
        raise Refused("The site answered %s %s" % (ex.code, ex.reason))
    except urllib.error.URLError as ex:
        raise Refused("Could not reach it: %s" % (ex.reason,))
    final = r.geturl()
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    clen = r.headers.get("Content-Length")
    if clen and clen.isdigit() and int(clen) > limit:
        raise Refused("Over %d MB" % (limit // 1024 // 1024))
    size = 0
    head = b""
    with open(out_path, "wb") as f:
        while True:
            b = r.read(1024 * 256)
            if not b:
                break
            if not head:
                head = b[:8]
            size += len(b)
            if size > limit:
                f.close()
                os.remove(out_path)
                raise Refused("Over %d MB" % (limit // 1024 // 1024))
            f.write(b)
    name = urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(final).path)) or "document"
    if head.startswith(b"%PDF"):
        ext = "pdf"
    elif head.startswith(b"PK") and (name.lower().endswith(".docx") or "wordprocessingml" in ctype):
        ext = "docx"
    elif ctype.startswith("text/plain"):
        ext = "txt"
    else:
        os.remove(out_path)
        if "html" in ctype:
            raise Refused("That address is a web page, not a document - open it and copy the address of its PDF")
        raise Refused("Not a PDF, Word (.docx) or text file (%s)" % (ctype or "unknown type"))
    if not size:
        os.remove(out_path)
        raise Refused("The file is empty")
    return {"name": name, "ext": ext, "size": size, "type": ctype, "final_url": final}


# ---------------------------------------------------- recognising the details

def pdf_meta(path):
    """{title, pages} from pdfinfo, and the text of the first 2 pages"""
    meta, text = {}, ""
    if shutil.which("pdfinfo"):
        try:
            out = subprocess.run(["pdfinfo", path], capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
            for line in out.splitlines():
                k, _, v = line.partition(":")
                meta[k.strip().lower()] = v.strip()
        except Exception:
            pass
    if shutil.which("pdftotext"):
        try:
            text = subprocess.run(["pdftotext", "-l", "2", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
        except Exception:
            pass
    return meta, text


def _by_url(cat, url):
    if not cat or not url:
        return None
    key = url.split("#")[0].split("?")[0].lower()
    return next((d for d in cat.get("docs", []) if d.get("url", "").lower() == key), None)


def guess_details(url="", meta=None, text="", cat=None):
    """-> {title, kind, number, edition, date, from} - from the catalogue,
    then the address, then the document itself ('from' says which)."""
    g = {"title": "", "kind": "", "number": "", "edition": "", "date": "", "from": ""}
    d = _by_url(cat, url)
    if d:
        title = d["title"] if not d.get("number") else "PNAP " + d["number"] + " " + d["title"] if d["src"] == "pnap" else d["number"] + " " + d["title"]
        g.update({"title": title.strip(), "kind": d["kind"], "number": d.get("number", ""),
                  "edition": d.get("edition") or d.get("date") or "", "date": d.get("date", ""), "from": "the BD catalogue"})
        return g
    u = (url or "").lower()
    m = re.search(r"/pnap/(adm|app|adv)/(adm|app|adv)(\d{3})", u)
    if m:
        g.update({"kind": "pnap", "number": "%s-%d" % (m.group(1).upper(), int(m.group(3))), "from": "the address"})
    m = re.search(r"/joint/jpn0*(\d+)", u)
    if m:
        g.update({"kind": "pnap", "number": "JPN %d" % int(m.group(1)), "from": "the address"})
    m = re.search(r"elegislation\.gov\.hk/hk/cap(\d+[a-z]{0,2})", u)
    if m:
        c = m.group(1).upper()
        g.update({"kind": "ordinance" if c.isdigit() else "regulation", "number": "Cap. " + c, "from": "the address"})
        law = next((t for cc, t, k in LAWS if cc == c), "")
        if law:
            g["title"] = "Cap. %s %s" % (c, law)
    if "code-and-design-manuals" in u and not g["kind"]:
        g.update({"kind": "code", "from": "the address"})
    # the document itself
    meta = meta or {}
    t = text or ""
    first = _sp(t[:3000])
    mt = _sp(meta.get("title", ""))
    if not g["title"]:
        m = re.search(r"(Code of Practice (?:for|on) [A-Za-z ,&()-]{5,120}?\b(?:19|20)\d{2}\b(?:\s*\(\d{4} Edition\))?)", first)
        if m:
            g["title"] = _sp(m.group(1))
        elif mt and len(mt) > 6 and not re.match(r"^(microsoft word|untitled|document\d*|\S+\.(docx?|pdf))", mt, re.I):
            g["title"] = mt
    if not g["number"]:
        m = re.search(r"\bPNAP\s*(ADM|APP|ADV)\s*-\s*(\d{1,3})\b", first) or re.search(r"\b(ADM|APP|ADV)\s*-\s*(\d{1,3})\b", first)
        if m:
            g["number"] = "%s-%d" % (m.group(1).upper(), int(m.group(2)))
            g["kind"] = g["kind"] or "pnap"
        m2 = re.search(r"\bCap\.?\s*(\d{2,4}[A-Z]{0,2})\b", first)
        if m2 and not g["number"]:
            g["number"] = "Cap. " + m2.group(1)
    if not g["edition"]:
        m = (re.search(r"\b((?:19|20)\d{2})\s*\((\d{4}) Edition\)", first) or None)
        if m:
            g["edition"] = "%s (%s Edition)" % (m.group(1), m.group(2))
        else:
            m = re.search(r"This revision\s+([A-Z][a-z]+\s+(?:19|20)\d{2})", first) or re.search(r"(?:First issue|Last revision|Revised)\s+([A-Z][a-z]+\s+(?:19|20)\d{2})", first)
            if m:
                g["edition"] = "rev. " + m.group(1) if "revision" in m.group(0).lower() or "revised" in m.group(0).lower() else m.group(1)
            elif g["title"]:
                g["edition"] = edition_of(g["title"])
    if g["number"] and g["kind"] == "pnap" and g["title"] and g["number"] not in g["title"]:
        g["title"] = "PNAP %s %s" % (g["number"], g["title"]) if not g["number"].startswith("JPN") else "%s %s" % (g["number"], g["title"])
    if not g["kind"]:
        g["kind"] = kind_of_title(g["title"], "other") if g["title"] else "other"
    if not g["from"] and (g["title"] or g["number"] or g["edition"]):
        g["from"] = "the document"
    return g
