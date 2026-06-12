'use client';

interface LoadingModalActionsProps {
  isError: boolean;
  /** Whether the done card has a report num to navigate to. Numless system
   * jobs (scan, batch-evaluate) don't — their primary opens /offers, so the
   * label must not promise a report. */
  hasReportTarget: boolean;
  onPrimary: () => void;
  onDismiss: () => void;
}

export function LoadingModalActions({
  isError,
  hasReportTarget,
  onPrimary,
  onDismiss,
}: LoadingModalActionsProps) {
  // Error cards get a single Dismiss — the primary and secondary actions
  // both dismissed, and two identical side-by-side buttons implied a
  // difference that didn't exist (2026-06-10 audit).
  if (isError) {
    return (
      <div className="loading-modal__actions">
        <button type="button" className="loading-modal__action-primary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div className="loading-modal__actions">
      <button type="button" className="loading-modal__action-primary" onClick={onPrimary}>
        {hasReportTarget ? 'View report' : 'View offers'}
      </button>
      <button type="button" className="loading-modal__action-secondary" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
