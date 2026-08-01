export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { runUpdateSystem } from '@/lib/server/update-system';

export function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && new URL(origin).host !== host) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const out = runUpdateSystem('apply', 120000);
    return Response.json({ ok: true, output: out });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to apply update', 500);
  }
}
