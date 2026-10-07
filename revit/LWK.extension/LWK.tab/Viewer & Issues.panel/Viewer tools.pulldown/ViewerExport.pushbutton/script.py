# -*- coding: utf-8 -*-
"""Export the model and selected sheets for the external viewer."""

__title__ = "Export\nViewer"
__author__ = "Wilson Chan"

import os
import sys
import json

from pyrevit import revit, forms, script

out = script.get_output()
logger = script.get_logger()


# ---------------------------------------------------------------------------
# Library bootstrap
#
# pyRevit normally puts <extension root>\lib on sys.path by itself, but that
# depends on the extension metadata being current. When the extension lives
# under ACCDocs it can also depend on Desktop Connector having actually
# downloaded the files rather than just showing them. Add the path explicitly
# so the tool does not care either way.
# ---------------------------------------------------------------------------

def _extension_root(start):
    node = os.path.dirname(start)
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:          # reached the drive root
            return None
        node = parent
    return node


EXT_ROOT = _extension_root(__file__)
if EXT_ROOT:
    LIB = os.path.join(EXT_ROOT, "lib")
    if os.path.isdir(LIB) and LIB not in sys.path:
        sys.path.insert(0, LIB)

try:
    from lwk_viewer import manifest, exporters
    from lwk_viewer.probe import Probe
except ImportError as _err:
    pkg = os.path.join(EXT_ROOT or "?", "lib", "lwk_viewer")
    lines = [
        "Cannot load the lwk_viewer library.",
        "",
        "Expected it at:",
        "  %s" % pkg,
        "",
        "Extension root : %s" % (EXT_ROOT or "not found"),
        "Folder exists  : %s" % os.path.isdir(pkg),
    ]
    if os.path.isdir(pkg):
        try:
            names = sorted(os.listdir(pkg))
            lines.append("Contents       : %s" % (", ".join(names) or "(empty)"))
            init = os.path.join(pkg, "__init__.py")
            if os.path.exists(init):
                lines.append("__init__.py    : %d bytes"
                             % os.path.getsize(init))
            else:
                lines.append("__init__.py    : MISSING")
        except Exception as ex:
            lines.append("Could not list folder: %s" % ex)
        lines += [
            "",
            "If the files are listed but show 0 bytes, Desktop Connector has "
            "not downloaded them. Right-click the lib folder in Explorer and "
            "choose 'Always keep on this device', then reload pyRevit.",
        ]
    else:
        lines += [
            "",
            "Copy the lwk_viewer folder into <extension root>\\lib, so that "
            "lib sits alongside your .tab folder, then reload pyRevit.",
        ]
    lines.append("")
    lines.append("Original error: %s" % _err)
    forms.alert("\n".join(lines), title="Viewer Export", exitscript=True)


from Autodesk.Revit.DB import FilteredElementCollector, ViewSheet

doc = revit.doc


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

class SheetOption(forms.TemplateListItem):
    @property
    def name(self):
        return "%s - %s" % (self.item.SheetNumber, self.item.Name)


