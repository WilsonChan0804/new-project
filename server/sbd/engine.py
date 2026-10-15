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
        sides[k] = {"avg_m": round(sd.get("avg_width_m", 0.0), 3), "area_m2": round(sd.get("area_m2", 0.0), 2),
                    "depth_m": round(sd.get("D_m", 0.0), 3), "angle_deg": round(sd.get("angle_deg", 0.0), 1),
                    "polygon": [_xy(q) for q in (sd.get("region_polygon") or [])]}
        side_band[k] = N.side_band(sd, site_uv) if sd.get("inner_uv") else None
        if side_band[k]:
            sides[k]["band"] = N.to_xy_m(side_band[k], ax, av)
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
    low, gruns, sruns = N.partition(site_pts, bands, ax, av, N.near_side(site_pts, ax, av, streets),
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
                         "pass": g["qualifies"], "gap": i, "lo": round(a * M, 3), "hi": round(b * M, 3), "bend_deg": g.get("bend_deg")})
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


def case1(data, zone_inside):
    """Design Requirement (1), street canyon (Fig B7), per zone: U = canyon
    area / its length along the centreline, Lp_max = 5 U. Stations every
    0.5 m along the centreline: the canyon width there runs perpendicular to
    it from the building's facade (within 30 m of the centreline) to the
    opposite site boundary. Lp is the building's facade projected on the
    street (the BD sample: podium 80 m, tower 32 m); in the Low zone the
    portion <= 1/3 H is left out (zone_inside holds its footprints above it).
    zone_inside: [(zone, [footprints])]."""
    out = []
    if not data.get("streets"):
        return out
    sx, sy = _centroid(data["site"])
    for zname, inside in zone_inside:
        if not inside:
            continue
        groups = _buildings(inside)
        for st in data["streets"]:
            cl = st.get("centreline") or []
            opp = st.get("opposite") or []
            if len(cl) < 2 or len(opp) < 2:
                continue
            dx, dy = cl[-1][0] - cl[0][0], cl[-1][1] - cl[0][1]
            dl = math.hypot(dx, dy) or 1.0
            dx, dy = dx / dl, dy / dl
            per = []
            for gi, loops in enumerate(groups):
                width_sum, n, near = 0.0, 0, []
                runs, cur, last = [], None, None      # the canyon, drawn: facade and opposite points per run
                nside = None
                for k, (px, py, nx, ny) in enumerate(_stations(cl, CASE1_STEP_M)):
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
                    near.append(df)
                    n += 1
                    nside = nside or (nx, ny)
                    if cur is None or last != k - 1:
                        cur = ([], [])
                        runs.append(cur)
                    cur[0].append([round(px + nx * df, 3), round(py + ny * df, 3)])
                    cur[1].append([round(px - nx * do, 3), round(py - ny * do, 3)])
                    last = k
                if not n:
                    continue
                L = n * CASE1_STEP_M
                U = width_sum * CASE1_STEP_M / L
                pts = [p for l in loops for p in l["loop"]]
                us = [p[0] * dx + p[1] * dy for p in pts]
                lp = max(us) - min(us)
                # Lp drawn along the street, just in front of the building
                nx0, ny0 = nside
                w = min(p[0] * nx0 + p[1] * ny0 for p in pts) - 2.0
                lp_line = [[round(u * dx + w * nx0, 3), round(u * dy + w * ny0, 3)] for u in (min(us), max(us))]
                per.append({"building": gi + 1, "name": loops[0].get("name", ""), "U_m": round(U, 3), "L_m": round(L, 2),
                            "area_m2": round(width_sum * CASE1_STEP_M, 1), "setback_m": round(min(near) - (st.get("width_m") or 0) / 2.0, 2)
                            if st.get("width_m") else None,
                            "Lp_m": round(lp, 2), "Lp_max_m": round(5 * U, 2), "pass": lp <= 5 * U + 1e-6,
                            "canyon": [f + list(reversed(o)) for f, o in runs if len(f) >= 2],
                            "facade": [f for f, o in runs if len(f) >= 2], "lp_line": lp_line})
            if per:
                out.append({"zone": zname, "street": st.get("name") or "Street %d" % (data["streets"].index(st) + 1), "buildings": per})
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
    loops_of = {}
    for name, z0, z1, inside, other in zone_fp:
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
          "projected_m": round(sum(hi - lo for lo, hi in P._blocked_intervals(low_loops, a)) * M, 2) if low_loops else 0.0}
    req_p = A.required_p(site_area, lp["projected_m"], tallest)
    # Table 1 per plane: a site under 2 ha is checked on Plane X only (the BD
    # sample case); 2 ha and over, Plane X 20 % and Plane Y 25 / 33.3 %
    req_x, req_y = P.get_required_p_planes(site_area, lp["projected_m"], tallest)
    if site_area < 20000.0:
        req_y = None
    fails = []
    out_zones, all_p, log = [], [], []
    for name, z0, z1, inside, other in zone_fp:
        loops = loops_of[name]
        z = {"zone": name, "z0": z0, "z1": z1, "exempt_m": round(exempt_of[name], 3), "footprints": [{"loop": [[round(x, 3), round(y, 3)] for x, y in f["loop"]],
             "name": f.get("name"), "z": round(f["z"] - g, 2)} for f in inside],
             "others": [[[round(x, 3), round(y, 3)] for x, y in f["loop"]] for f in other], "assessed": bool(loops)}
        if loops:
            zr, text = A.assess(name, site_pts, loops, a, req_p=req_p, tallest_m=tallest)
            log.append("== %s ==" % name)
            log += text.splitlines()
            # the zone's buildings, named along the street (B1, B2 ...) - the
            # same names on the plan and the elevations
            bl = sorted(_buildings(inside), key=lambda ls: sum((p[0] * a.X + p[1] * a.Y) for l in ls for p in l["loop"])
                        / max(1, sum(len(l["loop"]) for l in ls)))
            bldgs = [("B%d" % (i + 1), [l["loop"] for l in ls]) for i, ls in enumerate(bl)]
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
                    ao = _axis_out(c[key], site_pts, bldgs, data.get("streets"))
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
    c1 = case1(data, [(name, inside) for name, z0, z1, inside, other in zone_fp])
    return {
        "ok": True, "version": 2, "warnings": warnings, "log": log[-400:], "heights": heights, "tallest_m": tallest,
        "axis": {"source": axis_src, "axis1": [round(a.X, 6), round(a.Y, 6)], "axis2": [round(b.X, 6), round(b.Y, 6)]},
        "site": [[round(p[0], 3), round(p[1], 3)] for p in data["site"]], "site_area_m2": round(site_area, 2),
        "zones": out_zones, "controlling_p": None if ctrl is None else round(ctrl, 2),
        "lp": lp, "required_p": req_x, "required_p_y": req_y, "required_p_addin": req_old, "fails": fails,
        "pass": None if ctrl is None or req_x is None else not fails,
        "case1": c1,
        "case1_pass": None if not c1 else all(b["pass"] for c in c1 for b in c["buildings"]),
        "streets": [{"name": s.get("name") or "", "centreline": s.get("centreline") or [], "opposite": s.get("opposite") or [],
                     "outline": s.get("outline") or []} for s in data.get("streets") or []],
        "ground_z": data.get("ground_z"), "ground_source": data.get("ground_source") or "",
        "ms": int((time.time() - t0) * 1000),
    }
