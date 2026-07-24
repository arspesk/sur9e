export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { createConversation, listConversations } from '@/lib/server/chat/store';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

export function GET() {
  try {
    return Response.json({ sessions: listConversations(ROOT) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to list chat sessions');
  }
}

const CreateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  mode: z.string().min(1).max(64).optional(),
});

export async function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const raw = await request.json().catch(() => ({}));
  const parsed = CreateBody.safeParse(raw ?? {});
  if (!parsed.success) return jsonError('invalid body', 400);
  try {
    return Response.json({ session: createConversation(ROOT, parsed.data) }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create chat session');
  }
}
