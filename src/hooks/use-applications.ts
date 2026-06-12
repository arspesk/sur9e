'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '@/components/toast/toast-store';
import { normalizeApplications } from '@/features/table/applications-normalize';
import type { ApplicationsResponse, RawApplicationEntry } from '@/features/table/table-types';
import { fetchJson } from '@/lib/api/fetch-json';
import type { ApplicationStatus } from '@/lib/schemas/applications';
import {
  deleteApplicationAction,
  updateApplicationStatusAction,
  updateReportFieldAction,
} from '@/server/actions/applications';

interface UseApplicationsOptions {
  initialData?: ApplicationsResponse;
}

export function useApplications(options?: UseApplicationsOptions) {
  return useQuery({
    queryKey: ['applications'],
    queryFn: async () => {
      const raw = await fetchJson<{ entries?: RawApplicationEntry[]; count?: number }>(
        '/api/applications',
      );
      return normalizeApplications(raw);
    },
    initialData: options?.initialData,
    // staleTime keeps SSR initialData fresh on first render so the hook
    // doesn't refetch immediately after hydration. useUpdateApplicationStatus
    // and useDeleteApplication invalidate this key on success — mutations
    // still trigger a refetch and reflect server changes.
    staleTime: options?.initialData ? 30_000 : 0,
  });
}

export function useApplication(num: number | null) {
  return useQuery({
    queryKey: ['application', num],
    queryFn: () => fetchJson<Record<string, unknown>>(`/api/applications/${num}`),
    enabled: num != null,
    // Re-read disk every time the drawer opens. The drawer fully unmounts on
    // close (offers-drawer.tsx) and remounts on reopen; its TL;DR editor saves
    // markdown via PATCH /api/reports/:filename/body without touching this
    // cache, so without an on-mount refetch a reopened drawer re-serves the
    // stale pre-edit body and the user's edits only reappear after a hard
    // reload. The global default (refetchOnMount: data === undefined, see
    // app/providers.tsx) suppresses that refetch; override it here. This fires
    // only on (re)mount — never during active typing — so it cannot clobber an
    // in-flight edit. Mirrors the same fix in useReport.
    refetchOnMount: 'always',
  });
}

export function useUpdateApplicationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { num: number; status: ApplicationStatus }) =>
      updateApplicationStatusAction(input),
    // Hook-level failure toast so EVERY caller surfaces a failed PATCH —
    // the table pill fires `mutate` without per-call callbacks and used to
    // fail silently (its optimistic pill just snapped back on refetch).
    // Mirrors the kanban drag's catch toast (features/pipeline/board.tsx).
    // Callers must NOT pass their own per-call onError toast on top of
    // this one — both would fire and the user would see a double toast.
    onError: (err, { num }) => {
      useToastStore
        .getState()
        .push('danger', err instanceof Error ? err.message : `#${num} status update failed`);
    },
    onSuccess: (_data, { num }) => {
      // Invalidate every cache holding this row so all three surfaces
      // (table list, drawer detail, full report hero pill) re-render with
      // the new status without a manual page reload.
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['application', num] });
      // Report queries are keyed [reportKey, filename, num] — prefix
      // match on 'report' refreshes any open report that shows this row.
      queryClient.invalidateQueries({ queryKey: ['report'] });
      // updateStatus appends a transition to data/status-log.jsonl; the
      // analytics page's history funnel + rejection stats read it via
      // useStatusLog. Without this the cached transitions list goes stale
      // for the whole session (refetchOnMount is off once data exists).
      queryClient.invalidateQueries({ queryKey: ['status-log'] });
    },
  });
}

export function useUpdateReportField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { num: number; field: string; value: string }) =>
      updateReportFieldAction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { num: number }) => deleteApplicationAction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      // Deleting a row changes which transitions the analytics page should
      // count — refresh the status-log-derived stats too.
      queryClient.invalidateQueries({ queryKey: ['status-log'] });
    },
  });
}
