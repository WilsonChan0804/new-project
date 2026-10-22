# -*- coding: utf-8 -*-
"""SBD Export: the masses and the site of a model, for the SBD (PNAP APP-152)
check of the LWK Viewer (server/sbd). Revit only collects the shapes; the
assessment runs on the server, for all three height zones, from the 3D
masses - no Filled Regions to draw, no 2D picks per zone.

Writes sbd.json (metres, the model's internal coordinates):
  ground_z    the zones' ground: the chosen level's elevation
  site        the subject site boundary (a Property Line, or lines picked)
  masses      each Mass element as a triangle mesh (closed, shared points)
  street_axis a line along the street - Projection Plane X (optional)
  streets     for Case 1 (street canyon U): each street's centreline and the
              opposite site's boundary (optional)

Everything that needs Revit is imported inside the function that uses it, so
the rest (and its tests) runs without Revit.
"""

__version__ = "2026-11-29"

import math

FT_M = 0.3048
POINT_KEY_M = 1e-4         # vertices closer than 0.1 mm are one
CLOSE_TOL_M = 0.01         # a site boundary must close within 10 mm


# ----------------------------------------------------------- pure helpers

class Mesh(object):
    """Triangles with shared points (so the server can follow the edges)."""

    def __init__(self):
        self.verts = []
        self.tris = []
        self._idx = {}

    def new_part(self):
        """Points are shared within a solid only: two forms of one mass that
        touch (a tower on a podium) stay separate solids for the server."""
        self._idx = {}

    def point(self, x, y, z):
        k = (int(round(x / POINT_KEY_M)), int(round(y / POINT_KEY_M)), int(round(z / POINT_KEY_M)))
        i = self._idx.get(k)
        if i is None:
            i = len(self.verts)
            self._idx[k] = i
            self.verts.append([round(x, 4), round(y, 4), round(z, 4)])
        return i

    def tri(self, a, b, c):
        i, j, k = self.point(*a), self.point(*b), self.point(*c)
        if i != j and j != k and i != k:
            self.tris.append([i, j, k])


def chain(segments, tol=CLOSE_TOL_M):
    """Order line segments [((x, y), (x, y))] into one closed loop of points.
    -> (points, gap): gap is how far the chain is from closing (metres);
    None when the segments do not make one chain."""
    segs = [list(s) for s in segments if s and math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 1e-9]
    if not segs:
        return None, None
    loop = [segs[0][0], segs[0][1]]
    rest = segs[1:]
    while rest:
        end = loop[-1]
        best = None
        for n, s in enumerate(rest):
            for flip in (0, 1):
                p = s[flip]
                d = math.hypot(p[0] - end[0], p[1] - end[1])
                if best is None or d < best[0]:
                    best = (d, n, flip)
        d, n, flip = best
        if d > max(tol * 50, 0.5):
            return None, None              # a piece not joined to the rest
        s = rest.pop(n)
        loop.append(s[1 - flip])
    gap = math.hypot(loop[0][0] - loop[-1][0], loop[0][1] - loop[-1][1])
    if gap <= tol:
        loop.pop()
    return loop, gap


# ------------------------------------------------- streets from Floor slabs
# A street is a Floor of a type named "... Street / Road / Lane / Path ...", drawn from street
# boundary to street boundary. Its outline is a strip: two long sides and
# two short ends. The centreline is half-way between the long sides; the
# side away from the site is the opposite site's boundary (Case 1 U).

def _len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def loop_area(loop):
    s = 0.0
    n = len(loop)
    for i in range(n):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def _chain_len(ch):
    return sum(_len(ch[i], ch[i + 1]) for i in range(len(ch) - 1))


def _at(ch, s):
    """The point at arc length s along a polyline."""
    acc = 0.0
    for i in range(len(ch) - 1):
        d = _len(ch[i], ch[i + 1])
        if acc + d >= s or i == len(ch) - 2:
            t = 0.0 if d < 1e-12 else max(0.0, min(1.0, (s - acc) / d))
            return (ch[i][0] + (ch[i + 1][0] - ch[i][0]) * t, ch[i][1] + (ch[i + 1][1] - ch[i][1]) * t)
        acc += d
    return ch[-1]


