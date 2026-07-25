'use client';

// Pending offers — screened/evaluated rows still waiting on a decision,
// highest score first (ordering comes from selectPendingOffers on the
// server). Each row is a two-liner:
//
//   [logo] company (line 1, links to the report when there is one)
//          role · score · status pill (line 2)            [⋮ kebab]
//
// Actions live in the kebab: screened rows hand off to the shared evaluate
// confirm modal, which PATCHes status→evaluated and spawns the evaluation
// job; evaluated rows get the terminal picks, Mark applied / Discard.

import { BadgeCheck, Sparkles, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { CompanyAvatar } from '@/components/domain/company-avatar';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { StatusPill } from '@/components/domain/status-pill';
import type { PendingOffer } from '@/features/home/pending-offers-select';
import { useUpdateApplicationStatus } from '@/hooks/use-applications';
import { scoreLevel } from '@/lib/scoring';
import { useModalStore } from '@/stores/modal-store';

const ICON = { size: 15, strokeWidth: 1.8 } as const;

/** Per-row ⋮ trigger + its portaled actions menu. Own open state per row.
 *  (Same shape as chat-threads-sidebar's RowKebab — kept local because the
 *  two Home sections are the only other users and neither owns a shared
 *  module.) */
function RowKebab({ label, items }: { label: string; items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="home-row__kebab"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen(o => !o)}
      >
        ⋮
      </button>
      {open && (
        <KebabActionsMenu
          items={items}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          ariaLabel={`Actions for ${label}`}
        />
      )}
    </>
  );
}

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

  function evaluate(o: PendingOffer) {
    openModal('evaluate', {
      num: o.num,
      patchToEvaluated: true,
      // EvaluateModal fires onConfirm *before* its own status PATCH, and
      // the action only revalidates /offers, /pipeline and /report — Home
      // isn't in that list, so refresh from here. The pill may lag by one
      // frame; the next refresh settles it.
      onConfirm: () => router.refresh(),
    });
  }

  function setStatus(o: PendingOffer, status: 'applied' | 'discarded') {
    updateStatus.mutate({ num: o.num, status }, { onSuccess: () => router.refresh() });
  }

  // No "Open report" item — the company name is already the link to it.
  function kebabItems(o: PendingOffer): KebabItem[] {
    // A screened row can still be applied to directly — evaluating first is the
    // recommended path, not a required one.
    const markApplied: KebabItem = {
      label: 'Mark applied',
      icon: <BadgeCheck {...ICON} />,
      disabled: updateStatus.isPending,
      onClick: () => setStatus(o, 'applied'),
    };
    const items: KebabItem[] =
      o.status === 'screened'
        ? [
            { label: 'Evaluate', icon: <Sparkles {...ICON} />, onClick: () => evaluate(o) },
            markApplied,
          ]
        : [markApplied];
    items.push({
      label: 'Discard',
      icon: <Trash2 {...ICON} />,
      danger: true,
      disabled: updateStatus.isPending,
      onClick: () => setStatus(o, 'discarded'),
    });
    return items;
  }

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
            <CompanyAvatar
              company={o.company}
              logoUrl={o.companyLogo ?? undefined}
              className="cmk home-row__logo"
            />
            <div className="home-row__text">
              <span className="home-row__head">
                {href ? (
                  <Link href={href} className="home-row__company home-row__company--link">
                    {o.company}
                  </Link>
                ) : (
                  <span className="home-row__company">{o.company}</span>
                )}
                {!Number.isNaN(score) && (
                  <span className="home-row__score" data-tier={scoreLevel(score)}>
                    {score.toFixed(1)}
                  </span>
                )}
                <StatusPill status={o.status} className="home-row__status" />
              </span>
              <span className="home-row__role">{o.role}</span>
            </div>
            <RowKebab label={`${o.company} offer`} items={kebabItems(o)} />
          </div>
        );
      })}
    </section>
  );
}
