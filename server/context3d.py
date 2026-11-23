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


def find_tiles(lat, lng, r, cache_dir):
    """the finest b3dm tiles whose boxes come within r of the point -> [(url, transform)]"""
    p = ecef(lat, lng)
    out = []

    def near(bv, tf):
        b = bv.get("box")
        if not b:
            return True
        c = (b[0] + tf[12], b[1] + tf[13], b[2] + tf[14])
        rad = sum(math.sqrt(b[3 + 3 * k] ** 2 + b[4 + 3 * k] ** 2 + b[5 + 3 * k] ** 2) for k in range(3))
        return math.dist(c, p) <= rad + r

    def walk(node, base_url, tf, depth):
        if len(out) >= MAX_TILES or depth > 40:
            return
        if "transform" in node:
            tf = _mat_mul(tf, node["transform"])
        if not near(node.get("boundingVolume", {}), tf):
            return
        kids = [k for k in node.get("children", [])]
        content = (node.get("content") or {}).get("uri") or (node.get("content") or {}).get("url")
        if content and content.endswith(".json"):
            url = urllib.parse.urljoin(base_url, content)
            ts = json.loads(_get(url, cache_dir))
            walk(ts["root"], url, tf, depth + 1)
            return
        near_kids = [k for k in kids if near(k.get("boundingVolume", {}), tf)]
        if near_kids:
            for k in near_kids:
                walk(k, base_url, tf, depth + 1)
        elif content and (not kids or (node.get("geometricError") or 0) <= 2):
            # the finest level only: a coarse tile whose finer children are all far is not wanted
            out.append((urllib.parse.urljoin(base_url, content), tf))

    root_url = BASE + "tileset.json"
    ts = json.loads(_get(root_url, cache_dir))
    walk(ts["root"], root_url, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0)
    return out


def context(core, lat, lng, r):
    cache_dir = os.path.join(core.CFG["data"], "context3d")
    os.makedirs(cache_dir, exist_ok=True)
    key = os.path.join(cache_dir, "out-%.5f-%.5f-%d.bin" % (lat, lng, r))
    if os.path.exists(key) and time.time() - os.path.getmtime(key) < 30 * 86400:
        with open(key, "rb") as f:
            blob = f.read()
        with open(key + ".json") as f:
            return blob, json.load(f)
    tiles = find_tiles(lat, lng, r, cache_dir)
    o, e, n, u = enu_frame(lat, lng)
    verts = []
    from concurrent.futures import ThreadPoolExecutor

    def one(item):
        url, tf = item
        try:
            return b3dm_triangles(_get(url, cache_dir), tf)
        except Exception as ex:
            print("context3d: %s: %s" % (url, ex))
            return []
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, tiles))
    for tris in results:
        for t in tris:
            loc = []
            for (x, y, z) in t:
                d = (x - o[0], y - o[1], z - o[2])
                loc.append((d[0] * e[0] + d[1] * e[1] + d[2] * e[2], d[0] * n[0] + d[1] * n[1] + d[2] * n[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]))
            cx, cy = (loc[0][0] + loc[1][0] + loc[2][0]) / 3, (loc[0][1] + loc[1][1] + loc[2][1]) / 3
            if cx * cx + cy * cy <= r * r:
                verts.extend(loc)
        if len(verts) // 3 >= MAX_TRIS:
            break
    # the ground: low among the vertices near the site
    zs = sorted(v[2] for v in verts if v[0] * v[0] + v[1] * v[1] < (r * 0.5) ** 2) or sorted(v[2] for v in verts) or [0]
    ground = zs[max(0, int(len(zs) * 0.02))]
    blob = struct.pack("<%df" % (len(verts) * 3), *[c for v in verts for c in (v[0], v[1], v[2] - ground)])
    meta = {"tiles": len(tiles), "triangles": len(verts) // 3, "ground": round(ground, 2)}
    try:
        with open(key, "wb") as f:
            f.write(blob)
        with open(key + ".json", "w") as f:
            json.dump(meta, f)
    except OSError:
        pass
    return blob, meta


def register(app, core):
    @app.get("/api/site/context")
    async def site_context(request: Request, lat: float, lng: float, r: float = 250,
                           x_viewer_token: str = Header(default=""), x_project: str = Header(default="")):
        core.require_project(request, x_project, "viewer", x_viewer_token)
        if not (22.1 <= lat <= 22.6 and 113.8 <= lng <= 114.5):
            raise HTTPException(status_code=400, detail="Not in Hong Kong")
        r = max(50.0, min(600.0, r))
        try:
            blob, meta = await run_in_threadpool(context, core, round(lat, 5), round(lng, 5), int(r))
        except Exception as ex:
            raise HTTPException(status_code=502, detail="The 3D data did not answer: %s" % ex)
        return Response(content=blob, media_type="application/octet-stream", headers={"X-Context": json.dumps(meta)})
