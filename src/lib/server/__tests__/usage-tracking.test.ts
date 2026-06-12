// src/lib/server/__tests__/usage-tracking.test.ts
//
// Multi-provider tracker contract.
//
// Covers trackProvider() and its trackClaude back-compat wrapper:
//   - sibling buckets for claude/codex/opencode under each month
//   - by_model / by_mode breakdowns
//   - estimated_calls counters (set only when opts.estimated === true)
//   - cost_usd policy: prefer caller-supplied; fall back to provider-scoped
//     pricing; persist 0 for unknown codex/opencode models (don't fabricate)
//
// Defense in depth: every test snapshots the real repo's data/usage.json
// mtime and asserts at teardown that we didn't mutate it. Same guard as
// the existing usage-tracker.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Import the .mjs runtime directly — same module the bundled runner loads.
import { trackClaude, trackProvider } from '../../../../cli/usage-tracker.mjs';

const CANONICAL_USAGE_PATH = resolve(__dirname, '../../../../data/usage.json');

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'usage-tracking-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  return root;
}

describe('trackProvider — multi-provider buckets', () => {
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

  it('writes claude bucket on first call', () => {
    root = makeRoot();
    const result = trackProvider('claude', 1000, 500, {
      model: 'claude-sonnet-4-6',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.01,
    });
    expect(result.cost_usd).toBe(0.01);

    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.claude).toMatchObject({
      calls: 1,
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.01,
      estimated_calls: 0,
    });
    expect(month.claude.by_model['claude-sonnet-4-6']).toMatchObject({
      calls: 1,
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(month.claude.by_mode.evaluate).toMatchObject({
      calls: 1,
      input_tokens: 1000,
      output_tokens: 500,
    });
  });

  it('writes a separate codex bucket alongside claude', () => {
    root = makeRoot();
    trackProvider('claude', 1000, 500, {
      model: 'claude-sonnet-4-6',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.01,
    });
    const result = trackProvider('codex', 2000, 800, {
      model: 'gpt-5.5',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.02,
    });

    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.claude.calls).toBe(1);
    expect(month.codex.calls).toBe(1);
    expect(month.codex.by_model['gpt-5.5']).toMatchObject({
      input_tokens: 2000,
      output_tokens: 800,
    });
    expect(month.codex.by_mode.evaluate).toMatchObject({ calls: 1 });
  });

  it('opencode bucket tracks estimated_calls when opts.estimated is true', () => {
    root = makeRoot();
    const result = trackProvider('opencode', 1500, 600, {
      model: 'anthropic/claude-3-haiku',
      mode: 'interview-prep',
      rootPath: root,
      cost_usd: 0.005,
      estimated: true,
    });
    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.opencode.calls).toBe(1);
    expect(month.opencode.estimated_calls).toBe(1);
    expect(month.opencode.by_model['anthropic/claude-3-haiku'].estimated_calls).toBe(1);
  });

  it('does NOT increment estimated_calls when opts.estimated is absent', () => {
    root = makeRoot();
    const result = trackProvider('codex', 1000, 400, {
      model: 'gpt-5',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.01,
    });
    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.codex.estimated_calls).toBe(0);
    expect(month.codex.by_model['gpt-5'].estimated_calls).toBeUndefined();
  });

  it('trackClaude is a back-compat wrapper for trackProvider("claude", ...)', () => {
    root = makeRoot();
    const result = trackClaude(800, 300, {
      model: 'claude-sonnet-4-6',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.005,
    });
    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.claude.calls).toBe(1);
    expect(month.claude.cost_usd).toBe(0.005);
  });

  it('multiple calls accumulate within the same bucket', () => {
    root = makeRoot();
    trackProvider('codex', 1000, 500, {
      model: 'gpt-5.5',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.01,
    });
    const result = trackProvider('codex', 2000, 800, {
      model: 'gpt-5.5',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.02,
    });

    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.codex.calls).toBe(2);
    expect(month.codex.input_tokens).toBe(3000);
    expect(month.codex.output_tokens).toBe(1300);
    expect(month.codex.cost_usd).toBeCloseTo(0.03, 4);
    expect(month.codex.by_model['gpt-5.5'].calls).toBe(2);
  });

  it('falls back to provider-scoped pricing when cost_usd is omitted (codex)', () => {
    root = makeRoot();
    // gpt-5: $2.50/Mtok in, $10/Mtok out. 1M in + 0.1M out = 2.5 + 1.0 = 3.50.
    const result = trackProvider('codex', 1_000_000, 100_000, {
      model: 'gpt-5',
      mode: 'evaluate',
      rootPath: root,
    });
    expect(result.cost_usd).toBeCloseTo(3.5, 4);
  });

  it('persists cost_usd: 0 for unknown codex/opencode models (no fabrication)', () => {
    root = makeRoot();
    const result = trackProvider('opencode', 5000, 2000, {
      model: 'some/never-heard-of-it',
      mode: 'evaluate',
      rootPath: root,
    });
    expect(result.cost_usd).toBe(0);
    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.opencode.cost_usd).toBe(0);
    expect(month.opencode.by_model['some/never-heard-of-it']).toMatchObject({
      calls: 1,
      input_tokens: 5000,
      output_tokens: 2000,
      cost_usd: 0,
    });
  });

  it('mixed estimated + exact rows: estimated_calls reflects only the estimated ones', () => {
    root = makeRoot();
    trackProvider('opencode', 1000, 500, {
      model: 'anthropic/claude-3-haiku',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.001,
      estimated: true,
    });
    trackProvider('opencode', 1500, 800, {
      model: 'anthropic/claude-3-haiku',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.002,
      estimated: true,
    });
    const result = trackProvider('opencode', 500, 200, {
      model: 'anthropic/claude-3-haiku',
      mode: 'evaluate',
      rootPath: root,
      cost_usd: 0.0005,
      // not estimated — caller had a real cost
    });
    const usage = JSON.parse(readFileSync(join(root, 'data/usage.json'), 'utf-8'));
    const month = usage[result.month];
    expect(month.opencode.calls).toBe(3);
    expect(month.opencode.estimated_calls).toBe(2);
    expect(month.opencode.by_model['anthropic/claude-3-haiku'].estimated_calls).toBe(2);
  });
});
