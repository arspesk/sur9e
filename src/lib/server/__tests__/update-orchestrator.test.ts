import {
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateJob, UpdateJobPhase } from '../../schemas/update-job';
import {
  loadUpdateJob,
  startUpdateJob,
  type UpdateOrchestratorDeps,
  writeUpdateJob,
} from '../update-orchestrator';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_JOB_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_JOB_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-07-31T12:00:00.000Z');
const LATER = new Date('2026-07-31T12:01:00.000Z');
const EARLIER = '2026-07-30T12:00:00.000Z';

const ALL_PHASES = [
  'queued',
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

function job(phase: (typeof ALL_PHASES)[number] = 'queued', id = JOB_ID) {
  return {
    id,
    phase,
    mode: { prod: true, tailscale: false },
    fromVersion: '0.3.2',
    toVersion: '0.4.0',
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };
}

function fakeDeps(id = SECOND_JOB_ID, clockValues: Date[] = [NOW]) {
  const unref = vi.fn();
  let errorListener: ((error: Error) => void) | undefined;
  let worker: {
    pid: number;
    once: (event: 'error', listener: (error: Error) => void) => typeof worker;
    unref: typeof unref;
  };
  worker = {
    pid: 4242,
    once: vi.fn((event: 'error', listener: (error: Error) => void) => {
      if (event === 'error') errorListener = listener;
      return worker;
    }),
    unref,
  };
  const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>(() => worker);
  let clockIndex = 0;
  return {
    deps: {
      clock: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)] ?? NOW,
      uuid: () => id,
      spawn,
    },
    emitError(error: Error) {
      if (!errorListener) throw new Error('worker error listener was not registered');
      errorListener(error);
    },
    spawn,
    unref,
  };
}

