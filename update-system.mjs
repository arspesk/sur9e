#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * update-system.mjs — Safe auto-updater for sur9e
 *
 * Updates ONLY system layer files (modes, scripts, templates).
 * NEVER touches user data (inputs/personalization/, data/, artifacts/reports/).
 *
 * Usage:
 *   node update-system.mjs check      # Check if update available
 *   node update-system.mjs apply      # Apply update (after user confirms)
 *   node update-system.mjs rollback   # Rollback last update
 *   node update-system.mjs dismiss    # Dismiss update check
 *
 * See docs/data-contract.md for the full system/user layer definitions.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseNulPaths, parsePorcelainV1Z } from './src/lib/git-porcelain.mjs';
import { isSystemPath, isUserPath, SYSTEM_PATHS } from './src/lib/repo-path-policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const MIN_NODE_MAJOR = 24;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const COMMIT_TIMEOUT_MS = 15 * 60_000;

// Update source repo (GitHub "<owner>/<repo>" slug). Defaults to the public
// repo. Maintainers / fork users can override with the UPDATE_REPO env var
// (e.g. UPDATE_REPO=<owner>/<my-fork>); Settings (inputs/config/config.yml,
// system.update_source) can still override both — see resolveUpdateRemote().
const DEFAULT_REPO_SLUG = 'arspesk/sur9e';
const envRepoSlug = (process.env.UPDATE_REPO || '').trim();
if (envRepoSlug && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(envRepoSlug)) {
  console.error(`[update] invalid UPDATE_REPO "${envRepoSlug}" — using ${DEFAULT_REPO_SLUG}`);
}
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(envRepoSlug)
  ? envRepoSlug
  : DEFAULT_REPO_SLUG;
const CANONICAL_REPO = `https://github.com/${REPO_SLUG}.git`;
const RAW_VERSION_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/main/VERSION`;
const RELEASES_API = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

// User-configurable update remote (Settings → Updates & about writes
// system.update_source / system.update_branch in inputs/config/config.yml).
// Falls back to the canonical repo for missing/non-GitHub values. Read with
// js-yaml directly — this script must run standalone, no zod/TS imports.
function resolveUpdateRemote() {
  const fallback = {
    repo: CANONICAL_REPO,
    branch: 'main',
    rawVersionUrl: RAW_VERSION_URL,
    releasesApi: RELEASES_API,
  };
  try {
    const cfgPath = join(ROOT, 'inputs', 'config', 'config.yml');
    if (!existsSync(cfgPath)) return fallback;
    const cfg = yaml.load(readFileSync(cfgPath, 'utf-8')) || {};
    const sys = cfg.system ?? cfg.advanced?.system ?? {};
    const source =
      typeof sys.update_source === 'string' && sys.update_source.trim()
        ? sys.update_source.trim()
        : CANONICAL_REPO;
    const branch =
      typeof sys.update_branch === 'string' && sys.update_branch.trim()
        ? sys.update_branch.trim()
        : 'main';

    // config-supplied strings reach git argv — reject flag-shaped values.
    // branch goes directly to git fetch argv and into raw URLs, so enforce
    // a strict safe-char allowlist (slashes allowed for feature/x branches).
    if (!/^[A-Za-z0-9._\/-]+$/.test(branch) || branch.startsWith('-')) {
      console.error(`[update] invalid update_branch "${branch}" — using canonical repo`);
      return fallback;
    }

    // Anchored GitHub URL matcher — accepts exactly:
    //   https://github.com/<owner>/<repo>[.git][/]
    //   git@github.com:<owner>/<repo>[.git]
    // Rejects substrings like notgithub.com, trailing junk, flag-shaped strings.
    const m = source.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
    );
    if (!m) {
      console.error(`[update] unsupported update_source "${source}" — using canonical repo`);
      return fallback;
    }
    const [, owner, repoName] = m;
    return {
      repo: source,
      branch,
      rawVersionUrl: `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/VERSION`,
      releasesApi: `https://api.github.com/repos/${owner}/${repoName}/releases/latest`,
    };
  } catch {
    return fallback;
  }
}
const REMOTE = resolveUpdateRemote();

