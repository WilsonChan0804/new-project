# -*- coding: utf-8 -*-
"""Geometry and sheet output.

IFC carries the 3D model plus the IfcGUIDs that BCF issues will reference.
PDF carries the sheets, and is rendered in the browser by pdf.js, whose
annotation layer becomes the markup toolbar.

The PDF must be exported at 100% zoom on a page matching the sheet size.
Any scaling or centring Revit applies here silently invalidates every
paper_to_model mapping in the manifest.

PDFExportOptions is the least stable part of the Revit API across versions:
enum type names and property names have both moved between 2022 and 2026.
Nothing here is imported at module level except PDFExportOptions itself.
Everything else is resolved at runtime and downgraded to a probe warning if
this build does not have it.
"""

# Printed by the auto-export buttons, so a stale copy is obvious.
__version__ = "2026-09-27f"

import os
import shutil

from lwk_viewer import groups as GROUPS

from Autodesk.Revit.DB import (IFCExportOptions, IFCVersion, ElementId,
                               FilteredElementCollector)
from System.Collections.Generic import List

# Warnings about missing API members are logged once per session, not once
# per sheet.
_REPORTED = set()


# ---------------------------------------------------------------------------
# IFC
# ---------------------------------------------------------------------------

def export_ifc(doc, folder, name, probe, schema="IFC4", links="merged"):
    """Revit's IFC exporter writes into the document while it runs, so this
    needs an open transaction even though nothing should survive it. The
    transaction is rolled back, leaving the model untouched.

    The AddOption calls matter more than they look. Without them the
    exporter inherits whatever the user last chose in the IFC dialog, which
    on a shared machine is unknowable. In particular
    ExportVisibleElementsInView silently reduces the export to the active
    view, which looks like a broken model rather than a setting.
    """
    from Autodesk.Revit.DB import Transaction

    opts = IFCExportOptions()
    opts.FileVersion = IFCVersion.IFC4 if schema == "IFC4" else IFCVersion.IFC2x3CV2
    opts.ExportBaseQuantities = True
    opts.WallAndColumnSplitting = False
    # Leave FilterViewId unset: any value restricts the export to that view.

    # LinkedFileExportAs: 0 = do not export, 1 = merge into this file,
    # 2 = one IFC per link. Older builds read a boolean instead, where true
    # meant separate files.
    #
    # "merged" is the useful mode for a viewer. Links in this project are
    # placed with Shared Site = Not Shared, so the separate files share no
    # spatial reference and cannot be reassembled afterwards without
    # information Revit never exported. Merging lets Revit resolve every
    # placement, which it already knows, and produces one correct model.
    try:
        ver = int(doc.Application.VersionNumber)
    except Exception:
        ver = 2023

    # Only the boolean strings are used. Numeric LinkedFileExportAs values
    # were tried and this exporter silently ignored them: no links were
    # written and no error was raised. "true" is the value observed to
    # actually produce one IFC per link on this build.
    #
    # There is no proven AddOption value for merging links into a single
    # IFC, so that mode is not attempted here. Export it from the Revit
    # dialog instead and point this tool at the result.
    if links in (True, "separate"):
        link_val = "true"
    else:
        link_val = "false"
    probe.info("ifc", "%s: ExportLinkedFiles=%s" % (doc.Title, link_val))

    for key, val in (
            # SiteTransformBasis: 0 = Shared, 1 = Site, 2 = Project,
            # 3 = Internal. Shared is the one that matters here: exporting a
            # linked file on its own otherwise uses that file's own basis, so
            # every floor lands at its local origin and the whole set comes
            # out flat. Shared coordinates are what the master file uses to
            # place the links, so all files land at their true elevation and
            # no transform is needed afterwards.
            ("SitePlacement", "0"),
            ("ExportVisibleElementsInView", "false"),  # whole model, not a view
            ("ExportLinkedFiles", link_val),
            ("ExportRoomsInView", "false"),
            ("IncludeSiteElevation", "true"),
            ("ExportInternalRevitPropertySets", "true"),
            ("ExportIFCCommonPropertySets", "true"),
            ("ExportPartsAsBuildingElements", "true"),
            ("ExportSolidModelRep", "false"),
            ("Use2DRoomBoundaryForVolume", "false"),
            ("UseFamilyAndTypeNameForReference", "true")):
        try:
            opts.AddOption(key, val)
        except Exception as ex:
            _once(probe, "ifcopt:" + key, "warn", "ifc",
                  "could not set '%s': %s" % (key, ex))

    # A linked document is read-only: starting a transaction on one throws.
    # The host document is the opposite - the IFC exporter writes into it
    # while it runs and refuses without an open transaction.
    needs_tx = True
    try:
        needs_tx = not doc.IsLinked
    except Exception:
        pass

    t = None
    try:
        if needs_tx:
            t = Transaction(doc, "Viewer export: IFC")
            t.Start()
        doc.Export(folder, name, opts)
    except Exception as ex:
        probe.error("ifc", "export of '%s' failed: %s" % (doc.Title, ex))
        return None
    finally:
        try:
            if t is not None and t.HasStarted() and not t.HasEnded():
                t.RollBack()
        except Exception as ex:
            probe.warn("ifc", "could not roll back the export "
                              "transaction: %s" % ex)

    path = os.path.join(folder, name + ".ifc")
    if not os.path.exists(path):
        probe.error("ifc", "export reported success but no file at %s" % path)
        return None

    mb = os.path.getsize(path) / 1048576.0
    probe.info("ifc", "wrote %s (%.1f MB)" % (os.path.basename(path), mb))
    if mb < 1.0:
        probe.warn("ifc", "the IFC is only %.2f MB, which is far too small "
                          "for a full building. Check the scope diagnostics "
                          "in this manifest." % mb)
    return path


# ---------------------------------------------------------------------------
# Runtime API resolution
# ---------------------------------------------------------------------------

def _enum(type_names, member):
    """Find Autodesk.Revit.DB.<type>.<member> for the first type name that
    exists in this build. Returns None if none of them do."""
    import Autodesk.Revit.DB as DB
    if isinstance(type_names, str):
        type_names = [type_names]
    for tn in type_names:
        t = getattr(DB, tn, None)
        if t is None:
            continue
        v = getattr(t, member, None)
        if v is not None:
            return v
    return None


def _once(probe, key, level, scope, message):
    if key in _REPORTED:
        return
    _REPORTED.add(key)
    getattr(probe, level)(scope, message)


def _set(opts, attr, value, probe):
    """Set an option, tolerating both a missing property and a missing enum."""
    if not hasattr(opts, attr):
        _once(probe, "attr:" + attr, "warn", "pdf",
              "PDFExportOptions has no '%s' in this Revit build; using the "
              "Revit default" % attr)
        return False
    if value is None:
        _once(probe, "enum:" + attr, "warn", "pdf",
              "no matching enum value for '%s'; using the Revit default"
              % attr)
        return False
    try:
        setattr(opts, attr, value)
        return True
    except Exception as ex:
        _once(probe, "set:" + attr, "warn", "pdf",
              "could not set '%s': %s" % (attr, ex))
        return False


