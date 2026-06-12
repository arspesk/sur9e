// src/lib/server/__tests__/profile-load-error.test.ts
//
// Fail-soft contract for inputs/personalization/profile.yml:
//   missing/empty file  → { profile: null, error: null }   (fresh install)
//   valid file          → { profile, error: null }
//   unparseable file    → { profile: null, error: {path, message, line} }
// loadProfile degrades to null so enrichment callers (findByNum,
// /api/profile) never 500; saveProfile refuses to overwrite an
// existing-but-unreadable file (silent data loss otherwise).
//
// All fixtures live in os.tmpdir() — never touches the real inputs/.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfile, loadProfileResult, saveProfile } from '../profile';

const PROFILE_REL = 'inputs/personalization/profile.yml';

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'profile-load-error-'));
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  return root;
}

describe('loadProfileResult — fail-soft profile.yml loader', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
    // The loader warns on parse failure by design; keep test output clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('missing file → null profile, NO error (fresh-install behavior)', () => {
    expect(loadProfileResult(root)).toEqual({ profile: null, error: null });
    expect(loadProfile(root)).toBeNull();
  });

  it('empty file → null profile, NO error', () => {
    writeFileSync(join(root, PROFILE_REL), '');
    expect(loadProfileResult(root)).toEqual({ profile: null, error: null });
  });

  it('valid file → parsed profile, no error', () => {
    writeFileSync(join(root, PROFILE_REL), 'candidate:\n  full_name: Ada Lovelace\n');
    const { profile, error } = loadProfileResult(root);
    expect(error).toBeNull();
    expect(profile?.candidate?.full_name).toBe('Ada Lovelace');
  });

  it('malformed YAML → null profile + structured error with path and 1-based line', () => {
    writeFileSync(join(root, PROFILE_REL), 'candidate:\n  full_name: "unterminated\n');
    const { profile, error } = loadProfileResult(root);
    expect(profile).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.path).toBe(PROFILE_REL);
    expect(error?.message).toContain('unexpected end of the stream');
    expect(error?.message).not.toContain('\n'); // banner-sized, no code frame
    expect(error?.line).toBe(3);
    // The plain loader degrades instead of throwing — offer-detail
    // enrichment (findByNum) and /api/profile keep working.
    expect(loadProfile(root)).toBeNull();
  });

  it('schema-invalid YAML → error names the offending key (zod path)', () => {
    writeFileSync(join(root, PROFILE_REL), 'candidate:\n  full_name: 123\n');
    const { profile, error } = loadProfileResult(root);
    expect(profile).toBeNull();
    expect(error?.path).toBe(PROFILE_REL);
    expect(error?.message).toContain('candidate.full_name');
  });
});

describe('saveProfile — refuses to overwrite an unreadable profile.yml', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('throws and leaves the file byte-identical when it exists but fails to parse', () => {
    const abs = join(root, PROFILE_REL);
    const broken = 'candidate:\n  full_name: "unterminated\n';
    writeFileSync(abs, broken);
    expect(() => saveProfile(root, { candidate: { full_name: 'New Name' } })).toThrow(
      /refusing to save profile/,
    );
    expect(readFileSync(abs, 'utf-8')).toBe(broken);
  });

  it('still saves normally when the file is missing or valid', () => {
    saveProfile(root, { candidate: { full_name: 'Ada Lovelace' } });
    expect(loadProfileResult(root).profile?.candidate?.full_name).toBe('Ada Lovelace');
    saveProfile(root, { candidate: { full_name: 'Grace Hopper' } });
    expect(loadProfileResult(root).profile?.candidate?.full_name).toBe('Grace Hopper');
  });
});
