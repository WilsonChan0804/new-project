/* What's new: after each update, a small card lists what changed, once.
 * The list is kept here, newest first; each release adds its entry when
 * it raises LWK_VERSION (nav.js). The bell panel's "What's new" opens the
 * whole list at any time. Nothing leaves the page: what has been seen is
 * remembered in this browser. */

export const ENTRIES = [
  {
    version: "2026-11-26", date: "21 Oct 2026",
    items: [
      "**One header on every page.** The project you are in is always top left, beside the logo - click it to switch project. Then the pages (Projects, Dashboard, Sheets, 3D, Board, Tasks, Chat, Calendar, Folders), and Search, notifications, help and your profile always at the right. On Sheets and 3D the page's own tools (Comment / Issue, Files, Navigate, Measure, Floor plan ...) are on a toolbar just under it.",
      "**Dates are written one way everywhere:** \"7 Oct\" this year, \"7 Oct 2025\" for an older one, and \"2 h ago\" for recent activity.",
      "**Each colour means one thing:** amber is open, blue is in progress (or information, like holidays), green is resolved or done, red is overdue. Orange is only the LWK brand and the main button.",
      "**Dashboard:** four key numbers (Open, Overdue, Resolved in the period, Average time to resolve) with the rest on one quiet line, filters as one row of chips (office, team and dismissed issues under More filters), \"Resolved\" used everywhere instead of a mix of closed / resolved, \"41 days overdue\" instead of a date, and \"Updated 2 min ago\" that refreshes by itself.",
      "**Folders:** the column shows how many items a folder holds, one lock with an explanation on 00 BIM, a drop area for uploads (and Upload / New folder buttons in an empty folder), Open in 3D / Open in Sheets on a model's or a PDF's row, full names on hover, and the folder tree can be made wider by dragging its edge.",
      "**Calendar:** one + New button (event, meeting, task, leave), Sync to Outlook as a quiet button, a colour legend that also switches each kind on and off, \"Due:\" on issues, and a new Week view.",
      "**Board:** a board you open for the first time is shown at a readable size from its top, and Frames (bottom right) lists its sections to jump to.",
      "**Tasks:** done tasks are hidden until you click Show done. **Sheets:** the markup tools are in families (shapes, clouds, drawing, text, measuring, more) - each shows the one you used last, the arrow beside it the rest. **Chat:** a pasted screenshot is named after when it was taken, not \"image.png\".",
    ],
  },
  {
    version: "2026-11-25", date: "21 Oct 2026",
    items: [
      "**Tasks:** unticking a task you ticked by mistake now puts its old percent back, and changing a 100% task to a lower number unticks it again. Tasks that were already ticked done now show 100%.",
      "**Tasks list:** the Task title column can be resized too. On a phone it now takes at most about half the screen, so the other columns stay in view.",
      "**Gantt:** the hatched \"% complete\" part of a bar is much easier to see, and it has its own entry in the legend.",
    ],
  },
  {
    version: "2026-11-24", date: "21 Oct 2026",
    items: [
      "**Tasks:** typing 100% complete now auto-ticks the task done, and ticking a task done now auto-fills its percent to 100% - the two stay in sync instead of drifting apart.",
      "**Gantt:** a task's bar now shows a hatched fill for however much of it is done, so progress is visible on the chart itself, not just in the list.",
      "**Tasks list:** column widths can now be dragged to resize from a column's header edge, and the list remembers your widths for next time.",
    ],
  },
  {
    version: "2026-11-23", date: "21 Oct 2026",
    items: [
      "**Tasks:** a task or sub-task can now have a percent complete (0-100), entered from the list or its own panel. A task with sub-tasks shows the average of all of them instead (an untouched sub-task counts as 0%) - 2 of 5 sub-tasks at 50% and 100% makes the parent 30%, not 75%. The bar's colour says how fresh the number is (green today, amber a few days, grey if nobody has touched it in a while), and it shows who last set it and when.",
    ],
  },
  {
    version: "2026-11-22", date: "17 Oct 2026",
    items: [
      "**Help and the user manual: 19 more numbered pictures** - the View menu, Split, Compare and 2D + 3D on Sheets; raising an issue (2D and 3D); the 3D Section, Measure, Display and Floor plan; Clash (the rule and the results), Headroom (the settings and the results) and the SBD report; the bell and your profile menu; and the Kanban, Gantt and Dashboard views of a task list.",
      "3D: the **Models** heading (with Light mode and All on / All off) no longer stays stuck at the top of the left panel over the other sections as you scroll.",
    ],
  },
  {
    version: "2026-11-21", date: "16 Oct 2026",
    items: [
      "Tasks, Folders and Chat: the side columns no longer blink - since 2026-11-19 the page kept redrawing them many times a second.",
    ],
  },
  {
    version: "2026-11-20", date: "16 Oct 2026",
    items: [
      "**Help and the user manual: pictures with numbers.** Each page (Projects, Dashboard, Tasks, Board, Chat, Calendar, Folders, Sheets, the markup tools, 3D, Checks > SBD and its drawings) now has a screenshot with every panel and button numbered, and a list saying what each number does. In Help, click a picture to see it full size.",
      "Tasks, Folders and Chat: a side column no longer folds by itself after the window is resized.",
    ],
  },
  {
    version: "2026-11-19", date: "16 Oct 2026",
    items: [
      "**Tasks:** click a column heading (Priority, Owner, Start, Due ...) to sort - ▲, ▼, then the list's own order. The task panel's buttons wrap instead of running off the side, so **Delete** is always in view.",
      "**Folders:** sort by Name, Modified, Size or Uploaded by the same way (folders stay first).",
      "**Tasks, Folders and Chat:** drag a side column's edge to size it, as on Sheets and 3D; in Chat, the list's tab pins it or folds it away.",
      "**Checks > SBD:** a P or Lp that does not comply now sits on solid red (one that does on green), with a legend under the table; the actions look like buttons.",
    ],
  },
  {
    version: "2026-11-18", date: "16 Oct 2026",
    items: [
      "SBD elevations: at a building's ends, the open space above a part that lies wholly in the disregarded 1/3 H (and over the lower step beside it) now joins the side setback's **IS** - it was left white. Every step of the buildings' profile has its width written.",
      "Checks > SBD: the **3D** box now hides the **SBD masses** model too (not only the outline and zone limits), and is ticked while that model shows.",
    ],
  },
  {
    version: "2026-11-17", date: "16 Oct 2026",
    items: [
      "SBD (report 8): a side region now runs on to the **site's corner** where its turned edge leaves the site through the far boundary - all the site outward of the edge's line. A tower with a Y- or U-shaped plan is no longer left out of the elevations, and every building block is marked **B1, B2 ...** on them.",
      "SBD **Design Requirement (1): Lp = the longer side of the notional rectangle** round the building or group, lying flush with it and turned to the side that gives the smaller Lp (Fig B3) - for every building, abutting a street or not. The canyon still gives U = (A(a) + A(b)) / (L(a) + L(b)); the rectangle and its Lp are drawn on the Street canyon view.",
    ],
  },
  {
    version: "2026-11-16", date: "16 Oct 2026",
    items: [
      "**SBD Export (Revit)** now asks **which viewer project** every time - it used to send straight to the project LWK Issues last used with the Revit file. That project is listed first, marked \"last used with this model\"; the result says the project's name too. (Update the add-in.)",
    ],
  },
  {
    version: "2026-11-15", date: "16 Oct 2026",
    items: [
      "SBD side regions (report 7): where a region narrows to a point at the site boundary, the hatch now runs **right to the boundary's corner** - the last little piece was being cut off square, which showed as the corner \"not following the boundary\". A short step in the boundary beside a street (or a sliver between the boundary and the slab) no longer splits or stops the part up to the street's centreline. The air corridor's ends sit exactly on the boundary.",
      "**CAD template** with this project's own **site boundary and streets**, at **shared (survey) coordinates** and mPD levels when the project's 3D says where they are; draw the masses around them and import - the drawing is brought back to the Revit model's origin, so the masses line up in the 3D.",
    ],
  },
  {
    version: "2026-11-14", date: "16 Oct 2026",
    items: [
      "SBD side regions (report 6): the inner edge always **starts square to the plane** at a building corner and turns there only, so the corners of the hatch are exact again; a street beside the site is found by its **slab** (any name - Street, Road, Lane, Path), so a renamed or set-back street still extends the region to its centreline, and only across the street.",
      "SBD **air corridors are one straight band** of constant width from end to end.",
      "SBD **Design Requirement (1)**: a facade **recessed more than 30 m in the middle** splits the canyon into parts A(a), A(b) ... measured to the real facade (the 30 m line is never taken as a facade); U = (A(a) + A(b)) / (L(a) + L(b)), Lp = Lp(a) + Lp(b) (Fig B7).",
    ],
  },
  {
    version: "2026-11-13", date: "16 Oct 2026",
    items: [
      "SBD side regions **worked out exactly** (report 5): the piece **nearest the projection plane**, corners on the site boundary, and beside a street the part up to the centreline only along the frontage, between lines through its two corners **parallel to the plane**.",
      "SBD **air corridors keep their width** where they turn (the far edge square to the turned edge); the faint projection strips are gone.",
      "SBD **Design Requirement (1)**: a facade set back beyond 30 m gives the canyon in **parts** - U = (A(a) + A(b)) / (L(a) + L(b)), Lp the parts added (Fig B7); a building not abutting a street has **Lp = the shorter side** of its smallest rectangle; the 30 m offset is a dashed line; street labels clear of the canyons.",
      "SBD **plan level in every zone**, and every table, plan, elevation and report page says which level was used. **SBD Export (Revit)** no longer asks for the ground (Level 0 comes from the lowest street), and streets may be Floor types named **Street, Road, Lane or Path**.",
    ],
  },
  {
    version: "2026-11-12", date: "16 Oct 2026",
    items: [
      "SBD **without Revit**: Checks > SBD > **CAD template** gives a DXF with the layers to draw on (SBD-SITE, SBD-STREET-<name>, SBD-MASS); draw the site, streets and masses in AutoCAD, SketchUp, Rhino ... and **Import CAD model ...** (DXF or DWG) - assessed exactly as a model from Revit.",
      "SBD **to CAD**: **CAD ...** saves every plan, elevation and street canyon as a **DXF** or **DWG**, a layer per kind (SBD-IS, SBD-PE, SBD-BLDG, SBD-DIM ...); in the Plan window, the drawing shown, a plan in the model's own coordinates.",
      "SBD **plan level**: a zone whose podium changes shape has a **Plan level** menu - All levels (worst), or the plan taken at one height; the elevation stays the true 3D.",
      "SBD rules (report 4): **Level 0** = the lowest street, each street with its own mean level; a side region next to a street runs on to its **centreline**; both side regions from **one projection plane**; **IS and PE taken horizontally** (a gap short of its S joins the sky over the building beside it); DR(1) counts only the part **within 30 m**, groups buildings **under 15 m apart**, each street with its own U.",
      "SBD drawings: **Projection Plane X / Y**, no overlapping text, the planes' symbol and the scale bar where the drawing is empty, the near edge's dimensions always in view; the street canyon without the corridor outline and long 30 m lines, with the buildings' spacing. **Remove ...** now takes the masses' model off the 3D at once.",
    ],
  },
  {
    version: "2026-11-10", date: "16 Oct 2026",
    items: [
      "SBD: an **L-shaped street** is taken leg by leg (Plane X along the leg fronting the site the longest; Design Requirement (1) per leg); a side region's edge **turns once**; a gap under its S but **≥ 3 m wide counts as PE**; a sloped face's steps are **one area** (triangle or stepped); one Lp everywhere.",
      "SBD drawings: the street's name along it, **℄** at its end, the **mean street level**; the Street canyon view adds each building's **Lp rectangle** (also beyond 30 m), the **30 m line** and the street's width; the hatches stop at the boundary (a piece beyond is not drawn); the report's drawings are cropped and larger, with the S values along the plane.",
      "**Notifications:** a box beside each item under the bell marks it read or unread without opening it. **Calendar:** a task whose sub-tasks are yours shows its own due date too. **Phone:** on the 3D page the tools row has its own light strip and no longer overlaps the header buttons.",
    ],
  },
  {
    version: "2026-11-09", date: "15 Oct 2026",
    items: [
      "SBD **Design Requirement (1) - Lp of building(s) abutting a street**, drawn as GB081: a building counts when any part is within 30 m of the street's centreline; its canyon runs over its whole projected length (STREET CANYON AREA, ACTUAL Lp, LENGTH, width), U = Area / Length, the smaller U of two streets controls, Max Lp = 5U - with the calculation on the drawing's side and a page per zone in the report (or why it does not apply).",
      "SBD drawings: gaps numbered **S1, S2, S3 ...** along the plane, each side region's **A1 / L1**, angle symbols on every turned edge and between Axis 1 and 2, a scale bar, **℄** with the street's name (the Floor's type name), the elevation's building profile dimensioned with heights, IS numbered, levels with the model's levels, and every number to 3 decimals. The report shows the calculation under each plan.",
    ],
  },
  {
    version: "2026-11-08", date: "15 Oct 2026",
    items: [
      "SBD **Street canyon** check (Design Requirement 1): **Plan ... > Street canyon** draws each building's canyon, U and Lp along the street, zone by zone, with the working (U = area / length, Lp ≤ 5U); the summary gives its own PASS / FAIL, and the report and issues include it.",
      "SBD drawings **zoom**: the wheel or a pinch zooms, a drag pans, + / - / Fit (or double-click) at the bottom right - on the plan, the elevations and the street canyon.",
    ],
  },
  {
    version: "2026-11-07", date: "15 Oct 2026",
    items: [
      "**Help** on every page: the **?** beside the search (or **F1**, or Help in your profile menu) opens the user manual inside the viewer - search it, browse the contents, in English or 粵語. It opens at the page you are on, and is updated with the manual at each release.",
      "SBD **elevations follow the plan** (the SBD panel's deformed elevation): each gap is drawn at its S value and each building group at its width on the site's near edge, with the same dimension chain on both - a gap that does not count (e.g. S2 under 15 m) is hatched red, not IS. W = the S values + the shadows.",
      "SBD **plan**: the corridors and side regions run to the site boundary; each label gives the turn (any angle 0-15°); a dimension chain along the near edge shows each gap's projected width and the buildings' shadows (B1, B2 ...).",
      "SBD **planes found automatically**: the Low zone along the street, the Middle and High zones at the pair giving the most P (the Plan lists the pairs tried). **How to prepare the model ...** in Checks > SBD opens the procedure and requirements.",
    ],
  },
  {
    version: "2026-11-06", date: "15 Oct 2026",
    items: [
      "SBD **Plan ... > Elevation**: each zone's elevational projection on its own Plane X and Plane Y (Fig B10 / B11), drawn from the masses - the IS (the gaps that count, and open to above over a lower building), the **PE** (a void through the building ≥ 3 m x 3 m) and P = (IS + PE) / (W x H), with the working as in the BD sample case. PE counts up to 1/3 of the required P; IS alone must reach 2/3 of it.",
      "SBD **Low zone exemption**: the portion ≤ 1/3 H (6.67 m) is disregarded - hatched on the elevation, not IS, and left out of the footprints and of Lp.",
      "SBD **Case 1 per zone**: U (canyon area / its length) and Lp (the facade projected on the street) for the podium in the Low zone and the towers in the Middle and High zones, against 5U. A site under 2 ha is checked on Plane X; Plane Y is shown for information.",
    ],
  },
  {
    version: "2026-11-05", date: "15 Oct 2026",
    items: [
      "SBD now runs **the SBD panel's own engine** (Check & Comply, 27/08) on each zone's footprints: corridors that bend up to 15° and return, S1 as each side region's **Area / Depth** (the working is shown in the Plan), Plane Y at the best angle within **75-105°** of Plane X in every zone, and in the Middle and High zones **Plane X turned to the angle that gives the most P** (to the degree).",
      "The masses sent by SBD Export are also **a model in the project's 3D** (SBD masses, in the Models list - on and off, transparency, move); **Remove ...** in Checks > SBD takes away the masses, the result and that model.",
      "SBD warns when the masses do not start at the zones' ground (a 10 m podium would count in the Middle zone); SBD Export compares the street slabs' level with where the masses start and offers either.",
    ],
  },
  {
    version: "2026-11-04", date: "14 Oct 2026",
    items: [
      "SBD Export reads the **streets from Floor slabs**: model each street as a Floor whose type name has **Street** in it (kerb to kerb). Its **centreline**, its far side (the **opposite boundary** for Case 1 U) and its level are taken from it; Axis 1 runs along the longest street frontage, and the zones are measured from the **street level** (the slabs' mean level near the site) - no lines to pick and no floor levels needed. The SBD plan draws the streets.",
    ],
  },
  {
    version: "2026-11-03", date: "14 Oct 2026",
    items: [
      "3D > Checks > **SBD** (PNAP APP-152): the permeability **P**, the separating distances **S1 / S2 / S3** and the **air corridors**, worked out from the building **masses** sent from Revit (**LWK > Viewer tools > SBD Export**). Each zone - **Low (0-20 m), Middle (20-60 m), High (60 m+)** - is cut from the masses, so a podium + tower scheme is assessed as it is. A table with the controlling and required P, the street canyon **U** (Case 1), a **Plan** of each zone (gaps green / red, pinch points, corridors), the masses in **3D**, **Save** results, **Make issue** and a **Report** (Save to Folders).",
    ],
  },
  {
    version: "2026-11-02", date: "14 Oct 2026",
    items: [
      "Sheets > **Set ▾**: the actions are now clear buttons (Select sheets, Rename set, Archive set, and **Delete set** in red); archived sets have a **Bring back** button.",
      "**Delete set** now asks about the set's **files kept in Folders** (the PDFs / CAD files kept at import): **Delete the set, keep the files** or **Delete the set and its files** - those go to the Folders bin, where they can be restored.",
      "The header fits **one row** on a full-screen window on every page: the project and model / sheet-set drop-downs are shorter (the full name is in their tooltip) and Search, the bell, + Task and your profile stay on the same row.",
    ],
  },
  {
    version: "2026-11-01", date: "14 Oct 2026",
    items: [
      "Sheets > Files > **A CAD drawing**: **xrefs are found by themselves**. Choose only the drawing(s): the xrefs they use are taken from the files or the **folder on this PC** you chose (only the ones needed are sent), then from the project's **Folders** (any folder) - and only what is still missing is asked for: **Choose files ...**, **Choose a folder ...** or **Make the sheets without them**. No need to bind the xrefs first.",
      "Sheets > Files: a PDF or CAD drawing can now be taken **From Folders ...** (a file already in the project's Folders, e.g. 01 Incoming) - or as before from this PC, and for CAD also **A folder on this PC ...**.",
      "Fixed: a CAD file with a very long name (or with & in it) was refused.",
      "Tasks: the **Owner** drop-down (and person columns) lists the **task list's members** - **Show everyone** at the bottom for anyone else.",
      "Calendar: the owners of a task also see the due dates of its **sub-tasks** (at any level) - the entry says **Sub-task of ...**. And **Filter > Week starts on: Sunday** (or Monday) for the leftmost column.",
    ],
  },
  {
    version: "2026-10-31", date: "14 Oct 2026",
    items: [
      "Sheets: importing a PDF or CAD drawings now asks everything in **one window** - sheet number, set and **where the file is kept in Folders**: by default **00 BIM > Import > PDF** (or **CAD**) **> the set's name**, or **Change folder ...** for any other folder, or **Don't keep a copy**. The choice is remembered. The CAD files (DWG / DXF and xrefs) are kept there too.",
    ],
  },
  {
    version: "2026-10-30", date: "14 Oct 2026",
    items: [
      "Sheets: **Files > A CAD drawing (DWG / DXF)** - send a drawing with its xrefs (or a .zip): **each layout becomes a sheet** of a new set, with its viewports at their scale, the xrefs drawn in, Chinese text, hatches and dimensions; black lines as plotted, or the drawing's colours. DWG needs the ODA File Converter on the server (the server's admin installs it once); DXF works straight away.",
    ],
  },
  {
    version: "2026-10-29", date: "14 Oct 2026",
    items: [
      "Fixed: with two projects open in two browser tabs, an issue raised in one could be saved into the other project. Each tab now keeps its own project (it shows in the address).",
      "Calendar: **Holidays** shows the public holidays of **Hong Kong** and / or **the Philippines**. **+ Leave** (or right-click a day, or drag across days) adds your annual leave, with the working days counted. **Groups**: the people in a calendar group see each other's leave.",
      "Sheets: **Set ▾** beside the sheet list renames, **archives** (hidden, nothing deleted - brought back from the same menu) or deletes a set of imported PDFs, and **Select sheets** deletes several imported sheets at once.",
      "**Keep a copy in Folders**: after importing a PDF on the Sheets page, and from the folder button on any file or picture sent in the Messenger or a task - choose the project and folder (or make a new one).",
    ],
  },
  {
    version: "2026-10-28", date: "12 Oct 2026",
    items: [
      "Issues (Sheets and 3D): **photos in the Discussion** - **📷 Photo** beside Post (or the camera on a phone / iPad), paste a screenshot with **Ctrl+V**, or drop pictures on the message box. Click a photo to see it large; the issue report shows them too.",
    ],
  },
  {
    version: "2026-10-27", date: "12 Oct 2026",
    items: [
      "3D header: **one line** on a wide window (links, project, Navigate / Add issue / Measure, Floor plan, Plan overlay, link, BCF, then Search, the bell, + Task and your profile at the right) and **never more than two** on a smaller one - the tools go down a line, with the project drop-downs on a small window.",
    ],
  },
  {
    version: "2026-10-26", date: "12 Oct 2026",
    items: [
      "3D header: **Floor plan** sits with Plan overlay, the view link and BCF on the second row; **Search, the bell and + Task** are at the top right, as on the other pages.",
      "Clash and headroom: **Save view** on a clash or a place keeps the view as you have set it (turned, section box adjusted). It opens there for everyone, its issue (or Raise issues for all) uses it, and a saved result keeps it.",
      "A headroom issue keeps its **height dimension**: it is drawn again whenever the issue's view is opened.",
      "Clash rules: **All LWK BIM models** beside All consultant models. Headroom: **Include consultant models** (on) - those not loaded are loaded when you scan.",
    ],
  },
  {
    version: "2026-10-25", date: "12 Oct 2026",
    items: [
      "Clash and headroom: **Raise issues for all** - one issue for each place listed that is not \"Not an issue\", named **Clash issue 001** / **Headroom issue 001**, with the elements, the place and the amount written in, **due in 3 working days** (Mon-Fri, Hong Kong holidays left out); an optional Assign to. Make issue fills the same in.",
      "**Save result**: keep a clash or headroom result under a name for everyone on the project - as many as you like; pick one under the rule (or under Headroom) to look at it again.",
      "Clash rules can check **against the consultant IFC models** - ticked even when not loaded (they load when the rule runs), or all at once with **Our models x consultant models**.",
      "Headroom: **Not an issue** is kept with the project and holds on every scan, as for clashes.",
      "Every export (spreadsheet, BCF, markup PDF, board picture) offers **Save to Folders** after the download; reports (clash, headroom, issue report) have **Save to Folders (PDF)**. They go to Folders > 00 BIM > Exports. The **weekly report** is kept in 00 BIM > Weekly dashboard every week, and from Dashboard > Export.",
    ],
  },
  {
    version: "2026-10-24", date: "11 Oct 2026",
    items: [
      "Board: every project starts with an **LWK BIM Workflow** board - roles, work stages, the workflow charts (setup, modelling, review, SAM, clash, GBP), CDE states, QA/QC and the BIM audit checklist - as the project's own copy to change. A blank **audit checklist Excel** is put in Folders > BIM QA.",
      "A project that already has boards adds it with **New board** > **LWK BIM Workflow**.",
      "Board: a single line in a shape set to the left (or right) now sits there.",
    ],
  },
  {
    version: "2026-10-23", date: "11 Oct 2026",
    items: [
      "3D: with a section box on, **Fit** frames what is inside the box, not the whole model far away.",
      "Chat: each project's channel has **its own colour** and initials; its topics take the same colour.",
      "Phones: Save and Cancel in dialogs (clash rules and others) stay in sight at the bottom, clear of the rounded corners. The profile menu opens inside the window wherever the button is.",
    ],
  },
  {
    version: "2026-10-22", date: "11 Oct 2026",
    items: [
      "**One profile button** at the top right of every page: Work offline, Admin, Account, Theme and Sign out. The connection and Offline show by themselves only when something needs saying.",
      "Sheets: **View ▾** holds Split, Compare, 2D + 3D and Links; the markup properties appear only while drawing or editing a markup; **👁 Markups** and **Hide closed** are at the top of the issue list, as on 3D.",
      "Tasks and Calendar: one **Filter** button (\"Filter · 2\") instead of a row of drop-downs.",
      "Dashboard: **Export ▾** - Report, Spreadsheet, and now **BCF** of the issues the filters show.",
    ],
  },
  {
    version: "2026-10-21", date: "11 Oct 2026",
    items: [
      "3D: a **tidier header**. **Walk** and **Fit** are under the view cube; **Shaded / White / X-ray** and **Depth** at the top of **Display**; **Hide issues** and **Hide closed** at the top of **Issues in 3D**. **Drawing** is now **Plan overlay**.",
      "The 3D left panel is in **three coloured groups**: **Model** (blue), **Tools** (teal) and **View** (amber).",
      "Folders: **drag folders in the tree** too, hover on a closed folder to open it, hold **Ctrl** to copy.",
      "Folders: **versions**. Upload a file of the same name and choose **New version**; **⋯ > Versions** opens, downloads or brings back an earlier one.",
    ],
  },
  {
    version: "2026-10-20", date: "11 Oct 2026",
    items: [
      "Clash check: a big run no longer stops silently - the panel says how many pairs and how long, with **Check them all** or **Choose floors instead**. The list now shows the clashes of the **place chosen** (whole model, floors, section box), with the rest one click away.",
      "**Selection sets**: save a side of a rule (models, categories, a **name filter**) as a set shared with the project, and pick it in other rules. **All / None** for the models; each rule option explained under it.",
      "Choose the **A and B colours**; a key in the 3D view says which element is A and which is B.",
      "**Export** clashes and headroom places: a **spreadsheet** for Excel, or a **report** with a picture of each place to print or save as PDF.",
    ],
  },
  {
    version: "2026-10-19", date: "11 Oct 2026",
    items: [
      "Clash check: **joins are not clashes** - walls through slabs, finishes and waterproofing under walls, landings into walls, beams into walls and columns. A duplicate, two walls overlapping side by side, or anything through a ceiling still is. (Rule > Leave out joins, on by default.)",
      "A clash opens where its two elements are now, even when the result was saved in another session.",
      "Headroom: **Ignore lower than** now applies to stairs and ramps too.",
    ],
  },
  {
    version: "2026-10-18", date: "11 Oct 2026",
    items: [
      "Clash check: far fewer false alarms - layered walls and floors touching, and surfaces a millimetre apart, are no longer clashes. Open surfaces crossing each other only when the rule asks for it.",
      "A clash rule can take **several models** on each side, or **All models**; check **Floors from ... to ...**. Clicking a clash cuts the storey round it with a **section box** (**Section off** to see all). **Hide under ... mm** filters the list without running again.",
      "Headroom: **Look** draws the height where it is lowest; **Ignore lower than** (1.5 m) leaves out voids under WCs, benches and in ducts; **What counts** chooses the categories (furniture, WCs and fittings are not overhead). The settings are shared with the project.",
    ],
  },
  {
    version: "2026-10-17", date: "10 Oct 2026",
    items: [
      "**Clash check** on the 3D page (left panel > Checks > Clash): set A against set B - in your own model, or against the consultants' models. Click a clash to see it, **Make issue** to raise it; run again to see what is **New** and what has **Gone**.",
      "**Headroom** (Checks > Headroom): **Probe** a floor or a stair tread for the clear height above it, or **Scan** a floor - places under the limit show red on the floor.",
    ],
  },
  {
    version: "2026-10-16", date: "9 Oct 2026",
    items: [
      "**Copy link** to a sheet, an issue, a project or an exact **3D view** (camera, section, floor) - the 🔗 buttons.",
      "**Dark mode**: the bell > Look > Dark (or Auto, to follow your computer or phone).",
      "**Sections fold** on a project's panel and on the Admin page, and stay as you left them.",
      "**Folders** remembers which folders you had open; the sheet list and the chat list keep your place in view.",
      "Notes look the same everywhere, and lists show grey placeholders while they load.",
      "This **What's new** card - shown once after each update.",
    ],
  },
  {
    version: "2026-10-13", date: "8 Oct 2026",
    items: [
      "Projects are listed by status (**Active**, On hold, Completed, Archived), then by name - here and in every project drop-down. The Projects page sorts by any column.",
      "Folders show the **date and time** a file was changed.",
      "Phones: pinch zoom keeps the spot between your fingers.",
    ],
  },
  {
    version: "2026-10-12", date: "8 Oct 2026",
    items: [
      "**00 BIM** in every project's Folders: its 2D sheets and 3D models, always up to date, to open and download (read-only).",
      "3D: show a whole model **in one colour** to compare it with another; ↺ puts it back.",
      "Phones and tablets: documents open with every page to scroll and zoom.",
    ],
  },
];

