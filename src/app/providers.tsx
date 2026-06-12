'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Singleton QueryClient per browser tab — survives <Providers> unmount/remount
// across Next App Router navigations. The previous useState() pattern lost the
// cache when the React tree tore down on route change, which made R-21
// (back-nav skeleton freeze) reappear regardless of staleTime/gcTime.
//
// SSR safety: getQueryClient() returns a fresh client on the server (each
// request gets its own — no cross-request leak) and a module-level singleton
// in the browser. This is the officially recommended Next + TanStack pattern.

const DEFAULT_OPTIONS = {
  queries: {
    // staleTime 5 min: cached data renders immediately on back-nav — no
    // skeleton flash because isPending stays false when data is present.
    staleTime: 5 * 60_000,
    // gcTime 30 min: cache survives long detours across routes.
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
    // Refetch only when no cached data — covers both R-21 (back-nav uses
    // cache) and R-24 (fresh/duplicated tab fetches).
    refetchOnMount: (query: { state: { data: unknown } }) => query.state.data === undefined,
  },
} as const;

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always a fresh client; cannot share across requests.
    return new QueryClient({ defaultOptions: DEFAULT_OPTIONS });
  }
  // Browser: one client per tab, shared across every <Providers> mount.
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient({ defaultOptions: DEFAULT_OPTIONS });
  }
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
