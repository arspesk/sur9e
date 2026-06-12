'use client';

import { useQuery } from '@tanstack/react-query';
import { JOB_TYPES } from '@/lib/schemas/jobs';

// Query every job kind from the canonical registry instead of re-listing the
// per-offer ones — a duplicated list silently drifts (it's how 'negotiate'
// fell out of the lock after being added to JOB_TYPES everywhere else).
// System kinds (scan, batch-evaluate, screen, …) carry no `num`, so the
// numeric-num guard below skips them and they never lock a row.

interface ActiveJobsResponse {
  [type: string]: Array<{ num?: number; id?: string }>;
}

export interface JobLockResult {
  /** Set of application nums that have any in-flight job. */
  lockedNums: Set<number>;
  /** Maps each locked num to the job type (first match wins). */
  lockReason: Map<number, string>;
}

async function fetchActiveJobs(): Promise<JobLockResult> {
  const res = await fetch(`/api/jobs/active?types=${JOB_TYPES.join(',')}`);
  if (!res.ok) return { lockedNums: new Set(), lockReason: new Map() };
  const data: ActiveJobsResponse = await res.json();
  const lockedNums = new Set<number>();
  const lockReason = new Map<number, string>();
  for (const type of JOB_TYPES) {
    for (const job of data[type] ?? []) {
      if (typeof job.num === 'number') {
        lockedNums.add(job.num);
        if (!lockReason.has(job.num)) lockReason.set(job.num, type);
      }
    }
  }
  return { lockedNums, lockReason };
}

/**
 * Returns the set of locked application nums and a reason map (job type) for each.
 * Replaces the previous bare-Set API — consumers update: `lockedNums.has(num)` instead of `useJobLock().has(num)`.
 */
export function useJobLock(): JobLockResult {
  const { data } = useQuery({
    queryKey: ['jobs-active-lock'],
    queryFn: fetchActiveJobs,
    refetchInterval: 4000,
    staleTime: 3000,
  });
  return data ?? { lockedNums: new Set(), lockReason: new Map() };
}
