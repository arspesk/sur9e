'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface FieldOption {
  key: string;
  label: string;
  disabled?: boolean;
  /** When set, the option renders as a pill with this class (e.g. status
   *  options styled as their colored status pills: `pill pill-applied`). */
  pillClass?: string;
}

interface FieldPopoverProps {
  current: string;
  options: FieldOption[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (key: string) => void;
  onClose: () => void;
  ariaLabel: string;
  /** Positioning strategy. Default 'absolute' (document coords) is right
   *  for in-flow anchors like table cells. Pass 'fixed' when the anchor
   *  lives in a position:fixed container (e.g. the batch action bar) —
   *  document-coord positioning would drift away from it on scroll. */
  strategy?: 'absolute' | 'fixed';
  /** Extra class on the portaled popover — e.g. a z-index bump when the
   *  anchor lives in chrome that outranks --z-popover. */
  className?: string;
}

export function FieldPopover({
  current,
  options,
  anchorRef,
  onPick,
  onClose,
  ariaLabel,
  strategy = 'absolute',
  className,
}: FieldPopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);
  // Normalize so .is-current comparisons work regardless of casing.
  const currentKey = (current || '').toLowerCase();

  // Hidden on first paint so we can measure offsetHeight before
  // positioning — the visibility:hidden → measure → flip dance.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute top/left from anchor rect after the popover renders so we
  // can read its real offsetHeight and flip above the trigger if there's
  // no room below.
  // anchorRef is intentionally NOT in deps — callers often pass a
  // freshly-built `{current}` object every parent render, and we only
  // want to position ONCE on open.
  useLayoutEffect(() => {
    const trigger = anchorRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const r = trigger.getBoundingClientRect();
    const pH = popover.offsetHeight;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= pH + 8 ? r.bottom + 4 : r.top - pH - 4;
    // Clamp left so the popover never overflows the right edge (matters in
    // the narrow drawer + small viewports).
    const maxLeft = window.innerWidth - popover.offsetWidth - 8;
    const left = Math.max(8, Math.min(r.left, maxLeft));
    // Fixed strategy: viewport coords, no scroll offsets — the popover
    // stays glued to a fixed-position anchor while the page scrolls.
    const scrollTop = strategy === 'fixed' ? 0 : window.scrollY;
    const scrollLeft = strategy === 'fixed' ? 0 : window.scrollX;
    setPos({
      top: Math.round(top + scrollTop),
      left: Math.round(left + scrollLeft),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [anchorRef, onClose]);

  // Close on Esc/Tab, handle arrow keys
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        anchorRef.current?.focus();
        return;
      }
      if (e.key === 'Tab') {
        onClose();
        return;
      }
      const items = Array.from(
        popoverRef.current?.querySelectorAll<HTMLButtonElement>(
          '.field-popover__item:not([disabled])',
        ) ?? [],
      );
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(i + 1 + items.length) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [anchorRef, onClose]);

  // Focus the popover CONTAINER (not an item) once positioned, so the
  // currently-selected option isn't visually highlighted via :focus on open.
  // Arrow keys still move into the list — the keydown handler resolves the
  // next item from document.activeElement (container → items[0] on ArrowDown).
  useEffect(() => {
    if (!pos) return;
    popoverRef.current?.focus();
  }, [pos]);

  // SSR safety — bail before touching document.body. The popover only ever
  // mounts in response to a client click so this branch is dead in practice,
  // but keeps us defensible if a parent ever renders us at module top level.
  if (typeof document === 'undefined') return null;

  const node = (
    <aside
      ref={popoverRef as React.RefObject<HTMLElement>}
      className={`status-popover field-popover${className ? ` ${className}` : ''}`}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      style={{
        ...(strategy === 'fixed' ? { position: 'fixed' } : {}),
        ...(pos
          ? { top: `${pos.top}px`, left: `${pos.left}px` }
          : { visibility: 'hidden', top: 0, left: 0 }),
      }}
    >
      <ul className="status-popover__list">
        {options.map(opt => {
          const optKey = opt.key.toLowerCase();
          const isCurrent = optKey === currentKey;
          const isDisabled = opt.disabled === true;
          return (
            <li key={opt.key}>
              <button
                type="button"
                role="menuitem"
                className={
                  'status-popover__item field-popover__item' + (isCurrent ? ' is-current' : '')
                }
                data-key={optKey}
                disabled={isDisabled}
                aria-disabled={isDisabled || undefined}
                onClick={() => {
                  // Return focus to the trigger BEFORE the portal unmounts —
                  // otherwise the focused menuitem disappears with the popover
                  // and keyboard focus drops to <body>. Mirrors the Escape
                  // path above. onPick may move focus again (e.g. into the
                  // evaluate modal); that's fine — this is the fallback.
                  anchorRef.current?.focus();
                  onClose();
                  onPick(opt.key);
                }}
              >
                {opt.pillClass ? (
                  <span className={`pill ${opt.pillClass}`}>
                    <span className="dot" aria-hidden="true" />
                    {opt.label}
                  </span>
                ) : (
                  opt.label
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );

  return createPortal(node, document.body);
}
