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

try:
    from Autodesk.Revit.DB import XYZ
    _HAVE_REVIT = True
except Exception:
    # Allow import + unit testing outside Revit with a minimal XYZ stand-in.
    _HAVE_REVIT = False

    class XYZ(object):
        def __init__(self, x=0.0, y=0.0, z=0.0):
            self.X = float(x); self.Y = float(y); self.Z = float(z)

        def DistanceTo(self, o):
            return math.hypot(self.X - o.X, self.Y - o.Y)


# --- constants -------------------------------------------------------------
try:
    from sbd_geom_base import debug_print
except Exception:
    def debug_print(msg):
        try:
            print(msg)
        except Exception:
            pass

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

# Active site outline in (u,v), set by compute_wind_corridors(). Every
# interval query clips to this, so corridors/side regions never extend
# outside the real site boundary.
_SITE_LOOP_UV = None


def _set_site_context(loop_uv):
    global _SITE_LOOP_UV
    _SITE_LOOP_UV = loop_uv


def _loop_u_intervals_at_v(loop_uv, v):
    """INSIDE u-intervals of an arbitrary (possibly non-convex) polygon at
    depth v, by even-odd crossing rule. Used to clip everything to the REAL
    site outline instead of its bounding box -- without this, corridors and
    side regions run off outside the site (observed on the test model)."""
    xs = []
    n = len(loop_uv)
    for i in range(n):
        a = loop_uv[i]
        b = loop_uv[(i + 1) % n]
        if (a.v <= v < b.v) or (b.v <= v < a.v):
            if abs(b.v - a.v) < 1e-12:
                continue
            t = (v - a.v) / (b.v - a.v)
            xs.append(a.u + t * (b.u - a.u))
    xs.sort()
    out = []
    for i in range(0, len(xs) - 1, 2):
        if xs[i + 1] - xs[i] > 1e-9:
            out.append((xs[i], xs[i + 1]))
    return out


def _loop_v_intervals_at_u(loop_uv, u):
    """Mirror of _loop_u_intervals_at_v: INSIDE v-intervals at a given u."""
    vs = []
    n = len(loop_uv)
    for i in range(n):
        a = loop_uv[i]
        b = loop_uv[(i + 1) % n]
        if (a.u <= u < b.u) or (b.u <= u < a.u):
            if abs(b.u - a.u) < 1e-12:
                continue
            t = (u - a.u) / (b.u - a.u)
            vs.append(a.v + t * (b.v - a.v))
    vs.sort()
    out = []
    for i in range(0, len(vs) - 1, 2):
        if vs[i + 1] - vs[i] > 1e-9:
            out.append((vs[i], vs[i + 1]))
    return out


def boundary_partition(site_pts, gap_polys, axis_u, axis_v,
                       near_is_low_v=True, n_samples=600, eps_frac=0.0004):
    """Partition the SITE EDGE NEAREST THE PLANE into gaps and groups.

    The elevation's widths are all measured on this edge, parallel to the
    plane. A building group's region is bounded left and right by the air
    gaps beside it, and those gaps are slanted (the corridor at -11.3 deg,
    the side regions at -4.4 and -15.0), so the region is a QUADRILATERAL,
    not a rectangle. Its width therefore depends on where you measure it:
    on the reference run the left group reads 60.16 m across its middle but
    74.55 m at the near edge, and the right group 72.45 m against 48.91 m.

    Measuring the merged bounding projection (what `merged` gives, and what
    the bar uses) returns the middle figure. This walks the near edge
    instead, at each step asking which air gap -- if any -- covers it.

    Returns (gap_runs, group_runs); each is a list of (u_lo, u_hi), and
    together they tile the site's u-extent exactly.
    """
    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts or []]
    if len(site_uv) < 3:
        return [], []
    us = [q.u for q in site_uv]
    vs = [q.v for q in site_uv]
    u_lo, u_hi = min(us), max(us)
    depth = max(vs) - min(vs)
    if u_hi - u_lo < 1e-9 or depth < 1e-9:
        return [], []
    # Sample just INSIDE the near edge. Keep this small: the gap polygons
    # are slanted, so measuring at v = eps rather than at the edge shifts
    # each run boundary by eps * tan(slant). At 0.4% of depth that showed as
    # ~0.10 m against hand-measured widths.
    eps = max(depth * eps_frac, 0.01)

    polys_uv = []
    for poly in gap_polys or []:
        if poly and len(poly) >= 3:
            polys_uv.append([to_uv(p, axis_u, axis_v) for p in poly])
        else:
            polys_uv.append(None)

    n = max(int(n_samples), 32)
    labels = []                      # index of covering gap, or -1
    step = (u_hi - u_lo) / float(n)
    for k in range(n):
        u = u_lo + (k + 0.5) * step
        ivs = _loop_v_intervals_at_u(site_uv, u)
        if not ivs:
            labels.append(None)      # outside the site at this u
            continue
        # The near edge: lowest v inside the site at this u (or highest).
        v_edge = ivs[0][0] + eps if near_is_low_v else ivs[-1][1] - eps
        hit = -1
        for gi, pu in enumerate(polys_uv):
            if pu and _point_in_loop_uv(u, v_edge, pu):
                hit = gi
                break
        labels.append(hit)

    def _label_at(u):
        ivs = _loop_v_intervals_at_u(site_uv, u)
        if not ivs:
            return None
        v_edge = ivs[0][0] + eps if near_is_low_v else ivs[-1][1] - eps
        for gi, pu in enumerate(polys_uv):
            if pu and _point_in_loop_uv(u, v_edge, pu):
                return gi
        return -1

    def _refine(u_out, u_in, match, iters=24):
        """Bisect the transition so a run edge is not quantised to the
        sample step (0.28 m at 600 samples over a 170 m site, which showed
        as 74.59 against a hand-measured 74.55)."""
        for _ in range(iters):
            mid = 0.5 * (u_out + u_in)
            lab = _label_at(mid)
            if lab is not None and match(lab):
                u_in = mid
            else:
                u_out = mid
        return 0.5 * (u_out + u_in)

    def _runs(match):
        out = []
        start_k = None
        for k in range(n + 1):
            lab = labels[k] if k < n else None
            ok = (lab is not None) and match(lab)
            if ok and start_k is None:
                start_k = k
            elif not ok and start_k is not None:
                c_in = u_lo + (start_k + 0.5) * step
                c_out = c_in - step
                lo = _refine(c_out, c_in, match) if start_k > 0 else u_lo
                d_in = u_lo + (k - 1 + 0.5) * step
                d_out = d_in + step
                hi = _refine(d_out, d_in, match) if k < n else u_hi
                if hi - lo > 1e-9:
                    out.append((lo, hi))
                start_k = None
        return out

    # ONE RUN PER GAP, NOT ONE PER CONTIGUOUS STRETCH.
    # A gap whose coverage of the edge is interrupted (a notch in the side
    # region, a sliver of group poking through) used to yield several runs,
    # and the caller drew EVERY one of them at that gap's full measured S:
    # the 12.03 m right setback was emitted 6 times, inflating the openings
    # from 37.31 m to 97.49 m. Runs are now collected per owner and
    # coalesced from the first to the last, absorbing the slivers between.
    gap_runs = []
    for gi in range(len(polys_uv)):
        r = _runs(lambda l, _g=gi: l == _g)
        if not r:
            continue
        gap_runs.append((min(x for x, _y in r), max(y for _x, y in r), gi))
    gap_runs.sort()

    # Groups are then simply what is left between consecutive gaps, so the
    # absorbed slivers cannot be double counted as shadow either.
    # ABSORB SLIVERS.
    # Where a gap's polygon stops a fraction short of the site corner, the
    # leftover reads as a group run of a few centimetres. On the reference
    # run a 0.57 m sliver at the strip start made 3 group runs against 2
    # user groups, the membership match bailed on the count mismatch, and
    # the elevation fell back to overlap -> 4 buildings left, 2 right,
    # against the 3 and 3 the architect defined.
    min_group = max((u_hi - u_lo) * 0.01, 3.0)
    group_runs = []
    cur = u_lo
    for (g_lo, g_hi, _gi) in gap_runs:
        if g_lo - cur > 1e-9:
            group_runs.append((cur, g_lo))
        cur = max(cur, g_hi)
    if u_hi - cur > 1e-9:
        group_runs.append((cur, u_hi))

    keep = [r for r in group_runs if r[1] - r[0] >= min_group]
    if len(keep) != len(group_runs):
        # Hand each sliver to the gap beside it so the edge still tiles.
        gap_runs = [list(g) for g in gap_runs]
        for (s_lo, s_hi) in group_runs:
            if s_hi - s_lo >= min_group:
                continue
            best = None
            best_d = None
            for g in gap_runs:
                d = min(abs(g[0] - s_hi), abs(g[1] - s_lo))
                if best_d is None or d < best_d:
                    best_d = d
                    best = g
            if best is None:
                continue
            best[0] = min(best[0], s_lo)
            best[1] = max(best[1], s_hi)
        gap_runs = [tuple(g) for g in gap_runs]
        gap_runs.sort()
        group_runs = keep
    return gap_runs, group_runs


def _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site,
                          site_loop_uv=None):
    """Clear (open) u-intervals at depth v.

    When site_loop_uv is supplied the open space starts from the SITE's true
    interior at that depth (so nothing extends beyond the boundary);
    otherwise it falls back to the bounding u-range."""
    if site_loop_uv is None:
        site_loop_uv = _SITE_LOOP_UV

    blocked = []
    for ob in obstacles:
        span = ob.u_span_at_v(v)
        if span is not None:
            blocked.append(span)

    if site_loop_uv:
        base = _loop_u_intervals_at_v(site_loop_uv, v)
        if not base:
            return []
    else:
        base = [(u_min_site, u_max_site)]

    if not blocked:
        return base

    blocked.sort()
    merged_b = [list(blocked[0])]
    for lo, hi in blocked[1:]:
        if lo <= merged_b[-1][1] + 1e-9:
            merged_b[-1][1] = max(merged_b[-1][1], hi)
        else:
            merged_b.append([lo, hi])

    result = []
    for (blo, bhi) in base:
        cursor = blo
        for lo, hi in merged_b:
            if hi <= cursor or lo >= bhi:
                continue
            if lo > cursor + 1e-9:
                result.append((cursor, min(lo, bhi)))
            cursor = max(cursor, hi)
            if cursor >= bhi:
                break
        if bhi > cursor + 1e-9:
            result.append((cursor, bhi))
    return result


