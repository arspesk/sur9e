// Column expander slice logic for the kanban board (large-offer-sets
// design): each column shows the FIRST `COLUMN_WINDOW` cards of its
// pipeline-ordered list — a pure head-slice, never a separate heuristic —
// and drawer prev/next can grow the window in whole steps to mount the
// active card.

import { describe, expect, it } from 'vitest';
import {
  COLUMN_WINDOW,
  nextWindow,
  remainingCount,
  windowCards,
  windowForIndex,
} from '../board-window';

const cards = Array.from({ length: 486 }, (_, i) => ({ num: i + 1 }));

describe('windowCards', () => {
  it('is a pure head-slice of the ordered list', () => {
    const visible = windowCards(cards, COLUMN_WINDOW);
    expect(visible).toHaveLength(25);
    expect(visible.map(c => c.num)).toEqual(cards.slice(0, 25).map(c => c.num));
  });

  it('returns everything when the column is smaller than the window', () => {
    expect(windowCards(cards.slice(0, 7), COLUMN_WINDOW)).toHaveLength(7);
  });

  it('grows by COLUMN_WINDOW per expander click', () => {
    let count = COLUMN_WINDOW;
    count = nextWindow(count);
    expect(windowCards(cards, count)).toHaveLength(50);
    count = nextWindow(count);
    expect(windowCards(cards, count)).toHaveLength(75);
  });

  it('clamps a negative window to empty instead of slicing from the tail', () => {
    expect(windowCards(cards, -1)).toEqual([]);
  });
});

describe('remainingCount', () => {
  it('reports the hidden tail', () => {
    expect(remainingCount(486, 25)).toBe(461);
    expect(remainingCount(486, 475)).toBe(11);
  });

  it('never reports negative when the window exceeds the column', () => {
    expect(remainingCount(10, 25)).toBe(0);
  });
});

describe('windowForIndex (drawer prev/next auto-expand)', () => {
  it('keeps the default window for an index already mounted', () => {
    expect(windowForIndex(0)).toBe(25);
    expect(windowForIndex(24)).toBe(25);
  });

  it('expands in whole 25-card steps to mount the active card', () => {
    expect(windowForIndex(25)).toBe(50);
    expect(windowForIndex(49)).toBe(50);
    expect(windowForIndex(50)).toBe(75);
    expect(windowForIndex(485)).toBe(500);
  });

  it('the active card is always inside the window it computes', () => {
    for (const index of [0, 1, 24, 25, 26, 99, 100, 250, 485]) {
      expect(windowForIndex(index)).toBeGreaterThan(index);
    }
  });

  it('tolerates a not-found index without collapsing the window', () => {
    expect(windowForIndex(-1)).toBe(COLUMN_WINDOW);
  });
});
