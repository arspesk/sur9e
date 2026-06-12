// lib/schemas/__tests__/modes.test.ts
//
// Unit tests for the ModeFrontMatter zod schema. Covers happy path
// (fully-specified front-matter), defaults (empty object → fully-populated
// tree), and rejection of unknown enum values for both `exec` and
// `needs_tools`.

import { describe, expect, it } from 'vitest';
import { ModeFrontMatter, ModeFrontMatterDefaults } from '../modes';

describe('ModeFrontMatter', () => {
  it('accepts a fully-specified front-matter', () => {
    const parsed = ModeFrontMatter.parse({
      exec: 'headless',
      default_platform: 'claude',
      default_model: 'claude-sonnet-4-6',
      needs_tools: ['shell', 'file_read', 'web_search'],
    });
    expect(parsed.exec).toBe('headless');
    expect(parsed.needs_tools).toContain('web_search');
  });

  it('fills defaults when empty object passed', () => {
    const parsed = ModeFrontMatter.parse({});
    expect(parsed).toEqual(ModeFrontMatterDefaults);
    expect(parsed.exec).toBe('interactive');
    expect(parsed.default_platform).toBe('claude');
    // NEW — explicit literals so the test fails if defaults drift in lockstep:
    expect(parsed.default_model).toBe('claude-sonnet-4-6');
    expect(parsed.needs_tools).toEqual([]);
  });

  it('rejects unknown exec value', () => {
    expect(() => ModeFrontMatter.parse({ exec: 'magic' })).toThrow();
  });

  it('rejects unknown tool in needs_tools', () => {
    expect(() => ModeFrontMatter.parse({ needs_tools: ['quantum'] })).toThrow();
  });

  it('rejects unknown front-matter keys (strict mode)', () => {
    expect(() => ModeFrontMatter.parse({ unknown_key: 'x' })).toThrow();
  });

  it('rejects empty default_model', () => {
    expect(() => ModeFrontMatter.parse({ default_model: '' })).toThrow();
  });
});
