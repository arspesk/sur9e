'use client';

/* components/loading-modal/loading-modal.tsx
 *
 * Deck of job-progress cards (bottom-right). One card per in-flight job;
 * the newest is in front, cards behind peek out above it and click-to-front
 * (card-shuffle). Each card polls its own /api/jobs/{id}. The body shows a
 * rotating funny prompt for the running mode (shared with the in-editor
 * runningMode card) instead of the old phase checklist.
 */

import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useJobDiscovery } from '@/hooks/use-job-discovery';
import { promptsForMode } from '@/lib/funny-prompts';
import { JOB_TYPES_BY_TYPE } from '@/lib/job-types';
import { LoadingModalActions } from './components/loading-modal-actions';
import { LoadingModalHeader } from './components/loading-modal-header';
import { LoadingModalLogs } from './components/loading-modal-logs';
import { LoadingModalProgress } from './components/loading-modal-progress';
import { readPersistedActiveJobs, useLoadingModalStore } from './loading-modal-store';
import { capitalise, deriveElapsed, parseLogLines } from './phases';

const POLL_MS = 2000;

export function LoadingModalHost() {
  const order = useLoadingModalStore(s => s.order);
  const hasJobs = order.length > 0;
  const deckRef = useRef<HTMLDivElement>(null);

  // Surface jobs started outside this tab (scheduler, CLI/API, other tabs)
  // as deck cards — they never pass through a client startJob call.
  useJobDiscovery();

  // R-26: re-attach to in-flight jobs after a tab duplicate or
  // hydration-deadline reload — re-adds every persisted job.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const live = useLoadingModalStore.getState();
    for (const j of readPersistedActiveJobs()) {
      if (!live.jobs[j.jobId]) live.startJob(j.jobId, j.kind, j.num);
    }
  }, []);

  // Publish the deck's height (+ gap) as --corner-deck-clearance on <html>
  // so the toast column's `bottom` clears it. A CSS var instead of a shared
  // positioned host because the z-relationships differ: toasts (110) must
  // clear dialogs (100), the deck (95) must stay below them — one wrapping
  // host with a single z-index would break one or the other.
  useEffect(() => {
    const root = document.documentElement;
    const el = deckRef.current;
    if (!hasJobs || !el) {
      root.style.setProperty('--corner-deck-clearance', '0px');
      return;
    }
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.style.setProperty('--corner-deck-clearance', `${h + 8}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--corner-deck-clearance', '0px');
    };
  }, [hasJobs]);

  if (!hasJobs) return null;

  return (
    <div id="loading-modal-deck" ref={deckRef} data-count={order.length}>
      {order.map((jobId, i) => (
        <LoadingModalCard
          key={jobId}
          jobId={jobId}
          depth={order.length - 1 - i}
          isFront={i === order.length - 1}
        />
      ))}
    </div>
  );
}

/** Max simultaneously VISIBLE cards (front + peeking strips). Deeper cards
 * stay mounted (their polling must continue) but are hidden via
 * [data-overflow] — the nav arrows page through them. */
const MAX_VISIBLE = 3;

/** Rotating funny prompt for the running mode — 4s cadence, same pool as
 * the in-editor runningMode card. `inline` renders the compact variant used
 * inside the collapsed card's header (same spinner + accent pulse, no body
 * padding) so collapsed and expanded read identically. */
function FunnyPrompt({ kind, inline = false }: { kind: string; inline?: boolean }) {
  const prompts = useMemo(() => promptsForMode(kind), [kind]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % prompts.length), 4000);
    return () => clearInterval(t);
  }, [prompts.length]);
  return (
    <span
      className={`loading-modal__funny${inline ? ' loading-modal__funny--inline' : ''}`}
      aria-hidden="true"
    >
      <LoaderCircle className="loading-modal__spinner" size={14} aria-hidden="true" />
      {prompts[idx]}
    </span>
  );
}

interface LoadingModalCardProps {
  jobId: string;
  /** 0 = front card; 1+ = cards behind (peek offset). */
  depth: number;
  isFront: boolean;
}

function LoadingModalCard({ jobId, depth, isFront }: LoadingModalCardProps) {
  const entry = useLoadingModalStore(s => s.jobs[jobId]);
  const setSnapshot = useLoadingModalStore(s => s.setSnapshot);
  const dismiss = useLoadingModalStore(s => s.dismiss);
  const bringToFront = useLoadingModalStore(s => s.bringToFront);
  const cycleFront = useLoadingModalStore(s => s.cycleFront);
  const toggleCollapse = useLoadingModalStore(s => s.toggleCollapse);
  const toggleLogs = useLoadingModalStore(s => s.toggleLogs);
  const total = useLoadingModalStore(s => s.order.length);
  // 1-based rank of this job in CREATION order — the "2/5" nav counter.
  // Stable across bringToFront reshuffles (seq, not order index).
  const position = useLoadingModalStore(s => {
    const me = s.jobs[jobId];
    if (!me) return 0;
    let rank = 1;
    for (const id of s.order) if (s.jobs[id].seq < me.seq) rank++;
    return rank;
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const asideRef = useRef<HTMLElement>(null);

  const snapshot = entry?.snapshot ?? null;

  // A job-progress card is a non-modal `role="status"` live region — it must
  // NOT trap global keyboard focus (WCAG 2.1.2 No Keyboard Trap). Its Dismiss /
  // collapse / Show-logs buttons stay naturally Tab-reachable in DOM order
  // while the rest of the app (rail nav, filters, page content) remains
  // keyboard-navigable. (Previously a focus trap here locked Tab to the front
  // card's 3 buttons app-wide for the whole duration of a running job.)

  // Poll this card's job status.
  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { credentials: 'same-origin' });
        if (r.status === 404) {
          // The job record under data/jobs/ is gone (cleaned up or never
          // written) — typically a sessionStorage re-attach (R-26) to a
          // stale id. We cannot know how the job ended, so this is an ERROR
          // terminal state, never a fabricated success: waitForTerminal
          // consumers must not toast success or offer "View report".
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          const prev = useLoadingModalStore.getState().jobs[jobId]?.snapshot;
          setSnapshot(jobId, {
            ...prev,
            status: 'error',
            error: 'job record not found — outcome unknown',
            output: prev?.output ?? '',
          });
          return;
        }
        if (!r.ok) return;
        const data = await r.json();
        setSnapshot(jobId, data);
        if (data.status === 'done' || data.status === 'error') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // network blip — keep polling
      }
    }
    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, setSnapshot]);

  // Elapsed timer — keyed on the startedAt VALUE so poll-driven object
  // replacement doesn't churn the interval. Terminal jobs freeze at their
  // real duration (finishedAt − startedAt) instead of ticking wall-clock.
  const startedAt = snapshot?.startedAt;
  const finishedAt = snapshot?.finishedAt ?? undefined;
  const isTerminal = snapshot?.status === 'done' || snapshot?.status === 'error';
  useEffect(() => {
    if (!startedAt) return;
    if (isTerminal) {
      setElapsed(deriveElapsed(startedAt, finishedAt));
      return;
    }
    const t = setInterval(() => setElapsed(deriveElapsed(startedAt)), 1000);
    return () => clearInterval(t);
  }, [startedAt, finishedAt, isTerminal]);

  // Jobs finishing in the BACKGROUND (scan merging new offers, a generation
  // completing while the user sits on /offers) must surface without a manual
  // reload. The modal flows that await waitForTerminal invalidate for
  // themselves; this card is the only observer for everything else — so on
  // the terminal transition, invalidate the data caches once.
  const queryClient = useQueryClient();
  const invalidatedRef = useRef(false);
  useEffect(() => {
    if (!isTerminal || invalidatedRef.current) return;
    invalidatedRef.current = true;
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['report'] });
    if (entry?.num != null) {
      queryClient.invalidateQueries({ queryKey: ['application', entry.num] });
    }
  }, [isTerminal, entry?.num, queryClient]);

  if (!entry || !snapshot) return null;

  const { kind, num, collapsed, logsOpen } = entry;
  const isDone = snapshot.status === 'done';
  const isError = snapshot.status === 'error';
  // Time-based progress: fill = elapsed over the mode's rough estimate
  // (registry estimateS), capped at 96% so the bar never claims "done"
  // while the job is still running. Overdue jobs just sit at the cap.
  const estimateS = JOB_TYPES_BY_TYPE[kind]?.estimateS ?? 300;
  const percent = Math.min(96, Math.round((elapsed / estimateS) * 100));

  // 'tailor-cv' → 'Tailor CV' for user-facing copy. The title stays SHORT
  // and constant across states ("Tailor CV · #2") so it never truncates —
  // the pulsing prompt says "generating", the ✓/! icon + actions say
  // done/error. Numless jobs (scan, batch) show just the kind label.
  const kindLabel = capitalise(kind.replace(/-/g, ' ').replace(/\bcv\b/i, 'CV'));
  const title = num != null ? `${kindLabel} · #${num}` : kindLabel;

  const logLines = parseLogLines(snapshot.output ?? '');

  // Fallback-retry note: the runner stamped `fallback` on the record when the
  // worker recovered (or attempted recovery) on the fallback pair.
  const fallback = snapshot.fallback;

  function handleClose() {
    if (snapshot && (snapshot.status === 'running' || snapshot.status === 'queued')) {
      toggleCollapse(jobId);
    } else {
      dismiss(jobId);
    }
  }

  // Where the done-card's primary action can navigate. Offer-scoped jobs
  // carry a num (stamped on params by the runner for screen jobs) and open
  // that report; numless system jobs (scan, batch-evaluate) have no single
  // report — their results land in the offers table, so the primary becomes
  // "View offers" instead of a "View report" that silently goes nowhere.
  const reportTarget = snapshot?.params?.num ?? snapshot?.params?.id ?? num;

  function handlePrimary() {
    if (isError) {
      dismiss(jobId);
      return;
    }
    if (isDone) {
      dismiss(jobId);
      // window.location so the destination re-fetches fresh data (router
      // cache would serve the pre-job snapshot).
      window.location.href =
        reportTarget != null ? `/report/${encodeURIComponent(String(reportTarget))}` : '/offers';
    }
  }

  return (
    <aside
      ref={asideRef}
      className="loading-modal-card"
      role="status"
      data-front={isFront ? 'true' : 'false'}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-logs-open={logsOpen ? 'true' : 'false'}
      data-overflow={depth >= MAX_VISIBLE ? 'true' : 'false'}
      style={{ '--depth': depth } as React.CSSProperties}
      onClick={isFront ? undefined : () => bringToFront(jobId)}
    >
      {/* Terminal-transition announcement for SR users. A dedicated
          polite live region (rendered for every card, not just the front
          one) so a job finishing in the background still announces — the
          card's own chrome stays aria-live="off" to avoid spamming the
          per-poll funny-prompt churn. Text renders only once the job is
          terminal so the region is silent until there's something to say. */}
      <span className="sr-only" aria-live="polite">
        {isTerminal ? `${title} ${isError ? 'failed' : 'complete'}` : ''}
      </span>
      <LoadingModalProgress percent={percent} isDone={isDone} isError={isError} />
      <LoadingModalHeader
        title={title}
        isDone={isDone}
        isError={isError}
        collapsed={collapsed}
        elapsed={elapsed}
        sub={<FunnyPrompt kind={kind} inline />}
        snapshot={snapshot}
        nav={
          isFront && total > 1
            ? {
                position,
                total,
                onPrev: () => cycleFront(-1),
                onNext: () => cycleFront(1),
              }
            : undefined
        }
        onToggleCollapse={() => toggleCollapse(jobId)}
        onClose={handleClose}
      />
      <div className="loading-modal__body">
        {!isDone && !isError && <FunnyPrompt kind={kind} />}
        {(isDone || isError) && (
          <LoadingModalActions
            isError={isError}
            hasReportTarget={reportTarget != null}
            onPrimary={handlePrimary}
            onDismiss={() => dismiss(jobId)}
          />
        )}
        {fallback && (
          <p className="loading-modal__fallback" data-testid="job-fallback-note">
            ⤷ fallback: {fallback.from.provider}·{fallback.from.model} → {snapshot.provider}·
            {snapshot.model} ({fallback.reason})
          </p>
        )}
        <LoadingModalLogs lines={logLines} open={logsOpen} onToggle={() => toggleLogs(jobId)} />
      </div>
    </aside>
  );
}
