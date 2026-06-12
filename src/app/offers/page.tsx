import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PipelinePage } from '@/features/pipeline/pipeline-page';
import { normalizeApplications } from '@/features/table/applications-normalize';
import { TablePage } from '@/features/table/table-page';
import type { RawApplicationEntry } from '@/features/table/table-types';
import { ROOT } from '@/lib/root';
import { loadApplicationsWithSummary } from '@/lib/server/applications';
import { getOnboardingStatus } from '@/lib/server/onboarding-status';
import Loading from './loading';

export const metadata: Metadata = {
  title: 'Sur9e — Offers',
};

// force-dynamic stays. applications.md changes between requests (status
// moves, scan results land, drawer mutations), so a static snapshot would
// freeze the route at build time. The async server fetch + initialData
// plumbing still makes first paint show real content; this flag just
// guarantees the read happens per-request. The explicit <Suspense>
// boundary below satisfies Next's useSearchParams() requirement.
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ view?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const view = params.view === 'kanban' ? 'kanban' : 'table';

  const entries = loadApplicationsWithSummary(ROOT);
  // Server schema parses optional summary fields as `string | null`; client
  // interface uses `string | undefined`. JSON serialization treats both
  // identically; cast to bridge the two type surfaces.
  const initialData = normalizeApplications({
    entries: entries as RawApplicationEntry[],
    count: entries.length,
  });

  // First-run preflight: which personalization files are missing. Cheap
  // existsSync probe per request (the route is already force-dynamic) —
  // drives the empty-state onboarding pointer in OffersTable.
  const { missing: setupMissing } = getOnboardingStatus(ROOT);

  // The route-level /offers/loading.tsx is view-aware (reads searchParams)
  // and renders the correct table-vs-kanban skeleton, so the inner
  // Suspense here just needs a minimal shared fallback for any rarer
  // suspensions inside TablePage / PipelinePage. <Loading /> covers both.
  return (
    <Suspense fallback={<Loading />}>
      {view === 'kanban' ? (
        <PipelinePage initialData={initialData} />
      ) : (
        <TablePage initialData={initialData} setupMissing={setupMissing} />
      )}
    </Suspense>
  );
}
