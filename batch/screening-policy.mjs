// SPDX-License-Identifier: MIT
export function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-/_,()[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildScreeningPolicy(settings = {}, profile = {}) {
  const rawTerms = profile?.search?.terms || [];
  const searchTerms = Array.isArray(rawTerms)
    ? rawTerms.map(term => normalizeTitle(term)).filter(Boolean)
    : [];

  return {
    scoreThreshold: Math.max(0, toFiniteNumber(settings?.advanced?.score_threshold, 0)),
    searchTerms,
  };
}

export function metadataPrefilter(offer, policy) {
  const title = normalizeTitle(offer?.title);
  if (!title || !policy?.searchTerms?.length) return { action: 'screen' };

  const matchesTargetTerm = policy.searchTerms.some(term => title.includes(term));
  if (matchesTargetTerm) return { action: 'screen' };

  return {
    action: 'discard',
    reason: 'title does not match target search terms',
  };
}

export function parseScore(score) {
  const m = String(score || '').match(/(\d+(?:\.\d+)?)\s*\/?\s*5?/);
  return m ? Number(m[1]) : null;
}

export function shouldWriteFullReport(score, threshold) {
  const t = toFiniteNumber(threshold, 0);
  if (t <= 0) return true;
  const parsed = parseScore(score);
  if (parsed == null) return true;
  return parsed >= t;
}
