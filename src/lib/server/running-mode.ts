// src/lib/server/running-mode.ts
//
// State + resolution logic for the in-editor `<runningMode>` placeholder
// lifecycle. The thin server actions in src/server/actions/running-mode.ts
// delegate here (CLAUDE.md: server library logic lives in src/lib/server/;
// actions are glue).
//
// State is persisted as a flat keyed map in data/usage-mode-state.json so
// it survives a process restart (jobs themselves are kept by the job
// runner; this file only tracks the per-(num, mode) UI state). Unknown
// keys at the top level are preserved across writes — we only ever mutate
// the specific `${num}::${mode}` entry. A future change will wire the job
// runner to populate `markdown` here when a mode template emits a body chunk.

import 'server-only';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE_PATH = join(process.cwd(), 'data/usage-mode-state.json');
const JOBS_DIR = join(process.cwd(), 'data/jobs');

export interface ModeState {
  status: 'running' | 'done' | 'failed';
  markdown?: string;
  error?: string;
  startedAt?: string;
}

// Mode IDs used by mode-slash-items.ts map 1:1 to JobType. Used by the
// job-scan fallback in resolveRunningModeStatus.
const MODE_TO_JOB_TYPE: Record<string, string> = {
  evaluate: 'evaluate',
  'tailor-cv': 'tailor-cv',
  'cover-letter': 'cover-letter',
  research: 'research',
  'reach-out': 'reach-out',
  'interview-prep': 'interview-prep',
  negotiate: 'negotiate',
};

// A placeholder whose job never appears (the start request failed) would
// otherwise poll 'running' forever — the card spins and offers no Dismiss
// button. After this grace window with no matching job, surface it as
// 'failed' so the card stops and exposes its Dismiss. Generous because a
// real job writes its data/jobs/<id>.json within ~1-2s of creation, so this
// only trips when the job genuinely never started.
const ORPHAN_GRACE_MS = 45_000;

interface JobFile {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  params?: { num?: number } | null;
}

// Deliberately NOT jobs/api.ts findActiveJob: this scan must also see
// terminal jobs (done/error), filter by params.num, and honor `since`.
function scanJobsForMode(num: number, mode: string, since?: string): ModeState | null {
  const jobType = MODE_TO_JOB_TYPE[mode];
  if (!jobType) return null;
  if (!existsSync(JOBS_DIR)) return null;
  // When `since` is a parseable timestamp, only jobs that started at/after
  // it count — this excludes a PREVIOUS terminal job for the same
  // (jobType, num) that would otherwise make the poll report 'done' before
  // the NEW job's file is even written. An unparseable/absent `since`
  // degrades to the pre-fix no-filter behavior.
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const hasSince = !Number.isNaN(sinceMs);
  const files = readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
  let latest: JobFile | null = null;
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(JOBS_DIR, f), 'utf-8')) as JobFile;
      if (j.type !== jobType) continue;
      if (j.params?.num !== num) continue;
      if (hasSince) {
        const jobMs = Date.parse(j.startedAt ?? '');
        // Skip jobs with an unparseable startedAt, or ones that started
        // before the placeholder was inserted.
        if (Number.isNaN(jobMs) || jobMs < sinceMs) continue;
      }
      if (!latest || (j.startedAt ?? '') > (latest.startedAt ?? '')) latest = j;
    } catch {
      // skip unreadable
    }
  }
  if (!latest) return null;
  if (latest.status === 'done') {
    return { status: 'done', startedAt: latest.startedAt };
  }
  if (latest.status === 'error') {
    return { status: 'failed', error: latest.error, startedAt: latest.startedAt };
  }
  // queued | running
  return { status: 'running', startedAt: latest.startedAt };
}

function readState(): Record<string, ModeState> {
  if (!existsSync(STATE_PATH)) return {};
  try {
    const raw = readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, ModeState>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeState(s: Record<string, ModeState>): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function key(num: number, mode: string): string {
  return `${num}::${mode}`;
}

/**
 * Resolve the current state for a (num, mode) placeholder. Resolution
 * order:
 *   1. data/usage-mode-state.json explicit entry
 *   2. data/jobs/<id>.json scan for the matching (jobType, num) — most
 *      recent wins, filtered to jobs that started at/after `since` (the
 *      placeholder's startedAt) so a stale prior terminal job for the same
 *      offer can't flip the card to 'done' before the new job exists.
 *      Maps queued/running → 'running', done → 'done', error → 'failed'.
 *   3. `{ status: 'running' }` fallback when neither exists. Returning
 *      'done' prematurely (the old default) caused the editor card to
 *      flip to "Done — refresh in a moment" the instant the modal
 *      closed, before the actual job had even started.
 */
export function resolveRunningModeStatus(num: number, mode: string, since?: string): ModeState {
  const s = readState();
  const explicit = s[key(num, mode)];
  if (explicit) return explicit;
  const scanned = scanJobsForMode(num, mode, since);
  if (scanned) return scanned;
  // No explicit state and no matching job. If the placeholder was inserted
  // longer ago than the grace window, the job never started — fail it so the
  // card becomes dismissable instead of spinning forever. Within the window,
  // keep 'running' (the job's file may still be landing).
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  if (!Number.isNaN(sinceMs) && Date.now() - sinceMs > ORPHAN_GRACE_MS) {
    return { status: 'failed', error: 'The job didn’t start — dismiss and try again.' };
  }
  return { status: 'running' };
}

/**
 * Removes the state entry for a (num, mode) placeholder, preserving all
 * other keys (the JSON file may carry unrelated entries from concurrent
 * placeholders). Idempotent — safe to call when the key doesn't exist.
 */
export function removeRunningModeState(num: number, mode: string): void {
  const s = readState();
  const k = key(num, mode);
  if (!(k in s)) return;
  delete s[k];
  writeState(s);
}
