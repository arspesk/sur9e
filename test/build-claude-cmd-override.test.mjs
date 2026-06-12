// test/build-claude-cmd-override.test.mjs
//
// Regression lock for the provider-mislabel bug: cli/build-claude-cmd.mjs
// (the spawn builder) MUST honor the same per-run override channels as
// cli/resolve-mode.mjs (the labeler). When they disagree, the job record
// says one provider while another binary actually runs — silently.
// These tests spawn the real shims (tsx) against the repo root and assert
// the BUILT COMMAND reflects the override, not just the label.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function buildCmd(env) {
  const out = execFileSync(
    'npx',
    [
      'tsx',
      '--conditions=react-server',
      'cli/build-claude-cmd.mjs',
      'reach-out',
      '--prompt',
      'test prompt',
      '--output-format',
      'text',
      '--no-pipe',
      '--json',
    ],
    { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, ...env } },
  );
  return JSON.parse(out.trim());
}

describe('build-claude-cmd per-run override (spawn side, not just the label)', () => {
  it('SUR9E_OVERRIDE env routes the BUILT COMMAND to the override provider', () => {
    const built = buildCmd({
      SUR9E_OVERRIDE_PLATFORM: 'codex',
      SUR9E_OVERRIDE_MODEL: 'gpt-5.5',
    });
    const cmdLine = built.args.join(' ');
    expect(cmdLine).toContain('codex exec');
    expect(cmdLine).toContain('gpt-5.5');
    expect(cmdLine).not.toContain('claude -p');
  }, 30000);

  it('no override → built command agrees with the resolver (labeler == spawner)', () => {
    // The lock this file exists for: whatever cli/resolve-mode.mjs reports
    // (the job-record label) must be the binary build-claude-cmd actually
    // spawns. Resolve first, then assert the built command matches THAT
    // provider — config-independent, so the test holds whether the repo's
    // config.yml sets a global default (which now outranks reach-out.md's
    // front-matter) or not.
    const resolved = JSON.parse(
      execFileSync(
        'npx',
        ['tsx', '--conditions=react-server', 'cli/resolve-mode.mjs', 'reach-out'],
        { cwd: ROOT, encoding: 'utf-8', env: { ...process.env } },
      ).trim(),
    );
    const MARKER = {
      claude: 'claude -p',
      codex: 'codex exec',
      opencode: 'opencode run',
    };
    expect(MARKER[resolved.provider]).toBeTruthy();
    const built = buildCmd({
      SUR9E_OVERRIDE_PLATFORM: '',
      SUR9E_OVERRIDE_MODEL: '',
    });
    const cmdLine = built.args.join(' ');
    expect(cmdLine).toContain(MARKER[resolved.provider]);
    expect(cmdLine).toContain(resolved.model);
  }, 30000);
});
