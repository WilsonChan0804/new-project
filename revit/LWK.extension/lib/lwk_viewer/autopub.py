# -*- coding: utf-8 -*-
"""Auto-publish settings: reviewed and changed without opening the model.

The settings ("jobs") live on each PC, because Revit on that PC does the
publishing at night. What this adds:

  * a model can be set up from Revit's home screen - it is chosen from the
    ACC models this PC has opened before (Revit keeps a local copy of each;
    its header names the project and the file), so nothing has to be opened;
  * saving the settings is its own step - nothing is exported;
  * every PC reports its settings to the viewer server, so one list shows
    who publishes what, from where and when, and a model that is already
    published at night elsewhere is pointed out BEFORE a second schedule is
    made for it.

It also holds what the window's "Check setup" and "Test night run" buttons
say: check_setup() goes through everything the night export depends on and
answers in plain lines, test_plan() says what a test run will start. Both
only look - nothing is exported, opened or closed.

Nothing here needs an open document; only cached_models() touches the
Revit API, and only to read file headers.
"""
__version__ = "2026-10-03a"

import io
import os
import re

GUID = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ------------------------------------------------- models without opening

def cache_roots():
    """[(Revit year, folder)] - Revit's local copies of cloud models:
    %LOCALAPPDATA%/Autodesk/Revit/Autodesk Revit 2024/CollaborationCache"""
    base = os.path.join(os.environ.get("LOCALAPPDATA") or "", "Autodesk", "Revit")
    out = []
    try:
        names = os.listdir(base)
    except Exception:
        return out
    for n in names:
        m = re.search(r"(20\d\d)", n)
        d = os.path.join(base, n, "CollaborationCache")
        if m and os.path.isdir(d):
            out.append((m.group(1), d))
    return sorted(out, reverse=True)


def _cache_files(roots=None):
    """[(year, project GUID, model GUID, path, mtime)] - every local copy,
    in every Revit version. Layout:
    CollaborationCache/<user id>/<project GUID>/<model GUID>.rvt"""
    out = []
    for year, root in (roots if roots is not None else cache_roots()):
        try:
            users = os.listdir(root)
        except Exception:
            continue
        for u in users:
            ud = os.path.join(root, u)
            if not os.path.isdir(ud):
                continue
            try:
                projects = os.listdir(ud)
            except Exception:
                continue
            for proj in projects:
                pd = os.path.join(ud, proj)
                if not (GUID.match(proj) and os.path.isdir(pd)):
                    continue
                try:
                    files = os.listdir(pd)
                except Exception:
                    continue
                for f in files:
                    stem, ext = os.path.splitext(f)
                    if ext.lower() != ".rvt" or not GUID.match(stem):
                        continue
                    p = os.path.join(pd, f)
                    try:
                        mt = os.path.getmtime(p)
                    except Exception:
                        mt = 0
                    out.append((year, proj.lower(), stem.lower(), p, mt))
    return out


def scan_cache(roots=None):
    """Every cloud model in the cache: [{project, model, path, year, mtime}],
    newest first, one per model (the copy last worked on)."""
    seen = {}
    for year, proj, k, p, mt in _cache_files(roots):
        if k not in seen or mt > seen[k]["mtime"]:
            seen[k] = {"project": proj, "model": k, "path": p, "year": year, "mtime": mt}
    return sorted(seen.values(), key=lambda m: -m["mtime"])


def cache_index(roots=None):
    """{model GUID: {Revit year: its local copy}} - every Revit version in
    which this PC has opened each cloud model. A model found under exactly
    one year tells which Revit an older job (made before jobs recorded
    their version) belongs to; and a job whose version is not among them
    has probably the wrong version."""
    out = {}
    newest = {}
    for year, proj, k, p, mt in _cache_files(roots):
        if (k, year) not in newest or mt > newest[(k, year)]:
            newest[(k, year)] = mt
            out.setdefault(k, {})[year] = p
    return out


