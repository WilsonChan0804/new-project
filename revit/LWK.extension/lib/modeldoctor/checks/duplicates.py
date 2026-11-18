# -*- coding: utf-8 -*-
"""Check 1 -- coincident duplicate elements (the OVERKILL equivalent).

Two elements are duplicates when their *signature* matches: same category,
same type, same level/host, same location geometry to tolerance, same
flip state, and same geometry-driving parameters.  Mark, Comments and other
book-keeping data are deliberately excluded.
"""
from modeldoctor.compat import id_int, new_id
from System.Collections.Generic import List

from Autodesk.Revit.DB import (
    FilteredElementCollector, ElementId, BuiltInCategory, BuiltInParameter,
    LocationPoint, LocationCurve, Line, Arc, StorageType, FamilyInstance,
    ElementMulticategoryFilter
)

from modeldoctor.core import (
    BaseCheck, Issue, Severity, register, element_name, type_name,
    category_name, log, usable_categories, editable as core_editable
)
from modeldoctor import geom
from modeldoctor import context

# Categories swept by default.  Add to this list rather than the code below.
DEFAULT_CATEGORIES = [
    BuiltInCategory.OST_Walls,
    BuiltInCategory.OST_Floors,
    BuiltInCategory.OST_Ceilings,
    BuiltInCategory.OST_Roofs,
    BuiltInCategory.OST_Ramps,
    BuiltInCategory.OST_Stairs,
    BuiltInCategory.OST_StairsRailing,
    BuiltInCategory.OST_Doors,
    BuiltInCategory.OST_Windows,
    BuiltInCategory.OST_Columns,
    BuiltInCategory.OST_StructuralColumns,
    BuiltInCategory.OST_StructuralFraming,
    BuiltInCategory.OST_StructuralFoundation,
    BuiltInCategory.OST_GenericModel,
    BuiltInCategory.OST_Furniture,
    BuiltInCategory.OST_FurnitureSystems,
    BuiltInCategory.OST_Casework,
    BuiltInCategory.OST_PlumbingFixtures,
    BuiltInCategory.OST_SpecialityEquipment,
    BuiltInCategory.OST_MechanicalEquipment,
    BuiltInCategory.OST_ElectricalFixtures,
    BuiltInCategory.OST_ElectricalEquipment,
    BuiltInCategory.OST_LightingFixtures,
    BuiltInCategory.OST_CurtainWallPanels,
    BuiltInCategory.OST_CurtainWallMullions,
    BuiltInCategory.OST_DetailComponents,
    BuiltInCategory.OST_Lines,
    BuiltInCategory.OST_RoomSeparationLines,
    BuiltInCategory.OST_AreaSchemeLines,
    BuiltInCategory.OST_MEPSpaceSeparationLines,
    BuiltInCategory.OST_TextNotes,
    BuiltInCategory.OST_Dimensions,
    BuiltInCategory.OST_FilledRegion,
    BuiltInCategory.OST_Parking,
    BuiltInCategory.OST_Site,
]

# Instance parameters that genuinely change where/how big an element is.
GEOMETRY_PARAMS = [
    BuiltInParameter.WALL_BASE_CONSTRAINT,
    BuiltInParameter.WALL_BASE_OFFSET,
    BuiltInParameter.WALL_HEIGHT_TYPE,
    BuiltInParameter.WALL_TOP_OFFSET,
    BuiltInParameter.WALL_USER_HEIGHT_PARAM,
    BuiltInParameter.WALL_KEY_REF_PARAM,
    BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM,
    BuiltInParameter.INSTANCE_HEAD_HEIGHT_PARAM,
    BuiltInParameter.INSTANCE_FREE_HOST_OFFSET_PARAM,
    BuiltInParameter.INSTANCE_ELEVATION_PARAM,
    BuiltInParameter.FAMILY_LEVEL_PARAM,
    BuiltInParameter.FAMILY_BASE_LEVEL_PARAM,
    BuiltInParameter.FAMILY_TOP_LEVEL_PARAM,
    BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM,
    BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM,
    BuiltInParameter.STAIRS_BASE_LEVEL_PARAM,
    BuiltInParameter.STAIRS_TOP_LEVEL_PARAM,
    BuiltInParameter.HOST_AREA_COMPUTED,
    BuiltInParameter.HOST_VOLUME_COMPUTED,
    BuiltInParameter.HOST_PERIMETER_COMPUTED,
    BuiltInParameter.FLOOR_HEIGHTABOVELEVEL_PARAM,
    BuiltInParameter.CEILING_HEIGHTABOVELEVEL_PARAM,
]


