# -*- coding: utf-8 -*-
"""Add shared parameters from a shared parameter file to the CURRENT model
as project parameters, and optionally turn on
'Values can vary by group instance'."""
__title__ = "Add Shared\nParams"

from pyrevit import HOST_APP, revit, forms, script

import arc_params
import arc_ui

doc = revit.doc
app = HOST_APP.app
output = script.get_output()

if doc.IsFamilyDocument:
    forms.alert("This tool is for project files (.rvt), not families.", exitscript=True)

original_sp = app.SharedParametersFilename
try:
    sp_path = arc_ui.pick_shared_parameter_file(app)
    if not sp_path:
        script.exit()
    settings = arc_ui.ask_settings(doc, app, sp_path)
    if not settings:
        script.exit()

    log = arc_params.apply_shared_parameters(
        doc, app, settings["definitions"], settings["category_ids"],
        settings["is_instance"], settings["group"], settings["vary_by_group"])

    output.print_md("## Add shared parameters - %s" % doc.Title)
    arc_ui.print_summary(output, settings)
    arc_ui.print_log(output, doc.Title, log)
finally:
    app.SharedParametersFilename = original_sp
