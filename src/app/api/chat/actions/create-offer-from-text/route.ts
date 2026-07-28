export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { CreateOfferFromTextActionRequest } from '@/lib/schemas/chat-actions';
import {
  createConfirm,
  describeCreateOfferFromText,
  describeTextOfferResult,
} from '@/lib/server/chat/confirms';
import { startJob } from '@/lib/server/jobs';
import { createOrReuseTextOffer, previewTextOffer } from '@/lib/server/text-offers';
import { revalidatePath } from '@/server/revalidate';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateOfferFromTextActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { terminalApproved, ...input } = parsed.data;
  try {
    const preview = previewTextOffer(ROOT, input.text);
    const { summary, meta } = describeCreateOfferFromText(preview, input);
    const turnId = request.headers.get('x-sur9e-turn');
    if (turnId) {
      const { token } = createConfirm(ROOT, {
        turnId,
        kind: 'create-offer-from-text',
        payload: input,
        summary,
        meta,
      });
      return Response.json({ needsConfirm: true, token, summary, meta });
    }
    if (terminalApproved !== true) {
      return Response.json({ needsConfirm: true, summary, meta });
    }
    const textOffer = createOrReuseTextOffer(ROOT, input);
    const job = input.startKind
      ? startJob(ROOT, { kind: input.startKind, params: { num: textOffer.offer.num } })
      : undefined;
    const presentation = describeTextOfferResult(textOffer, input.startKind, job);
    revalidatePath('/offers');
    return Response.json({
      created: !textOffer.reused,
      reused: textOffer.reused,
      offer: textOffer.offer,
      ...(job ? { job } : {}),
      ...presentation,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to create text offer', 400);
  }
}
