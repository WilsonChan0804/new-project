# -*- coding: utf-8 -*-
"""The Revit-side half of the elevation report (see lv_report_pdf.py for the
offline PDF it feeds): for every window/door/curtain-panel item the Light &
Vent check used, a disposable section view cropped to just that element, a
text label burned onto it stating the exact width/height (and, if the family
has them, the GBP_Glazing_*/GBP_Openable_* dimensions) this item's own row
already reports, exported as a PNG - then the view is deleted, leaving the
project exactly as it was.

The label is deliberately a text note, not a native Revit dimension picked
from the element's own geometry: a dimension has to reference the right
model edges, which differs family to family and is easy to get wrong without
a human checking each one; a text note showing the already-computed number
cannot disagree with the table, because it is not re-derived from geometry at
all - the Light & Vent check's own numbers are printed, not measured again.

Needs Revit (imports are local so lvcheck.py and its tests stay Revit-free).
This module has no unit tests of its own for that reason - the one thing
worth testing without Revit, the manifest, lives in lvcheck.py as
build_report_manifest/write_report_manifest.
"""
import os

FT_MM = 304.8


def _basis_for(n):
    """A right-handed frame looking along the element's own facing direction n
    (out of the building): BasisX across the element (horizontal), BasisY up,
    BasisZ = n (the section's view direction, into the building from outside)."""
    from Autodesk.Revit.DB import XYZ
    nx, ny = n
    view_dir = XYZ(nx, ny, 0.0).Normalize()
    up = XYZ(0, 0, 1)
    right = up.CrossProduct(view_dir).Normalize()
    true_up = view_dir.CrossProduct(right).Normalize()
    return right, true_up, view_dir


def _section_box(it, margin_mm=400.0, depth_mm=1200.0):
    """A BoundingBoxXYZ, centred on the item's own recorded position, cropped
    to its own width/height plus a margin, looking along its facing direction
    - the camera sits just outside the face and the box reaches depth_mm into
    the building, so the element reads clearly against what is behind it."""
    from Autodesk.Revit.DB import XYZ, Transform, BoundingBoxXYZ
    x, y, z = it["pos"]
    w = (it.get("w_mm") or 1000.0) + margin_mm * 2
    h = (it.get("h_mm") or 1000.0) + margin_mm * 2
    right, up, view_dir = _basis_for(it["n"])
    t = Transform.Identity
    t.Origin = XYZ(x / FT_MM, y / FT_MM, z / FT_MM)
    t.BasisX = right
    t.BasisY = up
    t.BasisZ = view_dir
    bb = BoundingBoxXYZ()
    bb.Transform = t
    half_w = (w / 2.0) / FT_MM
    half_h = (h / 2.0) / FT_MM
    bb.Min = XYZ(-half_w, -half_h, -(margin_mm / FT_MM))
    bb.Max = XYZ(half_w, half_h, depth_mm / FT_MM)
    return bb


