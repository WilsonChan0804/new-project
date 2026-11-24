/* What's new: after each update, a small card lists what changed, once.
 * The list is kept here, newest first; each release adds its entry when
 * it raises LWK_VERSION (nav.js). The bell panel's "What's new" opens the
 * whole list at any time. Nothing leaves the page: what has been seen is
 * remembered in this browser. */

export const ENTRIES = [
  {
    version: "2027-03-24", date: "25 Nov 2026",
    items: [
      "**4 · Floors is much faster** - the walls, the core and the E&M left over are worked out in a fraction of the time, and a drag redraws once a frame.",
      "**Edit a unit in place: a floating window** beside the floor plan - drag it by its title bar, resize it from its corner, close it with Done or ×; the floor changes as you edit.",
      "**A unit's own shape** - a plate traced round a unit's walls no longer reads \"outside the plate\": the check uses its rooms out to their outer faces, not its bounding box, and leaves the balcony, UP and A/C platform out. The plate's corners also snap to the units' outer faces.",
      "**Plate corners**: double-click one, or tap it and **× Remove corner** (or Delete), to take it off.",
      "**Passages turn**: tap a passage for its width, **+ Bend** / **− Bend**, and drag its points for an L or a Z. **Core pieces resize in place**: drag their edges, or type their clear sizes.",
      "**JPN 1: corridor and lift lobby** - the exempt part of the corridor (over 1.5 m, up to 2.4 m) and of the lift lobby in front of the lifts (its own minimum and maximum, set in Core and corridor) are drawn as strips down their middle, with their areas, and listed apart.",
      "**▦ Grid** on the plan: a 1 m background with 5 m lines and the structural grid, on or off; things snap to it when on.",
      "**3 · Units: GFA measured to** the external walls' outer face, centre or inner face, and the party walls' centre or outer face (Walls and sides). **The balcony, UP and A/C platform** now start at the external wall's outer face instead of overlapping it (existing ones moved out, their areas the same).",
      "**1 · Site: ▦ Lots** - the Lands Department's Lot Index on the map: the lots and their numbers round a place found by name; click one to set it as the site, with its details and zoning.",
    ],
  },
  {
    version: "2027-03-23", date: "25 Nov 2026",
    items: [
      "**Find a lot: its details and its zoning** - choosing a lot found by its number now puts its boundary straight into the drawing as the site, shows the lot's details from the Lands Department (lot type, number, code, id, last updated, area), and gets its zoning from the Town Planning Board's digital planning data: the plan, each zone on the lot with its share, the building height control on the Plan, and the zone's figures read from the plan's Notes. 3 · Planning and lease fills itself (check the figures against the Notes); the zones are drawn on the map.",
    ],
  },
  {
    version: "2027-03-22", date: "25 Nov 2026",
    items: [
      "**4 · Floors: walls shared, edge to edge** - the core has its full RC wall (250 mm) all round, and pieces side by side share one; every wall on the floor (units, core, party walls) is drawn as one, so a wall two share is drawn once. A unit's outer wall now has its face on the corridor's edge. Dragged pieces snap so their walls overlap.",
      "**Doors and protected lobbies** - staircases, lifts (sliding), the refuse room and riser get their doors; tick **Protected lobby to the staircases** for a lobby between each staircase and the corridor, or add one (or any core piece) from **+ Core piece**.",
      "**E&M found by itself** - what is left between the corridor, the units and the core is found and shown as E&M regions with their areas. The wider corridor's exempt part is shown on the plan with its area; MiC's area by its tick.",
      "**Persons a flat** from each flat's usable floor area (Table B1) for the lifts, unless a number is given. A dog-leg with 2 risers on the half landing has a well as deep as their tread.",
      "**Lengths to 3 d.p.** on Units and Floors (riser 0.175, going 0.225 by default).",
      "**Edit a unit in place** - tap a unit on 4 · Floors, **✎ Edit in place**: its plan opens over the floor (every flat of it changes); **Variant for this flat** makes a copy for that flat only.",
    ],
  },
  {
    version: "2027-03-21", date: "25 Nov 2026",
    items: [
      "**Unit plans: walls join properly** - the walls are drawn as one, so corners and tees close and doors and windows cut them cleanly. A partition in line with a thicker external or party wall now sits **flush with its inside face** (or centre to centre: Walls and sides, or one wall's menu). Doors have a rebated frame at each jamb; the WC is redrawn (cistern, pan, seat).",
      "**Balcony, UP and A/C platform keep their area** - 2.0, 1.5 and 0.8 m²: change one side and the other follows (untick **keep area** to size both).",
      "**4 · Floors: staircase types and the core** - dog-leg, dog-leg with 2 risers on the half landing, or a **scissor** staircase (two in one enclosure); a staircase **behind the lifts** with a passage to it; the core's pieces side by side drawn with one shared RC wall.",
      "**4 · Floors: grid, snapping and doors** - a structural grid with bubbles that units, core and the plate's corners snap to (the corners also to the units and core); the doors inside the units shown.",
      "**4 · Floors in 3D** - **3D** at the top left: the floor group stacked to its storeys, the typical floor open on top with its walls, doors, lifts and staircases.",
      "**Site: Find** - the list of lots found is no longer squeezed.",
    ],
  },
  {
    version: "2027-03-20", date: "25 Nov 2026",
    items: [
      "**Programme PDF: links across pages** - a link between tasks on different pages is now drawn: on one page it runs to the chart's foot (or top), marked **to p.N**, and on the other it comes in at the same place, marked **from p.N**, in the link's own colour and style.",
      "**Programme PDF: the title block** - the office's name is fitted to its box and no longer runs into the title; **Project start / finish** print the first task's start and the last task's finish, as the summary shows.",
    ],
  },
  {
    version: "2027-03-19", date: "25 Nov 2026",
    items: [
      "**Programme: the link box shows whole** - a link clicked low in the window opened its box (type, lag, line, colour) squeezed into a thin strip; it now opens at the click, wholly on screen, as does the right-click menu (and the chat's room menu).",
    ],
  },
  {
    version: "2027-03-18", date: "25 Nov 2026",
    items: [
      "**Unit plans drawn like the office's typical plans** - walls at their real thickness with thin face lines: external and party walls RC in dark grey hatch, partitions block in diagonal hatch, precast in diagonal and dashed hatch; doors with frames, a thin leaf and swing; windows frame - glass - frame; a curtain wall with mullions and its 100 mm RC curb (300 mm high) inside. Fittings and furniture redrawn: WC with cistern, basin, shower tray, bath, kitchen counter with sink and two-ring hob, fridge, washing machine, wardrobe, beds with pillows, sofa, dining set, desk.",
      "**The open kitchen is a zone** inside the living / dining, drawn dashed and resized on its own (drag it by its outline, or its corners) - it no longer moves any wall. The **living / dining is one space with its foyer** (one label and area; **One space (L-shaped)** / **Separate the spaces** on a wall's menu). Existing units change over by themselves, their areas the same.",
      "**Area lines** (tool bar): the **saleable line** (red) and the **GFA line** (blue) on the plan, with the sums under them, to check the table's figures.",
      "**More templates** from the office's typical plans: 1-bedroom (262 ft²), 2-bedroom (360 ft²), 2-bedroom + study (435 ft²) and 3-bedroom with a curtain wall corner.",
      "**4 · Floors: walls and real staircases** - an RC wall round every core piece (250 mm) and party walls between units (200 mm), both settable, taking their space and counted in the GFA; each staircase drawn from its width, the storey height, riser and going - its risers, treads in two flights, landings at least its width, the well, UP / DN.",
    ],
  },
  {
    version: "2027-03-17", date: "25 Nov 2026",
    items: [
      "**Move a programme between a project and My programmes** - in the programme picker, **Move to my programmes …** makes a project programme yours and takes it out of the project (the project's first programme can only be copied), and **Move into a project …** puts one of yours into a project and takes it out of My programmes. **Copy** stays for keeping both. Deleted programmes are kept on the server for the site admin to bring back.",
    ],
  },
  {
    version: "2027-03-16", date: "25 Nov 2026",
    items: [
      "**Programme START, FINISH and duration come from the tasks** - they were measured from Set up's **Project start**, so an old project start (e.g. 2021) gave a START no task has and a far too long duration. Now START is the first task's start, FINISH the last task's finish (click either to go to that task), and a note says when the Project start is well before the first task, with **Use the first task's date** or **Clear it**.",
    ],
  },
  {
    version: "2027-03-15", date: "25 Nov 2026",
    items: [
      "**My programmes** - programmes of your own, not in a project: for a tender or a job that is not in the viewer yet. Open them from **My programmes** on the Projects page, or the programme picker (☰ beside the Task button): **+ New programme of my own** (empty or a copy of the one open), **Share …** with people (view or edit) or everyone in the office, **Copy into a project …** when the job starts. Everything else - tasks, links, calendar, baselines, PDF, MS Project - works the same.",
      "**Beside the milestones** (Set up › Format): the name, name · date, the date only, the responsible party, or nothing.",
      "**Move the whole programme**: Set up › **Move the whole programme …** takes a new start date or a number of working days; every task with its own date moves with it (linked tasks follow their links). Changing the **Project start** in the working calendar now offers the same.",
    ],
  },
  {
    version: "2027-03-14", date: "25 Nov 2026",
    items: [
      "**Find works again** - the Lands Department moved its place search to www.map.gov.hk (the old geodata.gov.hk address now answers \"not found\"); the Find box uses the new address first, then the older ones, and says which answered what if none does. A lot number that finds no lot falls back to the place search.",
      "**Unit editor: a wall moves on its own** - dragging a wall line now moves only that piece and the rooms along it; a room that merely lines up with it (the master bedroom beside the open kitchen) stays. Hold **Alt** to move the whole aligned line as before.",
      "**Balcony, UP and A/C platform on the plan** - click one to move it (drag; it snaps to the walls), resize it, **⟳ rotate** it, **+ BAL / + UP / + A/C** a part or **×** omit one, or **Remove** it (Delete). **+ Balcony / UP …** in the tool bar adds a bay, a balcony, a UP, an A/C platform or a pipe duct: choose it, then click an external wall.",
    ],
  },
  {
    version: "2027-03-13", date: "25 Nov 2026",
    items: [
      "**Find a site by its lot number** - type a lot (STTL 121, TKOTL 137, IL 152, DD 123 Lot 456) in the Find box: the Lands Department's lot search lists the matches, choosing one draws the lot's boundary from the iC1000 Lot Index, and **Use as the site boundary** makes it the site (its area, name and corners). Then pick the plan and zone under Planning and lease, or open the OZP portal.",
      "**4 · Floors, by hand** - drag the staircases, lifts, refuse room and E&M riser anywhere on the plate (the units flow round them), **⟳ rotate** a piece, **swap** two, **+ Lift**, **Remove**, **Reset core**. Units go where they are dropped, snapping to the edges near (Alt: no snap), and can be **rotated**; overlaps, units outside the plate and entrances turned off the corridor are flagged under **Clashes**. Drag the **plate's corners** (or its **+** to add one) to reshape the floor plate on the same page, or **Fit the plate to the units**.",
      "**Unit editor** - a partition can be **shortened**: select it and drag its ends (or type where the solid part runs), the rest opens up; **Full length** puts it back. **⟲ Reset** takes an edited unit back to how it was made or last saved to the office library (Undo brings the edits back).",
    ],
  },
  {
    version: "2027-03-12", date: "25 Nov 2026",
    items: [
      "**Unit and floor plans on a phone**: the plan now fits the screen (smaller margins, labels and dimensions sized to the scale), **pinch to zoom**, drag the background to pan, the mouse wheel zooms on a computer. A zoom bar: **＋ / − / Fit** and **⤢** for the plan full screen (the panel hidden; press again to bring it back). The tool bar scrolls sideways on a phone.",
      "**4 · Floors: edit the typical floor** - tap a unit to **⇋ flip** it, move it **◀ ▶** along the corridor, send it to the **other side**, **swap** it with another or **remove** it; drag a unit onto another to swap them, or onto a gap to move it there. **Corner units at the ends** puts flats at both ends of each side, their end wall a second façade. **+ Add a unit**, **Reset to automatic**, undo / redo; the GFA and the checks follow every change.",
    ],
  },
  {
    version: "2027-03-11", date: "25 Nov 2026",
    items: [
      "**Site study 4 · Floors** - the typical floor of a domestic massing group: its unit mix laid along a double-loaded corridor on the group's floor plate (turned to its long side), each unit with its entrance on the corridor; a core of staircases, lifts, a refuse room and an E&M riser, in the middle or with the staircases at the ends. What is left of the plate is the residual, taken as exempt E&M, with a warning and the plate depth that would fit when it is large.",
      "The floor's **GFA and concessions**: units (their balcony, UP, A/C platform and façade concessions), corridor (a wider corridor's extra width exempt, JPN 1 - the widths to check), staircases and lift shafts counted; refuse room and riser exempt; **MiC** (JPN 8) as a share. **Use in Massing** sets the group's GFA % from the layout.",
      "**Checks**: staircases by the GBP workbook's quick check (Table B1 / B3, the width that would do), the travel from the farthest flat door to a staircase (B11: dead end 15 m, else 24 m), the distance between staircases, and **lifts by service time** (round trip by the CIBSE Guide D method: 5-minute capacity and interval, both settable).",
    ],
  },
  {
    version: "2027-03-10", date: "25 Nov 2026",
    items: [
      "**Unit editor: ▭ + Room** - choose the room kind beside the tool and drag a rectangle on the plan: it snaps to the walls already there (within 0.25 m) and to the 50 mm grid, shows its size as you drag, and is refused if it overlaps a room. A kitchen or bathroom gets its fittings. Make a unit bigger, add a store, a study or a second bathroom.",
      "**⇋ Mirror** - the handed copy of a unit: rooms, doors (hinges too), windows, fittings, the bay and party sides flipped left to right; the areas stay the same. Press it again (or Undo) to go back.",
    ],
  },
  {
    version: "2027-03-09", date: "24 Nov 2026",
    items: [
      "**Unit editor**: dimension chains on every side (each room's span and the overall), and while you drag a wall the two rooms' new sizes and the distance show live. Tools over the plan: **+ Door**, **+ Window**, **✂ Split** a room (a new wall), **+ Fitting**; click a wall to **delete it** (or put it back), **join** the rooms, give it its own thickness or façade; click a door to **flip** its hinge or swing and drag it along the wall; click a fitting to **rotate** it 90° (R) or move it.",
      "**Walls**: external 100 mm and partitions 75 mm by default, each changeable. **Façades** per external wall: RC with windows, **curtain wall** (PNAP APP-2: its projection not GFA) or **precast façade** (JPN 2: up to 150 mm exempt, under the 10% cap).",
      "**Balcony, UP and A/C platform as one bay** (each still counted by its own rule). **Update in the office library** or **Save as new** after editing.",
    ],
  },
  {
    version: "2027-03-08", date: "24 Nov 2026",
    items: [
      "**Units drawn as real plans** - rooms are now placed freely on a 50 mm grid, so a unit can have the stepped outline of a real flat; drawn like a sales brochure: thick external walls, partitions, door swings, bath, WC and kitchen counter, open kitchens without a wall, and bilingual labels (客/飯廳 LIV./DIN., 主人睡房 M.B.R. ...).",
      "**New templates traced from the references**: Park Silicon · Palo Springs 1-room 318 ft² (2A-B) and 1-room E, 3-room 576 ft² (2B-A) and 524 ft² (2B-B), Emerald Avenue 2-room 419 ft² - each scaled to its brochure's saleable area, with its balcony, utility platform, A/C platform and pipe duct.",
      "**Drag any wall line** on the plan (the whole line moves, Alt for one piece only); rooms, doors and the extras are listed to type their sizes. Units made before are converted.",
    ],
  },
  {
    version: "2027-03-07", date: "23 Nov 2026",
    items: [
      "**Site study 3 · Units** - residential unit layouts from templates (studio, 1-room, 2-room, 3-room, sized after recent Tseung Kwan O brochures): rows of rooms from the corridor to the façade, each room's width and each row's depth to change, or **drag a partition** on the plan (50 mm steps); the balcony, utility platform and A/C platforms at the façade.",
      "Each unit's **saleable area** (m² and ft², First-hand Sales Ordinance s.8), **unit GFA** and **concessions** - balcony (JPN 1: 50%, at most max(1 m², 2.5% UFS) ≤ 3 m²), utility platform (JPN 2: 50%, at most 0.75 m²), A/C platform (APP-19: ≤ 750 mm not counted) - with warnings for narrow rooms. **Save to the office library** shares a unit with every project.",
      "In Massing, a domestic floor group takes a **unit mix** (units × number a floor): the flats, the average saleable area and saleable ÷ domestic GFA.",
    ],
  },
  {
    version: "2027-03-06", date: "23 Nov 2026",
    items: [
      "**3D surroundings: how far around** - choose ± 250 / 500 / 1,000 / 1,500 m beside 🏙 Surroundings; the map on the ground and the buildings now cover the same square. A wide area is built on the server in the background (the bar shows how far it has gone) and kept for a month.",
      "Some newer buildings are not yet in the Lands Department's 3D data; draw those with **+ Context** (Plan view) and their height.",
    ],
  },
  {
    version: "2027-03-05", date: "23 Nov 2026",
    items: [
      "**Massing: the real surroundings in 3D** - **🏙 Surroundings** brings in the buildings around the site from the Lands Department's 3D Spatial Data (CSDI, 3D Tiles), in light grey, with the map on the ground; the buildings on the site itself are left out. The first load of a site takes up to a minute, then it is kept on the server.",
    ],
  },
  {
    version: "2027-03-04", date: "23 Nov 2026",
    items: [
      "**Massing: ↶ Undo / ↷ Redo** (Ctrl+Z / Ctrl+Y) for every change to the blocks, floors and footprints.",
      "**The site's edges are numbered E1, E2 ...** on the map (Site and Massing) and named so in every list, with the street on them (\"E3 · Fuk Hang Tsuen Road\").",
      "**Shape the footprint**, explained: *Fill the site* set back a distance from every edge (then click an edge for its own), *Rectangle* width × depth with its long side parallel to an edge, *Grow / shrink* by a distance.",
      "**⫽ Split** a floor group between uses (retail 70% and lobby 30%, say): the plate is cut in strips by share, each with its own use, GFA % and colour.",
    ],
  },
  {
    version: "2027-03-03", date: "23 Nov 2026",
    items: [
      "**Massing colours** - a brighter set by use (domestic, hotel, office, retail, F&B, lobby, clubhouse, refuge, GIC, landscape, car park, E&M, loading, basement, transfer plate) on a light blue-grey ground, with darker storey lines; **☀ Shadow** turns the shadows on or off.",
      "**A different floor plate for some floors**: ▱ on a floor group gives those floors their own plate (a set-back tower top, a smaller podium level) to edit on the plan; right-click ▱ to go back to the block's.",
      "**⌖ Snap** (on by default): corners snap to the site, the other footprints, the neighbours and the grid; hold Alt for a free point. **＃ Grid** with its spacing and rotation, or squared to a site edge.",
    ],
  },
  {
    version: "2027-03-02", date: "23 Nov 2026",
    items: [
      "**Massing: lighter colours** (pastel blocks, a pale site, white streets, soft shadows) and the **areas follow while you drag** a corner or the block; click the dot on a footprint edge to **add a corner**, right-click one to remove it. Each edge shows its length and its **set-back to the boundary**.",
      "**GFA % gives the concession**: the floor area not counted is the concession (with an extra for balconies or utility platforms outside the footprint); only domestic and non-domestic ones count toward the 10% cap. **Transfer plates and E&M zones** can be layers that are **not storeys** (the St. tick): they add height but not storeys or refuge counts.",
      "**Precise footprints**: the site set back by a distance (click a site edge on the plan for its own set-back), a rectangle **width × depth squared to a site edge**, or a footprint grown / shrunk by a distance; **📏 measure** in Massing. **Elevation** (from any site edge, levels in mPD and the height limit dashed red) and **Section** (a slider), PNG of each; **+ Context** draws neighbouring buildings with their height, and the Lands Department map lies under the 3D view.",
    ],
  },
  {
    version: "2027-03-01", date: "23 Nov 2026",
    items: [
      "**Site study 2 · Massing** - add a **podium** (the site set back) and **towers** (a rectangle of the area you give) standing on it; drag a block's corners or ✥ on the map. Each block is a stack of floor groups: use (domestic, non-domestic, clubhouse, car park, E&M, refuge, lobby, void), storeys, storey height, the share counted as GFA and the concessions per floor.",
      "**Live figures against what governs** (B(P)R / OZP / lease from Site): domestic, non-domestic and total GFA, site coverage, height in mPD and storeys - red when over. **Refuge floors** (FS Code B18): from which storey a refuge floor is needed, or a refuge roof up to 40 storeys; the storey due shows green in 3D.",
      "**3D view**, coloured by use; **OBJ** export (SketchUp, Rhino, Revit), **PNG**, and **Send GFA and height to the GBP workbook**.",
    ],
  },
  {
    version: "2027-02-28", date: "23 Nov 2026",
    items: [
      "**Site study: + Add street** - type the street's name (and width), then click the boundary edges along it on the map; ⌖ picks more edges later, × removes the street.",
      "**📏 Measure** - click both sides of a street (or any two points; it snaps to the boundary, Alt for free) to read the distance; each measure can be **used as the width** of a street.",
    ],
  },
  {
    version: "2027-02-27", date: "23 Nov 2026",
    items: [
      "**Site study: Finish keeps what you traced** - the boundary is no longer scaled to the site area by itself; **Match area** does it when you ask, either **scale about centre** or **keep street edges** (the street edges stay; the other corners - or, when every corner is on a street, the back edge - move).",
      "**Streets by name**: the pieces of a curved road are one street (click the next edge and it joins), each street has a name and a width, and streets meet at a corner across a short splay. A street with no width counts (taken as 4.5 m or more), so three streets give **class C** as they should.",
      "**OZP for any plan**: type the plan no. and zone - a plan in the list or the **office list** fills in. **Read the Notes PDF** (from the OZP portal) finds each zone's plot ratio, site coverage, height and storeys in the Notes' wording, to use and **save to the office list** for everyone.",
    ],
  },
  {
    version: "2027-02-26", date: "23 Nov 2026",
    items: [
      "**Site study: Planning and lease** - choose the OZP and the zone and its restrictions fill in (the Tseung Kwan O OZP S/TKO/32 is in, e.g. R(A)9: domestic PR 7.5, non-domestic 0.3, height on the Plan); for another plan type them from its Notes (the OZP portal link is there). Add the lease's GFA, site coverage, height and storeys.",
      "**Development potential** - B(P)R, the OZP and the lease side by side for the domestic, non-domestic and total GFA, site coverage, height and storeys; the strictest governs and says which one.",
    ],
  },
  {
    version: "2027-02-25", date: "23 Nov 2026",
    items: [
      "**Site study** (new page, beside Codes) - find the site on the Lands Department map (or the aerial photo), **Draw boundary** by clicking its corners or start from a **Rectangle**, and **Match area** scales it to the site area you give. Drag a corner to move it, click the dot on an edge to add one, right-click a corner to remove it.",
      "Click an edge (or tick it) to mark a **street** and give its width: the **class of site** follows (B a corner on two streets, C on three; under 4.5 m does not count). **Send to GBP workbook** puts the area and class into step 1; the workbook has a **Site study** link back. Kept with the project, shared like the workbook.",
    ],
  },
  {
    version: "2027-02-24", date: "23 Nov 2026",
    items: [
      "**GBP workbook: Clear** - each step has a **Clear** button and the top a **Clear all**, with **Undo** for 10 seconds. The workbook is kept with the project: everyone on it sees the same figures (members can change them), so Clear asks first.",
      "**The site sketch**: each street on its side (Street 1 / 2 / 3) with the **corner** where two meet, and the site always shows round the building, even at 100% site coverage.",
    ],
  },
  {
    version: "2027-02-23", date: "23 Nov 2026",
    items: [
      "**GBP workbook: one simple workbook** - the four steps are the workbook now: 1 Site, 2 Occupancy & exits (with travel distance), 3 Staircase discharge, and new **4 GFA concessions: the 10% cap** - type the area of each feature you use (balcony, utility platform, AHU room ... from PNAP APP-151 Appendix A) and see the capped total against 10% of the GFA, with a bar and the pre-requisites to meet.",
      "The old room-by-room and area-by-area tables are retired; the site's figures from the model (GBP area plans) and **Excel** are under the steps (**From the model**). The guides' GFA button opens step 4.",
    ],
  },
  {
    version: "2027-02-22", date: "23 Nov 2026",
    items: [
      "**GBP Quick check: travel distance (FS Code B11)** - step 2 now gives, for the use chosen, the limits within the flat / guestroom, the dead end, the maximum travel distance and 48 m between staircases (B11.2, B11.3), with a plan of them; a **balcony approach** switch (B10.6) and **check your design** with your own distances. Use Classification 5a at 12 m or more above G/F uses **Table B5**.",
      "**Project workbook: the Site page** in the new look - big figures, the street / site / building sketch, and the composite (reg 21) shares as bars.",
    ],
  },
  {
    version: "2027-02-21", date: "23 Nov 2026",
    items: [
      "**GBP Quick check: the site sketch** - its labels (site coverage, height, site area, street) now sit outside the drawing and are never cut off, whatever the site coverage or the height.",
    ],
  },
  {
    version: "2027-02-20", date: "23 Nov 2026",
    items: [
      "**GBP workbook: Quick check** - opens first, three steps with big figures and pictures: **1 Site** (class A / B / C, height, area: max SC and PR, a street / site / building sketch; composite use with a slider for the non-domestic PR and the domestic PR left, reg 21), **2 Occupancy and exits** (Table B1 use and area: persons, Table B2 exits and widths, then check your door widths), **3 Staircase discharge** (floors, sprinklers, staircases and width: each staircase's share against Table B3 / B4). Kept with the project; **Copy** puts a step's figures as text.",
      "The detailed workbook from the model is one click away (**Project workbook**), and the guides' workbook buttons open the matching step.",
    ],
  },
  {
    version: "2027-02-19", date: "23 Nov 2026",
    items: [
      "**Programme: zoom a step at a time** - Ctrl or Shift + wheel over the chart zooms a little each notch (it jumped straight to Fit), and new **− / +** buttons beside Day / Week / Month / Quarter do the same (or the − and + keys). Your zoom is kept for next time.",
    ],
  },
  {
    version: "2027-02-18", date: "23 Nov 2026",
    items: [
      "**Programme: dragging a task with a \"finish no earlier than\" date** (many come with it from MS Project) now moves it: the drag clears that date, as MS Project does, and says so. Before, the bar stayed and the message wrongly blamed a predecessor.",
    ],
  },
  {
    version: "2027-02-17", date: "23 Nov 2026",
    items: [
      "**Programme: move several bars at once** - select rows (Ctrl or Shift + click), then drag one of their bars: they all move by the same time, links among them kept; one Undo puts them back. **Alt+← / Alt+→** moves the selection a working day. A task held by a predecessor outside the selection is reported.",
      "**Programme: Set up on a phone** - the working calendar, title block, categories and format can be changed from a phone too (the rest of the editing stays on a computer or iPad).",
    ],
  },
  {
    version: "2027-02-16", date: "23 Nov 2026",
    items: [
      "**Admin > Viewer update** (site admins) - see which version the server runs and the newest on GitHub, and press **Update now**: the server checks the download, keeps the current code (Undo the last update), updates itself and restarts in about 10 seconds. The data, run.bat and the passphrase are never touched.",
      "**Codes > Library is for site admins** - everyone still finds and opens the documents from the Knowledge base and the search.",
    ],
  },
  {
    version: "2027-02-15", date: "23 Nov 2026",
    items: [
      "**iPhone: the orange header clears the Dynamic Island** - when the viewer runs from the Home Screen, the header now starts below the status bar (and beside the notch on its side), on every page.",
    ],
  },
  {
    version: "2027-02-14", date: "23 Nov 2026",
    items: [
      "**Programme on a phone** - upright or on its side, the toolbar is one row you swipe sideways (Fit and View are back), and the summary and categories take one line each, so the chart gets most of the screen.",
    ],
  },
  {
    version: "2027-02-13", date: "23 Nov 2026",
    items: [
      "**Programme: the divider** - dragging the line between the table and the chart now hides the table's right-hand columns under the chart, as in MS Project, and the chart always reaches the right edge (Fit stays fitted).",
      "**Programme: a label for each bar** - right-click rows > **Label beside the bar**, or Properties > **Beside this bar**: task name, start - finish, **name + dates**, **finish date**, responsible, % done or nothing - for those rows only. Format > Beside the bars sets the rest, and the PDF prints the same.",
    ],
  },
  {
    version: "2027-02-12", date: "22 Nov 2026",
    items: [
      "**Knowledge base: source documents open** - a link to the BD's PDF or page (marked ↗) now opens in a new tab - the Library's own copy when it has that document - instead of \"www.bd.gov.hk refused to connect\" inside the page.",
    ],
  },
  {
    version: "2027-02-11", date: "22 Nov 2026",
    items: [
      "**Knowledge base: your pins and reading history follow you** - kept on the server under your account, so a page or clause you pin on the office PC is there on your iPad. Each person sees only their own. It starts once the knowledge base's script uses it.",
    ],
  },
  {
    version: "2027-02-10", date: "22 Nov 2026",
    items: [
      "**Codes: the search is in the Knowledge base** - one tab now. The search bar is at the top (press /); the results open in a panel at the right while the page you read stays open, and a result opens its page on the left. On a phone, the round 🔍 button at the bottom right.",
      "**Guides and the GBP workbook together** - a topic guide's **Calculate in the GBP workbook** button opens this project's workbook at that part beside the guide; each part of the workbook links back to its guides (**Why? 依據**). The buttons appear as the knowledge base's author adds them.",
    ],
  },
  {
    version: "2027-02-09", date: "22 Nov 2026",
    items: [
      "**Programme: several programmes in a project** - the name at the left of the Programme's toolbar lists them: the master programme, a phase, a fitting-out, an option. **+ New programme** makes one empty or as a copy of the one open (tasks, links, calendar, set-up); rename or delete it from the same list. Each keeps its own history, baselines and view; the existing programme stays as the first.",
    ],
  },
  {
    version: "2027-02-08", date: "21 Nov 2026",
    items: [
      "**Programme: import .mpp** - Import reads an MS Project file (.mpp) directly, as well as XML and CSV: tasks, outline, durations, links with type and lag, the calendar and constraints. A test programme of 44 tasks gave the same dates as MS Project, all but one manually scheduled summary.",
      "**Finish no earlier than** - a new field in Properties (MS Project's FNET / MFO constraint): the task may not finish before that day. It is read from and written to MS Project.",
      "**Export to .mpp:** MS Project's own format can only be written by MS Project. Export > MS Project XML, open it in MS Project and File > Save As > .mpp. The server needs Java and MPXJ for .mpp import; run.bat installs MPXJ and says if Java is missing.",
    ],
  },
  {
    version: "2027-02-07", date: "21 Nov 2026",
    items: [
      "**Knowledge base: Thin pages** (Codes > Library > Knowledge base) - the summaries too brief to answer from, by tier (A key documents, B other notes and regulations, C ADM / ADV), each with what is missing; download the list for the knowledge base's author.",
    ],
  },
  {
    version: "2027-02-06", date: "21 Nov 2026",
    items: [
      "**Knowledge base: edit with your viewer name** - once the knowledge base's script uses the viewer (the note for its author is in docs/kb-viewer-contract.md), anyone signed in can edit a paragraph (✎). It shows at once with 'Edited by NAME', Show original and the page's edit history; its author or a site admin can undo it.",
      "Search finds the edited wording and marks the card 'edited by'. **Library > Knowledge base** lists the edits, with Undo and **Download edits** for the author to fold them into the source.",
      "Search cards show a **draft** badge for pages marked Draft, and read the pages' keywords.",
    ],
  },
  {
    version: "2027-02-05", date: "21 Nov 2026",
    items: [
      "**Codes: the knowledge base** - the office's summaries of the Ordinance, regulations, Codes of Practice, PNAPs and APSEC are now in **Codes > Knowledge base**, as they are written, with their menus, English / 中文 tabs and diagrams. The viewer follows the branch they are written on and updates itself every day.",
      "**Search answers from the summaries first**: the topic guides, summaries and current APSEC positions that answer, with Quick facts and diagrams, then the official clauses. **Read here** or open the page.",
      "**Library** is now a tab of its own; site admins connect the knowledge base there (repository, branch, read-only token, Update now).",
    ],
  },
  {
    version: "2027-02-04", date: "20 Nov 2026",
    items: [
      "**Programme: right-click** a row or bar for Properties, insert, cut / copy / paste / duplicate, move up / down, indent, link, category, colour, fold, create tasks, chat - on one row or a whole selection. **Properties** opens as a panel at the right, and edits several rows at once.",
      "**Colours and categories** (Design, Statutory, Tender, Construction ...) with a legend that shows one at a time; critical tasks keep their colour with a red outline. **Links** get a line style (solid, dashed, dotted), a colour, and can be *related only* - drawn, but they move no dates.",
      "**Show to level** 1 / 2 / 3, **middle-mouse pan**, Ctrl + wheel zoom, drag the timescale to stretch it, drag column edges to widen them, double-click an empty spot for a new task. **View > Format**: date style, weeks or days, row height, text size, bar labels and more.",
      "**MS Project XML** export and import, and the **PDF several pages wide** (the pages across repeat the ID and task name), with the colours and line styles.",
    ],
  },
  {
    version: "2027-02-03", date: "20 Nov 2026",
    items: [
      "**Programme** - a new page for the project programme, the easy way to do what MS Project does: type the tasks, durations (working days, Hong Kong holidays skipped) and predecessors (3, 3FS+2d, 5SS ...) or drag between bars. The **critical path** shows in red, with total and free float.",
      "**Baselines** keep a version (e.g. the tender programme): grey bars and the finish variance show what slipped. **% done**, the status date and a progress line show where the job stands.",
      "**Export > PDF** for the client: A3 / A4, a title block, the chosen columns, legend and remarks. **CSV** for Excel, and **Import** from Excel or MS Project. **Set up** has an architectural template to start from.",
      "An activity can **create or link a task** (Tasks) and be **discussed in chat**; the links open the Programme at that activity.",
    ],
  },
  {
    version: "2027-02-02", date: "20 Nov 2026",
    items: [
      "**Codes is now search only, with no AI:** one **Search** button (or Enter) gives the Quick facts, the diagrams and the clauses. Ask, the API key and model settings and the cost notes are gone, and nothing is sent outside the server.",
      "**Recent ▾** lists your searches - click one to search again. The tab is now **Search the codes**.",
    ],
  },
  {
    version: "2027-02-01", date: "20 Nov 2026",
    items: [
      "**Codes: Quick facts** (no AI) - the answer at a glance: the clauses about what you asked with their figures and conditions, e.g. dead end 24m / 15m for Use Classifications 1 and 2, 18m for all others (B11.2).",
      "**Diagrams in the chat:** the diagrams the clauses refer to show as pictures - click to enlarge, open the page or download. With Ask on, Claude also reads them and says what they show (D1, D2).",
      "The clauses now read as paragraphs, and a clause number in the question (e.g. B11.3) brings that clause first.",
    ],
  },
  {
    version: "2027-01-31", date: "20 Nov 2026",
    items: [
      "**Codes > Library > Find documents:** the codes, design manuals, PNAPs and practice notes the Buildings Department publishes, searchable by number or words, each marked **in the library** or **newer than the library's**. **Add** downloads one and fills in its details.",
      "**From the web:** paste the address of a PDF and press **Get** - it is downloaded and its title, kind and edition recognised, ready to check and add.",
    ],
  },
  {
    version: "2027-01-30", date: "20 Nov 2026",
    items: [
      "**Codes > GBP workbook:** the project's GBP calculations, worked from the model's rooms and areas (the office's Revit GBP parameters) and anything typed in - one workbook per project, for everyone on it.",
      "**Site, PR & SC** from the Cap. 123F First Schedule; **GFA** by floor with the **APP-151 concessions**, the 10% cap and the AHU limit; **occupant load and exits** by FS Code Tables B1 / B2 for every room and storey; **staircase discharge** by Tables B3 / B4. Each result names its clause; **Excel (all)** keeps the schedules in Folders.",
      "Sanitary fitments, fire resistance and greenery / EVA come next.",
    ],
  },
  {
    version: "2027-01-29", date: "19 Nov 2026",
    items: [
      "**Upload into the right set:** the upload window now asks where the drawings go - **Add to the current set**, **Add to another set**, or **New set** with a name.",
      "**Copy or transfer sheets between sets:** in Move / hide sheets, tick sheets and use **Copy to set \u25be** or **Transfer to set \u25be** (or right-click a sheet). A copy is the drawing only, with a new number; a transfer takes its comments and issues along. **Set \u25be > Copy this set to ...** copies a whole set, e.g. today's Revit sheets to \"Submission 1\" (a later publish does not change the copies).",
      "**Compare with \u25be** now lists the sheets under their sets (Revit sheets, Set: ...), this sheet's own set first.",
    ],
  },
  {
    version: "2027-01-28", date: "19 Nov 2026",
    items: [
      "**Compare: Save \u25be** keeps a lined-up comparison under a name, for everyone on the project: the other drawing, where you moved it to, and the view. A PDF from your computer is kept in Folders (00 BIM / Exports / Compare), so it opens on any computer.",
      "**Back in one click:** pick it under **Compare with \u25be > Saved comparisons**, or right-click the sheet in the list (**\u29c9** shows it has some) > **Open saved comparison**. **Save \u25be** also updates, renames, copies a link to, or deletes it.",
    ],
  },
  {
    version: "2027-01-27", date: "19 Nov 2026",
    items: [
      "**Split view keeps the sizes you set:** drag the divider to share the screen as you like, and only that changes it. Clicking in the other view no longer enlarges it. Drawing there (or **\u21c4 Work here**) still swaps the two sheets, but each half of the screen stays the size it was, and so does a reload. Double-click the divider for halves.",
      "**A project without Revit:** a project added on **Admin > + New project** now works at once. It is in the project list, and Sheets, Tasks, Chat, Board, Calendar and Folders all open. On Sheets, **Import PDF** brings in the drawings, and each page becomes a sheet. A Revit publish can add the model later; the PDFs stay.",
      "**Older projects with no model yet:** **Open in the viewer** on Admin's project list makes them work the same way, with their members.",
    ],
  },
  {
    version: "2027-01-26", date: "19 Nov 2026",
    items: [
      "**Split view on a phone:** one finger pans the second sheet, two fingers pinch-zoom it, and a double tap zooms in. Both sheets now share the screen properly.",
      "**Draw in Split view:** choose a tool and draw in the second pane, or click a markup there. The two sheets swap panes in place, so the one you are working on keeps its spot and gets every tool. **\u21c4 Work here** does the same.",
      "**After a submission:** **Files > Archive all comments ...** archives everything on a sheet, a set or the project under one name (e.g. \"GBP submission\"), and the drawings come back clean. **History \u25be** shows that batch again, makes its PDF, or restores it.",
      "**PDF of a set:** the PDF window now offers the sheets of the set shown, or all sheets in the project, with the counts.",
      "**Tasks: column order.** Drag columns in Customize, or drag a column header, to put Due first or in any order.",
      "**Compare: Align \u25be** lines up a drawing whose setting-out differs. Pick 2 matching points on each and it is moved, scaled and turned to fit, then kept for that pair. Fine-tune with the arrow keys.",
    ],
  },
  {
    version: "2027-01-25", date: "18 Nov 2026",
    items: [
      "**See where it is:** a Model Doctor finding now draws an orange **dimension** on the model where it was measured (the gap, the overlap, how far a wall runs in, the sill over the floor, the wall top to the soffit), with a ring that stays the same size at any distance, so a 5 mm gap can be found. A clash shows its depth the same way. Issues made from them keep the dimension.",
      "**Right-click and several at once** in Doctor and Clash: tick findings or clashes (**\u2611 All shown** ticks them all), then right-click or use the bar to mark them **Not an error** / **Not an issue**, **Count again**, **Make issues** (with who to assign them to) or, in Doctor, **Fix in Revit**.",
    ],
  },
  {
    version: "2027-01-24", date: "18 Nov 2026",
    items: [
      "**Model Doctor in the LWK tab in Revit:** it now shares **Not an error** with the whole project through the viewer, and **Fix queue (N)** lists what the viewer asked to fix and reports back **Fixed in Revit**, or why not.",
      "**Steadier and safer:** each check runs inside Revit's own safe context, one at a time, which removes the cause of the \"unrecoverable error\" crashes. **Fix selected** fixes only the rows selected, the results are checked again after a fix, and each check's fix is undone on its own if it fails. A copy in another design option or phase is no longer taken as a duplicate. It runs on Revit 2022 to 2026, and the CSV opens in Excel with the right characters.",
    ],
  },
  {
    version: "2027-01-23", date: "18 Nov 2026",
    items: [
      "**Model Doctor in the viewer:** 3D > Checks > **Doctor** runs LWK Model Doctor's checks on the models shown, with no Revit needed, and scores the model out of 100. It finds duplicates, overlapping walls, walls that nearly touch, walls and columns, clashes, gaps and duplicates against the other models loaded, doors off the floor, wall bases and tops off the slabs, and components sunk into the floor.",
      "**A finding:** click it to see it. **Not an error** applies to the whole project, and Revit reads the same list. **Make issue** opens a 3D issue at the element. **Fix in Revit** queues the finding for Model Doctor in Revit. **CSV** exports the list.",
      "**History:** each run is kept, and the list shows what is new since the last run and what has gone.",
    ],
  },
  {
    version: "2027-01-22", date: "18 Nov 2026",
    items: [
      "**3D, the same as Sheets:** above **Issues in 3D** there are now **\u2630 Layers**, **Endorsed**, **Archived** and **\u2611 Select**. Tick several issues to Close, Endorse, Archive / Restore or change their Layer together. Archived and endorsed issues and hidden layers leave both the list and the model.",
      "**Right-click in 3D:** an issue in the list, or its pin in the model, now offers **Endorse** (once closed), **Archive** / **Restore** and **Layer**, as on Sheets.",
      "**Counts per model:** each model in the 3D Models list shows its open issues and comments.",
    ],
  },
  {
    version: "2027-01-21", date: "18 Nov 2026",
    items: [
      "**Move from the drawing:** select comments and issues on the sheet, right-click > **Move to another sheet**. The same menu archives, closes or endorses them; on a phone or iPad the selection bar has **Move**.",
      "**A steady Top bar:** with the properties panel at the top, the bar now stays one row at a fixed height, so clicking a comment no longer moves the drawing.",
      "**Layers panel:** make a layer there (**+ New layer**), open a layer (\u25b8) to see its markups on this sheet and drag them onto another layer (tick several to drag them together), or **\u21e5** to move the drawing's selection onto a layer. \u{1F5D1} removes a layer nothing is on.",
      "**Counts in the sheet list:** each sheet shows its open issues (orange), comments (grey), and closed issues (green) when none is open. Archived and endorsed ones are not counted.",
    ],
  },
  {
    version: "2027-01-20", date: "18 Nov 2026",
    items: [
      "**Several at once:** \u2611 Select above the issue list, tick comments and issues, then Close, Endorse, Archive, Move to sheet or change their Layer together. Each is done where you may; the rest is counted.",
      "**Endorse:** a closed issue goes back to whoever raised it to **Endorse** (or reopen with a reason); endorsed issues leave the drawing and the list (**Endorsed** shows them).",
      "**Archive** comments and issues instead of deleting them (**Archived** shows them, Restore brings them back).",
      "**Renumbered drawings:** right-click a sheet > move all its comments and issues to another sheet. Those left on sheets no longer in the viewer show as **\u2026 on deleted sheets** - move, archive or delete them.",
      "**Layers like Photoshop:** \u2630 Layers above the list - an eye per layer, Only, All on / off; the list follows. The PDF window chooses which layers go into the PDF.",
    ],
  },
  {
    version: "2027-01-19", date: "16 Nov 2026",
    items: [
      "**PDF without markups:** in **Files > Sheets as PDF** choose Markups **None** for the clean drawings as exported from Revit, or use **Files > This sheet as PDF (clean)**, or right-click sheets in the list > **Download as PDF (clean)**. One sheet comes down as its own file, unchanged.",
    ],
  },
  {
    version: "2027-01-18", date: "15 Nov 2026",
    items: [
      "**Sheets zoom as in PDF-XChange:** 100% now means the sheet at its actual size (it used to mean fitting the window's width, so the same sheet read differently on each screen). Click the % for **Actual size**, **Fit width**, **Fit page**, 25-400% or a % you type. **Fit** and Ctrl+0 still fit the width.",
    ],
  },
  {
    version: "2027-01-17", date: "14 Nov 2026",
    items: [
      "**Comment Styles Palette** (as in PDF-XChange): the styles are tiles drawn in their own line and fill, with a ready-made set - Red, Purple, Indigo, Blue, Green, Yellow, filled and as strokes, and Black Stroke - then yours and the project's. **\u25a6 Palette** opens them all in a window you can keep open and drag anywhere.",
      "**Board fonts:** a font button for stickies, text, shapes and mind map topics (including \u5fae\u8edf\u6b63\u9ed1\u9ad4 and \u65b0\u7d30\u660e\u9ad4); with words chosen while typing, only those words change.",
      "**Mind map structures** (as in Xmind): Mind map, Logic chart, Org chart, Timeline (across or down), Fishbone and Tree table - switch a map at any time from the structure button.",
      "**Mind maps as tasks, both ways:** make a topic, a branch or the whole map into tasks in a task list (a branch becomes a task with sub-tasks). Topics show priority, progress, due date and who; set them in the topic's task panel. Changes on the Tasks page come back to the board, and the task links to its topic.",
    ],
  },
  {
    version: "2027-01-16", date: "14 Nov 2026",
    items: [
      "**Sheets - where the panels sit:** View \u25be > **Panels**: **Top** (the tools in the row above, the properties in a bar under it, as before), **Float** (as now) or **Free** (drag the tools and the properties anywhere by their grip; double-click a grip to put it back).",
      "**Saved styles:** press **+ Save style** at the top of Style to keep a look (colours, weight, line type, opacity, font, size) under a name; click it to put it on the selection or on the next markup. Yours follow you to every device; project admins can share styles with everyone on the project.",
      "**More colours:** the palette has a full grid of colours, **My colours** (add any colour, or type its #code) and the project's colours, besides the recent ones.",
      "**Match properties** is now at the foot of the properties panel (the paintbrush) and on the right-click menu.",
      "**Raise issue:** the Assign to list shows above the form again.",
      "**Board:** bold, italic, underline or colour just the words you choose while typing (Ctrl+B / I / U too); text boxes can be pulled taller; sticky notes grow and shrink with their words and text size; **Group** (Ctrl+G) pictures, notes and shapes so they move, copy and delete as one (Alt-click picks one inside).",
    ],
  },
  {
    version: "2027-01-15", date: "13 Nov 2026",
    items: [
      "**3D: one menu on right-click.** On Windows the browser's own menu (Back, Refresh, Save as ...) opened on top of the viewer's right-click menu; now only the viewer's opens. The same on the Sheets page.",
      "**Help has new pictures** of the header, the Sheets page (tool strip, zoom bar, the new properties panel), Board, Tasks, Chat, Calendar, Folders, Dashboard and Projects. The 3D pictures follow.",
      "The Raise issue form now opens above the properties panel instead of under it, and the Sheets row above the drawing stays on one line (the sheet's name shortens instead).",
    ],
  },
  {
    version: "2027-01-14", date: "12 Nov 2026",
    items: [
      "**The Sheets page, redesigned:** the tools are a strip down the left of the drawing (a small corner triangle opens a tool's family), the zoom, Snap, rotate and Fit sit in a bar at the bottom right, and the sheet's number, name, paper size and scale head the row above.",
      "**A new properties panel** floats at the top right of the drawing: the markup's type and who made it, then **Style** (line, fill and text colours, weight, line type, opacity), **Text** (font, size, alignment) and **Position & size** (X, Y, W, H, angle, %, scale, rotate and mirror), the layer, and Issue / copy / paste / group / delete along its foot. Each part folds from its title, **-** folds the panel and **x** lets go of the selection.",
      "**iPad and phone:** on an iPad the strip and panel stay beside the drawing (the panel starts folded when the drawing is narrow). On a phone the tools run along the bottom, the panel is a sheet above them that opens from its title or from **...** on the bar over a selection, and the zoom bar sits at the top right.",
      "The Route and Area panels, Find & replace and the issue list's tabs and filters take the same look.",
    ],
  },
  {
    version: "2027-01-13", date: "12 Nov 2026",
    items: [
      "**Admin > Storage** (site admins): how full each of the server's disks is, with the free space (red over 80 %), what the viewer keeps - published sheets and 3D models, Folders files, chat files, pictures, recently deleted, update backups - and the largest projects. **Keep the newest 5** clears older update backups.",
      "**Properties as a column:** on the Sheets page the layer, colours, weight, font, size and position now sit in a column at the top left of the drawing instead of a bar that scrolled sideways. Click its title to fold it to a small tab (remembered on this device).",
    ],
  },
  {
    version: "2027-01-12", date: "11 Nov 2026",
    items: [
      "**Who and when on every comment:** hover a markup on the sheet to see who made it and when, and who changed it last (an issue shows its number and title first). Selecting one says the same in the status line; several say whose they are.",
      "**Sheet PDFs look like Revit's own export:** the add-in now exports the sheets with a PDF setup saved in the model (choose it under **PDF settings** in the auto-export job), else the model's setup named **LWK Viewer**, else Revit's Export PDF defaults - before, some settings kept the API's own defaults, and area colour fills round linked columns came out wrong. Update the LWK add-in and publish again.",
    ],
  },
  {
    version: "2027-01-11", date: "11 Nov 2026",
    items: [
      "**Transform box for markups:** right-click > **Transform (resize box)** (on a tablet: **Resize** on the selection bar) puts a box with eight handles round the selected markups. A corner resizes keeping the proportions, text size and line weight with it (hold **Shift** to stretch freely); a side handle stretches one way only. The opposite corner or side stays put, and W x H shows as you drag. Esc ends it; one Ctrl+Z undoes each drag.",
    ],
  },
  {
    version: "2027-01-10", date: "10 Nov 2026",
    items: [
      "**Callout width:** drag the small handle on the outer side of a callout's box to set the width its text wraps at - a long line becomes several. Press the handle twice to fit the text again.",
      "**Text box:** the text wraps at the box's width (drag a corner or type W), and the box now grows downwards when the wrapped text needs more room instead of the words running out of it.",
      "**Wrapping Chinese and long words:** text with no spaces (Chinese, or a long reference) now wraps too; before, it ran out of the box.",
    ],
  },
  {
    version: "2027-01-09", date: "10 Nov 2026",
    items: [
      "**Mirror markups:** **⇄** (left-right) and **⇅** (up-down) beside the rotate buttons, or right-click > Mirror, mirror the selection about its middle. Text stays readable and pictures are not turned back to front; clouds keep their bumps outward. One Ctrl+Z undoes it.",
      "**Scale by a percentage:** the new **%** box beside W / H scales the selection evenly about its middle, text size and line weight with it (type 50 or 200). Dragging a corner of the selection does the same by eye; W / H stretch.",
      "**Fix: the Route and Area panels really close.** A style rule kept them on screen even when they were closed - so × seemed to do nothing, and a panel stayed after its tool was put away.",
    ],
  },
  {
    version: "2027-01-08", date: "10 Nov 2026",
    items: [
      "**Find & replace on a sheet:** **Ctrl+H** (or **View ▾ > Find & replace**) changes words in the text of the sheet's markups - text, text boxes, callouts, stamps - and, when ticked, its issues' titles and descriptions. Match case, Whole word, Find next, Replace or Replace all; one Ctrl+Z undoes it.",
      "**Fix: the Route (and Area) panel closes.** Its **×** often did nothing, because the panel was rebuilt each time the drawing redrew (moving the pointer, other people's markups arriving) - between pressing and releasing the button. It is now rebuilt only when what it shows changes.",
      "**Fix: copy and paste after a snip.** A picture snipped earlier (Snipping Tool) stayed on the clipboard, and Ctrl+V pasted it with the markups copied after it. The last thing copied is now pasted - the markups, or a picture snipped after them - not both.",
    ],
  },
  {
    version: "2027-01-07", date: "10 Nov 2026",
    items: [
      "**Fix: keys on the Sheets page.** Ctrl+C / Ctrl+V (and Ctrl+A, Ctrl+G, Ctrl+Z) did nothing with **Caps Lock** on, and the tool keys (V for Select ...) did nothing with a **Chinese input method** switched on. After choosing in a drop-down of the properties bar (Layer, Line, Type ...), V changed the drop-down instead of picking Select: a click on the drawing now gives the keys back to it.",
      "**The scale of every Revit view:** a measurement takes the scale of the view it is in - also a plan with its **crop region off**, a drafting view or a detail, which got none before (the title block was tried, and often says nothing). Republish the sheets with the updated add-in for this; on sheets published earlier it works when all the views share one scale. The **1:** box shows the scale found (*auto 1:100*) or lists the views' scales.",
      "**Uploaded PDFs:** with no SCALE label in the title block, a scale written on its own under the views' titles (*1 : 100*) is used when they all agree.",
    ],
  },
  {
    version: "2027-01-06", date: "10 Nov 2026",
    items: [
      "**Codes - ask the building codes:** a new **Codes** page answers questions on the Buildings Ordinance, its Regulations, PNAPs, Codes of Practice and the office's notes, from the office's own library. The answer comes only from the clauses it finds and cites each one; click a citation to see the clause, its edition and page, and open the PDF at that page. English or Chinese; follow-up questions carry on.",
      "**Find clauses** searches the library with no AI (clause numbers and short names like MOE, TRS, FRR work too).",
      "**For site admins:** **Library** adds documents (PDF, Word, text) and office notes, marks old editions superseded, and sets up the answers - choose the Claude model and add the API key (pay per question, no subscription; the month's cost shows there).",
    ],
  },
  {
    version: "2027-01-05", date: "7 Nov 2026",
    items: [
      "**The Route and Area panels keep out of the way:** they sit at the top right of the drawing, no longer over the issue list beside it. **–** folds a panel to its title, **×** closes it; a small **⚙ Route** / **⚙ Area** chip brings it back, and it comes back by itself the next time you pick the tool.",
      "**⌖ Snap button** in the toolbar (beside the 1: scale box) turns snapping to the drawing's lines on and off - lit when on. **F3** does the same, as in CAD; hold **Alt** to place one point freely.",
      "**Photos open in the page:** tapping a photo in a chat, a task or a query shows it large with a **×** to close (or tap beside it, press Esc, or the phone's Back). **‹ ›** or a swipe go to the message's other photos, pinch or double-tap to zoom, and **Open original** / **Download** are below. Before, on a phone it opened the bare picture with no way back.",
    ],
  },
  {
    version: "2027-01-04", date: "6 Nov 2026",
    items: [
      "**◠ Arc and ⌒ Curve are easy to find:** they show at the bottom right of the drawing as soon as you pick Polyline, Polygon, a freeform Cloud or Area (by points) - before the first click - and stay on screen however far you zoom in or scroll (before, they could be off screen). ✓ Finish sits beside them while drawing.",
      "**Fix:** selecting a markup no longer nudges the whole drawing (the properties bar appearing above it pushed it down).",
      "**Fix:** in split view, panning the right-hand sheet with the middle mouse button no longer runs away into a corner (the browser's own auto-scroll took over).",
    ],
  },
  {
    version: "2027-01-03", date: "6 Nov 2026",
    items: [
      "**Fix: Pick lines takes the whole curve.** A curved wall picked was only taken in part (and then carried on straight) where the drawing draws one arc as several curves or as many short lines. The curve is now followed piece by piece to where it meets the walls.",
      "**Mix points and curves:** while clicking points (Area by points, polyline, polygon, freeform cloud), **⌒ Curve** (beside ◠ Arc) makes the next click follow a curve of the drawing - from your last point (snap it onto the curve) along the curve to its end. Then carry on clicking points.",
    ],
  },
  {
    version: "2027-01-02", date: "6 Nov 2026",
    items: [
      "**Area > Click inside always leaves out dimensions:** dimension lines, their tick marks and extension lines are recognised and ignored by themselves (**Ignore dimensions**, on). There is no need to ignore whole line weights any more - remove the 0.1 mm / 0.35 mm chips if you added them.",
      "**Doors close the room:** a door stops the room at its leaf, as a Revit room does (the leaf closed, from its hinge across the opening), and its swing space stays in the room. Double doors too. (**Doors close the room**, on.)",
      "**Curves:** Pick lines picks a curved wall or an arc whole and trims or extends it to meet the next line; a closed curve alone (a round column) is an area with Enter. While drawing a polyline, polygon, freeform cloud or an area by points, **◠ Arc** (beside ✓ Finish) makes the next segment an arc: click a point on it, then its end; it stays on for more arcs until you switch it off.",
    ],
  },
  {
    version: "2027-01-01", date: "6 Nov 2026",
    items: [
      "**Area > Click inside ignores what is not a wall:** dashed lines (grids, beams over) and door swings are left out by themselves, and so are a drawing's hidden clipping frames. A line still in the way - a dimension line across the room - can be left out in the panel: **Ignore a line > This line**, or **All lines like it** (same weight, colour and dash: every dimension line at once). What is left out shows as a chip; × uses it again. On Revit plans published with the updated add-in, **Use the Revit model's walls** bounds the room by the model's own walls, doors and columns, so no annotation gets in the way at all.",
      "**Doorways close without rounding the room:** openings up to the gap set are closed straight across from the jambs either side, and the room's corners - chamfers too - stay exact (before, a corner could round off or overshoot).",
      "**Added regions merge:** Shift+click another part of a room and it becomes one outline with the first, with no line left between them.",
      "**Pick lines, closed your way:** each line shows only the part between its two corners as you go (a long wall line no longer runs off across the sheet); two pieces of one wall either side of a door join straight across; and where the drawing has no line, **Ctrl+click two points** draws your own (or choose **Pick: my own line**). If two lines do not meet near the area, it says so.",
    ],
  },
  {
    version: "2026-12-31", date: "6 Nov 2026",
    items: [
      "**Area: click inside a room.** Sheets > Measure ▾ > **Area** now has three ways (in its panel): **Points I click** (as before), **Click inside** and **Pick lines**. **Click inside**: one click in a room finds its outline from the drawing's own lines - doorways narrower than the gap set (1200 mm unless changed) are closed straight across along the wall face, and furniture, text and other loose bits inside are ignored. The corners land on the drawing's corners. On Revit floor plans published with the updated add-in, it takes the **room's own outline from Revit** (with its number, name and Revit area).",
      "**Pick lines:** click the lines round the area in turn - each is trimmed or extended to meet the next, as in CAD - then click the first line again or press Enter. Backspace takes the last line back.",
      "**Add and cut out:** Shift+click adds another region to the area; Alt+click inside a column, a shaft or a void cuts it out as a hole (or choose **Add** / **Cut hole** in the panel). The label shows the net area; **Remove the last** takes a region back.",
      "**Offset the edge:** with an area chosen, type a distance and press **Out** or **In** to move its whole edge - e.g. from the inside face of the walls to the centre line or the outside face.",
      "Curved walls and arcs in drawings are now read as curves: snapping and areas follow them (before, only their ends counted).",
    ],
  },
  {
    version: "2026-12-30", date: "5 Nov 2026",
    items: [
      "**Fix: @ lists everyone.** In a chat (and in an issue's discussion), typing **@** showed only the first 8 people, so the rest of a big team could not be picked. Now everyone is listed - scroll, or use the arrow keys - and the names that start with what you type come first (**@w** gives W.Chan and Wing).",
    ],
  },
  {
    version: "2026-12-29", date: "5 Nov 2026",
    items: [
      "**Phones and tablets open Sheets on Pan:** a finger on the drawing moves the sheet, not the comment under it. Tap **Select** (the arrow) to move or change a markup.",
      "The tool menus (the **▾** beside Shapes, Clouds, Measure ...) open **above** their button when there is no room below - on a phone, where the tools are along the bottom of the screen.",
    ],
  },
  {
    version: "2026-12-28", date: "4 Nov 2026",
    items: [
      "**Route distance on plans** (Sheets > Measure ▾ > **Route distance**): travel distance, dead end, staircase to staircase, from the fireman's lift or the TRS. Click the start and the end (double-click or Enter to finish): the **shortest route** round the walls is found and its length shown, through the doors. In the panel, tick what blocks the route (walls, columns, stairs, furniture ... doors pass unless ticked), set the clearance from walls and a **limit** (green within it, red over). Drag a point to adjust, **+** on a leg adds a point the route must pass, double-click a point to remove it. **Points I click** measures the total of the points you click instead - on any sheet, imported PDFs too. The shortest route needs the floor plans **published again** with the updated add-in (it now sends each plan's walls and doors with the sheet).",
      "**Comment-response schedule in Excel:** Tasks > Queries > **Excel (comment-response)** gives a set-out workbook of the queries shown: grouped by who sent them (BD, FSD, the client, a consultant ...) and their letter, with the comment, our response, who responded and when, the status in colour, and a Summary sheet. Ready to print on A3.",
      "**Add from a letter:** paste a comment letter's text in Tasks > Queries > **Add from a letter** - each numbered comment becomes a query, with who it came from, their reference and date. Queries now keep **From**, **Their ref.**, **Letter date** and **Location**, and the register filters by who it came from.",
      "**Re-check before closing an issue:** a Resolved issue asks whoever raised it to check the fix: **Fixed - close it**, or **Not fixed - reopen** with what is still wrong (whoever holds it is told). The Dashboard has a **Closed loop** card: raised → with a task → resolved → re-checked and closed, how many wait for a re-check, the average days to re-check, how many were reopened, and open issues with no task. The weekly report counts the re-checks waiting.",
      "Double-click now always finishes a polyline, polygon, area or route. **Restart the server after this update.**",
    ],
  },
  {
    version: "2026-12-27", date: "4 Nov 2026",
    items: [
      "**More snapping, in CAD's order:** **Endpoint**, **Intersection**, **Perpendicular** (a dimension or line from your first point lands square onto a wall line), **Aligned** / **Extension** (straight across or up from a nearby corner or your first point, or a line carried on past its end - a dashed line shows what it lines up with), **Midpoint**, **On line**. Alt still places freely.",
    ],
  },
  {
    version: "2026-12-26", date: "4 Nov 2026",
    items: [
      "**Rename an imported sheet:** the **✎** beside an imported sheet in the sheet list changes its number and name. Its markups, issues and query pictures go with it.",
      "**The scale from the title block:** on an imported drawing (CAD or PDF) without mapped views, measurements use the scale its title block states (\"SCALE 1:100\", \"比例 1:200\") - the **1:** box shows **auto 1:100** and a measurement says \"(1:100 from title block)\". Type a scale to use another. A sheet of details with several scales says which it saw.",
      "**Publishing from Revit says plainly what was sent:** how many of the model's sheets the publish chose (and by which sheet set or list), how many PDFs changed and were sent, and how many were the same drawing as on the viewer (not sent again - the viewer keeps showing them). Update the add-in.",
      "Faster: the query markers on open sheets are checked without re-reading every query when nothing changed; turning on notifications on a device no longer pauses the server. Restart the server after this update.",
    ],
  },
  {
    version: "2026-12-25", date: "2 Nov 2026",
    items: [
      "**Publishing from Revit checks your sign-in first:** if the server no longer accepts it (most often: your password was changed or reset since you signed in in Revit), **Publish** says so - and why - before exporting anything, instead of ending a long export with \"Sign in first\". The Publish window shows it too: **Sign in ...** again there. An export that was refused at the upload is kept: **Viewer tools > Upload now** sends it without exporting again. Update the add-in and restart the server.",
    ],
  },
  {
    version: "2026-12-24", date: "2 Nov 2026",
    items: [
      "**Fix:** **Snip** on big sheets shown from the server's pictures (e.g. KC017's) could still copy the wrong part of the sheet - often the title block - on drawings whose page does not start at the corner. It now copies exactly the area dragged. Snapping on those sheets lines up the same way.",
      "**Dimension, Measure, Line and Arrow by two clicks:** click the first point, then the second (the line follows the pointer in between; Esc cancels). Dragging still works.",
    ],
  },
  {
    version: "2026-12-23", date: "1 Nov 2026",
    items: [
      "**Snapping to the drawing:** dimensions, measurements, lines, arrows, polylines, rectangles and clouds snap to the sheet's own plotted lines - line ends, crossings, midpoints or a point along a line, shown by an orange mark. Hold **Alt** to place freely; **View > Snap to drawing lines** turns it off.",
      "**Dimensions are easy to pick:** click a dimension's number (or its extension lines) to select it, then Delete. Measurements, areas and angles too.",
      "**Fix:** **Snip** on big sheets (shown from the server's pictures, like TKO's) copied the sheet's top-left corner instead of the area dragged. It now copies the area.",
      "**Erasing other people's markups** follows the layer: on a layer every member may change (the usual), any member can erase or delete anyone's markups; a markup holding an issue stays with whoever raised it or a project admin. When something cannot be erased, it stays and the page says why (it used to come back without a word). **Restart the server after this update.**",
    ],
  },
  {
    version: "2026-12-22", date: "29 Oct 2026",
    items: [
      "**Faster and steadier server** (from last week's speed log): chat, tasks and boards no longer use their databases on the part of the server that answers everyone, so one stuck request cannot freeze the viewer for everybody again (as on 26 Oct). If a database is ever held for over 20 s, only that request says **The server is busy - try again**, and the server window says what held it.",
      "**Show in viewer from Revit is quicker:** each open page now keeps one request waiting instead of asking every 2 seconds - the issue opens within a moment, with about a fifteenth of the requests.",
      "Tabs in the background check for new markups every 30 s instead of every 5 s, and catch up as soon as you return to them. Files sent in chat are kept by the browser, so opening one again does not download it again.",
      "**Restart the server after this update.**",
    ],
  },
  {
    version: "2026-12-21", date: "28 Oct 2026",
    items: [
      "**Fix (phones and tablets):** on Sheets, **Set ▾** in the sheet list opened its menu behind the list, so another set of sheets could not be chosen. It now opens on top.",
      "**Tasks > List on a phone:** the **Task title** column is narrower when the phone is upright and titles wrap onto two lines, so priority, owner, dates and the other columns have room. Drag its edge to widen it.",
    ],
  },
  {
    version: "2026-12-20", date: "27 Oct 2026",
    items: [
      "**Fix:** on a sheet, **Hide closed** hid only the one markup holding a closed group issue - the other markups of the group stayed. The whole group now hides (and comes back) together.",
    ],
  },
  {
    version: "2026-12-19", date: "27 Oct 2026",
    items: [
      "**Section box round an element (3D):** click an element and press **Section box** in the Selection panel, or right-click it > **Section box around this element** - the box closes round it with a little room, and the view moves there. In the Model browser, **Section box** does the same for a whole group.",
      "**See-through:** make an element, its type, or its whole category see-through to look past it (right-click > **See-through: ...**, **See-through** in the Selection panel, or a group in the Model browser). A click goes through to what is behind; **Show all** or right-click > **Make all solid again** brings them back.",
      "**Publishing from Revit needs the Publisher role:** a Member who gets \"You need to be a Publisher or project admin\" asks a project admin to set their role to **Publisher** (Admin > members). The manual now lists the role.",
    ],
  },
  {
    version: "2026-12-18", date: "27 Oct 2026",
    items: [
      "**Fix:** a query picture taken on a sheet came out dark - with black blocks - where the sheet had comments, a compare result or the 3D position marker on it. They now keep their own colours (also when the picture is marked up). Pictures taken before stay as they are: take the view again with **+ Query**.",
    ],
  },
  {
    version: "2026-12-17", date: "27 Oct 2026",
    items: [
      "**Mark up a query's pictures:** the ✎ on any picture of a query - a sheet or 3D view, or a photo / screenshot added to it - opens the same markup tools as an issue's snapshot (cloud, arrow, text, callout ...). The drawing can be changed again later. In the **+ Query** menu, **Mark up the picture first** draws on the view before it is added.",
      "**+ Sheet view / + 3D view** in a query and in the New query form: off to the sheets or the 3D model, with a bar saying which query you are adding views to - that query is offered first when you click **+ Query** there.",
      "The New query form also takes pasted screenshots (Ctrl+V) and dropped pictures. A sheet's picture no longer shows the other queries' badges.",
    ],
  },
  {
    version: "2026-12-16", date: "27 Oct 2026",
    items: [
      "**Arrange sub-tasks by dragging:** in Tasks > List, drag a sub-task above another one to change the order, or under another task; drop it on a task's **+ Add sub-task** line to make it that task's last sub-task, or above a top-level row to make it a task. In a task's panel, drag its sub-tasks (⋮⋮) into another order.",
      "**One dashboard for a whole project:** a project of several models / sheet sets (e.g. TKO's CAL and LAY) now opens on one Dashboard of all its parts, with a **Part** filter, **Open issues by part** and a publishing table per part. **All parts / CAL / LAY** under the title switch to one part and back.",
      "**My dashboards:** **+ Combine projects …** makes your own dashboard of several projects (or some of their parts) to follow together - kept for you on any device, under **My dashboards** in the Dashboard's project picker.",
    ],
  },
  {
    version: "2026-12-15", date: "26 Oct 2026",
    items: [
      "**Queries on the sheets and in 3D:** each picture of a query shows where it was taken - a badge on the sheet (with the area it showed), a pin in 3D, in the status colour. Click it for its card; **Delete marker** takes that picture off the query (the query stays). Deleting a query removes its markers.",
      "**Right-click > Add to query here** on a sheet or in the model: the view, with its marker on the point you clicked. The right-hand column lists them (a **Queries** tab on Sheets, **Queries in 3D**), and **? Queries** / **Hide queries** and **Hide closed** hide them.",
      "**Follow-up questions:** after an answer, anyone on the project can ask a follow-up (**+ Follow-up question** - the query opens again) and the people it is to answer it (**+ Answer**), as a conversation.",
      "**Fuller task messages in chat:** a task card shows its progress bar and how many sub-tasks are done; a sub-task's card says which task it is under and how far that task is. A message is posted when a task passes 25, 50 or 75 %.",
      "**Fix:** opening a query as a project member (not an admin) could freeze Tasks, Chat and Queries on the server until it was restarted - and the viewer then showed Offline. Restart the server after this update.",
    ],
  },
  {
    version: "2026-12-14", date: "26 Oct 2026",
    items: [
      "**One query, several views:** **+ Query** on a sheet or in 3D now opens a small menu: a new query (type its subject) or one of the project's open queries - the one used last on top (**Add another to Q-...**). Choose **Stay here** to go on capturing the next sheet or 3D view, or **Open the query**. Anyone on the project can add pictures to a query.",
      "**Pictures of your own in a query:** **+ Add picture** (site photos, screenshots, markups), or paste a screenshot (Ctrl+V) or drop pictures on the query. A click shows them full size, with ‹ › through the query's pictures.",
      "**Queries stands out:** a blue button at the top of the Tasks side bar, with the open queries to you and how many are overdue.",
      "**Offline, and why:** when the header says Offline, point at it: it now says whether the server did not answer (check the server window / run.bat, and tunnel.bat for an outside link) or is just busy. The server also stays quicker to answer while queries are saved.",
    ],
  },
  {
    version: "2026-12-13", date: "26 Oct 2026",
    items: [
      "**Queries** (Tasks > Queries): a register of questions per project, numbered Q-001, Q-002 ... Raise one to the people who should answer, with a due date and priority; they answer in the viewer, and the raiser closes it. Each query has its discussion (with files), history and linked tasks - **+ New task from this query** or **Link a task**.",
      "**Pictures of the exact view:** on a sheet or in 3D, **+ Query** (next to + Task) captures what you see and adds it to a new or open query. A click on the picture opens the same sheet zoomed to the same area, or the 3D model at the same camera and section.",
      "**Due dates in the Calendar** (My queries), **in Chat** - type **?** to link a query, or **+ > Query** to raise one there; a card is posted when a query is raised, answered or closed - a **Dashboard** tab (open, overdue, due soon, per person, per week), and **Report (PDF)**: the register and every query with its pictures, to print or keep in Folders > Queries.",
    ],
  },
  {
    version: "2026-12-12", date: "25 Oct 2026",
    items: [
      "**Light & Vent colours keep the drawing readable:** the colour now tints the paper and the plan's lines stay dark through it. The legend has a switch: **Filled**, **Outline** (just each room's outline and a result dot) or **Off** - remembered on this device.",
      "**Show on sheets:** at the top of 3D > Checks > Light & Vent, opens the plan sheet showing the most of the rooms chosen, coloured.",
      "**Tower column** in the Light & Vent table, with a tower filter; the Dashboard card counts per tower.",
      "**Drawing missing under the colours:** a sheet published while a linked model was not loaded (or its workset closed) now says so - in the legend and the status bar - naming the link (update the add-in, then publish the sheet again with the links loaded).",
    ],
  },
  {
    version: "2026-12-11", date: "25 Oct 2026",
    items: [
      "**Light & Vent on plans published before:** until the Layout model's plan sheets are published again with the updated add-in, a plan with a room schedule shows the rooms matched by room number and name. A room on no plan now says why (plans not published again yet, or no plan of that floor).",
      "**Issues from 3D and 2D:** in 3D > Checks > Light & Vent, **Show in 3D** selects the room's windows on the same page (no reload - the panels and the view stay), **Make issue (3D)** raises it in 3D, **Show on plan** opens the sheet; on the sheets, **Make issue** raises it on the plan.",
      "**Full report:** every room's schedule and windows, to print, save as PDF or keep in Folders - from the 3D tab, the sheets' legend and the Dashboard. The diagrams PDF is made on the server when the PC cannot make it.",
      "**Rooms from the Calculation model only** (update the add-in): rooms of linked models - e.g. two linked rooms named 5/F on your 4/F - are no longer added; windows still come from the links.",
    ],
  },
  {
    version: "2026-12-10", date: "25 Oct 2026",
    items: [
      "**Light & Ventilation on the plans:** the Revit Light & Vent check (in the Calculation model) can now be sent to the viewer. On the plan sheets - also those published from the Layout model, on the same shared coordinates - **View > Light & Vent** colours each room by its result; click one for its required and provided areas, its windows, and **Make issue**.",
      "**3D > Checks > Light & Vent:** the whole table, filtered by floor, flat and result, with the CSV and the diagrams PDF; a row opens the room on its plan. The Dashboard shows the counts.",
      "**In Revit:** update the add-in; publish the layout plans once with it, and answer Yes to *Send the result to the viewer?* after Light & Vent.",
      "**Fix:** a click on empty paper on some sheets did nothing (an error stopped it), so an area or room could not be picked there.",
    ],
  },
  {
    version: "2026-12-09", date: "25 Oct 2026",
    items: [
      "**SBD check about 5 times faster:** the search for the side regions (the slowest part, over 90 % of a big model's run) skips the edges that cut a building much sooner. The results are exactly the same as before; a test model with 12 stepped towers went from 128 s to 25 s.",
      "**Where the time goes:** under an SBD result, **took ...** now says how long the check took and in which steps.",
    ],
  },
  {
    version: "2026-12-08", date: "23 Oct 2026",
    items: [
      "**3D opens in stages:** the main model shows as soon as it is in and you can work at once; the other disciplines keep loading behind it, the ones nearest your view first. To load only the main model, tick **Open with the main model only** under the Models list - the others then load when you tick them or come near them.",
      "**Board, Tasks and Dashboard open from your device:** what you saw last time shows at once, and the server is asked only for what changed since. If the server does not answer, you still see your last copy (it says so). Signing out clears these copies.",
      "**Long task lists in pages:** a group shows its first 150 tasks; the next ones appear as you scroll down (or with **Show more**). Search and filters still look at every task.",
      "**Night export sends only what changed** (update the Revit add-in): an unchanged 3D model, and a sheet PDF whose drawing did not change (Revit re-stamps its date every time), are no longer uploaded each night. The log says e.g. \"sending 6 of 108 file(s)\". The first night after the update still sends everything once.",
    ],
  },
  {
    version: "2026-12-07", date: "23 Oct 2026",
    items: [
      "**SBD Run in the background:** Run starts the check and the result shows by itself when ready (TMTL496 takes about 3 minutes) - no page waiting on one long answer.",
      "**Fewer background checks:** a page left behind other tabs asks the server for Revit's \"show me\" every 3 s instead of every 2 s.",
    ],
  },
  {
    version: "2026-12-06", date: "23 Oct 2026",
    items: [
      "**Sorting sheets is easier:** ☰ > **Move / hide sheets** - tick sheets and use **Move to ▾** or **Hide** in a bar that stays at the top of the list; right-click a ticked sheet and all the ticked ones move. After each move the choice clears for the next; **Esc** or **Done** finishes.",
      "**Sheets in your own order:** drag sheets into place (onto a group's heading: to its end), or right-click > Move up / Move down.",
      "**Hidden is the recycle bin:** admins can delete a hidden sheet from the server for good (right-click it, or ⋯ > Delete all on the Hidden heading).",
    ],
  },
  {
    version: "2026-12-05", date: "23 Oct 2026",
    items: [
      "**Fix - Offline while sorting sheets:** moving sheets into groups or hiding them made the server rebuild a big project's whole sheet list each time, and after a few rounds it stopped answering and the viewer showed Offline. A move or hide now shows at once without reading the list again; the server keeps the list ready and adds the groups in a moment; and a slow answer no longer counts as \"no connection\".",
      "**Faster for everyone on big projects:** the server's connection check no longer reads every project's sheet list (it ran every few seconds for each open page).",
    ],
  },
  {
    version: "2026-12-04", date: "22 Oct 2026",
    items: [
      "**SBD street canyon (TMTL496, B2):** the canyon is measured square to the street again, over the block's whole frontage. A street joined from several Floors (a ramp beside the road) has a small bend in its centreline, which had turned the canyon askew and cut a turned block's canyon short.",
    ],
  },
  {
    version: "2026-12-03", date: "22 Oct 2026",
    items: [
      "**The server keeps answering everyone:** publishing a model (unpacking hundreds of MB), reading pages' data, PDF and file work, CAD drawing and the sheet pictures now run beside the server's answers instead of in their way - one person's big upload or import no longer freezes the viewer for the others.",
      "**Admin > Speed (site admins):** how fast the server answers and how long each page takes on people's own devices, measured all the time; any moment the server stopped answering is listed with what it was busy with.",
    ],
  },
  {
    version: "2026-12-02", date: "22 Oct 2026",
    items: [
      "**Fix - viewer Offline after 2026-12-01:** an SBD check (SBD Export from Revit, or Run) kept the server busy for minutes, so the viewer said Offline and publishing from Revit timed out. The check now runs in its own process, at lower priority, so the viewer and publishing carry on while it runs. It is also faster again, and a check that takes over 20 minutes is stopped with a message.",
    ],
  },
  {
    version: "2026-12-01", date: "22 Oct 2026",
    items: [
      "**SBD side regions (TMTL496, 3rd review):** the street part runs exactly between the two points where the region's edge meets the site boundary, cut parallel to the plane at both ends. Past the last building corner the edge can also turn 15° away from the plane, so the region takes in more area where nothing stands in the way.",
      "**SBD openings level by level:** an opening clear from some height up - over a low building between towers - is found at each plan level and counts as an air corridor (S2) from that height; on the elevation it is blocked below it and IS above. Openings at a turn of 15 m or more are now counted too. Hover a building's name on the plan for its top above Level 0.",
      "**SBD corridors at their widest:** each air corridor is measured at the widest band through the same opening, turned up to 15°; one that reaches 15 m that way counts.",
      "**Nightly export (Revit 2023-2026):** the watcher now also sees the newer (WPF) windows. It presses Load Once for an unsigned add-in, Ignore and continue opening the project for missing links, and Continue working with the file for missing updaters, and closes What's New windows. It never presses Cancel, Do Not Load or Always Load. A dialog it does not know is pictured in nightly\\dialogs. Save the schedule once on each PC to update it.",
    ],
  },
  {
    version: "2026-11-30", date: "22 Oct 2026",
    items: [
      "**Sheets in groups:** ☰ in the Sheets heading makes groups (topics - Plans, Elevations ...), by hand or from the sheet numbers; right-click a sheet > Move to ... Click a group's heading to fold it, or ⋯ > Show only this group. Project members make the groups; folding is your own.",
      "**Hide sheets (admins):** right-click a sheet > Hide from the viewer. It stays hidden after the next publish from Revit; admins still see it, dimmed, under Hidden, to show it again.",
      "**SBD:** air corridors that overlap are one - the one that counts is kept (else the one turned least); one apart from it is crossed out and its gap gives no IS. Openings at a turn that the straight projection hides are shown as angled gaps (A1 ...). Checks > SBD > Model (JSON) downloads the model as sent, to send for a check.",
    ],
  },
  {
    version: "2026-11-29", date: "22 Oct 2026",
    items: [
      "**SBD (TMTL496 review):** a street's Floors that overlap or leave a small gap - a ramp beside a flat part - are joined end to end, so the whole street is used; Revit lists each street with the Floors and top faces it was made of. A street end drawn as two edges no longer swings the centreline across.",
      "**SBD side regions:** next to a street they now carry on round a rounded or splayed site corner towards a junction, up to the street's centreline, and their street part ends where the region's edge meets the site boundary (cut parallel to the plane).",
      "**SBD drawings:** two air corridors side by side that overlap are one opening with one corridor (the one turned least; the other is noted as omitted); each street has one 30 m line instead of one per leg; and every gap between separate building groups is dimensioned (e.g. B4 - B5).",
    ],
  },
  {
    version: "2026-11-28", date: "22 Oct 2026",
    items: [
      "**Tasks: copy and paste.** Ctrl-click tasks to choose several (Shift-click for a range), press **Ctrl+C** or right-click > **Copy**, then right-click another task > **Paste as sub-tasks** or **Paste below**, or a group's heading > **Paste into**. Each copy brings its sub-tasks, owners, dates, priority, fields and links, and starts not done. It works between lists too, and one Ctrl+Z takes a paste back.",
      "**Sheets:** the grey bar at the bottom now says which version you are looking at - when the sheet was output from Revit and its current revision (\"Output 21 Oct 2026, 14:05 · Rev C\"), or when a PDF was uploaded and by whom. Sheets published before this show the time of their publish.",
      "**SBD Export (Revit):** a street drawn as several Floors, or a sloped Floor, is now one street instead of a warning for every piece. The model is sent at once and assessed on the viewer in the background, so a large podium no longer times out; Checks > SBD shows *Assessing ...* until the result is ready.",
    ],
  },
  {
    version: "2026-11-27", date: "21 Oct 2026",
    items: [
      "**Colours closer to the design:** warm grey backgrounds and lines on every page, and the Dashboard's charts in orange and charcoal. Your picture in the header is a clean circle again, and Search has its border back.",
      "**Sheets:** uploaded PDF sets are back - choose them with **Set:** at the top of the sheet list (Revit sheets or each uploaded set). Comment / + Issue, Files and + Task are on the drawing's own toolbar, so there is no second row under the header. The zoom shows **100%** when the drawing just fits the width. An issue list with nothing in it folds away by itself (the tab at its edge brings it back, and it then stays open).",
      "**3D:** one toolbar at the bottom of the model (Orbit, Walk, Fit, Section box, Measure, + Add issue) and chips at its top left (Floor, Perspective, Issue pins, Plan overlay, and ⋯ for the view link, BCF and + Task). The Selection panel stays one line until you pick something.",
      "**Tablet and phone:** on a tablet the side panels of Sheets and 3D slide in from the side; on a phone the markup tools sit along the bottom and the panels rise from below.",
      "**Calendar:** bordered buttons, Month / Week / List as one switch, and a **Show** legend with round colour dots (Issue due dates, Tasks, Holidays, Team leave, Meetings). The Holidays chip's ▾ chooses Hong Kong and / or Philippines. **Folders:** the drop area for uploads fills the space under the files.",
      "**Help and manual** pictures retaken with the new header and toolbars.",
    ],
  },
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
