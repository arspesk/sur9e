'use client';

/**
 * components/modals/research-modal.tsx
 *
 * Verbatim port of public/research-modal.js. Confirms before kicking
 * off the research job.
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

export function ResearchModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('research');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  let title = num != null ? `Research #${num}?` : 'Run company research?';
  if (isBatch) title = `Run company research for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This runs a deep company research pass — funding, leadership, recent news, what people
            are saying.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('research')}
            </li>
            <li>
              <strong>Result:</strong> Company research section in the report
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Run research
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
