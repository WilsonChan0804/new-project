# -*- coding: utf-8 -*-
"""The Programme and MS Project: its XML (MSPDI - File > Save As > XML in MS
Project, and the file it opens). Plain Python, no MS Project needed.

  read(xml_bytes)  -> {tasks, calendar, name, warnings}  (our programme's tasks)
  write(spec)      -> xml bytes; spec = {name, title, start, calendar,
                      rows: [{id, name, level, milestone, summary, start,
                      finish, dur, pct, notes, party, own_start,
                      deps: [{from (row index), type, lag, drive}]}]}

MSPDI: durations are "PT80H0M0S" at the project's minutes per day (480),
link lag in tenths of a minute, link types 0 FF, 1 FS, 2 SF, 3 SS.
The XML is read with no DTD at all: a file with a DOCTYPE or ENTITY is
refused (no entity tricks).
"""
import datetime
import os
import shutil
import subprocess
import tempfile
import re
import uuid
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

NS = "http://schemas.microsoft.com/project"
TYPE_IN = {"0": "FF", "1": "FS", "2": "SF", "3": "SS"}
TYPE_OUT = {"FF": 0, "FS": 1, "SF": 2, "SS": 3}
TEXT1 = "188743731"            # MS Project's field id of Text1: "Responsible"


class Refused(ValueError):
    pass


def _strip(tag):
    return tag.split("}", 1)[-1]


def _kids(el, name):
    return [c for c in el if _strip(c.tag) == name]


def _kid(el, name):
    for c in el:
        if _strip(c.tag) == name:
            return c
    return None


def _txt(el, name, default=""):
    k = _kid(el, name) if el is not None else None
    return (k.text or "").strip() if k is not None and k.text else default


def _minutes(d):
    """PT80H0M0S / PT8H / P2DT4H -> minutes"""
    m = re.match(r"^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$", d or "")
    if not m:
        return None
    dd, h, mi, se = (float(x or 0) for x in m.groups())
    return dd * 24 * 60 + h * 60 + mi + se / 60.0


