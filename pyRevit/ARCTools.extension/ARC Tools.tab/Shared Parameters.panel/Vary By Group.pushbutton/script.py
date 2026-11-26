# -*- coding: utf-8 -*-
"""Turn on 'Values can vary by group instance' for instance project
parameters that are ALREADY in the current model - no need to delete and
re-add them."""
__title__ = "Vary By\nGroup"

from pyrevit import revit, forms, script

import arc_params
import arc_ui

doc = revit.doc
output = script.get_output()

candidates = {}
for name, (definition, binding, guid) in sorted(arc_params.project_parameters(doc).items()):
    if isinstance(binding, arc_params.InstanceBinding) and not definition.VariesAcrossGroups:
        label = "%s%s" % (name, "   (shared)" if guid else "")
        candidates[label] = definition

if not candidates:
    forms.alert("All instance project parameters in this model already vary "
                "by group instance.", exitscript=True)

picked = forms.SelectFromList.show(
    sorted(candidates.keys()),
    title="Instance parameters that do NOT vary by group instance yet",
    multiselect=True, button_name="Turn ON vary by group", width=550, height=650)
if not picked:
    script.exit()

with revit.Transaction("ARC: Allow values to vary by group instance"):
    log = arc_params.set_vary_by_group(doc, [candidates[p] for p in picked])

output.print_md("## Vary by group instance - %s" % doc.Title)
arc_ui.print_log(output, doc.Title, log)
