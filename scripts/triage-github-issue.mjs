import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { runIssueTriage } from './lib/issue-triage-runner.mjs';

const execFile = promisify(execFileCallback);

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`Missing or invalid ${name}.`);
  return value;
}

async function main() {
  const issueNumber = requiredEnvironment('ISSUE_NUMBER', /^[1-9][0-9]*$/);
  const repo = requiredEnvironment('GITHUB_REPOSITORY', /^[^/\s]+\/[^/\s]+$/);
  const action = process.env.ISSUE_ACTION;
  const bodyChanged = process.env.ISSUE_BODY_CHANGED === 'true';
  await runIssueTriage({
    issueNumber,
    repo,
    action,
    bodyChanged,
    newestLabel: process.env.ISSUE_LABEL || null,
    execute: (command, args) => execFile(command, args, { encoding: 'utf8' }),
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
