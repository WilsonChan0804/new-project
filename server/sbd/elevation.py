# -*- coding: utf-8 -*-
"""A zone's deformed elevation on one projection plane (APP-152 Fig B10,
B11, the BD sample case and the SBD panel's deformed elevation), metres.

The strip is laid out from the near edge of the site (nearedge.py), left to
right along the plane:

  a gap     drawn at its S value - the number on the plan (S1 = A / D of
            the side region, S2 = the corridor's width): IS over the zone's
            height when it counts, "not counted" when it does not;
  a shadow  a building group, drawn at its width on the near edge (between
            the gaps beside it - so a bent corridor widens or narrows it).
            Inside it the group's true silhouette (the masses cut into rows,
            projected) is scaled sideways to that width, so its heights,
            voids and lower parts show as they are.

So W = sum of the S values + sum of the shadows, and P = (IS + PE) / (W x H).
In a shadow, an open cell is:

  sky     open to above over a lower building (a podium roof): IS when the
          open run (true width), with any IS beside it, is >= MIN_S
  pe      enclosed by building above (a void through the block): PE when
          its clear width and height are both >= PE_MIN (3 m)
  open    open but not counted
  exempt  the Low zone's portion <= 1/3 H: disregarded (shown hatched)

PE counts up to 1/3 of the required P, and IS alone must reach 2/3 of it.
"""

from . import footprint as F

ROW_M = 1.0          # the tallest row (sloped faces are stepped this fine)
MIN_S = 7.5          # the narrowest IS (S1) - an open-to-above run narrower is not counted
PE_MIN = 3.0         # PE: clear width and height
EPS = 1e-6
_SECTIONS = {}       # (masses id, z) -> [(loop, cx, cy)]: one cut serves every plane


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


def sections(masses, g, z):
    """The masses cut at height z (relative to the ground): [(loop, cx, cy)]."""
    key = (id(masses), round(g + z, 6))
    if key in _SECTIONS:
        return _SECTIONS[key]
    if len(_SECTIONS) > 4000:
        _SECTIONS.clear()
    out = []
    for m in masses:
        verts, tris = m.get("verts"), m.get("tris")
        if not verts or not tris:
            continue
        zs = [v[2] for v in verts]
        if not (min(zs) < g + z < max(zs)):
            continue
        for part in F.components(tris):
            for loop in F._section(verts, part, g + z):
                cx, cy = _inner_point(loop)
                out.append((loop, cx, cy))
    _SECTIONS[key] = out
    return out


def _inner_point(loop):
    """A point inside the loop (which footprint it belongs to is asked of
    this point): the middle of the widest span across its mid height - the
    corners' average can lie outside (between a Y-shaped tower's arms)."""
    ys = [p[1] for p in loop]
    y = (min(ys) + max(ys)) / 2.0
    xs = []
    n = len(loop)
    for i in range(n):
        (x1, y1), (x2, y2) = loop[i][:2], loop[(i + 1) % n][:2]
        if (y1 > y) != (y2 > y):
            xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    spans = [(xs[k], xs[k + 1]) for k in range(0, len(xs) - 1, 2)]
    if not spans:
        return sum(p[0] for p in loop) / n, sum(ys) / n
    a, b = max(spans, key=lambda q: q[1] - q[0])
    return (a + b) / 2.0, y


def _blocked(masses, g, z, ax, keep):
    """The projections of the cut loops that `keep` takes: merged [lo, hi]."""
    iv = []
    for loop, cx, cy in sections(masses, g, z):
        if keep(cx, cy):
            us = [p[0] * ax[0] + p[1] * ax[1] for p in loop]
            iv.append([min(us), max(us)])
    return _merge(iv)


def _inside(u, iv):
    for a, b in iv:
        if a - EPS <= u <= b + EPS:
            return True
    return False


