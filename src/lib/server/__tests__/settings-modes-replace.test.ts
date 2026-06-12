// src/lib/server/__tests__/settings-modes-replace.test.ts
//
// Regression lock: `saveSettings` must REPLACE
// `providers.modes` wholesale (not deep-merge) whenever the patch
// contains it. The Settings form's per-mode override table sends the
// complete intended overrides map on every save — a row absent from
// the patch means "no override for that mode", and the pre-fix
// deep-merge silently resurrected rows the user just cleared via
// "Use default".
//
// Note about mode keys: every test below uses non-legacy mode ids
// (`evaluate`, `training`, `apply`) deliberately. The keys `screen`
// and `batch-evaluate` are RESURRECTED on every load by the
// rollback-window migration in `migrateLegacyModels` (it synthesizes
// them from the still-defaulted legacy `providers.models.{screen,batch}`
// fields). That is intentional, pre-existing behavior and explicitly
// out of scope here — touching the migration is off-limits. The user's
// repro flow toggles `evaluate` (or other non-
// legacy modes), so the production fix is real even though `screen`
// would still appear to "snap back" until the rollback alias is dropped.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../settings';

function fixture(initial: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-settings-replace-'));
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
  writeFileSync(join(root, 'inputs/config/config.yml'), yaml.dump(initial));
  return join(root, 'inputs/config/config.yml');
}

describe('saveSettings — providers.modes wholesale replace', () => {
  it('REPLACES providers.modes when the patch includes it (removes rows not in the patch)', async () => {
    // On-disk state has TWO overrides for non-legacy modes.
    const cfg = fixture({
      providers: {
        default_provider: 'claude',
        default_model: 'claude-sonnet-4-6',
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
          training: { platform: 'claude', model: 'claude-haiku-4-5-20251001' },
        },
      },
    });

    // Patch sends only `evaluate` — `training` was cleared via "Use default".
    await saveSettings(cfg, {
      providers: {
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
        },
      },
    });

    // Reload from disk to verify persistence (not just the returned object).
    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.evaluate).toEqual({ platform: 'codex', model: 'gpt-5.5' });
    expect(reloaded.providers.modes.training).toBeUndefined();
  });

  it('REPLACES providers.modes with an empty map clears non-legacy overrides', async () => {
    const cfg = fixture({
      providers: {
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
          training: { platform: 'opencode', model: 'anthropic/claude-3-haiku' },
        },
      },
    });

    // User cleared every override — patch sends an empty modes map.
    await saveSettings(cfg, {
      providers: {
        modes: {},
      },
    });

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.evaluate).toBeUndefined();
    expect(reloaded.providers.modes.training).toBeUndefined();
  });

  it('preserves other providers fields when only modes is replaced', async () => {
    const cfg = fixture({
      providers: {
        default_provider: 'codex',
        default_model: 'gpt-5.5',
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
        },
      },
    });

    // Patch only touches modes — default_provider/default_model must
    // still deep-merge as before.
    await saveSettings(cfg, {
      providers: {
        modes: {},
      },
    });

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.default_provider).toBe('codex');
    expect(reloaded.providers.default_model).toBe('gpt-5.5');
    expect(reloaded.providers.modes.evaluate).toBeUndefined();
  });

  it('LEAVES on-disk providers.modes untouched when the patch omits it (deep-merge fallback)', async () => {
    // Critical: the wholesale-replace must ONLY fire when `modes` is in
    // the patch. If the patch has `providers` but no `modes`, the
    // existing on-disk modes must survive (otherwise unrelated saves —
    // e.g. changing default_provider — would wipe overrides).
    const cfg = fixture({
      providers: {
        default_provider: 'claude',
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
        },
      },
    });

    await saveSettings(cfg, {
      providers: {
        default_provider: 'codex',
        // no `modes` key at all
      },
    });

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.default_provider).toBe('codex');
    expect(reloaded.providers.modes.evaluate).toEqual({
      platform: 'codex',
      model: 'gpt-5.5',
    });
  });

  it('round-trip: write override → save empty modes → reload returns no override', async () => {
    // Matches the user's reproduction flow (using non-legacy `evaluate`):
    //   1. Pick Platform=Claude + Model=Sonnet → save with override
    //   2. Pick Platform=Use-default → sanitizer strips row → save empty
    //   3. Reload → override must be gone, not resurrected from disk.
    const cfg = fixture({});

    // Step 1: write the override.
    await saveSettings(cfg, {
      providers: {
        modes: {
          evaluate: { platform: 'claude', model: 'claude-sonnet-4-6' },
        },
      },
    });
    let reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.evaluate).toEqual({
      platform: 'claude',
      model: 'claude-sonnet-4-6',
    });

    // Step 2: "Use default" — sanitizer strips the row, patch arrives empty.
    await saveSettings(cfg, {
      providers: {
        modes: {},
      },
    });

    // Step 3: reload — `evaluate` override should be GONE, not resurrected.
    reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.evaluate).toBeUndefined();

    // And the YAML on disk should not contain the override either.
    const onDisk = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const providers = onDisk.providers as Record<string, unknown>;
    const onDiskModes = providers.modes as Record<string, unknown>;
    expect(onDiskModes?.evaluate).toBeUndefined();
  });

  it('old-shape patch { advanced: { modes: ... } } still wholesale-replaces (lift normalizes to providers.modes)', async () => {
    // Compat: old-shape callers still send advanced.modes; liftLegacyGroups
    // normalizes it to providers.modes before the wholesale-replace fires.
    const cfg = fixture({
      providers: {
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
          training: { platform: 'claude', model: 'claude-haiku-4-5-20251001' },
        },
      },
    });

    // Old-shape patch omits training — it should be dropped.
    await saveSettings(cfg, {
      advanced: {
        modes: {
          evaluate: { platform: 'codex', model: 'gpt-5.5' },
        },
      },
    });

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.evaluate).toEqual({ platform: 'codex', model: 'gpt-5.5' });
    expect(reloaded.providers.modes.training).toBeUndefined();
  });
});

