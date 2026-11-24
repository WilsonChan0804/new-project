# -*- coding: utf-8 -*-
"""Site study: find a site by its lot number (Lands Department open APIs,
documented on the CSDI Portal).

  GET /api/site/lot?no=STTL 121     the Land Parcel Number search ->
      {results: [{name, place, id, x, y, ext: [xmin, ymin, xmax, ymax]}]}
      (HK 1980 Grid)
  GET /api/site/lotgeom?id=&x=&y=&ext=   the lot's boundary from the iC1000
      Lot Index (GML, HK 1980 Grid), matched by its lot id, else the lot
      containing (x, y) -> {lot: {id, name, rings: [[[x, y], ...]]}}

The new domain mapapi.hkmapservice.gov.hk is tried first (the old
mapapi.geodata.gov.hk is retired in March 2027), then the old one.
Boundaries are cached under <data>/lots. LandsD: lot boundaries in the
iC1000 are for identification only, not for survey.
"""
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from fastapi import HTTPException, Request, Header
from starlette.concurrency import run_in_threadpool

HOSTS = ["https://mapapi.hkmapservice.gov.hk", "https://mapapi.geodata.gov.hk"]
TYPES = ["lot", "stt", "gla"]
LOT_RE = re.compile(r"^\s*(([A-Z]{0,6}L)\s*\d+[A-Z]?|DD\s*\d+\s*(LOT\s*(NO\.?)?)?\s*\d+[A-Z]?)(\s*(S\.?|SEC\.?|SECTION)\s*[A-Z]\b.*|\s*R\.?P\.?)?\s*$", re.I)


def looks_like_lot(q):
    """'STTL 121', 'TKOTL 137', 'IL 152', 'DD 123 LOT 456', 'KIL 11262'"""
    q = (q or "").strip()
    return bool(q) and len(q) <= 40 and bool(LOT_RE.match(q))


def _fetch(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "LWK-Viewer site study"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _get(path, check, timeout=8, fetch=None):
    """the first host whose answer passes check(body); the reasons of the others in the error"""
    fetch = fetch or _fetch
    tried = []
    for h in HOSTS:
        try:
            body = fetch(h + path, timeout)
            if body and check(body):
                return body
            tried.append("%s: an unexpected answer" % h.split("//")[1])
        except Exception as ex:  # the next host
            tried.append("%s: %s" % (h.split("//")[1], ex))
    raise HTTPException(status_code=502, detail="The Lands Department lot search did not answer (" + "; ".join(tried) + ")")


def _is_candidates(body):
    try:
        return isinstance(json.loads(body.decode("utf-8")).get("candidates"), list)
    except (ValueError, UnicodeDecodeError, AttributeError):
        return False


def _is_gml(body):
    return b"FeatureCollection" in body[:2000]


def search(no, fetch=None):
    from concurrent.futures import ThreadPoolExecutor

    def one(t):
        try:
            return json.loads(_get("/gs/api/v1.0.0/lus/%s/SearchNumber?text=%s" % (t, urllib.parse.quote(no)), _is_candidates, fetch=fetch).decode("utf-8"))
        except HTTPException as ex:
            return ex
    with ThreadPoolExecutor(len(TYPES)) as pool:
        answers = list(pool.map(one, TYPES))
    if all(isinstance(a, HTTPException) for a in answers):
        raise answers[0]
    out, seen = [], set()
    for t, d in zip(TYPES, answers):
        if isinstance(d, HTTPException):
            continue
        for c in d.get("candidates") or []:
            a = c.get("attributes") or {}
            rid = str(a.get("Ref_ID") or "")
            if rid in seen:
                continue
            seen.add(rid)
            try:
                e = c.get("extent") or {}
                out.append({"name": a.get("PlaceName") or a.get("Descr") or c.get("address") or "", "place": a.get("City") or "",
                            "address": c.get("address") or "", "id": rid, "type": t, "score": c.get("score"),
                            "x": float(c["location"]["x"]), "y": float(c["location"]["y"]),
                            "ext": [float(e["xmin"]), float(e["ymin"]), float(e["xmax"]), float(e["ymax"])] if e else None})
            except (KeyError, TypeError, ValueError):
                continue
    out.sort(key=lambda r: -(r["score"] or 0))
    return out[:30]


NS = {"gml": "http://www.opengis.net/gml", "landsd": "http://www.landsd.gov.hk"}


def parse_gml(body):
    """the iC1000 Lot Index's features -> [{id, name, rings}] (HK80)"""
    root = ET.fromstring(body)
    out = []
    for fm in root.iter("{http://www.opengis.net/gml}featureMember"):
        f = next(iter(fm), None)
        if f is None:
            continue
        val = lambda tag: (f.findtext("landsd:" + tag, default="", namespaces=NS) or "").strip()
        rings = []
        for pl in f.iter("{http://www.opengis.net/gml}posList"):
            v = [float(q) for q in (pl.text or "").split()]
            pts = [[round(v[i], 3), round(v[i + 1], 3)] for i in range(0, len(v) - 1, 2)]
            if len(pts) >= 4 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) >= 3:
                rings.append(pts)
        if rings:
            out.append({"id": val("lotid"), "name": val("cislotdisplayname") or val("lotnumber"), "type": val("lottype"),
                        "number": val("lotnumber"), "code": val("lotcode"), "updated": val("lastupdatedate")[:10], "rings": rings})
    return out


