# -*- coding: utf-8 -*-
"""Model Doctor core: issue model, check contract, registry, event plumbing."""
import os
import json
import traceback
from datetime import datetime

from modeldoctor.compat import id_int, new_id
from Autodesk.Revit.DB import (
    Transaction, ElementId, BuiltInParameter, FailureHandlingOptions
)
from Autodesk.Revit.UI import IExternalEventHandler, ExternalEvent

APP_DIR = os.path.join(os.getenv('APPDATA') or os.path.expanduser('~'),
                       'LWK', 'ModelDoctor')
SETTINGS_PATH = os.path.join(APP_DIR, 'settings.json')
LOG_PATH = os.path.join(APP_DIR, 'modeldoctor.log')


def log(msg):
    try:
        if not os.path.isdir(APP_DIR):
            os.makedirs(APP_DIR)
        with open(LOG_PATH, 'a') as fh:
            fh.write('[{0}] {1}\n'.format(
                datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg))
    except Exception:
        pass


def usable_categories(doc, cats):
    """Drop categories this document cannot filter on.

    Not every BuiltInCategory is valid for ElementMulticategoryFilter, and an
    invalid one makes the whole filter throw rather than being ignored -- so
    one bad entry silently kills an entire check. Each is tested on its own
    and the failures are logged by name.
    """
    from Autodesk.Revit.DB import (FilteredElementCollector,
                                   ElementCategoryFilter)
    ok = []
    for bic in cats:
        try:
            flt = ElementCategoryFilter(bic)
            (FilteredElementCollector(doc)
             .WherePasses(flt)
             .WhereElementIsNotElementType()
             .FirstElement())
            ok.append(bic)
        except Exception:
            log('category not usable for filtering, skipped: {0}'.format(bic))
    return ok


def probe(msg):
    """Write a breadcrumb and flush it immediately.

    A fatal Revit error kills the process outright: nothing in Python runs
    afterwards and no traceback survives. The only way to find out where it
    died is to have already written it to disk, flushed, before the call that
    kills it.
    """
    try:
        if not os.path.isdir(APP_DIR):
            os.makedirs(APP_DIR)
        with open(os.path.join(APP_DIR, 'probe.log'), 'a') as fh:
            fh.write('[{0}] {1}\n'.format(
                datetime.now().strftime('%H:%M:%S.%f')[:-3], msg))
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except Exception:
                pass
    except Exception:
        pass


def probe_reset(header):
    try:
        if not os.path.isdir(APP_DIR):
            os.makedirs(APP_DIR)
        with open(os.path.join(APP_DIR, 'probe.log'), 'w') as fh:
            fh.write('=== {0} :: {1} ===\n'.format(
                datetime.now().strftime('%Y-%m-%d %H:%M:%S'), header))
    except Exception:
        pass


def element_name(el):
    """IronPython 2.7 chokes on Element.Name for some ElementType subclasses."""
    try:
        return el.Name
    except Exception:
        pass
    try:
        from Autodesk.Revit.DB import Element
        return Element.Name.__get__(el)
    except Exception:
        return '<unnamed>'


def type_name(doc, el):
    try:
        t = doc.GetElement(el.GetTypeId())
        if t is not None:
            return element_name(t)
    except Exception:
        pass
    return ''


def category_name(el):
    try:
        if el.Category is not None:
            return el.Category.Name
    except Exception:
        pass
    return ''


# ---------------------------------------------------------------------------
# Severity
# ---------------------------------------------------------------------------

class Severity(object):
    CRITICAL = 3
    WARNING = 2
    INFO = 1

    NAMES = {3: 'Critical', 2: 'Warning', 1: 'Info'}

    @staticmethod
    def name(v):
        return Severity.NAMES.get(v, 'Info')


# ---------------------------------------------------------------------------
# Issue
# ---------------------------------------------------------------------------

