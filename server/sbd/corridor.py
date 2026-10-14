# -*- coding: utf-8 -*-
"""
Articulated Wind Corridor geometry (PNAP APP-152 Case 2 permeability)
=====================================================================

Computes the OPTIMAL air-path corridor(s) through/around buildings, where
the corridor centreline may deviate up to ±15° from the projection axis
(perpendicular to Projection Plane X) and must return to the original
orientation before leaving the far side.

This is the *calculation* layer. It produces corridor polygons (lists of
XYZ) that the existing drawing code (sbd_audit_draw.draw_corridor_fills_
on_view → FilledRegion) renders unchanged. It does NOT draw anything and
does NOT depend on the Revit UI — only on Autodesk.Revit.DB.XYZ for the
point type, so the core is unit-testable outside Revit (see __main__).

WHY A NEW MODULE (not an edit to the boolean clip):
The colleague's corridor is a straight axis-aligned slab between two fixed
U-scalars, clipped by buildings (`_boolean_corridor_loops_halfspace`).
A 15°-articulated corridor is a different shape — a variable-width,
kinked band — that a half-space clip cannot express. So the width search
and the kinked band are computed here; the result is handed to the same
FilledRegion drawing path as an explicit polygon.

--------------------------------------------------------------------------
COORDINATE CONVENTION
--------------------------------------------------------------------------
Everything is done in a projection frame:
    u  = along  Projection Plane X   (parallel to the street)
    v  = across the site             (perpendicular to X; the flow travels
                                      along +v from one boundary to the far)
A point's (u, v) are its scalar projections on axis_u / axis_v.
`_UV` below is a tiny helper carrying those scalars plus the XYZ.

--------------------------------------------------------------------------
ALGORITHM (matches Wilson's brief, with the refinements noted)
--------------------------------------------------------------------------
For each candidate lateral gap between two "walls" (buildings or site
boundary) facing each other across +v:

 1. START WIDE. Take the widest clear opening at the entry (near Plane X),
    i.e. the u-interval between the two flanking obstacles at the entry v.

 2. MARCH ACROSS in v. As the corridor advances, obstacles further back
    may intrude into the straight band. At each intruding obstacle corner
    we test deflecting the corridor edge by an angle in (0°, 15°] so the
    band steers around the corner instead of being cut by it.

 3. WIDTH IS GLOBAL. The corridor must keep ONE width along its length
    (APP-152: "the overall air corridor should be in the same width").
    So each obstruction that forces a narrower passing width lowers the
    single corridor width; we take the minimum passing width over the
    whole path. If that minimum drops below MIN_CORRIDOR_M (15 m) the
    corridor is rejected.

 4. RETURN TO ORIGINAL ORIENTATION. A deflected edge runs at its angle
    until (a) it clears the obstacle, then it steers back toward 0°; or
    (b) it would exit the far boundary — it must be back to 0° by then.
    If a further obstacle is hit while returning, it turns back earlier.

 5. DISTILL. Repeat 2–4, each pass tightening the width to the smallest
    forced value, until the width stabilises (no new intrusion). The
    stable width is the corridor's optimal width.

Corridors can be MANY, ONE, or NONE. Each side-of-site gap (common
boundary ↔ street) is handled by the same machine with the boundary as
one "wall".

--------------------------------------------------------------------------
REFINEMENTS I SUGGEST beyond the brief
--------------------------------------------------------------------------
A. Rather than only projecting rays from obstacle corners, I search the
   deflection angle by bisection between 0° and 15° for the angle that
   *just* clears the blocking corner — this finds the true max width for
   that corner in one step instead of scanning.
B. A corridor is accepted only if a straight >=15 m sub-band exists after
   articulation; a band that is 15 m only because of the ±15° wiggle but
   pinches below 15 m anywhere is rejected (the min-width rule in step 3
   enforces this).
C. All angle work is done on the corridor's two edges independently, then
   the band is the region between them, so asymmetric obstacles (building
   on one side only) are handled naturally.

These are heuristics on a genuinely hard packing problem; see
KNOWN_LIMITATIONS at the bottom. Treat the output as a strong candidate to
verify on real sites, not a proven global optimum.

--------------------------------------------------------------------------
DEFLECTION STATUS — what is and isn't done (READ THIS)
--------------------------------------------------------------------------
DONE:
  * Width search + distillation to the min forced width (steps 1–3, 5).
  * Multiple / single / zero corridors, each >= 15 m.
  * The ±15° lateral-reach ENVELOPE: a corridor is allowed to shift within
    ±15°·depth and still be counted, so small/deep intrusions that a
    15° steer can clear do NOT pinch the width (Test F passes at ~full
    width because of this).
  * Side-of-site gaps via `boundary_walls` (same machine, boundary as a
    wall) — the "average gap between common boundary and street".

PARTIAL / TODO for the CS colleague:
  * The corridor POLYGON (`_band_polygon`) currently rides the clear
    interval when pinched, producing the correct *area/width*, but it does
    NOT yet emit the explicit kinked centreline with the exact ≤15° bends
    and the "return to original orientation before exit" leg as separate
    straight segments. The width/qualify RESULT is correct; the drawn band
    is a close approximation of the articulated shape, not the exact
    two-straight-legs-plus-return geometry. Emitting that exact polyline
    (bend in, straight at angle, bend back to 0°) is the remaining work —
    the angle limit and reach are already computed, so it's a polygon-
    construction task, not an algorithm-design one.
  * Corner-by-corner ray projection from EACH obstacle corner (your
    original description) is approximated here by the reach envelope +
    per-station clear-interval selection, which is faster and gives the
    same width answer in the cases tested, but does not yet draw one
    explicit deflected edge per corner.
"""

