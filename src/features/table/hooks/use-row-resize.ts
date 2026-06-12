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

    // Inject resize handles
    const ths = table.querySelectorAll<HTMLElement>('.offers thead th[class*="col-"]');
    const MIN_WIDTH = 40;
    let dragState: {
      th: HTMLElement;
      handle: HTMLElement;
      startX: number;
      startW: number;
      pointerId: number;
    } | null = null;
    let lastResizeUpAt = 0;

    function onResizeMove(e: PointerEvent) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const w = Math.max(MIN_WIDTH, dragState.startW + dx);
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
      dragState = {
        th,
        handle,
        startX: e.clientX,
        startW: th.getBoundingClientRect().width,
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
    };
  }, [tableRef, storageKey, resetButtonSelector]);
}
