# -*- coding: utf-8 -*-
"""Streets from their slab outlines: the centreline half-way between the
long sides, the side away from the site (the opposite boundary), the width
- the same as the Revit add-in's SBD Export (revit/.../sbd_export.py), for
a model drawn in CAD (cadmodel.py). Metres; standard library only."""

import math


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
