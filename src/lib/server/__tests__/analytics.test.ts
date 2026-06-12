// src/lib/server/__tests__/analytics.test.ts
//
// Tests for the analytics module — migrated from the inline dynamic-import
// block in test-all.mjs Section 18. Covers computeFunnel,
// computeStatusBreakdown, filterByDate, presetToRange, previousRange, and
// aggregateUsageByMode with the same assertions that were previously inlined.

import { describe, expect, it } from 'vitest';
import {
  aggregateUsageByMode,
  aggregateUsageByModel,
  computeFunnel,
  computeRejectionStats,
  computeStatusBreakdown,
  filterByDate,
  presetToRange,
  previousRange,
} from '../analytics';

// ── computeFunnel ────────────────────────────────────────────────────────────

describe('computeFunnel', () => {
  it('discarded + legacy skip + unknown count toward screened (skip rolls into discarded)', () => {
    const entries = [
      { status: 'screened' },
      { status: 'evaluated' },
      { status: 'discarded' },
      { status: 'skip' },
      { status: '(unknown)' },
    ];
    const got = computeFunnel(entries);
    expect(got).toEqual({
      screened: 5,
      evaluated: 1,
      applied: 0,
      responded: 0,
      interview: 0,
      offer: 0,
      discarded: 2,
      rejected: 0,
    });
  });

  it('offer cascades through every stage', () => {
    const got = computeFunnel([{ status: 'offer' }]);
    expect(got).toEqual({
      screened: 1,
      evaluated: 1,
      applied: 1,
      responded: 1,
      interview: 1,
      offer: 1,
      discarded: 0,
      rejected: 0,
    });
  });

  it('rejected counts as having reached applied', () => {
    const got = computeFunnel([{ status: 'rejected' }]);
    expect(got).toEqual({
      screened: 1,
      evaluated: 1,
      applied: 1,
      responded: 0,
      interview: 0,
      offer: 0,
      discarded: 0,
      rejected: 1,
    });
  });

  it('case-insensitive status normalization', () => {
    const got = computeFunnel([
      { status: 'Screened' },
      { status: '**Applied**' },
      { status: '  EVALUATED  ' },
    ]);
    expect(got).toEqual({
      screened: 3,
      evaluated: 2,
      applied: 1,
      responded: 0,
      interview: 0,
      offer: 0,
      discarded: 0,
      rejected: 0,
    });
  });
});

// ── computeStatusBreakdown ───────────────────────────────────────────────────

describe('computeStatusBreakdown', () => {
  it('each status counts in exactly one bucket; sums to total', () => {
    const entries = [
      { status: 'screened' },
      { status: 'evaluated' },
      { status: 'applied' },
      { status: 'responded' },
      { status: 'interview' },
      { status: 'offer' },
      { status: 'discarded' },
    ];
    const got = computeStatusBreakdown(entries);
    expect(got).toEqual({
      screened: 1,
      evaluated: 1,
      applied: 1,
      responded: 1,
      interview: 1,
      offer: 1,
      discarded: 1,
      rejected: 0,
    });
    const sum = Object.values(got).reduce((s, v) => s + v, 0);
    expect(sum).toBe(entries.length);
  });

  it('rejected is its own exclusive bucket', () => {
    const entries = [{ status: 'rejected' }, { status: 'rejected' }, { status: 'applied' }];
    const got = computeStatusBreakdown(entries);
    expect(got).toEqual({
      screened: 0,
      evaluated: 0,
      applied: 1,
      responded: 0,
      interview: 0,
      offer: 0,
      discarded: 0,
      rejected: 2,
    });
  });

  it('legacy skip rolls into discarded; empty/unknown → screened', () => {
    const entries = [
      { status: 'skip' },
      { status: '' },
      { status: '(unknown)' },
      { status: 'discarded' },
    ];
    const got = computeStatusBreakdown(entries);
    expect(got).toEqual({
      screened: 2,
      evaluated: 0,
      applied: 0,
      responded: 0,
      interview: 0,
      offer: 0,
      discarded: 2,
      rejected: 0,
    });
  });

  it('sum equals total entries (mixed)', () => {
    const entries = [
      { status: 'screened' },
      { status: 'screened' },
      { status: 'evaluated' },
      { status: 'interview' },
      { status: 'discarded' },
    ];
    const got = computeStatusBreakdown(entries);
    expect(got).toEqual({
      screened: 2,
      evaluated: 1,
      applied: 0,
      responded: 0,
      interview: 1,
      offer: 0,
      discarded: 1,
      rejected: 0,
    });
  });
});

