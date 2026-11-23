# -*- coding: utf-8 -*-
"""Site study 3D surroundings: the Lands Department's 3D Spatial Data (CSDI,
Cesium 3D Tiles, buildings) around a site, as plain triangles in metres
about the site (east, north, up) for the page's three.js view.

  GET /api/site/context?lat=&lng=&r=   -> application/octet-stream:
      float32 [x, y, z] per vertex, three vertices a triangle; z is metres
      above the lowest ground found near the site. Header X-Context: json
      {tiles, triangles, ground}.

The tiles' textures are left out (the view draws the buildings in a light
grey, as context). Kept in <data>/context3d/ for a month.
"""
import json
import math
import os
import struct
import time
import urllib.parse
import urllib.request

from fastapi import HTTPException, Request, Header, Response
from starlette.concurrency import run_in_threadpool

BASE = "https://data.map.gov.hk/api/3d-data/3dsd/WGS84/building/"
# the key shown on the CSDI API page for public use; a site may set its own
KEY = os.environ.get("LWK_CSDI_3D_KEY", "3967f8f365694e0798af3e7678509421")
MAX_TILES = 160
MAX_TRIS = 400000
A_WGS, F_WGS = 6378137.0, 1 / 298.257223563
E2 = F_WGS * (2 - F_WGS)


def _get(url, cache_dir):
    name = urllib.parse.quote(url.replace(BASE, ""), safe="")[:200]
    path = os.path.join(cache_dir, name)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 30 * 86400:
        with open(path, "rb") as f:
            return f.read()
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + "key=" + KEY, headers={"User-Agent": "LWK-Viewer site study"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read()
    try:
        with open(path, "wb") as f:
            f.write(data)
    except OSError:
        pass
    return data


def ecef(lat, lng, h=0.0):
    la, lo = math.radians(lat), math.radians(lng)
    n = A_WGS / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - E2) + h) * math.sin(la))


def enu_frame(lat, lng):
    la, lo = math.radians(lat), math.radians(lng)
    e = (-math.sin(lo), math.cos(lo), 0.0)
    n = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    u = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    return ecef(lat, lng), e, n, u


def _mat_mul(a, b):  # column-major 4x4
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def _node_matrix(nd):
    if "matrix" in nd:
        return list(nd["matrix"])
    t = nd.get("translation", [0, 0, 0]); q = nd.get("rotation", [0, 0, 0, 1]); s = nd.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
    for c in range(3):
        for k in range(3):
            r[k + 4 * c] *= s[c]
    r[12], r[13], r[14] = t
    return r


COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _accessor(j, binary, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    fmt, size = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or size * n
    out = []
    for k in range(a["count"]):
        o = off + k * stride
        out.append(struct.unpack_from("<" + fmt * n, binary, o))
    return out


def b3dm_triangles(data, tile_tf):
    """-> [(ecef x, y, z) * 3] for each triangle of a b3dm"""
    if data[:4] != b"b3dm":
        return []
    _, _, _, ftj, ftb, btj, btb = struct.unpack("<4sIIIIII", data[:28])
    ft = json.loads(data[28:28 + ftj] or b"{}") if ftj else {}
    rtc = ft.get("RTC_CENTER") or [0, 0, 0]
    glb = data[28 + ftj + ftb + btj + btb:]
    if glb[:4] != b"glTF":
        return []
    clen = struct.unpack_from("<I", glb, 12)[0]
    j = json.loads(glb[20:20 + clen])
    binary = b""
    o = 20 + clen
    if o + 8 <= len(glb):
        blen = struct.unpack_from("<I", glb, o)[0]
        binary = glb[o + 8:o + 8 + blen]
    # glTF is Y-up: to the tile's Z-up, then the tile's transform
    yup = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
    base = _mat_mul(tile_tf, yup)
    tris = []
    nodes = j.get("nodes", [])
    scene = j.get("scenes", [{}])[j.get("scene", 0)].get("nodes", list(range(len(nodes))))

    def visit(ni, m):
        nd = nodes[ni]
        m2 = _mat_mul(m, _node_matrix(nd))
        if "mesh" in nd:
            for pr in j["meshes"][nd["mesh"]]["primitives"]:
                if pr.get("mode", 4) != 4 or "POSITION" not in pr["attributes"]:
                    continue
                pos = _accessor(j, binary, pr["attributes"]["POSITION"])
                idx = [i[0] for i in _accessor(j, binary, pr["indices"])] if "indices" in pr else list(range(len(pos)))
                w = [(m2[0] * x + m2[4] * y + m2[8] * z + m2[12] + rtc[0],
                      m2[1] * x + m2[5] * y + m2[9] * z + m2[13] + rtc[1],
                      m2[2] * x + m2[6] * y + m2[10] * z + m2[14] + rtc[2]) for (x, y, z) in pos]
                for k in range(0, len(idx) - 2, 3):
                    tris.append((w[idx[k]], w[idx[k + 1]], w[idx[k + 2]]))
        for c in nd.get("children", []):
            visit(c, m2)

    for ni in scene:
        visit(ni, base)
    return tris


def find_tiles(lat, lng, r, cache_dir, prog=None):
    """the finest b3dm tiles whose boxes reach the square of half-width r about
    the point -> ([(url, transform)], capped). Nested tilesets are read in
    parallel, level by level."""
    from concurrent.futures import ThreadPoolExecutor
    p = ecef(lat, lng)
    reach = r * math.sqrt(2)
    cap = max_tiles(r)
    out = []

    def near(bv, tf):
        b = bv.get("box")
        if not b:
            return True
        c = (b[0] + tf[12], b[1] + tf[13], b[2] + tf[14])
        rad = sum(math.sqrt(b[3 + 3 * k] ** 2 + b[4 + 3 * k] ** 2 + b[5 + 3 * k] ** 2) for k in range(3))
        return math.dist(c, p) <= rad + reach

    def tight(bv, tf):
        """the box really over the square (its centre within it, give or take its own half-size)"""
        b = bv.get("box")
        if not b:
            return False
        c = (b[0] + tf[12], b[1] + tf[13], b[2] + tf[14])
        half = max(math.sqrt(b[3 + 3 * k] ** 2 + b[4 + 3 * k] ** 2 + b[5 + 3 * k] ** 2) for k in range(3))
        return math.dist(c, p) <= reach + half * 0.5 and half < 3000

    def expand(node, base_url, tf, depth, pending):
        """the node's finest tiles, or the nested tilesets still to read"""
        if depth > 60:
            return
        if "transform" in node:
            tf = _mat_mul(tf, node["transform"])
        if not near(node.get("boundingVolume", {}), tf):
            return
        kids = node.get("children", [])
        content = (node.get("content") or {}).get("uri") or (node.get("content") or {}).get("url")
        if content and content.endswith(".json"):
            pending.append((urllib.parse.urljoin(base_url, content), tf, depth + 1))
            return
        near_kids = [k for k in kids if near(k.get("boundingVolume", {}), tf)]
        if near_kids:
            for k in near_kids:
                expand(k, base_url, tf, depth + 1, pending)
        elif content and (not kids or (node.get("geometricError") or 0) <= 2 or tight(node.get("boundingVolume", {}), tf)):
            # the finest here: a leaf, or a tile whose finer children do not reach the area
            out.append((urllib.parse.urljoin(base_url, content), tf))

    root_url = BASE + "tileset.json"
    pending = []
    expand(json.loads(_get(root_url, cache_dir))["root"], root_url, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0, pending)
    with ThreadPoolExecutor(max_workers=8) as pool:
        while pending and len(out) < cap:
            if prog is not None:
                prog["stage"] = "finding tiles"; prog["done"] = len(out)
            docs = list(pool.map(lambda it: (it, json.loads(_get(it[0], cache_dir))), pending))
            pending = []
            for (url, tf, depth), ts in docs:
                expand(ts["root"], url, tf, depth, pending)
    capped = len(out) > cap
    return out[:cap], capped


def max_tiles(r):
    return int(max(160, min(2000, 160 * (r / 300.0) ** 2)))


JOBS = {}


def context(core, lat, lng, r, prog=None):
    cache_dir = os.path.join(core.CFG["data"], "context3d")
    os.makedirs(cache_dir, exist_ok=True)
    key = os.path.join(cache_dir, "sq-%.5f-%.5f-%d.bin" % (lat, lng, r))
    if os.path.exists(key) and time.time() - os.path.getmtime(key) < 30 * 86400:
        with open(key, "rb") as f:
            blob = f.read()
        with open(key + ".json") as f:
            return blob, json.load(f)
    tiles, capped = find_tiles(lat, lng, r, cache_dir, prog)
    o, e, n, u = enu_frame(lat, lng)
    verts = []
    from concurrent.futures import ThreadPoolExecutor
    if prog is not None:
        prog.update(stage="reading buildings", done=0, total=len(tiles))

    def one(item):
        url, tf = item
        try:
            tris = b3dm_triangles(_get(url, cache_dir), tf)
        except Exception as ex:
            print("context3d: %s: %s" % (url, ex))
            tris = []
        loc_tris = []
        for t in tris:
            loc = []
            for (x, y, z) in t:
                d = (x - o[0], y - o[1], z - o[2])
                loc.append((d[0] * e[0] + d[1] * e[1] + d[2] * e[2], d[0] * n[0] + d[1] * n[1] + d[2] * n[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]))
            cx, cy = (loc[0][0] + loc[1][0] + loc[2][0]) / 3, (loc[0][1] + loc[1][1] + loc[2][1]) / 3
            if abs(cx) <= r and abs(cy) <= r:
                loc_tris.append(loc)
        if prog is not None:
            prog["done"] = prog.get("done", 0) + 1
        return loc_tris
    with ThreadPoolExecutor(max_workers=8) as pool:
        for lt in pool.map(one, tiles):
            for loc in lt:
                verts.extend(loc)
    max_tris = int(min(3000000, MAX_TRIS * (r / 300.0) ** 2 + MAX_TRIS))
    if len(verts) // 3 > max_tris:
        verts = verts[:max_tris * 3]; capped = True
    # the ground: low among the vertices near the site
    zs = sorted(v[2] for v in verts if v[0] * v[0] + v[1] * v[1] < 150 ** 2) or sorted(v[2] for v in verts) or [0]
    ground = zs[max(0, int(len(zs) * 0.02))]
    blob = struct.pack("<%df" % (len(verts) * 3), *[c for v in verts for c in (v[0], v[1], v[2] - ground)])
    meta = {"tiles": len(tiles), "triangles": len(verts) // 3, "ground": round(ground, 2), "r": r, "capped": bool(capped)}
    try:
        with open(key, "wb") as f:
            f.write(blob)
        with open(key + ".json", "w") as f:
            json.dump(meta, f)
    except OSError:
        pass
    return blob, meta


def start(core, lat, lng, r):
    """the area ready -> (blob, meta); else a job is started or running -> (None, progress)"""
    k = (lat, lng, r)
    cache_dir = os.path.join(core.CFG["data"], "context3d")
    key = os.path.join(cache_dir, "sq-%.5f-%.5f-%d.bin" % (lat, lng, r))
    if os.path.exists(key) and os.path.exists(key + ".json"):
        return context(core, lat, lng, r)
    j = JOBS.get(k)
    if j and j.get("error"):
        JOBS.pop(k, None)
        raise RuntimeError(j["error"])
    if j and j.get("ready"):
        JOBS.pop(k, None)
        return context(core, lat, lng, r)
    if not j:
        import threading
        j = JOBS[k] = {"stage": "starting", "done": 0, "total": 0}

        def run():
            try:
                context(core, lat, lng, r, j)
                j["ready"] = True
            except Exception as ex:
                j["error"] = str(ex)
        threading.Thread(target=run, daemon=True).start()
    return None, dict(j)


def register(app, core):
    @app.get("/api/site/context")
    async def site_context(request: Request, lat: float, lng: float, r: float = 500,
                           x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        if not (22.1 <= lat <= 22.6 and 113.8 <= lng <= 114.5):
            raise HTTPException(status_code=400, detail="Not in Hong Kong")
        r = int(max(100.0, min(1500.0, r)))
        try:
            blob, meta = await run_in_threadpool(start, core, round(lat, 5), round(lng, 5), r)
        except Exception as ex:
            raise HTTPException(status_code=502, detail="The 3D data did not answer: %s" % ex)
        if blob is None:
            return Response(content=json.dumps(dict(meta, status="working")), status_code=202, media_type="application/json")
        return Response(content=blob, media_type="application/octet-stream", headers={"X-Context": json.dumps(meta)})
