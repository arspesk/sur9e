import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bucketByUrl, canonUrl, reportPathFromCell, resolveEntryUrl } from '../cli/lib/job-url.mjs';

describe('canonUrl', () => {
  it('canonicalizes equivalent URLs (host case, default port)', () => {
    expect(canonUrl('https://Example.com:443/jobs/1')).toBe('https://example.com/jobs/1');
  });

  it('returns null for empty / unparseable values', () => {
    expect(canonUrl('')).toBeNull();
    expect(canonUrl(null)).toBeNull();
    expect(canonUrl(undefined)).toBeNull();
    expect(canonUrl('not a url')).toBeNull();
  });
});

describe('reportPathFromCell', () => {
  it('extracts the path from a markdown report link', () => {
    expect(reportPathFromCell('[917](artifacts/reports/917-linkedin-2026-06-07.md)')).toBe(
      'artifacts/reports/917-linkedin-2026-06-07.md',
    );
  });

  it('returns null for a bare dash (no report)', () => {
    expect(reportPathFromCell('—')).toBeNull();
    expect(reportPathFromCell('')).toBeNull();
    expect(reportPathFromCell(null)).toBeNull();
  });
});

describe('bucketByUrl', () => {
  it('clusters rows that share the same URL (true duplicate)', () => {
    const u = 'https://www.linkedin.com/jobs/view/4413633290';
    const buckets = bucketByUrl([
      { num: 916, url: u },
      { num: 917, url: u },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].map(e => e.num)).toEqual([916, 917]);
  });

  it('separates rows with different known URLs (same title, distinct postings)', () => {
    const buckets = bucketByUrl([
      { num: 11, url: 'https://www.linkedin.com/jobs/view/4424703488' },
      { num: 13, url: 'https://www.linkedin.com/jobs/view/4421197239' },
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets.every(b => b.length === 1)).toBe(true);
  });

  it('clusters rows with unknown URLs together (conservative fallback)', () => {
    const buckets = bucketByUrl([
      { num: 1, url: null },
      { num: 2, url: null },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toHaveLength(2);
  });

  it('keeps a known-URL row separate from an unknown-URL row', () => {
    const buckets = bucketByUrl([
      { num: 1, url: 'https://example.com/jobs/1' },
      { num: 2, url: null },
    ]);
    expect(buckets).toHaveLength(2);
  });
});

describe('resolveEntryUrl', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'job-url-'));
    mkdirSync(join(root, 'artifacts', 'reports'), { recursive: true });
    writeFileSync(
      join(root, 'artifacts', 'reports', '917-x.md'),
      '---\nnum: 917\nurl: https://www.linkedin.com/jobs/view/4413633290\n---\n\nbody\n',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the canonical URL from the linked report frontmatter', () => {
    const url = resolveEntryUrl(root, '[917](artifacts/reports/917-x.md)');
    expect(url).toBe('https://www.linkedin.com/jobs/view/4413633290');
  });

  it('returns null when the row has no report link (bare dash)', () => {
    expect(resolveEntryUrl(root, '—')).toBeNull();
  });

  it('returns null when the linked report file is missing', () => {
    expect(resolveEntryUrl(root, '[999](artifacts/reports/999-gone.md)')).toBeNull();
  });

  it('memoizes reads per report path via the shared cache', () => {
    const cache = new Map();
    resolveEntryUrl(root, '[917](artifacts/reports/917-x.md)', cache);
    expect(cache.get('artifacts/reports/917-x.md')).toBe(
      'https://www.linkedin.com/jobs/view/4413633290',
    );
  });
});
