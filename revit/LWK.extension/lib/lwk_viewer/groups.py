# -*- coding: utf-8 -*-
"""Group sharing: a typical floor modelled as a group copied to every floor
is exported once, and the viewer places the copies.

Revit's IFC exporter knows nothing of groups: every copy of a typical-floor
group is exported element by element, geometry and all - thirty floors cost
thirty times one floor, in export time and in what a phone has to download.
Links placed on every floor were already exported once and placed by the
viewer; this does the same for groups.

For each group type with several copies of the same content:
  - the main export leaves out every copy of it;
  - one small export holds only the first copy's elements;
  - the manifest lists where every copy sits (a transform relative to the
    first), and the viewer places the one exported copy at each of them.

All of it happens inside the export's own transactions, which are rolled
back: the model is never changed.

A copy is only shared when it provably matches the first: the same number
of members (no members excluded in that copy), and its bounding box where
the first one's lands when moved by the copy's transform. A mirrored copy,
or one with excluded or extra elements, fails that test and is simply
exported as it is, like any other element.
"""

__version__ = "2026-09-27f"

import os

from Autodesk.Revit.DB import (FilteredElementCollector, ElementId, Group,
                               BuiltInCategory, Transform, XYZ)

FT = 304.8
MIN_MEMBERS = 5          # groups smaller than this are not worth a file
TOL_FT = 0.25            # 76 mm: how closely a copy must match the first
SETTINGS = {"on": True}


# ------------------------------------------------------------- transforms

def xform_dict(t):
    """A Revit Transform (feet) as the manifest writes transforms: origin in
    millimetres, basis vectors unitless."""
    o = t.Origin
    return {"origin": [o.X * FT, o.Y * FT, o.Z * FT],
            "basis_x": [t.BasisX.X, t.BasisX.Y, t.BasisX.Z],
            "basis_y": [t.BasisY.X, t.BasisY.Y, t.BasisY.Z],
            "basis_z": [t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z]}


def group_transform(g):
    """Where a group instance sits: its location point and its rotation
    about the vertical. None when the group does not say."""
    p = _loc_point(g)
    if p is None:
        return None
    rot = _rotation(g)
    t = Transform.CreateTranslation(p)
    if rot:
        t = t.Multiply(Transform.CreateRotation(XYZ.BasisZ, rot))
    return t


def _loc_point(g):
    try:
        return g.Location.Point
    except Exception:
        pass
    try:
        bb = g.get_BoundingBox(None)
        return bb.Min.Add(bb.Max).Multiply(0.5)
    except Exception:
        return None


def _rotation(g):
    """A group's rotation, or None: Revit raises for elements whose
    LocationPoint has no rotation - model groups among them in some
    versions, which is why no typical floor was ever found before."""
    try:
        return g.Location.Rotation
    except Exception:
        return None


def _anchor(el):
    """One point that moves with an element: its location point, the middle
    of its location line, or the middle of its box."""
    loc = getattr(el, "Location", None)
    try:
        p = loc.Point
        return (p.X, p.Y, p.Z)
    except Exception:
        pass
    try:
        p = loc.Curve.Evaluate(0.5, True)
        return (p.X, p.Y, p.Z)
    except Exception:
        pass
    try:
        bb = el.get_BoundingBox(None)
        return ((bb.Min.X + bb.Max.X) / 2.0, (bb.Min.Y + bb.Max.Y) / 2.0,
                (bb.Min.Z + bb.Max.Z) / 2.0)
    except Exception:
        return None


def _anchors(doc, g, limit=None):
    out = []
    ids = list(g.GetMemberIds())
    if limit and len(ids) > limit:
        step = len(ids) / float(limit)
        ids = [ids[int(k * step)] for k in range(limit)]
    for mid in ids:
        el = doc.GetElement(mid)
        a = _anchor(el) if el is not None else None
        if a is not None:
            out.append(a)
    return out


