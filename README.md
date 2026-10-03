# LWK Viewer

Revit review for sheets (2D) and the model (3D), with issues, whiteboards, a dashboard - and team task lists.

- `server/` - FastAPI + SQLite. Start with `server/run.bat` (or `python app.py --root <exports folder> --pass <passphrase>`).
- `viewer/` - the pages: `index.html` (sheets), `model.html` (3D), `board.html`, `tasks.html`, `projects.html`, `messenger.html`, `dashboard.html`, `admin.html`.

## Tasks (`tasks.html`)

Team task lists, replacing Lark Tasks, connected to the viewer.

- **Lists per team** (e.g. LWK-MANILA). The groups inside a list are usually the jobs (SKW, Kai Tak 2A3, NDH ...). A group can be linked to a viewer project (`...` > Groups and projects).
- **Views:** List (grouped table, inline editing, sub-tasks, drag to reorder or regroup), Kanban (drag cards between columns), Gantt (drag bars, or drag their ends), Dashboard (total / completed / incomplete / overdue, by assignee, average duration, by project, due soon), and Activities (everything that changed).
- **Quick access:** Owned, Subscribed, All, Created, Assigned and Completed, across every list you can see.
- **People:** the organisation (the accounts on the server) by team, office, company or discipline, with each person's open and overdue tasks.
- **Custom fields:** person, select, text, date and number columns (by default Modelers and Project Manager).
- **Members:** owner (settings), editor (add and change tasks) and viewer (read only). Site admins see every list.
- **Notifications:** email, when the server has `LWK_SMTP_*` set. People are emailed when they become owners, are @mentioned, or a task they follow gets a comment or is completed. They also get a daily mail of their tasks due tomorrow and overdue.
- **Import from Lark:** in Lark, open the task list and choose ... > Export (Excel). Then in Tasks use **+** > *Import a Lark task list (.xlsx)* to make a new list, or `...` > *Import* to bring it into an open list. Everything comes in:
  - groups, sub-tasks (the "< parent" suffix Lark adds is removed), owners, subscribers and creator;
  - created / start / completed / due / updated dates, done status and priority;
  - Completion method, Task completers, Milestone, Modelers and Project Manager;
  - a link back to each task in Lark.

  Tasks are matched by their Lark task id, so importing the same export again updates them instead of adding them twice. Names with no account yet are kept as names; once the accounts exist, use `...` > *Match names to accounts*. CSV works too.

## Projects (`projects.html`)

The register of jobs, like the Lark Base "Projects" table. Each project has:
- a code and name, its owners, team and status;
- its folders (OneDrive / SharePoint / ACC links);
- the viewer projects that show its drawings and models. A job with several Revit models and sheet sets (e.g. MOS Site 1 and Site 2, each exported to its own folder) stays **one project with several parts**. In Admin > Projects, Ctrl+click every folder under *Models and sheets*. A folder that already belongs to another project is moved over; an entry the server made on its own for that folder is removed, and its task groups move with it.

Task groups are linked to a project (Tasks > `...` > *Groups and projects*); a group named like the project's short name (SKW, YTM ...) is linked automatically. The page shows per project:
- number of tasks, done, completion %, overdue, and the open tasks;
- open issues, added up over all its parts, with a count for each part;
- buttons to its sheets, 3D and issues dashboard (with several parts, each button lists them);
- its chat channel.

Members are kept per part, because they are what opens that part. The project's members, and its channel, are everyone on any part. When Admin edits a project with several parts, it shows a part selector above the members.

The project pickers on Sheets, 3D, Board and Dashboard list these project names. A project with several parts is a group, with its parts under it.

Import: export the Lark Base table to Excel, then *Import*. The columns used are Project, Owner, Group, Project Folder and Status. "HKA-P-01681-ARC - SKW" is split into a code and a short name.

## Messenger (`messenger.html`)

Chat inside the viewer (needs accounts):
- **Project channels:** one per project. Everyone on the project is added, and new tasks, assignments, completions, task comments and new or changed issues of that project are posted into it as cards.
- **Group chats** and **direct messages**.
- **Task discussions:** the comments of the tasks you follow, answered from here.
- **In messages:**
  - @mentions, which email the person when mail is set up;
  - replies, edits and deletes;
  - pictures and files up to 50 MB each, pasted, dropped or attached, and kept in `<data>/chat_files/`;
  - task, issue, sheet, OneDrive and ACC links, shown as cards.
- **Finding things:** a search over all your chats, and a Files list per chat.
- **Unread count:** shown on the **Chat** link of every page.
- **Send to chat:** a task (Share) or an issue can be sent into a chat.

Data: `<data>/chat.db`.

### Links to issues, sheets, 3D, OneDrive and ACC

- A task can link **issues** of its group's project (Link an issue). The issue window on the sheet and 3D pages lists the tasks that point at it, and has **+ New task from this issue**.
- **+ Task** in the sheet / 3D header keeps the current sheet, or the point being looked at in 3D, on a task.
- **OneDrive, SharePoint and ACC (BIM 360) links** can be pasted onto a task, an issue or a comment. They are recognised and shown with the file name and type, and open in OneDrive or ACC itself, so their own permissions keep applying. Nothing is copied.
- Planned next: a built-in file browser using Microsoft Graph (OneDrive / SharePoint) and Autodesk APS (ACC). It needs an Azure app registration, an APS app and approval by the ACC account admin. The stored links are already in the shape it will use.

Data lives in `<data>/tasks.db` (one file for the server, beside `accounts.db`).