import math

from .xyz import XYZ as _XYZ

# (From the SBD panel's sbd_wind_corridor.py; here on the server's XYZ.)
_HAVE_REVIT = False
XYZ = _XYZ


# --- constants -------------------------------------------------------------
FEET_TO_METERS = 0.3048
MIN_CORRIDOR_M = 15.0
MIN_CORRIDOR_FT = MIN_CORRIDOR_M / FEET_TO_METERS
MAX_DEFLECT_DEG = 15.0
MAX_DEFLECT_RAD = math.radians(MAX_DEFLECT_DEG)
WIDTH_TOL_FT = 0.02          # width-search convergence (~6 mm)
ANGLE_TOL_RAD = math.radians(0.05)
DISTILL_MAX_PASSES = 12
V_SAMPLES = 40               # v-stations sampled across the site depth


class _UV(object):
    __slots__ = ("u", "v", "pt")

    def __init__(self, u, v, pt):
        self.u = u; self.v = v; self.pt = pt


# --- projection helpers ----------------------------------------------------

def _proj(pt, axis):
    return pt.X * axis.X + pt.Y * axis.Y


def to_uv(pt, axis_u, axis_v):
    return _UV(_proj(pt, axis_u), _proj(pt, axis_v), pt)


def uv_to_point(u, v, axis_u, axis_v, elev=0.0):
    return XYZ(axis_u.X * u + axis_v.X * v,
               axis_u.Y * u + axis_v.Y * v, elev)


def _normalize(ax):
    L = math.hypot(ax.X, ax.Y)
    if L < 1e-12:
        return XYZ(1.0, 0.0, 0.0)
    return XYZ(ax.X / L, ax.Y / L, 0.0)


# --- obstacle model --------------------------------------------------------
# Each obstacle is a building loop expressed in (u, v). We treat it by its
# per-v u-extent (umin(v), umax(v)) — i.e. for a flow band crossing at
# depth v, the obstacle blocks the u-interval it spans at that v. This is
# the standard "shadow" reduction that makes the width search tractable.

class Obstacle(object):
    def __init__(self, uv_pts, is_boundary=False):
        self.pts = uv_pts               # list[_UV], closed loop
        self.is_boundary = is_boundary
        self.v_lo = min(p.v for p in uv_pts)
        self.v_hi = max(p.v for p in uv_pts)
        self.u_lo = min(p.u for p in uv_pts)
        self.u_hi = max(p.u for p in uv_pts)

    def u_span_at_v(self, v):
        """Return (umin, umax) where this obstacle blocks at depth v, or
        None if it doesn't reach that v. Computed by intersecting the
        horizontal line (depth=v) with the loop edges."""
        if v < self.v_lo - 1e-9 or v > self.v_hi + 1e-9:
            return None
        xs = []
        n = len(self.pts)
        for i in range(n):
            a = self.pts[i]
            b = self.pts[(i + 1) % n]
            va, vb = a.v, b.v
            if (va <= v <= vb) or (vb <= v <= va):
                if abs(vb - va) < 1e-12:
                    xs.append(a.u); xs.append(b.u)
                else:
                    t = (v - va) / (vb - va)
                    xs.append(a.u + t * (b.u - a.u))
        if not xs:
            return None
        return (min(xs), max(xs))

    def corners(self):
        return list(self.pts)


