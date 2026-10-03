# LWK Viewer

Revit review for sheets (2D) and the model (3D), with issues, whiteboards, a dashboard - and team task lists.

- `server/` - FastAPI + SQLite. Start with `server/run.bat` (or `python app.py --root <exports folder> --pass <passphrase>`).
- `viewer/` - the pages: `index.html` (sheets), `model.html` (3D), `board.html`, `tasks.html`, `dashboard.html`, `admin.html`.

## Tasks (`tasks.html`)

Team task lists, replacing Lark Tasks, connected to the viewer.

- **Lists per team** (e.g. LWK-MANILA). The groups inside a list are usually the jobs (SKW, Kai Tak 2A3, NDH ...). A group can be linked to a viewer project (`...` > Groups and projects).
- **Views:** List (grouped table, inline editing, sub-tasks, drag to reorder or regroup), Kanban (drag cards between columns), Gantt (drag bars, or drag their ends), Dashboard (total / completed / incomplete / overdue, by assignee, average duration, by project, due soon), and Activities (everything that changed).
- **Quick access:** Owned, Subscribed, All, Created, Assigned and Completed, across every list you can see.
- **People:** the organisation (the accounts on the server) by team, office, company or discipline, with each person's open and overdue tasks.
- **Custom fields:** person, select, text, date and number columns (by default Modelers and Project Manager).
- **Members:** owner (settings), editor (add and change tasks) and viewer (read only). Site admins see every list.
- **Notifications:** email, when the server has `LWK_SMTP_*` set. People are emailed when they become owners, are @mentioned, or a task they follow gets a comment or is completed. They also get a daily mail of their tasks due tomorrow and overdue.
- **Import from Lark:** export the Lark task list, save it as CSV, then `...` > Import. Columns are matched by name: Task Title, Custom Group, Parent Task, Owner, Priority, Start Time, Due Date, Status, Completed At, Description. Any other column becomes a text field.

### Links to issues, sheets, 3D, OneDrive and ACC

- A task can link **issues** of its group's project (Link an issue). The issue window on the sheet and 3D pages lists the tasks that point at it, and has **+ New task from this issue**.
- **+ Task** in the sheet / 3D header keeps the current sheet, or the point being looked at in 3D, on a task.
- **OneDrive, SharePoint and ACC (BIM 360) links** can be pasted onto a task, an issue or a comment. They are recognised and shown with the file name and type, and open in OneDrive or ACC itself, so their own permissions keep applying. Nothing is copied.
- Planned next: a built-in file browser using Microsoft Graph (OneDrive / SharePoint) and Autodesk APS (ACC). It needs an Azure app registration, an APS app and approval by the ACC account admin. The stored links are already in the shape it will use.

Data lives in `<data>/tasks.db` (one file for the server, beside `accounts.db`).
