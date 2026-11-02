# -*- coding: utf-8 -*-
"""A refused sign-in is found before a publish exports anything:
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))
from lwk_viewer import issues as LI  # noqa: E402


class FakeClient(object):
    def __init__(self, token, err=None):
        self.token = token
        self.err = err

    def me(self):
        if self.err:
            raise self.err
        return {"accounts": True, "user": {"id": 1}}


class CheckSignin(unittest.TestCase):

    def test_accepted(self):
        self.assertEqual(LI.check_signin(FakeClient("u.1.2.3.x")), (True, ""))

    def test_refused_says_why(self):
        err = LI.ServerError("Sign in first: the password was changed (or reset) since", 401)
        ok, why = LI.check_signin(FakeClient("u.1.2.3.x", err))
        self.assertFalse(ok)
        self.assertEqual(why, "the password was changed (or reset) since")

    def test_old_server_without_a_reason(self):
        ok, why = LI.check_signin(FakeClient("u.1.2.3.x", LI.ServerError("Sign in first", 401)))
        self.assertFalse(ok)
        self.assertEqual(why, "Sign in first")

    def test_server_away_is_not_a_refusal(self):
        # the export goes ahead; Upload now sends it later
        ok, _ = LI.check_signin(FakeClient("u.1.2.3.x", LI.ServerError("Cannot reach the server", 0)))
        self.assertTrue(ok)

    def test_no_token(self):
        self.assertEqual(LI.check_signin(FakeClient("")), (False, "not signed in"))


if __name__ == "__main__":
    unittest.main()
