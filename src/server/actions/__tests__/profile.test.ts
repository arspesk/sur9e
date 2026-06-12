// src/server/actions/__tests__/profile.test.ts
//
// Integration tests for src/server/actions/profile.ts.
//
// Pattern: tmpdir fixture (Pattern B) per the precedent set in
// src/lib/server/__tests__/applications-schema.test.ts. Each test
// allocates a fresh tmpdir, points process.env.SUR9E_ROOT at it,
// vi.resetModules() to re-evaluate @/lib/root, then dynamic-imports
// the action under test.

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

const SEED_PROFILE: Record<string, unknown> = {
  candidate: {
    full_name: 'Test User',
    email: 'test@example.com',
  },
  search: {
    terms: ['engineer'],
    locations: ['Remote'],
  },
};

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-profile-test-'));
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), yaml.dump(SEED_PROFILE), 'utf-8');
  // Seed empty md files so saveProfileMarkdownAction's write target exists.
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# placeholder', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/narrative.md'), '# placeholder', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/article-digest.md'), '# placeholder', 'utf-8');
  return root;
}

type ActionsModule = typeof import('../profile');

describe('profile.ts server action', () => {
  let root: string;
  let actions: ActionsModule;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    actions = await import('../profile');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('saveProfileAction', () => {
    it('updates a single top-level profile key (candidate)', async () => {
      const result = await actions.saveProfileAction({
        candidate: { full_name: 'Renamed User', email: 'new@example.com' },
      });
      expect(result).toEqual({ ok: true, profileChanged: true });
      const onDisk = yaml.load(
        readFileSync(join(root, 'inputs/personalization/profile.yml'), 'utf-8'),
      ) as Record<string, unknown>;
      const candidate = onDisk.candidate as Record<string, unknown>;
      expect(candidate.full_name).toBe('Renamed User');
      expect(candidate.email).toBe('new@example.com');
      // sibling top-level untouched
      const search = onDisk.search as Record<string, unknown>;
      expect(search.terms).toEqual(['engineer']);
    });

    it('full-replaces a top-level key (no deep merge for profile)', async () => {
      await actions.saveProfileAction({
        search: { terms: ['platform engineer'], locations: ['EU'] },
      });
      const onDisk = yaml.load(
        readFileSync(join(root, 'inputs/personalization/profile.yml'), 'utf-8'),
      ) as Record<string, unknown>;
      const search = onDisk.search as Record<string, unknown>;
      // full-replace — original 'engineer' is gone
      expect(search.terms).toEqual(['platform engineer']);
      expect(search.locations).toEqual(['EU']);
    });

    it('returns { profileChanged:false } for an empty patch', async () => {
      const result = await actions.saveProfileAction({});
      expect(result).toEqual({ ok: true, profileChanged: false });
    });

    it('ignores unknown top-level keys (not in PROFILE_TOP_KEYS)', async () => {
      const result = await actions.saveProfileAction({
        // 'foo' isn't in PROFILE_TOP_KEYS — should be a no-op
        foo: { bar: 'baz' },
      });
      expect(result.profileChanged).toBe(false);
    });

    it('throws when patch is not an object', async () => {
      // The action explicitly guards `!patch || typeof patch !== 'object'`.
      await expect(
        actions.saveProfileAction(null as unknown as Record<string, unknown>),
      ).rejects.toThrow();
    });

    it('throws when ProfileShape rejects the merged profile shape', async () => {
      // ProfileShape.candidate.full_name is required when candidate is
      // present — pass a candidate object without full_name to trip the
      // schema parse inside saveProfile.
      await expect(
        actions.saveProfileAction({
          candidate: { email: 'no-name@example.com' },
        }),
      ).rejects.toThrow();
    });

    it('calls revalidatePath for /profile when any file changes', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.saveProfileAction({ candidate: { full_name: 'X' } });
      const paths = (revalidatePath as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
      expect(paths).toContain('/profile');
    });

    it('does NOT call revalidatePath when nothing changed', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.saveProfileAction({});
      expect((revalidatePath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    });
  });

  describe('saveProfileMarkdownAction', () => {
    it.each([
      ['cv', 'inputs/personalization/cv.md'],
      ['narrative', 'inputs/personalization/narrative.md'],
      ['article-digest', 'inputs/personalization/article-digest.md'],
    ])('writes %s content to %s', async (name, relPath) => {
      const content = `# Hello from ${name}\n`;
      const result = await actions.saveProfileMarkdownAction({ name, content });
      expect(result).toEqual({ ok: true });
      expect(readFileSync(join(root, relPath), 'utf-8')).toBe(content);
    });

    it('rejects an unknown name', async () => {
      await expect(
        actions.saveProfileMarkdownAction({ name: 'unknown', content: 'x' }),
      ).rejects.toThrow(/unknown md file/i);
      // and didn't accidentally write anything
      expect(existsSync(join(root, 'inputs/personalization/unknown.md'))).toBe(false);
    });

    it('rejects path-traversal attempts in name', async () => {
      // MD_FILES is a fixed lookup so '../foo' resolves to undefined → throw.
      await expect(
        actions.saveProfileMarkdownAction({ name: '../etc/passwd', content: 'x' }),
      ).rejects.toThrow(/unknown md file/i);
    });

    it('calls revalidatePath for /profile after writing', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.saveProfileMarkdownAction({ name: 'cv', content: 'hi' });
      const paths = (revalidatePath as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
      expect(paths).toContain('/profile');
    });
  });
});
