# -*- coding: utf-8 -*-
"""Site study: Outline Zoning Plans - the office's list of plans and zones
typed in once and offered to everyone after, and reading a plan's Notes PDF
for the restrictions (rule-based: the Notes' own wording, no AI).

  GET    /api/ozp               the office list {plans: {plan: {zones: {zone: {...}}}}}
  PUT    /api/ozp               {plan, zone, values, src} (a project member)
  DELETE /api/ozp?plan=&zone=   (a site admin)
  POST   /api/ozp/notes         the Notes PDF -> {plan, zones: [{zone, values, evidence}]}

Kept in <data>/ozp/plans.json.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

FIELDS = ("dpr", "npr", "pr", "sc", "bh", "storeys", "gfa", "dgfa", "ngfa")
MAX_PDF = 30 * 1024 * 1024


def _path(core):
    d = os.path.join(core.CFG["data"], "ozp")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "plans.json")


def load(core):
    try:
        with open(_path(core), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"plans": {}}


def _write(core, data):
    p = _path(core)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)


def norm_plan(p):
    return re.sub(r"\s+", "", str(p or "")).upper()[:40]


def norm_zone(z):
    z = re.sub(r"\s+", " ", str(z or "")).strip()[:60]
    return z.upper() if len(z) <= 12 else z


def clean_values(v):
    out = {}
    for k in FIELDS:
        x = (v or {}).get(k)
        if x in ("", None):
            continue
        try:
            x = float(x)
        except (TypeError, ValueError):
            continue
        if x >= 0:
            out[k] = int(x) if x == int(x) else x
    if (v or {}).get("bhPlan"):
        out["bhPlan"] = True
    return out


def put(core, plan, zone, values, src, who):
    plan, zone = norm_plan(plan), norm_zone(zone)
    if not plan or not zone:
        raise HTTPException(status_code=400, detail="Give the plan no. and the zone")
    data = load(core)
    p = data["plans"].setdefault(plan, {"zones": {}})
    p["zones"][zone] = dict(clean_values(values), src=str(src or "")[:300], by=who or "",
                            at=time.strftime("%Y-%m-%d"))
    _write(core, data)
    return data


def remove(core, plan, zone):
    data = load(core)
    p = data["plans"].get(norm_plan(plan))
    if p and norm_zone(zone) in p["zones"]:
        del p["zones"][norm_zone(zone)]
        if not p["zones"]:
            del data["plans"][norm_plan(plan)]
        _write(core, data)
    return data


# ---------------------------------------------------------------- the Notes
HEADINGS = {
    "COMPREHENSIVE DEVELOPMENT AREA": "CDA",
    "RESIDENTIAL (GROUP A)": "R(A)", "RESIDENTIAL (GROUP B)": "R(B)", "RESIDENTIAL (GROUP C)": "R(C)",
    "RESIDENTIAL (GROUP D)": "R(D)", "RESIDENTIAL (GROUP E)": "R(E)",
    "COMMERCIAL": "C", "OTHER SPECIFIED USES": "OU", "INDUSTRIAL": "I",
    "GOVERNMENT, INSTITUTION OR COMMUNITY": "G/IC", "OPEN SPACE": "O", "VILLAGE TYPE DEVELOPMENT": "V",
    "GREEN BELT": "GB", "UNDETERMINED": "U", "AGRICULTURE": "AGR",
    "COUNTRY PARK": "CP", "CONSERVATION AREA": "CA", "COASTAL PROTECTION AREA": "CPA",
    "RECREATION": "REC", "OPEN STORAGE": "OS", "SITE OF SPECIAL SCIENTIFIC INTEREST": "SSSI",
}
NUM = r"(\d+(?:\.\d+)?)"


def pdf_text(path):
    if not shutil.which("pdftotext"):
        raise HTTPException(status_code=500, detail="This server cannot read PDF text: install poppler (pdftotext)")
    out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=120).stdout
    return out.decode("utf-8", "replace")


def sections(text):
    """[(code, heading, body)] - the Notes' zone schedules, in order; the
    Explanatory Statement after them is left out."""
    es = re.search(r"^\s*EXPLANATORY STATEMENT\s*$", text, re.M)
    if es:
        text = text[:es.start()]
    marks = []
    for m in re.finditer(r"^[ \t]{3,}([A-Z][A-Z ,()&/\-]+?)(?:\s*\(cont[’']d\))?[ \t]*$", text, re.M):
        h = re.sub(r"\s+", " ", m.group(1)).strip()
        if h in HEADINGS:
            marks.append((m.start(), h))
    out = {}
    order = []
    for i, (pos, h) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        if h not in out:
            out[h] = ""
            order.append(h)
        out[h] += text[pos:end] + "\n"
    return [(HEADINGS[h], h, out[h]) for h in order]


def _flat(s):
    return re.sub(r"\s+", " ", s.replace("“", '"').replace("”", '"').replace("’", "'")).strip()


def _sentence(flat, i):
    a = max(flat.rfind(". ", 0, i), flat.rfind("; ", 0, i))
    b = flat.find(". ", i)
    return flat[a + 2 if a >= 0 else 0: b + 1 if b >= 0 else len(flat)][:400]


def _figures(flat):
    """the restrictions said in words in one paragraph -> (values, evidence)"""
    v, ev = {}, {}
    pats = [
        ("dpr", r"maximum domestic plot ratio of " + NUM),
        ("npr", r"maximum non-domestic plot ratio of " + NUM),
        ("pr", r"(?<!domestic )(?<!non-domestic )maximum plot ratio of " + NUM),
        ("dgfa", r"maximum domestic (?:gross floor area|GFA) of ([\d,]+(?:\.\d+)?) ?m"),
        ("ngfa", r"maximum non-domestic (?:gross floor area|GFA) of ([\d,]+(?:\.\d+)?) ?m"),
        ("gfa", r"(?<!domestic )(?<!non-domestic )maximum (?:total )?(?:gross floor area|GFA) of ([\d,]+(?:\.\d+)?) ?m"),
        ("sc", r"maximum site coverage of " + NUM + r" ?%"),
        ("bh", r"maximum building height of " + NUM + r" ?(?:m|metres)? ?(?:above Principal Datum|mPD)"),
        ("storeys", r"maximum building height of (\d+) storeys"),
    ]
    for k, p in pats:
        m = re.search(p, flat, re.I)
        if m:
            v[k] = float(m.group(1).replace(",", ""))
            ev[k] = _sentence(flat, m.start())
    if re.search(r"building height[^.]{0,80}as stipulated on the Plan", flat, re.I):
        v["bhPlan"] = True
        ev.setdefault("bh", _sentence(flat, re.search(r"as stipulated on the Plan", flat, re.I).start()))
    for k in list(v):
        if isinstance(v[k], float) and v[k] == int(v[k]):
            v[k] = int(v[k])
    return v, ev


class _G:
    """a table row's groups, from its own line or a continuation line"""
    def __init__(self, g, text):
        self.g, self.text = g, text

    def group(self, k):
        return self.text if k == 0 else self.g[k]


