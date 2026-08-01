import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const issueTemplate = name => resolve(ROOT, '.github/ISSUE_TEMPLATE', name);
const loadYaml = path => yaml.load(readFileSync(path, 'utf8'));
const requiredConfirmations = [
  'I have searched existing issues for duplicates.',
  'I have removed secrets, CV content, and personal data.',
];

const taxonomy = {
  type: ['type:bug', 'type:feature', 'type:question', 'type:task'],
  area: ['area:web', 'area:agent', 'area:jobs', 'area:data', 'area:tooling', 'area:docs'],
  priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
  status: ['status:needs-triage', 'status:needs-info', 'status:accepted', 'status:declined'],
  resolution: ['resolution:duplicate', 'resolution:invalid', 'resolution:wontfix'],
};

function fieldIds(form) {
  return form.body.filter(field => field.type !== 'markdown').map(field => field.id);
}

describe('GitHub Issue Forms', () => {
  it('disables blank issues and routes security reports to the security policy and email', () => {
    const config = loadYaml(issueTemplate('config.yml'));
    expect(config.blank_issues_enabled).toBe(false);
    expect(config.contact_links).toHaveLength(1);
    expect(config.contact_links[0]).toMatchObject({
      name: expect.stringMatching(/security/i),
      url: expect.stringMatching(/^https:\/\/.+SECURITY\.md$/),
      about: expect.stringContaining('hello@sur9e.com'),
    });
    expect(config.contact_links.every(link => /^https:\/\//.test(link.url))).toBe(true);
  });

  it.each([
    [
      'bug.yml',
      'Bug report',
      'type:bug',
      ['expected', 'actual', 'reproduction', 'environment', 'evidence'],
    ],
    [
      'feature.yml',
      'Feature request',
      'type:feature',
      ['problem', 'affected_user', 'outcome', 'alternatives', 'mission_fit'],
    ],
    ['question.yml', 'Question', 'type:question', ['goal', 'question', 'tried', 'context']],
  ])('defines the required %s fields and privacy confirmation', (path, title, typeLabel, ids) => {
    const form = loadYaml(issueTemplate(path));
    expect(form.name).toBe(title);
    expect(form.labels).toEqual([typeLabel, 'status:needs-triage']);
    expect(fieldIds(form)).toEqual(expect.arrayContaining([...ids, 'privacy_confirmation']));

    const confirmation = form.body.find(field => field.id === 'privacy_confirmation');
    expect(confirmation).toMatchObject({
      type: 'checkboxes',
      validations: { required: true },
      attributes: {
        options: expect.arrayContaining(
          requiredConfirmations.map(label => expect.objectContaining({ label, required: true })),
        ),
      },
    });
    expect(confirmation.attributes.options).toHaveLength(2);

    for (const id of ids.filter(id => id !== 'evidence')) {
      expect(form.body.find(field => field.id === id)?.validations?.required).toBe(true);
    }
    expect(form.body.find(field => field.id === 'evidence')?.validations?.required).not.toBe(true);
  });
});

describe('issue label manifest', () => {
  it('defines exactly the issue taxonomy with unique names and category colors', () => {
    const labels = loadYaml(resolve(ROOT, '.github/issue-labels.yml')).labels;
    const names = labels.map(label => label.name);
    expect(names).toEqual(Object.values(taxonomy).flat());
    expect(new Set(names).size).toBe(names.length);
    expect(
      labels.every(label => /^[0-9a-f]{6}$/i.test(label.color) && label.description.length > 12),
    ).toBe(true);

    const colors = Object.fromEntries(labels.map(label => [label.name, label.color]));
    expect(new Set(taxonomy.type.map(name => colors[name])).size).toBe(1);
    expect(new Set(taxonomy.area.map(name => colors[name])).size).toBe(1);
    expect(new Set(taxonomy.resolution.map(name => colors[name])).size).toBe(1);
  });
});

describe('issue triage automation policy', () => {
  it('adds the labels script without changing the existing PR labeler', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(packageJson.scripts['github:labels']).toBe('node scripts/sync-github-labels.mjs');

    const labeler = loadYaml(resolve(ROOT, '.github/labeler.yml'));
    expect(Object.keys(labeler)).toEqual([
      'ui',
      'server',
      'agent-behavior',
      'modes',
      'scripts',
      'tests',
      'documentation',
      'dependencies',
      'ci',
    ]);
  });

  it('keeps CodeRabbit advisory and constrains it to triage-only issue enrichment', () => {
    const config = loadYaml(resolve(ROOT, '.coderabbit.yaml'));
    expect(config.reviews.auto_review).toMatchObject({ enabled: true, drafts: false });
    expect(config.chat).toEqual({ auto_reply: false, allow_non_org_members: false });
    expect(config.issue_enrichment).toMatchObject({
      auto_enrich: { enabled: true },
      labeling: { auto_apply_labels: true },
      planning: { enabled: false, auto_planning: { enabled: false } },
    });

    const instructions = config.issue_enrichment.labeling.labeling_instructions;
    const allowedLabels = [
      ...taxonomy.type,
      ...taxonomy.area,
      ...taxonomy.priority,
      'status:needs-info',
    ];
    expect(instructions).toHaveLength(allowedLabels.length);
    expect(instructions.map(entry => entry.label)).toEqual(allowedLabels);
    expect(instructions.every(entry => typeof entry.instructions === 'string')).toBe(true);

    const guidance = instructions.map(entry => entry.instructions).join(' ');
    expect(guidance).toContain('exactly one type');
    expect(guidance).toContain('exactly one primary area');
    expect(guidance).toContain('exactly one priority');
    expect(guidance).toContain('status:needs-info');
    for (const forbidden of [
      'must not apply status:accepted',
      'must not apply status:declined',
      'must not apply any resolution:',
      'must not make acceptance',
      'must not make closure',
    ]) {
      expect(guidance).toContain(forbidden);
    }
  });

  it('uses a least-privilege issue-only workflow with no unsafe template interpolation', () => {
    const path = resolve(ROOT, '.github/workflows/issue-triage.yml');
    const source = readFileSync(path, 'utf8');
    const workflow = loadYaml(path);
    const triggers = workflow.on ?? workflow.true ?? workflow[true];

    expect(triggers.issues.types).toEqual(['labeled', 'edited']);
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(workflow.concurrency).toEqual({
      group: 'issue-triage-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(source).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(source).toContain('node scripts/triage-github-issue.mjs');
    expect(source).toContain('ISSUE_BODY_CHANGED: ${{ github.event.changes.body != null }}');
    expect(source).not.toContain('ISSUE_LABELS_JSON');
    expect(source).not.toMatch(/run:[\s\S]*\$\{\{/);
    expect(source).not.toMatch(/issues: (?:read-all|write-all)/);
  });
});

describe('triage documentation', () => {
  it('links the contributor guide to the human-owned weekly zero-inbox policy', () => {
    const contributing = readFileSync(resolve(ROOT, 'CONTRIBUTING.md'), 'utf8');
    const docs = readFileSync(resolve(ROOT, 'docs/triage.md'), 'utf8');

    expect(contributing).toContain('docs/triage.md');
    expect(docs).toContain('is:issue is:open label:"status:needs-triage" sort:created-asc');
    expect(docs).toContain('7 days');
    expect(docs).toContain('CodeRabbit');
    expect(docs).toContain('Editing the issue body');
    expect(docs).toMatch(/no Codex delegation/i);
    expect(docs).toMatch(/no Claude delegation/i);
    expect(docs).toMatch(/no issue\s+implementation planning in phase one/i);
    expect(docs).toMatch(/No Linear|no Linear/i);
    expect(docs).toMatch(/No .*Projects|no .*Projects/i);
    expect(docs).toMatch(/No reminder bot|no reminder bot/i);
    expect(docs).toContain('Activation');
    expect(docs).toContain('npm run github:labels -- --repo arspesk/sur9e');
    expect(docs).toContain('npm run github:labels -- --repo arspesk/sur9e --apply');
    expect(docs).toContain('gh label list --repo arspesk/sur9e');
    expect(docs).toContain('all 21 label names');
    expect(docs).toMatch(/inactive.*human-gated|human-gated.*inactive/i);
  });
});
