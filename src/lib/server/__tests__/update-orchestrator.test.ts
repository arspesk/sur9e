import {
  existsSync,
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
const NOW = new Date('2026-07-31T12:00:00.000Z');
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

function fakeDeps(id = SECOND_JOB_ID) {
  const unref = vi.fn();
  const spawn = vi.fn<UpdateOrchestratorDeps['spawn']>(() => ({ unref }));
  return {
    deps: {
      clock: () => NOW,
      uuid: () => id,
      spawn,
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

  it.each([
    'queued',
    'applying',
    'stopping',
    'rebuilding',
    'restarting',
    'verifying',
    'recovering',
  ])('returns busy instead of spawning when a %s job exists', phase => {
    const active = job(phase as (typeof ALL_PHASES)[number]);
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
});
