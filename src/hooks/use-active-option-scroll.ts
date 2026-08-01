'use client';

import { type RefObject, useEffect } from 'react';

/**
 * Keep the active listbox option scrolled into view during keyboard arrow
 * navigation. Custom listbox/combobox popovers track an active index but don't
 * natively scroll the highlighted option into the visible area once it passes
 * the scroll edge — so arrowing "off screen" leaves the selection invisible.
 *
 * Mark the active option with `data-active="true"` (or `aria-selected="true"`)
 * and pass the scroll-container ref + the active index. `block: 'nearest'`
 * scrolls the container minimally (down when below, up when above), which is the
 * expected keyboard-nav feel and never yanks the page.
 */
export function useActiveOptionScroll(
  containerRef: RefObject<HTMLElement | null>,
  activeIndex: number,
): void {
  useEffect(() => {
    if (activeIndex < 0) return;
    const active = containerRef.current?.querySelector<HTMLElement>(
      '[data-active="true"],[aria-selected="true"]',
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [containerRef, activeIndex]);
}
