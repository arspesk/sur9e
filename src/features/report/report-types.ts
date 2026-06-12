/**
 * features/report/report-types.ts
 *
 * Report types + the pure helpers the report surfaces still consume
 * (fmtDate, markedInline, sevWeight, radarSVG, mapEntryToR, numFromFilename).
 * Formatting/label primitives live in their canonical homes: @/lib/escape-html,
 * @/lib/scoring (legitTierLabel), @/lib/server/format (short-field helpers).
 *
 * No DOM access — these are safe to import on the server and inside vitest.
 */

import { escapeHtml as esc } from '@/lib/escape-html';
import { shortComp } from '@/lib/server/format';

/* ---------- types ---------- */

export interface CvMatch {
  jd?: string;
  cv?: string;
  strength?: string;
}

export interface Gap {
  title?: string;
  severity?: string;
  mitigation?: string;
}

export interface CompPoint {
  source?: string;
  value?: string;
}

export interface CvAdjustment {
  section?: string;
  current?: string;
  proposed?: string;
  why?: string;
}

export interface Star {
  theme?: string;
  s?: string;
  t?: string;
  a?: string;
  r?: string;
  reflection?: string;
}

export interface AppendedSection {
  title: string;
  body: string;
  rawHtml: string;
}

export interface OutreachContact {
  id?: string;
  name?: string;
  persona?: string;
  company?: string;
  title?: string;
  linkedin?: string;
  email?: string;
  framework?: string;
  message_en?: string;
  message_es?: string;
  char_count?: number;
  alts_en?: string[];
  alts_es?: string[];
  rationale?: string;
  notes?: string;
}

export interface OutreachFrontmatter {
  contacts?: OutreachContact[];
  pending?: { persona?: string; reason?: string }[];
  why_outreach?: string[];
  sequencing?: { day?: string | number; action?: string }[];
  drafted?: string;
  score?: string;
  primary?: string;
}

export interface OutreachPack {
  frontmatter?: OutreachFrontmatter;
}

export interface ScoreBreakdown {
  cv_match?: number;
  seniority?: number;
  compensation?: number;
  domain?: number;
  geo?: number;
  legitimacy?: number;
}

/** The `r` object that renderEvaluated/renderScreened/renderHero/etc. consume. */
export interface ReportR {
  id: string;
  num: number;
  status: string;
  state: string; // 'screened' | 'evaluated'
  company: string;
  role: string;
  archetype: string;
  archetype_detail: string;
  archetype_short?: string;
  date?: string;
  url?: string;
  // 'N/A' = screened-but-unscored (unreadable/prefiltered posting) — the
  // screener writes the literal sentinel instead of fabricating a 0.0.
  score: number | 'N/A';
  /** True posting date (YYYY-MM-DD) — optional; `date` stays the added/scan date. */
  posted?: string;
  pdf?: unknown;
  seniority?: string;
  seniority_short?: string;
  remote?: string;
  locations?: string | string[];
  loc_short?: string;
  team?: string;
  comp?: string;
  compRange?: string;
  comp_short?: string;
  date_short?: string;
  tldr?: string;
  cv_match?: CvMatch[];
  gaps?: Gap[];
  verdict?: string;
  detected_level?: string;
  natural_level?: string;
  sell_senior?: string[];
  if_downleveled?: string[];
  comp_points?: CompPoint[];
  analysis?: string;
  demand?: string;
  comp_verdict?: string;
  cv_adjustments?: CvAdjustment[];
  linkedin?: string[];
  stars?: Star[];
  tier?: string;
  notes?: string;
  score_breakdown?: ScoreBreakdown;
  keywords?: string[];
  legitimacy?: string | { tier?: string };
  sections?: { letter: string; title: string; body: string; rawHtml: string }[];
  cv_pdf_path?: string | null;
  cover_letter_path?: string | null;
  outreach?: OutreachPack | null;
  outreach_path?: string | null;
  has_company_research?: boolean;
  has_interview_process?: boolean;
  appended_sections?: AppendedSection[];
  negotiation_doc_path?: string | null;
  work_mode?: string;
  company_logo?: string;
  /** Canonical city-only location (city fallback resolved in ReportHero). */
  location?: string;
  body?: string;
  format?: 'frontmatter';
  /**
   * Pre-selected match + watch-out for the snapshot card. Provided by
   * frontmatter-format reports.
   */
  snapshot?: {
    match?: { jd?: string; cv?: string; strength?: string };
    watch?: { title?: string; severity?: string; mitigation?: string };
  };
}

