// Single source of truth for evaluation-score tiers and their highlight
// colors. Framework-free (no React/Node) so both the client ScoreChip and the
// server report-markdown normalizer import it without drift.

export type ScoreTier = 'high' | 'mid' | 'low';

/** Tier thresholds (0-5 scale). Mirrors the historical ScoreChip cutoffs. */
export function scoreLevel(score: number): ScoreTier {
  if (score >= 4.0) return 'high';
  if (score >= 3.0) return 'mid';
  return 'low';
}

/** Highlight backgrounds drawn from the editor's BG_COLORS palette. */
export const TIER_MARK_COLOR: Record<ScoreTier, string> = {
  high: 'rgba(68,131,97,0.32)', // green
  mid: 'rgba(203,145,47,0.32)', // yellow
  low: 'rgba(212,76,71,0.28)', // red
};

/**
 * Map a legitimacy tier enum to a human-readable confidence label.
 * Single source of truth shared by the report hero (client) and the
 * server report-markdown normalizer.
 *
 * UX audit M4 collapsed two parallel pill vocabularies ("Likely Legitimate"
 * vs "High Confidence") into a single confidence axis. The 5 tiers still
 * exist in evaluator output; we project them onto Low / Medium / High
 * confidence here. "Scam" stays as its own label because it's a safety
 * flag, not a confidence band.
 *
 * Legacy reports that store the display string in the header ("**Legitimacy:**
 * Likely Legitimate") fall through the enum table; we also map those raw
 * strings so old reports render the new vocabulary instead of the old one.
 */
export function legitTierLabel(t: string | null | undefined): string {
  if (typeof t !== 'string') return '';
  const map: Record<string, string> = {
    high_confidence: 'High confidence',
    likely_legitimate: 'High confidence',
    medium_confidence: 'Medium confidence',
    uncertain: 'Medium confidence',
    low_confidence: 'Low confidence',
    suspicious: 'Low confidence',
    scam: 'Scam',
    // Legacy header-string aliases so reports authored before the M4
    // collapse still render the new label.
    'High Confidence': 'High confidence',
    'Likely Legitimate': 'High confidence',
    Uncertain: 'Medium confidence',
    Suspicious: 'Low confidence',
    Scam: 'Scam',
  };
  return map[t] || t;
}

export type LegitBand = 'good' | 'warn' | 'bad';

/**
 * Map a legitimacy tier to its color band so confidence chips render
 * tier-based colors (green / amber / red) instead of a flat green.
 * Unknown or missing tiers band as 'warn' — honest uncertainty: never a
 * green chip for a value we can't vouch for.
 */
export function legitTierBand(t: string | null | undefined): LegitBand {
  const label = legitTierLabel(t);
  if (label === 'High confidence') return 'good';
  if (label === 'Low confidence' || label === 'Scam') return 'bad';
  return 'warn';
}
