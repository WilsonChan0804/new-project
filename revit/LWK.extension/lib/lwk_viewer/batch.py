# -*- coding: utf-8 -*-
"""Unattended export of ACC cloud models to the viewer.

Revit still does the work - an .rvt can only be read by Revit - but nobody
has to sit and watch it. A model is registered once while it is open
("Add to auto-export"); after that "Run auto-export" opens each registered
model from ACC, exports a merged IFC, the sheet PDFs and the manifest, runs
the fragment conversion, and closes it, one model after another.

Revit refuses to open a cloud model detached ("Detach option is not valid
for cloud model"), so models are opened normally, with every workset open,
and never synchronised. The IFC exporter writes into the model while it
runs and rolls it back afterwards; anything that may have been borrowed on
the way is handed back before closing, so no element is left checked out
in your name to block a colleague. Nothing is saved.
"""

# Printed by the auto-export buttons, so a stale copy is obvious.
__version__ = "2026-10-07a"

import os
import io
import re
import json
import datetime

import System
from Autodesk.Revit.DB import (ModelPathUtils, OpenOptions, DetachFromCentralOption,
                               FilteredElementCollector, ViewSheet,
                               WorksetConfiguration, WorksetConfigurationOption,
                               WorksharingUtils, RelinquishOptions,
                               TransactWithCentralOptions)

JOBS_DIR = os.path.join(os.environ.get("APPDATA", "."), "LWK")
JOBS_FILE = os.path.join(JOBS_DIR, "viewer_jobs.json")
DEFAULT_TOOLS = r"C:\dev\lwk-viewer\tools"


# ------------------------------------------------------------------ jobs

def load_jobs():
    if not os.path.isfile(JOBS_FILE):
        return []
    with open(JOBS_FILE) as f:
        return json.load(f).get("jobs", [])


def save_jobs(jobs):
    if not os.path.isdir(JOBS_DIR):
        os.makedirs(JOBS_DIR)
    # Model titles can hold accented or Chinese characters; see jsonio.
    from lwk_viewer import jsonio
    jsonio.write_atomic(JOBS_FILE, {"jobs": jobs}, sort_keys=False)
    # The night launcher starts one Revit per version that has a model to
    # publish; its list follows the jobs, whoever saves them (every button
    # saves through here). A failure to write it must not lose the save.
    try:
        from lwk_viewer import nightly
        nightly.write_list(jobs)
    except Exception:
        pass


def doc_revit(doc):
    """The Revit version a model is open in, as a job stores it: "2023".
    A cloud model can only be opened again by that same version - Revit
    upgrades one only when a person opens it - so every job keeps it."""
    try:
        v = str(doc.Application.VersionNumber)[:4]
        return v if (len(v) == 4 and v.isdigit()) else ""
    except Exception:
        return ""


def cloud_ids(doc):
    """Project and model GUIDs, and the ACC region, of an open cloud model.
    These are what Revit needs to open it again later without anyone
    browsing to it."""
    if not doc.IsModelInCloud:
        return None
    mp = doc.GetCloudModelPath()
    ids = {"project": str(mp.GetProjectGUID()), "model": str(mp.GetModelGUID()),
           "region": None}
    # The region is exposed differently between Revit versions.
    for getter in (lambda: mp.Region, lambda: mp.GetRegion()):
        try:
            r = getter()
            if r:
                ids["region"] = str(r)
                break
        except Exception:
            pass
    return ids


def regions():
    """The region names this Revit knows, e.g. US, EMEA, APAC."""
    out = []
    for name in dir(ModelPathUtils):
        if name.startswith("CloudRegion"):
            try:
                out.append(str(getattr(ModelPathUtils, name)))
            except Exception:
                pass
    return out or ["US", "EMEA"]


# --------------------------------------------------------------- dialogs

