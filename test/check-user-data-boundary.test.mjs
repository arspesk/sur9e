import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { boundaryViolations } from '../src/lib/check-user-data-boundary.mjs';
import {
  SYSTEM_PATHS,
  TRACKED_SCAFFOLDING,
  USER_PATH_FILES,
  USER_PATH_PATTERNS,
  USER_PATH_PREFIXES,
} from '../src/lib/repo-path-policy.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CHECKER = resolve(ROOT, 'src/lib/check-user-data-boundary.mjs');

function isolatedGitEnvironment(directory, inheritedEnvironment = process.env) {
  const fixtureHome = resolve(directory, '.fixture-home');
  const fixtureConfig = resolve(fixtureHome, '.config');
  const globalConfig = resolve(fixtureHome, 'empty-gitconfig');
  mkdirSync(fixtureConfig, { recursive: true });
  mkdirSync(resolve(fixtureHome, 'hooks-disabled'), { recursive: true });
  writeFileSync(globalConfig, '', 'utf8');

  return {
    ...Object.fromEntries(
      Object.entries(inheritedEnvironment).filter(
        ([name]) =>
          !name.startsWith('GIT_') &&
          name !== 'HOME' &&
          name !== 'USERPROFILE' &&
          name !== 'XDG_CONFIG_HOME',
      ),
    ),
    HOME: fixtureHome,
    USERPROFILE: fixtureHome,
    XDG_CONFIG_HOME: fixtureConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
  };
}

function writeFixtureFile(directory, path, contents = 'fixture\n') {
  const destination = resolve(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, 'utf8');
}

function git(directory, args) {
  const fixtureHooks = resolve(directory, '.fixture-home', 'hooks-disabled');
  return execFileSync(
    'git',
    [
      '-c',
      `core.hooksPath=${fixtureHooks}`,
      '-c',
      'commit.gpgSign=false',
      '-c',
      'tag.gpgSign=false',
      ...args,
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: isolatedGitEnvironment(directory),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}

function createGitFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'sur9e-user-boundary-'));
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'user.email', 'sur9e-test@example.invalid']);
  git(directory, ['config', 'user.name', 'sur9e test']);
  return directory;
}

function runChecker(directory, args = [], environment = {}, checker = CHECKER) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: isolatedGitEnvironment(directory, { ...process.env, ...environment }),
  });
}

