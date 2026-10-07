# -*- coding: utf-8 -*-
"""Auto Publish - set up and review the automatic publishing to the LWK
Viewer without opening a model.

  * This PC's models: what each sends, where to, night export on / off.
  * Add a model from the ACC models this PC has opened before (read from
    Revit's local copies - nothing is opened), change one, remove one.
  * The night schedule of this PC, with two buttons to find out why a
    night did not run: Check setup (a checklist, nothing is exported) and
    Test night run (the real thing, now).
  * Everyone's auto-publish settings, from the viewer server: a model that
    is published at night from two places is marked, and adding a second
    night export for a model asks first.

Works from Revit's home screen (no document needed)."""
__title__ = "Auto\nPublish"
__author__ = "LWK BIM"
__context__ = "zero-doc"

import os
import sys
import io

import clr
clr.AddReference("System.Data")
from System.Data import DataTable
from pyrevit import forms, script, HOST_APP


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

from lwk_viewer import batch, publish, nightly, autopub
from lwk_viewer import issues as LI

out = script.get_output()

XAML = u"""
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Auto Publish - LWK Viewer" Width="1060" Height="760" MinWidth="820" MinHeight="560"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI" FontSize="12">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Padding" Value="10,4"/><Setter Property="Margin" Value="0,0,6,0"/>
      <Setter Property="Background" Value="#FFFFFF"/><Setter Property="BorderBrush" Value="#F2A15E"/>
    </Style>
    <Style TargetType="GroupBox"><Setter Property="Margin" Value="0,0,0,8"/><Setter Property="Padding" Value="8,6,8,8"/></Style>
  </Window.Resources>
  <DockPanel Margin="10">
    <Border DockPanel.Dock="Top" Background="#F28022" CornerRadius="6" Padding="10,6" Margin="0,0,0,8">
      <DockPanel>
        <TextBlock Text="Auto Publish" Foreground="White" FontWeight="Bold" FontSize="14" VerticalAlignment="Center"/>
        <Button x:Name="signin" Content="Sign in ..." DockPanel.Dock="Right" Margin="8,0,0,0"/>
        <TextBlock x:Name="server_text" Foreground="White" Margin="12,0,0,0" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
      </DockPanel>
    </Border>

    <DockPanel DockPanel.Dock="Bottom" Margin="0,4,0,0">
      <Button x:Name="close_btn" Content="Close" DockPanel.Dock="Right" Width="90" Margin="0" IsCancel="True"/>
      <TextBlock x:Name="msg" Foreground="#B45309" TextWrapping="Wrap" VerticalAlignment="Center"/>
    </DockPanel>

    <GroupBox DockPanel.Dock="Top" Header="Models published from this PC (no model has to be open)">
      <DockPanel>
        <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" Margin="0,8,0,0">
          <Button x:Name="add" Content="Add a model ..." FontWeight="Bold"
                  ToolTip="Choose from the ACC models this PC has opened before - the model is not opened"/>
          <Button x:Name="change" Content="Change ..." ToolTip="What it sends, where to, night export (double-click a row does the same)"/>
          <Button x:Name="toggle" Content="Night export on / off"/>
          <Button x:Name="runnow" Content="Publish now ..." ToolTip="Opens the chosen model from ACC, publishes it and closes it without saving - takes as long as a normal publish"/>
          <Button x:Name="folder" Content="Open export folder"/>
          <Button x:Name="remove" Content="Remove"/>
        </StackPanel>
        <DataGrid x:Name="jobs" Height="170" AutoGenerateColumns="False" IsReadOnly="True" SelectionMode="Single"
                  HeadersVisibility="Column" GridLinesVisibility="Horizontal" RowHeight="24"
                  HorizontalGridLinesBrush="#EEE" BorderBrush="#DDD" CanUserAddRows="False">
          <DataGrid.RowStyle>
            <Style TargetType="DataGridRow">
              <Style.Triggers>
                <DataTrigger Binding="{Binding Dup}" Value="yes"><Setter Property="Background" Value="#FEE2E2"/></DataTrigger>
              </Style.Triggers>
            </Style>
          </DataGrid.RowStyle>
          <DataGrid.Columns>
            <DataGridTextColumn Header="Night" Binding="{Binding Night}" Width="50"/>
            <DataGridTextColumn Header="Revit file" Binding="{Binding Title}" Width="2*"/>
            <DataGridTextColumn Header="Revit" Binding="{Binding Revit}" Width="82"/>
            <DataGridTextColumn Header="Viewer project" Binding="{Binding Project}" Width="1.4*"/>
            <DataGridTextColumn Header="Sheets" Binding="{Binding Sheets}" Width="1.1*"/>
            <DataGridTextColumn Header="3D" Binding="{Binding Model}" Width="90"/>
            <DataGridTextColumn Header="Last run here" Binding="{Binding Last}" Width="1.2*"/>
            <DataGridTextColumn Header="Also at night elsewhere" Binding="{Binding Others}" Width="1.6*"/>
          </DataGrid.Columns>
        </DataGrid>
      </DockPanel>
    </GroupBox>

    <GroupBox DockPanel.Dock="Top" Header="Night export on this PC">
      <StackPanel>
        <StackPanel Orientation="Horizontal">
          <TextBlock Text="Every night at" VerticalAlignment="Center" Margin="0,0,6,0"/>
          <TextBox x:Name="night_time" Width="52" Text="01:00" Margin="0,0,10,0"/>
          <CheckBox x:Name="weekdays" Content="Mon-Fri only" VerticalAlignment="Center" Margin="0,0,12,0"/>
          <Button x:Name="set_sched" Content="Set schedule"/>
          <Button x:Name="del_sched" Content="Remove schedule" Margin="0,0,24,0"/>
          <Button x:Name="check_btn" Content="Check setup" FontWeight="Bold"
                  ToolTip="Goes through everything the night export needs - the schedule, each Revit version, pyRevit, each model, the viewer server - and says what is wrong. Nothing is exported."/>
          <Button x:Name="test_btn" Content="Test night run ..."
                  ToolTip="Runs the night export now, exactly as at night: the right Revit starts, publishes the chosen model(s) and closes. Proves the whole chain."/>
        </StackPanel>
        <TextBlock x:Name="sched_text" Foreground="#555" TextWrapping="Wrap" Margin="0,6,0,0"/>
      </StackPanel>
    </GroupBox>

    <GroupBox Header="Everyone's auto publish - as reported to the viewer server (red: the same model is published at night from more than one place)">
      <DockPanel>
        <StackPanel DockPanel.Dock="Bottom" Orientation="Horizontal" Margin="0,8,0,0">
          <Button x:Name="refresh" Content="Refresh"/>
          <Button x:Name="forget" Content="Take off the list" ToolTip="For an entry that is no longer true (a PC that was replaced, a job removed by hand). A PC that still has the job reports it again."/>
          <TextBlock x:Name="all_note" Foreground="#6B7280" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
        </StackPanel>
        <DataGrid x:Name="everyone" AutoGenerateColumns="False" IsReadOnly="True" SelectionMode="Single"
                  HeadersVisibility="Column" GridLinesVisibility="Horizontal" RowHeight="24"
                  HorizontalGridLinesBrush="#EEE" BorderBrush="#DDD" CanUserAddRows="False">
          <DataGrid.RowStyle>
            <Style TargetType="DataGridRow">
              <Style.Triggers>
                <DataTrigger Binding="{Binding Dup}" Value="yes"><Setter Property="Background" Value="#FEE2E2"/></DataTrigger>
              </Style.Triggers>
            </Style>
          </DataGrid.RowStyle>
          <DataGrid.Columns>
            <DataGridTextColumn Header="Viewer project" Binding="{Binding Project}" Width="1.3*"/>
            <DataGridTextColumn Header="Revit file" Binding="{Binding Title}" Width="1.8*"/>
            <DataGridTextColumn Header="PC / Windows user" Binding="{Binding Pc}" Width="1.2*"/>
            <DataGridTextColumn Header="Set by" Binding="{Binding By}" Width="1*"/>
            <DataGridTextColumn Header="Night" Binding="{Binding Night}" Width="110"/>
            <DataGridTextColumn Header="Sends" Binding="{Binding Sends}" Width="1.5*"/>
            <DataGridTextColumn Header="Last run" Binding="{Binding Last}" Width="1*"/>
            <DataGridTextColumn Header="Note" Binding="{Binding Note}" Width="1*"/>
          </DataGrid.Columns>
        </DataGrid>
      </DockPanel>
    </GroupBox>
  </DockPanel>
</Window>
"""

