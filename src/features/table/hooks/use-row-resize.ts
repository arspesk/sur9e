'use client';

/* hooks/use-row-resize.ts
 *
 * Encapsulates the pointer-based column-resize logic and localStorage width
 * persistence that was previously inlined in table-page.tsx.
 *
 * Options:
 *   tableRef             — ref to the <table> element
 *   storageKey           — localStorage key for persisted widths
 *   resetButtonSelector  — CSS selector for the "Reset layout" button in the
 *                          filter panel (queried from document)
 *
 * Lifted verbatim from table-page.tsx lines 142–282.
 */

import { useEffect } from 'react';

interface UseRowResizeOptions {
  tableRef: React.RefObject<HTMLTableElement | null>;
  storageKey: string;
  resetButtonSelector: string;
}

export function useRowResize({
  tableRef,
  storageKey,
  resetButtonSelector,
}: UseRowResizeOptions): void {
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    // Restore saved widths
    function loadColWidths(): Record<string, number> {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }

    function saveColWidths(widths: Record<string, number>) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(widths));
      } catch {}
    }

    function setTableLayoutMode(fixed: boolean) {
      if (!table) return;
      table.style.tableLayout = fixed ? 'fixed' : '';
    }

    function applyColWidths(widths: Record<string, number>) {
      let any = false;
      for (const [cls, px] of Object.entries(widths)) {
        const th = table!.querySelector<HTMLElement>(`.offers thead th.${cls}`);
        if (!th) continue;
        th.style.width = `${px}px`;
        any = true;
      }
      if (any) setTableLayoutMode(true);
    }

    applyColWidths(loadColWidths());

    // ── Right-edge boundary ──
    // The last column is a dead end, mirroring the 40px left clamp: the
    // table must never render narrower than its scroll container, which
    // (under table-layout: fixed with every column px-specified) paints
    // the leftover as dead whitespace after the kebab column.
    const wrap = table.closest<HTMLElement>('.table-wrap');

    /** Visible header cells (display:none responsive columns excluded). */
    function visibleThs(): HTMLElement[] {
      return Array.from(
        table!.querySelectorAll<HTMLElement>('.offers thead th[class*="col-"]'),
      ).filter(th => th.offsetWidth > 0);
    }

    /** The width the column set must fill: the scroll container, OR the
     *  table's CSS min-width when that's larger. Desktop keeps a 1320px
     *  floor — the table BOX never shrinks below it even in a narrower
     *  window, so a column sum under the floor opens dead space INSIDE
     *  the table (columns end, box continues) with no wrap involvement. */
    function contentFloor(): number {
      const cssMin = Number.parseFloat(getComputedStyle(table!).minWidth) || 0;
      return Math.max(wrap ? wrap.clientWidth : 0, cssMin);
    }

    /** Sum of the visible columns' rendered widths — the true content
     *  extent (table.offsetWidth can't be used: width:100% + min-width pin
     *  the BOX at the floor even while the columns sum below it). */
    function columnsSum(): number {
      return visibleThs().reduce((acc, th) => acc + th.getBoundingClientRect().width, 0);
    }

    // Saved widths from a NARROWER window (or a stale pre-clamp save) can
    // sum below the current floor, leaving dead space no drag ever
    // re-created. Stretch the persisted columns proportionally — keeps the
    // user's ratios — as ephemeral inline widths (not re-saved: the stored
    // prefs stay window-independent). Runs after applying saved widths and
    // whenever the container resizes (window resize, drawer open/close).
    function healDeadSpace() {
      if (!wrap || !table) return;
      if (getComputedStyle(table).tableLayout !== 'fixed') return;
      const ths = visibleThs();
      if (ths.length === 0) return;
      const sum = ths.reduce((acc, th) => acc + th.getBoundingClientRect().width, 0);
      const dead = contentFloor() - sum;
      if (dead <= 1) return;
      const persisted = ths.filter(th => th.style.width);
      if (persisted.length === 0) return;
      const persistedSum = persisted.reduce((acc, th) => acc + th.getBoundingClientRect().width, 0);
      const factor = (persistedSum + dead) / persistedSum;
      for (const th of persisted) {
        th.style.width = `${Math.round(th.getBoundingClientRect().width * factor)}px`;
      }
    }

    healDeadSpace();
    // ResizeObserver over the wrap catches every container-width change
    // (window resize, drawer toggle, rail collapse) — rAF-coalesced.
    let healRaf = 0;
    const ro =
      typeof ResizeObserver !== 'undefined' && wrap
        ? new ResizeObserver(() => {
            if (healRaf) return;
            healRaf = requestAnimationFrame(() => {
              healRaf = 0;
              healDeadSpace();
            });
          })
        : null;
    if (ro && wrap) ro.observe(wrap);

    // Inject resize handles
    const ths = table.querySelectorAll<HTMLElement>('.offers thead th[class*="col-"]');
    const MIN_WIDTH = 40;
    let dragState: {
      th: HTMLElement;
      handle: HTMLElement;
      startX: number;
      startW: number;
      /** Right-edge clamp: the narrowest this column may go before the
       *  table would fall below the container width (dead end). */
      minW: number;
      pointerId: number;
    } | null = null;
    let lastResizeUpAt = 0;

    function onResizeMove(e: PointerEvent) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const w = Math.max(dragState.minW, dragState.startW + dx);
      dragState.th.style.width = `${w}px`;
    }

    function onResizeEnd(e: PointerEvent) {
      if (!dragState) return;
      const { th, handle, pointerId } = dragState;
      handle.releasePointerCapture(pointerId);
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      handle.removeEventListener('pointermove', onResizeMove as EventListener);
      handle.removeEventListener('pointerup', onResizeEnd as EventListener);
      handle.removeEventListener('pointercancel', onResizeEnd as EventListener);
      const cls = Array.from(th.classList).find(c => c.startsWith('col-'));
      if (cls) {
        const widths = loadColWidths();
        widths[cls] = Math.round(th.getBoundingClientRect().width);
        saveColWidths(widths);
      }
      dragState = null;
    }

    function startResize(e: PointerEvent, th: HTMLElement, handle: HTMLElement) {
      e.preventDefault();
      e.stopPropagation();
      setTableLayoutMode(true);
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      const startW = th.getBoundingClientRect().width;
      // Shrink budget = how far the column sum currently exceeds the
      // content floor (container width, or the table's CSS min-width when
      // larger). Shrinking this column consumes the budget 1:1; when the
      // last column's edge meets the floor the drag dead-ends (no
      // whitespace can open after it) — mirror of the MIN_WIDTH clamp.
      // Budget is measured from the COLUMN SUM, not table.offsetWidth:
      // width:100% + min-width pin the table box at the floor, so the box
      // never reports the deficit a shrink would create inside it.
      const budget = wrap ? Math.max(0, columnsSum() - contentFloor()) : Infinity;
      dragState = {
        th,
        handle,
        startX: e.clientX,
        startW,
        minW: Math.max(MIN_WIDTH, startW - budget),
        pointerId: e.pointerId,
      };
      document.body.style.cursor = 'col-resize';
      handle.addEventListener('pointermove', onResizeMove as EventListener);
      handle.addEventListener('pointerup', onResizeEnd as EventListener);
      handle.addEventListener('pointercancel', onResizeEnd as EventListener);
    }

    // Suppress sort click that fires after a drag
    function onDocPointerUp(e: PointerEvent) {
      if ((e.target as Element)?.classList?.contains('col-resize')) {
        lastResizeUpAt = Date.now();
      }
    }
    document.addEventListener('pointerup', onDocPointerUp, true);

    const handles: HTMLElement[] = [];
    ths.forEach(th => {
      if (th.querySelector('.col-resize')) return;
      const handle = document.createElement('span');
      handle.className = 'col-resize';
      handle.setAttribute('aria-hidden', 'true');
      th.appendChild(handle);
      handles.push(handle);

      handle.addEventListener('pointerdown', (e: PointerEvent) => startResize(e, th, handle));
      // Suppress sort click if resize just finished
      th.addEventListener(
        'click',
        (e: MouseEvent) => {
          if (Date.now() - lastResizeUpAt < 250) e.stopImmediatePropagation();
        },
        true,
      );
    });

    // Wire "Reset layout" button
    const resetLayoutBtn = document.querySelector(resetButtonSelector);
    function handleResetLayout() {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      table!.querySelectorAll<HTMLElement>('.offers thead th[class*="col-"]').forEach(th => {
        th.style.width = '';
      });
      setTableLayoutMode(false);
      // The anti-flash boot script (table-boot.ts) mirrors the saved widths
      // into a head <style> at parse time — drop it too, or the stylesheet
      // would keep the old layout alive until the next full reload.
      document.getElementById('table-boot-widths')?.remove();
    }
    resetLayoutBtn?.addEventListener('click', handleResetLayout);

    return () => {
      handles.forEach(h => h.remove());
      document.removeEventListener('pointerup', onDocPointerUp, true);
      resetLayoutBtn?.removeEventListener('click', handleResetLayout);
      if (healRaf) cancelAnimationFrame(healRaf);
      ro?.disconnect();
    };
  }, [tableRef, storageKey, resetButtonSelector]);
}
