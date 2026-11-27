# -*- coding: utf-8 -*-
"""Dialogs shared by the ARC Tools shared-parameter buttons."""
import os

from pyrevit import forms, script

import arc_params


def pick_shared_parameter_file(app):
    """Ask for the shared parameter .txt (remembers the last one used)."""
    config = script.get_config("ARCSharedParams")
    saved = config.get_option("sp_path", "")
    if not saved:
        saved = app.SharedParametersFilename or ""

    if saved and os.path.exists(saved):
        answer = forms.alert(
            "Use this shared parameter file?\n\n%s" % saved,
            options=["Use this file", "Choose another file"])
        if answer is None:
            return None
        if answer == "Use this file":
            return saved

    init_dir = os.path.dirname(saved) if saved else None
    path = forms.pick_file(file_ext="txt", init_dir=init_dir,
                           title="Select shared parameter file")
    if path:
        config.sp_path = path
        script.save_config()
    return path


def ask_settings(doc, app, sp_path):
    """Run all the dialogs. Returns a settings dict, or None if cancelled."""
    groups = arc_params.read_shared_parameter_file(app, sp_path)

    # 1. Parameters ---------------------------------------------------------
    by_label = {}
    choices = {}
    for group_name, definitions in groups.items():
        labels = []
        for d in definitions:
            label = "%s   [%s]" % (d.Name, arc_params.spec_label(d))
            if label in by_label:
                label = "%s   (%s)" % (label, group_name)
            by_label[label] = d
            labels.append(label)
        choices[group_name] = labels

    picked = forms.SelectFromList.show(
        choices, title="1/4  Pick shared parameters  -  %s" % sp_path,
        group_selector_title="Shared parameter group:",
        multiselect=True, button_name="Next", width=650, height=650)
    if not picked:
        return None
    definitions = [by_label[label] for label in picked]

    # 2. Categories ---------------------------------------------------------
    cat_by_name = {}
    cat_choices = {}
    for cat_type, cats in arc_params.bindable_categories(doc).items():
        cat_choices[cat_type] = [c.Name for c in cats]
        for c in cats:
            cat_by_name[c.Name] = arc_params.id_value(c.Id)
    picked_cats = forms.SelectFromList.show(
        cat_choices, title="2/4  Pick categories",
        group_selector_title="Category type:",
        multiselect=True, button_name="Next", width=500, height=650)
    if not picked_cats:
        return None
    category_ids = [cat_by_name[n] for n in picked_cats]

    # 3. Instance / type ----------------------------------------------------
    kind = forms.CommandSwitchWindow.show(
        ["Instance", "Type"], message="3/4  Instance or type parameter?")
    if not kind:
        return None
    is_instance = kind == "Instance"

    # 4. Properties group ---------------------------------------------------
    group_label = forms.CommandSwitchWindow.show(
        [g[0] for g in arc_params.GROUP_CHOICES],
        message="4/4  Group the parameter under (Properties palette):")
    if not group_label:
        return None

    vary = False
    if is_instance:
        vary = forms.alert(
            "Turn ON 'Values can vary by group instance'?\n\n"
            "Choose YES so you can edit the value on elements inside model "
            "groups without editing the group (and so DiRoots / schedules can "
            "write to them).",
            yes=True, no=True)

    return {
        "definitions": definitions,
        "category_ids": category_ids,
        "category_names": picked_cats,
        "is_instance": is_instance,
        "group": arc_params.parameter_group(group_label),
        "group_label": group_label,
        "vary_by_group": bool(vary),
    }


def print_summary(output, settings):
    output.print_md("**Parameters:** %s" % ", ".join(d.Name for d in settings["definitions"]))
    output.print_md("**Categories:** %s" % ", ".join(settings["category_names"]))
    output.print_md("**Kind:** %s | **Group:** %s | **Vary by group instance:** %s" % (
        "Instance" if settings["is_instance"] else "Type",
        settings["group_label"],
        "Yes" if settings["vary_by_group"] else "No"))


def print_log(output, title, log):
    output.print_md("### %s" % title)
    output.print_table(table_data=[[name, result] for name, result in log],
                       columns=["Parameter", "Result"])
