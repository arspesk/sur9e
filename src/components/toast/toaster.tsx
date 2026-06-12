'use client';

import { useEffect, useRef, useState } from 'react';
import { useToastStore } from './toast-store';

// Match legacy toast.js:62 verbatim (3500ms auto-dismiss).
const AUTO_DISMISS_MS = 3500;

function ToastItem({ id, message, tone }: { id: string; message: string; tone: string }) {
  const dismiss = useToastStore(s => s.dismiss);
  const [paused, setPaused] = useState(false);
  // Track elapsed time when paused so resume keeps the remaining lifetime
  // rather than restarting the full timeout (avoids "user hovered → toast
  // lingers full 3.5s after they move away" feel).
  const startedAt = useRef(Date.now());
  const remaining = useRef(AUTO_DISMISS_MS);

  useEffect(() => {
    if (paused) {
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
      return;
    }
    startedAt.current = Date.now();
    const t = setTimeout(() => dismiss(id), remaining.current);
    return () => clearTimeout(t);
  }, [id, dismiss, paused]);

  return (
    <div
      className={`toast ${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12 }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(id)}
        className="toast__dismiss"
        style={{
          background: 'transparent',
          border: 0,
          color: 'inherit',
          cursor: 'pointer',
          padding: 4,
          fontSize: 18,
          lineHeight: 1,
          opacity: 0.7,
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore(s => s.toasts);

  return (
    <div className="toast-host" role="log" aria-live="polite" aria-label="Notifications">
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem id={t.id} message={t.message} tone={t.tone} />
        </div>
      ))}
    </div>
  );
}