describe('user-data boundary', () => {
  it('returns sorted private additions and modifications without duplicates', () => {
    expect(
      boundaryViolations([
        'src/app/page.tsx',
        'inputs/personalization/new-cv.md',
        'data/applications.md',
        '.env',
        'data/applications.md',
        'inputs\\personalization\\new-cv.md',
      ]),
    ).toEqual(['.env', 'data/applications.md', 'inputs/personalization/new-cv.md']);
  });

  it('permits every tracked scaffolding exception', () => {
    expect(boundaryViolations([...TRACKED_SCAFFOLDING])).toEqual([]);
  });

  it('guards every private prefix and exact-file policy entry', () => {
    const privateExamples = [
      ...USER_PATH_PREFIXES.map(prefix => `${prefix}private-boundary-fixture`),
      ...USER_PATH_FILES,
    ];

    expect(boundaryViolations(privateExamples)).toEqual([...privateExamples].sort());
  });

  it('guards durable buckets and local-runtime patterns without consuming system content', () => {
    const privateExamples = [
      'inputs/future-bucket/private.txt',
      'data/future-bucket/private.txt',
      'artifacts/future-bucket/private.txt',
      'batch/jobspy-env/bin/python',
      'batch/screen.pid',
      '.claude/scheduled_tasks.lock',
      'tmp/local-notes.md',
      '.claude/skills/custom/SKILL.md',
      '.claude/skills/sur9e/private.yml.bak',
      '.claude/skills/sur9e/text_private.json',
      'content/private.yml.bak',
      'src/nested/private.yaml.bak',
    ];

    expect(USER_PATH_PATTERNS).toContain('batch/*.pid');
    expect(boundaryViolations(privateExamples)).toEqual([...privateExamples].sort());
    expect(boundaryViolations(['content/examples/profile.yml'])).toEqual([]);
    expect(boundaryViolations([...TRACKED_SCAFFOLDING])).toEqual([]);
  });

  it('permits repository-owned system paths', () => {
    expect(boundaryViolations([...SYSTEM_PATHS])).toEqual([]);
  });

  it('checks the complete tracked-file set and reports private paths', () => {
    const directory = createGitFixture();
    const privatePaths = [
      'inputs/future-bucket/private.txt',
      'data/future-bucket/private.txt',
      'artifacts/future-bucket/private.txt',
      'batch/screen.pid',
      '.claude/scheduled_tasks.lock',
      '.claude/skills/custom/SKILL.md',
      '.claude/skills/sur9e/private.yml.bak',
      '.claude/skills/sur9e/text_private.json',
      'content/private.yml.bak',
      'src/nested/private.yaml.bak',
    ];
    try {
      writeFixtureFile(directory, 'src/app/page.tsx');
      writeFixtureFile(directory, 'content/examples/profile.yml');
      writeFixtureFile(directory, 'data/.gitkeep', '');
      writeFixtureFile(directory, 'inputs/parsers/README.md');
      for (const path of privatePaths) writeFixtureFile(directory, path);
      git(directory, ['add', '--all']);

      const result = runChecker(directory, ['--tracked']);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(
        `Private user-data paths detected:\n${[...privatePaths].sort().join('\n')}\n`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for tracked private filenames containing Unicode, newlines, and tabs', () => {
    const directory = createGitFixture();
    const privatePaths = [
      'inputs/personalization/résumé.md',
      'data/line\nbreak.md',
      'inputs/config/tab\tsettings.yml',
    ];
    try {
      for (const path of privatePaths) writeFixtureFile(directory, path);
      git(directory, ['add', '--all']);

      const result = runChecker(directory, ['--tracked']);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      for (const path of privatePaths) expect(result.stdout).toContain(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints an exact OK result when tracked files stay outside the boundary', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'src/app/page.tsx');
      writeFixtureFile(directory, 'data/.gitkeep', '');
      git(directory, ['add', '--all']);

      const result = runChecker(directory, ['--tracked']);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('OK: no private user-data paths detected.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('checks additions and modifications across the requested commit range', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'src/app/page.tsx', 'before\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      writeFixtureFile(directory, 'src/app/page.tsx', 'after\n');
      writeFixtureFile(directory, 'data/applications.md', '# Private tracker\n');
      writeFixtureFile(directory, 'content/private.yml.bak', 'private: true\n');
      writeFixtureFile(directory, 'src/nested/private.yaml.bak', 'private: true\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(
        [
          'Private user-data paths detected:',
          'content/private.yml.bak',
          'data/applications.md',
          'src/nested/private.yaml.bak',
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for changed private filenames containing Unicode, newlines, and tabs', () => {
    const directory = createGitFixture();
    const privatePaths = [
      'artifacts/reports/résumé.md',
      'data/line\nbreak.md',
      'inputs/config/tab\tsettings.yml',
    ];
    try {
      writeFixtureFile(directory, 'src/app/page.tsx');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      for (const path of privatePaths) writeFixtureFile(directory, path);
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      for (const path of privatePaths) expect(result.stdout).toContain(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports the private source of a rename when repository rename detection is disabled', () => {
    const directory = createGitFixture();
    try {
      git(directory, ['config', 'diff.renames', 'false']);
      writeFixtureFile(directory, 'data/private-record.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      mkdirSync(resolve(directory, 'src'), { recursive: true });
      git(directory, ['mv', 'data/private-record.md', 'src/public-record.md']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('data/private-record.md');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports an unchanged private source copied into a system path', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'data/private-record.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      writeFixtureFile(directory, 'src/public-copy.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('data/private-record.md');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports a private destination copied from an unchanged system source', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'src/public-record.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      writeFixtureFile(directory, 'data/private-copy.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('data/private-copy.md');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports the private destination of a rename from a system path', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'src/public-record.md', 'same contents\n');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      mkdirSync(resolve(directory, 'data'), { recursive: true });
      git(directory, ['mv', 'src/public-record.md', 'data/private-record.md']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('data/private-record.md');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('allows a pure deletion of a private path', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'data/obsolete-private-record.md');
      git(directory, ['add', '--all']);
      git(directory, ['commit', '--quiet', '-m', 'base']);
      const baseSha = git(directory, ['rev-parse', 'HEAD']);

      git(directory, ['rm', 'data/obsolete-private-record.md']);
      git(directory, ['commit', '--quiet', '-m', 'head']);
      const headSha = git(directory, ['rev-parse', 'HEAD']);

      const result = runChecker(directory, [], {
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('OK: no private user-data paths detected.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('requires both range SHAs outside tracked-file mode', () => {
    const directory = createGitFixture();
    try {
      const result = runChecker(directory, [], { BASE_SHA: '', HEAD_SHA: '' });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('BASE_SHA and HEAD_SHA are required');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects non-full or non-hex range SHAs before invoking git', () => {
    const directory = createGitFixture();
    try {
      for (const [baseSha, headSha] of [
        ['HEAD', 'main'],
        ['abc1234', '0'.repeat(40)],
        ['z'.repeat(40), '0'.repeat(40)],
      ]) {
        const result = runChecker(directory, [], {
          BASE_SHA: baseSha,
          HEAD_SHA: headSha,
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('full 40- or 64-character hexadecimal object ID');
        expect(result.stderr).not.toContain('Unable to inspect repository paths with git');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('executes normally when invoked through a symlink', () => {
    const directory = createGitFixture();
    try {
      writeFixtureFile(directory, 'src/app/page.tsx');
      git(directory, ['add', '--all']);
      const checkerLink = resolve(directory, 'boundary-checker.mjs');
      symlinkSync(CHECKER, checkerLink);

      const result = runChecker(directory, ['--tracked'], {}, checkerLink);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('OK: no private user-data paths detected.\n');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('isolates fixture git commands from hostile global hooks and signing', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'sur9e-user-boundary-hostile-'));
    const hostileHome = resolve(directory, 'hostile-home');
    const hostileHooks = resolve(hostileHome, 'hooks');
    const hostileHookMarker = resolve(directory, 'hostile-hook-ran');
    const hostileGlobalConfig = resolve(hostileHome, '.gitconfig');
    const inheritedEnvironment = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    };

    try {
      writeFixtureFile(
        directory,
        'hostile-home/hooks/pre-commit',
        `#!/bin/sh\nprintf hostile > "${hostileHookMarker}"\nexit 1\n`,
      );
      chmodSync(resolve(hostileHooks, 'pre-commit'), 0o755);
      writeFixtureFile(
        directory,
        'hostile-home/.gitconfig',
        `[core]\n\thooksPath = ${hostileHooks}\n[commit]\n\tgpgSign = true\n`,
      );
      Object.assign(process.env, {
        HOME: hostileHome,
        USERPROFILE: hostileHome,
        XDG_CONFIG_HOME: resolve(hostileHome, '.config'),
        GIT_CONFIG_GLOBAL: hostileGlobalConfig,
        GIT_CONFIG_NOSYSTEM: '0',
      });

      git(directory, ['init', '--quiet']);
      git(directory, ['config', 'user.email', 'sur9e-test@example.invalid']);
      git(directory, ['config', 'user.name', 'sur9e test']);
      writeFixtureFile(directory, 'src/app/page.tsx');
      git(directory, ['add', '--all']);

      expect(() => git(directory, ['commit', '--quiet', '-m', 'isolated commit'])).not.toThrow();
      expect(existsSync(hostileHookMarker)).toBe(false);
    } finally {
      for (const [name, value] of Object.entries(inheritedEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('wires the comprehensive local gate through the shared tracked-file scan', () => {
    const source = readFileSync(resolve(ROOT, 'test-all.mjs'), 'utf8');

    expect(source).toContain(
      "import { boundaryViolations } from './src/lib/check-user-data-boundary.mjs';",
    );
    expect(source).toMatch(/boundaryViolations\(\s*trackedFiles\s*\)/);
    expect(source).toContain("execFileSync('git', ['ls-files', '-z']");
    expect(source).toContain("pass('No private user-data paths are tracked')");
    expect(source).not.toContain('const userFiles = [');
  });

  it('runs the bootstrap-safe checker in the pull-request workflow', () => {
    const source = readFileSync(resolve(ROOT, '.github/workflows/user-data-boundary.yml'), 'utf8');
    const workflow = yaml.load(source);

    expect(workflow).toMatchObject({
      name: 'User data boundary',
      on: { pull_request: { branches: ['main'] } },
      permissions: { contents: 'read' },
      concurrency: {
        group: '${{ github.workflow }}-${{ github.event.pull_request.number }}',
        'cancel-in-progress': true,
      },
    });
    expect(workflow.jobs.guard).toMatchObject({
      name: 'No private user data',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
      env: {
        BASE_SHA: '${{ github.event.pull_request.base.sha }}',
        HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      },
    });
    expect(workflow.jobs.guard.steps).toEqual([
      {
        uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        with: { 'fetch-depth': 0 },
      },
      {
        uses: 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
        with: { 'node-version': 24 },
      },
      {
        name: 'Check user-data boundary',
        run: 'node src/lib/check-user-data-boundary.mjs',
      },
    ]);
    expect(source).not.toContain('scripts/check-user-data-boundary.mjs');
  });
});
