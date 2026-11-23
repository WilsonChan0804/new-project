/* Outline Zoning Plans transcribed from their Notes, for the Site study's
 * Planning card: choosing the plan and the zone fills in the restrictions.
 * Each entry cites the Notes it comes from so it can be checked; add a plan
 * by transcribing its Notes the same way. A "plan" height (bhPlan) is shown
 * on the Plan itself, per site, so it is typed in.
 *
 * dpr / npr: maximum domestic / non-domestic plot ratio; pr: maximum plot
 * ratio where the Notes give one figure; sc: maximum site coverage % (null:
 * no restriction stated); bh: maximum building height, mPD (null + bhPlan:
 * "as stipulated on the Plan"); storeys: maximum number of storeys.
 */
export const OZP = {
  "S/TKO/32": {
    name: "Tseung Kwan O Outline Zoning Plan No. S/TKO/32",
    src: "Notes, Residential (Group A), Remarks (a), (e), (g), (h); ES 8.3",
    zones: {
      "R(A)1": { dpr: 5.5, npr: 0.5, sc: null, bh: 138 },
      "R(A)2": { dpr: 5, npr: 0.5, sc: 50, bh: 100 },
      "R(A)3": { dpr: 4, npr: 0.5, sc: 50, bh: 100 },
      "R(A)4 Area (a)": { dpr: 3, npr: 0.5, sc: 50, bh: 65 },
      "R(A)4 Area (b)": { dpr: 3, npr: 0.5, sc: 50, bh: 35 },
      "R(A)5": { dpr: 3, npr: 0.5, sc: 50, bh: 65 },
      "R(A)6 Area (a)": { dpr: 2, npr: 0.5, sc: 50, bh: 50 },
      "R(A)6 Area (b)": { dpr: 2, npr: 0.5, sc: 50, bh: 35 },
      "R(A)6 Area (c)": { dpr: 2, npr: 0.5, sc: 50, bh: 60 },
      "R(A)7": { pr: 6.5, sc: null, bh: null, bhPlan: true },
      "R(A)8": { pr: 6, sc: null, bh: null, bhPlan: true },
      "R(A)9": { dpr: 7.5, npr: 0.3, sc: null, bh: null, bhPlan: true,
        note: "Railway, public transport, public pedestrian passageway and GIC facilities required by the Government may be disregarded from PR (Remark (g)). Area 137A: 200 mPD, Area 137B: 190 mPD on the Plan." },
      "R(A)10": { dpr: 7, npr: 0.3, sc: null, bh: null, bhPlan: true, note: "Remark (g) as R(A)9." },
      "R(A)11": { dpr: 6, npr: 0.3, sc: null, bh: null, bhPlan: true, note: "Remark (g) as R(A)9." },
      "R(A)12": { dpr: 4, npr: 0.3, sc: null, bh: null, bhPlan: true, note: "Remark (g) as R(A)9." },
    },
    common: "Car park, loading/unloading bay, plant room, caretaker's office / quarters and residents' recreational facilities may be disregarded from PR (Remark (e)) but are included in site coverage (Remark (h)). Minor relaxation by s.16 application (Remark (i)).",
  },
};

export const OZP_PORTAL = "https://www.ozp.tpb.gov.hk/";