def split_cloud_path(text):
    """("Project name", "Model") from 'Autodesk Docs://Project name/Model.rvt'
    (or 'BIM 360://...'); ("", "") if it is not such a path."""
    m = re.match(r"^[^:/\\]+://([^/]+)/(.+)$", (text or "").strip())
    if not m:
        return "", ""
    name = m.group(2).split("/")[-1]
    if name.lower().endswith(".rvt"):
        name = name[:-4]
    return m.group(1), name


def cached_models(limit=300):
    """scan_cache() with the names read from each file's header (no model
    is opened): adds acc_project_name, title, saved_in. A file whose header
    cannot be read keeps an empty title and is listed by its id."""
    models = scan_cache()[:limit]
    try:
        from Autodesk.Revit.DB import BasicFileInfo
    except Exception:
        BasicFileInfo = None
    for m in models:
        m["acc_project_name"], m["title"], m["saved_in"] = "", "", ""
        if BasicFileInfo is None:
            continue
        try:
            info = BasicFileInfo.Extract(m["path"])
            m["acc_project_name"], m["title"] = split_cloud_path(info.CentralPath)
            try:
                m["saved_in"] = str(info.Format or "")
            except Exception:
                pass
        except Exception:
            pass
    return models


def label(m):
    when = ""
    try:
        import datetime
        when = datetime.datetime.fromtimestamp(m["mtime"]).strftime("%d %b %Y")
    except Exception:
        pass
    name = m.get("title") or ("model " + m["model"][:8] + "...")
    proj = m.get("acc_project_name") or ("ACC project " + m["project"][:8] + "...")
    return "%s   -   %s   (opened here %s%s)" % (name, proj, when,
                                                 (", Revit " + m["saved_in"]) if m.get("saved_in") else "")


# ------------------------------------------------------------------ jobs

def default_region(jobs):
    """The ACC region the other jobs use - one office, one region."""
    for j in jobs:
        if j.get("region"):
            return j["region"]
    return "US"


def new_job(m, jobs, project, folder, title=""):
    """A job for a cached model, with the usual choices: all sheets, 3D at
    medium detail, sent to the server, night export off until switched on.
    Its Revit version is the one the local copy was last opened in."""
    job = {"title": title or m.get("title") or m["model"], "folder": folder, "upload_project": project,
           "project": m["project"], "model": m["model"], "region": default_region(jobs),
           "model_format": "lwkm", "fast3d_detail": "medium", "publish_3d": True, "publish_sheets": True,
           "sheet_mode": "all", "keep_other_sheets": True, "publish_part": False, "upload": True,
           "enabled": False}
    if m.get("year"):
        job["revit"] = str(m["year"])
    return job


def find_job(jobs, model):
    for j in jobs:
        if model and (j.get("model") or "").lower() == model.lower():
            return j
    return None


def describe(job):
    """(sheets, 3D) in words, for a list."""
    if job.get("publish_sheets", True) is False:
        sheets = "no sheets"
    else:
        mode = job.get("sheet_mode") or ("prefix" if (job.get("sheet_prefix") or "").strip() else "all")
        sheets = {"all": "all sheets", "set": "set '%s'" % (job.get("sheet_set") or ""),
                  "list": "%d chosen sheet(s)" % len(job.get("sheet_numbers") or []),
                  "prefix": "numbers starting %s" % (job.get("sheet_prefix") or "")}.get(mode, mode)
    if job.get("publish_3d", True) is False:
        model = "no 3D"
    else:
        model = "3D %s" % (job.get("fast3d_detail") or "medium") if (job.get("model_format") or "ifc") == "lwkm" else "3D (IFC)"
    return sheets, model


def year_text(job, sched_year="", index=None):
    """The Revit version as the list shows it: "2023"; "2023 (auto)" for an
    older job whose version was found from this PC's local copies; "?" when
    it is not known - with the Revit that will be tried, the schedule's -
    so it stands out and can be set with Change."""
    from lwk_viewer import nightly
    y, how = nightly.job_year(job, sched_year, index)
    if how == "set":
        return y
    if how == "cache":
        return "%s (auto)" % y
    return "? (%s)" % y if y else "?"


# -------------------------------------------------------------- schedule

