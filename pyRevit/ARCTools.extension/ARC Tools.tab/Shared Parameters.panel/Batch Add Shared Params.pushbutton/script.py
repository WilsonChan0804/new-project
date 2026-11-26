# -*- coding: utf-8 -*-
"""Add the same shared parameters to MANY .rvt files in one go.

Each file is opened in the background, the parameters are bound, then the
file is saved (or, for workshared models, a new local is made, synced with
central and deleted). Close the files in Revit before running."""
__title__ = "Batch Add\nShared Params"

import os
import traceback

from pyrevit import HOST_APP, revit, forms, script

import arc_params
import arc_ui

doc = revit.doc
app = HOST_APP.app
output = script.get_output()

files = forms.pick_file(file_ext="rvt", multi_file=True,
                        title="Select the Revit files to update")
if not files:
    script.exit()

forms.alert(
    "%d file(s) selected.\n\n"
    "- BACK UP the files first.\n"
    "- Files from an older Revit version will be UPGRADED when saved.\n"
    "- Workshared models: nobody else should be working in them; a temporary "
    "local is created, synced with central, then deleted.\n\n"
    "The categories list in the next steps comes from the model open now."
    % len(files), ok=False, yes=True, no=True, exitscript=True)

open_paths = set(d.PathName.lower() for d in app.Documents if d.PathName)

original_sp = app.SharedParametersFilename
try:
    sp_path = arc_ui.pick_shared_parameter_file(app)
    if not sp_path:
        script.exit()
    settings = arc_ui.ask_settings(doc, app, sp_path)
    if not settings:
        script.exit()

    output.print_md("## Batch add shared parameters")
    arc_ui.print_summary(output, settings)

    done, failed = 0, 0
    with forms.ProgressBar(title="Updating {value} of {max_value}",
                           cancellable=True) as bar:
        for i, path in enumerate(files):
            if bar.cancelled:
                output.print_md("**Cancelled by user.**")
                break
            bar.update_progress(i, len(files))
            name = os.path.basename(path)
            if path.lower() in open_paths:
                arc_ui.print_log(output, name, [("-", "SKIPPED - file is open in Revit; "
                                                      "close it or use 'Add Shared Params'")])
                failed += 1
                continue
            try:
                log = arc_params.process_file(app, path, settings)
                done += 1
            except Exception as ex:
                log = [("-", "ERROR: %s" % ex)]
                print(traceback.format_exc())
                failed += 1
            arc_ui.print_log(output, name, log)

    output.print_md("---\n**Finished: %d ok, %d skipped/failed.**" % (done, failed))
finally:
    app.SharedParametersFilename = original_sp