@register
class DuplicateElementsCheck(BaseCheck):
    id = 'duplicates'
    title = 'Duplicate / coincident elements'
    group = 'Hygiene'
    description = ('Finds elements stacked on top of each other with the same '
                   'type, size and position. Equivalent to OVERKILL in AutoCAD.')
    can_fix = True
    fix_verb = 'Delete duplicates (keep lowest ID)'
    score_factor = 1.0

    options = {
        'tolerance_mm': ('Position tolerance', 1.0, 'mm'),
        'skip_grouped': ('Ignore elements inside groups', True, ''),
        'skip_pinned': ('Ignore pinned elements', True, ''),
        'include_annotation': ('Include text / lines / dimensions', True, ''),
        'compare_params': ('Compare geometry parameters', True, ''),
        'ignore_imported': ('Ignore CAD linked / imported geometry', True, ''),
        'import_style_markers': (
            'Line style name fragments that mark exploded CAD',
            'IMPORT,DWG,XREF', 'text'),
    }

    # ------------------------------------------------------------------
    def _collect(self):
        cats = list(DEFAULT_CATEGORIES)
        if not self.opt('include_annotation'):
            for c in (BuiltInCategory.OST_TextNotes, BuiltInCategory.OST_Lines,
                      BuiltInCategory.OST_RoomSeparationLines,
                      BuiltInCategory.OST_AreaSchemeLines,
                      BuiltInCategory.OST_MEPSpaceSeparationLines,
                      BuiltInCategory.OST_Dimensions,
                      BuiltInCategory.OST_DetailComponents,
                      BuiltInCategory.OST_FilledRegion):
                if c in cats:
                    cats.remove(c)
        cats = usable_categories(self.doc, cats)
        if not cats:
            return []
        ids = List[BuiltInCategory](cats)
        flt = ElementMulticategoryFilter(ids)
        return (FilteredElementCollector(self.doc)
                .WherePasses(flt)
                .WhereElementIsNotElementType()
                .ToElements())

    # ------------------------------------------------------------------
    def _signature(self, el, tol):
        cat = el.Category
        if cat is None:
            return None
        parts = ['C{0}'.format(id_int(cat.Id)),
                 'T{0}'.format(id_int(el.GetTypeId()))]

        # A copy in another design option, or another phase, is not a
        # duplicate: deleting it would delete that option's (or phase's)
        # element. Only the same option and the same phases compare.
        try:
            opt = el.DesignOption
            parts.append('O{0}'.format(id_int(opt.Id) if opt is not None else 0))
        except Exception:
            pass
        try:
            pc = el.get_Parameter(BuiltInParameter.PHASE_CREATED)
            pd = el.get_Parameter(BuiltInParameter.PHASE_DEMOLISHED)
            parts.append('P{0}-{1}'.format(id_int(pc.AsElementId()) if pc is not None else 0,
                                           id_int(pd.AsElementId()) if pd is not None else 0))
        except Exception:
            pass

        # View-specific annotation is only duplicated within its own view.
        try:
            if el.ViewSpecific:
                parts.append('V{0}'.format(id_int(el.OwnerViewId)))
        except Exception:
            pass

        loc = el.Location
        if isinstance(loc, LocationPoint):
            p = loc.Point
            rot = 0.0
            try:
                rot = round(loc.Rotation, 5)
            except Exception:
                pass
            parts.append('P{0},{1},{2},{3}'.format(
                geom.snap(p.X, tol), geom.snap(p.Y, tol),
                geom.snap(p.Z, tol), rot))
        elif isinstance(loc, LocationCurve):
            c = loc.Curve
            a, b = c.GetEndPoint(0), c.GetEndPoint(1)
            ka = (geom.snap(a.X, tol), geom.snap(a.Y, tol), geom.snap(a.Z, tol))
            kb = (geom.snap(b.X, tol), geom.snap(b.Y, tol), geom.snap(b.Z, tol))
            if kb < ka:
                ka, kb = kb, ka          # direction-agnostic
            mid = ''
            if isinstance(c, Arc):
                m = c.Evaluate(0.5, True)
                mid = '|{0},{1},{2}'.format(geom.snap(m.X, tol),
                                            geom.snap(m.Y, tol),
                                            geom.snap(m.Z, tol))
            parts.append('L{0}{1}{2}'.format(ka, kb, mid))
        else:
            # Sketch-based (floors, roofs) and anything else: bounding box.
            bb = el.get_BoundingBox(None)
            if bb is None:
                return None
            parts.append('B{0},{1},{2},{3},{4},{5}'.format(
                geom.snap(bb.Min.X, tol), geom.snap(bb.Min.Y, tol),
                geom.snap(bb.Min.Z, tol), geom.snap(bb.Max.X, tol),
                geom.snap(bb.Max.Y, tol), geom.snap(bb.Max.Z, tol)))

        if isinstance(el, FamilyInstance):
            try:
                parts.append('F{0}{1}'.format(int(el.FacingFlipped),
                                              int(el.HandFlipped)))
            except Exception:
                pass
            try:
                h = el.Host
                if h is not None:
                    parts.append('H{0}'.format(id_int(h.Id)))
            except Exception:
                pass

        if self.opt('compare_params'):
            for bip in GEOMETRY_PARAMS:
                try:
                    p = el.get_Parameter(bip)
                except Exception:
                    p = None
                if p is None:
                    continue
                st = p.StorageType
                if st == StorageType.Double:
                    parts.append('{0}:{1}'.format(int(bip),
                                                  geom.snap(p.AsDouble(), tol)))
                elif st == StorageType.Integer:
                    parts.append('{0}:{1}'.format(int(bip), p.AsInteger()))
                elif st == StorageType.ElementId:
                    parts.append('{0}:{1}'.format(int(bip),
                                                  id_int(p.AsElementId())))
                elif st == StorageType.String:
                    parts.append('{0}:{1}'.format(int(bip), p.AsString() or ''))

        return '#'.join(parts)

    # ------------------------------------------------------------------
    def run(self):
        tol = geom.mm(self.opt('tolerance_mm'))
        skip_grouped = self.opt('skip_grouped')
        skip_pinned = self.opt('skip_pinned')
        skip_import = self.opt('ignore_imported')
        markers = (context.parse_markers(self.opt('import_style_markers'))
                   if skip_import else [])

        buckets = {}
        count = 0
        for el in self._collect():
            try:
                if skip_grouped and el.GroupId != ElementId.InvalidElementId:
                    continue
                if skip_pinned and el.Pinned:
                    continue
            except Exception:
                continue
            if skip_import and context.is_import_derived(el, markers):
                continue
            sig = self._signature(el, tol)
            if sig is None:
                continue
            count += 1
            buckets.setdefault(sig, []).append(el)

        self.population = count

        for sig, els in buckets.items():
            if len(els) < 2:
                continue
            els.sort(key=lambda e: id_int(e.Id))
            keeper = els[0]
            victims = els[1:]
            self.issues.append(Issue(
                self.id,
                [id_int(e.Id) for e in els],
                '{0} copies stacked at one location - keep {1}, delete {2}'
                .format(len(els), id_int(keeper.Id),
                        ', '.join(str(id_int(e.Id)) for e in victims)),
                value_mm=None,
                severity=Severity.CRITICAL if len(els) > 2 else Severity.WARNING,
                primary_id=id_int(keeper.Id),
                category=category_name(keeper),
                type_name=type_name(self.doc, keeper),
                level=self._level_of(keeper),
                fixable=True,
                problem=('Stacked triplicate+' if len(els) > 2
                         else 'Stacked duplicate'),
                payload={'delete': [id_int(e.Id) for e in victims]},
            ))

    def _level_of(self, el):
        try:
            lid = el.LevelId
            if lid is not None and lid != ElementId.InvalidElementId:
                return element_name(self.doc.GetElement(lid))
        except Exception:
            pass
        return ''

    # ------------------------------------------------------------------
    def fix(self, issues):
        """Delete every non-keeper.  Deleting a host takes its hosted
        elements with it, so hosts are deleted last and the count reported
        is what Revit actually removed."""
        ids = []
        for iss in issues:
            for i in iss.payload.get('delete', []):
                ids.append(new_id(i))
        if not ids:
            return (0, 'Nothing to delete.')

        removed = set()
        for eid in ids:
            if id_int(eid) in removed:
                continue
            el = self.doc.GetElement(eid)
            if el is None:
                continue
            if not core_editable(self.doc, el):
                continue
            try:
                deleted = self.doc.Delete(eid)
                for d in deleted:
                    removed.add(id_int(d))
            except Exception:
                log('duplicate delete refused for {0}'.format(id_int(eid)))
        return (len(removed),
                'Deleted {0} element(s) including dependants.'.format(len(removed)))
