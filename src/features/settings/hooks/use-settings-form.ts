'use client';

// features/settings/hooks/use-settings-form.ts
//
// Orchestrates rhf + Zod + TanStack Query for the settings form.
//
// Auto-save design (mirrors profile-form's debounced-save UX):
//   form.watch() fires on every field change → 600ms debounce → saveSettingsAction (Server Action).
//   A beforeunload guard warns if a save is still pending; client-side
//   navigation (no beforeunload) flushes the pending save on unmount instead.
//   The "Saved" toast fires 1.5s after the last successful save.
//
// Empty-string → undefined translation for models fields:
//   Legacy did `delete providers.models.{screen,batch}` when the user picked "— Default —".
//   rhf serializes an empty <select> value as "". We strip empty-string model
//   values in the save handler before mutateAsync so the server merge contract
//   (undefined = use server default) is preserved.
//
// Per-mode "Use default" sentinel:
//   The Providers section renders a table of every mode with two dropdowns —
//   when the user selects "Use default" for either, the form state stores a
//   `null` (or undefined / empty-string) in `providers.modes.<id>.{platform,model}`.
//   The ModeOverride zod schema is strict ({platform, model} both required),
//   so any partial row would be rejected. We strip such rows here BEFORE the
//   network call so the server only ever sees fully-populated overrides.
//   Empty `providers.modes` shape is also removed entirely to avoid clobbering
//   a server-side migration.

import { useCallback, useEffect, useRef } from 'react';
import { useToastStore } from '@/components/toast/toast-store';
import { type SettingsState, useSaveSettings, useSettingsQuery } from '@/hooks/use-settings';
import { useZodForm } from '@/lib/forms';
import { useSaveStatusStore } from '@/stores/save-status-store';
import { SettingsFormSchema, type SettingsFormValues } from '../schemas';

const DEBOUNCE_MS = 600;
const SAVED_TOAST_DELAY_MS = 1500;

type ToneFn = (tone: 'info' | 'success' | 'warning' | 'danger', message: string) => void;

// Local NaN-leaf stripper — mirrors the server's stripNaNLeaves in
// src/lib/server/settings.ts. Intentionally duplicated here: src/lib/server/**
// is server-only (imports 'server-only') and must NOT be imported by a
// client hook. The duplication is a tiny (~10 line) pure function and the
// right trade-off versus creating a shared client/server module for one helper.
function stripNaNLeaves(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripNaNLeaves(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Strip empty-string / partial sentinels so the server's strict zod
 *  schema never rejects a "use default" pick. Three cleanups:
 *
 *  1) Legacy `providers.models.{screen,batch}` — ALWAYS stripped. By save
 *     time the new `providers.modes` shape is authoritative; leaving the
 *     deprecated alias in the patch causes the server to wholesale-replace
 *     it onto disk, which the next load's `migrateLegacyModels` then
 *     re-injects into `modes.{screen,batch-evaluate}` as Claude overrides
 *     — flipping any "Default" rows back to Claude every time the user
 *     changes an unrelated setting. The schema migration on load remains
 *     the only place legacy values are read; save patches never carry
 *     them forward.
 *
 *  2) `providers.fallback` — the global fallback pair. Both halves are
 *     required when present (FallbackRef is strict). A fully blank pair
 *     (`{platform: '', model: ''}`, written when the user picks "None")
 *     means "fallback off" and is translated to the explicit `null`
 *     sentinel — saveSettings deletes the key from the merged config so
 *     the on-disk fallback is actually removed. (Deleting the key from
 *     the PATCH instead made it a deep-merge no-op: the persisted
 *     fallback survived every save and "None" could never stick.) A
 *     HALF-blank pair (mid-edit: platform picked, model still empty) is
 *     dropped from the patch entirely — a no-op that preserves the
 *     on-disk pair until both halves are valid.
 *
 *  3) `providers.modes.<id>` — the per-mode override table writes a row
 *     for any mode the user has interacted with. Each half is now
 *     independent: the primary `{platform, model}` and the optional
 *     `fallback` pair are each kept only when BOTH of their fields are
 *     non-empty. A row may legitimately carry ONLY a fallback (its
 *     primary then inherits the global default), so we rebuild the row
 *     from its valid halves: a partial primary or partial fallback is
 *     dropped, and a row with neither valid half is deleted entirely
 *     (ModeOverride accepts a fallback-only row but rejects empty
 *     `platform`/`model`/`fallback` strings).
 *
 *  4) NaN leaves — react-hook-form's `valueAsNumber` yields NaN for a
 *     cleared number input; the debounced auto-save fires mid-edit. Strip
 *     them so the wire never carries NaN (server also strips, but client-
 *     side early-exit avoids a round-trip 500 entirely). */
