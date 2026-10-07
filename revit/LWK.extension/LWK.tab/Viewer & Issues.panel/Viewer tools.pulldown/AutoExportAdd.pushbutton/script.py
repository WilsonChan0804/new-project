# -*- coding: utf-8 -*-
"""Register the open ACC model for unattended export to the viewer."""
__title__ = "Add\nModel"
__doc__ = "Record this ACC model so Run Auto-export can export it without anyone opening it."

import os
import sys
from pyrevit import revit, forms, script

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

# pyRevit adds EVERY extension's lib folder to sys.path. If another
# extension also carries a lwk_viewer package - an older copy of this one -
# whichever comes first wins, silently. This button always uses the copy
# that sits beside it: its own lib goes first, and any lwk_viewer already
# imported this session is dropped so it is loaded again from here.
if os.path.isdir(LIB):
    while LIB in sys.path:
        sys.path.remove(LIB)
    sys.path.insert(0, LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]

from lwk_viewer import batch

doc = revit.doc
out = script.get_output()


class SheetItem(forms.TemplateListItem):
    """A sheet in the checklist, shown as 'A001  General Notes'."""
    @property
    def name(self):
        return "%s   %s" % (self.item.SheetNumber, self.item.Name)


class ExcludeItem(forms.TemplateListItem):
    @property
    def name(self):
        return self.item[1]


def choose_exclusions(previous=None):
    """What to leave out of the 3D model. Ticked: the defaults, or what this
    model's job had before. Returns a list of group keys, or None if the
    window was closed."""
    from lwk_viewer import exporters
    ticked = set(exporters.DEFAULT_EXCLUDE if previous is None else previous)
    items = [ExcludeItem(g, checked=(g[0] in ticked)) for g in exporters.EXCLUDE_GROUPS]
    picked = forms.SelectFromList.show(
        items, title="Leave out of the 3D model (smaller, faster to open)",
        multiselect=True, button_name="Use these", width=520, height=460)
    if picked is None:
        return None
    return [g[0] for g in picked]


def choose_sheets(doc, model_guid):
    """Which sheets this model exports. Returns the job fields, or None if
    cancelled. Lists chosen from the checklist can be saved by name and
    picked again for any later registration of the same model."""
    from Autodesk.Revit.DB import FilteredElementCollector, ViewSheet
    saved = batch.load_sheet_lists(model_guid)
    rsets = batch.revit_sheet_sets(doc)
    options = ["All sheets", "Choose from the list"]
    if saved:
        options.append("A saved list (%d)" % len(saved))
    if rsets:
        options.append("A Revit sheet set (%d)" % len(rsets))
    options.append("Numbers starting with...")
    how = forms.CommandSwitchWindow.show(options, message="Which sheets should be exported?")
    if not how:
        return None
    if how == "All sheets":
        return {"sheet_mode": "all"}
    if how.startswith("A saved list"):
        name = forms.CommandSwitchWindow.show(sorted(saved),
            message="Choose a saved list. Editing it later changes what is exported.")
        if not name:
            return None
        return {"sheet_mode": "list", "sheet_list": name, "sheet_numbers": saved[name]}
    if how.startswith("A Revit sheet set"):
        name = forms.CommandSwitchWindow.show(sorted(rsets),
            message="Choose a sheet set from Revit's Print dialog. It is read at every "
                    "export, so changes made to the set in Revit are followed.")
        if not name:
            return None
        return {"sheet_mode": "set", "sheet_set": name}
    if how.startswith("Numbers starting"):
        prefix = forms.ask_for_string(default="A", title="Auto-export",
            prompt="Sheet numbers starting with (comma-separate several, e.g. A, AD):")
        if prefix is None:
            return None
        return {"sheet_mode": "prefix", "sheet_prefix": prefix}

    # Choose from the list: every sheet, ticked if it was in the last list
    last = set()
    for nums in saved.values():
        last.update(nums)
    sheets = sorted([s for s in FilteredElementCollector(doc).OfClass(ViewSheet) if not s.IsPlaceholder],
                    key=lambda s: s.SheetNumber)
    picked = forms.SelectFromList.show(
        [SheetItem(s, checked=(s.SheetNumber in last)) for s in sheets],
        title="Sheets to export (%d in the model)" % len(sheets),
        multiselect=True, button_name="Use these sheets", width=560, height=640)
    if not picked:
        return None
    numbers = [s.SheetNumber for s in picked]
    name = forms.ask_for_string(
        default="Selection %d sheets" % len(numbers), title="Save this list",
        prompt="Name this list to pick it again later (leave empty not to save):")
    if name and name.strip():
        batch.save_sheet_list(model_guid, name.strip(), numbers)
        return {"sheet_mode": "list", "sheet_list": name.strip(), "sheet_numbers": numbers}
    return {"sheet_mode": "list", "sheet_list": "", "sheet_numbers": numbers}