describe('saveSettings — providers.models wholesale replace', () => {
  it('clearing screen mode also clears the legacy providers.models.screen key', async () => {
    // Reproduces the user's bug: legacy `providers.models.screen` resurrects
    // `providers.modes.screen` on every load via migrateLegacyModels(). The
    // fix: the Settings form ALSO clears the legacy key, and saveSettings
    // wholesale-replaces `providers.models` so the empty patch actually
    // strips the on-disk key (deep-merge alone wouldn't delete it).
    const cfg = fixture({
      providers: {
        models: { screen: 'claude-haiku-4-5-20251001', batch: 'claude-sonnet-4-6' },
        modes: { screen: { platform: 'claude', model: 'claude-haiku-4-5-20251001' } },
      },
    });

    // Simulate the form sending cleared values for both screen entries.
    // batch is preserved (user didn't touch it).
    await saveSettings(cfg, {
      providers: {
        modes: {},
        models: { batch: 'claude-sonnet-4-6' },
      },
    });

    const written = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const writtenProviders = written.providers as Record<string, unknown>;
    const writtenModels = writtenProviders.models as Record<string, unknown> | undefined;
    const writtenModes = writtenProviders.modes as Record<string, unknown> | undefined;
    expect(writtenModels?.screen).toBeUndefined();
    expect(writtenModes?.screen).toBeUndefined();
    // batch is preserved.
    expect(writtenModels?.batch).toBe('claude-sonnet-4-6');
  });

  it('round-trip: clear screen mode → reload → does NOT resurrect from legacy key', async () => {
    // Without the wholesale-replace for `providers.models`, the deep-merge
    // would leave `models.screen` on disk, and migrateLegacyModels() would
    // re-synthesize `modes.screen` on the next load — the exact bug the
    // user hit.
    const cfg = fixture({
      providers: {
        models: { screen: 'claude-haiku-4-5-20251001' },
        modes: { screen: { platform: 'claude', model: 'claude-haiku-4-5-20251001' } },
      },
    });

    // User clears screen — patch sends both maps empty (sanitizer stripped
    // empty `models.screen` and partial `modes.screen`).
    await saveSettings(cfg, {
      providers: { modes: {}, models: {} },
    });

    // Reload — migration shouldn't have anything to synthesize from.
    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.modes.screen).toBeUndefined();
  });

  it('LEAVES on-disk providers.models untouched when the patch omits it', async () => {
    // Mirror of the `modes` equivalent: the wholesale-replace must ONLY
    // fire when `models` is in the patch. Otherwise unrelated saves (e.g.
    // changing `default_provider`) would wipe legacy model aliases.
    const cfg = fixture({
      providers: {
        default_provider: 'claude',
        models: { screen: 'claude-haiku-4-5-20251001', batch: 'claude-sonnet-4-6' },
      },
    });

    await saveSettings(cfg, {
      providers: {
        default_provider: 'codex',
        // no `models` key at all
      },
    });

    const onDisk = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const providers = onDisk.providers as Record<string, unknown>;
    const models = providers.models as Record<string, unknown>;
    expect(models?.screen).toBe('claude-haiku-4-5-20251001');
    expect(models?.batch).toBe('claude-sonnet-4-6');
  });
});

