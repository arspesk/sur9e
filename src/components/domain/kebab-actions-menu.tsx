'use client';

/* components/domain/kebab-actions-menu.tsx
 *
 * Shared primitive for portaled, viewport-clamped action menus opened from
 * a kebab/⋮ trigger. Extracted from features/table/drawer/kebab-menu.tsx so
 * the report kebab + drawer kebab share one positioning + outside-click +
 * Escape implementation. The visual chrome is the same `.actions-menu`
 * stack used everywhere else in the app.
 *
 * Items are declarative (label/icon/onClick/danger/disabled/divider). The
 * primitive auto-closes via onClose before invoking the item's onClick so
 * downstream handlers don't have to call close themselves.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface KebabItem {
  /** Optional grouping label (currently unused by the renderer; kept for future). */
  group?: string;
  icon?: React.ReactNode;
  /** Visible label. For divider rows pass an empty string. */
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** When true the row renders as a thin horizontal separator. */
  divider?: boolean;
  onClick?: () => void;
}

interface KebabActionsMenuProps {
  items: KebabItem[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  ariaLabel?: string;
  /** Extra class on the portaled menu — e.g. a z-index bump when the
   *  trigger lives in chrome that outranks --z-popover (batch action bar
   *  on mobile sits above the bottom nav). */
  className?: string;
}

export function KebabActionsMenu({
  items,
  triggerRef,
  onClose,
  ariaLabel = 'Actions',
  className,
}: KebabActionsMenuProps) {
  const menuRef = useRef<HTMLElement>(null);

  // Position below-right of the trigger, clamped to viewport so the menu
  // can't extend past the right edge on narrow widths. Mirrors the math
  // from the legacy drawer kebab + ActionsMenu (single source of truth now).
  // Flips ABOVE the trigger when there's no room below (e.g. the batch
  // action bar's Generate menu, anchored near the viewport bottom).
  //
  // The menu must NEVER overlap its own trigger: a re-click on the trigger
  // is the toggle-closed gesture, and an overlapping menu turns that click
  // into whatever menu item sits over the kebab (worst case the danger
  // Delete row, or a generator launch). When neither side fits the full
  // menu, it stays on the roomier side with maxHeight capped to the
  // available gap (scrolling inside) instead of clamping over the trigger.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const mW = menu.offsetWidth;
    const mH = menu.offsetHeight;
    const gap = 6;
    const roomBelow = window.innerHeight - 8 - (rect.bottom + gap);
    const roomAbove = rect.top - gap - 8;
    let top: number;
    if (mH <= roomBelow) {
      top = rect.bottom + gap;
    } else if (mH <= roomAbove) {
      top = rect.top - mH - gap;
    } else if (roomBelow >= roomAbove) {
      top = rect.bottom + gap;
      menu.style.maxHeight = `${Math.max(48, Math.floor(roomBelow))}px`;
      menu.style.overflowY = 'auto';
    } else {
      const capped = Math.max(48, Math.floor(roomAbove));
      top = rect.top - capped - gap;
      menu.style.maxHeight = `${capped}px`;
      menu.style.overflowY = 'auto';
    }
    const maxLeft = window.innerWidth - mW - 8;
    const left = Math.max(8, Math.min(rect.right - mW, maxLeft));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    // Focus the menu container (not the first item) so Arrow Down arms an
    // item but Enter on open doesn't accidentally fire a destructive action.
    menu.focus();
  }, [triggerRef]);

  // Outside-click + Escape. mousedown (not click) to avoid racing the same
  // click that opened the menu.
  useEffect(() => {
    function handlePointerDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    function handleKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        triggerRef.current?.focus();
        return;
      }
      // Trap Tab/Shift+Tab inside the menu and cycle across the items,
      // matching how Radix menus contain keyboard focus. Without this Tab
      // walks out of the portaled menu into the page behind it.
      if (ev.key === 'Tab') {
        const menu = menuRef.current;
        if (!menu) return;
        const items = Array.from(
          menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])'),
        );
        if (items.length === 0) {
          ev.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (ev.shiftKey) {
          if (active === first || active === menu) {
            ev.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          ev.preventDefault();
          first.focus();
        } else if (active === menu) {
          ev.preventDefault();
          first.focus();
        }
        return;
      }
      // WAI-ARIA menu pattern: Arrow keys move across role=menuitem entries
      // (wrapping), Home/End jump to the edges. Focus starts on the menu
      // container, so ArrowDown arms the first item and ArrowUp the last.
      // preventDefault keeps the page behind the portal from scrolling.
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
        const menu = menuRef.current;
        if (!menu) return;
        const items = Array.from(
          menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])'),
        );
        if (items.length === 0) return;
        ev.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (ev.key === 'Home') {
          items[0].focus();
        } else if (ev.key === 'End') {
          items[items.length - 1].focus();
        } else if (ev.key === 'ArrowDown') {
          // From the container (index -1) this lands on the first item.
          items[(index + 1) % items.length].focus();
        } else {
          items[(index - 1 + items.length) % items.length].focus();
        }
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    // Capture phase: the table-row kebab portals out of a <td onKeyDown=stop>,
    // and React re-dispatches synthetic events through the React tree (not the
    // DOM tree) for portals — so a bubble-phase document listener never sees
    // Escape when the trigger lives under a stopPropagation ancestor. Capturing
    // on document runs before React's synthetic dispatch can be halted, so
    // Escape/Tab handling works for every kebab regardless of its React parent.
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose, triggerRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside
      ref={menuRef}
      className={`actions-menu actions-menu--compact${className ? ` ${className}` : ''}`}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
    >
      <ul className="actions-menu__list">
        {items.map((item, i) =>
          item.divider ? (
            <li key={`divider-${i}`} className="actions-menu__sep" aria-hidden="true" />
          ) : (
            <li key={item.label + i}>
              <button
                type="button"
                role="menuitem"
                className={`actions-menu__item${item.danger ? ' actions-menu__item--danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  // Restore focus to the trigger before running the item handler
                  // so a keyboard user keeps their place. For items that open a
                  // confirm Dialog (the generator modals), the Dialog also
                  // restores focus to the trigger on close via the
                  // `returnFocus` element threaded through the modal context (see
                  // RowActionsMenu / DialogContent.onCloseAutoFocus). The
                  // synchronous focus here mirrors the Escape handler above and
                  // covers the non-modal items (Open posting, Copy link).
                  triggerRef.current?.focus();
                  onClose();
                  item.onClick?.();
                }}
              >
                {item.icon && (
                  <span className="actions-menu__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="actions-menu__label">
                  <span className="actions-menu__title">{item.label}</span>
                </span>
              </button>
            </li>
          ),
        )}
      </ul>
    </aside>,
    document.body,
  );
}