class DialogLog(object):
    """Keeps an unattended run from stopping on warnings, without answering
    dialogs on the user's behalf.

    The first version answered every dialog with button 1. For the warning
    list Revit shows while a model opens (Dialog_Revit_DocWarnDialog) that
    CANCELS the open - a documented Revit behaviour: overriding it with OK
    acts as Cancel. It cancelled the opening of the typical floor.

    Warnings are now dealt with where Revit raises them, in
    FailuresProcessing, so that dialog is never shown at all. Only warnings
    are removed; errors are left alone. Dialogs are no longer answered -
    only written to the log, so a future unattended run can be taught the
    right answer for each from evidence rather than guesswork.
    """

    # Dialogs answered during an unattended export, each with an answer
    # confirmed in Autodesk's API reference and in use elsewhere - never a
    # guess. Custom buttons are numbered from 1001, top to bottom.
    SAFE_ANSWERS = {
        # "Open Manage Links to correct the problem" (1001) or
        # "Ignore and continue opening the project" (1002)
        "TaskDialog_Unresolved_References": (1002, "missing links: continued without them"),
    }

    # Dialogs with no id (DialogId ''), known by their words: the ones a
    # linked or imported DWG raises while a model opens (night of 6 Oct -
    # each waited for someone to click). (pattern, answer, what it means)
    #   6 = Yes, 8 = Close (TaskDialogResult); 1 = OK for a plain message box.
    TEXT_ANSWERS = [
        (re.compile(r"no valid elements in the file's paper space.*import from the model space", re.I | re.S),
         6, "a DWG with an empty paper space: imported its model space (Yes)"),
        (re.compile(r"numerical data within the imported file was out of range", re.I),
         "close", "a DWG with out-of-range numbers: noted, closed"),
        (re.compile(r"some entities were lost during import", re.I),
         "close", "a DWG with entities Revit cannot read: noted, closed"),
    ]

    @staticmethod
    def text_rule(msg, kind):
        """(result, what it means) for a dialog known by its words, else None.
        kind: the event args' type name - a task dialog closes with Close (8),
        a plain message box with OK (1)."""
        for rx, ans, why in DialogLog.TEXT_ANSWERS:
            if rx.search(msg or ""):
                if ans == "close":
                    ans = 8 if kind == "TaskDialogShowingEventArgs" else 1
                return ans, why
        return None

    @staticmethod
    def ok_only(args, kind):
        """A message box whose only button is OK: nothing to choose, so it
        can be dismissed (MB_OK is 0 in the low four bits of DialogType)."""
        if kind != "MessageBoxShowingEventArgs":
            return False
        try:
            return (int(args.DialogType) & 0xF) == 0
        except Exception:
            return False

    def __init__(self, uiapp, probe, answer=False):
        self.uiapp, self.probe = uiapp, probe
        self.app = uiapp.Application
        self.swallowed = 0
        self.answer = answer          # only when nobody is at the PC

    def on_dialog(self, sender, args):
        try:
            did = args.DialogId
            try:
                msg = (args.Message or "").replace("\r", " ").replace("\n", " ")
            except Exception:
                msg = ""
            kind = args.GetType().Name
            rule = self.SAFE_ANSWERS.get(did) if self.answer else None
            if self.answer and not rule:
                rule = self.text_rule(msg, kind)
                if not rule and self.ok_only(args, kind):
                    rule = (1, "a message with only an OK button: closed")
            if rule and args.OverrideResult(rule[0]):
                self.probe.warn("dialog", "answered '%s' - %s%s" % (did or "message", rule[1],
                                (": " + msg[:160]) if msg else ""))
            else:
                # its wording goes in the log, so a rule can be added from
                # what it actually says rather than from a guess
                self.probe.info("dialog", "Revit showed '%s' (left for Revit to handle)%s"
                                % (did, (": " + msg[:200]) if msg else ""))
        except Exception:
            pass

    def on_failures(self, sender, args):
        try:
            from Autodesk.Revit.DB import FailureSeverity, FailureProcessingResult
            fa = args.GetFailuresAccessor()
            n = 0
            for f in list(fa.GetFailureMessages()):
                if f.GetSeverity() == FailureSeverity.Warning:
                    fa.DeleteWarning(f)
                    n += 1
            if n:
                self.swallowed += n
            args.SetProcessingResult(FailureProcessingResult.Continue)
        except Exception as ex:
            self.probe.warn("dialog", "could not process warnings: %s" % ex)

    def __enter__(self):
        self.uiapp.DialogBoxShowing += self.on_dialog
        self.app.FailuresProcessing += self.on_failures
        return self

    def __exit__(self, *a):
        try:
            self.uiapp.DialogBoxShowing -= self.on_dialog
        except Exception:
            pass
        try:
            self.app.FailuresProcessing -= self.on_failures
        except Exception:
            pass
        if self.swallowed:
            self.probe.info("dialog", "%d Revit warning(s) passed over while "
                                      "opening and exporting" % self.swallowed)


# ------------------------------------------------------------------ open

def closed_worksets(doc):
    """Names of the user worksets of an open model that are closed."""
    try:
        if not doc.IsWorkshared:
            return []
        from Autodesk.Revit.DB import FilteredWorksetCollector, WorksetKind
        return [w.Name for w in FilteredWorksetCollector(doc).OfKind(WorksetKind.UserWorkset)
                if not w.IsOpen]
    except Exception:
        return []


def workset_config(path, probe):
    """Every user workset of the model, by name of its id, read from the file
    itself (WorksharingUtils.GetUserWorksetInfo).

    WorksetConfigurationOption.OpenAllWorksets alone was not enough: the
    nightly logs of 6 Oct showed every workset CLOSED after an open that
    asked for all of them - so no host geometry, and none of the links on
    those worksets loaded. Naming each workset to open is the form that
    Revit always honours."""
    try:
        from System.Collections.Generic import List
        from Autodesk.Revit.DB import WorksetId
        infos = list(WorksharingUtils.GetUserWorksetInfo(path))
        if infos:
            cfg = WorksetConfiguration(WorksetConfigurationOption.CloseAllWorksets)
            cfg.Open(List[WorksetId]([w.Id for w in infos]))
            return cfg, len(infos)
    except Exception as ex:
        probe.warn("open", "could not read the model's worksets before opening (%s); "
                           "asking Revit to open all of them" % ex)
    return WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets), None


