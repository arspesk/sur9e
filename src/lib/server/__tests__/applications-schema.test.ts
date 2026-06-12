// src/lib/server/__tests__/applications-schema.test.ts
//
// Parse-boundary tests for the typed entrypoint that wraps applications.mjs.
// All fixtures live in os.tmpdir() — never touches the real data/applications.md.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRow, ApplicationStatus } from '../../schemas/applications';
import {
  batchUpdateStatus,
  CANONICAL_STATUSES,
  deleteApplication,
  displayStatus,
  findByNum,
  loadApplications,
  normalizeStatus,
  updateStatus,
} from '../applications';
import { loadStatusLog } from '../status-log';

const APPLICATIONS_MD = [
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '| 1002 | 2026-05-15 | Globex  | Eng  | 3.5   | Evaluated | -   | -      | -     |',
  '',
].join('\n');

function makeTmpRoot(initialMd: string = APPLICATIONS_MD): string {
  const root = mkdtempSync(join(tmpdir(), 'applications-schema-test-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/applications.md'), initialMd);
  return root;
}

describe('applications.ts — schema boundary', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loadApplications returns rows that parse through ApplicationRow', () => {
    const rows = loadApplications(root);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Re-parse explicitly to assert schema conformance — the wrapper
      // already parses, but this guards against accidental any-passthrough.
      expect(() => ApplicationRow.parse(row)).not.toThrow();
    }
    expect(rows[0].num).toBe(1001);
    expect(rows[0].company).toBe('Acme');
    expect(rows[1].num).toBe(1002);
  });

  it('exposes the optional trailing Posted column and omits it on legacy/empty/garbage cells', () => {
    const md = [
      '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes | Posted |',
      '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- | ------ |',
      '| 2001 | 2026-06-10 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     | 2026-06-02 |',
      '| 2002 | 2026-06-10 | Globex  | Eng  | 3.5   | Evaluated | -   | -      | -     |  |',
      '| 2003 | 2026-06-10 | Initech | Eng  | 3.0   | Screened  | -   | -      | -     | last week |',
      '| 2004 | 2026-05-15 | Hooli   | Eng  | 4.2   | Applied   | -   | -      | legacy 9-col |',
      '',
    ].join('\n');
    const tmp = makeTmpRoot(md);
    try {
      const rows = loadApplications(tmp);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(() => ApplicationRow.parse(row)).not.toThrow();
      }
      expect(rows[0].posted).toBe('2026-06-02');
      // Empty cell, non-date garbage, and legacy 9-col rows all omit the
      // field entirely — never an empty string.
      expect(rows[1].posted).toBeUndefined();
      expect(rows[2].posted).toBeUndefined();
      expect(rows[3].posted).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('updateStatus rewrites only the status cell on a 10-column row — posted survives', () => {
    const md = [
      '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes | Posted |',
      '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- | ------ |',
      '| 3001 | 2026-06-10 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     | 2026-06-02 |',
      '',
    ].join('\n');
    const tmp = makeTmpRoot(md);
    try {
      const updated = updateStatus(tmp, 3001, 'applied');
      expect(updated?.status).toBe('Applied');
      expect(updated?.posted).toBe('2026-06-02');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('loadApplications returns [] when the data file is missing', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'applications-schema-empty-'));
    try {
      expect(loadApplications(emptyRoot)).toEqual([]);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('skips a hand-edited row with num 0 / negative instead of crashing the whole load', () => {
    // One bad row used to throw a ZodError out of ApplicationRow.array().parse,
    // dropping /offers and /analytics to their route error boundaries. It must
    // fail soft (skip + warn) like every other malformation in this parser.
    const md = [
      '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
      '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
      '| 0    | 2026-05-15 | ZeroCo  | Eng  | 1.0   | Screened  | -   | -      | -     |',
      '| -3   | 2026-05-15 | NegCo   | Eng  | 1.0   | Screened  | -   | -      | -     |',
      '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
      '',
    ].join('\n');
    const badRoot = makeTmpRoot(md);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rows = loadApplications(badRoot);
      expect(rows.map(r => r.num)).toEqual([1001]);
      // One warning per skipped row, naming the offending num.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain('num 0');
      expect(String(warn.mock.calls[1][0])).toContain('num -3');
    } finally {
      warn.mockRestore();
      rmSync(badRoot, { recursive: true, force: true });
    }
  });

  it('updateStatus normalizes legacy "skip" → "Discarded" (canonical "discarded")', () => {
    const updated = updateStatus(root, 1001, 'skip');
    expect(updated).toBeDefined();
    expect(updated?.num).toBe(1001);
    expect(normalizeStatus(updated?.status)).toBe('discarded');
    expect(updated?.status).toBe('Discarded');
  });

  it('updateStatus writes a canonical status that round-trips through loadApplications', () => {
    updateStatus(root, 1002, 'applied');
    const rows = loadApplications(root);
    const row = rows.find(r => r.num === 1002);
    expect(row).toBeDefined();
    expect(row?.status).toBe('Applied');
    expect(normalizeStatus(row?.status)).toBe('applied');
  });

  it('updateStatus throws on an unknown status string', () => {
    expect(() => updateStatus(root, 1001, 'totally-bogus')).toThrow();
  });

  it('ApplicationStatus preprocesses "skip" → "discarded"', () => {
    expect(ApplicationStatus.parse('skip')).toBe('discarded');
    expect(ApplicationStatus.parse('applied')).toBe('applied');
    expect(() => ApplicationStatus.parse('nonsense')).toThrow();
  });
});

// ── batchUpdateStatus ─────────────────────────────────────────────────────────

describe('batchUpdateStatus — status-log parity with updateStatus', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends one source:"app" transition per actually-changed row', () => {
    const results = batchUpdateStatus(root, [
      { num: 1001, status: 'applied' },
      { num: 1002, status: 'evaluated' }, // already Evaluated — no transition
    ]);
    expect(results).toEqual([
      { num: 1001, ok: true },
      { num: 1002, ok: true },
    ]);
    const log = loadStatusLog(root);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      num: 1001,
      from: 'screened',
      to: 'applied',
      source: 'app',
    });
  });

  it('skips logging for failed rows (unknown num / invalid status)', () => {
    const results = batchUpdateStatus(root, [
      { num: 9999, status: 'applied' },
      { num: 1001, status: 'bogus' },
    ]);
    expect(results.every(r => !r.ok)).toBe(true);
    expect(loadStatusLog(root)).toHaveLength(0);
  });
});

