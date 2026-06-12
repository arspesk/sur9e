// Window-math tests for the virtualized offers table (large-offer-sets
// design): given a virtualizer range and the filtered/sorted row array, the
// rendered num set must match exactly, and the spacer rows must preserve
// total scrollbar geometry.

import { describe, expect, it } from 'vitest';
import {
  DESKTOP_ROW_ESTIMATE,
  ROW_OVERSCAN,
  sliceVirtualRows,
  spacerHeights,
  type VirtualRowItem,
} from '../virtual-rows';

/** Build fixed-height virtual items for [first..last], TanStack-style:
 * item offsets live in virtualizer space, i.e. they include scrollMargin. */
function makeItems(
  first: number,
  last: number,
  size = DESKTOP_ROW_ESTIMATE,
  scrollMargin = 0,
): VirtualRowItem[] {
  const items: VirtualRowItem[] = [];
  for (let index = first; index <= last; index++) {
    items.push({
      index,
      start: scrollMargin + index * size,
      end: scrollMargin + (index + 1) * size,
    });
  }
  return items;
}

const rows = Array.from({ length: 552 }, (_, i) => ({ num: 1000 + i }));

describe('sliceVirtualRows', () => {
  it('maps a mid-list window onto exactly the rows at those indexes', () => {
    const items = makeItems(200, 239);
    const mounted = sliceVirtualRows(rows, items);
    expect(mounted).toHaveLength(40);
    expect(mounted.map(r => r.num)).toEqual(items.map(i => 1000 + i.index));
  });

  it('keeps the window bounded at ~30 rows + overscan, never the full set', () => {
    // A 800px viewport fits ~14 rows; with overscan both sides the mounted
    // set stays an order of magnitude below the 552-row total.
    const viewportRows = Math.ceil(800 / DESKTOP_ROW_ESTIMATE);
    const mounted = sliceVirtualRows(rows, makeItems(100, 100 + viewportRows + 2 * ROW_OVERSCAN));
    expect(mounted.length).toBeLessThan(60);
    expect(mounted.length).toBeLessThan(rows.length / 10);
  });

  it('drops indexes past the end of the row array (filter shrank the set mid-scroll)', () => {
    const mounted = sliceVirtualRows(rows.slice(0, 10), makeItems(5, 14));
    expect(mounted.map(r => r.num)).toEqual([1005, 1006, 1007, 1008, 1009]);
  });

  it('returns empty for an empty range', () => {
    expect(sliceVirtualRows(rows, [])).toEqual([]);
  });
});

describe('spacerHeights', () => {
  const size = DESKTOP_ROW_ESTIMATE;
  const totalSize = rows.length * size;

  it('top + mounted + bottom always equals the full scroll height', () => {
    for (const [first, last] of [
      [0, 39],
      [200, 239],
      [512, 551],
    ] as const) {
      const items = makeItems(first, last, size);
      const { top, bottom } = spacerHeights(items, totalSize, 0);
      const mountedHeight = items.length * size;
      expect(top + mountedHeight + bottom).toBe(totalSize);
      expect(top).toBe(first * size);
      expect(bottom).toBe((rows.length - 1 - last) * size);
    }
  });

  it('subtracts scrollMargin (thead + wrap padding live OUTSIDE the row space)', () => {
    const margin = 94;
    const items = makeItems(10, 49, size, margin);
    const { top, bottom } = spacerHeights(items, totalSize, margin);
    expect(top).toBe(10 * size);
    expect(top + items.length * size + bottom).toBe(totalSize);
  });

  it('window at the very top renders no top spacer', () => {
    const { top } = spacerHeights(makeItems(0, 39, size), totalSize, 0);
    expect(top).toBe(0);
  });

  it('window at the very bottom renders no bottom spacer', () => {
    const { bottom } = spacerHeights(makeItems(512, 551, size), totalSize, 0);
    expect(bottom).toBe(0);
  });

  it('empty range (no rows) renders no spacers', () => {
    expect(spacerHeights([], 0, 0)).toEqual({ top: 0, bottom: 0 });
  });

  it('never goes negative when measurements overshoot totalSize', () => {
    const items = makeItems(550, 551, size);
    const { top, bottom } = spacerHeights(items, 551 * size, 0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBe(0);
  });
});
