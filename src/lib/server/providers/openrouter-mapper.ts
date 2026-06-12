// src/lib/server/providers/openrouter-mapper.ts
//
// Typed facade over the shared model-pricing core. The actual mapping
// logic (explicit provider→OpenRouter id rules, name-based vendor
// inference, free-tier detection) lives in `cli/lib/model-pricing.mjs` so
// the CLI write side (cli/usage-tracker.mjs) and this TS display side
// share ONE lookup and can't drift — same .mjs bridge as opencode.ts →
// cli/classify-error.mjs.
//
// `mapToOpenRouter` returns `null` when no explicit mapping rule applies —
// callers should then try `inferOpenRouterCandidates` (each candidate
// validated by OR-cache membership) before the free rule / static
// fallback. See resolveModelPricing in pricing.ts for the full order.

import 'server-only';
import {
  canonicalModelKey as canonicalModelKeyCore,
  inferOpenRouterCandidates as inferOpenRouterCandidatesCore,
  mapToOpenRouter as mapToOpenRouterCore,
} from '../../../../cli/lib/model-pricing.mjs';
import type { ProviderId } from '../../schemas/providers';

export function mapToOpenRouter(provider: ProviderId, modelId: string): string | null {
  return mapToOpenRouterCore(provider, modelId);
}

export function inferOpenRouterCandidates(modelId: string): string[] {
  return inferOpenRouterCandidatesCore(modelId);
}

export function canonicalModelKey(raw: string): string {
  return canonicalModelKeyCore(raw);
}
