// pricing.test.ts
//
// `priceForRun` is now a 3-layer lookup:
//   1. OpenRouter live cache (via mapToOpenRouter + getOpenRouterPrice)
//   2. PRICING_FALLBACK static table
//   3. unmatched → { usd: 0, matched: false }
//
// These tests seed the in-memory OR cache via `__testing.seedDirect`
// instead of touching the filesystem, so the test is hermetic and never
// hits OpenRouter over the network.

import { beforeEach, describe, expect, it } from 'vitest';
import { __testing as orTesting } from '../openrouter-pricing';
import { priceForRun } from '../pricing';

describe('priceForRun', () => {
  beforeEach(() => {
    orTesting.reset();
  });

  it('uses OpenRouter live price when the mapper resolves and cache has the id', () => {
    orTesting.seedDirect(
      new Map([['anthropic/claude-sonnet-4.6', { in_per_mtok: 3.0, out_per_mtok: 15.0 }]]),
      Date.now(),
    );
    const r = priceForRun('claude', 'claude-sonnet-4-6', {
      in: 1_000_000,
      out: 1_000_000,
    });
    expect(r.matched).toBe(true);
    // 3.0 + 15.0 = 18.0 USD for 1M+1M tokens
    expect(r.usd).toBeCloseTo(18.0, 4);
  });

  it('returns {usd:0, matched:false} for Antigravity (no OR mapping, no static fallback)', () => {
    // Unmapped internal aliases have no OR mapping and
    // we removed the static fallback entirely — dropped
    // estimated/hardcoded prices in favor of strict N/A surfacing.
    const r = priceForRun('opencode', 'opencode/some-internal-alias', {
      in: 1_000_000,
      out: 1_000_000,
    });
    expect(r.matched).toBe(false);
    expect(r.usd).toBe(0);
  });

  it('returns {usd:0, matched:false} for an entirely unknown provider:model', () => {
    const r = priceForRun('claude', 'claude-future-99', { in: 1000, out: 1000 });
    expect(r.matched).toBe(false);
    expect(r.usd).toBe(0);
  });

  it('scales linearly with tokens', () => {
    orTesting.seedDirect(
      new Map([['anthropic/claude-sonnet-4.6', { in_per_mtok: 3.0, out_per_mtok: 15.0 }]]),
      Date.now(),
    );
    const r1 = priceForRun('claude', 'claude-sonnet-4-6', { in: 1000, out: 0 });
    const r2 = priceForRun('claude', 'claude-sonnet-4-6', { in: 2000, out: 0 });
    expect(r2.usd).toBeCloseTo(r1.usd * 2, 8);
  });
});
