import { describe, expect, it } from 'vitest';
import { TIER_MARK_COLOR } from '@/lib/scoring';
import { normalizeReportMarkdown } from '../index';

const TABLE = [
  '## Interview process',
  '',
  '| Rounds | Days end to end | Difficulty | Positive % |',
  '| --- | --- | --- | --- |',
  '| 3 | 26 to 90+ | 2.0 | 72% |',
  '| 4 | 30 | 3.0 | 50% |',
  '| 5 | 45 | 4.2 | 30% |',
  '',
].join('\n');

describe('interview-metrics-color auto-fixer', () => {
  it('colors Difficulty by tier — lower is greener (easier interview)', () => {
    const out = normalizeReportMarkdown(TABLE).markdown;
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.high}">2.0</mark>`); // < 2.5 → green
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">3.0</mark>`); // 2.5-3.5 → yellow
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.low}">4.2</mark>`); // > 3.5 → red
  });

  it('colors Positive % by tier — higher is greener', () => {
    const out = normalizeReportMarkdown(TABLE).markdown;
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.high}">72%</mark>`); // ≥ 60 → green
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">50%</mark>`); // 40-59 → yellow
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.low}">30%</mark>`); // < 40 → red
  });

  it('leaves Rounds / Days cells plain', () => {
    const out = normalizeReportMarkdown(TABLE).markdown;
    expect(out).toContain('| 3 |');
    expect(out).toContain('26 to 90+');
  });

  it('is idempotent — re-coloring an already-colored table is a no-op', () => {
    const once = normalizeReportMarkdown(TABLE).markdown;
    expect(normalizeReportMarkdown(once).markdown).toBe(once);
  });

  it('does not touch the TL;DR Axis|Score|Read table (no difficulty/positive cols)', () => {
    const tldr = [
      '| Axis | Score | Read |',
      '| --- | --- | --- |',
      '| Geo | 5.0 | remote |',
      '',
    ].join('\n');
    const out = normalizeReportMarkdown(tldr).markdown;
    expect(out).not.toContain('interview-metrics');
  });
});
