import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/pr-policy.yml');
const LABELER_PATH = resolve(ROOT, '.github/labeler.yml');

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

const workflow = loadYaml(WORKFLOW_PATH);
const labeler = loadYaml(LABELER_PATH);

function titleScript() {
  const step = workflow.jobs.title.steps.find(({ uses }) =>
    uses?.startsWith('actions/github-script@'),
  );
  expect(step, 'title job must use actions/github-script').toBeDefined();
  return step.with.script;
}

function validateTitle(title) {
  const failures = [];
  const context = { payload: { pull_request: { title } } };
  const core = { setFailed: message => failures.push(message) };

  Function('context', 'core', titleScript())(context, core);
  return failures;
}

function labelGlobs(label) {
  return labeler[label][0]['changed-files'][0]['any-glob-to-any-file'];
}

function globToRegExp(glob) {
  let source = '^';

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];

    if (character === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:[^/]+/)*';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (/[\^$+?.()|[\]{}]/.test(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }

  return new RegExp(`${source}$`);
}

function labelsFor(path) {
  return Object.keys(labeler).filter(label =>
    labelGlobs(label).some(glob => globToRegExp(glob).test(path)),
  );
}

describe('PR title policy', () => {
  it.each([
    'feat: add dashboard filters',
    'fix(api): handle timeouts',
    'perf(parser/cache-v2): reduce allocations',
    'refactor!: split the ingestion pipeline',
    'docs(readme)!: clarify setup',
    'ci(release.v2): enforce release checks',
    'test(e2e_suite): cover keyboard navigation',
    'fix: allow harmless trailing spaces   ',
  ])('accepts %j', title => {
    expect(validateTitle(title)).toEqual([]);
  });

  it.each([
    'chore:    ',
    'fix: valid title\n',
    'fix: valid title\r\nchore: injected title',
    'feat: ',
    'feat add dashboard filters',
    ': add dashboard filters',
    'style: format CSS',
    'feat(ui,api): add dashboard filters',
  ])('rejects %j', title => {
    expect(validateTitle(title)).toHaveLength(1);
  });

  it('returns a clear Conventional Commits example', () => {
    expect(validateTitle('not a valid title')[0]).toContain(
      'Example: "feat(ui): add application filters"',
    );
  });
});

describe('path label policy', () => {
  it('covers agent behavior configuration and hooks', () => {
    expect(labelGlobs('agent-behavior')).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      '.claude/skills/**',
      '.agents/skills/**',
      '.codex/**',
      '.claude/hooks/**',
      '.claude/settings.json',
    ]);

    expect(labelsFor('.codex/config.toml')).toContain('agent-behavior');
    expect(labelsFor('.claude/hooks/post-edit-check.mjs')).toContain('agent-behavior');
    expect(labelsFor('.claude/settings.json')).toContain('agent-behavior');
  });

  it('covers client hooks and stores as UI', () => {
    expect(labelGlobs('ui')).toEqual([
      'src/app/**/*.tsx',
      'src/app/**/*.css',
      'src/components/**',
      'src/features/**',
      'src/app/styles/**',
      'src/hooks/**',
      'src/stores/**',
    ]);

    expect(labelsFor('src/app/jobs/[id]/page.tsx')).toContain('ui');
    expect(labelsFor('src/app/globals.css')).toContain('ui');
    expect(labelsFor('src/hooks/use-applications.ts')).toContain('ui');
    expect(labelsFor('src/stores/drawer.ts')).toContain('ui');
  });

  it('covers shared schemas as server code', () => {
    expect(labelGlobs('server')).toEqual([
      'src/lib/server/**',
      'src/server/**',
      'src/app/api/**',
      'src/lib/schemas/**',
    ]);

    expect(labelsFor('src/lib/schemas/profile.ts')).toContain('server');
  });

  it('labels an API route as server but not UI', () => {
    const labels = labelsFor('src/app/api/jobs/route.ts');

    expect(labels).toContain('server');
    expect(labels).not.toContain('ui');
  });
});

describe('pull_request_target hardening', () => {
  it('does not check out or execute pull request repository code', () => {
    for (const job of Object.values(workflow.jobs)) {
      expect(job.uses, 'jobs must not call reusable workflows').toBeUndefined();

      for (const step of job.steps ?? []) {
        expect(step.uses, 'steps must not use actions/checkout').not.toMatch(
          /^actions\/checkout@/i,
        );
        expect(step.uses, 'steps must not use local actions').not.toMatch(/^\.\//);
        expect(step.run, 'steps must not run pull request code').toBeUndefined();
      }
    }
  });
});
