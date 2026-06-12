'use client';

import { useQuery } from '@tanstack/react-query';
import type { ApplicationEntry } from '@/features/report/report-types';
import { numFromFilename } from '@/features/report/report-types';
import { fetchJson } from '@/lib/api/fetch-json';

/**
 * Loads the full application entry (which embeds the parsed report) for a
 * report filename. The legacy report viewer fetched `/api/applications/:num`
 * because the renderer needs `entry.company`, `entry.role`, `entry.status`
 * alongside `entry.report.parsed`. We derive `num` from the filename via
 * the `NNN-slug-YYYY-MM-DD.md` convention.
 *
 * Returns `{ status: 'invalid' }`-shaped error when the filename is
 * malformed, and lets TanStack Query surface the fetch error otherwise.
 */
interface UseReportOptions {
  initialData?: ApplicationEntry;
}

export function useReport(filename: string | null, options?: UseReportOptions) {
  const num = filename ? numFromFilename(filename) : null;
  return useQuery({
    queryKey: ['report', filename, num],
    queryFn: async (): Promise<ApplicationEntry> => {
      if (!num) throw new Error('Invalid report filename');
      return fetchJson<ApplicationEntry>(`/api/applications/${num}`);
    },
    enabled: filename != null && num != null,
    initialData: options?.initialData,
    // staleTime keeps SSR initialData fresh on first render so the hook
    // doesn't refetch immediately after hydration. Mutations elsewhere
    // (status pill, delete) invalidate the 'report' prefix and still win.
    staleTime: options?.initialData ? 30_000 : 0,
    // Re-read disk on every mount — including App Router back-navigation onto
    // a report that's still in the singleton QueryClient cache. The report
    // body is edited in place (PATCH /api/reports/:filename/body) without
    // touching this cache, so without an on-mount refetch a returning visit
    // re-serves the stale pre-edit body and the user's changes only reappear
    // after a hard reload (which recreates the QueryClient). The global
    // default (refetchOnMount: data === undefined, see app/providers.tsx)
    // suppresses that refetch; override it here. With cached data present
    // this is a *background* refetch — isPending stays false, so there's no
    // skeleton flash and the R-21 back-nav freeze the global policy guards
    // against does not return.
    refetchOnMount: 'always',
  });
}
