# -*- coding: utf-8 -*-
"""LWK Model Doctor -- daily model QA and rectification.

Modeless WPF window. Requires a persistent engine so the ExternalEvent and
the window survive between button presses.

Every call into the Revit API runs from the ExternalEvent (core.Dispatcher):
the checks one by one, the fixes, selecting and zooming. A modeless window's
own click handlers are outside Revit's API context, and reading the model
from there is what used to end in "an unrecoverable error has occurred".

With the LWK Viewer (signed in through LWK Issues): "Not an error" is shared
with the whole project, and the viewer's "Fix in Revit" queue is listed here
(Fix queue) and answered fixed, or why not.
"""
__title__ = 'Model\nDoctor'
__author__ = 'LWK BIM'
__doc__ = 'Daily model health checks with one-click rectification.'
__persistentengine__ = True

import os
import sys
import traceback

import clr
clr.AddReference('System.Windows.Forms')
clr.AddReference('PresentationCore')
clr.AddReference('PresentationFramework')

from System.Collections.ObjectModel import ObservableCollection
from System.Windows.Media import SolidColorBrush, ColorConverter
from System.Windows.Controls import (
    TextBlock, TextBox, CheckBox, ComboBox, ComboBoxItem
)
from System.Windows import Thickness, TextWrapping
from System.Windows.Forms import Clipboard, SaveFileDialog, DialogResult

from Autodesk.Revit.DB import ElementId

from System.Collections.Generic import List

from pyrevit import revit, forms, script


# ---------------------------------------------------------------------------
# Locate the modeldoctor package.
#
# pyRevit only auto-registers <name>.extension/lib.  This walks up to whatever
# .extension root the button happens to live in, and also accepts a lib folder
# sitting directly beside the button, so the tool can be dropped into an
# existing extension or shipped self-contained without editing paths.
# ---------------------------------------------------------------------------

def _bootstrap_lib():
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []

    probe = here
    for _ in range(8):
        if probe.lower().endswith('.extension'):
            candidates.append(os.path.join(probe, 'lib'))
            break
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent

    candidates.append(os.path.join(here, 'lib'))

    for cand in candidates:
        if os.path.isdir(os.path.join(cand, 'modeldoctor')):
            if cand not in sys.path:
                sys.path.append(cand)
            return cand
    return None


_LIB_PATH = _bootstrap_lib()
# always this extension's own modeldoctor, freshly loaded (the engine is
# persistent: an updated package would otherwise need pyRevit > Reload)
for _m in [k for k in list(sys.modules) if k == 'modeldoctor' or k.startswith('modeldoctor.')]:
    del sys.modules[_m]
if _LIB_PATH is None:
    forms.alert(
        'The "modeldoctor" package could not be found.\n\n'
        'Copy the modeldoctor folder into either:\n'
        '  <your>.extension\\lib\\modeldoctor\n'
        'or\n'
        '  {0}\\lib\\modeldoctor\n\n'
        'Then use pyRevit > Reload (a plain re-click will not clear the '
        'cached engine).'.format(os.path.dirname(os.path.abspath(__file__))),
        title='Model Doctor', exitscript=True)

from modeldoctor import core, health, shared
from modeldoctor.core import Severity
from modeldoctor.checks import floor_relations
from modeldoctor.viewer import ViewerLink

logger = script.get_logger()


def brush(hex_colour):
    return SolidColorBrush(ColorConverter.ConvertFromString(hex_colour))


def guarded(fn):
    """Never let an exception escape a WPF event handler.

    An unhandled exception raised inside a handler does not surface as a
    Python traceback -- it propagates into Revit's message loop and takes the
    whole application down with "an unrecoverable error has occurred". A
    single mistyped dictionary key is enough. Every handler below is wrapped
    so the worst case is a message in the status bar.
    """
    def wrapper(self, sender, args):
        try:
            return fn(self, sender, args)
        except Exception:
            tb = traceback.format_exc()
            core.log('handler {0} failed:\n{1}'.format(fn.__name__, tb))
            core.probe('HANDLER EXCEPTION {0}\n{1}'.format(fn.__name__, tb))
            try:
                self.status_text.Text = (
                    'Error in {0} - the tool kept running. See '
                    'modeldoctor.log for details.'.format(fn.__name__))
            except Exception:
                pass
    wrapper.__name__ = fn.__name__
    return wrapper