export function sanitizeForSave(values: SettingsFormValues): SettingsFormValues {
  const out = { ...values };
  // 0) `appearance` — owned by the shell ThemeSwitch (rail + mobile row),
  //    which persists `appearance.theme` through its own saveSettingsAction
  //    call. Strip it from form patches so a value hydrated before a
  //    rail-side theme change can't clobber the newer write; the server's
  //    deep-merge keeps the on-disk value when the patch omits the key.
  delete (out as Partial<SettingsFormValues>).appearance;
  if (out.providers?.models) {
    const models = { ...out.providers.models };
    delete (models as Partial<typeof models>).screen;
    delete (models as Partial<typeof models>).batch;
    out.providers = { ...out.providers, models: models as typeof out.providers.models };
  }
  if (out.providers?.fallback) {
    const fb = out.providers.fallback as { platform?: unknown; model?: unknown };
    const blankPlatform = !fb.platform || fb.platform === '';
    const blankModel = !fb.model || fb.model === '';
    if (blankPlatform && blankModel) {
      // "None" pick — explicit delete sentinel (see doc comment #2 above).
      out.providers = { ...out.providers, fallback: null };
    } else if (blankPlatform || blankModel) {
      // Mid-edit half-pair — drop from the patch (no-op; on-disk preserved).
      const { fallback: _drop, ...rest } = out.providers;
      out.providers = rest as typeof out.providers;
    }
  }
  if (out.providers?.modes) {
    const modes = { ...out.providers.modes };
    for (const [modeId, row] of Object.entries(modes)) {
      const r = (row ?? {}) as {
        platform?: unknown;
        model?: unknown;
        fallback?: { platform?: unknown; model?: unknown };
      };
      const hasPrimary = Boolean(r.platform && r.platform !== '' && r.model && r.model !== '');
      const hasFallback = Boolean(
        r.fallback?.platform &&
          r.fallback.platform !== '' &&
          r.fallback?.model &&
          r.fallback.model !== '',
      );
      if (!hasPrimary && !hasFallback) {
        delete modes[modeId];
        continue;
      }
      // Rebuild the row with only its valid halves so a partial primary or
      // partial fallback never reaches the strict server schema.
      const clean: Record<string, unknown> = {};
      if (hasPrimary) {
        clean.platform = r.platform;
        clean.model = r.model;
      }
      if (hasFallback)
        clean.fallback = { platform: r.fallback!.platform, model: r.fallback!.model };
      modes[modeId] = clean as never;
    }
    out.providers = { ...out.providers, modes };
  }
  // Cast is sound: stripping NaN leaves only removes keys; the remaining structure still satisfies SettingsFormValues.
  return stripNaNLeaves(out as Record<string, unknown>) as SettingsFormValues;
}

interface UseSettingsFormOptions {
  initialData?: SettingsState;
  /** When set, auto-save is paused (config.yml exists but couldn't be
   *  parsed — saveSettings refuses to overwrite it, so every save is
   *  doomed). The string is the user-facing reason, toasted once on the
   *  first blocked edit; the page banner carries the full explanation. */
  saveBlockedReason?: string | null;
}

