# -*- coding: utf-8 -*-
"""Shared helpers for the ARC Tools shared-parameter buttons.

Works in pyRevit (IronPython or CPython engine), Revit 2020 - 2026.
"""
import os
import shutil
import tempfile
from collections import OrderedDict

from Autodesk.Revit.DB import (
    BasicFileInfo,
    Category,
    ElementId,
    FailureProcessingResult,
    FailureSeverity,
    IFailuresPreprocessor,
    InstanceBinding,
    LabelUtils,
    ModelPathUtils,
    OpenOptions,
    RelinquishOptions,
    SharedParameterElement,
    SynchronizeWithCentralOptions,
    Transaction,
    TransactionGroup,
    TransactWithCentralOptions,
    WorksetConfiguration,
    WorksetConfigurationOption,
    WorksharingUtils,
)

try:  # Revit 2022+
    from Autodesk.Revit.DB import ForgeTypeId, GroupTypeId
    HAS_GROUP_TYPE_ID = True
except ImportError:  # Revit 2021 and older
    HAS_GROUP_TYPE_ID = False


# ---------------------------------------------------------------------------
# Small compatibility helpers
# ---------------------------------------------------------------------------
def id_value(element_id):
    """ElementId -> int (Revit 2024+ uses .Value, older uses .IntegerValue)."""
    try:
        return element_id.Value
    except AttributeError:
        return element_id.IntegerValue


def make_element_id(number):
    try:
        return ElementId(number)
    except Exception:
        import System
        return ElementId(System.Int64(number))


# (label shown to user, GroupTypeId member, BuiltInParameterGroup member)
GROUP_CHOICES = [
    ("Data", "Data", "PG_DATA"),
    ("Identity Data", "IdentityData", "PG_IDENTITY_DATA"),
    ("Dimensions", "Geometry", "PG_GEOMETRY"),
    ("Materials and Finishes", "Materials", "PG_MATERIALS"),
    ("Construction", "Construction", "PG_CONSTRUCTION"),
    ("Text", "Text", "PG_TEXT"),
    ("General", "General", "PG_GENERAL"),
    ("Other", None, "INVALID"),
]


def parameter_group(label):
    """Properties-palette group to put the parameter under."""
    for lbl, forge_name, bip_name in GROUP_CHOICES:
        if lbl == label:
            if HAS_GROUP_TYPE_ID:
                return getattr(GroupTypeId, forge_name) if forge_name else ForgeTypeId()
            from Autodesk.Revit.DB import BuiltInParameterGroup
            return getattr(BuiltInParameterGroup, bip_name)
    raise ValueError("Unknown parameter group: %s" % label)


def existing_group(definition):
    try:
        return definition.GetGroupTypeId()
    except AttributeError:
        return definition.ParameterGroup


def data_type_key(definition):
    """Comparable data-type key, e.g. 'autodesk.spec:spec.string' or 'Text'."""
    try:
        type_id = definition.GetDataType().TypeId or ""
        return type_id.split("-")[0]  # drop the version suffix (-2.0.0)
    except AttributeError:
        return str(definition.ParameterType)


def spec_label(definition):
    try:
        return LabelUtils.GetLabelForSpec(definition.GetDataType())
    except Exception:
        try:
            return str(definition.ParameterType)
        except Exception:
            return ""


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def read_shared_parameter_file(app, path):
    """Return OrderedDict {group name: [ExternalDefinition, ...]}.

    NOTE: this points app.SharedParametersFilename at `path`. The caller should
    restore the original value when finished (see scripts).
    """
    app.SharedParametersFilename = path
    def_file = app.OpenSharedParameterFile()
    if def_file is None:
        raise IOError("Could not open shared parameter file:\n%s" % path)
    groups = OrderedDict()
    for group in sorted(def_file.Groups, key=lambda g: g.Name):
        definitions = sorted(group.Definitions, key=lambda d: d.Name)
        if definitions:
            groups[group.Name] = definitions
    return groups


def bindable_categories(doc):
    """{category type name: [Category, ...]} for categories that accept parameters."""
    result = OrderedDict()
    cats = [c for c in doc.Settings.Categories if c.AllowsBoundParameters]
    for cat in sorted(cats, key=lambda c: (str(c.CategoryType), c.Name)):
        result.setdefault(str(cat.CategoryType), []).append(cat)
    return result


def project_parameters(doc):
    """{name: (InternalDefinition, Binding, shared GUID or None)}."""
    result = {}
    iterator = doc.ParameterBindings.ForwardIterator()
    iterator.Reset()
    while iterator.MoveNext():
        definition = iterator.Key
        element = doc.GetElement(definition.Id)
        guid = element.GuidValue if isinstance(element, SharedParameterElement) else None
        result[definition.Name] = (definition, iterator.Current, guid)
    return result


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------
class _WarningSwallower(IFailuresPreprocessor):
    """Dismiss warnings so batch runs are not stopped by popups."""

    def PreprocessFailures(self, accessor):
        for message in accessor.GetFailureMessages():
            if message.GetSeverity() == FailureSeverity.Warning:
                accessor.DeleteWarning(message)
        return FailureProcessingResult.Continue


