import { describe, expect, it } from 'vitest';
import { ISSUE_LABEL_GROUPS } from '../scripts/lib/issue-triage-labels.mjs';
import {
  parseArgs,
  repoFromOrigin,
  syncGithubLabels,
  validateLabels,
} from '../scripts/sync-github-labels.mjs';

const labels = Object.values(ISSUE_LABEL_GROUPS)
  .flat()
  .map((name, index) => ({
    name,
    color: 'a855f7',
    description: `Managed issue taxonomy label number ${index + 1}.`,
  }));

describe('GitHub issue-label synchronization', () => {
  it('defaults to a dry run and accepts an explicit repository', () => {
    expect(parseArgs(['--repo', 'arspesk/sur9e'])).toEqual({
      apply: false,
      repo: 'arspesk/sur9e',
    });
  });

  it('rejects a missing --repo value clearly', () => {
    expect(() => parseArgs(['--repo'])).toThrow('--repo requires an OWNER/REPO value.');
  });

  it.each([
    ['https://github.com/arspesk/sur9e.git', 'arspesk/sur9e'],
    ['git@github.com:arspesk/sur9e.git', 'arspesk/sur9e'],
    ['ssh://git@github.com/arspesk/sur9e.git', 'arspesk/sur9e'],
    ['https://notgithub.com/arspesk/sur9e.git', undefined],
    ['https://github.com.evil.example/arspesk/sur9e.git', undefined],
    ['git@github.com.evil.example:arspesk/sur9e.git', undefined],
    ['ssh://git@github.com.evil.example/arspesk/sur9e.git', undefined],
  ])('parses only exact GitHub origins: %s', (origin, expected) => {
    expect(repoFromOrigin(origin)).toBe(expected);
  });

  it('validates the full exact issue taxonomy before doing any work', () => {
    expect(validateLabels(labels)).toEqual(labels);
  });

  it('prints a dry-run plan without invoking GitHub', async () => {
    const calls = [];
    const lines = [];

    await syncGithubLabels({
      labels,
      repo: 'arspesk/sur9e',
      execute: async (...args) => calls.push(args),
      log: line => lines.push(line),
    });

    expect(calls).toEqual([]);
    expect(lines.join('\n')).toContain('Dry run');
    expect(lines.join('\n')).toContain('type:bug');
  });

  it('checks gh authentication and only creates or updates manifest labels in apply mode', async () => {
    const calls = [];

    await syncGithubLabels({
      apply: true,
      labels,
      repo: 'arspesk/sur9e',
      execute: async (...args) => calls.push(args),
      log: () => {},
    });

    expect(calls[0]).toEqual(['gh', ['auth', 'status']]);
    expect(calls).toHaveLength(labels.length + 1);
    expect(
      calls.slice(1).every(([command, args]) => command === 'gh' && args[1] === 'create'),
    ).toBe(true);
    expect(calls.flat(2)).not.toContain('delete');
  });

  it('rejects an invalid later label before any command in dry-run or apply mode', async () => {
    const invalidLabels = labels.map((label, index) =>
      index === labels.length - 1 ? { ...label, color: 'nothex' } : label,
    );

    for (const apply of [false, true]) {
      const calls = [];
      await expect(
        syncGithubLabels({
          apply,
          labels: invalidLabels,
          repo: 'arspesk/sur9e',
          execute: async (...args) => calls.push(args),
          log: () => {},
        }),
      ).rejects.toThrow('6-character hexadecimal color');
      expect(calls).toEqual([]);
    }
  });

  it('rejects a 101-character later description before any command in dry-run or apply mode', async () => {
    const invalidLabels = labels.map((label, index) =>
      index === labels.length - 1 ? { ...label, description: 'x'.repeat(101) } : label,
    );

    for (const apply of [false, true]) {
      const calls = [];
      await expect(
        syncGithubLabels({
          apply,
          labels: invalidLabels,
          repo: 'arspesk/sur9e',
          execute: async (...args) => calls.push(args),
          log: () => {},
        }),
      ).rejects.toThrow('up to 100 characters');
      expect(calls).toEqual([]);
    }
  });

  it('rejects apply mode without an authenticated gh CLI', async () => {
    await expect(
      syncGithubLabels({
        apply: true,
        labels,
        repo: 'arspesk/sur9e',
        execute: async () => {
          throw new Error('gh: command not found');
        },
        log: () => {},
      }),
    ).rejects.toThrow('GitHub CLI authentication is required for --apply');
  });
});
