export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import {
  deleteConversation,
  getConversation,
  listMessages,
  renameConversation,
  setConversationArchived,
} from '@/lib/server/chat/store';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

interface Params {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid session id', 400);
  const session = getConversation(ROOT, id);
  if (!session) return jsonError('Session not found', 404);
  return Response.json({ session, messages: listMessages(ROOT, id) });
}

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine(d => d.title !== undefined || d.archived !== undefined, {
    message: 'title or archived required',
  });

export async function PATCH(request: Request, { params }: Params) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid session id', 400);
  if (!getConversation(ROOT, id)) return jsonError('Session not found', 404);
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('invalid body', 400);
  if (parsed.data.title !== undefined) renameConversation(ROOT, id, parsed.data.title);
  if (parsed.data.archived !== undefined) setConversationArchived(ROOT, id, parsed.data.archived);
  return Response.json({ session: getConversation(ROOT, id) });
}

export async function DELETE(request: Request, { params }: Params) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid session id', 400);
  if (!getConversation(ROOT, id)) return jsonError('Session not found', 404);
  deleteConversation(ROOT, id);
  return Response.json({ ok: true });
}
