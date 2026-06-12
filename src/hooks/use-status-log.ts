'use client';

import { useQuery } from '@tanstack/react-query';
import type { TransitionLike } from '@/lib/analytics/compute';
import { fetchJson } from '@/lib/api/fetch-json';

export interface StatusLogResponse {
  transitions: TransitionLike[];
  count: number;
}

interface UseStatusLogOptions {
  initialData?: StatusLogResponse;
}

/**
 * The status-transition log (GET /api/status-log — the read also runs the
 * reconcile pass server-side). Feeds the history-aware funnel and the
 * rejection stats on /analytics.
 */
export function useStatusLog(options?: UseStatusLogOptions) {
  return useQuery({
    queryKey: ['status-log'],
    queryFn: () => fetchJson<StatusLogResponse>('/api/status-log'),
    initialData: options?.initialData,
    staleTime: options?.initialData ? 30_000 : 0,
  });
}
