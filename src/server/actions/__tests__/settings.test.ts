// src/server/actions/__tests__/settings.test.ts
//
// Integration tests for src/server/actions/settings.ts.
//
// settings.ts captures SETTINGS_PATH = join(ROOT, 'inputs', 'config',
// 'config.yml') at module-load time. The env-var + vi.resetModules() +
// dynamic-import pattern is the only way to retarget per test.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/revalidate', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

function seedRoot(initial?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-settings-test-'));
  mkdirSync(join(root, 'inputs/config'), { recursive: true });
  if (initial) {
    writeFileSync(join(root, 'inputs/config/config.yml'), yaml.dump(initial), 'utf-8');
  }
  return root;
}

type ActionsModule = typeof import('../settings');

describe('settings.ts server action', () => {
  let root: string;
  let actions: ActionsModule;

  async function loadActions(): Promise<void> {
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    actions = await import('../settings');
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('loadSettingsAction', () => {
    beforeEach(async () => {
      root = seedRoot({
        appearance: { theme: 'dark' },
        screening: { smoke_test_limit: 7 },
      });
      await loadActions();
    });

    it('returns the persisted settings', async () => {
      const result = await actions.loadSettingsAction();
      expect(result.appearance.theme).toBe('dark');
      expect(result.screening.smoke_test_limit).toBe(7);
    });

    it('fills in schema defaults for keys missing from disk', async () => {
      const result = await actions.loadSettingsAction();
      // scanning/jobspy.hours_old defaults to 168 when absent
      expect(result.scanning.jobspy.hours_old).toBe(168);
      // advanced.score_threshold defaults to 3
      expect(result.advanced.score_threshold).toBe(3);
    });

    it('does NOT call revalidatePath (read-only action)', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.loadSettingsAction();
      expect((revalidatePath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });
  });

  describe('loadSettingsAction without an existing config.yml', () => {
    beforeEach(async () => {
      root = seedRoot(); // no config file written
      await loadActions();
    });

    it('returns the fully-defaulted SettingsShape', async () => {
      const result = await actions.loadSettingsAction();
      expect(result.appearance.theme).toBe('system');
      expect(result.screening.smoke_test_limit).toBe(0);
      expect(result.scanning.jobspy.hours_old).toBe(168);
    });
  });

  describe('saveSettingsAction', () => {
    beforeEach(async () => {
      root = seedRoot({
        appearance: { theme: 'system' },
        scanning: { jobspy: { hours_old: 168 } },
      });
      await loadActions();
    });

    it('deep-merges a partial patch into config.yml and returns the new shape', async () => {
      const result = await actions.saveSettingsAction({
        appearance: { theme: 'dark' },
      });
      expect(result.ok).toBe(true);
      expect(result.settings.appearance.theme).toBe('dark');
      // round-trip: re-read from disk
      const onDisk = yaml.load(
        readFileSync(join(root, 'inputs/config/config.yml'), 'utf-8'),
      ) as Record<string, unknown>;
      const appearance = onDisk.appearance as Record<string, unknown>;
      expect(appearance.theme).toBe('dark');
    });

    it('deep-merges nested settings without dropping sibling leaves', async () => {
      await actions.saveSettingsAction({
        scanning: { jobspy: { hours_old: 24 } },
      });
      const reloaded = await actions.loadSettingsAction();
      expect(reloaded.scanning.jobspy.hours_old).toBe(24);
      // results_wanted survives — the deep merge only overwrote hours_old
      expect(reloaded.scanning.jobspy.results_wanted).toBe(1000);
    });

    it('rejects values that violate the SettingsShape (out-of-range enum)', async () => {
      // appearance.theme is z.enum(['system','light','dark']) — 'neon' must fail.
      await expect(actions.saveSettingsAction({ appearance: { theme: 'neon' } })).rejects.toThrow();
    });

    it('rejects values that violate numeric bounds', async () => {
      // advanced.score_threshold is z.number().min(0).max(5) —
      // 99 trips the upper bound check at the save boundary.
      await expect(
        actions.saveSettingsAction({ advanced: { score_threshold: 99 } }),
      ).rejects.toThrow();
    });

    it('creates the inputs/config directory if it does not yet exist', async () => {
      rmSync(join(root, 'inputs/config'), { recursive: true, force: true });
      expect(existsSync(join(root, 'inputs/config'))).toBe(false);
      const result = await actions.saveSettingsAction({ appearance: { theme: 'dark' } });
      expect(result.ok).toBe(true);
      expect(existsSync(join(root, 'inputs/config/config.yml'))).toBe(true);
    });

    it('calls revalidatePath for /settings, /table, and /analytics', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.saveSettingsAction({ appearance: { theme: 'dark' } });
      const paths = (revalidatePath as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
      expect(paths).toContain('/settings');
      expect(paths).toContain('/offers');
      expect(paths).toContain('/analytics');
    });
  });

  describe('providers registry cache', () => {
    it('save clears the registry cache so mode resolution sees the new settings', async () => {
      root = seedRoot({
        providers: { default_provider: 'claude', default_model: 'claude-sonnet-4-6' },
      });
      mkdirSync(join(root, 'content/modes'), { recursive: true });
      await loadActions();
      const registry = await import('@/lib/server/providers/registry');

      // Prime the registry's module-level config cache.
      expect(registry.resolveModeRuntime(root, 'evaluate').provider).toBe('claude');

      // Reroute via the action — without clearProvidersCache the registry
      // would keep serving the boot-time config until server restart.
      await actions.saveSettingsAction({
        providers: {
          default_provider: 'opencode',
          default_model: 'opencode/deepseek-v4-flash-free',
        },
      });
      expect(registry.resolveModeRuntime(root, 'evaluate').provider).toBe('opencode');
    });
  });
});
