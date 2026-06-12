#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// cli/num-by-url.mjs
//
// Resolve a tracker num from a job-posting URL by scanning the frontmatter of
// artifacts/reports/*.md — the tracker table itself doesn't store URLs, the
// report frontmatter does (url: optional in src/lib/schemas/reports.ts).
// Prints the num to stdout; exits 1 with a stderr message when nothing
// matches. Used by the screen-evaluate job chain to find the row screen.mjs
// just created.
//
// Usage: node cli/num-by-url.mjs <job-posting-url>

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReportFile } from '../batch/lib/report-file.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Canonicalize for comparison: new URL().href normalizes host case, default
// ports, and percent-encoding, so trivially-different spellings still match.
function canon(url) {
  try {
    return new URL(String(url)).href;
  } catch {
    return null;
  }
}

/**
 * Pure resolver over parsed reports ([{ frontmatter }]). Returns the highest
 * matching num (a re-screened URL resolves to the newest row), or null.
 */
export function resolveNumByUrl(reports, url) {
  const target = canon(url);
  if (!target) return null;
  let best = null;
  for (const r of reports) {
    const fm = r?.frontmatter;
    if (!fm || typeof fm !== 'object') continue;
    if (canon(fm.url) !== target) continue;
    const num = Number(fm.num);
    if (!Number.isInteger(num)) continue;
    if (best == null || num > best) best = num;
  }
  return best;
}

function loadReports(reportsDir) {
  let files = [];
  try {
    files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(parseReportFile(readFileSync(join(reportsDir, f), 'utf-8')));
    } catch {
      // Legacy/non-frontmatter report files are skipped, not fatal.
    }
  }
  return out;
}

function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node cli/num-by-url.mjs <job-posting-url>');
    process.exit(1);
  }
  const num = resolveNumByUrl(loadReports(join(ROOT, 'artifacts/reports')), url);
  if (num == null) {
    console.error(`num-by-url: no report found for URL: ${url}`);
    process.exit(1);
  }
  console.log(String(num));
}

// import.meta-main guard so importing this module (vitest) doesn't run main —
// same pattern as batch/screen.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