def inside(pts, x, y):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def geometry(core, lid, x, y, ext, kind="lot"):
    d = os.path.join(core.CFG["data"], "lots")
    os.makedirs(d, exist_ok=True)
    safe = re.sub(r"[^0-9A-Za-z_-]", "", lid or "")[:40]
    p = os.path.join(d, safe + ".json") if safe else None
    if p and os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            got = json.load(f)
        if "code" in got:      # cached before the lot's details were kept: fetched again
            return got
    # the box: the lot's extent and 20 m round it, at most 700 x 580 m (the service answers up to 750 x 600 m)
    if ext:
        x0, y0, x1, y1 = ext[0] - 20, ext[1] - 20, ext[2] + 20, ext[3] + 20
    else:
        x0, y0, x1, y1 = x - 150, y - 150, x + 150, y + 150
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = min(350, (x1 - x0) / 2), min(290, (y1 - y0) / 2)
    bbox = "%.1f,%.1f,%.1f,%.1f,EPSG:2326" % (cx - hw, cy - hh, cx + hw, cy + hh)
    kind = kind if kind in TYPES else "lot"
    feats = parse_gml(_get("/gs/api/v1.0.0/iC1000/%s?bbox=%s" % (kind, bbox), _is_gml, timeout=20))
    hit = next((f for f in feats if lid and f["id"] == lid), None)
    if not hit:
        hit = next((f for f in feats if any(inside(r, x, y) for r in f["rings"])), None)
    if not hit:
        raise HTTPException(status_code=404, detail="No lot boundary found there in the Lands Department's iC1000")
    if p and hit["id"] == lid:
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(hit, f)
        os.replace(p + ".tmp", p)
    return hit


def register(app, core):

    @app.get("/api/site/lot")
    async def site_lot(request: Request, no: str = "", x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        no = (no or "").strip()[:40]
        if not no:
            return {"results": []}
        return {"results": await run_in_threadpool(search, no)}

    @app.get("/api/site/lotgeom")
    async def site_lotgeom(request: Request, id: str = "", x: float = 0, y: float = 0, ext: str = "", type: str = "lot",
                           x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        e = None
        try:
            e = [float(q) for q in ext.split(",")] if ext else None
            if e and len(e) != 4:
                e = None
        except ValueError:
            e = None
        if not (800000 < x < 870000 and 800000 < y < 850000):
            raise HTTPException(status_code=400, detail="Give the lot's HK 1980 Grid point")
        return {"lot": await run_in_threadpool(geometry, core, id, x, y, e, type)}
