'use client';

/**
 * components/modals/cv-modal.tsx
 *
 * Verbatim port of public/cv-modal.js. Confirms before kicking off the
 * tailor-cv job.
 *
 * Context shape:
 *   { num?: number, onDone?: (result?: { markdown?: string }) => Promise<void> | void }
 *
 * The `onDone` callback (used by the report page) reloads the page so
 * `cv_pdf_path` flips the toolbar button from "Tailor CV" to "Download CV".
 * The callback now receives an optional `{ markdown }` payload so the
 * report-page slash-insert flow can swap a `<runningMode>` placeholder for
 * the generated body inline. Legacy reload-callers ignore the argument.
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

export function CvModal() {
  const { num, isBatch, count, close, handleSubmit } = useGeneratorRun('tailor-cv');
  const returnFocus = useModalStore(s => s.context?.returnFocus as HTMLElement | undefined);

  let title = num != null ? `Tailor CV for #${num}?` : 'Tailor CV?';
  if (isBatch) title = `Tailor CVs for ${count} offers?`;

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This rewrites your CV against the JD and produces an ATS-optimized PDF.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong> {jobEstimateLabel('tailor-cv')}
            </li>
            <li>
              <strong>Result:</strong> <code>artifacts/output/cv-...pdf</code> + Download button
            </li>
          </ul>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Tailor CV
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
