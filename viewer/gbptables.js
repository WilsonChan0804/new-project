/* The code tables the GBP workbook (gbp.js, gbpcore.js) works from, as the
 * documents give them. Every table names its source - document, clause or
 * table, edition - so a result can say what it rests on.
 *
 * Transcribed from (Nov 2026):
 *   Cap. 123F Building (Planning) Regulations, First Schedule (L.N. 110 of 2005)
 *   Code of Practice for Fire Safety in Buildings 2011 (FS Code), Part B
 *   PNAP APP-151 (revision July 2025), Appendix A
 * A table that changes: change it here, and the tests in tests/gbpcore.test.mjs.
 */

export const SRC = {
  first: { doc: "Cap. 123F B(P)R", ref: "First Schedule (regs 18A, 20 & 21)", ed: "L.N. 110 of 2005" },
  b1: { doc: "FS Code 2011", ref: "Table B1 - Assessment of Occupant Capacity", ed: "2011 (2024 ed.)" },
  b2: { doc: "FS Code 2011", ref: "Table B2 - Minimum number and width of exit doors and exit routes", ed: "2011 (2024 ed.)" },
  b3: { doc: "FS Code 2011", ref: "Table B3 - Discharge value, non-sprinkler protected building", ed: "2011 (2024 ed.)" },
  b4: { doc: "FS Code 2011", ref: "Table B4 - Discharge value, sprinkler protected building", ed: "2011 (2024 ed.)" },
  b7: { doc: "FS Code 2011", ref: "Clause B7.1 / B7.3 (exits from rooms)", ed: "2011 (2024 ed.)" },
  b8: { doc: "FS Code 2011", ref: "Clause B8.1 (exits from storeys)", ed: "2011 (2024 ed.)" },
  b12: { doc: "FS Code 2011", ref: "Clause B12.1-B12.7 (discharge value of required staircases)", ed: "2011 (2024 ed.)" },
  app151: { doc: "PNAP APP-151", ref: "Para 4-5 and Appendix A (overall cap of 10%)", ed: "rev. July 2025" },
  reg23: { doc: "Cap. 123F B(P)R", ref: "Reg 23(3)(a)/(b) (GFA, disregarded GFA)", ed: "" },
  b11: { doc: "FS Code 2011", ref: "Clause B11.2 / B11.3 (travel distance)", ed: "2011 (2024 ed.)" },
  b5: { doc: "FS Code 2011", ref: "Table B5 - Use Classification 5a at 12 m or more above G/F (Clause B21.1)", ed: "2011 (2024 ed.)" },
  office: { doc: "Office GBP setting", ref: "Revit GBP setting (verify against the PNAP / regulation named)", ed: "" },
};

/* ------------------------------------------------- Cap. 123F First Schedule
   One row per height band: the upper limit (m, null = no limit) and, for
   site classes A, B, C: domestic site coverage %, domestic plot ratio,
   non-domestic site coverage %, non-domestic plot ratio. */
