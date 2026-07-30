import 'server-only';
import type { ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobRecord, type JobRecord as JobRecordType } from '../../schemas/jobs';

const FORCE_AFTER_MS = 5000;

type SignalName = 'SIGTERM' | 'SIGKILL';

interface LiveJob {
  child: ChildProcess;
  forceScheduled: boolean;
}

const liveJobs: Map<string, LiveJob> = ((
  globalThis as unknown as { __sur9eLiveJobs?: Map<string, LiveJob> }
).__sur9eLiveJobs ??= new Map());

function jobPath(rootPath: string, id: string): string {
  return join(rootPath, 'data/jobs', `${id}.json`);
}

export function readJobRecord(rootPath: string, id: string): JobRecordType | null {
  const path = jobPath(rootPath, id);
  if (!existsSync(path)) return null;
  try {
    return JobRecord.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return null;
  }
}

export function persistJobRecord(rootPath: string, job: JobRecordType): void {
  mkdirSync(join(rootPath, 'data/jobs'), { recursive: true });
  writeFileSync(jobPath(rootPath, job.id), JSON.stringify(job, null, 2), 'utf-8');
}

export function registerLiveJob(jobId: string, child: ChildProcess): void {
  liveJobs.set(jobId, { child, forceScheduled: false });
}

export function unregisterLiveJob(jobId: string): void {
  liveJobs.delete(jobId);
}

function childPids(pid: number): number[] {
  if (process.platform === 'win32') return [];
  try {
    return execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], { encoding: 'utf-8' })
      .split(/\s+/)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

function signalTree(job: JobRecordType, signal: SignalName): void {
  const pid = job.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    try {
      execFileSync('taskkill', args, { stdio: 'ignore' });
    } catch {
      // Already exited is an idempotent success.
    }
    return;
  }
  try {
    if (job.processGroupId) {
      process.kill(-job.processGroupId, signal);
      return;
    }
    const descendants = childPids(pid);
    for (const childPid of descendants) {
      signalTree({ ...job, pid: childPid, processGroupId: undefined }, signal);
    }
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export interface CancellationDeps {
  signal?: (job: JobRecordType, signal: SignalName) => void;
  scheduleForce?: (fn: () => void, ms: number) => void;
  advanceWorkflow?: (rootPath: string, jobId: string) => void;
}

export type CancelJobResult =
  | { cancelled: true; job: JobRecordType }
  | { cancelled: false; job: JobRecordType };

function stopProcess(job: JobRecordType, deps: CancellationDeps): void {
  const live = liveJobs.get(job.id);
  if (!job.pid && !live?.child.pid) return;
  const signal = deps.signal ?? signalTree;
  const target = job.pid ? job : { ...job, pid: live?.child.pid };
  signal(target, 'SIGTERM');
  if (live?.forceScheduled) return;
  if (live) live.forceScheduled = true;
  const force = () => {
    if (
      live &&
      !target.processGroupId &&
      (live.child.exitCode !== null || liveJobs.get(job.id)?.child !== live.child)
    ) {
      return;
    }
    try {
      signal(target, 'SIGKILL');
    } catch {
      // The process exiting during the grace period is an idempotent success.
    }
  };
  if (deps.scheduleForce) deps.scheduleForce(force, FORCE_AFTER_MS);
  else {
    const timer = setTimeout(force, FORCE_AFTER_MS);
    timer.unref();
  }
}

function notifyWorkflow(rootPath: string, job: JobRecordType, deps: CancellationDeps): void {
  if (!job.workflowId && typeof job.params.workflow_id !== 'string') return;
  if (deps.advanceWorkflow) {
    deps.advanceWorkflow(rootPath, job.id);
    return;
  }
  setImmediate(() => {
    void import('../workflows/api').then(({ advanceWorkflowsForJob }) => {
      advanceWorkflowsForJob(rootPath, job.id);
    });
  });
}

/**
 * Cancel one exact persisted job. The cancelled record is written before any
 * signal so pollers stop immediately; partial output and worker writes remain.
 */
export function cancelJob(
  rootPath: string,
  jobId: string,
  deps: CancellationDeps = {},
): CancelJobResult {
  const current = readJobRecord(rootPath, jobId);
  if (!current) throw new Error(`job not found: ${jobId}`);
  if (current.status === 'done' || current.status === 'error') {
    return { cancelled: false, job: current };
  }

  const cancelled: JobRecordType =
    current.status === 'cancelled'
      ? current
      : {
          ...current,
          status: 'cancelled',
          error: null,
          finishedAt: new Date().toISOString(),
        };
  persistJobRecord(rootPath, cancelled);
  stopProcess(cancelled, deps);
  notifyWorkflow(rootPath, cancelled, deps);
  return { cancelled: current.status !== 'cancelled', job: cancelled };
}
