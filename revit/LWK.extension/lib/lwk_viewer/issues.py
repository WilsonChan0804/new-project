# -*- coding: utf-8 -*-
"""LWK Issues in Revit: the viewer's issues, listed, located and marked.

Three jobs, in the order a coordinator uses them:

  1. list      read the project's issues straight from the viewer server
               (the same ones the web dashboard shows), no BCF file needed
  2. go to     a 3D issue opens a personal 3D view boxed round the exact
               point and selects the element it was raised on; a sheet
               issue opens its sheet zoomed onto the markup, or the plan
               view it was drawn on, zoomed onto the spot
  3. mark      a coloured pin at every issue's exact position in the model
               (red open, orange in progress, green resolved), each carrying
               its number, title, status, assignee and due date. The pins
               live on their own workset, "LWK Issues", and one button
               removes them all. Comments can be pinned too (grey).
  4. clouds    every issue and comment drawn on a sheet gets a revision
               cloud round it on that Revit sheet, under its own revision
               "LWK Viewer issues", its number and title in the cloud's
               Comments - removed again with one button.
  5. reply     status and comments set in Revit go back to the viewer server
               as the same issue record the web page edits (history, Teams
               notice and all).

Why this is more exact than BCF: a BCF viewpoint only says where the
camera stood, so in Revit you still have to find the spot. Every issue in
the viewer already carries Revit's own internal coordinates - the exporter
wrote the mapping - so the pin goes exactly where the dot was.

Coordinates: 3D issues store model_internal_mm (host model, internal
origin); sheet issues store points_mm on the paper, measured from the
titleblock's lower-left corner (the PDF page corner), and anchor.model_mm
where the view maps them into the model.
"""
import io
import json
import os

__version__ = "2026-09-30l"

FT_MM = 304.8
SETTINGS = os.path.join(os.environ.get("APPDATA", "."), "LWK", "issues.json")
APP_ID = "LWK.Issues"
WORKSET = "LWK Issues"

STATUS_COLORS = {                       # r, g, b
    "Open": (226, 69, 60),
    "In progress": (232, 161, 58),
    "Resolved": (59, 130, 246),
    "Closed": (14, 159, 110),
    "Comment": (140, 146, 156),
}
REVISION = "LWK Viewer issues"
STATUSES = ("Open", "In progress", "Resolved", "Closed")
FILTER = "LWK Viewer issue pins"     # view filter: pins have Mark "LWK #n"
# the viewer's issue types (viewer/issuetypes.js)
TYPE_LABELS = {"general": "General", "design": "Design", "coordination": "Coordination",
               "clash": "Clash", "fire": "Fire safety", "statutory": "Statutory / BD",
               "structure": "Structure", "mep": "MEP", "facade": "Facade",
               "drawing": "Drawing error", "query": "Query / RFI"}
MARKUP_NAMES = {"rect": "rectangle", "ellipse": "ellipse", "line": "line", "arrow": "arrow",
                "cloud": "cloud", "polygon": "polygon", "pen": "pen sketch",
                "polyline": "polyline", "area": "area", "text": "text", "textbox": "text box",
                "callout": "callout", "dimension": "dimension", "measure": "measurement",
                "image": "picture", "snip": "snip", "angle": "angle"}


# ---------------------------------------------------------------- settings

