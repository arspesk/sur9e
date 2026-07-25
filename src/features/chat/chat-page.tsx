'use client';

// Full-screen chat: permanent thread sidebar + conversation column. Shares
// all orchestration with the corner bubble via useConversation — only the
// layout differs. A stream started elsewhere (bubble, Home hero) reattaches
// here through the hook's persisted-turn probe.

import { useEffect, useState } from 'react';
import { useChatSessions } from '@/hooks/use-chat-sessions';
import { useChatStore } from '@/stores/chat-store';
import { ChatComposer } from './chat-composer';
import { ChatEmptyState, SetupCard } from './chat-empty-state';
import { ChatJobsSlot } from './chat-jobs-slot';
import { ChatThreadsSidebar } from './chat-threads-sidebar';
import { ChatTranscript } from './chat-transcript';
import { useChatUrlSync } from './use-chat-url-sync';
import { useConversation } from './use-conversation';
import { useMobileChatRedirect } from './use-mobile-chat-redirect';

export function ChatPage({ conversationId }: { conversationId?: string }) {
  // /chat/[id] passes the thread from the URL; bare /chat passes nothing and
  // the store keeps whatever was last open. consumeAutoSend: only this
  // full-screen surface may claim a prompt handed over from Home.
  useChatUrlSync(conversationId ?? null);
  // Runs BEFORE useConversation so the store already holds the URL's thread
  // when the bubble takes over on a phone.
  const redirectingToBubble = useMobileChatRedirect();
  const convo = useConversation({ consumeAutoSend: true });
  // Snapshot at mount so the value can't change under an in-flight animation.
  // The store copy is cleared on a timer (below) rather than here: a first
  // message rewrites /chat → /chat/[id], which remounts this page, and the
  // second mount still needs to see the origin to finish the same journey.
  const [entryOrigin] = useState(() => useChatStore.getState().chatEntryOrigin);
  useEffect(() => {
    // Comfortably past the 420ms arrival, short enough that a later rail click
    // or reload gets no stale directional motion.
    const t = setTimeout(() => useChatStore.getState().setChatEntryOrigin(null), 1200);
    return () => clearTimeout(t);
  }, []);
  // Header title reads the same pair the sidebar does — the sessions query plus
  // the store's active id — so both stay in sync through one cache. No polling
  // here: useConversation already schedules delayed CHAT_SESSIONS_KEY
  // invalidations, so an AI-generated title lands on its own.
  const activeId = useChatStore(s => s.activeConversationId);
  const { data: conversations } = useChatSessions();
  const activeTitle = conversations?.find(c => c.id === activeId)?.title.trim();
  const headerTitle = activeId == null ? 'New chat' : activeTitle || 'Chat';

  // Phone: the bubble is taking over and the router is on its way home.
  // Rendering the desktop layout for that frame would flash a sidebar the
  // width can't accommodate.
  if (redirectingToBubble) return null;

  return (
    <div className="chat-page" data-enter={entryOrigin ?? undefined}>
      <ChatThreadsSidebar />
      <section className="chat-page__main" aria-label="Conversation">
        <header className="chat-page__header">
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
