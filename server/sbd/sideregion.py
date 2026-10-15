# -*- coding: utf-8 -*-
"""A side region (S at a facade's end, APP-152 Fig B16), worked out exactly.

In the plane's frame (u along the plane, v away from it - the plane on the
low-v side): the region on one side ("left" = low u, "right" = high u) lies
between an inner edge and the site's outer boundary on that side.

  the inner edge   perpendicular to the plane, then turned once (<= 15 deg)
                   on to the end; it may not cut a building (the panel's
                   candidate edges: through the outer building corners, and
                   corner to corner clamped to 15 deg);
  the outer bound  the site boundary - and where the boundary there faces a
                   street (not a common boundary), the street up to its
                   centreline, between lines through the frontage's two
                   corners PARALLEL to the plane (constant v);
  the region       the piece NEAREST the plane (the region's first run from
                   the plane; a piece under 1 m deep is passed over).

S = A / D: the region's area over its depth across the plane. Among the
candidate edges the largest area wins (as the SBD panel).

The geometry is exact: the region is evaluated at every depth where
anything changes - the boundary's corners, the buildings' corners, the
edge's bend and where the edge crosses the boundary - and is straight
between, so its corners lie on the boundary.

Units: feet (the panel's), (u, v) tuples.
"""

import math

TAN_MAX = math.tan(math.radians(15.0))
MIN_W = 0.05             # ft: narrower is no region
MIN_RUN = 1.0 / 0.3048   # a piece under 1 m deep is passed over
EPS = 1e-7


def _spans(poly, v):
    """Inside u-intervals of a polygon at depth v (even-odd)."""
    xs = []
    n = len(poly)
    for i in range(n):
        (u1, v1), (u2, v2) = poly[i], poly[(i + 1) % n]
        if (v1 > v) != (v2 > v):
            xs.append(u1 + (v - v1) * (u2 - u1) / (v2 - v1))
    xs.sort()
    return [(xs[k], xs[k + 1]) for k in range(0, len(xs) - 1, 2)]


def _merged(polys, v, tol=1e-6):
    iv = sorted(s for p in polys for s in _spans(p, v))
    out = []
    for a, b in iv:
        if out and a <= out[-1][1] + tol:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _cl_u(cl, v, near):
    """The centreline's u at depth v (the crossing nearest `near`), or None."""
    best = None
    for (u1, v1), (u2, v2) in zip(cl, cl[1:]):
        if (v1 <= v <= v2) or (v2 <= v <= v1):
            c = u1 if abs(v2 - v1) < 1e-12 else u1 + (v - v1) * (u2 - u1) / (v2 - v1)
            if best is None or abs(c - near) < abs(best - near):
                best = c
    return best


def _near_poly(q, poly, tol):
    """q inside the polygon, or within tol of its outline."""
    inside = False
    n = len(poly)
    for i in range(n):
        (u1, v1), (u2, v2) = poly[i], poly[(i + 1) % n]
        if (v1 > q[1]) != (v2 > q[1]) and q[0] < u1 + (q[1] - v1) * (u2 - u1) / (v2 - v1):
            inside = not inside
    if inside:
        return True
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        k = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2))
        if math.hypot(q[0] - a[0] - k * dx, q[1] - a[1] - k * dy) <= tol:
            return True
    return False


