# -*- coding: utf-8 -*-
"""LWK Issues - the web viewer's issues inside Revit.

List the project's issues, go to one (3D point or sheet markup), and place
coloured pins at their exact positions. Stays open beside Revit."""
__title__ = "LWK\nIssues"
__author__ = "LWK BIM"
__persistentengine__ = True

import os
import sys

from Autodesk.Revit.DB import Transaction, ElementId, XYZ
from Autodesk.Revit.UI import IExternalEventHandler, ExternalEvent, TaskDialog
from System.Collections.Generic import List
# System.Data is not one of the assemblies IronPython loads by itself: the
# import failed with "No module named Data" until it is referenced here.
import clr
clr.AddReference("System.Data")
from System.Data import DataTable
from pyrevit import forms

# Always the library next to this extension, freshly loaded.
# This extension's own lib first, so an older lwk_viewer in another
# extension can never be the one imported.
def _own_lib(start):
    node = os.path.dirname(os.path.abspath(start))
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:
            return None
        node = parent
    lib = os.path.join(node, "lib")
    return lib if os.path.isdir(lib) else None


_LIB = _own_lib(__file__)
if _LIB:
    while _LIB in sys.path:
        sys.path.remove(_LIB)
    sys.path.insert(0, _LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]
from lwk_viewer import issues as L

