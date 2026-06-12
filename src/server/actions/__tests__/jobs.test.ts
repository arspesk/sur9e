// src/server/actions/__tests__/jobs.test.ts
//
// Integration tests for src/server/actions/jobs.ts.
//
// Pattern: tmpdir fixture (Pattern B) + env-var SUR9E_ROOT +
// vi.resetModules() + dynamic import.
//
// Two extra mocks vs the other action tests:
//   - @/lib/server/jobs/runner.spawnJob is stubbed so createJob's
//     `setImmediate(() => spawnJob(...))` never forks a real shell
//     command. Without this, the deferred spawn fires AFTER the test
//     returns (possibly during the NEXT test) and runs node CLI
//     processes against the tmpdir — flaky + pollutes test output.
//   - next/cache stays stubbed even though jobs.ts has no
//     revalidatePath call (per its source comment) — belt & braces
//     against accidental indirect imports.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnJobMock = vi.fn();

vi.mock('@/lib/server/jobs/runner', () => ({
  spawnJob: spawnJobMock,
}));
vi.mock('@/server/revalidate', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'actions-jobs-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'data/jobs'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  // startJobAction's first-run preflight (onboarding-status.ts) refuses to
  // queue anything until cv.md + profile.yml exist — seed both so the
  // fixture represents a set-up install.
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  return root;
}

/** Persist a JobRecord-shaped json into data/jobs/<id>.json. */
function seedJob(
  root: string,
  partial: { type: string; status: 'queued' | 'running' | 'done' | 'error' },
): string {
  const id = '0000000000000001';
  const record = {
    id,
    type: partial.type,
    status: partial.status,
    params: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
  };
  writeFileSync(join(root, `data/jobs/${id}.json`), JSON.stringify(record, null, 2), 'utf-8');
  return id;
}

