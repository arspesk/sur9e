// src/lib/server/__tests__/settings-schema.test.ts
//
// Parse-boundary tests for the typed settings entrypoint.
//
// CRITICAL: asserts DEFAULT_SETTINGS (schema-derived) deep-equals the
// DEFAULTS constant in settings.mjs. If the schema drifts from the
// hand-rolled defaults, the "loadSettings always returns full shape"
// guarantee silently breaks — this single assertion is the load-bearing
// one in the file. All other tests use tmpdir copies; no real user
// config is touched.

import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsShape } from '../../schemas/settings';
import * as runtimeSettings from '../settings';
import { DEFAULTS, loadSettings, saveSettings } from '../settings';

describe('settings.ts — schema boundary', () => {
  let tmpRoot: string;
  let configPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'settings-schema-test-'));
    configPath = join(tmpRoot, 'config.yml');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // === Load-bearing assertion: schema defaults match the .mjs runtime. ===
  it('DEFAULT_SETTINGS deep-equals the runtime DEFAULTS from settings.mjs', () => {
    // The runtime exports a plain JS object; deep-equal it against the
    // schema-derived constant. Any divergence here means a default has
    // drifted in one place and not the other.
    expect(DEFAULT_SETTINGS).toEqual(runtimeSettings.DEFAULTS);
    // And the re-exported alias from the typed entrypoint matches too.
    expect(DEFAULTS).toEqual(runtimeSettings.DEFAULTS);
  });

  it('loadSettings returns DEFAULT_SETTINGS when the file is missing', async () => {
    expect(existsSync(configPath)).toBe(false);
    const loaded = await loadSettings(configPath);
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });

  it('save → load round-trips and produces a SettingsShape', async () => {
    await saveSettings(configPath, {
      appearance: { theme: 'dark' },
      screening: { smoke_test_limit: 5 },
    });
    const reloaded = await loadSettings(configPath);
    expect(() => SettingsShape.parse(reloaded)).not.toThrow();
    expect(reloaded.appearance.theme).toBe('dark');
    expect(reloaded.screening.smoke_test_limit).toBe(5);
    // Untouched sections still default-populated.
    expect(reloaded.advanced.score_threshold).toBe(DEFAULT_SETTINGS.advanced.score_threshold);
    expect(reloaded.providers.models.screen).toBe(DEFAULT_SETTINGS.providers.models.screen);
  });

  it('partial save preserves the advanced section (deep-merge parity)', async () => {
    await saveSettings(configPath, { appearance: { theme: 'light' } });
    const merged = await loadSettings(configPath);
    expect(merged.appearance.theme).toBe('light');
    expect(merged.advanced.parallel_workers).toBe(DEFAULT_SETTINGS.advanced.parallel_workers);
    expect(merged.system.update_branch).toBe(DEFAULT_SETTINGS.system.update_branch);
  });

  it('two consecutive loadSettings on the same file return deep-equal results', async () => {
    await saveSettings(configPath, { appearance: { theme: 'dark' } });
    const a = await loadSettings(configPath);
    const b = await loadSettings(configPath);
    expect(a).toEqual(b);
  });

  it('SettingsShape.parse({}) produces a fully-populated tree', () => {
    const fresh = SettingsShape.parse({});
    expect(fresh).toEqual(DEFAULT_SETTINGS);
    // Spot-check that every nested branch is present.
    expect('screening' in (fresh.advanced as Record<string, unknown>)).toBe(false);
    expect('system' in (fresh.advanced as Record<string, unknown>)).toBe(false);
    expect('sites' in (fresh.scanning.jobspy as Record<string, unknown>)).toBe(false);
    expect(fresh.scanning.jobspy.hours_old).toBe(168);
    // Scan sources default ON for both scanners (each self-gates on its flag).
    expect(fresh.scanning.sources).toEqual({ ats: true, jobspy: true });
  });

  it('SettingsShape rejects an invalid enum value', () => {
    expect(() => SettingsShape.parse({ appearance: { theme: 'neon' } })).toThrow();
  });

  it('loadSettings cleanup — file is removed by tmpRoot teardown', async () => {
    await saveSettings(configPath, { appearance: { theme: 'dark' } });
    expect(existsSync(configPath)).toBe(true);
    // Pre-cleanup the file inside the test to assert the runtime falls
    // back to DEFAULT_SETTINGS on the very next call.
    unlinkSync(configPath);
    const reloaded = await loadSettings(configPath);
    expect(reloaded).toEqual(DEFAULT_SETTINGS);
  });
});

describe('fallback refs', () => {
  it('parses a global providers.fallback pair', () => {
    const s = SettingsShape.parse({
      providers: { fallback: { platform: 'codex', model: 'gpt-5-codex' } },
    });
    expect(s.providers.fallback).toEqual({ platform: 'codex', model: 'gpt-5-codex' });
  });
  it('defaults providers.fallback to undefined (feature off)', () => {
    expect(SettingsShape.parse({}).providers.fallback).toBeUndefined();
  });
  it('parses a per-mode fallback alongside a primary', () => {
    const s = SettingsShape.parse({
      providers: {
        modes: {
          evaluate: {
            platform: 'claude',
            model: 'claude-opus-4-7',
            fallback: { platform: 'claude', model: 'claude-sonnet-4-6' },
          },
        },
      },
    });
    expect(s.providers.modes.evaluate?.fallback?.model).toBe('claude-sonnet-4-6');
  });
  it('parses a fallback-only mode row (primary inherits global default)', () => {
    const s = SettingsShape.parse({
      providers: {
        modes: { evaluate: { fallback: { platform: 'codex', model: 'gpt-5-codex' } } },
      },
    });
    expect(s.providers.modes.evaluate?.platform).toBeUndefined();
    expect(s.providers.modes.evaluate?.fallback?.platform).toBe('codex');
  });
  it('rejects a partial fallback ref (model missing)', () => {
    expect(() => SettingsShape.parse({ providers: { fallback: { platform: 'codex' } } })).toThrow();
  });
});
