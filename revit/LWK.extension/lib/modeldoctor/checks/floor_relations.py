# -*- coding: utf-8 -*-
"""Checks 4-7 -- elements measured against the floors around them.

All four share a FloorProbe, which is expensive to build, so it is cached on
the module and rebuilt once per Run All.
"""
from modeldoctor.compat import id_int, new_id
from System.Collections.Generic import List

from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, BuiltInParameter, ElementId,
    Wall, XYZ, FamilyInstance, Level, ElementMulticategoryFilter,
    LocationPoint, LocationCurve
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, element_name, type_name,
    category_name, log
)
from modeldoctor import geom

_PROBE_CACHE = {'key': None, 'probe': None}


def get_probe(doc):
    key = doc.GetHashCode()
    if _PROBE_CACHE['key'] != key or _PROBE_CACHE['probe'] is None:
        _PROBE_CACHE['probe'] = geom.FloorProbe(doc)
        _PROBE_CACHE['key'] = key
    return _PROBE_CACHE['probe']


def invalidate_probe():
    _PROBE_CACHE['key'] = None
    _PROBE_CACHE['probe'] = None


def no_floor_notice(check, probe, what='floors'):
    """Emit a visible notice when the reference geometry is simply absent.

    A check that reports zero because there is nothing to measure against
    looks identical to a check that reports zero because the model is clean.
    They are very different, and the second one should not be assumed.
    """
    if probe.count > 0:
        return False
    check.issues.append(Issue(
        check.id, [], 
        'No {0} found in this model, so nothing could be measured. If the '
        'slabs live in a linked structural model, this check cannot see '
        'them - run it in the model that owns the {0}.'.format(what),
        value_mm=None,
        severity=Severity.INFO,
        primary_id=0,
        category='',
        type_name='',
        level='',
        fixable=False,
        fix_blocked='nothing to fix - no reference geometry',
        problem='No reference geometry',
        scoreless=True,
    ))
    return True


def level_name(doc, el):
    try:
        lid = el.LevelId
        if lid is not None and lid != ElementId.InvalidElementId:
            return element_name(doc.GetElement(lid))
    except Exception:
        pass
    return ''


# ===========================================================================
# Check 4 -- doors sitting below or too far above the floor
# ===========================================================================

