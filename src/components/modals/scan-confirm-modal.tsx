'use client';

/**
 * components/modals/scan-confirm-modal.tsx
 *
 * Confirm step for the two Add-menu scan actions ('Scan with screening' /
 * 'Scan with evaluation'). Both spend real tokens — 'Scan with evaluation'
 * is the most expensive action in the app — yet they used to fire on a
 * single unconfirmed menu click while a single-row Evaluate always showed
 * a Cost/Time/Result confirm. This mirrors that evaluate-modal treatment.
 *
 * Controlled component (no modal-store registration): ActionsMenu owns the
 * pending job state and renders this dialog between menu click and the
 * onSelect dispatch, so the existing scan/batch-evaluate wiring in the
 * table and kanban pages is untouched.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/behavior/dialog';
import { Button } from '@/components/primitives';
import { jobEstimateLabel } from '@/lib/job-types';

export type ScanConfirmJobType = 'scan' | 'batch-evaluate';

interface ScanConfirmModalProps {
  jobType: ScanConfirmJobType;
  /** Focus target when the dialog closes (the Add trigger button). */
  returnFocus?: HTMLElement;
  onCancel: () => void;
  onConfirm: () => void;
}

const COPY: Record<ScanConfirmJobType, { title: string; description: string; result: string }> = {
  scan: {
    title: 'Run scan with screening?',
    description:
      'Scans your enabled sources for new offers and runs a quick fit screen on each new find.',
    result: 'New offers in your Offers list with screening verdicts',
  },
  'batch-evaluate': {
    title: 'Run scan with evaluation?',
    description:
      'Scans your enabled sources for new offers, then runs a full evaluation on every pending offer.',
    result: 'Full evaluation report for every pending offer',
  },
};

export function ScanConfirmModal({
  jobType,
  returnFocus,
  onCancel,
  onConfirm,
}: ScanConfirmModalProps) {
  const copy = COPY[jobType];

  return (
    <Dialog open onOpenChange={v => !v && onCancel()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{copy.title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>{copy.description}</DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong>{' '}
              {/* Same estimateS that paces the progress card — single source
                  of truth, so this promise matches the bar the user watches. */}
              {jobEstimateLabel(jobType)}
            </li>
            <li>
              <strong>Result:</strong> {copy.result}
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={onConfirm}>
            Start scan
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
