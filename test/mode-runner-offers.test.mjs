// test/mode-runner-offers.test.mjs
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { findOfferRow, markOfferPdf } from '../batch/lib/offers.mjs';

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'offers-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  writeFileSync(
    join(root, 'data/applications.md'),
    [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 7 | 2026-06-01 | Acme | SE | 4.2/5 | Evaluated | ✅ | [7](artifacts/reports/007-acme-2026-06-01.md) | great |',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    join(root, 'artifacts/reports/007-acme-2026-06-01.md'),
    '---\nnum: 7\ncompany: Acme\nurl: https://acme.com/jobs/1\nscore: 4.2\n---\n\n## TL;DR\n\nok\n',
    'utf-8',
  );
});

describe('findOfferRow', () => {
  it('returns company/role/reportPath/url for an existing num', () => {
    const offer = findOfferRow(root, 7);
    expect(offer).toEqual({
      num: 7,
      company: 'Acme',
      role: 'SE',
      reportPath: 'artifacts/reports/007-acme-2026-06-01.md',
      url: 'https://acme.com/jobs/1',
    });
  });

  it('returns null for a missing num', () => {
    expect(findOfferRow(root, 99)).toBeNull();
  });

  it('returns null when the report path escapes the root', () => {
    writeFileSync(
      join(root, 'data/applications.md'),
      '| 8 | d | Evil | R | 1/5 | Screened | ❌ | [8](../../etc/passwd) | x |',
      'utf-8',
    );
    expect(findOfferRow(root, 8)).toBeNull();
  });
});

describe('markOfferPdf', () => {
  beforeEach(() => {
    writeFileSync(
      join(root, 'data/applications.md'),
      [
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        '| 7 | 2026-06-01 | Acme | SE | 4.2/5 | Evaluated | ❌ | [7](artifacts/reports/007-acme-2026-06-01.md) | great |',
        '| 8 | 2026-06-02 | Beta | TAM | 4.0/5 | Evaluated | ✅ | [8](artifacts/reports/008-beta-2026-06-02.md) | ok |',
      ].join('\n'),
      'utf-8',
    );
  });

  it('flips the ❌ cell to ✅ and leaves every other cell intact', () => {
    expect(markOfferPdf(root, 7)).toBe(true);
    const lines = readFileSync(join(root, 'data/applications.md'), 'utf-8').split('\n');
    expect(lines[2]).toBe(
      '| 7 | 2026-06-01 | Acme | SE | 4.2/5 | Evaluated | ✅ | [7](artifacts/reports/007-acme-2026-06-01.md) | great |',
    );
    expect(lines[3]).toContain('| 8 |'); // neighbor row untouched
  });

  it('is a no-op success on an already-✅ row', () => {
    const before = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    expect(markOfferPdf(root, 8)).toBe(true);
    expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toBe(before);
  });

  it('returns false when no row matches the num', () => {
    expect(markOfferPdf(root, 99)).toBe(false);
  });
});