@register
class DoorFloorCheck(BaseCheck):
    id = 'door_floor'
    title = 'Doors not sitting on the floor'
    group = 'Openings'
    description = ('Door sill compared with the finished floor directly '
                   'beneath it. Catches the classic "level offset changed, '
                   'door left behind" case.')
    can_fix = True
    fix_verb = 'Reset sill to floor level'
    score_factor = 1.0

    options = {
        'allowance_mm': ('Allowed sill height above floor (e.g. plant room '
                         'upstand)', 25.0, 'mm'),
        'below_tol_mm': ('Ignore drops smaller than', 1.0, 'mm'),
        'reference_floor': ('Measure against', 'topmost', 'topmost|thickest'),
        'search_mm': ('Search distance for a floor below', 4000.0, 'mm'),
        'include_windows': ('Also check windows', False, ''),
    }

    def _targets(self):
        cats = [BuiltInCategory.OST_Doors]
        if self.opt('include_windows'):
            cats.append(BuiltInCategory.OST_Windows)
        flt = ElementMulticategoryFilter(List[BuiltInCategory](cats))
        return (FilteredElementCollector(self.doc)
                .WherePasses(flt)
                .WhereElementIsNotElementType()
                .ToElements())

    def _sill_z(self, door):
        """Absolute Z of the bottom of the opening."""
        bb = door.get_BoundingBox(None)
        base = bb.Min.Z if bb is not None else None
        # The bounding box includes frames and thresholds that hang below the
        # sill, so prefer the parameter when it is available.
        try:
            lvl = self.doc.GetElement(door.LevelId)
            p = door.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
            if lvl is not None and p is not None:
                return lvl.Elevation + p.AsDouble(), lvl, p
        except Exception:
            pass
        return base, None, None

    def run(self):
        probe = get_probe(self.doc)
        allowance = geom.mm(self.opt('allowance_mm'))
        below_tol = geom.mm(self.opt('below_tol_mm'))
        search = geom.mm(self.opt('search_mm'))
        mode = self.opt('reference_floor')

        doors = self._targets()
        self.population = len(doors)
        if no_floor_notice(self, probe):
            return

        for d in doors:
            loc = d.Location
            if not isinstance(loc, LocationPoint):
                continue
            p = loc.Point
            sill_z, lvl, sill_param = self._sill_z(d)
            if sill_z is None:
                continue

            hit = probe.top_at(p.X, p.Y, sill_z, search, mode)
            if hit is None:
                continue
            floor_el, floor_z, _thk = hit
            delta = sill_z - floor_z

            if delta < -below_tol:
                sev = Severity.CRITICAL
                problem = 'Door below floor'
                text = ('Door {0} sits {1:.1f} mm BELOW floor {2}'
                        .format(id_int(d.Id), abs(geom.to_mm(delta)),
                                id_int(floor_el.Id)))
            elif delta > allowance:
                sev = Severity.WARNING
                problem = 'Door above floor'
                text = ('Door {0} sits {1:.1f} mm above floor {2} (allowance '
                        '{3:.0f} mm)'.format(id_int(d.Id),
                                             geom.to_mm(delta),
                                             id_int(floor_el.Id),
                                             self.opt('allowance_mm')))
            else:
                continue

            self.issues.append(Issue(
                self.id, [id_int(d.Id), id_int(floor_el.Id)],
                text, value_mm=geom.to_mm(delta), severity=sev,
                primary_id=id_int(d.Id),
                category=category_name(d),
                type_name=type_name(self.doc, d),
                level=level_name(self.doc, d),
                fixable=sill_param is not None and not sill_param.IsReadOnly,
                problem=problem,
                payload={'door': id_int(d.Id), 'target_z': floor_z},
            ))

    # ------------------------------------------------------------------
    def fix(self, issues):
        """Set the sill so the opening bottom lands exactly on the floor.

        The reference level is left alone unless `relevel` finds a Level whose
        elevation matches the floor better than the current one -- silently
        re-hosting doors to different levels breaks schedules.
        """
        fixed = 0
        for iss in issues:
            d = self.doc.GetElement(new_id(iss.payload['door']))
            if d is None:
                continue
            try:
                lvl = self.doc.GetElement(d.LevelId)
                p = d.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
                if lvl is None or p is None or p.IsReadOnly:
                    continue
                p.Set(iss.payload['target_z'] - lvl.Elevation)
                fixed += 1
            except Exception:
                log('door sill fix failed for {0}'.format(iss.payload['door']))
        return (fixed, 'Reset {0} door sill(s).'.format(fixed))


# ===========================================================================
# Check 5 -- wall base against the slab it stands on
# ===========================================================================

@register
class WallBaseFloorCheck(BaseCheck):
    id = 'wall_base_floor'
    title = 'Wall base not level with its slab'
    group = 'Walls'
    description = ('Wall bases floating above or buried in the structural '
                   'slab below. Report only - fix with your slab tool.')
    can_fix = False
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Ignore differences smaller than', 2.0, 'mm'),
        'search_mm': ('Search distance for a slab below', 2000.0, 'mm'),
        'reference_floor': ('Measure against', 'thickest', 'thickest|topmost'),
        'samples': ('Sample points along each wall', 5, ''),
    }

    def run(self):
        probe = get_probe(self.doc)
        tol = geom.mm(self.opt('tolerance_mm'))
        search = geom.mm(self.opt('search_mm'))
        mode = self.opt('reference_floor')
        samples = int(self.opt('samples'))

        walls = (FilteredElementCollector(self.doc)
                 .OfCategory(BuiltInCategory.OST_Walls)
                 .WhereElementIsNotElementType()
                 .ToElements())
        self.population = len(walls)
        if no_floor_notice(self, probe):
            return

        for w in walls:
            if not isinstance(w, Wall):
                continue
            c = geom.wall_curve(w)
            if c is None:
                continue
            base_z, _top_z = geom.wall_z_range(w)

            # Sample away from the ends so a wall merely abutting a slab edge
            # is not counted as standing on it.
            best = None
            for pt in geom.sample_points_on_curve(c, samples):
                hit = probe.top_at(pt.X, pt.Y, base_z, search, mode)
                if hit is None:
                    continue
                if best is None or abs(hit[1] - base_z) > abs(best[1] - base_z):
                    best = hit
            if best is None:
                continue

            floor_el, floor_z, thk = best
            delta = base_z - floor_z
            if abs(delta) <= tol:
                continue

            word = 'above' if delta > 0 else 'below'
            self.issues.append(Issue(
                self.id, [id_int(w.Id), id_int(floor_el.Id)],
                'Wall {0} base is {1:.1f} mm {2} the top of slab {3} '
                '(slab thickness {4:.0f} mm)'
                .format(id_int(w.Id), abs(geom.to_mm(delta)), word,
                        id_int(floor_el.Id), geom.to_mm(thk)),
                value_mm=geom.to_mm(delta),
                severity=Severity.WARNING if delta > 0 else Severity.CRITICAL,
                primary_id=id_int(w.Id),
                category='Walls',
                type_name=type_name(self.doc, w),
                level=level_name(self.doc, w),
                fixable=False,
                problem=('Wall base above slab' if delta > 0
                         else 'Wall base buried in slab'),
            ))


