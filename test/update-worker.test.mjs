import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  recoverInterruptedUpdateOnStartup,
  runUpdateRestartJob,
  waitForSur9eHealth,
} from '../scripts/update-worker.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-07-31T20:00:00.000Z');
const RECOVERY_STAGE_TEXT = {
  rollback: 'rolling back the checkout',
  install: 'installing previous dependencies',
  rebuild: 'rebuilding the previous version',
  restart: 'restarting the previous version',
  verification: 'verifying the previous version',
};

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
  const validateRuntime = vi.fn().mockResolvedValue(undefined);
  return {
    states,
    runCommand,
    waitForHealth,
    validateRuntime,
    deps: {
      pid: 4242,
      clock: () => NOW,
      runCommand,
      waitForHealth,
      validateRuntime,
      claimPid: vi.fn(),
      readLaunchIdentity: vi.fn(() => ({ launchId: 'launch-123' })),
      readVersion: vi.fn(() => '0.4.0'),
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
    expect(waitForHealth).toHaveBeenCalledWith('http://127.0.0.1:3000/api/version', {
      timeoutMs: 120_000,
      intervalMs: 1_000,
      expectedVersion: '0.4.0',
      launchId: 'launch-123',
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
      readLaunchIdentity: () => ({ launchId: 'launch-123' }),
    });

    expect(result).toEqual({ status: 'failed' });
    expect(readFileSync(sidecar, 'utf-8')).toBe('31337\n');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('routes apply failure through automatic rollback and recovery', async () => {
    const root = makeRoot();
    const { states, runCommand, deps } = harness(root);
    runCommand.mockRejectedValueOnce(new Error('token=do-not-persist command details'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'rolled-back' });
    expect(states.map(job => job.phase)).toEqual([
      'applying',
      'recovering',
      'recovering',
      'recovering',
      'recovering',
      'rolled-back',
    ]);
    expect(runCommand.mock.calls[0][1]).toEqual([join(root, 'update-system.mjs'), 'apply']);
    expect(runCommand.mock.calls.map(([, args]) => args)).toContainEqual([
      join(root, 'update-system.mjs'),
      'rollback',
    ]);
    expect(states.at(-1).error).toBe('Update failed while applying the new version');
  });

  it('restores build dependencies during production-server recovery', async () => {
    const root = makeRoot({ prod: true, tailscale: true });
    const { runCommand, deps } = harness(root);
    runCommand.mockRejectedValueOnce(new Error('apply failed'));

    await runUpdateRestartJob(root, JOB_ID, deps);

    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toContainEqual([
      'npm',
      ['ci', '--include=dev', '--no-audit', '--no-fund'],
    ]);
  });

  it('does not roll back a stale backup when apply fails before checkout', async () => {
    const root = makeRoot();
    const { states, runCommand, deps } = harness(root);
    runCommand.mockRejectedValueOnce(
      Object.assign(new Error('fetch failed before checkout'), { exitCode: 2 }),
    );

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'failed' });
    expect(states.map(job => job.phase)).toEqual(['applying', 'failed']);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0][1]).toEqual([join(root, 'update-system.mjs'), 'apply']);
    expect(states.at(-1).error).toBe('Update failed before changing system files');
  });

  it('fails before apply without rollback when the worker runtime is unsupported', async () => {
    const root = makeRoot();
    const { states, runCommand, waitForHealth, validateRuntime, deps } = harness(root);
    validateRuntime.mockRejectedValueOnce(new Error('npm is unavailable'));

    const result = await runUpdateRestartJob(root, JOB_ID, deps);

    expect(result).toEqual({ status: 'failed' });
    expect(states.map(job => job.phase)).toEqual(['failed']);
    expect(states.at(-1).error).toBe('Update requires Node 24+ and a working npm installation');
    expect(runCommand).not.toHaveBeenCalled();
    expect(waitForHealth).not.toHaveBeenCalled();
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
      ['ci', '--include=dev', '--no-audit', '--no-fund'],
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
    expect(waitForHealth).toHaveBeenLastCalledWith('http://127.0.0.1:3000/api/version', {
      timeoutMs: 120_000,
      intervalMs: 1_000,
      expectedVersion: '0.3.2',
      launchId: 'launch-123',
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
      failCommand: 'ci --include=dev --no-audit --no-fund',
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
  ])(
    'marks the job failed when recovery $recoveryStage fails',
    async ({ recoveryStage, mode, failCommand }) => {
      const root = makeRoot(mode);
      const { states, runCommand, waitForHealth, deps } = harness(root);
      let buildCount = 0;
      let startCount = 0;
      runCommand.mockImplementation(async (_command, args) => {
        const label = args.join(' ');
        if (label === 'run build') buildCount += 1;
        if (args[0] === join(root, 'scripts/web.mjs') && args[1] !== 'stop') startCount += 1;
        const recoveryFailure =
          (failCommand === 'rollback' && args[1] === 'rollback') ||
          (failCommand === 'ci --include=dev --no-audit --no-fund' &&
            label === 'ci --include=dev --no-audit --no-fund') ||
          (failCommand === 'second build' && label === 'run build' && buildCount === 2) ||
          (failCommand === 'web start' && startCount === 2);
        if (recoveryFailure) throw new Error('recovery secret with command details');
      });
      waitForHealth.mockRejectedValueOnce(new Error('original private health failure'));
      if (failCommand === 'health') {
        waitForHealth.mockRejectedValueOnce(new Error('recovery secret health failure'));
      }

      const result = await runUpdateRestartJob(root, JOB_ID, deps);

      expect(result).toEqual({ status: 'failed' });
      expect(states.at(-1).phase).toBe('failed');
      expect(states.at(-1).error).toBe(
        `Update restart failed while verifying; recovery failed while ${RECOVERY_STAGE_TEXT[recoveryStage]}`,
      );
      expect(states.at(-1).error).not.toMatch(/secret|private|token=/);
    },
  );

  it('atomically persists validated terminal state and the claimed PID with no temp residue', async () => {
    const root = makeRoot();
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const waitForHealth = vi.fn().mockResolvedValue(undefined);

    await runUpdateRestartJob(root, JOB_ID, {
      pid: 4242,
      clock: () => NOW,
      runCommand,
      waitForHealth,
      validateRuntime: vi.fn().mockResolvedValue(undefined),
      readLaunchIdentity: () => ({ launchId: 'launch-123' }),
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

  it.each([
    { checkpoint: 'apply-started', installedVersion: '0.3.2', expectsRollback: true },
    { checkpoint: 'applied', installedVersion: '0.4.0', expectsRollback: true },
    { checkpoint: 'server-stopped', installedVersion: '0.4.0', expectsRollback: true },
    { checkpoint: 'server-restarted', installedVersion: '0.4.0', expectsRollback: true },
    { checkpoint: 'rollback-complete', installedVersion: '0.3.2', expectsRollback: false },
    { checkpoint: 'dependencies-restored', installedVersion: '0.4.0', expectsRollback: false },
    { checkpoint: 'recovery-build-complete', installedVersion: '0.4.0', expectsRollback: false },
    { checkpoint: 'recovery-server-started', installedVersion: '0.4.0', expectsRollback: false },
  ])(
    'recovers an interrupted update from $checkpoint at v$installedVersion without applying again',
    async ({ checkpoint, installedVersion, expectsRollback }) => {
      const root = makeRoot();
      const interrupted = queuedJob(root);
      writeFileSync(
        join(root, 'data/update/jobs', `${JOB_ID}.json`),
        `${JSON.stringify({
          ...interrupted,
          phase: 'recovery-queued',
          launchState: 'claim-pending',
          checkpoint,
          error: 'Update worker stopped before completion',
        })}\n`,
      );
      const { runCommand, deps } = harness(root, {
        readVersion: vi.fn(() => installedVersion),
      });

      const result = await runUpdateRestartJob(root, JOB_ID, deps, { recoveryOnly: true });

      expect(result).toEqual({ status: 'rolled-back' });
      const calls = runCommand.mock.calls.map(([, args]) => args);
      expect(calls).not.toContainEqual([join(root, 'update-system.mjs'), 'apply']);
      expect(calls).toContainEqual(['ci', '--include=dev', '--no-audit', '--no-fund']);
      expect(calls).toContainEqual([join(root, 'scripts/web.mjs'), '--detach']);
      const rollbackCalls = calls.filter(
        args => args[0] === join(root, 'update-system.mjs') && args[1] === 'rollback',
      );
      expect(rollbackCalls).toHaveLength(expectsRollback ? 1 : 0);
    },
  );
});

describe('waitForSur9eHealth', () => {
  it('accepts only the expected Sur9e version and launch identity', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({ version: '0.4.0', launchId: 'foreign-launch' }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json({ version: '0.4.0', launchId: 'launch-123' }, { status: 200 }),
      );

    await expect(
      waitForSur9eHealth('http://127.0.0.1:3000/api/version', {
        timeoutMs: 100,
        intervalMs: 1,
        expectedVersion: '0.4.0',
        launchId: 'launch-123',
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('times out when another service answers successfully', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ version: '9.9.9', launchId: 'other' }));

    await expect(
      waitForSur9eHealth('http://127.0.0.1:3000/api/version', {
        timeoutMs: 5,
        intervalMs: 1,
        expectedVersion: '0.4.0',
        launchId: 'launch-123',
        fetchImpl,
      }),
    ).rejects.toThrow('Health verification timed out');
  });
});

describe('recoverInterruptedUpdateOnStartup', () => {
  it('adopts a dead owned worker and runs recovery only', async () => {
    const root = makeRoot();
    const interrupted = {
      ...queuedJob(root),
      phase: 'stopping',
      launchState: 'owned',
      pid: 98989,
      checkpoint: 'applied',
    };
    writeFileSync(
      join(root, 'data/update/jobs', `${JOB_ID}.json`),
      `${JSON.stringify(interrupted)}\n`,
    );
    writeFileSync(join(root, 'data/update/jobs', `${JOB_ID}.pid`), '98989\n');
    const runJob = vi.fn().mockResolvedValue({ status: 'rolled-back' });

    await expect(
      recoverInterruptedUpdateOnStartup(root, {
        pidAlive: () => false,
        runJob,
      }),
    ).resolves.toEqual({
      status: 'recovered',
      jobId: JOB_ID,
      result: { status: 'rolled-back' },
    });

    expect(runJob).toHaveBeenCalledWith(root, JOB_ID, expect.any(Object), {
      recoveryOnly: true,
    });
    expect(existsSync(join(root, 'data/update/jobs', `${JOB_ID}.pid`))).toBe(false);
  });

  it('does not adopt a live worker or a fresh claim-pending recovery', async () => {
    const root = makeRoot();
    const active = {
      ...queuedJob(root),
      phase: 'recovery-queued',
      launchState: 'claim-pending',
      error: 'Update worker stopped before completion',
      updatedAt: NOW.toISOString(),
    };
    writeFileSync(join(root, 'data/update/jobs', `${JOB_ID}.json`), `${JSON.stringify(active)}\n`);
    const runJob = vi.fn();

    await expect(
      recoverInterruptedUpdateOnStartup(root, {
        clock: () => new Date(NOW.getTime() + 1_000),
        pidAlive: () => false,
        runJob,
      }),
    ).resolves.toEqual({ status: 'active', jobId: JOB_ID });
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe('owned command timeout', () => {
  it('waits for SIGKILL escalation before recovery when the group leader exits on SIGTERM', async () => {
    vi.useFakeTimers();
    const children = [
      Object.assign(new EventEmitter(), { pid: 1101 }),
      Object.assign(new EventEmitter(), { pid: 1102 }),
      Object.assign(new EventEmitter(), { pid: 1103 }),
    ];
    const spawnProcess = vi.fn(() => children[spawnProcess.mock.calls.length - 1]);
    vi.doMock('node:child_process', async importOriginal => {
      const actual = await importOriginal();
      return {
        ...actual,
        default: { ...actual.default, spawn: spawnProcess },
        spawn: spawnProcess,
      };
    });
    vi.resetModules();
    let timedOutGroupAlive = true;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -1102 && signal === 0 && !timedOutGroupAlive) {
        throw Object.assign(new Error('process group is gone'), { code: 'ESRCH' });
      }
      return true;
    });

    try {
      const isolatedWorker = await import('../scripts/update-worker.mjs');
      const root = makeRoot();
      const states = [];
      void isolatedWorker.runUpdateRestartJob(root, JOB_ID, {
        pid: 4242,
        clock: () => NOW,
        claimPid: vi.fn(),
        persistJob: (_root, job) => states.push(structuredClone(job)),
        waitForHealth: vi.fn().mockResolvedValue(undefined),
        readLaunchIdentity: vi.fn(() => ({ launchId: 'launch-123' })),
        validateRuntime: vi.fn().mockResolvedValue(undefined),
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(spawnProcess.mock.calls[0][2]).toMatchObject({
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      children[0].emit('exit', 0, null);
      await Promise.resolve();
      await Promise.resolve();
      expect(spawnProcess).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(kill).toHaveBeenCalledWith(-1102, 'SIGTERM');
      children[1].emit('exit', null, 'SIGTERM');
      await Promise.resolve();
      await Promise.resolve();

      expect(spawnProcess).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(kill).not.toHaveBeenCalledWith(-1102, 'SIGKILL');
      expect(spawnProcess).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(kill).toHaveBeenCalledWith(-1102, 'SIGKILL');
      expect(spawnProcess).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(spawnProcess).toHaveBeenCalledTimes(2);

      timedOutGroupAlive = false;
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      expect(spawnProcess).toHaveBeenCalledTimes(3);
      expect(states.map(job => job.phase)).toContain('recovering');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      kill.mockRestore();
      vi.doUnmock('node:child_process');
      vi.resetModules();
    }
  });
});
