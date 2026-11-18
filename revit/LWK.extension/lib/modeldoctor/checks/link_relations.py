# -*- coding: utf-8 -*-
"""Checks against linked models.

Everything here compares host elements with geometry that lives in a linked
RVT. Three things matter and none of them are optional:

* Coordinates. A link has its own origin plus whatever the shared-coordinates
  or manual placement did to it. Nothing is comparable until the linked
  geometry has been through RevitLinkInstance.GetTotalTransform().

* Ownership. Linked elements cannot be modified, full stop. Where a fix is
  offered it always acts on the HOST element -- extending a host wall to a
  linked column, deleting a host wall that duplicates a linked one. Findings
  where the wrong side would have to move are report-only.

* Identity. A linked element id means nothing on its own; it only resolves
  inside its own document. Findings therefore carry the link name alongside
  the id, and Copy IDs emits them in the "LinkName : id" form so the
  reference is not lost.
"""
from modeldoctor.compat import id_int, new_id
from math import fabs

from System.Collections.Generic import List

from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, ElementId, XYZ, Line, Wall,
    RevitLinkInstance, ElementMulticategoryFilter, LocationCurve,
    LocationPoint, SolidUtils, BoundingBoxXYZ, Transform
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, element_name, type_name,
    category_name, log, probe, editable as core_editable
)
from modeldoctor import geom
from modeldoctor import context

M3_TO_FT3 = 35.3146667

# What is worth comparing across a link boundary. Structural elements first:
# arch-vs-struct coordination is what this is actually for.
COMPARE_CATEGORIES = [
    BuiltInCategory.OST_Walls,
    BuiltInCategory.OST_Columns,
    BuiltInCategory.OST_StructuralColumns,
    BuiltInCategory.OST_StructuralFraming,
    BuiltInCategory.OST_Floors,
    BuiltInCategory.OST_GenericModel,
    BuiltInCategory.OST_MechanicalEquipment,
    BuiltInCategory.OST_PlumbingFixtures,
]


def transform_bbox(bb, tf):
    """Axis-aligned host-coordinate box enclosing a transformed link box."""
    if bb is None:
        return None
    pts = []
    for x in (bb.Min.X, bb.Max.X):
        for y in (bb.Min.Y, bb.Max.Y):
            for z in (bb.Min.Z, bb.Max.Z):
                pts.append(tf.OfPoint(XYZ(x, y, z)))
    out = BoundingBoxXYZ()
    out.Min = XYZ(min(p.X for p in pts), min(p.Y for p in pts),
                  min(p.Z for p in pts))
    out.Max = XYZ(max(p.X for p in pts), max(p.Y for p in pts),
                  max(p.Z for p in pts))
    return out


class LinkedRec(object):
    """A linked element, expressed in host coordinates."""

    __slots__ = ('link_name', 'link_id', 'el', 'id', 'bb', 'transform',
                 '_solids', '_faces', 'category', 'type_name')

    def __init__(self, link_name, link_id, el, tf):
        self.link_name = link_name
        self.link_id = link_id
        self.el = el
        self.id = id_int(el.Id)
        self.transform = tf
        self.bb = transform_bbox(el.get_BoundingBox(None), tf)
        self._solids = None
        self._faces = None
        self.category = category_name(el)
        try:
            self.type_name = element_name(
                el.Document.GetElement(el.GetTypeId()))
        except Exception:
            self.type_name = ''

    @property
    def label(self):
        return '{0} : {1}'.format(self.link_name, self.id)

    @property
    def solids(self):
        if self._solids is None:
            out = []
            for s in geom.solids_of(self.el):
                try:
                    out.append(SolidUtils.CreateTransformed(s, self.transform))
                except Exception:
                    continue
            self._solids = out
        return self._solids

    @property
    def faces(self):
        if self._faces is None:
            self._faces = geom.side_faces(self.solids)
        return self._faces

    def location_key(self, tol):
        """Host-coordinate location signature, for duplicate detection."""
        loc = self.el.Location
        if isinstance(loc, LocationPoint):
            p = self.transform.OfPoint(loc.Point)
            return ('P', geom.snap(p.X, tol), geom.snap(p.Y, tol),
                    geom.snap(p.Z, tol))
        if isinstance(loc, LocationCurve):
            try:
                c = loc.Curve.CreateTransformed(self.transform)
            except Exception:
                return None
            a, b = c.GetEndPoint(0), c.GetEndPoint(1)
            ka = (geom.snap(a.X, tol), geom.snap(a.Y, tol),
                  geom.snap(a.Z, tol))
            kb = (geom.snap(b.X, tol), geom.snap(b.Y, tol),
                  geom.snap(b.Z, tol))
            if kb < ka:
                ka, kb = kb, ka
            return ('C', ka, kb)
        if self.bb is None:
            return None
        return ('B', geom.snap(self.bb.Min.X, tol),
                geom.snap(self.bb.Min.Y, tol), geom.snap(self.bb.Min.Z, tol),
                geom.snap(self.bb.Max.X, tol), geom.snap(self.bb.Max.Y, tol),
                geom.snap(self.bb.Max.Z, tol))


