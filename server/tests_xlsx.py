"""The Excel writer and the comment-response schedule:
    python3 tests_xlsx.py
"""
import io
import sys
import unittest
import xml.dom.minidom
import zipfile

import query_xlsx
from xlsx import Workbook, col_name


class Xlsx(unittest.TestCase):

    def test_columns(self):
        self.assertEqual([col_name(i) for i in (0, 25, 26, 51, 52, 701, 702)], ["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"])

    def test_parts_are_well_formed(self):
        wb = Workbook()
        ws = wb.sheet("A & <B>", [10, 20])
        ws.row(["x & y", 1, 2.5, None, [("bold", True), (" plain", False)]], style=wb.style(bold=True, border="lrtB"))
        ws.merge(0, 0, 0, 1)
        ws.freeze = (1, 0); ws.repeat_rows = (0, 0); ws.filter = (0, 0, 4)
        z = zipfile.ZipFile(io.BytesIO(wb.save()))
        for n in z.namelist():
            xml.dom.minidom.parseString(z.read(n))
        self.assertIn("xl/worksheets/sheet1.xml", z.namelist())

    def test_schedule(self):
        qs = [{"number": 1, "code": "Q-001", "title": "Door", "question": "FRR 60", "status": "Open", "due": "2026-10-01",
               "source": "FSD", "source_ref": "FSD/1", "source_date": "2026-09-20", "created_at": "2026-09-21T00:00:00Z"},
              {"number": 2, "code": "Q-002", "title": "Stair", "status": "Answered", "answer": "Done", "answered_by": "W",
               "answered_at": "2026-09-25T00:00:00Z", "source": "BD", "created_at": "2026-09-21T00:00:00Z"}]
        z = zipfile.ZipFile(io.BytesIO(query_xlsx.schedule({"name": "Tower", "code": "P1"}, qs, "2026-11-04")))
        sst = z.read("xl/sharedStrings.xml").decode("utf-8")
        for want in ("Comment-Response Schedule", "Fire Services Department (FSD)", "Buildings Department (BD)", "Overdue", "Answered"):
            self.assertIn(want, sst)
        # BD comes before FSD
        self.assertLess(sst.index("Buildings Department"), sst.index("Fire Services"))


if __name__ == "__main__":
    sys.exit(unittest.main())
