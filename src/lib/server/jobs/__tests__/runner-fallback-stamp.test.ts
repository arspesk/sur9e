import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveModeRuntimeMock } = vi.hoisted(() => ({
  resolveModeRuntimeMock: vi.fn(),
}));

vi.mock('../command-registry', () => ({
  buildCommand: vi.fn(() => ({ cmd: 'fake-worker', args: [] })),
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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sur9e-runner-fallback-stamp-'));
    mkdirSync(join(root, 'data/jobs'), { recursive: true });
    resolveModeRuntimeMock.mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

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
