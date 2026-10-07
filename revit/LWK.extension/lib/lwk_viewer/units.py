# -*- coding: utf-8 -*-
"""Parameter values as the viewer shows them: areas, lengths and volumes
always in metres with three decimals (12.345 m2, 3.600 m), whatever the
project's own display units; everything else as Revit shows it."""

SQFT_M2 = 0.09290304
FT_M = 0.3048
CUFT_M3 = 0.028316846592


def _spec(p):
    """'area', 'length', 'volume' or None."""
    d = p.Definition
    try:
        tid = (d.GetDataType().TypeId or "").lower()      # Revit 2022+
        for k in ("area", "length", "volume"):
            if (":%s-" % k) in tid or tid.endswith(":" + k):
                return k
        return None
    except Exception:
        pass
    try:
        ut = str(d.UnitType)                                # older Revit
        return {"UT_Area": "area", "UT_Length": "length", "UT_Volume": "volume"}.get(ut)
    except Exception:
        return None


def value_text(p):
    """The text for one parameter, or None when it has no value."""
    try:
        if not p.HasValue:
            return None
    except Exception:
        pass
    try:
        from Autodesk.Revit.DB import StorageType
        if p.StorageType == StorageType.Double:
            k = _spec(p)
            if k:
                # Revit's own text when it already reads to three decimals
                # in metres - the very figure the schedule prints
                try:
                    shown = p.AsValueString() or ""
                    import re
                    if re.match(u"^-?[\\d,]*\\.\\d{3} ?(m\u00b2|m2|m\u00b3|m3|m)$", shown.strip()):
                        return shown.strip()
                except Exception:
                    pass
                # else worked out, rounded half up as Revit rounds (a hair
                # added: 0.8575 stored as 0.85749999... must still read 0.858)
                v = p.AsDouble()
                v = v + (1e-9 if v >= 0 else -1e-9) / {"area": SQFT_M2, "length": FT_M, "volume": CUFT_M3}[k]
                if k == "area":
                    return u"%.3f m²" % (v * SQFT_M2)
                if k == "length":
                    return u"%.3f m" % (v * FT_M)
                return u"%.3f m³" % (v * CUFT_M3)
    except Exception:
        pass
    try:
        v = p.AsValueString()
        if v is None or v == "":
            v = p.AsString()
        if v is None or v == "":
            return None
        return v
    except Exception:
        return None
