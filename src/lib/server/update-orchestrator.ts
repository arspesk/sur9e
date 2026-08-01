import 'server-only';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type UpdateJob, UpdateJob as UpdateJobSchema } from '../schemas/update-job';
import { isPidAlive } from './jobs/stale';

const TERMINAL_PHASES = new Set<UpdateJob['phase']>(['succeeded', 'rolled-back', 'failed']);
const UPDATE_JOB_LEASE_MS = 15 * 60 * 1000;
const CLAIM_PENDING_LEASE_MS = 60 * 1000;
const START_LOCK_LEASE_MS = 60 * 1000;
const LEASE_EXPIRED_ERROR = 'Update worker lease expired';
const CLAIM_EXPIRED_ERROR = 'Update worker did not claim ownership';
const WORKER_STOPPED_ERROR = 'Update worker stopped before completion';
const START_FAILED_ERROR = 'Update worker failed to start';
const WORKER_EXITED_ERROR = 'Update worker exited before completion';

export interface UpdateRequestContext {
  mode: UpdateJob['mode'];
  fromVersion: string;
  toVersion?: string;
}

interface SpawnedUpdateWorker {
  pid?: number;
  once(
    event: 'error' | 'exit' | 'close',
    listener: (...args: unknown[]) => void,
  ): SpawnedUpdateWorker;
  unref(): void;
}

interface UpdateWorkerSpawnOptions {
  cwd: string;
  detached: true;
  stdio: ['ignore', number, number];
}

export interface UpdateOrchestratorDeps {
  clock: () => Date;
  uuid: () => string;
  pidAlive?: (pid: number) => boolean;
  mkdirLock?: (path: string) => void;
  reloadJob?: (root: string, id: string) => UpdateJob | null;
  spawn: (
    command: string,
    args: string[],
    options: UpdateWorkerSpawnOptions,
  ) => SpawnedUpdateWorker;
}

export type StartUpdateJobResult =
  | { status: 'started'; job: UpdateJob }
  | { status: 'busy'; job: UpdateJob | null }
  | { status: 'failed'; job: UpdateJob };

const defaultDeps: UpdateOrchestratorDeps = {
  clock: () => new Date(),
  uuid: randomUUID,
  pidAlive: isPidAlive,
  spawn: (command, args, options) => {
    const child = nodeSpawn(command, args, options);
    const worker: SpawnedUpdateWorker = {
      pid: child.pid,
      once(event, listener) {
        child.once(event, (...args: unknown[]) => listener(...args));
        return worker;
      },
      unref() {
        child.unref();
      },
    };
    return worker;
  },
};

function updateJobsDir(root: string): string {
  return join(root, 'data/update/jobs');
}

function updateJobPath(root: string, id: string): string {
  return join(updateJobsDir(root), `${id}.json`);
}

function updateJobPidPath(root: string, id: string): string {
  return join(updateJobsDir(root), `${id}.pid`);
}

function updateStartLockDir(root: string): string {
  return join(root, 'data/update/start.lock');
}

interface StartLockOwner {
  token: string;
  pid: number;
  acquiredAt: string;
}

