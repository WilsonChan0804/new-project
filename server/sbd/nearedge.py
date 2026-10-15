# -*- coding: utf-8 -*-
"""What the projection plane sees at the site's near edge.

The air gaps (S1 side regions, S2 corridors, any other gap's strip) are
bands across the site. Walking the edge of the site nearest the plane (the
street side), each stretch is either in a gap or between gaps - a building
group's "shadow". These are the widths the deformed elevation is laid out
with (the SBD panel's boundary_partition): a corridor that bends makes the
shadows beside it wider or narrower than the buildings themselves.

Also here: each band as a polygon running past the site, for the plan to
draw clipped to the site, so a hatch always reaches the boundary.
"""

import math

from . import addin_engine as A
from .geom import FEET_TO_METERS

W = A.W
P = A.P
M = FEET_TO_METERS
FT = 1.0 / FEET_TO_METERS
REACH_FT = 1000.0          # how far past the site a band is drawn


def _site_uv(site_pts, au, av):
    return [(p.X * au.X + p.Y * au.Y, p.X * av.X + p.Y * av.Y) for p in site_pts]


def _inside(u, v, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        ui, vi = ring[i]
        uj, vj = ring[j]
        if (vi > v) != (vj > v) and u < (uj - ui) * (v - vi) / ((vj - vi) or 1e-12) + ui:
            inside = not inside
        j = i
    return inside


def _reach(site_uv, v0, v1, mid):
    """How far the band runs beyond the drawn region [v0, v1] before it
    first leaves the site (its middle line mid(v)), at most 30 m each way:
    the hatch reaches the boundary, and a separate piece of the site
    further on (past a notch) is not drawn."""
    step, top = 0.5, 30.0 * FT
    lo = v0
    while v0 - lo < top and _inside(mid(lo - step), lo - step, site_uv):
        lo -= step
    hi = v1
    while hi - v1 < top and _inside(mid(hi + step), hi + step, site_uv):
        hi += step
    return lo - step, hi + step


def _vrange(poly, au, av):
    vs = [p.X * av.X + p.Y * av.Y for p in poly or []]
    return (min(vs), max(vs)) if vs else (None, None)


def corridor_edges(band):
    """A corridor's two edges as functions of v (feet): the near edge
    (perpendicular, angled, perpendicular) and the far edge - the near edge
    offset by the width ALONG ITS NORMAL, as the panel measures it, mitred at
    the bends: so the corridor is as wide where it turns as elsewhere.
    -> (ue, uf, breaks)."""
    u1, v1, v2, t, w, au, av = band

    def ue(v):
        return u1 if v <= v1 else u1 + t * (min(v, v2) - v1)
    if abs(t) < 1e-12 or v2 <= v1 + 1e-9:
        return ue, (lambda v: ue(v) + w), []
    k = math.sqrt(1.0 + t * t)
    m1 = v1 - w * (k - 1.0) / t          # where the far edge turns (the mitres)
    m2 = v2 - w * (k - 1.0) / t
    ua = lambda v: u1 + t * (v - v1) + w * k

    def uf(v):
        if v <= m1:
            return u1 + w
        if v >= m2:
            return ue(v2) + w
        return ua(v)
    return ue, uf, [m1, m2]


def corridor_band(poly, site_uv):
    """An S2 corridor's band (u, v) ring, feet: its two edges, each on to
    where it leaves the site, past the site (the near-edge partition)."""
    u1, v1, v2, t, w, au, av = poly.band
    ue, uf, ms = corridor_edges(poly.band)
    p0, p1 = _vrange(poly, au, av)
    if p0 is None:
        p0, p1 = min(q[1] for q in site_uv), max(q[1] for q in site_uv)
    # each edge on to its own first exit (with a sloping boundary the two
    # edges leave the site at different depths): both corners on the boundary
    inset = 0.02 * (1 if w > 0 else -1)
    a_lo, a_hi = _reach(site_uv, p0, p1, lambda v: ue(v) + inset)
    b_lo, b_hi = _reach(site_uv, p0, p1, lambda v: uf(v) - inset)
    va = [a_lo] + [v for v in (v1, v2) if a_lo < v < a_hi] + [a_hi]
    vb = [b_lo] + [v for v in ms if b_lo < v < b_hi] + [b_hi]
    left = [(ue(v), v) for v in va]
    right = [(uf(v), v) for v in reversed(vb)]
    return left + right


def corridor_ring(poly, site_uv):
    """The corridor as drawn: between its two edges and inside the site (the
    piece the panel found it in), exactly - its ends on the boundary. (u, v)
    ring, feet, or None."""
    from .sideregion import _spans
    u1, v1, v2, t, w, au, av = poly.band
    ue, uf, ms = corridor_edges(poly.band)
    p0, p1 = _vrange(poly, au, av)
    if p0 is None:
        return None
    lo_e = lambda v: min(ue(v), uf(v))
    hi_e = lambda v: max(ue(v), uf(v))
    vs = {p0, p1, v1, v2} | set(ms)
    from .sideregion import _cross
    k = math.sqrt(1.0 + t * t)
    pieces = [(u1, v1, 0.0), (u1, v1, t), (ue(v2), v2, 0.0), (u1 + w, v1, 0.0), (u1 + w * k, v1, t), (ue(v2) + w, v2, 0.0)]
    for a_, b_ in zip(site_uv, site_uv[1:] + site_uv[:1]):
        vs.add(a_[1])
        # where each edge line crosses this boundary edge: the ends' corners
        for pc in pieces:
            c = _cross(pc, a_, b_)
            if c is not None:
                vs.add(c)
    # the crossings: bisect each station gap where an end changes side
    vlo, vhi = min(q[1] for q in site_uv), max(q[1] for q in site_uv)
    base = sorted(v for v in vs if vlo - 1e-9 <= v <= vhi + 1e-9)
    dense = []
    for a, b in zip(base, base[1:]):
        n = max(1, int((b - a) / 2.0))
        dense += [a + (b - a) * i / n for i in range(n)]
    dense.append(base[-1])

    def iv(v):
        sp = _spans(site_uv, v)
        a, b = lo_e(v), hi_e(v)
        m = (a + b) / 2.0
        for s0, s1 in sp:
            if s0 - 1e-6 <= m <= s1 + 1e-6 or (s0 < b and s1 > a):
                lo, hi = max(a, s0), min(b, s1)
                if hi - lo > 1e-3:
                    return lo, hi
        return None
    runs, cur = [], []
    for v in dense:
        r = iv(v)
        if r:
            cur.append((v, r))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    if not runs:
        return None
    mid = (p0 + p1) / 2.0
    run = min(runs, key=lambda r: 0 if r[0][0] <= mid <= r[-1][0] else min(abs(r[0][0] - mid), abs(r[-1][0] - mid)))
    left = [(r[0], v) for v, r in run]
    right = [(r[1], v) for v, r in reversed(run)]
    return left + right


def side_edge(sd, v_lo, v_hi):
    """A side region's inner edge, (u, v) feet, from the engine's own
    choice (u1, v1, tan): perpendicular, then turned once (<= 15 deg) to the
    end - or None when it was not kept."""
    e = sd.get("edge_param")
    if not e:
        return None
    u1, v1, t = e
    ue = lambda v: u1 if v <= v1 else u1 + t * (v - v1)
    vs = [v_lo] + ([v1] if v_lo < v1 < v_hi else []) + [v_hi]
    return [(ue(v), v) for v in vs], ue


def side_band(sd, site_uv):
    """A side region's band (u, v) ring, feet: its inner edge, out past the
    boundary on its side, from where it leaves the site to where it leaves
    it again (a separate piece further on is not part of it)."""
    poly = sd.get("region_polygon") or []
    if not poly:
        return None
    au, av = sd["axes"]
    p0, p1 = _vrange(poly, au, av)
    cu = sum(p.X * au.X + p.Y * au.Y for p in poly) / len(poly)
    got = side_edge(sd, p0, p1)
    if got:
        ue = got[1]
    else:
        inner = sorted(sd.get("inner_uv") or [], key=lambda q: q[1])
        if len(inner) < 2:
            return None
        ue = lambda v: min(inner, key=lambda q: abs(q[1] - v))[0]
    iu = ue((p0 + p1) / 2.0)
    out = {"left": -1.0, "right": 1.0}.get(sd.get("side")) or (-1.0 if cu < iu else 1.0)
    v_lo, v_hi = _reach(site_uv, p0, p1, lambda v: ue(v) + out * 1.0)
    edge = side_edge(sd, v_lo, v_hi)[0] if got else [(ue(v_lo), v_lo), (ue(v_hi), v_hi)]
    u_far = (min(q[0] for q in site_uv) - REACH_FT) if out < 0 else (max(q[0] for q in site_uv) + REACH_FT)
    return edge + [(u_far, edge[-1][1]), (u_far, edge[0][1])]


def strip_band(lo, hi, site_uv):
    v_lo = min(q[1] for q in site_uv) - REACH_FT
    v_hi = max(q[1] for q in site_uv) + REACH_FT
    return [(lo, v_lo), (hi, v_lo), (hi, v_hi), (lo, v_hi)]


def to_xy_m(ring, au, av):
    return [[round((u * au.X + v * av.X) * M, 3), round((u * au.Y + v * av.Y) * M, 3)] for u, v in ring]


def near_side(site_pts, au, av, streets):
    """True when the near edge (the street's side) is the low-v side; None
    when there is no street to say."""
    pts = [q for s in streets or [] for q in (s.get("centreline") or [])]
    if not pts:
        return None
    sv = [(p.X * av.X + p.Y * av.Y) for p in site_pts]
    st = sum((q[0] * FT) * av.X + (q[1] * FT) * av.Y for q in pts) / len(pts)
    if min(sv) <= st <= max(sv):
        return None          # the street runs across this plane, not along it
    return st < min(sv)


def partition(site_pts, bands, au, av, low, blocked_ft=0.0):
    """(near_is_low_v, gap_runs, group_runs) on the near edge, feet.

    The street's side when there is one. Otherwise (a plane turned off the
    street) the side giving the WIDER shadows - the cautious one: where the
    gap bands lean together they can meet at one edge and hide a building's
    shadow altogether. A side whose shadows add up to under half the
    buildings' own projected width (blocked_ft) is not used if the other
    side does better."""
    polys = [[W.uv_to_point(u, v, au, av) for u, v in b] if b else None for b in bands]
    found = {}
    for side in (True, False):
        try:
            gr, pr = W.boundary_partition(site_pts, polys, au, av, near_is_low_v=side)
        except Exception:
            continue
        found[side] = (sum(b - a for a, b in pr), gr, pr)
    if not found:
        return low if low is not None else True, [], []
    ok = lambda sd: sd in found and found[sd][0] >= 0.5 * blocked_ft - 1e-6
    if low is not None and (ok(low) or not any(ok(sd) for sd in found)):
        side = low if low in found else next(iter(found))
    else:
        side = max(found, key=lambda sd: found[sd][0])
    return side, found[side][1], found[side][2]
