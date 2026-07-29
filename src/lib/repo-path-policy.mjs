// SPDX-License-Identifier: MIT

// Repository-owned paths updated by update-system.mjs.
export const SYSTEM_PATHS = Object.freeze([
  'content/',
  'src/',
  'public/',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  '.claude/skills/sur9e/',
  'docs/',
  'VERSION',
  'README.md',
  'LICENSE',
  'CLAUDE.md',
  'AGENTS.md',
  '.github/',
  '.coderabbit.yaml',
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'release-please-config.json',
  '.release-please-manifest.json',
  'playwright.config.ts',
  'biome.json',
  'tsconfig.json',
  '.prettierrc.json',
  '.prettierignore',
  '.env.example',
  'src/lib/git-porcelain.mjs',
  'src/lib/repo-path-policy.mjs',
  'src/lib/check-user-data-boundary.mjs',
  'scripts/sync-release-version.mjs',
  'update-system.mjs',
  'test-all.mjs',
]);

export const USER_PATH_PREFIXES = Object.freeze([
  'inputs/',
  'data/',
  'artifacts/',
  'batch/logs/',
  'batch/jobspy-env/',
  'batch/tracker-additions/',
  '.claude/memory/',
  '.claude/skills/',
  '.claude/worktrees/',
  '.antigravitycli/',
  '.playwright-mcp/',
  '.serena/',
  '.trash/',
  'test-results/',
  'tmp/',
]);

// Gitignore-style globs for private runtime files that cannot be represented
// as exact paths or whole-directory prefixes. Slashless patterns match a
// basename at any depth; slash-containing patterns are repository-relative.
// `*` never crosses `/`.
export const USER_PATH_PATTERNS = Object.freeze([
  '.resolved-prompt-*',
  '*.yaml.bak',
  '*.yml.bak',
  'batch/*.pid',
  'text_*.json',
]);

// Narrow project-owned paths nested inside a protected user prefix. These are
// explicit exceptions; SYSTEM_PATHS never overrides user ownership generally.
export const USER_PATH_EXCEPTIONS = Object.freeze(['.claude/skills/sur9e/']);

function readonlySet(values) {
  const target = new Set(values);
  const view = Object.create(Set.prototype);
  const rejectMutation = () => {
    throw new TypeError('Cannot mutate a read-only Set');
  };

  Object.defineProperties(view, {
    size: {
      get: () => target.size,
    },
    has: {
      value: target.has.bind(target),
    },
    keys: {
      value: target.keys.bind(target),
    },
    values: {
      value: target.values.bind(target),
    },
    entries: {
      value: target.entries.bind(target),
    },
    forEach: {
      value: (callback, thisArg) => {
        target.forEach(value => callback.call(thisArg, value, value, view));
      },
    },
    add: {
      value: rejectMutation,
    },
    delete: {
      value: rejectMutation,
    },
    clear: {
      value: rejectMutation,
    },
    [Symbol.iterator]: {
      value: target[Symbol.iterator].bind(target),
    },
    [Symbol.toStringTag]: {
      value: 'Set',
    },
  });

  return Object.freeze(view);
}

export const USER_PATH_FILES = readonlySet([
  '.env',
  '.update-dismissed',
  '.update-lock',
  '.prettierignore.local',
  '.claude/scheduled_tasks.lock',
  '.claude/settings.local.json',
  '.codex/hooks.json',
  'batch/batch-state.tsv',
  'batch/batch-input.tsv',
  'batch/jobspy-results.csv',
  'batch/screen-state.tsv',
  'batch/screened-urls.txt',
  'batch/stage1-results.tsv',
]);

export const TRACKED_SCAFFOLDING = readonlySet([
  'data/.gitkeep',
  'artifacts/interview-prep/.gitkeep',
  'artifacts/reports/.gitkeep',
  'artifacts/output/.gitkeep',
  'artifacts/lighthouse/.gitkeep',
  'inputs/jds/.gitkeep',
  'inputs/parsers/README.md',
  'batch/logs/.gitkeep',
  'batch/tracker-additions/.gitkeep',
]);

export function normalizeRepoPath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('Repository path must be a string');
  }

  const withForwardSlashes = path.replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:)/.test(withForwardSlashes)) {
    throw new Error(`Repository path must be relative: ${path}`);
  }

  const segments = withForwardSlashes.split('/');
  if (segments.includes('..')) {
    throw new Error(`Repository path must not traverse outside the repository: ${path}`);
  }

  return segments.filter(segment => segment !== '' && segment !== '.').join('/');
}

function matchesPath(path, candidates) {
  return candidates.some(candidate =>
    candidate.endsWith('/')
      ? path === candidate.slice(0, -1) || path.startsWith(candidate)
      : path === candidate,
  );
}

function matchesPattern(path, patterns) {
  return patterns.some(pattern => {
    const candidate = pattern.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1);
    const source = pattern
      .split('*')
      .map(segment => segment.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
      .join('[^/]*');
    return new RegExp(`^${source}$`, 'u').test(candidate);
  });
}

export function isUserPath(path) {
  const normalized = normalizeRepoPath(path);
  if (USER_PATH_FILES.has(normalized) || matchesPattern(normalized, USER_PATH_PATTERNS)) {
    return true;
  }
  if (TRACKED_SCAFFOLDING.has(normalized) || matchesPath(normalized, USER_PATH_EXCEPTIONS)) {
    return false;
  }
  return matchesPath(normalized, USER_PATH_PREFIXES);
}

export function isSystemPath(path) {
  const normalized = normalizeRepoPath(path);
  return !isUserPath(normalized) && matchesPath(normalized, SYSTEM_PATHS);
}

export function privateTrackedPaths(paths) {
  return [...new Set(paths.map(normalizeRepoPath).filter(isUserPath))].sort();
}
