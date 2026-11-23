"""Site study: the office OZP list and reading a plan's Notes.

    python3 tests_ozp.py
"""
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ozp  # noqa: E402

TKO = os.environ.get("OZP_TKO_PDF", "/root/.claude/uploads/20d4d1dc-e6ba-5c7a-ab36-654a383c7488/057c1f1d-s_tko_32_e.pdf")


class Core(object):
    def __init__(self, d):
        self.CFG = {"data": d}


SAMPLE = """
                               COMPREHENSIVE DEVELOPMENT AREA

                                                 Remarks

(a)   Pursuant to section 4A(2) of the Ordinance, ...

(b)   On land designated "CDA", no new development shall result in a total development in
      excess of a maximum plot ratio of 2 and a maximum building height of 15 storeys.

(c)   Minor relaxation ...

                             EXPLANATORY STATEMENT

 maximum plot ratio of 9
"""


class List(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.core = Core(self.d)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_put_find_remove(self):
        ozp.put(self.core, " s/tm-ltyy/14 ", "cda", {"dpr": "2", "npr": 0.11, "storeys": 15, "sc": "", "x": 9}, "Notes, CDA (b)", "Wilson")
        d = ozp.load(self.core)
        z = d["plans"]["S/TM-LTYY/14"]["zones"]["CDA"]
        self.assertEqual((z["dpr"], z["npr"], z["storeys"], z["by"]), (2, 0.11, 15, "Wilson"))
        self.assertNotIn("sc", z)
        self.assertNotIn("x", z)
        ozp.remove(self.core, "S/TM-LTYY/14", "CDA")
        self.assertEqual(ozp.load(self.core)["plans"], {})


class Notes(unittest.TestCase):
    def test_sample_cda(self):
        r = ozp.read_notes(SAMPLE)
        self.assertEqual(len(r["zones"]), 1)
        z = r["zones"][0]
        self.assertEqual(z["zone"], "CDA")
        self.assertEqual(z["values"], {"pr": 2, "storeys": 15})
        self.assertIn("15 storeys", z["evidence"]["storeys"])

    @unittest.skipUnless(os.path.exists(TKO) and ozp.shutil.which("pdftotext"), "the TKO Notes PDF")
    def test_tko_32(self):
        r = ozp.read_notes(ozp.pdf_text(TKO))
        self.assertEqual(r["plan"], "S/TKO/32")
        z = {x["zone"]: x["values"] for x in r["zones"]}
        self.assertEqual(z["R(A)9"], {"dpr": 7.5, "npr": 0.3, "bhPlan": True})
        self.assertEqual(z["R(A)4 Area (b)"]["bh"], 35)
        self.assertEqual(z["R(A)2"], {"dpr": 5, "npr": 0.5, "sc": 50, "bh": 100})
        self.assertEqual(z["R(A)7"]["pr"], 6.5)


if __name__ == "__main__":
    unittest.main()
