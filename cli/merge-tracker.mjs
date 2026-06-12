#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 10-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\tposted
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 * `posted` (true posting date, YYYY-MM-DD) is optional; rows written by this
 * script always carry the trailing Posted cell (empty when unknown).
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node sur9e/merge-tracker.mjs [--dry-run] [--verify]
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isValidIsoDate } from '../batch/lib/posted-date.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). Prefer data/ — it's the canonical tracker file every other
// reader/writer (web app, verify, normalize, dedup) operates on; fall back to
// a root applications.md only when data/ doesn't have one yet.
// SUR9E_APPS_FILE / SUR9E_ADDITIONS_DIR override the paths so round-trip tests
// can run this script against tmp fixtures without touching real user data.
const APPS_FILE =
  process.env.SUR9E_APPS_FILE ||
  (!existsSync(join(ROOT, 'data/applications.md')) && existsSync(join(ROOT, 'applications.md'))
    ? join(ROOT, 'applications.md')
    : join(ROOT, 'data/applications.md'));
const ADDITIONS_DIR = process.env.SUR9E_ADDITIONS_DIR || join(ROOT, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
// --force: still overwrite when new score > existing, but also ALWAYS add new
// rows when the existing score >= new score (instead of skipping). Used by
// the web "Add new offer" flow so a user-added URL always lands in the tracker.
const FORCE = process.argv.includes('--force');
// --re-eval=N: targeted re-evaluation of an existing tracker entry. When the
// addition matches num=N (whether by num or by company+role), ALWAYS update
// that row in-place — no score gating, no duplicate row. Used by the web
// "Run evaluation" flow so a re-eval overwrites instead of appending.
const REEVAL_NUM = (() => {
  const arg = process.argv.find(a => a.startsWith('--re-eval='));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isInteger(n) ? n : null;
})();

// Ensure required directories exist (fresh setup)
mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(ADDITIONS_DIR, { recursive: true });

// Canonical states and aliases. SKIP was merged into Discarded in 2026-05.
const CANONICAL_STATES = [
  'Screened',
  'Evaluated',
  'Applied',
  'Responded',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
];

// Score threshold (0-5). Screen pass results scoring below this auto-flip to
// Discarded so they're hidden from the active funnel. 0 = disabled. Read once
// per merge-tracker run from inputs/config/config.yml advanced.score_threshold.
const SCORE_THRESHOLD = (() => {
  try {
    const cfgPath = join(ROOT, 'inputs/config/config.yml');
    if (!existsSync(cfgPath)) return 0;
    const cfg = yaml.load(readFileSync(cfgPath, 'utf-8')) || {};
    const v = cfg.advanced?.score_threshold;
    return Number.isFinite(v) ? Number(v) : 0;
  } catch {
    return 0;
  }
})();

function parseScoreFloat(scoreCol) {
  if (!scoreCol) return null;
  const m = String(scoreCol).match(/(\d+\.?\d*)\s*\/\s*5/);
  return m ? parseFloat(m[1]) : null;
}

function validateStatus(status) {
  const clean = status
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases (legacy SKIP terms collapse to Discarded)
  const aliases = {
    hold: 'Evaluated',
    sent: 'Applied',
    applied: 'Applied',
    skip: 'Discarded',
    monitor: 'Discarded',
    'geo blocker': 'Discarded',
  };

  if (aliases[lower]) return aliases[lower];

  // DUP/Repost → Discarded
  if (/^(dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

// Statuses that precede an actual application. Only rows sitting at this
// depth may have their status overwritten by a re-eval/re-screen addition
// (including the deliberate Discarded→Evaluated rescue flip). Anything past
// application (Applied, Responded, Interview, Offer, Rejected) is user-owned
// lifecycle state — evaluation TSVs always say "Evaluated", and silently
// resetting an Interview row to Evaluated destroys that state.
const PRE_APPLICATION_STATES = new Set(['screened', 'evaluated', 'discarded']);

/**
 * Funnel-aware status resolution for duplicate-row updates: the addition's
 * status only wins while the existing row is still pre-application; once the
 * user has applied (or further), the row keeps its current status. Score,
 * report path, PDF, and date still update either way.
 */
function resolveStatus(additionStatus, currentStatus) {
  if (!additionStatus) return currentStatus;
  const cleanCurrent = String(currentStatus || '')
    .replace(/\*\*/g, '')
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '')
    .trim()
    .toLowerCase();
  if (!cleanCurrent || PRE_APPLICATION_STATES.has(cleanCurrent)) return additionStatus;
  return currentStatus;
}

function normalizeCompany(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roleFuzzyMatch(a, b) {
  const wordsA = a
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
  const wordsB = b
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
  const overlap = wordsA.filter(w => wordsB.some(wb => wb.includes(w) || w.includes(wb)));
  return overlap.length >= 2;
}

function extractReportNum(reportStr) {
  const m = reportStr.match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) return null;
  const num = parseInt(parts[1]);
  if (isNaN(num) || num === 0) return null;
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
    // Optional trailing `Posted` column (true posting date). Legacy 9-column
    // rows have none; non-date garbage is treated as absent.
    posted: isValidIsoDate((parts[10] || '').trim()) ? parts[10].trim() : '',
    raw: line,
  };
}

// Serialize one tracker row. Always emits the trailing `Posted` cell (empty
// when unknown) so rows this script writes are uniformly 10-column; legacy
// rows it never touches stay 9-column and keep parsing fine.
function formatAppRow({ num, date, company, role, score, status, pdf, report, notes, posted }) {
  return `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ${pdf} | ${report} | ${notes} | ${posted || ''} |`;
}

/**
 * Parse a TSV file content into a structured addition object.
 * Handles: 9-col TSV, 8-col TSV, pipe-delimited markdown.
 */
function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    // Strip only the empties created by the leading/trailing pipes so an
    // empty interior cell keeps its position instead of shifting every
    // column after it (which would put the status in the score slot etc.).
    parts = content.split('|').map(s => s.trim());
    if (parts[0] === '') parts.shift();
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes | posted?
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      score: parts[4],
      status: validateStatus(parts[5]),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
      posted: parts[9] || '',
    };
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Detect column order: some TSVs have (status, score), others have (score, status)
    // Heuristic: if col4 looks like a score and col5 looks like a status, they're swapped
    const col4 = parts[4].trim();
    const col5 = parts[5].trim();
    const col4LooksLikeScore = /^\d+\.?\d*\/5$/.test(col4) || col4 === 'N/A' || col4 === 'DUP';
    const col5LooksLikeScore = /^\d+\.?\d*\/5$/.test(col5) || col5 === 'N/A' || col5 === 'DUP';
    const STATUS_RE =
      /^(screened|evaluated|applied|responded|interview|offer|rejected|discarded|skip|hold|monitor|sent|repost)/i;
    const col4LooksLikeStatus = STATUS_RE.test(col4);
    const col5LooksLikeStatus = STATUS_RE.test(col5);

    let statusCol, scoreCol;
    if (col4LooksLikeStatus && !col4LooksLikeScore) {
      // Standard format: col4=status, col5=score
      statusCol = col4;
      scoreCol = col5;
    } else if (col4LooksLikeScore && col5LooksLikeStatus) {
      // Swapped format: col4=score, col5=status
      statusCol = col5;
      scoreCol = col4;
    } else if (col5LooksLikeScore && !col4LooksLikeScore) {
      // col5 is definitely score → col4 must be status
      statusCol = col4;
      scoreCol = col5;
    } else {
      // Default: standard format (status before score)
      statusCol = col4;
      scoreCol = col5;
    }

    let resolvedStatus = validateStatus(statusCol);
    // Score threshold gate (advanced.score_threshold in config.yml).
    // Screened additions whose score is below the threshold are auto-flipped
    // to Discarded so the active funnel only shows offers worth pursuing.
    if (SCORE_THRESHOLD > 0 && resolvedStatus === 'Screened') {
      const s = parseScoreFloat(scoreCol);
      if (s != null && s < SCORE_THRESHOLD) {
        resolvedStatus = 'Discarded';
      }
    }
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      status: resolvedStatus,
      score: scoreCol,
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
      // Optional 10th TSV field: true posting date (empty when unknown).
      posted: parts[9] || '',
    };
  }

  // Guarantee a well-formed 9-column row. applications.md is a pipe-delimited
  // table, so a stray "|" (or tab/newline) in any cell — which a flaky screener
  // TSV can easily contain — would inject extra columns and corrupt the table
  // (verify-pipeline then fails the whole gate). Strip those characters from
  // every cell so the serialized row always has exactly 9 columns.
  const cleanCell = v =>
    String(v ?? '')
      .replace(/[|\t\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  addition.date = cleanCell(addition.date);
  addition.company = cleanCell(addition.company);
  addition.role = cleanCell(addition.role);
  addition.score = cleanCell(addition.score);
  addition.status = cleanCell(addition.status);
  addition.pdf = cleanCell(addition.pdf);
  addition.report = cleanCell(addition.report);
  addition.notes = cleanCell(addition.notes);
  // Posted must be a real YYYY-MM-DD calendar date or nothing at all —
  // never free text in a date column.
  addition.posted = isValidIsoDate(cleanCell(addition.posted)) ? cleanCell(addition.posted) : '';

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  return addition;
}

// ---- Main ----

// Read applications.md — bootstrap with canonical header on fresh setup so the
// first screening from a clean slate lands in the tracker instead of orphaning
// its row in batch/tracker-additions/. Dry-run must never write, so it uses
// the header in memory instead.
const BOOTSTRAP_CONTENT =
  '# Applications Tracker\n\n| #   | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |\n| --- | ---- | ------- | ---- | ----- | ------ | --- | ------ | ----- | ------ |\n';
if (!existsSync(APPS_FILE) && !DRY_RUN) {
  mkdirSync(dirname(APPS_FILE), { recursive: true });
  writeFileSync(APPS_FILE, BOOTSTRAP_CONTENT, 'utf-8');
  console.log(`Created ${APPS_FILE} (bootstrap)`);
}
const appContent = existsSync(APPS_FILE) ? readFileSync(APPS_FILE, 'utf-8') : BOOTSTRAP_CONTENT;
const appLines = appContent.split('\n');
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  // parseAppLine rejects the header and separator rows itself (parseInt('#')
  // and parseInt('---') are NaN) — no substring filtering, which would also
  // drop real rows mentioning "Company" (e.g. "Ford Motor Company").
  if (line.startsWith('|')) {
    const app = parseAppLine(line);
    if (app) {
      existingApps.push(app);
      if (app.num > maxNum) maxNum = app.num;
    }
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(a.replace(/\D/g, '')) || 0;
  const numB = parseInt(b.replace(/\D/g, '')) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) {
    skipped++;
    continue;
  }

  // Check for duplicate by:
  // 1. Exact report number match
  // 2. Company + role fuzzy match
  const reportNum = extractReportNum(addition.report);
  let duplicate = null;

  if (reportNum) {
    // Check if this report number already exists
    duplicate = existingApps.find(app => {
      const existingReportNum = extractReportNum(app.report);
      return existingReportNum === reportNum;
    });
  }

  if (!duplicate) {
    // Exact entry number match
    duplicate = existingApps.find(app => app.num === addition.num);
  }

  if (!duplicate) {
    // Company + role fuzzy match
    const normCompany = normalizeCompany(addition.company);
    duplicate = existingApps.find(app => {
      if (normalizeCompany(app.company) !== normCompany) return false;
      return roleFuzzyMatch(addition.role, app.role);
    });
  }

  if (duplicate) {
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    // Targeted re-evaluation: caller knows this is an explicit re-eval of
    // duplicate.num — always update, regardless of whether the new score is
    // higher or lower. The eval flow uses this to overwrite instead of
    // creating duplicate rows when the new score happens to be lower.
    if (REEVAL_NUM !== null && duplicate.num === REEVAL_NUM) {
      console.log(
        `🔁 Re-eval: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`,
      );
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        const note =
          oldScore === newScore
            ? `Re-eval ${addition.date}. ${addition.notes}`
            : `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`;
        const updatedLine = formatAppRow({
          ...addition,
          num: duplicate.num,
          status: resolveStatus(addition.status, duplicate.status),
          pdf: addition.pdf || duplicate.pdf,
          notes: note,
          posted: addition.posted || duplicate.posted,
        });
        appLines[lineIdx] = updatedLine;
        updated++;
      } else {
        // Row was added earlier in this same batch — update it in newLines.
        const newIdx = newLines.indexOf(duplicate.raw);
        if (newIdx >= 0) {
          const note =
            oldScore === newScore
              ? `Re-eval ${addition.date}. ${addition.notes}`
              : `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`;
          newLines[newIdx] = formatAppRow({
            ...addition,
            num: duplicate.num,
            status: resolveStatus(addition.status, duplicate.status),
            pdf: addition.pdf || duplicate.pdf,
            notes: note,
            posted: addition.posted || duplicate.posted,
          });
          updated++;
        }
      }
    } else if (newScore > oldScore) {
      console.log(
        `🔄 Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`,
      );
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        // Prefer the new TSV's status for pre-application rows so re-screens
        // can flip a row out of Discarded (the score-threshold gate above has
        // already adjusted addition.status if the new score falls below the
        // threshold). Post-application rows keep their lifecycle status.
        const updatedLine = formatAppRow({
          ...addition,
          num: duplicate.num,
          status: resolveStatus(addition.status, duplicate.status),
          pdf: duplicate.pdf,
          notes: `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`,
          posted: addition.posted || duplicate.posted,
        });
        appLines[lineIdx] = updatedLine;
        updated++;
      } else {
        // Row was added earlier in this same batch — update it in newLines.
        const newIdx = newLines.indexOf(duplicate.raw);
        if (newIdx >= 0) {
          newLines[newIdx] = formatAppRow({
            ...addition,
            num: duplicate.num,
            status: resolveStatus(addition.status, duplicate.status),
            pdf: duplicate.pdf,
            notes: `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`,
            posted: addition.posted || duplicate.posted,
          });
          updated++;
        }
      }
    } else if (FORCE) {
      // Force-add as a new row (the duplicate stays untouched).
      console.log(
        `➕ Force-add (existing #${duplicate.num} ${oldScore}, new ${newScore}): ${addition.company} — ${addition.role}`,
      );
      const entryNum = addition.num > maxNum ? addition.num : ++maxNum;
      if (addition.num > maxNum) maxNum = addition.num;
      const newLine = formatAppRow({ ...addition, num: entryNum });
      newLines.push(newLine);
      const parsedNew = parseAppLine(newLine);
      if (parsedNew) existingApps.push(parsedNew);
      added++;
    } else {
      console.log(
        `⏭️  Skip: ${addition.company} — ${addition.role} (existing #${duplicate.num} ${oldScore} >= new ${newScore})`,
      );
      skipped++;
    }
  } else {
    // New entry — use the number from the TSV
    const entryNum = addition.num > maxNum ? addition.num : ++maxNum;
    if (addition.num > maxNum) maxNum = addition.num;

    const newLine = formatAppRow({ ...addition, num: entryNum });
    newLines.push(newLine);
    // Register the new row so later TSVs in this same batch dedup against it
    // instead of silently appending a second copy.
    const parsedNew = parseAppLine(newLine);
    if (parsedNew) existingApps.push(parsedNew);
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (appLines[i].includes('---') && appLines[i].startsWith('|')) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx >= 0) {
    appLines.splice(insertIdx, 0, ...newLines);
  }
}

// Write back
if (!DRY_RUN) {
  writeFileSync(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  for (const file of tsvFiles) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${tsvFiles.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped`);
if (DRY_RUN) console.log('(dry-run — no changes written)');

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(ROOT, 'cli/verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (_e) {
    process.exit(1);
  }
}
