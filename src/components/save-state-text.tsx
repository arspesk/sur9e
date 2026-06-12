'use client';

// Live save-state tail for the page-head sub on Profile + Settings.
// aria-live polite: screen readers announce "Saved" without stealing focus.
import { type SaveStatus, useSaveStatusStore } from '@/stores/save-status-store';

const LABELS: Record<SaveStatus, string> = {
  idle: 'Changes save as you type.',
  saved: '✓ Saved',
  error: "Couldn't save — edit the field again to retry.",
};

export function SaveStateText() {
  const status = useSaveStatusStore(s => s.status);
  return (
    <span className="sub__save-state" data-state={status} aria-live="polite">
      {LABELS[status]}
    </span>
  );
}