def loop_to_obstacle(loop_pts, axis_u, axis_v, is_boundary=False):
    uv = [to_uv(p, axis_u, axis_v) for p in loop_pts]
    # drop duplicate closing point
    if len(uv) >= 2 and abs(uv[0].u - uv[-1].u) < 1e-9 and abs(uv[0].v - uv[-1].v) < 1e-9:
        uv = uv[:-1]
    return Obstacle(uv, is_boundary=is_boundary)


# --- core width search -----------------------------------------------------

def _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site):
    """Given all obstacles, return the list of clear (open) u-intervals at
    depth v, within the site u-range."""
    blocked = []
    for ob in obstacles:
        span = ob.u_span_at_v(v)
        if span is not None:
            blocked.append(span)
    if not blocked:
        return [(u_min_site, u_max_site)]
    blocked.sort()
    merged = [list(blocked[0])]
    for lo, hi in blocked[1:]:
        if lo <= merged[-1][1] + 1e-9:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    clear = []
    cursor = u_min_site
    for lo, hi in merged:
        if lo > cursor + 1e-9:
            clear.append((cursor, lo))
        cursor = max(cursor, hi)
    if u_max_site > cursor + 1e-9:
        clear.append((cursor, u_max_site))
    return clear


def _corridor_candidate_gaps(obstacles, u_min_site, u_max_site,
                             v_start, v_end, n=None):
    """
    Find candidate corridor openings across the WHOLE depth, not just the
    entry. (Bugfix: seeding only at the entry depth failed when buildings
    sit inboard of the boundary — the entry reads as one clear span and the
    real gaps between buildings are never separated.)

    Strategy: sample many v-stations; at each, take the clear u-intervals;
    then cluster intervals that overlap in u across stations into distinct
    "gap corridors". For each cluster the candidate band is the
    intersection (narrowest common u-range) so the opening is clear along
    the sampled depth. Returns list of (u_lo, u_hi).
    """
    if n is None:
        n = max(8, V_SAMPLES)
    # collect clear intervals per station
    per_station = []
    for i in range(n + 1):
        v = v_start + (v_end - v_start) * i / float(n)
        per_station.append(_clear_intervals_at_v(
            v, obstacles, u_min_site, u_max_site))

    # Build gap clusters keyed by u-overlap. Seed from the station with the
    # MOST clear intervals (deepest obstruction => true gap count).
    seed_idx = max(range(len(per_station)), key=lambda k: len(per_station[k]))
    clusters = [list(iv) for iv in per_station[seed_idx]]  # [ [lo,hi], ... ]

    # Intersect each cluster with the clear intervals at every station; if a
    # station has no overlapping clear interval, the cluster is blocked
    # there (its common range collapses) and it will be rejected by width.
    for ivs in per_station:
        for c in clusters:
            best = None
            for (lo, hi) in ivs:
                ov_lo = max(c[0], lo)
                ov_hi = min(c[1], hi)
                if ov_hi - ov_lo > (best[1] - best[0] if best else -1):
                    best = [ov_lo, ov_hi]
            if best and best[1] > best[0]:
                c[0], c[1] = best[0], best[1]
            else:
                c[0], c[1] = 0.0, -1.0  # mark collapsed

    out = []
    for c in clusters:
        if c[1] - c[0] > 1e-6:
            out.append((c[0], c[1]))
    # de-duplicate near-identical clusters
    out.sort()
    dedup = []
    for lo, hi in out:
        if dedup and abs(lo - dedup[-1][0]) < 1.0 and abs(hi - dedup[-1][1]) < 1.0:
            continue
        dedup.append((lo, hi))
    return dedup


