/* Issue types.
 *
 * One list, used by the form, the list grouping, the pins on the sheet and
 * the pins in 3D, so a "Fire" issue is the same red everywhere it appears.
 * The categories follow what a design review actually raises; "General" is
 * the default so an issue is never left without one.
 *
 * Colours are chosen to stay distinguishable from each other and from the
 * orange of the interface, and to remain readable on white paper.
 */

export const ISSUE_TYPES = [
  { id: "general",    label: "General",       color: "#6b7280" },
  { id: "design",     label: "Design",        color: "#2563eb" },
  { id: "coordination", label: "Coordination", color: "#7c3aed" },
  { id: "clash",      label: "Clash",         color: "#db2777" },
  { id: "fire",       label: "Fire safety",   color: "#dc2626" },
  { id: "statutory",  label: "Statutory / BD", color: "#b45309" },
  { id: "structure",  label: "Structure",     color: "#0f766e" },
  { id: "mep",        label: "MEP",           color: "#0891b2" },
  { id: "facade",     label: "Facade",        color: "#65a30d" },
  { id: "drawing",    label: "Drawing error", color: "#9333ea" },
  { id: "query",      label: "Query / RFI",   color: "#0284c7" },
];

const BY_ID = new Map(ISSUE_TYPES.map((t) => [t.id, t]));

export const typeOf = (it) =>
  BY_ID.get((it && it.issue && it.issue.type) || "general") || ISSUE_TYPES[0];

export const typeColor = (it) => typeOf(it).color;

export function typeOptions(selected) {
  return ISSUE_TYPES.map((t) =>
    `<option value="${t.id}"${t.id === (selected || "general") ? " selected" : ""}>`
    + `${t.label}</option>`).join("");
}

/* A date written the way a register reads it: day, short month, year.
   The ISO timestamp stays in the record; this is only for display. */
export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });
}