def _trim_ends(a, b, width):
    """A street's end drawn as two or more edges (a kink, a rounded kerb):
    only one of them was taken as the end, the rest stayed at the start of a
    long side and swung the centreline across. A side's first pieces that
    run across the street (over 45 deg from it), up to the street's width
    in all, go to the end instead (Wilson, TMTL496)."""
    def start(a, b):
        reach = 2.0 * width
        pa, pb = _at(a, min(reach, _chain_len(a))), _at(b, min(reach, _chain_len(b)))
        m0 = ((a[0][0] + b[0][0]) / 2.0, (a[0][1] + b[0][1]) / 2.0)
        m1 = ((pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0)
        dl = _len(m0, m1)
        if dl < 1e-9:
            return a, b
        dx, dy = (m1[0] - m0[0]) / dl, (m1[1] - m0[1]) / dl
        out = []
        for side in (a, b):
            side = list(side)
            dropped = 0.0
            while len(side) > 2:
                L = _len(side[0], side[1])
                if L < 1e-9:
                    side.pop(0)
                    continue
                c = ((side[1][0] - side[0][0]) * dx + (side[1][1] - side[0][1]) * dy) / L
                if c >= math.cos(math.radians(45.0)) or dropped + L > width:
                    break
                dropped += L
                side.pop(0)
            out.append(side)
        return out[0], out[1]
    if width <= 0:
        return a, b
    a, b = start(a, b)
    ra, rb = start(list(reversed(a)), list(reversed(b)))
    return list(reversed(ra)), list(reversed(rb))


def strip_sides(loop):
    """The two long sides of a strip outline -> (side_a, side_b), both
    running from the same end to the other; None when it is not a strip.
    The ends are the two short edges whose middles are farthest apart."""
    n = len(loop)
    if n < 4:
        return None
    per = sum(_len(loop[i], loop[(i + 1) % n]) for i in range(n))
    width = 2.0 * abs(loop_area(loop)) / max(per, 1e-9)          # about the street's width
    # an end is about as long as the street is wide (not a short piece of a
    # curved side)
    short = [i for i in range(n) if 0.4 * width <= _len(loop[i], loop[(i + 1) % n]) <= max(3.0 * width, 1e-6)]
    best = None
    for a in short:
        for b in short:
            if b <= a or (b - a) % n in (1, n - 1):
                continue
            ma = ((loop[a][0] + loop[(a + 1) % n][0]) / 2, (loop[a][1] + loop[(a + 1) % n][1]) / 2)
            mb = ((loop[b][0] + loop[(b + 1) % n][0]) / 2, (loop[b][1] + loop[(b + 1) % n][1]) / 2)
            d = _len(ma, mb)
            if best is None or d > best[0]:
                best = (d, a, b)
    if best is None:
        return None
    _, a, b = best
    # side A: after end a up to end b; side B: after end b back to end a, reversed
    side_a = [loop[(a + 1 + k) % n] for k in range((b - a) % n)]
    side_b = [loop[(b + 1 + k) % n] for k in range((a - b) % n)]
    side_b.reverse()
    if len(side_a) < 2 or len(side_b) < 2:
        return None
    side_a, side_b = _trim_ends(side_a, side_b, width)
    return side_a, side_b


def strip_centreline(loop, step=1.0):
    """The centreline of a street outline: half-way between its long sides,
    every `step` metres -> (centreline, side_a, side_b) or None."""
    sides = strip_sides(loop)
    if not sides:
        return None
    a, b = sides
    la, lb = _chain_len(a), _chain_len(b)
    n = max(2, int(math.ceil(max(la, lb) / step)) + 1)
    cl = []
    for i in range(n):
        t = i / float(n - 1)
        p, q = _at(a, t * la), _at(b, t * lb)
        cl.append(((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0))
    return cl, a, b


def near_far(side_a, side_b, site):
    """Which long side faces the site -> (near, far)."""
    def dist(ch):
        return sum(min(_len(p, s) for s in site) for p in ch) / float(len(ch))
    return (side_a, side_b) if dist(side_a) <= dist(side_b) else (side_b, side_a)


def _seg_dist(p, a, b):
    ab = (b[0] - a[0], b[1] - a[1])
    L = ab[0] * ab[0] + ab[1] * ab[1]
    t = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L))
    return _len(p, (a[0] + ab[0] * t, a[1] + ab[1] * t))


