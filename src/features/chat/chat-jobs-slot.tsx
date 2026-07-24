'use client';

// src/features/chat/chat-jobs-slot.tsx
//
// The relocated job-progress deck: a compact strip directly under the chat
// header. Shows the ACTIVE job (last in store order); ‹ i/N › arrows cycle
// concurrent jobs in creation order. Terminal states show ✓/✕ + a primary
// action, then clear on action or ×. Logs are opt-in (collapsed disclosure)
// so the strip stays clean — the deck's rotating funny-prompt line was
// deliberately dropped for the same reason (running-mode-view keeps it).
//
// Purely presentational: it reads the chat jobs store and renders the
// active row. Snapshot polling (useChatJobPoll) is owned by ChatJobsRuntime,
// mounted once elsewhere, so it keeps running for every tracked job
// regardless of which one is currently cycled into view.

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { JobType } from '@/lib/server/jobs';
import { cleanErrorLine } from '@/lib/terminal-noise';
import { startJobAction } from '@/server/actions/jobs';
import { fmtElapsed, jobTitle, parseLogLines, reportTarget, timePercent } from './chat-jobs-lib';
import { useChatJobsStore } from './chat-jobs-store';
import { useJobElapsed } from './use-chat-job-poll';

export function ChatJobsSlot() {
  const order = useChatJobsStore(s => s.order);
  const activeId = order.length > 0 ? order[order.length - 1] : undefined;
  if (!activeId) return null;
  return <ChatJobsRow jobId={activeId} total={order.length} />;
}

