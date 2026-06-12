// SPDX-License-Identifier: MIT
// cli/lib/model-pricing.mjs
//
// Shared model-pricing lookup — the ONE source of truth consumed by BOTH
// sides of the spend ledger:
//
//   - write side: cli/usage-tracker.mjs (persists cost_usd to data/usage.json)
//   - display side: src/lib/server/providers/pricing.ts (analytics dashboard,
//     job-cost estimates)
//
// Both consume `resolveModelPrice()` so persisted dollars and displayed
// dollars cannot diverge. It lives in cli/lib (plain .mjs, no TS, no
// 'server-only') because the CLI scripts can't load TS modules, while the
// TS server layer CAN import .mjs (same bridge as
// src/lib/server/providers/opencode.ts → cli/classify-error.mjs).
//
// Lookup order (docs spec 2026-06-10 — "all models should be priced; N/A is
// a bug, not a category"):
//
//   1. OpenRouter cache via EXPLICIT mapping  (mapToOpenRouter)
//   2. OpenRouter cache via NAME INFERENCE    (inferOpenRouterCandidates —
//      wrapper-strip + vendor-by-model-name-prefix; validated by cache
//      membership, so a wrong guess can't invent a price)
//   3. FREE rule — recorded id ends `-free` or maps to a `:free` OR id:
//      its true price is $0.00, which IS a price. Never N/A.
//   4. STATIC table — offline fallback only (self-hosted requirement:
//      everything keeps pricing when the OR cache file is missing/stale)
//   5. unpriced — genuinely unknown; the UI may render N/A
//
// The OpenRouter cache itself (data/openrouter-pricing-cache.json) is
// refreshed every 24h in the background by the web layer
// (src/lib/server/providers/openrouter-pricing.ts) and on demand via
// `node cli/refresh-openrouter-pricing.mjs`. This module never does I/O —
// callers inject a `getOpenRouterPrice(orId)` lookup.

/** @typedef {'claude'|'codex'|'opencode'} ProviderId */
/** @typedef {{ in_per_mtok: number, out_per_mtok: number }} ModelPrice */
/**
 * @typedef {{
 *   source: 'openrouter'|'free'|'static'|'unpriced',
 *   orId: string|null,
 *   price: ModelPrice|null,
 * }} ResolvedModelPrice
 */
/** @typedef {(orId: string) => ModelPrice | null | undefined} OpenRouterLookup */

// ─── canonical model key ───────────────────────────────────────────────────
//
// Collapses the variant suffixes the Claude CLI emits onto one canonical
// family key. Shared by the analytics aggregator (one dashboard row per
// model family), the usage loader (pricedModels keys), the Claude mapper
// (strip before dash→dot), and the static-table lookup below.

/**
 * Strip the `[1m]` context-window marker, the 8-digit date suffix, and the
 * `-1m` variant marker (`[1m]` first so the date strip fires on
 * 'name-20250929[1m]').
 *
 *   'claude-sonnet-4-5-20250929[1m]' → 'claude-sonnet-4-5'
 *   'claude-haiku-4-5-20251001'      → 'claude-haiku-4-5'
 *   'claude-opus-4-7-1m'             → 'claude-opus-4-7'
 *
 * OpenCode ids ('anthropic/claude-3-haiku') and codex ids ('gpt-5') don't
 * match any pattern and pass through unchanged.
 *
 * @param {string} raw
 * @returns {string}
 */
export function canonicalModelKey(raw) {
  return String(raw)
    .replace(/\[1m\]$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-1m$/, '');
}

// ─── explicit provider → OpenRouter id mapping ─────────────────────────────

// OR id gaps — sur9e/CLI ids whose exact name has no OpenRouter entry but
// whose pricing family does (verified against the live /api/v1/models
// catalog 2026-06-10: there is no `openai/gpt-5.5-codex`; the codex variant
// bills as the base `openai/gpt-5.5`).
const OPENROUTER_ALIASES = {
  'gpt-5.5-codex': 'openai/gpt-5.5',
};

