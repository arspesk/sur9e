'use client';

import { useEffect, useId, useState } from 'react';

/** Collapsible thinking block. While streaming: shimmering "Thinking…" with
 * an elapsed-seconds counter; settled: plain "Thinking" toggle. The body is
 * collapsed by default in both states. */
export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const bodyId = useId();

  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [streaming]);

  return (
    <div className="chat-thinking">
      <button
        type="button"
        className="chat-thinking__toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(o => !o)}
      >
        <span
          className={
            streaming
              ? 'chat-thinking__label chat-thinking__label--shimmer'
              : 'chat-thinking__label'
          }
        >
          {streaming ? `Thinking… ${seconds}s` : 'Thinking'}
        </span>
        {/* Lucide text-wrap glyph (inline SVG — the chat feature keeps its
            icons inline rather than pulling lucide-react into this bundle).
            Rotates when the block opens; see .chat-thinking__caret. */}
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
          className="chat-thinking__caret lucide lucide-text-wrap"
          aria-hidden="true"
        >
          <path d="m16 16-3 3 3 3" />
          <path d="M3 12h14.5a1 1 0 0 1 0 7H13" />
          <path d="M3 19h6" />
          <path d="M3 5h18" />
        </svg>
      </button>
      {open && (
        <div className="chat-thinking__body" id={bodyId}>
          {text}
        </div>
      )}
    </div>
  );
}