def pdf_available(doc):
    try:
        from Autodesk.Revit.DB import PDFExportOptions  # noqa: F401
        return True
    except ImportError:
        return False


def _build_options(probe, file_name):
    from Autodesk.Revit.DB import PDFExportOptions

    opts = PDFExportOptions()

    # Counter-intuitive, but deliberate: we export ONE sheet at a time with
    # Combine on. In combined mode Revit uses opts.FileName verbatim. In
    # non-combined mode it ignores FileName and builds the name from the
    # naming rule, which includes the sheet name -- and a Hong Kong sheet
    # name like "TYPICAL FLOOR (7/F - 36/F)" contains a slash, which Revit
    # then rejects as an illegal filename. Combined mode sidesteps the
    # naming rule entirely.
    opts.Combine = True
    _set(opts, "FileName", file_name, probe)

    # Geometry-critical. If any of these fall back to a Revit default the
    # page may be rescaled or re-centred, which breaks paper_to_model.
    _set(opts, "PaperFormat", _enum("ExportPaperFormat", "Default"), probe)
    _set(opts, "ZoomType", _enum("ZoomType", "Zoom"), probe)
    _set(opts, "ZoomPercentage", 100, probe)
    _set(opts, "PaperPlacement",
         _enum("PaperPlacementType", "Center"), probe)

    # Cosmetic. 'ColorDepthType' in most builds, 'ExportColorDepthType' in
    # some. Try both.
    _set(opts, "ColorDepth",
         _enum(["ColorDepthType", "ExportColorDepthType"], "Color"), probe)

    for flag in ("HideCropBoundaries", "HideScopeBoxes",
                 "HideReferencePlane", "HideUnreferencedViewTags",
                 "StopOnError"):
        _set(opts, flag, True, probe)

    return opts


# ---------------------------------------------------------------------------
# Sheets
# ---------------------------------------------------------------------------

def _safe_name(text):
    return "".join(c for c in text if c.isalnum() or c in "-_.") or "sheet"


def export_sheet_pdf(doc, sheet, folder, probe):
    """One PDF per sheet, named by sheet number.

    Revit's own file naming for non-combined PDF export goes through naming
    rules that changed shape between versions, so we sidestep it: export
    into an empty temp folder, then rename whatever single file appears.
    """
    tmp = os.path.join(folder, "_tmp")
    if os.path.isdir(tmp):
        shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)

    safe = _safe_name(sheet.SheetNumber)

    try:
        opts = _build_options(probe, safe)
    except Exception as ex:
        probe.error(sheet.SheetNumber, "could not build PDF options: %s" % ex)
        return None

    ids = List[ElementId]()
    ids.Add(sheet.Id)

    try:
        doc.Export(tmp, ids, opts)
    except Exception as ex:
        probe.error(sheet.SheetNumber, "pdf export failed: %s" % ex)
        shutil.rmtree(tmp, ignore_errors=True)
        return None

    produced = [f for f in os.listdir(tmp) if f.lower().endswith(".pdf")]
    if not produced:
        probe.error(sheet.SheetNumber, "no pdf produced")
        shutil.rmtree(tmp, ignore_errors=True)
        return None
    if len(produced) > 1:
        probe.warn(sheet.SheetNumber,
                   "export produced %d pdfs, keeping '%s'"
                   % (len(produced), produced[0]))

    target = safe + ".pdf"
    dest = os.path.join(folder, target)
    if os.path.exists(dest):
        os.remove(dest)
    shutil.move(os.path.join(tmp, produced[0]), dest)
    shutil.rmtree(tmp, ignore_errors=True)

    probe.info(sheet.SheetNumber, "wrote %s (%.0f KB)"
               % (target, os.path.getsize(dest) / 1024.0))
    return target


# ---------------------------------------------------------------------------
# Linked models
# ---------------------------------------------------------------------------

def _xform_mm(t):
    """A Revit Transform as plain numbers: origin in millimetres, basis
    vectors unitless. host_mm = origin + x*bx + y*by + z*bz."""
    o, bx, by, bz = t.Origin, t.BasisX, t.BasisY, t.BasisZ
    return {
        "origin": [o.X * 304.8, o.Y * 304.8, o.Z * 304.8],
        "basis_x": [bx.X, bx.Y, bx.Z],
        "basis_y": [by.X, by.Y, by.Z],
        "basis_z": [bz.X, bz.Y, bz.Z],
    }


def export_link_ifcs(doc, folder, probe, schema="IFC4", progress=None,
                     already=None):
    """One IFC per linked model, federated rather than merged.

    Revit can merge links into a single IFC, but on a master file with many
    links that route is slow and prone to failing halfway with no useful
    message. Exporting each link document on its own is an ordinary
    whole-model export every time, and it lets the viewer switch individual
    models on and off, which is what people actually want.

    The price is that each link arrives in its own coordinates, so the host
    instance transform is recorded alongside it.
    """
    from Autodesk.Revit.DB import RevitLinkInstance

    sub = os.path.join(folder, "links")
    if not os.path.isdir(sub):
        os.makedirs(sub)

    by_doc = {}
    for li in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        try:
            ld = li.GetLinkDocument()
        except Exception:
            ld = None
        if ld is None:
            probe.warn("links", "'%s' is not loaded, so it cannot be exported."
                       % li.Name)
            continue
        key = ld.Title
        rec = by_doc.setdefault(key, {"doc": ld, "instances": [],
                                      "model_path": None})
        if rec["model_path"] is None:
            rec["model_path"] = link_model_path(doc, li, ld, probe)
        try:
            rec["instances"].append({
                "instance_id": li.Id.IntegerValue,
                "name": li.Name,
                "transform": _xform_mm(li.GetTotalTransform()),
            })
        except Exception as ex:
            probe.warn("links", "no transform for '%s': %s" % (li.Name, ex))

    # Anything Revit's native pass already produced is not redone.
    covered = [a.lower() for a in (already or [])]
    for title in list(by_doc.keys()):
        if any(title.lower() in c for c in covered):
            probe.info("links", "%s covered by native export." % title)
            del by_doc[title]

    out = []
    total = len(by_doc)
    if total:
        probe.info("links", "%d distinct linked model(s) to export. Each is "
                            "opened detached, so allow several minutes per "
                            "model on a cloud project." % total)
    for i, (title, rec) in enumerate(sorted(by_doc.items())):
        if progress:
            progress(i, total, title)
        safe = _safe_name(title)
        done = os.path.join(sub, safe + ".ifc")

        # Reopening 17 cloud models takes a long time and gets interrupted.
        # An IFC already on disk is left alone so a rerun resumes instead of
        # starting over; delete the links folder to force a full re-export.
        if os.path.exists(done) and os.path.getsize(done) > 1024:
            probe.info("links", "%s already exported, keeping it." % title)
            path = done
        else:
            probe.info("links", "exporting %s (%d/%d)" % (title, i + 1, total))
            path = export_link_ifc(doc, rec["doc"], rec["model_path"],
                                   sub, safe, probe, schema=schema)
        if not path:
            probe.error("links", "export of '%s' produced nothing." % title)
            continue
        out.append({
            "name": title,
            "ifc": "links/" + os.path.basename(path),
            "size_mb": round(os.path.getsize(path) / 1048576.0, 2),
            "coordinates": "own",          # viewer must apply the transforms
            "exported_by": "reopen_fallback",
            "instances": rec["instances"],
        })

    if not out:
        probe.warn("links", "no linked models were exported.")
    return out


