'use client';

// hooks/use-system.ts — TanStack Query wrappers around the system/update
// endpoints (GET /api/version, GET /api/update/check, POST /api/update/apply,
// GET /api/update/status/:id, POST /api/update/rollback). Backs the
// Settings → About section, which previously hand-rolled these with
// useEffect + raw fetch (a legacy carryover flagged in the
// production-readiness audit).
//
// The version never changes within a session, so the query is cached
// effectively forever. Check/rollback are user-triggered, so they're
// mutations — the section component owns the toast messaging.

import { useMutation, useQuery } from '@tanstack/react-query';
import { FetchJsonError, fetchJson } from '@/lib/api/fetch-json';
import type { UpdateJob } from '@/lib/schemas/update-job';

export type { UpdateJob } from '@/lib/schemas/update-job';

export interface VersionResponse {
  version?: string;
}

export type UpdateCheckResponse =
  | { status: 'update-available'; local: string; remote: string; changelog: string }
  | { status: 'up-to-date'; local: string; remote: string }
  | { status: 'dismissed' }
  | { status: 'offline'; local: string };

export interface UpdateApplyRequest {
  toVersion?: string;
}

export interface UpdateApplyResponse {
  jobId: string;
}

export interface RollbackResponse {
  ok?: boolean;
  error?: string;
}

export const VERSION_QUERY_KEY = ['system', 'version'] as const;
const UPDATE_JOB_POLL_MS = 1000;
const UPDATE_JOB_MAX_RETRIES = 3;
const UPDATE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_UPDATE_JOB_PHASES = new Set<UpdateJob['phase']>([
  'succeeded',
  'rolled-back',
  'failed',
]);

export function updateJobKey(jobId: string | null | undefined) {
  return ['system', 'update-job', jobId ?? null] as const;
}

function isValidUpdateJobId(jobId: string | null | undefined): jobId is string {
  return typeof jobId === 'string' && UPDATE_JOB_ID.test(jobId);
}

function retryUpdateJob(failureCount: number, error: Error): boolean {
  if (failureCount >= UPDATE_JOB_MAX_RETRIES) return false;
  return error instanceof TypeError || (error instanceof FetchJsonError && error.status >= 500);
}

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

export function useUpdateApply() {
  return useMutation<UpdateApplyResponse, Error, UpdateApplyRequest | void>({
    mutationFn: request =>
      fetchJson<UpdateApplyResponse>('/api/update/apply', {
        method: 'POST',
        ...(request?.toVersion === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ toVersion: request.toVersion }),
            }),
      }),
  });
}

export function useUpdateJob(jobId: string | null | undefined) {
  return useQuery<UpdateJob>({
    queryKey: updateJobKey(jobId),
    queryFn: () => fetchJson<UpdateJob>(`/api/update/status/${jobId}`),
    enabled: isValidUpdateJobId(jobId),
    refetchInterval: query =>
      query.state.data && TERMINAL_UPDATE_JOB_PHASES.has(query.state.data.phase)
        ? false
        : UPDATE_JOB_POLL_MS,
    refetchIntervalInBackground: true,
    retry: retryUpdateJob,
    retryDelay: attemptIndex => Math.min(UPDATE_JOB_POLL_MS * 2 ** attemptIndex, 4000),
  });
}

export function useRollback() {
  return useMutation<RollbackResponse>({
    mutationFn: () => fetchJson<RollbackResponse>('/api/update/rollback', { method: 'POST' }),
  });
}
