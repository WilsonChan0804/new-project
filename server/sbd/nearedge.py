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

from . import addin_engine as A
from .geom import FEET_TO_METERS

W = A.W
P = A.P
M = FEET_TO_METERS
FT = 1.0 / FEET_TO_METERS
REACH_FT = 1000.0          # how far past the site a band is drawn


def _site_uv(site_pts, au, av):
    return [(p.X * au.X + p.Y * au.Y, p.X * av.X + p.Y * av.Y) for p in site_pts]


def corridor_band(poly, site_uv):
    """An S2 corridor's band (u, v) ring, feet: the edge (perpendicular,
    angled, perpendicular) and its offset, past the site at both ends."""
    u1, v1, v2, t, w = poly.band[:5]
    v_lo = min(q[1] for q in site_uv) - REACH_FT
    v_hi = max(q[1] for q in site_uv) + REACH_FT

    def ue(v):
        return u1 if v <= v1 else u1 + t * (min(v, v2) - v1)
    vs = [v_lo] + [v for v in (v1, v2) if v_lo < v < v_hi] + [v_hi]
    left = [(ue(v), v) for v in vs]
    right = [(ue(v) + w, v) for v in reversed(vs)]
    return left + right


def side_band(sd, site_uv):
    """A side region's band (u, v) ring, feet: its inner edge (as the panel
    drew it), carried on at both ends, out past the boundary on its side."""
    inner = sorted(sd.get("inner_uv") or [], key=lambda q: q[1])
    if len(inner) < 2:
        return None
    poly = sd.get("region_polygon") or []
    au, av = sd["axes"]
    if not poly:
        return None
    cu = sum(p.X * au.X + p.Y * au.Y for p in poly) / len(poly)
    iu = sum(q[0] for q in inner) / len(inner)
    out = -1.0 if cu < iu else 1.0
    v_lo = min(q[1] for q in site_uv) - REACH_FT
    v_hi = max(q[1] for q in site_uv) + REACH_FT
    u_far = (min(q[0] for q in site_uv) - REACH_FT) if out < 0 else (max(q[0] for q in site_uv) + REACH_FT)

    def carry(a, b, v):
        # the edge's end segment, carried on (straight on a perpendicular leg)
        if abs(b[1] - a[1]) < 1e-9:
            return (b[0], v)
        return (b[0] + (b[0] - a[0]) / (b[1] - a[1]) * (v - b[1]), v)
    first = carry(inner[1], inner[0], v_lo) if inner[0][1] > v_lo else None
    last = carry(inner[-2], inner[-1], v_hi) if inner[-1][1] < v_hi else None
    edge = ([first] if first else []) + inner + ([last] if last else [])
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
