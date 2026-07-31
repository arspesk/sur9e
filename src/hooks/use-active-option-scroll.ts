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
    // Prefer the owner-controlled data marker. Some headless list libraries
    // update aria-selected through internal state one effect later, so during
    // the controlling index change the old row and new row can briefly both
    // match a combined selector. Falling back to aria-selected still supports
    // native/third-party listboxes that do not expose data-active.
    const active =
      containerRef.current?.querySelector<HTMLElement>('[data-active="true"]') ??
      containerRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [containerRef, activeIndex]);
}
