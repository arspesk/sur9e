'use client';

import { Check, Copy, FileText } from 'lucide-react';
import { type Ref, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/primitives';
import { type ChatMessage, ChatTurnEvent } from '@/lib/schemas/chat';
import { ActivityStream } from './activity-stream';
import { renderChatMarkdown } from './chat-markdown';
import { ConfirmCard } from './confirm-card';
import { type FoldedItem, foldEvents } from './fold-events';

/** message.events is stored loose (unknown[] | null, see the ChatMessage
 * schema doc comment) — re-parse each element through ChatTurnEvent and
 * drop what doesn't validate rather than trusting it at the type level. */
function parseTurnEvents(events: unknown[] | null | undefined): ChatTurnEvent[] | null {
  if (!events?.length) return null;
  const parsed: ChatTurnEvent[] = [];
  for (const raw of events) {
    const r = ChatTurnEvent.safeParse(raw);
    if (r.success) parsed.push(r.data);
  }
  return parsed.length ? parsed : null;
}

function attachmentTypeLabel(mime: string): string {
  const [kind, rawSubtype] = mime.split('/');
  const subtype = rawSubtype?.split('+')[0]?.toUpperCase() || 'FILE';
  return `${subtype} ${kind === 'image' ? 'image' : 'file'}`;
}

/** Shared copy control: message-level and (via delegation) code blocks.
 * `inline` renders the always-visible icon variant used under AI replies;
 * the default stays the hover-revealed corner button on user bubbles.
 * Exported so the transcript can compose it into the combined action row
 * (copy + version arrows + regenerate) under the last assistant reply. */
export function CopyMessageButton({ text, inline = false }: { text: string; inline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions, insecure context) — skip silently
    }
  }
  return (
    <button
      type="button"
      className={inline ? 'chat-msg__copy chat-msg__copy--inline' : 'chat-msg__copy'}
      aria-label={copied ? 'Copied' : 'Copy message'}
      title="Copy message"
      data-copied={copied || undefined}
      onClick={() => void copy()}
    >
      {inline ? (
        copied ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )
      ) : copied ? (
        'Copied'
      ) : (
        'Copy'
      )}
    </button>
  );
}

/** Assistant markdown body. HTML injection is safe here: renderChatMarkdown
 * escapes raw HTML tokens. The click handler is DELEGATION for the code-block
 * copy buttons the renderer emits inside the HTML string. */
export function ChatMarkdownView({ markdown }: { markdown: string }) {
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest?.('.chat-codeblock__copy');
    if (!(btn instanceof HTMLButtonElement)) return;
    const code = btn.parentElement?.querySelector('pre code');
    if (!code?.textContent) return;
    void navigator.clipboard
      .writeText(code.textContent)
      .then(() => {
        btn.dataset.copied = 'true';
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.removeAttribute('data-copied');
          btn.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {});
  }
  return (
    // a11y: this div is only a delegation target — the buttons inside the
    // HTML are native <button>s, keyboard-activatable on their own.
    <div
      className="chat-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderChatMarkdown(markdown) }}
    />
  );
}

export function FoldedEventList({
  items,
  streaming,
  onRetry,
}: {
  items: FoldedItem[];
  streaming: boolean;
  onRetry?: () => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        switch (item.kind) {
          case 'text':
            // Fold order is stable within a turn — index keys are safe.
            return <ChatMarkdownView key={`t${i}`} markdown={item.markdown} />;
          case 'activity':
            return <ActivityStream key={`a${i}`} activity={item} streaming={streaming} />;
          case 'confirm':
            return (
              <ConfirmCard
                key={item.token}
                token={item.token}
                summary={item.summary}
                meta={item.meta}
                outcome={item.outcome}
                execution={item.execution}
                action={item.action}
                message={item.message}
                links={item.links}
              />
            );
          case 'usage':
            // costUsd is nullable (cost may be unknown mid-turn, see
            // fold-events.ts) — skip the row rather than render a garbled
            // amount until the real figure lands.
            return item.costUsd == null ? null : (
              <div key={`u${i}`} className="chat-usage">
                · ${item.costUsd.toFixed(2)}
              </div>
            );
          case 'error':
            return (
              <div key={`e${i}`} className="chat-error" role="alert">
                <span className="chat-error__msg">{item.message}</span>
                {onRetry && (
                  <Button variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </div>
            );
        }
      })}
    </>
  );
}

export function MessageView({
  message,
  onRetry,
  hideActions = false,
  rowRef,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  /** The transcript renders a combined row (copy + arrows + regenerate)
   * for the last assistant reply — suppress the built-in one there. */
  hideActions?: boolean;
  rowRef?: Ref<HTMLDivElement>;
}) {
  if (message.role === 'user') {
    return (
      <div className="chat-msg chat-msg--user" ref={rowRef}>
        <div className="chat-user-bubble">{message.content}</div>
        {message.attachments && message.attachments.length > 0 && (
          <div className="chat-msg__attachments">
            {message.attachments.map(a => (
              <span key={a.path} className="chat-attach-chip">
                {a.mime.startsWith('image/') ? (
                  <img
                    className="chat-attach-chip__thumb chat-attach-chip__thumb--sent"
                    src={`/api/chat/uploads/${a.path}`}
                    alt={a.name}
                    loading="lazy"
                  />
                ) : (
                  <span className="chat-attach-chip__icon" aria-hidden="true">
                    <FileText />
                  </span>
                )}
                <span className="chat-attach-chip__body">
                  <span className="chat-attach-chip__name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="chat-attach-chip__meta">{attachmentTypeLabel(a.mime)}</span>
                </span>
              </span>
            ))}
          </div>
        )}
        {message.referencedOffers && message.referencedOffers.length > 0 && (
          <div className="chat-msg__refs">
            {message.referencedOffers.map(num => (
              <span key={num} className="chat-offer-chip">
                #{num}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  const events = parseTurnEvents(message.events);
  const items = events ? foldEvents(events) : null;
  return (
    <div className="chat-msg chat-msg--assistant" ref={rowRef}>
      {items ? (
        <FoldedEventList items={items} streaming={false} onRetry={onRetry} />
      ) : (
        <ChatMarkdownView markdown={message.content} />
      )}
      {!hideActions && (
        <div className="chat-msg__actions">
          <CopyMessageButton inline text={message.content} />
        </div>
      )}
    </div>
  );
}
