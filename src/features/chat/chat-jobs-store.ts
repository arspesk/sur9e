import { create } from 'zustand';

// The chat jobs store — the loading-modal deck store, relocated. Owns every
// tracked background job (client-started AND discovered), the ‹ › cycling
// order, per-job waitForTerminal promises, and the sessionStorage re-attach
// list. The public contract (startJob / setSnapshot / dismiss /
// waitForTerminal + AbortError on dismiss) is frozen: use-job-action, the
// generator modals, and screen-modal depend on it verbatim.

export interface JobSnapshot {
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  output?: string;
  startedAt?: string;
  /** Set by the runner when the job reaches a terminal state — freezes the
   * elapsed timer at the real duration instead of ticking wall-clock. */
  finishedAt?: string | null;
  error?: string;
  /** classify-error category behind `error` when the runner recognised a
   * provider failure (see JobRecord.errorCategory). */
  errorCategory?: string;
  /**
   * Per-job parameters mirrored from `/api/jobs/[id]`. `num` is the
   * application number for any offer-scoped job (evaluate, interview-prep,
   * research, tailor-cv, cover-letter, outreach, apply, follow-up). The
   * legacy `id` slot is kept for backwards compatibility with jobs that
   * predate the num-keyed contract.
   */
  params?: Record<string, unknown> & { num?: number; id?: string };
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
  /** Offer number for offer-scoped jobs — drives the "Tailor CV · #2" title. */
  num?: number;
  /** Monotonic creation order — stable across bringToFront reshuffles.
   * Drives the strip's "2/5" counter and ‹ › cycling. */
  seq: number;
  snapshot: JobSnapshot | null;
  logsOpen: boolean;
}

interface ChatJobsState {
  /** All tracked jobs, keyed by jobId. */
  jobs: Record<string, JobEntry>;
  /** Render order, back → active (last entry is the ACTIVE strip row). */
  order: string[];
  /** Persistent bubble badge: ids of TERMINAL (done or error) jobs the user
   * has already acknowledged (chat opened, or the job finished while open).
   * Ephemeral — deliberately NOT persisted, so a fresh tab re-alerts. */
  seenTerminalIds: string[];
  _resolvers: Map<string, { resolve: TerminalResolver; reject: TerminalRejecter }>;
  startJob: (jobId: string, kind: string, num?: number) => void;
  setSnapshot: (jobId: string, snap: JobSnapshot) => void;
  dismiss: (jobId: string) => void;
  bringToFront: (jobId: string) => void;
  /** Make the prev (-1) / next (+1) job IN CREATION ORDER the active strip
   * row, wrapping around — the ‹ › arrows. */
  cycleActive: (dir: 1 | -1) => void;
  toggleLogs: (jobId: string) => void;
  waitForTerminal: (jobId: string) => Promise<JobSnapshot>;
  /** Marks every currently-terminal (done or error) job as seen (dedup) —
   * called when the chat opens, and whenever a tracked job reaches a
   * terminal state while it's already open. */
  markTerminalSeen: () => void;
}

// R-26 — sessionStorage key for in-flight jobs (a LIST). DELIBERATELY kept
// at the deck-era name so jobs started before the deck→strip swap re-attach
// after it. Inherited on tab duplication and the hydration-deadline reload.
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
        Boolean(j) &&
        j.snapshot?.status !== 'done' &&
        j.snapshot?.status !== 'error' &&
        j.snapshot?.status !== 'cancelled',
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

export const useChatJobsStore = create<ChatJobsState>((set, get) => ({
  jobs: {},
  order: [],
  seenTerminalIds: [],
  _resolvers: new Map(),
  startJob(jobId, kind, num) {
    set(s => {
      if (s.jobs[jobId]) {
        // Already tracked (re-attach) — just make it the active row.
        return { order: [...s.order.filter(id => id !== jobId), jobId] };
      }
      const entry: JobEntry = {
        jobId,
        kind,
        num,
        seq: nextSeq++,
        snapshot: null,
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
    if (snap.status === 'done' || snap.status === 'error' || snap.status === 'cancelled') {
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
      return {
        jobs: rest,
        order: s.order.filter(id => id !== jobId),
        seenTerminalIds: s.seenTerminalIds.filter(id => id !== jobId),
      };
    });
    const s = get();
    persistActiveJobs(inFlight(s.jobs, s.order));
  },
  bringToFront(jobId) {
    set(s => (s.jobs[jobId] ? { order: [...s.order.filter(id => id !== jobId), jobId] } : s));
  },
  cycleActive(dir) {
    const { jobs, order } = get();
    if (order.length < 2) return;
    const bySeq = [...order].sort((a, b) => jobs[a].seq - jobs[b].seq);
    const active = order[order.length - 1];
    const idx = bySeq.indexOf(active);
    const target = bySeq[(idx + dir + bySeq.length) % bySeq.length];
    get().bringToFront(target);
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
      if (
        snap &&
        (snap.status === 'done' || snap.status === 'error' || snap.status === 'cancelled')
      ) {
        resolve(snap);
        return;
      }
      get()._resolvers.set(jobId, { resolve, reject });
    });
  },
  markTerminalSeen() {
    set(s => {
      const terminalIds = Object.values(s.jobs)
        .filter(j => j.snapshot?.status === 'error' || j.snapshot?.status === 'done')
        .map(j => j.jobId);
      if (terminalIds.length === 0) return s;
      const seen = new Set(s.seenTerminalIds);
      let changed = false;
      for (const id of terminalIds) {
        if (!seen.has(id)) {
          seen.add(id);
          changed = true;
        }
      }
      return changed ? { seenTerminalIds: [...seen] } : s;
    });
  },
}));
