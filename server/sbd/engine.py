# -*- coding: utf-8 -*-
"""Run the SBD assessment on an exported sbd.json (metres) -> result (metres).

sbd.json (written by the add-in's SBD Export):
  {"version": 1, "units": "m", "project", "model", "by", "at",
   "ground_z": the zones' ground (absolute z),
   "site": [[x, y], ...]                      the subject site boundary
   "masses": [{"id", "name", "verts": [[x, y, z]], "tris": [[i, j, k]]}]
   "street_axis": [[x, y], [x, y]] | null     a line along the street (Plane X)
   "streets": [{"name", "centreline": [[x, y]], "opposite": [[x, y]]}]  (Case 1)
   "corridor": [[x, y], ...] | null           a notional air corridor centreline}

Options: axis = "street" | "pca" | "angle" (with angle_deg), zones.
"""

import math
import time

from .xyz import XYZ
from . import geom
from .geom import FEET_TO_METERS
from . import addin_engine as A
from . import footprint as F
from . import elevation as E
from . import nearedge as N

P = A.P          # the SBD panel's sbd_permeability (addin/, unchanged)

FT = 1.0 / FEET_TO_METERS        # metres -> feet
M = FEET_TO_METERS               # feet -> metres
ZONES = [("LOW", 0.0, 20.0), ("MIDDLE", 20.0, 60.0), ("HIGH", 60.0, None)]
CASE1_REACH_M = 30.0             # a facade within 30 m of the street centreline
CASE1_STEP_M = 0.5


def _pt(p):
    return XYZ(p[0] * FT, p[1] * FT, 0.0)


def _xy(p):
    return [round(p.X * M, 3), round(p.Y * M, 3)]


def _loop_xy(loop):
    return [_xy(p) for p in loop]


def _centroid(loop):
    n = float(len(loop))
    return sum(p[0] for p in loop) / n, sum(p[1] for p in loop) / n


def check_input(data):
    """Problems with the export, as text (shown before the results)."""
    out = []
    site = data.get("site") or []
    if len(site) < 3:
        out.append("No site boundary (or fewer than 3 points).")
    else:
        if math.hypot(site[0][0] - site[-1][0], site[0][1] - site[-1][1]) > 0.01 and len(site) > 3:
            pass  # an open list is closed by its last edge; nothing to report
        if _self_intersects(site):
            out.append("The site boundary crosses itself - check the property lines.")
        if abs(F.area(site)) < 10:
            out.append("The site is smaller than 10 m2 - check the units of the export.")
    if not data.get("masses"):
        out.append("No masses: model the buildings as Mass elements (Massing & Site > In-Place Mass or a Mass family).")
    for m in data.get("masses") or []:
        if not m.get("tris"):
            out.append("Mass %s has no geometry." % (m.get("name") or m.get("id")))
    return out


