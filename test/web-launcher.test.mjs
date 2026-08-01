// Unit tests for the web launcher's pure helpers. Everything is
// dependency-injected — no real lsof, no real tailscale, no real data/.
import { existsSync, mkdtempSync, readFileSync, writeFileSync as writeFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cmdStart,
  cmdStatus,
  cmdStop,
  enableServe,
  findTailscaleCli,
  getListener,
  getTailnetUrl,
  getWebLaunchMode,
  parseWebArgs,
} from '../scripts/web.mjs';

function tmpStateDir() {
  return mkdtempSync(joinPath(tmpdir(), 'sur9e-web-test-'));
}

function readState(stateDir) {
  return JSON.parse(readFileSync(joinPath(stateDir, 'web.json'), 'utf-8'));
}

const CHECKOUT_ROOT = '/repo/sur9e';
const PROCESS_START = 'Fri Jul 31 18:29:59 2026';
const LAUNCH_ID = '11111111-1111-4111-8111-111111111111';
const STARTED_AT = '2026-07-31T18:30:00.000Z';

function writeVerifiedState(stateDir, overrides = {}) {
  const meta = {
    pid: 3333,
    prod: false,
    tailscale: false,
    startedAt: STARTED_AT,
    root: CHECKOUT_ROOT,
    processStart: PROCESS_START,
    launchId: LAUNCH_ID,
    ...overrides,
  };
  writeFs(joinPath(stateDir, 'web.pid'), String(meta.pid));
  writeFs(joinPath(stateDir, 'web.json'), JSON.stringify(meta));
  return meta;
}

function verifiedIdentity(pid = 3333, overrides = {}) {
  return {
    pid,
    ppid: 1,
    command: `node ${CHECKOUT_ROOT}/scripts/web.mjs`,
    cwd: CHECKOUT_ROOT,
    start: PROCESS_START,
    ...overrides,
  };
}

function fakeChild(pid = 7001) {
  const handlers = new Map();
  return {
    pid,
    kill: vi.fn(),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    unref: vi.fn(),
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
  };
}

function fakeProcess(pid = 7000) {
  const handlers = new Map();
  return {
    pid,
    env: {},
    execPath: '/test/node',
    exit: vi.fn(),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    emit(event, ...args) {
      handlers.get(event)?.(...args);
    },
  };
}

describe('parseWebArgs', () => {
  it('defaults to a plain dev start', () => {
    expect(parseWebArgs([])).toEqual({
      command: 'start',
      prod: false,
      tailscale: false,
      detach: false,
    });
  });

  it('parses combinable start flags', () => {
    expect(parseWebArgs(['--prod', '--tailscale', '--detach'])).toEqual({
      command: 'start',
      prod: true,
      tailscale: true,
      detach: true,
    });
  });

  it('parses status and stop subcommands', () => {
    expect(parseWebArgs(['status']).command).toBe('status');
    expect(parseWebArgs(['stop']).command).toBe('stop');
  });

  it('accepts an explicit `start` word (the documented default)', () => {
    expect(parseWebArgs(['start', '--prod'])).toEqual({
      command: 'start',
      prod: true,
      tailscale: false,
      detach: false,
    });
  });

  it('--tailscale implies prod — remote devices want built pages, not HMR', () => {
    expect(parseWebArgs(['--tailscale'])).toEqual({
      command: 'start',
      prod: true,
      tailscale: true,
      detach: false,
    });
  });

  it('--tailscale --dev keeps dev mode (explicit override)', () => {
    expect(parseWebArgs(['--tailscale', '--dev'])).toEqual({
      command: 'start',
      prod: false,
      tailscale: true,
      detach: false,
    });
  });

  it('rejects --dev combined with --prod', () => {
    expect(() => parseWebArgs(['--dev', '--prod'])).toThrow(/--dev and --prod/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseWebArgs(['--funnel'])).toThrow(/Unknown argument/);
  });

  it('rejects flags on status/stop', () => {
    expect(() => parseWebArgs(['stop', '--prod'])).toThrow(/only apply to start/);
  });
});

describe('getListener', () => {
  it('parses lsof -F output into pid + command', () => {
    const exec = vi.fn().mockReturnValue({ status: 0, stdout: 'p4242\ncnode\n' });
    expect(getListener({ exec })).toEqual({ pid: 4242, command: 'node' });
    expect(exec).toHaveBeenCalledWith('lsof', ['-nP', '-iTCP:3000', '-sTCP:LISTEN', '-Fpc']);
  });

  it('returns null when nothing listens (lsof exits 1)', () => {
    const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' });
    expect(getListener({ exec })).toBeNull();
  });
});