XAML = u"""
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="LWK Issues" Width="1180" Height="680" MinWidth="760" MinHeight="460"
        WindowStartupLocation="CenterScreen" ShowInTaskbar="True" FontFamily="Segoe UI" FontSize="12">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Padding" Value="10,4"/><Setter Property="Margin" Value="0,0,6,0"/>
      <Setter Property="Background" Value="#FFFFFF"/><Setter Property="BorderBrush" Value="#F2A15E"/>
    </Style>
  </Window.Resources>
  <DockPanel Margin="10">
    <Border DockPanel.Dock="Top" Background="#F28022" CornerRadius="6" Padding="10,6" Margin="0,0,0,8">
      <DockPanel>
        <TextBlock Text="LWK Issues" Foreground="White" FontWeight="Bold" FontSize="14" VerticalAlignment="Center"/>
        <TextBlock x:Name="who" Foreground="White" Margin="12,0,0,0" VerticalAlignment="Center" DockPanel.Dock="Right"/>
        <TextBlock/>
      </DockPanel>
    </Border>

    <StackPanel x:Name="signin" DockPanel.Dock="Top" Orientation="Horizontal" Margin="0,0,0,8">
      <TextBlock Text="Server" VerticalAlignment="Center" Margin="0,0,4,0"/>
      <TextBox x:Name="server" Width="250" Margin="0,0,10,0"/>
      <TextBlock Text="Email" VerticalAlignment="Center" Margin="0,0,4,0"/>
      <TextBox x:Name="email" Width="170" Margin="0,0,10,0"/>
      <TextBlock Text="Password" VerticalAlignment="Center" Margin="0,0,4,0"/>
      <PasswordBox x:Name="password" Width="120" Margin="0,0,10,0"/>
      <Button x:Name="login" Content="Sign in"/>
    </StackPanel>

    <DockPanel DockPanel.Dock="Top" Margin="0,0,0,8">
      <TextBlock Text="Project" VerticalAlignment="Center" Margin="0,0,4,0"/>
      <ComboBox x:Name="project" Width="230" Margin="0,0,8,0"/>
      <Button x:Name="refresh" Content="Refresh"/>
      <TextBlock Text="Show" VerticalAlignment="Center" Margin="8,0,4,0"/>
      <ComboBox x:Name="showfilter" Width="170" Margin="0,0,8,0" SelectedIndex="0">
        <ComboBoxItem Content="Open and in progress"/>
        <ComboBoxItem Content="Assigned to me (open)"/>
        <ComboBoxItem Content="All issues"/>
      </ComboBox>
      <CheckBox x:Name="withcomments" Content="Comments too" VerticalAlignment="Center" Margin="0,0,8,0" DockPanel.Dock="Right"
                ToolTip="List (and pin / cloud) the plain comments as well as the issues"/>
      <TextBox x:Name="search" ToolTip="Search titles, people, sheets"/>
    </DockPanel>

    <StackPanel DockPanel.Dock="Bottom" Margin="0,8,0,0">
      <DockPanel Margin="0,0,0,8">
        <TextBlock Text="Reply" VerticalAlignment="Center" FontWeight="Bold" Margin="0,0,6,0"/>
        <ComboBox x:Name="newstatus" Width="110" Margin="0,0,6,0" ToolTip="New status for the selected issue">
          <ComboBoxItem Content="Open"/><ComboBoxItem Content="In progress"/>
          <ComboBoxItem Content="Resolved"/><ComboBoxItem Content="Closed"/>
        </ComboBox>
        <Button x:Name="send" Content="Send to viewer" DockPanel.Dock="Right" Margin="6,0,0,0"
                ToolTip="Saves the status and the comment on the issue in the web viewer (everyone sees it, with your name)"/>
        <TextBox x:Name="reply" ToolTip="A comment for the selected issue (optional)"/>
      </DockPanel>
      <DockPanel Margin="0,0,0,8">
        <TextBlock Text="In reply to" VerticalAlignment="Center" Margin="0,0,6,0"/>
        <CheckBox x:Name="asquery" Content="Query (wants an answer)" DockPanel.Dock="Right" VerticalAlignment="Center" Margin="8,0,0,0"
                  ToolTip="Mark this message as a query - it shows as open until someone answers it"/>
        <Button x:Name="answered" Content="Mark query answered" DockPanel.Dock="Right" Margin="6,0,0,0"
                ToolTip="Marks the query chosen on the left as answered (no new message needed)"/>
        <ComboBox x:Name="replyto" ToolTip="Reply to one message in the discussion, or start a new message"/>
      </DockPanel>
      <DockPanel Margin="0,0,0,8">
        <Button x:Name="clouds" Content="Clouds on sheets" ToolTip="A revision cloud round every listed sheet issue / comment, on its Revit sheet (revision 'LWK Viewer issues')"/>
        <Button x:Name="unclouds" Content="Remove clouds"/>
        <Button x:Name="cloudtoggle" Content="Hide / show clouds" ToolTip="Switches revision 'LWK Viewer issues' between hidden and clouds + tags, on every sheet"/>
        <Button x:Name="pintoggle" Content="Hide / show pins here" ToolTip="Pins in the active view, through the view filter 'LWK Viewer issue pins' (works without worksets)"/>
        <TextBlock x:Name="hint" Text="  Pins: workset 'LWK Issues' if the model is workshared, else view filter 'LWK Viewer issue pins'" Foreground="#9CA3AF" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
      </DockPanel>
      <DockPanel>
        <Button x:Name="goto" Content="Go to issue" FontWeight="Bold" ToolTip="Double-click a row does the same"/>
        <Button x:Name="planview" Content="Open its plan view" ToolTip="For an issue drawn on a sheet: the view it was drawn in, zoomed to the spot"/>
        <Button x:Name="browser" Content="Open in web viewer"/>
        <Button x:Name="unpin" Content="Remove pins" DockPanel.Dock="Right" Margin="0"/>
        <Button x:Name="pin" Content="Place pins for the list" DockPanel.Dock="Right"/>
        <TextBlock x:Name="msg" VerticalAlignment="Center" Foreground="#6B7280" TextTrimming="CharacterEllipsis"/>
      </DockPanel>
    </StackPanel>

    <Grid>
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="3*" MinWidth="360"/>
        <ColumnDefinition Width="6"/>
        <ColumnDefinition Width="2*" MinWidth="280"/>
      </Grid.ColumnDefinitions>
      <DataGrid x:Name="grid" Grid.Column="0" AutoGenerateColumns="False" IsReadOnly="True" SelectionMode="Single"
                HeadersVisibility="Column" GridLinesVisibility="Horizontal" RowHeight="24"
                HorizontalGridLinesBrush="#EEE" BorderBrush="#DDD" CanUserAddRows="False">
        <DataGrid.Columns>
          <DataGridTextColumn Header="#" Binding="{Binding No}" Width="40"/>
          <DataGridTextColumn Header="Title" Binding="{Binding Title}" Width="2*"/>
          <DataGridTextColumn Header="Type" Binding="{Binding Type}" Width="90"/>
          <DataGridTextColumn Header="Status" Binding="{Binding Status}" Width="80"/>
          <DataGridTextColumn Header="Priority" Binding="{Binding Priority}" Width="60"/>
          <DataGridTextColumn Header="Assigned to" Binding="{Binding Assigned}" Width="100"/>
          <DataGridTextColumn Header="Due" Binding="{Binding Due}" Width="76"/>
          <DataGridTextColumn Header="Where" Binding="{Binding Where}" Width="1.2*"/>
        </DataGrid.Columns>
      </DataGrid>
      <GridSplitter Grid.Column="1" Width="6" HorizontalAlignment="Stretch" Background="Transparent"/>
      <Border Grid.Column="2" BorderBrush="#DDD" BorderThickness="1" CornerRadius="4" Background="#FCFCFD">
        <ScrollViewer VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled">
          <StackPanel x:Name="card" Margin="12,10,12,12">
            <TextBlock Text="Choose an issue to see everything about it here: description, pictures, the whole comment thread."
                       TextWrapping="Wrap" Foreground="#9CA3AF"/>
          </StackPanel>
        </ScrollViewer>
      </Border>
    </Grid>
  </DockPanel>
</Window>
"""


class Handler(IExternalEventHandler):
    """Revit only lets a modeless window change the model or the views from
    inside an external event; each button queues its work here."""

    def __init__(self):
        self.job = None
        self.window = None

    def Execute(self, uiapp):
        job, self.job = self.job, None
        if not job:
            return
        try:
            job(uiapp)
        except Exception as ex:
            if self.window:
                self.window.say("Could not do that: %s" % ex)

    def GetName(self):
        return "LWK Issues"


