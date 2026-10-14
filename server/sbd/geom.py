# -*- coding: utf-8 -*-
"""The parts of sbd_geom_base.py the permeability engine uses (unchanged)."""

import math
from .xyz import XYZ

FEET_TO_METERS = 0.3048
LOG = []


def debug_print(msg):
    LOG.append(msg)


def signed_area_2d(pts):
    if len(pts) < 3:
        return 0.0
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i].X, pts[i].Y
        x2, y2 = pts[(i + 1) % n].X, pts[(i + 1) % n].Y
        s += x1 * y2 - x2 * y1
    return s * 0.5


def polygon_area_2d(pts):
    return abs(signed_area_2d(pts))


def ensure_loop_ccw(loop_pts):
    return list(reversed(loop_pts)) if signed_area_2d(loop_pts) < 0 else list(loop_pts)


def project_polygon_onto_axis(pts, axis):
    if not pts:
        return 0.0, 0.0
    values = [p.X * axis.X + p.Y * axis.Y for p in pts]
    return min(values), max(values)


def merge_overlapping_intervals(intervals):
    cleaned = [[lo, hi] for (lo, hi) in intervals if hi >= lo]
    if not cleaned:
        return []
    cleaned.sort(key=lambda iv: iv[0])
    merged = [cleaned[0][:]]
    for lo, hi in cleaned[1:]:
        last = merged[-1]
        if lo <= last[1] + 1e-9:
            if hi > last[1]:
                last[1] = hi
        else:
            merged.append([lo, hi])
    return merged


def compute_dominant_axis(points):
    """2D PCA (closed form): the direction of the largest spread."""
    if not points or len(points) < 2:
        return XYZ(1, 0, 0)
    n = float(len(points))
    mx = sum(p.X for p in points) / n
    my = sum(p.Y for p in points) / n
    sxx = syy = sxy = 0.0
    for p in points:
        dx = p.X - mx
        dy = p.Y - my
        sxx += dx * dx
        syy += dy * dy
        sxy += dx * dy
    sxx /= n
    syy /= n
    sxy /= n
    tr = sxx + syy
    diff = sxx - syy
    disc = math.sqrt((diff * 0.5) * (diff * 0.5) + sxy * sxy)
    lambda_max = tr * 0.5 + disc
    if abs(sxy) > 1e-12:
        vx = lambda_max - syy
        vy = sxy
    else:
        vx, vy = (1.0, 0.0) if sxx >= syy else (0.0, 1.0)
    length = math.sqrt(vx * vx + vy * vy)
    if length < 1e-12:
        return XYZ(1, 0, 0)
    return XYZ(vx / length, vy / length, 0)


def validate_projection(site_pts, building_loops, axis, tol=1e-6):
    site_min, site_max = project_polygon_onto_axis(site_pts, axis)
    if site_max - site_min < tol:
        return False
    for loop in building_loops:
        if not loop:
            continue
        b_min, b_max = project_polygon_onto_axis(loop, axis)
        if b_min < site_min - tol or b_max > site_max + tol:
            return False
    return True


def segment_segment_intersection(a1, a2, b1, b2):
    r = a2 - a1
    s = b2 - b1
    denom = r.X * s.Y - r.Y * s.X
    if abs(denom) < 1e-9:
        return None, None, None
    diff = b1 - a1
    t = (diff.X * s.Y - diff.Y * s.X) / denom
    u = (diff.X * r.Y - diff.Y * r.X) / denom
    if -1e-9 <= t <= 1.0 + 1e-9 and -1e-9 <= u <= 1.0 + 1e-9:
        t_c = max(0.0, min(1.0, t))
        return t_c, u, a1 + r * t_c
    return None, None, None
