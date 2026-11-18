# -*- coding: utf-8 -*-
"""Checks 2 and 3 -- wall junction quality.

Design notes worth keeping in mind when editing:

* Geometric overlap is NOT by itself evidence of a modelling error. Design
  options, phases and stacked walls all produce perfect overlap legitimately.
  Every pair is gated through modeldoctor.context.coexist() first.

* Distances are measured on the ACTUAL curve, never on its chord. An arc wall
  measured as a straight segment reports a phantom gap equal to its sagitta,
  which is why curved walls used to appear as corner gaps that were not there.

* Over-run is a signed distance along the victim's own axis, not the distance
  to the centreline intersection. Confusing the two reports 0.0 mm for every
  genuine over-run.

* A T-junction is extended to the target's NEAR FACE. A corner is extended to
  the centreline intersection, because that is what mitres correctly. These
  are different targets and using one for both leaves walls poking into the
  middle of their neighbour.
"""
from modeldoctor.compat import id_int, new_id
from math import fabs, pi, sin

from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, ElementId,
    Wall, Line, XYZ, LocationCurve, JoinGeometryUtils, WallUtils
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, element_name, type_name, log,
    editable as core_editable
)
from modeldoctor import geom
from modeldoctor import context

PARALLEL_TOL = 3.0 * pi / 180.0     # within 3 degrees counts as parallel
MIN_SIN = 0.10                      # clamp for near-parallel setback maths


class WallRec(object):
    """Everything the junction checks need, computed once."""

    __slots__ = ('el', 'id', 'curve', 'p0', 'p1', 'dir', 'thk', 'length',
                 'z0', 'z1', 'bb', 'hosted', 'is_line', '_faces')

    def __init__(self, wall):
        self.el = wall
        self.id = id_int(wall.Id)
        self.curve = geom.wall_curve(wall)
        self.p0 = self.curve.GetEndPoint(0)
        self.p1 = self.curve.GetEndPoint(1)
        self.is_line = isinstance(self.curve, Line)
        d = XYZ(self.p1.X - self.p0.X, self.p1.Y - self.p0.Y, 0.0)
        chord = d.GetLength()
        self.dir = d.Normalize() if chord > geom.EPS else XYZ.BasisX
        try:
            self.length = self.curve.Length
        except Exception:
            self.length = chord
        self.thk = geom.wall_thickness(wall)
        self.z0, self.z1 = geom.wall_z_range(wall)
        self.bb = wall.get_BoundingBox(None)
        self.hosted = None           # lazily counted
        self._faces = None           # lazily built

    @property
    def faces(self):
        """Side faces of the wall solid.

        Gaps are measured against these rather than against the location
        curve, because the location curve is only the centreline when
        Location Line is 'Wall Centerline'. On a Finish Face setting it sits
        on a face, and subtracting half the thickness then reports walls as
        far as half a wall closer than they really are.
        """
        if self._faces is None:
            self._faces = geom.side_faces(geom.solids_of(self.el))
        return self._faces

    @property
    def height(self):
        return self.z1 - self.z0

    @property
    def mid(self):
        return XYZ((self.p0.X + self.p1.X) * 0.5,
                   (self.p0.Y + self.p1.Y) * 0.5, 0.0)

    def axis_param(self, pt):
        """Distance along this wall's axis from p0, signed. Straight walls
        only -- meaningless for an arc."""
        return (geom.flat(pt) - geom.flat(self.p0)).DotProduct(self.dir)


def collect_walls(doc):
    recs = {}
    walls = (FilteredElementCollector(doc)
             .OfCategory(BuiltInCategory.OST_Walls)
             .WhereElementIsNotElementType()
             .ToElements())
    for w in walls:
        if not isinstance(w, Wall):
            continue
        try:
            if w.CurtainGrid is not None:
                continue          # curtain walls join by their own rules
        except Exception:
            pass
        try:
            if w.IsStackedWall:
                continue          # the parent duplicates its members
        except Exception:
            pass
        if geom.wall_curve(w) is None:
            continue
        r = WallRec(w)
        if r.bb is None:
            continue
        recs[r.id] = r
    return recs


def build_index(recs, pad):
    idx = geom.GridIndex(20.0)
    for r in recs.values():
        idx.add(r.id, r.bb, pad)
    return idx


def count_hosted(doc, wall):
    n = 0
    try:
        for _iid in wall.FindInserts(True, True, True, True):
            n += 1
    except Exception:
        pass
    return n


