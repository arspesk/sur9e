'use client';

// Two spend cards: Spend by mode + Spend by model. One row per mode
// (sorted desc by cost) plus Other for untracked spend; one row per
// canonical model family (Haiku/Sonnet/Opus) plus unknown keys.
//
// Per-provider additions:
//   • SpendProviderTabs — segmented control above the cards (All / Claude /
//     Codex / OpenCode). Only renders when ≥2 providers have data in the
//     current month, so single-provider users see no UI change.
//   • SpendProviderTotalsStrip — three-up summary above the tabs.
//   • EstimatedBadge — small "est." pill on rows where `estimated_calls > 0`
//     (currently OpenCode rows estimated via tiktoken at job close).

import { Card } from '@/components/primitives';
import type { aggregateUsageByMode, aggregateUsageByModel } from '@/lib/analytics/compute';
import {
  fmtMoney,
  fmtTokensCombined,
  modeLabel,
  type ProviderFilter,
  type ProviderId,
} from '@/lib/analytics/compute';

type ByMode = ReturnType<typeof aggregateUsageByMode>;
type ByModel = ReturnType<typeof aggregateUsageByModel>;

// ── Provider tab strip ────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
};

export interface ProviderTotal {
  id: ProviderId;
  calls: number;
  cost: number;
  estimatedCalls: number;
}

interface SpendProviderTabsProps {
  value: ProviderFilter;
  onChange: (next: ProviderFilter) => void;
  // Providers with ≥1 call in the current month — drives which tabs render.
  visibleProviders: readonly ProviderId[];
}

/**
 * Segmented control above the spend cards. Hidden entirely when fewer
 * than 2 providers have data — single-provider users get the same UI
 * they had before the per-provider breakdown.
 */
