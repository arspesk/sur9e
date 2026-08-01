import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import yaml from 'js-yaml';
import { ISSUE_LABEL_GROUPS } from './lib/issue-triage-labels.mjs';

const execFile = promisify(execFileCallback);
const MANIFEST_URL = new URL('../.github/issue-labels.yml', import.meta.url);
const ISSUE_LABEL_NAMES = Object.values(ISSUE_LABEL_GROUPS).flat();
const MAX_DESCRIPTION_LENGTH = 100;

export function parseArgs(args) {
  let apply = false;
  let repo;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--repo') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--repo requires an OWNER/REPO value.');
      }
      repo = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}. Use --apply and/or --repo OWNER/REPO.`);
  }

  if (repo && !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('--repo must use OWNER/REPO format.');
  }

  return { apply, repo };
}

export function repoFromOrigin(origin) {
  const source = origin.trim();
  const patterns = [
    /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:(?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i,
  ];
  const match = patterns.map(pattern => source.match(pattern)).find(Boolean);
  return match ? `${match.groups.owner}/${match.groups.repo}` : undefined;
}

export function validateLabels(labels) {
  if (!Array.isArray(labels)) throw new Error('Issue labels must be an array.');
  if (labels.length !== ISSUE_LABEL_NAMES.length) {
    throw new Error(`Issue labels must define exactly ${ISSUE_LABEL_NAMES.length} labels.`);
  }

  const names = [];
  for (const label of labels) {
    if (!label || typeof label !== 'object' || Array.isArray(label)) {
      throw new Error('Every issue label must be an object.');
    }
    if (typeof label.name !== 'string' || !ISSUE_LABEL_NAMES.includes(label.name)) {
      throw new Error('Issue labels must use the exact approved taxonomy names.');
    }
    if (typeof label.color !== 'string' || !/^[0-9a-f]{6}$/i.test(label.color)) {
      throw new Error('Every issue label needs a 6-character hexadecimal color.');
    }
    if (
      typeof label.description !== 'string' ||
      label.description.trim().length === 0 ||
      label.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      throw new Error(
        `Every issue label needs a non-empty description up to ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
    names.push(label.name);
  }

  if (new Set(names).size !== names.length) throw new Error('Issue label names must be unique.');
  if (ISSUE_LABEL_NAMES.some(name => !names.includes(name))) {
    throw new Error('Issue labels must use the exact approved taxonomy names.');
  }
  return labels;
}

async function executeCommand(command, args) {
  return execFile(command, args, { encoding: 'utf8' });
}

async function resolveRepo({ repo, execute }) {
  if (repo) return repo;

  try {
    const { stdout } = await execute('git', ['remote', 'get-url', 'origin']);
    const resolved = repoFromOrigin(stdout);
    if (resolved) return resolved;
  } catch {
    // Use the clear error below so dry runs remain helpful outside a checkout.
  }

  throw new Error('Could not resolve a GitHub repository from origin. Pass --repo OWNER/REPO.');
}

export async function syncGithubLabels({
  apply = false,
  labels,
  repo,
  execute = executeCommand,
  log = console.log,
}) {
  validateLabels(labels);
  const targetRepo = await resolveRepo({ repo, execute });

  if (!apply) {
    log(`Dry run: would create or update ${labels.length} issue labels in ${targetRepo}.`);
    for (const label of labels) log(`  ${label.name} (${label.color}) — ${label.description}`);
    log('Re-run with --apply to make these create/update-only changes; no labels are deleted.');
    return;
  }

  try {
    await execute('gh', ['auth', 'status']);
  } catch (error) {
    throw new Error(
      'GitHub CLI authentication is required for --apply. Install gh and run gh auth login.',
      { cause: error },
    );
  }

  for (const label of labels) {
    await execute('gh', [
      'label',
      'create',
      label.name,
      '--repo',
      targetRepo,
      '--color',
      label.color,
      '--description',
      label.description,
      '--force',
    ]);
    log(`Created or updated ${label.name}.`);
  }
}

async function loadManifest() {
  const manifest = yaml.load(await readFile(MANIFEST_URL, 'utf8'));
  return validateLabels(manifest?.labels);
}

async function main() {
  const { apply, repo } = parseArgs(process.argv.slice(2));
  await syncGithubLabels({ apply, labels: await loadManifest(), repo });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
