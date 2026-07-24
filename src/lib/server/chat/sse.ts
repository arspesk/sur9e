// src/lib/server/chat/sse.ts
//
// SSE framing helpers for the chat events route (design spec §3.4). Kept in
// the server lib so the route stays thin glue and the wire format is
// unit-testable. `id:` carries the event seq — EventSource echoes it back as
// the Last-Event-ID header on automatic reconnect (it cannot add a query
// param there), and the route reads that header as a fallback resume cursor
// when ?after= is absent or invalid.

import 'server-only';
import type { ChatTurnEvent } from '../../schemas/chat';

/** Frame one turn event: `id: <seq>\ndata: <json>\n\n`. */
export function formatSseEvent(event: ChatTurnEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Comment-only keep-alive frame — ignored by EventSource, defeats idle proxy timeouts. */
export function heartbeatFrame(): string {
  return ': heartbeat\n\n';
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