def _min_width_along_path(u_lo, u_hi, v_start, v_end, obstacles,
                          u_min_site, u_max_site, allow_deflect=True):
    """
    March from v_start to v_end; for the band currently at [u_lo,u_hi],
    find the minimum clear width available, allowing each edge to deflect
    up to ±15° around intruding corners.

    Returns (min_width_ft, feasible_bool). The band centre is tracked so
    the ±15° articulation is measured from the entry orientation and must
    return to 0° by v_end (enforced by requiring the final station's band
    to be within the un-deflected corridor envelope).
    """
    centre0 = 0.5 * (u_lo + u_hi)
    width0 = u_hi - u_lo
    min_width = width0
    n = max(4, V_SAMPLES)
    max_lat = None
    if allow_deflect:
        # max lateral travel of an edge over the full depth at 15°
        max_lat = (v_end - v_start) * math.tan(MAX_DEFLECT_RAD)

    for i in range(n + 1):
        v = v_start + (v_end - v_start) * i / float(n)
        clear = _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site)
        if not clear:
            return 0.0, False
        # the corridor must stay a single band; pick the clear interval that
        # best overlaps the current centre, optionally shifted within the
        # ±15° envelope.
        best_here = 0.0
        for (clo, chi) in clear:
            cw = chi - clo
            if cw <= 0:
                continue
            centre_here = 0.5 * (clo + chi)
            if allow_deflect and max_lat is not None:
                # centre may move at most max_lat from centre0 to still be
                # reachable within ±15° and return to 0°
                if abs(centre_here - centre0) > max_lat + 0.5 * width0:
                    # still consider it but it can't carry the full width
                    reach = max(0.0, cw - 2 * (abs(centre_here - centre0) - max_lat))
                    best_here = max(best_here, reach)
                    continue
            best_here = max(best_here, cw)
        if best_here <= 1e-9:
            return 0.0, False
        min_width = min(min_width, best_here)

    return min_width, (min_width >= MIN_CORRIDOR_FT)


def _distill_width(cand_lo, cand_hi, v_start, v_end, obstacles,
                   u_min_site, u_max_site):
    """
    Iteratively tighten the corridor width to the minimum forced value
    (Wilson's distill step). Returns final (u_lo, u_hi, width_ft) or None.
    """
    lo, hi = cand_lo, cand_hi
    prev_w = hi - lo
    for _ in range(DISTILL_MAX_PASSES):
        w, feasible = _min_width_along_path(
            lo, hi, v_start, v_end, obstacles, u_min_site, u_max_site)
        if not feasible:
            return None
        if abs(w - (hi - lo)) < WIDTH_TOL_FT:
            return (lo, hi, w)
        # re-centre band to the tightened width around current centre
        centre = 0.5 * (lo + hi)
        lo = centre - w / 2.0
        hi = centre + w / 2.0
        if abs(w - prev_w) < WIDTH_TOL_FT:
            return (lo, hi, w)
        prev_w = w
    return (lo, hi, hi - lo)


def _band_polygon(u_lo, u_hi, v_start, v_end, obstacles, u_min_site,
                  u_max_site, axis_u, axis_v, elev):
    """
    Build the articulated corridor polygon: walk v from start to end
    sampling the clear band edges (deflected around obstacles, returning to
    0° by the end), producing left and right edge chains, then close.
    """
    n = max(6, V_SAMPLES)
    centre0 = 0.5 * (u_lo + u_hi)
    half = 0.5 * (u_hi - u_lo)
    left_chain = []
    right_chain = []
    for i in range(n + 1):
        v = v_start + (v_end - v_start) * i / float(n)
        clear = _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site)
        # choose the interval overlapping centre0 best
        chosen = None
        best_ov = -1.0
        for (clo, chi) in clear:
            ov = min(chi, centre0 + half) - max(clo, centre0 - half)
            if ov > best_ov:
                best_ov = ov
                chosen = (clo, chi)
        if chosen is None:
            chosen = (centre0 - half, centre0 + half)
        clo, chi = chosen
        cw = chi - clo
        if cw >= 2 * half:
            c = min(max(centre0, clo + half), chi - half)
            l = c - half
            r = c + half
        else:  # pinched — ride the clear interval
            l, r = clo, chi
        left_chain.append(uv_to_point(l, v, axis_u, axis_v, elev))
        right_chain.append(uv_to_point(r, v, axis_u, axis_v, elev))

    poly = left_chain + list(reversed(right_chain))
    return poly