def load_settings():
    try:
        with io.open(SETTINGS, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(data):
    from lwk_viewer import jsonio
    d = os.path.dirname(SETTINGS)
    if not os.path.isdir(d):
        os.makedirs(d)
    jsonio.write_atomic(SETTINGS, data)


# ------------------------------------------------------------------ server

class ServerError(Exception):
    def __init__(self, message, status=0):
        Exception.__init__(self, message)
        self.status = status


class Client(object):
    """The viewer server's API, from IronPython (System.Net) or, for tests,
    from CPython (urllib)."""

    def __init__(self, base, token=""):
        self.base = (base or "").rstrip("/")
        self.token = token or ""

    def _request(self, method, path, body=None, project=""):
        url = self.base + path
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-Viewer-Token"] = self.token
        if project:
            headers["X-Project"] = project
        data = None
        if body is not None:
            from lwk_viewer import jsonio
            data = jsonio.dumps(body, indent=0)
        if _dotnet():
            return self._dotnet(method, url, headers, data)
        return self._urllib(method, url, headers, data)

    def _dotnet(self, method, url, headers, data):
        """Any failure comes back as a ServerError with the reason in words:
        a connection refused while sending the body used to escape as a raw
        .NET exception, which a button handler swallowed - "Sign in" then
        simply did nothing."""
        try:
            return self._dotnet_raw(method, url, headers, data)
        except ServerError:
            raise
        except (ImportError, AttributeError):
            # .NET networking not reachable from this Python: use Python's own
            return self._urllib(method, url, headers, data)
        except Exception as ex:
            msg = getattr(ex, "Message", None) or str(ex)
            inner = getattr(ex, "InnerException", None)
            if inner is not None:
                msg += " (%s)" % (getattr(inner, "Message", None) or inner)
            raise ServerError("Cannot reach %s: %s" % (self.base or "the server", msg))

    def _dotnet_raw(self, method, url, headers, data):
        import System
        N = _net()
        HttpWebRequest, WebException = N.HttpWebRequest, N.WebException
        from System.IO import StreamReader
        from System.Text import Encoding
        req = HttpWebRequest.Create(url)
        req.Method = method
        req.Timeout = 20000
        req.ContentType = "application/json"
        for k, v in headers.items():
            if k.lower() != "content-type":
                req.Headers.Add(k, v)
        if data is not None:
            raw = Encoding.UTF8.GetBytes(data)
            req.ContentLength = raw.Length
            s = req.GetRequestStream()
            s.Write(raw, 0, raw.Length)
            s.Close()
        try:
            resp = req.GetResponse()
            status = int(resp.StatusCode)
        except WebException as ex:
            resp = ex.Response
            if resp is None:
                raise ServerError("Cannot reach %s (%s)" % (self.base, ex.Message))
            status = int(resp.StatusCode)
        text = StreamReader(resp.GetResponseStream(), Encoding.UTF8).ReadToEnd()
        resp.Close()
        return self._decode(status, text)

    def _urllib(self, method, url, headers, data):
        try:
            from urllib.request import Request, urlopen
            from urllib.error import HTTPError, URLError
        except ImportError:
            from urllib2 import Request, urlopen, HTTPError, URLError
        req = Request(url, data=data.encode("utf-8") if data is not None else None,
                      headers=headers)
        req.get_method = lambda: method
        try:
            r = urlopen(req, timeout=20)
            return self._decode(r.getcode(), r.read().decode("utf-8"))
        except HTTPError as ex:
            return self._decode(ex.code, ex.read().decode("utf-8"))
        except URLError as ex:
            raise ServerError("Cannot reach %s (%s)" % (self.base, ex))

    @staticmethod
    def _decode(status, text):
        try:
            data = json.loads(text) if text else {}
        except ValueError:
            data = {"detail": text[:200]}
        if status >= 400:
            raise ServerError(data.get("detail") or ("HTTP %d" % status), status)
        return data

    # --------------------------------------------------------- calls

    def login(self, email, password):
        # long: a year, so the nightly upload keeps working unattended
        d = self._request("POST", "/api/login", {"name": email, "passphrase": password,
                                                 "long": True})
        self.token = d.get("token", "")
        return d

    def me(self):
        return self._request("GET", "/api/me")

    # the server's list of every PC's auto-publish settings (autopub.py)
    def publish_jobs(self):
        return self._request("GET", "/api/publish-jobs").get("jobs", [])

    def put_publish_job(self, project, job):
        return self._request("POST", "/api/publish-jobs", {"project": project, "job": job})

    def delete_publish_job(self, key):
        return self._request("DELETE", "/api/publish-jobs?key=" + _q(key))

    def projects(self):
        return self._request("GET", "/api/projects").get("projects", [])

    def items(self, project):
        return self._request("GET", "/api/items?since=0", project=project).get("items", [])

    def put_item(self, project, item):
        """Save one issue record (as the web page does); returns the record
        as the server stored it."""
        return self._request("POST", "/api/items", item, project=project).get("item") or item

    def goto(self, project, issue):
        """Ask a viewer page this person has open to show the issue.
        Returns (seq, page_open)."""
        d = self._request("POST", "/api/goto", {
            "project": project, "id": issue.id, "sheet": issue.sheet or "",
            "kind": "3d" if issue.is3d else "sheet"}, project=project)
        return d.get("seq", 0), bool(d.get("page_open"))

    def goto_claimed(self, seq):
        return bool(self._request("GET", "/api/goto/status?seq=%d" % seq).get("claimed"))

    def download(self, path, dest):
        """A server file (a snapshot, "/snapshots/<name>.jpg") saved to dest."""
        url = self.base + path
        if _dotnet():
            try:
                N = _net()
                wc = N.WebClient()
                if self.token:
                    wc.Headers.Add("X-Viewer-Token", self.token)
                wc.DownloadFile(url, dest)
                return dest
            except (ImportError, AttributeError):
                pass
            except Exception as ex:
                raise ServerError("could not download %s: %s" % (path, getattr(ex, "Message", ex)))
        try:
            from urllib.request import Request, urlopen
        except ImportError:
            from urllib2 import Request, urlopen
        r = urlopen(Request(url, headers={"X-Viewer-Token": self.token}), timeout=30)
        with open(dest, "wb") as f:
            f.write(r.read())
        return dest

    def manifest(self, project):
        return self._request("GET", "/data/%s/manifest.json" % _q(project))

    def upload_plan(self, project, files):
        return self._request("POST", "/api/admin/projects/%s/upload-plan" % _q(project),
                             {"files": files}).get("need", [])

    def upload_zip(self, project, zip_path):
        url = self.base + "/api/admin/projects/%s/upload" % _q(project)
        if _dotnet():
            return self._dotnet_file(url, zip_path)
        if True:
            with open(zip_path, "rb") as f:
                data = f.read()
            try:
                from urllib.request import Request, urlopen
                from urllib.error import HTTPError
            except ImportError:
                from urllib2 import Request, urlopen, HTTPError
            req = Request(url, data=data, headers={"Content-Type": "application/zip",
                                                   "X-Viewer-Token": self.token})
            try:
                r = urlopen(req, timeout=1800)
                return self._decode(r.getcode(), r.read().decode("utf-8"))
            except HTTPError as ex:
                return self._decode(ex.code, ex.read().decode("utf-8"))

    def _dotnet_file(self, url, path):
        """Streamed from disk: a project's upload can be a few hundred MB,
        which must not be held in Revit's memory."""
        N = _net()
        HttpWebRequest, WebException = N.HttpWebRequest, N.WebException
        from System.IO import File, StreamReader
        from System.Text import Encoding
        req = HttpWebRequest.Create(url)
        req.Method = "POST"
        req.ContentType = "application/zip"
        req.Headers.Add("X-Viewer-Token", self.token)
        req.Timeout = 1800000
        req.ReadWriteTimeout = 1800000
        req.AllowWriteStreamBuffering = False
        src = File.OpenRead(path)
        try:
            req.ContentLength = src.Length
            dst = req.GetRequestStream()
            src.CopyTo(dst, 1 << 20)
            dst.Close()
        finally:
            src.Close()
        try:
            resp = req.GetResponse()
            status = int(resp.StatusCode)
        except WebException as ex:
            resp = ex.Response
            if resp is None:
                raise ServerError("Upload failed: %s" % ex.Message)
            status = int(resp.StatusCode)
        text = StreamReader(resp.GetResponseStream(), Encoding.UTF8).ReadToEnd()
        resp.Close()
        return self._decode(status, text)


def _net():
    """System.Net for IronPython, whichever .NET Revit runs on.

    IronPython only sees the assemblies that have been referenced. Inside
    some pyRevit sessions System.dll's networking classes were not visible
    ("cannot import name ServicePointManager"); on .NET 8 (Revit 2025+) they
    live in separate assemblies. Every candidate is referenced, and the TLS
    setting - the only use of ServicePointManager - is optional."""
    import clr
    for name in ("System", "System.Net", "System.Net.Requests", "System.Net.Primitives",
                 "System.Net.ServicePoint", "System.Net.WebClient"):
        try:
            clr.AddReference(name)
        except Exception:
            pass
    import System.Net as N
    try:
        N.ServicePointManager.SecurityProtocol = N.ServicePointManager.SecurityProtocol \
            | N.SecurityProtocolType.Tls12
    except Exception:
        pass
    return N


def _dotnet():
    """IronPython inside Revit (clr exists), or CPython for the tests."""
    try:
        import clr  # noqa: F401
        return True
    except ImportError:
        return False


def _q(text):
    try:
        from urllib import quote
    except ImportError:
        from urllib.parse import quote
    return quote(text, safe="")


# ------------------------------------------------------------------ upload

UPLOAD_PARTS = ("fragments", "sheets")


def export_files(folder):
    """What the server needs from an export folder: the manifest, the 3D
    fragments and the sheet PDFs - not the IFC files or the logs."""
    import hashlib
    out = []

    def add(rel):
        p = os.path.join(folder, *rel.split("/"))
        h = hashlib.sha1()
        with open(p, "rb") as f:
            while True:
                b = f.read(1 << 20)
                if not b:
                    break
                h.update(b)
        out.append({"path": rel, "size": os.path.getsize(p), "sha1": h.hexdigest()})

    if not os.path.isfile(os.path.join(folder, "manifest.json")):
        raise ServerError("No manifest.json in %s - export first" % folder)
    add("manifest.json")
    for part in UPLOAD_PARTS:
        d = os.path.join(folder, part)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.lower().endswith((".frag", ".pdf", ".lwkm", ".props.json")) \
                    and os.path.isfile(os.path.join(d, name)):
                add(part + "/" + name)
    return out


def upload_export(client, folder, project, log=None, part=None, job=None):
    """Send an export folder to the viewer server, only what changed.
    Returns the server's summary. log(text) reports progress."""
    import tempfile
    import zipfile
    say = log or (lambda t: None)
    files = export_files(folder)
    total = sum(f["size"] for f in files)
    say("upload: %d files, %.1f MB in the export" % (len(files), total / 1048576.0))
    need = set(client.upload_plan(project, files))
    need.add("manifest.json")
    send = [f for f in files if f["path"] in need]
    say("upload: sending %d changed file(s), %.1f MB"
        % (len(send), sum(f["size"] for f in send) / 1048576.0))
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        from lwk_viewer import jsonio
        z = zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED)     # PDFs and fragments are compressed already
        try:
            for f in send:
                z.write(os.path.join(folder, *f["path"].split("/")), f["path"])
            z.writestr("_keep.json", jsonio.dumps([f["path"] for f in files], indent=0))
            if part:
                # sheets from another Revit file of the same project: added, nothing else replaced
                z.writestr("_part.json", jsonio.dumps(part, indent=0))
            if job:
                # how this export is made, for the viewer's Exports page
                try:
                    z.writestr("_job.json", jsonio.dumps(job, indent=0))
                except Exception:
                    pass
        finally:
            z.close()
        res = client.upload_zip(project, tmp)
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass
    say("upload: done - %s written, %s removed, project '%s'"
        % (res.get("written"), res.get("removed"), res.get("project")))
    return res


