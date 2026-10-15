# -*- coding: utf-8 -*-
"""The SBD panel's engine (addin/, unchanged) for one zone, with:

  - Plane X of the Middle and High zones searched to the degree (the panel
    tries every 30 deg; here 15 deg steps, then 3 deg, then 1 deg round the
    best), Plane Y at 75-105 deg from X in every zone (the panel's
    optimize_plane_y);
  - the S1 side regions' working (Area / Depth) kept for the plan;
  - S1 / S3 passed 1 mm short of 7.5 m (the area / depth arithmetic).

Revit's XYZ and Line are the stand-ins in addin/Autodesk/Revit/DB.py; the
panel's console output is kept as the run's log.
"""

import contextlib
import io
import os
import sys

_ADDIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "addin")
if _ADDIN not in sys.path:
    sys.path.insert(0, _ADDIN)

_LOG = io.StringIO()
with contextlib.redirect_stdout(_LOG):
    import sbd_permeability as P          # noqa: E402
    import sbd_wind_corridor as W         # noqa: E402
    from sbd_geom_separation import rotate_axis_xy   # noqa: E402

ZONE_LOW = P.ZONE_LOW

# A setback drawn at exactly 7.5 m measures 7.4997 m by area / depth (the
# side region's polygon arithmetic): the panel then fails it. 1 mm is let go.
import sbd_geom_separation as _G          # noqa: E402
_S1_FT = (_G.MIN_S1_M - 0.001) / _G.FEET_TO_METERS
for _mod in (P, _G):
    _mod.MIN_S1_FT = _S1_FT
PLANE_Y_MIN, PLANE_Y_MAX = P.PLANE_Y_ANGLE_MIN, P.PLANE_Y_ANGLE_MAX


# The bands behind the drawn shapes. The panel draws a corridor or a side
# region by sampling depths across the site, so at a notch in the boundary
# its end stops short. The band itself (the corridor's edge with its bend,
# the side region's inner edge) is kept here, and the plan draws it clipped
# to the site, so the hatch runs to the boundary.
class Band(list):
    """A drawn polygon (the panel's) that knows its band: (u1, v1, v2,
    tan_t, w) with the axes, feet."""
    band = None


_build_band = W.build_corridor_band_polygon


def _band_polygon(u1, v1, v2, tan_t, width, toward, site_uv, axis_u, axis_v, elev):
    poly = Band(_build_band(u1, v1, v2, tan_t, width, toward, site_uv, axis_u, axis_v, elev))
    poly.band = (u1, v1, v2, tan_t, width * (1.0 if toward > 0 else -1.0), axis_u, axis_v)
    return poly


W.build_corridor_band_polygon = _band_polygon

_REC = []
_dp = W._dp_simplify


def _dp_rec(chain, *a, **k):
    _REC.append(list(chain))
    return _dp(chain, *a, **k)


W._dp_simplify = _dp_rec
_side = W.side_average_width


_edge_u = W._edge_u_at_v
_TRIED = set()


def _edge_once(v, u1, v1, v2, tan_t):
    """A side region's edge turns ONCE: perpendicular to the plane, then at
    its angle (<= 15 deg) on to the end - it does not return (Wilson,
    report 3). The corridors keep the panel's bend-and-return."""
    _TRIED.add((u1, v1, tan_t))
    return u1 if v <= v1 else u1 + tan_t * (v - v1)


def side_average_width(site_pts, building_loops, axis_u, axis_v, side, *a, **k):
    """The panel's side region with an edge that turns once, its inner edge
    (u, v) kept, and the edge chosen (u1, v1, tan) found from it."""
    del _REC[:]
    _TRIED.clear()
    W._edge_u_at_v = _edge_once
    try:
        r = _side(site_pts, building_loops, axis_u, axis_v, side, *a, **k)
    finally:
        W._edge_u_at_v = _edge_u
    if r and len(_REC) >= 2:
        chain = _REC[-2]
        r["inner_uv"] = chain
        r["axes"] = (axis_u, axis_v)
        # the candidate the drawn edge follows (where the region is not cut by
        # the boundary, the chain lies on it)
        best = None
        for (u1, v1, t) in _TRIED:
            hit = sum(1 for (u, v) in chain if abs((u1 if v <= v1 else u1 + t * (v - v1)) - u) < 1e-3)
            if best is None or hit > best[0]:
                best = (hit, (u1, v1, t))
        if best and best[0] >= 2:
            r["edge_param"] = best[1]
    del _REC[:]
    return r


W.side_average_width = side_average_width
P.side_average_width = side_average_width
CANDIDATES = []


def _score(site_pts, loops, base_axis, x_deg, req_p):
    """Fast (projection only) ranking of one Plane X angle, with its best
    Plane Y: the lower of the two P values."""
    ax = rotate_axis_xy(base_axis, x_deg) if x_deg else base_axis.Normalize()
    r1 = P.pick_best_plane_side(site_pts, site_pts, loops, ax, fast=True)
    _, r2 = P.optimize_plane_y(site_pts, site_pts, loops, ax, step=5.0, required_p=req_p, confirm_full=False,
                               progress_label="Y")
    return min(r1.get("P", 0.0), r2.get("P", 0.0)), r2.get("plane_y_angle_deg", 90.0)


