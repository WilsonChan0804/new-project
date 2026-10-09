# For admins

Project admins manage their project's people and settings on the <strong>Admin</strong> page; site admins also manage accounts, every project, the bin and device reports.

### Roles

| Role | Can |
|---|---|
| <strong>Viewer</strong> | Look at everything; cannot add or change issues or comments |
| <strong>Member</strong> | Raise and edit issues and comments; delete only their own |
| <strong>Project admin</strong> | Everything a member can, plus manage the project's members, edit or delete anything, override layer locks, upload models |
| <strong>Site admin</strong> | Every project; add, deactivate and reset accounts; create, delete and restore projects |

Every project must keep at least one project admin.

### Projects and members

- <strong>Add people to this project:</strong> search, narrow by <strong>team</strong>, <strong>office</strong> or <strong>company</strong>, tick several (or <strong>Select all shown</strong>), choose the Role and press <strong>Add N people</strong>; or fill in <strong>Someone without an account yet</strong> (Email, Name, Office, Company, Role) and <strong>Create and add</strong>. A temporary password is shown <strong>once</strong>.
- Send it with <strong>Email invitation</strong> (opens your own Outlook) or <strong>Copy invitation</strong>. The person must choose their own password at first sign-in.
- Change a role in the members table, or <strong>Remove</strong> someone (their issues and comments stay).
- <strong>Teams channel:</strong> paste the Teams Workflow webhook address, <strong>Save</strong>, <strong>Send a test</strong>, and choose the day and hour (Hong Kong time) for the weekly summary.
- <strong>Markup layers:</strong> for each layer set who can change it (every member, project admins only, or named people), who can see it, and whether it starts hidden.
- <strong>Phones and tablets:</strong> <strong>Prepare this project now</strong> re-makes the phone copies if a phone reports none; <strong>Show progress</strong> (site admins) shows the server's background work.

### Projects (Admin &gt; Projects and members)

- <strong>+ New project</strong>: <strong>Project name</strong> (e.g. HKA-P-01681-ARC - SKW; the code is taken from it), <strong>Code</strong>, <strong>Status</strong>, <strong>Group / team</strong>, <strong>Owners</strong>, and <strong>Folders and files</strong> (OneDrive, SharePoint or ACC links). <strong>Import</strong> reads a project table exported from Lark Base or Excel.
- <strong>Models and sheets:</strong> the viewer projects (export folders) that show this job. Ctrl+click several when a job has several Revit models and sheet sets, such as Site 1 and Site 2. Choosing one already used elsewhere moves it here; an entry the server made for it alone is removed, and its task groups move with it.
- Members belong to each part (they are what lets someone open that model). With several parts, a <strong>Part</strong> selector appears above the members table.
- <strong>Remove from Projects</strong> takes a job off the Projects page; its tasks, issues, model and files stay.

### Site admin only

- <strong>People:</strong> add accounts, <strong>Reset password</strong>, <strong>Make / Remove site admin</strong>, <strong>Deactivate / Reactivate</strong> (signs the person out everywhere), <strong>Edit</strong>, <strong>Delete</strong> (for accounts made by mistake).
- <strong>Delete project ...:</strong> type the project name to confirm. Models, sheets, issues, markups and members move to the bin on the server; <strong>Restore</strong> in the bin list puts everything back, as long as the name has not been reused.
- <strong>Devices:</strong> reports sent by the 3D page from each device: what loaded, peak memory, frame rate, stalls and crashes. Filter to crashes or to phones and tablets to see where the viewer struggles.
- <strong>Server:</strong> email needs the server's LWK_SMTP_ settings. If a proxy in front of the server has trouble with the compressed, browser-kept files, start the server with --plain-assets (or set PLAIN_ASSETS=1 in run.bat).