def link_model_path(host_doc, link_instance, link_doc, probe):
    """A ModelPath for the linked model, usable by OpenDocumentFile.

    Document.PathName is a filesystem string and is empty or meaningless
    for a cloud-hosted model, which is why path-based reopening fails on
    ACC projects. The link TYPE holds an ExternalFileReference whose
    absolute path is a ModelPath, and that works for local and cloud alike.
    """
    from Autodesk.Revit.DB import ModelPathUtils

    try:
        lt = host_doc.GetElement(link_instance.GetTypeId())
        ref = lt.GetExternalFileReference()
        mp = ref.GetAbsolutePath()
        if mp is not None:
            return mp
    except Exception as ex:
        probe.info("links", "no external file reference for '%s': %s"
                   % (link_instance.Name, ex))

    try:
        if link_doc.IsModelInCloud:
            return link_doc.GetCloudModelPath()
    except Exception:
        pass

    try:
        pn = link_doc.PathName
        if pn:
            return ModelPathUtils.ConvertUserVisiblePathToModelPath(pn)
    except Exception:
        pass
    return None


def _open_detached(app, model_path, probe):
    """Open a model on its own, detached, with every workset open.

    Used because exporting a link in place is impossible: a link document
    is read-only, and the IFC exporter needs to write. Opening it as a
    primary document lifts that restriction, and OpenAllWorksets also picks
    up anything closed inside the link.
    """
    from Autodesk.Revit.DB import (OpenOptions, DetachFromCentralOption,
                                   WorksetConfiguration,
                                   WorksetConfigurationOption)
    mp = model_path
    oo = OpenOptions()

    cloud = False
    try:
        cloud = bool(mp.CloudPath)
    except Exception:
        pass

    try:
        # Detaching is refused for cloud models, so only ask for it on
        # file-based ones. Cloud models open read-through and are closed
        # without saving, which leaves nothing behind either way.
        if not cloud:
            oo.DetachFromCentralOption = \
                DetachFromCentralOption.DetachAndPreserveWorksets
        oo.SetOpenWorksetsConfiguration(
            WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets))
    except Exception as ex:
        probe.warn("links", "could not set open options: %s" % ex)
    return app.OpenDocumentFile(mp, oo)


def export_link_ifc(host_doc, link_doc, model_path, folder, name, probe,
                    schema="IFC4"):
    """Export one linked model by reopening it detached.

    There is no in-place path: a link document cannot hold a transaction,
    and the IFC exporter cannot run without one. Trying first only produces
    a guaranteed error in the log, so it is not attempted.
    """
    if model_path is None:
        probe.error("links", "'%s' has no resolvable model path, so it "
                             "cannot be opened for export." % link_doc.Title)
        return None

    d2 = None
    try:
        d2 = _open_detached(host_doc.Application, model_path, probe)
    except Exception as ex:
        probe.error("links", "could not open '%s': %s" % (link_doc.Title, ex))
        return None

    try:
        return export_ifc(d2, folder, name, probe, schema=schema,
                          links="none")
    finally:
        try:
            d2.Close(False)
        except Exception:
            pass


def collect_native_link_ifcs(folder, host_name, probe):
    """Pick up link IFCs written by Revit's own exporter alongside the host.

    With ExportLinkedFiles set to separate files, Revit writes one IFC per
    link into the same folder, already placed in host coordinates. They are
    moved under links/ and described the same way as fallback exports, with
    coordinates flagged as "host" so the viewer knows not to transform them.
    """
    sub = os.path.join(folder, "links")
    if not os.path.isdir(sub):
        os.makedirs(sub)

    out = []
    host_file = (host_name + ".ifc").lower()
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(".ifc") or fn.lower() == host_file:
            continue
        src = os.path.join(folder, fn)
        dst = os.path.join(sub, fn)
        try:
            if os.path.exists(dst):
                os.remove(dst)
            shutil.move(src, dst)
        except Exception as ex:
            probe.warn("links", "could not move %s into links/: %s" % (fn, ex))
            dst = src

        stem = fn[:-4]
        if stem.lower().startswith(host_name.lower() + "-"):
            stem = stem[len(host_name) + 1:]
        out.append({
            "name": stem,
            "ifc": "links/" + os.path.basename(dst),
            "size_mb": round(os.path.getsize(dst) / 1048576.0, 2),
            "coordinates": "host",
            "exported_by": "revit_native",
            "instances": [],
        })

    if out:
        probe.info("links", "Revit exported %d linked model(s) natively."
                   % len(out))
    return out


# ---------------------------------------------------------------------------
# Merged-link IFC export (the "Export in same IFCProject" option)
# ---------------------------------------------------------------------------

def _link_guid(doc, inst, probe):
    """The IFC GUID the exporter's own dialog gives a link instance.

    The dialog calls GUIDUtil.GetSimpleElementIFCGUID from the exporter's
    Revit.IFC.Common assembly. That same function is called here, from the
    copy Revit has already loaded, so the value is identical by
    construction. Only if that assembly cannot be reached is the GUID
    worked out the documented way, which is what that function does for an
    element with no stored IFC GUID."""
    import System
    for asm in System.AppDomain.CurrentDomain.GetAssemblies():
        try:
            if asm.GetName().Name != "Revit.IFC.Common":
                continue
            t = asm.GetType("Revit.IFC.Common.Utility.GUIDUtil")
            m = t.GetMethod("GetSimpleElementIFCGUID") if t is not None else None
            if m is not None:
                return m.Invoke(None, System.Array[System.Object]([inst]))
        except Exception:
            pass
    try:
        from Autodesk.Revit.DB import BuiltInParameter
        p = inst.get_Parameter(BuiltInParameter.IFC_GUID)
        if p is not None and p.AsString() and len(p.AsString()) == 22:
            return p.AsString()
    except Exception:
        pass
    from lwk_viewer.manifest import ifc_guid
    return ifc_guid(doc, inst)


# Set by batch.export_open_doc from the job: "light" (the default) or "full".
LIGHT = {"on": True}

