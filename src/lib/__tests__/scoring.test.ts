import { describe, expect, it } from 'vitest';
import { scoreLevel, TIER_MARK_COLOR } from '@/lib/scoring';

describe('scoreLevel', () => {
  it('maps to tiers at the established thresholds', () => {
    expect(scoreLevel(5.0)).toBe('high');
    expect(scoreLevel(4.0)).toBe('high');
    expect(scoreLevel(3.9)).toBe('mid');
    expect(scoreLevel(3.0)).toBe('mid');
    expect(scoreLevel(2.9)).toBe('low');
    expect(scoreLevel(0)).toBe('low');
  });
  it('exposes a highlight color per tier', () => {
    expect(TIER_MARK_COLOR.high).toBe('rgba(68,131,97,0.32)');
    expect(TIER_MARK_COLOR.mid).toBe('rgba(203,145,47,0.32)');
    expect(TIER_MARK_COLOR.low).toBe('rgba(212,76,71,0.28)');
  });
});