def _clear_intervals_bbox(v, obstacles, u_min_site, u_max_site):
    """Legacy bounding-box version (kept for the built-in unit tests)."""
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
    Candidate corridor openings.

    The previous version INTERSECTED the clear intervals across every depth,
    which by definition destroyed any corridor that needs to bend (its open
    space at the entry and at the exit don't overlap). Now we take the UNION
    of clear intervals across depths, merged where they overlap, so each
    candidate spans the full lateral range a bending corridor could use.
    The joint centre/angle/bend sweep in _distill_width then explores inside
    that range and finds the real maximum.
    """
    if n is None:
        n = max(8, V_SAMPLES)
    spans = []
    for i in range(n + 1):
        v = v_start + (v_end - v_start) * i / float(n)
        for iv in _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site):
            if iv[1] - iv[0] > 1e-6:
                spans.append([iv[0], iv[1]])
    if not spans:
        return []
    spans.sort()
    merged = [spans[0]]
    for lo, hi in spans[1:]:
        if lo <= merged[-1][1] + 1e-9:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return [(a, b) for a, b in merged if b - a > 1e-6]


def _precompute_stations(v_start, v_end, obstacles, u_min_site, u_max_site,
                         n=None):
    """Clear intervals at each v-station, computed ONCE. The band search
    evaluates thousands of (centre, angle, bend) combinations; without this
    the interval maths would be recomputed every time and the sweep would be
    far too slow in IronPython."""
    if n is None:
        n = max(8, V_SAMPLES)
    stations = []
    for i in range(n + 1):
        v = v_start + (v_end - v_start) * i / float(n)
        stations.append((v, _clear_intervals_at_v(
            v, obstacles, u_min_site, u_max_site)))
    return stations


def _band_width_for(stations, centre_fn):
    """Max constant width of a parallel band whose centreline is centre_fn.
    2 * min over stations of the smaller clearance either side of centre."""
    half_min = None
    for (v, clear) in stations:
        c = centre_fn(v)
        half_here = None
        for (clo, chi) in clear:
            if clo - 1e-6 <= c <= chi + 1e-6:
                half_here = min(c - clo, chi - c)
                break
        if half_here is None or half_here <= 1e-9:
            return 0.0
        if half_min is None or half_here < half_min:
            half_min = half_here
    return 2.0 * half_min if half_min is not None else 0.0


def _parallel_band_min_width(centre_fn, v_start, v_end, obstacles,
                             u_min_site, u_max_site, n=None):
    """Compatibility wrapper (used by tests): builds stations then measures."""
    stations = _precompute_stations(v_start, v_end, obstacles,
                                    u_min_site, u_max_site, n)
    return _band_width_for(stations, centre_fn)


def _bend_return_centre_fn(centre0, angle_rad, v1, v2, v_start, v_end):
    """Centreline of a ONE-bend-and-return parallel band: straight at
    centre0 up to v1, tilted <=15 deg from v1 to v2, then straight again
    (back to the original orientation) through to the exit."""
    t = math.tan(angle_rad)
    shift_total = t * (v2 - v1)

    def centre(v):
        if v <= v1:
            return centre0
        if v >= v2:
            return centre0 + shift_total
        return centre0 + t * (v - v1)
    return centre


def _sweep_bend_return_max_width(centre_lo, centre_hi, v_start, v_end,
                                 obstacles, u_min_site, u_max_site,
                                 n_centre=15, n_angles=16, n_pos=9):
    """
    FULL SWEEP over every 0..15 deg case, per the APP-152 requirement to
    find the MAXIMUM corridor width.

    Searches jointly over:
      * the ENTRY CENTRE position across the candidate opening
        (previously locked to the midpoint, which missed wider corridors
        that enter off-centre and bend across),
      * the bend angle 0..+/-15 deg,
      * the bend start (v1) and return (v2) depths.

    Returns (best_width_ft, best_angle_deg, best_v1, best_v2, best_centre).
    """
    stations = _precompute_stations(v_start, v_end, obstacles,
                                    u_min_site, u_max_site)
    depth = v_end - v_start
    best = (0.0, 0.0, v_start, v_end, 0.5 * (centre_lo + centre_hi))

    if centre_hi < centre_lo:
        centre_lo, centre_hi = centre_hi, centre_lo
    span = centre_hi - centre_lo

    for ci in range(n_centre):
        c0 = centre_lo + span * ci / float(max(1, n_centre - 1))

        # straight baseline at this entry centre
        w = _band_width_for(stations, lambda v, c=c0: c)
        if w > best[0] + 1e-9:
            best = (w, 0.0, v_start, v_end, c0)

        for sign in (1.0, -1.0):
            for ai in range(1, n_angles):
                deg = sign * MAX_DEFLECT_DEG * ai / float(n_angles - 1)
                ang = math.radians(deg)
                for pi in range(n_pos):
                    v1 = v_start + depth * (0.05 + 0.7 * pi / float(n_pos - 1))
                    for qj in range(n_pos):
                        v2 = v1 + depth * (0.05 + 0.85 * qj / float(n_pos - 1))
                        if v2 >= v_end:
                            continue
                        fn = _bend_return_centre_fn(c0, ang, v1, v2,
                                                    v_start, v_end)
                        w = _band_width_for(stations, fn)
                        if w > best[0] + 1e-9:
                            best = (w, deg, v1, v2, c0)
    return best


def _distill_width(cand_lo, cand_hi, v_start, v_end, obstacles,
                   u_min_site, u_max_site):
    """Optimal constant width for this candidate opening, sweeping entry
    centre + angle + bend positions. Returns
    (u_lo, u_hi, width_ft, angle_deg, v1, v2) or None if < 15 m."""
    best_w, best_deg, v1, v2, c0 = _sweep_bend_return_max_width(
        cand_lo, cand_hi, v_start, v_end, obstacles, u_min_site, u_max_site)
    if best_w < MIN_CORRIDOR_FT - 1e-6:
        return None
    return (c0 - best_w / 2.0, c0 + best_w / 2.0, best_w, best_deg, v1, v2)


def _band_polygon(u_lo, u_hi, v_start, v_end, obstacles, u_min_site,
                  u_max_site, axis_u, axis_v, elev,
                  angle_deg=0.0, bend_v1=None, bend_v2=None):
    """
    Build the corridor band polygon as the true BEND-AND-RETURN shape at the
    found constant width, spanning the full site depth.

    The centreline follows the one-bend-and-return path used by the width
    search (straight -> tilt <=15deg -> straight -> return to 0deg), and the
    band is that centreline offset by +/- half-width on each side, kept
    PARALLEL and constant-width throughout. This yields the full hatched
    band (like the target yellow regions) rather than a thin sliver.
    """
    centre0 = 0.5 * (u_lo + u_hi)
    half = 0.5 * (u_hi - u_lo)

    if bend_v1 is None:
        bend_v1 = v_start
    if bend_v2 is None:
        bend_v2 = v_end
    t = math.tan(math.radians(angle_deg))
    shift_total = t * (bend_v2 - bend_v1)

    def centre_u(v):
        if v <= bend_v1:
            return centre0
        if v >= bend_v2:
            return centre0 + shift_total
        return centre0 + t * (v - bend_v1)

    # Sample the centreline at the leg breakpoints so bends are crisp.
    v_nodes = sorted(set([v_start, bend_v1, bend_v2, v_end]))
    # densify each leg a little for smooth offset in world space
    vs = []
    for a, b in zip(v_nodes[:-1], v_nodes[1:]):
        steps = 4
        for k in range(steps):
            vs.append(a + (b - a) * k / float(steps))
    vs.append(v_end)

    left_chain = []
    right_chain = []
    for v in vs:
        c = centre_u(v)
        lo = c - half
        hi = c + half
        # CLIP to the open space at this depth (site outline minus buildings)
        clear = _clear_intervals_at_v(v, obstacles, u_min_site, u_max_site)
        hit = None
        for (clo, chi) in clear:
            if clo - 1e-6 <= c <= chi + 1e-6:
                hit = (clo, chi)
                break
        if hit is None:
            continue          # band centre outside the site here -> no point
        lo = max(lo, hit[0])
        hi = min(hi, hit[1])
        if hi - lo <= 1e-9:
            continue
        left_chain.append(uv_to_point(lo, v, axis_u, axis_v, elev))
        right_chain.append(uv_to_point(hi, v, axis_u, axis_v, elev))

    if len(left_chain) < 2:
        return []
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

    # clip everything to the true site outline (not its bounding box)
    _set_site_context(site_uv)

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
        u_lo, u_hi, width_ft, angle_deg, v1, v2 = distilled
        if width_ft < MIN_CORRIDOR_FT - 1e-6:
            continue
        poly = _band_polygon(
            u_lo, u_hi, v_start, v_end, obstacles,
            u_min_site, u_max_site, axis_u, axis_v, elev,
            angle_deg=angle_deg, bend_v1=v1, bend_v2=v2)
        corridors.append({
            "polygon": poly,
            "width_ft": width_ft,
            "width_m": width_ft * FEET_TO_METERS,
            "u_lo": u_lo,
            "u_hi": u_hi,
            "angle_deg": angle_deg,
            "bend_v1": v1,
            "bend_v2": v2,
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


# ===========================================================================
# TWO-SIDE AVERAGE WIDTH  (Area / D at each side of the site)
# ===========================================================================
# At each side of the site (the two ends along Projection Plane X), the
# region between the common boundary and the street has an AVERAGE width =
# Area / D, where:
#   D    = region DEPTH measured PERPENDICULAR to Plane X (the v-extent),
#   Area = the side region's area, its inner edge a line that may ROTATE up
#          to 15 deg about ANY site-boundary corner, chosen to MAXIMISE the
#          area WITHOUT the rotated line crossing any building ("no further
#          obstruction").
#
# Method:
#   * Take the side's boundary polyline (the inner edge of the side region).
#   * For each candidate pivot corner and each angle 0..15 deg (both signs),
#     rotate the inner edge line about the pivot.
#   * Reject the angle if the rotated line intersects any building loop.
#   * Compute the resulting region area (between rotated line and the outer
#     street edge, clipped to the site) and keep the maximum valid area.
#   * average_width = max_area / D.
# ===========================================================================

def _polygon_area(pts):
    """Shoelace area (unsigned) of a 2D loop of _UV or XYZ-with .X/.Y."""
    n = len(pts)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        ax = a.u if hasattr(a, "u") else a.X
        ay = a.v if hasattr(a, "v") else a.Y
        bx = b.u if hasattr(b, "u") else b.X
        by = b.v if hasattr(b, "v") else b.Y
        s += ax * by - bx * ay
    return abs(s) * 0.5


def _segments_cross(a1, a2, b1, b2):
    """True if 2D segments a1a2 and b1b2 properly intersect. Each arg is a
    (u, v) tuple."""
    def ccw(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1 = ccw(b1, b2, a1)
    d2 = ccw(b1, b2, a2)
    d3 = ccw(a1, a2, b1)
    d4 = ccw(a1, a2, b2)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return True
    return False


def _seg_crosses_any_building(p1_uv, p2_uv, obstacles):
    """True if segment p1->p2 (uv tuples) crosses any building's edges.
    Accepts either Obstacle objects or plain lists of _UV points."""
    for ob in obstacles:
        if hasattr(ob, "is_boundary"):
            if ob.is_boundary:
                continue
            pts = ob.pts
        else:
            pts = ob        # already a list of _UV points
        n = len(pts)
        for i in range(n):
            a = pts[i]
            b = pts[(i + 1) % n]
            if _segments_cross(p1_uv, p2_uv, (a.u, a.v), (b.u, b.v)):
                return True
    return False


def _polyline_u_at_v(cl_uv, v, near_u):
    """u of a centreline polyline at depth v, taking the crossing nearest
    `near_u`. Returns None when the centreline does not reach that depth."""
    best = None
    for i in range(len(cl_uv) - 1):
        a, b = cl_uv[i], cl_uv[i + 1]
        if (a.v <= v <= b.v) or (b.v <= v <= a.v):
            if abs(b.v - a.v) < 1e-12:
                cand = a.u
            else:
                t = (v - a.v) / (b.v - a.v)
                cand = a.u + t * (b.u - a.u)
            if best is None or abs(cand - near_u) < abs(best - near_u):
                best = cand
    return best


def side_average_width(site_pts, building_loops, axis_u, axis_v, side,
                       elev=0.0, max_angle_deg=MAX_DEFLECT_DEG, n_s=48,
                       street_cl_extension_ft=0.0,
                       street_cl_points=None,
                       extension_block_v_spans=None,
                       v_limit_spans=None):
    """
    Average width of ONE side region = Area / D, using the SAME
    corner-driven edge as the corridors (previously this ran a blind
    0..15 deg sweep, which simply maxed out at 15 deg every time -- the
    angle was never derived from the buildings at all).

    The inner edge starts PERPENDICULAR to Projection Plane X, may follow a
    line between two OUTER CORNERS of the outermost building group
    (clamped to <=15 deg), then RETURNS TO PERPENDICULAR. The region is the
    open space between that edge and the site boundary on the chosen side.
    Whichever candidate edge yields the largest clipped area wins, so the
    reported angle comes from the actual building geometry.

    D = region depth perpendicular to Plane X (fixed). avg = Area / D.
    """
    axis_u = _normalize(axis_u)
    axis_v = _normalize(axis_v)
    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts] if site_pts else []
    if len(site_uv) < 3 or not building_loops:
        return None
    _set_site_context(site_uv)

    v_lo = min(p.v for p in site_uv)
    v_hi = max(p.v for p in site_uv)
    D = v_hi - v_lo
    if D < 1e-6:
        return None

    raw = [to_uv(p, axis_u, axis_v) for lp in building_loops for p in lp]
    if len(raw) < 3:
        return None
    # One hull PER BUILDING (see the same change in corridor_between_groups).
    # Hulling all buildings together produced a blob whose u-extent at any
    # depth was far wider than the real footprints, so the "nothing may poke
    # outward past the edge" test pushed the inner edge much further out than
    # necessary and the side region came back smaller than it should be.
    hulls = [_convex_hull_uv([to_uv(p, axis_u, axis_v) for p in lp])
             for lp in building_loops if lp and len(lp) >= 3]
    hulls = [h for h in hulls if h and len(h) >= 3]
    if not hulls:
        return None
    _all_side_corners = [q for h in hulls for q in h]

    # Street centreline in (u,v), if one was supplied for this side. Used
    # to follow the real centreline per depth instead of applying a single
    # mean extension as a flat parallel offset.
    _cl_uv = None
    if street_cl_points and len(street_cl_points) >= 2:
        _cl_uv = [to_uv(p, axis_u, axis_v) for p in street_cl_points]
        _cl_uv.sort(key=lambda q: q.v)

    # outward direction for this side
    # A region end that tapers to (near) nothing is what folds the ring: the
    # inner and outer chains converge, and once they are within rounding of
    # each other they cross. Ending the run while there is still real width
    # removes the degenerate sliver instead of trying to draw it.
    MIN_REGION_W = 0.25          # ft (~75 mm)
    outward = -1.0 if side == "left" else 1.0
    # Only corners on the OUTWARD envelope can be touched by the inner edge
    # (see _silhouette_corners). Cuts the O(n^2) candidate sweep hard.
    hull = _silhouette_corners(hulls, outward)
    debug_print("  [Side {}] {} building hull(s), {} corner(s) -> {} on the "
                "outward silhouette".format(
                    side, len(hulls), len(_all_side_corners), len(hull)))
    tan_max = math.tan(math.radians(max_angle_deg))

    # candidate edges: perpendicular through each hull corner + every
    # hull corner-to-corner direction, clamped, with return-to-perpendicular
    cands = []
    for c1 in hull:
        cands.append((c1.u, c1.v, v_hi, 0.0))
        for c2 in hull:
            dv = c2.v - c1.v
            if abs(dv) < 1e-6:
                continue
            t_raw = (c2.u - c1.u) / dv
            t_use = max(-tan_max, min(tan_max, t_raw))
            # Steeper than 15 deg -> clamp to 15 deg. The edge then never
            # reaches that second corner, so there is nothing to turn back
            # at: it runs straight at 15 deg to the boundary.
            clamped = abs(t_raw) > tan_max + 1e-9
            if c1.v < c2.v:
                v_end = v_hi if clamped else c2.v
                if not clamped:
                    u_at_c2 = c1.u + t_use * (c2.v - c1.v)
                    if _extension_is_clear(u_at_c2, c2.v, t_use, v_hi, hulls):
                        v_end = v_hi
                cands.append((c1.u, c1.v, v_end, t_use))
            else:
                v_end = v_lo if clamped else c2.v
                if not clamped:
                    u_at_c2 = c1.u + (-t_use) * (c2.v - c1.v)
                    if _extension_is_clear(u_at_c2, c2.v, -t_use, v_lo, hulls):
                        v_end = v_lo
                # ANCHOR CORRECTION. _edge_u_at_v treats u1 as the value at
                # the LOW end v1, but for a downward corner pair the corner
                # c1 sits at the HIGH end (v2 = c1.v). Passing c1.u as u1 put
                # the corner at the wrong end, displacing the whole edge
                # sideways by t_use * (c1.v - v_end) -- up to 0.268 * the site
                # depth, i.e. tens of metres. Solve u1 so the edge passes
                # through c1 exactly: u1 + tan*(v2 - v1) == c1.u.
                _u1 = c1.u + t_use * (c1.v - v_end)
                cands.append((_u1, v_end, c1.v, -t_use))

    vs = [v_lo + (v_hi - v_lo) * i / float(n_s) for i in range(n_s + 1)]
    for q in hull:
        if v_lo <= q.v <= v_hi:
            vs.append(q.v)
    # Include every SITE vertex depth (plus a tight pair either side) so the
    # region's ends TRACE the boundary polyline instead of cutting a chord
    # across it. This was only being done for the corridor band, not here.
    for p in site_uv:
        if v_lo <= p.v <= v_hi:
            vs.append(p.v)
            vs.append(p.v - 0.25)
            vs.append(p.v + 0.25)
    # extra density in the outer 5% at each end, where the boundary turns
    span = v_hi - v_lo
    for k in range(41):
        f = k / 40.0
        vs.append(v_lo + span * 0.05 * f)
        vs.append(v_hi - span * 0.05 * f)
    vs = sorted(set(round(x, 4) for x in vs))
    vs = [x for x in vs if v_lo - 1e-9 <= x <= v_hi + 1e-9]

    best = None
    seen = set()
    for (u1, v1, v2, tan_t) in cands:
        key = (round(u1, 3), round(v1, 2), round(v2, 2), round(tan_t, 4))
        if key in seen:
            continue
        seen.add(key)

        area = 0.0
        runs = []          # list of (area, pts_in, pts_out) contiguous runs
        cur_in = []
        cur_out = []
        cur_area = 0.0
        valid = True
        prev_v = None
        for v in vs:
            # TRUNCATE THE REGION AT THE CORRIDOR MOUTH.
            # The side region ran the full site depth. It should stop where
            # the wind corridor's edge crosses the site boundary -- past that
            # point the frontage is the corridor's, not the setback's. Both
            # the integrated AREA and the depth D end there, so S1 = Area/D
            # stays consistent.
            _stop = False
            for _bl, _bh in (v_limit_spans or []):
                if _bl - 1e-9 <= v <= _bh + 1e-9:
                    _stop = True
                    break
            if _stop:
                if len(cur_in) >= 2:
                    runs.append((cur_area, cur_in, cur_out))
                cur_in, cur_out, cur_area = [], [], 0.0
                prev_v = v
                continue
            ue = _edge_u_at_v(v, u1, v1, v2, tan_t)
            # the buildings must not poke OUTWARD past the edge
            b_lo, b_hi = _loops_u_extent_at_v(hulls, v)
            if b_lo is not None:
                if outward < 0 and b_lo < ue - 0.05:
                    valid = False
                    break
                if outward > 0 and b_hi > ue + 0.05:
                    valid = False
                    break
            spans = _loop_u_intervals_at_v(site_uv, v)
            if not spans:
                # break the run: a ring must never jump across a gap
                if len(cur_in) >= 2:
                    runs.append((cur_area, cur_in, cur_out))
                cur_in, cur_out, cur_area = [], [], 0.0
                prev_v = v
                continue
            # Is the street extension allowed at this depth? Past the point
            # where a corridor edge crosses the site boundary, the boundary
            # frontage belongs to the corridor mouth, so the side region
            # stops at the site line there instead of reaching on to the
            # street centreline.
            _extend_here = True
            for _bl, _bh in (extension_block_v_spans or []):
                if _bl - 1e-9 <= v <= _bh + 1e-9:
                    _extend_here = False
                    break
            if outward < 0:
                s_lo, s_hi = spans[0]
                # Follow the ACTUAL centreline at this depth. Collapsing it
                # to one mean number applied as a flat parallel offset is why
                # the region edge did not follow a curving street: on the
                # test model the true extension ranged 11.61-20.82 m while
                # only the 16.49 m mean was used.
                outer = None
                if not _extend_here:
                    outer = s_lo          # stop at the site boundary
                else:
                    if _cl_uv:
                        outer = _polyline_u_at_v(_cl_uv, v, s_lo)
                    if outer is None:
                        outer = s_lo - float(street_cl_extension_ft or 0.0)
                lo, hi = min(outer, s_lo), min(ue, s_hi)
            else:
                s_lo, s_hi = spans[-1]
                outer = None
                if not _extend_here:
                    outer = s_hi          # stop at the site boundary
                else:
                    if _cl_uv:
                        outer = _polyline_u_at_v(_cl_uv, v, s_hi)
                    if outer is None:
                        outer = s_hi + float(street_cl_extension_ft or 0.0)
                lo, hi = max(ue, s_lo), max(outer, s_hi)
            w = hi - lo
            if w <= MIN_REGION_W:
                if len(cur_in) >= 2:
                    runs.append((cur_area, cur_in, cur_out))
                cur_in, cur_out, cur_area = [], [], 0.0
                prev_v = v
                continue
            if prev_v is not None and cur_in:
                cur_area += w * (v - prev_v)
            prev_v = v
            cur_in.append((hi if outward < 0 else lo, v))
            cur_out.append((lo if outward < 0 else hi, v))
        if len(cur_in) >= 2:
            runs.append((cur_area, cur_in, cur_out))
        if not valid or not runs:
            continue
        # keep the single largest contiguous region -> always a simple ring
        area, pts_in, pts_out = max(runs, key=lambda r: r[0])
        if area <= 1e-9 or len(pts_in) < 2:
            continue
        if best is None or area > best[0] + 1e-9:
            best = (area, tan_t, pts_in, pts_out)

    if best is None:
        return None

    area_ft2, tan_t, pts_in, pts_out = best

    # ---- END CAPS: follow the site boundary at the corners --------------
    # At each end the ring closed with a straight chord from the inner edge
    # across to the outer edge. Where the site boundary turns a corner
    # between those two points (the road bending round), that chord cuts
    # the corner off instead of running to where the bent edge actually
    # meets the boundary. Insert the site-boundary vertices that lie
    # between the two endpoints so the cap traces the real corner.
    def _cap_points(p_from, p_to):
        if not site_uv:
            return []
        lo_v = min(p_from[1], p_to[1])
        hi_v = max(p_from[1], p_to[1])
        lo_u = min(p_from[0], p_to[0])
        hi_u = max(p_from[0], p_to[0])
        band_v = max(2.0, (hi_v - lo_v) * 0.5 + 2.0)
        band_u = max(2.0, (hi_u - lo_u) * 0.5 + 2.0)
        cand = [q for q in site_uv
                if (lo_v - band_v) <= q.v <= (hi_v + band_v)
                and (lo_u - band_u) <= q.u <= (hi_u + band_u)]
        if not cand:
            return []
        # order them along the chord so the cap does not double back
        dx = p_to[0] - p_from[0]
        dy = p_to[1] - p_from[1]
        L2 = dx * dx + dy * dy
        if L2 < 1e-12:
            return []
        scored = []
        for q in cand:
            t = ((q.u - p_from[0]) * dx + (q.v - p_from[1]) * dy) / L2
            if 0.02 < t < 0.98:
                scored.append((t, (q.u, q.v)))
        scored.sort()
        return [p for _t, p in scored]

    if len(pts_in) >= 2 and len(pts_out) >= 2:
        cap_start = _cap_points(pts_out[0], pts_in[0])
        cap_end = _cap_points(pts_in[-1], pts_out[-1])
    else:
        cap_start = cap_end = []
    MIN_SEG = 0.1
    chain_a = list(pts_in)

    # Outer edge: trace the REAL site boundary between the region's start and
    # end depths instead of the sampled approximation, so the region follows
    # the outline exactly at corners.
    # NOTE: an earlier attempt built this outer chain by walking the site
    # polygon directly. It traced corners exactly but measured the outer edge
    # against a DIFFERENT representation of the boundary than the inner edge
    # used, and a 300-region fuzz put self-intersections UP from 4 to 16. The
    # sampled interval is the same locus the rest of the engine measures
    # against, so both chains stay consistent; degenerate ends are handled by
    # MIN_REGION_W below instead.
    chain_b = list(reversed(pts_out))
    # drop collinear points: the dense boundary sampling is needed to FIND
    # the shape, but the drawn region only needs its corners.
    # Simplify each CHAIN separately, never across the junction: the two
    # points where the inner chain meets the outer chain are the region's
    # end caps, and deleting a cap corner collapses the ring.
    simp = _dp_simplify(chain_a) + _dp_simplify(chain_b)
    poly = []
    for (u, v) in simp:
        p = uv_to_point(u, v, axis_u, axis_v, elev)
        if not poly or p.DistanceTo(poly[-1]) >= MIN_SEG:
            poly.append(p)
    if len(poly) >= 2 and poly[0].DistanceTo(poly[-1]) < MIN_SEG:
        poly.pop()
    if len(poly) < 3:
        poly = []
    else:
        _ring_problems(poly, "side region '{}'".format(side))

    # Report AREA and DEPTH from the polygon that is actually drawn, not from
    # the integration stations.
    #
    # area_ft2 came from a rectangle-rule sum over the sampling stations, and
    # D was the depth of the WHOLE SITE. Neither matched the FilledRegion:
    # Revit reported 1349.782 m2 against a printed 1347.91 m2, and the site
    # depth (159.36 m) is not the depth of the region being measured. Both
    # numbers now come from the drawn ring, so the calculation printed beside
    # the hatch agrees with the element the checker will query.
    if poly:
        area_ft2_drawn = _poly_area_xy(poly)
        poly_uv = [to_uv(p, axis_u, axis_v) for p in poly]
        region_v_lo = min(q.v for q in poly_uv)
        region_v_hi = max(q.v for q in poly_uv)
        D_used = region_v_hi - region_v_lo
        debug_print(
            "  [Side {}] area: integrated {:.1f} m2 -> drawn {:.1f} m2 | "
            "depth: site {:.2f} m -> region {:.2f} m".format(
                side,
                area_ft2 * FEET_TO_METERS * FEET_TO_METERS,
                area_ft2_drawn * FEET_TO_METERS * FEET_TO_METERS,
                D * FEET_TO_METERS, D_used * FEET_TO_METERS))
    else:
        area_ft2_drawn = area_ft2
        D_used = D

    area_m2 = area_ft2_drawn * FEET_TO_METERS * FEET_TO_METERS
    D_m = D_used * FEET_TO_METERS
    return {
        "area_m2": area_m2,
        "D_m": D_m,
        "site_D_m": D * FEET_TO_METERS,
        "avg_width_m": area_m2 / D_m if D_m > 1e-9 else 0.0,
        "angle_deg": math.degrees(math.atan(tan_t)),
        "side": side,
        "region_polygon": poly,
        "street_cl_extension_m": float(street_cl_extension_ft or 0.0) * FEET_TO_METERS,
        # Where the strip was terminated and why, so the plan can draw the
        # cut and the log can name it. Filled in by compute_side_averages.
        "terminations": [],
    }


def corridor_mouth_v_spans(corridors, site_pts, axis_u, axis_v, side,
                           tol_ft=2.0):
    """Depth ranges where a wind corridor MEETS the site boundary on `side`.

    A corridor that reaches the edge of the site opens a mouth onto it. The
    side region's street extension must not run across that mouth -- the
    extension belongs to the setback, and past the point where the corridor
    edge crosses the boundary it is the corridor's frontage, not the side
    region's.

    Returns [(v_lo, v_hi), ...], one span per corridor that touches this
    side, so the caller can suppress the extension over exactly those
    depths. Corridors that never reach this side return nothing.
    """
    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts or []]
    if len(site_uv) < 3:
        return []
    spans = []
    for c in corridors or []:
        poly = (c or {}).get("polygon")
        if not poly or len(poly) < 3:
            continue
        # A REJECTED corridor opens no mouth. A collapsed band degenerates
        # onto the boundary, so every one of its vertices reads as a contact
        # point: on the Y pass a 0.04 m rejected corridor suppressed the
        # street extension over 165.9 m of a 169 m boundary -- the whole
        # side region lost its extension.
        if not c.get("qualifies", True):
            continue
        if (c.get("width_m") or 0.0) < MIN_CORRIDOR_M:
            continue
        touch_v = []
        for p in poly:
            q = to_uv(p, axis_u, axis_v)
            ivals = _loop_u_intervals_at_v(site_uv, q.v)
            if not ivals:
                continue
            # `side` names which end of the site's u-extent this region sits
            # against: left = low u, right = high u.
            edge_u = ivals[0][0] if side == "left" else ivals[-1][1]
            if abs(q.u - edge_u) <= tol_ft:
                touch_v.append(q.v)
        if len(touch_v) >= 2:
            lo, hi = min(touch_v), max(touch_v)
            if hi - lo > 1e-6:
                spans.append((lo, hi))
    return spans


def side_boundary_corner_vs(site_pts, axis_u, axis_v, side,
                            min_turn_deg=60.0, tol_ft=2.0,
                            keep_out_of=None):
    """Depths at which the site boundary TURNS A CORNER on this side.

    A setback strip follows one frontage. Where the boundary turns, the
    frontage beyond the corner is a different one and the strip must end --
    it was running straight past the corner and on down the next edge.

    Returns a list of v values (one per corner) on the given side.
    """
    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts or []]
    n = len(site_uv)
    if n < 4:
        return []

    def _on_side(a, b):
        um = 0.5 * (a.u + b.u)
        vm = 0.5 * (a.v + b.v)
        ivs = _loop_u_intervals_at_v(site_uv, vm)
        if not ivs:
            return False
        edge_u = ivs[0][0] if side == "left" else ivs[-1][1]
        return abs(um - edge_u) <= tol_ft

    flags = [_on_side(site_uv[i], site_uv[(i + 1) % n]) for i in range(n)]

    # CUMULATIVE TURN, NOT PER-VERTEX TURN.
    # A road bend arrives tessellated into dozens of short segments, each
    # turning two or three degrees. A per-vertex test never fires on it, so
    # the right-hand strip ran the full site depth straight round the bend.
    # Turning is accumulated from the start of each straight run instead:
    # the corner is where the direction has drifted min_turn_deg away from
    # where the run began, however gradually it got there.
    out = []
    ref = None
    for i in range(n):
        j = (i + 1) % n
        if not flags[i]:
            ref = None
            # Leaving this side's frontage is itself an end of it.
            if i > 0 and flags[i - 1]:
                out.append(site_uv[i].v)
            continue
        dx = site_uv[j].u - site_uv[i].u
        dy = site_uv[j].v - site_uv[i].v
        L = math.sqrt(dx * dx + dy * dy)
        if L < 1e-9:
            continue
        dx /= L
        dy /= L
        if ref is None:
            ref = (dx, dy)
            continue
        cosang = max(-1.0, min(1.0, ref[0] * dx + ref[1] * dy))
        if math.degrees(math.acos(cosang)) >= min_turn_deg:
            out.append(site_uv[i].v)
            ref = (dx, dy)          # start measuring the next run from here

    # One physical corner can produce several vertices a few centimetres
    # apart (the log showed "121.9, 122.0, 121.9" for a single corner).
    out.sort()
    merged = []
    for v in out:
        if not merged or abs(v - merged[-1]) > tol_ft:
            merged.append(v)

    # A ROAD BEND IS NOT A CORNER TO CUT AT.
    # At 25 deg a smooth 90 deg bend tessellated into 3 deg steps produced a
    # "corner" every few metres (80.0, 86.3, 103.5, 115.6, 120.0 on the test
    # bend). The strip then stopped at the first of them -- the START of the
    # bend -- instead of running round it, the region got chopped into many
    # pieces so the largest-run pick could land on a stray fragment, and if
    # the surviving piece no longer touched the near edge the whole side
    # region dropped out of the elevation and the bar. 60 deg keeps genuine
    # corners and ignores road curvature.
    #
    # keep_out_of is the v-span the BUILDINGS occupy. The frontage alongside
    # the buildings is the setback proper and must never be cut; only a
    # corner beyond them can terminate the strip.
    if keep_out_of:
        b_lo, b_hi = keep_out_of
        # SPLIT POINT, NOT EXCLUSION SPAN.
        # Excluding every corner inside the buildings' depth span is frame
        # dependent: on Plane X the buildings occupy a narrow band and
        # corners beyond them survive, but on Plane Y they span nearly the
        # whole depth, so every corner was filtered away and the Y strips
        # ran the full site depth with no terminator at all. Splitting at
        # the buildings' midpoint gives the same answer on X and still
        # fires on Y.
        b_mid = 0.5 * (b_lo + b_hi)

        # RUN ROUND THE BEND, NOT UP TO IT.
        # A bend still yields several corners as the direction keeps
        # drifting. Cutting at the first of them stops the strip where the
        # bend BEGINS; it should carry on until the boundary stops turning
        # -- i.e. to the far end of the bend, furthest from the buildings.
        # One terminator per direction, therefore: the outermost.
        # The site's own first and last vertex are ends of the site, not
        # corners that terminate a strip. Left in, max(above) picked the far
        # site vertex instead of the end of the bend, the span filter then
        # discarded it as out of range, and no cut happened at all.
        _svs = [q.v for q in site_uv]
        _s_lo, _s_hi = min(_svs), max(_svs)
        # Scale the end tolerance to the site. A fixed 2 ft let a corner
        # 0.63 m from the site's own end vertex through on a 170.93 m site,
        # and the block then lopped 3.5 m off the strip for nothing.
        _end_tol = max(tol_ft, (_s_hi - _s_lo) * 0.02)
        merged = [v for v in merged
                  if abs(v - _s_lo) > _end_tol and abs(v - _s_hi) > _end_tol]
        below = [v for v in merged if v < b_mid]
        above = [v for v in merged if v > b_mid]
        merged = ([min(below)] if below else []) + \
                 ([max(above)] if above else [])
    return merged


def compute_side_averages(site_pts, building_loops, axis_u, axis_v, elev=0.0,
                          street_cl_extensions=None,
                          corridor_polygons=None):
    """Run side_average_width for the left and right side regions."""
    out = []
    for side in ("left", "right"):
        try:
            _ex = street_cl_extensions or {}
            ext = _ex.get(side, 0.0)
            # the centreline itself, when the caller supplied it, so the
            # region edge can follow the real street rather than a mean
            cl_pts = _ex.get(side + "_cl") or _ex.get("centreline_" + side)
            blocks = corridor_mouth_v_spans(
                corridor_polygons, site_pts, axis_u, axis_v, side)
            # The strip ends at whichever comes first: the corridor mouth,
            # or a corner in the site boundary. Corners are inserted as thin
            # breaks -- side_average_width keeps the largest contiguous run,
            # so the region simply stops at the nearer of the two.
            _b_uv = []
            for _lp in building_loops or []:
                _b_uv += [to_uv(p, axis_u, axis_v).v for p in (_lp or [])]
            _keep_out = ((min(_b_uv), max(_b_uv)) if _b_uv else None)
            _corner_vs = side_boundary_corner_vs(
                site_pts, axis_u, axis_v, side, keep_out_of=_keep_out)
            _suv = [to_uv(p, axis_u, axis_v) for p in site_pts or []]
            _v_lo = min(q.v for q in _suv) if _suv else 0.0
            _v_hi = max(q.v for q in _suv) if _suv else 0.0
            _cut = max((_v_hi - _v_lo) / 48.0, 0.5)
            # BLOCK FROM THE CORNER OUTWARD, NOT ACROSS IT.
            # A symmetric span (cv - cut, cv + cut) removes the station
            # BEFORE the corner as well as the one after, so the strip
            # stopped a full station short of the boundary: with cut =
            # depth/48 = 3.33 m the left strip ended at 121.9 - 3.33 =
            # 118.6 m against the 117.99 m reported, when it should reach
            # the corner itself. The block now starts AT the corner and runs
            # away from the buildings, so the strip ends exactly on it.
            _b_mid = (0.5 * (_keep_out[0] + _keep_out[1]) if _keep_out
                      else 0.5 * (_v_lo + _v_hi))
            corner_spans = []
            _kept_vs = []
            for cv in _corner_vs:
                if not (_v_lo + 1e-9 < cv < _v_hi - 1e-9):
                    continue
                if cv >= _b_mid:
                    corner_spans.append((cv, cv + 2.0 * _cut))
                else:
                    corner_spans.append((cv - 2.0 * _cut, cv))
                _kept_vs.append(cv)
            if corner_spans:
                debug_print(
                    "  [Side {}] {} boundary corner(s) terminate the strip "
                    "at v = {}".format(
                        side, len(corner_spans),
                        ", ".join("{:.1f} m".format(cv * FEET_TO_METERS)
                                  for cv in _kept_vs)))
            if blocks:
                debug_print(
                    "  [Side {}] extension suppressed over {} corridor "
                    "mouth(s): {}".format(
                        side, len(blocks),
                        ", ".join("v {:.1f}..{:.1f} m".format(
                            a * FEET_TO_METERS, b * FEET_TO_METERS)
                            for a, b in blocks)))
            # The same corridor mouths both suppress the street extension
            # and terminate the region: everything beyond the intersection
            # of the boundary with the corridor edge belongs to the corridor.
            r = side_average_width(site_pts, building_loops, axis_u, axis_v,
                                   side, elev,
                                   street_cl_extension_ft=ext,
                                   street_cl_points=cl_pts,
                                   extension_block_v_spans=blocks,
                                   v_limit_spans=list(blocks) + corner_spans)
            if r is not None:
                # Report the CORNER, not the block midpoint. The block is
                # one-sided, so its midpoint sits half a block away from the
                # cut -- the log named -173.9 m for a corner at -170.3 m,
                # and the drawn marker landed there too.
                terms = ([("corridor", 0.5 * (a + b)) for a, b in blocks]
                         + [("corner", cv) for cv in _kept_vs])
                r["terminations"] = terms
                if terms:
                    debug_print(
                        "  [Side {}] terminated by: {}".format(
                            side, ", ".join(
                                "{} at v = {:.1f} m".format(
                                    why, v * FEET_TO_METERS)
                                for why, v in terms)))
                else:
                    debug_print(
                        "  [Side {}] no terminator found; the strip runs the "
                        "full site depth ({:.1f} m).".format(
                            side, r.get("site_D_m", 0.0)))
        except Exception:
            r = None
        if r is not None:
            out.append(r)
    return out


# ===========================================================================
# CORNER-DRIVEN GAP CORRIDOR  (explicit two-group method)
# ===========================================================================
# The user selects group A and group B; the corridor is the widest constant
# -width band that fits between them, whose edge is a line through one of
# A's corners deviating at most 15 deg from the perpendicular to Plane X.
# For each corner c of A the candidate directions are the perpendicular and
# c->c2 for every other corner c2 of A (so the edge follows the outline
# instead of cutting through it), each clamped to +/-15 deg. A candidate is
# valid only if no part of A pokes past it into the gap; its width is the
# nearest B corner measured perpendicular to the line. Max width wins.
# ===========================================================================

# ===========================================================================
# CONTEXT OBSTACLES
# ===========================================================================
# Buildings that are NOT in either picked group must still be able to narrow
# or block a corridor. Before this existed, _band_from_edge only ever ray-cast
# against `other_uv` and _extension_is_clear only ever saw own+other, so a
# third block standing in the gap had literally zero effect on the result and
# the band was drawn straight through it.
#
# Context loops are used for CLEARANCE ONLY. They never contribute corner
# candidates: the <=15 deg bend is defined as running between two corners of
# the SAME group, and letting arbitrary buildings supply corners would change
# that specification. So context can narrow or reject a corridor, never steer
# one. It cannot over-report, which is the only direction that matters for a
# submission.
# ===========================================================================

def _dp_simplify(chain, tol=0.05):
    """
    Douglas-Peucker simplification of an OPEN chain of (u, v) points.

    Replaces the previous per-point collinearity test, which compared each
    point against its ORIGINAL immediate neighbours. That is not a valid
    simplification: the side sampler plants stations at every site vertex
    +/-0.25 ft plus 41 extra samples in the outer 5%, so neighbours can sit
    ~0.1 ft apart, and at that spacing a real corner deviates far less than
    the tolerance and was deleted -- while sparser points elsewhere survived
    and chorded across the hole.

    Douglas-Peucker measures deviation from the chord between RETAINED
    points, so a corner is only removed when the simplified chain genuinely
    stays within tol of the original.
    """
    n = len(chain)
    if n < 3:
        return list(chain)
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        au, av = chain[i0]
        bu, bv = chain[i1]
        du, dv = bu - au, bv - av
        L = math.hypot(du, dv)
        worst = -1.0
        wi = -1
        for k in range(i0 + 1, i1):
            cu, cv = chain[k]
            if L < 1e-12:
                d = math.hypot(cu - au, cv - av)
            else:
                d = abs((cu - au) * dv - (cv - av) * du) / L
            if d > worst:
                worst = d
                wi = k
        if wi > 0 and worst > tol:
            keep[wi] = True
            stack.append((i0, wi))
            stack.append((wi, i1))
    return [chain[i] for i in range(n) if keep[i]]


def _ring_problems(pts, tag):
    """
    Diagnose a closed world-space ring BEFORE handing it to Revit.

    Revit's FilledRegion.Create raises one generic message for every kind of
    bad boundary ("curve loops cannot compose a valid boundary"), which says
    nothing about which defect occurred or where. This reports the actual
    cause and coordinates so a failure on a real site is actionable instead
    of a guess.
    """
    problems = []
    n = len(pts)
    if n < 3:
        problems.append("only {} point(s)".format(n))
        return problems

    short = []
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        d = math.hypot(b.X - a.X, b.Y - a.Y)
        if d < 0.0033:                      # Revit ShortCurveTolerance ~1/32"
            short.append((i, d))
    if short:
        problems.append("{} segment(s) under ShortCurveTolerance, "
                        "shortest {:.5f} ft at index {}".format(
                            len(short), min(d for _, d in short),
                            short[0][0]))

    dup = []
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if math.hypot(pts[i].X - pts[j].X, pts[i].Y - pts[j].Y) < 1e-6:
                dup.append((i, j))
    if dup:
        problems.append("{} coincident non-adjacent point pair(s), "
                        "first {}".format(len(dup), dup[0]))

    def _o(p, q, r):
        return ((q.X - p.X) * (r.Y - p.Y)) - ((q.Y - p.Y) * (r.X - p.X))

    crosses = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            c, d = pts[j], pts[(j + 1) % n]
            d1, d2, d3, d4 = _o(c, d, a), _o(c, d, b), _o(a, b, c), _o(a, b, d)
            if (((d1 > 1e-9) != (d2 > 1e-9)) and
                    ((d3 > 1e-9) != (d4 > 1e-9)) and
                    abs(d1) > 1e-9 and abs(d2) > 1e-9 and
                    abs(d3) > 1e-9 and abs(d4) > 1e-9):
                crosses.append((i, j))
    if crosses:
        i, j = crosses[0]
        problems.append(
            "{} self-intersection(s); first between edge {}->{} "
            "[({:.2f},{:.2f})->({:.2f},{:.2f})] and edge {}->{} "
            "[({:.2f},{:.2f})->({:.2f},{:.2f})]".format(
                len(crosses), i, (i + 1) % n,
                pts[i].X, pts[i].Y, pts[(i + 1) % n].X, pts[(i + 1) % n].Y,
                j, (j + 1) % n,
                pts[j].X, pts[j].Y, pts[(j + 1) % n].X, pts[(j + 1) % n].Y))

    if problems:
        debug_print("  [Ring] {} INVALID ({} pts): {}".format(
            tag, n, "; ".join(problems)))
    return problems


def _silhouette_corners(hulls, side_sign, tol=0.05):
    """
    Keep only the corners that lie ON the group's facing envelope.

    A tangent edge touches the group where the edge value equals the group's
    extreme u at that depth. A corner buried behind another building can
    never be touched, so evaluating it is wasted work -- and with one hull
    per building the corner count jumped from ~21 to ~76, making the O(n^2)
    candidate search 13x more expensive for no additional answers.

    side_sign > 0 keeps the +u (right) envelope, < 0 keeps the -u (left).
    """
    out = []
    for h in hulls:
        for c in h:
            lo, hi = _loops_u_extent_at_v(hulls, c.v)
            if lo is None:
                continue
            if side_sign > 0:
                if c.u >= hi - tol:
                    out.append(c)
            else:
                if c.u <= lo + tol:
                    out.append(c)
    return out or [q for h in hulls for q in h]


def _boundary_chain_uv(site_uv, outward, v_start, v_end):
    """
    The TRUE site boundary polyline between two depths, on one side.

    The outer edge of a side region used to be built by sampling the site's
    u-interval at discrete depths, so between samples it drew a straight
    chord and at a sharp turn in the boundary the region cut the corner off.
    Walking the real polygon instead makes the drawn edge geometrically
    identical to the site outline rather than an approximation of it.

    The closed site loop is split at its global v-minimum and v-maximum into
    two chains; the one whose mean u is on the requested side is the outward
    boundary. Returns [(u, v), ...] ordered from the lower depth to the
    higher, with the two end points interpolated exactly onto the boundary.
    """
    n = len(site_uv)
    if n < 3:
        return []
    i_min = min(range(n), key=lambda i: site_uv[i].v)
    i_max = max(range(n), key=lambda i: site_uv[i].v)
    if i_min == i_max:
        return []

    def _walk(a, b, step):
        out = []
        i = a
        for _ in range(n + 1):
            out.append(site_uv[i])
            if i == b:
                return out
            i = (i + step) % n
        return out

    c_fwd = _walk(i_min, i_max, 1)
    c_bwd = _walk(i_min, i_max, -1)
    if len(c_fwd) < 2 or len(c_bwd) < 2:
        return []
    m_fwd = sum(q.u for q in c_fwd) / float(len(c_fwd))
    m_bwd = sum(q.u for q in c_bwd) / float(len(c_bwd))
    if outward < 0:
        chain = c_fwd if m_fwd <= m_bwd else c_bwd
    else:
        chain = c_fwd if m_fwd >= m_bwd else c_bwd

    lo = min(v_start, v_end)
    hi = max(v_start, v_end)

    def _u_at(vq):
        best = None
        for k in range(len(chain) - 1):
            a = chain[k]
            b = chain[k + 1]
            if abs(b.v - a.v) < 1e-12:
                continue
            if (a.v - vq) * (b.v - vq) <= 0.0:
                t = (vq - a.v) / (b.v - a.v)
                cand = a.u + (b.u - a.u) * t
                if best is None:
                    best = cand
                elif outward < 0:
                    best = min(best, cand)
                else:
                    best = max(best, cand)
        return best

    u0 = _u_at(lo)
    u1 = _u_at(hi)
    if u0 is None or u1 is None:
        return []

    pts = [(u0, lo)]
    for q in chain:
        if lo + 1e-9 < q.v < hi - 1e-9:
            pts.append((q.u, q.v))
    pts.append((u1, hi))
    pts.sort(key=lambda z: z[1])
    return pts


def _chain_u_at(chain, vq, outward):
    """Outward-most u of a walked boundary chain at depth vq, or None."""
    best = None
    for k in range(len(chain) - 1):
        au, av = chain[k]
        bu, bv = chain[k + 1]
        if abs(bv - av) < 1e-12:
            cand = au if outward < 0 else bu
        elif (av - vq) * (bv - vq) <= 0.0:
            t = (vq - av) / (bv - av)
            cand = au + (bu - au) * t
        else:
            continue
        if best is None:
            best = cand
        elif outward < 0:
            best = min(best, cand)
        else:
            best = max(best, cand)
    return best


def corridor_interval_on_plane(polygon, axis_u, axis_v, v_plane, tol=1e-6):
    """
    Where a corridor band crosses Projection Plane X: (u_lo, u_hi) or None.

    This is the OPENING that appears in the deformed elevation. The corridor
    enters perpendicular to Plane X, so its cross-section at the plane is the
    corridor width S itself -- no cosine correction. Both the position and
    the width of the opening come from here, and the obstructions are then
    just the leftover shadow between consecutive openings (see
    openings_and_shadows).

    polygon is the world-space band ring; v_plane is the depth of the plane
    in the same (u, v) frame.
    """
    if not polygon or len(polygon) < 3:
        return None
    uv = [to_uv(p, axis_u, axis_v) for p in polygon]
    n = len(uv)
    xs = []
    for i in range(n):
        a = uv[i]
        b = uv[(i + 1) % n]
        if abs(b.v - a.v) < 1e-12:
            if abs(a.v - v_plane) < 1e-6:
                xs.append(a.u)
                xs.append(b.u)
            continue
        if (a.v - v_plane) * (b.v - v_plane) <= 0.0:
            t = (v_plane - a.v) / (b.v - a.v)
            xs.append(a.u + (b.u - a.u) * t)
    if len(xs) < 2:
        return None
    return min(xs), max(xs)


def opening_at_near_boundary(polygon, site_pts, axis_u, axis_v,
                             near_is_low_v=True, band_frac=0.04,
                             tol_ft=3.0):
    """Where a corridor / side region MEETS the site boundary nearest Plane X.

    This is the architect's definition of the opening: take the points where
    the corridor (or air gap) crosses the site boundary on the side facing
    the plane, drop perpendiculars from them onto the plane, and the distance
    between those perpendiculars is the opening. Everything left over between
    consecutive openings is shadow -- see openings_and_shadows.

    Why not corridor_interval_on_plane at a single v: slicing every band at
    one flat depth (v = min site v) fails on a real site, where that depth is
    a single CORNER. Bands get clipped to almost nothing there -- three
    openings once summed to 3.00 m instead of ~37 m. The mouth is found per
    polygon instead, at whatever depth that polygon actually reaches the
    boundary.

    Returns (u_lo, u_hi) or None.
    """
    if not polygon or len(polygon) < 3 or not site_pts:
        return None
    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts]
    if len(site_uv) < 3:
        return None
    uv = [to_uv(p, axis_u, axis_v) for p in polygon]

    v_site_lo = min(q.v for q in site_uv)
    v_site_hi = max(q.v for q in site_uv)
    depth = v_site_hi - v_site_lo
    if depth < 1e-9:
        return None
    band = max(tol_ft, depth * band_frac)

    # Points of the polygon that sit ON the site boundary. The bands are
    # clipped to the site, so the mouth vertices already lie on it.
    on_edge = []
    for q in uv:
        ivals = _loop_u_intervals_at_v(site_uv, q.v)
        if not ivals:
            continue
        for (a, b) in ivals:
            if abs(q.u - a) <= tol_ft or abs(q.u - b) <= tol_ft:
                on_edge.append(q)
                break

    # Keep the contacts on the side FACING the plane, within a band of the
    # nearest one, so a corridor that also touches the far boundary does not
    # contribute its far mouth to this plane's opening.
    pool = on_edge if len(on_edge) >= 2 else uv
    if near_is_low_v:
        v_ref = min(q.v for q in pool)
        mouth = [q for q in pool if q.v <= v_ref + band]
    else:
        v_ref = max(q.v for q in pool)
        mouth = [q for q in pool if q.v >= v_ref - band]
    if len(mouth) < 2:
        return None
    us = [q.u for q in mouth]
    lo, hi = min(us), max(us)
    if hi - lo < 1e-9:
        return None
    return lo, hi


def openings_and_shadows(openings, site_lo, site_hi, min_shadow=0.1):
    # min_shadow defaults to 0.1 ft, NOT 1e-6. The old default is a third of
    # a micron, so a numerically-zero leftover survived as a real interval:
    # the Y pass emitted "shadow 0.00m x 20.0m" and Revit then threw
    #   "Curve length is too small for Revit's tolerance"
    # three times while trying to draw it. 0.1 ft matches the MIN_SEG floor
    # the rest of this module already uses for drawn geometry.
    """
    Lay out one deformed-elevation strip.

    openings : list of (u_lo, u_hi) where corridors/gaps cross Plane X.
    Returns (merged_openings, shadows). The shadows are the OBSTRUCTIONS --
    the leftover intervals between consecutive openings and out to the site
    edges. Because they are the complement, the two always sum to W exactly,
    so no rule is needed for how obstruction width is apportioned.
    """
    clean = []
    for lo, hi in openings or []:
        if lo is None or hi is None:
            continue
        a, b = min(lo, hi), max(lo, hi)
        a = max(a, site_lo)
        b = min(b, site_hi)
        if b - a > min_shadow:
            clean.append((a, b))
    clean.sort()

    merged = []
    for a, b in clean:
        if merged and a <= merged[-1][1] + min_shadow:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))

    shadows = []
    cursor = site_lo
    for a, b in merged:
        if a - cursor > min_shadow:
            shadows.append((cursor, a))
        cursor = max(cursor, b)
    if site_hi - cursor > min_shadow:
        shadows.append((cursor, site_hi))
    return merged, shadows


def _subtract_intervals(a, b, openings, tol=1e-9):
    """[a,b] minus a sorted, merged list of open intervals."""
    out = []
    cur = a
    for lo, hi in openings:
        if hi <= cur + tol or lo >= b - tol:
            continue
        if lo > cur + tol:
            out.append((cur, min(lo, b)))
        cur = max(cur, hi)
        if cur >= b - tol:
            break
    if b - cur > tol:
        out.append((cur, b))
    return out


def deformed_elevation(openings, obstructions, h_max,
                       site_lo=None, site_hi=None):
    """
    Build one zone's deformed elevation and its P.

    P IS AN AREA RATIO, and W IS DERIVED, NOT GIVEN.

        W = SUM(opening widths) + SUM(shadow widths)
        P = 1 - SUM(shadow_width_i * h_i) / (W * H)

    W is NOT the site projection width. The openings are the corridors where
    they cross Plane X and the shadows are the buildings' own footprints on
    the plane, so both change with the corridor solution and W changes with
    them. Two different corridor solutions on the same site therefore have
    different W -- that is by design, not an inconsistency.

    H is the TALLEST building in the zone. A building casts a shadow only up
    to its OWN height, so the band of open sky above a shorter one counts as
    IS: a 14 m building in a 20 m zone blocks 14 m and gives back 6 m.

    openings     : [(u_lo, u_hi)] corridor/gap crossings of Plane X.
    obstructions : [(u_lo, u_hi, height)] one per building, projected onto
                   Plane X. Any overlap with an opening is removed, so a
                   building a corridor cuts into casts a smaller shadow
                   without the caller doing anything.

    site_lo/site_hi are optional and only CLIP the inputs; they never set W.
    """
    if h_max <= 1e-9:
        return {"P": 0.0, "W": 0.0, "h_max": h_max, "total_area": 0.0,
                "obstruction_area": 0.0, "is_area": 0.0, "blocks": [],
                "openings": [], "sky_blocks": []}

    clean = []
    for lo, hi in openings or []:
        if lo is None or hi is None:
            continue
        a_, b_ = min(lo, hi), max(lo, hi)
        if site_lo is not None:
            a_ = max(a_, site_lo)
        if site_hi is not None:
            b_ = min(b_, site_hi)
        if b_ - a_ > 1e-9:
            clean.append((a_, b_))
    clean.sort()
    merged = []
    for a_, b_ in clean:
        if merged and a_ <= merged[-1][1] + 1e-9:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b_))
        else:
            merged.append((a_, b_))

    blocks = []
    sky = []
    obstruction_area = 0.0
    shadow_width = 0.0
    for ob in obstructions or []:
        lo, hi, h = ob[0], ob[1], ob[2]
        if site_lo is not None:
            lo = max(lo, site_lo)
        if site_hi is not None:
            hi = min(hi, site_hi)
        if hi - lo <= 1e-9 or h <= 0.0:
            continue
        for a_, b_ in _subtract_intervals(lo, hi, merged):
            w = b_ - a_
            if w <= 1e-9:
                continue
            hh = min(h, h_max)
            blocks.append((a_, b_, hh))
            # AREAS IN m2. Widths are in FEET (u-coordinates) and heights in
            # METRES, so the product is feet-metres. Converting the width
            # here keeps every reported area in m2; callers must NOT apply a
            # second conversion. Reporting ft*m and then multiplying by
            # FEET_TO_METERS^2 made the stamped total 1035 m2 where the drawn
            # region measured 3396 m2.
            obstruction_area += (w * FEET_TO_METERS) * hh
            shadow_width += w
            if h_max - hh > 1e-9:
                sky.append((a_, b_, hh, h_max))

    opening_width = sum(b_ - a_ for a_, b_ in merged)
    W = opening_width + shadow_width
    if W <= 1e-9:
        return {"P": 0.0, "W": 0.0, "h_max": h_max, "total_area": 0.0,
                "obstruction_area": 0.0, "is_area": 0.0, "blocks": [],
                "openings": merged, "sky_blocks": []}

    total = (W * FEET_TO_METERS) * h_max      # m2
    is_area = total - obstruction_area
    return {
        "P": 100.0 * is_area / total,
        "W": W,                                # feet
        "opening_width": opening_width,
        "shadow_width": shadow_width,
        "h_max": h_max,
        "total_area": total,
        "obstruction_area": obstruction_area,
        "is_area": is_area,
        "blocks": blocks,
        "sky_blocks": sky,
        "openings": merged,
    }


NEAR_FACE_PARALLEL_RATIO = 1.0
# An edge counts as part of the NEAR FACE when |du| >= ratio * |dv|, i.e. it
# runs more along the projection plane than across it. At 1.0 the cut is 45
# degrees: walls are kept, the end-wall returns that only smear the
# building's DEPTH along the plane are dropped. Raise it to keep only walls
# closely parallel to the plane; lower it toward 0 to keep everything (which
# reproduces the old full-silhouette behaviour).


def near_face_u_span(loop_uv, near_is_low_v=True,
                     parallel_ratio=NEAR_FACE_PARALLEL_RATIO):
    """u-extent of the footprint's face NEAREST the projection plane.

    The elevation used min(u)..max(u) over the whole footprint. For a
    building skewed to the plane that span is
        L*cos(theta) + D*sin(theta)
    -- the second term is the building's DEPTH smeared along the plane, and
    it comes from the corner on the FAR face. The near facade alone spans
    L*cos(theta). Using the full silhouette therefore widened every skewed
    block and inflated W past the real site projection width.

    Method: keep the boundary edges that face the plane, drop the ones that
    run across it (the end-wall returns), and take the extent of what is
    left. Falls back to the full span if nothing survives -- a footprint at
    45 degrees or more to the plane has no face that reads as "near".

    Returns (u_lo, u_hi, used_near_face).
    """
    pts = [(q.u, q.v) for q in loop_uv]
    if len(pts) < 3:
        if not pts:
            return (0.0, 0.0, False)
        us = [p[0] for p in pts]
        return (min(us), max(us), False)
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        us = [p[0] for p in pts]
        return (min(us), max(us), False)

    full_lo = min(p[0] for p in pts)
    full_hi = max(p[0] for p in pts)

    ccw = _poly_ccw(list(pts))
    # For a CCW ring the outward normal of edge (du, dv) is (dv, -du), so the
    # edge faces the low-v side exactly when du > 0. _poly_ccw may have
    # reversed the ring, but the test is orientation-free once we work on the
    # CCW copy.
    want_positive_du = bool(near_is_low_v)

    kept = []
    n = len(ccw)
    for i in range(n):
        u0, v0 = ccw[i]
        u1, v1 = ccw[(i + 1) % n]
        du = u1 - u0
        dv = v1 - v0
        if abs(du) < 1e-9 and abs(dv) < 1e-9:
            continue
        faces_plane = (du > 0.0) if want_positive_du else (du < 0.0)
        if not faces_plane:
            continue
        if abs(du) < parallel_ratio * abs(dv):
            continue        # a return / end wall, not a face
        kept.append((min(u0, u1), max(u0, u1)))

    if not kept:
        return (full_lo, full_hi, False)
    return (min(a for a, _b in kept), max(b for _a, b in kept), True)


def _poly_area_xy(pts):
    """Shoelace area (ft2) of a closed world-space ring, using X/Y only."""
    n = len(pts)
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        p = pts[i]
        q = pts[(i + 1) % n]
        a += p.X * q.Y - q.X * p.Y
    return abs(a) * 0.5


def _loop_bbox_uv(loop_uv):
    us = [q.u for q in loop_uv]
    vs = [q.v for q in loop_uv]
    return min(us), max(us), min(vs), max(vs)


def _simplify_loop_uv(loop_uv, angle_tol_deg=0.5):
    """
    Drop collinear vertices from a (u,v) loop.

    Real footprints arrive tessellated with 1300+ vertices. Ray-casting every
    candidate band against those directly would undo the convex-hull speed-up
    that took this engine from ~20 minutes to under a second. Context loops
    are used only for ray hits, so collinear runs can be collapsed with no
    change to the geometry.
    """
    n = len(loop_uv)
    if n < 4:
        return list(loop_uv)
    tol = math.cos(math.radians(180.0 - angle_tol_deg))
    out = []
    for i in range(n):
        a = loop_uv[i - 1]
        b = loop_uv[i]
        c = loop_uv[(i + 1) % n]
        u1, v1 = b.u - a.u, b.v - a.v
        u2, v2 = c.u - b.u, c.v - b.v
        l1 = math.hypot(u1, v1)
        l2 = math.hypot(u2, v2)
        if l1 < 1e-9 or l2 < 1e-9:
            continue
        cosang = (u1 * u2 + v1 * v2) / (l1 * l2)
        if cosang < 1.0 - 1e-9 or cosang <= tol:
            out.append(b)
    return out if len(out) >= 3 else list(loop_uv)


def _point_in_loop_uv(u, v, loop_uv):
    """Ray-cast point-in-polygon in (u,v)."""
    inside = False
    n = len(loop_uv)
    j = n - 1
    for i in range(n):
        ui, vi = loop_uv[i].u, loop_uv[i].v
        uj, vj = loop_uv[j].u, loop_uv[j].v
        if ((vi > v) != (vj > v)) and \
           (u < (uj - ui) * (v - vi) / ((vj - vi) or 1e-12) + ui):
            inside = not inside
        j = i
    return inside


def _loop_key(loop, axis_u, axis_v, q=0.05):
    """
    Stable geometric fingerprint for a building footprint, so the same
    physical building picked twice compares equal.

    Centroid + bbox quantised to 0.05 ft (~15 mm). Two DIFFERENT buildings
    would have to share a centroid and a bounding box to collide, which
    cannot happen for non-overlapping footprints.
    """
    if not loop or len(loop) < 3:
        return None
    uv = [to_uv(p, axis_u, axis_v) for p in loop]
    n = float(len(uv))
    cu = sum(x.u for x in uv) / n
    cv = sum(x.v for x in uv) / n
    ulo, uhi, vlo, vhi = _loop_bbox_uv(uv)
    r = lambda z: int(round(z / q))
    return (r(cu), r(cv), r(ulo), r(uhi), r(vlo), r(vhi))


def _prepare_context_uv(context_loops, group_loops, axis_u, axis_v,
                        u_gap_lo, u_gap_hi, v_lo, v_hi):
    """
    Convert context building loops to simplified (u,v) loops, dropping any
    that are actually one of the group loops and any that cannot possibly
    reach the corridor.

    The u-window is widened by the maximum lateral travel a <=15 deg edge can
    achieve over the site depth, so a building that the band could bend into
    is still retained.
    """
    if not context_loops:
        return []

    # Group members must be matched GEOMETRICALLY, not by id().
    #
    # script.py picks the buildings once (_pick_building_loops) and the gap
    # groups again in a separate pick (_pick_building_groups). Both rebuild
    # their loops from scratch, so the same physical building is two distinct
    # Python objects and an id() test never matches -- the log then reports
    # "0 are group members" while every group building is wrongly treated as
    # an obstacle to its own corridor.
    group_keys = set()
    for lp in (group_loops or []):
        k = _loop_key(lp, axis_u, axis_v)
        if k is not None:
            group_keys.add(k)

    reach = (v_hi - v_lo) * math.tan(MAX_DEFLECT_RAD)
    win_lo = u_gap_lo - reach
    win_hi = u_gap_hi + reach

    out = []
    skipped_group = 0
    skipped_far = 0
    for lp in context_loops:
        if not lp or len(lp) < 3:
            continue
        if _loop_key(lp, axis_u, axis_v) in group_keys:
            skipped_group += 1
            continue
        uv = [to_uv(p, axis_u, axis_v) for p in lp]
        b_ulo, b_uhi, b_vlo, b_vhi = _loop_bbox_uv(uv)
        if b_uhi < win_lo or b_ulo > win_hi:
            skipped_far += 1
            continue
        if b_vhi < v_lo or b_vlo > v_hi:
            skipped_far += 1
            continue
        out.append(_simplify_loop_uv(uv))

    if out or skipped_group or skipped_far:
        debug_print("  [Corridor] context: {} obstacle(s) in play "
                    "({} are group members, {} out of reach); "
                    "vertices after simplify: {}".format(
                        len(out), skipped_group, skipped_far,
                        sum(len(l) for l in out)))
    return out


def _loops_corners_uv(loops, axis_u, axis_v):
    pts = []
    for lp in loops or []:
        for p in lp:
            pts.append(to_uv(p, axis_u, axis_v))
    return pts


def _clamp_dir_to_perp(du, dv, max_deg=MAX_DEFLECT_DEG):
    """Clamp direction (du,dv) to within max_deg of the +v perpendicular.
    Returns a unit (du,dv) pointing generally along +v."""
    L = math.hypot(du, dv)
    if L < 1e-12:
        return (0.0, 1.0)
    du, dv = du / L, dv / L
    if dv < 0:                      # always point along +v
        du, dv = -du, -dv
    ang = math.degrees(math.atan2(du, dv))   # 0 = perpendicular
    if ang > max_deg:
        ang = max_deg
    elif ang < -max_deg:
        ang = -max_deg
    a = math.radians(ang)
    return (math.sin(a), math.cos(a))


def _convex_hull_uv(pts):
    """Andrew monotone-chain hull in (u,v). The corridor edge is TANGENT to
    a group, and a tangent can only touch the convex hull -- so the
    architect's "outer corners" are exactly the hull vertices. Using the
    hull instead of every tessellated vertex takes each group from ~200
    points to ~10, which is what makes this run in seconds instead of
    tens of minutes."""
    ps = sorted(set((round(p.u, 6), round(p.v, 6)) for p in pts))
    if len(ps) <= 2:
        return [_UV(u, v, None) for (u, v) in ps]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in ps:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(ps):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [_UV(u, v, None) for (u, v) in hull]


def _poly_ccw(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        a = pts[i]; b = pts[(i + 1) % n]
        s += a[0] * b[1] - b[0] * a[1]
    return pts if s > 0 else list(reversed(pts))


def _clip_convex(subject, clip):
    """Sutherland-Hodgman: clip `subject` polygon by CONVEX `clip` polygon.
    Both are lists of (u,v). Guarantees a single closed, non-self-
    intersecting result -- which is what Revit's FilledRegion requires."""
    clip = _poly_ccw(list(clip))
    out = list(subject)

    def inside(p, a, b):
        return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]) >= -1e-9

    def inter(p1, p2, a, b):
        x1,y1 = p1; x2,y2 = p2; x3,y3 = a; x4,y4 = b
        den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
        if abs(den) < 1e-12:
            return p2
        t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den
        return (x1 + t*(x2-x1), y1 + t*(y2-y1))

    n = len(clip)
    for i in range(n):
        a = clip[i]; b = clip[(i + 1) % n]
        inp = out
        out = []
        if not inp:
            break
        s = inp[-1]
        for e in inp:
            if inside(e, a, b):
                if not inside(s, a, b):
                    out.append(inter(s, e, a, b))
                out.append(e)
            elif inside(s, a, b):
                out.append(inter(s, e, a, b))
            s = e
    return out