describe('findTailscaleCli', () => {
  it('prefers tailscale on PATH', () => {
    const exec = vi.fn().mockReturnValue({ status: 0, stdout: '/usr/local/bin/tailscale\n' });
    const exists = vi.fn();
    expect(findTailscaleCli({ exec, exists })).toBe('/usr/local/bin/tailscale');
    expect(exists).not.toHaveBeenCalled();
  });

  it('falls back to the macOS app bundle CLI', () => {
    const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' });
    const exists = vi.fn().mockReturnValue(true);
    expect(findTailscaleCli({ exec, exists })).toBe(
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    );
  });

  it('returns null when neither exists', () => {
    const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' });
    const exists = vi.fn().mockReturnValue(false);
    expect(findTailscaleCli({ exec, exists })).toBeNull();
  });
});

describe('getTailnetUrl', () => {
  it('builds the https URL from tailscale status --json', () => {
    const exec = vi.fn((cmd, args) => {
      if (args[0] === 'status') {
        return { status: 0, stdout: JSON.stringify({ Self: { DNSName: 'mac.tail1234.ts.net.' } }) };
      }
      return { status: 0, stdout: '/usr/local/bin/tailscale\n' }; // which tailscale
    });
    expect(getTailnetUrl({ exec })).toBe('https://mac.tail1234.ts.net');
  });

  it('returns null when the CLI is missing or errors', () => {
    const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' });
    expect(getTailnetUrl({ exec, exists: () => false })).toBeNull();
  });
});

describe('enableServe', () => {
  const ENABLE_LINK_OUTPUT =
    'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n\thttps://login.tailscale.com/f/serve?node=abc123\n';

  it('passes a timeout to the serve call — the CLI blocks forever when serve is not enabled', () => {
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/tailscale\n' };
      if (args[0] === 'serve') return { status: 0, stdout: '' };
      return { status: 0, stdout: JSON.stringify({ Self: { DNSName: 'mac.tail1234.ts.net.' } }) };
    });
    enableServe({ exec, exists: () => true, log: vi.fn(), error: vi.fn() });
    const serveCall = exec.mock.calls.find(c => c[1][0] === 'serve');
    expect(serveCall[2]).toMatchObject({ timeout: expect.any(Number) });
  });

  it('surfaces the enable link when the serve call times out (serve disabled on the tailnet)', () => {
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/tailscale\n' };
      if (args[0] === 'serve') {
        // spawnSync timeout shape: killed via SIGTERM, status null,
        // stdout holds whatever the CLI printed before the kill.
        return { status: null, signal: 'SIGTERM', stdout: ENABLE_LINK_OUTPUT, stderr: '' };
      }
      return { status: 1, stdout: '' };
    });
    const error = vi.fn();
    const ok = enableServe({ exec, exists: () => true, log: vi.fn(), error });
    expect(ok).toBe(false);
    const out = error.mock.calls.flat().join('\n');
    expect(out).toContain('https://login.tailscale.com/f/serve?node=abc123');
    expect(out).toMatch(/not enabled on your tailnet/i);
    expect(out).toMatch(/localhost:3000/);
  });

  it('logs the tailnet URL on success', () => {
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/tailscale\n' };
      if (args[0] === 'serve') return { status: 0, stdout: '' };
      return { status: 0, stdout: JSON.stringify({ Self: { DNSName: 'mac.tail1234.ts.net.' } }) };
    });
    const log = vi.fn();
    expect(enableServe({ exec, exists: () => true, log, error: vi.fn() })).toBe(true);
    expect(log.mock.calls.flat().join('\n')).toContain('https://mac.tail1234.ts.net');
  });
});

