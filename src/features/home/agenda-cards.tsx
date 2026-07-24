'use client';

// Agenda digest: four live counts, one CTA each. The ghosted oversized icon
// per card is brand accent at 10% opacity, rotated -10deg, bleeding past the
// card edge (styled by .agenda-card__wm in home-inline.css).

import { Activity, ArrowRight, BadgeCheck, Clock, type LucideIcon, Mailbox } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/primitives';
import { useChatJobsStore } from '@/features/chat/chat-jobs-store';
import { useChatStore } from '@/stores/chat-store';

// Sized by CSS (.agenda-card__cta svg) so the two CTA arrows stay identical.
const CTA_ARROW = { strokeWidth: 2.25, 'aria-hidden': true } as const;

interface AgendaCardProps {
  icon: LucideIcon;
  count: number;
  label: string;
  cta: React.ReactNode;
}

function AgendaCard({ icon: Icon, count, label, cta }: AgendaCardProps) {
  return (
    <Card className="agenda-card">
      <span className="agenda-card__wm" aria-hidden="true">
        <Icon strokeWidth={1.4} />
      </span>
      <div className="agenda-card__count">{count}</div>
      <div className="agenda-card__label">{label}</div>
      <div className="agenda-card__cta">{cta}</div>
    </Card>
  );
}

export function AgendaCards({
  followupsDue,
  waitingOnYou,
  screeningPending,
}: {
  followupsDue: number;
  waitingOnYou: number;
  screeningPending: number;
}) {
  const openChat = useChatStore(s => s.openChat);
  const jobsMap = useChatJobsStore(s => s.jobs);
  const jobsOrder = useChatJobsStore(s => s.order);
  const jobsRunning = jobsOrder.filter(id => {
    const st = jobsMap[id]?.snapshot?.status;
    return st !== 'done' && st !== 'error';
  }).length;

  return (
    <div className="agenda-grid">
      <AgendaCard
        icon={Clock}
        count={followupsDue}
        label={followupsDue === 1 ? 'follow-up due' : 'follow-ups due'}
        cta={<a href="#followups">Review ↓</a>}
      />
      <AgendaCard
        icon={Mailbox}
        count={waitingOnYou}
        label="waiting on you"
        cta={<a href="#pending">Decide ↓</a>}
      />
      <AgendaCard
        icon={BadgeCheck}
        count={screeningPending}
        label={screeningPending === 1 ? 'URL to screen' : 'URLs to screen'}
        cta={
          <Link href="/settings">
            Screen now <ArrowRight {...CTA_ARROW} />
          </Link>
        }
      />
      <AgendaCard
        icon={Activity}
        count={jobsRunning}
        label={jobsRunning === 1 ? 'job running' : 'jobs running'}
        cta={
          <button type="button" onClick={openChat}>
            View <ArrowRight {...CTA_ARROW} />
          </button>
        }
      />
    </div>
  );
}
