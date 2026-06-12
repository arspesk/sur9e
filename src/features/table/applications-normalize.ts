// features/table/applications-normalize.ts — pure normalization shared by
// the SSR fetch in app/table/page.tsx (and app/pipeline/page.tsx) and the
// client-side useApplications hook in hooks/use-applications.ts.
//
// No "use client" — this module is consumed by both the server component
// fetch (Node) and the client query hook (browser). The shape it produces
// matches what the table/drawer/pipeline-board consume directly.
//
// Behavior is verbatim what the legacy table.html inline <script> did:
// flatten the per-entry summary into top-level cell fields, prefer the
// SHORT_FIELD_CAPS variants for display. Screened entries (no summary yet)
// are included with empty-string placeholders so the table and nav-badge
// stay in sync with the raw API count.

import type {
  ApplicationRow,
  ApplicationSummary,
  ApplicationsResponse,
  RawApplicationEntry,
} from './table-types';

export function normalizeApplications(raw: {
  entries?: RawApplicationEntry[];
  count?: number;
}): ApplicationsResponse {
  const entries = (raw.entries ?? []).map((e): ApplicationRow => {
    const s: ApplicationSummary = e.summary || {};
    return {
      ...e,
      // Read the CANONICAL summary fields so the table/kanban show the same
      // value as the report/drawer (which read the same frontmatter fields).
      // The *_short variants are kept in the summary for analytics only.
      url: s.url || undefined,
      // True posting date: tracker row first, report-frontmatter projection
      // as fallback (screen.mjs writes both for new offers).
      posted: e.posted || s.posted || undefined,
      comp: s.comp_full || s.comp_short || s.compRange || '',
      loc: s.location || '',
      archetype: s.archetype_full || s.archetype || '',
      seniority: s.seniority || '',
      work_mode: s.work_mode || '',
      comp_full: s.comp_full || s.compRange || s.comp_short || '',
      archetype_full: s.archetype_full || s.archetype || s.archetype_short || '',
      locations: s.locations || [],
      remote: s.remote || '',
      company_logo: s.company_logo || '',
      summary: s,
    };
  });
  return { entries, count: entries.length };
}
