'use client';

// On phones the corner bubble ALREADY is the full-screen chat (chat.css turns
// .chat-card into an inset:0 takeover at ≤640px), so the /chat route would be
// a second, worse copy of it: the thread sidebar is hidden at that width, and
// the page has no way back to what the user was doing. A phone that lands on
// /chat — deep link, shared URL, rail tap on a narrow window — is therefore
// sent home with the bubble opened on the same conversation.
//
// The breakpoint is the one chat.css already uses for the card takeover; if
// that moves, move this with it.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useChatStore } from '@/stores/chat-store';

export const CHAT_MOBILE_QUERY = '(max-width: 640px)';

/** @returns true once we know this is a phone and the redirect is under way —
 * callers render nothing in that state to avoid flashing the desktop layout. */
export function useMobileChatRedirect(): boolean {
  const router = useRouter();
  // Undefined until measured: the server has no viewport, so committing to
  // either answer during render would risk a hydration mismatch.
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!window.matchMedia(CHAT_MOBILE_QUERY).matches) return;
    setRedirecting(true);
    // useChatUrlSync has already put /chat/[id] into the store, so the bubble
    // opens on the thread the link pointed at rather than a blank one.
    useChatStore.getState().openChat();
    router.replace('/');
  }, [router]);

  return redirecting;
}
