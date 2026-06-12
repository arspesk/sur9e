// src/lib/server/jobs/api.ts
//
// Public CRUD surface for the background-job system: createJob, getJob,
// listActiveJobs, activeJobsByType, findActiveJob.
//
// Parses persisted records through the JobRecord schema at every
// read/write boundary. createJob defers the spawn via setImmediate so
// the route can return immediately.
//
// No spawn code, no command building — single responsibility: CRUD.
//
// Inlined from src/server/lib/jobs.mjs.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobRecord, JobType } from '../../schemas/jobs';
import { spawnJob } from './runner';
import { isJobStale, markInterrupted } from './stale';

export interface ActiveJobSummary {
  id: string;
  /** Application number for offer-scoped jobs; absent for system jobs
   * (scan, batch-evaluate) which are not tied to a single offer. */
  num?: number;
  startedAt: string;
}

// --- private persistence helpers (duplicated from runner.ts; avoids a 4th shared file) ---

function jobsDir(rootPath: string): string {
  return join(rootPath, 'data/jobs');
}

function jobPath(rootPath: string, id: string): string {
  return join(jobsDir(rootPath), `${id}.json`);
}

function persist(rootPath: string, job: JobRecord): void {
  mkdirSync(jobsDir(rootPath), { recursive: true });
  writeFileSync(jobPath(rootPath, job.id), JSON.stringify(job, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------------

/**
 * Reap-on-read: a queued/running record whose owning server process died
 * (Ctrl+C, crash, hot-restart) can never reach a terminal state on its own
 * — the runner's close/error handlers lived in the dead process. Left
 * alone it blocks singleton kinds forever via findActiveJob and renders an
 * immortal, un-dismissable spinner card. The first read that notices the
 * record is stale (jobs/stale.ts: dead pid, or age past grace for pid-less
 * records) flips it to a terminal 'interrupted' error and persists, so
 * every read path self-heals the jobs dir as a side effect.
 */
function reapIfStale(rootPath: string, job: JobRecord): JobRecord {
  if (!isJobStale(job)) return job;
  const reaped = markInterrupted(job);
  persist(rootPath, reaped);
  return reaped;
}

function validateType(type: string): JobType {
  return JobType.parse(type);
}

/**
 * Create a new job record (status='queued'), persist it to
 * data/jobs/<id>.json, then schedule the underlying shell command
 * via setImmediate. Returns the freshly-created record so callers
 * can hand back an id for polling.
 *
 * Throws when `type` is not a valid JobType.
 */
export function createJob(
  rootPath: string,
  type: string,
  params: Record<string, unknown> | null | undefined,
): JobRecord {
  const canonicalType = validateType(type);
  const id = randomBytes(8).toString('hex');
  mkdirSync(jobsDir(rootPath), { recursive: true });
  const job = JobRecord.parse({
    id,
    type: canonicalType,
    status: 'queued',
    params: params || {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
  });
  persist(rootPath, job);

  // Defer the spawn so the route can return immediately. Backstop .catch:
  // an unhandled rejection here would leave the record 'queued' forever,
  // permanently blocking singleton kinds via findActiveJob.
  setImmediate(() => {
    Promise.resolve(spawnJob(rootPath, job)).catch((err: unknown) => {
      persist(rootPath, {
        ...job,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      });
    });
  });
  return job;
}

/**
 * Load a persisted job by id. Returns null when the file is missing
 * or unparseable — same fall-through semantics as the .mjs runtime.
 */
export function getJob(rootPath: string, id: string): JobRecord | null {
  const p = jobPath(rootPath, id);
  if (!existsSync(p)) return null;
  try {
    return reapIfStale(rootPath, JobRecord.parse(JSON.parse(readFileSync(p, 'utf-8'))));
  } catch {
    return null;
  }
}

/**
 * Find the most recent active (queued/running) job of a given type.
 * Returns null when `type` is not a known JobType (avoids scanning
 * every file for a never-matching string).
 */
export function findActiveJob(rootPath: string, type: string): JobRecord | null {
  const parsed = JobType.safeParse(type);
  if (!parsed.success) return null;
  const dir = jobsDir(rootPath);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  let latest: JobRecord | null = null;
  for (const f of files) {
    try {
      const j = reapIfStale(
        rootPath,
        JobRecord.parse(JSON.parse(readFileSync(join(dir, f), 'utf-8'))),
      );
      if (j.type !== parsed.data) continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      if (!latest || j.startedAt > latest.startedAt) latest = j;
    } catch {
      // skip unreadable/unparseable files
    }
  }
  return latest;
}

/**
 * List every active (queued/running) job of a given type. Returns []
 * when `type` is not a known JobType.
 */
export function listActiveJobs(rootPath: string, type: string): JobRecord[] {
  const parsed = JobType.safeParse(type);
  if (!parsed.success) return [];
  const dir = jobsDir(rootPath);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const out: JobRecord[] = [];
  for (const f of files) {
    try {
      const j = reapIfStale(
        rootPath,
        JobRecord.parse(JSON.parse(readFileSync(join(dir, f), 'utf-8'))),
      );
      if (j.type !== parsed.data) continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      out.push(j);
    } catch {
      // skip unreadable/unparseable files
    }
  }
  return out;
}

/**
 * Reshape active jobs across multiple types into the typed map the
 * /api/jobs/active route returns. Unknown type strings are silently
 * filtered out so the caller can pass a permissive list.
 */
export function activeJobsByType(
  rootPath: string,
  types: readonly string[],
): Record<string, ActiveJobSummary[]> {
  const out: Record<string, ActiveJobSummary[]> = {};
  for (const t of types) {
    const parsed = JobType.safeParse(t);
    if (!parsed.success) continue;
    // Num-less jobs (scan, batch-evaluate — system-level, not offer-scoped)
    // stay in the response WITHOUT a num so the deck's discovery poll can
    // surface them; offer-scoped consumers (use-job-lock) already skip
    // entries lacking a numeric num.
    out[t] = listActiveJobs(rootPath, t).map(j => {
      const rawNum = j.params && (j.params.num as number);
      const num =
        Number.isInteger(rawNum) && (rawNum as number) > 0 ? (rawNum as number) : undefined;
      return { id: j.id, ...(num != null ? { num } : {}), startedAt: j.startedAt };
    });
  }
  return out;
}

export type { JobParams, JobRecord, JobStatus, JobType } from '../../schemas/jobs';
