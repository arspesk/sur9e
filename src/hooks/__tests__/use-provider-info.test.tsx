// src/hooks/__tests__/use-provider-info.test.tsx
//
// TanStack Query wrapper test for useProviderInfo + useRefreshProviderInfo.
// Mocks the global fetch so the test never hits the real /api/providers.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDERS_QUERY_KEY,
  useProviderInfo,
  useRefreshProviderInfo,
} from '@/hooks/use-provider-info';

const fixture = {
  providers: {
    claude: {
      id: 'claude',
      displayName: 'Claude Code',
      binary: 'claude',
      installHint: '…',
      installed: { ok: true, version: '1.2.3' },
      auth: { ok: true },
      models: [{ id: 'claude-sonnet-4-6', label: 'Sonnet · balanced' }],
    },
  },
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

describe('useProviderInfo', () => {
  it('fetches /api/providers and returns the parsed body', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProviderInfo(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledWith('/api/providers', undefined);
    expect(result.current.data?.providers.claude?.displayName).toBe('Claude Code');
  });

  it('caches across hook calls under the same QueryClient', async () => {
    const { wrapper } = makeWrapper();
    const first = renderHook(() => useProviderInfo(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Second consumer within the same provider tree reuses the cache.
    const second = renderHook(() => useProviderInfo(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useRefreshProviderInfo', () => {
  it('invalidates the providers query so the next read refetches', async () => {
    const { client, wrapper } = makeWrapper();
    // Seed the cache via the query hook first.
    const query = renderHook(() => useProviderInfo(), { wrapper });
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const refresh = renderHook(() => useRefreshProviderInfo(), { wrapper });
    await act(async () => {
      await refresh.result.current.mutateAsync();
    });
    // invalidateQueries triggers an immediate refetch when the query is
    // mounted and observed.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(PROVIDERS_QUERY_KEY)?.dataUpdateCount).toBeGreaterThan(0);
  });
});