def loop_gap(a, b):
    """The smallest distance between two outlines (their points to the
    other's edges)."""
    best = float("inf")
    for P, Q in ((a, b), (b, a)):
        for p in P:
            for i in range(len(Q)):
                best = min(best, _seg_dist(p, Q[i], Q[(i + 1) % len(Q)]))
    return best


def mean_level(floors, site, reach=30.0):
    """The street level: the area-weighted mean top level of the street
    slabs within 30 m of the site (all of them when none is that near).
    floors: [{"loop", "z", "area"}] -> metres, or None."""
    near = [f for f in floors if loop_gap(f["loop"], site) <= reach] or list(floors)
    tot = sum(f["area"] for f in near)
    if not near or tot <= 0:
        return None
    return sum(f["z"] * f["area"] for f in near) / tot


MERGE_TOL_M = 0.05         # outline points closer than 50 mm are one (faces of a shape-edited ramp, slabs drawn a little apart)
TOUCH_M = 0.05             # slabs of one street closer than this are one street


def _simplify(loop, tol=0.001):
    """Drop points lying on the line between their neighbours (a long side
    cut where two faces met), so a strip's ends are whole edges again."""
    pts = list(loop)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, p, b = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            if _len(a, b) > 1e-9 and _seg_dist(p, a, b) < tol and _len(a, p) < _len(a, b) and _len(p, b) < _len(a, b):
                del pts[i]
                changed = True
                break
    return pts


def merge_outlines(loops, tol=MERGE_TOL_M):
    """One outline from pieces that share edges: the top faces of a sloped
    or shape-edited street slab, or a street drawn as several slabs. The
    edges two pieces share go; the rest is chained into loops and the
    largest is the outline -> [(x, y)] or None."""
    loops = [l for l in loops if l and len(l) >= 3]
    if not loops:
        return None
    if len(loops) == 1:
        return _simplify(loops[0])
    # one point for points closer than tol
    pts = []

    def key(p):
        for i, q in enumerate(pts):
            if abs(q[0] - p[0]) <= tol and abs(q[1] - p[1]) <= tol:
                return i
        pts.append((p[0], p[1]))
        return len(pts) - 1
    edges = []
    for l in loops:
        ids = [key(p) for p in l]
        edges += [(ids[i], ids[(i + 1) % len(ids)]) for i in range(len(ids)) if ids[i] != ids[(i + 1) % len(ids)]]
    # an edge with another piece's corner on it is cut there, so a shared
    # part of a longer edge cancels too
    cut = []
    for a, b in edges:
        on = [i for i in range(len(pts)) if i not in (a, b) and _seg_dist(pts[i], pts[a], pts[b]) <= tol]
        on.sort(key=lambda i: _len(pts[a], pts[i]))
        chainp = [a] + on + [b]
        cut += [(chainp[k], chainp[k + 1]) for k in range(len(chainp) - 1)]
    count = {}
    for a, b in cut:
        k = (min(a, b), max(a, b))
        count[k] = count.get(k, 0) + 1
    outer = [(a, b) for a, b in cut if count[(min(a, b), max(a, b))] == 1]
    # walk the remaining edges into loops
    nxt = {}
    for a, b in outer:
        nxt.setdefault(a, []).append(b)
    out = []
    used = set()
    for a, b in outer:
        if (a, b) in used:
            continue
        ring, cur, prev = [a], b, a
        used.add((a, b))
        while cur != a and len(ring) <= len(outer):
            ring.append(cur)
            cands = [n for n in nxt.get(cur, []) if (cur, n) not in used]
            if not cands:
                break
            n = cands[0]
            used.add((cur, n))
            prev, cur = cur, n
        if cur == a and len(ring) >= 3:
            out.append([pts[i] for i in ring])
    if not out:
        return None
    best = max(out, key=lambda l: abs(loop_area(l)))
    return _simplify(best)


