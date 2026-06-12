// SPDX-License-Identifier: MIT
// usage-tracker.mjs
// Persists API spend per-month to data/usage.json. Tracks claude/codex/opencode
// in sibling buckets under each month key.
// Scrapingdog/SerpAPI/ScrapeAPI tracking was removed 2026-05-04 (deprecated;
// historical entries in data/usage.json kept read-only).
//
// Public API:
//   trackProvider(providerId, inputTokens, outputTokens, opts)
//     Generic per-provider tracker. providerId is 'claude' | 'codex' | 'opencode'.
//     opts: { model?, mode?, cost_usd?, rootPath?, estimated? }
//       cost_usd  → if present, store directly. For claude this is preferred
//                   (sourced from claude's stream-json result.total_cost_usd).
//                   For codex/opencode we resolve it through the SHARED
//                   model-pricing lookup (cli/lib/model-pricing.mjs — the
//                   same one the analytics display layer uses): OpenRouter
//                   cache first, then name inference, free rule, and the
//                   static offline tables. Genuinely unknown models persist
//                   cost_usd: 0 rather than fabricate a price.
//       model     → provider-namespaced model id. Claude: 'claude-sonnet-4-6'
//                   (incl. dated suffix). Codex: 'gpt-5' etc. OpenCode:
//                   'anthropic/claude-3-haiku' etc.
//       mode      → 'evaluate' | 'screen' | future modes
//       rootPath  → repo root override. CLI scripts can omit it (cwd is the
//                   repo root in normal invocation). Server callers loading
//                   this through Turbopack MUST pass rootPath — bundling
//                   strips import.meta.dirname, which would otherwise drop
//                   usage.json one dir above the repo.
//       estimated → true for synthetic rows (currently: OpenCode runs estimated
//                   via tiktoken at job close). Increments `estimated_calls`
//                   on the bucket AND on `by_model[model]` so the analytics
//                   dashboard can badge approximate rows.
//   trackClaude(inputTokens, outputTokens, opts)
//     Back-compat wrapper for trackProvider('claude', ...). Same shape as
//     before. Older callers (CLI scripts, stream-claude-parser) keep
//     working unchanged.
//   getUsageSummary({ rootPath? })    → current-month record (all provider buckets)
//   getAllTimeSummary({ rootPath? })  → sum across all months (CLAUDE BUCKET ONLY
//                                       for back-compat with the analytics page).
//                                       TODO: extend to multi-provider after
//                                       the dashboard work.
//
// Cost rule:
//   - claude: prefer opts.cost_usd from stream-json result. Fall back to the
//     shared lookup (OR cache → inference → free → static), then the legacy
//     sonnet-rate fallback for unknown claude models.
//   - codex/opencode: prefer opts.cost_usd (sourced from turn.completed for
//     codex, or computed by the caller for opencode). If absent, resolve via
//     the shared lookup; if the model is genuinely unknown, persist 0
//     (don't fabricate).

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { canonicalModelKey, resolveModelPrice, STATIC_PRICING } from './lib/model-pricing.mjs';

// Inlined from atomic-write.mjs — keeps this file self-contained so
// jobs/runner.ts can dynamic-import it without needing tsx at the call site.
function atomicWrite(filePath, content) {
  const suffix = randomBytes(4).toString('hex');
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const bakPath = `${filePath}.bak`;
  writeFileSync(tmpPath, content, 'utf-8');
  if (existsSync(filePath)) renameSync(filePath, bakPath);
  renameSync(tmpPath, filePath);
}

