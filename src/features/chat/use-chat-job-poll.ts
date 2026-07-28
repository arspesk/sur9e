'use client';

// src/features/chat/use-chat-job-poll.ts
//
// Per-job status polling for the chat jobs strip — the deck card's poll,
// elapsed-timer, and terminal-invalidation effects, extracted into hooks.
// Mounted per tracked job by ChatJobsRuntime so polling continues while the
// chat card is CLOSED (the bubble ring and waitForTerminal depend on it).

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { deriveElapsed } from './chat-jobs-lib';
import { useChatJobsStore } from './chat-jobs-store';

const POLL_MS = 2000;

export function useChatJobPoll(jobId: string): void {
  const setSnapshot = useChatJobsStore(s => s.setSnapshot);
  const num = useChatJobsStore(s => s.jobs[jobId]?.num);
  const status = useChatJobsStore(s => s.jobs[jobId]?.snapshot?.status);
  const isTerminal = status === 'done' || status === 'error' || status === 'cancelled';

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll this job's status.
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
          const prev = useChatJobsStore.getState().jobs[jobId]?.snapshot;
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
        if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
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

  // Jobs finishing in the BACKGROUND (scan merging new offers, a generation
  // completing while the user sits on /offers) must surface without a manual
  // reload. Modal flows that await waitForTerminal invalidate for
  // themselves; this poller is the only observer for everything else — so on
  // the terminal transition, invalidate the data caches once.
  const queryClient = useQueryClient();
  const invalidatedRef = useRef(false);
  useEffect(() => {
    if (!isTerminal || invalidatedRef.current) return;
    invalidatedRef.current = true;
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['report'] });
    if (num != null) {
      queryClient.invalidateQueries({ queryKey: ['application', num] });
    }
  }, [isTerminal, num, queryClient]);
}

/** Ticking elapsed seconds for a tracked job — keyed on the startedAt VALUE
 * so poll-driven object replacement doesn't churn the interval. Terminal
 * jobs freeze at their real duration (finishedAt − startedAt). */
export function useJobElapsed(jobId: string | undefined): number {
  const startedAt = useChatJobsStore(s => (jobId ? s.jobs[jobId]?.snapshot?.startedAt : undefined));
  const finishedAt = useChatJobsStore(s =>
    jobId ? (s.jobs[jobId]?.snapshot?.finishedAt ?? undefined) : undefined,
  );
  const status = useChatJobsStore(s => (jobId ? s.jobs[jobId]?.snapshot?.status : undefined));
  const isTerminal = status === 'done' || status === 'error' || status === 'cancelled';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    if (isTerminal) {
      setElapsed(deriveElapsed(startedAt, finishedAt));
      return;
    }
    setElapsed(deriveElapsed(startedAt));
    const t = setInterval(() => setElapsed(deriveElapsed(startedAt)), 1000);
    return () => clearInterval(t);
  }, [startedAt, finishedAt, isTerminal]);
  return elapsed;
}
