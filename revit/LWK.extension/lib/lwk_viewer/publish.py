# -*- coding: utf-8 -*-
"""Publish to the LWK Viewer: one run, everything the viewer needs.

The Publish button's window (Publish.pushbutton) collects the choices;
this does the work, in order, for the model open now:

  1. the sheets chosen - PDFs and where each view sits on the paper
  2. the 3D model in the fast format (with its linked models)
  3. one manifest.json holding both (and anything published before that
     this run did not replace - see manifest.merge_old)
  4. the choices kept as this model's job, so the nightly run and the
     next Publish do the same without asking
  5. upload to the viewer server (only what changed)
  6. optionally: the nightly schedule, and the viewer opened in the browser

Nothing about the model is changed or saved.
"""
__version__ = "2026-10-03a"

import io
import json
import os
import time


def default_folder(project):
    base = os.path.join(os.environ.get("USERPROFILE") or os.path.expanduser("~"), "LWK Viewer exports")
    return os.path.join(base, project)


def safe_project(name):
    s = "".join(c if (c.isalnum() or c in "-_") else "-" for c in (name or ""))
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")[:60] or "project"


def job_for(doc, jobs):
    """This model's job: by its ACC ids, else by title."""
    from lwk_viewer import batch
    ids = batch.cloud_ids(doc) or {}
    for j in jobs:
        if ids.get("model") and j.get("model") == ids.get("model"):
            return j, ids
    for j in jobs:
        if not ids.get("model") and j.get("title") == doc.Title and j.get("folder"):
            return j, ids
    return None, ids


def build_job(doc, jobs, opt):
    """This model's job with the window's choices in it (not saved yet)."""
    from lwk_viewer import batch
    job, ids = job_for(doc, jobs)
    job = dict(job or {})
    job.update({"title": doc.Title, "folder": opt["folder"], "upload_project": opt["project"],
                "model_format": "lwkm", "fast3d_detail": opt.get("detail") or "medium",
                "publish_3d": bool(opt.get("do3d")), "publish_sheets": bool(opt.get("dosheets")),
                "keep_other_sheets": bool(opt.get("keep_other_sheets", True)),
                "publish_part": bool(opt.get("part")),
                "upload": bool(opt.get("upload", True))})
    for k in ("sheet_mode", "sheet_list", "sheet_numbers", "sheet_set", "sheet_prefix"):
        job.pop(k, None)
    job["sheet_mode"] = opt.get("sheet_mode") or "all"
    if job["sheet_mode"] == "set":
        job["sheet_set"] = opt.get("sheet_set") or ""
    elif job["sheet_mode"] == "list":
        job["sheet_list"] = ""
        job["sheet_numbers"] = list(opt.get("sheet_numbers") or [])
    if ids:
        job.update({"project": ids.get("project"), "model": ids.get("model"),
                    "region": ids.get("region") or job.get("region")})
    # The Revit it is open in now is the one that can open it at night (a
    # model upgraded since the job was made gets its new version here).
    year = batch.doc_revit(doc)
    if year:
        job["revit"] = year
    return job


def keep_job(jobs, job):
    """Save `job` among this PC's jobs, replacing the one for the same model."""
    from lwk_viewer import batch
    folder = job.get("folder")
    jobs[:] = [j for j in jobs if not (
        (job.get("model") and j.get("model") == job.get("model")) or
        (not job.get("model") and j.get("folder") == folder))]
    jobs.append(job)
    batch.save_jobs(jobs)


def save_settings(doc, opt):
    """Keep the window's choices WITHOUT publishing: the job, the night
    switch and (if asked and not there yet) the night schedule, and tell the
    server so the settings show in everyone's list. Returns (job, lines,
    others) - others: who else already publishes this model at night."""
    from lwk_viewer import batch, autopub
    lines = []
    jobs = batch.load_jobs()
    job = build_job(doc, jobs, opt)
    # here the tick is the whole truth: unticking switches the night export off
    job["enabled"] = bool(opt.get("nightly")) and bool(job.get("model"))
    if opt.get("nightly") and not job.get("model"):
        lines.append("only a model on ACC can be published at night - night export left off")
    for d in (opt["folder"],):
        if not os.path.isdir(d):
            try:
                os.makedirs(d)
            except Exception:
                pass
    keep_job(jobs, job)
    lines.append("settings saved for '%s' -> viewer project '%s'" % (doc.Title, opt["project"]))
    if job["enabled"]:
        lines.extend(autopub.ensure_schedule(opt.get("nightly_time") or "01:00", bool(opt.get("weekdays"))))
    others, note = autopub.report(job)
    if note:
        lines.append(note)
    return job, lines, others


