#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UpdateJob } from '../src/lib/schemas/update-job.ts';

const HEALTH_URL = 'http://127.0.0.1:3000';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 1_000;

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

function runCommand(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error('Command failed'));
    });
  });
}

async function waitForHealth(url, { timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(intervalMs, remaining))),
      });
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error('Health verification timed out');
}

const defaultDeps = {
  pid: process.pid,
  clock: () => new Date(),
  claimPid,
  persistJob,
  runCommand,
  waitForHealth,
};

/**
 * Apply an update and restart the managed web server while preserving its
 * persisted dev/prod and Tailscale launch mode. All process and health effects
 * are dependencies so the state machine can be tested without touching a real
 * checkout, server, port, or Tailscale process.
 */
export async function runUpdateRestartJob(root, jobId, deps = defaultDeps) {
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
  const transition = (phase, error) => {
    const { error: _previousError, ...current } = job;
    job = UpdateJob.parse({
      ...current,
      phase,
      launchState: 'owned',
      pid: runtime.pid,
      updatedAt: runtime.clock().toISOString(),
      ...(error === undefined ? {} : { error }),
    });
    runtime.persistJob(root, job);
  };

  const startServer = () => {
    const startArgs = [join(root, 'scripts/web.mjs')];
    if (job.mode.prod) startArgs.push('--prod');
    else if (job.mode.tailscale) startArgs.push('--dev');
    if (job.mode.tailscale) startArgs.push('--tailscale');
    startArgs.push('--detach');
    return runtime.runCommand(process.execPath, startArgs, {
      cwd: root,
      ...(job.mode.prod ? { env: { ...process.env, SUR9E_WEB_SKIP_BUILD: '1' } } : {}),
    });
  };

  const verifyHealth = () =>
    runtime.waitForHealth(HEALTH_URL, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_INTERVAL_MS,
    });

  transition('applying');
  try {
    await runtime.runCommand(process.execPath, [join(root, 'update-system.mjs'), 'apply'], {
      cwd: root,
    });
  } catch {
    transition('failed', 'Update failed while applying the new version');
    return { status: 'failed' };
  }

  let failedPhase;
  try {
    failedPhase = 'stopping';
    transition(failedPhase);
    await runtime.runCommand(process.execPath, [join(root, 'scripts/web.mjs'), 'stop'], {
      cwd: root,
    });
    if (job.mode.prod) {
      failedPhase = 'rebuilding';
      transition(failedPhase);
      await runtime.runCommand('npm', ['run', 'build'], { cwd: root });
    }
    failedPhase = 'restarting';
    transition(failedPhase);
    await startServer();
    failedPhase = 'verifying';
    transition(failedPhase);
    await verifyHealth();
    transition('succeeded');
    return { status: 'succeeded' };
  } catch {
    const originalError = UPDATE_FAILURES[failedPhase] ?? 'Update restart failed';
    transition('recovering', originalError);

    let recoveryStage = 'cleanup';
    try {
      if (failedPhase === 'restarting' || failedPhase === 'verifying') {
        await runtime.runCommand(process.execPath, [join(root, 'scripts/web.mjs'), 'stop'], {
          cwd: root,
        });
      }
      recoveryStage = 'rollback';
      await runtime.runCommand(process.execPath, [join(root, 'update-system.mjs'), 'rollback'], {
        cwd: root,
      });
      recoveryStage = 'install';
      await runtime.runCommand('npm', ['install', '--silent'], { cwd: root });
      if (job.mode.prod) {
        recoveryStage = 'rebuild';
        await runtime.runCommand('npm', ['run', 'build'], { cwd: root });
      }
      recoveryStage = 'restart';
      await startServer();
      recoveryStage = 'verification';
      await verifyHealth();
      transition('rolled-back', originalError);
      return { status: 'rolled-back' };
    } catch {
      const recoveryError = RECOVERY_FAILURES[recoveryStage] ?? 'recovering the previous version';
      transition('failed', `${originalError}; recovery failed while ${recoveryError}`);
      return { status: 'failed' };
    }
  }
}

function parseCliArgs(argv) {
  const rootIndex = argv.indexOf('--root');
  const jobIdIndex = argv.indexOf('--job-id');
  if (rootIndex < 0 || !argv[rootIndex + 1] || jobIdIndex < 0 || !argv[jobIdIndex + 1]) {
    throw new Error('Missing worker arguments');
  }
  return { root: argv[rootIndex + 1], jobId: argv[jobIdIndex + 1] };
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    const { root, jobId } = parseCliArgs(process.argv.slice(2));
    await runUpdateRestartJob(root, jobId);
  } catch {
    console.error('Update worker failed');
    process.exitCode = 1;
  }
}
