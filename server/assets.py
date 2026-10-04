"""The viewer's own files (html, js, css), served so pages open fast.

Registered by app.py:  assets.register(app, core)  (not with --plain-assets).

  - Compressed: each file is gzipped once and kept in memory (three-
    fragments.js: 4.8 MB -> 0.7 MB; app.js 246 kB -> 74 kB).

  - Kept by the browser: every page is sent with an import map that points
    each module at "x.js?v=<tag>", the tag being the file's own mtime and
    size (the same tag /api/offline/shell lists). A file asked for with its
    current tag never changes, so it is sent as "immutable" and a later
    visit does not even ask for it. A file that changed has a new tag, so a
    new address: old and new files are never mixed on a page - the reason
    the viewer's files used to be checked one by one on every visit.

  - Fetched at once: the page lists every module it will import as a
    modulepreload, instead of the browser finding them one import level
    at a time; and boot.js, first on every page, starts the page's API
    requests while the big scripts are still on their way.

A browser too old for import maps simply asks for the plain addresses
(checked on every visit, as before) - consistent, only slower.
"""

import gzip
import hashlib
import json
import os
import posixpath
import re
import threading
import time

from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
}
# sw.js must keep its one address (it is the service worker's identity)
LEAVE = {"sw.js"}
IMPORT_RE = re.compile(r"""(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["'](\.{1,2}/[^"']+\.m?js)["']""")
LOCAL_REF = re.compile(r"""(<(?:script|link)\b[^>]*?\s(?:src|href)=")((?!https?:|//|data:|/)[^"?#]+\.(?:js|css))(")""", re.I)
ENTRY = re.compile(r"""<script\s+type="module"\s+src="((?!https?:|//)[^"?#]+\.js)"\s*>\s*</script>""", re.I)
CHARSET = re.compile(r"<meta\s+charset=[^>]*>", re.I)


def _tag(path):
    st = os.stat(path)
    return "%x-%x" % (st.st_mtime_ns, st.st_size)