describe('update-job durable contract', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'update-orchestrator-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts every supported phase and parses the complete job shape', () => {
    expect(UpdateJobPhase.options).toEqual(ALL_PHASES);

    for (const phase of ALL_PHASES) {
      expect(
        UpdateJob.parse({ ...job(phase), error: phase === 'failed' ? 'build failed' : undefined }),
      ).toMatchObject({
        id: JOB_ID,
        phase,
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
        toVersion: '0.4.0',
        createdAt: EARLIER,
        updatedAt: EARLIER,
      });
    }
  });

  it('parses an optional persisted worker pid', () => {
    expect(UpdateJob.parse({ ...job('applying'), pid: 4242 })).toMatchObject({
      id: JOB_ID,
      phase: 'applying',
      pid: 4242,
    });
  });

  it('rejects invalid JSON when loading a persisted job', () => {
    const path = join(root, 'data/update/jobs', `${JOB_ID}.json`);
    mkdirSync(join(root, 'data/update/jobs'), { recursive: true });
    writeFileSync(path, '{not-json', { encoding: 'utf-8', flag: 'w' });

    expect(() => loadUpdateJob(root, JOB_ID)).toThrow();
  });

  it('atomically persists jobs under data/update/jobs', () => {
    writeUpdateJob(root, job('queued'));
    writeUpdateJob(root, {
      ...job('applying'),
      updatedAt: '2026-07-31T12:01:00.000Z',
    });

    const path = join(root, 'data/update/jobs', `${JOB_ID}.json`);
    expect(loadUpdateJob(root, JOB_ID)).toMatchObject({
      id: JOB_ID,
      phase: 'applying',
      updatedAt: '2026-07-31T12:01:00.000Z',
    });
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf-8'))).toMatchObject({
      id: JOB_ID,
      phase: 'queued',
    });
    expect(readdirSync(join(root, 'data/update/jobs')).some(file => file.endsWith('.tmp'))).toBe(
      false,
    );
  });

  it('starts a new detached worker when existing jobs are terminal', () => {
    writeUpdateJob(root, job('succeeded'));
    const { deps, spawn, unref } = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: true },
        fromVersion: '0.3.2',
        toVersion: '0.4.0',
      },
      deps,
    );

    expect(result).toEqual({
      status: 'started',
      job: {
        id: SECOND_JOB_ID,
        phase: 'queued',
        mode: { prod: true, tailscale: true },
        fromVersion: '0.3.2',
        toVersion: '0.4.0',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        pid: 4242,
      },
    });
    expect(loadUpdateJob(root, SECOND_JOB_ID)).toEqual(result.job);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(root, 'scripts/update-worker.mjs'), '--root', root, '--job-id', SECOND_JOB_ID],
      expect.objectContaining({
        cwd: root,
        detached: true,
        stdio: ['ignore', expect.any(Number), expect.any(Number)],
      }),
    );
    const spawnOptions = spawn.mock.calls[0]?.[2];
    expect(spawnOptions?.stdio[1]).toBe(spawnOptions?.stdio[2]);
    expect(existsSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.log`))).toBe(true);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('does not regress worker progress when spawn advances the persisted phase before returning', () => {
    const workerHarness = fakeDeps(SECOND_JOB_ID);
    const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>((...args) => {
      const queued = loadUpdateJob(root, SECOND_JOB_ID);
      expect(queued).not.toBeNull();
      writeUpdateJob(root, {
        ...(queued as NonNullable<typeof queued>),
        phase: 'applying',
        updatedAt: LATER.toISOString(),
      });
      return workerHarness.spawn(...args);
    });

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...workerHarness.deps, spawn },
    );

    expect(result).toMatchObject({
      status: 'started',
      job: {
        id: SECOND_JOB_ID,
        phase: 'applying',
        updatedAt: LATER.toISOString(),
        pid: 4242,
      },
    });
    expect(loadUpdateJob(root, SECOND_JOB_ID)).toMatchObject({
      phase: 'applying',
      updatedAt: LATER.toISOString(),
      pid: 4242,
    });
    expect(
      JSON.parse(readFileSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.json`), 'utf-8')),
    ).toMatchObject({
      phase: 'applying',
      updatedAt: LATER.toISOString(),
    });
  });

  it.each([
    'queued',
    'applying',
    'stopping',
    'rebuilding',
    'restarting',
    'verifying',
    'recovering',
  ])('returns busy instead of spawning when a %s job exists', phase => {
    const active = {
      ...job(phase as (typeof ALL_PHASES)[number]),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    writeUpdateJob(root, active);
    const { deps, spawn } = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: false, tailscale: false },
        fromVersion: '0.3.2',
      },
      deps,
    );

    expect(result).toEqual({ status: 'busy', job: active });
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.json`))).toBe(false);
  });

  it('reaps an expired nonterminal lease before starting a replacement job', () => {
    const interrupted = job('rebuilding');
    writeUpdateJob(root, interrupted);
    const { deps, spawn } = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      deps,
    );

    expect(result.status).toBe('started');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(loadUpdateJob(root, interrupted.id)).toMatchObject({
      phase: 'failed',
      error: 'Update worker lease expired',
      updatedAt: NOW.toISOString(),
    });
  });

  it('reaps a fresh nonterminal job whose persisted worker pid is no longer alive', () => {
    const interrupted = {
      ...job('applying'),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      pid: 98989,
    };
    writeUpdateJob(root, interrupted);
    const replacement = fakeDeps();
    const pidAlive = vi.fn(() => false);

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...replacement.deps, pidAlive },
    );

    expect(result.status).toBe('started');
    expect(pidAlive).toHaveBeenCalledWith(98989);
    expect(loadUpdateJob(root, interrupted.id)).toMatchObject({
      phase: 'failed',
      error: 'Update worker stopped before completion',
      updatedAt: NOW.toISOString(),
    });
  });

  it('persists a safe failure when the job log cannot be opened, then permits retry', () => {
    const logPath = join(root, 'data/update/jobs', `${SECOND_JOB_ID}.log`);
    mkdirSync(logPath, { recursive: true });
    const first = fakeDeps(SECOND_JOB_ID, [NOW, LATER]);

    const failed = startUpdateJob(
      root,
      {
        mode: { prod: false, tailscale: false },
        fromVersion: '0.3.2',
      },
      first.deps,
    );

    expect(failed).toMatchObject({
      status: 'failed',
      job: {
        id: SECOND_JOB_ID,
        phase: 'failed',
        error: 'Update worker failed to start',
        updatedAt: LATER.toISOString(),
      },
    });
    expect(loadUpdateJob(root, SECOND_JOB_ID)).toEqual(failed.job);

    rmSync(logPath, { recursive: true });
    const retry = fakeDeps(THIRD_JOB_ID);
    expect(
      startUpdateJob(
        root,
        {
          mode: { prod: false, tailscale: false },
          fromVersion: '0.3.2',
        },
        retry.deps,
      ).status,
    ).toBe('started');
  });

  it('closes the log and persists a safe failure when spawn throws, then permits retry', () => {
    let logFileDescriptor: number | undefined;
    const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>((_command, _args, options) => {
      logFileDescriptor = options.stdio[1];
      throw new Error('secret operating-system detail');
    });
    const clock = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(LATER);

    const failed = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { clock, uuid: () => SECOND_JOB_ID, spawn },
    );

    expect(failed).toMatchObject({
      status: 'failed',
      job: {
        phase: 'failed',
        error: 'Update worker failed to start',
        updatedAt: LATER.toISOString(),
      },
    });
    expect(failed.job.error).not.toContain('secret');
    expect(() => fstatSync(logFileDescriptor as number)).toThrow();

    const retry = fakeDeps(THIRD_JOB_ID);
    expect(
      startUpdateJob(
        root,
        {
          mode: { prod: true, tailscale: false },
          fromVersion: '0.3.2',
        },
        retry.deps,
      ).status,
    ).toBe('started');
  });

  it('persists an asynchronous child error as failed and permits retry', () => {
    const first = fakeDeps(SECOND_JOB_ID, [NOW, LATER]);
    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: true },
        fromVersion: '0.3.2',
      },
      first.deps,
    );
    expect(started.status).toBe('started');

    first.emitError(new Error('secret child-process detail'));

    expect(loadUpdateJob(root, SECOND_JOB_ID)).toMatchObject({
      phase: 'failed',
      error: 'Update worker failed to start',
      updatedAt: LATER.toISOString(),
    });
    const retry = fakeDeps(THIRD_JOB_ID);
    expect(
      startUpdateJob(
        root,
        {
          mode: { prod: true, tailscale: true },
          fromVersion: '0.3.2',
        },
        retry.deps,
      ).status,
    ).toBe('started');
  });
});