BADGE_CLEAN = '#2E9E5B'
BADGE_ISSUES = '#C4382E'
BADGE_IDLE = '#9AA5B1'


class CheckRow(object):
    """View-model wrapper around a BaseCheck instance."""

    def __init__(self, check, enabled=True):
        self.check = check
        self._enabled = enabled
        self.count = None
        self.notices = 0
        self.status = ''

    def refresh_count(self):
        """Badge shows real findings only.

        A 'no columns in this model' notice is information about the run, not
        a defect, and must not light the badge up as though the model had a
        column problem."""
        real = [i for i in self.check.issues
                if not i.scoreless and not i.accepted]
        self.notices = len([i for i in self.check.issues if i.scoreless])
        self.count = len(real)

    @property
    def Enabled(self):
        return self._enabled

    @Enabled.setter
    def Enabled(self, value):
        self._enabled = bool(value)

    @property
    def Title(self):
        return self.check.title

    @property
    def Description(self):
        return self.check.description

    @property
    def CountText(self):
        if self.count is None:
            return '-'
        if self.count == 0 and self.notices:
            return 'n/a'
        return str(self.count)

    @property
    def BadgeBrush(self):
        if self.count is None:
            return brush(BADGE_IDLE)
        if self.count == 0 and self.notices:
            return brush(BADGE_IDLE)
        return brush(BADGE_CLEAN if self.count == 0 else BADGE_ISSUES)

    @property
    def StatusText(self):
        return self.status


