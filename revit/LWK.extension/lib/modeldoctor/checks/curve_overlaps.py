# -*- coding: utf-8 -*-
"""Check 1b -- collinear overlapping curves (the rest of OVERKILL).

The duplicates check matches whole elements by signature, so it only catches
lines that are *identical*. AutoCAD's OVERKILL does more than that: it also
merges lines that lie on the same infinite line and share a stretch of their
length, even when their endpoints differ.

That is why duplicate room separation lines and detail lines survive a
duplicates pass. Two separation lines drawn over the same wall at slightly
different lengths are not identical elements, but they are still redundant --
and because Revit draws the room boundary from the wall anyway, they are
invisible in the model.
"""
from modeldoctor.compat import id_int, new_id
from System.Collections.Generic import List

from Autodesk.Revit.DB import (
    FilteredElementCollector, ElementId, BuiltInCategory, XYZ, Line,
    CurveElement, ElementMulticategoryFilter
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, category_name, log,
    usable_categories, editable as core_editable
)
from modeldoctor import geom
from modeldoctor import context

# Lines a user can actually click on in a view.
CURVE_CATEGORIES = [
    BuiltInCategory.OST_Lines,                    # model + detail lines
    BuiltInCategory.OST_RoomSeparationLines,
    BuiltInCategory.OST_AreaSchemeLines,
    BuiltInCategory.OST_MEPSpaceSeparationLines,
]

# Sketch lines are the boundary curves INSIDE a floor, ceiling, roof or
# filled-region sketch. They exist only while that host's sketch is open, so
# they cannot be selected, zoomed to or deleted from the model, and a
# coincident pair is usually a property of the host rather than a defect in
# its own right. Off by default: reporting thousands of them buries the
# findings the user can act on.
SKETCH_CATEGORIES = [
    BuiltInCategory.OST_SketchLines,
]


