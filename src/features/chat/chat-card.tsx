'use client';

// The corner bubble's chat card. Layout + card-local DOM concerns only —
// conversation orchestration (send, streaming, reattach, per-thread
// isolation) lives in useConversation, shared with the /chat page.

import { useRef, useState } from 'react';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useChatStore } from '@/stores/chat-store';
import { ChatComposer } from './chat-composer';
import { ChatConversationContent } from './chat-conversation-content';
import { ChatHeader } from './chat-header';
import { useConversation } from './use-conversation';

export function ChatCard() {
  const closeChat = useChatStore(s => s.closeChat);
  const [dragOver, setDragOver] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, true);

  // Claims a prompt handed over from Home (Draft follow-up) the same way the
  // /chat page does. Safe to have both opted in: ChatHost hides the bubble on
  // /chat, so the two surfaces are never mounted at once and only one can win
  // the read-and-clear.
  const convo = useConversation({ consumeAutoSend: true });

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeChat();
    }
  }

  return (
    <div
      ref={cardRef}
      className="chat-card"
      role="dialog"
      aria-label="sur9e chat"
      onKeyDown={onKeyDown}
      data-dragover={dragOver || undefined}
      onDragOver={e => {
        // Drops are accepted mid-reply too — the dropped files become draft
        // chips and Enter queues them for the post-'done' flush.
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        convo.setDraftFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)].slice(0, 8));
      }}
    >
      <ChatHeader />
      {/* Stream-status announcements for SR users. Status transitions only —
          announcing every delta would spam; errors also render role=alert
          rows in the transcript. */}
      <span className="sr-only" aria-live="polite">
        {convo.turnStatus === 'streaming'
          ? 'AI is replying'
          : convo.turnStatus === 'done'
            ? 'Reply finished'
            : convo.turnStatus === 'error'
              ? 'Reply failed'
              : ''}
      </span>
      <div className="chat-card__body">
        <ChatConversationContent convo={convo} />
        {convo.sendError && (
          <div className="chat-error chat-error--send" role="alert">
            <span className="chat-error__msg">{convo.sendError}</span>
            <button type="button" className="chat-error__retry" onClick={convo.retry}>
              Retry
            </button>
          </div>
        )}
      </div>
      <ChatComposer
        streaming={convo.streaming}
        sendDisabled={
          convo.conversationStatus === 'loading' || convo.conversationStatus === 'error'
        }
        files={convo.draftFiles}
        onFilesChange={convo.setDraftFiles}
        onSend={(text, refs) => void convo.send(text, refs)}
        onStop={() => void convo.stop()}
      />
    </div>
  );
}
