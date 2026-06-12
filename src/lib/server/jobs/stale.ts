// src/lib/server/jobs/stale.ts
//
// Liveness detection for persisted job records. The runner flips a job to
// done/error exclusively from in-process child 'close'/'error' handlers —
// if the server dies mid-job (Ctrl+C, crash, hot-restart) those handlers
// never fire and the record stays 'running' (or 'queued' when killed
// between persist and the deferred spawn) forever. That permanently blocks
// singleton kinds via findActiveJob and renders an immortal, un-dismissable
// spinner card. The read path (api.ts reapIfStale) uses these predicates to
// flip any dead record to a terminal error the first time anything reads it.
//
// Pure logic — no fs, no persistence — so the lifecycle rules are unit
// testable without touching data/jobs.

import 'server-only';
import type { JobRecord } from '../../schemas/jobs';

/** How long a 'queued' record may sit without flipping to 'running' before
 * it is considered orphaned. The createJob → spawnJob handoff is a
 * setImmediate plus a sync-under-the-hood checkInstalled — milliseconds in
 * practice; a record still queued after this window was written by a server
 * process that died before (or during) the spawn. */
export const QUEUED_GRACE_MS = 60_000;

/** Grace for 'running' records with no pid stamped — legacy records written
 * before liveness detection existed. Without a pid the process can't be
 * probed, so fall back to record age. */
export const NO_PID_GRACE_MS = 60_000;

/** Terminal error copy for reaped records. Shown verbatim as the failed
 * card's subtitle, so it must say what happened and imply "safe to retry". */
export const INTERRUPTED_ERROR = 'interrupted — the server restarted while this job was running';

/** True when a process with this pid exists. EPERM means "exists but owned
 * by someone else" — still alive. ESRCH (or anything else) means dead. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * True when an active (queued/running) record's owning process is gone and
 * the record can never reach a terminal state on its own.
 *
 * - running + pid: the pid probe is authoritative. (A recycled pid can mask
 *   a dead job for a while; the dangerous direction — reaping a LIVE job —
 *   cannot happen, which is the invariant that matters.)
 * - running without pid, or queued: fall back to record age vs the grace
 *   windows above. An unparseable startedAt is treated as stale.
 *
 * `opts` exists for tests: inject a fake clock / pid probe.
 */
export function isJobStale(
  job: JobRecord,
  opts: { now?: number; pidAlive?: (pid: number) => boolean } = {},
): boolean {
  if (job.status !== 'queued' && job.status !== 'running') return false;
  const alive = opts.pidAlive ?? isPidAlive;
  if (job.status === 'running' && typeof job.pid === 'number') {
    return !alive(job.pid);
  }
  const started = Date.parse(job.startedAt);
  if (Number.isNaN(started)) return true;
  const now = opts.now ?? Date.now();
  const grace = job.status === 'queued' ? QUEUED_GRACE_MS : NO_PID_GRACE_MS;
  return now - started > grace;
}

/** Terminal-error copy of a stale record. exitCode stays null — the process
 * never reported one. */
export function markInterrupted(job: JobRecord, now: Date = new Date()): JobRecord {
  return {
    ...job,
    status: 'error',
    error: INTERRUPTED_ERROR,
    finishedAt: now.toISOString(),
  };
}
