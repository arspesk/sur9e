'use client';

import { Maximize2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/stores/chat-store';
import { ChatJobsSlot } from './chat-jobs-slot';
import { SessionMenu } from './session-menu';

export function ChatHeader() {
  const closeChat = useChatStore(s => s.closeChat);
  const router = useRouter();
  return (
    <div className="chat-header">
      <div className="chat-header__row">
        <SessionMenu />
        {/* Expand to the full-screen chat. The active conversation carries
            over through the chat store, and an in-flight stream reattaches
            on /chat via the persisted-turn probe in useConversation. */}
        <button
          type="button"
          className="chat-header__close chat-header__expand"
          aria-label="Open full-screen chat"
          title="Open full-screen chat"
          onClick={() => {
            // Tells /chat to grow out of this corner rather than replaying
            // Home's downward glide, which would move from a place the card
            // never occupied.
            useChatStore.getState().setChatEntryOrigin('bubble');
            closeChat();
            router.push('/chat');
          }}
        >
          <Maximize2 aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chat-header__close"
          aria-label="Close chat"
          onClick={closeChat}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {/* Jobs strip lands here (Plan 4) — renders nothing until then. */}
      <ChatJobsSlot />
    </div>
  );
}
