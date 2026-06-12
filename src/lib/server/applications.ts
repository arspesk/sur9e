// Source of truth for data/applications.md. Loaders, atomic-write
// callers, and summary-derivation helpers. Domain shapes are parsed
// through zod schemas at the load/save boundary; pure utilities are
// typed with explicit signatures.

import 'server-only';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { cache } from 'react';
import type { z } from 'zod';
import type { ReportSummary } from '../schemas/applications';
import {
  ApplicationDetail,
  ApplicationRow,
  ApplicationStatus,
  ApplicationWithSummary,
  OutreachPack,
} from '../schemas/applications';
import { atomicWrite } from './atomic-write';
import { companySlug } from './format';
import { loadProfile } from './profile';
import { readFileOrNull, statOrNull } from './read-or-null';
import { extractAppendedSections, loadReport } from './reports';
import { appendTransition } from './status-log';

// ── Constants ─────────────────────────────────────────────────────────────────

// SKIP was merged into Discarded in 2026-05. Legacy 'skip' input is still
// accepted by displayStatus() and mapped to 'Discarded' for backwards-compat
// with any old caller.
export const CANONICAL_STATUSES = Object.freeze([
  'screened',
  'evaluated',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'discarded',
]) as readonly ApplicationStatus[];

// ── Lightweight in-memory summary cache ───────────────────────────────────────

// Keyed by `${reportPath}:${mtime}`.
const summaryCache = new Map<string, ReportSummary | null>();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map canonical lowercase status to the format used in data/applications.md.
 * Legacy 'skip' input maps to 'Discarded'; everything else is title-cased.
 */
export function displayStatus(canonical: ApplicationStatus | 'skip'): string {
  if (canonical === 'skip') return 'Discarded';
  if (!(CANONICAL_STATUSES as readonly string[]).includes(canonical)) {
    throw new Error(`invalid status: ${canonical}`);
  }
  return canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

/**
 * Normalize a status string from applications.md to a canonical lowercase key.
 * Strips markdown bold, trims whitespace, lowercases.
 */
export function normalizeStatus(raw: string | null | undefined): string {
  return (raw || '').replace(/\*\*/g, '').trim().toLowerCase();
}

// ── Loaders ───────────────────────────────────────────────────────────────────

/**
 * Read + parse data/applications.md.
 *
 * Wrapped with React's `cache()` so within a single RSC render any number of
 * `findByFilename` / `findByNum` / `loadApplicationsWithSummary` calls share
 * one filesystem read. The canonical win is `/report/[filename]/page.tsx`,
 * which calls `findByFilename` (via generateMetadata) and `findByNum` (via
 * Page) in the same request -- both internally fan out to loadApplications.
 *
 * Outside an RSC render context (vitest unit tests, CLI scripts), React's
 * `cache()` falls back to a no-op pass-through: every call invokes the
 * wrapped function fresh. That's what we want for tests that mutate the
 * file between reads (updateStatus -> loadApplications round-trips, etc.).
 *
 * We deliberately do NOT use `unstable_cache` here -- it persists across
 * requests and would mask out-of-band CLI writes to data/applications.md
 * (scan, normalize-statuses, merge-tracker, batch/scan-jobspy, etc. all
 * rewrite this file without going through a server action).
 */
export const loadApplications = cache((rootPath: string): ApplicationRow[] => {
  const filePath = join(rootPath, 'data/applications.md');
  const content = readFileOrNull(filePath);
  if (content == null) return [];

  const entries: unknown[] = [];

  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;

    // Extract URL + report path from columns
    const reportMatch = parts[8].match(/\[(\d+)\]\(([^)]+)\)/);

    // Optional trailing `Posted` column (true posting date). Legacy 9-column
    // rows have no parts[10]; anything that isn't a YYYY-MM-DD date (empty
    // cell included) leaves the field absent — never an empty string.
    const postedRaw = (parts[10] || '').trim();
    const posted = /^\d{4}-\d{2}-\d{2}$/.test(postedRaw) ? postedRaw : undefined;

    entries.push({
      num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      pdf: parts[7],
      reportPath: reportMatch ? reportMatch[2] : null,
      notes: parts[9] || '',
      ...(posted ? { posted } : {}),
    });
  }
  // Validate per row — one malformed hand-edited row (e.g. num `0` or a
  // negative, which fails ApplicationRow's positive-int rule) is skipped
  // with a warning like every other malformation in this parser, instead
  // of a ZodError on the whole array dropping /offers and /analytics to
  // their route error boundaries.
  const rows: ApplicationRow[] = [];
  for (const entry of entries) {
    const parsed = ApplicationRow.safeParse(entry);
    if (parsed.success) {
      rows.push(parsed.data);
      continue;
    }
    const num = (entry as { num?: unknown }).num;
    const issues = parsed.error.issues
      .map(i => `${i.path.map(String).join('.')}: ${i.message}`)
      .join('; ');
    console.warn(`[applications] skipping malformed tracker row (num ${String(num)}): ${issues}`);
  }
  return rows;
});

