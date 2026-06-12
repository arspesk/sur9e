/**
 * features/report/components/toc-rail.tsx
 *
 * JSX port of renderTocIndicator (17 lines) + renderTocPopover (16 lines)
 * from report-renderer.ts. A single component renders both pieces inside
 * the same .toc-indicator-host nav (matches the legacy concat-and-write
 * pattern that was previously split across report-render.tsx + report-
 * toc.tsx).
 *
 * Hover-to-open / click-to-scroll / Escape-to-close are owned here too —
 * the use-toc-hover hook becomes unnecessary once the consumers are
 * swapped over (it still ships for now as a backstop).
 *
 * The rail also owns the scroll-spy effect that toggles `.active` on
 * its own stripes + popover items. Mobile-sheet active-state is still
 * driven by use-section-sheet.ts.
 */

'use client';

import { useEffect, useRef } from 'react';
import type { TocItem } from '../toc-items';

interface ReportTocRailProps {
  items: TocItem[];
  hostId?: string;
}

const SCROLL_OFFSET = 110;

export function ReportTocRail({ items, hostId = 'tocIndicator' }: ReportTocRailProps) {
  const hostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const indicator = host.querySelector('[data-toc-indicator]');
    const popover = host.querySelector<HTMLElement>('[data-toc-popover]');
    if (!indicator || !popover) return;

    let hoverGrace: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      indicator.classList.add('toc-indicator--hidden');
      popover.removeAttribute('hidden');
    };
    const close = () => {
      indicator.classList.remove('toc-indicator--hidden');
      popover.setAttribute('hidden', '');
    };
    const onEnter = () => {
      if (hoverGrace) clearTimeout(hoverGrace);
      hoverGrace = null;
      open();
    };
    const onLeave = () => {
      if (hoverGrace) clearTimeout(hoverGrace);
      hoverGrace = setTimeout(close, 150);
    };
    const onHostClick = (e: Event) => {
      if ((e.target as Element).closest('[data-toc-indicator]')) open();
    };
    const onDocClick = (e: Event) => {
      if (host.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    host.addEventListener('mouseenter', onEnter);
    host.addEventListener('mouseleave', onLeave);
    host.addEventListener('click', onHostClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('mouseenter', onEnter);
      host.removeEventListener('mouseleave', onLeave);
      host.removeEventListener('click', onHostClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      if (hoverGrace) clearTimeout(hoverGrace);
    };
  }, []);

  // Scroll-spy. Observes each item's target element (by id, then by
  // slugified textContent inside .report-body for editor headings) and
  // toggles `.active` on the matching stripes + popover items. Lives
  // inside the rail so /profile, /settings, and /report all get
  // active-state highlighting from a single source. Uses a deferred
  // attach pattern because consumers (profile-form, settings-form,
  // ReportBodyEditor) hydrate asynchronously and the sections may not
  // exist when this effect first runs.
  // Re-runs when the items list changes (e.g. the user types a new
  // heading into the editor body — items prop updates from the store).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!items.length) return;

    const slug = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    const resolveTarget = (id: string): HTMLElement | null => {
      const direct = document.getElementById(id);
      if (direct && document.body.contains(direct)) return direct;
      // h1 included so the rail's level-1 entries (typing `# Foo` in the
      // editor) can scroll to their target. Falls through if the heading
      // ProseMirror re-rendered with a new DOM node (stale `direct`
      // reference would have been caught by the contains() check above).
      const editorHeadings = document.querySelectorAll<HTMLElement>(
        '.report-body h1, .report-body h2, .report-body h3',
      );
      for (const h of Array.from(editorHeadings)) {
        if (slug(h.textContent ?? '') === id) return h;
      }
      return null;
    };

    let elToId = new Map<Element, string>();
    let observed = new Set<string>();
    const observer = new IntersectionObserver(
      entries => {
        const top = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!top) return;
        const id = elToId.get(top.target);
        if (!id) return;
        host
          .querySelectorAll<HTMLElement>('[data-section-id]')
          .forEach(el => el.classList.toggle('active', el.dataset.sectionId === id));
      },
      { rootMargin: '-110px 0px -60% 0px', threshold: 0 },
    );

    const rebind = () => {
      // Drop observations whose targets fell out of the DOM (ProseMirror
      // re-rendered the heading element). Without this the observer kept
      // tracking detached nodes and never fired for the live ones, which
      // is what made scroll-spy "freeze" after inserting a new block.
      let needsReset = false;
      for (const [el, id] of elToId.entries()) {
        if (!document.body.contains(el)) {
          observed.delete(id);
          needsReset = true;
        }
      }
      if (needsReset) {
        observer.disconnect();
        // Re-observe everything that's still live so the observer's
        // internal element set matches the live DOM.
        const fresh = new Map<Element, string>();
        for (const [el, id] of elToId.entries()) {
          if (document.body.contains(el)) {
            fresh.set(el, id);
            observer.observe(el);
          }
        }
        elToId = fresh;
      }
      // Attach any items that don't yet have a target observed.
      for (const it of items) {
        if (observed.has(it.id)) continue;
        const target = resolveTarget(it.id);
        if (target) {
          elToId.set(target, it.id);
          observer.observe(target);
          observed.add(it.id);
        }
      }
    };

    // Initial attach loop — 100ms × 30 = 3s window covers TipTap's async
    // dynamic-import mount on first paint.
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      rebind();
      if (observed.size === items.length) return;
      if (retries >= 30) return;
      retries += 1;
      retryTimer = setTimeout(poll, 100);
    };
    poll();

    // Heartbeat re-bind — runs every 800ms regardless of items-prop
    // change, so editor blocks that re-render (snapshot widget,
    // runningMode insert, even an unrelated keystroke that bumps the
    // heading's parent) don't strand the observer on detached nodes.
    const heartbeat = setInterval(rebind, 800);

    // MutationObserver on .report-body — fires immediately when the
    // editor swaps a heading element (faster than the heartbeat). Scoped
    // to childList/subtree changes; attribute changes (typing inside a
    // heading) don't trigger re-bind because the element identity stays
    // the same.
    const host2 = document.querySelector('.report-body');
    const mo = host2 ? new MutationObserver(() => rebind()) : null;
    if (host2 && mo) mo.observe(host2, { childList: true, subtree: true });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(heartbeat);
      mo?.disconnect();
      observer.disconnect();
    };
  }, [items]);

  const onSectionClick = (id: string) => {
    // Resolve the target: try getElementById first (legacy sections +
    // the hardcoded #tldr pin), then fall back to scanning the
    // editor body for a heading whose slugified textContent matches.
    // The fallback path covers frontmatter reports where TipTap renders
    // h2/h3 without id attrs (the editor's ProseMirror schema strips
    // any id we try to stamp, so a className/data-attr or text scan is
    // the only reliable handle).
    let target: HTMLElement | null = document.getElementById(id);
    if (!target) {
      const slug = (t: string) =>
        t
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      const editorHeadings = document.querySelectorAll<HTMLElement>(
        '.report-body h2, .report-body h3',
      );
      for (const h of Array.from(editorHeadings)) {
        if (slug(h.textContent ?? '') === id) {
          target = h;
          break;
        }
      }
    }
    if (!target) return;
    if (target.tagName === 'DETAILS' && !(target as HTMLDetailsElement).open) {
      (target as HTMLDetailsElement).open = true;
    }
    requestAnimationFrame(() => {
      const top = target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  };

  return (
    <nav ref={hostRef} className="toc-indicator-host" id={hostId} aria-label="Report sections">
      <div className="toc-indicator" data-toc-indicator>
        {items.map(it => (
          <button
            key={it.id}
            type="button"
            className="toc-line"
            data-section-id={it.id}
            data-level={it.level ?? 2}
            aria-label={`Jump to ${it.title}`}
            title={it.title}
            onClick={() => onSectionClick(it.id)}
          />
        ))}
      </div>
      <div className="toc-popover" data-toc-popover hidden role="menu" aria-label="Sections">
        {items.map(it => (
          <button
            key={it.id}
            type="button"
            className="toc-popover__item"
            data-section-id={it.id}
            data-level={it.level ?? 2}
            role="menuitem"
            onClick={() => onSectionClick(it.id)}
          >
            {it.title}
          </button>
        ))}
      </div>
    </nav>
  );
}
