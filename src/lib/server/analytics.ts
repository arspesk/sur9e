// src/lib/server/analytics.ts
//
// Typed analytics functions. Inlined from analytics.mjs (pure, no FS, no
// schemas). All exports are pure — no DOM dependencies. The types mirror
// the docblocks in analytics.mjs verbatim.
//
// Status semantics (per docs/architecture.md L130-137):
//   Every entry in the tracker has been screened. `screened` cumulates everything,
//   including discarded/unknown statuses. `evaluated` cumulates everything that
//   reached an evaluation report (so applied/rejected/responded/interview/offer
//   all count toward evaluated as well as toward applied).
//   SKIP was merged into Discarded in 2026-05; legacy 'skip' status is normalized
//   into the discarded bucket here.

// canonicalModelKey comes from the shared model-pricing core (pure string
// transform, no FS) — one definition for the aggregators here, the usage
// loader, and the CLI usage tracker.
import { canonicalModelKey } from '../../../cli/lib/model-pricing.mjs';

export interface FunnelCounts {
  screened: number;
  evaluated: number;
  applied: number;
  responded: number;
  interview: number;
  offer: number;
  discarded: number;
  // Entries currently in `rejected`. In the cumulative funnel they ALSO
  // count toward screened/evaluated/applied (a rejection doesn't undo the
  // apply); in the exclusive breakdown this is their only bucket.
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
  calls?: number;
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

// Back-compat alias for the legacy single-provider name.
export type ByModeUsageMonth = ProviderUsageMonth;

// Providers tracked in usage.json. Order is stable so the dashboard can
// iterate deterministically (claude first matches the legacy single-
// provider order).
// supersedes the deprecated gemini CLI).
export const PROVIDER_IDS = ['claude', 'codex', 'opencode'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

// 'all' = sum across every provider, equivalent to the dashboard's "All"
// tab. The aggregators accept it as a synonym for "no filter".
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
  // Per-mode count of rows that came in with estimated tokens (currently
  // OpenCode via tiktoken). The dashboard renders an "est." badge when
  // this value is > 0 for a row.
  byModeEstimated: Record<string, number>;
  // Per-mode cost that came from provider buckets whose models all lack a
  // live OpenRouter price (see aggregateUsageByMode's `pricedModels` param).
  // The dashboard excludes this portion from the displayed dollar rows so
  // the by-mode card reconciles with the by-model card's "N/A" semantics.
  // Empty when no `pricedModels` map is supplied.
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
  // Per-model count of estimated rows — same semantics as
  // UsageAggregateByMode.byModeEstimated.
  byModelEstimated: Record<string, number>;
  estimatedCalls: number;
  monthsCovered: string[];
}

interface EntryLike {
  status?: string;
  date?: string;
  summary?: unknown;
  num?: number;
}

// Minimal shape of a data/status-log.jsonl line the analytics need —
// structurally compatible with StatusTransition but kept independent so
// this module stays pure (no schema imports, mirroring EntryLike).
export interface TransitionLike {
  num: number;
  from?: string | null;
  to: string;
  at: string;
  source?: string;
}

export function normalizeStatus(raw: string): string {
  return (raw || '').replace(/\*\*/g, '').trim().toLowerCase();
}

/**
 * Compute cumulative funnel counts. Every entry counts toward `screened`,
 * regardless of current status. Entries with status that has reached a later
 * stage cumulate forward (e.g. an offer counts in screened+evaluated+applied
 * +responded+interview+offer).
 */
export function computeFunnel(entries: EntryLike[]): FunnelCounts {
  const c = {
    screened: 0,
    evaluated: 0,
    applied: 0,
    responded: 0,
    interview: 0,
    offer: 0,
    discarded: 0,
    rejected: 0,
  };
  for (const e of entries || []) {
    const s = normalizeStatus(e.status ?? '');
    c.screened++;
    if (['evaluated', 'applied', 'rejected', 'responded', 'interview', 'offer'].includes(s))
      c.evaluated++;
    if (['applied', 'rejected', 'responded', 'interview', 'offer'].includes(s)) c.applied++;
    if (['responded', 'interview', 'offer'].includes(s)) c.responded++;
    if (['interview', 'offer'].includes(s)) c.interview++;
    if (s === 'offer') c.offer++;
    if (s === 'rejected') c.rejected++;
    // Legacy 'skip' rolls into discarded bucket
    if (s === 'discarded' || s === 'skip') c.discarded++;
  }
  return c;
}

// ─── History-aware funnel + rejection analytics ──────────────────────────
//
// The tracker stores only the CURRENT status, so computeFunnel under-counts
// the middle of the funnel: an offer rejected after an interview stops
// cumulating into responded/interview (its status no longer matches those
// stage lists). The status-transition log restores that fidelity — these
// functions cumulate on the deepest stage an offer EVER reached.

// Conversion-path order. Index = depth; terminal exits map to a floor.
const STAGE_ORDER = ['screened', 'evaluated', 'applied', 'responded', 'interview', 'offer'];

/**
 * Deepest conversion-path stage a status implies.
 * `rejected` floors at `applied` (a rejection implies an application);
 * `discarded`/unknown floor at `screened`.
 */
function stageFloor(status: string): number {
  const i = STAGE_ORDER.indexOf(status);
  if (i !== -1) return i;
  if (status === 'rejected') return STAGE_ORDER.indexOf('applied');
  return 0;
}

/**
 * Cumulative funnel on max-stage-ever-reached. Each entry counts toward
 * every stage up to the deepest point in its transition history (both
 * `from` and `to` hops count — a `from: 'interview'` proves the offer was
 * there even if no earlier line recorded the arrival). Entries with no
 * history fall back to their current status, making this a strict superset
 * of computeFunnel.
 */
export function computeFunnelWithHistory(
  entries: EntryLike[],
  transitions: TransitionLike[],
): FunnelCounts {
  const deepest = new Map<number, number>();
  for (const t of transitions || []) {
    const d = Math.max(
      deepest.get(t.num) ?? 0,
      stageFloor(normalizeStatus(t.to)),
      t.from ? stageFloor(normalizeStatus(t.from)) : 0,
    );
    deepest.set(t.num, d);
  }
  const c = {
    screened: 0,
    evaluated: 0,
    applied: 0,
    responded: 0,
    interview: 0,
    offer: 0,
    discarded: 0,
    rejected: 0,
  };
  for (const e of entries || []) {
    const s = normalizeStatus(e.status ?? '');
    const floor = Math.max(stageFloor(s), (e.num != null && deepest.get(e.num)) || 0);
    c.screened++;
    if (floor >= 1) c.evaluated++;
    if (floor >= 2) c.applied++;
    if (floor >= 3) c.responded++;
    if (floor >= 4) c.interview++;
    if (floor >= 5) c.offer++;
    if (s === 'rejected') c.rejected++;
    if (s === 'discarded' || s === 'skip') c.discarded++;
  }
  return c;
}

export interface RejectionStats {
  /** Entries currently in `rejected`. */
  rejected: number;
  /** Entries that ever reached `applied` or deeper (history-aware). */
  appliedEver: number;
  /** rejected / appliedEver as a 0-100 percentage, or null when nothing applied. */
  rejectionRatePct: number | null;
  /** Where rejections came from: counts keyed by the stage the offer was in. */
  byStageFrom: Record<string, number>;
  /** Median days between the applied transition and the rejected transition (app-sourced pairs only — reconciled timestamps are observation time, not transition time). Null when no measurable pair exists. */
  medianDaysAppliedToRejected: number | null;
}

/**
 * Rejection analytics over the transition log, scoped to `entries`
 * (pass the date-filtered list so the stats match the rest of the page).
 */
export function computeRejectionStats(
  entries: EntryLike[],
  transitions: TransitionLike[],
): RejectionStats {
  const nums = new Set<number>();
  for (const e of entries || []) if (e.num != null) nums.add(e.num);
  const scoped = (transitions || []).filter(t => nums.size === 0 || nums.has(t.num));

  const funnel = computeFunnelWithHistory(entries, scoped);
  const durations: number[] = [];
  // Last app-sourced applied timestamp per num, to pair with its rejection.
  const appliedAt = new Map<number, string>();
  // The from-stage of each num's MOST RECENT →rejected transition (by `at`).
  // Used to attribute the offer's current rejection to one stage — counting
  // every transition here would double-count a re-rejected offer.
  const lastRejectFrom = new Map<number, string>();
  const lastRejectAt = new Map<number, string>();

  for (const t of scoped) {
    const to = normalizeStatus(t.to);
    if (to === 'applied' && t.source === 'app') appliedAt.set(t.num, t.at);
    if (to !== 'rejected') continue;
    const prevAt = lastRejectAt.get(t.num);
    if (prevAt == null || t.at >= prevAt) {
      lastRejectAt.set(t.num, t.at);
      const from = t.from ? normalizeStatus(t.from) : '';
      // 'discarded' isn't a funnel stage, but it's a real prior state a later
      // rejection can come from — surface it rather than lumping it into
      // 'unknown'. Anything else unrecognized stays 'unknown'.
      const recognized = from === 'discarded' || STAGE_ORDER.includes(from);
      lastRejectFrom.set(t.num, recognized ? from : 'unknown');
    }
    const start = appliedAt.get(t.num);
    if (t.source === 'app' && start) {
      const days = (Date.parse(t.at) - Date.parse(start)) / 86400000;
      if (Number.isFinite(days) && days >= 0) durations.push(days);
    }
  }

  // Bucket each CURRENTLY-rejected offer (the same set funnel.rejected counts)
  // by the stage it was last rejected from, so the breakdown reconciles with
  // the rejected total instead of summing past it. Offers with no logged
  // rejection transition fall back to 'unknown'.
  const byStageFrom: Record<string, number> = {};
  for (const e of entries || []) {
    if (normalizeStatus(e.status ?? '') !== 'rejected') continue;
    const stage = (e.num != null && lastRejectFrom.get(e.num)) || 'unknown';
    byStageFrom[stage] = (byStageFrom[stage] || 0) + 1;
  }

  durations.sort((a, b) => a - b);
  const median =
    durations.length === 0
      ? null
      : durations.length % 2
        ? durations[(durations.length - 1) / 2]
        : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;

  return {
    rejected: funnel.rejected,
    appliedEver: funnel.applied,
    rejectionRatePct:
      funnel.applied > 0 ? Math.round((funnel.rejected / funnel.applied) * 1000) / 10 : null,
    byStageFrom,
    medianDaysAppliedToRejected: median == null ? null : Math.round(median * 10) / 10,
  };
}

/**
 * Compute exclusive status breakdown. Each entry counts in exactly one bucket
 * (the bucket matching its current status). Sum of all buckets equals the
 * total number of entries, so percentages of the total sum to 100%.
 *
 * 'rejected' is its own bucket (since the status-log feature; it used to roll into 'applied').
 * Legacy 'skip' rolls into 'discarded'. Empty/unknown status → 'screened'.
 */
export function computeStatusBreakdown(entries: EntryLike[]): StatusBreakdown {
  const c = {
    screened: 0,
    evaluated: 0,
    applied: 0,
    responded: 0,
    interview: 0,
    offer: 0,
    discarded: 0,
    rejected: 0,
  };
  for (const e of entries || []) {
    const s = normalizeStatus(e.status ?? '');
    if (s === 'evaluated') c.evaluated++;
    else if (s === 'applied') c.applied++;
    else if (s === 'rejected') c.rejected++;
    else if (s === 'responded') c.responded++;
    else if (s === 'interview') c.interview++;
    else if (s === 'offer') c.offer++;
    else if (s === 'discarded' || s === 'skip') c.discarded++;
    else c.screened++;
  }
  return c;
}

/**
 * Filter entries by `entry.date` against a range. Range = { start, end, preset }.
 * For preset='all', returns every entry. Date strings compare lexicographically
 * (YYYY-MM-DD format), which is correct.
 *
 * Inclusive on both bounds. Entries with falsy/missing date are excluded.
 */
export function filterByDate<T extends EntryLike>(entries: T[], range: DateRange): T[] {
  if (!range || range.preset === 'all') return (entries || []).slice();
  return (entries || []).filter(e => {
    if (!e || !e.date) return false;
    return e.date >= (range.start ?? '') && e.date <= (range.end ?? '');
  });
}

/**
 * Convert a preset key to an inclusive [start, end] range string pair.
 * `today` is a Date — caller passes one for testability; default = now.
 *
 * Returns: { start: 'YYYY-MM-DD' | null, end: 'YYYY-MM-DD' | null, preset }
 */
export function presetToRange(preset: string, today: Date = new Date()): DateRange {
  if (preset === 'all') return { start: null, end: null, preset: 'all' };
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  const d = days[preset];
  if (!d) return { start: null, end: null, preset: 'all' }; // fallback for unknown preset
  const end = isoDate(today);
  const start = isoDate(addDays(today, -d));
  return { start, end, preset };
}

/**
 * Given a current range, derive the immediately-preceding range of the same
 * length. Returns null for preset='all' (no meaningful previous).
 */
export function previousRange(range: DateRange): DateRange | null {
  if (!range || range.preset === 'all') return null;
  if (!range.start || !range.end) return null;
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  // Day span between endpoints (e.g. 04-04 → 05-04 = 30 calendar days
  // difference; both endpoints inclusive = 31 days total). The previous
  // window keeps the same shape: same span, ending the day before `start`.
  // Symmetric — for a 1-day range (start === end), span = 0 and prev is
  // the single previous day (prevStart === prevEnd === start - 1).
  const span = Math.round((end.getTime() - start.getTime()) / 86400000);
  const prevEnd = addDays(start, -1); // day before current range
  const prevStart = addDays(prevEnd, -span); // same calendar span back
  return { start: isoDate(prevStart), end: isoDate(prevEnd), preset: 'previous' };
}

/**
 * Pick the per-provider buckets to iterate over for a given filter.
 * 'all' (or undefined) → every tracked provider. A specific provider →
 * just that bucket. The aggregators walk the returned list per-month so a
 * single iteration handles both the "All" and per-provider tabs.
 */
function bucketsForProvider(
  monthRoot: UsageMonthRoot | undefined,
  providerId: ProviderFilter,
): ProviderUsageMonth[] {
  if (!monthRoot) return [];
  if (providerId === 'all') {
    return PROVIDER_IDS.map(p => monthRoot[p]).filter((b): b is ProviderUsageMonth => Boolean(b));
  }
  const bucket = monthRoot[providerId];
  return bucket ? [bucket] : [];
}

/**
 * Aggregate per-mode spend across the months that intersect the range.
 * usage = { 'YYYY-MM': { claude: {...}, codex?: {...}, opencode?: {...} } }
 *
 * `providerId` defaults to 'all' — the legacy behavior was claude-only,
 * but every existing fixture only ever has claude data so 'all' is
 * back-compatible. Pass 'claude' / 'codex' / 'opencode' for per-provider tabs.
 *
 * `pricedModels` (optional) is the canonical-key map from /api/usage; when
 * provided, `unpricedByMode` carries each mode's cost that came from buckets
 * whose models all lack a live OpenRouter price (so the UI can exclude it
 * from dollar rows, mirroring the by-model card's "N/A" handling).
 *
 * Returns: { total, byMode, byModeTokens, byModeEstimated, unpricedByMode,
 *            other, estimatedCalls, monthsCovered, evaluate, screen }
 *   `byMode`         → every mode found in the range, cost summed across months
 *   `byModeEstimated`→ count of estimated_calls per mode (OpenCode tiktoken)
 *   `other`          → total - sum(byMode) (untracked spend that didn't carry a mode tag)
 *   `evaluate` and `screen` are kept for backwards-compatibility; new callers should
 *   read from `byMode` directly.
 */
export function aggregateUsageByMode(
  usage: Record<string, UsageMonthRoot>,
  range: DateRange,
  providerId: ProviderFilter = 'all',
  pricedModels?: Record<string, boolean>,
): UsageAggregateByMode {
  const months = monthsInRange(usage, range);
  let total = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let estimatedCalls = 0;
  const byMode: Record<string, number> = {};
  const byModeTokens: Record<string, { input: number; output: number }> = {};
  const byModeEstimated: Record<string, number> = {};
  const unpricedByMode: Record<string, number> = {};
  for (const m of months) {
    for (const bucket of bucketsForProvider(usage[m], providerId)) {
      total += bucket.cost_usd || 0;
      totalInput += bucket.input_tokens || 0;
      totalOutput += bucket.output_tokens || 0;
      estimatedCalls += bucket.estimated_calls || 0;
      // A bucket's by_mode costs count as "unpriced" when every model that
      // ran in the bucket lacks a live OpenRouter price (pricedModels keys
      // are canonical — see canonicalModelKey). Mixed buckets (priced +
      // unpriced models) can't be attributed per-mode from this data, so
      // they conservatively count as priced. No pricedModels map → priced.
      const modelsWithCalls = Object.entries(bucket.by_model ?? {}).filter(
        ([, b]) => ((b && b.calls) || 0) > 0,
      );
      const bucketFullyUnpriced =
        Boolean(pricedModels) &&
        modelsWithCalls.length > 0 &&
        modelsWithCalls.every(([id]) => pricedModels?.[canonicalModelKey(id)] === false);
      const monthByMode = bucket.by_mode || {};
      for (const [mode, data] of Object.entries(monthByMode)) {
        byMode[mode] = (byMode[mode] || 0) + ((data && data.cost_usd) || 0);
        if (!byModeTokens[mode]) byModeTokens[mode] = { input: 0, output: 0 };
        byModeTokens[mode].input += (data && data.input_tokens) || 0;
        byModeTokens[mode].output += (data && data.output_tokens) || 0;
        byModeEstimated[mode] =
          (byModeEstimated[mode] || 0) + ((data && data.estimated_calls) || 0);
        if (bucketFullyUnpriced) {
          unpricedByMode[mode] = (unpricedByMode[mode] || 0) + ((data && data.cost_usd) || 0);
        }
      }
    }
  }
  const tracked = Object.values(byMode).reduce((s, v) => s + v, 0);
  const other = Math.max(0, total - tracked);
  return {
    total,
    byMode,
    byModeTokens,
    byModeEstimated,
    unpricedByMode,
    totalTokens: { input: totalInput, output: totalOutput },
    other,
    estimatedCalls,
    monthsCovered: months,
    evaluate: byMode.evaluate || 0,
    screen: byMode.screen || 0,
  };
}

/**
 * Aggregate per-model spend across the months that intersect the range.
 * Collapses dated suffixes (claude-haiku-4-5-20251001) and 1m variants
 * (claude-opus-4-7-1m) onto their canonical bare-name keys so the UI shows
 * one row per model family. Codex/OpenCode model ids (e.g. 'gpt-5',
 * 'anthropic/claude-3-haiku') pass through canonicalModelKey unchanged
 * because they don't match the dated-suffix / -1m pattern.
 *
 * `providerId` defaults to 'all'. See aggregateUsageByMode for the same
 * semantics.
 *
 * Returns: { byModel: { 'claude-haiku-4-5': cost, ... }, byModelEstimated,
 *            estimatedCalls, total, monthsCovered }
 */
export function aggregateUsageByModel(
  usage: Record<string, UsageMonthRoot>,
  range: DateRange,
  providerId: ProviderFilter = 'all',
): UsageAggregateByModel {
  const months = monthsInRange(usage, range);
  let total = 0;
  let estimatedCalls = 0;
  const byModel: Record<string, number> = {};
  const byModelTokens: Record<string, { input: number; output: number }> = {};
  const byModelEstimated: Record<string, number> = {};
  for (const m of months) {
    for (const bucket of bucketsForProvider(usage[m], providerId)) {
      total += bucket.cost_usd || 0;
      estimatedCalls += bucket.estimated_calls || 0;
      const monthByModel = bucket.by_model || {};
      for (const [model, data] of Object.entries(monthByModel)) {
        const canon = canonicalModelKey(model);
        byModel[canon] = (byModel[canon] || 0) + ((data && data.cost_usd) || 0);
        if (!byModelTokens[canon]) byModelTokens[canon] = { input: 0, output: 0 };
        byModelTokens[canon].input += (data && data.input_tokens) || 0;
        byModelTokens[canon].output += (data && data.output_tokens) || 0;
        byModelEstimated[canon] =
          (byModelEstimated[canon] || 0) + ((data && data.estimated_calls) || 0);
      }
    }
  }
  return { total, byModel, byModelTokens, byModelEstimated, estimatedCalls, monthsCovered: months };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC. analytics.mjs uses UTC throughout for cross-tz consistency.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

function monthsInRange(usage: Record<string, UsageMonthRoot>, range: DateRange): string[] {
  const all = Object.keys(usage || {}).sort();
  if (!range || range.preset === 'all') return all;
  if (!range.start || !range.end) return all;
  const fromMonth = range.start.slice(0, 7); // 'YYYY-MM'
  const toMonth = range.end.slice(0, 7);
  return all.filter(m => m >= fromMonth && m <= toMonth);
}
