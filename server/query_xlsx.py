# -*- coding: utf-8 -*-
"""The comment-response schedule: a project's queries as an Excel workbook.

Every party's comments (BD, FSD, the client, the consultants ...) are kept
as queries, each with who it came from, their letter reference and date.
This sets them out the way a submission's reply table is read: grouped by
who sent it and their letter, one row per comment with our response, who
answered and when, and the status - and a Summary sheet with the counts.

    data = schedule(project, queries, today="2026-11-04")   # .xlsx bytes
"""
import datetime

from xlsx import Workbook

NAVY = "1F3864"
BAND = "D9E1F2"
ZEBRA = "F6F8FB"
GREY = "595959"
# status: (fill, text)
STATUS = {
    "Open": ("FFF2CC", "7F6000"),
    "Answered": ("DDEBF7", "1F4E79"),
    "Closed": ("E2EFDA", "375623"),
    "Overdue": ("FADBD8", "9C0006"),
}
SOURCE_NAME = {
    "BD": "Buildings Department (BD)", "FSD": "Fire Services Department (FSD)", "Client": "Client",
    "Consultant": "Consultant", "Contractor": "Contractor", "Internal": "Internal", "Other": "Other",
    "": "Source not given",
}
ORDER = ("BD", "FSD", "Client", "Consultant", "Contractor", "Internal", "Other", "")

COLS = [  # (heading, width)
    ("Item", 7), ("Query", 8), ("From", 12), ("Their ref.", 15), ("Received", 11.5),
    ("Drawing / location", 18), ("Comment", 50), ("Our response", 50), ("Responded by", 15),
    ("Date", 11.5), ("Status", 11), ("Remarks / follow-up", 34),
]


def _date(s):
    try:
        return datetime.date(int(s[0:4]), int(s[5:7]), int(s[8:10])) if s and len(s) >= 10 else None
    except ValueError:
        return None


def status_of(q, today):
    if q.get("status") == "Open" and q.get("due") and q["due"] < today:
        return "Overdue"
    return q.get("status") or "Open"


def location_of(q):
    if (q.get("location") or "").strip():
        return q["location"].strip()
    seen = []
    for v in q.get("views") or []:
        s = v.get("sheet") or v.get("title") or ""
        if v.get("kind") == "view3d":
            s = "3D: " + (v.get("title") or "view")
        if s and s not in seen:
            seen.append(s)
    return ", ".join(seen)


def _lines(n_chars, width):
    """Rows a wrapped text needs at a column width (Arial 10)."""
    per = max(1.0, width * 1.15)
    return sum(max(1, int(len(part) / per) + 1) for part in (n_chars or "").split("\n"))