// ── findByNum — appended-section flags ────────────────────────────────────────

describe('findByNum — has_company_research / has_interview_process', () => {
  let root: string;

  const REPORT_MD = [
    '---',
    'num: 1001',
    'company: Acme',
    'role: Eng',
    "date: '2026-05-15'",
    'status: Evaluated',
    'state: evaluated',
    'score: 4.0',
    '---',
    '',
    '# Acme — Eng',
    '',
    '## Verdict',
    '',
    'Solid.',
    '',
    '## Company Research',
    '',
    'Founded in 2020.',
    '',
  ].join('\n');

  beforeEach(() => {
    const md = [
      '| #    | Date       | Company | Role | Score | Status    | PDF | Report                                       | Notes |',
      '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | -------------------------------------------- | ----- |',
      '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Evaluated | -   | [1001](artifacts/reports/1001-acme.md)       | -     |',
      '',
    ].join('\n');
    root = makeTmpRoot(md);
    mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
    writeFileSync(join(root, 'artifacts/reports/1001-acme.md'), REPORT_MD);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('derives the flags from appended H2 sections in the report body', () => {
    // Regression: the flags were read from a frontmatter key no writer
    // produces (appended_sections), so they were permanently false and the
    // report TOC / toolbar lock never engaged after a research job.
    const detail = findByNum(root, 1001);
    expect(detail).not.toBeNull();
    expect(detail?.has_company_research).toBe(true);
    expect(detail?.has_interview_process).toBe(false);
  });
});

// ── CANONICAL_STATUSES + displayStatus ───────────────────────────────────────
// Migrated from test-all.mjs Section 15.

describe('CANONICAL_STATUSES', () => {
  it('exports an array of 8 canonical statuses', () => {
    expect(Array.isArray(CANONICAL_STATUSES)).toBe(true);
    expect(CANONICAL_STATUSES.length).toBe(8);
    for (const s of [
      'screened',
      'evaluated',
      'applied',
      'responded',
      'interview',
      'offer',
      'rejected',
      'discarded',
    ]) {
      expect(CANONICAL_STATUSES).toContain(s);
    }
  });
});

describe('displayStatus', () => {
  it('maps canonical values to Title Case', () => {
    expect(displayStatus('discarded')).toBe('Discarded');
    expect(displayStatus('applied')).toBe('Applied');
    expect(displayStatus('screened')).toBe('Screened');
    expect(displayStatus('interview')).toBe('Interview');
  });

  it('throws on invalid input', () => {
    expect(() => displayStatus('bogus' as never)).toThrow();
  });
});

// ── deleteApplication ─────────────────────────────────────────────────────────
// Migrated from test-all.mjs Section 16.

describe('deleteApplication', () => {
  const FIXTURE = [
    '# Applications Tracker (test fixture)',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-04-15 | Anthropic | Forward Deployed Engineer | 4.8/5 | Evaluated | ❌ | [1](artifacts/reports/1.md) | row 1 |',
    '| 2 | 2026-04-20 | Acme | Backend Engineer | 4.2/5 | Applied | ✅ | [2](artifacts/reports/2.md) | row 2 |',
    '| 3 | 2026-04-25 | Globex | Platform Engineer | 3.0/5 | Discarded | ❌ | [3](artifacts/reports/3.md) | row 3 |',
  ].join('\n');

  let scratchRoot: string;

  function seed(): void {
    mkdirSync(join(scratchRoot, 'data'), { recursive: true });
    mkdirSync(join(scratchRoot, 'artifacts', 'reports'), { recursive: true });
    writeFileSync(join(scratchRoot, 'data/applications.md'), FIXTURE, 'utf-8');
    writeFileSync(join(scratchRoot, 'artifacts/reports/1.md'), '# row 1', 'utf-8');
    writeFileSync(join(scratchRoot, 'artifacts/reports/2.md'), '# row 2', 'utf-8');
    writeFileSync(join(scratchRoot, 'artifacts/reports/3.md'), '# row 3', 'utf-8');
  }

  beforeEach(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'delete-app-test-'));
    seed();
  });

  afterEach(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it('is a no-op (deleted:false) when num is not found — not a throw', () => {
    const result = deleteApplication(scratchRoot, 99999);
    expect(result.deleted).toBe(false);
    expect(result.num).toBe(99999);
    expect(result.removedReport).toBeNull();
    // Existing rows are untouched.
    expect(loadApplications(scratchRoot).length).toBe(3);
  });

  it('removes the row and report file; returns correct metadata', () => {
    const result = deleteApplication(scratchRoot, 2);
    expect(result.deleted).toBe(true);
    expect(result.num).toBe(2);
    expect(result.removedReport).toBe('artifacts/reports/2.md');
    const remaining = loadApplications(scratchRoot);
    expect(remaining.find(e => e.num === 2)).toBeUndefined();
    expect(remaining.length).toBe(2);
    expect(existsSync(join(scratchRoot, 'artifacts/reports/2.md'))).toBe(false);
  });

  it('leaves other rows untouched', () => {
    deleteApplication(scratchRoot, 2);
    const remaining = loadApplications(scratchRoot);
    expect(remaining.find(e => e.num === 1)).toBeDefined();
    expect(remaining.find(e => e.num === 3)).toBeDefined();
  });

  it('second delete of same num is an idempotent no-op (deleted:false, no throw)', () => {
    const first = deleteApplication(scratchRoot, 2);
    expect(first.deleted).toBe(true);
    // A re-fired delete against the now-stale list must not 500.
    const second = deleteApplication(scratchRoot, 2);
    expect(second.deleted).toBe(false);
    expect(second.removedReport).toBeNull();
  });

  it('also removes the .bak sidecar and same-num orphan siblings (no shadowing leftovers)', () => {
    const reports = join(scratchRoot, 'artifacts/reports');
    // .bak sidecar of the linked report + a same-num report left under a
    // different slug (the screener/regeneration churn that shadowed #19).
    writeFileSync(join(reports, '2.md.bak'), 'bak', 'utf-8');
    writeFileSync(join(reports, '002-orphan-2026-06-02.md'), 'orphan', 'utf-8');
    writeFileSync(join(reports, '002-orphan-2026-06-02.md.bak'), 'orphan-bak', 'utf-8');
    // A different num's report must survive the prefix sweep.
    writeFileSync(join(reports, '020-other-2026-06-02.md'), 'other', 'utf-8');

    deleteApplication(scratchRoot, 2);

    expect(existsSync(join(reports, '2.md'))).toBe(false);
    expect(existsSync(join(reports, '2.md.bak'))).toBe(false);
    expect(existsSync(join(reports, '002-orphan-2026-06-02.md'))).toBe(false);
    expect(existsSync(join(reports, '002-orphan-2026-06-02.md.bak'))).toBe(false);
    // #20's report is untouched — `002-` is dash-bounded, so it can't match `020-`.
    expect(existsSync(join(reports, '020-other-2026-06-02.md'))).toBe(true);
  });
});
