'use client';

/**
 * Mobile bottom-sheet TOC. Mount once via `useSectionSheet()` from
 * report-page.tsx (and any other surface that needs the same sheet —
 * Profile + Settings reuse this).
 *
 * DOM contract (must exist in the tree when this hook mounts):
 *   - <aside id="tocSheet" class="toc-sheet"> with <div id="tocSheetList">
 *   - <div id="tocSheetBackdrop" class="toc-sheet-backdrop">
 *   - One or more elements with [data-pill-toc-trigger]
 *
 * Behaviour:
 *   - Click on [data-pill-toc-trigger]    → toggles .open on sheet+backdrop
 *   - Click on #tocSheetBackdrop          → close
 *   - Click on #tocSheetList [data-section-id] → smooth-scroll + close
 *   - Esc keydown while open              → close
 *   - Pointer-down on top 40px of panel + drag > 30% height → close
 *   - Scroll spy: highlight item whose section is highest in viewport
 */

import { useEffect } from 'react';

export interface SectionSheetItem {
  id: string;
  title: string;
}

export function useSectionSheet(items: readonly SectionSheetItem[]): void {
  useEffect(() => {
    const sheet = document.getElementById('tocSheet');
    const backdrop = document.getElementById('tocSheetBackdrop');
    const list = document.getElementById('tocSheetList');
    if (!sheet || !backdrop || !list) return;

    function open() {
      sheet?.classList.add('open');
      backdrop?.classList.add('open');
      for (const b of document.querySelectorAll<HTMLElement>('[data-pill-toc-trigger]')) {
        b.setAttribute('aria-expanded', 'true');
      }
    }

    function close() {
      sheet?.classList.remove('open');
      backdrop?.classList.remove('open');
      for (const b of document.querySelectorAll<HTMLElement>('[data-pill-toc-trigger]')) {
        b.setAttribute('aria-expanded', 'false');
      }
    }

    // ── Populate the list with items ──
    while (list.firstChild) list.removeChild(list.firstChild);
    items.forEach((it, i) => {
      if (!it.id) return;
      const a = document.createElement('a');
      a.href = `#${it.id}`;
      a.className = i === 0 ? 'toc-item active' : 'toc-item';
      a.setAttribute('data-section-id', String(it.id));
      const letter = document.createElement('span');
      letter.className = 'letter';
      letter.textContent = '·';
      a.appendChild(letter);
      const label = document.createElement('span');
      label.textContent = String(it.title || '');
      a.appendChild(label);
      list.appendChild(a);
    });

    // ── Click delegation ──
    function onClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest('[data-pill-toc-trigger]')) {
        if (sheet?.classList.contains('open')) close();
        else open();
        return;
      }
      if (t.closest('#tocSheetBackdrop')) {
        close();
        return;
      }
      const item = t.closest<HTMLElement>('#tocSheetList [data-section-id]');
      if (item) {
        e.preventDefault();
        const id = item.dataset.sectionId;
        const target = id ? document.getElementById(id) : null;
        if (target) {
          if (target.tagName === 'DETAILS') {
            const det = target as HTMLDetailsElement;
            if (!det.open) det.open = true;
          }
          requestAnimationFrame(() => {
            const top = target.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top, behavior: 'smooth' });
          });
        }
        close();
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && sheet?.classList.contains('open')) close();
    }

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);

    // ── Swipe-down-to-close (only on top 40px of panel) ──
    let startY: number | null = null;
    let currentY = 0;
    let dragging = false;

    function onPointerDown(e: PointerEvent) {
      const rect = sheet?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientY - rect.top > 40) return;
      startY = e.clientY;
      dragging = true;
      sheet?.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging || startY === null) return;
      currentY = Math.max(0, e.clientY - startY);
      if (sheet) sheet.style.transform = `translateY(${currentY}px)`;
    }

    function onPointerUp(e: PointerEvent) {
      if (!dragging || !sheet) return;
      dragging = false;
      const rect = sheet.getBoundingClientRect();
      const threshold = rect.height * 0.3;
      if (currentY > threshold) {
        sheet.style.transform = `translateY(${rect.height}px)`;
        setTimeout(() => {
          close();
          if (sheet) sheet.style.transform = '';
        }, 220);
      } else {
        sheet.style.transform = '';
      }
      startY = null;
      currentY = 0;
      if (sheet.hasPointerCapture(e.pointerId)) sheet.releasePointerCapture(e.pointerId);
    }

    function onPointerCancel() {
      if (dragging && sheet) {
        sheet.style.transform = '';
        dragging = false;
        startY = null;
        currentY = 0;
      }
    }

    sheet.addEventListener('pointerdown', onPointerDown);
    sheet.addEventListener('pointermove', onPointerMove);
    sheet.addEventListener('pointerup', onPointerUp);
    sheet.addEventListener('pointercancel', onPointerCancel);

    // ── Scroll-spy via IntersectionObserver ──
    const observer = new IntersectionObserver(
      entries => {
        const top = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!top) return;
        const id = top.target.id;
        for (const a of list.querySelectorAll<HTMLAnchorElement>('.toc-item')) {
          a.classList.toggle('active', a.dataset.sectionId === id);
        }
      },
      { rootMargin: '-110px 0px -60% 0px' },
    );
    for (const it of items) {
      const el = it.id ? document.getElementById(it.id) : null;
      if (el) observer.observe(el);
    }

    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      sheet?.removeEventListener('pointerdown', onPointerDown);
      sheet?.removeEventListener('pointermove', onPointerMove);
      sheet?.removeEventListener('pointerup', onPointerUp);
      sheet?.removeEventListener('pointercancel', onPointerCancel);
      observer.disconnect();
    };
  }, [items]);
}
