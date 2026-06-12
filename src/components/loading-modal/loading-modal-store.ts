import { create } from 'zustand';

export type JobKind =
  | 'evaluate'
  | 'batch-evaluate'
  | 'research'
  | 'interview-prep'
  | 'reach-out'
  | 'tailor-cv'
  | 'cover-letter'
  | 'work';

// The old regex-phase machinery (PHASE_CONFIG / derivePhase) is gone —
// progress is time-based now (elapsed over the registry's estimateS) and
// the collapsed sub-line shows the FunnyPrompt instead of phase labels.

export function fmtElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface JobSnapshot {
  status: 'queued' | 'running' | 'done' | 'error';
  output?: string;
  startedAt?: string;
  /** Set by the runner when the job reaches a terminal state — freezes the
   * elapsed timer at the real duration instead of ticking wall-clock. */
  finishedAt?: string | null;
  error?: string;
  /**
   * Per-job parameters mirrored from `/api/jobs/[id]`. `num` is the
   * application number for any offer-scoped job (evaluate, interview-prep,
   * research, tailor-cv, cover-letter, outreach, apply, follow-up). The
   * legacy `id` slot is kept for backwards compatibility with jobs that
   * predate the num-keyed contract.
   */
  params?: { num?: number; id?: string };
  /** Provider/model pair that actually RAN — mirrored from the JobRecord.
   * Re-stamped by the runner to the fallback pair when a [FALLBACK] marker
   * was emitted (see `fallback` below). */
  provider?: string;
  model?: string;
  /** Fallback-retry metadata, stamped by the runner when the worker recovered
   * (or attempted recovery) on the fallback pair. `from` records the failed
   * primary; `reason` the error category that triggered the retry. */
  fallback?: { from: { provider: string; model: string }; reason: string };
}

type TerminalResolver = (snap: JobSnapshot) => void;
type TerminalRejecter = (err: Error) => void;

export interface JobEntry {
  jobId: string;
  kind: string;
  /** Offer number for offer-scoped jobs — drives the "Generating X for offer #N" title. */
  num?: number;
  /** Monotonic creation order — stable across bringToFront reshuffles.
   * Drives the deck nav counter ("2/5") and prev/next cycling. */
  seq: number;
  snapshot: JobSnapshot | null;
  collapsed: boolean;
  logsOpen: boolean;
}

interface LoadingModalState {
  /** All visible job cards, keyed by jobId. */
  jobs: Record<string, JobEntry>;
  /** Render order, back → front (last entry is the front card). */
  order: string[];
  _resolvers: Map<string, { resolve: TerminalResolver; reject: TerminalRejecter }>;
  startJob: (jobId: string, kind: string, num?: number) => void;
  setSnapshot: (jobId: string, snap: JobSnapshot) => void;
  dismiss: (jobId: string) => void;
  bringToFront: (jobId: string) => void;
  /** Bring the prev (-1) / next (+1) job IN CREATION ORDER to the front,
   * wrapping around — the deck nav arrows. */
  cycleFront: (dir: 1 | -1) => void;
  toggleCollapse: (jobId: string) => void;
  toggleLogs: (jobId: string) => void;
  waitForTerminal: (jobId: string) => Promise<JobSnapshot>;
}

// R-26 — sessionStorage key for in-flight jobs (now a LIST). Inherited on
// tab duplication and the hydration-deadline reload so the reborn tab can
// re-attach to every in-flight job.
const ACTIVE_JOBS_KEY = 'sur9e.loading-modal.active-jobs';

export interface PersistedJob {
  jobId: string;
  kind: string;
  num?: number;
}

function persistActiveJobs(entries: PersistedJob[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (entries.length === 0) window.sessionStorage.removeItem(ACTIVE_JOBS_KEY);
    else window.sessionStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(entries));
  } catch {
    /* sessionStorage may be unavailable (private mode, quota); silent OK */
  }
}

