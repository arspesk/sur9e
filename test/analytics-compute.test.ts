import { describe, expect, it } from 'vitest';
import {
  computeFunnel,
  computeFunnelWithHistory,
  computeRejectionStats,
  computeStatusBreakdown,
  filterByDate,
  fmtDelta,
  fmtMoney,
  fmtMoneyDelta,
  fmtTokens,
  fmtTokensCombined,
  modeLabel,
  presetLabel,
  presetToRange,
  previousRange,
  topArchetypes,
} from '@/lib/analytics/compute';

describe('analytics compute — re-exports', () => {
  it('computeFunnel cumulates by current status', () => {
    const c = computeFunnel([
      { status: 'screened' },
      { status: 'evaluated' },
      { status: 'applied' },
      { status: 'interview' },
      { status: 'offer' },
      { status: 'discarded' },
      { status: 'skip' },
    ]);
    expect(c.screened).toBe(7);
    expect(c.evaluated).toBe(4);
    expect(c.applied).toBe(3);
    expect(c.interview).toBe(2);
    expect(c.offer).toBe(1);
    expect(c.discarded).toBe(2);
  });

  it('computeStatusBreakdown is exclusive (sums to total)', () => {
    const entries = [
      { status: 'screened' },
      { status: 'evaluated' },
      { status: 'applied' },
      { status: 'rejected' },
      { status: 'offer' },
      { status: 'discarded' },
    ];
    const b = computeStatusBreakdown(entries);
    const total = Object.values(b).reduce((a, n) => a + Number(n), 0);
    expect(total).toBe(entries.length);
    expect(b.applied).toBe(1);
    expect(b.rejected).toBe(1); // own bucket since the status-log feature
    expect(b.discarded).toBe(1);
  });

  it('filterByDate respects preset=all and inclusive bounds', () => {
    const entries = [{ date: '2026-04-01' }, { date: '2026-04-15' }, { date: '2026-05-01' }];
    expect(filterByDate(entries, { preset: 'all', start: null, end: null }).length).toBe(3);
    const subset = filterByDate(entries, {
      preset: '30d',
      start: '2026-04-10',
      end: '2026-05-01',
    });
    expect(subset.map(e => e.date)).toEqual(['2026-04-15', '2026-05-01']);
  });

  it('presetToRange + previousRange agree on span', () => {
    const today = new Date('2026-05-15T00:00:00Z');
    const r = presetToRange('30d', today);
    expect(r.preset).toBe('30d');
    expect(r.end).toBe('2026-05-15');
    expect(r.start).toBe('2026-04-15');
    const p = previousRange(r);
    expect(p).not.toBeNull();
    expect(p!.end).toBe('2026-04-14');
    expect(p!.preset).toBe('previous');
  });

  it('previousRange = null for preset=all', () => {
    expect(previousRange({ preset: 'all', start: null, end: null })).toBeNull();
  });
});

describe('analytics compute — formatters', () => {
  it('fmtMoney renders 2-decimal USD; em-dash for non-finite', () => {
    expect(fmtMoney(12.5)).toMatch(/\$12\.50/);
    expect(fmtMoney(0)).toMatch(/\$0\.00/);
    expect(fmtMoney(null)).toBe('—');
    expect(fmtMoney(Number.NaN)).toBe('—');
  });

  it('fmtTokens uses compact notation, "0" for ≤0', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(-5)).toBe('0');
    expect(fmtTokens(1500)).toMatch(/1\.5K/i);
  });

  it('fmtTokensCombined always shows tokens label even at 0', () => {
    expect(fmtTokensCombined(0, 0)).toBe('0 tokens');
    expect(fmtTokensCombined(1000, 500)).toMatch(/tokens$/);
  });

  it('fmtDelta handles missing prev / both-zero / prev-zero / diff signs', () => {
    expect(fmtDelta(5, null).text).toBe('');
    expect(fmtDelta(0, 0).text).toBe('—');
    expect(fmtDelta(3, 0).text).toBe('+3 added');
    const up = fmtDelta(12, 10);
    expect(up.kind).toBe('up');
    expect(up.text).toContain('▲');
    const dn = fmtDelta(8, 10);
    expect(dn.kind).toBe('dn');
    expect(dn.text).toContain('▼');
  });

  it('fmtMoneyDelta is empty when prev=0 or missing', () => {
    expect(fmtMoneyDelta(10, 0).text).toBe('');
    expect(fmtMoneyDelta(10, null).text).toBe('');
    const up = fmtMoneyDelta(15, 10);
    expect(up.kind).toBe('up');
    expect(up.text).toMatch(/▲/);
  });

  it('fmtMoneyDelta keeps the currency formatting on both directions (locale-safe)', () => {
    // Regression: `fmtMoney(diff).slice(1)` stripped the currency symbol on
    // positive deltas (and chopped a digit on symbol-suffix locales). Both
    // directions must render the full fmtMoney of the absolute diff.
    expect(fmtMoneyDelta(9, 6).text).toBe(`▲ +${fmtMoney(3)} (+50.0%)`);
    expect(fmtMoneyDelta(3, 6).text).toBe(`▼ ${fmtMoney(3)} (-50.0%)`);
  });

  it('modeLabel uses MODE_LABELS, falls back to title-case', () => {
    expect(modeLabel('evaluate')).toBe('Evaluations');
    expect(modeLabel('some-new-mode')).toBe('Some New Mode');
  });

  it('presetLabel maps known presets and defaults to 30d', () => {
    expect(presetLabel('7d')).toBe('Last 7 days');
    expect(presetLabel('all')).toBe('All time');
    expect(presetLabel('custom')).toBe('Custom range');
    expect(presetLabel('xyz')).toBe('Last 30 days');
  });
});

