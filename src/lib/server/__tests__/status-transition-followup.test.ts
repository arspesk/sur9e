import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '../../schemas/applications';
import type { JobStatus, JobType } from '../../schemas/jobs';
import { updateStatusWithFollowup } from '../status-transition-followup';

const roots: string[] = [];

function makeRoot(status: string, reportSection = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'status-transition-followup-test-'));
  roots.push(root);
  mkdirSync(join(root, 'data', 'jobs'), { recursive: true });
  mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'applications.md'),
    [
      '| #    | Date       | Company | Role     | Score | Status | PDF | Report                                 | Notes |',
      '| ---- | ---------- | ------- | -------- | ----- | ------ | --- | -------------------------------------- | ----- |',
      `| 1001 | 2026-07-31 | Acme    | Engineer | 4.0   | ${status} | -   | [1001](artifacts/reports/1001-acme.md) | -     |`,
      '| 1002 | 2026-07-31 | Globex  | Engineer | 3.5   | Applied | -   | -                                      | -     |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'artifacts', 'reports', '1001-acme.md'),
    [
      '---',
      'num: 1001',
      'company: Acme',
      'role: Engineer',
      "date: '2026-07-31'",
      'status: Evaluated',
      'state: evaluated',
      'score: 4.0',
      '---',
      '',
      '# Acme — Engineer',
      '',
      '## Verdict',
      '',
      'Strong fit.',
      reportSection ? `\n${reportSection}\n` : '',
    ].join('\n'),
  );
  return root;
}

function writeJob(root: string, id: string, type: JobType, status: JobStatus, num: number): void {
  const terminal = status === 'done' || status === 'error' || status === 'cancelled';
  writeFileSync(
    join(root, 'data', 'jobs', `${id}.json`),
    JSON.stringify({
      id,
      type,
      status,
      params: { num },
      startedAt: new Date().toISOString(),
      finishedAt: terminal ? new Date().toISOString() : null,
      output: '',
      error: status === 'error' ? 'historical failure' : null,
      exitCode: status === 'error' ? 1 : status === 'done' ? 0 : null,
      ...(status === 'running' ? { pid: process.pid } : {}),
    }),
  );
}

function expectSavedStatus(root: string, status: string): void {
  const row = readFileSync(join(root, 'data', 'applications.md'), 'utf-8')
    .split('\n')
    .find(line => line.startsWith('| 1001 '));
  expect(row?.split('|')[6].trim()).toBe(status);
}

function transition(root: string, status: ApplicationStatus) {
  return updateStatusWithFollowup(root, 1001, status);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('updateStatusWithFollowup', () => {
  it('saves applied → interview and returns interview preparation', () => {
    const root = makeRoot('Applied');

    const result = transition(root, 'interview');

    expect(result.updated.status).toBe('Interview');
    expect(result.followup).toEqual({ num: 1001, jobKind: 'interview-prep' });
    expectSavedStatus(root, 'Interview');
  });

  it('saves interview → offer and returns negotiation', () => {
    const root = makeRoot('Interview');

    const result = transition(root, 'offer');

    expect(result.updated.status).toBe('Offer');
    expect(result.followup).toEqual({ num: 1001, jobKind: 'negotiate' });
    expectSavedStatus(root, 'Offer');
  });

  it('returns no follow-up for a same-status call', () => {
    const root = makeRoot('Interview');

    const result = transition(root, 'interview');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Interview');
  });

  it('returns no follow-up for an unrelated destination', () => {
    const root = makeRoot('Applied');

    const result = transition(root, 'responded');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Responded');
  });

  it('suppresses interview preparation when the report already has an Interview Process', () => {
    const root = makeRoot('Applied', '## Interview Process\n\nTwo technical rounds.');

    const result = transition(root, 'interview');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Interview');
  });

  it('suppresses negotiation when the report already has a Negotiation Strategy', () => {
    const root = makeRoot(
      'Interview',
      '## Negotiation Strategy\n\nAnchor at the top of the range.',
    );

    const result = transition(root, 'offer');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Offer');
  });

  it('suppresses interview preparation when a matching job is queued for the same offer', () => {
    const root = makeRoot('Applied');
    writeJob(root, 'queuedinterview1', 'interview-prep', 'queued', 1001);

    const result = transition(root, 'interview');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Interview');
  });

  it('suppresses negotiation when a matching job is running for the same offer', () => {
    const root = makeRoot('Interview');
    writeJob(root, 'runningnegotiate', 'negotiate', 'running', 1001);

    const result = transition(root, 'offer');

    expect(result.followup).toBeNull();
    expectSavedStatus(root, 'Offer');
  });

  it('keeps the saved status when post-write detail loading fails', () => {
    const root = makeRoot('Applied');
    mkdirSync(join(root, 'inputs', 'personalization'), { recursive: true });
    writeFileSync(
      join(root, 'inputs', 'personalization', 'profile.yml'),
      'candidate:\n  full_name: Test User\n',
    );
    writeFileSync(join(root, 'artifacts', 'output'), 'not a directory');
    let result: ReturnType<typeof transition> | undefined;

    expect(() => {
      result = transition(root, 'interview');
    }).not.toThrow();

    expect(result?.updated.status).toBe('Interview');
    expect(result?.followup).toBeNull();
    expectSavedStatus(root, 'Interview');
  });

  it('does not suppress for a matching job on another offer', () => {
    const root = makeRoot('Applied');
    writeJob(root, 'otherofferjob001', 'interview-prep', 'queued', 1002);

    const result = transition(root, 'interview');

    expect(result.followup).toEqual({ num: 1001, jobKind: 'interview-prep' });
    expectSavedStatus(root, 'Interview');
  });

  it('does not suppress for a failed historical matching job', () => {
    const root = makeRoot('Applied');
    writeJob(root, 'failedhistory001', 'interview-prep', 'error', 1001);

    const result = transition(root, 'interview');

    expect(result.followup).toEqual({ num: 1001, jobKind: 'interview-prep' });
    expectSavedStatus(root, 'Interview');
  });

  it('does not suppress for a cancelled historical matching job', () => {
    const root = makeRoot('Interview');
    writeJob(root, 'cancelhistory001', 'negotiate', 'cancelled', 1001);

    const result = transition(root, 'offer');

    expect(result.followup).toEqual({ num: 1001, jobKind: 'negotiate' });
    expectSavedStatus(root, 'Offer');
  });

  it('throws for a missing offer before writing applications.md', () => {
    const root = makeRoot('Applied');
    const file = join(root, 'data', 'applications.md');
    const before = readFileSync(file, 'utf-8');

    expect(() => updateStatusWithFollowup(root, 9999, 'interview')).toThrow('num not found: 9999');

    expect(readFileSync(file, 'utf-8')).toBe(before);
    expect(existsSync(`${file}.bak`)).toBe(false);
    expect(existsSync(join(root, 'data', 'status-log.jsonl'))).toBe(false);
  });
});
