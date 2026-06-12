// Single source of truth for the offers-table column set — order, col-*
// class, header label, and sort key.
//
// Consumed by:
//   - table-loading.tsx       → skeleton thead + SkeletonRow cells
//   - offers-table.tsx        → empty-state colSpan (TABLE_COLUMN_COUNT)
//   - __tests__/table-columns.test.tsx → drift guard against the live thead
//     in table-page.tsx (which renders its header inline and must stay in
//     lockstep with this array)
//
// Why this exists: the loading skeleton once rendered an 8-column header
// while the hydrated table rendered 13 — every header label visibly jumped
// when data landed. Any column change (add/remove/reorder/rename) goes HERE
// first; the drift-guard test fails if table-page.tsx disagrees.

export interface OffersTableColumn {
  /** `col-*` class shared by the th and its td cells. */
  className: string;
  /** Header label. Control columns ('' / sr-only) carry no visible text. */
  label: string;
  /** `data-sort-key` of the live header in table-page.tsx, when sortable. */
  sortKey?: string;
}

export const OFFERS_TABLE_COLUMNS: readonly OffersTableColumn[] = [
  { className: 'col-select', label: '' },
  { className: 'col-num', label: '#', sortKey: 'num' },
  { className: 'col-co', label: 'Company', sortKey: 'company' },
  { className: 'col-role', label: 'Role', sortKey: 'role' },
  { className: 'col-status', label: 'Status', sortKey: 'status' },
  { className: 'col-score', label: 'Score', sortKey: 'score' },
  // Order after Score: dropdown fields (seniority, mode, archetype)
  // → inline-edit fields (comp, location) → date.
  { className: 'col-seniority', label: 'Seniority', sortKey: 'seniority' },
  { className: 'col-mode', label: 'Mode', sortKey: 'work_mode' },
  { className: 'col-arch', label: 'Archetype', sortKey: 'archetype' },
  { className: 'col-comp', label: 'Comp', sortKey: 'comp' },
  { className: 'col-loc', label: 'Location', sortKey: 'loc' },
  // Two date columns (posted-date design, 2026-06-10): 'Posted' = the true
  // posting date when the source reported one ('—' otherwise); 'Added' = the
  // added/scan date every row has. Posted leads, Added follows. Both
  // sortable; the Posted sort sinks rows without a posting date to the
  // bottom (see applySort).
  { className: 'col-posted', label: 'Posted', sortKey: 'posted' },
  { className: 'col-date', label: 'Added', sortKey: 'date' },
  { className: 'col-kebab', label: 'Actions' },
];

/** Total column count — empty-state colSpan in offers-table.tsx. */
export const TABLE_COLUMN_COUNT = OFFERS_TABLE_COLUMNS.length;
