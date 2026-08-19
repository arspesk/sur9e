// Server-side tracker querying: filters + compact projection + pagination
// over loadApplicationsWithSummary. Powers GET /api/applications with query
// params (fields=compact) and, through it, the MCP get_tracker tool — so an
// agent can ask for exactly the rows it needs instead of pulling the whole
// tracker (1.7 MB at ~2.5k rows) through a tool-output limit (#104/#107).

import 'server-only';
import { z } from 'zod';
import type { ApplicationWithSummary } from '../schemas/applications';
import { ApplicationStatus } from '../schemas/applications';
import { loadApplicationsWithSummary, normalizeStatus } from './applications';

// ── Query params (wire format, snake_case) ────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * URL query params recognized by GET /api/applications. Presence of ANY of
 * these keys switches the route from the legacy full-summary payload to the
 * compact paginated payload — keep the route's back-compat check in sync by
 * always deriving it from this schema's keys.
 */
export const TrackerQueryParams = z.object({
  // Comma-separated canonical statuses (legacy 'skip' folds into discarded
  // via the ApplicationStatus preprocess).
  status: z
    .string()
    .transform((s, ctx) => {
      const statuses: ApplicationStatus[] = [];
      for (const part of s.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const parsed = ApplicationStatus.safeParse(trimmed);
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', message: `unknown status: ${trimmed}` });
          return z.NEVER;
        }
        statuses.push(parsed.data);
      }
      return statuses;
    })
    .optional(),
  location: z.string().optional(),
  work_mode: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  min_score: z.coerce.number().optional(),
  since: z.string().regex(DATE_RE, 'expected YYYY-MM-DD').optional(),
  until: z.string().regex(DATE_RE, 'expected YYYY-MM-DD').optional(),
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
  fields: z.literal('compact').optional(),
});
export type TrackerQueryParams = z.infer<typeof TrackerQueryParams>;

export const TRACKER_QUERY_PARAM_KEYS = Object.freeze(
  Object.keys(TrackerQueryParams.shape),
) as readonly string[];

// ── Filters (lib format, camelCase) ───────────────────────────────────────────

export interface TrackerQueryFilters {
  status?: ApplicationStatus[];
  /** Case-insensitive substring on summary.location (fallback summary.loc). */
  location?: string;
  /** Case-insensitive equality on summary.work_mode. */
  workMode?: string;
  /** Case-insensitive substring on the row's company. */
  company?: string;
  /** Case-insensitive substring on the row's role. */
  role?: string;
  /** Rows whose score parses to a number >= this; non-numeric rows drop. */
  minScore?: number;
  /** YYYY-MM-DD; rows with date >= since. */
  since?: string;
  /** YYYY-MM-DD; rows with date <= until. */
  until?: string;
  /** Page size, default 200, clamped to 1..1000. */
  limit?: number;
  /** Pagination offset, default 0. */
  offset?: number;
}

/** Map validated wire params onto lib filters. */
export function toTrackerFilters(params: TrackerQueryParams): TrackerQueryFilters {
  return {
    status: params.status,
    location: params.location,
    workMode: params.work_mode,
    company: params.company,
    role: params.role,
    minScore: params.min_score,
    since: params.since,
    until: params.until,
    limit: params.limit,
    offset: params.offset,
  };
}

// ── Result shape ──────────────────────────────────────────────────────────────

/**
 * Compact row projection: only scalar identity + summary fields the agent
 * needs to pick an application; full detail stays behind get_report. Absent
 * values are omitted rather than emitted as null/undefined keys.
 */
export interface CompactApplication {
  num: number;
  date: string;
  company: string;
  role: string;
  score: string;
  /** Canonical lowercase status ('skip' rows surface as 'discarded'). */
  status: string;
  url?: string;
  location?: string;
  work_mode?: string;
  seniority?: string;
  posted?: string;
}

export interface TrackerQueryResult {
  entries: CompactApplication[];
  /** Filtered row count before pagination. */
  total: number;
  /** entries.length — the page size actually returned. */
  count: number;
  /** Offset for the next page, or null when this page is the last. */
  next_offset: number | null;
}

// ── Implementation ────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** Canonical lowercase status for a raw tracker cell ('**Skip**' → 'discarded'). */
function canonicalStatus(raw: string): string {
  const normalized = normalizeStatus(raw);
  const parsed = ApplicationStatus.safeParse(normalized);
  return parsed.success ? parsed.data : normalized;
}

/** First argument that is a non-empty string, else undefined. */
function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function rowLocation(row: ApplicationWithSummary): string | undefined {
  return firstNonEmpty(row.summary?.location, row.summary?.loc);
}

function matches(row: ApplicationWithSummary, filters: TrackerQueryFilters): boolean {
  // An empty status list (e.g. `?status=`) means "no status filter".
  if (
    filters.status &&
    filters.status.length > 0 &&
    !(filters.status as string[]).includes(canonicalStatus(row.status))
  ) {
    return false;
  }
  if (filters.location) {
    const location = rowLocation(row);
    if (!location || !location.toLowerCase().includes(filters.location.toLowerCase())) {
      return false;
    }
  }
  if (filters.workMode) {
    const workMode = firstNonEmpty(row.summary?.work_mode);
    if (!workMode || workMode.toLowerCase() !== filters.workMode.toLowerCase()) return false;
  }
  if (filters.company && !row.company.toLowerCase().includes(filters.company.toLowerCase())) {
    return false;
  }
  if (filters.role && !row.role.toLowerCase().includes(filters.role.toLowerCase())) {
    return false;
  }
  if (filters.minScore !== undefined) {
    const score = Number.parseFloat(row.score);
    if (!Number.isFinite(score) || score < filters.minScore) return false;
  }
  if (filters.since && row.date < filters.since) return false;
  if (filters.until && row.date > filters.until) return false;
  return true;
}

function project(row: ApplicationWithSummary): CompactApplication {
  const entry: CompactApplication = {
    num: row.num,
    date: row.date,
    company: row.company,
    role: row.role,
    score: row.score,
    status: canonicalStatus(row.status),
  };
  const url = firstNonEmpty(row.summary?.url);
  if (url) entry.url = url;
  const location = rowLocation(row);
  if (location) entry.location = location;
  const workMode = firstNonEmpty(row.summary?.work_mode);
  if (workMode) entry.work_mode = workMode;
  const seniority = firstNonEmpty(row.summary?.seniority);
  if (seniority) entry.seniority = seniority;
  const posted = firstNonEmpty(row.posted, row.summary?.posted);
  if (posted) entry.posted = posted;
  return entry;
}

/**
 * Filter, project, and paginate the tracker. All filters are conjunctive and
 * optional; with none given this is simply "first page of the tracker,
 * compact rows".
 */
export function queryApplications(
  rootPath: string,
  filters: TrackerQueryFilters,
): TrackerQueryResult {
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(filters.offset ?? 0), 0);

  const filtered = loadApplicationsWithSummary(rootPath).filter(row => matches(row, filters));
  const entries = filtered.slice(offset, offset + limit).map(project);
  const nextOffset = offset + entries.length;

  return {
    entries,
    total: filtered.length,
    count: entries.length,
    next_offset: nextOffset < filtered.length ? nextOffset : null,
  };
}