# ---------------------------------------------------------------------------
# Left out of the 3D model, to keep it small
# ---------------------------------------------------------------------------
#
# Two places do the leaving out, because neither reaches everything:
#   - in Revit, while exporting: elements of these categories are deleted
#     inside the export's own transaction, which is rolled back afterwards
#     (the model is never changed). That also saves export time. It works on
#     the host model and on a linked model opened on its own - but not on a
#     link exported through the host, whose elements Revit will not let a
#     script touch.
#   - in tools/convert.mjs, turning IFC into fragments (what the viewer
#     downloads): elements are recognised by the Revit category Revit writes
#     into each element's properties, or by IFC class. This reaches every
#     file, links included.
# The manifest carries the choice ("ifc_exclude") from one to the other.
#
# key: (label, Revit built-in categories, Revit category names as written in
#       the IFC, IFC classes always left out, IFC classes used only when the
#       file carries no Revit category names)
EXCLUDE_GROUPS = [
    ("furniture", "Furniture and furniture systems",
     ["OST_Furniture", "OST_FurnitureSystems"],
     ["Furniture", "Furniture Systems"], [],
     ["IFCFURNITURE", "IFCSYSTEMFURNITUREELEMENT", "IFCFURNISHINGELEMENT"]),
    ("spaces", "Rooms, areas and spaces",
     ["OST_Rooms", "OST_Areas", "OST_MEPSpaces"],
     ["Rooms", "Areas", "Spaces"], ["IFCSPACE"], []),
    ("openings", "Opening and void boxes (the holes stay cut in the walls)",
     [], [], ["IFCOPENINGELEMENT", "IFCOPENINGSTANDARDCASE", "IFCVOIDINGFEATURE",
              "IFCVIRTUALELEMENT", "IFCANNOTATION"], []),
    ("entourage", "Entourage and planting (people, cars, trees)",
     ["OST_Entourage", "OST_Planting"],
     ["Entourage", "Planting"], [], []),
    ("mass", "Massing",
     ["OST_Mass"], ["Mass"], [], []),
    # Off unless asked for ("ifc_exclude" in the job):
    ("casework", "Casework (kitchen cabinets, wardrobes)",
     ["OST_Casework"], ["Casework"], [], []),
    ("plumbing", "Plumbing fixtures (WCs, basins, sinks)",
     ["OST_PlumbingFixtures"], ["Plumbing Fixtures"], [], ["IFCSANITARYTERMINAL"]),
    ("lighting", "Lighting fixtures",
     ["OST_LightingFixtures", "OST_LightingDevices"],
     ["Lighting Fixtures", "Lighting Devices"], [], ["IFCLIGHTFIXTURE"]),
    ("equipment", "Specialty and mechanical equipment",
     ["OST_SpecialityEquipment", "OST_MechanicalEquipment"],
     ["Specialty Equipment", "Mechanical Equipment"], [], []),
    ("parking", "Parking (car models)",
     ["OST_Parking"], ["Parking"], [], []),
    ("electrical", "Electrical fixtures and equipment",
     ["OST_ElectricalFixtures", "OST_ElectricalEquipment"],
     ["Electrical Fixtures", "Electrical Equipment"], [], []),
]
DEFAULT_EXCLUDE = ["furniture", "spaces", "openings", "entourage", "mass"]
EXCLUDE = {"groups": list(DEFAULT_EXCLUDE)}


def exclude_spec(groups=None):
    """What a list of group keys leaves out, for Revit and for convert.mjs."""
    want = [g for g in (EXCLUDE["groups"] if groups is None else groups)]
    spec = {"groups": [], "labels": [], "revit_bics": [], "revit_categories": [],
            "ifc_classes": [], "fallback_ifc_classes": []}
    for key, label, bics, cats, ifc, fb in EXCLUDE_GROUPS:
        if key not in want:
            continue
        spec["groups"].append(key)
        spec["labels"].append(label)
        spec["revit_bics"].extend(bics)
        spec["revit_categories"].extend(cats)
        spec["ifc_classes"].extend(ifc)
        spec["fallback_ifc_classes"].extend(fb)
    return spec


def _delete_all_or_each(doc, ids, probe, key, what):
    """Delete, inside the open transaction: all at once if Revit allows,
    otherwise one by one, skipping those it refuses (one undeletable element
    used to stop all 507 of YL52's from going). Returns how many went."""
    from Autodesk.Revit.DB import SubTransaction
    st = SubTransaction(doc)
    st.Start()
    try:
        doc.Delete(ids)
        st.Commit()
        return ids.Count
    except Exception:
        st.RollBack()
    gone, refused = 0, 0
    for i in list(ids):
        st = SubTransaction(doc)
        st.Start()
        try:
            doc.Delete(i)
            st.Commit()
            gone += 1
        except Exception:
            st.RollBack()
            refused += 1
    if refused:
        _once(probe, key, "info", "ifc", "%s: %d element(s) left out, %d Revit would not delete"
              % (what, gone, refused))
    return gone


def _delete_excluded(doc, probe, what):
    """Inside an open transaction that will be rolled back: delete the
    elements of the excluded categories, so the exporter never sees them.
    Returns how many went."""
    from Autodesk.Revit.DB import BuiltInCategory, SubTransaction
    spec = exclude_spec()
    if not spec["revit_bics"]:
        return 0
    ids = List[ElementId]()
    for n in spec["revit_bics"]:
        bic = getattr(BuiltInCategory, n, None)
        if bic is None:
            continue
        try:
            for el in FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
                ids.Add(el.Id)
        except Exception:
            continue
    if not ids.Count:
        return 0
    gone = _delete_all_or_each(doc, ids, probe, "excl:" + what, what)
    probe.info("ifc", "%s: %d element(s) left out (%s)"
               % (what, gone, ", ".join(spec["groups"])))
    return gone


# How a linked model placed once is exported: through the host (nothing
# opened, the default) or by opening it on its own (the job option
# "link_route": "open").
LINK_ROUTE = {"via_host": True}


def _ifc_options(schema, probe, view_id=None):
    """The one set of IFC options every export uses. The linked-model
    exports reuse exactly the host's settings - shared coordinates above
    all - because the host's result is the one whose coordinates were
    checked against a Revit spot coordinate. Anything else would be a new
    guess about what the exporter does."""
    opts = IFCExportOptions()
    opts.FileVersion = IFCVersion.IFC4 if schema == "IFC4" else IFCVersion.IFC2x3CV2
    light = LIGHT.get("on", True)
    # Base quantities (areas, volumes per element) are a large share of the
    # file and of the export time, and the viewer never shows them.
    opts.ExportBaseQuantities = not light
    opts.WallAndColumnSplitting = False
    extra = ()
    if light:
        # Viewer-grade geometry: coarser curved surfaces, no 2D annotation
        # in the model. Revit properties are kept - the viewer shows them.
        extra = (("TessellationLevelOfDetail", "0.5"),
                 ("Export2DElements", "false"))
    # A filter view (group sharing: a 3D view boxed round one copy of a
    # typical floor) makes the exporter look at that view's elements only,
    # instead of walking the whole model to find them.
    for key, val in extra + (("SitePlacement", "0"),
                     ("ExportVisibleElementsInView", "true" if view_id is not None else "false"),
                     ("ExportRoomsInView", "false"),
                     ("IncludeSiteElevation", "true"),
                     ("ExportInternalRevitPropertySets", "true"),
                     ("ExportIFCCommonPropertySets", "true"),
                     ("ExportPartsAsBuildingElements", "true"),
                     ("UseFamilyAndTypeNameForReference", "true")):
        try:
            opts.AddOption(key, val)
        except Exception as ex:
            _once(probe, "ifcopt:" + key, "warn", "ifc",
                  "could not set '%s': %s" % (key, ex))
    if view_id is not None:
        opts.FilterViewId = view_id
    return opts


