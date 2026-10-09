# For BIM coordinators: publishing from Revit

One button, <strong>Publish to Viewer</strong>, exports the sheets and the 3D model and uploads them; the other buttons are for doing the same steps by hand or overnight.

### Setup (once per computer)

- Install the LWK pyRevit extension. It adds an <strong>LWK</strong> tab with the <strong>Viewer &amp; Issues</strong> panel: <strong>Publish to Viewer</strong>, <strong>LWK Issues</strong> and the <strong>Viewer tools</strong> pulldown.
- Sign in once (in <strong>LWK Issues</strong> or from <strong>Publish</strong>). The sign-in is kept for a year so nightly uploads keep working.
- To upload to an existing project you must be its <strong>project admin</strong>; a new project name needs a <strong>site admin</strong>.

### Publish to Viewer

1. Open the model in Revit and click <strong>Publish to Viewer</strong>.
2. <strong>Where:</strong> pick the <strong>Viewer project</strong> (or type a new name: letters, digits, - and _), check the <strong>Server</strong> shows "signed in", and the <strong>Export folder</strong>.
3. <strong>What:</strong> tick <strong>3D model (fast format, with its linked models)</strong> and choose the detail: <strong>Coarse (lightest)</strong>, <strong>Medium (recommended)</strong> or <strong>Fine (most detail)</strong>. Tick <strong>Sheets</strong> and choose <strong>All sheets</strong>, <strong>A Revit sheet set</strong>, or <strong>These sheets</strong>. <strong>Keep sheets published before</strong> keeps earlier sheets that are not in this choice.
4. <strong>Then:</strong> <strong>Send to the viewer server (only what changed)</strong>, <strong>Open it in the browser when done</strong>, and optionally <strong>Publish this model again every night at</strong> 01:00 (Mon-Fri only if you like; ACC models only).
5. Press <strong>Publish</strong>. Choices are remembered for this model. The Revit model is not changed or saved.

After the upload the server needs a few minutes to prepare phone copies and read the sheet text. The server keeps the last 12 versions of each sheet PDF (for <strong>Compare</strong>) and the last 2 of each 3D model (for <strong>Compare with previous export</strong>).

### Viewer tools pulldown

| Button | Use it to |
|---|---|
| <strong>Fast 3D Export</strong> | Export only the 3D model (and links) in the fast format; sheets are kept |
| <strong>Export Viewer</strong> | Export sheets and the manifest by hand (older IFC route) |
| <strong>Upload Now</strong> | Send the last export to the server again |
| <strong>Add Model</strong> | Register an ACC model for the automatic export: sheets, IFC schema, categories to leave out, typical-floor groups |
| <strong>Run Export</strong> | Export and upload every registered model now (Shift-click: only the open model) |
| <strong>Night Export</strong> | Schedule every night or weeknights, remove the schedule, or see status and logs |
| <strong>Export Link</strong> | Export a link that the automatic export cannot open (for example an older-version cloud model) |
| <strong>Link Places</strong> | Write every link instance's placement to the export folder |
| <strong>Test Links</strong> | Quick check of links placed more than once |

<strong>Nightly export needs:</strong> the PC left on and logged in (a locked screen is fine), Revit closed at the scheduled time, and Revit signed in to Autodesk. Allow about 15 minutes per model. Logs are in %APPDATA%\LWK\nightly.

- Every workset of the model is opened by name and unloaded links are loaded. If a workset is still closed, or the 3D model comes out empty, the viewer <strong>keeps the last good 3D model</strong> (the sheets still go), and the log ends with <strong>result FAILED</strong> and the reason.
- Known dialogs are answered so the night is not stopped: a DWG with an empty paper space (Yes), a DWG with <strong>extents greater than 1E9</strong> (OK: it is imported without the far part), DWG import notes such as <strong>Elements Lost on Import</strong> (Close), <strong>External Tools - Add-in Assembly Not Found</strong> and any other add-in's <strong>cannot find xxx.dll</strong> message (Close), and any message that has only one button. Dialogs that come before the LWK tools load, or while a model opens, are answered by the launcher's watcher, which finds every window of that Revit. Every dialog is written to nightly\dialogs.log. The launcher and its watcher are renewed by themselves the next time Revit is opened by hand after an update. Best: repair or remove the broken add-in on that PC.
- <strong>Only what changed is published at night:</strong> after opening a model, the night run reads the version of the model and of every linked model (Revit numbers each save). If none has been saved since the last publish, and the job's settings are the same, nothing is exported and the night log says <strong>UNCHANGED</strong>. A test run, Run Export by hand, a changed setting or an update of these tools always publishes. The model still has to be opened to read its version.
- <strong>Time:</strong> each Revit version may run for 3 hours (limit_hours in nightly_schedule.json); the versions run one after another (2023, then 2024, then 2025), and a version whose Revit is open on that PC is skipped that night. Start the night run early (e.g. 01:00), so every version finishes before people open Revit in the morning.

### LWK Issues window in Revit

- Lists the viewer's issues for a project: <strong>Show</strong> open and in progress, assigned to me, or all; search; columns #, Title, Type, Status, Priority, Assigned to, Due, Where.
- <strong>Go to issue</strong> (or double-click) opens a personal 3D view "LWK Issue - your name" with a section box round the issue, or zooms the sheet. <strong>Open its plan view</strong> and <strong>Open in web viewer</strong> are beside it.
- <strong>Place pins for the list</strong> / <strong>Remove pins</strong> add "LWK #n" markers on the workset "LWK Issues". <strong>Clouds on sheets</strong> adds revision clouds under the revision "LWK Viewer issues".
- Choose a status and/or type a comment, then <strong>Send to viewer</strong>: it appears in the web viewer under your name.

### Revit elements and the LWK add-in

- Every issue raised in 3D on a published model carries the element's ElementId and UniqueId. Reviewers can copy the ids for <strong>Manage &gt; Select by ID</strong>, and BCF exports carry them as AuthoringToolId.
- <strong>Show in Revit</strong> in the viewer leaves a request on the server for the add-in to pick up; the add-in can also send what is selected in Revit to the viewer. What the add-in needs to do is written in <strong>server/REVIT_ADDIN_API.md</strong>, for whoever maintains it.
