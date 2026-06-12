#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * verify-pipeline.mjs — Health check for sur9e pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format X.XX/5 or N/A or DUP
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 *
 * Run: node sur9e/verify-pipeline.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bucketByUrl, resolveEntryUrl } from './lib/job-url.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(ROOT, 'data/applications.md'))
  ? join(ROOT, 'data/applications.md')
  : join(ROOT, 'applications.md');
const ADDITIONS_DIR = join(ROOT, 'batch/tracker-additions');
const REPORTS_DIR = join(ROOT, 'artifacts', 'reports');

// Ensure required directories exist (fresh setup)
mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(REPORTS_DIR, { recursive: true });

const CANONICAL_STATUSES = [
  'screened',
  'evaluated',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'discarded',
];

// `skip` was merged into Discarded in 2026-05 and retired as a canonical status
// in 2026-06. Legacy rows that still say skip / monitor / geo blocker validate
// via these aliases (→ discarded) rather than erroring.
const ALIASES = {
  hold: 'evaluated',
  sent: 'applied',
  applied: 'applied',
  monitor: 'discarded',
  'geo blocker': 'discarded',
  skip: 'discarded',
};

let errors = 0;
let warnings = 0;

function error(msg) {
  console.log(`❌ ${msg}`);
  errors++;
}
function warn(msg) {
  console.log(`⚠️  ${msg}`);
  warnings++;
}
function ok(msg) {
  console.log(`✅ ${msg}`);
}

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

const entries = [];
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) continue;
  const num = parseInt(parts[1]);
  if (isNaN(num)) continue;
  entries.push({
    num,
    date: parts[2],
    company: parts[3],
    role: parts[4],
    score: parts[5],
    status: parts[6],
    pdf: parts[7],
    report: parts[8],
    notes: parts[9] || '',
  });
}

console.log(`\n📊 Checking ${entries.length} entries in applications.md\n`);

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.includes(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`);
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`);
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`);
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates (URL-aware) ---
// Group by company+role, then split each group by the row's job URL (resolved
// from its linked report). Same company+role but different posting URLs = two
// distinct jobs, not a duplicate — only same-URL (or URL-unknown) rows warn.
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  const key =
    e.company.toLowerCase().replace(/[^a-z0-9]/g, '') +
    '::' +
    e.role.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
const urlCache = new Map();
for (const [, group] of companyRoleMap) {
  if (group.length < 2) continue;
  for (const e of group) e.url = resolveEntryUrl(ROOT, e.report, urlCache);
  for (const bucket of bucketByUrl(group)) {
    if (bucket.length < 2) continue;
    const shared = bucket[0].url ? ` — ${bucket[0].url}` : '';
    warn(
      `Possible duplicates: ${bucket.map(e => `#${e.num}`).join(', ')} (${bucket[0].company} — ${bucket[0].role}${shared})`,
    );
    dupes++;
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
let brokenReports = 0;
for (const e of entries) {
  const match = e.report.match(/\]\(([^)]+)\)/);
  if (!match) continue;
  const reportPath = join(ROOT, match[1]);
  if (!existsSync(reportPath)) {
    error(`#${e.num}: Report not found: ${match[1]}`);
    brokenReports++;
  }
}
if (brokenReports === 0) ok('All report links valid');

// --- Check 4: Score format ---
let badScores = 0;
for (const e of entries) {
  const s = e.score.replace(/\*\*/g, '').trim();
  if (!/^\d+\.?\d*\/5$/.test(s) && s !== 'N/A' && s !== 'DUP') {
    error(`#${e.num}: Invalid score format: "${e.score}"`);
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|');
  // Skip the header and separator rows by their first cell — substring checks
  // would also skip real rows mentioning "Company" or containing "---".
  const first = (parts[1] || '').trim();
  if (first === '#' || /^-+$/.test(first)) continue;
  if (parts.length < 9) {
    error(`Row with <9 columns: ${line.substring(0, 80)}...`);
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`);
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`);
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Summary ---
console.log('\n' + '='.repeat(50));
console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 Pipeline is clean!');
} else if (errors === 0) {
  console.log('🟡 Pipeline OK with warnings');
} else {
  console.log('🔴 Pipeline has errors — fix before proceeding');
}

process.exit(errors > 0 ? 1 : 0);