function workingVersion() {
  const vPath = join(ROOT, 'VERSION');
  return existsSync(vPath) ? readFileSync(vPath, 'utf-8').trim() : '0.0.0';
}

function committedVersion() {
  try {
    return execFileSync('git', ['show', 'HEAD:VERSION'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    }).trim();
  } catch {
    return workingVersion();
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

function gitWithTimeout(timeout, ...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout }).trim();
}

function git(...args) {
  return gitWithTimeout(DEFAULT_COMMAND_TIMEOUT_MS, ...args);
}

function validateRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    throw new Error(`sur9e updates require Node ${MIN_NODE_MAJOR}+; found ${process.version}`);
  }
  execFileSync('npm', ['--version'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function installDependencies() {
  execFileSync('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], {
    cwd: ROOT,
    timeout: INSTALL_TIMEOUT_MS,
    stdio: 'inherit',
  });
}

function gitStatusEntries() {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: ROOT,
    timeout: 30000,
  });
  return parsePorcelainV1Z(status);
}

function revertPaths(paths) {
  if (paths.length === 0) return;
  // Restore index + worktree from HEAD — also resurrects files staged for
  // deletion by the sync step (plain `git checkout --` can't, since `git rm`
  // removed them from the index too).
  git('checkout', 'HEAD', '--', ...paths);
}

function restoreCommittedSystemState() {
  const changedSystemPaths = [
    ...new Set(
      gitStatusEntries()
        .map(entry => entry.path)
        .filter(isSystemPath),
    ),
  ];
  for (const path of changedSystemPaths) {
    try {
      git('checkout', 'HEAD', '--', path);
    } catch {
      // The path was added by the fetched tree and does not exist in HEAD.
      git('rm', '-f', '--ignore-unmatch', '--', path);
      rmSync(join(ROOT, path), { recursive: true, force: true });
    }
  }
}

// True sync for one system path: `git checkout <ref> -- <path>` only
// overwrites/creates, so files deleted or renamed in the target tree would
// otherwise linger (stale duplicate Next.js routes can brick the build).
// Lists tracked files that exist in fromRef but not in toRef under `path`
// and removes them. Safety by construction: the diff is pathspec-scoped to a
// SYSTEM_PATH, only tracked files can appear (gitignored user content never
// does), and each candidate is re-checked against the shared system/user path
// policy before removal.
function removeFilesAbsentInTarget(fromRef, toRef, path) {
  const removed = [];
  let deleted;
  try {
    deleted = execFileSync(
      'git',
      ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=D', fromRef, toRef, '--', path],
      { cwd: ROOT, timeout: 30000 },
    );
  } catch {
    return removed; // ref/pathspec problems — skip deletion sync for this path
  }
  for (const file of parseNulPaths(deleted)) {
    if (!isSystemPath(file) || isUserPath(file)) continue; // defense in depth
    try {
      git('rm', '-f', '--ignore-unmatch', '--', file);
      removed.push(file);
    } catch {
      // Leave the stale file in place rather than fail the whole update
    }
  }
  return removed;
}

function privatePathsInTree(ref) {
  const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', ref], {
    cwd: ROOT,
    timeout: 30000,
  });
  return [...new Set(parseNulPaths(tracked).filter(isUserPath))].sort();
}

function addPaths(paths) {
  if (paths.length === 0) return;
  git('add', '--', ...paths);
}

// ── CHECK ───────────────────────────────────────────────────────

