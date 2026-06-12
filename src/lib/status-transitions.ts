// Single source of truth for per-offer status-pick rules, shared by every
// surface that changes ONE offer's status: the kanban drag (board.tsx), the
// status pill popover on board cards / report hero / drawer hero
// (StatusPopoverHost), and the table's status pill (offers-table.tsx).
//
// Rules (originally encoded only in the board's drag handler):
//   - anything → evaluated: the change must go through the evaluate confirm
//     modal (openModal('evaluate', { num, patchToEvaluated: true })) so the
//     status flip and the evaluation job stay one gesture — a silent PATCH
//     would leave an "Evaluated" row with no evaluation behind it.
//   - evaluated → screened: a plain PATCH like any other transition
//     (maintainer decision 2026-06-11; previously blocked). The status is
//     the pipeline stage only — the evaluation report keeps its `state:
//     evaluated` depth and stays intact, so nothing is "un-run."
//   - everything else: plain status PATCH, caller proceeds.
//
// Bulk surfaces (batch-action-bar.tsx) can't call this directly — the
// selection's per-row statuses vary, so there is no single `currentStatus`.
// They apply the same intent by keying off the pick alone: choosing
// 'evaluated' opens the evaluate confirm modal with the selected nums[]
// (confirm = spawn real evaluation jobs; an explicit "Set status only"
// button = plain bulk PATCH; Cancel/Escape = abort).
//
// Client-safe, framework-free, pure — unit-tested in
// src/lib/__tests__/status-transitions.test.ts.

export type StatusPickInterception =
  | { kind: 'proceed' }
  | { kind: 'blocked'; message: string }
  | { kind: 'evaluate-modal' };

export function interceptStatusPick(
  currentStatus: string | null | undefined,
  nextStatus: string,
): StatusPickInterception {
  const prev = (currentStatus || '').toLowerCase();
  const next = (nextStatus || '').toLowerCase();
  if (prev === next) return { kind: 'proceed' }; // no-op — callers treat as plain pick
  if (next === 'evaluated') return { kind: 'evaluate-modal' };
  return { kind: 'proceed' };
}
