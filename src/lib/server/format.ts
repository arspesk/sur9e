// src/lib/server/format.ts
//
// Browser-safe formatting helpers — implementation inlined from format.mjs.
// Pure functions, no schemas required.

const REMOTE_RE = /^(remote|fully remote|yes|true|remote-?first)$/i;
const HYBRID_RE = /^(hybrid)/i;
const ONSITE_RE = /^(on[-\s]?site|in[-\s]?office|no|false)$/i;

function asStr(v: string | boolean | string[] | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Remote' : 'On-site';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v);
}

function firstClean(s: string | null | undefined): string {
  // Take the first phrase (split on ',' '(' '—' '·'), strip trailing punctuation,
  // cap at 16 chars without ending mid-word.
  const piece = String(s ?? '')
    .split(/[,(\—·]/)[0]
    .trim()
    .replace(/[.\s]+$/, '');
  if (piece.length <= 16) return piece;
  return piece.slice(0, 16).replace(/\s\S*$/, ''); // cut at last whitespace within 16
}

export function shortLoc(
  remote: string | boolean | null | undefined,
  locations: string | string[] | null | undefined,
): string {
  const r = asStr(remote).trim();
  const loc = asStr(locations).trim();
  // For remote-like roles, default to "Remote" — only show a city if locations
  // contains a single, recognizable place (≥4 chars, no commas, looks like a name).
  if (REMOTE_RE.test(r)) {
    const first = firstClean(loc);
    return first.length >= 4 && !loc.includes(',') && /^[A-Z]/.test(first) ? first : 'Remote';
  }
  if (ONSITE_RE.test(r)) return firstClean(loc) || 'On-site';
  if (HYBRID_RE.test(r)) return 'Hybrid';
  // r is a phrase like "Fully remote · 25% travel"
  if (r) return firstClean(r);
  return firstClean(loc) || '—';
}

export function shortComp(s: string | null | undefined): string {
  if (!s) return '—';
  const str = String(s);
  // Match $X(K|M)? – $Y(K|M)? variants
  const range = str.match(
    /\$\s*(\d{1,3}(?:,\d{3})*|\d+)\s*([Kk]|[Mm])?\s*[\-–—to]+\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*([Kk]|[Mm])?/,
  );
  if (range) {
    const lo = compactNum(range[1], range[2]);
    const hi = compactNum(range[3], range[4]);
    return `${lo}–${hi}`;
  }
  // Single dollar: "Up to $200K"
  const single = str.match(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)\s*([Kk]|[Mm])?/);
  if (single) {
    return `Up to ${compactNum(single[1], single[2])}`;
  }
  return str.slice(0, 14);
}

function compactNum(raw: string, suffix: string | undefined): string {
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  if (!Number.isFinite(n)) return '$0';
  if (suffix) return `$${n}${suffix.toUpperCase()}`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

export function shortSeniority(s: string | null | undefined): string {
  if (!s) return '—';
  return String(s).split(/[—(]/)[0].trim().slice(0, 14) || '—';
}

export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  try {
    // For "YYYY-MM-DD" strings, parse as local date to avoid UTC timezone drift.
    const ymd = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dt = ymd
      ? new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10))
      : new Date(d as string);
    if (Number.isNaN(dt.getTime())) return String(d).slice(0, 8);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (_e) {
    return String(d).slice(0, 8);
  }
}

/**
 * Lowercase, ASCII-folded, dash-separated slug for a company name. Single source
 * of truth shared between mode prompts (which name the output PDFs) and the
 * backend artifact glob (which finds those PDFs by name).
 *
 * Rule: lowercase → NFD normalize → strip combining marks → non-alphanumerics
 * become single dashes → trim leading/trailing dashes.
 */
export function companySlug(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