export const FIRST_SCHEDULE = [
  { over: 0, upto: 15, label: "Not exceeding 15 m", dsc: [66.6, 75, 80], dpr: [3.3, 3.75, 4.0], nsc: [100, 100, 100], npr: [5, 5, 5] },
  { over: 15, upto: 18, label: "Over 15 m but not exceeding 18 m", dsc: [60, 67, 72], dpr: [3.6, 4.0, 4.3], nsc: [97.5, 97.5, 97.5], npr: [5.8, 5.8, 5.8] },
  { over: 18, upto: 21, label: "Over 18 m but not exceeding 21 m", dsc: [56, 62, 67], dpr: [3.9, 4.3, 4.7], nsc: [95, 95, 95], npr: [6.7, 6.7, 6.7] },
  { over: 21, upto: 24, label: "Over 21 m but not exceeding 24 m", dsc: [52, 58, 63], dpr: [4.2, 4.6, 5.0], nsc: [92, 92, 92], npr: [7.4, 7.4, 7.4] },
  { over: 24, upto: 27, label: "Over 24 m but not exceeding 27 m", dsc: [49, 55, 59], dpr: [4.4, 4.9, 5.3], nsc: [89, 90, 90], npr: [8.0, 8.1, 8.1] },
  { over: 27, upto: 30, label: "Over 27 m but not exceeding 30 m", dsc: [46, 52, 55], dpr: [4.6, 5.2, 5.5], nsc: [85, 87, 88], npr: [8.5, 8.7, 8.8] },
  { over: 30, upto: 36, label: "Over 30 m but not exceeding 36 m", dsc: [42, 47.5, 50], dpr: [5.0, 5.7, 6.0], nsc: [80, 82.5, 85], npr: [9.5, 9.9, 10.2] },
  { over: 36, upto: 43, label: "Over 36 m but not exceeding 43 m", dsc: [39, 44, 47], dpr: [5.4, 6.1, 6.5], nsc: [75, 77.5, 80], npr: [10.5, 10.8, 11.2] },
  { over: 43, upto: 49, label: "Over 43 m but not exceeding 49 m", dsc: [37, 41, 44], dpr: [5.9, 6.5, 7.0], nsc: [69, 72.5, 75], npr: [11.0, 11.6, 12.0] },
  { over: 49, upto: 55, label: "Over 49 m but not exceeding 55 m", dsc: [35, 39, 42], dpr: [6.3, 7.0, 7.5], nsc: [64, 67.5, 70], npr: [11.5, 12.1, 12.6] },
  { over: 55, upto: 61, label: "Over 55 m but not exceeding 61 m", dsc: [34, 38, 41], dpr: [6.8, 7.6, 8.0], nsc: [60, 62.5, 65], npr: [12.2, 12.5, 13.0] },
  { over: 61, upto: null, label: "Over 61 m", dsc: [33.33, 37.5, 40], dpr: [8.0, 9.0, 10.0], nsc: [60, 62.5, 65], npr: [15, 15, 15] },
];

/* ----------------------------------------------------------- FS Code Table B1
   key: the Use Classification key a room carries (the office's keys, as in
   the GBP setting's WORK_ROOM_KEY_USE-CLASS); cls: the FS Code use class;
   factor: m2 per person, or null when the occupant capacity is by number
   (bedspaces / seats - "Occupancy Factor by Number" on the room). */
