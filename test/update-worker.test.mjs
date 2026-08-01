import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runUpdateRestartJob } from '../scripts/update-worker.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-07-31T20:00:00.000Z');

function makeRoot(mode = { prod: false, tailscale: false }) {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-update-worker-'));
  const directory = join(root, 'data/update/jobs');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${JOB_ID}.json`),
    `${JSON.stringify({
      id: JOB_ID,
      phase: 'queued',
      launchState: 'claim-pending',
      mode,
      fromVersion: '0.3.2',
      toVersion: '0.4.0',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })}\n`,
  );
  return root;
}

function queuedJob(root) {
  return JSON.parse(readFileSync(join(root, 'data/update/jobs', `${JOB_ID}.json`), 'utf-8'));
}

function harness(root, overrides = {}) {
  const states = [];
  const runCommand = vi.fn().mockResolvedValue(undefined);
  const waitForHealth = vi.fn().mockResolvedValue(undefined);
  return {
    states,
    runCommand,
    waitForHealth,
    deps: {
      pid: 4242,
      clock: () => NOW,
      runCommand,
      waitForHealth,
      claimPid: vi.fn(),
      persistJob: (_root, job) => states.push(structuredClone(job)),
      ...overrides,
    },
  };
}

describe('runUpdateRestartJob', () => {
  it('runs the dev update through every phase and verifies local health', async () => {
    const root = makeRoot();
    const { states, runCommand, waitForHealth, deps } = harness(root);

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'succeeded' });
    expect(states.map(job => job.phase)).toEqual([
      'applying',
      'stopping',
      'restarting',
      'verifying',
      'succeeded',
    ]);
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toEqual([
      [process.execPath, [join(root, 'update-system.mjs'), 'apply']],
      [process.execPath, [join(root, 'scripts/web.mjs'), 'stop']],
      [process.execPath, [join(root, 'scripts/web.mjs'), '--detach']],
    ]);
    expect(waitForHealth).toHaveBeenCalledWith('http://127.0.0.1:3000', {
      timeoutMs: 120_000,
      intervalMs: 1_000,
    });
  });

  it.each([
    { label: 'dev', mode: { prod: false, tailscale: false }, args: ['--detach'], build: false },
    {
      label: 'dev + Tailscale',
      mode: { prod: false, tailscale: true },
      args: ['--dev', '--tailscale', '--detach'],
      build: false,
    },
    {
      label: 'prod',
      mode: { prod: true, tailscale: false },
      args: ['--prod', '--detach'],
      build: true,
    },
    {
      label: 'prod + Tailscale',
      mode: { prod: true, tailscale: true },
      args: ['--prod', '--tailscale', '--detach'],
      build: true,
    },
  ])('preserves $label mode with argument arrays', async ({ mode, args, build }) => {
    const root = makeRoot(mode);
    const { runCommand, deps } = harness(root);

    await runUpdateRestartJob(root, JOB_ID, deps);

    const calls = runCommand.mock.calls;
    const startCall = calls.find(
      ([, commandArgs]) =>
        commandArgs[0] === join(root, 'scripts/web.mjs') && commandArgs[1] !== 'stop',
    );
    expect(startCall[0]).toBe(process.execPath);
    expect(startCall[1]).toEqual([join(root, 'scripts/web.mjs'), ...args]);
    expect(startCall[2]).toMatchObject({ cwd: root });
    if (mode.prod) expect(startCall[2].env.SUR9E_WEB_SKIP_BUILD).toBe('1');
    else expect(startCall[2]).not.toHaveProperty('env');
    expect(
      calls.some(
        ([command, commandArgs]) => command === 'npm' && commandArgs.join(' ') === 'run build',
      ),
    ).toBe(build);
  });

  it('aborts before loading or mutating the job when the PID claim fails', async () => {
    const root = makeRoot();
    const original = queuedJob(root);
    const claimPid = vi.fn(() => {
      throw new Error('already claimed');
    });
    const persistJob = vi.fn();
    const { runCommand, waitForHealth, deps } = harness(root, { claimPid, persistJob });

    await expect(runUpdateRestartJob(root, JOB_ID, deps)).resolves.toEqual({ status: 'failed' });

    expect(claimPid).toHaveBeenCalledOnce();
    expect(persistJob).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(waitForHealth).not.toHaveBeenCalled();
    expect(queuedJob(root)).toEqual(original);
  });

  it('uses an exclusive PID sidecar claim without replacing another worker owner', async () => {
    const root = makeRoot();
    const sidecar = join(root, 'data/update/jobs', `${JOB_ID}.pid`);
    writeFileSync(sidecar, '31337\n');
    const { runCommand, waitForHealth } = harness(root);

    const result = await runUpdateRestartJob(root, JOB_ID, {
      pid: 4242,
      clock: () => NOW,
      runCommand,
      waitForHealth,
    });

    expect(result).toEqual({ status: 'failed' });
    expect(readFileSync(sidecar, 'utf-8')).toBe('31337\n');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('marks apply failure failed without stopping or attempting rollback', async () => {
    const root = makeRoot();
    const { states, runCommand, deps } = harness(root);
    runCommand.mockRejectedValueOnce(new Error('token=do-not-persist command details'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'failed' });
    expect(states.map(job => job.phase)).toEqual(['applying', 'failed']);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][1]).toEqual([join(root, 'update-system.mjs'), 'apply']);
    expect(states.at(-1).error).toBe('Update failed while applying the new version');
  });

  it.each([
    { stage: 'stopping', mode: { prod: false, tailscale: false }, failCommand: 'stop' },
    { stage: 'rebuilding', mode: { prod: true, tailscale: false }, failCommand: 'run build' },
    { stage: 'restarting', mode: { prod: false, tailscale: true }, failCommand: 'web start' },
    { stage: 'verifying', mode: { prod: false, tailscale: false }, failCommand: 'health' },
  ])('rolls back safely when $stage fails', async ({ stage, mode, failCommand }) => {
    const root = makeRoot(mode);
    const { states, runCommand, waitForHealth, deps } = harness(root);
    let failed = false;
    runCommand.mockImplementation(async (_command, args) => {
      const label =
        args[1] === 'stop'
          ? 'stop'
          : args.join(' ') === 'run build'
            ? 'run build'
            : args[0] === join(root, 'scripts/web.mjs')
              ? 'web start'
              : '';
      if (!failed && label === failCommand) {
        failed = true;
        throw new Error('secret output with command details');
      }
    });
    if (failCommand === 'health') waitForHealth.mockRejectedValueOnce(new Error('secret health'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'rolled-back' });
    expect(states.map(job => job.phase)).toContain('recovering');
    expect(states.at(-1).phase).toBe('rolled-back');
    expect(states.at(-1).error).toBe(`Update restart failed while ${stage}`);
    expect(runCommand.mock.calls.map(([, args]) => args)).toContainEqual([
      join(root, 'update-system.mjs'),
      'rollback',
    ]);
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toContainEqual([
      'npm',
      ['install', '--silent'],
    ]);
    const finalStart = runCommand.mock.calls
      .filter(([, args]) => args[0] === join(root, 'scripts/web.mjs') && args[1] !== 'stop')
      .at(-1);
    expect(finalStart[1]).toEqual([
      join(root, 'scripts/web.mjs'),
      ...(mode.prod ? ['--prod'] : mode.tailscale ? ['--dev'] : []),
      ...(mode.tailscale ? ['--tailscale'] : []),
      '--detach',
    ]);
    if (mode.prod) expect(finalStart[2].env.SUR9E_WEB_SKIP_BUILD).toBe('1');
    expect(waitForHealth).toHaveBeenLastCalledWith('http://127.0.0.1:3000', {
      timeoutMs: 120_000,
      intervalMs: 1_000,
    });
  });

  it('stops an unhealthy new server before rolling back and restarting the old version', async () => {
    const root = makeRoot({ prod: true, tailscale: true });
    const { states, runCommand, waitForHealth, deps } = harness(root);
    let serverRunning = false;
    let stopCount = 0;
    runCommand.mockImplementation(async (_command, args) => {
      if (args[1] === 'stop') {
        stopCount += 1;
        serverRunning = false;
      } else if (args[0] === join(root, 'scripts/web.mjs')) {
        if (serverRunning) throw new Error('port occupied by unhealthy new server');
        serverRunning = true;
      }
    });
    waitForHealth.mockRejectedValueOnce(new Error('new server is unhealthy'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'rolled-back' });
    expect(stopCount).toBe(2);
    expect(serverRunning).toBe(true);
    expect(states.at(-1)).toMatchObject({
      phase: 'rolled-back',
      error: 'Update restart failed while verifying',
    });
    const commandArgs = runCommand.mock.calls.map(([, args]) => args);
    expect(commandArgs.indexOf(commandArgs.find(args => args[1] === 'rollback'))).toBeGreaterThan(
      commandArgs.map(args => args[1]).lastIndexOf('stop'),
    );
  });

  it('marks recovery failed when the unhealthy updated server cannot be stopped', async () => {
    const root = makeRoot();
    const { states, runCommand, waitForHealth, deps } = harness(root);
    let stopCount = 0;
    runCommand.mockImplementation(async (_command, args) => {
      if (args[1] === 'stop' && ++stopCount === 2) {
        throw new Error('private listener details');
      }
    });
    waitForHealth.mockRejectedValueOnce(new Error('new server is unhealthy'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'failed' });
    expect(states.map(job => job.phase)).toEqual([
      'applying',
      'stopping',
      'restarting',
      'verifying',
      'recovering',
      'failed',
    ]);
    expect(states.at(-1).error).toBe(
      'Update restart failed while verifying; recovery failed while stopping the updated server',
    );
    expect(runCommand.mock.calls.map(([, args]) => args)).not.toContainEqual([
      join(root, 'update-system.mjs'),
      'rollback',
    ]);
  });

  it.each([
    { recoveryStage: 'rollback', mode: { prod: false, tailscale: false }, failCommand: 'rollback' },
    {
      recoveryStage: 'install',
      mode: { prod: false, tailscale: false },
      failCommand: 'install --silent',
    },
    {
      recoveryStage: 'rebuild',
      mode: { prod: true, tailscale: false },
      failCommand: 'second build',
    },
    { recoveryStage: 'restart', mode: { prod: false, tailscale: true }, failCommand: 'web start' },
    {
      recoveryStage: 'verification',
      mode: { prod: false, tailscale: false },
      failCommand: 'health',
    },
  ])('marks the job failed when recovery $recoveryStage fails', async ({ mode, failCommand }) => {
    const root = makeRoot(mode);
    const { states, runCommand, waitForHealth, deps } = harness(root);
    let buildCount = 0;
    runCommand.mockImplementation(async (_command, args) => {
      if (args[1] === 'stop') throw new Error('original private failure');
      const label = args.join(' ');
      if (label === 'run build') buildCount += 1;
      const recoveryFailure =
        (failCommand === 'rollback' && args[1] === 'rollback') ||
        (failCommand === 'install --silent' && label === 'install --silent') ||
        (failCommand === 'second build' && label === 'run build' && buildCount === 1) ||
        (failCommand === 'web start' &&
          args[0] === join(root, 'scripts/web.mjs') &&
          args[1] !== 'stop');
      if (recoveryFailure) throw new Error('recovery secret with command details');
    });
    if (failCommand === 'health') waitForHealth.mockRejectedValueOnce(new Error('health secret'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'failed' });
    expect(states.map(job => job.phase)).toEqual(['applying', 'stopping', 'recovering', 'failed']);
    expect(states.at(-1).error).toMatch(
      /^Update restart failed while stopping; recovery failed while /,
    );
    expect(states.at(-1).error).not.toMatch(/secret|private|token=/);
  });

  it('atomically persists validated terminal state and the claimed PID with no temp residue', async () => {
    const root = makeRoot();
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const waitForHealth = vi.fn().mockResolvedValue(undefined);

    await runUpdateRestartJob(root, JOB_ID, {
      pid: 4242,
      clock: () => NOW,
      runCommand,
      waitForHealth,
    });

    expect(queuedJob(root)).toMatchObject({
      id: JOB_ID,
      phase: 'succeeded',
      launchState: 'owned',
      pid: 4242,
    });
    expect(readFileSync(join(root, 'data/update/jobs', `${JOB_ID}.pid`), 'utf-8')).toBe('4242\n');
    expect(
      readdirSync(join(root, 'data/update/jobs')).filter(file => file.endsWith('.tmp')),
    ).toEqual([]);
  });
});
