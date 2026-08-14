export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { UpdateOfferActionRequest } from '@/lib/schemas/chat-actions';
import { createConfirm, describeUpdateOffer } from '@/lib/server/chat/confirms';
import { applyOfferUpdate, validateOfferUpdate } from '@/lib/server/offer-update';
import { revalidatePath } from '@/server/revalidate';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = UpdateOfferActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { num, fields, bodyEdits, summary, terminalApproved } = parsed.data;

  // Fail fast so a doomed confirm card is never shown: unknown/protected
  // fields, bad values, missing report, and stale/ambiguous body matches all
  // 400 here. The resolver re-validates against the live files at approval.
  const validated = validateOfferUpdate(ROOT, num, fields, bodyEdits);
  if (!validated.ok) return jsonError(validated.error, 400);

  const turnId = request.headers.get('x-sur9e-turn');
  const { summary: cardSummary, meta } = describeUpdateOffer(validated.changeSet, summary);

  // Web chat context: EVERY write requires the confirm card — terminalApproved
  // is deliberately ignored here (the MCP relay also strips it; doubled guard).
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'update-offer',
      payload: { num, fields, bodyEdits },
      summary: cardSummary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary: cardSummary, meta });
  }

  // Terminal context (no turn id): the human is at the keyboard. The agent
  // must ask them directly, then re-call with terminalApproved.
  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary: cardSummary, meta });
  }

  try {
    const offerUpdate = applyOfferUpdate(ROOT, num, fields, bodyEdits);
    revalidatePath('/');
    revalidatePath('/offers');
    revalidatePath('/pipeline');
    revalidatePath('/report/[filename]', 'page');
    return Response.json({ updated: true, offerUpdate });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to update offer', 400);
  }
}
