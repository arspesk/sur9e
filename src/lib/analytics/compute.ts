// lib/analytics/compute.ts
//
// Analytics compute helpers. The funnel / breakdown / range / usage
// aggregations live in src/server/lib/analytics.ts (re-exported below) so
// the next-app and the legacy frontend share one source of truth.
//
// New here: presentation helpers that the legacy inline <script> hand-rolled
// in analytics.html (formatters, mode/model labels, archetype top-5 reducer).
// These are the unit-test targets — every function in this file is pure.

import * as analyticsMjs from '../server/analytics';

// ─── Re-exports with explicit types (the .mjs source has no `.d.ts`) ─────
//
// We wrap each function with an explicit cast so consumers get a typed signature.
// The runtime delegates to the typed implementation — no logic lives here.

export interface FunnelCounts {
  screened: number;
  evaluated: number;
  applied: number;
  responded: number;
  interview: number;
  offer: number;
  discarded: number;
  rejected: number;
}

export type StatusBreakdown = FunnelCounts;

export interface DateRange {
  start: string | null;
  end: string | null;
  preset: string;
}

export interface ModeBucket {
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_calls?: number;
}

export interface ProviderUsageMonth {
  cost_usd?: number;
  calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_calls?: number;
  by_mode?: Record<string, ModeBucket>;
  by_model?: Record<string, ModeBucket>;
}

// Back-compat alias for the pre-multi-provider name.
export type ByModeUsageMonth = ProviderUsageMonth;

export const PROVIDER_IDS = ['claude', 'codex', 'opencode'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderFilter = ProviderId | 'all';

export interface UsageMonthRoot {
  claude?: ProviderUsageMonth;
  codex?: ProviderUsageMonth;
  opencode?: ProviderUsageMonth;
}

export interface UsageAggregateByMode {
  total: number;
  byMode: Record<string, number>;
  byModeTokens: Record<string, { input: number; output: number }>;
  byModeEstimated: Record<string, number>;
  // Per-mode cost from buckets whose models all lack a live OpenRouter
  // price — excluded from the by-mode card's dollar rows. Empty unless a
  // pricedModels map is passed to aggregateUsageByMode.
  unpricedByMode: Record<string, number>;
  totalTokens: { input: number; output: number };
  other: number;
  estimatedCalls: number;
  monthsCovered: string[];
  evaluate: number;
  screen: number;
}

export interface UsageAggregateByModel {
  total: number;
  byModel: Record<string, number>;
  byModelTokens: Record<string, { input: number; output: number }>;
  byModelEstimated: Record<string, number>;
  estimatedCalls: number;
  monthsCovered: string[];
}

interface EntryLike {
  status?: string;
  date?: string;
  // Intentionally loose so callers (e.g. ApplicationRow with its own typed
  // summary shape) can pass their rows in without a structural mismatch.
  summary?: unknown;
  num?: number;
}

// Mirror of the status-log line shape (kept loose like EntryLike).
export interface TransitionLike {
  num: number;
  from?: string | null;
  to: string;
  at: string;
  source?: string;
}

export interface RejectionStats {
  rejected: number;
  appliedEver: number;
  rejectionRatePct: number | null;
  byStageFrom: Record<string, number>;
  medianDaysAppliedToRejected: number | null;
}

export const computeFunnel = analyticsMjs.computeFunnel as (entries: EntryLike[]) => FunnelCounts;
export const computeStatusBreakdown = analyticsMjs.computeStatusBreakdown as (
  entries: EntryLike[],
) => StatusBreakdown;
export const computeFunnelWithHistory = analyticsMjs.computeFunnelWithHistory as (
  entries: EntryLike[],
  transitions: TransitionLike[],
) => FunnelCounts;
export const computeRejectionStats = analyticsMjs.computeRejectionStats as (
  entries: EntryLike[],
  transitions: TransitionLike[],
) => RejectionStats;
export const filterByDate = analyticsMjs.filterByDate as <T extends EntryLike>(
  entries: T[],
  range: DateRange,
) => T[];
export const presetToRange = analyticsMjs.presetToRange as (
  preset: string,
  today?: Date,
) => DateRange;
export const previousRange = analyticsMjs.previousRange as (range: DateRange) => DateRange | null;
export const aggregateUsageByMode = analyticsMjs.aggregateUsageByMode as (
  usage: Record<string, UsageMonthRoot>,
  range: DateRange,
  providerId?: ProviderFilter,
  pricedModels?: Record<string, boolean>,
) => UsageAggregateByMode;
export const aggregateUsageByModel = analyticsMjs.aggregateUsageByModel as (
  usage: Record<string, UsageMonthRoot>,
  range: DateRange,
  providerId?: ProviderFilter,
) => UsageAggregateByModel;

// ─── Constants (verbatim from analytics.html inline script) ──────────────

export const MODE_LABELS: Record<string, string> = {
  evaluate: 'Evaluations',
  screen: 'Screening',
  deep: 'Deep research',
  contact: 'Contact outreach',
  pdf: 'PDF generation',
  latex: 'LaTeX export',
  'interview-prep': 'Interview prep',
  apply: 'Apply assistant',
  patterns: 'Pattern analysis',
  followup: 'Follow-up cadence',
  training: 'Training eval',
  project: 'Project eval',
  offers: 'Offer comparison',
  scan: 'Scan',
  batch: 'Batch run',
  'process-queue': 'Process queue',
  pipeline: 'Pipeline', // legacy label for pre-rename usage entries
  'evaluate-offer': 'Evaluate offer',
  'auto-pipeline': 'Auto pipeline', // legacy label for pre-rename usage entries
  // Modes below otherwise fall through to the generic title-caser, which
  // produces "Tailor Cv" / "Reach Out" (wrong CV casing, stray title case).
  'tailor-cv': 'Tailor CV',
  'cover-letter': 'Cover letter',
  'reach-out': 'Reach out',
  'batch-evaluate': 'Batch evaluate',
  negotiate: 'Negotiate',
  research: 'Research',
  outreach: 'Outreach',
  session: 'Session',
};

// ─── Formatters ──────────────────────────────────────────────────────────

const _currencyFmt = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const _compactFmt = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return _currencyFmt.format(n);
}

