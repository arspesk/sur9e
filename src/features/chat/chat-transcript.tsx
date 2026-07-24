'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ChatTurnEvent } from '@/lib/schemas/chat';
import { foldEvents } from './fold-events';
import { CopyMessageButton, FoldedEventList, MessageView } from './message-view';
import { groupTranscript } from './version-groups';

export interface LiveTurn {
  events: ChatTurnEvent[];
  status: 'streaming' | 'done' | 'error';
}

const NEAR_BOTTOM_PX = 48;

/** Scroll-anchored transcript: when a reply starts, the just-sent user
 * message pins to the top of the viewport; while the user sits at the
 * bottom, streaming auto-follows; otherwise a jump-to-bottom button shows. */
export function ChatTranscript({
  messages,
  pendingUserMessage,
  live,
  onRetry,
  onRegenerate,
}: {
  messages: ChatMessage[];
  /** Optimistic echo of the message just sent, until the turn persists it. */
  pendingUserMessage: string | null;
  live: LiveTurn | null;
  onRetry: () => void;
  /** Re-run the last user message for a fresh reply (idle only). */
  onRegenerate?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const streaming = live?.status === 'streaming';
  const liveItems = useMemo(() => (live ? foldEvents(live.events) : null), [live]);

  // Pin the sent message to the top exactly once per streaming turn.
  const pinnedRef = useRef(false);
  useEffect(() => {
    if (!streaming) {
      pinnedRef.current = false;
      return;
    }
    if (pinnedRef.current) return;
    const el = scrollRef.current;
    const pin = pinRef.current;
    if (el && pin) {
      el.scrollTop = pin.offsetTop - 8;
      pinnedRef.current = true;
    }
  }, [streaming]);

  // Auto-follow growth only while already at the bottom.
  const liveLen = live?.events.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [liveLen, messages.length, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  }

  return (
    <div className="chat-transcript" ref={scrollRef} onScroll={onScroll}>
      {groupTranscript(messages).map((u, i, all) => {
        const isLastUnit = i === all.length - 1;
        const showRegen =
          isLastUnit && live == null && pendingUserMessage == null && onRegenerate != null;
        if (u.kind === 'versions') {
          return (
            <AssistantVersions
              key={u.group}
              versions={u.versions}
              onRetry={onRetry}
              onRegenerate={showRegen ? onRegenerate : undefined}
            />
          );
        }
        const mergeActions = showRegen && u.message.role === 'assistant';
        return (
          <Fragment key={u.message.id}>
            <MessageView message={u.message} onRetry={onRetry} hideActions={mergeActions} />
            {mergeActions && (
              <div className="chat-versions">
                <CopyMessageButton inline text={u.message.content} />
                <RegenerateButton onClick={onRegenerate} />
              </div>
            )}
          </Fragment>
        );
      })}
      {pendingUserMessage != null && (
        <div className="chat-msg chat-msg--user" ref={pinRef}>
          <div className="chat-user-bubble">{pendingUserMessage}</div>
        </div>
      )}
      {(pendingUserMessage != null || streaming) &&
        (liveItems == null || liveItems.length === 0) && <ResponseIndicator />}
      {liveItems && (
        <div className="chat-msg chat-msg--assistant" aria-busy={streaming || undefined}>
          <FoldedEventList items={liveItems} streaming={streaming ?? false} onRetry={onRetry} />
        </div>
      )}
      {/* Keep the working indicator visible after the first output too: while the
          model runs tool calls (e.g. fetching tracker/profile) between text
          chunks it produces no visible content, so without this the reply looks
          stalled mid-generation. Mutually exclusive with the pre-content one
          above (length === 0 vs > 0). */}
      {streaming && liveItems != null && liveItems.length > 0 && <ResponseIndicator />}
      {!atBottom && (
        <button
          type="button"
          className="chat-jump"
          aria-label="Jump to latest"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setAtBottom(true);
          }}
        >
          ↓
        </button>
      )}
    </div>
  );
}

/** Words shown while the reply hasn't produced anything visible yet. */
const RESPONDING_WORDS = [
  'Thinking',
  'Pondering',
  'Connecting dots',
  'Reading the tracker',
  'Weighing options',
  'Sketching an answer',
  'Cross-checking',
  'Lining things up',
];

/** Dead-air filler between send and the first streamed event: animated
 * spinner + a rotating word from the pool. Purely visual (aria-hidden) —
 * the card's sr-only live region already announces "AI is replying". */
function ResponseIndicator() {
  const [word, setWord] = useState(
    () => RESPONDING_WORDS[Math.floor(Math.random() * RESPONDING_WORDS.length)],
  );
  useEffect(() => {
    const t = setInterval(
      () =>
        setWord(w => RESPONDING_WORDS[(RESPONDING_WORDS.indexOf(w) + 1) % RESPONDING_WORDS.length]),
      3000,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="chat-responding" aria-hidden="true">
      <span className="chat-responding__spinner" />
      <span className="chat-responding__word">{word}…</span>
    </div>
  );
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="chat-regenerate"
      aria-label="Regenerate reply"
      title="Regenerate reply"
      onClick={onClick}
    >
      {/* Lucide refresh-cw glyph (inline SVG — no icon dep). */}
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
        className="lucide lucide-refresh-cw"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </button>
  );
}

/** One version-grouped reply: newest by default, ‹ i/N › to flip. View-only —
 * the LATEST version is always the one later turns build on. */
function AssistantVersions({
  versions,
  onRetry,
  onRegenerate,
}: {
  versions: ChatMessage[];
  onRetry: () => void;
  onRegenerate?: () => void;
}) {
  const [index, setIndex] = useState(versions.length - 1);
  // A new regeneration landing snaps the view to the newest version.
  const lastLen = useRef(versions.length);
  useEffect(() => {
    if (versions.length !== lastLen.current) {
      lastLen.current = versions.length;
      setIndex(versions.length - 1);
    }
  }, [versions.length]);
  const safeIndex = Math.min(index, versions.length - 1);
  return (
    <>
      <MessageView message={versions[safeIndex]} onRetry={onRetry} hideActions />
      <div className="chat-versions" role="group" aria-label="Reply versions">
        <CopyMessageButton inline text={versions[safeIndex].content} />
        {onRegenerate && <RegenerateButton onClick={onRegenerate} />}
        <button
          type="button"
          className="chat-versions__arrow"
          aria-label="Previous version"
          disabled={safeIndex === 0}
          onClick={() => setIndex(i => Math.max(0, i - 1))}
        >
          ‹
        </button>
        <span className="chat-versions__count" aria-live="polite">
          {safeIndex + 1}/{versions.length}
        </span>
        <button
          type="button"
          className="chat-versions__arrow"
          aria-label="Next version"
          disabled={safeIndex >= versions.length - 1}
          onClick={() => setIndex(i => Math.min(versions.length - 1, i + 1))}
        >
          ›
        </button>
      </div>
    </>
  );
}
