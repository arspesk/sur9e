export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { NavigateActionRequest } from '@/lib/schemas/chat-actions';
import { emitTurnEvent } from '@/lib/server/chat/turn-runner';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = NavigateActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError('path must be an app-internal route starting with /', 400);
  }
  const turnId = request.headers.get('x-sur9e-turn');
  if (!turnId) {
    return jsonError('navigate requires an active web chat turn', 400);
  }
  emitTurnEvent(turnId, { type: 'ui', action: 'navigate', path: parsed.data.path });
  return Response.json({ ok: true });
}