def collect_links(doc, name_filter=''):
    """Loaded link instances, optionally narrowed by name fragment."""
    out = []
    wanted = [w.strip().upper() for w in (name_filter or '').split(',')
              if w.strip()]
    for inst in (FilteredElementCollector(doc)
                 .OfClass(RevitLinkInstance)
                 .ToElements()):
        try:
            ldoc = inst.GetLinkDocument()
        except Exception:
            ldoc = None
        if ldoc is None:
            continue        # unloaded link
        try:
            name = element_name(inst)
        except Exception:
            name = 'link'
        if wanted and not any(w in name.upper() for w in wanted):
            continue
        try:
            tf = inst.GetTotalTransform()
        except Exception:
            tf = Transform.Identity
        out.append((name, id_int(inst.Id), ldoc, tf))
    return out


def collect_linked(doc, cats, name_filter=''):
    recs = []
    flt = ElementMulticategoryFilter(List[BuiltInCategory](cats))
    for name, lid, ldoc, tf in collect_links(doc, name_filter):
        probe('link scan: {0}'.format(name))
        try:
            els = (FilteredElementCollector(ldoc)
                   .WherePasses(flt)
                   .WhereElementIsNotElementType()
                   .ToElements())
        except Exception:
            continue
        for el in els:
            rec = LinkedRec(name, lid, el, tf)
            if rec.bb is None:
                continue
            recs.append(rec)
    return recs


def host_elements(doc, cats):
    flt = ElementMulticategoryFilter(List[BuiltInCategory](cats))
    return (FilteredElementCollector(doc)
            .WherePasses(flt)
            .WhereElementIsNotElementType()
            .ToElements())


def level_of(doc, el):
    try:
        return element_name(doc.GetElement(el.LevelId))
    except Exception:
        return ''


def _link_options():
    return {
        'link_name_filter': ('Only these links (comma separated, blank = all)',
                             '', 'text'),
        'max_faces': ('Skip solids with more faces than', 400, ''),
    }


# ===========================================================================
# Host elements clashing with linked elements
# ===========================================================================