def _self_intersects(loop):
    n = len(loop)
    pts = [XYZ(p[0], p[1], 0) for p in loop]
    for i in range(n):
        a1, a2 = pts[i], pts[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            b1, b2 = pts[j], pts[(j + 1) % n]
            t, u, _ = geom.segment_segment_intersection(a1, a2, b1, b2)
            if t is not None and 1e-6 < t < 1 - 1e-6 and 1e-6 < u < 1 - 1e-6:
                return True
    return False


def zone_footprints(data, z0, z1, at=None):
    """{"site": [loops of buildings on the site], "other": [loops outside]}
    (metres). at: one plan level (relative to the ground) instead of every
    height in the band."""
    g = float(data.get("ground_z") or 0.0)
    site = data["site"]
    inside, other = [], []
    for m in data.get("masses") or []:
        fps = F.mass_footprints_at(m, g + at) if at is not None else F.mass_footprints(m, g + z0, None if z1 is None else g + z1)
        for f in fps:
            cx, cy = _centroid(f["loop"])
            f = dict(f, mass=m.get("id"), name=m.get("name") or "")
            (inside if F.point_in(cx, cy, site) else other).append(f)
    return inside, other


def lp_addin_m(loops_ft):
    """The add-in's Lp (Case2 script compute_lp_m): the SHORTER side of the
    smallest bounding rectangle, of the largest building - kept to compare."""
    best = 0.0
    for loop in loops_ft:
        hull = _hull(loop)
        if len(hull) < 2:
            continue
        angles = set(math.atan2(hull[(i + 1) % len(hull)].Y - hull[i].Y, hull[(i + 1) % len(hull)].X - hull[i].X) % math.pi
                     for i in range(len(hull)))
        k = 0.0
        while k < math.pi:
            angles.add(k)
            k += math.radians(0.5)
        best_len = best_w = None
        for a in angles:
            c, s = math.cos(a), math.sin(a)
            us = [p.X * c + p.Y * s for p in hull]
            vs = [-p.X * s + p.Y * c for p in hull]
            w, h = max(us) - min(us), max(vs) - min(vs)
            if best_len is None or max(w, h) < best_len - 1e-9:
                best_len, best_w = max(w, h), min(w, h)
        best = max(best, (best_w or 0.0) * M)
    return best


def _hull(pts):
    p = sorted(set((q.X, q.Y) for q in pts))
    if len(p) < 3:
        return [XYZ(x, y, 0) for x, y in p]
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for q in p:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    for q in reversed(p):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return [XYZ(x, y, 0) for x, y in lower[:-1] + upper[:-1]]


def _angle(a, b, period=180.0):
    """The angle from direction a to direction b (degrees), in
    (-period / 2, period / 2]: a plane has no sense, so 180 deg is 0."""
    ax, ay = (a.X, a.Y) if hasattr(a, "X") else a
    bx, by = (b.X, b.Y) if hasattr(b, "X") else b
    d = math.degrees(math.atan2(ax * by - ay * bx, ax * bx + ay * by))
    d = (d + period / 2.0) % period - period / 2.0
    return period / 2.0 if abs(d + period / 2.0) < 1e-9 else d


def _axis_out(r, site_pts, bldgs=None, streets=None):
    """One axis' result in metres, with what the plan draws: each gap's
    strip, the S1 side regions (Area / Depth) and the S2 corridors (each
    with its band, to draw clipped to the site), and the near edge: the
    gaps and the building groups' shadows along it (nearedge.py).
    bldgs: [(label, [loops m])] the zone's buildings."""
    ax = r["axis"]
    av = P.orthogonal_axis(ax)
    ref = P.site_centroid(site_pts)
    v_lo, v_hi = geom.project_polygon_onto_axis(site_pts, av)

    def strip(lo, hi):
        a = P.axis_scalar_to_point(lo, ax, ref)
        b = P.axis_scalar_to_point(hi, ax, ref)
        rv = ref.X * av.X + ref.Y * av.Y
        return [_xy(q) for q in (a + av * (v_lo - rv), b + av * (v_lo - rv), b + av * (v_hi - rv), a + av * (v_hi - rv))]

    site_uv = N._site_uv(site_pts, ax, av)
    sides, side_band = {}, {}
    for k, sd in (r.get("sides") or {}).items():
        sides[k] = {"to_cl": bool(sd.get("street_cl")), "avg_m": round(sd.get("avg_width_m", 0.0), 3), "area_m2": round(sd.get("area_m2", 0.0), 2),
                    "depth_m": round(sd.get("D_m", 0.0), 3), "angle_deg": round(sd.get("angle_deg", 0.0), 1),
                    "polygon": [_xy(q) for q in (sd.get("region_polygon") or [])]}
        # the region was measured from the plane on one side (near_low): its
        # own (u, v) has v reversed when the plane is on the high-v side
        su, sv_ = sd.get("axes") or (ax, av)
        flip = (sv_.X * av.X + sv_.Y * av.Y) < 0
        sb = N.side_band(sd, N._site_uv(site_pts, su, sv_)) if sd.get("inner_uv") else None
        side_band[k] = [(u, -v) for u, v in sb] if (sb and flip) else sb
        if "near_low" in sd:
            sides[k]["near_low"] = bool(sd["near_low"])
        if sd.get("region_polygon"):
            p0, p1 = N._vrange(sd["region_polygon"], su, sv_)
            got = N.side_edge(sd, p0, p1)
            if got:
                sides[k]["edge"] = N.to_xy_m(got[0], su, sv_)      # perpendicular, then turned once
            elif sd.get("inner_uv"):
                sides[k]["edge"] = N.to_xy_m(A._dp(sorted(sd["inner_uv"], key=lambda q: q[1])), su, sv_)

    gaps = []
    for g in r.get("all_gap_results") or []:
        ms = g.get("measurement") or {}
        e = {"lo_m": round(g["gap_lo"] * M, 3), "hi_m": round(g["gap_hi"] * M, 3), "width_m": round(g["width_ft"] * M, 3),
             "qualifies": bool(g.get("qualifies")), "type": ms.get("type", ""), "distance_m": round(ms.get("distance_m", 0.0), 3),
             "pass": bool(ms.get("pass")), "threshold_m": ms.get("threshold_m"), "strip": strip(g["gap_lo"], g["gap_hi"])}
        if ms.get("from_side_region"):
            e["side_region"] = True
        if ms.get("vertex_a") is not None and ms.get("vertex_b") is not None:
            e["pinch"] = [_xy(ms["vertex_a"]), _xy(ms["vertex_b"])]
        if ms.get("corridor_polygon"):
            e["corridor"] = [_xy(q) for q in ms["corridor_polygon"]]
            e["bend_deg"] = round(ms.get("articulated_deg", 0.0), 1)
            if getattr(ms["corridor_polygon"], "band", None):
                e["_band"] = N.corridor_band(ms["corridor_polygon"], site_uv)
                e["band"] = N.to_xy_m(e["_band"], ax, av)
                ring = N.corridor_ring(ms["corridor_polygon"], site_uv)
                if ring:
                    e["ring"] = N.to_xy_m(ring, ax, av)          # as drawn: constant width, ends on the boundary
        if ms.get("encroach_ft") is not None:
            e["encroach_m"] = round(ms["encroach_ft"] * M, 3)
        if ms.get("type") == "S3":
            e["area_m2"] = round(ms.get("area_m2", 0.0), 2)
            e["depth_m"] = round(ms.get("depth_m", 0.0), 3)
        gaps.append(e)
    # which side region a setback is: the first gap is "left", the last "right"
    s1 = [g for g in gaps if g["type"] == "S1"]
    if s1 and "left" in sides and s1[0]["lo_m"] <= min(g["lo_m"] for g in gaps) + 1e-6:
        s1[0]["side"] = "left"
    if s1 and "right" in sides and s1[-1]["hi_m"] >= max(g["hi_m"] for g in gaps) - 1e-6:
        s1[-1]["side"] = "right"
    # the near edge: each gap's band (its strip when it has none), walked
    bands = [g.pop("_band", None) or (side_band.get(g.get("side")) if g.get("side") else None)
             or N.strip_band(g["lo_m"] * FT, g["hi_m"] * FT, site_uv) for g in gaps]
    # the near edge: the side both side regions were measured from, else the
    # street's side
    nl = [v["near_low"] for v in sides.values() if "near_low" in v]
    near = nl[0] if nl else N.near_side(site_pts, ax, av, streets)
    low, gruns, sruns = N.partition(site_pts, bands, ax, av, near,
                                    sum(b - a for a, b in r.get("merged") or []))
    events = sorted([(a, b, "gap", i) for a, b, i in gruns] + [(a, b, "shadow", None) for a, b in sruns])
    owner = {}
    for label, loops in bldgs or []:
        us = [(p[0] * ax.X + p[1] * ax.Y) * FT for l in loops for p in l]
        lo, hi = min(us), max(us)
        best = max(((min(hi, b) - max(lo, a), n) for n, (a, b, kind, i) in enumerate(events) if kind == "shadow"), default=None)
        if best is not None and best[0] > -1e9:
            owner.setdefault(best[1], []).append((label, loops))
    edge = []
    for n, (a, b, kind, i) in enumerate(events):
        if kind == "gap":
            g = gaps[i]
            t = "blocked" if g["type"] == "FAIL" else "open" if g["type"] == "OPEN" else g["type"]
            edge.append({"kind": "gap", "label": t, "s_m": g["width_m"] if g["type"] in ("FAIL", "OPEN") or not g["distance_m"] else g["distance_m"],
                         "pass": g["qualifies"], "need_m": 15.0 if g["type"] == "S2" else 7.5, "gap": i, "lo": round(a * M, 3), "hi": round(b * M, 3), "bend_deg": g.get("bend_deg")})
        else:
            mem = owner.get(n, [])
            edge.append({"kind": "shadow", "label": "+".join(l for l, _ in mem) or "-", "lo": round(a * M, 3), "hi": round(b * M, 3),
                         "members": [l for _, ls in mem for l in ls]})
    sv = [q[1] for q in site_uv]
    return {
        "P": round(r["P"], 2), "W_m": round(r["W"] * M, 3), "IS_m": round(r["IS"] * M, 3),
        "sweep_deg": r.get("sweep_angle", 0), "axis": [round(ax.X, 6), round(ax.Y, 6)],
        "site_lo_m": round(r.get("site_lo", 0) * M, 3), "site_hi_m": round(r.get("site_hi", 0) * M, 3),
        "blocked_m": [[round(a * M, 3), round(b * M, 3)] for a, b in r.get("merged") or []],
        "ref": _xy(ref), "gaps": gaps, "sides": sides,
        "near": {"low": bool(low), "v_m": round((min(sv) if low else max(sv)) * M, 3)}, "edge": edge,
    }


def _named(inside, a):
    """The zone's buildings (footprints whose boxes touch), named B1, B2 ...
    in order along the street: [(label, [footprints])]."""
    bl = sorted(_buildings(inside), key=lambda ls: sum((p[0] * a.X + p[1] * a.Y) for l in ls for p in l["loop"])
                / max(1, sum(len(l["loop"]) for l in ls)))
    return [("B%d" % (i + 1), ls) for i, ls in enumerate(bl)]


def _dist_to_polyline(p, pl):
    best = None
    for i in range(len(pl) - 1):
        ax, ay = pl[i]
        bx, by = pl[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
        d = math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)
        best = d if best is None else min(best, d)
    return best if best is not None else 1e9


def _nearest(loops, cl):
    """The nearest a building comes to the centreline (its outline sampled
    every metre)."""
    best = 1e9
    for l in loops:
        pts = l["loop"]
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            n = max(1, int(math.hypot(q[0] - p[0], q[1] - p[1])))
            for k in range(n + 1):
                t = k / float(n)
                best = min(best, _dist_to_polyline((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t), cl))
    return best


LEG_BEND_DEG = 20.0


def _legs(cl):
    """A centreline in straight legs: a new leg where it has turned more than
    20 deg from where the leg began (an L-shaped street is two legs)."""
    legs, cur = [], [cl[0]]
    d0 = None
    for p, q in zip(cl, cl[1:]):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L < 1e-9:
            continue
        d = math.atan2(q[1] - p[1], q[0] - p[0])
        if d0 is None:
            d0 = d
        turn = abs((math.degrees(d - d0) + 180.0) % 360.0 - 180.0)
        if turn > LEG_BEND_DEG and len(cur) >= 2:
            legs.append(cur)
            cur, d0 = [p], d
        cur.append(q)
    if len(cur) >= 2:
        legs.append(cur)
    return [l for l in legs if math.hypot(l[-1][0] - l[0][0], l[-1][1] - l[0][1]) > 1.0] or [cl]


def street_legs(data):
    """Each street, leg by leg: {name, centreline, opposite, width_m,
    dir, normal (towards the site), offset30 (the 30 m line), width_dim}."""
    out = []
    if not data.get("site"):
        return out
    sx, sy = _centroid(data["site"])
    for si, st in enumerate(data.get("streets") or []):
        cl, opp = st.get("centreline") or [], st.get("opposite") or []
        if len(cl) < 2 or len(opp) < 2:
            continue
        legs = _legs(cl)
        for li, leg in enumerate(legs):
            dx, dy = leg[-1][0] - leg[0][0], leg[-1][1] - leg[0][1]
            dl = math.hypot(dx, dy) or 1.0
            dx, dy = dx / dl, dy / dl
            nx, ny = -dy, dx
            mx, my = (leg[0][0] + leg[-1][0]) / 2.0, (leg[0][1] + leg[-1][1]) / 2.0
            if (sx - mx) * nx + (sy - my) * ny < 0:
                nx, ny = -nx, -ny
            w = st.get("width_m")
            name = (st.get("name") or "Street %d" % (si + 1)) + (" (leg %d)" % (li + 1) if len(legs) > 1 else "")
            out.append({"name": name, "street": st.get("name") or "", "centreline": leg, "opposite": opp, "width_m": w, "level": st.get("level"),
                        "dir": [dx, dy], "normal": [nx, ny],
                        "offset30": [[round(p[0] + nx * CASE1_REACH_M, 3), round(p[1] + ny * CASE1_REACH_M, 3)] for p in (leg[0], leg[-1])],
                        "width_dim": [[round(mx - nx * w / 2.0, 3), round(my - ny * w / 2.0, 3)],
                                      [round(mx + nx * w / 2.0, 3), round(my + ny * w / 2.0, 3)], round(w, 3)] if w else None})
    return out


def _frontage(legs, site):
    """The leg fronting the site the longest (its length within 30 m of the
    site boundary): Plane X of the Low zone runs along it."""
    best = None
    for lg in legs:
        cl = lg["centreline"]
        front = 0.0
        for p, q in zip(cl, cl[1:]):
            m = ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)
            if min(_dist_to_polyline(m, [site[k], site[(k + 1) % len(site)]]) for k in range(len(site))) <= CASE1_REACH_M:
                front += math.hypot(q[0] - p[0], q[1] - p[1])
        if best is None or front > best[0]:
            best = (front, lg)
    return best[1] if best and best[0] > 0 else None


