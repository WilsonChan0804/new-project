# -*- coding: utf-8 -*-
"""The nightly dialog watcher's button rules (dialogrules.py):
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "LWK.extension", "lib"))
from lwk_viewer import dialogrules as R


class Answers(unittest.TestCase):

    def test_unsigned_addin_loaded_once(self):
        b = ["Always Load\nAlways load this add-in", "Load Once\nLoad the add-in this time", "Do Not Load\nDo not load the add-in"]
        self.assertEqual(R.answer("Security - Unsigned Add-In", "The publisher of this add-in could not be verified", b)[0], b[1])
        self.assertEqual(R.answer("Security - Unsigned Add-In", "", ["Always Load", "Load Once", "Do Not Load"], wpf=True)[0], "Load Once")

    def test_missing_links_ignored(self):
        b = ["Open Manage Links to correct the problem", "Ignore and continue opening the project"]
        self.assertEqual(R.answer("Revit", "Revit could not find or read 3 references", b)[0], b[1])

    def test_missing_updaters_continue(self):
        b = ["Do not warn about this updater again and continue working with the file", "Continue working with the file"]
        self.assertEqual(R.answer("Missing Third Party Updaters", "", b)[0], b[1])
        self.assertEqual(R.answer("Missing Third Party Updaters", "", ["Continue working with the file", "Cancel"])[0],
                         "Continue working with the file")

    def test_information_window_closed(self):
        self.assertEqual(R.answer("What's New in Revit 2025", "", ["Learn more", "Close"], wpf=True)[0], "Close")
        # a Close on anything else (a palette, the sign-in) is left alone
        self.assertIsNone(R.answer("Properties", "", ["Apply", "Close"], wpf=True))

    def test_never_cancel(self):
        # a progress window with only Cancel: pressing it stops the open
        self.assertIsNone(R.answer("Opening", "Loading worksets", ["Cancel"]))
        self.assertIsNone(R.answer("Security - Unsigned Add-In", "", ["Always Load", "Do Not Load"]))
        self.assertIsNone(R.answer("Autodesk", "Sign in", ["Sign In"]))
        for n in ("Cancel", "Do Not Load", "Always Load", "cancel"):
            self.assertTrue(R.never(n))

    def test_one_button(self):
        self.assertEqual(R.answer("Warning", "Some text", ["OK"])[0], "OK")
        self.assertIsNone(R.answer("Floating palette", "", ["Apply"], wpf=True))

    def test_watcher_has_the_rules(self):
        ps = R.ps_rules()
        self.assertIn("'Load Once'", ps)
        self.assertIn("'Ignore and continue opening*'", ps)
        self.assertIn("'*what''s new*'", ps)          # quotes doubled for PowerShell
        self.assertIn("function Never", R.ps_never())
        self.assertIn("'Do Not Load'", R.ps_never())


if __name__ == "__main__":
    unittest.main()