class ModelDoctorWindow(forms.WPFWindow):

    def __init__(self, xaml):
        # pyRevit binds Escape to close by default. This window holds a full
        # result set that is expensive to rebuild, so Escape closing it by
        # accident loses real work -- only the X button should close it.
        try:
            forms.WPFWindow.__init__(self, xaml, handle_esc=False)
        except TypeError:
            forms.WPFWindow.__init__(self, xaml)
        self.uidoc = revit.uidoc
        self.doc = revit.doc
        self.dispatcher = core.Dispatcher()

        core.load_all()
        self.settings = core.load_settings()

        self.rows = ObservableCollection[object]()
        enabled_map = self.settings.get('_enabled', {})
        for cls in core.all_checks():
            chk = cls(self.doc, self.settings)
            self.rows.Add(CheckRow(chk, enabled_map.get(cls.id, True)))
        self.check_list.ItemsSource = self.rows

        self.all_issues = []
        self.current_rows = []
        # the LWK Viewer: "Not an error" for the whole project, the fix queue
        self.link = ViewerLink(self._title())
        if self.link.ok and not self.link.refresh():
            core.log('viewer: ' + self.link.why)
        self.accepted = core.AcceptedStore(self.doc, self.link)
        self._suspend_filters = False
        self._run_queue = []
        self._queue_wait = {}          # signature -> viewer queue item, being fixed
        self.report = None

        # wiring
        self.btn_run.Click += self.on_run
        self.btn_export.Click += self.on_export
        self.btn_all.Click += self.on_select_all
        self.btn_none.Click += self.on_select_none
        self.btn_copy.Click += self.on_copy
        self.btn_select.Click += self.on_select_in_model
        self.btn_zoom.Click += self.on_zoom
        self.btn_accept.Click += self.on_accept_selected
        self.btn_reopen.Click += self.on_reopen_selected
        self.btn_fix.Click += self.on_fix_selected
        self.btn_fix_all.Click += self.on_fix_all
        self.btn_queue.Click += self.on_queue
        self.check_list.SelectionChanged += self.on_check_selected
        self.severity_filter.SelectionChanged += self.on_filter_changed
        self.check_filter.SelectionChanged += self.on_filter_changed
        self.problem_filter.SelectionChanged += self.on_filter_changed
        self.accepted_filter.SelectionChanged += self.on_filter_changed
        self.results_grid.SelectionChanged += self.on_row_selected
        self.results_grid.MouseDoubleClick += self.on_row_double_click
        # Belt and braces: swallow Escape during the tunnelling phase, before
        # any handler bound further down the tree can act on it.
        self.PreviewKeyDown += self.on_preview_key
        # Last line of defence. Anything that still escapes is marked handled
        # here rather than reaching Revit's message loop.
        try:
            self.Dispatcher.UnhandledException += self.on_unhandled
        except Exception:
            pass
        # The tick box lives inside a cell template, so its click is handled
        # before it reaches the grid. handledEventsToo=True lets us see it
        # anyway and persist the change immediately.
        from System.Windows import UIElement
        from System.Windows.Input import MouseButtonEventHandler
        self.results_grid.AddHandler(
            UIElement.MouseLeftButtonUpEvent,
            MouseButtonEventHandler(self.on_grid_click), True)
        self.Closed += self.on_closed

        try:
            self.model_name.Text = os.path.basename(self.doc.Title)
        except Exception:
            self.model_name.Text = 'Model Doctor'
        from modeldoctor import __version__
        self.version_text.Text = 'LWK Model Doctor v{0}'.format(__version__)

        if self.rows.Count:
            self.check_list.SelectedIndex = 0
        self._paint_queue()
        if not self.link.ok:
            self.set_status('Ready. LWK Viewer: ' + self.link.why
                            + ' - "Not an error" stays on this computer.')

    # ------------------------------------------------------------------
    # settings panel
    # ------------------------------------------------------------------
    @guarded
    def on_check_selected(self, sender, args):
        self.settings_panel.Children.Clear()
        row = self.check_list.SelectedItem
        if row is None:
            return
        chk = row.check

        # Picking a check on the left drives the Check filter, so the table
        # follows the list instead of the two disagreeing.
        try:
            for i in range(self.check_filter.Items.Count):
                if self.check_filter.Items[i].Content == chk.title:
                    if self.check_filter.SelectedIndex != i:
                        self.check_filter.SelectedIndex = i
                    break
        except Exception:
            pass
        store = self.settings.setdefault(chk.id, {})
        self._editors = {}

        for key in sorted(chk.options.keys()):
            label, default, unit = chk.options[key]
            value = store.get(key, default)

            lbl = TextBlock()
            suffix = ''
            if unit and '|' not in unit and unit != 'text':
                suffix = ' (' + unit + ')'
            lbl.Text = label + suffix
            lbl.FontSize = 11
            lbl.TextWrapping = TextWrapping.Wrap
            lbl.Margin = Thickness(0, 6, 0, 2)
            self.settings_panel.Children.Add(lbl)

            if isinstance(default, bool):
                ed = CheckBox()
                ed.IsChecked = bool(value)
                ed.Content = 'enabled'
                ed.FontSize = 11
                ed.Checked += self._make_saver(chk.id, key, ed, bool)
                ed.Unchecked += self._make_saver(chk.id, key, ed, bool)
            elif '|' in (unit or ''):
                ed = ComboBox()
                ed.FontSize = 11
                choices = unit.split('|')
                for c in choices:
                    ed.Items.Add(ComboBoxItem(Content=c))
                ed.SelectedIndex = choices.index(value) if value in choices else 0
                ed.SelectionChanged += self._make_combo_saver(chk.id, key,
                                                             ed, choices)
            else:
                ed = TextBox()
                ed.Text = str(value)
                ed.FontSize = 11
                ed.Padding = Thickness(4, 2, 4, 2)
                if isinstance(default, bool):
                    caster = bool
                elif isinstance(default, int):
                    caster = int
                elif isinstance(default, float):
                    caster = float
                else:
                    caster = str
                ed.LostFocus += self._make_saver(chk.id, key, ed, caster)

            ed.Margin = Thickness(0, 0, 0, 2)
            self.settings_panel.Children.Add(ed)

    def _make_saver(self, check_id, key, editor, caster):
        # saved at once: a crash no longer loses the settings changed since
        # the last Run
        def handler(sender, args):
            try:
                if caster is bool:
                    self.settings[check_id][key] = bool(editor.IsChecked)
                else:
                    self.settings[check_id][key] = caster(editor.Text)
                core.save_settings(self.settings)
            except Exception:
                self.set_status('Invalid value for "{0}" - ignored.'.format(key))
        return handler

    def _make_combo_saver(self, check_id, key, editor, choices):
        def handler(sender, args):
            try:
                idx = editor.SelectedIndex
                if 0 <= idx < len(choices):
                    self.settings[check_id][key] = choices[idx]
                    core.save_settings(self.settings)
            except Exception:
                core.log('combo saver failed:\n' + traceback.format_exc())
        return handler

    # ------------------------------------------------------------------
    # running
    # ------------------------------------------------------------------
    @guarded
    def on_select_all(self, sender, args):
        self._set_all(True)

    @guarded
    def on_select_none(self, sender, args):
        self._set_all(False)

    def _set_all(self, state):
        for r in self.rows:
            r.Enabled = state
        self.check_list.Items.Refresh()

    @guarded
    def on_run(self, sender, args):
        self._start_run([r for r in self.rows if r.Enabled])

    def _title(self):
        try:
            return revit.doc.Title
        except Exception:
            return ''

    def _start_run(self, active, then=None):
        """Run these checks, each in its own ExternalEvent (a valid API
        context), the window repainting in between. then(): afterwards."""
        if self._run_queue:
            self.set_status('A run is already going.')
            return
        if not active:
            self.set_status('No checks selected.')
            return
        self.doc = revit.doc
        # a different model open now: its own accepted list
        if core.model_key(self.doc) != self.accepted.key:
            self.link = ViewerLink(self._title())
            if self.link.ok:
                self.link.refresh()
            self.accepted = core.AcceptedStore(self.doc, self.link)
        floor_relations.invalidate_probe()
        self.btn_run.IsEnabled = False
        self.results_grid.IsEnabled = False
        self.check_list.IsEnabled = False
        self.settings_panel.IsEnabled = False
        core.probe_reset('Run on {0}'.format(self.doc.Title))
        self._run_queue = list(active)
        self._run_total = len(active)
        self._executed = []
        self._then = then
        self._post_next()

    def _post_next(self):
        try:
            if not self._run_queue:
                self._finish_run()
                return
            row = self._run_queue.pop(0)
            i = self._run_total - len(self._run_queue)
            self.set_status('[{0}/{1}] {2}...'.format(i, self._run_total, row.check.title))

            def action(uiapp):
                try:
                    self.doc = uiapp.ActiveUIDocument.Document
                    row.check.doc = self.doc
                    row.check.settings = self.settings
                    core.probe('>>> START {0}'.format(row.check.id))
                    row.check.execute()
                    core.probe('<<< DONE  {0}: {1} issue(s)'.format(
                        row.check.id, len(row.check.issues)))
                    self.accepted.apply(row.check.issues)
                    row.refresh_count()
                    self._row_status(row)
                    self._executed.append(row.check)
                    self.check_list.Items.Refresh()
                except Exception:
                    core.log('check step failed:\n' + traceback.format_exc())
                # the next one in a fresh API context, after WPF has repainted
                self._later(self._post_next)
            self.dispatcher.post(action)
        except Exception:
            core.log('run step failed:\n' + traceback.format_exc())
            self._run_queue = []
            self._finish_run()

    def _later(self, fn):
        from System.Windows.Threading import DispatcherPriority
        from System import Action
        self.Dispatcher.BeginInvoke(DispatcherPriority.Background, Action(fn))

    def _row_status(self, row):
        if row.check.error:
            row.status = 'ERROR - see log'
        elif row.notices and row.count == 0:
            row.status = 'nothing to measure against'
        else:
            affected = len(set(
                i.primary_id for i in row.check.issues
                if not i.scoreless and not i.accepted))
            if affected and affected != row.count:
                row.status = ('{0} finding(s) on {1} of {2} '
                              'elements, {3:.1f}s').format(
                    row.count, affected, row.check.population,
                    row.check.elapsed)
            else:
                row.status = '{0} of {1} elements, {2:.1f}s'.format(
                    row.count, row.check.population,
                    row.check.elapsed)

    def _finish_run(self):
        self.btn_run.IsEnabled = True
        self.results_grid.IsEnabled = True
        self.check_list.IsEnabled = True
        self.settings_panel.IsEnabled = True
        core.probe('run finished')
        ran = set(c.id for c in self._executed)
        for r in self.rows:
            if r.check.id not in ran and not r.Enabled:
                r.count = None
                r.notices = 0
                r.status = 'skipped'
        self.check_list.Items.Refresh()
        self._rebuild_filters()
        scored = [r.check for r in self.rows if r.check.id in ran or (r.Enabled and r.count is not None)]
        if scored:
            self.report = health.model_health(scored)
            self._paint_health(self.report)
        self.settings['_enabled'] = dict(
            (r.check.id, r.Enabled) for r in self.rows)
        core.save_settings(self.settings)
        self.refresh_grid()
        then, self._then = self._then, None
        if then is not None:
            try:
                then()
            except Exception:
                core.log('after run failed:\n' + traceback.format_exc())
        elif self.report is not None:
            self.set_status('Done. {0} issue(s) across {1} check(s).'.format(
                self.report['issues'], len(self._executed)))

    def _paint_health(self, report):
        self.score_grade.Text = report['grade']
        self.score_value.Text = '{0:.0f}/100'.format(report['score'])
        self.score_badge.Background = brush(report['colour'])
        self.health_bar.Value = report['score']
        self.health_bar.Foreground = brush(report['colour'])
        note = '{0} - {1} open issue(s)'.format(report['label'],
                                                report['issues'])
        if report.get('accepted'):
            note += ', {0} accepted'.format(report['accepted'])
        note += '  ({0:.1f} of 100 pts lost)'.format(report['lost'])
        self.health_label.Text = note

    # ------------------------------------------------------------------
    # results grid
    # ------------------------------------------------------------------
    def _rebuild_filters(self):
        """Repopulate the check and problem-type pickers from the results."""
        self._suspend_filters = True
        try:
            self.check_filter.Items.Clear()
            self.check_filter.Items.Add(ComboBoxItem(Content='All checks'))
            for r in self.rows:
                if r.check.issues:
                    self.check_filter.Items.Add(
                        ComboBoxItem(Content=r.check.title))
            self.check_filter.SelectedIndex = 0

            problems = set()
            for r in self.rows:
                for i in r.check.issues:
                    if i.problem:
                        problems.add(i.problem)
            self.problem_filter.Items.Clear()
            self.problem_filter.Items.Add(
                ComboBoxItem(Content='All problem types'))
            for p in sorted(problems):
                self.problem_filter.Items.Add(ComboBoxItem(Content=p))
            self.problem_filter.SelectedIndex = 0
        finally:
            self._suspend_filters = False

    @guarded
    def on_grid_click(self, sender, args):
        """A tick box may have changed. Persist and rescore."""
        if not self.all_issues:
            return
        self.accepted.harvest(self.all_issues)
        self.accepted.save()
        self._rescore()
        # Repaint so the accepted-row colour trigger re-evaluates.
        try:
            self.results_grid.Items.Refresh()
        except Exception:
            pass

    @guarded
    def on_filter_changed(self, sender, args):
        if self._suspend_filters:
            return
        self.refresh_grid()

    def refresh_grid(self):
        """Always start from every issue in every check.

        The old behaviour narrowed to the selected check whenever that check
        had results, which made the table silently show a subset. Scope is now
        an explicit filter instead of a side effect of the left-hand list.
        """
        issues = []
        for r in self.rows:
            issues.extend(r.check.issues)
        total = len(issues)

        # check
        idx = self.check_filter.SelectedIndex
        if idx > 0:
            try:
                wanted = self.check_filter.SelectedItem.Content
                issues = [i for i in issues
                          if self._check_title(i.check_id) == wanted]
            except Exception:
                pass

        # problem type
        idx = self.problem_filter.SelectedIndex
        if idx > 0:
            try:
                wanted = self.problem_filter.SelectedItem.Content
                issues = [i for i in issues if i.problem == wanted]
            except Exception:
                pass

        # severity
        idx = self.severity_filter.SelectedIndex
        if idx == 1:
            issues = [i for i in issues if i.severity == Severity.CRITICAL]
        elif idx == 2:
            issues = [i for i in issues if i.severity >= Severity.WARNING]

        # acceptance
        idx = self.accepted_filter.SelectedIndex
        if idx == 0:
            issues = [i for i in issues if not i.accepted]
        elif idx == 2:
            issues = [i for i in issues if i.accepted]

        issues.sort(key=lambda i: (i.accepted, -i.severity, i.problem,
                                   i.category))
        coll = ObservableCollection[object]()
        for i in issues:
            coll.Add(i)
        self.results_grid.ItemsSource = coll
        self.all_issues = issues
        self.results_title.Text = (
            'RESULTS - showing {0} of {1} issue(s)'.format(len(issues), total))

    def _check_title(self, check_id):
        for r in self.rows:
            if r.check.id == check_id:
                return r.check.title
        return check_id

    def _selected_issues(self):
        sel = list(self.results_grid.SelectedItems)
        return sel if sel else list(self.all_issues)

    # ------------------------------------------------------------------
    # actions
    # ------------------------------------------------------------------
    @guarded
    def on_copy(self, sender, args):
        issues = self._selected_issues()
        ids = []
        for i in issues:
            for e in i.element_ids:
                if e not in ids:
                    ids.append(e)
        if not ids:
            self.set_status('Nothing to copy.')
            return
        Clipboard.SetText(','.join(str(i) for i in ids))
        self.set_status('{0} element ID(s) copied to clipboard.'.format(len(ids)))

    def _post_select(self, zoom=False, issues=None, quiet=False):
        if issues is None:
            issues = self._selected_issues()
        ids = []
        seen = set()
        for i in issues:
            for e in i.element_ids:
                if e not in seen:
                    seen.add(e)
                    ids.append(core.new_id(e))
        if not ids:
            if not quiet:
                self.set_status('Nothing to select.')
            return

        def action(uiapp):
            uidoc = uiapp.ActiveUIDocument
            try:
                uidoc.Selection.SetElementIds(List[ElementId](ids))
            except Exception:
                pass
            got = 0
            try:
                got = uidoc.Selection.GetElementIds().Count
            except Exception:
                pass
            if got == 0:
                # Sketch lines, elements in a closed sketch and elements not
                # visible in the active view cannot be selected. Saying so
                # beats a button that appears to do nothing.
                self.set_status(
                    'Revit could not select these element(s). They may be '
                    'sketch lines inside a floor/ceiling sketch, or not '
                    'visible in the active view.')
                return
            if zoom:
                try:
                    uidoc.ShowElements(List[ElementId](ids))
                except Exception:
                    pass
        self.dispatcher.post(action)
        if not quiet:
            self.set_status(
                '{0} element(s) sent to selection.'.format(len(ids)))

    def _bulk_accept(self, state):
        sel = list(self.results_grid.SelectedItems)
        if not sel:
            self.set_status('Select one or more rows first '
                            '(Shift-click or Ctrl-click for a range).')
            return
        for iss in sel:
            iss.accepted = state
        self.accepted.harvest(sel)
        self.accepted.save()
        self._rescore()
        self.refresh_grid()
        self.set_status('{0} finding(s) marked as {1}.'.format(
            len(sel), 'not an error' if state else 'open'))

    @guarded
    def on_accept_selected(self, sender, args):
        self._bulk_accept(True)

    @guarded
    def on_reopen_selected(self, sender, args):
        self._bulk_accept(False)

    def _rescore(self):
        executed = [r.check for r in self.rows if r.Enabled]
        if executed:
            self.report = health.model_health(executed)
            self._paint_health(self.report)
        for r in self.rows:
            r.refresh_count()
        self.check_list.Items.Refresh()

    def on_unhandled(self, sender, args):
        try:
            core.probe('DISPATCHER UNHANDLED: {0}'.format(args.Exception))
            core.log('dispatcher unhandled: {0}'.format(args.Exception))
            args.Handled = True
            self.status_text.Text = ('An internal error was caught and '
                                     'contained. See modeldoctor.log.')
        except Exception:
            pass

    @guarded
    def on_preview_key(self, sender, args):
        from System.Windows.Input import Key
        if args.Key == Key.Escape:
            args.Handled = True

    @guarded
    def on_row_selected(self, sender, args):
        """Follow the grid selection in the model, the way Revit's own
        'Select by ID' behaves. Zoom is deliberately left to double-click so
        that arrowing down a long list does not thrash the view."""
        if not self.follow_selection.IsChecked:
            return
        sel = list(self.results_grid.SelectedItems)
        if not sel:
            return
        self._post_select(False, sel, quiet=True)

    @guarded
    def on_row_double_click(self, sender, args):
        sel = list(self.results_grid.SelectedItems)
        if sel:
            self._post_select(True, sel)

    @guarded
    def on_select_in_model(self, sender, args):
        self._post_select(False)

    @guarded
    def on_zoom(self, sender, args):
        self._post_select(True)

    @guarded
    def on_fix_selected(self, sender, args):
        # never "everything shown" by default: a fix edits the model
        sel = list(self.results_grid.SelectedItems)
        if not sel:
            self.set_status('Select the rows to fix first (Shift-click or '
                            'Ctrl-click for several).')
            return
        self._run_fix(sel)

    @guarded
    def on_fix_all(self, sender, args):
        # the check the table is filtered to; else the one picked on the left
        chk = None
        if self.check_filter.SelectedIndex > 0:
            wanted = self.check_filter.SelectedItem.Content
            for r in self.rows:
                if r.check.title == wanted:
                    chk = r.check
        if chk is None:
            row = self.check_list.SelectedItem
            chk = row.check if row is not None else None
        if chk is None:
            self.set_status('Pick a check (left, or the Check filter) first.')
            return
        self._run_fix(list(chk.issues))

    def _run_fix(self, issues):
        by_check = {}
        for i in issues:
            if i.accepted:
                continue
            if i.fixable:
                by_check.setdefault(i.check_id, []).append(i)
        if not by_check:
            reasons = {}
            for i in issues:
                r = i.fix_blocked or 'no reason recorded'
                reasons[r] = reasons.get(r, 0) + 1
            detail = '; '.join('{0} x {1}'.format(reasons[k], k)
                               for k in sorted(reasons, key=reasons.get,
                                               reverse=True))
            self.set_status('None of the {0} selected issue(s) can be '
                            'auto-fixed - {1}'.format(len(issues), detail))
            core.log('fix blocked: ' + detail)
            return

        lookup = dict((r.check.id, r.check) for r in self.rows)
        lines = []
        total = 0
        for cid, items in by_check.items():
            lines.append(' - {0}: {1} issue(s), "{2}"'.format(
                lookup[cid].title, len(items), lookup[cid].fix_verb))
            total += len(items)

        # pyRevit's own (WPF) dialog: no Revit TaskDialog from outside the
        # API context
        if not forms.alert('Modify {0} issue(s)?\n\nThis edits the model. It can be '
                           'undone with a single Ctrl+Z.\n\n{1}'.format(total, '\n'.join(lines)),
                           title='Model Doctor - confirm rectification', yes=True, no=True):
            self.set_status('Rectification cancelled.')
            return
        fixed_ids = list(by_check.keys())
        # the findings sent to the fix (signatures were worked out in the run)
        tried = set(core.uid_signature(self.doc, i) for items in by_check.values() for i in items)

        def action(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            results = []

            def work(d):
                for cid, items in by_check.items():
                    chk = lookup[cid]
                    chk.doc = d
                    try:
                        # each check in its own sub-transaction: one that
                        # fails half way leaves nothing half done
                        n, msg = core.in_sub(d, lambda: chk.fix(items))
                        results.append('{0}: {1}'.format(chk.title, msg))
                    except Exception:
                        core.log('fix crashed in {0}\n{1}'.format(
                            cid, traceback.format_exc()))
                        results.append('{0}: FAILED (undone), see log'.format(chk.title))
                return results

            try:
                core.transact(doc, 'Model Doctor rectification', work)
                self.set_status(' | '.join(results) + ' - checking again ...')
            except Exception:
                core.log('transaction failed\n' + traceback.format_exc())
                self.set_status('Rectification failed - see log.')
            floor_relations.invalidate_probe()
            # the results as the model is now: fixed rows go, and cannot be
            # "fixed" a second time
            summary = ' | '.join(results)
            self._later(lambda: self._start_run(
                [r for r in self.rows if r.check.id in fixed_ids],
                then=lambda: self._after_fix(summary, tried)))

        self.dispatcher.post(action)
        self.set_status('Rectification queued...')

    def _after_fix(self, summary, tried):
        """After a fix and the run again: the viewer's queue answered, for the
        queued findings that were in this fix."""
        msg = summary
        if self._queue_wait:
            now = set(core.uid_signature(self.doc, i) for r in self.rows for i in r.check.issues)
            fixed = skipped = 0
            for sig, item in list(self._queue_wait.items()):
                if sig not in tried:
                    continue
                if sig in now:
                    f = self._finding_by_sig(sig)
                    why = (f.fix_blocked if f is not None and f.fix_blocked else 'still found after the fix')
                    self.link.put(shared.done_item(item, 'skipped', why, self.accepted._me()))
                    skipped += 1
                else:
                    self.link.put(shared.done_item(item, 'fixed', '', self.accepted._me()))
                    fixed += 1
                    self._queue_wait.pop(sig, None)
            msg += ' | viewer queue: {0} fixed, {1} not'.format(fixed, skipped)
            self._paint_queue()
        self.set_status(msg)

    def _finding_by_sig(self, sig):
        for r in self.rows:
            for i in r.check.issues:
                if core.uid_signature(self.doc, i) == sig:
                    return i
        return None

    # ------------------------------------------------------------------
    # the viewer's fix queue
    # ------------------------------------------------------------------
    def _paint_queue(self):
        try:
            n = len(self.link.queue()) if self.link.ok else 0
            self.btn_queue.Content = 'Fix queue ({0})'.format(n) if n else 'Fix queue'
            self.btn_queue.ToolTip = (self.link.why if not self.link.ok else
                                      'Findings the LWK Viewer asked Revit to fix (3D > Checks > Doctor > Fix in Revit)')
        except Exception:
            pass

    @guarded
    def on_queue(self, sender, args):
        if not self.link.ok:
            self.set_status('LWK Viewer: ' + self.link.why)
            return
        if not self.link.refresh():
            self.set_status('LWK Viewer: ' + self.link.why)
            return
        queue = self.link.queue()

        def action(uiapp):
            doc = uiapp.ActiveUIDocument.Document

            def here(uid):
                try:
                    return doc.GetElement(uid) is not None
                except Exception:
                    return False
            mine, elsewhere = shared.queue_for_doc(queue, here)
            self._later(lambda: self._queue_go(mine, elsewhere))
        self.dispatcher.post(action)
        self.set_status('Fix queue: looking for {0} finding(s) in this model ...'.format(len(queue)))

    def _queue_go(self, mine, elsewhere):
        if not mine:
            self.set_status('Nothing in the viewer\'s fix queue for this model ({0} for other models).'
                            .format(len(elsewhere)))
            self._paint_queue()
            return
        wanted = set(it.get('check') for it in mine)
        rows = [r for r in self.rows if r.check.id in wanted]
        self.set_status('Fix queue: checking {0} ...'.format(', '.join(r.check.title for r in rows)))
        self._start_run(rows, then=lambda: self._queue_found(mine))

    def _queue_found(self, mine):
        findings = [(core.uid_signature(self.doc, i), i) for r in self.rows for i in r.check.issues]
        matched, missing = shared.match_queue(mine, findings)
        me = self.accepted._me()
        for item in missing:
            self.link.put(shared.done_item(item, 'skipped', 'not found in the model now (fixed already, or it changed)', me))
        self._queue_wait = dict((it.get('signature'), it) for it, f in matched)
        # show just them, selected, ready for Fix selected
        self._suspend_filters = True
        try:
            self.check_filter.SelectedIndex = 0
            self.problem_filter.SelectedIndex = 0
            self.severity_filter.SelectedIndex = 0
            self.accepted_filter.SelectedIndex = 1
        finally:
            self._suspend_filters = False
        self.refresh_grid()
        want = set(id(f) for it, f in matched)
        self.results_grid.SelectedItems.Clear()
        for row in self.all_issues:
            if id(row) in want:
                self.results_grid.SelectedItems.Add(row)
        self._paint_queue()
        self.set_status('Fix queue: {0} finding(s) found and selected - Fix selected fixes them '
                        '(one Ctrl+Z); {1} no longer in the model (the viewer is told).'
                        .format(len(matched), len(missing)))

    @guarded
    def on_export(self, sender, args):
        if not any(r.check.issues for r in self.rows):
            self.set_status('Nothing to export - run the checks first.')
            return
        dlg = SaveFileDialog()
        dlg.Filter = 'CSV file (*.csv)|*.csv'
        dlg.FileName = '{0}_ModelDoctor.csv'.format(self.doc.Title)
        if dlg.ShowDialog() != DialogResult.OK:
            return
        try:
            shared.write_csv(dlg.FileName, [i.csv_row() for r in self.rows for i in r.check.issues])
            self.set_status('Exported to {0}'.format(dlg.FileName))
        except Exception:
            core.log('export failed\n' + traceback.format_exc())
            self.set_status('Export failed - see log.')

    # ------------------------------------------------------------------
    def set_status(self, text):
        self.status_text.Text = text

    @guarded
    def on_closed(self, sender, args):
        self._run_queue = []
        try:
            for r in self.rows:
                self.accepted.harvest(r.check.issues)
            self.accepted.save()
        except Exception:
            core.log('accepted save on close failed')
        self.settings['_enabled'] = dict(
            (r.check.id, r.Enabled) for r in self.rows)
        core.save_settings(self.settings)
        floor_relations.invalidate_probe()


xaml_path = os.path.join(os.path.dirname(__file__), 'ModelDoctor.xaml')
ModelDoctorWindow(xaml_path).Show()