@register
class CurveOverlapCheck(BaseCheck):
    id = 'curve_overlaps'
    title = 'Overlapping lines and boundaries'
    group = 'Hygiene'
    description = ('Detail lines, model lines, room and area separation lines '
                   'lying on top of each other. Catches partial overlaps that '
                   'the duplicates check cannot see.')
    can_fix = True
    fix_verb = 'Merge overlaps into one line'
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Collinearity tolerance', 1.0, 'mm'),
        'min_overlap_mm': ('Ignore overlaps shorter than', 1.0, 'mm'),
        'match_line_style': ('Only compare lines of the same style', True, ''),
        'merge_partial': ('Merge partial overlaps (else report only)',
                          True, ''),
        'skip_grouped': ('Ignore lines inside groups', True, ''),
        'ignore_imported': ('Ignore CAD linked / imported geometry', True, ''),
        'include_sketch_lines': ('Include sketch lines (floor / ceiling / '
                                 'roof boundaries - cannot be selected)',
                                 False, ''),
        'import_style_markers': (
            'Line style name fragments that mark exploded CAD',
            'IMPORT,DWG,XREF,A-,S-,M-,E-', 'text'),
    }

    # ------------------------------------------------------------------
    def _collect(self):
        cats = list(CURVE_CATEGORIES)
        if self.opt('include_sketch_lines'):
            cats.extend(SKETCH_CATEGORIES)
        cats = usable_categories(self.doc, cats)
        if not cats:
            return []
        flt = ElementMulticategoryFilter(List[BuiltInCategory](cats))
        return (FilteredElementCollector(self.doc)
                .WherePasses(flt)
                .WhereElementIsNotElementType()
                .ToElements())

    def _line_key(self, el, tol):
        """Group by the infinite line the segment lies on.

        Anchoring on the foot of the perpendicular from the origin makes the
        key independent of where along the line the segment sits, which is
        exactly what lets partial overlaps land in the same bucket.
        """
        try:
            c = el.GeometryCurve
        except Exception:
            return None, None, None
        if not isinstance(c, Line):
            return None, None, None

        a = c.GetEndPoint(0)
        b = c.GetEndPoint(1)
        d = (b - a)
        if d.GetLength() < geom.EPS:
            return None, None, None
        d = d.Normalize()

        # Canonical direction so a line and its reverse share a bucket.
        if (d.X < -geom.EPS or
                (abs(d.X) <= geom.EPS and d.Y < -geom.EPS) or
                (abs(d.X) <= geom.EPS and abs(d.Y) <= geom.EPS and d.Z < 0)):
            d = d.Negate()

        # Foot of the perpendicular from the world origin.
        t = -(a.DotProduct(d))
        foot = a + d * t

        parts = ['{0}'.format(id_int(el.Category.Id)
                              if el.Category else 0)]
        try:
            if el.ViewSpecific:
                parts.append('V{0}'.format(id_int(el.OwnerViewId)))
        except Exception:
            pass
        if self.opt('match_line_style'):
            try:
                parts.append('S{0}'.format(
                    id_int(el.LineStyle.Id)))
            except Exception:
                pass
        parts.append('{0},{1},{2}'.format(geom.snap(foot.X, tol),
                                          geom.snap(foot.Y, tol),
                                          geom.snap(foot.Z, tol)))
        parts.append('{0},{1},{2}'.format(geom.snap(d.X, tol * 0.01),
                                          geom.snap(d.Y, tol * 0.01),
                                          geom.snap(d.Z, tol * 0.01)))
        return '#'.join(parts), a, d

    # ------------------------------------------------------------------
    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        min_ov = geom.mm(self.opt('min_overlap_mm'))
        skip_grouped = self.opt('skip_grouped')
        skip_import = self.opt('ignore_imported')
        markers = (context.parse_markers(self.opt('import_style_markers'))
                   if skip_import else [])

        buckets = {}
        count = 0
        for el in self._collect():
            if not isinstance(el, CurveElement):
                continue
            try:
                if skip_grouped and el.GroupId != ElementId.InvalidElementId:
                    continue
                if el.Pinned:
                    continue
            except Exception:
                continue
            if skip_import and context.is_import_derived(el, markers):
                continue

            key, anchor, d = self._line_key(el, tol)
            if key is None:
                continue
            count += 1

            c = el.GeometryCurve
            t0 = c.GetEndPoint(0).DotProduct(d)
            t1 = c.GetEndPoint(1).DotProduct(d)
            if t1 < t0:
                t0, t1 = t1, t0
            buckets.setdefault(key, []).append((t0, t1, el))

        self.population = count

        for key in buckets:
            segs = buckets[key]
            if len(segs) < 2:
                continue
            segs.sort(key=lambda s: (s[0], s[1]))
            for i in range(len(segs) - 1):
                a0, a1, ea = segs[i]
                for j in range(i + 1, len(segs)):
                    b0, b1, eb = segs[j]
                    if b0 >= a1 - min_ov:
                        break        # sorted, so nothing further can overlap
                    overlap = min(a1, b1) - max(a0, b0)
                    if overlap < min_ov:
                        continue

                    contained = (b0 >= a0 - tol and b1 <= a1 + tol)
                    reverse_contained = (a0 >= b0 - tol and a1 <= b1 + tol)

                    if contained or reverse_contained:
                        keeper, victim = ((ea, eb) if contained else (eb, ea))
                        problem = 'Line inside another line'
                        desc = ('{0} {1} lies entirely within {2} over '
                                '{3:.0f} mm - {1} is redundant'
                                .format(category_name(victim),
                                        id_int(victim.Id),
                                        id_int(keeper.Id),
                                        geom.to_mm(overlap)))
                        payload = {'mode': 'delete',
                                   'victim': id_int(victim.Id),
                                   'keeper': id_int(keeper.Id)}
                        fixable = True
                        blocked = ''
                    else:
                        problem = 'Partial line overlap'
                        union_lo, union_hi = min(a0, b0), max(a1, b1)
                        keeper, victim = ((ea, eb) if (a1 - a0) >= (b1 - b0)
                                          else (eb, ea))
                        desc = ('{0} {1} and {2} overlap over {3:.0f} mm - '
                                'merge into a single {4:.0f} mm line'
                                .format(category_name(ea),
                                        id_int(ea.Id),
                                        id_int(eb.Id),
                                        geom.to_mm(overlap),
                                        geom.to_mm(union_hi - union_lo)))
                        payload = {'mode': 'merge',
                                   'victim': id_int(victim.Id),
                                   'keeper': id_int(keeper.Id),
                                   'lo': union_lo, 'hi': union_hi}
                        fixable = self.opt('merge_partial')
                        blocked = ('' if fixable
                                   else 'partial merge disabled in settings')

                    self.issues.append(Issue(
                        self.id,
                        [id_int(ea.Id), id_int(eb.Id)],
                        desc,
                        value_mm=geom.to_mm(overlap),
                        severity=Severity.WARNING,
                        primary_id=payload['victim'],
                        category=category_name(ea),
                        type_name=self._style_name(ea),
                        level='',
                        fixable=fixable and not self._is_sketch(ea),
                        fix_blocked=(
                            'sketch line - open the host element\'s sketch '
                            'to edit it' if self._is_sketch(ea) else blocked),
                        problem=problem,
                        payload=payload,
                    ))

    @staticmethod
    def _is_sketch(el):
        try:
            cat = el.Category
            if cat is None:
                return False
            return id_int(cat.Id) == id_int(ElementId(BuiltInCategory.OST_SketchLines))
        except Exception:
            return False

    def _style_name(self, el):
        try:
            return el.LineStyle.Name
        except Exception:
            return ''

    # ------------------------------------------------------------------
    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(reason):
            skipped[reason] = skipped.get(reason, 0) + 1

        removed = set()
        for iss in issues:
            mode = iss.payload.get('mode')
            vid = iss.payload['victim']
            kid = iss.payload['keeper']
            if vid in removed or kid in removed:
                note('already resolved by an earlier merge')
                continue

            victim = self.doc.GetElement(new_id(vid))
            keeper = self.doc.GetElement(new_id(kid))
            if victim is None or keeper is None:
                note('element no longer exists')
                continue
            if not core_editable(self.doc, victim):
                note('owned by another user')
                continue

            if mode == 'merge':
                try:
                    c = keeper.GeometryCurve
                    a = c.GetEndPoint(0)
                    b = c.GetEndPoint(1)
                    d = (b - a).Normalize()
                    lo, hi = iss.payload['lo'], iss.payload['hi']
                    base = a - d * (a.DotProduct(d))
                    new_line = Line.CreateBound(base + d * lo, base + d * hi)
                    keeper.SetGeometryCurve(new_line, True)
                except Exception:
                    note('Revit rejected the merged curve')
                    log('curve merge failed for {0}'.format(kid))
                    continue

            try:
                self.doc.Delete(new_id(vid))
                removed.add(vid)
                fixed += 1
            except Exception:
                note('Revit refused to delete the line')

        msg = 'Removed {0} redundant line(s).'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)
