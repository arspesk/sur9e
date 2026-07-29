import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STRICT_SEMVER = /^\d+\.\d+\.\d+$/;

export function validateStrictSemver(version) {
  if (typeof version !== 'string' || !STRICT_SEMVER.test(version)) {
    throw new Error(
      `package.json version must be strict SemVer (X.Y.Z); received ${JSON.stringify(version)}`,
    );
  }
  return version;
}

export function packageVersion(packageJson) {
  return validateStrictSemver(JSON.parse(packageJson).version);
}

export function syncReleaseVersion(root = process.cwd()) {
  const packagePath = resolve(root, 'package.json');
  const versionPath = resolve(root, 'VERSION');
  const version = packageVersion(readFileSync(packagePath, 'utf8'));

  writeFileSync(versionPath, `${version}\n`, 'utf8');
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Synced VERSION to ${syncReleaseVersion()}`);
}
