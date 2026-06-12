import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';
import { useToastStore } from '@/components/toast/toast-store';
import { useJobAction } from '@/hooks/use-job-action';

/**
 * Tests target the public contract of useJobAction:
 *   - Calls the server action startJobAction({ kind, params })
 *   - Calls loadingModalStore.startJob(id, kind, num?)
 *   - Awaits waitForTerminal(id) and reacts to its resolution
 *   - NO toast on terminal done/error — the deck card is the notification
 *     (spec 2026-06-05-corner-notifications)
 *   - Toasts only on spawn failure (no card exists yet)
 *
 * We mock the server-action module so the test stays a pure unit and
 * doesn't try to actually spawn a job. Snapshot writes drive the modal.
 */

vi.mock('@/server/actions/jobs', () => ({
  startJobAction: vi.fn(),
}));

import { startJobAction } from '@/server/actions/jobs';

const mockStartJob = vi.mocked(startJobAction);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function resetStores() {
  useToastStore.setState({ toasts: [] });
  // Reset deck store by dismissing all tracked jobs
  const s = useLoadingModalStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
  useLoadingModalStore.setState({ _resolvers: new Map() });
}

function jobRecord(id: string) {
  return {
    id,
    type: 'research' as const,
    status: 'queued' as const,
    params: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
  };
}

describe('useJobAction', () => {
  beforeEach(() => {
    resetStores();
    mockStartJob.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { done: 1 } and does NOT push a toast on terminal done', async () => {
    mockStartJob.mockResolvedValue(jobRecord('job-1'));

    const { result, unmount } = renderHook(() => useJobAction('research'), { wrapper });
    const runPromise = result.current.run({ num: 1 });

    await new Promise(r => setTimeout(r, 10));
    await act(async () => {
      useLoadingModalStore.getState().setSnapshot('job-1', { status: 'done', output: '' });
    });
    const final = await runPromise;

    expect(mockStartJob).toHaveBeenCalledWith({ kind: 'research', params: { num: 1 } });
    expect(final).toMatchObject({ done: 1 });
    // No toast on done — the deck card is the completion notification
    // (spec 2026-06-05-corner-notifications).
    expect(useToastStore.getState().toasts).toHaveLength(0);
    unmount();
  });

  it('returns { done: 0, error } and does NOT push a toast on terminal error', async () => {
    mockStartJob.mockResolvedValue(jobRecord('job-err'));

    const { result, unmount } = renderHook(() => useJobAction('research'), { wrapper });
    const runPromise = result.current.run({ num: 2 });
    await new Promise(r => setTimeout(r, 10));
    await act(async () => {
      useLoadingModalStore
        .getState()
        .setSnapshot('job-err', { status: 'error', error: 'something blew up' });
    });
    const final = await runPromise;

    expect(final.done).toBe(0);
    expect(final.error).toBe('something blew up');
    // No toast on job error — the deck card shows the error state with
    // actions (spec 2026-06-05-corner-notifications).
    expect(useToastStore.getState().toasts).toHaveLength(0);
    unmount();
  });

  it('returns danger toast + error when the spawn action throws', async () => {
    mockStartJob.mockRejectedValue(new Error('oh no'));

    const { result, unmount } = renderHook(() => useJobAction('research'), { wrapper });
    const final = await result.current.run({ num: 3 });

    expect(final.done).toBe(0);
    expect(final.error).toBe('oh no');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some(t => t.tone === 'danger' && t.message === 'oh no')).toBe(true);
    unmount();
  });

  it('returns cancelled=true when modal is dismissed (AbortError)', async () => {
    mockStartJob.mockResolvedValue(jobRecord('job-abort'));

    const { result, unmount } = renderHook(() => useJobAction('research'), { wrapper });
    const runPromise = result.current.run({ num: 4 });
    await new Promise(r => setTimeout(r, 10));
    await act(async () => {
      useLoadingModalStore.getState().dismiss('job-abort');
    });
    const final = await runPromise;

    expect(final.done).toBe(0);
    expect(final.cancelled).toBe(true);
    unmount();
  });
});