def run(doc, uiapp, opt, echo):
    """opt: project, folder, do3d, detail, dosheets, sheet_mode ("all" |
    "set" | "list"), sheet_set, sheet_numbers, keep_other_sheets, upload,
    nightly, nightly_time, weekdays. Returns (ok, summary lines, url)."""
    from lwk_viewer import batch, exporters, manifest, jsonio
    from lwk_viewer import issues as LI
    from lwk_viewer.probe import Probe

    folder = opt["folder"]
    for d in (folder, os.path.join(folder, "sheets")):
        if not os.path.isdir(d):
            os.makedirs(d)
    probe = Probe(echo=echo)
    livelog = batch.live(probe, folder, "publish-progress.txt")
    awake = batch.keep_awake(True)
    t0 = time.time()
    summary = []
    ok = True
    try:
        jobs = batch.load_jobs()
        job = build_job(doc, jobs, opt)

        with batch.DialogLog(uiapp, probe):
            # 1. sheets
            sheets = batch.pick_sheets(doc, job, probe) if opt.get("dosheets") else []
            probe.info("publish", "'%s' -> %s: %s%s" % (
                doc.Title, opt["project"], ("%d sheet(s)" % len(sheets)) if opt.get("dosheets") else "no sheets",
                ", 3D model" if opt.get("do3d") else ""))
            data = manifest.build(doc, sheets, probe, with_elements=bool(opt.get("dosheets")))
            if sheets:
                if exporters.pdf_available(doc):
                    by_number = dict((s["number"], s) for s in data["sheets"])
                    for i, sheet in enumerate(sheets):
                        fn = exporters.export_sheet_pdf(doc, sheet, os.path.join(folder, "sheets"), probe)
                        if fn and sheet.SheetNumber in by_number:
                            by_number[sheet.SheetNumber]["pdf"] = "sheets/" + fn
                        probe.info("pdf", "%d of %d" % (i + 1, len(sheets)))
                    summary.append("%d sheet(s)" % len(sheets))
                else:
                    probe.error("pdf", "this Revit cannot export PDF; sheets skipped")
                    ok = False
            # 2. the 3D model
            made_models = False
            if opt.get("do3d"):
                from lwk_viewer import fast3d
                groups = job.get("ifc_exclude")
                exporters.EXCLUDE["groups"] = list(exporters.DEFAULT_EXCLUDE if groups is None else groups)
                spec = exporters.exclude_spec()
                res = fast3d.export(doc, folder, probe, exclude_bics=spec["revit_bics"],
                                    detail=opt.get("detail") or "medium",
                                    group_share=job.get("group_share", True) is not False,
                                    props=job.get("fast3d_props", True) is not False)
                data["models"] = res["models"]
                data["lwk_frame"] = res["lwk_frame"]
                made_models = bool(res["models"])
                summary.append("%d 3D model(s)" % len(res["models"]))
                if not made_models:
                    ok = False
            # 3. one manifest
            # which Revit file each sheet comes from: a project can be made of
            # several (drawings in one master, area plans in another)
            for s in data.get("sheets") or []:
                s.setdefault("source", doc.Title)
            manifest.merge_old(folder, data, made_models=made_models, made_sheets=bool(opt.get("dosheets")),
                               keep_other_sheets=bool(opt.get("keep_other_sheets", True)))
            data["probe"] = probe.records
            jsonio.write_atomic(os.path.join(folder, "manifest.json"), data)

        # 4. keep the choices
        # the tick in the window is the truth: unticking switches it off
        job["enabled"] = bool(opt.get("nightly")) and bool(job.get("model"))
        keep_job(jobs, job)

        # 5. upload
        url = None
        server, token = LI.upload_settings()
        if opt.get("upload"):
            if not (server and token):
                probe.warn("upload", "not signed in to the viewer server: sign in in this window, then publish again")
                ok = False
            else:
                LI.upload_export(LI.Client(server, token), folder, opt["project"],
                                 lambda t: probe.info("upload", t),
                                 part={"source": doc.Title} if opt.get("part") else None,
                                 job=batch.job_summary(job, probe, ok=ok, how="publish"))
                summary.append("uploaded to '%s'" % opt["project"])
                page = "model.html" if (opt.get("do3d") and not opt.get("dosheets")) else "index.html"
                url = "%s/%s?project=%s" % (server.rstrip("/"), page, opt["project"])

        # 6. nightly
        if opt.get("nightly"):
            from lwk_viewer import autopub
            if not job.get("model"):
                probe.warn("nightly", "only a model on ACC can be exported at night (it is opened from ACC)")
            else:
                for line in autopub.ensure_schedule(opt.get("nightly_time") or "01:00", bool(opt.get("weekdays"))):
                    summary.append(line)
        # 7. the shared list of everyone's auto-publish settings (the upload
        #    reports the run; this reports the settings, schedule included)
        try:
            from lwk_viewer import autopub
            others, note = autopub.report(job)
            if note and opt.get("upload"):
                probe.info("publish", note)
            for e in others:
                probe.warn("nightly", "this model is ALSO published at night by %s - one of the two should be switched off"
                           % autopub.who_text(e))
        except Exception:
            pass
        probe.info("time", "published in %.1f min" % ((time.time() - t0) / 60.0))
        return ok and not probe.counts()["error"], summary, url
    except Exception as ex:
        probe.error("publish", "failed: %s" % ex)
        return False, summary, None
    finally:
        try:
            livelog.stop()
        except Exception:
            pass
        if awake:
            batch.keep_awake(False)
