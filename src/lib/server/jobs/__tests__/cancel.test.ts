import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CancellationDeps, cancelJob, registerLiveJob, unregisterLiveJob } from '../lifecycle';

const JOB_ID = '0123456789abcdef';

function record(status: 'queued' | 'running' | 'done' | 'error') {
  return {
    id: JOB_ID,
    type: 'evaluate',
    status,
    params: { num: 1 },
    startedAt: '2026-07-28T10:00:00.000Z',
    finishedAt: status === 'done' || status === 'error' ? '2026-07-28T10:01:00.000Z' : null,
    output: 'partial log\n',
    error: status === 'error' ? 'boom' : null,
    exitCode: status === 'done' ? 0 : null,
    ...(status === 'running' ? { pid: 4321, processGroupId: 4321 } : {}),
  };
}

describe('cancelJob', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-cancel-job-'));
    mkdirSync(join(root, 'data/jobs'), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(status: 'queued' | 'running' | 'done' | 'error') {
    writeFileSync(
      join(root, 'data/jobs', `${JOB_ID}.json`),
      JSON.stringify(record(status), null, 2),
    );
  }

  it('marks an exact running job cancelled, sends TERM, then escalates after five seconds', () => {
    write('running');
    const signals: string[] = [];
    let force: (() => void) | undefined;
    const deps: CancellationDeps = {
      signal: (_job, signal) => signals.push(signal),
      scheduleForce: (fn, ms) => {
        expect(ms).toBe(5000);
        force = fn;
      },
    };

    const result = cancelJob(root, JOB_ID, deps);

    expect(result.cancelled).toBe(true);
    expect(signals).toEqual(['SIGTERM']);
    const saved = JSON.parse(readFileSync(join(root, 'data/jobs', `${JOB_ID}.json`), 'utf-8'));
    expect(saved).toMatchObject({
      status: 'cancelled',
      error: null,
      output: 'partial log\n',
    });
    force?.();
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('cancels a queued job without signalling a process', () => {
    write('queued');
    const signal = vi.fn();
    const result = cancelJob(root, JOB_ID, { signal, scheduleForce: vi.fn() });
    expect(result.cancelled).toBe(true);
    expect(signal).not.toHaveBeenCalled();
    expect(result.job.status).toBe('cancelled');
  });

  it('still force-kills the process group when the root child exits during grace', () => {
    write('running');
    registerLiveJob(JOB_ID, { pid: 4321, exitCode: null } as unknown as ChildProcess);
    const signals: string[] = [];
    let force: (() => void) | undefined;

    cancelJob(root, JOB_ID, {
      signal: (_job, signal) => signals.push(signal),
      scheduleForce: fn => {
        force = fn;
      },
    });
    unregisterLiveJob(JOB_ID);
    force?.();

    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('is idempotent when the exact job already finished', () => {
    write('done');
    const signal = vi.fn();
    const result = cancelJob(root, JOB_ID, { signal, scheduleForce: vi.fn() });
    expect(result).toMatchObject({ cancelled: false, job: { status: 'done' } });
    expect(signal).not.toHaveBeenCalled();
  });

  it('notifies a parent workflow when a child is cancelled directly', () => {
    writeFileSync(
      join(root, 'data/jobs', `${JOB_ID}.json`),
      JSON.stringify(
        {
          ...record('queued'),
          params: { num: 1, workflow_id: 'workflow-1', workflow_step_id: 'step-1' },
        },
        null,
        2,
      ),
    );
    const advanceWorkflow = vi.fn();

    cancelJob(root, JOB_ID, {
      signal: vi.fn(),
      scheduleForce: vi.fn(),
      advanceWorkflow,
    });

    expect(advanceWorkflow).toHaveBeenCalledWith(root, JOB_ID);
  });

  it('contains a workflow notification failure after cancellation', () => {
    writeFileSync(
      join(root, 'data/jobs', `${JOB_ID}.json`),
      JSON.stringify(
        {
          ...record('queued'),
          params: { num: 1, workflow_id: '0123456789abcdef', workflow_step_id: 'step-1' },
        },
        null,
        2,
      ),
    );

    const advanceWorkflow = vi.fn(() => {
      throw new Error('damaged workflow');
    });

    expect(() =>
      cancelJob(root, JOB_ID, {
        signal: vi.fn(),
        scheduleForce: vi.fn(),
        advanceWorkflow,
      }),
    ).not.toThrow();
    expect(advanceWorkflow).toHaveBeenCalledWith(root, JOB_ID);
  });
});