def sin_between(a, b):
    ang = geom.angle_between_dirs(a.dir, b.dir)
    return max(fabs(sin(ang)), MIN_SIN)


def level_of(doc, el):
    try:
        return element_name(doc.GetElement(el.LevelId))
    except Exception:
        return ''


def unpin_if_allowed(el, allowed):
    if not el.Pinned:
        return True
    if not allowed:
        return False
    try:
        el.Pinned = False
        return True
    except Exception:
        return False


# ===========================================================================
# Check 2 -- near-miss gaps
# ===========================================================================

@register
class WallGapCheck(BaseCheck):
    id = 'wall_gaps'
    title = 'Walls that nearly touch'
    group = 'Walls'
    description = ('Wall ends sitting a hair away from another wall. Reports '
                   'end-to-end, corner, T-junction and parallel sliver gaps.')
    can_fix = True
    fix_verb = 'Extend walls to close the gap'
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Maximum gap to report', 10.0, 'mm'),
        'min_gap_mm': ('Ignore gaps smaller than', 0.05, 'mm'),
        'extend_t_junction_to': ('Extend T-junctions to the target\'s',
                                 'face', 'face|centreline'),
        'report_parallel': ('Report parallel slivers (no auto-fix)', True, ''),
        'join_after_fix': ('Join geometry after extending', True, ''),
        'check_arc_walls': ('Include curved walls (report only)', True, ''),
        'allow_unpin': ('Unpin walls in order to fix them', False, ''),
        'same_phase_only': ('Only compare walls in overlapping phases',
                            True, ''),
        'same_option_only': ('Only compare walls that can coexist in design '
                             'options', True, ''),
    }

    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        min_gap = geom.mm(self.opt('min_gap_mm'))
        do_arcs = self.opt('check_arc_walls')
        recs = collect_walls(self.doc)
        self.population = len(recs)
        if not recs:
            return

        phase_map = context.PhaseMap(self.doc)
        chk_phase = self.opt('same_phase_only')
        chk_opt = self.opt('same_option_only')

        idx = build_index(recs, tol * 2.0)
        best_by_end = {}          # one finding per (wall, end)
        parallel_seen = set()

        for rid, r in recs.items():
            if not r.is_line and not do_arcs:
                continue
            for other_id in idx.query(r.bb, tol * 2.0):
                if other_id == rid:
                    continue
                o = recs[other_id]
                if not o.is_line and not do_arcs:
                    continue
                if not geom.z_ranges_overlap((r.z0, r.z1), (o.z0, o.z1)):
                    continue
                if not context.coexist(r.el, o.el, phase_map,
                                       chk_phase, chk_opt):
                    continue
                if geom.already_joined(self.doc, r.el, o.el):
                    continue

                for ei, ep in ((0, r.p0), (1, r.p1)):
                    # Classification only: which part of o are we near?
                    probe = XYZ(ep.X, ep.Y, o.p0.Z)
                    hit = geom.project_on_curve(o.curve, probe)
                    if hit is None:
                        continue
                    _d_axis, _closest, t = hit

                    # The gap itself is measured surface-to-surface. The wall
                    # end face passes through the location curve endpoint
                    # whatever the Location Line setting, so this point is on
                    # the real end face; o.faces are its real side faces.
                    zmid = max(min(ep.Z, o.z1 - geom.COINCIDENT), o.z0)
                    surface_probe = XYZ(ep.X, ep.Y, zmid)
                    gap = geom.nearest_face_distance(o.faces, surface_probe)
                    if gap is None:
                        continue
                    if gap < min_gap or gap > tol:
                        continue
                    if geom.ray_parity_inside(o.faces, surface_probe):
                        continue      # already buried in o -- an overlap

                    if r.is_line and o.is_line:
                        ang = geom.angle_between_dirs(r.dir, o.dir)
                        parallel = ang < PARALLEL_TOL
                    else:
                        parallel = False

                    if parallel:
                        # Truly collinear, or side by side? Extending only
                        # helps the first case.
                        off = fabs(geom.lateral_offset(ep, o.p0, o.dir))
                        if off > (o.thk + tol):
                            continue      # handled as a parallel sliver
                        kind = 'End-to-end gap'
                    elif t < 0.02 or t > 0.98:
                        kind = 'Corner gap'
                    else:
                        kind = 'T-junction gap'

                    key = (rid, ei)
                    prev = best_by_end.get(key)
                    if prev is None or gap < prev[0]:
                        best_by_end[key] = (gap, r, o, kind)

                # -- parallel sliver -------------------------------------
                if self.opt('report_parallel') and rid < other_id \
                        and r.is_line and o.is_line:
                    pkey = (rid, other_id)
                    if pkey in parallel_seen:
                        continue
                    if geom.angle_between_dirs(r.dir, o.dir) >= PARALLEL_TOL:
                        continue
                    hit = geom.project_on_curve(
                        o.curve, XYZ(r.mid.X, r.mid.Y, o.p0.Z))
                    if hit is None:
                        continue
                    _d, _c, t = hit
                    if t <= 0.001 or t >= 0.999:
                        continue          # not actually side by side
                    # Face to face, from r's own surface rather than its
                    # location curve.
                    zmid = max(min(r.mid.Z, o.z1 - geom.COINCIDENT), o.z0)
                    r_hit = geom.nearest_face_distance(
                        r.faces, XYZ(r.mid.X, r.mid.Y, zmid))
                    o_hit = geom.nearest_face_distance(
                        o.faces, XYZ(r.mid.X, r.mid.Y, zmid))
                    if r_hit is None or o_hit is None:
                        continue
                    face_gap = o_hit - r_hit
                    if face_gap < min_gap or face_gap > tol:
                        continue
                    parallel_seen.add(pkey)
                    self.issues.append(Issue(
                        self.id, [rid, other_id],
                        'Parallel walls {0} and {1} leave a {2:.1f} mm sliver '
                        '- extending cannot close a face-to-face gap{3}'
                        .format(rid, other_id, geom.to_mm(face_gap),
                                context.context_note(self.doc, r.el)),
                        value_mm=geom.to_mm(face_gap),
                        severity=Severity.INFO,
                        primary_id=rid,
                        category='Walls',
                        type_name=type_name(self.doc, r.el),
                        level=level_of(self.doc, r.el),
                        fixable=False,
                        fix_blocked='parallel walls cannot be closed by '
                                    'extending along their own axis',
                        problem='Parallel sliver',
                        payload={'mode': 'parallel'},
                    ))

        for key in best_by_end:
            rid, ei = key
            gap, r, o, kind = best_by_end[key]
            straight = r.is_line and o.is_line
            self.issues.append(Issue(
                self.id, [rid, o.id],
                '{0} of {1:.1f} mm between wall {2} (end {3}) and wall {4}{5}'
                .format(kind, geom.to_mm(gap), rid, ei + 1, o.id,
                        context.context_note(self.doc, r.el)),
                value_mm=geom.to_mm(gap),
                severity=Severity.WARNING,
                primary_id=rid,
                category='Walls',
                type_name=type_name(self.doc, r.el),
                level=level_of(self.doc, r.el),
                fixable=straight,
                fix_blocked=('' if straight
                             else 'curved wall - extend manually'),
                problem=kind,
                payload={'mode': 'extend', 'wall': rid, 'end': ei,
                         'target': o.id, 'gap': gap, 'kind': kind},
            ))

    # ------------------------------------------------------------------
    def _target_point(self, kind, ep, a, wd, ocv, o_thk):
        """Where the wall end should land.

        T-junction  -> the near FACE of the target, so the wall stops at the
                       surface instead of burying itself to the centreline.
        Corner      -> the centreline intersection, which is what mitres.
        End-to-end  -> the target's near end, projected onto our own axis so
                       the wall stays straight.
        """
        oa = ocv.GetEndPoint(0)
        ob = ocv.GetEndPoint(1)
        od = XYZ(ob.X - oa.X, ob.Y - oa.Y, 0.0).Normalize()

        if kind == 'T-junction gap' and \
                self.opt('extend_t_junction_to') == 'face':
            n = XYZ(-od.Y, od.X, 0.0)
            side = 1.0 if geom.lateral_offset(ep, oa, od) >= 0 else -1.0
            face_pt = XYZ(oa.X + n.X * side * o_thk * 0.5,
                          oa.Y + n.Y * side * o_thk * 0.5, 0.0)
            return geom.line_intersection_2d(geom.flat(a), wd,
                                             face_pt, od)

        ip = geom.line_intersection_2d(geom.flat(a), wd, geom.flat(oa), od)
        if ip is not None:
            return ip

        # Parallel: slide along our own axis to the target's nearer end.
        d0 = geom.dist2d(ep, oa)
        d1 = geom.dist2d(ep, ob)
        near = oa if d0 <= d1 else ob
        t = (geom.flat(near) - geom.flat(a)).DotProduct(wd)
        return XYZ(a.X + wd.X * t, a.Y + wd.Y * t, 0.0)

    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(reason):
            skipped[reason] = skipped.get(reason, 0) + 1

        join = self.opt('join_after_fix')
        tol = geom.mm(self.opt('tolerance_mm'))
        allow_unpin = self.opt('allow_unpin')

        for iss in issues:
            if iss.payload.get('mode') != 'extend':
                note('not an extendable gap')
                continue
            w = self.doc.GetElement(new_id(iss.payload['wall']))
            o = self.doc.GetElement(new_id(iss.payload['target']))
            if w is None or o is None:
                note('element no longer exists')
                continue
            lc, oc = w.Location, o.Location
            if not isinstance(lc, LocationCurve) or \
                    not isinstance(oc, LocationCurve):
                note('not a curve-driven wall')
                continue
            wc, ocv = lc.Curve, oc.Curve
            if not isinstance(wc, Line) or not isinstance(ocv, Line):
                note('curved wall - extend manually')
                continue
            if not unpin_if_allowed(w, allow_unpin):
                note('wall is pinned (enable "Unpin walls" to override)')
                continue
            if not core_editable(self.doc, w):
                note('owned by another user')
                continue

            ei = iss.payload['end']
            kind = iss.payload.get('kind', 'Corner gap')
            a, b = wc.GetEndPoint(0), wc.GetEndPoint(1)
            wd = XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize()
            ep = a if ei == 0 else b

            if kind == 'T-junction gap' and \
                    self.opt('extend_t_junction_to') == 'face':
                # Walk along the wall axis to the first real face of the
                # target. Independent of Location Line, and correct for
                # curved and compound targets.
                direction = (XYZ(a.X - b.X, a.Y - b.Y, 0.0).Normalize()
                             if ei == 0
                             else XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize())
                faces = geom.side_faces(geom.solids_of(o))
                reach = iss.payload.get('gap', tol) + tol + \
                    geom.wall_thickness(o) * 2.0
                hit = geom.ray_first_hit(faces, ep, direction, reach)
                target = None if hit is None else hit[1]
            else:
                target = self._target_point(kind, ep, a, wd, ocv,
                                            geom.wall_thickness(o))
            if target is None:
                note('could not resolve a target point')
                continue

            move = geom.dist2d(ep, target)
            # Extending to a face should move roughly the gap. Extending to a
            # centreline adds half the target's thickness, scaled by the
            # crossing angle.
            oa = ocv.GetEndPoint(0)
            od = XYZ(ocv.GetEndPoint(1).X - oa.X,
                     ocv.GetEndPoint(1).Y - oa.Y, 0.0).Normalize()
            ang = geom.angle_between_dirs(wd, od)
            setback = 0.0
            if not (kind == 'T-junction gap' and
                    self.opt('extend_t_junction_to') == 'face'):
                setback = (geom.wall_thickness(o) * 0.5) / \
                    max(fabs(sin(ang)), MIN_SIN)
            budget = iss.payload.get('gap', tol) + setback + tol
            if move > budget:
                note('move of {0:.0f} mm exceeded the {1:.0f} mm budget'
                     .format(geom.to_mm(move), geom.to_mm(budget)))
                continue

            new_pt = XYZ(target.X, target.Y, a.Z)
            try:
                new_line = (Line.CreateBound(new_pt, b) if ei == 0
                            else Line.CreateBound(a, new_pt))
                if new_line.Length < geom.mm(50.0):
                    note('result would be shorter than 50 mm')
                    continue
                lc.Curve = new_line
                fixed += 1
                if join and not JoinGeometryUtils.AreElementsJoined(
                        self.doc, w, o):
                    try:
                        JoinGeometryUtils.JoinGeometricElements(self.doc, w, o)
                    except Exception:
                        pass
            except Exception:
                note('Revit rejected the new curve')
                log('extend failed for wall {0}'.format(iss.payload['wall']))

        msg = 'Extended {0} wall end(s).'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)