def upload_settings():
    """Server and sign-in saved by LWK Issues (one sign-in serves both)."""
    st = load_settings()
    return st.get("server") or "", st.get("token") or ""


# ------------------------------------------------------------------ issues

class Issue(object):
    """One issue, flattened for the list and for locating."""

    def __init__(self, item, number, sheets):
        iss = item.get("issue") or {}
        self.item = item                  # the record as the server has it
        self.id = item.get("id")
        self.number = number
        self.is_comment = not item.get("issue")
        self.title = iss.get("title") or (item.get("text") or "Comment" if self.is_comment else "Issue")
        self.status = "Comment" if self.is_comment else (
            "Not an issue" if iss.get("dismissed") else (iss.get("status") or "Open"))
        self.comments = list(iss.get("comments") or [])
        self.priority = iss.get("priority") or "Normal"
        self.assigned = iss.get("assigned_to") or ""
        self.due = iss.get("due_date") or ""
        self.author = iss.get("author") or item.get("author") or ""
        self.description = iss.get("description") or ""
        self.type = TYPE_LABELS.get(iss.get("type") or "general", iss.get("type") or "General") \
            if not self.is_comment else ""
        self.created = iss.get("created_at") or item.get("created_at") or ""
        self.updated = iss.get("updated_at") or item.get("updated_at") or ""
        self.level = iss.get("level") or item.get("level") or ""
        self.element = item.get("model_name") or ""
        self.markup = MARKUP_NAMES.get(item.get("type"), item.get("type") or "") \
            if item.get("placement") != "3d" else (
            "%d markup(s) on the snapshot" % len(item.get("markup") or []) if item.get("markup") else "")
        self.text = item.get("text") or ""
        d = iss.get("dismissed") or {}
        self.dismissed = ("%s on %s%s" % (d.get("by") or "?", short_date(d.get("at")),
                                          (" - " + d["reason"]) if d.get("reason") else "")) if d else ""
        pics = []
        if item.get("snapshot"):
            pics.append(item["snapshot"])
        for p in iss.get("images") or []:
            if p and p not in pics:
                pics.append(p)
        self.pictures = [p for p in pics if isinstance(p, str) and not p.startswith("data:")]
        self.is3d = item.get("placement") == "3d"
        self.viewpoint = item.get("viewpoint") or None
        self.sheet = item.get("sheet")
        self.points_mm = item.get("points_mm") or []
        self.ifc_guid = item.get("ifc_guid")
        anchor = item.get("anchor") or {}
        self.view_id = anchor.get("view_id")
        self.view_name = anchor.get("view_name") or ""
        # Where it is in the model, internal millimetres.
        self.model_mm = item.get("model_internal_mm") if self.is3d else anchor.get("model_mm")
        if self.is3d:
            self.where = "3D model" + (" · " + iss["level"] if iss.get("level") else "")
        else:
            s = sheets.get(self.sheet) or {}
            self.where = ("%s %s" % (self.sheet or "", s.get("name", ""))).strip()

    @property
    def open(self):
        return self.status in ("Open", "In progress")

    @property
    def tag(self):
        return ("C%d" if self.is_comment else "#%d") % self.number

    def label(self):
        bits = ["%s %s" % (self.tag, self.title), "[%s]" % self.status]
        if self.assigned:
            bits.append("-> " + self.assigned)
        if self.due:
            bits.append("due " + self.due)
        return " ".join(bits)


