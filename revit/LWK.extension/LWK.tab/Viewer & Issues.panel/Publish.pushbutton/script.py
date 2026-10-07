# -*- coding: utf-8 -*-
"""Publish the model open now to the LWK Viewer: sheets, 3D model, upload -
one window, one click. Everything else (the step-by-step buttons) is under
"Viewer tools" for the few times it is needed."""
__title__ = "Publish\nto Viewer"
__author__ = "LWK BIM"
__doc__ = ("Export the sheets and the 3D model of this model, put them together and send them "
           "to the LWK Viewer - in one go. Choices are remembered for this model.")

import os
import sys

from pyrevit import revit, forms, script, HOST_APP


def _own_lib(start):
    node = os.path.dirname(os.path.abspath(start))
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:
            return None
        node = parent
    lib = os.path.join(node, "lib")
    return lib if os.path.isdir(lib) else None


# this extension's own lib first; any lwk_viewer loaded before is dropped
_LIB = _own_lib(__file__)
if _LIB:
    while _LIB in sys.path:
        sys.path.remove(_LIB)
    sys.path.insert(0, _LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]

from lwk_viewer import batch, publish
from lwk_viewer import issues as LI

doc = revit.doc
out = script.get_output()
XAML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "publish.xaml")


class SheetItem(forms.TemplateListItem):
    @property
    def name(self):
        return "%s   %s" % (self.item.SheetNumber, self.item.Name)


def ask_password(title, prompt):
    """A small password box (the text is not shown)."""
    import clr
    clr.AddReference("System.Windows.Forms")
    clr.AddReference("System.Drawing")
    import System.Windows.Forms as WF
    import System.Drawing as SD
    f = WF.Form()
    f.Text = title
    f.Width, f.Height = 360, 150
    f.FormBorderStyle = WF.FormBorderStyle.FixedDialog
    f.StartPosition = WF.FormStartPosition.CenterScreen
    f.MaximizeBox = f.MinimizeBox = False
    lab = WF.Label()
    lab.Text, lab.Left, lab.Top, lab.Width = prompt, 12, 12, 320
    box = WF.TextBox()
    box.UseSystemPasswordChar = True
    box.Left, box.Top, box.Width = 12, 36, 320
    ok = WF.Button()
    ok.Text, ok.Left, ok.Top, ok.DialogResult = "Sign in", 176, 70, WF.DialogResult.OK
    cancel = WF.Button()
    cancel.Text, cancel.Left, cancel.Top, cancel.DialogResult = "Cancel", 257, 70, WF.DialogResult.Cancel
    for c in (lab, box, ok, cancel):
        f.Controls.Add(c)
    f.AcceptButton, f.CancelButton = ok, cancel
    return box.Text if f.ShowDialog() == WF.DialogResult.OK else None