def open_cloud(app, job, probe):
    path = ModelPathUtils.ConvertCloudGUIDsToCloudPath(
        job["region"], System.Guid(job["project"]), System.Guid(job["model"]))
    # Every workset open. A cloud model otherwise opens with whatever the
    # last user had open, and a closed workset is geometry silently missing
    # from the export - a tower or a podium, in a master model split by
    # workset - and its links are not loaded either.
    # Revit refuses to detach a cloud model ("Detach option is not valid for
    # cloud model"), so a cloud model is opened attached, and nothing is
    # synchronised back (release()).
    doc = None
    for attempt in (1, 2):
        opts = OpenOptions()
        opts.DetachFromCentralOption = DetachFromCentralOption.DoNotDetach
        cfg, n = workset_config(path, probe)
        opts.SetOpenWorksetsConfiguration(cfg)
        probe.info("open", "opening %s from ACC (%s, attached, will not sync)%s"
                   % (job["title"], "all %d worksets by name" % n if n else "all worksets",
                      "" if attempt == 1 else " - second try"))
        try:
            doc = app.OpenDocumentFile(path, opts)
        except Exception as ex:
            if "not saved in current release" in str(ex):
                raise Exception(
                    "this model on ACC is saved in an older Revit version, and Revit only "
                    "upgrades a cloud model when a person opens it. Either open it in this "
                    "Revit, then Shift-click Run Export (exports the open model), or upgrade "
                    "it on ACC once (open, Save / Sync) so the automatic export can open it")
            raise
        closed = closed_worksets(doc)
        if not closed:
            break
        if attempt == 1:
            probe.warn("open", "%d workset(s) still closed after opening (%s): closing the model "
                               "and opening it again" % (len(closed), ", ".join(closed[:6])))
            try:
                release(doc, probe)
                doc.Close(False)
            except Exception as ex:
                probe.warn("open", "could not close it to try again: %s" % ex)
                break
            doc = None
        else:
            probe.error("open", "%d workset(s) are still closed after a second try (%s): the 3D "
                                "model will not be replaced (the viewer keeps the last good one)"
                        % (len(closed), ", ".join(closed[:6])))
    load_links(doc, probe)
    return doc


def load_links(doc, probe):
    """Revit links that did not load with the model (on a workset that was
    closed, or set to unloaded by the last user) are loaded, so they are in
    the 3D model. Only this open copy changes; nothing is synchronised."""
    try:
        from Autodesk.Revit.DB import RevitLinkType
        types = list(FilteredElementCollector(doc).OfClass(RevitLinkType))
    except Exception as ex:
        probe.warn("links", "could not list the links: %s" % ex)
        return
    loaded = failed = 0
    for lt in types:
        try:
            if RevitLinkType.IsLoaded(doc, lt.Id):
                continue
            # a nested link is loaded with its parent
            try:
                if lt.IsNestedLink:
                    continue
            except Exception:
                pass
            res = lt.Load()
            ok = True
            try:
                ok = str(res.LoadResult) == "LinkLoaded"      # LinkLoadResultType
            except Exception:
                pass
            if ok:
                loaded += 1
            else:
                failed += 1
                probe.warn("links", "could not load '%s': %s" % (lt.Name, getattr(res, "LoadResult", "?")))
        except Exception as ex:
            failed += 1
            probe.warn("links", "could not load '%s': %s" % (getattr(lt, "Name", "?"), ex))
    if loaded or failed:
        probe.info("links", "%d link(s) loaded that were not%s"
                   % (loaded, (", %d could not be" % failed) if failed else ""))


def release(doc, probe):
    """Hand back anything borrowed during the export, without synchronising.
    Only ownership goes back to the cloud; no change to the model does."""
    try:
        if not doc.IsWorkshared or getattr(doc, "IsDetached", False):
            return                            # a detached copy borrowed nothing
        ro = RelinquishOptions(True)          # every kind: elements, worksets, views
        WorksharingUtils.RelinquishOwnership(doc, ro, TransactWithCentralOptions())
        probe.info("close", "ownership relinquished, nothing synchronised")
    except Exception as ex:
        probe.warn("close", "could not relinquish ownership: %s" % ex)


SHEET_LISTS = os.path.join(JOBS_DIR, "sheet_lists.json")


def load_sheet_lists(model_guid=None):
    """Named sheet lists, per model: {model guid: {list name: [sheet numbers]}}.
    Saved once, chosen again for any later export of the same model."""
    try:
        with open(SHEET_LISTS) as f:
            data = json.load(f)
    except Exception:
        data = {}
    return data.get(model_guid, {}) if model_guid else data


def save_sheet_list(model_guid, name, numbers):
    data = load_sheet_lists()
    data.setdefault(model_guid, {})[name] = sorted(numbers)
    if not os.path.isdir(JOBS_DIR):
        os.makedirs(JOBS_DIR)
    from lwk_viewer import jsonio
    jsonio.write_atomic(SHEET_LISTS, data)


def revit_sheet_sets(doc):
    """The sheet sets saved in Revit's own Print dialog: {name: [sheet numbers]}."""
    from Autodesk.Revit.DB import ViewSheetSet
    out = {}
    for vs in FilteredElementCollector(doc).OfClass(ViewSheetSet):
        nums = [v.SheetNumber for v in vs.Views if isinstance(v, ViewSheet)]
        if nums:
            out[vs.Name] = sorted(nums)
    return out


