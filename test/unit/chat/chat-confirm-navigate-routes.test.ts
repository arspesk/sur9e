// test/unit/chat/chat-confirm-navigate-routes.test.ts
//
// Direct-call tests for /api/chat/actions/navigate and
// /api/chat/confirms/[token]. Same Pattern B fixture as
// chat-action-routes.test.ts; the confirm flow test drives the real
// start-job route first to obtain a token, then resolves it.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitTurnEventMock = vi.fn();
const spawnJobMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock('@/lib/server/chat/turn-runner', () => ({ emitTurnEvent: emitTurnEventMock }));
vi.mock('@/lib/server/jobs/runner', () => ({ spawnJob: spawnJobMock }));
vi.mock('@/server/revalidate', () => ({ revalidatePath: revalidatePathMock }));

const APPLICATIONS_MD = [
  '# Applications Tracker',
  '',
  '| #    | Date       | Company | Role | Score | Status    | PDF | Report | Notes |',
  '| ---- | ---------- | ------- | ---- | ----- | --------- | --- | ------ | ----- |',
  '| 1001 | 2026-05-15 | Acme    | Eng  | 4.0   | Screened  | -   | -      | -     |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-confirm-routes-test-'));
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

type NavigateRoute = typeof import('@/app/api/chat/actions/navigate/route');
type ConfirmsRoute = typeof import('@/app/api/chat/confirms/[token]/route');
type StartJobRoute = typeof import('@/app/api/chat/actions/start-job/route');
type SetStatusRoute = typeof import('@/app/api/chat/actions/set-status/route');
type CreateTextOfferRoute = typeof import('@/app/api/chat/actions/create-offer-from-text/route');

describe('navigate + confirm resolution routes', () => {
  let root: string;
  let navigateRoute: NavigateRoute;
  let confirmsRoute: ConfirmsRoute;
  let startJobRoute: StartJobRoute;
  let setStatusRoute: SetStatusRoute;
  let createTextOfferRoute: CreateTextOfferRoute;

  beforeEach(async () => {
    root = seedRoot();
    process.env.SUR9E_ROOT = root;
    vi.resetModules();
    navigateRoute = await import('@/app/api/chat/actions/navigate/route');
    confirmsRoute = await import('@/app/api/chat/confirms/[token]/route');
    startJobRoute = await import('@/app/api/chat/actions/start-job/route');
    setStatusRoute = await import('@/app/api/chat/actions/set-status/route');
    createTextOfferRoute = await import('@/app/api/chat/actions/create-offer-from-text/route');
    emitTurnEventMock.mockReset();
    spawnJobMock.mockReset();
    revalidatePathMock.mockReset();
  });

  afterEach(async () => {
    await flushImmediate();
    rmSync(root, { recursive: true, force: true });
    delete process.env.SUR9E_ROOT;
    vi.clearAllMocks();
  });

  describe('POST /api/chat/actions/navigate', () => {
    it('emits a ui navigate event on the turn', async () => {
      const res = await navigateRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/navigate',
          { path: '/table' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(emitTurnEventMock).toHaveBeenCalledWith('turn-1', {
        type: 'ui',
        action: 'navigate',
        path: '/table',
      });
    });

    it('rejects a call without a turn header', async () => {
      const res = await navigateRoute.POST(
        postJson('http://localhost/api/chat/actions/navigate', { path: '/table' }),
      );
      expect(res.status).toBe(400);
      expect(emitTurnEventMock).not.toHaveBeenCalled();
    });

    it('rejects an external URL', async () => {
      const res = await navigateRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/navigate',
          { path: 'https://example.com' },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/chat/confirms/[token]', () => {
    async function createStartJobConfirm(): Promise<string> {
      const res = await startJobRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/start-job',
          { kind: 'evaluate', params: { num: 1001 } },
          { 'x-sur9e-turn': 'turn-1' },
        ),
      );
      const body = await res.json();
      return body.token as string;
    }

    it('approve executes the parked start-job', async () => {
      const token = await createStartJobConfirm();
      const res = await confirmsRoute.POST(
        postJson(`http://localhost/api/chat/confirms/${token}`, { approve: true }),
        { params: Promise.resolve({ token }) },
      );
      const body = await res.json();
      expect(body.outcome).toBe('approved');
      expect(body.result.ok).toBe(true);
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(1);
      expect(emitTurnEventMock).toHaveBeenLastCalledWith('turn-1', {
        type: 'confirm-resolved',
        token,
        outcome: 'approved',
        execution: 'succeeded',
        message: 'Evaluation started for offer #1001.',
        links: [{ label: 'Offer #1001', href: '/report/1001' }],
      });
    });

    it('cancel executes nothing', async () => {
      const token = await createStartJobConfirm();
      const res = await confirmsRoute.POST(
        postJson(`http://localhost/api/chat/confirms/${token}`, { approve: false }),
        { params: Promise.resolve({ token }) },
      );
      const body = await res.json();
      expect(body.outcome).toBe('cancelled');
      expect(readdirSync(join(root, 'data/jobs'))).toHaveLength(0);
    });

    it('revalidates offers after approving a pasted-text offer creation', async () => {
      const create = await createTextOfferRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/create-offer-from-text',
          {
            text: 'Build reliable systems.',
            company: 'Acme',
            role: 'Platform Engineer',
          },
          { 'x-sur9e-turn': 'turn-text' },
        ),
      );
      const token = (await create.json()).token as string;

      const res = await confirmsRoute.POST(
        postJson(`http://localhost/api/chat/confirms/${token}`, { approve: true }),
        { params: Promise.resolve({ token }) },
      );

      expect((await res.json()).result).toMatchObject({
        ok: true,
        textOffer: { offer: { company: 'Acme', role: 'Platform Engineer' } },
      });
      expect(revalidatePathMock).toHaveBeenCalledWith('/offers');
    });

    it('revalidates every status surface after an approved status update', async () => {
      const create = await setStatusRoute.POST(
        postJson(
          'http://localhost/api/chat/actions/set-status',
          { num: 1001, status: 'responded' },
          { 'x-sur9e-turn': 'turn-status' },
        ),
      );
      const token = (await create.json()).token as string;

      const res = await confirmsRoute.POST(
        postJson(`http://localhost/api/chat/confirms/${token}`, { approve: true }),
        { params: Promise.resolve({ token }) },
      );

      expect((await res.json()).result).toMatchObject({
        ok: true,
        updated: { num: 1001, status: 'Responded' },
      });
      expect(revalidatePathMock.mock.calls).toEqual([
        ['/'],
        ['/offers'],
        ['/pipeline'],
        ['/report/[filename]', 'page'],
      ]);
    });

    it('an unknown token resolves to expired', async () => {
      const res = await confirmsRoute.POST(
        postJson('http://localhost/api/chat/confirms/nope', { approve: true }),
        { params: Promise.resolve({ token: 'nope' }) },
      );
      expect((await res.json()).outcome).toBe('expired');
    });

    it('rejects a body without a boolean approve', async () => {
      const res = await confirmsRoute.POST(
        postJson('http://localhost/api/chat/confirms/x', { approve: 'yes' }),
        { params: Promise.resolve({ token: 'x' }) },
      );
      expect(res.status).toBe(400);
    });
  });
});
