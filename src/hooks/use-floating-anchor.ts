'use client';

/* hooks/use-floating-anchor.ts
 *
 * Shared anchoring behavior for every floating surface in the app — the
 * custom portaled menus (KebabActionsMenu, FieldPopover, ActionsMenu) and
 * collision padding for the Radix-positioned ones (Select, Popover).
 *
 * Closes the two gaps behind the 2026-07-09 kanban-kebab bug:
 *
 *   1. Bottom-chrome overlap — placement math clamped to the raw viewport
 *      edge, ignoring the fixed bottom chrome. The mobile nav sits at
 *      --z-bottom-bar (100), above --z-popover (90), so any menu tail that
 *      crossed it painted UNDERNEATH. bottomChromeTop() supplies the real
 *      floor so menus flip/cap above the chrome instead.
 *
 *   2. Detached float — every custom surface positioned itself once on
 *      open. All ≤1024px pages inner-scroll (.page-scroll), and kanban
 *      columns / the drawer / the table wrapper scroll internally, so
 *      scrolling moved the trigger while the fixed-position menu stayed
 *      put, "floating freely" with no anchor. useDismissOnScroll() closes
 *      the surface on the first outside scroll instead — re-anchoring on
 *      scroll was tried first and rejected: a menu glued to a card riding
 *      an inner-scroll column escapes the column bounds and floats over
 *      headers/neighbor columns, which reads worse than dismissing.
 */

import { useEffect, useLayoutEffect, useState } from 'react';

// Fixed bottom chrome that floating surfaces must not cover: the mobile
// bottom nav (display:none ≥641px → measures 0×0 there), the batch action
// bar (only when .on — its off state is opacity:0 but still has a box),
// and the report action bar. Menus triggered FROM one of these bars
// naturally flip above it, so including the bar in the floor is safe.
const BOTTOM_CHROME_SELECTOR = '.bottom-bar, .batch-action-bar.on, .action-bar';

/**
 * Viewport-y of the top edge of the highest visible fixed bottom chrome,
 * or window.innerHeight when none is visible. Floating placement math
 * treats this as the floor it may not cross.
 */
export function bottomChromeTop(): number {
  let floor = window.innerHeight;
  for (const el of document.querySelectorAll(BOTTOM_CHROME_SELECTOR)) {
    const r = el.getBoundingClientRect();
    // Visible = has a box and sits in the lower half of the viewport
    // (display:none → 0×0; slide-away states park at/past innerHeight).
    if (r.height > 0 && r.top > window.innerHeight / 2 && r.top < window.innerHeight) {
      floor = Math.min(floor, r.top);
    }
  }
  return floor;
}

/**
 * Dismiss a floating surface when its anchor is invalidated: any scroll
 * OUTSIDE the surface (capture phase — catches inner scroll containers
 * like kanban columns, the drawer body, and .page-scroll, whose events
 * never reach a bubble listener on document) or a viewport resize closes
 * it. Scrolling INSIDE the surface (the cramped-fit maxHeight case) keeps
 * it open.
 *
 * `enabled` gates the listeners for surfaces that stay mounted while
 * closed (ActionsMenu) so a closed menu never spuriously onCloses.
 */
export function useDismissOnScroll(
  enabled: boolean,
  floatingRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onScroll = (ev: Event) => {
      const el = floatingRef.current;
      if (el && ev.target instanceof Node && el.contains(ev.target)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [enabled, floatingRef, onClose]);
}

/**
 * Collision padding for Radix-positioned content (SelectContent,
 * PopoverContent): reserves the visible bottom chrome so Radix flips or
 * constrains above the mobile nav instead of letting content slide under
 * it. Radix already tracks the anchor on scroll, so padding is the only
 * missing piece there.
 */
export function useBottomChromeCollisionPadding(): {
  top: number;
  left: number;
  right: number;
  bottom: number;
} {
  const [pad, setPad] = useState({ top: 8, left: 8, right: 8, bottom: 8 });
  useLayoutEffect(() => {
    setPad(prev => {
      const bottom = Math.max(8, window.innerHeight - bottomChromeTop() + 8);
      return bottom === prev.bottom ? prev : { ...prev, bottom };
    });
  }, []);
  return pad;
}
