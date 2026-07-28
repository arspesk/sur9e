#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateTrackedPaths } from './repo-path-policy.mjs';

export function boundaryViolations(paths) {
  return privateTrackedPaths(paths);
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail =
      typeof error?.stderr === 'string' && error.stderr.trim() ? `: ${error.stderr.trim()}` : '';
    throw new Error(`Unable to inspect repository paths with git${detail}`, { cause: error });
  }
}

function nulFields(output, command) {
  if (output === '') return [];
  if (!output.endsWith('\0')) {
    throw new Error(`Malformed NUL-delimited output from ${command}`);
  }
  return output.slice(0, -1).split('\0');
}

function changedPaths(output) {
  const fields = nulFields(output, 'git diff');
  const paths = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!/^[ACMRTUXB](?:\d{1,3})?$/.test(status)) {
      throw new Error(`Unexpected git diff status: ${JSON.stringify(status)}`);
    }

    const pathCount = status.startsWith('R') || status.startsWith('C') ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error(`Incomplete git diff record for status ${status}`);
    }
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
      paths.push(fields[index++]);
    }
  }

  return paths;
}

function validateObjectId(name, value) {
  if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)) {
    throw new Error(`${name} must be a full 40- or 64-character hexadecimal object ID`);
  }
}

function pathsToCheck(args, environment) {
  if (args.length === 1 && args[0] === '--tracked') {
    return nulFields(gitOutput(['ls-files', '-z']), 'git ls-files');
  }
  if (args.length > 0) {
    throw new Error(`Unknown argument: ${args.join(' ')}`);
  }

  const baseSha = environment.BASE_SHA?.trim();
  const headSha = environment.HEAD_SHA?.trim();
  if (!baseSha || !headSha) {
    throw new Error('BASE_SHA and HEAD_SHA are required unless --tracked is used');
  }
  validateObjectId('BASE_SHA', baseSha);
  validateObjectId('HEAD_SHA', headSha);

  return changedPaths(
    gitOutput([
      'diff',
      '--find-renames',
      '--find-copies-harder',
      '--name-status',
      '-z',
      '--diff-filter=ACMRTUXB',
      `${baseSha}...${headSha}`,
      '--',
    ]),
  );
}

function main() {
  const violations = boundaryViolations(pathsToCheck(process.argv.slice(2), process.env));
  if (violations.length === 0) {
    console.log('OK: no private user-data paths detected.');
    return;
  }

  console.log('Private user-data paths detected:');
  for (const path of violations) console.log(path);
  process.exitCode = 1;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  try {
    main();
  } catch (error) {
    const modulePath = fileURLToPath(import.meta.url);
    console.error(`${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