def short_date(iso):
    """'2026-09-26T08:15:00Z' -> '26 Sep 2026 16:15' (this PC's time)."""
    if not iso:
        return ""
    try:
        import calendar
        import time as _t
        t = _t.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")
        if iso.endswith("Z") or iso.endswith("+00:00"):
            t = _t.localtime(calendar.timegm(t))
        return _t.strftime("%d %b %Y %H:%M", t).lstrip("0")
    except Exception:
        return iso[:10]


def _qq(text):
    """Quoted for a URL, Chinese titles included (IronPython and CPython)."""
    try:
        return _q(text)
    except Exception:
        return _q(text.encode("utf-8"))


def web_url(base, project, issue):
    """The web viewer at this issue: the sheet with the markup selected, or
    the 3D model flown to the point."""
    base = (base or "").rstrip("/")
    q = "project=" + _qq(project or "")
    if issue.is3d:
        url = "%s/model.html?%s" % (base, q)
        if issue.id:
            # the viewer picks the issue out, opens it and goes to its viewpoint
            return url + "&select=" + _qq(issue.id)
        if issue.model_mm and len(issue.model_mm) >= 3:
            url += "&at=" + ",".join("%.0f" % v for v in issue.model_mm[:3])
            url += "&label=" + _qq(u"%s %s" % (issue.tag, issue.title))
        return url
    return "%s/index.html?%s&sheet=%s&select=%s" % (base, q, _qq(issue.sheet or ""),
                                                   _qq(issue.id or ""))


def show_in_viewer(client, project, issue, wait_s=5.0):
    """The issue in the viewer page already open if there is one (the page
    goes to it and its browser window is brought forward); a new tab only
    when no page answers. Returns "page" or "tab"."""
    import time as _t
    try:
        seq, live = client.goto(project, issue)
    except Exception:
        seq, live = 0, False               # an older server: plain link
    if live:
        t0 = _t.time()
        while _t.time() - t0 < wait_s:
            _t.sleep(0.5)
            try:
                if client.goto_claimed(seq):
                    bring_browser_forward()
                    return "page"
            except Exception:
                break
    open_url(web_url(client.base, project, issue))
    return "tab"


def bring_browser_forward(title_part="LWK Viewer"):
    """Raise the browser window showing the viewer (its title carries the
    page's title). Best effort: nothing happens if it cannot be found."""
    try:
        import clr
        clr.AddReference("Microsoft.VisualBasic")
        from Microsoft.VisualBasic import Interaction
        from System.Diagnostics import Process
        for name in ("msedge", "chrome", "firefox"):
            for p in Process.GetProcessesByName(name):
                try:
                    if title_part.lower() in (p.MainWindowTitle or "").lower():
                        Interaction.AppActivate(p.Id)
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def open_url(url):
    """Open a web page in the default browser from inside Revit.

    Process.Start(url) alone fails on Revit 2025 and later (.NET 8 no
    longer hands a URL to the shell unless told to), and it failed silently
    - the button seemed dead. Three ways, first that works."""
    errors = []
    try:
        from System.Diagnostics import Process, ProcessStartInfo
        psi = ProcessStartInfo(url)
        psi.UseShellExecute = True
        Process.Start(psi)
        return True
    except Exception as ex:
        errors.append(str(ex))
    try:
        from System.Diagnostics import Process
        Process.Start("explorer.exe", '"%s"' % url)
        return True
    except Exception as ex:
        errors.append(str(ex))
    try:
        import webbrowser
        if webbrowser.open(url):
            return True
    except Exception as ex:
        errors.append(str(ex))
    raise ServerError("could not open the browser (%s)" % "; ".join(errors))