// Resolve the canonical data/usage.json path. Three sources, in order:
//   1. explicit opts.rootPath          (server-side / bundled callers)
//   2. import.meta.dirname + '..'      (CLI invocation: this file lives in cli/)
//   3. process.cwd()                   (last-ditch fallback)
//
// (2) is required because Turbopack strips import.meta.dirname when it
// bundles a server-side dynamic import — silently falling through to cwd
// without that check lands the file one dir above the repo. Server callers
// pass opts.rootPath; CLIs rely on (2).
function resolveDataPath(relPath, rootPath) {
  if (rootPath) return join(rootPath, relPath);
  // @ts-ignore — import.meta.dirname is Node 20.11+; tsc doesn't know it but the || fallback handles older runtimes
  const dir = import.meta.dirname;
  if (dir) return join(resolve(join(dir, '..')), relPath);
  return join(process.cwd(), relPath);
}

function resolveUsagePath(rootPath) {
  return resolveDataPath('data/usage.json', rootPath);
}

// Legacy {input, output} $/1M view over the shared static tables in
// cli/lib/model-pricing.mjs (the OFFLINE FALLBACK of the OpenRouter-first
// lookup — the live OR cache is consulted before these).
function toLegacyRates(table) {
  return Object.fromEntries(
    Object.entries(table).map(([model, p]) => [
      model,
      { input: p.in_per_mtok, output: p.out_per_mtok },
    ]),
  );
}

// Anthropic static rates — $/1M tokens, sourced from the shared
// STATIC_PRICING table (canonical bare names). The dated / -1m alias keys
// are kept for back-compat with readers that index RATES directly; the
// compute helpers below canonicalize first, so the aliases are redundant
// there. AUDIT QUARTERLY (in cli/lib/model-pricing.mjs).
//
// Kept exported (and at this name) for back-compat: test-all.mjs asserts on
// RATES['claude-sonnet-4-6'] etc. RATES MUST equal PRICING_BY_PROVIDER.claude.
export const RATES = {
  ...toLegacyRates(STATIC_PRICING.claude),
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'claude-sonnet-4-6-20260201': { input: 3.0, output: 15.0 },
  'claude-opus-4-7-1m': { input: 15.0, output: 75.0 }, // 1M-context variant, same rate
};

// Per-provider STATIC pricing tables — $/1M tokens, derived from the shared
// core so the CLI and the server-side adapter layer
// (src/lib/server/providers/pricing.ts) can't drift. These are the offline
// fallback only; live lookups go through resolveModelPrice() below, which
// consults data/openrouter-pricing-cache.json first (refresh it with
// `node cli/refresh-openrouter-pricing.mjs`; the web layer also refreshes
// it in the background every 24h).
//
// Unknown {provider, model} combos resolve to null below — callers persist
// cost_usd: 0 rather than fabricate a price.
export const PRICING_BY_PROVIDER = {
  claude: RATES,
  codex: toLegacyRates(STATIC_PRICING.codex),
  opencode: toLegacyRates(STATIC_PRICING.opencode),
};

const FALLBACK_MODEL = 'claude-sonnet-4-6'; // when an unknown CLAUDE model is passed, use sonnet rates (conservative middle)

// Read the OpenRouter pricing cache for the shared lookup. Same root
// resolution as resolveUsagePath; memoized per path (CLI processes are
// short-lived). Missing/corrupt cache → empty map → the shared lookup falls
// through to the free rule / static tables, which keeps everything working
// offline (self-hosted requirement).
const orCacheByPath = new Map();
function readOpenRouterCache(rootPath) {
  const path = resolveDataPath('data/openrouter-pricing-cache.json', rootPath);
  if (!orCacheByPath.has(path)) {
    let prices = {};
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'));
      if (parsed && typeof parsed.prices === 'object') prices = parsed.prices;
    } catch {
      // No cache (offline / never refreshed) — static fallback applies.
    }
    orCacheByPath.set(path, prices);
  }
  return orCacheByPath.get(path);
}

