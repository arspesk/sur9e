'use client';

/**
 * hooks/use-job-action.ts
 *
 * Shared kick-off hook for any background job that follows the legacy
 * "startJobAction → loadingModal.startJob(id, type) → waitForTerminal →
 * optional refresh" pattern. Consolidates what used to live as eight
 * separate window.runXXX() helpers (run-evaluate.js, run-tailor-cv.js,
 * run-cover-letter.js, run-research.js, run-interview-process.js,
 * run-outreach.js).
 *
 * The hook returns a `run(params, opts?)` function that:
 *   1. POSTs to /api/jobs/<type> with the given JSON params
 *   2. Opens the cross-page loading-modal anchored to the spawned job id
 *      (the modal owns polling at POLL_MS=2000 — see loading-modal.tsx)
 *   3. Awaits the modal's `waitForTerminal(id)` Promise — resolves with
 *      the terminal JobSnapshot when status becomes 'done' or 'error',
 *      rejects with AbortError if the user dismisses mid-flight
 *   4. On 'done': invalidates the ['applications'] query if `refreshOnDone`
 *      is set — NO toast; the deck card is the completion notification
 *   5. On 'error': returns `snapshot.error || failMsg` — NO toast; the card
 *      shows the error state
 *   6. Returns `{ done, error?, cancelled? }` matching the legacy contract
 *
 * The loading-modal derives titles from `kind` + `num` ("Generating evaluate
 * for offer #42"). `opts.onDone` fires after a successful job — used by the
 * report viewer to reload the page so flag-driven UI (button hides, TOC
 * entry appears) updates.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';
import { useToastStore } from '@/components/toast/toast-store';
import { JOB_TYPES_BY_TYPE } from '@/lib/job-types';
import type { JobType } from '@/lib/server/jobs';
import { startJobAction } from '@/server/actions/jobs';

export interface JobActionResult {
  done: number; // 1 on success, 0 otherwise
  error?: string;
  cancelled?: boolean;
}

export interface JobActionRunOpts {
  /**
   * Fires after a successful job completes. The optional
   * `result.markdown` chunk lets the report-page slash-insert flow swap a
   * `<runningMode>` placeholder for the generated body inline (see
   * features/report/mode-slash-items.ts). A future change will wire mode
   * templates to emit that chunk into the job snapshot; for now we always
   * pass `{ markdown: '' }` and the placeholder collapses to nothing.
   */
  onDone?: (result?: { markdown?: string }) => Promise<void> | void;
}

export function useJobAction(type: string) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore(s => s.push);
  const startJob = useLoadingModalStore(s => s.startJob);
  const waitForTerminal = useLoadingModalStore(s => s.waitForTerminal);

  const run = useCallback(
    async (
      params: Record<string, unknown> = {},
      opts: JobActionRunOpts = {},
    ): Promise<JobActionResult> => {
      const meta = JOB_TYPES_BY_TYPE[type];
      if (!meta) {
        const msg = `Unknown job type: ${type}`;
        pushToast('danger', msg);
        return { done: 0, error: msg };
      }

      // 1. Spawn the job via the server action. The action mirrors the
      //    legacy route contract: returns a JobRecord on success, or a
      //    `{ conflict: true }` payload for singleton kinds (scan /
      //    batch-evaluate) when another is already running.
      let jobId: string;
      try {
        const result = await startJobAction({ kind: type as JobType, params });
        if ('setupRequired' in result) {
          // First-run preflight refusal — cv.md / profile.yml missing. The
          // message carries the onboarding pointer; warning (not danger)
          // because nothing failed, setup just isn't done yet.
          pushToast('warning', result.message);
          return { done: 0, error: result.message };
        }
        if ('conflict' in result) {
          // Legacy 409 branch — non-fatal info toast and stop.
          const err = `A ${meta.pillTitle.replace('…', '').toLowerCase()} job is already running`;
          pushToast('info', err);
          return { done: 0, error: err };
        }
        if (!result?.id) {
          const err = `${type} spawn returned no id`;
          pushToast('danger', err);
          return { done: 0, error: err };
        }
        jobId = result.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : `${type} spawn failed`;
        pushToast('danger', msg);
        return { done: 0, error: msg };
      }

      // 2. Open the loading modal — it owns polling. Title is derived from
      //    kind + num in the card; opts.title is no longer forwarded.
      startJob(jobId, type, typeof params.num === 'number' ? params.num : undefined);

      // 3. Await terminal state.
      let snapshot: Awaited<ReturnType<typeof waitForTerminal>>;
      try {
        snapshot = await waitForTerminal(jobId);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { done: 0, cancelled: true };
        }
        const msg = err instanceof Error ? err.message : 'Job failed';
        pushToast('danger', msg);
        return { done: 0, error: msg };
      }

      // 4. Done or error?
      if (snapshot.status === 'done') {
        if (opts.onDone) {
          try {
            // snapshot doesn't yet carry a separate markdown chunk — pass
            // an empty string for now so the slash-insert placeholder
            // collapses to nothing. Mode templates will later emit a body
            // chunk into JobSnapshot, and we'll forward it here.
            await opts.onDone({ markdown: '' });
          } catch (err) {
            console.warn('[useJobAction] onDone hook failed:', err);
          }
        }
        if (meta.refreshOnDone) {
          queryClient.invalidateQueries({ queryKey: ['applications'] });
        }
        return { done: 1 };
      }

      // No toast on job error — the deck card shows the error state with
      // actions (spec 2026-06-05-corner-notifications). failMsg survives
      // as the returned error fallback for callers.
      const errMsg = snapshot.error || meta.failMsg;
      return { done: 0, error: errMsg };
    },
    [type, queryClient, pushToast, startJob, waitForTerminal],
  );

  return { run };
}
