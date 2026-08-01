'use client';

// Context shape (passed via useModalStore.open('evaluate', context)):
//   { num?: number }            — single-row evaluate (default copy)
//   { count: number }           — batch evaluate (count > 1 switches title)
//   { patchToEvaluated?: bool } — set by the report-page flow to PATCH
//                                 the status to 'evaluated' before spawning.
//   { onStatusOnly?: fn }       — set by the batch bar's "Change status →
//                                 Evaluated" pick: renders an extra
//                                 "Set status only" button that closes and
//                                 applies the plain bulk PATCH without
//                                 spawning jobs. Cancel/Escape/overlay-click
//                                 stay a full abort (an accidental dismiss
//                                 must never write).
//
// On submit:
//   - Single-row → useJobAction('evaluate').run({ num, generate_pdf? })
//   - Batch      → useJobAction('batch-evaluate').run({ nums })

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/behavior/dialog';
import { Button } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useJobAction } from '@/hooks/use-job-action';
import { formatEstimate, JOB_TYPES_BY_TYPE, jobEstimateLabel } from '@/lib/job-types';
import { updateApplicationStatusAction } from '@/server/actions/applications';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';
import { runForNums } from './batch-run';

export function EvaluateModal() {
  const { context, close } = useModalStore();
  const queryClient = useQueryClient();
  const pushToast = useToastStore(s => s.push);
  const clearSelection = useSelectionStore(s => s.clear);
  const { run } = useJobAction('evaluate');
  const [generatePdf, setGeneratePdf] = useState(false);
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false);

  const returnFocus = (context?.returnFocus as HTMLElement | undefined) ?? undefined;
  const num = (context?.num as number | undefined) ?? undefined;
  const count = (context?.count as number | undefined) ?? undefined;
  const nums = (context?.nums as number[] | undefined) ?? undefined;
  const patchToEvaluated = (context?.patchToEvaluated as boolean | undefined) ?? false;
  // R2-5: insert the runningMode placeholder only on confirm. Undefined on
  // the batch path, where calling it is a no-op.
  const onConfirm = context?.onConfirm as (() => void) | undefined;
  // Batch "Change status → Evaluated" pick: skip the jobs, just PATCH.
  const onStatusOnly = context?.onStatusOnly as (() => void) | undefined;
  const isBatch = Number.isInteger(count) && (count as number) > 1;

  // Legacy `evaluate-modal.js` line 70-75: accept either confirm(num)
  // (single) or confirm({ count }) (batch). The title differs accordingly.
  let title = 'Run full evaluation?';
  if (isBatch) {
    title = `Run full evaluation for ${count} offers?`;
  } else if (num != null) {
    title = `Run full evaluation for #${num}?`;
  }

  // Run the job after the user confirms. For the report flow (single-row,
  // patchToEvaluated=true) we PATCH the application status first so the
  // status pill updates immediately, then spawn the eval job. Legacy did
  // both in run-evaluate.js lines 49-58.
  const handleSubmit = useCallback(async () => {
    close();
    onConfirm?.();
    // Any non-empty nums[] takes the fan-out path — NOT gated on isBatch.
    // The batch action bar passes { count, nums } and never `num`, so a
    // single selected row (count === 1, isBatch false) used to fall through
    // to the single branch and silently bail on `num == null`.
    if (Array.isArray(nums) && nums.length > 0) {
      // Batch path — mirrors legacy runEvaluate isBatch branch. Clears
      // selection up-front (matches legacy onSpawned callback) and then
      // spawns parallel evaluate jobs. The Next port doesn't have a
      // dedicated batch endpoint that takes nums[]; we fan-out to N
      // POSTs the same way legacy did. generate_pdf is forwarded per-job.
      clearSelection();
      const { done, failed } = await runForNums(run, nums, n => ({
        num: n,
        ...(generatePdf ? { generate_pdf: true } : {}),
        ...(generateCoverLetter ? { generate_cover_letter: true } : {}),
      }));
      if (done > 0) {
        pushToast('success', `${done} evaluation${done === 1 ? '' : 's'} complete`);
      }
      if (failed > 0) {
        pushToast('danger', `${failed} evaluation${failed === 1 ? '' : 's'} failed`);
      }
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      return;
    }
    if (num == null) return;
    if (patchToEvaluated) {
      try {
        await updateApplicationStatusAction({ num, status: 'evaluated' });
      } catch (err) {
        // Non-fatal — proceed with the spawn anyway.
        console.warn('[evaluate-modal] status→evaluated failed:', err);
      }
    }
    await run({
      num,
      ...(generatePdf ? { generate_pdf: true } : {}),
      ...(generateCoverLetter ? { generate_cover_letter: true } : {}),
    });
  }, [
    close,
    onConfirm,
    nums,
    num,
    patchToEvaluated,
    generatePdf,
    generateCoverLetter,
    run,
    clearSelection,
    queryClient,
    pushToast,
  ]);

  return (
    <Dialog open onOpenChange={v => !v && close()}>
      <DialogContent hideClose autoFocusPrimary returnFocus={returnFocus}>
        <DialogTitle>{title}</DialogTitle>
        <div className="evaluate-modal__body">
          <DialogDescription>
            This fetches the JD, evaluates against your CV in detail, and produces a full evaluation
            report.
          </DialogDescription>
          <ul className="evaluate-modal__details">
            <li>
              <strong>Time:</strong>{' '}
              {/* Sum of the same estimateS values that pace the progress
                  cards, so this promise matches the bars the user watches. */}
              {formatEstimate(
                JOB_TYPES_BY_TYPE.evaluate.estimateS +
                  (generatePdf ? JOB_TYPES_BY_TYPE['tailor-cv'].estimateS : 0) +
                  (generateCoverLetter ? JOB_TYPES_BY_TYPE['cover-letter'].estimateS : 0),
              )}
            </li>
            <li>
              <strong>Result:</strong>{' '}
              {[
                'Status → Evaluated, full report',
                ...(generatePdf ? ['tailored CV PDF'] : []),
                ...(generateCoverLetter ? ['cover letter PDF'] : []),
              ].join(' + ')}
            </li>
          </ul>
          <label className="evaluate-modal__pdf-opt">
            <input
              type="checkbox"
              checked={generatePdf}
              onChange={e => setGeneratePdf(e.target.checked)}
            />
            <span className="evaluate-modal__pdf-opt-label">Generate tailored CV PDF</span>
            <span className="evaluate-modal__pdf-opt-hint">
              adds {jobEstimateLabel('tailor-cv')} — runs the tailor-cv mode after evaluation
            </span>
          </label>
          <label className="evaluate-modal__pdf-opt">
            <input
              type="checkbox"
              checked={generateCoverLetter}
              onChange={e => setGenerateCoverLetter(e.target.checked)}
            />
            <span className="evaluate-modal__pdf-opt-label">Generate cover letter PDF</span>
            <span className="evaluate-modal__pdf-opt-hint">
              adds {jobEstimateLabel('cover-letter')} — runs the cover-letter mode after evaluation
            </span>
          </label>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="evaluate-modal__cancel" onClick={close}>
            Cancel
          </Button>
          {onStatusOnly ? (
            <Button
              variant="secondary"
              className="evaluate-modal__status-only"
              onClick={() => {
                close();
                onStatusOnly();
              }}
            >
              Set status only
            </Button>
          ) : null}
          <Button variant="primary" className="evaluate-modal__submit" onClick={handleSubmit}>
            Run evaluation
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
