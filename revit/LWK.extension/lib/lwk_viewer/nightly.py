# -*- coding: utf-8 -*-
"""Unattended nightly export.

How a night runs:

  1. Windows Task Scheduler starts LWK_nightly.bat (the launcher) at the
     set time.
  2. The launcher reads LWK_nightly_versions.txt: one line for every Revit
     version that has a model to publish, oldest first. For each version in
     turn: if THAT version of Revit is open - someone is working late, or
     left models open - it is skipped and the log says so (open work is
     never disturbed; another version being open does not matter, each
     version keeps its own local files). Otherwise the launcher writes a
     flag file for that version, starts that Revit and waits until it has
     closed before it goes on to the next version.
  3. When Revit starts, this extension's startup script finds a fresh flag
     for ITS version, removes it, and waits until Revit is idle and signed
     in to Autodesk.
  4. It then publishes the models that belong to this Revit version, one
     after another - the same routine as the Run Auto-export button -
     writes a summary for the night, and closes Revit.

So nothing ever runs side by side: one model at a time inside a Revit, one
Revit version at a time.

A cloud model can only be opened by the Revit version it is saved in (Revit
upgrades a cloud model only when a person opens it), which is why every job
carries its version ("revit": "2023") and why one launcher starts several
Revits.

The flag must be fresh (written within the last few hours), so starting
Revit by hand the next morning after a night where Revit never came up
does not suddenly begin an export.

Needs, and cannot provide itself: the PC switched on at that time (the task
asks Windows to wake it), the user logged in to Windows (Revit needs a
desktop session; a locked screen is fine), Revit signed in to Autodesk, a
free Revit licence, and pyRevit attached to every Revit version used (or
nothing happens when that Revit starts).

Files, all in %APPDATA%/LWK:
  LWK_nightly.bat            the launcher (the same text on every PC)
  LWK_nightly_versions.txt   what it starts; rewritten here whenever the
                             jobs or the schedule are saved
  LWK_nightly_test.txt       the same for the "Test night run" button, with
                             the models chosen for the test
  run_jobs_on_start_<year>.flag   written by the launcher, taken by Revit
  nightly_schedule.json      time, days, the Revit the schedule was made
                             from, and the launcher's limits
  nightly/scheduler.log      what the launcher decided
  nightly/<date>.log         what Revit did
  nightly/dialogs.log        the dialogs the launcher's watcher closed or
                             saw (see _WATCH below)
"""

import os
import io
import re
import ntpath
import datetime

import System

__version__ = "2026-10-07a"

BASE = os.path.join(os.environ.get("APPDATA", "."), "LWK")
# The launcher before 2026-10-03 wrote this one flag and started one Revit.
# It is still honoured, so a PC keeps working until its launcher is renewed.
FLAG = os.path.join(BASE, "run_jobs_on_start.flag")
LOG_DIR = os.path.join(BASE, "nightly")
SCHED_LOG = os.path.join(LOG_DIR, "scheduler.log")
BAT = os.path.join(BASE, "LWK_nightly.bat")
# the dialog watcher the launcher starts next to each Revit (_WATCH)
WATCH_FILE = os.path.join(BASE, "LWK_dialog_watch.ps1")
LIST = os.path.join(BASE, "LWK_nightly_versions.txt")
TEST_LIST = os.path.join(BASE, "LWK_nightly_test.txt")
TASK = "LWK Viewer Nightly Export"
SCHEDULE_FILE = os.path.join(BASE, "nightly_schedule.json")
# How long a flag counts. It was 3 hours; the launcher now starts Revit the
# moment it has written the flag and takes the flag away again if Revit does
# not use it, so an hour is ample - and a flag left behind (the launcher's
# window closed by hand) can start an export in a Revit opened by a person
# for that much less time.
FRESH_HOURS = 1.0

# The launcher's limits; any of them can be set in nightly_schedule.json.
#   limit_hours     how long one Revit version may take before the launcher
#                   stops waiting for it and goes on to the next version
#   pickup_minutes  how long Revit may take to start and take up the export
#                   (longer means the LWK tools are not loaded in it, or it
#                   is waiting at a sign-in window)
#   wait_minutes    Test night run only: how long to wait for an open Revit
#                   to be closed
#   kill_at_limit   end the Revit the launcher itself started when it runs
#                   over. Off: an export that is only slow is allowed to
#                   finish, and ending Revit abruptly skips handing back
#                   what the export borrowed on ACC. A Revit the launcher
#                   did not start is never touched either way.
DEFAULTS = {"limit_hours": 3.0, "pickup_minutes": 15, "wait_minutes": 10, "kill_at_limit": False}

BAT_MARK = "REM LWK-LAUNCHER 3"
YEAR = re.compile(r"^20\d\d$")
_ANY_YEAR = re.compile(r"(20\d\d)")
_FLAG_NAME = re.compile(r"^run_jobs_on_start_(20\d\d)\.flag$", re.I)


def _ensure(folder):
    if not os.path.isdir(folder):
        os.makedirs(folder)


def _remove(path):
    try:
        if os.path.isfile(path):
            os.remove(path)
    except Exception:
        pass


# ---------------------------------------------------------------- flag

def flag_path(year):
    """The flag the launcher writes for one Revit version."""
    return os.path.join(BASE, "run_jobs_on_start_%s.flag" % year)


def _fresh(path):
    try:
        age = (datetime.datetime.now()
               - datetime.datetime.fromtimestamp(os.path.getmtime(path))).total_seconds()
    except Exception:
        return False
    return age < FRESH_HOURS * 3600


def flag_is_fresh():
    """The old launcher's single flag."""
    return os.path.isfile(FLAG) and _fresh(FLAG)


def launcher_busy():
    """Is the night launcher running now? A fresh flag of any Revit version,
    or a "launcher started" in its log with no "launcher finished" after it
    (within the last 12 hours)."""
    try:
        for name in os.listdir(BASE):
            if _FLAG_NAME.match(name) and _fresh(os.path.join(BASE, name)):
                return True
    except Exception:
        pass
    if flag_is_fresh():
        return True
    try:
        if (datetime.datetime.now() - datetime.datetime.fromtimestamp(os.path.getmtime(SCHED_LOG))).total_seconds() > 12 * 3600:
            return False
        with io.open(SCHED_LOG, encoding="utf-8", errors="replace") as f:
            tail = f.read()[-20000:]
        return tail.rfind("launcher started") > tail.rfind("launcher finished")
    except Exception:
        return False


def remove_flag():
    _remove(FLAG)


def _flag_mode(path):
    """"test" or "night": the first word the launcher wrote in the flag."""
    try:
        with io.open(path, encoding="utf-8", errors="replace") as f:
            word = (f.read(40).split() or [""])[0].lower()
    except Exception:
        word = ""
    return "test" if word == "test" else "night"


