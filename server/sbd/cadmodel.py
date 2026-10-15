# -*- coding: utf-8 -*-
"""The SBD model drawn in CAD - for a project without Revit.

The template (template_dxf) is a DXF with the layers to draw on and a note
of the rules; the person draws on it in AutoCAD, SketchUp, Rhino ... and
sends it back (DXF, or DWG through the ODA File Converter). read_model
makes of it the same sbd.json as the Revit add-in's SBD Export:

  SBD-SITE              the site boundary: one closed polyline
  SBD-STREET-<name>     a street's slab: closed polyline(s) at the street's
                        mean level (the polyline's elevation, or a 3DFACE)
                        - one layer per street, its name after the dash
  SBD-MASS[-<name>]     the buildings: closed polylines with an elevation
                        and a thickness (an extruded block - stack them for
                        a podium and a tower), 3D faces, polyface meshes or
                        MESH. An AutoCAD solid (3DSOLID) is not read: turn
                        it into a mesh first (CONVTOMESH).

Units: metres ($INSUNITS 6); millimetres and centimetres are scaled.
Blocks are not read (explode them).
"""

import math

from . import streets as S
from .dxfwrite import Dxf

SITE, STREET, MASS = "SBD-SITE", "SBD-STREET-", "SBD-MASS"
UNIT_SCALE = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}


# ------------------------------------------------------------ the template
def template_dxf():
    """The template: the layers, an example of each and the rules."""
    d = Dxf()
    d.layer(SITE, 7)
    d.layer(STREET + "Main Street", 8)
    d.layer(STREET + "Side Street", 9)
    d.layer(MASS, 30)
    d.layer("SBD-NOTE", 2)
    # an example: a 60 x 40 m site on two streets, a podium and a tower
    d.poly(SITE, [(0, 0), (60, 0), (60, 40), (0, 40)], closed=True)
    d.poly(STREET + "Main Street", [(-20, -20), (80, -20), (80, 0), (-20, 0)], closed=True, elevation=0.0)
    d.poly(STREET + "Side Street", [(60, 0), (75, 0), (75, 60), (60, 60)], closed=True, elevation=0.5)
    d.poly(MASS, [(5, 5), (55, 5), (55, 35), (5, 35)], closed=True, elevation=0.0, thickness=15.0)
    d.poly(MASS, [(10, 10), (30, 10), (30, 30), (10, 30)], closed=True, elevation=15.0, thickness=65.0)
    rules = [
        "SBD MODEL TEMPLATE (PNAP APP-152) - LWK Viewer. Draw in metres, on these layers; delete the example.",
        "SBD-SITE: the site boundary, ONE closed polyline.",
        "SBD-STREET-<street name>: each street's slab as a closed polyline, its ELEVATION = the street's mean level.",
        "  One layer per street: SBD-STREET-Main Street, SBD-STREET-Side Street ... (the name after the dash is used).",
        "  Draw the slab from the site boundary to the far side of the street (the opposite site boundary).",
        "SBD-MASS (or SBD-MASS-<name>): the buildings - closed polylines with ELEVATION (base) and THICKNESS (height),",
        "  stacked for a podium and a tower; or 3D faces, polyface meshes or MESH. 3DSOLID: CONVTOMESH first.",
        "Explode blocks. Level 0 is the lowest street abutting the site. Then: Viewer > 3D > Checks > SBD > Import CAD model.",
    ]
    for i, t in enumerate(rules):
        d.text("SBD-NOTE", (0, -30 - i * 2.2), 1.2, t)
    return d.write()


# ------------------------------------------------------------ reading
def _closed_loops(e):
    """A closed LWPOLYLINE / POLYLINE -> ([(x, y)], elevation, thickness, zs)."""
    if e.type == "LWPOLYLINE":
        xs, ys = e.all(10), e.all(20)
        pts = [(float(x), float(y)) for x, y in zip(xs, ys)]
        return pts, e.f(38), e.f(39), None, bool(e.i(70) & 1)
    if e.type == "POLYLINE":
        fl = e.i(70)
        if fl & 64 or fl & 16:          # a mesh
            return None
        vs = [(v.f(10), v.f(20), v.f(30)) for v in e.kids if v.type == "VERTEX"]
        pts = [(x, y) for x, y, _ in vs]
        zs = [z for _, _, z in vs]
        elev = e.f(30) if not (fl & 8) else (sum(zs) / len(zs) if zs else 0.0)
        return pts, elev, e.f(39), zs if fl & 8 else None, bool(fl & 1)
    return None


