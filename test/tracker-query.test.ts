// test/tracker-query.test.ts
//
// queryApplications(rootPath, filters) — the server-side filter + compact
// projection + pagination layer behind GET /api/applications?fields=compact
// and the MCP get_tracker tool (issues #104 / #107). Fixtures are built in a
// throwaway mkdtemp root; the real data/ directory is never touched.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryApplications } from '@/lib/server/tracker-query';

const TRACKER_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|`;

function makeRoot(trackerRows: string[], reports: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-tracker-query-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    `${TRACKER_HEADER}\n${trackerRows.join('\n')}\n`,
  );
  for (const [fileName, content] of Object.entries(reports)) {
    writeFileSync(join(root, 'artifacts/reports', fileName), content);
  }
  return root;
}

function report(frontmatterLines: string[]): string {
  return ['---', ...frontmatterLines, '---', '', '# Report body', ''].join('\n');
}

/**
 * Standard 4-row fixture:
 *   1  Acme    Platform Engineer  4.2/5  Evaluated  Barcelona / Hybrid / Senior + url
 *   2  Globex  Sales Engineer     3.1/5  Applied    loc_short-only summary + posted col
 *   3  Initech Backend Engineer   N/A    Screened   no report (null summary)
 *   4  Hooli   Platform Engineer  4.8/5  Skip       posted via report frontmatter
 */
function standardRoot(): string {
  return makeRoot(
    [
      '| 1 | 2026-07-01 | Acme | Platform Engineer | 4.2/5 | Evaluated | ✅ | [1](artifacts/reports/001-acme.md) | - |  |',
      '| 2 | 2026-07-05 | Globex | Sales Engineer | 3.1/5 | Applied | ✅ | [2](artifacts/reports/002-globex.md) | - | 2026-07-02 |',
      '| 3 | 2026-07-10 | Initech | Backend Engineer | N/A | Screened | ❌ | - | - |  |',
      '| 4 | 2026-08-01 | Hooli | Platform Engineer | 4.8/5 | Skip | ❌ | [4](artifacts/reports/004-hooli.md) | - |  |',
    ],
    {
      '001-acme.md': report([
        'num: 1',
        'company: Acme',
        'role: Platform Engineer',
        "date: '2026-07-01'",
        'state: evaluated',
        'score: 4.2',
        'url: https://jobs.acme.dev/platform',
        'location: Barcelona, Spain',
        'work_mode: Hybrid',
        'seniority: Senior',
      ]),
      '002-globex.md': report([
        'num: 2',
        'company: Globex',
        'role: Sales Engineer',
        "date: '2026-07-05'",
        'state: evaluated',
        'score: 3.1',
        'loc_short: Remote EU',
        'work_mode: Remote',
      ]),
      '004-hooli.md': report([
        'num: 4',
        'company: Hooli',
        'role: Platform Engineer',
        "date: '2026-08-01'",
        'state: evaluated',
        'score: 4.8',
        'location: Palo Alto, US',
        'work_mode: On-site',
        "posted: '2026-07-28'",
      ]),
    },
  );
}

describe('queryApplications — compact projection', () => {
  it('returns all rows compactly with totals when no filters are given', () => {
    const result = queryApplications(standardRoot(), {});
    expect(result.total).toBe(4);
    expect(result.count).toBe(4);
    expect(result.next_offset).toBeNull();
    expect(result.entries).toHaveLength(4);
    for (const entry of result.entries) {
      expect(entry).not.toHaveProperty('summary');
      expect(entry).not.toHaveProperty('pdf');
      expect(entry).not.toHaveProperty('reportPath');
      expect(entry).not.toHaveProperty('notes');
    }
  });

  it('projects url/location/work_mode/seniority from the report summary', () => {
    const result = queryApplications(standardRoot(), {});
    const acme = result.entries.find(e => e.num === 1);
    expect(acme).toMatchObject({
      num: 1,
      date: '2026-07-01',
      company: 'Acme',
      role: 'Platform Engineer',
      score: '4.2/5',
      status: 'evaluated',
      url: 'https://jobs.acme.dev/platform',
      location: 'Barcelona, Spain',
      work_mode: 'Hybrid',
      seniority: 'Senior',
    });
  });

  it('omits absent keys entirely on a null-summary row', () => {
    const result = queryApplications(standardRoot(), {});
    const initech = result.entries.find(e => e.num === 3);
    expect(initech).toEqual({
      num: 3,
      date: '2026-07-10',
      company: 'Initech',
      role: 'Backend Engineer',
      score: 'N/A',
      status: 'screened',
    });
  });

  it('falls back to summary.loc when summary.location is empty', () => {
    const result = queryApplications(standardRoot(), {});
    const globex = result.entries.find(e => e.num === 2);
    expect(globex?.location).toBe('Remote EU');
  });

  it('takes posted from the row column first, then the report summary', () => {
    const result = queryApplications(standardRoot(), {});
    expect(result.entries.find(e => e.num === 2)?.posted).toBe('2026-07-02');
    expect(result.entries.find(e => e.num === 4)?.posted).toBe('2026-07-28');
    expect(result.entries.find(e => e.num === 1)).not.toHaveProperty('posted');
  });

  it('canonicalizes legacy Skip status to discarded in the projection', () => {
    const result = queryApplications(standardRoot(), {});
    expect(result.entries.find(e => e.num === 4)?.status).toBe('discarded');
  });
});

describe('queryApplications — filters', () => {
  it('filters by canonical status, matching legacy Skip rows as discarded', () => {
    const root = standardRoot();
    const applied = queryApplications(root, { status: ['applied'] });
    expect(applied.entries.map(e => e.num)).toEqual([2]);
    expect(applied.total).toBe(1);
    const discarded = queryApplications(root, { status: ['discarded'] });
    expect(discarded.entries.map(e => e.num)).toEqual([4]);
    const multi = queryApplications(root, { status: ['evaluated', 'screened'] });
    expect(multi.entries.map(e => e.num)).toEqual([1, 3]);
  });

  it('treats an empty status list as no status filter', () => {
    expect(queryApplications(standardRoot(), { status: [] }).total).toBe(4);
  });

  it('filters by location as a case-insensitive substring with loc fallback', () => {
    const root = standardRoot();
    expect(queryApplications(root, { location: 'barcelona' }).entries.map(e => e.num)).toEqual([1]);
    expect(queryApplications(root, { location: 'remote' }).entries.map(e => e.num)).toEqual([2]);
    // Rows with no location at all never match a location filter.
    expect(queryApplications(root, { location: '' }).total).toBe(4);
  });

  it('filters by work_mode as case-insensitive equality, not substring', () => {
    const root = standardRoot();
    expect(queryApplications(root, { workMode: 'hybrid' }).entries.map(e => e.num)).toEqual([1]);
    expect(queryApplications(root, { workMode: 'Hyb' }).total).toBe(0);
    expect(queryApplications(root, { workMode: 'ON-SITE' }).entries.map(e => e.num)).toEqual([4]);
  });

  it('filters company and role by case-insensitive substring', () => {
    const root = standardRoot();
    expect(queryApplications(root, { company: 'glo' }).entries.map(e => e.num)).toEqual([2]);
    expect(queryApplications(root, { role: 'platform' }).entries.map(e => e.num)).toEqual([1, 4]);
  });

  it('min_score keeps numeric scores >= the bound and drops non-numeric rows', () => {
    const root = standardRoot();
    const result = queryApplications(root, { minScore: 4 });
    // Row 3 (score N/A) must be excluded, not treated as 0 or kept.
    expect(result.entries.map(e => e.num)).toEqual([1, 4]);
    expect(queryApplications(root, { minScore: 4.5 }).entries.map(e => e.num)).toEqual([4]);
  });

  it('filters by since/until on the tracker date', () => {
    const root = standardRoot();
    expect(queryApplications(root, { since: '2026-07-05' }).entries.map(e => e.num)).toEqual([
      2, 3, 4,
    ]);
    expect(queryApplications(root, { until: '2026-07-05' }).entries.map(e => e.num)).toEqual([
      1, 2,
    ]);
    expect(
      queryApplications(root, { since: '2026-07-02', until: '2026-07-31' }).entries.map(e => e.num),
    ).toEqual([2, 3]);
  });

  it('combines filters conjunctively', () => {
    const root = standardRoot();
    const result = queryApplications(root, { role: 'engineer', minScore: 4, workMode: 'on-site' });
    expect(result.entries.map(e => e.num)).toEqual([4]);
    expect(result.total).toBe(1);
  });
});

describe('queryApplications — pagination', () => {
  it('paginates with limit/offset and reports next_offset', () => {
    const root = standardRoot();
    const page1 = queryApplications(root, { limit: 2 });
    expect(page1.entries.map(e => e.num)).toEqual([1, 2]);
    expect(page1.total).toBe(4);
    expect(page1.count).toBe(2);
    expect(page1.next_offset).toBe(2);
    const page2 = queryApplications(root, { limit: 2, offset: 2 });
    expect(page2.entries.map(e => e.num)).toEqual([3, 4]);
    expect(page2.next_offset).toBeNull();
  });

  it('totals count the filtered set, not the whole tracker', () => {
    const result = queryApplications(standardRoot(), { role: 'engineer', limit: 1 });
    expect(result.total).toBe(4);
    expect(result.count).toBe(1);
    expect(result.next_offset).toBe(1);
  });

  it('returns an empty page past the end', () => {
    const result = queryApplications(standardRoot(), { offset: 10 });
    expect(result.entries).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.total).toBe(4);
    expect(result.next_offset).toBeNull();
  });

  it('clamps limit to at least 1 and defaults it to 200', () => {
    const rows = Array.from(
      { length: 205 },
      (_, i) =>
        `| ${i + 1} | 2026-07-01 | Co${i + 1} | Engineer | 4.0/5 | Screened | ❌ | - | - |  |`,
    );
    const root = makeRoot(rows);
    const defaulted = queryApplications(root, {});
    expect(defaulted.count).toBe(200);
    expect(defaulted.total).toBe(205);
    expect(defaulted.next_offset).toBe(200);
    const clamped = queryApplications(root, { limit: 0 });
    expect(clamped.count).toBe(1);
    const clampedHigh = queryApplications(root, { limit: 5000 });
    expect(clampedHigh.count).toBe(205);
  });
});
