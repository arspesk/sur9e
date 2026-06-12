import type { ApplicationRow } from './table-types';

export interface TableFilterState {
  q: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  score: { min: number; max: number };
  // Salary band in $K (thousands). max at COMP_MAX means "no upper limit".
  comp: { min: number; max: number };
  status: string[];
  archetype: string[];
  seniority: string[];
  work_mode: string[];
  date: string;
}

// Top of the salary slider, in $K. At this value the max edge is treated as
// unbounded so roles above it (staff/principal total comp) still pass.
export const COMP_MAX = 500;

export const DEFAULTS: Readonly<TableFilterState> = Object.freeze({
  q: '',
  sort: Object.freeze({ key: 'score', dir: 'desc' as const }),
  score: Object.freeze({ min: 0, max: 5 }),
  comp: Object.freeze({ min: 0, max: COMP_MAX }),
  status: [] as string[],
  archetype: [] as string[],
  seniority: [] as string[],
  work_mode: [] as string[],
  date: 'all',
});

// Canonical orderings for the two enum columns — mirror VALID_SENIORITY /
// VALID_WORK_MODE in server/report-schema.ts (which is server-only, so we keep
// a client-safe copy here). Exported so the URL parser + filter UI reuse the
// same lists. applySort uses them so sorting follows seniority progression /
// remote→onsite rather than alphabetically.
export const SENIORITY_ORDER = ['Junior', 'Mid', 'Senior', 'Staff', 'Principal'];
export const WORK_MODE_ORDER = ['Remote', 'Hybrid', 'On-site'];

const DAY_MS = 86400000;
const STATUS_ORDER = [
  'screened',
  'evaluated',
  'applied',
  'responded',
  'interview',
  'offer',
  'rejected',
  'discarded',
];

function withinDateWindow(rowDate: string | undefined, window: string, now: Date) {
  if (window === 'all' || !rowDate) return true;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[window as '7d' | '30d' | '90d'];
  if (!days) return true;
  const time = Date.parse(rowDate);
  if (Number.isNaN(time)) return true;
  return time >= now.getTime() - days * DAY_MS;
}

function compMin(value: string | undefined) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

// Parse a free-text comp string into a {min, max} band in $K (thousands), for
// the salary filter. Each number is normalized: a "k" suffix is kept, "m" is
// ×1000, a bare number ≥ 1000 is read as full dollars (÷1000), and anything
// smaller is assumed already in $K. A trailing "+" (e.g. "$200K+") is an
// open-ended max (null). No usable number → {null, null} (e.g. "Competitive").
//   "$130K–$160K" → {130,160} · "$130,000" → {130,130} · "$1.2M" → {1200,1200}
export function parseCompBounds(value: string | null | undefined): {
  min: number | null;
  max: number | null;
} {
  const s = String(value || '');
  // Hourly rates aren't annual bands and would mis-scale ("$95/hr" ≠ $95K), so
  // treat them as unparseable — the row stays visible like "Competitive".
  if (/\/\s*(hr|hour)/i.test(s)) return { min: null, max: null };
  const nums: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const raw = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(raw)) continue;
    const suffix = (m[2] || '').toLowerCase();
    nums.push(suffix === 'k' ? raw : suffix === 'm' ? raw * 1000 : raw >= 1000 ? raw / 1000 : raw);
  }
  if (nums.length === 0) return { min: null, max: null };
  // Open-ended only when "+" directly follows a number/suffix ("$200K+"), not a
  // stray "+" like "(+ equity)".
  const openEnded = /\d[\d,]*(?:\.\d+)?\s*[kKmM]?\+/.test(s);
  return { min: Math.min(...nums), max: openEnded ? null : Math.max(...nums) };
}

// Rank a value within a canonical order array; unknown/blank ⇒ just past the
// last known rank so it sorts to the bottom (asc) / top (desc).
function rankOrEnd(order: string[], value: string | undefined): number {
  const i = order.indexOf((value || '').trim());
  return i === -1 ? order.length : i;
}