def _ear_clip(pts):
    """Triangles [i, j, k] of a simple polygon (any winding)."""
    n = len(pts)
    if n < 3:
        return []
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    idx = list(range(n)) if area > 0 else list(range(n))[::-1]
    out = []
    guard = 0
    while len(idx) > 3 and guard < 10 * n * n:
        guard += 1
        m = len(idx)
        for k in range(m):
            a, b, c = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            ax, ay = pts[a]
            bx, by = pts[b]
            cx, cy = pts[c]
            if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 1e-12:
                continue                     # reflex (or flat)
            inside = False
            for o in idx:
                if o in (a, b, c):
                    continue
                px, py = pts[o]
                d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
                d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
                d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
                if d1 >= -1e-12 and d2 >= -1e-12 and d3 >= -1e-12:
                    inside = True
                    break
            if inside:
                continue
            out.append([a, b, c])
            del idx[k]
            break
        else:
            break                            # degenerate: stop
    if len(idx) == 3:
        out.append(idx[:])
    return out


def _prism(pts, z0, z1):
    """A closed outline extruded from z0 to z1 -> (verts, tris), outward."""
    if z1 < z0:
        z0, z1 = z1, z0
    n = len(pts)
    verts = [[x, y, z0] for x, y in pts] + [[x, y, z1] for x, y in pts]
    cap = _ear_clip(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    ccw = area > 0
    tris = []
    for a, b, c in cap:
        tris.append([a, c, b])                    # bottom, facing down
        tris.append([n + a, n + b, n + c])        # top, facing up
    for i in range(n):
        j = (i + 1) % n
        if ccw:
            tris += [[i, j, n + j], [i, n + j, n + i]]
        else:
            tris += [[j, i, n + i], [j, n + i, n + j]]
    return verts, tris


def _mesh_of(e):
    """A polyface mesh, a MESH or a 3DFACE -> (verts, tris) or None."""
    if e.type == "3DFACE":
        q = [(e.f(10 + k), e.f(20 + k), e.f(30 + k)) for k in range(4)]
        if q[3] == q[2]:
            return [list(p) for p in q[:3]], [[0, 1, 2]]
        return [list(p) for p in q], [[0, 1, 2], [0, 2, 3]]
    if e.type == "POLYLINE" and e.i(70) & 64:
        pts, tris = [], []
        for v in e.kids:
            fl = v.i(70)
            if fl & 64 and fl & 128:
                pts.append([v.f(10), v.f(20), v.f(30)])
            elif fl & 128:
                ix = [abs(v.i(c)) - 1 for c in (71, 72, 73, 74) if v.i(c)]
                if len(ix) >= 3:
                    tris.append(ix[:3])
                    if len(ix) == 4:
                        tris.append([ix[0], ix[2], ix[3]])
        return (pts, tris) if pts and tris else None
    if e.type == "MESH":
        # the vertices (after 92), then the face list (93: count, then sizes and indices)
        tags = e.tags
        verts, tris, i = [], [], 0
        while i < len(tags):
            c, v = tags[i]
            if c == 92:
                nv = int(float(v))
                j = i + 1
                while len(verts) < nv and j + 2 < len(tags):
                    if tags[j][0] == 10:
                        verts.append([float(tags[j][1]), float(tags[j + 1][1]), float(tags[j + 2][1])])
                        j += 3
                    else:
                        j += 1
                i = j
                continue
            if c == 93:
                vals = []
                j = i + 1
                total = int(float(v))
                while len(vals) < total and j < len(tags) and tags[j][0] == 90:
                    vals.append(int(float(tags[j][1])))
                    j += 1
                k = 0
                while k < len(vals):
                    m = vals[k]
                    f = vals[k + 1:k + 1 + m]
                    for t in range(1, m - 1):
                        tris.append([f[0], f[t], f[t + 1]])
                    k += m + 1
                i = j
                continue
            i += 1
        return (verts, tris) if verts and tris else None
    return None


def _weld(V, T, tol=0.001):
    """Corners within a millimetre made one: 3D faces arrive each with its
    own three or four points, and a solid is found by its shared corners."""
    key = {}
    out, remap = [], []
    for v in V:
        k = (round(v[0] / tol), round(v[1] / tol), round(v[2] / tol))
        if k not in key:
            key[k] = len(out)
            out.append(v)
        remap.append(key[k])
    tris = [[remap[a], remap[b], remap[c]] for a, b, c in T]
    return out, [t for t in tris if len(set(t)) == 3]


def read_model(doc, project="", by=""):
    """A DXF (cad_dxf.read) -> (sbd.json dict, [problems])."""
    probs = []
    units = int(float(doc.hv("$INSUNITS", default="6") or 6))
    k = UNIT_SCALE.get(units, 1.0)
    sites, floors, masses = [], [], {}
    for e in doc.model_ents():
        lay = (e.get(8) or "").strip()
        up = lay.upper()
        if not up.startswith("SBD-"):
            continue
        if e.type == "INSERT":
            probs.append("Layer %s: a block - explode it (blocks are not read)." % lay)
            continue
        if e.type == "3DSOLID" or e.type == "BODY" or e.type == "REGION":
            probs.append("Layer %s: an AutoCAD solid (%s) - turn it into a mesh first (CONVTOMESH)." % (lay, e.type))
            continue
        if up == SITE:
            got = _closed_loops(e)
            if got and got[4] and len(got[0]) >= 3:
                sites.append([(x * k, y * k) for x, y in got[0]])
            continue
        if up.startswith(STREET):
            name = lay[len(STREET):].strip() or "Street"
            got = _closed_loops(e)
            if got and got[4] and len(got[0]) >= 3:
                pts, elev, _t, zs, _c = got
                floors.append({"name": name, "loop": [(x * k, y * k) for x, y in pts], "z": elev * k})
            elif e.type == "3DFACE":
                q = [(e.f(10 + i) * k, e.f(20 + i) * k, e.f(30 + i) * k) for i in range(4)]
                if q[3] == q[2]:
                    q = q[:3]
                floors.append({"name": name, "loop": [(x, y) for x, y, _ in q], "z": sum(z for _, _, z in q) / len(q)})
            continue
        if up == MASS or up.startswith(MASS + "-"):
            name = lay[len(MASS) + 1:].strip() if len(lay) > len(MASS) + 1 else ""
            got = _closed_loops(e)
            m = None
            if got and got[4] and len(got[0]) >= 3 and abs(got[2]) > 1e-9:
                pts, elev, th = got[0], got[1], got[2]
                ez = e.f(230, 1.0)
                if ez < 0:
                    th = -th
                m = _prism([(x * k, y * k) for x, y in pts], elev * k, (elev + th) * k)
            elif got and got[4] and len(got[0]) >= 3:
                probs.append("Layer %s: a closed polyline with no thickness - give it a Thickness (its height)." % lay)
                continue
            else:
                mm = _mesh_of(e)
                if mm:
                    m = ([[x * k, y * k, z * k] for x, y, z in mm[0]], mm[1])
            if not m:
                continue
            # a named layer is one mass; on SBD-MASS each extrusion is its own,
            # and the faces and meshes there are one mass together
            key = name or ("#%d" % len(masses) if e.type in ("LWPOLYLINE", "POLYLINE") and not (e.i(70) & 64) else "faces")
            V, T = masses.setdefault(key, ([], []))
            o = len(V)
            V += m[0]
            T += [[a + o, b + o, c + o] for a, b, c in m[1]]
    if not sites:
        probs.insert(0, "No site boundary: draw ONE closed polyline on layer SBD-SITE.")
        return None, probs
    if len(sites) > 1:
        probs.append("%d closed polylines on SBD-SITE: the largest is the site." % len(sites))
    site = max(sites, key=lambda l: abs(S.loop_area(l)))
    if not masses:
        probs.append("No buildings: draw them on layer SBD-MASS (closed polylines with a thickness, 3D faces or meshes).")
    out_masses = []
    for i, (key, (V, T)) in enumerate(sorted(masses.items(), key=lambda kv: kv[0])):
        V, T = _weld(V, T)
        nm = key if not key.startswith("#") and key != "faces" else "Mass %d" % (i + 1)
        out_masses.append({"id": "cad-%d" % (i + 1), "name": nm, "verts": [[round(c, 4) for c in v] for v in V], "tris": T})
    sts = []
    for f in floors:
        s = S.street_from_floor(f, site)
        if s:
            sts.append(s)
        else:
            probs.append("Street %s: its slab is not a strip (two long sides and two ends) - not used." % f["name"])
    near = [f for f in floors if S.loop_gap(f["loop"], site) <= 30.0]
    if near:
        ground, src = min(f["z"] for f in near), "the street slabs"
    else:
        ground = min([min(v[2] for v in m["verts"]) for m in out_masses] or [0.0])
        src = "the masses' base"
    data = {"version": 1, "units": "m", "project": project, "model": "CAD model", "by": by, "at": "",
            "ground_z": round(ground, 4), "ground_source": src, "site": [[round(x, 4), round(y, 4)] for x, y in site],
            "masses": out_masses, "streets": sts, "street_axis": None, "corridor": None, "source": "cad"}
    return data, probs