# ===========================================================================
# Check 6 -- wall top against the soffit above
# ===========================================================================

@register
class WallTopSoffitCheck(BaseCheck):
    id = 'wall_top_soffit'
    title = 'Wall top not meeting the soffit above'
    group = 'Walls'
    description = ('Wall tops stopping short of, or running past, the ceiling '
                   'or slab soffit above. Report only.')
    can_fix = False
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Ignore differences smaller than', 2.0, 'mm'),
        'search_mm': ('Search distance for a soffit above', 6000.0, 'mm'),
        'reference_floor': ('Measure against', 'thickest', 'thickest|topmost'),
        'include_ceilings': ('Include ceilings as well as slabs', True, ''),
        'overshoot_mm': ('How far a wall may already poke through', 1000.0,
                         'mm'),
        'samples': ('Sample points along each wall', 5, ''),
    }

    def run(self):
        cats = [BuiltInCategory.OST_Floors]
        if self.opt('include_ceilings'):
            cats.append(BuiltInCategory.OST_Ceilings)
        probe = geom.FloorProbe(self.doc, cats)

        tol = geom.mm(self.opt('tolerance_mm'))
        search = geom.mm(self.opt('search_mm'))
        mode = self.opt('reference_floor')
        samples = int(self.opt('samples'))

        walls = (FilteredElementCollector(self.doc)
                 .OfCategory(BuiltInCategory.OST_Walls)
                 .WhereElementIsNotElementType()
                 .ToElements())
        self.population = len(walls)
        if no_floor_notice(self, probe, 'floors or ceilings'):
            return

        overshoot = geom.mm(self.opt('overshoot_mm'))

        for w in walls:
            if not isinstance(w, Wall):
                continue
            c = geom.wall_curve(w)
            if c is None:
                continue
            _base_z, top_z = geom.wall_z_range(w)

            best = None
            for pt in geom.sample_points_on_curve(c, samples):
                # Start just below the wall top so a wall that already pokes
                # through still finds the slab it is passing. Half the search
                # distance was far too generous -- it could latch onto a
                # soffit three metres below the wall top.
                hit = probe.bottom_above(pt.X, pt.Y, top_z - overshoot,
                                         search, mode)
                if hit is None:
                    continue
                if best is None or abs(hit[1] - top_z) > abs(best[1] - top_z):
                    best = hit
            if best is None:
                continue

            host_el, soffit_z, thk = best
            delta = top_z - soffit_z
            if abs(delta) <= tol:
                continue

            word = 'past' if delta > 0 else 'short of'
            self.issues.append(Issue(
                self.id, [id_int(w.Id), id_int(host_el.Id)],
                'Wall {0} top runs {1:.1f} mm {2} the soffit of {3} '
                '({4}, thickness {5:.0f} mm)'
                .format(id_int(w.Id), abs(geom.to_mm(delta)), word,
                        id_int(host_el.Id), category_name(host_el),
                        geom.to_mm(thk)),
                value_mm=geom.to_mm(delta),
                severity=Severity.WARNING,
                primary_id=id_int(w.Id),
                category='Walls',
                type_name=type_name(self.doc, w),
                level=level_name(self.doc, w),
                fixable=False,
                problem=('Wall top past soffit' if delta > 0
                         else 'Wall top short of soffit'),
            ))


# ===========================================================================
# Check 7 -- loose components buried in the floor
# ===========================================================================

CLASH_CATEGORIES = [
    BuiltInCategory.OST_PlumbingFixtures,
    BuiltInCategory.OST_SpecialityEquipment,
    BuiltInCategory.OST_GenericModel,
    BuiltInCategory.OST_Furniture,
    BuiltInCategory.OST_FurnitureSystems,
    BuiltInCategory.OST_Casework,
    BuiltInCategory.OST_MechanicalEquipment,
    BuiltInCategory.OST_ElectricalFixtures,
    BuiltInCategory.OST_ElectricalEquipment,
    BuiltInCategory.OST_LightingFixtures,
]

