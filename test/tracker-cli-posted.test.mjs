// test/tracker-cli-posted.test.mjs
//
// Round-trip tests for the optional trailing `Posted` tracker column across
// the three tracker CLIs (merge / normalize / dedup). Each script is run as a
// real subprocess against tmp fixtures via the SUR9E_APPS_FILE /
// SUR9E_ADDITIONS_DIR overrides — never against the maintainer's
// data/applications.md. Legacy 9-column rows must keep working unchanged.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..');

const HEADER = [
  '# Applications Tracker',
  '',
  '| #   | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |',
  '| --- | ---- | ------- | ---- | ----- | ------ | --- | ------ | ----- | ------ |',
].join('\n');

function runCli(script, env, args = []) {
  return execFileSync('node', [join(REPO, script), ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function rowByNum(content, num) {
  return content.split('\n').find(l => l.startsWith(`| ${num} |`));
}

let root;
let appsFile;
let additionsDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tracker-cli-posted-'));
  appsFile = join(root, 'applications.md');
  additionsDir = join(root, 'tracker-additions');
  mkdirSync(additionsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('merge-tracker — posted column', () => {
  it('merges a 10-col TSV into a 10-col row and a 9-col TSV into an empty posted cell', () => {
    writeFileSync(
      appsFile,
      `${HEADER}\n| 100 | 2026-06-01 | OldCo | Old Role | 4.0/5 | Evaluated | ❌ | [100](artifacts/reports/100-oldco-2026-06-01.md) | legacy row |\n`,
      'utf-8',
    );
    // 10-col TSV (status-before-score order — the screener/evaluate shape)
    writeFileSync(
      join(additionsDir, '101-acme.tsv'),
      '101\t2026-06-10\tAcme\tSolutions Engineer\tEvaluated\t4.5/5\t❌\t[101](artifacts/reports/101-acme-2026-06-10.md)\tevaluated\t2026-06-02\n',
      'utf-8',
    );
    // 9-col TSV (legacy, no posted)
    writeFileSync(
      join(additionsDir, '102-beta.tsv'),
      '102\t2026-06-10\tBeta\tSales Engineer\tEvaluated\t4.1/5\t❌\t[102](artifacts/reports/102-beta-2026-06-10.md)\tevaluated\n',
      'utf-8',
    );

    runCli('cli/merge-tracker.mjs', {
      SUR9E_APPS_FILE: appsFile,
      SUR9E_ADDITIONS_DIR: additionsDir,
    });

    const out = readFileSync(appsFile, 'utf-8');
    expect(rowByNum(out, 101)).toBe(
      '| 101 | 2026-06-10 | Acme | Solutions Engineer | 4.5/5 | Evaluated | ❌ | [101](artifacts/reports/101-acme-2026-06-10.md) | evaluated | 2026-06-02 |',
    );
    expect(rowByNum(out, 102)).toBe(
      '| 102 | 2026-06-10 | Beta | Sales Engineer | 4.1/5 | Evaluated | ❌ | [102](artifacts/reports/102-beta-2026-06-10.md) | evaluated |  |',
    );
    // Untouched legacy row stays byte-identical (no migration, no backfill).
    expect(rowByNum(out, 100)).toBe(
      '| 100 | 2026-06-01 | OldCo | Old Role | 4.0/5 | Evaluated | ❌ | [100](artifacts/reports/100-oldco-2026-06-01.md) | legacy row |',
    );
  });

  it('re-eval update carries the new posted and falls back to the existing one', () => {
    writeFileSync(
      appsFile,
      `${HEADER}\n| 200 | 2026-06-01 | Acme | Solutions Engineer | 4.0/5 | Evaluated | ❌ | [200](artifacts/reports/200-acme-2026-06-01.md) | evaluated | 2026-05-20 |\n`,
      'utf-8',
    );
    // Re-eval TSV WITHOUT posted — the row's existing posted must survive.
    writeFileSync(
      join(additionsDir, '200-acme.tsv'),
      '200\t2026-06-10\tAcme\tSolutions Engineer\tEvaluated\t4.4/5\t❌\t[200](artifacts/reports/200-acme-2026-06-10.md)\tre-run\n',
      'utf-8',
    );
    runCli(
      'cli/merge-tracker.mjs',
      { SUR9E_APPS_FILE: appsFile, SUR9E_ADDITIONS_DIR: additionsDir },
      ['--re-eval=200'],
    );
    const row = rowByNum(readFileSync(appsFile, 'utf-8'), 200);
    expect(row).toContain('| 4.4/5 |');
    expect(row.endsWith('| 2026-05-20 |')).toBe(true);
  });

  it('rejects garbage in the posted TSV field (free text never lands in a date column)', () => {
    writeFileSync(appsFile, `${HEADER}\n`, 'utf-8');
    writeFileSync(
      join(additionsDir, '300-gamma.tsv'),
      '300\t2026-06-10\tGamma\tSolutions Architect\tEvaluated\t4.0/5\t❌\t[300](artifacts/reports/300-gamma-2026-06-10.md)\tevaluated\tlast tuesday\n',
      'utf-8',
    );
    runCli('cli/merge-tracker.mjs', {
      SUR9E_APPS_FILE: appsFile,
      SUR9E_ADDITIONS_DIR: additionsDir,
    });
    const row = rowByNum(readFileSync(appsFile, 'utf-8'), 300);
    expect(row.endsWith('| evaluated |  |')).toBe(true);
    expect(row).not.toContain('last tuesday');
  });
});

describe('normalize-statuses — posted column round-trip', () => {
  it('canonicalizes the status while preserving the posted cell', () => {
    writeFileSync(
      appsFile,
      `${HEADER}\n| 10 | 2026-06-01 | Acme | SE | **4.2/5** | **Applied** 2026-06-02 | ❌ | [10](artifacts/reports/010-acme-2026-06-01.md) | notes here | 2026-05-28 |\n| 11 | 2026-06-01 | Beta | AE | 3.9/5 | sent | ❌ | [11](artifacts/reports/011-beta-2026-06-01.md) | legacy 9-col |\n`,
      'utf-8',
    );
    runCli('cli/normalize-statuses.mjs', { SUR9E_APPS_FILE: appsFile });
    const out = readFileSync(appsFile, 'utf-8');
    const row10 = rowByNum(out, 10);
    expect(row10).toContain('| Applied |');
    expect(row10.endsWith('| 2026-05-28 |')).toBe(true);
    // Legacy 9-col row normalizes without growing a phantom column.
    expect(rowByNum(out, 11)).toBe(
      '| 11 | 2026-06-01 | Beta | AE | 3.9/5 | Applied | ❌ | [11](artifacts/reports/011-beta-2026-06-01.md) | legacy 9-col |',
    );
  });
});

describe('dedup-tracker — posted column round-trip', () => {
  it('keeps the keeper row’s posted cell through a status promotion rewrite', () => {
    // Same company+role; keeper (higher score) carries posted, the duplicate
    // carries the more advanced status that gets promoted onto the keeper.
    writeFileSync(
      appsFile,
      `${HEADER}\n| 20 | 2026-06-01 | Acme | Solutions Engineer Platform | 4.5/5 | Evaluated | ❌ | - | keeper | 2026-05-30 |\n| 21 | 2026-06-02 | Acme | Solutions Engineer Platform | 4.0/5 | Applied | ❌ | - | duplicate |\n`,
      'utf-8',
    );
    runCli('cli/dedup-tracker.mjs', { SUR9E_APPS_FILE: appsFile });
    const out = readFileSync(appsFile, 'utf-8');
    expect(rowByNum(out, 21)).toBeUndefined(); // duplicate removed
    const keeper = rowByNum(out, 20);
    expect(keeper).toContain('| Applied |'); // promoted status
    expect(keeper.endsWith('| 2026-05-30 |')).toBe(true); // posted preserved
  });
});
