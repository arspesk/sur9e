'use client';

// React NodeView for the in-editor <runningMode> placeholder. Owns:
//   * the visual treatment (taller pulsing card, rotating "AI is …"
//     prompts, spinner)
//   * the job-status poll (use-running-mode-poll → getRunningModeStatus)
//   * terminal-state handling: on `done` invalidates the report query so
//     ReportAttachments picks up the freshly-written cover_letter_path /
//     cv_pdf_path; on `failed` shows the error inline. Either way the
//     dismiss button removes the node from the doc.

import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRunningModePoll } from '@/hooks/use-running-mode-poll';
import { promptsForMode } from '@/lib/funny-prompts';
import { clearRunningModePlaceholderAction } from '@/server/actions/running-mode';

export function RunningModeView({ node }: NodeViewProps) {
  const { mode, num, label, startedAt } = node.attrs as {
    mode: string;
    num: number;
    label: string;
    startedAt: string;
  };
  // Thread the placeholder's insert-time `startedAt` so the poll only counts
  // jobs that started at/after it — a previously-completed job for the same
  // offer can't flip the card to 'done' before this run's file is written.
  const status = useRunningModePoll(num, mode, true, startedAt);
  const prompts = useMemo(() => promptsForMode(mode), [mode]);
  const [promptIdx, setPromptIdx] = useState(0);
  // Dedup guard so a double-click / the auto-timeout can't fire the reload
  // twice for the same card.
  const triggeredRef = useRef(false);

  // Rotate the funny prompt every 4s while running.
  useEffect(() => {
    if (status.status !== 'running') return;
    const id = setInterval(() => setPromptIdx(i => (i + 1) % prompts.length), 4000);
    return () => clearInterval(id);
  }, [status.status, prompts.length]);

  // Clear the placeholder end-to-end: best-effort strip of its on-disk comment
  // server-side (preserving the section the job appended) then hard-reload so
  // the uncontrolled editor re-syncs from the file — the section appears and
  // the card is gone. We deliberately do NOT delete the node + let the editor
  // save: the open doc is stale (it never holds the job's out-of-band append),
  // so re-serializing it would clobber the freshly-written section. Mirrors
  // loading-modal.tsx, which also does a full navigation after a job because a
  // router/query refresh can't remount the uncontrolled editor.
  //
  // The reload is UNCONDITIONAL (not gated on whether a comment was found): the
  // comment is often already gone from the live `.md` — e.g. a prior autosave
  // or auto-clear stripped it — leaving only a stale in-memory card. Gating on
  // the strip result left that card un-dismissable (× did nothing). A clean
  // file simply means the card won't reconstruct after the reload.
  const reloadAfterClear = useCallback(async () => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    try {
      await clearRunningModePlaceholderAction(num, mode, startedAt);
    } catch {
      // ignore — the reload still re-syncs the editor from the file
    }
    window.location.reload();
  }, [num, mode, startedAt]);

  // On a terminal status, flash the message briefly then auto-clear + reload.
  // The sessionStorage guard fires the AUTO reload at most once per placeholder
  // so a card that somehow survives (comment genuinely unmatched on disk) can't
  // spin in an infinite reload loop — the user clears it manually via ×, which
  // is always allowed to reload.
  useEffect(() => {
    // Auto only on success — a 'failed' card stays so the user can read the
    // error, then dismisses via × (which reloads unconditionally).
    if (status.status !== 'done') return;
    const key = `sur9e:rm-auto:${num}:${startedAt}`;
    let already = false;
    try {
      already = sessionStorage.getItem(key) === '1';
    } catch {
      // sessionStorage unavailable — fall back to a single auto-attempt
    }
    if (already) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(key, '1');
      } catch {
        // ignore
      }
      void reloadAfterClear();
    }, 900);
    return () => clearTimeout(t);
  }, [status.status, num, startedAt, reloadAfterClear]);

  const showDone = status.status === 'done';
  const showFailed = status.status === 'failed';
  const isRunning = !showDone && !showFailed;

  return (
    <NodeViewWrapper
      as="div"
      data-running-mode=""
      data-status={status.status}
      contentEditable={false}
      className="running-mode-card"
      // Swallow the click so ProseMirror can't node-select / collapse /
      // delete the placeholder on stray clicks inside the card body.
      // Dismiss button below has its own handler that stops propagation
      // before this fires.
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
      }}
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
        // Without preventDefault the click drops the caret next to the
        // block which made the placeholder feel "removable" — caret moves
        // away, then ANY keystroke would walk back through it.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="running-mode-card__icon" aria-hidden="true">
        {isRunning ? (
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : showDone ? (
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </div>
      <div className="running-mode-card__body">
        <div className="running-mode-card__label">{label}</div>
        <div className="running-mode-card__prompt">
          {isRunning
            ? prompts[promptIdx]
            : showDone
              ? // cover-letter / tailor-cv produce downloadable PDFs (Attachments);
                // every other generator appends a markdown section into the body.
                // Either way the card auto-clears + reloads so the result shows.
                mode === 'cover-letter' || mode === 'tailor-cv'
                ? 'Done — saved to Attachments.'
                : 'Done — added to the report.'
              : `Failed${status.error ? ` — ${status.error}` : ''}`}
        </div>
      </div>
      {/* Dismiss button — only visible when terminal so the user can't
       * accidentally remove the card mid-run. While running, the card
       * has no dismiss; only the job's natural completion removes the
       * "running" state. */}
      {!isRunning && (
        <button
          type="button"
          className="running-mode-card__dismiss"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            void reloadAfterClear();
          }}
          aria-label="Dismiss"
          title="Dismiss"
        >
          ×
        </button>
      )}
    </NodeViewWrapper>
  );
}
