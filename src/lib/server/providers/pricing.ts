// src/lib/server/providers/pricing.ts
//
// Cost lookup for the provider-adapter layer. OpenRouter's live
// /api/v1/models catalog is the PRIMARY source; resolution follows the
// model-pricing spec (2026-06-10 — "all models should be priced; N/A is a
// bug, not a category"):
//
//   1. OR cache via explicit mapping   (mapToOpenRouter)
//   2. OR cache via name inference     (bare/wrapped ids — each candidate
//      validated by cache membership, so wrong guesses can't invent prices)
//   3. Free rule                       (`-free` / `:free` ids price $0.00 —
//      a real price, never N/A)
//   4. Static table                    (OFFLINE FALLBACK only — keeps
//      first-party models priced when the cache file is missing/stale;
//      self-hosted requirement)
//   5. unpriced                        → { usd: 0, matched: false } → N/A
//
// The shared lookup itself lives in `cli/lib/model-pricing.mjs` so the
// write side (cli/usage-tracker.mjs, which persists cost_usd) and this
// display side price through the SAME logic and can't diverge.
//
// The OR cache (data/openrouter-pricing-cache.json) is read synchronously
// from memory via getOpenRouterPrice — seeded from disk, refreshed in the
// background every 24h, and refreshable on demand with
// `node cli/refresh-openrouter-pricing.mjs`. `priceForRun` stays
// SYNCHRONOUS so every caller (the usage tracker, the analytics
// aggregator, server-side renderers) keeps its current shape.

import 'server-only';
import { resolveModelPrice } from '../../../../cli/lib/model-pricing.mjs';
import { ROOT } from '../../root';
import type { ProviderId } from '../../schemas/providers';
import { getOpenRouterPrice } from './openrouter-pricing';

export type Price = { in_per_mtok: number; out_per_mtok: number; currency: 'USD' };
export type PricingKey = `${ProviderId}:${string}`;

export type PriceSource = 'openrouter' | 'free' | 'static' | 'unpriced';

export interface ResolvedModelPricing {
  source: PriceSource;
  /** OpenRouter id the price came from (or the explicit mapping for free rows). */
  orId: string | null;
  /** $/Mtok — null only when source === 'unpriced'. */
  price: { in_per_mtok: number; out_per_mtok: number } | null;
}

/**
 * Full 5-step resolution for a (provider, model) pair against the live
 * OpenRouter cache. See module docblock for the order.
 */
export function resolveModelPricing(provider: ProviderId, model: string): ResolvedModelPricing {
  return resolveModelPrice(provider, model, orId => getOpenRouterPrice(orId, ROOT));
}

/**
 * Resolve the cost of a single run.
 *
 * Returns `{ usd, matched }`:
 *   - `matched: true`  → cost computed from a real price: a live OpenRouter
 *                        rate, the free rule (legitimately $0.00), or the
 *                        static offline fallback
 *   - `matched: false` → genuinely unknown model; usd is 0 and the UI
 *                        should surface "N/A"
 *
 * Callers that persist cost (jobs/runner.ts, usage-tracker) must NOT
 * fabricate a dollar value when matched is false — record 0 and let the
 * display layer (or aggregator) distinguish $0 (free) from N/A (unknown).
 */
export function priceForRun(
  provider: ProviderId,
  model: string,
  tokens: { in: number; out: number },
): { usd: number; matched: boolean } {
  const resolved = resolveModelPricing(provider, model);
  if (!resolved.price) return { usd: 0, matched: false };
  const usd =
    (tokens.in * resolved.price.in_per_mtok + tokens.out * resolved.price.out_per_mtok) / 1_000_000;
  return { usd, matched: true };
}

/**
 * Sync check: does this (provider, model) resolve to a price? True for live
 * OpenRouter rates, free-tier $0.00, and static-fallback models. Used by
 * the analytics aggregator to know which `by_model` rows should render
 * "N/A" in the dashboard regardless of the persisted cost number.
 */
export function isModelPriced(provider: ProviderId, model: string): boolean {
  return resolveModelPricing(provider, model).source !== 'unpriced';
}