/**
 * Claude model name (canonical, bare) → OpenRouter id. Version segments use
 * dots on OR: `claude-sonnet-4-6` → `anthropic/claude-sonnet-4.6`.
 * Handles the legacy Haiku 3.x tier/version swap (`claude-haiku-3-5` →
 * `anthropic/claude-3.5-haiku`).
 *
 * @param {string} modelId
 * @returns {string|null}
 */
function mapClaude(modelId) {
  // Strip dated / [1m] / -1m variant suffixes first.
  const s = canonicalModelKey(modelId);
  // Special-case Haiku 3.x naming: OR uses `claude-3.5-haiku` for sur9e
  // `claude-haiku-3-5`, and `claude-3-haiku` for `claude-haiku-3`.
  const haikuLegacy = s.match(/^claude-haiku-(\d)(?:-(\d))?$/);
  if (haikuLegacy) {
    const major = haikuLegacy[1];
    const minor = haikuLegacy[2];
    if (major === '3') {
      return minor ? `anthropic/claude-${major}.${minor}-haiku` : 'anthropic/claude-3-haiku';
    }
    // 4.x falls through to the generic transform below.
  }
  // Generic: collapse trailing -N or -N-M into .N / N.M.
  const generic = s.match(/^(claude-(?:opus|sonnet|haiku|fable))-(\d+)(?:-(\d+))?$/);
  if (!generic) return null;
  const tier = generic[1];
  const major = generic[2];
  const minor = generic[3];
  if (minor) {
    return `anthropic/${tier}-${major}.${minor}`;
  }
  return `anthropic/${tier}-${major}`;
}

/**
 * Codex CLI ids are OpenAI model names (`gpt-5.5`, `gpt-5.4-mini`,
 * `gpt-5.3-codex`) — OR exposes them under `openai/`. Ids without their own
 * OR entry go through OPENROUTER_ALIASES first.
 *
 * @param {string} modelId
 * @returns {string|null}
 */
function mapCodex(modelId) {
  if (OPENROUTER_ALIASES[modelId]) return OPENROUTER_ALIASES[modelId];
  if (!modelId.startsWith('gpt-')) return null;
  return `openai/${modelId}`;
}

/**
 * OpenCode ids use a two-segment shape: `<bucket>/<vendor-model>`.
 *   - `opencode/*`     → free-tier OpenCode-platform models (some have OR
 *                        equivalents under `:free` suffixes, others are
 *                        OpenCode-internal aliases with no public mapping)
 *   - `opencode-go/*`  → paid OSS-routed models, vendor inferred from the
 *                        model-name prefix (shared VENDOR_PREFIXES table)
 *
 * @param {string} modelId
 * @returns {string|null}
 */
function mapOpenCode(modelId) {
  // ── opencode/* free-tier ───────────────────────────────────────────
  if (modelId === 'opencode/deepseek-v4-flash-free') {
    return 'deepseek/deepseek-v4-flash:free';
  }
  if (modelId === 'opencode/nemotron-3-super-free') {
    return 'nvidia/nemotron-3-super-120b-a12b:free';
  }
  // Other opencode/* aliases (OpenCode-internal labels) have no explicit OR
  // equivalent — name inference / free rule / static fallback apply.
  if (modelId.startsWith('opencode/')) return null;

  // ── opencode-go/* paid routed ──────────────────────────────────────
  if (!modelId.startsWith('opencode-go/')) return null;
  return inferVendorScopedId(modelId.slice('opencode-go/'.length));
}

/**
 * Translate a sur9e provider:model id into its explicit OpenRouter id.
 * Returns null when no explicit rule applies — callers should then try
 * `inferOpenRouterCandidates` (validated against the cache) before falling
 * back to the free rule / static tables.
 *
 * @param {ProviderId} provider
 * @param {string} modelId
 * @returns {string|null}
 */
export function mapToOpenRouter(provider, modelId) {
  switch (provider) {
    case 'claude':
      return mapClaude(modelId);
    case 'codex':
      return mapCodex(modelId);
    case 'opencode':
      return mapOpenCode(modelId);
    default:
      return null;
  }
}

