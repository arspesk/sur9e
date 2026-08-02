'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { chatSessionKey } from '@/hooks/use-chat-sessions';
import type { ChatActionLink } from '@/lib/schemas/chat';
import { useChatStore } from '@/stores/chat-store';
import { useChatJobsStore } from './chat-jobs-store';
import type { ConfirmActionKind } from './fold-events';

// Matches FoldedItem's confirm.outcome union exactly (src/features/chat/fold-events.ts),
// which itself mirrors ChatTurnEvent's confirm-resolved outcome enum
// (src/lib/schemas/chat.ts). 'pending' is the pre-resolution default.
export type ConfirmOutcome = 'pending' | 'approved' | 'cancelled' | 'expired';

// Approval reads as an actual outcome, per action kind: a start-job says the
// job kicked off (and where to watch it), a set-status/edit-report confirm
// its write. The generic "Confirmed" covers confirm events persisted before
// the kind field existed (foldEvents leaves `action` undefined there).
const APPROVED_LABEL_BY_ACTION: Record<ConfirmActionKind, string> = {
  'start-job': 'Started — running in the jobs strip',
  'start-workflow': 'Workflow started — child jobs are running',
  'cancel-job': 'Job cancelled',
  'cancel-workflow': 'Workflow cancelled',
  'create-offer-from-text': 'Offer ready',
  'set-status': 'Status updated',
  'edit-report': 'Report updated',
};

function resolvedLabel(
  outcome: Exclude<ConfirmOutcome, 'pending'>,
  action: ConfirmActionKind | undefined,
  execution: ConfirmExecution | undefined,
): string {
  if (outcome === 'cancelled') return 'Cancelled';
  if (outcome === 'expired') return 'Expired';
  if (execution === 'failed') return 'Action failed';
  if (execution === 'unchanged') {
    if (action === 'cancel-job') return 'Job already finished';
    if (action === 'cancel-workflow') return 'Workflow already finished';
    if (action === 'start-job') return 'Job not started';
    return 'No changes made';
  }
  return (action && APPROVED_LABEL_BY_ACTION[action]) || 'Confirmed';
}

