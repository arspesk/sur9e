#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * normalize-statuses.mjs — Clean non-canonical states in applications.md
 *
 * Maps all non-canonical statuses to canonical ones per states.yml:
 *   Screened, Evaluated, Applied, Responded, Interview, Offer, Rejected, Discarded
 * (SKIP was merged into Discarded in 2026-05.)
 *
 * Also strips markdown bold (**) and dates from the status field,
 * moving DUPLICADO info to the notes column.
 *
 * Run: node sur9e/normalize-statuses.mjs [--dry-run]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

// Canonical status mapping
function normalizeStatus(raw) {
  // Strip markdown bold
  const s = raw.replace(/\*\*/g, '').trim();

  // Strip a trailing date ("Applied 2026-05-01") — dates belong in the date
  // column (mirrors merge-tracker's validateStatus). Re-normalize the bare
  // status and preserve the original cell text in the notes column.
  const dateIdx = s.search(/\s+\d{4}-\d{2}-\d{2}/);
  if (dateIdx !== -1) {
    const result = normalizeStatus(s.slice(0, dateIdx).trim());
    if (result.unknown) return result;
    // s contains the bare status plus the date (and any DUP/Repost detail),
    // so it supersedes whatever the recursive call wanted to move to notes.
    return { status: result.status, moveToNotes: s };
  }

  const lower = s.toLowerCase();

  // DUP shorthand → Discarded
  if (/^dup\b/i.test(s)) {
    return { status: 'Discarded', moveToNotes: raw.trim() };
  }

  // HOLD → Evaluated (kept; English idiom for "decision deferred")
  if (/^hold$/i.test(s)) return { status: 'Evaluated' };

  // MONITOR → Discarded (was SKIP; merged in 2026-05)
  if (/^monitor$/i.test(s)) return { status: 'Discarded' };

  // GEO BLOCKER → Discarded (was SKIP; merged in 2026-05)
  if (/geo.?blocker/i.test(s)) return { status: 'Discarded' };

  // Repost #NNN → Discarded
  if (/^repost/i.test(s)) return { status: 'Discarded', moveToNotes: raw.trim() };

  // "—" (em dash, no status) → Discarded
  if (s === '—' || s === '-' || s === '') return { status: 'Discarded' };

  // Already canonical (English, per states.yml) — just fix casing/bold
  const canonical = [
    'Screened',
    'Evaluated',
    'Applied',
    'Responded',
    'Interview',
    'Offer',
    'Rejected',
    'Discarded',
  ];
  for (const c of canonical) {
    if (lower === c.toLowerCase()) return { status: c };
  }

  // English shorthand aliases
  if (['sent', 'applied'].includes(lower)) return { status: 'Applied' };
  // Legacy SKIP → Discarded
  if (lower === 'skip') return { status: 'Discarded' };

  // Unknown — flag it
  return { status: null, unknown: true };
}

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to normalize.');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

let changes = 0;
const unknowns = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.startsWith('|')) continue;

  const parts = line.split('|').map(s => s.trim());
  // Format: ['', '#', 'date', 'company', 'role', 'score', 'STATUS', 'pdf', 'report', 'notes', '']
  if (parts.length < 9) continue;
  if (parts[1] === '#' || parts[1] === '---' || parts[1] === '') continue;

  const num = parseInt(parts[1]);
  if (isNaN(num)) continue;

  const rawStatus = parts[6];
  const result = normalizeStatus(rawStatus);

  if (result.unknown) {
    unknowns.push({ num, rawStatus, line: i + 1 });
    continue;
  }

  if (result.status === rawStatus) continue; // Already canonical

  // Apply change
  const oldStatus = rawStatus;
  parts[6] = result.status;

  // Move DUPLICADO info to notes if needed
  if (result.moveToNotes && parts[9]) {
    const existing = parts[9] || '';
    if (!existing.includes(result.moveToNotes)) {
      parts[9] = result.moveToNotes + (existing ? '. ' + existing : '');
    }
  } else if (result.moveToNotes && !parts[9]) {
    parts[9] = result.moveToNotes;
  }

  // Also strip bold from score field
  if (parts[5]) {
    parts[5] = parts[5].replace(/\*\*/g, '');
  }

  // Reconstruct line
  const newLine = '| ' + parts.slice(1, -1).join(' | ') + ' |';
  lines[i] = newLine;
  changes++;

  console.log(`#${num}: "${oldStatus}" → "${result.status}"`);
}

if (unknowns.length > 0) {
  console.log(`\n⚠️  ${unknowns.length} unknown statuses:`);
  for (const u of unknowns) {
    console.log(`  #${u.num} (line ${u.line}): "${u.rawStatus}"`);
  }
}

console.log(`\n📊 ${changes} statuses normalized`);

if (!DRY_RUN && changes > 0) {
  // Backup first
  copyFileSync(APPS_FILE, APPS_FILE + '.bak');
  writeFileSync(APPS_FILE, lines.join('\n'));
  console.log('✅ Written to applications.md (backup: applications.md.bak)');
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No changes needed');
}