class IssuesWindow(forms.WPFWindow):

    def __init__(self, handler, event):
        forms.WPFWindow.__init__(self, XAML, literal_string=True)
        self.handler, self.event = handler, event
        handler.window = self
        self.settings = L.load_settings()
        self.client = L.Client(self.settings.get("server", ""), self.settings.get("token", ""))
        self.me = None
        self.all = []
        self.shown = []
        self.manifest = None
        self.server.Text = self.settings.get("server", "https://lwk-trial01.eastasia.cloudapp.azure.com")
        self.email.Text = self.settings.get("email", "")
        self.login.Click += self.on_login
        self.refresh.Click += lambda s, e: self.load_items()
        self.project.SelectionChanged += lambda s, e: self.load_items()
        self.showfilter.SelectionChanged += lambda s, e: self.fill()
        self.search.TextChanged += lambda s, e: self.fill()
        self.grid.SelectionChanged += self.on_select
        self.grid.MouseDoubleClick += lambda s, e: self.go()
        self.goto.Click += lambda s, e: self.go()
        self.planview.Click += lambda s, e: self.go(plan=True)
        self.browser.Click += self.on_browser
        self.pin.Click += self.on_pin
        self.unpin.Click += self.on_unpin
        self.clouds.Click += self.on_clouds
        self.unclouds.Click += self.on_unclouds
        self.send.Click += self.on_send
        self.answered.Click += self.on_answered
        self.replyto.SelectionChanged += lambda s, e: self.on_replyto()
        self.reply_keys = []
        self.withcomments.Click += lambda s, e: self.rebuild()
        self.pintoggle.Click += self.on_pintoggle
        self.cloudtoggle.Click += self.on_cloudtoggle
        self.pics = {}                # server path -> local file
        self.raw_items = []
        self.start_auto_refresh()
        self.try_saved_token()

    # --------------------------------------------------------- helpers
    def say(self, text):
        self.msg.Text = text

    def background(self, work, done, what="Working"):
        """Talk to the server off the window's thread, so the window never
        freezes while it waits, and report any failure in words."""
        import threading
        from System import Action
        self.say(what + " ...")

        def ui(fn):
            try:
                self.Dispatcher.Invoke(Action(fn))
            except Exception:
                pass

        def body():
            try:
                result = work()
            except Exception as ex:
                err = str(ex) or ex.__class__.__name__
                ui(lambda: self.say("%s failed: %s" % (what, err)))
                ui(lambda: self.set_busy(False))
                return
            ui(lambda: done(result))
            ui(lambda: self.set_busy(False))

        self.set_busy(True)
        t = threading.Thread(target=body)
        t.daemon = True
        t.start()

    def set_busy(self, busy):
        try:
            self.login.IsEnabled = not busy
            self.refresh.IsEnabled = not busy
        except Exception:
            pass

    def run(self, job):
        self.handler.job = job
        self.event.Raise()

    def current(self):
        i = self.grid.SelectedIndex
        return self.shown[i] if 0 <= i < len(self.shown) else None

    # ------------------------------------------------------- sign in
    def try_saved_token(self):
        if not self.client.base or not self.client.token:
            self.say("Sign in with your LWK Viewer email and password.")
            return
        client = self.client

        def done(me):
            self.me = me
            self.after_login()
        self.background(lambda: client.me(), done, "Checking the saved sign-in")

    def on_login(self, sender, args):
        server = (self.server.Text or "").strip()
        email = (self.email.Text or "").strip()
        password = self.password.Password or ""
        if not server.lower().startswith(("http://", "https://")):
            self.say("The server address must start with https://  (for example "
                     "https://lwk-trial01.eastasia.cloudapp.azure.com)")
            return
        if not email or not password:
            self.say("Type your email and password first.")
            return
        client = L.Client(server, "")

        def work():
            client.login(email, password)
            return client.me()

        def done(me):
            self.client = client
            self.me = me
            self.password.Password = ""
            self.settings.update({"server": client.base, "email": email, "token": client.token})
            L.save_settings(self.settings)
            self.after_login()
        self.background(work, done, "Signing in to " + server)

    def after_login(self):
        u = (self.me or {}).get("user") or {}
        self.who.Text = u.get("name") or "signed in"
        if u.get("must_change"):
            self.say("Set your own password in the web viewer first (you still have the temporary one).")
        self.background(lambda: self.client.projects(), self.show_projects, "Reading your projects")

    def show_projects(self, ps):
        self.projects = ps
        self.project.Items.Clear()
        for p in ps:
            self.project.Items.Add(ProjectItem(p))
        want = (self.settings.get("doc_projects") or {}).get(doc_title())
        idx = 0
        for i, p in enumerate(ps):
            if p["id"] == want:
                idx = i
        if ps:
            self.project.SelectedIndex = idx
        else:
            self.say("You are not a member of any project on this server yet.")

    # --------------------------------------------------------- issues
    def pid(self):
        it = self.project.SelectedItem
        return it.id if it is not None else ""

    def load_items(self):
        pid = self.pid()
        if not pid:
            return
        dp = self.settings.setdefault("doc_projects", {})
        if dp.get(doc_title()) != pid:
            dp[doc_title()] = pid
            L.save_settings(self.settings)
        client = self.client

        def work():
            # a large project's manifest is several MB: read it off the
            # window's thread so the window stays responsive
            man = client.manifest(pid)
            return man, client.items(pid)

        def done(res):
            self.manifest, self.raw_items = res
            self.rebuild()
            self.say("%d issues in %s." % (len([i for i in self.all if not i.is_comment]), pid))
        self.background(work, done, "Loading the issues of " + pid)

    def rebuild(self):
        keep = self.current()
        self.all = L.issues_from(self.raw_items, self.manifest,
                                 with_comments=bool(self.withcomments.IsChecked))
        self.fill()
        if keep is not None:
            for k, i in enumerate(self.shown):
                if i.id == keep.id:
                    self.grid.SelectedIndex = k
                    break

    def start_auto_refresh(self):
        """Changes made in the web viewer show up here by themselves every
        two minutes (the list only; pins and clouds are redrawn on request)."""
        try:
            from System.Windows.Threading import DispatcherTimer
            from System import TimeSpan
            self._timer = DispatcherTimer()
            self._timer.Interval = TimeSpan.FromMinutes(2)
            self._timer.Tick += lambda s, e: (self.pid() and self.me and self.load_items())
            self._timer.Start()
            self.Closed += lambda s, e: self._timer.Stop()
        except Exception:
            pass

    def fill(self):
        mode = self.showfilter.SelectedIndex
        q = (self.search.Text or "").strip().lower()
        myname = (((self.me or {}).get("user") or {}).get("name") or "").lower()
        rows = []
        for i in self.all:
            if mode in (0, 1) and not i.open and not i.is_comment:
                continue
            if mode == 1 and i.assigned.lower() != myname:
                continue
            if q and q not in (" ".join([i.title, i.assigned, i.where, i.author, i.status])).lower():
                continue
            rows.append(i)
        self.shown = rows
        t = DataTable()
        for c in ("No", "Title", "Type", "Status", "Priority", "Assigned", "Due", "Where"):
            t.Columns.Add(c)
        for i in rows:
            t.Rows.Add(i.tag.lstrip("#"), i.title, i.type, i.status,
                       "" if i.is_comment else i.priority, i.assigned, i.due, i.where)
        self.grid.ItemsSource = t.DefaultView

    def on_select(self, sender, args):
        i = self.current()
        if not i:
            return
        try:
            self.show_card(i)
        except Exception as ex:
            self.say("Could not show the details: %s" % ex)
        try:
            self.newstatus.SelectedIndex = list(L.STATUSES).index(i.status) if i.status in L.STATUSES else -1
        except Exception:
            pass
        self.send.IsEnabled = not i.is_comment
        self.asquery.IsEnabled = not i.is_comment
        self.asquery.IsChecked = False
        self.fill_replyto(i)
        self.planview.IsEnabled = (not i.is3d) and bool(i.view_id)

    # ----------------------------------------------------- detail card
    def show_card(self, i):
        """Everything the viewer knows about the issue, so it can be
        reviewed here without the web page or a BCF file."""
        C = Card(self.card)
        C.clear()
        C.title(u"%s  %s" % (i.tag, i.title))
        chips = []
        if not i.is_comment:
            chips.append((i.status, L.STATUS_COLORS.get(i.status, (107, 114, 128))))
            chips.append((i.type, (75, 85, 99)))
            chips.append(("Priority: " + i.priority,
                          (220, 38, 38) if i.priority.lower() in ("high", "critical", "urgent")
                          else (107, 114, 128)))
        else:
            chips.append(("Comment", (107, 114, 128)))
        C.chips(chips)
        C.field("Assigned to", i.assigned or "-")
        if i.due:
            C.field("Due", i.due)
        C.field("Raised by", (u"%s  %s" % (i.author or "?", L.short_date(i.created))).strip())
        if i.updated and i.updated != i.created:
            C.field("Last change", L.short_date(i.updated))
        C.field("Where", i.where or "-")
        if i.view_name:
            C.field("Drawn in view", i.view_name)
        if i.level and not i.is3d:
            C.field("Level", i.level)
        if i.element:
            C.field("Element", i.element)
        if i.markup:
            C.field("Markup", i.markup)
        C.field("Position", "exact model position known" if i.model_mm
                else "sheet only (no model position)")
        if i.dismissed:
            C.field("Not an issue", i.dismissed, color=(180, 83, 9))
        if i.description or (i.is_comment and i.text):
            C.heading("Description")
            C.para(i.description or i.text)
        if i.pictures:
            C.heading("Picture%s (%d)" % ("s" if len(i.pictures) > 1 else "", len(i.pictures)))
            self.pic_row = C.pictures(len(i.pictures))
            self.load_pictures(i)
        live = [c for c in i.comments if isinstance(c, dict) and not c.get("deleted")]
        open_q = len([c for c in live if c.get("kind") == "query" and not c.get("resolved")])
        C.heading("Discussion (%d)%s" % (len(live), ("  -  %d open quer%s" % (open_q, "y" if open_q == 1 else "ies")) if open_q else ""))
        if not live:
            C.para("No comments yet. Type one below and send it to the viewer.", grey=True)
        for c, depth in thread_order(live):
            C.comment(c.get("author") or "?", L.short_date(c.get("at")), c.get("text") or "",
                      from_revit=(c.get("from") == "revit"), depth=depth,
                      query=("answered" if c.get("resolved") else "open") if c.get("kind") == "query" else None,
                      answered_by=c.get("resolved_by") or "")

    def fill_replyto(self, i):
        """The messages a reply can answer; open queries first in the list."""
        self.replyto.Items.Clear()
        self.reply_keys = [None]
        self.replyto.Items.Add("(new message)")
        live = [c for c in (i.comments or []) if isinstance(c, dict) and not c.get("deleted")]
        for c, depth in thread_order(live):
            t = (c.get("text") or "").replace("\n", " ")
            if len(t) > 60:
                t = t[:57] + "..."
            tag = ""
            if c.get("kind") == "query":
                tag = "[answered] " if c.get("resolved") else "[QUERY] "
            self.replyto.Items.Add(u"%s%s%s: %s" % ("   " * depth, tag, c.get("author") or "?", t))
            self.reply_keys.append((L.comment_key(c), c))
        self.replyto.SelectedIndex = 0
        self.replyto.IsEnabled = not i.is_comment and len(self.reply_keys) > 1
        self.on_replyto()

    def reply_target(self):
        k = self.replyto.SelectedIndex
        if k is None or k < 1 or k >= len(self.reply_keys):
            return None, None
        return self.reply_keys[k]

    def on_replyto(self):
        key, c = self.reply_target()
        self.answered.IsEnabled = bool(c and c.get("kind") == "query" and not c.get("resolved"))

    def on_answered(self, sender, args):
        i = self.current()
        key, c = self.reply_target()
        if i is None or i.is_comment or not c or c.get("kind") != "query":
            self.say("Choose a query in 'In reply to' first.")
            return
        me = ((self.me or {}).get("user") or {}).get("name") or ""
        pid, client = self.pid(), self.client
        item = L.updated_item(i, author=me, answered=key)

        def done(saved):
            for k, it in enumerate(self.raw_items):
                if it.get("id") == saved.get("id"):
                    self.raw_items[k] = saved
            self.rebuild()
            self.say("Query marked answered on %s." % i.tag)
        self.background(lambda: client.put_item(pid, item), done, "Marking the query answered")

    def load_pictures(self, i):
        import tempfile
        folder = os.path.join(tempfile.gettempdir(), "lwk_issues")
        if not os.path.isdir(folder):
            os.makedirs(folder)
        client, sel = self.client, i.id
        want = list(i.pictures)

        def work():
            out = []
            for path in want:
                local = self.pics.get(path)
                if not local or not os.path.exists(local):
                    local = os.path.join(folder, path.strip("/").replace("/", "_"))
                    if not os.path.exists(local):
                        client.download(path, local)
                    self.pics[path] = local
                out.append(local)
            return out

        def done(files):
            cur = self.current()
            if cur is None or cur.id != sel:
                return                     # another issue was chosen meanwhile
            Card(self.card).fill_pictures(self.pic_row, files)
            self.say("")
        self.background(work, done, "Fetching the picture")

    # ------------------------------------------------------------ go to
    def go(self, plan=False):
        i = self.current()
        if not i:
            self.say("Choose an issue in the list first.")
            return
        user = (((self.me or {}).get("user") or {}).get("name")) or ""
        self.run(lambda uiapp: go_to(uiapp, i, plan, user, self.say))

    def on_browser(self, sender, args):
        i = self.current()
        if not i:
            self.say("Choose an issue in the list first.")
            return
        client, pid = self.client, self.pid()
        url = L.web_url(client.base, pid, i)

        def done(how):
            if how == "page":
                self.say("%s shown in the viewer page you have open." % i.tag)
            else:
                self.say("Opened in your browser (sign in there if it asks). Next time the same "
                         "page is reused while it stays open.")

        def failed_copy():
            try:
                from System.Windows import Clipboard
                Clipboard.SetText(url)
            except Exception:
                pass
        try:
            self.background(lambda: L.show_in_viewer(client, pid, i), done,
                            "Showing %s in the viewer" % i.tag)
        except Exception as ex:
            failed_copy()
            self.say("%s - link copied, paste it into the browser: %s" % (ex, url))

    # ------------------------------------------------------------ pins
    def on_pin(self, sender, args):
        rows = list(self.shown)
        if not rows:
            self.say("No issues in the list to pin.")
            return

        def job(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            t = Transaction(doc, "LWK Issues - place pins")
            t.Start()
            try:
                placed, skipped = L.place_markers(doc, rows)
                t.Commit()
            except Exception:
                t.RollBack()
                raise
            note = " (%d have no model position: sheet-only markups)" % skipped if skipped else ""
            if doc.IsWorkshared:
                where = "on workset '%s'" % L.WORKSET
            else:
                # no worksets in a model that is not workshared: the view
                # filter is the handle instead
                t2 = Transaction(doc, "LWK Issues - pin filter")
                t2.Start()
                ok = L.show_pins_filter(doc, uiapp.ActiveUIDocument.ActiveView, True)
                t2.Commit()
                where = ("- the model is not workshared, so no workset; they are picked out by "
                         "the view filter '%s'%s" % (L.FILTER, " (added to this view)" if ok else ""))
            self.say("%d pins placed %s%s." % (placed, where, note))
        self.run(job)

    def on_clouds(self, sender, args):
        rows = [i for i in self.shown if not i.is3d and i.sheet]
        if not rows:
            self.say("No sheet issues or comments in the list.")
            return

        def job(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            t = Transaction(doc, "LWK Issues - revision clouds")
            t.Start()
            try:
                placed, skipped = L.place_clouds(doc, rows)
                t.Commit()
            except Exception:
                t.RollBack()
                raise
            note = " (%d on sheets not in this model)" % skipped if skipped else ""
            self.say("%d clouds placed under revision '%s'%s." % (placed, L.REVISION, note))
        self.run(job)

    def on_unclouds(self, sender, args):
        def job(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            t = Transaction(doc, "LWK Issues - remove clouds")
            t.Start()
            n = L.remove_clouds(doc)
            t.Commit()
            self.say("%d clouds removed." % n)
        self.run(job)

    def on_send(self, sender, args):
        i = self.current()
        if i is None or i.is_comment:
            self.say("Choose an issue in the list first.")
            return
        sel = self.newstatus.SelectedItem
        status = sel.Content if sel is not None else None
        text = (self.reply.Text or "").strip()
        if (not status or status == i.status) and not text:
            self.say("Change the status or type a comment first.")
            return
        me = ((self.me or {}).get("user") or {}).get("name") or ""
        pid, client = self.pid(), self.client
        key, target = self.reply_target()
        query = bool(self.asquery.IsChecked)
        item = L.updated_item(i, status=status, comment=text, author=me,
                              reply_to=key if text else None, query=query and bool(text))

        def done(saved):
            self.reply.Text = ""
            self.asquery.IsChecked = False
            for k, it in enumerate(self.raw_items):
                if it.get("id") == saved.get("id"):
                    self.raw_items[k] = saved
            self.rebuild()
            self.say("%s saved in the viewer%s." % (i.tag, (" - now " + status) if status and status != i.status else ""))
        self.background(lambda: client.put_item(pid, item), done, "Sending %s to the viewer" % i.tag)

    def on_pintoggle(self, sender, args):
        def job(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            view = uiapp.ActiveUIDocument.ActiveView
            t = Transaction(doc, "LWK Issues - show/hide pins")
            t.Start()
            try:
                f = L.pin_filter(doc)
                vis = True
                if f is not None and view.IsFilterApplied(f.Id):
                    vis = not view.GetFilterVisibility(f.Id)
                ok = L.show_pins_filter(doc, view, vis)
                t.Commit()
            except Exception:
                t.RollBack()
                raise
            self.say(("Pins %s in '%s'." % ("shown" if vis else "hidden", view.Name)) if ok
                     else "This view cannot take filters (a sheet or schedule): open a plan or 3D view.")
        self.run(job)

    def on_cloudtoggle(self, sender, args):
        def job(uiapp):
            from Autodesk.Revit.DB import RevisionVisibility
            doc = uiapp.ActiveUIDocument.Document
            rev = L._revision(doc, create=False)
            if rev is None:
                self.say("No LWK clouds yet - place them first.")
                return
            t = Transaction(doc, "LWK Issues - show/hide clouds")
            t.Start()
            hidden = rev.Visibility == RevisionVisibility.Hidden
            rev.Visibility = RevisionVisibility.CloudAndTagVisible if hidden else RevisionVisibility.Hidden
            t.Commit()
            self.say("LWK clouds %s on every sheet." % ("shown" if hidden else "hidden"))
        self.run(job)

    def on_unpin(self, sender, args):
        def job(uiapp):
            doc = uiapp.ActiveUIDocument.Document
            t = Transaction(doc, "LWK Issues - remove pins")
            t.Start()
            n = L.remove_markers(doc)
            t.Commit()
            self.say("%d pins removed." % n)
        self.run(job)


def _brush(rgb):
    from System.Windows.Media import SolidColorBrush, Color
    r, g, b = rgb
    return SolidColorBrush(Color.FromRgb(r, g, b))


def thread_order(comments):
    """(comment, depth) with every reply straight under the message it
    answers - the same order as the viewer's discussion."""
    keys = {}
    for k, c in enumerate(comments):
        keys[L.comment_key(c, k)] = c
    kids, top = {}, []
    for k, c in enumerate(comments):
        p = c.get("reply_to")
        if p and p in keys and keys[p] is not c:
            kids.setdefault(p, []).append(c)
        else:
            top.append(c)
    out, seen = [], set()

    def walk(c, d):
        if id(c) in seen:
            return
        seen.add(id(c))
        out.append((c, d))
        for r in kids.get(L.comment_key(c), []):
            walk(r, d + 1)
    for c in top:
        walk(c, 0)
    return out


class Card(object):
    """The detail panel, built from plain WPF controls."""

    GREY = (107, 114, 128)
    DARK = (31, 41, 55)

    def __init__(self, panel):
        self.p = panel

    def clear(self):
        self.p.Children.Clear()

    def _tb(self, text, size=12, bold=False, rgb=None, top=0, wrap=True):
        from System.Windows.Controls import TextBlock
        from System.Windows import Thickness, TextWrapping, FontWeights
        t = TextBlock()
        t.Text = text or ""
        t.FontSize = size
        if bold:
            t.FontWeight = FontWeights.SemiBold
        t.Foreground = _brush(rgb or self.DARK)
        if wrap:
            t.TextWrapping = TextWrapping.Wrap
        t.Margin = Thickness(0, top, 0, 0)
        return t

    def title(self, text):
        self.p.Children.Add(self._tb(text, size=15, bold=True))

    def chips(self, items):
        from System.Windows.Controls import WrapPanel, Border
        from System.Windows import Thickness, CornerRadius
        row = WrapPanel()
        row.Margin = Thickness(0, 6, 0, 4)
        for text, rgb in items:
            if not text:
                continue
            b = Border()
            b.Background = _brush(rgb)
            b.CornerRadius = CornerRadius(9)
            b.Padding = Thickness(8, 1, 8, 2)
            b.Margin = Thickness(0, 0, 6, 4)
            b.Child = self._tb(text, size=11, rgb=(255, 255, 255), wrap=False)
            row.Children.Add(b)
        self.p.Children.Add(row)

    def field(self, label, value, color=None):
        from System.Windows.Controls import Grid, ColumnDefinition
        from System.Windows import GridLength, GridUnitType, Thickness
        g = Grid()
        g.Margin = Thickness(0, 2, 0, 0)
        c0, c1 = ColumnDefinition(), ColumnDefinition()
        c0.Width = GridLength(96)
        c1.Width = GridLength(1, GridUnitType.Star)
        g.ColumnDefinitions.Add(c0)
        g.ColumnDefinitions.Add(c1)
        a = self._tb(label, rgb=self.GREY)
        b = self._tb(value, rgb=color or self.DARK)
        Grid.SetColumn(b, 1)
        g.Children.Add(a)
        g.Children.Add(b)
        self.p.Children.Add(g)

    def heading(self, text):
        self.p.Children.Add(self._tb(text, size=12, bold=True, rgb=(242, 128, 34), top=12))

    def para(self, text, grey=False):
        self.p.Children.Add(self._tb(text, rgb=self.GREY if grey else self.DARK, top=3))

    def comment(self, who, when, text, from_revit=False, depth=0, query=None, answered_by=""):
        from System.Windows.Controls import Border, StackPanel
        from System.Windows import Thickness
        b = Border()
        rule = (229, 231, 235)
        if query == "open":
            rule = (217, 119, 6)
        elif query == "answered":
            rule = (22, 163, 74)
        b.BorderBrush = _brush(rule)
        b.BorderThickness = Thickness(3, 0, 0, 0)
        b.Padding = Thickness(8, 2, 0, 2)
        b.Margin = Thickness(18 * min(depth, 4), 6, 0, 0)
        sp = StackPanel()
        head = u"%s%s  \u00b7  %s%s" % (u"\u21b3 " if depth else u"", who, when, "  (from Revit)" if from_revit else "")
        sp.Children.Add(self._tb(head, size=11, bold=True, rgb=self.GREY))
        if query == "open":
            sp.Children.Add(self._tb(u"QUERY - waiting for an answer", size=10, bold=True, rgb=rule))
        elif query == "answered":
            sp.Children.Add(self._tb(u"Query answered%s" % ((" - marked by " + answered_by) if answered_by else ""),
                                     size=10, bold=True, rgb=rule))
        sp.Children.Add(self._tb(text, top=1))
        b.Child = sp
        self.p.Children.Add(b)

    def pictures(self, n):
        from System.Windows.Controls import StackPanel
        sp = StackPanel()
        sp.Children.Add(self._tb("loading %d picture%s ..." % (n, "s" if n > 1 else ""), rgb=self.GREY, top=3))
        self.p.Children.Add(sp)
        return sp

    def fill_pictures(self, row, files):
        from System.Windows.Controls import Image, Button
        from System.Windows.Media.Imaging import BitmapImage, BitmapCacheOption
        from System.Windows import Thickness
        from System import Uri
        row.Children.Clear()
        for f in files:
            try:
                bmp = BitmapImage()
                bmp.BeginInit()
                bmp.CacheOption = BitmapCacheOption.OnLoad     # file not kept locked
                bmp.UriSource = Uri(f)
                bmp.DecodePixelWidth = 900
                bmp.EndInit()
                img = Image()
                img.Source = bmp
                img.MaxHeight = 320
                img.Margin = Thickness(0, 4, 0, 0)
                btn = Button()
                btn.Content = img
                btn.Padding = Thickness(0)
                btn.BorderThickness = Thickness(0)
                btn.Background = _brush((252, 252, 253))
                btn.ToolTip = "Open full size"
                btn.Click += (lambda path: (lambda s, e: L.open_url(path)))(f)
                row.Children.Add(btn)
            except Exception as ex:
                row.Children.Add(self._tb("picture could not be shown: %s" % ex, rgb=self.GREY))


class ProjectItem(object):
    def __init__(self, p):
        self.id = p.get("id")
        self.title = p.get("title") or self.id

    def ToString(self):
        return self.title

    def __str__(self):
        return self.title


def doc_title():
    try:
        return __revit__.ActiveUIDocument.Document.Title
    except Exception:
        return ""


def go_to(uiapp, i, plan, user, say):
    uidoc = uiapp.ActiveUIDocument
    doc = uidoc.Document
    if i.is3d:
        if not i.model_mm:
            say("This issue has no model position.")
            return
        p = L._xyz(i.model_mm)
        t = Transaction(doc, "LWK Issues - go to #%d" % i.number)
        t.Start()
        # seen through a camera (walking, or the viewer's usual perspective):
        # a perspective view from the same eye, not an isometric one - from an
        # eye inside the building that showed the whole building from outside
        camera = L.wants_perspective(i.viewpoint)
        try:
            view = L.issue_view(doc, user, camera)
        except Exception:
            camera = False
            view = L.issue_view(doc, user)
        # as the author saw it (their camera and section box), else a box
        # round the point
        seen = None
        try:
            seen = L.viewpoint_view(view, i.viewpoint, p)
        except Exception:
            seen = None
        if seen is None:
            if view.IsPerspective:
                # no camera after all: the boxed isometric view
                view = L.issue_view(doc, user)
            L.box_view(view, p)
        t.Commit()
        uidoc.ActiveView = view
        if seen == "camera":
            pass           # the eye is the view; zooming would move it
        elif seen is not None:
            L.zoom(uidoc, view, seen[0], seen[1])
        else:
            h = 3000.0 / L.FT_MM
            L.zoom(uidoc, view, XYZ(p.X - h, p.Y - h, p.Z - h), XYZ(p.X + h, p.Y + h, p.Z + h))
        el = L.element_by_ifc_guid(doc, i.ifc_guid)
        if el is not None:
            ids = List[ElementId]()
            ids.Add(el.Id)
            uidoc.Selection.SetElementIds(ids)
        what = ("camera view from where it was raised%s" % (" (walking)" if (i.viewpoint or {}).get("walk") else "")
                if seen == "camera" else "3D view as it was raised (camera and section box)" if seen is not None
                else "3D view boxed round the point")
        say("#%d: %s%s." % (i.number, what, ", element selected" if el is not None else ""))
        return

    if plan:
        view = doc.GetElement(ElementId(int(i.view_id))) if i.view_id else None
        if view is None:
            say("The view '%s' is not in this model." % (i.view_name or i.view_id))
            return
        uidoc.ActiveView = view
        if i.model_mm:
            p = L._xyz(i.model_mm)
            h = 4000.0 / L.FT_MM
            L.zoom(uidoc, view, XYZ(p.X - h, p.Y - h, p.Z), XYZ(p.X + h, p.Y + h, p.Z))
        say("#%d: opened %s at the spot." % (i.number, view.Name))
        return

    sheet = L.find_sheet(doc, i.sheet)
    if sheet is None:
        say("Sheet %s is not in this model." % i.sheet)
        return
    uidoc.ActiveView = sheet
    lo, hi = L.sheet_rect(doc, sheet, i.points_mm)
    L.zoom(uidoc, sheet, lo, hi)
    say("#%d: sheet %s, zoomed onto the markup." % (i.number, i.sheet))


handler = Handler()
event = ExternalEvent.Create(handler)
IssuesWindow(handler, event).show(modal=False)