def _line_x(p, d, q, e):
    """Intersection of line (p,dir d) with line (q,dir e); None if parallel."""
    den = d[0]*e[1] - d[1]*e[0]
    if abs(den) < 1e-12:
        return None
    t = ((q[0]-p[0])*e[1] - (q[1]-p[1])*e[0]) / den
    return (p[0] + d[0]*t, p[1] + d[1]*t)


def build_corridor_band_polygon(u1, v1, v2, tan_t, width, toward,
                                site_uv, axis_u, axis_v, elev):
    """
    Band bounded by the 3-line edge (perpendicular -> angled -> perpendicular,
    or straight through when the angle was clamped) and its uniform offset,
    with the two ENDS FOLLOWING THE TRUE SITE BOUNDARY.

    Built by walking v in order and clamping both edges to the site's real
    interior interval at that depth. Because v is monotonic and left<right at
    every station, the resulting ring cannot self-intersect -- and because
    the clamp uses the true polygon (not its convex hull) the ends follow the
    boundary instead of cutting across it.
    """
    v_lo = min(p.v for p in site_uv)
    v_hi = max(p.v for p in site_uv)
    w = width * (1.0 if toward > 0 else -1.0)

    # sample depths: uniform + the bend vertices + every SITE vertex, so the
    # ends trace the boundary polyline exactly
    vs = [v_lo + (v_hi - v_lo) * i / 60.0 for i in range(61)]
    for extra in (v1, v2):
        if v_lo <= extra <= v_hi:
            vs.append(extra)
    for p in site_uv:
        if v_lo <= p.v <= v_hi:
            vs.append(p.v)
            vs.append(p.v - 0.1)
            vs.append(p.v + 0.1)
    vs = sorted(set(round(x, 4) for x in vs))
    vs = [v for v in vs if v_lo - 1e-9 <= v <= v_hi + 1e-9]

    # Collect CONTIGUOUS runs only. Skipping a station mid-way and then
    # resuming makes the ring jump across the gap, which self-intersects --
    # that is what produced "curve loops cannot compose a valid boundary".
    runs = []
    cur_l = []
    cur_r = []
    for v in vs:
        ue = _edge_u_at_v(v, u1, v1, v2, tan_t)
        a, b = (ue, ue + w) if w >= 0 else (ue + w, ue)
        spans = _loop_u_intervals_at_v(site_uv, v)
        ok = False
        if spans:
            pick = None
            for (slo, shi) in spans:
                ov = min(shi, b) - max(slo, a)
                if pick is None or ov > pick[2]:
                    pick = (slo, shi, ov)
            if pick is not None and pick[2] > 1e-9:
                lo = max(a, pick[0])
                hi = min(b, pick[1])
                if hi - lo > 1e-9:
                    cur_l.append((lo, v))
                    cur_r.append((hi, v))
                    ok = True
        if not ok:
            if len(cur_l) >= 2:
                runs.append((cur_l, cur_r))
            cur_l, cur_r = [], []
    if len(cur_l) >= 2:
        runs.append((cur_l, cur_r))
    if not runs:
        return []

    def _run_len(r):
        return abs(r[0][-1][1] - r[0][0][1])
    left, right = max(runs, key=_run_len)
    if len(runs) > 1:
        debug_print("  [Corridor] band split by the site into {} run(s); "
                     "drawing the longest.".format(len(runs)))

    if len(left) < 2:
        return []

    MIN_SEG = 0.1
    chain_a = list(left)
    chain_b = list(reversed(right))

    # drop points that lie on a straight run (keeps the ring light; a
    # 300-point filled region is needlessly heavy for Revit)
    # Simplify each CHAIN separately, never across the junction: the two
    # points where the inner chain meets the outer chain are the region's
    # end caps, and deleting a cap corner collapses the ring.
    simp = _dp_simplify(chain_a) + _dp_simplify(chain_b)

    pts = []
    for (u, v) in simp:
        p = uv_to_point(u, v, axis_u, axis_v, elev)
        if not pts or p.DistanceTo(pts[-1]) >= MIN_SEG:
            pts.append(p)
    if len(pts) >= 2 and pts[0].DistanceTo(pts[-1]) < MIN_SEG:
        pts.pop()
    if len(pts) >= 3:
        _ring_problems(pts, "corridor band")
    return pts if len(pts) >= 3 else []


