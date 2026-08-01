import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOWS_DIRECTORY = resolve(ROOT, '.github/workflows');
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_ACTION = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const UPLOAD_ARTIFACT_ACTION = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

function workflowPaths(directory = WORKFLOWS_DIRECTORY) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return workflowPaths(path);
      return /\.(?:ya?ml)$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

function displayPath(path) {
  return relative(ROOT, path);
}

function sourceLine(source, needle) {
  const index = source.split('\n').findIndex(line => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

function loadWorkflow(path) {
  const source = readFileSync(path, 'utf8');
  let workflow;

  try {
    workflow = yaml.load(source);
  } catch (error) {
    throw new Error(`${displayPath(path)}:1 must contain valid YAML: ${error.message}`, {
      cause: error,
    });
  }

  expect(workflow, `${displayPath(path)}:1 must parse to a workflow object`).toBeTypeOf('object');
  expect(workflow, `${displayPath(path)}:1 must parse to a workflow object`).not.toBeNull();
  return { path, source, workflow };
}

function workflowEntries() {
  const paths = workflowPaths();
  expect(paths, '.github/workflows:1 must contain at least one YAML workflow').not.toHaveLength(0);
  return paths.map(loadWorkflow);
}

function collectUses(value, path = [], entries = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUses(item, [...path, index], entries));
    return entries;
  }

  if (!value || typeof value !== 'object') return entries;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'uses' && typeof child === 'string')
      entries.push({ path: [...path, key], value: child });
    collectUses(child, [...path, key], entries);
  }

  return entries;
}

function workflowTriggers(workflow) {
  return workflow.on ?? workflow.true ?? workflow[true];
}

function hasTrigger(workflow, triggerName) {
  // YAML 1.1 parsers may coerce the `on` key to boolean true.
  const triggers = workflowTriggers(workflow);
  if (typeof triggers === 'string') return triggers === triggerName;
  if (Array.isArray(triggers)) return triggers.includes(triggerName);
  return Boolean(triggers && Object.hasOwn(triggers, triggerName));
}

function permissionPolicyViolations(workflow) {
  const violations = [];
  const jobs = Object.entries(workflow.jobs ?? {});
  const validateBlock = (permissions, needle, owner) => {
    if (permissions === 'read-all') return;
    if (permissions === 'write-all') {
      violations.push({ needle, message: `${owner} must not use permissions: write-all` });
      return;
    }
    if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions)) {
      violations.push({
        needle,
        message: `${owner} permissions must be read-all or a scope object`,
      });
      return;
    }

    for (const [scope, access] of Object.entries(permissions)) {
      if (!['read', 'write', 'none'].includes(access)) {
        violations.push({
          needle,
          message: `${owner} permission scope "${scope}" must be read, write, or none`,
        });
      }
    }
  };

  if (workflow.permissions === undefined) {
    if (jobs.length === 0) {
      violations.push({
        needle: 'jobs:',
        message: 'must declare workflow-level permissions or permissions on every job',
      });
    }
  } else {
    validateBlock(workflow.permissions, 'permissions:', 'workflow');
  }

  for (const [jobName, job] of jobs) {
    if (job?.permissions !== undefined) {
      validateBlock(job.permissions, `${jobName}:`, `job "${jobName}"`);
    } else if (workflow.permissions === undefined) {
      violations.push({
        needle: `${jobName}:`,
        message: `job "${jobName}" must declare permissions because the workflow has no workflow-level permissions`,
      });
    }
  }

  return violations;
}

function pullRequestTargetPolicyViolations(workflow) {
  if (!hasTrigger(workflow, 'pull_request_target')) return [];

  return collectUses(workflow).filter(entry => {
    const isJobLevelReusableWorkflow =
      entry.path.length === 3 && entry.path[0] === 'jobs' && entry.path[2] === 'uses';
    const action = entry.value.split('@', 1)[0].toLowerCase();
    return isJobLevelReusableWorkflow || action === 'actions/checkout' || action.startsWith('./');
  });
}

