#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * scan-jobspy.mjs — Node wrapper around batch/scan-jobspy.py
 *
 * Spawns the Python scraper inside the project venv, parses the JSON
 * output, applies a post-fetch title sieve, dedups against scan-history.tsv
 * + applications.md + pipeline.md, and appends survivors to data/pipeline.md.
 *
 * Search keywords come from inputs/personalization/profile.yml `search.terms`
 * (one JobSpy query per term, OR'd across the list). The same list also acts
 * as the post-fetch title sieve — a returned title must contain at least one
 * of the keywords (case-insensitive, punctuation-normalized) to survive.
 * This catches LinkedIn's fuzzy-reranker output that the quoted-phrase query
 * suppresses incompletely, especially at city-scope queries.
 *
 * Usage:
 *   node batch/scan-jobspy.mjs             # full scan + write
 *   node batch/scan-jobspy.mjs --dry-run   # python dry-run + no writes
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { buildTitleMatcher } from './lib/job-filter.mjs';
import { toIsoDate } from './lib/posted-date.mjs';

const ROOT = resolve(process.cwd());
const PROFILE_PATH = `${ROOT}/inputs/personalization/profile.yml`;
const CONFIG_PATH = `${ROOT}/inputs/config/config.yml`;
const SCAN_HISTORY_PATH = `${ROOT}/data/scan-history.tsv`;
const PIPELINE_PATH = `${ROOT}/data/pipeline.md`;
const APPLICATIONS_PATH = `${ROOT}/data/applications.md`;
const PYTHON = `${ROOT}/batch/jobspy-env/bin/python`;
const SCRIPT = `${ROOT}/batch/scan-jobspy.py`;

const DRY_RUN = process.argv.includes('--dry-run');

// ── Title sieve ─────────────────────────────────────────────────────
// Read search.terms from the profile and build a substring matcher that
// normalizes punctuation/whitespace so "Forward-Deployed Engineer" matches
// the bare "Forward Deployed Engineer" keyword. Empty term list = no sieve
// (every row passes).

const profile = existsSync(PROFILE_PATH)
  ? yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {}
  : {};
// Shared with scan-portals.mjs (batch/lib/job-filter.mjs) so the title sieve
// can't drift between the two scanners.
const titleMatches = buildTitleMatcher(profile);

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const m of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) seen.add(m[1]);
  }
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/https?:\/\/[^\s|)]+/g)) seen.add(m[0]);
  }
  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const c = m[1].trim().toLowerCase();
      const r = m[2].trim().toLowerCase();
      if (c && r && c !== 'company') seen.add(`${c}::${r}`);
    }
  }
  return seen;
}

// ── Pipeline / history writers ──────────────────────────────────────

