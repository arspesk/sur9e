'use client';

// hooks/use-system.ts — TanStack Query wrappers around the system/update
// endpoints (GET /api/version, GET /api/update/check,
// POST /api/update/rollback). Backs the Settings → About section, which
// previously hand-rolled these with useEffect + raw fetch (a legacy
// carryover flagged in the production-readiness audit).
//
// The version never changes within a session, so the query is cached
// effectively forever. Check/rollback are user-triggered, so they're
// mutations — the section component owns the toast messaging.

import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';

export interface VersionResponse {
  version?: string;
}

export interface UpdateCheckResponse {
  status?: string;
}

export interface RollbackResponse {
  ok?: boolean;
  error?: string;
}

export const VERSION_QUERY_KEY = ['system', 'version'] as const;

export function useVersion() {
  return useQuery<VersionResponse>({
    queryKey: VERSION_QUERY_KEY,
    queryFn: () => fetchJson<VersionResponse>('/api/version'),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

export function useUpdateCheck() {
  return useMutation<UpdateCheckResponse>({
    mutationFn: () => fetchJson<UpdateCheckResponse>('/api/update/check'),
  });
}

export function useRollback() {
  return useMutation<RollbackResponse>({
    mutationFn: () => fetchJson<RollbackResponse>('/api/update/rollback', { method: 'POST' }),
  });
}