// ── computeRejectionStats ────────────────────────────────────────────────────

describe('computeRejectionStats', () => {
  // The breakdown counts CURRENTLY-rejected offers by the stage they were last
  // rejected from — so it must reconcile with the rejected total, never exceed
  // it. The bug: it used to count every →rejected transition, double-counting
  // re-rejected offers and including offers that were later un-rejected.
  it('byStageFrom sums to the rejected total (re-rejection counts once)', () => {
    const entries = [
      { num: 1, status: 'rejected', date: '2026-05-01' },
      { num: 2, status: 'rejected', date: '2026-05-01' },
      // Was rejected, then reopened to applied — NOT currently rejected.
      { num: 3, status: 'applied', date: '2026-05-01' },
    ];
    const transitions = [
      { num: 1, from: 'screened', to: 'rejected', at: '2026-05-02' },
      // Offer 2: rejected, reopened, rejected again — two →rejected transitions.
      { num: 2, from: 'applied', to: 'rejected', at: '2026-05-02', source: 'app' },
      { num: 2, from: 'rejected', to: 'applied', at: '2026-05-03', source: 'app' },
      { num: 2, from: 'applied', to: 'rejected', at: '2026-05-04', source: 'app' },
      // Offer 3: rejected then un-rejected — must NOT appear in the breakdown.
      { num: 3, from: 'screened', to: 'rejected', at: '2026-05-02' },
      { num: 3, from: 'rejected', to: 'applied', at: '2026-05-03' },
    ];
    const stats = computeRejectionStats(entries, transitions);

    expect(stats.rejected).toBe(2);
    // Offer 1 from screened, offer 2 from applied (its most recent rejection),
    // offer 3 excluded (no longer rejected).
    expect(stats.byStageFrom).toEqual({ screened: 1, applied: 1 });
    const breakdownSum = Object.values(stats.byStageFrom).reduce((a, b) => a + b, 0);
    expect(breakdownSum).toBe(stats.rejected);
  });

  it('a currently-rejected offer with no transition record buckets to unknown', () => {
    const entries = [{ num: 7, status: 'rejected', date: '2026-05-01' }];
    const stats = computeRejectionStats(entries, []);
    expect(stats.rejected).toBe(1);
    expect(stats.byStageFrom).toEqual({ unknown: 1 });
  });

  it('attributes a discarded → rejected offer to the discarded stage, not unknown', () => {
    const entries = [{ num: 9, status: 'rejected', date: '2026-05-01' }];
    const transitions = [{ num: 9, from: 'discarded', to: 'rejected', at: '2026-05-02' }];
    const stats = computeRejectionStats(entries, transitions);
    expect(stats.byStageFrom).toEqual({ discarded: 1 });
  });
});

// ── filterByDate ─────────────────────────────────────────────────────────────

describe('filterByDate', () => {
  it('"all" preset returns every entry', () => {
    const entries = [{ date: '2026-01-01' }, { date: '2026-05-04' }];
    expect(filterByDate(entries, { preset: 'all', start: null, end: null })).toHaveLength(2);
  });

  it('inclusive bounds — entry on start date is included', () => {
    const entries = [{ date: '2026-04-04' }, { date: '2026-04-03' }, { date: '2026-05-04' }];
    const range = { start: '2026-04-04', end: '2026-05-04', preset: '30d' };
    expect(filterByDate(entries, range)).toHaveLength(2);
  });

  it('entries with missing date are excluded', () => {
    const entries = [{ date: '2026-05-04' }, { date: '' }, { date: null as unknown as string }, {}];
    const range = { start: '2026-04-04', end: '2026-05-04', preset: '30d' };
    expect(filterByDate(entries, range)).toHaveLength(1);
  });
});

// ── presetToRange ────────────────────────────────────────────────────────────