class Issue(object):
    """One finding.  `element_ids` is the full set the user can select/copy;
    `primary_id` is what the auto-fix would act on.
    """

    def __init__(self, check_id, element_ids, description,
                 value_mm=None, severity=Severity.WARNING,
                 primary_id=None, category='', type_name='',
                 level='', fixable=False, payload=None, problem='',
                 fix_blocked='', scoreless=False):
        self.check_id = check_id
        self.element_ids = [int(i) for i in element_ids]
        self.primary_id = int(primary_id) if primary_id is not None \
            else (self.element_ids[0] if self.element_ids else 0)
        self.description = description
        self.value_mm = value_mm
        self.severity = severity
        self.category = category
        self.type_name = type_name
        self.level = level
        self.fixable = fixable
        # When fixable is False, why. Surfaced in the status bar so a dead
        # Fix button explains itself instead of just doing nothing.
        self.fix_blocked = fix_blocked
        # Notices about the run itself (no floors found, etc.) are not model
        # errors and must not drag the score down.
        self.scoreless = scoreless
        # Set by AcceptedStore after construction.
        self.accepted = False
        # Short classification of *what kind* of error this is, shown as its
        # own column so findings can be sorted and triaged by failure mode.
        self.problem = problem
        # Anything the fixer needs that would be expensive to recompute.
        self.payload = payload or {}

    # -- WPF-bound display properties -------------------------------------
    @property
    def IdText(self):
        return ', '.join(str(i) for i in self.element_ids)

    @property
    def SeverityText(self):
        return Severity.name(self.severity)

    @property
    def ValueText(self):
        if self.value_mm is None:
            return ''
        return '{0:+.1f}'.format(self.value_mm)

    @property
    def Description(self):
        return self.description

    @property
    def Problem(self):
        return self.problem

    # -- acceptance -------------------------------------------------------
    @property
    def signature(self):
        """Stable identity across runs.

        Element ids plus the problem type, deliberately excluding the measured
        value: a gap that drifts from 2.9 mm to 3.1 mm is the same finding and
        should stay accepted.
        """
        ids = ','.join(str(i) for i in sorted(self.element_ids))
        return '{0}|{1}|{2}'.format(self.check_id, self.problem, ids)

    @property
    def Accepted(self):
        return self.accepted

    @Accepted.setter
    def Accepted(self, value):
        self.accepted = bool(value)

    @property
    def Category(self):
        return self.category

    @property
    def TypeName(self):
        return self.type_name

    @property
    def LevelName(self):
        return self.level

    @property
    def Fixable(self):
        return self.fixable

    def csv_row(self):
        return [self.check_id, Severity.name(self.severity), self.problem,
                'accepted' if self.accepted else 'open',
                self.category, self.type_name, self.level, self.IdText,
                self.description, self.ValueText]


# ---------------------------------------------------------------------------
# Check contract
# ---------------------------------------------------------------------------

class BaseCheck(object):
    """Subclass, set the class attributes, implement run().

    Implement fix() only if the check can rectify; otherwise leave
    can_fix False and the UI hides the button.
    """
    id = 'base'
    title = 'Base check'
    description = ''
    group = 'General'
    can_fix = False
    fix_verb = 'Fix'
    # Relative share of the 100-point total. Equal factors mean every check
    # is worth the same; raise one to make its findings matter more.
    score_factor = 1.0
    # Editable settings: key -> (label, default, unit)
    options = {}

    def __init__(self, doc, settings):
        self.doc = doc
        self.settings = settings
        self.issues = []
        self.population = 0      # denominator for the health score
        self.error = None
        self.elapsed = 0.0

    def opt(self, key):
        return self.settings.get(self.id, {}).get(key,
                                                  self.options[key][1])

    # ------------------------------------------------------------------
    def run(self):
        """Populate self.issues and self.population.  No transaction."""
        raise NotImplementedError

    def fix(self, issues):
        """Rectify the given issues.  Runs inside a transaction supplied by
        the caller.  Return (fixed_count, message)."""
        raise NotImplementedError

    # ------------------------------------------------------------------
    def execute(self):
        import time
        t0 = time.time()
        self.issues = []
        self.error = None
        try:
            self.run()
        except Exception:
            self.error = traceback.format_exc()
            log('CHECK FAILED {0}\n{1}'.format(self.id, self.error))
        self.elapsed = time.time() - t0
        return self.issues


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY = []


def register(cls):
    _REGISTRY.append(cls)
    return cls


def all_checks():
    return list(_REGISTRY)