def export_link_document(ld, folder, name, probe, schema):
    """Export one linked model on its own, in its own coordinates.

    A linked document is not an open project, and Revit only lets it be
    exported inside the scope object the exporter's own dialog uses for
    this (IFCCommandOverrideApplication.ExportLinkedDocument). If this
    Revit build lacks that scope the export is tried plainly, and failure
    is reported rather than guessed around."""
    if not os.path.isdir(folder):
        os.makedirs(folder)
    opts = _ifc_options(schema, probe)
    scope = None
    try:
        try:
            from Autodesk.Revit.DB.IFC import IFCLinkDocumentExportScope
            scope = IFCLinkDocumentExportScope(ld)
        except Exception as ex:
            probe.warn("ifc", "no link export scope in this Revit (%s); "
                              "trying a plain export" % ex)
        ld.Export(folder, name, opts)
    except Exception as ex:
        probe.warn("ifc", "could not export linked model '%s' on its own: %s"
                   % (ld.Title, ex))
        return None
    finally:
        if scope is not None:
            try:
                scope.Dispose()
            except Exception:
                pass
    path = os.path.join(folder, name + ".ifc")
    if not os.path.exists(path):
        probe.warn("ifc", "linked model '%s' produced no file" % ld.Title)
        return None
    probe.info("ifc", "exported repeated link '%s' once (%.1f MB)"
               % (ld.Title, os.path.getsize(path) / 1048576.0))
    return path


def _export_open_document(d, folder, name, probe, schema, prepare=None):
    """Plain IFC export of an ordinary open document - no links - in a
    transaction that is rolled back, as the exporter requires. prepare(),
    if given, runs inside that transaction first (group sharing deletes
    there what one file should not hold)."""
    from Autodesk.Revit.DB import Transaction
    if not os.path.isdir(folder):
        os.makedirs(folder)
    from Autodesk.Revit.DB import ElementId as _EId
    t = Transaction(d, "Export IFC")
    try:
        t.Start()
        _delete_excluded(d, probe, name)
        view_id = None
        if prepare is not None:
            got = prepare()
            # prepare() may hand back a view to export from (group files)
            if isinstance(got, _EId):
                view_id = got
        opts = _ifc_options(schema, probe, view_id)
        d.Export(folder, name, opts)
    finally:
        try:
            if t.HasStarted() and not t.HasEnded():
                t.RollBack()
        except Exception:
            pass
    path = os.path.join(folder, name + ".ifc")
    return path if os.path.exists(path) else None


def cloud_or_file_path(ld, probe):
    """Where a linked model's file lives, read from the linked document.

    GetExternalFileReference() only describes links to files on disk; for a
    link to an ACC cloud model it raises "This Element does not represent
    an external file". The linked document itself knows its cloud path
    through GetCloudModelPath() - the same call that already reads the host
    model's path when a job is registered."""
    from Autodesk.Revit.DB import ModelPathUtils
    try:
        if ld.IsModelInCloud:
            return ld.GetCloudModelPath()
    except Exception as ex:
        probe.warn("ifc", "cloud path of '%s' unreadable: %s" % (ld.Title, ex))
    try:
        if ld.PathName:
            return ModelPathUtils.ConvertUserVisiblePathToModelPath(ld.PathName)
    except Exception as ex:
        probe.warn("ifc", "file path of '%s' unreadable: %s" % (ld.Title, ex))
    return None


def _is_cloud(mp):
    try:
        return bool(mp.CloudPath)
    except Exception:
        return False


def export_link_by_opening(host, link_type, mp, folder, name, probe, schema,
                           groups_out=None):
    """Export a linked model by opening its file as a model in its own right.

    Exporting it THROUGH the link cannot work in Revit 2024: a linked
    document is read-only, so the exporter cannot open the transaction it
    needs ("Modifying is forbidden because the document has no open
    transaction"), and the scope object the exporter's dialog uses for this
    does not exist in this version. Opening the file itself is the same
    path already proven on 8450-ARC-TW-1F.

    Opening a file that is also loaded as a link in the same session is
    allowed (proven on the typical floor). The link is never unloaded.
    """
    from Autodesk.Revit.DB import (OpenOptions, DetachFromCentralOption,
                                   WorksetConfiguration, WorksetConfigurationOption)
    app = host.Application
    if mp is None:
        probe.warn("ifc", "no path known for linked model '%s'" % name)
        return None

    def open_it():
        """Detached first: a detached copy is the model's own, so leaving
        things out for the export (group copies, furniture) needs nothing
        from the cloud. Attached, every deleted element has to be borrowed
        from ACC first - slow, and refused outright for anything a
        colleague is working on. If Revit will not detach this model, it is
        opened attached as before."""
        modes = (DetachFromCentralOption.DetachAndPreserveWorksets,
                 DetachFromCentralOption.DoNotDetach)
        if _is_cloud(mp):
            # Revit: "Detach option is not valid for cloud model"
            modes = (DetachFromCentralOption.DoNotDetach,)
        for mode in modes:
            oo = OpenOptions()
            oo.DetachFromCentralOption = mode
            try:
                oo.SetOpenWorksetsConfiguration(
                    WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets))
            except Exception:
                pass
            try:
                d = app.OpenDocumentFile(mp, oo)
            except Exception as ex:
                if "not saved in current release" in str(ex):
                    raise Exception("'%s' is saved in an older Revit version on ACC; Revit "
                                    "only upgrades a cloud model when a person opens it and "
                                    "saves it" % name)
                if mode == DetachFromCentralOption.DoNotDetach:
                    raise
                probe.info("ifc", "'%s': could not open it detached (%s); opening it attached"
                           % (name, ex))
                continue
            probe.info("ifc", "'%s': opened %s, all worksets" % (
                name, "detached" if mode == DetachFromCentralOption.DetachAndPreserveWorksets
                else "attached"))
            return d

    opened = None
    try:
        # Opening a model that is loaded as a link in this session works in
        # Revit 2024 (proven by the test button). No unloading: the earlier
        # fallback was only ever triggered by a cancelled open, and it left
        # Revit reporting that the host could not be opened.
        import time as _time
        t_open = _time.time()
        probe.info("ifc", "'%s': opening it on its own%s ..." % (
            name, " from ACC" if _is_cloud(mp) else ""))
        opened = open_it()
        probe.info("ifc", "'%s': opened in %.1f min; exporting ..." % (
            name, (_time.time() - t_open) / 60.0))

        if groups_out is not None and GROUPS.SETTINGS.get("on", True):
            path, recs = GROUPS.export_shared(
                opened, folder, name, probe,
                lambda f, stem, prep: _export_open_document(opened, f, stem, probe, schema, prep))
            groups_out.extend(recs)
        else:
            path = _export_open_document(opened, folder, name, probe, schema)
        if path:
            probe.info("ifc", "exported repeated link '%s' on its own (%.1f MB)"
                       % (name, os.path.getsize(path) / 1048576.0))
        else:
            probe.warn("ifc", "opening '%s' worked but its export wrote nothing" % name)
        return path
    except Exception as ex:
        probe.warn("ifc", "could not export '%s' on its own: %s" % (name, ex))
        return None
    finally:
        if opened is not None:
            try:
                if opened.IsWorkshared and not getattr(opened, "IsDetached", False):
                    from Autodesk.Revit.DB import (WorksharingUtils, RelinquishOptions,
                                                   TransactWithCentralOptions)
                    WorksharingUtils.RelinquishOwnership(
                        opened, RelinquishOptions(True), TransactWithCentralOptions())
            except Exception:
                pass
            try:
                opened.Close(False)
            except Exception as ex:
                probe.warn("ifc", "could not close '%s': %s" % (name, ex))