describe('presetToRange', () => {
  const today = new Date('2026-05-04T12:00:00Z');

  it('30d anchored at 2026-05-04 → 2026-04-04 .. 2026-05-04', () => {
    const r = presetToRange('30d', today);
    expect(r).toEqual({ start: '2026-04-04', end: '2026-05-04', preset: '30d' });
  });

  it('7d', () => {
    const r = presetToRange('7d', today);
    expect(r.start).toBe('2026-04-27');
    expect(r.end).toBe('2026-05-04');
  });

  it('all', () => {
    const r = presetToRange('all', today);
    expect(r).toEqual({ preset: 'all', start: null, end: null });
  });
});

// ── previousRange ────────────────────────────────────────────────────────────

describe('previousRange', () => {
  it('30d span → 03-04..04-03', () => {
    const prev = previousRange({ start: '2026-04-04', end: '2026-05-04', preset: '30d' });
    expect(prev?.start).toBe('2026-03-04');
    expect(prev?.end).toBe('2026-04-03');
  });

  it('1-day → previous single day', () => {
    const prev = previousRange({ start: '2026-05-04', end: '2026-05-04', preset: 'custom' });
    expect(prev?.start).toBe('2026-05-03');
    expect(prev?.end).toBe('2026-05-03');
  });

  it('2-day → 05-01..05-02', () => {
    const prev = previousRange({ start: '2026-05-03', end: '2026-05-04', preset: 'custom' });
    expect(prev?.start).toBe('2026-05-01');
    expect(prev?.end).toBe('2026-05-02');
  });

  it('all → null (no previous)', () => {
    expect(previousRange({ preset: 'all', start: null, end: null })).toBeNull();
  });
});

// ── aggregateUsageByMode ─────────────────────────────────────────────────────

describe('aggregateUsageByMode', () => {
  const usage = {
    '2026-04': {
      claude: {
        cost_usd: 100,
        by_mode: { evaluate: { cost_usd: 60 }, screen: { cost_usd: 40 } },
      },
    },
    '2026-05': {
      claude: {
        cost_usd: 50,
        by_mode: { evaluate: { cost_usd: 30 }, screen: { cost_usd: 20 } },
      },
    },
  };

  it('all-time sums every month', () => {
    const result = aggregateUsageByMode(usage, { preset: 'all', start: null, end: null });
    expect(result.total).toBe(150);
    expect(result.evaluate).toBe(90);
    expect(result.screen).toBe(60);
    expect(result.other).toBe(0);
  });

  it('range scoped to may', () => {
    const result = aggregateUsageByMode(usage, {
      start: '2026-05-01',
      end: '2026-05-04',
      preset: 'custom',
    });
    expect(result.total).toBe(50);
    expect(result.evaluate).toBe(30);
    expect(result.screen).toBe(20);
  });

  it('other = total - evaluate - screen', () => {
    const usageOther = {
      '2026-05': { claude: { cost_usd: 100, by_mode: { evaluate: { cost_usd: 30 } } } },
    };
    const result = aggregateUsageByMode(usageOther, { preset: 'all', start: null, end: null });
    expect(result.total).toBe(100);
    expect(result.evaluate).toBe(30);
    expect(result.screen).toBe(0);
    expect(result.other).toBe(70);
  });
});

// ── Multi-provider aggregation ────────────────────────────────────────────

