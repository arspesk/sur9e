'use client';

/**
 * components/modals/interview-process-modal.tsx
 *
 * Verbatim port of public/interview-process-modal.js. Confirms before
 * kicking off the interview-prep job.
 *
 * Legacy quirk: the interview-process modal markup lives in report.html
 * (pre-rendered with [data-modal-title] etc.) — the JS file just toggles
 * `hidden`. We rebuild the same markup here so the modal works on every
 * page that opens it, not just /report.
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

export function InterviewProcessModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('interview-prep');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  let title = num != null ? `Generate interview prep for #${num}?` : 'Generate interview prep?';
  if (isBatch) title = `Prepare interview prep for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This drafts interview prep notes — likely question themes, what to highlight from your
            CV, and what to ask back.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('interview-prep')}
            </li>
            <li>
              <strong>Result:</strong> Interview prep section in the report
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Generate interview prep
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
