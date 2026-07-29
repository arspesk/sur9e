import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSystemPath,
  isUserPath,
  normalizeRepoPath,
  privateTrackedPaths,
  SYSTEM_PATHS,
  TRACKED_SCAFFOLDING,
  USER_PATH_EXCEPTIONS,
  USER_PATH_FILES,
  USER_PATH_PATTERNS,
  USER_PATH_PREFIXES,
} from '../src/lib/repo-path-policy.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PRIVACY_IGNORE_CASES = [
  ['artifacts/interview-prep/*.md', 'artifacts/interview-prep/private-story.md'],
  ['data/*', 'data/private-state.json'],
  ['artifacts/reports/*.md', 'artifacts/reports/private-report.md'],
  ['artifacts/output/*', 'artifacts/output/private-cv.pdf'],
  ['artifacts/lighthouse/*', 'artifacts/lighthouse/private-snapshot.json'],
  ['batch/logs/*', 'batch/logs/private.log'],
  ['batch/batch-state.tsv', 'batch/batch-state.tsv'],
  ['batch/batch-input.tsv', 'batch/batch-input.tsv'],
  ['batch/tracker-additions/**/*.tsv', 'batch/tracker-additions/run/private.tsv'],
  ['inputs/jds/*', 'inputs/jds/private-offer.md'],
  ['inputs/personalization/', 'inputs/personalization/cv.md'],
  ['inputs/config/', 'inputs/config/config.yml'],
  ['inputs/parsers/*', 'inputs/parsers/private-source.mjs'],
  ['.update-dismissed', '.update-dismissed'],
  ['.update-lock', '.update-lock'],
  ['.prettierignore.local', '.prettierignore.local'],
  ['.env', '.env'],
  ['batch/jobspy-env/', 'batch/jobspy-env/bin/python'],
  ['.resolved-prompt-*', '.resolved-prompt-evaluate'],
  ['batch/jobspy-results.csv', 'batch/jobspy-results.csv'],
  ['batch/screen-state.tsv', 'batch/screen-state.tsv'],
  ['batch/screened-urls.txt', 'batch/screened-urls.txt'],
  ['*.yml.bak', 'content/private.yml.bak'],
  ['*.yaml.bak', 'src/nested/private.yaml.bak'],
  ['.claude/memory/', '.claude/memory/private.md'],
  ['.claude/scheduled_tasks.lock', '.claude/scheduled_tasks.lock'],
  ['.claude/settings.local.json', '.claude/settings.local.json'],
  ['.claude/skills/*', '.claude/skills/custom/SKILL.md'],
  ['.claude/worktrees/', '.claude/worktrees/private/file'],
  ['.codex/hooks.json', '.codex/hooks.json'],
  ['test-results/', 'test-results/private-screenshot.png'],
  ['text_*.json', 'nested/text_private-results.json'],
  ['.antigravitycli/', '.antigravitycli/private-config.json'],
  ['.trash/', '.trash/private-backup.md'],
  ['batch/stage1-results.tsv', 'batch/stage1-results.tsv'],
  ['batch/*.pid', 'batch/private.pid'],
  ['tmp/', 'tmp/private-notes.md'],
  ['.playwright-mcp/', '.playwright-mcp/private-session.json'],
];

describe('repository path policy', () => {
  it('exposes frozen ordered path lists and Set-based exact-match collections', () => {
    expect(Object.isFrozen(SYSTEM_PATHS)).toBe(true);
    expect(Object.isFrozen(USER_PATH_PREFIXES)).toBe(true);
    expect(Object.isFrozen(USER_PATH_PATTERNS)).toBe(true);
    expect(Object.isFrozen(USER_PATH_EXCEPTIONS)).toBe(true);
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
    'content/modes/evaluate.md',
    'content/templates/cv.md',
    'content/examples/profile.yml',
    'content/future-bucket/unknown.md',
    '.claude/skills/sur9e/SKILL.md',
  ])('classifies %s as a system path', path => {
    expect(isSystemPath(path)).toBe(true);
  });

  it.each([
    'inputs/personalization/cv.md',
    'inputs/config/config.yml',
    'inputs/jds/acme.md',
    'inputs/parsers/private-board.mjs',
    'inputs/future-bucket/private.txt',
    'data/applications.md',
    'data/future-bucket/private.txt',
    'artifacts/reports/001-acme.md',
    'artifacts/output/cv.pdf',
    'artifacts/interview-prep/story-bank.md',
    'artifacts/lighthouse/report.json',
    'artifacts/future-bucket/private.txt',
    'batch/logs/evaluate.log',
    'batch/jobspy-env/bin/python',
    'batch/worker.pid',
    'batch/batch-state.tsv',
    'batch/tracker-additions/run/additions.tsv',
    '.env',
    '.claude/scheduled_tasks.lock',
    '.claude/settings.local.json',
    '.resolved-prompt-evaluate',
    'text_search-results.json',
    'test-results/private-screenshot.png',
    'tmp/local-notes.md',
    '.playwright-mcp/session.json',
    '.antigravitycli/config.json',
    '.serena/project.yml',
    '.claude/skills/custom/SKILL.md',
    '.claude/skills/sur9e/private.yml.bak',
    '.claude/skills/sur9e/text_private.json',
    'content/private.yml.bak',
    'src/nested/private.yaml.bak',
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

  it('limits root batch PID protection to files directly under batch', () => {
    expect(USER_PATH_PATTERNS).toContain('batch/*.pid');
    expect(isUserPath('batch/screen.pid')).toBe(true);
    expect(isUserPath('batch/nested/screen.pid')).toBe(false);
    expect(isUserPath('batch/batch-runner.sh')).toBe(false);
    expect(isSystemPath('batch/batch-runner.sh')).toBe(true);
  });

  it('keeps only the project-owned Claude skill outside the local-skill boundary', () => {
    expect(USER_PATH_EXCEPTIONS).toEqual(['.claude/skills/sur9e/']);
    expect(isUserPath('.claude/skills/sur9e/SKILL.md')).toBe(false);
    expect(isSystemPath('.claude/skills/sur9e/SKILL.md')).toBe(true);
    expect(isUserPath('.claude/skills/sur9e/private.yml.bak')).toBe(true);
    expect(isSystemPath('.claude/skills/sur9e/private.yml.bak')).toBe(false);
    expect(isUserPath('.claude/skills/sur9e/text_private.json')).toBe(true);
    expect(isSystemPath('.claude/skills/sur9e/text_private.json')).toBe(false);
    expect(isUserPath('.claude/skills/custom/SKILL.md')).toBe(true);
    expect(isSystemPath('.claude/skills/custom/SKILL.md')).toBe(false);
  });

  it('keeps high-signal privacy ignore rules executable in the path policy', () => {
    const ignoreLines = new Set(
      readFileSync(resolve(ROOT, '.gitignore'), 'utf8')
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(Boolean),
    );

    for (const [rule, example] of PRIVACY_IGNORE_CASES) {
      expect(ignoreLines.has(rule), `missing .gitignore rule: ${rule}`).toBe(true);
      expect(isUserPath(example), `${rule} is not protected: ${example}`).toBe(true);
      expect(isSystemPath(example), `${rule} leaks into the system layer: ${example}`).toBe(false);
    }
    expect(ignoreLines.has('!.claude/skills/sur9e/')).toBe(true);
  });

  it.each([
    ['src/', isSystemPath],
    ['content/', isSystemPath],
    ['data/', isUserPath],
    ['inputs/', isUserPath],
    ['artifacts/', isUserPath],
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
        'src/lib/git-porcelain.mjs',
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