def extension(site, cl, reach, side, outline=None, gap=None):
    """The street's part up to its centreline, beside the boundary that faces
    it: [(u, v) polygons]. A boundary edge faces the street when it is the
    site's outer limit on this side and the street is just outward of it:
    the street's slab (outline) within `gap` of it - or, with no outline,
    the centreline within `reach`."""
    """The street's part up to its centreline, beside the boundary that faces
    it: [(u, v) polygons]. A boundary edge faces the street when it is the
    site's outer limit on this side and the centreline is outward of it
    within `reach` (half the street's width + 3 m)."""
    s = 1.0 if side == "right" else -1.0
    n = len(site)
    facing = []
    for i in range(n):
        a, b = site[i], site[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if abs(b[1] - a[1]) < 1e-9 or abs(b[1] - a[1]) / L < 0.64:
            # along the plane (no depth), or running more along u than across
            # it: the street is not across this side's outward direction
            facing.append(None)
            continue
        ok = True
        for t in (0.0, 0.5, 1.0):
            u = a[0] + (b[0] - a[0]) * t
            v = a[1] + (b[1] - a[1]) * t
            vv = v + (1e-4 if t == 0.0 else -1e-4 if t == 1.0 else 0.0) * (1 if b[1] > a[1] else -1)
            sp = _spans(site, vv)
            if not sp:
                ok = False
                break
            lim = sp[-1][1] if s > 0 else sp[0][0]
            uu = a[0] + (b[0] - a[0]) * ((vv - a[1]) / (b[1] - a[1]))
            if abs(uu - lim) > 1e-3:
                ok = False
                break
            c = _cl_u(cl, vv, uu)
            if c is None or (c - uu) * s <= 0:
                ok = False
                break
            if outline and len(outline) >= 3:
                # the slab just outward of the edge, and its centreline across it
                if not _near_poly((uu + s * (gap or 0.0) * 0.5, vv), outline, gap or 0.0) or \
                        abs(c - uu) > 1.6 * (reach + (gap or 0.0)):
                    ok = False
                    break
            elif abs(c - uu) > reach:
                ok = False
                break
        facing.append(i if ok else None)
    # contiguous facing edges -> chains of site points
    chains, cur = [], []
    for k in range(n + 1):
        i = k % n
        f = facing[i] if k < n else None
        if f is not None:
            if not cur:
                cur = [site[i]]
            cur.append(site[(i + 1) % n])
        elif cur:
            chains.append(cur)
            cur = []
    # a chain wrapping round the polygon's start
    if len(chains) >= 2 and facing[0] is not None and facing[-1] is not None:
        chains[0] = chains[-1][:-1] + chains[0]
        chains.pop()
    out = []
    for ch in chains:
        ch = sorted(ch, key=lambda p: p[1])
        va, vb = ch[0][1], ch[-1][1]
        if vb - va < 1e-6:
            continue
        mid = [p for p in cl if va < p[1] < vb]
        ca, cb = _cl_u(cl, va, ch[0][0]), _cl_u(cl, vb, ch[-1][0])
        if ca is None or cb is None:
            continue
        far = [(ca, va)] + sorted(mid, key=lambda p: p[1]) + [(cb, vb)]
        out.append(ch + list(reversed(far)))
    return out


def _cross(edge_piece, a, b):
    """v where a segment a-b crosses the line u = u0 + t (v - v0)."""
    u0, v0, t = edge_piece
    du, dv = b[0] - a[0], b[1] - a[1]
    # a + k (b - a): a.u + k du = u0 + t (a.v + k dv - v0)
    den = du - t * dv
    if abs(den) < 1e-12:
        return None
    k = (u0 + t * (a[1] - v0) - a[0]) / den
    if -1e-9 <= k <= 1 + 1e-9:
        return a[1] + k * dv
    return None


def region(site, ext, hulls, side, edge, v_lo, v_hi):
    """The region for one inner edge (u1, v1, t): (area, depth, inner chain,
    outer chain) of the run nearest the plane, or None (no region, or the
    edge cuts a building)."""
    u1, v1, t = edge
    s = 1.0 if side == "right" else -1.0
    ue = lambda v: u1 if v <= v1 else u1 + t * (v - v1)
    # a building may not poke outward past the edge
    for h in hulls:
        for q in h:
            if (q[0] - ue(q[1])) * s > 0.05:
                return None
        for a, b in _spans(h, v1) if v_lo < v1 < v_hi else []:
            if ((b if s > 0 else a) - ue(v1)) * s > 0.05:
                return None
    polys = [site] + list(ext)
    vs = {v_lo, v_hi}
    if v_lo < v1 < v_hi:
        vs.add(v1)
    for p in polys:
        m = len(p)
        for i in range(m):
            a, b = p[i], p[(i + 1) % m]
            vs.add(a[1])
            for piece in ((u1, v1, 0.0), (u1, v1, t)):
                c = _cross(piece, a, b)
                if c is not None:
                    vs.add(c)
    for h in hulls:
        for q in h:
            vs.add(q[1])
    vs = sorted(v for v in vs if v_lo - 1e-9 <= v <= v_hi + 1e-9)

    def _at(v, im, vm):
        """The interval at a station, on the same branch as the segment's
        middle: its ends followed exactly to the station (the edge, or the
        boundary edge the end lies on)."""
        if not im:
            return None
        e = ue(v)
        # each end: the edge itself, or a boundary edge through the middle's end
        ends = []
        for x in im:
            if abs(x - ue(vm)) < 1e-9:
                ends.append(e)
                continue
            got = None
            for p in polys:
                m = len(p)
                for i in range(m):
                    a, b = p[i], p[(i + 1) % m]
                    if (a[1] - vm) * (b[1] - vm) > 0 or abs(b[1] - a[1]) < 1e-12:
                        continue
                    um = a[0] + (vm - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                    if abs(um - x) < 1e-6:
                        got = a[0] + (v - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                        break
                if got is not None:
                    break
            ends.append(got if got is not None else x)
        return (ends[0], ends[1]) if ends[1] >= ends[0] else None

    def interval(v):
        """From the edge to the outer limit of the piece of the (extended)
        site the edge stands in - nothing where the edge is outside it, and
        never a separate piece further out."""
        e = ue(v)
        for a, b in _merged(polys, v):
            if a - 1e-9 <= e <= b + 1e-9:
                return (e, b) if s > 0 else (a, e)
        return None

    runs, cur = [], None
    for va, vb in zip(vs, vs[1:]):
        if vb - va < 1e-9:
            continue
        im = interval((va + vb) / 2.0)
        ia, ib = _at(va, im, (va + vb) / 2.0), _at(vb, im, (va + vb) / 2.0)
        if not (ia and ib and im) or min(ia[1] - ia[0], ib[1] - ib[0], im[1] - im[0]) < MIN_W:
            if cur:
                runs.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"area": 0.0, "v0": va, "v1": vb, "inner": [], "outer": []}
        cur["area"] += ((ia[1] - ia[0]) + (ib[1] - ib[0])) / 2.0 * (vb - va)
        cur["v1"] = vb
        inner = (lambda iv: iv[0]) if s > 0 else (lambda iv: iv[1])
        outer = (lambda iv: iv[1]) if s > 0 else (lambda iv: iv[0])
        for v, iv in ((va, ia), (vb, ib)):
            cur["inner"].append((inner(iv), v))
            cur["outer"].append((outer(iv), v))
    if cur:
        runs.append(cur)
    runs = [r for r in runs if r["v1"] - r["v0"] >= MIN_RUN]
    if not runs:
        return None
    r = min(runs, key=lambda r: r["v0"])            # the piece nearest the plane
    return r["area"], r["v1"] - r["v0"], _clean(r["inner"]), _clean(r["outer"])


def _clean(chain):
    out = []
    for p in chain:
        if out and abs(p[0] - out[-1][0]) < 1e-6 and abs(p[1] - out[-1][1]) < 1e-6:
            continue
        out.append(p)
    # drop points on a straight line
    k = 1
    while k < len(out) - 1:
        a, b, c = out[k - 1], out[k], out[k + 1]
        cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(cr) < 1e-6 * max(1.0, math.hypot(c[0] - a[0], c[1] - a[1])):
            del out[k]
        else:
            k += 1
    return out


def candidates(hulls, side, v_lo):
    """The inner edges to try, (u1, v1, t): perpendicular to the plane through
    each outer corner; and perpendicular from the plane up to a corner, then
    turned there towards another corner further from the plane (clamped to
    15 deg) - the edge always starts square to the plane and turns once."""
    s = 1.0 if side == "right" else -1.0
    corners = [q for h in hulls for q in h]
    # the outward silhouette: a corner nothing lies beyond at its depth
    sil = []
    for q in corners:
        if not any((o[0] - q[0]) * s > 0.05 and abs(o[1] - q[1]) < 1e-6 for o in corners):
            sil.append(q)
    out = set()
    for c1 in sil:
        out.add((round(c1[0], 6), round(v_lo, 6), 0.0))
        for c2 in sil:
            if c2[1] <= c1[1] + 1e-6:
                continue                      # turn at c1 towards a corner beyond it
            t = max(-TAN_MAX, min(TAN_MAX, (c2[0] - c1[0]) / (c2[1] - c1[1])))
            out.add((round(c1[0], 6), round(c1[1], 6), round(t, 9)))
    return sorted(out)


def side_region(site, hulls, side, streets=None):
    """The side region: dict with area_ft2, D_ft, S_ft, angle_deg, edge
    (u1, v1, t), inner, outer (u, v chains), polygon (u, v ring), to_cl -
    or None. site: [(u, v)]; hulls: [[(u, v)]] the buildings' convex hulls;
    streets: [(centreline [(u, v)], reach ft)] beside this side."""
    v_lo = min(p[1] for p in site)
    v_hi = max(p[1] for p in site)
    ext = []
    for st in streets or []:
        cl, reach = st[0], st[1]
        outline = st[2] if len(st) > 2 else None
        ext += extension(site, cl, reach, side, outline, 3.0 / 0.3048)
    best = None
    for e in candidates(hulls, side, v_lo):
        r = region(site, ext, hulls, side, e, v_lo, v_hi)
        if not r:
            continue
        # the largest area; of equal ones, the smaller turn
        if best is None or r[0] > best[1][0] * (1 + 1e-9) + 1e-9 or \
                (abs(r[0] - best[1][0]) <= 1e-9 * max(1.0, r[0]) and abs(e[2]) < abs(best[0][2])):
            best = (e, r)
    if not best:
        return None
    e, (area, depth, inner, outer) = best
    # an edge whose turn comes after the region ends is straight in it
    if inner and e[1] >= max(p[1] for p in inner) - 1e-6:
        e = (e[0], e[1], 0.0)
    ring = inner + list(reversed(outer))
    to_cl = False
    if ext:
        lim = [max(_spans(site, v), key=lambda q: q[1])[1] if side == "right" else min(_spans(site, v))[0]
               for _, v in outer if _spans(site, v)]
        to_cl = any(abs(u - l) > 0.1 for (u, _), l in zip(outer, lim))
    return {"area_ft2": area, "D_ft": depth, "S_ft": area / depth if depth > 1e-9 else 0.0,
            "angle_deg": math.degrees(math.atan(e[2])), "edge": e, "inner": inner, "outer": outer,
            "polygon": ring, "to_cl": to_cl, "ext": ext}