def load_all():
    """Import the check modules so their decorators fire."""
    from modeldoctor.checks import duplicates          # noqa: F401
    from modeldoctor.checks import curve_overlaps      # noqa: F401
    from modeldoctor.checks import wall_junctions      # noqa: F401
    from modeldoctor.checks import column_relations    # noqa: F401
    from modeldoctor.checks import link_relations      # noqa: F401
    from modeldoctor.checks import floor_relations     # noqa: F401
    return all_checks()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def default_settings():
    data = {'_enabled': {}}
    for cls in all_checks():
        data[cls.id] = dict((k, v[1]) for k, v in cls.options.items())
        data['_enabled'][cls.id] = True
    return data


def load_settings():
    data = default_settings()
    try:
        if os.path.isfile(SETTINGS_PATH):
            with open(SETTINGS_PATH, 'r') as fh:
                saved = json.load(fh)
            for k, v in saved.items():
                if isinstance(v, dict) and k in data:
                    data[k].update(v)
                else:
                    data[k] = v
    except Exception:
        log('settings load failed:\n' + traceback.format_exc())
    return data


def save_settings(data):
    try:
        if not os.path.isdir(APP_DIR):
            os.makedirs(APP_DIR)
        with open(SETTINGS_PATH, 'w') as fh:
            json.dump(data, fh, indent=2)
    except Exception:
        log('settings save failed:\n' + traceback.format_exc())


# ---------------------------------------------------------------------------
# ExternalEvent plumbing
# ---------------------------------------------------------------------------

class ActionHandler(IExternalEventHandler):
    """Single queued handler.  The window pushes callables; Revit drains them
    on a valid API context."""

    def __init__(self):
        self.queue = []

    def Execute(self, uiapp):
        while self.queue:
            fn = self.queue.pop(0)
            try:
                fn(uiapp)
            except Exception:
                log('action failed:\n' + traceback.format_exc())

    def GetName(self):
        return 'LWK Model Doctor Action'


class Dispatcher(object):
    def __init__(self):
        self.handler = ActionHandler()
        self.event = ExternalEvent.Create(self.handler)

    def post(self, fn):
        self.handler.queue.append(fn)
        self.event.Raise()


def model_key(doc):
    """One name for a model whoever has it open: the central model's path
    for a workshared model (a local copy is titled "Model_wilson", so the
    title differs per person), else the file path, else the title."""
    try:
        if doc.IsWorkshared:
            from Autodesk.Revit.DB import ModelPathUtils
            p = ModelPathUtils.ConvertModelPathToUserVisiblePath(doc.GetWorksharingCentralModelPath())
            if p:
                return p
    except Exception:
        pass
    try:
        if doc.PathName:
            return doc.PathName
    except Exception:
        pass
    try:
        return doc.Title or 'model'
    except Exception:
        return 'model'


def _link_docs(doc):
    out = []
    try:
        from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
        for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
            ld = inst.GetLinkDocument()
            if ld is not None:
                out.append(ld)
    except Exception:
        pass
    return out


def uid_signature(doc, iss, _links=None):
    """The finding's signature by the elements' UniqueIds - the one the
    viewer makes too (shared.signature). An id not in this model is looked
    for in the loaded links (link checks list the linked element)."""
    sig = getattr(iss, '_uidsig', None)
    if sig is not None:
        return sig
    from modeldoctor import shared
    uids = []
    for i in iss.element_ids:
        u = None
        try:
            el = doc.GetElement(new_id(i))
            if el is not None:
                u = el.UniqueId
        except Exception:
            u = None
        if u is None:
            if _links is None:
                _links = _link_docs(doc)
            for ld in _links:
                try:
                    el = ld.GetElement(new_id(i))
                    if el is not None:
                        u = el.UniqueId
                        break
                except Exception:
                    pass
        uids.append(u or str(i))
    iss.uids = uids
    iss._uidsig = shared.signature(iss.check_id, iss.problem, uids)
    return iss._uidsig


