export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { ChatAttachment } from '@/lib/schemas/chat';
import { ProviderId } from '@/lib/schemas/providers';
import { getConversation } from '@/lib/server/chat/store';
import { startTurn } from '@/lib/server/chat/turn-runner';
import { getOnboardingStatus } from '@/lib/server/onboarding-status';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

interface Params {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TurnBody = z
  .object({
    message: z.string().max(32_000).optional(),
    regenerate: z.literal(true).optional(),
    attachments: z.array(ChatAttachment).max(8).optional(),
    referencedOffers: z.array(z.number().int().positive()).max(20).optional(),
    provider: ProviderId.optional(),
    model: z.string().min(1).max(120).optional(),
    // Semantic on-screen-awareness summary (Part 1) — richer than a bare path,
    // so the cap is generous but still bounded.
    pageContext: z.string().max(1200).optional(),
    // On-screen text selections the user staged as chips (Part 2) — capped in
    // count + length to match the chat store's ceilings.
    selections: z.array(z.string().max(2000)).max(5).optional(),
  })
  // The turn runner only applies an override when BOTH are present
  // (turn-runner.ts's `opts.provider && opts.model` check) — a
  // provider-only or model-only request would otherwise be silently
  // ignored instead of rejected.
  .refine(data => Boolean(data.provider) === Boolean(data.model), {
    message: 'provider and model must both be present, or both be omitted',
  })
  // A normal turn needs text OR attachments; regenerate carries neither.
  .refine(
    data =>
      data.regenerate === true
        ? data.message == null && !data.attachments?.length
        : (data.message ?? '').trim().length > 0 || (data.attachments?.length ?? 0) > 0,
    { message: 'message or attachments required (regenerate carries neither)' },
  );

export async function POST(request: Request, { params }: Params) {
  // Chat turns spend AI tokens — same cross-origin gate as the job routes.
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid session id', 400);
  // Cheap, no-I/O request-shape checks before the ROOT-backed existence
  // lookup below — a malformed body shouldn't cost a store read.
  const parsed = TurnBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Surface the both-or-neither refinement's message when that's the
    // failure; fall back to the generic message for ordinary shape errors
    // (matches the sibling chat routes' convention).
    const custom = parsed.error.issues.find(issue => issue.code === 'custom');
    return jsonError(custom?.message ?? 'invalid body', 400);
  }
  if (!getConversation(ROOT, id)) return jsonError('Session not found', 404);
  // Onboarding preflight, same predicate the jobs flow gates on
  // (src/lib/server/jobs/start.ts): a brand-new install has no
  // cv.md/profile.yml yet, so a spawned turn would just fail deep inside the
  // agent. Surface a `setupRequired` signal instead of starting a doomed turn
  // so the chat UI can show the "finish setup" card.
  if (!getOnboardingStatus(ROOT).ready) {
    return Response.json({ setupRequired: true }, { status: 200 });
  }
  try {
    const { turnId, userMessageId } = await startTurn(ROOT, {
      conversationId: id,
      userMessage: parsed.data.message,
      regenerate: parsed.data.regenerate,
      attachments: parsed.data.attachments,
      referencedOffers: parsed.data.referencedOffers,
      provider: parsed.data.provider,
      model: parsed.data.model,
      pageContext: parsed.data.pageContext,
      selections: parsed.data.selections,
    });
    return Response.json({ turnId, userMessageId }, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to start turn');
  }
}