def _section_type(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, ViewFamilyType, ViewFamily
    for vft in FilteredElementCollector(doc).OfClass(ViewFamilyType):
        if vft.ViewFamily == ViewFamily.Section:
            return vft.Id
    return None


def _label_lines(it, entry):
    lines = [u"%s x %s mm (overall)" % (int(it.get("w_mm") or 0), int(it.get("h_mm") or 0))]
    if it.get("glaze_m2_exact") is not None:
        lines.append(u"glazing %.3f m2 (GBP_Glazing_*)" % it["glaze_m2_exact"])
    if it.get("open_m2_exact") is not None:
        lines.append(u"openable %.3f m2 (GBP_Openable_*)" % it["open_m2_exact"])
    for r in entry.get("rooms", []):
        share = r.get("share")
        share_txt = u" (%d%%)" % round(share * 100) if share is not None and share < 0.999 else u""
        lines.append(u"%s %s%s: light %s / %s m2, open %s / %s m2" % (
            r.get("flat", ""), r.get("number", ""), share_txt,
            u"%.3f" % r["light_meas"] if r.get("light_meas") is not None else u"-",
            u"%.3f" % r["light_bd"] if r.get("light_bd") is not None else u"-",
            u"%.3f" % r["open_meas"] if r.get("open_meas") is not None else u"-",
            u"%.3f" % r["open_bd"] if r.get("open_bd") is not None else u"-"))
    return lines


def export_one(doc, it, entry, out_dir, section_type_id, text_type_id=None):
    """Creates a disposable section view cropped to `it`, labels it, exports a
    PNG named "<id>.png" into out_dir, then deletes the view. Sets
    entry["image"] to that filename on success. Returns True/False."""
    from Autodesk.Revit.DB import (Transaction, ViewSection, TextNote, TextNoteOptions, XYZ,
                                   ImageExportOptions, ExportRange, ZoomFitType, ImageResolution, ImageFileType)

    if not it.get("w_mm") or not it.get("h_mm"):
        return False
    img_name = u"%s.png" % it["id"]
    img_path = os.path.join(out_dir, img_name)

    view_id = None
    t = Transaction(doc, "LWK Light & Vent report: temporary elevation")
    t.Start()
    try:
        bb = _section_box(it)
        view = ViewSection.CreateSection(doc, section_type_id, bb)
        view.Name = u"LWK-LV-REPORT-%s" % it["id"]
        view.CropBoxActive = True
        view.CropBoxVisible = False
        try:
            from Autodesk.Revit.DB import ViewDetailLevel
            view.DetailLevel = ViewDetailLevel.Fine
        except Exception:
            pass
        view_id = view.Id
        right, up, _ = _basis_for(it["n"])
        x, y, z = it["pos"]
        origin = XYZ(x / FT_MM, y / FT_MM, z / FT_MM)
        label_pos = origin + right.Negate() * ((it["w_mm"] / 2.0 + 150.0) / FT_MM) + up * ((it["h_mm"] / 2.0 + 150.0) / FT_MM)
        text = u"\n".join(_label_lines(it, entry))
        try:
            if text_type_id is not None:
                TextNote.Create(doc, view_id, label_pos, text, text_type_id)
            else:
                TextNote.Create(doc, view_id, label_pos, text)
        except Exception:
            pass   # the image is still useful without the label if this fails on this element's family
        t.Commit()
    except Exception:
        t.RollBack()
        return False

    try:
        opts = ImageExportOptions()
        opts.ExportRange = ExportRange.SetOfViews
        opts.SetViewsAndSheets([view_id])
        opts.ZoomType = ZoomFitType.FitToPage
        opts.PixelSize = 1200
        opts.ImageResolution = ImageResolution.DPI_150
        opts.FilePath = os.path.join(out_dir, u"%s" % it["id"])
        opts.HLRandWFViewsFileType = ImageFileType.PNG
        doc.ExportImage(opts)
        _rename_exported(out_dir, it["id"], img_name)
    except Exception:
        ok = False
    else:
        ok = os.path.isfile(img_path)
        if ok:
            entry["image"] = img_name

    t2 = Transaction(doc, "LWK Light & Vent report: remove temporary elevation")
    t2.Start()
    try:
        doc.Delete(view_id)
        t2.Commit()
    except Exception:
        t2.RollBack()
    return ok


def _rename_exported(out_dir, elem_id, img_name):
    """Revit appends the view name to the file path given to ExportImage, so
    the produced file is not at the exact path we asked for - find it and
    rename it to "<id>.png"."""
    target = os.path.join(out_dir, img_name)
    if os.path.isfile(target):
        return
    prefix = u"%s" % elem_id
    for fn in os.listdir(out_dir):
        if fn.startswith(prefix) and fn.lower().endswith(".png"):
            try:
                os.rename(os.path.join(out_dir, fn), target)
            except Exception:
                pass
            return


def export_report(doc, items, rows, out_dir, progress=None):
    """items: collect_items() output. rows: build()'s rows. Exports one PNG per
    item that ended up in the table, writes lv_report_manifest.json in out_dir.
    progress(done, total) is called after each element, if given.
    -> (manifest, exported_count)"""
    from lwk_viewer import lvcheck as LV
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    manifest = LV.build_report_manifest(items, rows)
    by_uid = dict((e["uid"], e) for e in manifest)
    section_type_id = _section_type(doc)
    if section_type_id is None:
        LV.write_report_manifest(os.path.join(out_dir, "lv_report_manifest.json"), manifest)
        return manifest, 0
    done = 0
    total = len(items)
    for i, it in enumerate(items):
        entry = by_uid.get(it["uid"])
        if entry is not None and export_one(doc, it, entry, out_dir, section_type_id):
            done += 1
        if progress:
            progress(i + 1, total)
    LV.write_report_manifest(os.path.join(out_dir, "lv_report_manifest.json"), manifest)
    return manifest, done