JOB_XAML = u"""
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Publish settings" Width="600" SizeToContent="Height"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize" FontFamily="Segoe UI" FontSize="12.5">
  <Window.Resources>
    <Style TargetType="CheckBox"><Setter Property="Margin" Value="0,4,0,2"/></Style>
    <Style TargetType="RadioButton"><Setter Property="Margin" Value="18,3,0,1"/></Style>
    <Style TargetType="TextBlock"><Setter Property="VerticalAlignment" Value="Center"/></Style>
    <Style TargetType="GroupBox"><Setter Property="Margin" Value="0,0,0,10"/><Setter Property="Padding" Value="8,6,8,8"/></Style>
  </Window.Resources>
  <StackPanel Margin="14">
    <TextBlock x:Name="head" FontSize="15" FontWeight="Bold" Margin="0,0,0,2" TextWrapping="Wrap"/>
    <TextBlock x:Name="sub" Foreground="#666" TextWrapping="Wrap" Margin="0,0,0,10"/>
    <GroupBox Header="Where">
      <Grid>
        <Grid.ColumnDefinitions><ColumnDefinition Width="110"/><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
        <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
        <TextBlock Text="Revit file"/>
        <TextBox x:Name="title_box" Grid.Column="1" Margin="0,2" ToolTip="The model's name, as it shows in the lists"/>
        <TextBlock Grid.Row="1" Text="Viewer project"/>
        <ComboBox x:Name="project_box" Grid.Row="1" Grid.Column="1" IsEditable="True" Margin="0,2"
          ToolTip="The project on the viewer server"/>
        <TextBlock Grid.Row="2" Text="Export folder"/>
        <TextBox x:Name="folder_box" Grid.Row="2" Grid.Column="1" Margin="0,2"/>
        <Button x:Name="browse" Grid.Row="2" Grid.Column="2" Content="..." Padding="8,1" Margin="6,2,0,2"/>
        <TextBlock Grid.Row="3" Text="ACC region"/>
        <ComboBox x:Name="region_box" Grid.Row="3" Grid.Column="1" Margin="0,2" Width="120" HorizontalAlignment="Left"
          ToolTip="The region of your ACC account - the same for every model of the office"/>
        <TextBlock Grid.Row="4" Text="Revit version"/>
        <ComboBox x:Name="revit_box" Grid.Row="4" Grid.Column="1" Margin="0,2" Width="260" HorizontalAlignment="Left"
          ToolTip="The Revit version the model is saved in. At night that Revit is started for it: a cloud model opens only in its own version."/>
        <TextBlock x:Name="revit_note" Grid.Row="5" Grid.Column="1" Grid.ColumnSpan="2" Foreground="#888" FontSize="11"
          TextWrapping="Wrap" Margin="0,0,0,2"/>
      </Grid>
    </GroupBox>
    <GroupBox Header="What">
      <StackPanel>
        <StackPanel Orientation="Horizontal">
          <CheckBox x:Name="do3d" Content="3D model (fast format, with its linked models)"/>
          <ComboBox x:Name="detail_box" Width="150" Margin="12,0,0,0" SelectedIndex="1">
            <ComboBoxItem Content="Coarse (lightest)"/>
            <ComboBoxItem Content="Medium (recommended)"/>
            <ComboBoxItem Content="Fine (most detail)"/>
          </ComboBox>
        </StackPanel>
        <CheckBox x:Name="dosheets" Content="Sheets (PDF, with their views mapped to the model)" Margin="0,10,0,2"/>
        <RadioButton x:Name="sheets_all" Content="All sheets" GroupName="sheets"/>
        <StackPanel Orientation="Horizontal">
          <RadioButton x:Name="sheets_set" Content="A Revit sheet set, named:" GroupName="sheets"/>
          <TextBox x:Name="set_box" Width="220" Margin="10,1,0,0" ToolTip="The name of the View/Sheet Set, exactly as in Revit's Print window (read when the model is published)"/>
        </StackPanel>
        <RadioButton x:Name="sheets_list" GroupName="sheets"/>
        <CheckBox x:Name="keep_others" Margin="18,6,0,0" Content="Keep sheets published before that are not in this choice"/>
        <CheckBox x:Name="as_part" Margin="0,8,0,0" Content="This file adds its sheets to a project published from another Revit file"/>
      </StackPanel>
    </GroupBox>
    <GroupBox Header="Then">
      <StackPanel>
        <CheckBox x:Name="upload" Content="Send to the viewer server (only what changed)"/>
        <CheckBox x:Name="night" Content="Publish this model every night (this PC's night export)"/>
        <TextBlock x:Name="night_note" Foreground="#888" FontSize="11" TextWrapping="Wrap" Margin="20,2,0,0"/>
      </StackPanel>
    </GroupBox>
    <DockPanel LastChildFill="False">
      <TextBlock x:Name="status" Foreground="#B45309" TextWrapping="Wrap" Width="330" DockPanel.Dock="Left"/>
      <Button x:Name="cancel" Content="Cancel" Width="80" Margin="8,0,0,0" DockPanel.Dock="Right" IsCancel="True"/>
      <Button x:Name="ok" Content="Save settings" Width="110" FontWeight="Bold" DockPanel.Dock="Right" IsDefault="True"/>
    </DockPanel>
  </StackPanel>
</Window>
"""

