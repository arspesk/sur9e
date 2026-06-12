// Shared dynamic fixture resolution for the e2e suite.
//
// Reports live in artifacts/reports/ and are USER DATA — they drift as the
// user runs evaluations, so specs must never hardcode a personal report
// filename. Resolve the fixture at spec-load time (Node context) instead:
// pick the first non-.bak .md file. When the directory is empty (a fresh
// OSS clone with no data) `REPORT_FIXTURE` is null and the dependent tests
// skip cleanly via `skipIfNoReport()`.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

const REPORTS_DIR = join(process.cwd(), 'artifacts', 'reports');

function firstReportFixture(): string | null {
  try {
    const entries = readdirSync(REPORTS_DIR);
    const md = entries.filter(f => f.endsWith('.md') && !f.endsWith('.bak')).sort();
    return md[0] ?? null;
  } catch {
    return null;
  }
}

/** First on-disk report filename (e.g. `005-foo-2026-06-05.md`) or null. */
export const REPORT_FIXTURE: string | null = firstReportFixture();

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
