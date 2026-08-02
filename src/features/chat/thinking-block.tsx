'use client';

import { WrapText } from 'lucide-react';
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

  // Providers sometimes emit a thinking event with no body — a chip for it
  // opens onto blank space and reads as broken. While streaming the chip is
  // still worth showing: it carries the elapsed counter, and the text arrives
  // delta by delta after the event does.
  if (!streaming && !text.trim()) return null;

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
        <WrapText className="chat-thinking__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="chat-thinking__body" id={bodyId}>
          {text}
        </div>
      )}
    </div>
  );
}