def pick_sheets(doc, job, probe=None):
    """The sheets a job exports.

    sheet_mode: "all"; "list" - a named list saved for this model (read at
    export time, so editing the list changes what is exported), falling back
    to the numbers stored in the job; "set" - a Revit sheet set, also read at
    export time; "prefix" - numbers starting with any of the given texts.
    Jobs registered before modes existed carry only a prefix."""
    sheets = [s for s in FilteredElementCollector(doc).OfClass(ViewSheet)
              if not s.IsPlaceholder]
    mode = job.get("sheet_mode") or ("prefix" if (job.get("sheet_prefix") or "").strip() else "all")
    wanted = None
    if mode == "list":
        lists = load_sheet_lists(job.get("model"))
        wanted = lists.get(job.get("sheet_list") or "") or job.get("sheet_numbers") or []
    elif mode == "set":
        wanted = revit_sheet_sets(doc).get(job.get("sheet_set") or "")
        if wanted is None and probe:
            probe.warn("sheets", "Revit sheet set '%s' no longer exists; exporting no sheets"
                       % job.get("sheet_set"))
        wanted = wanted or []
    if wanted is not None:
        have = set(s.SheetNumber for s in sheets)
        missing = [n for n in wanted if n not in have]
        if missing and probe:
            probe.warn("sheets", "%d sheet(s) in the list no longer exist: %s"
                       % (len(missing), ", ".join(missing[:10])))
        want = set(wanted)
        sheets = [s for s in sheets if s.SheetNumber in want]
    elif mode == "prefix":
        pre = [p.strip().upper() for p in (job.get("sheet_prefix") or "").split(",") if p.strip()]
        sheets = [s for s in sheets if any(s.SheetNumber.upper().startswith(w) for w in pre)]
    return sorted(sheets, key=lambda s: s.SheetNumber)


# ------------------------------------------------------------ conversion

def run_convert(folder, tools, probe):
    """IFC to fragments, as convert.bat does - but calling node directly,
    because convert.bat ends with "pause" and would wait for a key press
    that never comes."""
    script = os.path.join(tools, "convert.mjs")
    if not os.path.isfile(script):
        probe.warn("convert", "no convert.mjs in %s; run convert.bat by hand" % tools)
        return False
    psi = System.Diagnostics.ProcessStartInfo("node", '"%s" "%s"' % (script, folder))
    psi.WorkingDirectory = tools
    psi.UseShellExecute = False
    psi.RedirectStandardOutput = True
    psi.RedirectStandardError = True
    psi.CreateNoWindow = True
    try:
        p = System.Diagnostics.Process.Start(psi)
        out = p.StandardOutput.ReadToEnd()
        err = p.StandardError.ReadToEnd()
        p.WaitForExit()
    except Exception as ex:
        probe.error("convert", "could not start node: %s" % ex)
        return False
    for line in (out or "").splitlines()[-6:]:
        probe.info("convert", line)
    if p.ExitCode != 0:
        probe.error("convert", "conversion failed (%d): %s" % (p.ExitCode, (err or "")[-400:]))
        return False
    return True


# ------------------------------------------------------------------ export