describe('managed launch mode', () => {
  const startedAt = '2026-07-31T18:30:00.000Z';
  const checkoutRoot = '/repo/sur9e';
  const launchId = '11111111-1111-4111-8111-111111111111';
  const processStart = 'Fri Jul 31 18:29:59 2026';

  function startForeground({ prod = false, tailscale = false } = {}) {
    const stateDir = tmpStateDir();
    const child = fakeChild();
    const processImpl = fakeProcess();
    let lsofCalls = 0;
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'lsof') {
        lsofCalls += 1;
        return lsofCalls === 1
          ? { status: 1, stdout: '' }
          : { status: 0, stdout: 'p7002\ncnode\n' };
      }
      if (cmd === 'which') return { status: 0, stdout: '/test/tailscale\n' };
      if (args?.[0] === 'status') {
        return {
          status: 0,
          stdout: JSON.stringify({ Self: { DNSName: 'test.tailnet.ts.net.' } }),
        };
      }
      return { status: 0, stdout: '' };
    });
    const spawnImpl = vi.fn().mockReturnValue(child);
    void cmdStart(
      { command: 'start', prod, tailscale, detach: false },
      {
        exec,
        spawnImpl,
        exists: () => true,
        log: vi.fn(),
        error: vi.fn(),
        stateDir,
        env: { SUR9E_WEB_SKIP_BUILD: '1' },
        processImpl,
        now: () => startedAt,
        root: checkoutRoot,
        launchId: () => launchId,
        inspectProcess: pid => ({
          pid,
          ppid: 1,
          command: `node ${checkoutRoot}/scripts/web.mjs`,
          cwd: checkoutRoot,
          start: processStart,
        }),
      },
    );
    return { child, exec, processImpl, spawnImpl, stateDir };
  }

  it.each([
    ['dev', false, false],
    ['prod', true, false],
    ['prod + tailscale', true, true],
  ])('persists foreground %s metadata for orchestrator readers', (_label, prod, tailscale) => {
    const { processImpl, spawnImpl, stateDir } = startForeground({ prod, tailscale });
    expect(readFileSync(joinPath(stateDir, 'web.pid'), 'utf-8')).toBe(String(processImpl.pid));
    expect(readState(stateDir)).toEqual({
      pid: processImpl.pid,
      prod,
      tailscale,
      startedAt,
      root: checkoutRoot,
      processStart,
      launchId,
    });

    expect(spawnImpl.mock.calls[0][2].env).toMatchObject({
      SUR9E_WEB_LAUNCH_ID: launchId,
    });

    expect(
      getWebLaunchMode({
        stateDir,
        inspectProcess: pid => verifiedIdentity(pid),
        root: checkoutRoot,
      }),
    ).toEqual({ prod, tailscale });
  });

  it('clears foreground state after signal-driven clean child exit', () => {
    const { child, processImpl, stateDir } = startForeground();
    processImpl.emit('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('exit', 0);
    expect(existsSync(joinPath(stateDir, 'web.pid'))).toBe(false);
    expect(existsSync(joinPath(stateDir, 'web.json'))).toBe(false);
    expect(processImpl.exit).toHaveBeenCalledWith(0);
  });

  it('does not clear state replaced by a different launcher before its child exits', () => {
    const { child, processImpl, stateDir } = startForeground({ prod: true });
    writeFs(joinPath(stateDir, 'web.pid'), String(processImpl.pid));
    writeFs(
      joinPath(stateDir, 'web.json'),
      JSON.stringify({
        pid: processImpl.pid,
        prod: false,
        tailscale: true,
        startedAt: '2026-07-31T19:30:00.000Z',
        root: checkoutRoot,
        processStart: 'Fri Jul 31 19:29:59 2026',
        launchId: '22222222-2222-4222-8222-222222222222',
      }),
    );

    child.emit('exit', 1);
    expect(readFileSync(joinPath(stateDir, 'web.pid'), 'utf-8')).toBe(String(processImpl.pid));
    expect(readState(stateDir).launchId).toBe('22222222-2222-4222-8222-222222222222');
    expect(processImpl.exit).toHaveBeenCalledWith(1);
  });

  it.each([
    ['stale', { status: 1, stdout: '' }],
    ['foreign', { status: 0, stdout: '/usr/bin/unrelated-server\n' }],
  ])('returns the safe dev-only fallback for %s persisted metadata', (_case, psResult) => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '8123');
    writeFs(
      joinPath(stateDir, 'web.json'),
      JSON.stringify({ pid: 8123, prod: true, tailscale: true, startedAt }),
    );
    const exec = vi.fn().mockReturnValue(psResult);
    expect(getWebLaunchMode({ stateDir, exec })).toEqual({ prod: false, tailscale: false });
  });

  it('rejects a launcher from another checkout even when the command and PID look valid', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '8123');
    writeFs(
      joinPath(stateDir, 'web.json'),
      JSON.stringify({
        pid: 8123,
        prod: true,
        tailscale: true,
        startedAt,
        root: '/repo/sur9e',
        processStart,
        launchId,
      }),
    );
    const exec = vi.fn().mockReturnValue({
      status: 0,
      stdout: 'node /repo/sur9e/scripts/web.mjs\n',
    });
    const inspectProcess = vi.fn().mockReturnValue({
      pid: 8123,
      ppid: 1,
      command: 'node /repo/other/scripts/web.mjs',
      cwd: '/repo/other',
      start: processStart,
    });

    expect(getWebLaunchMode({ stateDir, exec, inspectProcess, root: '/repo/sur9e' })).toEqual({
      prod: false,
      tailscale: false,
    });
  });

  it('rejects a reused PID whose process start identity no longer matches', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '8123');
    writeFs(
      joinPath(stateDir, 'web.json'),
      JSON.stringify({
        pid: 8123,
        prod: true,
        tailscale: true,
        startedAt,
        root: '/repo/sur9e',
        processStart,
        launchId,
      }),
    );
    const inspectProcess = vi.fn().mockReturnValue({
      pid: 8123,
      ppid: 1,
      command: 'node /repo/sur9e/scripts/web.mjs',
      cwd: '/repo/sur9e',
      start: 'Sat Aug  1 01:00:00 2026',
    });

    expect(getWebLaunchMode({ stateDir, inspectProcess, root: '/repo/sur9e' })).toEqual({
      prod: false,
      tailscale: false,
    });
  });

  it('returns the safe dev-only fallback for malformed persisted state', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '8123');
    writeFs(joinPath(stateDir, 'web.json'), '{not json');
    const exec = vi.fn();
    expect(getWebLaunchMode({ stateDir, exec })).toEqual({ prod: false, tailscale: false });
    expect(exec).not.toHaveBeenCalled();
  });

  it('keeps detached launch behavior keyed to the detached child PID', async () => {
    const stateDir = tmpStateDir();
    const child = fakeChild(9001);
    const processImpl = fakeProcess(9000);
    const spawnImpl = vi.fn().mockReturnValue(child);
    const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' });

    const code = await cmdStart(
      { command: 'start', prod: false, tailscale: false, detach: true },
      {
        exec,
        spawnImpl,
        error: vi.fn(),
        log: vi.fn(),
        stateDir,
        env: { TEST_MARKER: 'yes' },
        processImpl,
        now: () => startedAt,
        root: checkoutRoot,
        launchId: () => launchId,
        inspectProcess: pid => ({
          pid,
          ppid: processImpl.pid,
          command: `node ${checkoutRoot}/scripts/web.mjs`,
          cwd: checkoutRoot,
          start: processStart,
        }),
      },
    );

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalledWith(
      '/test/node',
      [expect.stringMatching(/scripts\/web\.mjs$/)],
      expect.objectContaining({
        detached: true,
        env: {
          TEST_MARKER: 'yes',
          SUR9E_WEB_SKIP_BUILD: '1',
          SUR9E_WEB_LAUNCH_ID: launchId,
        },
      }),
    );
    expect(readState(stateDir)).toEqual({
      pid: child.pid,
      prod: false,
      tailscale: false,
      startedAt,
      root: checkoutRoot,
      processStart,
      launchId,
    });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(processImpl.on).not.toHaveBeenCalled();
  });
});

