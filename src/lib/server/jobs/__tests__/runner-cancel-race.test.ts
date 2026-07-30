import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signalMock } = vi.hoisted(() => ({
  signalMock: vi.fn(),
}));

vi.mock('../command-registry', () => ({
  buildCommand: vi.fn(() => ({ cmd: 'fake-worker', args: [] })),
}));

vi.mock('../../providers/registry', () => ({
  getProvider: vi.fn(() => ({
    checkInstalled: vi.fn().mockResolvedValue({ ok: true, version: 'test' }),
  })),
  resolveModeRuntime: vi.fn(() => ({
    provider: 'claude',
    model: 'test-model',
    resolvedFrom: 'global_default',
  })),
}));

import type { ChildProcess } from 'node:child_process';
import type { JobRecord } from '../../../schemas/jobs';
import { cancelJob, persistJobRecord, readJobRecord } from '../lifecycle';
import { spawnJob } from '../runner';

const JOB_ID = '0123456789abcdef';

function fakeChild(): ChildProcess & {
  stdout: NonNullable<ChildProcess['stdout']>;
  stderr: NonNullable<ChildProcess['stderr']>;
} {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { configurable: true, value: 4321 },
    exitCode: { configurable: true, value: null },
    stdout: { configurable: true, value: new EventEmitter() },
    stderr: { configurable: true, value: new EventEmitter() },
  });
  return child as ChildProcess & {
    stdout: NonNullable<ChildProcess['stdout']>;
    stderr: NonNullable<ChildProcess['stderr']>;
  };
}

describe('spawnJob cancellation interleaving', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-runner-cancel-race-'));
    mkdirSync(join(root, 'data/jobs'), { recursive: true });
    signalMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves cancellation that lands while the worker is being spawned', async () => {
    let statusDuringSpawn: string | undefined;
    const job: JobRecord = {
      id: JOB_ID,
      type: 'evaluate',
      status: 'queued',
      params: { num: 1 },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);

    const cancelExact = (rootPath: string, jobId: string) =>
      cancelJob(rootPath, jobId, {
        signal: signalMock,
        scheduleForce: vi.fn(),
      });
    const spawnProcess = vi.fn(() => {
      // This is the exact race: spawnJob already persisted "running", but
      // has not registered or stamped the newly created child yet.
      cancelExact(root, JOB_ID);
      statusDuringSpawn = readJobRecord(root, JOB_ID)?.status;
      return fakeChild();
    });

    await spawnJob(root, job, { spawnProcess, cancel: cancelExact });

    expect(statusDuringSpawn).toBe('cancelled');
    expect(readJobRecord(root, JOB_ID)).toMatchObject({
      status: 'cancelled',
      pid: 4321,
      processGroupId: 4321,
    });
    expect(signalMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID, status: 'cancelled', pid: 4321 }),
      'SIGTERM',
    );
  });

  it('does not let a pending output flush overwrite a later cancellation', async () => {
    vi.useFakeTimers();
    const job: JobRecord = {
      id: JOB_ID,
      type: 'evaluate',
      status: 'queued',
      params: { num: 1 },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);
    const child = fakeChild();
    const cancelExact = (rootPath: string, jobId: string) =>
      cancelJob(rootPath, jobId, {
        signal: signalMock,
        scheduleForce: vi.fn(),
      });

    await spawnJob(root, job, {
      spawnProcess: vi.fn(() => child),
      cancel: cancelExact,
    });
    child.stdout?.emit('data', Buffer.from('final output during TERM grace\n'));
    cancelExact(root, JOB_ID);

    await vi.advanceTimersByTimeAsync(500);

    expect(readJobRecord(root, JOB_ID)).toMatchObject({
      status: 'cancelled',
      output: 'final output during TERM grace\n',
    });
  });

  it('preserves cancellation that lands during async close bookkeeping', async () => {
    const job: JobRecord = {
      id: JOB_ID,
      type: 'evaluate',
      status: 'queued',
      params: { num: 1 },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);
    const child = fakeChild();
    const cancelExact = (rootPath: string, jobId: string) =>
      cancelJob(rootPath, jobId, {
        signal: signalMock,
        scheduleForce: vi.fn(),
      });
    let releaseTracking: (() => void) | undefined;
    let trackingStarted: (() => void) | undefined;
    const enteredTracking = new Promise<void>(resolve => {
      trackingStarted = resolve;
    });
    const trackingGate = new Promise<void>(resolve => {
      releaseTracking = resolve;
    });

    await spawnJob(root, job, {
      spawnProcess: vi.fn(() => child),
      cancel: cancelExact,
      trackUsage: async () => {
        trackingStarted?.();
        await trackingGate;
      },
    });
    child.stdout.emit(
      'data',
      Buffer.from('[USAGE] {"input_tokens":10,"output_tokens":5,"model":"test-model"}\n'),
    );
    child.emit('close', 0);
    await enteredTracking;

    cancelExact(root, JOB_ID);
    releaseTracking?.();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(readJobRecord(root, JOB_ID)).toMatchObject({
      status: 'cancelled',
      output: expect.stringContaining('[USAGE]'),
    });
  });

  it('starts evaluation as a separate job only after screening succeeds', async () => {
    const job: JobRecord = {
      id: JOB_ID,
      type: 'screen',
      status: 'queued',
      params: { num: 1, then: 'evaluate' },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);
    const child = fakeChild();
    const startNextJob = vi.fn(() => ({
      id: 'fedcba9876543210',
      type: 'evaluate',
      status: 'queued',
      params: { num: 1 },
      startedAt: '2026-07-28T10:01:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    }));

    await spawnJob(root, job, {
      spawnProcess: vi.fn(() => child),
      startNextJob,
    } as Parameters<typeof spawnJob>[2]);
    child.emit('close', 0);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(startNextJob).toHaveBeenCalledWith(root, 'evaluate', { num: 1 });
    expect(readJobRecord(root, JOB_ID)).toMatchObject({
      status: 'done',
      params: {
        num: 1,
        then: 'evaluate',
        next_job_id: 'fedcba9876543210',
      },
    });
  });

  it('does not start evaluation when screening fails', async () => {
    const job: JobRecord = {
      id: JOB_ID,
      type: 'screen',
      status: 'queued',
      params: { num: 1, then: 'evaluate' },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);
    const child = fakeChild();
    const startNextJob = vi.fn();

    await spawnJob(root, job, {
      spawnProcess: vi.fn(() => child),
      startNextJob,
    } as Parameters<typeof spawnJob>[2]);
    child.emit('close', 1);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(startNextJob).not.toHaveBeenCalled();
    expect(readJobRecord(root, JOB_ID)).toMatchObject({
      status: 'error',
      params: { num: 1, then: 'evaluate' },
    });
  });

  it('notifies the workflow runner after a child reaches a terminal state', async () => {
    const job: JobRecord = {
      id: JOB_ID,
      type: 'evaluate',
      status: 'queued',
      params: { num: 1, workflow_id: 'workflow-1', workflow_step_id: 'step-1' },
      startedAt: '2026-07-28T10:00:00.000Z',
      finishedAt: null,
      output: '',
      error: null,
      exitCode: null,
    };
    persistJobRecord(root, job);
    const child = fakeChild();
    const advanceWorkflow = vi.fn();

    await spawnJob(root, job, {
      spawnProcess: vi.fn(() => child),
      advanceWorkflow,
    } as Parameters<typeof spawnJob>[2]);
    child.emit('close', 0);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(advanceWorkflow).toHaveBeenCalledWith(root, JOB_ID);
  });
});