def export_open_doc(doc, job, probe, manifest, exporters, progress=None):
    """Everything the viewer needs from one open model, written to
    job["folder"]. Used by the batch run and by the one-model test run, so
    what is tested is exactly what runs overnight."""
    folder = job["folder"]
    sheet_dir = os.path.join(folder, "sheets")
    for d in (folder, sheet_dir):
        if not os.path.isdir(d):
            os.makedirs(d)

    import time
    from lwk_viewer import jsonio
    t0 = time.time()
    resume_since = start_marker(folder, probe)
    # What Publish was set to make for this model (a job added by "Add to
    # auto-export" has neither flag: both, as before). The night run used
    # to make both whatever Publish said.
    do_sheets = job.get("publish_sheets", True) is not False
    do3d = job.get("publish_3d", True) is not False
    probe.info("job", "exporting %s" % " and ".join(
        [w for w, on in (("sheets", do_sheets), ("the 3D model", do3d)) if on] or ["nothing"]))
    sheets = pick_sheets(doc, job, probe) if do_sheets else []
    probe.info("sheets", "%d sheets selected" % len(sheets))
    data = manifest.build(doc, sheets, probe)
    for s in data.get("sheets") or []:
        s.setdefault("source", doc.Title)
    probe.info("time", "reading the model took %.1f min" % ((time.time() - t0) / 60.0))

    # Drawings first: quick, and useful on their own. If the model export
    # then takes all night (or fails), the sheets can already be opened.
    t1 = time.time()
    kept = 0
    if not do_sheets:
        pass
    elif exporters.pdf_available(doc):
        by_number = dict((s["number"], s) for s in data["sheets"])
        for i, sheet in enumerate(sheets):
            fn = None
            if resume_since:
                # A PDF this interrupted export already wrote is kept.
                cand = exporters._safe_name(sheet.SheetNumber) + ".pdf"
                cp = os.path.join(sheet_dir, cand)
                if os.path.exists(cp) and os.path.getmtime(cp) >= resume_since \
                        and os.path.getsize(cp) > 0:
                    fn = cand
                    kept += 1
            if fn is None:
                fn = exporters.export_sheet_pdf(doc, sheet, sheet_dir, probe)
            if fn and sheet.SheetNumber in by_number:
                by_number[sheet.SheetNumber]["pdf"] = "sheets/" + fn
            probe.info("pdf", "%d of %d done" % (i + 1, len(sheets)))
            if progress:
                progress(i + 1, len(sheets))
    else:
        probe.error("pdf", "this Revit build cannot export PDF; sheets skipped")
    if resume_since and kept:
        probe.info("pdf", "%d PDF(s) kept from the interrupted run" % kept)
    probe.info("time", "PDFs took %.1f min" % ((time.time() - t1) / 60.0))
    # A manifest with the sheets (and the previous models, if any) so the
    # drawings are usable before the IFC is done.
    # what this run does not make is kept from the last manifest (the
    # models until the new ones are done; sheets from other publishes)
    manifest.merge_old(folder, data, made_models=False, made_sheets=do_sheets,
                       keep_other_sheets=job.get("keep_other_sheets", True) is not False)
    data["probe"] = probe.records
    try:
        jsonio.write_atomic(os.path.join(folder, "manifest.json"), data)
    except Exception as ex:
        probe.warn("manifest", "could not write the interim manifest: %s" % ex)

    if not do3d:
        probe.info("3d", "3D model not exported (Publish is set to sheets only); the last one is kept")
        end_marker(folder)
        return True

    # A closed workset is a model with parts missing (and links not loaded):
    # never let it replace the last good 3D model in the viewer. The sheets
    # still go.
    closed = closed_worksets(doc)
    if closed:
        probe.error("3d", "3D model NOT exported: %d workset(s) closed (%s). The viewer keeps "
                          "the last good 3D model; the sheets are sent."
                    % (len(closed), ", ".join(closed[:6])))
        job["_3d_failed"] = "worksets closed: " + ", ".join(closed[:6])
        end_marker(folder)
        return True

    schema = job.get("schema", "IFC2x3")
    exporters.LIGHT["on"] = (job.get("ifc_detail") or "light") != "full"
    exporters.LINK_ROUTE["via_host"] = (job.get("link_route") or "host") != "open"
    # Typical floors made of copied groups: export each group once and let
    # the viewer place the copies ("group_share": false turns it off).
    exporters.GROUPS.SETTINGS["on"] = job.get("group_share", True) is not False
    # What is left out of the 3D model; [] keeps everything.
    groups = job.get("ifc_exclude")
    exporters.EXCLUDE["groups"] = list(exporters.DEFAULT_EXCLUDE if groups is None else groups)
    spec = exporters.exclude_spec()
    probe.info("ifc", "left out of the 3D model: %s" % (", ".join(spec["labels"]) or "nothing"))
    if (job.get("model_format") or "ifc") == "lwkm":
        # The fast 3D format: read straight from Revit's renderer, no IFC,
        # no conversion (fast3d.py).
        from lwk_viewer import fast3d
        t2 = time.time()
        res = fast3d.export(doc, folder, probe, exclude_bics=spec["revit_bics"],
                            detail=job.get("fast3d_detail") or "medium",
                            group_share=job.get("group_share", True) is not False,
                            props=job.get("fast3d_props", True) is not False)
        probe.info("time", "fast 3D export took %.1f min" % ((time.time() - t2) / 60.0))
        if not res.get("triangles") and res["models"]:
            # Nothing drawn: an empty model must not replace a good one.
            probe.error("3d", "the 3D export came out EMPTY (0 triangles): nothing is sent, so the "
                              "viewer keeps the last good export. Check that the model's worksets "
                              "and links load when it is opened.")
            job["_3d_failed"] = "the 3D export was empty"
            end_marker(folder)
            return False
        data["models"] = res["models"]
        data["lwk_frame"] = res["lwk_frame"]
        data["probe"] = probe.records
        jsonio.write_atomic(os.path.join(folder, "manifest.json"), data)
        end_marker(folder)
        return bool(res["models"])

    split = bool(job.get("split_links", True))
    probe.info("ifc", "starting: %s detail, %s" % (
        "light" if exporters.LIGHT["on"] else "full",
        "each linked model separately" if split else "links merged into one file"))
    t2 = time.time()
    instanced = []
    ifc = exporters.export_ifc_merged(doc, folder, "model", probe, schema=schema,
                                      instanced_out=instanced, split=split,
                                      resume_since=resume_since)
    probe.info("time", "IFC took %.1f min" % ((time.time() - t2) / 60.0))
    data["models"] = []
    # for tools/convert.mjs, which leaves the same things out of the links
    data["ifc_exclude"] = {k: spec[k] for k in ("groups", "revit_categories",
                                                "ifc_classes", "fallback_ifc_classes")}
    if ifc:
        data["model"]["ifc"] = os.path.basename(ifc)
        data["model"]["ifc_schema"] = schema
        data["models"].append({
            "name": doc.Title, "role": "host", "ifc": os.path.basename(ifc),
            "size_mb": round(os.path.getsize(ifc) / 1048576.0, 2),
            "coordinates": "host", "instances": [],
        })
        # After the host, so the viewer has the host's frame before it
        # places any copy.
        data["models"].extend(instanced)

    data["probe"] = probe.records
    # Written whole or not at all. The old way opened manifest.json first
    # and then failed on the e in "Cafe Kitchen" (Snowdon, sheet K101),
    # leaving a 0-byte manifest that hid the project on the server.
    jsonio.write_atomic(os.path.join(folder, "manifest.json"), data)
    end_marker(folder)
    return ifc is not None


