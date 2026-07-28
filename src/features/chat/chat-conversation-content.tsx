'use client';

import { ChatEmptyState, SetupCard } from './chat-empty-state';
import { ChatTranscriptSkeleton } from './chat-skeleton';
import { ChatTranscript } from './chat-transcript';
import type { ConversationApi } from './use-conversation';

export function ChatConversationContent({ convo }: { convo: ConversationApi }) {
  if (convo.setupRequired) return <SetupCard />;

  if (convo.conversationStatus === 'loading') return <ChatTranscriptSkeleton />;

  if (convo.conversationStatus === 'error') {
    return (
      <div className="chat-load-error" role="alert">
        <strong>Thread unavailable</strong>
        <span>{convo.conversationError ?? 'Conversation failed to load.'}</span>
        <button
          type="button"
          className="chat-error__retry"
          onClick={convo.retryConversation}
          aria-label="Retry loading conversation"
        >
          Retry
        </button>
      </div>
    );
  }

  if (convo.showEmpty) return <ChatEmptyState onPick={text => void convo.send(text)} />;

  return (
    <ChatTranscript
      messages={convo.messages}
      pendingUserMessage={convo.pendingUserMessage}
      pendingUserMessageId={convo.pendingUserMessageId}
      live={convo.live}
      onRetry={convo.retry}
      onRegenerate={convo.streaming ? undefined : () => void convo.regenerate()}
    />
  );
}
