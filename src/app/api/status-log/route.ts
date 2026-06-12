export const runtime = 'nodejs';

import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { ApplicationStatus } from '@/lib/schemas/applications';
import { loadApplications, normalizeStatus } from '@/lib/server/applications';
import { loadStatusLog, reconcileStatusLog } from '@/lib/server/status-log';

/**
 * GET /api/status-log — the full status-transition log, reconciled first.
 *
 * Reconciliation runs on read so statuses changed outside updateStatus()
 * (hand-edits to applications.md, merge-tracker, normalize-statuses) get
 * synthetic 'reconciled' lines before analytics consume the log. The read
 * is therefore also the heal.
 */
export function GET() {
  try {
    const entries = loadApplications(ROOT);
    const current = [];
    for (const e of entries) {
      const parsed = ApplicationStatus.safeParse(normalizeStatus(e.status));
      if (parsed.success) current.push({ num: e.num, status: parsed.data });
    }
    reconcileStatusLog(ROOT, current);
    const transitions = loadStatusLog(ROOT);
    return Response.json({ transitions, count: transitions.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load status log');
  }
}
