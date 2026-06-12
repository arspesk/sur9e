'use client';

// features/profile/profile-page.tsx — orchestrator for /profile.
// Mirrors public/profile.html: Topbar, page-head, then a single
// .profile-content column built by <ProfileForm>. The shared TOC rail
// (Notion-style line stack on desktop ≥1025px) + bottom-sheet section
// nav (≤1024px) are provided by ReportTocRail and useSectionSheet.

import { useEffect } from 'react';
import { SaveStateText } from '@/components/save-state-text';
import { Topbar } from '@/components/shell/topbar';
import type { ProfileState } from '@/hooks/use-profile';
// Type-only import from a server-only module — erased at compile time, so
// the 'server-only' guard never executes in the client bundle (same pattern
// as settings-page.tsx importing ScheduleState from lib/server).
import type { ProfileLoadError } from '@/lib/server/profile';
import { ReportTocRail } from '../report/components/toc-rail';
import type { TocItem } from '../report/toc-items';
import { useSectionSheet } from '../report/use-section-sheet';
import { ProfileForm } from './profile-form';

const SECTIONS: TocItem[] = [
  { id: 'identity', title: 'Identity' },
  { id: 'targets', title: 'Target roles' },
  { id: 'pitch', title: 'Pitch' },
  { id: 'comp', title: 'Compensation' },
  { id: 'location', title: 'Location' },
  { id: 'apply', title: 'Application questions' },
  { id: 'cv', title: 'CV' },
  { id: 'narrative', title: 'Narrative' },
  { id: 'digest', title: 'Article digest' },
];

interface ProfilePageProps {
  initialData?: ProfileState;
  /** Set when profile.yml exists but failed to parse — renders the
   *  "profile unreadable" banner and pauses auto-save (ProfileForm). */
  loadError?: ProfileLoadError | null;
}

export function ProfilePage({ initialData, loadError }: ProfilePageProps = {}) {
  // Tag the <body> with the legacy screen label so the inline CSS rule that
  // reserves right padding on .page-head still matches: `body[data-screen-
  // label="Profile"] .page-head { padding-right: 88px }`.
  //
  // No cleanup: every page that needs a body attribute writes its own on
  // mount. We intentionally do NOT restore a captured "previous" value on
  // unmount because Next.js App Router can fire the leaving page's cleanup
  // AFTER the entering page's effects (especially on back/forward through
  // the Router Cache), wiping the new page's correct attrs. Each route owns
  // the write; routes that don't need an attr simply don't set one and the
  // leftover from a previous page is harmless.
  useEffect(() => {
    document.body.setAttribute('data-screen-label', 'Profile');
  }, []);

  // Mobile section-sheet — burger button at the left of the action-bar
  // toggles #tocSheet open. List items derive from SECTIONS so the mobile
  // sheet stays in sync with the desktop TOC indicator.
  useSectionSheet(SECTIONS);

  return (
    <>
      <Topbar crumbs={[{ href: '/', label: 'Workspace' }, { label: 'Profile' }]} />

      {/* S-M2: shared Notion-style TOC rail. Hidden ≤1024px (CSS) — at narrow
            widths the in-flow .profile-nav horizontal scroller takes over. */}
      <ReportTocRail items={SECTIONS} hostId="tocIndicator" />

      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <div className="sub">
            Who you are and what you&rsquo;re hunting for — powers every evaluation, CV, and cover
            letter. <SaveStateText />
          </div>
        </div>
      </div>

      <ProfileForm initialData={initialData} loadError={loadError} />

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
        aria-label="Profile sections"
      >
        <div className="toc-sheet-handle" aria-hidden="true" />
        <div className="toc-list" id="tocSheetList" />
      </aside>
    </>
  );
}
