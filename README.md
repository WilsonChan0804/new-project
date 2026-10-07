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
- **Topics:** sub-channels of a project channel for one subject (Facade, MEP coordination, Site visits ...).
  - Anyone in the channel opens one with **+ Topic** (the tabs under the channel's name, the channel's right-click menu, or New chat). Everyone in the channel is added; people on the project who are not in yet see it under "Channels you can join".
  - Topics are listed under their channel. The channel itself is the **# General** tab.
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
- **Changing and deleting:**
  - Hover a message (tap it on a phone): 🙂 react, ↩ reply, ✏️ edit (your own) and ⋯ More (Copy, Forward, Send to WhatsApp, Delete).
  - **Edit** changes the message in place: Ctrl+Enter saves, Esc cancels. Everyone then sees it with "(edited)".
  - **Edit** and **Delete** are for the person who sent the message only - not the chat's admin, not a site admin. The others see "message deleted".
  - A task's comments work the same way, in the Messenger and on the Tasks page. Only the writer can edit; the writer or the list owner can delete.
- **Deleting a chat:**
  - a direct message: either of the two people (it goes for both);
  - a group: its admins (the person who started it) or a site admin;
  - a project channel or topic: the project's admins (owners on the Projects page, project admins of its models) or a site admin. A channel takes its topics with it.
- **Pinned messages:** ⋯ More > **Pin**, by anyone in the chat, up to 100 a chat. The bar under the chat's name shows the latest pin; a click shows the message and moves on to the next, **All** lists them (with unpin).
- **The + button** (left of the paper clip):
  - **Poll:** a question with 2 to 10 choices; one answer or several, by name or anonymous, optionally closing after a date. The bars fill as people vote; the writer can close (and reopen) it.
  - **Event / meeting:** title, date, time or all day, place and a Teams link. Everyone in the chat is invited (and emailed when mail is set up), replies **Going / Maybe / Can't go**, and gets **Add to calendar** (an `.ics` for Outlook, Google or the phone). The writer can change or cancel it; the chat is told.
  - **Task:** made in a task list (the project's lists and group first in a project channel), with owners (the chat's people first), due date and priority; its card goes into the chat. ⋯ More > **Make a task** does the same from any message: its words as the description, the people @mentioned as owners and a link back to the message.
- **The message box** works like Lark's: the words show as they will be sent (bold is bold, a list is a list), with the buttons below it.
  - **Aa** shows the format buttons: **B**, **S**, *I*, U, numbered and bulleted lists, quote, link, code and a block of code. Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+Shift+X work on the selection. On a computer they are shown at first; on a phone, after Aa (their own row).
  - Then 🙂 emoji, **@** a person, **#** a task / issue / sheet / 3D view (shown as a chip in the box), the paper clip, **+** (poll, event, task) and, on a computer, ↗ for a bigger box. **Send** is always on screen, on a phone too.
  - Pasted text goes in as plain words (WhatsApp lines are offered as a quote, as before).
  - Underneath, a message is stored the WhatsApp way (`*bold*`, `_italic_`, `~strike~`, `++underline++`, `` `code` ``, lists and quotes), so it searches, copies and forwards to WhatsApp with its look (WhatsApp has no underline: that is left out there). The edit box of a sent message works the same way.
- **Links to a message:** ⋯ More > *Copy link to this message* (`messenger.html?room=…&msg=…`) opens the chat at that message; search results and pins do the same.
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

## Calendar (`calendar.html`)

What is coming up for you, by date:
- **Meetings:** events sent in the Messenger (+ > Event) in the chats you are in, with your reply.
- **My tasks:** the tasks you own, on their due date.
- **My issues:** open issues assigned to you, on their due date.

**Layout and controls:**
- A month view on a computer, a list on a phone; either can be chosen.
- Filters for the three kinds of entry.
- A click shows the details and a way to the chat, task or issue.
- **+ Event** opens the event form in a chat you choose. An event is always sent in a chat, so its people are invited and can reply.

**Add to Outlook.** Every person has their own calendar address (`/cal/<key>.ics`, from `calendar_feed.py`). Outlook subscribes to it and shows the entries beside your own Outlook calendar, refreshing them by itself:
- the **webcal://** link opens Outlook on the PC;
- or add it by hand with **Add calendar > From Internet**.

**Limits and safety:**
- Outlook on the web and on phones fetch the address from Microsoft's servers, so they need the viewer reachable from the internet. Outlook on an office PC does not.
- The key in the address is its only sign-in. **Make a new address** replaces it, and the old one stops working.
- Writing into Outlook itself (two-way) would need an Azure app registration for Microsoft Graph, from IT.

Data: `<data>/calendar_keys.json`.

## Sheets from outside: their own sets

A PDF uploaded on the Sheets page (consultant drawings, scans) goes into a **set** of its own, named at upload: "Uploaded PDFs", or a new name.
- Each set is its own entry in the drop-down at the top, under the project's title, after the Revit sheets (`?set=` in the address).
- Choosing a set shows only its sheets; the Revit entry shows only the sheets from Revit.
- The sheets stay in the same project, so markups, issues, search and compare work as before.
- Opening a sheet of another set (from an issue or a link) switches to its set.

The drop-downs on the Sheets, 3D, Board and Dashboard pages list every project under its title (name · code), with its models below it.

## Admin

**Adding people to a project.** Search, narrow by team, office or company, tick several (or **Select all shown**), choose one role and press **Add N people**. One invitation email can go to all of them.