// Provider-aware token→USD compute through the SHARED lookup (OpenRouter
// cache → name inference → free rule → static tables) — the same chain the
// analytics display layer uses, so persisted cost_usd and displayed dollars
// can't diverge. Returns null only for genuinely unknown models — callers
// persist cost_usd: 0 rather than invent a number. Claude keeps the legacy
// sonnet fallback for back-compat with computeCostFromTokens() and the
// test-all.mjs assertions.
function priceFromTokens(providerId, model, inputTokens, outputTokens, rootPath) {
  const resolved = resolveModelPrice(providerId, model, orId => {
    const cache = readOpenRouterCache(rootPath);
    return cache[orId] ?? null;
  });
  if (resolved.price) {
    return (
      (inputTokens / 1e6) * resolved.price.in_per_mtok +
      (outputTokens / 1e6) * resolved.price.out_per_mtok
    );
  }
  if (providerId === 'claude') {
    // Legacy fallback — preserved so existing analytics/tests keep their
    // "unknown claude model → sonnet rate" contract.
    if (model) {
      console.warn(
        `[usage-tracker] Unknown claude model "${model}" — falling back to ${FALLBACK_MODEL} rates. Add to RATES table if this is real.`,
      );
    }
    const f = RATES[FALLBACK_MODEL];
    return (inputTokens / 1e6) * f.input + (outputTokens / 1e6) * f.output;
  }
  // codex / opencode / future providers: don't fabricate.
  return null;
}

// Claude-only token→USD compute. Kept at this name/signature for back-compat —
// test-all.mjs asserts on the haiku/sonnet/opus/unknown-fallback paths here.
// Multi-provider callers should go through trackProvider(), which uses
// priceFromTokens() internally and refuses to fabricate prices for unknown
// codex/opencode models.
export function computeCostFromTokens(inputTokens, outputTokens, model) {
  // Canonicalize first so dated / [1m] variants hit their family's rates
  // instead of the sonnet fallback.
  let rates = RATES[canonicalModelKey(model || '')] || RATES[model];
  if (!rates) {
    rates = RATES[FALLBACK_MODEL];
    if (model)
      console.warn(
        `[usage-tracker] Unknown model "${model}" — falling back to ${FALLBACK_MODEL} rates. Add to RATES table if this is real.`,
      );
  }
  return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
}

// Cost from a Claude Code transcript usage block. Honors Anthropic cache
// pricing (write 1.25x base, read 0.1x base) so session-token tracking
// matches what Anthropic actually bills.
// usage = { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
export function computeCostFromUsage(usage, model) {
  let rates = RATES[canonicalModelKey(model || '')] || RATES[model];
  if (!rates) rates = RATES[FALLBACK_MODEL];
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cacheW = usage.cache_creation_input_tokens || 0;
  const cacheR = usage.cache_read_input_tokens || 0;
  return (
    (inp / 1e6) * rates.input +
    (cacheW / 1e6) * rates.input * 1.25 +
    (cacheR / 1e6) * rates.input * 0.1 +
    (out / 1e6) * rates.output
  );
}

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function load(rootPath) {
  const path = resolveUsagePath(rootPath);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data, rootPath) {
  const path = resolveUsagePath(rootPath);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, JSON.stringify(data, null, 2));
}

// Initialize (and migrate forward) the per-provider bucket for a given month.
// `estimated_calls` is for OpenCode tiktoken estimates;
// older usage.json rows are migrated lazily to 0 on first touch.
function getProviderBucket(data, key, providerId) {
  if (!data[key]) data[key] = {};
  if (!data[key][providerId]) {
    data[key][providerId] = {
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      estimated_calls: 0,
      by_model: {},
      by_mode: {},
    };
  }
  // Backwards-compat: older rows may be missing by_mode or estimated_calls.
  if (!data[key][providerId].by_mode) data[key][providerId].by_mode = {};
  if (typeof data[key][providerId].estimated_calls !== 'number') {
    data[key][providerId].estimated_calls = 0;
  }
  return data[key][providerId];
}

/**
 * Multi-provider usage tracker. Writes spend per (month, provider) bucket
 * in data/usage.json with the atomic write+rename pattern used since v0.1.
 *
 * @param {'claude'|'codex'|'opencode'} providerId
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {{ model?: string, mode?: string, cost_usd?: number, rootPath?: string, estimated?: boolean }} [opts]
 * @returns {{ cost_usd: number, month: string }}
 */
