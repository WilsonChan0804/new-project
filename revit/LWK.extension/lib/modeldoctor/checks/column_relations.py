# -*- coding: utf-8 -*-
"""Checks 2b and 3b -- the same two questions, asked about columns.

Columns are point-placed families, not curve-driven hosts, so none of the
centreline arithmetic in wall_junctions applies. Everything here is measured
against the column's actual side faces, which is what makes it work for
circular and L-shaped columns as well as rectangular ones -- a bounding-box
test would report the corner of the box around a round column as solid.

Walls can be extended into or trimmed back from a column. Column-to-column
clashes are reported only: nudging structural columns automatically is not
something a checker should do.
"""
from modeldoctor.compat import id_int, new_id
from math import fabs

from System.Collections.Generic import List

from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, ElementId, Wall, Line, XYZ,
    LocationCurve, LocationPoint, ElementMulticategoryFilter,
    JoinGeometryUtils, FamilyInstance
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, element_name, type_name,
    category_name, log, probe, editable as core_editable
)
from modeldoctor import geom
from modeldoctor import context

COLUMN_CATEGORIES = [
    BuiltInCategory.OST_Columns,
    BuiltInCategory.OST_StructuralColumns,
]

M3_TO_FT3 = 35.3146667


class ColumnRec(object):
    """A column plus the geometry needed to measure against it."""

    __slots__ = ('el', 'id', 'bb', 'solids', 'faces', 'z0', 'z1')

    def __init__(self, el):
        self.el = el
        self.id = id_int(el.Id)
        self.bb = el.get_BoundingBox(None)
        self.solids = geom.solids_of(el)
        self.faces = geom.side_faces(self.solids)
        if self.bb is not None:
            self.z0, self.z1 = self.bb.Min.Z, self.bb.Max.Z
        else:
            self.z0, self.z1 = 0.0, 0.0


def collect_columns(doc):
    flt = ElementMulticategoryFilter(List[BuiltInCategory](COLUMN_CATEGORIES))
    recs = {}
    for el in (FilteredElementCollector(doc)
               .WherePasses(flt)
               .WhereElementIsNotElementType()
               .ToElements()):
        bb = el.get_BoundingBox(None)
        if bb is None:
            continue
        rec = ColumnRec(el)
        if not rec.faces:
            continue
        recs[rec.id] = rec
    return recs


def collect_walls(doc):
    from modeldoctor.checks.wall_junctions import collect_walls as cw
    return cw(doc)


def level_of(doc, el):
    try:
        return element_name(doc.GetElement(el.LevelId))
    except Exception:
        return ''


# ===========================================================================
# Walls that nearly touch a column
# ===========================================================================

