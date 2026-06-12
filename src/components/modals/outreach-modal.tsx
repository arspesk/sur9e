'use client';

/**
 * components/modals/outreach-modal.tsx
 *
 * Verbatim port of public/outreach-modal.js. Confirms before kicking
 * off the outreach job.
 *
 * Legacy quirk: the outreach modal markup also lives in report.html as
 * pre-rendered placeholder; rebuilt here.
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

export function OutreachModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('reach-out');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  // Lead with the same verb as the menu item that opened this ("Reach out")
  // so one click flow doesn't rename its own feature mid-stream.
  let title = num != null ? `Reach out for #${num}?` : 'Reach out?';
  if (isBatch) title = `Reach out for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This identifies relevant people at the company and drafts personalized outreach messages
            mapped to your CV.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('reach-out')}
            </li>
            <li>
              <strong>Result:</strong> Outreach section in the report
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Reach out
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
