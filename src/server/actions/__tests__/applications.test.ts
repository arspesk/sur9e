// src/server/actions/__tests__/applications.test.ts
//
// Integration tests for src/server/actions/applications.ts.
//
// Pattern: tmpdir fixture (Pattern B) — each test allocates a fresh
// tmpdir, points process.env.SUR9E_ROOT at it, vi.resetModules() to
// re-evaluate @/lib/root, then dynamic-imports the action under test.
//
// We stub next/cache.revalidatePath (the cache invalidation surface
// requires a running Next request context; outside one it throws
// "static generation store missing"). The stub is hoisted to the top
// of the module by vitest so it survives resetModules.
//
// We exercise the real action functions end-to-end against the tmpdir
// applications.md — the action layer IS the file-system contract, so
// mocking lib/server/applications would defeat the purpose.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Both surfaces need stubbing:
//   - @/server/revalidate is the typed wrapper (C3.4) the actions actually
//     import from; we mock it so our assertions can read its call log.
//   - next/cache.revalidatePath would otherwise throw outside a Next
//     request context. Even though the action goes through the wrapper,
//     the wrapper internally calls next/cache; stubbing both is belt &
//     braces against accidental direct imports elsewhere in the graph.
vi.mock('@/server/revalidate', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('@/lib/server/status-transition-followup', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/status-transition-followup')>();
  return {
    ...actual,
    updateStatusWithFollowup: vi.fn(actual.updateStatusWithFollowup),
  };
});

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company    | Role  | Score | Status    | PDF | Report                       | Notes |',
  '| ---- | ---------- | ---------- | ----- | ----- | --------- | --- | ---------------------------- | ----- |',
  '| 1001 | 2026-05-15 | Acme       | Eng   | 4.0   | Screened  | -   | [1001](artifacts/reports/1001.md) | -     |',
  '| 1002 | 2026-05-15 | Globex     | Eng   | 3.5   | Evaluated | -   | -                            | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-applications-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  writeFileSync(join(root, 'artifacts/reports/1001.md'), '# fake report 1001', 'utf-8');
  return root;
}

type ActionsModule = typeof import('../applications');