def _federated_link_info(doc, probe, exclude=None, quiet=False):
    """The FederatedLinkInfo option, built exactly as Revit's Export dialog
    builds it (IFCCommandOverrideApplication.OnIFCExport in revit-ifc):
    "<instance id>,<IFC GUID>;" for every link instance whose model is
    loaded and whose placement is neither distorted nor scaled. Duplicate
    GUIDs get a "-" appended, as the dialog does."""
    from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
    parts, seen = [], set()
    skipped_unloaded, skipped_bad = 0, 0
    for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        if exclude and inst.Id.IntegerValue in exclude:
            continue
        if inst.GetLinkDocument() is None:
            skipped_unloaded += 1
            continue
        tr = inst.GetTransform()
        if not tr.IsConformal or abs(abs(tr.Determinant) - 1.0) > 1e-6:
            skipped_bad += 1
            continue
        g = _link_guid(doc, inst, probe) or ""
        while g.lower() in seen:
            g += "-"
        seen.add(g.lower())
        parts.append("%s,%s;" % (inst.Id.ToString(), g))
    if quiet:
        return "".join(parts), len(parts)
    probe.info("ifc", "%d link instance(s) will be merged" % len(parts))
    if skipped_unloaded:
        probe.warn("ifc", "%d link instance(s) skipped: their model is not loaded"
                   % skipped_unloaded)
    if skipped_bad:
        probe.warn("ifc", "%d link instance(s) skipped: scaled or distorted placement "
                          "(the exporter refuses these too)" % skipped_bad)
    return "".join(parts), len(parts)


def _repeated_links(doc, skip=None, min_count=2):
    """Linked models placed more than once, with their instances.

    These are what the exporter gets wrong: it hangs a linked model's
    elements on the storeys of the linked file, so every copy of a typical
    floor lands on the same storey and only the horizontal part of each
    placement survives."""
    from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
    groups = {}
    for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        if skip and inst.Id.IntegerValue in skip:
            continue
        ld = inst.GetLinkDocument()
        if ld is None:
            continue
        key = inst.GetTypeId().IntegerValue
        groups.setdefault(key, {"doc": ld, "instances": []})["instances"].append(inst)
    return [g for g in groups.values() if len(g["instances"]) >= min_count]


# Host model categories that are never removed for a link-only export: the
# link instances themselves, and what the IFC needs to place anything.
_KEEP_CATEGORIES = ("OST_RvtLinks", "OST_Levels", "OST_Grids", "OST_ProjectBasePoint",
                    "OST_SharedBasePoint", "OST_IOS_GeoSite", "OST_Cameras",
                    "OST_Viewers", "OST_SunStudy", "OST_Materials")


def _host_geometry_ids(doc, probe):
    """The host's own model elements with geometry (topography, site,
    anything modelled in a layout file) - removed, inside a transaction that
    is rolled back, before a link is exported through the host, so each
    link's file carries only that link. Without this every one of the
    sixteen link files would carry its own copy of the host's topography."""
    from Autodesk.Revit.DB import (BuiltInCategory, CategoryType, RevitLinkInstance)
    def can_delete(i):
        try:
            from Autodesk.Revit.DB import DocumentValidation
            return bool(DocumentValidation.CanDeleteElement(doc, i))
        except Exception:
            return True           # not known: try, and let the delete decide
    keep = set()
    for n in _KEEP_CATEGORIES:
        try:
            keep.add(int(getattr(BuiltInCategory, n)))
        except Exception:
            pass
    ids = List[ElementId]()
    col = FilteredElementCollector(doc).WhereElementIsNotElementType() \
        .WhereElementIsViewIndependent()
    for el in col:
        try:
            if isinstance(el, RevitLinkInstance):
                continue
            cat = el.Category
            if cat is None or cat.CategoryType != CategoryType.Model:
                continue
            if cat.Id.IntegerValue in keep:
                continue
            if el.get_BoundingBox(None) is None:
                continue
            if not can_delete(el.Id):
                continue
            ids.Add(el.Id)
        except Exception:
            continue
    return ids


def export_link_via_host(doc, inst, folder, stem, probe, schema):
    """Export ONE linked model through the host model, without opening it.

    The same call that exports the host with its links merged (Revit's own
    dialog route, see export_ifc_merged), given one link instance only, and
    with the host's own geometry removed for the length of the export. The
    file comes out in the host's coordinates, the link already in place.

    This avoids opening each linked model from ACC as a document of its own
    - the step that sat without a word for hours on YL52's first link."""
    from Autodesk.Revit.DB import Transaction, SubTransaction
    import time as _time
    if not os.path.isdir(folder):
        os.makedirs(folder)
    opts = _ifc_options(schema, probe)
    t = None
    t0 = _time.time()
    try:
        t = Transaction(doc, "Export linked model IFC")
        t.Start()
        fo = t.GetFailureHandlingOptions()
        fo.SetClearAfterRollback(False)
        t.SetFailureHandlingOptions(fo)
        # the host's own geometry out, for this export only
        ids = _host_geometry_ids(doc, probe)
        if ids.Count:
            _delete_all_or_each(doc, ids, probe, "hostgeo",
                                "the host's own geometry (left out of each link file)")
        # every other link out of the export
        from Autodesk.Revit.DB import RevitLinkInstance
        info, n = _federated_link_info(doc, probe, exclude=set(
            i.Id.IntegerValue for i in FilteredElementCollector(doc).OfClass(RevitLinkInstance)
            if i.Id.IntegerValue != inst.Id.IntegerValue), quiet=True)
        if not n:
            probe.warn("ifc", "'%s': this placement cannot be exported through the host "
                              "(not loaded, or scaled)" % stem)
            return None
        opts.AddOption("ExportingLinks", "ExportSameProject")
        opts.AddOption("FederatedLinkInfo", info)
        ok = doc.Export(folder, stem, opts)
        if not ok:
            probe.warn("ifc", "'%s': Revit reported the export as unsuccessful" % stem)
    except Exception as ex:
        probe.warn("ifc", "'%s' could not be exported through the host: %s" % (stem, ex))
        return None
    finally:
        try:
            if t is not None and t.HasStarted() and not t.HasEnded():
                t.RollBack()
        except Exception as ex:
            probe.warn("ifc", "could not roll back: %s" % ex)
    path = os.path.join(folder, stem + ".ifc")
    if not os.path.exists(path) or os.path.getsize(path) < 200:
        probe.warn("ifc", "'%s': no file written through the host" % stem)
        return None
    probe.info("ifc", "'%s' exported through the host model (%.1f MB) in %.1f min"
               % (stem, os.path.getsize(path) / 1048576.0, (_time.time() - t0) / 60.0))
    return path


