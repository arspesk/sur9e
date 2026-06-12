// scripts/lib/config-writer.mjs
// SPDX-License-Identifier: MIT
// Pure read/seed/patch/atomic-write for inputs/config/config.yml. No prompts.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_PATH = join(ROOT, 'inputs', 'config', 'config.yml');
export const EXAMPLE_PATH = join(ROOT, 'content', 'examples', 'config.yml');

export function seedConfigIfMissing(configPath = CONFIG_PATH, examplePath = EXAMPLE_PATH) {
  if (existsSync(configPath)) return 'exists';
  // inputs/config/ is gitignored, so it won't exist on a fresh clone.
  mkdirSync(dirname(configPath), { recursive: true });
  copyFileSync(examplePath, configPath);
  return 'seeded';
}

export function readConfig(configPath = CONFIG_PATH) {
  return yaml.load(readFileSync(configPath, 'utf-8')) || {};
}

/**
 * Set only the essential onboarding keys; everything else is preserved.
 * - defaultModel  → global default + the deep `batch-evaluate` pass
 * - screenModel   → the cheap `screen` pass (kept cheap out of the box)
 * - fallback      → global fallback model (retried once on failure); falsy = off
 */
export function applySettings(config, { theme, provider, defaultModel, screenModel, fallback }) {
  const next = structuredClone(config);
  next.appearance = { ...(next.appearance || {}), theme };
  next.providers = { ...(next.providers || {}) };
  next.providers.default_provider = provider;
  next.providers.default_model = defaultModel;
  next.providers.modes = { ...(next.providers.modes || {}) };
  next.providers.modes.screen = { platform: provider, model: screenModel };
  next.providers.modes['batch-evaluate'] = { platform: provider, model: defaultModel };
  if (fallback) {
    next.providers.fallback = { platform: provider, model: fallback };
  } else {
    delete next.providers.fallback;
  }
  return next;
}

/** Write tmp → rotate previous to .bak → rename, so Ctrl-C can't truncate. */
export function writeConfigAtomic(config, configPath = CONFIG_PATH) {
  const tmp = `${configPath}.tmp`;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(tmp, yaml.dump(config, { lineWidth: -1 }), 'utf-8');
  if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.bak`);
  renameSync(tmp, configPath);
}
