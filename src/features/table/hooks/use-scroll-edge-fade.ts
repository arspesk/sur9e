'use client';

/* hooks/use-scroll-edge-fade.ts
 *
 * Fades the left/right edges of a horizontal scroll container ("fog of war",
 * same affordance as the kanban .board-wrap) so it's clear there's more table
 * scrolled out of view. Unlike the kanban's always-on static mask, this is
 * scroll-aware: an edge only fades when there's actually content hidden past it
 * (left fades once you've scrolled right; right fades while more remains), so
 * the first column isn't fogged at scroll-start.
 *
 * Toggles data-fade-left / data-fade-right on the container; table-inline.css
 * turns those into the gradient mask. Recomputes on scroll, container/content
 * resize, and window resize.
 */

import { useEffect } from 'react';

const EDGE_EPSILON = 1;

export function useScrollEdgeFade(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      const node = ref.current;
      if (!node) return;
      const { scrollLeft, scrollWidth, clientWidth } = node;
      const maxScroll = scrollWidth - clientWidth;
      node.dataset.fadeLeft = scrollLeft > EDGE_EPSILON ? 'true' : 'false';
      node.dataset.fadeRight = scrollLeft < maxScroll - EDGE_EPSILON ? 'true' : 'false';
    }

    update();

    el.addEventListener('scroll', update, { passive: true });
    // clientWidth (viewport/rail) and scrollWidth (rows, column resize) both
    // change the overflow state — observe the wrap and its inner table.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    window.addEventListener('resize', update);

    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
}
