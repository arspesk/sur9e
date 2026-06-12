import { expect, test } from 'vitest';
import { companySlug, shortComp, shortLoc, shortSeniority } from '../format';

test('shortLoc — returns "Remote" for remote-only', () => {
  expect(shortLoc('remote', '')).toBe('Remote');
});
test('shortLoc — returns "Hybrid" for hybrid', () => {
  expect(shortLoc('Hybrid', 'NYC')).toBe('Hybrid');
});
test('shortLoc — returns "On-site" fallback', () => {
  expect(shortLoc('On-site', '')).toBe('On-site');
});
test('shortLoc — returns first clean phrase of locations', () => {
  expect(shortLoc('', 'San Francisco, CA, USA')).toBe('San Francisco');
});
test('shortLoc — remote with single recognizable city shows the city', () => {
  expect(shortLoc('remote', 'Berlin')).toBe('Berlin');
});

test('shortComp — parses K range', () => {
  expect(shortComp('$120K - $160K')).toBe('$120K–$160K');
});
test('shortComp — returns "Up to" for single value', () => {
  expect(shortComp('$140,000')).toContain('Up to');
});
test('shortComp — returns em-dash for falsy', () => {
  expect(shortComp(null)).toBe('—');
});

test('shortSeniority — returns truncated first segment', () => {
  expect(shortSeniority('Senior — IC4')).toBe('Senior');
});
test('shortSeniority — returns em-dash for empty', () => {
  expect(shortSeniority('')).toBe('—');
});

test('companySlug — lowercase ASCII pass-through', () => {
  expect(companySlug('Sitetracker')).toBe('sitetracker');
});
test('companySlug — spaces become dashes', () => {
  expect(companySlug('Carter Maddox')).toBe('carter-maddox');
});
test('companySlug — punctuation stripped', () => {
  expect(companySlug('TruMed Systems, Inc.')).toBe('trumed-systems-inc');
});
test('companySlug — accents folded', () => {
  expect(companySlug('Cañón Café')).toBe('canon-cafe');
});
test('companySlug — symbols folded', () => {
  expect(companySlug('NetFortris® / Sangoma')).toBe('netfortris-sangoma');
});
test('companySlug — collapsed dashes + trim', () => {
  expect(companySlug('  --M Moser--  ')).toBe('m-moser');
});
test('companySlug — empty string passes through', () => {
  expect(companySlug('')).toBe('');
});
