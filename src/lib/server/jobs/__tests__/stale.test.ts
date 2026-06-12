// src/lib/server/jobs/__tests__/stale.test.ts
//
// Liveness detection for persisted job records (jobs/stale.ts) plus the
// api.ts reap-on-read integration: a 'running'/'queued' record orphaned by
// a server restart must flip to a terminal 'interrupted' error the first
// time anything reads it — otherwise it blocks singleton kinds forever via
// findActiveJob and renders an immortal, un-dismissable spinner card.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '../../../schemas/jobs';
import { findActiveJob, getJob } from '../api';
import {
  INTERRUPTED_ERROR,
  isJobStale,
  isPidAlive,
  markInterrupted,
  NO_PID_GRACE_MS,
  QUEUED_GRACE_MS,
} from '../stale';

// api.ts schedules spawnJob via setImmediate from createJob; these tests
// never call createJob, but mock the runner anyway so an accidental import
// can never fork a real shell command.
vi.mock('../runner', () => ({ spawnJob: vi.fn() }));

function makeJob(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'abcdef0123456789',
    type: 'scan',
    status: 'running',
    params: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
    ...partial,
  } as JobRecord;
}

/** A pid guaranteed not to belong to a live process (probed via signal 0). */
function findDeadPid(): number {
  for (let pid = 99_990; pid > 90_000; pid--) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return pid;
    }
  }
  throw new Error('could not find a dead pid to test with');
}

describe('isPidAlive', () => {
  it('is true for this very process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });
  it('is false for a pid with no process behind it', () => {
    expect(isPidAlive(findDeadPid())).toBe(false);
  });
});

describe('isJobStale', () => {
  it('never flags terminal records', () => {
    expect(isJobStale(makeJob({ status: 'done' }))).toBe(false);
    expect(isJobStale(makeJob({ status: 'error' }))).toBe(false);
  });

  it('running + live pid → not stale (probe is authoritative)', () => {
    expect(isJobStale(makeJob({ pid: 12345 }), { pidAlive: () => true })).toBe(false);
  });

  it('running + dead pid → stale, even when fresh', () => {
    expect(isJobStale(makeJob({ pid: 12345 }), { pidAlive: () => false })).toBe(true);
  });

  it('running without pid falls back to record age vs NO_PID_GRACE_MS', () => {
    const startedAt = new Date(1_000_000).toISOString();
    const fresh = 1_000_000 + NO_PID_GRACE_MS - 1;
    const old = 1_000_000 + NO_PID_GRACE_MS + 1;
    expect(isJobStale(makeJob({ startedAt }), { now: fresh })).toBe(false);
    expect(isJobStale(makeJob({ startedAt }), { now: old })).toBe(true);
  });

  it('queued falls back to record age vs QUEUED_GRACE_MS (pid never stamped)', () => {
    const startedAt = new Date(1_000_000).toISOString();
    const job = makeJob({ status: 'queued', startedAt });
    expect(isJobStale(job, { now: 1_000_000 + QUEUED_GRACE_MS - 1 })).toBe(false);
    expect(isJobStale(job, { now: 1_000_000 + QUEUED_GRACE_MS + 1 })).toBe(true);
  });

  it('treats an unparseable startedAt as stale', () => {
    expect(isJobStale(makeJob({ startedAt: 'not-a-date' }))).toBe(true);
  });
});

describe('markInterrupted', () => {
  it('flips to a terminal error with the interrupted copy; exitCode stays null', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const reaped = markInterrupted(makeJob(), now);
    expect(reaped.status).toBe('error');
    expect(reaped.error).toBe(INTERRUPTED_ERROR);
    expect(reaped.finishedAt).toBe(now.toISOString());
    expect(reaped.exitCode).toBeNull();
  });
});

describe('api.ts reap-on-read', () => {
  let root: string;

  function seedRecord(job: JobRecord): void {
    mkdirSync(join(root, 'data/jobs'), { recursive: true });
    writeFileSync(join(root, `data/jobs/${job.id}.json`), JSON.stringify(job, null, 2), 'utf-8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jobs-stale-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('getJob flips a running record with a dead pid to interrupted and persists it', () => {
    const job = makeJob({ pid: findDeadPid() });
    seedRecord(job);

    const read = getJob(root, job.id);
    expect(read?.status).toBe('error');
    expect(read?.error).toBe(INTERRUPTED_ERROR);

    // persisted, not just returned — the next read sees the terminal state
    const onDisk = JSON.parse(readFileSync(join(root, `data/jobs/${job.id}.json`), 'utf-8'));
    expect(onDisk.status).toBe('error');
  });

  it('findActiveJob no longer reports the reaped record — singleton kinds unblock', () => {
    seedRecord(makeJob({ pid: findDeadPid() }));
    expect(findActiveJob(root, 'scan')).toBeNull();
  });

  it('leaves a genuinely live running record alone', () => {
    // This test process IS the live pid — the probe must say alive.
    const job = makeJob({ pid: process.pid });
    seedRecord(job);
    expect(getJob(root, job.id)?.status).toBe('running');
    expect(findActiveJob(root, 'scan')?.id).toBe(job.id);
  });

  it('reaps an orphaned queued record only after the grace window', () => {
    const fresh = makeJob({ status: 'queued' });
    seedRecord(fresh);
    expect(getJob(root, fresh.id)?.status).toBe('queued');

    const orphan = makeJob({
      id: 'fedcba9876543210',
      status: 'queued',
      startedAt: new Date(Date.now() - QUEUED_GRACE_MS - 1000).toISOString(),
    });
    seedRecord(orphan);
    expect(getJob(root, orphan.id)?.status).toBe('error');
  });
});