def issues_from(items, manifest, with_comments=False):
    """Issues in the order the viewer numbers them; with_comments adds the
    plain comments (markups that are not issues), numbered C1, C2 ..."""
    sheets = {s.get("number"): s for s in ((manifest or {}).get("sheets") or [])}
    out, n, c = [], 0, 0
    for it in items:
        if it.get("deleted"):
            continue
        if it.get("placement") in ("view", "calibration", "dim3d"):
            continue
        if not it.get("issue"):
            if with_comments and (it.get("sheet") or it.get("placement") == "3d"):
                c += 1
                out.append(Issue(it, c, sheets))
            continue
        n += 1
        # The server's permanent number when it has given one.
        out.append(Issue(it, (it.get("issue") or {}).get("number") or n, sheets))
    return out


# ------------------------------------------------------- back to the server

def comment_key(c, k=0):
    """The id a reply points at - the viewer's id, or (older comments
    without one) the same author|at key the viewer falls back to."""
    return c.get("id") or "%s|%s" % (c.get("author") or "", c.get("at") or "")


def updated_item(issue, status=None, comment=None, author="", reply_to=None,
                 query=False, answered=None):
    """The issue's record with a new status and/or a comment added - the
    same change the web page makes; the server stamps who and when.
      reply_to  id of the message this comment answers
      query     the comment is a question that wants an answer
      answered  id of a query to mark answered (by author)"""
    import copy
    import datetime
    import random
    import time
    item = copy.deepcopy(issue.item)
    iss = item.get("issue")
    if iss is None:
        raise ValueError("a comment markup has no status - raise it as an issue in the viewer")
    now = datetime.datetime.utcnow().isoformat() + "Z"
    if status and status != iss.get("status"):
        iss["status"] = status
    comments = iss.setdefault("comments", [])
    if answered:
        for k, c in enumerate(comments):
            if comment_key(c, k) == answered:
                c["resolved"] = True
                c["resolved_by"] = author or "Revit"
                c["resolved_at"] = now
    if comment and comment.strip():
        c = {"id": "c%x%04x" % (int(time.time() * 1000), random.randint(0, 0xffff)),
             "author": author or "Revit", "text": comment.strip(),
             "at": now, "from": "revit"}
        if reply_to:
            c["reply_to"] = reply_to
        if query:
            c["kind"] = "query"
        comments.append(c)
    item["updated_at"] = now
    return item


# ------------------------------------------------------------------ Revit

def _xyz(mm):
    from Autodesk.Revit.DB import XYZ
    return XYZ(mm[0] / FT_MM, mm[1] / FT_MM, mm[2] / FT_MM)


class _Quiet(object):
    def warn(self, *a):
        pass

    def info(self, *a):
        pass


def find_sheet(doc, number):
    from Autodesk.Revit.DB import FilteredElementCollector, ViewSheet
    for s in FilteredElementCollector(doc).OfClass(ViewSheet):
        if s.SheetNumber == number:
            return s
    return None


def sheet_rect(doc, sheet, points_mm, margin_mm=40.0):
    """The markup's box on the Revit sheet, in sheet feet: paper mm are
    measured from the titleblock's lower-left corner (see manifest)."""
    from Autodesk.Revit.DB import XYZ
    from lwk_viewer.manifest import paper_origin
    o, _ = paper_origin(doc, sheet, _Quiet())
    us = [p[0] for p in points_mm] or [0.0]
    vs = [p[1] for p in points_mm] or [0.0]
    lo = XYZ(o.X + (min(us) - margin_mm) / FT_MM, o.Y + (min(vs) - margin_mm) / FT_MM, 0)
    hi = XYZ(o.X + (max(us) + margin_mm) / FT_MM, o.Y + (max(vs) + margin_mm) / FT_MM, 0)
    return lo, hi


def element_by_ifc_guid(doc, guid):
    """The host element an issue was raised on, when Revit stored IFC GUIDs
    (Export > IFC 'Store the IFC GUID'). Elements in links cannot be
    selected from the host, so those simply locate by the point."""
    if not guid:
        return None
    from Autodesk.Revit.DB import (FilteredElementCollector, ElementId, BuiltInParameter,
                                   ParameterValueProvider, FilterStringRule,
                                   FilterStringEquals, ElementParameterFilter)
    try:
        prov = ParameterValueProvider(ElementId(BuiltInParameter.IFC_GUID))
        try:
            rule = FilterStringRule(prov, FilterStringEquals(), guid)
        except TypeError:
            rule = FilterStringRule(prov, FilterStringEquals(), guid, True)
        els = list(FilteredElementCollector(doc).WhereElementIsNotElementType()
                   .WherePasses(ElementParameterFilter(rule)))
        return els[0] if els else None
    except Exception:
        return None


def wants_perspective(vp):
    """Was the issue seen through a perspective camera (the viewer's usual
    one, and always when walking)? Then Revit opens it in a perspective
    view from the same eye. An isometric view from an eye inside the
    building shows the whole building from outside - which is what a
    walk-through issue used to open as."""
    if not vp or not vp.get("position_internal_mm") or not vp.get("target_internal_mm"):
        return False
    if vp.get("walk"):
        return True
    return vp.get("ortho") is not True


