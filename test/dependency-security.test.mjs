import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const lockfile = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));

function isAtLeast(version, minimum) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value);
    if (!match) throw new Error(`Invalid package version: ${value}`);
    return match.slice(1).map(Number);
  };

  const actual = parse(version);
  const required = parse(minimum);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

describe('dependency security policy', () => {
  it('keeps every resolved sharp package on the patched GHSA-f88m-g3jw-g9cj line', () => {
    const sharpPackages = Object.entries(lockfile.packages)
      .filter(([path]) => path === 'node_modules/sharp' || path.endsWith('/node_modules/sharp'))
      .map(([path, metadata]) => ({ path, version: metadata.version }));

    expect(sharpPackages, 'package-lock.json must resolve sharp').not.toHaveLength(0);
    for (const { path, version } of sharpPackages) {
      expect(version, path).toSatisfy(value => isAtLeast(value, '0.35.0'));
    }
  });
});