// ─── name-based vendor inference (universal fallback) ──────────────────────

// Model-name prefix → OpenRouter vendor namespace. One shared table for
// every provider bucket — CLIs sometimes record ids bare (no wrapper), and
// the vendor is recoverable from the name itself. Guesses are only trusted
// when the resulting id exists in the OR cache (see resolveModelPrice).
const VENDOR_PREFIXES = [
  ['kimi-', 'moonshotai'],
  ['qwen', 'qwen'],
  ['glm-', 'z-ai'],
  ['deepseek-', 'deepseek'],
  ['mimo-', 'xiaomi'],
  ['minimax-', 'minimax'],
  ['gpt-', 'openai'],
  ['gemini-', 'google'],
  ['llama-', 'meta-llama'],
  ['mistral-', 'mistralai'],
  ['mixtral-', 'mistralai'],
  ['nemotron-', 'nvidia'],
  ['grok-', 'x-ai'],
];

/**
 * Infer `vendor/name` from a bare model name. Claude names go through the
 * dash→dot transform; OpenAI also covers the o-series (`o1`, `o3-mini`).
 *
 * @param {string} name
 * @returns {string|null}
 */
function inferVendorScopedId(name) {
  if (name.startsWith('claude-')) return mapClaude(name);
  if (/^o\d/.test(name)) return `openai/${name}`;
  for (const [prefix, vendor] of VENDOR_PREFIXES) {
    if (name.startsWith(prefix)) return `${vendor}/${name}`;
  }
  return null;
}

/**
 * Candidate OpenRouter ids for a recorded model id, in trust order, for
 * when the explicit mapping misses. Provider-agnostic: handles bare names
 * ('kimi-k2.6'), wrapped names ('opencode-go/kimi-k2.6',
 * 'openrouter/moonshotai/kimi-k2.6'), and already-vendor-scoped ids
 * ('anthropic/claude-3-haiku').
 *
 * Free-tier shapes: a `-free` suffix maps ONLY to the `:free` OR variant —
 * never to the paid base id (a free run must not price at paid rates; if
 * the `:free` variant is absent from the cache the free rule prices it $0).
 *
 * Candidates are guesses: callers MUST validate membership in the OR cache
 * before trusting one.
 *
 * @param {string} modelId
 * @returns {string[]}
 */
export function inferOpenRouterCandidates(modelId) {
  let name = String(modelId);
  // Strip known wrapper prefixes.
  for (const wrapper of ['opencode-go/', 'opencode/', 'openrouter/']) {
    if (name.startsWith(wrapper)) {
      name = name.slice(wrapper.length);
      break;
    }
  }
  const out = [];
  if (name.includes('/')) {
    // Already vendor-scoped — it may BE an OpenRouter id.
    out.push(name);
    return out;
  }
  if (name.endsWith(':free')) {
    const scoped = inferVendorScopedId(name.slice(0, -':free'.length));
    if (scoped) out.push(`${scoped}:free`);
    return out;
  }
  if (name.endsWith('-free')) {
    const scoped = inferVendorScopedId(name.slice(0, -'-free'.length));
    if (scoped) out.push(`${scoped}:free`);
    return out;
  }
  const scoped = inferVendorScopedId(name);
  if (scoped) out.push(scoped);
  return out;
}

// ─── free rule ─────────────────────────────────────────────────────────────

/**
 * A model is FREE (true price $0.00) when its recorded id is a free-tier
 * shape: it ends in `-free`/`:free` (after wrapper strip), or its explicit
 * OR mapping is a `:free` id. The third free shape — a cache entry priced
 * 0/0 — is covered by the cache hit itself in resolveModelPrice.
 *
 * @param {ProviderId} provider
 * @param {string} modelId
 * @returns {boolean}
 */
