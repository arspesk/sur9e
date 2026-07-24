export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { jsonError } from '@/lib/http-errors';
import { getTurn } from '@/lib/server/chat/turn-runner';

interface Params {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lightweight liveness probe for a turn. The reattach-on-switch check and
 * the background-turn watcher poll this instead of opening an SSE stream.
 * 404 also covers "server restarted, registry empty" — callers treat that
 * as terminal-unknown and fall back to the persisted messages. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid turn id', 400);
  const turn = getTurn(id);
  if (!turn) return jsonError('Turn not found', 404);
  return Response.json({ status: turn.status, conversationId: turn.conversationId });
}
