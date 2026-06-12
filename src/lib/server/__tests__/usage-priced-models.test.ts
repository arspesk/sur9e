// usage-priced-models.test.ts — aggregation-level lock on the
// model-pricing-coverage spec: a usage.json with the two live regression
// shapes (bare 'kimi-k2.6' + 'opencode/deepseek-v4-flash-free' in the
// opencode bucket) yields ZERO unpriced rows and a fully reconciled total.
// Before the fix, both rendered "N/A / unpriced" on /analytics while the
// write layer had already persisted their cost.
//
// Hermetic: usage.json lives in a mkdtemp root; the OpenRouter cache is
// seeded in-memory from the fixture snapshot (deepseek :free deliberately
// absent — the free rule, not the cache, must price it).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregateUsageByMode, aggregateUsageByModel } from '../analytics';
import { OR_CACHE_FIXTURE } from '../providers/__tests__/fixtures/openrouter-cache-fixture';
import { __testing as orTesting } from '../providers/openrouter-pricing';
import { loadUsage } from '../usage';

const MONTH = new Date().toISOString().slice(0, 7);

const USAGE_FIXTURE = {
  [MONTH]: {
    claude: {
      calls: 4,
      input_tokens: 2_000_000,
      output_tokens: 400_000,
      cost_usd: 9.5,
      estimated_calls: 0,
      by_model: {
        'claude-sonnet-4-6': {
          calls: 3,
          cost_usd: 8.0,
          input_tokens: 1_500_000,
          output_tokens: 300_000,
        },
        'claude-haiku-4-5-20251001': {
          calls: 1,
          cost_usd: 1.5,
          input_tokens: 500_000,
          output_tokens: 100_000,
        },
      },
      by_mode: {
        evaluate: { calls: 4, cost_usd: 9.5, input_tokens: 2_000_000, output_tokens: 400_000 },
      },
    },
    opencode: {
      calls: 3,
      input_tokens: 900_000,
      output_tokens: 90_000,
      cost_usd: 0.0592,
      estimated_calls: 3,
      by_model: {
        'kimi-k2.6': {
          calls: 2,
          cost_usd: 0.0592,
          input_tokens: 600_000,
          output_tokens: 60_000,
          estimated_calls: 2,
        },
        'opencode/deepseek-v4-flash-free': {
          calls: 1,
          cost_usd: 0,
          input_tokens: 300_000,
          output_tokens: 30_000,
          estimated_calls: 1,
        },
      },
      by_mode: {
        screen: {
          calls: 3,
          cost_usd: 0.0592,
          input_tokens: 900_000,
          output_tokens: 90_000,
          estimated_calls: 3,
        },
      },
    },
  },
};

describe('loadUsage + aggregation — regression shapes price, zero unpriced rows', () => {
  let root: string;

  beforeEach(() => {
    orTesting.seedDirect(new Map(Object.entries(OR_CACHE_FIXTURE)), Date.now());
    root = mkdtempSync(join(tmpdir(), 'usage-priced-models-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data/usage.json'), JSON.stringify(USAGE_FIXTURE, null, 2));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('marks every recorded model as priced (bare kimi via inference, deepseek alias via free rule)', () => {
    const usage = loadUsage(root);
    expect(usage.pricedModels).toMatchObject({
      'kimi-k2.6': true,
      'opencode/deepseek-v4-flash-free': true,
      'claude-sonnet-4-6': true,
      // canonical key — dated suffix collapsed
      'claude-haiku-4-5': true,
    });
    expect(Object.values(usage.pricedModels ?? {}).every(Boolean)).toBe(true);
    expect(usage.pricedModes).toMatchObject({ evaluate: true, screen: true });
  });

  it('aggregates with no unpriced spend — totals reconcile with the stat cards', () => {
    const usage = loadUsage(root);
    const range = { start: null, end: null, preset: 'all' };
    const byMode = aggregateUsageByMode(usage.months, range, 'all', usage.pricedModels);
    // Nothing excluded: every mode's unpriced share is zero, so displayed
    // rows sum to the same total the stat cards show.
    expect(Object.values(byMode.unpricedByMode).every(v => v === 0 || v === undefined)).toBe(true);
    expect(byMode.total).toBeCloseTo(9.5 + 0.0592, 6);

    const byModel = aggregateUsageByModel(usage.months, range, 'all');
    expect(byModel.byModel['kimi-k2.6']).toBeCloseTo(0.0592, 6);
    expect(byModel.byModel['opencode/deepseek-v4-flash-free']).toBe(0);
    expect(byModel.total).toBeCloseTo(9.5 + 0.0592, 6);
  });
});
