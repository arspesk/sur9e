import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord } from '../../schemas/jobs';
import { stampScreenJobNum } from '../jobs/runner';

function writeReport(root: string, num: number, url: string): void {
  const dir = join(root, 'artifacts', 'reports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${num}-example-2026-06-07.md`),
    [
      '---',
      `num: ${num}`,
      'company: "Example"',
      'role: "Solutions Engineer"',
      'date: "2026-06-07"',
      'status: "screened"',
      'state: "screened"',
      'score: 4.1',
      `url: "${url}"`,
      '---',
      '',
      '## TL;DR',
      '',
      'Good fit.',
    ].join('\n'),
    'utf8',
  );
}

function jobRecord(over: Partial<JobRecord>): JobRecord {
  return {
    id: '0123456789abcdef',
    type: 'screen',
    status: 'done',
    params: { url: 'https://example.com/jobs/1' },
    startedAt: '2026-06-07T00:00:00.000Z',
    finishedAt: '2026-06-07T00:02:00.000Z',
    output: '',
    error: null,
    exitCode: 0,
    ...over,
  };
}

describe('stampScreenJobNum', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-screen-num-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('attaches the screened offer num to a completed single-URL screen job', () => {
    writeReport(root, 441, 'https://example.com/jobs/1');

    const stamped = stampScreenJobNum(root, jobRecord({}));

    expect(stamped.params.num).toBe(441);
  });

  it('uses the newest matching report when a URL has been screened more than once', () => {
    writeReport(root, 440, 'https://example.com/jobs/1');
    writeReport(root, 442, 'https://example.com/jobs/1');

    const stamped = stampScreenJobNum(root, jobRecord({}));

    expect(stamped.params.num).toBe(442);
  });

  it('leaves queue-mode and unresolved screen jobs unchanged', () => {
    const queueMode = jobRecord({ params: {} });
    const unresolved = jobRecord({});

    expect(stampScreenJobNum(root, queueMode)).toBe(queueMode);
    expect(stampScreenJobNum(root, unresolved)).toBe(unresolved);
  });
});
