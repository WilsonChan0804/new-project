"""My programmes: a person's own programmes, shared or not (myprog.py).

    python3 tests_myprog.py
"""
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fastapi import HTTPException  # noqa: E402

import myprog as MP  # noqa: E402
import programme as PG  # noqa: E402


class W(object):
    def __init__(self, uid, name, admin=False):
        self.uid, self.name, self.site_admin = uid, name, admin


class Core(object):
    def __init__(self, d):
        self.CFG = {"data": os.path.join(d, "data")}
        self.root = os.path.join(d, "projects")

    def accounts_on(self):
        return True

    def project_root_for(self, pid):
        p = os.path.join(self.root, pid)
        os.makedirs(p, exist_ok=True)
        return p

    def require_project(self, request, pid, need="viewer", tok=""):
        if pid != "P1":
            raise HTTPException(status_code=403, detail="not a member")
        return W("a", "Ann"), "member"


A, B, C = W("a", "Ann"), W("b", "Ben"), W("c", "Cat")
TASKS = {"tasks": [{"id": "t1", "name": "Tender", "dur": 5}, {"id": "t2", "name": "Award", "dur": 0, "kind": "milestone", "deps": [{"from": "t1", "type": "FS"}]}]}


class MyProg(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.core = Core(self.d)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_own_share_and_access(self):
        n = MP.create(self.core, A, "Tender X", None)
        pid = n["id"]
        d = MP._dir(self.core, pid)
        cur = PG.load_at(d)
        PG.save_at(d, cur["rev"], TASKS, "Ann")
        self.assertEqual([x["name"] for x in MP.listing(self.core, A)], ["Tender X"])
        self.assertEqual(MP.listing(self.core, B), [])
        with self.assertRaises(HTTPException) as e:
            MP._get(self.core, pid, B, "view")
        self.assertEqual(e.exception.status_code, 403)
        MP.patch(self.core, A, pid, {"share": {"b": "view"}})
        self.assertEqual(MP.listing(self.core, B)[0]["role"], "view")
        self.assertEqual(MP.listing(self.core, B)[0]["share"], {})       # only the owner sees who it is shared with
        with self.assertRaises(HTTPException):
            MP._get(self.core, pid, B, "edit")
        with self.assertRaises(HTTPException):
            MP.patch(self.core, B, pid, {"all": "edit"})                 # only the owner shares
        MP.patch(self.core, A, pid, {"share": {"b": "edit"}})
        self.assertEqual(MP._get(self.core, pid, B, "edit")[1], "edit")
        self.assertEqual(MP.listing(self.core, C), [])
        MP.patch(self.core, A, pid, {"all": "view"})
        self.assertEqual(MP.listing(self.core, C)[0]["role"], "view")

    def test_versions(self):
        pid = MP.create(self.core, A, "Tender Y", None)["id"]
        d = MP._dir(self.core, pid)
        r1 = PG.save_at(d, PG.load_at(d)["rev"], TASKS, "Ann")
        with self.assertRaises(HTTPException) as e:
            PG.save_at(d, r1["rev"] - 1, TASKS, "Ben")
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual(len(PG.history_at(d)), 2)
        self.assertTrue(PG.version_at(d, 1)["old"])

    def test_copy_from_a_project_and_delete(self):
        PG.save(self.core, "P1", 0, TASKS, "Ann")
        n = MP.create(self.core, A, "From P1", {"project": "P1", "pg": ""})
        self.assertEqual(len(PG.load_at(MP._dir(self.core, n["id"]))["data"]["tasks"]), 2)
        with self.assertRaises(HTTPException):
            MP.create(self.core, A, "From P2", {"project": "P2"})
        with self.assertRaises(HTTPException):
            MP.remove(self.core, B, n["id"])
        MP.remove(self.core, A, n["id"])
        self.assertEqual(MP.listing(self.core, A), [])
        self.assertTrue(os.listdir(os.path.join(self.core.CFG["data"], "myprog", "deleted")))


if __name__ == "__main__":
    unittest.main()
