'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useToastStore } from '@/components/toast/toast-store';
import type { FollowupEntry } from '@/lib/server/followups';
import { logFollowupAction } from '@/server/actions/followups';
import { DRAFT_OVERRIDE_KEY, useChatStore } from '@/stores/chat-store';

const SHOWN_URGENCIES = new Set(['urgent', 'overdue', 'waiting']);

function draftPrompt(e: FollowupEntry): string {
  return (
    `Draft a follow-up email for offer #${e.num} (${e.company} — ${e.role}). ` +
    `Status: ${e.status}, tracked ${e.daysSinceApplication} days ago, ` +
    `${e.followupCount} follow-up${e.followupCount === 1 ? '' : 's'} sent so far. ` +
    `Use my report and keep it short.`
  );
}

export function FollowupsSection({ entries }: { entries: FollowupEntry[] }) {
  const router = useRouter();
  const push = useToastStore(s => s.push);
  const setQueuedMessage = useChatStore(s => s.setQueuedMessage);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);

  const shown = entries.filter(e => SHOWN_URGENCIES.has(e.urgency)).slice(0, 5);

  const markDone = useMutation({
    mutationFn: (appNum: number) => logFollowupAction({ appNum, channel: 'app' }),
    onSuccess: (_row, appNum) => {
      push('success', `#${appNum} marked followed up`);
      router.refresh(); // Home is an RSC — refresh re-runs loadFollowupState
    },
    onError: err => push('danger', err instanceof Error ? err.message : 'Failed to log follow-up'),
  });

  /** Prefill the /chat composer (never auto-send — spend stays attended):
   * queue the prompt under the draft key, open a fresh thread, navigate.
   * ChatComposer's queued-message restore effect pulls it into the input. */
  function draftInChat(e: FollowupEntry) {
    setActiveConversation(null);
    setQueuedMessage(DRAFT_OVERRIDE_KEY, draftPrompt(e));
    router.push('/chat');
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
      {shown.map(e => (
        <div key={e.num} className="home-row">
          <div className="home-row__text">
            <span className="home-row__company">{e.company}</span>
            <span className="home-row__role">{e.role}</span>
          </div>
          <span className="home-row__pill" data-urgency={e.urgency}>
            {e.urgency === 'urgent'
              ? 'urgent'
              : e.urgency === 'overdue'
                ? `overdue · ${e.daysSinceApplication}d`
                : `waiting · next ${e.nextFollowupDate ?? '—'}`}
          </span>
          <button
            type="button"
            className="home-row__btn home-row__btn--primary"
            onClick={() => draftInChat(e)}
          >
            Draft follow-up
          </button>
          <button
            type="button"
            className="home-row__btn"
            disabled={markDone.isPending}
            onClick={() => markDone.mutate(e.num)}
          >
            Mark followed up
          </button>
        </div>
      ))}
    </section>
  );
}
