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


def _cl_u(cl, v, near, carry=10.0 / 0.3048):
    """The centreline's u at depth v (the crossing nearest `near`), or None.
    A centreline ending short is carried on straight up to `carry`."""
    best = None
    for (u1, v1), (u2, v2) in zip(cl, cl[1:]):
        if (v1 <= v <= v2) or (v2 <= v <= v1):
            c = u1 if abs(v2 - v1) < 1e-12 else u1 + (v - v1) * (u2 - u1) / (v2 - v1)
            if best is None or abs(c - near) < abs(best - near):
                best = c
    lo, hi = (min(p[1] for p in cl), max(p[1] for p in cl)) if cl else (0, 0)
    if best is None and len(cl) >= 2 and not (lo <= v <= hi):
        # a centreline ending just short of the frontage: its end segment
        # carried on (up to 10 m, or `carry`)
        for (u1, v1), (u2, v2) in ((cl[0], cl[1]), (cl[-1], cl[-2])):
            if abs(v2 - v1) < 1e-9 or abs(v - v1) > carry or abs(v - v1) > abs(v - v2):
                continue
            c = u1 + (v - v1) * (u2 - u1) / (v2 - v1)
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


CORNER_CARRY = 30.0 / 0.3048   # a corner round a junction: the centreline carried this far


