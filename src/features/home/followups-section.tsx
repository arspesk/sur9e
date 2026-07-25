'use client';

// Follow-ups due — one two-line row per actionable application:
//
//   [logo] company (line 1, links to the report when there is one)
//          role · urgency pill (line 2)                        [⋮ kebab]
//
// Every action lives in the kebab; the row itself stays a quiet, non-wrapping
// two-liner so it survives the ~460px column the two-column Home layout gives
// each section.

import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Send } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { CompanyAvatar } from '@/components/domain/company-avatar';
import { KebabActionsMenu, type KebabItem } from '@/components/domain/kebab-actions-menu';
import { useToastStore } from '@/components/toast/toast-store';
import { isPhoneViewport } from '@/features/chat/use-mobile-chat-redirect';
import type { FollowupEntry } from '@/lib/server/followups';
import { logFollowupAction } from '@/server/actions/followups';
import { useChatStore } from '@/stores/chat-store';

// Only rows that are actually due. A "waiting" row is one the cadence says to
// leave alone, so listing it under "Follow-ups due" contradicts the heading and
// pads the queue with things there is nothing to do about.
const SHOWN_URGENCIES = new Set(['urgent', 'overdue']);
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
// accepts either the report filename OR a bare num. `reportPath` only decides
// *whether* there is a report to link to.
function reportHref(e: FollowupEntry): Route | null {
  if (!e.reportPath) return null;
  return `/report/${encodeURIComponent(String(e.num))}` as Route;
}

/** Pill copy. `daysSinceApplication` is null when nothing ever recorded the
 *  apply/respond transition — no age is known, so the row reads as a neutral
 *  "waiting" with no day count rather than inventing one. */
function urgencyLabel(e: FollowupEntry): string {
  if (e.urgency === 'urgent') return 'urgent';
  if (e.urgency === 'overdue') {
    return e.daysSinceApplication == null ? 'overdue' : `overdue · ${e.daysSinceApplication}d`;
  }
  return e.nextFollowupDate ? `waiting · next ${e.nextFollowupDate}` : 'waiting';
}

function draftPrompt(e: FollowupEntry): string {
  return (
    `Draft a follow-up email for offer #${e.num} (${e.company} — ${e.role}). ` +
    `Status: ${e.status}, ` +
    // Omitted rather than printed as "null days ago" when the transition was
    // never logged (daysSinceApplication is nullable).
    (e.daysSinceApplication == null ? '' : `tracked ${e.daysSinceApplication} days ago, `) +
    `${e.followupCount} follow-up${e.followupCount === 1 ? '' : 's'} sent so far. ` +
    `Use my report and keep it short.`
  );
}

export function FollowupsSection({ entries }: { entries: FollowupEntry[] }) {
  const router = useRouter();
  const push = useToastStore(s => s.push);
  const setAutoSendMessage = useChatStore(s => s.setAutoSendMessage);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);
  const openChat = useChatStore(s => s.openChat);

  const shown = entries.filter(e => SHOWN_URGENCIES.has(e.urgency)).slice(0, 5);

  const markDone = useMutation({
    mutationFn: (appNum: number) => logFollowupAction({ appNum, channel: 'app' }),
    onSuccess: (_row, appNum) => {
      push('success', `#${appNum} marked followed up`);
      router.refresh(); // Home is an RSC — refresh re-runs loadFollowupState
    },
    onError: err => push('danger', err instanceof Error ? err.message : 'Failed to log follow-up'),
  });

  /** Hand the draft to /chat, which sends it on arrival. Uses the dedicated
   * autoSendMessage slot rather than the composer's queued-message slot: the
   * composer restores that one into the input, so the two consumers would race
   * and the prompt could end up typed-but-unsent. */
  function draftInChat(e: FollowupEntry) {
    setActiveConversation(null);
    setAutoSendMessage(draftPrompt(e));
    // Phones open the bubble in place rather than routing to /chat, which
    // bounces back here anyway — see isPhoneViewport's note. Either surface
    // picks the prompt out of the auto-send slot and sends it.
    if (isPhoneViewport()) {
      openChat();
      return;
    }
    router.push('/chat');
  }

  // No "Open report" item — the company name is already the link to it.
  function kebabItems(e: FollowupEntry): KebabItem[] {
    return [
      { label: 'Draft follow-up', icon: <Send {...ICON} />, onClick: () => draftInChat(e) },
      {
        label: 'Mark followed up',
        icon: <BadgeCheck {...ICON} />,
        disabled: markDone.isPending,
        onClick: () => markDone.mutate(e.num),
      },
    ];
  }

  if (shown.length === 0) {
    return (
      <section id="followups" className="home-section" aria-label="Follow-ups">
        <h2 className="home-section__label">Follow-ups</h2>
        <p className="home-section__empty">Nothing due — your applications are all warm.</p>
      </section>
    );
  }

  return (
    <section id="followups" className="home-section" aria-label="Follow-ups due">
      <h2 className="home-section__label">Follow-ups due</h2>
      {shown.map(e => {
        const href = reportHref(e);
        return (
          <div key={e.num} className="home-row">
            <CompanyAvatar
              company={e.company}
              logoUrl={e.companyLogo ?? undefined}
              className="cmk home-row__logo"
            />
            <div className="home-row__text">
              <span className="home-row__head">
                {href ? (
                  <Link href={href} className="home-row__company home-row__company--link">
                    {e.company}
                  </Link>
                ) : (
                  <span className="home-row__company">{e.company}</span>
                )}
                <span className="home-row__pill" data-urgency={e.urgency}>
                  {urgencyLabel(e)}
                </span>
              </span>
              <span className="home-row__role">{e.role}</span>
            </div>
            <RowKebab label={`${e.company} follow-up`} items={kebabItems(e)} />
          </div>
        );
      })}
    </section>
  );
}