function ChatJobsRow({ jobId, total }: { jobId: string; total: number }) {
  const entry = useChatJobsStore(s => s.jobs[jobId]);
  const dismiss = useChatJobsStore(s => s.dismiss);
  const startJob = useChatJobsStore(s => s.startJob);
  const cycleActive = useChatJobsStore(s => s.cycleActive);
  const toggleLogs = useChatJobsStore(s => s.toggleLogs);
  const [retrying, setRetrying] = useState(false);
  // 1-based rank in CREATION order — stable across cycling (seq, not index).
  const position = useChatJobsStore(s => {
    const me = s.jobs[jobId];
    if (!me) return 0;
    let rank = 1;
    for (const id of s.order) if (s.jobs[id].seq < me.seq) rank++;
    return rank;
  });
  const elapsed = useJobElapsed(jobId);

  if (!entry) return null;
  const { kind, num, logsOpen } = entry;
  const snapshot = entry.snapshot;
  const isDone = snapshot?.status === 'done';
  const isError = snapshot?.status === 'error';
  const isTerminal = isDone || isError;
  const percent = isDone ? 100 : timePercent(elapsed, kind);
  const title = jobTitle(kind, num);
  const target = reportTarget(entry);
  const logLines = parseLogLines(snapshot?.output ?? '');
  const fallback = snapshot?.fallback;
  // Scrub the persisted error one more time before it hits the DOM: the runner
  // already writes a clean cause via workerErrorFromOutput, but the poll layer
  // can set a raw fallback (e.g. the 404 "outcome unknown" path) and legacy
  // records predate the sanitize — never render ANSI or a `<<<SUR9E_*>>>` leak.
  const errorText = isError && snapshot?.error ? cleanErrorLine(snapshot.error) : '';
  // Terminal-state announcement for SR users — mirrors chat-card's
  // stream-status live region. Non-terminal states stay silent; the
  // spinner + elapsed tick would spam an aria-live region every second.
  const announcement = isDone ? `${title} finished` : isError ? `${title} failed` : '';

  function handlePrimary() {
    dismiss(jobId);
    // window.location so the destination re-fetches fresh data (router
    // cache would serve the pre-job snapshot).
    window.location.href =
      target != null ? `/report/${encodeURIComponent(String(target))}` : '/offers';
  }

  // Re-run the SAME mode with the SAME params. Reconstruct the params bag from
  // the failed job's mirrored record (offer-scoped modes need only { num },
  // screen needs its url — both live on snapshot.params) and re-spawn through
  // the exact path the original start took (startJobAction → store.startJob),
  // so no confirm re-prompt and no bespoke retry endpoint. The runtime poller
  // (ChatJobsRuntime) owns polling for the fresh id.
  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    const retryParams: Record<string, unknown> = {
      ...(snapshot?.params ?? {}),
      ...(num != null ? { num } : {}),
    };
    try {
      const result = await startJobAction({ kind: kind as JobType, params: retryParams });
      if ('id' in result && result.id) {
        // Clean swap: drop the failed row, track the fresh job. Reached only on
        // a real spawn — this row unmounts right after, so no post-unmount
        // state write below.
        dismiss(jobId);
        startJob(result.id, kind, num);
        return;
      }
      // conflict / setupRequired → no new job spawned; leave the failed row up
      // so the user still sees the failure and can act on it.
    } catch {
      // Spawn threw (num vanished, network) — leave the failed row in place.
    }
    setRetrying(false);
  }

  return (
    <div className="chat-jobs" data-logs-open={logsOpen ? 'true' : 'false'}>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <div className="chat-jobs__progress">
        <div
          className={`chat-jobs__progress-fill ${isDone ? 'is-done' : isError ? 'is-error' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="chat-jobs__row">
        {!isTerminal && <span className="chat-jobs__spinner" aria-hidden="true" />}
        {isDone && (
          <span className="chat-jobs__check" aria-hidden="true">
            ✓
          </span>
        )}
        {isError && (
          <span className="chat-jobs__cross" aria-hidden="true">
            ✕
          </span>
        )}
        <span className="chat-jobs__title" title={title}>
          {title}
        </span>
        <span className="chat-jobs__elapsed">{fmtElapsed(elapsed)}</span>
        {total > 1 && (
          <span className="chat-jobs__nav">
            <button
              type="button"
              className="chat-jobs__nav-btn"
              aria-label="Previous job"
              onClick={() => cycleActive(-1)}
            >
              <ChevronLeft size={12} aria-hidden="true" />
            </button>
            <span className="chat-jobs__nav-count" aria-label={`Job ${position} of ${total}`}>
              {position}/{total}
            </span>
            <button
              type="button"
              className="chat-jobs__nav-btn"
              aria-label="Next job"
              onClick={() => cycleActive(1)}
            >
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </span>
        )}
        <button
          type="button"
          className="chat-jobs__logs-toggle"
          aria-expanded={logsOpen}
          aria-label={logsOpen ? 'Hide logs' : 'Show logs'}
          onClick={() => toggleLogs(jobId)}
        >
          <ChevronDown className="chat-jobs__logs-chev" size={12} aria-hidden="true" />
        </button>
        {isTerminal && (
          <button
            type="button"
            className="chat-jobs__close"
            aria-label="Dismiss"
            onClick={() => dismiss(jobId)}
          >
            ×
          </button>
        )}
      </div>
      {errorText && <p className="chat-jobs__error">{errorText}</p>}
      {isTerminal && (
        <div className="chat-jobs__actions">
          {isError ? (
            <>
              <button
                type="button"
                className="chat-jobs__action-primary"
                disabled={retrying}
                onClick={handleRetry}
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
              <button
                type="button"
                className="chat-jobs__action-secondary"
                onClick={() => dismiss(jobId)}
              >
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" className="chat-jobs__action-primary" onClick={handlePrimary}>
              {target != null ? 'View report' : 'View offers'}
            </button>
          )}
        </div>
      )}
      {fallback && (
        <p className="chat-jobs__fallback" data-testid="job-fallback-note">
          ⤷ fallback: {fallback.from.provider}·{fallback.from.model} → {snapshot?.provider}·
          {snapshot?.model} ({fallback.reason})
        </p>
      )}
      {logsOpen && (
        <div className="chat-jobs__logs">
          <pre>{logLines.length > 0 ? logLines.join('\n') : 'Waiting for output…'}</pre>
        </div>
      )}
    </div>
  );
}
