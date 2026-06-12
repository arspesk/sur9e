'use client';

// features/report/report-page.tsx — orchestrator for /report/[filename].
//
// Mirrors public/report.html: Topbar with offer breadcrumb + share/⋮
// actions, then the report-wrap with a TOC indicator host and a #reportHost
// content surface. Data is fetched via useReport (→ /api/applications/:num)
// and rendered by feeding the renderer's HTML strings into the host element.
// All of the legacy "polish" / scroll-spy / overflow logic runs in a
// useEffect after the host's innerHTML is filled.

import { MoreHorizontal, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { IconButton } from '@/components/primitives';
import { Topbar } from '@/components/shell/topbar';
import { useReport } from '@/hooks/use-report';
import { useOverflowMenuStore } from '@/stores/overflow-menu-store';
import { useReportTocStore } from '@/stores/report-toc-store';
import { OverflowMenu } from './components/overflow-menu';
import { ReportTocRail } from './components/toc-rail';
import { registerModeSlashItems } from './mode-slash-items';
import { ReportRender } from './report-render';
import { ReportSkeleton } from './report-skeleton';
import { type ApplicationEntry, mapEntryToR, numFromFilename } from './report-types';
import { getTocItems } from './toc-items';
import { useSectionSheet } from './use-section-sheet';

interface ReportPageProps {
  filename: string;
  initialEntry?: ApplicationEntry | null;
}

export function ReportPage({ filename, initialEntry }: ReportPageProps) {
  // Tag the <body> with the legacy screen label so any
  // body[data-screen-label="Offer Report"] rules in chrome.css /
  // styles.css still match.
  //
  // data-screen-label is owned by every route — leaving the prior value
  // in place is harmless because the next mounting route overwrites it.
  // (The legacy data-variant attribute is gone: no CSS consumed it after
  // the design-mocks variant switcher was dropped on 2026-05-15.)
  useEffect(() => {
    document.body.setAttribute('data-screen-label', 'Offer Report');
  }, []);

  // Register the 7 generator modes as slash items on /report mount. The
  // registry is module-global; registerModeSlashItems is idempotent so
  // multiple /report visits won't throw on duplicate ids.
  useEffect(() => {
    registerModeSlashItems();
  }, []);

  const query = useReport(filename, { initialData: initialEntry ?? undefined });

  // Map the API entry → renderer-shaped `r` object. mapEntryToR returns
  // null when the report has no parsed body (e.g. a freshly-screened offer
  // with markdown only); we show an empty state in that case.
  const r = useMemo(() => (query.data ? mapEntryToR(query.data) : null), [query.data]);

  // Mobile section-sheet — burger button at the left of the action-bar
  // toggles #tocSheet open. For legacy reports the items come from
  // getTocItems(r) (static section ids). For frontmatter reports the
  // ReportBodyEditor pushes live h2/h3 headings into the store on each
  // keystroke, so we read from there to keep the rail in sync with what
  // the user is typing.
  const liveItems = useReportTocStore(s => s.items);
  const tocItems = useMemo(() => {
    const base = r?.format === 'frontmatter' ? liveItems : r ? getTocItems(r) : [];
    // The in-document <ReportAttachments> section lives outside the markdown
    // body, so it never shows up in the derived headings. Append a rail entry
    // for it whenever the report has at least one downloadable artifact and
    // an `attachments` entry isn't already present. Build a new array rather
    // than mutating the store's `liveItems` reference.
    // (Outreach is NOT a separate rail entry — it's appended as a `## Outreach`
    // markdown section into the report body by the contact mode, so it flows
    // through the heading scan + rail like research / interview-prep / evaluate.)
    // Attachments are downloadable PDFs only (CV, cover letter) — outreach is
    // body markdown now, not a download, so it's excluded from this check.
    const hasAttachments = Boolean(r?.cv_pdf_path || r?.cover_letter_path);
    if (hasAttachments && !base.some(it => it.id === 'attachments')) {
      return [...base, { id: 'attachments', title: 'Attachments', level: 2 }];
    }
    return base;
  }, [r, liveItems]);
  useSectionSheet(tocItems);

  // generateMetadata in /app/report/[filename]/page.tsx now handles the
  // per-offer title server-side, so the runtime document.title write is gone.
  const crumbCompany = query.data?.company || '—';
  const num = query.data?.num;
  const company = query.data?.company ?? '';

  // Reactive aria-expanded for the overflow menu trigger (fix #18).
  const overflowMenuOpen = useOverflowMenuStore(s => s.open?.num === num && s.open !== null);

  // Shared kebab trigger ref → OverflowMenu (KebabActionsMenu primitive
  // reads this to compute its viewport-clamped position).
  const kebabTriggerRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  const onOverflowClick: React.MouseEventHandler<HTMLButtonElement> = e => {
    if (num == null) return;
    e.preventDefault();
    e.stopPropagation();
    useOverflowMenuStore.getState().toggle({ anchor: e.currentTarget, num, company });
  };

  // Back to offers — moved OUT of the kebab into an inline icon next to the
  // meatball. Prefer history.back() for an internal referrer so the
  // user lands back at their scroll/selection; fall through to a clean
  // router.push otherwise. (A bfcache restore that revives a stale drawer
  // scrim is defended separately by OffersDrawer's pageshow reset.)
  const handleBack = () => {
    let internal = false;
    if (document.referrer) {
      try {
        internal = new URL(document.referrer).origin === location.origin;
      } catch {
        internal = false;
      }
    }
    if (internal) history.back();
    else router.push('/offers');
  };

  // Documents moved out of the topbar — the in-document <ReportAttachments>
  // section below the editor handles downloads now, gated on the same
  // r.cv_pdf_path / cover_letter_path / outreach_path data the legacy
  // Documents trigger used to read.

  return (
    <>
      <Topbar
        crumbs={[
          { href: '/', label: 'Workspace' },
          { href: '/offers', label: 'Offers' },
          { label: crumbCompany },
        ]}
      >
        <IconButton
          label="Back to offers"
          title="Back to offers"
          onClick={handleBack}
          icon={<Undo2 aria-hidden="true" strokeWidth={2} size={16} />}
        />
        <IconButton
          ref={kebabTriggerRef}
          label="More actions"
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={overflowMenuOpen}
          data-pill-overflow-trigger
          data-num={num ?? ''}
          onClick={onOverflowClick}
          icon={<MoreHorizontal aria-hidden="true" strokeWidth={2} size={16} />}
        />
      </Topbar>

      <div className="report-wrap">
        {/* Notion-style TOC indicator — declarative JSX now. */}
        {tocItems.length > 0 ? <ReportTocRail items={tocItems} /> : <ReportTocPlaceholder />}
        <div className="content" id="reportHost">
          <ReportRenderHost r={r} query={query} filename={filename} />
        </div>
      </div>

      {/* Burger trigger for the mobile/tablet (≤1024px) bottom-sheet TOC.
          `.section-pill` is display:none by default and only shown ≤1024px
          (chrome.css). Click handler is delegated by useSectionSheet. */}
      <aside className="section-pill" aria-label="Section navigation">
        <button
          type="button"
          className="section-pill__btn"
          data-pill-toc-trigger
          aria-haspopup="dialog"
          aria-controls="tocSheet"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span>Sections</span>
        </button>
      </aside>

      {/* Bottom-sheet TOC for ≤1024px. Populated by ReportRender on render. */}
      <div className="toc-sheet-backdrop" id="tocSheetBackdrop" />
      <aside className="toc-sheet" id="tocSheet" aria-label="Report sections">
        <div className="toc-sheet-handle" />
        <div className="toc-list" id="tocSheetList" />
      </aside>

      {/* Kebab dropdown — anchors to the IconButton in the topbar above
          via triggerRef. Downloadable artifacts live in the in-document
          <ReportAttachments> section now (see report-render.tsx). */}
      <OverflowMenu r={r} triggerRef={kebabTriggerRef} />
    </>
  );
}

function ReportTocPlaceholder() {
  // Render an empty host so route changes between reports don't leave a
  // stale rail visible. The legacy DOM had a permanent #tocIndicator
  // <nav> so any code that queried it directly would still find it.
  return <nav className="toc-indicator-host" id="tocIndicator" aria-label="Report sections" />;
}

interface ReportRenderHostProps {
  r: ReturnType<typeof mapEntryToR>;
  query: ReturnType<typeof useReport>;
  filename: string;
}

function ReportRenderHost({ r, query, filename }: ReportRenderHostProps) {
  // The route segment can be either the num (`/report/16`) or the actual
  // filename (`/report/016-otter-2026-05-23.md`). The save endpoint
  // (`/api/reports/[filename]/body`) requires the actual filename — passing
  // the num form leads to a 404 and the editor silently fails to persist.
  // Prefer the canonical filename from the API entry; fall back to the route
  // segment when the entry hasn't loaded yet (only paths before we have a
  // report to render anyway).
  const resolvedFilename = query.data?.report?.fileName ?? filename;
  const hostRef = useRef<HTMLDivElement>(null);

  // Defense in depth for an unresolvable segment (`/report/abc`, `/report/0`):
  // useReport disables its query when the filename can't yield a num, so
  // isPending would stay true FOREVER and the skeleton below would never
  // settle. The server page already 404s these (app/report/[filename]/
  // page.tsx → notFound()), but guard here too so ReportPage can't strand
  // on the skeleton if it's ever mounted with a bad filename another way.
  if (numFromFilename(filename) === null) {
    return (
      <div className="report-empty anim-enter" role="alert" data-testid="report-error">
        <p>{`"${filename}" is not a valid report URL.`}</p>
        <p>Report links look like /report/16 or /report/016-company-2026-05-23.md.</p>
        <p style={{ marginTop: 8 }}>
          <Link href="/offers" className="btn btn-secondary">
            Back to offers
          </Link>
        </p>
      </div>
    );
  }

  // Pending / error states render plain markup; the loaded report renders
  // through ReportRender (which hydrates the legacy renderer output).
  if (query.isPending) {
    // Shared composition-mirroring skeleton (features/report/report-skeleton)
    // so the page isn't a black void while useReport fetches. Important
    // after the hydration-deadline reload on duplicated tabs — without
    // visible content the user just sees an empty dark page for the fetch.
    return (
      <div ref={hostRef} role="status">
        <ReportSkeleton />
      </div>
    );
  }

  if (query.isError) {
    const msg = query.error instanceof Error ? query.error.message : 'Failed to load report';
    return (
      <div className="report-empty anim-enter" role="alert" data-testid="report-error">
        <p>{msg}</p>
        <p>Try reloading the page. If the problem persists, the report file may be corrupted.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => query.refetch()}>
            Reload report
          </button>
          <Link href="/offers" className="btn btn-secondary">
            Back to offers
          </Link>
        </div>
      </div>
    );
  }

  if (!r) {
    const num = query.data?.num;
    return (
      <div className="report-empty anim-enter" role="status" data-testid="report-empty">
        <p>{`Offer${num ? ` #${num}` : ''}: report not yet generated.`}</p>
        <p>Run an evaluation from the offer drawer to produce a report.</p>
        <p style={{ marginTop: 8 }}>
          <Link href="/offers" className="btn btn-secondary">
            Back to offers
          </Link>
        </p>
      </div>
    );
  }

  return <ReportRender r={r} filename={resolvedFilename} />;
}
