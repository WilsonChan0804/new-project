"""The Programme's storage and its PDF.

    python3 tests_programme.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import programme  # noqa: E402
import programme_pdf  # noqa: E402
import programme_xml  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Core(object):
    def __init__(self, root):
        self.root = root

    def project_root_for(self, pid):
        d = os.path.join(self.root, pid)
        os.makedirs(d, exist_ok=True)
        return d


def task(i, name, **kw):
    t = {"id": i, "name": name, "level": 0, "kind": "task", "start": "", "dur": 5, "pct": 0, "deps": []}
    t.update(kw)
    return t


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.core = Core(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_new_is_empty(self):
        p = programme.load(self.core, "P1")
        self.assertEqual((p["rev"], p["data"]), (0, {}))

    def test_save_conflict_history(self):
        tasks = [task("a", "Design", start="2027-03-01"), task("b", "Tender", deps=[{"from": "a", "type": "FS", "lag": 2}, {"from": "gone", "type": "FS"}])]
        a = programme.save(self.core, "P1", 0, {"tasks": tasks, "calendar": {"week": "mon-fri"}, "junk": 1}, "Ann")
        self.assertEqual(a["rev"], 1)
        self.assertNotIn("junk", a["data"])
        self.assertEqual(a["data"]["tasks"][1]["deps"], [{"from": "a", "type": "FS", "lag": 2}])   # a link to a task that is gone goes
        with self.assertRaises(HTTPException) as e:
            programme.save(self.core, "P1", 0, {"tasks": []}, "Bob")
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual(e.exception.detail["current"]["rev"], 1)
        programme.save(self.core, "P1", 1, {"tasks": tasks[:1]}, "Bob")
        h = programme.history(self.core, "P1")
        self.assertEqual([(x["rev"], x["by"], x["tasks"]) for x in h], [(2, "Bob", 1), (1, "Ann", 2)])

    def test_refused(self):
        for bad in ({"tasks": "x"}, {"tasks": [{"name": "no id"}]}, {"tasks": [task("a", "A"), task("a", "B")]},
                    {"tasks": [task("a", "A", start="1/3/2027")]}, {"tasks": [task("a", "A", deps=[{"from": "b", "type": "XX"}])]}):
            with self.assertRaises(HTTPException, msg=str(bad)):
                programme.save(self.core, "P1", 0, bad, "Ann")


SPEC = {
    "cover": {"title": "Indicative Project Programme", "project": "Kai Tak School", "client": "EDB", "rev": "B",
              "date": "2027-03-01", "prepared": "Ann", "status_date": "2027-03-20"},
    "start": "2027-03-01", "finish": "2027-05-07",
    "columns": [{"key": "id", "label": "ID", "w": 8, "align": "right"}, {"key": "name", "label": "Task name", "w": 60},
                {"key": "dur", "label": "Duration", "w": 16, "align": "right"}, {"key": "start", "label": "Start", "w": 20},
                {"key": "finish", "label": "Finish", "w": 20}, {"key": "pred", "label": "Predecessors", "w": 22}],
    "rows": [
        {"name": "Design", "level": 0, "summary": True, "critical": True, "start": "2027-03-01", "finish": "2027-04-09", "pct": 40, "cells": {"id": "1"}},
        {"name": "Scheme design", "level": 1, "critical": True, "start": "2027-03-01", "finish": "2027-03-19", "pct": 100,
         "bstart": "2027-03-01", "bfinish": "2027-03-12", "cells": {"id": "2", "dur": "15 d", "start": "1 Mar 27", "finish": "19 Mar 27"}},
        {"name": "Detailed design 詳細設計", "level": 1, "critical": False, "start": "2027-03-22", "finish": "2027-04-09", "pct": 0,
         "cells": {"id": "3", "pred": "2"}},
        {"name": "Approval", "level": 0, "milestone": True, "critical": True, "start": "2027-04-12", "finish": "2027-04-12", "cells": {"id": "4"}},
    ],
    "links": [{"from": 1, "to": 2, "type": "FS"}, {"from": 2, "to": 3, "type": "FS", "critical": True}, {"from": 1, "to": 3, "type": "SS"}],
    "show": {"baseline": True},
    "remarks": ["Subject to the approval of the Buildings Department."],
    "_plain": True,
}


class Pdf(unittest.TestCase):
    def test_draws(self):
        data = programme_pdf.build(SPEC)
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertIn(b".776471 .156863 .156863 rg", data)   # critical red
        self.assertIn(b"/MediaBox [ 0 0 1190.551 841.8898 ]", data)                            # A3 landscape

    @unittest.skipUnless(shutil.which("pdftotext"), "needs poppler")
    def test_text_and_pages(self):
        tmp = tempfile.mkdtemp()
        try:
            rows = [dict(SPEC["rows"][1], name="Task %d" % i) for i in range(120)]
            p = os.path.join(tmp, "p.pdf")
            with open(p, "wb") as f:
                f.write(programme_pdf.build(dict(SPEC, rows=rows, paper="A4", orient="portrait", _plain=False)))
            txt = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True).stdout
            self.assertIn("Indicative Project Programme", txt)
            self.assertIn("Task 119", txt)
            self.assertRegex(txt, r"Page 1 of [3-9]")
            self.assertIn("Remarks", txt)
            self.assertIn("Kai Tak School", txt)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


MSPDI = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
 <Title>Wellmont</Title><MinutesPerDay>480</MinutesPerDay><CalendarUID>1</CalendarUID>
 <ExtendedAttributes><ExtendedAttribute><FieldID>188743731</FieldID><FieldName>Text1</FieldName><Alias>Responsible</Alias></ExtendedAttribute></ExtendedAttributes>
 <Calendars><Calendar><UID>1</UID><Name>Standard</Name><WeekDays>
  <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>2</DayType><DayWorking>1</DayWorking></WeekDay>
  <WeekDay><DayType>7</DayType><DayWorking>1</DayWorking></WeekDay>
  <WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>2019-07-04T00:00:00</FromDate><ToDate>2019-07-04T23:59:00</ToDate></TimePeriod></WeekDay>
 </WeekDays></Calendar></Calendars>
 <Tasks>
  <Task><UID>0</UID><ID>0</ID><Name>Wellmont</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
  <Task><UID>1</UID><ID>1</ID><Name>Notice to Proceed</Name><OutlineLevel>1</OutlineLevel><Start>2019-06-03T08:00:00</Start><Duration>PT0H0M0S</Duration><Milestone>1</Milestone></Task>
  <Task><UID>2</UID><ID>2</ID><Name>Mobilization</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Duration>PT80H0M0S</Duration></Task>
  <Task><UID>3</UID><ID>3</ID><Name>Mobilize</Name><OutlineLevel>2</OutlineLevel><Duration>PT80H0M0S</Duration><PercentComplete>40</PercentComplete>
   <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
   <ExtendedAttribute><FieldID>188743731</FieldID><Value>Contractor</Value></ExtendedAttribute></Task>
  <Task><UID>4</UID><ID>4</ID><Name>Grade Site</Name><OutlineLevel>2</OutlineLevel><Duration>PT64H0M0S</Duration><ConstraintType>4</ConstraintType><ConstraintDate>2019-06-24T08:00:00</ConstraintDate>
   <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type><LinkLag>-4800</LinkLag></PredecessorLink>
   <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>0</Type></PredecessorLink>
   <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>2</Type></PredecessorLink><Notes>Note &amp; more</Notes></Task>
 </Tasks></Project>"""


