// src/lib/server/jobs/scheduler.ts
//
// Thin runtime around schedule-logic: loads settings + state, applies the
// decision, persists state. The tick is exported with injectable deps for
// tests; startScheduler wires the real ones on a 60s interval and is called
// exactly once from src/instrumentation.ts (globalThis guard for dev HMR).
import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../atomic-write';
import { loadSettings } from '../settings';
// scheduler → api → runner → (no scheduler): no import cycle.
import { createJob, findActiveJob } from './api';
import { computeDecision, type ScheduleState } from './schedule-logic';

const STATE_REL = 'data/schedule-state.json';
const TICK_MS = 60_000;

export interface TickDeps {
  now: Date;
  /** Spawn a job of the given kind; resolves with the created record. */
  spawn: (kind: 'scan', params: Record<string, unknown>) => Promise<unknown>;
  /** Existing-active lookup for the singleton family. */
  findActive: (kind: string) => unknown | null;
}

function readState(rootPath: string): ScheduleState {
  try {
    const raw = readFileSync(join(rootPath, STATE_REL), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ScheduleState>;
    // Map legacy 'done' value (pre-rename) to 'started' so old state files work.
    const rawResult = (parsed.last_result as string) === 'done' ? 'started' : parsed.last_result;
    return {
      last_planned: typeof parsed.last_planned === 'string' ? parsed.last_planned : null,
      last_run: typeof parsed.last_run === 'string' ? parsed.last_run : null,
      last_result: (rawResult as ScheduleState['last_result']) ?? null,
      cron: typeof parsed.cron === 'string' ? parsed.cron : null,
    };
  } catch {
    return { last_planned: null, last_run: null, last_result: null, cron: null };
  }
}

function writeState(rootPath: string, state: ScheduleState): void {
  atomicWrite(join(rootPath, STATE_REL), JSON.stringify(state, null, 2));
}

export async function runSchedulerTick(rootPath: string, deps: TickDeps): Promise<void> {
  const settings = await loadSettings(join(rootPath, 'inputs', 'config', 'config.yml'));
  const sched = settings.scanning.schedule;
  const state = readState(rootPath);
  const decision = computeDecision({
    enabled: sched.enabled,
    cron: sched.cron,
    catchUpHours: sched.catch_up_hours,
    state,
    now: deps.now,
  });

  if (decision.action === 'idle') return;

  if (decision.action === 'seed' || decision.action === 'forfeit') {
    // Stamp the cron the window was computed under — a future settings edit
    // must re-seed rather than fire a retroactive catch-up run.
    writeState(rootPath, { ...state, last_planned: decision.planned, cron: sched.cron });
    return;
  }

  // action === 'run' — respect the scan/batch-evaluate singleton: leave
  // last_planned untouched so the next tick retries (spec §2.5), but record
  // the skip so the UI can surface it.
  // Conflict family: scan + batch-evaluate + screen (all run batch workers
  // over the same shared state — pipeline.md, screened-urls.txt, tracker).
  // screen covers both the single-URL and queue re-screen jobs. screen-evaluate
  // is an individual URL evaluation — different singleton family, does not block.
  if (deps.findActive('scan') || deps.findActive('batch-evaluate') || deps.findActive('screen')) {
    writeState(rootPath, { ...state, last_result: 'skipped' });
    return;
  }

  try {
    await deps.spawn('scan', { scheduled: true });
    writeState(rootPath, {
      last_planned: decision.planned,
      last_run: deps.now.toISOString(),
      last_result: 'started',
      cron: sched.cron,
    });
  } catch {
    // Spawn failure: keep last_planned so the next tick retries; mark error.
    writeState(rootPath, { ...state, last_result: 'error' });
  }
}

export function startScheduler(rootPath: string): void {
  const g = globalThis as { __sur9eScheduler?: boolean };
  if (g.__sur9eScheduler) return; // dev HMR / double-register guard
  g.__sur9eScheduler = true;

  const tick = () =>
    void runSchedulerTick(rootPath, {
      now: new Date(),
      spawn: (kind, params) => Promise.resolve(createJob(rootPath, kind, params)),
      findActive: kind => findActiveJob(rootPath, kind),
    }).catch((err: unknown) => console.error('[scheduler] tick failed:', err));

  // Immediate boot tick so catch-up fires on server start without waiting 60s.
  tick();
  setInterval(tick, TICK_MS).unref();
}