// Scraped titles/companies can carry the characters that act as field/row
// delimiters downstream: `|` (pipeline.md fields, split by screen.mjs
// loadPending) and tab/newline (scan-history.tsv columns/rows) — mirroring
// the sanitization in scan-portals.mjs and pipeline-to-input.mjs.
const cleanField = s =>
  String(s || '')
    .replace(/[\t\n\r|]+/g, ' ')
    .trim();

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  mkdirSync(`${ROOT}/data`, { recursive: true });
  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : '# Pipeline Inbox\n\n## Pending\n\n## Processed\n';

  const marker = '## Pending';
  const idx = text.indexOf(marker);
  const insertAt =
    idx === -1
      ? text.length
      : text.indexOf('\n## ', idx + marker.length) === -1
        ? text.length
        : text.indexOf('\n## ', idx + marker.length);

  const block =
    '\n' +
    offers.map(o => `- [ ] ${o.url} | ${cleanField(o.company)} | ${cleanField(o.title)}`).join('\n') +
    '\n';

  if (idx === -1) {
    text += `\n## Pending\n${block}`;
  } else {
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  mkdirSync(`${ROOT}/data`, { recursive: true });
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(
      SCAN_HISTORY_PATH,
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlogo\tposted\n',
      'utf-8',
    );
  }
  const lines =
    offers
      .map(o => {
        const portal = `jobspy-${o.site || 'unknown'}`;
        const status = o.status || 'added';
        // `logo` and `posted` (true posting date from JobSpy's date_posted
        // column, empty when absent) are appended last so older 6/7-column
        // history files stay readable.
        return `${o.url}\t${date}\t${portal}\t${cleanField(o.title)}\t${cleanField(o.company)}\t${status}\t${o.company_logo || ''}\t${o.posted || ''}`;
      })
      .join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  // Source gate — scanning.sources.jobspy defaults ON; only an explicit
  // `false` disables JobSpy. Mirrors the ATS gate in scan-portals.mjs.
  const config = existsSync(CONFIG_PATH)
    ? yaml.load(readFileSync(CONFIG_PATH, 'utf-8')) || {}
    : {};
  if (config?.scanning?.sources?.jobspy === false) {
    console.log('JobSpy scan disabled in settings (scanning.sources.jobspy = false) — skipping.');
    return;
  }

  if (!existsSync(PYTHON)) {
    console.error(`ERROR: Python venv missing at ${PYTHON}`);
    console.error(
      `Run: python3 -m venv batch/jobspy-env && batch/jobspy-env/bin/pip install python-jobspy pyyaml`,
    );
    process.exit(1);
  }

  const args = [SCRIPT];
  if (DRY_RUN) args.push('--dry-run');

  console.log(`→ ${PYTHON} ${args.join(' ')}`);
  const res = spawnSync(PYTHON, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024, // 64MB for big result sets
  });

  if (res.status !== 0) {
    console.error(`Python script exited with code ${res.status}`);
    process.exit(res.status || 1);
  }

  let records;
  try {
    records = JSON.parse(res.stdout.toString('utf-8').trim());
  } catch (e) {
    console.error('Failed to parse Python JSON output:', e.message);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('(dry run)', records);
    return;
  }

  if (!Array.isArray(records) || records.length === 0) {
    console.log('\nJobSpy returned 0 records. Nothing to add.');
    return;
  }

  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const accepted = [];
  let filteredByTitle = 0;
  let dupByUrl = 0;
  let dupByCompanyRole = 0;

  for (const r of records) {
    if (!titleMatches(r.title)) {
      filteredByTitle++;
      continue;
    }
    if (seenUrls.has(r.url)) {
      dupByUrl++;
      continue;
    }
    const key = `${(r.company || '').toLowerCase()}::${(r.title || '').toLowerCase()}`;
    if (seenCompanyRoles.has(key)) {
      dupByCompanyRole++;
      continue;
    }
    // Normalize JobSpy's date_posted (YYYY-MM-DD string in the CSV/JSON) to
    // the canonical `posted` field; invalid/absent dates leave it undefined
    // so the scan-history cell stays empty.
    r.posted = toIsoDate(r.date_posted);
    accepted.push(r);
    seenUrls.add(r.url);
    seenCompanyRoles.add(key);
  }

  const date = new Date().toISOString().slice(0, 10);
  appendToPipeline(accepted);
  appendToScanHistory(accepted, date);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`JobSpy Scan — ${date}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Records fetched:    ${records.length}`);
  console.log(`Filtered by title:  ${filteredByTitle}`);
  console.log(`Duplicate (URL):    ${dupByUrl}`);
  console.log(`Duplicate (co/role):${dupByCompanyRole}`);
  console.log(`New offers added:   ${accepted.length}`);
  if (accepted.length > 0) {
    console.log('\nNew offers:');
    for (const o of accepted.slice(0, 20)) {
      console.log(`  + [${o.site}] ${o.company} | ${o.title} | ${o.location || ''}`);
    }
    if (accepted.length > 20) console.log(`  … and ${accepted.length - 20} more`);
  }
  console.log('\n→ Run /sur9e process-queue to screen new offers.');
}

main();
