export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { readFileSync } from 'node:fs';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { resolveChatUploadPath } from '@/lib/server/chat/uploads';

interface Params {
  params: Promise<{ conversationId: string; file: string }>;
}

/** Serves a stored chat upload. resolveChatUploadPath is the traversal
 * guard: strict uuid/uuid.ext shape, allowlisted extension, containment. */
export async function GET(_request: Request, { params }: Params) {
  const { conversationId, file } = await params;
  const hit = resolveChatUploadPath(ROOT, `${conversationId}/${file}`);
  if (!hit) return jsonError('Not found', 404);
  return new Response(new Uint8Array(readFileSync(hit.absPath)), {
    headers: {
      'Content-Type': hit.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
