export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { jsonError } from '@/lib/http-errors';
import type { ChatTurnEvent } from '@/lib/schemas/chat';
import { formatSseEvent, heartbeatFrame, SSE_HEADERS } from '@/lib/server/chat/sse';
import { getTurn, subscribeTurn } from '@/lib/server/chat/turn-runner';

interface Params {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid turn id', 400);
  const turn = getTurn(id);
  if (!turn) return jsonError('Turn not found', 404);

  // ?after=<seq> resume: replay buffered events past the cursor, then live-
  // stream. A page reload reattaches to a still-running turn with the last
  // seen seq (spec §3.4). Native EventSource CANNOT set a query param on its
  // automatic reconnect — it sends the last `id:` it saw back as the
  // Last-Event-ID header instead. Without this fallback, a transient drop
  // reconnects with afterSeq=0 and re-replays the whole turn from scratch.
  // ?after= wins when both are present (an explicit caller-supplied cursor,
  // e.g. a page reload restoring from stored state, takes precedence over
  // whatever the browser echoes back).
  const { searchParams } = new URL(request.url);
  // Returns null for missing/non-numeric/non-positive input — the caller
  // decides the fallback, rather than this helper defaulting to 0 itself.
  const parseSeq = (raw: string | null): number | null => {
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  const afterSeq =
    parseSeq(searchParams.get('after')) ?? parseSeq(request.headers.get('last-event-id')) ?? 0;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // Guards every teardown path below (replay-hit-terminal, already-terminal
  // on connect, live terminal event, enqueue-on-closed-controller, and
  // client disconnect) so the heartbeat interval is NEVER armed once the
  // stream has already closed — closeStream() is the single idempotent
  // close point every path routes through.
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const closeStream = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
    try {
      streamController?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const send = (event: ChatTurnEvent): void => {
        try {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        } catch {
          closeStream();
          return;
        }
        // The stream ends with the turn — a replayed terminal event closes too.
        if (event.type === 'done' || event.type === 'error') closeStream();
      };
      unsubscribe = subscribeTurn(id, send, afterSeq);
      // subscribeTurn replays buffered events synchronously, before the
      // assignment above lands. If one of those replayed events was
      // terminal, send() already called closeStream() while `unsubscribe`
      // was still null — its `unsubscribe?.()` was a no-op, so the
      // subscriber just added above (a closure over the now-closed
      // controller) would otherwise stay pinned in turn.subscribers.
      // Sweep it immediately when that happened.
      if (closed) unsubscribe?.();
      // Terminal turn whose terminal event sits at or before `after`: the
      // replay had nothing left to deliver — end the stream immediately
      // instead of heartbeating forever.
      const current = getTurn(id);
      if (!current || (current.status !== 'running' && afterSeq >= current.seq)) closeStream();
      // Only arm the heartbeat if the stream is still open — reconnecting to
      // an already-finished turn (reload, past transcript, tab dup) must not
      // leave a live setInterval + phantom subscriber around for HEARTBEAT_MS.
      if (!closed) {
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(heartbeatFrame()));
          } catch {
            closeStream();
          }
        }, HEARTBEAT_MS);
      }
    },
    cancel() {
      // Client disconnect detaches ONLY — the turn keeps running server-side
      // (two-tier cancellation, spec §3.4). Explicit stop is the cancel route.
      closeStream();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
