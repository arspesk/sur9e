// Report route Suspense fallback — renders the SAME composition as the
// loaded page (topbar crumbs + .report-wrap/.content column + the shared
// <ReportSkeleton/>) so streaming in the real page doesn't jump the layout.
// The skeleton markup itself lives in features/report/report-skeleton.tsx,
// shared with the client query.isPending branch in report-page.tsx.
import { Topbar } from '@/components/shell/topbar';
import { ReportSkeleton } from '@/features/report/report-skeleton';

export default function Loading() {
  return (
    <>
      <Topbar
        crumbs={[
          { href: '/', label: 'Workspace' },
          { href: '/offers', label: 'Offers' },
          { label: '…' },
        ]}
      />
      <div className="report-wrap">
        <div className="content" id="reportHost">
          <ReportSkeleton />
        </div>
      </div>
    </>
  );
}