@register
class WallColumnGapCheck(BaseCheck):
    id = 'wall_column_gaps'
    score_factor = 1.0
    title = 'Walls that nearly touch a column'
    group = 'Columns'
    description = ('Wall ends stopping a hair short of a column face. '
                   'Measured against the real column profile, so round and '
                   'L-shaped columns are handled.')
    can_fix = True
    fix_verb = 'Extend walls onto the column face'

    options = {
        'tolerance_mm': ('Maximum gap to report', 10.0, 'mm'),
        'min_gap_mm': ('Ignore gaps smaller than', 0.05, 'mm'),
        'join_after_fix': ('Join geometry after extending', True, ''),
        'allow_unpin': ('Unpin walls in order to fix them', False, ''),
        'same_phase_only': ('Only compare elements in overlapping phases',
                            True, ''),
        'same_option_only': ('Only compare elements that can coexist in '
                             'design options', True, ''),
    }

    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        min_gap = geom.mm(self.opt('min_gap_mm'))

        cols = collect_columns(self.doc)
        walls = collect_walls(self.doc)
        if not cols:
            # No reference geometry: population 0 drops this check out of the
            # score share entirely rather than scoring it a spurious 100%.
            self.population = 0
            self._no_columns()
            return
        self.population = len(walls)
        if not walls:
            return

        phase_map = context.PhaseMap(self.doc)
        chk_phase = self.opt('same_phase_only')
        chk_opt = self.opt('same_option_only')

        idx = geom.GridIndex(20.0)
        for cid, c in cols.items():
            idx.add(cid, c.bb, tol * 2.0)

        best_by_end = {}
        for wid, w in walls.items():
            for cid in idx.query(w.bb, tol * 2.0):
                c = cols[cid]
                if not geom.z_ranges_overlap((w.z0, w.z1), (c.z0, c.z1)):
                    continue
                if not context.coexist(w.el, c.el, phase_map,
                                       chk_phase, chk_opt):
                    continue
                if geom.already_joined(self.doc, w.el, c.el):
                    continue

                for ei, ep in ((0, w.p0), (1, w.p1)):
                    probe = XYZ(ep.X, ep.Y,
                                max(min(ep.Z, c.z1 - geom.COINCIDENT), c.z0))
                    d = geom.nearest_face_distance(c.faces, probe)
                    if d is None:
                        continue
                    # Distance is already surface-to-point: the wall end is a
                    # centreline point, so half the wall thickness of it is
                    # already inside the wall body.
                    gap = d - w.thk * 0.5
                    if gap < min_gap or gap > tol:
                        continue
                    key = (wid, ei)
                    prev = best_by_end.get(key)
                    if prev is None or gap < prev[0]:
                        best_by_end[key] = (gap, w, c)

        for key in best_by_end:
            wid, ei = key
            gap, w, c = best_by_end[key]
            self.issues.append(Issue(
                self.id, [wid, c.id],
                'Wall {0} (end {1}) stops {2:.1f} mm short of column {3}{4}'
                .format(wid, ei + 1, geom.to_mm(gap), c.id,
                        context.context_note(self.doc, w.el)),
                value_mm=geom.to_mm(gap),
                severity=Severity.WARNING,
                primary_id=wid,
                category='Walls',
                type_name=type_name(self.doc, w.el),
                level=level_of(self.doc, w.el),
                fixable=w.is_line,
                fix_blocked=('' if w.is_line
                             else 'curved wall - extend manually'),
                problem='Wall short of column',
                payload={'wall': wid, 'end': ei, 'column': c.id, 'gap': gap},
            ))

    def _no_columns(self):
        self.issues.append(Issue(
            self.id, [],
            'No columns found in this model, so nothing could be measured. '
            'If the columns live in a linked structural model, this check '
            'cannot see them.',
            severity=Severity.INFO, primary_id=0, fixable=False,
            problem='No reference geometry', scoreless=True,
            fix_blocked='nothing to fix - no reference geometry'))

    # ------------------------------------------------------------------
    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(r):
            skipped[r] = skipped.get(r, 0) + 1

        tol = geom.mm(self.opt('tolerance_mm'))
        allow_unpin = self.opt('allow_unpin')
        join = self.opt('join_after_fix')

        for iss in issues:
            w = self.doc.GetElement(new_id(iss.payload['wall']))
            c = self.doc.GetElement(new_id(iss.payload['column']))
            if w is None or c is None:
                note('element no longer exists')
                continue
            lc = w.Location
            if not isinstance(lc, LocationCurve) or \
                    not isinstance(lc.Curve, Line):
                note('curved wall - extend manually')
                continue
            if w.Pinned and not allow_unpin:
                note('wall is pinned (enable "Unpin walls" to override)')
                continue
            if w.Pinned:
                try:
                    w.Pinned = False
                except Exception:
                    note('could not unpin')
                    continue
            if not core_editable(self.doc, w):
                note('owned by another user')
                continue

            wc = lc.Curve
            a, b = wc.GetEndPoint(0), wc.GetEndPoint(1)
            ei = iss.payload['end']
            ep = a if ei == 0 else b
            direction = (XYZ(a.X - b.X, a.Y - b.Y, 0.0).Normalize() if ei == 0
                         else XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize())

            faces = geom.side_faces(geom.solids_of(c))
            budget = iss.payload['gap'] + tol + geom.wall_thickness(w)
            probe = XYZ(ep.X, ep.Y, ep.Z)
            hit = geom.ray_first_hit(faces, probe, direction, budget)
            if hit is None:
                note('could not find the column face along the wall axis')
                continue
            dist, point = hit
            if dist > budget:
                note('move of {0:.0f} mm exceeded the {1:.0f} mm budget'
                     .format(geom.to_mm(dist), geom.to_mm(budget)))
                continue

            new_pt = XYZ(point.X, point.Y, a.Z)
            try:
                new_line = (Line.CreateBound(new_pt, b) if ei == 0
                            else Line.CreateBound(a, new_pt))
                if new_line.Length < geom.mm(50.0):
                    note('result would be shorter than 50 mm')
                    continue
                lc.Curve = new_line
                fixed += 1
                if join:
                    try:
                        if not JoinGeometryUtils.AreElementsJoined(
                                self.doc, w, c):
                            JoinGeometryUtils.JoinGeometricElements(
                                self.doc, w, c)
                    except Exception:
                        pass
            except Exception:
                note('Revit rejected the new curve')
                log('wall/column extend failed for {0}'.format(
                    iss.payload['wall']))

        msg = 'Extended {0} wall end(s) onto columns.'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)


