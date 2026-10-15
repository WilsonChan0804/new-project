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


# A template made from a project's own SBD model at shared (survey)
# coordinates carries this note, so its drawing is brought back to the
# Revit model's internal origin on import (as the masses in the 3D are).
SHARED_MARK = "LWK-SBD-FRAME: SHARED"


def frame_of(manifest):
    """The project's internal -> shared transform (the 3D export's
    lwk_frame, 3 x 4 row-major, mm) as a function of (x, y, z) metres, with
    its inverse: (fwd, inv) - or None."""
    try:
        r = [float(x) for x in ((manifest or {}).get("lwk_frame") or {}).get("internal_to_shared_mm") or []]
    except (TypeError, ValueError):
        return None
    if len(r) != 12:
        return None
    R = [r[0:3], r[4:7], r[8:11]]
    t = [r[3] / 1000.0, r[7] / 1000.0, r[11] / 1000.0]
    det = (R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
           + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]))
    if abs(det) < 1e-9:
        return None
    # the inverse of R (adjugate / det)
    I = [[(R[(j + 1) % 3][(i + 1) % 3] * R[(j + 2) % 3][(i + 2) % 3] - R[(j + 1) % 3][(i + 2) % 3] * R[(j + 2) % 3][(i + 1) % 3]) / det
          for j in range(3)] for i in range(3)]

    def fwd(x, y, z=0.0):
        return tuple(R[i][0] * x + R[i][1] * y + R[i][2] * z + t[i] for i in range(3))

    def inv(x, y, z=0.0):
        q = (x - t[0], y - t[1], z - t[2])
        return tuple(I[i][0] * q[0] + I[i][1] * q[1] + I[i][2] * q[2] for i in range(3))
    return fwd, inv


def template_dxf(model=None, frame=None, project=""):
    """The template: the layers, an example of each and the rules - or, with
    the project's SBD model, its site boundary and streets in place (at
    shared coordinates when the project's frame is known)."""
    d = Dxf()
    d.layer(SITE, 7)
    d.layer(MASS, 30)
    d.layer("SBD-NOTE", 2)
    site = (model or {}).get("site") or []
    shared = False
    if len(site) >= 3:
        # the model's own coordinates: a Revit export is on the model's
        # internal origin; a CAD model kept as drawn has no frame to undo
        to = lambda x, y, z=0.0: (x, y, z)
        if frame and (model.get("source") != "cad" or model.get("frame") == "internal"):
            to, shared = frame[0], True
        d.poly(SITE, [to(x, y)[:2] for x, y in site], closed=True)
        names = set()
        for st in model.get("streets") or []:
            ol = st.get("outline") or []
            if len(ol) < 3:
                continue
            nm = (st.get("name") or "Street").replace("/", " ")[:60]
            if nm not in names:
                d.layer(STREET + nm, 8 + len(names) % 2)
                names.add(nm)
            z = float(st.get("level") or 0.0)
            pts = [to(x, y, z) for x, y in ol]
            d.poly(STREET + nm, [p[:2] for p in pts], closed=True, elevation=round(sum(p[2] for p in pts) / len(pts), 4))
        xs = [to(x, y)[0] for x, y in site]
        ys = [to(x, y)[1] for x, y in site]
        x0, y0 = min(xs), min(ys) - 40
        rules = [
            "SBD MODEL TEMPLATE (PNAP APP-152) - LWK Viewer%s. Draw in metres, on these layers." % (" - " + project if project else ""),
            ("The site boundary and the streets are the project's own, at SHARED (survey) coordinates and levels (mPD):"
             if shared else "The site boundary and the streets are the project's own (the SBD model's coordinates):"),
            "  keep them where they are; draw the buildings around them.",
        ]
    else:
        d.layer(STREET + "Main Street", 8)
        d.layer(STREET + "Side Street", 9)
        # an example: a 60 x 40 m site on two streets, a podium and a tower
        d.poly(SITE, [(0, 0), (60, 0), (60, 40), (0, 40)], closed=True)
        d.poly(STREET + "Main Street", [(-20, -20), (80, -20), (80, 0), (-20, 0)], closed=True, elevation=0.0)
        d.poly(STREET + "Side Street", [(60, 0), (75, 0), (75, 60), (60, 60)], closed=True, elevation=0.5)
        d.poly(MASS, [(5, 5), (55, 5), (55, 35), (5, 35)], closed=True, elevation=0.0, thickness=15.0)
        d.poly(MASS, [(10, 10), (30, 10), (30, 30), (10, 30)], closed=True, elevation=15.0, thickness=65.0)
        x0, y0 = 0, -30
        rules = ["SBD MODEL TEMPLATE (PNAP APP-152) - LWK Viewer. Draw in metres, on these layers; delete the example."]
    rules += [
        "SBD-SITE: the site boundary, ONE closed polyline.",
        "SBD-STREET-<street name>: each street's slab as a closed polyline, its ELEVATION = the street's mean level.",
        "  One layer per street: SBD-STREET-Main Street, SBD-STREET-Side Street ... (the name after the dash is used).",
        "  Draw the slab from the site boundary to the far side of the street (the opposite site boundary).",
        "SBD-MASS (or SBD-MASS-<name>): the buildings - closed polylines with ELEVATION (base) and THICKNESS (height),",
        "  stacked for a podium and a tower; or 3D faces, polyface meshes or MESH. 3DSOLID: CONVTOMESH first.",
        "Explode blocks. Level 0 is the lowest street abutting the site. Then: Viewer > 3D > Checks > SBD > Import CAD model.",
    ]
    if shared:
        rules.append(SHARED_MARK + " (keep this note: the drawing is brought back to the Revit model's origin on import)")
    for i, t in enumerate(rules):
        d.text("SBD-NOTE", (x0, y0 - i * 2.2), 1.2, t)
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


def read_model(doc, project="", by="", frame=None):
    """A DXF (cad_dxf.read) -> (sbd.json dict, [problems]). frame: the
    project's (internal -> shared, back) transforms (frame_of): a drawing
    from a template at shared coordinates is brought back with it."""
    probs = []
    marked = False
    units = int(float(doc.hv("$INSUNITS", default="6") or 6))
    k = UNIT_SCALE.get(units, 1.0)
    sites, floors, masses = [], [], {}
    for e in doc.model_ents():
        lay = (e.get(8) or "").strip()
        up = lay.upper()
        if not up.startswith("SBD-"):
            continue
        if e.type in ("TEXT", "MTEXT") and SHARED_MARK in (e.get(1) or ""):
            marked = True
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
    back = None
    if marked and frame:
        back = frame[1]
    elif marked:
        probs.append("The drawing is at shared coordinates, but this project's 3D (its Revit export) is not here "
                     "to bring it back to the model's origin: kept as drawn.")
    if back:
        sites = [[back(x, y)[:2] for x, y in l] for l in sites]
        for f in floors:
            q = [back(x, y, f["z"]) for x, y in f["loop"]]
            f["loop"] = [p[:2] for p in q]
            f["z"] = sum(p[2] for p in q) / len(q)
        for key in list(masses):
            V, T = masses[key]
            masses[key] = ([list(back(*v)) for v in V], T)
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
    if back:
        data["frame"] = "internal"         # as a Revit export: on the model's origin
    return data, probs
