'use client';

import { ChevronDown } from 'lucide-react';

interface LoadingModalLogsProps {
  lines: string[];
  open: boolean;
  onToggle: () => void;
}

export function LoadingModalLogs({ lines, open, onToggle }: LoadingModalLogsProps) {
  return (
    <>
      {/* Logs toggle */}
      <button
        type="button"
        className="loading-modal__logs-toggle"
        onClick={e => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span>{open ? 'Hide logs' : 'Show logs'}</span>
        <ChevronDown className="loading-modal__logs-chev" size={10} aria-hidden="true" />
      </button>

      {/* Logs */}
      <div className="loading-modal__logs">
        <pre>{lines.length > 0 ? lines.join('\n') : 'Waiting for output…'}</pre>
      </div>
    </>
  );
}
