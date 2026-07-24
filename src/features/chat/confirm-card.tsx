'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/primitives';
import { chatSessionKey } from '@/hooks/use-chat-sessions';
import { useChatStore } from '@/stores/chat-store';
import type { ConfirmActionKind } from './fold-events';

// Matches FoldedItem's confirm.outcome union exactly (src/features/chat/fold-events.ts),
// which itself mirrors ChatTurnEvent's confirm-resolved outcome enum
// (src/lib/schemas/chat.ts). 'pending' is the pre-resolution default.
export type ConfirmOutcome = 'pending' | 'approved' | 'cancelled' | 'expired';

// Approval reads as an actual outcome, per action kind: a start-job says the
// job kicked off (and where to watch it), a set-status/edit-report confirm
// its write. The generic '✓ Confirmed' covers confirm events persisted before
// the kind field existed (foldEvents leaves `action` undefined there).
const APPROVED_LABEL_BY_ACTION: Record<ConfirmActionKind, string> = {
  'start-job': '✓ Started — running in the jobs strip',
  'set-status': '✓ Status updated',
  'edit-report': '✓ Report updated',
};

function resolvedLabel(
  outcome: Exclude<ConfirmOutcome, 'pending'>,
  action: ConfirmActionKind | undefined,
): string {
  if (outcome === 'cancelled') return '✕ Cancelled';
  if (outcome === 'expired') return '⃠ Expired';
  return (action && APPROVED_LABEL_BY_ACTION[action]) || '✓ Confirmed';
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
  action,
}: {
  token: string;
  summary: string;
  meta: string;
  outcome: ConfirmOutcome;
  /** Which gated action this card confirms — varies the resolved label. */
  action?: ConfirmActionKind;
}) {
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Optimistic local outcome. The confirm-resolved SSE event only fires while
  // the turn's stream is still open, but a job's card is usually resolved AFTER
  // the turn finished — so relying on that event alone leaves the card stuck on
  // disabled buttons with no resolved message. Resolve from the POST response.
  const [localOutcome, setLocalOutcome] = useState<ConfirmOutcome | null>(null);
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
      const data = (await res.json().catch(() => null)) as { outcome?: ConfirmOutcome } | null;
      // Immediate feedback: swap the buttons for the resolved message now.
      setLocalOutcome(data?.outcome ?? (approve ? 'approved' : 'cancelled'));
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
  if (effectiveOutcome !== 'pending') {
    return (
      <div className="chat-confirm" data-outcome={effectiveOutcome}>
        <p className="chat-confirm__summary">{summary}</p>
        <p className="chat-confirm__resolved">{resolvedLabel(effectiveOutcome, action)}</p>
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