class Assets(object):
    def __init__(self, top):
        self.top = os.path.abspath(top)
        self.lock = threading.Lock()
        self.tags = {}          # "nav.js" -> tag, every js / css
        self.version = ""
        self.scanned = 0.0
        self.files = {}         # rel -> (tag, raw, gz)
        self.deps = {}          # (rel, tag) -> [rel, ...] static imports
        self.pages = {}         # rel -> (key, body, gz, etag)

    # -------------------------------------------------- what is there

    def scan(self):
        if time.time() - self.scanned < 1.0:
            return
        tags = {}
        for folder, dirs, names in os.walk(self.top):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d != "__pycache__")
            for n in names:
                if n.startswith(".") or not n.lower().endswith((".js", ".mjs", ".css")):
                    continue
                p = os.path.join(folder, n)
                try:
                    tags[os.path.relpath(p, self.top).replace(os.sep, "/")] = _tag(p)
                except OSError:
                    pass
        h = hashlib.sha1()
        for k in sorted(tags):
            h.update(("%s|%s\n" % (k, tags[k])).encode("utf-8"))
        with self.lock:
            self.tags, self.version, self.scanned = tags, h.hexdigest()[:16], time.time()

    def path_of(self, rel):
        if not rel or "\\" in rel or rel.startswith("/") or ".." in rel.split("/"):
            return None
        p = os.path.normpath(os.path.join(self.top, *rel.split("/")))
        if not p.startswith(self.top + os.sep) or not os.path.isfile(p):
            return None
        return p

    def file(self, rel, p):
        tag = _tag(p)
        hit = self.files.get(rel)
        if hit and hit[0] == tag:
            return hit
        with open(p, "rb") as f:
            raw = f.read()
        gz = gzip.compress(raw, 6) if len(raw) > 1024 else None
        out = (tag, raw, gz)
        with self.lock:
            self.files[rel] = out
        return out

    def imports_of(self, rel):
        """The modules this one imports statically (not import())."""
        tag = self.tags.get(rel)
        if not tag:
            return []
        hit = self.deps.get((rel, tag))
        if hit is not None:
            return hit
        p = self.path_of(rel)
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except (OSError, TypeError):
            return []
        # comments out of the way, so an import in a comment is not followed
        text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
        text = re.sub(r"(?m)^\s*//.*$", " ", text)
        base = posixpath.dirname(rel)
        out = []
        for spec in IMPORT_RE.findall(text):
            r = posixpath.normpath(posixpath.join(base, spec))
            if r in self.tags and r not in out:
                out.append(r)
        self.deps[(rel, tag)] = out
        return out

    def closure(self, entries):
        seen, todo = [], list(entries)
        while todo:
            r = todo.pop(0)
            if r in seen:
                continue
            seen.append(r)
            todo.extend(self.imports_of(r))
        return seen

    # -------------------------------------------------- a page

    def page(self, rel, p):
        key = (_tag(p), self.version)
        hit = self.pages.get(rel)
        if hit and hit[0] == key:
            return hit
        with open(p, encoding="utf-8") as f:
            html = f.read()
        tags = self.tags
        v = lambda r: "%s?v=%s" % (r, tags[r])

        entries = [posixpath.normpath(e) for e in ENTRY.findall(html)]
        # an entry module goes under the import map too (see the top)
        html = ENTRY.sub(lambda m: '<script type="module">import "./%s";</script>' % posixpath.normpath(m.group(1)), html)
        html = LOCAL_REF.sub(lambda m: m.group(1) + (v(posixpath.normpath(m.group(2))) if posixpath.normpath(m.group(2)) in tags else m.group(2)) + m.group(3), html)
        imap = {"imports": dict(("./" + r, "./" + v(r)) for r in sorted(tags) if r.endswith((".js", ".mjs")))}
        have = set(re.findall(r'rel="modulepreload"\s+href="([^"?]+)', html))
        boot = "boot.js" in tags and "boot.js" not in entries
        pre = [r for r in self.closure((["boot.js"] if boot else []) + entries) if r not in have]
        head = ('<script type="importmap">%s</script>\n' % json.dumps(imap, separators=(",", ":"))
                + "".join('<link rel="modulepreload" href="%s">\n' % v(r) for r in pre)
                + ('<script type="module">import "./boot.js";</script>\n' if boot else ""))
        m = CHARSET.search(html)
        if m:
            html = html[:m.end()] + "\n" + head + html[m.end():]
        else:
            html = re.sub(r"(<head[^>]*>)", lambda x: x.group(1) + "\n" + head, html, count=1, flags=re.I)
        body = html.encode("utf-8")
        out = (key, body, gzip.compress(body, 6), '"p%s"' % hashlib.sha1(body).hexdigest()[:20])
        with self.lock:
            self.pages[rel] = out
        return out

    # -------------------------------------------------- answering

    def respond(self, path, v, headers):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        ext = os.path.splitext(rel)[1].lower()
        if ext not in TYPES or rel in LEAVE:
            return None
        p = self.path_of(rel)
        if not p:
            return None
        self.scan()
        gz_ok = "gzip" in (headers.get("accept-encoding") or "")
        if ext == ".html":
            _, raw, gz, etag = self.page(rel, p)
            cache = "no-cache"
        else:
            tag, raw, gz = self.file(rel, p)
            etag = '"%s"' % tag
            cache = "private, max-age=31536000, immutable" if v and v == tag else "no-cache"
        h = {"Cache-Control": cache, "ETag": etag, "Vary": "Accept-Encoding"}
        inm = headers.get("if-none-match") or ""
        if etag in [x.strip() for x in inm.split(",")]:
            return Response(status_code=304, headers=h)
        if gz_ok and gz is not None:
            h["Content-Encoding"] = "gzip"
            return Response(gz, media_type=TYPES[ext], headers=h)
        return Response(raw, media_type=TYPES[ext], headers=h)


def register(app, core):
    A = Assets(core.VIEWER_DIR)

    @app.middleware("http")
    async def viewer_assets(request, call_next):
        if request.method in ("GET", "HEAD") and not request.url.path.startswith(("/api/", "/data/", "/snapshots/")):
            try:
                r = await run_in_threadpool(A.respond, request.url.path, request.query_params.get("v"), request.headers)
            except Exception as ex:          # never worse than the plain files
                print("assets: %s: %s" % (request.url.path, ex))
                r = None
            if r is not None:
                return r
        return await call_next(request)

    return A


# ------------------------------------------------------------------ JSON

def register_json_gzip(app):
    """API answers (JSON) compressed when they are worth it. Files, pictures,
    video and model tiles are left alone (their sizes and Range requests)."""

    @app.middleware("http")
    async def json_gzip(request, call_next):
        response = await call_next(request)
        if "gzip" not in (request.headers.get("accept-encoding") or ""):
            return response
        if not (response.headers.get("content-type") or "").startswith("application/json"):
            return response
        if response.headers.get("content-encoding"):
            return response
        body = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
        # the headers as they were (two Set-Cookie stay two), the length new
        keep = [(k, v) for k, v in response.raw_headers if k.lower() not in (b"content-length", b"content-encoding")]
        if len(body) >= 1400:
            body = gzip.compress(body, 5)
            keep += [(b"content-encoding", b"gzip"), (b"vary", b"Accept-Encoding")]
        out = Response(status_code=response.status_code)
        out.body = body
        out.raw_headers = keep + [(b"content-length", str(len(body)).encode())]
        return out
