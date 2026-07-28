'use client';

// src/features/chat/chat-jobs-runtime.tsx
//
// Always-mounted (from ChatHost, OUTSIDE the open-state conditional) side-
// effect host for the chat jobs feed:
//   - useJobDiscovery: surfaces jobs started outside this tab (scheduler,
//     CLI/API, other tabs) — they never pass through a client startJob call
//   - sessionStorage re-attach (R-26): re-adds every persisted in-flight job
//     after a tab duplicate or hydration-deadline reload
//   - one poller per tracked job — polling continues while the chat card is
//     CLOSED (the bubble ring/badge and waitForTerminal depend on it)
//   - polite aria-live announcements on job start / done / error

import { useEffect, useRef, useState } from 'react';
import { useJobDiscovery } from '@/hooks/use-job-discovery';
import { jobTitle } from './chat-jobs-lib';
import { readPersistedActiveJobs, useChatJobsStore } from './chat-jobs-store';
import { useChatJobPoll } from './use-chat-job-poll';

function JobPoller({ jobId }: { jobId: string }) {
  useChatJobPoll(jobId);
  return null;
}

export function ChatJobsRuntime() {
  const order = useChatJobsStore(s => s.order);
  useJobDiscovery();

  // R-26: re-attach to in-flight jobs after a tab duplicate or
  // hydration-deadline reload — re-adds every persisted job.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const live = useChatJobsStore.getState();
    for (const j of readPersistedActiveJobs()) {
      if (!live.jobs[j.jobId]) live.startJob(j.jobId, j.kind, j.num);
    }
  }, []);

  return (
    <>
      {order.map(id => (
        <JobPoller key={id} jobId={id} />
      ))}
      <ChatJobsAnnouncer />
    </>
  );
}

/** One polite live region for the whole feed. Announces "X started" for jobs
 * added after mount (the initial batch — reload re-attach / first discovery
 * sweep — is seeded silently to avoid reload chatter) and "X finished" /
 * "X failed" on terminal transitions. */
function ChatJobsAnnouncer() {
  const jobs = useChatJobsStore(s => s.jobs);
  const [message, setMessage] = useState('');
  const seen = useRef<Map<string, 'started' | 'done' | 'error' | 'cancelled'>>(new Map());
  const seeded = useRef(false);

  useEffect(() => {
    const first = !seeded.current;
    seeded.current = true;
    for (const [id, entry] of Object.entries(jobs)) {
      const status = entry.snapshot?.status;
      const phase =
        status === 'done'
          ? 'done'
          : status === 'error'
            ? 'error'
            : status === 'cancelled'
              ? 'cancelled'
              : 'started';
      const prev = seen.current.get(id);
      if (prev === phase) continue;
      seen.current.set(id, phase);
      if (first && phase === 'started') continue; // silent seed
      const title = jobTitle(entry.kind, entry.num);
      if (phase === 'started' && prev === undefined) setMessage(`${title} started`);
      else if (phase === 'done') setMessage(`${title} finished`);
      else if (phase === 'error') setMessage(`${title} failed`);
      else if (phase === 'cancelled') setMessage(`${title} cancelled`);
    }
    // Prune dismissed ids so a re-tracked id can announce again.
    for (const id of [...seen.current.keys()]) if (!jobs[id]) seen.current.delete(id);
  }, [jobs]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {message}
    </span>
  );
}
