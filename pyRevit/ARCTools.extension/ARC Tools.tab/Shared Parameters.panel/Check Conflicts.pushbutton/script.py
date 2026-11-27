# -*- coding: utf-8 -*-
"""Find shared parameters in a model that clash with the shared parameter
file - the cause of 'cannot be added ... because it conflicts with the
existing name ... and type ...' when loading groups, families or links.

TYPE conflict : same GUID, different data type (e.g. Text vs Number)
NAME conflict : same name, different GUID
Nothing is changed - this only reports."""
__title__ = "Check\nConflicts"

import os
import traceback

from pyrevit import HOST_APP, revit, forms, script

import arc_params
import arc_ui

app = HOST_APP.app
output = script.get_output()

mode = forms.CommandSwitchWindow.show(
    ["Current model", "Several files (opened read-only, nothing saved)"],
    message="What do you want to check?")
if not mode:
    script.exit()

files = None
if mode.startswith("Several"):
    files = forms.pick_file(file_ext="rvt", multi_file=True,
                            title="Select the Revit files to check (include group files)")
    if not files:
        script.exit()

check_families = forms.alert(
    "Also find which loaded families contain the conflicting parameters?\n\n"
    "(Slower: each suspect family is opened in the background.)",
    yes=True, no=True)


def report(title, conflicts):
    output.print_md("### %s" % title)
    if not conflicts:
        output.print_md(":white_heavy_check_mark: No conflicts with the shared parameter file.")
        return
    rows = []
    for c in conflicts:
        if c["kind"] == "TYPE":
            problem = "Same GUID, model = **%s**, file = **%s**" % (c["model_type"], c["file_type"])
        else:
            problem = "Same name, different GUID (model %s, file %s)" % (c["guid"], c["file_guid"])
        rows.append([c["name"], c["kind"], problem,
                     "Yes" if c["project_param"] else "No",
                     ", ".join(c["families"]) or ("-" if check_families else "not checked")])
    output.print_table(table_data=rows, columns=[
        "Parameter", "Conflict", "Details", "Project parameter?", "Families containing it"])


original_sp = app.SharedParametersFilename
try:
    sp_path = arc_ui.pick_shared_parameter_file(app)
    if not sp_path:
        script.exit()
    groups = arc_params.read_shared_parameter_file(app, sp_path)
    output.print_md("## Shared parameter conflicts vs %s" % os.path.basename(sp_path))

    if files is None:
        report(revit.doc.Title, arc_params.find_conflicts(revit.doc, groups, check_families))
    else:
        open_paths = set(d.PathName.lower() for d in app.Documents if d.PathName)
        with forms.ProgressBar(title="Checking {value} of {max_value}", cancellable=True) as bar:
            for i, path in enumerate(files):
                if bar.cancelled:
                    break
                bar.update_progress(i, len(files))
                name = os.path.basename(path)
                if path.lower() in open_paths:
                    output.print_md("### %s\nSKIPPED - open in Revit; check it with "
                                    "'Current model'." % name)
                    continue
                try:
                    doc = arc_params.open_read_only(app, path)
                    try:
                        report(name, arc_params.find_conflicts(doc, groups, check_families))
                    finally:
                        doc.Close(False)
                except Exception as ex:
                    output.print_md("### %s\nERROR: %s" % (name, ex))
                    print(traceback.format_exc())
finally:
    app.SharedParametersFilename = original_sp