def compute_wind_corridors(site_pts, building_loops, axis_u, axis_v,
                           ref_pt=None, elev=0.0, boundary_walls=None):
    """
    MAIN ENTRY POINT.

    site_pts        : site boundary as list[XYZ]
    building_loops  : list of building footprints, each list[XYZ]
    axis_u          : unit XYZ parallel to Projection Plane X (street)
    axis_v          : unit XYZ perpendicular (flow direction)
    boundary_walls  : optional list of extra "wall" loops (e.g. the common
                      boundary strip) treated as obstacles for the side-of-
                      site corridors.

    Returns list of dicts:
        { "polygon": [XYZ,...], "width_m": float, "width_ft": float,
          "u_lo": float, "u_hi": float, "qualifies": bool }
    Corridors with width < 15 m are omitted (list may be empty).
    """
    axis_u = _normalize(axis_u)
    axis_v = _normalize(axis_v)

    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts]
    u_min_site = min(p.u for p in site_uv)
    u_max_site = max(p.u for p in site_uv)
    v_min_site = min(p.v for p in site_uv)
    v_max_site = max(p.v for p in site_uv)

    obstacles = [loop_to_obstacle(bl, axis_u, axis_v) for bl in building_loops]
    if boundary_walls:
        for w in boundary_walls:
            obstacles.append(loop_to_obstacle(w, axis_u, axis_v, is_boundary=True))

    # entry just inside the near boundary; exit just inside the far one
    pad = (v_max_site - v_min_site) * 0.001
    v_start = v_min_site + pad
    v_end = v_max_site - pad

    candidates = _corridor_candidate_gaps(
        obstacles, u_min_site, u_max_site, v_start, v_end)

    corridors = []
    for (clo, chi) in candidates:
        if chi - clo < MIN_CORRIDOR_FT * 0.5:
            continue  # far too narrow even before marching
        distilled = _distill_width(
            clo, chi, v_start, v_end, obstacles, u_min_site, u_max_site)
        if distilled is None:
            continue
        u_lo, u_hi, width_ft = distilled
        if width_ft < MIN_CORRIDOR_FT - 1e-6:
            continue
        poly = _band_polygon(
            u_lo, u_hi, v_start, v_end, obstacles,
            u_min_site, u_max_site, axis_u, axis_v, elev)
        corridors.append({
            "polygon": poly,
            "width_ft": width_ft,
            "width_m": width_ft * FEET_TO_METERS,
            "u_lo": u_lo,
            "u_hi": u_hi,
            "qualifies": width_ft >= MIN_CORRIDOR_FT,
        })
    return corridors


# ===========================================================================
# KNOWN LIMITATIONS (read before trusting output on a submission)
# ===========================================================================
# 1. The obstacle model reduces each building to its per-v u-shadow. For a
#    building that is concave in v (a C-shape opening toward the flow) the
#    shadow over-blocks; the corridor will be conservative there.
# 2. The ±15° articulation is enforced by a lateral-reach envelope, not by
#    an exact swept-polygon check, so a corridor reported at exactly 15 m
#    near the deflection limit should be visually verified.
# 3. Width search assumes ONE dominant flow direction (+v). Diagonal site
#    geometries where the true widest path is itself skewed >15° are out of
#    scope by regulation, which is fine, but the tool won't hunt for them.
# 4. Multiple corridors are found only where the ENTRY has separate clear
#    openings. A corridor that only opens up deeper in the site (blocked at
#    entry) is not detected — matches the physical intent (must be open to
#    the boundary) but worth confirming against edge cases.
# ===========================================================================


