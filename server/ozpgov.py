# -*- coding: utf-8 -*-
"""Site study: the statutory zoning of a site from the Town Planning Board's
Digital Planning Data of Statutory Plans (listed on the CSDI Portal).

  GET /api/site/zoning?rings=[[[x, y], ...]]&id=<lot id>   (HK 1980 Grid)
      -> {plans: [{plan, name, name_cht, published, approved, link}],
          zones: [{plan, zone, desc, desc_cht, special, share, area, rings}],
          bh: [{plan, kind: "mPD" | "storeys", value, share}],
          notes: {plan: {zone: {values, evidence}}},
          area, at, src}

The plans covering the site come from the Board's FeatureServer
(OZP_PLAN_CSDI: each plan's scheme area, with a link to its data); each
plan's package (a zip: ZONE.json, BHC.json in Esri JSON, HK80, and the
plan's Notes) is fetched once and kept a week under <data>/ozpgov. The
share of the site in each zone and height control area is measured on a
grid of points over the site. The Notes are read with ozp.read_notes:
figures read from wording, to be checked against the Notes.
"""
import io
import json
import math
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

SERVICE = "https://www.ozp.tpb.gov.hk/arcgis2/rest/services/DATA/OZP_PLAN_CSDI/FeatureServer/0/query"
WEEK = 7 * 86400
SRC = "Town Planning Board, Digital Planning Data of Statutory Plans"


def _fetch(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "LWK-Viewer site study"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _down(what, ex):
    return HTTPException(status_code=502, detail="The Town Planning Board's service did not answer (%s: %s)" % (what, ex))


def ring_area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2


def inside(r, x, y):
    c, j = False, len(r) - 1
    for i in range(len(r)):
        xi, yi = r[i]; xj, yj = r[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def in_rings(rings, x, y):
    """Esri polygons: inside an odd number of rings (outer rings and holes)"""
    n = 0
    for r in rings:
        if inside(r, x, y):
            n += 1
    return n % 2 == 1


def bbox(rings):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def samples(rings, n=4000):
    """points on a grid over the site, those inside it"""
    x0, y0, x1, y1 = bbox(rings)
    a = sum(ring_area(r) for r in rings[:1]) or (x1 - x0) * (y1 - y0) or 1
    step = max(0.2, math.sqrt(a / n))
    out, y = [], y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            if in_rings(rings, x, y):
                out.append((x, y))
            x += step
        y += step
    return out


def plans_at(rings, fetch=None):
    fetch = fetch or _fetch
    geo = json.dumps({"rings": rings, "spatialReference": {"wkid": 2326}})
    q = urllib.parse.urlencode({"geometry": geo, "geometryType": "esriGeometryPolygon", "inSR": 2326, "spatialRel": "esriSpatialRelIntersects",
                                "outFields": "PLAN_NO,NAME_ENG,NAME_CHT,PUB_DATE,APRV_DATE,GEOJSON_LINK", "returnGeometry": "false", "f": "json"})
    try:
        d = json.loads(fetch(SERVICE + "?" + q, 25).decode("utf-8"))
    except Exception as ex:
        raise _down("the plans", ex)
    if "features" not in d:
        raise _down("the plans", (d.get("error") or {}).get("message") or "no features")
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000)) if ms else ""
    return [{"plan": a.get("PLAN_NO") or "", "name": a.get("NAME_ENG") or "", "name_cht": a.get("NAME_CHT") or "",
             "published": day(a.get("PUB_DATE")), "approved": day(a.get("APRV_DATE")), "link": a.get("GEOJSON_LINK") or ""}
            for a in (f.get("attributes") or {} for f in d["features"]) if a.get("PLAN_NO")]


def _esri(z, name):
    """a layer of the package (Esri JSON) -> [{attributes, rings}], none when it has no such layer"""
    n = next((i for i in z.namelist() if i.replace("\\", "/").endswith("/" + name + ".json")), None)
    if not n:
        return []
    d = json.loads(z.read(n).decode("utf-8-sig"))
    out = []
    for f in d.get("features") or []:
        g = f.get("geometry") or {}
        rings = [[[round(p[0], 2), round(p[1], 2)] for p in r] for r in g.get("rings") or [] if len(r) >= 3]
        if rings:
            out.append({"a": f.get("attributes") or f.get("properties") or {}, "rings": rings, "box": bbox(rings)})
    return out


def read_package(body, notes_reader=None):
    """a plan's zip -> {zones, bhc, notes}"""
    z = zipfile.ZipFile(io.BytesIO(body))
    zones = _esri(z, "ZONE")
    bhc = _esri(z, "BHC")
    notes = {}
    pdf = next((i for i in z.namelist() if re.search(r"_e\.pdf$", i, re.I) and "notes" in i.lower()), None)
    if pdf and notes_reader:
        try:
            notes = notes_reader(z.read(pdf))
        except Exception:  # the Notes unread: the zoning still stands
            notes = {}
    return {"zones": zones, "bhc": bhc, "notes": notes}


