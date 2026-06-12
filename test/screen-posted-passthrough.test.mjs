// test/screen-posted-passthrough.test.mjs
//
// The `posted` pass-through: scan-history metadata → pending offer →
// buildScreenReport → report frontmatter + tracker TSV. Offers without
// `posted` must behave exactly as before (no key, empty TSV cell).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { buildScreenReport, loadScanMeta } from '../batch/screen.mjs';

const base = { num: 42, slug: 'acme', date: '2026-06-10', url: 'https://acme.com/jobs/1' };
const fields = {
  ...base,
  readable: true,
  company: 'Acme',
  role: 'Solutions Engineer',
  score: 4.2,
  tldr: '**Strong fit.** Inside band.',
};

function parseFm(report) {
  const m = report.match(/^---\n([\s\S]*?)\n---\n/);
  return yaml.load(m[1]);
}

describe('buildScreenReport — posted pass-through', () => {
  it('writes posted into frontmatter and the 10th TSV column', () => {
    const { report, tsv } = buildScreenReport({ ...fields, posted: '2026-06-01' }, 3);
    const fm = parseFm(report);
    expect(fm.posted).toBe('2026-06-01');
    expect(fm.date).toBe('2026-06-10'); // scan date untouched
    const cols = tsv.split('\t');
    expect(cols).toHaveLength(10);
    expect(cols[9]).toBe('2026-06-01');
  });

  it('omits the frontmatter key and leaves the TSV cell empty without posted', () => {
    const { report, tsv } = buildScreenReport(fields, 3);
    const fm = parseFm(report);
    expect('posted' in fm).toBe(false);
    expect(report).not.toContain('posted:');
    const cols = tsv.split('\t');
    expect(cols).toHaveLength(10);
    expect(cols[9]).toBe('');
  });

  it('drops an invalid posted value instead of writing garbage', () => {
    const { report, tsv } = buildScreenReport({ ...fields, posted: 'Posted 3 Days Ago' }, 3);
    expect('posted' in parseFm(report)).toBe(false);
    expect(tsv.split('\t')[9]).toBe('');
  });
});

describe('loadScanMeta', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('maps url → { logo, posted } from 8-column scan history and tolerates older short rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'scan-meta-'));
    const file = join(dir, 'scan-history.tsv');
    writeFileSync(
      file,
      [
        'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlogo\tposted',
        'https://a.com/1\t2026-06-10\tats-greenhouse\tSE\tAcme\tadded\t\t2026-06-01',
        'https://b.com/2\t2026-06-10\tjobspy-linkedin\tAE\tBeta\tadded\thttps://logo.example/b.png\t',
        // legacy 7-column row (logo, no posted)
        'https://c.com/3\t2026-06-01\tjobspy-indeed\tCSM\tGamma\tadded\thttps://logo.example/c.png',
        // legacy 6-column row (neither)
        'https://d.com/4\t2026-05-20\tats-lever\tSA\tDelta\tadded',
        // garbage in the posted cell must not surface as a date
        'https://e.com/5\t2026-06-10\tats-workday\tSE\tEpsilon\tadded\t\tlast week',
      ].join('\n') + '\n',
      'utf-8',
    );
    const meta = loadScanMeta(file);
    expect(meta.get('https://a.com/1')).toEqual({ logo: '', posted: '2026-06-01' });
    expect(meta.get('https://b.com/2')).toEqual({ logo: 'https://logo.example/b.png', posted: '' });
    expect(meta.get('https://c.com/3')).toEqual({ logo: 'https://logo.example/c.png', posted: '' });
    expect(meta.has('https://d.com/4')).toBe(false); // nothing useful to carry
    expect(meta.has('https://e.com/5')).toBe(false); // invalid date dropped
  });

  it('returns an empty map when the history file is missing', () => {
    expect(loadScanMeta('/nonexistent/scan-history.tsv').size).toBe(0);
  });
});
