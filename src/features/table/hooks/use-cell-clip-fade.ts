'use client';

/* hooks/use-cell-clip-fade.ts
 *
 * Marks table body cells whose content is horizontally clipped with an
 * `.is-clipped` class, so table-inline.css can fade their right edge ("fog of
 * war") instead of relying on a hard `text-overflow: ellipsis`.
 *
 * Why a hook (vs pure CSS): CSS can't tell which cells actually overflow, so a
 * static right-edge mask would also fade cells that fit. We measure per cell
 * (scrollWidth > clientWidth) and only mark the ones that are truncated.
 *
 * Under windowed rendering (use-table-virtualizer) the mounted rows ARE the
 * near-viewport set — ~40 rows, never the full tracker — so the old
 * IntersectionObserver that scoped measurement to "rows near the viewport"
 * is gone. Range changes surface as tbody childList mutations (rows mount /
 * unmount as the window moves), which is where re-marking is wired. Reads
 * are still batched before writes inside a single rAF so one pass costs one
 * layout.
 *
 * Re-marks on:
 *   - range change / data change → MutationObserver on tbody (rows added)
 *   - content edits inside a row → MutationObserver subtree records
 *   - column resize             → ResizeObserver on each thead th
 *   - container/viewport        → ResizeObserver on the table + window resize
 */

import { useEffect } from 'react';

// Every body cell fades when its content is clipped — EXCEPT the two
// fixed-width control columns (.col-select checkbox, .col-kebab actions
// button). Those cells are sized to ~36–48px and their control is intrinsically
// a few px wider, so a scrollWidth check always false-positives on them (and
// fading a control reads as a glitch). Everything else — pills included — only
// reports overflow when genuinely truncated. The company name clips inside its
// own flex item, so it's measured directly via .cell-co__name rather than its
// td (which never overflows for that column).
const ROW_CLIP_CELL_SELECTOR = 'td:not(.col-select):not(.col-kebab), .cell-co__name';

// Data rows only — the virtualizer's spacer rows have nothing to measure.
const DATA_ROW_SELECTOR = 'tr:not(.virt-spacer)';

// A couple of px of slack so sub-pixel layout rounding doesn't mark a cell that
// visually fits.
const CLIP_EPSILON = 2;

export function useCellClipFade(tableRef: React.RefObject<HTMLTableElement | null>): void {
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    // Handoff signal for the pre-hydration boot pass (table-boot.ts): its
    // re-mark loop exits once this attribute appears. Set in an effect, so
    // it can't cause a hydration mismatch.
    table.setAttribute('data-clip-hook', '');

    const pending = new Set<HTMLElement>();
    let raf = 0;

    function flush() {
      raf = 0;
      // Reads before writes: toggling .is-clipped invalidates style, so an
      // interleaved read/write loop would force a layout pass per cell.
      const reads: Array<[HTMLElement, boolean]> = [];
      for (const row of pending) {
        if (!row.isConnected) continue;
        for (const el of row.querySelectorAll<HTMLElement>(ROW_CLIP_CELL_SELECTOR)) {
          reads.push([el, el.scrollWidth - el.clientWidth > CLIP_EPSILON]);
        }
      }
      pending.clear();
      for (const [el, clipped] of reads) el.classList.toggle('is-clipped', clipped);
    }

    function queueRows(rows: Iterable<HTMLElement>) {
      for (const row of rows) pending.add(row);
      if (!raf && pending.size > 0) raf = requestAnimationFrame(flush);
    }

    // Geometry changed (column drag, container resize, window resize) or
    // rows mounted — re-measure every mounted row (the near-viewport set).
    function markMounted() {
      const tb = table?.querySelector('tbody');
      if (!tb) return;
      queueRows(tb.querySelectorAll<HTMLElement>(DATA_ROW_SELECTOR));
    }

    markMounted();

    // Column-width changes during a resize drag change individual th widths
    // (the table's own box can stay 100%), so observe each header cell too.
    const resizeObserver = new ResizeObserver(markMounted);
    resizeObserver.observe(table);
    for (const th of table.querySelectorAll<HTMLElement>('thead th')) {
      resizeObserver.observe(th);
    }

    // Rows mounting/unmounting (virtualizer range change, refetch, filter,
    // sort) arrive as tbody childList mutations; content edits inside a row
    // (inline edit, status flip) arrive as subtree mutations — re-measure
    // just the touched rows.
    const mutationObserver = new MutationObserver(records => {
      let rowsChanged = false;
      const touched = new Set<HTMLElement>();
      for (const record of records) {
        const target = record.target as HTMLElement;
        // Rows added/removed → the tbody's own child list changed.
        if (target.tagName === 'TBODY') {
          rowsChanged = true;
          continue;
        }
        // Content changed inside a mounted row → re-measure it.
        const row = target.closest<HTMLElement>('tr');
        if (row && !row.classList.contains('virt-spacer')) touched.add(row);
      }
      if (rowsChanged) markMounted();
      else if (touched.size > 0) queueRows(touched);
    });
    const tbody = table.querySelector('tbody');
    if (tbody) mutationObserver.observe(tbody, { childList: true, subtree: true });

    window.addEventListener('resize', markMounted);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', markMounted);
    };
  }, [tableRef]);
}