describe('cmdStart — port guard', () => {
  it('refuses to start when :3000 is already in use and spawns nothing', async () => {
    const exec = vi.fn().mockReturnValue({ status: 0, stdout: 'p1111\ncnode\n' });
    const spawnImpl = vi.fn();
    const error = vi.fn();
    const code = await cmdStart(
      { command: 'start', prod: false, tailscale: false, detach: false },
      { exec, spawnImpl, error, log: vi.fn(), stateDir: tmpStateDir() },
    );
    expect(code).toBe(1);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).toMatch(/already in use by PID 1111/);
  });

  it('recovers an interrupted update before starting another server', async () => {
    const spawnImpl = vi.fn();
    const recoverUpdate = vi.fn().mockResolvedValue({
      status: 'recovered',
      jobId: '11111111-1111-4111-8111-111111111111',
      result: { status: 'rolled-back' },
    });
    const log = vi.fn();

    const code = await cmdStart(
      { command: 'start', prod: true, tailscale: false, detach: true },
      {
        exec: vi.fn().mockReturnValue({ status: 1, stdout: '' }),
        spawnImpl,
        error: vi.fn(),
        log,
        root: CHECKOUT_ROOT,
        hasInterruptedUpdate: () => true,
        recoverUpdate,
      },
    );

    expect(code).toBe(0);
    expect(recoverUpdate).toHaveBeenCalledWith(CHECKOUT_ROOT);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Recovered the previous Sur9e version after an interrupted update.',
    );
  });

  it('refuses a normal start when interrupted-update recovery fails', async () => {
    const spawnImpl = vi.fn();
    const error = vi.fn();

    const code = await cmdStart(
      { command: 'start', prod: false, tailscale: false, detach: false },
      {
        exec: vi.fn().mockReturnValue({ status: 1, stdout: '' }),
        spawnImpl,
        error,
        log: vi.fn(),
        root: CHECKOUT_ROOT,
        hasInterruptedUpdate: () => true,
        recoverUpdate: vi.fn().mockResolvedValue({
          status: 'recovered',
          jobId: '11111111-1111-4111-8111-111111111111',
          result: { status: 'failed' },
        }),
      },
    );

    expect(code).toBe(1);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Interrupted update recovery failed — the server was not started.',
    );
  });

  it('exports the tailnet host to next dev so allowedDevOrigins can unblock proxied assets', () => {
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');
    try {
      let lsofCalls = 0;
      const exec = vi.fn((cmd, args) => {
        // Port guard sees a free port; waitForListener then finds the server.
        if (cmd === 'lsof')
          return ++lsofCalls === 1
            ? { status: 1, stdout: '' }
            : { status: 0, stdout: 'p9999\ncnode\n' };
        if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/tailscale\n' };
        if (args[0] === 'serve') return { status: 0, stdout: '' };
        return { status: 0, stdout: JSON.stringify({ Self: { DNSName: 'mac.tail1234.ts.net.' } }) };
      });
      const spawnImpl = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn() });
      void cmdStart(
        { command: 'start', prod: false, tailscale: true, detach: false },
        {
          exec,
          spawnImpl,
          error: vi.fn(),
          log: vi.fn(),
          stateDir: tmpStateDir(),
          root: CHECKOUT_ROOT,
          inspectProcess: pid => verifiedIdentity(pid),
        },
      );
      expect(spawnImpl).toHaveBeenCalledTimes(1);
      const opts = spawnImpl.mock.calls[0][2];
      expect(opts.env.SUR9E_TAILNET_HOST).toBe('mac.tail1234.ts.net');
    } finally {
      for (const l of process.listeners('SIGINT'))
        if (!sigintBefore.includes(l)) process.removeListener('SIGINT', l);
      for (const l of process.listeners('SIGTERM'))
        if (!sigtermBefore.includes(l)) process.removeListener('SIGTERM', l);
    }
  });

  it('spawns the local next binary directly — never through npx (SIGTERM forwarding)', () => {
    // Snapshot signal handlers: runForeground installs SIGINT/SIGTERM traps
    // we must remove so the test process stays clean.
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');
    try {
      const exec = vi.fn().mockReturnValue({ status: 1, stdout: '' }); // port free
      const spawnImpl = vi.fn().mockReturnValue({ kill: vi.fn(), on: vi.fn() });
      // Not awaited: runForeground's returned promise never resolves (the
      // child's exit handler owns the lifetime). The spawn happens
      // synchronously before the first await, so the assertion is safe.
      void cmdStart(
        { command: 'start', prod: false, tailscale: false, detach: false },
        {
          exec,
          spawnImpl,
          error: vi.fn(),
          log: vi.fn(),
          stateDir: tmpStateDir(),
          root: CHECKOUT_ROOT,
          inspectProcess: pid => verifiedIdentity(pid),
        },
      );
      expect(spawnImpl).toHaveBeenCalledTimes(1);
      const [bin, args] = spawnImpl.mock.calls[0];
      expect(bin.endsWith('node_modules/.bin/next')).toBe(true);
      expect(args).toEqual(['dev', '-p', '3000']);
    } finally {
      for (const l of process.listeners('SIGINT'))
        if (!sigintBefore.includes(l)) process.removeListener('SIGINT', l);
      for (const l of process.listeners('SIGTERM'))
        if (!sigtermBefore.includes(l)) process.removeListener('SIGTERM', l);
    }
  });
});