# ===========================================================================
# Overlaps involving columns
# ===========================================================================

@register
class ColumnClashCheck(BaseCheck):
    id = 'column_clashes'
    score_factor = 1.0
    title = 'Columns overlapping walls or each other'
    group = 'Columns'
    description = ('Walls buried in columns, and columns occupying the same '
                   'space as each other. Wall over-runs can be trimmed back; '
                   'column-to-column clashes are reported only.')
    can_fix = True
    fix_verb = 'Trim the wall back to the column face'

    options = {
        'min_volume_m3': ('Ignore overlaps smaller than', 0.0005, 'm3'),
        'check_wall_column': ('Check walls against columns', True, ''),
        'check_column_column': ('Check columns against each other', True, ''),
        'max_faces': ('Skip solids with more faces than', 400, ''),
        'allow_unpin': ('Unpin walls in order to fix them', False, ''),
        'same_phase_only': ('Only compare elements in overlapping phases',
                            True, ''),
        'same_option_only': ('Only compare elements that can coexist in '
                             'design options', True, ''),
    }

    def run(self):
        min_vol = self.opt('min_volume_m3') * M3_TO_FT3
        max_faces = int(self.opt('max_faces'))
        probe('column_clashes: collecting columns')
        cols = collect_columns(self.doc)
        walls = collect_walls(self.doc) if self.opt('check_wall_column') else {}
        if not cols:
            self.population = 0
            return
        self.population = len(cols) + len(walls)

        phase_map = context.PhaseMap(self.doc)
        chk_phase = self.opt('same_phase_only')
        chk_opt = self.opt('same_option_only')

        idx = geom.GridIndex(20.0)
        for cid, c in cols.items():
            idx.add(cid, c.bb, 0.0)

        # -- walls into columns ------------------------------------------
        if self.opt('check_wall_column'):
            wall_solids = {}
            for wid, w in walls.items():
                for cid in idx.query(w.bb, 0.0):
                    c = cols[cid]
                    if not geom.bbox_overlaps(w.bb, c.bb):
                        continue
                    if not context.coexist(w.el, c.el, phase_map,
                                           chk_phase, chk_opt):
                        continue
                    if wid not in wall_solids:
                        wall_solids[wid] = geom.solids_of(w.el)
                    probe('column_clashes wall {0} vs column {1}'.format(
                        wid, c.id))
                    vol = geom.intersection_volume(
                        wall_solids[wid], c.solids, max_faces)
                    if vol <= min_vol:
                        continue

                    end_i, overrun = self._wall_overrun(w, c)
                    fixable = w.is_line and overrun > geom.COINCIDENT
                    self.issues.append(Issue(
                        self.id, [wid, c.id],
                        'Wall {0} is buried {1:.0f} mm into column {2} '
                        '(shared {3:.4f} m3){4}'
                        .format(wid, geom.to_mm(overrun), c.id,
                                vol / M3_TO_FT3,
                                context.context_note(self.doc, w.el)),
                        value_mm=geom.to_mm(overrun),
                        severity=Severity.CRITICAL,
                        primary_id=wid,
                        category='Walls',
                        type_name=type_name(self.doc, w.el),
                        level=level_of(self.doc, w.el),
                        fixable=fixable,
                        fix_blocked=('' if fixable else
                                     'curved wall, or the wall passes right '
                                     'through - trim manually'),
                        problem='Wall over-run into column',
                        payload={'wall': wid, 'column': c.id,
                                 'end': end_i, 'overrun': overrun},
                    ))

        # -- columns into columns ----------------------------------------
        if self.opt('check_column_column'):
            done = set()
            for cid, c in cols.items():
                for oid in idx.query(c.bb, 0.0):
                    if oid == cid:
                        continue
                    key = (min(cid, oid), max(cid, oid))
                    if key in done:
                        continue
                    done.add(key)
                    o = cols[oid]
                    if not geom.bbox_overlaps(c.bb, o.bb):
                        continue
                    if not context.coexist(c.el, o.el, phase_map,
                                           chk_phase, chk_opt):
                        continue
                    probe('column_clashes column {0} vs column {1}'.format(
                        cid, oid))
                    vol = geom.intersection_volume(c.solids, o.solids,
                                                   max_faces)
                    if vol <= min_vol:
                        continue
                    self.issues.append(Issue(
                        self.id, [cid, oid],
                        'Columns {0} and {1} occupy the same space '
                        '({2:.4f} m3) - resolve with the structural team{3}'
                        .format(cid, oid, vol / M3_TO_FT3,
                                context.context_note(self.doc, c.el)),
                        value_mm=None,
                        severity=Severity.CRITICAL,
                        primary_id=cid,
                        category=category_name(c.el),
                        type_name=type_name(self.doc, c.el),
                        level=level_of(self.doc, c.el),
                        fixable=False,
                        fix_blocked='columns are never moved automatically',
                        problem='Column clashing with column',
                        payload={},
                    ))

    # ------------------------------------------------------------------
    def _wall_overrun(self, w, c):
        """Which wall end is inside the column, and by how much.

        Walks in from each end along the wall axis to the first column face;
        whichever end is already inside is the one to pull back.
        """
        best = (1, 0.0)
        for ei, ep, direction in (
                (0, w.p0, XYZ(w.dir.X, w.dir.Y, 0.0)),
                (1, w.p1, XYZ(-w.dir.X, -w.dir.Y, 0.0))):
            probe = XYZ(ep.X, ep.Y,
                        max(min(ep.Z, c.z1 - geom.COINCIDENT), c.z0))
            d = geom.nearest_face_distance(c.faces, probe)
            if d is None:
                continue
            inside = self._point_inside(c, probe)
            if not inside:
                continue
            hit = geom.ray_first_hit(c.faces, probe, direction, w.length)
            if hit is None:
                continue
            if hit[0] > best[1]:
                best = (ei, hit[0])
        return best

    @staticmethod
    def _point_inside(c, pt):
        """Is the point inside the column?

        The previous version cast a ray, discarded the result and fell back to
        a bounding-box test -- which calls the corner of the box around a
        round column solid.
        """
        bb = c.bb
        if bb is None:
            return False
        if not (bb.Min.X <= pt.X <= bb.Max.X and
                bb.Min.Y <= pt.Y <= bb.Max.Y):
            return False        # cheap reject before the expensive test
        return geom.ray_parity_inside(c.faces, pt)

    # ------------------------------------------------------------------
    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(r):
            skipped[r] = skipped.get(r, 0) + 1

        allow_unpin = self.opt('allow_unpin')

        for iss in issues:
            if 'wall' not in iss.payload:
                note('columns are never moved automatically')
                continue
            w = self.doc.GetElement(new_id(iss.payload['wall']))
            if w is None:
                note('element no longer exists')
                continue
            lc = w.Location
            if not isinstance(lc, LocationCurve) or \
                    not isinstance(lc.Curve, Line):
                note('curved wall - trim manually')
                continue
            if w.Pinned and not allow_unpin:
                note('wall is pinned (enable "Unpin walls" to override)')
                continue
            if w.Pinned:
                try:
                    w.Pinned = False
                except Exception:
                    note('could not unpin')
                    continue
            if not core_editable(self.doc, w):
                note('owned by another user')
                continue

            wc = lc.Curve
            a, b = wc.GetEndPoint(0), wc.GetEndPoint(1)
            d = XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize()
            overrun = iss.payload['overrun']
            ei = iss.payload['end']
            try:
                if ei == 0:
                    new_line = Line.CreateBound(
                        XYZ(a.X + d.X * overrun, a.Y + d.Y * overrun, a.Z), b)
                else:
                    new_line = Line.CreateBound(
                        a, XYZ(b.X - d.X * overrun, b.Y - d.Y * overrun, b.Z))
                if new_line.Length < geom.mm(50.0):
                    note('result would be shorter than 50 mm')
                    continue
                lc.Curve = new_line
                fixed += 1
            except Exception:
                note('Revit rejected the new curve')
                log('wall/column trim failed for {0}'.format(
                    iss.payload['wall']))

        msg = 'Trimmed {0} wall(s) back to a column face.'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)
