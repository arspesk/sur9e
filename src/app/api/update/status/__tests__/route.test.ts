import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateJob } from '@/lib/schemas/update-job';
import { loadUpdateJob, writeUpdateJob } from '@/lib/server/update-orchestrator';

const TEST_ROOT = join(tmpdir(), 'sur9e-active-update-route-test');
const FIRST_JOB_ID = '26cf6d7a-2763-4b9d-b539-930fa8414bd5';
const SECOND_JOB_ID = '5a7a13e7-c6e0-4df4-a0f1-70d4a52f4530';
const TERMINAL_JOB_ID = 'a471c52d-c9c6-4371-832e-3fab8ff185b4';

vi.mock('@/lib/root', () => ({ ROOT: TEST_ROOT }));

function job(id: string, phase: UpdateJob['phase'], updatedAt: string): UpdateJob {
  const activeWorker = ![
    'queued',
    'recovery-queued',
    'succeeded',
    'rolled-back',
    'failed',
  ].includes(phase);
  return {
    id,
    phase,
    mode: { prod: false, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt,
    ...(phase === 'queued' || phase === 'recovery-queued'
      ? { launchState: 'claim-pending' as const }
      : activeWorker
        ? { launchState: 'owned' as const, pid: 4242 }
        : {}),
  };
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('GET /api/update/status', () => {
  it('returns null when there is no durable active update job', async () => {
    const { GET } = await import('../route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: null });
  });

  it('returns the latest nonterminal job, including recovery-queued', async () => {
    writeUpdateJob(TEST_ROOT, job(FIRST_JOB_ID, 'restarting', '2026-08-01T10:02:00Z'));
    const latest = job(SECOND_JOB_ID, 'recovery-queued', '2026-08-01T10:02:00.500Z');
    writeUpdateJob(TEST_ROOT, latest);
    writeUpdateJob(TEST_ROOT, job(TERMINAL_JOB_ID, 'succeeded', '2026-08-01T10:03:00.000Z'));
    const { GET } = await import('../route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: latest });
  });

  it('does not mutate or reconcile the discovered job', async () => {
    const staleClaim = job(FIRST_JOB_ID, 'queued', '2026-07-01T10:01:00.000Z');
    writeUpdateJob(TEST_ROOT, staleClaim);
    const { GET } = await import('../route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: staleClaim });
    expect(loadUpdateJob(TEST_ROOT, FIRST_JOB_ID)).toEqual(staleClaim);
  });
});
