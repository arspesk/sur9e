export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { getConversation } from '@/lib/server/chat/store';
import { CHAT_UPLOAD_MAX_FILES, saveChatUpload } from '@/lib/server/chat/uploads';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Multipart: field `conversationId` + repeated `files` entries. Validation
 * (extension allowlist, 10MB cap) lives in saveChatUpload. */
export async function POST(request: Request) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('multipart form data required', 400);
  }
  const conversationId = String(form.get('conversationId') ?? '');
  if (!UUID_RE.test(conversationId)) return jsonError('Invalid session id', 400);
  if (!getConversation(ROOT, conversationId)) return jsonError('Session not found', 404);
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0 || files.length > CHAT_UPLOAD_MAX_FILES) {
    return jsonError(`1-${CHAT_UPLOAD_MAX_FILES} files required`, 400);
  }
  try {
    const attachments = [];
    for (const f of files) attachments.push(await saveChatUpload(ROOT, conversationId, f));
    return Response.json({ attachments }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Upload failed', 400);
  }
}
