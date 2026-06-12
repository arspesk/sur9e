// Regression tests for report-numbering + logo fallback in batch/screen.mjs.
//
// nextReportNum() must (a) keep counting across the 3→4 digit boundary — the
// original /^(\d{3})-/ ignored every 4-digit file once reports hit 1000 and
// kept returning ~1000 — and (b) reconcile against applications.md so the
// screener never proposes a number merge-tracker will bump (which drifts the
// tracker row number away from the report filename).
//
// guessDomainFromCompany() backs the avatar fallback: when the screener model
// omits `domain`, the report still gets a favicon keyed off the company name.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guessDomainFromCompany, nextReportNum } from '../batch/screen.mjs';

let dir;
const NO_APPS = '/nonexistent/applications.md'; // forces apps max = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'next-report-num-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(name) {
  writeFileSync(join(dir, name), '');
}
function appsFile(...nums) {
  const path = join(dir, 'applications.md');
  const rows = nums
    .map(n => `| ${n} | 2026-01-01 | Co | Role | 4.0/5 | Screened | ❌ | [${n}](r.md) | x |`)
    .join('\n');
  writeFileSync(
    path,
    `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|\n${rows}\n`,
  );
  return path;
}

describe('nextReportNum', () => {
  it('returns 1 for an empty / missing reports dir', () => {
    expect(nextReportNum(dir, NO_APPS)).toBe(1);
  });

  it('counts 3-digit reports (max + 1)', () => {
    touch('001-acme-2026-01-01.md');
    touch('042-foo-2026-01-01.md');
    expect(nextReportNum(dir, NO_APPS)).toBe(43);
  });

  it('counts 4-digit reports across the 1000 boundary (the cap bug)', () => {
    touch('999-old-2026-01-01.md');
    touch('1000-deepgram-2026-06-01.md');
    touch('1006-databricks-2026-06-07.md');
    expect(nextReportNum(dir, NO_APPS)).toBe(1007); // buggy regex returned 1000
  });

  it('ignores non-report files and .bak sidecars', () => {
    touch('1006-databricks-2026-06-07.md');
    touch('1006-databricks-2026-06-07.md.bak');
    touch('notes.txt');
    expect(nextReportNum(dir, NO_APPS)).toBe(1007);
  });

  it('reconciles against applications.md max (avoids num/file drift)', () => {
    // Reports dir maxes at 1006, but the tracker already has #1010 (its report
    // file was renamed/lost). Without reconciliation the screener proposes 1007
    // and merge-tracker bumps to ++maxNum=1011 → row≠filename. Reconciled, the
    // screener proposes 1011 up front so the numbers agree.
    touch('1006-databricks-2026-06-07.md');
    const apps = appsFile(1004, 1010);
    expect(nextReportNum(dir, apps)).toBe(1011);
  });

  it('uses the reports dir when it exceeds the tracker max', () => {
    touch('1020-foo-2026-06-07.md');
    const apps = appsFile(1004, 1010);
    expect(nextReportNum(dir, apps)).toBe(1021);
  });
});

describe('guessDomainFromCompany', () => {
  it('slugifies a company name into a .com domain', () => {
    expect(guessDomainFromCompany('Deepgram')).toBe('deepgram.com');
    expect(guessDomainFromCompany('Hugging Face')).toBe('huggingface.com');
  });

  it('strips common legal suffixes', () => {
    expect(guessDomainFromCompany('Swanson Industries, Inc.')).toBe('swansonindustries.com');
    expect(guessDomainFromCompany('Acme GmbH')).toBe('acme.com');
  });

  it('returns empty for missing / Unknown company (no logo keyed off a non-company)', () => {
    expect(guessDomainFromCompany('')).toBe('');
    expect(guessDomainFromCompany('Unknown')).toBe('');
    expect(guessDomainFromCompany(undefined)).toBe('');
  });
});
