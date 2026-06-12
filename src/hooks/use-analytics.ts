'use client';

// hooks/use-analytics.ts
//
// React Query bindings for the analytics surface. Legacy analytics.html
// loads /api/applications and /api/usage in parallel; we mirror that with
// two separate queries so the surface lights up section-by-section as
// fetches resolve.

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';

// One provider's spend within a month. Shape is identical for
// claude / codex / opencode — see `data/usage.json` and
// `src/lib/schemas/usage.ts` for the canonical schema.
export interface UsageMonthProvider {
  cost_usd?: number;
  calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_calls?: number;
  by_mode?: Record<
    string,
    { cost_usd?: number; input_tokens?: number; output_tokens?: number; estimated_calls?: number }
  >;
  by_model?: Record<
    string,
    { cost_usd?: number; input_tokens?: number; output_tokens?: number; estimated_calls?: number }
  >;
}

// Back-compat alias — components that previously imported UsageMonthClaude
// keep working unchanged.
export type UsageMonthClaude = UsageMonthProvider;

export interface UsageMonth {
  claude?: UsageMonthProvider;
  codex?: UsageMonthProvider;
  opencode?: UsageMonthProvider;
}

export interface UsageResponse {
  currentMonth: string | null;
  currentMonthData: UsageMonth | null;
  allTime: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  } | null;
  months: Record<string, UsageMonth>;
  // Server-side: which canonical models / modes have live OpenRouter
  // pricing. `false` means the dashboard should render "N/A" rather than
  // "$0.00" for that row (legitimately-free models have $0 cost AND
  // `priced: true`; unpriced runs have $0 cost AND
  // `priced: false`).
  pricedModels: Record<string, boolean>;
  pricedModes: Record<string, boolean>;
}

interface UseUsageOptions {
  initialData?: UsageResponse;
}

export function useUsage(options?: UseUsageOptions) {
  return useQuery({
    queryKey: ['usage'],
    queryFn: () => fetchJson<UsageResponse>('/api/usage'),
    initialData: options?.initialData,
    // staleTime keeps SSR initialData fresh on first render so the hook
    // doesn't refetch immediately after hydration.
    staleTime: options?.initialData ? 30_000 : 0,
  });
}
