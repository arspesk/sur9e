// Regression: jobs started outside this tab (scheduler, CLI/API, other
// tabs) must surface as deck cards. The store only learns jobs via
// startJob, so the discovery poll is the ONLY path for them to get a card.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';
import { useJobDiscovery } from '@/hooks/use-job-discovery';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function resetStore() {
  useLoadingModalStore.setState({ jobs: {}, order: [] });
}

beforeEach(resetStore);
afterEach(() => {
  resetStore();
  vi.restoreAllMocks();
});

describe('useJobDiscovery', () => {
  it('adds a deck card for an active scan this tab never started', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          scan: [{ id: 'sched-scan-1', startedAt: '2026-06-05T22:00:18.076Z' }],
          'batch-evaluate': [],
        }),
      }),
    );
    renderHook(() => useJobDiscovery(), { wrapper });
    await waitFor(() => {
      expect(useLoadingModalStore.getState().jobs['sched-scan-1']).toBeDefined();
    });
    expect(useLoadingModalStore.getState().jobs['sched-scan-1'].kind).toBe('scan');
  });

  it('forwards num for offer-scoped jobs so the card titles "… for offer #N"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          evaluate: [{ id: 'cli-eval-42', num: 42, startedAt: '2026-06-05T23:00:00.000Z' }],
        }),
      }),
    );
    renderHook(() => useJobDiscovery(), { wrapper });
    await waitFor(() => {
      expect(useLoadingModalStore.getState().jobs['cli-eval-42']).toBeDefined();
    });
    const entry = useLoadingModalStore.getState().jobs['cli-eval-42'];
    expect(entry.kind).toBe('evaluate');
    expect(entry.num).toBe(42);
  });

  it('does not re-startJob an already-tracked id (no front-yank on every poll)', async () => {
    // Pre-track the job with a non-front position to detect reordering.
    useLoadingModalStore.getState().startJob('sched-scan-1', 'scan');
    useLoadingModalStore.getState().startJob('other-job', 'evaluate');
    const orderBefore = [...useLoadingModalStore.getState().order];
    expect(orderBefore).toEqual(['sched-scan-1', 'other-job']);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          scan: [{ id: 'sched-scan-1', startedAt: '2026-06-05T22:00:18.076Z' }],
        }),
      }),
    );
    renderHook(() => useJobDiscovery(), { wrapper });
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    // Order unchanged — the tracked id was skipped, not re-attached.
    expect(useLoadingModalStore.getState().order).toEqual(orderBefore);
  });

  it('a failed poll surfaces no cards and does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    renderHook(() => useJobDiscovery(), { wrapper });
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    expect(Object.keys(useLoadingModalStore.getState().jobs)).toHaveLength(0);
  });
});