/** In-flight (non-terminal) jobs, in render order. */
function inFlight(jobs: Record<string, JobEntry>, order: string[]): PersistedJob[] {
  return order
    .map(id => jobs[id])
    .filter(
      (j): j is JobEntry =>
        Boolean(j) && j.snapshot?.status !== 'done' && j.snapshot?.status !== 'error',
    )
    .map(j => ({ jobId: j.jobId, kind: j.kind, ...(j.num != null ? { num: j.num } : {}) }));
}

export function readPersistedActiveJobs(): PersistedJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PersistedJob =>
        typeof (e as PersistedJob)?.jobId === 'string' &&
        typeof (e as PersistedJob)?.kind === 'string',
    );
  } catch {
    return [];
  }
}

/** Monotonic seq for JobEntry creation order (stable across reshuffles). */
let nextSeq = 1;

export const useLoadingModalStore = create<LoadingModalState>((set, get) => ({
  jobs: {},
  order: [],
  _resolvers: new Map(),
  startJob(jobId, kind, num) {
    set(s => {
      if (s.jobs[jobId]) {
        // Already tracked (re-attach) — just bring to front.
        return { order: [...s.order.filter(id => id !== jobId), jobId] };
      }
      const entry: JobEntry = {
        jobId,
        kind,
        num,
        seq: nextSeq++,
        snapshot: null,
        collapsed: false,
        logsOpen: false,
      };
      return { jobs: { ...s.jobs, [jobId]: entry }, order: [...s.order, jobId] };
    });
    const s = get();
    persistActiveJobs(inFlight(s.jobs, s.order));
  },
  setSnapshot(jobId, snap) {
    set(s => {
      const entry = s.jobs[jobId];
      if (!entry) return s;
      return { jobs: { ...s.jobs, [jobId]: { ...entry, snapshot: snap } } };
    });
    if (snap.status === 'done' || snap.status === 'error') {
      const s = get();
      persistActiveJobs(inFlight(s.jobs, s.order));
      const r = s._resolvers.get(jobId);
      if (r) {
        s._resolvers.delete(jobId);
        r.resolve(snap);
      }
    }
  },
  dismiss(jobId) {
    const r = get()._resolvers.get(jobId);
    if (r) {
      get()._resolvers.delete(jobId);
      const err = new Error('Dismissed');
      err.name = 'AbortError';
      r.reject(err);
    }
    set(s => {
      const { [jobId]: _gone, ...rest } = s.jobs;
      return { jobs: rest, order: s.order.filter(id => id !== jobId) };
    });
    const s = get();
    persistActiveJobs(inFlight(s.jobs, s.order));
  },
  bringToFront(jobId) {
    set(s => (s.jobs[jobId] ? { order: [...s.order.filter(id => id !== jobId), jobId] } : s));
  },
  cycleFront(dir) {
    const { jobs, order } = get();
    if (order.length < 2) return;
    const bySeq = [...order].sort((a, b) => jobs[a].seq - jobs[b].seq);
    const front = order[order.length - 1];
    const idx = bySeq.indexOf(front);
    const target = bySeq[(idx + dir + bySeq.length) % bySeq.length];
    get().bringToFront(target);
  },
  toggleCollapse(jobId) {
    set(s => {
      const entry = s.jobs[jobId];
      if (!entry) return s;
      return { jobs: { ...s.jobs, [jobId]: { ...entry, collapsed: !entry.collapsed } } };
    });
  },
  toggleLogs(jobId) {
    set(s => {
      const entry = s.jobs[jobId];
      if (!entry) return s;
      return { jobs: { ...s.jobs, [jobId]: { ...entry, logsOpen: !entry.logsOpen } } };
    });
  },
  waitForTerminal(jobId) {
    return new Promise<JobSnapshot>((resolve, reject) => {
      const snap = get().jobs[jobId]?.snapshot;
      if (snap && (snap.status === 'done' || snap.status === 'error')) {
        resolve(snap);
        return;
      }
      get()._resolvers.set(jobId, { resolve, reject });
    });
  },
}));
