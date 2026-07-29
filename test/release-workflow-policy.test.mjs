import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const RELEASE_WORKFLOW_PATH = resolve(ROOT, '.github/workflows/release.yml');
const RELEASE_PLEASE_ACTION =
  'googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7';
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SBOM_ACTION = 'anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610';
const PR_CREATED = "${{ steps.release.outputs.prs_created == 'true' }}";
const PUSH_EVENT = "${{ github.event_name == 'push' }}";
const SBOM_JOB_CONDITION =
  "${{ always() && ((github.event_name == 'push' && needs.release.result == 'success' && needs.release.outputs.release_created == 'true') || github.event_name == 'workflow_dispatch') }}";
const CURRENT_BRANCH_ASSIGNMENT = 'RELEASE_BRANCH="$(git branch --show-current)"';
const INVALID_BRANCH_GUARD = 'if [[ -z "$RELEASE_BRANCH" || "$RELEASE_BRANCH" == "main" ]]; then';
const COMMIT_SCRIPT_ORDER = [
  CURRENT_BRANCH_ASSIGNMENT,
  INVALID_BRANCH_GUARD,
  'git check-ref-format "refs/heads/$RELEASE_BRANCH"',
  'if git diff --quiet -- VERSION; then',
  'git add -- VERSION',
  'if git diff --cached --quiet -- VERSION; then',
  'git commit -m "chore(release): sync VERSION"',
  'git push origin "HEAD:refs/heads/$RELEASE_BRANCH"',
];

function loadReleaseWorkflow() {
  const source = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');
  const workflow = yaml.load(source);
  return {
    source,
    workflow,
    triggers: workflow.on ?? workflow.true ?? workflow[true],
    steps: workflow.jobs.release.steps,
  };
}

function stepByName(steps, name) {
  const step = steps.find(candidate => candidate.name === name);
  expect(step, `release workflow must define the "${name}" step`).toBeDefined();
  return step;
}

function commitScriptPolicyViolations(script) {
  const violations = [];
  let previousIndex = -1;

  for (const marker of COMMIT_SCRIPT_ORDER) {
    const index = script.indexOf(marker);
    if (index === -1) {
      violations.push(`missing required command: ${marker}`);
      continue;
    }
    if (index <= previousIndex) {
      violations.push(`required command is out of order: ${marker}`);
    }
    if (index !== script.lastIndexOf(marker)) {
      violations.push(`required command appears more than once: ${marker}`);
    }
    previousIndex = index;
  }

  for (const guard of [INVALID_BRANCH_GUARD]) {
    const start = script.indexOf(guard);
    const end = start === -1 ? -1 : script.indexOf('\nfi', start);
    const block = start === -1 || end === -1 ? '' : script.slice(start, end + 3);
    if (!block.includes('\n  exit 1\n')) {
      violations.push(`guard must fail closed with exit 1: ${guard}`);
    }
  }

  return violations;
}

function run(command, args, cwd, env = process.env) {
  const isolatedEnvironment = Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith('GIT_')),
  );
  return spawnSync(command, args, {
    cwd,
    env: isolatedEnvironment,
    encoding: 'utf8',
  });
}

