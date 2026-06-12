import { describe, expect, it } from 'vitest';
import { parsePositiveInt } from '../src/lib/http-errors';

describe('parsePositiveInt', () => {
  it('accepts clean positive integers', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt('447')).toBe(447);
    expect(parsePositiveInt(' 42 ')).toBe(42);
  });

  it('rejects empty / undefined input', () => {
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt('   ')).toBeNull();
  });

  it('rejects zero and negatives', () => {
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-5')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parsePositiveInt('abc')).toBeNull();
  });

  it('rejects trailing-garbage and decimals instead of coercing', () => {
    // Regression: Number.parseInt would coerce these to 447 / 3.
    expect(parsePositiveInt('447abc')).toBeNull();
    expect(parsePositiveInt('3.5')).toBeNull();
    expect(parsePositiveInt('12px')).toBeNull();
    expect(parsePositiveInt('1e3')).toBeNull();
    expect(parsePositiveInt('0x10')).toBeNull();
  });
});