export const B1 = [
  { key: "1b-1", cls: "1b", use: "Flats with corridor or balcony access having five or more flats on each floor served by each staircase", factor: 4.5 },
  { key: "1b-2", cls: "1b", use: "Flats not covered by 1b-1", factor: 9 },
  { key: "1c", cls: "1c", use: "Tenement houses", factor: 3 },
  { key: "2-1", cls: "2", use: "Boarding houses, hostels, hotels, motels, guesthouses", factor: null, by: "Number of bedspaces" },
  { key: "2-2", cls: "2", use: "Dormitories", factor: 3 },
  { key: "3a-1", cls: "3a", use: "Day care centres, nurseries, child care centres", factor: 4 },
  { key: "3a-2", cls: "3a", use: "Hospitals (areas other than the patient care areas)", factor: 9 },
  { key: "3a-3", cls: "3a", use: "Patient care areas", factor: null, by: "Number of bedspaces" },
  { key: "3b", cls: "3b", use: "Detention and Correctional Centres", factor: null, by: "Number of bedspaces" },
  { key: "4a-1", cls: "4a", use: "Offices", factor: 9 },
  { key: "4a-2", cls: "4a", use: "Board rooms, conference rooms, function rooms", factor: 10 },
  { key: "4a-3", cls: "4a", use: "Staff rooms", factor: 9 },
  { key: "4b-1", cls: "4b", use: "Retail shops / department stores: basement, G/F, 1/F & 2/F", factor: 3 },
  { key: "4b-2", cls: "4b", use: "Retail shops / department stores: 3rd floor & above", factor: 4.5 },
  { key: "4b-3", cls: "4b", use: "Markets, supermarkets, showrooms, jewellery and goldsmith shops, pawn shops and money changers", factor: 2 },
  { key: "4b-4", cls: "4b", use: "Cafe, restaurants, dining areas, lounges, bars and pubs", factor: 1 },
  { key: "4b-5", cls: "4b", use: "Banking halls (areas accessible to the public)", factor: 0.5 },
  { key: "4b-6", cls: "4b", use: "Betting halls (areas accessible to the public)", factor: 0.5 },
  { key: "4b-7", cls: "4b", use: "Places where public information or service counters are provided (areas accessible to the public)", factor: 0.5 },
  { key: "5a-1", cls: "5a", use: "Art galleries, exhibition areas, museums", factor: 2 },
  { key: "5a-2", cls: "5a", use: "Cinemas: seating areas", factor: null, by: "Number of seats" },
  { key: "5a-3", cls: "5a", use: "Cinemas: foyer areas", factor: 0.5 },
  { key: "5a-4", cls: "5a", use: "Dance floors", factor: 0.75 },
  { key: "5a-5", cls: "5a", use: "Sports stadia: standing", factor: 0.5 },
  { key: "5a-6", cls: "5a", use: "Sports stadia: removable seating", factor: 0.5 },
  { key: "5a-7", cls: "5a", use: "Sports stadia: fixed seating", factor: null, by: "Number of seats" },
  { key: "5a-8", cls: "5a", use: "Sports stadia: bench seating (450 mm per person)", factor: null, by: "Bench length / 450 mm" },
  { key: "5a-9", cls: "5a", use: "Indoor sports facilities: sports / activity areas", factor: 10 },
  { key: "5a-10", cls: "5a", use: "Indoor sports facilities: standing", factor: 0.5 },
  { key: "5a-11", cls: "5a", use: "Indoor sports facilities: removable seating", factor: 0.5 },
  { key: "5a-12", cls: "5a", use: "Indoor sports facilities: fixed seating", factor: null, by: "Number of seats" },
  { key: "5a-13", cls: "5a", use: "Indoor sports facilities: bench seating (450 mm per person)", factor: null, by: "Bench length / 450 mm" },
  { key: "5a-14", cls: "5a", use: "Theatres: seating areas", factor: null, by: "Number of seats" },
  { key: "5a-15", cls: "5a", use: "Theatres: foyer areas", factor: 0.5 },
  { key: "5b-1", cls: "5b", use: "Libraries", factor: 2 },
  { key: "5b-2", cls: "5b", use: "Reading rooms, study rooms", factor: 1 },
  { key: "5b-3", cls: "5b", use: "Classrooms of school not covered by the Education Ordinance, lecture rooms", factor: 2, note: "2 m2 or the number of seats" },
  { key: "5c", cls: "5c", use: "Transport facilities like passenger terminals, railway stations, etc.", factor: null, by: "Actual design and layout" },
  { key: "5d-1", cls: "5d", use: "Public halls, assembly halls, conference halls: removable seating", factor: 0.5 },
  { key: "5d-2", cls: "5d", use: "Public halls, assembly halls, conference halls: fixed seating", factor: null, by: "Number of seats" },
  { key: "5d-3", cls: "5d", use: "Gymnasia", factor: 3 },
  { key: "5d-4", cls: "5d", use: "Swimming pool (water surface area)", factor: 3 },
  { key: "5d-5", cls: "5d", use: "Columbaria", factor: 2 },
  { key: "5d-6", cls: "5d", use: "Viewing galleries", factor: 0.5 },
  { key: "6a-1", cls: "6a", use: "Commercial laundries", factor: 10 },
  { key: "6a-2", cls: "6a", use: "Commercial laboratories", factor: 10 },
  { key: "6a-3", cls: "6a", use: "Factories / workshops", factor: 4.5 },
  { key: "6a-4", cls: "6a", use: "Commercial kitchens", factor: 4.5 },
  { key: "6b", cls: "6b", use: "Warehouses", factor: 30 },
  { key: "6c", cls: "6c", use: "Storage, manufacturing of hazardous / dangerous goods premises", factor: 30 },
  { key: "7", cls: "7", use: "Carparks", factor: 30 },
  { key: "8", cls: "8", use: "Plant rooms, switch rooms, transformer rooms, etc.", factor: 30, note: "Net floor area; a room of 100 m2 or less counts as zero (Note 7)" },
  { key: "N", cls: "", use: "Rooms with an assigned number of occupants", factor: null, by: "Occupancy Factor by Number" },
];

/* ----------------------------------------------------------- FS Code Table B2
   [from, to] persons -> minimum number of exit doors / routes, minimum total
   width (mm) of the exit doors and routes, minimum width (mm) of each. */
