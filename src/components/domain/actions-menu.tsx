'use client';

/* components/actions-menu.tsx
 *
 * Shared positioned dropdown menu of background-job actions — the Add
 * button in the table/kanban topbar. (A per-row scope used to exist here
 * but was never mounted: per-row menus ship as RowActionsMenu /
 * KebabActionsMenu. The dead branch carried stale labels, so it was
 * removed — 2026-06-10 audit.)
 *
 * Markup mirrors legacy public/table.html lines 1487-1497 verbatim
 * (.actions-menu / .actions-menu__list / .actions-menu__item / __icon /
 * __label / __title / __sub). Visual chrome lives in chrome.css.
 *
 * Item population is driven entirely by lib/job-types.ts (the 1:1 port of
 * legacy public/job-types.js): entries with a menuTitle (scan,
 * batch-evaluate, screen).
 *
 * The two scan actions spend tokens on every pending/new offer, so they
 * don't fire on a bare menu click: picking one stages it behind a
 * ScanConfirmModal (Cost/Time/Result — same treatment as single-row
 * Evaluate) and only Confirm dispatches onSelect.
 *
 * Behaviour ported from legacy table.html actions-menu IIFE (lines
 * 1461-1691): fixed-position popover anchored to the trigger, closes on
 * Escape / outside-click / item-click, keyboard nav (Arrow Up/Down/Home/
 * End to traverse, Enter to fire).
 */

import { FilePlusCorner, FileSearchCorner, FolderSearch } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ScanConfirmJobType, ScanConfirmModal } from '@/components/modals/scan-confirm-modal';
import { JOB_TYPES } from '@/lib/job-types';

// Lucide icons for the global Add menu, keyed by job type. Overrides the plain
// glyph in JOB_TYPES.menuIcon (kept there as a data-only fallback) so the menu
// renders crisp vector icons:
//   scan           → file-search-corner (scan + basic screening)
//   batch-evaluate → folder-search      (scan + full evaluation)
//   screen         → file-plus-corner   (add a single new offer)
const MENU_ICONS: Record<string, React.ReactNode> = {
  scan: <FileSearchCorner aria-hidden="true" size={16} strokeWidth={1.8} />,
  'batch-evaluate': <FolderSearch aria-hidden="true" size={16} strokeWidth={1.8} />,
  screen: <FilePlusCorner aria-hidden="true" size={16} strokeWidth={1.8} />,
};

// Only the global Add-button scope exists — the row-scope variant was dead
// code (never mounted; per-row menus are RowActionsMenu / KebabActionsMenu)
// with stale labels, removed per the 2026-06-10 audit. Kept as a named type
// so existing handler signatures stay source-compatible.
export type ActionsMenuScope = 'global';

interface ActionsMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  scope: ActionsMenuScope;
  onClose: () => void;
  onSelect: (jobType: string, scope: ActionsMenuScope) => void;
}

export function ActionsMenu({ open, anchorRef, scope, onClose, onSelect }: ActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Scan action staged behind the confirm dialog. Outlives `open` — the
  // menu closes the moment an item is picked, the dialog renders after.
  const [pendingScan, setPendingScan] = useState<ScanConfirmJobType | null>(null);
  // Legacy global Add menu filter: only entries with a menuTitle
  // (scan, batch-evaluate, screen).
  const items = JOB_TYPES.filter(j => j.menuTitle);

  // Position the menu absolutely below the anchor — legacy openMenu() math
  // (table.html lines 1510-1515): right-align to trigger, 6px gap below.
  // Extra: clamp to viewport so the menu doesn't extend past the right edge
  // when the table is wider than the viewport (kebab can be at x > innerWidth).
  // useLayoutEffect runs before paint so we never see a 0,0 flash.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const mW = menu.offsetWidth;
    const top = r.bottom + 6;
    const maxLeft = window.innerWidth - mW - 8;
    const left = Math.max(8, Math.min(r.right - mW, maxLeft));
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    // Focus the MENU CONTAINER (not the first item) so keyboard nav works
    // (Arrow Down moves to the first item via handleMenuKeyDown) but no
    // item is "armed" with focus. The legacy behaviour of focusing the
    // first item made it look pre-selected and let users accidentally
    // trigger destructive actions like Scan Portals by pressing Enter
    // immediately after opening the menu.
    menu.focus();
  }, [open, anchorRef]);

  // Outside-click + Escape — global listeners only when menu is open.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const menu = menuRef.current;
      const anchor = anchorRef.current;
      if (!menu) return;
      const t = e.target as Node;
      if (menu.contains(t)) return;
      if (anchor && anchor.contains(t)) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        anchorRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  const focusItem = useCallback((delta: number) => {
    const menu = menuRef.current;
    if (!menu) return;
    const btns = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('.actions-menu__item:not(:disabled)'),
    );
    if (btns.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? btns.indexOf(active as HTMLButtonElement) : -1;
    let next: number;
    if (delta === Number.POSITIVE_INFINITY) next = btns.length - 1;
    else if (delta === Number.NEGATIVE_INFINITY) next = 0;
    else next = idx < 0 ? 0 : (idx + delta + btns.length) % btns.length;
    btns[next]?.focus();
  }, []);

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(Number.NEGATIVE_INFINITY);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(Number.POSITIVE_INFINITY);
    }
  }

  // Portal to document.body so the menu escapes any transformed ancestor
  // (the table rows have .anim-enter with transform:matrix which creates a
  // containing block for fixed children, breaking viewport-relative positioning).
  if (typeof document === 'undefined') return null;

  const menuNode = (
    <div
      ref={menuRef}
      className="actions-menu actions-menu--compact"
      role="menu"
      tabIndex={-1}
      aria-label="Add actions"
      onKeyDown={handleMenuKeyDown}
    >
      <ul className="actions-menu__list">
        {items.map(j => {
          const title = j.menuTitle ?? j.type;
          const sub = j.menuSub ?? undefined;
          return (
            <li key={j.type}>
              <button
                type="button"
                role="menuitem"
                className="actions-menu__item"
                data-action={j.type}
                onClick={() => {
                  onClose();
                  // Token-spending bulk actions get a confirm step (cost,
                  // time, result) before dispatch — only 'Add offer'
                  // (screen) goes straight through, to its own URL modal.
                  if (j.type === 'scan' || j.type === 'batch-evaluate') {
                    setPendingScan(j.type);
                    return;
                  }
                  onSelect(j.type, scope);
                }}
              >
                {(() => {
                  const icon = MENU_ICONS[j.type] ?? j.menuIcon;
                  return icon ? (
                    <span className="actions-menu__icon" aria-hidden="true">
                      {icon}
                    </span>
                  ) : null;
                })()}
                <span className="actions-menu__label">
                  <span className="actions-menu__title">{title}</span>
                  {sub ? <span className="actions-menu__sub">{sub}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      {open ? createPortal(menuNode, document.body) : null}
      {pendingScan ? (
        <ScanConfirmModal
          jobType={pendingScan}
          returnFocus={anchorRef.current ?? undefined}
          onCancel={() => setPendingScan(null)}
          onConfirm={() => {
            const t = pendingScan;
            setPendingScan(null);
            onSelect(t, scope);
          }}
        />
      ) : null}
    </>
  );
}