/**
 * Find the newest generated artifact in artifacts/output/ matching
 * {prefix}-{candidate}-{slug}-{num}-{YYYY-MM-DD}.pdf, falling back to the
 * legacy num-less form {prefix}-{candidate}-{slug}-{YYYY-MM-DD}.pdf.
 *
 * The offer num in the filename is what keeps two offers at the same company
 * from clobbering / claiming each other's artifacts (e.g. two Stripe roles on
 * the same day used to collide on cv-{candidate}-stripe-{date}.pdf). Legacy
 * num-less files still surface so artifacts generated before the num was
 * added keep working — but only as a fallback, never over a num-exact match.
 *
 * Both `candidate` and `slug` are anchored exactly so a query for slug
 * "matter" cannot leak into "grey-matter" files.
 *
 * Returns a path relative to rootPath (e.g. "artifacts/output/cv-...pdf"), or null.
 * If `candidate` or `slug` is empty/missing, returns null (no possible match).
 */
export function findArtifact(
  rootPath: string,
  prefix: string,
  candidate: string,
  slug: string,
  num?: number,
): string | null {
  if (!candidate || !slug) return null;
  const dir = join(rootPath, 'artifacts', 'output');
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = `${prefix}-${escapeRe(candidate)}-${escapeRe(slug)}`;
  const files = readDirOrEmpty(dir);
  const newest = (pattern: RegExp): string | null => {
    const matches = files
      .filter(f => pattern.test(f))
      .sort()
      .reverse();
    return matches[0] ? `artifacts/output/${matches[0]}` : null;
  };
  if (num != null) {
    const hit = newest(new RegExp(`^${base}-${num}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    if (hit) return hit;
  }
  return newest(new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
}

function readDirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Find the newest outreach pack file for a given offer num.
 *
 * Outreach files live at `artifacts/outreach/<num>-<slug>-<date>.md`.
 * Returns a path relative to rootPath (e.g. "artifacts/outreach/1251-...md") or null.
 */
export function findOutreach(rootPath: string, num: number): string | null {
  if (!Number.isInteger(num)) return null;
  const dir = join(rootPath, 'artifacts', 'outreach');
  const pattern = new RegExp(`^${num}-[a-z0-9-]+-\\d{4}-\\d{2}-\\d{2}\\.md$`);
  const matches = readDirOrEmpty(dir)
    .filter(f => pattern.test(f))
    .sort()
    .reverse();
  return matches[0] ? `artifacts/outreach/${matches[0]}` : null;
}

/**
 * Read and parse an outreach pack file.
 *
 * Format: YAML frontmatter (delimited by `---` lines) + Markdown body.
 * Returns { frontmatter, body } or null if the file is missing / malformed.
 */
export function loadOutreach(
  rootPath: string,
  outreachPath: string | null | undefined,
): { frontmatter: unknown; body: string } | null {
  if (!outreachPath) return null;
  const full = join(rootPath, outreachPath);
  const raw = readFileOrNull(full);
  if (raw == null) return null;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  try {
    const frontmatter = yaml.load(m[1]);
    const result = OutreachPack.parse({ frontmatter, body: m[2] });
    return result;
  } catch {
    return null;
  }
}

/**
 * Find a single application entry by its num.
 *
 * Always attaches `cv_pdf_path` and `cover_letter_path` (null if not found
 * on disk) computed by globbing artifacts/output/ via findArtifact() with the user's
 * profile name as the candidate slot.
 *
 * If the entry has a reportPath and the file loads cleanly, also attaches
 * `report` with { fileName, markdown, html }.
 *
 * Returns null if num is not in applications.md.
 */
export function findByNum(rootPath: string, num: number): ApplicationDetail | null {
  const entries = loadApplications(rootPath);
  const entry = entries.find(e => e.num === num);
  if (!entry) return null;

  const profile = loadProfile(rootPath);
  // ProfileShape.candidate.full_name is the canonical owner field. The legacy
  // .mjs also fell back to profile.name, but ProfileShape has no `name` key,
  // so that branch silently returned '' — drop it.
  const candidate = companySlug(profile?.candidate?.full_name ?? '');
  const slug = companySlug(entry.company);

  // Resolve a path with a two-tier fallback:
  //   1. findArtifact — disk scan keyed on (candidate, slug). Requires
  //      profile.yml to know the candidate name.
  //   2. Report YAML frontmatter — the cover-letter / tailor-cv / outreach
  //      modes write `cv_pdf_path` / `cover_letter_path` / `outreach_path`
  //      back into the report on completion. Reading those means we
  //      surface the artifact even when profile.yml is missing (fresh
  //      worktrees, demo data, post-OSS clone before first run).
  let parsedFrontmatter: Record<string, unknown> | null | undefined;
  let r: ReturnType<typeof loadReport> | null = null;
  if (entry.reportPath) {
    r = loadReport(rootPath, entry.reportPath, entry.status);
    if (!('error' in r)) {
      parsedFrontmatter = r.parsed as Record<string, unknown> | null | undefined;
    }
  }
  const fmPath = (k: string): string | null => {
    const v = parsedFrontmatter?.[k];
    return typeof v === 'string' && v ? v : null;
  };
  const cv_pdf_path = findArtifact(rootPath, 'cv', candidate, slug, num) ?? fmPath('cv_pdf_path');
  const cover_letter_path =
    findArtifact(rootPath, 'cover-letter', candidate, slug, num) ?? fmPath('cover_letter_path');
  const outreach_path = findOutreach(rootPath, num) ?? fmPath('outreach_path');
  const outreach = outreach_path ? loadOutreach(rootPath, outreach_path) : null;

  if (r && !('error' in r)) {
    // The research / interview-prep jobs append their `## Company Research` /
    // `## Interview Process` H2 sections to the report BODY (no frontmatter
    // key exists for them), so derive the flags by scanning the body.
    const body = typeof parsedFrontmatter?.body === 'string' ? parsedFrontmatter.body : r.markdown;
    const appended = extractAppendedSections(body);
    const has_company_research = appended.some(s => s.title === 'Company Research');
    const has_interview_process = appended.some(s => s.title === 'Interview Process');
    return ApplicationDetail.parse({
      ...entry,
      report: r,
      cv_pdf_path,
      cover_letter_path,
      outreach_path,
      outreach,
      has_company_research,
      has_interview_process,
    });
  }
  return ApplicationDetail.parse({
    ...entry,
    cv_pdf_path,
    cover_letter_path,
    outreach_path,
    outreach,
    has_company_research: false,
    has_interview_process: false,
  });
}

/**
 * Update an entry's status in data/applications.md.
 * - Validates `status` against CANONICAL_STATUSES (lowercase).
 * - Locates the markdown row whose first column equals `num`.
 * - Replaces the status column (column 6 in the 9-column table).
 * - Writes back via atomicWrite (preserves .bak of previous good content).
 * - Returns the updated entry (re-parsed via loadApplications).
 *
 * Throws on invalid status, missing num, or read/write failure.
 */
export function updateStatus(
  rootPath: string,
  num: number,
  status: string,
): ApplicationRow | undefined {
  // Validate at the boundary: ZodError for unknown statuses ("skip" preprocesses to "discarded").
  const canonical = ApplicationStatus.parse(status);

  const filePath = join(rootPath, 'data/applications.md');
  const content = readFileOrNull(filePath);
  if (content == null) {
    throw new Error(`applications.md not found at ${filePath}`);
  }
  const lines = content.split('\n');
  let foundIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    const lineNum = parseInt(parts[1]);
    if (lineNum === num) {
      foundIndex = i;
      break;
    }
  }
  if (foundIndex === -1) {
    throw new Error(`num not found: ${num}`);
  }
  const newStatusText = displayStatus(canonical);
  // The row format is: "| <num> | <date> | <co> | <role> | <score> | <status> | <pdf> | <report> | <notes> |"
  // split('|') yields: ['', ' <num> ', ' <date> ', ' <co> ', ' <role> ', ' <score> ', ' <status> ', ' <pdf> ', ' <report> ', ' <notes> ', '']
  // So cols[6] is the status column.
  const oldLine = lines[foundIndex];
  const cols = oldLine.split('|');
  const oldStatusRaw = normalizeStatus(cols[6]);
  cols[6] = ` ${newStatusText} `;
  lines[foundIndex] = cols.join('|');
  atomicWrite(filePath, lines.join('\n'));
  // Record the transition in the append-only status log (stage-of-rejection
  // / time-in-stage analytics read it). Bookkeeping must not fail the user's
  // mutation: log the error and move on — the next reconcile pass heals it.
  if (oldStatusRaw !== canonical) {
    try {
      const from = ApplicationStatus.safeParse(oldStatusRaw);
      appendTransition(rootPath, {
        num,
        from: from.success ? from.data : null,
        to: canonical,
        at: new Date().toISOString(),
        source: 'app',
      });
    } catch (err) {
      console.error(`[status-log] append failed for #${num}:`, err);
    }
  }
  // Re-parse and return the updated entry.
  const updated = loadApplications(rootPath).find(e => e.num === num);
  return updated;
}

/**
 * Hard-delete an application entry from data/applications.md AND the
 * corresponding report file (if any).
 *
 * Returns { deleted, num, removedReport }. `deleted` is false when the row
 * is already gone (missing tracker or missing num) — delete is IDEMPOTENT so
 * a double-fire (stale list, double-click) is a clean no-op, not a 500.
 * `removedReport` is the report path that was deleted (or null if the row had
 * no report link, the file didn't exist, or nothing was deleted).
 */
export function deleteApplication(
  rootPath: string,
  num: number,
): { deleted: boolean; num: number; removedReport: string | null } {
  const filePath = join(rootPath, 'data/applications.md');
  const content = readFileOrNull(filePath);
  if (content == null) {
    // Nothing to delete — idempotent no-op rather than a hard error.
    return { deleted: false, num, removedReport: null };
  }
  const lines = content.split('\n');
  let foundIndex = -1;
  let removedReport: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    if (parseInt(parts[1]) === num) {
      foundIndex = i;
      const reportMatch = parts[8].match(/\[(\d+)\]\(([^)]+)\)/);
      if (reportMatch) removedReport = reportMatch[2];
      break;
    }
  }
  if (foundIndex === -1) {
    // Already deleted (e.g. a second delete fired against a stale list).
    // Idempotent: report "nothing deleted" instead of throwing a 500.
    return { deleted: false, num, removedReport: null };
  }
  lines.splice(foundIndex, 1);
  atomicWrite(filePath, lines.join('\n'));

  // Delete a file, swallowing ENOENT. Returns whether it was actually removed.
  // Tracker delete is the source of truth, so a file-system failure is logged
  // but never aborts the delete.
  const tryUnlink = (absPath: string): boolean => {
    try {
      unlinkSync(absPath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn(`[deleteApplication] could not delete ${absPath}: ${(err as Error).message}`);
      }
      return false;
    }
  };

  // 1. The report file linked in the tracker row (whatever its name), plus its
  //    `.bak` sidecar — which the previous implementation left orphaned.
  let linkedRemoved = false;
  if (removedReport) {
    const fullPath = join(rootPath, removedReport);
    linkedRemoved = tryUnlink(fullPath);
    tryUnlink(`${fullPath}.bak`);
  }

  // 2. Sweep any same-num sibling artifacts left on disk: `NNN-<slug>-<date>.md`
  //    (+ `.md.bak`) created by re-generation or screener churn under a
  //    DIFFERENT slug than the linked file. Deleting only the linked report
  //    used to leave these behind, and an orphan whose name sorts first then
  //    shadows the next report that reuses the number (loadReport resolves
  //    `NNN-*.md` by readdir order). The `NNN-` prefix is dash-bounded, so
  //    deleting #2 (`002-`) can't match #20 (`020-`) or #200 (`200-`).
  const reportsDir = join(rootPath, 'artifacts/reports');
  const prefix = `${String(num).padStart(3, '0')}-`;
  try {
    for (const f of readdirSync(reportsDir)) {
      if (f.startsWith(prefix) && (f.endsWith('.md') || f.includes('.md.bak'))) {
        tryUnlink(join(reportsDir, f));
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn(`[deleteApplication] could not scan reports dir: ${(err as Error).message}`);
    }
  }

  // Back-compat: `removedReport` reports the linked path only when it was
  // actually on disk (null otherwise), as before.
  if (removedReport && !linkedRemoved) removedReport = null;

  return { deleted: true, num, removedReport };
}

