'use client';

// Keeps the URL and the active conversation in agreement.
//
// The chat store stays the single source of truth for which thread is open —
// every existing consumer (composer, model chip, confirm cards, background
// turn watcher) already reads it, and rewriting all of them to read the router
// would be a much larger change for no gain. This hook is the thin bridge:
//
//   URL → store   on arrival (deep link, refresh, back/forward)
//   store → URL   when something else switches threads (sidebar click, the
//                 draft→created transition inside send(), reattach-on-reload)
//
// Store → URL uses replace(), never push(): a thread switch is not a
// navigation the back button should have to walk through, and push() would
// remount the page and re-trigger the hook's reset/reattach effects.

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chat-store';

/** @param routeConversationId conversation id from the URL, or null on /chat */
export function useChatUrlSync(routeConversationId: string | null): void {
  const router = useRouter();
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);

  // URL → store. Only ever adopts a real id; landing on bare /chat must NOT
  // null an active conversation, or the store→URL effect below would race it
  // back and forth on every render.
  useEffect(() => {
    if (!routeConversationId) return;
    if (useChatStore.getState().activeConversationId === routeConversationId) return;
    setActiveConversation(routeConversationId);
  }, [routeConversationId, setActiveConversation]);

  // store → URL. Skipped on the first pass so a deep link doesn't immediately
  // rewrite its own URL from a not-yet-adopted store value.
  const syncedRef = useRef<string | null>(routeConversationId);
  useEffect(() => {
    if (activeConversationId === syncedRef.current) return;
    // Wait for the adopt effect above rather than fighting it.
    if (routeConversationId && activeConversationId == null) return;
    syncedRef.current = activeConversationId;
    router.replace(activeConversationId ? `/chat/${activeConversationId}` : '/chat');
  }, [activeConversationId, routeConversationId, router]);
}
