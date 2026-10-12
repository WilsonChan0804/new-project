"""Revit API differences between versions, in one place.

Element ids: Revit 2024 made them 64-bit - ElementId.Value - and Revit
2026 removed the old ElementId.IntegerValue and the ElementId(int)
constructor. Everything here reads and makes ids through these two, so the
same add-in runs on Revit 2022 to 2026.
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
    """An ElementId from a number (an id kept in the viewer, a view id ...)."""
    from Autodesk.Revit.DB import ElementId        # here: importing this module needs no Revit
    n = int(n)
    try:
        from System import Int64
        return ElementId(Int64(n))      # Revit 2024 and later
    except Exception:
        return ElementId(n)             # Revit 2022 / 2023
