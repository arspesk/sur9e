import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

function git(directory, args, inheritedEnvironment = process.env) {
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
      env: isolatedGitEnvironment(directory, inheritedEnvironment),
    },
  ).trim();
}

function writeFixtureFile(directory, path, contents) {
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('update-system bootstrap migration', () => {
  it('ignores hostile inherited global hooks and signing configuration', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'sur9e-update-git-isolation-'));
    temporaryDirectories.push(directory);
    const hostileHome = resolve(directory, 'hostile-home');
    const hostileHooks = resolve(hostileHome, 'hooks');
    const hostileHookMarker = resolve(directory, 'hostile-hook-ran');
    const hostileGlobalConfig = resolve(hostileHome, 'gitconfig');

    writeFixtureFile(
      directory,
      'hostile-home/hooks/pre-commit',
      `#!/bin/sh\nprintf hostile > "${hostileHookMarker}"\nexit 1\n`,
    );
    chmodSync(resolve(hostileHooks, 'pre-commit'), 0o755);
    writeFixtureFile(
      directory,
      'hostile-home/gitconfig',
      `[core]\n\thooksPath = ${hostileHooks}\n[commit]\n\tgpgSign = true\n`,
    );
    const hostileEnvironment = {
      ...process.env,
      HOME: hostileHome,
      XDG_CONFIG_HOME: resolve(hostileHome, '.config'),
      GIT_CONFIG_GLOBAL: hostileGlobalConfig,
      GIT_CONFIG_NOSYSTEM: '0',
    };

    const environment = isolatedGitEnvironment(directory, hostileEnvironment);
    expect(environment.HOME).toBe(resolve(directory, '.fixture-home'));
    expect(environment.XDG_CONFIG_HOME).toBe(resolve(directory, '.fixture-home', '.config'));
    expect(environment.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(environment.GIT_CONFIG_GLOBAL).not.toBe(hostileGlobalConfig);

    git(directory, ['init', '--quiet'], hostileEnvironment);
    git(directory, ['config', 'user.email', 'sur9e-test@example.invalid'], hostileEnvironment);
    git(directory, ['config', 'user.name', 'sur9e test'], hostileEnvironment);
    writeFixtureFile(directory, 'tracked.txt', 'safe\n');
    git(directory, ['add', '--', 'tracked.txt'], hostileEnvironment);
    git(directory, ['commit', '--quiet', '-m', 'isolated commit'], hostileEnvironment);

    expect(existsSync(hostileHookMarker)).toBe(false);
  });

  it('delivers the updated updater static dependency through the legacy src allowlist', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'sur9e-update-bootstrap-'));
    temporaryDirectories.push(directory);

    git(directory, ['init', '--quiet']);
    expect(existsSync(resolve(directory, '.git'))).toBe(true);
    git(directory, ['config', 'user.email', 'sur9e-test@example.invalid']);
    git(directory, ['config', 'user.name', 'sur9e test']);
    writeFixtureFile(directory, 'update-system.mjs', "console.log('legacy updater');\n");
    writeFixtureFile(directory, 'src/legacy-marker.txt', 'legacy\n');
    writeFixtureFile(directory, 'VERSION', '0.2.0\n');
    git(directory, ['add', '--', 'update-system.mjs', 'src', 'VERSION']);
    git(directory, ['commit', '--quiet', '-m', 'legacy installation']);
    const legacyCommit = git(directory, ['rev-parse', 'HEAD']);

    copyTargetFile(directory, 'update-system.mjs');
    copyTargetFile(directory, 'scripts/repo-path-policy.mjs');
    copyTargetFile(directory, 'src/lib/repo-path-policy.mjs');
    git(directory, ['add', '--all']);
    git(directory, ['commit', '--quiet', '-m', 'target release']);
    const targetCommit = git(directory, ['rev-parse', 'HEAD']);

    git(directory, ['checkout', '--quiet', '--detach', legacyCommit]);

    // This is the material part of the legacy updater allowlist: the updated
    // updater and src/ arrive, while a new dependency under scripts/ does not.
    git(directory, ['checkout', targetCommit, '--', 'update-system.mjs', 'src']);

    symlinkSync(resolve(ROOT, 'node_modules'), resolve(directory, 'node_modules'), 'dir');
    writeFixtureFile(directory, '.update-dismissed', 'test\n');
    const result = spawnSync(process.execPath, ['update-system.mjs', 'check'], {
      cwd: directory,
      encoding: 'utf8',
      env: isolatedGitEnvironment(directory),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 'dismissed' });
    expect(existsSync(resolve(directory, 'src/lib/repo-path-policy.mjs'))).toBe(true);
    expect(existsSync(resolve(directory, 'scripts/repo-path-policy.mjs'))).toBe(false);
  });
});
