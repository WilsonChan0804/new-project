# -*- coding: utf-8 -*-
"""Revit API differences between versions, in one place (as lwk_viewer's).

Revit 2024 made element ids 64-bit (ElementId.Value); Revit 2026 removed
ElementId.IntegerValue and the ElementId(int) constructor. Every id here is
read and made through these two, so the tool runs on Revit 2022 to 2026.
"""


def id_int(eid):
    """An element id as a plain number (-1 for none)."""
    if eid is None:
        return -1
    try:
        return eid.Value                # Revit 2024 and later
    except AttributeError:
        return eid.IntegerValue         # Revit 2022 / 2023


def new_id(n):
    """An ElementId from a number."""
    from Autodesk.Revit.DB import ElementId
    n = int(n)
    try:
        from System import Int64
        return ElementId(Int64(n))      # Revit 2024 and later
    except Exception:
        return ElementId(n)             # Revit 2022 / 2023
