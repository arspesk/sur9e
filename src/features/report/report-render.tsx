'use client';

// Frontmatter-format report renderer.
//   Hero + <ReportBodyEditor> (the editable markdown body) + Attachments.
//
// Reports are frontmatter-only now; the legacy structured-renderer path
// was removed once all on-disk reports moved to the frontmatter format.
//
// The action surfaces are split between:
//   * OverflowMenu — kebab, mounted from report-page.tsx with triggerRef
//   * ReportAttachments — in-document section below the body, replaces
//     the legacy topbar Documents dropdown
// This component owns the body composition.

import { ReportBodyEditor } from './components/report-body-editor';
import { ReportContext } from './report-context';
import type { ReportR } from './report-types';
import { ReportAttachments } from './sections/report-attachments';
import { ReportHero } from './sections/report-hero';

interface ReportRenderProps {
  r: ReportR;
  filename: string;
}

export function ReportRender({ r, filename }: ReportRenderProps) {
  // Scroll-spy lives inside ReportTocRail now so /profile, /settings,
  // and /report all get active-state highlighting from the same place.

  // ReportContext makes `r` available to the SnapshotNodeView mounted by
  // ProseMirror inside ReportBodyEditor. @tiptap/react's
  // ReactNodeViewRenderer reuses the host React tree's context, so the
  // node-view picks this up without any explicit wiring.
  return (
    <ReportContext.Provider value={r}>
      <div data-testid="report-body">
        <ReportHero r={r} />
        <ReportBodyEditor
          filename={filename}
          initialBody={r.body ?? ''}
          num={r.num}
          status={r.status}
        />
        {/* Attachments — always last in the document, conditionally
            rendered only when at least one downloadable artifact exists
            on disk for this offer. */}
        <ReportAttachments r={r} />
      </div>
    </ReportContext.Provider>
  );
}