def group_streets(slabs, touch=TOUCH_M):
    """Street slabs of one type name that touch are one street: their
    outlines merged, their level the area-weighted mean. slabs: the records
    of street_floors() -> [{"name", "loop", "z", "area", "floors", "faces",
    "pieces"}]; "pieces" keeps the slabs, for when the merged outline is not
    a strip but a slab on its own is."""
    groups = []
    for s in slabs:
        mine = [g for g in groups if g["name"] == s["name"] and any(loop_gap(p["loop"], s["loop"]) <= touch for p in g["pieces"])]
        if not mine:
            groups.append({"name": s["name"], "pieces": [s]})
            continue
        g = mine[0]
        g["pieces"].append(s)
        for o in mine[1:]:                 # this slab joins two groups
            g["pieces"] += o["pieces"]
            groups.remove(o)
    out = []
    for g in groups:
        ps = g["pieces"]
        loop = merge_outlines([p["loop"] for p in ps]) if len(ps) > 1 else ps[0]["loop"]
        area = sum(p["area"] for p in ps)
        out.append({"name": g["name"], "loop": loop or ps[0]["loop"],
                    "z": sum(p["z"] * p["area"] for p in ps) / area if area > 0 else ps[0]["z"],
                    "area": area, "floors": len(ps), "faces": sum(p.get("faces", 1) for p in ps),
                    "ids": [p.get("id") for p in ps], "pieces": ps})
    return out


def chain_strips(pieces, site):
    """One street from slabs that do not merge into one outline (they
    overlap, or a gap is left between them - a ramp beside a flat part):
    each slab's own strip, joined end to end in order. -> a street (as
    street_from_floor gives) or None when a slab is not a strip."""
    parts = []
    for p in pieces:
        r = strip_centreline(p["loop"])
        if not r:
            return None
        cl, a, b = r
        near, far = near_far(a, b, site)
        parts.append([list(cl), list(near), list(far), p])
    if not parts:
        return None

    def flip(pt):
        pt[0].reverse(); pt[1].reverse(); pt[2].reverse()
    chain = parts.pop(0)
    cl, near, far = list(chain[0]), list(chain[1]), list(chain[2])
    while parts:
        # the slab with an end nearest either end of the chain so far
        best = None
        for i, pt in enumerate(parts):
            for at_tail in (True, False):
                end = cl[-1] if at_tail else cl[0]
                for rev in (False, True):
                    start = pt[0][-1] if rev else pt[0][0]
                    if not at_tail:
                        start = pt[0][0] if rev else pt[0][-1]
                    d = _len(end, start)
                    if best is None or d < best[0]:
                        best = (d, i, at_tail, rev)
        d, i, at_tail, rev = best
        pt = parts.pop(i)
        if rev:
            flip(pt)
        if at_tail:
            # the part of the next slab overlapping the chain's end is left out
            ex, ey = cl[-1][0] - cl[-2][0], cl[-1][1] - cl[-2][1]
            keep = lambda q, base: (q[0] - base[0]) * ex + (q[1] - base[1]) * ey > 1e-6
            cl += [q for q in pt[0] if keep(q, cl[-1])]
            near += [q for q in pt[1] if keep(q, near[-1])]
            far += [q for q in pt[2] if keep(q, far[-1])]
        else:
            ex, ey = cl[0][0] - cl[1][0], cl[0][1] - cl[1][1]
            keep = lambda q, base: (q[0] - base[0]) * ex + (q[1] - base[1]) * ey > 1e-6
            cl = [q for q in pt[0] if keep(q, cl[0])] + cl
            near = [q for q in pt[1] if keep(q, near[0])] + near
            far = [q for q in pt[2] if keep(q, far[0])] + far
    rnd = lambda pts: [[round(x, 4), round(y, 4)] for x, y in pts]
    area = sum(abs(loop_area(p["loop"])) for p in pieces)
    zs = sum(p["z"] * abs(loop_area(p["loop"])) for p in pieces)
    L = _chain_len(cl)
    return {"name": pieces[0].get("name") or "Street", "centreline": rnd(cl), "opposite": rnd(far),
            "outline": rnd(near + list(reversed(far))), "level": round(zs / area if area > 0 else pieces[0]["z"], 4),
            "length_m": round(L, 2), "width_m": round(area / max(L, 1e-9), 2)}