export const B2 = [
  { from: 4, to: 30, n: 1, doors: null, routes: null, door: 750, route: 1050 },
  { from: 31, to: 200, n: 2, doors: 1750, routes: 2100, door: 850, route: 1050 },
  { from: 201, to: 300, n: 2, doors: 2500, routes: 2500, door: 1050, route: 1050 },
  { from: 301, to: 500, n: 2, doors: 3000, routes: 3000, door: 1050, route: 1050 },
  { from: 501, to: 750, n: 3, doors: 4500, routes: 4500, door: 1200, route: 1200 },
  { from: 751, to: 1000, n: 4, doors: 6000, routes: 6000, door: 1200, route: 1200 },
  { from: 1001, to: 1250, n: 5, doors: 7500, routes: 7500, door: 1350, route: 1350 },
  { from: 1251, to: 1500, n: 6, doors: 9000, routes: 9000, door: 1350, route: 1350 },
  { from: 1501, to: 1750, n: 7, doors: 10500, routes: 10500, door: 1500, route: 1500 },
  { from: 1751, to: 2000, n: 8, doors: 12000, routes: 12000, door: 1500, route: 1500 },
  { from: 2001, to: 2250, n: 9, doors: 13500, routes: 13500, door: 1500, route: 1500 },
  { from: 2251, to: 2500, n: 10, doors: 15000, routes: 15000, door: 1500, route: 1500 },
  { from: 2501, to: 2750, n: 11, doors: 16500, routes: 16500, door: 1500, route: 1500 },
  { from: 2751, to: 3000, n: 12, doors: 18000, routes: 18000, door: 1500, route: 1500 },
];

/* ----------------------------------------------------- FS Code Tables B3 / B4
   Discharge value of a required staircase by its width band (mm, lower
   bound of each band) and the number of storeys it serves (1-10, then the
   last row's step per additional storey). Wider than 1800 mm: linear
   projection (the Note to both tables). */
export const STAIR_BANDS = [1050, 1200, 1350, 1500, 1600, 1700];
export const B3 = {
  rows: [
    [210, 240, 270, 300, 320, 340], [242, 278, 315, 351, 377, 402], [274, 316, 360, 402, 434, 464],
    [306, 354, 405, 453, 491, 526], [338, 392, 450, 504, 548, 588], [370, 430, 495, 555, 605, 650],
    [402, 468, 540, 606, 662, 712], [434, 506, 585, 657, 719, 774], [466, 544, 630, 708, 776, 836],
    [498, 582, 675, 759, 833, 898],
  ],
  add: [32, 38, 45, 51, 57, 62],
};
export const B4 = {
  rows: [
    [420, 480, 540, 600, 640, 680], [452, 518, 585, 651, 697, 742], [484, 556, 630, 702, 754, 804],
    [516, 594, 675, 753, 811, 866], [548, 632, 720, 804, 868, 928], [580, 670, 765, 855, 925, 990],
    [612, 708, 810, 906, 982, 1052], [644, 746, 855, 957, 1039, 1114], [676, 784, 900, 1008, 1096, 1176],
    [708, 822, 945, 1059, 1153, 1238],
  ],
  add: [32, 38, 45, 51, 57, 62],
};
// Clause B12.6 / B12.7: exit upwards x 0.8, scissors staircase without an
// intermediate landing x 0.7
export const STAIR_FACTORS = { up: 0.8, scissors: 0.7 };

/* --------------------------------------------------- PNAP APP-151 Appendix A
   GFA concessions by item: pre = subject to the pre-requisites (para 6 & 7),
   cap = counts towards the overall cap of 10% (para 4). The Area-Type keys
   are the office's ("GFA-C2.3" for item 2.3, as in WORK_AREA_KEY_TYPE). */
