#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * lint-reports.mjs — Contract check over report-markdown fixtures.
 *
 * Runs the server-side report-markdown validators (checkReportMarkdown) over
 * every `test/fixtures/reports/*.md`, prints issues grouped by file, and exits
 * 1 on contract violations. `warn`-severity issues print but do not fail.
 *
 * Two fixture conventions:
 *  - `dirty-*.md` are NEGATIVE fixtures: a known-bad input the normalizer is
 *    meant to heal. They MUST produce at least one `error`-severity issue (if a
 *    dirty fixture comes back clean, our validators have regressed — that fails).
 *  - every other `*.md` is a POSITIVE (golden) fixture: it MUST be clean of
 *    `error`-severity issues.
 *
 * This keeps the gate green while still exercising the failure path: the linter
 * demonstrably catches the #19 defects in `dirty-019.md`.
 *
 * Fixtures-only by design: this scans `test/fixtures/reports/` and never touches
 * `data/` or `artifacts/` (user files). It is the CI representation of the same
 * contract the normalizer enforces at the four runtime call sites.
 *
 * The validators live in TypeScript (`src/lib/server/report-markdown`) behind a
 * `@/` path alias, so we delegate the actual check to a `tsx` subprocess that
 * imports the module and emits issues as JSON.
 *
 * Run: node cli/lint-reports.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'test/fixtures/reports');
const TSX = join(ROOT, 'node_modules/.bin/tsx');

if (!existsSync(FIXTURE_DIR)) {
  console.log('lint-reports: no fixture directory (test/fixtures/reports) — nothing to check');
  process.exit(0);
}

const files = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.md'))
  .sort();

if (files.length === 0) {
  console.log('lint-reports: no *.md fixtures found — nothing to check');
  process.exit(0);
}

if (!existsSync(TSX)) {
  console.error('lint-reports: tsx not installed (run `npm install`) — cannot run the check');
  process.exit(1);
}

// A tiny TS worker that reads each fixture, runs checkReportMarkdown, and prints
// one JSON object: { [relativePath]: Issue[] }. Kept inline so there is no extra
// file to maintain. The `@/` alias resolves through the repo tsconfig.
const worker = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkReportMarkdown } from '@/lib/server/report-markdown';

const dir = ${JSON.stringify(FIXTURE_DIR)};
const files = ${JSON.stringify(files)};
const out = {};
for (const f of files) {
  const md = readFileSync(join(dir, f), 'utf8');
  out[f] = checkReportMarkdown(md);
}
process.stdout.write(JSON.stringify(out));
`;

let report;
try {
  const raw = execFileSync(TSX, ['--eval', worker], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  report = JSON.parse(raw);
} catch (e) {
  console.error('lint-reports: failed to run the validators');
  if (e.stdout) process.stderr.write(String(e.stdout));
  if (e.stderr) process.stderr.write(String(e.stderr));
  process.exit(1);
}

const isNegative = file => /^dirty-/.test(file);

let failures = 0;
let totalWarns = 0;

for (const file of files) {
  const issues = report[file] ?? [];
  const errors = issues.filter(i => i.severity === 'error');
  const warns = issues.filter(i => i.severity === 'warn');
  totalWarns += warns.length;

  if (isNegative(file)) {
    // Negative fixture: must trip at least one error.
    if (errors.length > 0) {
      console.log(`  ✅ ${file} — negative fixture caught (${errors.length} error)`);
    } else {
      console.log(`  ❌ ${file} — negative fixture produced NO errors (validators regressed)`);
      failures++;
    }
  } else if (errors.length === 0) {
    console.log(`  ✅ ${file} — clean`);
  } else {
    console.log(`  ❌ ${file}`);
    failures++;
  }

  // Always print the individual issues for visibility.
  for (const issue of issues) {
    const tag = issue.severity === 'error' ? '❌ error' : '⚠️  warn';
    const where = issue.line ? ` (line ${issue.line})` : '';
    console.log(`     ${tag} [${issue.rule}]${where}: ${issue.message}`);
  }
}

console.log('');
console.log(
  `lint-reports: ${files.length} fixture${files.length === 1 ? '' : 's'} checked — ` +
    `${failures} failure${failures === 1 ? '' : 's'}, ${totalWarns} warn${totalWarns === 1 ? '' : 's'}`,
);

process.exit(failures > 0 ? 1 : 0);
