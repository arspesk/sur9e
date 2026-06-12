// SPDX-License-Identifier: MIT
// cli/lib/job-url.mjs
//
// URL-aware duplicate detection shared by cli/verify-pipeline.mjs and
// cli/dedup-tracker.mjs. The tracker table doesn't store the job URL — the
// linked report's frontmatter does (url:) — so two rows with the same company
// and role but *different* posting URLs are distinct jobs, not duplicates
// (e.g. two different LinkedIn listings for "Solutions Engineer"). These
// helpers resolve each row's URL via its report link and split a company/role
// candidate group into per-URL buckets, so only same-URL (or URL-unknown) rows
// are treated as duplicates.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReportFile } from '../../batch/lib/report-file.mjs';

// Canonicalize a URL for comparison (host case, default ports, percent-encoding).
// Returns null for empty / unparseable values — same contract as cli/num-by-url.mjs.
export function canonUrl(url) {
  if (url == null || url === '') return null;
  try {
    return new URL(String(url)).href;
  } catch {
    return null;
  }
}

// Pull the path out of a tracker report cell like "[917](artifacts/reports/917-x.md)".
// Returns null when the cell carries no markdown link (e.g. a bare "—").
export function reportPathFromCell(cell) {
  const m = String(cell ?? '').match(/\]\(([^)]+)\)/);
  return m ? m[1] : null;
}

// Resolve the canonical job URL for a tracker row by reading the report it links
// to. Returns null when the cell has no link, the file is missing, or the report
// carries no url. `cache` (Map keyed by report path) memoizes reads across rows.
export function resolveEntryUrl(root, reportCell, cache = new Map()) {
  const rel = reportPathFromCell(reportCell);
  if (!rel) return null;
  if (cache.has(rel)) return cache.get(rel);
  let url = null;
  try {
    const { frontmatter } = parseReportFile(readFileSync(join(root, rel), 'utf-8'));
    url = canonUrl(frontmatter?.url);
  } catch {
    url = null; // missing / legacy / unparseable report → unknown URL
  }
  cache.set(rel, url);
  return url;
}

// Split a company/role candidate group into duplicate buckets by URL. Rows that
// share a known canonical URL cluster together; rows with an unknown URL fall
// back to a single conservative bucket (preserving the pre-URL behavior for
// report-less rows). Rows whose known URLs differ land in separate buckets and
// are therefore NOT flagged as duplicates of each other.
//   members: array of objects each carrying a `url` field (canonical or null)
//   returns: array of buckets (arrays), in first-seen order
export function bucketByUrl(members) {
  const UNKNOWN = Symbol('unknown-url');
  const buckets = new Map();
  for (const m of members) {
    const key = m.url ?? UNKNOWN;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  return [...buckets.values()];
}
