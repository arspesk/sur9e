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
  loadLatestActiveUpdateJob,
  loadUpdateJob,
  reconcileUpdateJob,
  startUpdateJob,
  type UpdateOrchestratorDeps,
  writeUpdateJob,
} from '../update-orchestrator';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_JOB_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_JOB_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-07-31T12:00:00.000Z');
const LATER = new Date('2026-07-31T12:01:00.000Z');
const FUTURE = new Date('2026-08-01T12:00:00.000Z');
const EARLIER = '2026-07-30T12:00:00.000Z';

const ALL_PHASES = [
  'queued',
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
  'recovery-queued',
  'succeeded',
  'rolled-back',
  'failed',
] as const;

const ACTIVE_WORKER_PHASES = [
  'applying',
  'stopping',
  'rebuilding',
  'restarting',
  'verifying',
  'recovering',
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
  const listeners = new Map<string, (...args: unknown[]) => void>();
  let worker: {
    pid: number;
    once: (event: string, listener: (...args: unknown[]) => void) => typeof worker;
    unref: typeof unref;
  };
  worker = {
    pid: 4242,
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
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
      const listener = listeners.get('error');
      if (!listener) throw new Error('worker error listener was not registered');
      listener(error);
    },
    emitExit(code: number | null, signal: NodeJS.Signals | null = null) {
      const listener = listeners.get('exit');
      if (!listener) throw new Error('worker exit listener was not registered');
      listener(code, signal);
    },
    emitClose(code: number | null, signal: NodeJS.Signals | null = null) {
      const listener = listeners.get('close');
      if (!listener) throw new Error('worker close listener was not registered');
      listener(code, signal);
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

  it('exposes every supported phase', () => {
    expect(UpdateJobPhase.options).toEqual(ALL_PHASES);
  });

  it.each([
    {
      label: 'queued before claim',
      candidate: { ...job('queued'), launchState: 'claim-pending' },
    },
    {
      label: 'queued after claim',
      candidate: { ...job('queued'), launchState: 'owned', pid: 4242 },
    },
    {
      label: 'recovery queued before claim',
      candidate: { ...job('recovery-queued'), launchState: 'claim-pending' },
    },
    ...ACTIVE_WORKER_PHASES.map(phase => ({
      label: `${phase} after claim`,
      candidate: { ...job(phase), launchState: 'owned', pid: 4242 },
    })),
    { label: 'failed before spawn', candidate: { ...job('failed'), error: 'spawn failed' } },
    {
      label: 'failed before claim',
      candidate: { ...job('failed'), launchState: 'claim-pending', error: 'claim expired' },
    },
    {
      label: 'succeeded after claim',
      candidate: { ...job('succeeded'), launchState: 'owned', pid: 4242 },
    },
    { label: 'rolled back without ownership metadata', candidate: job('rolled-back') },
  ])('accepts valid ownership state: $label', ({ candidate }) => {
    expect(UpdateJob.parse(candidate)).toMatchObject(candidate);
  });

  it.each([
    ...ACTIVE_WORKER_PHASES.flatMap(phase => [
      { label: `${phase} without ownership`, candidate: job(phase) },
      {
        label: `${phase} before claim`,
        candidate: { ...job(phase), launchState: 'claim-pending', pid: 4242 },
      },
      { label: `${phase} without pid`, candidate: { ...job(phase), launchState: 'owned' } },
      {
        label: `${phase} with invalid pid`,
        candidate: { ...job(phase), launchState: 'owned', pid: 0 },
      },
    ]),
    {
      label: 'queued ownership without pid',
      candidate: { ...job('queued'), launchState: 'owned' },
    },
    {
      label: 'terminal ownership without pid',
      candidate: { ...job('failed'), launchState: 'owned' },
    },
  ])('rejects invalid ownership state: $label', ({ candidate }) => {
    expect(() => UpdateJob.parse(candidate)).toThrow();
  });

  it('rejects invalid JSON when loading a persisted job', () => {
    const path = join(root, 'data/update/jobs', `${JOB_ID}.json`);
    mkdirSync(join(root, 'data/update/jobs'), { recursive: true });
    writeFileSync(path, '{not-json', { encoding: 'utf-8', flag: 'w' });

    expect(() => loadUpdateJob(root, JOB_ID)).toThrow();
  });

  it('skips damaged records while discovering the latest active job', () => {
    const directory = join(root, 'data/update/jobs');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${JOB_ID}.json`), '{not-json', 'utf-8');
    const active = {
      ...job('queued', SECOND_JOB_ID),
      launchState: 'claim-pending' as const,
      updatedAt: NOW.toISOString(),
    };
    writeUpdateJob(root, active);

    expect(loadLatestActiveUpdateJob(root)).toEqual(active);
  });

  it('skips damaged records when starting a new update', () => {
    const directory = join(root, 'data/update/jobs');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${JOB_ID}.json`), '{not-json', 'utf-8');
    const worker = fakeDeps(SECOND_JOB_ID);

    expect(
      startUpdateJob(
        root,
        { mode: { prod: false, tailscale: false }, fromVersion: '0.3.2' },
        worker.deps,
      ).status,
    ).toBe('started');
    expect(worker.spawn).toHaveBeenCalledTimes(1);
  });

  it('atomically persists jobs under data/update/jobs', () => {
    writeUpdateJob(root, job('queued'));
    writeUpdateJob(root, {
      ...job('applying'),
      launchState: 'owned',
      pid: 4242,
      updatedAt: '2026-07-31T12:01:00.000Z',
    });

    const path = join(root, 'data/update/jobs', `${JOB_ID}.json`);
    expect(loadUpdateJob(root, JOB_ID)).toMatchObject({
      id: JOB_ID,
      phase: 'applying',
      updatedAt: '2026-07-31T12:01:00.000Z',
    });
    expect(existsSync(`${path}.bak`)).toBe(false);
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
        launchState: 'claim-pending',
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
        launchState: 'owned',
        pid: 4242,
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
        launchState: 'owned',
      },
    });
    expect(loadUpdateJob(root, SECOND_JOB_ID)).toMatchObject({
      phase: 'applying',
      updatedAt: LATER.toISOString(),
      pid: 4242,
      launchState: 'owned',
    });
    expect(
      JSON.parse(readFileSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.json`), 'utf-8')),
    ).toMatchObject({
      phase: 'applying',
      updatedAt: LATER.toISOString(),
    });
  });

  it('allows only one spawn when another process interleaves before the first scan', () => {
    const first = fakeDeps(SECOND_JOB_ID);
    const contender = fakeDeps(THIRD_JOB_ID);
    let contenderResult: ReturnType<typeof startUpdateJob> | undefined;
    const mkdirLock = vi.fn((path: string) => {
      mkdirSync(path);
      contenderResult = startUpdateJob(
        root,
        {
          mode: { prod: true, tailscale: false },
          fromVersion: '0.3.2',
        },
        contender.deps,
      );
    });

    const firstResult = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...first.deps, mkdirLock },
    );

    expect(firstResult.status).toBe('started');
    expect(contenderResult).toEqual({ status: 'busy', job: null });
    expect(first.spawn).toHaveBeenCalledTimes(1);
    expect(contender.spawn).not.toHaveBeenCalled();
  });

  it('recovers a start lock whose owner pid is dead', () => {
    const lockDirectory = join(root, 'data/update/start.lock');
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(
      join(lockDirectory, 'owner.json'),
      JSON.stringify({ token: JOB_ID, pid: 98989, acquiredAt: NOW.toISOString() }),
      'utf-8',
    );
    const replacement = fakeDeps(SECOND_JOB_ID);
    const pidAlive = vi.fn(() => false);

    const result = startUpdateJob(
      root,
      {
        mode: { prod: false, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...replacement.deps, pidAlive },
    );

    expect(result.status).toBe('started');
    expect(replacement.spawn).toHaveBeenCalledTimes(1);
    expect(existsSync(lockDirectory)).toBe(false);
  });

  it('permits only one spawn when another process recovers the stale lock first', () => {
    const lockDirectory = join(root, 'data/update/start.lock');
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(
      join(lockDirectory, 'owner.json'),
      JSON.stringify({ token: JOB_ID, pid: 98989, acquiredAt: NOW.toISOString() }),
      'utf-8',
    );
    const first = fakeDeps(SECOND_JOB_ID);
    const contender = fakeDeps(THIRD_JOB_ID);
    const pidAlive = vi.fn((pid: number) => pid === 4242);
    let contenderResult: ReturnType<typeof startUpdateJob> | undefined;
    const mkdirLock = vi.fn((path: string) => {
      try {
        mkdirSync(path);
      } catch (error) {
        contenderResult = startUpdateJob(
          root,
          {
            mode: { prod: true, tailscale: false },
            fromVersion: '0.3.2',
          },
          { ...contender.deps, pidAlive },
        );
        throw error;
      }
    });

    const firstResult = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...first.deps, mkdirLock, pidAlive },
    );

    expect(contenderResult?.status).toBe('started');
    expect(firstResult.status).toBe('busy');
    expect(contender.spawn).toHaveBeenCalledTimes(1);
    expect(first.spawn).not.toHaveBeenCalled();
  });

  it.each([
    'queued',
    'applying',
    'stopping',
    'rebuilding',
    'restarting',
    'verifying',
    'recovering',
    'recovery-queued',
  ])('returns busy instead of spawning when a %s job exists', phase => {
    const active = {
      ...job(phase as (typeof ALL_PHASES)[number]),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      ...(phase === 'queued' || phase === 'recovery-queued'
        ? { launchState: 'claim-pending' as const }
        : { launchState: 'owned' as const, pid: 4242 }),
    };
    writeUpdateJob(root, active);
    const { deps, spawn } = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: false, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...deps, pidAlive: () => true },
    );

    expect(result).toEqual({ status: 'busy', job: active });
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.json`))).toBe(false);
  });

  it('reaps an expired legacy queued lease before starting a replacement job', () => {
    const interrupted = job('queued');
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

  it('reaps a claim-pending job left behind by a crash before spawn', () => {
    const interrupted = { ...job('queued'), launchState: 'claim-pending' as const };
    writeUpdateJob(root, interrupted);
    const replacement = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      replacement.deps,
    );

    expect(result.status).toBe('started');
    expect(replacement.spawn).toHaveBeenCalledTimes(1);
    expect(loadUpdateJob(root, interrupted.id)).toMatchObject({
      phase: 'failed',
      error: 'Update worker did not claim ownership',
      updatedAt: NOW.toISOString(),
    });
  });

  it('marks an expired pre-claim queued job failed when status reconciles it', () => {
    const interrupted = { ...job('queued'), launchState: 'claim-pending' as const };
    writeUpdateJob(root, interrupted);
    const worker = fakeDeps();

    const reconciled = reconcileUpdateJob(root, JOB_ID, worker.deps);

    expect(reconciled).toMatchObject({
      phase: 'failed',
      error: 'Update worker did not claim ownership',
      updatedAt: NOW.toISOString(),
    });
    expect(worker.spawn).not.toHaveBeenCalled();
  });

  it('retries an expired recovery claim instead of leaving it queued forever', () => {
    const interrupted = {
      ...job('recovery-queued'),
      launchState: 'claim-pending' as const,
      checkpoint: 'applied' as const,
      error: 'Update worker stopped before completion',
    };
    writeUpdateJob(root, interrupted);
    const worker = fakeDeps();

    const reconciled = reconcileUpdateJob(root, JOB_ID, worker.deps);

    expect(reconciled).toMatchObject({
      phase: 'recovery-queued',
      launchState: 'claim-pending',
      checkpoint: 'applied',
      updatedAt: NOW.toISOString(),
    });
    expect(worker.spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(root, 'scripts/update-worker.mjs'), '--root', root, '--job-id', JOB_ID, '--recover'],
      expect.objectContaining({ cwd: root, detached: true }),
    );
  });

  it('fails an unclaimed recovery worker that exits abnormally', () => {
    const interrupted = {
      ...job('recovery-queued'),
      launchState: 'claim-pending' as const,
      checkpoint: 'applied' as const,
      error: 'Update worker stopped before completion',
    };
    writeUpdateJob(root, interrupted);
    const worker = fakeDeps(SECOND_JOB_ID, [NOW, LATER]);

    reconcileUpdateJob(root, JOB_ID, worker.deps);
    worker.emitExit(2);

    expect(loadUpdateJob(root, JOB_ID)).toMatchObject({
      phase: 'failed',
      error: 'Update worker exited before completion',
      updatedAt: LATER.toISOString(),
    });
  });

  it('does not steal a fresh claim-pending job during status polling', () => {
    const active = {
      ...job('queued'),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      launchState: 'claim-pending' as const,
    };
    writeUpdateJob(root, active);
    const worker = fakeDeps(SECOND_JOB_ID, [new Date(NOW.getTime() + 1_000)]);

    expect(reconcileUpdateJob(root, JOB_ID, worker.deps)).toEqual(active);
    expect(worker.spawn).not.toHaveBeenCalled();
  });

  it('keeps an expired nonterminal job busy while its persisted worker pid is alive', () => {
    const active = { ...job('rebuilding'), launchState: 'owned' as const, pid: 98989 };
    writeUpdateJob(root, active);
    const replacement = fakeDeps();
    const pidAlive = vi.fn(() => true);

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...replacement.deps, pidAlive },
    );

    expect(result).toEqual({ status: 'busy', job: active });
    expect(pidAlive).toHaveBeenCalledWith(98989);
    expect(replacement.spawn).not.toHaveBeenCalled();
    expect(loadUpdateJob(root, active.id)).toEqual(active);
  });

  it('queues recovery instead of replacing a job whose worker died after mutation began', () => {
    const interrupted = {
      ...job('applying'),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      launchState: 'owned' as const,
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

    expect(result.status).toBe('busy');
    expect(pidAlive).toHaveBeenCalledWith(98989);
    expect(loadUpdateJob(root, interrupted.id)).toMatchObject({
      phase: 'recovery-queued',
      launchState: 'claim-pending',
      error: 'Update worker stopped before completion',
      updatedAt: NOW.toISOString(),
    });
    expect(replacement.spawn).toHaveBeenCalledWith(
      process.execPath,
      [join(root, 'scripts/update-worker.mjs'), '--root', root, '--job-id', JOB_ID, '--recover'],
      expect.objectContaining({ cwd: root, detached: true }),
    );
    expect(existsSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.json`))).toBe(false);
  });

  it('does not steal a recovery sidecar from another live worker', () => {
    const interrupted = {
      ...job('stopping'),
      launchState: 'owned' as const,
      pid: 98989,
      checkpoint: 'applied' as const,
    };
    writeUpdateJob(root, interrupted);
    writeFileSync(join(root, 'data/update/jobs', `${JOB_ID}.pid`), '77777\n');
    const replacement = fakeDeps();

    const result = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...replacement.deps, pidAlive: pid => pid === 77777 },
    );

    expect(result).toEqual({ status: 'busy', job: interrupted });
    expect(replacement.spawn).not.toHaveBeenCalled();
    expect(readFileSync(join(root, 'data/update/jobs', `${JOB_ID}.pid`), 'utf-8')).toBe('77777\n');
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
    if (failed.status !== 'failed') throw new Error('expected failed update launch');
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

  it('persists an abnormal child exit as failed and permits retry', () => {
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

    first.emitExit(2);

    expect(loadUpdateJob(root, SECOND_JOB_ID)).toMatchObject({
      phase: 'failed',
      error: 'Update worker exited before completion',
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

  it('does not overwrite a terminal job when an abnormal child close arrives late', () => {
    const first = fakeDeps(SECOND_JOB_ID, [NOW, LATER]);
    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      first.deps,
    );
    if (started.status !== 'started') throw new Error('expected update launch');
    writeUpdateJob(root, {
      ...started.job,
      phase: 'succeeded',
      updatedAt: LATER.toISOString(),
    });

    first.emitClose(null, 'SIGTERM');

    expect(loadUpdateJob(root, SECOND_JOB_ID)).toMatchObject({
      phase: 'succeeded',
      updatedAt: LATER.toISOString(),
    });
  });

  it('reaps a worker that never claims a pid and permits retry after the claim lease', () => {
    const first = fakeDeps(SECOND_JOB_ID);
    const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>((...args) => {
      const worker = first.spawn(...args);
      return { once: worker.once.bind(worker), unref: worker.unref.bind(worker) };
    });

    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...first.deps, spawn },
    );

    expect(started).toMatchObject({
      status: 'started',
      job: { phase: 'queued', launchState: 'claim-pending' },
    });
    const retry = fakeDeps(THIRD_JOB_ID, [FUTURE]);
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
    expect(retry.spawn).toHaveBeenCalledTimes(1);
  });

  it('ignores an invalid parent-observed pid and recovers through the claim lease', () => {
    const first = fakeDeps(SECOND_JOB_ID);
    const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>((...args) => ({
      ...first.spawn(...args),
      pid: 0,
    }));

    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...first.deps, spawn },
    );

    expect(started).toMatchObject({
      status: 'started',
      job: { phase: 'queued', launchState: 'claim-pending' },
    });
    const retry = fakeDeps(THIRD_JOB_ID, [FUTURE]);
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
    expect(retry.spawn).toHaveBeenCalledTimes(1);
  });

  it('leaves pid claiming to the worker instead of persisting the parent-observed pid', () => {
    const first = fakeDeps(SECOND_JOB_ID);

    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      first.deps,
    );

    expect(started).toMatchObject({
      status: 'started',
      job: { phase: 'queued', launchState: 'claim-pending' },
    });
    expect(existsSync(join(root, 'data/update/jobs', `${SECOND_JOB_ID}.pid`))).toBe(false);
    expect(loadUpdateJob(root, SECOND_JOB_ID)).not.toHaveProperty('pid');
  });

  it('keeps launch ownership nonterminal when the post-spawn reload fails', () => {
    const first = fakeDeps(SECOND_JOB_ID);
    const reloadJob = vi.fn(() => {
      throw new Error('reload unavailable');
    });

    const started = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      { ...first.deps, reloadJob },
    );

    expect(reloadJob).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({
      status: 'started',
      job: { phase: 'queued', launchState: 'claim-pending' },
    });
    const retry = fakeDeps(THIRD_JOB_ID, [FUTURE]);
    const retryResult = startUpdateJob(
      root,
      {
        mode: { prod: true, tailscale: false },
        fromVersion: '0.3.2',
      },
      retry.deps,
    );
    expect(retryResult.status).toBe('started');
    expect(retry.spawn).toHaveBeenCalledTimes(1);
  });
});