describe('cmdStatus — verified ownership only', () => {
  it('does not report reused launcher metadata as managed or expose its tailscale mode', () => {
    const stateDir = tmpStateDir();
    const root = '/repo/sur9e';
    writeFs(joinPath(stateDir, 'web.pid'), '3333');
    writeFs(
      joinPath(stateDir, 'web.json'),
      JSON.stringify({
        pid: 3333,
        prod: true,
        tailscale: true,
        startedAt: '2026-07-31T18:30:00.000Z',
        root,
        processStart: 'Fri Jul 31 18:29:59 2026',
        launchId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    const exec = vi.fn(cmd =>
      cmd === 'lsof' ? { status: 0, stdout: 'p9999\ncnode\n' } : { status: 1, stdout: '' },
    );
    const log = vi.fn();

    expect(
      cmdStatus({
        exec,
        inspectProcess: () => ({
          pid: 3333,
          ppid: 1,
          command: `node ${root}/scripts/web.mjs`,
          cwd: root,
          start: 'Sat Aug  1 01:00:00 2026',
        }),
        log,
        root,
        stateDir,
      }),
    ).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toMatch(/not managed/i);
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/tailnet/i);
  });
});

describe('cmdStop — never kills foreign processes', () => {
  const checkoutRoot = '/repo/sur9e';
  const processStart = 'Fri Jul 31 18:29:59 2026';
  const launchId = '11111111-1111-4111-8111-111111111111';

  function writeManagedState(stateDir, overrides = {}) {
    const meta = {
      pid: 3333,
      prod: false,
      tailscale: false,
      startedAt: '2026-07-31T18:30:00.000Z',
      root: checkoutRoot,
      processStart,
      launchId,
      ...overrides,
    };
    writeFs(joinPath(stateDir, 'web.pid'), String(meta.pid));
    writeFs(joinPath(stateDir, 'web.json'), JSON.stringify(meta));
    return meta;
  }

  it('refuses a reused managed PID before sending any signal', async () => {
    const stateDir = tmpStateDir();
    writeManagedState(stateDir);
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'ps' && args?.includes('command=')) {
        return { status: 0, stdout: `node ${checkoutRoot}/scripts/web.mjs\n` };
      }
      return { status: 1, stdout: '' };
    });
    const inspectProcess = vi.fn().mockReturnValue({
      pid: 3333,
      ppid: 1,
      command: `node ${checkoutRoot}/scripts/web.mjs`,
      cwd: checkoutRoot,
      start: 'Sat Aug  1 01:00:00 2026',
    });
    const kill = vi.fn();
    const error = vi.fn();

    const code = await cmdStop({
      exec,
      inspectProcess,
      kill,
      error,
      log: vi.fn(),
      stateDir,
      root: checkoutRoot,
    });

    expect(code).toBe(1);
    expect(kill).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).toMatch(/ownership.*not killing/i);
  });

  it('refuses a launcher owned by another checkout before sending any signal', async () => {
    const stateDir = tmpStateDir();
    writeManagedState(stateDir);
    const inspectProcess = vi.fn().mockReturnValue({
      pid: 3333,
      ppid: 1,
      command: 'node /repo/other/scripts/web.mjs',
      cwd: '/repo/other',
      start: processStart,
    });
    const kill = vi.fn();
    const error = vi.fn();

    const code = await cmdStop({
      exec: vi.fn().mockReturnValue({ status: 0, stdout: 'node scripts/web.mjs\n' }),
      inspectProcess,
      kill,
      error,
      log: vi.fn(),
      stateDir,
      root: checkoutRoot,
    });

    expect(code).toBe(1);
    expect(kill).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).toMatch(/ownership.*not killing/i);
  });

  it('rechecks managed ownership immediately before each signal', async () => {
    const stateDir = tmpStateDir();
    writeManagedState(stateDir);
    const validIdentity = {
      pid: 3333,
      ppid: 1,
      command: `node ${checkoutRoot}/scripts/web.mjs`,
      cwd: checkoutRoot,
      start: processStart,
    };
    const inspectProcess = vi
      .fn()
      .mockReturnValueOnce(validIdentity)
      .mockReturnValueOnce(validIdentity)
      .mockReturnValue({ ...validIdentity, start: 'Sat Aug  1 01:00:00 2026' });
    const kill = vi.fn();

    const code = await cmdStop({
      exec: vi.fn().mockReturnValue({ status: 1, stdout: '' }),
      inspectProcess,
      kill,
      error: vi.fn(),
      log: vi.fn(),
      stateDir,
      root: checkoutRoot,
    });

    expect(code).toBe(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it('never signals a foreign listener that takes or holds port 3000 during escalation', async () => {
    const stateDir = tmpStateDir();
    writeManagedState(stateDir);
    const identities = new Map([
      [
        3333,
        {
          pid: 3333,
          ppid: 1,
          command: `node ${checkoutRoot}/scripts/web.mjs`,
          cwd: checkoutRoot,
          start: processStart,
        },
      ],
      [
        9999,
        {
          pid: 9999,
          ppid: 1,
          command: '/usr/local/bin/foreign-server',
          cwd: '/repo/foreign',
          start: 'Sat Aug  1 01:00:00 2026',
        },
      ],
    ]);
    const inspectProcess = vi.fn(pid => identities.get(pid) ?? null);
    const exec = vi.fn(cmd =>
      cmd === 'lsof'
        ? { status: 0, stdout: 'p9999\ncforeign-server\n' }
        : { status: 1, stdout: '' },
    );
    const kill = vi.fn();

    const code = await cmdStop({
      exec,
      inspectProcess,
      kill,
      error: vi.fn(),
      log: vi.fn(),
      stateDir,
      root: checkoutRoot,
      termWaitMs: 0,
      killWaitMs: 0,
      pollMs: 0,
    });

    expect(code).toBe(1);
    expect(kill).not.toHaveBeenCalledWith(9999, expect.anything());
  });

  it('refuses when the PID file process is not our launcher', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '2222');
    writeFs(joinPath(stateDir, 'web.json'), JSON.stringify({ prod: false, tailscale: false }));
    // ps -p 2222 -o command= → some other process
    const exec = vi.fn(cmd =>
      cmd === 'ps'
        ? { status: 0, stdout: '/usr/bin/some-other-daemon\n' }
        : { status: 1, stdout: '' },
    );
    const kill = vi.fn();
    const error = vi.fn();
    cmdStop({ exec, kill, error, log: vi.fn(), stateDir });
    expect(kill).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join('\n')).toMatch(/not killing/i);
  });

  it('kills a live managed launcher and resets tailscale serve when we enabled it', async () => {
    const stateDir = tmpStateDir();
    writeVerifiedState(stateDir, { prod: true, tailscale: true });
    const calls = [];
    const exec = vi.fn((cmd, args) => {
      calls.push([cmd, ...(args ?? [])].join(' '));
      if (cmd === 'ps') return { status: 0, stdout: 'node scripts/web.mjs --prod --tailscale\n' };
      if (cmd === 'which') return { status: 0, stdout: '/usr/local/bin/tailscale\n' };
      return { status: 0, stdout: '' };
    });
    const kill = vi.fn();
    await cmdStop({
      exec,
      inspectProcess: pid => verifiedIdentity(pid),
      kill,
      error: vi.fn(),
      log: vi.fn(),
      root: CHECKOUT_ROOT,
      stateDir,
    });
    expect(kill).toHaveBeenCalledWith(3333, 'SIGTERM');
    expect(calls.some(c => c.includes('serve reset'))).toBe(true);
    // State files must be gone after a successful stop.
    expect(existsSync(joinPath(stateDir, 'web.pid'))).toBe(false);
    expect(existsSync(joinPath(stateDir, 'web.json'))).toBe(false);
  });

  it('waits for the :3000 listener to clear after killing — stop && start must not race', async () => {
    const stateDir = tmpStateDir();
    writeVerifiedState(stateDir);
    // The next-server child holds the port for the first two lsof polls
    // after SIGTERM, then releases it.
    let lsofCalls = 0;
    const exec = vi.fn(cmd => {
      if (cmd === 'ps') return { status: 0, stdout: 'node scripts/web.mjs\n' };
      if (cmd === 'lsof')
        return ++lsofCalls <= 2
          ? { status: 0, stdout: 'p9999\ncnode\n' }
          : { status: 1, stdout: '' };
      return { status: 1, stdout: '' };
    });
    await cmdStop({
      exec,
      inspectProcess: pid => verifiedIdentity(pid),
      kill: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      root: CHECKOUT_ROOT,
      stateDir,
    });
    expect(lsofCalls).toBeGreaterThanOrEqual(3); // polled until the port was free
  });

  it('treats a dead PID as stale state — cleans up without the foreign-process warning', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '5555');
    writeFs(joinPath(stateDir, 'web.json'), JSON.stringify({ prod: false, tailscale: false }));
    // ps -p 5555 exits non-zero → the process is gone.
    const exec = vi.fn(cmd => ({ status: cmd === 'ps' ? 1 : 1, stdout: '' }));
    const kill = vi.fn();
    const log = vi.fn();
    const error = vi.fn();
    cmdStop({ exec, kill, error, log, stateDir });
    expect(kill).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toMatch(/stale state.*no longer running/i);
    expect(error).not.toHaveBeenCalled();
    expect(existsSync(joinPath(stateDir, 'web.pid'))).toBe(false);
  });

  it('does not touch tailscale when web.json says we never enabled it', () => {
    const stateDir = tmpStateDir();
    writeFs(joinPath(stateDir, 'web.pid'), '4444');
    writeFs(joinPath(stateDir, 'web.json'), JSON.stringify({ prod: false, tailscale: false }));
    const exec = vi.fn(cmd =>
      cmd === 'ps' ? { status: 0, stdout: 'node scripts/web.mjs\n' } : { status: 0, stdout: '' },
    );
    cmdStop({ exec, kill: vi.fn(), error: vi.fn(), log: vi.fn(), stateDir });
    expect(exec.mock.calls.map(c => c[0])).not.toContain('/usr/local/bin/tailscale');
  });
});