def take_flag(year, sched_year=""):
    """Was THIS Revit (year) started by the launcher? Returns "night",
    "test" or "" - and removes the flag it answers for, so it counts once.

    A fresh flag for another version is left alone: that Revit is on its
    way up and will take it. Stale flags are cleared whatever their year,
    so a night where Revit never came up leaves nothing behind."""
    mode = ""
    own = flag_path(year)
    if os.path.isfile(own):
        if _fresh(own):
            mode = _flag_mode(own)
        _remove(own)
    if os.path.isfile(FLAG):
        if not _fresh(FLAG):
            _remove(FLAG)
        elif not sched_year or sched_year == year:
            # the old launcher starts the Revit the schedule was made from
            _remove(FLAG)
            mode = mode or "night"
    try:
        for name in os.listdir(BASE):
            m = _FLAG_NAME.match(name)
            if m and m.group(1) != year and not _fresh(os.path.join(BASE, name)):
                _remove(os.path.join(BASE, name))
    except Exception:
        pass
    return mode


# ----------------------------------------------------------------- log

class NightLog(object):
    """One file per night, plus the lines each export writes to its own
    export-log.txt as usual. Every Revit version of the night writes to the
    same file, one after the other."""

    def __init__(self):
        _ensure(LOG_DIR)
        self.path = os.path.join(LOG_DIR, datetime.date.today().isoformat() + ".log")

    def __call__(self, line):
        try:
            with io.open(self.path, "a", encoding="utf-8") as f:
                f.write(u"%s  %s\n" % (datetime.datetime.now().strftime("%H:%M:%S"),
                                        line if isinstance(line, type(u"")) else line.decode("utf-8", "replace")))
        except Exception:
            pass


def log_tail(n=12):
    """The last lines of the launcher's log (scheduler.log)."""
    try:
        with io.open(SCHED_LOG, encoding="utf-8", errors="replace") as f:
            lines = [l.rstrip() for l in f.read().splitlines() if l.strip()]
        return lines[-n:]
    except Exception:
        return []


# ------------------------------------------------------ Revit versions

def revit_exe():
    """The Revit that is running this code."""
    try:
        return System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName
    except Exception:
        return r"C:\Program Files\Autodesk\Revit 2024\Revit.exe"


def year_in(text):
    """"2023" from 'C:\\Program Files\\Autodesk\\Revit 2023' (or ""). The
    year beside the word Revit wins over any other number in the path."""
    m = re.search(r"Revit[ _-]?(20\d\d)", text or "", re.I) or _ANY_YEAR.search(text or "")
    return m.group(1) if m else ""


def revit_year(uiapp=None):
    """The version of this Revit as a job stores it: "2023"."""
    try:
        v = str(uiapp.Application.VersionNumber)[:4]
        if YEAR.match(v):
            return v
    except Exception:
        pass
    if uiapp is None:
        try:                                  # called from a button: pyRevit knows
            from pyrevit import HOST_APP
            v = str(HOST_APP.version)[:4]
            if YEAR.match(v):
                return v
        except Exception:
            pass
    return year_in(ntpath.dirname(revit_exe()))


def _years():
    # Revit 2019 is the first with cloud models opened by their ids; two
    # years ahead covers a release installed before this code is renewed
    return range(2019, datetime.date.today().year + 3)


def _program_dirs():
    out = []
    for k in ("ProgramW6432", "ProgramFiles"):
        v = os.environ.get(k)
        if v and v not in out:
            out.append(v)
    return out or [r"C:\Program Files"]


