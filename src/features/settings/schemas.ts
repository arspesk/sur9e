// features/settings/schemas.ts
//
// UI-facing schema for the settings form. Settings has no required-field
// rules at the UI layer today — SettingsShape's defaults handle missing
// fields. Extend here if/when per-field UI messages are needed.

import { z } from 'zod';
import { FallbackRef, ProvidersSettings, SettingsShape } from '@/lib/schemas/settings';

// Form-only deviation from the persisted shape: `providers.fallback` also
// accepts `null` — the explicit "turn the global fallback OFF" sentinel that
// sanitizeForSave emits when the user picks "None" (the form writes a blank
// pair; the sanitizer translates it). The persisted SettingsShape stays
// strict (FallbackRef | absent, never null): saveSettings deletes the key
// from the merged config when the patch carries `fallback: null`, so
// config.yml simply lacks it. Without the null in the PATCH, the key would
// be absent → deep-merge no-op → the on-disk fallback could never be
// disabled from the UI.
const FormProvidersSettings = ProvidersSettings.extend({
  fallback: FallbackRef.nullish(),
});

export const SettingsFormSchema = SettingsShape.extend({
  providers: FormProvidersSettings.default(() => FormProvidersSettings.parse({})),
});
// Settings has no required-field rules at the UI layer today; the
// SettingsShape schema's defaults handle missing fields. Extend here
// if/when per-field UI messages are needed.

export type SettingsFormValues = z.infer<typeof SettingsFormSchema>;
