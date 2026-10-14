# -*- coding: utf-8 -*-
"""A zone's elevational projection on one projection plane (APP-152 Fig B10,
B11 and the BD sample case), from the 3D masses, in metres.

The masses are cut into horizontal rows (at every vertex height, and at most
ROW_M apart for sloped faces); in each row the sections are projected onto
the plane. Columns break at every projected edge, so the cells (column x row)
are exact for flat-faced masses. Each open cell is then:

  is      - in a separating gap that qualifies on plan (S1/S2/S3): IS over
            the zone's height (in the Low zone above the disregarded band)
  sky     - open to above over a lower building (a podium roof): IS when the
            open run, with any IS beside it, is at least MIN_S wide
  pe      - enclosed by building above (a void through the block): PE when
            its clear width and height are both >= PE_MIN (3 m)
  open    - open but not counted (too narrow, too low)
  exempt  - the Low zone's portion <= 1/3 H: disregarded (shown hatched)

P = (IS area + PE area) / (W x H). PE counts up to 1/3 of the required P,
and IS alone must reach 2/3 of it.
"""

from . import footprint as F

ROW_M = 1.0          # the tallest row (sloped faces are stepped this fine)
MIN_S = 7.5          # the narrowest IS (S1) - an open-to-above run narrower is not counted
PE_MIN = 3.0         # PE: clear width and height
EPS = 1e-6


def _merge(iv):
    iv = sorted(iv)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1] + EPS:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _rows(masses, g, z0, z1, exempt):
    """Row limits (relative to the ground) inside [z0, z1]."""
    cuts = {z0, z1}
    if exempt:
        cuts.add(z0 + exempt)
    for m in masses:
        for v in m.get("verts") or []:
            z = v[2] - g
            if z0 < z < z1:
                cuts.add(z)
    cuts = sorted(cuts)
    rows = []
    for a, b in zip(cuts, cuts[1:]):
        if b - a < 1e-3:
            continue
        n = max(1, int((b - a) / ROW_M + 0.999))
        for k in range(n):
            rows.append((a + (b - a) * k / n, a + (b - a) * (k + 1) / n))
    return rows


def _blocked(masses, g, z, ax, site):
    """The projections onto the plane of everything standing on the site at
    height z (relative to the ground): merged [lo, hi] along ax."""
    iv = []
    for m in masses:
        verts, tris = m.get("verts"), m.get("tris")
        if not verts or not tris:
            continue
        zs = [v[2] for v in verts]
        if not (min(zs) < g + z < max(zs)):
            continue
        for part in F.components(tris):
            for loop in F._section(verts, part, g + z):
                cx = sum(p[0] for p in loop) / len(loop)
                cy = sum(p[1] for p in loop) / len(loop)
                if site and not F.point_in(cx, cy, site):
                    continue
                us = [p[0] * ax[0] + p[1] * ax[1] for p in loop]
                iv.append([min(us), max(us)])
    return _merge(iv)


def _inside(u, iv):
    for a, b in iv:
        if a - EPS <= u <= b + EPS:
            return True
    return False


def _over(masses, g, z1, ax, site):
    """What stands above the zone (a tower over a podium garden): its
    projections, so a void under it is enclosed, not open to above."""
    top = max([v[2] - g for m in masses for v in (m.get("verts") or [])] or [z1])
    iv = []
    for a, b in _rows(masses, g, z1, top, 0.0) if top > z1 + 1e-3 else []:
        iv += _blocked(masses, g, 0.5 * (a + b), ax, site)
    return _merge(iv)


