// Pure window math for the virtualized offers table — kept free of React and
// of @tanstack/react-virtual types so the unit tests can drive it with plain
// objects. The runtime wiring lives in hooks/use-table-virtualizer.ts.

/** Minimal shape of a TanStack virtual item that the table consumes. */
export interface VirtualRowItem {
  /** Index into the filtered/sorted row array. */
  index: number;
  /** Offset of the row's top, in virtualizer space (includes scrollMargin). */
  start: number;
  /** Offset of the row's bottom, in virtualizer space (includes scrollMargin). */
  end: number;
}

/** Fixed desktop row height (px) — uniform rows, no per-row measurement. */
export const DESKTOP_ROW_ESTIMATE = 58;

/**
 * Mobile (≤640px) card estimate (px) incl. the 10px margin-bottom gap.
 * Cards are variable-height, so this is only the pre-measurement guess —
 * `measureElement` corrects it per card after mount.
 */
export const MOBILE_CARD_ESTIMATE = 156;

/** Rows mounted beyond the viewport on each side. */
export const ROW_OVERSCAN = 10;

/**
 * Map the virtualizer's mounted range onto the filtered/sorted row array.
 * The rendered set is exactly `rows[item.index]` for each virtual item —
 * selection / drawer / sort stay keyed by `row.num`, never by DOM position.
 */
export function sliceVirtualRows<T>(rows: readonly T[], items: readonly { index: number }[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const row = rows[item.index];
    if (row !== undefined) out.push(row);
  }
  return out;
}

/**
 * Heights for the top/bottom spacer rows that preserve scrollbar geometry
 * around the mounted window. TanStack reports `item.start`/`item.end` and
 * `getTotalSize()` in different spaces — items include `scrollMargin`
 * (thead + wrap padding above the tbody), totalSize does not — so the
 * margin is subtracted back out here.
 */
export function spacerHeights(
  items: readonly VirtualRowItem[],
  totalSize: number,
  scrollMargin: number,
): { top: number; bottom: number } {
  if (items.length === 0) return { top: 0, bottom: 0 };
  const top = Math.max(0, items[0].start - scrollMargin);
  const bottom = Math.max(0, totalSize - (items[items.length - 1].end - scrollMargin));
  return { top, bottom };
}