def _transaction(doc, name):
    t = Transaction(doc, name)
    options = t.GetFailureHandlingOptions()
    options.SetFailuresPreprocessor(_WarningSwallower())
    t.SetFailureHandlingOptions(options)
    return t


def _new_binding(app, categories, is_instance):
    if is_instance:
        return app.Create.NewInstanceBinding(categories)
    return app.Create.NewTypeBinding(categories)


def set_vary_by_group(doc, definitions):
    """Turn on 'Values can vary by group instance'. Must be inside a transaction.

    `definitions` are InternalDefinitions. Returns [(name, result)].
    """
    log = []
    for definition in definitions:
        if definition.VariesAcrossGroups:
            log.append((definition.Name, "already varies by group instance"))
            continue
        try:
            definition.SetAllowVaryBetweenGroups(doc, True)
            log.append((definition.Name, "now varies by group instance"))
        except Exception as ex:
            log.append((definition.Name, "could NOT set vary by group: %s" % ex))
    return log


def apply_shared_parameters(doc, app, definitions, category_ids, is_instance,
                            group, vary_by_group):
    """Bind shared parameters as project parameters. Returns [(name, result)].

    - New parameters are added with the chosen categories / group.
    - Parameters already in the file keep their group; the chosen categories
      are ADDED to their existing categories (nothing is removed).
    - If vary_by_group, instance parameters get
      'Values can vary by group instance' turned on, so they can be edited
      on members of model groups without editing the group.
    """
    log = []
    categories = app.Create.NewCategorySet()
    for cid in category_ids:
        cat = Category.GetCategory(doc, make_element_id(cid))
        if cat is not None and cat.AllowsBoundParameters:
            categories.Insert(cat)
    if categories.IsEmpty:
        return [("-", "None of the chosen categories exist in this file - skipped")]

    existing = project_parameters(doc)
    to_vary = []

    tgroup = TransactionGroup(doc, "ARC: Add shared parameters")
    tgroup.Start()
    current_t = None
    try:
        current_t = _transaction(doc, "Bind shared parameters")
        current_t.Start()
        for definition in definitions:
            name = definition.Name
            found = existing.get(name)

            # Same GUID already in the model (project parameter or inside a
            # loaded family) but with a different data type -> Revit conflict.
            spe = SharedParameterElement.Lookup(doc, definition.GUID)
            if spe is not None and data_type_key(spe.GetDefinition()) != data_type_key(definition):
                log.append((name, "SKIPPED - TYPE CONFLICT: this GUID is already in the "
                                  "model as '%s', the shared parameter file says '%s'. "
                                  "Run 'Check Conflicts'."
                            % (spec_label(spe.GetDefinition()), spec_label(definition))))
                continue

            if found is not None and found[2] != definition.GUID:
                log.append((name, "SKIPPED - a different parameter with this name "
                                  "already exists in the file"))
                continue

            if found is None:
                binding = _new_binding(app, categories, is_instance)
                if doc.ParameterBindings.Insert(definition, binding, group):
                    log.append((name, "added"))
                    to_vary.append(definition)
                else:
                    log.append((name, "FAILED to add"))
                continue

            internal_def, old_binding, _ = found
            old_is_instance = isinstance(old_binding, InstanceBinding)
            if old_is_instance != is_instance:
                log.append((name, "SKIPPED - already in the file as a %s parameter"
                            % ("instance" if old_is_instance else "type")))
                continue

            merged = app.Create.NewCategorySet()
            for cat in old_binding.Categories:
                merged.Insert(cat)
            added = 0
            for cat in categories:
                if merged.Insert(cat):
                    added += 1
            if added:
                doc.ParameterBindings.ReInsert(
                    internal_def, _new_binding(app, merged, is_instance),
                    existing_group(internal_def))
                log.append((name, "already in file - added %d categor%s"
                            % (added, "y" if added == 1 else "ies")))
            else:
                log.append((name, "already in file with these categories"))
            to_vary.append(definition)
        current_t.Commit()

        if is_instance and vary_by_group and to_vary:
            current_t = _transaction(doc, "Allow values to vary by group instance")
            current_t.Start()
            internal_defs = []
            for definition in to_vary:
                spe = SharedParameterElement.Lookup(doc, definition.GUID)
                if spe is not None:
                    internal_defs.append(spe.GetDefinition())
            log.extend(set_vary_by_group(doc, internal_defs))
            current_t.Commit()

        tgroup.Assimilate()
    except Exception:
        if current_t is not None and current_t.HasStarted() and not current_t.HasEnded():
            current_t.RollBack()
        if tgroup.HasStarted() and not tgroup.HasEnded():
            tgroup.RollBack()
        raise
    return log


# ---------------------------------------------------------------------------
# Batch file handling
# ---------------------------------------------------------------------------
def _model_path(path):
    return ModelPathUtils.ConvertUserVisiblePathToModelPath(path)


