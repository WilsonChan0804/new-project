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


if __name__ == "__main__":
    unittest.main()
