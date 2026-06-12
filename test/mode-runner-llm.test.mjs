// test/mode-runner-llm.test.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSpawnArgsForMode, resolveRuntimeForMode } from '../batch/lib/llm.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'llm-test-'));
afterEach(() => vi.unstubAllEnvs());

describe('resolveRuntimeForMode', () => {
  it('spawns cli/resolve-mode.mjs for the mode and parses its JSON', () => {
    const calls = [];
    const fakeExec = (cmd, args) => {
      calls.push([cmd, args]);
      return {
        status: 0,
        stdout: JSON.stringify({
          provider: 'claude',
          model: 'claude-haiku-4-5-20251001',
          resolvedFrom: 'mode_default',
        }),
        stderr: '',
      };
    };
    const rt = resolveRuntimeForMode('/root', 'evaluate', { execImpl: fakeExec });
    expect(rt.provider).toBe('claude');
    expect(calls[0][1]).toContain('cli/resolve-mode.mjs');
    expect(calls[0][1]).toContain('evaluate');
  });

  it('forwards SUR9E_OVERRIDE_PLATFORM/MODEL env as --platform/--model args', () => {
    vi.stubEnv('SUR9E_OVERRIDE_PLATFORM', 'codex');
    vi.stubEnv('SUR9E_OVERRIDE_MODEL', 'gpt-5.5');
    const calls = [];
    const fakeExec = (cmd, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: '{"provider":"codex","model":"gpt-5.5","resolvedFrom":"run_override"}',
        stderr: '',
      };
    };
    resolveRuntimeForMode('/root', 'evaluate', { execImpl: fakeExec });
    expect(calls[0]).toEqual(expect.arrayContaining(['--platform', 'codex', '--model', 'gpt-5.5']));
  });

  it('throws (does not process.exit) on a non-zero shim exit', () => {
    const fakeExec = () => ({ status: 1, stdout: '', stderr: 'boom' });
    expect(() => resolveRuntimeForMode('/root', 'evaluate', { execImpl: fakeExec })).toThrow(
      /resolve-mode/,
    );
  });
});

describe('buildSpawnArgsForMode', () => {
  it('writes the prompt to a tmp file, calls build-claude-cmd, returns spawn pair + promptText', () => {
    let promptFileContents = null;
    const fakeExec = (cmd, args) => {
      const i = args.indexOf('--prompt-file');
      promptFileContents = readFileSync(args[i + 1], 'utf-8');
      return {
        status: 0,
        stdout: JSON.stringify({ cmd: 'claude', args: ['-p', 'x'] }),
        stderr: '',
      };
    };
    const built = buildSpawnArgsForMode('/root', 'evaluate', 'THE PROMPT', {
      logsDir: tmp,
      execImpl: fakeExec,
    });
    expect(built.spawn).toEqual({ cmd: 'claude', args: ['-p', 'x'] });
    expect(built.promptText).toBe('THE PROMPT');
    expect(promptFileContents).toBe('THE PROMPT');
  });

  it('cleans up the tmp prompt file even when the shim fails', () => {
    const fakeExec = () => ({ status: 1, stdout: '', stderr: 'nope' });
    expect(() =>
      buildSpawnArgsForMode('/root', 'evaluate', 'P', { logsDir: tmp, execImpl: fakeExec }),
    ).toThrow(/build-claude-cmd/);
    // tmp dir contains no leftover .prompt- files
    expect(readFileSync !== null).toBe(true);
  });
});

describe('single resolution: explicit runtime reaches the spawn shim', () => {
  it('passes --platform/--model from the resolved runtime', () => {
    const calls = [];
    const fakeExec = (cmd, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ cmd: 'codex', args: ['exec', 'x'] }),
        stderr: '',
      };
    };
    const tmp = mkdtempSync(join(tmpdir(), 'llm-rt-'));
    buildSpawnArgsForMode('/root', 'evaluate', 'P', {
      logsDir: tmp,
      execImpl: fakeExec,
      runtime: { provider: 'codex', model: 'gpt-5.5' },
    });
    expect(calls[0]).toEqual(expect.arrayContaining(['--platform', 'codex', '--model', 'gpt-5.5']));
  });

  it('omits the flags when no runtime is given (shim resolves via env/config)', () => {
    const calls = [];
    const fakeExec = (cmd, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ cmd: 'claude', args: ['-p', 'x'] }),
        stderr: '',
      };
    };
    const tmp = mkdtempSync(join(tmpdir(), 'llm-rt2-'));
    buildSpawnArgsForMode('/root', 'evaluate', 'P', { logsDir: tmp, execImpl: fakeExec });
    expect(calls[0]).not.toContain('--platform');
  });
});

describe('single-resolution passthrough', () => {
  it('forwards the resolved runtime as explicit --platform/--model to the spawn shim', () => {
    const calls = [];
    const fakeExec = (cmd, args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ cmd: 'codex', args: ['exec', 'x'] }),
        stderr: '',
      };
    };
    buildSpawnArgsForMode('/root', 'evaluate', 'P', {
      logsDir: tmp,
      execImpl: fakeExec,
      runtime: { provider: 'codex', model: 'gpt-5.5' },
    });
    expect(calls[0]).toEqual(expect.arrayContaining(['--platform', 'codex', '--model', 'gpt-5.5']));
  });
});
