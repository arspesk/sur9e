// Per-job poll for the chat jobs strip — ported from the deck card's poll +
// invalidation effects. fetch is stubbed; nothing touches data/.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';
import { useChatJobPoll } from '@/features/chat/use-chat-job-poll';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function resetStore() {
  const s = useChatJobsStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  resetStore();
});
afterEach(() => {
  resetStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useChatJobPoll', () => {
  it('writes the polled snapshot into the store', async () => {
    useChatJobsStore.getState().startJob('job-1', 'evaluate', 12);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'running',
          output: 'line 1\n',
          startedAt: new Date().toISOString(),
          params: { num: 12 },
        }),
      }),
    );
    const { unmount } = renderHook(() => useChatJobPoll('job-1'), { wrapper });
    await waitFor(() => {
      expect(useChatJobsStore.getState().jobs['job-1'].snapshot?.status).toBe('running');
    });
    unmount();
  });

  it('404 becomes an ERROR terminal state, never a fabricated success', async () => {
    useChatJobsStore.getState().startJob('job-gone', 'evaluate', 12);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { unmount } = renderHook(() => useChatJobPoll('job-gone'), { wrapper });
    await waitFor(() => {
      const snap = useChatJobsStore.getState().jobs['job-gone'].snapshot;
      expect(snap?.status).toBe('error');
      expect(snap?.error).toContain('job record not found');
    });
    unmount();
  });

  it('invalidates applications/report/application caches once on terminal', async () => {
    useChatJobsStore.getState().startJob('job-done', 'evaluate', 12);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'done',
          output: '',
          startedAt: new Date(Date.now() - 5000).toISOString(),
          finishedAt: new Date().toISOString(),
          params: { num: 12 },
        }),
      }),
    );
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = renderHook(() => useChatJobPoll('job-done'), { wrapper });
    await waitFor(() => {
      expect(useChatJobsStore.getState().jobs['job-done'].snapshot?.status).toBe('done');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['application', 12] });
    });
    unmount();
  });

  it('polls again every ~2s while running (not just once on mount)', async () => {
    vi.useFakeTimers();
    useChatJobsStore.getState().startJob('job-cadence', 'evaluate', 1);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'running',
        output: '',
        startedAt: new Date().toISOString(),
        params: { num: 1 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useChatJobPoll('job-cadence'), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // flush the immediate on-mount poll
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('stops polling once the job reaches a terminal status', async () => {
    vi.useFakeTimers();
    useChatJobsStore.getState().startJob('job-stop', 'evaluate', 2);
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls++;
      const isDone = calls >= 2;
      return {
        ok: true,
        status: 200,
        json: async () =>
          isDone
            ? {
                status: 'done',
                output: '',
                startedAt: new Date(Date.now() - 1000).toISOString(),
                finishedAt: new Date().toISOString(),
                params: { num: 2 },
              }
            : {
                status: 'running',
                output: '',
                startedAt: new Date().toISOString(),
                params: { num: 2 },
              },
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useChatJobPoll('job-stop'), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // call 1: running
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // call 2: done — interval cleared
    });
    expect(useChatJobsStore.getState().jobs['job-stop'].snapshot?.status).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // If polling hadn't stopped, two more 2s ticks would add two more calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
  });
});