function runChecked(command, args, cwd) {
  const result = run(command, args, cwd);
  expect(result.status, `${command} ${args.join(' ')}\n${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

function createCommitFixture(branch = 'release-please--branches--main') {
  const root = mkdtempSync(resolve(tmpdir(), 'sur9e-release-policy-'));
  const remote = resolve(root, 'remote.git');
  const checkout = resolve(root, 'checkout');

  mkdirSync(checkout);
  runChecked('git', ['init', '--bare', remote], root);
  runChecked('git', ['init', '--initial-branch', branch], checkout);
  runChecked('git', ['config', 'user.name', 'Test User'], checkout);
  runChecked('git', ['config', 'user.email', 'test@example.com'], checkout);
  writeFileSync(resolve(checkout, 'VERSION'), '0.2.0\n');
  runChecked('git', ['add', 'VERSION'], checkout);
  runChecked('git', ['commit', '-m', 'initial'], checkout);
  runChecked('git', ['remote', 'add', 'origin', remote], checkout);
  runChecked('git', ['push', '--set-upstream', 'origin', branch], checkout);

  return {
    branch,
    checkout,
    remote,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runCommitScript(script, fixture) {
  return run('bash', ['-c', script], fixture.checkout);
}

describe('release workflow policy', () => {
  it('runs Release Please only for pushes to main with its manifest and PAT', () => {
    const { workflow, triggers, steps } = loadReleaseWorkflow();

    expect(workflow.name).toBe('Release');
    expect(triggers).toEqual({
      push: { branches: ['main'] },
      workflow_dispatch: {
        inputs: {
          release_tag: {
            description: 'Existing release tag to repair (vX.Y.Z)',
            required: true,
            type: 'string',
          },
        },
      },
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': false,
    });
    expect(Object.keys(workflow.jobs)).toEqual(['release', 'sbom']);
    expect(workflow.jobs.release).toMatchObject({
      name: 'Release Please',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 15,
      if: PUSH_EVENT,
      outputs: {
        release_created: '${{ steps.release.outputs.release_created }}',
        tag_name: '${{ steps.release.outputs.tag_name }}',
        release_sha: '${{ steps.release.outputs.sha }}',
      },
    });

    expect(steps[0]).toEqual({
      name: 'Run Release Please',
      id: 'release',
      uses: RELEASE_PLEASE_ACTION,
      with: {
        token: '${{ secrets.RELEASE_PLEASE_TOKEN }}',
        'config-file': 'release-please-config.json',
        'manifest-file': '.release-please-manifest.json',
      },
    });
  });

  it('checks out the Release Please PR branch before synchronizing VERSION', () => {
    const { steps } = loadReleaseWorkflow();
    const checkout = stepByName(steps, 'Check out release PR branch');
    const sync = stepByName(steps, 'Synchronize VERSION');
    const commit = stepByName(steps, 'Commit synchronized VERSION');

    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(sync));
    expect(steps.indexOf(sync)).toBeLessThan(steps.indexOf(commit));
    expect(checkout).toEqual({
      name: 'Check out release PR branch',
      if: PR_CREATED,
      uses: CHECKOUT_ACTION,
      with: {
        ref: '${{ fromJSON(steps.release.outputs.pr).headBranchName }}',
        token: '${{ secrets.RELEASE_PLEASE_TOKEN }}',
      },
    });
    expect(sync).toEqual({
      name: 'Synchronize VERSION',
      if: PR_CREATED,
      run: 'node scripts/sync-release-version.mjs',
    });
  });

  it('commits only a changed VERSION back to the validated release branch', () => {
    const { steps } = loadReleaseWorkflow();
    const commit = stepByName(steps, 'Commit synchronized VERSION');

    expect(commit.if).toBe(PR_CREATED);
    expect(commit.env).toBeUndefined();
    expect(commit.run).toContain('set -euo pipefail');
    expect(commit.run).toContain(CURRENT_BRANCH_ASSIGNMENT);
    expect(commit.run).toMatch(/RELEASE_BRANCH.*main/);
    expect(commit.run).toContain('git check-ref-format "refs/heads/$RELEASE_BRANCH"');
    expect(commit.run).toContain('git diff --quiet -- VERSION');
    expect(commit.run).toContain('git add -- VERSION');
    expect(commit.run).toContain('git diff --cached --quiet -- VERSION');
    expect(commit.run).toContain('git commit -m "chore(release): sync VERSION"');
    expect(commit.run).toContain('git push origin "HEAD:refs/heads/$RELEASE_BRANCH"');
    expect(commit.run).not.toMatch(/\$\{\{\s*(?:fromJSON\(|steps\.release\.outputs)/);
    expect(commitScriptPolicyViolations(commit.run)).toEqual([]);
  });

  it('binds automatic SBOM generation to the Release Please SHA and tag', () => {
    const { workflow } = loadReleaseWorkflow();
    const job = workflow.jobs.sbom;
    const steps = job.steps;
    const resolveTarget = stepByName(steps, 'Resolve SBOM target');
    const checkout = stepByName(steps, 'Check out release source');
    const verify = stepByName(steps, 'Verify release provenance');
    const generate = stepByName(steps, 'Generate SPDX SBOM');
    const upload = stepByName(steps, 'Attach SBOM to GitHub release');

    expect(job).toMatchObject({
      name: 'Release SBOM',
      needs: 'release',
      if: SBOM_JOB_CONDITION,
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 10,
    });
    expect(steps.indexOf(resolveTarget)).toBeLessThan(steps.indexOf(checkout));
    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(verify));
    expect(steps.indexOf(verify)).toBeLessThan(steps.indexOf(generate));
    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(generate));
    expect(steps.indexOf(generate)).toBeLessThan(steps.indexOf(upload));
    expect(resolveTarget).toMatchObject({
      id: 'target',
      env: {
        EVENT_NAME: '${{ github.event_name }}',
        AUTOMATIC_RELEASE_TAG: '${{ needs.release.outputs.tag_name }}',
        AUTOMATIC_RELEASE_SHA: '${{ needs.release.outputs.release_sha }}',
        MANUAL_RELEASE_TAG: '${{ inputs.release_tag }}',
        GH_TOKEN: '${{ secrets.RELEASE_PLEASE_TOKEN }}',
      },
    });
    expect(resolveTarget.run).not.toMatch(
      /\$\{\{\s*(?:github\.event|inputs\.|needs\.release|steps\.)/,
    );
    expect(resolveTarget.run).toContain('checkout_ref="$release_sha"');
    expect(resolveTarget.run).toContain('checkout_ref="refs/tags/$release_tag"');
    expect(resolveTarget.run).toContain('[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]');
    expect(resolveTarget.run).toContain(
      'gh release view "$release_tag" --repo "$GITHUB_REPOSITORY"',
    );
    expect(checkout).toEqual({
      name: 'Check out release source',
      uses: CHECKOUT_ACTION,
      with: {
        ref: '${{ steps.target.outputs.checkout_ref }}',
        'fetch-depth': 0,
        'fetch-tags': true,
        'persist-credentials': false,
      },
    });
    expect(verify.env).toEqual({
      RELEASE_TAG: '${{ steps.target.outputs.release_tag }}',
      EXPECTED_RELEASE_SHA: '${{ steps.target.outputs.release_sha }}',
    });
    expect(verify.run).toContain('git rev-parse "$RELEASE_TAG^{commit}"');
    expect(verify.run).toContain('git rev-parse HEAD');
    expect(verify.run).toContain('if [[ "$tag_commit" != "$head_sha" ]]; then');
    expect(verify.run).toContain(
      'if [[ -n "$EXPECTED_RELEASE_SHA" && "$EXPECTED_RELEASE_SHA" != "$head_sha" ]]; then',
    );
    expect(verify.run).not.toMatch(/\$\{\{/);
    expect(generate).toEqual({
      name: 'Generate SPDX SBOM',
      uses: SBOM_ACTION,
      with: {
        path: '.',
        format: 'spdx-json',
        'output-file': 'sur9e.spdx.json',
        'upload-artifact': false,
        'upload-release-assets': false,
      },
    });
    expect(upload.env).toEqual({
      GH_TOKEN: '${{ secrets.RELEASE_PLEASE_TOKEN }}',
      RELEASE_TAG: '${{ steps.target.outputs.release_tag }}',
    });
    expect(upload.run).toBe('gh release upload "$RELEASE_TAG" sur9e.spdx.json --clobber');
  });

  it('manual dispatch repairs only an existing strict-semver release', () => {
    const { source, workflow } = loadReleaseWorkflow();
    const resolveTarget = stepByName(workflow.jobs.sbom.steps, 'Resolve SBOM target');

    expect(workflow.jobs.release.if).toBe(PUSH_EVENT);
    expect(workflow.jobs.sbom.if).toBe(SBOM_JOB_CONDITION);
    expect(resolveTarget.run).toContain(
      '[[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]',
    );
    expect(resolveTarget.run).toContain(
      'gh release view "$release_tag" --repo "$GITHUB_REPOSITORY"',
    );
    expect(source).not.toMatch(/\bgh release create\b|\bgit tag\b/);
  });

  it('does not publish packages, deploy, create a second release, or invoke AI notes', () => {
    const { source } = loadReleaseWorkflow();

    expect(source).not.toMatch(/\bnpm publish\b|\bdocker\b|\bdeploy(?:ment)?\b/i);
    expect(source).not.toMatch(/\bgh release create\b/i);
    expect(source).not.toMatch(/\bopenai\b|\banthropic\b|\bclaude\b|\bai[- ]authored\b/i);
  });
});

describe('release commit-script policy validator', () => {
  const { steps } = loadReleaseWorkflow();
  const script = stepByName(steps, 'Commit synchronized VERSION').run;

  it.each([
    [
      'commit before the change guards',
      script
        .replace('git commit -m "chore(release): sync VERSION"\n', '')
        .replace(
          'git add -- VERSION',
          'git commit -m "chore(release): sync VERSION"\n          git add -- VERSION',
        ),
    ],
    [
      'push before commit',
      script.replace(
        'git commit -m "chore(release): sync VERSION"\ngit push origin "HEAD:refs/heads/$RELEASE_BRANCH"',
        'git push origin "HEAD:refs/heads/$RELEASE_BRANCH"\ngit commit -m "chore(release): sync VERSION"',
      ),
    ],
    ['a non-failing main-branch guard', script.replace('exit 1', 'echo "continuing unsafely"')],
  ])('rejects %s', (_name, mutatedScript) => {
    expect(commitScriptPolicyViolations(mutatedScript)).not.toEqual([]);
  });

  it('does not create a commit when VERSION is unchanged', () => {
    const fixture = createCommitFixture();
    try {
      const before = runChecked('git', ['rev-parse', 'HEAD'], fixture.checkout);
      const result = runCommitScript(script, fixture);

      expect(result.status, result.stderr).toBe(0);
      expect(runChecked('git', ['rev-parse', 'HEAD'], fixture.checkout)).toBe(before);
      expect(
        runChecked('git', ['--git-dir', fixture.remote, 'show', `${fixture.branch}:VERSION`], '.'),
      ).toBe('0.2.0');
    } finally {
      fixture.cleanup();
    }
  });

  it('commits and pushes only VERSION on a valid release branch', () => {
    const fixture = createCommitFixture();
    try {
      writeFileSync(resolve(fixture.checkout, 'VERSION'), '0.3.0\n');
      const result = runCommitScript(script, fixture);

      expect(result.status, result.stderr).toBe(0);
      expect(runChecked('git', ['show', 'HEAD:VERSION'], fixture.checkout)).toBe('0.3.0');
      expect(
        runChecked('git', ['show', '--format=%s', '--no-patch', 'HEAD'], fixture.checkout),
      ).toBe('chore(release): sync VERSION');
      expect(
        runChecked(
          'git',
          ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
          fixture.checkout,
        ),
      ).toBe('VERSION');
      expect(
        runChecked('git', ['--git-dir', fixture.remote, 'show', `${fixture.branch}:VERSION`], '.'),
      ).toBe('0.3.0');
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    ['main', 'main', false],
    ['a detached HEAD', undefined, true],
  ])('rejects %s before committing or pushing', (_name, branch, detach) => {
    const fixture = createCommitFixture(branch);
    try {
      const before = runChecked('git', ['rev-parse', 'HEAD'], fixture.checkout);
      if (detach) {
        runChecked('git', ['checkout', '--detach'], fixture.checkout);
      }
      writeFileSync(resolve(fixture.checkout, 'VERSION'), '0.3.0\n');
      const result = runCommitScript(script, fixture);

      expect(result.status).not.toBe(0);
      expect(runChecked('git', ['rev-parse', 'HEAD'], fixture.checkout)).toBe(before);
      expect(
        runChecked('git', ['--git-dir', fixture.remote, 'show', `${fixture.branch}:VERSION`], '.'),
      ).toBe('0.2.0');
    } finally {
      fixture.cleanup();
    }
  });
});
