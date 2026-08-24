import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runModeLLM, terminateProviderTree } from '../batch/lib/llm.mjs';

type Attempt = { code: number; stdout?: string; stderr?: string };

function makeFakes(attempts: Attempt[]) {
  const spawnedModels: string[] = [];
  const spawnedProviders: string[] = [];
  const execImpl = (_cmd: string, args: string[]) => {
    const mi = args.indexOf('--model');
    const pi = args.indexOf('--platform');
    spawnedModels.push(mi >= 0 ? args[mi + 1] : '(none)');
    spawnedProviders.push(pi >= 0 ? args[pi + 1] : '(none)');
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
  return { execImpl, spawnImpl, spawnedModels, spawnedProviders };
}

const logsDir = mkdtempSync(join(tmpdir(), 'llm-fallback-'));
const trackedTempRoots = new Set<string>();

function trackedTempRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  trackedTempRoots.add(root);
  return root;
}

async function waitForPidFile(path: string, timeout = 2000) {
  let pid = 0;
  await vi.waitFor(
    () => {
      expect(existsSync(path)).toBe(true);
      pid = Number(readFileSync(path, 'utf8').trim());
      expect(pid).toBeGreaterThan(1);
    },
    { timeout, interval: 20 },
  );
  return pid;
}

afterEach(() => {
  for (const root of trackedTempRoots) rmSync(root, { recursive: true, force: true });
  trackedTempRoots.clear();
});

afterAll(() => {
  rmSync(logsDir, { recursive: true, force: true });
});

const RUNTIME = {
  provider: 'claude',
  model: 'claude-opus-4-7',
  fallback: { provider: 'codex', model: 'gpt-5-codex' },
};

const PROVIDER_CASES = [
  {
    provider: 'claude',
    primaryModel: 'claude-opus-4-7',
    fallbackModel: 'claude-sonnet-4-6',
    quota: "You've hit your session limit. It resets at 3pm",
  },
  {
    provider: 'codex',
    primaryModel: 'gpt-5.4-mini',
    fallbackModel: 'gpt-5-codex',
    quota: "You've hit your usage limit. Switch to another model now.",
  },
  {
    provider: 'opencode',
    primaryModel: 'opencode-go/glm-5.2',
    fallbackModel: 'opencode/big-pickle',
    quota: 'Weekly usage limit reached. Resets in 1 day.',
  },
] as const;

const ONE_HOP_PROVIDER_PAIRS = PROVIDER_CASES.flatMap(primary =>
  PROVIDER_CASES.map(fallback => ({
    primary: { provider: primary.provider, model: primary.primaryModel },
    fallback: { provider: fallback.provider, model: fallback.fallbackModel },
    quota: primary.quota,
  })),
);

