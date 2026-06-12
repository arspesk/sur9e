// test/install-hook.test.mjs
//
// Locks .codex/install-hook.mjs — the per-machine wiring that `npm run setup`
// now runs for Codex users (and that doctor's usage-tracking check mirrors).
// Codex only fires hooks from the global ~/.codex/config.toml (openai/codex
// #17532), so this writes the sur9e Stop hook there idempotently, preserving
// any existing config.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  alreadyInstalled,
  buildHookBlock,
  defaultConfigPath,
  install,
  planConfig,
} from '../.codex/install-hook.mjs';

const HOOK = '/abs/path/.codex/hooks/sur9e-track-usage.mjs';

describe('buildHookBlock', () => {
  it('emits a [[hooks.Stop]] command block with the quoted command path', () => {
    const block = buildHookBlock(HOOK);
    expect(block).toContain('[[hooks.Stop]]');
    expect(block).toContain('[[hooks.Stop.hooks]]');
    expect(block).toContain('type = "command"');
    expect(block).toContain(`command = "${HOOK}"`);
  });
});

describe('alreadyInstalled', () => {
  it('detects the wired command path', () => {
    expect(alreadyInstalled(buildHookBlock(HOOK), HOOK)).toBe(true);
  });
  it('is false for unrelated / empty config', () => {
    expect(alreadyInstalled('[model]\nname = "gpt-5.5"\n', HOOK)).toBe(false);
    expect(alreadyInstalled('', HOOK)).toBe(false);
    expect(alreadyInstalled(null, HOOK)).toBe(false);
  });
});

describe('planConfig', () => {
  it('appends the block when absent (changed)', () => {
    const { changed, text } = planConfig('', HOOK);
    expect(changed).toBe(true);
    expect(text).toContain('[[hooks.Stop]]');
  });

  it('is a no-op when already installed (idempotent)', () => {
    const once = planConfig('', HOOK).text;
    const { changed, text } = planConfig(once, HOOK);
    expect(changed).toBe(false);
    expect(text).toBe(once);
  });

  it('preserves existing config and adds a newline separator', () => {
    const existing = '[model]\nname = "gpt-5.5"';
    const { changed, text } = planConfig(existing, HOOK);
    expect(changed).toBe(true);
    expect(text.startsWith(existing)).toBe(true);
    expect(text).toContain('\n[[hooks.Stop]]');
  });
});

describe('install (real file, temp config path)', () => {
  let configPath;

  beforeEach(() => {
    configPath = join(mkdtempSync(join(tmpdir(), 'sur9e-codex-')), 'config.toml');
  });

  it('creates the config and wires the hook', () => {
    const res = install({ configPath, commandPath: HOOK });
    expect(res.changed).toBe(true);
    expect(res.created).toBe(true);
    expect(readFileSync(configPath, 'utf-8')).toContain(`command = "${HOOK}"`);
  });

  it('is idempotent on a second run', () => {
    install({ configPath, commandPath: HOOK });
    const before = readFileSync(configPath, 'utf-8');
    const res = install({ configPath, commandPath: HOOK });
    expect(res.changed).toBe(false);
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('preserves a pre-existing user config', () => {
    writeFileSync(configPath, '[model]\nname = "gpt-5.5"\n', 'utf-8');
    install({ configPath, commandPath: HOOK });
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('name = "gpt-5.5"');
    expect(text).toContain('[[hooks.Stop]]');
  });
});

describe('defaultConfigPath', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.CODEX_CONFIG_PATH = saved.CODEX_CONFIG_PATH;
    process.env.CODEX_HOME = saved.CODEX_HOME;
  });

  it('honors CODEX_CONFIG_PATH first', () => {
    process.env.CODEX_CONFIG_PATH = '/custom/config.toml';
    expect(defaultConfigPath()).toBe('/custom/config.toml');
  });

  it('falls back to CODEX_HOME/config.toml', () => {
    process.env.CODEX_CONFIG_PATH = '';
    process.env.CODEX_HOME = '/opt/codex';
    expect(defaultConfigPath()).toBe(join('/opt/codex', 'config.toml'));
  });
});