def _group_cells(masses, g, ax, rows, z1, top, members, exempt_top, clip=None):
    """A shadow's true silhouette: (cols [(u0, u1)], kind[row][col]) for the
    masses whose plan lies in one of the members (zone footprints). clip:
    (u0, u1) its run, when an opening runs through its building."""
    def keep(cx, cy):
        return any(F.point_in(cx, cy, l) for l in members)
    us = [p[0] * ax[0] + p[1] * ax[1] for l in members for p in l]
    lo, hi = min(us), max(us)
    blocked = [_blocked(masses, g, 0.5 * (a + b), ax, keep) for a, b in rows]
    over = []
    for a, b in _rows(masses, g, z1, top, 0.0) if top > z1 + 1e-3 else []:
        over += _blocked(masses, g, 0.5 * (a + b), ax, keep)
    over = _merge(over)
    for iv in blocked:
        for a, b in iv:
            lo, hi = min(lo, a), max(hi, b)
    cuts = {lo, hi}
    for iv in blocked + [over]:
        for a, b in iv:
            cuts.update(c for c in (a, b) if lo < c < hi)
    cols = sorted(cuts)
    cols = [(a, b) for a, b in zip(cols, cols[1:]) if b - a > 1e-4]
    if clip:
        cols = [(max(a, clip[0]), min(b, clip[1])) for a, b in cols if min(b, clip[1]) - max(a, clip[0]) > 1e-4]
    kind = []
    for r, (za, zb) in enumerate(rows):
        row = []
        for ua, ub in cols:
            if exempt_top is not None and zb <= exempt_top + EPS:
                row.append("exempt")
            elif _inside(0.5 * (ua + ub), blocked[r]):
                row.append("bldg")
            else:
                row.append("o")
        kind.append(row)
    # open to above: an open cell with only open cells over it (and nothing
    # of the group above the zone - APP-152's sample: the podium garden
    # under the tower is PE)
    for c, (ua, ub) in enumerate(cols):
        sky = not _inside(0.5 * (ua + ub), over)
        for r in range(len(rows) - 1, -1, -1):
            if kind[r][c] == "o":
                kind[r][c] = "sky" if sky else "enc"
            elif kind[r][c] != "exempt":
                sky = False
    # open from bottom to top BETWEEN two buildings of the group (not a gap
    # that counts on plan): open, not IS. A column at the shadow's end, with
    # no building beyond it (the building there only <= 1/3 H, disregarded),
    # is the open space beside the setback: it stays sky, and joins the
    # setback's IS horizontally (Wilson, TKO report)
    has_b = [any(kind[r][c] == "bldg" for r in range(len(rows))) for c in range(len(cols))]
    first = next((c for c in range(len(cols)) if has_b[c]), None)
    last = next((c for c in range(len(cols) - 1, -1, -1) if has_b[c]), None)
    for c in range(len(cols)):
        if first is not None and first < c < last and not has_b[c]:
            for r in range(len(rows)):
                if kind[r][c] == "sky":
                    kind[r][c] = "open"
    return cols, kind


def _pe(cols, rows, kind):
    """Enclosed voids: PE where the clear height and width are >= PE_MIN."""
    nr, nc = len(rows), len(cols)
    col_w = [b - a for a, b in cols]
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
            tall = {}
            for r, c in comp:
                tall.setdefault(c, []).append(r)
            good = set()
            for c, rs in tall.items():
                rs.sort()
                best = run = rows[rs[0]][1] - rows[rs[0]][0]
                for a, b in zip(rs, rs[1:]):
                    run = run + rows[b][1] - rows[b][0] if b == a + 1 else rows[b][1] - rows[b][0]
                    best = max(best, run)
                if best >= PE_MIN - EPS:
                    good.add(c)
            ok = set()
            cs = sorted(good)
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


