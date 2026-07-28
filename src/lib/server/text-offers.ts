import 'server-only';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ApplicationRow } from '../schemas/applications';
import { findByNum, loadApplications } from './applications';
import { companySlug } from './format';
import { saveReport } from './reports';

const MAX_TEXT_LENGTH = 32_000;

export interface CreateTextOfferInput {
  text: string;
  company?: string;
  role?: string;
}

export interface TextOfferResult {
  reused: boolean;
  offer: ApplicationRow;
  jdHash: string;
  jdPath: string;
}

export interface TextOfferPreview {
  reused: boolean;
  offer: ApplicationRow | null;
  jdHash: string;
  jdPath: string;
}

export function normalizeJobDescription(text: string): string {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

export function hashJobDescription(text: string): string {
  return createHash('sha256').update(normalizeJobDescription(text), 'utf-8').digest('hex');
}

function nextOfferNum(rootPath: string): number {
  let max = 0;
  for (const row of loadApplications(rootPath)) max = Math.max(max, row.num);
  const reportsDir = join(rootPath, 'artifacts/reports');
  if (existsSync(reportsDir)) {
    for (const file of readdirSync(reportsDir)) {
      const match = file.match(/^(\d+)-/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

function existingByHash(rootPath: string, hash: string): ApplicationRow | null {
  for (const row of loadApplications(rootPath)) {
    if (!row.reportPath) continue;
    try {
      const raw = readFileSync(join(rootPath, row.reportPath), 'utf-8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!match) continue;
      const fm = yaml.load(match[1]) as Record<string, unknown> | null;
      if (fm?.source_kind === 'text' && fm.jd_hash === hash) return row;
    } catch {
      // One damaged report must not prevent dedup against the remaining rows.
    }
  }
  return null;
}

export function previewTextOffer(rootPath: string, text: string): TextOfferPreview {
  const normalized = normalizeJobDescription(text);
  if (!normalized) throw new Error('job description text is required');
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `job description text must be ${MAX_TEXT_LENGTH.toLocaleString()} characters or less`,
    );
  }
  const jdHash = hashJobDescription(normalized);
  const offer = existingByHash(rootPath, jdHash);
  return {
    reused: offer !== null,
    offer,
    jdHash,
    jdPath: `inputs/jds/${jdHash}.md`,
  };
}

function mergeTracker(rootPath: string): void {
  const additionsDir = join(rootPath, 'batch/tracker-additions');
  const appsFile = join(rootPath, 'data/applications.md');
  execFileSync(process.execPath, [join(process.cwd(), 'cli/merge-tracker.mjs'), '--force'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUR9E_APPS_FILE: appsFile,
      SUR9E_ADDITIONS_DIR: additionsDir,
    },
    stdio: 'pipe',
  });
}

export function createOrReuseTextOffer(
  rootPath: string,
  input: CreateTextOfferInput,
): TextOfferResult {
  const text = normalizeJobDescription(input.text);
  const preview = previewTextOffer(rootPath, text);
  const { jdHash } = preview;
  const existing = preview.offer;
  if (existing) {
    return {
      reused: true,
      offer: existing,
      jdHash,
      jdPath: `inputs/jds/${jdHash}.md`,
    };
  }

  const company = input.company?.trim() || 'Unknown';
  const role = input.role?.trim() || 'Unknown role';
  const num = nextOfferNum(rootPath);
  const today = new Date().toISOString().slice(0, 10);
  const slug = companySlug(company) || 'unknown';
  const jdPath = `inputs/jds/${jdHash}.md`;
  const reportPath = `artifacts/reports/${String(num).padStart(3, '0')}-${slug}-${today}.md`;

  mkdirSync(join(rootPath, 'inputs/jds'), { recursive: true });
  mkdirSync(join(rootPath, 'artifacts/reports'), { recursive: true });
  mkdirSync(join(rootPath, 'batch/tracker-additions'), { recursive: true });
  writeFileSync(join(rootPath, jdPath), `${text}\n`, 'utf-8');
  saveReport({
    filePath: join(rootPath, reportPath),
    frontmatter: {
      num,
      company,
      role,
      date: today,
      status: 'Screened',
      state: 'screened',
      score: 'N/A',
      source_kind: 'text',
      jd_path: jdPath,
      jd_hash: jdHash,
      tldr: 'Created from a pasted job description. Run screening or another offer mode when ready.',
    },
    body: [
      '<div data-callout data-variant="info" data-emoji="💡">',
      '',
      '**Next Steps** Run screening, a full evaluation, or generate a tailored application document.',
      '',
      '</div>',
      '',
      '## TL;DR',
      '',
      'Created from a pasted job description. No screening score has been assigned yet.',
      '',
    ].join('\n'),
  });

  const clean = (value: string) => value.replace(/[|\t\r\n]+/g, ' ').trim();
  const tsv = [
    num,
    today,
    clean(company),
    clean(role),
    'N/A',
    'Screened',
    '❌',
    `[${num}](${reportPath})`,
    'Created from pasted job description',
    '',
  ].join('\t');
  writeFileSync(
    join(rootPath, `batch/tracker-additions/${String(num).padStart(3, '0')}-${slug}.tsv`),
    `${tsv}\n`,
    'utf-8',
  );

  mergeTracker(rootPath);
  const offer = findByNum(rootPath, num);
  if (!offer) throw new Error(`text offer #${num} was created but did not merge into the tracker`);
  return { reused: false, offer, jdHash, jdPath };
}
