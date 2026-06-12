import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createJob } from '../jobs/api';

// Force the spawned bash subprocess to fail fast: with empty PATH it cannot
// find 'claude', set -o pipefail propagates the failure, and the close handler
// fires within ~10ms. /bin/bash is invoked by absolute path so spawn() itself
// still works. This prevents real claude subprocesses from outliving the test
// and racing with tmpdir cleanup. Each *.test.ts file runs in its own vitest
// worker so the mutation can't bleed into other tests.
process.env.PATH = '';

function makeTmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'jobs-test-'));
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
async function waitForTerminal(root: string, jobId: string, timeoutMs = 500) {
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

test('createJob — tailor-cv with valid num produces a job', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'tailor-cv', { num: 42 });
    expect(job.type).toBe('tailor-cv');
    expect(job.params.num).toBe(42);
    expect(['queued', 'running', 'error'].includes(job.status)).toBeTruthy();
    // Wait for the spawned process to finish (claude not in PATH → quick error).
    await waitForTerminal(root, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — cover-letter with valid num produces a job', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'cover-letter', { num: 42 });
    expect(job.type).toBe('cover-letter');
    expect(job.params.num).toBe(42);
    expect(['queued', 'running', 'error'].includes(job.status)).toBeTruthy();
    // Wait for the spawned process to finish (claude not in PATH → quick error).
    await waitForTerminal(root, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — research with valid num produces a job', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'research', { num: 42 });
    expect(job.type).toBe('research');
    expect(job.params.num).toBe(42);
    expect(['queued', 'running', 'error'].includes(job.status)).toBeTruthy();
    // Wait for the spawned process to finish (claude not in PATH → quick error).
    await waitForTerminal(root, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — interview-prep with valid num produces a job', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'interview-prep', { num: 42 });
    expect(job.type).toBe('interview-prep');
    expect(job.params.num).toBe(42);
    expect(['queued', 'running', 'error'].includes(job.status)).toBeTruthy();
    // Wait for the spawned process to finish (claude not in PATH → quick error).
    await waitForTerminal(root, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — negotiate with valid num produces a job', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'negotiate', { num: 42 });
    expect(job.type).toBe('negotiate');
    expect(job.params.num).toBe(42);
    expect(['queued', 'running', 'error'].includes(job.status)).toBeTruthy();
    // Wait for the spawned process to finish (claude not in PATH → quick error).
    await waitForTerminal(root, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — tailor-cv with non-integer num fails fast', async () => {
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'tailor-cv', { num: 'oops' });
    // Poll instead of a fixed sleep — under full-suite parallel load a 50ms
    // nap raced the runner's error write and flaked the pre-commit gate
    // (same fix as jobs-outreach.test.ts).
    const persisted = await waitForTerminal(root, job.id, 2000);
    expect(persisted?.status).toBe('error');
    expect(persisted?.error).toMatch(/invalid job/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createJob — tailor-cv with missing applications.md row errors at runtime', async () => {
  // The registry no longer reads applications.md at build
  // time — buildCommand always produces the mode-runner script and the
  // missing-row case is detected by the WORKER (findOfferRow → loadInputs
  // throws → exit 1; unit-covered in test/mode-runner-offers.test.mjs).
  // Here the spawned `node` is missing from the emptied PATH, so the job
  // still lands as status:'error' — the job-record contract this test
  // locks (a bad num never yields a silent 'done').
  const root = makeTmpRoot();
  try {
    const job = createJob(root, 'tailor-cv', { num: 99999 });
    // Poll instead of a fixed sleep — same flake guard as the test above.
    const persisted = await waitForTerminal(root, job.id, 2000);
    expect(persisted?.status).toBe('error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