const SEEN = "lwk-viewer:whatsnew-seen";
const md = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

function css() {
  if (document.getElementById("wn-css")) return;
  const s = document.createElement("style");
  s.id = "wn-css";
  s.textContent = `
#wn-card { position: fixed; left: 16px; bottom: 16px; z-index: 1500; width: 360px; max-width: calc(100vw - 32px);
  max-height: min(70vh, 560px); overflow: auto; background: var(--panel, #fff); color: var(--ink, #1f2430);
  border: 1px solid var(--line, #e2e6ec); border-top: 4px solid var(--accent, #f28022); border-radius: 10px;
  box-shadow: 0 12px 34px rgba(20, 26, 36, .22); padding: 14px 16px 12px; font-size: 13px; }
#wn-card h3 { margin: 0 0 2px; font-size: 15px; }
#wn-card .wn-v { color: var(--muted, #6b7480); font-size: 11px; margin: 10px 0 4px; font-weight: 600; }
#wn-card ul { margin: 0; padding-left: 18px; }
#wn-card li { margin: 4px 0; line-height: 1.4; }
#wn-card .wn-btns { display: flex; justify-content: flex-end; gap: 6px; margin: 12px -16px -12px; padding: 8px 16px 12px;
  position: sticky; bottom: -12px; background: var(--panel, #fff); border-top: 1px solid var(--line-soft, #eef0f3); }
#wn-card .wn-x { position: absolute; top: 8px; right: 8px; border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--muted, #6b7480); }
@media (max-width: 600px) { #wn-card { left: 8px; right: 8px; bottom: 8px; width: auto; } }`;
  document.head.appendChild(s);
}

