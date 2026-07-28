import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncReleaseVersion } from '../scripts/sync-release-version.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

function readText(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const temporaryDirectories = [];

function createReleaseFixture(packageVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'sur9e-release-version-'));
  temporaryDirectories.push(directory);
  writeFileSync(
    resolve(directory, 'package.json'),
    JSON.stringify({ version: packageVersion }),
    'utf8',
  );
  writeFileSync(resolve(directory, 'VERSION'), '0.0.0\n', 'utf8');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release integrity', () => {
  it('keeps the stable VERSION and release metadata in sync', () => {
    const version = readText('VERSION').trim();
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const manifest = readJson('.release-please-manifest.json');

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(version);
    expect(packageLock.version).toBe(version);
    expect(packageLock.packages[''].version).toBe(version);
    expect(manifest['.']).toBe(version);
  });

  it('uses the approved Release Please node configuration', () => {
    const config = readJson('release-please-config.json');

    expect(config.$schema).toBe(
      'https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json',
    );
    expect(config['release-type']).toBe('node');
    expect(config['include-component-in-tag']).toBe(false);
    expect(config['include-v-in-tag']).toBe(true);
    expect(config['bump-minor-pre-major']).toBe(true);
    expect(config['bump-patch-for-minor-pre-major']).toBe(false);
  });

  it('syncs a stale bare VERSION from package.json', () => {
    const directory = createReleaseFixture('1.2.3');

    expect(syncReleaseVersion(directory)).toBe('1.2.3');
    expect(readFileSync(resolve(directory, 'VERSION'), 'utf8')).toBe('1.2.3\n');
  });

  it('refuses an invalid package version without changing VERSION', () => {
    const directory = createReleaseFixture('1.2.3-beta.1');

    expect(() => syncReleaseVersion(directory)).toThrow('strict SemVer');
    expect(readFileSync(resolve(directory, 'VERSION'), 'utf8')).toBe('0.0.0\n');
  });

  it('starts a deterministic changelog managed by Release Please', () => {
    expect(readText('CHANGELOG.md')).toContain('# Changelog');
  });
});