/** Shape of /api/applications/:num response — minimal subset used by mapEntryToR. */
export interface ApplicationEntry {
  num: number;
  date?: string;
  /** True posting date (YYYY-MM-DD) from the tracker row, when known. */
  posted?: string;
  company?: string;
  role?: string;
  score?: string | number;
  status?: string;
  pdf?: unknown;
  notes?: string;
  report?: {
    markdown?: string;
    html?: string;
    fileName?: string;
    parsed?: Partial<ReportR> & {
      state?: string;
      score?: number;
      url?: string;
      sections?: ReportR['sections'];
      appended_sections?: AppendedSection[];
    };
  };
  cv_pdf_path?: string | null;
  cover_letter_path?: string | null;
  outreach?: OutreachPack | null;
  outreach_path?: string | null;
  has_company_research?: boolean;
  has_interview_process?: boolean;
}

/* ---------- fmtDate ---------- */

// Intl formatter construction is non-trivial; hoist to module scope so
// every fmtDate call reuses the same instance instead of allocating per render.
// timeZone: 'UTC' is load-bearing: `date`/`posted` are day-granular
// YYYY-MM-DD strings, which `new Date(d)` parses as UTC midnight. Formatting
// in the viewer's local zone (anything behind UTC) would roll that back to
// the previous day — "2026-06-09" rendering as "Jun 8". Pin to UTC so the
// displayed day always equals the stored day.
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

// The one date format for every surface (hero, table, kanban card, drawer):
// "Jun 9, 2026". UTC-pinned (see DATE_FMT note). Keep all date rendering
// going through this so formats never drift between views.
export function fmtDate(d?: string): string {
  if (!d) return '';
  try {
    return DATE_FMT.format(new Date(d));
  } catch (_e) {
    return d;
  }
}

/* ---------- displayDate ----------
   One date per surface, always explicitly labeled (posted-date design,
   2026-06-10): show the true posting date when the source reported one,
   else the added/scan date. */

/** Report-hero staleness threshold: a listing posted 30+ days ago is flagged. */
export const STALE_POSTED_DAYS = 30;

const DAY_MS = 86400000;

export interface DisplayDate {
  /** Which date is shown — 'posted' when a true posting date is known. */
  kind: 'posted' | 'added';
  /** The raw date string to render (caller formats it). */
  value: string;
  /** Posted date is more than STALE_POSTED_DAYS older than `now` (hero only). */
  stale: boolean;
}

export function displayDate(
  r: { posted?: string; date?: string },
  now: Date = new Date(),
): DisplayDate {
  if (r.posted) {
    const t = Date.parse(r.posted);
    // `posted` is day-granular (YYYY-MM-DD) — compare whole elapsed days so
    // an intraday `now` doesn't tip exactly-30-days-old listings into stale.
    const elapsedDays = Math.floor((now.getTime() - t) / DAY_MS);
    const stale = !Number.isNaN(t) && elapsedDays > STALE_POSTED_DAYS;
    return { kind: 'posted', value: r.posted, stale };
  }
  return { kind: 'added', value: r.date ?? '', stale: false };
}

/* ---------- markedInline ---------- */
// Tiny inline markdown -> HTML (just enough for **bold** + *italic*).

