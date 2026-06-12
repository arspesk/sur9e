// src/lib/server/__tests__/settings-load-error.test.ts
//
// Fail-soft contract for inputs/config/config.yml:
//   missing file      → all defaults, NO error          (fresh install)
//   valid file        → parsed settings, no error
//   unparseable file  → all defaults + structured error (so /settings can
//                       say "your config was ignored" instead of silently
//                       rendering defaults)
// saveSettings already refuses to overwrite an unreadable file; its message
// must stay banner-sized (no multi-line YAML code frame).
//
// All fixtures live in os.tmpdir() — never touches the real inputs/.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsShape } from '../../schemas/settings';
import { loadSettings, loadSettingsResult, saveSettings } from '../settings';

function makeConfigPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'settings-load-error-'));
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
  return join(root, 'inputs/config/config.yml');
}

describe('loadSettingsResult — fail-soft config.yml loader', () => {
  let cfg: string;

  beforeEach(() => {
    cfg = makeConfigPath();
    // The loader warns on parse failure by design; keep test output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(join(cfg, '..', '..', '..'), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('missing file → all defaults, NO error (fresh-install behavior)', async () => {
    const { settings, error } = await loadSettingsResult(cfg);
    expect(error).toBeNull();
    expect(settings).toEqual(SettingsShape.parse({}));
  });

  it('valid file → parsed settings, no error', async () => {
    writeFileSync(cfg, 'appearance:\n  theme: dark\n');
    const { settings, error } = await loadSettingsResult(cfg);
    expect(error).toBeNull();
    expect(settings.appearance.theme).toBe('dark');
  });

  it('malformed YAML → defaults + structured error with path and 1-based line', async () => {
    writeFileSync(cfg, 'appearance:\n  theme: "unterminated\n');
    const { settings, error } = await loadSettingsResult(cfg);
    // Read paths still degrade to defaults — nothing downstream 500s.
    expect(settings).toEqual(SettingsShape.parse({}));
    expect(error).not.toBeNull();
    expect(error?.path).toBe(cfg);
    expect(error?.message).toContain('unexpected end of the stream');
    expect(error?.message).not.toContain('\n'); // banner-sized, no code frame
    expect(error?.line).toBe(3);
    // The plain loader keeps its existing degrade-to-defaults contract.
    expect(await loadSettings(cfg)).toEqual(SettingsShape.parse({}));
  });

  it('saveSettings refusal message is single-line (describeParseError, not the raw dump)', async () => {
    const broken = 'appearance:\n  theme: "unterminated\n';
    writeFileSync(cfg, broken);
    let thrown: Error | null = null;
    try {
      await saveSettings(cfg, { appearance: { theme: 'dark' } });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toMatch(/refusing to save settings/);
    // js-yaml's default message embeds a multi-line code frame; the refusal
    // copy must surface only the first, human-readable line.
    expect(thrown?.message).not.toContain('\n');
    // And the broken file is untouched.
    expect(readFileSync(cfg, 'utf-8')).toBe(broken);
  });
});
