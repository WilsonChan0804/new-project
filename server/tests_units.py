"""The office's unit library.

    python3 tests_units.py
"""
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import units  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class Core(object):
    def __init__(self, d):
        self.CFG = {"data": d}


U = {"name": "1-room A", "type": "1R", "rows": [{"depth": 2.4, "rooms": [{"kind": "BR", "w": 2.4}]}], "extras": [], "junk": 1}


class Library(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.core = Core(self.d)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_save_list_update_remove(self):
        d = units.put(self.core, None, U, "Wilson")
        self.assertEqual(len(d["units"]), 1)
        row = d["units"][0]
        self.assertEqual((row["name"], row["by"]), ("1-room A", "Wilson"))
        self.assertNotIn("junk", row["unit"])
        u2 = dict(U, name="1-room B")
        d = units.put(self.core, row["id"], u2, "Wilson")
        self.assertEqual([x["name"] for x in d["units"]], ["1-room B"])
        with self.assertRaises(HTTPException):
            units.remove(self.core, row["id"], "Someone", False)
        d = units.remove(self.core, row["id"], "Someone", True)
        self.assertEqual(d["units"], [])

    def test_not_a_unit(self):
        with self.assertRaises(HTTPException):
            units.put(self.core, None, {"name": "x"}, "W")


if __name__ == "__main__":
    unittest.main()