/** Flush the setImmediate that defers spawnJob. */
async function flushImmediate(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

type ActionsModule = typeof import('../jobs');

describe('jobs.ts server action', () => {
  let root: string;
  let actions: ActionsModule;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    actions = await import('../jobs');
    spawnJobMock.mockReset();
  });

  afterEach(async () => {
    // Drain any pending setImmediate (spawnJob) before the next test resets
    // the mock — otherwise call counts leak from one test into the next.
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
    spawnJobMock.mockReset();
  });

  describe('startJobAction — per-num kinds', () => {
    const PER_NUM_KINDS = [
      'evaluate',
      'tailor-cv',
      'cover-letter',
      'research',
      'interview-prep',
      'reach-out',
    ] as const;

    it.each(
      PER_NUM_KINDS,
    )('creates a queued job record for kind=%s when num exists', async kind => {
      const result = await actions.startJobAction({ kind, params: { num: 1001 } });
      expect('conflict' in result).toBe(false);
      if ('conflict' in result) return;
      expect(result.type).toBe(kind);
      expect(result.status).toBe('queued');
      expect(result.params.num).toBe(1001);
      // file actually written
      const files = readdirSync(join(root, 'data/jobs')).filter(f => f.endsWith('.json'));
      expect(files.length).toBe(1);
      const persisted = JSON.parse(readFileSync(join(root, 'data/jobs', files[0]), 'utf-8'));
      expect(persisted.id).toBe(result.id);
      expect(persisted.type).toBe(kind);
      // spawn was scheduled
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
      expect(spawnJobMock.mock.calls[0][1].id).toBe(result.id);
    });

    it('rejects per-num kinds when num is missing', async () => {
      await expect(actions.startJobAction({ kind: 'evaluate', params: {} })).rejects.toThrow(
        /missing or non-integer num/,
      );
    });

    it('rejects per-num kinds when num is not an integer', async () => {
      await expect(
        actions.startJobAction({ kind: 'evaluate', params: { num: 'not-a-number' } }),
      ).rejects.toThrow(/missing or non-integer num/);
    });

    it('rejects per-num kinds when num does not exist in applications.md', async () => {
      await expect(
        actions.startJobAction({ kind: 'evaluate', params: { num: 99999 } }),
      ).rejects.toThrow(/num not found: 99999/);
      // and didn't write any job
      expect(readdirSync(join(root, 'data/jobs')).length).toBe(0);
    });
  });

  describe('startJobAction — screen kind', () => {
    it('creates a queued job for a valid https URL', async () => {
      const result = await actions.startJobAction({
        kind: 'screen',
        params: { url: 'https://example.com/jobs/123' },
      });
      expect('conflict' in result).toBe(false);
      if ('conflict' in result) return;
      expect(result.type).toBe('screen');
      expect(result.status).toBe('queued');
      expect(result.params.url).toBe('https://example.com/jobs/123');
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('creates a queued job for a valid http URL', async () => {
      const result = await actions.startJobAction({
        kind: 'screen',
        params: { url: 'http://example.com/jobs/123' },
      });
      expect('conflict' in result).toBe(false);
    });

    it('allows a url-less screen (queue mode — screen all pending)', async () => {
      const result = await actions.startJobAction({ kind: 'screen', params: {} });
      expect('conflict' in result).toBe(false);
    });

    it('rejects a url-less screen-evaluate (a specific offer is required)', async () => {
      await expect(actions.startJobAction({ kind: 'screen-evaluate', params: {} })).rejects.toThrow(
        /url must start with http/,
      );
    });

    it('rejects non-http URLs', async () => {
      await expect(
        actions.startJobAction({
          kind: 'screen',
          params: { url: 'ftp://example.com/x' },
        }),
      ).rejects.toThrow(/url must start with http/);
    });

    it('rejects non-string url', async () => {
      await expect(actions.startJobAction({ kind: 'screen', params: { url: 42 } })).rejects.toThrow(
        /url must start with http/,
      );
    });
  });

  describe('startJobAction — singleton kinds (scan / batch-evaluate)', () => {
    it('creates a queued scan job when no active scan exists', async () => {
      const result = await actions.startJobAction({ kind: 'scan' });
      expect('conflict' in result).toBe(false);
      if ('conflict' in result) return;
      expect(result.type).toBe('scan');
      expect(result.status).toBe('queued');
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('returns { conflict: true } when an active scan already exists', async () => {
      const seededId = seedJob(root, { type: 'scan', status: 'queued' });
      const result = await actions.startJobAction({ kind: 'scan' });
      expect('conflict' in result).toBe(true);
      // 'job' narrows to the conflict payload specifically (the setup-required
      // payload also carries conflict:true but has no job).
      if (!('job' in result)) return;
      expect(result.conflict).toBe(true);
      expect(result.message).toMatch(/scan/i);
      expect(result.job.id).toBe(seededId);
      // no new job was created
      const files = readdirSync(join(root, 'data/jobs')).filter(f => f.endsWith('.json'));
      expect(files.length).toBe(1);
      // and spawn was NOT scheduled
      await flushImmediate();
      expect(spawnJobMock).not.toHaveBeenCalled();
    });

    it('returns { conflict: true } when a running scan already exists', async () => {
      seedJob(root, { type: 'scan', status: 'running' });
      const result = await actions.startJobAction({ kind: 'scan' });
      expect('conflict' in result).toBe(true);
    });

    it('does NOT conflict when only a finished (done) scan exists', async () => {
      seedJob(root, { type: 'scan', status: 'done' });
      const result = await actions.startJobAction({ kind: 'scan' });
      expect('conflict' in result).toBe(false);
    });

    it('conflicts across the screen.mjs family (batch-evaluate blocks scan)', async () => {
      // scan, screen, screen-evaluate, and batch-evaluate all run the
      // screen.mjs + merge-tracker chain over the same unlocked state
      // (pipeline.md, screened-urls.txt, tracker-additions/), so an active
      // batch-evaluate must block a new scan.
      seedJob(root, { type: 'batch-evaluate', status: 'running' });
      const result = await actions.startJobAction({ kind: 'scan' });
      expect('conflict' in result).toBe(true);
    });

    it('returns { conflict: true } when an active batch-evaluate exists', async () => {
      const seededId = seedJob(root, { type: 'batch-evaluate', status: 'running' });
      const result = await actions.startJobAction({ kind: 'batch-evaluate' });
      expect('conflict' in result).toBe(true);
      if (!('job' in result)) return;
      expect(result.message).toMatch(/batch evaluation/i);
      expect(result.job.id).toBe(seededId);
    });

    it('applies batch-evaluate defaults (parallel=4, min_score=3) when params omit them', async () => {
      const result = await actions.startJobAction({ kind: 'batch-evaluate' });
      expect('conflict' in result).toBe(false);
      if ('conflict' in result) return;
      expect(result.params.parallel).toBe(4);
      expect(result.params.min_score).toBe(3);
    });

    it('honors caller-supplied parallel + min_score for batch-evaluate', async () => {
      const result = await actions.startJobAction({
        kind: 'batch-evaluate',
        params: { parallel: 8, min_score: 4 },
      });
      expect('conflict' in result).toBe(false);
      if ('conflict' in result) return;
      expect(result.params.parallel).toBe(8);
      expect(result.params.min_score).toBe(4);
    });
  });

  describe('startJobAction — kind validation', () => {
    it('rejects an unknown kind via the zod enum', async () => {
      await expect(
        // intentionally bypass the static type — we're testing the zod boundary
        actions.startJobAction({ kind: 'nonsense' as never }),
      ).rejects.toThrow();
    });
  });
});
