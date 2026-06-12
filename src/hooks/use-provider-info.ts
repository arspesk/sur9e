'use client';

// hooks/use-provider-info.ts — TanStack Query wrapper around GET /api/providers.
//
// Backs the Settings → Providers & Models section, which needs the per-provider
// health + model matrix to render the CLI status panel and populate platform/
// model dropdowns. Cache is wide (5 min stale, 10 min gc) because
// checkInstalled / checkAuth / listModels each spawn a child process —
// re-running them on every render would be expensive and the data rarely
// changes outside of an install/auth event.
//
// useRefreshProviderInfo invalidates the query so the settings panel's
// "Refresh model list" button can force a re-probe (e.g. after the user
// logged into a CLI in another terminal). The server has no cache of its
// own to bust.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';
import type { ProvidersResponse } from '@/lib/schemas/providers';

export type { ProviderInfoEntry, ProvidersResponse } from '@/lib/schemas/providers';

export const PROVIDERS_QUERY_KEY = ['providers'] as const;

export function useProviderInfo() {
  return useQuery<ProvidersResponse>({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: () => fetchJson<ProvidersResponse>('/api/providers'),
    staleTime: 5 * 60_000, // 5 minutes — adapter probes are expensive
    gcTime: 10 * 60_000,
  });
}

export function useRefreshProviderInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }),
  });
}
