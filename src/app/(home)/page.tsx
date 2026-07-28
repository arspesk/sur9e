import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { HomePage } from '@/features/home/home-page';
import { isPendingOfferStatus, selectPendingOffers } from '@/features/home/pending-offers-select';
import { ROOT } from '@/lib/root';
import { loadApplicationsWithSummary } from '@/lib/server/applications';
import { loadFollowupState } from '@/lib/server/followups';
import { getOnboardingStatus } from '@/lib/server/onboarding-status';
import { loadScanQueueStatus } from '@/lib/server/scan-status';

export const metadata: Metadata = {
  title: 'sur9e — Home',
};

// Same rationale as /offers: applications.md and follow-ups.md change between
// requests (status moves, CLI writes), so the read happens per-request.
export const dynamic = 'force-dynamic';

export default function Page() {
  // First run has no tracker to summarize — keep the existing onboarding
  // flow, which lives on the Offers surface.
  const { missing } = getOnboardingStatus(ROOT);
  if (missing.length > 0) redirect('/offers');

  const entries = loadApplicationsWithSummary(ROOT);
  const followups = loadFollowupState(ROOT);
  const scan = loadScanQueueStatus(ROOT);

  const waitingOnYou = entries.filter(e => isPendingOfferStatus(e.status)).length;

  return (
    <HomePage
      followupEntries={followups.entries}
      followupsDue={followups.overdue + followups.urgent}
      waitingOnYou={waitingOnYou}
      screeningPending={scan.pendingCount}
      pendingOffers={selectPendingOffers(
        entries.map(e => ({
          num: e.num,
          company: e.company,
          role: e.role,
          score: e.score,
          status: e.status,
          reportPath: e.reportPath,
          companyLogo: e.summary?.company_logo || null,
        })),
      )}
    />
  );
}
