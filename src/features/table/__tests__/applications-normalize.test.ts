// Regression test: report frontmatter `url` must survive the full wiring
// reports.ts summary → normalizeApplications → ApplicationRow.url so that
// "Open job posting" is enabled when a report has a URL.

import { describe, expect, it } from 'vitest';
import { normalizeApplications } from '../applications-normalize';
import type { RawApplicationEntry } from '../table-types';

function makeEntry(overrides?: Partial<RawApplicationEntry>): RawApplicationEntry {
  return {
    num: 1,
    date: '2026-01-01',
    company: 'Acme',
    role: 'Software Engineer',
    score: '4',
    status: 'Screened',
    pdf: '',
    reportPath: null,
    notes: '',
    summary: null,
    ...overrides,
  };
}

describe('normalizeApplications – url wiring', () => {
  it('propagates summary.url onto the row when present', () => {
    const entry = makeEntry({
      summary: { url: 'https://example.com/job/42' },
    });
    const { entries } = normalizeApplications({ entries: [entry] });
    expect(entries[0].url).toBe('https://example.com/job/42');
  });

  it('leaves row.url undefined when summary has no url', () => {
    const entry = makeEntry({
      summary: { compRange: 'USD 120k–140k' },
    });
    const { entries } = normalizeApplications({ entries: [entry] });
    expect(entries[0].url).toBeUndefined();
  });

  it('leaves row.url undefined when summary is null', () => {
    const entry = makeEntry({ summary: null });
    const { entries } = normalizeApplications({ entries: [entry] });
    expect(entries[0].url).toBeUndefined();
  });
});
