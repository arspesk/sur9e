'use client';

// sections/providers-section.tsx — Providers & Models settings panel.
// Renamed from models-section.tsx; the section's HTML anchor stays
// `id="models"` so any deep links to /settings#models keep working
// without a redirect.
//
// Three stacked surfaces:
//   1. CLI status — one row per registered provider with install +
//      auth state. Sourced from useProviderInfo() (TanStack Query
//      around GET /api/providers, 5-min stale).
//   2. Defaults — Platform + Model dropdowns bound to
//      providers.default_provider / providers.default_model, plus a
//      Global fallback Platform + Model pair (providers.fallback)
//      retried once when the default fails. A "Refresh model list"
//      button forces a re-probe.
//   3. Per-mode override table — renders ONLY modes that actually carry
//      an override (platform, model, or fallback). Rows enter via the
//      "Add override…" select below the table (which adds a Use-default
//      row ready to edit and focuses its Platform select) or via
//      hydrated config.yml data; rows leave ONLY via their explicit
//      Reset button (flipping all three controls back to default keeps
//      the row visible until Reset — one consistent affordance). Each
//      row has Platform + Model dropdowns that write through to
//      providers.modes.<modeId> via setValue, plus a Fallback column
//      whose trigger opens a Radix Popover with Platform + Model selects
//      writing providers.modes.<modeId>.fallback. "Use default" / "None"
//      clear the matching half; a row with neither a valid primary nor
//      fallback is deleted entirely (handled by sanitizeForSave in
//      use-settings-form.ts, which keeps fallback-only rows — and
//      providers.modes is replaced wholesale on save, so Reset really
//      deletes the persisted row).
//
// State shape decision (per advisor): we use rhf `setValue` with
// `shouldDirty: true` from per-row handlers rather than per-row
// Controllers. Reasons:
//   - The form value at `providers.modes` is a sparse Record — paths
//     like `providers.modes.evaluate.platform` don't exist until the
//     row is touched, and registering individual Controllers for a
//     dynamic key set risks dangling subscriptions.
//   - The sanitizer in use-settings-form.ts strips empty rows before
//     PATCH, so a "Use default" pick that writes a partial row is
//     safe — the next debounce window cleans it up.
//
// CSS lives in chrome.css under the `.providers-section` namespace.

import * as Popover from '@radix-ui/react-popover';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  Button,
  HelperText,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/primitives';
import { useModeManifest } from '@/hooks/use-mode-manifest';
import {
  type ProviderInfoEntry,
  useProviderInfo,
  useRefreshProviderInfo,
} from '@/hooks/use-provider-info';
import type { ProviderId } from '@/lib/schemas/providers';
import type { SettingsFormValues } from '../types';

// Radix Select forbids empty-string item values. Map the "use default"
// sentinel to a token here and translate at the rhf boundary so the
// form value remains "" / undefined (which sanitizeForSave strips).
const USE_DEFAULT = '__use_default__';

// Radix Select also forbids empty-string values for the fallback pickers.
// "None" (turn fallback off) maps to this sentinel; the handlers translate
// it back to `{platform: '', model: ''}`. For the GLOBAL fallback,
// sanitizeForSave turns that blank pair into the explicit `fallback: null`
// patch value so saveSettings deletes the persisted key; for PER-MODE
// fallbacks it just strips the blank half (modes is replaced wholesale).
const NONE = '__none__';

// Trim a model id to a compact label for the per-mode fallback trigger:
// keep only the tail after the last "/" (opencode-style "anthropic/claude-…")
// then drop a leading "claude-" so e.g. "claude-opus-4-7" → "opus-4-7".
function shortModel(model: string): string {
  const tail = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return tail.startsWith('claude-') ? tail.slice('claude-'.length) : tail;
}