def _registry_revits(registry=None):
    """[(year, exe)] as Windows' registry has them - where Revit was
    installed somewhere unusual. Never raises: a key that is missing or may
    not be read simply adds nothing. Every path is checked on disk by the
    caller, so a stale entry does no harm."""
    out = []
    try:
        if registry is None:
            from Microsoft.Win32 import Registry as registry
        hklm = registry.LocalMachine
    except Exception:
        return out

    def sub(key, name):
        try:
            return key.OpenSubKey(name)
        except Exception:
            return None

    def names(key):
        try:
            return [u"%s" % n for n in key.GetSubKeyNames()]
        except Exception:
            return []

    def value(key, name):
        try:
            v = key.GetValue(name)
            return (u"%s" % v).strip() if v else u""
        except Exception:
            return u""

    def close(key):
        try:
            key.Close()
        except Exception:
            pass

    # Autodesk's own keys: SOFTWARE\Autodesk\Revit\<... 2023 ...>\<product>
    root = sub(hklm, r"SOFTWARE\Autodesk\Revit")
    if root is not None:
        for n in names(root):
            m = _ANY_YEAR.search(n)
            k = sub(root, n) if m else None
            if k is None:
                continue
            keys = [k] + [x for x in (sub(k, c) for c in names(k)) if x is not None]
            for kk in keys:
                for vn in ("InstallationLocation", "InstallLocation"):
                    loc = value(kk, vn)
                    if loc:
                        out.append((m.group(1), ntpath.join(loc, "Revit.exe")))
            for kk in keys:
                close(kk)
        close(root)
    # Windows' list of installed programs
    un = sub(hklm, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
    if un is not None:
        for n in names(un):
            k = sub(un, n)
            if k is None:
                continue
            m = re.match(r"^(?:Autodesk )?Revit (20\d\d)$", value(k, "DisplayName"))
            loc = value(k, "InstallLocation") if m else u""
            if loc:
                out.append((m.group(1), ntpath.join(loc, "Revit.exe")))
            close(k)
        close(un)
    return out


_INSTALLED = {}


def installed_revits(exe=None, isfile=None, registry=None, refresh=False):
    """{year: Revit.exe} for every Revit on this PC.

    Looked for, in this order: beside the Revit that is running (its folder
    with the year changed - right even when Revit is not on C:), in Program
    Files, and in the registry. Only files that exist are returned."""
    plain = exe is None and isfile is None and registry is None
    if plain and _INSTALLED and not refresh:
        return dict(_INSTALLED)
    check = isfile or os.path.isfile
    found = {}

    def add(year, path):
        if year and path and year not in found:
            try:
                if check(path):
                    found[year] = ntpath.normpath(path)
            except Exception:
                pass

    running = exe or revit_exe()
    folder = ntpath.dirname(running)
    m = _ANY_YEAR.search(ntpath.basename(folder))
    if m:
        add(m.group(1), running)
        for y in _years():
            add(str(y), ntpath.join(ntpath.dirname(folder),
                                    ntpath.basename(folder).replace(m.group(1), str(y)),
                                    ntpath.basename(running)))
    for base in _program_dirs():
        for y in _years():
            add(str(y), ntpath.join(base, "Autodesk", "Revit %d" % y, "Revit.exe"))
    for year, path in _registry_revits(registry):
        add(year, path)
    if plain:
        _INSTALLED.clear()
        _INSTALLED.update(found)
    return found


def exe_for(year, installed=None):
    """Revit.exe of a version: where it is, or - not installed - where it
    would normally be, so the launcher's log can name what it looked for."""
    installed = installed_revits() if installed is None else installed
    return installed.get(year) or ntpath.join(_program_dirs()[0], "Autodesk", "Revit %s" % year, "Revit.exe")


def pyrevit_addin(year):
    """The file that loads pyRevit into Revit <year>, or "". Without it
    Revit starts at night and nothing happens: the LWK tools are part of
    pyRevit. (One pyRevit serves every version it is attached to, with the
    same extensions.)"""
    for base in (os.environ.get("APPDATA"), os.environ.get("PROGRAMDATA") or os.environ.get("ALLUSERSPROFILE")):
        if not base:
            continue
        d = os.path.join(base, "Autodesk", "Revit", "Addins", str(year))
        try:
            names = sorted(os.listdir(d))
        except Exception:
            continue
        for n in names:
            if n.lower().endswith(".addin") and "pyrevit" in n.lower():
                return os.path.join(d, n)
    return ""


def running_revits(procs=None):
    """[(year, exe)] of every Revit open now, this one included; the year
    is "" where Windows will not say which file a process runs."""
    out = []
    try:
        if procs is None:
            procs = System.Diagnostics.Process.GetProcessesByName("Revit")
        for p in procs:
            try:
                path = u"%s" % p.MainModule.FileName
            except Exception:
                path = u""
            out.append((year_in(ntpath.dirname(path)) if path else "", path))
    except Exception:
        pass
    return out


# ---------------------------------------------------- which job, which Revit

def local_index():
    """{model id: {year: local copy}} from Revit's cache, {} if unreadable."""
    try:
        from lwk_viewer import autopub
        return autopub.cache_index()
    except Exception:
        return {}


def job_year(job, sched_year="", index=None):
    """(year, how) - the Revit version that publishes a job.

    how: "set"      the job says so ("revit")
         "cache"    an older job that does not: this PC opened the model in
                    exactly one Revit version, so it is that one
         "schedule" still unknown: the Revit the schedule was made from, as
                    before versions were recorded
         "unknown"  and no schedule either"""
    y = (u"%s" % (job.get("revit") or "")).strip()
    if YEAR.match(y):
        return y, "set"
    model = (job.get("model") or "").lower()
    if model and index:
        years = sorted((index.get(model) or {}).keys())
        if len(years) == 1:
            return years[0], "cache"
    if sched_year:
        return sched_year, "schedule"
    return "", "unknown"


def wanted(job):
    """Published at night: switched on, and a model on ACC (only those can
    be opened without a person)."""
    return bool(job.get("enabled", True)) and bool(job.get("model"))


def _chosen(jobs, only):
    """The jobs of a night (only=None: those switched on) or of a test run
    (only: model ids - those models whether switched on or not; the saved
    switch is not touched)."""
    if only is None:
        return [j for j in jobs if wanted(j)]
    pick = set((m or "").lower() for m in only)
    return [j for j in jobs if j.get("model") and j["model"].lower() in pick]


def plan(jobs, sched_year="", index=None, only=None):
    """{year: [jobs]} - what each Revit version publishes. A job whose
    version cannot be told at all is under ""."""
    out = {}
    for j in _chosen(jobs, only):
        out.setdefault(job_year(j, sched_year, index)[0], []).append(j)
    return out


def night_jobs(jobs, year, sched_year="", index=None, only=None):
    """(run, left) for the Revit of `year`: the jobs it publishes, in the
    order they are saved, and [(job, its year)] left for another Revit - a
    job is never tried in a Revit of another version (it cannot open it)."""
    run, left = [], []
    for j in _chosen(jobs, only):
        y = job_year(j, sched_year, index)[0]
        if y == year or not y:
            run.append(j)
        else:
            left.append((j, y))
    return run, left


# -------------------------------------------------------------- schedule

def saved_schedule():
    """{"time": "01:00", "weekdays": bool, "revit": "2024", ...} as last set
    here, or {} - the task's own text differs with the Windows language."""
    try:
        import json
        with io.open(SCHEDULE_FILE, encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_schedule(data):
    from lwk_viewer import jsonio
    _ensure(BASE)
    jsonio.write_atomic(SCHEDULE_FILE, data)


def settings(sch=None):
    """The launcher's limits in the units it counts in, from the schedule
    file with DEFAULTS for what it does not say."""
    sch = saved_schedule() if sch is None else sch

    def num(key, low):
        try:
            return max(low, float(sch.get(key, DEFAULTS[key])))
        except Exception:
            return float(DEFAULTS[key])

    return {"limit_minutes": int(round(num("limit_hours", 0.25) * 60)),
            "pickup_minutes": int(round(num("pickup_minutes", 2))),
            "wait_minutes": int(round(num("wait_minutes", 0))),
            "kill": bool(sch.get("kill_at_limit", DEFAULTS["kill_at_limit"]))}


def legacy_bat_exe():
    """The Revit the launcher before 2026-10-03 starts - its one
    'start "" "<Revit.exe>"' line - or "" for today's launcher or none.
    It is the only record of which Revit an old schedule was made from."""
    try:
        with io.open(BAT, encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception:
        return ""
    if BAT_MARK in text:
        return ""
    m = re.search(r'(?im)^\s*start\s+""\s+"([^"\r\n]+)"', text)
    return m.group(1) if m else ""


def schedule_year(sch=None):
    """The Revit version the schedule was made from - where jobs that do
    not say their version are published, as before - or ""."""
    sch = saved_schedule() if sch is None else sch
    y = (u"%s" % (sch.get("revit") or "")).strip()
    if YEAR.match(y):
        return y
    return year_in(ntpath.dirname(legacy_bat_exe()))


def next_run(sch=None, now=None):
    """When the task next fires, worked out from the saved time and days
    (Windows' own answer comes in the language of Windows). None if not
    set."""
    sch = saved_schedule() if sch is None else sch
    m = re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", sch.get("time") or "")
    if not m:
        return None
    now = now or datetime.datetime.now()
    d = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
    if d <= now:
        d += datetime.timedelta(days=1)
    while sch.get("weekdays") and d.weekday() >= 5:
        d += datetime.timedelta(days=1)
    return d


# -------------------------------------------------------------- launcher

def list_text(jobs, sch=None, installed=None, index=None, only=None, this_year=""):
    """What the launcher reads: its limits, and one line per Revit version
    that has something to publish, oldest first.

        limit|180|                       minutes one version may take
        revit|2023|C:\\...\\Revit.exe|
        job|<model id>|                  test run only: the models chosen

    Every line ends with the separator, so nothing at the end of a line (a
    stray carriage return) can become part of a path. A version that is not
    installed is still listed, with the usual path: the launcher then logs
    that it was not found instead of saying nothing."""
    sch = saved_schedule() if sch is None else sch
    s = settings(sch)
    lines = [u"; LWK Viewer night export - what LWK_nightly.bat starts, in this order.",
             u"; Rewritten by the LWK tools whenever the models or the schedule change: do not edit.",
             u"limit|%d|" % s["limit_minutes"], u"pickup|%d|" % s["pickup_minutes"],
             u"wait|%d|" % s["wait_minutes"], u"kill|%d|" % (1 if s["kill"] else 0)]
    for m in (only or []):
        lines.append(u"job|%s|" % (m or "").lower())
    # no schedule on record: jobs that do not say their version go with the
    # Revit that is writing this, as the single-Revit launcher did
    p = plan(jobs, schedule_year(sch) or this_year, index, only)
    for y in sorted(k for k in p if k):
        lines.append(u"revit|%s|%s|" % (y, exe_for(y, installed)))
    return u"\r\n".join(lines) + u"\r\n"


def read_list(path=None):
    """{"revit": [(year, exe)], "job": [model ids], "limit": minutes, ...}
    from a list file; empty lists if it is not there."""
    out = {"revit": [], "job": [], "exists": False}
    try:
        with io.open(path or LIST, encoding="utf-8", errors="replace") as f:
            rows = f.read().splitlines()
    except Exception:
        return out
    out["exists"] = True
    for row in rows:
        if not row.strip() or row.lstrip().startswith(";"):
            continue
        cells = [c.strip() for c in row.split("|")]
        if cells[0] == "revit" and len(cells) >= 3:
            out["revit"].append((cells[1], cells[2]))
        elif cells[0] == "job" and len(cells) >= 2 and cells[1]:
            out["job"].append(cells[1].lower())
        elif len(cells) >= 2:
            out[cells[0]] = cells[1]
    return out


def write_list(jobs=None, only=None):
    """Rewrite the launcher's list (the test list when `only` is given).
    Called whenever jobs or the schedule are saved, so the launcher always
    starts the right Revits. Safe while the launcher runs: it reads the
    whole list before it starts anything."""
    if jobs is None:
        from lwk_viewer import batch
        jobs = batch.load_jobs()
    text = list_text(jobs, installed=installed_revits(), index=local_index(), only=only,
                     this_year=revit_year())
    path = LIST if only is None else TEST_LIST
    _ensure(BASE)
    # newline="": the text already has Windows line ends; the default would
    # turn each into CR CR LF
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return path


# The launcher. One text for every PC: what to start comes from the list
# file, so this file is only rewritten when the tools are updated (rewriting
# a .bat while Windows is running it derails it).
#
# Written without a single ( ... ) block and without delayed expansion: a
# path such as "C:\Program Files (x86)\..." inside a block ends the block
# early, and "!" in a path vanishes under delayed expansion. Every decision
# is a goto instead. Log lines put the redirection first, so text ending in
# a digit is not taken for a file handle. The three numbers worked out with
# "set /a" are set to 0 first: should a limit in the list be damaged, the
# arithmetic fails, 0 stays, and the line after puts the usual value back -
# an empty variable in "if %X% LSS ..." would stop the whole launcher.
#
# PowerShell is used for what a .bat cannot do: tell WHICH Revit version is
# open (tasklist only knows "Revit.exe"), and wait for the Revit it started
# with a time limit. They are inline commands (not script files, so the
# script execution policy does not apply) and use only cmdlets and
# properties, which also work where PowerShell is locked down. Paths go to
# PowerShell in environment variables, never inside the command text, so no
# quote in a path can break it. If PowerShell cannot run at all, the old
# rule applies - any Revit open, nothing is started - and the log says so.
_BAT = r'''@echo off
REM LWK-LAUNCHER 5
REM LWK Viewer night export. Started by Windows Task Scheduler every night,
REM or with the word  test  by the Test night run button of Auto Publish.
REM For every Revit version listed in LWK_nightly_versions.txt, one after
REM another: skip it if that Revit is open, else write its flag, start it
REM and wait until it has closed. The LWK tools in Revit see the flag,
REM publish the models of that version, write a log and close Revit.
REM Do not edit: the LWK tools rewrite this file.
setlocal
title LWK Viewer night export
set "LWK=%APPDATA%\LWK"
set "LOG=%LWK%\nightly\scheduler.log"
set "LIST=%LWK%\LWK_nightly_versions.txt"
set "MODE=night"
if /I "%~1"=="test" set "MODE=test"
if /I "%MODE%"=="test" set "LIST=%LWK%\LWK_nightly_test.txt"
set "LIMIT_MIN=180"
set "PICKUP_MIN=15"
set "WAIT_MIN=10"
set "LWK_KILL=0"
set "SEEN=0"
set "RAN=0"
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"
if not exist "%LWK%\nightly" mkdir "%LWK%\nightly"
echo.
echo   LWK Viewer night export (%MODE% run)
echo   ------------------------------------
>>"%LOG%" echo %date% %time%  ---- launcher started (%MODE% run)
set "PS=0"
"%PSEXE%" -NoProfile -NonInteractive -Command "exit 7" >nul 2>&1
if "%errorlevel%"=="7" set "PS=1"
if "%PS%"=="0" >>"%LOG%" echo %date% %time%  PowerShell could not be run, so it cannot be told WHICH Revit version is open: if any Revit is open nothing is started, and there is no time limit.
if "%PS%"=="0" echo   Note: PowerShell is not available. If any Revit is open, nothing is started.
if not exist "%LIST%" goto :nolist
for /f "usebackq eol=; tokens=1-3 delims=|" %%A in ("%LIST%") do call :line "%%A" "%%B" "%%C"
if "%SEEN%"=="0" >>"%LOG%" echo %date% %time%  no model is set to be published - nothing to start.
if "%SEEN%"=="0" echo   No model is set to be published - nothing to do.
goto :end

:nolist
>>"%LOG%" echo %date% %time%  the list of what to start is missing: "%LIST%" - open Auto Publish in Revit and press Set schedule.
echo   The list of what to start is missing.
echo   Open Auto Publish in Revit and press Set schedule.
goto :end

:end
>>"%LOG%" echo %date% %time%  ---- launcher finished: %RAN% Revit version(s) started
echo.
if /I "%MODE%"=="test" goto :endtest
echo   Finished. This window closes in 30 seconds.
timeout /t 30 /nobreak >nul 2>&1
exit /b 0

:endtest
echo   Test finished. What happened is written in
echo     "%LWK%\nightly"
echo   scheduler.log is this window; the file named by today's date is Revit.
echo   Auto Publish in Revit shows each model's last run.
echo.
echo   Press any key to close this window.
pause >nul
exit /b 0

REM ---- one line of the list: a limit, or a Revit version to start
:line
if /I "%~1"=="revit" goto :revit
if /I "%~1"=="limit" set "LIMIT_MIN=%~2"
if /I "%~1"=="pickup" set "PICKUP_MIN=%~2"
if /I "%~1"=="wait" set "WAIT_MIN=%~2"
if /I "%~1"=="kill" set "LWK_KILL=%~2"
exit /b 0

:revit
set /a SEEN+=1
set "YEAR=%~2"
set "LWK_EXE=%~3"
set "LWK_FLAG=%LWK%\run_jobs_on_start_%YEAR%.flag"
set "WAITING="
set "LWK_LIMIT_SEC=0"
set "LWK_PICKUP_SEC=0"
set "WAIT_LEFT=0"
set /a LWK_LIMIT_SEC=LIMIT_MIN*60
set /a LWK_PICKUP_SEC=PICKUP_MIN*60
set /a WAIT_LEFT=WAIT_MIN*6
if %LWK_LIMIT_SEC% LSS 600 set "LIMIT_MIN=180"
if %LWK_LIMIT_SEC% LSS 600 set "LWK_LIMIT_SEC=10800"
if %LWK_PICKUP_SEC% LSS 120 set "PICKUP_MIN=15"
if %LWK_PICKUP_SEC% LSS 120 set "LWK_PICKUP_SEC=900"
echo.
echo   Revit %YEAR%
if exist "%LWK_EXE%" goto :check
>>"%LOG%" echo %date% %time%  Revit %YEAR%: NOT started - "%LWK_EXE%" was not found. Is Revit %YEAR% installed on this PC?
echo     NOT started: Revit %YEAR% was not found on this PC.
exit /b 0

:check
call :running
if "%RUN%"=="0" goto :launch
if /I "%MODE%"=="test" if %WAIT_LEFT% GTR 0 goto :waitclose
if "%RUN%"=="1" >>"%LOG%" echo %date% %time%  Revit %YEAR%: already open - NOT started, so that no open work is disturbed. Its models were skipped this time.
if "%RUN%"=="2" >>"%LOG%" echo %date% %time%  Revit %YEAR%: NOT started - a Revit is open and it could not be told which version it is. Its models were skipped this time.
echo     Revit is open, so Revit %YEAR% was NOT started and its models were skipped.
echo     Close Revit %YEAR% before the night export. Other Revit versions may stay open.
exit /b 0

:waitclose
if not defined WAITING >>"%LOG%" echo %date% %time%  Revit %YEAR%: a Revit is open - the test run waits up to %WAIT_MIN% minutes for it to be closed.
if not defined WAITING if "%RUN%"=="1" echo     Revit %YEAR% is open. Save your work and close Revit %YEAR% now.
if not defined WAITING if "%RUN%"=="2" echo     A Revit is open. Save your work and close Revit now.
if not defined WAITING echo     Waiting up to %WAIT_MIN% minutes for that ...
set "WAITING=1"
set /a WAIT_LEFT-=1
ping -n 11 127.0.0.1 >nul 2>&1
goto :check

REM ---- RUN=0 this version is not open, 1 it is open, 2 a Revit is open and
REM      its version cannot be told (then it counts as open)
:running
set "RUN=2"
if "%PS%"=="0" goto :running_any
"%PSEXE%" -NoProfile -NonInteractive -Command "$r = @(Get-Process -Name Revit -ErrorAction SilentlyContinue); if ($r.Count -eq 0) { exit 10 }; if (@($r | Where-Object { $_.Path -eq $env:LWK_EXE }).Count -gt 0) { exit 11 }; if (@($r | Where-Object { -not $_.Path }).Count -gt 0) { exit 12 }; exit 10" >nul 2>&1
set "RC=%errorlevel%"
if "%RC%"=="10" set "RUN=0"
if "%RC%"=="11" set "RUN=1"
if not "%RUN%"=="2" exit /b 0
:running_any
tasklist /FI "IMAGENAME eq Revit.exe" 2>nul | find /I "Revit.exe" >nul
if errorlevel 1 set "RUN=0"
exit /b 0

:launch
>"%LWK_FLAG%" echo %MODE% %date% %time%
if exist "%LWK_FLAG%" goto :flagok
>>"%LOG%" echo %date% %time%  Revit %YEAR%: NOT started - the flag file "%LWK_FLAG%" could not be written.
echo     NOT started: the flag file could not be written.
exit /b 0

:flagok
set /a RAN+=1
set "LWK_DLOG=%LWK%\nightly\dialogs.log"
set "LWK_WATCH=%LWK%\LWK_dialog_watch.ps1"
if "%PS%"=="1" if exist "%LWK_WATCH%" start "" /b "%PSEXE%" -NoProfile -NonInteractive -WindowStyle Hidden -Command "iex ([IO.File]::ReadAllText($env:LWK_WATCH))"
>>"%LOG%" echo %date% %time%  Revit %YEAR%: starting "%LWK_EXE%" - time limit %LIMIT_MIN% minutes.
echo     Starting Revit %YEAR%. It publishes its models and then closes by itself.
echo     This window waits for it. Progress is written in "%LWK%\nightly"
if "%PS%"=="0" goto :launch_plain
"%PSEXE%" -NoProfile -NonInteractive -Command "$p = Start-Process -FilePath $env:LWK_EXE -ArgumentList '/nosplash' -PassThru; if (-not $p) { exit 20 }; $n = 0; $limit = [int]$env:LWK_LIMIT_SEC; $pick = [int]$env:LWK_PICKUP_SEC; while (-not $p.HasExited) { Start-Sleep -Seconds 5; $n = $n + 5; if ($n -ge $limit) { if ($env:LWK_KILL -eq '1') { Stop-Process -InputObject $p -Force -ErrorAction SilentlyContinue }; exit 21 }; if (($n -ge $pick) -and (Test-Path -LiteralPath $env:LWK_FLAG)) { if ($env:LWK_KILL -eq '1') { Stop-Process -InputObject $p -Force -ErrorAction SilentlyContinue }; exit 22 } }; exit 0"
set "RC=%errorlevel%"
if "%RC%"=="0" goto :closed
if "%RC%"=="21" goto :overlimit
if "%RC%"=="22" goto :nopickup
del "%LWK_FLAG%" >nul 2>&1
>>"%LOG%" echo %date% %time%  Revit %YEAR%: could not be started or watched - PowerShell answered %RC%.
echo     Revit %YEAR% could not be started.
exit /b 0

:launch_plain
start "" /wait "%LWK_EXE%" /nosplash
goto :closed

:closed
if exist "%LWK_FLAG%" goto :unused
>>"%LOG%" echo %date% %time%  Revit %YEAR%: finished and closed.
echo     Revit %YEAR% has finished and closed.
exit /b 0

:unused
del "%LWK_FLAG%" >nul 2>&1
>>"%LOG%" echo %date% %time%  Revit %YEAR%: closed WITHOUT publishing - the LWK tools did not start in it. Is pyRevit attached to Revit %YEAR%, with the LWK extension loaded?
echo     Revit %YEAR% closed without publishing: the LWK tools did not start in it.
echo     Is pyRevit attached to Revit %YEAR%? Check setup in Auto Publish tells.
exit /b 0

:overlimit
if "%LWK_KILL%"=="1" >>"%LOG%" echo %date% %time%  Revit %YEAR%: still running after %LIMIT_MIN% minutes - ended by the launcher, as nightly_schedule.json asks. Going on.
if not "%LWK_KILL%"=="1" >>"%LOG%" echo %date% %time%  Revit %YEAR%: still running after %LIMIT_MIN% minutes - left running and not waited for any longer. Going on.
echo     Revit %YEAR% is still running after %LIMIT_MIN% minutes: not waited for any longer.
exit /b 0

:nopickup
del "%LWK_FLAG%" >nul 2>&1
>>"%LOG%" echo %date% %time%  Revit %YEAR%: started, but the LWK tools did not take up the export within %PICKUP_MIN% minutes - pyRevit is not attached to Revit %YEAR%, the LWK extension is not loaded there, or Revit is waiting at a sign-in or licence window. Not waited for any longer.
if "%LWK_KILL%"=="1" >>"%LOG%" echo %date% %time%  Revit %YEAR%: ended by the launcher, as nightly_schedule.json asks.
echo     Revit %YEAR% started, but the LWK tools did not take up the export
echo     within %PICKUP_MIN% minutes. Is pyRevit attached to Revit %YEAR%, and is
echo     Revit waiting at a sign-in or licence window? Not waited for any longer.
exit /b 0
'''


# The dialog watcher. Started by the launcher next to each Revit it starts,
# for as long as that Revit runs (or the time limit). Some dialogs come
# before the LWK tools are loaded and can answer anything - "External Tools
# - Add-in Assembly Not Found" when an add-in's DLL is missing (6 Oct: the
# LWK Excel to Revit Import add-in), another add-in's own "cannot find
# xxx.dll" message - and they stop Revit until someone clicks. So can a DWG
# link while a model opens ("extents greater than 1E9 ... Click OK to
# continue", 8 Oct).
#
# Every window of that Revit is found through Windows itself (EnumWindows):
# a dialog owned by the "Open Model" progress window is not under Revit's
# main window, which is all the first version looked at. The watcher
# presses the harmless button of the dialogs it knows, and the only button
# of a dialog that has one (an OK-only message: nothing to choose); every
# other dialog is left alone and written into nightly/dialogs.log.
#
# It is kept in a file and run with Invoke-Expression: not a script file
# as far as PowerShell is concerned, so the execution policy does not apply,
# and it no longer has to fit on one line of the .bat (8191 characters).
_WATCH = u"""$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$A=[Windows.Automation.AutomationElement]; $S=[Windows.Automation.TreeScope]; $CT=[Windows.Automation.ControlType]
$B=New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty,$CT::Button)
$X=New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty,$CT::Text)
$D=New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty,'#32770')
$TW=[Windows.Automation.TreeWalker]::ControlViewWalker
$W32=$false
try {
Add-Type -Namespace LWK -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
public static System.Collections.Generic.List<System.IntPtr> Of(uint want) {
  var l = new System.Collections.Generic.List<System.IntPtr>();
  EnumWindows(delegate(System.IntPtr h, System.IntPtr p) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == want && IsWindowVisible(h)) { var s = new System.Text.StringBuilder(256); GetClassName(h, s, 256); if (s.ToString() == "#32770") l.Add(h); }
    return true; }, System.IntPtr.Zero);
  return l; }
'@
$W32=$true } catch {}
$log=$env:LWK_DLOG; $seen=@{}; $found=@{}; $nSeen=0; $nPressed=0; $beat=Get-Date; $t0=Get-Date; $lim=[int]$env:LWK_LIMIT_SEC; if($lim -lt 600){$lim=10800}; $gone=0; $had=$false
function Say($m){ Add-Content -LiteralPath $log -Value ((Get-Date -Format s)+'  Revit '+$env:YEAR+'  '+$m) }
# the dialog's own buttons (not the title bar's Close)
function Buttons($w){ @($w.FindAll($S::Descendants,$B) | Where-Object { $q=$TW.GetParent($_); -not $q -or $q.Current.ControlType -ne $CT::TitleBar }) }
function Press($bs,$names){ foreach($n in $names){ foreach($b in $bs){ if($b.Current.Name -eq $n){ $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); return $n } } }; return $null }
function Look($w){
  $title=$w.Current.Name
  $txt=(@($w.FindAll($S::Descendants,$X)) | ForEach-Object { $_.Current.Name }) -join ' '
  $bs=Buttons $w
  $ans=$null; $why=''
  if($title -like '*Add-in Assembly Not Found*' -or $txt -like '*Failed to initialize the add-in*'){ $ans=@('Close','OK'); $why='an add-in that cannot load' }
  elseif($txt -match '[.]dll' -and $txt -match "(could not|couldn't|can't|cannot|can not|unable to|not found|failed|missing|not exist)"){ $ans=@('Close','OK'); $why='a missing DLL' }
  elseif($txt -like '*extents greater than*' -or ($txt -like '*Click OK to continue*' -and $txt -like '*import*')){ $ans=@('OK'); $why='a DWG partly out of range: imported, the far part cut off' }
  elseif($txt -like '*import from the Model space*'){ $ans=@('Yes'); $why='a DWG with an empty paper space: its model space imported' }
  elseif($title -like '*Lost on Import*' -or $txt -like '*were lost during import*' -or $txt -like '*cannot be imported*' -or $txt -like '*was out of range*'){ $ans=@('Close','OK'); $why='a DWG Revit cannot fully read: noted' }
  elseif($bs.Count -eq 1){ $ans=@($bs[0].Current.Name); $why='only one button, nothing to choose' }
  $key=$title+'|'+$txt
  $script:nSeen++
  if($ans){ $p=Press $bs $ans; if($p){ $script:nPressed++; Say ('pressed '+$p+' ('+$why+') on: '+$title+' - '+$txt); return } }
  if(-not $seen.ContainsKey($key)){ $seen[$key]=1; Say ('seen, left for Revit or a person: '+$title+' - '+$txt+' ['+(($bs | ForEach-Object { $_.Current.Name }) -join ', ')+']') }
}
Say ('watching'+$(if($W32){''}else{' (without Windows window list: only dialogs under Revit''s main window)'}))
while(((Get-Date)-$t0).TotalSeconds -lt $lim){
  $ps=@(Get-Process -Name Revit | Where-Object { $_.Path -eq $env:LWK_EXE })
  if($ps.Count -eq 0){ if($had){ $gone+=2; if($gone -ge 60){ break } } } else { $had=$true; $gone=0 }
  if(((Get-Date)-$beat).TotalMinutes -ge 10){ $beat=Get-Date; Say ('still watching: '+$ps.Count+' Revit running, '+$nSeen+' dialog look(s), '+$nPressed+' pressed so far') }
  foreach($p in $ps){
    if(-not $found.ContainsKey($p.Id)){ $found[$p.Id]=1; Say ('found Revit (process '+$p.Id+')') }
    if($W32){
      foreach($h in [LWK.Win]::Of([uint32]$p.Id)){ $w=$A::FromHandle($h); if($w){ Look $w } }
    } else {
      $pc=New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty,$p.Id)
      foreach($w in $A::RootElement.FindAll($S::Children,$pc)){
        if($w.Current.ClassName -eq '#32770'){ Look $w }
        foreach($d in $w.FindAll($S::Children,$D)){ Look $d }
      }
    }
  }
  Start-Sleep -Seconds 2
}
"""


def watch_text():
    return u"\r\n".join(_WATCH.splitlines()) + u"\r\n"


def bat_text():
    return u"\r\n".join((u"%s" % _BAT).splitlines()) + u"\r\n"


def bat_is_current():
    """Are the launcher and its dialog watcher on this PC the ones this
    version of the tools writes?"""
    try:
        with io.open(BAT, encoding="utf-8", errors="replace", newline="") as f:
            if f.read() != bat_text():
                return False
        with io.open(WATCH_FILE, encoding="utf-8", errors="replace", newline="") as f:
            return f.read() == watch_text()
    except Exception:
        return False


def write_bat(exe=None):
    """The launcher the scheduled task runs. (exe: no longer used - which
    Revits to start is in the list file - kept for older callers.)"""
    _ensure(BASE)
    _ensure(LOG_DIR)
    with io.open(WATCH_FILE, "w", encoding="utf-8", newline="") as f:
        f.write(watch_text())
    with io.open(BAT, "w", encoding="utf-8", newline="") as f:
        f.write(bat_text())
    return BAT


def _keep_schedule_year():
    """Before an old launcher is replaced: note in the schedule file which
    Revit it started. That is where jobs without a version are published,
    and the old .bat was the only place it was written."""
    sch = saved_schedule()
    if YEAR.match(u"%s" % (sch.get("revit") or "")):
        return
    exe = legacy_bat_exe()
    year = year_in(ntpath.dirname(exe))
    if year:
        sch.update({"revit": year, "exe": exe})
        try:
            _save_schedule(sch)
        except Exception:
            pass


def ensure_launcher(make=False):
    """Bring this PC's launcher up to date without touching the Windows
    task (it runs the same file): renew the .bat if it is an older kind,
    and rewrite the list. make: write the .bat even if there is none yet
    (the test run needs it). Returns lines to show - empty when nothing
    had to change."""
    lines = []
    scheduled = os.path.isfile(BAT) or os.path.isfile(SCHEDULE_FILE)
    if (scheduled or make) and not bat_is_current():
        old = os.path.isfile(BAT)
        _keep_schedule_year()
        write_bat()
        if old:
            lines.append("the night launcher on this PC was renewed: it now starts the right Revit version "
                         "for each model, one version after another")
    try:
        write_list()
    except Exception as ex:
        lines.append("could not write the launcher's list: %s" % ex)
    return lines


# ----------------------------------------------------------- the task

def _run(args):
    """schtasks, with its output."""
    psi = System.Diagnostics.ProcessStartInfo("schtasks.exe", args)
    psi.UseShellExecute = False
    psi.RedirectStandardOutput = True
    psi.RedirectStandardError = True
    psi.CreateNoWindow = True
    p = System.Diagnostics.Process.Start(psi)
    out = p.StandardOutput.ReadToEnd()
    err = p.StandardError.ReadToEnd()
    p.WaitForExit()
    return p.ExitCode, (out or "") + (err or "")


def _x(s):
    """Escape text for the task XML: a user or path containing & or < must
    not break the definition."""
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def task_hours(versions, limit_minutes):
    """How long Windows lets the task run before it stops it: every version
    may use its whole limit, and there are never fewer than two counted, so
    a second Revit version added later still fits. Between 6 hours (as it
    was) and 20 (the next night must find the task finished: Windows does
    not start a second one beside it)."""
    need = int((max(2, versions) * limit_minutes + 59) // 60) + 1
    return max(6, min(20, need))


def _task_xml(hhmm, weekdays_only, hours=6):
    """A task definition, so the options schtasks' command line cannot set
    are set too: wake the PC to run, do not start late in the working day if
    the night was missed, stop after some hours, never two at once."""
    user = "%s\\%s" % (os.environ.get("USERDOMAIN", ""), os.environ.get("USERNAME", ""))
    start = datetime.date.today().isoformat() + "T" + hhmm + ":00"
    if weekdays_only:
        trigger = ("<CalendarTrigger><StartBoundary>%s</StartBoundary><Enabled>true</Enabled>"
                   "<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>"
                   "<Monday/><Tuesday/><Wednesday/><Thursday/><Friday/>"
                   "</DaysOfWeek></ScheduleByWeek></CalendarTrigger>" % start)
    else:
        trigger = ("<CalendarTrigger><StartBoundary>%s</StartBoundary><Enabled>true</Enabled>"
                   "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>"
                   "</CalendarTrigger>" % start)
    return u"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Publishes every model registered for the LWK Viewer - one Revit version after another - then closes Revit.</Description></RegistrationInfo>
  <Triggers>%s</Triggers>
  <Principals><Principal id="Author"><UserId>%s</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>false</StartWhenAvailable>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT%dH</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>"%s"</Command></Exec></Actions>
</Task>
""" % (trigger, _x(user), int(hours), _x(BAT))


def schedule(hhmm, weekdays_only=False):
    """Create or replace the scheduled task. Returns (ok, message).

    The Revit this is called from becomes "the schedule's Revit": the one
    that publishes jobs which do not say their version. The launcher's
    limits already in the schedule file are kept."""
    _keep_schedule_year()
    write_bat()
    sch = saved_schedule()
    try:
        from lwk_viewer import batch
        versions = len([y for y in plan(batch.load_jobs(), revit_year(), local_index()) if y])
    except Exception:
        versions = 1
    hours = task_hours(versions, settings(sch)["limit_minutes"])
    xml_path = os.path.join(BASE, "LWK_nightly_task.xml")
    # schtasks reads task XML as UTF-16
    with io.open(xml_path, "w", encoding="utf-16") as f:
        f.write(_task_xml(hhmm, weekdays_only, hours))
    code, text = _run('/Create /TN "%s" /XML "%s" /F' % (TASK, xml_path))
    if code == 0:
        try:
            sch.update({"time": hhmm, "weekdays": bool(weekdays_only), "revit": revit_year(),
                        "exe": revit_exe(), "task_hours": hours})
            _save_schedule(sch)
        except Exception:
            pass
    try:
        write_list()
    except Exception:
        pass
    return code == 0, text.strip()


def unschedule():
    code, text = _run('/Delete /TN "%s" /F' % TASK)
    return code == 0, text.strip()


def status():
    """(exists, human-readable status)."""
    code, text = _run('/Query /TN "%s" /V /FO LIST' % TASK)
    if code != 0:
        return False, "Not scheduled."
    keep = []
    for line in text.splitlines():
        k = line.split(":", 1)[0].strip()
        if k in ("Next Run Time", "Last Run Time", "Last Result", "Status", "Schedule Type",
                 "Start Time", "Days"):
            keep.append(line.strip())
    return True, "\n".join(keep)


# -------------------------------------------------------------- test run

def start_test(models, jobs=None):
    """Run the night export NOW for the chosen models (their ACC model
    ids), exactly as at night: the launcher, in a window of its own, with
    the word "test" - it then waits for an open Revit of the version it
    needs to be closed instead of skipping it. Nothing is closed or saved
    from here, and no job's saved night switch changes: the choice travels
    in the test list. Returns (ok, message)."""
    try:
        ensure_launcher(make=True)
        write_list(jobs, only=list(models))
        psi = System.Diagnostics.ProcessStartInfo("cmd.exe", '/c ""%s" test"' % BAT)
        psi.UseShellExecute = True               # a console window of its own, not Revit's child output
        psi.WorkingDirectory = BASE
        System.Diagnostics.Process.Start(psi)
        return True, ""
    except Exception as ex:
        return False, "%s" % ex


# ------------------------------------------------------------- the night

def close_revit(uiapp):
    """Ask Revit to exit once the current work is done. Everything this run
    opened is already closed without saving, so nothing asks to be saved."""
    from Autodesk.Revit.UI import RevitCommandId, PostableCommand
    uiapp.PostCommand(RevitCommandId.LookupPostableCommandId(PostableCommand.ExitRevit))


def run_night(uiapp, log, year=None, mode="night"):
    """The night's work of this Revit: the models of its version, one after
    another. Always ends by closing Revit."""
    from lwk_viewer import batch
    started = datetime.datetime.now()
    year = year or revit_year(uiapp)
    log("nightly export started in Revit %s" % year)
    try:
        only = None
        if mode == "test":
            only = read_list(TEST_LIST)["job"]
            log("test run: %d model(s) were chosen for it" % len(only))
        jobs, left = night_jobs(batch.load_jobs(), year, schedule_year(), local_index(), only)
        for j, y in left:
            log("%s: belongs to Revit %s - not opened in this Revit %s" % (j.get("title"), y, year))
        results = batch.run_all(uiapp, log, unattended=True, jobs=jobs)
        log("----")
        for title, ok, c in results:
            log("%-40s %s  (%d warnings, %d errors)"
                % (title, "OK" if ok else "FAILED", c.get("warn", 0), c.get("error", 0)))
        if not results:
            log("no model to publish in Revit %s - nothing to export" % year)
    except Exception as ex:
        log("nightly export stopped: %s" % ex)
    log("finished after %d minutes; closing Revit %s"
        % (int((datetime.datetime.now() - started).total_seconds() // 60), year))
    try:
        close_revit(uiapp)
    except Exception as ex:
        log("could not close Revit: %s" % ex)


# ------------------------------------------------------- Revit start-up

def on_revit_start(uiapp):
    """Called from the extension's startup.py every time Revit starts. Does
    nothing unless the launcher started this Revit: a fresh flag for THIS
    Revit's version. A Revit started by hand never begins to export.

    The work waits for Revit to be idle - fully started - and signed in to
    Autodesk, which it needs to open models from ACC. It waits up to ten
    minutes for the sign-in, then tries anyway, and the log says which."""
    year = revit_year(uiapp)
    mode = take_flag(year, schedule_year())
    if not mode:
        # a Revit started by a person: the night launcher is not running, so
        # this is when an older launcher (and dialog watcher) on this PC can
        # be renewed after the tools were updated - never during a night run,
        # as rewriting a .bat while Windows runs it derails it
        try:
            if os.path.isfile(BAT) and not bat_is_current() and not launcher_busy():
                for line in ensure_launcher():
                    NightLog()(line)
        except Exception:
            pass
        return
    log = NightLog()
    log("Revit %s started by the night launcher%s" % (year, " (TEST run)" if mode == "test" else ""))
    state = {"t0": datetime.datetime.now(), "done": False}

    def signed_in():
        try:
            from Autodesk.Revit.ApplicationServices import Application
            return bool(Application.IsLoggedIn)
        except Exception:
            return True                       # cannot tell: do not wait forever

    def on_idle(sender, args):
        if state["done"]:
            return
        waited = (datetime.datetime.now() - state["t0"]).total_seconds()
        if not signed_in() and waited < 600:
            try:
                args.SetRaiseWithoutDelay()   # ask to be called again soon
            except Exception:
                pass
            return
        state["done"] = True
        try:
            sender.Idling -= on_idle
        except Exception:
            pass
        if not signed_in():
            log("not signed in to Autodesk after 10 minutes - trying anyway; "
                "opening models from ACC will probably fail")
        run_night(sender, log, year, mode)

    try:
        uiapp.Idling += on_idle
        log("waiting for Revit to finish starting")
    except Exception as ex:
        log("could not wait for Revit to start: %s" % ex)
