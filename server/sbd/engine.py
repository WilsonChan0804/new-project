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
from . import permeability as P
from . import corridor as C
from . import footprint as F

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


def zone_footprints(data, z0, z1):
    """{"site": [loops of buildings on the site], "other": [loops outside]} (metres)."""
    g = float(data.get("ground_z") or 0.0)
    site = data["site"]
    inside, other = [], []
    for m in data.get("masses") or []:
        for f in F.mass_footprints(m, g + z0, None if z1 is None else g + z1):
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


def _axis_out(r, site_pts):
    """One axis' result in metres, with drawable strips for each gap."""
    ax = r["axis"]
    av = P.orthogonal_axis(ax)
    ref = P.site_centroid(site_pts)
    v_lo, v_hi = geom.project_polygon_onto_axis(site_pts, av)

    def strip(lo, hi):
        a = P.axis_scalar_to_point(lo, ax, ref)
        b = P.axis_scalar_to_point(hi, ax, ref)
        rv = ref.X * av.X + ref.Y * av.Y
        return [_xy(q) for q in (a + av * (v_lo - rv), b + av * (v_lo - rv), b + av * (v_hi - rv), a + av * (v_hi - rv))]

    gaps = []
    for g in r.get("all_gap_results") or []:
        ms = g.get("measurement") or {}
        e = {"lo_m": round(g["gap_lo"] * M, 3), "hi_m": round(g["gap_hi"] * M, 3), "width_m": round(g["width_ft"] * M, 3),
             "qualifies": bool(g.get("qualifies")), "type": ms.get("type", ""), "distance_m": round(ms.get("distance_m", 0.0), 3),
             "pass": bool(ms.get("pass")), "threshold_m": ms.get("threshold_m"), "strip": strip(g["gap_lo"], g["gap_hi"])}
        if ms.get("vertex_a") is not None and ms.get("vertex_b") is not None:
            e["pinch"] = [_xy(ms["vertex_a"]), _xy(ms["vertex_b"])]
        if ms.get("encroach_ft") is not None:
            e["encroach_m"] = round(ms["encroach_ft"] * M, 3)
        if ms.get("type") == "S3":
            e["area_m2"] = round(ms.get("area_m2", 0.0), 2)
            e["depth_m"] = round(ms.get("depth_m", 0.0), 3)
        gaps.append(e)
    return {
        "P": round(r["P"], 2), "W_m": round(r["W"] * M, 3), "IS_m": round(r["IS"] * M, 3),
        "sweep_deg": r.get("sweep_angle", 0), "axis": [round(ax.X, 6), round(ax.Y, 6)],
        "site_lo_m": round(r.get("site_lo", 0) * M, 3), "site_hi_m": round(r.get("site_hi", 0) * M, 3),
        "blocked_m": [[round(a * M, 3), round(b * M, 3)] for a, b in r.get("merged") or []],
        "ref": _xy(ref), "gaps": gaps,
    }


def case1(data, low_inside):
    """Design Requirement (1), street canyon: U = canyon area / length along
    the centreline, Lp_max = 5 U (Fig B7), per building and street, from the
    Low zone footprints. Stations every 0.5 m along the centreline: the
    canyon width there runs perpendicular to it from the building's facade
    (within 30 m of the centreline) to the opposite site boundary."""
    out = []
    if not data.get("streets") or not low_inside:
        return out
    groups = _buildings(low_inside)
    sx, sy = _centroid(data["site"])
    for st in data["streets"]:
        cl = st.get("centreline") or []
        opp = st.get("opposite") or []
        if len(cl) < 2 or len(opp) < 2:
            continue
        per = []
        for gi, loops in enumerate(groups):
            width_sum = 0.0
            n = 0
            for (px, py, nx, ny) in _stations(cl, CASE1_STEP_M):
                # the subject side: towards the site
                if (sx - px) * nx + (sy - py) * ny < 0:
                    nx, ny = -nx, -ny
                hits = [h for h in (_ray_hit(px, py, nx, ny, l) for l in loops) if h is not None]
                df = min(hits) if hits else None
                if df is None or df > CASE1_REACH_M:
                    continue
                do = _ray_hit_line(px, py, -nx, -ny, opp)
                if do is None:
                    continue
                width_sum += df + do
                n += 1
            if not n:
                continue
            L = n * CASE1_STEP_M
            U = width_sum * CASE1_STEP_M / L
            per.append({"building": gi + 1, "name": loops[0].get("name", ""), "U_m": round(U, 3), "L_m": round(L, 2),
                        "Lp_m": round(L, 2), "Lp_max_m": round(5 * U, 2), "pass": L <= 5 * U + 1e-6})
        out.append({"street": st.get("name") or "Street %d" % (len(out) + 1), "buildings": per})
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