export function applyFilters(rows: ApplicationRow[], state: TableFilterState, now = new Date()) {
  const query = (state.q || '').toLowerCase();
  return rows.filter(row => {
    if (query) {
      const haystack = `${row.company || ''} ${row.role || ''} ${row.notes || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    // Unscored offers (score "N/A" → NaN) have no number to test. Keep them
    // visible at the default range (min 0), but exclude them once the user
    // raises the min above 0 — an unscored row can't satisfy a real threshold.
    const score = Number.parseFloat(row.score);
    if (Number.isNaN(score)) {
      if (state.score.min > 0) return false;
    } else if (score < state.score.min || score > state.score.max) {
      return false;
    }
    // Salary: keep offers whose comp band overlaps [min, max] ($K; max at
    // COMP_MAX = no upper limit). Offers with no parseable comp stay visible
    // until the user raises the floor above 0 — same treatment as unscored rows.
    if (state.comp.min > 0 || state.comp.max < COMP_MAX) {
      const ceil = state.comp.max >= COMP_MAX ? Infinity : state.comp.max;
      const { min: jobMin, max: jobMax } = parseCompBounds(row.comp);
      if (jobMin == null && jobMax == null) {
        if (state.comp.min > 0) return false;
      } else {
        const lo = jobMin ?? 0;
        const hi = jobMax ?? Infinity;
        if (hi < state.comp.min || lo > ceil) return false;
      }
    }
    // Filter panel uses lowercase status keys ('screened', 'evaluated', ...);
    // the API returns title-case ('Screened', 'Discarded'). Normalize before
    // comparing so checking "Discarded" + selecting "discarded" actually matches.
    if (state.status.length && !state.status.includes((row.status || '').toLowerCase()))
      return false;
    if (state.archetype.length && !state.archetype.includes(row.archetype || '')) return false;
    // Seniority + work-mode are canonical enum values on both the row
    // (coerced server-side) and the filter, so an exact membership test is
    // correct. Empty selection ⇒ no constraint.
    if (state.seniority.length && !state.seniority.includes(row.seniority || '')) return false;
    if (state.work_mode.length && !state.work_mode.includes(row.work_mode || '')) return false;
    if (!withinDateWindow(row.date, state.date, now)) return false;
    return true;
  });
}

// Valid sort keys: mirrors the column headers defined in table-page.tsx.
// Keys with explicit branches (num, score, date, status, comp) are always
// handled above the else; this allowlist guards the string-compare branch.
const SORT_KEY_ALLOWLIST = new Set([
  'num',
  'company',
  'role',
  'status',
  'score',
  'comp',
  'loc',
  'archetype',
  'seniority',
  'work_mode',
  'date',
  'posted',
]);

// Posted sort (posted-date spec, 2026-06-10): rows WITHOUT a true posting
// date always sink to the bottom in BOTH directions — missing means
// unknown, not oldest. Within the missing group fall back to added-date
// desc so the tail stays stable and useful.
function comparePosted(a: ApplicationRow, b: ApplicationRow, multiplier: number): number {
  const ap = Date.parse(a.posted ?? '');
  const bp = Date.parse(b.posted ?? '');
  const aMissing = Number.isNaN(ap);
  const bMissing = Number.isNaN(bp);
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (aMissing) {
    const ad = Date.parse(a.date);
    const bd = Date.parse(b.date);
    return (
      (Number.isNaN(bd) ? Number.NEGATIVE_INFINITY : bd) -
      (Number.isNaN(ad) ? Number.NEGATIVE_INFINITY : ad)
    );
  }
  return (ap - bp) * multiplier;
}

export function applySort(rows: ApplicationRow[], sort: TableFilterState['sort']) {
  // Unknown sort keys fall back to num desc to avoid arbitrary ordering.
  const safeSort = SORT_KEY_ALLOWLIST.has(sort.key) ? sort : { key: 'num', dir: 'desc' as const };
  const multiplier = safeSort.dir === 'asc' ? 1 : -1;
  const numericEnd = multiplier === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const stringEnd = multiplier === 1 ? '￿' : '';

  // Posted needs its own comparator: the missing group is pinned to the
  // bottom regardless of direction, which the shared av/bv + multiplier
  // pattern below can't express.
  if (safeSort.key === 'posted') {
    return rows.slice().sort((a, b) => comparePosted(a, b, multiplier));
  }

  return rows.slice().sort((a, b) => {
    let av: number | string;
    let bv: number | string;

    if (safeSort.key === 'num') {
      av = Number(a.num) || 0;
      bv = Number(b.num) || 0;
    } else if (safeSort.key === 'score') {
      // Unscored offers (N/A → NaN) sort to the end, same as date/comp, so
      // they don't interleave with genuine 0.0 scores.
      av = Number.parseFloat(a.score);
      bv = Number.parseFloat(b.score);
      if (Number.isNaN(av)) av = numericEnd;
      if (Number.isNaN(bv)) bv = numericEnd;
    } else if (safeSort.key === 'date') {
      av = Date.parse(a.date);
      bv = Date.parse(b.date);
      if (Number.isNaN(av)) av = numericEnd;
      if (Number.isNaN(bv)) bv = numericEnd;
    } else if (safeSort.key === 'status') {
      // The API returns title-case statuses ('Screened', 'Discarded') while
      // STATUS_ORDER holds lowercase keys — normalize like the filter above,
      // ranking unknown statuses to the end like seniority/work_mode.
      av = rankOrEnd(STATUS_ORDER, (a.status || '').toLowerCase());
      bv = rankOrEnd(STATUS_ORDER, (b.status || '').toLowerCase());
    } else if (safeSort.key === 'seniority') {
      // Rank by seniority progression; unknown/blank sort to the end.
      av = rankOrEnd(SENIORITY_ORDER, a.seniority);
      bv = rankOrEnd(SENIORITY_ORDER, b.seniority);
    } else if (safeSort.key === 'work_mode') {
      av = rankOrEnd(WORK_MODE_ORDER, a.work_mode);
      bv = rankOrEnd(WORK_MODE_ORDER, b.work_mode);
    } else if (safeSort.key === 'comp') {
      av = compMin(a.comp);
      bv = compMin(b.comp);
      if (Number.isNaN(av)) av = numericEnd;
      if (Number.isNaN(bv)) bv = numericEnd;
    } else {
      av = String(
        (a as unknown as Record<string, string | undefined>)[safeSort.key] || stringEnd,
      ).toLowerCase();
      bv = String(
        (b as unknown as Record<string, string | undefined>)[safeSort.key] || stringEnd,
      ).toLowerCase();
    }

    if (av < bv) return -1 * multiplier;
    if (av > bv) return 1 * multiplier;
    return 0;
  });
}
