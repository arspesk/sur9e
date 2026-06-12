'use client';

// hooks/use-settings.ts — TanStack Query wrappers for GET + PATCH /api/settings.
//
// Mirrors legacy public/settings-form.js debounced auto-save:
//   - useSettingsQuery: read once, cached.
//   - useSaveSettings: PATCH a partial; backend deep-merges with the existing
//     YAML and persists. Invalidates the cache on success so the UI re-reads
//     the canonical merged shape after every save.
//
// The 600ms debounce + "Saved" toast lives in the consumer (settings-form.tsx)
// so this hook stays a thin transport.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';
import { saveSettingsAction } from '@/server/actions/settings';

export interface SettingsModels {
  screen?: string;
  batch?: string;
}

// Multi-provider keys. default_provider +
// default_model are the global runtime defaults; `modes` is a sparse
// per-mode override map. Both are read+written by the Settings →
// Providers & Models section.
export type ProviderPlatform = 'claude' | 'codex' | 'opencode';

// A fallback {platform, model} pair (mirrors FallbackRef in
// src/lib/schemas/settings.ts). Both fields required when present.
export interface SettingsFallbackRef {
  platform: ProviderPlatform;
  model: string;
}

// Per-mode override row. platform/model are OPTIONAL so a row can carry only
// a fallback (its primary inherits the global default) — see ModeOverride in
// src/lib/schemas/settings.ts.
export interface SettingsModeOverride {
  platform?: ProviderPlatform;
  model?: string;
  fallback?: SettingsFallbackRef;
}

export interface SettingsProviders {
  models?: SettingsModels;
  default_provider?: ProviderPlatform;
  default_model?: string;
  modes?: Record<string, SettingsModeOverride>;
  // Global fallback pair — used by every mode without a per-mode fallback.
  // PATCH payloads may carry `null`: the explicit "turn fallback off" sentinel
  // (saveSettings deletes the on-disk key). Server responses never contain it.
  fallback?: SettingsFallbackRef | null;
}

export interface SettingsState {
  appearance?: { theme?: string };
  screening?: { smoke_test_limit?: number };
  scanning?: {
    jobspy?: { hours_old?: number; results_wanted?: number };
    title_filter?: { positive?: string[]; negative?: string[]; seniority_boost?: string[] };
  };
  providers?: SettingsProviders;
  system?: { update_source?: string; update_branch?: string };
  advanced?: {
    score_threshold?: number;
    parallel_workers?: number;
    timeout_ms?: number;
  };
  [k: string]: unknown;
}

interface UseSettingsQueryOptions {
  initialData?: SettingsState;
}

export function useSettingsQuery(options?: UseSettingsQueryOptions) {
  return useQuery<SettingsState>({
    queryKey: ['settings'],
    queryFn: () => fetchJson<SettingsState>('/api/settings'),
    initialData: options?.initialData,
    // staleTime keeps SSR initialData fresh on first render so the hook
    // doesn't refetch immediately after hydration. useSaveSettings seeds
    // the cache directly on success — mutations still win.
    staleTime: options?.initialData ? 30_000 : 0,
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean; settings: SettingsState }, Error, Partial<SettingsState>>({
    mutationFn: async partial => {
      const result = await saveSettingsAction(partial as Record<string, unknown>);
      return { ok: result.ok, settings: result.settings as SettingsState };
    },
    onSuccess: data => {
      // Server returns the fully-merged settings — seed the cache so the next
      // read doesn't re-fetch unless something else invalidates.
      if (data?.settings) {
        queryClient.setQueryData(['settings'], data.settings);
      }
    },
  });
}
