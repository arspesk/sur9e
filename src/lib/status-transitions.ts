// Single source of truth for per-offer status-pick rules, shared by every
// surface that changes ONE offer's status: the kanban drag (board.tsx), the
// status pill popover on board cards / report hero / drawer hero
// (StatusPopoverHost), and the table's status pill (offers-table.tsx).
//
// Rules (originally encoded only in the board's drag handler):
//   - anything → evaluated: persist the new status first, then open the
//     evaluation modal as an optional follow-up. Dismissing with "Not now"
//     keeps the already-saved status.
//   - evaluated → screened: a plain PATCH like any other transition
//     (maintainer decision 2026-06-11; previously blocked). The status is
//     the pipeline stage only — the evaluation report keeps its `state:
//     evaluated` depth and stays intact, so nothing is "un-run."
//   - everything else: plain status PATCH, caller proceeds.
//
// Bulk surfaces (batch-action-bar.tsx) can't call this directly — the
// selection's per-row statuses vary, so there is no single `currentStatus`.
// They apply the same intent by keying off the pick alone: choosing
// 'evaluated' persists the bulk status change first, then opens the optional
// evaluation follow-up with the successfully updated nums[].
//
// Client-safe, framework-free, pure — unit-tested in
// src/lib/__tests__/status-transitions.test.ts.

export type StatusPickInterception =
  | { kind: 'proceed' }
  | { kind: 'blocked'; message: string }
  | { kind: 'evaluate-modal' };

function canonicalStatus(status: string | null | undefined): string {
  return (status ?? '').replace(/\*\*/g, '').trim().toLowerCase();
}

export function interceptStatusPick(
  currentStatus: string | null | undefined,
  nextStatus: string,
): StatusPickInterception {
  const prev = canonicalStatus(currentStatus);
  const next = canonicalStatus(nextStatus);
  if (prev === next) return { kind: 'proceed' }; // no-op — callers treat as plain pick
  if (next === 'evaluated') return { kind: 'evaluate-modal' };
  return { kind: 'proceed' };
}

export type StatusFollowup =
  | { num: number; jobKind: 'interview-prep' }
  | { num: number; jobKind: 'negotiate' };

export function followupForStatusTransition(
  num: number,
  currentStatus: string | undefined,
  nextStatus: string,
): StatusFollowup | null {
  const current = canonicalStatus(currentStatus);
  const next = canonicalStatus(nextStatus);
  if (current === next) return null;
  if (next === 'interview') return { num, jobKind: 'interview-prep' };
  if (next === 'offer') return { num, jobKind: 'negotiate' };
  return null;
}
