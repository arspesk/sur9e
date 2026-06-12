'use client';

// hooks/use-profile.ts — TanStack Query wrappers for GET + PATCH /api/profile.
//
// Mirrors legacy public/profile-form.js debounced auto-save:
//   - useProfileQuery: read once, cached.
//   - useSaveProfile: PATCH a full or partial profile; backend re-writes
//     the profile.yml top-level keys it sees in the body. Invalidates the
//     cache on success so the next render reads the canonical merged shape.
//
// The 600ms debounce + "Saved" toast lives in the consumer (profile-form.tsx)
// so this hook stays a thin transport.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/api/fetch-json';
import { saveProfileAction } from '@/server/actions/profile';

export interface ProfileCandidate {
  full_name?: string;
  email?: string;
  phone?: string;
  github?: string;
  linkedin?: string;
  portfolio_url?: string;
}

export interface ProfileArchetype {
  name?: string;
  level?: string;
  fit?: string;
}

export interface ProfileTargetRoles {
  archetypes?: ProfileArchetype[];
  preferred_yoe?: string;
}

export interface ProfileProofPoint {
  name?: string;
  url?: string;
  hero_metric?: string;
}

export interface ProfileNarrative {
  headline?: string;
  exit_story?: string;
  superpowers?: string[];
  proof_points?: ProfileProofPoint[];
}

export interface ProfileCompensation {
  target_range?: string;
  currency?: string;
  minimum?: string;
  acceptable_floor?: string;
  notes?: string;
}

export interface ProfileLanguage {
  name?: string;
  proficiency?: string;
}

export interface ProfileLocation {
  country?: string;
  city?: string;
  timezone?: string;
  visa_status?: string;
  onsite_availability?: string;
  location_flexibility?: string;
}

export interface ProfileSearch {
  terms?: string[];
  locations?: string[];
}

export interface ProfileState {
  candidate?: ProfileCandidate;
  target_roles?: ProfileTargetRoles;
  narrative?: ProfileNarrative;
  compensation?: ProfileCompensation;
  location?: ProfileLocation;
  languages?: ProfileLanguage[];
  search?: ProfileSearch;
  [k: string]: unknown;
}

interface UseProfileQueryOptions {
  initialData?: ProfileState;
}

export function useProfileQuery(options?: UseProfileQueryOptions) {
  return useQuery<ProfileState>({
    queryKey: ['profile'],
    queryFn: () => fetchJson<ProfileState>('/api/profile'),
    initialData: options?.initialData,
    // staleTime keeps SSR initialData fresh on first render so the hook
    // doesn't refetch immediately after hydration. useSaveProfile
    // invalidates this key on success, which overrides staleTime — fresh
    // data after mutations still works.
    staleTime: options?.initialData ? 30_000 : 0,
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean; profileChanged: boolean }, Error, Partial<ProfileState>>({
    mutationFn: partial => saveProfileAction(partial as Record<string, unknown>),
    onSuccess: () => {
      // The save response doesn't echo the merged profile — re-read so
      // the cache stays canonical (e.g. if the server normalized a field).
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
