# -*- coding: utf-8 -*-
"""Zone footprints from 3D masses.

A mass is a closed triangle mesh (metres). Its footprint in a height band
[z0, z1] is the plan outline of the part of it inside the band. It is taken
as the horizontal sections of the mesh at the heights where its shape can
change (each vertex height inside the band, just above and below, and the
band's limits): for flat-faced masses (extrusions, set-backs, podium +
tower) these sections are its exact outlines at those heights, and their
union is its footprint in the band.

The sections are kept as separate loops - no polygon union is needed: the
permeability engine projects every loop onto the axis (so overlapping loops
of one building merge into one blocked interval) and measures separating
distances between the loops on either side of a gap (the nearest pair).
Loops of identical outline (the same shape on many floors) are kept once.
"""

import math

EPS_Z = 1e-4          # just above / below a vertex height (m)
KEY = 1e6             # point identity: 1 micrometre
MAX_SECTIONS = 80     # per mass per band


def _section(verts, tris, z):
    """The closed loops of the mesh cut by the plane at height z: [[(x, y)]]."""
    segs = []
    for (i, j, k) in tris:
        pts = []
        for a, b in ((i, j), (j, k), (k, i)):
            za, zb = verts[a][2], verts[b][2]
            if (za < z) == (zb < z):
                continue
            lo, hi = (a, b) if a < b else (b, a)     # the same point for a shared edge
            pl, ph = verts[lo], verts[hi]
            t = (z - pl[2]) / (ph[2] - pl[2])
            pts.append((pl[0] + (ph[0] - pl[0]) * t, pl[1] + (ph[1] - pl[1]) * t))
        if len(pts) == 2:
            segs.append(pts)
    if not segs:
        return []
    key = lambda p: (int(round(p[0] * KEY)), int(round(p[1] * KEY)))
    nbr = {}
    for n, (p, q) in enumerate(segs):
        nbr.setdefault(key(p), []).append((n, 0))
        nbr.setdefault(key(q), []).append((n, 1))
    used = [False] * len(segs)
    loops = []
    for start in range(len(segs)):
        if used[start]:
            continue
        used[start] = True
        loop = [segs[start][0], segs[start][1]]
        first = key(loop[0])
        cur = key(loop[-1])
        while cur != first:
            nxt = None
            for (n, end) in nbr.get(cur, []):
                if not used[n]:
                    nxt = (n, end)
                    break
            if nxt is None:
                break
            n, end = nxt
            used[n] = True
            p = segs[n][1 - end]
            loop.append(p)
            cur = key(p)
        if cur == first and len(loop) >= 4:
            loops.append(simplify(loop[:-1]))
    return [l for l in loops if len(l) >= 3 and abs(area(l)) > 1e-4]


def area(loop):
    s = 0.0
    n = len(loop)
    for i in range(n):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def simplify(loop, merge=1e-3, tol=1e-4):
    """Merge points closer than 1 mm (a cut just above a corner meets the
    face's diagonal there too), then drop points on a straight run."""
    pts = []
    for p in loop:
        if not pts or math.hypot(p[0] - pts[-1][0], p[1] - pts[-1][1]) > merge:
            pts.append(p)
    while len(pts) > 1 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) <= merge:
        pts.pop()
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            base = math.hypot(c[0] - a[0], c[1] - a[1])
            cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(cross) <= tol * max(base, 1e-9):
                del pts[i]
                changed = True
                break
    return pts


def heights(verts, z0, z1):
    """The heights to cut a mass at, inside [z0, z1] (z1 None: no top)."""
    zmin = min(v[2] for v in verts)
    zmax = max(v[2] for v in verts)
    lo = max(z0, zmin)
    hi = zmax if z1 is None else min(z1, zmax)
    if hi - lo <= 2 * EPS_Z:
        return []
    cut = {lo + EPS_Z, hi - EPS_Z}
    for v in verts:
        if lo + EPS_Z < v[2] < hi - EPS_Z:
            cut.add(v[2] - EPS_Z)
            cut.add(v[2] + EPS_Z)
    cut = sorted(c for c in cut if lo < c < hi)
    if len(cut) > MAX_SECTIONS:
        step = (len(cut) - 1) / float(MAX_SECTIONS - 1)
        cut = [cut[int(round(i * step))] for i in range(MAX_SECTIONS)]
    return cut


def _sig(loop):
    pts = sorted((round(x, 3), round(y, 3)) for x, y in loop)
    return tuple(pts)


def mass_footprints(mass, z0, z1):
    """[{"loop": [(x, y)], "z": height}] of one mass in the band."""
    verts = mass["verts"]
    tris = mass["tris"]
    if not verts or not tris:
        return []
    out, seen = [], set()
    for z in heights(verts, z0, z1):
        for f in holes_removed([{"loop": l, "z": z} for l in _section(verts, tris, z)]):
            s = _sig(f["loop"])
            if s in seen:
                continue
            seen.add(s)
            out.append(f)
    return out


def point_in(x, y, loop):
    inside = False
    n = len(loop)
    j = n - 1
    for i in range(n):
        xi, yi = loop[i]
        xj, yj = loop[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def holes_removed(loops):
    """A section can have holes (a courtyard): a loop inside another loop of
    the same height cuts no gap on the plan, so it is left out. Every loop
    kept is counter-clockwise."""
    keep = []
    for i, a in enumerate(loops):
        x, y = a["loop"][0]
        depth = sum(1 for j, b in enumerate(loops) if j != i and b["z"] == a["z"] and point_in(x, y, b["loop"]))
        if depth % 2 == 0:
            lp = a["loop"] if area(a["loop"]) > 0 else list(reversed(a["loop"]))
            keep.append({"loop": lp, "z": a["z"]})
    return keep
