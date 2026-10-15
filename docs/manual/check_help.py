# -*- coding: utf-8 -*-
"""Fails when viewer/help-content.js is not what the manual gives: run
build_manual.py after changing the manual.   python3 check_help.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_manual as B   # noqa: E402

with open(B.HELP_JS, encoding="utf-8") as f:
    have = f.read()
if have != B.help_js():
    sys.exit("viewer/help-content.js is stale - run docs/manual/build_manual.py")
print("help-content.js matches the manual")
