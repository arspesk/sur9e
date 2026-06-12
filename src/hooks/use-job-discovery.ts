'use client';

// Discovery poll: surface ACTIVE jobs this tab doesn't track as deck cards.
// The loading-modal store only learns about jobs via startJob (client
// actions + sessionStorage re-attach), so anything started elsewhere — the
// scan scheduler, the CLI/API, another open tab — ran with no card until
// this poll picks it up. Covers every job kind: system jobs (scan,
// batch-evaluate, screen) and offer-scoped jobs (evaluate, tailor-cv, …),
// whose `num` is forwarded so the card title reads "… for offer #N".
//
// Already-tracked ids are skipped — the initiating tab is unaffected, and
// startJob's re-attach branch would otherwise yank cards to the front on
// every poll.

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';
import { JOB_TYPES } from '@/lib/job-types';

const ALL_JOB_TYPES = JOB_TYPES.map(t => t.type);
const POLL_MS = 5000;

interface ActiveJobs {
  [type: string]: Array<{ id: string; num?: number; startedAt: string }>;
}

async function fetchActiveJobs(): Promise<ActiveJobs> {
  const res = await fetch(`/api/jobs/active?types=${ALL_JOB_TYPES.join(',')}`);
  if (!res.ok) return {};
  return (await res.json()) as ActiveJobs;
}

/** Mounted once (LoadingModalHost). Adds a deck card for any active job
 *  this tab doesn't track yet; the deck's own snapshot polling takes over
 *  from there. */
export function useJobDiscovery(): void {
  const { data } = useQuery({
    queryKey: ['job-discovery'],
    queryFn: fetchActiveJobs,
    refetchInterval: POLL_MS,
    staleTime: POLL_MS - 1000,
  });

  useEffect(() => {
    if (!data) return;
    const store = useLoadingModalStore.getState();
    for (const type of ALL_JOB_TYPES) {
      for (const job of data[type] ?? []) {
        if (!store.jobs[job.id]) store.startJob(job.id, type, job.num);
      }
    }
  }, [data]);
}