def _ray_hit_distance(p, d, loops_uv, max_t=1e9):
    """Smallest t>0 where ray p + t*d crosses any segment of loops_uv."""
    best = None
    px, py = p
    dx, dy = d
    for loop in loops_uv:
        n = len(loop)
        for i in range(n):
            a = loop[i]
            b = loop[(i + 1) % n]
            ex, ey = b.u - a.u, b.v - a.v
            den = dx * ey - dy * ex
            if abs(den) < 1e-12:
                continue
            apx, apy = a.u - px, a.v - py
            t = (apx * ey - apy * ex) / den
            s = (apx * dy - apy * dx) / den
            if t > 1e-9 and -1e-9 <= s <= 1 + 1e-9 and t < max_t:
                if best is None or t < best:
                    best = t
    return best


def _edge_u_at_v(v, u1, v1, v2, tan_t):
    """Edge polyline: perpendicular, then the <=15deg segment between the
    two corners, then PERPENDICULAR AGAIN ("return to perpendicular after
    passing the corner of the group")."""
    if v <= v1:
        return u1
    if v >= v2:
        return u1 + tan_t * (v2 - v1)
    return u1 + tan_t * (v - v1)


def _extension_is_clear(u_at, v_at, tan_t, v_target, all_loops_uv):
    """True if continuing the edge STRAIGHT from (u_at,v_at) at slope tan_t
    as far as v_target passes no building. Implements the refined rule: if
    the line can run on unobstructed past the second corner, it does NOT
    turn back to perpendicular."""
    u_end = u_at + tan_t * (v_target - v_at)
    return not _seg_crosses_any_building((u_at, v_at), (u_end, v_target),
                                         all_loops_uv)


