import 'server-only';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type UpdateJob, UpdateJob as UpdateJobSchema } from '../schemas/update-job';
import { atomicWrite } from './atomic-write';

const TERMINAL_PHASES = new Set<UpdateJob['phase']>(['succeeded', 'rolled-back', 'failed']);

export interface UpdateRequestContext {
  mode: UpdateJob['mode'];
  fromVersion: string;
  toVersion?: string;
}

interface SpawnedUpdateWorker {
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
  spawn: (
    command: string,
    args: string[],
    options: UpdateWorkerSpawnOptions,
  ) => SpawnedUpdateWorker;
}

export type StartUpdateJobResult =
  | { status: 'started'; job: UpdateJob }
  | { status: 'busy'; job: UpdateJob };

const defaultDeps: UpdateOrchestratorDeps = {
  clock: () => new Date(),
  uuid: randomUUID,
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

function findActiveUpdateJob(root: string): UpdateJob | null {
  const directory = updateJobsDir(root);
  if (!existsSync(directory)) return null;

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.json')) continue;
    const job = loadUpdateJob(root, file.slice(0, -'.json'.length));
    if (job && !TERMINAL_PHASES.has(job.phase)) return job;
  }

  return null;
}

export function startUpdateJob(
  root: string,
  requestContext: UpdateRequestContext,
  deps: UpdateOrchestratorDeps = defaultDeps,
): StartUpdateJobResult {
  const activeJob = findActiveUpdateJob(root);
  if (activeJob) return { status: 'busy', job: activeJob };

  const timestamp = deps.clock().toISOString();
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

  const logFileDescriptor = openSync(join(updateJobsDir(root), `${job.id}.log`), 'a');
  try {
    const worker = deps.spawn(
      process.execPath,
      [join(root, 'scripts/update-worker.mjs'), '--root', root, '--job-id', job.id],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', logFileDescriptor, logFileDescriptor],
      },
    );
    worker.unref();
  } finally {
    closeSync(logFileDescriptor);
  }

  return { status: 'started', job };
}
