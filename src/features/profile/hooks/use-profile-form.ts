'use client';

// rhf + Zod + TanStack Query orchestration for the profile form.
//
// Auto-save: form.watch() fires on every field change → 600ms debounce
// → saveProfileAction. A beforeunload guard warns if a save is still
// pending. The "Saved" toast fires 1.5s after the last successful save
// (handled here so sections don't have to know about toasts).

import { useCallback, useEffect, useRef } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import {
  type ProfileArchetype,
  type ProfileState,
  useProfileQuery,
  useSaveProfile,
} from '@/hooks/use-profile';
import { useZodForm } from '@/lib/forms';
import { useSaveStatusStore } from '@/stores/save-status-store';
import { ProfileFormSchema, type ProfileFormValues } from '../schemas';

const DEBOUNCE_MS = 600;
const SAVED_TOAST_DELAY_MS = 1500;

type ToneFn = (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;

interface UseProfileFormOptions {
  initialData?: ProfileState;
  /** When set, auto-save is paused (profile.yml exists but couldn't be
   *  parsed — saving would overwrite it with the form's empty values).
   *  The string is the user-facing reason, toasted once on the first
   *  blocked edit; the page banner carries the full explanation. */
  saveBlockedReason?: string | null;
}

export function useProfileForm(options?: UseProfileFormOptions) {
  const saveBlockedReason = options?.saveBlockedReason ?? null;
  const query = useProfileQuery({ initialData: options?.initialData });
  const save = useSaveProfile();
  const pushToast = useToastStore(s => s.push) as ToneFn;
  const setSaveStatus = useSaveStatusStore(s => s.setStatus);

  const form = useZodForm(ProfileFormSchema, {
    // defaultValues seeded from cache if data is already available;
    // the reset effect below handles the async case.
    defaultValues: (query.data as ProfileFormValues | undefined) ?? ({} as ProfileFormValues),
    mode: 'onBlur',
  });

  // Hydrate once when profile data arrives (mirrors legacy useState init).
  useEffect(() => {
    if (query.data && !form.formState.isDirty) {
      form.reset(query.data as ProfileFormValues);
      // Trigger validation so the required-field banner shows on first paint
      // for profiles that arrived with missing required fields.
      void form.trigger();
    }
  }, [query.data, form]);

  // Surface load failure as a toast (mirrors legacy try/catch).
  useEffect(() => {
    if (query.error && pushToast) {
      const msg = query.error instanceof Error ? query.error.message : String(query.error);
      pushToast('danger', `Couldn't load profile (${msg}) — reload the page to retry.`);
    }
  }, [query.error, pushToast]);

  // ── Auto-save: debounced watch → PATCH ──
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest watched values that haven't been committed yet (a debounce is in
  // flight). Held so the unmount cleanup can flush them instead of dropping
  // the user's last edit; null whenever nothing is pending.
  const pendingValuesRef = useRef<ProfileFormValues | null>(null);

  const announceSaved = useCallback(() => {
    setSaveStatus('saved');
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
    savedToastTimerRef.current = setTimeout(() => {
      pushToast?.('success', 'Saved');
      setSaveStatus('idle');
      savedToastTimerRef.current = null;
    }, SAVED_TOAST_DELAY_MS);
  }, [pushToast, setSaveStatus]);

  const commitSave = useCallback(
    async (values: ProfileFormValues) => {
      pendingTimerRef.current = null;
      pendingValuesRef.current = null;
      try {
        await save.mutateAsync({
          candidate: values.candidate,
          // archetypes is z.array(z.unknown()) in the UI schema for passthrough
          // compatibility; cast to ProfileArchetype[] for the transport layer.
          target_roles: values.target_roles
            ? {
                ...values.target_roles,
                archetypes: (values.target_roles.archetypes ?? []) as ProfileArchetype[],
              }
            : undefined,
          narrative: values.narrative,
          compensation: values.compensation,
          location: values.location,
          languages: values.languages,
          search: values.search,
          apply_answers: values.apply_answers,
        });
        announceSaved();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[profile] save failed', err);
        setSaveStatus('error');
        // Truthful retry copy: when the server refused because profile.yml
        // is unreadable on disk, retrying the save can never succeed — only
        // fixing the file can. Don't tell the user to edit again.
        const retryHint = msg.includes('refusing to save profile')
          ? 'fix or remove the file, then reload this page'
          : 'change a field again to retry';
        pushToast?.('danger', `Save failed (${msg}) — ${retryHint}.`);
      }
    },
    [announceSaved, pushToast, save, setSaveStatus],
  );

  // Watch all fields; debounce commits. When saves are blocked (unreadable
  // profile.yml on disk), never schedule a commit — a save would replace the
  // user's hand-edited file with the form's empty values. Toast the reason
  // once so an edit doesn't just silently vanish.
  const blockedToastShownRef = useRef(false);
  useEffect(() => {
    const sub = form.watch(values => {
      if (saveBlockedReason) {
        if (!blockedToastShownRef.current) {
          blockedToastShownRef.current = true;
          pushToast?.('danger', saveBlockedReason);
        }
        return;
      }
      pendingValuesRef.current = values as ProfileFormValues;
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        void commitSave(values as ProfileFormValues);
      }, DEBOUNCE_MS);
    });
    return () => sub.unsubscribe();
  }, [form, commitSave, saveBlockedReason, pushToast]);

  // commitSave read through a ref so the unmount-flush effect below can stay
  // mount-once ([] deps) without capturing a stale closure.
  const commitSaveRef = useRef(commitSave);
  commitSaveRef.current = commitSave;

  // beforeunload guard — warn if a save is queued.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingTimerRef.current) {
        e.preventDefault();
        e.returnValue = 'Unsaved profile changes will be lost.';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      // SPA route changes unmount without firing beforeunload — flush the
      // queued save instead of dropping the user's last edit. The PATCH (and
      // its error toast, which routes through global stores) completes in the
      // background after the hook is gone.
      if (pendingValuesRef.current) {
        void commitSaveRef.current(pendingValuesRef.current);
        pendingValuesRef.current = null;
      }
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      useSaveStatusStore.getState().setStatus('idle');
    };
  }, []);

  return { form, query, save };
}