describe('cmdStop — suspended / wedged servers', () => {
  it('resumes a suspended tree (SIGCONT) before asking it to exit (SIGTERM)', async () => {
    const stateDir = tmpStateDir();
    writeVerifiedState(stateDir);
    // lsof returns no listener → port is already free, no escalation needed.
    const exec = vi.fn(cmd => ({ status: cmd === 'ps' ? 0 : 1, stdout: 'node scripts/web.mjs\n' }));
    const kill = vi.fn();
    await cmdStop({
      exec,
      inspectProcess: pid => verifiedIdentity(pid),
      kill,
      error: vi.fn(),
      log: vi.fn(),
      root: CHECKOUT_ROOT,
      stateDir,
    });
    const signals = kill.mock.calls.filter(c => c[0] === 3333).map(c => c[1]);
    expect(signals.slice(0, 2)).toEqual(['SIGCONT', 'SIGTERM']); // resume, then terminate
  });

  it('escalates to SIGKILL (launcher + actual port holder) when SIGTERM does not free :3000', async () => {
    const stateDir = tmpStateDir();
    writeVerifiedState(stateDir);
    let sigkilled = false;
    const kill = vi.fn((_pid, sig) => {
      if (sig === 'SIGKILL') sigkilled = true;
    });
    // The port stays bound (suspended child) until something sends SIGKILL.
    const exec = vi.fn(cmd => {
      if (cmd === 'ps') return { status: 0, stdout: 'node scripts/web.mjs\n' };
      if (cmd === 'lsof')
        return sigkilled ? { status: 1, stdout: '' } : { status: 0, stdout: 'p9999\ncnode\n' };
      return { status: 1, stdout: '' };
    });
    const error = vi.fn();
    const code = await cmdStop({
      exec,
      inspectProcess: pid =>
        pid === 9999
          ? verifiedIdentity(9999, { ppid: 3333, command: 'next-server' })
          : verifiedIdentity(pid),
      kill,
      error,
      log: vi.fn(),
      stateDir,
      root: CHECKOUT_ROOT,
      termWaitMs: 60,
      killWaitMs: 300,
      pollMs: 10,
    });
    expect(kill).toHaveBeenCalledWith(3333, 'SIGKILL'); // the wrapper
    expect(kill).toHaveBeenCalledWith(9999, 'SIGKILL'); // the actual :3000 holder
    expect(error.mock.calls.flat().join('\n')).toMatch(/escalating to SIGKILL/i);
    expect(code).toBe(0);
    expect(existsSync(joinPath(stateDir, 'web.pid'))).toBe(false); // cleared on real success
  });

  it('reports failure honestly and KEEPS state when :3000 will not free even after SIGKILL', async () => {
    const stateDir = tmpStateDir();
    writeVerifiedState(stateDir);
    const exec = vi.fn(cmd => {
      if (cmd === 'ps') return { status: 0, stdout: 'node scripts/web.mjs\n' };
      if (cmd === 'lsof') return { status: 0, stdout: 'p9999\ncnode\n' }; // never clears
      return { status: 1, stdout: '' };
    });
    const error = vi.fn();
    const code = await cmdStop({
      exec,
      inspectProcess: pid =>
        pid === 9999
          ? verifiedIdentity(9999, { ppid: 3333, command: 'next-server' })
          : verifiedIdentity(pid),
      kill: vi.fn(),
      error,
      log: vi.fn(),
      stateDir,
      root: CHECKOUT_ROOT,
      termWaitMs: 40,
      killWaitMs: 40,
      pollMs: 10,
    });
    expect(code).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(/kill -9 9999/);
    // State preserved so a retry can still target the PID (the old bug cleared
    // it after a failed stop, orphaning the process from the launcher).
    expect(existsSync(joinPath(stateDir, 'web.pid'))).toBe(true);
  });

  it('refuses an untracked foreground dev server because no persisted ownership can be proved', async () => {
    const stateDir = tmpStateDir(); // foreground start writes no state file
    const root = '/repo/sur9e';
    let groupKilled = false;
    const kill = vi.fn((pid, sig) => {
      if (sig === 'SIGKILL' && pid < 0) groupKilled = true; // killing the group frees :3000
    });
    // Real ancestry: next renames the listener (no repo path); the identifying
    // process is its parent `next dev` from this checkout.
    const tree = {
      77001: '77000 next-server (v16.2.7)',
      77000: `76000 node ${root}/node_modules/.bin/next dev -p 3000`,
    };
    const exec = vi.fn((cmd, args) => {
      if (cmd === 'lsof')
        return groupKilled ? { status: 1, stdout: '' } : { status: 0, stdout: 'p77001\ncnode\n' };
      if (cmd === 'ps' && args?.includes('ppid=,command=')) {
        const pid = args[args.indexOf('-p') + 1];
        return tree[pid] ? { status: 0, stdout: `${tree[pid]}\n` } : { status: 1, stdout: '' };
      }
      if (cmd === 'ps' && args?.includes('pgid=')) return { status: 0, stdout: '77000\n' };
      return { status: 1, stdout: '' };
    });
    const log = vi.fn();
    const error = vi.fn();
    const code = await cmdStop({
      exec,
      kill,
      error,
      log,
      stateDir,
      root,
      killWaitMs: 300,
      pollMs: 10,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(code).toBe(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/stopped/i));
    expect(error.mock.calls.flat().join('\n')).toMatch(/not killing/i);
  });

  it('refuses (kill -9 hint, exit 1) a foreign listener that is NOT a sur9e server', async () => {
    const stateDir = tmpStateDir(); // no web.pid; ps shows an unrelated command
    const exec = vi.fn(cmd =>
      cmd === 'lsof' ? { status: 0, stdout: 'p91548\ncnginx\n' } : { status: 1, stdout: '' },
    );
    const error = vi.fn();
    const code = await cmdStop({ exec, kill: vi.fn(), error, log: vi.fn(), stateDir });
    expect(code).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(
      /no verified sur9e launch metadata.*not killing.*kill -9 91548/s,
    );
  });
});
