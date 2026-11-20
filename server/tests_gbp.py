"""The GBP workbook's storage and its Excel.

    python3 tests_gbp.py
"""
import io
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import gbp  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Core(object):
    def __init__(self, root):
        self.root = root

    def project_root_for(self, pid):
        d = os.path.join(self.root, pid)
        os.makedirs(d, exist_ok=True)
        return d


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.core = Core(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_new_is_empty(self):
        wb = gbp.load(self.core, "P1")
        self.assertEqual(wb["rev"], 0)
        self.assertEqual(wb["data"], {})

    def test_save_and_conflict(self):
        a = gbp.save(self.core, "P1", 0, {"site": {"area": 7192.891, "cls": "B"}, "junk": 1}, "Ann")
        self.assertEqual(a["rev"], 1)
        self.assertNotIn("junk", a["data"])                     # only the workbook's own parts
        self.assertEqual(gbp.load(self.core, "P1")["data"]["site"]["cls"], "B")
        with self.assertRaises(HTTPException) as e:              # someone saved meanwhile
            gbp.save(self.core, "P1", 0, {"site": {}}, "Bob")
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual(e.exception.detail["current"]["rev"], 1)
        b = gbp.save(self.core, "P1", 1, {"site": {"area": 1}}, "Bob")
        self.assertEqual(b["rev"], 2)
        self.assertEqual(len(os.listdir(os.path.join(self.tmp, "P1", "gbp", "history"))), 2)

    def test_bad_part(self):
        with self.assertRaises(HTTPException):
            gbp.save(self.core, "P1", 0, {"site": "not a table"}, "Ann")
        with self.assertRaises(HTTPException):
            gbp.save(self.core, "P1", 0, ["no"], "Ann")

    def test_xlsx(self):
        data = gbp.make_xlsx([{"name": "MOE: rooms", "title": "Schedule of exit routes", "note": "FS Code Table B2",
                               "head": ["Room", "Load", "Status"], "rows": [["ASSEMBLY HALL", 707, "OK"], ["X", 5, "Fails"]],
                               "marks": ["ok", "fail"]}], project="P1")
        z = zipfile.ZipFile(io.BytesIO(data))
        names = z.namelist()
        self.assertIn("xl/workbook.xml", names)
        shared = z.read("xl/sharedStrings.xml").decode("utf-8")
        self.assertIn("ASSEMBLY HALL", shared)
        self.assertIn("Schedule of exit routes", shared)
        self.assertIn("MOE  rooms", z.read("xl/workbook.xml").decode("utf-8"))   # ":" is not allowed in a sheet name


if __name__ == "__main__":
    unittest.main()