class Xml(unittest.TestCase):
    def test_read(self):
        r = programme_xml.read(MSPDI.encode("utf-8"))
        t = r["tasks"]
        self.assertEqual([x["name"] for x in t], ["Notice to Proceed", "Mobilization", "Mobilize", "Grade Site"])
        self.assertEqual([x["level"] for x in t], [0, 0, 1, 1])
        self.assertEqual((t[0]["kind"], t[0]["start"]), ("milestone", "2019-06-03"))
        self.assertEqual((t[2]["dur"], t[2]["pct"], t[2]["party"], t[2]["deps"]), (10, 40, "Contractor", [{"from": t[0]["id"], "type": "FS", "lag": 2}]))
        self.assertEqual([(d["type"], d["lag"]) for d in t[3]["deps"]], [("SS", -1), ("FF", 0), ("SF", 0)])
        self.assertEqual((t[3]["start"], t[3]["notes"]), ("2019-06-24", "Note & more"))
        self.assertEqual(r["calendar"]["week"], "mon-sat")
        self.assertEqual(r["calendar"]["holidays"], ["2019-07-04"])
        self.assertEqual(r["name"], "Wellmont")

    def test_refuse(self):
        for bad in (b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Project>&e;</Project>', b"<nope/>", b"not xml"):
            with self.assertRaises(programme_xml.Refused):
                programme_xml.read(bad)

    def test_round_trip(self):
        spec = {"title": "Kai Tak", "calendar": {"week": "mon-fri", "holidays": ["2027-04-05"], "off": [{"from": "2027-02-01", "to": "2027-02-05"}]},
                "rows": [{"name": "Design", "level": 0, "summary": True, "start": "2027-03-01", "finish": "2027-03-19", "dur": 15},
                         {"name": "Scheme", "level": 1, "start": "2027-03-01", "finish": "2027-03-12", "dur": 10, "own_start": "2027-03-01", "party": "Architect", "pct": 50},
                         {"name": "Detail", "level": 1, "start": "2027-03-15", "finish": "2027-03-19", "dur": 5, "fnet": "2027-03-19", "deps": [{"from": 1, "type": "FS", "lag": 0}, {"from": 0, "type": "SS", "lag": 0, "drive": False}]},
                         {"name": "Approval", "level": 0, "milestone": True, "ms_end": True, "start": "2027-03-19", "finish": "2027-03-19", "deps": [{"from": 2, "type": "FS", "lag": 3}]}]}
        xml = programme_xml.write(spec)
        self.assertIn(b"related-only link(s) left out", xml)
        r = programme_xml.read(xml)
        t = r["tasks"]
        self.assertEqual([(x["name"], x["level"], x["kind"]) for x in t], [("Design", 0, "task"), ("Scheme", 1, "task"), ("Detail", 1, "task"), ("Approval", 0, "milestone")])
        self.assertEqual((t[1]["dur"], t[1]["start"], t[1]["party"], t[1]["pct"]), (10, "2027-03-01", "Architect", 50))
        self.assertEqual([(d["from"], d["type"], d["lag"]) for d in t[2]["deps"]], [(t[1]["id"], "FS", 0)])
        self.assertEqual(t[3]["deps"][0]["lag"], 3)
        self.assertEqual((t[2]["fnet"], t[1]["fnet"]), ("2027-03-19", ""))
        self.assertIn(b"<ConstraintType>6</ConstraintType>", xml)
        self.assertEqual(r["calendar"]["holidays"], ["2027-04-05"])
        self.assertEqual(r["calendar"]["off"][0]["from"], "2027-02-01")


class Mpp(unittest.TestCase):
    SAMPLE = os.environ.get("MPP_SAMPLE", "")

    def test_finish_constraints(self):
        x = MSPDI.replace("<Name>Grade Site</Name>", "<Name>Grade Site</Name><ConstraintType>6</ConstraintType><ConstraintDate>2019-07-01T08:00:00</ConstraintDate>")
        t = programme_xml.read(x.encode("utf-8"))["tasks"][3]
        self.assertEqual(t["fnet"], "2019-06-30")        # 08:00 of the next day = the end of the 30th

    def test_mpp_needs_java_and_mpxj(self):
        ole = programme_xml.MPP_MAGIC + b"\0" * 504
        self.assertTrue(programme_xml.is_mpp(ole))
        self.assertFalse(programme_xml.is_mpp(b"<?xml"))
        real = shutil.which
        try:
            shutil.which = lambda n: None
            with self.assertRaisesRegex(programme_xml.Refused, "Java and MPXJ"):
                programme_xml.mpp_to_xml(ole)
        finally:
            shutil.which = real

    @unittest.skipUnless(SAMPLE and os.path.exists(SAMPLE) and shutil.which("java") and programme_xml._mpxj_lib(), "set MPP_SAMPLE to an .mpp; needs Java and MPXJ")
    def test_real_mpp(self):
        with open(self.SAMPLE, "rb") as f:
            raw = f.read()
        r = programme_xml.read(programme_xml.mpp_to_xml(raw))
        self.assertTrue(r["tasks"])
        self.assertTrue(any(t["deps"] for t in r["tasks"]))


class PdfWide(unittest.TestCase):
    @unittest.skipUnless(shutil.which("pdftotext"), "needs poppler")
    def test_pages_wide_and_colours(self):
        tmp = tempfile.mkdtemp()
        try:
            spec = dict(SPEC, pages_wide=3, _plain=True,
                        rows=[dict(r, fill="#2e7d32") for r in SPEC["rows"]],
                        links=SPEC["links"] + [{"from": 0, "to": 2, "type": "FS", "drive": False}],
                        categories=[{"name": "Construction", "color": "#2e7d32"}])
            data = programme_pdf.build(spec)
            self.assertIn(b".180392 .490196 .196078 rg", data)          # the category's green fill
            self.assertIn(b"[2.2 1.4] 0 d", data)                        # a dashed (related) link
            p = os.path.join(tmp, "w.pdf")
            with open(p, "wb") as f:
                f.write(data)
            txt = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True).stdout
            pages = txt.split("\f")
            self.assertRegex(txt, r"Page 3 of 3")
            self.assertIn("Scheme design", pages[1])                     # the names again on page 2
            self.assertNotIn("Predecessors", pages[1])                   # but not the other columns
            self.assertIn("Related link", txt)
            self.assertIn("Construction", txt)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
