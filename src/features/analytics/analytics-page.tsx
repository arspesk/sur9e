'use client';

// Orchestrator for /analytics. Compute helpers (totals, by-day series,
// archetype counts, funnel) live in lib/analytics/compute.ts.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/shell/topbar';
import type { ApplicationsResponse } from '@/features/table/table-types';
import { type UsageResponse, useUsage } from '@/hooks/use-analytics';
import { useApplications } from '@/hooks/use-applications';
import { type StatusLogResponse, useStatusLog } from '@/hooks/use-status-log';
import {
  aggregateUsageByMode,
  aggregateUsageByModel,
  computeFunnel,
  computeFunnelWithHistory,
  computeRejectionStats,
  computeStatusBreakdown,
  filterByDate,
  fmtDelta,
  fmtMoney,
  fmtMoneyDelta,
  PROVIDER_IDS,
  type ProviderFilter,
  type ProviderId,
  presetToRange,
  previousRange,
} from '@/lib/analytics/compute';
import { ArchetypeSection } from './archetype-section';
import { DateRangePicker, type Range } from './date-range-picker';
import { FunnelSection } from './funnel-section';
import { SpendSection } from './spend-section';
import { StatGrid } from './stat-grid';

const RANGE_KEY = 'sur9e.analytics.range';

function loadSavedRange(): Range | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RANGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Range;
    // Relative presets ('7d', '30d', etc.) were serialized with the absolute
    // dates that applied AT THE TIME OF SELECTION. A reload weeks later would
    // replay those stale dates instead of "the last 7 days from now," hiding
    // all recent activity from the funnel. Recompute against today; only
    // honor saved dates for 'custom' (explicit pick) and 'all' (no dates).
    if (saved?.preset && saved.preset !== 'custom' && saved.preset !== 'all') {
      return presetToRange(saved.preset) as Range;
    }
    return saved;
  } catch {
    return null;
  }
}

function saveRange(range: Range) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RANGE_KEY, JSON.stringify(range));
  } catch {
    // ignore
  }
}

interface AnalyticsPageProps {
  initialData?: {
    applications?: ApplicationsResponse;
    usage?: UsageResponse;
    statusLog?: StatusLogResponse;
  };
}

