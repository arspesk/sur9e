import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const temporaryDirectories = [];

function isolatedGitEnvironment(directory, inheritedEnvironment = process.env) {
  const fixtureHome = resolve(directory, '.fixture-home');
  const fixtureConfig = resolve(fixtureHome, '.config');
  const globalConfig = resolve(fixtureHome, 'empty-gitconfig');
  mkdirSync(fixtureConfig, { recursive: true });
  mkdirSync(resolve(fixtureHome, 'hooks-disabled'), { recursive: true });
  if (!existsSync(globalConfig)) writeFileSync(globalConfig, '', 'utf8');

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

function git(directory, args, inheritedEnvironment = process.env) {
  return execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    env: isolatedGitEnvironment(directory, inheritedEnvironment),
  }).trim();
}

function writeFixtureFile(directory, path, contents = 'fixture\n') {
  const destination = resolve(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, 'utf8');
}

function copyTargetFile(directory, path) {
  const source = resolve(ROOT, path);
  if (!existsSync(source)) return;
  const destination = resolve(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}

function configureRepository(directory) {
  git(directory, ['init', '--quiet', '--initial-branch=main']);
  git(directory, ['config', 'user.email', 'sur9e-test@example.invalid']);
  git(directory, ['config', 'user.name', 'sur9e test']);
  git(directory, ['config', 'commit.gpgSign', 'false']);
  git(directory, ['config', 'tag.gpgSign', 'false']);
  git(directory, [
    'config',
    'core.hooksPath',
    resolve(directory, '.fixture-home', 'hooks-disabled'),
  ]);
}

function seedUpdaterFiles(directory) {
  for (const path of [
    '.gitignore',
    'update-system.mjs',
    'src/lib/repo-path-policy.mjs',
    'src/lib/git-porcelain.mjs',
  ]) {
    copyTargetFile(directory, path);
  }
}

function createUpdateFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'sur9e-update-integration-'));
  temporaryDirectories.push(directory);
  const installed = resolve(directory, 'installed');
  const upstream = resolve(directory, 'upstream');
  const shimDirectory = resolve(directory, 'bin');
  mkdirSync(installed, { recursive: true });
  mkdirSync(upstream, { recursive: true });
  mkdirSync(shimDirectory, { recursive: true });

  configureRepository(installed);
  seedUpdaterFiles(installed);
  writeFixtureFile(installed, 'VERSION', '0.2.0\n');
  writeFixtureFile(installed, 'content/changed.md', 'installed\n');
  writeFixtureFile(installed, 'content/obsolete.md', 'delete me\n');
  writeFixtureFile(installed, 'content/line\nbreak.md', 'delete newline\n');
  writeFixtureFile(installed, 'content/trailing-space.md ', 'delete trailing space\n');
  writeFixtureFile(installed, '.claude/skills/sur9e/SKILL.md', 'installed skill\n');
  git(installed, ['add', '--all']);
  git(installed, ['commit', '--quiet', '-m', 'installed v0.2.0']);

  configureRepository(upstream);
  seedUpdaterFiles(upstream);
  copyTargetFile(upstream, 'scripts/update-worker.mjs');
  copyTargetFile(upstream, 'scripts/web.mjs');
  writeFixtureFile(upstream, 'VERSION', '0.3.0\n');
  writeFixtureFile(upstream, 'content/changed.md', 'upstream\n');
  writeFixtureFile(upstream, 'content/new.md', 'new upstream file\n');
  writeFixtureFile(upstream, 'content/new\nupstream.md', 'new newline\n');
  writeFixtureFile(upstream, 'content/new-trailing.md ', 'new trailing space\n');
  writeFixtureFile(upstream, '.claude/skills/sur9e/SKILL.md', 'upstream skill\n');
  git(upstream, ['add', '--all']);
  git(upstream, ['commit', '--quiet', '-m', 'upstream v0.3.0']);

  const sourceUrl = 'https://github.com/fixture/update.git';
  git(installed, ['config', `url.file://${upstream}.insteadOf`, sourceUrl]);
  git(installed, ['config', 'protocol.file.allow', 'always']);
  writeFixtureFile(
    installed,
    'inputs/config/config.yml',
    `system:\n  update_source: ${sourceUrl}\n  update_branch: main\n`,
  );

  const privateFiles = new Map([
    ['.claude/skills/custom/SKILL.md', 'custom local skill\n'],
    ['.claude/skills/sur9e/private.yml.bak', 'private project-skill backup\n'],
    ['content/private.yml.bak', 'private content backup\n'],
    ['src/nested/private.yaml.bak', 'private source backup\n'],
    ['inputs/personalization/private.md', 'private input\n'],
    ['data/future/private.json', 'private data\n'],
    ['artifacts/output/private.pdf', 'private artifact\n'],
  ]);
  for (const [path, contents] of privateFiles) writeFixtureFile(installed, path, contents);

  writeFixtureFile(
    shimDirectory,
    'npm',
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "11.0.0"; exit 0; fi',
      'if [ -n "$SUR9E_TEST_NPM_CALL_LOG" ]; then echo "$*" >> "$SUR9E_TEST_NPM_CALL_LOG"; fi',
      'if [ "$SUR9E_TEST_NPM_REQUIRE_DEV" = "1" ]; then',
      '  case " $* " in',
      '    *" --include=dev "*) ;;',
      '    *) echo "fixture development dependencies were omitted" >&2; exit 43 ;;',
      '  esac',
      'fi',
      'if [ "$SUR9E_TEST_NPM_INSTALL_FAIL" = "1" ]; then',
      '  echo "fixture dependency install failed" >&2',
      '  exit 42',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(resolve(shimDirectory, 'npm'), 0o755);
  symlinkSync(resolve(ROOT, 'node_modules'), resolve(installed, 'node_modules'), 'dir');

  const environment = isolatedGitEnvironment(installed, {
    ...process.env,
    PATH: `${shimDirectory}:${process.env.PATH}`,
  });

  return { environment, installed, privateFiles, upstream };
}

