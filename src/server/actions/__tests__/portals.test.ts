// src/server/actions/__tests__/portals.test.ts
//
// Integration tests for src/server/actions/portals.ts against a temp ROOT —
// never the user's real inputs/personalization/portals.yml.
//
// portals.ts captures ROOT at module-load time, so the env-var +
// vi.resetModules() + dynamic-import pattern (same as settings.test.ts)
// retargets it per test.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/revalidate', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// The real tracked example file — copied into each temp ROOT so the import
// action has something to import.
const EXAMPLE_PORTALS = join(
  process.cwd(),
  'content',
  'examples',
  'personalization',
  'portals.yml',
);

function seedRoot(opts?: { withExample?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-portals-test-'));
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  if (opts?.withExample !== false) {
    mkdirSync(join(root, 'content/examples/personalization'), { recursive: true });
    copyFileSync(EXAMPLE_PORTALS, join(root, 'content/examples/personalization/portals.yml'));
  }
  return root;
}

type ActionsModule = typeof import('../portals');

describe('portals.ts server actions', () => {
  let root: string;
  let actions: ActionsModule;

  async function loadActions(seededRoot: string): Promise<void> {
    root = seededRoot;
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    actions = await import('../portals');
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('loadPortalsAction', () => {
    it('returns null when portals.yml does not exist', async () => {
      await loadActions(seedRoot());
      expect(await actions.loadPortalsAction()).toBeNull();
    });
  });

  describe('savePortalsAction', () => {
    it('round-trips the shape through disk', async () => {
      await loadActions(seedRoot());
      const shape = {
        tracked_companies: [
          {
            name: 'Anthropic',
            careers_url: 'https://job-boards.greenhouse.io/anthropic',
            api: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs',
            enabled: true,
          },
          { name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral' },
        ],
      };
      const result = await actions.savePortalsAction(shape);
      expect(result.ok).toBe(true);
      expect(result.portals).toEqual(shape);
      // Re-read from disk via the action's own read path.
      expect(await actions.loadPortalsAction()).toEqual(shape);
      // And raw from disk — yaml round-trip, no extra wrapper.
      const onDisk = yaml.load(
        readFileSync(join(root, 'inputs/personalization/portals.yml'), 'utf-8'),
      );
      expect(onDisk).toEqual(shape);
    });

    it('preserves passthrough extra keys on round-trip', async () => {
      await loadActions(seedRoot());
      const shape = {
        tracked_companies: [
          { name: 'X', careers_url: 'https://jobs.lever.co/x', scan_method: 'legacy' },
        ],
        salary_filter: { min: 100 },
      };
      await actions.savePortalsAction(shape);
      expect(await actions.loadPortalsAction()).toEqual(shape);
    });

    it('rejects a shape that violates the schema', async () => {
      await loadActions(seedRoot());
      await expect(
        actions.savePortalsAction({ tracked_companies: [{ name: 42 }] }),
      ).rejects.toThrow();
    });

    it('revalidates /settings', async () => {
      await loadActions(seedRoot());
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.savePortalsAction({ tracked_companies: [] });
      const paths = (revalidatePath as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
      expect(paths).toContain('/settings');
    });
  });

  describe('importExamplePortalsAction', () => {
    it('imports the example list when portals.yml is missing', async () => {
      await loadActions(seedRoot());
      const result = await actions.importExamplePortalsAction();
      expect(result.ok).toBe(true);
      expect(result.portals.tracked_companies.length).toBeGreaterThan(0);
      expect(await actions.loadPortalsAction()).toEqual(result.portals);
    });

    it('imports when portals.yml exists but tracked_companies is empty', async () => {
      await loadActions(seedRoot());
      await actions.savePortalsAction({ tracked_companies: [] });
      const result = await actions.importExamplePortalsAction();
      expect(result.portals.tracked_companies.length).toBeGreaterThan(0);
    });

    it('refuses when tracked_companies is non-empty (never an overwrite)', async () => {
      await loadActions(seedRoot());
      const existing = {
        tracked_companies: [{ name: 'Mine', careers_url: 'https://jobs.lever.co/mine' }],
      };
      await actions.savePortalsAction(existing);
      await expect(actions.importExamplePortalsAction()).rejects.toThrow(/refusing/i);
      // The user's list is untouched.
      expect(await actions.loadPortalsAction()).toEqual(existing);
    });

    it('throws a clear error when the example file is missing', async () => {
      await loadActions(seedRoot({ withExample: false }));
      await expect(actions.importExamplePortalsAction()).rejects.toThrow(/example portals file/i);
    });
  });
});
