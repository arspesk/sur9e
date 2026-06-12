'use client';

interface LoadingModalProgressProps {
  percent: number;
  isDone: boolean;
  isError: boolean;
}

export function LoadingModalProgress({ percent, isDone, isError }: LoadingModalProgressProps) {
  const progressWidth = isDone ? '100%' : `${percent}%`;
  const fillClass = isDone ? 'is-done' : isError ? 'is-error' : '';

  return (
    <div className="loading-modal__progress">
      <div
        className={`loading-modal__progress-fill ${fillClass}`}
        style={{ width: progressWidth }}
      />
    </div>
  );
}