CHECK_XAML = u"""
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Check setup - night export" Width="940" Height="680" MinWidth="560" MinHeight="320"
        WindowStartupLocation="CenterScreen" FontFamily="Segoe UI" FontSize="12">
  <DockPanel Margin="10">
    <DockPanel DockPanel.Dock="Bottom" Margin="0,8,0,0" LastChildFill="True">
      <Button x:Name="check_close" Content="Close" Width="90" DockPanel.Dock="Right" IsCancel="True" IsDefault="True"/>
      <Button x:Name="check_copy" Content="Copy" Width="90" Margin="0,0,8,0" DockPanel.Dock="Right"
              ToolTip="Copies the whole list, to paste into an email"/>
      <TextBlock x:Name="check_result" FontWeight="Bold" VerticalAlignment="Center" TextWrapping="Wrap"/>
    </DockPanel>
    <TextBox x:Name="check_box" IsReadOnly="True" TextWrapping="Wrap" AcceptsReturn="True"
             VerticalScrollBarVisibility="Auto" FontFamily="Consolas" FontSize="12" Padding="8"
             BorderBrush="#DDD" Background="#FAFAFA"/>
  </DockPanel>
</Window>
"""


def ask_password(title, prompt):
    """A small password box (the text is not shown)."""
    clr.AddReference("System.Windows.Forms")
    import System.Windows.Forms as WF
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


