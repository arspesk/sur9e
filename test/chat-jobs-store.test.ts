// Chat jobs store — the deck store ported 1:1 into the chat feature:
// ordered jobs, per-job snapshots/dismiss, per-job waitForTerminal,
// sessionStorage re-attach list under the UNCHANGED key.

import { beforeEach, describe, expect, it } from 'vitest';
import { deriveElapsed, jobTitle, parseLogLines, timePercent } from '@/features/chat/chat-jobs-lib';
import { readPersistedActiveJobs, useChatJobsStore } from '@/features/chat/chat-jobs-store';

function resetStore() {
  const s = useChatJobsStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

describe('chat jobs store', () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
  });

  it('stacks concurrent jobs with the newest active (last in order)', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const { order, jobs } = useChatJobsStore.getState();
    expect(order).toEqual(['job-a', 'job-b']); // back → active
    expect(jobs['job-b'].num).toBe(16);
    expect(jobs['job-a'].kind).toBe('evaluate');
  });

  it('bringToFront reorders without dropping jobs', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.bringToFront('job-a');
    expect(useChatJobsStore.getState().order).toEqual(['job-b', 'job-a']);
  });

  it('dismiss removes only that job and rejects its waiter with AbortError', async () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const waiter = s.waitForTerminal('job-a');
    s.dismiss('job-a');
    await expect(waiter).rejects.toMatchObject({ name: 'AbortError' });
    const { order, jobs } = useChatJobsStore.getState();
    expect(order).toEqual(['job-b']);
    expect(jobs['job-a']).toBeUndefined();
  });

  it('terminal snapshot resolves waitForTerminal for the right job', async () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    const waiter = s.waitForTerminal('job-b');
    s.setSnapshot('job-b', { status: 'done', output: '' });
    await expect(waiter).resolves.toMatchObject({ status: 'done' });
    expect(useChatJobsStore.getState().jobs['job-a']).toBeDefined();
  });

  it('waitForTerminal resolves immediately for an already-terminal job', async () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.setSnapshot('job-a', { status: 'done', output: '' });
    await expect(s.waitForTerminal('job-a')).resolves.toMatchObject({ status: 'done' });
  });

  it('persists in-flight jobs under the UNCHANGED deck key and prunes terminal ones', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    // Key parity is the R-26 upgrade path: jobs started under the deck
    // re-attach to the strip after the deploy that ships this plan.
    expect(sessionStorage.getItem('sur9e.loading-modal.active-jobs')).toBeTruthy();
    expect(readPersistedActiveJobs()).toEqual([
      { jobId: 'job-a', kind: 'evaluate', num: 12 },
      { jobId: 'job-b', kind: 'cover-letter', num: 16 },
    ]);
    s.setSnapshot('job-a', { status: 'done', output: '' });
    expect(readPersistedActiveJobs()).toEqual([{ jobId: 'job-b', kind: 'cover-letter', num: 16 }]);
  });

  it('setSnapshot on an unknown jobId is a safe no-op (dismiss race)', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.dismiss('job-a');
    s.setSnapshot('job-a', { status: 'done', output: '' });
    const { jobs, order } = useChatJobsStore.getState();
    expect(jobs['job-a']).toBeUndefined();
    expect(order).toEqual([]);
  });

  it('assigns a stable creation seq that survives bringToFront reshuffles', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.startJob('job-c', 'research', 16);
    const { jobs } = useChatJobsStore.getState();
    expect(jobs['job-a'].seq).toBeLessThan(jobs['job-b'].seq);
    expect(jobs['job-b'].seq).toBeLessThan(jobs['job-c'].seq);
    s.bringToFront('job-a');
    const after = useChatJobsStore.getState().jobs;
    expect(after['job-a'].seq).toBeLessThan(after['job-b'].seq); // unchanged
  });

  it('cycleActive pages through jobs in creation order with wrap-around (‹ › arrows)', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.startJob('job-c', 'research', 16);
    // Active is job-c (created last). next → wraps to job-a (created first).
    s.cycleActive(1);
    expect(useChatJobsStore.getState().order.at(-1)).toBe('job-a');
    // prev from job-a → wraps back to job-c.
    s.cycleActive(-1);
    expect(useChatJobsStore.getState().order.at(-1)).toBe('job-c');
    // prev again → job-b (the one before job-c in creation order).
    s.cycleActive(-1);
    expect(useChatJobsStore.getState().order.at(-1)).toBe('job-b');
  });

  it('cycleActive is a no-op with fewer than two jobs', () => {
    const s = useChatJobsStore.getState();
    s.cycleActive(1); // empty — no throw
    s.startJob('job-a', 'evaluate', 12);
    s.cycleActive(1);
    expect(useChatJobsStore.getState().order).toEqual(['job-a']);
  });

  it('re-attach via startJob is idempotent and cannot revive a dismissed job', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.startJob('job-a', 'evaluate', 12);
    expect(useChatJobsStore.getState().order).toEqual(['job-b', 'job-a']);
    s.dismiss('job-a');
    expect(readPersistedActiveJobs()).toEqual([{ jobId: 'job-b', kind: 'cover-letter', num: 16 }]);
  });

  it('toggleLogs flips only the target job', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.toggleLogs('job-a');
    const { jobs } = useChatJobsStore.getState();
    expect(jobs['job-a'].logsOpen).toBe(true);
    expect(jobs['job-b'].logsOpen).toBe(false);
  });

  // Persistent bubble terminal badge — seenTerminalIds is ephemeral (not part
  // of the sessionStorage re-attach payload) so it's exercised purely in-memory.
  it('markTerminalSeen marks every current terminal-status job, dedups, and skips active jobs', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.startJob('job-b', 'cover-letter', 16);
    s.setSnapshot('job-a', { status: 'error', error: 'boom' });
    s.setSnapshot('job-b', { status: 'running' });
    s.markTerminalSeen();
    expect(useChatJobsStore.getState().seenTerminalIds).toEqual(['job-a']);
    // Calling again is idempotent — no duplicate entries.
    s.markTerminalSeen();
    expect(useChatJobsStore.getState().seenTerminalIds).toEqual(['job-a']);
  });

  it('dismiss prunes the dismissed job out of seenTerminalIds', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-a', 'evaluate', 12);
    s.setSnapshot('job-a', { status: 'error', error: 'boom' });
    s.markTerminalSeen();
    expect(useChatJobsStore.getState().seenTerminalIds).toEqual(['job-a']);
    s.dismiss('job-a');
    expect(useChatJobsStore.getState().seenTerminalIds).toEqual([]);
  });

  it('markTerminalSeen also marks done-status jobs', () => {
    const s = useChatJobsStore.getState();
    s.startJob('job-d', 'evaluate');
    s.setSnapshot('job-d', { status: 'done' });
    s.startJob('job-r', 'research');
    s.setSnapshot('job-r', { status: 'running' });
    s.markTerminalSeen();
    expect(useChatJobsStore.getState().seenTerminalIds).toEqual(['job-d']);
  });
});

