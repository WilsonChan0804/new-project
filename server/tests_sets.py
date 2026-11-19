"""Copying and transferring sheets between sets.

    python3 tests_sets.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import app  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Sets(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self._ocr = app.queue_ocr
        app.queue_ocr = lambda root, pdfs: None
        os.makedirs(os.path.join(self.root, "sheets"))
        os.makedirs(os.path.join(self.root, "imported"))
        for n in ("A-101", "A-102"):
            open(os.path.join(self.root, "sheets", n + ".pdf"), "wb").write(b"%PDF-1.4 " + n.encode())
        open(os.path.join(self.root, "imported", "d-1.pdf"), "wb").write(b"%PDF-1.4 imported")
        json.dump({"sheets": [{"number": "A-101", "name": "Plan", "pdf": "sheets/A-101.pdf"},
                              {"number": "A-102", "name": "Section", "pdf": "sheets/A-102.pdf"}]},
                  open(os.path.join(self.root, "manifest.json"), "w"))
        app.write_imported(self.root, [
            {"number": "S-1", "name": "One", "pdf": "imported/d-1.pdf", "page": 1, "external": True, "set": "S1"},
            {"number": "S-2", "name": "Two", "pdf": "imported/d-1.pdf", "page": 2, "external": True, "set": "S1"}])
        app.write_sheet_meta(self.root, {"hidden": {}, "groups": [{"id": "g1", "name": "Plans", "set": "S1", "sheets": ["S-1", "S-2"]}],
                                         "deleted": {}, "order": {}})

    def tearDown(self):
        app.queue_ocr = self._ocr
        shutil.rmtree(self.root, ignore_errors=True)

    def sets(self):
        return {s["number"]: s.get("set") for s in app.read_imported(self.root)}

    def test_transfer(self):
        out = app.transfer_sheets(self.root, ["S-1"], "S2")
        self.assertEqual(out["sheets"], 1)
        self.assertEqual(self.sets(), {"S-1": "S2", "S-2": "S1"})        # the number is kept
        g = app.read_sheet_meta(self.root)["groups"][0]
        self.assertEqual(g["sheets"], ["S-2"])                          # out of the old set's group

    def test_transfer_revit_refused(self):
        with self.assertRaises(HTTPException) as e:
            app.transfer_sheets(self.root, ["A-101"], "S2")
        self.assertEqual(e.exception.status_code, 400)
        with self.assertRaises(HTTPException):
            app.transfer_sheets(self.root, ["S-1"], "  ")

    def test_copy_imported(self):
        out = app.copy_sheets(self.root, ["S-1", "S-2"], "S1")
        nums = [a["number"] for a in out["added"]]
        self.assertEqual(nums, ["S-1 (2)", "S-2 (2)"])
        have = {s["number"]: s for s in app.read_imported(self.root)}
        self.assertEqual(have["S-1 (2)"]["pdf"], "imported/d-1.pdf")
        self.assertEqual(have["S-2 (2)"]["page"], 2)
        self.assertEqual(have["S-1 (2)"]["copied_from"], "S-1")

    def test_copy_revit_frozen(self):
        out = app.copy_sheets(self.root, ["A-101"], "Submission 1")
        a = out["added"][0]
        self.assertEqual(a["number"], "A-101 (2)")
        self.assertTrue(a["pdf"].startswith("imported/A-101-"))
        full = os.path.join(self.root, a["pdf"])
        self.assertEqual(open(full, "rb").read(), b"%PDF-1.4 A-101")
        # a later publish changing the Revit PDF does not change the copy
        open(os.path.join(self.root, "sheets", "A-101.pdf"), "wb").write(b"%PDF-1.4 new")
        self.assertEqual(open(full, "rb").read(), b"%PDF-1.4 A-101")

    def test_delete_source_set_keeps_shared_pdf(self):
        app.copy_sheets(self.root, ["S-1"], "Copy")
        before = app.read_imported(self.root)
        keep = [s for s in before if s.get("set") != "S1"]
        app.write_imported(self.root, keep)
        app.drop_unused_pdfs(self.root, before, keep)
        self.assertTrue(os.path.isfile(os.path.join(self.root, "imported", "d-1.pdf")))


if __name__ == "__main__":
    unittest.main()
