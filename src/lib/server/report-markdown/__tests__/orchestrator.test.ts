import { describe, expect, it } from 'vitest';
import { checkReportMarkdown, normalizeReportMarkdown } from '../index';

describe('normalizer shell', () => {
  it('returns input unchanged and no fixes for already-clean markdown', () => {
    const clean = '## TL;DR\n\nA verdict line.\n';
    const { markdown, fixes } = normalizeReportMarkdown(clean);
    expect(markdown).toBe(clean);
    expect(fixes).toEqual([]);
  });
  it('checkReportMarkdown returns an array', () => {
    expect(Array.isArray(checkReportMarkdown('## TL;DR\n'))).toBe(true);
  });
});
