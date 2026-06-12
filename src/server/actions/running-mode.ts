// src/server/actions/running-mode.ts
//
// Thin server actions for the in-editor `<runningMode>` placeholder
// lifecycle — all state/resolution logic lives in
// src/lib/server/running-mode.ts. `getRunningModeStatus(num, mode)` is
// polled every 2s by the useRunningModePoll hook
// (src/hooks/use-running-mode-poll.ts) so the placeholder card can swap to
// a "done" or "failed" state without a full page reload.
// `dismissRunningMode(num, mode)` is invoked from the placeholder's
// Dismiss button after a terminal state is observed (or to manually purge
// a stale entry).

'use server';

import { clearRunningModePlaceholder } from '@/lib/server/reports';
import {
  type ModeState,
  removeRunningModeState,
  resolveRunningModeStatus,
} from '@/lib/server/running-mode';

export type { ModeState } from '@/lib/server/running-mode';

/** See resolveRunningModeStatus for the three-step resolution order. */
export async function getRunningModeStatus(
  num: number,
  mode: string,
  since?: string,
): Promise<ModeState> {
  return resolveRunningModeStatus(num, mode, since);
}

/** Idempotent removal of a (num, mode) UI-state entry. */
export async function dismissRunningMode(num: number, mode: string): Promise<void> {
  removeRunningModeState(num, mode);
}

/**
 * Clears a finished running-mode placeholder end-to-end: removes the
 * `<!-- sur9e:running … -->` comment from the report file (preserving the
 * section the job appended) AND drops any explicit UI-state entry. The
 * caller hard-reloads afterwards so the uncontrolled editor re-syncs from
 * the now-clean file (section visible, card gone). We strip the comment
 * server-side rather than via the editor's own save because the open editor
 * holds a stale doc that lacks the out-of-band append — re-serializing it
 * would erase the section.
 *
 * Returns true when the on-disk comment was found/cleared so the caller can
 * gate its reload and avoid a reload loop on a persistent write failure.
 */
export async function clearRunningModePlaceholderAction(
  num: number,
  mode: string,
  startedAt: string,
): Promise<boolean> {
  const cleared = clearRunningModePlaceholder({ num, startedAt });
  removeRunningModeState(num, mode);
  return cleared;
}