export function markedInline(s: unknown): string {
  if (!s) return '';
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/* ---------- sevWeight ---------- */

export function sevWeight(sev: string): number {
  return ({ hard_blocker: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[sev] || 0;
}

/* ---------- radarSVG ---------- */
// Shared by the drawer and the full report so the polygon shape +
// axis labels match exactly across both surfaces.

export interface RadarAxis {
  k: string;
  v: number;
}

export function radarSVG(scores: RadarAxis[]): string {
  const cx = 90;
  const cy = 80;
  const r = 60;
  const n = scores.length;
  const pts = scores.map((s, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const rr = (s.v / 5) * r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const grid = [1, 0.75, 0.5, 0.25]
    .map(f => {
      const gp = scores.map((_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f];
      });
      return (
        '<polygon points="' +
        gp.map(p => p.join(',')).join(' ') +
        '" fill="none" stroke="var(--border)" stroke-width="0.7"/>'
      );
    })
    .join('');
  const axes = scores
    .map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return (
        '<line x1="' +
        cx +
        '" y1="' +
        cy +
        '" x2="' +
        (cx + Math.cos(a) * r) +
        '" y2="' +
        (cy + Math.sin(a) * r) +
        '" stroke="var(--border)" stroke-width="0.7"/>'
      );
    })
    .join('');
  const labels = scores
    .map((s, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const lx = cx + Math.cos(a) * (r + 14);
      const ly = cy + Math.sin(a) * (r + 14) + 3;
      return (
        '<text x="' +
        lx +
        '" y="' +
        ly +
        '" font-size="8" font-family="var(--font-mono)" fill="var(--text-3)" text-anchor="middle">' +
        esc(s.k.split(' ')[0].toUpperCase()) +
        '</text>'
      );
    })
    .join('');
  const poly =
    '<polygon points="' +
    pts.map(p => p.join(',')).join(' ') +
    '" fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="var(--accent)" stroke-width="1.4"/>';
  const dots = pts
    .map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2" fill="var(--accent)"/>')
    .join('');
  return grid + axes + poly + dots + labels;
}

/* ---------- mapEntryToR ----------
   Flatten the parsed report blob into the `r` shape consumed by
   renderEvaluated / renderScreened. Field names + fallback expressions
   are stable; both sections rely on this exact shape. */

export function mapEntryToR(entry: ApplicationEntry): ReportR | null {
  const p = (entry.report && entry.report.parsed) || null;
  if (!p) return null;

  return {
    id: 'O' + String(entry.num).padStart(3, '0'),
    num: entry.num,
    status: (entry.status || '').toLowerCase().trim() || p.state || 'screened',
    state: p.state || 'screened',
    company: entry.company ?? '',
    role: entry.role ?? '',
    archetype: p.archetype || '',
    archetype_detail: p.archetype_detail || p.archetype || '',
    date: entry.date,
    // True posting date: tracker row first (the list/detail APIs expose it
    // top-level), report frontmatter as fallback — screen.mjs writes both.
    posted: entry.posted || p.posted || undefined,
    url: p.url || '',
    score: parseFloat(String(entry.score)) || p.score || 0,
    pdf: entry.pdf,
    seniority: p.seniority || '',
    seniority_short: p.seniority_short || '',
    remote: p.remote || '',
    locations: p.locations || '',
    loc_short: p.loc_short || '',
    archetype_short: p.archetype_short || '',
    team: p.team || '',
    comp: p.comp || '',
    compRange: p.comp_short || (p.comp ? shortComp(p.comp) : ''),
    comp_short: p.comp_short || '',
    date_short: p.date_short || '',
    tldr: p.tldr || '',
    cv_match: p.cv_match || [],
    gaps: p.gaps || [],
    verdict: p.verdict || '',
    detected_level: p.detected_level || '',
    natural_level: p.natural_level || '',
    sell_senior: p.sell_senior || [],
    if_downleveled: p.if_downleveled || [],
    comp_points: p.comp_points || [],
    analysis: p.analysis || '',
    demand: p.demand || '',
    comp_verdict: p.comp_verdict || '',
    cv_adjustments: p.cv_adjustments || [],
    linkedin: p.linkedin || [],
    stars: p.stars || [],
    tier: p.tier || 'likely_legitimate',
    notes: p.notes || '',
    score_breakdown: p.score_breakdown || {
      cv_match: 0,
      seniority: 0,
      compensation: 0,
      domain: 0,
      geo: 0,
      legitimacy: 0,
    },
    keywords: p.keywords || [],
    legitimacy: p.tier || p.legitimacy || '',
    sections: p.sections || [],
    cv_pdf_path: entry.cv_pdf_path || null,
    cover_letter_path: entry.cover_letter_path || null,
    outreach: entry.outreach || null,
    outreach_path: entry.outreach_path || null,
    has_company_research: Boolean(entry.has_company_research),
    has_interview_process: Boolean(entry.has_interview_process),
    appended_sections:
      (entry.report && entry.report.parsed && entry.report.parsed.appended_sections) || [],
    format: (p.format as 'frontmatter' | undefined) ?? 'frontmatter',
    body: typeof p.body === 'string' ? p.body : undefined,
    work_mode: (p as { work_mode?: string }).work_mode || '',
    company_logo: (p as { company_logo?: string }).company_logo || '',
    location: (p as { location?: string }).location || '',
    snapshot: (p as { snapshot?: ReportR['snapshot'] }).snapshot,
  };
}

/* ---------- numFromFilename ----------
   Reports are named `NNN-slug-YYYY-MM-DD.md`. Pull the leading integer so
   /report/[filename] can look up the application by num. */

export function numFromFilename(filename: string): number | null {
  // Accept either "NNN-slug-YYYY-MM-DD.md" (legacy filename convention) OR
  // a pure numeric path segment ("5") so drawer/list views can link by num
  // without needing to look up the filename first.
  const m = String(filename || '').match(/^(\d+)(?:-|$)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