def zone_elevation(masses, ground, site, ax, lo, hi, z0, z1, is_gaps, req_p=None, exempt=0.0):
    """One zone on one plane.

    masses: the export's masses (absolute z); ground: the zones' ground;
    site: the site boundary [[x, y]]; ax: the plane's direction (unit);
    lo, hi: the site's projection on it (W = hi - lo); z0, z1: the zone
    (relative to the ground); is_gaps: [(lo, hi)] the gaps that qualify on
    plan; exempt: the Low zone's disregarded height (H / 3) or 0."""
    H = z1 - z0
    W = hi - lo
    if H <= EPS or W <= EPS:
        return None
    rows = _rows(masses, ground, z0, z1, exempt)
    blocked = [_blocked(masses, ground, 0.5 * (a + b), ax, site) for a, b in rows]
    over = _over(masses, ground, z1, ax, site)
    cuts = {lo, hi}
    for iv in blocked:
        for a, b in iv:
            if lo < a < hi:
                cuts.add(a)
            if lo < b < hi:
                cuts.add(b)
    for a, b in list(is_gaps) + over:
        cuts.update(c for c in (a, b) if lo < c < hi)
    cols = sorted(cuts)
    cols = [(a, b) for a, b in zip(cols, cols[1:]) if b - a > 1e-4]
    nr, nc = len(rows), len(cols)
    # kind per cell, rows bottom to top
    kind = [[None] * nc for _ in range(nr)]
    for r, (za, zb) in enumerate(rows):
        for c, (ua, ub) in enumerate(cols):
            um = 0.5 * (ua + ub)
            if exempt and zb <= z0 + exempt + EPS:
                kind[r][c] = "exempt"
            elif _inside(um, blocked[r]):
                kind[r][c] = "bldg"
            elif _inside(um, is_gaps):
                kind[r][c] = "is"
            else:
                kind[r][c] = "o"
    # open to above: an open cell with only open cells over it
    for c in range(nc):
        top = not _inside(0.5 * (cols[c][0] + cols[c][1]), over)
        for r in range(nr - 1, -1, -1):
            k = kind[r][c]
            if k == "o":
                kind[r][c] = "sky" if top else "enc"
            elif k != "is":
                top = False
    # open-to-above runs: IS when the run (with IS beside it) is >= MIN_S
    col_w = [b - a for a, b in cols]
    has = lambda c, k: any(kind[r][c] == k for r in range(nr))
    c = 0
    while c < nc:
        if not has(c, "sky"):
            c += 1
            continue
        e = c
        while e + 1 < nc and has(e + 1, "sky"):
            e += 1
        w = sum(col_w[c:e + 1])
        x = c - 1
        while x >= 0 and has(x, "is"):
            w += col_w[x]
            x -= 1
        x = e + 1
        while x < nc and has(x, "is"):
            w += col_w[x]
            x += 1
        for cc in range(c, e + 1):
            for r in range(nr):
                if kind[r][cc] == "sky":
                    kind[r][cc] = "skyis" if w >= MIN_S - EPS else "open"
        c = e + 1
    # enclosed voids: PE where the clear height and width are >= PE_MIN
    seen = set()
    for r0 in range(nr):
        for c0 in range(nc):
            if kind[r0][c0] != "enc" or (r0, c0) in seen:
                continue
            comp, stack = [], [(r0, c0)]
            seen.add((r0, c0))
            while stack:
                r, c = stack.pop()
                comp.append((r, c))
                for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= rr < nr and 0 <= cc < nc and (rr, cc) not in seen and kind[rr][cc] == "enc":
                        seen.add((rr, cc))
                        stack.append((rr, cc))
            # per column: the tallest clear run of this void in it
            tall = {}
            for r, c in comp:
                tall.setdefault(c, []).append(r)
            good_cols = set()
            for c, rs in tall.items():
                rs.sort()
                best = run = rows[rs[0]][1] - rows[rs[0]][0]
                for a, b in zip(rs, rs[1:]):
                    run = run + rows[b][1] - rows[b][0] if b == a + 1 else rows[b][1] - rows[b][0]
                    best = max(best, run)
                if best >= PE_MIN - EPS:
                    good_cols.add(c)
            ok = set()
            cs = sorted(good_cols)
            i = 0
            while i < len(cs):
                j = i
                while j + 1 < len(cs) and cs[j + 1] == cs[j] + 1:
                    j += 1
                if sum(col_w[cs[i]:cs[j] + 1]) >= PE_MIN - EPS:
                    ok.update(cs[i:j + 1])
                i = j + 1
            for r, c in comp:
                kind[r][c] = "pe" if c in ok else "open"
    # areas
    area = {}
    for r, (za, zb) in enumerate(rows):
        for c, (ua, ub) in enumerate(cols):
            k = kind[r][c]
            area[k] = area.get(k, 0.0) + (zb - za) * (ub - ua)
    zone_area = W * H
    is_area = area.get("is", 0.0) + area.get("skyis", 0.0)
    pe_area = area.get("pe", 0.0)
    pe_cap = (req_p / 100.0 / 3.0) * zone_area if req_p else None
    pe_used = pe_area if pe_cap is None else min(pe_area, pe_cap)
    p_is = 100.0 * is_area / zone_area
    p_pe = 100.0 * pe_used / zone_area
    # rectangles to draw: vertical runs per column, then joined sideways
    rects = []
    for c, (ua, ub) in enumerate(cols):
        r = 0
        while r < nr:
            k = kind[r][c]
            e = r
            while e + 1 < nr and kind[e + 1][c] == k:
                e += 1
            rects.append([ua, ub, rows[r][0], rows[e][1], k])
            r = e + 1
    rects.sort(key=lambda q: (q[4], q[2], q[3], q[0]))
    joined = []
    for q in rects:
        p = joined[-1] if joined else None
        if p and p[4] == q[4] and abs(p[2] - q[2]) < EPS and abs(p[3] - q[3]) < EPS and abs(p[1] - q[0]) < EPS:
            p[1] = q[1]
        else:
            joined.append(list(q))
    kinds = {"bldg": "bldg", "exempt": "exempt", "is": "is", "skyis": "sky", "pe": "pe", "open": "open", "o": "open", "enc": "open"}
    is_parts = [{"w_m": round(q[1] - q[0], 2), "h_m": round(q[3] - q[2], 2), "area_m2": round((q[1] - q[0]) * (q[3] - q[2]), 2),
                 "kind": kinds[q[4]]} for q in joined if q[4] in ("is", "skyis", "pe")]
    return {
        "W_m": round(W, 3), "H_m": round(H, 3), "z0": z0, "z1": z1, "lo_m": round(lo, 3),
        "exempt_m": round(exempt, 3), "zone_area_m2": round(zone_area, 2),
        "is_area_m2": round(is_area, 2), "pe_area_m2": round(pe_area, 2),
        "pe_cap_m2": None if pe_cap is None else round(pe_cap, 2), "pe_used_m2": round(pe_used, 2),
        "P_is": round(p_is, 2), "P_pe": round(p_pe, 2), "P": round(p_is + p_pe, 2),
        "is_min_ok": None if not req_p else p_is >= req_p * 2.0 / 3.0 - 1e-9,
        "parts": is_parts,
        "rects": [[round(q[0] - lo, 3), round(q[1] - lo, 3), round(q[2] - z0, 3), round(q[3] - z0, 3), kinds[q[4]]] for q in joined],
    }
