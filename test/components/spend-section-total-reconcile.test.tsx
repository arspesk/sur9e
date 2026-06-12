/**
 * test/components/spend-section-total-reconcile.test.tsx
 *
 * Regression for the "Spend by model / mode" Total reconciliation bugs:
 * 1. A model with no live OpenRouter price renders its money cell as "N/A"
 *    (not a dollar value), so its cost MUST be excluded from the card's own
 *    Total (e.g. an unpriced $2.79 deepseek row silently folded into a
 *    $21.40 total while the row showed "N/A").
 * 2. The by-mode card mirrors that exclusion per-row via spend.unpricedByMode
 *    — without it the two adjacent cards disagreed by exactly the unpriced
 *    cost ($21.40 vs $18.60) for identical data.
 * 3. Display dollars use penny-true allocation (largest-remainder rounding):
 *    each card's rows sum EXACTLY to round(exact priced total), so the user
 *    can add the visible rows up to the Total AND the two cards show the
 *    same Total when their underlying priced spend is the same (naive
 *    per-row rounding let the cards drift $0.01 apart).
 *
 * These are pure render assertions on the two exported cards — no fetch,
 * no server actions, nothing written to data/.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpendByModeCard, SpendByModelCard } from '@/features/analytics/spend-section';

function moneyOf(el: Element | null): string {
  return el?.querySelector('.v__money')?.textContent?.trim() ?? '';
}

describe('SpendByModelCard — Total reconciles with priced rows', () => {
  const spend = {
    total: 21.39, // sum of all models incl. the unpriced deepseek (17.63+2.79+0.97)
    byModel: {
      'claude-sonnet-4-6': 17.63,
      'opencode/deepseek-v4-flash-free': 2.79, // unpriced → renders N/A
      'claude-haiku-4-5': 0.97,
    },
    byModelTokens: {
      'claude-sonnet-4-6': { input: 1000, output: 500 },
      'opencode/deepseek-v4-flash-free': { input: 800, output: 200 },
      'claude-haiku-4-5': { input: 300, output: 100 },
    },
    byModelEstimated: {},
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
  };
  const pricedModels = {
    'claude-sonnet-4-6': true,
    'opencode/deepseek-v4-flash-free': false,
    'claude-haiku-4-5': true,
  };

  it('excludes the unpriced (N/A) model cost from the displayed Total', () => {
    const { container } = render(<SpendByModelCard spend={spend} pricedModels={pricedModels} />);

    // The unpriced row shows N/A, not a dollar value.
    const naRow = container.querySelector('[data-model="opencode/deepseek-v4-flash-free"]');
    expect(moneyOf(naRow)).toBe('N/A');

    // Priced rows show their dollar values…
    expect(moneyOf(container.querySelector('[data-model="claude-sonnet-4-6"]'))).toMatch(
      /\$17\.63/,
    );
    expect(moneyOf(container.querySelector('[data-model="claude-haiku-4-5"]'))).toMatch(/\$0\.97/);

    // …and the Total equals only the priced rows (17.63 + 0.97 = 18.60),
    // NOT 21.39 which would have folded in the N/A deepseek cost.
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$18\.60/);
    expect(total?.textContent).not.toMatch(/\$21\.39/);
  });

  it('Total equals spend.total when every model is priced', () => {
    const allPriced = {
      'claude-sonnet-4-6': true,
      'opencode/deepseek-v4-flash-free': true,
      'claude-haiku-4-5': true,
    };
    const { container } = render(<SpendByModelCard spend={spend} pricedModels={allPriced} />);
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$21\.39/);
  });

  it('rows are penny-allocated so they sum exactly to round(exact total)', () => {
    const drift = {
      ...spend,
      // Naive rounding shows $1.00 + $1.00 while the exact sum 2.008 rounds
      // to $2.01 — a one-cent drift. The allocator anchors the Total at
      // $2.01 and hands the missing penny to the row with the largest
      // flooring remainder, so rows ($1.01 + $1.00) sum to the Total.
      total: 2.008,
      byModel: { 'model-a': 1.004, 'model-b': 1.004 },
      byModelTokens: {
        'model-a': { input: 10, output: 10 },
        'model-b': { input: 10, output: 10 },
      },
    };
    const { container } = render(
      <SpendByModelCard spend={drift} pricedModels={{ 'model-a': true, 'model-b': true }} />,
    );
    const rowDollars = [
      moneyOf(container.querySelector('[data-model="model-a"]')),
      moneyOf(container.querySelector('[data-model="model-b"]')),
    ].map(t => Number(t.replace(/[$,]/g, '')));
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$2\.01/);
    expect(rowDollars.reduce((s, v) => s + v, 0)).toBeCloseTo(2.01, 10);
  });
});

describe('SpendByModeCard — Total reconciles with visible rows', () => {
  const spend = {
    total: 4.0, // evaluate 3.00 + screen 1.00, no untagged spend
    byMode: {
      evaluate: 3.0,
      screen: 1.0, // fully unpriced in this scenario → N/A
    },
    byModeTokens: {
      evaluate: { input: 1000, output: 500 },
      screen: { input: 400, output: 100 },
    },
    byModeEstimated: {},
    unpricedByMode: { screen: 1.0 },
    totalTokens: { input: 1400, output: 600 },
    other: 0,
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
    evaluate: 3.0,
    screen: 1.0,
  };

  it('renders N/A for a fully-unpriced mode and excludes it from the Total', () => {
    const { container } = render(<SpendByModeCard spend={spend} />);

    expect(moneyOf(container.querySelector('[data-mode="screen"]'))).toBe('N/A');
    expect(moneyOf(container.querySelector('[data-mode="evaluate"]'))).toMatch(/\$3\.00/);

    const total = container.querySelector('.spend-row--total .v__money');
    // 3.00 priced, 1.00 unpriced excluded → 3.00, not 4.00.
    expect(total?.textContent).toMatch(/\$3\.00/);
    expect(total?.textContent).not.toMatch(/\$4\.00/);
  });

  it('excludes a PARTIAL unpriced portion from a mixed mode row and the Total', () => {
    // The real-world shape: every mode has priced claude spend plus some
    // unpriced opencode spend — the old per-mode boolean could never
    // represent this, leaving the by-mode total $2.79 above the by-model one.
    const mixed = {
      ...spend,
      total: 5.5, // evaluate 3.50 (3.00 priced + 0.50 unpriced) + screen 2.00 (1.50 + 0.50)
      byMode: { evaluate: 3.5, screen: 2.0 },
      unpricedByMode: { evaluate: 0.5, screen: 0.5 },
      evaluate: 3.5,
      screen: 2.0,
    };
    const { container } = render(<SpendByModeCard spend={mixed} />);

    // Rows show only the priced portion, with a tooltip explaining the gap.
    const evaluateMoney = container.querySelector('[data-mode="evaluate"] .v__money');
    expect(evaluateMoney?.textContent).toMatch(/\$3\.00/);
    expect(evaluateMoney?.getAttribute('title')).toMatch(/Excludes \$0\.50/);
    expect(moneyOf(container.querySelector('[data-mode="screen"]'))).toMatch(/\$1\.50/);

    // Total = sum of displayed rows (3.00 + 1.50), not spend.total (5.50).
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$4\.50/);
    expect(total?.textContent).not.toMatch(/\$5\.50/);
  });

  it('keeps Other (untagged) dollar spend in the Total', () => {
    const withOther = {
      ...spend,
      other: 1.5,
      total: 5.5, // 3.00 + 1.00 + 1.50
      unpricedByMode: {},
    };
    const { container } = render(<SpendByModeCard spend={withOther} />);
    // All modes priced + other renders as a dollar row, so Total == spend.total.
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$5\.50/);
  });

  it('rows are penny-allocated so they sum exactly to round(exact total)', () => {
    const drift = {
      ...spend,
      total: 2.008, // naive rounding: rows $1.00+$1.00 vs exact → $2.01 drift
      byMode: { evaluate: 1.004, screen: 1.004 },
      unpricedByMode: {},
      evaluate: 1.004,
      screen: 1.004,
    };
    const { container } = render(<SpendByModeCard spend={drift} />);
    const rowDollars = [
      moneyOf(container.querySelector('[data-mode="evaluate"]')),
      moneyOf(container.querySelector('[data-mode="screen"]')),
    ].map(t => Number(t.replace(/[$,]/g, '')));
    const total = container.querySelector('.spend-row--total .v__money');
    expect(total?.textContent).toMatch(/\$2\.01/);
    expect(rowDollars.reduce((s, v) => s + v, 0)).toBeCloseTo(2.01, 10);
  });
});

describe('cross-card Total equality (same underlying priced spend)', () => {
  // Mirrors the real maintainer data where naive per-row rounding made the
  // by-mode card show $18.61 while the by-model card showed $18.60 for the
  // SAME exact priced spend (18.6038). With penny-true allocation both
  // cards anchor to round(18.6038) = $18.60.
  const byModeSpend = {
    total: 21.3957,
    byMode: {
      outreach: 5.1829,
      'tailor-cv': 4.5662,
      'cover-letter': 4.3031,
      evaluate: 3.3316,
      research: 1.7122,
      'interview-prep': 1.3274,
      screen: 0.9723,
    },
    byModeTokens: {},
    byModeEstimated: {},
    unpricedByMode: {
      'tailor-cv': 0.3091,
      'cover-letter': 0.228,
      evaluate: 0.415,
      research: 1.0945,
      'interview-prep': 0.7453,
    },
    totalTokens: { input: 0, output: 0 },
    other: 0,
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
    evaluate: 3.3316,
    screen: 0.9723,
  };
  const byModelSpend = {
    total: 21.3957,
    byModel: {
      'claude-sonnet-4-6': 17.6315,
      'opencode/deepseek-v4-flash-free': 2.7919,
      'claude-haiku-4-5': 0.9723,
    },
    byModelTokens: {
      'claude-sonnet-4-6': { input: 1, output: 1 },
      'opencode/deepseek-v4-flash-free': { input: 1, output: 1 },
      'claude-haiku-4-5': { input: 1, output: 1 },
    },
    byModelEstimated: {},
    estimatedCalls: 0,
    monthsCovered: ['2026-06'],
  };
  const pricedModels = {
    'claude-sonnet-4-6': true,
    'opencode/deepseek-v4-flash-free': false,
    'claude-haiku-4-5': true,
  };

  it('both cards show the identical Total', () => {
    const mode = render(<SpendByModeCard spend={byModeSpend} />);
    const model = render(<SpendByModelCard spend={byModelSpend} pricedModels={pricedModels} />);
    const modeTotal = mode.container.querySelector('.spend-row--total .v__money')?.textContent;
    const modelTotal = model.container.querySelector('.spend-row--total .v__money')?.textContent;
    expect(modeTotal).toBe('$18.60');
    expect(modelTotal).toBe('$18.60');
  });
});
