import { z } from 'zod';

// Per-mode / per-model breakdown bucket. Per-mode/model counters in
// usage.json don't always include every field historically, hence
// optional. Schema is permissive (.passthrough()) so future fields
// ride through to consumers. `estimated_calls` is a later addition —
// older rows are migrated lazily to 0 by the usage-tracker on first touch.
export const ProviderUsageBreakdownBucket = z
  .object({
    calls: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    estimated_calls: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type ProviderUsageBreakdownBucket = z.infer<typeof ProviderUsageBreakdownBucket>;

// Keep the legacy export name as an alias for back-compat with callers
// that imported ClaudeUsageBreakdownBucket before multi-provider support.
export const ClaudeUsageBreakdownBucket = ProviderUsageBreakdownBucket;
export type ClaudeUsageBreakdownBucket = ProviderUsageBreakdownBucket;

// One provider's spend within a month. The shape is identical across
// providers (claude / codex / opencode); analytics merges these into the
// "All" tab while keeping per-provider views available.
export const ProviderUsage = z.object({
  calls: z.number().int().nonnegative().default(0),
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cost_usd: z.number().nonnegative().default(0),
  // `estimated_calls` counts rows where the provider didn't emit native
  // usage telemetry and tokens were estimated locally (currently: OpenCode
  // via tiktoken at job close). The dashboard renders an "est." badge per
  // row when by_mode/by_model entries include `estimated_calls > 0`.
  estimated_calls: z.number().int().nonnegative().optional().default(0),
  // Per-mode (evaluate, screen, interview-prep, …) and per-model
  // (claude-haiku-4-5-20251001, gpt-5, anthropic/claude-3-haiku, …)
  // breakdowns. The analytics page reads these to render Spend-by-mode /
  // Spend-by-model cards; without them every row collapses to
  // "Other (untagged)" / $0.
  by_mode: z.record(z.string(), ProviderUsageBreakdownBucket).optional(),
  by_model: z.record(z.string(), ProviderUsageBreakdownBucket).optional(),
});
export type ProviderUsage = z.infer<typeof ProviderUsage>;

// Legacy export alias — keeps existing imports of `ClaudeUsage` working.
export const ClaudeUsage = ProviderUsage;
export type ClaudeUsage = ProviderUsage;

export const MonthUsage = z
  .object({
    claude: ProviderUsage.optional(),
    codex: ProviderUsage.optional(),
    opencode: ProviderUsage.optional(),
  })
  .passthrough();
export type MonthUsage = z.infer<typeof MonthUsage>;

export const UsageRecord = z.object({
  currentMonth: z.string().nullable(),
  // Runtime omits currentMonthData when data/usage.json is missing — accept
  // undefined and coalesce to null so consumers can ignore the empty path.
  currentMonthData: MonthUsage.nullable().optional().default(null),
  allTime: z
    .object({
      calls: z.number().int().nonnegative(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cost_usd: z.number().nonnegative(),
    })
    .nullable(),
  months: z.record(z.string(), MonthUsage),
  // Map from canonical model name → live OpenRouter pricing available?
  // Populated server-side (loadUsage) by checking each (provider, model)
  // pair against the OR cache. The dashboard uses this to decide whether
  // a $0 cost cell should render "$0.00" (legitimately free, e.g. OR's
  // `:free` tier) or "N/A" (no live price available).
  pricedModels: z.record(z.string(), z.boolean()).optional().default({}),
  // Sibling map for the Spend-by-mode card: mode → did every contributing
  // run have a live OR price? Heuristic: a mode is "priced" iff its
  // aggregate cost_usd > 0 or it had zero calls. A mode with calls > 0 and
  // cost_usd == 0 is treated as unpriced (all-zero means none of the
  // underlying models had OR pricing — legitimately-free models do
  // contribute non-zero $ when they exist).
  pricedModes: z.record(z.string(), z.boolean()).optional().default({}),
});
export type UsageRecord = z.infer<typeof UsageRecord>;
