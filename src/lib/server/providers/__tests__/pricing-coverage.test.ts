// pricing-coverage.test.ts — the model-pricing-coverage spec §4 regression
// net: EVERY model id the three CLIs can emit must resolve to a price
// (dollars or an explicit $0.00). A new model that misses becomes a failing
// test here, not a silent N/A on the analytics dashboard.
//
// Hermetic: the OpenRouter cache is seeded in-memory from a fixture
// snapshot (no disk, no network) via __testing.seedDirect with a fresh
// timestamp, which also suppresses the TTL background refresh.

import { beforeEach, describe, expect, it } from 'vitest';
import { __testing as orTesting } from '../openrouter-pricing';
import { isModelPriced, priceForRun, resolveModelPricing } from '../pricing';
import { CLI_EMITTABLE_MODEL_IDS, OR_CACHE_FIXTURE } from './fixtures/openrouter-cache-fixture';

function seedFixtureCache() {
  orTesting.seedDirect(new Map(Object.entries(OR_CACHE_FIXTURE)), Date.now());
}

// Seeding an EMPTY map with a fresh timestamp models "cache file missing":
// no disk seed, no background refresh, zero OpenRouter knowledge.
function seedEmptyCache() {
  orTesting.seedDirect(new Map(), Date.now());
}

describe('coverage: every CLI-emittable model id resolves to a price', () => {
  beforeEach(seedFixtureCache);

  it.each([...CLI_EMITTABLE_MODEL_IDS])('%s %s prices (dollars or $0.00)', (provider, model) => {
    expect(isModelPriced(provider, model)).toBe(true);
    const run = priceForRun(provider, model, { in: 1_000_000, out: 1_000_000 });
    expect(run.matched).toBe(true);
    expect(Number.isFinite(run.usd)).toBe(true);
    expect(run.usd).toBeGreaterThanOrEqual(0);
  });
});

describe('locked regression cases (diagnosed live 2026-06-10)', () => {
  beforeEach(seedFixtureCache);

  it('1. bare kimi-k2.6 in the opencode bucket prices via name inference', () => {
    const resolved = resolveModelPricing('opencode', 'kimi-k2.6');
    expect(resolved.source).toBe('openrouter');
    expect(resolved.orId).toBe('moonshotai/kimi-k2.6');
    const run = priceForRun('opencode', 'kimi-k2.6', { in: 1_000_000, out: 1_000_000 });
    expect(run.matched).toBe(true);
    expect(run.usd).toBeCloseTo(0.68 + 3.41, 4);
  });

  it('2. opencode/deepseek-v4-flash-free prices $0.00 via the free rule (its :free OR id is absent)', () => {
    const resolved = resolveModelPricing('opencode', 'opencode/deepseek-v4-flash-free');
    expect(resolved.source).toBe('free');
    const run = priceForRun('opencode', 'opencode/deepseek-v4-flash-free', {
      in: 1_000_000,
      out: 1_000_000,
    });
    // $0.00 is a price — matched, never N/A. And NOT the paid
    // deepseek/deepseek-v4-flash base rate (present in the fixture).
    expect(run.matched).toBe(true);
    expect(run.usd).toBe(0);
  });

  it('3. Claude/Codex ids normalize onto OR ids (dash→dot, dated/[1m] strip, codex alias)', () => {
    expect(resolveModelPricing('claude', 'claude-sonnet-4-6').orId).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    expect(resolveModelPricing('claude', 'claude-sonnet-4-5-20250929[1m]').orId).toBe(
      'anthropic/claude-sonnet-4.5',
    );
    expect(resolveModelPricing('claude', 'claude-fable-5[1m]').orId).toBe(
      'anthropic/claude-fable-5',
    );
    expect(resolveModelPricing('codex', 'gpt-5.5-codex').orId).toBe('openai/gpt-5.5');
  });
});

describe('offline path: static tables keep first-party models priced without the cache', () => {
  beforeEach(seedEmptyCache);

  it('first-party claude/codex/opencode defaults still price (self-hosted requirement)', () => {
    const firstParty: ReadonlyArray<readonly ['claude' | 'codex' | 'opencode', string]> = [
      ['claude', 'claude-haiku-4-5'],
      ['claude', 'claude-haiku-4-5-20251001'],
      ['claude', 'claude-sonnet-4-6'],
      ['claude', 'claude-opus-4-7'],
      ['claude', 'claude-opus-4-7-1m'],
      ['claude', 'claude-fable-5[1m]'],
      ['codex', 'gpt-5'],
      ['codex', 'gpt-5.5'],
      ['codex', 'gpt-5.5-codex'],
      ['codex', 'o1'],
      ['opencode', 'anthropic/claude-3-haiku'],
      ['opencode', 'anthropic/claude-3-sonnet'],
      ['opencode', 'openrouter/moonshotai/kimi-k2.6'],
    ];
    for (const [provider, model] of firstParty) {
      const resolved = resolveModelPricing(provider, model);
      expect(resolved.source, `${provider}:${model} must price offline`).toBe('static');
      expect(priceForRun(provider, model, { in: 1000, out: 1000 }).matched).toBe(true);
    }
  });

  it('free-tier aliases still price $0.00 offline (free rule needs no cache)', () => {
    for (const model of ['opencode/deepseek-v4-flash-free', 'opencode/nemotron-3-super-free']) {
      const resolved = resolveModelPricing('opencode', model);
      expect(resolved.source).toBe('free');
      expect(priceForRun('opencode', model, { in: 1_000_000, out: 1_000_000 }).usd).toBe(0);
    }
  });

  it('genuinely unknown models stay unpriced offline too', () => {
    expect(isModelPriced('claude', 'claude-future-99')).toBe(false);
    expect(isModelPriced('opencode', 'opencode/some-internal-alias')).toBe(false);
  });
});