class _Grid(object):
    """Points hashed into cells, to ask 'is there one near here?' quickly."""

    def __init__(self, pts, cell=1.0):
        self.cell = cell
        self.cells = {}
        for p in pts:
            self.cells.setdefault(self._key(p), []).append(p)

    def _key(self, p):
        c = self.cell
        return (int(p[0] // c), int(p[1] // c), int(p[2] // c))

    def near(self, p, tol):
        kx, ky, kz = self._key(p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in self.cells.get((kx + dx, ky + dy, kz + dz), ()):
                        if (abs(q[0] - p[0]) <= tol and abs(q[1] - p[1]) <= tol
                                and abs(q[2] - p[2]) <= tol):
                            return True
        return False


def _relative_candidates(ref, g):
    """Transforms that could carry the first copy onto this one: the angle
    Revit reports (when it does), then the four right angles - about the
    two groups' location points."""
    import math
    pr, pc = _loc_point(ref), _loc_point(g)
    if pr is None or pc is None:
        return []
    angles = []
    rr, rc = _rotation(ref), _rotation(g)
    if rr is not None and rc is not None:
        angles.append(rc - rr)
    for a in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        if not any(abs(math.sin((a - b) / 2.0)) < 1e-6 for b in angles):
            angles.append(a)
    back = Transform.CreateTranslation(pr.Negate())
    out = []
    for a in angles:
        t = Transform.CreateTranslation(pc)
        if abs(math.sin(a / 2.0)) > 1e-9:
            t = t.Multiply(Transform.CreateRotation(XYZ.BasisZ, a))
        out.append(t.Multiply(back))
    return out


LAST = {}                # why copies were or were not shared, for the log


def _box_after(bb, t):
    """Axis-aligned box of `bb`'s eight corners moved by `t`."""
    xs, ys, zs = [], [], []
    for x in (bb.Min.X, bb.Max.X):
        for y in (bb.Min.Y, bb.Max.Y):
            for z in (bb.Min.Z, bb.Max.Z):
                p = t.OfPoint(XYZ(x, y, z))
                xs.append(p.X); ys.append(p.Y); zs.append(p.Z)
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def _same_box(a, b, tol=TOL_FT):
    (a0, a1), (b0, b1) = a, b
    return all(abs(a0[i] - b0[i]) <= tol and abs(a1[i] - b1[i]) <= tol for i in range(3))


def box_mm(lo, hi):
    return [[lo[0] * FT, lo[1] * FT, lo[2] * FT], [hi[0] * FT, hi[1] * FT, hi[2] * FT]]


# ----------------------------------------------------------------- finding

def _model_group_cat():
    try:
        return int(BuiltInCategory.OST_IOSModelGroups)
    except Exception:
        return None


def all_members(doc, g, out=None):
    """Every element in a group, nested groups opened up, as integer ids."""
    out = set() if out is None else out
    for mid in g.GetMemberIds():
        i = mid.IntegerValue
        if i in out:
            continue
        out.add(i)
        el = doc.GetElement(mid)
        if isinstance(el, Group):
            all_members(doc, el, out)
    return out


def _type_name(doc, g):
    try:
        t = doc.GetElement(g.GetTypeId())
        from Autodesk.Revit.DB import Element
        return Element.Name.GetValue(t) if t is not None else "group"
    except Exception:
        try:
            return g.Name
        except Exception:
            return "group"


def find_shared(doc, probe=None, min_members=MIN_MEMBERS):
    """Group types placed more than once, each as
    {"name", "ref", "ref_tf", "members": set, "copies": [(group, Transform)],
     "kept": n instances left to export normally}."""
    cat = _model_group_cat()
    by_type = {}
    for g in FilteredElementCollector(doc).OfClass(Group):
        try:
            if cat is not None and (g.Category is None or g.Category.Id.IntegerValue != cat):
                continue                       # detail groups
            if g.GroupId is not None and g.GroupId != ElementId.InvalidElementId:
                continue                       # nested: travels with its parent
        except Exception:
            continue
        by_type.setdefault(g.GetTypeId().IntegerValue, []).append(g)

    out = []
    why = {"types": 0, "no position": 0, "too small": 0, "member count differs": 0,
           "shape differs (mirrored or edited)": 0, "shared copies": 0}
    for insts in by_type.values():
        if len(insts) < 2:
            continue
        why["types"] += 1

        def z_of(g):
            p = _loc_point(g)
            return p.Z if p is not None else 0.0
        insts.sort(key=lambda g: (z_of(g), g.Id.IntegerValue))
        ref = None
        for g in insts:
            if _loc_point(g) is not None and g.get_BoundingBox(None) is not None:
                ref = g
                break
        if ref is None:
            why["no position"] += len(insts)
            continue
        members = all_members(doc, ref)
        if len(members) < min_members:
            why["too small"] += 1
            continue
        n_direct = len(list(ref.GetMemberIds()))
        rb = ref.get_BoundingBox(None)
        rbox = ((rb.Min.X, rb.Min.Y, rb.Min.Z), (rb.Max.X, rb.Max.Y, rb.Max.Z))
        # a few members of the first copy, checked in every other copy, so
        # a copy whose box happens to match but whose content was edited or
        # mirrored is not taken for the same
        sample = _anchors(doc, ref, limit=24)
        copies, kept = [], 0
        for g in insts:
            if g.Id == ref.Id:
                continue
            bb = g.get_BoundingBox(None)
            if bb is None:
                kept += 1
                why["no position"] += 1
                continue
            if len(list(g.GetMemberIds())) != n_direct:
                kept += 1
                why["member count differs"] += 1
                continue
            box = ((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z))
            grid = None
            found = None
            for rel in _relative_candidates(ref, g):
                if not _same_box(_box_after(rb, rel), box):
                    continue
                if grid is None:
                    grid = _Grid(_anchors(doc, g))
                hits = 0
                for a in sample:
                    p = rel.OfPoint(XYZ(a[0], a[1], a[2]))
                    if grid.near((p.X, p.Y, p.Z), TOL_FT):
                        hits += 1
                if not sample or hits >= 0.9 * len(sample):
                    found = rel
                    break
            if found is None:
                kept += 1
                why["shape differs (mirrored or edited)"] += 1
                continue
            copies.append((g, found))
        why["shared copies"] += len(copies)
        if copies:
            out.append({"name": _type_name(doc, ref), "ref": ref, "ref_tf": group_transform(ref),
                        "members": members, "copies": copies, "kept": kept,
                        "box": rbox})
    out.sort(key=lambda s: -len(s["members"]) * (len(s["copies"]) + 1))
    LAST.clear()
    LAST.update(why)
    return out


def why_text():
    """One line on what find_shared saw, for the log."""
    w = LAST
    if not w:
        return ""
    bits = ["%d group type(s) placed more than once" % w.get("types", 0)]
    for k in ("shared copies", "member count differs", "shape differs (mirrored or edited)",
              "no position", "too small"):
        if w.get(k):
            bits.append("%s: %d" % (k, w[k]))
    return "; ".join(bits)


def worth_it(doc, min_members=MIN_MEMBERS):
    """Quick look (works on a linked document too): does this model have a
    group type with copies big enough to share? Counts only, no geometry."""
    cat = _model_group_cat()
    counts = {}
    try:
        for g in FilteredElementCollector(doc).OfClass(Group):
            if cat is not None and (g.Category is None or g.Category.Id.IntegerValue != cat):
                continue
            if g.GroupId is not None and g.GroupId != ElementId.InvalidElementId:
                continue
            k = g.GetTypeId().IntegerValue
            if k not in counts:
                counts[k] = [0, len(list(g.GetMemberIds()))]
            counts[k][0] += 1
    except Exception:
        return 0
    saved = sum((n - 1) * m for n, m in counts.values() if n > 1 and m >= min_members)
    return saved


# --------------------------------------------------------------- deleting

def delete_many(doc, ids, chunk=800):
    """Delete inside the open transaction, a chunk at a time, one by one
    only within a chunk Revit refuses as a whole. Returns how many went."""
    from Autodesk.Revit.DB import SubTransaction
    from System.Collections.Generic import List
    ids = [i for i in ids]
    gone = 0
    for k in range(0, len(ids), chunk):
        part = ids[k:k + chunk]
        lst = List[ElementId]()
        for i in part:
            lst.Add(i if isinstance(i, ElementId) else ElementId(i))
        st = SubTransaction(doc)
        st.Start()
        try:
            doc.Delete(lst)
            st.Commit()
            gone += len(part)
            continue
        except Exception:
            st.RollBack()
        for i in lst:
            if doc.GetElement(i) is None:
                continue                       # went with an earlier one
            st = SubTransaction(doc)
            st.Start()
            try:
                doc.Delete(i)
                st.Commit()
                gone += 1
            except Exception:
                st.RollBack()
    return gone


def everything_but(doc, keep_ids):
    """Ids of the model's elements with geometry that are not in keep_ids
    (levels, grids and the like are kept: the IFC needs them)."""
    from Autodesk.Revit.DB import CategoryType, RevitLinkInstance
    keep_cats = set()
    for n in ("OST_Levels", "OST_Grids", "OST_ProjectBasePoint", "OST_SharedBasePoint",
              "OST_IOS_GeoSite", "OST_Cameras", "OST_Viewers", "OST_SunStudy"):
        try:
            keep_cats.add(int(getattr(BuiltInCategory, n)))
        except Exception:
            pass
    out = []
    col = FilteredElementCollector(doc).WhereElementIsNotElementType().WhereElementIsViewIndependent()
    for el in col:
        try:
            i = el.Id.IntegerValue
            if i in keep_ids or isinstance(el, RevitLinkInstance):
                continue
            nested = el.GroupId is not None and el.GroupId != ElementId.InvalidElementId
            if nested:
                continue                       # goes with its group, deleted whole
            if isinstance(el, Group):
                out.append(el.Id)              # a whole other group
                continue
            c = el.Category
            if c is None or c.CategoryType != CategoryType.Model or c.Id.IntegerValue in keep_cats:
                continue
            if el.get_BoundingBox(None) is None:
                continue
            out.append(el.Id)
        except Exception:
            continue
    return out


# -------------------------------------------------- group file, fast way
#
# The first group files took 8-10 minutes each for a 3-4 MB file: making
# one meant deleting everything else in the model - 1,188 group copies and
# their members - inside the export's transaction, and rolling all of it
# back afterwards. Instead, a temporary 3D view is boxed round the first
# copy, the few other elements inside the box are hidden, and the exporter
# is told to export only what that view shows. Nothing is deleted; the view
# goes with the rolled-back transaction.

VIEW_PAD_FT = 1.0


def _top_group(d, el):
    g = el
    for _ in range(12):
        gid = getattr(g, "GroupId", None)
        if gid is None or gid == ElementId.InvalidElementId:
            return g
        nxt = d.GetElement(gid)
        if nxt is None:
            return g
        g = nxt
    return g


def group_view(d, keep, box, probe=None):
    """Inside the open transaction: a 3D view showing only the elements in
    `keep` (integer ids) within `box` ((lo), (hi) in feet). Returns
    (view ElementId, number hidden)."""
    from Autodesk.Revit.DB import (View3D, ViewFamilyType, ViewFamily, BoundingBoxXYZ,
                                   CategoryType, ViewDetailLevel)
    from System.Collections.Generic import List
    vft = [t for t in FilteredElementCollector(d).OfClass(ViewFamilyType)
           if t.ViewFamily == ViewFamily.ThreeDimensional][0]
    v = View3D.CreateIsometric(d, vft.Id)
    try:
        v.ViewTemplateId = ElementId.InvalidElementId
    except Exception:
        pass
    try:
        v.DetailLevel = ViewDetailLevel.Fine
    except Exception:
        pass
    (lo, hi), p = box, VIEW_PAD_FT
    bb = BoundingBoxXYZ()
    bb.Min = XYZ(lo[0] - p, lo[1] - p, lo[2] - p)
    bb.Max = XYZ(hi[0] + p, hi[1] + p, hi[2] + p)
    v.IsSectionBoxActive = True
    v.SetSectionBox(bb)
    d.Regenerate()
    hide = set()
    for el in FilteredElementCollector(d, v.Id).WhereElementIsNotElementType():
        try:
            i = el.Id.IntegerValue
            if i in keep:
                continue
            c = el.Category
            if c is None or c.CategoryType != CategoryType.Model:
                continue
            top = _top_group(d, el)
            if top.Id.IntegerValue in keep:
                continue
            if top is not el:
                hide.add(top.Id.IntegerValue)      # a whole other group
                continue
            if el.CanBeHidden(v):
                hide.add(i)
        except Exception:
            continue
    ids = list(hide)
    for k in range(0, len(ids), 500):
        lst = List[ElementId]()
        for i in ids[k:k + 500]:
            lst.Add(ElementId(i))
        try:
            v.HideElements(lst)
        except Exception:
            for e in lst:
                try:
                    one = List[ElementId]()
                    one.Add(e)
                    v.HideElements(one)
                except Exception:
                    pass
    return v.Id, len(ids)


def _group_prep(d, keep, box, name, gname, probe):
    """prepare() for one group file: the view way, and the old deleting way
    only if the view cannot be made."""
    import time

    def prep():
        t0 = time.time()
        try:
            vid, n = group_view(d, keep, box, probe)
            probe.info("groups", "'%s': group '%s' - view boxed round the first copy, %d other "
                                 "element(s) hidden (%.0f s)" % (name, gname, n, time.time() - t0))
            return vid
        except Exception as ex:
            probe.warn("groups", "'%s': group '%s' - view way failed (%s); deleting the rest "
                                 "instead (slow)" % (name, gname, ex))
            delete_many(d, everything_but(d, keep))
            return None
    return prep


# ---------------------------------------------------------------- export

def export_shared(d, folder, name, probe, export_fn):
    """Export an open document with group sharing.

    export_fn(folder, file_stem, prepare) runs one IFC export of `d` in a
    rolled-back transaction, calling prepare() inside it first.
    Returns (main_path, [group record]) - a group record holds the file of
    the exported copy and every copy's transform relative to it, in this
    model's internal millimetres."""
    import time
    t0 = time.time()
    shared = find_shared(d, probe)
    probe.info("groups", "'%s': %s" % (name, why_text()))
    if not shared:
        probe.info("groups", "'%s': no group copies can be shared - exporting it whole" % name)
        return export_fn(folder, name, None), []
    n_copies = sum(len(s["copies"]) for s in shared)
    n_saved = sum(len(s["members"]) * len(s["copies"]) for s in shared)
    probe.info("groups", "'%s': %d group type(s) repeated - %d copies (about %d elements) "
                         "will be placed by the viewer instead of exported"
               % (name, len(shared), n_copies, n_saved))
    for s in shared[:8]:
        probe.info("groups", "  '%s': %d elements, %d copies%s"
                   % (s["name"], len(s["members"]), len(s["copies"]),
                      ("; %d copies differ and are exported as they are" % s["kept"]) if s["kept"] else ""))

    # the main file: every shared copy left out (the first one too - it has
    # its own file)
    drop = []
    for s in shared:
        drop.append(s["ref"].Id)
        drop.extend(g.Id for g, _ in s["copies"])

    def prep_main():
        gone = delete_many(d, drop)
        probe.info("groups", "'%s': %d group copies left out of the main file" % (name, gone))
    main = export_fn(folder, name, prep_main)
    probe.info("groups", "'%s': main file done in %.1f min" % (name, (time.time() - t0) / 60.0))
    if not main:
        return None, []

    records = []
    for k, s in enumerate(shared):
        stem = "%s__g%d" % (name, k + 1)
        keep = set(s["members"])
        keep.add(s["ref"].Id.IntegerValue)

        prep_group = _group_prep(d, keep, s["box"], name, s["name"], probe)
        t1 = time.time()
        path = export_fn(folder, stem, prep_group)
        if not path:
            probe.warn("groups", "'%s': the file for group '%s' was not written; its copies "
                                 "will be missing from the viewer" % (name, s["name"]))
            continue
        ident = Transform.Identity
        records.append({
            "group": s["name"], "file": path,
            "copies": [{"id": s["ref"].Id.IntegerValue, "rel": xform_dict(ident)}]
                      + [{"id": g.Id.IntegerValue, "rel": xform_dict(rel)} for g, rel in s["copies"]],
            "box_ft": s["box"],
        })
        probe.info("groups", "'%s': group '%s' (%d copies) written in %.1f min (%.1f MB)"
                   % (name, s["name"], len(s["copies"]) + 1, (time.time() - t1) / 60.0,
                      os.path.getsize(path) / 1048576.0))
    return main, records


# ---------------------------------------------------- several Revit windows
#
# Revit's IFC exporter works on one processor core: on a 24-core PC one
# export uses 4 % of the machine, and nothing inside Revit makes it use more.
# But several Revit windows run side by side, each on its own core. So a
# big model can be exported in parts - the same model open in 2-4 Revit
# windows, each exporting its own share - and the viewer loads the parts
# together as one model.
#
# Every window works out the same split by itself (the same model gives the
# same list), so they need not talk to each other: each writes a small
# note when done, and whichever finishes last joins the notes into the one
# record the master export reads (<link>.ifc.ok).

def _units(d, shared):
    """What the parts divide: every element with geometry outside the
    shared groups (a group not shared goes whole, as one unit), each with
    its height and weight, in a fixed order."""
    skip = set()
    for s in shared:
        skip.add(s["ref"].Id.IntegerValue)
        skip.update(g.Id.IntegerValue for g, _ in s["copies"])
    out = []
    for eid in everything_but(d, skip):
        el = d.GetElement(eid)
        if el is None:
            continue
        bb = el.get_BoundingBox(None)
        z = (bb.Min.Z + bb.Max.Z) / 2.0 if bb is not None else 0.0
        w = len(all_members(d, el)) if isinstance(el, Group) else 1
        box = ((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z)) if bb else None
        out.append((round(z, 2), eid.IntegerValue, w, box))
    out.sort(key=lambda u: (u[0], u[1]))
    return out


def split_units(units, parts):
    """Contiguous slices (bottom to top) of about equal weight: a part is a
    band of floors, so the viewer can load the floors it is looking at."""
    total = float(sum(u[2] for u in units)) or 1.0
    out = [[] for _ in range(parts)]
    acc = 0.0
    for u in units:
        k = min(parts - 1, int(acc / total * parts))
        out[k].append(u)
        acc += u[2]
    return out


def _union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    lo = tuple(min(b[0][i] for b in boxes) for i in range(3))
    hi = tuple(max(b[1][i] for b in boxes) for i in range(3))
    return (lo, hi)


def part_note_path(folder, name, part):
    return os.path.join(folder, "%s.part%d.json" % (name, part))


def export_part(d, folder, name, probe, export_fn, part, parts, share=True):
    """This window's share of a model exported in `parts` Revit windows.

    Part 1 writes <name>.ifc (its band of floors); part k writes
    <name>__p<k>.ifc; the shared groups' files are dealt out between the
    windows. Returns (done, message): done once every part has finished
    and the record for the master export is written."""
    import json
    import time
    from lwk_viewer import jsonio
    t0 = time.time()
    # A record from an earlier whole-model export would make the master
    # use a half-finished set of parts: it goes until every part is back.
    try:
        ok = os.path.join(folder, name + ".ifc.ok")
        if os.path.exists(ok):
            os.remove(ok)
    except Exception:
        pass
    shared = find_shared(d, probe) if share else []
    if share:
        probe.info("groups", "'%s': %s" % (name, why_text()))
    units = _units(d, shared)
    bands = split_units(units, parts)
    mine = bands[part - 1]
    sig = "%d/%d/%d" % (len(units), len(shared), parts)
    probe.info("parts", "'%s': part %d of %d - %d of %d elements (floors %.1f m to %.1f m)%s"
               % (name, part, parts, len(mine), len(units),
                  (mine[0][0] * FT / 1000.0) if mine else 0, (mine[-1][0] * FT / 1000.0) if mine else 0,
                  ("; group file(s) %s" % ", ".join(str(j + 1) for j in range(len(shared)) if j % parts == part - 1))
                  if any(j % parts == part - 1 for j in range(len(shared))) else ""))

    keep = set(u[1] for u in mine)
    drop = [ElementId(u[1]) for u in units if u[1] not in keep]
    for s in shared:
        drop.append(s["ref"].Id)
        drop.extend(g.Id for g, _ in s["copies"])

    def prep_main():
        gone = delete_many(d, drop)
        probe.info("parts", "'%s': %d elements of the other parts left out of this one" % (name, gone))
    stem = name if part == 1 else "%s__p%d" % (name, part)
    path = export_fn(folder, stem, prep_main)
    if not path:
        return False, "part %d was not written" % part
    probe.info("parts", "'%s': part %d written in %.1f min (%.1f MB)"
               % (name, part, (time.time() - t0) / 60.0, os.path.getsize(path) / 1048576.0))

    records = []
    if part > 1:
        box = _union([u[3] for u in mine])
        records.append({"group": "part %d" % part, "file": os.path.basename(path),
                        "copies": [{"id": 0, "rel": xform_dict(Transform.Identity)}],
                        "box_ft": box or ((0, 0, 0), (0, 0, 0)), "part": part})
    for j, s in enumerate(shared):
        if j % parts != part - 1:
            continue
        gstem = "%s__g%d" % (name, j + 1)
        gkeep = set(s["members"])
        gkeep.add(s["ref"].Id.IntegerValue)

        prep_group = _group_prep(d, gkeep, s["box"], name, s["name"], probe)
        t1 = time.time()
        gp = export_fn(folder, gstem, prep_group)
        if not gp:
            probe.warn("groups", "'%s': the file for group '%s' was not written" % (name, s["name"]))
            continue
        records.append({
            "group": s["name"], "file": os.path.basename(gp),
            "copies": [{"id": s["ref"].Id.IntegerValue, "rel": xform_dict(Transform.Identity)}]
                      + [{"id": g.Id.IntegerValue, "rel": xform_dict(rel)} for g, rel in s["copies"]],
            "box_ft": s["box"],
        })
        probe.info("groups", "'%s': group '%s' written in %.1f min" % (name, s["name"], (time.time() - t1) / 60.0))

    jsonio.write_atomic(part_note_path(folder, name, part),
                        {"part": part, "parts": parts, "sig": sig, "time": time.time(),
                         "file": os.path.basename(path), "records": records}, indent=0)
    return join_parts(folder, name, parts, sig, probe)


def join_parts(folder, name, parts, sig, probe=None, max_age_h=48):
    """When every part's note is there (same model, same split, recent, its
    files on disk): one record listing all of them for the master export.
    Returns (done, message)."""
    import json
    import time
    notes, missing = [], []
    for k in range(1, parts + 1):
        p = part_note_path(folder, name, k)
        try:
            with open(p) as f:
                n = json.loads(f.read() or "{}")
            if (n.get("sig") != sig or time.time() - n.get("time", 0) > max_age_h * 3600
                    or not os.path.exists(os.path.join(folder, n.get("file", "?")))):
                missing.append(k)
                continue
            notes.append(n)
        except Exception:
            missing.append(k)
    if missing:
        return False, "waiting for part(s) %s" % ", ".join(str(k) for k in missing)
    recs = []
    for n in notes:
        for r in n.get("records") or []:
            recs.append(dict(r, file=os.path.join(folder, r["file"])))
    main = os.path.join(folder, name + ".ifc")
    from lwk_viewer import exporters
    exporters._mark_done(main, "own", recs, manual=True)
    return True, "all %d parts done - %d extra file(s) with the main one" % (parts, len(recs))


# ------------------------------------------------------ plain-number maths

def mat(d):
    """Manifest transform dict -> 4x4 row-major (mm)."""
    o, x, y, z = d["origin"], d["basis_x"], d["basis_y"], d["basis_z"]
    return [[x[0], y[0], z[0], o[0]],
            [x[1], y[1], z[1], o[1]],
            [x[2], y[2], z[2], o[2]],
            [0.0, 0.0, 0.0, 1.0]]


def unmat(m):
    return {"origin": [m[0][3], m[1][3], m[2][3]],
            "basis_x": [m[0][0], m[1][0], m[2][0]],
            "basis_y": [m[0][1], m[1][1], m[2][1]],
            "basis_z": [m[0][2], m[1][2], m[2][2]]}


def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3)]


def placed_box(m, lo_mm, hi_mm):
    pts = [apply(m, [x, y, z]) for x in (lo_mm[0], hi_mm[0])
           for y in (lo_mm[1], hi_mm[1]) for z in (lo_mm[2], hi_mm[2])]
    return [[min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]]