export function isFreeTierId(provider, modelId) {
  let name = String(modelId);
  for (const wrapper of ['opencode-go/', 'opencode/', 'openrouter/']) {
    if (name.startsWith(wrapper)) {
      name = name.slice(wrapper.length);
      break;
    }
  }
  if (name.endsWith('-free') || name.endsWith(':free')) return true;
  const explicit = mapToOpenRouter(provider, modelId);
  return explicit != null && explicit.endsWith(':free');
}

// ─── static offline fallback tables ────────────────────────────────────────
//
// $/1M tokens. OFFLINE FALLBACK ONLY — the OpenRouter cache is the primary
// source for every lookup; these keep first-party models priced when the
// cache file is missing or the model predates the last refresh (self-hosted
// requirement). Keys are canonical (see canonicalModelKey). AUDIT QUARTERLY.

/** @type {Record<ProviderId, Record<string, ModelPrice>>} */
export const STATIC_PRICING = {
  claude: {
    'claude-haiku-4-5': { in_per_mtok: 0.8, out_per_mtok: 4.0 },
    'claude-sonnet-4-6': { in_per_mtok: 3.0, out_per_mtok: 15.0 },
    'claude-opus-4-7': { in_per_mtok: 15.0, out_per_mtok: 75.0 },
    'claude-fable-5': { in_per_mtok: 10.0, out_per_mtok: 50.0 },
  },
  codex: {
    'gpt-5': { in_per_mtok: 2.5, out_per_mtok: 10.0 },
    'gpt-5.5': { in_per_mtok: 5.0, out_per_mtok: 15.0 },
    'gpt-5.5-codex': { in_per_mtok: 5.0, out_per_mtok: 15.0 },
    o1: { in_per_mtok: 15.0, out_per_mtok: 60.0 },
  },
  opencode: {
    'anthropic/claude-3-haiku': { in_per_mtok: 0.25, out_per_mtok: 1.25 },
    'anthropic/claude-3-sonnet': { in_per_mtok: 3.0, out_per_mtok: 15.0 },
    'openrouter/moonshotai/kimi-k2.6': { in_per_mtok: 0.5, out_per_mtok: 2.5 },
  },
};

// ─── resolution ────────────────────────────────────────────────────────────

const FREE_PRICE = Object.freeze({ in_per_mtok: 0, out_per_mtok: 0 });

/**
 * Resolve the price of a (provider, model) pair through the spec's
 * OpenRouter-first order. `getOpenRouterPrice` is injected so the same
 * logic runs against the web layer's in-memory cache (pricing.ts) and the
 * CLI's direct cache-file read (usage-tracker.mjs) — and against fixture
 * maps in tests.
 *
 * `source: 'unpriced'` (price null) means genuinely unknown — the only case
 * where the UI may render N/A.
 *
 * @param {ProviderId} provider
 * @param {string} modelId
 * @param {OpenRouterLookup} getOpenRouterPrice
 * @returns {ResolvedModelPrice}
 */
export function resolveModelPrice(provider, modelId, getOpenRouterPrice) {
  // 1. OR cache via explicit mapping.
  const explicit = mapToOpenRouter(provider, modelId);
  if (explicit) {
    const price = getOpenRouterPrice(explicit);
    if (price) return { source: 'openrouter', orId: explicit, price };
  }
  // 2. OR cache via name inference — cache membership validates the guess;
  //    a candidate absent from the cache falls through (wrong guesses can't
  //    invent prices).
  for (const candidate of inferOpenRouterCandidates(modelId)) {
    if (candidate === explicit) continue;
    const price = getOpenRouterPrice(candidate);
    if (price) return { source: 'openrouter', orId: candidate, price };
  }
  // 3. Free rule — $0.00 is a price; N/A must mean genuinely unknown.
  if (isFreeTierId(provider, modelId)) {
    return { source: 'free', orId: explicit, price: FREE_PRICE };
  }
  // 4. Static offline fallback.
  const staticPrice = STATIC_PRICING[provider]?.[canonicalModelKey(modelId)];
  if (staticPrice) return { source: 'static', orId: null, price: staticPrice };
  // 5. Genuinely unknown.
  return { source: 'unpriced', orId: null, price: null };
}