export function trackProvider(providerId, inputTokens, outputTokens, opts = {}) {
  const data = load(opts.rootPath);
  const key = monthKey();
  const bucket = getProviderBucket(data, key, providerId);

  // Per-provider model fallback. Claude falls back to sonnet rates (legacy).
  // codex/opencode use the raw `opts.model` (or 'unknown') — we never inject
  // a default model that might collide with a real id.
  const model = opts.model || (providerId === 'claude' ? FALLBACK_MODEL : 'unknown');
  const mode = opts.mode || null;
  const estimated = opts.estimated === true;

  // Prefer caller-supplied cost_usd (sourced from claude's stream-json result
  // event or codex's turn.completed). Fall back to the shared lookup (OR
  // cache → inference → free rule → static). For codex/opencode a genuinely
  // unknown model → cost 0 (priceFromTokens returns null); we don't
  // fabricate prices for models we don't have rates for.
  let cost;
  if (typeof opts.cost_usd === 'number' && Number.isFinite(opts.cost_usd)) {
    cost = opts.cost_usd;
  } else {
    const computed = priceFromTokens(
      providerId,
      model,
      inputTokens || 0,
      outputTokens || 0,
      opts.rootPath,
    );
    cost = typeof computed === 'number' ? computed : 0;
  }

  bucket.calls++;
  bucket.input_tokens += inputTokens || 0;
  bucket.output_tokens += outputTokens || 0;
  bucket.cost_usd = +(bucket.cost_usd + cost).toFixed(4);
  if (estimated) bucket.estimated_calls++;

  if (!bucket.by_model[model])
    bucket.by_model[model] = { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
  bucket.by_model[model].calls++;
  bucket.by_model[model].cost_usd = +(bucket.by_model[model].cost_usd + cost).toFixed(4);
  bucket.by_model[model].input_tokens =
    (bucket.by_model[model].input_tokens || 0) + (inputTokens || 0);
  bucket.by_model[model].output_tokens =
    (bucket.by_model[model].output_tokens || 0) + (outputTokens || 0);
  if (estimated) {
    bucket.by_model[model].estimated_calls = (bucket.by_model[model].estimated_calls || 0) + 1;
  }

  if (mode) {
    if (!bucket.by_mode[mode])
      bucket.by_mode[mode] = { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    bucket.by_mode[mode].calls++;
    bucket.by_mode[mode].cost_usd = +(bucket.by_mode[mode].cost_usd + cost).toFixed(4);
    bucket.by_mode[mode].input_tokens =
      (bucket.by_mode[mode].input_tokens || 0) + (inputTokens || 0);
    bucket.by_mode[mode].output_tokens =
      (bucket.by_mode[mode].output_tokens || 0) + (outputTokens || 0);
  }

  save(data, opts.rootPath);
  return { cost_usd: cost, month: key };
}

// Back-compat wrapper. Keep the same exported name and signature so CLI
// scripts + stream-claude-parser keep working unchanged.
export function trackClaude(inputTokens, outputTokens, opts = {}) {
  return trackProvider('claude', inputTokens, outputTokens, opts);
}

export function getUsageSummary(opts = {}) {
  const data = load(opts.rootPath);
  const key = monthKey();
  const month = data[key] || {};
  return {
    monthKey: key,
    currentMonthData: month,
  };
}

export function getAllTimeSummary(opts = {}) {
  const data = load(opts.rootPath);
  const totals = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
  for (const month of Object.values(data)) {
    if (!month.claude) continue;
    totals.calls += month.claude.calls || 0;
    totals.input_tokens += month.claude.input_tokens || 0;
    totals.output_tokens += month.claude.output_tokens || 0;
    totals.cost_usd += month.claude.cost_usd || 0;
  }
  totals.cost_usd = +totals.cost_usd.toFixed(4);
  return totals;
}