def zone_rows(code, body):
    """the zone and its sub-zones with their restrictions"""
    rows = []
    rem = body
    m = re.search(r"^\s*Remarks", body, re.M)
    if m:
        rem = body[m.end():]
    # a table: "R(A)9   7.5   0.3   -   As stipulated" / "R(A)4  Area (a)  3  0.5  50%  65"
    sub = re.escape(code).replace(r"\(", r"\(").rstrip("\\)") if code.endswith(")") else re.escape(code)
    tab = re.compile(r"^\s*(" + re.escape(code[:-1] if code.endswith(")") else code) + r"\)?\d+\)?|" + re.escape(code) + r"\d*(?:\(\d+\))?)"
                     r"(?:\s+(Area \([a-z]\)))?\s+" + NUM + r"\s+" + NUM + r"\s+(\d+(?:\.\d+)?%|-)\s+(\d+|As stipulated)", re.M)
    cont = re.compile(r"^\s+(Area \([a-z]\))\s+" + NUM + r"\s+" + NUM + r"\s+(\d+(?:\.\d+)?%|-)\s+(\d+|As stipulated)", re.M)
    hits = sorted([(t.start(), t, False) for t in tab.finditer(rem)] + [(t.start(), t, True) for t in cont.finditer(rem)], key=lambda x: x[0])
    last = None
    for _, t, is_cont in hits:
        if is_cont:
            if not last:
                continue
            g = [None, last, t.group(1), t.group(2), t.group(3), t.group(4), t.group(5)]
        else:
            g = [None] + [t.group(k) for k in range(1, 7)]
            last = g[1]
        z = g[1] + (" " + g[2] if g[2] else "")
        t = _G(g, t.group(0))
        v = {"dpr": float(t.group(3)), "npr": float(t.group(4))}
        if t.group(5) != "-":
            v["sc"] = float(t.group(5).rstrip("%"))
        if t.group(6).isdigit():
            v["bh"] = int(t.group(6))
        else:
            v["bhPlan"] = True
        for k in ("dpr", "npr", "sc"):
            if k in v and v[k] == int(v[k]):
                v[k] = int(v[k])
        rows.append({"zone": z, "values": v, "evidence": {"table": _flat(t.group(0))}})
    # the paragraphs "(a) On land designated "CDA(1)", ... maximum ..."
    paras = re.split(r"\n\s*\(([a-z]{1,4})\)\s+", "\n" + rem)
    for i in range(2, len(paras), 2):
        flat = _flat(paras[i])
        if not re.search(r"maximum|as stipulated", flat, re.I):
            continue
        v, ev = _figures(flat)
        if not v:
            continue
        zs = re.findall(r'"([A-Z][A-Z/()]*\d*(?:\([^"]*\))?)"', flat)
        zs = [z for z in zs if z.startswith(code.split("(")[0])] or [code]
        # a "to" range, as "R(A)1" to "R(A)6"
        for z in dict.fromkeys(zs):
            if any(r["zone"] == z for r in rows):
                continue
            rows.append({"zone": z, "values": dict(v), "evidence": ev, "para": paras[i - 1]})
    if not rows:
        v, ev = _figures(_flat(rem))
        if v:
            rows.append({"zone": code, "values": v, "evidence": ev})
    return rows


