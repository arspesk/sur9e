'use client';

/**
 * components/modals/negotiate-modal.tsx
 *
 * Confirm modal for the negotiate generator. Mirrors the other section
 * generators (research / interview-prep / outreach): on confirm it kicks off
 * the `negotiate` job, which runs content/modes/negotiate.md and appends a
 * "## Negotiation strategy" section to the report. The mode is archetype-aware
 * — comp benchmarks come from the offer + profile, not a hardcoded role.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/behavior/dialog';
import { Button } from '@/components/primitives';
import { jobEstimateLabel } from '@/lib/job-types';
import { useModalStore } from '@/stores/modal-store';
import { useGeneratorRun } from './use-generator-run';

export function NegotiateModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('negotiate');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  let title =
    num != null ? `Build a negotiation strategy for #${num}?` : 'Build a negotiation strategy?';
  if (isBatch) title = `Prepare negotiation strategy for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            Builds a comp negotiation brief for this offer: benchmarks the posted comp against your
            target band, drafts a counter, and scripts the talking points — tuned to the offer's
            archetype, not a fixed role.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('negotiate')}
            </li>
            <li>
              <strong>Result:</strong> a <code>## Negotiation strategy</code> section added to the
              report
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Build strategy
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