export function useSettingsForm(options?: UseSettingsFormOptions) {
  const saveBlockedReason = options?.saveBlockedReason ?? null;
  const query = useSettingsQuery({ initialData: options?.initialData });
  const save = useSaveSettings();
  const pushToast = useToastStore(s => s.push) as ToneFn;
  const setSaveStatus = useSaveStatusStore(s => s.setStatus);

  const form = useZodForm(SettingsFormSchema, {
    // defaultValues seeded from cache if data is already available;
    // the reset effect below handles the async case. We run through
    // parse() to ensure a fully-defaulted tree from the first paint,
    // avoiding uncontrolled-input warnings on absent nested paths.
    defaultValues: SettingsFormSchema.parse(query.data ?? {}) as SettingsFormValues,
    mode: 'onBlur',
  });

  // Suppress auto-save while hydration resets run. This replaces the old
  // `if (!type) return` filter in the watch callback: RHF fires watch with
  // type === undefined for EVERY programmatic setValue (verified empirically),
  // so that filter silently swallowed all schedule-preset edits — they write
  // through setValue, never scheduling a save or a Saved toast.
  const hydratingRef = useRef(false);

  // Hydrate once when settings data arrives (mirrors legacy useState init).
  useEffect(() => {
    if (query.data && !form.formState.isDirty) {
      hydratingRef.current = true;
      form.reset(SettingsFormSchema.parse(query.data) as SettingsFormValues);
      hydratingRef.current = false;
    }
  }, [query.data, form]);

  // Surface load failure as a toast (mirrors legacy try/catch).
  useEffect(() => {
    if (query.error && pushToast) {
      const msg = query.error instanceof Error ? query.error.message : String(query.error);
      pushToast('danger', `Couldn't load settings (${msg}) — reload the page to retry.`);
    }
  }, [query.error, pushToast]);

  // ── Auto-save: debounced watch → Server Action ──
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    async (values: SettingsFormValues) => {
      pendingTimerRef.current = null;
      const cleaned = sanitizeForSave(values);
      // Skip saves of invalid mid-edit states (e.g. a half-typed custom
      // cron) — zod on the actual payload, NOT form.formState.isValid:
      // RHF's formState is a Proxy whose isValid only activates when read
      // during render; read inside a callback it stays false forever and
      // silently blocks every save (the bug this replaced).
      if (!SettingsFormSchema.safeParse(cleaned).success) return;
      try {
        await save.mutateAsync(cleaned);
        announceSaved();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[settings] save failed', err);
        setSaveStatus('error');
        // Truthful retry copy: when the server refused because config.yml is
        // unreadable on disk, retrying the save can never succeed — only
        // fixing the file can. Don't tell the user to edit again.
        const retryHint = msg.includes('refusing to save settings')
          ? 'fix or remove the file, then reload this page'
          : 'change a field again to retry';
        pushToast?.('danger', `Save failed (${msg}) — ${retryHint}.`);
      }
    },
    [announceSaved, pushToast, save, setSaveStatus],
  );

  // Watch all fields; debounce commits.
  // Skip the save when the form has validation errors — sending a doomed
  // request (e.g. an invalid custom cron) would result in a server 400 and
  // a spurious "Save failed" toast. The field's inline error already tells
  // the user what is wrong.
  // When saves are blocked (unreadable config.yml on disk), never schedule a
  // commit — saveSettings would refuse it anyway. Toast the reason once so an
  // edit doesn't just silently vanish.
  const blockedToastShownRef = useRef(false);
  useEffect(() => {
    const sub = form.watch(values => {
      // Skip only hydration resets (hydratingRef) — NOT events with
      // type === undefined: programmatic setValue (the schedule preset
      // controls) also fires with undefined type and must save.
      if (hydratingRef.current) return;
      if (saveBlockedReason) {
        if (!blockedToastShownRef.current) {
          blockedToastShownRef.current = true;
          pushToast?.('danger', saveBlockedReason);
        }
        return;
      }
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        // Validity gating happens inside commitSave via zod safeParse on the
        // sanitized payload — NOT via formState.isValid (Proxy: inert when
        // read outside render, it silently blocked every save).
        void commitSave(values as SettingsFormValues);
      }, DEBOUNCE_MS);
    });
    return () => sub.unsubscribe();
  }, [form, commitSave, saveBlockedReason, pushToast]);

  // Flush a queued save on unmount. beforeunload only covers full page
  // unloads — App Router client-side navigation unmounts the form without
  // firing it, and dropping the timer there silently discarded any change
  // made within the debounce window. The ref keeps the unmount effect's
  // deps empty while still calling the latest commitSave/form pair;
  // fire-and-forget is safe because the Server Action and the global
  // toast/save-status stores outlive the component.
  const flushPendingSaveRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushPendingSaveRef.current = () => {
      if (!pendingTimerRef.current) return;
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
      // Same cast as the watch callback — getValues() returns the schema's
      // input (deep-partial) type; commitSave zod-gates the payload anyway.
      void commitSave(form.getValues() as SettingsFormValues);
    };
  }, [form, commitSave]);

  // beforeunload guard — warn if a save is queued.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingTimerRef.current) {
        e.preventDefault();
        e.returnValue = 'Unsaved settings changes will be lost.';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      flushPendingSaveRef.current();
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current);
      useSaveStatusStore.getState().setStatus('idle');
    };
  }, []);

  return { form, query, save };
}