def schedule(project, queries, today=None, filters=""):
    today = today or datetime.date.today().isoformat()
    wb = Workbook()
    widths = [w for _, w in COLS]
    n = len(COLS)

    st_title = wb.style(bold=True, size=16, color=NAVY, v="center")
    st_sub = wb.style(bold=True, size=12, color="2F5597", v="center")
    st_meta = wb.style(size=9, color=GREY, v="center")
    st_head = wb.style(bold=True, color="FFFFFF", fill=NAVY, border=True, border_color="8EA9DB", h="center", v="center", wrap=True)
    st_band = wb.style(bold=True, color=NAVY, fill=BAND, border="tb", border_color="8EA9DB", v="center", indent=1)
    body = {}
    for z in (False, True):
        f = ZEBRA if z else None
        body[z] = {
            "text": wb.style(fill=f, border=True, wrap=True),
            "center": wb.style(fill=f, border=True, h="center", wrap=True),
            "date": wb.style(fill=f, border=True, h="center", numfmt="dd mmm yyyy"),
            "muted": wb.style(fill=f, border=True, wrap=True, color=GREY, size=9),
            "code": wb.style(fill=f, border=True, h="center", color=GREY, size=9),
        }
    st_status = dict((k, wb.style(bold=True, fill=fl, color=tx, border=True, h="center", wrap=True)) for k, (fl, tx) in STATUS.items())

    ws = wb.sheet("Comment-Response", widths)
    ws.tab_color = NAVY
    name = project.get("name") or project.get("short") or "Project"
    code = project.get("code") or ""
    all_q = sorted(queries, key=lambda q: q.get("number") or 0)
    counts = dict((k, 0) for k in STATUS)
    for q in all_q:
        counts[status_of(q, today)] += 1
    ws.row([name + (" (%s)" % code if code else "")], style=st_title, height=26)
    ws.merge(0, 0, 0, n - 1)
    ws.row(["Comment-Response Schedule"], style=st_sub, height=20)
    ws.merge(1, 0, 1, n - 1)
    meta = "Issued %s   ·   %d comment%s: %d open, %d overdue, %d answered, %d closed" % (
        _date(today).strftime("%d %b %Y"), len(all_q), "" if len(all_q) == 1 else "s",
        counts["Open"], counts["Overdue"], counts["Answered"], counts["Closed"])
    if filters:
        meta += "   ·   " + filters
    ws.row([meta], style=st_meta, height=16)
    ws.merge(2, 0, 2, n - 1)
    ws.row([""], height=6)
    hr = ws.row([h for h, _ in COLS], style=st_head, height=30)
    ws.freeze = (hr + 1, 0)
    ws.repeat_rows = (hr, hr)
    ws.filter = (hr, 0, n - 1)
    ws.header = ""
    ws.footer = "&L&8%s&C&8Comment-Response Schedule&R&8Page &P of &N" % name.replace("&", "&&")

    # grouped by who sent it, then their letter (ref + date)
    groups = {}
    for q in all_q:
        key = (q.get("source") or "", (q.get("source_ref") or "").strip(), q.get("source_date") or "")
        groups.setdefault(key, []).append(q)

    def gkey(k):
        src = k[0] if k[0] in ORDER else "Other"
        return (ORDER.index(src), k[2] or "9999", k[1].lower())

    gi = 0
    for key in sorted(groups, key=gkey):
        gi += 1
        rows = groups[key]
        src, sref, sdate = key
        d = _date(sdate)
        open_n = sum(1 for q in rows if status_of(q, today) in ("Open", "Overdue"))
        band = "%d.  %s" % (gi, SOURCE_NAME.get(src, src))
        if sref:
            band += "   ·   Ref. " + sref
        if d:
            band += "   ·   received " + d.strftime("%d %b %Y")
        band += "   ·   %d item%s%s" % (len(rows), "" if len(rows) == 1 else "s", (", %d open" % open_n) if open_n else ", all answered")
        r = ws.row([band] + [""] * (n - 1), style=st_band, height=20)
        ws.merge(r, 0, r, n - 1)
        for i, q in enumerate(rows):
            b = body[i % 2 == 1]
            st = status_of(q, today)
            title, ques = (q.get("title") or "").strip(), (q.get("question") or "").strip()
            if ques == title:
                ques = ""
            comment = title + ("\n" if title and ques else "") + ques
            rich = [(title + ("\n" if ques else ""), True), (ques, False)] if title else comment
            answer = (q.get("answer") or "").strip()
            fus = q.get("followups") or []
            last_ans = [f for f in fus if f.get("kind") == "answer"]
            by = (last_ans[-1].get("by") if last_ans else q.get("answered_by")) or ""
            at = (last_ans[-1].get("at") if last_ans else q.get("answered_at")) or ""
            remarks = []
            for f in fus:
                remarks.append("%s %s (%s): %s" % ("Q" if f.get("kind") == "question" else "A",
                                                    (f.get("at") or "")[:10], f.get("by") or "", (f.get("text") or "").strip()))
            if st in ("Open", "Overdue") and q.get("due"):
                remarks.insert(0, "Due %s" % _date(q["due"]).strftime("%d %b %Y") if _date(q["due"]) else "")
            if (q.get("to") or []) and st in ("Open", "Overdue"):
                remarks.insert(0, "With: " + ", ".join(p.get("name") or "" for p in q["to"]))
            remarks = "\n".join(x for x in remarks if x)
            loc = location_of(q)
            lines = max(_lines(comment, COLS[6][1]), _lines(answer, COLS[7][1]), _lines(remarks, COLS[11][1]),
                        _lines(loc, COLS[5][1]), 1)
            ws.row([
                ("%d.%d" % (gi, i + 1), b["center"]),
                (q.get("code") or "", b["code"]),
                (src or "-", b["center"]),
                (sref, b["text"]),
                (d, b["date"]),
                (loc, b["text"]),
                (rich, b["text"]),
                (answer or "", b["text"]),
                (by, b["text"]),
                (_date(at), b["date"]),
                (st, st_status[st]),
                (remarks, b["muted"]),
            ], height=min(409, max(18, 13.2 * lines + 4)))
    if not all_q:
        r = ws.row(["No comments yet."], style=body[False]["muted"], height=20)
        ws.merge(r, 0, r, n - 1)

    # ------------------------------------------------------------ summary
    sm = wb.sheet("Summary", [30, 11, 11, 11, 11, 11, 16])
    sm.landscape = False
    sm.paper = 9
    sm.row([name + (" (%s)" % code if code else "")], style=st_title, height=26)
    sm.merge(0, 0, 0, 6)
    sm.row(["Comment-Response Summary - " + _date(today).strftime("%d %b %Y")], style=st_sub, height=20)
    sm.merge(1, 0, 1, 6)
    sm.row([""], height=6)
    sm.row(["From", "Open", "Overdue", "Answered", "Closed", "Total", "Avg. days to answer"], style=st_head, height=30)
    num = wb.style(border=True, h="center")
    lab = wb.style(border=True, indent=1)
    tot_lab = wb.style(bold=True, border="lrtB", fill=BAND, indent=1)
    tot_num = wb.style(bold=True, border="lrtB", fill=BAND, h="center")
    tot = dict((k, 0) for k in STATUS)
    allday = []
    for src in ORDER:
        qs = [q for q in all_q if (q.get("source") or "") == src or (src == "Other" and (q.get("source") or "") not in ORDER)]
        if not qs:
            continue
        c = dict((k, 0) for k in STATUS)
        for q in qs:
            c[status_of(q, today)] += 1
        days = []
        for q in qs:
            a, b = _date(q.get("created_at") or ""), _date(q.get("answered_at") or "")
            if a and b:
                days.append(max(0, (b - a).days))
        allday += days
        for k in c:
            tot[k] += c[k]
        sm.row([SOURCE_NAME.get(src, src), c["Open"], c["Overdue"], c["Answered"], c["Closed"], len(qs),
                round(sum(days) / float(len(days)), 1) if days else "-"],
               styles=[lab, num, (st_status["Overdue"] if c["Overdue"] else num), num, num, num, num], height=18)
    sm.row(["Total", tot["Open"], tot["Overdue"], tot["Answered"], tot["Closed"], len(all_q),
            round(sum(allday) / float(len(allday)), 1) if allday else "-"],
           styles=[tot_lab] + [tot_num] * 6, height=20)
    sm.row([""])
    sm.row(["Overdue: open, with a due date before today. Days to answer: from the comment being entered to our first response."],
           style=wb.style(italic=True, size=9, color=GREY, wrap=True), height=28)
    sm.merge(sm.n - 1, 0, sm.n - 1, 6)
    sm.footer = "&L&8%s&R&8Page &P of &N" % name.replace("&", "&&")
    return wb.save()