def _loops_u_extent_at_v(loops_uv, v):
    """(min_u, max_u) of a group of loops at depth v, or (None, None)."""
    lo = None
    hi = None
    for loop in loops_uv:
        xs = []
        n = len(loop)
        for i in range(n):
            a = loop[i]
            b = loop[(i + 1) % n]
            if (a.v <= v <= b.v) or (b.v <= v <= a.v):
                if abs(b.v - a.v) < 1e-12:
                    xs.extend([a.u, b.u])
                else:
                    t = (v - a.v) / (b.v - a.v)
                    xs.append(a.u + t * (b.u - a.u))
        if xs:
            m1, m2 = min(xs), max(xs)
            lo = m1 if lo is None else min(lo, m1)
            hi = m2 if hi is None else max(hi, m2)
    return lo, hi


def _band_from_edge(u1, v1, v2, tan_t, own_uv, other_uv, toward, v_lo, v_hi,
                    n_s=36, context_uv=None):
    """
    Given an edge polyline anchored on one group, return (width, stations)
    where width is the largest UNIFORM offset toward `other` before the
    band touches it, and stations are (v, u_edge, nu, nv) samples.
    Returns (None, None) if the edge is invalid (its own group pokes past).
    """
    stations = []
    width = None
    # Sample uniformly PLUS at every corner depth of both groups: a
    # protruding apex that falls between uniform stations was being missed,
    # which over-reported the width (the band clipped through the spike).
    vs = [v_lo + (v_hi - v_lo) * i / float(n_s) for i in range(n_s + 1)]
    _grps = [own_uv, other_uv]
    if context_uv:
        # Sample at context corners too, for the same reason: a protruding
        # apex falling between uniform stations would be missed and the
        # width over-reported.
        _grps.append(context_uv)
    for grp in _grps:
        for loop in grp:
            for q in loop:
                if v_lo - 1e-9 <= q.v <= v_hi + 1e-9:
                    vs.append(q.v)
                    vs.append(q.v - 0.05)
                    vs.append(q.v + 0.05)
    vs = sorted(set(round(x, 4) for x in vs))
    for v in vs:
        ue = _edge_u_at_v(v, u1, v1, v2, tan_t)
        # local edge direction: tilted only between v1 and v2
        if v1 < v < v2:
            du, dv = tan_t, 1.0
        else:
            du, dv = 0.0, 1.0
        L = math.hypot(du, dv)
        du, dv = du / L, dv / L
        nu, nv = dv * toward, -du * toward       # unit normal toward other
        # own group must not poke past the edge -- compared AT THIS DEPTH
        # only. (Comparing every corner against every station wrongly
        # rejected valid tilted edges, because a corner further along the
        # edge naturally has a larger u.)
        own_lo, own_hi = _loops_u_extent_at_v(own_uv, v)
        if own_lo is not None:
            if toward > 0:
                if own_hi > ue + 0.05:
                    return None, None
            else:
                if own_lo < ue - 0.05:
                    return None, None
        t = _ray_hit_distance((ue, v), (nu, nv), other_uv)
        if t is not None:
            if width is None or t < width:
                width = t

        # Context buildings narrow the band exactly as the opposite group
        # does. Without this the offset sails straight through them.
        if context_uv:
            for cloop in context_uv:
                # The anchor edge itself running through a building makes the
                # band meaningless, and _ray_hit_distance from a point inside
                # a loop returns the distance to the FAR side rather than 0 --
                # which would silently report a width instead of rejecting.
                if _point_in_loop_uv(ue, v, cloop):
                    return None, None
                tc = _ray_hit_distance((ue, v), (nu, nv), [cloop])
                if tc is not None:
                    if width is None or tc < width:
                        width = tc
        stations.append((v, ue, nu, nv))
    return width, stations