export const APP151 = [
  { item: "1", group: "Reg 23(3)(b)", text: "Carpark and loading/unloading area excluding public transport terminus", pn: "APP-2 & APP-111", pre: false, cap: false },
  { item: "2.1", group: "Reg 23(3)(b)", text: "Mandatory feature or essential plant room, area limited by PNAP or regulation (lift machine room, TBE room, refuse storage and material recovery chamber, etc.)", pn: "APP-35 & APP-84", pre: false, cap: false },
  { item: "2.2", group: "Reg 23(3)(b)", text: "Mandatory feature or essential plant room, area NOT limited (FSI rooms, meter room, transformer room, potable and flushing water tank, etc.)", pn: "APP-2 & APP-42", pre: false, cap: false },
  { item: "2.3", group: "Reg 23(3)(b)", text: "Non-mandatory or non-essential plant room (A/C plant room, AHU room, etc.)", pn: "APP-2 & APP-42", pre: true, cap: true },
  { item: "3", group: "Reg 23A(3)", text: "Area for picking up and setting down persons departing from or arriving at the hotel by vehicle", pn: "APP-40", pre: false, cap: false },
  { item: "4", group: "Reg 23A(3)", text: "Supporting facilities for a hotel", pn: "APP-40", pre: false, cap: false },
  { item: "5", group: "Green features (JPN)", text: "Balcony for residential buildings", pn: "JPN1", pre: true, cap: true },
  { item: "6", group: "Green features (JPN)", text: "Wider common corridor and lift lobby", pn: "JPN1", pre: true, cap: false },
  { item: "7", group: "Green features (JPN)", text: "Communal sky garden", pn: "JPN1 & 2, APP-122", pre: true, cap: false },
  { item: "8", group: "Green features (JPN)", text: "Communal podium garden for non-residential buildings", pn: "JPN1", pre: true, cap: false },
  { item: "9", group: "Green features (JPN)", text: "Acoustic fin", pn: "JPN1", pre: true, cap: false },
  { item: "10", group: "Green features (JPN)", text: "Wing wall, wind catcher and funnel", pn: "JPN1", pre: true, cap: false },
  { item: "11", group: "Green features (JPN)", text: "Non-structural prefabricated external wall", pn: "JPN2", pre: true, cap: true },
  { item: "12", group: "Green features (JPN)", text: "Utility platform", pn: "JPN2", pre: true, cap: true },
  { item: "13", group: "Green features (JPN)", text: "Noise barrier", pn: "JPN2", pre: true, cap: false },
  { item: "14", group: "Amenity features", text: "Caretakers' quarters, counter, office, store, guard room and lavatory for watchman and management staff, owners' corporation office", pn: "APP-42", pre: true, cap: true },
  { item: "15", group: "Amenity features", text: "Residential recreational facilities (void, plant room, swimming pool filtration plant room, covered walkway, etc.)", pn: "APP-2, APP-42 & APP-104", pre: true, cap: true },
  { item: "16", group: "Amenity features", text: "Covered landscaped and play area, covered area at public open space", pn: "APP-42", pre: true, cap: false },
  { item: "17", group: "Amenity features", text: "Horizontal screen / covered walkway, trellis, shelter for outdoor fixed seats, covered picking up and setting down area", pn: "APP-42", pre: true, cap: false },
  { item: "17A", group: "Amenity features", text: "Horizontal / vertical extension for accessible lift at existing building", pn: "APP-42", pre: false, cap: false },
  { item: "18", group: "Amenity features", text: "Larger lift shaft", pn: "APP-89", pre: true, cap: false },
  { item: "19", group: "Amenity features", text: "Chimney shaft", pn: "APP-2", pre: true, cap: true },
  { item: "20", group: "Amenity features", text: "Other non-mandatory or non-essential plant room (boiler room, SMATV room, etc.)", pn: "APP-2", pre: true, cap: true },
  { item: "21", group: "Amenity features", text: "Pipe duct, air duct and vertical riser for mandatory feature or essential plant room", pn: "APP-2, APP-84 & APP-93", pre: false, cap: false },
  { item: "22", group: "Amenity features", text: "Pipe duct, air duct for non-mandatory or non-essential plant room", pn: "APP-2", pre: true, cap: true },
  { item: "23", group: "Amenity features", text: "Plant room, pipe duct, air duct for environmentally friendly system and feature", pn: "APP-2", pre: true, cap: false },
  { item: "24", group: "Amenity features", text: "High headroom and void in front of cinema, shopping arcade, etc. in non-domestic development", pn: "APP-2", pre: true, cap: false },
  { item: "25", group: "Amenity features", text: "Void over main common entrance (prestige entrance) in non-domestic development", pn: "APP-2 & APP-42", pre: true, cap: true },
  { item: "26", group: "Amenity features", text: "Void in duplex domestic flat and house", pn: "APP-2", pre: true, cap: true },
  { item: "27", group: "Amenity features", text: "Sunshade and reflector", pn: "APP-19, APP-67 & APP-156", pre: false, cap: false },
  { item: "28", group: "Amenity features", text: "Projecting planter, projecting window and minor projecting features (A/C box, A/C platform, window cill)", pn: "APP-19 & APP-42", pre: false, cap: false },
  { item: "29", group: "Amenity features", text: "Maintenance walkway and other projection such as A/C box and A/C platform not covered in para 3(b) and (c) of APP-19", pn: "APP-19", pre: true, cap: true },
  { item: "30", group: "Other items", text: "Refuge floor including refuge floor cum sky garden", pn: "APP-2 & APP-122", pre: false, cap: false },
  { item: "31", group: "Other items", text: "Covered area under large projecting / overhanging feature", pn: "APP-19", pre: false, cap: false },
  { item: "32", group: "Other items", text: "Public transport terminus", pn: "APP-2", pre: false, cap: false },
  { item: "33", group: "Other items", text: "Party structure and common staircase", pn: "ADM-2", pre: false, cap: false },
  { item: "34", group: "Other items", text: "Horizontal area of staircase, lift shaft and vertical duct solely serving floor accepted as not being accountable for GFA", pn: "APP-2", pre: false, cap: false },
  { item: "35", group: "Other items", text: "Public passage", pn: "APP-108", pre: false, cap: false },
  { item: "36", group: "Other items", text: "Covered setback area", pn: "APP-152", pre: false, cap: false },
  { item: "37", group: "Bonus GFA", text: "Bonus GFA", pn: "APP-108", pre: false, cap: false },
  { item: "38", group: "Additional green features (JPN)", text: "Buildings adopting Modular Integrated Construction", pn: "JPN8", pre: false, cap: false },
];
export const CAP_PCT = 10;     // APP-151 para 4

