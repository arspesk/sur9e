'use client';

// Home — the control center at /. Chat hero on top (Option A "center stage"),
// agenda digest beneath it, then the two work queues side by side.

import { Topbar } from '@/components/shell/topbar';
import type { PendingOffer } from '@/features/home/pending-offers-select';
import type { FollowupEntry } from '@/lib/server/followups';
import { AgendaCards } from './agenda-cards';
import { FollowupsSection } from './followups-section';
import { HomeHero } from './home-hero';
import { PendingOffersSection } from './pending-offers-section';

export interface HomePageProps {
  followupEntries: FollowupEntry[];
  followupsDue: number;
  waitingOnYou: number;
  screeningPending: number;
  pendingOffers: PendingOffer[];
}

export function HomePage(props: HomePageProps) {
  return (
    <>
      {/* Every route in the app shell renders the topbar landmark; Home is
          the Workspace root, so the trail ends here. */}
      <Topbar crumbs={[{ label: 'Workspace' }]} />
      <div className="home">
        <HomeHero />
        <AgendaCards
          followupsDue={props.followupsDue}
          waitingOnYou={props.waitingOnYou}
          screeningPending={props.screeningPending}
        />
        <div className="home-columns">
          <FollowupsSection entries={props.followupEntries} />
          <PendingOffersSection offers={props.pendingOffers} />
        </div>
      </div>
    </>
  );
}