function card(entries, all) {
  document.getElementById("wn-card")?.remove();
  css();
  const el = document.createElement("div");
  el.id = "wn-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "What's new");
  el.innerHTML = `<button class="wn-x" title="Close" data-wn="x">&#10005;</button><h3>What's new</h3>`
    + entries.map((e) => `<div class="wn-v">${md(e.date)} &middot; version ${md(e.version.slice(5))}</div>`
      + `<ul>${e.items.map((t) => `<li>${md(t)}</li>`).join("")}</ul>`).join("")
    + `<div class="wn-btns">${all ? "" : `<button class="ghost" data-wn="all">Show all</button>`}<button class="primary" data-wn="x">Got it</button></div>`;
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-wn]");
    if (!b) return;
    if (b.dataset.wn === "all") return card(ENTRIES, true);
    el.remove();
  });
  document.body.appendChild(el);
}

/* After an update: what is newer than what this browser last saw, once.
   A browser that has never seen any: the latest entry only. */
export function checkWhatsNew(version) {
  let seen = "";
  try { seen = localStorage.getItem(SEEN) || ""; } catch (e) { return; }
  const fresh = ENTRIES.filter((e) => e.version <= version && (seen ? e.version > seen : e === ENTRIES[0]));
  try { localStorage.setItem(SEEN, version); } catch (e) {}
  if (!fresh.length) return;
  const show = () => card(fresh, false);
  if (document.readyState === "complete") setTimeout(show, 1200); else addEventListener("load", () => setTimeout(show, 1200));
}

export function showWhatsNew() { card(ENTRIES, true); }
