import { describe, expect, it } from 'vitest';
import { JobParams, JobRecord, JobType } from '@/lib/schemas/jobs';

describe('job mode naming', () => {
  it('uses reach-out as the canonical job type', () => {
    expect(JobType.parse('reach-out')).toBe('reach-out');
    expect(JobParams.parse({ type: 'reach-out', num: 42 })).toEqual({
      type: 'reach-out',
      num: 42,
    });
  });

  it('normalizes legacy outreach records at the parse boundary', () => {
    const parsed = JobRecord.parse({
      id: 'legacyoutreach01',
      type: 'outreach',
      status: 'running',
      params: { num: 42 },
      startedAt: '2026-06-07T19:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    });
    expect(parsed.type).toBe('reach-out');
  });
});