def ensure_schedule(hhmm, weekdays_only, replace=False):
    """Make the Windows task if it is not there (or replace it). Lines to show."""
    from lwk_viewer import nightly
    if not TIME.match(hhmm or ""):
        return ["the night time must be HH:MM (e.g. 01:00) - schedule not changed"]
    exists, _ = nightly.status()
    if exists and not replace:
        sch = nightly.saved_schedule()
        # the task runs the same file as before, so an older launcher is
        # brought up to date here without asking Windows for anything
        return ["included in this PC's night export%s" % ((" at " + sch["time"]) if sch.get("time") else "")] \
            + nightly.ensure_launcher()
    good, msg = nightly.schedule(hhmm, weekdays_only=bool(weekdays_only))
    return ["night export scheduled on this PC at %s%s" % (hhmm, " (Mon-Fri)" if weekdays_only else "")] if good \
        else ["could not schedule the night export: %s" % msg]


# ---------------------------------------------------- the server's list

def client():
    from lwk_viewer import issues as LI
    server, token = LI.upload_settings()
    return LI.Client(server, token) if (server and token) else None


def entry(job):
    """What this PC tells the server about a job (no tokens, no log)."""
    from lwk_viewer import batch
    s = batch.job_summary(job, how="settings")
    for k in ("log", "started", "finished", "ok", "errors", "warnings", "how"):
        s.pop(k, None)
    s["nightly"] = bool(job.get("enabled")) and bool(s.get("nightly"))
    return s


def same_model(e, job):
    a, b = (e.get("acc_model") or "").lower(), (job.get("model") or "").lower()
    if a and b:
        return a == b
    return ((e.get("project") or "") == (job.get("upload_project") or "")
            and (e.get("source") or "") == (job.get("title") or ""))


def others_at_night(entries, job):
    """Entries from OTHER PCs / people with the night export on for this model."""
    pc, user = os.environ.get("COMPUTERNAME", ""), os.environ.get("USERNAME", "")
    return [e for e in entries if e.get("nightly") and same_model(e, job)
            and ((e.get("pc") or ""), (e.get("user") or "")) != (pc, user)]


def who_text(e):
    t = e.get("night_time") or ""
    return "%s on %s%s%s" % (e.get("saved_by") or e.get("last_by") or e.get("user") or "someone", e.get("pc") or "?",
                             (" at " + t) if t else "",
                             (" -> viewer project '%s'" % e["project"]) if e.get("project") else "")


def check(job, c=None):
    """(others, note): who else publishes this model at night, read from
    the server BEFORE anything is saved. note explains a failure to ask."""
    c = c or client()
    if c is None:
        return [], "not signed in to the viewer server - cannot check whether someone else already publishes this model"
    try:
        return others_at_night(c.publish_jobs(), job), ""
    except Exception as ex:
        return [], "could not ask the server who else publishes this model: %s" % ex


def report(job, c=None):
    """Tell the server about this job's settings. Returns (others, note)."""
    c = c or client()
    if c is None:
        return [], "not signed in to the viewer server - these settings are not in the shared list yet"
    pid = job.get("upload_project") or ""
    try:
        r = c.put_publish_job(pid, entry(job))
        return list(r.get("others") or []), ""
    except Exception as ex:
        return [], "the shared list on the server was not updated: %s" % ex


def forget(job, c=None):
    """Take this PC's entry for the job off the server's list."""
    c = c or client()
    if c is None:
        return "not signed in - the entry stays in the shared list"
    pc, user = os.environ.get("COMPUTERNAME", ""), os.environ.get("USERNAME", "")
    try:
        n = 0
        for e in c.publish_jobs():
            if same_model(e, job) and ((e.get("pc") or ""), (e.get("user") or "")) == (pc, user):
                c.delete_publish_job(e["key"])
                n += 1
        return "" if n else ""
    except Exception as ex:
        return "could not remove it from the shared list: %s" % ex


# ------------------------------------------------------------ check setup
#
# "It did not run last night" has a dozen possible reasons, most of them
# outside Revit. check_setup() looks at each and says what it found, one
# plain line each, so the reason can be read off instead of guessed:
#
#   OK       as it should be
#   PROBLEM  the night export will not work (for that model) until fixed
#   NOTE     worth knowing; nothing to fix, or cannot be judged from here
#
# setup_facts() collects what is on this PC and on the server; check_setup()
# only reads those facts, so it can be tried with made-up ones.

