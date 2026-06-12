// test/setup-config-writer.test.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySettings,
  readConfig,
  seedConfigIfMissing,
  writeConfigAtomic,
} from '../scripts/lib/config-writer.mjs';

let dir, configPath, examplePath;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-cfg-'));
  configPath = join(dir, 'config.yml');
  examplePath = join(dir, 'example.yml');
  writeFileSync(
    examplePath,
    yaml.dump({ appearance: { theme: 'system' }, providers: { default_provider: 'claude' } }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('config-writer', () => {
  it('seeds from example when config is missing, no-ops when present', () => {
    expect(seedConfigIfMissing(configPath, examplePath)).toBe('seeded');
    expect(seedConfigIfMissing(configPath, examplePath)).toBe('exists');
  });

  it('creates the parent dir when it is missing (fresh clone)', () => {
    const nested = join(dir, 'inputs', 'config', 'config.yml');
    expect(seedConfigIfMissing(nested, examplePath)).toBe('seeded');
    expect(existsSync(nested)).toBe(true);
  });

  it('applySettings sets default/screen/batch + fallback', () => {
    const next = applySettings(
      { appearance: { theme: 'system' }, providers: {} },
      {
        theme: 'dark',
        provider: 'opencode',
        // Neutral fixtures — the writer persists whatever it's handed; these
        // mirror OpenCode's `provider/model` id shape but aren't real models.
        defaultModel: 'prov/model-default',
        screenModel: 'prov/model-screen',
        fallback: 'prov/model-fallback',
      },
    );
    expect(next.appearance.theme).toBe('dark');
    expect(next.providers.default_provider).toBe('opencode');
    expect(next.providers.default_model).toBe('prov/model-default');
    expect(next.providers.modes.screen).toEqual({
      platform: 'opencode',
      model: 'prov/model-screen',
    });
    expect(next.providers.modes['batch-evaluate']).toEqual({
      platform: 'opencode',
      model: 'prov/model-default',
    });
    expect(next.providers.fallback).toEqual({
      platform: 'opencode',
      model: 'prov/model-fallback',
    });
  });

  it('applySettings omits fallback when falsy, even if one existed', () => {
    const next = applySettings(
      { providers: { fallback: { platform: 'claude', model: 'x' } } },
      { theme: 'system', provider: 'claude', defaultModel: 'm', screenModel: 's', fallback: '' },
    );
    expect(next.providers.fallback).toBeUndefined();
  });

  it('atomic write round-trips and rotates a .bak', () => {
    seedConfigIfMissing(configPath, examplePath);
    const cfg = applySettings(readConfig(configPath), {
      theme: 'light',
      provider: 'claude',
      defaultModel: 'model-default',
      screenModel: 'model-screen',
      fallback: null,
    });
    writeConfigAtomic(cfg, configPath);
    const back = yaml.load(readFileSync(configPath, 'utf-8'));
    expect(back.appearance.theme).toBe('light');
    expect(back.providers.modes.screen.model).toBe('model-screen');
    expect(existsSync(`${configPath}.bak`)).toBe(true);
  });
});
