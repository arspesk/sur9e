// src/features/settings/hooks/__tests__/sanitize-for-save.test.ts
//
// Unit test for the per-mode "Use default" sentinel stripper. The
// ModeOverride zod schema in
// src/lib/schemas/settings.ts is strict — `{platform, model}` both
// required — so any row written by the Providers section that the user
// flipped back to "Use default" MUST be deleted before reaching the
// server. Without this stripper, the auto-save PATCH would 4xx and the
// user's other edits in the same debounce window would be lost.
//
// Pure data-shape test: no rhf, no JSDOM. The same OOM constraint
// described in settings-form-regression.test.tsx applies here.

import { describe, expect, it } from 'vitest';
import { SettingsFormSchema, type SettingsFormValues } from '../../schemas';
import { sanitizeForSave } from '../use-settings-form';

// Build a fully-defaulted settings tree from zod so the sanitizer sees
// the same shape rhf gives it at runtime (every required nested object
// populated). Casting through unknown keeps TS happy for the "the user
// just wrote a partial row" test cases that the runtime form allows.
function makeValues(providerModes: Record<string, unknown>): SettingsFormValues {
  const base = SettingsFormSchema.parse({});
  return {
    ...base,
    providers: {
      ...base.providers,
      modes: providerModes as SettingsFormValues['providers']['modes'],
    },
  };
}

describe('sanitizeForSave — NaN leaf stripping', () => {
  it('strips NaN from a number field so the wire never carries NaN', () => {
    const base = SettingsFormSchema.parse({});
    // Simulate what react-hook-form's valueAsNumber produces for a cleared input.
    const values = {
      ...base,
      advanced: {
        ...base.advanced,
        score_threshold: Number.NaN,
      },
    } as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    // The field must be absent (or, if present, must not be NaN).
    expect(
      'score_threshold' in cleaned.advanced
        ? (cleaned.advanced as Record<string, unknown>).score_threshold
        : undefined,
    ).not.toBe(Number.NaN);
    expect(Object.prototype.hasOwnProperty.call(cleaned.advanced, 'score_threshold')).toBe(false);
  });

  it('zero is a valid value and survives the NaN strip', () => {
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      screening: {
        ...base.screening,
        smoke_test_limit: 0,
      },
    } as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect(cleaned.screening?.smoke_test_limit).toBe(0);
  });
});

describe('sanitizeForSave — appearance stripping', () => {
  it('strips appearance from form patches (theme is owned by the shell ThemeSwitch)', () => {
    const base = SettingsFormSchema.parse({ appearance: { theme: 'dark' } });
    const cleaned = sanitizeForSave(base as SettingsFormValues);
    expect(Object.prototype.hasOwnProperty.call(cleaned, 'appearance')).toBe(false);
    // The stripped patch must still satisfy the schema (defaults backfill).
    expect(SettingsFormSchema.safeParse(cleaned).success).toBe(true);
  });
});

describe('sanitizeForSave — legacy providers.models.{screen,batch} stripping', () => {
  it('always strips legacy providers.models.screen/batch aliases', () => {
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      providers: {
        ...base.providers,
        models: { screen: 'claude-haiku-4-5-20251001', batch: 'claude-sonnet-4-6' },
      },
    } as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers?.models?.screen).toBeUndefined();
    expect(cleaned.providers?.models?.batch).toBeUndefined();
  });
});

