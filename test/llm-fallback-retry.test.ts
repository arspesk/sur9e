import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runModeLLM } from '../batch/lib/llm.mjs';

type Attempt = { code: number; stdout?: string; stderr?: string };

function makeFakes(attempts: Attempt[]) {
  const spawnedModels: string[] = [];
  const execImpl = (_cmd: string, args: string[]) => {
    const mi = args.indexOf('--model');
    spawnedModels.push(mi >= 0 ? args[mi + 1] : '(none)');
    return {
      pid: 0,
      status: 0,
      signal: null,
      output: [],
      stdout: JSON.stringify({ cmd: 'fake', args: [] }),
      stderr: '',
    };
  };
  let call = 0;
  const spawnImpl = () => {
    const a = attempts[Math.min(call, attempts.length - 1)];
    call++;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (a.stdout) child.stdout.emit('data', Buffer.from(a.stdout));
      if (a.stderr) child.stderr.emit('data', Buffer.from(a.stderr));
      child.emit('close', a.code);
    });
    return child;
  };
  return { execImpl, spawnImpl, spawnedModels };
}

const logsDir = mkdtempSync(join(tmpdir(), 'llm-fallback-'));
const RUNTIME = {
  provider: 'claude',
  model: 'claude-opus-4-7',
  fallback: { provider: 'codex', model: 'gpt-5-codex' },
};

describe('runModeLLM fallback retry', () => {
  it('retries once on a retryable failure and reports usedFallback', async () => {
    const f = makeFakes([
      { code: 1, stderr: 'exceeded retry limit, last status: 429 Too Many Requests' },
      { code: 0, stdout: 'ok output' },
    ]);
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      execImpl: f.execImpl,
      spawnImpl: f.spawnImpl,
    });
    expect(r.ok).toBe(true);
    expect(f.spawnedModels).toEqual(['claude-opus-4-7', 'gpt-5-codex']);
    expect(r.usedFallback).toEqual({
      from: { provider: 'claude', model: 'claude-opus-4-7' },
      to: { provider: 'codex', model: 'gpt-5-codex' },
      reason: 'rate_limit',
    });
  });

  it('does NOT retry a non-retryable failure (auth)', async () => {
    const f = makeFakes([{ code: 1, stderr: 'OAuth token revoked' }]);
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      execImpl: f.execImpl,
      spawnImpl: f.spawnImpl,
    });
    expect(r.ok).toBe(false);
    expect(f.spawnedModels).toEqual(['claude-opus-4-7']);
    expect(r.usedFallback).toBeUndefined();
  });

  it('does NOT retry without a fallback configured', async () => {
    const f = makeFakes([{ code: 1, stderr: 'Overloaded' }]);
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: { provider: 'claude', model: 'claude-opus-4-7' },
      execImpl: f.execImpl,
      spawnImpl: f.spawnImpl,
    });
    expect(r.ok).toBe(false);
    expect(f.spawnedModels).toEqual(['claude-opus-4-7']);
  });

  it('does NOT retry on timeout', async () => {
    const f = makeFakes([{ code: 0, stdout: 'unused' }]);
    const hangingSpawn = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      return child;
    };
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 50,
      execImpl: f.execImpl,
      spawnImpl: hangingSpawn,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('timeout');
    expect(r.usedFallback).toBeUndefined();
  });

  it('both attempts fail → combined error naming both attempts', async () => {
    const f = makeFakes([
      {
        code: 1,
        stderr: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      },
      { code: 1, stderr: 'unexpected status 401 Unauthorized' },
    ]);
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      execImpl: f.execImpl,
      spawnImpl: f.spawnImpl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('primary');
    expect(r.error).toContain('fallback');
    expect(f.spawnedModels).toEqual(['claude-opus-4-7', 'gpt-5-codex']);
    expect(r.usedFallback).toBeUndefined();
  });

  it('emits the [FALLBACK] marker line in stdout on fallback success', async () => {
    const f = makeFakes([
      { code: 1, stderr: 'Provider is overloaded' },
      { code: 0, stdout: 'fine' },
    ]);
    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: { ...RUNTIME, provider: 'opencode', model: 'anthropic/claude-sonnet-4-5' },
      execImpl: f.execImpl,
      spawnImpl: f.spawnImpl,
    });
    const marker = r.stdout.split('\n').find((l: string) => l.startsWith('[FALLBACK] '));
    expect(marker).toBeTruthy();
    const parsed = JSON.parse(marker!.slice('[FALLBACK] '.length));
    expect(parsed.from).toEqual({ provider: 'opencode', model: 'anthropic/claude-sonnet-4-5' });
    expect(parsed.to).toEqual({ provider: 'codex', model: 'gpt-5-codex' });
    expect(parsed.reason).toBe('overloaded');
  });
});