class AcceptedStore(object):
    """The findings reviewed and waved through ("Not an error").

    For the whole project when the viewer is reachable: one viewer item per
    finding (placement "doctoraccept"), the same list the viewer's Model
    Doctor shows and writes. A copy is kept on this computer, by the central
    model's path, so it also works offline; the old per-title file (and its
    ElementId signatures) is still read.
    """

    def __init__(self, doc, link=None):
        self.doc = doc
        self.link = link
        self.signatures = set()
        self.key = model_key(doc)
        self.path = self._path_for(self.key)
        self.legacy = self._path_for(getattr(doc, 'Title', '') or 'model')
        self.removed = set()
        self._pending_add = {}            # signature -> finding, accepted here
        self.load()

    @staticmethod
    def _path_for(name):
        safe = ''.join(c if (c.isalnum() or c in '-_') else '_'
                       for c in (name or 'model'))[-80:]
        return os.path.join(APP_DIR, 'accepted', safe + '.json')

    def load(self):
        self.signatures = set()
        for p in (self.path, self.legacy):
            try:
                if os.path.isfile(p):
                    with open(p, 'r') as fh:
                        data = json.load(fh)
                    for sig in data.get('accepted', []):
                        self.signatures.add(sig)
            except Exception:
                log('accepted load failed:\n' + traceback.format_exc())
        if self.link is not None and self.link.ok:
            self.signatures.update(self.link.accepted().keys())

    def save(self):
        try:
            folder = os.path.dirname(self.path)
            if not os.path.isdir(folder):
                os.makedirs(folder)
            with open(self.path, 'w') as fh:
                json.dump({'model': self.key,
                           'updated': datetime.now().strftime(
                               '%Y-%m-%d %H:%M:%S'),
                           'accepted': sorted(self.signatures)}, fh, indent=1)
        except Exception:
            log('accepted save failed:\n' + traceback.format_exc())
        self.push()

    def push(self):
        """Accepted / reopened here -> the viewer, for everyone."""
        if self.link is None or not self.link.ok:
            self._pending_add = {}
            self.removed.clear()
            return
        from modeldoctor import shared
        on_server = self.link.accepted()
        for sig, iss in list(self._pending_add.items()):
            if sig not in on_server:
                self.link.put(shared.accept_item(sig, iss.check_id, iss.problem, getattr(iss, 'uids', []),
                                                 iss.description, self._me()))
        for sig in list(self.removed):
            it = on_server.get(sig)
            if it is not None:
                self.link.delete(it.get('id'))
        self._pending_add = {}
        self.removed.clear()

    def _me(self):
        try:
            return (self.link and self.link.me) or self.doc.Application.Username
        except Exception:
            return ''

    def _sigs(self, iss):
        return (uid_signature(self.doc, iss), iss.signature)

    def apply(self, issues):
        """Restore acceptance onto a freshly produced result set."""
        for iss in issues:
            new, old = self._sigs(iss)
            iss.accepted = new in self.signatures or old in self.signatures

    def harvest(self, issues):
        """Pull current checkbox states back into the store."""
        for iss in issues:
            new, old = self._sigs(iss)
            was = new in self.signatures or old in self.signatures
            if iss.accepted:
                self.signatures.add(new)
                self.removed.discard(new)
                if not was:
                    self._pending_add[new] = iss
            else:
                self.signatures.discard(new)
                self.signatures.discard(old)
                self._pending_add.pop(new, None)
                if was:
                    self.removed.add(new)


def editable(doc, el):
    """False when worksharing would refuse the edit.

    Borrowing happens automatically for unowned elements, so only genuine
    ownership by another user blocks us.
    """
    try:
        if not doc.IsWorkshared:
            return True
    except Exception:
        return True
    try:
        from Autodesk.Revit.DB import WorksharingUtils, CheckoutStatus
        status = WorksharingUtils.GetCheckoutStatus(doc, el.Id)
        return status != CheckoutStatus.OwnedByOtherUser
    except Exception:
        return True


def transact(doc, name, fn):
    """Run fn(doc) inside a transaction with warnings suppressed to the
    Revit default resolver, so batch fixes do not stall on dialogs."""
    t = Transaction(doc, name)
    t.Start()
    try:
        opts = t.GetFailureHandlingOptions()
        opts.SetClearAfterRollback(True)
        opts.SetForcedModalHandling(False)
        t.SetFailureHandlingOptions(opts)
        result = fn(doc)
        t.Commit()
        return result
    except Exception:
        if t.HasStarted():
            t.RollBack()
        raise


def in_sub(doc, fn):
    """fn() inside a SubTransaction: a check whose fix fails half way rolls
    back its own edits, and the other checks' fixes are kept."""
    from Autodesk.Revit.DB import SubTransaction
    st = SubTransaction(doc)
    st.Start()
    try:
        result = fn()
        st.Commit()
        return result
    except Exception:
        try:
            if st.HasStarted() and not st.HasEnded():
                st.RollBack()
        except Exception:
            pass
        raise
