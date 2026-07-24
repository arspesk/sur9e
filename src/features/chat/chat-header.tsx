'use client';

import { useChatStore } from '@/stores/chat-store';
import { ChatBrandMark } from './brand-mark';
import { ChatJobsSlot } from './chat-jobs-slot';
import { SessionMenu } from './session-menu';

export function ChatHeader() {
  const closeChat = useChatStore(s => s.closeChat);
  return (
    <div className="chat-header">
      <div className="chat-header__row">
        <ChatBrandMark size={18} className="chat-header__mark" />
        <SessionMenu />
        <button
          type="button"
          className="chat-header__close"
          aria-label="Close chat"
          onClick={closeChat}
        >
          {/* Lucide X glyph (inline SVG — no icon dep). */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-x"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      {/* Jobs strip lands here (Plan 4) — renders nothing until then. */}
      <ChatJobsSlot />
    </div>
  );
}