def _notes_reader(pdf_bytes):
    import ozp
    fd, p = tempfile.mkstemp(suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(pdf_bytes)
        r = ozp.read_notes(ozp.pdf_text(p))
    finally:
        os.unlink(p)
    return {z["zone"]: {"values": z.get("values") or {}, "evidence": z.get("evidence") or {}, "heading": z.get("heading") or ""} for z in r.get("zones") or []}


def package(core, plan, link, fetch=None):
    """a plan's zoning, height controls and Notes, kept a week"""
    fetch = fetch or _fetch
    d = os.path.join(core.CFG["data"], "ozpgov")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, re.sub(r"[^0-9A-Za-z_-]", "_", plan)[:40] + ".json")
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < WEEK:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    url = link or "https://www.ozp.tpb.gov.hk/api/plan/Spatial?" + urllib.parse.urlencode({"planNo": plan, "type": "geo"})
    try:
        body = fetch(url, 120)
    except Exception as ex:
        if os.path.exists(p):      # an older copy rather than nothing
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        raise _down("the data of " + plan, ex)
    if body[:2] != b"PK":
        raise _down("the data of " + plan, "not a zip")
    out = read_package(body, _notes_reader)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(out, f)
    os.replace(p + ".tmp", p)
    return out


def zoning(core, rings, lid="", fetch=None, pack=None):
    if not rings or not rings[0] or len(rings[0]) < 3:
        raise HTTPException(status_code=400, detail="Give the site's boundary (HK 1980 Grid)")
    d = os.path.join(core.CFG["data"], "zoning")
    os.makedirs(d, exist_ok=True)
    safe = re.sub(r"[^0-9A-Za-z_-]", "", lid or "")[:40]
    cp = os.path.join(d, safe + ".json") if safe else None
    if cp and os.path.exists(cp) and time.time() - os.path.getmtime(cp) < WEEK:
        with open(cp, encoding="utf-8") as f:
            return json.load(f)
    pack = pack or (lambda plan, link: package(core, plan, link, fetch))
    plans = plans_at(rings, fetch)
    pts = samples(rings)
    n = len(pts) or 1
    area = sum(ring_area(r) for r in rings[:1])
    x0, y0, x1, y1 = bbox(rings)
    over = lambda b: not (b[2] < x0 or b[0] > x1 or b[3] < y0 or b[1] > y1)
    zones, bh, notes = [], [], {}
    for pl in plans:
        P = pack(pl["plan"], pl["link"])
        for z in P["zones"]:
            if not over(z["box"]):
                continue
            k = sum(1 for (x, y) in pts if in_rings(z["rings"], x, y))
            if not k:
                continue
            a = z["a"]
            zones.append({"plan": pl["plan"], "zone": (a.get("ZONE_LABEL") or "").strip(), "desc": (a.get("DESC_ENG") or "").strip(), "desc_cht": (a.get("DESC_CHT") or "").strip(),
                          "special": (a.get("SPUSE_ENG") or "").strip(), "share": round(k / n, 4), "area": round(area * k / n, 1), "rings": z["rings"]})
        for b in P["bhc"]:
            if not over(b["box"]):
                continue
            k = sum(1 for (x, y) in pts if in_rings(b["rings"], x, y))
            if not k:
                continue
            a = b["a"]
            try:
                v = float(a.get("BHC_VALUE"))
            except (TypeError, ValueError):
                continue
            bh.append({"plan": pl["plan"], "kind": "storeys" if str(a.get("BHC_TYPE") or "").upper().endswith("S") else "mPD", "value": v, "share": round(k / n, 4)})
        if P.get("notes"):
            mine = {z["zone"] for z in zones if z["plan"] == pl["plan"]}
            notes[pl["plan"]] = {k2: v for k2, v in P["notes"].items() if k2 in mine}
    # the same zone in several parts: one row, their shares together
    merged = {}
    for z in zones:
        k2 = (z["plan"], z["zone"], z["special"])
        if k2 in merged:
            merged[k2]["share"] = round(merged[k2]["share"] + z["share"], 4); merged[k2]["area"] = round(merged[k2]["area"] + z["area"], 1); merged[k2]["rings"] += z["rings"]
        else:
            merged[k2] = z
    zones = sorted(merged.values(), key=lambda z: -z["share"])
    bh.sort(key=lambda b: -b["share"])
    out = {"plans": [{k2: v for k2, v in p.items()} for p in plans], "zones": zones, "bh": bh, "notes": notes,
           "area": round(area, 1), "at": time.strftime("%Y-%m-%d"), "src": SRC}
    if cp:
        with open(cp + ".tmp", "w", encoding="utf-8") as f:
            json.dump(out, f)
        os.replace(cp + ".tmp", cp)
    return out


def register(app, core):

    @app.get("/api/site/zoning")
    async def site_zoning(request: Request, rings: str = "", id: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        try:
            R = json.loads(rings)
            R = [[[float(p[0]), float(p[1])] for p in r] for r in R][:20]
        except (ValueError, TypeError, IndexError):
            raise HTTPException(status_code=400, detail="Give the site's boundary (HK 1980 Grid)")
        if not R or not all(800000 < p[0] < 870000 and 800000 < p[1] < 850000 for p in R[0]):
            raise HTTPException(status_code=400, detail="Give the site's boundary in the HK 1980 Grid")
        return await run_in_threadpool(zoning, core, R, id)