@register
class LinkClashCheck(BaseCheck):
    id = 'link_clashes'
    score_factor = 1.0
    title = 'Host elements clashing with a link'
    group = 'Links'
    description = ('Host geometry occupying the same space as a linked model. '
                   'Report only - linked elements cannot be edited, and the '
                   'host side is a coordination decision.')
    can_fix = False

    options = dict(_link_options())
    options.update({
        'min_volume_m3': ('Ignore overlaps smaller than', 0.001, 'm3'),
    })

    def run(self):
        cats = list(COMPARE_CATEGORIES)
        min_vol = self.opt('min_volume_m3') * M3_TO_FT3
        max_faces = int(self.opt('max_faces'))

        linked = collect_linked(self.doc, cats, self.opt('link_name_filter'))
        hosts = host_elements(self.doc, cats)
        self.population = len(hosts)

        if not linked:
            self._no_links()
            return

        idx = geom.GridIndex(20.0)
        for i, rec in enumerate(linked):
            idx.add(i, rec.bb)

        host_solids = {}
        for h in hosts:
            hbb = h.get_BoundingBox(None)
            if hbb is None:
                continue
            hid = id_int(h.Id)
            for li in idx.query(hbb):
                rec = linked[li]
                if not geom.bbox_overlaps(hbb, rec.bb):
                    continue
                if hid not in host_solids:
                    host_solids[hid] = geom.solids_of(h)
                if not host_solids[hid]:
                    continue
                probe('link_clashes host {0} vs {1}'.format(hid, rec.label))
                vol = geom.intersection_volume(host_solids[hid], rec.solids,
                                               max_faces)
                if vol <= min_vol:
                    continue
                self.issues.append(Issue(
                    self.id, [hid],
                    'Host {0} {1} clashes with {2} {3} in link "{4}" '
                    '({5:.4f} m3)'
                    .format(category_name(h), hid, rec.category, rec.id,
                            rec.link_name, vol / M3_TO_FT3),
                    value_mm=None,
                    severity=Severity.CRITICAL,
                    primary_id=hid,
                    category=category_name(h),
                    type_name=type_name(self.doc, h),
                    level=level_of(self.doc, h),
                    fixable=False,
                    fix_blocked='linked elements cannot be edited - resolve '
                                'with the link owner',
                    problem='Clash with linked model',
                    payload={'host': hid, 'link': rec.link_name,
                             'linked_id': rec.id},
                ))

    def _no_links(self):
        self.issues.append(Issue(
            self.id, [],
            'No loaded Revit links found, so nothing could be compared.',
            severity=Severity.INFO, primary_id=0, fixable=False,
            problem='No reference geometry', scoreless=True,
            fix_blocked='nothing to fix - no linked model loaded'))
        self.population = 0


# ===========================================================================
# Host walls nearly touching linked geometry
# ===========================================================================