async function check() {
  // Respect dismiss flag
  if (existsSync(join(ROOT, '.update-dismissed'))) {
    console.log(JSON.stringify({ status: 'dismissed' }));
    return;
  }

  const local = committedVersion();
  let remote;

  try {
    const res = await fetch(REMOTE.rawVersionUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    remote = (await res.text()).trim();
  } catch {
    console.log(JSON.stringify({ status: 'offline', local }));
    return;
  }

  if (compareVersions(local, remote) >= 0) {
    console.log(JSON.stringify({ status: 'up-to-date', local, remote }));
    return;
  }

  // Fetch changelog from GitHub releases
  let changelog = '';
  let releaseDate = '';
  let releaseUrl = '';
  try {
    const res = await fetch(REMOTE.releasesApi, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (res.ok) {
      const release = await res.json();
      changelog = release.body || '';
      releaseDate = release.published_at || release.created_at || '';
      releaseUrl = release.html_url || '';
    }
  } catch {
    // No changelog available, that's OK
  }

  console.log(
    JSON.stringify({
      status: 'update-available',
      local,
      remote,
      changelog: changelog.slice(0, 10_000),
      ...(releaseDate ? { releaseDate } : {}),
      ...(releaseUrl ? { releaseUrl } : {}),
    }),
  );
}

// ── APPLY ───────────────────────────────────────────────────────

async function apply() {
  try {
    validateRuntime();
  } catch (error) {
    console.error(`Update runtime check failed: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  const local = committedVersion();
  const initialStatusEntries = gitStatusEntries();
  const initialStatusPaths = new Set(initialStatusEntries.map(entry => entry.path));

  // Refuse to overwrite uncommitted local edits in system paths — the backup
  // branch is created from HEAD, so checkout FETCH_HEAD would clobber them
  // with no recovery path.
  const dirtySystem = initialStatusEntries.filter(entry => isSystemPath(entry.path));
  if (dirtySystem.length > 0) {
    console.error('Uncommitted changes in system files — commit or stash them first:');
    for (const entry of dirtySystem) console.error(`  ${entry.code} ${entry.path}`);
    process.exit(2);
  }

  // Check for lock
  const lockFile = join(ROOT, '.update-lock');
  if (existsSync(lockFile)) {
    console.error(
      'Update already in progress (.update-lock exists). If stuck, delete it manually.',
    );
    process.exit(2);
  }

  // Create lock
  writeFileSync(lockFile, new Date().toISOString());

  let checkoutStarted = false;
  let dependencyInstallStarted = false;
  try {
    // 1. Fetch from canonical repo
    console.log('Fetching latest from upstream...');
    git('fetch', REMOTE.repo, REMOTE.branch);

    // 2. Fail closed before checkout if a custom/future upstream contains
    // protected user paths. A broad checkout such as `content/` could
    // otherwise overwrite an ignored local backup before the post-check can
    // recover it.
    const upstreamPrivatePaths = privatePathsInTree('FETCH_HEAD');
    if (upstreamPrivatePaths.length > 0) {
      console.error('Upstream update contains protected user paths — aborting before checkout:');
      for (const path of upstreamPrivatePaths) console.error(`  ${path}`);
      process.exitCode = 2;
      return;
    }

    // 3. Backup: create branch only after the fetched tree passes preflight.
    const backupBranch = `backup-pre-update-${local}-${git('rev-parse', '--short=12', 'HEAD')}`;
    try {
      git('branch', backupBranch);
      console.log(`Backup branch created: ${backupBranch}`);
    } catch {
      console.log(`Backup branch already exists (${backupBranch}), continuing...`);
    }

    // 4. Checkout system files only, then sync deletions: checkout alone
    // never removes files, so anything deleted/renamed upstream must be
    // explicitly removed or it lingers (stale routes break the build).
    console.log('Updating system files...');
    checkoutStarted = true;
    const updated = [];
    const removed = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', 'FETCH_HEAD', '--', path);
        updated.push(path);
      } catch {
        // Path may not exist in remote (or was removed entirely), skip
      }
      removed.push(...removeFilesAbsentInTarget('HEAD', 'FETCH_HEAD', path));
    }
    if (removed.length > 0) {
      console.log(`Removed ${removed.length} file(s) deleted upstream.`);
    }

    // 5. Validate: check NO user files were touched
    let userFileTouched = false;
    try {
      for (const entry of gitStatusEntries()) {
        const file = entry.path;
        if (initialStatusPaths.has(file)) continue;
        if (isUserPath(file)) {
          console.error(`SAFETY VIOLATION: User file was modified: ${file}`);
          userFileTouched = true;
        }
      }
    } catch {
      // git status failed, skip validation
    }

    if (userFileTouched) {
      console.error('Aborting: user files were touched. Rolling back...');
      revertPaths([...updated, ...removed]);
      unlinkSync(lockFile); // process.exit skips the finally block
      process.exit(1);
    }

    // 6. Install the exact dependency tree. Failure is fatal because an
    // incomplete node_modules cannot safely build or run the fetched version.
    dependencyInstallStarted = true;
    installDependencies();

    // 7. Commit the update
    const remote = workingVersion(); // Re-read after checkout updated VERSION
    const dismissFile = join(ROOT, '.update-dismissed');
    if (existsSync(dismissFile)) unlinkSync(dismissFile); // gitignored — never staged
    addPaths(updated);
    if (git('diff', '--cached', '--name-only')) {
      try {
        gitWithTimeout(
          COMMIT_TIMEOUT_MS,
          'commit',
          '-m',
          `chore: auto-update system files to v${remote}`,
        );
      } catch (err) {
        throw new Error(`commit failed: ${err.message}`);
      }
    }

    console.log(`\nUpdate complete: v${local} → v${remote}`);
    console.log(`Updated ${updated.length} system paths.`);
    console.log(`Rollback available: node update-system.mjs rollback`);
  } catch (error) {
    if (checkoutStarted) {
      let filesRestored = false;
      try {
        restoreCommittedSystemState();
        filesRestored = true;
        console.error('Update failed; restored the previous committed version.');
      } catch (restoreError) {
        console.error(`Update failed and automatic file recovery failed: ${restoreError.message}`);
      }
      if (filesRestored && dependencyInstallStarted) {
        try {
          installDependencies();
        } catch (dependencyError) {
          console.error(
            `Previous system files were restored, but dependency recovery failed: ${dependencyError.message}`,
          );
        }
      }
      process.exitCode = 1;
    } else {
      console.error(`Update failed before changing system files: ${error.message}`);
      process.exitCode = 2;
    }
  } finally {
    // Remove lock
    if (existsSync(lockFile)) unlinkSync(lockFile);
  }
}

// ── ROLLBACK ────────────────────────────────────────────────────

function rollback() {
  // Find most recent backup branch
  try {
    const branches = git(
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/heads/backup-pre-update-*',
    );
    const branchList = branches
      .split('\n')
      .map(b => b.trim())
      .filter(Boolean);

    if (branchList.length === 0) {
      console.error('No backup branches found. Nothing to rollback.');
      process.exit(1);
    }

    const latest = branchList[0];
    const backupPrivatePaths = privatePathsInTree(latest);
    if (backupPrivatePaths.length > 0) {
      console.error('Backup contains protected user paths — aborting before checkout:');
      for (const path of backupPrivatePaths) console.error(`  ${path}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Rolling back to: ${latest}`);

    // Checkout system files from backup branch, then sync deletions: files
    // the bad update ADDED don't exist in the backup, so checkout alone
    // leaves them behind — remove anything absent from the backup tree.
    const updated = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', latest, '--', path);
        updated.push(path);
      } catch {
        // File may not have existed in backup
      }
      removeFilesAbsentInTarget('HEAD', latest, path);
    }

    // removeFilesAbsentInTarget uses `git rm`, so deletions are already staged.
    addPaths([...new Set(updated)]);
    if (!git('diff', '--cached', '--name-only')) {
      console.log(`Checkout already matches ${latest}; no rollback commit needed.`);
      return;
    }
    // A rollback restores an already committed tree. Skip the full pre-commit
    // gate here so recovery cannot exceed the wrapper timeout before npm ci
    // and the worker's health verification run.
    gitWithTimeout(
      COMMIT_TIMEOUT_MS,
      'commit',
      '--no-verify',
      '-m',
      `chore: rollback system files from ${latest}`,
    );

    console.log(`Rollback complete. System files restored from ${latest}.`);
    console.log('Your data (CV, profile, tracker, reports) was not affected.');
  } catch (err) {
    console.error('Rollback failed:', err.message);
    process.exit(1);
  }
}

// ── DISMISS ─────────────────────────────────────────────────────

function dismiss() {
  writeFileSync(join(ROOT, '.update-dismissed'), new Date().toISOString());
  console.log(
    'Update check dismissed. Run "node update-system.mjs check" or say "check for updates" to re-enable.',
  );
}

// ── MAIN ────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'check';

switch (cmd) {
  case 'check':
    await check();
    break;
  case 'apply':
    await apply();
    break;
  case 'rollback':
    rollback();
    break;
  case 'dismiss':
    dismiss();
    break;
  default:
    console.log('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
    process.exit(1);
}
