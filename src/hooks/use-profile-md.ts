'use client';

// hooks/use-profile-md.ts — TanStack Query wrappers for the per-file
// markdown endpoints GET + PUT /api/profile/md/[name].
//
// Mirrors legacy public/profile-form.js loadMd + saveMd: text/plain
// payloads, no JSON wrapper. We treat the body as a raw string and let
// TanStack Query cache by name.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { saveProfileMarkdownAction } from '@/server/actions/profile';

export type ProfileMdName = 'cv' | 'narrative' | 'article-digest';

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

export function useProfileMdQuery(name: ProfileMdName) {
  return useQuery<string>({
    queryKey: ['profile', 'md', name],
    queryFn: () => fetchText(`/api/profile/md/${name}`),
    // Markdown bodies are large; keep them around so navigating back
    // doesn't refetch — the editor handles drift via its setMarkdown.
    staleTime: 30_000,
  });
}

export function useSaveProfileMd(name: ProfileMdName) {
  const queryClient = useQueryClient();
  return useMutation<string, Error, string>({
    mutationFn: async body => {
      await saveProfileMarkdownAction({ name, content: body });
      return body;
    },
    onSuccess: body => {
      // Seed the cache so subsequent reads don't refetch — matches the
      // legacy form which keeps the body in `state` after a save.
      queryClient.setQueryData(['profile', 'md', name], body);
    },
  });
}
