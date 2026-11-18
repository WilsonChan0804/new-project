# -*- coding: utf-8 -*-
"""Model Doctor in Revit and in the viewer agree on what a finding is, and
the fix queue is matched and answered (no Revit needed):
    python3 -m unittest discover -s revit/tests -v
"""
import io
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))
from modeldoctor import shared  # noqa: E402


class Signature(unittest.TestCase):
    def test_sorted_uids(self):
        self.assertEqual(shared.signature("wall_gaps", "Corner gap", ["u3", "u2"]), "wall_gaps|Corner gap|u2,u3")

    def test_hash_matches_the_viewer(self):
        # viewer/doctorcore.js hashText() of the same strings
        for s, h in [("wall_gaps|Corner gap|u2,u3", "1c3f8445q"),
                     ("door_floor|Door above floor|uid-20,uid-100", "c256c3ce16"),
                     (u"中文|測試|ä", "f69e82197")]:
            self.assertEqual(shared.hash_text(s), h)

    def test_accept_item_id_is_the_viewers(self):
        sig = "wall_gaps|Corner gap|u2,u3"
        it = shared.accept_item(sig, "wall_gaps", "Corner gap", ["u2", "u3"], "gap", "Ann")
        self.assertEqual(it["id"], "doctoraccept-1c3f8445q")
        self.assertEqual(shared.accepted_from([it, {"placement": "doctoraccept", "signature": "x", "deleted": True}]), {sig: it})


class Queue(unittest.TestCase):
    def setUp(self):
        self.q = [{"placement": "doctorfix", "signature": "door_floor|Door above floor|d1,f1", "uids": ["d1", "f1"], "check": "door_floor", "at": "2"},
                  {"placement": "doctorfix", "signature": "duplicates|Stacked duplicate|a,b", "uids": ["a", "b"], "check": "duplicates", "at": "1"},
                  {"placement": "doctorfix", "signature": "x|y|z9", "uids": ["z9"], "check": "x", "at": "3"},
                  {"placement": "doctorfix", "signature": "done", "uids": ["d1"], "status": "fixed", "at": "0"}]

    def test_waiting_only_oldest_first(self):
        q = shared.queue_from(self.q)
        self.assertEqual([it["check"] for it in q], ["duplicates", "door_floor", "x"])

    def test_this_model_and_matching(self):
        here_uids = {"d1", "f1", "a", "b"}
        mine, elsewhere = shared.queue_for_doc(shared.queue_from(self.q), lambda u: u in here_uids)
        self.assertEqual(len(mine), 2)
        self.assertEqual(elsewhere[0]["check"], "x")
        found = [("door_floor|Door above floor|d1,f1", "F1")]
        matched, missing = shared.match_queue(mine, found)
        self.assertEqual([(it["check"], f) for it, f in matched], [("door_floor", "F1")])
        self.assertEqual([it["check"] for it in missing], ["duplicates"])

    def test_answered(self):
        d = shared.done_item(self.q[0], "skipped", "wall is pinned", "Ann")
        self.assertEqual((d["status"], d["reason"], d["done_by"]), ("skipped", "wall is pinned", "Ann"))
        self.assertNotIn("status", self.q[0])            # the queue item itself is left as it was


class Csv(unittest.TestCase):
    def test_unicode_and_quotes(self):
        path = os.path.join(tempfile.mkdtemp(), "md.csv")
        shared.write_csv(path, [["wall_gaps", "Warning", "Corner gap", "open", "Walls", u"牆 200", "L1", "1, 2", 'say "hi"', "+5.0"]])
        raw = io.open(path, "rb").read()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))           # Excel reads it as UTF-8
        text = raw.decode("utf-8-sig")
        self.assertIn(u"牆 200", text)
        self.assertIn(u'"1, 2"', text)
        self.assertIn(u'"say ""hi"""', text)
        self.assertEqual(text.count(u"\r\n"), 2)


if __name__ == "__main__":
    unittest.main()
