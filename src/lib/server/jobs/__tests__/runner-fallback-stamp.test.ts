import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    if (
      process.platform !== 'win32' &&
      Number.isInteger(realWorkerProcessGroupId) &&
      (realWorkerProcessGroupId as number) > 1
    ) {
      try {
        process.kill(-(realWorkerProcessGroupId as number), 'SIGKILL');
      } catch {}
    }
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
        await vi.waitFor(() => expect(existsSync(descendantPidFile)).toBe(true), {
          timeout: 5000,
          interval: 25,
        });
        descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));
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
          descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));
        }
        if (descendantPid > 1) {
          try {
            process.kill(descendantPid, 'SIGKILL');
          } catch {}
        }
      }
    },
  );

  it.each([
    {
      primary: { provider: 'claude', model: 'claude-sonnet-4-6' },
      fallback: { provider: 'codex', model: 'gpt-5.4-mini' },
    },
    {
      primary: { provider: 'codex', model: 'gpt-5.4-mini' },
      fallback: { provider: 'opencode', model: 'opencode/big-pickle' },
    },
    {
      primary: { provider: 'opencode', model: 'opencode/big-pickle' },
      fallback: { provider: 'claude', model: 'claude-sonnet-4-6' },
    },
  ])(
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