# Group sharing only pays for itself when it saves real work: opening a
# model on its own costs minutes, so a few small repeated groups are left
# to the ordinary export.
GROUP_MIN_SAVED = 2000


def _group_entries(title, location, link_recs, grecs):
    """Manifest entries for a model's shared groups: each group's file, and
    one placement per copy per placement of the model, in host millimetres
    (the model's placement times the copy's transform within the model)."""
    out = []
    for gr in grecs:
        lo, hi = GROUPS.box_mm(*gr["box_ft"])
        insts = []
        for lr in link_recs:
            L = GROUPS.mat(lr["transform"])
            for c in gr["copies"]:
                M = GROUPS.mul(L, GROUPS.mat(c["rel"]))
                insts.append({"instance_id": c["id"], "transform": GROUPS.unmat(M),
                              "mirrored": False, "bbox_mm": GROUPS.placed_box(M, lo, hi)})
        path = gr["file"]
        out.append({
            "name": "%s - %s" % (title, gr["group"]), "role": "instanced",
            "ifc": "links/" + os.path.basename(path),
            "size_mb": round(os.path.getsize(path) / 1048576.0, 2) if os.path.exists(path) else 0,
            "coordinates": "link-shared", "link_location": location,
            "exported_by": "group_share", "group_of": title,
            "instances": insts,
        })
    return out


def _mark_done(path, route, groups=None, manual=False):
    """A sidecar written only once an IFC is complete: a resumed export
    keeps files that have one, and redoes any a crash left half-written.
    It also remembers the group copies of a group-shared export, so a
    resumed run can list them without exporting again."""
    try:
        import json as _json
        rec = {"route": route}
        if manual:
            rec["manual"] = True
        if groups:
            rec["groups"] = [dict(g, file=os.path.basename(g["file"])) for g in groups]
        from lwk_viewer import jsonio
        jsonio.write_atomic(path + ".ok", rec, indent=0)
    except Exception:
        pass


MANUAL_MAX_DAYS = 14