def read(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    if re.search(rb"<!DOCTYPE|<!ENTITY", data[:200000], re.I):
        raise Refused("A file with a DOCTYPE is not read")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as ex:
        raise Refused("Not an XML file: %s" % ex)
    if _strip(root.tag) != "Project":
        raise Refused("Not an MS Project XML file (no <Project>)")
    mpd = float(_txt(root, "MinutesPerDay", "480") or 480) or 480
    warnings = []
    # the calendar: its working week and its exceptions
    cal = {"week": "mon-fri", "hk": False, "holidays": [], "off": []}
    cuid = _txt(root, "CalendarUID", "1")
    cals = _kid(root, "Calendars")
    c_el = None
    if cals is not None:
        for c in _kids(cals, "Calendar"):
            if _txt(c, "UID") == cuid:
                c_el = c
        if c_el is None and len(cals):
            c_el = _kids(cals, "Calendar")[0]
    if c_el is not None:
        work = {}
        wds = _kid(c_el, "WeekDays")
        for wd in (_kids(wds, "WeekDay") if wds is not None else []):
            t = _txt(wd, "DayType")
            if t in ("1", "2", "3", "4", "5", "6", "7"):
                work[int(t)] = _txt(wd, "DayWorking") == "1"
            elif t == "0" and _txt(wd, "DayWorking") == "0":
                tp = _kid(wd, "TimePeriod")
                _off(cal, _txt(tp, "FromDate"), _txt(tp, "ToDate"))
        exs = _kid(c_el, "Exceptions")
        for ex in (_kids(exs, "Exception") if exs is not None else []):
            if _txt(ex, "DayWorking", "0") == "0":
                tp = _kid(ex, "TimePeriod")
                _off(cal, _txt(tp, "FromDate"), _txt(tp, "ToDate"), _txt(ex, "Name"))
        if work.get(1) and work.get(7):
            cal["week"] = "all"
        elif work.get(7):
            cal["week"] = "mon-sat"
    # the field "Responsible" (Text1 or one so named)
    party_field = TEXT1
    eas = _kid(root, "ExtendedAttributes")
    for ea in (_kids(eas, "ExtendedAttribute") if eas is not None else []):
        if re.match(r"^(responsible|party|by)$", _txt(ea, "Alias"), re.I):
            party_field = _txt(ea, "FieldID")
    tasks, by_uid, raw = [], {}, []
    tl = _kid(root, "Tasks")
    for t in (_kids(tl, "Task") if tl is not None else []):
        if _txt(t, "IsNull") == "1":
            continue
        lv = int(float(_txt(t, "OutlineLevel", "1") or 1))
        if lv <= 0 or _txt(t, "UID") == "0" and lv == 0:
            continue                              # the project's own summary row
        mins = _minutes(_txt(t, "Duration"))
        days = int(round((mins or 0) / mpd))
        ms = _txt(t, "Milestone") == "1" or (mins is not None and mins == 0 and _txt(t, "Summary") != "1")
        preds = _kids(t, "PredecessorLink")
        ct = _txt(t, "ConstraintType", "0")
        cdate = _txt(t, "ConstraintDate")
        start, fnet = "", ""
        if ct in ("2", "4"):                       # must / start no earlier than
            start = cdate[:10]
        elif not preds:
            start = _txt(t, "Start")[:10]
        if ct in ("3", "6"):                       # must / finish no earlier than
            fnet = _cdate_finish(cdate)
        elif ct in ("5", "7"):
            warnings.append("%s: a 'no later than' constraint is not kept" % (_txt(t, "Name")[:60] or "A task"))
        if _txt(t, "Summary") == "1" and _txt(t, "Manual") == "1":
            warnings.append("%s: a manually scheduled summary - its dates now come from its tasks" % (_txt(t, "Name")[:60] or "A summary"))
        party = ""
        for ea in _kids(t, "ExtendedAttribute"):
            if _txt(ea, "FieldID") == party_field:
                party = _txt(ea, "Value")
        task = {"id": uuid.uuid4().hex[:12], "name": _txt(t, "Name")[:300] or "(no name)", "level": lv - 1,
                "kind": "milestone" if ms else "task", "start": start if re.match(r"^\d{4}-\d{2}-\d{2}$", start) else "",
                "fnet": fnet if re.match(r"^\d{4}-\d{2}-\d{2}$", fnet) else "",
                "dur": 0 if ms else max(1, days), "pct": int(float(_txt(t, "PercentComplete", "0") or 0)),
                "party": party[:120], "notes": _txt(t, "Notes")[:2000], "deps": [], "links": {}}
        by_uid[_txt(t, "UID")] = task["id"]
        tasks.append(task)
        raw.append(preds)
    for task, preds in zip(tasks, raw):
        for pl in preds:
            f = by_uid.get(_txt(pl, "PredecessorUID"))
            if not f:
                warnings.append("%s: a predecessor in another project or not in the file" % task["name"])
                continue
            fmt = _txt(pl, "LagFormat", "7")
            mins = float(_txt(pl, "LinkLag", "0") or 0) / 10.0           # tenths of a minute
            if fmt in ("19", "20", "51", "52"):                           # a lag in %
                warnings.append("%s: a lag in %% is read as 0" % task["name"])
                lag_days = 0
            elif fmt in ("8", "40", "44"):                                # elapsed days, 24 h each
                lag_days = int(round(mins / (24 * 60)))
            else:
                lag_days = int(round(mins / mpd))
            task["deps"].append({"from": f, "type": TYPE_IN.get(_txt(pl, "Type", "1"), "FS"), "lag": lag_days})
    return {"tasks": tasks, "calendar": cal, "name": _txt(root, "Title") or _txt(root, "Name"), "warnings": warnings}


def _cdate_finish(cdate):
    """A finish constraint's day: MS Project may store it as 08:00 of the next day."""
    d = cdate[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        return ""
    if cdate[11:16] and cdate[11:16] <= "08:00":
        d = (datetime.date.fromisoformat(d) - datetime.timedelta(days=1)).isoformat()
    return d


# ---------------------------------------------------------------- .mpp

MPP_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def is_mpp(data):
    return bytes(data[:8]) == MPP_MAGIC


def _mpxj_lib():
    """The folder of MPXJ's jars: MPXJ_LIB, or the pip package 'mpxj'."""
    p = os.environ.get("MPXJ_LIB", "")
    if p and os.path.isdir(p):
        return p
    try:
        import importlib.util
        spec = importlib.util.find_spec("mpxj")
        if spec and spec.origin:
            lib = os.path.join(os.path.dirname(spec.origin), "lib")
            if os.path.isdir(lib):
                return lib
    except Exception:
        pass
    return ""


def _java():
    """java on the PATH, else under JAVA_HOME, else the usual Windows install folders."""
    j = shutil.which("java")
    if j:
        return j
    exe = "java.exe" if os.name == "nt" else "java"
    homes = [os.environ.get("JAVA_HOME", "")]
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
        for vendor in ("Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft"):
            d = os.path.join(base, vendor) if base else ""
            if d and os.path.isdir(d):
                homes += sorted((os.path.join(d, x) for x in os.listdir(d)), reverse=True)
    for h in homes:
        p = os.path.join(h, "bin", exe) if h else ""
        if p and os.path.isfile(p):
            return p
    return None


def mpp_to_xml(data, timeout=120):
    """An .mpp file -> MS Project XML, by MPXJ (Java). Refused when they are missing."""
    java = _java()
    lib = _mpxj_lib()
    if not java or not lib:
        miss = " and ".join(x for x, ok in (("Java (11 or later)", java), ("MPXJ (pip install mpxj)", lib)) if not ok)
        raise Refused("Reading .mpp needs %s on the server - install it and restart run.bat. "
                      "Or, in MS Project, File > Save As > XML and import that." % miss)
    with tempfile.TemporaryDirectory() as d:
        src, out = os.path.join(d, "in.mpp"), os.path.join(d, "out.xml")
        with open(src, "wb") as f:
            f.write(data)
        try:
            p = subprocess.run([java, "-Djava.awt.headless=true", "-cp", os.path.join(lib, "*"), "org.mpxj.sample.MpxjConvert", src, out],
                               capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise Refused("The .mpp file took too long to read")
        if p.returncode != 0 or not os.path.exists(out):
            msg = (p.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            raise Refused("The .mpp file could not be read" + (": " + msg[-1][:200] if msg else ""))
        with open(out, "rb") as f:
            return f.read()


def _off(cal, a, b, name=""):
    a, b = (a or "")[:10], (b or a or "")[:10]
    try:
        x = datetime.date.fromisoformat(a)
        y = datetime.date.fromisoformat(b)
    except ValueError:
        return
    if x == y:
        cal["holidays"].append(a)
    else:
        cal["off"].append({"from": a, "to": b, "name": (name or "")[:80]})


def _dur(days, mpd=480):
    return "PT%dH0M0S" % int(round(days * mpd / 60))


def write(spec):
    rows = spec.get("rows") or []
    cal = spec.get("calendar") or {}
    week = cal.get("week") or "mon-fri"
    name = str(spec.get("title") or spec.get("name") or "Programme")[:200]
    start = str(spec.get("start") or (rows[0].get("start") if rows else "") or datetime.date.today().isoformat())[:10]
    finish = max([str(r.get("finish") or "")[:10] for r in rows] or [start])
    e = escape
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<Project xmlns="%s">' % NS,
           "<SaveVersion>14</SaveVersion>", "<Name>%s.xml</Name>" % e(name), "<Title>%s</Title>" % e(name),
           "<ScheduleFromStart>1</ScheduleFromStart>",
           "<StartDate>%sT08:00:00</StartDate>" % start, "<FinishDate>%sT17:00:00</FinishDate>" % finish,
           "<CalendarUID>1</CalendarUID>", "<DefaultStartTime>08:00:00</DefaultStartTime>", "<DefaultFinishTime>17:00:00</DefaultFinishTime>",
           "<MinutesPerDay>480</MinutesPerDay>", "<MinutesPerWeek>%d</MinutesPerWeek>" % (480 * (7 if week == "all" else 6 if week == "mon-sat" else 5)),
           "<DaysPerMonth>20</DaysPerMonth>", "<DurationFormat>7</DurationFormat>",
           "<ExtendedAttributes><ExtendedAttribute><FieldID>%s</FieldID><FieldName>Text1</FieldName><Alias>Responsible</Alias></ExtendedAttribute></ExtendedAttributes>" % TEXT1,
           "<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>"]
    times = "<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>"
    for dtp in range(1, 8):                    # 1 Sunday ... 7 Saturday
        on = week == "all" or (2 <= dtp <= 6) or (dtp == 7 and week == "mon-sat")
        out.append("<WeekDay><DayType>%d</DayType><DayWorking>%d</DayWorking>%s</WeekDay>" % (dtp, 1 if on else 0, times if on else ""))
    offs = [(h, h) for h in (cal.get("holidays") or [])] + [((o.get("from") or ""), (o.get("to") or o.get("from") or "")) for o in (cal.get("off") or []) if isinstance(o, dict)]
    for a, b in offs:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", str(a)) and re.match(r"^\d{4}-\d{2}-\d{2}$", str(b)):
            out.append("<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>%sT00:00:00</FromDate><ToDate>%sT23:59:00</ToDate></TimePeriod></WeekDay>" % (a, b))
    out.append("</WeekDays></Calendar></Calendars><Tasks>")
    out.append("<Task><UID>0</UID><ID>0</ID><Name>%s</Name><Type>1</Type><IsNull>0</IsNull><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel>"
               "<Start>%sT08:00:00</Start><Finish>%sT17:00:00</Finish><Summary>1</Summary></Task>" % (e(name), start, finish))
    counters = []
    skipped = 0
    for i, r in enumerate(rows):
        lv = max(0, int(r.get("level") or 0))
        counters = counters[:lv + 1] + [0] * max(0, lv + 1 - len(counters))
        counters[lv] += 1
        outline = ".".join(str(x or 1) for x in counters[:lv + 1])
        ms = bool(r.get("milestone"))
        summ = bool(r.get("summary"))
        dur = 0 if ms else int(r.get("dur") or 0)
        s0 = str(r.get("start") or start)[:10]
        f0 = str(r.get("finish") or s0)[:10]
        x = ["<Task>", "<UID>%d</UID>" % (i + 1), "<ID>%d</ID>" % (i + 1), "<Name>%s</Name>" % e(str(r.get("name") or "")),
             "<Type>%d</Type>" % (1 if ms or summ else 0), "<IsNull>0</IsNull>", "<WBS>%s</WBS>" % outline,
             "<OutlineNumber>%s</OutlineNumber>" % outline, "<OutlineLevel>%d</OutlineLevel>" % (lv + 1),
             "<Start>%sT%s</Start>" % (s0, "17:00:00" if ms and r.get("ms_end") else "08:00:00"),
             "<Finish>%sT17:00:00</Finish>" % f0, "<Duration>%s</Duration>" % _dur(dur), "<DurationFormat>7</DurationFormat>",
             "<Milestone>%d</Milestone>" % (1 if ms else 0), "<Summary>%d</Summary>" % (1 if summ else 0),
             "<PercentComplete>%d</PercentComplete>" % int(r.get("pct") or 0)]
        own = str(r.get("own_start") or "")[:10]
        fn = str(r.get("fnet") or "")[:10]
        if fn and not summ and re.match(r"^\d{4}-\d{2}-\d{2}$", fn):
            x += ["<ConstraintType>6</ConstraintType>", "<ConstraintDate>%sT17:00:00</ConstraintDate>" % fn]
        elif own and not summ:
            x += ["<ConstraintType>4</ConstraintType>", "<ConstraintDate>%sT08:00:00</ConstraintDate>" % own]
        else:
            x.append("<ConstraintType>0</ConstraintType>")
        if r.get("notes"):
            x.append("<Notes>%s</Notes>" % e(str(r["notes"])))
        for d in r.get("deps") or []:
            try:
                fi = int(d.get("from"))
            except (TypeError, ValueError):
                continue
            if d.get("drive") is False:
                skipped += 1
                continue
            x.append("<PredecessorLink><PredecessorUID>%d</PredecessorUID><Type>%d</Type><CrossProject>0</CrossProject>"
                     "<LinkLag>%d</LinkLag><LagFormat>7</LagFormat></PredecessorLink>" % (fi + 1, TYPE_OUT.get(d.get("type"), 1), int(round(float(d.get("lag") or 0) * 480 * 10))))
        if r.get("party"):
            x.append("<ExtendedAttribute><FieldID>%s</FieldID><Value>%s</Value></ExtendedAttribute>" % (TEXT1, e(str(r["party"]))))
        x.append("</Task>")
        out.append("".join(x))
    out.append("</Tasks></Project>")
    xml = "\n".join(out)
    if skipped:
        xml = xml.replace("<Tasks>", "<!-- %d related-only link(s) left out: MS Project has no such link -->\n<Tasks>" % skipped, 1)
    return xml.encode("utf-8")