export function SpendProviderTabs({ value, onChange, visibleProviders }: SpendProviderTabsProps) {
  if (visibleProviders.length < 2) return null;
  const tabs: ProviderFilter[] = ['all', ...visibleProviders];
  return (
    <div className="spend-section__tabs" role="tablist" aria-label="Filter spend by provider">
      {tabs.map(tab => {
        const label = tab === 'all' ? 'All' : PROVIDER_LABELS[tab];
        const active = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            className="spend-section__tab"
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(tab)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface SpendProviderTotalsStripProps {
  totals: readonly ProviderTotal[];
  // Current provider filter. `'all'` → show every provider with calls > 0
  // (original behaviour). A specific provider id → show only that provider's
  // entry (single item; no separator dot).
  // The "fewer-than-2-providers" guard is based on the UNFILTERED totals so
  // that single-provider installs still see no strip — same anchor as the tabs.
  filter: ProviderFilter;
}

/**
 * Summary strip shown below the tabs: per-provider total spend + call count.
 *
 * Visibility rule:
 *   Hidden entirely when fewer than 2 providers have ≥1 call in the
 *   unfiltered totals — single-provider installs are unaffected.
 *
 * Filtering (new in polish pass):
 *   • filter === 'all'   → show every provider with calls > 0.
 *   • filter === '<id>'  → show only that provider's entry (no separator).
 */
export function SpendProviderTotalsStrip({ totals, filter }: SpendProviderTotalsStripProps) {
  // Guard based on unfiltered totals — preserves back-compat for single-provider users.
  const allWithCalls = totals.filter(t => t.calls > 0);
  if (allWithCalls.length < 2) return null;

  // Apply the active filter for display.
  const visible = filter === 'all' ? allWithCalls : allWithCalls.filter(t => t.id === filter);

  return (
    <div className="spend-section__strip">
      {visible.map((t, idx) => {
        const isEstimated = t.estimatedCalls > 0;
        return (
          <span key={t.id} className="spend-section__strip-item">
            <span className="spend-section__strip-name">{PROVIDER_LABELS[t.id]}:</span>{' '}
            <span className="spend-section__strip-cost">{fmtMoney(t.cost)}</span>
            {isEstimated ? <EstimatedBadge estimated={t.estimatedCalls} /> : null}
            <span className="spend-section__strip-calls">
              {' '}
              ({t.calls} call{t.calls === 1 ? '' : 's'})
            </span>
            {idx < visible.length - 1 ? <span className="spend-section__strip-sep">·</span> : null}
          </span>
        );
      })}
    </div>
  );
}

// ── Estimated badge ───────────────────────────────────────────────────────

interface EstimatedBadgeProps {
  // Number of calls in this row whose tokens were locally estimated
  // (currently OpenCode via tiktoken). The aggregator doesn't track total
  // call count per mode/model row, so the tooltip deliberately doesn't
  // claim a denominator — saying "5 of 5" on the merged "All" tab when
  // claude contributed 3 measured + opencode 5 estimated would lie.
  estimated: number;
}

/**
 * Small pill marking rows where one or more calls had locally-estimated
 * tokens (currently OpenCode via tiktoken at job close — OpenCode doesn't
 * emit native usage telemetry, so tokens are inferred, not measured).
 */
export function EstimatedBadge({ estimated }: EstimatedBadgeProps) {
  if (!estimated || estimated <= 0) return null;
  const title =
    `Includes ${estimated} tiktoken-estimated call${estimated === 1 ? '' : 's'} ` +
    `(OpenCode does not emit native usage telemetry, so tokens are inferred)`;
  return (
    <span className="spend-section__estimated-badge" title={title} aria-label={title}>
      est.
    </span>
  );
}

// ── Unpriced badge ────────────────────────────────────────────────────────

interface UnpricedBadgeProps {
  /** Tooltip detail — defaults to the by-model phrasing. */
  title?: string;
}

/**
 * Small pill marking rows whose dollar value renders "N/A" because the
 * underlying model has no live OpenRouter price. Always visible (the
 * explanation used to live only in a hover title, which never surfaces on
 * touch devices) and reuses the est. pill chrome so the two qualifiers
 * read as one family.
 */
export function UnpricedBadge({ title }: UnpricedBadgeProps) {
  const text =
    title ??
    'No live OpenRouter price for this model — its spend is excluded from the Total below.';
  return (
    <span className="spend-section__estimated-badge" title={text} aria-label={text}>
      unpriced
    </span>
  );
}

/**
 * Reconciliation footnote under a card's Total row. Rendered only when
 * unpriced spend was excluded from the Total, so the card's rows + Total
 * visibly explain why they sum below the page-level stat cards.
 */
function UnpricedFootnote({ excluded }: { excluded: number }) {
  if (excluded < 0.005) return null;
  // No trailing empty .v column — the muted text takes the full row width
  // instead of being squeezed by the value grid's reserved columns.
  return (
    <div className="spend-row spend-row--empty spend-row--footnote">
      <span className="k">{`Excludes ${fmtMoney(excluded)} from models with no live price`}</span>
    </div>
  );
}

// ── Spend by mode ─────────────────────────────────────────────────────────

interface SpendByModeProps {
  spend: ByMode;
}

// Penny-true display rounding (largest-remainder / Hamilton method): round
// each value to cents such that the rounded values sum EXACTLY to the exact
// total rounded to cents. Naive per-row rounding can drift a cent from the
// rounded total (rows $1.004 + $1.004 → $1.00 + $1.00 vs exact $2.008 →
// $2.01), and because the two spend cards slice the same spend differently,
// independent drift made their Totals disagree by $0.01. Anchoring both
// cards to round(exact priced total) and nudging the rows to match keeps
// every invariant: rows sum to the Total, and both cards show the same
// number when their underlying priced spend is the same.
function allocateDisplayCents(values: number[]): number[] {
  const targetCents = Math.round(values.reduce((s, v) => s + v, 0) * 100);
  const floors = values.map(v => Math.floor(v * 100));
  let remaining = targetCents - floors.reduce((s, c) => s + c, 0);
  // Hand the missing pennies to the rows that lost the most in flooring.
  const byRemainder = values
    .map((v, i) => ({ i, rem: v * 100 - Math.floor(v * 100) }))
    .sort((a, b) => b.rem - a.rem);
  const cents = [...floors];
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    cents[i] += 1;
    remaining -= 1;
  }
  return cents.map(c => c / 100);
}

export function SpendByModeCard({ spend }: SpendByModeProps) {
  const sortedModes = Object.entries(spend.byMode).sort((a, b) => b[1] - a[1]);
  const totalTokenStr = fmtTokensCombined(
    spend.totalTokens?.input || 0,
    spend.totalTokens?.output || 0,
  );

  // Reconcile the Total with the visible rows, mirroring the by-model card's
  // "N/A" semantics. spend.unpricedByMode carries each mode's cost that came
  // from unpriced models (no live OpenRouter price): that portion is excluded
  // from the row's displayed dollars — a fully-unpriced row renders "N/A" —
  // so the Total sums exactly what the rows show. `other` (untagged spend)
  // stays in the total since it renders as a dollar row. Displayed dollars
  // come from allocateDisplayCents so the rows sum penny-true to the Total
  // and both spend cards anchor to the same rounded priced total.
  const rows = sortedModes.map(([mode, cost]) => {
    const unpriced = spend.unpricedByMode?.[mode] ?? 0;
    const pricedCost = Math.max(0, cost - unpriced);
    const fullyUnpriced = cost > 0 && pricedCost < 0.005;
    return { mode, cost, unpriced, pricedCost, fullyUnpriced, display: 0 };
  });
  const showOther = spend.other > 0.01;
  const dollarRows = rows.filter(r => !r.fullyUnpriced);
  const allocated = allocateDisplayCents([
    ...dollarRows.map(r => r.pricedCost),
    ...(showOther ? [spend.other] : []),
  ]);
  dollarRows.forEach((r, i) => {
    r.display = allocated[i];
  });
  const otherDisplay = showOther ? allocated[allocated.length - 1] : 0;
  const pricedTotal = allocated.reduce((s, v) => s + v, 0);
  // Everything the Total visibly leaves out: the whole cost of fully-unpriced
  // rows (they render "N/A") plus the unpriced slice of partially-priced rows.
  const excludedUnpriced = rows.reduce((s, r) => s + (r.fullyUnpriced ? r.cost : r.unpriced), 0);

  return (
    <div className="spend-card spend-card--inner">
      <h2>Spend by mode</h2>
      <div id="spendRows">
        {sortedModes.length === 0 && spend.other <= 0.01 ? (
          <div className="spend-row spend-row--empty">
            <span className="k">No spend recorded in this range yet.</span>
            <span className="v" />
          </div>
        ) : (
          <>
            {rows.map(({ mode, unpriced, display, fullyUnpriced }) => {
              const t = spend.byModeTokens?.[mode] || { input: 0, output: 0 };
              const tok = fmtTokensCombined(t.input, t.output);
              // by_mode entries don't carry per-mode call counts in the
              // aggregate (only token + cost + estimated_calls); the badge's
              // tooltip is phrased to surface only the estimated count, not
              // a fraction, so the merged "All" tab stays honest.
              const estimated = spend.byModeEstimated?.[mode] ?? 0;
              const title = fullyUnpriced
                ? 'No live OpenRouter price for the underlying model(s).'
                : unpriced > 0.005
                  ? `Excludes ${fmtMoney(unpriced)} from model(s) with no live OpenRouter price.`
                  : undefined;
              return (
                <div className="spend-row" data-mode={mode} key={mode}>
                  <span className="k">
                    {modeLabel(mode)}
                    <EstimatedBadge estimated={estimated} />
                    {fullyUnpriced ? (
                      <UnpricedBadge title="No live OpenRouter price for the underlying model(s) — this spend is excluded from the Total below." />
                    ) : null}
                  </span>
                  <span className="v" data-spend={mode}>
                    <span className="v__money" title={title}>
                      {fullyUnpriced ? 'N/A' : fmtMoney(display)}
                    </span>
                    <span className="tok">{`· ${tok}`}</span>
                  </span>
                </div>
              );
            })}
            {showOther && (
              <div
                className="spend-row"
                data-mode="other"
                title="Spend that hit trackProvider without a mode tag — typically API calls outside the web backend."
              >
                <span className="k">Other (untagged)</span>
                <span className="v" data-spend="other">
                  ~{fmtMoney(otherDisplay)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <div className="spend-row spend-row--total">
        <span className="k">Total</span>
        <span className="v" data-spend="total">
          <span className="v__money">{fmtMoney(pricedTotal)}</span>
          <span className="tok">{`· ${totalTokenStr}`}</span>
        </span>
      </div>
      <UnpricedFootnote excluded={excludedUnpriced} />
    </div>
  );
}

// ── Spend by model ────────────────────────────────────────────────────────

interface SpendByModelProps {
  spend: ByModel;
  // Server-provided map: which canonical models have live OpenRouter
  // pricing. Distinguishes legitimately-free OR `:free` tier models
  // (priced: true, cost: $0.00) from unpriced ones (priced: false,
  // render: "N/A"). Missing entries default to `true` (vacuous).
  pricedModels?: Record<string, boolean>;
}

export function SpendByModelCard({ spend, pricedModels }: SpendByModelProps) {
  function modelTokensCombined(key: string): string {
    const t = spend.byModelTokens?.[key] || { input: 0, output: 0 };
    return fmtTokensCombined(t.input, t.output);
  }

  // Render every model with non-zero usage (cost > 0 OR tokens > 0). No
  // hardcoded model list: rows appear only after a provider+model has
  // actually been used. Keeps the card honest in multi-provider setups
  // where a user might never run e.g. Opus 4.7 yet had it pre-listed.
  const rows = Object.entries(spend.byModel)
    .map(([key, cost]) => ({
      key,
      label: key,
      cost,
      tok: modelTokensCombined(key),
      tokens: spend.byModelTokens?.[key] ?? { input: 0, output: 0 },
      estimated: spend.byModelEstimated?.[key] ?? 0,
      priced: pricedModels?.[key] !== false,
    }))
    .filter(r => r.cost > 0 || r.tokens.input > 0 || r.tokens.output > 0)
    .sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key));

  // Total tokens combined from all model entries.
  const totalT = Object.values(spend.byModelTokens || {}).reduce(
    (s, v) => ({
      input: s.input + (v.input || 0),
      output: s.output + (v.output || 0),
    }),
    { input: 0, output: 0 },
  );
  const totalTok = fmtTokensCombined(totalT.input, totalT.output);

  // Reconcile the Total with the visible rows: rows whose model has no live
  // OpenRouter price render "N/A" (not a dollar value), so their cost must be
  // excluded from the displayed Total too — otherwise the per-row dollars
  // can't sum to the Total (e.g. an unpriced model silently folded $2.79 into
  // a $21.40 total while showing N/A). Displayed dollars come from
  // allocateDisplayCents so rows sum penny-true to the Total and both spend
  // cards anchor to the same rounded priced total.
  const pricedRows = rows.filter(r => r.priced);
  const allocated = allocateDisplayCents(pricedRows.map(r => r.cost));
  const display = new Map(pricedRows.map((r, i) => [r.key, allocated[i]]));
  const pricedTotal = allocated.reduce((s, v) => s + v, 0);
  // Spend the Total visibly leaves out — the cost of every "N/A" row.
  const excludedUnpriced = rows.filter(r => !r.priced).reduce((s, r) => s + r.cost, 0);

  return (
    <div className="spend-card spend-card--inner">
      <h2>Spend by model</h2>
      <div id="modelRows">
        {rows.map(({ key, label, tok, estimated, priced }) => (
          <div className="spend-row" data-model={key} key={key}>
            <span className="k">
              {label}
              <EstimatedBadge estimated={estimated} />
              {priced ? null : <UnpricedBadge />}
            </span>
            <span className="v">
              <span
                className="v__money"
                title={priced ? undefined : 'No live OpenRouter price for this model.'}
              >
                {priced ? fmtMoney(display.get(key) ?? 0) : 'N/A'}
              </span>
              <span className="tok">{`· ${tok}`}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="spend-row spend-row--total">
        <span className="k">Total</span>
        <span className="v" data-model-total="">
          <span className="v__money">{fmtMoney(pricedTotal)}</span>
          <span className="tok">{`· ${totalTok}`}</span>
        </span>
      </div>
      <UnpricedFootnote excluded={excludedUnpriced} />
    </div>
  );
}

// ── Consolidated Spend card (2026-06-04 polish: Pipeline/Spend zones) ────
// One card hosting the provider strip + tabs in its header and the
// by-mode | by-model breakdowns side by side. The inner cards keep their
// markup but drop their own Card chrome (spend-card--inner).

interface SpendSectionProps {
  totals: readonly ProviderTotal[];
  filter: ProviderFilter;
  onFilterChange: (next: ProviderFilter) => void;
  visibleProviders: readonly ProviderId[];
  spendByMode: ByMode;
  spendByModel: ByModel;
  pricedModels?: Record<string, boolean>;
}

export function SpendSection({
  totals,
  filter,
  onFilterChange,
  visibleProviders,
  spendByMode,
  spendByModel,
  pricedModels,
}: SpendSectionProps) {
  return (
    <Card className="spend-section-card anim-enter">
      <div className="spend-section-card__head">
        <h2 className="spend-section-card__title">Spend breakdown</h2>
        <SpendProviderTabs
          value={filter}
          onChange={onFilterChange}
          visibleProviders={visibleProviders}
        />
        <SpendProviderTotalsStrip totals={totals} filter={filter} />
      </div>
      <div className="spend-section-card__grid">
        <SpendByModeCard spend={spendByMode} />
        <SpendByModelCard spend={spendByModel} pricedModels={pricedModels} />
      </div>
    </Card>
  );
}