def link_stem(title):
    """File name used for a linked model's IFC - the same whether the master
    export makes it or Export Link does."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60]


def _manual_export(path):
    """A linked model exported by hand with Export Link (opened in Revit by a
    person, which also upgrades an older cloud model): used by the master
    export for up to MANUAL_MAX_DAYS days. Returns (groups, date) or None."""
    import time as _t
    try:
        import json as _json
        ok = path + ".ok"
        if not (os.path.exists(path) and os.path.exists(ok)):
            return None
        with open(ok) as f:
            rec = _json.loads(f.read() or "{}") or {}
        if not rec.get("manual"):
            return None
        if _t.time() - os.path.getmtime(ok) > MANUAL_MAX_DAYS * 86400:
            return None
        groups = _done_groups(path)
        if groups is None:
            return None
        return groups, _t.strftime("%d %b %H:%M", _t.localtime(os.path.getmtime(ok)))
    except Exception:
        return None


def _done_groups(path):
    try:
        import json as _json
        with open(path + ".ok") as f:
            recs = (_json.loads(f.read() or "{}") or {}).get("groups") or []
        folder = os.path.dirname(path)
        out = []
        for g in recs:
            p = os.path.join(folder, g["file"])
            if not os.path.exists(p):
                return None            # a group file is missing: redo the model
            out.append(dict(g, file=p))
        return out
    except Exception:
        return []


def _done_route(path, since):
    """The route recorded for a complete IFC written after `since`, or None."""
    try:
        import json as _json
        ok = path + ".ok"
        if not (os.path.exists(path) and os.path.exists(ok)):
            return None
        if os.path.getmtime(ok) < since or os.path.getsize(path) < 200:
            return None
        with open(ok) as f:
            return (_json.loads(f.read() or "{}") or {}).get("route") or "own"
    except Exception:
        return None


def export_ifc_merged(doc, folder, name, probe, schema="IFC2x3", instanced_out=None,
                      split=False, resume_since=None):
    """One IFC holding the host and every loaded link, each in place.

    Done the way Revit's own Export dialog does it - read from the dialog's
    source, not from forum posts. Three earlier attempts failed on this:
    IFCExportOptions.AddOption("ExportLinkedFiles", ...) is ignored (the
    exporter never reads that name), and the IFCLinkedDocumentExporter class
    recommended on the API forum does not exist in exporter 24.3. The dialog
    uses neither. It adds two options the documentation never mentions -
    ExportingLinks and FederatedLinkInfo - and calls the ordinary
    Document.Export inside a transaction that it then rolls back.
    """
    from Autodesk.Revit.DB import Transaction
    from lwk_viewer.manifest import project_location, duplicate_link_placements

    # An instance sitting exactly on another instance of the same model is
    # left out of everything: merged, it doubles that model in the IFC;
    # instanced, the viewer loads a second full copy. (The manifest's link
    # table still lists it, marked, with a warning in the log.)
    try:
        dups = duplicate_link_placements(doc)
    except Exception as ex:
        probe.warn("ifc", "could not check for duplicate link placements: %s" % ex)
        dups = {}
    if dups:
        probe.info("ifc", "%d duplicate link instance(s) left out (see 'links' warnings)"
                   % len(dups))

    # Repeated links go out on their own, once each, and the viewer places
    # every copy from Revit's own placements. They are removed from the
    # merged file ONLY when their own export succeeded: if it fails they
    # stay in, collapsed as before, so this can never lose a floor.
    exclude = set(dups)
    # split: EVERY linked model goes out as its own IFC (and becomes its own
    # model in the viewer), not only the repeated ones. Smaller files (the
    # IFC converter cannot take one of several GB), progress that shows,
    # one failed link that does not sink the rest, and a phone that can
    # load the part of the building it is looking at.
    groups = _repeated_links(doc, skip=exclude, min_count=1 if split else 2)
    import time as _time
    for gi, g in enumerate(groups):
        ld = g["doc"]
        title = ld.Title
        t_link = _time.time()
        probe.info("ifc", "link %d of %d: '%s' (%d placement%s) ..."
                   % (gi + 1, len(groups), title, len(g["instances"]),
                      "" if len(g["instances"]) == 1 else "s"))
        stem = link_stem(title)
        links_dir = os.path.join(folder, "links")
        target = os.path.join(links_dir, stem + ".ifc")
        # Everything needed from the link is read now: unloading it to open
        # the file would invalidate this document.
        location = project_location(ld, probe)
        single = len(g["instances"]) == 1
        path, route = None, None
        grecs = []
        kept = _done_route(target, resume_since) if resume_since else None
        man = _manual_export(target)
        if man is not None:
            path, route, grecs = target, "own", man[0]
            kept = "own"
            probe.info("ifc", "'%s': using the export made with Export Link on %s%s"
                       % (title, man[1], (" (%d shared group(s))" % len(grecs)) if grecs else ""))
        elif kept:
            got = _done_groups(target)
            if got is None:
                kept = None
            else:
                path, route, grecs = target, kept, got
                probe.info("ifc", "'%s': kept from the interrupted run" % title)
        # A model whose floors are copies of one group (a typical floor
        # grouped and copied up the building) is opened on its own, so the
        # copies can be left out and placed by the viewer (groups.py);
        # through the host, Revit exports every copy in full.
        share = 0
        if path is None and GROUPS.SETTINGS.get("on", True):
            share = GROUPS.worth_it(ld)
            if share >= GROUP_MIN_SAVED:
                probe.info("ifc", "'%s': about %d elements are copies of repeated groups - "
                                  "opening it to export each group once" % (title, share))
        # One placement: exported through the host, nothing opened. Several
        # placements (a typical floor): the file must be in the link's own
        # coordinates for the viewer to place every copy, so it is opened.
        if path is None and share >= GROUP_MIN_SAVED:
            model_path = cloud_or_file_path(ld, probe)
            link_type = doc.GetElement(g["instances"][0].GetTypeId())
            path = export_link_by_opening(doc, link_type, model_path, links_dir, stem,
                                          probe, schema, groups_out=grecs)
            route = "own" if path else None
            if not path:
                grecs = []
                probe.info("ifc", "'%s': group sharing did not work; exporting it whole" % title)
        if path is None and single and LINK_ROUTE.get("via_host", True):
            probe.info("ifc", "'%s': exporting through the host model (nothing opened) ..." % title)
            path = export_link_via_host(doc, g["instances"][0], links_dir, stem, probe, schema)
            route = "host" if path else None
            if not path:
                probe.info("ifc", "'%s': trying again by opening it on its own ..." % title)
        if path is None:
            model_path = cloud_or_file_path(ld, probe)
            link_type = doc.GetElement(g["instances"][0].GetTypeId())
            path = export_link_by_opening(doc, link_type, model_path,
                                          links_dir, stem, probe, schema)
            route = "own" if path else None
        if path and not kept:
            _mark_done(path, route, grecs)
        if not path:
            if len(g["instances"]) > 1:
                probe.warn("ifc", "'%s' stays in the merged IFC, with its %d copies "
                                  "collapsed onto one storey" % (title, len(g["instances"])))
            else:
                probe.warn("ifc", "'%s' could not be exported on its own; it stays in "
                                  "the host's IFC instead" % title)
            continue
        recs = []
        for inst in g["instances"]:
            tr = inst.GetTotalTransform()
            o = tr.Origin
            recs.append({
                "instance_id": inst.Id.IntegerValue,
                "transform": {
                    "origin": [o.X * 304.8, o.Y * 304.8, o.Z * 304.8],
                    "basis_x": [tr.BasisX.X, tr.BasisX.Y, tr.BasisX.Z],
                    "basis_y": [tr.BasisY.X, tr.BasisY.Y, tr.BasisY.Z],
                    "basis_z": [tr.BasisZ.X, tr.BasisZ.Y, tr.BasisZ.Z],
                },
                "mirrored": bool(tr.HasReflection),
                "bbox_mm": _bbox_mm(inst),
            })
            exclude.add(inst.Id.IntegerValue)
        if instanced_out is not None and route == "host":
            # Already in the host's coordinates, placed by Revit: the viewer
            # applies nothing (bbox_mm still lets light mode load it lazily).
            instanced_out.append({
                "name": title, "role": "link",
                "ifc": "links/" + os.path.basename(path),
                "size_mb": round(os.path.getsize(path) / 1048576.0, 2),
                "coordinates": "host",
                "exported_by": "via_host",
                "instances": recs,
            })
        elif instanced_out is not None:
            instanced_out.append({
                "name": title, "role": "instanced" if len(g["instances"]) > 1 else "link",
                "ifc": "links/" + os.path.basename(path),
                "size_mb": round(os.path.getsize(path) / 1048576.0, 2),
                # How the viewer places it: the file is in this linked
                # model's own shared coordinates; its project location turns
                # those into its internal frame, and each instance transform
                # takes that into the host's internal frame.
                "coordinates": "link-shared",
                "link_location": location,
                "instances": recs,
            })
        if instanced_out is not None and grecs:
            instanced_out.extend(_group_entries(title, location, recs, grecs))
        probe.info("ifc", "'%s': done in %.1f min%s"
                   % (title, (_time.time() - t_link) / 60.0,
                      "; %d copies will be placed by the viewer" % len(recs) if len(recs) > 1 else ""))

    opts = _ifc_options(schema, probe)
    t_host = _time.time()
    probe.info("ifc", "host model%s ..." % (" (links exported separately)" if split else " with links merged"))

    t = None
    try:
        t = Transaction(doc, "Export IFC")
        t.Start()
        fo = t.GetFailureHandlingOptions()
        fo.SetClearAfterRollback(False)
        t.SetFailureHandlingOptions(fo)
        _delete_excluded(doc, probe, doc.Title)

        info, n = _federated_link_info(doc, probe, exclude)
        if n:
            opts.AddOption("ExportingLinks", "ExportSameProject")
            opts.AddOption("FederatedLinkInfo", info)
        elif split:
            probe.info("ifc", "host model on its own (its links are in links/)")
        else:
            probe.warn("ifc", "no loaded links: exporting the host model only")

        ok = doc.Export(folder, name, opts)
        if not ok:
            probe.error("ifc", "Revit reported the export as unsuccessful")
    except Exception as ex:
        probe.error("ifc", "merged export of '%s' failed: %s" % (doc.Title, ex))
        return None
    finally:
        try:
            if t is not None and t.HasStarted() and not t.HasEnded():
                t.RollBack()
        except Exception as ex:
            probe.warn("ifc", "could not roll back: %s" % ex)

    path = os.path.join(folder, name + ".ifc")
    if not os.path.exists(path):
        probe.error("ifc", "export reported success but no file at %s" % path)
        return None
    mb = os.path.getsize(path) / 1048576.0
    probe.info("ifc", "wrote %s (%.1f MB, %s, %s) in %.1f min"
               % (os.path.basename(path), mb, schema,
                  "host only" if split else "links merged", (_time.time() - t_host) / 60.0))
    return path


def _bbox_mm(inst):
    """Where a link instance sits in the host, internal millimetres - the
    viewer's light mode loads the linked models near the view first."""
    try:
        bb = inst.get_BoundingBox(None)
        if bb is None:
            return None
        return [[bb.Min.X * 304.8, bb.Min.Y * 304.8, bb.Min.Z * 304.8],
                [bb.Max.X * 304.8, bb.Max.Y * 304.8, bb.Max.Z * 304.8]]
    except Exception:
        return None