export function AnalyticsPage({ initialData }: AnalyticsPageProps = {}) {
  // SSR-safe: default to a deterministic 30d range so initial server-render
  // and first client-render agree. Real saved range loads in useEffect.
  const [range, setRange] = useState<Range>(() => presetToRange('30d') as Range);
  // Provider filter for the spend cards. 'all' = sum across every tracked
  // provider; 'claude' | 'codex' | 'opencode' = scope to that
  // provider. Defaults to 'all' so existing single-provider users see no
  // change.
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');

  useEffect(() => {
    const saved = loadSavedRange();
    if (saved) setRange(saved);
  }, []);

  const appsQuery = useApplications({ initialData: initialData?.applications });
  const usageQuery = useUsage({ initialData: initialData?.usage });
  const statusLogQuery = useStatusLog({ initialData: initialData?.statusLog });

  const loading = appsQuery.isPending || usageQuery.isPending;
  const entries = appsQuery.data?.entries ?? [];
  const usage = usageQuery.data;
  // History is enrichment: a failed/pending log fetch degrades to the
  // current-status funnel rather than blocking the page.
  const transitions = statusLogQuery.data?.transitions ?? [];

  // Snap providerFilter back to 'all' if the currently-selected provider has
  // no data in the current month (e.g. user deleted a CLI; data shifted).
  useEffect(() => {
    if (providerFilter === 'all') return;
    const monthKey = new Date().toISOString().slice(0, 7);
    const bucket = usage?.months?.[monthKey]?.[providerFilter];
    if (!bucket || !bucket.calls) setProviderFilter('all');
  }, [usage, providerFilter]);

  function updateRange(next: Range) {
    setRange(next);
    saveRange(next);
  }

  // ── Derived analytics state ────────────────────────────────────────────
  const derived = useMemo(() => {
    const prev = previousRange(range);
    const filteredCurr = filterByDate(entries, range);
    const filteredPrev = prev ? filterByDate(entries, prev) : null;

    // History-aware funnel: cumulate on max-stage-ever-reached so an offer
    // rejected after an interview keeps its responded/interview credit.
    // Falls back to current-status cumulation when the log is empty.
    const funnelCurr = transitions.length
      ? computeFunnelWithHistory(filteredCurr, transitions)
      : computeFunnel(filteredCurr);
    const funnelPrev = filteredPrev
      ? transitions.length
        ? computeFunnelWithHistory(filteredPrev, transitions)
        : computeFunnel(filteredPrev)
      : null;
    const breakdown = computeStatusBreakdown(filteredCurr);
    const rejections = computeRejectionStats(filteredCurr, transitions);
    const totalOffers = filteredCurr.length;

    const months = usage?.months || {};
    // pricedModels lets the aggregator attribute per-mode cost that came
    // from unpriced models, so the by-mode card can exclude it from dollar
    // rows the same way the by-model card renders those models as "N/A".
    const spend = aggregateUsageByMode(months, range, providerFilter, usage?.pricedModels);
    const modelSpend = aggregateUsageByModel(months, range, providerFilter);

    // Month spend (current calendar month vs previous calendar month — independent of picker range).
    // Sum across every provider bucket so the headline matches the "All" tab
    // (and keeps single-provider users on the same number they had before the
    // per-provider breakdown).
    // Local year/month keys — matches the writer (cli/usage-tracker.mjs
    // monthKey()), and anchored to day 1 so subtracting a month never rolls
    // forward (setMonth(-1) on e.g. May 31 normalizes April 31 → May 1,
    // which made prevMonthKey === monthKey and the delta compare the month
    // to itself).
    const fmtMonthKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const now = new Date();
    const monthKey = fmtMonthKey(now);
    const prevMonthKey = fmtMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const sumMonthSpend = (key: string): number | null => {
      const month = months[key];
      if (!month) return null;
      let total = 0;
      let seen = false;
      for (const p of PROVIDER_IDS) {
        const bucket = month[p];
        if (!bucket) continue;
        seen = true;
        total += bucket.cost_usd || 0;
      }
      return seen ? total : null;
    };
    const monthSpend = sumMonthSpend(monthKey);
    const prevMonthSpend = sumMonthSpend(prevMonthKey);
    const allTime = usage?.allTime?.cost_usd ?? null;

    // Per-provider current-month totals → drive tab visibility + the mini-strip.
    // A provider tab is only shown if that provider has ≥1 call in the current
    // month, and the tab strip itself only renders when at least 2 providers
    // have data (single-provider users see no UI change).
    const currentMonth = months[monthKey];
    const providerTotals = PROVIDER_IDS.map(id => {
      const bucket = currentMonth?.[id];
      return {
        id,
        calls: bucket?.calls ?? 0,
        cost: bucket?.cost_usd ?? 0,
        estimatedCalls: bucket?.estimated_calls ?? 0,
      };
    });
    const visibleProviders = providerTotals.filter(p => p.calls > 0).map(p => p.id);

    return {
      filteredCurr,
      funnelCurr,
      funnelPrev,
      breakdown,
      rejections,
      totalOffers,
      spend,
      modelSpend,
      monthSpend,
      prevMonthSpend,
      allTime,
      providerTotals,
      visibleProviders,
    };
  }, [entries, usage, range, providerFilter, transitions]);

  const monthDelta =
    derived.monthSpend != null && derived.prevMonthSpend != null
      ? fmtMoneyDelta(derived.monthSpend, derived.prevMonthSpend)
      : { text: '', kind: '' as const };

  const screenedDelta = derived.funnelPrev
    ? fmtDelta(derived.funnelCurr.screened, derived.funnelPrev.screened)
    : { text: '', kind: '' as const };
  const appliedDelta = derived.funnelPrev
    ? fmtDelta(derived.funnelCurr.applied, derived.funnelPrev.applied)
    : { text: '', kind: '' as const };

  return (
    <>
      <Topbar crumbs={[{ href: '/', label: 'Workspace' }, { label: 'Analytics' }]}>
        <DateRangePicker value={range} onChange={updateRange} />
      </Topbar>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">How your pipeline converts and what it costs</div>
        </div>
      </div>

      <div className="analytics-content" data-loading={loading ? 'true' : 'false'}>
        <div className="analytics-zone-label">Pipeline</div>
        <StatGrid
          screened={derived.funnelCurr.screened}
          applied={derived.funnelCurr.applied}
          monthSpend={derived.monthSpend != null ? fmtMoney(derived.monthSpend) : '—'}
          allTimeSpend={derived.allTime != null ? fmtMoney(derived.allTime) : '—'}
          screenedDelta={screenedDelta}
          appliedDelta={appliedDelta}
          monthSpendDelta={monthDelta}
        />

        <FunnelSection
          breakdown={derived.breakdown}
          totalOffers={derived.totalOffers}
          rejections={derived.rejections}
        />

        <ArchetypeSection entries={derived.filteredCurr} />

        <div className="analytics-zone-label">Usage</div>
        <SpendSection
          totals={derived.providerTotals}
          filter={providerFilter}
          onFilterChange={setProviderFilter}
          visibleProviders={derived.visibleProviders}
          spendByMode={derived.spend}
          spendByModel={derived.modelSpend}
          pricedModels={usage?.pricedModels}
        />
      </div>
    </>
  );
}