def last_run(job):
    """'12 Sep 01:14 - ok' from the job's export-log.txt, or ''."""
    p = os.path.join(job.get("folder") or "", "export-log.txt")
    if not os.path.isfile(p):
        return ""
    try:
        import datetime
        when = datetime.datetime.fromtimestamp(os.path.getmtime(p)).strftime("%d %b %H:%M")
        with io.open(p, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        errs = len([l for l in lines if l.startswith("error")])
        return "%s - %s" % (when, ("%d error(s)" % errs) if errs else "ok")
    except Exception:
        return ""


def short_when(iso):
    try:
        import datetime
        d = datetime.datetime.strptime((iso or "")[:19], "%Y-%m-%dT%H:%M:%S")
        return d.strftime("%d %b %H:%M") + " UTC"
    except Exception:
        return ""


class JobDialog(forms.WPFWindow):
    """One model's settings. `job` is changed only when Save is pressed."""

    def __init__(self, job, projects, is_new):
        forms.WPFWindow.__init__(self, JOB_XAML, literal_string=True)
        self.job = job
        self.saved = False
        self.head.Text = ("Add: " if is_new else "") + (job.get("title") or "?")
        self.sub.Text = ("The model is not opened: these settings are used the next time it is published "
                         "(at night, or with Publish now).")
        self.title_box.Text = job.get("title") or ""
        for n in projects:
            self.project_box.Items.Add(n)
        self.project_box.Text = job.get("upload_project") or publish.safe_project(job.get("title") or "")
        self.folder_box.Text = job.get("folder") or ""
        regs = batch.regions()
        if job.get("region") and job["region"] not in regs:
            regs.append(job["region"])
        for r in regs:
            self.region_box.Items.Add(r)
        self.region_box.SelectedItem = job.get("region") or regs[0]
        self.region_box.IsEnabled = bool(job.get("model"))
        self.fill_revit(job)
        self.do3d.IsChecked = job.get("publish_3d", True) is not False
        self.detail_box.SelectedIndex = {"coarse": 0, "medium": 1, "fine": 2}.get(job.get("fast3d_detail") or "medium", 1)
        self.dosheets.IsChecked = job.get("publish_sheets", True) is not False
        mode = job.get("sheet_mode") or ("prefix" if (job.get("sheet_prefix") or "").strip() else "all")
        n = len(job.get("sheet_numbers") or [])
        self.keep_mode = None
        if mode == "set":
            self.sheets_set.IsChecked = True
            self.set_box.Text = job.get("sheet_set") or ""
        elif mode in ("list", "prefix"):
            self.sheets_list.IsChecked = True
            self.keep_mode = mode
        else:
            self.sheets_all.IsChecked = True
        if mode == "list":
            self.sheets_list.Content = "The %d sheet(s) chosen before (to choose others, open the model and use Publish)" % n
        elif mode == "prefix":
            self.sheets_list.Content = "Sheet numbers starting %s (as set before)" % (job.get("sheet_prefix") or "")
        else:
            self.sheets_list.Content = "Chosen sheets (open the model and use Publish to choose them)"
            self.sheets_list.IsEnabled = False
        self.keep_others.IsChecked = job.get("keep_other_sheets", True) is not False
        self.as_part.IsChecked = bool(job.get("publish_part"))
        self.upload.IsChecked = job.get("upload", True) is not False
        cloud = bool(job.get("model"))
        self.night.IsEnabled = cloud
        self.night.IsChecked = bool(cloud and job.get("enabled"))
        self.night_note.Text = ("Revit opens the model from ACC at night, publishes it and closes it without saving "
                                "(PC on, Revit closed). The time is set in the Auto Publish window."
                                if cloud else "Only a model on ACC can be published at night.")
        self.browse.Click += self.on_browse
        self.ok.Click += self.on_ok
        self.cancel.Click += lambda s, e: self.Close()

    def fill_revit(self, job):
        """The Revit version: every version installed on this PC, plus the
        one the job has even if it is not installed here (kept, and said)."""
        self.installed = nightly.installed_revits()
        self.sched_year = nightly.schedule_year() or nightly.revit_year(HOST_APP.uiapp)
        # "" as the schedule's year: only what the job says or the local
        # copies show counts here - the rest is "not set"
        year, how = nightly.job_year(job, "", nightly.local_index())
        self.found_year = year if how == "cache" else ""
        years = sorted(set(self.installed) | (set([year]) if year else set()))
        self.revit_years = ([] if year else [""]) + years      # beside the combo's lines
        for y in self.revit_years:
            if not y:
                self.revit_box.Items.Add("not set")
            elif y in self.installed:
                self.revit_box.Items.Add("Revit %s" % y)
            else:
                self.revit_box.Items.Add("Revit %s  (not installed on this PC)" % y)
        self.revit_box.SelectedIndex = self.revit_years.index(year) if year in self.revit_years else 0
        self.revit_box.IsEnabled = bool(job.get("model"))
        self.revit_box.SelectionChanged += self.on_revit_pick
        self.on_revit_pick(None, None)

    def picked_year(self):
        i = self.revit_box.SelectedIndex
        return self.revit_years[i] if 0 <= i < len(self.revit_years) else ""

    def on_revit_pick(self, sender, args):
        if not self.job.get("model"):
            self.revit_note.Text = ""
            return
        y = self.picked_year()
        if not y:
            self.revit_note.Text = ("Not set: at night it is tried in Revit %s, the Revit the schedule was made from. "
                                    "Choose the version the model is saved in." % self.sched_year)
        elif y not in self.installed:
            self.revit_note.Text = ("Revit %s is not installed on this PC, so this model cannot be published at night "
                                    "from here. (The version is kept as it is unless you choose another.)" % y)
        elif not nightly.pyrevit_addin(y):
            self.revit_note.Text = ("pyRevit is not attached to Revit %s: at night it would start and do nothing. "
                                    "Attach pyRevit to it first (Check setup says how)." % y)
        elif y == self.found_year:
            self.revit_note.Text = ("Found from this PC's local copies: it has only been opened in Revit %s here. "
                                    "Saved with these settings." % y)
        else:
            self.revit_note.Text = ("At night Revit %s is started for this model. A cloud model opens only in the "
                                    "version it is saved in." % y)

    def on_browse(self, sender, args):
        f = forms.pick_folder(title="Export folder")
        if f:
            self.folder_box.Text = f

    def on_ok(self, sender, args):
        title = (self.title_box.Text or "").strip()
        if not title:
            self.status.Text = "Give the Revit file's name."
            return
        project = publish.safe_project(self.project_box.Text)
        if not (self.do3d.IsChecked or self.dosheets.IsChecked):
            self.status.Text = "Tick the 3D model, the sheets, or both."
            return
        j = dict(self.job)
        folder = (self.folder_box.Text or "").strip() or publish.default_folder(project)
        if self.as_part.IsChecked and os.path.normcase(folder) == os.path.normcase(publish.default_folder(project)):
            folder = publish.default_folder(project) + " - " + publish.safe_project(title)
        j.update({"title": title, "upload_project": project, "folder": folder,
                  "model_format": "lwkm",
                  "fast3d_detail": ["coarse", "medium", "fine"][max(0, self.detail_box.SelectedIndex)],
                  "publish_3d": bool(self.do3d.IsChecked), "publish_sheets": bool(self.dosheets.IsChecked),
                  "keep_other_sheets": bool(self.keep_others.IsChecked),
                  "publish_part": bool(self.as_part.IsChecked), "upload": bool(self.upload.IsChecked)})
        if j.get("model") and self.region_box.SelectedItem:
            j["region"] = str(self.region_box.SelectedItem)
        if j.get("model"):
            year = self.picked_year()
            if year:
                j["revit"] = year
            else:
                j.pop("revit", None)
        if self.sheets_set.IsChecked:
            name = (self.set_box.Text or "").strip()
            if not name:
                self.status.Text = "Type the sheet set's name."
                return
            for k in ("sheet_list", "sheet_numbers", "sheet_prefix"):
                j.pop(k, None)
            j["sheet_mode"], j["sheet_set"] = "set", name
        elif self.sheets_list.IsChecked and self.keep_mode:
            j["sheet_mode"] = self.keep_mode          # the list / prefix stays as it was
        else:
            for k in ("sheet_list", "sheet_numbers", "sheet_prefix", "sheet_set"):
                j.pop(k, None)
            j["sheet_mode"] = "all"
        want_night = bool(self.night.IsChecked) and bool(j.get("model"))
        if want_night and not self.job.get("enabled"):
            others, note = autopub.check(j)
            if others and not forms.alert(
                    "This model is ALREADY published at night by:\n\n%s\n\n"
                    "Two night exports of the same model overwrite each other on the viewer. "
                    "Switch the night export on here as well?"
                    % "\n".join("  - " + autopub.who_text(e) for e in others), yes=True, no=True):
                return
        j["enabled"] = want_night
        self.job.clear()
        self.job.update(j)
        self.saved = True
        self.Close()


class CheckWindow(forms.WPFWindow):
    """The checklist of Check setup: text that can be read, scrolled and
    copied. It only shows what autopub.check_setup() found."""

    def __init__(self, lines):
        forms.WPFWindow.__init__(self, CHECK_XAML, literal_string=True)
        self.check_lines = autopub.check_text(lines)
        self.check_box.Text = self.check_lines
        n = autopub.problems(lines)
        self.check_result.Text = ("%d problem%s to fix - look for the lines marked PROBLEM. Nothing was exported."
                                  % (n, "" if n == 1 else "s")) if n else \
            "No problem found in what can be checked. To prove the whole chain, use Test night run."
        self.check_close.Click += lambda s, e: self.Close()
        self.check_copy.Click += self.on_copy

    def on_copy(self, sender, args):
        try:
            from System.Windows import Clipboard
            Clipboard.SetText(self.check_lines)
            self.check_result.Text = "Copied."
        except Exception as ex:
            self.check_result.Text = "Could not copy: %s" % ex


class JobItem(forms.TemplateListItem):
    """A model in the Test night run checklist."""
    @property
    def name(self):
        j = self.item
        return "%s    (Revit %s, night export %s)" % (j.get("title") or "?", autopub.year_text(j, nightly.schedule_year(),
                                                                                                nightly.local_index()),
                                                      "ON" if j.get("enabled") else "off")


class AutoPublishWindow(forms.WPFWindow):

    def __init__(self):
        forms.WPFWindow.__init__(self, XAML, literal_string=True)
        self.jobs_list = batch.load_jobs()
        self.server_jobs = []
        self.projects = []
        self.run_job = None
        self.client = None
        self.signin.Click += self.on_signin
        self.close_btn.Click += lambda s, e: self.Close()
        self.add.Click += self.on_add
        self.change.Click += lambda s, e: self.on_change()
        self.jobs.MouseDoubleClick += lambda s, e: self.on_change()
        self.toggle.Click += self.on_toggle
        self.runnow.Click += self.on_runnow
        self.folder.Click += self.on_folder
        self.remove.Click += self.on_remove
        self.set_sched.Click += self.on_set_sched
        self.del_sched.Click += self.on_del_sched
        self.check_btn.Click += self.on_check
        self.test_btn.Click += self.on_test
        self.refresh.Click += lambda s, e: self.load_server(say=True)
        self.forget.Click += self.on_forget
        sch = nightly.saved_schedule()
        if sch.get("time"):
            self.night_time.Text = sch["time"]
            self.weekdays.IsChecked = bool(sch.get("weekdays"))
        self.connect()
        self.load_server()
        self.show_schedule()
        # A PC set up before the launcher knew about Revit versions: its
        # launcher is renewed here (the Windows task runs the same file, so
        # the schedule itself is untouched), and its list follows the jobs.
        try:
            renewed = nightly.ensure_launcher()
            if renewed:
                self.say(renewed[0][:1].upper() + renewed[0][1:] + ".")
                self.show_schedule()
        except Exception as ex:
            self.say("Could not bring the night launcher up to date: %s" % ex)

    # ------------------------------------------------------------ helpers
    def say(self, text):
        self.msg.Text = text or ""

    def connect(self):
        server, token = LI.upload_settings()
        self.client = LI.Client(server, token) if (server and token) else None
        self.server_text.Text = (server + ("   (signed in)" if token else "   (not signed in)")) if server \
            else "not signed in to the viewer server"
        self.signin.Content = "Change sign-in ..." if token else "Sign in ..."
        self.projects = []
        if self.client:
            try:
                self.projects = [p.get("id") for p in self.client.projects() if p.get("id")]
            except Exception as ex:
                self.say("Could not list the server's projects: %s" % ex)

    def on_signin(self, sender, args):
        st = LI.load_settings()
        server = forms.ask_for_string(default=st.get("server") or "https://", title="Viewer server",
                                      prompt="Address of the LWK Viewer server:")
        if not server:
            return
        email = forms.ask_for_string(default=st.get("email") or "", title="Viewer server", prompt="Your email:")
        if email is None:
            return
        pw = ask_password("Viewer server", "Password:")
        if pw is None:
            return
        try:
            c = LI.Client(server.strip(), "")
            c.login(email.strip(), pw)
            st.update({"server": c.base, "email": email.strip(), "token": c.token})
            LI.save_settings(st)
            self.say("Signed in.")
        except Exception as ex:
            self.say("Sign-in failed: %s" % ex)
        self.connect()
        self.load_server()

    def current(self):
        i = self.jobs.SelectedIndex
        return self.jobs_list[i] if 0 <= i < len(self.jobs_list) else None

    # ------------------------------------------------------------- lists
    def fill_jobs(self):
        keep = self.jobs.SelectedIndex
        t = DataTable()
        for c in ("Night", "Title", "Revit", "Project", "Sheets", "Model", "Last", "Others", "Dup"):
            t.Columns.Add(c)
        sched_year, index = nightly.schedule_year(), nightly.local_index()
        for j in self.jobs_list:
            sheets, model = autopub.describe(j)
            others = autopub.others_at_night(self.server_jobs, j)
            t.Rows.Add("ON" if j.get("enabled") else "off", j.get("title") or "?",
                       # "?" = not recorded: set it with Change (a model that is not on ACC has none)
                       autopub.year_text(j, sched_year, index) if j.get("model") else "-",
                       j.get("upload_project") or os.path.basename(os.path.normpath(j.get("folder") or "")),
                       sheets + (" (adds to project)" if j.get("publish_part") else ""), model, last_run(j),
                       "; ".join(autopub.who_text(e) for e in others),
                       "yes" if (others and j.get("enabled")) else "no")
        self.jobs.ItemsSource = t.DefaultView
        if 0 <= keep < len(self.jobs_list):
            self.jobs.SelectedIndex = keep

    def load_server(self, say=False):
        self.server_jobs = []
        note = ""
        if not self.client:
            note = "Sign in to see everyone's settings and to be warned about a model that is published twice."
        else:
            try:
                self.server_jobs = self.client.publish_jobs()
            except Exception as ex:
                note = "Could not read the list from the server: %s" % ex
        t = DataTable()
        for c in ("Project", "Title", "Pc", "By", "Night", "Sends", "Last", "Note", "Dup"):
            t.Columns.Add(c)
        dups = 0
        me = (os.environ.get("COMPUTERNAME", ""), os.environ.get("USERNAME", ""))
        for e in self.server_jobs:
            night = "off"
            if e.get("nightly"):
                night = "ON" + ((" " + e["night_time"]) if e.get("night_time") else "") + \
                        ((" " + e["night_days"]) if e.get("night_days") == "Mon-Fri" else "")
            last = short_when(e.get("last_run_at"))
            if last and e.get("last_ok") is False:
                last += " - errors"
            dup = bool(e.get("duplicate"))
            dups += 1 if dup else 0
            mine = ((e.get("pc") or ""), (e.get("user") or "")) == me
            t.Rows.Add(e.get("project") or "", e.get("source") or "",
                       "%s / %s" % (e.get("pc") or "?", e.get("user") or "?"),
                       e.get("saved_by") or e.get("last_by") or "",
                       night, ", ".join(x for x in (e.get("sheets"), e.get("model_3d")) if x), last,
                       ("PUBLISHED TWICE AT NIGHT" if dup else "") + (" (this PC)" if mine else ""),
                       "yes" if dup else "no")
        self.everyone.ItemsSource = t.DefaultView
        self.all_note.Text = note or ("%d setting(s) on the server%s" % (
            len(self.server_jobs), (" - %d in red: published at night from more than one place" % dups) if dups else ""))
        self.fill_jobs()
        if say and not note:
            self.say("List refreshed.")

    def show_schedule(self):
        exists, st = nightly.status()
        on = len([j for j in self.jobs_list if j.get("enabled")])
        if exists:
            # which Revit versions the launcher starts, in order
            p = nightly.plan(self.jobs_list, nightly.schedule_year() or nightly.revit_year(HOST_APP.uiapp),
                             nightly.local_index())
            order = ", then ".join("Revit %s (%d)" % (y, len(p[y])) for y in sorted(k for k in p if k))
            self.sched_text.Text = "Scheduled. %d model(s) have their night export ON%s.  %s" % (
                on, (": the launcher starts %s - one after the other" % order) if order else "", st.replace("\n", "   "))
        else:
            self.sched_text.Text = ("NOT scheduled on this PC - no model is published at night from here"
                                    + (" (although %d model(s) are switched ON: press Set schedule)." % on if on else "."))

    # ------------------------------------------------------------ saving
    def save(self, job, was_new=False):
        """Keep the jobs, make sure a schedule exists when one is needed,
        and tell the server."""
        batch.save_jobs(self.jobs_list)
        lines = []
        if job is not None and job.get("enabled"):
            lines += autopub.ensure_schedule((self.night_time.Text or "01:00").strip(), bool(self.weekdays.IsChecked))
        if job is not None:
            others, note = autopub.report(job, self.client)
            if note:
                lines.append(note)
        self.load_server()
        self.show_schedule()
        self.say("Saved. " + "  ".join(lines))

    def on_change(self):
        j = self.current()
        if j is None:
            self.say("Choose a model in the list first.")
            return
        d = JobDialog(j, self.projects, False)
        d.ShowDialog()
        if d.saved:
            self.save(j)

    def on_toggle(self, sender, args):
        j = self.current()
        if j is None:
            self.say("Choose a model in the list first.")
            return
        if not j.get("enabled"):
            if not j.get("model"):
                self.say("This model is not on ACC, so it cannot be opened at night.")
                return
            others, note = autopub.check(j, self.client)
            if others and not forms.alert(
                    "This model is ALREADY published at night by:\n\n%s\n\n"
                    "Two night exports of the same model overwrite each other on the viewer. "
                    "Switch the night export on here as well?"
                    % "\n".join("  - " + autopub.who_text(e) for e in others), yes=True, no=True):
                return
        j["enabled"] = not j.get("enabled")
        self.save(j)

    def on_add(self, sender, args):
        self.say("Reading the ACC models this PC has opened before ...")
        try:
            models = autopub.cached_models()
        except Exception as ex:
            self.say("Could not read Revit's local copies: %s" % ex)
            return
        have = set((j.get("model") or "").lower() for j in self.jobs_list)
        fresh = [m for m in models if m["model"] not in have]
        if not fresh:
            self.say("No other ACC model has been opened on this PC%s. Open the model once (it need not stay open), "
                     "then press Add again." % (" (all %d are already in the list)" % len(models) if models else ""))
            return
        labels = [autopub.label(m) for m in fresh]
        pick = forms.SelectFromList.show(labels, title="Add a model - ACC models opened on this PC (%d)" % len(fresh),
                                         multiselect=False, button_name="Set up this model", width=760, height=600)
        if not pick:
            self.say("")
            return
        m = fresh[labels.index(pick)]
        title = m.get("title") or ""
        if not title:
            title = forms.ask_for_string(default="", title="Model name",
                                         prompt="The file's header did not give its name. The Revit file's name:") or ""
            if not title:
                return
        # The model's Revit version is the one it was last opened in here
        # (new_job keeps it): at night that Revit is started for it, so a
        # model of another version than this Revit needs no question now.
        project = publish.safe_project(title)
        job = autopub.new_job(m, self.jobs_list, project, publish.default_folder(project), title=title)
        d = JobDialog(job, self.projects, True)
        d.ShowDialog()
        if not d.saved:
            self.say("Not added.")
            return
        self.jobs_list.append(job)
        self.save(job)
        self.jobs.SelectedIndex = len(self.jobs_list) - 1

    def on_remove(self, sender, args):
        j = self.current()
        if j is None:
            self.say("Choose a model in the list first.")
            return
        if not forms.alert("Remove '%s' from this PC's auto publish?\n\nNothing on the viewer server is deleted; "
                           "the model is simply no longer published from here." % (j.get("title") or "?"),
                           yes=True, no=True):
            return
        self.jobs_list.remove(j)
        batch.save_jobs(self.jobs_list)
        note = autopub.forget(j, self.client)
        self.load_server()
        self.show_schedule()
        self.say("Removed. " + (note or ""))

    def on_folder(self, sender, args):
        j = self.current()
        if j is not None and os.path.isdir(j.get("folder") or ""):
            os.startfile(j["folder"])
        else:
            self.say("No export folder yet - it is made the first time the model is published.")

    def on_runnow(self, sender, args):
        j = self.current()
        if j is None:
            self.say("Choose a model in the list first.")
            return
        if not j.get("model"):
            self.say("Only a model on ACC can be opened by itself - open it and use Publish.")
            return
        here = nightly.revit_year(HOST_APP.uiapp)
        year, how = nightly.job_year(j, "", nightly.local_index())
        if year and here and year != here:
            self.say("'%s' belongs to Revit %s and this is Revit %s, which cannot open it. Use Publish now from Revit %s "
                     "- or Test night run, which starts Revit %s for it." % (j.get("title") or "?", year, here, year, year))
            return
        if forms.alert("Publish '%s' now?\n\nRevit opens it from ACC, publishes it and closes it without saving or "
                       "syncing. Revit is busy until it finishes." % (j.get("title") or "?"), yes=True, no=True):
            self.run_job = j
            self.Close()

    # ---------------------------------------------------------- schedule
    def on_set_sched(self, sender, args):
        t = (self.night_time.Text or "").strip()
        if not autopub.TIME.match(t):
            self.say("Give the time as HH:MM, e.g. 01:00.")
            return
        lines = autopub.ensure_schedule(t, bool(self.weekdays.IsChecked), replace=True)
        # the time is part of what the server's list shows for every job here
        for j in self.jobs_list:
            if j.get("enabled"):
                autopub.report(j, self.client)
        self.load_server()
        self.show_schedule()
        self.say("  ".join(lines))

    def on_check(self, sender, args):
        """The checklist: looks, exports nothing, changes nothing."""
        self.say("Checking ...")
        try:
            lines = autopub.check_setup(self.jobs_list, self.client)
        except Exception as ex:
            self.say("Could not check the setup: %s" % ex)
            return
        n = autopub.problems(lines)
        self.say(("Check setup: %d problem%s found." % (n, "" if n == 1 else "s")) if n else "Check setup: no problem found.")
        CheckWindow(lines).ShowDialog()

    def on_test(self, sender, args):
        """The night export, now, for the chosen model(s). The launcher is
        started in a window of its own; it waits for the Revit it needs to
        be closed - by the user: nothing is closed or saved from here."""
        cloud = [j for j in self.jobs_list if j.get("model")]
        if not cloud:
            self.say("There is no ACC model in the list to test with - add one first.")
            return
        cur = self.current()
        chosen = [cur] if (cur is not None and cur.get("model")) else []
        if len(cloud) > 1:
            # the selected model is ticked: one model keeps the test short
            picked = forms.SelectFromList.show(
                [JobItem(j, checked=(j is cur)) for j in cloud],
                title="Test night run - which models? (each takes as long as a normal publish)",
                multiselect=True, button_name="Test these", width=680, height=440)
            if not picked:
                self.say("Test not started.")
                return
            chosen = list(picked)
        elif not chosen:
            chosen = cloud
        plan = autopub.test_plan(chosen, self.jobs_list)
        if not plan["models"]:
            self.say("Nothing to test: %s" % " ".join(plan["problems"]))
            return
        off = [j.get("title") or "?" for j in chosen if not j.get("enabled")]
        if not forms.alert(autopub.test_text(plan, off), yes=True, no=True):
            self.say("Test not started.")
            return
        ok, text = nightly.start_test(plan["models"], self.jobs_list)
        if not ok:
            self.say("Could not start the test: %s" % text)
            return
        named = [y for y in plan["close"] if y]
        if plan["close"]:
            close = " and ".join("Revit %s" % y for y in named) or "Revit"
            self.say("Test started. Now save your work and close %s - the black window is waiting for that." % close)
            forms.alert("The test has started in the black window.\n\nSave your work and close %s now%s. The test "
                        "goes on by itself when that Revit has closed; it waits up to %d minutes for it, then "
                        "leaves that version out."
                        % (close, " (close this window first)" if nightly.revit_year(HOST_APP.uiapp) in named else "",
                           plan.get("wait") or 10))
        else:
            self.say("Test started in the black window: %s. You can go on working here. When it has finished, open "
                     "Auto Publish again to see 'Last run here'."
                     % ", then ".join("Revit %s" % y for y, exe, titles in plan["versions"]))

    def on_del_sched(self, sender, args):
        if not forms.alert("Remove the night export from this PC? No model will be published at night from here "
                           "(the models stay in the list).", yes=True, no=True):
            return
        ok, text = nightly.unschedule()
        for j in self.jobs_list:
            autopub.report(j, self.client)
        self.load_server()
        self.show_schedule()
        self.say("Night export removed." if ok else "Could not remove it: %s" % text)

    def on_forget(self, sender, args):
        i = self.everyone.SelectedIndex
        if not (0 <= i < len(self.server_jobs)):
            self.say("Choose a line in the lower list first.")
            return
        e = self.server_jobs[i]
        if not forms.alert("Take '%s' (%s / %s) off the shared list?\n\nThis does not change that PC: if it still "
                           "has the model set up, it reports it again when it next runs."
                           % (e.get("source") or "?", e.get("pc") or "?", e.get("user") or "?"), yes=True, no=True):
            return
        try:
            self.client.delete_publish_job(e["key"])
            self.say("Taken off the list.")
        except Exception as ex:
            self.say("Could not: %s" % ex)
        self.load_server()


def main():
    w = AutoPublishWindow()
    w.ShowDialog()
    job = w.run_job
    if not job:
        return
    out.print_md("## Publishing **%s** now (opened from ACC)" % (job.get("title") or "?"))
    ok, c = batch.run_job(HOST_APP.uiapp, job, out.print_md, unattended=True)
    out.print_md("### %s - %d warning(s), %d error(s). Log: `%s`"
                 % ("Done" if ok else "Failed", c.get("warn", 0), c.get("error", 0),
                    os.path.join(job.get("folder") or "", "export-log.txt")))


main()