def pick_sheets():
    sheets = [s for s in FilteredElementCollector(doc).OfClass(ViewSheet)
              if not s.IsPlaceholder]
    sheets.sort(key=lambda s: s.SheetNumber)
    if not sheets:
        forms.alert("This model has no sheets.", exitscript=True)
    return forms.SelectFromList.show(
        [SheetOption(s) for s in sheets],
        title="Sheets to publish",
        multiselect=True,
        button_name="Export",
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if doc.IsFamilyDocument:
        forms.alert("Run this in a project, not a family.", exitscript=True)

    sheets = pick_sheets()
    if not sheets:
        return

    folder = forms.pick_folder(title="Export destination")
    if not folder:
        return

    choice = forms.CommandSwitchWindow.show(
        ["Sheets and manifest only - I exported the IFC myself (recommended)",
         "Separate IFC per link",
         "Model only, no links"],
        message="What should this tool export?")
    if not choice:
        return

    if choice.startswith("Sheets"):
        link_mode = "skip"
    elif choice.startswith("Separate"):
        link_mode = "separate"
    else:
        link_mode = "none"

    sheet_dir = os.path.join(folder, "sheets")
    if not os.path.exists(sheet_dir):
        os.makedirs(sheet_dir)

    probe = Probe(echo=logger.info)
    steps = len(sheets) + 2

    with forms.ProgressBar(title="Exporting", cancellable=True) as pb:
        pb.update_progress(0, steps)

        data = manifest.build(doc, sheets, probe)
        pb.update_progress(1, steps)

        # Host export. With do_links the same call also asks Revit to write
        # each link as its own IFC, already placed in host coordinates.
        # "skip" leaves whatever model.ifc is already in the folder alone.
        # A merged IFC exported from Revit's own dialog resolves every link
        # placement internally, which no AddOption combination reproduced.
        ifc_path = None
        if link_mode == "skip":
            candidate = os.path.join(folder, "model.ifc")
            if os.path.exists(candidate):
                ifc_path = candidate
                probe.info("ifc", "using the existing model.ifc (%.1f MB)"
                           % (os.path.getsize(candidate) / 1048576.0))
            else:
                probe.error("ifc", "no model.ifc in this folder. Export one "
                                   "from Revit's IFC dialog first, or pick a "
                                   "different option.")
        else:
            ifc_path = exporters.export_ifc(doc, folder, "model", probe,
                                            links=link_mode)
        data["models"] = []
        if ifc_path:
            data["model"]["ifc"] = os.path.basename(ifc_path)
            data["model"]["ifc_schema"] = "IFC4"
            data["models"].append({
                "name": doc.Title, "role": "host",
                "ifc": os.path.basename(ifc_path),
                "size_mb": round(os.path.getsize(ifc_path) / 1048576.0, 2),
                "coordinates": "host",
                "instances": [],
            })

        # Only separate mode writes extra IFCs beside the host. In merged
        # mode everything is already inside model.ifc, which is the point.
        native = []
        if link_mode == "separate":
            native = exporters.collect_native_link_ifcs(folder, "model", probe)
            for m in native:
                m["role"] = "link"
                data["models"].append(m)
        pb.update_progress(2, steps)

        # Most of a master file's content lives in links, so this is usually
        # the bulk of the export rather than an extra.
        # Fallback for links Revit did not write natively: reopen each and
        # export it on its own. Slow on cloud projects, so opt-in only.
        if link_mode == "separate":
            for m in exporters.export_link_ifcs(
                    doc, folder, probe, already=[n["name"] for n in native]):
                m["role"] = "link"
                data["models"].append(m)

        if not exporters.pdf_available(doc):
            probe.error("pdf", "this Revit build has no PDFExportOptions; "
                               "sheets were skipped")
        else:
            by_number = dict((s["number"], s) for s in data["sheets"])
            for i, sheet in enumerate(sheets):
                if pb.cancelled:
                    probe.warn("pdf", "cancelled by user")
                    break
                fn = exporters.export_sheet_pdf(doc, sheet, sheet_dir, probe)
                if fn:
                    rec = by_number.get(sheet.SheetNumber)
                    if rec:
                        rec["pdf"] = "sheets/" + fn
                pb.update_progress(3 + i, steps)

    data["probe"] = probe.records
    # the 3D models (and sheets not in this run) already in the folder stay:
    # exporting the sheets after the fast 3D model used to wipe the models out
    manifest.merge_old(folder, data, made_models=bool(data.get("models")), made_sheets=True,
                       keep_other_sheets=True)

    mpath = os.path.join(folder, "manifest.json")
    # jsonio: IronPython's json module fails on any non-ASCII name
    # (a degree or plus-minus sign, an accent, Chinese) - see jsonio.py.
    from lwk_viewer import jsonio
    jsonio.write_atomic(mpath, data)

    c = probe.counts()
    out.print_md("### Export complete")
    out.print_md("- %d sheets, %d elements"
                 % (len(data["sheets"]), len(data["elements"])))
    out.print_md("- manifest: `%s`" % mpath)
    out.print_md("- probe: %d warnings, %d errors" % (c["warn"], c["error"]))

    for r in probe.records:
        if r["level"] != "info":
            out.print_md("  - **%s** `%s` %s"
                         % (r["level"], r["scope"], r["message"]))


main()
