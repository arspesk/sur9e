'use client';

// Full-screen chat: permanent thread sidebar + conversation column. Shares
// all orchestration with the corner bubble via useConversation — only the
// layout differs. A stream started elsewhere (bubble, Home hero) reattaches
// here through the hook's persisted-turn probe.

import { useChatSessions } from '@/hooks/use-chat-sessions';
import { useChatStore } from '@/stores/chat-store';
import { ChatBrandMark } from './brand-mark';
import { ChatComposer } from './chat-composer';
import { ChatEmptyState, SetupCard } from './chat-empty-state';
import { ChatJobsSlot } from './chat-jobs-slot';
import { ChatThreadsSidebar } from './chat-threads-sidebar';
import { ChatTranscript } from './chat-transcript';
import { useChatUrlSync } from './use-chat-url-sync';
import { useConversation } from './use-conversation';

export function ChatPage({ conversationId }: { conversationId?: string }) {
  // /chat/[id] passes the thread from the URL; bare /chat passes nothing and
  // the store keeps whatever was last open. consumeAutoSend: only this
  // full-screen surface may claim a prompt handed over from Home.
  useChatUrlSync(conversationId ?? null);
  const convo = useConversation({ consumeAutoSend: true });
  // Header title reads the same pair the sidebar does — the sessions query plus
  // the store's active id — so both stay in sync through one cache. No polling
  // here: useConversation already schedules delayed CHAT_SESSIONS_KEY
  // invalidations, so an AI-generated title lands on its own.
  const activeId = useChatStore(s => s.activeConversationId);
  const { data: conversations } = useChatSessions();
  const activeTitle = conversations?.find(c => c.id === activeId)?.title.trim();
  const headerTitle = activeId == null ? 'New chat' : activeTitle || 'Chat';

  return (
    <div className="chat-page">
      <ChatThreadsSidebar />
      <section className="chat-page__main" aria-label="Conversation">
        <header className="chat-page__header">
          <ChatBrandMark size={18} className="chat-header__mark" />
          <span className="chat-page__title" title={headerTitle}>
            {headerTitle}
          </span>
        </header>
        {/* Full-width strip BETWEEN header and body — the same slot it occupies
            in the bubble, where it is a block child of the column-flex
            .chat-header. Inside this page's centred flex header row it would
            shrink-wrap into a stray bordered box and inflate the row. */}
        <ChatJobsSlot />
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
