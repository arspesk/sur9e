export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { findActiveJob } from '@/lib/server/jobs';

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  if (!type) return jsonError('type query param required', 400);
  return Response.json({ active: findActiveJob(ROOT, type) });
}
