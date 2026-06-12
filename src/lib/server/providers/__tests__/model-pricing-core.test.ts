// model-pricing-core.test.ts — unit tests for the shared model-pricing
// lookup (cli/lib/model-pricing.mjs): canonical key, wrapper strip + vendor
// inference, free rule, and the OpenRouter-first resolution order. Pure —
// the OR cache is injected as a plain lookup function, no I/O.

import { describe, expect, it } from 'vitest';
import {
  canonicalModelKey,
  inferOpenRouterCandidates,
  isFreeTierId,
  resolveModelPrice,
  STATIC_PRICING,
} from '../../../../../cli/lib/model-pricing.mjs';
import { OR_CACHE_FIXTURE } from './fixtures/openrouter-cache-fixture';

const cacheLookup = (orId: string) => OR_CACHE_FIXTURE[orId] ?? null;
const emptyCache = () => null;

describe('canonicalModelKey', () => {
  it('strips [1m], dated, and -1m suffixes ([1m] before the date)', () => {
    expect(canonicalModelKey('claude-sonnet-4-5-20250929[1m]')).toBe('claude-sonnet-4-5');
    expect(canonicalModelKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(canonicalModelKey('claude-opus-4-7-1m')).toBe('claude-opus-4-7');
    expect(canonicalModelKey('claude-fable-5[1m]')).toBe('claude-fable-5');
  });

  it('passes codex / opencode ids through unchanged', () => {
    expect(canonicalModelKey('gpt-5.5')).toBe('gpt-5.5');
    expect(canonicalModelKey('anthropic/claude-3-haiku')).toBe('anthropic/claude-3-haiku');
    expect(canonicalModelKey('opencode/deepseek-v4-flash-free')).toBe(
      'opencode/deepseek-v4-flash-free',
    );
  });
});

describe('inferOpenRouterCandidates', () => {
  it('infers the vendor for bare OSS model names', () => {
    expect(inferOpenRouterCandidates('kimi-k2.6')).toEqual(['moonshotai/kimi-k2.6']);
    expect(inferOpenRouterCandidates('qwen3.6-plus')).toEqual(['qwen/qwen3.6-plus']);
    expect(inferOpenRouterCandidates('glm-5.1')).toEqual(['z-ai/glm-5.1']);
    expect(inferOpenRouterCandidates('deepseek-v4-pro')).toEqual(['deepseek/deepseek-v4-pro']);
    expect(inferOpenRouterCandidates('mimo-v2.5-pro')).toEqual(['xiaomi/mimo-v2.5-pro']);
    expect(inferOpenRouterCandidates('minimax-m2.7')).toEqual(['minimax/minimax-m2.7']);
    expect(inferOpenRouterCandidates('nemotron-3-super-120b-a12b')).toEqual([
      'nvidia/nemotron-3-super-120b-a12b',
    ]);
    expect(inferOpenRouterCandidates('grok-4')).toEqual(['x-ai/grok-4']);
    expect(inferOpenRouterCandidates('gemini-2.5-pro')).toEqual(['google/gemini-2.5-pro']);
    expect(inferOpenRouterCandidates('llama-4-maverick')).toEqual(['meta-llama/llama-4-maverick']);
    expect(inferOpenRouterCandidates('mistral-large')).toEqual(['mistralai/mistral-large']);
    expect(inferOpenRouterCandidates('mixtral-8x22b')).toEqual(['mistralai/mixtral-8x22b']);
    expect(inferOpenRouterCandidates('gpt-5.4')).toEqual(['openai/gpt-5.4']);
    expect(inferOpenRouterCandidates('o1')).toEqual(['openai/o1']);
  });

  it('routes bare claude names through the dash→dot transform', () => {
    expect(inferOpenRouterCandidates('claude-sonnet-4-6')).toEqual(['anthropic/claude-sonnet-4.6']);
    expect(inferOpenRouterCandidates('claude-fable-5[1m]')).toEqual(['anthropic/claude-fable-5']);
  });

  it('strips opencode/, opencode-go/, openrouter/ wrappers', () => {
    expect(inferOpenRouterCandidates('opencode-go/kimi-k2.6')).toEqual(['moonshotai/kimi-k2.6']);
    expect(inferOpenRouterCandidates('openrouter/moonshotai/kimi-k2.6')).toEqual([
      'moonshotai/kimi-k2.6',
    ]);
  });

  it('passes already-vendor-scoped ids through as the single candidate', () => {
    expect(inferOpenRouterCandidates('anthropic/claude-3-haiku')).toEqual([
      'anthropic/claude-3-haiku',
    ]);
  });

  it('maps a -free suffix ONLY to the :free OR variant, never the paid base', () => {
    expect(inferOpenRouterCandidates('opencode/deepseek-v4-flash-free')).toEqual([
      'deepseek/deepseek-v4-flash:free',
    ]);
  });

  it('returns no candidates when the vendor cannot be inferred', () => {
    expect(inferOpenRouterCandidates('big-puzzle')).toEqual([]);
    expect(inferOpenRouterCandidates('opencode/some-internal-alias')).toEqual([]);
  });
});

describe('isFreeTierId', () => {
  it('flags -free recorded ids and :free explicit mappings', () => {
    expect(isFreeTierId('opencode', 'opencode/deepseek-v4-flash-free')).toBe(true);
    expect(isFreeTierId('opencode', 'opencode/nemotron-3-super-free')).toBe(true);
    expect(isFreeTierId('opencode', 'deepseek-v4-flash-free')).toBe(true);
  });

  it('does not flag paid or unknown ids', () => {
    expect(isFreeTierId('opencode', 'kimi-k2.6')).toBe(false);
    expect(isFreeTierId('claude', 'claude-sonnet-4-6')).toBe(false);
    expect(isFreeTierId('opencode', 'opencode/some-internal-alias')).toBe(false);
  });
});

describe('resolveModelPrice — OpenRouter-first order', () => {
  it('1. explicit mapping hits the cache first', () => {
    const r = resolveModelPrice('claude', 'claude-sonnet-4-6', cacheLookup);
    expect(r.source).toBe('openrouter');
    expect(r.orId).toBe('anthropic/claude-sonnet-4.6');
    expect(r.price).toEqual({ in_per_mtok: 3, out_per_mtok: 15 });
  });

  it('2. name inference prices bare ids when the guess exists in the cache', () => {
    const r = resolveModelPrice('opencode', 'kimi-k2.6', cacheLookup);
    expect(r.source).toBe('openrouter');
    expect(r.orId).toBe('moonshotai/kimi-k2.6');
    expect(r.price?.in_per_mtok).toBeCloseTo(0.68, 6);
  });

  it('2b. an inferred id ABSENT from the cache falls through — wrong guesses cannot invent prices', () => {
    // 'kimi-k99' infers moonshotai/kimi-k99, which no cache has.
    const r = resolveModelPrice('opencode', 'kimi-k99', cacheLookup);
    expect(r.source).toBe('unpriced');
    expect(r.price).toBeNull();
  });

  it('3. free rule prices a -free alias $0.00 when its :free OR id is missing from the cache', () => {
    // Fixture deliberately lacks deepseek/deepseek-v4-flash:free but HAS the
    // paid deepseek/deepseek-v4-flash — the free alias must price $0, not at
    // the paid base rate, and never N/A.
    const r = resolveModelPrice('opencode', 'opencode/deepseek-v4-flash-free', cacheLookup);
    expect(r.source).toBe('free');
    expect(r.price).toEqual({ in_per_mtok: 0, out_per_mtok: 0 });
  });

  it('3b. a :free OR id present in the cache prices straight from the cache at 0/0', () => {
    const r = resolveModelPrice('opencode', 'opencode/nemotron-3-super-free', cacheLookup);
    expect(r.source).toBe('openrouter');
    expect(r.orId).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    expect(r.price).toEqual({ in_per_mtok: 0, out_per_mtok: 0 });
  });

  it('4. static tables price first-party models when the cache is empty (offline)', () => {
    for (const [provider, table] of Object.entries(STATIC_PRICING)) {
      for (const [model, expected] of Object.entries(table)) {
        const r = resolveModelPrice(provider as 'claude' | 'codex' | 'opencode', model, emptyCache);
        expect(r.source, `${provider}:${model} must price offline`).toBe('static');
        expect(r.price).toEqual(expected);
      }
    }
  });

  it('4b. offline static lookup canonicalizes dated/[1m] claude variants', () => {
    const r = resolveModelPrice('claude', 'claude-haiku-4-5-20251001', emptyCache);
    expect(r.source).toBe('static');
    expect(r.price).toEqual({ in_per_mtok: 0.8, out_per_mtok: 4 });
  });

  it('4c. the OR cache takes precedence over a static entry for the same model', () => {
    // haiku-4-5: static says 0.8/4 (stale), cache says 1/5 — cache wins.
    const r = resolveModelPrice('claude', 'claude-haiku-4-5', cacheLookup);
    expect(r.source).toBe('openrouter');
    expect(r.price).toEqual({ in_per_mtok: 1, out_per_mtok: 5 });
  });

  it('5. genuinely unknown models resolve unpriced', () => {
    expect(resolveModelPrice('claude', 'claude-future-99', cacheLookup).source).toBe('unpriced');
    expect(resolveModelPrice('opencode', 'opencode/some-internal-alias', cacheLookup).source).toBe(
      'unpriced',
    );
  });

  it('codex alias: gpt-5.5-codex prices through openai/gpt-5.5 (no separate OR id)', () => {
    const r = resolveModelPrice('codex', 'gpt-5.5-codex', cacheLookup);
    expect(r.source).toBe('openrouter');
    expect(r.orId).toBe('openai/gpt-5.5');
  });
});
