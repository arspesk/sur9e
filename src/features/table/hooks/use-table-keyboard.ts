'use client';

/* hooks/use-table-keyboard.ts
 *
 * Keyboard shortcut hook for the offers table.
 *
 * Two surfaces, composable independently:
 *   - getSortKeyDown — Enter/Space on a sortable <th> fires onSort (the
 *     original table-page.tsx behavior).
 *   - getRowKeyDown — Arrow/Home/End/PageUp/PageDown on a focused row move
 *     focus through the table. Under windowed rendering the target row may
 *     not be mounted yet, so the handler first asks the virtualizer to
 *     scrollToIndex (mounting it) and then focuses the row once it appears
 *     (rAF retry — the virtualizer commits the new window on the next
 *     React render, not synchronously).
 */

// PageUp/PageDown jump — roughly one desktop viewport of rows.
const PAGE_JUMP = 12;
// How many frames to wait for the virtualizer to mount the target row.
const FOCUS_RETRY_FRAMES = 12;

interface UseTableKeyboardOptions {
  /** Sort-header callback (Enter/Space on a <th>). */
  onSort?: (key: string) => void;
  /** Ensure the row at `index` is mounted + scrolled into view. */
  scrollToIndex?: (index: number) => void;
  /** Total filtered row count — bounds for row navigation. */
  rowCount?: number;
}

interface UseTableKeyboardResult {
  getSortKeyDown: (key: string) => (e: React.KeyboardEvent<HTMLTableCellElement>) => void;
  getRowKeyDown: (index: number) => (e: React.KeyboardEvent<HTMLTableRowElement>) => void;
}

function focusRowByIndex(tbody: HTMLElement | null, index: number, framesLeft: number): void {
  if (!tbody) return;
  const row = tbody.querySelector<HTMLElement>(`tr[data-index="${index}"]`);
  if (row) {
    row.focus();
    return;
  }
  if (framesLeft > 0) {
    requestAnimationFrame(() => focusRowByIndex(tbody, index, framesLeft - 1));
  }
}

export function useTableKeyboard({
  onSort,
  scrollToIndex,
  rowCount = 0,
}: UseTableKeyboardOptions): UseTableKeyboardResult {
  function getSortKeyDown(key: string) {
    return (e: React.KeyboardEvent<HTMLTableCellElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSort?.(key);
      }
    };
  }

  function getRowKeyDown(index: number) {
    return (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      // Only act on the row itself — keystrokes inside inline editors /
      // pills / checkboxes keep their native behavior.
      if (e.target !== e.currentTarget) return;
      let target: number;
      switch (e.key) {
        case 'ArrowDown':
          target = index + 1;
          break;
        case 'ArrowUp':
          target = index - 1;
          break;
        case 'PageDown':
          target = index + PAGE_JUMP;
          break;
        case 'PageUp':
          target = index - PAGE_JUMP;
          break;
        case 'Home':
          target = 0;
          break;
        case 'End':
          target = rowCount - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      target = Math.max(0, Math.min(rowCount - 1, target));
      if (target === index || rowCount === 0) return;
      scrollToIndex?.(target);
      focusRowByIndex(e.currentTarget.closest('tbody'), target, FOCUS_RETRY_FRAMES);
    };
  }

  return { getSortKeyDown, getRowKeyDown };
}
