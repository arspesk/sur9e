// src/lib/server/providers/openrouter-pricing.ts
//
// OpenRouter live-pricing cache. Replaces hardcoded $/Mtok
// dictionary entries with prices fetched from
// https://openrouter.ai/api/v1/models — a free, no-auth catalog endpoint
// that returns ~350 models with `pricing.prompt` and `pricing.completion`
// (USD per token, as strings).
//
// Design:
//
//   - **Sync hot path.** `getOpenRouterPrice(openrouterId)` is a pure
//     in-memory Map read. Callers (priceForRun) stay synchronous; no per-
//     call HTTP overhead, no async refactor needed across the codebase.
//
//   - **Disk cache survives restarts.** First import seeds the in-memory
//     Map from `data/openrouter-pricing-cache.json` so a fresh server
//     start doesn't need a network round-trip to get prices.
//
//   - **24h TTL with background refresh.** When a lookup happens past the
//     TTL, we fire `refreshInBackground()` (no await) and serve stale data
//     for this request. The next request — milliseconds later, typically
//     — sees the refreshed cache. No request blocks on HTTP I/O.
//
//   - **Atomic disk writes.** Cache file rewrites use the .tmp+rename
//     pattern so a crash mid-write can't leave a half-parsed file.
//
//   - **Quiet failures.** Network errors / parse errors during background
//     refresh log a single warn and leave the stale cache in place. The
//     static fallback in pricing.ts catches gaps; the system never blocks
//     the user on OpenRouter availability.
//
// Cache file shape (data/openrouter-pricing-cache.json):
//   {
//     "fetchedAt": "2026-05-25T...",
//     "modelsCount": 357,
//     "prices": {
//       "anthropic/claude-sonnet-4.6": { "in_per_mtok": 3.0, "out_per_mtok": 15.0 },
//       ...
//     }
//   }

import 'server-only';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10_000;

export interface OpenRouterPrice {
  in_per_mtok: number;
  out_per_mtok: number;
}

export interface CacheFileShape {
  fetchedAt: string; // ISO timestamp
  modelsCount: number;
  prices: Record<string, OpenRouterPrice>;
}

// OpenRouter's response schema (just the parts we use). `pricing.prompt` /
// `pricing.completion` are USD-per-token strings — we convert to USD per
// million tokens (× 1e6) when caching so they match our PRICING table units.
const OpenRouterModel = z.object({
  id: z.string(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
    })
    .optional(),
});
const OpenRouterResponse = z.object({
  data: z.array(OpenRouterModel),
});

// Module-level state. Reset by tests via __testing.reset().
let inMemoryPrices: Map<string, OpenRouterPrice> = new Map();
let lastSeedAttemptedFromDisk = false;
let lastSuccessfulFetchAt = 0; // epoch ms
let inFlightRefresh: Promise<void> | null = null;
let currentRootPath: string | null = null;
// True after __testing.seedDirect — blocks the disk seed entirely so test
// fixtures can't be silently overridden by a real cache file in the
// developer's checkout (CI has no cache file; dev machines do).
let seededDirectly = false;

function cachePath(rootPath: string): string {
  return join(rootPath, 'data/openrouter-pricing-cache.json');
}

function atomicWriteJSON(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function seedFromDisk(rootPath: string): void {
  if (seededDirectly) return;
  if (lastSeedAttemptedFromDisk && currentRootPath === rootPath) return;
  lastSeedAttemptedFromDisk = true;
  currentRootPath = rootPath;
  const p = cachePath(rootPath);
  if (!existsSync(p)) return;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as CacheFileShape;
    inMemoryPrices = new Map(Object.entries(raw.prices));
    lastSuccessfulFetchAt = new Date(raw.fetchedAt).getTime() || 0;
  } catch (err) {
    // Corrupt cache — just clear it; background refresh will rebuild.
    console.warn(`[openrouter-pricing] failed to load cache at ${p}: ${(err as Error).message}`);
  }
}

/**
 * Parse OpenRouter's `/api/v1/models` response shape into our pricing
 * map. Skips entries without numeric prompt/completion prices (some
 * embedding-only / experimental models lack both).
 */
