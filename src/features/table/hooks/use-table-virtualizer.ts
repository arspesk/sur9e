'use client';

/* hooks/use-table-virtualizer.ts
 *
 * Windowed rendering for the offers table, virtualized against an INNER
 * scroll container — the `.table-wrap` element (a contained data-grid
 * viewport, Airtable/Linear style). Only the rows in or near the viewport
 * mount (~30 at a time, overscan 10). Real <table> semantics are preserved
 * by the consumer (offers-table.tsx): a sticky <thead> (pinned to the top of
 * the scrollport via `top: 0`), a single <tbody>, and top/bottom spacer rows
 * whose heights come from spacerHeights() so scrollbar geometry matches the
 * full row set.
 *
 * Why an inner scroll container, not window-scroll: the page chrome (Offers
 * title, count, search/filter bar, topbar) stays FIXED above the grid while
 * the table scrolls horizontally AND vertically inside its own viewport. The
 * `.offers-shell` wrapper is height: calc(100vh - topbar) / overflow: hidden;
 * the `.table-wrap` inside it is the lone flex:1 / overflow:auto scroller.
 *
 * Breakpoint split (locked in the large-offer-sets design):
 *   - desktop: fixed estimateSize — rows are uniform height, no measurement
 *   - ≤640px:  rows render as variable-height cards → dynamic measurement
 *     via measureElement (incl. the card's margin-bottom gap, which the
 *     default border-box measurement would miss)
 *
 * Scroll restoration: the inner container's scrollTop is NOT restored by the
 * browser's native document-scroll restoration. The table never unmounts
 * (the drawer is a non-modal side peek that leaves it mounted), so in-session
 * scroll survives; only a hard reload / back-nav resets to the top, which is
 * acceptable for a triage grid.
 */

import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { DESKTOP_ROW_ESTIMATE, MOBILE_CARD_ESTIMATE, ROW_OVERSCAN } from '../virtual-rows';

const MOBILE_QUERY = '(max-width: 640px)';

// SSR has no scroll element to measure; a typical desktop viewport rect makes
// the server (and hydration) render a sensible first window from offset 0.
const INITIAL_RECT = { width: 1280, height: 744 };

function subscribeToMedia(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToMedia,
    () => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

interface UseTableVirtualizerOptions {
  /** Number of filtered/sorted rows (post-optimistic). */
  count: number;
  /** The <table>, used to measure the tbody's offset within the scrollport. */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** The `.table-wrap` scroll container (the virtualizer's scroll element). */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** Stable per-index key (row num) so remounts don't shuffle measurements. */
  getItemKey: (index: number) => number | string;
}

interface UseTableVirtualizerResult {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Whether the ≤640px card layout (dynamic measurement) is active. */
  isMobile: boolean;
  /** Offset of the tbody top within the scroll element (px) — the thead height. */
  scrollMargin: number;
  /** Row ref for dynamic measurement — only attached on mobile. */
  measureRowRef: ((el: HTMLTableRowElement | null) => void) | undefined;
}

export function useTableVirtualizer({
  count,
  tableRef,
  wrapRef,
  getItemKey,
}: UseTableVirtualizerOptions): UseTableVirtualizerResult {
  const isMobile = useIsMobile();

  // Offset of the first row WITHIN the scroll element: distance from the top
  // of the .table-wrap scrollport to the tbody — i.e. the sticky thead's
  // height (0 on mobile, where the thead is display:none). The virtualizer
  // needs this so its visible-range and scrollToIndex math line up with the
  // container's scroll coordinates.
  const [scrollMargin, setScrollMargin] = useState(0);
  const measureMargin = useCallback(() => {
    const tbody = tableRef.current?.tBodies?.[0];
    const wrap = wrapRef.current;
    if (!tbody || !wrap) return;
    const margin =
      tbody.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    setScrollMargin(prev => (Math.abs(prev - margin) > 1 ? margin : prev));
  }, [tableRef, wrapRef]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => wrapRef.current,
    estimateSize: () => (isMobile ? MOBILE_CARD_ESTIMATE : DESKTOP_ROW_ESTIMATE),
    overscan: ROW_OVERSCAN,
    scrollMargin,
    getItemKey,
    initialRect: INITIAL_RECT,
    // Mobile cards carry a 10px margin-bottom; the default measurement is
    // border-box only, so the gap would accumulate as scrollbar drift.
    measureElement: element => {
      const rect = element.getBoundingClientRect();
      const marginBottom = Number.parseFloat(getComputedStyle(element).marginBottom) || 0;
      return rect.height + marginBottom;
    },
  });

  // Re-measure the tbody offset + flush cached row measurements when the
  // breakpoint flips (thead shows/hides, row heights change scale), when the
  // window resizes (the page-head can reflow, moving the tbody), and once the
  // wrap mounts (scrollMargin starts at 0 before the ref is attached).
  useEffect(() => {
    measureMargin();
    virtualizer.measure();
    window.addEventListener('resize', measureMargin);
    return () => window.removeEventListener('resize', measureMargin);
  }, [isMobile, measureMargin, virtualizer]);

  return {
    virtualizer,
    isMobile,
    scrollMargin,
    measureRowRef: isMobile ? virtualizer.measureElement : undefined,
  };
}
