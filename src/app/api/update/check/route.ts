export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { runUpdateSystem } from '@/lib/server/update-system';

export function GET() {
  try {
    const out = runUpdateSystem('check', 30000);
    return Response.json(JSON.parse(out.trim()));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to check for updates');
  }
}
