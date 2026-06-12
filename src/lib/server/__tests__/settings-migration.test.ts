// src/lib/server/__tests__/settings-migration.test.ts
//
// Legacy advanced.models.{screen,batch} keys migrate
// into the new providers.modes map on first load. The legacy keys stay in
// the schema for one release (rollback safety); the loader prefers the
// migrated `modes` entries when both exist.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

function fixture(initial: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-settings-'));
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
  writeFileSync(join(root, 'inputs/config/config.yml'), yaml.dump(initial));
  return join(root, 'inputs/config/config.yml');
}

describe('settings migration', () => {
  it('migrates legacy advanced.models.{screen,batch} into providers.modes', async () => {
    const cfg = fixture({
      advanced: {
        models: {
          screen: 'claude-haiku-4-5-20251001',
          batch: 'claude-sonnet-4-6',
        },
      },
    });
    const s = await loadSettings(cfg);
    expect(s.providers.modes.screen).toEqual({
      platform: 'claude',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(s.providers.modes['batch-evaluate']).toEqual({
      platform: 'claude',
      model: 'claude-sonnet-4-6',
    });
  });

  it('writing the migrated shape back persists the new keys', async () => {
    const cfg = fixture({
      advanced: { models: { screen: 'claude-haiku-4-5-20251001' } },
    });
    await loadSettings(cfg); // triggers migration; doesn't write
    await saveSettings(cfg, {}); // any save writes the merged new shape
    const written = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const providers = written.providers as Record<string, unknown>;
    const modes = providers.modes as Record<string, { platform: string; model: string }>;
    expect(modes.screen.platform).toBe('claude');
  });
});
