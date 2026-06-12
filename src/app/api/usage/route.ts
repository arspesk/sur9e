export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadUsage } from '@/lib/server/usage';

export function GET() {
  try {
    return Response.json(loadUsage(ROOT));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load usage');
  }
}
