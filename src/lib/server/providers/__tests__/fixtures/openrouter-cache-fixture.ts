// openrouter-cache-fixture.ts
//
// Hermetic snapshot of the OpenRouter pricing cache (subset of the live
// /api/v1/models catalog, captured 2026-06-10) for the model-pricing
// coverage tests. Two deliberate properties:
//
//   - `deepseek/deepseek-v4-flash:free` is ABSENT while the PAID
//     `deepseek/deepseek-v4-flash` is present — locks the regression where
//     the free-tier alias must price $0.00 via the free rule and must NOT
//     fall back to the paid base rate.
//   - `nvidia/nemotron-3-super-120b-a12b:free` is present at 0/0 — a free
//     tier that prices straight from the cache.

import type { ProviderId } from '../../../../schemas/providers';

export interface FixturePrice {
  in_per_mtok: number;
  out_per_mtok: number;
}

export const OR_CACHE_FIXTURE: Record<string, FixturePrice> = {
  // ── anthropic ──
  'anthropic/claude-sonnet-4.6': { in_per_mtok: 3, out_per_mtok: 15 },
  'anthropic/claude-sonnet-4.5': { in_per_mtok: 3, out_per_mtok: 15 },
  'anthropic/claude-haiku-4.5': { in_per_mtok: 1, out_per_mtok: 5 },
  'anthropic/claude-opus-4.7': { in_per_mtok: 5, out_per_mtok: 25 },
  'anthropic/claude-opus-4.8': { in_per_mtok: 5, out_per_mtok: 25 },
  'anthropic/claude-fable-5': { in_per_mtok: 10, out_per_mtok: 50 },
  'anthropic/claude-3.5-haiku': { in_per_mtok: 0.8, out_per_mtok: 4 },
  'anthropic/claude-3-haiku': { in_per_mtok: 0.25, out_per_mtok: 1.25 },
  // ── openai ──
  'openai/gpt-5.5': { in_per_mtok: 5, out_per_mtok: 30 },
  'openai/gpt-5.4': { in_per_mtok: 2.5, out_per_mtok: 15 },
  'openai/gpt-5.4-mini': { in_per_mtok: 0.75, out_per_mtok: 4.5 },
  'openai/gpt-5.3-codex': { in_per_mtok: 1.75, out_per_mtok: 14 },
  'openai/gpt-5.2': { in_per_mtok: 1.75, out_per_mtok: 14 },
  'openai/gpt-5': { in_per_mtok: 1.25, out_per_mtok: 10 },
  'openai/o1': { in_per_mtok: 15, out_per_mtok: 60 },
  // ── OSS vendors (opencode-routed) ──
  'moonshotai/kimi-k2.6': { in_per_mtok: 0.68, out_per_mtok: 3.41 },
  'moonshotai/kimi-k2.5': { in_per_mtok: 0.4, out_per_mtok: 1.9 },
  'qwen/qwen3.6-plus': { in_per_mtok: 0.325, out_per_mtok: 1.95 },
  'z-ai/glm-5.1': { in_per_mtok: 0.98, out_per_mtok: 3.08 },
  'deepseek/deepseek-v4-pro': { in_per_mtok: 0.435, out_per_mtok: 0.87 },
  'deepseek/deepseek-v4-flash': { in_per_mtok: 0.0983, out_per_mtok: 0.1966 },
  'xiaomi/mimo-v2.5-pro': { in_per_mtok: 0.435, out_per_mtok: 0.87 },
  'minimax/minimax-m2.7': { in_per_mtok: 0.27, out_per_mtok: 1.08 },
  'nvidia/nemotron-3-super-120b-a12b:free': { in_per_mtok: 0, out_per_mtok: 0 },
};

/**
 * Every model id the three CLIs can emit into data/usage.json, per the
 * model-pricing-coverage spec §4: the claude family including dated, `[1m]`
 * and fable variants (usage-tracker RATES keys + `claude --model` list
 * patterns), the codex gpt ids (FALLBACK_MODELS in codex.ts + the
 * gpt-5.5-codex alias + o-series), and the opencode catalog (STATIC_FALLBACK
 * in opencode.ts, the opencode/* free aliases, opencode-go routed names, and
 * the bare-id shape the opencode bucket has recorded in the wild).
 *
 * The coverage test asserts EVERY one of these resolves to a price (dollars
 * or $0.00) against OR_CACHE_FIXTURE — a new model that misses becomes a
 * failing test, not a silent N/A.
 */
export const CLI_EMITTABLE_MODEL_IDS: ReadonlyArray<readonly [ProviderId, string]> = [
  // claude — bare, dated, [1m], -1m, fable, legacy haiku 3.x
  ['claude', 'claude-haiku-4-5'],
  ['claude', 'claude-haiku-4-5-20251001'],
  ['claude', 'claude-sonnet-4-6'],
  ['claude', 'claude-sonnet-4-6-20260201'],
  ['claude', 'claude-sonnet-4-6[1m]'],
  ['claude', 'claude-sonnet-4-5-20250929[1m]'],
  ['claude', 'claude-opus-4-7'],
  ['claude', 'claude-opus-4-7-1m'],
  ['claude', 'claude-opus-4-7[1m]'],
  ['claude', 'claude-opus-4-8'],
  ['claude', 'claude-fable-5'],
  ['claude', 'claude-fable-5[1m]'],
  ['claude', 'claude-haiku-3-5'],
  ['claude', 'claude-haiku-3'],
  // codex — FALLBACK_MODELS + alias + o-series
  ['codex', 'gpt-5.5'],
  ['codex', 'gpt-5.5-codex'],
  ['codex', 'gpt-5.4'],
  ['codex', 'gpt-5.4-mini'],
  ['codex', 'gpt-5.3-codex'],
  ['codex', 'gpt-5.2'],
  ['codex', 'gpt-5'],
  ['codex', 'o1'],
  // opencode — curated picker list, free aliases, opencode-go names, bare ids
  ['opencode', 'anthropic/claude-3-haiku'],
  ['opencode', 'anthropic/claude-3-sonnet'],
  ['opencode', 'openrouter/moonshotai/kimi-k2.6'],
  ['opencode', 'opencode/deepseek-v4-flash-free'],
  ['opencode', 'opencode/nemotron-3-super-free'],
  ['opencode', 'opencode-go/kimi-k2.6'],
  ['opencode', 'opencode-go/kimi-k2.5'],
  ['opencode', 'opencode-go/qwen3.6-plus'],
  ['opencode', 'opencode-go/glm-5.1'],
  ['opencode', 'opencode-go/deepseek-v4-pro'],
  ['opencode', 'opencode-go/mimo-v2.5-pro'],
  ['opencode', 'opencode-go/minimax-m2.7'],
  ['opencode', 'kimi-k2.6'], // recorded BARE in the wild (regression case 1)
];