def issue_view(doc, user, perspective=False):
    """A personal 3D view for going to issues, so nobody's own 3D view is
    boxed and turned by someone else's click. Two of them: an isometric one,
    and a perspective (camera) one for issues seen through a camera."""
    from Autodesk.Revit.DB import (FilteredElementCollector, View3D, ViewFamilyType,
                                   ViewFamily)
    name = "LWK Issue - %s%s" % (user or os.environ.get("USERNAME", "me"), " (camera)" if perspective else "")
    for v in FilteredElementCollector(doc).OfClass(View3D):
        if not v.IsTemplate and v.Name == name and bool(v.IsPerspective) == bool(perspective):
            return v
    vft = [t for t in FilteredElementCollector(doc).OfClass(ViewFamilyType)
           if t.ViewFamily == ViewFamily.ThreeDimensional][0]
    v = View3D.CreatePerspective(doc, vft.Id) if perspective else View3D.CreateIsometric(doc, vft.Id)
    try:
        v.Name = name
    except Exception:
        pass
    return v


def box_view(view, p, half_mm=3000.0, below_mm=1500.0, above_mm=3000.0):
    """Section box round the point, camera from the south-east above."""
    from Autodesk.Revit.DB import BoundingBoxXYZ, XYZ, ViewOrientation3D
    h, b, a = half_mm / FT_MM, below_mm / FT_MM, above_mm / FT_MM
    bb = BoundingBoxXYZ()
    bb.Min = XYZ(p.X - h, p.Y - h, p.Z - b)
    bb.Max = XYZ(p.X + h, p.Y + h, p.Z + a)
    view.IsSectionBoxActive = True
    view.SetSectionBox(bb)
    eye = XYZ(p.X + 8.0 * h / 3, p.Y - 8.0 * h / 3, p.Z + 6.0 * h / 3)
    fwd = (p - eye).Normalize()
    right = fwd.CrossProduct(XYZ.BasisZ).Normalize()
    up = right.CrossProduct(fwd).Normalize()
    try:
        view.SetOrientation(ViewOrientation3D(eye, up, fwd))
    except Exception:
        pass           # a locked view keeps its orientation; the box still applies


def viewpoint_view(view, vp, p):
    """Open an issue as its author saw it: the camera they looked through and
    the section box (or plane) they had on, from the viewer's
    clipping_internal. Returns (lo, hi) corners to zoom to, or None when the
    issue carries no camera (the caller then boxes round the point)."""
    from Autodesk.Revit.DB import BoundingBoxXYZ, XYZ, ViewOrientation3D, Transform
    if not vp or not vp.get("position_internal_mm") or not vp.get("target_internal_mm"):
        return None
    eye = _xyz(vp["position_internal_mm"])
    tgt = _xyz(vp["target_internal_mm"])
    planes = vp.get("clipping_internal") or []
    # the box: pairs of planes facing opposite ways along three axes, the
    # first horizontal one setting the box's turn (the viewer turns it
    # about the vertical only)
    a1 = None
    for c in planes:
        d = c.get("direction") or [0, 0, 0]
        if abs(d[2]) < 0.2 and (abs(d[0]) + abs(d[1])) > 0.5:
            a1 = XYZ(d[0], d[1], 0).Normalize()
            break
    if a1 is None:
        a1 = XYZ.BasisX
    a3 = XYZ.BasisZ
    a2 = a3.CrossProduct(a1).Normalize()
    axes = [a1, a2, a3]
    centre = tgt if p is None else p
    far = 60000.0 / FT_MM
    lo = [c_.DotProduct(centre) - far for c_ in axes]
    hi = [c_.DotProduct(centre) + far for c_ in axes]
    for c in planes:
        try:
            loc = _xyz(c["location_mm"])
            d = XYZ(*c["direction"]).Normalize()
        except Exception:
            continue
        for k, ax in enumerate(axes):
            dp = d.DotProduct(ax)
            if dp > 0.95:        # cuts away beyond: an upper bound
                hi[k] = min(hi[k], loc.DotProduct(ax))
            elif dp < -0.95:     # cuts away below: a lower bound
                lo[k] = max(lo[k], loc.DotProduct(ax))
    if planes:
        t = Transform.Identity
        t.BasisX = a1
        t.BasisY = a2
        t.BasisZ = a3
        t.Origin = XYZ(0, 0, 0)
        bb = BoundingBoxXYZ()
        bb.Transform = t
        bb.Min = XYZ(lo[0], lo[1], lo[2])
        bb.Max = XYZ(max(hi[0], lo[0] + 0.1), max(hi[1], lo[1] + 0.1), max(hi[2], lo[2] + 0.1))
        view.IsSectionBoxActive = True
        view.SetSectionBox(bb)
    else:
        view.IsSectionBoxActive = False
    fwd = (tgt - eye)
    if fwd.GetLength() < 1e-6:
        return None
    fwd = fwd.Normalize()
    right = fwd.CrossProduct(XYZ.BasisZ)
    right = right.Normalize() if right.GetLength() > 1e-6 else XYZ.BasisX
    up = right.CrossProduct(fwd).Normalize()
    try:
        view.SetOrientation(ViewOrientation3D(eye, up, fwd))
    except Exception:
        pass
    if view.IsPerspective:
        # a camera: it shows what is in front of the eye, as the author saw
        # it - no zooming afterwards (that would move the eye), and no far
        # clip cutting off the room beyond
        try:
            from Autodesk.Revit.DB import BuiltInParameter
            fc = view.get_Parameter(BuiltInParameter.VIEWER_BOUND_ACTIVE_FAR)
            if fc is not None and not fc.IsReadOnly:
                fc.Set(0)
        except Exception:
            pass
        return "camera"
    # what to fill the window with: the box when there is one, else round the target
    if planes:
        def world(u, v, w):
            return a1.Multiply(u).Add(a2.Multiply(v)).Add(a3.Multiply(w))
        span = [min(hi[k] - lo[k], 2 * far) for k in range(3)]
        mid = [(hi[k] + lo[k]) / 2.0 for k in range(3)]
        if max(span) < 2 * far - 1:
            return (world(lo[0], lo[1], lo[2]), world(hi[0], hi[1], hi[2]))
    h = max(3000.0 / FT_MM, (tgt - eye).GetLength() * 0.5)
    return (XYZ(tgt.X - h, tgt.Y - h, tgt.Z - h), XYZ(tgt.X + h, tgt.Y + h, tgt.Z + h))


