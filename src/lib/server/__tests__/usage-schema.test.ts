// src/lib/server/__tests__/usage-schema.test.ts
//
// Parse-boundary tests for the typed entrypoint that wraps usage.mjs.
// All fixtures live in os.tmpdir() — never touches the real data/usage.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageRecord } from '../../schemas/usage';
// Resolves to ../usage.ts (the typed wrapper). vitest.config.ts pins
// `resolve.extensions` so .ts wins over .mjs for extensionless imports;
// otherwise vite's default would resolve to the runtime ../usage.mjs and
// bypass the schema boundary we want to exercise.
import { loadUsage } from '../usage';

function makeTmpRoot(json?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'usage-schema-test-'));
  mkdirSync(join(root, 'data'));
  if (json !== undefined) {
    writeFileSync(join(root, 'data/usage.json'), JSON.stringify(json));
  }
  return root;
}

describe('usage.ts — schema boundary', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('loadUsage parses a populated fixture through UsageRecord', () => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const otherKey = '2024-01';
    root = makeTmpRoot({
      [monthKey]: {
        claude: { calls: 5, input_tokens: 120, output_tokens: 480, cost_usd: 0.0125 },
      },
      [otherKey]: {
        claude: { calls: 3, input_tokens: 60, output_tokens: 240, cost_usd: 0.006 },
      },
    });

    const usage = loadUsage(root);

    // Validates: schema parses, aggregates compute correctly.
    expect(() => UsageRecord.parse(usage)).not.toThrow();
    expect(usage.currentMonth).toBe(monthKey);
    expect(usage.currentMonthData).not.toBeNull();
    expect(usage.allTime).not.toBeNull();
    expect(usage.allTime?.calls).toBe(8);
    expect(usage.allTime?.input_tokens).toBe(180);
    expect(usage.allTime?.output_tokens).toBe(720);
    // Cost is rounded to 4dp by the runtime.
    expect(usage.allTime?.cost_usd).toBeCloseTo(0.0185, 4);
  });

  it('loadUsage returns the empty-record shape when data/usage.json is missing', () => {
    root = makeTmpRoot(); // no JSON file
    const usage = loadUsage(root);
    expect(() => UsageRecord.parse(usage)).not.toThrow();
    expect(usage.currentMonth).toBeNull();
    expect(usage.currentMonthData).toBeNull();
    expect(usage.allTime).toBeNull();
    expect(usage.months).toEqual({});
  });

  it('loadUsage degrades to the empty record when usage.json is empty or corrupt', () => {
    root = makeTmpRoot();
    // Zero-byte file (touch'd / interrupted write) — readFileOrNull returns ''.
    writeFileSync(join(root, 'data/usage.json'), '');
    expect(loadUsage(root).months).toEqual({});
    // Truncated/hand-edited JSON.
    writeFileSync(join(root, 'data/usage.json'), '{"2026-06": {');
    expect(loadUsage(root).months).toEqual({});
    // Valid JSON but not an object.
    writeFileSync(join(root, 'data/usage.json'), 'null');
    expect(loadUsage(root).months).toEqual({});
  });

  it('loadUsage passes per-mode breakdowns through to the parsed record', () => {
    const monthKey = new Date().toISOString().slice(0, 7);
    root = makeTmpRoot({
      [monthKey]: {
        claude: { calls: 1, input_tokens: 10, output_tokens: 20, cost_usd: 0.001 },
        modes: { evaluate: { calls: 1, input_tokens: 10, output_tokens: 20 } },
      },
    });

    const usage = loadUsage(root);
    const month = usage.months[monthKey] as Record<string, unknown> & {
      claude: { calls: number };
    };
    expect(month.claude.calls).toBe(1);
    // .passthrough() keeps the modes key intact.
    expect(month.modes).toEqual({
      evaluate: { calls: 1, input_tokens: 10, output_tokens: 20 },
    });
  });

  it('loadUsage preserves claude.by_mode and claude.by_model — analytics regression', () => {
    // Regression: ClaudeUsage used to strip by_mode / by_model because they
    // weren't declared on the schema. The /api/usage response then returned
    // empty breakdowns, so the analytics page's Spend-by-mode and
    // Spend-by-model cards collapsed to "Other (untagged)" + $0 rows.
    const monthKey = new Date().toISOString().slice(0, 7);
    root = makeTmpRoot({
      [monthKey]: {
        claude: {
          calls: 315,
          input_tokens: 110706571,
          output_tokens: 1708563,
          cost_usd: 45.0544,
          by_model: {
            'claude-haiku-4-5-20251001': {
              calls: 304,
              cost_usd: 32.7979,
              input_tokens: 110692614,
              output_tokens: 1508489,
            },
            'claude-sonnet-4-6': {
              calls: 11,
              cost_usd: 12.2565,
              input_tokens: 13957,
              output_tokens: 200074,
            },
          },
          by_mode: {
            screen: {
              calls: 304,
              cost_usd: 32.7979,
              input_tokens: 110692614,
              output_tokens: 1508489,
            },
            evaluate: {
              calls: 3,
              cost_usd: 5,
              input_tokens: 5000,
              output_tokens: 80000,
            },
          },
        },
      },
    });

    const usage = loadUsage(root);
    const month = usage.months[monthKey];
    expect(month).toBeDefined();
    expect(month?.claude?.by_mode).toBeDefined();
    expect(Object.keys(month?.claude?.by_mode ?? {})).toEqual(['screen', 'evaluate']);
    expect(month?.claude?.by_mode?.evaluate?.cost_usd).toBe(5);
    expect(month?.claude?.by_model).toBeDefined();
    expect(Object.keys(month?.claude?.by_model ?? {})).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
    ]);
    expect(month?.claude?.by_model?.['claude-sonnet-4-6']?.cost_usd).toBe(12.2565);
  });
});
