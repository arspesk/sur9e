// Pure per-column window math for the kanban board (large-offer-sets
// design, 2026-06-10). Each column renders the FIRST `COLUMN_WINDOW` cards
// of its already-sorted list — a head-slice of the rowsByStatus order,
// which itself preserves the applySort(applyFilters(...)) pipeline order —
// plus a "Show 25 more" expander. Kept React-free so unit tests drive it
// with plain arrays.

/** Cards initially mounted per column; also the expander step. */
export const COLUMN_WINDOW = 25;

/** Head-slice of the column's ordered card list. */
export function windowCards<T>(items: readonly T[], visibleCount: number): T[] {
  return items.slice(0, Math.max(0, visibleCount));
}

/** How many cards remain hidden past the current window. */
export function remainingCount(total: number, visibleCount: number): number {
  return Math.max(0, total - Math.max(0, visibleCount));
}

/** Window size after one "Show 25 more" click. */
export function nextWindow(visibleCount: number, step: number = COLUMN_WINDOW): number {
  return Math.max(0, visibleCount) + step;
}

/**
 * Smallest whole-step window that mounts the card at `index` — used when
 * drawer prev/next walks past the current window: the column expands just
 * enough (in 25-card steps) for the active card to mount.
 */
export function windowForIndex(index: number, step: number = COLUMN_WINDOW): number {
  if (index < 0) return step;
  return Math.ceil((index + 1) / step) * step;
}