function readStartLockOwner(root: string): StartLockOwner | null {
  try {
    const raw = JSON.parse(readFileSync(join(updateStartLockDir(root), 'owner.json'), 'utf-8'));
    if (
      typeof raw?.token !== 'string' ||
      typeof raw?.pid !== 'number' ||
      !Number.isInteger(raw.pid) ||
      raw.pid <= 0 ||
      typeof raw?.acquiredAt !== 'string' ||
      Number.isNaN(Date.parse(raw.acquiredAt))
    ) {
      return null;
    }
    return raw as StartLockOwner;
  } catch {
    return null;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function atomicReplace(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    writeFileSync(temporaryPath, content, 'utf-8');
    renameSync(temporaryPath, filePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function acquireStartLock(
  root: string,
  token: string,
  now: Date,
  deps: UpdateOrchestratorDeps,
): (() => void) | null {
  const directory = updateStartLockDir(root);
  const recoveryDirectory = `${directory}.recovery`;
  const mkdirLock = deps.mkdirLock ?? (path => mkdirSync(path));
  mkdirSync(join(root, 'data/update'), { recursive: true });

  const tryCreateLock = (): boolean => {
    try {
      mkdirLock(directory);
      return true;
    } catch (error) {
      if (isAlreadyExistsError(error)) return false;
      throw error;
    }
  };

  let recoveryHeld = false;
  let lockCreated = tryCreateLock();
  if (!lockCreated) {
    try {
      try {
        mkdirSync(recoveryDirectory);
        recoveryHeld = true;
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        const recoveryAge = now.getTime() - statSync(recoveryDirectory).mtimeMs;
        if (recoveryAge < START_LOCK_LEASE_MS) return null;
        rmSync(recoveryDirectory, { recursive: true, force: true });
        try {
          mkdirSync(recoveryDirectory);
          recoveryHeld = true;
        } catch (retryError) {
          if (isAlreadyExistsError(retryError)) return null;
          throw retryError;
        }
      }

      if (existsSync(directory)) {
        const owner = readStartLockOwner(root);
        const pidAlive = deps.pidAlive ?? isPidAlive;
        if (owner && pidAlive(owner.pid)) return null;
        const lockTimestamp = owner ? Date.parse(owner.acquiredAt) : statSync(directory).mtimeMs;
        if (!owner && now.getTime() - lockTimestamp < START_LOCK_LEASE_MS) return null;
        rmSync(directory, { recursive: true, force: true });
      }
      lockCreated = tryCreateLock();
      if (!lockCreated) return null;
    } finally {
      if (recoveryHeld) rmSync(recoveryDirectory, { recursive: true, force: true });
    }
  }

  if (!lockCreated) return null;
  try {
    const owner: StartLockOwner = {
      token,
      pid: process.pid,
      acquiredAt: now.toISOString(),
    };
    atomicReplace(join(directory, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return () => {
    if (readStartLockOwner(root)?.token === token) {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function loadUpdateJob(root: string, id: string): UpdateJob | null {
  const path = updateJobPath(root, id);
  if (!existsSync(path)) return null;
  return UpdateJobSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

function loadScannableUpdateJobs(root: string): UpdateJob[] {
  const directory = updateJobsDir(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap(file => {
    if (!file.endsWith('.json')) return [];
    try {
      const job = loadUpdateJob(root, file.slice(0, -'.json'.length));
      return job ? [job] : [];
    } catch {
      // One damaged job record must not block discovery or future updates.
      return [];
    }
  });
}

export function loadLatestActiveUpdateJob(root: string): UpdateJob | null {
  let latest: UpdateJob | null = null;
  for (const job of loadScannableUpdateJobs(root)) {
    if (TERMINAL_PHASES.has(job.phase)) continue;
    if (
      !latest ||
      Date.parse(job.updatedAt) > Date.parse(latest.updatedAt) ||
      (Date.parse(job.updatedAt) === Date.parse(latest.updatedAt) && job.id > latest.id)
    ) {
      latest = job;
    }
  }
  return latest;
}

export function writeUpdateJob(root: string, job: UpdateJob): void {
  const parsed = UpdateJobSchema.parse(job);
  atomicReplace(updateJobPath(root, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`);
}

function failUpdateJob(root: string, job: UpdateJob, updatedAt: Date, error: string): UpdateJob {
  const failed = UpdateJobSchema.parse({
    ...job,
    phase: 'failed',
    error,
    updatedAt: updatedAt.toISOString(),
  });
  writeUpdateJob(root, failed);
  return failed;
}

function failPersistedUpdateJob(
  root: string,
  id: string,
  deps: UpdateOrchestratorDeps,
  error: string,
): UpdateJob | null {
  const current = loadUpdateJob(root, id);
  if (!current || TERMINAL_PHASES.has(current.phase)) return current;
  return failUpdateJob(root, current, deps.clock(), error);
}

function findActiveUpdateJob(root: string, now: Date): UpdateJob | null {
  const jobs = loadScannableUpdateJobs(root)
    .filter(job => !TERMINAL_PHASES.has(job.phase))
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id),
    );

  for (const job of jobs) {
    if (job.launchState === 'claim-pending') {
      if (now.getTime() - Date.parse(job.updatedAt) >= CLAIM_PENDING_LEASE_MS) {
        failUpdateJob(root, job, now, CLAIM_EXPIRED_ERROR);
        continue;
      }
      return job;
    }
    if (job.pid !== undefined) return job;
    if (now.getTime() - Date.parse(job.updatedAt) >= UPDATE_JOB_LEASE_MS) {
      failUpdateJob(root, job, now, LEASE_EXPIRED_ERROR);
      continue;
    }
    return job;
  }

  return null;
}

export function startUpdateJob(
  root: string,
  requestContext: UpdateRequestContext,
  deps: UpdateOrchestratorDeps = defaultDeps,
): StartUpdateJobResult {
  const now = deps.clock();
  const id = deps.uuid();
  const releaseStartLock = acquireStartLock(root, id, now, deps);
  if (!releaseStartLock) return { status: 'busy', job: null };

  try {
    return startUpdateJobUnderLock(root, requestContext, deps, now, id);
  } finally {
    releaseStartLock();
  }
}

function startUpdateJobUnderLock(
  root: string,
  requestContext: UpdateRequestContext,
  deps: UpdateOrchestratorDeps,
  now: Date,
  id: string,
): StartUpdateJobResult {
  const activeJob = findActiveUpdateJob(root, now);
  if (activeJob) {
    if (
      activeJob.launchState === 'owned' &&
      activeJob.pid !== undefined &&
      !(deps.pidAlive ?? isPidAlive)(activeJob.pid)
    ) {
      return { status: 'busy', job: startRecoveryWorkerUnderLock(root, activeJob, deps, now) };
    }
    return { status: 'busy', job: activeJob };
  }

  const timestamp = now.toISOString();
  const job = UpdateJobSchema.parse({
    id,
    phase: 'queued',
    launchState: 'claim-pending',
    mode: requestContext.mode,
    fromVersion: requestContext.fromVersion,
    ...(requestContext.toVersion === undefined ? {} : { toVersion: requestContext.toVersion }),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeUpdateJob(root, job);

  let logFileDescriptor: number | undefined;
  let spawnSucceeded = false;
  let launchedJob = job;
  try {
    logFileDescriptor = openSync(join(updateJobsDir(root), `${job.id}.log`), 'a');
    const worker = deps.spawn(
      process.execPath,
      [join(root, 'scripts/update-worker.mjs'), '--root', root, '--job-id', job.id],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', logFileDescriptor, logFileDescriptor],
      },
    );
    spawnSucceeded = true;
    worker.once('error', () => {
      try {
        failPersistedUpdateJob(root, job.id, deps, START_FAILED_ERROR);
      } catch {
        // Event handlers cannot return persistence failures to the caller.
      }
    });
    const handleAbnormalCompletion = (...args: unknown[]) => {
      const [code, signal] = args;
      if (code === 0 && (signal === null || signal === undefined)) return;
      try {
        const current = loadUpdateJob(root, job.id);
        if (current?.launchState !== 'owned') {
          failPersistedUpdateJob(root, job.id, deps, WORKER_EXITED_ERROR);
        }
      } catch {
        // Event handlers cannot return persistence failures to the caller.
      }
    };
    worker.once('exit', handleAbnormalCompletion);
    worker.once('close', handleAbnormalCompletion);
    worker.unref();
    const reloadJob = deps.reloadJob ?? loadUpdateJob;
    launchedJob = reloadJob(root, job.id) ?? launchedJob;
    return { status: 'started', job: launchedJob };
  } catch {
    if (spawnSucceeded) return { status: 'started', job: launchedJob };
    const failed = failPersistedUpdateJob(root, job.id, deps, START_FAILED_ERROR);
    if (failed && TERMINAL_PHASES.has(failed.phase) && failed.phase !== 'failed') {
      return { status: 'started', job: failed };
    }
    return {
      status: 'failed',
      job: failed ?? failUpdateJob(root, job, deps.clock(), START_FAILED_ERROR),
    };
  } finally {
    if (logFileDescriptor !== undefined) closeSync(logFileDescriptor);
  }
}

function startRecoveryWorkerUnderLock(
  root: string,
  interrupted: UpdateJob,
  deps: UpdateOrchestratorDeps,
  now: Date,
): UpdateJob {
  const sidecar = updateJobPidPath(root, interrupted.id);
  if (existsSync(sidecar)) {
    const claimedPid = Number(readFileSync(sidecar, 'utf-8').trim());
    if (
      Number.isInteger(claimedPid) &&
      claimedPid > 0 &&
      claimedPid !== interrupted.pid &&
      (deps.pidAlive ?? isPidAlive)(claimedPid)
    ) {
      return interrupted;
    }
    rmSync(sidecar, { force: true });
  }

  const recoveryJob = UpdateJobSchema.parse({
    ...interrupted,
    phase: 'recovery-queued',
    launchState: 'claim-pending',
    pid: undefined,
    error: WORKER_STOPPED_ERROR,
    updatedAt: now.toISOString(),
  });
  writeUpdateJob(root, recoveryJob);

  let logFileDescriptor: number | undefined;
  try {
    logFileDescriptor = openSync(join(updateJobsDir(root), `${interrupted.id}.log`), 'a');
    const worker = deps.spawn(
      process.execPath,
      [
        join(root, 'scripts/update-worker.mjs'),
        '--root',
        root,
        '--job-id',
        interrupted.id,
        '--recover',
      ],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', logFileDescriptor, logFileDescriptor],
      },
    );
    worker.once('error', () => {
      try {
        failPersistedUpdateJob(root, interrupted.id, deps, START_FAILED_ERROR);
      } catch {
        // Event handlers cannot return persistence failures to the caller.
      }
    });
    const handleAbnormalCompletion = (...args: unknown[]) => {
      const [code, signal] = args;
      if (code === 0 && (signal === null || signal === undefined)) return;
      try {
        const current = loadUpdateJob(root, interrupted.id);
        if (current?.launchState !== 'owned') {
          failPersistedUpdateJob(root, interrupted.id, deps, WORKER_EXITED_ERROR);
        }
      } catch {
        // Event handlers cannot return persistence failures to the caller.
      }
    };
    worker.once('exit', handleAbnormalCompletion);
    worker.once('close', handleAbnormalCompletion);
    worker.unref();
    return (deps.reloadJob ?? loadUpdateJob)(root, interrupted.id) ?? recoveryJob;
  } catch {
    return failPersistedUpdateJob(root, interrupted.id, deps, START_FAILED_ERROR) ?? recoveryJob;
  } finally {
    if (logFileDescriptor !== undefined) closeSync(logFileDescriptor);
  }
}

export function reconcileUpdateJob(
  root: string,
  id: string,
  deps: UpdateOrchestratorDeps = defaultDeps,
): UpdateJob | null {
  const now = deps.clock();
  const releaseStartLock = acquireStartLock(root, `recover-${id}`, now, deps);
  if (!releaseStartLock) return loadUpdateJob(root, id);
  try {
    const job = loadUpdateJob(root, id);
    if (job?.launchState === 'claim-pending' && !TERMINAL_PHASES.has(job.phase)) {
      if (now.getTime() - Date.parse(job.updatedAt) < CLAIM_PENDING_LEASE_MS) return job;
      if (job.phase === 'recovery-queued') {
        return startRecoveryWorkerUnderLock(root, job, deps, now);
      }
      return failUpdateJob(root, job, now, CLAIM_EXPIRED_ERROR);
    }
    if (
      !job ||
      TERMINAL_PHASES.has(job.phase) ||
      job.launchState !== 'owned' ||
      job.pid === undefined ||
      (deps.pidAlive ?? isPidAlive)(job.pid)
    ) {
      return job;
    }
    return startRecoveryWorkerUnderLock(root, job, deps, now);
  } finally {
    releaseStartLock();
  }
}