function coreJobPolicyViolations(jobName, job) {
  const expectedJobs = {
    quality: {
      name: 'Quick quality gate',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 15,
      steps: [
        { uses: CHECKOUT_ACTION },
        {
          uses: SETUP_NODE_ACTION,
          with: { 'node-version': 24, cache: 'npm' },
        },
        {
          name: 'Install dependencies',
          run: 'npm ci --no-audit --no-fund',
        },
        {
          name: 'Run quick quality gate',
          run: 'npm run test:quick',
        },
      ],
    },
    build: {
      name: 'Production build',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 15,
      steps: [
        { uses: CHECKOUT_ACTION },
        {
          uses: SETUP_NODE_ACTION,
          with: { 'node-version': 24, cache: 'npm' },
        },
        {
          name: 'Install dependencies',
          run: 'npm ci --no-audit --no-fund',
        },
        {
          name: 'Build production application',
          run: 'npm run build',
        },
      ],
    },
  };

  return isDeepStrictEqual(job, expectedJobs[jobName])
    ? []
    : ['must exactly match the approved deterministic job object and ordered steps'];
}

function parseFixture(source) {
  return yaml.load(source);
}

describe('GitHub Actions policy', () => {
  it('parses every workflow YAML file', () => {
    workflowEntries();
  });

  it('pins every external action to a full lowercase commit SHA', () => {
    for (const { path, source, workflow } of workflowEntries()) {
      for (const entry of collectUses(workflow)) {
        if (entry.value.startsWith('./')) continue;

        const line = sourceLine(source, entry.value);
        const separator = entry.value.lastIndexOf('@');
        const action = entry.value.slice(0, separator);
        const reference = separator === -1 ? '' : entry.value.slice(separator + 1);

        expect(
          action.length > 0 && FULL_COMMIT_SHA.test(reference),
          `${displayPath(path)}:${line} external action "${entry.value}" must be pinned to a full lowercase 40-character commit SHA`,
        ).toBe(true);
      }
    }
  });

  it('declares explicit permissions for every workflow', () => {
    for (const { path, source, workflow } of workflowEntries()) {
      for (const violation of permissionPolicyViolations(workflow)) {
        expect(
          violation,
          `${displayPath(path)}:${sourceLine(source, violation.needle)} ${violation.message}`,
        ).toBeUndefined();
      }
    }
  });

  it('never checks out repository code from pull_request_target workflows', () => {
    for (const { path, source, workflow } of workflowEntries()) {
      for (const entry of pullRequestTargetPolicyViolations(workflow)) {
        expect(
          entry,
          `${displayPath(path)}:${sourceLine(source, entry.value)} pull_request_target workflows must not use actions/checkout or local actions/reusable workflows`,
        ).toBeUndefined();
      }
    }
  });
});

describe('permissions policy validator', () => {
  const baseJob = { 'runs-on': 'ubuntu-latest', steps: [] };

  for (const [name, workflow] of [
    ['workflow write-all', { permissions: 'write-all', jobs: { test: baseJob } }],
    ['workflow invalid scalar', { permissions: 'admin', jobs: { test: baseJob } }],
    ['workflow null', { permissions: null, jobs: { test: baseJob } }],
    [
      'workflow invalid object value',
      { permissions: { contents: 'admin' }, jobs: { test: baseJob } },
    ],
    ['job write-all', { jobs: { test: { ...baseJob, permissions: 'write-all' } } }],
    ['job invalid scalar', { jobs: { test: { ...baseJob, permissions: 'admin' } } }],
    ['job null', { jobs: { test: { ...baseJob, permissions: null } } }],
    [
      'job invalid object value',
      { jobs: { test: { ...baseJob, permissions: { contents: 'admin' } } } },
    ],
    [
      'invalid job override under valid workflow permissions',
      {
        permissions: { contents: 'read' },
        jobs: { test: { ...baseJob, permissions: 'write-all' } },
      },
    ],
  ]) {
    it(`rejects ${name}`, () => {
      expect(permissionPolicyViolations(workflow)).not.toEqual([]);
    });
  }

  for (const [name, workflow] of [
    ['workflow read-all', { permissions: 'read-all', jobs: { test: baseJob } }],
    ['workflow empty object', { permissions: {}, jobs: { test: baseJob } }],
    [
      'workflow scoped object',
      {
        permissions: { contents: 'read', issues: 'write', deployments: 'none' },
        jobs: { test: baseJob },
      },
    ],
    [
      'valid permissions on every job',
      {
        jobs: {
          test: { ...baseJob, permissions: { contents: 'read' } },
          release: { ...baseJob, permissions: 'read-all' },
        },
      },
    ],
    [
      'valid job override under valid workflow permissions',
      {
        permissions: { contents: 'read' },
        jobs: { test: { ...baseJob, permissions: { issues: 'write' } } },
      },
    ],
  ]) {
    it(`allows ${name}`, () => {
      expect(permissionPolicyViolations(workflow)).toEqual([]);
    });
  }
});