// Map mode id → legacy `providers.models.<key>` alias (legacy holdover).
// Only `screen` and `batch-evaluate` had legacy aliases; other modes are
// new in `providers.modes` and never had a sibling `providers.models.<id>`
// entry to clear. When the user clears one of these
// rows via "Use default" we ALSO clear the matching legacy key — otherwise
// the on-load migration in `src/lib/server/settings.ts#migrateLegacyModels`
// would resurrect the row on the next reload.
const LEGACY_MODELS_KEY_BY_MODE: Record<string, 'screen' | 'batch'> = {
  screen: 'screen',
  'batch-evaluate': 'batch',
};

// Friendly names for the two platform-y columns. Falls back to the
// raw id if the provider isn't in the response (defensive: a renamed
// provider would otherwise render as `undefined`).
function providerLabel(p: ProviderInfoEntry | undefined, fallback: string): string {
  return p?.displayName ?? fallback;
}

export function ProvidersSection() {
  const { control, setValue, getValues } = useFormContext<SettingsFormValues>();
  const providers = useProviderInfo();
  const refresh = useRefreshProviderInfo();
  const modes = useModeManifest();

  // useWatch keeps the section re-rendering when the user flips the
  // default platform — needed so the Default Model dropdown's options
  // refresh to the new provider's model list. Per-mode rows do the
  // same via local useWatch calls inside the row component.
  const defaultPlatform = (useWatch({
    control,
    name: 'providers.default_provider',
  }) ?? 'claude') as ProviderId;
  const defaultModel = useWatch({ control, name: 'providers.default_model' }) ?? '';

  // Global fallback pair. Absent (or a blank pair) means fallback is off;
  // sanitizeForSave maps a `{platform:'', model:''}` value to the `null`
  // delete sentinel before save (saveSettings removes the on-disk key).
  const fallback = useWatch({ control, name: 'providers.fallback' }) as
    | { platform?: string; model?: string }
    | undefined;
  const fallbackPlatform = (fallback?.platform ?? '') as ProviderId | '';
  const fallbackModel = fallback?.model ?? '';

  const providersData = providers.data?.providers;
  const providerEntries: ProviderInfoEntry[] = providersData ? Object.values(providersData) : [];
  const defaultProviderModels = providersData?.[defaultPlatform]?.models ?? [];
  const fallbackProviderModels = fallbackPlatform
    ? (providersData?.[fallbackPlatform]?.models ?? [])
    : [];

  // The per-mode override map. We READ via useWatch so the section re-
  // renders when sanitizeForSave deletes a row (e.g. user picked "Use
  // default") and the underlying form value flips back to undefined.
  const modeOverrides = useWatch({ control, name: 'providers.modes' }) ?? {};

  // ── Visible-row bookkeeping ──────────────────────────────────────────
  // Only modes with an actual override render a row. Membership is sticky:
  // once a row appears (hydrated from config.yml or added via the
  // "Add override…" select) it stays until its explicit Reset button —
  // flipping every dropdown back to "Use default" must not vanish the row
  // mid-edit. The effect below only ever ADDS ids (late hydration, server
  // refetch); Reset is the single removal path.
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  useEffect(() => {
    const overridden: string[] = [];
    for (const [modeId, row] of Object.entries(modeOverrides ?? {})) {
      const r = (row ?? {}) as {
        platform?: string;
        model?: string;
        fallback?: { platform?: string; model?: string };
      };
      if (r.platform || r.model || r.fallback?.platform || r.fallback?.model) {
        overridden.push(modeId);
      }
    }
    setVisibleIds(prev => {
      const added = overridden.filter(id => !prev.includes(id));
      return added.length === 0 ? prev : [...prev, ...added];
    });
  }, [modeOverrides]);

  // Focus the freshly-added row's Platform select once it has rendered.
  const pendingFocusRef = useRef<string | null>(null);
  // Deliberately no dependency array — this runs after every render because the
  // target row only exists after the visibleIds state flush.
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const el = document.querySelector<HTMLElement>(
      `[data-mode-platform="${pendingFocusRef.current}"]`,
    );
    if (el) {
      el.focus();
      pendingFocusRef.current = null;
    }
  });

  const handleAddOverride = useCallback((modeId: string) => {
    pendingFocusRef.current = modeId;
    setVisibleIds(prev => (prev.includes(modeId) ? prev : [...prev, modeId]));
  }, []);

  // Reset = the one row-removal affordance. Blank out the whole row
  // (primary + fallback) so sanitizeForSave drops it from the patch —
  // providers.modes is replaced wholesale on save, deleting the persisted
  // row — and clear the legacy alias so migrateLegacyModels can't
  // resurrect it on the next load.
  const handleResetOverride = useCallback(
    (modeId: string) => {
      setValue(
        `providers.modes.${modeId}` as const,
        { platform: '', model: '', fallback: { platform: '', model: '' } } as never,
        { shouldDirty: true, shouldTouch: true },
      );
      const legacyKey = LEGACY_MODELS_KEY_BY_MODE[modeId];
      if (legacyKey) {
        setValue(`providers.models.${legacyKey}` as const, '' as never, {
          shouldDirty: true,
          shouldTouch: true,
        });
      }
      setVisibleIds(prev => prev.filter(id => id !== modeId));
    },
    [setValue],
  );

  // Snap the default model to the new platform's first available id
  // when the user changes the platform, so the saved default never
  // references a model the new platform doesn't expose.
  const handleDefaultPlatformChange = useCallback(
    (next: ProviderId) => {
      setValue('providers.default_provider', next, { shouldDirty: true, shouldTouch: true });
      const nextModels = providersData?.[next]?.models ?? [];
      const currentModel = getValues('providers.default_model');
      // Keep the current model if the new platform has it; otherwise
      // snap to the first available id (or leave as-is when empty).
      const stillValid = nextModels.some(m => m.id === currentModel);
      if (!stillValid && nextModels.length > 0) {
        setValue('providers.default_model', nextModels[0]!.id, {
          shouldDirty: true,
          shouldTouch: true,
        });
      }
    },
    [providersData, setValue, getValues],
  );

  // Global fallback platform change. "None" turns the fallback off by writing
  // a blank pair (the sanitizer sends `fallback: null` so the persisted key is
  // deleted); otherwise snap the fallback model to the new platform's first id
  // when the current model doesn't belong to it.
  const handleFallbackPlatformChange = useCallback(
    (next: string) => {
      if (next === NONE) {
        setValue('providers.fallback', { platform: '', model: '' } as never, {
          shouldDirty: true,
          shouldTouch: true,
        });
        return;
      }
      const nextModels = providersData?.[next]?.models ?? [];
      const current = getValues('providers.fallback')?.model;
      const keep = nextModels.some(m => m.id === current);
      setValue(
        'providers.fallback',
        { platform: next, model: keep ? (current ?? '') : (nextModels[0]?.id ?? '') } as never,
        { shouldDirty: true, shouldTouch: true },
      );
    },
    [providersData, setValue, getValues],
  );

  const handleFallbackModelChange = useCallback(
    (next: string) => {
      if (next === NONE) {
        setValue('providers.fallback', { platform: '', model: '' } as never, {
          shouldDirty: true,
          shouldTouch: true,
        });
        return;
      }
      setValue('providers.fallback', { platform: fallbackPlatform, model: next } as never, {
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [fallbackPlatform, setValue],
  );

  return (
    <section className="form-section providers-section anim-enter" id="models">
      <h2 className="form-section__title">AI providers &amp; models</h2>
      <p className="form-section__desc">
        Which provider and model run each evaluation mode. Stored under{' '}
        <code>providers.default_provider</code>, <code>providers.default_model</code>, and{' '}
        <code>providers.modes.*</code>.
      </p>

      {/* ── 1) CLI status panel ─────────────────────────────────────── */}
      <div className="providers-cli-status" data-testid="providers-cli-status">
        <div className="providers-cli-status__header">
          <h3 className="providers-cli-status__title">CLI status</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || providers.isFetching}
            title="Re-probe install + auth status for every provider"
          >
            {refresh.isPending || providers.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {providers.isLoading && !providersData ? (
          <p className="providers-cli-status__loading">Loading provider status…</p>
        ) : providerEntries.length === 0 ? (
          <p className="providers-cli-status__loading">
            No providers registered. Check your installation.
          </p>
        ) : (
          <ul className="providers-cli-status__list">
            {providerEntries.map(p => {
              const installed = p.installed.ok;
              const authOk = p.auth.ok;
              const statusClass = !installed
                ? 'providers-cli-row--missing'
                : !authOk
                  ? 'providers-cli-row--warning'
                  : 'providers-cli-row--ok';
              return (
                <li
                  key={p.id}
                  className={`providers-cli-row ${statusClass}`}
                  data-provider={p.id}
                  data-installed={installed}
                  data-auth={authOk}
                >
                  <span
                    className="providers-cli-row__mark"
                    aria-label={installed ? 'Installed' : 'Not installed'}
                  >
                    {installed ? '✓' : '✗'}
                  </span>
                  <span className="providers-cli-row__name">{p.displayName}</span>
                  <span className="providers-cli-row__detail">
                    {installed ? (
                      <>
                        {p.installed.version ? (
                          <code className="providers-cli-row__version">v{p.installed.version}</code>
                        ) : null}
                        {authOk ? (
                          <span className="providers-cli-row__auth providers-cli-row__auth--ok">
                            auth ok
                          </span>
                        ) : (
                          <span className="providers-cli-row__auth providers-cli-row__auth--warn">
                            ⚠ {p.auth.warning ?? 'auth required'}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="providers-cli-row__hint">
                        not found → <code>{p.installHint}</code>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── 2) Global defaults row ──────────────────────────────────── */}
      <div className="providers-defaults">
        <h3 className="providers-defaults__title">Global default</h3>
        <p className="providers-defaults__desc">
          Used by every mode unless a per-mode override below pins something else.
        </p>
        <div className="form-grid form-grid--cols-2">
          <div className="form-field">
            <Label htmlFor="settings-default-platform">Platform</Label>
            <Select
              value={defaultPlatform}
              onValueChange={v => handleDefaultPlatformChange(v as ProviderId)}
            >
              <SelectTrigger id="settings-default-platform" data-default-platform>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerEntries.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                    {!p.installed.ok ? ' (not installed)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>The CLI that runs for every mode without a per-mode override.</HelperText>
          </div>
          <div className="form-field">
            <Label htmlFor="settings-default-model">Model</Label>
            <Select
              value={defaultModel || (defaultProviderModels[0]?.id ?? '')}
              onValueChange={v =>
                setValue('providers.default_model', v, { shouldDirty: true, shouldTouch: true })
              }
              disabled={defaultProviderModels.length === 0}
            >
              <SelectTrigger id="settings-default-model" data-default-model>
                <SelectValue
                  placeholder={
                    defaultProviderModels.length === 0 ? 'No models available' : 'Select a model…'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {defaultProviderModels.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>
              Model for the platform above. Refresh to re-probe after installing or updating a CLI.
            </HelperText>
          </div>
        </div>
      </div>

      {/* ── 2b) Global fallback pair ────────────────────────────────── */}
      <div className="providers-defaults">
        <h3 className="providers-defaults__title">Fallback (when the default fails)</h3>
        <p className="providers-defaults__desc">
          A second platform + model retried once when the global default fails.
        </p>
        <div className="form-grid form-grid--cols-2">
          <div className="form-field">
            <Label htmlFor="settings-fallback-platform">Platform</Label>
            <Select value={fallbackPlatform || NONE} onValueChange={handleFallbackPlatformChange}>
              <SelectTrigger id="settings-fallback-platform" data-fallback-platform>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {providerEntries.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                    {!p.installed.ok ? ' (not installed)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>
              Retried once when a run fails for a model-related reason (model unavailable,
              overloaded, rate-limited, quota). None turns fallback off.
            </HelperText>
          </div>
          <div className="form-field">
            <Label htmlFor="settings-fallback-model">Model</Label>
            <Select
              value={fallbackModel || (fallbackProviderModels[0]?.id ?? NONE)}
              onValueChange={handleFallbackModelChange}
              disabled={!fallbackPlatform}
            >
              <SelectTrigger id="settings-fallback-model" data-fallback-model>
                <SelectValue
                  placeholder={fallbackPlatform ? 'Select a model…' : 'No fallback platform'}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {fallbackProviderModels.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>Model for the fallback platform above.</HelperText>
          </div>
        </div>
      </div>

      {/* ── 3) Per-mode override table ─────────────────────────────── */}
      <div className="providers-modes">
        <h3 className="providers-modes__title">Per-mode overrides</h3>
        <p className="providers-modes__desc">
          Pin a specific platform + model for a single mode. "Use default" inherits the global
          default; when no global default is set, the mode's front-matter default applies.
        </p>
        {modes.isLoading && !modes.data ? (
          <p className="providers-modes__loading">Loading mode catalogue…</p>
        ) : (modes.data?.modes ?? []).length === 0 ? (
          <p className="providers-modes__loading">
            No modes found. Check <code>content/modes/</code>.
          </p>
        ) : (
          (() => {
            const allModes = modes.data?.modes ?? [];
            const visibleModes = allModes.filter(m => visibleIds.includes(m.modeId));
            const availableModes = allModes.filter(m => !visibleIds.includes(m.modeId));
            return (
              <>
                {visibleModes.length === 0 ? (
                  <p className="providers-modes__empty" data-testid="providers-modes-empty">
                    No per-mode overrides — every mode uses the global default.
                  </p>
                ) : (
                  <table className="providers-modes__table" data-testid="providers-modes-table">
                    <thead>
                      <tr>
                        <th scope="col">Mode</th>
                        <th scope="col">Platform</th>
                        <th scope="col">Model</th>
                        <th scope="col">Fallback</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleModes.map(mode => {
                        const row = modeOverrides?.[mode.modeId] ?? null;
                        return (
                          <ModeOverrideRow
                            key={mode.modeId}
                            modeId={mode.modeId}
                            defaultPlatform={mode.default_platform}
                            providers={providersData}
                            selectedPlatform={
                              (row as { platform?: string } | null)?.platform as
                                | ProviderId
                                | undefined
                            }
                            selectedModel={(row as { model?: string } | null)?.model}
                            fallback={
                              (
                                row as {
                                  fallback?: { platform?: string; model?: string };
                                } | null
                              )?.fallback
                            }
                            onReset={handleResetOverride}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {availableModes.length > 0 && (
                  <div className="providers-modes__add">
                    {/* Controlled value stays "" so the trigger always shows the
                        placeholder — picking a mode adds its row, it doesn't
                        "select" anything here. */}
                    <Select value="" onValueChange={handleAddOverride}>
                      <SelectTrigger
                        className="providers-modes__add-trigger"
                        aria-label="Add a per-mode override"
                        data-testid="add-mode-override"
                      >
                        <SelectValue placeholder="Add override…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableModes.map(m => (
                          <SelectItem key={m.modeId} value={m.modeId}>
                            {m.modeId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            );
          })()
        )}
      </div>
    </section>
  );
}

interface ModeOverrideRowProps {
  modeId: string;
  defaultPlatform: ProviderId;
  providers: Record<string, ProviderInfoEntry> | undefined;
  selectedPlatform: ProviderId | undefined;
  selectedModel: string | undefined;
  fallback: { platform?: string; model?: string } | undefined;
  /** Clears the whole row (primary + fallback + legacy alias) and removes it
   *  from the rendered table — the single row-removal affordance. */
  onReset: (modeId: string) => void;
}

function ModeOverrideRow({
  modeId,
  defaultPlatform,
  providers,
  selectedPlatform,
  selectedModel,
  fallback,
  onReset,
}: ModeOverrideRowProps) {
  const { setValue, getValues } = useFormContext<SettingsFormValues>();

  // Read the current row at write time and setValue the WHOLE merged object.
  // rhf nested-path writes on a sparse Record are fragile, so each handler
  // rebuilds the full row from getValues + its own change. This also keeps
  // the OTHER half intact — editing the primary preserves any fallback, and
  // editing the fallback preserves the primary.
  const writeRow = useCallback(
    (patch: {
      platform?: string;
      model?: string;
      fallback?: { platform: string; model: string };
    }) => {
      const path = `providers.modes.${modeId}` as const;
      const current = (getValues(path) ?? {}) as {
        platform?: string;
        model?: string;
        fallback?: { platform?: string; model?: string };
      };
      setValue(path, { ...current, ...patch } as never, {
        shouldDirty: true,
        shouldTouch: true,
      });
    },
    [modeId, getValues, setValue],
  );

  const isOverridden = Boolean(selectedPlatform && selectedModel);
  // When a user has only picked Platform (not Model), the row is "in
  // transit". Show the picked platform in the dropdown so the change
  // doesn't feel ignored, but the row stays sparse on disk until both
  // sides are filled.
  //
  // IMPORTANT: use `||` (not `??`) so empty-string values (written by
  // the "Use default" handlers below as `{platform: '', model: ''}`)
  // also fall back to the USE_DEFAULT sentinel. Radix Select forbids
  // empty-string item values — without this fallback the trigger would
  // render blank after the user picks "Use default".
  const visiblePlatform = selectedPlatform || USE_DEFAULT;
  const visibleModel = selectedModel || USE_DEFAULT;

  // Model list for whichever platform is selected (or the default
  // platform when the row is empty — gives the user a sensible
  // dropdown to pick from instead of an empty list).
  const platformForModelList: ProviderId = selectedPlatform ?? (defaultPlatform as ProviderId);
  const modelOptions = providers?.[platformForModelList]?.models ?? [];

  const clearLegacyAlias = useCallback(() => {
    // Also clear the legacy alias (`providers.models.screen` /
    // `providers.models.batch`) when present, otherwise the load-time
    // migration would resurrect the row on the next page refresh.
    const legacyKey = LEGACY_MODELS_KEY_BY_MODE[modeId];
    if (legacyKey) {
      setValue(`providers.models.${legacyKey}` as const, '' as never, {
        shouldDirty: true,
        shouldTouch: true,
      });
    }
  }, [modeId, setValue]);

  const handlePlatform = useCallback(
    (next: string) => {
      if (next === USE_DEFAULT) {
        // Sentinel: clear the primary pair (keep any fallback so the row can
        // survive as fallback-only). The sanitizer drops the empty primary.
        writeRow({ platform: '', model: '' });
        clearLegacyAlias();
        return;
      }
      // Reset the model if it doesn't belong to the new platform's
      // namespace. Otherwise the saved row would reference a model id
      // that the new CLI can't resolve.
      const nextModels = providers?.[next]?.models ?? [];
      const keepModel = nextModels.some(m => m.id === selectedModel);
      writeRow({
        platform: next,
        model: keepModel ? (selectedModel ?? '') : (nextModels[0]?.id ?? ''),
      });
    },
    [providers, selectedModel, writeRow, clearLegacyAlias],
  );

  const handleModel = useCallback(
    (next: string) => {
      if (next === USE_DEFAULT) {
        // Sentinel: clear the primary pair (keep any fallback).
        writeRow({ platform: '', model: '' });
        clearLegacyAlias();
        return;
      }
      writeRow({ platform: selectedPlatform ?? platformForModelList, model: next });
    },
    [platformForModelList, selectedPlatform, writeRow, clearLegacyAlias],
  );

  // ── Fallback handlers (per-mode). "None" clears the fallback pair;
  // the sanitizer then drops the partial half and the row survives if its
  // primary is still set (or is deleted entirely if neither half remains).
  const fallbackPlatform = (fallback?.platform ?? '') as ProviderId | '';
  const fallbackModel = fallback?.model ?? '';
  const fallbackModelOptions = fallbackPlatform
    ? (providers?.[fallbackPlatform]?.models ?? [])
    : [];

  const handleFallbackPlatform = useCallback(
    (next: string) => {
      if (next === NONE) {
        writeRow({ fallback: { platform: '', model: '' } as { platform: string; model: string } });
        return;
      }
      const nextModels = providers?.[next]?.models ?? [];
      const keep = nextModels.some(m => m.id === fallbackModel);
      writeRow({
        fallback: { platform: next, model: keep ? fallbackModel : (nextModels[0]?.id ?? '') },
      });
    },
    [providers, fallbackModel, writeRow],
  );

  const handleFallbackModel = useCallback(
    (next: string) => {
      if (next === NONE) {
        writeRow({ fallback: { platform: '', model: '' } as { platform: string; model: string } });
        return;
      }
      writeRow({ fallback: { platform: fallbackPlatform || '', model: next } });
    },
    [fallbackPlatform, writeRow],
  );

  const hasFallback = Boolean(fallbackPlatform && fallbackModel);
  const fallbackTriggerLabel = hasFallback
    ? `${fallbackPlatform} · ${shortModel(fallbackModel)}`
    : 'None';

  const platformOptions = providers ? Object.values(providers) : [];

  return (
    <tr
      className={`providers-mode-row ${
        isOverridden ? 'providers-mode-row--overridden' : 'providers-mode-row--default'
      }`}
      data-mode-id={modeId}
      data-overridden={isOverridden}
    >
      <th scope="row" className="providers-mode-row__name">
        <code>{modeId}</code>
      </th>
      <td className="providers-mode-row__platform">
        <Select value={visiblePlatform} onValueChange={handlePlatform}>
          <SelectTrigger aria-label={`Platform override for ${modeId}`} data-mode-platform={modeId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>Use default</SelectItem>
            {platformOptions.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {providerLabel(p, p.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="providers-mode-row__model">
        <Select
          value={visibleModel}
          onValueChange={handleModel}
          disabled={visiblePlatform === USE_DEFAULT}
        >
          <SelectTrigger aria-label={`Model override for ${modeId}`} data-mode-model={modeId}>
            <SelectValue placeholder="Use default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>Use default</SelectItem>
            {modelOptions.map(m => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="providers-mode-row__fallback">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={`providers-fallback-trigger ${
                hasFallback ? 'providers-fallback-trigger--set' : 'providers-fallback-trigger--none'
              }`}
              aria-label={`Fallback for ${modeId}`}
              data-mode-fallback={modeId}
            >
              <span className="providers-fallback-trigger__value">{fallbackTriggerLabel}</span>
              {/* Same 10×6 chevron as the Select trigger so the cell reads as
                  a dropdown rather than a dead label. */}
              <svg
                aria-hidden="true"
                className="providers-fallback-trigger__icon"
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Chevron down</title>
                <path
                  d="M1 1l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="providers-fallback-popover"
              align="end"
              sideOffset={6}
              collisionPadding={12}
            >
              <div className="form-field">
                <Label htmlFor={`fallback-platform-${modeId}`}>Platform</Label>
                <Select value={fallbackPlatform || NONE} onValueChange={handleFallbackPlatform}>
                  <SelectTrigger id={`fallback-platform-${modeId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {platformOptions.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {providerLabel(p, p.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor={`fallback-model-${modeId}`}>Model</Label>
                <Select
                  value={fallbackModel || NONE}
                  onValueChange={handleFallbackModel}
                  disabled={!fallbackPlatform}
                >
                  <SelectTrigger id={`fallback-model-${modeId}`}>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {fallbackModelOptions.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </td>
      <td className="providers-mode-row__actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Reset override for ${modeId}`}
          title="Clear this override — the mode goes back to the global default"
          data-mode-reset={modeId}
          onClick={() => onReset(modeId)}
        >
          Reset
        </Button>
      </td>
    </tr>
  );
}
