#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UpdateJob } from '../src/lib/schemas/update-job.ts';

const HEALTH_URL = 'http://127.0.0.1:3000/api/version';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 1_000;
const CLAIM_PENDING_LEASE_MS = 60_000;
const TERMINAL_PHASES = new Set(['succeeded', 'rolled-back', 'failed']);
const POST_ROLLBACK_CHECKPOINTS = new Set([
  'rollback-complete',
  'dependencies-restored',
  'recovery-build-complete',
  'recovery-server-started',
]);
const COMMAND_TIMEOUTS_MS = {
  preflight: 30_000,
  apply: 15 * 60_000,
  stop: 2 * 60_000,
  build: 15 * 60_000,
  start: 2 * 60_000,
  rollback: 10 * 60_000,
  install: 10 * 60_000,
};

const UPDATE_FAILURES = {
  stopping: 'Update restart failed while stopping',
  rebuilding: 'Update restart failed while rebuilding',
  restarting: 'Update restart failed while restarting',
  verifying: 'Update restart failed while verifying',
};

const RECOVERY_FAILURES = {
  cleanup: 'stopping the updated server',
  rollback: 'rolling back the checkout',
  install: 'installing previous dependencies',
  rebuild: 'rebuilding the previous version',
  restart: 'restarting the previous version',
  verification: 'verifying the previous version',
};

function jobPath(root, jobId) {
  return join(root, 'data/update/jobs', `${jobId}.json`);
}

function pidPath(root, jobId) {
  return join(root, 'data/update/jobs', `${jobId}.pid`);
}

function inspectSidecarOwner(root, jobId, pidAlive) {
  const path = pidPath(root, jobId);
  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, exists: false, alive: false };
    throw error;
  }
  const pid = Number(raw.trim());
  return {
    path,
    exists: true,
    alive: Number.isInteger(pid) && pid > 0 && pidAlive(pid),
  };
}

function claimPid(root, jobId, pid) {
  const path = pidPath(root, jobId);
  let descriptor;
  try {
    descriptor = openSync(path, 'wx');
    writeFileSync(descriptor, `${pid}\n`, 'utf-8');
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      rmSync(path, { force: true });
    }
    throw error;
  }
  closeSync(descriptor);
}

function loadJob(root, jobId) {
  return UpdateJob.parse(JSON.parse(readFileSync(jobPath(root, jobId), 'utf-8')));
}