// Locate the index in `lines` of the markdown row whose `num` column
// equals the given value. Returns -1 if not found. Shared by the
// single-row and batch helpers below.
function findRowIndex(lines: string[], num: number): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    if (parseInt(parts[1]) === num) return i;
  }
  return -1;
}

export interface BatchItemResult {
  num: number;
  ok: boolean;
  error?: string;
}

export interface BatchUpdateMutation {
  num: number;
  status: string;
}

/**
 * Apply N status updates in a single read + atomic write. Each row is
 * located by num, status column rewritten in place. Returns a per-row
 * result list (ok / error). Unknown nums and invalid statuses produce
 * error entries — the rest still commit.
 *
 * Cuts cost from N reads + N atomicWrites (20 selected rows → 40
 * syscalls + 20 .bak rotations) to 1 + 1 + 1.
 */
export function batchUpdateStatus(
  rootPath: string,
  mutations: BatchUpdateMutation[],
): BatchItemResult[] {
  if (mutations.length === 0) return [];
  const filePath = join(rootPath, 'data/applications.md');
  const content = readFileOrNull(filePath);
  if (content == null) {
    throw new Error(`applications.md not found at ${filePath}`);
  }
  const lines = content.split('\n');
  const results: BatchItemResult[] = [];
  const transitions: Array<{ num: number; from: string; to: z.infer<typeof ApplicationStatus> }> =
    [];
  let changed = false;
  for (const { num, status } of mutations) {
    let canonical: z.infer<typeof ApplicationStatus>;
    try {
      canonical = ApplicationStatus.parse(status);
    } catch (err) {
      results.push({ num, ok: false, error: (err as Error).message });
      continue;
    }
    const idx = findRowIndex(lines, num);
    if (idx === -1) {
      results.push({ num, ok: false, error: `num not found: ${num}` });
      continue;
    }
    const cols = lines[idx].split('|');
    const oldStatusRaw = normalizeStatus(cols[6]);
    cols[6] = ` ${displayStatus(canonical)} `;
    lines[idx] = cols.join('|');
    changed = true;
    if (oldStatusRaw !== canonical) {
      transitions.push({ num, from: oldStatusRaw, to: canonical });
    }
    results.push({ num, ok: true });
  }
  if (changed) {
    atomicWrite(filePath, lines.join('\n'));
    // Mirror updateStatus: record every real status change in the append-only
    // status log so batch updates feed the same analytics (stage-of-rejection
    // / time-in-stage) as single updates. Bookkeeping must not fail the user's
    // mutation: log the error and move on — the next reconcile pass heals it.
    const at = new Date().toISOString();
    for (const t of transitions) {
      try {
        const from = ApplicationStatus.safeParse(t.from);
        appendTransition(rootPath, {
          num: t.num,
          from: from.success ? from.data : null,
          to: t.to,
          at,
          source: 'app',
        });
      } catch (err) {
        console.error(`[status-log] append failed for #${t.num}:`, err);
      }
    }
  }
  return results;
}

