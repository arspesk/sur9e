'use client';

/**
 * components/modals/use-generator-run.ts
 *
 * Shared confirm-and-run flow for the simple generator confirm modals
 * (cv, cover-letter, research, outreach, interview-process, negotiate).
 *
 * Every one of those modals had a byte-identical `handleSubmit`:
 *   1. close the modal
 *   2. fire the optional `onConfirm` (report-page slash-insert placeholder)
 *   3. batch branch (non-empty nums[]): clear selection, fan out one job
 *      per offer via runForNums, then push "<done> of <n> complete" /
 *      "<failed> of <n> failed" toasts and invalidate ['applications']
 *   4. single branch: run({ num }, { onDone })
 *
 * This hook owns that flow verbatim. Modals only differ in mode id, title,
 * body copy, and CTA label — all pure JSX/data left in each component.
 *
 * NOTE: the evaluate modal is deliberately NOT built on this hook. It
 * forwards extra per-job params (generate_pdf / generate_cover_letter),
 * runs a status PATCH on the single path, and uses different toast copy
 * ("<n> evaluations complete"). It shares only the runForNums fan-out
 * primitive, not this success/toast contract.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import { useJobAction } from '@/hooks/use-job-action';
import { useModalStore } from '@/stores/modal-store';
import { useSelectionStore } from '@/stores/selection-store';
import { runForNums } from './batch-run';

export interface GeneratorRunContext {
  num?: number;
  count?: number;
  nums?: number[];
  // onDone receives `{ markdown }` for inline slash-insert flows.
  onDone?: (result?: { markdown?: string }) => Promise<void> | void;
  // Insert the runningMode placeholder only on confirm.
  onConfirm?: () => void;
}

export interface GeneratorRun {
  /** Parsed single-row offer number from the modal context, if any. */
  num: number | undefined;
  /** True when invoked for a multi-row batch (count > 1). */
  isBatch: boolean;
  /** Batch size for the batch-path title copy. */
  count: number | undefined;
  /** Selected offer numbers for the batch path. */
  nums: number[] | undefined;
  /** Close the modal. */
  close: () => void;
  /** Confirm-and-run handler wired to the modal's primary CTA. */
  handleSubmit: () => Promise<void>;
}

/**
 * @param mode job type / mode id (e.g. 'tailor-cv', 'research') — used for
 *   both the loading-modal kind and the cost-runtime lookup in the caller.
 */
export function useGeneratorRun(mode: string): GeneratorRun {
  const { context, close } = useModalStore();
  const { run } = useJobAction(mode);
  const queryClient = useQueryClient();
  const pushToast = useToastStore(s => s.push);
  const clearSelection = useSelectionStore(s => s.clear);

  const num = (context?.num as number | undefined) ?? undefined;
  const onDone = context?.onDone as
    | ((result?: { markdown?: string }) => Promise<void> | void)
    | undefined;
  const onConfirm = context?.onConfirm as (() => void) | undefined;
  const count = (context?.count as number | undefined) ?? undefined;
  const nums = (context?.nums as number[] | undefined) ?? undefined;
  const isBatch = Number.isInteger(count) && (count as number) > 1;

  const handleSubmit = useCallback(async () => {
    close();
    onConfirm?.();
    // Any non-empty nums[] takes the fan-out path — NOT gated on isBatch.
    // The batch action bar passes { count, nums } and never `num`, so a
    // single selected row (count === 1, isBatch false) used to fall through
    // to the single branch and silently bail on `num == null`.
    if (Array.isArray(nums) && nums.length > 0) {
      clearSelection();
      const { done, failed } = await runForNums(run, nums);
      if (done > 0) pushToast('success', `${done} of ${nums.length} complete`);
      if (failed > 0) pushToast('danger', `${failed} of ${nums.length} failed`);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      return;
    }
    if (num == null) return;
    await run({ num }, { onDone });
  }, [close, onConfirm, nums, num, onDone, run, clearSelection, queryClient, pushToast]);

  return { num, isBatch, count, nums, close, handleSubmit };
}
