import { describe, expect, it } from 'vitest';
import { TIER_MARK_COLOR } from '@/lib/scoring';
import { normalizeReportMarkdown } from '../index';

const TABLE = [
  '## TL;DR',
  '',
  '| Axis | Score | Read |',
  '| --- | --- | --- |',
  '| CV match | 3.8 | strong |',
  '| Geo | 5.0 | perfect |',
  '| Legitimacy | 1.0 | closed |',
  '',
].join('\n');

describe('score-tier-color auto-fixer', () => {
  it('colors Score and Read cells of the TL;DR axis table by tier', () => {
    const out = normalizeReportMarkdown(TABLE).markdown;
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">3.8</mark>`);
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.mid}">strong</mark>`);
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.high}">5.0</mark>`);
    expect(out).toContain(`<mark data-color="${TIER_MARK_COLOR.low}">closed</mark>`);
  });

  it('is idempotent — re-coloring an already-colored row is a no-op', () => {
    const once = normalizeReportMarkdown(TABLE).markdown;
    expect(normalizeReportMarkdown(once).markdown).toBe(once);
  });

  it('ignores non-TL;DR tables and tables without a Score column', () => {
    const t = '| A | B |\n| --- | --- |\n| 3.8 | x |\n';
    expect(normalizeReportMarkdown(t).markdown).toBe(t);
  });
});