describe('pull_request_target policy validator', () => {
  it('rejects mixed-case actions/checkout identifiers', () => {
    const workflow = parseFixture(`
on: pull_request_target
permissions: {}
jobs:
  unsafe:
    runs-on: ubuntu-latest
    steps:
      - uses: Actions/Checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
`);

    expect(pullRequestTargetPolicyViolations(workflow)).toHaveLength(1);
  });

  it('rejects local action and reusable-workflow indirection', () => {
    const workflow = parseFixture(`
on:
  pull_request_target:
permissions: {}
jobs:
  unsafe:
    uses: ./.github/workflows/unsafe.yml
`);

    expect(pullRequestTargetPolicyViolations(workflow)).toHaveLength(1);
  });

  it('rejects pinned external reusable workflows at the job level', () => {
    const workflow = parseFixture(`
on: pull_request_target
permissions: {}
jobs:
  unsafe:
    uses: owner/repo/.github/workflows/x.yml@0123456789abcdef0123456789abcdef01234567
`);

    expect(pullRequestTargetPolicyViolations(workflow)).toHaveLength(1);
  });

  it('allows pinned non-checkout actions at the step level', () => {
    const workflow = parseFixture(`
on: pull_request_target
permissions: {}
jobs:
  safe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567
`);

    expect(pullRequestTargetPolicyViolations(workflow)).toEqual([]);
  });
});

describe('core CI job validator', () => {
  const { workflow: coreWorkflow } = loadWorkflow(resolve(WORKFLOWS_DIRECTORY, 'test.yml'));
  const bypasses = [
    {
      name: 'an extra step',
      mutate(job) {
        job.steps.push({ name: 'Unexpected', run: 'echo extra' });
      },
    },
    {
      name: 'a duplicate checkout action',
      mutate(job) {
        job.steps.splice(1, 0, { uses: CHECKOUT_ACTION });
      },
    },
    {
      name: 'a duplicate setup-node action',
      mutate(job) {
        job.steps.splice(2, 0, {
          uses: SETUP_NODE_ACTION,
          with: { 'node-version': 24, cache: 'npm' },
        });
      },
    },
    {
      name: 'if false on the intended gate',
      mutate(job) {
        job.steps.at(-1).if = '${{ false }}';
      },
    },
    {
      name: 'continue-on-error on the intended gate',
      mutate(job) {
        job.steps.at(-1)['continue-on-error'] = true;
      },
    },
    {
      name: 'a checkout ref override',
      mutate(job) {
        job.steps[0].with = { ref: 'refs/heads/untrusted' };
      },
    },
    {
      name: 'job-level permission overrides',
      mutate(job) {
        job.permissions = { contents: 'write' };
      },
    },
    {
      name: 'altered step order',
      mutate(job) {
        [job.steps[0], job.steps[1]] = [job.steps[1], job.steps[0]];
      },
    },
    {
      name: 'an extra command in the install step',
      mutate(job) {
        job.steps[2].run = 'npm ci --no-audit --no-fund && npm audit';
      },
    },
  ];

  for (const { name, mutate } of bypasses) {
    it(`rejects ${name}`, () => {
      const job = structuredClone(coreWorkflow.jobs.quality);
      mutate(job);

      expect(coreJobPolicyViolations('quality', job)).not.toEqual([]);
    });
  }
});

describe('core CI workflow', () => {
  it('uses deterministic quality and production build jobs', () => {
    const path = resolve(WORKFLOWS_DIRECTORY, 'test.yml');
    const { source, workflow } = loadWorkflow(path);

    expect(workflow.name, `${displayPath(path)}:1 must be named CI`).toBe('CI');
    expect(
      workflowTriggers(workflow),
      `${displayPath(path)}:3 must run only for main pull requests and pushes`,
    ).toEqual({
      pull_request: { branches: ['main'] },
      push: { branches: ['main'] },
    });
    expect(
      workflow.permissions,
      `${displayPath(path)}:${sourceLine(source, 'permissions:')} must grant only contents read`,
    ).toEqual({ contents: 'read' });
    expect(
      workflow.concurrency,
      `${displayPath(path)}:${sourceLine(source, 'concurrency:')} must cancel superseded runs using the workflow and PR/ref identity`,
    ).toEqual({
      group: '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': true,
    });
    expect(
      Object.keys(workflow.jobs ?? {}),
      `${displayPath(path)}:${sourceLine(source, 'jobs:')} must define exactly two CI jobs`,
    ).toEqual(['quality', 'build']);

    for (const jobName of ['quality', 'build']) {
      const job = workflow.jobs[jobName];
      const location = `${displayPath(path)}:${sourceLine(source, `${jobName}:`)}`;

      for (const violation of coreJobPolicyViolations(jobName, job)) {
        expect(violation, `${location} ${violation}`).toBeUndefined();
      }
    }
  });
});

