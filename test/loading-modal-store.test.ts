// Multi-job loading-modal store: ordered deck, per-job snapshots/dismiss,
// per-job waitForTerminal, sessionStorage re-attach list.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  readPersistedActiveJobs,
  useLoadingModalStore,
} from '@/components/loading-modal/loading-modal-store';
import { deriveElapsed } from '@/components/loading-modal/phases';

function resetStore() {
  const s = useLoadingModalStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

describe('loading-modal store (deck)', () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
  });

  it('stacks concurrent jobs with the newest in front', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const { order, jobs } = useLoadingModalStore.getState();
    expect(order).toEqual(['job-a', 'job-b']); // back → front
    expect(jobs['job-b'].num).toBe(16);
    expect(jobs['job-a'].kind).toBe('evaluate');
  });

  it('bringToFront reorders without dropping jobs', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.bringToFront('job-a');
    expect(useLoadingModalStore.getState().order).toEqual(['job-b', 'job-a']);
  });

  it('dismiss removes only that job and rejects its waiter', async () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const waiter = s.waitForTerminal('job-a');
    s.dismiss('job-a');
    await expect(waiter).rejects.toMatchObject({ name: 'AbortError' });
    const { order, jobs } = useLoadingModalStore.getState();
    expect(order).toEqual(['job-b']);
    expect(jobs['job-a']).toBeUndefined();
  });

  it('terminal snapshot resolves waitForTerminal for the right job', async () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const waiter = s.waitForTerminal('job-b');
    s.setSnapshot('job-b', { status: 'done', output: '' });
    await expect(waiter).resolves.toMatchObject({ status: 'done' });
    expect(useLoadingModalStore.getState().jobs['job-a']).toBeDefined();
  });

  it('persists in-flight jobs for re-attach and prunes terminal ones', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    expect(readPersistedActiveJobs()).toEqual([
      { jobId: 'job-a', kind: 'evaluate', num: 12 },
      { jobId: 'job-b', kind: 'cover-letter', num: 16 },
    ]);
    s.setSnapshot('job-a', { status: 'done', output: '' });
    expect(readPersistedActiveJobs()).toEqual([{ jobId: 'job-b', kind: 'cover-letter', num: 16 }]);
  });

  it('setSnapshot on an unknown jobId is a safe no-op (dismiss race)', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.dismiss('job-a');
    // A stale in-flight poll resolving after dismiss must not resurrect the job.
    s.setSnapshot('job-a', { status: 'done', output: '' });
    const { jobs, order } = useLoadingModalStore.getState();
    expect(jobs['job-a']).toBeUndefined();
    expect(order).toEqual([]);
  });

  it('assigns a stable creation seq that survives bringToFront reshuffles', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.startJob('job-c', 'research', 16);
    const { jobs } = useLoadingModalStore.getState();
    expect(jobs['job-a'].seq).toBeLessThan(jobs['job-b'].seq);
    expect(jobs['job-b'].seq).toBeLessThan(jobs['job-c'].seq);
    s.bringToFront('job-a');
    const after = useLoadingModalStore.getState().jobs;
    expect(after['job-a'].seq).toBeLessThan(after['job-b'].seq); // unchanged
  });

  it('cycleFront pages through jobs in creation order with wrap-around', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.startJob('job-c', 'research', 16);
    // Front is job-c (created last). next → wraps to job-a (created first).
    s.cycleFront(1);
    expect(useLoadingModalStore.getState().order.at(-1)).toBe('job-a');
    // prev from job-a → wraps back to job-c.
    s.cycleFront(-1);
    expect(useLoadingModalStore.getState().order.at(-1)).toBe('job-c');
    // prev again → job-b (the one before job-c in creation order).
    s.cycleFront(-1);
    expect(useLoadingModalStore.getState().order.at(-1)).toBe('job-b');
  });

  it('cycleFront is a no-op with fewer than two jobs', () => {
    const s = useLoadingModalStore.getState();
    s.cycleFront(1); // empty deck — no throw
    s.startJob('job-a', 'evaluate', 12);
    s.cycleFront(1);
    expect(useLoadingModalStore.getState().order).toEqual(['job-a']);
  });

  it('re-attach via startJob is idempotent and cannot revive a dismissed job', () => {
    const s = useLoadingModalStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    // Re-attaching an existing job only brings it to front, no duplicate.
    s.startJob('job-a', 'evaluate', 12);
    expect(useLoadingModalStore.getState().order).toEqual(['job-b', 'job-a']);
    // Dismissing prunes persistence, so a reload would not re-add it.
    s.dismiss('job-a');
    expect(readPersistedActiveJobs()).toEqual([{ jobId: 'job-b', kind: 'cover-letter', num: 16 }]);
  });
});

describe('deriveElapsed', () => {
  it('freezes at finishedAt − startedAt for terminal jobs', () => {
    expect(deriveElapsed('2026-06-01T00:00:00.000Z', '2026-06-01T00:01:23.000Z')).toBe(83);
  });

  it('falls back to wall-clock when finishedAt is missing or invalid', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    expect(deriveElapsed(tenSecondsAgo)).toBe(10);
    expect(deriveElapsed(tenSecondsAgo, 'not-a-date')).toBe(10);
    expect(deriveElapsed(tenSecondsAgo, null)).toBe(10);
  });

  it('returns 0 without a startedAt', () => {
    expect(deriveElapsed(undefined, '2026-06-01T00:01:23.000Z')).toBe(0);
  });
});