describe('sanitizeForSave — providers.modes stripping', () => {
  it('keeps a fully-populated override row untouched', () => {
    const values = makeValues({
      evaluate: { platform: 'codex', model: 'gpt-5.5' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({
      evaluate: { platform: 'codex', model: 'gpt-5.5' },
    });
  });

  it('deletes a row whose platform is empty (user picked "Use default" for platform)', () => {
    const values = makeValues({
      evaluate: { platform: '', model: 'gpt-5.5' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({});
  });

  it('deletes a row whose model is empty (user picked "Use default" for model)', () => {
    const values = makeValues({
      evaluate: { platform: 'codex', model: '' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({});
  });

  it('deletes a row whose platform/model is null or undefined', () => {
    const values = makeValues({
      evaluate: { platform: null, model: null },
      training: { platform: undefined, model: undefined },
      apply: {},
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({});
  });

  it('preserves siblings — only the empty rows are removed', () => {
    const values = makeValues({
      evaluate: { platform: 'codex', model: 'gpt-5.5' },
      training: { platform: '', model: '' },
      apply: { platform: 'opencode', model: 'anthropic/claude-3-haiku' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({
      evaluate: { platform: 'codex', model: 'gpt-5.5' },
      apply: { platform: 'opencode', model: 'anthropic/claude-3-haiku' },
    });
  });

  it('passes the cleaned payload through SettingsFormSchema without error', () => {
    // Regression guard: if the sanitizer ever forgets to strip a partial
    // row, the strict ModeOverride parse below would throw.
    const values = makeValues({
      evaluate: { platform: 'codex', model: 'gpt-5.5' },
      training: { platform: '', model: 'kimi-k2.6' },
      apply: { platform: '', model: '' },
    });
    const cleaned = sanitizeForSave(values);
    // Should not throw — parses cleanly through SettingsFormSchema.
    expect(() => SettingsFormSchema.parse(cleaned)).not.toThrow();
  });

  it('keeps a fallback-only row intact (no primary, valid fallback)', () => {
    const values = makeValues({
      evaluate: { fallback: { platform: 'codex', model: 'gpt-5-codex' } },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({
      evaluate: { fallback: { platform: 'codex', model: 'gpt-5-codex' } },
    });
  });

  it('strips a partial fallback but keeps the primary half of the row', () => {
    const values = makeValues({
      evaluate: {
        platform: 'claude',
        model: 'claude-opus-4-7',
        fallback: { platform: 'codex', model: '' },
      },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({
      evaluate: { platform: 'claude', model: 'claude-opus-4-7' },
    });
  });

  it('still deletes a row with neither a valid primary nor a valid fallback', () => {
    const values = makeValues({
      evaluate: { platform: '', model: '' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({});
  });

  it('keeps a valid global fallback pair intact', () => {
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      providers: {
        ...base.providers,
        fallback: { platform: 'codex', model: 'gpt-5-codex' },
      },
    } as unknown as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.fallback).toEqual({ platform: 'codex', model: 'gpt-5-codex' });
  });

  it('maps a fully blank global fallback ("None" pick) to the explicit null sentinel', () => {
    // Regression: the sanitizer used to DELETE the blank pair from the patch,
    // but an absent key is a deep-merge no-op in saveSettings — the persisted
    // fallback survived every save and "None" never stuck. `fallback: null`
    // is the wire signal for "delete the on-disk key".
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      providers: {
        ...base.providers,
        fallback: { platform: '', model: '' },
      },
    } as unknown as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect('fallback' in cleaned.providers).toBe(true);
    expect(cleaned.providers.fallback).toBeNull();
  });

  it('drops a HALF-blank global fallback from the patch (mid-edit no-op, on-disk preserved)', () => {
    // Platform picked but no model yet (debounced save can fire mid-edit) —
    // must neither send an invalid half-pair nor delete the persisted pair.
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      providers: {
        ...base.providers,
        fallback: { platform: 'codex', model: '' },
      },
    } as unknown as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect('fallback' in cleaned.providers).toBe(false);
  });

  it('the null-sentinel payload still parses through SettingsFormSchema (save gate)', () => {
    // commitSave zod-gates the sanitized payload before mutateAsync; if the
    // form schema rejected `fallback: null`, the "None" save would be
    // silently skipped and the bug would reappear.
    const base = SettingsFormSchema.parse({});
    const values = {
      ...base,
      providers: {
        ...base.providers,
        fallback: { platform: '', model: '' },
      },
    } as unknown as SettingsFormValues;
    const cleaned = sanitizeForSave(values);
    expect(() => SettingsFormSchema.parse(cleaned)).not.toThrow();
  });

  it('"Use default" round-trip: handler writes {platform:"", model:""}, sanitizer drops the row', () => {
    // Mirrors the exact shape the providers-section.tsx "Use default"
    // handlers write via setValue (handlePlatform / handleModel at
    // lines ~358 + ~396). The form state holds the empty-string row;
    // sanitizeForSave MUST delete it before the patch reaches the wire.
    // Without this, the row was silently dropped on
    // the wire but the form state kept the empty row, and the next
    // debounce window's patch would include `evaluate: {platform: '',
    // model: ''}` again — and the deep-merge in saveSettings would
    // preserve the previous disk value because "" looks like an update.
    const values = makeValues({
      // User set Platform=Claude + Model=Sonnet, then flipped back to
      // "Use default" → the handler writes empty strings.
      evaluate: { platform: '', model: '' },
    });
    const cleaned = sanitizeForSave(values);
    expect(cleaned.providers.modes).toEqual({});
    // The wire patch's `providers.modes` becomes {} — combined with the
    // saveSettings wholesale-replace semantics, this guarantees the
    // on-disk override is actually cleared.
  });
});