export interface BatchDeleteResult extends BatchItemResult {
  removedReport?: string | null;
}

/**
 * Delete N entries in a single read + atomic write. Report files are
 * unlinked one-by-one after the tracker write commits (best effort —
 * ENOENT is silently swallowed, other failures are logged).
 */
export function batchDeleteApplications(rootPath: string, nums: number[]): BatchDeleteResult[] {
  if (nums.length === 0) return [];
  const filePath = join(rootPath, 'data/applications.md');
  const content = readFileOrNull(filePath);
  if (content == null) {
    throw new Error(`applications.md not found at ${filePath}`);
  }
  const lines = content.split('\n');
  // Dedup nums so duplicate entries don't collide on the same row index.
  const uniq = Array.from(new Set(nums));
  // Collect (index, num, reportPath) for every num before mutating, then
  // splice in reverse order so earlier indices stay valid.
  const targets: Array<{ idx: number; num: number; removedReport: string | null }> = [];
  const results: BatchDeleteResult[] = [];
  for (const num of uniq) {
    const idx = findRowIndex(lines, num);
    if (idx === -1) {
      results.push({ num, ok: false, error: `num not found: ${num}` });
      continue;
    }
    const parts = lines[idx].split('|').map(s => s.trim());
    const reportMatch = parts[8].match(/\[(\d+)\]\(([^)]+)\)/);
    targets.push({ idx, num, removedReport: reportMatch ? reportMatch[2] : null });
  }
  if (targets.length === 0) {
    return results;
  }
  for (const t of [...targets].sort((a, b) => b.idx - a.idx)) {
    lines.splice(t.idx, 1);
  }
  atomicWrite(filePath, lines.join('\n'));
  for (const t of targets) {
    let removedReport = t.removedReport;
    if (removedReport) {
      const fullPath = join(rootPath, removedReport);
      try {
        unlinkSync(fullPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          removedReport = null;
        } else {
          console.warn(
            `[batchDeleteApplications] could not delete report ${fullPath}: ${(err as Error).message}`,
          );
        }
      }
    }
    results.push({ num: t.num, ok: true, removedReport });
  }
  return results;
}