export function fmtTokens(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0';
  return _compactFmt.format(n);
}

// Always render the token column so the user can see it even when 0
// (otherwise the empty-state looks like the feature isn't wired).
export function fmtTokensCombined(input: number, output: number): string {
  const total = (input || 0) + (output || 0);
  return `${fmtTokens(total)} tokens`;
}

export interface DeltaResult {
  text: string;
  kind: '' | 'up' | 'dn';
}

export function fmtDelta(curr: number, prev: number | null | undefined): DeltaResult {
  if (prev === null || prev === undefined) return { text: '', kind: '' };
  if (curr === 0 && prev === 0) return { text: '—', kind: '' };
  if (prev === 0) return { text: `+${curr} added`, kind: '' };
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const arrow = diff >= 0 ? '▲' : '▼';
  const sign = diff >= 0 ? '+' : '';
  const pctClamped = Math.max(-999, Math.min(999, pct));
  return {
    text: `${arrow} ${sign}${diff} (${sign}${pctClamped.toFixed(1)}%)`,
    kind: diff >= 0 ? 'up' : 'dn',
  };
}

export function fmtMoneyDelta(curr: number, prev: number | null | undefined): DeltaResult {
  if (prev === null || prev === undefined || prev === 0) return { text: '', kind: '' };
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const arrow = diff >= 0 ? '▲' : '▼';
  const sign = diff >= 0 ? '+' : '';
  // Format the absolute value (the arrow + sign already convey direction) —
  // slicing the minus off fmtMoney(diff) is locale-dependent and stripped the
  // currency symbol from positive deltas instead.
  return {
    text: `${arrow} ${sign}${fmtMoney(Math.abs(diff))} (${sign}${pct.toFixed(1)}%)`,
    kind: diff >= 0 ? 'up' : 'dn',
  };
}

export function modeLabel(key: string): string {
  if (MODE_LABELS[key]) return MODE_LABELS[key]!;
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Range preset → label ────────────────────────────────────────────────

export type PresetKey = '7d' | '30d' | '90d' | '180d' | '365d' | 'all' | 'custom';

export function presetLabel(preset: PresetKey | string): string {
  const map: Record<string, string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    '180d': 'Last 180 days',
    '365d': 'Last 365 days',
    all: 'All time',
    custom: 'Custom range',
  };
  return map[preset] || 'Last 30 days';
}

// ─── Archetype top-5 reducer ─────────────────────────────────────────────

export interface ArchetypeRow {
  name: string;
  count: number;
}

type ArchetypeEntry = {
  summary?:
    | {
        archetype_short?: string | null;
        archetype?: string | null;
      }
    | null
    | undefined;
};

/**
 * Top 5 archetypes by count within `entries`. Mirrors analytics.html inline
 * script (lines 643-668) — pull `summary.archetype_short` (preferred) or
 * `summary.archetype`, drop empty values, count, sort desc, slice(0, 5).
 */
export function topArchetypes(entries: ArchetypeEntry[], limit = 5): ArchetypeRow[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const a = (e.summary?.archetype_short || e.summary?.archetype || '').toString().trim();
    if (!a) continue;
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}