function ResolvedIcon({
  outcome,
  execution,
}: {
  outcome: Exclude<ConfirmOutcome, 'pending'>;
  execution: ConfirmExecution | undefined;
}) {
  if (outcome === 'cancelled' || execution === 'failed') return <X aria-hidden="true" />;
  if (outcome === 'expired') return <Ban aria-hidden="true" />;
  if (execution === 'unchanged') return <Minus aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

type ConfirmExecution = 'succeeded' | 'failed' | 'unchanged';

interface ConfirmResponseJob {
  id?: string;
  type?: string;
  status?: string;
  params?: Record<string, unknown>;
  output?: string;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  provider?: string;
  model?: string;
  conflict?: boolean;
  setupRequired?: boolean;
  message?: string;
}

interface ConfirmResponseResult {
  ok?: boolean;
  error?: string;
  job?: ConfirmResponseJob;
  workflow?: { id?: string; status?: string };
  jobs?: ConfirmResponseJob[];
  textOffer?: { offer?: { num?: number } };
  cancellation?: { job?: ConfirmResponseJob };
  message?: string;
  links?: ChatActionLink[];
}

/** Inline confirm card for gated actions (spec §3.2). Approval executes
 * server-side via the Plan 2 token route; the terminal state arrives as a
 * confirm-resolved event which re-renders this card via foldEvents. Buttons
 * stay disabled between a successful POST and that event. */
export function ConfirmCard({
  token,
  summary,
  meta,
  outcome,
  execution,
  action,
  message,
  links,
}: {
  token: string;
  summary: string;
  meta: string;
  outcome: ConfirmOutcome;
  execution?: ConfirmExecution;
  /** Which gated action this card confirms — varies the resolved label. */
  action?: ConfirmActionKind;
  message?: string;
  links?: ChatActionLink[];
}) {
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Optimistic local outcome. The confirm-resolved SSE event only fires while
  // the turn's stream is still open, but a job's card is usually resolved AFTER
  // the turn finished — so relying on that event alone leaves the card stuck on
  // disabled buttons with no resolved message. Resolve from the POST response.
  const [localOutcome, setLocalOutcome] = useState<ConfirmOutcome | null>(null);
  const [localExecution, setLocalExecution] = useState<ConfirmExecution | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [localLinks, setLocalLinks] = useState<ChatActionLink[] | null>(null);
  const queryClient = useQueryClient();

  async function respond(approve: boolean) {
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/chat/confirms/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) throw new Error(`Confirm failed (${res.status}). Try again.`);
      const data = (await res.json().catch(() => null)) as {
        outcome?: ConfirmOutcome;
        execution?: ConfirmExecution;
        result?: ConfirmResponseResult;
      } | null;
      // Immediate feedback: swap the buttons for the resolved message now.
      setLocalOutcome(data?.outcome ?? (approve ? 'approved' : 'cancelled'));
      setLocalExecution(data?.execution ?? null);
      setLocalMessage(data?.result?.message ?? null);
      setLocalLinks(data?.result?.links ?? null);
      if (data?.result?.ok === false && data.result.error) {
        useToastStore.getState().push('danger', data.result.error);
      }
      if (data?.result?.ok === true) {
        if (data.result.textOffer) {
          void queryClient.invalidateQueries({ queryKey: ['applications'] });
        }
        const started = data.result.job;
        if (started?.conflict && started.message) {
          useToastStore.getState().push('warning', started.message);
        } else if (
          started?.id &&
          started.type &&
          (started.status === 'queued' || started.status === 'running')
        ) {
          const num =
            typeof started.params?.num === 'number'
              ? started.params.num
              : data.result.textOffer?.offer?.num;
          useChatJobsStore.getState().startJob(started.id, started.type, num);
        }
        for (const child of data.result.jobs ?? []) {
          if (child.id && child.type && (child.status === 'queued' || child.status === 'running')) {
            const num = typeof child.params?.num === 'number' ? child.params.num : undefined;
            useChatJobsStore.getState().startJob(child.id, child.type, num);
          }
        }
        const cancelled = data.result.cancellation?.job;
        if (cancelled?.id && cancelled.status === 'cancelled') {
          useChatJobsStore.getState().setSnapshot(cancelled.id, {
            status: 'cancelled',
            output: cancelled.output,
            startedAt: cancelled.startedAt,
            finishedAt: cancelled.finishedAt,
            error: cancelled.error ?? undefined,
            params: cancelled.params,
            provider: cancelled.provider,
            model: cancelled.model,
          });
        }
      }
      // Refresh the persisted conversation so a close/reopen — which re-mounts
      // this card from the query cache — reflects the now-persisted resolution
      // instead of the stale pending confirm.
      const activeId = useChatStore.getState().activeConversationId;
      if (activeId) void queryClient.invalidateQueries({ queryKey: chatSessionKey(activeId) });
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Confirm failed. Try again.');
      setPosting(false);
    }
  }

  const effectiveOutcome = localOutcome ?? outcome;
  const effectiveExecution = localExecution ?? execution;
  const effectiveMessage = localOutcome ? localMessage : message;
  const effectiveLinks = localOutcome ? localLinks : links;
  if (effectiveOutcome !== 'pending') {
    return (
      <div className="chat-confirm" data-outcome={effectiveOutcome}>
        <p className="chat-confirm__summary">{summary}</p>
        <p className="chat-confirm__resolved">
          <ResolvedIcon outcome={effectiveOutcome} execution={effectiveExecution} />
          {resolvedLabel(effectiveOutcome, action, effectiveExecution)}
        </p>
        {effectiveMessage && <p className="chat-confirm__result">{effectiveMessage}</p>}
        {effectiveLinks && effectiveLinks.length > 0 && (
          <div className="chat-confirm__links">
            {effectiveLinks.map(link => (
              <a key={link.href} className="chat-confirm__link" href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Active-verb primary label straight from the action summary ("Start
  // evaluation for #12"); overlong summaries fall back to a generic verb.
  const primaryLabel = summary.length <= 40 ? summary : 'Approve';

  return (
    <div className="chat-confirm">
      <p className="chat-confirm__summary">{summary}</p>
      {meta && <p className="chat-confirm__meta">{meta}</p>}
      <div className="chat-confirm__actions">
        <Button size="sm" disabled={posting} onClick={() => void respond(true)}>
          {primaryLabel}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={posting}
          onClick={() => void respond(false)}
        >
          Cancel
        </Button>
      </div>
      {postError && <p className="chat-confirm__error">{postError}</p>}
    </div>
  );
}
