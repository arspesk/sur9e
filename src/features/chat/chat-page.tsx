'use client';

// Full-screen chat: permanent thread sidebar + conversation column. Shares
// all orchestration with the corner bubble via useConversation — only the
// layout differs. A stream started elsewhere (bubble, Home hero) reattaches
// here through the hook's persisted-turn probe.

import { ChatBrandMark } from './brand-mark';
import { ChatComposer } from './chat-composer';
import { ChatEmptyState, SetupCard } from './chat-empty-state';
import { ChatJobsSlot } from './chat-jobs-slot';
import { ChatThreadsSidebar } from './chat-threads-sidebar';
import { ChatTranscript } from './chat-transcript';
import { useConversation } from './use-conversation';

export function ChatPage() {
  const convo = useConversation();

  return (
    <div className="chat-page">
      <ChatThreadsSidebar />
      <section className="chat-page__main" aria-label="Conversation">
        <header className="chat-page__header">
          <ChatBrandMark size={18} className="chat-header__mark" />
          <span className="chat-page__title">Chat</span>
          <ChatJobsSlot />
        </header>
        <span className="sr-only" aria-live="polite">
          {convo.turnStatus === 'streaming'
            ? 'AI is replying'
            : convo.turnStatus === 'done'
              ? 'Reply finished'
              : convo.turnStatus === 'error'
                ? 'Reply failed'
                : ''}
        </span>
        <div className="chat-page__body">
          {convo.setupRequired ? (
            <SetupCard />
          ) : convo.showEmpty ? (
            <ChatEmptyState onPick={text => void convo.send(text)} />
          ) : (
            <ChatTranscript
              messages={convo.messages}
              pendingUserMessage={convo.pendingUserMessage}
              live={convo.live}
              onRetry={convo.retry}
              onRegenerate={convo.streaming ? undefined : () => void convo.regenerate()}
            />
          )}
          {convo.sendError && (
            <div className="chat-error chat-error--send" role="alert">
              <span className="chat-error__msg">{convo.sendError}</span>
              <button type="button" className="chat-error__retry" onClick={convo.retry}>
                Retry
              </button>
            </div>
          )}
        </div>
        <div className="chat-page__composer">
          <ChatComposer
            streaming={convo.streaming}
            files={convo.draftFiles}
            onFilesChange={convo.setDraftFiles}
            onSend={(text, refs) => void convo.send(text, refs)}
            onStop={() => void convo.stop()}
          />
        </div>
      </section>
    </div>
  );
}
