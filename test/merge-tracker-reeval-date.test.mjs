import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const TODAY = '2026-08-13'; // the "eval run date" the addition carries
const ORIGINAL = '2026-08-01'; // the date the row was first added/scanned

const trackerHeader = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |',
  '|---|---|---|---|---|---|---|---|---|---|',
];

/** The Date cell of the `| <num> |` row in a written tracker file. */
function dateCellFor(trackerText, num) {
  const line = trackerText.split('\n').find(l => l.trim().startsWith(`| ${num} |`));
  if (!line) throw new Error(`row #${num} not found in:\n${trackerText}`);
  return line.split('|')[2].trim();
}

/** Run merge-tracker against temp fixtures with one existing row + one addition. */
function runMerge({ existingRow, additionTsv, extraArgs = [] }) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'sur9e-reeval-'));
  try {
    const appsPath = join(dataRoot, 'applications.md');
    const additionsDir = join(dataRoot, 'additions');
    mkdirSync(join(additionsDir, 'merged'), { recursive: true });
    writeFileSync(appsPath, `${[...trackerHeader, existingRow, ''].join('\n')}`);
    writeFileSync(join(additionsDir, 'offer.tsv'), additionTsv);

    const run = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'cli/merge-tracker.mjs'), ...extraArgs],
      {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        env: { ...process.env, SUR9E_APPS_FILE: appsPath, SUR9E_ADDITIONS_DIR: additionsDir },
      },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    return readFileSync(appsPath, 'utf-8');
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

describe('merge-tracker preserves the original Added date on re-eval', () => {
  it('keeps the existing date when a targeted --re-eval overwrites the row', () => {
    const existingRow = `| 2571 | ${ORIGINAL} | BJAK | Backend Engineer | 3.5/5 | Evaluated | ❌ | [2571](2571-bjak.md) | original | |`;
    // Re-eval TSV: num, date(today), company, role, status, score, pdf, report, notes, posted
    const additionTsv = `2571\t${TODAY}\tBJAK\tBackend Engineer\tEvaluated\t3.5/5\t❌\t[2571](2571-bjak.md)\trerun\t`;

    const out = runMerge({ existingRow, additionTsv, extraArgs: ['--re-eval=2571'] });

    expect(dateCellFor(out, 2571)).toBe(ORIGINAL);
  });

  it('keeps the existing date when a higher-score re-eval updates the row', () => {
    const existingRow = `| 2571 | ${ORIGINAL} | BJAK | Backend Engineer | 3.5/5 | Evaluated | ❌ | [2571](2571-bjak.md) | original | |`;
    // No --re-eval; a higher score (4.5 > 3.5) takes the in-place update branch.
    const additionTsv = `2571\t${TODAY}\tBJAK\tBackend Engineer\tEvaluated\t4.5/5\t❌\t[2571](2571-bjak.md)\trerun\t`;

    const out = runMerge({ existingRow, additionTsv });

    expect(dateCellFor(out, 2571)).toBe(ORIGINAL);
  });
});