OK, PROBLEM, NOTE, HEAD, TEXT = "OK", "PROBLEM", "NOTE", "HEAD", "TEXT"
PUBLISHERS = ("publisher", "admin")


def folder_writable(folder):
    """(ok, text): can the export folder be made and written? Tried with a
    small file of its own that is removed again; a folder that does not
    exist yet is not made - the nearest folder above it is tried."""
    if not folder:
        return False, "no export folder is set"
    d, missing = folder, False
    while d and not os.path.isdir(d):
        parent = os.path.dirname(d.rstrip("\\/"))
        if not parent or parent == d:
            return False, "the drive or folder it is on does not exist"
        d, missing = parent, True
    probe = os.path.join(d, ".lwk-write-test-%d.tmp" % os.getpid())
    try:
        with io.open(probe, "w", encoding="utf-8") as f:
            f.write(u"x")
        os.remove(probe)
    except Exception as ex:
        return False, "nothing can be written in %s (%s)" % (d, ex)
    return True, ("does not exist yet; it will be made in %s" % d) if missing else "exists and can be written"


def server_facts(c):
    """What the viewer server says about this sign-in: {"signed_in",
    "error", "server", "name", "site_admin", "accounts", "roles": {project:
    role}, "entries": everyone's publish settings, "entries_error"}."""
    f = {"signed_in": False, "error": "", "server": getattr(c, "base", "") or "", "name": "",
         "site_admin": False, "accounts": True, "roles": {}, "entries": [], "entries_error": ""}
    if c is None:
        f["error"] = "not signed in"
        return f
    try:
        me = c.me() or {}
    except Exception as ex:
        f["error"] = "%s" % ex
        return f
    f["signed_in"] = True
    f["accounts"] = me.get("accounts", True) is not False
    f["site_admin"] = bool(me.get("site_admin")) or not f["accounts"]
    u = me.get("user") or {}
    f["name"] = u.get("name") or u.get("email") or ""
    try:
        for p in c.projects():
            if p.get("id"):
                # a server without accounts (one shared passphrase) gives no
                # roles: whoever is signed in may publish
                f["roles"][p["id"]] = p.get("role") or ("admin" if f["site_admin"] else "")
    except Exception as ex:
        f["error"] = "could not list the projects: %s" % ex
    try:
        f["entries"] = c.publish_jobs()
    except Exception as ex:
        f["entries_error"] = "%s" % ex
    return f


def setup_facts(jobs, c=None):
    """Everything check_setup() judges, read from this PC and the server."""
    from lwk_viewer import nightly
    sch = nightly.saved_schedule()
    index = nightly.local_index()
    sched_year = nightly.schedule_year(sch)
    this_year = nightly.revit_year()
    installed = nightly.installed_revits()
    years = sorted(set(y for y in nightly.plan(jobs, sched_year or this_year, index) if y) | set(installed))
    try:
        task = nightly.status()
    except Exception as ex:
        task = (False, "Windows could not be asked: %s" % ex)
    import datetime
    return {"task": task, "schedule": sch, "sched_year": sched_year, "this_year": this_year,
            "settings": nightly.settings(sch), "bat": nightly.BAT, "bat_exists": os.path.isfile(nightly.BAT),
            "bat_current": nightly.bat_is_current(), "list": nightly.read_list(), "installed": installed,
            "pyrevit": dict((y, nightly.pyrevit_addin(y)) for y in years), "index": index,
            "running": [y for y, exe in nightly.running_revits()], "now": datetime.datetime.now(),
            "writable": folder_writable, "log_tail": nightly.log_tail(8),
            "server": server_facts(c if c is not None else client())}


def _when(mtime):
    try:
        import datetime
        return datetime.datetime.fromtimestamp(mtime).strftime("%d %b %Y")
    except Exception:
        return "?"


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except Exception:
        return 0