describe('analytics compute — topArchetypes', () => {
  it('returns top 5 by count, prefers archetype_short', () => {
    const entries = [
      { summary: { archetype_short: 'Senior FE' } },
      { summary: { archetype_short: 'Senior FE' } },
      { summary: { archetype_short: 'Staff BE' } },
      { summary: { archetype: 'DevRel' } },
      { summary: {} },
      { summary: { archetype_short: '  ' } },
    ];
    const top = topArchetypes(entries);
    expect(top[0]).toEqual({ name: 'Senior FE', count: 2 });
    expect(top.map(r => r.name)).toContain('Staff BE');
    expect(top.map(r => r.name)).toContain('DevRel');
  });

  it('limit slices result', () => {
    const e = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(n => ({
      summary: { archetype: n },
    }));
    const top = topArchetypes(e, 3);
    expect(top.length).toBe(3);
  });
});

describe('analytics compute — rejected bucket + history', () => {
  const entries = [
    { num: 1, status: 'Applied', date: '2026-06-01' },
    { num: 2, status: 'Rejected', date: '2026-06-01' },
    { num: 3, status: 'Rejected', date: '2026-06-01' },
    { num: 4, status: 'Interview', date: '2026-06-01' },
    { num: 5, status: 'Discarded', date: '2026-06-01' },
  ];
  // #3 reached interview before its rejection; #2 was rejected straight from applied.
  const transitions = [
    { num: 2, from: 'applied', to: 'rejected', at: '2026-06-05T00:00:00Z', source: 'app' },
    { num: 3, from: null, to: 'applied', at: '2026-06-01T00:00:00Z', source: 'app' },
    { num: 3, from: 'applied', to: 'interview', at: '2026-06-02T00:00:00Z', source: 'app' },
    { num: 3, from: 'interview', to: 'rejected', at: '2026-06-04T00:00:00Z', source: 'app' },
  ];

  it('computeStatusBreakdown gives rejected its own exclusive bucket', () => {
    const b = computeStatusBreakdown(entries);
    expect(b.rejected).toBe(2);
    expect(b.applied).toBe(1); // no longer inflated by rejections
    const total = Object.values(b).reduce((a, n) => a + n, 0);
    expect(total).toBe(entries.length); // exclusive buckets still sum to 100%
  });

  it('computeFunnel keeps cumulative semantics and reports rejected', () => {
    const f = computeFunnel(entries);
    expect(f.applied).toBe(4); // applied + 2 rejected + interview
    expect(f.interview).toBe(1); // current-status only — #3's interview history is invisible
    expect(f.rejected).toBe(2);
  });

  it('computeFunnelWithHistory restores deep-stage credit for rejected offers', () => {
    const f = computeFunnelWithHistory(entries, transitions);
    expect(f.interview).toBe(2); // #4 current + #3 from history
    expect(f.applied).toBe(4);
    expect(f.rejected).toBe(2);
  });

  it('computeRejectionStats: rate, stage-of-rejection, median days', () => {
    const r = computeRejectionStats(entries, transitions);
    expect(r.rejected).toBe(2);
    expect(r.appliedEver).toBe(4);
    expect(r.rejectionRatePct).toBe(50);
    expect(r.byStageFrom).toEqual({ applied: 1, interview: 1 });
    // Only #3 has an app-sourced applied→rejected pair: 3 days.
    expect(r.medianDaysAppliedToRejected).toBe(3);
  });

  it('computeRejectionStats scopes transitions to the passed entries', () => {
    const r = computeRejectionStats(
      entries.filter(e => e.num !== 3),
      transitions,
    );
    expect(r.byStageFrom).toEqual({ applied: 1 });
  });
});
