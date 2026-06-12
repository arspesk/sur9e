'use client';

/**
 * components/modals/cover-letter-modal.tsx
 *
 * Verbatim port of public/cover-letter-modal.js. Confirms before kicking
 * off the cover-letter job.
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

export function CoverLetterModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('cover-letter');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  let title = num != null ? `Generate cover letter for #${num}?` : 'Generate cover letter?';
  if (isBatch) title = `Generate cover letters for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This drafts a one-page cover letter mapping JD quotes to proof points from your CV.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('cover-letter')}
            </li>
            <li>
              <strong>Result:</strong> <code>artifacts/output/cover-letter-...pdf</code> + Download
              button
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Generate
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
