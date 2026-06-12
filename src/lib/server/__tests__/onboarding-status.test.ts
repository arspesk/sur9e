// Unit tests for the first-run setup detection (onboarding-status.ts).
// Uses throwaway temp dirs only — never reads the real inputs/ tree.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getOnboardingStatus, onboardingSetupMessage } from '../onboarding-status';

let root: string;

function makeRoot(files: { cv?: boolean; profile?: boolean }): string {
  root = mkdtempSync(join(tmpdir(), 'sur9e-onboarding-'));
  const dir = join(root, 'inputs', 'personalization');
  mkdirSync(dir, { recursive: true });
  if (files.cv) writeFileSync(join(dir, 'cv.md'), '# CV\n');
  if (files.profile) writeFileSync(join(dir, 'profile.yml'), 'name: Test\n');
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('getOnboardingStatus', () => {
  it('is ready when both cv.md and profile.yml exist', () => {
    const status = getOnboardingStatus(makeRoot({ cv: true, profile: true }));
    expect(status).toEqual({ ready: true, missing: [] });
  });

  it('reports cv missing when only profile.yml exists', () => {
    const status = getOnboardingStatus(makeRoot({ profile: true }));
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual(['cv']);
  });

  it('reports profile missing when only cv.md exists', () => {
    const status = getOnboardingStatus(makeRoot({ cv: true }));
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual(['profile']);
  });

  it('reports both missing on a bare root (fresh install)', () => {
    const status = getOnboardingStatus(makeRoot({}));
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual(['cv', 'profile']);
  });

  it('reports both missing when inputs/personalization does not exist at all', () => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-onboarding-'));
    const status = getOnboardingStatus(root);
    expect(status.ready).toBe(false);
    expect(status.missing).toEqual(['cv', 'profile']);
  });
});

describe('onboardingSetupMessage', () => {
  it('names the single missing file with singular grammar', () => {
    const msg = onboardingSetupMessage(['cv']);
    expect(msg).toContain('inputs/personalization/cv.md');
    expect(msg).toContain('is missing');
    expect(msg).not.toContain('profile.yml');
  });

  it('names both files with plural grammar', () => {
    const msg = onboardingSetupMessage(['cv', 'profile']);
    expect(msg).toContain('inputs/personalization/cv.md');
    expect(msg).toContain('inputs/personalization/profile.yml');
    expect(msg).toContain('are missing');
  });

  it('always carries the onboarding next step', () => {
    for (const missing of [['cv'], ['profile'], ['cv', 'profile']] as const) {
      const msg = onboardingSetupMessage([...missing]);
      expect(msg).toMatch(/AI coding agent/);
      expect(msg).toMatch(/Profile page/);
    }
  });
});
