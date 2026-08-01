import 'server-only';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type UpdateJob, UpdateJob as UpdateJobSchema } from '../schemas/update-job';
import { atomicWrite } from './atomic-write';
import { isPidAlive } from './jobs/stale';

const TERMINAL_PHASES = new Set<UpdateJob['phase']>(['succeeded', 'rolled-back', 'failed']);
const UPDATE_JOB_LEASE_MS = 15 * 60 * 1000;
const LEASE_EXPIRED_ERROR = 'Update worker lease expired';
const WORKER_STOPPED_ERROR = 'Update worker stopped before completion';
const START_FAILED_ERROR = 'Update worker failed to start';

export interface UpdateRequestContext {
  mode: UpdateJob['mode'];
  fromVersion: string;
  toVersion?: string;
}

interface SpawnedUpdateWorker {
  pid?: number;
  once(event: 'error', listener: (error: Error) => void): SpawnedUpdateWorker;
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
  spawn: (
    command: string,
    args: string[],
    options: UpdateWorkerSpawnOptions,
  ) => SpawnedUpdateWorker;
}

export type StartUpdateJobResult =
  | { status: 'started'; job: UpdateJob }
  | { status: 'busy'; job: UpdateJob }
  | { status: 'failed'; job: UpdateJob };

const defaultDeps: UpdateOrchestratorDeps = {
  clock: () => new Date(),
  uuid: randomUUID,
  pidAlive: isPidAlive,
  spawn: (command, args, options) => nodeSpawn(command, args, options),
};

function updateJobsDir(root: string): string {
  return join(root, 'data/update/jobs');
}

function updateJobPath(root: string, id: string): string {
  return join(updateJobsDir(root), `${id}.json`);
}

export function loadUpdateJob(root: string, id: string): UpdateJob | null {
  const path = updateJobPath(root, id);
  if (!existsSync(path)) return null;
  return UpdateJobSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

export function writeUpdateJob(root: string, job: UpdateJob): void {
  const parsed = UpdateJobSchema.parse(job);
  atomicWrite(updateJobPath(root, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`);
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

function findActiveUpdateJob(
  root: string,
  now: Date,
  pidAlive: (pid: number) => boolean,
): UpdateJob | null {
  const directory = updateJobsDir(root);
  if (!existsSync(directory)) return null;

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.json')) continue;
    const job = loadUpdateJob(root, file.slice(0, -'.json'.length));
    if (!job || TERMINAL_PHASES.has(job.phase)) continue;
    if (job.pid !== undefined && !pidAlive(job.pid)) {
      failUpdateJob(root, job, now, WORKER_STOPPED_ERROR);
      continue;
    }
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
  const activeJob = findActiveUpdateJob(root, now, deps.pidAlive ?? isPidAlive);
  if (activeJob) return { status: 'busy', job: activeJob };

  const timestamp = now.toISOString();
  const job = UpdateJobSchema.parse({
    id: deps.uuid(),
    phase: 'queued',
    mode: requestContext.mode,
    fromVersion: requestContext.fromVersion,
    ...(requestContext.toVersion === undefined ? {} : { toVersion: requestContext.toVersion }),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeUpdateJob(root, job);

  let logFileDescriptor: number | undefined;
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
    worker.once('error', () => {
      try {
        failPersistedUpdateJob(root, job.id, deps, START_FAILED_ERROR);
      } catch {
        // Event handlers cannot return persistence failures to the caller.
      }
    });
    worker.unref();
    const startedJob = UpdateJobSchema.parse({
      ...job,
      ...(worker.pid === undefined ? {} : { pid: worker.pid }),
    });
    writeUpdateJob(root, startedJob);
    return { status: 'started', job: startedJob };
  } catch {
    return {
      status: 'failed',
      job: failUpdateJob(root, job, deps.clock(), START_FAILED_ERROR),
    };
  } finally {
    if (logFileDescriptor !== undefined) closeSync(logFileDescriptor);
  }
}
