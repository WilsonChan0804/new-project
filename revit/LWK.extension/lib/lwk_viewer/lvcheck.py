# -*- coding: utf-8 -*-
"""Lighting and ventilation check of a typical floor, the way the LWK window
calculation sheet does it (20261002_Window_calculation): for each room of the
UFA scheme, the required lighting area (room x 1/10) and openable area
(room x 1/16) against what its windows and curtain-wall panels give.

  - the room areas are the Areas of the UFA scheme (what the UFA / UFS table
    on the sheets is made from);
  - each window, balcony door and curtain panel is given to the room it
    serves by its position on the plan (a point just inside it, tested on the
    area's boundary);
  - lighting: the glass measured from the model (the Revit geometry with a
    transparent material, so the frame - and an opaque curtain-wall upstand
    or spandrel - is left out) decides OK / NOT OK; width x height x 70 %
    ("BD standard", as the sheet) is kept beside it only as a secondary,
    reference figure. A family with its own GBP_Glazing_*/GBP_Openable_*
    dimensions uses those exact figures instead of the ratio;
  - openable: Revit does not know which panel opens, so each window / panel
    TYPE is classified once (fixed, casement, sliding ...) and its openable
    fraction kept in a settings file for the AP to confirm. A type not yet
    confirmed shows the room as "needs data", never as a pass;
  - a bathroom / kitchen with no window of its own, or one that isn't enough,
    is counted together with whichever room its door actually leads to (not
    assumed to always be the flat's living room).

The ratios, the 70 % and the openable fractions are the practice of the
sheet, not read from the regulation: they are in DEFAULT_RULES and the
settings file, for the AP to confirm against B(P)R 30 and APP-130.

Everything that needs Revit is imported inside the function that uses it, so
the rest (and its tests) run without Revit.
"""

__version__ = "2026-12-02"

import io
import json
import os
import re

FT_MM = 304.8
SQFT_M2 = 0.09290304

DEFAULT_RULES = {
    "glazing_factor": 0.7,          # nominal width x height x this = glazing area ("BD standard"), when
                                     # a window has no GBP_Glazing_Width/Height of its own to use instead
    "uses": {                       # use: [lighting ratio, openable ratio]
        "LIV": [0.1, 0.0625],       # living / dining
        "BED": [0.1, 0.0625],       # bedrooms, studies
        "KIT": [0.1, 0.0625],       # kitchens (enclosed - has its own window, never merges)
        "OKIT": [0.1, 0.0625],      # open-plan kitchens (no wall/door of its own - always merges)
        "UTI": [0.1, 0.0625],       # utility rooms (no window of their own - merge into the kitchen)
        "BATH": [0.1, 0.1],         # bathrooms and lavatories (the sheet: 1/10 of the bath)
        "STO": [0.1, 0.0625],       # stores
    },
    # a room of these uses whose own window is missing or not enough is counted together with
    # whichever room its door leads to ("cum. BATH", "cum. OPEN KIT" on the sheet) - found from the
    # model's own doors, not assumed to be the flat's living room. An enclosed kitchen (plain "KIT")
    # is deliberately NOT here: it always has its own window and must always stand on its own, even
    # when that window is not enough - only an open-plan kitchen (no enclosure of its own) merges.
    "merge_if_insufficient": ["BATH", "OKIT", "UTI"],
    # a room of a given use, when it has more than one adjacent candidate to merge into, prefers
    # whichever one has one of these uses over the others (a utility room relies specifically on
    # the kitchen, not on whichever room its door happens to lead to)
    "merge_prefer": {"UTI": ["KIT"]},
    # the flat: the area number up to its last "-" (A1-3 -> A1); or "param:<name>"
    "flat_from": "number_prefix",
    "probe_mm": [200, 500, 900],     # how far inside a window the room is looked for
    # a single opening's own glazing figure above this (m2) cannot be a real domestic
    # window - flag the room instead of trusting it (OK or NOT OK) on a bad reading
    "implausible_light_m2": 15.0,
    # Rooms mode: the yes/no parameters that mark a room as one the check applies to (either one),
    # and the parameters that say which flat and which block a room belongs to
    "room_flags": ["UFA_Y/N", "UFS_Y/N"],
    "flat_param": "BUD-GBP-Common-Premises_ID",
    "block_param": "BUD-GBP-Common-Premises_Location",
    # a wide panel is looked at every sample_step_mm across its width: a curtain wall
    # that runs past more than one room gives each room its share
    "sample_step_mm": 300, "max_samples": 12,
}

# words in an area's name -> its use. First match wins; "BAL" and the like are no room.
_USE_WORDS = [
    # no leading \b on BATH itself: a master bathroom is often named with no separator
    # ("MBATH"), which \bBATH alone would never match (M is a word character, so there is
    # no word boundary between it and B)
    ("BATH", r"BATH|\bBTH\b|\bWC\b|\bLAV|\bTOILET|\bMVAL|POWDER|\bPD\b"),
    ("UTI", r"\bUTI"),
    # open-plan kitchen (no enclosure/door of its own) checked before the plain "KIT" an
    # enclosed kitchen uses, since "O.KIT" also contains "KIT"
    ("OKIT", r"\bO\.?\s*KIT|\bOPEN\s*KIT"),
    ("KIT", r"\bKIT"),
    ("LIV", r"\bLIV|\bDIN|\bLIVING"),
    ("BED", r"\bMBR\b|\bBR\d*\b|\bBED|\bSTUDY"),
    ("STO", r"\bSTO\b|\bSTORE"),
]


def use_of(name):
    t = (name or "").upper()
    for use, pat in _USE_WORDS:
        if re.search(pat, t):
            return use
    return None


def flat_of(number, how="number_prefix"):
    n = (number or "").strip()
    if how == "number_prefix" and "-" in n:
        return n.rsplit("-", 1)[0]
    return n or "?"


# --- operation of a window / panel type -------------------------------------

OPERATIONS = [
    # label, openable fraction of the glazing area
    ("Fixed", 0.0),
    ("Casement / top hung / projecting (opens fully)", 1.0),
    ("Sliding (one of two leaves)", 0.5),
    ("Folding / bi-fold (opens fully)", 1.0),
]

_GUESS = [
    (r"FIXED|FIX\b|STATIC|NON.?OPEN", "Fixed", 0.0),
    (r"SLID", "Sliding (one of two leaves)", 0.5),
    (r"FOLD", "Folding / bi-fold (opens fully)", 1.0),
    (r"CASEMENT|TOP.?HUNG|AWNING|PROJECT|PIVOT|TILT|OPENABLE|VENT|WINDOW PANEL", "Casement / top hung / projecting (opens fully)", 1.0),
]