def corridor_between_groups(group_a_loops, group_b_loops, site_pts,
                            axis_u, axis_v, elev=0.0,
                            max_angle_deg=MAX_DEFLECT_DEG,
                            context_loops=None):
    """
    Widest uniform-width air corridor between two building groups, using the
    corner-driven edge described by the architect:

      * the edge runs PERPENDICULAR to Projection Plane X,
      * between two outer corners of the SAME group it may deviate up to
        15 deg (the corner-to-corner direction, clamped),
      * then it RETURNS TO PERPENDICULAR after passing that corner,
      * the opposite edge is that polyline offset by a UNIFORM width, pushed
        across until it touches the other group.

    Both directions are tried (edge anchored on A offset toward B, and edge
    anchored on B offset toward A) and the widest valid band wins.

    context_loops: every OTHER building on the site. These narrow or reject
    the band but never supply corner candidates -- see CONTEXT OBSTACLES
    above. Pass the full building list; group members are filtered out by
    identity. Omitting it reproduces the old (over-reporting) behaviour.
    """
    axis_u = _normalize(axis_u)
    axis_v = _normalize(axis_v)

    A_raw = [to_uv(p, axis_u, axis_v) for lp in (group_a_loops or []) for p in lp]
    B_raw = [to_uv(p, axis_u, axis_v) for lp in (group_b_loops or []) for p in lp]
    if len(A_raw) < 3 or len(B_raw) < 3:
        return None
    # Tangent edges only ever touch the convex hull -> use hull "outer
    # corners" for candidates, tangency and clearance. Keeps the search
    # small enough to run in seconds.
    # ONE HULL PER BUILDING, not one hull over the whole group.
    #
    # A group of several buildings is not convex: hulling them together
    # bridges the voids between them, so (a) the corners of the inner
    # buildings vanish and can never be tangency candidates, and (b) the
    # clearance test believes the void is solid. The search was therefore
    # exploring only the outline of the blob and missing tighter, wider
    # corridors that hug the individual footprints.
    A = [_convex_hull_uv([to_uv(p, axis_u, axis_v) for p in lp])
         for lp in (group_a_loops or []) if lp and len(lp) >= 3]
    B = [_convex_hull_uv([to_uv(p, axis_u, axis_v) for p in lp])
         for lp in (group_b_loops or []) if lp and len(lp) >= 3]
    A = [h for h in A if h and len(h) >= 3]
    B = [h for h in B if h and len(h) >= 3]
    if not A or not B:
        return None
    debug_print("  [Corridor] hulls: A={} building(s) {} corner(s), "
                "B={} building(s) {} corner(s) (from {}/{} raw pts)".format(
                    len(A), sum(len(h) for h in A),
                    len(B), sum(len(h) for h in B), len(A_raw), len(B_raw)))

    site_uv = [to_uv(p, axis_u, axis_v) for p in site_pts] if site_pts else []
    if site_uv:
        _set_site_context(site_uv)
        v_lo = min(p.v for p in site_uv)
        v_hi = max(p.v for p in site_uv)
    else:
        allp = [q for lp in A + B for q in lp]
        v_lo = min(q.v for q in allp)
        v_hi = max(q.v for q in allp)

    a_mean = sum(q.u for lp in A for q in lp) / float(sum(len(lp) for lp in A))
    b_mean = sum(q.u for lp in B for q in lp) / float(sum(len(lp) for lp in B))

    # Context obstacles: everything on site that is not in A or B.
    _a_ulo = min(_loop_bbox_uv(h)[0] for h in A)
    _a_uhi = max(_loop_bbox_uv(h)[1] for h in A)
    _b_ulo = min(_loop_bbox_uv(h)[0] for h in B)
    _b_uhi = max(_loop_bbox_uv(h)[1] for h in B)
    _gap_lo = min(_a_uhi, _b_uhi)
    _gap_hi = max(_a_ulo, _b_ulo)
    if _gap_lo > _gap_hi:
        _gap_lo, _gap_hi = _gap_hi, _gap_lo
    context_uv = _prepare_context_uv(
        context_loops, list(group_a_loops or []) + list(group_b_loops or []),
        axis_u, axis_v, _gap_lo, _gap_hi, v_lo, v_hi)

    tan_max = math.tan(math.radians(max_angle_deg))
    best = None   # (width, tan_t, u1, v1, v2, own, other, toward, stations)

    for (own, other, toward) in ((A, B, 1.0 if b_mean > a_mean else -1.0),
                                 (B, A, 1.0 if a_mean > b_mean else -1.0)):
        # Only corners on the side of `own` that FACES `other` can be
        # touched by the anchor edge.
        _all_corners = [q for lp in own for q in lp]
        corners = _silhouette_corners(own, toward)
        debug_print("    [Corridor] {} corner(s) -> {} on the facing "
                    "silhouette".format(len(_all_corners), len(corners)))
        for c1 in corners:
            # candidate 1: pure perpendicular through this corner
            cands = [(0.0, c1.v, v_hi if c1.v < v_hi else v_lo)]
            # candidate 2..n: corner-to-corner within the SAME group
            for c2 in corners:
                dv = c2.v - c1.v
                if abs(dv) < 1e-6:
                    continue
                t_raw = (c2.u - c1.u) / dv
                t_use = max(-tan_max, min(tan_max, t_raw))
                clamped = abs(t_raw) > tan_max + 1e-9
                _all = list(own) + list(other) + list(context_uv)
                if c1.v < c2.v:
                    v_end = c2.v
                    if clamped:
                        v_end = v_hi
                    else:
                        # refined rule: run straight on past the corner when
                        # the extension is unobstructed
                        u_at_c2 = c1.u + t_use * (c2.v - c1.v)
                        if _extension_is_clear(u_at_c2, c2.v, t_use, v_hi, _all):
                            v_end = v_hi
                    cands.append((t_use, c1.v, v_end))
                else:
                    v_end = c2.v
                    if clamped:
                        v_end = v_lo
                    else:
                        u_at_c2 = c1.u + (-t_use) * (c2.v - c1.v)
                        if _extension_is_clear(u_at_c2, c2.v, -t_use, v_lo, _all):
                            v_end = v_lo
                    # same anchor correction as side_average_width: c1 is at
                    # the HIGH end here, so u1 (the value at the LOW end) must
                    # be back-solved or the edge misses the corner entirely.
                    cands.append((-t_use, v_end, c1.v))
            seen_c = set()
            for (tan_t, va, vb) in cands:
                key = (round(c1.u, 3), round(c1.v, 3), round(tan_t, 4),
                       round(va, 2), round(vb, 2))
                if key in seen_c:
                    continue
                seen_c.add(key)
                v1, v2 = (va, vb) if va <= vb else (vb, va)
                tt = tan_t if va <= vb else -tan_t
                # u1 is the edge value at the LOW end v1. When the corner c1
                # is at the HIGH end (v2), back-solve so the edge actually
                # passes through it.
                if abs(c1.v - v2) < abs(c1.v - v1):
                    u1c = c1.u - tt * (v2 - v1)
                else:
                    u1c = c1.u
                # Coarse-then-fine. Width is a MINIMUM over stations, so the
                # value from a subset of stations is an upper bound on the
                # full-resolution value. If the cheap 6-station pass already
                # cannot beat the incumbent, the expensive pass cannot either.
                if best is not None:
                    wc_, _ = _band_from_edge(u1c, v1, v2, tt, own, other,
                                             toward, v_lo, v_hi, n_s=6,
                                             context_uv=context_uv)
                    if wc_ is None or wc_ <= best[0] + 1e-9:
                        continue
                w, st = _band_from_edge(u1c, v1, v2, tt, own, other,
                                        toward, v_lo, v_hi,
                                        context_uv=context_uv)
                if w is None or w <= 1e-6:
                    continue
                if best is None or w > best[0] + 1e-9:
                    best = (w, tt, u1c, v1, v2, own, other, toward, st)

        # ------------------------------------------------------------------
        # CROSS-GROUP NEAREST-CORNER BANDS
        # ------------------------------------------------------------------
        # Everything above builds the edge between two corners of the SAME
        # group. That misses the construction an architect reaches for first:
        # join the nearest corner of A to the nearest corner of B, and run the
        # corridor PERPENDICULAR to that connecting line. The connector's
        # length is the corridor width and its tilt is the bend angle, so a
        # pair only 10.81 deg off Plane X yields a 15.19 m corridor where the
        # same-group families found 14.65 m and failed.
        for c1 in corners:
            for c2 in [q for lp in other for q in lp]:
                du = c2.u - c1.u
                dv = c2.v - c1.v
                seg = math.hypot(du, dv)
                if seg < 1e-9:
                    continue
                # band runs perpendicular to the connector
                eu, ev = -dv / seg, du / seg
                if abs(ev) < 1e-9:
                    continue
                if ev < 0.0:
                    eu, ev = -eu, -ev
                tt = eu / ev                       # tilt from the flow axis
                if abs(tt) > tan_max + 1e-9:
                    continue                        # beyond the 15 deg cap
                u1c = c1.u - tt * (c1.v - v_lo)
                w, st = _band_from_edge(u1c, v_lo, v_hi, tt, own, other,
                                        toward, v_lo, v_hi,
                                        context_uv=context_uv)
                if w is None or w <= 1e-6:
                    continue
                if best is None or w > best[0] + 1e-9:
                    debug_print("    [Corridor] nearest-corner pair gives "
                                "{:.2f} m at {:+.2f} deg (connector {:.2f} m)"
                                .format(w * FEET_TO_METERS,
                                        math.degrees(math.atan(tt)),
                                        seg * FEET_TO_METERS))
                    best = (w, tt, u1c, v_lo, v_hi, own, other, toward, st)

    if best is None:
        return None

    width_ft, tan_t, u1, v1, v2, own, other, toward, stations = best

    poly = build_corridor_band_polygon(
        u1, v1, v2, tan_t, width_ft, toward, site_uv, axis_u, axis_v, elev)
    _vlo = min(p.v for p in site_uv)
    _vhi = max(p.v for p in site_uv)
    debug_print("  [Corridor] band polygon: {} pts, width={:.2f}m, "
                 "angle={:+.1f}deg".format(len(poly), width_ft * FEET_TO_METERS,
                                            math.degrees(math.atan(tan_t))))
    debug_print("  [Corridor] legs: perp {:.1f}ft | angled {:.1f}ft "
                 "(v {:.1f}->{:.1f}) | perp {:.1f}ft   [site v {:.1f}..{:.1f}]"
                 .format(max(0.0, v1 - _vlo), max(0.0, v2 - v1),
                         v1, v2, max(0.0, _vhi - v2), _vlo, _vhi))
    if (v1 - _vlo) < 1.0 and (_vhi - v2) < 1.0:
        debug_print("  [Corridor] NOTE: buildings span the full site depth, "
                     "so there is no room for perpendicular legs -- the band "
                     "is a single angled run. This is geometrically correct.")

    return {
        "width_ft": width_ft,
        "width_m": width_ft * FEET_TO_METERS,
        "angle_deg": math.degrees(math.atan(tan_t)),
        "bend_v1": v1,
        "bend_v2": v2,
        "polygon": poly,
        "qualifies": width_ft >= MIN_CORRIDOR_FT,
    }