describe('aggregateUsageByMode — multi-provider', () => {
  const usage = {
    '2026-05': {
      claude: {
        cost_usd: 50,
        input_tokens: 1000,
        output_tokens: 2000,
        by_mode: {
          evaluate: { cost_usd: 30, input_tokens: 600, output_tokens: 1200 },
          screen: { cost_usd: 20, input_tokens: 400, output_tokens: 800 },
        },
      },
      codex: {
        cost_usd: 10,
        input_tokens: 200,
        output_tokens: 400,
        by_mode: {
          evaluate: { cost_usd: 10, input_tokens: 200, output_tokens: 400 },
        },
      },
      opencode: {
        cost_usd: 0,
        input_tokens: 500,
        output_tokens: 1000,
        estimated_calls: 2,
        by_mode: {
          screen: {
            cost_usd: 0,
            input_tokens: 500,
            output_tokens: 1000,
            estimated_calls: 2,
          },
        },
      },
    },
  };
  const allRange = { preset: 'all' as const, start: null, end: null };

  it('default (providerId omitted) sums every provider — "all" semantics', () => {
    const r = aggregateUsageByMode(usage, allRange);
    expect(r.total).toBe(60); // 50 + 10 + 0
    expect(r.byMode.evaluate).toBe(40); // 30 (claude) + 10 (codex)
    expect(r.byMode.screen).toBe(20); // 20 (claude) + 0 (opencode, unpriced)
    expect(r.totalTokens).toEqual({ input: 1700, output: 3400 });
    expect(r.estimatedCalls).toBe(2);
    expect(r.byModeEstimated.screen).toBe(2);
    expect(r.byModeEstimated.evaluate ?? 0).toBe(0);
  });

  it('"all" is explicit synonym for the default', () => {
    const r = aggregateUsageByMode(usage, allRange, 'all');
    const def = aggregateUsageByMode(usage, allRange);
    expect(r).toEqual(def);
  });

  it('"claude" filter scopes to that bucket only', () => {
    const r = aggregateUsageByMode(usage, allRange, 'claude');
    expect(r.total).toBe(50);
    expect(r.byMode.evaluate).toBe(30);
    expect(r.byMode.screen).toBe(20);
    expect(r.estimatedCalls).toBe(0);
  });

  it('"opencode" filter exposes estimated rows + zero priced cost', () => {
    const r = aggregateUsageByMode(usage, allRange, 'opencode');
    expect(r.total).toBe(0);
    expect(r.byMode.screen).toBe(0);
    expect(r.byModeEstimated.screen).toBe(2);
    expect(r.estimatedCalls).toBe(2);
    expect(r.totalTokens).toEqual({ input: 500, output: 1000 });
  });

  it('missing provider bucket returns empty aggregate', () => {
    const r = aggregateUsageByMode(usage, allRange, 'codex');
    expect(r.total).toBe(10);
    expect(r.byMode.evaluate).toBe(10);
    const empty = aggregateUsageByMode(
      { '2026-05': { claude: { cost_usd: 1 } } },
      allRange,
      'codex',
    );
    expect(empty.total).toBe(0);
    expect(empty.byMode).toEqual({});
    expect(empty.estimatedCalls).toBe(0);
  });
});

// ── aggregateUsageByMode — unpricedByMode attribution ───────────────────────
// Per-mode cost from buckets whose models all lack a live OpenRouter price.
// This is what lets the by-mode card exclude estimated dollars the same way
// the by-model card renders unpriced models as "N/A" — without it the two
// adjacent cards disagreed by exactly the unpriced cost.

