// lib/schemas/settings.ts
//
// zod schema for user settings (inputs/config/config.yml). Every nested object
// uses .default(() => Subshape.parse({})) so SettingsShape.parse({})
// returns a fully-populated tree — this replaces the hand-rolled
// DEFAULTS constant in src/server/lib/settings.mjs and guarantees the
// two stay in sync (asserted by settings-schema.test.ts).
//
// Strict shape (no .passthrough()): the whole point of the parse-at-the-
// boundary contract is that unknown keys don't silently flow through the
// typed surface. Anything missing here that lands in config.yml is a
// schema bug, not a user-data issue.
//
// Old group keys (ui, advanced.screening, advanced.system,
// advanced.{models,modes,default_provider,default_model}) are lifted into
// the new shape by `liftLegacyGroups` in src/lib/server/settings.ts
// before the strict parse runs here.
//
// Search keywords + locations live in the profile
// (profile.yml: search.{terms, locations}) — JobSpy is the only scanner.

// Validating the cron here (not in the scheduler) keeps the typed surface
// honest: an unparseable expression never reaches the runtime. cron-parser
// is ESM/CJS dual and tiny; the same module powers the client's
// next-run preview.
//
// NOTE on whole-file fallback: an invalid cron in the YAML causes
// SettingsShape.parse() to throw inside loadSettings(), whose catch block
// returns full defaults — this is the existing invalid-file semantic for any
// bad value. The UI blocks saving an invalid cron client-side, so only
// hand-edited breakage hits this path; the fallback is loud (console.warn
// from loadSettings) and intentional.
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { ProviderId, ProviderModelRef } from './providers';

function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

export const ScheduleSettings = z.object({
  enabled: z.boolean().default(false),
  cron: z.string().refine(isValidCron, { message: 'Invalid cron expression' }).default('0 9 * * *'),
  catch_up_hours: z.number().int().nonnegative().default(24),
});

export const ScreeningSettings = z.object({
  smoke_test_limit: z.number().int().nonnegative().default(0),
});

export const JobspySettings = z.object({
  hours_old: z.number().int().positive().default(168),
  results_wanted: z.number().int().positive().default(1000),
});

export const TitleFilterSettings = z.object({
  positive: z.array(z.string()).default([]),
  negative: z.array(z.string()).default([]),
  seniority_boost: z.array(z.string()).default([]),
});

// Which scanners run. Both default ON; each scanner self-gates on its flag
// (batch/scan-portals.mjs reads `ats`, batch/scan-jobspy.mjs reads `jobspy`).
// The settings form blocks saving with both off — there'd be nothing to scan.
export const SourcesSettings = z.object({
  ats: z.boolean().default(true),
  jobspy: z.boolean().default(true),
});

export const ScanningSettings = z.object({
  sources: SourcesSettings.default(() => SourcesSettings.parse({})),
  jobspy: JobspySettings.default(() => JobspySettings.parse({})),
  title_filter: TitleFilterSettings.default(() => TitleFilterSettings.parse({})),
  schedule: ScheduleSettings.default(() => ScheduleSettings.parse({})),
});

export const AppearanceSettings = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});

// Deprecated alias: kept for one release for rollback safety. Fields are
// OPTIONAL with no defaults — non-empty defaults here would resurrect onto
// disk via the form's save round-trip, and the load-time migration would
// then re-inject them into `providers.modes.{screen,batch-evaluate}` on the
// next read, flipping per-mode overrides from "Default" back to Claude every
// time an unrelated setting changes (the bug that prompted this fix).
// Migrated into `modes` on load by migrateLegacyModels() in
// src/lib/server/settings.ts.
export const AdvancedModels = z.object({
  screen: z.string().optional(),
  batch: z.string().optional(),
});

// A fallback {platform, model} pair — retried once when the primary fails
// for a model-related reason (see cli/classify-error.mjs RETRYABLE set).
// Both fields required when the key is present; absent = no fallback.
export const FallbackRef = z.object({
  platform: ProviderId,
  model: ProviderModelRef,
});
export type FallbackRef = z.infer<typeof FallbackRef>;

// Per-mode override: { platform, model, fallback? }. platform/model are now
// OPTIONAL so a row can carry only a fallback (its primary then inherits the
// global default). The resolution waterfall in registry.ts only honors the
// primary pair when BOTH are present — partial rows fall through, same as
// before. sanitizeForSave (use-settings-form.ts) keeps fallback-only rows.
export const ModeOverride = z.object({
  platform: ProviderId.optional(),
  model: ProviderModelRef.optional(),
  fallback: FallbackRef.optional(),
});
export type ModeOverride = z.infer<typeof ModeOverride>;

export const ProvidersSettings = z.object({
  // Deprecated alias: kept for one release for rollback safety. Migrated into
  // `modes` on load by migrateLegacyModels() in src/lib/server/settings.ts.
  models: AdvancedModels.default(() => AdvancedModels.parse({})),
  default_provider: ProviderId.default('claude'),
  default_model: ProviderModelRef.default('claude-sonnet-4-6'),
  modes: z.record(z.string(), ModeOverride).default({}),
  // Global fallback pair — used by every mode without a per-mode fallback.
  // No default: absent means the fallback feature is off.
  fallback: FallbackRef.optional(),
});

export const SystemSettings = z.object({
  update_source: z.string().default('https://github.com/arspesk/sur9e.git'),
  update_branch: z.string().default('main'),
});

export const AdvancedSettings = z.object({
  score_threshold: z.number().min(0).max(5).default(3),
  parallel_workers: z.number().int().positive().default(8),
  timeout_ms: z.number().int().positive().default(180000),
});

export const SettingsShape = z.object({
  appearance: AppearanceSettings.default(() => AppearanceSettings.parse({})),
  screening: ScreeningSettings.default(() => ScreeningSettings.parse({})),
  scanning: ScanningSettings.default(() => ScanningSettings.parse({})),
  providers: ProvidersSettings.default(() => ProvidersSettings.parse({})),
  system: SystemSettings.default(() => SystemSettings.parse({})),
  advanced: AdvancedSettings.default(() => AdvancedSettings.parse({})),
});
export type SettingsShape = z.infer<typeof SettingsShape>;

export const DEFAULT_SETTINGS: SettingsShape = SettingsShape.parse({});
