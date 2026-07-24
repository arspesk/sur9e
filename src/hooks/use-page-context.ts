'use client';

import { useEffect } from 'react';
import { usePageContextStore } from '@/stores/page-context-store';

/**
 * Publish this surface's on-screen-awareness summary into the page-context
 * store (Part 1). Call it from a main surface's client component with the
 * computed summary string; the chat send-path reads the store at send time.
 *
 * Sets the store on mount and whenever `context` changes, and clears it on
 * unmount so a route that doesn't publish a summary falls back to the
 * pathname. Pass `null` (e.g. while data is still loading) to leave the slot
 * empty until a real summary is ready.
 */
export function useSetPageContext(context: string | null): void {
  useEffect(() => {
    usePageContextStore.getState().setContext(context);
    return () => usePageContextStore.getState().clearContext();
  }, [context]);
}
