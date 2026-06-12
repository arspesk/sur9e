// test/mode-runner-orchestrator.test.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runMode } from '../batch/mode-runner.mjs';

function stubDeps(overrides = {}) {
  return {
    resolveRuntime: vi.fn(() => ({ provider: 'claude', model: 'm', resolvedFrom: 'fallback' })),
    runLLM: vi.fn(async () => ({ ok: true, stdout: 'OUT', stderr: '', promptText: 'P' })),
    trackUsage: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

const okSpec = {
  modeId: 'fake',
  timeoutMs: 1000,
  loadInputs: vi.fn(async () => ({ a: 1 })),
  buildPrompt: vi.fn(() => 'P'),
  parse: vi.fn(() => ({ payload: true })),
  write: vi.fn(async () => ({ summary: 'wrote it' })),
};

describe('runMode', () => {
  it('happy path: loadInputs → buildPrompt → runLLM → parse → write → track', async () => {
    const deps = stubDeps();
    const root = mkdtempSync(join(tmpdir(), 'mr-'));
    const code = await runMode(okSpec, { rootPath: root, num: 7 }, deps);
    expect(code).toBe(0);
    expect(okSpec.write).toHaveBeenCalledWith(
      expect.objectContaining({ num: 7 }),
      { a: 1 },
      { payload: true },
    );
    expect(deps.trackUsage).toHaveBeenCalled();
  });

  it('returns 1 and does NOT write when the LLM run fails', async () => {
    const spec = { ...okSpec, write: vi.fn() };
    const deps = stubDeps({
      runLLM: vi.fn(async () => ({ ok: false, error: 'exit 2', stdout: '', stderr: '' })),
    });
    const code = await runMode(spec, { rootPath: '/r', num: 7 }, deps);
    expect(code).toBe(1);
    expect(spec.write).not.toHaveBeenCalled();
  });

  it('returns 1 and does NOT write when parse throws (no sentinel)', async () => {
    const spec = {
      ...okSpec,
      parse: vi.fn(() => {
        throw new Error('no sentinel');
      }),
      write: vi.fn(),
    };
    const code = await runMode(spec, { rootPath: '/r', num: 7 }, stubDeps());
    expect(code).toBe(1);
    expect(spec.write).not.toHaveBeenCalled();
  });

  it('still tracks usage when parse fails (tokens were spent)', async () => {
    const deps = stubDeps();
    const spec = {
      ...okSpec,
      parse: vi.fn(() => {
        throw new Error('x');
      }),
    };
    await runMode(spec, { rootPath: '/r', num: 7 }, deps);
    expect(deps.trackUsage).toHaveBeenCalled();
  });
});

describe('runMode parse-failure retry', () => {
  it('retries the LLM run once when parse throws, succeeds on second attempt', async () => {
    let calls = 0;
    const spec = {
      ...okSpec,
      parse: vi.fn(out => {
        // runMode hands parse the COMBINED stdout+stderr text
        if (out.includes('BAD')) throw new Error('no sentinel');
        return { payload: true };
      }),
      write: vi.fn(async () => ({ summary: 'wrote on retry' })),
    };
    const deps = stubDeps({
      runLLM: vi.fn(async () => {
        calls += 1;
        return { ok: true, stdout: calls === 1 ? 'BAD' : 'GOOD', stderr: '', promptText: 'P' };
      }),
    });
    const root = mkdtempSync(join(tmpdir(), 'mr-retry-'));
    const code = await runMode(spec, { rootPath: root, num: 9 }, deps);
    expect(code).toBe(0);
    expect(deps.runLLM).toHaveBeenCalledTimes(2);
    expect(spec.write).toHaveBeenCalledTimes(1);
    // both attempts tracked
    expect(deps.trackUsage).toHaveBeenCalledTimes(2);
  });

  it('fails after the single retry also misses the contract', async () => {
    const spec = {
      ...okSpec,
      parse: vi.fn(() => {
        throw new Error('no sentinel');
      }),
      write: vi.fn(),
    };
    const deps = stubDeps();
    const root = mkdtempSync(join(tmpdir(), 'mr-retry2-'));
    const code = await runMode(spec, { rootPath: root, num: 9 }, deps);
    expect(code).toBe(1);
    expect(deps.runLLM).toHaveBeenCalledTimes(2);
    expect(spec.write).not.toHaveBeenCalled();
  });
});