# ------------------------------------------------------------- resuming
#
# export-running.json sits in the export folder while an export runs and is
# removed when it finishes. Found at the start of the next run, it means the
# last one never finished (Revit was closed, crashed or ended from Task
# Manager): the PDFs and linked-model IFCs that run completed are kept,
# and only the rest is done again. Older than a day, it is ignored - the
# model will have changed since.

RUNNING = "export-running.json"
RESUME_MAX_AGE = 24 * 3600


def start_marker(folder, probe):
    import time
    path = os.path.join(folder, RUNNING)
    since = None
    try:
        if os.path.exists(path):
            with io.open(path, encoding="utf-8") as f:
                old = json.load(f) or {}
            first = float(old.get("resume_from") or old.get("started") or 0)
            if first and time.time() - first < RESUME_MAX_AGE:
                since = first
                probe.info("resume", "the last export did not finish; what it completed "
                                     "since %s is kept" % datetime.datetime.fromtimestamp(first)
                           .strftime("%d %b %H:%M"))
        elif since is None:
            since = _unfinished_run(folder)
            if since:
                probe.info("resume", "the last export (started %s) never finished; the "
                                     "files it completed are kept" % datetime.datetime
                           .fromtimestamp(since).strftime("%d %b %H:%M"))
    except Exception:
        since = None
    try:
        now = time.time()
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(u"%s" % json.dumps({"started": now, "resume_from": since or now}))
    except Exception:
        pass
    return since


def _unfinished_run(folder):
    """For exports made before export-running.json existed: the progress
    file of a run that started, with no export-log.txt written after it
    (that log is written at the end of every run that was not killed)."""
    import time
    prog = os.path.join(folder, "export-progress-previous.txt")
    if not os.path.exists(prog):
        return None
    try:
        with io.open(prog, encoding="utf-8", errors="replace") as f:
            first = f.readline()
        stamp = first.strip().rsplit("started", 1)[1].strip()
        started = time.mktime(datetime.datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").timetuple())
    except Exception:
        return None
    if time.time() - started > RESUME_MAX_AGE:
        return None
    log = os.path.join(folder, "export-log.txt")
    if os.path.exists(log) and os.path.getmtime(log) >= started:
        return None
    return started


def end_marker(folder):
    try:
        os.remove(os.path.join(folder, RUNNING))
    except Exception:
        pass


class LiveLog(object):
    """export-progress.txt, written line by line as the export goes, with
    the time of each step. export-log.txt only appears at the very end, so
    a long export that seemed to hang could not be told apart from one that
    was still working. Open this file (Notepad re-reads it) to see which
    step it is on and how long each took."""

    def __init__(self, folder, filename="export-progress.txt"):
        self.path = os.path.join(folder, filename)
        self.t0 = datetime.datetime.now()
        try:
            if not os.path.isdir(folder):
                os.makedirs(folder)
            # The last run's progress is kept beside it: after a hang it is
            # the only record of where that run stopped (and resuming reads
            # its start time).
            if os.path.exists(self.path):
                prev = self.path[:-4] + "-previous.txt"
                try:
                    if os.path.exists(prev):
                        os.remove(prev)
                    os.rename(self.path, prev)
                except Exception:
                    pass
            with io.open(self.path, "w", encoding="utf-8") as f:
                f.write(u"LWK viewer export - started %s\n" % self.t0.strftime("%Y-%m-%d %H:%M:%S"))
        except Exception:
            self.path = None

        self.last = self.last_beat = datetime.datetime.now()
        self._stop = False
        self._start_heartbeat()

    # A heartbeat while Revit is busy in one long call (an IFC export can
    # take an hour and says nothing meanwhile): every few minutes of silence
    # a line saying whether Revit is still working, from its CPU time and
    # memory. Busy CPU = still exporting; near-zero CPU for a long time =
    # stuck, or waiting on a window nobody can see.
    HEARTBEAT_S = 180

    def _start_heartbeat(self):
        try:
            import threading
            t = threading.Thread(target=self._beat)
            t.daemon = True
            t.start()
        except Exception:
            pass

    def _beat(self):
        import time
        try:
            from System.Diagnostics import Process
            from System import Environment
            proc = Process.GetCurrentProcess()
            cores = max(1, Environment.ProcessorCount)
            proc.Refresh()
            cpu0, t0 = proc.TotalProcessorTime.TotalSeconds, time.time()
            idle_since = None
            last_tick = time.time()
            while not self._stop:
                time.sleep(20)
                if self._stop:
                    break
                gap = time.time() - last_tick
                last_tick = time.time()
                if gap > 300:
                    # 20 s asked for, minutes passed: the whole PC stopped
                    self.write("warn", "alive", "the PC was asleep or frozen for %.0f min - "
                               "the export was paused meanwhile (the tool now keeps the PC "
                               "awake; check Windows sleep settings if this repeats)"
                               % (gap / 60.0), beat=True)
                now = datetime.datetime.now()
                quiet = (now - max(self.last, self.last_beat)).total_seconds()
                if quiet < self.HEARTBEAT_S:
                    continue
                self.last_beat = now
                proc.Refresh()
                cpu1, t1 = proc.TotalProcessorTime.TotalSeconds, time.time()
                pct = 100.0 * (cpu1 - cpu0) / max(1.0, (t1 - t0) * cores)
                busy_cores = (cpu1 - cpu0) / max(1.0, t1 - t0)
                cpu0, t0 = cpu1, t1
                mem = proc.WorkingSet64 / 1073741824.0
                if busy_cores < 0.05:
                    idle_since = idle_since or t1
                    idle_min = (t1 - idle_since) / 60.0
                    note = ("Revit is idle (%.0f min) - if this lasts, look for a Revit "
                            "window waiting for an answer" % idle_min)
                else:
                    idle_since = None
                    note = "Revit still working"
                self.write("info", "alive", "%s: CPU %.0f%% (%.1f cores), memory %.1f GB"
                           % (note, pct, busy_cores, mem), beat=True)
        except Exception:
            pass

    def stop(self):
        self._stop = True

    def _still_mine(self):
        try:
            with io.open(self.path, encoding="utf-8", errors="replace") as f:
                return self.t0.strftime("%Y-%m-%d %H:%M:%S") in f.readline()
        except Exception:
            return False

    def write(self, level, scope, message, beat=False):
        if not beat:
            self.last = datetime.datetime.now()
        if not self.path:
            return
        if beat and not self._still_mine():
            self._stop = True          # a newer run owns the file now
            return
        now = datetime.datetime.now()
        mins = (now - self.t0).total_seconds() / 60.0
        try:
            with io.open(self.path, "a", encoding="utf-8", errors="replace") as f:
                f.write(u"%s  +%5.1f min  %-5s %-8s %s\n"
                        % (now.strftime("%H:%M:%S"), mins, level, scope, u"%s" % (message,)))
        except Exception:
            pass


def live(probe, folder, filename="export-progress.txt"):
    """Every probe message also goes to the live progress file."""
    log = LiveLog(folder, filename)
    for level in ("info", "warn", "error"):
        orig = getattr(probe, level, None)
        if orig is None:
            continue

        def wrapped(scope, message, _orig=orig, _level=level):
            _orig(scope, message)
            log.write(_level, scope, message)
        setattr(probe, level, wrapped)
    return log


def keep_awake(on):
    """Stop Windows from sleeping while an export runs (it paused an export
    for 40 minutes one evening). Windows' own call for this, the one video
    players use; the screen may still switch off. Returns True if set."""
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0)
        return bool(ctypes.windll.kernel32.SetThreadExecutionState(flags))
    except Exception:
        return False


