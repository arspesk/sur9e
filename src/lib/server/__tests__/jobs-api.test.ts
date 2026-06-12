// src/lib/server/__tests__/jobs-api.test.ts
//
// Parse-boundary tests for the typed jobs API. createJob persists to a
// tmp data/jobs/ directory — never touches the real one. The spawned
// subprocess is short-circuited by clearing PATH before each test so
// /bin/bash runs but can't find 'claude' or 'node', which makes the
// pipeline error out within ~10ms and avoids leaking child processes
// past test teardown.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobRecord } from '../../schemas/jobs';
import { activeJobsByType, createJob, findActiveJob, getJob, listActiveJobs } from '../jobs/api';

function makeTmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jobs-api-test-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'data/jobs'));
  mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 42 | 2026-05-06 | TestCo | Engineer | 4.0/5 | Evaluated | ❌ | [42](artifacts/reports/42-testco.md) | smoke |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'artifacts/reports/42-testco.md'),
    '**URL:** https://example.com/jobs/42\n\nbody\n',
  );
  return root;
}

// Poll the persisted job file until it reaches a terminal status or timeout.
async function waitForTerminal(root: string, jobId: string, timeoutMs = 1000) {
  const p = join(root, 'data/jobs', jobId + '.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    if (j.status === 'done' || j.status === 'error') return j;
  }
  return null;
}

describe('jobs/api — schema boundary', () => {
  let root: string;

  beforeEach(() => {
    root = makeTmpRoot();
    // Force the spawned bash subprocess to fail fast: with empty PATH,
    // 'claude' and 'node' (used inside the chained scripts) can't be
    // resolved. /bin/bash itself is invoked by absolute path so spawn()
    // still works.
    vi.stubEnv('PATH', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('createJob persists a queued/running record that parses through JobRecord', async () => {
    const job = createJob(root, 'tailor-cv', { num: 42 });
    expect(job.type).toBe('tailor-cv');
    expect(job.id).toHaveLength(16);
    expect(['queued', 'running']).toContain(job.status);

    // Re-parse with the schema to assert wrapper conformance.
    expect(() => JobRecord.parse(job)).not.toThrow();

    // File must be on disk for getJob to find it.
    const persistedPath = join(root, 'data/jobs', job.id + '.json');
    expect(existsSync(persistedPath)).toBe(true);

    // Wait for spawn to fail fast; otherwise the child can outlive cleanup.
    await waitForTerminal(root, job.id);
  });

  it('createJob with invalid num persists an error record', async () => {
    const job = createJob(root, 'tailor-cv', { num: 'oops' as unknown as number });
    // Poll instead of a fixed sleep — under full-suite parallel load a 50ms
    // nap raced the runner's error write and flaked the pre-commit gate
    // (same fix as jobs-outreach / jobs-buildcommand).
    const persisted = await waitForTerminal(root, job.id, 2000);
    expect(persisted?.status).toBe('error');
    expect(persisted?.error).toMatch(/invalid job/);
    expect(() => JobRecord.parse(persisted)).not.toThrow();
  });

  it('getJob returns null for an unknown id', () => {
    expect(getJob(root, 'doesnotexist0000')).toBeNull();
  });

  it('getJob returns the persisted record parsed through JobRecord', async () => {
    const job = createJob(root, 'research', { num: 42 });
    const reloaded = getJob(root, job.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.id).toBe(job.id);
    expect(reloaded?.type).toBe('research');
    expect(() => JobRecord.parse(reloaded)).not.toThrow();
    await waitForTerminal(root, job.id);
  });

  it('listActiveJobs returns every queued/running job of the given type', async () => {
    const a = createJob(root, 'research', { num: 42 });
    const b = createJob(root, 'research', { num: 42 });
    // Read the list immediately — both jobs are still queued or running.
    const active = listActiveJobs(root, 'research');
    expect(active.map(j => j.id).sort()).toEqual([a.id, b.id].sort());
    for (const j of active) {
      expect(['queued', 'running']).toContain(j.status);
      expect(() => JobRecord.parse(j)).not.toThrow();
    }
    await waitForTerminal(root, a.id);
    await waitForTerminal(root, b.id);
  });

  it('findActiveJob returns the most recent in-flight job of a type', async () => {
    const first = createJob(root, 'reach-out', { num: 42 });
    // Tiny pause so timestamps differ; otherwise the most-recent
    // tiebreaker is undefined.
    await new Promise(r => setTimeout(r, 5));
    const second = createJob(root, 'reach-out', { num: 42 });
    const latest = findActiveJob(root, 'reach-out');
    expect(latest).not.toBeNull();
    expect([first.id, second.id]).toContain(latest?.id);
    await waitForTerminal(root, first.id);
    await waitForTerminal(root, second.id);
  });

  it('legacy outreach active-job queries normalize to reach-out', async () => {
    const job = createJob(root, 'reach-out', { num: 42 });
    const latest = findActiveJob(root, 'outreach');
    const map = activeJobsByType(root, ['outreach']);
    expect(latest?.id).toBe(job.id);
    expect(latest?.type).toBe('reach-out');
    expect(map.outreach?.[0]?.id).toBe(job.id);
    await waitForTerminal(root, job.id);
  });

  it('activeJobsByType reshapes into the {type: [{id, num, startedAt}]} map', async () => {
    const job = createJob(root, 'tailor-cv', { num: 42 });
    const map = activeJobsByType(root, ['tailor-cv', 'cover-letter']);
    expect(map['tailor-cv']).toBeDefined();
    expect(map['cover-letter']).toEqual([]);
    expect(map['tailor-cv']?.[0]?.id).toBe(job.id);
    expect(map['tailor-cv']?.[0]?.num).toBe(42);
    await waitForTerminal(root, job.id);
  });

  it('activeJobsByType keeps num-less system jobs (scan) — no num field, not dropped', () => {
    // Write the job record directly: a scheduler-spawned scan, currently
    // running. No createJob — avoids the spawn path entirely. The record
    // must look ALIVE to the stale-reaper (api.ts reapIfStale): stamp the
    // test process's own pid and a fresh startedAt.
    const scanId = 'scansmoke1234567'; // JobRecord requires a 16-char id
    writeFileSync(
      join(root, 'data/jobs', `${scanId}.json`),
      JSON.stringify({
        id: scanId,
        type: 'scan',
        status: 'running',
        params: { scheduled: true },
        pid: process.pid,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      }),
    );
    const map = activeJobsByType(root, ['scan']);
    expect(map.scan).toHaveLength(1);
    expect(map.scan?.[0]?.id).toBe(scanId);
    // num must be ABSENT (not 0) — use-job-lock skips non-numeric nums.
    expect(map.scan?.[0]).not.toHaveProperty('num');
  });
});