function runUpdater(installed, environment, command) {
  return spawnSync(process.execPath, ['update-system.mjs', command], {
    cwd: installed,
    encoding: 'utf8',
    env: environment,
  });
}

function expectPrivateFiles(installed, privateFiles) {
  for (const [path, contents] of privateFiles) {
    expect(readFileSync(resolve(installed, path), 'utf8'), path).toBe(contents);
  }
}

function captureSystemState(installed) {
  return new Map(
    ['VERSION', 'content/changed.md', 'content/obsolete.md', '.claude/skills/sur9e/SKILL.md'].map(
      path => [path, readFileSync(resolve(installed, path))],
    ),
  );
}

function expectSystemState(installed, systemState) {
  for (const [path, contents] of systemState) {
    expect(readFileSync(resolve(installed, path)), path).toEqual(contents);
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('update-system apply and rollback', () => {
  it('synchronizes broad system content losslessly while preserving ignored user state', () => {
    const { environment, installed, privateFiles } = createUpdateFixture();

    const applied = runUpdater(installed, environment, 'apply');

    expect(applied.status, applied.stderr).toBe(0);
    expect(readFileSync(resolve(installed, 'VERSION'), 'utf8')).toBe('0.3.0\n');
    expect(readFileSync(resolve(installed, 'content/changed.md'), 'utf8')).toBe('upstream\n');
    expect(readFileSync(resolve(installed, 'content/new.md'), 'utf8')).toBe('new upstream file\n');
    expect(readFileSync(resolve(installed, 'content/new\nupstream.md'))).toEqual(
      Buffer.from('new newline\n'),
    );
    expect(readFileSync(resolve(installed, 'content/new-trailing.md '))).toEqual(
      Buffer.from('new trailing space\n'),
    );
    expect(readFileSync(resolve(installed, '.claude/skills/sur9e/SKILL.md'), 'utf8')).toBe(
      'upstream skill\n',
    );
    expect(readFileSync(resolve(installed, 'scripts/update-worker.mjs'))).toEqual(
      readFileSync(resolve(ROOT, 'scripts/update-worker.mjs')),
    );
    expect(readFileSync(resolve(installed, 'scripts/web.mjs'))).toEqual(
      readFileSync(resolve(ROOT, 'scripts/web.mjs')),
    );
    expect(existsSync(resolve(installed, 'content/obsolete.md'))).toBe(false);
    expect(existsSync(resolve(installed, 'content/line\nbreak.md'))).toBe(false);
    expect(existsSync(resolve(installed, 'content/trailing-space.md '))).toBe(false);
    expectPrivateFiles(installed, privateFiles);

    const rolledBack = runUpdater(installed, environment, 'rollback');

    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(readFileSync(resolve(installed, 'VERSION'), 'utf8')).toBe('0.2.0\n');
    expect(readFileSync(resolve(installed, 'content/changed.md'), 'utf8')).toBe('installed\n');
    expect(readFileSync(resolve(installed, 'content/obsolete.md'), 'utf8')).toBe('delete me\n');
    expect(readFileSync(resolve(installed, 'content/line\nbreak.md'), 'utf8')).toBe(
      'delete newline\n',
    );
    expect(readFileSync(resolve(installed, 'content/trailing-space.md '), 'utf8')).toBe(
      'delete trailing space\n',
    );
    expect(existsSync(resolve(installed, 'content/new.md'))).toBe(false);
    expect(existsSync(resolve(installed, 'content/new\nupstream.md'))).toBe(false);
    expect(existsSync(resolve(installed, 'content/new-trailing.md '))).toBe(false);
    expect(readFileSync(resolve(installed, '.claude/skills/sur9e/SKILL.md'), 'utf8')).toBe(
      'installed skill\n',
    );
    expect(existsSync(resolve(installed, 'scripts/update-worker.mjs'))).toBe(false);
    expect(existsSync(resolve(installed, 'scripts/web.mjs'))).toBe(false);
    expectPrivateFiles(installed, privateFiles);
    expect(git(installed, ['status', '--short', '--untracked-files=no'])).toBe('');
  }, 15_000);

  it('treats dependency installation failure as fatal and restores committed system state', () => {
    const { environment, installed, privateFiles } = createUpdateFixture();
    const installedHead = git(installed, ['rev-parse', 'HEAD']);
    const systemState = captureSystemState(installed);
    const npmCallLog = resolve(installed, '.fixture-home', 'npm-calls.log');

    const result = runUpdater(
      installed,
      {
        ...environment,
        SUR9E_TEST_NPM_INSTALL_FAIL: '1',
        SUR9E_TEST_NPM_CALL_LOG: npmCallLog,
      },
      'apply',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture dependency install failed');
    expect(result.stderr).toContain('restored the previous committed version');
    expect(git(installed, ['rev-parse', 'HEAD'])).toBe(installedHead);
    expectSystemState(installed, systemState);
    expect(git(installed, ['status', '--short', '--untracked-files=no'])).toBe('');
    expectPrivateFiles(installed, privateFiles);
    expect(readFileSync(npmCallLog, 'utf8').trim().split('\n')).toEqual([
      'ci --include=dev --no-audit --no-fund',
      'ci --include=dev --no-audit --no-fund',
    ]);

    const retry = runUpdater(installed, environment, 'apply');
    expect(retry.status, retry.stderr).toBe(0);
    expect(readFileSync(resolve(installed, 'VERSION'), 'utf8')).toBe('0.3.0\n');
  }, 15_000);

  it('installs build dependencies when launched from a production server', () => {
    const { environment, installed } = createUpdateFixture();
    const npmCallLog = resolve(installed, '.fixture-home', 'npm-calls.log');

    const result = runUpdater(
      installed,
      {
        ...environment,
        NODE_ENV: 'production',
        SUR9E_TEST_NPM_REQUIRE_DEV: '1',
        SUR9E_TEST_NPM_CALL_LOG: npmCallLog,
      },
      'apply',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(npmCallLog, 'utf8').trim()).toBe('ci --include=dev --no-audit --no-fund');
    expect(readFileSync(resolve(installed, 'VERSION'), 'utf8')).toBe('0.3.0\n');
  }, 15_000);

  it('backs up the exact customized HEAD even when the installed version is unchanged', () => {
    const { environment, installed } = createUpdateFixture();
    git(installed, ['branch', 'backup-pre-update-0.2.0'], environment);
    writeFixtureFile(installed, 'content/changed.md', 'customized installation\n');
    git(installed, ['add', '--', 'content/changed.md'], environment);
    git(installed, ['commit', '--quiet', '-m', 'customize same version'], environment);
    const customizedHead = git(installed, ['rev-parse', 'HEAD'], environment);
    const shortHead = git(installed, ['rev-parse', '--short=12', 'HEAD'], environment);

    const result = runUpdater(installed, environment, 'apply');

    expect(result.status, result.stderr).toBe(0);
    expect(git(installed, ['rev-parse', `backup-pre-update-0.2.0-${shortHead}`], environment)).toBe(
      customizedHead,
    );
  }, 15_000);

  it('reports the committed version and complete release metadata despite a staged VERSION', () => {
    const { environment, installed } = createUpdateFixture();
    writeFixtureFile(installed, 'VERSION', '9.9.9\n');
    git(installed, ['add', '--', 'VERSION'], environment);
    const fetchMock = resolve(installed, '.fixture-home', 'update-fetch-mock.mjs');
    writeFileSync(
      fetchMock,
      [
        'globalThis.fetch = async url => {',
        "  if (String(url).includes('raw.githubusercontent.com')) return new Response('0.3.0\\n');",
        '  return Response.json({',
        "    body: '### Features\\n\\n* safe recovery',",
        "    published_at: '2026-08-02T12:00:00Z',",
        "    html_url: 'https://github.com/fixture/update/releases/tag/v0.3.0',",
        '  });',
        '};',
        '',
      ].join('\n'),
    );

    const result = runUpdater(
      installed,
      { ...environment, NODE_OPTIONS: `--import=${fetchMock}` },
      'check',
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'update-available',
      local: '0.2.0',
      remote: '0.3.0',
      changelog: '### Features\n\n* safe recovery',
      releaseDate: '2026-08-02T12:00:00Z',
      releaseUrl: 'https://github.com/fixture/update/releases/tag/v0.3.0',
    });
  });

  it('restores committed state when the update commit hook fails after checkout', () => {
    const { environment, installed, privateFiles } = createUpdateFixture();
    const hooks = resolve(installed, '.fixture-home', 'failing-hooks');
    mkdirSync(hooks, { recursive: true });
    writeFixtureFile(
      installed,
      '.fixture-home/failing-hooks/pre-commit',
      '#!/bin/sh\necho "fixture pre-commit failed" >&2\nexit 33\n',
    );
    chmodSync(resolve(hooks, 'pre-commit'), 0o755);
    git(installed, ['config', 'core.hooksPath', hooks], environment);
    const installedHead = git(installed, ['rev-parse', 'HEAD'], environment);
    const systemState = captureSystemState(installed);

    const result = runUpdater(installed, environment, 'apply');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fixture pre-commit failed');
    expect(result.stderr).toContain('restored the previous committed version');
    expect(git(installed, ['rev-parse', 'HEAD'], environment)).toBe(installedHead);
    expectSystemState(installed, systemState);
    expect(git(installed, ['status', '--short', '--untracked-files=no'], environment)).toBe('');
    expectPrivateFiles(installed, privateFiles);

    const rollback = runUpdater(installed, environment, 'rollback');
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(rollback.stdout).toContain('already matches');
  }, 15_000);

  it('makes rollback idempotent when the backup already matches the checkout', () => {
    const { environment, installed } = createUpdateFixture();
    expect(runUpdater(installed, environment, 'apply').status).toBe(0);
    expect(runUpdater(installed, environment, 'rollback').status).toBe(0);
    const headAfterFirstRollback = git(installed, ['rev-parse', 'HEAD']);

    const repeated = runUpdater(installed, environment, 'rollback');

    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.stdout).toContain('already matches');
    expect(git(installed, ['rev-parse', 'HEAD'])).toBe(headAfterFirstRollback);
    expect(git(installed, ['status', '--short', '--untracked-files=no'])).toBe('');
  }, 15_000);

  it('refuses dirty system paths with newlines and rename source records', () => {
    const { environment, installed } = createUpdateFixture();
    mkdirSync(resolve(installed, 'tmp'), { recursive: true });
    git(installed, ['mv', 'content/line\nbreak.md', 'tmp/private destination.md']);

    const result = runUpdater(installed, environment, 'apply');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Uncommitted changes in system files');
    expect(result.stderr).toContain('content/line\nbreak.md');
    expect(git(installed, ['branch', '--list', 'backup-pre-update-*'])).toBe('');
  });

  it('rejects protected paths in the fetched tree before checkout or backup', () => {
    const { environment, installed, privateFiles, upstream } = createUpdateFixture();
    writeFixtureFile(upstream, 'content/private.yml.bak', 'hostile upstream backup\n');
    writeFixtureFile(upstream, '.claude/skills/custom/SKILL.md', 'hostile upstream skill\n');
    writeFixtureFile(
      upstream,
      '.claude/skills/sur9e/private.yml.bak',
      'hostile project-skill backup\n',
    );
    git(upstream, [
      'add',
      '--force',
      '--',
      'content/private.yml.bak',
      '.claude/skills/custom/SKILL.md',
      '.claude/skills/sur9e/private.yml.bak',
    ]);
    git(upstream, ['commit', '--quiet', '-m', 'force protected paths']);
    const installedHead = git(installed, ['rev-parse', 'HEAD']);
    const systemState = captureSystemState(installed);
    const trackedStatus = git(installed, ['status', '--short', '--untracked-files=no']);

    const result = runUpdater(installed, environment, 'apply');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Upstream update contains protected user paths');
    expect(result.stderr).toContain('.claude/skills/custom/SKILL.md');
    expect(result.stderr).toContain('content/private.yml.bak');
    expect(result.stderr).toContain('.claude/skills/sur9e/private.yml.bak');
    expect(git(installed, ['rev-parse', 'HEAD'])).toBe(installedHead);
    expect(git(installed, ['branch', '--list', 'backup-pre-update-*'])).toBe('');
    expectSystemState(installed, systemState);
    expect(git(installed, ['status', '--short', '--untracked-files=no'])).toBe(trackedStatus);
    expectPrivateFiles(installed, privateFiles);
  });

  it('rejects a legacy backup containing protected paths before rollback checkout', () => {
    const { environment, installed, privateFiles, upstream } = createUpdateFixture();
    writeFixtureFile(upstream, 'content/private.yml.bak', 'legacy backup collision\n');
    writeFixtureFile(upstream, '.claude/skills/custom/SKILL.md', 'legacy skill collision\n');
    git(upstream, [
      'add',
      '--force',
      '--',
      'content/private.yml.bak',
      '.claude/skills/custom/SKILL.md',
    ]);
    git(upstream, ['commit', '--quiet', '-m', 'legacy unsafe backup']);
    git(installed, ['fetch', '--quiet', `file://${upstream}`, 'main']);
    git(installed, ['branch', 'backup-pre-update-0.1.0', 'FETCH_HEAD']);
    const installedHead = git(installed, ['rev-parse', 'HEAD']);
    const systemState = captureSystemState(installed);
    const trackedStatus = git(installed, ['status', '--short', '--untracked-files=no']);

    const result = runUpdater(installed, environment, 'rollback');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Backup contains protected user paths');
    expect(result.stderr).toContain('.claude/skills/custom/SKILL.md');
    expect(result.stderr).toContain('content/private.yml.bak');
    expect(git(installed, ['rev-parse', 'HEAD'])).toBe(installedHead);
    expectSystemState(installed, systemState);
    expect(git(installed, ['status', '--short', '--untracked-files=no'])).toBe(trackedStatus);
    expectPrivateFiles(installed, privateFiles);
  });
});