def write_log(folder, probe, started):
    lines = ["LWK viewer auto-export", "started  %s" % started,
             "finished %s" % datetime.datetime.now().isoformat(), ""]
    for r in probe.records:
        lines.append("%-5s %-8s %s" % (r["level"], r["scope"], r["message"]))
    try:
        # UTF-8, so accented and Chinese names read correctly everywhere.
        with io.open(os.path.join(folder, "export-log.txt"), "w",
                     encoding="utf-8", errors="replace") as f:
            f.write(u"\n".join(u"%s" % (l,) for l in lines))
    except Exception:
        pass


# ------------------------------------------------------------- reviewing

def job_summary(job, probe=None, started=None, ok=None, how="night"):
    """What a job makes and how it last went, in plain words - uploaded
    with each export (the viewer's Exports page shows it) and shown by the
    Export Jobs button. Nothing secret: no tokens, no passwords."""
    mode = job.get("sheet_mode") or ("prefix" if (job.get("sheet_prefix") or "").strip() else "all")
    sheets = {"all": "all sheets",
              "set": "Revit sheet set '%s'" % (job.get("sheet_set") or ""),
              "list": "a list of %d sheet(s)%s" % (len(job.get("sheet_numbers") or []),
                                                  (" ('%s')" % job["sheet_list"]) if job.get("sheet_list") else ""),
              "prefix": "sheet numbers starting %s" % (job.get("sheet_prefix") or "")}.get(mode, mode)
    fmt = job.get("model_format") or "ifc"
    out = {
        "source": job.get("title") or "",
        "title": job.get("title") or "",
        "pc": os.environ.get("COMPUTERNAME", ""),
        "user": os.environ.get("USERNAME", ""),
        "folder": job.get("folder") or "",
        "server_project": job.get("upload_project") or os.path.basename(os.path.normpath(job.get("folder") or "")),
        "acc_model": job.get("model") or "",
        "acc_project": job.get("project") or "",
        "sheets": (sheets if job.get("publish_sheets", True) is not False else "no sheets"),
        "model_3d": (("fast 3D, %s detail" % (job.get("fast3d_detail") or "medium")) if fmt == "lwkm"
                     else ("IFC, %s" % (job.get("ifc_detail") or "light")))
                    if job.get("publish_3d", True) is not False else "no 3D model",
        "adds_to_project": bool(job.get("publish_part")),
        "nightly": bool(job.get("enabled", False)),
        "how": how,
        "extension": __version__,
        # the Revit version that publishes it ("" = not recorded)
        "revit": str(job.get("revit") or ""),
    }
    try:
        from lwk_viewer import nightly
        if not out["revit"]:
            # an older job: what the night run will use, worked out the same way
            out["revit"] = nightly.job_year(job, nightly.schedule_year(), nightly.local_index())[0]
    except Exception:
        pass
    try:
        from lwk_viewer import nightly
        exists, st = nightly.status()
        out["schedule"] = st if exists else "Not scheduled on %s" % out["pc"]
        sch = nightly.saved_schedule() if exists else {}
        out["night_time"] = sch.get("time") or ""
        out["night_days"] = ("Mon-Fri" if sch.get("weekdays") else "every day") if sch else ""
        if not exists:
            # the job may be ticked, but nothing runs it on this PC
            out["nightly"] = False
    except Exception:
        pass
    if started:
        out["started"] = started
        out["finished"] = datetime.datetime.now().isoformat()
    if ok is not None:
        out["ok"] = bool(ok)
    if probe is not None:
        try:
            c = probe.counts()
            out["errors"], out["warnings"] = c.get("error", 0), c.get("warn", 0)
            out["log"] = ["%s %s %s" % (r["level"], r["scope"], r["message"]) for r in probe.records][-60:]
        except Exception:
            pass
    return out


