// test/build-claude-cmd-inline-system.test.mjs
//
// Lock for the batch any-CLI fix: cli/build-claude-cmd.mjs must inline the
// --append-system-prompt-file content into the user prompt for non-Claude
// providers (Codex / OpenCode have no equivalent CLI flag and their adapters
// throw on it). Claude keeps its native --append-system-prompt-file flag.
// This is what lets batch-runner.sh — which always feeds the per-offer system
// prompt via --append-system-prompt-file — run on any provider.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SYS_MARKER = 'BATCHSYSMARKER_inline_test';

let dir;
let sysFile;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sur9e-inline-'));
  sysFile = join(dir, 'system.md');
  writeFileSync(sysFile, `${SYS_MARKER}\nFull evaluation instructions here.\n`, 'utf-8');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildCmd(env) {
  const out = execFileSync(
    'npx',
    [
      'tsx',
      '--conditions=react-server',
      'cli/build-claude-cmd.mjs',
      'evaluate',
      '--prompt',
      'Process this job offer.',
      '--output-format',
      'text',
      '--no-pipe',
      '--append-system-prompt-file',
      sysFile,
      '--json',
    ],
    { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, ...env } },
  );
  return JSON.parse(out.trim());
}

describe('build-claude-cmd system-prompt inlining (batch any-CLI)', () => {
  it('inlines the system prompt into the user prompt for Codex (no throw, no flag)', () => {
    const built = buildCmd({
      SUR9E_OVERRIDE_PLATFORM: 'codex',
      SUR9E_OVERRIDE_MODEL: 'gpt-5.5',
    });
    const cmdLine = built.args.join(' ');
    // Codex builds successfully (the adapter would have thrown, exit 3, on a
    // raw --append-system-prompt-file) and the system text rides in the prompt.
    expect(cmdLine).toContain('codex exec');
    expect(cmdLine).toContain(SYS_MARKER);
    expect(cmdLine).not.toContain('--append-system-prompt-file');
  }, 30000);

  it('inlines the system prompt into the user prompt for OpenCode', () => {
    const built = buildCmd({
      SUR9E_OVERRIDE_PLATFORM: 'opencode',
      SUR9E_OVERRIDE_MODEL: 'anthropic/claude-sonnet-4-6',
    });
    const cmdLine = built.args.join(' ');
    expect(cmdLine).toContain('opencode run');
    expect(cmdLine).toContain(SYS_MARKER);
    expect(cmdLine).not.toContain('--append-system-prompt-file');
  }, 30000);

  it('keeps the native --append-system-prompt-file flag for Claude (not inlined)', () => {
    const built = buildCmd({
      SUR9E_OVERRIDE_PLATFORM: 'claude',
      SUR9E_OVERRIDE_MODEL: 'claude-sonnet-4-6',
    });
    const cmdLine = built.args.join(' ');
    expect(cmdLine).toContain('claude -p');
    expect(cmdLine).toContain('--append-system-prompt-file');
    expect(cmdLine).toContain(sysFile);
    // The system text stays in the file, not folded into the inline prompt.
    expect(cmdLine).not.toContain(SYS_MARKER);
  }, 30000);
});