def _min_rect(pts):
    """The smallest-area rectangle round the points (its sides along a hull
    edge): (corners, shorter side, longer side, the shorter side's ends)."""
    hull = _hull([XYZ(p[0], p[1], 0) for p in pts])
    hp = [(q.X, q.Y) for q in hull] or [tuple(p) for p in pts]
    best = None
    for i in range(len(hp)):
        a, b = hp[i], hp[(i + 1) % len(hp)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-9:
            continue
        d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        n = (-d[1], d[0])
        us = [q[0] * d[0] + q[1] * d[1] for q in hp]
        ws = [q[0] * n[0] + q[1] * n[1] for q in hp]
        area = (max(us) - min(us)) * (max(ws) - min(ws))
        if best is None or area < best[0] - 1e-9:
            best = (area, d, n, min(us), max(us), min(ws), max(ws))
    if best is None:
        rect, lp = _lp_rect(pts, (1.0, 0.0), (0.0, 1.0))
        return rect, lp, lp, rect[:2]
    _, d, n, u0, u1, w0, w1 = best
    P = lambda u, w: [round(u * d[0] + w * n[0], 3), round(u * d[1] + w * n[1], 3)]
    rect = [P(u0, w0), P(u1, w0), P(u1, w1), P(u0, w1)]
    lu, lw = u1 - u0, w1 - w0
    side = [P(u0, w0), P(u0, w1)] if lw <= lu else [P(u0, w0), P(u1, w0)]
    return rect, min(lu, lw), max(lu, lw), side


def _lp_rect(pts, d, n):
    """The building's Lp along the street (d) by its depth (n): its corners."""
    us = [p[0] * d[0] + p[1] * d[1] for p in pts]
    ws = [p[0] * n[0] + p[1] * n[1] for p in pts]
    u0, u1, w0, w1 = min(us), max(us), min(ws), max(ws)
    return [[round(u * d[0] + w * n[0], 3), round(u * d[1] + w * n[1], 3)] for u, w in ((u0, w0), (u1, w0), (u1, w1), (u0, w1))], u1 - u0


GROUP_GAP_M = 15.0                # buildings closer than this: one group for Lp (Fig B7)


def _clip_half(loop, n, wmax):
    """The part of a loop with p . n <= wmax (Sutherland-Hodgman)."""
    out = []
    m = len(loop)
    for i in range(m):
        p, q = loop[i], loop[(i + 1) % m]
        wp, wq = p[0] * n[0] + p[1] * n[1], q[0] * n[0] + q[1] * n[1]
        if wp <= wmax:
            out.append(p)
        if (wp <= wmax) != (wq <= wmax):
            t = (wmax - wp) / (wq - wp)
            out.append([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    return out if len(out) >= 3 and abs(F.area(out)) > 0.01 else None


def _gap_pts(la, lb):
    """The clear distance between two buildings' outlines -> (d, p, q)."""
    best = (1e9, None, None)
    for A_, B_ in ((la, lb), (lb, la)):
        for l in A_:
            for p in l:
                for k in B_:
                    for i in range(len(k)):
                        a, b = k[i], k[(i + 1) % len(k)]
                        dx, dy = b[0] - a[0], b[1] - a[1]
                        L2 = dx * dx + dy * dy
                        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
                        q = (a[0] + dx * t, a[1] + dy * t)
                        d = math.hypot(p[0] - q[0], p[1] - q[1])
                        if d < best[0]:
                            best = (d, p, q) if A_ is la else (d, q, p)
    return best


def _groups(named):
    """Buildings closer than 15 m are one group for Lp: [(label, [footprints],
    [member labels])], and the spacings between neighbours (to draw)."""
    n = len(named)
    par = list(range(n))

    def f(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    spacing = []
    for i in range(n):
        best = None
        for j in range(n):
            if i == j:
                continue
            d, p, q = _gap_pts([l["loop"] for l in named[i][1]], [l["loop"] for l in named[j][1]])
            if d < GROUP_GAP_M:
                par[f(i)] = f(j)
            if best is None or d < best[0]:
                best = (d, j, p, q)
        if best and best[2] is not None:
            key = tuple(sorted((named[i][0], named[best[1]][0])))
            if not any(tuple(sorted((x["a"], x["b"]))) == key for x in spacing):
                spacing.append({"a": named[i][0], "b": named[best[1]][0], "d_m": round(best[0], 3),
                                "p": [round(best[2][0], 3), round(best[2][1], 3)], "q": [round(best[3][0], 3), round(best[3][1], 3)],
                                "grouped": best[0] < GROUP_GAP_M})
    out = {}
    for i in range(n):
        out.setdefault(f(i), []).append(i)
    groups = []
    for idx in sorted(out.values(), key=lambda g: g[0]):
        labs = [named[i][0] for i in idx]
        groups.append(("+".join(labs), [dict(l, _m=named[i][0]) for i in idx for l in named[i][1]], labs))
    return groups, spacing


def case1(data, zone_inside, a=None, legs=None):
    """Design Requirement (1), Lp of building(s) abutting a street (Fig B7,
    GB081), per zone. A building (or group) abuts a street when ANY part of
    it is within 30 m of the street's centreline; then over its whole
    projected span on that street, stations every 0.5 m along the
    centreline measure the canyon from its facade to the opposite site
    boundary: Length = the span, U = canyon area / Length. With several
    streets the controlling U is the smallest; Lp (the facade projected on
    the street, the longest) must not exceed 5 x U. In the Low zone the
    portion <= 1/3 H is left out (zone_inside holds its footprints above it).
    zone_inside: [(zone, [footprints])] -> [{zone, buildings, notes}]."""
    out = []
    streets = legs if legs is not None else street_legs(data)
    if not streets:
        return out
    a = a or XYZ(1, 0, 0)
    sx, sy = _centroid(data["site"])
    for zname, inside in zone_inside:
        if not inside:
            continue
        per, notes = [], []
        named, spacing = _groups(_named(inside, a))
        near_of = {}
        for label, loops_all, members in named:
            rows = []
            for si, st in enumerate(streets):
                name = st["name"]
                cl, opp = st["centreline"], st["opposite"]
                near = _nearest(loops_all, cl)
                near_of[(si, label)] = near
                if near > CASE1_REACH_M:
                    continue
                dx, dy = st["dir"]
                # only the part of the building(s) within 30 m of the
                # centreline counts (Wilson, report 4)
                nvec = st["normal"]
                wcl = min(p[0] * nvec[0] + p[1] * nvec[1] for p in cl)
                loops = []
                for l in loops_all:
                    c = _clip_half(l["loop"], nvec, wcl + CASE1_REACH_M)
                    if c:
                        loops.append(dict(l, loop=c))
                if not loops:
                    continue
                pts = [p for l in loops for p in l["loop"]]
                us = [p[0] * dx + p[1] * dy for p in pts]
                u0, u1 = min(us), max(us)
                # stations every 0.5 m along the centreline: a station counts
                # where its ray meets the REAL facade within 30 m (not the 30 m
                # line the building was cut at); consecutive stations make one
                # part of the canyon - a facade recessed beyond 30 m between
                # two wings gives two parts (Fig B7: A2(a) + A2(b))
                parts, cur, last, nside = [], None, None, None
                for k, (px, py, nx, ny) in enumerate(_stations(cl, CASE1_STEP_M)):
                    if not (u0 - 1e-9 <= px * dx + py * dy <= u1 + 1e-9):
                        continue
                    if (sx - px) * nx + (sy - py) * ny < 0:          # the subject side: towards the site
                        nx, ny = -nx, -ny
                    hits = [(h, l.get("_m")) for h, l in ((_ray_hit(px, py, nx, ny, l), l) for l in loops) if h is not None]
                    do = _ray_hit_line(px, py, -nx, -ny, opp)
                    if not hits or do is None:
                        continue
                    df, who = min(hits, key=lambda q: q[0])
                    if df > CASE1_REACH_M - 1e-3:
                        continue                      # the cut at 30 m, not the facade
                    nside = nside or (nx, ny)
                    if cur is None or last != k - 1:
                        cur = {"facade": [], "opp": [], "width": [], "u": [], "who": []}
                        parts.append(cur)
                    cur["who"].append(who)
                    cur["facade"].append([round(px + nx * df, 3), round(py + ny * df, 3)])
                    cur["opp"].append([round(px - nx * do, 3), round(py - ny * do, 3)])
                    cur["width"].append(df + do)
                    cur["u"].append(px * dx + py * dy)
                    last = k
                if not parts:
                    notes.append("%s: %s is within %.0f m of the centreline (%.3f m) but no street canyon was measured - "
                                 "check the street's opposite boundary covers the building's frontage"
                                 % (name, label, CASE1_REACH_M, near))
                    continue
                nx0, ny0 = nside
                w_far = max(p[0] * nx0 + p[1] * ny0 for p in pts) + 3.0      # beyond the building: Actual Lp
                w_opp = min(min(q[0] * nx0 + q[1] * ny0 for q in pp["opp"]) for pp in parts) - 3.0   # beyond the opposite boundary: Length
                line = lambda ua, ub, w: [[round(u * dx + w * nx0, 3), round(u * dy + w * ny0, 3)] for u in (ua, ub)]
                out_parts = []
                for i, pp in enumerate(parts):
                    Lk = len(pp["u"]) * CASE1_STEP_M
                    ua, ub = min(pp["u"]) - CASE1_STEP_M / 2.0, max(pp["u"]) + CASE1_STEP_M / 2.0
                    out_parts.append({"tag": "abcdefghijklmnopqrstuvwxyz"[i] if len(parts) > 1 else "",
                                      "area_m2": round(sum(pp["width"]) * CASE1_STEP_M, 3), "L_m": round(Lk, 3), "Lp_m": round(ub - ua, 3),
                                      "canyon": pp["facade"] + list(reversed(pp["opp"])) if len(pp["facade"]) >= 2 else None,
                                      "facade": pp["facade"], "lp_line": line(ua, ub, w_far), "len_line": line(ua, ub, w_opp)})
                A_ = sum(q["area_m2"] for q in out_parts)
                L = sum(q["L_m"] for q in out_parts)
                U = A_ / L
                mid = [(f, o, w) for pp in parts for f, o, w in zip(pp["facade"], pp["opp"], pp["width"])]
                f, o, wd = mid[len(mid) // 4]          # a typical width, clear of the area's label
                rect, _ = _lp_rect(pts, st["dir"], st["normal"])
                # Lp: the parts' facades projected; between two buildings of a
                # group (under 15 m apart) the facade counts as continuous
                lp_sum = sum(q["Lp_m"] for q in out_parts)
                for pa, pb in zip(parts, parts[1:]):
                    if pa["who"][-1] != pb["who"][0]:
                        lp_sum += max(0.0, (min(pb["u"]) - CASE1_STEP_M / 2.0) - (max(pa["u"]) + CASE1_STEP_M / 2.0))
                rows.append({"street": name, "lp_rect": rect, "U_m": round(U, 3), "area_m2": round(A_, 3), "L_m": round(L, 3),
                             "Lp_m": round(lp_sum, 3), "nearest_m": round(near, 3),
                             "setback_m": round(near - (st.get("width_m") or 0) / 2.0, 3) if st.get("width_m") else None,
                             "parts": out_parts,
                             "canyon": [q["canyon"] for q in out_parts if q["canyon"]],
                             "facade": [q["facade"] for q in out_parts if len(q["facade"]) >= 2],
                             "lp_line": out_parts[0]["lp_line"] if len(out_parts) == 1 else None,
                             "len_line": out_parts[0]["len_line"] if len(out_parts) == 1 else None,
                             "width_dim": [f, o, round(wd, 3)]})
            if not rows:
                continue
            ctrl = min(rows, key=lambda r: r["U_m"])
            lp = max(r["Lp_m"] for r in rows)
            per.append(dict(ctrl, building=label, members=members, name=", ".join(sorted(set(l.get("name") or "" for l in loops_all))),
                            streets=rows, ctrl_street=ctrl["street"], Lp_m=round(lp, 3), Lp_max_m=round(5 * ctrl["U_m"], 3),
                            **{"pass": lp <= 5 * ctrl["U_m"] + 1e-6}))
        # the buildings that do not abut a street: their Lp all the same,
        # against the nearest street (drawn dashed)
        others = []
        for label, loops, _m in named:
            if any(b["building"] == label for b in per):
                continue
            si = min(range(len(streets)), key=lambda i: near_of.get((i, label), 1e9))
            # not abutting a street: Lp = the shorter side of its smallest
            # bounding rectangle (the SBD panel's Case 2; Wilson, report 5)
            rect, short, long_, side_pts = _min_rect([p for l in loops for p in l["loop"]])
            others.append({"building": label, "street": streets[si]["name"], "nearest_m": round(near_of.get((si, label), 0), 3),
                           "Lp_m": round(short, 3), "long_m": round(long_, 3), "lp_rect": rect, "lp_side": side_pts})
        for si, st in enumerate(streets):
            name = st["name"]
            if not any(r["street"] == name for b in per for r in b["streets"]):
                d = min([near_of.get((si, lab), 1e9) for lab, _, _m in named] or [1e9])
                if d <= CASE1_REACH_M:
                    continue                  # said above: no canyon measured
                notes.append("%s: no building within %.0f m of the centreline (nearest %.3f m) - Design Requirement (1) not applicable"
                             % (name, CASE1_REACH_M, d))
        if per or notes:
            out.append({"zone": zname, "buildings": per, "notes": notes, "others": others, "spacing": spacing})
    return out


def _buildings(fps):
    """Footprint loops grouped by building (loops whose boxes touch)."""
    groups = []
    for f in fps:
        xs = [p[0] for p in f["loop"]]
        ys = [p[1] for p in f["loop"]]
        bb = (min(xs), min(ys), max(xs), max(ys))
        hit = [g for g in groups if not (bb[2] < g["bb"][0] or bb[0] > g["bb"][2] or bb[3] < g["bb"][1] or bb[1] > g["bb"][3])]
        if hit:
            g = hit[0]
            for h in hit[1:]:
                g["loops"] += h["loops"]
                g["bb"] = (min(g["bb"][0], h["bb"][0]), min(g["bb"][1], h["bb"][1]), max(g["bb"][2], h["bb"][2]), max(g["bb"][3], h["bb"][3]))
                groups.remove(h)
            g["loops"].append(f)
            g["bb"] = (min(g["bb"][0], bb[0]), min(g["bb"][1], bb[1]), max(g["bb"][2], bb[2]), max(g["bb"][3], bb[3]))
        else:
            groups.append({"bb": bb, "loops": [f]})
    return [[dict(l["loop"] and {"loop": l["loop"], "name": l.get("name", "")}) for l in g["loops"]] for g in groups]


def _stations(pl, step):
    total = sum(math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]) for i in range(len(pl) - 1))
    s = step / 2.0
    i, acc = 0, 0.0
    while s < total and i < len(pl) - 1:
        a, b = pl[i], pl[i + 1]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if s > acc + seg:
            acc += seg
            i += 1
            continue
        t = (s - acc) / seg if seg else 0
        dx, dy = (b[0] - a[0]) / (seg or 1), (b[1] - a[1]) / (seg or 1)
        yield a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -dy, dx
        s += step


def _ray_seg(px, py, dx, dy, a, b):
    ex, ey = b[0] - a[0], b[1] - a[1]
    den = dx * ey - dy * ex
    if abs(den) < 1e-12:
        return None
    t = ((a[0] - px) * ey - (a[1] - py) * ex) / den
    u = ((a[0] - px) * dy - (a[1] - py) * dx) / den
    return t if t >= 0 and -1e-9 <= u <= 1 + 1e-9 else None


def _ray_hit(px, py, dx, dy, f):
    loop = f["loop"]
    best = None
    for i in range(len(loop)):
        t = _ray_seg(px, py, dx, dy, loop[i], loop[(i + 1) % len(loop)])
        if t is not None and (best is None or t < best):
            best = t
    return best


def _ray_hit_line(px, py, dx, dy, pl):
    best = None
    for i in range(len(pl) - 1):
        t = _ray_seg(px, py, dx, dy, pl[i], pl[i + 1])
        if t is not None and (best is None or t < best):
            best = t
    return best


def level_zero(data):
    """Level 0: "the mean street level on which the site abuts or, where the
    site abuts streets having different levels, the mean level of the lower
    or lowest street" (B(P)R). Each street keeps its own mean level (its
    slab's); when the export took the ground from the street slabs, Level 0
    is the lowest street abutting the site (within 30 m). A Level chosen in
    the export stays. Streets of the same name get (2), (3) ... so each is
    its own street in Case 1."""
    data = dict(data)
    seen, streets = {}, []
    for st in data.get("streets") or []:
        st = dict(st)
        nm = st.get("name") or "Street"
        seen[nm] = seen.get(nm, 0) + 1
        st["label"] = nm
        if seen[nm] > 1:
            st["name"] = "%s (%d)" % (nm, seen[nm])
        streets.append(st)
    data["streets"] = streets
    src = (data.get("ground_source") or "").lower()
    site = data.get("site") or []
    lv = []
    for st in streets:
        if st.get("level") is None or not site:
            continue
        pts = st.get("outline") or st.get("centreline") or []
        d = min([_dist_to_polyline(p, site + site[:1]) for p in pts] or [1e9])
        if d <= CASE1_REACH_M:
            lv.append((float(st["level"]), st.get("name") or ""))
    if lv and ("street" in src or data.get("ground_z") is None):
        z, nm = min(lv)
        data["ground_z"] = z
        data["level0"] = {"z": round(z, 3), "street": nm,
                          "streets": [{"name": n, "level": round(v, 3)} for v, n in lv],
                          "rule": "lowest street" if len(set(round(v, 3) for v, _ in lv)) > 1 else "the street"}
        data["ground_source"] = "the mean level of %s (%s street)" % (nm, "the lowest" if len(lv) > 1 else "the")
    return data


def zone_levels(data, zones=None):
    """Each zone's plan levels: the height bands over which no mass changes
    shape (relative to the ground), with the height a level cuts at."""
    g = float(data.get("ground_z") or 0.0)
    out = {}
    for name, z0, z1 in (zones or ZONES):
        ex = (z1 - z0) / 3.0 if name == "LOW" and z1 is not None else 0.0
        bands = F.shape_bands(data.get("masses") or [], g + z0 + ex, None if z1 is None else g + z1)
        out[name] = [{"from": round(a - g, 3), "to": round(b - g, 3), "z": round((a + b) / 2.0 - g, 3)} for a, b in bands]
    return out


def run(data, axis="street", angle_deg=0.0, zones=None, levels=None):
    t0 = time.time()
    del geom.LOG[:]
    warnings = check_input(data)
    if not data.get("site") or len(data["site"]) < 3:
        return {"ok": False, "warnings": warnings}
    data = level_zero(data)
    site_pts = [_pt(p) for p in data["site"]]
    site_pts = geom.ensure_loop_ccw(site_pts)
    # the projection axis (Axis 1, along Projection Plane X)
    legs = street_legs(data)
    front = _frontage(legs, data["site"]) if legs else None
    street = [front["centreline"][0], front["centreline"][-1]] if front else data.get("street_axis")
    if axis == "street" and street and len(street) >= 2:
        a = XYZ(street[-1][0] - street[0][0], street[-1][1] - street[0][1], 0).Normalize()
        axis_src = "street"
    elif axis == "angle":
        a = XYZ(math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg)), 0)
        axis_src = "angle"
    else:
        a = geom.compute_dominant_axis(site_pts)
        axis_src = "pca"
        if axis == "street":
            warnings.append("No street line in the export: Axis 1 is the site's main direction (PCA).")
    b = P.orthogonal_axis(a)
    # a side region next to a street runs on to its centreline
    A._NEAR.clear()
    A.STREETS[:] = [([_pt(p) for p in lg["centreline"]], (lg.get("width_m") or 0.0) / 2.0 * FT) for lg in legs if lg.get("width_m")]
    # an optional notional corridor (Fig B13-B14): buildings in it are left out
    corridor_poly = None
    if data.get("corridor") and len(data["corridor"]) >= 2:
        corridor_poly = P.offset_polyline_both_sides([_pt(p) for p in data["corridor"]], 7.5 * FT)
    site_area = geom.polygon_area_2d(site_pts) * M * M
    g = float(data.get("ground_z") or 0.0)
    # the masses' heights above the zones' ground: said, so a model on the
    # wrong level (or a ground taken from the wrong slab) shows at once
    heights = []
    for m in data.get("masses") or []:
        if not m.get("verts"):
            continue
        zs = [v[2] for v in m["verts"]]
        heights.append({"name": m.get("name") or m.get("id"), "base_m": round(min(zs) - g, 2), "top_m": round(max(zs) - g, 2)})
    # the lowest mass should stand on the zones' ground (towers on a podium
    # start higher, rightly): if none does, the ground or the masses' level
    # is wrong and every zone is shifted
    if heights:
        low = min(heights, key=lambda h: h["base_m"])
        if abs(low["base_m"]) > 1.0:
            warnings.append("The lowest mass (%s) starts %.2f m %s the zones' ground (%.2f m%s), so every zone is shifted by that much. "
                            "Check the street slab level, or choose the Level the buildings stand on in SBD Export."
                            % (low["name"], abs(low["base_m"]), "above" if low["base_m"] > 0 else "below", g,
                               ", " + data["ground_source"] if data.get("ground_source") else ""))
    tallest = max([h["top_m"] for h in heights] or [20.0])
    # the Low zone's portion <= 1/3 H is disregarded (the BD sample case):
    # its plan footprints start at H / 3, so a low podium edge does not close
    # a setback, and its elevation shows that band hatched
    exempt_of = {name: ((z1 - z0) / 3.0 if name == "LOW" and z1 is not None else 0.0) for (name, z0, z1) in (zones or ZONES)}
    zone_fp = [(name, z0, z1) + zone_footprints(data, z0 + exempt_of[name], z1) for (name, z0, z1) in (zones or ZONES)]
    # a plan level chosen for a zone: its plan (gaps, side regions,
    # corridors) from the masses cut at that one height - the podium's shape
    # differs level to level; the elevation stays the true 3D, so what
    # blocks at other heights still blocks. Case 1 keeps the whole band.
    levels = {k: v for k, v in (levels or {}).items() if v is not None}
    lv_of = zone_levels(data, zones)
    plan_fp = []
    for name, z0, z1, inside, other in zone_fp:
        at = levels.get(name)
        if at is not None:
            hi = z1 if z1 is not None else tallest
            at = min(max(float(at), z0 + exempt_of[name] + 0.01), hi - 0.01)
            inside, other = zone_footprints(data, z0, z1, at=at)
        plan_fp.append((name, z0, z1, inside, other, at))
    loops_of = {}
    for name, z0, z1, inside, other, _at in plan_fp:
        loops = [geom.ensure_loop_ccw([_pt(p) for p in f["loop"]]) for f in inside]
        if corridor_poly:
            loops = P.filter_buildings_outside_corridor(loops, corridor_poly)
        loops_of[name] = loops
    # Lp (Table 1): the Low zone's buildings, all of them (the BD sample:
    # the podium with full site coverage, 80 m), projected on Plane X
    # (Axis 1); the add-in's figure (shorter side of one building) kept beside it
    low_loops = []
    for name, z0, z1 in (zones or ZONES):
        if name == "LOW":
            low_loops = [geom.ensure_loop_ccw([_pt(p) for p in f["loop"]]) for f in zone_footprints(data, z0, z1)[0]]
    lp = {"addin_m": round(lp_addin_m(low_loops), 2) if low_loops else 0.0,
          "projected_m": round(sum(hi - lo for lo, hi in P._blocked_intervals(low_loops, a)) * M, 3) if low_loops else 0.0}
    req_p = A.required_p(site_area, lp["projected_m"], tallest)
    # Table 1 per plane: a site under 2 ha is checked on Plane X only (the BD
    # sample case); 2 ha and over, Plane X 20 % and Plane Y 25 / 33.3 %
    req_x, req_y = P.get_required_p_planes(site_area, lp["projected_m"], tallest)
    if site_area < 20000.0:
        req_y = None
    fails = []
    out_zones, all_p, log = [], [], []
    for name, z0, z1, inside, other, at in plan_fp:
        loops = loops_of[name]
        z = {"zone": name, "z0": z0, "z1": z1, "exempt_m": round(exempt_of[name], 3),
             "plan_level": None if at is None else round(at, 3), "levels": lv_of.get(name) or [], "footprints": [{"loop": [[round(x, 3), round(y, 3)] for x, y in f["loop"]],
             "name": f.get("name"), "z": round(f["z"] - g, 2)} for f in inside],
             "others": [[[round(x, 3), round(y, 3)] for x, y in f["loop"]] for f in other], "assessed": bool(loops)}
        if loops:
            zr, text = A.assess(name, site_pts, loops, a, req_p=req_p, tallest_m=tallest)
            log.append("== %s ==" % name)
            log += text.splitlines()
            # the zone's buildings, named along the street (B1, B2 ...) - the
            # same names on the plan and the elevations
            bldgs = [(lab, [l["loop"] for l in ls]) for lab, ls in _named(inside, a)]
            z["buildings"] = [{"label": lab, "at": [round(sum(p[0] for l in ls for p in l) / sum(len(l) for l in ls), 2),
                                                    round(sum(p[1] for l in ls for p in l) / sum(len(l) for l in ls), 2)],
                               "name": ", ".join(sorted(set(f.get("name") or "" for f in inside if any(f["loop"] is l for l in ls))))}
                              for lab, ls in bldgs]
            top = z1 if z1 is not None else tallest
            # each plane pair the engine confirmed: its deformed elevations;
            # the pair giving the most P (as reported) wins
            tried, best = [], None
            for c in zr["candidates"]:
                pack = {}
                for key, rq in (("axis1", req_x), ("axis2", req_y)):
                    ao = _axis_out(c[key], site_pts, bldgs, [front] if front else data.get("streets"))
                    el = None
                    if top > z0 + 1e-6:
                        el = E.zone_elevation(data["masses"], g, ao["edge"], z0, top, ao["axis"], rq or req_x, exempt_of[name])
                    for it in ao["edge"]:
                        it.pop("members", None)
                    ao["elev"] = el
                    ao["P_zone"] = round(el["P"] if el else ao["P"], 2)
                    ao["required_p"] = rq
                    pack[key] = ao
                px, py = pack["axis1"]["P_zone"], pack["axis2"]["P_zone"]
                score = (min(px, py), px) if req_y is not None else (px, py)
                x_deg = _angle(a, pack["axis1"]["axis"])
                y_deg = abs(_angle(pack["axis1"]["axis"], pack["axis2"]["axis"], 180.0))
                tried.append({"x_deg": round(x_deg, 1), "y_deg": round(y_deg, 1), "P_x": px, "P_y": py})
                if best is None or score > best[0]:
                    best = (score, pack, x_deg, y_deg, len(tried) - 1)
            _, pack, x_deg, y_deg, bi = best
            tried[bi]["chosen"] = True
            z["tried"] = tried
            z["axis1"], z["axis2"] = pack["axis1"], pack["axis2"]
            z["plane_x_deg"] = round(x_deg, 1)
            z["plane_y_deg"] = round(y_deg, 1)
            z["P_plan"] = round(min(z["axis1"]["P"], z["axis2"]["P"]), 2)
            ps = []
            for key, rq in (("axis1", req_x), ("axis2", req_y)):
                ao = z[key]
                el = ao["elev"]
                pv = ao["P_zone"]
                if rq is not None:
                    ps.append(pv)
                    ok = pv >= rq - 1e-9 and (not el or el["is_min_ok"] is not False)
                    ao["pass"] = ok
                    if not ok:
                        fails.append("%s %s" % (name, "Plane X" if key == "axis1" else "Plane Y"))
            z["P"] = round(min(ps or [z["axis1"]["P_zone"]]), 2)
            all_p += ps or [z["axis1"]["P_zone"]]
            z["corridors"] = [{"polygon": gp["corridor"], "width_m": gp["distance_m"], "qualifies": gp["qualifies"],
                               "bend_deg": gp.get("bend_deg", 0.0)} for gp in z["axis1"]["gaps"] if gp.get("corridor")]
        out_zones.append(z)
    req_old = A.required_p(site_area, lp["addin_m"], tallest)
    ctrl = min(all_p) if all_p else None
    c1 = case1(data, [(name, inside) for name, z0, z1, inside, other in zone_fp], a, legs)
    return {
        "ok": True, "version": 2, "warnings": warnings, "log": log[-400:], "heights": heights, "tallest_m": tallest,
        "axis": {"source": axis_src, "axis1": [round(a.X, 6), round(a.Y, 6)], "axis2": [round(b.X, 6), round(b.Y, 6)]},
        "site": [[round(p[0], 3), round(p[1], 3)] for p in data["site"]], "site_area_m2": round(site_area, 2),
        "zones": out_zones, "controlling_p": None if ctrl is None else round(ctrl, 2),
        "lp": lp, "required_p": req_x, "required_p_y": req_y, "required_p_addin": req_old, "fails": fails,
        "pass": None if ctrl is None or req_x is None else not fails,
        "case1": c1, "street_legs": [{k: v for k, v in lg.items() if k not in ("opposite",)} for lg in legs],
        "case1_pass": None if not any(c["buildings"] for c in c1) else all(b["pass"] for c in c1 for b in c["buildings"]),
        "streets": [{"name": s.get("name") or "", "centreline": s.get("centreline") or [], "opposite": s.get("opposite") or [],
                     "outline": s.get("outline") or [], "level": s.get("level"), "label": s.get("label") or s.get("name") or ""}
                    for s in data.get("streets") or []],
        "ground_z": data.get("ground_z"), "ground_source": data.get("ground_source") or "", "level0": data.get("level0"),
        "ms": int((time.time() - t0) * 1000),
    }
