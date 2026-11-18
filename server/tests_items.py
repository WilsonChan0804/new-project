"""Archive, endorse and moving a markup to another sheet: who may, and what
the server records.

    python3 tests_items.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import app  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def who(uid, name):
    return app.Who({"id": uid, "name": name, "is_admin": 0})


AUTHOR, RAISER, OTHER = who(1, "Ann Author"), who(2, "Ray Raiser"), who(3, "Olly Other")


def item(**kw):
    it = {"id": "i1", "sheet": "A-101", "type": "cloud", "author": "Ann Author", "author_id": 1,
          "issue": {"title": "Door", "status": "Closed", "author": "Ray Raiser", "author_id": 2}}
    it.update(kw)
    return it


class Rules(unittest.TestCase):
    def setUp(self):
        self._acc = app.accounts_on
        app.accounts_on = lambda: True

    def tearDown(self):
        app.accounts_on = self._acc

    def allowed(self, prev, new, w, role="member"):
        try:
            app.check_item_rules(prev, new, w, role)
            return True
        except HTTPException:
            return False

    def test_archive(self):
        prev = item()
        new = item(archived={"by": "x"})
        self.assertTrue(self.allowed(prev, new, AUTHOR))
        self.assertFalse(self.allowed(prev, new, OTHER))
        self.assertTrue(self.allowed(prev, new, OTHER, role="admin"))
        # restoring is the same rule
        self.assertFalse(self.allowed(item(archived={"by": "x"}), item(), RAISER))

    def test_move_sheet(self):
        prev, new = item(), item(sheet="A-102")
        self.assertTrue(self.allowed(prev, new, AUTHOR))
        self.assertFalse(self.allowed(prev, new, OTHER))
        self.assertTrue(self.allowed(prev, new, OTHER, role="admin"))

    def test_endorse(self):
        prev = item()
        new = item()
        new["issue"] = dict(prev["issue"], endorsed=True)
        self.assertTrue(self.allowed(prev, new, RAISER))
        self.assertFalse(self.allowed(prev, new, AUTHOR))     # made the markup, did not raise the issue
        self.assertFalse(self.allowed(prev, new, OTHER))
        self.assertTrue(self.allowed(prev, new, OTHER, role="admin"))
        # only a closed issue
        p2 = item()
        p2["issue"]["status"] = "Resolved"
        n2 = item()
        n2["issue"] = dict(p2["issue"], endorsed=True)
        self.assertFalse(self.allowed(p2, n2, RAISER))

    def test_new_items_free(self):
        self.assertTrue(self.allowed(None, item(archived={"by": "x"}), OTHER))


class Stamp(unittest.TestCase):
    def test_endorse_recorded_and_cleared(self):
        prev = item()
        new = item()
        new["issue"] = dict(prev["issue"], endorsed={"by": "forged", "at": "1999"})
        out = app.stamp(prev, new, RAISER)
        self.assertEqual(out["issue"]["endorsed"]["by"], "Ray Raiser")
        self.assertNotEqual(out["issue"]["endorsed"]["at"], "1999")
        self.assertTrue(any(h.get("event") == "endorsed" for h in out["issue"]["history"]))
        # reopened: no longer endorsed
        again = dict(out)
        again["issue"] = dict(out["issue"], status="Open")
        out2 = app.stamp(out, again, AUTHOR)
        self.assertNotIn("endorsed", out2["issue"])

    def test_archive_recorded(self):
        out = app.stamp(item(), item(archived=True), AUTHOR)
        self.assertEqual(out["archived"]["by"], "Ann Author")
        self.assertTrue(any(h.get("event") == "archived" for h in out["issue"]["history"]))
        back = app.stamp(out, item(), AUTHOR)
        self.assertNotIn("archived", back)


if __name__ == "__main__":
    unittest.main()
