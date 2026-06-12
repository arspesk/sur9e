// test/mode-runner-slug.test.mjs
import { describe, expect, it } from 'vitest';
import { companySlug, kebabName } from '../batch/lib/slug.mjs';

describe('companySlug (must match src/lib/server/format.ts)', () => {
  it.each([
    ['Otter.ai', 'otter-ai'],
    ['TruMed Systems, Inc.', 'trumed-systems-inc'],
    ['Sitetracker', 'sitetracker'],
    ['Café Müller GmbH', 'cafe-muller-gmbh'],
    ['  --Acme--  ', 'acme'],
    [null, ''],
  ])('%s → %s', (input, expected) => {
    expect(companySlug(input)).toBe(expected);
  });
});

describe('kebabName', () => {
  it('normalizes a candidate name for PDF filenames', () => {
    expect(kebabName('John Doe')).toBe('john-doe');
    expect(kebabName('José Núñez')).toBe('jose-nunez');
  });
});