/* Limits on individual concession items the office's GBP setting works with
   (Global Parameters "Permitted AHU Room Area" and "Required Refuse Storage &
   Material Recovery Chamber Area"). Not from the documents above: each is
   editable on the page, and says where to verify it. */
export const ITEM_LIMITS = [
  { item: "2.3", label: "AHU / A/C plant room on a floor", kind: "max", pct_of_floor_gfa: 4, verify: "PNAP APP-42" },
];

/* ------------------------------------------- FS Code Subsection B11 (pp. 46-47)
   Travel distance, as written. B11.2: dead end - (a) UC 1 & 2: 24 m from any
   point within a flat / hotel guestroom to its exit door, 15 m from that door
   to the required staircase or a point of choice; (b) UC 3: 12 m; (c) all
   other UC: 18 m; for (b) and (c) 24 m where a balcony approach complying
   with B10.6 is provided. B11.3(a): the maximum travel distance, including
   any dead end, where served by 2 or more protected exits - UC 1 & 2: 24 m
   from the flat / guestroom exit door to the nearest required staircase;
   UC 3: 30 m; others: 36 m; 45 m along a balcony approach for each.
   B11.3(b): at most 48 m between required staircases (or discharge points),
   along the centreline of the exit route. */
export const TRAVEL = {
  "1-2": { label: "Use Classifications 1 and 2 (flats, hotels)", within: 24, deadend: 15, deadend_balcony: 15, max: 24, max_balcony: 45,
    refs: { within: "B11.2(a)(i)", deadend: "B11.2(a)(ii)", max: "B11.3(a)(i)" } },
  "3": { label: "Use Classification 3", within: null, deadend: 12, deadend_balcony: 24, max: 30, max_balcony: 45,
    refs: { deadend: "B11.2(b)", max: "B11.3(a)(ii)" } },
  other: { label: "All other Use Classifications", within: null, deadend: 18, deadend_balcony: 24, max: 36, max_balcony: 45,
    refs: { deadend: "B11.2(c)", max: "B11.3(a)(iii)" } },
};
export const STAIR_SEPARATION = 48;          // B11.3(b)

/* FS Code Table B5 (Clause B21.1): Use Classification 5a at a storey 12 m or
   more above the ground floor - the minimum number of exits and the minimum
   total width of the exit routes (mm). */
export const B5 = [
  { from: 31, to: 200, n: 2, routes: 2400 }, { from: 201, to: 300, n: 2, routes: 2600 }, { from: 301, to: 500, n: 2, routes: 4300 },
  { from: 501, to: 750, n: 3, routes: 6400 }, { from: 751, to: 1000, n: 4, routes: 8500 }, { from: 1001, to: 1250, n: 5, routes: 10400 },
  { from: 1251, to: 1500, n: 6, routes: 12500 }, { from: 1501, to: 1750, n: 7, routes: 14600 }, { from: 1751, to: 2000, n: 8, routes: 16700 },
  { from: 2001, to: 2500, n: 10, routes: 20800 }, { from: 2501, to: 3000, n: 12, routes: 24900 },
];