def guess_operation(key):
    """(operation, fraction) from the type's name - a guess, to be confirmed."""
    t = (key or "").upper()
    for pat, op, fr in _GUESS:
        if re.search(pat, t):
            return op, fr
    return None, None


def types_path():
    return os.path.join(os.environ.get("APPDATA", "."), "LWK", "lv_types.json")


def load_types(path=None):
    path = path or types_path()
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_types(types, path=None):
    path = path or types_path()
    folder = os.path.dirname(path)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder)
    tmp = path + ".part"
    txt = json.dumps(types, ensure_ascii=True, indent=1, sort_keys=True)
    with io.open(tmp, "w", encoding="utf-8") as f:
        f.write(txt if isinstance(txt, type(u"")) else txt.decode("ascii"))
    if os.path.exists(path):
        os.remove(path)
    os.rename(tmp, path)


def excludes_path():
    return os.path.join(os.environ.get("APPDATA", "."), "LWK", "lv_excludes.json")


def load_excludes(path=None):
    """Window / door / panel TYPES (family : type name, the same "key" the type
    table uses) left out of the check by hand - a balcony grille or a service
    door that reads as a window or glazed door to the check but is not one, the
    AP's own judgement rather than something geometry or a material can tell on
    its own. By type, not by individual element: a project can have thousands
    of elements but only a handful of distinct families/types, and a type like
    a balcony's grille door is normally used the same way everywhere it occurs.
    Works across linked models and does not need write access to the element
    itself (the LWK_LV_Exclude parameter, checked in collect_items/collect_doors,
    is the other way to do this, instance by instance, when the element's own
    model can be edited). -> set(key, ...)"""
    path = path or excludes_path()
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        return set(d) if isinstance(d, list) else set()
    except Exception:
        return set()


def save_excludes(excludes, path=None):
    path = path or excludes_path()
    folder = os.path.dirname(path)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder)
    tmp = path + ".part"
    txt = json.dumps(sorted(excludes), ensure_ascii=True, indent=1)
    with io.open(tmp, "w", encoding="utf-8") as f:
        f.write(txt if isinstance(txt, type(u"")) else txt.decode("ascii"))
    if os.path.exists(path):
        os.remove(path)
    os.rename(tmp, path)


def type_info(key, types):
    """The operation of a type: what the AP confirmed, else a guess from its
    name, else nothing. -> dict(operation, fraction, confirmed)"""
    t = types.get(key)
    if t and t.get("fraction") is not None:
        return {"operation": t.get("operation", ""), "fraction": float(t["fraction"]), "confirmed": bool(t.get("confirmed"))}
    op, fr = guess_operation(key)
    if fr is None:
        return {"operation": "", "fraction": None, "confirmed": False}
    return {"operation": op, "fraction": fr, "confirmed": False}


# --- where an element is on the plan ----------------------------------------