def run(data, axis="street", angle_deg=0.0, zones=None):
    t0 = time.time()
    del geom.LOG[:]
    warnings = check_input(data)
    if not data.get("site") or len(data["site"]) < 3:
        return {"ok": False, "warnings": warnings}
    site_pts = [_pt(p) for p in data["site"]]
    site_pts = geom.ensure_loop_ccw(site_pts)
    # the projection axis (Axis 1, along Projection Plane X)
    street = data.get("street_axis")
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
    # an optional notional corridor (Fig B13-B14): buildings in it are left out
    corridor_poly = None
    if data.get("corridor") and len(data["corridor"]) >= 2:
        corridor_poly = P.offset_polyline_both_sides([_pt(p) for p in data["corridor"]], 7.5 * FT)
    site_area = geom.polygon_area_2d(site_pts) * M * M
    out_zones, all_p = [], []
    lp = {"addin_m": 0.0, "projected_m": 0.0}
    low_inside = []
    for (name, z0, z1) in (zones or ZONES):
        inside, other = zone_footprints(data, z0, z1)
        if name == "LOW":
            low_inside = inside
        loops = [geom.ensure_loop_ccw([_pt(p) for p in f["loop"]]) for f in inside]
        if corridor_poly:
            loops = P.filter_buildings_outside_corridor(loops, corridor_poly)
        z = {"zone": name, "z0": z0, "z1": z1, "footprints": [{"loop": [[round(x, 3), round(y, 3)] for x, y in f["loop"]],
             "name": f.get("name"), "z": round(f["z"], 3)} for f in inside],
             "others": [[[round(x, 3), round(y, 3)] for x, y in f["loop"]] for f in other], "assessed": bool(loops)}
        if loops:
            r = P.assess_zone(name, site_pts, site_pts, loops, a, b)
            z["axis1"] = _axis_out(r["axis1"], site_pts)
            z["axis2"] = _axis_out(r["axis2"], site_pts)
            z["P"] = round(min(r["axis1"]["P"], r["axis2"]["P"]), 2)
            all_p += [r["axis1"]["P"], r["axis2"]["P"]]
            ax1 = r["axis1"]["axis"]
            try:
                cs = C.compute_wind_corridors(site_pts, loops, ax1, P.orthogonal_axis(ax1))
            except Exception as e:      # the corridor search is advisory
                cs = []
                warnings.append("Air corridor search failed in the %s zone: %s" % (name, e))
            z["corridors"] = [{"polygon": _loop_xy(c["polygon"]), "width_m": round(c["width_m"], 2), "qualifies": c["qualifies"]} for c in cs]
            if name == "LOW":
                lp["addin_m"] = round(lp_addin_m(loops), 2)
                # Lp: the buildings' length projected on Projection Plane X
                # (Axis 1 itself, not the swept angle), all buildings together
                lp["projected_m"] = round(sum(hi - lo for lo, hi in P._blocked_intervals(loops, a)) * M, 2)
        out_zones.append(z)
    req_new = P.get_required_p(site_area, lp["projected_m"])
    req_old = P.get_required_p(site_area, lp["addin_m"])
    ctrl = min(all_p) if all_p else None
    return {
        "ok": True, "version": 1, "warnings": warnings, "log": list(geom.LOG[-200:]),
        "axis": {"source": axis_src, "axis1": [round(a.X, 6), round(a.Y, 6)], "axis2": [round(b.X, 6), round(b.Y, 6)]},
        "site": [[round(p[0], 3), round(p[1], 3)] for p in data["site"]], "site_area_m2": round(site_area, 2),
        "zones": out_zones, "controlling_p": None if ctrl is None else round(ctrl, 2),
        "lp": lp, "required_p": req_new, "required_p_addin": req_old,
        "pass": None if ctrl is None or req_new is None else ctrl >= req_new - 1e-9,
        "case1": case1(data, low_inside),
        "streets": [{"name": s.get("name") or "", "centreline": s.get("centreline") or [], "opposite": s.get("opposite") or [],
                     "outline": s.get("outline") or []} for s in data.get("streets") or []],
        "ground_z": data.get("ground_z"), "ground_source": data.get("ground_source") or "",
        "ms": int((time.time() - t0) * 1000),
    }