export function parseOpenRouterModels(raw: unknown): Map<string, OpenRouterPrice> {
  const parsed = OpenRouterResponse.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `[openrouter-pricing] unexpected response shape: ${parsed.error.message.slice(0, 200)}`,
    );
  }
  const prices = new Map<string, OpenRouterPrice>();
  for (const m of parsed.data.data) {
    const promptStr = m.pricing?.prompt;
    const completionStr = m.pricing?.completion;
    if (!promptStr || !completionStr) continue;
    const promptPerTok = Number(promptStr);
    const completionPerTok = Number(completionStr);
    if (!Number.isFinite(promptPerTok) || !Number.isFinite(completionPerTok)) continue;
    prices.set(m.id, {
      in_per_mtok: promptPerTok * 1_000_000,
      out_per_mtok: completionPerTok * 1_000_000,
    });
  }
  return prices;
}

/**
 * Blocking fetch of the OpenRouter catalog. Used by the CLI refresh
 * script and by tests. Production code should prefer the background-
 * triggered path through `getOpenRouterPrice()`.
 */
export async function refreshNow(rootPath: string): Promise<{
  fetched: number;
  cachedAt: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    const prices = parseOpenRouterModels(json);
    const cachedAt = new Date().toISOString();
    const cache: CacheFileShape = {
      fetchedAt: cachedAt,
      modelsCount: prices.size,
      prices: Object.fromEntries(prices),
    };
    atomicWriteJSON(cachePath(rootPath), cache);
    inMemoryPrices = prices;
    lastSuccessfulFetchAt = Date.now();
    currentRootPath = rootPath;
    return { fetched: prices.size, cachedAt };
  } finally {
    clearTimeout(timeout);
  }
}

function refreshInBackground(rootPath: string): void {
  if (inFlightRefresh) return; // Don't stack multiple background fetches.
  inFlightRefresh = refreshNow(rootPath)
    .then(() => {
      /* refreshed; in-memory cache already updated */
    })
    .catch(err => {
      // Quiet failure: keep stale cache in place. Next call will retry once
      // TTL re-expires, not on every miss (which could spam logs on outages).
      console.warn(`[openrouter-pricing] background refresh failed: ${(err as Error).message}`);
    })
    .finally(() => {
      inFlightRefresh = null;
    });
}

/**
 * Synchronous price lookup by OpenRouter model id (e.g.
 * "anthropic/claude-sonnet-4.6"). Returns `null` when the id is unknown.
 * Triggers a background refresh when the cache is past its TTL — the
 * current call still serves stale data, but the next call gets the
 * refreshed price.
 *
 * `rootPath` must be the project root; it's used to locate the cache
 * file. Pass the same value consistently across calls; only the first
 * value seeds the in-memory cache from disk.
 */
export function getOpenRouterPrice(openrouterId: string, rootPath: string): OpenRouterPrice | null {
  seedFromDisk(rootPath);
  const now = Date.now();
  if (now - lastSuccessfulFetchAt > TTL_MS) {
    refreshInBackground(rootPath);
  }
  return inMemoryPrices.get(openrouterId) ?? null;
}

// Internals exported so unit tests can reset module state between
// fixtures without restarting the process. Treat as private surface.
export const __testing = {
  reset(): void {
    inMemoryPrices = new Map();
    lastSeedAttemptedFromDisk = false;
    lastSuccessfulFetchAt = 0;
    inFlightRefresh = null;
    currentRootPath = null;
    seededDirectly = false;
  },
  seedDirect(prices: Map<string, OpenRouterPrice>, fetchedAt: number): void {
    inMemoryPrices = prices;
    lastSuccessfulFetchAt = fetchedAt;
    lastSeedAttemptedFromDisk = true;
    seededDirectly = true;
  },
  state(): {
    size: number;
    lastFetchAt: number;
    inFlight: boolean;
  } {
    return {
      size: inMemoryPrices.size,
      lastFetchAt: lastSuccessfulFetchAt,
      inFlight: inFlightRefresh !== null,
    };
  },
};