def check_setup(jobs=None, c=None, facts=None):
    """[(level, text)] - the checklist of the Check setup button. Nothing is
    exported and nothing is changed. facts: values to use instead of the
    ones setup_facts() reads (tests)."""
    from lwk_viewer import batch, nightly
    jobs = batch.load_jobs() if jobs is None else jobs
    # "complete": the facts given are all there is - this PC is not looked at
    f = {} if (facts or {}).get("complete") else setup_facts(jobs, c)
    f.update(facts or {})
    out = []

    def say(level, text):
        out.append((level, text))

    sch, index, installed = f["schedule"], f["index"], f["installed"]
    # with no schedule on record, jobs that do not say their version go
    # with this Revit - the same rule the launcher's list is written by
    plan_year = f["sched_year"] or f["this_year"]
    plan = nightly.plan(jobs, plan_year, index)
    years = sorted(y for y in plan if y)
    limit = f["settings"]["limit_minutes"]

    # ---- the schedule and the launcher
    say(HEAD, "The schedule on this PC")
    exists, status = f["task"]
    if exists:
        nxt = nightly.next_run(sch, f["now"])
        if sch.get("time"):
            say(OK, "Windows starts the night export %s at %s%s."
                % ("Monday to Friday" if sch.get("weekdays") else "every night", sch["time"],
                   (" - next: %s" % nxt.strftime("%a %d %b %H:%M")) if nxt else ""))
        else:
            say(OK, "Windows has a task for the night export (its time was not set from here).")
        last = [l for l in (status or "").splitlines() if l.lower().startswith("last")]
        if last:
            say(NOTE, "Windows says - %s. (A result of 0 means the launcher ran; what it then did is at the "
                      "end of this list.)" % "; ".join(last))
    else:
        say(PROBLEM, "There is no night schedule on this PC, so nothing is published at night from here. "
                     "Press Set schedule.")
    if not f["bat_exists"]:
        if exists:
            say(PROBLEM, "The launcher file is missing (%s). Press Set schedule to make it again." % f["bat"])
    elif not f["bat_current"]:
        say(PROBLEM, "The launcher file is an older kind: it starts one Revit version only, and nothing at all "
                     "while any Revit is open. Press Set schedule to renew it.")
    else:
        say(OK, "The launcher file is in place and up to date.")
    if not years:
        say(NOTE, "No model has its night export ON, so the launcher has nothing to start.")
    else:
        want = [(y, nightly.exe_for(y, installed).lower()) for y in years]
        have = [(y, (exe or "").lower()) for y, exe in f["list"]["revit"]]
        order = ", then ".join("Revit %s (%d model%s)" % (y, len(plan[y]), "" if len(plan[y]) == 1 else "s")
                               for y in years)
        if not f["bat_current"]:
            pass                    # said above; an older launcher does not read the list at all
        elif want == have:
            say(OK, "At night the launcher starts %s%s." % (order, " - one after the other, never together"
                                                           if len(years) > 1 else ""))
        else:
            say(PROBLEM, "The launcher's list does not match the models: it would start %s, and the models need %s. "
                         "Press Set schedule to write it again."
                % (", ".join("Revit %s" % y for y, exe in have) or "nothing", order))
        if len(years) > 1 or len(installed) > 1:
            say(NOTE, "Models are published one at a time, and Revit versions one after another: each version "
                      "may take up to %s, then the launcher goes on to the next."
                % _hours(limit))
        allowed = int(sch.get("task_hours") or 6) * 60
        if exists and len(years) * limit + 30 > allowed:
            # only bites on a long night, so not a PROBLEM - but worth one click
            say(NOTE, "Windows stops the night export after %d hours, and %d Revit versions may take up to %s each. "
                      "Press Set schedule again: it then asks Windows for enough time."
                % (allowed // 60, len(years), _hours(limit)))
        for y in years:
            if len(plan[y]) * 20 > limit:
                say(NOTE, "Revit %s has %d models to publish within %s. If the last ones are cut short, raise "
                          "\"limit_hours\" in %s." % (y, len(plan[y]), _hours(limit), nightly.SCHEDULE_FILE))

    # ---- each Revit version that has something to publish
    for y in years:
        say(HEAD, "Revit %s - publishes %d model%s" % (y, len(plan[y]), "" if len(plan[y]) == 1 else "s"))
        if y in installed:
            say(OK, "Revit %s is installed (%s)." % (y, installed[y]))
        else:
            say(PROBLEM, "Revit %s is not installed on this PC (looked for %s). Its models cannot be published "
                         "from here: publish them from a PC that has Revit %s, or change their Revit version."
                % (y, nightly.exe_for(y, installed), y))
        if f["pyrevit"].get(y):
            say(OK, "pyRevit is attached to Revit %s." % y)
        elif y in installed:
            say(PROBLEM, "pyRevit is not attached to Revit %s, so nothing happens when the launcher starts it. "
                         "Attach it: run the pyRevit installer again, or in a command window type  "
                         "pyrevit attach master default --installed" % y)
        if y in f["running"]:
            say(NOTE, "Revit %s is open now. At night it has to be closed, or its models are skipped (other "
                      "Revit versions may stay open)." % y)

    # ---- the viewer server
    say(HEAD, "The viewer server")
    sv = f["server"]
    uploads = [j for j in jobs if nightly.wanted(j) and j.get("upload") is not False]
    if sv["signed_in"]:
        say(OK, "Signed in%s%s." % ((" to " + sv["server"]) if sv["server"] else "",
                                    (" as " + sv["name"]) if sv["name"] else ""))
        if sv["error"]:
            say(PROBLEM, "The server %s." % sv["error"])
    elif sv["error"] == "not signed in":
        say(PROBLEM if uploads else NOTE, "Not signed in to the viewer server: models are exported to their folder "
                                          "but not sent. Press Sign in at the top of this window.")
    else:
        say(PROBLEM if uploads else NOTE, "The viewer server did not accept the saved sign-in (%s). Press Change "
                                          "sign-in at the top of this window." % sv["error"])

    # ---- each model with its night export on
    for j in jobs:
        if not j.get("enabled", True):
            continue
        say(HEAD, "Model: %s" % (j.get("title") or "?"))
        if not j.get("model"):
            say(PROBLEM, "Its night export is ON, but it is not a model on ACC, so Revit cannot open it by itself. "
                         "Switch its night export off, or publish the ACC model instead.")
            continue
        y, how = nightly.job_year(j, plan_year, index)
        if how == "set":
            say(OK, "Published by Revit %s." % y)
        elif how == "cache":
            say(NOTE, "No Revit version is recorded for it. Revit %s is used, because that is the only version "
                      "this PC has opened it in. Open Change ... and save to record it." % y)
        elif y:
            say(PROBLEM if len(installed) > 1 else NOTE,
                "No Revit version is recorded for it. It is tried in Revit %s (%s). If the model is saved in "
                "another version it cannot be opened: choose its version with Change ..."
                % (y, "the Revit the schedule was made from" if f["sched_year"] else "this Revit"))
        else:
            say(PROBLEM, "No Revit version is recorded for it: choose it with Change ...")
        missing = [w for w, good in (("the ACC project id", GUID.match(j.get("project") or "")),
                                     ("the ACC model id", GUID.match(j.get("model") or "")),
                                     ("the ACC region", (j.get("region") or "").strip())) if not good]
        if missing:
            say(PROBLEM, "It lacks %s, which Revit needs to open it from ACC. Open the model once and press Save "
                         "settings in Publish (or set the region with Change ...)." % " and ".join(missing))
        else:
            say(OK, "A model on ACC (region %s), so Revit can open it without anyone browsing to it." % j["region"])
        copies = index.get((j.get("model") or "").lower()) or {}
        if y and y in copies:
            say(OK, "It was opened in Revit %s on this PC (local copy of %s)." % (y, _when(_mtime(copies[y]))))
            newer = [o for o in sorted(copies) if o > y and _mtime(copies[o]) > _mtime(copies[y])]
            if newer:
                say(NOTE, "It was opened here more recently in Revit %s (%s). If the model has been upgraded to "
                          "Revit %s, Revit %s can no longer open it: change its version with Change ..."
                    % (newer[-1], _when(_mtime(copies[newer[-1]])), newer[-1], y))
        elif y and copies:
            say(PROBLEM, "It has never been opened in Revit %s on this PC - only in Revit %s. Its Revit version is "
                         "probably wrong: set it with Change ... (a cloud model opens only in the version it is "
                         "saved in)." % (y, " and ".join(sorted(copies))))
        elif y:
            say(NOTE, "This PC has never opened it, in any Revit version, so its version cannot be confirmed. "
                      "Opening it once in Revit %s here proves that this PC and this Autodesk account can." % y)
        good, text = f["writable"](j.get("folder") or "")
        say(OK if good else PROBLEM, "Export folder %s: %s." % (j.get("folder") or "?", text))
        pid = j.get("upload_project") or os.path.basename(os.path.normpath(j.get("folder") or ""))
        if j.get("upload") is False:
            say(NOTE, "It is not sent to the viewer server (that is switched off for this model).")
        elif sv["signed_in"]:
            role = sv["roles"].get(pid)
            if role in PUBLISHERS:
                say(OK, "Viewer project '%s': this sign-in may publish to it (%s)." % (pid, role))
            elif role:
                say(PROBLEM, "Viewer project '%s': this sign-in is a %s there and may not publish. Ask a project "
                             "admin for the publisher role." % (pid, role))
            elif sv["site_admin"]:
                say(NOTE, "Viewer project '%s' is not on the server yet: it is made the first time this model is "
                          "published (this sign-in is a site admin, so it may)." % pid)
            else:
                say(PROBLEM, "Viewer project '%s' is not on the server, or this sign-in is not a member of it. A "
                             "site admin publishes a new project the first time, or adds you to it as publisher."
                    % pid)
        if sv["signed_in"] and not sv["entries_error"]:
            others = others_at_night(sv["entries"], j)
            if others:
                say(PROBLEM, "The same model is ALSO published at night by %s. Two night exports overwrite each "
                             "other on the viewer: switch one of them off."
                    % "; ".join(who_text(e) for e in others))
            else:
                say(OK, "No other PC publishes this model at night.")
        elif sv["signed_in"]:
            say(NOTE, "Could not ask the server whether another PC publishes this model at night (%s)."
                % sv["entries_error"])
    off = [j.get("title") or "?" for j in jobs if not j.get("enabled", True)]
    if off:
        say(HEAD, "Not published at night")
        say(NOTE, "Night export is OFF for: %s. They were not checked." % ", ".join(off))

    # ---- what cannot be seen from here
    say(HEAD, "What cannot be checked from here")
    say(NOTE, "The PC must be switched on at that time. Windows is asked to wake it from sleep, but not from "
              "shut down; a laptop with its lid closed usually does not wake.")
    say(NOTE, "You must stay logged in to Windows (lock the screen with Windows+L, do not sign out): Revit "
              "needs your desktop.")
    say(NOTE, "Each Revit version used must be signed in to Autodesk and find a free licence when it starts - "
              "a sign-in or licence window that nobody answers stops the night.")
    say(NOTE, "The LWK tools must be loaded in each Revit version used: start that Revit once and look for the "
              "LWK tab. (One pyRevit serves every version it is attached to, with the same extensions.)")
    say(NOTE, "To prove the whole chain - launcher, Revit, export, upload, Revit closing - use Test night run.")
    if f["log_tail"]:
        say(HEAD, "What the launcher did last (%s)" % nightly.SCHED_LOG)
        for line in f["log_tail"]:
            say(TEXT, line)

    n = len([1 for level, text in out if level == PROBLEM])
    say(HEAD, "Result")
    say(TEXT, ("%d problem%s to fix - the lines marked PROBLEM above." % (n, "" if n == 1 else "s")) if n
        else "No problem found in what can be checked from here.")
    return out


def _hours(minutes):
    h = minutes / 60.0
    return ("%d hours" % h) if h == int(h) and h != 1 else ("1 hour" if h == 1 else "%d minutes" % minutes)


def problems(lines):
    return len([1 for level, text in lines if level == PROBLEM])


def check_text(lines):
    """The checklist as plain text, one finding per line."""
    out = []
    for level, text in lines:
        if level == HEAD:
            out.extend(["", text, "-" * len(text)])
        elif level == TEXT:
            out.append("   " + text)
        else:
            out.append("%-8s %s" % (level, text))
    return "\n".join(out).strip("\n")


# --------------------------------------------------------- test night run

def test_plan(chosen, jobs=None, facts=None):
    """What a Test night run of the chosen jobs will do, before anything is
    started: {"models": their ACC ids, "versions": [(year, exe, [titles])]
    in the order they are started, "close": the Revit versions that are
    open now and must be closed for it, "wait": how many minutes the
    launcher waits for that, "problems": why it cannot work}."""
    from lwk_viewer import batch, nightly
    jobs = batch.load_jobs() if jobs is None else jobs
    f = facts or {}
    sch = f.get("schedule", None)
    sch = nightly.saved_schedule() if sch is None else sch
    index = f["index"] if "index" in f else nightly.local_index()
    installed = f["installed"] if "installed" in f else nightly.installed_revits()
    running = f["running"] if "running" in f else [y for y, exe in nightly.running_revits()]
    this_year = f.get("this_year") or nightly.revit_year()
    sched_year = nightly.schedule_year(sch) or this_year
    out = {"models": [], "versions": [], "close": [], "problems": [],
           "wait": nightly.settings(sch)["wait_minutes"]}
    by_year = {}
    for j in chosen:
        if not j.get("model"):
            out["problems"].append("'%s' is not a model on ACC, so Revit cannot open it by itself."
                                   % (j.get("title") or "?"))
            continue
        y = nightly.job_year(j, sched_year, index)[0]
        out["models"].append(j["model"].lower())
        by_year.setdefault(y, []).append(j.get("title") or "?")
    for y in sorted(by_year):
        out["versions"].append((y, nightly.exe_for(y, installed), by_year[y]))
        if y not in installed:
            out["problems"].append("Revit %s is not installed on this PC." % y)
        elif not (f["pyrevit"].get(y) if "pyrevit" in f else nightly.pyrevit_addin(y)):
            out["problems"].append("pyRevit is not attached to Revit %s: it would start and do nothing." % y)
        if y in running:
            out["close"].append(y)
    if "" in running and out["versions"] and not out["close"]:
        # Windows would not say which version an open Revit is; the
        # launcher then treats it as the one it needs
        out["close"].append("")
    return out


def test_text(plan, off=()):
    """The words of the Test night run question. off: titles among the
    chosen whose night export is switched off (they run in the test only)."""
    lines = ["This runs the night export NOW, exactly as at night:", ""]
    for y, exe, titles in plan["versions"]:
        lines.append("  Revit %s starts, publishes %s, and closes by itself."
                     % (y, ", ".join("'%s'" % t for t in titles)))
    lines += ["", "A black window shows what is happening. Each model is opened from ACC, published and closed "
                  "without saving or syncing; allow about as long as a normal publish for each."]
    if plan["close"]:
        named = [y for y in plan["close"] if y]
        lines += ["", "%s is open now. After you press Yes: SAVE YOUR WORK AND CLOSE %s yourself - the test waits "
                      "up to %d minutes for that, and starts when it has closed. Nothing is closed or saved for you. "
                      "Other Revit versions may stay open."
                  % (" and ".join("Revit %s" % y for y in named) or "Revit",
                     " and ".join("REVIT %s" % y for y in named) or "REVIT", plan.get("wait") or 10)]
    elif plan["versions"]:
        lines += ["", "%s is not open, so the test starts straight away. The Revit you are in now may stay open."
                  % " and ".join("Revit %s" % y for y, exe, titles in plan["versions"])]
    if off:
        lines += ["", "Night export is OFF for %s: it runs in this test only, and stays off."
                  % ", ".join("'%s'" % t for t in off)]
    if plan["problems"]:
        lines += ["", "BUT, as things are, it cannot work:"] + ["  - " + p for p in plan["problems"]]
        lines += ["", "Start the test anyway?"]
    else:
        lines += ["", "Start the test?"]
    return "\n".join(lines)
