#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * refresh-openrouter-pricing.mjs — Manual cache refresh for the OpenRouter
 * pricing layer.
 *
 * Hits https://openrouter.ai/api/v1/models and writes
 * data/openrouter-pricing-cache.json with USD-per-million-tokens rates
 * per OR model id. The runtime layer (src/lib/server/providers/
 * openrouter-pricing.ts) reads this cache synchronously and refreshes it
 * in the background every 24h once the server is running — this CLI is
 * for the cold-start path (fresh clone, CI runner) and for forcing a
 * refresh outside the TTL window.
 *
 * Usage:
 *   node cli/refresh-openrouter-pricing.mjs
 *   node cli/refresh-openrouter-pricing.mjs --dry-run
 *
 * Exit codes:
 *   0  success — cache written
 *   1  fetch failed / parse error
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CACHE_PATH = join(ROOT, 'data/openrouter-pricing-cache.json');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const TIMEOUT_MS = 15_000;
const DRY_RUN = process.argv.includes('--dry-run');

function atomicWriteJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

async function main() {
  console.log(`[refresh-openrouter-pricing] fetching ${OPENROUTER_URL}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let json;
  try {
    const res = await fetch(OPENROUTER_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const models = Array.isArray(json?.data) ? json.data : [];
  if (models.length === 0) {
    throw new Error('OpenRouter response had zero models — refusing to overwrite cache');
  }

  const prices = {};
  let skipped = 0;
  for (const m of models) {
    const promptStr = m?.pricing?.prompt;
    const completionStr = m?.pricing?.completion;
    if (!promptStr || !completionStr) {
      skipped += 1;
      continue;
    }
    const promptPerTok = Number(promptStr);
    const completionPerTok = Number(completionStr);
    if (!Number.isFinite(promptPerTok) || !Number.isFinite(completionPerTok)) {
      skipped += 1;
      continue;
    }
    prices[m.id] = {
      in_per_mtok: promptPerTok * 1_000_000,
      out_per_mtok: completionPerTok * 1_000_000,
    };
  }

  const cache = {
    fetchedAt: new Date().toISOString(),
    modelsCount: Object.keys(prices).length,
    prices,
  };

  if (DRY_RUN) {
    console.log(
      `[refresh-openrouter-pricing] DRY-RUN — would write ${cache.modelsCount} models ` +
        `(skipped ${skipped} without numeric prices) to ${CACHE_PATH}`,
    );
    return;
  }

  atomicWriteJSON(CACHE_PATH, cache);
  console.log(
    `[refresh-openrouter-pricing] wrote ${cache.modelsCount} models to ${CACHE_PATH} ` +
      `(skipped ${skipped} without numeric prices)`,
  );
}

main().catch(err => {
  console.error(`[refresh-openrouter-pricing] ${err.message}`);
  process.exit(1);
});
