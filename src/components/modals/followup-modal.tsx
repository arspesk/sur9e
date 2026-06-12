'use client';

// Same shape as apply-modal — follow-up runs interactively in the user's
// Claude Code terminal because it needs the user to confirm what was
// sent before recording. This modal's job is to point them at the CLI
// invocation.

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/primitives';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useModalStore } from '@/stores/modal-store';

export function FollowupModal() {
  const { context, close } = useModalStore();
  const num = (context?.num as number | undefined) ?? undefined;
  // Canonical mode id is `follow-up` (`followup` is only a legacy alias in
  // SKILL.md) — the UI should teach the canonical form.
  const cmd = `/sur9e follow-up ${num != null ? num : '<num>'}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const cmdRef = useRef<HTMLElement>(null);
  const [copyLabel, setCopyLabel] = useState('Copy command');
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    const t = setTimeout(() => copyBtnRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy command'), 1000);
    } catch {
      setCopyLabel('Copy failed - select manually');
      if (cmdRef.current) cmdRef.current.style.userSelect = 'text';
      setTimeout(() => setCopyLabel('Copy command'), 2000);
    }
  }, [cmd]);

  return (
    <div className="evaluate-modal" id="followup-modal">
      <div className="evaluate-modal__backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="evaluate-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="followup-modal-title"
      >
        <header className="evaluate-modal__head">
          <h2 id="followup-modal-title">Follow up in your terminal</h2>
          <IconButton
            className="evaluate-modal__close"
            label="Close"
            onClick={close}
            icon={<X size={16} />}
          />
        </header>
        <div className="evaluate-modal__body">
          <p>
            Follow-up runs interactively in your agent CLI (Claude Code, Codex, or OpenCode) — it
            computes cadence, drafts emails, and waits for you to confirm what was sent before
            recording it in data/follow-ups.md.
          </p>
          <pre className="apply-modal__cmd">
            <code ref={cmdRef} id="followup-modal-cmd">
              {cmd}
            </code>
          </pre>
        </div>
        <footer className="evaluate-modal__foot">
          <Button variant="secondary" className="apply-modal__close-btn" onClick={close}>
            Close
          </Button>
          <Button
            ref={copyBtnRef}
            variant="primary"
            className="apply-modal__copy"
            onClick={handleCopy}
          >
            {copyLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}