/**
 * Load applications and enrich each entry with a `summary` field
 * from the parsed report (compRange, loc, archetype).
 * Cached per-file by mtime; fast on subsequent requests.
 */
export function loadApplicationsWithSummary(rootPath: string): ApplicationWithSummary[] {
  const entries = loadApplications(rootPath);
  const result = entries.map(e => {
    if (!e.reportPath) return { ...e, summary: null };
    const fullPath = join(rootPath, e.reportPath);
    const stat = statOrNull(fullPath);
    if (!stat) return { ...e, summary: null };
    const mtime = stat.mtimeMs;

    const cacheKey = `${e.reportPath}:${mtime}`;
    if (summaryCache.has(cacheKey)) {
      return { ...e, summary: summaryCache.get(cacheKey) ?? null };
    }

    const r = loadReport(rootPath, e.reportPath, e.status);
    const parsed = (!('error' in r) ? r.parsed : null) as Record<string, unknown> | null;
    const summary = (parsed?.summary as ReportSummary | null) || null;
    summaryCache.set(cacheKey, summary);
    return { ...e, summary };
  });
  return ApplicationWithSummary.array().parse(result);
}

/**
 * Find the application row whose reportPath ends with `filename`.
 *
 * Used by generateMetadata in /report/[filename]/page.tsx to resolve
 * the company and role labels without loading the full report file.
 * Returns null if no row matches.
 */
export function findByFilename(
  rootPath: string,
  filename: string,
): Pick<ApplicationRow, 'company' | 'role'> | null {
  const entries = loadApplications(rootPath);
  const entry = entries.find(e => {
    if (!e.reportPath) return false;
    const base = e.reportPath.split('/').at(-1) ?? e.reportPath;
    return base === filename;
  });
  if (!entry) return null;
  return { company: entry.company, role: entry.role };
}

export type {
  ApplicationDetail,
  ApplicationRow,
  ApplicationStatus,
  ApplicationWithSummary,
  ReportSummary,
} from '../schemas/applications';