@register
class LinkGapCheck(BaseCheck):
    id = 'link_gaps'
    score_factor = 1.0
    title = 'Host walls that nearly touch a link'
    group = 'Links'
    description = ('Host wall ends stopping a hair short of a linked wall, '
                   'column or beam. The host wall can be extended.')
    can_fix = True
    fix_verb = 'Extend the host wall onto the linked face'

    options = dict(_link_options())
    options.update({
        'tolerance_mm': ('Maximum gap to report', 10.0, 'mm'),
        'min_gap_mm': ('Ignore gaps smaller than', 0.05, 'mm'),
        'allow_unpin': ('Unpin host walls in order to fix them', False, ''),
    })

    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        min_gap = geom.mm(self.opt('min_gap_mm'))
        cats = [BuiltInCategory.OST_Walls, BuiltInCategory.OST_Columns,
                BuiltInCategory.OST_StructuralColumns,
                BuiltInCategory.OST_StructuralFraming]

        linked = collect_linked(self.doc, cats, self.opt('link_name_filter'))
        from modeldoctor.checks.wall_junctions import collect_walls
        walls = collect_walls(self.doc)
        self.population = len(walls)

        if not linked:
            self.issues.append(Issue(
                self.id, [],
                'No loaded Revit links found, so nothing could be compared.',
                severity=Severity.INFO, primary_id=0, fixable=False,
                problem='No reference geometry', scoreless=True,
                fix_blocked='nothing to fix - no linked model loaded'))
            self.population = 0
            return

        idx = geom.GridIndex(20.0)
        for i, rec in enumerate(linked):
            idx.add(i, rec.bb, tol * 2.0)

        best_by_end = {}
        for wid, w in walls.items():
            for li in idx.query(w.bb, tol * 2.0):
                rec = linked[li]
                if not geom.z_ranges_overlap(
                        (w.z0, w.z1), (rec.bb.Min.Z, rec.bb.Max.Z)):
                    continue
                faces = rec.faces
                if not faces:
                    continue
                for ei, ep in ((0, w.p0), (1, w.p1)):
                    z = max(min(ep.Z, rec.bb.Max.Z - geom.COINCIDENT),
                            rec.bb.Min.Z)
                    pt = XYZ(ep.X, ep.Y, z)
                    d = geom.nearest_face_distance(faces, pt)
                    if d is None or d < min_gap or d > tol:
                        continue
                    if geom.ray_parity_inside(faces, pt):
                        continue        # buried: that is a clash, not a gap
                    key = (wid, ei)
                    prev = best_by_end.get(key)
                    if prev is None or d < prev[0]:
                        best_by_end[key] = (d, w, rec)

        for key in best_by_end:
            wid, ei = key
            gap, w, rec = best_by_end[key]
            self.issues.append(Issue(
                self.id, [wid],
                'Host wall {0} (end {1}) stops {2:.1f} mm short of {3} {4} '
                'in link "{5}"'
                .format(wid, ei + 1, geom.to_mm(gap), rec.category, rec.id,
                        rec.link_name),
                value_mm=geom.to_mm(gap),
                severity=Severity.WARNING,
                primary_id=wid,
                category='Walls',
                type_name=type_name(self.doc, w.el),
                level=level_of(self.doc, w.el),
                fixable=w.is_line,
                fix_blocked=('' if w.is_line
                             else 'curved wall - extend manually'),
                problem='Host wall short of link',
                payload={'wall': wid, 'link_inst': rec.link_id,
                         'linked_id': rec.id, 'gap': gap, 'end': ei},
            ))

    # ------------------------------------------------------------------
    def fix(self, issues):
        fixed = 0
        skipped = {}

        def note(r):
            skipped[r] = skipped.get(r, 0) + 1

        tol = geom.mm(self.opt('tolerance_mm'))
        allow_unpin = self.opt('allow_unpin')

        # Re-resolve the linked geometry: solids cannot be cached across the
        # transaction boundary safely.
        links = {}
        for name, lid, ldoc, tf in collect_links(self.doc):
            links[lid] = (ldoc, tf)

        for iss in issues:
            w = self.doc.GetElement(new_id(iss.payload['wall']))
            if w is None:
                note('element no longer exists')
                continue
            entry = links.get(iss.payload['link_inst'])
            if entry is None:
                note('link no longer loaded')
                continue
            ldoc, tf = entry
            target = ldoc.GetElement(new_id(iss.payload['linked_id']))
            if target is None:
                note('linked element no longer exists')
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

            solids = []
            for s in geom.solids_of(target):
                try:
                    solids.append(SolidUtils.CreateTransformed(s, tf))
                except Exception:
                    pass
            faces = geom.side_faces(solids)
            if not faces:
                note('could not read the linked geometry')
                continue

            wc = lc.Curve
            a, b = wc.GetEndPoint(0), wc.GetEndPoint(1)
            ei = iss.payload['end']
            ep = a if ei == 0 else b
            direction = (XYZ(a.X - b.X, a.Y - b.Y, 0.0).Normalize() if ei == 0
                         else XYZ(b.X - a.X, b.Y - a.Y, 0.0).Normalize())
            reach = iss.payload['gap'] + tol * 2.0
            hit = geom.ray_first_hit(faces, ep, direction, reach)
            if hit is None:
                note('the linked face is not along the wall axis')
                continue

            new_pt = XYZ(hit[1].X, hit[1].Y, a.Z)
            try:
                new_line = (Line.CreateBound(new_pt, b) if ei == 0
                            else Line.CreateBound(a, new_pt))
                if new_line.Length < geom.mm(50.0):
                    note('result would be shorter than 50 mm')
                    continue
                lc.Curve = new_line
                fixed += 1
            except Exception:
                note('Revit rejected the new curve')
                log('link extend failed for wall {0}'.format(
                    iss.payload['wall']))

        msg = 'Extended {0} host wall end(s) onto linked geometry.'.format(
            fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)


# ===========================================================================
# Host elements duplicating linked elements
# ===========================================================================