function persistJob(root, job) {
  const parsed = UpdateJob.parse(job);
  const destination = jobPath(root, parsed.id);
  const temporary = `${destination}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function runCommand(
  command,
  args,
  { timeoutMs = 10 * 60_000, onHeartbeat, heartbeatMs = 10_000, ...options },
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
      shell: false,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let settled = false;
    let timedOut = false;
    let escalation = null;
    let terminationPoll = null;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      if (terminationPoll) clearTimeout(terminationPoll);
      if (heartbeat) clearInterval(heartbeat);
      callback(value);
    };
    const ownedGroupAlive = () => {
      if (!child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return error?.code !== 'ESRCH';
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // The command may have exited between the timeout and the signal.
      }
      escalation = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The owned command group already exited.
        }
        const waitForTermination = () => {
          if (!ownedGroupAlive()) {
            finish(reject)(new Error('Command timed out'));
            return;
          }
          terminationPoll = setTimeout(waitForTermination, 50);
        };
        waitForTermination();
      }, 2_000);
      escalation.unref?.();
    }, timeoutMs);
    timer.unref?.();
    const heartbeat = onHeartbeat ? setInterval(onHeartbeat, heartbeatMs) : null;
    heartbeat?.unref?.();
    child.once('error', error => {
      if (!timedOut) finish(reject)(error);
    });
    child.once('exit', (code, signal) => {
      if (timedOut) return;
      if (code === 0 && signal === null) finish(resolvePromise)();
      else {
        console.error(
          `[update-worker] command failed (${command}, exit ${code ?? 'none'}, signal ${signal ?? 'none'})`,
        );
        const error = new Error('Command failed');
        error.exitCode = code;
        error.signal = signal;
        finish(reject)(error);
      }
    });
  });
}

async function validateRuntime(root) {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`Node ${process.version} is below the required Node 24 runtime`);
  }
  await runCommand('npm', ['--version'], {
    cwd: root,
    timeoutMs: COMMAND_TIMEOUTS_MS.preflight,
  });
}

export async function waitForSur9eHealth(
  url,
  { timeoutMs, intervalMs, expectedVersion, launchId, fetchImpl = fetch },
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(intervalMs, remaining))),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.version === expectedVersion && payload?.launchId === launchId) return;
      }
    } catch {
      // The server may still be starting.
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error('Health verification timed out');
}

function readLaunchIdentity(root) {
  const value = JSON.parse(readFileSync(join(root, 'data/web/web.json'), 'utf-8'));
  if (typeof value?.launchId !== 'string' || value.launchId.length === 0) {
    throw new Error('Managed launch identity is missing');
  }
  return { launchId: value.launchId };
}

function readVersion(root) {
  return readFileSync(join(root, 'VERSION'), 'utf-8').trim();
}

const defaultDeps = {
  pid: process.pid,
  clock: () => new Date(),
  claimPid,
  persistJob,
  runCommand,
  waitForHealth: waitForSur9eHealth,
  readLaunchIdentity,
  readVersion,
  validateRuntime,
};

/**
 * Apply an update and restart the managed web server while preserving its
 * persisted dev/prod and Tailscale launch mode. All process and health effects
 * are dependencies so the state machine can be tested without touching a real
 * checkout, server, port, or Tailscale process.
 */
export async function runUpdateRestartJob(root, jobId, deps = defaultDeps, options = {}) {
  const runtime = { ...defaultDeps, ...deps };
  try {
    runtime.claimPid(root, jobId, runtime.pid);
  } catch {
    return { status: 'failed' };
  }

  let job;
  try {
    job = loadJob(root, jobId);
  } catch {
    return { status: 'failed' };
  }
  const transition = (phase, error, checkpoint = job.checkpoint) => {
    const { error: _previousError, ...current } = job;
    job = UpdateJob.parse({
      ...current,
      phase,
      launchState: 'owned',
      pid: runtime.pid,
      updatedAt: runtime.clock().toISOString(),
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(error === undefined ? {} : { error }),
    });
    runtime.persistJob(root, job);
  };

  const runPhaseCommand = (command, args, commandOptions) =>
    runtime.runCommand(command, args, {
      ...commandOptions,
      onHeartbeat: () => transition(job.phase, job.error, job.checkpoint),
    });

  const startServer = () => {
    const startArgs = [join(root, 'scripts/web.mjs')];
    if (job.mode.prod) startArgs.push('--prod');
    else if (job.mode.tailscale) startArgs.push('--dev');
    if (job.mode.tailscale) startArgs.push('--tailscale');
    startArgs.push('--detach');
    return runPhaseCommand(process.execPath, startArgs, {
      cwd: root,
      timeoutMs: COMMAND_TIMEOUTS_MS.start,
      ...(job.mode.prod ? { env: { ...process.env, SUR9E_WEB_SKIP_BUILD: '1' } } : {}),
    });
  };

  const verifyHealth = expectedVersion => {
    const { launchId } = runtime.readLaunchIdentity(root);
    return runtime.waitForHealth(HEALTH_URL, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_INTERVAL_MS,
      expectedVersion,
      launchId,
    });
  };

  const recover = async originalError => {
    transition('recovering', originalError);
    let recoveryStage = 'cleanup';
    try {
      if (job.checkpoint !== 'server-stopped' && job.checkpoint !== 'rollback-complete') {
        await runPhaseCommand(process.execPath, [join(root, 'scripts/web.mjs'), 'stop'], {
          cwd: root,
          timeoutMs: COMMAND_TIMEOUTS_MS.stop,
        });
      }
      recoveryStage = 'rollback';
      if (!POST_ROLLBACK_CHECKPOINTS.has(job.checkpoint)) {
        await runPhaseCommand(process.execPath, [join(root, 'update-system.mjs'), 'rollback'], {
          cwd: root,
          timeoutMs: COMMAND_TIMEOUTS_MS.rollback,
        });
      }
      transition('recovering', originalError, 'rollback-complete');
      recoveryStage = 'install';
      await runPhaseCommand('npm', ['ci', '--no-audit', '--no-fund'], {
        cwd: root,
        timeoutMs: COMMAND_TIMEOUTS_MS.install,
      });
      transition('recovering', originalError, 'dependencies-restored');
      if (job.mode.prod) {
        recoveryStage = 'rebuild';
        await runPhaseCommand('npm', ['run', 'build'], {
          cwd: root,
          timeoutMs: COMMAND_TIMEOUTS_MS.build,
        });
        transition('recovering', originalError, 'recovery-build-complete');
      }
      recoveryStage = 'restart';
      await startServer();
      transition('recovering', originalError, 'recovery-server-started');
      recoveryStage = 'verification';
      await verifyHealth(job.fromVersion);
      transition('rolled-back', originalError, 'recovery-server-started');
      return { status: 'rolled-back' };
    } catch {
      const recoveryError = RECOVERY_FAILURES[recoveryStage] ?? 'recovering the previous version';
      transition('failed', `${originalError}; recovery failed while ${recoveryError}`);
      return { status: 'failed' };
    }
  };

  if (options.recoveryOnly) {
    return recover(job.error ?? 'Update worker stopped before completion');
  }

  try {
    await runtime.validateRuntime(root);
  } catch {
    transition('failed', 'Update requires Node 24+ and a working npm installation');
    return { status: 'failed' };
  }

  transition('applying', undefined, 'apply-started');
  try {
    await runPhaseCommand(process.execPath, [join(root, 'update-system.mjs'), 'apply'], {
      cwd: root,
      timeoutMs: COMMAND_TIMEOUTS_MS.apply,
    });
  } catch (error) {
    if (error?.exitCode === 2) {
      transition('failed', 'Update failed before changing system files', 'apply-started');
      return { status: 'failed' };
    }
    return recover('Update failed while applying the new version');
  }

  let failedPhase;
  try {
    failedPhase = 'stopping';
    transition(failedPhase, undefined, 'applied');
    await runPhaseCommand(process.execPath, [join(root, 'scripts/web.mjs'), 'stop'], {
      cwd: root,
      timeoutMs: COMMAND_TIMEOUTS_MS.stop,
    });
    if (job.mode.prod) {
      failedPhase = 'rebuilding';
      transition(failedPhase, undefined, 'server-stopped');
      await runPhaseCommand('npm', ['run', 'build'], {
        cwd: root,
        timeoutMs: COMMAND_TIMEOUTS_MS.build,
      });
    }
    failedPhase = 'restarting';
    transition(failedPhase, undefined, 'server-stopped');
    await startServer();
    failedPhase = 'verifying';
    transition(failedPhase, undefined, 'server-restarted');
    await verifyHealth(job.toVersion ?? job.fromVersion);
    transition('succeeded');
    return { status: 'succeeded' };
  } catch {
    return recover(UPDATE_FAILURES[failedPhase] ?? 'Update restart failed');
  }
}

/**
 * Launcher preflight for a reboot or killed update supervisor. It only adopts
 * jobs whose prior owner is provably dead (or whose unclaimed recovery lease
 * expired), then runs the idempotent recovery path in this launcher process.
 */
export async function recoverInterruptedUpdateOnStartup(root, deps = {}) {
  const runtime = {
    clock: () => new Date(),
    pidAlive: pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    runJob: runUpdateRestartJob,
    ...deps,
  };
  const directory = join(root, 'data/update/jobs');
  if (!existsSync(directory)) return { status: 'none' };

  const jobs = readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      try {
        return loadJob(root, file.slice(0, -'.json'.length));
      } catch {
        return null;
      }
    })
    .filter(job => job && !TERMINAL_PHASES.has(job.phase))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  const job = jobs[0];
  if (!job || job.phase === 'queued') return { status: 'none' };
  if (job.launchState === 'owned' && job.pid !== undefined && runtime.pidAlive(job.pid)) {
    return { status: 'active', jobId: job.id };
  }
  if (job.launchState === 'claim-pending') {
    const sidecarOwner = inspectSidecarOwner(root, job.id, runtime.pidAlive);
    if (sidecarOwner.alive) return { status: 'active', jobId: job.id };
    if (runtime.clock().getTime() - Date.parse(job.updatedAt) < CLAIM_PENDING_LEASE_MS) {
      return { status: 'active', jobId: job.id };
    }
  }

  const sidecarOwner = inspectSidecarOwner(root, job.id, runtime.pidAlive);
  if (sidecarOwner.alive) return { status: 'active', jobId: job.id };
  if (sidecarOwner.exists) {
    rmSync(sidecarOwner.path, { force: true });
  }
  const result = await runtime.runJob(root, job.id, defaultDeps, { recoveryOnly: true });
  return { status: 'recovered', jobId: job.id, result };
}

export function hasInterruptedUpdateOnStartup(root) {
  const directory = join(root, 'data/update/jobs');
  if (!existsSync(directory)) return false;
  return readdirSync(directory).some(file => {
    if (!file.endsWith('.json')) return false;
    try {
      const job = loadJob(root, file.slice(0, -'.json'.length));
      return job.phase !== 'queued' && !TERMINAL_PHASES.has(job.phase);
    } catch {
      return false;
    }
  });
}

function parseCliArgs(argv) {
  const rootIndex = argv.indexOf('--root');
  const jobIdIndex = argv.indexOf('--job-id');
  if (rootIndex < 0 || !argv[rootIndex + 1] || jobIdIndex < 0 || !argv[jobIdIndex + 1]) {
    throw new Error('Missing worker arguments');
  }
  return {
    root: argv[rootIndex + 1],
    jobId: argv[jobIdIndex + 1],
    recoveryOnly: argv.includes('--recover'),
  };
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    const { root, jobId, recoveryOnly } = parseCliArgs(process.argv.slice(2));
    const result = await runUpdateRestartJob(root, jobId, defaultDeps, { recoveryOnly });
    if (result.status === 'failed') process.exitCode = 1;
  } catch {
    console.error('Update worker failed');
    process.exitCode = 1;
  }
}