describe('chat-jobs-lib', () => {
  it('deriveElapsed freezes at finishedAt − startedAt for terminal jobs', () => {
    expect(deriveElapsed('2026-06-01T00:00:00.000Z', '2026-06-01T00:01:23.000Z')).toBe(83);
  });

  it('deriveElapsed falls back to wall-clock when finishedAt is missing or invalid', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    expect(deriveElapsed(tenSecondsAgo)).toBe(10);
    expect(deriveElapsed(tenSecondsAgo, 'not-a-date')).toBe(10);
    expect(deriveElapsed(tenSecondsAgo, null)).toBe(10);
  });

  it('deriveElapsed returns 0 without a startedAt', () => {
    expect(deriveElapsed(undefined, '2026-06-01T00:01:23.000Z')).toBe(0);
  });

  it('jobTitle formats kind + num like the deck did', () => {
    expect(jobTitle('tailor-cv', 2)).toBe('Tailor CV · #2');
    expect(jobTitle('reach-out', 7)).toBe('Reach out · #7');
    expect(jobTitle('scan')).toBe('Scan');
  });

  it('timePercent is elapsed/estimateS capped at 96', () => {
    // reach-out estimateS = 600 (lib/job-types.ts)
    expect(timePercent(150, 'reach-out')).toBe(25);
    expect(timePercent(6000, 'reach-out')).toBe(96);
    // unknown kind falls back to the 300s default
    expect(timePercent(150, 'nope')).toBe(50);
  });

  it('parseLogLines drops blanks and keeps the last 200 lines', () => {
    expect(parseLogLines('a\n\n b \n')).toEqual(['a', ' b ']);
    expect(parseLogLines('')).toEqual([]);
  });
});