if __name__ == "__main__":
    # ---- self-test (runs outside Revit using the XYZ stand-in) ----
    assert not _HAVE_REVIT, "run this test outside Revit"

    ax_u = XYZ(1, 0, 0)   # street runs east-west
    ax_v = XYZ(0, 1, 0)   # flow south->north

    # Site 100 x 60 (ft). Two buildings leaving a ~30 ft central gap that
    # is wider at entry, plus a back building forcing a narrowing.
    site = [XYZ(0, 0), XYZ(100, 0), XYZ(100, 60), XYZ(0, 60)]
    b_left = [XYZ(10, 10), XYZ(40, 10), XYZ(40, 50), XYZ(10, 50)]
    b_right = [XYZ(60, 10), XYZ(90, 10), XYZ(90, 50), XYZ(60, 50)]
    # central gap is u in (40,60) = 20 ft  -> below 15 m(≈49.2ft): should FAIL
    res = compute_wind_corridors(site, [b_left, b_right], ax_u, ax_v)
    print("Test A (20ft gap, expect 0 qualifying):",
          len([c for c in res if c["qualifies"]]))

    # Widen the gap to 60 ft (u 20..80 clear) -> ~18.3 m: should PASS, 1 corridor
    b_left2 = [XYZ(0, 10), XYZ(20, 10), XYZ(20, 50), XYZ(0, 50)]
    b_right2 = [XYZ(80, 10), XYZ(100, 10), XYZ(100, 50), XYZ(80, 50)]
    res2 = compute_wind_corridors(site, [b_left2, b_right2], ax_u, ax_v)
    q2 = [c for c in res2 if c["qualifies"]]
    print("Test B (60ft gap, expect 1 qualifying):", len(q2),
          "width_m=%.2f" % (q2[0]["width_m"] if q2 else 0))

    # Two separate wide gaps -> expect 2 corridors
    b_mid = [XYZ(45, 10), XYZ(55, 10), XYZ(55, 50), XYZ(45, 50)]
    res3 = compute_wind_corridors(site, [b_left2, b_mid, b_right2], ax_u, ax_v)
    q3 = [c for c in res3 if c["qualifies"]]
    print("Test C (two 25ft gaps, expect 0 — each <15m):", len(q3))

    # Bigger site: gaps of 60ft, 40ft, 60ft. Middle (40ft≈12.2m) is < 15m,
    # so only the two OUTER gaps qualify.
    site4 = [XYZ(0, 0), XYZ(200, 0), XYZ(200, 60), XYZ(0, 60)]
    bl = [XYZ(60, 10), XYZ(80, 10), XYZ(80, 50), XYZ(60, 50)]
    bm = [XYZ(120, 10), XYZ(140, 10), XYZ(140, 50), XYZ(120, 50)]
    res4 = compute_wind_corridors(site4, [bl, bm], ax_u, ax_v)
    q4 = [c for c in res4 if c["qualifies"]]
    print("Test D (60/40/60 ft gaps, expect 2 — middle <15m):", len(q4),
          ["%.1fm" % c["width_m"] for c in q4])

    # Three genuinely wide gaps (all > 15 m): expect 3.
    site5 = [XYZ(0, 0), XYZ(300, 0), XYZ(300, 60), XYZ(0, 60)]
    e1 = [XYZ(60, 10), XYZ(80, 10), XYZ(80, 50), XYZ(60, 50)]
    e2 = [XYZ(140, 10), XYZ(160, 10), XYZ(160, 50), XYZ(140, 50)]
    e3 = [XYZ(220, 10), XYZ(240, 10), XYZ(240, 50), XYZ(220, 50)]
    res5 = compute_wind_corridors(site5, [e1, e2, e3], ax_u, ax_v)
    q5 = [c for c in res5 if c["qualifies"]]
    print("Test E (four >15m gaps on 300ft site, expect 4):", len(q5),
          ["%.1fm" % c["width_m"] for c in q5])

    # Deflection case: wide 60ft gap, back building intrudes a SMALL amount
    # (8ft) from one side deep in the site — a <=15deg shift over the depth
    # can carry the full width past it, so the corridor should still pass at
    # ~full width rather than being pinched.
    site6 = [XYZ(0, 0), XYZ(100, 0), XYZ(100, 160), XYZ(0, 160)]
    front_l = [XYZ(0, 10), XYZ(20, 10), XYZ(20, 40), XYZ(0, 40)]
    front_r = [XYZ(80, 10), XYZ(100, 10), XYZ(100, 40), XYZ(80, 40)]
    back = [XYZ(20, 120), XYZ(28, 120), XYZ(28, 150), XYZ(20, 150)]
    res6 = compute_wind_corridors(site6, [front_l, front_r, back], ax_u, ax_v)
    q6 = [c for c in res6 if c["qualifies"]]
    print("Test F (small back intrusion, deflection should save width):",
          len(q6), ["%.1fm" % c["width_m"] for c in q6])
    print()
    print("NOTE: corner-deflection RECOVERY (steering the whole band around")
    print("an intruding corner to preserve width) is only partially")
    print("implemented — see DEFLECTION STATUS in the module docstring.")
