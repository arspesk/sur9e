import { describe, expect, it } from 'vitest';
import {
  coerceSeniority,
  coerceWorkMode,
  VALID_SENIORITY,
  VALID_WORK_MODE,
} from '../report-schema';

describe('coerceSeniority', () => {
  it('passes through canonical enum values', () => {
    for (const s of VALID_SENIORITY) expect(coerceSeniority(s)).toBe(s);
  });
  it('maps common LinkedIn labels to the enum', () => {
    expect(coerceSeniority('Mid-Senior level')).toBe('Senior');
    expect(coerceSeniority('Entry level')).toBe('Junior');
    expect(coerceSeniority('Staff Engineer')).toBe('Staff');
  });
  it('returns empty string for unknown input', () => {
    expect(coerceSeniority('Wizard')).toBe('');
    expect(coerceSeniority(undefined)).toBe('');
  });
});

describe('coerceWorkMode', () => {
  it('maps common phrasings to the enum', () => {
    expect(coerceWorkMode('Remote')).toBe('Remote');
    expect(coerceWorkMode('fully remote')).toBe('Remote');
    expect(coerceWorkMode('On-site')).toBe('On-site');
    expect(coerceWorkMode('in office')).toBe('On-site');
    expect(coerceWorkMode('hybrid')).toBe('Hybrid');
  });
  it('returns empty string for unknown input', () => {
    expect(coerceWorkMode('teleport')).toBe('');
  });
});
