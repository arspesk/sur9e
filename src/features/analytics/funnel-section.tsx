'use client';

// Pipeline-funnel card: five anchor rows with stage label, bar+fill,
// count, percentage. Screened is pre-pipeline and lives in the side-note
// with Discarded below so it doesn't dominate the conversion read.
// Rejections get their own caption line under the funnel: they ARE part of
// the conversion path (they applied), so they're reported as an exit rate
// with stage-of-rejection detail from the status-transition log.

import type { Route } from 'next';
import Link from 'next/link';
import { Card } from '@/components/primitives';
import type { computeStatusBreakdown, RejectionStats } from '@/lib/analytics/compute';

type Breakdown = ReturnType<typeof computeStatusBreakdown>;

// Human label for the stage a rejection came from (byStageFrom keys).
const STAGE_LABELS: Record<string, string> = {
  applied: 'after applying',
  responded: 'after a response',
  interview: 'after an interview',
  offer: 'after an offer',
  discarded: 'after discarding',
  unknown: 'stage unknown',
};

interface StageDef {
  key: keyof Breakdown;
  label: string;
  // Typed via Route (C2.4 typedRoutes) — every href below is `/pipeline` +
  // hash fragment, which matches `${StaticRoutes}${SearchOrHash}` in
  // generated link.d.ts.
  href: Route;
  fillVar: string;
}

const STAGES: ReadonlyArray<StageDef> = [
  {
    key: 'evaluated',
    label: 'Evaluated',
    href: '/offers?view=kanban#status=evaluated',
    fillVar: 'var(--s-evaluated)',
  },
  {
    key: 'applied',
    label: 'Applied',
    href: '/offers?view=kanban#status=applied',
    fillVar: 'var(--s-applied)',
  },
  {
    key: 'responded',
    label: 'Responded',
    href: '/offers?view=kanban#status=responded',
    fillVar: 'var(--s-responded)',
  },
  {
    key: 'interview',
    label: 'Interview',
    href: '/offers?view=kanban#status=interview',
    fillVar: 'var(--s-interview)',
  },
  {
    key: 'offer',
    label: 'Offer received',
    href: '/offers?view=kanban#status=offer',
    fillVar: 'var(--s-offer)',
  },
];

interface FunnelSectionProps {
  breakdown: Breakdown;
  totalOffers: number;
  rejections?: RejectionStats;
}

export function FunnelSection({ breakdown, totalOffers, rejections }: FunnelSectionProps) {
  const safeTotal = totalOffers || 1;

  function pctOf(count: number): number {
    return Math.round((count / safeTotal) * 100 * 10) / 10;
  }

  const sCount = breakdown.screened || 0;
  const dCount = breakdown.discarded || 0;
  const sPct = pctOf(sCount);
  const dPct = pctOf(dCount);

  // Stage-of-rejection fragments, most common first ("3 after applying, 1 after an interview").
  const rejectedByStage = Object.entries(rejections?.byStageFrom ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([stage, n]) => `${n} ${STAGE_LABELS[stage] ?? stage}`)
    .join(', ');

  return (
    <Card className="funnel-card anim-enter">
      <h2>Pipeline funnel</h2>
      <p className="funnel-caption">Where offers stall — added this period, by current stage.</p>
      {STAGES.map(stage => {
        const count = breakdown[stage.key];
        const pct = pctOf(count);
        const width = count > 0 ? Math.max(pct, 0.5) : 0;
        return (
          <Link
            key={stage.key}
            className="funnel-row"
            data-funnel-stage={stage.key}
            href={stage.href}
          >
            <span className="funnel-label">{stage.label}</span>
            <div className="funnel-bar">
              <div
                className="funnel-fill"
                data-funnel-fill={stage.key}
                style={{ width: `${width}%`, background: stage.fillVar }}
                aria-hidden="true"
              />
            </div>
            <span className="funnel-count" data-funnel-count={stage.key}>
              {count}
            </span>
            <span className="funnel-pct" data-funnel-pct={stage.key}>
              {pct}%
            </span>
          </Link>
        );
      })}
      <p className="funnel-caption funnel-caption--discarded" id="funnelDiscarded">
        {sCount === 0 && dCount === 0 ? (
          'No offers screened or discarded this period.'
        ) : (
          <>
            {'Plus '}
            {sCount > 0 && (
              <>
                <Link className="discarded-link" href="/offers?view=kanban#status=screened">
                  <strong>{sCount}</strong> screened
                </Link>
                {` (${sPct}%)`}
              </>
            )}
            {sCount > 0 && dCount > 0 && ' and '}
            {dCount > 0 && (
              <>
                <Link className="discarded-link" href="/offers?view=kanban#status=discarded">
                  <strong>{dCount}</strong> discarded
                </Link>
                {` (${dPct}%)`}
              </>
            )}
            {' — not part of the conversion path.'}
          </>
        )}
      </p>
      {rejections && (
        <p className="funnel-caption funnel-caption--rejected" id="funnelRejected">
          {rejections.rejected === 0 ? (
            'No rejections this period.'
          ) : (
            <>
              <Link className="discarded-link" href="/offers?view=kanban#status=rejected">
                <strong>{rejections.rejected}</strong> rejected
              </Link>
              {rejections.rejectionRatePct != null &&
                ` — ${rejections.rejectionRatePct}% of everything applied`}
              {rejectedByStage && ` (${rejectedByStage})`}
              {rejections.medianDaysAppliedToRejected != null &&
                `, median ${rejections.medianDaysAppliedToRejected}d from apply to rejection`}
              .
            </>
          )}
        </p>
      )}
    </Card>
  );
}
