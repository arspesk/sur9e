/**
 * features/report/toc-items.ts
 *
 * Pure helper extracted from the (deleted in Phase 3) report-renderer.ts.
 * Derives the TOC item list from a ReportR. No DOM access — safe on the
 * server and inside vitest.
 */

import { useReportTocStore } from '@/stores/report-toc-store';
import type { ReportR } from './report-types';

export interface TocItem {
  id: string;
  title: string;
  /** Heading level (2 = h2, 3 = h3). Drives indent in the rail. */
  level?: number;
}

/**
 * Push a fresh list of headings (typically derived from the frontmatter
 * report body's h2/h3 markdown) into the live TOC store. The report page
 * subscribes to this store when `r.format === 'frontmatter'` so the
 * sidebar/mobile sheet stay in sync with the editor.
 *
 * Shallow-equal-skip: if the new list matches the current one by length
 * + per-index id/title, we don't `set` — which avoids triggering
 * useSectionSheet's effect (which tears down + re-attaches its
 * IntersectionObserver). Critical because this fires on every keystroke.
 */
export function setReportHeadings(items: TocItem[]): void {
  const store = useReportTocStore.getState();
  const cur = store.items;
  if (cur.length === items.length) {
    let same = true;
    for (let i = 0; i < items.length; i++) {
      if (
        cur[i].id !== items[i].id ||
        cur[i].title !== items[i].title ||
        cur[i].level !== items[i].level
      ) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  store.setItems(items);
}

export function getTocItems(r: ReportR): TocItem[] {
  const isEvaluated = r.state === 'evaluated';
  const evaluatedItems: TocItem[] = [
    { id: 'tldr', title: 'TL;DR' },
    { id: 'read', title: 'Full evaluation' },
    { id: 'tailor', title: 'Tailoring' },
    { id: 'prep', title: 'STAR stories' },
    { id: 'negotiate', title: 'Compensation' },
  ];
  if (r.has_company_research) {
    evaluatedItems.push({ id: 'company-research', title: 'Company research' });
  }
  if (r.has_interview_process) {
    evaluatedItems.push({ id: 'interview-process', title: 'Interview prep' });
  }
  if (r.outreach) {
    evaluatedItems.push({ id: 'outreach', title: 'Outreach' });
  }
  return isEvaluated
    ? evaluatedItems
    : [
        { id: 'tldr', title: 'TL;DR' },
        { id: 'read', title: 'Full evaluation' },
      ];
}