def read_notes(text):
    m = re.search(r"\b(S/[A-Z0-9\-]+/\d+[A-Z]?)\b", text)
    plan = m.group(1) if m else ""
    name = ""
    m2 = re.search(r"([A-Z][A-Z \-]+ OUTLINE ZONING PLAN NO\. ?S/[A-Z0-9\-]+/\d+)", text)
    if m2:
        name = re.sub(r"\s+", " ", m2.group(1))
        name = name[:name.find("NO.")].title() + name[name.find("NO."):].replace("NO.", "No.")
    zones = []
    for code, heading, body in sections(text):
        for r in zone_rows(code, body):
            r["heading"] = heading
            zones.append(r)
    return {"plan": plan, "name": name, "zones": zones}


def register(app, core):

    def who(request, tok, pid, need):
        return core.require_project(request, pid, need, tok)

    @app.get("/api/ozp")
    def ozp_get(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        who(request, x_viewer_token, x_project, "viewer")
        return load(core)

    @app.put("/api/ozp")
    async def ozp_put(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = who(request, x_viewer_token, x_project, "member")
        b = await request.json()
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Send {plan, zone, values}")
        return await run_in_threadpool(put, core, b.get("plan"), b.get("zone"), b.get("values"), b.get("src"),
                                       getattr(w, "name", "") or "")

    @app.delete("/api/ozp")
    def ozp_delete(request: Request, plan: str = "", zone: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        w, _ = who(request, x_viewer_token, x_project, "viewer")
        if core.accounts_on() and not getattr(w, "site_admin", False):
            raise HTTPException(status_code=403, detail="Only a site admin removes an entry from the office list")
        return remove(core, plan, zone)

    @app.post("/api/ozp/notes")
    async def ozp_notes(request: Request, x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        who(request, x_viewer_token, x_project, "viewer")
        raw = await request.body()
        if len(raw) > MAX_PDF:
            raise HTTPException(status_code=413, detail="The PDF is over 30 MB")
        if not raw.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Not a PDF: download the plan's Notes from the OZP portal")
        fd, path = tempfile.mkstemp(suffix=".pdf")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
            text = await run_in_threadpool(pdf_text, path)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        return read_notes(text)
