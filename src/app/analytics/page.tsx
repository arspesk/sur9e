import type { Metadata } from 'next';
import { AnalyticsPage } from '@/features/analytics/analytics-page';
import { normalizeApplications } from '@/features/table/applications-normalize';
import type { RawApplicationEntry } from '@/features/table/table-types';
import { ROOT } from '@/lib/root';
import { ApplicationStatus } from '@/lib/schemas/applications';
import { loadApplicationsWithSummary, normalizeStatus } from '@/lib/server/applications';
import { loadStatusLog, reconcileStatusLog } from '@/lib/server/status-log';
import { loadUsage } from '@/lib/server/usage';

export const metadata: Metadata = {
  title: 'Sur9e — Analytics',
};

// force-dynamic stays. Same audit rationale as /table and /pipeline
// -- the async loadApplicationsWithSummary + loadUsage reads don't make
// Next 15 treat the route as dynamic, but both data/applications.md and
// data/usage.json change between requests (every CLI mode invocation
// rolls usage forward; status mutations rewrite applications). A static
// snapshot would freeze the analytics view at build time. SSR renders the
// deterministic default 30d range; the client's localStorage-saved range
// hydrates after mount.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const entries = loadApplicationsWithSummary(ROOT);
  // See app/table/page.tsx for the type-cast rationale (server-schema
  // nullable() vs client-interface undefined for optional summary fields).
  const applications = normalizeApplications({
    entries: entries as unknown as RawApplicationEntry[],
    count: entries.length,
  });
  const usage = loadUsage(ROOT);

  // Status-transition log: reconcile first (statuses changed by hand-edits
  // or CLI tools get synthetic lines), then load. Feeds the history-aware
  // funnel + rejection stats. Same heal-on-read as GET /api/status-log.
  const current = [];
  for (const e of entries) {
    const parsed = ApplicationStatus.safeParse(normalizeStatus(e.status));
    if (parsed.success) current.push({ num: e.num, status: parsed.data });
  }
  reconcileStatusLog(ROOT, current);
  const transitions = loadStatusLog(ROOT);

  return (
    <AnalyticsPage
      initialData={{
        applications,
        usage,
        statusLog: { transitions, count: transitions.length },
      }}
    />
  );
}