describe('aggregateUsageByMode — unpricedByMode', () => {
  const allRange = { preset: 'all' as const, start: null, end: null };
  // The real-world shape: claude bucket fully priced, opencode bucket fully
  // unpriced (deepseek), both contributing to the same modes.
  const usage = {
    '2026-06': {
      claude: {
        cost_usd: 10,
        by_model: { 'claude-sonnet-4-6': { calls: 5, cost_usd: 10 } },
        by_mode: { evaluate: { calls: 3, cost_usd: 6 }, screen: { calls: 2, cost_usd: 4 } },
      },
      opencode: {
        cost_usd: 3,
        by_model: { 'opencode/deepseek-v4-flash-free': { calls: 9, cost_usd: 3 } },
        by_mode: { evaluate: { calls: 4, cost_usd: 2 }, research: { calls: 5, cost_usd: 1 } },
      },
    },
  };
  const pricedModels = {
    'claude-sonnet-4-6': true,
    'opencode/deepseek-v4-flash-free': false,
  };

  it('attributes per-mode cost from fully-unpriced buckets', () => {
    const r = aggregateUsageByMode(usage, allRange, 'all', pricedModels);
    // evaluate mixes priced claude ($6) and unpriced opencode ($2).
    expect(r.byMode.evaluate).toBe(8);
    expect(r.unpricedByMode.evaluate).toBe(2);
    // screen is claude-only → nothing unpriced.
    expect(r.unpricedByMode.screen ?? 0).toBe(0);
    // research is opencode-only → fully unpriced.
    expect(r.byMode.research).toBe(1);
    expect(r.unpricedByMode.research).toBe(1);
  });

  it('respects the provider filter', () => {
    const claudeOnly = aggregateUsageByMode(usage, allRange, 'claude', pricedModels);
    expect(claudeOnly.unpricedByMode).toEqual({});
    const opencodeOnly = aggregateUsageByMode(usage, allRange, 'opencode', pricedModels);
    expect(opencodeOnly.unpricedByMode).toEqual({ evaluate: 2, research: 1 });
  });

  it('is empty without a pricedModels map (and for mixed/unknown buckets)', () => {
    const r = aggregateUsageByMode(usage, allRange, 'all');
    expect(r.unpricedByMode).toEqual({});
    // A bucket mixing priced + unpriced models can't be attributed per-mode
    // from this data → conservatively counts as priced.
    const mixed = {
      '2026-06': {
        opencode: {
          cost_usd: 3,
          by_model: {
            'opencode/deepseek-v4-flash-free': { calls: 1, cost_usd: 1 },
            'anthropic/claude-3-haiku': { calls: 1, cost_usd: 2 },
          },
          by_mode: { evaluate: { calls: 2, cost_usd: 3 } },
        },
      },
    };
    const m = aggregateUsageByMode(mixed, allRange, 'all', {
      'opencode/deepseek-v4-flash-free': false,
      'anthropic/claude-3-haiku': true,
    });
    expect(m.unpricedByMode).toEqual({});
  });
});

describe('aggregateUsageByModel — multi-provider', () => {
  const usage = {
    '2026-05': {
      claude: {
        cost_usd: 50,
        by_model: {
          'claude-sonnet-4-6': { cost_usd: 50, input_tokens: 1000, output_tokens: 2000 },
        },
      },
      codex: {
        cost_usd: 10,
        by_model: {
          'gpt-5': { cost_usd: 10, input_tokens: 200, output_tokens: 400 },
        },
      },
      opencode: {
        cost_usd: 0,
        estimated_calls: 3,
        by_model: {
          'anthropic/claude-3-haiku': {
            cost_usd: 0,
            input_tokens: 500,
            output_tokens: 1000,
            estimated_calls: 3,
          },
        },
      },
    },
  };
  const allRange = { preset: 'all' as const, start: null, end: null };

  it('"all" merges per-model keys across providers — no collision', () => {
    const r = aggregateUsageByModel(usage, allRange);
    expect(r.total).toBe(60);
    expect(r.byModel['claude-sonnet-4-6']).toBe(50);
    expect(r.byModel['gpt-5']).toBe(10);
    expect(r.byModel['anthropic/claude-3-haiku']).toBe(0);
    // OpenCode model id should pass through the canonical-key normaliser
    // unchanged — neither the dated-suffix nor the -1m strip applies.
    expect(r.byModelEstimated['anthropic/claude-3-haiku']).toBe(3);
    expect(r.estimatedCalls).toBe(3);
  });

  it('"opencode" scope keeps only opencode rows', () => {
    const r = aggregateUsageByModel(usage, allRange, 'opencode');
    expect(Object.keys(r.byModel)).toEqual(['anthropic/claude-3-haiku']);
    expect(r.byModelEstimated['anthropic/claude-3-haiku']).toBe(3);
    expect(r.total).toBe(0);
  });
});

describe('aggregateUsageByMode — back-compat with single-provider fixtures', () => {
  it('claude-only fixture aggregates identically under the new default', () => {
    const usage = {
      '2026-04': {
        claude: { cost_usd: 100, by_mode: { evaluate: { cost_usd: 60 } } },
      },
    };
    const r = aggregateUsageByMode(usage, { preset: 'all', start: null, end: null });
    expect(r.total).toBe(100);
    expect(r.byMode.evaluate).toBe(60);
    expect(r.estimatedCalls).toBe(0);
    // New fields default cleanly — every mode entry resolves to 0 (no NaN /
    // undefined). The dashboard only renders the est. badge when > 0, so
    // these zero entries are inert.
    expect(r.byModeEstimated.evaluate).toBe(0);
  });
});
