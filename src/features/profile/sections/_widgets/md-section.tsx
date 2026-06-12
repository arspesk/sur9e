'use client';

// MdSection owns its own load + debounced-save state via TanStack Query
// (useProfileMdQuery / useSaveProfileMd) — markdown content does NOT
// live in the rhf form state because each markdown file persists
// independently and the editor manages its own DOM.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import { type ProfileMdName, useProfileMdQuery, useSaveProfileMd } from '@/hooks/use-profile-md';

// TipTap + ProseMirror is ~242KB gzipped, the largest single chunk in
// the app. Route-isolated to /profile, but loading it eagerly blocks
// first paint. Defer via next/dynamic so the page shell paints first,
// then the editor hydrates. ssr: false because TipTap mutates the DOM
// on mount and has no useful SSR output.
const TipTapEditor = dynamic(
  () => import('@/components/editor/tiptap-editor').then(m => m.TipTapEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="md-section-loading"
        aria-busy="true"
        aria-label="Loading editor"
        style={{ minHeight: '6rem' }}
      />
    ),
  },
);

const DEBOUNCE_MS = 600;
const SAVED_TOAST_DELAY_MS = 1500;

type ToneFn = (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;

function useAnnounceSaved() {
  const pushToast = useToastStore(s => s.push) as ToneFn;
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(() => {
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    savedToastTimerRef.current = setTimeout(() => {
      pushToast?.('success', 'Saved');
      savedToastTimerRef.current = null;
    }, SAVED_TOAST_DELAY_MS);
  }, [pushToast]);
}

export interface MdSectionProps {
  name: ProfileMdName;
  niceName: string;
  /** Called once when the CV editor's content presence is known, and again on every change. */
  onCvContent?: (hasContent: boolean) => void;
}

export function MdSection({ name, niceName, onCvContent }: MdSectionProps) {
  const query = useProfileMdQuery(name);
  const save = useSaveProfileMd(name);
  const pushToast = useToastStore(s => s.push) as ToneFn;
  const announceSaved = useAnnounceSaved();

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest markdown that has been typed but not yet sent (a debounce is in
  // flight). Held so the unmount cleanup can flush it instead of dropping the
  // user's last edit; null whenever nothing is pending. Mirrors
  // report-body-editor's flush-on-unmount.
  const pendingMdRef = useRef<string | null>(null);

  const debouncedSave = useCallback(
    (md: string) => {
      pendingMdRef.current = md;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        pendingMdRef.current = null;
        save
          .mutateAsync(md)
          .then(() => {
            if (name === 'cv') onCvContent?.((md || '').trim().length > 0);
            announceSaved();
          })
          .catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[profile] saveMd ${name}:`, err);
            pushToast?.('danger', `Save failed (HTTP ${msg}) — change a field again to retry.`);
          });
      }, DEBOUNCE_MS);
    },
    [announceSaved, name, onCvContent, pushToast, save],
  );

  // On unmount (SPA navigation away from /profile — no beforeunload fires),
  // flush a still-pending debounced save instead of cancelling it; otherwise
  // the last CV/narrative edit within DEBOUNCE_MS is silently lost. The save
  // completes in the background after the component is gone. `name` is fixed
  // per mount and save.mutate is stable, so the empty-deps capture is
  // intentional.
  useEffect(
    () => () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      if (pendingMdRef.current != null) {
        // The toast store is global, so a failure still surfaces after unmount.
        save.mutateAsync(pendingMdRef.current).catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[profile] saveMd ${name} (unmount flush):`, err);
          pushToast?.('danger', `Save failed (HTTP ${msg}) — reopen Profile to retry.`);
        });
        pendingMdRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Surface load failure as a toast.
  useEffect(() => {
    if (query.error && pushToast) {
      const msg = query.error instanceof Error ? query.error.message : String(query.error);
      pushToast(
        'danger',
        `Couldn't load ${name} markdown (HTTP ${msg}). Reload the page to retry.`,
      );
    }
  }, [query.error, name, pushToast]);

  // Surface initial CV content state to parent for required-field flag.
  useEffect(() => {
    if (name === 'cv' && query.data !== undefined) {
      onCvContent?.((query.data || '').trim().length > 0);
    }
  }, [name, query.data, onCvContent]);

  return (
    <div className="md-section" data-md-name={name}>
      <div className="md-host" data-md-host={name}>
        {query.data !== undefined ? (
          <TipTapEditor
            name={name}
            defaultValue={query.data || ''}
            ariaLabel={niceName}
            onChange={md => debouncedSave(md)}
          />
        ) : null}
      </div>
    </div>
  );
}
