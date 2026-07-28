'use client';

import { type RefObject, useEffect } from 'react';

const CLIP_EPSILON = 2;

/**
 * Adds `.is-clipped` only while one nowrap element is genuinely overflowing.
 * The class is deliberately the same marker used by the offers table's
 * fog-of-war fade.
 */
export function useOverflowFade(ref: RefObject<HTMLElement | null>, content?: string): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      element.classList.toggle(
        'is-clipped',
        element.scrollWidth - element.clientWidth > CLIP_EPSILON,
      );
    };

    measure();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, content]);
}