def point_in_loops(x, y, loops):
    """Even-odd test against the boundary loops of an area (holes count)."""
    inside = False
    for loop in loops:
        n = len(loop)
        j = n - 1
        for i in range(n):
            xi, yi = loop[i]
            xj, yj = loop[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / float(yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def _bbox(loops):
    xs = [p[0] for l in loops for p in l]
    ys = [p[1] for l in loops for p in l]
    return (min(xs), min(ys), max(xs), max(ys))


def area_at(x, y, areas):
    for a in areas:
        b = a.get("bbox")
        if b is None:
            b = a["bbox"] = _bbox(a["loops"])
        if x < b[0] or x > b[2] or y < b[1] or y > b[3]:
            continue
        if point_in_loops(x, y, a["loops"]):
            return a
    return None


def _k(a):
    """What tells one room from another (ids repeat between a model and its links)."""
    return a.get("key") or a.get("uid") or a["id"]


def _level_rooms(areas, z):
    elevs = sorted(set(a["level_mm"] for a in areas))
    lv = None
    for e in elevs:
        if e <= z + 300:
            lv = e
    return [a for a in areas if a["level_mm"] == lv] if lv is not None else []


def _serve_at(x, y, nx, ny, here, probe_mm):
    """The room with a use just inside the point on one side or the other of
    the element. -> (area or None, note). A room on both sides (an internal
    door) or on neither (a balcony only) is no window of a room."""
    found = []
    for sign in (1, -1):
        hit = None
        for d in probe_mm:
            hit = area_at(x + sign * nx * d, y + sign * ny * d, here)
            if hit:
                break
        if hit and use_of(hit["name"]):
            found.append(hit)
    ids = set(_k(a) for a in found)
    if len(ids) == 1:
        return found[0], ""
    if len(ids) > 1:
        return None, "between two rooms"
    return None, "no room beside it"


def _rooms_each_side(x, y, nx, ny, here, probe_mm):
    """Unlike _serve_at (which drops a point with a room on each side as
    "between two rooms"), this is for exactly that case: a door between two
    rooms. -> (room_on_plus_side, room_on_minus_side), either may be None."""
    sides = []
    for sign in (1, -1):
        hit = None
        for d in probe_mm:
            hit = area_at(x + sign * nx * d, y + sign * ny * d, here)
            if hit:
                break
        sides.append(hit if (hit and use_of(hit["name"])) else None)
    return sides[0], sides[1]


def door_adjacent_rooms(doors, areas, probe_mm):
    """key -> set(key, ...) of the rooms found immediately either side of a door,
    from every door given (an interior door between two UFA rooms makes an edge
    both ways; a door with no room, or the same room, on one side adds nothing)."""
    adj = {}
    for dr in doors:
        x, y, z = dr["pos"]
        nx, ny = dr["n"]
        here = _level_rooms(areas, z)
        a, b = _rooms_each_side(x, y, nx, ny, here, probe_mm)
        if a is None or b is None:
            continue
        ka, kb = _k(a), _k(b)
        if ka == kb:
            continue
        adj.setdefault(ka, set()).add(kb)
        adj.setdefault(kb, set()).add(ka)
    return adj


def boundary_adjacent_rooms(area, areas, probe_mm, step_mm=600.0):
    """Rooms directly touching `area`'s own boundary - an open-plan kitchen
    with no door at all to its living room, only a room-separation line, so
    there is no door for door_adjacent_rooms to find. Walks area's own loops,
    sampling every step_mm along each edge and probing both perpendicular
    directions (one of the two is simply back into `area` itself, from
    whichever way the loop winds - harmless, just not a match). -> set(key,
    ...) of neighbouring rooms, computed lazily for just this one room (not a
    whole-floor adjacency graph) since it is only needed as a fallback when a
    room has no door-connected neighbour."""
    here = _level_rooms(areas, area["level_mm"])
    ak = _k(area)
    found = set()
    for loop in area["loops"]:
        n = len(loop)
        for i in range(n):
            x1, y1 = loop[i]
            x2, y2 = loop[(i + 1) % n]
            length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
            if length < 1.0:
                continue
            dx, dy = (x2 - x1) / length, (y2 - y1) / length
            perp = (-dy, dx)
            steps = max(1, int(round(length / step_mm)))
            for s in range(steps):
                t = (s + 0.5) / steps
                mx, my = x1 + dx * length * t, y1 + dy * length * t
                for sign in (1, -1):
                    hit = None
                    for d in probe_mm:
                        hit = area_at(mx + sign * perp[0] * d, my + sign * perp[1] * d, here)
                        if hit:
                            break
                    if hit is not None and _k(hit) != ak and use_of(hit["name"]):
                        found.add(_k(hit))
    return found


def serving_room(item, areas, probe_mm):
    """The room an element serves (one point: its centre). -> (area or None, note)."""
    x, y, z = item["pos"]
    nx, ny = item["n"]
    return _serve_at(x, y, nx, ny, _level_rooms(areas, z), probe_mm)


def serving_rooms(item, areas, probe_mm, step_mm=300, max_samples=12):
    """The rooms an element serves and the share of it each gets. A panel wider
    than a step is looked at across its width, so a curtain wall running past two
    rooms is split between them. -> ([(area, share)], note); the shares add to
    less than 1 where part of it faces no room."""
    x, y, z = item["pos"]
    nx, ny = item["n"]
    here = _level_rooms(areas, z)
    w = item.get("w_mm") or 0
    n = 1 if w <= step_mm * 1.5 else min(int(max_samples), max(2, int(round(w / float(step_mm)))))
    tx, ty = -ny, nx
    counts, area_of, whys = {}, {}, {}
    for i in range(n):
        off = 0.0 if n == 1 else ((i + 0.5) / n - 0.5) * w
        a, why = _serve_at(x + tx * off, y + ty * off, nx, ny, here, probe_mm)
        if a is None:
            whys[why] = whys.get(why, 0) + 1
        else:
            counts[_k(a)] = counts.get(_k(a), 0) + 1
            area_of[_k(a)] = a
    if not counts:
        return [], (sorted(whys.items(), key=lambda kv: -kv[1])[0][0] if whys else "no room beside it")
    note = "only part of it faces a room" if sum(counts.values()) < n else ""
    return [(area_of[k], c / float(n)) for k, c in sorted(counts.items())], note


# --- the table ---------------------------------------------------------------

def _r3(v):
    return None if v is None else round(v + 1e-9, 3)


def build(areas, items, types, rules=None, doors=None):
    """Rooms with what their windows give. items: elements with pos, n, key,
    mark, cat, w_mm, h_mm, glass_m2 (and, optionally, glaze_m2_exact /
    open_m2_exact from a family's own GBP_Glazing_*/GBP_Openable_* dimensions).
    doors: elements with pos, n (any OST_Doors instance, glazed or not), used
    only to find which room a windowless/insufficient bathroom or kitchen
    should be counted with. -> (rows, unmatched, type_counts)"""
    rules = rules or DEFAULT_RULES
    gf = float(rules.get("glazing_factor", 0.7))
    uses = rules.get("uses", {})
    probe = rules.get("probe_mm", [200, 500, 900])

    rooms = {}
    for a in areas:
        u = use_of(a["name"])
        if not u or u not in uses:
            continue
        rooms[_k(a)] = {
            "_key": _k(a),
            "flat": a.get("flat") or flat_of(a["number"], rules.get("flat_from", "number_prefix")),
            "block": a.get("block", ""),
            "number": a["number"], "name": a["name"], "use": u, "level": a.get("level", ""), "level_mm": a.get("level_mm", 0.0),
            "area_m2": a["area_m2"], "id": a["id"], "uid": a.get("uid", ""),
            "req_light": a["area_m2"] * uses[u][0], "req_open": a["area_m2"] * uses[u][1],
            "windows": [], "merged": [], "notes": [],
        }

    unmatched, type_counts = [], {}
    seen_items = set()    # (source, uid): the same element must never be counted twice, however
                           # it reached this list (a duplicated link placement, say) - belt and
                           # braces alongside collect_items/collect_doors' own dedup, and what
                           # actually makes this testable without a live Revit model at all
    for it in items:
        dedup_key = (it.get("source", ""), it.get("uid", "") or it.get("id"))
        if dedup_key in seen_items:
            continue
        seen_items.add(dedup_key)
        tc = type_counts.setdefault(it["key"], {"cat": it["cat"], "count": 0})
        tc["count"] += 1
        hits, why = serving_rooms(it, areas, probe, rules.get("sample_step_mm", 300), rules.get("max_samples", 12))
        hits = [(a, sh) for a, sh in hits if _k(a) in rooms]
        if not hits:
            unmatched.append({"id": it["id"], "uid": it.get("uid", ""), "key": it["key"], "why": why or "no room beside it",
                              "source": it.get("source", "")})
            continue
        info = type_info(it["key"], types)
        frac = it.get("fraction_override")
        confirmed = info["confirmed"]
        if frac is None:
            frac = info["fraction"]
        else:
            confirmed = True
        glaze_exact = it.get("glaze_m2_exact")
        if glaze_exact is not None:
            nominal_light = glaze_exact
        elif it.get("w_mm") and it.get("h_mm"):
            nominal_light = (it["w_mm"] / 1000.0) * (it["h_mm"] / 1000.0) * gf
        else:
            nominal_light = None
        open_exact = it.get("open_m2_exact")
        if open_exact is not None:
            nominal_open = open_exact
        elif nominal_light is not None and frac is not None:
            nominal_open = nominal_light * frac
        else:
            nominal_open = None
        for a, share in hits:
            bd = nominal_light * share if nominal_light is not None else None
            op_bd = nominal_open * share if nominal_open is not None else None
            meas = it.get("glass_m2") * share if it.get("glass_m2") is not None else None
            rooms[_k(a)]["windows"].append({
                "id": it["id"], "uid": it.get("uid", ""), "key": it["key"], "mark": it.get("mark", ""), "cat": it["cat"],
                "w_mm": it.get("w_mm"), "h_mm": it.get("h_mm"), "share": round(share, 3), "source": it.get("source", ""),
                "light_bd": bd, "light_meas": meas,
                "open_bd": op_bd,
                "open_meas": (meas * frac) if (meas is not None and frac is not None) else None,
                "operation": info["operation"], "fraction": frac, "confirmed": confirmed,
                "exact_dims": glaze_exact is not None or open_exact is not None,
                # the family's own openable sub-size, when it has one (e.g. a "2-panels" family
                # whose GBP_Openable_Width/Height cover only one of its two leaves) - so the diagram
                # can draw the real openable portion as its own rectangle within the glazing, rather
                # than colouring the whole panel as if all of it opened
                "open_w_mm": it.get("open_w_mm") if open_exact is not None else None,
                "open_h_mm": it.get("open_h_mm") if open_exact is not None else None,
                # the real left-edge offset of that openable leaf within the glazing, when the
                # family gives one (an asymmetric "2-panels" unit) - None falls back to centring
                "open_left_mm": it.get("open_left_mm") if open_exact is not None else None,
            })

    # a bath / kitchen whose own window is missing or not enough goes with whichever
    # room its door leads to (same flat, same floor) - found from the model's doors,
    # not assumed to be the flat's living room
    fk = lambda r: (r["block"], r["level"], r["flat"])
    adj = door_adjacent_rooms(doors, areas, probe) if doors else {}
    area_by_key = dict((_k(a), a) for a in areas)
    for r in list(rooms.values()):
        if r["use"] not in rules.get("merge_if_insufficient", []):
            continue
        own = _own_provision(r, rules)
        if own["status"] not in ("NOT OK", "NO WINDOW"):
            continue    # OK needs no compensation; NEEDS DATA is a data problem, not left to guess a relay for
        neighbours = adj.get(r["_key"], set())
        if not neighbours and r["_key"] in area_by_key:
            # no door at all (an open-plan kitchen, say) - fall back to whatever room its own
            # boundary directly touches (a room-separation line, not a wall)
            neighbours = boundary_adjacent_rooms(area_by_key[r["_key"]], areas, probe)
        candidates = [rooms[k] for k in neighbours if k in rooms and k != r["_key"] and fk(rooms[k]) == fk(r)]
        prefer = rules.get("merge_prefer", {}).get(r["use"])
        if prefer and len(candidates) > 1:
            preferred = [c for c in candidates if c["use"] in prefer]
            if len(preferred) == 1:
                candidates = preferred
        if len(candidates) == 1:
            host = candidates[0]
            host["merged"].append(r)
            r["merged_into"] = host["number"]
        elif len(candidates) > 1:
            r["merge_ambiguous"] = sorted(c["number"] for c in candidates)
        else:
            r["merge_unavailable"] = True

    rows = []
    for r in sorted(rooms.values(), key=lambda q: (q["block"], q["level"], q["flat"], q["number"])):
        if r.get("merged_into"):
            rows.append(_row(r, rules, merged=True))
            continue
        rows.append(_row(r, rules))
    return rows, unmatched, type_counts


def _sum(ws, k):
    vals = [w[k] for w in ws]
    if any(v is None for v in vals):
        return None
    return sum(vals)


def _own_provision(r, rules, req_l=None, req_o=None):
    """This room's own windows only, against its own requirement (ignoring any
    merge): the nominal (secondary) and measured (primary) figures, notes, and
    a status of OK / NOT OK / NO WINDOW / NEEDS DATA. Measured glass decides
    OK / NOT OK when a window's glass could be measured; nominal width x
    height x ratio (or a family's own GBP_Glazing_*/GBP_Openable_* figure) is
    the fallback for a window whose glass could not be measured, and is
    always reported too, as the sheet's traditional reference column."""
    ws = r["windows"]
    req_l = r["req_light"] if req_l is None else req_l
    req_o = r["req_open"] if req_o is None else req_o
    pl_bd, po_bd = _sum(ws, "light_bd"), _sum(ws, "open_bd")
    pl_m, po_m = _sum(ws, "light_meas"), _sum(ws, "open_meas")
    notes = []
    need = False
    cap = rules.get("implausible_light_m2", 15.0)
    too_big = [w for w in ws if (w.get("light_bd") or 0) > cap or (w.get("light_meas") or 0) > cap]
    if too_big:
        need = True
        notes.append("%s looks too large for one window/panel (%.1f m2) - check its Width/Height parameters in Revit"
                     % (too_big[0].get("mark") or too_big[0]["key"], max(too_big[0].get("light_bd") or 0, too_big[0].get("light_meas") or 0)))
    if any(w.get("exact_dims") for w in ws):
        notes.append("uses the family's own GBP_Glazing_*/GBP_Openable_* dimensions where available")
    if not ws:
        status, need = "NO WINDOW", False
        notes.append("no window or panel found for this room")
    else:
        if any(w.get("share", 1) < 1 for w in ws):
            notes.append("a panel runs past this room: its share is counted (see Windows / panels)")
        if any(w["fraction"] is None for w in ws):
            need = True
            notes.append("a window type has no openable fraction yet")
        elif any(not w["confirmed"] for w in ws):
            need = True
            notes.append("openable fraction of a type not yet confirmed")
        primary_l = pl_m if pl_m is not None else pl_bd
        primary_o = po_m if po_m is not None else po_bd
        if primary_l is None or primary_o is None:
            need = True
        ok_l = primary_l is not None and primary_l + 1e-9 >= req_l
        ok_o = primary_o is not None and primary_o + 1e-9 >= req_o
        if need:
            status = "NEEDS DATA"
        else:
            status = "OK" if (ok_l and ok_o) else "NOT OK"
        if pl_m is not None and pl_bd is not None and abs(pl_m - pl_bd) > 0.05 * max(pl_bd, 0.001):
            notes.append("measured glass %.3f m2 differs from width x height x %d%% (%.3f m2)" % (pl_m, round(rules.get("glazing_factor", 0.7) * 100), pl_bd))
    return {"pl_bd": pl_bd, "po_bd": po_bd, "pl_m": pl_m, "po_m": po_m, "status": status, "notes": notes}


def _row(r, rules, merged=False):
    group = [r] + r["merged"]
    req_l = sum(g["req_light"] for g in group)
    req_o = sum(g["req_open"] for g in group)
    own = _own_provision(r, rules, req_l, req_o)
    pl_bd, po_bd, pl_m, po_m, status, notes = own["pl_bd"], own["po_bd"], own["pl_m"], own["po_m"], own["status"], own["notes"]
    if merged:
        status = "WITH " + r["merged_into"]
        pl_bd = po_bd = pl_m = po_m = None
        req_l = req_o = None    # already counted into the host room's own requirement - not this row's to show again
    elif r.get("merge_ambiguous"):
        status = "NEEDS DATA"
        notes.append("more than one room beside its door could take this room's area (%s) - not merged, decide by hand"
                     % ", ".join(r["merge_ambiguous"]))
    elif r.get("merge_unavailable") and status in ("NOT OK", "NO WINDOW"):
        notes.append("no door- or boundary-connected room found to compensate into")
    return {
        "flat": r["flat"], "block": r.get("block", ""), "level": r["level"], "level_mm": r.get("level_mm", 0.0),
        "number": r["number"], "name": r["name"], "use": r["use"],
        "area_m2": _r3(r["area_m2"]),
        "with": [{"number": g["number"], "name": g["name"], "area_m2": _r3(g["area_m2"])} for g in r["merged"]],
        "req_light": _r3(req_l), "req_open": _r3(req_o),
        "prov_light_bd": _r3(pl_bd), "prov_open_bd": _r3(po_bd),
        "prov_light_meas": _r3(pl_m), "prov_open_meas": _r3(po_m),
        "status": status, "notes": notes, "uid": r["uid"], "id": r["id"],
        # the host room's own windows plus every merged room's own windows too - so a combined
        # room's CSV cell and its diagram both show everything that counts toward it, not just the
        # host's own share (the required/provided sums above are unaffected: they were computed
        # from r["windows"] alone, before this list is widened for display)
        "windows": [dict((k, (_r3(v) if isinstance(v, float) else v)) for k, v in w.items())
                   for w in (r["windows"] + [w for g in r["merged"] for w in g["windows"]])],
    }


# --- files -------------------------------------------------------------------

def _csv(v):
    if v is None:
        return u""
    s = v if isinstance(v, type(u"")) else (u"%s" % v)
    if isinstance(v, float):
        s = u"%.3f" % v
    if any(c in s for c in u',"\n'):
        s = u'"' + s.replace(u'"', u'""') + u'"'
    return s


def write_csv(path, rows):
    head = [u"Block", u"Flat", u"Level", u"Room", u"Name", u"Use", u"Area m2", u"Required lighting m2",
            u"Provided lighting m2 (measured glass)",
            u"Required openable m2", u"Provided openable m2 (measured glass)",
            u"Status", u"Windows / panels", u"Notes"]
    lines = [u",".join(_csv(h) for h in head)]
    for r in rows:
        ws = u"; ".join(u"%s%s x %s mm%s" % ((u"mark %s: " % w["mark"]) if w.get("mark") else u"%s: " % w["key"],
                                           int(w["w_mm"] or 0), int(w["h_mm"] or 0),
                                          (u" (%d%%)" % round(w.get("share", 1) * 100)) if w.get("share", 1) < 1 else u"") for w in r["windows"])
        name = r["name"]
        if r["with"]:
            name += u" + " + u" + ".join(w["name"] for w in r["with"])
        cells = [r.get("block", ""), r["flat"], r["level"], r["number"], name, r["use"], r["area_m2"], r["req_light"], r["prov_light_meas"],
                 r["req_open"], r["prov_open_meas"], r["status"], ws, u"; ".join(r["notes"])]
        lines.append(u",".join(_csv(c) for c in cells))
    with io.open(path, "w", encoding="utf-8-sig", newline=u"") as f:
        f.write(u"\r\n".join(lines) + u"\r\n")


def _json_default(o):
    """Anything json does not know by itself (a boxed .NET Int64 from IronPython
    prints as a Python long but its json module still rejects it) - plain int,
    else text."""
    try:
        return int(o)
    except Exception:
        return u"%s" % o


def write_json(path, rows, unmatched, type_counts):
    d = {"schema": "lwk.lv/1", "version": __version__, "rooms": rows, "unmatched": unmatched, "types": type_counts}
    txt = json.dumps(d, ensure_ascii=True, indent=1, default=_json_default)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(txt if isinstance(txt, type(u"")) else txt.decode("ascii"))


# --- reading Revit -----------------------------------------------------------

def area_scheme_names(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, AreaScheme
    return sorted(s.Name for s in FilteredElementCollector(doc).OfClass(AreaScheme))


def link_sources(doc, include_links=True):
    """The models to read: [(label, document, transform to this model or None)].
    This model first, then each loaded linked model (one entry per placed instance)."""
    out = [(doc.Title, doc, None)]
    if not include_links:
        return out
    from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
    for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        try:
            ld = inst.GetLinkDocument()
            if ld is None:
                continue
            out.append((u"%s (link)" % ld.Title, ld, inst.GetTotalTransform()))
        except Exception:
            continue
    return out


def _tp(tf, p):
    """A point in mm in this model's coordinates."""
    q = tf.OfPoint(p) if tf is not None else p
    return (q.X * FT_MM, q.Y * FT_MM, q.Z * FT_MM)


def _level_elevations(doc, include_links=True):
    """Every level's elevation (mm, host coordinates), this model's and every
    linked model's, sorted."""
    from Autodesk.Revit.DB import FilteredElementCollector, Level
    elevs = set()
    for label, d, tf in link_sources(doc, include_links):
        dz = (tf.Origin.Z * FT_MM) if tf is not None else 0.0
        for lv in FilteredElementCollector(d).OfClass(Level):
            elevs.add(round(lv.Elevation * FT_MM + dz, 0))
    return sorted(elevs)


def level_bands(doc, selected_mm, include_links=True):
    """For each chosen floor elevation (mm) the band [from, to) of heights that belong to it:
    up to the next level of this model or of any link."""
    elevs = _level_elevations(doc, include_links)
    bands = []
    for e in selected_mm:
        above = [x for x in elevs if x > e + 500]
        bands.append((e - 300.0, above[0] if above else e + 6000.0))
    return bands


def floor_to_floor_mm(doc, selected_mm, include_links=True):
    """For each chosen floor elevation (mm), the height (mm) up to the next
    level above it - for the elevation diagrams, which need the real
    floor-to-floor height, not level_bands' own margin-padded band. A level
    with nothing above it (the top floor) falls back to 3000mm."""
    elevs = _level_elevations(doc, include_links)
    out = []
    for e in selected_mm:
        above = [x for x in elevs if x > e + 500]
        out.append((above[0] - e) if above else 3000.0)
    return out


def _flag_state(el, names):
    """True / False from the yes-no parameters that mark a room for the check; None when the
    room has none of them."""
    seen = False
    for n in names:
        try:
            p = el.LookupParameter(n)
        except Exception:
            p = None
        if p is None:
            continue
        seen = True
        try:
            if p.HasValue and p.AsInteger() == 1:
                return True
        except Exception:
            pass
    return False if seen else None


def collect_rooms(doc, level_elevs=None, rules=None, include_links=True):
    """The placed Rooms to check, with their boundary loops in mm (in this model's
    coordinates, also for rooms of a linked model). A room is taken when one of the
    yes-no parameters in rules["room_flags"] is ticked; a project without those
    parameters gives every room and the names decide. -> (rooms, skipped) where
    skipped lists the names of ticked rooms that are no lighting / ventilation room."""
    from Autodesk.Revit.DB import (FilteredElementCollector, BuiltInCategory, BuiltInParameter,
                                   SpatialElementBoundaryOptions)
    from lwk_viewer.compat import id_int
    rules = rules or DEFAULT_RULES
    flags = rules.get("room_flags", [])
    opt = SpatialElementBoundaryOptions()
    out, skipped = [], {}
    for label, d, tf in link_sources(doc, include_links):
        dz = (tf.Origin.Z * FT_MM) if tf is not None else 0.0
        for r in FilteredElementCollector(d).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType():
            try:
                if r.Area is None or r.Area <= 0 or r.Location is None:
                    continue
                if _flag_state(r, flags) is False:
                    continue
                lvl = r.Level
                lev_mm = (lvl.Elevation * FT_MM + dz) if lvl is not None else 0.0
                if level_elevs and not any(abs(lev_mm - e) <= 150 for e in level_elevs):
                    continue
                name = ""
                try:
                    name = r.get_Parameter(BuiltInParameter.ROOM_NAME).AsString() or ""
                except Exception:
                    pass
                if not use_of(name):
                    skipped[name] = skipped.get(name, 0) + 1
                    continue
                loops = []
                for loop in r.GetBoundarySegments(opt) or []:
                    pts = []
                    for seg in loop:
                        for p in seg.GetCurve().Tessellate():
                            q = _tp(tf, p)[:2]
                            if not pts or pts[-1] != q:
                                pts.append(q)
                    if len(pts) > 1 and pts[0] == pts[-1]:
                        pts.pop()
                    if len(pts) >= 3:
                        loops.append(pts)
                if not loops:
                    continue
                out.append({"id": id_int(r.Id), "uid": r.UniqueId, "key": u"%s|%s" % (label, r.UniqueId),
                            "number": r.Number or "", "name": name, "source": label,
                            "area_m2": round(r.Area * SQFT_M2 + 1e-9, 3), "loops": loops,
                            "flat": _text_param(r, rules.get("flat_param", "")),
                            "block": _text_param(r, rules.get("block_param", "")),
                            "level": lvl.Name if lvl is not None else "", "level_mm": lev_mm})
            except Exception:
                continue
    return out, sorted(skipped.items())


def collect_areas(doc, scheme_name, level_names=None):
    """The placed areas of one scheme, each with its boundary loops in mm."""
    from Autodesk.Revit.DB import (FilteredElementCollector, BuiltInCategory, BuiltInParameter,
                                   SpatialElementBoundaryOptions)
    from lwk_viewer.compat import id_int
    opt = SpatialElementBoundaryOptions()
    out = []
    for a in FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Areas).WhereElementIsNotElementType():
        try:
            if a.Area is None or a.Area <= 0 or a.AreaScheme.Name != scheme_name:
                continue
            lvl = a.Level
            if level_names and (lvl is None or lvl.Name not in level_names):
                continue
            loops = []
            for loop in a.GetBoundarySegments(opt) or []:
                pts = []
                for seg in loop:
                    for p in seg.GetCurve().Tessellate():
                        q = (p.X * FT_MM, p.Y * FT_MM)
                        if not pts or pts[-1] != q:
                            pts.append(q)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts.pop()
                if len(pts) >= 3:
                    loops.append(pts)
            if not loops:
                continue
            name = ""
            try:
                name = a.get_Parameter(BuiltInParameter.ROOM_NAME).AsString() or ""
            except Exception:
                pass
            out.append({"id": id_int(a.Id), "uid": a.UniqueId, "number": a.Number or "", "name": name,
                        "area_m2": round(a.Area * SQFT_M2 + 1e-9, 3), "loops": loops,
                        "level": lvl.Name if lvl is not None else "",
                        "level_mm": (lvl.Elevation * FT_MM) if lvl is not None else 0.0})
        except Exception:
            continue
    return out


def _is_length_param(p):
    """True only for a genuine Length parameter (Revit stores its value in feet).
    A custom "Number" parameter of the same name stores the real mm value as
    entered, with no unit conversion - the same check units.py._spec() uses."""
    try:
        d = p.Definition
        try:
            tid = (d.GetDataType().TypeId or "").lower()      # Revit 2022+
            return ":length-" in tid or tid.endswith(":length")
        except Exception:
            pass
        return str(d.UnitType) == "UT_Length"                  # older Revit
    except Exception:
        return False


def _param_d(el, bips=(), names=()):
    """A length in mm: built-in ones first (always a true Length parameter, so
    always feet -> mm), then by name on the instance and on its type (a custom
    parameter there may be a plain Number already holding the mm value, not a
    Length - only convert when it truly is one)."""
    from Autodesk.Revit.DB import BuiltInParameter, StorageType
    holders = [el]
    try:
        t = el.Document.GetElement(el.GetTypeId())
        if t is not None:
            holders.append(t)
    except Exception:
        pass
    for h in holders:
        for b in bips:
            try:
                p = h.get_Parameter(getattr(BuiltInParameter, b))
                if p is not None and p.HasValue and p.StorageType == StorageType.Double and p.AsDouble() > 0:
                    return p.AsDouble() * FT_MM
            except Exception:
                pass
        for n in names:
            try:
                p = h.LookupParameter(n)
                if p is not None and p.HasValue and p.StorageType == StorageType.Double and p.AsDouble() > 0:
                    v = p.AsDouble()
                    return v * FT_MM if _is_length_param(p) else v
            except Exception:
                pass
    return None


def _norm_name(s):
    return u"".join(ch for ch in (s or u"").lower() if ch.isalnum())


def _param_d_like(el, keywords):
    """A length in mm, found by what a parameter's name CONTAINS rather than
    an exact match - a family author can name a parameter "GBP_Openable_Width",
    "GBP Openable Width", "GBP-OpenableWidth" ... and all of these should be
    found the same way, on the instance or on its type. keywords: every one
    of these (already lower-case, no spaces/underscores) must appear in the
    parameter's own name, normalised the same way, for it to match.

    One keyword-set at a time, scanning the element's own Parameters fresh
    each call - fine for a one-off lookup, but collect_items needs four of
    these (glazing/openable x width/height) on every window/door/panel, which
    on a project with thousands of them made four full parameter scans each,
    not one: see _gbp_dims_mm, which finds all four in a single pass."""
    found = _scan_params_like(el, (keywords,))
    return found[0]


def _scan_params_like(el, keyword_sets):
    """found[i] is the first value (mm) whose parameter name contains every
    keyword in keyword_sets[i], scanning the element's (and its type's) own
    Parameters exactly once regardless of how many keyword-sets are asked
    for - the whole reason this exists instead of calling _param_d_like once
    per set, which would re-scan from scratch each time."""
    found = [None] * len(keyword_sets)
    holders = [el]
    try:
        t = el.Document.GetElement(el.GetTypeId())
        if t is not None:
            holders.append(t)
    except Exception:
        pass
    remaining = set(range(len(keyword_sets)))
    for h in holders:
        if not remaining:
            break
        try:
            params = list(h.Parameters)
        except Exception:
            continue
        for p in params:
            if not remaining:
                break
            try:
                if not (p.HasValue and str(p.StorageType) == "Double" and p.AsDouble() > 0):
                    continue
                name = _norm_name(p.Definition.Name if p.Definition else u"")
            except Exception:
                continue
            for i in list(remaining):
                if all(kw in name for kw in keyword_sets[i]):
                    try:
                        v = p.AsDouble()
                        found[i] = v * FT_MM if _is_length_param(p) else v
                        remaining.discard(i)
                    except Exception:
                        pass
    return found


def _gbp_dims_mm(el):
    """(glaze_w, glaze_h, open_w, open_h, open_left) in mm, each None if the family has no
    matching parameter - one parameter scan for all five, see _scan_params_like. open_left is
    the real left-edge offset of the openable leaf within the glazing, for a family (a "2-panels"
    sliding door, say) whose two leaves are not the same width - read from a GBP_ parameter whose
    name contains "openable" and "offset", or "openable" and "left"; when the family has neither,
    the diagram falls back to centring the openable leaf within the glazing instead."""
    return tuple(_scan_params_like(el, (("glazing", "width"), ("glazing", "height"),
                                        ("openable", "width"), ("openable", "height"),
                                        ("openable", "offset"), ("openable", "left"))))


def _text_param(el, name):
    try:
        p = el.LookupParameter(name)
        if p is not None and p.HasValue:
            return (p.AsString() or p.AsValueString() or "").strip()
    except Exception:
        pass
    return ""


def _type_key(el, d, BuiltInParameter):
    """The type of an element, the same "key" the type table and the exclude
    list use: "family : type name". -> (key, mark)"""
    fam = tname = ""
    try:
        sym = el.Symbol
        fam, tname = sym.FamilyName, sym.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM).AsString()
    except Exception:
        try:
            t = d.GetElement(el.GetTypeId())
            fam, tname = t.FamilyName, t.Name
        except Exception:
            pass
    key = u"%s : %s" % (fam, tname)
    mark = ""
    try:
        t = d.GetElement(el.GetTypeId())
        mark = _text_param(t, "Type Mark")
    except Exception:
        pass
    return key, mark


def _facing(el, prefer_host=False):
    """The horizontal direction the element faces (out of the building for a
    window); from the instance, else from its host wall - or the other way
    round when prefer_host is set.

    A curtain panel's own FacingOrientation is not reliable the same way a
    window's is: an operable sub-type (an openable vent/sash panel, as
    opposed to a plain fixed panel) can report a direction tied to its own
    opening geometry rather than the façade's true outward normal, while the
    plain panels right beside it in the same wall fall back to the host
    wall's orientation and so all read one consistent direction. Mixing one
    inconsistent reading into a run throws off the along-wall projection
    every item in that run is placed by (collect_items passes
    prefer_host=True for Curtain panels for exactly this reason)."""
    order = ("host", "instance") if prefer_host else ("instance", "host")
    for source in order:
        if source == "instance":
            try:
                v = el.FacingOrientation
                if v is not None and (abs(v.X) + abs(v.Y)) > 1e-6:
                    m = (v.X * v.X + v.Y * v.Y) ** 0.5
                    return (v.X / m, v.Y / m)
            except Exception:
                pass
        else:
            try:
                v = el.Host.Orientation
                m = (v.X * v.X + v.Y * v.Y) ** 0.5
                if m > 1e-9:
                    return (v.X / m, v.Y / m)
            except Exception:
                pass
    return None


def _glass_m2(doc, el, n):
    """The glass of an element measured from its geometry: the faces turned
    to its facing direction whose material is transparent (or whose solid is
    in a Glass subcategory). One side of each pane is counted. None when no
    glass is found."""
    from Autodesk.Revit.DB import Options, ViewDetailLevel, GeometryInstance, Solid, PlanarFace
    opt = Options()
    opt.DetailLevel = ViewDetailLevel.Fine
    opt.ComputeReferences = False
    total = [0.0]
    found = [False]

    def glassy(face, solid):
        try:
            m = doc.GetElement(face.MaterialElementId)
            if m is not None:
                if (m.Transparency or 0) > 0 or re.search(r"glass|glaz", (m.Name or ""), re.I):
                    return True
        except Exception:
            pass
        try:
            gs = doc.GetElement(solid.GraphicsStyleId)
            if gs is not None and gs.GraphicsStyleCategory is not None and re.search(r"glass|glaz", gs.GraphicsStyleCategory.Name or "", re.I):
                return True
        except Exception:
            pass
        return False

    def walk(geo):
        for g in geo:
            if isinstance(g, GeometryInstance):
                walk(g.GetInstanceGeometry())
            elif isinstance(g, Solid):
                if g.Faces.Size == 0:
                    continue
                for f in g.Faces:
                    if not isinstance(f, PlanarFace):
                        continue
                    nv = f.FaceNormal
                    if nv.X * n[0] + nv.Y * n[1] > 0.9 and glassy(f, g):
                        total[0] += f.Area
                        found[0] = True
    try:
        geo = el.get_Geometry(opt)
        if geo is not None:
            walk(geo)
    except Exception:
        return None
    return round(total[0] * SQFT_M2, 3) if found[0] else None


def collect_items(doc, bands=None, measure=True, include_links=True):
    """Windows, glazed doors and curtain panels of this model and its linked models,
    where they are (in this model's coordinates), their size and measured glass.
    bands: the [from, to) heights (mm) of the floors being checked, or None."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, BuiltInParameter, XYZ
    from lwk_viewer.compat import id_int
    cats = [("Windows", BuiltInCategory.OST_Windows), ("Doors", BuiltInCategory.OST_Doors),
            ("Curtain panels", BuiltInCategory.OST_CurtainWallPanels)]
    out = []
    seen = set()    # (label, uid): a project with a link placed twice (or any other way the same
                     # element reaches this collector more than once) must still count it only once
    for label, d, tf in link_sources(doc, include_links):
        for cname, bic in cats:
            for el in FilteredElementCollector(d).OfCategory(bic).WhereElementIsNotElementType():
                try:
                    dedup_key = (label, el.UniqueId)
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)
                    if _text_param(el, "LWK_LV_Exclude").lower() in ("1", "yes", "true"):
                        continue
                    n_local = _facing(el, prefer_host=(cname == "Curtain panels"))
                    if n_local is None:
                        continue
                    bb = el.get_BoundingBox(None)
                    if bb is None:
                        continue
                    cx, cy = (bb.Min.X + bb.Max.X) / 2.0, (bb.Min.Y + bb.Max.Y) / 2.0
                    try:
                        p = el.Location.Point
                        pos = _tp(tf, XYZ(p.X, p.Y, (bb.Min.Z + bb.Max.Z) / 2.0))
                    except Exception:
                        pos = _tp(tf, XYZ(cx, cy, (bb.Min.Z + bb.Max.Z) / 2.0))
                    if bands and not any(lo <= pos[2] < hi for lo, hi in bands):
                        continue
                    bottom_mm = _tp(tf, XYZ(cx, cy, bb.Min.Z))[2]
                    top_mm = _tp(tf, XYZ(cx, cy, bb.Max.Z))[2]
                    n = n_local
                    if tf is not None:
                        v = tf.OfVector(XYZ(n_local[0], n_local[1], 0))
                        m = (v.X * v.X + v.Y * v.Y) ** 0.5
                        if m < 1e-9:
                            continue
                        n = (v.X / m, v.Y / m)
                    w = _param_d(el, ("FAMILY_WIDTH_PARAM", "CURTAIN_WALL_PANELS_WIDTH", "DOOR_WIDTH"),
                                 ("Width", "Rough Width"))
                    h = _param_d(el, ("FAMILY_HEIGHT_PARAM", "CURTAIN_WALL_PANELS_HEIGHT", "DOOR_HEIGHT"),
                                 ("Height", "Rough Height"))
                    # a family's own glazing/openable dimensions, where present, are the family
                    # author's real figures - more accurate than width x height x ratio. Found by what
                    # the parameter's name CONTAINS ("glazing"+"width", "openable"+"height", ...), not an
                    # exact name, since the underscores/spaces/capitalisation are not consistent family to
                    # family - all four in one parameter scan (_gbp_dims_mm), not four separate ones: with
                    # thousands of panels on a tower, four full scans each was the slow part of a run
                    gw, gh, ow, oh, o_off, o_left = _gbp_dims_mm(el)
                    open_left_mm = o_off if o_off is not None else o_left
                    glaze_exact = (gw / 1000.0) * (gh / 1000.0) if gw and gh else None
                    open_exact = (ow / 1000.0) * (oh / 1000.0) if ow and oh else None
                    if w is None or h is None:
                        # from the box: along the wall, and the height
                        ex = abs(bb.Max.X - bb.Min.X) * FT_MM
                        ey = abs(bb.Max.Y - bb.Min.Y) * FT_MM
                        along = abs(n_local[0]) * ey + abs(n_local[1]) * ex      # extent across the facing direction
                        w = w or along
                        h = h or abs(bb.Max.Z - bb.Min.Z) * FT_MM
                    key, mark = _type_key(el, d, BuiltInParameter)
                    glass = _glass_m2(d, el, n_local) if measure else None
                    if cname == "Doors" and glass is None and not re.search(r"glass|glaz|sliding|folding|balcony", key, re.I):
                        continue
                    ov = _text_param(el, "LWK_LV_Openable")
                    frac = None
                    if ov:
                        try:
                            frac = float(ov.replace("%", "")) / (100.0 if "%" in ov else 1.0)
                        except Exception:
                            frac = None
                    out.append({"id": id_int(el.Id), "uid": el.UniqueId, "cat": cname, "key": key, "mark": mark, "source": label,
                                "pos": pos, "n": n, "w_mm": w, "h_mm": h, "glass_m2": glass, "fraction_override": frac,
                                "glaze_m2_exact": glaze_exact, "open_m2_exact": open_exact,
                                "open_w_mm": ow, "open_h_mm": oh, "open_left_mm": open_left_mm,
                                "bottom_mm": bottom_mm, "top_mm": top_mm})
                except Exception:
                    continue
    return out


def collect_doors(doc, bands=None, include_links=True):
    """Every door (glazed or not) of this model and its linked models, with its
    position and facing - enough to tell which two rooms it connects, for the
    windowless/insufficient-bathroom compensation - and its type (key, mark),
    so a type can be left out of the check the same way as in collect_items.
    bands as in collect_items."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, BuiltInParameter, XYZ
    from lwk_viewer.compat import id_int
    out = []
    seen = set()    # (label, uid), same reason as collect_items
    for label, d, tf in link_sources(doc, include_links):
        for el in FilteredElementCollector(d).OfCategory(BuiltInCategory.OST_Doors).WhereElementIsNotElementType():
            try:
                dedup_key = (label, el.UniqueId)
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                n_local = _facing(el)
                if n_local is None:
                    continue
                bb = el.get_BoundingBox(None)
                if bb is None:
                    continue
                try:
                    p = el.Location.Point
                    pos = _tp(tf, XYZ(p.X, p.Y, (bb.Min.Z + bb.Max.Z) / 2.0))
                except Exception:
                    pos = _tp(tf, XYZ((bb.Min.X + bb.Max.X) / 2.0, (bb.Min.Y + bb.Max.Y) / 2.0, (bb.Min.Z + bb.Max.Z) / 2.0))
                if bands and not any(lo <= pos[2] < hi for lo, hi in bands):
                    continue
                n = n_local
                if tf is not None:
                    v = tf.OfVector(XYZ(n_local[0], n_local[1], 0))
                    m = (v.X * v.X + v.Y * v.Y) ** 0.5
                    if m < 1e-9:
                        continue
                    n = (v.X / m, v.Y / m)
                key, mark = _type_key(el, d, BuiltInParameter)
                out.append({"id": id_int(el.Id), "uid": el.UniqueId, "pos": pos, "n": n, "key": key, "mark": mark})
            except Exception:
                continue
    return out


def write_back(doc, rows, names=None):
    """Put each window's room into its parameters, where the project has them:
    LWK_LV_Room (number), LWK_LV_Room_Name, LWK_LV_Flat, LWK_LV_Glazing_m2,
    LWK_LV_Openable_m2 (the BD-basis figures, as the sheet). -> (elements written,
    parameter names missing)"""
    from Autodesk.Revit.DB import Transaction, StorageType
    names = names or {"room": "LWK_LV_Room", "room_name": "LWK_LV_Room_Name", "flat": "LWK_LV_Flat",
                      "glazing": "LWK_LV_Glazing_m2", "open": "LWK_LV_Openable_m2"}
    done, missing = 0, set()
    t = Transaction(doc, "LWK lighting and ventilation: room of each window")
    t.Start()
    try:
        for r in rows:
            for w in r["windows"]:
                el = doc.GetElement(w["uid"])
                if el is None:        # an element of a linked model cannot be written from here
                    continue
                vals = {names["room"]: r["number"], names["room_name"]: r["name"], names["flat"]: r["flat"],
                        names["glazing"]: w.get("light_bd"), names["open"]: w.get("open_bd")}
                for pn, v in vals.items():
                    p = el.LookupParameter(pn)
                    if p is None or p.IsReadOnly:
                        missing.add(pn)
                        continue
                    if v is None:
                        continue
                    if p.StorageType == StorageType.String:
                        p.Set(u"%s" % v)
                    elif p.StorageType == StorageType.Double:
                        p.Set(float(v) / SQFT_M2)
                done += 1
        t.Commit()
    except Exception:
        t.RollBack()
        raise
    return done, sorted(missing)