def main():
    ids = batch.cloud_ids(doc)
    if not ids:
        forms.alert("This model is not on ACC. Auto-export opens models from ACC, "
                    "so only cloud models can be added.", exitscript=True)

    if not ids["region"]:
        # Not every Revit version reports it; ask once, it is stored.
        ids["region"] = forms.CommandSwitchWindow.show(
            batch.regions(), message="Which ACC region is this project in?")
        if not ids["region"]:
            return

    root = forms.pick_folder(title="Exports folder (the one holding every project)")
    if not root:
        return
    name = forms.ask_for_string(
        default="".join(c if c.isalnum() or c in "-_" else "-" for c in doc.Title)[:40],
        prompt="Project folder name (letters, digits, - and _ only):",
        title="Auto-export")
    if not name:
        return

    schema = forms.CommandSwitchWindow.show(
        ["IFC2x3", "IFC4"], message="IFC schema (IFC2x3 Coordination View is the most widely supported):")
    if not schema:
        return
    sheet_choice = choose_sheets(doc, ids["model"])
    if sheet_choice is None:
        return

    before = [j for j in batch.load_jobs() if j.get("model") == ids["model"]]
    exclude = choose_exclusions(before[0].get("ifc_exclude") if before else None)
    if exclude is None:
        return
    share = forms.CommandSwitchWindow.show(
        ["Export each group once (recommended)", "Export every copy"],
        message="Typical floors modelled as a group copied to each floor: export the group "
                "once and let the viewer place the copies (much faster), or export every copy?")
    if not share:
        return

    jobs = [j for j in batch.load_jobs() if j.get("model") != ids["model"]]
    # Settings added to the job by hand (upload_project, ifc_detail, ...)
    # are kept when a model is added again.
    job = dict(before[0]) if before else {}
    for k in ("sheet_mode", "sheet_list", "sheet_numbers", "sheet_set", "sheet_prefix"):
        job.pop(k, None)
    jobs.append(job)
    job.update({
        "title": doc.Title, "project": ids["project"], "model": ids["model"],
        "region": ids["region"], "folder": os.path.join(root, name),
        "schema": schema, "ifc_exclude": exclude,
        "group_share": share.startswith("Export each"),
        "tools": batch.DEFAULT_TOOLS, "enabled": True,
    })
    # the Revit it is open in is the one that can open it again at night
    if batch.doc_revit(doc):
        job["revit"] = batch.doc_revit(doc)
    jobs[-1].update(sheet_choice)
    batch.save_jobs(jobs)
    out.print_md("### Added to auto-export")
    out.print_md("- model: **%s**" % doc.Title)
    out.print_md("- exports to: `%s`" % os.path.join(root, name))
    out.print_md("- published by: Revit %s" % (job.get("revit") or "?"))
    out.print_md("- left out of 3D: %s" % (", ".join(exclude) or "nothing"))
    out.print_md("- %d model(s) now registered, in `%s`" % (len(jobs), batch.JOBS_FILE))


main()
