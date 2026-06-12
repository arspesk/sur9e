'use client';

import { type RefObject, useEffect, useState } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.closest('[hidden]')) return false;
    return true;
  });
}

/**
 * Traps Tab/Shift+Tab inside the given container ref while `active` is true.
 * Restores focus to the previously focused element on deactivation.
 *
 * A trap must never be inescapable (WCAG 2.1.2 No Keyboard Trap): pressing
 * Escape releases the trap, restoring normal Tab order. Callers using this for
 * a modal `role="dialog"` should pair it with their own Escape-to-close, but
 * the built-in release guarantees keyboard users can always break out.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  // Escape releases the trap for the rest of its active lifetime; reset whenever
  // `active` toggles so a re-activated trap engages again.
  const [released, setReleased] = useState(false);
  useEffect(() => {
    setReleased(false);
  }, [active]);

  useEffect(() => {
    if (!active || released || !ref.current) return;

    // Remember what had focus before the trap was activated.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Escape hatch — never let the trap become inescapable.
        setReleased(true);
        return;
      }
      if (e.key !== 'Tab') return;
      const container = ref.current;
      if (!container) return;

      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;

      if (e.shiftKey && focused === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && focused === last) {
        e.preventDefault();
        first.focus();
      } else if (container && !container.contains(focused)) {
        // Focus drifted outside — pull it back.
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeydown);

    return () => {
      document.removeEventListener('keydown', onKeydown);
      // Restore focus when the trap is removed.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, released, ref]);
}
