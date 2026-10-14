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
  - lighting: width x height x 80 % ("BD standard", as the sheet) and, beside
    it, the glass measured from the model - the Revit geometry with a
    transparent material, so the frame is left out;
  - openable: Revit does not know which panel opens, so each window / panel
    TYPE is classified once (fixed, casement, sliding ...) and its openable
    fraction kept in a settings file for the AP to confirm. A type not yet
    confirmed shows the room as "needs data", never as a pass.

The ratios, the 80 % and the openable fractions are the practice of the
sheet, not read from the regulation: they are in DEFAULT_RULES and the
settings file, for the AP to confirm against B(P)R 30 and APP-130.

Everything that needs Revit is imported inside the function that uses it, so
the rest (and its tests) run without Revit.
"""

__version__ = "2026-10-15"

import io
import json
import os
import re

FT_MM = 304.8
SQFT_M2 = 0.09290304

DEFAULT_RULES = {
    "glazing_factor": 0.8,          # nominal width x height x this = glazing area ("BD standard")
    "uses": {                       # use: [lighting ratio, openable ratio]
        "LIV": [0.1, 0.0625],       # living / dining
        "BED": [0.1, 0.0625],       # bedrooms, studies
        "KIT": [0.1, 0.0625],       # kitchens
        "BATH": [0.1, 0.1],         # bathrooms and lavatories (the sheet: 1/10 of the bath)
        "STO": [0.1, 0.0625],       # stores
    },
    # a room of these uses with no window of its own is counted with the
    # living room of its flat ("cum. BATH", "cum. OPEN KIT" on the sheet)
    "merge_into_living": ["BATH", "KIT"],
    # the flat: the area number up to its last "-" (A1-3 -> A1); or "param:<name>"
    "flat_from": "number_prefix",
    "probe_mm": [200, 500, 900],     # how far inside a window the room is looked for
}

# words in an area's name -> its use. First match wins; "BAL" and the like are no room.
_USE_WORDS = [
    ("BATH", r"\bBATH|\bBTH\b|\bWC\b|\bLAV|\bTOILET|\bMVAL"),
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


def area_at(x, y, areas):
    for a in areas:
        if point_in_loops(x, y, a["loops"]):
            return a
    return None


def serving_room(item, areas, probe_mm):
    """The room an element serves: the area just inside it that has a use.
    -> (area or None, note). Looks a little way to both sides of the element;
    a room on both sides (an internal door) or on neither (a balcony only)
    is no window of a room."""
    x, y, z = item["pos"]
    nx, ny = item["n"]
    elevs = sorted(set(a["level_mm"] for a in areas))
    lv = None
    for e in elevs:
        if e <= z + 300:
            lv = e
    here = [a for a in areas if a["level_mm"] == lv] if lv is not None else []
    found = []
    for sign in (1, -1):
        hit = None
        for d in probe_mm:
            hit = area_at(x + sign * nx * d, y + sign * ny * d, here)
            if hit:
                break
        if hit and use_of(hit["name"]):
            found.append(hit)
    ids = set(a["id"] for a in found)
    if len(ids) == 1:
        return found[0], ""
    if len(ids) > 1:
        return None, "between two rooms"
    return None, "no room beside it"


# --- the table ---------------------------------------------------------------

def _r3(v):
    return None if v is None else round(v + 1e-9, 3)


def build(areas, items, types, rules=None):
    """Rooms with what their windows give. items: elements with pos, n, key,
    mark, cat, w_mm, h_mm, glass_m2. -> (rows, unmatched, type_counts)"""
    rules = rules or DEFAULT_RULES
    gf = float(rules.get("glazing_factor", 0.8))
    uses = rules.get("uses", {})
    probe = rules.get("probe_mm", [200, 500, 900])

    rooms = {}
    for a in areas:
        u = use_of(a["name"])
        if not u or u not in uses:
            continue
        rooms[a["id"]] = {
            "flat": flat_of(a["number"], rules.get("flat_from", "number_prefix")),
            "number": a["number"], "name": a["name"], "use": u, "level": a.get("level", ""),
            "area_m2": a["area_m2"], "id": a["id"], "uid": a.get("uid", ""),
            "req_light": a["area_m2"] * uses[u][0], "req_open": a["area_m2"] * uses[u][1],
            "windows": [], "merged": [], "notes": [],
        }

    unmatched, type_counts = [], {}
    for it in items:
        tc = type_counts.setdefault(it["key"], {"cat": it["cat"], "count": 0})
        tc["count"] += 1
        a, why = serving_room(it, areas, probe)
        if a is None or a["id"] not in rooms:
            unmatched.append({"id": it["id"], "uid": it.get("uid", ""), "key": it["key"], "why": why or "no room beside it"})
            continue
        info = type_info(it["key"], types)
        frac = it.get("fraction_override")
        confirmed = info["confirmed"]
        if frac is None:
            frac = info["fraction"]
        else:
            confirmed = True
        nominal = (it["w_mm"] / 1000.0) * (it["h_mm"] / 1000.0) if it.get("w_mm") and it.get("h_mm") else None
        bd = nominal * gf if nominal is not None else None
        meas = it.get("glass_m2")
        rooms[a["id"]]["windows"].append({
            "id": it["id"], "uid": it.get("uid", ""), "key": it["key"], "mark": it.get("mark", ""), "cat": it["cat"],
            "w_mm": it.get("w_mm"), "h_mm": it.get("h_mm"),
            "light_bd": bd, "light_meas": meas,
            "open_bd": (bd * frac) if (bd is not None and frac is not None) else None,
            "open_meas": (meas * frac) if (meas is not None and frac is not None) else None,
            "operation": info["operation"], "fraction": frac, "confirmed": confirmed,
        })

    # a bath / kitchen with no window of its own goes with the living room of its flat
    living = {}
    for r in rooms.values():
        if r["use"] == "LIV":
            living.setdefault(r["flat"], r)
    for r in list(rooms.values()):
        if r["use"] in rules.get("merge_into_living", []) and not r["windows"] and r["flat"] in living:
            host = living[r["flat"]]
            host["merged"].append(r)
            r["merged_into"] = host["number"]

    rows = []
    for r in sorted(rooms.values(), key=lambda q: (q["level"], q["flat"], q["number"])):
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


def _row(r, rules, merged=False):
    group = [r] + r["merged"]
    ws = r["windows"]
    req_l = sum(g["req_light"] for g in group)
    req_o = sum(g["req_open"] for g in group)
    pl_bd, po_bd = _sum(ws, "light_bd"), _sum(ws, "open_bd")
    pl_m, po_m = _sum(ws, "light_meas"), _sum(ws, "open_meas")
    notes = []
    need = False
    if merged:
        status = "WITH " + r["merged_into"]
        pl_bd = po_bd = pl_m = po_m = None
    else:
        if not ws:
            status, need = "NO WINDOW", False
            notes.append("no window or panel found for this room")
        else:
            if any(w["fraction"] is None for w in ws):
                need = True
                notes.append("a window type has no openable fraction yet")
            elif any(not w["confirmed"] for w in ws):
                need = True
                notes.append("openable fraction of a type not yet confirmed")
            if po_bd is None:
                need = True
            ok_l = pl_bd is not None and pl_bd + 1e-9 >= req_l
            ok_o = po_bd is not None and po_bd + 1e-9 >= req_o
            if need:
                status = "NEEDS DATA"
            else:
                status = "OK" if (ok_l and ok_o) else "NOT OK"
            if pl_m is not None and pl_bd is not None and abs(pl_m - pl_bd) > 0.05 * max(pl_bd, 0.001):
                notes.append("measured glass %.3f m2 differs from width x height x %d%% (%.3f m2)" % (pl_m, round(rules.get("glazing_factor", 0.8) * 100), pl_bd))
    return {
        "flat": r["flat"], "level": r["level"], "number": r["number"], "name": r["name"], "use": r["use"],
        "area_m2": _r3(r["area_m2"]),
        "with": [{"number": g["number"], "name": g["name"], "area_m2": _r3(g["area_m2"])} for g in r["merged"]],
        "req_light": _r3(req_l), "req_open": _r3(req_o),
        "prov_light_bd": _r3(pl_bd), "prov_open_bd": _r3(po_bd),
        "prov_light_meas": _r3(pl_m), "prov_open_meas": _r3(po_m),
        "status": status, "notes": notes, "uid": r["uid"], "id": r["id"],
        "windows": [dict((k, (_r3(v) if isinstance(v, float) else v)) for k, v in w.items()) for w in ws],
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
    head = [u"Flat", u"Level", u"Room", u"Name", u"Use", u"Area m2", u"Required lighting m2", u"Provided lighting m2 (W x H x 80%)",
            u"Provided lighting m2 (measured glass)", u"Required openable m2", u"Provided openable m2 (W x H x 80%)",
            u"Provided openable m2 (measured glass)", u"Status", u"Windows / panels", u"Notes"]
    lines = [u",".join(_csv(h) for h in head)]
    for r in rows:
        ws = u"; ".join(u"%s %s x %s" % (w.get("mark") or w["key"], int(w["w_mm"] or 0), int(w["h_mm"] or 0)) for w in r["windows"])
        name = r["name"]
        if r["with"]:
            name += u" + " + u" + ".join(w["name"] for w in r["with"])
        cells = [r["flat"], r["level"], r["number"], name, r["use"], r["area_m2"], r["req_light"], r["prov_light_bd"],
                 r["prov_light_meas"], r["req_open"], r["prov_open_bd"], r["prov_open_meas"], r["status"], ws, u"; ".join(r["notes"])]
        lines.append(u",".join(_csv(c) for c in cells))
    with io.open(path, "w", encoding="utf-8-sig", newline=u"") as f:
        f.write(u"\r\n".join(lines) + u"\r\n")


def write_json(path, rows, unmatched, type_counts):
    d = {"schema": "lwk.lv/1", "version": __version__, "rooms": rows, "unmatched": unmatched, "types": type_counts}
    txt = json.dumps(d, ensure_ascii=True, indent=1)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(txt if isinstance(txt, type(u"")) else txt.decode("ascii"))


# --- reading Revit -----------------------------------------------------------

def area_scheme_names(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, AreaScheme
    return sorted(s.Name for s in FilteredElementCollector(doc).OfClass(AreaScheme))


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


def _param_d(el, bips=(), names=()):
    """A length parameter in mm: built-in ones first, then by name on the
    instance and on its type."""
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
                    return p.AsDouble() * FT_MM
            except Exception:
                pass
    return None


def _text_param(el, name):
    try:
        p = el.LookupParameter(name)
        if p is not None and p.HasValue:
            return (p.AsString() or p.AsValueString() or "").strip()
    except Exception:
        pass
    return ""


def _facing(el):
    """The horizontal direction the element faces (out of the building for a
    window); from the instance, else from its host wall."""
    for attr in ("FacingOrientation",):
        try:
            v = getattr(el, attr)
            if v is not None and (abs(v.X) + abs(v.Y)) > 1e-6:
                m = (v.X * v.X + v.Y * v.Y) ** 0.5
                return (v.X / m, v.Y / m)
        except Exception:
            pass
    try:
        h = el.Host
        v = h.Orientation
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


def collect_items(doc, level_names=None, measure=True):
    """Windows, glazed doors and curtain panels with where they are, their
    size and measured glass."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, BuiltInParameter
    from lwk_viewer.compat import id_int
    cats = [("Windows", BuiltInCategory.OST_Windows), ("Doors", BuiltInCategory.OST_Doors),
            ("Curtain panels", BuiltInCategory.OST_CurtainWallPanels)]
    out = []
    for cname, bic in cats:
        for el in FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
            try:
                if _text_param(el, "LWK_LV_Exclude").lower() in ("1", "yes", "true"):
                    continue
                n = _facing(el)
                if n is None:
                    continue
                bb = el.get_BoundingBox(None)
                if bb is None:
                    continue
                try:
                    p = el.Location.Point
                    pos = (p.X * FT_MM, p.Y * FT_MM, (bb.Min.Z + bb.Max.Z) / 2.0 * FT_MM)
                except Exception:
                    pos = ((bb.Min.X + bb.Max.X) / 2.0 * FT_MM, (bb.Min.Y + bb.Max.Y) / 2.0 * FT_MM, (bb.Min.Z + bb.Max.Z) / 2.0 * FT_MM)
                if level_names:
                    try:
                        if doc.GetElement(el.LevelId).Name not in level_names and cname != "Curtain panels":
                            continue
                    except Exception:
                        pass
                w = _param_d(el, ("FAMILY_WIDTH_PARAM", "CURTAIN_WALL_PANELS_WIDTH", "DOOR_WIDTH"),
                             ("Width", "Rough Width"))
                h = _param_d(el, ("FAMILY_HEIGHT_PARAM", "CURTAIN_WALL_PANELS_HEIGHT", "DOOR_HEIGHT"),
                             ("Height", "Rough Height"))
                if w is None or h is None:
                    # from the box: along the wall, and the height
                    ex = abs(bb.Max.X - bb.Min.X) * FT_MM
                    ey = abs(bb.Max.Y - bb.Min.Y) * FT_MM
                    along = abs(n[0]) * ey + abs(n[1]) * ex      # extent across the facing direction
                    w = w or along
                    h = h or abs(bb.Max.Z - bb.Min.Z) * FT_MM
                fam = tname = ""
                try:
                    sym = el.Symbol
                    fam, tname = sym.FamilyName, sym.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM).AsString()
                except Exception:
                    try:
                        t = doc.GetElement(el.GetTypeId())
                        fam, tname = t.FamilyName, t.Name
                    except Exception:
                        pass
                key = u"%s : %s" % (fam, tname)
                mark = ""
                try:
                    t = doc.GetElement(el.GetTypeId())
                    mark = _text_param(t, "Type Mark")
                except Exception:
                    pass
                glass = _glass_m2(doc, el, n) if measure else None
                if cname == "Doors" and glass is None and not re.search(r"glass|glaz|sliding|folding|balcony", key, re.I):
                    continue
                ov = _text_param(el, "LWK_LV_Openable")
                frac = None
                if ov:
                    try:
                        frac = float(ov.replace("%", "")) / (100.0 if "%" in ov else 1.0)
                    except Exception:
                        frac = None
                out.append({"id": id_int(el.Id), "uid": el.UniqueId, "cat": cname, "key": key, "mark": mark,
                            "pos": pos, "n": n, "w_mm": w, "h_mm": h, "glass_m2": glass, "fraction_override": frac})
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
                if el is None:
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
