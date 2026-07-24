// test/unit/chat/chat-action-routes.test.ts
//
// Direct-call tests for the chat action route handlers (start-job,
// set-status). Pattern B: tmpdir + SUR9E_ROOT + vi.resetModules() +
// dynamic import; turn-runner and the job spawner are mocked.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitTurnEventMock = vi.fn();
const spawnJobMock = vi.fn();

vi.mock('@/lib/server/chat/turn-runner', () => ({ emitTurnEvent: emitTurnEventMock }));
vi.mock('@/lib/server/jobs/runner', () => ({ spawnJob: spawnJobMock }));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-routes-test-'));
  mkdirSync(join(root, 'data/jobs'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), APPLICATIONS_MD, 'utf-8');
  mkdirSync(join(root, 'inputs/personalization'), { recursive: true });
  writeFileSync(join(root, 'inputs/personalization/cv.md'), '# CV\n', 'utf-8');
  writeFileSync(join(root, 'inputs/personalization/profile.yml'), 'name: Test\n', 'utf-8');
  return root;
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function flushImmediate(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

type StartJobRoute = typeof import('@/app/api/chat/actions/start-job/route');
type SetStatusRoute = typeof import('@/app/api/chat/actions/set-status/route');

describe('chat action routes', () => {
  let root: string;
  let startJobRoute: StartJobRoute;
  let setStatusRoute: SetStatusRoute;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    startJobRoute = await import('@/app/api/chat/actions/start-job/route');
    setStatusRoute = await import('@/app/api/chat/actions/set-status/route');
    emitTurnEventMock.mockReset();
    spawnJobMock.mockReset();
  });

  afterEach(async () => {
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('POST /api/chat/actions/start-job', () => {
    it('web chat context: creates a confirm, starts nothing', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate', params: { num: 1001 } },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.summary).toBe('Start evaluation for offer #1001');
      expect(body.meta).toContain(' min');
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
      expect(emitTurnEventMock).toHaveBeenCalledWith(
        'turn-1',
        expect.objectContaining({ type: 'confirm', token: body.token }),
      );
    });

    it('web chat context: terminalApproved is ignored — still needs confirm', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate', params: { num: 1001 }, terminalApproved: true },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('terminal context without approval: needs confirm, no token, no confirm stored', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'evaluate',
          params: { num: 1001 },
        }),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toBeUndefined();
      expect(emitTurnEventMock).not.toHaveBeenCalled();
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('terminal context with terminalApproved: starts the job immediately', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', {
          kind: 'evaluate',
          params: { num: 1001 },
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(body.started).toBe(true);
      expect(body.job.type).toBe('evaluate');
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(1);
      await flushImmediate();
      expect(spawnJobMock).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown kind with 400', async () => {
      const res = await startJobRoute.POST(
        postJson('http://localhost/api/chat/actions/start-job', { kind: 'nonsense' }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a per-num kind without num with 400 (before any confirm)', async () => {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(400);
      expect(emitTurnEventMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/chat/actions/set-status', () => {
    it('web chat context: creates a confirm, writes nothing', async () => {
      const res = await setStatusRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/set-status',
          { num: 1001, status: 'applied' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      expect(body.needsConfirm).toBe(true);
      expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.summary).toBe('Set offer #1001 status to "applied"');
      // Two spaces: asserting the exact seeded substring (not the trimmed
      // canonical form) proves the file was never rewritten — mirrors the
      // equivalent assertion in confirms.test.ts.
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Screened  |');
    });

    it('terminal context with terminalApproved: writes the status', async () => {
      const res = await setStatusRoute.POST(
        postJson('http://localhost/api/chat/actions/set-status', {
          num: 1001,
          status: 'applied',
          terminalApproved: true,
        }),
      );
      const body = await res.json();
      expect(body.updated).toBe(true);
      expect(readFileSync(join(root, 'data/applications.md'), 'utf-8')).toContain('| Applied |');
    });

    it('rejects an invalid status with 400', async () => {
      const res = await setStatusRoute.POST(
        postJson('http://localhost/api/chat/actions/set-status', {
          num: 1001,
          status: 'ghosted',
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
