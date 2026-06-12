'use client';

// features/settings/settings-page.tsx — orchestrator for /settings.
// Mirrors public/settings.html: Topbar, page-head, then a single
// .settings-content column built by <SettingsForm>. The shared TOC rail
// (Notion-style line stack on desktop ≥1025px) + bottom-sheet section
// nav (≤1024px) are provided by ReportTocRail and useSectionSheet.

import { useEffect } from 'react';
import { SaveStateText } from '@/components/save-state-text';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { Topbar } from '@/components/shell/topbar';
import type { SettingsState } from '@/hooks/use-settings';
import type { PortalsShape } from '@/lib/schemas/portals';
import type { ScheduleState } from '@/lib/server/jobs/schedule-logic';
import type { ScanQueueStatus } from '@/lib/server/scan-status';
// Type-only import from a server-only module — erased at compile time.
import type { SettingsLoadError } from '@/lib/server/settings';
import { ReportTocRail } from '../report/components/toc-rail';
import type { TocItem } from '../report/toc-items';
import { useSectionSheet } from '../report/use-section-sheet';
import { SettingsForm } from './settings-form';

const SECTIONS: TocItem[] = [
  { id: 'search', title: 'Job scanning' },
  { id: 'portals', title: 'ATS portals' },
  { id: 'jobspy', title: 'JobSpy' },
  { id: 'screening', title: 'Screening' },
  { id: 'models', title: 'AI providers & models' },
  { id: 'system', title: 'Updates & about' },
];

interface SettingsPageProps {
  initialData?: SettingsState;
  lastRunState?: ScheduleState | null;
  /** SSR-loaded portals.yml for the ATS portals section (null = no file). */
  initialPortals?: PortalsShape | null;
  queueStatus?: ScanQueueStatus | null;
  /** Set when config.yml exists but failed to parse — renders the
   *  "config unreadable" banner and pauses auto-save (SettingsForm). */
  loadError?: SettingsLoadError | null;
}

export function SettingsPage({
  initialData,
  lastRunState,
  initialPortals,
  queueStatus,
  loadError,
}: SettingsPageProps = {}) {
  // Tag the <body> with the legacy screen label so the inline CSS rule that
  // reserves right padding on .page-head still matches: `body[data-screen-
  // label="Settings"] .page-head { padding-right: 88px }`.
  //
  // No cleanup: every page that needs a body attribute writes its own on
  // mount. We intentionally do NOT restore a captured "previous" value on
  // unmount because Next.js App Router can fire the leaving page's cleanup
  // AFTER the entering page's effects (especially on back/forward through
  // the Router Cache), wiping the new page's correct attrs. Each route owns
  // the write; routes that don't need an attr simply don't set one and the
  // leftover from a previous page is harmless.
  useEffect(() => {
    document.body.setAttribute('data-screen-label', 'Settings');
  }, []);

  // Mobile section-sheet — burger button at the left of the action-bar
  // toggles #tocSheet open. List items derive from SECTIONS so the mobile
  // sheet stays in sync with the desktop TOC indicator.
  useSectionSheet(SECTIONS);

  return (
    <>
      <Topbar crumbs={[{ href: '/', label: 'Workspace' }, { label: 'Settings' }]} />

      <ReportTocRail items={SECTIONS} hostId="tocIndicator" />

      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">
            How sur9e scans, screens, and spends on this install. <SaveStateText />
          </div>
        </div>
      </div>

      {/* Mobile-only theme row (≤640px): the rail — which hosts the theme
          switcher on wider screens — is hidden under the bottom bar there,
          so Settings keeps a compact equivalent. Hidden via CSS elsewhere. */}
      <div className="settings-theme-row">
        <span className="settings-theme-row__label">Theme</span>
        <ThemeSwitch />
      </div>

      <SettingsForm
        initialData={initialData}
        lastRunState={lastRunState}
        initialPortals={initialPortals}
        queueStatus={queueStatus}
        loadError={loadError}
      />

      {/* Burger trigger + bottom-sheet TOC (mobile/tablet ≤1024px). Markup
           is required by useSectionSheet which queries #tocSheet, #tocSheetBackdrop,
           #tocSheetList from the DOM. */}
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
      <div className="toc-sheet-backdrop" id="tocSheetBackdrop" />
      <aside
        className="toc-sheet"
        id="tocSheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings sections"
      >
        <div className="toc-sheet-handle" aria-hidden="true" />
        <div className="toc-list" id="tocSheetList" />
      </aside>
    </>
  );
}