OFFSET_PARAMS = [
    BuiltInParameter.INSTANCE_FREE_HOST_OFFSET_PARAM,
    BuiltInParameter.INSTANCE_ELEVATION_PARAM,
    BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM,
    BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM,
]


@register
class ElementFloorClashCheck(BaseCheck):
    id = 'element_floor'
    title = 'Components sunk into the floor'
    group = 'Components'
    description = ('Fixtures, equipment and generic models whose base is below '
                   'the top of the finished floor beneath them.')
    can_fix = True
    fix_verb = 'Raise to floor level'
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Ignore drops smaller than', 2.0, 'mm'),
        'search_mm': ('Search distance for a floor below', 4000.0, 'mm'),
        'reference_floor': ('Measure against', 'topmost', 'topmost|thickest'),
        'skip_hosted': ('Skip face/wall-hosted components', True, ''),
        'skip_recessed': ('Ignore components deeper than', 300.0, 'mm'),
    }

    def run(self):
        probe = get_probe(self.doc)
        tol = geom.mm(self.opt('tolerance_mm'))
        search = geom.mm(self.opt('search_mm'))
        mode = self.opt('reference_floor')
        deep_limit = geom.mm(self.opt('skip_recessed'))
        skip_hosted = self.opt('skip_hosted')

        flt = ElementMulticategoryFilter(
            List[BuiltInCategory](CLASH_CATEGORIES))
        els = (FilteredElementCollector(self.doc)
               .WherePasses(flt)
               .WhereElementIsNotElementType()
               .ToElements())
        self.population = len(els)
        if no_floor_notice(self, probe):
            return

        for el in els:
            if skip_hosted and isinstance(el, FamilyInstance):
                try:
                    if el.Host is not None and not isinstance(el.Host, Level):
                        continue
                except Exception:
                    pass
            bb = el.get_BoundingBox(None)
            if bb is None:
                continue
            cx = (bb.Min.X + bb.Max.X) * 0.5
            cy = (bb.Min.Y + bb.Max.Y) * 0.5
            base_z = bb.Min.Z

            hit = probe.top_at(cx, cy, base_z, search, mode)
            if hit is None:
                continue
            floor_el, floor_z, _thk = hit
            delta = base_z - floor_z
            if delta >= -tol:
                continue
            if abs(delta) > deep_limit:
                # Deliberately recessed (floor drains, sunken baths, pits).
                continue

            param = self._offset_param(el)
            self.issues.append(Issue(
                self.id, [id_int(el.Id), id_int(floor_el.Id)],
                '{0} {1} is {2:.1f} mm below the top of floor {3}'
                .format(category_name(el), id_int(el.Id),
                        abs(geom.to_mm(delta)), id_int(floor_el.Id)),
                value_mm=geom.to_mm(delta),
                severity=Severity.WARNING,
                primary_id=id_int(el.Id),
                category=category_name(el),
                type_name=type_name(self.doc, el),
                level=level_name(self.doc, el),
                fixable=param is not None,
                problem='Component sunk into floor',
                payload={'element': id_int(el.Id), 'delta': delta,
                         'param': int(param) if param is not None else None},
            ))

    def _offset_param(self, el):
        for bip in OFFSET_PARAMS:
            try:
                p = el.get_Parameter(bip)
            except Exception:
                p = None
            if p is not None and not p.IsReadOnly:
                return bip
        return None

    # ------------------------------------------------------------------
    def fix(self, issues):
        """Add the measured shortfall to the element's offset, exactly as
        specified -- never rewrite the level itself."""
        fixed = 0
        for iss in issues:
            bip_val = iss.payload.get('param')
            if bip_val is None:
                continue
            el = self.doc.GetElement(new_id(iss.payload['element']))
            if el is None:
                continue
            try:
                bip = BuiltInParameter(bip_val)
                p = el.get_Parameter(bip)
                if p is None or p.IsReadOnly:
                    continue
                p.Set(p.AsDouble() - iss.payload['delta'])
                fixed += 1
            except Exception:
                log('raise failed for {0}'.format(iss.payload['element']))
        return (fixed, 'Raised {0} component(s).'.format(fixed))
