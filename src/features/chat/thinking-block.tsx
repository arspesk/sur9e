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
        <span aria-hidden="true" className="chat-thinking__caret">
          ▾
        </span>
      </button>
      {open && (
        <div className="chat-thinking__body" id={bodyId}>
          {text}
        </div>
      )}
    </div>
  );
}