# ---------------------------------------------------------------- upload

def upload_job(job, probe, summary=None):
    """Send the finished export to the viewer server, so nobody has to copy
    it by hand. Uses the sign-in saved by LWK Issues; the project on the
    server is the export folder's name unless the job says otherwise
    ("upload_project"), and "upload": false switches it off for a job."""
    if job.get("upload") is False:
        return
    try:
        from lwk_viewer import issues as LI
        server, token = LI.upload_settings()
        if not (server and token):
            probe.info("upload", "not uploaded: sign in once in LWK Issues to switch on "
                                 "automatic upload to the viewer server")
            return
        pid = job.get("upload_project") or os.path.basename(os.path.normpath(job["folder"]))
        LI.upload_export(LI.Client(server, token), job["folder"], pid,
                         lambda text: probe.info("upload", text),
                         part={"source": job.get("title") or pid} if job.get("publish_part") else None,
                         job=summary)
    except Exception as ex:
        probe.warn("upload", "upload to the viewer server failed: %s" % ex)


# ------------------------------------------------------------- one job

def run_job(uiapp, job, echo, doc=None, unattended=False):
    """Export one registered model. Used by the Run button and by the nightly
    run, so what is tested by hand is exactly what runs at night.

    doc: an already open model to export instead of opening job's model
    (the Shift-click test). Whatever this opened, it closes: ownership
    handed back, nothing saved, nothing synchronised."""
    from lwk_viewer import manifest, exporters
    from lwk_viewer.probe import Probe
    probe = Probe(echo=echo)
    livelog = live(probe, job["folder"])
    awake = keep_awake(True)
    started = datetime.datetime.now().isoformat()
    opened = None
    ok = False
    job.pop("_3d_failed", None)
    try:
        with DialogLog(uiapp, probe, answer=unattended):
            if doc is None:
                opened = open_cloud(uiapp.Application, job, probe)
                doc = opened
            ok = export_open_doc(doc, job, probe, manifest, exporters)
        if ok:
            if (job.get("model_format") or "ifc") != "lwkm" and job.get("publish_3d", True) is not False:
                run_convert(job["folder"], job.get("tools") or DEFAULT_TOOLS, probe)
            upload_job(job, probe, summary=job_summary(job, probe, started, ok=True))
    except Exception as ex:
        probe.error("job", "%s failed: %s" % (job.get("title"), ex))
    finally:
        if opened is not None:
            release(opened, probe)
            try:
                opened.Close(False)
            except Exception as ex:
                probe.warn("close", "could not close: %s" % ex)
        # one line at the end that says how it went
        failed3d = job.pop("_3d_failed", None)
        if failed3d:
            probe.error("result", "FAILED - %s; the viewer keeps the last good 3D model%s"
                        % (failed3d, " (the sheets were sent)" if ok else ""))
            ok = False
        elif ok:
            probe.info("result", "OK")
        else:
            probe.error("result", "FAILED - see the errors above; nothing was replaced in the viewer")
        write_log(job["folder"], probe, started)
        try:
            livelog.stop()
        except Exception:
            pass
        if awake:
            keep_awake(False)
    return ok, probe.counts()


def run_all(uiapp, echo, unattended=False, jobs=None):
    """Every enabled job, one after another - never two at once: each is
    opened, exported and closed before the next begins. Returns
    [(title, ok, counts)].
    unattended: nobody is at the PC, so known dialogs are answered.
    jobs: the ones to run instead (the night run passes those of this
    Revit's version)."""
    if jobs is None:
        jobs = [j for j in load_jobs() if j.get("enabled", True)]
    results = []
    for i, job in enumerate(jobs):
        echo("## %d of %d: %s" % (i + 1, len(jobs), job.get("title")))
        ok, c = run_job(uiapp, job, echo, unattended=unattended)
        results.append((job.get("title"), ok, c))
    return results