def streets_from_slabs(slabs, site):
    """The streets of the street slabs -> (made [(group, street)], left
    [(group, reason)]). A street whose merged outline is not a strip falls
    back to its slabs one by one; those that are strips are used."""
    made, left = [], []
    for g in group_streets(slabs):
        st = street_from_floor(g, site)
        # slabs that touch but did not merge into one outline (it lost part of
        # them): joined end to end instead, so no part of the street is lost
        whole = abs(loop_area(g["loop"])) >= 0.97 * g["area"]
        if g["floors"] > 1 and not (st and whole):
            ch = chain_strips(g["pieces"], site)
            if ch:
                ch["name"] = g["name"]
                made.append((g, ch))
                continue
        if st:
            made.append((g, st))
            continue
        ok = []
        if g["floors"] > 1:
            for k, p in enumerate(g["pieces"]):
                one = street_from_floor(p, site)
                if one:
                    one["name"] = "%s (%d)" % (g["name"], len(ok) + 1)
                    ok.append((dict(p, floors=1), one))
        if ok:
            made += ok
        else:
            left.append((g, "%d floor%s, %d face%s merged, %d corners" % (
                g["floors"], "" if g["floors"] == 1 else "s", g["faces"], "" if g["faces"] == 1 else "s", len(g["loop"]))))
    return made, left


def street_from_floor(f, site):
    """A street for the export from a street slab: its centreline, its side
    away from the site (the opposite boundary) and its outline."""
    r = strip_centreline(f["loop"])
    if not r:
        return None
    cl, a, b = r
    near, far = near_far(a, b, site)
    rnd = lambda pts: [[round(x, 4), round(y, 4)] for x, y in pts]
    return {"name": f.get("name") or "Street", "centreline": rnd(cl), "opposite": rnd(far),
            "outline": rnd(f["loop"]), "level": round(f["z"], 4),
            "length_m": round(_chain_len(cl), 2), "width_m": round(abs(loop_area(f["loop"])) / max(_chain_len(cl), 1e-9), 2)}


def frontage_axis(streets, site, reach=30.0):
    """Axis 1: along the street that fronts the site the longest (the length
    of its centreline within 30 m of the site) -> [[x, y], [x, y]] or None."""
    best = None
    for s in streets:
        cl = s["centreline"]
        front = sum(_len(cl[i], cl[i + 1]) for i in range(len(cl) - 1)
                    if min(_seg_dist(cl[i], site[k], site[(k + 1) % len(site)]) for k in range(len(site))) <= reach)
        if best is None or front > best[0]:
            best = (front, s)
    if not best or best[0] <= 0:
        return None
    cl = best[1]["centreline"]
    return [cl[0], cl[-1]]


def project_choices(projects, last=None):
    """The viewer projects to choose from: (labels, ids), the one last used
    with this Revit file first and marked."""
    rows = [(p["id"], "%s - %s" % (p["id"], p.get("name") or "")) for p in projects]
    first = [r for r in rows if last and r[0] == last]
    rows = [(i, l + "   (last used with this model)") for i, l in first] + [r for r in rows if r not in first]
    return [l for _, l in rows], [i for i, _ in rows]


def build(site, masses, ground_z, street_axis=None, streets=None, project="", model="", by="", at="",
          ground_source=""):
    return {
        "version": 1, "units": "m", "project": project, "model": model, "by": by, "at": at,
        "ground_z": round(ground_z, 4), "ground_source": ground_source,
        "site": [[round(x, 4), round(y, 4)] for x, y in site],
        "masses": [{"id": m["id"], "name": m["name"], "verts": m["mesh"].verts, "tris": m["mesh"].tris} for m in masses],
        "street_axis": street_axis, "streets": streets or [], "corridor": None,
    }


# ----------------------------------------------------------------- Revit

def _xy(p):
    return (p.X * FT_M, p.Y * FT_M)


def mass_meshes(doc):
    """[{"id", "name", "mesh"}] of the model's Mass elements (in-place masses
    and Mass family instances), from their solids."""
    from Autodesk.Revit.DB import (FilteredElementCollector, BuiltInCategory, Options, ViewDetailLevel,
                                   Solid, GeometryInstance)
    opts = Options()
    opts.DetailLevel = ViewDetailLevel.Fine
    out = []
    els = FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Mass).WhereElementIsNotElementType().ToElements()
    for el in els:
        mesh = Mesh()

        def take(geo):
            for g in geo:
                if isinstance(g, Solid):
                    if g.Volume <= 1e-9:
                        continue
                    mesh.new_part()
                    for face in g.Faces:
                        m = face.Triangulate()
                        for i in range(m.NumTriangles):
                            t = m.get_Triangle(i)
                            pts = [t.get_Vertex(k) for k in range(3)]
                            mesh.tri(*[(p.X * FT_M, p.Y * FT_M, p.Z * FT_M) for p in pts])
                elif isinstance(g, GeometryInstance):
                    take(g.GetInstanceGeometry())
        geo = el.get_Geometry(opts)
        if geo is not None:
            take(geo)
        if mesh.tris:
            name = el.Name or ""
            try:
                name = (el.Symbol.FamilyName + " : " + el.Name) if hasattr(el, "Symbol") and el.Symbol else name
            except Exception:
                pass
            out.append({"id": str(el.Id.IntegerValue if hasattr(el.Id, "IntegerValue") else el.Id.Value),
                        "name": name, "mesh": mesh})
    return out


