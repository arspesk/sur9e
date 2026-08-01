'use client';

import { ChevronLeft, ChevronRight, ChevronsRight, Maximize2, MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/primitives';
import { ReportBodyEditor } from '@/features/report/components/report-body-editor';
import { type ApplicationEntry, mapEntryToR } from '@/features/report/report-types';
import { ReportAttachments } from '@/features/report/sections/report-attachments';
import { ReportHero } from '@/features/report/sections/report-hero';
import { useApplication, useApplications } from '@/hooks/use-applications';
import { useDrawerStore } from '@/stores/drawer-store';
import { KebabMenu } from './drawer/kebab-menu';

function DrawerPanel({ on }: { on: boolean }) {
  const num = useDrawerStore(s => s.num);
  const callerSiblings = useDrawerStore(s => s.siblings);
  const closeDrawer = useDrawerStore(s => s.closeDrawer);
  const openDrawer = useDrawerStore(s => s.openDrawer);
  const router = useRouter();
  const { data: entry, isLoading, isError } = useApplication(num);
  const { data: allApps } = useApplications();
  const kebabBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [kebabOpen, setKebabOpen] = useState(false);

  // Move focus INTO the dialog on open and give it back on close. The drawer
  // is a non-modal side peek (no trap — the page stays interactive), but a
  // role="dialog" that never receives focus strands keyboard/SR users on the
  // trigger row with no announcement. Runs once per drawer-open lifecycle
  // (DrawerPanel unmounts on close); switching rows keeps the panel mounted
  // so focus isn't yanked while arrowing through siblings.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Next frame — the panel mounts with `.on` unset, then slides in; waiting
    // a tick mirrors the modal pattern and avoids fighting the mount render.
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      clearTimeout(t);
      // Restore focus to the opener (table row / board card) if it's still
      // in the document — it may have been deleted while the drawer was open.
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Drawer variant + mobile bottom-bar suppression.
  // variant=v1 keeps the legacy compact head + scrollable body
  // structure (board-drawer.css owns .cd-v1-head / .cd-v1-body).
  // `cd-open` only hides the mobile bottom-bar (z-index 100, would cover the
  // drawer's foot). No scroll lock and no scrim: the drawer is a non-modal
  // side peek — the page behind stays scrollable and clickable, and clicking
  // another row switches the drawer in place via openDrawer(num).
  useEffect(() => {
    document.body.classList.add('cd-open');
    document.body.setAttribute('data-drawer-variant', 'v1');
    return () => {
      document.body.classList.remove('cd-open');
      document.body.removeAttribute('data-drawer-variant');
    };
  }, []);

  // Siblings for prev/next navigation prefer the caller-provided order
  // (table sort/filter result or kanban column) snapshotted at openDrawer()
  // time. When no caller order was supplied (e.g. drawer opened via deep
  // link or kebab menu), fall back to filtering the full list by the
  // current row's status — keeps the user inside the funnel stage they're
  // triaging instead of jumping between Discarded and Interview mid-review.
  function getSiblings() {
    const all = allApps?.entries ?? [];
    if (callerSiblings && callerSiblings.length > 0) {
      // Resolve nums → entries in the caller's order, skipping any nums
      // that no longer exist (e.g. row got deleted while drawer was open).
      const byNum = new Map(all.map(e => [e.num, e]));
      return callerSiblings.flatMap(n => {
        const e = byNum.get(n);
        return e ? [e] : [];
      });
    }
    const currentStatus = typeof entry?.status === 'string' ? entry.status.toLowerCase() : '';
    if (!currentStatus) return all;
    return all.filter(e => (e.status || '').toLowerCase() === currentStatus);
  }

  // Esc → close, Arrow keys → navigate. navDrawer / closeDrawer / openDrawer
  // are read through a ref so the effect can register once per drawer-open
  // lifecycle instead of re-attaching the keydown listener on every render
  // (the previous effect had no dep array — anything that re-rendered
  // DrawerPanel detached + re-attached the listener, including child input
  // changes).
  const handlersRef = useRef({ closeDrawer, openDrawer, num, getSiblings });
  handlersRef.current = { closeDrawer, openDrawer, num, getSiblings };
  useEffect(() => {
    // The page stays interactive while the drawer is open (non-modal side
    // peek), so global keys must not hijack typing: skip events originating
    // in inputs, selects, textareas, or contenteditable (the body editor).
    function isEditableTarget(e: KeyboardEvent): boolean {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      return t.isContentEditable || !!t.closest('input, textarea, select');
    }
    function handleKey(e: KeyboardEvent) {
      if (isEditableTarget(e)) return;
      const h = handlersRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        h.closeDrawer();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (h.num == null) return;
        const sibs = h.getSiblings();
        const idx = sibs.findIndex(x => x.num === h.num);
        const next = sibs[idx + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (next) h.openDrawer(next.num);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  function navDrawer(delta: number) {
    if (num == null) return;
    const sibs = getSiblings();
    const idx = sibs.findIndex(x => x.num === num);
    const next = sibs[idx + delta];
    if (next) openDrawer(next.num);
  }

  // Open full report — surfaced as an inline icon in the nav row. Close the
  // drawer BEFORE navigating so a bfcache restore doesn't revive a stale
  // open drawer (see OffersDrawer's pageshow reset).
  function handleOpenReport() {
    if (num == null) return;
    closeDrawer();
    router.push(`/report/${encodeURIComponent(String(num))}`);
  }

  const sibs = getSiblings();
  const idx = num != null ? sibs.findIndex(x => x.num === num) : -1;
  const counterText = sibs.length > 1 ? `${idx + 1} / ${sibs.length}` : '';
  const prevDisabled = idx <= 0;
  const nextDisabled = idx >= sibs.length - 1;

  // /api/applications/:num is typed as Record<string, unknown> at the
  // fetch boundary; mapEntryToR is the canonical adapter and validates
  // the shape internally (returns null when report.parsed is missing).
  const r = entry ? mapEntryToR(entry as unknown as ApplicationEntry) : null;
  // Report file path for the editable body (drawer == /report). The fetch
  // boundary types `entry` loosely, so read it through the same cast as `r`.
  const reportFile = entry ? ((entry as unknown as ApplicationEntry).report?.fileName ?? '') : '';

  return (
    <>
      {/* Drawer panel */}
      <div
        ref={panelRef}
        id="cdDrawer"
        className={`cd-drawer${on ? ' on' : ''}`}
        role="dialog"
        aria-label={r ? `${r.company} — ${r.role}` : 'Loading offer'}
        tabIndex={-1}
      >
        <div className="cd-v1" id="cdBody">
          {isLoading ? (
            <DrawerSkeleton />
          ) : !r ? (
            // Settled without a renderable report. Distinguish a failed fetch
            // from a fetched entry whose report body isn't parsed yet (mapEntryToR
            // returns null) — neither should sit on the skeleton forever.
            isError ? (
              <div className="cd-error" style={{ padding: '24px', color: 'var(--score-low)' }}>
                Failed to load offer.
              </div>
            ) : (
              <div className="cd-empty" role="status" style={{ padding: '24px' }}>
                {`Offer${num != null ? ` #${num}` : ''}: report not yet generated.`}
              </div>
            )
          ) : (
            <>
              <DrawerNavRow
                counterText={counterText}
                prevDisabled={prevDisabled}
                nextDisabled={nextDisabled}
                onPrev={() => navDrawer(-1)}
                onNext={() => navDrawer(1)}
                onKebab={e => {
                  e.stopPropagation();
                  setKebabOpen(o => !o);
                }}
                kebabRef={kebabBtnRef}
                onOpenReport={handleOpenReport}
                onClose={closeDrawer}
              />
              <div className="cd-v1-body">
                <ReportHero r={r} />
                {/* The drawer renders the SAME editable full report body as
                    /report — Next Steps callout, TL;DR, Role summary, Gaps,
                    generator-appended sections — with the same whole-body
                    save. The Maximize icon in the nav row opens the full
                    page. */}
                <ReportBodyEditor
                  filename={reportFile}
                  initialBody={r.body ?? ''}
                  num={r.num}
                  status={r.status}
                />
                {/* Attachments — same in-document section as /report
                    (report-render.tsx); hidden when no downloadable
                    artifacts exist for this offer. */}
                <ReportAttachments r={r} />
              </div>
            </>
          )}
        </div>
        {kebabOpen && r ? (
          <KebabMenu r={r} triggerRef={kebabBtnRef} onClose={() => setKebabOpen(false)} />
        ) : null}
      </div>
    </>
  );
}

// Drawer nav row — thin top bar with prev/counter/next on the left and
// kebab on the right. The actual offer header (logo, company, role,
// score, etc.) is rendered by <ReportHero> in the body, matching the
// /report page layout 1:1 just sized to the drawer width.
interface DrawerNavRowProps {
  counterText: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onKebab: (e: React.MouseEvent<HTMLButtonElement>) => void;
  kebabRef?: React.RefObject<HTMLButtonElement | null>;
  onOpenReport: () => void;
  onClose: () => void;
}

function DrawerNavRow({
  counterText,
  prevDisabled,
  nextDisabled,
  onPrev,
  onNext,
  onKebab,
  kebabRef,
  onOpenReport,
  onClose,
}: DrawerNavRowProps) {
  return (
    <div className="cd-v1-navrow">
      {/* Left: close (chevrons-right — "push the drawer shut to the right",
          matching its slide-out exit) · open-full-report · divider · prev/next
          nav pill. Sequence: close · expand │ nav. */}
      <div className="cd-nav-actions">
        <IconButton
          size="sm"
          label="Close"
          title="Close"
          onClick={onClose}
          icon={<ChevronsRight aria-hidden="true" strokeWidth={2} size={16} />}
        />
        <IconButton
          size="sm"
          label="Open full report"
          title="Open full report"
          onClick={onOpenReport}
          icon={<Maximize2 aria-hidden="true" strokeWidth={2} size={16} />}
        />
        <span className="cd-nav-divider" aria-hidden="true" />
        <div className="cd-nav-group">
          <IconButton
            size="sm"
            label="Previous offer"
            title="Previous offer (←)"
            disabled={prevDisabled}
            onClick={onPrev}
            icon={<ChevronLeft aria-hidden="true" strokeWidth={2} size={16} />}
          />
          <span className="cd-nav-counter">{counterText}</span>
          <IconButton
            size="sm"
            label="Next offer"
            title="Next offer (→)"
            disabled={nextDisabled}
            onClick={onNext}
            icon={<ChevronRight aria-hidden="true" strokeWidth={2} size={16} />}
          />
        </div>
      </div>
      {/* Right: ⋯ meatball. */}
      <div className="cd-nav-actions">
        <IconButton
          ref={kebabRef}
          size="sm"
          label="Drawer actions"
          title="More actions"
          aria-haspopup="menu"
          onClick={onKebab}
          icon={<MoreHorizontal aria-hidden="true" strokeWidth={2} size={16} />}
        />
      </div>
    </div>
  );
}

// Drawer skeleton — shown while the per-row /api/applications/[num] fetch
// resolves. Mirrors the loaded drawer 1:1 (nav-row chrome → ReportHero →
// body placeholder) by reusing the same layout containers, so the placeholder
// occupies the real positions and content swaps in without a reflow.
function DrawerSkeleton() {
  // A pill-shaped placeholder for the hero-eyebrow row (status + enum pills).
  const pill = (width: number) => (
    <span
      className="skeleton-line"
      style={{
        display: 'inline-block',
        height: 24,
        width,
        borderRadius: 'var(--radius-pill)',
        margin: 0,
      }}
    />
  );
  return (
    <>
      {/* Nav-row chrome placeholder (prev/counter/next · kebab) */}
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
        }}
      >
        <span
          className="skeleton-line"
          style={{ width: 96, height: 16, borderRadius: 6, margin: 0 }}
        />
        <span
          className="skeleton-line"
          style={{ width: 20, height: 16, borderRadius: 6, margin: 0 }}
        />
      </div>
      <div className="cd-v1-body" role="status" aria-busy="true" aria-label="Loading offer">
        {/* Hero: pills row · avatar + name/role · score block */}
        <div className="hero" data-skeleton="1">
          <div>
            <div className="hero-eyebrow">
              {pill(78)}
              {pill(110)}
              {pill(98)}
              {pill(86)}
            </div>
            <div className="hero-id-row">
              <span
                className="skeleton-line"
                style={{ width: 40, height: 40, borderRadius: 10, margin: 0, flex: '0 0 auto' }}
              />
              <div style={{ flex: 1 }}>
                <span className="skeleton-line w-60 skeleton-line--h-30" />
                <span className="skeleton-line w-40 skeleton-line--h-18" style={{ marginTop: 6 }} />
              </div>
            </div>
            <div className="hero-meta-strip">
              <span className="skeleton-line w-75 skeleton-line--h-14" />
            </div>
          </div>
          <div className="hero-score">
            <span
              className="skeleton-line"
              style={{ width: 64, height: 44, borderRadius: 8, margin: 0 }}
            />
            <span
              className="skeleton-line"
              style={{ width: 80, height: 10, borderRadius: 4, marginTop: 10 }}
            />
            <span
              className="skeleton-line"
              style={{ width: 96, height: 22, borderRadius: 'var(--radius-pill)', marginTop: 10 }}
            />
          </div>
        </div>
        {/* TL;DR section: heading + verdict lines + a compact Axis|Score|Read
            table — mirrors the real markdown body, tightly spaced (no empty band). */}
        <div style={{ marginTop: 10 }}>
          <span className="skeleton-line w-40 skeleton-line--h-18" />
          <span className="skeleton-line w-90 skeleton-line--h-14" style={{ marginTop: 10 }} />
          <span className="skeleton-line w-75 skeleton-line--h-14" style={{ marginTop: 6 }} />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <span
                key={i}
                className="skeleton-line"
                style={{ height: 14, borderRadius: 4, margin: 0 }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// Matches the .cd-drawer transform transition in board-drawer.css (280ms) —
// keep them in sync so the panel unmounts only after the slide-out finishes.
const DRAWER_EXIT_MS = 300;

export function OffersDrawer() {
  const open = useDrawerStore(s => s.open);
  // `mounted` keeps the panel in the tree through its exit animation; `shown`
  // drives the `.on` class (slide in/out). On open we mount, then flip `shown`
  // on the next frame so the transform animates from off-screen. On close we
  // drop `shown` to play the slide-out, then unmount once it completes — so the
  // drawer collapses to the right instead of vanishing instantly.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), DRAWER_EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  // bfcache safety: when /offers is restored from the back/forward
  // cache while the drawer was open at navigation time, a stale open drawer
  // comes back frozen — the "can't open an offer after Back to offers"
  // report. Force the drawer shut on a persisted pageshow so it tears down.
  // (Next dev often disables bfcache, so this only bites in prod/preview;
  // it's a harmless no-op otherwise.)
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) useDrawerStore.getState().closeDrawer();
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (!mounted) return null;
  return <DrawerPanel on={shown} />;
}