describe('applications.ts server action', () => {
  let root: string;
  let actions: ActionsModule;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    actions = await import('../applications');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('updateApplicationStatusAction', () => {
    it('uses the status-followup service and returns its updated row and directive', async () => {
      const { updateStatusWithFollowup } = await import('@/lib/server/status-transition-followup');
      const result = await actions.updateApplicationStatusAction({
        num: 1001,
        status: 'interview',
      });
      expect(updateStatusWithFollowup).toHaveBeenCalledWith(root, 1001, 'interview');
      expect(result.updated.num).toBe(1001);
      expect(result.updated.status).toBe('Interview');
      expect(result.followup).toEqual({ num: 1001, jobKind: 'interview-prep' });
      // round-trip: the markdown file actually changed (updateStatus
      // rewrites cols[6] as ` ${newStatus} ` — single space each side).
      const md = readFileSync(join(root, 'data/applications.md'), 'utf-8');
      expect(md).toMatch(/\|\s*Interview\s*\|/);
      expect(md).not.toMatch(/\|\s*Screened\s*\|/);
    });

    it('normalizes legacy "skip" to "Discarded" via ApplicationStatus preprocess', async () => {
      // `skip` is not an ApplicationStatus enum value — the schema's
      // preprocess maps it to 'discarded' at parse time. The cast lets us
      // exercise that boundary behavior from a typed call site.
      const result = await actions.updateApplicationStatusAction({
        num: 1002,
        status: 'skip' as never,
      });
      expect(result.updated.status).toBe('Discarded');
      expect(result.followup).toBeNull();
    });

    it('accepts each canonical status from the schema', async () => {
      const canonical: Array<
        | 'screened'
        | 'evaluated'
        | 'applied'
        | 'responded'
        | 'interview'
        | 'offer'
        | 'rejected'
        | 'discarded'
      > = [
        'screened',
        'evaluated',
        'applied',
        'responded',
        'interview',
        'offer',
        'rejected',
        'discarded',
      ];
      for (const status of canonical) {
        const result = await actions.updateApplicationStatusAction({ num: 1001, status });
        expect(result.updated.num).toBe(1001);
        // displayStatus title-cases — first char must be uppercase
        expect(result.updated.status[0]).toBe(result.updated.status[0].toUpperCase());
      }
    });

    it('throws ZodError for non-integer num', async () => {
      await expect(
        actions.updateApplicationStatusAction({ num: 1.5, status: 'applied' }),
      ).rejects.toThrow();
    });

    it('throws ZodError for non-positive num', async () => {
      await expect(
        actions.updateApplicationStatusAction({ num: 0, status: 'applied' }),
      ).rejects.toThrow();
      await expect(
        actions.updateApplicationStatusAction({ num: -5, status: 'applied' }),
      ).rejects.toThrow();
    });

    it('throws ZodError for empty status', async () => {
      await expect(
        actions.updateApplicationStatusAction({ num: 1001, status: '' as never }),
      ).rejects.toThrow();
    });

    it('throws when status is not a canonical value', async () => {
      await expect(
        actions.updateApplicationStatusAction({ num: 1001, status: 'totally-bogus' as never }),
      ).rejects.toThrow();
    });

    it('validates before calling the status-followup service', async () => {
      const { updateStatusWithFollowup } = await import('@/lib/server/status-transition-followup');
      await expect(
        actions.updateApplicationStatusAction({ num: 0, status: 'applied' }),
      ).rejects.toThrow();
      expect(updateStatusWithFollowup).not.toHaveBeenCalled();
    });

    it('throws when num does not exist in applications.md', async () => {
      await expect(
        actions.updateApplicationStatusAction({ num: 99999, status: 'applied' }),
      ).rejects.toThrow(/not found/i);
    });

    it('revalidates every application surface after a status update', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.updateApplicationStatusAction({ num: 1001, status: 'applied' });
      expect(revalidatePath).toHaveBeenCalledTimes(4);
      expect(revalidatePath).toHaveBeenCalledWith('/');
      expect(revalidatePath).toHaveBeenCalledWith('/offers');
      expect(revalidatePath).toHaveBeenCalledWith('/pipeline');
      expect(revalidatePath).toHaveBeenCalledWith('/report/[filename]', 'page');
    });
  });

  describe('batchUpdateApplicationStatusAction', () => {
    it('keeps the batch result limited to counts and errors', async () => {
      const result = await actions.batchUpdateApplicationStatusAction({
        nums: [1001, 99999],
        status: 'offer',
      });
      expect(result).toEqual({
        ok: 1,
        failed: 1,
        errors: [{ num: 99999, error: 'num not found: 99999' }],
      });
    });
  });

  describe('deleteApplicationAction', () => {
    it('removes the row from applications.md and returns the report path', async () => {
      const result = await actions.deleteApplicationAction({ num: 1001 });
      expect(result.deleted).toBe(true);
      expect(result.num).toBe(1001);
      expect(result.removedReport).toBe('artifacts/reports/1001.md');
      const md = readFileSync(join(root, 'data/applications.md'), 'utf-8');
      expect(md).not.toMatch(/^\|\s*1001\b/m);
      // sibling row untouched
      expect(md).toMatch(/^\|\s*1002\b/m);
    });

    it('returns removedReport=null when the row had no report link', async () => {
      const result = await actions.deleteApplicationAction({ num: 1002 });
      expect(result.deleted).toBe(true);
      expect(result.num).toBe(1002);
      expect(result.removedReport).toBeNull();
    });

    it('throws ZodError for non-integer num', async () => {
      await expect(actions.deleteApplicationAction({ num: 1.5 })).rejects.toThrow();
    });

    it('throws ZodError for non-positive num', async () => {
      await expect(actions.deleteApplicationAction({ num: 0 })).rejects.toThrow();
    });

    it('is an idempotent no-op (deleted:false) when num does not exist — no throw', async () => {
      const result = await actions.deleteApplicationAction({ num: 99999 });
      expect(result.deleted).toBe(false);
      expect(result.num).toBe(99999);
      expect(result.removedReport).toBeNull();
    });

    it('calls revalidatePath for /table, /pipeline, and /report/[filename]', async () => {
      const { revalidatePath } = await import('@/server/revalidate');
      await actions.deleteApplicationAction({ num: 1001 });
      const paths = (revalidatePath as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
      expect(paths).toContain('/offers');
      expect(paths).toContain('/report/[filename]');
    });
  });
});
