// src/lib/server/__tests__/reports-parsers.test.ts
//
// Report schema invariants — validateReport caps/defaults plus the
// legitTierLabel display helper (canonical home: @/lib/scoring). The legacy
// parseScreened / parseEvaluated parser tests were removed with the legacy
// report format.

import { describe, expect, it } from 'vitest';
import { legitTierBand, legitTierLabel } from '@/lib/scoring';
import { validateReport } from '../report-schema';

// ── validateReport ───────────────────────────────────────────────────────────

describe('validateReport', () => {
  it('caps cv_match at 8', () => {
    const overflow = {
      cv_match: new Array(20).fill({ jd: 'j', cv: 'c', strength: 'direct' }),
    };
    const validated = validateReport(overflow);
    expect((validated.cv_match as unknown[]).length).toBe(8);
  });

  it('short field truncates with ellipsis at 24 chars', () => {
    const overflow = validateReport({ archetype_short: 'X'.repeat(50) });
    expect((overflow.archetype_short as string).length).toBe(24);
    expect((overflow.archetype_short as string).endsWith('…')).toBe(true);
  });
});

// ── legitTierLabel ────────────────────────────────────────────────────────────

describe('legitTierLabel', () => {
  it('maps enum values to confidence-axis labels', () => {
    expect(legitTierLabel('high_confidence')).toBe('High confidence');
    expect(legitTierLabel('likely_legitimate')).toBe('High confidence');
    expect(legitTierLabel('uncertain')).toBe('Medium confidence');
    expect(legitTierLabel('suspicious')).toBe('Low confidence');
    expect(legitTierLabel('scam')).toBe('Scam');
  });

  it('maps the screener confidence enums (the dominant values in real data)', () => {
    expect(legitTierLabel('low_confidence')).toBe('Low confidence');
    expect(legitTierLabel('medium_confidence')).toBe('Medium confidence');
  });
});

describe('legitTierBand', () => {
  it('bands tiers to chip colors: good / warn / bad', () => {
    expect(legitTierBand('high_confidence')).toBe('good');
    expect(legitTierBand('likely_legitimate')).toBe('good');
    expect(legitTierBand('medium_confidence')).toBe('warn');
    expect(legitTierBand('uncertain')).toBe('warn');
    expect(legitTierBand('low_confidence')).toBe('bad');
    expect(legitTierBand('suspicious')).toBe('bad');
    expect(legitTierBand('scam')).toBe('bad');
  });

  it('unknown or missing tier → warn (never green for unvouched values)', () => {
    expect(legitTierBand('')).toBe('warn');
    expect(legitTierBand(null)).toBe('warn');
    expect(legitTierBand('something_else')).toBe('warn');
  });
});
