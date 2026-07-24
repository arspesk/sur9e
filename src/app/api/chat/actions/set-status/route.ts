export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { SetStatusActionRequest } from '@/lib/schemas/chat-actions';
import { updateStatus } from '@/lib/server/applications';
import { createConfirm, describeSetStatus } from '@/lib/server/chat/confirms';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = SetStatusActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { num, status, terminalApproved } = parsed.data;

  const turnId = request.headers.get('x-sur9e-turn');
  const { summary, meta } = describeSetStatus(num, status);

  // Web chat context: EVERY tracker write requires the confirm card —
  // terminalApproved is deliberately ignored here.
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'set-status',
      payload: { num, status },
      summary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary, meta });
  }

  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary, meta });
  }

  try {
    const updated = updateStatus(ROOT, num, status);
    if (!updated) return jsonError(`num not found: ${num}`, 404);
    return Response.json({ updated: true, entry: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to update status';
    return jsonError(msg, msg.includes('not found') ? 404 : 500);
  }
}