describe('runModeLLM fallback retry', () => {
  it.runIf(process.platform !== 'win32')(
    'terminates the provider wrapper and its descendant process',
    async () => {
      const child = nodeSpawn('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const [chunk] = (await once(child.stdout, 'data')) as [Buffer];
      const descendantPid = Number(chunk.toString().trim());

      try {
        terminateProviderTree(child, 'SIGKILL');
        await once(child, 'close');
        await vi.waitFor(
          () => {
            expect(() => process.kill(descendantPid, 0)).toThrow(
              expect.objectContaining({ code: 'ESRCH' }),
            );
          },
          { timeout: 1000, interval: 20 },
        );
      } finally {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {}
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    },
  );

  it('treats an already-exited Windows provider tree as cleaned up', () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 128,
      stdout: '',
      stderr: 'ERROR: The process "4321" not found.',
    }));

    expect(
      terminateProviderTree({ pid: 4321 }, 'SIGKILL', {
        platform: 'win32',
        spawnSyncImpl: spawnSyncImpl as any,
      }),
    ).toEqual([]);
    expect(spawnSyncImpl).toHaveBeenCalledWith('taskkill', ['/PID', '4321', '/T', '/F'], {
      encoding: 'utf-8',
    });
  });

  it('still reports Windows provider-tree cleanup failures other than an absent process', () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'ERROR: Access is denied.',
    }));

    expect(() =>
      terminateProviderTree({ pid: 4321 }, 'SIGKILL', {
        platform: 'win32',
        spawnSyncImpl: spawnSyncImpl as any,
      }),
    ).toThrow('taskkill failed');
  });

  it('kills every discovered descendant even when freezing one of them fails', () => {
    const children = new Map([
      [100, '101\n102\n'],
      [101, '103\n'],
    ]);
    const spawnSyncImpl = vi.fn((_cmd: string, args: string[]) => {
      const stdout = children.get(Number(args[1])) ?? '';
      return { status: stdout ? 0 : 1, stdout, stderr: '' };
    });
    const killImpl = vi.fn((pid: number, signal?: string | number) => {
      if (pid === 102 && signal === 'SIGSTOP') {
        throw Object.assign(new Error('freeze denied'), { code: 'EPERM' });
      }
      return true as const;
    });
    const child = { pid: 100, spawnfile: 'fake-provider', kill: vi.fn() };

    expect(() =>
      terminateProviderTree(child, 'SIGKILL', {
        platform: 'darwin',
        spawnSyncImpl: spawnSyncImpl as any,
        killImpl,
      }),
    ).toThrow('freeze denied');
    expect(killImpl).toHaveBeenCalledWith(103, 'SIGKILL');
    expect(killImpl).toHaveBeenCalledWith(101, 'SIGKILL');
    expect(killImpl).toHaveBeenCalledWith(102, 'SIGKILL');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

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

  it('allows a wrapped spawn implementation to request provider-group isolation explicitly', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnedCommand = '';
    let spawnedArgs: string[] = [];
    const spawnImpl = (command: string, args: string[]) => {
      spawnedCommand = command;
      spawnedArgs = args;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      setImmediate(() => child.emit('close', 0));
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: { provider: 'claude', model: 'claude-opus-4-7' },
      timeoutMs: 100,
      execImpl: f.execImpl,
      spawnImpl,
      isolateProviderGroup: true,
    });

    expect(r.ok).toBe(true);
    expect(spawnedCommand).toBe(process.execPath);
    expect(spawnedArgs[0]).toMatch(/provider-supervisor\.mjs$/);
    expect(spawnedArgs).toContain('--parent-pid');
  });

  it.each([
    ['claude', 'claude-sonnet-4-6', 'OAuth token revoked', 'codex', 'gpt-5.4-mini'],
    // Expired CLI session (issue #118) — exact provider wording.
    [
      'claude',
      'claude-opus-4-7',
      'Failed to authenticate: OAuth session expired and could not be refreshed',
      'codex',
      'gpt-5.6-sol',
    ],
    ['codex', 'gpt-5.4-mini', 'refresh token expired', 'claude', 'claude-sonnet-4-6'],
    [
      'opencode',
      'opencode/deepseek-v4-flash-free',
      'ProviderAuthError: run opencode auth login',
      'claude',
      'claude-sonnet-4-6',
    ],
  ])(
    'retries a configured fallback after a terminal %s auth failure',
    async (provider, model, stderr, fallbackProvider, fallbackModel) => {
      const f = makeFakes([
        { code: 1, stderr },
        { code: 0, stdout: 'fallback output' },
      ]);
      const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
        logsDir,
        runtime: {
          provider,
          model,
          fallback: { provider: fallbackProvider, model: fallbackModel },
        },
        execImpl: f.execImpl,
        spawnImpl: f.spawnImpl,
      });
      expect(r.ok).toBe(true);
      expect(f.spawnedProviders).toEqual([provider, fallbackProvider]);
      expect(f.spawnedModels).toEqual([model, fallbackModel]);
      expect(r.usedFallback?.reason).toBe('auth');
    },
  );

  it('does NOT retry a non-retryable context-overflow failure', async () => {
    const f = makeFakes([{ code: 1, stderr: 'prompt is too long for the context window' }]);
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

  it.each(ONE_HOP_PROVIDER_PAIRS)(
    'falls back after a silent $primary.provider → $fallback.provider timeout',
    async ({ primary, fallback }) => {
      const f = makeFakes([{ code: 0 }]);
      let spawnCount = 0;
      const killed: string[] = [];
      const spawnImpl = () => {
        spawnCount += 1;
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = (signal: string) => {
          killed.push(signal);
          setImmediate(() => child.emit('close', null));
          return true;
        };
        if (spawnCount === 2) {
          setImmediate(() => {
            child.stdout.emit('data', Buffer.from('fallback output'));
            child.emit('close', 0);
          });
        }
        return child;
      };

      const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
        logsDir,
        runtime: {
          ...primary,
          fallback,
        },
        timeoutMs: 80,
        execImpl: f.execImpl,
        spawnImpl,
      });

      expect(r.ok).toBe(true);
      expect(spawnCount).toBe(2);
      expect(killed).toContain('SIGKILL');
      expect(r.stdout).toContain('fallback output');
      expect(r.usedFallback).toEqual({
        from: primary,
        to: fallback,
        reason: 'timeout',
      });
    },
  );

  it('returns a timeout without retrying when no fallback is configured', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: { provider: 'opencode', model: 'opencode-go/glm-5.2' },
      timeoutMs: 40,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('timeout');
    expect(spawnCount).toBe(1);
    expect(r.usedFallback).toBeUndefined();
  });

  it('bounds command construction and falls back when the primary builder times out', async () => {
    let buildCalls = 0;
    const buildTimeouts: number[] = [];
    const execImpl = (_cmd: string, _args: string[], options: { timeout?: number }) => {
      buildCalls += 1;
      buildTimeouts.push(options.timeout ?? -1);
      if (buildCalls === 1) {
        return {
          status: null,
          signal: 'SIGKILL',
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
        };
      }
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify({ cmd: 'fake', args: [] }),
        stderr: '',
      };
    };
    const spawnImpl = () => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from('fallback output'));
        child.emit('close', 0);
      });
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 80,
      execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(true);
    expect(r.usedFallback?.reason).toBe('timeout');
    expect(buildCalls).toBe(2);
    expect(buildTimeouts).toEqual([80, 80]);
  });

  it('suppresses fallback when a timed-out builder reports incomplete cleanup', async () => {
    let buildCalls = 0;
    let spawnCount = 0;
    const execImpl = () => {
      buildCalls += 1;
      return {
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '[SUR9E_PROVIDER_CLEANUP_FAILED] provider process group did not terminate',
        error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
      };
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 80,
      execImpl,
      spawnImpl: () => {
        spawnCount += 1;
        throw new Error('provider must not spawn after failed builder cleanup');
      },
    });

    expect(r.ok).toBe(false);
    expect(r.cleanupFailed).toBe(true);
    expect(r.stderr).toContain('[SUR9E_PROVIDER_CLEANUP_FAILED]');
    expect(buildCalls).toBe(1);
    expect(spawnCount).toBe(0);
  });

  it('reports both provider/model pairs when fallback fails after a primary timeout', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      if (spawnCount === 2) {
        setImmediate(() => {
          child.stderr.emit('data', Buffer.from('fallback failed'));
          child.emit('close', 1);
        });
      }
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 80,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(spawnCount).toBe(2);
    expect(r.error).toContain('claude/claude-opus-4-7');
    expect(r.error).toContain('codex/gpt-5-codex');
    expect(r.error).toContain('(timeout)');
    expect(r.stderr).toContain('fallback failed');
  });

  it('bounds a primary and fallback that both hang to two provider timeouts', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      return child;
    };
    const startedAt = Date.now();

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 100,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(spawnCount).toBe(2);
    // This proves the operation is bounded while allowing CI scheduling and
    // process-settlement slack beyond the two 100ms provider budgets.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(r.error).toContain('fallback codex/gpt-5-codex: timeout');
  });

  it('caps a fallback at one provider timeout after an immediate primary failure', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      if (spawnCount === 1) {
        setImmediate(() => child.stderr.emit('data', Buffer.from('Provider is overloaded')));
      }
      return child;
    };
    const startedAt = Date.now();

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 50,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(spawnCount).toBe(2);
    expect(r.error).toContain('fallback codex/gpt-5-codex: timeout 50ms');
    expect(Date.now() - startedAt).toBeLessThan(600);
  });

  it('does not treat a child error during timeout cleanup as process closure', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('error', new Error('kill failed')));
        return false;
      };
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 20,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(r.cleanupFailed).toBe(true);
    expect(r.error).toContain('provider process tree did not terminate');
    expect(spawnCount).toBe(1);
  });

  it('does not start fallback when the supervisor reports incomplete process cleanup', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', 1));
        return true;
      };
      setImmediate(() => {
        const marker = '[SUR9E_PROVIDER_CLEANUP_FAILED]';
        child.stderr.emit('data', Buffer.from(marker.slice(0, -5)));
        child.stderr.emit('data', Buffer.from(`${marker.slice(-5)} Provider is overloaded`));
      });
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 100,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(r.cleanupFailed).toBe(true);
    expect(r.error).toContain('provider process tree did not terminate');
    expect(spawnCount).toBe(1);
  });

  it.runIf(process.platform !== 'win32')(
    'kills the timed-out primary descendant before spawning fallback',
    async () => {
      const f = makeFakes([{ code: 0 }]);
      let spawnCount = 0;
      let descendantPid = 0;
      let descendantAliveWhenFallbackStarted: boolean | null = null;
      const spawnImpl = () => {
        spawnCount += 1;
        if (spawnCount === 1) {
          const child = nodeSpawn('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.once('data', chunk => {
            descendantPid = Number(chunk.toString().trim());
          });
          return child;
        }
        try {
          process.kill(descendantPid, 0);
          descendantAliveWhenFallbackStarted = true;
        } catch (error: any) {
          if (error?.code !== 'ESRCH') throw error;
          descendantAliveWhenFallbackStarted = false;
        }
        return nodeSpawn('/bin/sh', ['-c', 'printf "fallback output"'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      };

      try {
        const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
          logsDir,
          runtime: RUNTIME,
          timeoutMs: 300,
          execImpl: f.execImpl,
          spawnImpl,
        });
        expect(r.ok).toBe(true);
        expect(descendantPid).toBeGreaterThan(1);
        expect(descendantAliveWhenFallbackStarted).toBe(false);
      } finally {
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'kills an orphaned primary process group before fallback after wrapper exit',
    async () => {
      const root = trackedTempRoot('llm-fallback-orphan-');
      const descendantPidFile = join(root, 'descendant.pid');
      const primaryScript = `
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        writeFileSync(process.argv[1], String(descendant.pid));
        process.stderr.write('Provider is overloaded');
        process.exit(1);
      `;
      const fallbackScript = `
        const { readFileSync } = require('node:fs');
        const pid = Number(readFileSync(process.argv[1], 'utf8'));
        try {
          process.kill(pid, 0);
          process.stderr.write('primary descendant still alive');
          process.exit(2);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          process.stdout.write('fallback output');
        }
      `;
      const execImpl = (_cmd: string, args: string[]) => {
        const providerIndex = args.indexOf('--platform');
        const provider = args[providerIndex + 1];
        const spawn =
          provider === 'claude'
            ? { cmd: process.execPath, args: ['-e', fallbackScript, descendantPidFile] }
            : { cmd: process.execPath, args: ['-e', primaryScript, descendantPidFile] };
        return { status: 0, signal: null, stdout: JSON.stringify(spawn), stderr: '' };
      };
      let descendantPid = 0;

      try {
        const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
          logsDir: root,
          runtime: {
            provider: 'opencode',
            model: 'opencode-go/glm-5.2',
            fallback: { provider: 'claude', model: 'claude-sonnet-5' },
          },
          timeoutMs: 500,
          execImpl,
        });
        descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));

        expect(r.ok).toBe(true);
        expect(r.usedFallback?.reason).toBe('overloaded');
        expect(r.stdout).toContain('fallback output');
        expect(() => process.kill(descendantPid, 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        );
      } finally {
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'preserves a successful provider exit while cleaning its lingering descendant',
    async () => {
      const root = trackedTempRoot('llm-provider-success-orphan-');
      const descendantPidFile = join(root, 'descendant.pid');
      const primaryScript = `
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        writeFileSync(process.argv[1], String(descendant.pid));
        process.stdout.write('primary output');
        process.exit(0);
      `;
      const execImpl = () => ({
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          cmd: process.execPath,
          args: ['-e', primaryScript, descendantPidFile],
        }),
        stderr: '',
      });
      let descendantPid = 0;

      try {
        const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
          logsDir: root,
          runtime: { provider: 'opencode', model: 'opencode-go/glm-5.2' },
          timeoutMs: 500,
          execImpl,
        });
        descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));

        expect(r.ok).toBe(true);
        expect(r.stdout).toContain('primary output');
        expect(r.usedFallback).toBeUndefined();
        expect(() => process.kill(descendantPid, 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        );
      } finally {
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'cleans an isolated provider group after an uncatchable worker kill without fallback',
    async () => {
      const root = trackedTempRoot('llm-fallback-signal-');
      const descendantPidFile = join(root, 'descendant.pid');
      const workerPath = join(process.cwd(), 'test/fixtures/fallback-timeout-worker.mjs');
      const worker = nodeSpawn(
        process.execPath,
        [workerPath, root, descendantPidFile, '5000', '50'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      worker.stdout.on('data', chunk => {
        output += chunk.toString();
      });
      worker.stderr.on('data', chunk => {
        output += chunk.toString();
      });
      let descendantPid = 0;

      try {
        descendantPid = await waitForPidFile(descendantPidFile);
        worker.kill('SIGKILL');
        const [code, signal] = (await once(worker, 'close')) as [number | null, string | null];

        expect(code).toBeNull();
        expect(signal).toBe('SIGKILL');
        expect(output).not.toContain('[FALLBACK]');
        await vi.waitFor(
          () => {
            expect(() => process.kill(descendantPid, 0)).toThrow(
              expect.objectContaining({ code: 'ESRCH' }),
            );
          },
          { timeout: 1000, interval: 20 },
        );
      } finally {
        try {
          worker.kill('SIGKILL');
        } catch {}
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'kills the provider group and falls back if its supervisor dies first',
    async () => {
      const root = trackedTempRoot('llm-fallback-dead-supervisor-');
      const descendantPidFile = join(root, 'descendant.pid');
      const workerPath = join(process.cwd(), 'test/fixtures/fallback-timeout-worker.mjs');
      const worker = nodeSpawn(
        process.execPath,
        [workerPath, root, descendantPidFile, '5000', '0'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      worker.stdout.on('data', chunk => {
        output += chunk.toString();
      });
      worker.stderr.on('data', chunk => {
        output += chunk.toString();
      });
      let descendantPid = 0;
      let supervisorPid = 0;
      let supervisorGroupNeedsCleanup = false;

      try {
        descendantPid = await waitForPidFile(descendantPidFile);
        await vi.waitFor(
          () => {
            const result = nodeSpawnSync('pgrep', ['-P', String(worker.pid)], {
              encoding: 'utf8',
            });
            supervisorPid = Number(
              String(result.stdout ?? '')
                .trim()
                .split(/\s+/)[0],
            );
            expect(supervisorPid).toBeGreaterThan(1);
          },
          { timeout: 5000, interval: 20 },
        );
        supervisorGroupNeedsCleanup = true;

        process.kill(supervisorPid, 'SIGKILL');
        const [code, signal] = (await once(worker, 'close')) as [number | null, string | null];

        expect(code).toBe(0);
        expect(signal).toBeNull();
        expect(output).toContain('[FALLBACK]');
        expect(output).toContain('fallback completed');
        await vi.waitFor(
          () => {
            expect(() => process.kill(descendantPid, 0)).toThrow(
              expect.objectContaining({ code: 'ESRCH' }),
            );
          },
          { timeout: 1000, interval: 20 },
        );
        supervisorGroupNeedsCleanup = false;
      } finally {
        try {
          worker.kill('SIGKILL');
        } catch {}
        if (supervisorGroupNeedsCleanup && supervisorPid > 1) {
          try {
            process.kill(-supervisorPid, 'SIGKILL');
          } catch {}
        }
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
    15_000,
  );

  it('detects a retryable signature split across bounded stderr-tail chunks', async () => {
    const f = makeFakes([{ code: 0 }]);
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      setImmediate(() => {
        if (spawnCount === 1) {
          child.stderr.emit('data', Buffer.from(`${'x'.repeat(20_000)}Provider is over`));
          child.stderr.emit('data', Buffer.from('loaded'));
        } else {
          child.stdout.emit('data', Buffer.from('fallback output'));
          child.emit('close', 0);
        }
      });
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 100,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(true);
    expect(r.usedFallback?.reason).toBe('overloaded');
    expect(spawnCount).toBe(2);
  });

  it.each(ONE_HOP_PROVIDER_PAIRS)(
    'terminates a hung $primary.provider → $fallback.provider process after streamed quota output',
    async ({ primary, fallback, quota }) => {
      const f = makeFakes([{ code: 0 }]);
      let spawnCount = 0;
      const killed: Array<{ provider: string; signal: string }> = [];
      const spawnImpl = () => {
        const currentProvider = spawnCount === 0 ? primary.provider : fallback.provider;
        spawnCount += 1;
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = (signal: string) => {
          killed.push({ provider: currentProvider, signal });
          setImmediate(() => child.emit('close', null));
          return true;
        };
        setImmediate(() => {
          if (spawnCount === 1) {
            child.stderr.emit('data', Buffer.from(quota));
            return;
          }
          child.stdout.emit('data', Buffer.from('fallback output'));
          child.emit('close', 0);
        });
        return child;
      };

      const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
        logsDir,
        runtime: {
          ...primary,
          fallback,
        },
        timeoutMs: 100,
        execImpl: f.execImpl,
        spawnImpl,
      });

      expect(r.ok).toBe(true);
      expect(r.stdout).toContain('fallback output');
      expect(r.usedFallback?.reason).toBe('quota');
      expect(killed).toContainEqual({ provider: primary.provider, signal: 'SIGKILL' });
      expect(f.spawnedProviders).toEqual([primary.provider, fallback.provider]);
      expect(f.spawnedModels).toEqual([primary.model, fallback.model]);
      expect(spawnCount).toBe(2);
    },
  );

  it('cancellation terminates the active provider without invoking fallback', async () => {
    const f = makeFakes([{ code: 0 }]);
    const controller = new AbortController();
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      setImmediate(() => controller.abort());
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 100,
      signal: controller.signal,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.error).toBe('cancelled');
    expect(spawnCount).toBe(1);
  });

  it('cancellation during the fallback attempt remains cancellation', async () => {
    const f = makeFakes([{ code: 0 }]);
    const controller = new AbortController();
    let spawnCount = 0;
    const spawnImpl = () => {
      spawnCount += 1;
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        setImmediate(() => child.emit('close', null));
        return true;
      };
      setImmediate(() => {
        if (spawnCount === 1) {
          child.stderr.emit('data', Buffer.from('Provider is overloaded'));
        } else {
          controller.abort();
        }
      });
      return child;
    };

    const r = await runModeLLM(process.cwd(), 'evaluate', 'prompt', {
      logsDir,
      runtime: RUNTIME,
      timeoutMs: 100,
      signal: controller.signal,
      execImpl: f.execImpl,
      spawnImpl,
    });

    expect(r.ok).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.error).toBe('cancelled');
    expect(spawnCount).toBe(2);
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
    expect(r.error).toContain('claude/claude-opus-4-7');
    expect(r.error).toContain('codex/gpt-5-codex');
    expect(r.stderr).toContain('overloaded_error');
    expect(r.stderr).toContain('Unauthorized');
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

  it.each([
    {
      signature: 'overloaded_error',
      primary: { provider: 'claude', model: 'claude-sonnet-4-6' },
      fallback: { provider: 'opencode', model: 'opencode/big-pickle' },
      stderr: '{"type":"error","error":{"type":"overloaded_error"}}',
    },
    {
      signature: 'capacity',
      primary: { provider: 'codex', model: 'gpt-5.4-mini' },
      fallback: { provider: 'claude', model: 'claude-sonnet-4-6' },
      stderr: 'Selected model is at capacity. Please try a different model.',
    },
    {
      signature: 'internal server error',
      primary: { provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
      fallback: { provider: 'codex', model: 'gpt-5.4-mini' },
      stderr: 'AI_APICallError: Internal server error',
    },
    {
      signature: 'no provider available',
      primary: { provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
      fallback: { provider: 'codex', model: 'gpt-5.4-mini' },
      stderr: 'AI_APICallError: No provider available',
    },
  ])(
    '$primary.provider → $fallback.provider fallback succeeds after $signature failure',
    async ({ primary, fallback, stderr }) => {
      const f = makeFakes([
        { code: 1, stderr },
        { code: 0, stdout: 'fallback output' },
      ]);
      const r = await runModeLLM(process.cwd(), 'screen', 'prompt', {
        logsDir,
        runtime: {
          ...primary,
          fallback,
        },
        execImpl: f.execImpl,
        spawnImpl: f.spawnImpl,
      });

      expect(r.ok).toBe(true);
      expect(f.spawnedProviders).toEqual([primary.provider, fallback.provider]);
      expect(f.spawnedModels).toEqual([primary.model, fallback.model]);
      expect(r.stdout).toContain('fallback output');
      expect(r.usedFallback).toEqual({
        from: primary,
        to: fallback,
        reason: 'overloaded',
      });
    },
  );

  it.each([
    {
      signature: 'overloaded_error',
      primary: { provider: 'claude', model: 'claude-sonnet-4-6' },
      fallback: { provider: 'opencode', model: 'opencode/big-pickle' },
      primaryError: 'overloaded_error',
    },
    {
      signature: 'capacity',
      primary: { provider: 'codex', model: 'gpt-5.4-mini' },
      fallback: { provider: 'claude', model: 'claude-sonnet-4-6' },
      primaryError: 'at capacity',
    },
    {
      signature: 'internal server error',
      primary: { provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
      fallback: { provider: 'codex', model: 'gpt-5.4-mini' },
      primaryError: 'Internal server error',
    },
    {
      signature: 'no provider available',
      primary: { provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' },
      fallback: { provider: 'codex', model: 'gpt-5.4-mini' },
      primaryError: 'No provider available',
    },
  ])(
    '$primary.provider → $fallback.provider exhausts after $signature primary failure',
    async ({ primary, fallback, primaryError }) => {
      const f = makeFakes([
        { code: 1, stderr: primaryError },
        { code: 1, stderr: 'fallback process failed' },
      ]);
      const r = await runModeLLM(process.cwd(), 'screen', 'prompt', {
        logsDir,
        runtime: {
          ...primary,
          fallback,
        },
        execImpl: f.execImpl,
        spawnImpl: f.spawnImpl,
      });

      expect(r.ok).toBe(false);
      expect(f.spawnedProviders).toEqual([primary.provider, fallback.provider]);
      expect(f.spawnedModels).toEqual([primary.model, fallback.model]);
      expect(r.error).toBe(
        `primary ${primary.provider}/${primary.model}: exit 1 (overloaded); fallback ${fallback.provider}/${fallback.model}: exit 1`,
      );
      expect(r.stderr).toContain(primaryError);
      expect(r.stderr).toContain('fallback process failed');
      expect(r.usedFallback).toBeUndefined();
    },
  );
});