def zoom(uidoc, view, lo, hi):
    for uv in uidoc.GetOpenUIViews():
        if uv.ViewId == view.Id:
            uv.ZoomAndCenterRectangle(lo, hi)
            return True
    return False


# ----------------------------------------------------------------- markers

def _material(doc, status):
    from Autodesk.Revit.DB import FilteredElementCollector, Material, Color
    name = "LWK Issue - %s" % status
    for m in FilteredElementCollector(doc).OfClass(Material):
        if m.Name == name:
            return m.Id
    mid = Material.Create(doc, name)
    m = doc.GetElement(mid)
    r, g, b = STATUS_COLORS.get(status, (120, 120, 120))
    m.Color = Color(r, g, b)
    try:
        m.SurfaceForegroundPatternColor = Color(r, g, b)
    except Exception:
        pass
    return mid


def _workset(doc):
    """The "LWK Issues" user workset, made if missing (workshared models)."""
    if not doc.IsWorkshared:
        return None
    from Autodesk.Revit.DB import FilteredWorksetCollector, WorksetKind, Workset
    for ws in FilteredWorksetCollector(doc).OfKind(WorksetKind.UserWorkset):
        if ws.Name == WORKSET:
            return ws.Id
    try:
        return Workset.Create(doc, WORKSET).Id
    except Exception:
        return None


def pin_filter(doc):
    """A view filter picking out the pins (Generic Models whose Mark starts
    "LWK "), made if missing - how pins are shown or hidden in a model that
    is not workshared, where there are no worksets (Revit only has them
    once worksharing is turned on, which is not ours to do)."""
    from Autodesk.Revit.DB import (FilteredElementCollector, ParameterFilterElement,
                                   ParameterFilterRuleFactory, ElementParameterFilter,
                                   ElementId, BuiltInCategory, BuiltInParameter)
    from System.Collections.Generic import List
    for f in FilteredElementCollector(doc).OfClass(ParameterFilterElement):
        if f.Name == FILTER:
            return f
    pid = ElementId(BuiltInParameter.ALL_MODEL_MARK)
    try:
        rule = ParameterFilterRuleFactory.CreateBeginsWithRule(pid, "LWK ")
    except Exception:
        rule = ParameterFilterRuleFactory.CreateBeginsWithRule(pid, "LWK ", False)
    cats = List[ElementId]()
    cats.Add(ElementId(BuiltInCategory.OST_GenericModel))
    try:
        return ParameterFilterElement.Create(doc, FILTER, cats, ElementParameterFilter(rule))
    except Exception:
        return None


def show_pins_filter(doc, view, visible=True):
    """Adds the pin filter to a view (visible, or hidden)."""
    f = pin_filter(doc)
    if f is None or view is None:
        return False
    try:
        if not view.IsFilterApplied(f.Id):
            view.AddFilter(f.Id)
        view.SetFilterVisibility(f.Id, bool(visible))
        return True
    except Exception:
        return False


def _pin_solids(p, material_id):
    """A pin standing on the point: a thin stem and a ball above it, big
    enough to see from across a floor (ball 0.5 m, top 1.2 m up)."""
    from Autodesk.Revit.DB import (XYZ, Arc, Line, CurveLoop, Frame, SolidOptions,
                                   GeometryCreationUtilities, ElementId)
    from System.Collections.Generic import List
    import math
    opts = SolidOptions(material_id, ElementId.InvalidElementId)
    r = 250.0 / FT_MM
    stem_h = 950.0 / FT_MM
    c = XYZ(p.X, p.Y, p.Z + stem_h + r)
    # ball: a half-disc in the frame's XZ plane turned about its Z axis
    frame = Frame(c, XYZ.BasisX, XYZ.BasisY, XYZ.BasisZ)
    top, bot, side = XYZ(c.X, c.Y, c.Z + r), XYZ(c.X, c.Y, c.Z - r), XYZ(c.X + r, c.Y, c.Z)
    loop = CurveLoop()
    loop.Append(Arc.Create(bot, top, side))
    loop.Append(Line.CreateBound(top, bot))
    loops = List[CurveLoop]()
    loops.Add(loop)
    ball = GeometryCreationUtilities.CreateRevolvedGeometry(frame, loops, 0.0, 2 * math.pi, opts)
    # stem: a thin cylinder from the point up into the ball
    sr = 30.0 / FT_MM
    circ = CurveLoop()
    circ.Append(Arc.Create(XYZ(p.X, p.Y, p.Z), sr, 0.0, math.pi, XYZ.BasisX, XYZ.BasisY))
    circ.Append(Arc.Create(XYZ(p.X, p.Y, p.Z), sr, math.pi, 2 * math.pi, XYZ.BasisX, XYZ.BasisY))
    cl = List[CurveLoop]()
    cl.Add(circ)
    stem = GeometryCreationUtilities.CreateExtrusionGeometry(cl, XYZ.BasisZ, stem_h + r, opts)
    return [ball, stem]


