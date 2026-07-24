'use client';

import { LoaderCircle } from 'lucide-react';

/** Collapsed tool chip: spinner while running → ✓ / ✕ terminal glyphs;
 * consecutive same-name calls arrive pre-grouped (count) from foldEvents. */
export function ToolCard({
  name,
  count,
  status,
  detail,
}: {
  name: string;
  count: number;
  status: 'running' | 'done' | 'error';
  detail?: string;
}) {
  return (
    <span className="chat-tool" data-status={status}>
      {status === 'running' && (
        <LoaderCircle size={11} className="chat-tool__spin" aria-hidden="true" />
      )}
      {status === 'done' && (
        <span className="chat-tool__glyph chat-tool__glyph--ok" aria-hidden="true">
          ✓
        </span>
      )}
      {status === 'error' && (
        <span className="chat-tool__glyph chat-tool__glyph--err" aria-hidden="true">
          ✕
        </span>
      )}
      <span className="chat-tool__name">
        {name}
        {count > 1 ? ` ×${count}` : ''}
      </span>
      {detail && <span className="chat-tool__detail">{detail}</span>}
      <span className="sr-only">{status}</span>
    </span>
  );
}
