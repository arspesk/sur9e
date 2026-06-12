#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * dedup-tracker.mjs — Remove duplicate entries from applications.md
 *
 * Groups by normalized company + fuzzy role match.
 * Keeps entry with highest score. If discarded entry had more advanced status,
 * preserves that status. Merges notes.
 *
 * Run: node sur9e/dedup-tracker.mjs [--dry-run]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bucketByUrl, resolveEntryUrl } from './lib/job-url.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). SUR9E_APPS_FILE overrides the path so round-trip tests can run
// this script against tmp fixtures without touching real user data.
const APPS_FILE =
  process.env.SUR9E_APPS_FILE ||
  (existsSync(join(ROOT, 'data/applications.md'))
    ? join(ROOT, 'data/applications.md')
    : join(ROOT, 'applications.md'));
const DRY_RUN = process.argv.includes('--dry-run');

// Ensure required directories exist (fresh setup)
mkdirSync(join(ROOT, 'data'), { recursive: true });

// Status advancement order (higher = more advanced in pipeline)
// Applied > Rejected because active application > terminal state
const STATUS_RANK = {
  // English canonicals (states.yml labels)
  skip: 0,
  discarded: 0,
  rejected: 1,
  evaluated: 2,
  applied: 3,
  responded: 4,
  interview: 5,
  offer: 6,
};

function normalizeCompany(name) {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function normalizeRole(role) {
  return role
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 /]/g, '')
    .trim();
}

const ROLE_STOPWORDS = new Set([
  'senior',
  'junior',
  'lead',
  'staff',
  'principal',
  'head',
  'chief',
  'manager',
  'director',
  'associate',
  'intern',
  'contractor',
  'remote',
  'hybrid',
  'onsite',
  'engineer',
  'engineering',
]);

const LOCATION_STOPWORDS = new Set([
  'tokyo',
  'japan',
  'london',
  'berlin',
  'paris',
  'singapore',
  'york',
  'francisco',
  'angeles',
  'seattle',
  'austin',
  'boston',
  'chicago',
  'denver',
  'toronto',
  'amsterdam',
  'dublin',
  'sydney',
  'remote',
  'global',
  'emea',
  'apac',
  'latam',
]);

function roleMatch(a, b) {
  const filterStopwords = words =>
    words.filter(w => !ROLE_STOPWORDS.has(w) && !LOCATION_STOPWORDS.has(w));

  const wordsA = filterStopwords(
    normalizeRole(a)
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
  const wordsB = filterStopwords(
    normalizeRole(b)
      .split(/\s+/)
      .filter(w => w.length > 2),
  );

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const overlap = wordsA.filter(w => wordsB.some(wb => wb === w));
  const smaller = Math.min(wordsA.length, wordsB.length);
  const ratio = overlap.length / smaller;

  return overlap.length >= 2 && ratio >= 0.6;
}

function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) return null;
  const num = parseInt(parts[1]);
  if (isNaN(num)) return null;
  return {
    num,
    date: parts[2],
    company: parts[3],
    role: parts[4],
    score: parts[5],
    status: parts[6],
    pdf: parts[7],
    report: parts[8],
    notes: parts[9] || '',
    raw: line,
  };
}

// Read
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to dedup.');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

// Parse all entries
const entries = [];
const entryLineMap = new Map(); // num → line index

for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('|')) continue;
  const app = parseAppLine(lines[i]);
  if (app && app.num > 0) {
    entries.push(app);
    entryLineMap.set(app.num, i);
  }
}

console.log(`📊 ${entries.length} entries loaded`);

// Group by company+role
const groups = new Map();
for (const entry of entries) {
  const key = normalizeCompany(entry.company);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

// Find duplicates
let removed = 0;
const linesToRemove = new Set();
const urlCache = new Map();

for (const [, companyEntries] of groups) {
  if (companyEntries.length < 2) continue;

  // Within same company, find role matches
  const processed = new Set();
  for (let i = 0; i < companyEntries.length; i++) {
    if (processed.has(i)) continue;
    const cluster = [companyEntries[i]];
    processed.add(i);

    for (let j = i + 1; j < companyEntries.length; j++) {
      if (processed.has(j)) continue;
      if (roleMatch(companyEntries[i].role, companyEntries[j].role)) {
        cluster.push(companyEntries[j]);
        processed.add(j);
      }
    }

    if (cluster.length < 2) continue;

    // URL-aware: a company+role cluster can still hold *distinct* postings
    // (same title, different job URLs). Split by the row's posting URL so only
    // same-URL (or URL-unknown) rows are merged — different known URLs stay.
    for (const e of cluster) e.url = resolveEntryUrl(ROOT, e.report, urlCache);

    for (const bucket of bucketByUrl(cluster)) {
      if (bucket.length < 2) continue;

      // Keep the one with highest score
      bucket.sort((a, b) => parseScore(b.score) - parseScore(a.score));
      const keeper = bucket[0];

      // Check if any removed entry has more advanced status
      let bestStatusRank = STATUS_RANK[keeper.status.toLowerCase()] || 0;
      let bestStatus = keeper.status;
      for (let k = 1; k < bucket.length; k++) {
        const rank = STATUS_RANK[bucket[k].status.toLowerCase()] || 0;
        if (rank > bestStatusRank) {
          bestStatusRank = rank;
          bestStatus = bucket[k].status;
        }
      }

      // Update keeper's status if a removed entry had a more advanced one
      if (bestStatus !== keeper.status) {
        const lineIdx = entryLineMap.get(keeper.num);
        if (lineIdx !== undefined) {
          const parts = lines[lineIdx].split('|').map(s => s.trim());
          parts[6] = bestStatus;
          lines[lineIdx] = '| ' + parts.slice(1, -1).join(' | ') + ' |';
          console.log(
            `  📝 #${keeper.num}: status promoted to "${bestStatus}" (from #${bucket.find(e => e.status === bestStatus)?.num})`,
          );
        }
      }

      // Remove duplicates
      for (let k = 1; k < bucket.length; k++) {
        const dup = bucket[k];
        const lineIdx = entryLineMap.get(dup.num);
        if (lineIdx !== undefined) {
          linesToRemove.add(lineIdx);
          removed++;
          console.log(
            `🗑️  Remove #${dup.num} (${dup.company} — ${dup.role}, ${dup.score}) → kept #${keeper.num} (${keeper.score})`,
          );
        }
      }
    }
  }
}

// Remove lines (in reverse order to preserve indices)
const sortedRemoveIndices = [...linesToRemove].sort((a, b) => b - a);
for (const idx of sortedRemoveIndices) {
  lines.splice(idx, 1);
}

console.log(`\n📊 ${removed} duplicates removed`);

if (!DRY_RUN && removed > 0) {
  copyFileSync(APPS_FILE, APPS_FILE + '.bak');
  writeFileSync(APPS_FILE, lines.join('\n'));
  console.log('✅ Written to applications.md (backup: applications.md.bak)');
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No duplicates found');
}