describe('CodeRabbit policy', () => {
  it('stays advisory and reviews every critical sur9e path', () => {
    const path = resolve(ROOT, '.coderabbit.yaml');
    const config = yaml.load(readFileSync(path, 'utf8'));

    expect(config.reviews.request_changes_workflow).toBe(false);
    expect(config.reviews.auto_review).toMatchObject({
      enabled: true,
      drafts: false,
      base_branches: ['main'],
      ignore_title_keywords: ['chore(main): release'],
    });

    const pathInstructions = config.reviews.path_instructions;
    expect(pathInstructions.every(item => item.instructions.trim().length > 0)).toBe(true);
    expect(pathInstructions.map(item => item.path)).toEqual(
      expect.arrayContaining([
        'CLAUDE.md',
        'AGENTS.md',
        'docs/data-contract.md',
        'src/lib/repo-path-policy.mjs',
        'src/lib/check-user-data-boundary.mjs',
        'content/modes/**',
        'src/lib/server/**',
        'src/server/actions/**',
        'src/app/api/**',
        'update-system.mjs',
        '.github/**',
        'test/e2e/**',
      ]),
    );

    const instructionFor = path =>
      pathInstructions.find(item => item.path === path)?.instructions ?? '';
    expect(instructionFor('CLAUDE.md')).toMatch(/byte-identical to AGENTS\.md/i);
    expect(instructionFor('AGENTS.md')).toMatch(/byte-identical to CLAUDE\.md/i);
    expect(instructionFor('docs/data-contract.md')).toMatch(/system-versus-user boundary/i);
    expect(instructionFor('src/lib/check-user-data-boundary.mjs')).toMatch(
      /inspect Git paths losslessly/i,
    );
    expect(instructionFor('.github/**')).toMatch(/full-SHA action pinning/i);
  });

  it('does not let public comments automatically activate write-capable chat', () => {
    const config = yaml.load(readFileSync(resolve(ROOT, '.coderabbit.yaml'), 'utf8'));

    expect(config.chat).toEqual({
      auto_reply: false,
      allow_non_org_members: false,
    });
  });
});

describe('browser smoke workflow', () => {
  it('builds once and runs the curated smoke with explicit mode and local binaries', () => {
    const path = resolve(WORKFLOWS_DIRECTORY, 'browser-smoke.yml');
    const { source, workflow } = loadWorkflow(path);
    const job = workflow.jobs.smoke;
    const runs = job.steps.map(step => step.run).filter(Boolean);

    expect(
      job.env,
      `${displayPath(path)}:${sourceLine(source, 'env:')} must enable deterministic empty-clone smoke mode`,
    ).toEqual({
      CI: 'true',
      PLAYWRIGHT_SMOKE_MODE: '1',
      PLAYWRIGHT_START_SERVER: '1',
      PLAYWRIGHT_PORT: '3109',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3109',
    });
    expect(runs, `${displayPath(path)} must build the production application`).toContain(
      'npm run build',
    );
    expect(
      runs,
      `${displayPath(path)} must install Chromium through the local package binary`,
    ).toContain('./node_modules/.bin/playwright install --with-deps chromium');
    expect(
      runs.some(run => run.includes('./node_modules/.bin/playwright test')),
      `${displayPath(path)} must execute Playwright through the local package binary`,
    ).toBe(true);
    expect(
      runs.some(run => /\bnpx\b/.test(run)),
      `${displayPath(path)} must never auto-resolve packages through npx`,
    ).toBe(false);
    expect(job.steps.at(-1).uses).toBe(UPLOAD_ARTIFACT_ACTION);
  });
});
