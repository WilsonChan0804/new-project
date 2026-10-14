/* What's new: after each update, a small card lists what changed, once.
 * The list is kept here, newest first; each release adds its entry when
 * it raises LWK_VERSION (nav.js). The bell panel's "What's new" opens the
 * whole list at any time. Nothing leaves the page: what has been seen is
 * remembered in this browser. */

export const ENTRIES = [
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
