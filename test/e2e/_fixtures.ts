// Shared dynamic fixture resolution for the e2e suite.
//
// Reports live in artifacts/reports/ and are USER DATA — they drift as the
// user runs evaluations, so specs must never hardcode a personal report
// filename. Resolve the fixture at spec-load time (Node context) instead:
// pick the first non-.bak .md file. When the directory is empty (a fresh
// OSS clone with no data) `REPORT_FIXTURE` is null and the dependent tests
// skip cleanly via `skipIfNoReport()`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

const ROOT = process.env.SUR9E_ROOT ?? process.cwd();
const REPORTS_DIR = join(ROOT, 'artifacts', 'reports');
const TRACKER_FILE = join(ROOT, 'data', 'applications.md');

function trackedReportFixtures(): string[] {
  try {
    const entries = readdirSync(REPORTS_DIR);
    const tracker = readFileSync(TRACKER_FILE, 'utf-8');
    const md = entries.filter(f => f.endsWith('.md') && !f.endsWith('.bak')).sort();
    // Reports can outlive a deleted tracker row. The report page resolves by
    // tracker number first, so an orphan file is not a valid browser fixture
    // even though it exists on disk. Pick the first report still linked by an
    // application row; otherwise skip the data-dependent specs cleanly.
    return md.filter(file => tracker.includes(`(artifacts/reports/${file})`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function withoutFencedCode(markdown: string): string {
  let insideFence = false;
  return markdown
    .split('\n')
    .filter(line => {
      if (/^\s*```/.test(line)) {
        insideFence = !insideFence;
        return false;
      }
      return !insideFence;
    })
    .join('\n');
}

const TRACKED_REPORTS = trackedReportFixtures();

/** First on-disk report filename (e.g. `005-foo-2026-06-05.md`) or null. */
export const REPORT_FIXTURE: string | null = TRACKED_REPORTS[0] ?? null;

/** Tracked report with enough headings to exercise the multi-line TOC rail. */
export const HEADING_REPORT_FIXTURE: string | null =
  TRACKED_REPORTS.find(file => {
    try {
      const markdown = readFileSync(join(REPORTS_DIR, file), 'utf-8');
      return (withoutFencedCode(markdown).match(/^##\s+/gm) ?? []).length >= 2;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }) ?? null;

/**
 * Skip the calling test when there's no report on disk, so the suite still
 * passes on a fresh clone with an empty artifacts/reports/ directory.
 */
export function skipIfNoReport(): asserts REPORT_FIXTURE is string {
  test.skip(
    REPORT_FIXTURE === null,
    'no reports in artifacts/reports/ — report-dependent test skipped',
  );
}

export function skipIfNoHeadingReport(): asserts HEADING_REPORT_FIXTURE is string {
  test.skip(
    HEADING_REPORT_FIXTURE === null,
    'no tracked report with multiple headings — TOC test skipped',
  );
}
