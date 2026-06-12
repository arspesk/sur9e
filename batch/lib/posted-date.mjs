// SPDX-License-Identifier: MIT
// Shared posting-date normalization for the scanners (scan-portals.mjs,
// scan-jobspy.mjs). Every source reports the true posting date in a different
// shape — ISO datetime (Greenhouse/Ashby), date-only string (Workable,
// JobSpy CSV), epoch milliseconds (Lever), relative human text (Workday) —
// and everything funnels through here into the one canonical `YYYY-MM-DD`
// form the rest of the pipeline carries as the optional `posted` field.
//
// Contract: absent/invalid input yields `undefined` so the field is omitted
// entirely downstream — never an empty string, never a fabricated date.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sanity window: anything outside this range is treated as garbage input
// (epoch-zero artifacts, misparsed numbers), not a real posting date.
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

/**
 * True when `s` is a real calendar date in `YYYY-MM-DD` form (round-trips
 * through Date, so `2026-02-31` is rejected) within the sanity window.
 */
export function isValidIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const year = parseInt(s.slice(0, 4), 10);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Round-trip: JS rolls invalid days over (2026-02-31 → March), so the
  // re-serialized date must equal the input to count as real.
  return new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * Normalize a source-provided posting date to `YYYY-MM-DD`.
 *
 * Accepts:
 *  - `YYYY-MM-DD` (taken verbatim — no timezone math that could shift the day)
 *  - ISO datetimes with any offset (`2026-06-09T07:00:30-04:00` → `2026-06-09`,
 *    the calendar-date prefix, again avoiding cross-midnight UTC shifts)
 *  - epoch milliseconds (Lever `createdAt`) → UTC calendar date
 *  - Date instances (js-yaml parses unquoted dates into Date objects)
 *
 * Anything else — empty, unparseable, out of the sanity window — returns
 * `undefined`.
 */
export function toIsoDate(value) {
  if (value == null || value === '') return undefined;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const s = value.toISOString().slice(0, 10);
    return isValidIsoDate(s) ? s : undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    const s = d.toISOString().slice(0, 10);
    return isValidIsoDate(s) ? s : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Calendar-date prefix wins: a datetime with an offset must not have its
    // calendar day shifted by conversion to UTC.
    const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})([T ]|$)/);
    if (m) return isValidIsoDate(m[1]) ? m[1] : undefined;
    const t = Date.parse(trimmed);
    if (Number.isNaN(t)) return undefined;
    const s = new Date(t).toISOString().slice(0, 10);
    return isValidIsoDate(s) ? s : undefined;
  }

  return undefined;
}

/**
 * Parse Workday's human `postedOn` text ("Posted Today", "Posted Yesterday",
 * "Posted 3 Days Ago", "Posted 30+ Days Ago") into `YYYY-MM-DD`, resolved
 * against the scan date. Best-effort: the `N+` form is a lower bound, so the
 * resolved date is the NEWEST the posting could be. Unparseable text (or an
 * invalid scan date) returns `undefined` — the field is omitted.
 */
export function parseWorkdayPostedOn(text, scanDate) {
  if (typeof text !== 'string' || !isValidIsoDate(scanDate)) return undefined;
  const s = text.trim();

  let daysAgo;
  if (/\btoday\b/i.test(s)) daysAgo = 0;
  else if (/\byesterday\b/i.test(s)) daysAgo = 1;
  else {
    const m = s.match(/\b(\d+)\+?\s+days?\s+ago\b/i);
    if (!m) return undefined;
    daysAgo = parseInt(m[1], 10);
  }
  if (!Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > 3650) return undefined;

  const base = Date.parse(`${scanDate}T00:00:00Z`);
  const d = new Date(base - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
