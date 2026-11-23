# -*- coding: utf-8 -*-
"""python3 server/tests_selfupdate.py - Admin > Viewer update: a zip of the
code copied in place, run.bat and the data left alone, a bad download
refused, the backup put back, site admins only."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import selfupdate as su  # noqa: E402


def zipball(files, top="o-r-abc1234"):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for name, text in files.items():
            z.writestr(top + "/" + name, text)
    return b.getvalue()


GOOD = {"server/app.py": "print('new app')\n", "server/new_module.py": "X = 2\n", "server/run.bat": "set PASS=from-github\n",
        "server/requirements.txt": "fastapi\n", "viewer/index.html": "<p>new</p>", "viewer/nav.js": "const LWK_VERSION = \"new\";"}


class Who(object):
    def __init__(self, admin):
        self.site_admin, self.uid, self.name = admin, 1, "Ann"


class Core(object):
    def __init__(self, data):
        self.CFG = {"data": data}
        self.admin = True

    def who(self, request, tok=""):
        return Who(self.admin)


class Update(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "app")
        for p, t in {"server/app.py": "print('old app')\n", "server/run.bat": "set PASS=secret\n", "server/requirements.txt": "fastapi\n",
                     "server/data/viewer.db": "DB", "viewer/index.html": "<p>old</p>", "viewer/only-here.js": "keep"}.items():
            f = os.path.join(self.root, p)
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, "w") as fh:
                fh.write(t)
        self.ROOT0 = su.ROOT
        su.ROOT = self.root
        su.CFG["data"] = os.path.join(self.tmp, "data")
        self.restarts = []
        self.r0 = su.restart
        su.restart = lambda: self.restarts.append(1)

    def tearDown(self):
        su.ROOT = self.ROOT0
        su.restart = self.r0
        shutil.rmtree(self.tmp, ignore_errors=True)

    def read(self, p):
        with open(os.path.join(self.root, p)) as f:
            return f.read()

    def test_install_keeps_run_bat_and_data(self):
        n = su.install(zipball(GOOD), "abc1234def", "Ann")
        self.assertEqual(self.read("server/app.py"), "print('new app')\n")
        self.assertEqual(self.read("server/new_module.py"), "X = 2\n")
        self.assertEqual(self.read("server/run.bat"), "set PASS=secret\n")           # never overwritten
        self.assertEqual(self.read("server/data/viewer.db"), "DB")
        self.assertEqual(self.read("viewer/only-here.js"), "keep")                    # nothing deleted
        self.assertEqual(n, 5)
        self.assertEqual(su.settings()["installed"]["sha"], "abc1234def")
        self.assertEqual(len(su.backups()), 1)

    def test_bad_download_changes_nothing(self):
        bad = dict(GOOD, **{"server/broken.py": "def x(:\n"})
        with self.assertRaisesRegex(ValueError, "does not compile"):
            su.install(zipball(bad), "bad", "Ann")
        with self.assertRaisesRegex(ValueError, "not the viewer"):
            su.install(zipball({"README.md": "x"}), "bad", "Ann")
        self.assertEqual(self.read("server/app.py"), "print('old app')\n")
        self.assertEqual(su.backups(), [])

    def test_rollback(self):
        su.install(zipball(GOOD), "abc1234def", "Ann")
        su.run_rollback("Ann")
        self.assertEqual(self.read("server/app.py"), "print('old app')\n")
        self.assertEqual(self.restarts, [1] if su.can_restart() else [])

    def test_endpoints_site_admin_only(self):
        app = FastAPI()
        core = Core(su.CFG["data"])
        su.register(app, core)
        c = TestClient(app)
        su.latest = lambda force=False: {"sha": "abc1234def", "date": "2026-11-23T00:00:00Z", "message": "Newest"}
        r = c.get("/api/admin/update").json()
        self.assertEqual((r["branch"], r["latest"]["sha"], r["current"]), ("claude/amazing-fermi-96v958", "abc1234def", False))
        r = c.post("/api/admin/update", json={"branch": "main", "token": "t0k"}).json()
        self.assertEqual((r["branch"], r["token_set"]), ("main", True))
        self.assertNotIn("t0k", json.dumps(r))
        self.assertEqual(c.post("/api/admin/update", json={"branch": "a b"}).status_code, 400)
        core.admin = False
        self.assertEqual(c.get("/api/admin/update").status_code, 403)
        self.assertEqual(c.post("/api/admin/update", json={"go": True}).status_code, 403)
        self.assertEqual(c.post("/api/admin/update/rollback").status_code, 403)


if __name__ == "__main__":
    unittest.main()
