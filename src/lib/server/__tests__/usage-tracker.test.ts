// src/lib/server/__tests__/usage-tracker.test.ts
//
// Regression test for the rootPath plumbing in cli/usage-tracker.mjs.
//
// The bug: Turbopack bundles cli/usage-tracker.mjs when it's dynamic-imported
// from src/lib/server/jobs/runner.ts. Bundled modules don't get a real
// import.meta.dirname, so the tracker fell back to process.cwd() (the Next
// dev server's cwd = repo root), then went `..` to land usage.json one dir
// ABOVE the repo. Evaluate / tailor-cv spend silently went to the wrong file.
//
// Fix: trackClaude accepts opts.rootPath; runner.ts passes its already-known
// rootPath. This test pins the new contract so a future refactor can't
// re-break it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Import the .mjs runtime directly — same module the bundled runner loads.
import { trackClaude } from '../../../../cli/usage-tracker.mjs';

// Paranoia: if a future refactor stops honoring opts.rootPath, vitest's
// import.meta.dirname-based fallback would write into the real repo's
// data/usage.json. Snapshot its mtime before each test and assert it
// hasn't moved at the end — failing loud beats silently mutating real
// user data.
const CANONICAL_USAGE_PATH = resolve(__dirname, '../../../../data/usage.json');

describe('cli/usage-tracker — rootPath option', () => {
  let root: string;
  let canonicalMtimeBefore: number | null;

  beforeEach(() => {
    canonicalMtimeBefore = existsSync(CANONICAL_USAGE_PATH)
      ? statSync(CANONICAL_USAGE_PATH).mtimeMs
      : null;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    const canonicalMtimeAfter = existsSync(CANONICAL_USAGE_PATH)
      ? statSync(CANONICAL_USAGE_PATH).mtimeMs
      : null;
    expect(
      canonicalMtimeAfter,
      'canonical data/usage.json was modified by this test — rootPath plumbing regressed',
    ).toBe(canonicalMtimeBefore);
  });

  it('writes usage.json under opts.rootPath, not cwd', () => {
    root = mkdtempSync(join(tmpdir(), 'usage-tracker-test-'));
    mkdirSync(join(root, 'data'));

    const result = trackClaude(100, 50, {
      cost_usd: 0.42,
      model: 'claude-sonnet-4-6',
      mode: 'evaluate',
      rootPath: root,
    });

    expect(result.cost_usd).toBe(0.42);

    // The whole point: file lands at <root>/data/usage.json, NOT cwd-derived.
    const written = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = written[result.month];
    expect(month).toBeDefined();
    expect(month.claude.cost_usd).toBe(0.42);
    expect(month.claude.input_tokens).toBe(100);
    expect(month.claude.output_tokens).toBe(50);
    expect(month.claude.by_mode.evaluate).toEqual({
      calls: 1,
      cost_usd: 0.42,
      input_tokens: 100,
      output_tokens: 50,
    });
    expect(month.claude.by_model['claude-sonnet-4-6']).toEqual({
      calls: 1,
      cost_usd: 0.42,
      input_tokens: 100,
      output_tokens: 50,
    });
  });

  it('two calls with the same rootPath accumulate into the same file', () => {
    root = mkdtempSync(join(tmpdir(), 'usage-tracker-test-'));
    mkdirSync(join(root, 'data'));

    trackClaude(10, 20, {
      cost_usd: 0.1,
      model: 'claude-haiku-4-5',
      mode: 'screen',
      rootPath: root,
    });
    const result = trackClaude(5, 15, {
      cost_usd: 0.05,
      model: 'claude-haiku-4-5',
      mode: 'screen',
      rootPath: root,
    });

    const written = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = written[result.month];
    expect(month.claude.calls).toBe(2);
    expect(month.claude.cost_usd).toBeCloseTo(0.15, 4);
    expect(month.claude.by_mode.screen.calls).toBe(2);
  });
});
