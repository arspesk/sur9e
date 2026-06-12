'use client';

// URL-paste flow triggered by the Add menu's "Add offer" action — separate
// from the report's Apply CLI handoff (apply-modal). The user picks a depth:
//   - Quick screen      → startJobAction('screen', { url })
//   - Full evaluation   → startJobAction('screen-evaluate', { url })
// Either way: validate the URL prefix, spawn the job, close; the shared
// loading-modal owns polling + terminal state display (deck card).

import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLoadingModalStore } from '@/components/loading-modal/loading-modal-store';
import { Button, IconButton, Input, Label } from '@/components/primitives';
import { useToastStore } from '@/components/toast/toast-store';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { jobEstimateLabel } from '@/lib/job-types';
import { startJobAction } from '@/server/actions/jobs';
import { useModalStore } from '@/stores/modal-store';

export function ScreenModal() {
  const { close } = useModalStore();
  const queryClient = useQueryClient();
  const pushToast = useToastStore(s => s.push);
  const startJob = useLoadingModalStore(s => s.startJob);
  const waitForTerminal = useLoadingModalStore(s => s.waitForTerminal);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState<'screen' | 'screen-evaluate'>('screen');
  const [generatePdf, setGeneratePdf] = useState(false);
  const [generateCoverLetter, setGenerateCoverLetter] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useFocusTrap(dialogRef, true);

  // Esc closes.
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

  // Focus the input on open.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//.test(trimmed)) {
      setError('Enter a URL starting with http:// or https://');
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const params: Record<string, unknown> = { url: trimmed };
      if (depth === 'screen-evaluate' && generatePdf) params.generate_pdf = true;
      if (depth === 'screen-evaluate' && generateCoverLetter) params.generate_cover_letter = true;
      const result = await startJobAction({ kind: depth, params });
      if ('conflict' in result) {
        // screen kinds are singletons — surface "already running" as the
        // inline field error via the catch below.
        throw new Error(result.message);
      }
      close();
      startJob(result.id, depth);
      try {
        const snap = await waitForTerminal(result.id);
        if (snap.status === 'done') {
          // Special-case outcome warnings (legacy lines 2140-2148): these
          // carry information the done-card does NOT convey — the job
          // "succeeded" but produced nothing useful. They stay; only the
          // generic success/failure toasts are suppressed (the card shows
          // terminal state — spec 2026-06-05-corner-notifications).
          const out = snap.output || '';
          if (/worker exited 0 but didn't write/.test(out)) {
            pushToast(
              'danger',
              "Couldn't read the job posting at that URL. Double-check the link, or paste a different link to the posting.",
            );
          } else if (/Already screened/.test(out) && /To process:\s*0/.test(out)) {
            pushToast('warning', "URL was already screened — it's in your Offers list");
          } else {
            queryClient.invalidateQueries({ queryKey: ['applications'] });
          }
        }
        // No generic error toast — the deck card shows the error state.
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen failed');
      setSubmitting(false);
    }
  }, [
    url,
    depth,
    generatePdf,
    generateCoverLetter,
    close,
    startJob,
    waitForTerminal,
    pushToast,
    queryClient,
  ]);

  // Enter on the input submits.
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="add-offer-modal" id="add-offer-modal">
      <div className="add-offer-modal__backdrop" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="add-offer-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-offer-title"
      >
        <header className="add-offer-modal__head">
          <h2 id="add-offer-title">Add an offer</h2>
          <IconButton
            className="add-offer-modal__close"
            label="Close"
            onClick={close}
            icon={<X size={16} />}
          />
        </header>
        <div className="add-offer-modal__body">
          <Label className="add-offer-modal__label" htmlFor="add-offer-url">
            Job posting link
          </Label>
          <Input
            ref={inputRef}
            type="url"
            id="add-offer-url"
            name="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://boards.greenhouse.io/company/jobs/123…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={handleInputKeyDown}
            aria-describedby={error ? 'add-offer-error' : undefined}
          />
          {error ? (
            <p className="add-offer-modal__error" id="add-offer-error">
              {error}
            </p>
          ) : null}
          <fieldset className="add-offer-modal__depth">
            <legend className="sr-only">How deep should the check go?</legend>
            <label className={`add-offer-depth${depth === 'screen' ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="add-offer-depth"
                value="screen"
                checked={depth === 'screen'}
                onChange={() => setDepth('screen')}
              />
              <span className="add-offer-depth__title">Quick screen</span>
              <span className="add-offer-depth__sub">
                Fast fit check — {jobEstimateLabel('screen')}
              </span>
            </label>
            <label
              className={`add-offer-depth${depth === 'screen-evaluate' ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name="add-offer-depth"
                value="screen-evaluate"
                checked={depth === 'screen-evaluate'}
                onChange={() => setDepth('screen-evaluate')}
              />
              <span className="add-offer-depth__title">Full evaluation</span>
              <span className="add-offer-depth__sub">
                Complete report — {jobEstimateLabel('screen-evaluate')}
              </span>
            </label>
          </fieldset>
          {depth === 'screen-evaluate' ? (
            <label className="evaluate-modal__pdf-opt add-offer-modal__pdf-opt">
              <input
                type="checkbox"
                checked={generatePdf}
                onChange={e => setGeneratePdf(e.target.checked)}
              />
              <span className="evaluate-modal__pdf-opt-label">Generate tailored CV PDF</span>
              <span className="evaluate-modal__pdf-opt-hint">
                adds {jobEstimateLabel('tailor-cv')} — runs the tailor-cv mode after evaluation
              </span>
            </label>
          ) : null}
          {depth === 'screen-evaluate' ? (
            <label className="evaluate-modal__pdf-opt add-offer-modal__pdf-opt">
              <input
                type="checkbox"
                checked={generateCoverLetter}
                onChange={e => setGenerateCoverLetter(e.target.checked)}
              />
              <span className="evaluate-modal__pdf-opt-label">Generate cover letter PDF</span>
              <span className="evaluate-modal__pdf-opt-hint">
                adds {jobEstimateLabel('cover-letter')} — runs the cover-letter mode after
                evaluation
              </span>
            </label>
          ) : null}
        </div>
        <footer className="add-offer-modal__foot">
          <Button variant="secondary" className="add-offer-modal__cancel" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="add-offer-modal__submit"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Adding…' : 'Add offer'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
