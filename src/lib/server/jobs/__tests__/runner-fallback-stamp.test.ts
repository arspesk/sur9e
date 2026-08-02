import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { buildCommandMock, resolveModeRuntimeMock } = vi.hoisted(() => ({
  buildCommandMock: vi.fn(() => ({ cmd: 'fake-worker', args: [] as string[] })),
  resolveModeRuntimeMock: vi.fn(),
}));

vi.mock('../command-registry', () => ({
  buildCommand: buildCommandMock,
}));

vi.mock('../../providers/registry', () => ({
  getProvider: vi.fn(() => ({
    checkInstalled: vi.fn().mockResolvedValue({ ok: true, version: 'test' }),
  })),
  resolveModeRuntime: resolveModeRuntimeMock,
}));

import type { JobRecord } from '../../../schemas/jobs';
import { persistJobRecord, readJobRecord } from '../lifecycle';
import { extractFallbackStamp, spawnJob } from '../runner';

const JOB_ID = '0123456789abcdef';

type KillProcess = (pid: number, signal: NodeJS.Signals) => unknown;

function cleanupWorkerProcessGroup(
  rootPath: string,
  processGroupId: number | null,
  killProcess: KillProcess = process.kill,
): boolean {
  if (
    process.platform === 'win32' ||
    typeof processGroupId !== 'number' ||
    !Number.isInteger(processGroupId) ||
    processGroupId <= 1
  ) {
    return false;
  }
  const job = readJobRecord(rootPath, JOB_ID);
  if (job?.status !== 'running' || job.processGroupId !== processGroupId) return false;
  try {
    killProcess(-processGroupId, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const PROVIDER_CASES = [
  {
    provider: 'claude' as const,
    primaryModel: 'claude-opus-4-7',
    fallbackModel: 'claude-sonnet-4-6',
  },
  { provider: 'codex' as const, primaryModel: 'gpt-5.4-mini', fallbackModel: 'gpt-5-codex' },
  {
    provider: 'opencode' as const,
    primaryModel: 'opencode-go/glm-5.2',
    fallbackModel: 'opencode/big-pickle',
  },
];

const ONE_HOP_PROVIDER_PAIRS = PROVIDER_CASES.flatMap(primary =>
  PROVIDER_CASES.map(fallback => ({
    primary: { provider: primary.provider, model: primary.primaryModel },
    fallback: { provider: fallback.provider, model: fallback.fallbackModel },
  })),
);

function fakeChild(): ChildProcess & {
  stdout: NonNullable<ChildProcess['stdout']>;
  stderr: NonNullable<ChildProcess['stderr']>;
} {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { configurable: true, value: 4321 },
    exitCode: { configurable: true, value: null },
    stdout: { configurable: true, value: new EventEmitter() },
    stderr: { configurable: true, value: new EventEmitter() },
  });
  return child as ChildProcess & {
    stdout: NonNullable<ChildProcess['stdout']>;
    stderr: NonNullable<ChildProcess['stderr']>;
  };
}

describe('extractFallbackStamp', () => {
  it('parses the last [FALLBACK] marker from job output', () => {
    const output = [
      'some log',
      '[FALLBACK] {"from":{"provider":"claude","model":"claude-opus-4-7"},"to":{"provider":"codex","model":"gpt-5-codex"},"reason":"overloaded"}',
      'more output',
    ].join('\n');
    expect(extractFallbackStamp(output)).toEqual({
      from: { provider: 'claude', model: 'claude-opus-4-7' },
      to: { provider: 'codex', model: 'gpt-5-codex' },
      reason: 'overloaded',
    });
  });
  it('returns null when no marker present', () => {
    expect(extractFallbackStamp('just logs')).toBeNull();
  });
  it('returns null on malformed marker JSON', () => {
    expect(extractFallbackStamp('[FALLBACK] {not json')).toBeNull();
  });
  it('takes the LAST marker when several exist (multi-call jobs like screen)', () => {
    const output = [
      '[FALLBACK] {"from":{"provider":"claude","model":"a"},"to":{"provider":"codex","model":"b"},"reason":"quota"}',
      '[FALLBACK] {"from":{"provider":"claude","model":"a"},"to":{"provider":"opencode","model":"c"},"reason":"overloaded"}',
    ].join('\n');
    expect(extractFallbackStamp(output)?.to.provider).toBe('opencode');
  });
});

describe('cleanupWorkerProcessGroup', () => {
  it.runIf(process.platform !== 'win32')(
    'does not signal a terminal job process group whose id may have been reused',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'sur9e-terminal-worker-cleanup-'));
      const processGroupId = 4321;
      const killProcess = vi.fn();
      persistJobRecord(root, {
        id: JOB_ID,
        type: 'evaluate',
        status: 'done',
        params: { num: 56 },
        startedAt: '2026-08-02T01:29:47.873Z',
        finishedAt: '2026-08-02T01:29:48.873Z',
        output: 'fallback completed',
        error: null,
        exitCode: 0,
        processGroupId,
      });

      try {
        expect(cleanupWorkerProcessGroup(root, processGroupId, killProcess)).toBe(false);
        expect(killProcess).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe('spawnJob fallback metadata', () => {
  let root: string;
  let realWorkerProcessGroupId: number | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-runner-fallback-stamp-'));
    mkdirSync(join(root, 'data/jobs'), { recursive: true });
    buildCommandMock.mockReset();
    buildCommandMock.mockReturnValue({ cmd: 'fake-worker', args: [] });
    resolveModeRuntimeMock.mockReset();
    realWorkerProcessGroupId = null;
  });

  afterEach(() => {
    cleanupWorkerProcessGroup(root, realWorkerProcessGroupId);
    rmSync(root, { recursive: true, force: true });
  });

  it.runIf(process.platform !== 'win32')(
    'persists a real silent-timeout fallback and kills the primary descendant',
    async () => {
      const primary = { provider: 'opencode' as const, model: 'opencode-go/glm-5.2' };
      const fallback = { provider: 'claude' as const, model: 'claude-sonnet-5' };
      const descendantPidFile = join(root, 'descendant.pid');
      const worker = join(process.cwd(), 'test/fixtures/fallback-timeout-worker.mjs');
      buildCommandMock.mockReturnValue({
        cmd: process.execPath,
        args: [worker, root, descendantPidFile],
      });
      resolveModeRuntimeMock.mockReturnValue({
        ...primary,
        exec: 'headless',
        resolvedFrom: 'global_default',
        fallback,
      });
      const job: JobRecord = {
        id: JOB_ID,
        type: 'evaluate',
        status: 'queued',
        params: { num: 55 },
        startedAt: '2026-08-01T20:00:00.000Z',
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      };
      persistJobRecord(root, job);

      let descendantPid = 0;
      try {
        await spawnJob(root, job, { trackUsage: vi.fn() });
        realWorkerProcessGroupId = readJobRecord(root, JOB_ID)?.processGroupId ?? null;
        await vi.waitFor(
          () => {
            expect(existsSync(descendantPidFile)).toBe(true);
            descendantPid = Number(readFileSync(descendantPidFile, 'utf8').trim());
            expect(descendantPid).toBeGreaterThan(1);
          },
          { timeout: 5000, interval: 25 },
        );
        await vi.waitFor(
          () => {
            expect(readJobRecord(root, JOB_ID)?.status).toBe('done');
          },
          { timeout: 5000, interval: 25 },
        );

        const completed = readJobRecord(root, JOB_ID);
        expect(completed).toMatchObject({
          status: 'done',
          provider: fallback.provider,
          model: fallback.model,
          fallback: { from: primary, reason: 'timeout' },
        });
        expect(completed?.output).toContain('> build · glm-5.2');
        expect(completed?.output).toContain('fallback completed');
        expect(completed?.output).toContain(
          `[FALLBACK] ${JSON.stringify({ from: primary, to: fallback, reason: 'timeout' })}`,
        );

        expect(descendantPid).toBeGreaterThan(1);
        await vi.waitFor(
          () => {
            expect(() => process.kill(descendantPid, 0)).toThrow(
              expect.objectContaining({ code: 'ESRCH' }),
            );
          },
          { timeout: 1000, interval: 20 },
        );
      } finally {
        if (descendantPid <= 1 && existsSync(descendantPidFile)) {
          const parsedPid = Number(readFileSync(descendantPidFile, 'utf8').trim());
          if (parsedPid > 1) descendantPid = parsedPid;
        }
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'persists an immediate OpenCode quota fallback from the real adapter command',
    async () => {
      const primary = { provider: 'opencode' as const, model: 'opencode-go/glm-5.2' };
      const fallback = { provider: 'opencode' as const, model: 'opencode/big-pickle' };
      const fakeBin = join(root, 'fake-bin');
      const fakeOpencode = join(fakeBin, 'opencode');
      const descendantPidFile = join(root, 'opencode-descendant.pid');
      const worker = join(process.cwd(), 'test/fixtures/fallback-opencode-quota-worker.mjs');
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(
        fakeOpencode,
        `#!/bin/sh
print_logs=false
model=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-logs) print_logs=true ;;
    -m|--model) shift; model="$1" ;;
  esac
  shift
done
if [ "$model" = "opencode-go/glm-5.2" ]; then
  sleep 30 &
  descendant=$!
  printf '%s' "$descendant" > "$SUR9E_TEST_DESCENDANT_PID_FILE"
  if [ "$print_logs" = true ]; then
    printf '%s\n' 'AI_APICallError: Weekly usage limit reached. Resets in 1 day.' >&2
  fi
  wait "$descendant"
else
  printf '%s\n' 'fallback completed'
fi
`,
        'utf8',
      );
      chmodSync(fakeOpencode, 0o755);
      buildCommandMock.mockReturnValue({
        cmd: process.execPath,
        args: [worker, root, process.cwd(), fakeBin, descendantPidFile],
      });
      resolveModeRuntimeMock.mockReturnValue({
        ...primary,
        exec: 'headless',
        resolvedFrom: 'mode_setting',
        fallback,
      });
      const job: JobRecord = {
        id: JOB_ID,
        type: 'evaluate',
        status: 'queued',
        params: { num: 56 },
        startedAt: '2026-08-02T01:29:47.873Z',
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      };
      persistJobRecord(root, job);

      let descendantPid = 0;
      try {
        await spawnJob(root, job, { trackUsage: vi.fn() });
        realWorkerProcessGroupId = readJobRecord(root, JOB_ID)?.processGroupId ?? null;
        await vi.waitFor(
          () => {
            expect(existsSync(descendantPidFile)).toBe(true);
            descendantPid = Number(readFileSync(descendantPidFile, 'utf8').trim());
            expect(descendantPid).toBeGreaterThan(1);
          },
          { timeout: 5000, interval: 25 },
        );
        await vi.waitFor(() => expect(readJobRecord(root, JOB_ID)?.status).toBe('done'), {
          timeout: 5000,
          interval: 25,
        });

        const completed = readJobRecord(root, JOB_ID);
        expect(completed).toMatchObject({
          status: 'done',
          provider: fallback.provider,
          model: fallback.model,
          fallback: { from: primary, reason: 'quota' },
        });
        expect(completed?.output).toContain('Weekly usage limit reached');
        expect(completed?.output).toContain('fallback completed');
        expect(completed?.output).toContain(
          `[FALLBACK] ${JSON.stringify({ from: primary, to: fallback, reason: 'quota' })}`,
        );
        await vi.waitFor(
          () => {
            expect(() => process.kill(descendantPid, 0)).toThrow(
              expect.objectContaining({ code: 'ESRCH' }),
            );
          },
          { timeout: 1000, interval: 20 },
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

  it.each(ONE_HOP_PROVIDER_PAIRS)(
    're-stamps $primary.provider → $fallback.provider onto the selected fallback provider and model',
    async ({ primary, fallback }) => {
      resolveModeRuntimeMock.mockReturnValue({
        ...primary,
        exec: 'headless',
        resolvedFrom: 'global_default',
        fallback,
      });
      const job: JobRecord = {
        id: JOB_ID,
        type: 'evaluate',
        status: 'queued',
        params: { num: 1 },
        startedAt: '2026-07-31T10:00:00.000Z',
        finishedAt: null,
        output: '',
        error: null,
        exitCode: null,
      };
      persistJobRecord(root, job);
      const child = fakeChild();
      const spawnProcess = vi.fn(() => child);
      const trackUsage = vi.fn();

      await spawnJob(root, job, {
        spawnProcess,
        trackUsage,
      });
      child.stdout.emit(
        'data',
        Buffer.from(
          `[FALLBACK] ${JSON.stringify({ from: primary, to: fallback, reason: 'overloaded' })}\n` +
            '[USAGE] {"input_tokens":10,"output_tokens":5}\n',
        ),
      );
      child.emit('close', 0);
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(readJobRecord(root, JOB_ID)).toMatchObject({
        status: 'done',
        provider: fallback.provider,
        model: fallback.model,
        fallback: {
          from: primary,
          reason: 'overloaded',
        },
      });
      expect(trackUsage).toHaveBeenCalledTimes(1);
      expect(trackUsage).toHaveBeenCalledWith(
        fallback.provider,
        10,
        5,
        expect.objectContaining({ model: fallback.model }),
      );
    },
  );
});
