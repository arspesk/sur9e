'use client';

import { MessageSquare } from 'lucide-react';
import { forwardRef } from 'react';

export interface ChatBubbleProps {
  open: boolean;
  /** Active background jobs (Plan 4 wires the live count; 0 = plain bubble). */
  jobCount: number;
  /** Optional 0..1 determinate arc (Plan 4). Omitted → fixed 270° arc. */
  jobProgress?: number;
  /** Unseen terminal-error jobs (persistent bubble error badge). Only shown
   * when nothing is actively running — an active job's ring already draws
   * the eye, and the unseen error persists in the store until the chat is
   * opened or the job is dismissed. */
  errorCount?: number;
  /** Unseen finished jobs (green badge). Error wins the color when both are
   * present; the winning badge shows the COMBINED unseen count. */
  doneCount?: number;
  onClick: () => void;
}

const RING_R = 35;
const RING_C = 2 * Math.PI * RING_R; // ≈ 219.91

export const ChatBubble = forwardRef<HTMLButtonElement, ChatBubbleProps>(function ChatBubble(
  { open, jobCount, jobProgress, errorCount = 0, doneCount = 0, onClick },
  ref,
) {
  const busy = jobCount > 0;
  const unseenTotal = errorCount + doneCount;
  // Precedence: active jobs > error > done. The winner carries the combined
  // count so nothing disappears behind it.
  const showError = !busy && errorCount > 0;
  const showDone = !busy && errorCount === 0 && doneCount > 0;
  const arcFraction = jobProgress != null ? Math.min(1, Math.max(0.05, jobProgress)) : 0.75;
  const arc = arcFraction * RING_C;
  const label = busy
    ? `${jobCount} ${jobCount === 1 ? 'job' : 'jobs'} running — open chat`
    : showError
      ? doneCount > 0
        ? `${unseenTotal} job updates, ${errorCount} failed — open chat`
        : `${errorCount} ${errorCount === 1 ? 'job' : 'jobs'} failed — open chat`
      : showDone
        ? `${doneCount} ${doneCount === 1 ? 'job' : 'jobs'} finished — open chat`
        : 'Open chat';

  return (
    <button
      ref={ref}
      type="button"
      className="chat-bubble"
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <MessageSquare className="chat-bubble__mark" aria-hidden="true" />
      {busy && (
        <>
          <svg className="chat-bubble__ring" viewBox="0 0 76 76" aria-hidden="true">
            <circle className="chat-bubble__ring-track" cx="38" cy="38" r={RING_R} />
            <circle
              className="chat-bubble__ring-arc"
              cx="38"
              cy="38"
              r={RING_R}
              strokeDasharray={`${arc} ${RING_C - arc}`}
            />
          </svg>
          <span className="chat-bubble__badge">{jobCount}</span>
        </>
      )}
      {showError && (
        <>
          <svg
            className="chat-bubble__ring chat-bubble__ring--error"
            viewBox="0 0 76 76"
            aria-hidden="true"
          >
            <circle
              className="chat-bubble__ring-track chat-bubble__ring-track--error"
              cx="38"
              cy="38"
              r={RING_R}
            />
            {/* Terminal state → a COMPLETE 360° ring (full circumference dash,
                zero gap), not the running state's 270° arc: failure reads as a
                solid full red circle. */}
            <circle
              className="chat-bubble__ring-arc chat-bubble__ring-arc--error"
              cx="38"
              cy="38"
              r={RING_R}
              strokeDasharray={`${RING_C} 0`}
            />
          </svg>
          <span className="chat-bubble__badge chat-bubble__badge--error">{unseenTotal}</span>
        </>
      )}
      {showDone && (
        <>
          <svg
            className="chat-bubble__ring chat-bubble__ring--done"
            viewBox="0 0 76 76"
            aria-hidden="true"
          >
            <circle
              className="chat-bubble__ring-track chat-bubble__ring-track--done"
              cx="38"
              cy="38"
              r={RING_R}
            />
            {/* Terminal state → a COMPLETE 360° ring (full circumference dash,
                zero gap), not the running state's 270° arc: success reads as a
                solid full green circle. */}
            <circle
              className="chat-bubble__ring-arc chat-bubble__ring-arc--done"
              cx="38"
              cy="38"
              r={RING_R}
              strokeDasharray={`${RING_C} 0`}
            />
          </svg>
          <span className="chat-bubble__badge chat-bubble__badge--done">{doneCount}</span>
        </>
      )}
    </button>
  );
});