def process_file(app, path, settings):
    """Open a .rvt, add the parameters, save / sync, close. Returns log list."""
    info = BasicFileInfo.Extract(path)
    local_path = None

    if info.IsWorkshared:
        central = info.CentralPath or path
        if not os.path.exists(central):
            return [("-", "SKIPPED - central model not reachable (cloud model or "
                          "missing path): %s" % central)]
        tmp_dir = os.path.join(tempfile.gettempdir(), "ARC_SharedParams")
        if not os.path.isdir(tmp_dir):
            os.makedirs(tmp_dir)
        local_path = os.path.join(
            tmp_dir, os.path.splitext(os.path.basename(central))[0] + "_ARC_local.rvt")
        _remove_local(local_path)
        WorksharingUtils.CreateNewLocal(_model_path(central), _model_path(local_path))
        options = OpenOptions()
        options.SetOpenWorksetsConfiguration(
            WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets))
        doc = app.OpenDocumentFile(_model_path(local_path), options)
    else:
        doc = app.OpenDocumentFile(path)

    try:
        log = apply_shared_parameters(
            doc, app, settings["definitions"], settings["category_ids"],
            settings["is_instance"], settings["group"], settings["vary_by_group"])
        if doc.IsWorkshared:
            sync = SynchronizeWithCentralOptions()
            sync.SetRelinquishOptions(RelinquishOptions(True))
            sync.Comment = "ARC Tools: added shared parameters"
            doc.SynchronizeWithCentral(TransactWithCentralOptions(), sync)
            log.append(("-", "synchronized with central"))
        else:
            doc.Save()
            log.append(("-", "saved"))
    finally:
        doc.Close(False)
        if local_path:
            _remove_local(local_path)
    return log


def _remove_local(local_path):
    if os.path.exists(local_path):
        try:
            os.remove(local_path)
        except OSError:
            pass
    backup = os.path.splitext(local_path)[0] + "_backup"
    shutil.rmtree(backup, ignore_errors=True)


# ---------------------------------------------------------------------------
# Conflict checking
# ---------------------------------------------------------------------------
def families_with_parameter(doc, guid):
    """Names of loadable families in `doc` that themselves contain the shared
    parameter `guid` (opens candidate families in the background)."""
    from Autodesk.Revit.DB import FamilyInstance, FamilySymbol, FilteredElementCollector

    candidates, checked = {}, set()

    def consider(family, element):
        fid = id_value(family.Id)
        if fid in checked:
            return
        if element.get_Parameter(guid) is not None:
            checked.add(fid)
            candidates[fid] = family

    for sym in FilteredElementCollector(doc).OfClass(FamilySymbol):
        consider(sym.Family, sym)
    for inst in FilteredElementCollector(doc).OfClass(FamilyInstance):
        consider(inst.Symbol.Family, inst)

    names = []
    for family in candidates.values():
        if family.IsInPlace:
            names.append(family.Name + " (in-place)")
            continue
        try:
            fam_doc = doc.EditFamily(family)
        except Exception:
            names.append(family.Name + " (could not open to check)")
            continue
        try:
            if fam_doc.FamilyManager.get_Parameter(guid) is not None:
                names.append(family.Name)
        finally:
            fam_doc.Close(False)
    return sorted(names)


def find_conflicts(doc, sp_groups, check_families=True):
    """Compare the model with the shared parameter file.

    Returns a list of dicts:
      kind      'TYPE' (same GUID, different data type) or
                'NAME' (same name, different GUID)
      name, guid, model_type, file_type, project_param (bool), families
    """
    by_guid = {}
    by_name = {}
    for definitions in sp_groups.values():
        for d in definitions:
            by_guid[str(d.GUID)] = d
            by_name.setdefault(d.Name, []).append(d)

    bound = project_parameters(doc)
    bound_guids = set(str(g) for (_, _, g) in bound.values() if g is not None)

    from Autodesk.Revit.DB import FilteredElementCollector
    conflicts = []
    for spe in FilteredElementCollector(doc).OfClass(SharedParameterElement):
        model_def = spe.GetDefinition()
        guid = str(spe.GuidValue)
        file_def = by_guid.get(guid)

        if file_def is not None:
            if data_type_key(model_def) == data_type_key(file_def):
                continue
            kind = "TYPE"
        else:
            same_name = by_name.get(model_def.Name)
            if not same_name:
                continue  # parameter not in this shared parameter file at all
            file_def = same_name[0]
            kind = "NAME"

        conflicts.append({
            "kind": kind,
            "name": model_def.Name,
            "guid": guid,
            "file_guid": str(file_def.GUID),
            "model_type": spec_label(model_def),
            "file_type": spec_label(file_def),
            "project_param": guid in bound_guids,
            "families": families_with_parameter(doc, spe.GuidValue) if check_families else [],
        })
    return sorted(conflicts, key=lambda c: c["name"])


def open_read_only(app, path):
    """Open a model in the background without touching central. Close with Close(False)."""
    from Autodesk.Revit.DB import DetachFromCentralOption
    options = OpenOptions()
    if BasicFileInfo.Extract(path).IsWorkshared:
        options.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets
    options.SetOpenWorksetsConfiguration(
        WorksetConfiguration(WorksetConfigurationOption.CloseAllWorksets))
    return app.OpenDocumentFile(_model_path(path), options)