def optimize_zone_planes(zone_name, site_pts, boundary_pts, building_loops, base_axis, tallest_m=20.0,
                         lock_axis_x=False, street_cl_extensions=None, required_p=None):
    """The panel's optimize_zone_planes with a finer Plane X search."""
    zone_h, _ = P.zone_band_height_m(zone_name, tallest_m)
    tried = {}

    def rank(d):
        d = round(d % 180.0, 3)
        if d not in tried:
            tried[d] = _score(site_pts, building_loops, base_axis, d, required_p)
        return tried[d]
    best = max(((rank(d), d) for d in range(0, 180, 15)), key=lambda t: t[0][0])
    for step, reach in ((3, 12), (1, 2)):
        c = best[1]
        k = -reach
        while k <= reach:
            d = (c + k) % 180.0
            s = rank(d)
            if s[0] > best[0][0] + 1e-9:
                best = (s, d)
            k += step
    # the quick ranking only projects; the best few angles (and the street's
    # own, 0 deg) are confirmed with the full assessment - side regions and
    # bending corridors - and the best of those wins
    ranked = sorted(tried.items(), key=lambda kv: -kv[1][0])
    cands = []
    for d, _ in [(0.0, None)] + ranked:
        if all(abs(((d - c + 90) % 180) - 90) > 2.5 for c in cands):
            cands.append(d)
        if len(cands) >= 4:
            break
    best_full = None
    for d in cands:
        ax_x = rotate_axis_xy(base_axis, d) if d else base_axis.Normalize()
        r1 = P.pick_best_plane_side(site_pts, boundary_pts, building_loops, ax_x,
                                    street_cl_extensions=street_cl_extensions, fast=False)
        axis_y, r2 = P.optimize_plane_y(site_pts, boundary_pts, building_loops, r1.get("axis", ax_x),
                                        required_p=required_p, street_cl_extensions=street_cl_extensions,
                                        confirm_full=True)
        score = min(r1.get("P", 0.0), r2.get("P", 0.0))
        P.debug_print("  [P/S] Zone {} X={:+.0f} deg confirmed: P_x={:.1f}% P_y={:.1f}% (Y={:.0f} deg)".format(
            zone_name, d, r1.get("P", 0.0), r2.get("P", 0.0), r2.get("plane_y_angle_deg", 90.0)))
        CANDIDATES.append({"x_deg": d, "y_deg": r2.get("plane_y_angle_deg", 90.0), "axis1": r1, "axis2": r2})
        if best_full is None or score > best_full[0] + 1e-9:
            best_full = (score, d, r1, r2, axis_y, ax_x)
    _, x_deg, r1, r2, axis_y, ax_x = best_full
    P.debug_print("  [P/S] Zone {} planes: {} X angles ranked, {} confirmed: X={:+.0f} deg, Y={:.0f} deg".format(
        zone_name, len(tried), len(cands), x_deg, r2.get("plane_y_angle_deg", 90.0)))
    return {"axis_x": r1.get("axis", ax_x), "axis_y": r2.get("axis", axis_y), "axis1": r1, "axis2": r2,
            "x_angle_deg": x_deg, "y_angle_deg": r2.get("plane_y_angle_deg", 90.0), "zone_h_m": zone_h}


P.optimize_zone_planes = optimize_zone_planes


def assess(zone_name, site_pts, loops, base_axis, req_p=None, tallest_m=20.0):
    """One zone, its own footprints -> (zone result, log text). The zone
    result's "candidates" are the plane pairs confirmed in full (the Low
    zone: its one pair along the street), each with its side regions: the
    caller picks among them by the P it reports."""
    buf = io.StringIO()
    del CANDIDATES[:]
    with contextlib.redirect_stdout(buf):
        zr = P.assess_zone(zone_name, site_pts, site_pts, loops, base_axis, axis_secondary=None,
                           lock_axis_x=(zone_name == ZONE_LOW), req_p=req_p, tallest_m=tallest_m)
        cands = list(CANDIDATES) or [{"x_deg": zr.get("plane_x_angle_deg") or 0.0,
                                      "y_deg": zr.get("plane_y_angle_deg"), "axis1": zr["axis1"], "axis2": zr["axis2"]}]
        zr["candidates"] = cands
        for r in [c[k] for c in cands for k in ("axis1", "axis2")]:
            if not r or not r.get("axis") or "sides" in r:
                continue
            au = r["axis"]
            av = P.orthogonal_axis(au)
            sides = {}
            for side in ("left", "right"):
                try:
                    s = W.side_average_width(site_pts, loops, au, av, side)
                except Exception as e:
                    P.debug_print("  [Side {}] not worked out: {}".format(side, e))
                    s = None
                if s and s.get("avg_width_m"):
                    sides[side] = s
            r["sides"] = sides
    return zr, buf.getvalue()


def orthogonal_axis(a):
    return P.orthogonal_axis(a)


def required_p(site_area_m2, lp_m, tallest_m=None):
    return P.get_required_p(site_area_m2, lp_m, tallest_m)