def zone_elevation(masses, ground, items, z0, z1, ax, req_p=None, exempt=0.0):
    """One zone on one plane, deformed.

    items: the near edge left to right (nearedge.py), metres:
      {"kind": "gap", "label", "s_m", "pass", "lo", "hi"}
      {"kind": "shadow", "label", "lo", "hi", "members": [[x, y] loops]}
    ax: the plane's direction (unit); z0, z1: the zone (relative to the
    ground); exempt: the Low zone's disregarded height (H / 3) or 0."""
    H = z1 - z0
    if H <= EPS or not items:
        return None
    rows = _rows(masses, ground, z0, z1, exempt)
    top = max([v[2] - ground for m in masses for v in (m.get("verts") or [])] or [z1])
    ex_top = z0 + exempt if exempt else None
    # lay the strip out: each piece is (x0, x1, columns [(w_true, w_drawn, kinds bottom->top)])
    pieces = []
    x = 0.0
    out_items = []
    for it in items:
        if it["kind"] == "gap":
            w = max(float(it["s_m"] or 0.0), 0.0)
            # a gap that counts is IS; one that does not reach its S but is
            # >= 3 m wide is a permeable element (PE); narrower, not counted
            k = "gis" if it["pass"] else "gpe" if w >= PE_MIN - EPS else "gnis"
            if it.get("omitted"):
                k = "omit"           # an air corridor overlapping the one kept: blocked, no IS
            # an opening found above a lower building: blocked below the
            # height it is clear from
            zf = it.get("z_from")
            col = [("exempt" if ex_top is not None and zb <= ex_top + EPS else
                    "bldg" if zf is not None and zb <= zf + EPS else k) for za, zb in rows]
            pieces.append((x, x + w, [(w, w, col)], it))
        else:
            w = it["hi"] - it["lo"]
            if it.get("members"):
                cols, kind = _group_cells(masses, ground, ax, rows, z1, top, it["members"], ex_top, it.get("clip"))
                _pe(cols, rows, kind)
                span = (cols[-1][1] - cols[0][0]) if cols else 0.0
                f = w / span if span > EPS else 0.0
                cc = [(b - a, (b - a) * f, [kind[r][c] for r in range(len(rows))]) for c, (a, b) in enumerate(cols)]
                # each building's mark (B1, B2 ...) over the middle of its own
                # columns: its plan projected, placed as the silhouette is
                marks = []
                for lab, ls in it.get("names") or []:
                    us = [p[0] * ax[0] + p[1] * ax[1] for l in ls for p in l]
                    if us and cols:
                        lo_, hi_ = max(min(us), cols[0][0]), min(max(us), cols[-1][1])
                        if hi_ > lo_:
                            marks.append({"label": lab, "x": round(x + ((lo_ + hi_) / 2.0 - cols[0][0]) * f, 3)})
                it = dict(it, marks=marks)
            else:
                cc = [(w, w, [("exempt" if ex_top is not None and zb <= ex_top + EPS else "open") for za, zb in rows])]
            pieces.append((x, x + w, cc, it))
        out_items.append(dict({k: v for k, v in it.items() if k not in ("members", "names")}, x0=round(x, 3), x1=round(x + w, 3),
                              w_m=round(w, 3), plan_w_m=round(it["hi"] - it["lo"], 3)))
        x += w
    Wd = x
    if Wd <= EPS:
        return None
    # flatten into columns across the strip
    flat = []      # [x0, x1, w_true, kinds, piece index]
    for pi, (x0, x1, cc, it) in enumerate(pieces):
        cx = x0
        for wt, wd, kinds in cc:
            flat.append([cx, cx + wd, wt, list(kinds), pi])
            cx += wd
    # IS and PE are taken HORIZONTALLY (Wilson, report 4): row by row, a run
    # of open cells - gaps and open-to-above cells over the buildings beside
    # them - is IS where its true width reaches the requirement (the widest
    # of its gaps': S1 7.5 m, a corridor 15 m; 7.5 m with no gap). So a gap
    # short of its S is IS where it opens on to the sky over a lower
    # building beside it, and the rest of it stays PE (>= 3 m) or is not
    # counted.
    OPEN = ("sky", "gis", "gpe", "gnis")
    need = {}
    for pi, (x0, x1, cc, it) in enumerate(pieces):
        if it["kind"] == "gap":
            need[pi] = float(it.get("need_m") or MIN_S)
    n = len(flat)
    joins = {}
    for r in range(len(rows)):
        c = 0
        while c < n:
            if flat[c][3][r] not in OPEN:
                c += 1
                continue
            e = c
            while e + 1 < n and flat[e + 1][3][r] in OPEN:
                e += 1
            w = sum(flat[i][2] for i in range(c, e + 1))
            gaps = [flat[i][4] for i in range(c, e + 1) if flat[i][3][r] in ("gis", "gpe", "gnis")]
            req = max([need.get(g, MIN_S) for g in gaps] or [MIN_S])
            has_is = any(flat[i][3][r] == "gis" for i in range(c, e + 1))
            ok = w >= req - EPS or has_is
            for i in range(c, e + 1):
                k = flat[i][3][r]
                if k == "sky":
                    flat[i][3][r] = "skyis" if ok else "open"
                elif k == "gis":
                    flat[i][3][r] = "is"
                elif k in ("gpe", "gnis"):
                    if ok:
                        flat[i][3][r] = "is"
                        j = joins.setdefault(flat[i][4], {"run_m": 0.0, "h0": rows[r][0], "h1": rows[r][1], "need_m": req})
                        j["run_m"] = max(j["run_m"], w)
                        j["h0"], j["h1"] = min(j["h0"], rows[r][0]), max(j["h1"], rows[r][1])
                    else:
                        flat[i][3][r] = "pe" if k == "gpe" else "nis"
            c = e + 1
    for pi, j in joins.items():
        out_items[pi]["joined"] = {"run_m": round(j["run_m"], 3), "z_from": round(j["h0"] - z0, 3),
                                   "z_to": round(j["h1"] - z0, 3), "need_m": j["need_m"]}
    # areas (drawn widths) and the rectangles to draw
    area = {}
    rects = []
    for x0, x1, wt, kinds, pi in flat:
        r = 0
        while r < len(rows):
            k = kinds[r]
            e = r
            while e + 1 < len(rows) and kinds[e + 1] == k:
                e += 1
            h0, h1 = rows[r][0], rows[e][1]
            kk = {"o": "open", "enc": "open", "sky": "open"}.get(k, k)
            area[kk] = area.get(kk, 0.0) + (x1 - x0) * (h1 - h0)
            rects.append([x0, x1, h0, h1, kk])
            r = e + 1
    rects.sort(key=lambda q: (q[4], q[2], q[3], q[0]))
    joined = []
    for q in rects:
        p = joined[-1] if joined else None
        if p and p[4] == q[4] and abs(p[2] - q[2]) < EPS and abs(p[3] - q[3]) < EPS and abs(p[1] - q[0]) < 1e-6:
            p[1] = q[1]
        else:
            joined.append(list(q))
    zone_area = Wd * H
    is_area = area.get("is", 0.0) + area.get("skyis", 0.0)
    pe_area = area.get("pe", 0.0)
    pe_cap = (req_p / 100.0 / 3.0) * zone_area if req_p else None
    pe_used = pe_area if pe_cap is None else min(pe_area, pe_cap)
    p_is = 100.0 * is_area / zone_area
    p_pe = 100.0 * pe_used / zone_area
    names = {"skyis": "sky"}
    parts = [{"w_m": round(q[1] - q[0], 2), "h_m": round(q[3] - q[2], 2), "area_m2": round((q[1] - q[0]) * (q[3] - q[2]), 2),
              "kind": names.get(q[4], q[4])} for q in joined if q[4] in ("is", "skyis", "pe")]
    parts.sort(key=lambda p: -p["area_m2"])
    return {
        "W_m": round(Wd, 3), "H_m": round(H, 3), "z0": z0, "z1": z1,
        "exempt_m": round(exempt, 3), "zone_area_m2": round(zone_area, 2),
        "is_area_m2": round(is_area, 2), "pe_area_m2": round(pe_area, 2),
        "pe_cap_m2": None if pe_cap is None else round(pe_cap, 2), "pe_used_m2": round(pe_used, 2),
        "P_is": round(p_is, 2), "P_pe": round(p_pe, 2), "P": round(p_is + p_pe, 2),
        "is_min_ok": None if not req_p else p_is >= req_p * 2.0 / 3.0 - 1e-9,
        "items": out_items, "parts": parts,
        "rects": [[round(q[0], 3), round(q[1], 3), round(q[2] - z0, 3), round(q[3] - z0, 3), names.get(q[4], q[4])] for q in joined],
    }
