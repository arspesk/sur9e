export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadApplicationsWithSummary } from '@/lib/server/applications';

export function GET() {
  try {
    const entries = loadApplicationsWithSummary(ROOT);
    return Response.json({ entries, count: entries.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load applications');
  }
}
