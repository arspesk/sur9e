// src/lib/server/__tests__/jobs-runner-spawn-errors.test.ts
//
// Regression tests for spawnJob's pre-spawn failure path: an invalid
// per-run provider/model override must persist a readable status:'error'
// record instead of throwing out of the setImmediate callback (which left
// the record 'queued' forever and blocked singleton kinds), or stamping a
// bogus provider that makes JobRecord.parse fail on every read.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobRecord } from '../../schemas/jobs';
import { spawnJob } from '../jobs/runner';

function jobRecord(params: Record<string, unknown>): JobRecord {
  return {
    id: '0123456789abcdef',
    type: 'scan',
    status: 'queued',
    params,
    startedAt: '2026-06-09T00:00:00.000Z',
    finishedAt: null,
    output: '',
    error: null,
    exitCode: null,
  };
}

function readPersisted(root: string, id: string): JobRecord {
  // JobRecord.parse mirrors what getJob/findActiveJob do — the record must
  // survive the round-trip or the job turns invisible to the whole UI.
  return JobRecord.parse(JSON.parse(readFileSync(join(root, 'data/jobs', `${id}.json`), 'utf-8')));
}

describe('spawnJob — pre-spawn override failures', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-spawn-errors-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('persists a readable error record for an unknown platform override', async () => {
    const job = jobRecord({ platform: 'gemini', model: 'gemini-2.5-pro' });
    await spawnJob(root, job);
    const persisted = readPersisted(root, job.id);
    expect(persisted.status).toBe('error');
    expect(persisted.error).toContain('gemini');
    expect(persisted.provider).toBeUndefined();
  });

  it('persists a readable error record for an invalid model override', async () => {
    const job = jobRecord({ platform: 'claude', model: 'bad model; rm -rf /' });
    await spawnJob(root, job);
    const persisted = readPersisted(root, job.id);
    expect(persisted.status).toBe('error');
    expect(persisted.error).toBeTruthy();
  });

  it('persists a readable error record when config.yml resolves an unknown platform', async () => {
    // registry.ts level 2 casts mo.platform raw (loadConfigShallow skips the
    // settings schema) — the runner guard must catch it before the bogus
    // provider is stamped onto the record.
    mkdirSync(join(root, 'inputs/config'), { recursive: true });
    writeFileSync(
      join(root, 'inputs/config/config.yml'),
      'providers:\n  modes:\n    scan:\n      platform: gemini\n      model: gemini-2.5-pro\n',
    );
    const job = jobRecord({});
    await spawnJob(root, job);
    const persisted = readPersisted(root, job.id);
    expect(persisted.status).toBe('error');
    expect(persisted.error).toContain('gemini');
    expect(persisted.provider).toBeUndefined();
  });
});
