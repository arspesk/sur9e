import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationEntry } from '@/features/report/report-types';

/**
 * Regression for the "edits vanish on back-navigation, only reappear after a
 * full reload" bug.
 *
 * The report editor saves markdown to disk (PATCH /api/reports/:filename/body)
 * but the singleton QueryClient cache (`['report', …]`) is never updated by the
 * save. The global default policy `refetchOnMount: data === undefined` means a
 * remount with a populated cache is NOT refetched — so navigating away and back
 * re-serves the stale (pre-edit) body. Only a hard reload (which recreates the
 * QueryClient) re-reads disk.
 *
 * The fix: useReport overrides refetchOnMount so every mount (incl. back-nav)
 * re-reads disk. With cached data present it's a background refetch (no skeleton
 * flash), so it doesn't reintroduce the R-21 back-nav skeleton freeze the global
 * policy was guarding against.
 *
 * This test reproduces the real conditions: a shared client (singleton across
 * navigations) carrying the production default policy, primed with initialData,
 * then unmounted and remounted to simulate navigating away and back.
 */

vi.mock('@/lib/api/fetch-json', () => ({ fetchJson: vi.fn() }));

import { useApplication } from '@/hooks/use-applications';
import { useReport } from '@/hooks/use-report';
import { fetchJson } from '@/lib/api/fetch-json';

const mockFetch = vi.mocked(fetchJson);

const FILENAME = '016-acme-2026-05-23.md';

function entry(body: string): ApplicationEntry {
  return {
    num: 16,
    company: 'Acme',
    report: { parsed: { body, state: 'screened' } },
  } as unknown as ApplicationEntry;
}

// Mirror the production defaultOptions (src/app/providers.tsx) so the test
// exercises the real cache behavior, including the refetch-suppression policy.
function makeSharedClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: false,
        refetchOnMount: (q: { state: { data: unknown } }) => q.state.data === undefined,
      },
    },
  });
}

describe('useReport — back-navigation freshness', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Disk holds the saved (post-edit) body; the SSR initialData is the stale
    // pre-edit body left over from the first visit's render.
    mockFetch.mockResolvedValue(entry('NEW body') as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-reads disk on remount so a returning visit shows the saved body', async () => {
    const client = makeSharedClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    // First visit: renders from SSR initialData, then refetches in the
    // background. Cache is now populated (singleton survives navigation).
    const first = renderHook(() => useReport(FILENAME, { initialData: entry('OLD body') }), {
      wrapper,
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    first.unmount(); // navigate away

    // Return visit: a new observer mounts against the same (populated) cache.
    // Must refetch despite the suppression policy, surfacing the saved body.
    const second = renderHook(() => useReport(FILENAME, { initialData: entry('OLD body') }), {
      wrapper,
    });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.data?.report?.parsed?.body).toBe('NEW body'));

    second.unmount();
  });
});

describe('useApplication — drawer reopen freshness', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-reads disk when the drawer reopens so saved TL;DR edits are reflected', async () => {
    // The drawer fully unmounts on close and remounts on reopen. First open
    // loads OLD into the singleton cache; the user's TL;DR save then changes
    // disk to NEW without updating that cache. Reopen must re-read disk.
    mockFetch.mockResolvedValueOnce(entry('OLD body') as never);
    mockFetch.mockResolvedValue(entry('NEW body') as never);

    const client = makeSharedClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    type BodyShape = { report?: { parsed?: { body?: string } } } | undefined;

    const first = renderHook(() => useApplication(16), { wrapper });
    await waitFor(() =>
      expect((first.result.current.data as BodyShape)?.report?.parsed?.body).toBe('OLD body'),
    );
    first.unmount(); // close drawer

    const second = renderHook(() => useApplication(16), { wrapper });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect((second.result.current.data as BodyShape)?.report?.parsed?.body).toBe('NEW body'),
    );

    second.unmount();
  });
});
