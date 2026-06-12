'use client';

// hooks/use-portals.ts — TanStack Query wrappers for the ATS portals list
// (inputs/personalization/portals.yml) via Server Actions.
//
// Mirrors use-settings.ts: read once (SSR initialData), full-replace save
// that seeds the cache with the server-confirmed shape. The 600ms debounce
// + save-status wiring lives in the consumer (portals-section.tsx) so this
// hook stays a thin transport.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortalsShape } from '@/lib/schemas/portals';
import {
  importExamplePortalsAction,
  loadPortalsAction,
  savePortalsAction,
} from '@/server/actions/portals';

interface UsePortalsQueryOptions {
  /** SSR-loaded portals.yml — null when the file doesn't exist yet. */
  initialData?: PortalsShape | null;
}

export function usePortalsQuery(options?: UsePortalsQueryOptions) {
  return useQuery<PortalsShape | null>({
    queryKey: ['portals'],
    queryFn: () => loadPortalsAction(),
    initialData: options?.initialData,
    // Keep SSR initialData fresh on first render (no immediate refetch);
    // useSavePortals seeds the cache directly on success.
    staleTime: options?.initialData !== undefined ? 30_000 : 0,
  });
}

export function useSavePortals() {
  const queryClient = useQueryClient();
  return useMutation<PortalsShape, Error, PortalsShape>({
    mutationFn: async portals => {
      const result = await savePortalsAction(portals);
      return result.portals;
    },
    onSuccess: portals => {
      queryClient.setQueryData(['portals'], portals);
    },
  });
}

export function useImportExamplePortals() {
  const queryClient = useQueryClient();
  return useMutation<PortalsShape, Error, void>({
    mutationFn: async () => {
      const result = await importExamplePortalsAction();
      return result.portals;
    },
    onSuccess: portals => {
      queryClient.setQueryData(['portals'], portals);
    },
  });
}