def corridors_for_group_chain(groups, site_pts, axis_u, axis_v, elev=0.0,
                              building_loops=None):
    """groups = [[loop,...], [loop,...], ...] in the order the user picked.
    Assesses the gap between each consecutive pair.

    building_loops: ALL buildings on the site. For each pair, the buildings
    outside that pair become context obstacles, so a block standing in the
    gap narrows or rejects the corridor instead of being ignored. Callers
    that omit it get the old behaviour and a warning."""
    if building_loops is None:
        debug_print("  [Corridor] WARNING: corridors_for_group_chain called "
                    "without building_loops -- buildings outside the picked "
                    "groups will be IGNORED and widths may be over-reported.")
    out = []
    for i in range(len(groups) - 1):
        r = corridor_between_groups(groups[i], groups[i + 1], site_pts,
                                    axis_u, axis_v, elev,
                                    context_loops=building_loops)
        if r is not None:
            r["gap_index"] = i + 1
            out.append(r)
    return out


# ===========================================================================
# STREET-CENTRELINE SIDE EXTENSION  (APP-152 Fig B12/B14)
# ===========================================================================
# Where the site abuts a STREET (rather than a common boundary with another
# lot), the side separation may be measured to the STREET CENTRELINE.
#
# The previous implementation asked the user to TYPE a street width and then
# pushed the side region out by half of it as a flat parallel offset. That
# is wrong whenever the street varies in width or the opposite boundary is
# not parallel to the site edge -- which is the normal case -- and it also
# forced a second question ("which side?") whose answer depends on which way
# the projection axis happens to point, so picking "right" could extend the
# left.
#
# Correct method (and the same one Case 1 already uses for street canyons):
# the user selects the OPPOSITE side boundary; the true centreline is
# computed between the two boundaries; the extension for each depth is the
# distance from the site edge out to that centreline. Which side it applies
# to is then derived from geometry -- no "left or right" question at all.
# ===========================================================================

