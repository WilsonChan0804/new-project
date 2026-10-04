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
- **Typing:** Enter makes a new line, on a phone and a computer alike. The Send button sends; on a keyboard, Ctrl+Enter (Cmd+Enter) does too.
- **Linking things while typing:**
  - **@** a person, **#** a task, **!** an issue, **$** a sheet, **%** the 3D model or a saved 3D view;
  - a list opens as you type (↑ ↓ and Enter, or tap) and the pick shows in the message as a chip with its name, which opens it;
  - in a project channel the lists show that project only, and anywhere else every project you can open;
  - the **#** button beside the paper clip opens the same lists with tabs;
  - **choose the project first:** the list starts with a row of projects (**All projects**, SKW, Kai Tak 2A3, MOS ...). In a project channel its own project is chosen to begin with; anywhere else the one you chose last. Tap another to look there instead; the # button has the same choice as a drop-down.
- **Copy:** every message (and every task comment) has a Copy button. Links are copied as "name: full address", so they still work when pasted into an email or WhatsApp.
- **Emoji:** the 🙂 button. **Reactions:** hover a message (tap it on a phone) and press the smiley: 👍 ❤️ 😂 😮 🙏 ✅, or + for any emoji. Tap a reaction to add yours or take it away.
- **WhatsApp:**
  - **Out:** on any message, the WhatsApp button sends its words, links and files on.
    - On a phone, pictures and files go as themselves through the phone's share sheet.
    - On a computer, it opens WhatsApp Desktop or WhatsApp Web with the text.
  - **In:**
    - **Copied messages:** messages copied in WhatsApp and pasted into the message box are offered as one "From WhatsApp" quote.
    - **Exported chat:** in WhatsApp, open the chat > More > Export chat, and send yourself the `.zip` (with media) or `.txt`. Then, in a chat's menu (right-click it, or Chat info), choose *Import WhatsApp chat* and pick the file. Its messages arrive as one quote with the pictures in place.
    - **Android, with the viewer installed as an app:** WhatsApp > Share > LWK Viewer, then choose the chat.
    - iPhone browsers do not offer this, so copy and paste or export instead.
  - There is no automatic two-way link with WhatsApp. That needs Meta's WhatsApp Business API, a business number of its own, and the server reachable from the internet.
- **Speed:**
  - The page keeps the last chats and their last messages on the device and shows them at once, while the server is asked.
  - A message you send shows straight away ("sending ..."); if it does not go, it stays there with *send again*.
  - New messages arrive within a moment: the page keeps one request open that the server answers as soon as anything changes.

Data: `<data>/chat.db`.

### Links to issues, sheets, 3D, OneDrive and ACC

- A task can link **issues** of its group's project (Link an issue). The issue window on the sheet and 3D pages lists the tasks that point at it, and has **+ New task from this issue**.
- **+ Task** in the sheet / 3D header keeps the current sheet, or the point being looked at in 3D, on a task.
- **OneDrive, SharePoint and ACC (BIM 360) links** can be pasted onto a task, an issue or a comment. They are recognised and shown with the file name and type, and open in OneDrive or ACC itself, so their own permissions keep applying. Nothing is copied.
- Planned next: a built-in file browser using Microsoft Graph (OneDrive / SharePoint) and Autodesk APS (ACC). It needs an Azure app registration, an APS app and approval by the ACC account admin. The stored links are already in the shape it will use.

Data lives in `<data>/tasks.db` (one file for the server, beside `accounts.db`).

## Speed

How the pages open fast (server: `assets.py`, viewer: `boot.js`):
- **Compressed:** the viewer's files and the server's answers go out gzipped. The 3D library drops from 4.8 MB to 0.7 MB, and `app.js` from 246 kB to 74 kB.
- **Kept by the browser:**
  - Every page lists its files with a version tag (`nav.js?v=...`), so after the first visit the browser opens them from its own cache without asking the server.
  - A file that changes gets a new tag, so an update is picked up at once and old and new files are never mixed.
- **Asked for at once:**
  - Each page names all its files up front, so they download together.
  - `boot.js`, first on every page, starts the page's data requests while the big scripts are still downloading.
  - Two parts of a page asking for the same thing share one request.
- **Kept on the device:** the Projects page and the Messenger show what they showed last time at once, then the server's answer.
- **Measured on test data**, with 150 ms of delay per request (as over a VPN or tunnel), first visit / next visit:

| Page | Before | Now |
|---|---|---|
| Projects | 0.84 s / 0.83 s | 0.65 s / 0.19 s |
| Sheets | 2.7 s / 2.7 s | 1.65 s / 0.96 s |
| 3D | 3.8 s / 2.3 s | 1.3 s / 0.78 s |
| Board | 1.4 s / 1.3 s | 0.82 s / 0.36 s |
| Tasks | 1.5 s / 1.4 s | 1.0 s / 0.52 s |
| Dashboard | 1.35 s / 1.3 s | 0.73 s / 0.58 s |
| Messenger | 0.93 s / 0.84 s | 0.85 s / 0.38 s |

- If a proxy in front of the server has trouble with this, start it with `--plain-assets` (or `set "PLAIN_ASSETS=1"` in run.bat) to serve the files as they are.