class PublishWindow(forms.WPFWindow):
    def __init__(self):
        forms.WPFWindow.__init__(self, XAML)
        self.result = None
        self.saved = None
        self.jobs = batch.load_jobs()
        self.job, self.ids = publish.job_for(doc, self.jobs)
        job = self.job or {}
        self.sheet_numbers = list(job.get("sheet_numbers") or [])
        self.doc_title.Text = doc.Title
        # where
        proj = job.get("upload_project") or publish.safe_project(doc.Title)
        self.project_box.Text = proj
        self.folder_box.Text = job.get("folder") or publish.default_folder(proj)
        self.refresh_server()
        # what
        self.do3d.IsChecked = job.get("publish_3d", True) is not False
        self.dosheets.IsChecked = job.get("publish_sheets", True) is not False
        self.detail_box.SelectedIndex = {"coarse": 0, "medium": 1, "fine": 2}.get(job.get("fast3d_detail") or "medium", 1)
        sets = sorted(batch.revit_sheet_sets(doc).keys())
        for s in sets:
            self.set_box.Items.Add(s)
        self.set_box.IsEnabled = bool(sets)
        self.sheets_set.IsEnabled = bool(sets)
        mode = job.get("sheet_mode") or "all"
        if mode == "set" and job.get("sheet_set") in sets:
            self.sheets_set.IsChecked = True
            self.set_box.SelectedItem = job.get("sheet_set")
        elif mode == "list" and self.sheet_numbers:
            self.sheets_list.IsChecked = True
        elif sets:
            self.set_box.SelectedIndex = 0
        self.keep_others.IsChecked = job.get("keep_other_sheets", True) is not False
        self.as_part.IsChecked = bool(job.get("publish_part"))
        self.show_list_count()
        # then
        self.upload.IsChecked = job.get("upload", True) is not False
        cloud = bool(self.ids and self.ids.get("model"))
        self.nightly.IsEnabled = cloud
        self.nightly.IsChecked = bool(cloud and job.get("enabled"))
        try:
            from lwk_viewer import nightly as NL
            sch = NL.saved_schedule()
            if sch.get("time"):
                self.night_time.Text = sch["time"]
                self.weekdays.IsChecked = bool(sch.get("weekdays"))
        except Exception:
            pass
        # the night export starts the Revit version the model is open in now
        year = batch.doc_revit(doc)
        self.nightly_note.Text = ("Revit%s opens this model from ACC at night, publishes it and closes it "
                                  "(leave the PC on and Revit%s closed%s). Auto Publish on the LWK tab has "
                                  "Check setup and Test night run."
                                  % ((" " + year) if year else "", (" " + year) if year else "",
                                     "; other Revit versions may stay open" if year else "") if cloud else
                                  "Only a model on ACC can be published at night.")

    # ---------------------------------------------------------- server
    def refresh_server(self):
        server, token = LI.upload_settings()
        self.server = server
        self.token = token
        self.server_text.Text = (server + ("   (signed in)" if token else "   (not signed in)")) if server \
            else "not set - Sign in first"
        self.signin_btn.Content = "Change ..." if token else "Sign in ..."
        if server and token:
            try:
                names = [p.get("id") for p in LI.Client(server, token).projects() if p.get("id")]
                cur = self.project_box.Text
                self.project_box.Items.Clear()
                for n in names:
                    self.project_box.Items.Add(n)
                self.project_box.Text = cur
            except Exception as ex:
                self.status_text.Text = "Could not list the server's projects: %s" % ex

    def signin_click(self, sender, args):
        st = LI.load_settings()
        server = forms.ask_for_string(default=st.get("server") or "https://", title="Viewer server",
                                      prompt="Address of the LWK Viewer server:")
        if not server:
            return
        email = forms.ask_for_string(default=st.get("email") or "", title="Viewer server",
                                     prompt="Your email (or name, on a server with a shared passphrase):")
        if email is None:
            return
        pw = ask_password("Viewer server", "Password (or the shared passphrase):")
        if pw is None:
            return
        try:
            c = LI.Client(server.strip(), "")
            c.login(email.strip(), pw)
            st.update({"server": c.base, "email": email.strip(), "token": c.token})
            LI.save_settings(st)
            self.status_text.Text = "Signed in."
        except Exception as ex:
            self.status_text.Text = "Sign-in failed: %s" % ex
        self.refresh_server()

    # ---------------------------------------------------------- choices
    def browse_click(self, sender, args):
        f = forms.pick_folder(title="Export folder")
        if f:
            self.folder_box.Text = f

    def show_list_count(self):
        n = len(self.sheet_numbers)
        self.list_text.Text = ("%d chosen" % n) if n else "none chosen yet"

    def choose_sheets_click(self, sender, args):
        from Autodesk.Revit.DB import FilteredElementCollector, ViewSheet
        have = set(self.sheet_numbers)
        sheets = sorted([s for s in FilteredElementCollector(doc).OfClass(ViewSheet) if not s.IsPlaceholder],
                        key=lambda s: s.SheetNumber)
        picked = forms.SelectFromList.show(
            [SheetItem(s, checked=(s.SheetNumber in have)) for s in sheets],
            title="Sheets to publish (%d in the model)" % len(sheets),
            multiselect=True, button_name="Use these sheets", width=560, height=640)
        if picked:
            self.sheet_numbers = [s.SheetNumber for s in picked]
            self.sheets_list.IsChecked = True
        self.show_list_count()

    def cancel_click(self, sender, args):
        self.Close()

    def publish_click(self, sender, args):
        opt = self.collect(publishing=True)
        if opt is None:
            return
        if opt["nightly"] and not self.night_ok(opt):
            return
        self.result = opt
        self.Close()

    def save_click(self, sender, args):
        """Keep the choices without publishing."""
        opt = self.collect(publishing=False)
        if opt is None:
            return
        if opt["nightly"] and not self.night_ok(opt):
            return
        try:
            job, lines, others = publish.save_settings(doc, opt)
        except Exception as ex:
            self.status_text.Text = "Could not save the settings: %s" % ex
            return
        self.saved = lines
        self.Close()

    def night_ok(self, opt):
        """Before a night export is switched on: is this model already
        published at night from another PC? Asks; True to go on."""
        try:
            from lwk_viewer import autopub
            job = publish.build_job(doc, batch.load_jobs(), opt)
            others, note = autopub.check(job)
        except Exception as ex:
            others, note = [], str(ex)
        if not others:
            return True
        return bool(forms.alert(
            "This model is ALREADY published at night by:\n\n%s\n\n"
            "Two night exports of the same model overwrite each other on the viewer. "
            "Switch the night export on here as well?"
            % "\n".join("  - " + autopub.who_text(e) for e in others), yes=True, no=True))

    def collect(self, publishing=True):
        project = publish.safe_project(self.project_box.Text)
        folder = (self.folder_box.Text or "").strip() or publish.default_folder(project)
        if self.as_part.IsChecked and os.path.normcase(folder) == os.path.normcase(publish.default_folder(project)):
            # its own folder: the other Revit file may publish from this PC too
            folder = publish.default_folder(project) + " - " + publish.safe_project(doc.Title)
        if not (self.do3d.IsChecked or self.dosheets.IsChecked):
            self.status_text.Text = "Tick the 3D model, the sheets, or both."
            return
        mode = "all"
        if self.dosheets.IsChecked:
            if self.sheets_set.IsChecked:
                if not self.set_box.SelectedItem:
                    self.status_text.Text = "Choose the sheet set."
                    return
                mode = "set"
            elif self.sheets_list.IsChecked:
                if not self.sheet_numbers:
                    self.status_text.Text = "Choose the sheets first."
                    return
                mode = "list"
        if publishing and self.upload.IsChecked and not (self.server and self.token):
            self.status_text.Text = "Sign in to the viewer server first (or untick 'Send to the viewer server')."
            return
        t = (self.night_time.Text or "01:00").strip()
        if self.nightly.IsChecked:
            import re
            if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
                self.status_text.Text = "Give the nightly time as HH:MM, e.g. 01:00."
                return
        return {
            "project": project, "folder": folder,
            "do3d": bool(self.do3d.IsChecked),
            "detail": ["coarse", "medium", "fine"][max(0, self.detail_box.SelectedIndex)],
            "dosheets": bool(self.dosheets.IsChecked), "sheet_mode": mode,
            "sheet_set": str(self.set_box.SelectedItem or ""), "sheet_numbers": list(self.sheet_numbers),
            "keep_other_sheets": bool(self.keep_others.IsChecked),
            "part": bool(self.as_part.IsChecked),
            "upload": bool(self.upload.IsChecked), "open_after": bool(self.open_after.IsChecked),
            "nightly": bool(self.nightly.IsChecked), "nightly_time": t, "weekdays": bool(self.weekdays.IsChecked),
        }


def main():
    if doc.IsFamilyDocument:
        forms.alert("Open the project model, not a family.", exitscript=True)
    w = PublishWindow()
    w.ShowDialog()
    if w.saved:
        out.print_md("## Settings saved for **%s** (nothing was published)" % doc.Title)
        for line in w.saved:
            out.print_md("- %s" % line)
        out.print_md("Review every model's settings - yours and other people's - with **Auto Publish** on the LWK tab.")
        return
    opt = w.result
    if not opt:
        return
    out.print_md("## Publishing **%s** to the viewer project **%s**" % (doc.Title, opt["project"]))
    ok, summary, url = publish.run(doc, HOST_APP.uiapp, opt, out.print_md)
    out.print_md("### %s: %s" % ("Done" if ok else "Finished with problems (see above)",
                                 ", ".join(summary) or "nothing published"))
    if url:
        out.print_md("Open: [%s](%s)" % (url, url))
        if opt.get("open_after"):
            try:
                LI.open_url(url)
            except Exception:
                pass


main()