def extension(site, cl, reach, side, outline=None, gap=None, others=None):
    """The street's part up to its centreline, beside the boundary that faces
    it: [(u, v) polygons]. A boundary edge faces the street when it is the
    site's outer limit on this side and the street is just outward of it:
    the street's slab (outline) within `gap` of it - or, with no outline,
    the centreline within `reach`. A rounded or splayed corner next to the
    frontage, round a junction, faces it too when a street's slab (this one
    or another's - `others`) is just outward of it: its part up to this
    street's centreline, carried on past its end (Wilson, TMTL496)."""
    s = 1.0 if side == "right" else -1.0
    n = len(site)
    g = gap or 0.0

    def faces(i, slabs, carry, steep, corner=False):
        a, b = site[i], site[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if abs(b[1] - a[1]) < 1e-9 or abs(b[1] - a[1]) / L < steep:
            # along the plane (no depth), or running more along u than across
            # it: the street is not across this side's outward direction
            return False
        # sampled along the edge: most of it must face the street - a short
        # jog of the boundary near a corner, or a sliver between the boundary
        # and the slab (under `gap`), is passed over (Wilson, report 7)
        good = tot = 0
        for t in (0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95):
            tot += 1
            vv = a[1] + (b[1] - a[1]) * t
            sp = _spans(site, vv)
            if not sp:
                continue
            lim = sp[-1][1] if s > 0 else sp[0][0]
            uu = a[0] + (b[0] - a[0]) * t
            if (lim - uu) * s < -1e-3 or (lim - uu) * s > max(1e-3, g):
                continue                      # not the outer limit here
            c = _cl_u(cl, vv, uu, carry)
            if c is None or (c - uu) * s <= 0:
                continue
            if slabs and corner:
                # round a corner: a street's slab somewhere between the
                # boundary and the centreline (a pavement may lie between)
                if abs(c - uu) > 1.6 * (reach + g) + CORNER_CARRY or \
                        not any(_near_poly((lim + (c - lim) * k / 8.0, vv), sl, g) for k in range(1, 9) for sl in slabs):
                    continue
            elif slabs:
                # the slab just outward of the edge, and its centreline across it
                if not any(_near_poly((lim + s * g * 0.5, vv), sl, g) for sl in slabs) or \
                        abs(c - uu) > 1.6 * (reach + g):
                    continue
            elif abs(c - uu) > reach:
                continue
            good += 1
        return good * 3 >= tot * 2
    own = [outline] if outline and len(outline) >= 3 else []
    facing = [i if faces(i, own, 10.0 / 0.3048, 0.64) else None for i in range(n)]
    # round a corner next to the frontage (an arc, a splay), towards a
    # junction: the pieces turning away still face the street - any street's
    # slab just outward, this street's centreline carried on to them
    allslabs = own + [o for o in others or [] if o and len(o) >= 3]
    if allslabs and any(f is not None for f in facing):
        grew = True
        while grew:
            grew = False
            for i in range(n):
                if facing[i] is None and (facing[i - 1] is not None or facing[(i + 1) % n] is not None) \
                        and faces(i, allslabs, CORNER_CARRY, 0.2, True):
                    facing[i] = i
                    grew = True
    # a short jog (under `gap`) between two facing edges is part of the
    # frontage: one extension, no sliver left between two
    for i in range(n):
        if facing[i] is None and facing[i - 1] is not None and facing[(i + 1) % n] is not None:
            a, b = site[i], site[(i + 1) % n]
            if math.hypot(b[0] - a[0], b[1] - a[1]) <= max(gap or 0.0, 1e-6):
                facing[i] = i
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
        if ch[-1][1] < ch[0][1]:
            ch = list(reversed(ch))           # the boundary's own order, low v first
        va, vb = min(p[1] for p in ch), max(p[1] for p in ch)
        if ch[0][1] > va:
            ch = [(ch[0][0], va)] + ch        # a jog back past the end: square it off
        if ch[-1][1] < vb:
            ch = ch + [(ch[-1][0], vb)]
        if vb - va < 1e-6:
            continue
        mid = [p for p in cl if va < p[1] < vb]
        ca, cb = _cl_u(cl, va, ch[0][0], CORNER_CARRY), _cl_u(cl, vb, ch[-1][0], CORNER_CARRY)
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


def _clip_v(poly, v_max):
    """The part of a polygon at v <= v_max (Sutherland-Hodgman)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        pin, qin = p[1] <= v_max + 1e-12, q[1] <= v_max + 1e-12
        if pin:
            out.append(p)
        if pin != qin and abs(q[1] - p[1]) > 1e-12:
            k = (v_max - p[1]) / (q[1] - p[1])
            out.append((p[0] + k * (q[0] - p[0]), v_max))
    return out


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
    # the street beside the region counts only as far as the region reaches
    # in the site: up to where its inner edge meets the site boundary, cut
    # there parallel to the plane (Wilson, TMTL496 - Plane Y along So Kwun
    # Wat Road)
    if ext:
        exits = []
        m = len(site)
        for i in range(m):
            a, b = site[i], site[(i + 1) % m]
            for k, piece in enumerate(((u1, v1, 0.0), (u1, v1, t))):
                c = _cross(piece, a, b)
                # each piece only where it applies: straight up to v1, turned after
                if c is not None and ((k == 0 and c <= v1 + 1e-9) or (k == 1 and c >= v1 - 1e-9)):
                    exits.append(c)
        far = [c for c in exits if c > v_lo + 1e-6]
        if far:
            v_exit = max(far)
            if v_exit < v_hi - 1e-6:
                ext = [q for q in (_clip_v(e, v_exit) for e in ext) if len(q) >= 3]
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
        if ends[1] < ends[0]:
            # a region tapering to a point here (a corner on the boundary)
            if ends[0] - ends[1] > 1e-4:
                return None
            m = (ends[0] + ends[1]) / 2.0
            ends = [m, m]
        return (ends[0], ends[1])

    def interval(v):
        """The (extended) site outward of the edge's line, the piece nearest
        it: from the edge where the edge stands in the site - and the whole
        piece where the edge has left the site inward of it, so the region
        runs on to the site's corner beyond the edge's exit (Wilson, report
        8). Nothing where the edge is outward of the site."""
        e = ue(v)
        sp = _merged(polys, v)
        if s > 0:
            out = [(a, b) for a, b in sp if b > e + 1e-9]
            return (max(out[0][0], e), out[0][1]) if out else None
        out = [(a, b) for a, b in sp if a < e - 1e-9]
        return (out[-1][0], min(out[-1][1], e)) if out else None

    runs, cur, last = [], None, None
    for va, vb in zip(vs, vs[1:]):
        if vb - va < 1e-9:
            continue
        im = interval((va + vb) / 2.0)
        ia, ib = _at(va, im, (va + vb) / 2.0), _at(vb, im, (va + vb) / 2.0)
        # only the middle's width decides: a piece tapering to a point at a
        # station (the edge meeting the boundary) is part of the region
        if not (ia and ib and im) or im[1] - im[0] < MIN_W:
            if cur:
                runs.append(cur)
                cur = None
            continue
        # the same piece as the segment before (they meet at this station),
        # or a separate one: a new run
        if cur is not None and (abs(last[0] - va) > 1e-9 or
                                min(last[1][1], ia[1]) < max(last[1][0], ia[0]) - 1e-6):
            runs.append(cur)
            cur = None
        last = (vb, ib)
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
    slabs = [st[2] for st in streets or [] if len(st) > 2 and st[2]]
    for st in streets or []:
        cl, reach = st[0], st[1]
        outline = st[2] if len(st) > 2 else None
        ext += extension(site, cl, reach, side, outline, 3.0 / 0.3048, [o for o in slabs if o is not outline])
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