def street_centreline_from_curves(subject_curves, opposite_curves,
                                   axis_u, axis_v, site_pts=None):
    """
    Street centreline for the S1 extension, using **Case 1's proven
    builder** rather than a second implementation.

    Delegates to sbd_geom_advanced.compute_centreline_and_offset_from_subject()
    -- the same function that draws the green "STREET C.L." in Case 1 --
    because it already solves three problems my own version did not:

      * ENDPOINT CLAMP: where the two boundaries do not start and end at
        matching positions along the street, samples beyond the end of the
        opposite boundary all project onto its endpoint and their midpoints
        sweep an arc around it. That is the hook at the ends, and it is
        why the Case 2 version reported an extension of 0.26 m.
      * OUTLIER REJECTION: samples far outside the parallel-overlap zone
        project at distances much larger than the real street width and
        are dropped against the median. That is the 15.37 m maximum on a
        street whose mean was 6.76 m.
      * EVEN RESAMPLING by arc length, so the centreline is not biased
        toward whichever part of the boundary happened to be denser.

    subject_curves : the SITE boundary edge that faces the street
                     (selected by the user, exactly as Case 1 asks).
    opposite_curves: the far side of the street.

    Returns {"side", "extension_ft", "extension_m", "centreline_pts",
             "per_v"} or None.
    """
    try:
        from sbd_geom_advanced import compute_centreline_and_offset_from_subject
        from sbd_geom_base import get_closest_point_on_polyline
    except Exception as ex:
        debug_print("  [StreetCL] Case 1 centreline builder unavailable: "
                    "{}".format(ex))
        return None

    if not subject_curves or not opposite_curves:
        return None

    try:
        centre_pts, _offset_pts = compute_centreline_and_offset_from_subject(
            subject_curves, opposite_curves)
    except Exception as ex:
        debug_print("  [StreetCL] centreline build failed: {}".format(ex))
        return None

    if not centre_pts or len(centre_pts) < 2:
        debug_print("  [StreetCL] centreline came back empty -- check that "
                    "the two boundaries actually face each other.")
        return None

    axis_u = _normalize(axis_u)
    axis_v = _normalize(axis_v)

    # subject boundary points, for measuring the extension to the centreline
    subj_pts = []
    for c in subject_curves:
        try:
            subj_pts.append(c.GetEndPoint(0))
            subj_pts.append(c.GetEndPoint(1))
        except Exception:
            continue
    if len(subj_pts) < 2:
        return None

    per_v = []
    for p in subj_pts:
        res = get_closest_point_on_polyline(p, centre_pts)
        if not res or res[0] is None:
            continue
        _cp, dist = res[0], res[1]
        per_v.append((to_uv(p, axis_u, axis_v).v, dist))
    if not per_v:
        return None

    exts = [e for _v, e in per_v]
    mean_ext = sum(exts) / float(len(exts))

    # which side of the site does the street sit on?
    u_centre = sum(to_uv(p, axis_u, axis_v).u for p in centre_pts) / float(len(centre_pts))
    u_subj = sum(to_uv(p, axis_u, axis_v).u for p in subj_pts) / float(len(subj_pts))
    side = "left" if u_centre < u_subj else "right"

    debug_print("  [StreetCL] Case 1 builder: centreline {} pts; street is "
                 "on the {}; extension mean {:.2f} m (min {:.2f}, max {:.2f})."
                 .format(len(centre_pts), side, mean_ext * FEET_TO_METERS,
                         min(exts) * FEET_TO_METERS,
                         max(exts) * FEET_TO_METERS))
    return {"side": side, "extension_ft": mean_ext,
            "extension_m": mean_ext * FEET_TO_METERS,
            "centreline_pts": centre_pts, "per_v": per_v}


def street_centreline_from_points(subject_pts, opposite_pts, axis_u, axis_v,
                                   site_pts=None):
    """
    Points-based front end for street_centreline_from_curves().

    The setup window captures boundaries as POINT chains (it samples the
    picked curves so it can draw them), whereas the curve-based entry point
    needs Curve objects. Rather than sample twice, this wraps the points in
    lightweight straight Lines and delegates, so both paths run the same
    Case 1 centreline builder.
    """
    if not subject_pts or not opposite_pts:
        return None
    try:
        from Autodesk.Revit.DB import Line as _Line
    except Exception:
        return None

    def _to_curves(pts):
        out = []
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            if math.hypot(b.X - a.X, b.Y - a.Y) < 0.01:
                continue
            try:
                out.append(_Line.CreateBound(a, b))
            except Exception:
                continue
        return out

    subj = _to_curves(subject_pts)
    opp = _to_curves(opposite_pts)
    if not subj or not opp:
        return None
    return street_centreline_from_curves(subj, opp, axis_u, axis_v, site_pts)
