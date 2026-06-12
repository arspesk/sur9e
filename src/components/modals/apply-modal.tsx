'use client';

// Apply runs interactively in the user's Claude Code terminal (needs
// Playwright + back-and-forth), so this modal's job is to show the
// right CLI invocation and let the user copy it. The Copy button keeps
// the modal open and shows inline "Copied!" feedback for 1s — closing
// is a separate action.

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/primitives';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useModalStore } from '@/stores/modal-store';

export function ApplyModal() {
  const { context, close } = useModalStore();
  const num = (context?.num as number | undefined) ?? undefined;
  const cmd = `/sur9e apply ${num != null ? num : '<num>'}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const cmdRef = useRef<HTMLElement>(null);
  const [copyLabel, setCopyLabel] = useState('Copy command');
  useFocusTrap(dialogRef, true);

  // Esc to close.
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

  // Focus the Copy button on open.
  useEffect(() => {
    const t = setTimeout(() => copyBtnRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Copy → clipboard, with "Copied!" feedback for 1s.
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
    <div className="evaluate-modal" id="apply-modal">
      <div className="evaluate-modal__backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="evaluate-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-modal-title"
      >
        <header className="evaluate-modal__head">
          <h2 id="apply-modal-title">Apply in your terminal</h2>
          <IconButton
            className="evaluate-modal__close"
            label="Close"
            onClick={close}
            icon={<X size={16} />}
          />
        </header>
        <div className="evaluate-modal__body">
          <p>
            Apply runs interactively in your agent CLI (Claude Code, Codex, or OpenCode) - it needs
            browser access to read the form and your input to draft answers question-by-question.
          </p>
          <pre className="apply-modal__cmd">
            <code ref={cmdRef} id="apply-modal-cmd">
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