@register
class LinkDuplicateCheck(BaseCheck):
    id = 'link_duplicates'
    score_factor = 1.0
    title = 'Host elements duplicating a link'
    group = 'Links'
    description = ('Host elements sitting in exactly the same place as an '
                   'element in a linked model - typically an architectural '
                   'wall re-modelled over the structural one.')
    can_fix = True
    fix_verb = 'Delete the host copy'

    options = dict(_link_options())
    options.update({
        'tolerance_mm': ('Position tolerance', 5.0, 'mm'),
        'match_type_name': ('Only when the type names match too', False, ''),
    })

    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        match_type = self.opt('match_type_name')
        cats = list(COMPARE_CATEGORIES)

        linked = collect_linked(self.doc, cats, self.opt('link_name_filter'))
        hosts = host_elements(self.doc, cats)
        self.population = len(hosts)

        if not linked:
            self.issues.append(Issue(
                self.id, [],
                'No loaded Revit links found, so nothing could be compared.',
                severity=Severity.INFO, primary_id=0, fixable=False,
                problem='No reference geometry', scoreless=True,
                fix_blocked='nothing to fix - no linked model loaded'))
            self.population = 0
            return

        # Bucket linked elements by host-coordinate location.
        buckets = {}
        for rec in linked:
            key = rec.location_key(tol)
            if key is None:
                continue
            buckets.setdefault((rec.category, key), []).append(rec)

        for h in hosts:
            key = self._host_key(h, tol)
            if key is None:
                continue
            matches = buckets.get((category_name(h), key))
            if not matches:
                continue
            rec = matches[0]
            if match_type and rec.type_name != type_name(self.doc, h):
                continue
            hid = id_int(h.Id)
            self.issues.append(Issue(
                self.id, [hid],
                'Host {0} {1} sits in the same place as {2} in link "{3}" '
                '(linked type "{4}")'
                .format(category_name(h), hid, rec.id, rec.link_name,
                        rec.type_name),
                value_mm=None,
                severity=Severity.WARNING,
                primary_id=hid,
                category=category_name(h),
                type_name=type_name(self.doc, h),
                level=level_of(self.doc, h),
                fixable=True,
                problem='Duplicates a linked element',
                payload={'host': hid, 'link': rec.link_name,
                         'linked_id': rec.id},
            ))

    def _host_key(self, el, tol):
        loc = el.Location
        if isinstance(loc, LocationPoint):
            p = loc.Point
            return ('P', geom.snap(p.X, tol), geom.snap(p.Y, tol),
                    geom.snap(p.Z, tol))
        if isinstance(loc, LocationCurve):
            c = loc.Curve
            a, b = c.GetEndPoint(0), c.GetEndPoint(1)
            ka = (geom.snap(a.X, tol), geom.snap(a.Y, tol),
                  geom.snap(a.Z, tol))
            kb = (geom.snap(b.X, tol), geom.snap(b.Y, tol),
                  geom.snap(b.Z, tol))
            if kb < ka:
                ka, kb = kb, ka
            return ('C', ka, kb)
        bb = el.get_BoundingBox(None)
        if bb is None:
            return None
        return ('B', geom.snap(bb.Min.X, tol), geom.snap(bb.Min.Y, tol),
                geom.snap(bb.Min.Z, tol), geom.snap(bb.Max.X, tol),
                geom.snap(bb.Max.Y, tol), geom.snap(bb.Max.Z, tol))

    # ------------------------------------------------------------------
    def fix(self, issues):
        """Delete the HOST copy only. The linked element is the survivor by
        definition -- it is not ours to touch."""
        fixed = 0
        skipped = {}

        def note(r):
            skipped[r] = skipped.get(r, 0) + 1

        for iss in issues:
            hid = iss.payload['host']
            el = self.doc.GetElement(new_id(hid))
            if el is None:
                note('element no longer exists')
                continue
            if el.Pinned:
                note('host element is pinned')
                continue
            if not core_editable(self.doc, el):
                note('owned by another user')
                continue
            try:
                self.doc.Delete(new_id(hid))
                fixed += 1
            except Exception:
                note('Revit refused to delete the host element')

        msg = 'Deleted {0} host duplicate(s).'.format(fixed)
        if skipped:
            msg += ' Skipped: ' + '; '.join(
                '{0} x {1}'.format(skipped[k], k) for k in skipped)
        return (fixed, msg)
