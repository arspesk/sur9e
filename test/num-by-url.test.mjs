import { describe, expect, it } from 'vitest';
import { resolveNumByUrl } from '../cli/num-by-url.mjs';

const report = (num, url) => ({ frontmatter: { num, url } });

describe('resolveNumByUrl', () => {
  it('resolves the num for a matching URL', () => {
    const reports = [
      report(7, 'https://example.com/jobs/1'),
      report(9, 'https://example.com/jobs/2'),
    ];
    expect(resolveNumByUrl(reports, 'https://example.com/jobs/2')).toBe(9);
  });

  it('returns the highest num when the URL was screened more than once', () => {
    const reports = [
      report(3, 'https://example.com/jobs/1'),
      report(12, 'https://example.com/jobs/1'),
    ];
    expect(resolveNumByUrl(reports, 'https://example.com/jobs/1')).toBe(12);
  });

  it('canonicalizes equivalent URLs (host case, default port)', () => {
    const reports = [report(4, 'https://Example.com:443/jobs/1')];
    expect(resolveNumByUrl(reports, 'https://example.com/jobs/1')).toBe(4);
  });

  it('returns null when nothing matches', () => {
    expect(resolveNumByUrl([report(1, 'https://a.example/x')], 'https://b.example/y')).toBeNull();
  });

  it('skips reports with missing url or non-integer num frontmatter', () => {
    const reports = [
      { frontmatter: {} },
      { frontmatter: { num: 'NaN', url: 'https://example.com/jobs/1' } },
      report(2, 'https://example.com/jobs/1'),
    ];
    expect(resolveNumByUrl(reports, 'https://example.com/jobs/1')).toBe(2);
  });

  it('returns null for an unparseable target URL', () => {
    expect(resolveNumByUrl([report(1, 'https://a.example/x')], 'not a url')).toBeNull();
  });
});
