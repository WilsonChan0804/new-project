# -*- coding: utf-8 -*-
"""Can two elements actually occupy the model at the same time?

Solid intersection alone is not evidence of a clash. Walls in different design
options, walls in non-overlapping phases, and a stacked wall against its own
members all produce perfect geometric overlap while being entirely correct.
Every pairwise check should gate on `coexist()` before reporting.
"""
from modeldoctor.compat import id_int, new_id
from Autodesk.Revit.DB import (
    BuiltInParameter, BuiltInCategory, ElementId, Wall, ImportInstance,
    CurveElement
)

_INF = 10 ** 6


class PhaseMap(object):
    """Maps phase ElementId -> sequence index, so 'before' and 'after' mean
    something. Built once per document."""

    def __init__(self, doc):
        self.order = {}
        try:
            idx = 0
            for ph in doc.Phases:
                self.order[id_int(ph.Id)] = idx
                idx += 1
        except Exception:
            pass

    def span(self, el):
        """(created_index, demolished_index). Never demolished -> +inf."""
        created, demolished = -1, _INF
        try:
            p = el.get_Parameter(BuiltInParameter.PHASE_CREATED)
            if p is not None:
                created = self.order.get(id_int(p.AsElementId()), -1)
        except Exception:
            pass
        try:
            p = el.get_Parameter(BuiltInParameter.PHASE_DEMOLISHED)
            if p is not None:
                eid = p.AsElementId()
                if eid is not None and eid != ElementId.InvalidElementId:
                    demolished = self.order.get(id_int(eid), _INF)
        except Exception:
            pass
        return (created, demolished)

    def overlap(self, a, b):
        ca, da = self.span(a)
        cb, db = self.span(b)
        # An element demolished in phase N is still present during phase N.
        return ca <= db and cb <= da


def _option_set(el):
    try:
        opt = el.DesignOption
        if opt is None:
            return None, None
        p = opt.get_Parameter(BuiltInParameter.OPTION_SET_ID)
        set_id = id_int(p.AsElementId()) if p is not None else None
        return id_int(opt.Id), set_id
    except Exception:
        return None, None


def options_overlap(a, b):
    """Main-model elements coexist with everything. Two elements in different
    options of the *same* option set never coexist; different sets do."""
    oa, sa = _option_set(a)
    ob, sb = _option_set(b)
    if oa is None or ob is None:
        return True
    if oa == ob:
        return True
    if sa is not None and sb is not None and sa == sb:
        return False
    return True


def stacked_conflict(a, b):
    """A stacked wall parent and its own members overlap by definition."""
    try:
        if isinstance(a, Wall) and isinstance(b, Wall):
            if a.IsStackedWallMember and a.StackedWallOwnerId == b.Id:
                return True
            if b.IsStackedWallMember and b.StackedWallOwnerId == a.Id:
                return True
            if a.IsStackedWallMember and b.IsStackedWallMember:
                if a.StackedWallOwnerId == b.StackedWallOwnerId:
                    return True
    except Exception:
        pass
    return False


def coexist(a, b, phase_map=None, check_phase=True, check_option=True):
    """True when a real clash between a and b is even possible."""
    if stacked_conflict(a, b):
        return False
    if check_option and not options_overlap(a, b):
        return False
    if check_phase and phase_map is not None and not phase_map.overlap(a, b):
        return False
    return True


def why_not(a, b, phase_map=None):
    """Human-readable reason a pair was excluded, for the diagnostic log."""
    if stacked_conflict(a, b):
        return 'stacked wall parent/member'
    if not options_overlap(a, b):
        return 'different design options in the same option set'
    if phase_map is not None and not phase_map.overlap(a, b):
        return 'phases do not overlap'
    return ''


_IMPORT_CAT = None


def _import_category_id():
    """ElementId of the 'Imports in Families' category, resolved once."""
    global _IMPORT_CAT
    if _IMPORT_CAT is None:
        try:
            _IMPORT_CAT = id_int(ElementId(BuiltInCategory.OST_ImportObjectStyles))
        except Exception:
            _IMPORT_CAT = 0
    return _IMPORT_CAT


def _cat_is_import(cat):
    if cat is None:
        return False
    imp = _import_category_id()
    try:
        if id_int(cat.Id) == imp:
            return True
        parent = cat.Parent
        if parent is not None and id_int(parent.Id) == imp:
            return True
    except Exception:
        pass
    return False


def is_import_derived(el, style_markers=None):
    """True for anything that came out of a DWG rather than being modelled.

    Three routes are covered, because CAD arrives in Revit three ways:
      * a live link or import  -> ImportInstance
      * a partial explode      -> elements under 'Imports in Families'
      * a full explode         -> real detail/model lines whose LINE STYLE
                                  was auto-created from the DWG layer name

    The third has no API flag, which is why `style_markers` exists: name
    fragments that identify your imported line styles.
    """
    try:
        if isinstance(el, ImportInstance):
            return True
    except Exception:
        pass
    try:
        if _cat_is_import(el.Category):
            return True
    except Exception:
        pass
    try:
        if isinstance(el, CurveElement):
            gs = el.LineStyle
            if gs is not None:
                if _cat_is_import(gs.GraphicsStyleCategory):
                    return True
                if style_markers:
                    name = (gs.Name or '').upper()
                    for marker in style_markers:
                        marker = marker.strip().upper()
                        if marker and marker in name:
                            return True
    except Exception:
        pass
    return False


def parse_markers(text):
    """Comma-separated setting -> list of non-empty fragments."""
    if not text:
        return []
    return [p.strip() for p in str(text).split(',') if p.strip()]


def context_note(doc, el, phase_map=None):
    """Short '[option / phase]' suffix appended to findings, so a phantom
    result explains itself without a second investigation."""
    bits = []
    try:
        opt = el.DesignOption
        if opt is not None:
            bits.append('opt:' + opt.Name)
    except Exception:
        pass
    try:
        p = el.get_Parameter(BuiltInParameter.PHASE_CREATED)
        if p is not None:
            ph = doc.GetElement(p.AsElementId())
            if ph is not None:
                bits.append('phase:' + ph.Name)
    except Exception:
        pass
    return (' [' + ', '.join(bits) + ']') if bits else ''