**Layout.** The project's settings are in colour-keyed sections:
- project details (orange);
- members (blue);
- adding people (teal);
- Teams (purple);
- markup layers (green);
- phones (grey);
- delete (red).

People, members and the picker show each person's avatar.

## Night export from Revit (`revit/LWK.extension`)

The pyRevit extension that publishes from Revit is kept in this repository under `revit/`.

**What the night run does:**
- **Worksets.** It opens each ACC model with every user workset named, read from the file itself (`WorksharingUtils.GetUserWorksetInfo`). `OpenAllWorksets` alone was found to leave them closed. If any workset is still closed, it opens the model once more.
- **Links.** It loads Revit links that did not load.
- **A failed 3D export keeps the last good one.** With closed worksets, the 3D model is not exported and the sheets still go. An export that comes out empty (0 triangles) sends nothing.
- **A result line.** Each job's log ends with `result OK` or `result FAILED - ...`.

**Dialogs:**
- **While Revit runs:** known dialogs are answered by their wording during an unattended run:
  - a DWG with an empty paper space: Yes (import its model space);
  - the out-of-range and "entities were lost" import notes: Close;
  - any message with only an OK button: OK.
  Others are logged and left alone.
- **Before the LWK tools load:** the launcher runs a small watcher next to Revit (PowerShell UI Automation, passed as `-EncodedCommand`, so no script policy applies). It handles dialogs that come before the tools load, such as **External Tools - Add-in Assembly Not Found**, which it closes. It writes every dialog it sees to `%APPDATA%\LWK\nightly\dialogs.log`.

**Advice for the PC:**
- Repair or remove the broken add-in's `.addin` file, under `C:\ProgramData\Autodesk\Revit\Addins\<year>` or `%APPDATA%\Autodesk\Revit\Addins\<year>`, or tick *Do not show this message again* once.
- Update the PC by replacing the `LWK.extension` folder with the one from `revit/`.

## Issues and tasks together

- **A task from an issue.** In the issue window, *+ New task from this issue* opens a form:
  - the task list and group of this project come first;
  - the owner is the issue's *Assigned to* and the due date is the issue's;
  - the issue, its files and its Revit element go on the task.
- **Closing one offers to close the other.**
  - Mark a task complete and its linked issues are still open: the Tasks page asks *Resolve its issues too?* They are resolved exactly as in the viewer: history, emails, the chat card, and a note naming the task.
  - Resolve or close an issue that has open tasks: the issue window offers to mark them done. Each such task also gets a line in its activity.
- **Live status.** In the task window each linked issue shows its status now (Open / In progress / Resolved). In the task list, a task shows `#2 open` while it has open issues, or `#✓` once they are all resolved.

## Revit elements

- **What is kept.** A 3D issue keeps the Revit element it was placed on: ElementId, UniqueId, IFC GUID, category, family/type and level. Models published by the LWK add-in (`.lwkm`) know all of these; older ones only the IFC GUID.
- **The 3D page.** Clicking an element shows its Revit id and UniqueId, with *Copy Revit ID*, *Show in Revit* and *+ Task*. Elements chosen in the model browser (Select) go together.
- **Back into Revit, today, with no add-in change:**
  - *Copy Revit IDs*, then in Revit **Manage > Select by ID**, paste;
  - **BCF export** writes the element as `AuthoringToolId` (the ElementId), which Revit BCF tools (BCF Manager, BCFier, Revizto) select.
- **Elements on tasks.** "+ Task" on the 3D page with elements selected keeps them on the task as *Elements to change*, with Copy Revit IDs, Show in 3D and Show in Revit.
- **Show in 3D:** `model.html?project=...&elements=<UniqueId or ElementId>,...` picks them out and zooms to them.
- **Show in Revit.** The viewer asks Revit's LWK add-in through the server (`/api/revit/requests`, which the add-in polls). Until the add-in does this, the IDs are copied for *Select by ID* instead.
  - What the add-in needs to do is in `server/REVIT_ADDIN_API.md`: poll and select, and send Revit's selection to the viewer.

## Search

- **Opening it.** The magnifier in the header of every page, **Ctrl+K**, or **/**.
- **What it searches.** One box for projects, tasks (title, description, `T-12`), issues (`#12`, title, description, sheet, assignee, Revit element and id), sheets, saved 3D views, chat messages, and the OneDrive / SharePoint / ACC links on tasks and issues.
- **Results.** Grouped by kind. ↑ ↓ and Enter open one. You only see what you may open.

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

- **pdf.js** (draws the sheets) is served by the viewer itself (`viewer/vendor/pdf.min.js` and `pdf.worker.min.js`, version 3.11.174, Apache-2.0), not from cdnjs. That saves a connection to another site, and it is kept with the rest of the files.
- **Faster still: HTTP/2 in front of the server.**
  - uvicorn speaks HTTP/1.1, so a browser opens 6 connections at most and a first visit to the Sheets page (about 50 files) waits in a queue.
  - If https comes from a proxy (Caddy, nginx, IIS, Azure Front Door), switch on HTTP/2 (and Brotli) there.
  - Repeat visits do not need it: their files come from the browser's cache.
- **Big PDFs:** a sheet set exported as one big PDF (hundreds of MB) is slow on every device. Let the server build the sheets' picture tiles after each export (*Performance* on the Sheets page), or export one PDF per sheet.
- If a proxy in front of the server has trouble with this, start it with `--plain-assets` (or `set "PLAIN_ASSETS=1"` in run.bat) to serve the files as they are.
