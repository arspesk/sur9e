// SPDX-License-Identifier: MIT
// batch/lib/job-filter.mjs
//
// Shared title + location sieves for BOTH scanners (scan-portals.mjs ATS feeds
// and scan-jobspy.mjs job boards), so the filtering can't drift between them.
// Both are derived from the user's profile.yml — no separate filter config.
//
// - Title: positive-only. A posting title must contain at least one
//   `search.terms` keyword (punctuation-normalized, case-insensitive). Empty
//   terms list = no sieve (every title passes).
// - Location: derived from `location.{onsite_availability, location_flexibility,
//   country}` + `search.locations` — the same fields JobSpy already crawls by.

// Lower-case, strip separating punctuation, collapse whitespace. Used for both
// the title keywords and the titles they're matched against.
export function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[-/_,()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a positive-only title matcher from a profile.
 * @returns {(title: string) => boolean}
 */
export function buildTitleMatcher(profile) {
  const terms = (profile?.search?.terms ?? [])
    .filter(t => String(t).trim())
    .map(t => normalizeTitle(String(t)));
  return title => {
    if (terms.length === 0) return true;
    const norm = normalizeTitle(title);
    return terms.some(term => norm.includes(term));
  };
}

const lc = s => String(s).toLowerCase().trim();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// True when `keyword` appears in `haystack` bounded by non-alphanumerics (or
// the string edges), so short keywords don't match inside longer words:
// "us" must not match "australia", "india" must not match "indianapolis".
// Both args are already lower-cased.
function wordIn(haystack, keyword) {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(keyword)}(?:[^a-z0-9]|$)`).test(haystack);
}

/**
 * Build a location matcher from a profile. Case-insensitive substring matching
 * against the posting's location string. Semantics:
 *   - `location_flexibility: open` → no location filtering (everything passes).
 *   - empty / non-string posting location → pass (don't penalize missing or
 *     malformed provider data).
 *   - `onsite_availability` is remote (or the catch-all open) → any location
 *     mentioning "remote" passes (the candidate takes remote anywhere); hybrid
 *     and onsite still require a location match.
 *   - otherwise the location must match an allow keyword:
 *       · `strict`   → only `search.locations` (specific cities/regions)
 *       · `flexible` → `search.locations` + `location.country` (country-wide)
 *   - no allow keywords configured → pass (nothing to constrain on).
 *
 * @returns {(location: string) => boolean}
 */
export function buildLocationMatcher(profile) {
  const loc = profile?.location ?? {};
  const flexibility = lc(loc.location_flexibility || 'strict');
  if (flexibility === 'open') return () => true;

  // Only 'remote' (and the catch-all 'open') treat a remote posting as an
  // automatic pass; 'hybrid'/'onsite' candidates still need a location match —
  // matching how scan-jobspy.py reads onsite_availability.
  const remoteOk = ['remote', 'open'].includes(lc(loc.onsite_availability || 'open'));
  const specific = (profile?.search?.locations ?? [])
    .filter(s => typeof s === 'string' && s.trim())
    .map(lc);
  const country = typeof loc.country === 'string' && loc.country.trim() ? lc(loc.country) : '';
  const allow = flexibility === 'flexible' && country ? [...specific, country] : specific;

  return location => {
    if (typeof location !== 'string' || location.trim() === '') return true;
    const lower = location.toLowerCase();
    if (remoteOk && wordIn(lower, 'remote')) return true;
    if (allow.length === 0) return true;
    return allow.some(k => wordIn(lower, k));
  };
}
