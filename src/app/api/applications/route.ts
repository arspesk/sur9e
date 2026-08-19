export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { loadApplicationsWithSummary } from '@/lib/server/applications';
import {
  queryApplications,
  TRACKER_QUERY_PARAM_KEYS,
  TrackerQueryParams,
  toTrackerFilters,
} from '@/lib/server/tracker-query';

export function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const recognized = TRACKER_QUERY_PARAM_KEYS.filter(key => searchParams.has(key));

    // Back-compat: with no recognized params the payload stays byte-identical
    // to the legacy full-summary shape — the web UI's TanStack hook consumes it.
    if (recognized.length === 0) {
      const entries = loadApplicationsWithSummary(ROOT);
      return Response.json({ entries, count: entries.length });
    }

    const params = TrackerQueryParams.safeParse(
      Object.fromEntries(recognized.map(key => [key, searchParams.get(key)])),
    );
    if (!params.success) {
      const issue = params.error.issues[0];
      return jsonError(`Invalid query param ${issue.path.join('.')}: ${issue.message}`, 400);
    }
    return Response.json(queryApplications(ROOT, toTrackerFilters(params.data)));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load applications');
  }
}
