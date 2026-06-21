// SPDX-License-Identifier: MIT
//
// Resolve the JobSpy Python venv location — deliberately OUTSIDE the repo tree.
//
// A venv's bin/python is a symlink to a base interpreter that lives outside the
// project (system / Homebrew / pyenv Python). `next build` (Turbopack)
// enumerates the whole project tree and panics on ANY symlink whose target
// escapes turbopack.root ("Symlink … points out of the filesystem root",
// vercel/next.js#88335). There is no Turbopack config to exclude a path from
// that enumeration, and `python -m venv --copies` is refused by framework
// Pythons (Xcode CommandLineTools, the macOS ~/.local shims). Keeping the venv
// in a per-user cache dir keyed by the checkout path sidesteps all of it: the
// build never sees it, each checkout gets its own isolated venv, and the
// interpreter keeps its working symlinks.

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cacheRoot = () => process.env.XDG_CACHE_HOME || join(homedir(), '.cache');

/** Per-checkout venv dir, e.g. ~/.cache/sur9e/jobspy-env-<hash>. */
export function jobspyVenvDir(root) {
  const key = createHash('sha1').update(root).digest('hex').slice(0, 12);
  return join(cacheRoot(), 'sur9e', `jobspy-env-${key}`);
}

/** The venv's python interpreter. */
export function jobspyVenvPython(root) {
  return join(jobspyVenvDir(root), 'bin', 'python');
}

/** Pre-2026-06-21 in-tree location; setup removes it so old checkouts stop
 *  tripping `next build`. */
export function legacyJobspyVenvDir(root) {
  return join(root, 'batch', 'jobspy-env');
}
