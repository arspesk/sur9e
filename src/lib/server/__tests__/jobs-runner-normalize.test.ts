// src/lib/server/__tests__/jobs-runner-normalize.test.ts
//
// After a report-writing generation job finishes (status 'done'), the
// runner reads the report file, runs the
// report-markdown normalizer, atomic-writes the cleaned body back, and records
// the applied fixes on the job record. Exercised through the exported helper so
// the test does not have to spawn a real child process.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../../schemas/jobs';
import { normalizeFinishedReport } from '../jobs/runner';

const DIRTY_BODY = [
  '\\## TL;DR',
  '',
  'Strong SE fit with touchpoints \\~60% aligned to the stack.',
  '',
  '> ✅ Strongest match: hands-on platform work maps direct.',
  '',
  '**PDF:** [Download the tailored CV](/artifacts/cv/example.pdf)',
  '',
].join('\n');

function writeReport(root: string, num: number, body: string): string {
  const dir = join(root, 'artifacts', 'reports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(num).padStart(3, '0')}-x-2026-06-01.md`);
  const fm = `---\nnum: ${num}\ncompany: "X"\nrole: "Y"\ndate: "2026-06-01"\nstatus: "evaluated"\nstate: "evaluated"\nscore: 4.2\n---\n\n${body}`;
  writeFileSync(file, fm, 'utf8');
  return file;
}

function jobRecord(over: Partial<JobRecord>): JobRecord {
  return {
    id: '0123456789abcdef',
    type: 'evaluate',
    status: 'done',
    params: { type: 'evaluate', num: 7 },
    startedAt: '2026-06-01T00:00:00.000Z',
    finishedAt: '2026-06-01T00:10:00.000Z',
    output: '',
    error: null,
    exitCode: 0,
    ...over,
  };
}

describe('normalizeFinishedReport', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-runner-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('normalizes the report body and records fixes for a report-writing job', () => {
    const file = writeReport(root, 7, DIRTY_BODY);
    const job = jobRecord({ params: { type: 'evaluate', num: 7 } });

    const result = normalizeFinishedReport(root, job);

    // The job record gained a fix log (count + rule ids).
    expect(result).not.toBeNull();
    expect(result?.count).toBeGreaterThan(0);
    expect(result?.rules).toEqual(expect.arrayContaining(['unescape', 'pdf-line']));

    // The file on disk is healed.
    const written = readFileSync(file, 'utf8');
    expect(written).not.toMatch(/\\#/);
    expect(written).toContain('<div data-callout data-variant="success"');
    expect(written).not.toContain('**PDF:**');
  });

  it('returns null for a non-report-writing job type', () => {
    writeReport(root, 7, DIRTY_BODY);
    const job = jobRecord({ type: 'scan', params: { type: 'scan' } });
    expect(normalizeFinishedReport(root, job)).toBeNull();
  });

  it('returns null when the job is not done', () => {
    writeReport(root, 7, DIRTY_BODY);
    const job = jobRecord({ status: 'error', exitCode: 1, error: 'exit 1' });
    expect(normalizeFinishedReport(root, job)).toBeNull();
  });

  it('returns null when params has no num', () => {
    const job = jobRecord({ params: { type: 'evaluate' } });
    expect(normalizeFinishedReport(root, job)).toBeNull();
  });

  it('returns null (no throw) when the report file is missing', () => {
    const job = jobRecord({ params: { type: 'evaluate', num: 99 } });
    expect(normalizeFinishedReport(root, job)).toBeNull();
  });

  it('records zero fixes (count 0) when the report is already clean', () => {
    writeReport(root, 7, '## TL;DR\n\nA clean verdict line.\n');
    const job = jobRecord({ params: { type: 'evaluate', num: 7 } });
    const result = normalizeFinishedReport(root, job);
    expect(result).not.toBeNull();
    expect(result?.count).toBe(0);
    expect(result?.rules).toEqual([]);
  });
});
