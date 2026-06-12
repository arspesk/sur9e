// src/features/profile/__tests__/profile-form-regression.test.tsx
//
// Validation parity test: asserts that ProfileFormSchema produces the same
// 6 required-field error paths as the legacy REQUIRED_FIELDS array.
// The cv-content rule is tested in the orchestrator (it's outside Zod).

import { describe, expect, it } from 'vitest';
import { ProfileFormSchema } from '../schemas';

describe('Profile form validation parity', () => {
  it('empty profile produces all 6 required-field errors', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: '', email: '' },
      target_roles: { archetypes: [] },
      search: { terms: [], locations: [] },
      compensation: { target_range: '' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join('.'));
      expect(paths).toContain('candidate.full_name');
      expect(paths).toContain('candidate.email');
      expect(paths).toContain('target_roles.archetypes');
      expect(paths).toContain('search.terms');
      expect(paths).toContain('search.locations');
      expect(paths).toContain('compensation.target_range');
    }
  });

  it('complete profile passes validation', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: 'Alice', email: 'a@b.co' },
      target_roles: { archetypes: [{ name: 'foo', level: 'senior', fit: 'primary' }] },
      search: { terms: ['react'], locations: ['Remote'] },
      compensation: { target_range: '$200k-250k' },
    });
    expect(result.success).toBe(true);
  });

  it('invalid email produces clean error message', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: 'Alice', email: 'not-an-email' },
      target_roles: { archetypes: [{ name: 'foo' }] },
      search: { terms: ['x'], locations: ['Remote'] },
      compensation: { target_range: '$200k' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailErr = result.error.issues.find(i => i.path.join('.') === 'candidate.email');
      expect(emailErr?.message).toBe('Invalid email');
    }
  });

  it('missing archetypes produces "At least one archetype required"', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: 'Alice', email: 'a@b.co' },
      target_roles: { archetypes: [] },
      search: { terms: ['react'], locations: ['Remote'] },
      compensation: { target_range: '$200k' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find(i => i.path.join('.') === 'target_roles.archetypes');
      expect(err?.message).toBe('At least one archetype required');
    }
  });

  it('missing search terms produces "At least one search keyword required"', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: 'Alice', email: 'a@b.co' },
      target_roles: { archetypes: [{ name: 'foo' }] },
      search: { terms: [], locations: ['Remote'] },
      compensation: { target_range: '$200k' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find(i => i.path.join('.') === 'search.terms');
      expect(err?.message).toBe('At least one search keyword required');
    }
  });

  it('missing locations produces "At least one search location required"', () => {
    const result = ProfileFormSchema.safeParse({
      candidate: { full_name: 'Alice', email: 'a@b.co' },
      target_roles: { archetypes: [{ name: 'foo' }] },
      search: { terms: ['react'], locations: [] },
      compensation: { target_range: '$200k' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find(i => i.path.join('.') === 'search.locations');
      expect(err?.message).toBe('At least one search location required');
    }
  });
});