def existing_markers(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, DirectShape
    return [d for d in FilteredElementCollector(doc).OfClass(DirectShape)
            if d.ApplicationId == APP_ID]


def remove_markers(doc):
    ids = [d.Id for d in existing_markers(doc)]
    for i in ids:
        doc.Delete(i)
    return len(ids)


def place_markers(doc, issues):
    """Pins for these issues; old pins are replaced, so it can be run again
    after issues change. Returns (placed, skipped without a position)."""
    from Autodesk.Revit.DB import (DirectShape, ElementId, BuiltInCategory, BuiltInParameter,
                                   GeometryObject)
    from System.Collections.Generic import List
    remove_markers(doc)
    ws = _workset(doc)
    try:
        pin_filter(doc)
    except Exception:
        pass
    placed, skipped = 0, 0
    mats = {}
    for iss in issues:
        if not iss.model_mm or len(iss.model_mm) < 3:
            skipped += 1
            continue
        p = _xyz(iss.model_mm)
        st = iss.status if iss.status in STATUS_COLORS else "Open"
        if st not in mats:
            mats[st] = _material(doc, st)
        shapes = List[GeometryObject]()
        for s in _pin_solids(p, mats[st]):
            shapes.Add(s)
        ds = DirectShape.CreateElement(doc, ElementId(BuiltInCategory.OST_GenericModel))
        ds.ApplicationId = APP_ID
        ds.ApplicationDataId = iss.id
        ds.SetShape(shapes)
        for bip, val in ((BuiltInParameter.ALL_MODEL_MARK, "LWK " + iss.tag),
                         (BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS, iss.label()[:250])):
            prm = ds.get_Parameter(bip)
            if prm and not prm.IsReadOnly:
                prm.Set(val)
        if ws is not None:
            prm = ds.get_Parameter(BuiltInParameter.ELEM_PARTITION_PARAM)
            if prm and not prm.IsReadOnly:
                prm.Set(ws.IntegerValue)
        placed += 1
    return placed, skipped


# ------------------------------------------------------------ sheet clouds

def _revision(doc, create=True):
    """The revision every LWK cloud belongs to (made if missing), so the
    clouds are told apart from the project's own and removed in one go."""
    from Autodesk.Revit.DB import FilteredElementCollector, Revision
    for r in FilteredElementCollector(doc).OfClass(Revision):
        try:
            if r.Description == REVISION:
                return r
        except Exception:
            continue
    if not create:
        return None
    import datetime
    r = Revision.Create(doc)
    r.Description = REVISION
    try:
        r.RevisionDate = datetime.date.today().strftime("%d.%m.%Y")
        r.IssuedBy = "LWK Viewer"
    except Exception:
        pass
    return r


def cloud_rect(o, points_mm, pad_mm=4.0, min_mm=10.0):
    """The cloud's rectangle on the sheet, in sheet feet, round a markup's
    paper points (mm from the titleblock corner)."""
    us = [p[0] for p in points_mm] or [0.0]
    vs = [p[1] for p in points_mm] or [0.0]
    u0, u1, v0, v1 = min(us) - pad_mm, max(us) + pad_mm, min(vs) - pad_mm, max(vs) + pad_mm
    if u1 - u0 < min_mm:
        c = (u0 + u1) / 2.0; u0, u1 = c - min_mm / 2.0, c + min_mm / 2.0
    if v1 - v0 < min_mm:
        c = (v0 + v1) / 2.0; v0, v1 = c - min_mm / 2.0, c + min_mm / 2.0
    return ((o.X + u0 / FT_MM, o.Y + v0 / FT_MM), (o.X + u1 / FT_MM, o.Y + v1 / FT_MM))


def existing_clouds(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, RevisionCloud
    r = _revision(doc, create=False)
    if r is None:
        return []
    return [c for c in FilteredElementCollector(doc).OfClass(RevisionCloud)
            if c.RevisionId == r.Id]


def remove_clouds(doc):
    ids = [c.Id for c in existing_clouds(doc)]
    for i in ids:
        doc.Delete(i)
    return len(ids)


def place_clouds(doc, issues):
    """A revision cloud round every sheet issue or comment whose sheet is in
    this model; old LWK clouds are replaced. Returns (placed, skipped)."""
    from Autodesk.Revit.DB import (RevisionCloud, Line, XYZ, Curve, BuiltInParameter)
    from System.Collections.Generic import List
    from lwk_viewer.manifest import paper_origin
    remove_clouds(doc)
    rev = _revision(doc)
    placed, skipped = 0, 0
    origins = {}
    for iss in issues:
        if iss.is3d or not iss.sheet or not iss.points_mm:
            continue
        sheet = find_sheet(doc, iss.sheet)
        if sheet is None:
            skipped += 1
            continue
        if sheet.Id.IntegerValue not in origins:
            origins[sheet.Id.IntegerValue] = paper_origin(doc, sheet, _Quiet())[0]
        (x0, y0), (x1, y1) = cloud_rect(origins[sheet.Id.IntegerValue], iss.points_mm)
        # clockwise: Revit draws the arcs on the left of the direction of
        # travel, so this way round they bulge outward like a hand-drawn cloud
        # (anticlockwise they pointed inward)
        pts = [XYZ(x0, y0, 0), XYZ(x0, y1, 0), XYZ(x1, y1, 0), XYZ(x1, y0, 0)]
        curves = List[Curve]()
        for k in range(4):
            curves.Add(Line.CreateBound(pts[k], pts[(k + 1) % 4]))
        try:
            cloud = RevisionCloud.Create(doc, sheet, rev.Id, curves)
        except Exception:
            skipped += 1
            continue
        for bip, val in ((BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS, iss.label()[:250]),
                         (BuiltInParameter.ALL_MODEL_MARK, "LWK " + iss.tag)):
            try:
                prm = cloud.get_Parameter(bip)
                if prm and not prm.IsReadOnly:
                    prm.Set(val)
            except Exception:
                pass
        placed += 1
    return placed, skipped
