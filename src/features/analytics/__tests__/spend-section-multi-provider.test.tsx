// src/features/analytics/__tests__/spend-section-multi-provider.test.tsx
//
// UI tests for the per-provider spend tabs + estimated badge. Three
// contract anchors:
//
//   1. Single-provider users see no UI change → the SpendProviderTabs +
//      SpendProviderTotalsStrip components render nothing when fewer than
//      2 providers have data. This is the back-compat anchor; if it
//      breaks, the existing claude-only dashboard suddenly grows new
//      chrome.
//   2. Multi-provider users get tabs (All + every provider with ≥1 call)
//      and clicking a tab fires the onChange callback so the parent can
//      re-aggregate.
//   3. Rows with estimated_calls > 0 render an "est." badge with a tooltip
//      explaining the OpenCode-tiktoken provenance. Rows with
//      estimated_calls == 0 must not render the badge (otherwise every
//      mode row in the Claude tab would carry it).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  EstimatedBadge,
  type ProviderTotal,
  SpendByModeCard,
  SpendByModelCard,
  SpendProviderTabs,
  SpendProviderTotalsStrip,
} from '../spend-section';

// ── SpendProviderTabs ─────────────────────────────────────────────────────

describe('SpendProviderTabs', () => {
  it('renders nothing when only one provider has data', () => {
    const { container } = render(
      <SpendProviderTabs value="all" onChange={() => {}} visibleProviders={['claude']} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders All + Claude + Codex when two providers have data', () => {
    render(
      <SpendProviderTabs value="all" onChange={() => {}} visibleProviders={['claude', 'codex']} />,
    );
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Codex' })).toBeInTheDocument();
    // OpenCode tab MUST NOT render when opencode has no data.
    expect(screen.queryByRole('tab', { name: 'OpenCode' })).toBeNull();
  });

  it('marks the active tab with aria-selected=true', () => {
    render(
      <SpendProviderTabs
        value="codex"
        onChange={() => {}}
        visibleProviders={['claude', 'codex']}
      />,
    );
    const codex = screen.getByRole('tab', { name: 'Codex' });
    expect(codex).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('fires onChange with the clicked provider id', () => {
    const onChange = vi.fn();
    render(
      <SpendProviderTabs
        value="all"
        onChange={onChange}
        visibleProviders={['claude', 'opencode']}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'OpenCode' }));
    expect(onChange).toHaveBeenCalledWith('opencode');
  });
});

// ── SpendProviderTotalsStrip ──────────────────────────────────────────────

describe('SpendProviderTotalsStrip', () => {
  it('hides itself when fewer than 2 providers have calls (back-compat)', () => {
    const totals: ProviderTotal[] = [
      { id: 'claude', calls: 4, cost: 1.5, estimatedCalls: 0 },
      { id: 'codex', calls: 0, cost: 0, estimatedCalls: 0 },
      { id: 'opencode', calls: 0, cost: 0, estimatedCalls: 0 },
    ];
    const { container } = render(<SpendProviderTotalsStrip totals={totals} filter="all" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per active provider with cost + call count when filter=all', () => {
    const totals: ProviderTotal[] = [
      { id: 'claude', calls: 3, cost: 1.73, estimatedCalls: 0 },
      { id: 'codex', calls: 2, cost: 0.21, estimatedCalls: 0 },
      { id: 'opencode', calls: 5, cost: 0, estimatedCalls: 5 },
    ];
    render(<SpendProviderTotalsStrip totals={totals} filter="all" />);
    expect(screen.getByText('Claude:')).toBeInTheDocument();
    expect(screen.getByText('Codex:')).toBeInTheDocument();
    expect(screen.getByText('OpenCode:')).toBeInTheDocument();
    // Currency formatting uses the user's locale via Intl — assert on the
    // numeric portion that's stable across locales.
    expect(screen.getByText(s => s.startsWith('(3 call'))).toBeInTheDocument();
    // OpenCode is the only fully-estimated row in this fixture → only one
    // est. badge in the whole strip.
    expect(screen.getAllByText('est.')).toHaveLength(1);
  });

  it('renders only the selected provider when filter=claude', () => {
    const totals: ProviderTotal[] = [
      { id: 'claude', calls: 3, cost: 1.73, estimatedCalls: 0 },
      { id: 'codex', calls: 2, cost: 0.21, estimatedCalls: 0 },
    ];
    render(<SpendProviderTotalsStrip totals={totals} filter="claude" />);
    expect(screen.getByText('Claude:')).toBeInTheDocument();
    expect(screen.queryByText('Codex:')).toBeNull();
    // No trailing separator dot — single item.
    expect(screen.queryByText('·')).toBeNull();
  });
});

// ── EstimatedBadge ────────────────────────────────────────────────────────

describe('EstimatedBadge', () => {
  it('renders nothing when estimated == 0', () => {
    const { container } = render(<EstimatedBadge estimated={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the est. pill with a tooltip showing the estimated count', () => {
    render(<EstimatedBadge estimated={5} />);
    const badge = screen.getByText('est.');
    expect(badge).toBeInTheDocument();
    // Tooltip deliberately phrases the count as "includes N estimated calls"
    // rather than "N of M" — the aggregator doesn't track per-row total
    // calls, so a fractional denominator would lie on the merged "All" tab.
    expect(badge).toHaveAttribute(
      'title',
      expect.stringContaining('Includes 5 tiktoken-estimated'),
    );
    expect(badge.getAttribute('title')).toMatch(/OpenCode/);
  });
});

// ── SpendByModelCard — estimated rows ─────────────────────────────────────

describe('SpendByModelCard with estimated rows', () => {
  it('shows the est. badge next to model rows with estimated_calls > 0', () => {
    render(
      <SpendByModelCard
        spend={{
          total: 0,
          byModel: { 'anthropic/claude-3-haiku': 0 },
          byModelTokens: { 'anthropic/claude-3-haiku': { input: 500, output: 1000 } },
          byModelEstimated: { 'anthropic/claude-3-haiku': 2 },
          estimatedCalls: 2,
          monthsCovered: ['2026-05'],
        }}
      />,
    );
    // OpenCode model row renders as an "extra" row (not in MODEL_DISPLAY).
    const row = screen.getByText('anthropic/claude-3-haiku').closest('.spend-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('.spend-section__estimated-badge')).not.toBeNull();
  });

  it('does NOT show est. badge on a claude-only fixture (back-compat)', () => {
    render(
      <SpendByModelCard
        spend={{
          total: 1.73,
          byModel: { 'claude-sonnet-4-6': 1.73 },
          byModelTokens: { 'claude-sonnet-4-6': { input: 1234, output: 36612 } },
          byModelEstimated: {},
          estimatedCalls: 0,
          monthsCovered: ['2026-05'],
        }}
      />,
    );
    expect(screen.queryByText('est.')).toBeNull();
  });
});

// ── Unpriced reconciliation (2026-06-10 audit: spend totals must visibly
//    explain the gap between the stat cards and the breakdown Totals) ──────

describe('SpendByModelCard unpriced reconciliation', () => {
  const spend = {
    total: 23.15,
    byModel: {
      'claude-sonnet-4-6': 20.3,
      'opencode/deepseek-v4-flash-free': 2.85,
    },
    byModelTokens: {
      'claude-sonnet-4-6': { input: 50_000, output: 120_000 },
      'opencode/deepseek-v4-flash-free': { input: 100_000, output: 22_380 },
    },
    byModelEstimated: {},
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
  };

  it('marks N/A rows with a visible "unpriced" pill (not hover-title-only)', () => {
    render(
      <SpendByModelCard
        spend={spend}
        pricedModels={{ 'claude-sonnet-4-6': true, 'opencode/deepseek-v4-flash-free': false }}
      />,
    );
    const row = screen
      .getByText('opencode/deepseek-v4-flash-free')
      .closest('.spend-row') as HTMLElement;
    expect(row.querySelector('.spend-section__estimated-badge')?.textContent).toBe('unpriced');
    // Priced row carries no pill.
    const pricedRow = screen.getByText('claude-sonnet-4-6').closest('.spend-row') as HTMLElement;
    expect(pricedRow.querySelector('.spend-section__estimated-badge')).toBeNull();
  });

  it('renders a reconciliation footnote with the excluded amount under the Total', () => {
    render(
      <SpendByModelCard
        spend={spend}
        pricedModels={{ 'claude-sonnet-4-6': true, 'opencode/deepseek-v4-flash-free': false }}
      />,
    );
    // Computed from the unpriced rows ($2.85), never hardcoded copy.
    expect(
      screen.getByText(
        (s: string) =>
          s.startsWith('Excludes') && s.includes('2.85') && s.includes('no live price'),
      ),
    ).toBeInTheDocument();
  });

  it('renders no footnote when every row is priced', () => {
    const { container } = render(<SpendByModelCard spend={spend} />);
    expect(container.querySelector('.spend-row--footnote')).toBeNull();
  });
});

describe('SpendByModeCard unpriced reconciliation', () => {
  const spend = {
    total: 23.15,
    byMode: { evaluate: 20.3, session: 2.85 },
    byModeTokens: {
      evaluate: { input: 50_000, output: 120_000 },
      session: { input: 100_000, output: 22_380 },
    },
    byModeEstimated: {},
    unpricedByMode: { session: 2.85 },
    totalTokens: { input: 150_000, output: 142_380 },
    other: 0,
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
    evaluate: 20.3,
    screen: 0,
  };

  it('marks fully-unpriced mode rows with the "unpriced" pill and footnotes the Total', () => {
    render(<SpendByModeCard spend={spend} />);
    const row = screen.getByText('Session').closest('.spend-row') as HTMLElement;
    expect(row.querySelector('.spend-section__estimated-badge')?.textContent).toBe('unpriced');
    expect(
      screen.getByText(
        (s: string) =>
          s.startsWith('Excludes') && s.includes('2.85') && s.includes('no live price'),
      ),
    ).toBeInTheDocument();
  });

  it('renders no footnote when no unpriced spend was excluded', () => {
    const { container } = render(
      <SpendByModeCard spend={{ ...spend, byMode: { evaluate: 20.3 }, unpricedByMode: {} }} />,
    );
    expect(container.querySelector('.spend-row--footnote')).toBeNull();
  });
});
