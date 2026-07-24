export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { jsonError } from '@/lib/http-errors';
import { cancelTurn, getTurn } from '@/lib/server/chat/turn-runner';
import { rejectCrossOrigin } from '@/lib/server/same-origin';

interface Params {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function POST(request: Request, { params }: Params) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError('Invalid turn id', 400);
  if (!getTurn(id)) return jsonError('Turn not found', 404);
  // false = the turn had already settled; still a 200 — cancel is idempotent.
  return Response.json({ cancelled: cancelTurn(id) });
}
