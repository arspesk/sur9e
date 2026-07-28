import { describe, expect, it } from 'vitest';
import {
  isSystemPath,
  isUserPath,
  normalizeRepoPath,
  privateTrackedPaths,
  SYSTEM_PATHS,
  TRACKED_SCAFFOLDING,
  USER_PATH_FILES,
  USER_PATH_PREFIXES,
} from '../src/lib/repo-path-policy.mjs';

describe('repository path policy', () => {
  it('exposes frozen ordered path lists and Set-based exact-match collections', () => {
    expect(Object.isFrozen(SYSTEM_PATHS)).toBe(true);
    expect(Object.isFrozen(USER_PATH_PREFIXES)).toBe(true);
    expect(USER_PATH_FILES).toBeInstanceOf(Set);
    expect(TRACKED_SCAFFOLDING).toBeInstanceOf(Set);
  });

  it.each([
    [USER_PATH_FILES, '.env'],
    [TRACKED_SCAFFOLDING, 'data/.gitkeep'],
  ])('prevents mutation of exported Set collections', (paths, existingPath) => {
    const originalSize = paths.size;

    expect(Object.isFrozen(paths)).toBe(true);
    expect(() => paths.add('hostile/path')).toThrow(TypeError);
    expect(() => paths.delete(existingPath)).toThrow(TypeError);
    expect(() => paths.clear()).toThrow(TypeError);

    const nativeMutationErrors = [
      () => Set.prototype.add.call(paths, 'hostile/native-path'),
      () => Set.prototype.delete.call(paths, existingPath),
      () => Set.prototype.clear.call(paths),
    ].map(mutate => {
      try {
        mutate();
        return null;
      } catch (error) {
        return error;
      }
    });

    for (const error of nativeMutationErrors) expect(error).toBeInstanceOf(TypeError);
    expect(paths.size).toBe(originalSize);
    expect(paths.has(existingPath)).toBe(true);
    expect(paths.has('hostile/path')).toBe(false);
    expect(paths.has('hostile/native-path')).toBe(false);
  });

  it.each([
    [USER_PATH_FILES, '.env'],
    [TRACKED_SCAFFOLDING, 'data/.gitkeep'],
  ])('provides a stable Set-compatible read-only facade', (paths, existingPath) => {
    expect(paths.valueOf()).toBe(paths);
    expect(paths.constructor).toBe(Set);
    expect(Object.prototype.toString.call(paths)).toBe('[object Set]');

    for (const method of ['has', 'keys', 'values', 'entries', 'forEach']) {
      expect(Object.hasOwn(paths, method)).toBe(true);
      expect(paths[method]).toBe(paths[method]);
    }
    expect(Object.hasOwn(paths, Symbol.iterator)).toBe(true);
    expect(paths[Symbol.iterator]).toBe(paths[Symbol.iterator]);
    expect([...paths]).toContain(existingPath);

    const callbackSets = [];
    paths.forEach((value, key, callbackSet) => {
      expect(key).toBe(value);
      callbackSets.push(callbackSet);
    });
    expect(callbackSets).not.toHaveLength(0);
    expect(callbackSets.every(callbackSet => callbackSet === paths)).toBe(true);
  });

  it.each([
    'CLAUDE.md',
    'AGENTS.md',
    'package-lock.json',
    'CHANGELOG.md',
    'release-please-config.json',
    '.release-please-manifest.json',
    'src/lib/repo-path-policy.mjs',
    'src/lib/check-user-data-boundary.mjs',
    'scripts/sync-release-version.mjs',
    '.github/workflows/release.yml',
  ])('classifies %s as a system path', path => {
    expect(isSystemPath(path)).toBe(true);
  });

  it.each([
    'inputs/personalization/cv.md',
    'inputs/config/config.yml',
    'inputs/jds/acme.md',
    'inputs/parsers/private-board.mjs',
    'data/applications.md',
    'artifacts/reports/001-acme.md',
    'artifacts/output/cv.pdf',
    'artifacts/interview-prep/story-bank.md',
    'artifacts/lighthouse/report.json',
    'batch/logs/evaluate.log',
    'batch/batch-state.tsv',
    'batch/tracker-additions/run/additions.tsv',
    '.env',
    '.claude/settings.local.json',
    '.serena/project.yml',
  ])('classifies %s only as a user path', path => {
    expect(isUserPath(path)).toBe(true);
    expect(isSystemPath(path)).toBe(false);
  });

  it.each([
    'data/.gitkeep',
    'artifacts/interview-prep/.gitkeep',
    'artifacts/reports/.gitkeep',
    'artifacts/output/.gitkeep',
    'artifacts/lighthouse/.gitkeep',
    'inputs/jds/.gitkeep',
    'inputs/parsers/README.md',
    'batch/logs/.gitkeep',
    'batch/tracker-additions/.gitkeep',
  ])('keeps tracked scaffolding %s outside the user layer', path => {
    expect(TRACKED_SCAFFOLDING.has(path)).toBe(true);
    expect(isUserPath(path)).toBe(false);
  });

  it.each([
    ['src/', isSystemPath],
    ['data/', isUserPath],
    ['inputs/config/', isUserPath],
  ])('classifies protected directory root %s', (path, classify) => {
    expect(classify(path)).toBe(true);
  });

  it('deduplicates and sorts private tracked paths', () => {
    expect(
      privateTrackedPaths([
        'src/app/page.tsx',
        'inputs\\personalization\\cv.md',
        'data/applications.md',
        '.env',
        'data/applications.md',
        'data/.gitkeep',
      ]),
    ).toEqual(['.env', 'data/applications.md', 'inputs/personalization/cv.md']);
  });

  it('contains every release-critical updater path', () => {
    expect(SYSTEM_PATHS).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'package-lock.json',
        'CHANGELOG.md',
        'release-please-config.json',
        '.release-please-manifest.json',
        'src/lib/repo-path-policy.mjs',
        'src/lib/check-user-data-boundary.mjs',
        'scripts/sync-release-version.mjs',
        'update-system.mjs',
        'test-all.mjs',
      ]),
    );
    expect(SYSTEM_PATHS).not.toContain('scripts/repo-path-policy.mjs');
    expect(SYSTEM_PATHS).not.toContain('scripts/check-user-data-boundary.mjs');
  });

  it('normalizes separators and leading relative markers', () => {
    expect(normalizeRepoPath('././inputs\\personalization\\cv.md')).toBe(
      'inputs/personalization/cv.md',
    );
  });

  it.each([
    '/tmp/file',
    'C:tmp/file',
    'C:\\tmp\\file',
    '\\\\server\\share\\file',
    '../outside',
    'inside/../outside',
    'inside/..',
  ])('rejects absolute or traversing path %s', path => {
    expect(() => normalizeRepoPath(path)).toThrow();
  });
});
