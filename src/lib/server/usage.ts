// CLI scripts import the .mjs sibling directly; this typed surface is
// for src/server/*.ts and Next.js API routes.

import 'server-only';
import { join } from 'node:path';
import { canonicalModelKey } from '../../../cli/lib/model-pricing.mjs';
import type { ProviderId } from '../schemas/providers';
import { UsageRecord } from '../schemas/usage';
import { isModelPriced } from './providers/pricing';
import { readFileOrNull } from './read-or-null';

// Providers tracked in data/usage.json. Order is stable so the dashboard
// can iterate deterministically. codex + opencode are siblings of the
// original claude bucket.

const PROVIDERS = ['claude', 'codex', 'opencode'] as const;

interface BreakdownBucketRaw {
  calls?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_calls?: number;
}

interface ProviderBucketRaw {
  calls?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_calls?: number;
  by_model?: Record<string, BreakdownBucketRaw>;
  by_mode?: Record<string, BreakdownBucketRaw>;
}

type MonthRaw = Partial<Record<(typeof PROVIDERS)[number], ProviderBucketRaw>>;

export function loadUsage(rootPath: string): UsageRecord {
  const filePath = join(rootPath, 'data/usage.json');
  const raw = readFileOrNull(filePath);
  if (raw == null) {
    return UsageRecord.parse({ months: {}, currentMonth: null, allTime: null });
  }

  // Tolerate an empty/corrupt/non-object usage.json (touch'd file, hand-edit,
  // interrupted write) by degrading to the empty record — same semantics as
  // cli/usage-tracker.mjs load() — instead of throwing into the /analytics RSC.
  let data: Record<string, MonthRaw> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, MonthRaw>;
    } else {
      console.warn(`loadUsage: ignoring non-object usage.json at ${filePath}`);
    }
  } catch {
    console.warn(`loadUsage: ignoring unparseable usage.json at ${filePath}`);
  }
  const monthKey = new Date().toISOString().slice(0, 7);

  // All-time totals sum across every provider bucket. Legacy months
  // only have a `claude` bucket; new months may also have codex/opencode.
  // Single-provider users (claude-only) get the same number as before.
  let allTimeCalls = 0;
  let allTimeCost = 0;
  let allTimeInputTokens = 0;
  let allTimeOutputTokens = 0;
  // Track (canonical model → priced?) and (mode → had any priced run?)
  // while we walk the buckets so the dashboard can render "N/A" for
  // unpriced rows without a second pass. canonicalModelKey strips the
  // 8-digit date suffix and the `[1m]` context-window marker so the
  // dashboard renders one row per model family.
  const pricedModels: Record<string, boolean> = {};
  const pricedModesAccumulator: Record<string, { pricedCalls: number; calls: number }> = {};
  for (const m of Object.values(data)) {
    for (const providerId of PROVIDERS) {
      const bucket = m?.[providerId];
      if (!bucket) continue;
      allTimeCalls += bucket.calls ?? 0;
      allTimeCost += bucket.cost_usd ?? 0;
      allTimeInputTokens += bucket.input_tokens ?? 0;
      allTimeOutputTokens += bucket.output_tokens ?? 0;
      // A bucket is "priced" when any of its models has a live OpenRouter
      // price; modes inherit priced-ness from the buckets they ran in (NOT
      // from cost > 0 — an unpriced model still carries estimated cost_usd,
      // which made the old cost-based rule mark every mode priced).
      let bucketHasPricedModel = false;
      for (const [modelId] of Object.entries(bucket.by_model ?? {})) {
        const canon = canonicalModelKey(modelId);
        const priced = isModelPriced(providerId as ProviderId, modelId);
        if (priced) bucketHasPricedModel = true;
        // OR-only check — first writer wins; collisions across providers
        // for the same canonical name are vanishingly rare in practice.
        if (!(canon in pricedModels)) {
          pricedModels[canon] = priced;
        }
      }
      // No by_model breakdown → no pricing opinion; treat as priced.
      if (Object.keys(bucket.by_model ?? {}).length === 0) bucketHasPricedModel = true;
      for (const [modeId, modeBucket] of Object.entries(bucket.by_mode ?? {})) {
        const acc = pricedModesAccumulator[modeId] ?? { pricedCalls: 0, calls: 0 };
        const calls = modeBucket?.calls ?? 0;
        acc.calls += calls;
        if (bucketHasPricedModel) acc.pricedCalls += calls;
        pricedModesAccumulator[modeId] = acc;
      }
    }
  }
  // A mode is "priced" when at least one of its runs came through a bucket
  // with a priced model. Modes with zero calls default to true (vacuous).
  const pricedModes: Record<string, boolean> = {};
  for (const [modeId, acc] of Object.entries(pricedModesAccumulator)) {
    pricedModes[modeId] = acc.calls === 0 ? true : acc.pricedCalls > 0;
  }

  return UsageRecord.parse({
    currentMonth: monthKey,
    currentMonthData: data[monthKey] ?? null,
    allTime: {
      calls: allTimeCalls,
      input_tokens: allTimeInputTokens,
      output_tokens: allTimeOutputTokens,
      cost_usd: +allTimeCost.toFixed(4),
    },
    months: data,
    pricedModels,
    pricedModes,
  });
}

export type { ClaudeUsage, MonthUsage, ProviderUsage, UsageRecord } from '../schemas/usage';
