'use client';

// Pending offers — screened/evaluated rows still waiting on a decision,
// highest score first (ordering comes from selectPendingOffers on the
// server). Screened rows hand off to the shared evaluate confirm modal,
// which PATCHes status→evaluated and spawns the evaluation job; evaluated
// rows get the two terminal picks, Mark applied / Discard.

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatusPill } from '@/components/domain/status-pill';
import type { PendingOffer } from '@/features/home/pending-offers-select';
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { scoreLevel } from '@/lib/scoring';
import { useModalStore } from '@/stores/modal-store';

// /report/[filename] resolves its segment through numFromFilename, which
// accepts either the report filename OR a bare num — and every other link
// into it passes the num (offers-drawer, pipeline-page, chat-jobs-slot).
// Match that. `reportPath` only decides *whether* there's a report to
// link to; a screened row that was never evaluated renders plain text.
function reportHref(offer: PendingOffer): Route | null {
  if (!offer.reportPath) return null;
  return `/report/${encodeURIComponent(String(offer.num))}` as Route;
}

export function PendingOffersSection({ offers }: { offers: PendingOffer[] }) {
  const router = useRouter();
  const openModal = useModalStore(s => s.open);
  // Failure toasts come from useUpdateApplicationStatus's hook-level
  // onError — adding a per-call onError here would double-toast.
  const updateStatus = useUpdateApplicationStatus();

  if (offers.length === 0) {
    return (
      <section id="pending" className="home-section" aria-label="Pending offers">
        <h2 className="home-section__label">Pending offers</h2>
        <p className="home-section__empty">No offers waiting on a decision.</p>
      </section>
    );
  }

  return (
    <section id="pending" className="home-section" aria-label="Pending offers">
      <h2 className="home-section__label">Pending offers</h2>
      {offers.map(o => {
        const href = reportHref(o);
        // Tracker scores ship as strings ("4.2/5", "N/A", "—") — parseFloat
        // reads the leading number and NaNs on the sentinels, which we skip.
        const score = Number.parseFloat(o.score);
        return (
          <div key={o.num} className="home-row">
            <div className="home-row__text">
              {href ? (
                <Link href={href} className="home-row__company home-row__company--link">
                  {o.company}
                </Link>
              ) : (
                <span className="home-row__company">{o.company}</span>
              )}
              <span className="home-row__role">{o.role}</span>
            </div>
            {!Number.isNaN(score) && (
              <span className="home-row__score" data-tier={scoreLevel(score)}>
                {score.toFixed(1)}
              </span>
            )}
            <StatusPill status={o.status} />
            {o.status === 'screened' ? (
              <button
                type="button"
                className="home-row__btn home-row__btn--primary"
                onClick={() =>
                  openModal('evaluate', {
                    num: o.num,
                    patchToEvaluated: true,
                    // EvaluateModal fires onConfirm *before* its own
                    // status PATCH, and the action only revalidates
                    // /offers, /pipeline and /report — Home isn't in that
                    // list, so refresh from here. The pill may lag by one
                    // frame; the next refresh settles it.
                    onConfirm: () => router.refresh(),
                  })
                }
              >
                Evaluate
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="home-row__btn home-row__btn--primary"
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate(
                      { num: o.num, status: 'applied' },
                      { onSuccess: () => router.refresh() },
                    )
                  }
                >
                  Mark applied
                </button>
                <button
                  type="button"
                  className="home-row__btn"
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate(
                      { num: o.num, status: 'discarded' },
                      { onSuccess: () => router.refresh() },
                    )
                  }
                >
                  Discard
                </button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