def _type_name(doc, el):
    t = doc.GetElement(el.GetTypeId())
    if t is None:
        return ""
    try:
        from Autodesk.Revit.DB import Element
        return Element.Name.__get__(t) or ""
    except Exception:
        try:
            return t.Name or ""
        except Exception:
            return ""


STREET_WORDS = ("street", "road", "lane", "path")


def is_street_type(type_name, words=STREET_WORDS):
    """A Floor type for a street: its name has street, road, lane or path in it."""
    t = (type_name or "").lower()
    return any(w in t for w in words)


def street_floors(doc, words=STREET_WORDS):
    """[{"id", "name", "loop", "z", "area", "faces"}] of the Floors whose type
    name has street, road, lane or path in it: one per Floor - the outline of
    its top (its top faces merged, metres), its mean level and its area."""
    from Autodesk.Revit.DB import FilteredElementCollector, Floor, HostObjectUtils
    out = []
    for fl in FilteredElementCollector(doc).OfClass(Floor).WhereElementIsNotElementType():
        tn = _type_name(doc, fl)
        if not is_street_type(tn, words):
            continue
        try:
            refs = HostObjectUtils.GetTopFaces(fl)
        except Exception:
            refs = []
        faces = []                 # (outline, its mean level, area) of each top face
        for ref in refs:
            face = fl.GetGeometryObjectFromReference(ref)
            if face is None:
                continue
            best = None
            for cl in face.GetEdgesAsCurveLoops():
                pts, zs = [], []
                for c in cl:
                    for p in c.Tessellate():
                        q = (p.X * FT_M, p.Y * FT_M)
                        if not pts or _len(pts[-1], q) > 1e-4:
                            pts.append(q)
                            zs.append(p.Z * FT_M)
                if len(pts) > 2 and _len(pts[0], pts[-1]) < 1e-4:
                    pts.pop()
                    zs.pop()
                if len(pts) >= 3 and (best is None or abs(loop_area(pts)) > abs(loop_area(best[0]))):
                    best = (pts, zs)
            if best:
                faces.append((best[0], sum(best[1]) / len(best[1]), abs(loop_area(best[0]))))
        if not faces:
            continue
        # a sloped or shape-edited slab has a top face per plane: one outline
        loop = faces[0][0] if len(faces) == 1 else (merge_outlines([f[0] for f in faces]) or max(faces, key=lambda f: f[2])[0])
        area = sum(f[2] for f in faces)
        out.append({"id": str(fl.Id.IntegerValue if hasattr(fl.Id, "IntegerValue") else fl.Id.Value),
                    "name": tn,            # the street's name: the Floor's type name (e.g. "Yeung Fan Lane North Street")
                    "loop": loop, "z": sum(f[1] * f[2] for f in faces) / area if area > 0 else faces[0][1],
                    "area": area, "faces": len(faces)})
    return out


def property_line_loops(doc):
    """[(name, [(x, y)], gap)] of the model's Property Lines."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, Options, Curve
    out = []
    for el in FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_SiteProperty).WhereElementIsNotElementType():
        geo = el.get_Geometry(Options())
        segs = []
        if geo is None:
            continue
        for g in geo:
            if isinstance(g, Curve):
                pts = [_xy(p) for p in g.Tessellate()]
                segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        loop, gap = chain(segs)
        if loop and len(loop) >= 3:
            out.append((el.Name or "Property Line", loop, gap))
    return out


def curves_loop(curves):
    segs = []
    for c in curves:
        pts = [_xy(p) for p in c.Tessellate()]
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    return chain(segs)


def curves_polyline(curves):
    """Picked lines in order, as one polyline (not closed)."""
    segs = []
    for c in curves:
        pts = [_xy(p) for p in c.Tessellate()]
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    loop, gap = chain(segs, tol=-1)
    return loop
