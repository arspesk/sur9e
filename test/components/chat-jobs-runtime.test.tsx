// ChatJobsRuntime: discovery + re-attach + per-job polling + aria-live
// announcements, all active with the chat CLOSED. fetch fully stubbed.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatJobsRuntime } from '@/features/chat/chat-jobs-runtime';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';

function resetStore() {
  const s = useChatJobsStore.getState();
  for (const id of [...s.order]) s.dismiss(id);
}

function renderRuntime() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatJobsRuntime />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetStore();
  sessionStorage.clear();
});
afterEach(() => {
  resetStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatJobsRuntime', () => {
  it('re-attaches persisted in-flight jobs and polls them', async () => {
    sessionStorage.setItem(
      'sur9e.loading-modal.active-jobs',
      JSON.stringify([{ jobId: 'persisted-1', kind: 'evaluate', num: 3 }]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/api/jobs/active')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'running',
            output: '',
            startedAt: new Date().toISOString(),
            params: { num: 3 },
          }),
        };
      }),
    );
    renderRuntime();
    await waitFor(() => {
      expect(useChatJobsStore.getState().jobs['persisted-1']).toBeDefined();
      expect(useChatJobsStore.getState().jobs['persisted-1'].snapshot?.status).toBe('running');
    });
  });

  it('surfaces externally-started jobs via discovery and announces terminal states politely', async () => {
    let done = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/api/jobs/active')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              scan: [{ id: 'sched-scan-1', startedAt: new Date().toISOString() }],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: done ? 'done' : 'running',
            output: '',
            startedAt: new Date(Date.now() - 5000).toISOString(),
            finishedAt: done ? new Date().toISOString() : null,
          }),
        };
      }),
    );
    const { container } = renderRuntime();
    await waitFor(() => {
      expect(useChatJobsStore.getState().jobs['sched-scan-1']).toBeDefined();
    });
    done = true;
    await waitFor(
      () => {
        const region = container.querySelector('[aria-live="polite"]');
        expect(region?.textContent).toBe('Scan finished');
      },
      { timeout: 5000 },
    );
  });
});
