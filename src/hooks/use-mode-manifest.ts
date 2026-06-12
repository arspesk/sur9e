'use client';

// hooks/use-mode-manifest.ts — TanStack Query wrapper around GET /api/modes.
//
// Backs the Settings → Providers & Models per-mode override table.
// The manifest is built from on-disk front-matter,
// which only changes when a developer edits content/modes/*.md or
// adds a new mode file — so the cache is very wide (1 hour stale,
// 1 hour gc). The page-level RSC still reads the manifest server-side
// for first paint of unrelated data, but the override table is client-
// side rendered (it lives inside the rhf FormProvider tree).
//
// Mirrors `useProviderInfo`'s shape so the two queries can be consumed
// side-by-side in the section component without surprise.

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';
import type { ModeMetaResponse, ModesResponse } from '@/lib/schemas/modes';

export type { ModeMetaResponse, ModesResponse } from '@/lib/schemas/modes';

export const MODES_QUERY_KEY = ['modes'] as const;

export function useModeManifest() {
  return useQuery<ModesResponse>({
    queryKey: MODES_QUERY_KEY,
    queryFn: () => fetchJson<ModesResponse>('/api/modes'),
    // Manifest only changes when a developer edits content/modes/*.md.
    // Mode files are read-only at runtime, so a long stale window is
    // safe and avoids needless refetches across navigations.
    staleTime: 60 * 60_000, // 1 hour
    gcTime: 60 * 60_000,
  });
}

// Convenience selector for callers that just want the array.
export function selectModes(data: ModesResponse | undefined): ModeMetaResponse[] {
  return data?.modes ?? [];
}