# ===========================================================================
# Check 3 -- over-extended / overlapping walls
# ===========================================================================

PRIORITY_ORDERS = {
    'length': ['length', 'height', 'thickness', 'hosted', 'rhs'],
    'height': ['height', 'thickness', 'hosted', 'rhs'],
    'thickness': ['thickness', 'length', 'height', 'hosted', 'rhs'],
}


@register
class WallOverlapCheck(BaseCheck):
    id = 'wall_overlaps'
    title = 'Walls overlapping each other'
    group = 'Walls'
    description = ('Walls running past a junction so their solids occupy the '
                   'same space, whether or not join is allowed.')
    can_fix = True
    fix_verb = 'Shorten the lower-priority wall'
    score_factor = 1.0

    options = {
        'min_volume_m3': ('Ignore overlaps smaller than', 0.0005, 'm3'),
        'priority': ('Shorten whichever wall is', 'length',
                     'length|height|thickness'),
        'trim_to': ('Trim to', 'face', 'face|centreline'),
        'rhs_rule': ('Final tie-break picks wall further', 'east', 'east|west'),
        'min_remnant_mm': ('Delete instead of trimming below', 50.0, 'mm'),
        'delete_contained': ('Delete walls entirely inside another wall',
                             True, ''),
        'allow_unpin': ('Unpin walls in order to fix them', False, ''),
        'skip_crossing': ('Ignore full crossings (both walls run through)',
                          True, ''),
        'same_phase_only': ('Only compare walls in overlapping phases',
                            True, ''),
        'same_option_only': ('Only compare walls that can coexist in design '
                             'options', True, ''),
        'log_excluded': ('Log every excluded pair to the diagnostic file',
                         False, ''),
    }

    M3_TO_FT3 = 35.3146667

    def run(self):
        recs = collect_walls(self.doc)
        self.population = len(recs)
        if not recs:
            return
        min_vol = self.opt('min_volume_m3') * self.M3_TO_FT3
        phase_map = context.PhaseMap(self.doc)
        chk_phase = self.opt('same_phase_only')
        chk_opt = self.opt('same_option_only')
        verbose = self.opt('log_excluded')

        idx = build_index(recs, 0.0)
        solid_cache = {}
        done = set()

        for rid, r in recs.items():
            for other_id in idx.query(r.bb, 0.0):
                if other_id == rid:
                    continue
                key = (min(rid, other_id), max(rid, other_id))
                if key in done:
                    continue
                done.add(key)
                o = recs[other_id]
                if not geom.bbox_overlaps(r.bb, o.bb):
                    continue
                if not context.coexist(r.el, o.el, phase_map,
                                       chk_phase, chk_opt):
                    if verbose:
                        log('excluded {0}/{1}: {2}'.format(
                            rid, other_id,
                            context.why_not(r.el, o.el, phase_map)))
                    continue

                if rid not in solid_cache:
                    solid_cache[rid] = geom.solids_of(r.el)
                if other_id not in solid_cache:
                    solid_cache[other_id] = geom.solids_of(o.el)

                vol = geom.intersection_volume(solid_cache[rid],
                                               solid_cache[other_id])
                if vol <= min_vol:
                    continue
                if self.opt('skip_crossing') and self._is_crossing(r, o):
                    if verbose:
                        log('excluded {0}/{1}: deliberate crossing'
                            .format(rid, other_id))
                    continue

                # Containment decides the victim on its own: the wall buried
                # inside another is redundant no matter what the priority
                # order says.
                inner = self._contained(r, o)
                if inner is not None:
                    loser = inner
                    winner = o if inner is r else r
                    problem = 'Wall inside another wall'
                    reason = 'fully inside wall {0}'.format(winner.id)
                    overrun = loser.length
                    end_i = 0
                    mode = ('delete' if self.opt('delete_contained')
                            else 'none')
                else:
                    loser, winner, reason = self._choose_victim(r, o)
                    problem, overrun, end_i, mode = self._measure(loser, winner)
                    # A trim that leaves a stub is really a deletion.
                    if mode != 'none':
                        remnant = loser.length - overrun
                        if remnant < geom.mm(self.opt('min_remnant_mm')):
                            mode = 'delete'
                            problem = 'Overlap leaves only a stub'
                            reason += ', remnant below minimum'

                self.issues.append(Issue(
                    self.id, [rid, other_id],
                    'Walls {0} and {1} share {2:.4f} m3 - {3} wall {4} '
                    '({5}){6}'
                    .format(rid, other_id, vol / self.M3_TO_FT3,
                            'delete' if mode == 'delete'
                            else 'shorten {0:.0f} mm from'.format(
                                geom.to_mm(overrun)),
                            loser.id, reason,
                            context.context_note(self.doc, loser.el)),
                    value_mm=geom.to_mm(overrun),
                    severity=Severity.CRITICAL,
                    primary_id=loser.id,
                    category='Walls',
                    type_name=type_name(self.doc, loser.el),
                    level=level_of(self.doc, loser.el),
                    fixable=(mode != 'none' and loser.is_line
                             and winner.is_line),
                    fix_blocked=self._blocked_reason(mode, loser, winner),
                    problem=problem,
                    payload={'victim': loser.id, 'keeper': winner.id,
                             'overrun': overrun, 'end': end_i,
                             'mode': mode, 'reason': reason},
                ))

    # ------------------------------------------------------------------
    @staticmethod
    def _blocked_reason(mode, loser, winner):
        if not (loser.is_line and winner.is_line):
            return 'curved wall - trim manually'
        if mode == 'none':
            return ('solids overlap but neither wall runs past its junction '
                    '- likely a profile edit, opening or attached top/base')
        return ''

    def _contained(self, a, b):
        """Return whichever wall lies wholly inside the other, or None."""
        if not (a.is_line and b.is_line):
            return None
        if geom.angle_between_dirs(a.dir, b.dir) >= PARALLEL_TOL:
            return None
        if fabs(geom.lateral_offset(b.mid, a.p0, a.dir)) > \
                (a.thk + b.thk) * 0.5:
            return None
        for inner, outer in ((a, b), (b, a)):
            t0 = outer.axis_param(inner.p0)
            t1 = outer.axis_param(inner.p1)
            lo, hi = (t0, t1) if t0 <= t1 else (t1, t0)
            if lo >= -geom.COINCIDENT and hi <= outer.length + geom.COINCIDENT:
                # A wall is only "inside" if the other is genuinely bigger.
                if outer.length > inner.length + geom.COINCIDENT:
                    return inner
        return None

    def _is_crossing(self, r, o):
        if not (r.is_line and o.is_line):
            return False
        ip = geom.line_intersection_2d(geom.flat(r.p0), r.dir,
                                       geom.flat(o.p0), o.dir)
        if ip is None:
            return False
        tr = r.axis_param(ip)
        to = o.axis_param(ip)
        mr = (o.thk * 0.5) * 1.5
        mo = (r.thk * 0.5) * 1.5
        return (mr < tr < r.length - mr) and (mo < to < o.length - mo)

    def _hosted(self, rec):
        if rec.hosted is None:
            rec.hosted = count_hosted(self.doc, rec.el)
        return rec.hosted

    def _choose_victim(self, a, b):
        """Apply the configured priority order, first decisive rule wins."""
        order = PRIORITY_ORDERS.get(self.opt('priority'),
                                    PRIORITY_ORDERS['length'])
        for rule in order:
            if rule == 'length':
                if fabs(a.length - b.length) > geom.COINCIDENT:
                    return (a, b, 'shorter wall') if a.length < b.length \
                        else (b, a, 'shorter wall')
            elif rule == 'height':
                if fabs(a.height - b.height) > geom.COINCIDENT:
                    return (a, b, 'lower wall') if a.height < b.height \
                        else (b, a, 'lower wall')
            elif rule == 'thickness':
                if fabs(a.thk - b.thk) > geom.COINCIDENT:
                    return (a, b, 'thinner wall') if a.thk < b.thk \
                        else (b, a, 'thinner wall')
            elif rule == 'hosted':
                ha, hb = self._hosted(a), self._hosted(b)
                if ha != hb:
                    return (a, b, 'no hosted elements') if ha < hb \
                        else (b, a, 'no hosted elements')
            elif rule == 'rhs':
                east = self.opt('rhs_rule') == 'east'
                am, bm = a.mid, b.mid
                if fabs(am.X - bm.X) > geom.COINCIDENT:
                    a_first = (am.X > bm.X) if east else (am.X < bm.X)
                else:
                    a_first = (am.Y > bm.Y) if east else (am.Y < bm.Y)
                return (a, b, 'right-hand side') if a_first \
                    else (b, a, 'right-hand side')
        return (a, b, 'default')

    # ------------------------------------------------------------------
    def _measure(self, victim, keeper):
        """(problem_label, overrun_ft, end_index, mode), all along the
        victim's own axis."""
        if not (victim.is_line and keeper.is_line):
            return ('Overlap on a curved wall', 0.0, 0, 'none')

        stop_at_face = self.opt('trim_to') == 'face'
        ip = geom.line_intersection_2d(geom.flat(victim.p0), victim.dir,
                                       geom.flat(keeper.p0), keeper.dir)
        if ip is None:
            return self._measure_collinear(victim, keeper)

        t_ip = victim.axis_param(ip)
        setback = ((keeper.thk * 0.5) / sin_between(victim, keeper)
                   if stop_at_face else 0.0)

        if fabs(t_ip) < fabs(t_ip - victim.length):
            overrun = (t_ip + setback) - 0.0        # p0 should start here
            end_i = 0
        else:
            overrun = victim.length - (t_ip - setback)   # p1 should stop here
            end_i = 1

        if overrun <= geom.COINCIDENT:
            return ('Overlap without over-run', 0.0, end_i, 'none')

        ang = geom.angle_between_dirs(victim.dir, keeper.dir)
        if ang < PARALLEL_TOL:
            label = 'Parallel overlap'
        elif (0.0 < t_ip < victim.length and
              0.0 < keeper.axis_param(ip) < keeper.length):
            label = 'Crossing over-run'
        else:
            label = 'End over-run into wall'
        return (label, overrun, end_i, 'trim')

    def _measure_collinear(self, victim, keeper):
        ta = victim.axis_param(keeper.p0)
        tb = victim.axis_param(keeper.p1)
        lo, hi = (ta, tb) if ta <= tb else (tb, ta)
        ov_lo = max(0.0, lo)
        ov_hi = min(victim.length, hi)
        if ov_hi <= ov_lo:
            return ('Parallel overlap', 0.0, 0, 'none')
        keep_low = ov_lo
        keep_high = victim.length - ov_hi
        if keep_low >= keep_high:
            return ('Collinear overlap', victim.length - ov_lo, 1, 'trim')
        return ('Collinear overlap', ov_hi, 0, 'trim')

    # ------------------------------------------------------------------
    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(reason):
            skipped[reason] = skipped.get(reason, 0) + 1

        allow_unpin = self.opt('allow_unpin')
        removed = set()

        for iss in issues:
            mode = iss.payload.get('mode')
            vid = iss.payload['victim']
            if mode not in ('trim', 'delete'):
                note('no safe trim for this overlap type')
                continue
            if vid in removed:
                continue
            v = self.doc.GetElement(new_id(vid))
            if v is None:
                note('element no longer exists')
                continue
            if not unpin_if_allowed(v, allow_unpin):
                note('wall is pinned (enable "Unpin walls" to override)')
                continue
            if not core_editable(self.doc, v):
                note('owned by another user')
                continue

            if mode == 'delete':
                try:
                    self.doc.Delete(new_id(vid))
                    removed.add(vid)
                    fixed += 1
                except Exception:
                    note('Revit refused to delete the wall')
                continue

            vc = v.Location
            if not isinstance(vc, LocationCurve) or \
                    not isinstance(vc.Curve, Line):
                note('curved wall - trim manually')
                continue

            vl = vc.Curve
            a, b = vl.GetEndPoint(0), vl.GetEndPoint(1)
            d = XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize()
            overrun = iss.payload['overrun']
            end_i = iss.payload['end']

            if end_i == 0:
                new_line = self._safe_line(
                    XYZ(a.X + d.X * overrun, a.Y + d.Y * overrun, a.Z), b)
            else:
                new_line = self._safe_line(
                    a, XYZ(b.X - d.X * overrun, b.Y - d.Y * overrun, b.Z))

            if new_line is None:
                note('result would be shorter than 50 mm - raise the '
                     '"delete instead of trimming" threshold')
                continue
            try:
                try:
                    WallUtils.DisallowWallJoinAtEnd(v, end_i)
                except Exception:
                    pass
                vc.Curve = new_line
                fixed += 1
            except Exception:
                note('Revit rejected the new curve')
                log('trim failed for wall {0}'.format(vid))

        msg = 'Resolved {0} wall(s).'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)

    def _safe_line(self, p, q):
        try:
            ln = Line.CreateBound(p, q)
            if ln.Length < geom.mm(50.0):
                return None
            return ln
        except Exception:
            return None