describe('saveSettings — providers.fallback null sentinel (disable global fallback)', () => {
  it('a present-but-null providers.fallback removes the persisted key on disk', async () => {
    // Reproduces the "None can never stick" bug: the form's sanitizer used to
    // DELETE the blank fallback from the patch, and an absent key is a
    // deep-merge no-op — so the on-disk pair survived every save and
    // reappeared on reload. The null sentinel must actually delete it.
    const cfg = fixture({
      providers: {
        default_provider: 'claude',
        fallback: { platform: 'codex', model: 'gpt-5.5' },
      },
    });

    await saveSettings(cfg, { providers: { fallback: null } });

    // The persisted YAML must simply lack the key (never `fallback: null`).
    const onDisk = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const providers = onDisk.providers as Record<string, unknown>;
    expect('fallback' in providers).toBe(false);

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.fallback).toBeUndefined();
    // Sibling fields survive the targeted delete.
    expect(reloaded.providers.default_provider).toBe('claude');
  });

  it('LEAVES the on-disk fallback untouched when the patch omits the key (deep-merge no-op)', async () => {
    const cfg = fixture({
      providers: {
        fallback: { platform: 'codex', model: 'gpt-5.5' },
      },
    });

    await saveSettings(cfg, { providers: { default_provider: 'codex' } });

    const reloaded = await loadSettings(cfg);
    expect(reloaded.providers.fallback).toEqual({ platform: 'codex', model: 'gpt-5.5' });
  });

  it('round-trip: set fallback → save null → reload returns no fallback', async () => {
    // Matches the UI flow end-to-end (both save paths — the Server Action and
    // PATCH /api/settings — funnel through this same saveSettings call):
    //   1. Pick a fallback pair → persisted
    //   2. Pick "None" → sanitizer sends `fallback: null` → key deleted
    //   3. Reload → fallback stays gone instead of resurrecting from disk.
    const cfg = fixture({});

    await saveSettings(cfg, {
      providers: { fallback: { platform: 'codex', model: 'gpt-5.5' } },
    });
    let reloaded = await loadSettings(cfg);
    expect(reloaded.providers.fallback).toEqual({ platform: 'codex', model: 'gpt-5.5' });

    await saveSettings(cfg, { providers: { fallback: null } });
    reloaded = await loadSettings(cfg);
    expect(reloaded.providers.fallback).toBeUndefined();
  });

  it('null sentinel is a safe no-op when no fallback is persisted', async () => {
    const cfg = fixture({ providers: { default_provider: 'claude' } });

    const saved = await saveSettings(cfg, { providers: { fallback: null } });
    expect(saved.providers.fallback).toBeUndefined();

    const onDisk = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    const providers = onDisk.providers as Record<string, unknown>;
    expect('fallback' in providers).toBe(false);
  });
});

describe('saveSettings — unparseable existing file must not be replaced with defaults', () => {
  it('throws and leaves the broken file untouched when config.yml fails to parse', async () => {
    const cfg = fixture({});
    // Hand-edited file with a YAML syntax error — loadSettings falls back to
    // defaults for reads, but a save must REFUSE rather than persist that
    // fallback (which would silently wipe every other hand-edited setting).
    const broken = 'providers:\n  default_provider: [unclosed\n';
    writeFileSync(cfg, broken);

    await expect(saveSettings(cfg, { appearance: { theme: 'dark' } })).rejects.toThrow(
      /refusing to save settings/,
    );
    expect(readFileSync(cfg, 'utf-8')).toBe(broken);
  });

  it('still proceeds from defaults when the file is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sur9e-settings-missing-'));
    const cfg = join(root, 'inputs/config/config.yml');

    const saved = await saveSettings(cfg, { appearance: { theme: 'dark' } });
    expect(saved.appearance.theme).toBe('dark');
    const onDisk = yaml.load(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    expect((onDisk.appearance as Record<string, unknown>).theme).toBe('dark');
  });
});
